import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Every test Orbis has is a test Orbis runs.
 *
 * `npm test` names its files one by one, which is deliberate -- several of them drive a real browser and have to run
 * one at a time, in an order that works. The cost of naming them is that writing a test is not enough to have it run,
 * and a test nobody runs is worse than no test: it looks like coverage.
 *
 * So this is the list checking itself. Add a test file and this fails until it is in the script; delete one and this
 * fails until it is out.
 */

const ROOTS = ['src', 'orbis-ui', 'scripts']
const SUFFIXES = ['.test.ts', '.test.tsx', '.test.mjs', '.test.js']
const SKIP = new Set(['node_modules', 'dist', 'out', 'generated', '.git'])

async function testFilesUnder(directory: string): Promise<string[]> {
  const found: string[] = []
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP.has(entry.name)) continue
      found.push(...(await testFilesUnder(join(directory, entry.name))))
    } else if (SUFFIXES.some((s) => entry.name.endsWith(s))) {
      found.push(join(directory, entry.name).replaceAll('\\', '/'))
    }
  }
  return found
}

test('every test file on disk is one npm test runs', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
  const listed = new Set(
    manifest.scripts.test
      .split(/\s+/)
      .filter((word) => word.includes('.test.'))
      .map((word) => word.replaceAll('\\', '/'))
  )

  const onDisk: string[] = []
  for (const root of ROOTS) onDisk.push(...(await testFilesUnder(root)))

  const unrun = onDisk.filter((file) => !listed.has(file)).sort()
  assert.deepEqual(
    unrun,
    [],
    `these test files exist but npm test never runs them, so they prove nothing:\n  ${unrun.join('\n  ')}`
  )
})

test('every test file npm test names is one that exists', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
  const listed = manifest.scripts.test
    .split(/\s+/)
    .filter((word) => word.includes('.test.'))
    .map((word) => word.replaceAll('\\', '/'))

  const onDisk = new Set<string>()
  for (const root of ROOTS) for (const file of await testFilesUnder(root)) onDisk.add(file)

  // A named file that has been moved or deleted stops the whole run before the rest of the suite gets a chance.
  const missing = listed.filter((file) => !onDisk.has(file)).sort()
  assert.deepEqual(missing, [], `npm test names files that are not there:\n  ${missing.join('\n  ')}`)

  const seen = new Set<string>()
  const twice = listed.filter((file) => (seen.has(file) ? true : (seen.add(file), false)))
  assert.deepEqual(twice, [], `named more than once:\n  ${twice.join('\n  ')}`)
})
