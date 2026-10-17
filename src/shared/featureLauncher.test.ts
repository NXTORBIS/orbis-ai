import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CAPABILITIES, type AppFeature } from './commandCenter.ts'
import { FEATURE_FACTS, STARTING_IDS, everythingChoice, factsFor } from './featureVisibility.ts'
import { menuFeatures } from './featureMenu.ts'

/**
 * Every screen the window can open has a way in.
 *
 * The launcher is derived from the capability registry by `src/renderer/src/lib/features.ts`, and a capability is
 * dropped from it when its `app` has no icon in that file's `ICONS` map -- quietly, by design, so a missing icon is
 * a gap rather than a crash. `features.ts` says in its own header that "the test beside this file fails on it".
 * There was no test beside that file. So the one thing standing between a finished screen and nobody being able to
 * open it was a sentence in a comment.
 *
 * This is read as text rather than imported because `features.ts` pulls in lucide-react and React, and the test
 * runner here runs pure modules only. Reading the source is enough: what is being checked is whether a name is in
 * the map, and `settings.test.ts` checks `Board.tsx`'s key handling the same way.
 */

const root = resolve(import.meta.dirname, '..', '..')
const FEATURES = join(root, 'src', 'renderer', 'src', 'lib', 'features.ts')
const APP_TSX = join(root, 'src', 'renderer', 'src', 'App.tsx')

const appFeatures = (): AppFeature[] => [...new Set(CAPABILITIES.filter((one) => one.app).map((one) => one.app as AppFeature))]

test('every screen the registry says the window can open has an icon, so it appears in the launcher', async () => {
  const source = await readFile(FEATURES, 'utf8')
  const block = /const ICONS[^=]*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(source)
  assert.ok(block, 'the ICONS map in features.ts could not be found, so this test is checking nothing')
  const named = new Set([...block[1].matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1]))
  assert.ok(named.size > 10, `only ${named.size} icons were read out of the map, so the pattern has stopped matching`)

  const missing = appFeatures().filter((id) => !named.has(id))
  assert.deepEqual(missing, [], 'a capability says the window can open this screen and the launcher has no icon for it, so nothing in the sidebar offers it')
})

test('the launcher offers no screen the window cannot mount', async () => {
  const app = await readFile(APP_TSX, 'utf8')
  // Each screen is mounted as `feature === 'name' &&` in App.tsx's one return.
  const mounted = new Set([...app.matchAll(/feature === '([a-z0-9]+)'/g)].map((m) => m[1]))
  assert.ok(mounted.size > 10, `only ${mounted.size} mounted screens were found in App.tsx, so the pattern has stopped matching`)

  const offeredButNotMounted = appFeatures().filter((id) => !mounted.has(id))
  assert.deepEqual(
    offeredButNotMounted,
    [],
    'the launcher offers a screen App.tsx never mounts, so choosing it does nothing at all',
  )
})

/*
 * Both directions, now that a screen can be deliberately left out.
 *
 * People choose which screens are in their menu, so "this screen is not in the launcher" stopped being a fault on
 * its own -- which is exactly how a guard gets weakened into uselessness. What was really being guarded is that
 * **nothing is ever offered that cannot be opened, and nothing is ever unreachable by accident**. Switched off is
 * reachable: it is one Ctrl+K away, and `featureMenu.test.ts` is what holds that up. Missing from the
 * classification is reachable by nothing, which is the fault these three are written against.
 */

test('every screen the window can open is classified, so leaving it out of a menu is a choice rather than an accident', async () => {
  const unclassified = appFeatures().filter((id) => factsFor(id) === undefined)
  assert.deepEqual(
    unclassified,
    [],
    'a capability says the window can open this screen and featureVisibility.ts has no entry for it, so nobody can switch it on and nothing can say why it is missing',
  )

  // And the other way: nothing is classified as a feature screen that the window does not mount. A switch for a
  // screen that is not there is a switch somebody can turn on to no effect at all.
  const app = await readFile(APP_TSX, 'utf8')
  const mounted = new Set([...app.matchAll(/feature === '([a-z0-9]+)'/g)].map((m) => m[1]))
  const known = new Set<string>(appFeatures())
  const phantom = FEATURE_FACTS.filter((one) => known.has(one.id) && !mounted.has(one.id)).map((one) => one.id)
  assert.deepEqual(phantom, [], 'a feature screen can be switched on and App.tsx never mounts it, so the switch does nothing')
})

test('every screen a new profile starts with is one the window really mounts', async () => {
  const app = await readFile(APP_TSX, 'utf8')
  const mounted = new Set([...app.matchAll(/feature === '([a-z0-9]+)'/g)].map((m) => m[1]))
  const known = new Set<string>(appFeatures())
  // Only the feature screens: the rest of the starting set is the chat, the browser, Files, Settings and the box of
  // everything, which are the window itself rather than something it mounts.
  const starting = STARTING_IDS.filter((id) => known.has(id))
  assert.ok(starting.length > 0, 'a new profile starts with no feature screens at all, so this test is checking nothing')
  assert.deepEqual(
    starting.filter((id) => !mounted.has(id)),
    [],
    'a brand-new profile is given a screen the window cannot mount, so Orbis opens onto a menu row that does nothing',
  )
})

test('the box you type in offers no slash command for a screen you switched off', async () => {
  /*
   * The fourth door, and the one that was still open.
   *
   * The sidebar menu, the Ctrl+K box and the help list all ask `isVisible`. The "/" menu in the chat composer read
   * the whole command list instead, so somebody who had switched Courses off was still offered "/courses" in the
   * one place in Orbis they cannot look away from -- and pressing it would have opened a screen that is not in
   * their menu. `slashCommandsFor` in `lib/commands.ts` is the filtered list; this is what makes the composer use
   * it.
   *
   * Read as text because `Composer.tsx` is React and lucide, exactly as the icon map above is read.
   */
  const composer = await readFile(join(root, 'src', 'renderer', 'src', 'components', 'Composer.tsx'), 'utf8')
  assert.match(composer, /slashCommandsFor\(props\.visibility\)/, 'the composer builds its "/" menu from every command Orbis has, so it offers screens that are switched off')

  // And the honest answer when the command is typed out in full rather than picked from the menu. Doing nothing at
  // all, or sending "/chess" to Orion as a sentence, are the two wrong answers.
  assert.match(composer, /featureState\(command\.feature, props\.visibility\)/, 'a slash command typed out in full is run without asking whether its screen is switched on')
  assert.match(composer, /state\.hiddenBecause/, 'the composer knows the command is for a hidden screen and does not say so')
})

test('with everything switched on, the menu is every screen the launcher can draw', () => {
  const everything = menuFeatures(everythingChoice()).map((one) => one.id as string)
  assert.deepEqual(
    appFeatures().filter((id) => !everything.includes(id)),
    [],
    'a screen the registry says the window can open is missing from the menu even with everything switched on, so there is no way to choose it',
  )
})
