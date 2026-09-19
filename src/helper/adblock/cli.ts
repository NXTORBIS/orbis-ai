import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { FilterStore, type Catalog } from '../../main/adblock/store.ts'
import { buildAdblockAssets } from './build.ts'

/**
 * Downloads (or reuses) Orbis's filter lists with the same FilterStore Electron Orbis uses — checksums, validation, keeping
 * the previous set, recovery — then builds what the Chromium extension enforces.
 *
 *   node --experimental-strip-types src/helper/adblock/cli.ts [--update] [--data-dir <dir>] [--out <extension/adblock>]
 */
const args = process.argv.slice(2)
const value = (name: string, fallback: string): string => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const repo = resolve(import.meta.dirname, '../../..')
const dataDir = value('--data-dir', join(homedir(), '.orbis', 'adblock'))
const out = value('--out', join(repo, 'extension', 'adblock'))
const bundledDir = join(repo, 'resources', 'adblock')

const catalog = JSON.parse(await readFile(join(bundledDir, 'catalog.json'), 'utf8')) as Catalog
const store = new FilterStore({ dir: dataDir, bundledDir, catalog, fetchFn: (url, init) => fetch(url, init) })
let loaded = await store.load()
if (loaded.empty || args.includes('--update')) {
  const result = await store.update()
  console.log(`lists: ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.failed.length} failed`)
  for (const f of result.failed) console.log(`  failed ${f.id}: ${f.reason}`)
  loaded = await store.load()
}
if (loaded.empty) throw new Error('no filter lists are available, so nothing was built')
if (loaded.recovered) console.log(`note: ${loaded.recovered}`)
const index = await buildAdblockAssets(catalog, loaded, out)
console.log(`built ${out}`)
for (const [id, r] of Object.entries(index.rulesets)) console.log(`  ruleset ${id.padEnd(16)} ${r.rules} rules`)
console.log(`  engines ${Object.entries(index.engines).map(([k, v]) => `${k} ${(v / 1e6).toFixed(1)}MB`).join(', ')}; popup hosts ${index.popupHosts}`)
