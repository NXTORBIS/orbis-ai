import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromBrowserState, keepableUrl, matchesState, newWorkspace, normalizeWorkspace, openPlan, summarize } from '../shared/workspaces.ts'

test('a workspace is taken from the window, leaving out private tabs and pages worth nothing', () => {
  const { tabs, groups } = fromBrowserState({
    tabs: [
      { url: 'https://example.com/a', title: 'A', pinned: true, groupId: 'g1' },
      { url: 'https://example.com/b', title: 'B', groupId: 'g1', active: true },
      { url: 'https://other.test/c', title: 'C', muted: true },
      { url: 'https://secret.test/x', title: 'Private', private: true },
      { url: 'about:blank', title: 'New tab' }
    ],
    groups: [
      { id: 'g1', name: 'Reading', color: '#3ee58a', collapsed: true },
      { id: 'g2', name: 'Empty', color: '#ffbe4d' }
    ]
  })
  assert.deepEqual(tabs.map((t) => t.url), ['https://example.com/a', 'https://example.com/b', 'https://other.test/c'])
  assert.equal(tabs[0].pinned, true)
  assert.equal(tabs[0].group, 'Reading')
  assert.equal(tabs[1].active, true)
  assert.equal(tabs[2].muted, true)
  assert.deepEqual(groups.map((g) => g.name), ['Reading'], 'a group with nothing in it is not saved')
  assert.equal(keepableUrl('about:blank'), false)
  assert.equal(keepableUrl('https://example.com'), true)
  assert.equal(fromBrowserState(null).tabs.length, 0)
})

test('a stored workspace is checked: bad tabs dropped, names tidied, groups kept only when used', () => {
  const clean = normalizeWorkspace({
    id: 'w1',
    name: '  Study   time  ',
    color: 'blue',
    tabs: [
      { url: 'https://example.com/a', title: '  A  ', group: 'Reading' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'https://example.com/b', group: 'Missing group' }
    ],
    groups: [{ name: 'Reading', color: '#3ee58a', collapsed: true }, { name: 'Unused', color: '#ffbe4d' }]
  })
  assert.equal(clean?.name, 'Study time')
  assert.equal(clean?.color, '#3fd8ff', 'an unknown colour falls back to the first one')
  assert.deepEqual(clean?.tabs.map((t) => t.url), ['https://example.com/a', 'https://example.com/b'])
  assert.equal(clean?.tabs[0].title, 'A')
  assert.equal(clean?.tabs[1].group, undefined, 'a group that is not there is dropped from the tab')
  assert.deepEqual(clean?.groups.map((g) => g.name), ['Reading'])
  assert.equal(normalizeWorkspace({ name: 'no id' }), null)
})

test('a workspace describes itself by its sites, tabs, groups and pins', () => {
  const workspace = newWorkspace({
    tabs: [
      { url: 'https://docs.example.com/1', title: '1', pinned: true },
      { url: 'https://docs.example.com/2', title: '2', pinned: false },
      { url: 'https://www.news.test/3', title: '3', pinned: false, group: 'Later' }
    ],
    groups: [{ name: 'Later', color: '#3fd8ff', collapsed: false }]
  })
  const summary = summarize(workspace)
  assert.equal(summary.tabs, 3)
  assert.equal(summary.pinned, 1)
  assert.equal(summary.groups, 1)
  assert.deepEqual(summary.sites, ['docs.example.com', 'news.test'])
})

test('Orbis can tell whether the window still matches a workspace, and what opening one would do', () => {
  const workspace = newWorkspace({
    tabs: [
      { url: 'https://a.test/', title: 'A', pinned: false },
      { url: 'https://b.test/', title: 'B', pinned: false }
    ]
  })
  assert.equal(matchesState(workspace, { tabs: [{ url: 'https://b.test/', title: 'B', pinned: false }, { url: 'https://a.test/', title: 'A', pinned: false }] }), true, 'order does not matter')
  assert.equal(matchesState(workspace, { tabs: [{ url: 'https://a.test/', title: 'A', pinned: false }] }), false)

  const current = { tabs: [{ url: 'https://a.test/', title: 'A', pinned: false }, { url: 'https://keep.test/', title: 'K', pinned: false }] }
  assert.deepEqual(openPlan(workspace, current, true), { open: 1, close: 1, keep: 1 })
  assert.deepEqual(openPlan(workspace, current, false), { open: 1, close: 0, keep: 2 }, 'opening alongside closes nothing')
})
