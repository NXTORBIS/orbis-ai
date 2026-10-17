import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * Every stylesheet a component imports has to be on disk.
 *
 * TypeScript does not resolve a stylesheet import, so `import './endgames.css'` against a file that does not exist
 * typechecks perfectly and then fails the production build -- `Could not resolve "./endgames.css"` -- with nothing
 * else in the tree mentioning it. That is exactly what happened: the Endgame Lab was the only one of Chess World's
 * fourteen folders with no stylesheet, the screen had never been opened, and `npm run build` had been refusing to
 * bundle the whole renderer because of it.
 *
 * `npm run build` would also catch this, which is the point: this catches it in a second rather than two minutes
 * into a build, and it names the file.
 */

const root = resolve(import.meta.dirname, '..', '..')
const LOOKS_LIKE = /import\s+['"](\.[^'"]+\.css)['"]/g

async function sourceFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue
      found.push(...(await sourceFiles(path)))
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path)
    }
  }
  return found
}

test('every stylesheet the window imports really exists', async () => {
  const files = await sourceFiles(join(root, 'src', 'renderer'))
  assert.ok(files.length > 100, `only ${files.length} source files were found, so this test is looking in the wrong place`)

  const missing: string[] = []
  let checked = 0
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const match of text.matchAll(LOOKS_LIKE)) {
      checked += 1
      const target = resolve(dirname(file), match[1])
      if (!existsSync(target)) missing.push(`${file.slice(root.length + 1).replace(/\\/g, '/')} imports ${match[1]}, which is not there`)
    }
  }

  assert.ok(checked > 50, `only ${checked} stylesheet imports were found, so the pattern has stopped matching and this test is checking nothing`)
  assert.deepEqual(missing, [], 'a component imports a stylesheet that does not exist, so the whole renderer will refuse to build')
})
