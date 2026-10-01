// Bundles the Orbis extension's ad-blocking worker and page script (they use the same Ghostery engine as Electron Orbis).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shared = { bundle: true, minify: true, legalComments: 'none', target: 'chrome120', logLevel: 'info', absWorkingDir: root }
await build({ ...shared, entryPoints: ['extension-src/worker.ts'], outfile: 'extension/adblock.js', format: 'esm', platform: 'browser' })
await build({ ...shared, entryPoints: ['extension-src/content.ts'], outfile: 'extension/adblock-content.js', format: 'iife', platform: 'browser' })
// The response-pruning layer. Runs in the PAGE's world (see the manifest), which is the only place it can see the
// globals and the JSON.parse that the page itself uses -- an isolated content script cannot.
await build({ ...shared, entryPoints: ['extension-src/prune-main.ts'], outfile: 'extension/adblock-prune.js', format: 'iife', platform: 'browser' })
await build({ ...shared, entryPoints: ['orbis-ui/panel/sidebar.ts'], outfile: 'orbis-ui/panel/sidebar.js', format: 'iife', platform: 'browser' })
await build({ ...shared, entryPoints: ['orbis-ui/results/results.ts'], outfile: 'orbis-ui/results/results.js', format: 'iife', platform: 'browser' })
// The capability registry the Command Center reads. Built from src/shared, so the page and the app share one list.
await build({ ...shared, minify: false, entryPoints: ['orbis-ui/panel/command-registry.ts'], outfile: 'orbis-ui/panel/command-registry.js', format: 'esm', platform: 'browser' })
// The starfield, drawn by the same shared code the chat draws it with, so both halves of Orbis look like one thing.
await build({ ...shared, minify: false, entryPoints: ['orbis-ui/newtab/backdrop-mount.ts'], outfile: 'orbis-ui/newtab/backdrop-mount.js', format: 'esm', platform: 'browser' })
// The omnibox's prediction UI. Built from src/shared so the merge the page uses is the merge that is tested, and left
// unminified because it is read in the browser's own devtools as often as it is run.
await build({ ...shared, minify: false, entryPoints: ['orbis-ui/panel/omnibox-ui.ts'], outfile: 'orbis-ui/panel/omnibox-ui.js', format: 'esm', platform: 'browser', external: ['./omnibox-native.js'] })
// The Orb's voice entry. The browser's toolbar microphone has no page of its own to record in, so it asks the Orb's
// page, which uses the one voice pipeline Orbis has. External `./helper.js` for the same reason the omnibox is.
await build({ ...shared, minify: false, entryPoints: ['orbis-ui/orb/voice.ts'], outfile: 'orbis-ui/orb/voice.js', format: 'esm', platform: 'browser', external: ['./helper.js'] })
