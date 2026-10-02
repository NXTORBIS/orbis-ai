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
const PORTABLE = ['shared', 'main/update', 'main/personal', 'main/experience', 'main/workflows', 'main/knowledge', 'main/temporal', 'helper', 'main/chromium', 'main/artifacts']

/** Talks to the engine on purpose, and is rewritten against Chromium. Listed so the list itself stays honest. */
const BROWSER_LAYER = new Set([
  'main/browserAgent.ts',
  // The one Electron file of the Creation Engine: the channel, the sender check, and the save dialog, handed into the
  // service as a function. The service and the store know nothing about windows, so this file is rewritten as Mojo
  // and SelectFileDialog and nothing else moves.
  'main/artifacts/ipc.ts',
  'main/browserControl/appCapabilities.ts',
  'main/browserControl/page.ts',
  'main/browserControl/pageCapabilities.ts',
  'main/browserControl/setup.ts',
  'main/browserControl/uiCapabilities.ts',
  // Reads a page to tell a verification challenge from a page, and scrolls one into view. Pure Chromium work either
  // way: it is a content script and a scroll, which is what the renderer does anyway.
  'main/browserControl/captchaCapabilities.ts',
  'main/browserControl/window.ts',
  // Registering Orbis as a browser and opening the system's chooser. Chromium does exactly this in shell_integration,
  // and by then Orbis is an application Windows already knows about.
  'main/defaultBrowser.ts',
  // Moving a profile between machines. The exporter, importer, providers and encryption all take their filesystem
  // as a parameter and touch nothing; this one file fills those parameters in and runs the save/open dialogs. It is
  // the whole Electron surface of the feature, on purpose, and what it does -- read files, write files, ask where --
  // is the part Chromium has its own way of doing.
  'main/portable/ipc.ts',
  // The adapter between the reading index and however the application talks to its window, and nothing else: it
  // coerces arguments and delegates. The index itself, the capture rules and every decision about what may be kept
  // are in files with no Electron in them, so the feature travels and this one file is rewritten as Mojo.
  'main/knowledge/recallIpc.ts',
  // The adapter between schedules and however the application talks to its window. It coerces arguments and
  // delegates; every decision about time, every policy and every refusal is in files with no Electron in them, so
  // the scheduler travels and this one file is rewritten as Mojo.
  'main/temporal/ipc.ts',
  'main/imagegen.ts',
  // The app's own library (shortcuts, address-bar memory) for the Orbis window.
  'main/libraryIpc.ts',
  'main/index.ts',
  'main/platformElectron.ts',
  // The adapters between Orbis's services and however the application talks to its window. Rewritten as Mojo.
  'main/experience/ipc.ts',
  'main/personal/ipc.ts',
  'main/workflows/ipc.ts',
  // Tab Lock's adapter, and the only part of it that knows about Electron: `ipcMain` for the channels, `powerMonitor`
  // for the computer's own lock and sleep, and the window for focus and minimise. In Chromium those become Mojo and
  // Chromium's own session and widget observers. Everything Tab Lock decides is deliberately elsewhere and portable --
  // `shared/tabLock.ts`, `main/tabLockStore.ts`, `main/tabLockWatcher.ts` and `main/tabLock/reconcile.ts` import nothing
  // from Electron, which is why the move is a rewrite of this one file rather than of the feature.
  'main/tabLock/ipc.ts',
  // Profile Lock's adapter, and the only part of it that knows about Electron: `ipcMain` for its three channels,
  // `powerMonitor` for the computer's own lock, unlock, sleep and wake and for how long it has been idle, and the window
  // for focus. `shared/profileLock.ts` and `main/profileLockWatcher.ts` import nothing from Electron.
  'main/profileLock/ipc.ts',
  // Markets' adapter to the window. `ipcMain` only; the engine, the store, the providers and every calculation are
  // Electron-free and move to Chromium unchanged.
  'main/markets/ipc.ts',
  // The Pages host: the one file that turns a sandbox policy into an actual frame. `WebContentsView` for the frame,
  // `protocol.handle` for the Page's own origin, `ipcMain` for the single channel a Page talks on, and the session
  // handlers that refuse navigation, new windows, permission prompts and downloads. In Chromium this becomes a
  // `WebContents` delegate plus a `URLLoaderFactory`.
  //
  // What it enforces it does not decide: the runtime policy, the content policy and the message broker are all in
  // `shared/pages/sandbox.ts`, and everything about serving a Page's files -- the path-traversal defence, the media
  // types, the headers -- is in `main/pages/serving.ts`. Neither imports Electron, and both are tested.
  'main/pages/host.ts',
  // Orbis Pages' adapter to the window, and the only part of Pages that knows Electron exists: `ipcMain` for its
  // seventeen channels and nothing else. In Chromium it becomes a WebUI message handler plus a Mojo interface.
  //
  // Everything that decides anything is deliberately on the other side of this line: the register, the manifest
  // validation, the capability and permission engine, the identity and address rules, and every computational engine
  // import nothing from Electron and move unchanged. That is what makes `pages:compute` a boundary worth having -- the
  // rule it enforces lives in `shared/pages/capabilities.ts`, so porting this file cannot change what a Page is allowed
  // to do.
  'main/pages/ipc.ts'
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
