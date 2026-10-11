import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Every channel asks who is asking.
 *
 * A channel registered with `ipcMain.handle` answers **any** renderer in this process, not just the Orbis window.
 * So every one of them has to establish that the message came from somewhere allowed, and most do -- either
 * through `ipc/handle.ts`, which does it by construction, or through a check written in the handler.
 *
 * Thirteen did not, and they were not the harmless ones. `library:get` returned the mirrored copy of Chromium's own
 * history, bookmarks and downloads along with everything the address bar remembers. `library:download-action`
 * opened a downloaded file with whatever the system opens it with, from a small whole number. Four `music:player-*`
 * messages carried the position a track resumes from, what counts as a play, and what the recommender is built on.
 *
 * None of that was found by reading the code; it was found by a sweep. This is that sweep, so the next one is
 * found on the day it is written. `ALLOWED` is the list of registrations that may answer anybody, each carrying
 * the reason -- and it may only ever get shorter.
 *
 * **What this cannot tell you.** It checks that a check exists, not that the check is right, and it says nothing
 * at all about the helper's own channels: those are a separate namespace, served over a local websocket to the
 * browser's own pages and gated by a bearer token and an origin allowlist in `src/helper/auth.ts`, not by this.
 */

const MAIN = fileURLToPath(new URL('.', import.meta.url))

/**
 * Registrations allowed to answer any renderer, and why.
 *
 * This list may only shrink. A new entry needs an argument that the channel discloses nothing and changes nothing
 * -- not that checking it is inconvenient.
 */
const ALLOWED: ReadonlyArray<{ channel: string; because: string }> = []

/** Ways of establishing who sent a message. Anything here, anywhere in the handler, counts as having asked. */
const ASKS = [
  'event.sender',
  'fromOrbisWindow(',
  // The local predicates: one line each, all of them `event.sender === the window's webContents`.
  'mine(event',
  'fromWindow(event',
  'isOurs(event',
  'fromPlayer(event',
  // Orbis Pages are stricter than any of the above: the Page's identity is a WeakMap lookup on the sender, so a
  // Page cannot claim to be a different Page -- there is nowhere in a message to put the claim.
  'owner.get(event.sender'
]

async function typescriptFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await typescriptFiles(path)))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path)
  }
  return found
}

/**
 * Local helpers in this file whose own body asks who is asking.
 *
 * Needed because a registration is often `ipcMain.handle('x:y', someCall(...))`, where `someCall` is a wrapper
 * declared a few lines up. Looking only at the handler written inline reports those as unchecked -- which is how a
 * first pass over this came back with a hundred and eight offenders instead of thirteen.
 */
function askingHelpers(source: string): string[] {
  const found: string[] = []
  for (const match of source.matchAll(/(?:const|function)\s+([A-Za-z_][\w]*)\s*[=(]/g)) {
    // Up to the next declaration at the same level, not a fixed window: a 1,200-character window reaches into the
    // NEXT helper, so a function declared just above one that checks was credited with the check. That made the
    // first version of this test miss `settings:update` -- a channel that writes every setting.
    const after = source.slice(match.index + match[0].length)
    const nextDeclaration = after.search(/\n(?: {2})?(?:const|function|export) /)
    const body = after.slice(0, nextDeclaration === -1 ? 1200 : nextDeclaration)
    if (ASKS.some((one) => body.includes(one))) found.push(match[1])
  }
  return found
}

/** The whole second argument of a call, by counting brackets rather than finding the next one. */
function argumentsOf(source: string, from: number): string {
  let depth = 1
  for (let i = from; i < source.length; i++) {
    if (source[i] === '(') depth += 1
    else if (source[i] === ')') {
      depth -= 1
      if (depth === 0) return source.slice(from, i)
    }
  }
  return source.slice(from)
}

interface Registration {
  channel: string
  where: string
  asks: boolean
}

async function registrations(): Promise<Registration[]> {
  const found: Registration[] = []
  for (const file of await typescriptFiles(MAIN)) {
    const where = relative(MAIN, file).split(sep).join('/')
    // `ipc/handle.ts` IS the check. It registers nothing of its own.
    if (where.startsWith('ipc/')) continue
    const source = await readFile(file, 'utf8')
    const helpers = askingHelpers(source)
    const constants = new Map<string, string>()
    for (const match of source.matchAll(/(?:const|let)\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) constants.set(match[1], match[2])
    for (const match of source.matchAll(/ipcMain\.(?:handle|on)\(\s*('[^']+'|[A-Z][A-Z0-9_]*)\s*,/g)) {
      const raw = match[1]
      const channel = raw.startsWith("'") ? raw.slice(1, -1) : (constants.get(raw) ?? raw)
      const rest = argumentsOf(source, match.index + match[0].length)
      // A helper counts only when it is CALLED in the registration, not merely mentioned: `store.saveConversation`
      // must not be credited with a check because something else called `store` has one.
      const asks = ASKS.some((one) => rest.includes(one)) || helpers.some((one) => new RegExp(`\\b${one}\\s*\\(`).test(rest))
      found.push({ channel, where, asks })
    }
  }
  return found
}

test('every channel the main process registers directly asks who is asking', async () => {
  const allowed = new Set(ALLOWED.map((one) => one.channel))
  const all = await registrations()
  // A floor, not a target. It falls as families move onto `plainHandle`/`profileHandle`, which do not register
  // through `ipcMain` directly and so are not counted here -- they are checked by construction instead. It fell
  // from 166 to 86 when `registerIpc`'s forty-five and the vault's twenty-three moved, and from 47 to 39 when the
  // eight voice channels became `whisper/ipc.ts`. What it guards against is the scan silently stopping, which is
  // the failure that would make this whole test pass while seeing nothing at all.
  assert.ok(all.length > 25, `only ${all.length} registrations found -- the scan has stopped seeing them`)
  const silent = all
    .filter((one) => !one.asks && !allowed.has(one.channel))
    .map((one) => `${one.where}: ${one.channel}`)
    .sort()
  assert.deepEqual(
    silent,
    [],
    `These answer any renderer in this process, not only the Orbis window. Register them through\n` +
      `\`plainHandle\`/\`profileHandle\` from \`ipc/handle.ts\`, or check the sender in the handler:\n  ${silent.join('\n  ')}`
  )
})

test('the list of channels allowed to answer anybody only ever gets shorter', async () => {
  const all = await registrations()
  const names = new Set(all.map((one) => one.channel))
  const gone = ALLOWED.filter((one) => !names.has(one.channel)).map((one) => one.channel)
  assert.deepEqual(gone, [], `these are in ALLOWED and no longer registered; remove them:\n  ${gone.join('\n  ')}`)
  const nowChecked = ALLOWED.filter((one) => all.some((reg) => reg.channel === one.channel && reg.asks)).map((one) => one.channel)
  assert.deepEqual(nowChecked, [], `these check the sender now and must come out of ALLOWED:\n  ${nowChecked.join('\n  ')}`)
  for (const one of ALLOWED) {
    assert.ok(one.because.length > 20, `${one.channel} needs a real reason, not a label`)
  }
})

test('a wrapper a few lines above the registration counts, so this does not cry wolf', () => {
  // The reason a first pass reported a hundred and eight offenders instead of thirteen: most of the main process
  // registers through a local wrapper -- `vaultCall`, `accountCall`, `stepCall`, `memoryCall`, `searchCall` -- and
  // the check lives in the wrapper, not in the handler written at the registration.
  const pretend = [
    "const vaultCall = (run) => async (event) => {",
    "  if (event.sender !== mainWindow?.webContents) throw new Error('Not allowed.')",
    '  return run()',
    '}',
    "ipcMain.handle('vault:status', vaultCall(() => vault.status()))"
  ].join('\n')
  const helpers = askingHelpers(pretend)
  assert.ok(helpers.includes('vaultCall'), 'the wrapper must be recognised as asking')
})
