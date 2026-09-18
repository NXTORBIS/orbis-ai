import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * The migration map, kept honest.
 *
 * `docs/ipc-mapping.md` says what every way the Orbis interface asks the application for something becomes in
 * Chromium. A map like that is worth nothing the moment it stops matching the code, and over a migration this long it
 * would stop within days. So it is checked: every channel in the code must be in the map, and every channel in the map
 * must still exist in the code.
 *
 * When this fails, the fix is to write down what the new channel becomes — not to delete the test.
 */

const ROOT = join(import.meta.dirname, '..')
const MAP = join(ROOT, '..', 'docs', 'ipc-mapping.md')

async function* typescriptFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* typescriptFiles(path)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) yield path
  }
}

/** Every channel the main process answers. */
async function channelsInCode(): Promise<string[]> {
  const found = new Set<string>()
  for await (const file of typescriptFiles(join(ROOT, 'main'))) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*'([^']+)'/g)) found.add(match[1])
  }
  return [...found].sort()
}

/** Every channel named in the map, which writes them as `code` spans. */
async function channelsInMap(): Promise<Set<string>> {
  const text = await readFile(MAP, 'utf8')
  const found = new Set<string>()
  for (const match of text.matchAll(/`([a-z@][a-zA-Z0-9@/:-]*:[a-zA-Z0-9/-]+)`/g)) found.add(match[1])
  // The adblocker's own page-side channels are written with a slash rather than a colon.
  for (const match of text.matchAll(/`(@ghostery\/adblocker\/[a-z-]+)`/g)) found.add(match[1])
  return found
}

test('every way the interface asks for something is written down in the migration map', async () => {
  const code = await channelsInCode()
  const map = await channelsInMap()
  const missing = code.filter((channel) => !map.has(channel))
  assert.deepEqual(
    missing,
    [],
    `these exist in the code but not in docs/ipc-mapping.md. Say what each becomes in Chromium:\n  ${missing.join('\n  ')}`
  )
})

test('the map does not describe channels that no longer exist', async () => {
  const code = new Set(await channelsInCode())
  const map = await channelsInMap()
  // Only the ones that look like our own channels. The map also names Chromium classes, which are written the C++
  // way with a double colon — `content::WebContents` is not a channel.
  const ours = [...map].filter((name) => !name.includes('::') && /^(?:@ghostery|[a-z-]+:)/.test(name))
  const gone = ours.filter((channel) => !code.has(channel))
  assert.deepEqual(gone, [], `the map describes channels the code no longer has; remove them:\n  ${gone.join('\n  ')}`)
})

test('the boundary is a known size, so the migration can be estimated rather than guessed', async () => {
  const code = await channelsInCode()
  assert.ok(code.length > 50, 'the boundary should be substantial; if this drops sharply, something was deleted by accident')
  // A ceiling as well as a floor: the boundary should shrink as the migration goes, never grow by accident.
  // Raised deliberately for the specialized search provider, the reading list and saved pages, the browser sidebar,
  // asking the system which browser opens links, and the secrets vault. Each is written down in the map above.
  // 130 → 137: seven channels for goals worked through one step at a time (start, read, pause, resume, stop, skip,
  // and telling Orbis a challenge has been dealt with).
  // 137 → 139: weather and news for the new tab's widgets.
  // 139 → 135: Google sign-in removed. Orbis keeps everything locally and has no account.
  // 135 → 149: learned skills (saved from step-by-step runs, reused through the workflow engine).
  // 149 → 156: memory, kept per profile on this computer.
  // 156 → 162: saved Orion Search sessions.
  // 162 → 167: Galaxy.
  // 167 → 169: switching kinds of browser action off for Orion.
  // 169 → 174: local Whisper speech to text — cancelling a transcription, reading this machine's hardware, and
  // managing model files (status, download, cancel a download, delete, verify) — replacing the single Groq call
  // voice:transcribe used to make on its own.
  assert.ok(code.length <= 174, `the boundary has grown to ${code.length} channels. New ones are fine, but they are new work — check that is intended.`)
})
