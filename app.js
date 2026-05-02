'use strict';

/* ══════════════════════════════════════════════════════════════════
   CACHE  —  localStorage wrapper with TTL
   ══════════════════════════════════════════════════════════════════ */
const Cache = {
  TAX_TTL: 24 * 60 * 60 * 1000,  // taxonomy cached 24 h

  get(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      const ttl = key.startsWith('tax_') ? this.TAX_TTL : CONFIG.CACHE_DURATION_MS;
      if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
      return data;
    } catch { return null; }
  },

  set(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  },

  // Returns cached data regardless of age — used as offline fallback
  getStale(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw).data ?? null;
    } catch { return null; }
  },
};

/* ══════════════════════════════════════════════════════════════════
   eBIRD API  —  all calls go through here
   ══════════════════════════════════════════════════════════════════ */
const eBird = {

  async _call(endpoint, params = {}) {
    const cacheKey = `ebird_${endpoint}_${JSON.stringify(params)}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    let url, fetchOpts;
    if (CONFIG.USE_PROXY) {
      const qs = new URLSearchParams({ endpoint, ...params });
      url = `${CONFIG.PROXY_PATH}?${qs}`;
      fetchOpts = {};
    } else {
      const qs = new URLSearchParams(params);
      url = `https://api.ebird.org/v2/${endpoint}${qs.toString() ? '?' + qs : ''}`;
      fetchOpts = { headers: { 'X-eBirdApiToken': CONFIG.EBIRD_API_KEY } };
    }

    try {
      const resp = await fetch(url, fetchOpts);
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`eBird ${resp.status}: ${text}`);
      }
      const data = await resp.json();
      Cache.set(cacheKey, data);
      return data;
    } catch (err) {
      // Serve stale cached data when offline or API is unreachable
      const stale = Cache.getStale(cacheKey);
      if (stale) return stale;
      throw err;
    }
  },

  searchTaxonomy(q) {
    return this._call('ref/taxonomy/ebird', { q, locale: 'en', fmt: 'json', maxResults: '20' });
  },

  nearbySpeciesObs(speciesCode, lat, lng) {
    return this._call(`data/obs/geo/recent/${speciesCode}`, {
      lat, lng,
      dist: CONFIG.DEFAULT_RADIUS_KM,
      back: CONFIG.DAYS_BACK,
      includeProvisional: 'true',
      maxResults: '200',
    });
  },

  nearbyHotspots(lat, lng, dist) {
    return this._call('ref/hotspot/geo', {
      lat, lng,
      dist: dist || CONFIG.DEFAULT_RADIUS_KM,
      back: CONFIG.DAYS_BACK,
      fmt: 'json',
    });
  },

  hotspotObs(locId) {
    return this._call(`data/obs/${locId}/recent`, {
      back: 30,
      includeProvisional: 'true',
      maxResults: '200',
    });
  },

  nearbyObs(lat, lng, distKm) {
    return this._call('data/obs/geo/recent', {
      lat, lng,
      dist: distKm || 10,
      back: CONFIG.DAYS_BACK,
      includeProvisional: 'true',
      maxResults: '200',
    });
  },

  nearbyNotable(lat, lng) {
    return this._call('data/obs/geo/recent/notable', {
      lat, lng,
      dist: CONFIG.DEFAULT_RADIUS_KM,
      back: 7,
      detail: 'full',
      maxResults: '50',
    });
  },
};

/* ══════════════════════════════════════════════════════════════════
   GEOCODING  —  OpenStreetMap Nominatim (free, no key needed)
   ══════════════════════════════════════════════════════════════════ */
const Geo = {

  async geocode(query) {
    const cacheKey = `geo_${query.toLowerCase()}`;
    const cached = Cache.get(cacheKey);
    if (cached) return cached;

    // Bias toward NSW, Australia
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(query + ', NSW, Australia')}` +
      `&format=json&limit=4&addressdetails=0`;

    const resp = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'BirdDashboard/1.0' },
    });
    if (!resp.ok) throw new Error('Geocoding failed');
    const data = await resp.json();
    Cache.set(cacheKey, data);
    return data;
  },

  getUserLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation not supported by this browser.')); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        err => reject(new Error(err.code === 1 ? 'Location permission denied.' : 'Could not get your location.')),
        { timeout: 12000, maximumAge: 60000 },
      );
    });
  },

  // Haversine distance in km
  distance(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  },
};

/* ══════════════════════════════════════════════════════════════════
   UTILITIES
   ══════════════════════════════════════════════════════════════════ */
const Utils = {

  TIME_PERIODS: [
    { name: 'dawn',      range: [4, 7],   label: 'Dawn (4–7 am)',        emoji: '🌅' },
    { name: 'morning',   range: [7, 11],  label: 'Morning (7–11 am)',    emoji: '☀️' },
    { name: 'midday',    range: [11, 14], label: 'Midday (11 am–2 pm)',  emoji: '🌤' },
    { name: 'afternoon', range: [14, 17], label: 'Afternoon (2–5 pm)',   emoji: '🌇' },
    { name: 'dusk',      range: [17, 20], label: 'Dusk (5–8 pm)',        emoji: '🌆' },
    { name: 'night',     range: [20, 28], label: 'Night',                emoji: '🌙' },
  ],

  getTimePeriod(hour) {
    const h = hour < 4 ? hour + 24 : hour;
    for (const p of this.TIME_PERIODS) {
      if (h >= p.range[0] && h < p.range[1]) return p;
    }
    return this.TIME_PERIODS[this.TIME_PERIODS.length - 1];
  },

  // Returns the period object with the most observations, or null if <3 timed obs
  analyzeObsTimes(observations) {
    const counts = {};
    let timed = 0;
    for (const obs of observations) {
      if (!obs.obsDt) continue;
      const parts = obs.obsDt.split(' ');
      if (parts.length < 2) continue;
      const hour = parseInt(parts[1], 10);
      if (isNaN(hour)) continue;
      timed++;
      const p = this.getTimePeriod(hour).name;
      counts[p] = (counts[p] || 0) + 1;
    }
    if (timed < 3) return null;
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? this.TIME_PERIODS.find(p => p.name === best[0]) : null;
  },

  // Colour and label for a frequency ratio 0–1
  freqInfo(ratio) {
    if (ratio >= 0.7) return { label: 'Very likely', color: '#2d6a4f' };
    if (ratio >= 0.5) return { label: 'Likely',      color: '#40916c' };
    if (ratio >= 0.3) return { label: 'Sometimes',   color: '#f4a261' };
    return                    { label: 'Occasional',  color: '#95d5b2' };
  },

  // Group an array by a key function
  groupBy(arr, keyFn) {
    return arr.reduce((acc, item) => {
      const k = keyFn(item);
      (acc[k] = acc[k] || []).push(item);
      return acc;
    }, {});
  },

  // "2 days ago" / "Today" / "Jan 15"
  relativeDate(dtStr) {
    if (!dtStr) return '';
    const d = new Date(dtStr.replace(' ', 'T'));
    if (isNaN(d)) return dtStr;
    const days = Math.floor((Date.now() - d) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 8)  return `${days} days ago`;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  },

  // Filter observations to a ±2 h window around targetHour; falls back to all obs if < 15 remain
  filterByHour(observations, targetHour) {
    if (targetHour === null) return { obs: observations, filtered: false };
    const nearby = observations.filter(obs => {
      if (!obs.obsDt) return false;
      const parts = obs.obsDt.split(' ');
      if (parts.length < 2) return false;
      const h = parseInt(parts[1], 10);
      if (isNaN(h)) return false;
      const diff = Math.abs(h - targetHour);
      return diff <= 2 || diff >= 22;
    });
    if (nearby.length >= 15) return { obs: nearby, filtered: true };
    return { obs: observations, filtered: false };
  },

  // Compute per-species frequency from a list of observations
  speciesFrequencies(observations) {
    const speciesMap = {};
    const allSubs = new Set();

    for (const obs of observations) {
      if (!obs.subId || !obs.speciesCode) continue;
      allSubs.add(obs.subId);
      if (!speciesMap[obs.speciesCode]) {
        speciesMap[obs.speciesCode] = {
          speciesCode: obs.speciesCode,
          comName: obs.comName,
          sciName: obs.sciName,
          subs: new Set(),
        };
      }
      speciesMap[obs.speciesCode].subs.add(obs.subId);
    }

    const total = allSubs.size;
    if (!total) return [];

    return Object.values(speciesMap)
      .map(s => ({
        speciesCode: s.speciesCode,
        comName: s.comName,
        sciName: s.sciName,
        count: s.subs.size,
        frequency: s.subs.size / total,
        totalChecklists: total,
      }))
      .sort((a, b) => b.frequency - a.frequency);
  },

  debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};

/* ══════════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════════ */
const state = {
  mode: 'find-bird',
  modeA: {
    species: null,         // { speciesCode, comName, sciName }
    lat: CONFIG.DEFAULT_LAT,
    lng: CONFIG.DEFAULT_LNG,
    locationName: CONFIG.DEFAULT_LOCATION_NAME,
  },
  modeB: {
    hotspot: null,         // { locId?, locName, lat, lng }
    day: new Date().getDay(),
    time: null,            // will be set on init
  },
  modeC: {
    lat: null,
    lng: null,
  },
};

/* ══════════════════════════════════════════════════════════════════
   UI HELPERS
   ══════════════════════════════════════════════════════════════════ */
const UI = {

  /* Loading overlay */
  showLoading(msg = 'Fetching bird data…') {
    document.getElementById('loading-msg').textContent = msg;
    document.getElementById('loading-overlay').hidden = false;
  },

  hideLoading() {
    document.getElementById('loading-overlay').hidden = true;
  },

  /* Status messages */
  showStatus(id, msg, type = 'warning') {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.className = `status-msg ${type}`;
    el.hidden = false;
  },

  clearStatus(id) {
    document.getElementById(id).hidden = true;
  },

  /* Results container */
  showResults(id, html) {
    const el = document.getElementById(id);
    el.innerHTML = html;
    el.hidden = false;
  },

  clearResults(id) {
    const el = document.getElementById(id);
    el.innerHTML = '';
    el.hidden = true;
  },

  /* Autocomplete suggestions */
  showSuggestions(listId, items) {
    const el = document.getElementById(listId);
    el.innerHTML = items.map(i => `
      <li class="suggestion-item" role="option" tabindex="0"
          data-value="${Utils.escapeHtml(JSON.stringify(i.data))}">
        <span class="suggestion-primary">${Utils.escapeHtml(i.primary)}</span>
        ${i.secondary ? `<span class="suggestion-secondary">${Utils.escapeHtml(i.secondary)}</span>` : ''}
      </li>
    `).join('');
    el.hidden = false;
  },

  hideSuggestions(listId) {
    const el = document.getElementById(listId);
    el.hidden = true;
    el.innerHTML = '';
  },

  /* Build HTML for a list of hotspots (Mode A result) */
  renderHotspots(hotspots, speciesName) {
    if (!hotspots.length) {
      return `<div class="no-results">No recent ${Utils.escapeHtml(speciesName)} sightings found within ${CONFIG.DEFAULT_RADIUS_KM} km in the last ${CONFIG.DAYS_BACK} days.</div>`;
    }
    const heading = `<p class="results-heading">${hotspots.length} hotspot${hotspots.length !== 1 ? 's' : ''} with recent ${Utils.escapeHtml(speciesName)}</p>`;
    const cards = hotspots.map(h => {
      const timePart = h.bestTime
        ? `<span class="meta-pill highlight">${h.bestTime.emoji} Best: ${h.bestTime.label}</span>`
        : '';
      return `
        <div class="hotspot-card">
          <div class="hotspot-name">${Utils.escapeHtml(h.locName)}</div>
          <div class="hotspot-meta">
            <span class="meta-pill">📍 ${h.distance.toFixed(1)} km</span>
            <span class="meta-pill">🗓 Last: ${Utils.relativeDate(h.latestObsDt)}</span>
            <span class="meta-pill">📋 ${h.count} report${h.count !== 1 ? 's' : ''}</span>
            ${timePart}
          </div>
        </div>`;
    }).join('');
    return heading + cards;
  },

  /* Build HTML for a species frequency list (Modes B & C) */
  renderSpeciesList(species, heading, notableCodes = new Set()) {
    if (!species.length) {
      return `<div class="no-results">No recent observations found. Try a longer date range or a different location.</div>`;
    }

    const topN = species.slice(0, 30);
    const headHtml = heading ? `<p class="results-heading">${Utils.escapeHtml(heading)}</p>` : '';

    const cards = topN.map(s => {
      const fi = Utils.freqInfo(s.frequency);
      const pct = Math.round(s.frequency * 100);
      const isNotable = notableCodes.has(s.speciesCode);
      return `
        <div class="bird-card${isNotable ? ' notable' : ''}">
          ${isNotable ? `<span class="notable-badge">⭐ Notable</span>` : ''}
          <div class="bird-common-name">${Utils.escapeHtml(s.comName)}</div>
          <div class="bird-sci-name">${Utils.escapeHtml(s.sciName)}</div>
          <div class="freq-bar-wrap">
            <div class="freq-bar-bg">
              <div class="freq-bar-fill" style="width:${pct}%;background:${fi.color}"></div>
            </div>
            <span class="freq-label" style="color:${fi.color}">${fi.label}</span>
          </div>
          <div class="report-count">${pct}% of ${s.totalChecklists} recent checklist${s.totalChecklists !== 1 ? 's' : ''}</div>
        </div>`;
    }).join('');

    return headHtml + cards;
  },

  /* Nearby hotspot list card for Mode C */
  renderHotspotList(hotspots) {
    const items = hotspots.slice(0, 8).map(h =>
      `<div class="hotspot-list-item">
         <span class="hotspot-list-name">${Utils.escapeHtml(h.locName)}</span>
         <span class="hotspot-list-dist">${h.distance.toFixed(1)} km · ${h.numSpeciesAllTime || '?'} sp.</span>
       </div>`
    ).join('');
    return `<p class="results-heading">Nearby eBird hotspots</p>
            <div class="hotspot-list-card">${items}</div>`;
  },
};

/* ══════════════════════════════════════════════════════════════════
   MODE A  —  "I want to see Bird X"
   ══════════════════════════════════════════════════════════════════ */
const ModeA = {

  async search() {
    if (!state.modeA.species) {
      UI.showStatus('find-bird-status', 'Please select a species from the suggestions first.', 'warning');
      return;
    }

    const { speciesCode, comName } = state.modeA.species;
    const { lat, lng, locationName } = state.modeA;

    UI.clearStatus('find-bird-status');
    UI.clearResults('find-bird-results');
    UI.showLoading(`Finding ${comName} sightings…`);

    try {
      const obs = await eBird.nearbySpeciesObs(speciesCode, lat, lng);
      const hotspots = this._processObs(obs, lat, lng);
      UI.showResults('find-bird-results', UI.renderHotspots(hotspots, comName));
    } catch (err) {
      UI.showStatus('find-bird-status', `Error: ${err.message}`, 'error');
    } finally {
      UI.hideLoading();
    }
  },

  _processObs(observations, userLat, userLng) {
    const byLoc = Utils.groupBy(
      observations.filter(o => !o.locationPrivate),
      o => o.locId,
    );

    return Object.values(byLoc)
      .map(obs => {
        const first = obs[0];
        const dist  = Geo.distance(userLat, userLng, first.lat, first.lng);
        const sorted = [...obs].sort((a, b) => new Date(b.obsDt) - new Date(a.obsDt));
        const bestTime = Utils.analyzeObsTimes(obs);
        return {
          locId: first.locId,
          locName: first.locName,
          lat: first.lat,
          lng: first.lng,
          distance: dist,
          count: obs.length,
          latestObsDt: sorted[0]?.obsDt,
          bestTime,
          // Score: reports per km (higher = better)
          score: obs.length / Math.max(dist, 0.5),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  },
};

/* ══════════════════════════════════════════════════════════════════
   MODE B  —  "I'm going to Place Y at Time Z"
   ══════════════════════════════════════════════════════════════════ */
const ModeB = {

  async search() {
    if (!state.modeB.hotspot) {
      UI.showStatus('find-place-status', 'Please search for and select a location first.', 'warning');
      return;
    }

    const { locId, locName, lat, lng } = state.modeB.hotspot;
    const timeStr = document.getElementById('time-input').value;
    const targetHour = timeStr ? parseInt(timeStr.split(':')[0], 10) : null;

    UI.clearStatus('find-place-status');
    UI.clearResults('find-place-results');
    UI.showLoading(`Loading birds for ${locName}…`);

    try {
      let obsPromise = locId ? eBird.hotspotObs(locId) : eBird.nearbyObs(lat, lng, 5);
      const [obs, notable] = await Promise.all([
        obsPromise,
        eBird.nearbyNotable(lat, lng).catch(() => []),
      ]);

      const { obs: filtered, filtered: wasFiltered } = Utils.filterByHour(obs, targetHour);
      const species = Utils.speciesFrequencies(filtered);
      const notableCodes = new Set(notable.map(n => n.speciesCode));

      let heading = `Likely birds at ${locName}`;
      if (wasFiltered && timeStr) heading += ` around ${timeStr}`;

      let html = UI.renderSpeciesList(species, heading, notableCodes);
      if (!wasFiltered && targetHour !== null && obs.length > 0) {
        html = `<div class="status-msg info">Not enough timed checklist data to filter by hour — showing all recent sightings.</div>` + html;
      }
      UI.showResults('find-place-results', html);
    } catch (err) {
      UI.showStatus('find-place-status', `Error: ${err.message}`, 'error');
    } finally {
      UI.hideLoading();
    }
  },

  /* Debounced handler for the place search input */
  async handleInput(query) {
    if (query.length < 2) { UI.hideSuggestions('place-suggestions'); return; }

    try {
      // Step 1: geocode the text
      const geoResults = await Geo.geocode(query);
      if (!geoResults.length) { UI.hideSuggestions('place-suggestions'); return; }

      const { lat, lon, display_name } = geoResults[0];
      const geoLat = parseFloat(lat);
      const geoLng = parseFloat(lon);

      // Step 2: find nearby eBird hotspots around that point
      const hotspots = await eBird.nearbyHotspots(geoLat, geoLng, 15);

      // Build suggestion items: hotspots ranked by distance
      const items = hotspots
        .map(h => ({
          primary: h.locName,
          secondary: `eBird hotspot · ${Geo.distance(geoLat, geoLng, h.lat, h.lng).toFixed(1)} km from "${query}"`,
          data: { locId: h.locId, locName: h.locName, lat: h.lat, lng: h.lng },
        }))
        .slice(0, 10);

      // Also offer the raw geocoded location as a fallback
      const shortName = display_name.split(',').slice(0, 2).join(',').trim();
      items.unshift({
        primary: `📍 Use: ${shortName}`,
        secondary: `Search all birds near this location (no specific hotspot)`,
        data: { locId: null, locName: shortName, lat: geoLat, lng: geoLng },
      });

      UI.showSuggestions('place-suggestions', items);
    } catch {
      UI.hideSuggestions('place-suggestions');
    }
  },

  selectHotspot(data) {
    state.modeB.hotspot = data;
    document.getElementById('place-input').value = '';
    UI.hideSuggestions('place-suggestions');
    document.getElementById('selected-place-name').textContent = data.locName;
    document.getElementById('selected-place-badge').hidden = false;
  },

  clearHotspot() {
    state.modeB.hotspot = null;
    document.getElementById('selected-place-badge').hidden = true;
    document.getElementById('place-input').value = '';
    UI.clearResults('find-place-results');
    UI.clearStatus('find-place-status');
  },
};

/* ══════════════════════════════════════════════════════════════════
   MODE C  —  "Near Me"
   ══════════════════════════════════════════════════════════════════ */
const ModeC = {

  async run() {
    UI.clearStatus('near-me-status');
    UI.clearResults('near-me-results');
    UI.showLoading('Getting your location…');

    try {
      const { lat, lng } = await Geo.getUserLocation();
      state.modeC.lat = lat;
      state.modeC.lng = lng;

      UI.showLoading('Finding nearby hotspots and birds…');

      const [hotspots, obs, notable] = await Promise.all([
        eBird.nearbyHotspots(lat, lng),
        eBird.nearbyObs(lat, lng),
        eBird.nearbyNotable(lat, lng).catch(() => []),
      ]);

      const currentHour = new Date().getHours();
      const { obs: filtered } = Utils.filterByHour(obs, currentHour);
      const species = Utils.speciesFrequencies(filtered);

      const notableCodes = new Set(notable.map(n => n.speciesCode));

      const hotspotsWithDist = hotspots
        .map(h => ({ ...h, distance: Geo.distance(lat, lng, h.lat, h.lng) }))
        .sort((a, b) => a.distance - b.distance);

      const period = Utils.getTimePeriod(currentHour);
      const heading = `Likely birds right now (${period.emoji} ${period.label})`;

      const html =
        UI.renderHotspotList(hotspotsWithDist) +
        `<div style="height:8px"></div>` +
        UI.renderSpeciesList(species, heading, notableCodes);

      UI.showResults('near-me-results', html);
    } catch (err) {
      UI.showStatus('near-me-status', err.message, 'error');
    } finally {
      UI.hideLoading();
    }
  },
};

/* ══════════════════════════════════════════════════════════════════
   APP INIT & EVENT WIRING
   ══════════════════════════════════════════════════════════════════ */
const App = {

  init() {
    this._checkApiKey();
    this._setDefaultTime();
    this._wireTabBar();
    this._wireModeA();
    this._wireModeB();
    this._wireModeC();
    document.getElementById('radius-hint').textContent = `${CONFIG.DEFAULT_RADIUS_KM} km`;
  },

  _checkApiKey() {
    const noKey = !CONFIG.USE_PROXY && !CONFIG.EBIRD_API_KEY;
    document.getElementById('api-key-notice').hidden = !noKey;
  },

  _setDefaultTime() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('time-input').value = `${h}:${m}`;
    document.getElementById('day-select').value = String(now.getDay());
  },

  _wireTabBar() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        document.querySelectorAll('.tab-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        document.querySelectorAll('.mode-panel').forEach(panel => {
          const isActive = panel.id === mode;
          panel.classList.toggle('active', isActive);
          panel.hidden = !isActive;
        });
        state.mode = mode;
      });
    });
  },

  /* ── MODE A ─────────────────────────────────────────────────── */
  _wireModeA() {
    const input = document.getElementById('species-input');
    const clearBtn = document.getElementById('clear-species');
    const gpsBtn = document.getElementById('gps-a');
    const locationInput = document.getElementById('location-input-a');
    const searchBtn = document.getElementById('find-bird-btn');
    const suggList = document.getElementById('species-suggestions');

    locationInput.value = CONFIG.DEFAULT_LOCATION_NAME;

    // Species autocomplete
    const doTaxSearch = Utils.debounce(async (q) => {
      if (q.length < 2) { UI.hideSuggestions('species-suggestions'); return; }
      try {
        const results = await eBird.searchTaxonomy(q);
        const filtered = results.filter(r => r.category !== 'slash' && r.category !== 'spuh');
        UI.showSuggestions('species-suggestions', filtered.map(r => ({
          primary: r.comName,
          secondary: `${r.sciName} · ${r.category}`,
          data: { speciesCode: r.speciesCode, comName: r.comName, sciName: r.sciName },
        })));
      } catch { UI.hideSuggestions('species-suggestions'); }
    }, 350);

    input.addEventListener('input', () => {
      clearBtn.hidden = !input.value;
      if (!input.value) { state.modeA.species = null; }
      doTaxSearch(input.value.trim());
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.hidden = true;
      state.modeA.species = null;
      UI.hideSuggestions('species-suggestions');
      UI.clearResults('find-bird-results');
    });

    suggList.addEventListener('click', e => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      const data = JSON.parse(item.dataset.value);
      state.modeA.species = data;
      input.value = data.comName;
      clearBtn.hidden = false;
      UI.hideSuggestions('species-suggestions');
    });

    suggList.addEventListener('keydown', e => {
      if (e.key === 'Enter') e.target.click();
    });

    // Close suggestions on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('#find-bird')) UI.hideSuggestions('species-suggestions');
    });

    // GPS button
    gpsBtn.addEventListener('click', async () => {
      gpsBtn.textContent = '…';
      try {
        const { lat, lng } = await Geo.getUserLocation();
        state.modeA.lat = lat;
        state.modeA.lng = lng;
        state.modeA.locationName = 'Your location';
        locationInput.value = `My location (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
      } catch (err) {
        UI.showStatus('find-bird-status', err.message, 'error');
      } finally {
        gpsBtn.textContent = '📍';
      }
    });

    // Location text → geocode on blur
    locationInput.addEventListener('blur', async () => {
      const val = locationInput.value.trim();
      if (!val || val === CONFIG.DEFAULT_LOCATION_NAME) {
        state.modeA.lat = CONFIG.DEFAULT_LAT;
        state.modeA.lng = CONFIG.DEFAULT_LNG;
        state.modeA.locationName = CONFIG.DEFAULT_LOCATION_NAME;
        return;
      }
      if (val.startsWith('My location')) return;
      try {
        const results = await Geo.geocode(val);
        if (results.length) {
          state.modeA.lat = parseFloat(results[0].lat);
          state.modeA.lng = parseFloat(results[0].lon);
          state.modeA.locationName = val;
        }
      } catch {}
    });

    searchBtn.addEventListener('click', () => ModeA.search());
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { UI.hideSuggestions('species-suggestions'); ModeA.search(); } });
  },

  /* ── MODE B ─────────────────────────────────────────────────── */
  _wireModeB() {
    const input = document.getElementById('place-input');
    const gpsBtn = document.getElementById('gps-b');
    const searchBtn = document.getElementById('find-place-btn');
    const clearPlaceBtn = document.getElementById('clear-place');
    const suggList = document.getElementById('place-suggestions');

    const doPlaceSearch = Utils.debounce(q => ModeB.handleInput(q), 400);

    input.addEventListener('input', () => {
      state.modeB.hotspot = null;
      doPlaceSearch(input.value.trim());
    });

    suggList.addEventListener('click', e => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      ModeB.selectHotspot(JSON.parse(item.dataset.value));
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#find-place')) UI.hideSuggestions('place-suggestions');
    });

    clearPlaceBtn.addEventListener('click', () => ModeB.clearHotspot());

    gpsBtn.addEventListener('click', async () => {
      gpsBtn.textContent = '…';
      try {
        const { lat, lng } = await Geo.getUserLocation();
        UI.showLoading('Finding nearby hotspots…');
        const hotspots = await eBird.nearbyHotspots(lat, lng, 15);
        const items = hotspots
          .map(h => ({
            primary: h.locName,
            secondary: `eBird hotspot · ${Geo.distance(lat, lng, h.lat, h.lng).toFixed(1)} km away`,
            data: { locId: h.locId, locName: h.locName, lat: h.lat, lng: h.lng },
          }))
          .slice(0, 12);
        items.unshift({
          primary: '📍 Use my current location',
          secondary: 'Show birds across all nearby hotspots',
          data: { locId: null, locName: 'Your location', lat, lng },
        });
        input.value = '';
        UI.showSuggestions('place-suggestions', items);
      } catch (err) {
        UI.showStatus('find-place-status', err.message, 'error');
      } finally {
        gpsBtn.textContent = '📍';
        UI.hideLoading();
      }
    });

    searchBtn.addEventListener('click', () => ModeB.search());
  },

  /* ── MODE C ─────────────────────────────────────────────────── */
  _wireModeC() {
    document.getElementById('near-me-btn').addEventListener('click', () => ModeC.run());
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
