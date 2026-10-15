# Integrating OrbisEye into a desktop app

## The one thing that matters

OrbisEye is **not** a static frontend. Its backend is 24 `/api/*` routes
implemented as Vite plugin middleware in `server/proxies.js` — flights,
satellites, terrain, CCTV, radio, earthquakes, launches, and the whole voice
stack go through them.

Point a `BrowserWindow` at `index.html` and you get the shell with **every data
layer returning 404**. That is the single mistake to avoid; everything below
exists to prevent it.

## Setup

```bash
npm ci
```

Requires Node 22 or newer. `package.json` lists 24.14+/26 as preferred, but the
full suite (2587 tests) and the app both run on 22.

## Option 1 — embed the server (recommended)

`desktop-server.mjs` boots the real OrbisEye server in-process and hands back a
URL. The embedded app then behaves identically to the standalone one.

```js
import { startOrbisEye } from './orbiseye/desktop-server.mjs';

const orbis = await startOrbisEye();   // free port on 127.0.0.1
win.loadURL(orbis.url);

app.on('before-quit', () => orbis.close());
```

Options:

| Option | Default | Notes |
|---|---|---|
| `port` | `0` | 0 asks the OS for a free port — avoids colliding with the host app |
| `host` | `127.0.0.1` | Loopback only. The server brokers API keys; do not expose it |
| `env` | `{}` | Inject keys from the host's own secret store instead of shipping `.env` |

Injecting keys from the host rather than a bundled `.env`:

```js
const orbis = await startOrbisEye({
  env: { GROQ_API_KEYS: await keychain.get('groq-pool') },
});
```

Verify it standalone first:

```bash
node desktop-server.mjs
```

It prints the URL on stdout. Open it — globe, layers, and voice panel should all
work exactly as in the deployed app.

## Option 2 — mount the proxies on your own server

Every proxy factory is exported from `server/proxies.js`, and each registers
itself given an object with a `middlewares` property. `api/proxy.js` is a
working reference — it is how the Vercel serverless build mounts the same
routes without Vite.

```js
import { openSkyProxy, celestrakProxy /* …19 more */ } from './server/proxies.js';

for (const plugin of [openSkyProxy(), celestrakProxy() /* … */]) {
  plugin.configureServer({ middlewares: yourConnectApp });
}
```

Then serve the built frontend (`npm run build` → `dist/`) as static files.

## Option 3 — load the hosted build

```js
win.loadURL('https://orbiseye.vercel.app');
```

Zero integration, always current, but requires a network connection and gives up
offline use and local key control.

## Keys

`.env` carries the runtime configuration. Nothing is required to start — the app
degrades per-feature rather than failing:

| Variable | Effect if missing |
|---|---|
| `GROQ_API_KEYS` / `GROQ_API_KEY` | Voice control unavailable; map still fully usable |
| `GOOGLE_MAPS_API_KEY` | Standard Cesium globe instead of photorealistic 3D tiles |
| `FIRMS_MAP_KEY` | Active-fires layer empty |
| `AISSTREAM_API_KEY` | Live ships unavailable |
| `TOMTOM_API_KEY` | Traffic falls back to its built-in simulation |
| `OPENSKY_CLIENT_ID` / `_SECRET` | Flights use the 1000nm adsb.lol fallback rather than the global feed |

`GROQ_API_KEYS` is comma-separated and rotates automatically: a rate-limited key
rests ~65s, a rejected one 10 minutes, and the next is tried immediately, so a
single 429 never fails a request.

Set `ORBISEYE_ACCESS_PASSWORD` to put HTTP Basic auth in front of everything
including `/api/*`. Unset (the default) means no gate, which is correct for a
desktop app on loopback.

## Voice

Speech recognition runs in the **browser**, not at the AI provider:

```text
VOICE → SpeechRecognition → TEXT → Groq → tool router → OrbisEye action → text reply
```

Only text reaches Groq. Two consequences for a desktop host:

- The window needs **microphone permission**. In Electron, handle
  `session.setPermissionRequestHandler` for `media`.
- Chromium's `SpeechRecognition` must be available. If it is not, the app falls
  back to Whisper via `/api/groq/stt` automatically.

All 28 tools stay registered; `selectTools()` only decides which 3–5 are *sent*
per sentence, because Groq's tool-capable models allow 8K tokens/minute and the
full schema is ~7K.

## Checks before shipping

```bash
node scripts/run-unit-tests.mjs    # 2587 pass / 0 fail
node desktop-server.mjs            # then open the printed URL
```

Hold **Space** and say *"fly to Tokyo and show satellites"* — the camera should
move and the layer switch on.
