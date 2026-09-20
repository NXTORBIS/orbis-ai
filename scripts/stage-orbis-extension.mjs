// Copies the Orbis component extension (extension/ minus dev-only and superseded files) into <chromium out dir>/resources/orbis_extension,
// where the browser's component loader reads it (chrome/browser/extensions/component_loader.cc). Run after `node scripts/build-extension.mjs`
// and `node --experimental-strip-types src/helper/adblock/cli.ts`; stage-chromium.mjs then ships it with the rest of `resources`.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'

const from = join(process.cwd(), 'extension')
const out = process.env.ORBIS_CHROMIUM_OUT || 'C:/chromium/src/out/Default'
const to = join(out, 'resources', 'orbis_extension')
if (!existsSync(join(from, 'adblock', 'index.json'))) throw new Error('The ad blocker is not built (run src/helper/adblock/cli.ts and scripts/build-extension.mjs).')
rmSync(to, { recursive: true, force: true })
mkdirSync(to, { recursive: true })
// The panel is built into the browser now (orbis-ui/panel), so its files are not part of the extension; tests and per-run state are not shipped.
const skip = (source) => /^(_metadata|helper\.json|panel.*|.*\.test\.mjs)$/.test(basename(source))
cpSync(from, to, { recursive: true, filter: (source) => !skip(source) })
console.log('staged', to)
