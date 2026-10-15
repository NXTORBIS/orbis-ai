# Deploying OrbisEye

## Why this can't go on Netlify / Vercel / GitHub Pages

OrbisEye's entire backend is Vite **plugin middleware** in `vite.config.js` — 24
`/api/*` routes covering flights, satellites, terrain, CCTV, AIS, FIRMS, traffic,
radio, and the OpenAI token broker. 19 plugins register `configureServer` (dev
only); only 9 also register `configurePreviewServer`.

`vite build` emits a static bundle containing **none** of them. Verified by
serving `dist/` from a plain static server: `/` returns 200 and every `/api/*`
route returns 404. A static host gives you the shell and a dead globe.

So OrbisEye must run as a **Node process**, not a static upload. That is what the
`Dockerfile` does — it deliberately runs the Vite server, because that server *is*
the backend.

## Deploy to Fly.io

Prerequisites: a Fly.io account. Nothing is installed on this machine yet.

```bash
powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
```

Then, from the project root:

```bash
fly auth login
```

```bash
fly launch --no-deploy --copy-config --name YOUR-APP-NAME
```

```bash
fly deploy
```

`fly launch` picks your region and rewrites `app` in `fly.toml`. The name you
choose becomes your public URL: `https://YOUR-APP-NAME.fly.dev`.

## Keys

A keyless deployment needs **no secrets at all**, which is the safest way to put
this on the public internet — there is no quota for a stranger to spend. You get
the standard Cesium globe instead of Google's photorealistic 3D tiles; flights,
satellites, earthquakes, CCTV, radio, launches, and every bundled dataset still
work.

If you later add keys, set them as Fly secrets so they never enter the image:

```bash
fly secrets set GOOGLE_MAPS_API_KEY=... OPENAI_API_KEY=...
```

`.env` is in `.dockerignore` and must stay there.

**Before adding a Google Maps key to a public deployment**, read `SECURITY.md`.
The key is injected into the browser bundle by design and is visible in devtools.
Restrict it by HTTP referrer to your Fly hostname, restrict it to the Map Tiles
API, and set a Google Cloud budget alert — otherwise anyone who finds the URL can
bill you.

## Locking it down

The app ships an optional HTTP Basic gate that sits in front of everything — the
shell, the assets, and all 24 `/api/*` proxies. It is a no-op unless you set a
password, so localhost is unaffected.

Turn it on for a public deployment:

```bash
fly secrets set ORBISEYE_ACCESS_PASSWORD=your-long-random-password
```

Username defaults to `orbiseye`; override with `ORBISEYE_ACCESS_USER`. Visitors
get a browser login prompt before anything loads.

Gate the proxies, not just the page: `/api/*` is reachable directly without ever
loading the HTML, so protecting only the shell would protect nothing that costs
money. That is why the gate installs ahead of every proxy plugin.

Note this changes your website-button flow — visitors hit a password prompt
before OrbisEye. If you want it open to everyone, leave the password unset and
rely on the keyless posture (no keys configured means no quota to burn).

## Scope note

Upstream describes this project as a foundation for exploration and learning
rather than a hardened production service, and the Vite dev server is not built
for hostile public traffic. For a genuinely public deployment, put it behind
access control (Fly's `[http_service]` plus an auth proxy, or Cloudflare Access)
rather than leaving it open.
