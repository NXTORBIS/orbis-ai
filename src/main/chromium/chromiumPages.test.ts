import assert from 'node:assert/strict'
import test from 'node:test'
import { ChromiumPages, type PagesBridge, type PagesBrowser } from './chromiumPages.ts'
import type { CdpPage } from './cdpPage.ts'

/** A tab as the extension reports it, and a page as the browser holds it. Small fakes: the real ones are tested against Chromium. */
const fakePage = (id: number, targetId: string): CdpPage => {
  const page = { id, targetId, destroyed: false, isDestroyed: () => page.destroyed }
  return page as unknown as CdpPage
}
const row = (id: string, targetId: string | undefined, active = false) => ({ id, active, windowId: 1, url: `https://x/${id}`, title: `T${id}`, targetId })

function setup(initial: ReturnType<typeof row>[]) {
  const pages = [fakePage(10, 'A'), fakePage(11, 'B')]
  const changes = new Set<(c: { type: 'opened' | 'closed' | 'changed'; page: CdpPage }) => void>()
  let opened = 0
  const browser: PagesBrowser = {
    list: () => pages,
    find: (id) => pages.find((p) => p.id === id),
    newTab: async () => {
      opened++
      const p = fakePage(20 + opened, `N${opened}`)
      pages.push(p)
      return p
    },
    onChange: (l) => (changes.add(l), () => changes.delete(l))
  }
  let rows = initial
  let reads = 0
  let fire: () => void = () => undefined
  const bridge: PagesBridge = {
    run: async <T>() => (reads++, rows as unknown as T),
    watch: async (l) => ((fire = l), () => undefined)
  }
  return { pages, browser, bridge, set: (r: typeof rows) => (rows = r), reads: () => reads, fire: () => fire(), opened: () => opened }
}

test('the active tab is the browser’s active tab, found by its own report', async () => {
  const s = setup([row('1', 'A'), row('2', 'B', true)])
  const pages = new ChromiumPages(s.browser, s.bridge)
  await pages.start()
  assert.equal(pages.resolve({}).id, 11)
  assert.equal(pages.resolve({ target: { tabId: '1' } }).id, 10)
  assert.equal(pages.resolve({ target: { webContentsId: 10 } }).id, 10)
})

test('an unknown tab, a closed tab and a tab with no page are reported as they are', async () => {
  const s = setup([row('1', 'A', true), row('3', undefined)])
  const pages = new ChromiumPages(s.browser, s.bridge)
  await pages.start()
  assert.throws(() => pages.resolve({ target: { tabId: '99' } }), /No tab with id 99/)
  assert.throws(() => pages.resolve({ target: { tabId: '3' } }), /no page yet/)
  ;(s.pages[0] as unknown as { destroyed: boolean }).destroyed = true
  assert.throws(() => pages.resolve({}), /closed/)
})

test('it follows the browser by its events, not by asking again and again', async () => {
  const s = setup([row('1', 'A', true), row('2', 'B')])
  const pages = new ChromiumPages(s.browser, s.bridge)
  await pages.start()
  const afterStart = s.reads()
  assert.equal(pages.resolve({}).id, 10)
  s.set([row('1', 'A'), row('2', 'B', true)])
  s.fire()
  await pages.refresh()
  assert.equal(pages.resolve({}).id, 11, 'the tab the person switched to is now the active one')
  assert.ok(s.reads() > afterStart)
  // Several changes at once become one more read, not one each.
  const before = s.reads()
  await Promise.all([pages.refresh(), pages.refresh(), pages.refresh(), pages.refresh()])
  assert.ok(s.reads() - before <= 2, `coalesced: ${s.reads() - before} reads`)
})

test('the state has the shape the agent reads, with each page’s id', async () => {
  const s = setup([row('1', 'A'), row('2', 'B', true)])
  const pages = new ChromiumPages(s.browser, s.bridge)
  await pages.start()
  const state = pages.state
  assert.deepEqual(state.tabs.map((t) => [t.id, t.active, t.webContentsId]), [['1', false, 10], ['2', true, 11]])
  assert.equal(pages.findPage(10)?.id, 10)
  assert.equal(pages.findPage(999), null)
})

test('with no tab open it opens a real one, and otherwise it uses the active tab', async () => {
  const empty = setup([])
  const p1 = new ChromiumPages(empty.browser, empty.bridge)
  await p1.start()
  const page = await p1.getTarget()
  assert.equal(empty.opened(), 1)
  assert.ok(page)
  const busy = setup([row('2', 'B', true)])
  const p2 = new ChromiumPages(busy.browser, busy.bridge)
  await p2.start()
  assert.equal((await p2.getTarget()).id, 11)
  assert.equal(busy.opened(), 0)
})
