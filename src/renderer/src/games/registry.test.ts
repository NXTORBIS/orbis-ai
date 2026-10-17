import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { GAMES } from '../../../shared/offlineGames.ts'
import { CAPABILITIES } from '../../../shared/commandCenter.ts'
import { factsFor } from '../../../shared/featureVisibility.ts'
import { CHOICE_GROUPS } from '../../../shared/featureChoiceGroups.ts'

/**
 * The arcade's two promises, checked as code rather than believed.
 *
 * The first is the catalogue's: every game it names can really be played. The catalogue is pure data in
 * `shared/offlineGames.ts` and is drawn in two places -- the Arcade screen and the games panel in Settings -- so a
 * name in it with no game behind it is a card somebody presses and nothing happens, which is the one thing a list of
 * games must never be.
 *
 * The second is the door's: the Arcade is a screen the window can be asked to open. For most of this product's life
 * it was not. The games, the engine and the catalogue were all in the tree, the Settings panel listed all
 * thirty-two of them, and there was no way in at all -- so the only route to a game was a web page failing to load.
 * A screen with no door is indistinguishable from a screen that does not exist.
 *
 * `index.ts` is read as text, not imported. It is renderer code whose imports have no file extensions and whose
 * games touch the canvas, and this test runs on plain node with no browser anywhere near it.
 */

const here = dirname(fileURLToPath(import.meta.url))
const loaders = readFileSync(join(here, 'index.ts'), 'utf8')

/** Each `'id': () => import('./file')` line in the registry, as the pair it really is. */
const registered = new Map(
  [...loaders.matchAll(/'?([a-zA-Z0-9-]+)'?:\s*\(\)\s*=>\s*import\('\.\/(\w+)'\)/g)].map((one) => [one[1], one[2]])
)

test('every game the catalogue names has a loader behind it', () => {
  const unplayable = GAMES.filter((one) => !registered.has(one.id)).map((one) => one.name)
  assert.deepEqual(unplayable, [], 'the catalogue is promising games that cannot be opened')
})

test('every loader has a game file on disk', () => {
  const missing = [...registered].filter(([, file]) => !existsSync(join(here, `${file}.ts`))).map(([id]) => id)
  assert.deepEqual(missing, [], 'a loader points at a file that is not there')
})

test('nothing is playable that the catalogue has never heard of', () => {
  const named = new Set<string>(GAMES.map((one) => one.id))
  const orphans = [...registered.keys()].filter((id) => !named.has(id))
  assert.deepEqual(orphans, [], 'a game nobody can find is a game nobody plays')
})

test('the arcade is a screen the window can be asked to open', () => {
  const capability = CAPABILITIES.find((one) => one.app === 'arcade')
  assert.ok(capability, 'no capability opens the arcade, so it is in no menu and in no search box')
  assert.equal(capability?.target.kind, 'app', 'the arcade opens in the window, not as a page or a panel view')
})

test('the arcade is a choice somebody can switch on, and is offered as one', () => {
  assert.equal(factsFor('arcade')?.standing, 'optional')
  const offered = CHOICE_GROUPS.some((group) => group.ids.includes('arcade'))
  assert.ok(offered, 'an optional screen under no heading can never be turned on')
})
