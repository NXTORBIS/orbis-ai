// Downloads the baseline filter lists that ship with Orbis (resources/adblock), so ad blocking works on first run and
// offline. Orbis also updates these lists by itself at runtime; run this before a release to refresh the bundled copy:
//   node scripts/update-filter-lists.mjs
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources', 'adblock')
const catalog = JSON.parse(await readFile(join(out, 'catalog.json'), 'utf8'))

await mkdir(join(out, 'lists'), { recursive: true })
const manifest = { version: new Date().toISOString(), lists: {} }
// Lists without a URL (Orbis's own compatibility rules) are maintained in resources/adblock directly.
for (const list of [...catalog.lists.filter((l) => l.url), catalog.resources]) {
  const res = await fetch(list.url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`${list.id}: HTTP ${res.status}`)
  const text = await res.text()
  if (/^\s*<(!doctype|html)/i.test(text)) throw new Error(`${list.id}: got an HTML page instead of a list`)
  const file = `${list.id}.txt`
  await writeFile(join(out, 'lists', file), text)
  manifest.lists[list.id] = { file, checksum: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }
  console.log(`${list.id.padEnd(28)} ${(Buffer.byteLength(text) / 1024).toFixed(0).padStart(6)} KB`)
}
await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Baseline filter lists saved (${manifest.version}).`)
