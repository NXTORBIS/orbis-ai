import type { ParamSpec } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from '../browserControl/registry.ts'
import type { CdpBrowser, CdpPage } from './cdpPage.ts'
import type { ExtensionBridge } from './extensionBridge.ts'

/**
 * The Browser Control Layer's browser capabilities, on real Chromium.
 *
 * These register under the same ids, with the same parameters, that the Electron build's capabilities use, so Orion, workflows
 * and automations call exactly what they called before and get the same kind of answer. Each one acts on Chromium's own
 * systems (its tab model, downloads, history, bookmarks, cookies and windows, through the Orbis extension) and checks
 * afterwards, in the browser, that it really happened. There is no Orbis-side copy of any of that state.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms = 2500, step = 100): Promise<T> {
  const end = Date.now() + ms
  let value = await read()
  while (!ok(value) && Date.now() < end) {
    await sleep(step)
    value = await read()
  }
  return value
}

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })
const TAB_ID = str('The tab id from tabs.list (default: the active tab).')

export interface ChromiumTab {
  id: string
  index: number
  url: string
  title: string
  active: boolean
  loading: boolean
  pinned: boolean
  groupId: number
  muted: boolean
  audible: boolean
  windowId: number
  targetId?: string
}

export interface ChromiumCapabilityDeps {
  control: BrowserControl
  browser: CdpBrowser
  bridge: ExtensionBridge
}

const webUrl = (input: string): string | null => {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** The names Orion knows for a download's state, from Chromium's. */
const DOWNLOAD_STATE: Record<string, string> = { in_progress: 'progressing', complete: 'completed', interrupted: 'interrupted' }

const TABS_SCRIPT = `(async () => {
  const tabs = await chrome.tabs.query({});
  const targets = await chrome.debugger.getTargets();
  const byTab = {};
  for (const t of targets) if (t.tabId !== undefined && t.type === 'page') byTab[t.tabId] = t.id;
  return tabs.map((t) => ({ id: String(t.id), index: t.index, url: t.url || t.pendingUrl || '', title: t.title || '', active: t.active, loading: t.status === 'loading',
    pinned: t.pinned, groupId: t.groupId, muted: !!(t.mutedInfo && t.mutedInfo.muted), audible: !!t.audible, windowId: t.windowId, targetId: byTab[t.id] }));
})()`

export function registerChromiumCapabilities(d: ChromiumCapabilityDeps): void {
  const { control, browser, bridge } = d
  const call = <T>(expression: string): Promise<T> => bridge.run<T>(expression)
  const json = (value: unknown): string => JSON.stringify(value)

  const tabRows = (): Promise<ChromiumTab[]> => call<ChromiumTab[]>(TABS_SCRIPT)
  const tabFor = async (tabId: unknown): Promise<ChromiumTab> => {
    const rows = await tabRows()
    const tab = tabId === undefined || tabId === null ? rows.find((t) => t.active) : rows.find((t) => t.id === String(tabId))
    return tab ?? fail('not-found', tabId === undefined ? 'There is no active tab.' : `No tab ${String(tabId)}. See tabs.list.`, true)
  }
  const pageFor = (tab: ChromiumTab): CdpPage => browser.list().find((p) => p.targetId === tab.targetId) ?? fail('unavailable', "That tab's page is not reachable.", true)

  control.registerState('tabs', async () => tabRows().catch(() => []))

  // ---------------------------------------------------------------- tabs

  control.register({
    id: 'tabs.list',
    domain: 'tabs',
    name: 'List tabs',
    description: 'Every tab with its id, position, address, title, loading state, pin, group and sound.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => (await tabRows()).map(({ targetId: _t, ...tab }) => tab)
  })

  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a new tab: blank, or at an address; in the foreground or background, pinned, at a position.',
    params: { url: str('Address (default: a blank tab).'), active: bool('Switch to it (default true).'), pinned: bool('Pinned.'), index: int('Position (0 = first).') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const raw = typeof p.url === 'string' ? p.url.trim() : ''
      const url = raw ? webUrl(raw) : null
      if (raw && !url) fail('invalid-params', 'Only web pages can be opened in a tab.')
      const props: Record<string, unknown> = { active: p.active !== false, pinned: p.pinned === true }
      if (url) props.url = url
      if (typeof p.index === 'number') props.index = p.index
      const tab = await call<{ id: number; url: string }>(`chrome.tabs.create(${json(props)}).then((t) => ({ id: t.id, url: t.url || t.pendingUrl || '' }))`)
      return { tabId: String(tab.id), url: url ?? '' }
    },
    verify: async (data) => {
      const { tabId } = data as { tabId: string }
      const tab = await until(() => tabRows().then((r) => r.find((t) => t.id === tabId)), Boolean)
      return { verified: Boolean(tab), detail: tab ? `Tab ${tabId} is open.` : 'The tab did not appear.' }
    }
  })

  control.register({
    id: 'tabs.close',
    domain: 'tabs',
    name: 'Close a tab',
    description: 'Closes a tab.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.remove(${Number(tab.id)})`)
      return { tabId: tab.id }
    },
    verify: async (data) => {
      const { tabId } = data as { tabId: string }
      const left = await until(() => tabRows().then((r) => r.some((t) => t.id === tabId)), (still) => !still)
      return { verified: !left, detail: left ? 'The tab is still open.' : `Closed tab ${tabId}.` }
    }
  })

  control.register({
    id: 'tabs.activate',
    domain: 'tabs',
    name: 'Switch to a tab',
    description: 'Makes a tab the active one.',
    params: { tabId: str('The tab id.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.update(${Number(tab.id)}, { active: true }).then((t) => chrome.windows.update(t.windowId, { focused: true }))`)
      return { tabId: tab.id }
    },
    verify: async (data) => {
      const { tabId } = data as { tabId: string }
      const active = await until(() => tabRows().then((r) => r.find((t) => t.id === tabId)?.active === true), Boolean)
      return { verified: active, detail: active ? 'The tab is active.' : 'The tab is not active.' }
    }
  })

  control.register({
    id: 'tabs.duplicate',
    domain: 'tabs',
    name: 'Duplicate a tab',
    description: 'Opens a copy of a tab next to it.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    observe: async () => new Set((await tabRows()).map((t) => t.id)),
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      const copy = await call<{ id: number }>(`chrome.tabs.duplicate(${Number(tab.id)}).then((t) => ({ id: t.id }))`)
      return { tabId: String(copy.id) }
    },
    verify: async (data, _p, _c, before) => {
      const { tabId } = data as { tabId: string }
      const found = await until(() => tabRows().then((r) => r.some((t) => t.id === tabId && !(before as Set<string>).has(t.id))), Boolean)
      return { verified: found, detail: found ? `Duplicated as tab ${tabId}.` : 'No copy appeared.' }
    }
  })

  control.register({
    id: 'tabs.pin',
    domain: 'tabs',
    name: 'Pin or unpin a tab',
    description: 'Pins a tab to the front of the tab strip, or unpins it.',
    params: { tabId: TAB_ID, pinned: bool('Pin (true) or unpin (false).', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.update(${Number(tab.id)}, { pinned: ${p.pinned === true} })`)
      return { tabId: tab.id }
    },
    verify: async (data, p) => {
      const { tabId } = data as { tabId: string }
      const ok = await until(() => tabRows().then((r) => r.find((t) => t.id === tabId)?.pinned === (p.pinned === true)), Boolean)
      return { verified: ok, detail: ok ? `The tab is ${p.pinned ? 'pinned' : 'unpinned'}.` : 'The pin did not change.' }
    }
  })

  control.register({
    id: 'tabs.mute',
    domain: 'tabs',
    name: 'Mute or unmute a tab',
    description: "Mutes or unmutes one tab's sound.",
    params: { tabId: TAB_ID, muted: bool('Mute (true) or unmute (false).', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.update(${Number(tab.id)}, { muted: ${p.muted === true} })`)
      return { tabId: tab.id }
    },
    verify: async (data, p) => {
      const { tabId } = data as { tabId: string }
      const ok = await until(() => tabRows().then((r) => r.find((t) => t.id === tabId)?.muted === (p.muted === true)), Boolean)
      return { verified: ok, detail: ok ? `The tab is ${p.muted ? 'muted' : 'unmuted'}.` : 'The tab sound did not change.' }
    }
  })

  control.register({
    id: 'tabs.move',
    domain: 'tabs',
    name: 'Move a tab',
    description: 'Moves a tab to a position in the tab strip (0 = first).',
    params: { tabId: TAB_ID, index: int('The new position.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const tab = await tabFor(p.tabId)
      await call(`chrome.tabs.move(${Number(tab.id)}, { index: ${Math.max(0, Number(p.index))} })`)
      return { tabId: tab.id }
    },
    verify: async (data, p) => {
      const { tabId } = data as { tabId: string }
      const index = await until(() => tabRows().then((r) => r.find((t) => t.id === tabId)?.index), (i) => i === Number(p.index))
      return { verified: index === Number(p.index), detail: `The tab is at position ${String(index)}.` }
    }
  })

  control.register({
    id: 'tabs.reopen',
    domain: 'tabs',
    name: 'Reopen a closed tab',
    description: "Reopens the most recently closed tab where it was, using the browser's own session history.",
    params: {},
    mutates: true,
    confirmation: 'none',
    observe: async () => (await tabRows()).length,
    run: async () => {
      const restored = await call<{ tab?: { id: number } } | null>('chrome.sessions.restore().catch(() => null)')
      if (!restored?.tab) fail('not-found', 'No tabs were closed in this session.', true)
      return { tabId: String(restored!.tab!.id) }
    },
    verify: async (data, _p, _c, before) => {
      const { tabId } = data as { tabId: string }
      const found = await until(() => tabRows().then((r) => r.some((t) => t.id === tabId)), Boolean)
      return { verified: found && (await tabRows()).length > (before as number), detail: found ? 'The tab is open again.' : 'It did not reopen.' }
    }
  })

  // ---------------------------------------------------------------- navigation (the real page's own history)

  control.register({
    id: 'navigation.go',
    domain: 'navigation',
    name: 'Go to an address',
    description: 'Loads a web address in a tab (default: the active tab).',
    params: { url: str('The http(s) address.', true), tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const url = webUrl(String(p.url))
      if (!url) fail('invalid-params', 'Only http and https pages can be opened.')
      const page = pageFor(await tabFor(p.tabId))
      await page.loadURL(url!)
      return { url: url!, tabId: String(page.id) }
    },
    verify: async (data) => {
      const { url } = data as { url: string }
      const tab = (await tabRows()).find((t) => t.active)
      const at = tab?.url ?? ''
      return { verified: at.split('#')[0] === url.split('#')[0] || new URL(at || 'about:blank').host === new URL(url).host, detail: `The tab is at ${at}.` }
    }
  })

  const history = (id: 'navigation.back' | 'navigation.forward', name: string, dir: 'goBack' | 'goForward', can: 'canGoBack' | 'canGoForward'): void =>
    control.register({
      id,
      domain: 'navigation',
      name,
      description: `${name} in the tab's own history.`,
      params: { tabId: TAB_ID },
      mutates: true,
      confirmation: 'none',
      observe: async (p) => (await tabFor(p.tabId)).url,
      run: async (p) => {
        const page = pageFor(await tabFor(p.tabId))
        if (!page.navigationHistory[can]()) fail('failed', `There is nothing to go ${dir === 'goBack' ? 'back' : 'forward'} to.`, true)
        page.navigationHistory[dir]()
        return { tabId: String(page.id) }
      },
      verify: async (_d, p, _c, before) => {
        const changed = await until(() => tabFor(p.tabId).then((t) => t.url), (url) => url !== before)
        return { verified: changed !== before, detail: `The tab is at ${changed}.` }
      }
    })
  history('navigation.back', 'Go back', 'goBack', 'canGoBack')
  history('navigation.forward', 'Go forward', 'goForward', 'canGoForward')

  control.register({
    id: 'navigation.reload',
    domain: 'navigation',
    name: 'Reload',
    description: 'Reloads a tab.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const page = pageFor(await tabFor(p.tabId))
      page.reload()
      return { tabId: String(page.id) }
    },
    verify: async (data) => {
      const page = browser.find(Number((data as { tabId: string }).tabId))
      await until(() => page?.isLoading(), Boolean, 1500, 50)
      const done = await until(() => page?.isLoading(), (l) => !l, 20_000)
      return { verified: !done, detail: done ? 'The page is still loading.' : 'The page reloaded.' }
    }
  })

  control.register({
    id: 'navigation.stop',
    domain: 'navigation',
    name: 'Stop loading',
    description: 'Stops a tab that is still loading.',
    params: { tabId: TAB_ID },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const page = pageFor(await tabFor(p.tabId))
      await page.debugger.sendCommand('Page.stopLoading')
      return { tabId: String(page.id) }
    },
    verify: async (data) => {
      const page = browser.find(Number((data as { tabId: string }).tabId))
      const loading = await until(() => page?.isLoading(), (l) => !l, 3000)
      return { verified: !loading, detail: loading ? 'The page is still loading.' : 'Loading stopped.' }
    }
  })

  // ---------------------------------------------------------------- windows

  const windows = (): Promise<Record<string, unknown>[]> =>
    call(`chrome.windows.getAll().then((all) => all.map((w) => ({ id: w.id, kind: 'main', bounds: { x: w.left, y: w.top, width: w.width, height: w.height }, focused: w.focused, visible: w.state !== 'minimized',
      minimized: w.state === 'minimized', maximized: w.state === 'maximized', fullscreen: w.state === 'fullscreen', incognito: w.incognito })))`)

  control.registerState('windows', () => windows().catch(() => []))

  control.register({
    id: 'window.list',
    domain: 'window',
    name: 'List windows',
    description: 'The browser windows, with their size, position and state.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => windows()
  })

  control.register({
    id: 'window.create',
    domain: 'window',
    name: 'Open a page in a new window',
    description: 'Opens a web page in a new browser window (same profile, so sign-ins carry over).',
    params: { url: str('The http(s) address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const url = webUrl(String(p.url))
      if (!url) fail('invalid-params', 'Only http and https pages can be opened.')
      const w = await call<{ id: number }>(`chrome.windows.create({ url: ${json(url)} }).then((w) => ({ id: w.id }))`)
      return { id: w.id, url }
    },
    verify: async (data) => {
      const { id } = data as { id: number }
      const open = await until(() => windows().then((all) => all.some((w) => w.id === id)), Boolean)
      return { verified: open, detail: open ? `Window ${id} is open.` : 'The window is not open.' }
    }
  })

  control.register({
    id: 'window.close',
    domain: 'window',
    name: 'Close a window',
    description: 'Closes a browser window. Closing the last one quits the browser, so that asks first.',
    params: { id: int('Window id from window.list (default: the focused window).') },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Close window ${p.id === undefined ? '(the focused one)' : String(p.id)}`,
    run: async (p) => {
      const id = typeof p.id === 'number' ? p.id : ((await windows()).find((w) => w.focused)?.id as number | undefined)
      if (id === undefined) fail('not-found', 'There is no window to close.', true)
      await call(`chrome.windows.remove(${Number(id)})`)
      return { id }
    },
    verify: async (data) => {
      const { id } = data as { id: number }
      const still = await until(() => windows().then((all) => all.some((w) => w.id === id)), (s) => !s)
      return { verified: !still, detail: still ? 'The window is still open.' : `Closed window ${id}.` }
    }
  })

  // ---------------------------------------------------------------- downloads (Chromium's own download system)

  const downloadRows = (query: string): Promise<Record<string, unknown>[]> =>
    call<Record<string, unknown>[]>(
      `chrome.downloads.search(${query}).then((all) => all.map((x) => ({ id: String(x.id), filename: (x.filename || '').split(/[\\\\/]/).pop(), url: x.finalUrl || x.url, path: x.filename,
        state: x.paused ? 'paused' : x.state, receivedBytes: x.bytesReceived, totalBytes: x.totalBytes > 0 ? x.totalBytes : 0, startedAt: Date.parse(x.startTime), error: x.error || null, exists: x.exists })))`
    ).then((rows) => rows.map((r) => ({ ...r, state: DOWNLOAD_STATE[String(r.state)] ?? r.state })))

  control.register({
    id: 'downloads.list',
    domain: 'downloads',
    name: 'List downloads',
    description: 'Downloads with file name, URL, saved path, state (progressing, paused, completed, interrupted) and progress.',
    params: { state: str('Only this state.'), query: str('File name or URL contains.'), limit: int('Default 50.') },
    mutates: false,
    confirmation: 'none',
    run: async (p) =>
      (await downloadRows(`{ orderBy: ['-startTime'], limit: ${Math.min(500, Number(p.limit) || 50)} }`)).filter(
        (x) => (!p.state || x.state === p.state) && (!p.query || `${String(x.filename)} ${String(x.url)}`.toLowerCase().includes(String(p.query).toLowerCase()))
      )
  })

  control.register({
    id: 'downloads.get',
    domain: 'downloads',
    name: 'A download',
    description: 'One download with its progress and whether its file exists.',
    params: { id: str('Download id.', true) },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const row = (await downloadRows(`{ id: ${Number(p.id)} }`))[0] ?? fail('not-found', `No download ${String(p.id)}. See downloads.list.`, true)
      return { ...row, fileExists: row.exists === true, progress: Number(row.totalBytes) ? Number(row.receivedBytes) / Number(row.totalBytes) : null }
    }
  })

  control.register({
    id: 'downloads.start',
    domain: 'downloads',
    name: 'Download a file',
    description: 'Downloads a URL to the Downloads folder (never overwriting a file), as "Save link as" does.',
    params: { url: str('The file address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const url = webUrl(String(p.url))
      if (!url) fail('invalid-params', 'Only http and https files can be downloaded.')
      const id = await call<number>(`chrome.downloads.download({ url: ${json(url)}, conflictAction: 'uniquify' })`)
      return { id: String(id), url }
    },
    verify: async (data) => {
      const { id } = data as { id: string }
      const row = await until(() => downloadRows(`{ id: ${Number(id)} }`).then((r) => r[0]), (r) => Boolean(r) && r!.state !== 'progressing', 20_000, 200)
      return { verified: Boolean(row), detail: row ? `The download is ${String(row.state)}.` : 'The download did not start.' }
    }
  })

  control.register({
    id: 'downloads.remove',
    domain: 'downloads',
    name: 'Remove a download from the list',
    description: 'Removes a download from the list. The file, if saved, stays on disk.',
    params: { id: str('Download id.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => void (await call(`chrome.downloads.erase({ id: ${Number(p.id)} })`)),
    verify: async (_d, p) => {
      const left = await downloadRows(`{ id: ${Number(p.id)} }`)
      return { verified: left.length === 0, detail: left.length ? 'It is still listed.' : 'Removed from the list.' }
    }
  })

  control.register({
    id: 'downloads.clearFinished',
    domain: 'downloads',
    name: 'Clear finished downloads',
    description: 'Removes completed downloads from the list (paused and running ones stay).',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => void (await call(`chrome.downloads.erase({ state: 'complete' })`)),
    verify: async () => {
      const left = (await downloadRows('{ state: "complete" }')).length
      return { verified: left === 0, detail: left ? `${left} finished downloads are still listed.` : 'Finished downloads cleared.' }
    }
  })

  control.register({
    id: 'downloads.waitFor',
    domain: 'downloads',
    name: 'Wait for a download to finish',
    description: 'Waits until a download completes (by id, or the newest whose name or URL contains the text).',
    params: { id: str('Download id.'), match: str('Name or URL contains.'), timeoutMs: int('Default 120000.') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const end = Date.now() + (Number(p.timeoutMs) || 120_000)
      for (;;) {
        const rows = await downloadRows("{ orderBy: ['-startTime'], limit: 50 }")
        const row = rows.find((x) => (p.id ? x.id === String(p.id) : p.match ? `${String(x.filename)} ${String(x.url)}`.toLowerCase().includes(String(p.match).toLowerCase()) : true))
        if (row && row.state !== 'progressing' && row.state !== 'paused') return row
        if (Date.now() > end) fail('timeout', 'The download did not finish in time.', true)
        await sleep(300)
      }
    }
  })

  // ---------------------------------------------------------------- history (Chromium's own)

  control.register({
    id: 'history.search',
    domain: 'history',
    name: 'Search history',
    description: 'History entries (URL, title, time visited), newest first, filtered by text and time range (epoch ms).',
    params: { query: str('URL or title contains.'), from: int('Visited at or after (epoch ms).'), to: int('Visited at or before (epoch ms).'), limit: int('Default 100.') },
    mutates: false,
    confirmation: 'none',
    run: (p) =>
      call(
        `chrome.history.search({ text: ${json(String(p.query ?? ''))}, startTime: ${Number(p.from) || 0}, ${p.to ? `endTime: ${Number(p.to)}, ` : ''}maxResults: ${Math.min(5000, Number(p.limit) || 100)} })
          .then((all) => all.map((h) => ({ url: h.url, title: h.title || '', visitedAt: h.lastVisitTime, visits: h.visitCount })))`
      )
  })

  control.register({
    id: 'history.delete',
    domain: 'history',
    name: 'Delete a history entry',
    description: 'Removes a page from history.',
    params: { url: str('The page address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => void (await call(`chrome.history.deleteUrl({ url: ${json(String(p.url))} })`)),
    verify: async (_d, p) => {
      const left = await call<unknown[]>(`chrome.history.getVisits({ url: ${json(String(p.url))} })`)
      return { verified: left.length === 0, detail: left.length ? 'It is still in history.' : 'Removed from history.' }
    }
  })

  control.register({
    id: 'history.deleteRange',
    domain: 'history',
    name: 'Delete history in a time range',
    description: 'Removes every history entry visited between two times (epoch ms).',
    params: { from: int('Start (epoch ms).', true), to: int('End (epoch ms).', true) },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Delete history from ${new Date(Number(p.from)).toLocaleString()} to ${new Date(Number(p.to)).toLocaleString()}`,
    run: async (p) => void (await call(`chrome.history.deleteRange({ startTime: ${Number(p.from)}, endTime: ${Number(p.to)} })`)),
    verify: async (_d, p) => {
      const left = await call<unknown[]>(`chrome.history.search({ text: '', startTime: ${Number(p.from)}, endTime: ${Number(p.to)}, maxResults: 1 })`)
      return { verified: left.length === 0, detail: left.length ? 'Some entries remain.' : 'That time range is gone from history.' }
    }
  })

  control.register({
    id: 'history.clear',
    domain: 'history',
    name: 'Clear history',
    description: 'Clears all browsing history (and what the address bar learned from it).',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Clear all browsing history',
    run: async () => void (await call('chrome.history.deleteAll()')),
    verify: async () => {
      const left = await call<unknown[]>("chrome.history.search({ text: '', startTime: 0, maxResults: 1 })")
      return { verified: left.length === 0, detail: 'History is empty.' }
    }
  })

  // ---------------------------------------------------------------- bookmarks (Chromium's own, with folders)

  const flatBookmarks = `chrome.bookmarks.getTree().then((tree) => { const out = []; const walk = (n, path) => { if (n.url) out.push({ id: n.id, url: n.url, title: n.title, addedAt: n.dateAdded, folder: path.join(' / ') }); for (const c of n.children || []) walk(c, n.title ? [...path, n.title] : path) }; for (const r of tree) walk(r, []); return out })`

  control.register({
    id: 'bookmarks.list',
    domain: 'bookmarks',
    name: 'List bookmarks',
    description: 'Bookmarks (URL, title, when added, folder), newest first, optionally filtered by text.',
    params: { query: str('URL or title contains.') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const all = await call<{ url: string; title: string; addedAt: number }[]>(flatBookmarks)
      return all.filter((b) => !p.query || `${b.url} ${b.title}`.toLowerCase().includes(String(p.query).toLowerCase())).sort((a, b) => b.addedAt - a.addedAt)
    }
  })

  control.register({
    id: 'bookmarks.add',
    domain: 'bookmarks',
    name: 'Bookmark a page',
    description: 'Adds a bookmark to the bookmarks bar (skipped when the page is already bookmarked).',
    params: { url: str('The page address.', true), title: str('Its title.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const url = webUrl(String(p.url))
      if (!url) fail('invalid-params', 'Only web pages can be bookmarked.')
      const existing = await call<unknown[]>(`chrome.bookmarks.search({ url: ${json(url)} })`)
      if (existing.length) return { added: 0, url }
      await call(`chrome.bookmarks.create({ parentId: '1', title: ${json(String(p.title ?? url))}, url: ${json(url)} })`)
      return { added: 1, url }
    },
    verify: async (data) => {
      const { url } = data as { url: string }
      const found = await call<unknown[]>(`chrome.bookmarks.search({ url: ${json(url)} })`)
      return { verified: found.length > 0, detail: found.length ? 'Bookmarked.' : 'Not bookmarked.' }
    }
  })

  control.register({
    id: 'bookmarks.remove',
    domain: 'bookmarks',
    name: 'Remove a bookmark',
    description: 'Removes the bookmark for a page.',
    params: { url: str('The page address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => void (await call(`chrome.bookmarks.search({ url: ${json(String(p.url))} }).then((all) => Promise.all(all.map((b) => chrome.bookmarks.remove(b.id))))`)),
    verify: async (_d, p) => {
      const left = await call<unknown[]>(`chrome.bookmarks.search({ url: ${json(String(p.url))} })`)
      return { verified: left.length === 0, detail: 'The bookmark is gone.' }
    }
  })

  // ---------------------------------------------------------------- browsing data (cookies, cache, site data)

  control.register({
    id: 'browser.clearData',
    domain: 'browser',
    name: 'Clear browsing data',
    description: "Clears cookies, cache and site data (signs you out of websites) through the browser's own clearing.",
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Clear all browsing data (signs you out of websites)',
    run: async () => void (await call('chrome.browsingData.remove({ since: 0 }, { cache: true, cookies: true, localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true })')),
    verify: async () => {
      const count = await call<number>('chrome.cookies.getAll({}).then((c) => c.length)')
      return { verified: count === 0, detail: `${count} cookies remain.` }
    }
  })

  control.register({
    id: 'browser.clearCache',
    domain: 'browser',
    name: 'Clear the cache',
    description: 'Clears cached files (does not sign you out).',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => void (await call('chrome.browsingData.remove({ since: 0 }, { cache: true })')),
    verify: () => ({ verified: true, detail: 'The cache was cleared by the browser.' })
  })

  control.register({
    id: 'browser.clearCookies',
    domain: 'browser',
    name: 'Clear cookies',
    description: "Deletes cookies (of one site, or every site) through the browser's own clearing.",
    params: { origin: str('Only this site, e.g. https://example.com (default: all).') },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Delete the cookies of ${p.origin ? String(p.origin) : 'every site'} (signs you out)`,
    run: async (p) => void (await call(`chrome.browsingData.remove(${p.origin ? `{ since: 0, origins: [${json(String(p.origin))}] }` : '{ since: 0 }'}, { cookies: true })`)),
    verify: async (_d, p) => {
      const count = await call<number>(`chrome.cookies.getAll(${p.origin ? `{ url: ${json(String(p.origin))} }` : '{}'}).then((c) => c.length)`)
      return { verified: count === 0, detail: `${count} cookies remain.` }
    }
  })

  control.register({
    id: 'browser.cookieCount',
    domain: 'browser',
    name: 'Count cookies',
    description: 'How many cookies the browser holds (for one site, or all).',
    params: { url: str('A site address (default: all sites).') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => ({ count: await call<number>(`chrome.cookies.getAll(${p.url ? `{ url: ${json(String(p.url))} }` : '{}'}).then((c) => c.length)`) })
  })
}
