import type { ParamSpec } from '../../shared/browserControl.ts'
import { BrowserControl, fail } from '../browserControl/registry.ts'
import { PERIOD_NAMES, readSpan } from '../../shared/timePeriod.ts'
import type { Span } from '../../shared/timePeriod.ts'
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
const int = (description: string, required = false, range?: { min?: number; max?: number }): ParamSpec => ({ type: 'integer', description, required, ...range })
const TAB_ID = str('The tab id from tabs.list (default: the active tab).')

/**
 * The stretch of time a plan asked for, or a refusal saying which names exist.
 *
 * A function rather than a check at each call site, because `fail` is an arrow and TypeScript will not narrow a union
 * after calling one -- so without this every use of a span needed a cast, and a cast is how a missing period becomes
 * `undefined` inside a query that then quietly means "from the beginning of time".
 */
const spanFor = (p: Record<string, unknown>): Span => {
  const span = readSpan(p, Date.now())
  if ('problem' in span) return fail('invalid-params', span.problem)
  return span
}

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
  /**
   * Reduces locked tabs to what they may say, before a listing leaves this layer.
   *
   * A locked tab is not hidden from a listing -- it appears, marked locked, with no address and a neutral title. Hiding it
   * outright would mean one locked tab made Orion's picture of the browser wrong, and a wrong picture is worse than a
   * withheld one. Left out entirely, nothing is redacted, which is how this behaved before tab locking existed.
   */
  redactTabs?<T extends { id: string; url: string; title: string }>(rows: T[]): (T & { locked: boolean })[]
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

  /** Rows as anything outside this layer is allowed to see them. Every listing goes through here; actions do not, because a locked tab is refused before an action runs. */
  const safeRows = async (): Promise<unknown[]> => {
    const rows = await tabRows().catch(() => [])
    const shown = rows.map(({ targetId: _t, ...tab }) => tab)
    return d.redactTabs ? d.redactTabs(shown) : shown
  }

  control.registerState('tabs', () => safeRows())

  // ---------------------------------------------------------------- tabs

  control.register({
    id: 'tabs.list',
    domain: 'tabs',
    name: 'List tabs',
    description: 'Every tab with its id, position, address, title, loading state, pin, group and sound.',
    keywords: ['what is open', 'open tabs', 'which tabs', 'all tabs', 'every tab'],
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => safeRows()
  })

  control.register({
    id: 'tabs.create',
    domain: 'tabs',
    name: 'Open a tab',
    description: 'Opens a new tab: blank, or at an address; in the foreground or background, pinned, at a position.',
    params: { url: str('Address (default: a blank tab).'), active: bool('Switch to it (default true).'), pinned: bool('Pinned.'), index: int('Position (0 = first).', false, { min: 0 }) },
    mutates: true,
    confirmation: 'none',
    // Which tab, in the words an approval prompt, the log and the list of things that can be put back all use.
    describe: (p) => (p.url ? `Open ${String(p.url)} in a new tab` : 'Open a blank tab'),
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
    },
    // Opening a tab is put back by closing that tab, and only that one.
    undo: ({ data }) => {
      const { tabId } = data as { tabId: string }
      return tabId ? { capability: 'tabs.close', params: { tabId } } : null
    }
  })

  control.register({
    id: 'tabs.close',
    domain: 'tabs',
    name: 'Close a tab',
    description: 'Closes one tab. The id comes from tabs.list; with none, the active tab. tabs.reopen brings a closed tab back.',
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
    description: 'Switches to a tab, bringing it in front and focusing its window. This is what “go to that tab”, “switch to the YouTube tab” and “bring it up” mean.',
    params: { tabId: str('The tab id.', true) },
    mutates: true,
    confirmation: 'none',
    already: async (p) => {
      const tab = await tabFor(p.tabId)
      // Switching to the tab you are on is a step that should say so rather than one that appears to have done work.
      return tab.active ? 'That tab was already the one in front.' : null
    },
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
    description: 'Opens a second copy of a tab beside it, at the same address, leaving the original where it is.',
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
    already: async (p) => {
      const tab = await tabFor(p.tabId)
      return tab.pinned === (p.pinned === true) ? `That tab was already ${p.pinned ? 'pinned' : 'unpinned'}.` : null
    },
    // What it was before, read before the change so putting it back is a fact rather than the opposite of what was asked.
    observe: async (p) => (await tabFor(p.tabId)).pinned === true,
    undo: ({ data, before }) => {
      const { tabId } = data as { tabId: string }
      return tabId ? { capability: 'tabs.pin', params: { tabId, pinned: before === true } } : null
    },
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
    description: 'Mutes or unmutes one tab\'s sound. The tab keeps playing — only the sound stops, so this does not pause a video.',
    params: { tabId: TAB_ID, muted: bool('Mute (true) or unmute (false).', true) },
    mutates: true,
    confirmation: 'none',
    /*
     * Read first, so a tab that is already quiet is left quiet.
     *
     * Not because writing it twice would break anything here -- this sets a value rather than flipping one -- but
     * because "the tab was already muted" is the true answer and "I muted the tab" is not. A plan that cannot tell the
     * two apart is a plan that cannot notice it was wrong about the state.
     */
    already: async (p) => {
      const tab = await tabFor(p.tabId)
      return tab.muted === (p.muted === true) ? `That tab was already ${p.muted ? 'muted' : 'unmuted'}.` : null
    },
    observe: async (p) => (await tabFor(p.tabId)).muted === true,
    undo: ({ data, before }) => {
      const { tabId } = data as { tabId: string }
      return tabId ? { capability: 'tabs.mute', params: { tabId, muted: before === true } } : null
    },
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
    params: { tabId: TAB_ID, index: int('The new position.', true, { min: 0 }) },
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

  const history = (id: 'navigation.back' | 'navigation.forward', name: string, dir: 'goBack' | 'goForward', can: 'canGoBack' | 'canGoForward', what: string): void =>
    control.register({
      id,
      domain: 'navigation',
      name,
      description: what,
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
  history(
    'navigation.back',
    'Go back',
    'goBack',
    'canGoBack',
    "Goes back to the previous page in a tab's own history, as the browser's back button does. Fails when there is nothing behind it."
  )
  history(
    'navigation.forward',
    'Go forward',
    'goForward',
    'canGoForward',
    "Goes forward again after going back, as the browser's forward button does. Fails when nothing was gone back from."
  )

  control.register({
    id: 'navigation.reload',
    domain: 'navigation',
    name: 'Reload',
    description: 'Reloads a tab, optionally ignoring the cache (a hard reload), as the browser\'s reload button does.',
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
    description: 'Stops a tab that is still loading and leaves whatever arrived in place, as the browser\'s stop button does.',
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
    keywords: ['downloaded', 'download list', 'files i got', 'saved files'],
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
      const row = await until(() => downloadRows(`{ id: ${Number(id)} }`).then((r) => r[0]), Boolean, 5000, 100)
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
    description: `History entries (URL, title, time visited), newest first, filtered by text and by a stretch of time -- a name (${PERIOD_NAMES.join(', ')}) or exact epoch milliseconds. This is the right capability for "what did I visit yesterday" and "find the page I was reading about physics": read history, do not search the web.`,
    keywords: ['visited', 'visit', 'read', 'reading', 'looked at', 'been to', 'earlier', 'yesterday', 'previously', 'before', 'recently', 'browsing history'],
    params: {
      query: str('URL or title contains.'),
      period: str(`Only this stretch: ${PERIOD_NAMES.join(', ')}.`),
      from: int('Visited at or after (epoch ms).'),
      to: int('Visited at or before (epoch ms).'),
      limit: int('Default 100.')
    },
    mutates: false,
    confirmation: 'none',
    run: (p) => {
      /*
       * A period narrows a read, and its absence does not.
       *
       * Unlike deleting, where no stretch of time has to be an error: a search with no range is the whole of history,
       * which is harmless and is what somebody asking "have I ever been here" means.
       */
      const span = p.period === undefined || p.period === null || p.period === '' ? null : spanFor(p)
      const from = span ? span.from : Number(p.from) || 0
      const to = span ? span.to : typeof p.to === 'number' ? Number(p.to) : null
      return call(
        `chrome.history.search({ text: ${json(String(p.query ?? ''))}, startTime: ${from}, ${to !== null ? `endTime: ${to}, ` : ''}maxResults: ${Math.min(5000, Number(p.limit) || 100)} })
          .then((all) => all.map((h) => ({ url: h.url, title: h.title || '', visitedAt: h.lastVisitTime, visits: h.visitCount })))`
      )
    }
  })

  control.register({
    id: 'history.delete',
    domain: 'history',
    name: 'Delete a history entry',
    description: 'Removes one page from browsing history, by its address. For a stretch of time, use history.deleteRange.',
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
    name: 'Delete history for a stretch of time',
    description: `Removes every history entry visited in a named stretch of time -- ${PERIOD_NAMES.join(', ')} -- or between two exact times. This is what "clear today's history", "clear the last hour" and "delete yesterday's history" mean. Cookies, downloads and bookmarks are left alone; browser.clearData is what touches those.`,
    keywords: ['clear history', 'delete history', 'wipe history', 'today', 'yesterday', 'last hour', 'this week'],
    params: {
      period: str(`Which stretch: ${PERIOD_NAMES.join(', ')}.`),
      from: int('Start (epoch ms), instead of a period.'),
      to: int('End (epoch ms), instead of a period.')
    },
    mutates: true,
    confirmation: 'always',
    /*
     * The confirmation says the stretch back in the person's own words.
     *
     * "Delete history from 01/10/2026, 00:00:00 to 01/10/2026, 14:31:07" is a true sentence that nobody can check at a
     * glance. "Delete today's history (since midnight)" is the thing they asked for, which is what a confirmation is
     * for -- and if the period was misread, this is where they see it.
     */
    describe: (p) => {
      const span = readSpan(p, Date.now())
      return 'problem' in span ? 'Delete history' : `Delete history for ${span.what}`
    },
    run: async (p) => {
      const span = spanFor(p)
      await call(`chrome.history.deleteRange({ startTime: ${span.from}, endTime: ${span.to} })`)
      return { from: span.from, to: span.to, what: span.what }
    },
    verify: async (data) => {
      const { from, to, what } = data as { from: number; to: number; what: string }
      const left = await call<unknown[]>(`chrome.history.search({ text: '', startTime: ${from}, endTime: ${to}, maxResults: 1 })`)
      return { verified: left.length === 0, detail: left.length ? 'Some entries remain.' : `${what} is gone from history.` }
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
    keywords: ['favourites', 'favorites', 'saved pages', 'bookmarked'],
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
    describe: (p) => `Bookmark ${String(p.title || p.url)}`,
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
    },
    /*
     * Only when this call is the one that added it.
     *
     * Bookmarking a page that was already bookmarked changes nothing, and "undoing" that would delete a bookmark the
     * person made themselves, possibly years ago. `added` is 0 in that case and nothing is offered.
     */
    undo: ({ data }) => {
      const { added, url } = data as { added: number; url: string }
      return added > 0 && url ? { capability: 'bookmarks.remove', params: { url } } : null
    }
  })

  control.register({
    id: 'bookmarks.remove',
    domain: 'bookmarks',
    name: 'Remove a bookmark',
    description: 'Removes the bookmark for one page, leaving the page itself and the folder it was in alone.',
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
    description: `Clears cookies, cache and site data (signs you out of websites) through the browser's own clearing, for a named stretch of time (${PERIOD_NAMES.join(', ')}; default everything). Each kind can be left alone: "don't delete my cookies" means cookies false. History, bookmarks and downloads are never touched by this -- history.deleteRange is what clears history.`,
    params: {
      period: str(`Which stretch: ${PERIOD_NAMES.join(', ')}. Default: everything.`),
      cookies: bool('Cookies and site data, which signs you out of websites (default true).'),
      cache: bool('Cached files (default true).'),
      storage: bool('Local storage, databases and service workers (default true).')
    },
    mutates: true,
    confirmation: 'always',
    describe: (p) => {
      const kinds = [p.cookies !== false && 'cookies', p.cache !== false && 'cache', p.storage !== false && 'site data'].filter(Boolean).join(', ')
      const span = p.period ? readSpan(p, Date.now()) : null
      const when = span && !('problem' in span) ? ` for ${span.what}` : ''
      return `Clear ${kinds || 'nothing'}${when}${p.cookies !== false ? ' (signs you out of websites)' : ''}`
    },
    run: async (p) => {
      /*
       * No period means everything, because that is what this capability has always done.
       *
       * The opposite of history.deleteRange, where a missing period is an error -- and the difference is not an
       * inconsistency. This one existed before periods did, with "all of it" as its only behaviour; changing a missing
       * parameter from "everything" to a failure would break every existing caller, and the parameter is additive.
       */
      const span: Span = p.period ? spanFor(p) : { from: 0, to: Date.now(), period: 'everything', what: 'all of it' }
      const cookies = p.cookies !== false
      const kinds = {
        cache: p.cache !== false,
        cookies,
        localStorage: p.storage !== false,
        indexedDB: p.storage !== false,
        serviceWorkers: p.storage !== false,
        cacheStorage: p.storage !== false,
        fileSystems: p.storage !== false,
        webSQL: p.storage !== false
      }
      if (!Object.values(kinds).some(Boolean)) fail('invalid-params', 'Nothing was selected to clear.')
      await call(`chrome.browsingData.remove({ since: ${span.from} }, ${json(kinds)})`)
      return { cookies, what: span.what, since: span.from }
    },
    verify: async (data) => {
      const { cookies, what } = data as { cookies: boolean; what: string }
      /*
       * Cookies are the one kind of this that can be counted afterwards.
       *
       * And only when all of them were asked for: clearing the last hour leaves older cookies standing, so a non-zero
       * count is the correct outcome and treating it as failure would report a success as a failure. When the count
       * cannot settle the question, this says the browser did it rather than claiming to have checked.
       */
      if (!cookies) return { verified: true, detail: `The browser cleared ${what}.` }
      const count = await call<number>('chrome.cookies.getAll({}).then((c) => c.length)')
      if (what === 'all of it') return { verified: count === 0, detail: count ? `${count} cookies remain.` : 'No cookies remain.' }
      return { verified: true, detail: `The browser cleared ${what}; ${count} cookies from outside it remain.` }
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
