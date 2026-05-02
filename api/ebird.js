/**
 * Vercel Serverless Function — eBird API Proxy
 *
 * Keeps your API key off the client by proxying all eBird requests
 * through this function.  Set EBIRD_API_KEY in your Vercel project's
 * Environment Variables (Project Settings → Environment Variables).
 *
 * Usage from the frontend:
 *   /api/ebird?endpoint=ref/taxonomy/ebird&q=wren&locale=en
 *   /api/ebird?endpoint=data/obs/geo/recent/superfm1&lat=-33.7&lng=151.1&dist=20
 */

// Allowed endpoint prefixes (whitelist to prevent proxy abuse)
const ALLOWED_PREFIXES = [
  'ref/taxonomy/ebird',
  'ref/hotspot/geo',
  'ref/hotspot/info/',
  'data/obs/geo/recent',
  'data/obs/geo/recent/notable',
  'data/obs/L',               // hotspot observations: data/obs/L12345/recent
  'product/lists/',
];

function isAllowed(endpoint) {
  return ALLOWED_PREFIXES.some(prefix => endpoint.startsWith(prefix));
}

export default async function handler(req, res) {
  // CORS headers — allow requests from your own domain only in production,
  // or '*' for local development.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── API KEY ────────────────────────────────────────────────────────────────
  const apiKey = process.env.EBIRD_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'EBIRD_API_KEY environment variable is not set.  ' +
             'Add it in Vercel → Project Settings → Environment Variables.',
    });
  }

  // ── ENDPOINT PARAM ─────────────────────────────────────────────────────────
  const { endpoint, ...params } = req.query;

  if (!endpoint) {
    return res.status(400).json({ error: '"endpoint" query parameter is required.' });
  }

  if (!isAllowed(endpoint)) {
    return res.status(403).json({ error: `Endpoint not permitted: ${endpoint}` });
  }

  // ── FORWARD TO eBIRD ───────────────────────────────────────────────────────
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.ebird.org/v2/${endpoint}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(url, {
      headers: {
        'X-eBirdApiToken': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!upstream.ok) {
      const body = await upstream.text().catch(() => upstream.statusText);
      return res.status(upstream.status).json({ error: body });
    }

    const data = await upstream.json();

    // Cache at Vercel's CDN edge for 5 minutes; serves stale for 60 s on revalidation
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    return res.status(200).json(data);

  } catch (err) {
    return res.status(502).json({
      error: 'Failed to reach eBird API.',
      detail: err.message,
    });
  }
}
