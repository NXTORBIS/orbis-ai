/**
 * Vite configuration for OrbisEye — a cinematic geospatial app.
 *
 * The /api/* proxy middlewares that make up the application's backend live in
 * server/proxies.js, NOT here. They were moved out so something other than Vite
 * can mount them: api/[...path].js imports that module directly to serve the
 * same routes from a serverless function. This file is now just the Vite wiring
 * — plugin registration, dev-server host/port, and the client-exposed defines.
 *
 * @module vite.config
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import cesium from 'vite-plugin-cesium';
import {
  alsoPreview,
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
} from './server/proxies.js';

// The proxy helpers used to be declared in this file and are imported from here
// by a number of unit tests. Re-export them so moving the implementation into
// server/proxies.js stays a pure relocation for every existing caller.
export * from './server/proxies.js';

/** Resolve __dirname for ESM context. */
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Main Vite configuration factory.
 *
 * Loads .env files via Vite's loadEnv, registers Cesium + the local proxy
 * plugins, configures the dev server host/port, and exposes selected API keys
 * to the client as import.meta.env defines.
 */
export default defineConfig(({ mode }) => {
  // Load only this checkout's dotenv files. Shell/Keychain values still win,
  // and no sibling workspace is consulted implicitly.
  const loaded = loadEnv(mode, __dirname, '');
  for (const [key, val] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = val;
  }
  const env = { ...process.env };
  return {
    plugins: [
      // First in the list so its middleware installs ahead of every proxy.
      accessGate(),
      cesium(),
      // Every /api proxy serves `vite preview` as well as the dev server, so a
      // built deployment keeps its data layers instead of 404ing them. Plugins
      // that already declare a preview hook pass through untouched.
      ...[
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
      ].map(alsoPreview),
    ],
    server: {
      host: env.HOST || 'localhost',
      port: parseInt(env.PORT, 10) || 5173,
      // When binding to all interfaces, allow any host; otherwise restrict to local names
      allowedHosts: (env.HOST === '0.0.0.0' || env.HOST === '::')
        ? true
        : ['localhost', '127.0.0.1', '.local'],
    },
    // Expose selected API keys to the browser via import.meta.env.*
    define: {
      'import.meta.env.GOOGLE_MAPS_API_KEY': JSON.stringify(env.GOOGLE_MAPS_API_KEY),
      'import.meta.env.CESIUM_ION_TOKEN': JSON.stringify(env.CESIUM_ION_TOKEN),
    },
    build: {
      // The Cesium engine bundle is inherently large; raise the warning ceiling
      // so the build log isn't dominated by an expected chunk-size notice.
      chunkSizeWarningLimit: 1500,
    },
  };
});
