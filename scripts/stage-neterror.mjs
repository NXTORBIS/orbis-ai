// Puts Orbis's offline game into the browser's own error page.
//
// The error page belongs to Chromium (components/neterror/resources), not to Orbis, so it is not one of the pages
// scripts/sync-orbis-panel.ps1 copies. It takes two files -- the bundled game and its stylesheet -- which the page
// pulls in with a plain <link> and <script src>. Grit flattens both into the page at build time, so neither needs a
// resource id of its own and neither needs a line in a .grd.
//
// Run after scripts/build-extension.mjs, which is what writes orbis-ui/offline/offline.js.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = process.env.ORBIS_CHROMIUM_SRC || 'C:/chromium/src'
const to = join(src, 'components', 'neterror', 'resources')

if (!existsSync(to)) throw new Error(`No Chromium checkout at ${src} (set ORBIS_CHROMIUM_SRC).`)
const game = join(root, 'orbis-ui', 'offline', 'offline.js')
if (!existsSync(game)) throw new Error('orbis-ui/offline/offline.js is not built (node scripts/build-extension.mjs).')

mkdirSync(to, { recursive: true })
copyFileSync(game, join(to, 'orbis_offline.js'))
copyFileSync(join(root, 'orbis-ui', 'offline', 'offline.css'), join(to, 'orbis_offline.css'))
console.log('staged the offline game into', to)
