import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ALL_MENU_FEATURES, menuFeatures, menuGroups, paletteHits, reachableHits } from './featureMenu.ts'
import { chooseVisible, everythingChoice, newChoice, readVisibility, setVisible, type VisibilityChoice } from './featureVisibility.ts'
import type { Readiness } from './commandCenter.ts'

/**
 * What the choice actually changes.
 *
 * `featureVisibility.test.ts` beside this one checks the classification and the one question. This checks the three
 * places the answer has to land, because a rule nobody applies is not a rule:
 *
 *  - the menu down the side shows what somebody chose, and no heading over nothing;
 *  - the box of everything still **finds** what they did not choose, says it is off, and turns it on;
 *  - nothing essential can vanish, whatever is in the file -- including a file that is nonsense.
 *
 * The last three tests read `App.tsx` and `Sidebar.tsx` as text. That is deliberate: the fault these are written
 * against is not a wrong answer from a function, it is a **new route added later that never asks the question** --
 * a slash command, a chord, a notification. Those are one-line additions in a 1,500-line component that no unit
 * test of a pure helper can see. `featureLauncher.test.ts` checks `App.tsx` the same way and says why.
 */

const root = resolve(import.meta.dirname, '..', '..')
const APP_TSX = join(root, 'src', 'renderer', 'src', 'App.tsx')
const SIDEBAR_TSX = join(root, 'src', 'renderer', 'src', 'components', 'Sidebar.tsx')

/** Everything is possible: what the window itself passes, because it IS the window. */
const READY: Readiness = { window: true, browser: true, task: true, helper: true, key: true, page: true }

const ids = (list: readonly { id: string }[]): string[] => list.map((one) => one.id)

// ---------------------------------------------------------------- the menu

test('the menu shows what was chosen, and nothing else', () => {
  const choice = chooseVisible(newChoice(), ['chess', 'markets'], 1).value
  const showing = ids(menuFeatures(choice))

  assert.ok(showing.includes('chess'), 'a screen that was chosen is not in the menu')
  assert.ok(showing.includes('markets'), 'a screen that was chosen is not in the menu')
  assert.ok(!showing.includes('cosmos'), 'a screen that was not chosen is in the menu anyway')
  // The essentials are there whatever was chosen: they were not in the list above and cannot be left out.
  assert.ok(showing.includes('notes') && showing.includes('clipboard'), 'an essential screen is missing from the menu')
})

test('a category with nothing showing leaves no heading behind', () => {
  const all = menuGroups(everythingChoice())
  const sport = all.find((group) => group.items.some((one) => one.id === 'f1'))
  assert.ok(sport, 'no category holds the sport screens, so this test is checking nothing')

  // Everything in that category off, and nothing else touched.
  const kept = ALL_MENU_FEATURES.filter((one) => one.category !== sport.id).map((one) => one.id)
  const choice = chooseVisible(newChoice(), kept, 1).value
  const groups = menuGroups(choice)

  assert.ok(
    !groups.some((group) => group.id === sport.id),
    'every screen in a category is switched off and the heading is still there, over nothing'
  )
  assert.ok(groups.every((group) => group.items.length > 0), 'a category with no screens in it is still in the menu')
  assert.ok(groups.length > 0, 'switching one category off emptied the whole menu')
})

test('nothing is claimed to be in the menu before the file has been read', () => {
  // Null is "not read yet". It must answer the essentials and nothing else -- never everything.
  const showing = ids(menuFeatures(null))
  assert.ok(showing.includes('notes'), 'an essential screen is missing while the choice is still being read')
  assert.ok(!showing.includes('chess'), 'a screen somebody may have switched off is offered before the file has been read')
})

// ---------------------------------------------------------------- the box of everything

test('a hidden screen is out of the menu and still found by name, said to be off', () => {
  const choice = chooseVisible(everythingChoice(), [...everythingChoice().shown].filter((id) => id !== 'chess'), 1).value

  assert.ok(!ids(menuFeatures(choice)).includes('chess'), 'Chess World is switched off and still in the menu')

  const hits = paletteHits('chess', READY, choice)
  const hit = hits.find((one) => one.feature === 'chess')
  assert.ok(hit, 'Chess World is switched off and the box of everything cannot find it, so there is no way to discover it')
  assert.equal(hit.off, true, 'a switched-off screen is found and not marked as switched off')
  assert.equal(hit.action, 'turn-on', 'a switched-off screen is found and pressing it does not turn it on')
  assert.equal(hit.why, null, 'being switched off is reported as a reason it cannot be used, when it is the one thing that can be fixed from here')
  assert.ok(/off/i.test(hit.detail), `the row says "${hit.detail}", which does not tell somebody it is switched off`)
  assert.ok(
    reachableHits(hits).includes(hit),
    'the row for a switched-off screen cannot be landed on, so Enter can never turn it on'
  )
})

test('turning it on puts it back in the menu', () => {
  const off = chooseVisible(everythingChoice(), [...everythingChoice().shown].filter((id) => id !== 'chess'), 1).value
  const back = setVisible(off, 'chess', true, 2)

  assert.equal(back.refused, null, `turning a screen on was refused: ${back.refused}`)
  assert.ok(ids(menuFeatures(back.value)).includes('chess'), 'a screen was switched back on and is not in the menu')

  const hit = paletteHits('chess', READY, back.value).find((one) => one.feature === 'chess')
  assert.ok(hit, 'a screen that is switched on cannot be found by name')
  assert.equal(hit.off, false, 'a screen that is switched on is still shown as off')
  assert.equal(hit.action, 'open', 'a screen that is switched on still offers to be turned on')
})

test('with nothing typed the box offers the menu, with nothing switched off among it', () => {
  const choice = chooseVisible(newChoice(), ['chess'], 1).value
  const hits = paletteHits('', READY, choice)

  assert.deepEqual(ids(hits), ids(menuFeatures(choice)), 'the box with nothing typed does not offer the same screens as the menu')
  assert.ok(hits.every((one) => one.off === false), 'the box offers a switched-off screen before anything has been typed')
})

test('a screen that is on but has nothing behind it says what is really in the way, and cannot be pressed', () => {
  // Arena is a way in to Football and F1. On, with both sports off, it is a heading over nothing.
  const choice = chooseVisible(newChoice(), ['arena'], 1).value
  const hit = paletteHits('arena', READY, choice).find((one) => one.feature === 'arena')

  assert.ok(hit, 'Arena cannot be found by name')
  assert.equal(hit.action, 'none', 'pressing Arena offers to turn on something that is already on')
  assert.ok(/football|f1|formula/i.test(hit.detail), `the row says "${hit.detail}", which does not name what is in the way`)
  assert.ok(!reachableHits([hit]).includes(hit), 'a row that cannot do anything can still be landed on')
})

test('a capability whose engine is missing still says so, and is not confused with being switched off', () => {
  const nothingRunning: Readiness = { window: true, browser: false, task: false, helper: false, key: false, page: false }
  const hits = paletteHits('ads', nothingRunning, everythingChoice())
  const stopped = hits.find((one) => one.why !== null)

  assert.ok(stopped, 'nothing in the registry reports being unusable with the browser shut, so this test is checking nothing')
  assert.equal(stopped.off, false, 'a capability that cannot run right now is reported as switched off, which it is not')
  assert.equal(stopped.action, 'none', 'a capability that cannot run right now can still be pressed')
})

// ---------------------------------------------------------------- nothing essential can vanish

test('a settings file Orbis cannot make sense of still leaves the chat, Settings and the way back', () => {
  for (const nonsense of ['not json at all', 42, [], { shown: 'everything' }, { version: 1, shown: [{}, 7, null] }, null]) {
    const read = readVisibility(nonsense, { settled: true })
    const showing = ids(menuFeatures(read.value))
    // The feature screens that have no switch. The core surfaces (the chat, Settings, the box itself) are not in
    // the menu at all -- they are the window -- and `featureVisibility.test.ts` checks `isVisible` answers for them.
    for (const must of ['notes', 'clipboard', 'workspaces', 'schedules']) {
      assert.ok(showing.includes(must), `a settings file of ${JSON.stringify(nonsense)} took ${must} out of the menu`)
    }
    assert.ok(menuGroups(read.value).length > 0, `a settings file of ${JSON.stringify(nonsense)} left no menu at all`)
  }
})

test('an essential screen refuses to be switched off, and the menu does not change', () => {
  const before = everythingChoice()
  for (const essential of ['chat', 'settings', 'palette', 'notes', 'clipboard', 'workspaces', 'schedules']) {
    const tried = setVisible(before as VisibilityChoice, essential, false, 1)
    assert.ok(tried.refused, `${essential} can be switched off, so somebody can lock themselves out of Orbis`)
    assert.deepEqual(ids(menuFeatures(tried.value)), ids(menuFeatures(before)), `switching ${essential} off was refused and the menu changed anyway`)
  }
})

// ---------------------------------------------------------------- every route asks the question

test('every way into a screen in App.tsx goes through the one guard', async () => {
  const app = await readFile(APP_TSX, 'utf8')
  /*
   * A screen opened by name, straight into the navigation reducer, is a route that never asks whether the person has
   * that screen switched on. There are a dozen of them -- slash commands, a chord, a pressed notification, a
   * schedule, a card in a reply -- and each is one line, so the only thing that keeps them honest is this.
   *
   * `arena` is the exception, and the only one: closing Football or F1 folds back into the Arena card it was opened
   * from, which is somewhere this person was already standing a moment ago.
   */
  const direct = [...app.matchAll(/go\(\{\s*kind: 'feature', id: '([a-z0-9]+)'/g)].map((m) => m[1]).filter((id) => id !== 'arena')
  assert.deepEqual(
    direct,
    [],
    'a screen is opened by name without asking whether it is switched on, so that route works on a screen somebody hid'
  )

  assert.ok(app.includes('const openFeature = useCallback'), 'the one guard every route goes through is no longer in App.tsx')
  assert.ok(/featureState\(id, await visibility\.settled\(\)\)/.test(app), 'the guard no longer waits for the saved choice, so it will answer out of a file it has not read')
})

test('a list of commands leaves out the ones that would land on a hidden screen', async () => {
  const { SLASH_COMMANDS, slashCommandsFor } = await import('../renderer/src/lib/commands.ts')
  const off = chooseVisible(everythingChoice(), [...everythingChoice().shown].filter((id) => id !== 'cosmos'), 1).value

  assert.ok(
    SLASH_COMMANDS.some((one) => one.feature === 'cosmos'),
    'no command says which screen it opens, so a list of commands cannot leave out the hidden ones',
  )
  assert.ok(!slashCommandsFor(off).some((one) => one.name === 'cosmos'), '/cosmos is still advertised with Cosmos switched off')
  assert.ok(slashCommandsFor(everythingChoice()).some((one) => one.name === 'cosmos'), '/cosmos is not advertised with Cosmos switched on')
  // The ones that are not about a screen are always there. /new and /settings are how somebody gets anywhere.
  for (const always of ['new', 'settings', 'help', 'shortcuts']) {
    assert.ok(slashCommandsFor(newChoice()).some((one) => one.name === always), `/${always} is missing from a new profile's commands`)
  }
})

test('the sidebar draws the menu it is handed, and cannot reach the full list', async () => {
  const sidebar = await readFile(SIDEBAR_TSX, 'utf8')
  assert.ok(sidebar.includes('props.features.map'), 'the sidebar no longer draws the menu it is handed')
  assert.ok(
    !/from '\.\.\/lib\/features'/.test(sidebar.replace(/import type [^\n]*features'/g, '')),
    'the sidebar imports the feature list again, so it can draw screens somebody switched off'
  )
  assert.ok(sidebar.includes('props.chanceShown'), 'the Chance row is drawn whatever somebody chose')
})
