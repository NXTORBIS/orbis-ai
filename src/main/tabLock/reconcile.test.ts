import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SWEEPING_CAPABILITIES, reconcile, tabIdFor } from './reconcile.ts'

/**
 * The two decisions the wiring makes.
 *
 * Both are the sort of thing that fails silently: a tab id that does not resolve means a command slips past the gate, and
 * a change signal read wrongly means a tab is never protected. Neither would raise an error, which is why they are here.
 */

// ---------------------------------------------------------------- which tab

test('a tab named on the target is the tab', () => {
  assert.equal(tabIdFor({}, { tabId: '41' }), 41)
})

test('a tab named as a parameter is the tab, both ways round', () => {
  assert.equal(tabIdFor({ tabId: '7' }, undefined), 7)
  assert.equal(tabIdFor({ tab: 9 }, undefined), 9)
})

test('the target wins over the parameter, because it is the more specific of the two', () => {
  assert.equal(tabIdFor({ tabId: '7' }, { tabId: '41' }), 41)
})

test('naming no tab means the tab in front, which is null here for the caller to resolve', () => {
  assert.equal(tabIdFor({}, undefined), null)
  assert.equal(tabIdFor({}, {}), null)
  assert.equal(tabIdFor({ tabId: '' }, undefined), null)
  assert.equal(tabIdFor({ tabId: null }, undefined), null)
})

test('something that is not a tab id is not quietly read as tab zero', () => {
  // `Number([])` is 0 and `Number(' ')` is 0. Tab 0 can be a real tab, so a command that named nothing recognisable must
  // not be treated as naming it -- that would be a command acting on a tab nobody chose.
  for (const nonsense of [[], {}, ' ', 'abc', true, '1.5', NaN, Infinity]) {
    assert.equal(tabIdFor({ tabId: nonsense as never }, undefined), null, `${JSON.stringify(nonsense)} became a tab`)
  }
})

test('tab zero itself still resolves, because zero is a tab', () => {
  assert.equal(tabIdFor({ tabId: '0' }, undefined), 0)
  assert.equal(tabIdFor({ tab: 0 }, undefined), 0)
})

test('the sweeping capabilities are the listings, not the actions', () => {
  assert.ok(SWEEPING_CAPABILITIES.has('tabs.list'))
  assert.ok(SWEEPING_CAPABILITIES.has('windows.list'))
  // The ones that act on a tab must not be in here, or they would never be refused.
  for (const acting of ['page.read', 'page.screenshot', 'tabs.close', 'tabs.activate', 'page.click']) {
    assert.ok(!SWEEPING_CAPABILITIES.has(acting), `${acting} would slip past the gate`)
  }
})

// ---------------------------------------------------------------- what changed

const row = (id: number, url: string, active = false): { id: string; url: string; title: string; active: boolean } => ({
  id: String(id),
  url,
  title: `Tab ${id}`,
  active
})

test('a first look treats every tab as new, so the rules see all of them', () => {
  const change = reconcile(new Map(), [row(1, 'https://a.example/'), row(2, 'https://b.example/')])
  assert.deepEqual(
    change.moved.map((m) => m.tabId),
    [1, 2]
  )
  assert.deepEqual(change.gone, [])
})

test('a tab that has not moved is not reported again', () => {
  const before = new Map([[1, 'https://a.example/']])
  const change = reconcile(before, [row(1, 'https://a.example/')])
  assert.deepEqual(change.moved, [])
})

test('a tab that went somewhere else is reported', () => {
  const before = new Map([[1, 'https://a.example/']])
  const change = reconcile(before, [row(1, 'https://bank.example/')])
  assert.deepEqual(change.moved, [{ tabId: 1, url: 'https://bank.example/', title: 'Tab 1' }])
})

test('a tab that has gone is reported once and then forgotten', () => {
  const before = new Map([
    [1, 'https://a.example/'],
    [2, 'https://b.example/']
  ])
  const first = reconcile(before, [row(1, 'https://a.example/')])
  assert.deepEqual(first.gone, [2])
  const second = reconcile(first.after, [row(1, 'https://a.example/')])
  assert.deepEqual(second.gone, [], 'it is not reported gone for ever')
})

test('the tab in front is picked out, and nothing in front is null rather than a guess', () => {
  assert.equal(reconcile(new Map(), [row(1, 'https://a.example/'), row(2, 'https://b.example/', true)]).active, 2)
  assert.equal(reconcile(new Map(), [row(1, 'https://a.example/')]).active, null)
})

test('a row whose id is not a number is dropped rather than treated as a tab', () => {
  // An id Orbis cannot match is an id it cannot protect. Letting it through would mean quietly treating an unknown tab as
  // a safe one.
  const change = reconcile(new Map(), [
    { id: 'chrome-untrusted', url: 'https://x.example/', title: 'x', active: true },
    row(4, 'https://ok.example/')
  ])
  assert.deepEqual(
    change.moved.map((m) => m.tabId),
    [4]
  )
  assert.equal(change.active, null)
  assert.deepEqual([...change.after.keys()], [4])
})

test('opening, closing, navigating and switching in one signal are all worked out together', () => {
  // The browser sends one "something changed", so a realistic step is all four at once.
  const before = new Map([
    [1, 'https://a.example/'],
    [2, 'https://b.example/'],
    [3, 'https://c.example/']
  ])
  const change = reconcile(before, [
    row(1, 'https://a.example/'), // unchanged
    row(2, 'https://bank.example/'), // navigated
    row(4, 'https://new.example/', true) // opened, and now in front; 3 has gone
  ])
  assert.deepEqual(
    change.moved.map((m) => m.tabId),
    [2, 4]
  )
  assert.deepEqual(change.gone, [3])
  assert.equal(change.active, 4)
  assert.deepEqual([...change.after.keys()], [1, 2, 4])
})

test('no tabs at all is a browser with nothing in it, not an error', () => {
  const change = reconcile(new Map([[1, 'https://a.example/']]), [])
  assert.deepEqual(change.gone, [1])
  assert.deepEqual(change.moved, [])
  assert.equal(change.active, null)
  assert.equal(change.after.size, 0)
})
