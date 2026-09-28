import test from 'node:test'
import assert from 'node:assert/strict'
import { CAPABILITIES, CATEGORIES, MAX_PINS, addPin, addressFor, canPin, capabilitiesIn, capabilityById, movePin, normalizePins, removePin, scoreCapability, searchCapabilities, unavailableBecause } from './commandCenter.ts'
import type { Readiness } from './commandCenter.ts'

const all: Readiness = { browser: true, helper: true, key: true, page: true }
const nothing: Readiness = { browser: false, helper: false, key: false, page: false }

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
  const withActions = ['ask', 'search', 'galaxy', 'workflows', 'notes', 'tasks', 'adblock', 'secrets', 'account']
  for (const c of CAPABILITIES) {
    assert.equal(canPin(c), withActions.includes(c.id), `${c.id} is marked pinnable=${c.pinnable}`)
  }
})

// ---------------------------------------------------------------- availability

test('a capability says which thing is missing, not just that it is missing', () => {
  assert.equal(unavailableBecause(capabilityById('ask')!, all), null)
  assert.match(unavailableBecause(capabilityById('ask')!, { ...all, helper: false })!, /not running/)
  assert.match(unavailableBecause(capabilityById('ask')!, { ...all, key: false })!, /no key/)
  assert.match(unavailableBecause(capabilityById('tabs')!, { ...all, browser: false })!, /not connected/)
  assert.match(unavailableBecause(capabilityById('zoom')!, { ...all, page: false })!, /no page/)
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
  const many = ['ask', 'search', 'galaxy', 'workflows', 'notes', 'tasks', 'adblock', 'secrets', 'account']
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
