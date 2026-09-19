// Bundles the Orbis extension's ad-blocking worker and page script (they use the same Ghostery engine as Electron Orbis).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shared = { bundle: true, minify: true, legalComments: 'none', target: 'chrome120', logLevel: 'info', absWorkingDir: root }
await build({ ...shared, entryPoints: ['extension-src/worker.ts'], outfile: 'extension/adblock.js', format: 'esm', platform: 'browser' })
await build({ ...shared, entryPoints: ['extension-src/content.ts'], outfile: 'extension/adblock-content.js', format: 'iife', platform: 'browser' })
