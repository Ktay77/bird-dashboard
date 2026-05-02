// ─────────────────────────────────────────────────────────────────────────────
// Bird Dashboard – Configuration
// Edit the values below to match your setup, then save.
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {

  // ── API KEY ────────────────────────────────────────────────────────────────
  // Get a free key at: https://ebird.org/api/keygen
  //
  // Vercel deployment (recommended): leave this empty ("") and instead set
  //   EBIRD_API_KEY as an Environment Variable in the Vercel dashboard.
  //   The serverless proxy in api/ebird.js will use it securely.
  //
  // GitHub Pages / local file: paste your key here.  It will be visible in
  //   the browser source, which is fine for a personal-use app.
  EBIRD_API_KEY: "",

  // ── DEFAULT LOCATION ──────────────────────────────────────────────────────
  // These coordinates are Hornsby Station, Sydney NSW.
  // Change them if you'd prefer a different home base.
  DEFAULT_LAT: -33.7024,
  DEFAULT_LNG: 151.0993,
  DEFAULT_LOCATION_NAME: "Hornsby, NSW",

  // Search radius in kilometres used when no custom radius is supplied.
  // 20 km covers Hornsby → Berowra, Pennant Hills, Ku-ring-gai Chase, etc.
  DEFAULT_RADIUS_KM: 20,

  // eBird region code for taxonomy / region-level queries.
  // "AU-NSW" = New South Wales.  Change to "AU" for all of Australia, or
  // to a county-level code like "AU-NSW-SYD" if eBird supports it.
  DEFAULT_REGION: "AU-NSW",

  // ── DATA FRESHNESS ────────────────────────────────────────────────────────
  // How many days back to fetch observations (eBird max = 30).
  DAYS_BACK: 14,

  // How long to keep cached API responses in localStorage (milliseconds).
  // 5 minutes = 300 000 ms.  Taxonomy data is cached for 24 hours regardless.
  CACHE_DURATION_MS: 5 * 60 * 1000,

  // ── DEPLOYMENT MODE ───────────────────────────────────────────────────────
  // true  → all API calls go through /api/ebird (Vercel serverless proxy).
  //         The API key is stored in Vercel env vars, not in this file.
  // false → calls go directly to api.ebird.org from the browser.
  //         EBIRD_API_KEY above must be filled in.
  USE_PROXY: true,

  // Path to the serverless proxy function (only used when USE_PROXY: true).
  PROXY_PATH: "/api/ebird",

};
