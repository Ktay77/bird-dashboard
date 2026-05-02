# Bird Dashboard

A mobile-friendly web dashboard for planning birding trips around Hornsby / Sydney, NSW.
Powered by the [eBird API 2.0](https://documenter.getpostman.com/view/664302/S1ENwy59).

---

## What it does

| Mode | Question answered |
|------|-------------------|
| **Find Bird** | "Where and when should I go to see *Species X*?" |
| **Find Place** | "If I go to *Hotspot Y* at *Time Z*, what will I likely see?" |
| **Near Me** | "What birds are around me right now?" |

---

## Step 1 — Get a free eBird API key

1. Go to <https://ebird.org/api/keygen>
2. Log in (or create a free eBird account)
3. Click **Generate** and copy the key — it looks like `abc123xyz456`

---

## Step 2 — Deploy to Vercel (recommended — keeps key secure)

### 2a. Push the files to GitHub

1. Create a new GitHub repository (it can be private)
2. Upload all files in this folder to the repo root

### 2b. Create a Vercel project

1. Go to <https://vercel.com> and sign up/log in (free Hobby plan is enough)
2. Click **Add New → Project** and import your GitHub repo
3. Leave all build settings at their defaults (Vercel auto-detects a static site with a serverless function)
4. Click **Deploy** — you'll get a URL like `https://bird-dashboard-xyz.vercel.app`

### 2c. Add your eBird API key

1. In Vercel, open your project → **Settings → Environment Variables**
2. Add a new variable:
   - **Name:** `EBIRD_API_KEY`
   - **Value:** your key from Step 1
   - **Environment:** select all three (Production, Preview, Development)
3. Click **Save**, then go to **Deployments** and redeploy

That's it — visit your Vercel URL on your phone and it should work.

---

## Alternative: GitHub Pages (simpler, key is visible in source)

This is fine for a personal-use app that isn't publicly shared.

1. Open `config.js` and:
   - Paste your eBird key into `EBIRD_API_KEY: "paste-key-here"`
   - Change `USE_PROXY: true` → `USE_PROXY: false`
2. Push to a GitHub repo
3. Go to the repo **Settings → Pages**, set source to `main` branch, root folder
4. Visit the generated `github.io` URL

---

## Customising defaults

All tweakable values are in `config.js`:

| Setting | Default | What to change |
|---------|---------|----------------|
| `DEFAULT_LAT` / `DEFAULT_LNG` | Hornsby Station | Your home coordinates |
| `DEFAULT_LOCATION_NAME` | `"Hornsby, NSW"` | Label shown in the location field |
| `DEFAULT_RADIUS_KM` | `20` | Search radius; try `30` for wider coverage |
| `DEFAULT_REGION` | `"AU-NSW"` | eBird region code |
| `DAYS_BACK` | `14` | How far back to look (max 30) |
| `CACHE_DURATION_MS` | `300000` (5 min) | How long to reuse cached results |

---

## Running locally (optional)

Because the serverless proxy doesn't exist locally, use the direct-browser mode:

1. Open `config.js`, set `USE_PROXY: false` and paste your key in `EBIRD_API_KEY`
2. Open `index.html` directly in a browser **or** run a simple server:
   ```
   npx serve .
   ```
3. Open `http://localhost:3000`

---

## File layout

```
bird-dashboard/
├── index.html       Main single-page app
├── style.css        Mobile-first styles
├── app.js           All app logic (modes A, B, C)
├── config.js        ← edit this to customise the app
├── api/
│   └── ebird.js     Vercel serverless proxy (keeps API key secure)
├── vercel.json      Vercel function settings
├── package.json     Node ≥18 requirement for the proxy
└── README.md        This file
```

---

## eBird API fair-use notes

- Results are cached in your browser for 5 minutes to avoid hammering the API
- The app never downloads bulk data; every call is user-triggered
- eBird API terms: <https://www.birds.cornell.edu/home/ebird-api-terms-of-use/>
