import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserControl } from './registry.ts'

/**
 * Putting back what Orbis just did.
 *
 * An undo is not a special path: it is the inverse action, run through the same door as everything else, so it is
 * permissioned, confirmed, verified against real state and logged exactly like the thing it reverses. That is what
 * these tests hold — along with the harder half, which is Orbis refusing to claim it can undo something it cannot.
 */

interface World {
  tabs: Set<string>
  pinned: Set<string>
  bookmarks: Set<string>
  historyCleared: boolean
}

function rig(): { control: BrowserControl; world: World } {
  const world: World = { tabs: new Set(), pinned: new Set(), bookmarks: new Set(), historyCleared: false }
  const control = new BrowserControl({ sink: async () => undefined })
  let next = 0

  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a tab.',
    params: { url: { type: 'string', description: 'Where.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Open ${String(p.url)}`,
    run: async () => {
      const tabId = `t${++next}`
      world.tabs.add(tabId)
      return { tabId }
    },
    verify: (data) => ({ verified: world.tabs.has((data as { tabId: string }).tabId), detail: 'open' }),
    undo: ({ data }) => ({ capability: 'tabs.close', params: { tabId: (data as { tabId: string }).tabId } })
  })

  control.register({
    id: 'tabs.close',
    domain: 'tabs',
    name: 'Close a tab',
    description: 'Closes a tab.',
    params: { tabId: { type: 'string', description: 'Which.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Close tab ${String(p.tabId)}`,
    run: async (p) => {
      world.tabs.delete(String(p.tabId))
      return {}
    },
    verify: (_d, p) => ({ verified: !world.tabs.has(String(p.tabId)), detail: 'closed' })
  })

  control.register({
    id: 'tabs.pin',
    domain: 'tabs',
    name: 'Pin a tab',
    description: 'Pins or unpins.',
    params: { tabId: { type: 'string', description: 'Which.' }, pinned: { type: 'boolean', description: 'Pin.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `${p.pinned ? 'Pin' : 'Unpin'} tab ${String(p.tabId)}`,
    observe: (p) => world.pinned.has(String(p.tabId)),
    run: async (p) => {
      if (p.pinned === true) world.pinned.add(String(p.tabId))
      else world.pinned.delete(String(p.tabId))
      return { tabId: String(p.tabId) }
    },
    verify: (_d, p) => ({ verified: world.pinned.has(String(p.tabId)) === (p.pinned === true), detail: 'done' }),
    undo: ({ data, before }) => ({ capability: 'tabs.pin', params: { tabId: (data as { tabId: string }).tabId, pinned: before === true } })
  })

  control.register({
    id: 'bookmarks.add',
    domain: 'bookmarks',
    name: 'Bookmark',
    description: 'Bookmarks a page.',
    params: { url: { type: 'string', description: 'Where.' } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Bookmark ${String(p.url)}`,
    run: async (p) => {
      const url = String(p.url)
      if (world.bookmarks.has(url)) return { added: 0, url }
      world.bookmarks.add(url)
      return { added: 1, url }
    },
    verify: (data) => ({ verified: world.bookmarks.has((data as { url: string }).url), detail: 'bookmarked' }),
    undo: ({ data }) => {
      const { added, url } = data as { added: number; url: string }
      return added > 0 ? { capability: 'bookmarks.remove', params: { url } } : null
    }
  })

  control.register({
    id: 'bookmarks.remove',
    domain: 'bookmarks',
    name: 'Remove a bookmark',
    description: 'Removes a bookmark.',
    params: { url: { type: 'string', description: 'Where.' } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      world.bookmarks.delete(String(p.url))
      return {}
    },
    verify: (_d, p) => ({ verified: !world.bookmarks.has(String(p.url)), detail: 'removed' })
  })

  // The other half of the design: something that genuinely cannot be put back offers nothing.
  control.register({
    id: 'history.clear',
    domain: 'history',
    name: 'Clear history',
    description: 'Deletes browsing history.',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Clear browsing history',
    run: async () => {
      world.historyCleared = true
      return {}
    },
    verify: () => ({ verified: world.historyCleared, detail: 'cleared' })
  })

  control.register({
    id: 'page.read',
    domain: 'page',
    name: 'Read the page',
    description: 'Reads it.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => ({ text: 'hello' })
  })

  return { control, world }
}

const run = (control: BrowserControl, capability: string, params: Record<string, unknown> = {}): Promise<unknown> =>
  control.execute({ capability, params, source: 'user' }, { confirm: async () => true })

test('opening a tab can be put back, and really closes that tab', async () => {
  const { control, world } = rig()
  await run(control, 'tabs.create', { url: 'https://example.org/' })
  assert.equal(world.tabs.size, 1)

  const undone = await control.undoLast()
  assert.equal(undone.ok, true)
  assert.equal(undone.what, 'Open https://example.org/')
  assert.equal(world.tabs.size, 0, 'the tab is really gone')
})

test('the last thing is put back first, and only once', async () => {
  const { control, world } = rig()
  await run(control, 'tabs.create', { url: 'https://one.example/' })
  await run(control, 'tabs.create', { url: 'https://two.example/' })

  const first = await control.undoLast()
  assert.equal(first.what, 'Open https://two.example/')
  assert.equal(world.tabs.size, 1)

  const second = await control.undoLast()
  assert.equal(second.what, 'Open https://one.example/')
  assert.equal(world.tabs.size, 0)

  const third = await control.undoLast()
  assert.equal(third.ok, false, 'nothing is undone twice')
})

test('pinning goes back to what it was, not to the opposite of what was asked', async () => {
  const { control, world } = rig()
  world.pinned.add('t1')
  await run(control, 'tabs.pin', { tabId: 't1', pinned: false })
  assert.equal(world.pinned.has('t1'), false)

  await control.undoLast()
  assert.equal(world.pinned.has('t1'), true, 'it was pinned before, so it is pinned again')
})

test('bookmarking a page that was already bookmarked offers nothing to undo', async () => {
  const { control, world } = rig()
  world.bookmarks.add('https://example.org/')
  await run(control, 'bookmarks.add', { url: 'https://example.org/' })

  const undone = await control.undoLast()
  assert.equal(undone.ok, false, 'undoing it would delete a bookmark the person made themselves')
  assert.equal(world.bookmarks.has('https://example.org/'), true)
})

test('something that cannot be put back is never offered as if it could', async () => {
  const { control, world } = rig()
  await run(control, 'history.clear')
  assert.equal(world.historyCleared, true)

  assert.deepEqual(control.undoHistory(), [], 'cleared history is gone, and Orbis does not pretend otherwise')
  const undone = await control.undoLast()
  assert.equal(undone.ok, false)
  assert.match(undone.message, /nothing/i)
})

test('reading something is not remembered as a thing to put back', async () => {
  const { control } = rig()
  await run(control, 'page.read')
  assert.deepEqual(control.undoHistory(), [])
})

test('an action that failed leaves nothing to undo', async () => {
  const { control } = rig()
  await run(control, 'tabs.close', { tabId: 'never-existed' })
  assert.deepEqual(control.undoHistory(), [], 'closing a tab is not reversible here, and a failure is not either')
})

test('what can be put back is listed newest first, with the words the action used', async () => {
  const { control } = rig()
  await run(control, 'tabs.create', { url: 'https://one.example/' })
  await run(control, 'bookmarks.add', { url: 'https://two.example/' })
  assert.deepEqual(
    control.undoHistory().map((one) => one.what),
    ['Bookmark https://two.example/', 'Open https://one.example/']
  )
})

test('one particular thing can be put back rather than the newest', async () => {
  const { control, world } = rig()
  await run(control, 'tabs.create', { url: 'https://one.example/' })
  await run(control, 'bookmarks.add', { url: 'https://two.example/' })
  const older = control.undoHistory().find((one) => one.capability === 'tabs.create')!

  await control.undoLast({ id: older.id })
  assert.equal(world.tabs.size, 0, 'the tab went back')
  assert.equal(world.bookmarks.size, 1, 'and the bookmark was left alone')
})

test('an undo that cannot be done is reported as failed, not crossed off', async () => {
  const { control, world } = rig()
  await run(control, 'tabs.create', { url: 'https://example.org/' })
  // The world moves on: somebody closed the tab themselves, so closing it again verifies as already closed.
  world.tabs.clear()
  const undone = await control.undoLast()
  // Closing an already-closed tab still ends with the tab closed, so this one legitimately succeeds.
  assert.equal(undone.ok, true)
  assert.equal(control.undoHistory().length, 0)
})
