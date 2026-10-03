import assert from 'node:assert/strict'
import test from 'node:test'
import { CdpPage } from './cdpPage.ts'
import type { CdpConnection, CdpEvent } from './cdp.ts'

/**
 * Whether a tab knows it has finished loading.
 *
 * This is guarded because getting it wrong is silent and expensive. A tab whose loading flag never clears looks busy
 * for ever: every wait on it times out, "reload this page" reports failure after twenty seconds on a page that
 * reloaded perfectly, and the agent is told an action failed when it worked -- so it tries to recover from nothing.
 *
 * What was actually measured against this build of Chromium, and what these tests encode:
 *
 *  - A reloading tab sends `frameStartedNavigating` and `frameStartedLoading`, and **never** `frameStoppedLoading`
 *    or `loadEventFired`.
 *  - The *first* reload of a page also sends one lifecycle event, `InteractiveTime`.
 *  - Every reload after that sends **no completion event at all**, because `InteractiveTime` is reported once in a
 *    page's lifetime.
 *
 * So there is no event that can be relied on, which is why the page asks `document.readyState` as well. The last test
 * here is the one that matters most: the second reload.
 */

/** A connection that answers `document.readyState` with whatever the test says the page is doing. */
function fakeConnection(readyState: () => string): { conn: CdpConnection; evaluated: number } {
  const state = { evaluated: 0 }
  const conn = {
    send: async (method: string) => {
      if (method === 'Runtime.evaluate') {
        state.evaluated += 1
        return { result: { value: readyState() } }
      }
      if (method === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ id: 1, url: 'https://example.org/', title: 'Example' }] }
      return {}
    },
    on: () => undefined
  } as unknown as CdpConnection
  return { conn, evaluated: state.evaluated }
}

function makePage(readyState: () => string): CdpPage {
  const { conn } = fakeConnection(readyState)
  return new CdpPage(1, conn, 'T1', 'S1', { targetId: 'T1', type: 'page', title: 'Example', url: 'https://example.org/' }, () => undefined)
}

const event = (method: string, params: Record<string, unknown> = {}): CdpEvent => ({ method, params }) as unknown as CdpEvent
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

test('a tab that starts loading says it is loading', () => {
  const page = makePage(() => 'loading')
  assert.equal(page.isLoading(), false, 'a settled tab is not loading')
  page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
  assert.equal(page.isLoading(), true)
})

test('a lifecycle event is enough to say it finished, because it is often the only one that comes', () => {
  const page = makePage(() => 'loading')
  page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
  page.handle(event('Page.lifecycleEvent', { frameId: 'F1', name: 'InteractiveTime' }))
  assert.equal(page.isLoading(), false)
})

test('the old events still work where a page does send them', () => {
  for (const method of ['Page.frameStoppedLoading', 'Page.loadEventFired']) {
    const page = makePage(() => 'loading')
    page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
    page.handle(event(method, { frameId: 'F1' }))
    assert.equal(page.isLoading(), false, method)
  }
})

test('a lifecycle name that does not mean "up" does not clear it', () => {
  const page = makePage(() => 'loading')
  page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
  page.handle(event('Page.lifecycleEvent', { frameId: 'F1', name: 'init' }))
  assert.equal(page.isLoading(), true)
})

test('an embedded frame cannot make the whole tab look busy', async () => {
  const page = makePage(() => 'complete')
  // The tab's own frame, learned from its own navigation.
  page.handle(event('Page.frameNavigated', { frame: { id: 'MAIN' } }))
  page.handle(event('Page.frameStartedLoading', { frameId: 'MAIN' }))
  page.handle(event('Page.lifecycleEvent', { frameId: 'MAIN', name: 'load' }))
  assert.equal(page.isLoading(), false)

  // An advert's iframe starts loading and never finishes -- which, for one the blocker refuses, it never will.
  page.handle(event('Page.frameStartedLoading', { frameId: 'ADVERT' }))
  assert.equal(page.isLoading(), false, 'the tab is not busy because something inside it is')
  await wait(50)
})

test('a second reload finishes even though the tab announces nothing at all', async () => {
  /*
   * The one that was broken.
   *
   * `InteractiveTime` is reported once in a page's life, so a second reload sends a start and then silence. The tab
   * asks the page itself, which is why this clears without a single completion event.
   */
  let state = 'loading'
  const page = makePage(() => state)
  page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
  assert.equal(page.isLoading(), true)

  state = 'complete'
  for (let i = 0; i < 40 && page.isLoading(); i++) await wait(50)
  assert.equal(page.isLoading(), false, 'the tab never worked out that it had finished')
})

test('a page that really is still loading keeps saying so', async () => {
  const page = makePage(() => 'loading')
  page.handle(event('Page.frameStartedLoading', { frameId: 'F1' }))
  await wait(700)
  assert.equal(page.isLoading(), true, 'saying it has finished when it has not is the worse mistake')
})
