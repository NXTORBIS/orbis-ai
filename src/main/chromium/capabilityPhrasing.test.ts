import assert from 'node:assert/strict'
import test from 'node:test'
import { BrowserControl } from '../browserControl/registry.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { registerMoreChromiumCapabilities } from './chromiumCapabilities2.ts'
import { registerFindInPage, registerSitePermissionCapabilities } from './chromiumCapabilities3.ts'
import { registerBrowserToolCapabilities } from './chromiumCapabilities4.ts'
import { registerBrowserUiCapabilities } from './chromiumCapabilities5.ts'
import { registerSurfaceCapabilities } from './surfaceCapabilities.ts'

/**
 * The same thing, asked twenty different ways, has to reach the same capability.
 *
 * This is the guard against the only fix that is worse than the bug: making "open settings" work by matching the
 * phrase "open settings". A plan is written by a model choosing from a list, and what it has to choose on is each
 * capability's own name and description -- so a request reaching the wrong one is a capability that describes itself
 * badly, and the repair is the description, not a special case.
 *
 * The check is deliberately weak in one direction and strict in the other: the right capability must be *among* the
 * candidates the registry offers for the words somebody used, because the model sees several and picks. What is not
 * allowed is for it to be absent -- a capability the planner is never shown cannot be chosen however well it works.
 */

function registry(): BrowserControl {
  const control = new BrowserControl()
  const unused = (): never => {
    throw new Error('phrasing is judged from descriptions, not by running anything')
  }
  const deps = { control, browser: { list: () => [] } as never, bridge: { run: unused } as never }
  registerChromiumCapabilities(deps)
  registerMoreChromiumCapabilities({ ...deps, saveDir: '.', selfExtensionId: 'x' })
  registerSitePermissionCapabilities(deps)
  registerFindInPage({ ...deps, activePage: unused as never })
  registerBrowserToolCapabilities({ ...deps, activePage: unused as never, readClipboardText: async () => '', hasClipboardImage: async () => false })
  registerBrowserUiCapabilities({ ...deps, activePage: unused as never, pid: undefined, ui: undefined })
  registerSurfaceCapabilities(deps)
  return control
}

const control = registry()

/** The ids the registry offers for some words, best first. */
const offered = (query: string, take = 6): string[] =>
  control
    .list({ query })
    .slice(0, take)
    .map((c) => c.id)

/** The capability has to be offered for these words -- and, where it is the obvious answer, offered first. */
function reaches(words: string, id: string, { first = false }: { first?: boolean } = {}): void {
  const found = offered(words)
  assert.ok(found.includes(id), `"${words}" offered ${found.join(', ') || 'nothing'} — not ${id}`)
  if (first) assert.equal(found[0], id, `"${words}" offered ${found[0]} before ${id}`)
}

test("the browser's own settings, however it is asked for", () => {
  for (const words of [
    'open settings',
    'open browser settings',
    'go to settings',
    'take me to settings',
    'show browser settings',
    'open my browser preferences',
    'open the browser configuration',
    'browser options'
  ]) {
    reaches(words, 'surface.open')
  }
})

test('each part of the browser reaches the capability that opens it', () => {
  for (const words of ['open my downloads', 'show me what i downloaded', 'open the extensions page', 'open my bookmarks', 'show my saved passwords', 'open the reading list', 'open site permissions']) {
    reaches(words, 'surface.open')
  }
})

test('clearing history reaches history, not a search and not the cookie clearer', () => {
  for (const words of ["clear today's history", 'clear the last hour of history', 'delete my browsing history for today', "remove yesterday's history"]) {
    const found = offered(words)
    assert.ok(
      found.includes('history.deleteRange') || found.includes('history.clear'),
      `"${words}" offered ${found.join(', ')}`
    )
  }
})

test('reading history is told apart from deleting it', () => {
  for (const words of ['what did i visit yesterday', 'find the page i was reading about physics', 'search my history']) {
    reaches(words, 'history.search')
  }
})

test('the ordinary tab verbs reach the tab capabilities', () => {
  reaches('open a new tab', 'tabs.create')
  reaches('close this tab', 'tabs.close')
  reaches('switch to the youtube tab', 'tabs.activate')
  reaches('pin this tab', 'tabs.pin')
  reaches('mute that tab', 'tabs.mute')
  reaches('reopen the tab i just closed', 'tabs.reopen')
  reaches('duplicate this tab', 'tabs.duplicate')
  reaches('what tabs do i have open', 'tabs.list')
})

test('moving around a page reaches navigation, not a search', () => {
  reaches('go back', 'navigation.back')
  reaches('go forward', 'navigation.forward')
  reaches('reload the page', 'navigation.reload')
  reaches('stop loading', 'navigation.stop')
})

test('downloads, bookmarks, extensions and permissions each reach their own', () => {
  reaches('list my downloads', 'downloads.list')
  reaches('retry the failed download', 'downloads.resume')
  reaches('cancel that download', 'downloads.cancel')
  reaches('bookmark this page', 'bookmarks.add')
  reaches('remove this bookmark', 'bookmarks.remove')
  reaches('what extensions do i have', 'extensions.list')
  reaches('disable that extension', 'extensions.setEnabled')
  reaches('block notifications for this site', 'permissions.set')
})

test('windows, groups and zoom are not mistaken for tabs', () => {
  reaches('open a new window', 'window.create')
  reaches('group these tabs', 'groups.create')
  reaches('zoom in', 'zoom.set')
})

test('a keyboard shortcut is not what "open a new tab" means', () => {
  /*
   * The exact mis-plan this file exists for. browser.shortcut can press ctrl+t, which does open a tab -- and choosing
   * it means choosing the one route whose effect mostly cannot be checked afterwards, over the one that can.
   */
  assert.equal(offered('open a new tab')[0], 'tabs.create')
  assert.equal(offered('open a new window')[0], 'window.create')
})
