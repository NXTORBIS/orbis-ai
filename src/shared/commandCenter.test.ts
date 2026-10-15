import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, CATEGORIES, LANES, MAX_PINS, addPin, addressFor, canPin, capabilitiesIn, capabilityById, movePin, normalizePins, removePin, scoreCapability, searchCapabilities, unavailableBecause } from './commandCenter.ts'
import type { Readiness } from './commandCenter.ts'

const all: Readiness = { browser: true, task: true, helper: true, key: true, page: true }
const nothing: Readiness = { browser: false, task: false, helper: false, key: false, page: false }

// ---------------------------------------------------------------- the registry itself

test('every capability is whole: no blank names, descriptions, icons or targets', () => {
  for (const c of CAPABILITIES) {
    assert.ok(c.id && c.name && c.description && c.icon, `${c.id} is missing something`)
    assert.ok(CATEGORIES.some((k) => k.id === c.category), `${c.id} is in a category that does not exist`)
    assert.ok(c.target && c.target.kind, `${c.id} has nowhere to go`)
  }
})

test('ids are unique, because a duplicate would make one of them unreachable', () => {
  const ids = CAPABILITIES.map((c) => c.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('every category holds something, so no part of the Command Center opens empty', () => {
  for (const category of CATEGORIES) {
    assert.ok(capabilitiesIn(category.id).length > 0, `${category.id} has no capabilities`)
  }
})

test('only capabilities with a real toolbar action are pinnable', () => {
  // These are the ones chrome/browser/ui/browser_actions.cc actually registers. Marking anything else pinnable would
  // offer a pin that could never become a button.
  const withActions = ['ask', 'search', 'galaxy', 'workflows', 'notes', 'music', 'tasks', 'adblock', 'secrets', 'account']
  for (const c of CAPABILITIES) {
    assert.equal(canPin(c), withActions.includes(c.id), `${c.id} is marked pinnable=${c.pinnable}`)
  }
})

// ---------------------------------------------------------------- availability

test('a capability says which thing is missing, not just that it is missing', () => {
  assert.equal(unavailableBecause(capabilityById('workflows')!, all), null)
  assert.match(unavailableBecause(capabilityById('workflows')!, { ...all, helper: false })!, /not running/)
  assert.match(unavailableBecause(capabilityById('secrets')!, { ...all, helper: false })!, /not running/)
  assert.match(unavailableBecause(capabilityById('tabs')!, { ...all, browser: false })!, /not connected/)
  assert.match(unavailableBecause(capabilityById('zoom')!, { ...all, page: false })!, /no page/)
})

test('Orion has no key is still reported as that, and not as something else', () => {
  // Back on "Ask Orion", where it belongs. For a while this had to be checked on another row: the #ask view that row
  // opens had never been written, so it reported the missing screen first -- the right answer for that row, and the
  // wrong test for this. The screen exists now, so the missing key is the first thing in the way again.
  assert.match(unavailableBecause(capabilityById('ask')!, { ...all, key: false })!, /no key/)
  assert.match(unavailableBecause(capabilityById('adblock')!, { ...all, helper: false })!, /not running/)
})

test('the three Orion rows open a screen that is really there', () => {
  // Ask Orion, Summarise this page and Do something on this page all open the panel's #ask view, and for a long time
  // the panel had no such view: all three were drawn as live rows and clicking one redrew the Command Center. The
  // view is a section of orbis-ui/panel/index.html now, which commandCenterDestinations.test.ts checks by reading the
  // markup. Here the claim is the narrower one: with everything running, none of them has anything in the way.
  for (const id of ['ask', 'orbSummarise', 'browserTask']) {
    assert.equal(unavailableBecause(capabilityById(id)!, all), null, `${id} still says it cannot be used`)
  }
  // And each of them still names what it needs, rather than being offered whatever the state of the world.
  assert.match(unavailableBecause(capabilityById('orbSummarise')!, { ...all, page: false })!, /no page/)
  /*
   * It depends on the task host, not merely on the browser answering. Those were one flag, and five rows about
   * tabs and navigation said "the browser is not connected" while the views behind them listed the open tabs.
   */
  assert.match(unavailableBecause(capabilityById('browserTask')!, { ...all, task: false })!, /cannot act in the browser/)
  assert.equal(unavailableBecause(capabilityById('browserTask')!, { ...all, browser: false }), null, 'it does not need the tab list')
  // And the rows that are about the tab list do need it, and do not need the task host.
  assert.match(unavailableBecause(capabilityById('tabs')!, { ...all, browser: false })!, /not connected/)
  assert.equal(unavailableBecause(capabilityById('tabs')!, { ...all, task: false }), null, 'listing tabs is not a task')
})

test('with nothing running, nothing claims to be usable', () => {
  for (const c of CAPABILITIES) {
    assert.notEqual(unavailableBecause(c, nothing), null, `${c.id} claimed to work with nothing running`)
  }
})

// ---------------------------------------------------------------- finding things

test('the obvious answer comes first', () => {
  assert.equal(searchCapabilities('notes', all)[0].capability.id, 'notes')
  assert.equal(searchCapabilities('workflow', all)[0].capability.id, 'workflows')
  assert.equal(searchCapabilities('galaxy', all)[0].capability.id, 'galaxy')
  assert.equal(searchCapabilities('secrets', all)[0].capability.id, 'secrets')
})

test('the words people actually use find the thing they mean', () => {
  assert.equal(searchCapabilities('ads', all)[0].capability.id, 'adblock')
  assert.equal(searchCapabilities('password', all)[0].capability.id, 'secrets')
  assert.equal(searchCapabilities('theme', all)[0].capability.id, 'customize')
  assert.equal(searchCapabilities('todo', all)[0].capability.id, 'tasks')
  assert.equal(searchCapabilities('ai', all)[0].capability.id, 'ask')
})

test('several words all have to land somewhere', () => {
  assert.equal(searchCapabilities('block ads', all)[0].capability.id, 'adblock')
  assert.equal(searchCapabilities('nothing like this exists at all', all).length, 0)
})

test('an empty search returns nothing rather than everything', () => {
  assert.deepEqual(searchCapabilities('', all), [])
  assert.deepEqual(searchCapabilities('   ', all), [])
})

test('searching is not case-sensitive', () => {
  assert.equal(searchCapabilities('WORKFLOWS', all)[0].capability.id, 'workflows')
})

test('something that cannot be used is still found, and says why', () => {
  const hit = searchCapabilities('ads', { ...all, helper: false })[0]
  assert.equal(hit.capability.id, 'adblock')
  assert.match(hit.unavailable!, /not running/)
})

test('a name beats a description that merely mentions the word', () => {
  // "Screenshots" is described as pictures of pages; typing "notes" must still find Notes first.
  assert.ok(scoreCapability(capabilityById('notes')!, 'notes') > scoreCapability(capabilityById('screenshots')!, 'notes'))
})

test('results are capped, so the list stays a list', () => {
  assert.ok(searchCapabilities('a', all, 3).length <= 3)
})

// ---------------------------------------------------------------- where things open

test('a panel capability opens at its own address', () => {
  assert.equal(addressFor(capabilityById('workflows')!), 'chrome://orbis/#workflows')
  assert.equal(addressFor(capabilityById('history')!), 'chrome://history/')
})

// ---------------------------------------------------------------- pins

test('pinning adds, and adding twice changes nothing', () => {
  const first = addPin([], 'workflows')
  assert.deepEqual(first, { ok: true, pins: ['workflows'] })
  assert.deepEqual(addPin(['workflows'], 'workflows'), { ok: true, pins: ['workflows'] })
})

test('something without a toolbar action is refused by name', () => {
  const r = addPin([], 'screenshots')
  assert.equal(r.ok, false)
  assert.match((r as { error: string }).error, /cannot go on the toolbar/)
})

test('an unknown id is refused rather than pinned', () => {
  assert.equal(addPin([], 'nonsense').ok, false)
})

test('the toolbar has a limit and says so', () => {
  let pins: string[] = []
  for (const id of ['ask', 'search', 'galaxy', 'workflows', 'notes', 'tasks']) {
    const r = addPin(pins, id)
    assert.equal(r.ok, true, `${id} should pin`)
    pins = (r as { pins: string[] }).pins
  }
  assert.equal(pins.length, MAX_PINS)
  const full = addPin(pins, 'adblock')
  assert.equal(full.ok, false)
  assert.match((full as { error: string }).error, /Remove one first/)
})

test('unpinning takes out only the one asked for', () => {
  assert.deepEqual(removePin(['ask', 'notes'], 'ask'), ['notes'])
})

test('order is kept, and moving past either end leaves it alone', () => {
  const pins = ['ask', 'notes', 'tasks']
  assert.deepEqual(movePin(pins, 'ask', -1), pins)
  assert.deepEqual(movePin(pins, 'tasks', 1), pins)
  assert.deepEqual(movePin(pins, 'ask', 1), ['notes', 'ask', 'tasks'])
})

test('a saved order drops what is no longer pinnable, and never duplicates', () => {
  assert.deepEqual(normalizePins(['ask', 'screenshots', 'ask', 'gone', 'notes']), ['ask', 'notes'])
  assert.deepEqual(normalizePins(null), [])
  assert.deepEqual(normalizePins('what'), [])
})

test('a saved order cannot exceed the toolbar', () => {
  const many = ['ask', 'search', 'galaxy', 'workflows', 'notes', 'music', 'tasks', 'adblock', 'secrets', 'account']
  assert.equal(normalizePins(many).length, MAX_PINS)
})

// ---------------------------------------------------------------- doing, rather than going

test('a capability that does something has no address, and is not given one', () => {
  const copy = capabilityById('copyLink')!
  assert.equal(copy.target.kind, 'do')
  // A plausible-looking address would let a caller navigate to it and land on a page that does nothing.
  assert.equal(addressFor(copy), '')
})

test('every "do" capability names a handler, and no two name the same one', () => {
  const doers = CAPABILITIES.filter((c) => c.target.kind === 'do')
  assert.ok(doers.length > 0)
  const messages = doers.map((c) => (c.target as { message: string }).message)
  for (const m of messages) assert.match(m, /^orbis\.[a-z][A-Za-z.]+$/, `${m} is not a handler name`)
  assert.equal(new Set(messages).size, messages.length)
})

test('copying a link is not offered where there is no page to copy', () => {
  const copy = capabilityById('copyLink')!
  assert.equal(unavailableBecause(copy, all), null)
  // On a new tab or a built-in page there is no address worth copying, and the row says so rather than copying
  // chrome://orbis and calling it the link.
  assert.equal(unavailableBecause(copy, { ...all, page: false }), 'There is no page to act on')
  assert.equal(unavailableBecause(copy, { ...all, browser: false }), 'The browser is not connected')
})

test('somebody looking for it finds it, by either of the words they would use', () => {
  for (const words of ['copy', 'copy link', 'link', 'url', 'clipboard', 'share']) {
    const found = searchCapabilities(words, all).map((h) => h.capability.id)
    assert.ok(found.includes('copyLink'), `"${words}" does not find it`)
  }
})

test('it is not offered for the toolbar, because no toolbar button exists for it', () => {
  // `pinnable` is a claim about chrome/browser/ui/browser_actions.cc. Marking it true would put a button in the
  // Command Center that could never become a button on the toolbar.
  assert.equal(canPin(capabilityById('copyLink')!), false)
})

/*
 * The lanes, which are how the panel is laid out.
 *
 * Eleven categories all open at once made the panel one endless scroll -- roughly 1,800px, still cut off at the
 * ninth heading. The lanes are the errand rather than the subsystem, and these hold them to being that: a lane
 * nobody can fill is a heading over nothing, and a capability in no lane is the eighteen-dead-rows bug coming
 * back in a new shape -- a thing the registry knows about that the panel will never draw.
 */
test('every capability is in exactly one lane, and every lane is one Orbis knows', () => {
  const known = new Set(LANES.map((one) => one.id))
  const missing = CAPABILITIES.filter((one) => !known.has(one.lane)).map((one) => one.id)
  assert.deepEqual(missing, [], 'these would be filed under a heading the panel does not draw')
})

test('no lane is a heading over nothing, and none is a second endless scroll', () => {
  const counts = new Map(LANES.map((one) => [one.id, 0]))
  for (const one of CAPABILITIES) counts.set(one.lane, (counts.get(one.lane) ?? 0) + 1)
  const thin = [...counts].filter(([, n]) => n < 4).map(([id, n]) => `${id}: ${n}`)
  assert.deepEqual(thin, [], 'a lane with three things in it is a heading, not a place -- fold it into another')
  const fat = [...counts].filter(([, n]) => n > 16).map(([id, n]) => `${id}: ${n}`)
  assert.deepEqual(fat, [], 'a lane this big is the scroll the lanes exist to end')
})

test('the lane a person would look in is the one it is in', () => {
  // Spot checks, written as the errand rather than as the category. Each of these crosses a category boundary,
  // which is the whole reason the lanes exist: "where did that go" is one errand whether the answer is a tab, a
  // download or a screenshot, and those sit in three different categories.
  const laneOf = (id: string): string | undefined => CAPABILITIES.find((one) => one.id === id)?.lane
  for (const id of ['tabs', 'history', 'downloads', 'recall', 'media']) {
    assert.equal(laneOf(id), 'find', `${id} answers "where did that go"`)
  }
  for (const id of ['ask', 'orbSummarise', 'adblock', 'copyLink', 'screenshots']) {
    assert.equal(laneOf(id), 'page', `${id} acts on the page in front of you`)
  }
  for (const id of ['notes', 'tasks', 'music', 'secrets', 'workflows']) {
    assert.equal(laneOf(id), 'keep', `${id} is something of yours`)
  }
})

test('an icon identifies one thing, or it identifies nothing', () => {
  /*
   * Measured before this was fixed: 21 of 45 capabilities wore an icon that another one also wore -- four used
   * `privacy`, three used `student`, and Ask Orion and Summarise this page were the same glyph. In a grid of
   * icons that is half the grid saying nothing. Settings deep links are exempt: they are a list of rows inside
   * one lane, read by their names, and Chromium's own settings pages do not have twelve distinct marks either.
   */
  const shared = new Map<string, string[]>()
  for (const one of CAPABILITIES) {
    if (one.id.startsWith('settings.')) continue
    shared.set(one.icon, [...(shared.get(one.icon) ?? []), one.name])
  }
  const clashes = [...shared].filter(([, names]) => names.length > 1).map(([icon, names]) => `${icon}: ${names.join(', ')}`)
  assert.deepEqual(clashes, [], 'two capabilities wearing one icon means neither is identified by it')
})

test('a screen the window has is offered by the window, whatever the browser is doing', () => {
  // `needs` describes what the BROWSER side of a capability requires. Read literally in the window it made every
  // screen in the launcher unavailable while the browser was closed -- the palette offered "Whiteboard — Orbis is
  // not running" to somebody who was looking at Orbis. Measured in the running application, which is the only
  // place it showed up: the registry is shared and the two sides mean different things by the same word.
  const shut = { window: true, browser: false, task: false, helper: false, key: false, page: false }
  const screens = CAPABILITIES.filter((one) => one.app)
  assert.ok(screens.length > 5, 'there are screens to check')
  for (const screen of screens) {
    assert.equal(unavailableBecause(screen, shut), null, `${screen.id} is one of the window's own screens`)
  }
})

test('the browser side is unchanged: without `window`, needs are read as they always were', () => {
  const shut = { browser: false, task: false, helper: false, key: false, page: false }
  const needsHelper = CAPABILITIES.find((one) => one.needs.includes('helper') && one.app)
  assert.ok(needsHelper, 'there is a screen that also names the helper')
  assert.equal(unavailableBecause(needsHelper, shut), 'Orbis is not running')
})
