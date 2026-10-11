import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ORBIS_BUILTIN_ORIGINS } from './browserManager.ts'

/**
 * Every Orbis page that talks to the helper is a page the helper will answer.
 *
 * The helper refuses any request whose origin is not in `ORBIS_BUILTIN_ORIGINS`, and a page left out has no way
 * to say so. Its requests fail at the door, and the only thing it knows about a request that does not come back
 * is that Orbis might not be running -- so that is what it says.
 *
 * It has happened twice. The Orb was left out, and the comment in Chromium's own check still records it: "served,
 * drawn and opened, and then told Orbis was not running". Then the market strip, which said the same thing for as
 * long as it existed, in a browser where the panel beside it was being answered perfectly well.
 *
 * Both halves of that fault look right on their own. The page imports the helper client and works. The list is a
 * list of real origins. Only together is anything wrong, so this is the test that holds them together.
 */

const UI = join(import.meta.dirname, '..', '..', '..', 'orbis-ui')

/** Which `chrome://` host each folder under orbis-ui is served as. */
const SERVED_AS: Readonly<Record<string, string>> = Object.freeze({
  panel: 'chrome://orbis',
  newtab: 'chrome://orbis-newtab',
  results: 'chrome://orbis-search',
  orb: 'chrome://orbis-orb',
  lock: 'chrome://orbis-lock',
  ticker: 'chrome://orbis-ticker'
})

/** Whether anything in a folder reaches for the helper client. */
async function talksToTheHelper(folder: string): Promise<boolean> {
  let entries: string[]
  try {
    entries = await readdir(join(UI, folder))
  } catch {
    return false
  }
  for (const name of entries) {
    if (!name.endsWith('.js') && !name.endsWith('.ts') && !name.endsWith('.html')) continue
    const source = await readFile(join(UI, folder, name), 'utf8')
    if (/from ['"]\.\/helper\.js['"]|import\(['"]\.\/helper\.js['"]\)/.test(source)) return true
  }
  return false
}

test('every Orbis page that asks the helper anything is one the helper will answer', async () => {
  const missing: string[] = []
  for (const [folder, origin] of Object.entries(SERVED_AS)) {
    if (!(await talksToTheHelper(folder))) continue
    if (!ORBIS_BUILTIN_ORIGINS.includes(origin)) missing.push(`${folder} is served as ${origin} and is not allowed`)
  }
  assert.deepEqual(
    missing,
    [],
    'These pages import the helper client and the helper will refuse them, which they can only report as Orbis not running:\n  ' +
      missing.join('\n  ') +
      '\nAdd the origin to ORBIS_BUILTIN_ORIGINS in browserManager.ts, and to IsOrbisHost in the fork’s orbis_ui.cc.'
  )
})

test('the list names real pages, so it cannot rot into origins nothing is served at', () => {
  const known = new Set(Object.values(SERVED_AS))
  for (const origin of ORBIS_BUILTIN_ORIGINS) {
    assert.ok(known.has(origin), `${origin} is allowed and is not a page under orbis-ui; either it moved or the list is stale`)
  }
})
