/**
 * Serverless entry point for every /api/* route.
 *
 * OrbisEye's backend is a set of Vite plugins whose middleware is installed via
 * `server.middlewares.use(...)`. Those handlers are plain Node
 * `(req, res, next)` functions that touch nothing Vite-specific, so this module
 * hands them a minimal connect-compatible object and runs the same chain
 * outside Vite entirely. No proxy logic is duplicated here — server/proxies.js
 * remains the single implementation shared by the dev server, `vite preview`,
 * and this function.
 *
 * @module api/[...path]
 */

import {
  accessGate,
  openSkyProxy,
  celestrakProxy,
  tomtomProxy,
  firmsProxy,
  rocketLaunchesProxy,
  terrainHeightsProxy,
  adsbdbProxy,
  overpassProxy,
  militaryInstallationsProxy,
  regionalBriefProxy,
  weatherEffectsProxy,
  cctvProxy,
  radioBrowserProxy,
  gbfsProxy,
  adsbLolProxy,
  aisLiveProxy,
  trackBackfillProxies,
  openAiRealtimeProxy,
  googlePlacesContextProxy,
  groqVoiceProxy,
} from '../server/proxies.js';

/**
 * Minimal connect replacement.
 *
 * Reimplements only what the proxies actually rely on: ordered middleware, an
 * optional mount path, and connect's mount-path rewriting — a handler mounted
 * at `/api/tomtom` sees `req.url` relative to that mount, so the prefix is
 * stripped before the call and restored afterwards. Getting that wrong would
 * make every mounted proxy misread its own path.
 */
function createMiddlewareStack() {
  const stack = [];
  return {
    use(pathOrFn, maybeFn) {
      if (typeof pathOrFn === 'function') stack.push({ mount: null, fn: pathOrFn });
      else stack.push({ mount: pathOrFn, fn: maybeFn });
      return this;
    },
    /** Run `req` through the stack; resolves once a handler responds. */
    async run(req, res) {
      const originalUrl = req.url;
      for (const { mount, fn } of stack) {
        if (mount && !matchesMount(originalUrl, mount)) continue;

        if (mount) {
          const rest = originalUrl.slice(mount.length);
          req.url = rest.startsWith('/') ? rest : `/${rest}`;
        } else {
          req.url = originalUrl;
        }

        const handled = await new Promise((resolve, reject) => {
          let settled = false;
          const next = (err) => {
            if (settled) return;
            settled = true;
            if (err) reject(err); else resolve(false);
          };
          res.once('finish', () => {
            if (settled) return;
            settled = true;
            resolve(true);
          });
          try {
            const out = fn(req, res, next);
            if (out && typeof out.catch === 'function') out.catch(next);
          } catch (err) {
            next(err);
          }
        });

        if (handled || res.writableEnded) {
          req.url = originalUrl;
          return true;
        }
      }
      req.url = originalUrl;
      return false;
    },
  };
}

/** True when `url`'s path segment matches the mount exactly or as a prefix. */
function matchesMount(url, mount) {
  const pathname = url.split('?')[0];
  if (pathname === mount) return true;
  return pathname.startsWith(mount.endsWith('/') ? mount : `${mount}/`);
}

/**
 * Install every proxy onto one stack, in the same order as the Vite plugin
 * array so the access gate stays ahead of the routes it protects.
 */
function buildStack() {
  const middlewares = createMiddlewareStack();
  const server = { middlewares, httpServer: null };
  const plugins = [
    accessGate(),
    openSkyProxy(),
    celestrakProxy(),
    tomtomProxy(),
    firmsProxy(),
    rocketLaunchesProxy(),
    terrainHeightsProxy(),
    adsbdbProxy(),
    overpassProxy(),
    militaryInstallationsProxy(),
    regionalBriefProxy(),
    weatherEffectsProxy(),
    cctvProxy(),
    radioBrowserProxy(),
    gbfsProxy(),
    adsbLolProxy(),
    aisLiveProxy(),
    trackBackfillProxies(),
    openAiRealtimeProxy(),
    googlePlacesContextProxy(),
    groqVoiceProxy(),
  ];
  for (const plugin of plugins) plugin?.configureServer?.(server);
  return middlewares;
}

// Built once per warm instance; rebuilding per request would drop the proxies'
// in-memory upstream caches and multiply calls to rate-limited providers.
let stack = null;

export default async function handler(req, res) {
  if (!stack) stack = buildStack();
  try {
    const handled = await stack.run(req, res);
    if (!handled && !res.writableEnded) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch {
    // Sanitized: never leak upstream error detail or the URL that produced it.
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Proxy error' }));
    }
  }
}

export { buildStack, createMiddlewareStack, matchesMount };
