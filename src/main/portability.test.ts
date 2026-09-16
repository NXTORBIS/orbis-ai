import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The boundary, enforced.
 *
 * Orbis is moving to a browser built from Chromium. Most of it — profiles, workspaces, personalization, widgets,
 * notes, tasks, workflows, updates, Orion, and everything shared — has no business knowing which engine it runs on,
 * and is meant to survive that move unchanged. This test is what keeps that true while the migration is under way: it
 * fails the moment one of those files reaches for Electron again.
 *
 * The browser layer is a different matter. It is supposed to talk to the engine, and is expected to be rewritten, so
 * it is listed here as allowed rather than silently ignored.
 */

const ROOT = join(import.meta.dirname, '..')

/** Must never touch Electron: this is the part that moves to Chromium as it is. */
const PORTABLE = ['shared', 'main/update', 'main/personal', 'main/experience', 'main/workflows']

/** Talks to the engine on purpose, and is rewritten against Chromium. Listed so the list itself stays honest. */
const BROWSER_LAYER = new Set([
  'main/adblock/electron.ts',
  'main/browserAgent.ts',
  'main/browserControl/mainCapabilities.ts',
  'main/browserControl/page.ts',
  'main/browserControl/pageCapabilities.ts',
  'main/browserControl/setup.ts',
  'main/browserControl/uiCapabilities.ts',
  'main/browserControl/window.ts',
  'main/browserIntegration.ts',
  'main/deviceChooser.ts',
  'main/extensions/bridge.ts',
  'main/extensions/manager.ts',
  'main/imagegen.ts',
  'main/index.ts',
  'main/platformElectron.ts',
  // The adapters between Orbis's services and however the application talks to its window. Rewritten as Mojo.
  'main/experience/ipc.ts',
  'main/personal/ipc.ts',
  'main/workflows/ipc.ts',
  'main/workflows/recorder.ts'
])

async function* typescriptFiles(dir: string, prefix = ''): AsyncGenerator<{ path: string; relative: string }> {
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      yield* typescriptFiles(`${dir}/${entry.name}`, relative)
      continue
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      yield { path: join(ROOT, dir, entry.name), relative }
    }
  }
}

const importsElectron = (source: string): boolean => /from ['"]electron['"]|require\(['"]electron['"]\)/.test(source)

test('the parts of Orbis meant to survive the move do not touch Electron', async () => {
  const offenders: string[] = []
  for (const area of PORTABLE) {
    for await (const file of typescriptFiles(area)) {
      const relative = file.relative.replace(/\\/g, '/')
      if (BROWSER_LAYER.has(relative)) continue
      if (importsElectron(await readFile(file.path, 'utf8'))) offenders.push(relative)
    }
  }
  assert.deepEqual(offenders, [], `these are meant to move to Chromium unchanged, so they cannot import Electron:\n  ${offenders.join('\n  ')}`)
})

test('everything that does touch Electron is a file we have decided will be rewritten', async () => {
  const unexpected: string[] = []
  for await (const file of typescriptFiles('main')) {
    const relative = file.relative.replace(/\\/g, '/')
    if (BROWSER_LAYER.has(relative)) continue
    if (importsElectron(await readFile(file.path, 'utf8'))) unexpected.push(relative)
  }
  assert.deepEqual(
    unexpected,
    [],
    `new Electron use appeared outside the browser layer. Either write it against a platform interface, or add it to BROWSER_LAYER deliberately:\n  ${unexpected.join('\n  ')}`
  )
})

test('the browser layer list describes files that really exist, so it cannot rot', async () => {
  const present = new Set<string>()
  for await (const file of typescriptFiles('main')) present.add(file.relative.replace(/\\/g, '/'))
  const missing = [...BROWSER_LAYER].filter((name) => !present.has(name))
  assert.deepEqual(missing, [], `these are listed as browser layer but no longer exist; remove them from the list:\n  ${missing.join('\n  ')}`)
})

test('the parts meant to survive can be counted, so progress is visible rather than claimed', async () => {
  let portable = 0
  let coupled = 0
  for await (const file of typescriptFiles('main')) {
    const relative = file.relative.replace(/\\/g, '/')
    if (BROWSER_LAYER.has(relative)) coupled++
    else portable++
  }
  for await (const _ of typescriptFiles('shared')) portable++
  // A floor rather than an exact number, so ordinary work does not break the test; it moves as the migration does.
  assert.ok(portable > coupled, `more of Orbis should be free of the engine than tied to it (${portable} free, ${coupled} tied)`)
})
