// Unpacks jarvis-export.json (made by scripts/jarvis-export-console.js) into a folder of real files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

const [input, outDir] = process.argv.slice(2)
if (!input || !outDir) {
  console.error('usage: node scripts/jarvis-unpack.mjs <jarvis-export.json> <output folder>')
  process.exit(1)
}
const root = resolve(outDir)
const { files, count } = JSON.parse(readFileSync(input, 'utf8'))
let written = 0
for (const [path, content] of Object.entries(files)) {
  const target = resolve(join(root, path))
  if (!target.startsWith(root + sep)) continue // never outside the folder
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
  written++
}
console.log(`unpacked ${written} of ${count} files into ${root}`)
