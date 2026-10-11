import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * How much of the window's styling is still written by hand, as a number.
 *
 * "Did the duplication actually go down" is the question the shared controls were built to answer, and until now
 * the only answer was somebody's impression. This counts: selectors per part, and -- the part that matters -- how
 * many title rows, empty messages and search boxes are still declared outside `ui/`.
 *
 * It prints and exits 0 always. It is a measurement, not a gate: `uiAdoption.test.ts` is the gate, and it holds a
 * list that may only shrink. This is for seeing the shape of what is left.
 *
 *   node scripts/cssReport.mjs
 *   node scripts/cssReport.mjs --by-kind
 */

const ROOT = join(fileURLToPath(import.meta.url), '..', '..')
const PARTS = join(ROOT, 'src/renderer/src/styles/parts')
const byKind = process.argv.includes('--by-kind')

/** The three things the shared controls exist to stop being rewritten. */
const KINDS = [
  { name: 'title rows', test: /-(?:head|header)\b/ },
  { name: 'empty messages', test: /-(?:empty|none)\b/ },
  { name: 'search boxes', test: /-search\b/ }
]

const files = readdirSync(PARTS)
  .filter((name) => name.endsWith('.css'))
  .sort()

let selectors = 0
let lines = 0
const handMade = []

for (const name of files) {
  const text = readFileSync(join(PARTS, name), 'utf8')
  // Comments out first: a class name mentioned in prose is not a declaration.
  const code = text.replace(/\/\*(?:[^*]|\*(?!\/))*\*\//g, '')
  const found = new Set()
  for (const match of code.matchAll(/\.([a-z][a-z0-9]*(?:-[a-z0-9]+)+)/g)) found.add(match[1])
  selectors += found.size
  lines += text.split('\n').length
  for (const one of found) {
    const kind = KINDS.find((k) => k.test.test(one))
    // `ui/` owns these three; everything else declaring one is a copy of something that already exists.
    if (kind && !name.includes('ui-')) handMade.push({ name: one, kind: kind.name, file: name })
  }
  if (!byKind) console.log(`${String(found.size).padStart(4)} selectors  ${name}`)
}

console.log(`\n${files.length} parts, ${lines} lines, ${selectors} class selectors`)

if (byKind) {
  for (const kind of KINDS) {
    const mine = handMade.filter((one) => one.kind === kind.name)
    console.log(`\n${mine.length} ${kind.name} outside ui/`)
    for (const one of mine.sort((a, b) => (a.name < b.name ? -1 : 1))) console.log(`  ${one.name.padEnd(28)} ${one.file}`)
  }
} else {
  for (const kind of KINDS) {
    console.log(`${String(handMade.filter((one) => one.kind === kind.name).length).padStart(4)} ${kind.name} declared outside ui/`)
  }
  console.log('\n  --by-kind lists them')
}
