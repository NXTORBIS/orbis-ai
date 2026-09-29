import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Every test Orbis has is a test Orbis runs.
 *
 * The suite names its files one by one, in `scripts/testFiles.mjs`, which is deliberate -- several of them drive a
 * real browser and have to run one at a time, in an order that works, which a glob would not preserve. The cost of
 * naming them is that writing a test is not enough to have it run, and a test nobody runs is worse than no test: it
 * looks like coverage.
 *
 * So this is the list checking itself. Add a test file and this fails until it is in the list; delete one and this
 * fails until it is out.
 *
 * The list used to live in the npm script. It moved when it grew past the 32 KB a Windows command line holds, at
 * which point the whole suite stopped running with a message about the command line and nothing about tests --
 * which is exactly the kind of silent nothing-ran this file exists to prevent.
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

async function listedFiles(): Promise<string[]> {
  const { TEST_FILES } = (await import('../../scripts/testFiles.mjs')) as { TEST_FILES: string[] }
  return TEST_FILES.map((one) => one.replaceAll('\\', '/'))
}

test('every test file on disk is one npm test runs', async () => {
  const listed = new Set(await listedFiles())

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

test('npm test actually runs the list', async () => {
  // The list is only a list. If the script stopped pointing at the runner that reads it, every check above would
  // still pass while nothing ran at all -- which is the failure this whole file exists to catch.
  const manifest = JSON.parse(await readFile('package.json', 'utf8')) as { scripts: Record<string, string> }
  assert.match(
    manifest.scripts.test,
    /scripts\/runTests\.mjs/,
    'the test script no longer invokes scripts/runTests.mjs, so the file list it checks may not be the one being run'
  )
})
