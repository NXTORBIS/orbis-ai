/**
 * Embeddable OrbisEye server for desktop hosts (Electron, Tauri sidecar, etc).
 *
 * OrbisEye's backend is Vite plugin middleware — 24 /api/* routes in
 * server/proxies.js covering flights, satellites, terrain, CCTV, radio and the
 * voice stack. Pointing a BrowserWindow at index.html therefore yields the
 * shell with every data layer 404ing. This boots the real server in-process so
 * the embedded app behaves exactly like the standalone one.
 *
 * Usage from an Electron main process:
 *
 *   import { startOrbisEye } from './desktop-server.mjs';
 *   const orbis = await startOrbisEye();          // picks a free port
 *   win.loadURL(orbis.url);
 *   app.on('before-quit', () => orbis.close());
 *
 * Or standalone, printing the URL on stdout:
 *
 *   node desktop-server.mjs
 *
 * @module desktop-server
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Start OrbisEye and return its URL plus a shutdown handle.
 *
 * @param {object} [options]
 * @param {number} [options.port] 0 (default) asks the OS for a free port, which
 *   avoids colliding with whatever else the host app is running.
 * @param {string} [options.host] Loopback by default: the server brokers API
 *   keys, so it must not be reachable from the network unless asked for.
 * @param {Record<string,string>} [options.env] Extra env vars applied before
 *   startup — use this to inject GROQ_API_KEYS etc. from the host's own store
 *   instead of shipping a .env file.
 * @returns {Promise<{url: string, port: number, close: () => Promise<void>}>}
 */
export async function startOrbisEye({ port = 0, host = '127.0.0.1', env = {} } = {}) {
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== null) process.env[key] = String(value);
  }

  const server = await createServer({
    root: here,
    configFile: path.join(here, 'vite.config.js'),
    // Vite resolves .env relative to this, and the proxies read process.env.
    envDir: here,
    server: { host, port, strictPort: false },
    // A desktop host has no terminal to watch; keep startup output quiet.
    logLevel: 'warn',
    clearScreen: false,
  });

  await server.listen();

  const address = server.httpServer?.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`;

  return {
    url,
    port: actualPort,
    close: () => server.close(),
  };
}

// Standalone: `node desktop-server.mjs` prints the URL and stays up.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 0;
  startOrbisEye({ port })
    .then(({ url }) => {
      process.stdout.write(`${url}\n`);
    })
    .catch((error) => {
      process.stderr.write(`OrbisEye failed to start: ${error?.message || error}\n`);
      process.exit(1);
    });
}
