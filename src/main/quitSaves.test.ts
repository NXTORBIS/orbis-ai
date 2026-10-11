import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Nothing saves on the way out without being waited for.
 *
 * `app.on('before-quit', () => void store.flush())` starts a write and returns. The process is then free to end in
 * the middle of it, and several of these stores hold work for up to a second and a half before writing it at all --
 * so a note typed just before quitting was routinely lost. Not corrupted. Simply never written.
 *
 * `QuitFlush` fixed that by holding the close open, and twenty-three saves were moved onto it. Three were missed:
 * the Native Apps, Courses and Ambient Intelligence each kept an unawaited `void …flush()` in a bare `before-quit`
 * listener, which is the exact line `quitFlush.ts` was written to replace. Nothing caught it, because the fix was a
 * list of call sites somebody had to be thorough about.
 *
 * This is that thoroughness, written down. A save in a quit listener is a save nobody waits for, so the listener is
 * the wrong place for it, and this says so before it ships rather than after somebody loses an evening's work.
 */

const MAIN = join(fileURLToPath(new URL('.', import.meta.url)))

/** Calls that persist something. A quit listener may stop things; it may not be where they are saved. */
const SAVING = ['flush', 'flushSync', 'onQuit', 'shutdown', 'save', 'persist', 'write', 'commit']

/**
 * Calls allowed to go unwaited in a quit listener, each with the reason.
 *
 * This list may only shrink. Adding to it means arguing that the call writes nothing -- not that waiting for it is
 * inconvenient.
 */
const NOTHING_TO_SAVE: ReadonlyArray<{ call: string; because: string }> = [
  { call: 'searchService?.close()', because: 'closes a local HTTP listener; it holds nothing on disk' }
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
 * The body of each quit listener, as text.
 *
 * Braces are counted rather than matched with a regex, because a listener body contains braces of its own and a
 * regex that stops at the first `}` reads only the first line of a multi-line listener -- which is exactly the
 * shape that hides the fault.
 */
function quitListenerBodies(source: string): { body: string }[] {
  const bodies: { body: string }[] = []
  const opener = /app\.on\(\s*'(?:before-quit|will-quit|quit)'\s*,/g
  for (const match of source.matchAll(opener)) {
    const from = match.index + match[0].length
    const open = source.indexOf('{', from)
    if (open === -1) continue
    let depth = 0
    let end = open
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth += 1
      else if (source[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    bodies.push({ body: source.slice(open, end + 1) })
  }
  return bodies
}

test('nothing is saved in a quit listener, where nobody waits for it', async () => {
  const allowed = new Set(NOTHING_TO_SAVE.map((one) => one.call))
  const offenders: string[] = []

  for (const file of await typescriptFiles(MAIN)) {
    const source = await readFile(file, 'utf8')
    if (!source.includes("app.on('before-quit'") && !source.includes("app.on('will-quit'") && !source.includes("app.on('quit'")) continue
    for (const { body } of quitListenerBodies(source)) {
      for (const line of body.split('\n')) {
        const code = line.trim()
        if (!code.startsWith('void ') && !code.startsWith('return ')) continue
        const call = code.replace(/^(?:void|return)\s+/, '').replace(/\.catch\(.*$/, '').replace(/\.then\(.*$/, '').trim()
        if (allowed.has(call)) continue
        const verb = SAVING.find((one) => call.includes(`${one}(`))
        if (verb) offenders.push(`${file.slice(MAIN.length)}: ${code}`)
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These start a save inside a quit listener and do not wait for it, so the process can end mid-write.\n` +
      `Register them with \`quitFlush.add('what it is, in plain words', () => …)\` instead, which holds the close\n` +
      `open until the save finishes.\n\n${offenders.join('\n')}`
  )
})

test('every allowance says why, so none of them is just a silenced failure', () => {
  for (const one of NOTHING_TO_SAVE) {
    assert.ok(one.call.length > 0)
    assert.ok(one.because.length > 20, `${one.call} needs a real reason, not a label`)
  }
})

test('a multi-line listener really is read to the end, so this test can fail', () => {
  // The fault the brace counting prevents: the three real offenders were all on the SECOND line of their listener,
  // after a `stop()` call. A reader that stopped at the first `}` saw none of them.
  const pretend = [
    "app.on('before-quit', () => {",
    '  thing?.stopEverything()',
    '  void thing?.flush().catch(() => undefined)',
    '})'
  ].join('\n')
  const [found] = quitListenerBodies(pretend)
  assert.ok(found.body.includes('flush()'), 'the body must include the line after the first closing brace')
})
