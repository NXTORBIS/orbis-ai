import assert from 'node:assert/strict'
import test from 'node:test'
import { tabChanges, type ChromiumTabState } from './chromiumPages.ts'

/**
 * What changed between two readings of the browser's tab list.
 *
 * Chromium reports its whole tab list whenever anything about it changes, so this comparison is the only thing that
 * knows a tab was opened rather than renamed. Everything downstream -- notifications, workflows waiting on an event,
 * the agent noticing the person opened something themselves -- is built on it being right.
 */

const tab = (id: string, over: Partial<ChromiumTabState> = {}): ChromiumTabState => ({
  id,
  active: false,
  windowId: 1,
  url: `https://example.org/${id}`,
  title: `Page ${id}`,
  ...over
})

test('the first reading is the state of the world, not a burst of events', () => {
  assert.deepEqual(tabChanges([], [tab('1'), tab('2')]), [], 'starting Orbis with ten tabs open is not ten tabs opening')
})

test('a new tab is one event', () => {
  const changes = tabChanges([tab('1')], [tab('1'), tab('2')])
  assert.equal(changes.length, 1)
  assert.equal(changes[0]?.name, 'tab.created')
  assert.equal(changes[0]?.tabId, '2')
})

test('a closed tab is one event, and carries what it was', () => {
  const changes = tabChanges([tab('1'), tab('2', { url: 'https://example.org/gone' })], [tab('1')])
  assert.equal(changes.length, 1)
  assert.equal(changes[0]?.name, 'tab.closed')
  assert.equal(changes[0]?.url, 'https://example.org/gone')
})

test('going somewhere else is a navigation; a new title on its own is not', () => {
  const went = tabChanges([tab('1')], [tab('1', { url: 'https://example.com/other' })])
  assert.deepEqual(went.map((c) => c.name), ['tab.navigated'])

  const renamed = tabChanges([tab('1')], [tab('1', { title: 'The title arrived' })])
  assert.deepEqual(renamed, [], 'a title turning up a moment after the page did is not something to announce')
})

test('a tab becoming the one in front is an event, and staying in front is not', () => {
  const switched = tabChanges([tab('1', { active: true }), tab('2')], [tab('1'), tab('2', { active: true })])
  assert.deepEqual(switched.map((c) => `${c.name}:${c.tabId}`), ['tab.activated:2'])

  const unchanged = tabChanges([tab('1', { active: true })], [tab('1', { active: true })])
  assert.deepEqual(unchanged, [])
})

test('a tab that navigates and comes to the front in one reading says both', () => {
  const changes = tabChanges([tab('1'), tab('2', { active: true })], [tab('1', { url: 'https://example.com/new', active: true }), tab('2')])
  assert.deepEqual(changes.map((c) => c.name).sort(), ['tab.activated', 'tab.navigated'])
})

test('a tab that has not settled on an address yet is not reported as going nowhere', () => {
  // A tab opened blank reports an empty address for a moment; announcing that as a navigation would be noise.
  const changes = tabChanges([tab('1')], [tab('1', { url: '' })])
  assert.deepEqual(changes, [])
})

test('several things at once are several events', () => {
  const before = [tab('1', { active: true }), tab('2')]
  const after = [tab('1'), tab('3', { active: true })]
  const changes = tabChanges(before, after)
  assert.deepEqual(changes.map((c) => `${c.name}:${c.tabId}`).sort(), ['tab.activated:3', 'tab.closed:2', 'tab.created:3'])
})

test('nothing changing says nothing', () => {
  const same = [tab('1', { active: true }), tab('2')]
  assert.deepEqual(tabChanges(same, [...same]), [])
})
