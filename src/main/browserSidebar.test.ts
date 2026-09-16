import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addGroup,
  defaultLayout,
  findPanel,
  isHidden,
  isPinned,
  locate,
  MAX_WIDTH,
  MIN_WIDTH,
  moveGroup,
  openPanel,
  movePanel,
  movePinned,
  normalizeLayout,
  PANEL_IDS,
  reachablePanels,
  removeGroup,
  renameGroup,
  setGroupCollapsed,
  setPanelHidden,
  setPanelPinned,
  setWidth,
  shownWidth,
  visibleLayout
} from '../shared/browserSidebar.ts'
import type { PanelId, SidebarLayout } from '../shared/browserSidebar'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserSidebarStore } from './browserSidebarStore.ts'

const everyPanel = (layout: SidebarLayout): PanelId[] => layout.groups.flatMap((g) => g.items).sort()

test('every panel Orbis has is somewhere in the sidebar to begin with, and only once', () => {
  const layout = defaultLayout()
  assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort(), 'nothing is missing and nothing is duplicated')
  assert.ok(layout.groups.length >= 3, 'the panels arrive sorted into groups rather than as one long list')
})

test('an arrangement saved by an older Orbis keeps a new panel rather than losing it', () => {
  // Saved when "customize" did not exist yet, and mentioning a panel that has since been removed.
  const old = {
    version: 1,
    groups: [{ id: 'browsing', label: 'Browsing', collapsed: false, items: ['tabs', 'bookmarks', 'somethingRemoved'] }],
    hidden: ['history'],
    pinned: ['bookmarks'],
    mode: 'labels',
    density: 'comfortable',
    width: 240,
    open: true
  }
  const layout = normalizeLayout(old)
  assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort(), 'the panels they never saw are added, the one that is gone is dropped')
  assert.deepEqual(layout.groups[0].items.slice(0, 2), ['tabs', 'bookmarks'], 'the order they chose is kept')
  assert.deepEqual(layout.hidden, ['history'])
  assert.deepEqual(layout.pinned, ['bookmarks'])
  assert.equal(layout.open, true)
})

test('nonsense on disk opens a working sidebar rather than nothing', () => {
  for (const nonsense of [null, undefined, 'not an object', 42, [], { groups: 'no' }, { groups: [{}] }]) {
    const layout = normalizeLayout(nonsense)
    assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort(), `${JSON.stringify(nonsense)} still gives every panel`)
    assert.ok(layout.width >= MIN_WIDTH && layout.width <= MAX_WIDTH)
  }
})

test('a panel can be moved anywhere, and is never in two places at once', () => {
  let layout = defaultLayout()
  const to = layout.groups[2].id
  layout = movePanel(layout, 'bookmarks', to, 0)
  assert.deepEqual(locate(layout, 'bookmarks'), { groupId: to, index: 0 })
  assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort(), 'moving it does not copy it')

  // Within its own group, dropping it at the end means the end.
  layout = movePanel(layout, 'bookmarks', to, 99)
  assert.equal(locate(layout, 'bookmarks')?.index, layout.groups[2].items.length - 1)

  assert.equal(movePanel(layout, 'bookmarks', 'no-such-group', 0), layout, 'a group that is not there changes nothing')
})

test('hiding takes a panel out of the sidebar without taking it out of Orbis', () => {
  let layout = setPanelHidden(defaultLayout(), 'history', true)
  assert.equal(isHidden(layout, 'history'), true)
  assert.ok(!visibleLayout(layout).groups.some((g) => g.items.includes('history')), 'it is not drawn')
  assert.ok(everyPanel(layout).includes('history'), 'but it still has its place, so showing it puts it back')
  assert.ok(!reachablePanels(layout).includes('history'))

  layout = setPanelHidden(layout, 'history', false)
  assert.equal(isHidden(layout, 'history'), false)
  assert.ok(visibleLayout(layout).groups.some((g) => g.items.includes('history')))
})

test('pinning lifts a panel above the groups, and unhides it if it was hidden', () => {
  let layout = setPanelHidden(defaultLayout(), 'downloads', true)
  layout = setPanelPinned(layout, 'downloads', true)
  assert.equal(isPinned(layout, 'downloads'), true)
  assert.equal(isHidden(layout, 'downloads'), false, 'asking for it back is what pinning it meant')
  assert.deepEqual(visibleLayout(layout).pinned, ['downloads'])
  assert.ok(!visibleLayout(layout).groups.some((g) => g.items.includes('downloads')), 'it is shown once, at the top')

  layout = setPanelPinned(layout, 'tabs', true)
  layout = movePinned(layout, 'tabs', 0)
  assert.deepEqual(layout.pinned, ['tabs', 'downloads'], 'pinned panels can be put in any order')

  layout = setPanelPinned(layout, 'downloads', false)
  assert.ok(visibleLayout(layout).groups.some((g) => g.items.includes('downloads')), 'unpinning returns it to its group')
})

test('groups can be made, named, collapsed, reordered and removed without losing a panel', () => {
  let layout = addGroup(defaultLayout(), '  My   things  ')
  const mine = layout.groups[layout.groups.length - 1]
  assert.equal(mine.label, 'My things', 'the name is tidied, not taken literally')

  layout = movePanel(layout, 'notes', mine.id, 0)
  layout = movePanel(layout, 'tasks', mine.id, 1)
  layout = renameGroup(layout, mine.id, 'Desk')
  assert.equal(layout.groups.find((g) => g.id === mine.id)?.label, 'Desk')

  layout = setGroupCollapsed(layout, mine.id, true)
  assert.equal(visibleLayout(layout).groups.find((g) => g.id === mine.id)?.collapsed, true)

  layout = moveGroup(layout, mine.id, 0)
  assert.equal(layout.groups[0].id, mine.id)

  layout = removeGroup(layout, mine.id)
  assert.ok(!layout.groups.some((g) => g.id === mine.id))
  assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort(), 'its panels went somewhere rather than away')
})

test('the last group cannot be removed, because then there would be nowhere to put anything', () => {
  let layout = defaultLayout()
  while (layout.groups.length > 1) layout = removeGroup(layout, layout.groups[layout.groups.length - 1].id)
  assert.equal(removeGroup(layout, layout.groups[0].id), layout)
  assert.deepEqual(everyPanel(layout), [...PANEL_IDS].sort())
})

test('the sidebar cannot be dragged to a width that makes it unusable', () => {
  assert.equal(setWidth(defaultLayout(), 10).width, MIN_WIDTH)
  assert.equal(setWidth(defaultLayout(), 9000).width, MAX_WIDTH)
  assert.equal(shownWidth({ ...defaultLayout(), mode: 'icons', width: 400 }), 52, 'an icon-only sidebar is icon width, whatever was dragged')
  assert.equal(shownWidth({ ...defaultLayout(), mode: 'labels', width: 300 }), 300)
})

test('Orion can name a panel the way a person would', () => {
  assert.equal(findPanel('bookmarks'), 'bookmarks')
  assert.equal(findPanel('Reading list'), 'readingList')
  assert.equal(findPanel('reading-list'), 'readingList')
  assert.equal(findPanel('ad blocking'), 'adblock')
  assert.equal(findPanel('open my downloads'), 'downloads')
  assert.equal(findPanel('the weather'), null, 'a panel that does not exist is not guessed at')
  assert.equal(findPanel(''), null)
})

// ---------------------------------------------------------------- kept per profile, on disk

test('each profile keeps its own arrangement, and it survives a restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sidebar-'))
  try {
    const store = new BrowserSidebarStore(dir)
    const mine = setPanelPinned(defaultLayout(), 'bookmarks', true)
    await store.write('default', mine)
    await store.write('work', setPanelHidden(defaultLayout(), 'bookmarks', true))
    await store.flush()

    // A second Orbis, reading what the first one wrote.
    const later = new BrowserSidebarStore(dir)
    assert.deepEqual((await later.read('default')).pinned, ['bookmarks'], 'what was arranged is still arranged')
    assert.deepEqual((await later.read('work')).hidden, ['bookmarks'])
    assert.deepEqual((await later.read('work')).pinned, [], 'one profile does not inherit the other')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a profile that has never been arranged gets the sidebar Orbis ships', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sidebar-'))
  try {
    const store = new BrowserSidebarStore(dir)
    assert.deepEqual(await store.read('brand-new'), defaultLayout())
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an arrangement written by hand is made safe before it is stored', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sidebar-'))
  try {
    const store = new BrowserSidebarStore(dir)
    const saved = await store.write('default', { width: 99999, groups: [{ id: 'g', label: 'G', items: ['tabs', 'nonsense'] }], mode: 'sideways' })
    assert.equal(saved.width, MAX_WIDTH)
    assert.equal(saved.mode, 'labels')
    assert.deepEqual(everyPanel(saved), [...PANEL_IDS].sort())
    await store.flush()
    assert.deepEqual(await new BrowserSidebarStore(dir).read('default'), saved, 'what comes back is what was stored')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('deleting a profile forgets its arrangement rather than leaving it in memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sidebar-'))
  try {
    const store = new BrowserSidebarStore(dir)
    await store.write('going', setPanelPinned(defaultLayout(), 'notes', true))
    await store.flush()
    store.forget('going')
    // Reading again is a fresh read of the file, not a stale copy held in memory.
    assert.deepEqual((await store.read('going')).pinned, ['notes'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a change to an arrangement is announced, so every window follows it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-sidebar-'))
  try {
    const store = new BrowserSidebarStore(dir)
    const heard: { profileId: string; pinned: PanelId[] }[] = []
    const stop = store.onChange((profileId, layout) => heard.push({ profileId, pinned: layout.pinned }))
    await store.write('default', setPanelPinned(defaultLayout(), 'history', true))
    stop()
    await store.write('default', defaultLayout())
    assert.deepEqual(heard, [{ profileId: 'default', pinned: ['history'] }], 'heard once, and not after letting go')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('opening a panel, and what happens to it when it is hidden', () => {
  let layout = openPanel(defaultLayout(), 'bookmarks')
  assert.equal(layout.panel, 'bookmarks')
  assert.equal(layout.open, true, 'asking for a panel opens the sidebar it lives in')

  // Asking for a hidden panel by name shows it again: that is what asking for it meant.
  layout = openPanel(setPanelHidden(layout, 'history', true), 'history')
  assert.equal(layout.panel, 'history')
  assert.equal(isHidden(layout, 'history'), false)

  // Hiding the panel that is open closes it, rather than leaving it up with no way back.
  layout = setPanelHidden(layout, 'history', true)
  assert.equal(layout.panel, null)

  assert.equal(openPanel(layout, null).panel, null)
})

test('a panel that was open but has since been hidden does not come back on restart', () => {
  const stored = { ...defaultLayout(), hidden: ['downloads'], panel: 'downloads' }
  assert.equal(normalizeLayout(stored).panel, null)
  assert.equal(normalizeLayout({ ...defaultLayout(), panel: 'notAPanel' }).panel, null)
  assert.equal(normalizeLayout({ ...defaultLayout(), panel: 'notes' }).panel, 'notes')
})
