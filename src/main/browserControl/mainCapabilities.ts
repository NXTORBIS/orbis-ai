import { app, clipboard, ClipboardItem, nativeImage, webContents } from 'electron'
import { asPageHandle } from '../pageHandle'
import type { BrowserWindow, Session, WebContents } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { BrowserDownload, InstalledExtension, Settings, SettingsUpdate } from '../../shared/types'
import type { Condition, ParamSpec } from '../../shared/browserControl.ts'
import { readPath } from '../../shared/browserControl.ts'
import { shortcutActions } from '../browserShortcuts'
import type { BrowserLibrary } from '../browserLibrary'
import { uniqueDownloadName } from '../browserLibrary'
import type { BrowserIntegration } from '../browserIntegration'
import type { ExtensionsManager } from '../extensions/manager'
import type { Store } from '../store'
import type { OrbisAdBlock } from '../adblock/electron'
import { BrowserControl, fail } from './registry.ts'
import type { ControlContext } from './registry.ts'
import * as page from './page.ts'
import type { Locator } from './page.ts'
import { resolvePage } from './electronPages.ts'
import { compare } from './runner.ts'
import type { WindowControl } from './window.ts'

export interface NavigationRecord {
  url: string
  redirects: string[]
  loading: boolean
  failed?: { code: number; description: string; url: string }
  finishedAt?: number
  startedAt: number
}

export interface MainCapabilityDeps {
  control: BrowserControl
  windowControl: WindowControl
  getWindow(): BrowserWindow | null
  popOut(url: string): BrowserWindow | null
  popouts(): BrowserWindow[]
  store: Store
  onSettingsChanged(settings: Settings): void
  library: BrowserLibrary
  integration: BrowserIntegration
  extensions: ExtensionsManager
  openExtensionPopup(id: string): Promise<void>
  adblock(): OrbisAdBlock | null
  session: Session
  clearBrowsingData(): Promise<void>
  /** Delivers a browser command to the window exactly as its keyboard shortcut does. */
  sendShortcut(action: string, index?: number): boolean
  navigation(webContentsId: number): NavigationRecord | undefined
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Reads until `ok` holds or time runs out; returns the last value read. */
async function until<T>(read: () => T | Promise<T>, ok: (value: T) => boolean, ms = 2000, step = 100): Promise<T> {
  const end = Date.now() + ms
  let value = await read()
  while (!ok(value) && Date.now() < end) {
    await sleep(step)
    value = await read()
  }
  return value
}

const str = (description: string, required = false, extra: Partial<ParamSpec> = {}): ParamSpec => ({ type: 'string', description, required, ...extra })
const bool = (description: string, required = false): ParamSpec => ({ type: 'boolean', description, required })
const int = (description: string, required = false): ParamSpec => ({ type: 'integer', description, required })

/** Settings the control layer may change, and how each is checked. The API key is never settable this way. */
const SETTINGS: Record<string, { type: 'boolean' | 'string'; values?: string[]; description: string }> = {
  theme: { type: 'string', values: ['system', 'light', 'dark'], description: 'Appearance: system, light or dark.' },
  effects: { type: 'boolean', description: 'Animated background and motion effects.' },
  defaultModel: { type: 'string', description: 'The model new chats use.' },
  reasoningEffort: { type: 'string', values: ['low', 'high', 'max'], description: 'How much the model reasons by default.' },
  autoFallback: { type: 'boolean', description: 'Switch to another model when one is unavailable.' },
  assistantName: { type: 'string', description: "The assistant's name." },
  userName: { type: 'string', description: "The user's name." },
  userTitle: { type: 'string', description: 'How the assistant addresses the user.' },
  systemPrompt: { type: 'string', description: 'Custom instructions for every chat.' },
  searchSuggestions: { type: 'boolean', description: 'Address bar asks the search engine and Orion for predictions (sends typed text).' },
  personalizedSuggestions: { type: 'boolean', description: 'Address bar suggests from local history, searches and bookmarks.' },
  openBrowserOnLaunch: { type: 'boolean', description: 'Startup: open the browser instead of the chat.' }
}

/**
 * The main process's browser capabilities: windows, developer tools, settings, site permissions, browsing data,
 * downloads, history, bookmarks, clipboard, extensions, shortcuts, and the state/condition readers everything else
 * relies on. Each one acts through the same Orbis code the window's own controls use.
 */
export function registerMainCapabilities(d: MainCapabilityDeps): void {
  const { control, windowControl } = d
  const tab = (ctx: Pick<ControlContext, 'target'>): WebContents => resolvePage(ctx, windowControl, () => d.getWindow()?.webContents ?? null) as unknown as WebContents
  const noWindow = (): string | null => (d.getWindow() ? null : 'The Orbis window is not open.')

  // ---------------------------------------------------------------- windows

  const allWindows = (): { win: BrowserWindow; kind: 'main' | 'popout' }[] => {
    const main = d.getWindow()
    return [...(main && !main.isDestroyed() ? [{ win: main, kind: 'main' as const }] : []), ...d.popouts().filter((w) => !w.isDestroyed()).map((win) => ({ win, kind: 'popout' as const }))]
  }
  const describeWindow = ({ win, kind }: { win: BrowserWindow; kind: 'main' | 'popout' }): Record<string, unknown> => ({
    id: win.id,
    kind,
    title: win.getTitle(),
    ...(kind === 'popout' ? { url: win.webContents.getURL() } : {}),
    bounds: win.getBounds(),
    focused: win.isFocused(),
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen()
  })
  const windowById = (id: unknown): { win: BrowserWindow; kind: 'main' | 'popout' } => {
    const list = allWindows()
    if (id === undefined || id === null) return list.find((w) => w.kind === 'main') ?? fail('unavailable', 'The Orbis window is not open.')
    return list.find((w) => w.win.id === id) ?? fail('not-found', `No Orbis window with id ${String(id)}. See window.list.`, true)
  }
  const windowId: ParamSpec = { type: 'integer', description: 'Window id from window.list (default: the main Orbis window).' }

  control.registerState('windows', () => allWindows().map(describeWindow))

  control.register({
    id: 'window.list',
    domain: 'window',
    name: 'List windows',
    description: 'The Orbis window and any pop-out browser windows, with their size, position and state.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => allWindows().map(describeWindow)
  })

  control.register({
    id: 'window.create',
    domain: 'window',
    name: 'Open a page in a new window',
    description: 'Opens a web page in a separate Orbis browser window (same session, so sign-ins carry over).',
    params: { url: str('The http(s) address.', true) },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      const url = page.toWebUrl(String(p.url))
      if (!url) fail('invalid-params', 'Only http and https pages can be opened.')
      const win = d.popOut(url!) ?? fail('failed', "The window couldn't be opened.")
      return { id: win.id, url }
    },
    verify: async (data) => {
      const { id } = data as { id: number }
      const exists = await until(() => d.popouts().find((w) => w.id === id && !w.isDestroyed()), Boolean, 1500)
      return { verified: Boolean(exists), detail: exists ? `Window ${id} is open at ${exists.webContents.getURL() || 'its page'}.` : 'The window is not open.' }
    }
  })

  control.register({
    id: 'window.close',
    domain: 'window',
    name: 'Close a window',
    description: 'Closes a pop-out window, or the main Orbis window (which quits Orbis, so it asks first).',
    params: { id: windowId },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => (windowById(p.id).kind === 'main' ? 'Close the Orbis window (quits Orbis)' : `Close window ${String(p.id)}`),
    assess: (p) => (windowById(p.id).kind === 'main' ? { decision: 'confirm', reason: 'Closing the main window quits Orbis.' } : { decision: 'run', reason: '' }),
    run: (p) => {
      const { win } = windowById(p.id)
      const id = win.id
      win.close()
      return { id }
    },
    verify: async (data) => {
      const { id } = data as { id: number }
      const gone = await until(() => !allWindows().some((w) => w.win.id === id), Boolean, 2000)
      return { verified: gone, detail: gone ? 'The window closed.' : 'The window is still open (it may be asking to stay open).' }
    }
  })

  const windowState = (name: string, id: string, description: string, act: (win: BrowserWindow, p: Record<string, unknown>) => void, check: (win: BrowserWindow, p: Record<string, unknown>) => boolean, extra: Record<string, ParamSpec> = {}): void =>
    control.register({
      id,
      domain: 'window',
      name,
      description,
      params: { id: windowId, ...extra },
      mutates: true,
      confirmation: 'none',
      unavailable: noWindow,
      run: (p) => {
        const { win } = windowById(p.id)
        act(win, p)
        return { id: win.id }
      },
      verify: async (data, p) => {
        const win = allWindows().find((w) => w.win.id === (data as { id: number }).id)?.win
        if (!win) return { verified: false, detail: 'The window closed.' }
        const ok = await until(() => check(win, p), Boolean, 2000)
        return { verified: ok, detail: `${name}: ${JSON.stringify(describeWindow({ win, kind: win === d.getWindow() ? 'main' : 'popout' }))}` }
      }
    })

  windowState('Minimize', 'window.minimize', 'Minimizes a window.', (w) => w.minimize(), (w) => w.isMinimized())
  windowState('Maximize', 'window.maximize', 'Maximizes a window.', (w) => (w.isMinimized() && w.restore(), w.maximize()), (w) => w.isMaximized())
  windowState('Restore', 'window.restore', 'Restores a minimized, maximized or fullscreen window to its normal size.', (w) => {
    if (w.isFullScreen()) w.setFullScreen(false)
    if (w.isMinimized()) w.restore()
    if (w.isMaximized()) w.unmaximize()
  }, (w) => !w.isMinimized() && !w.isMaximized() && !w.isFullScreen())
  windowState('Fullscreen', 'window.fullscreen', 'Turns fullscreen on or off (default: toggles).', (w, p) => w.setFullScreen(typeof p.on === 'boolean' ? p.on : !w.isFullScreen()), (w, p) => (typeof p.on === 'boolean' ? w.isFullScreen() === p.on : true), { on: bool('true for fullscreen, false to leave it.') })
  windowState('Focus', 'window.focus', 'Brings a window to the front and focuses it.', (w) => {
    if (w.isMinimized()) w.restore()
    w.show()
    w.focus()
  }, (w) => w.isVisible() && !w.isMinimized())
  windowState('Resize', 'window.resize', 'Sets a window’s size (Orbis’s minimum size still applies).', (w, p) => {
    if (w.isMaximized()) w.unmaximize()
    w.setSize(Math.round(Number(p.width)), Math.round(Number(p.height)))
  }, (w, p) => {
    const [width, height] = w.getSize()
    const [minW, minH] = w.getMinimumSize()
    return Math.abs(width - Math.max(Number(p.width), minW)) <= 2 && Math.abs(height - Math.max(Number(p.height), minH)) <= 2
  }, { width: int('Width in pixels.', true), height: int('Height in pixels.', true) })
  windowState('Move', 'window.move', 'Moves a window to a screen position.', (w, p) => {
    if (w.isMaximized()) w.unmaximize()
    w.setPosition(Math.round(Number(p.x)), Math.round(Number(p.y)))
  }, (w, p) => {
    const [x, y] = w.getPosition()
    return Math.abs(x - Number(p.x)) <= 2 && Math.abs(y - Number(p.y)) <= 2
  }, { x: int('Left edge.', true), y: int('Top edge.', true) })

  // ---------------------------------------------------------------- navigation details (event-recorded, read on demand)

  control.register({
    id: 'navigation.info',
    domain: 'navigation',
    name: "A tab's navigation details",
    description: "The tab's URL, whether it is loading, the redirects of its last navigation, its last load failure, and its back/forward history.",
    params: {},
    mutates: false,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (_p, ctx) => {
      const wc = tab(ctx)
      const record = d.navigation(wc.id)
      const history = wc.navigationHistory
      return {
        url: wc.getURL(),
        title: wc.getTitle(),
        loading: wc.isLoading(),
        redirects: record?.redirects ?? [],
        failed: record?.failed ?? null,
        lastFinishedAt: record?.finishedAt ?? null,
        canGoBack: history.canGoBack(),
        canGoForward: history.canGoForward(),
        entries: history.getAllEntries().slice(-20).map((e) => ({ url: e.url, title: e.title })),
        currentIndex: history.getActiveIndex()
      }
    }
  })

  // ---------------------------------------------------------------- developer tools and advanced

  const tabParams = {}
  control.register({
    id: 'devtools.open',
    domain: 'devtools',
    name: 'Open developer tools',
    description: "Opens the tab's developer tools.",
    params: { mode: str('right, bottom, undocked or detach', false, { enum: ['right', 'bottom', 'undocked', 'detach'] }), ...tabParams },
    mutates: true,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (p, ctx) => {
      const wc = tab(ctx)
      wc.openDevTools({ mode: (p.mode as 'right' | 'bottom' | 'undocked' | 'detach') ?? 'detach' })
      return { webContentsId: wc.id }
    },
    verify: async (_d, _p, ctx) => {
      const open = await until(() => tab(ctx).isDevToolsOpened(), Boolean, 3000)
      return { verified: open, detail: open ? 'Developer tools are open.' : 'Developer tools did not open.' }
    }
  })

  control.register({
    id: 'devtools.close',
    domain: 'devtools',
    name: 'Close developer tools',
    description: "Closes the tab's developer tools.",
    params: {},
    mutates: true,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (_p, ctx) => void tab(ctx).closeDevTools(),
    verify: async (_d, _p, ctx) => {
      const closed = await until(() => !tab(ctx).isDevToolsOpened(), Boolean, 3000)
      return { verified: closed, detail: closed ? 'Developer tools are closed.' : 'Developer tools are still open.' }
    }
  })

  control.register({
    id: 'devtools.inspect',
    domain: 'devtools',
    name: 'Inspect an element',
    description: 'Opens developer tools on an element, as Inspect in the right-click menu does.',
    params: { locator: { type: 'object', description: 'The element (see page.find).', required: true } },
    mutates: true,
    confirmation: 'none',
    requires: ['web-page'],
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await page.locate(asPageHandle(wc), p.locator as Locator)
      if ('error' in found) fail('not-found', found.error, true)
      const { target } = found as { target: page.TargetInfo }
      const zoom = wc.getZoomFactor()
      wc.inspectElement(Math.round(target.x * zoom), Math.round(target.y * zoom))
      return { element: target }
    },
    verify: async (_d, _p, ctx) => {
      const open = await until(() => tab(ctx).isDevToolsOpened(), Boolean, 3000)
      return { verified: open, detail: open ? 'Developer tools opened on the element.' : 'Developer tools did not open.' }
    }
  })

  const consoleBuffers = new Map<number, { entries: { level: string; message: string; source: string; line: number; at: number }[]; stop(): void }>()
  control.register({
    id: 'devtools.consoleCapture',
    domain: 'devtools',
    name: 'Capture console messages',
    description: "Starts (or stops) recording the tab's console messages; read them with devtools.console. Nothing is recorded until this is turned on.",
    params: { on: bool('true to start, false to stop.', true) },
    mutates: true,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (p, ctx) => {
      const wc = tab(ctx)
      const existing = consoleBuffers.get(wc.id)
      if (!p.on) {
        existing?.stop()
        consoleBuffers.delete(wc.id)
        return { capturing: false }
      }
      if (existing) return { capturing: true }
      const entries: { level: string; message: string; source: string; line: number; at: number }[] = []
      const listener = (event: unknown, ...legacy: unknown[]): void => {
        const e = event as { message?: string; level?: string | number; sourceId?: string; lineNumber?: number }
        const [level, message, line, source] = e.message !== undefined ? [e.level, e.message, e.lineNumber, e.sourceId] : legacy
        entries.push({ level: String(level ?? 'info'), message: String(message ?? '').slice(0, 2000), source: String(source ?? ''), line: Number(line) || 0, at: Date.now() })
        if (entries.length > 500) entries.splice(0, entries.length - 400)
      }
      wc.on('console-message', listener as never)
      const stop = (): void => {
        if (!wc.isDestroyed()) wc.removeListener('console-message', listener as never)
      }
      wc.once('destroyed', () => consoleBuffers.delete(wc.id))
      consoleBuffers.set(wc.id, { entries, stop })
      return { capturing: true }
    },
    verify: (_d, p, ctx) => {
      const on = consoleBuffers.has(tab(ctx).id)
      return { verified: on === p.on, detail: on ? 'Recording console messages.' : 'Not recording.' }
    }
  })

  control.register({
    id: 'devtools.console',
    domain: 'devtools',
    name: 'Read console messages',
    description: 'The console messages recorded since devtools.consoleCapture was turned on.',
    params: { limit: int('Most recent messages (default 100).'), level: str('Only this level (e.g. error, warning).') },
    mutates: false,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (p, ctx) => {
      const buffer = consoleBuffers.get(tab(ctx).id) ?? fail('unavailable', 'Console capture is off for this tab. Turn it on with devtools.consoleCapture first.', true)
      return buffer.entries.filter((e) => !p.level || e.level.toLowerCase().includes(String(p.level).toLowerCase())).slice(-(Number(p.limit) || 100))
    }
  })

  control.register({
    id: 'devtools.network',
    domain: 'devtools',
    name: 'Record network activity',
    description: "Records the tab's network requests for a few seconds (optionally reloading first) and lists them: URL, method, type, status, size, failures.",
    params: { durationMs: int('How long to record (default 5000, up to 30000).'), reload: bool('Reload the page when recording starts.') },
    mutates: false,
    confirmation: 'none',
    requires: ['web-page'],
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const dbg = wc.debugger
      if (dbg.isAttached()) fail('unavailable', 'Another debugger is attached to this tab.', true)
      try {
        dbg.attach('1.3')
      } catch (err) {
        fail('unavailable', `Network recording isn't available now: ${err instanceof Error ? err.message : String(err)}`, true)
      }
      const requests = new Map<string, { url: string; method: string; type?: string; status?: number; mime?: string; bytes?: number; failed?: string; startedAt: number }>()
      const onMessage = (_e: unknown, method: string, params: Record<string, unknown>): void => {
        const id = String(params.requestId ?? '')
        if (method === 'Network.requestWillBeSent' && requests.size < 1000) {
          const r = params.request as { url: string; method: string }
          requests.set(id, { url: r.url.slice(0, 500), method: r.method, type: params.type as string, startedAt: Date.now() })
        } else if (method === 'Network.responseReceived') {
          const r = requests.get(id)
          const res = params.response as { status: number; mimeType: string }
          if (r) Object.assign(r, { status: res.status, mime: res.mimeType })
        } else if (method === 'Network.loadingFinished') {
          const r = requests.get(id)
          if (r) r.bytes = Number(params.encodedDataLength) || 0
        } else if (method === 'Network.loadingFailed') {
          const r = requests.get(id)
          if (r) r.failed = String(params.errorText ?? 'failed')
        }
      }
      dbg.on('message', onMessage as never)
      try {
        await dbg.sendCommand('Network.enable')
        if (p.reload) wc.reload()
        const end = Date.now() + Math.min(Number(p.durationMs) || 5000, 30_000)
        while (Date.now() < end && !ctx.signal?.aborted && !wc.isDestroyed()) await sleep(200)
      } finally {
        dbg.removeListener('message', onMessage as never)
        if (dbg.isAttached()) dbg.detach()
      }
      return { count: requests.size, requests: [...requests.values()] }
    }
  })

  control.register({
    id: 'devtools.print',
    domain: 'devtools',
    name: 'Print the page',
    description: "Opens the system print dialog for the tab's page; the user chooses the printer and confirms.",
    params: {},
    mutates: true,
    confirmation: 'none',
    requires: ['web-page', 'user-interaction'],
    run: (_p, ctx) =>
      new Promise((resolve) => {
        tab(ctx).print({}, (success, reason) => resolve({ printed: success, reason: success ? undefined : reason }))
      }),
    verify: (data) => {
      const r = data as { printed: boolean; reason?: string }
      return { verified: r.printed, detail: r.printed ? 'Sent to the printer.' : `Not printed: ${r.reason ?? 'cancelled'}.` }
    }
  })

  control.register({
    id: 'devtools.printToPdf',
    domain: 'devtools',
    name: 'Save the page as PDF',
    description: "Saves the tab's page as a PDF in the Downloads folder (never overwriting a file).",
    params: { landscape: bool('Landscape pages.'), fileName: str('File name (default: the page title).') },
    mutates: true,
    confirmation: 'none',
    requires: ['web-page'],
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const data = await page.withTimeout(wc.printToPDF({ landscape: p.landscape === true, printBackground: true }), 60_000)
      const dir = app.getPath('downloads')
      const base = String(p.fileName ?? wc.getTitle() ?? 'page').replace(/[<>:"/\\|?* -]/g, '_').trim().slice(0, 80) || 'page'
      const name = uniqueDownloadName(base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`, (n) => existsSync(join(dir, n)))
      const path = join(dir, name)
      await fs.writeFile(path, data)
      return { path, bytes: data.length }
    },
    verify: async (data) => {
      const { path, bytes } = data as { path: string; bytes: number }
      const stat = await fs.stat(path).catch(() => null)
      return { verified: Boolean(stat && stat.size === bytes && bytes > 0), detail: stat ? `Saved ${path} (${stat.size} bytes).` : 'The PDF file is not there.' }
    }
  })

  control.register({
    id: 'devtools.savePage',
    domain: 'devtools',
    name: 'Save the page',
    description: 'Saves the page with its resources; the user picks where in the save dialog.',
    params: {},
    mutates: true,
    confirmation: 'none',
    requires: ['web-page', 'user-interaction'],
    run: async (_p, ctx) => ({ saved: await d.integration.saveTabPage(tab(ctx)) }),
    verify: (data) => ({ verified: (data as { saved: boolean }).saved, detail: (data as { saved: boolean }).saved ? 'The page was saved.' : 'Not saved (cancelled, or it failed).' })
  })

  control.register({
    id: 'devtools.viewSource',
    domain: 'devtools',
    name: 'View page source',
    description: "Opens the page's source in a new tab.",
    params: {},
    mutates: true,
    confirmation: 'none',
    requires: ['web-page'],
    run: async (_p, ctx) => {
      const url = tab(ctx).getURL()
      const result = await control.execute({ capability: 'tabs.create', params: { url: `view-source:${url}` }, source: ctx.source }, { confirm: ctx.confirm, signal: ctx.signal })
      if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? "Couldn't open the source.", result.error?.recoverable)
      return result.data
    },
    verify: () => ({ verified: Boolean(windowControl.state?.tabs.some((t) => t.url.startsWith('view-source:'))), detail: 'A view-source tab is open.' })
  })

  // ---------------------------------------------------------------- settings

  control.registerState('settings', async () => d.store.getSettings())

  control.register({
    id: 'settings.get',
    domain: 'settings',
    name: 'Read settings',
    description: `Orbis's settings. Changeable with settings.set: ${Object.entries(SETTINGS).map(([k, s]) => `${k} (${s.description})`).join('; ')}.`,
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => d.store.getSettings()
  })

  control.register({
    id: 'settings.set',
    domain: 'settings',
    name: 'Change a setting',
    description: `Changes one Orbis setting and applies it straight away: ${Object.keys(SETTINGS).join(', ')}.`,
    params: { key: str('The setting.', true, { enum: Object.keys(SETTINGS) }), value: { type: 'any', description: 'Its new value.', required: true } },
    mutates: true,
    confirmation: 'none',
    describe: (p) => `Set ${String(p.key)} to ${JSON.stringify(p.value)}`,
    run: async (p) => {
      const spec = SETTINGS[String(p.key)]
      if (spec.type === 'boolean' && typeof p.value !== 'boolean') fail('invalid-params', `${String(p.key)} must be true or false.`)
      if (spec.type === 'string' && typeof p.value !== 'string') fail('invalid-params', `${String(p.key)} must be text.`)
      if (spec.values && !spec.values.includes(String(p.value))) fail('invalid-params', `${String(p.key)} must be one of ${spec.values.join(', ')}.`)
      const settings = await d.store.updateSettings({ [String(p.key)]: p.value } as SettingsUpdate)
      d.onSettingsChanged(settings)
      return { key: p.key, value: (settings as unknown as Record<string, unknown>)[String(p.key)] }
    },
    verify: async (_data, p) => {
      const now = (await d.store.getSettings()) as unknown as Record<string, unknown>
      const want = typeof p.value === 'string' ? p.value.trim() : p.value
      const ok = typeof want === 'string' ? String(now[String(p.key)]).startsWith(want.slice(0, 40)) || (want === '' && typeof now[String(p.key)] === 'string') : now[String(p.key)] === want
      return { verified: ok, detail: ok ? `${String(p.key)} is now ${JSON.stringify(now[String(p.key)])}.` : `${String(p.key)} is ${JSON.stringify(now[String(p.key)])} (the value wasn't accepted).` }
    }
  })

  control.register({
    id: 'settings.adblock',
    domain: 'settings',
    name: 'Read ad blocking',
    description: 'Ad blocking: on/off, strength, categories, site and resource exceptions, filter lists.',
    params: {},
    mutates: false,
    confirmation: 'none',
    unavailable: () => (d.adblock() ? null : "Ad blocking hasn't started."),
    run: () => d.adblock()!.state()
  })

  control.register({
    id: 'settings.setAdblock',
    domain: 'settings',
    name: 'Change ad blocking',
    description: 'Turns ad blocking on or off or changes its strength (standard, strict, custom). Turning it off or weakening it is a security change, so Orbis asks first.',
    params: { enabled: bool('On or off.'), level: str('standard, strict or custom', false, { enum: ['standard', 'strict', 'custom'] }) },
    mutates: true,
    confirmation: 'when-consequential',
    unavailable: () => (d.adblock() ? null : "Ad blocking hasn't started."),
    describe: (p) => (p.enabled === false ? 'Turn ad blocking off' : `Change ad blocking to ${JSON.stringify(p)}`),
    assess: (p) => {
      const current = d.adblock()!.state().settings
      const weaker = p.enabled === false || (p.level === 'standard' && current.level === 'strict') || p.level === 'custom'
      return weaker ? { decision: 'confirm', reason: 'This lowers protection against ads and trackers.' } : { decision: 'run', reason: '' }
    },
    run: async (p) => {
      const update: Record<string, unknown> = {}
      if (typeof p.enabled === 'boolean') update.enabled = p.enabled
      if (typeof p.level === 'string') update.level = p.level
      if (!Object.keys(update).length) fail('invalid-params', 'Give enabled or level.')
      return (await d.adblock()!.updateSettings(update)).settings
    },
    verify: (_d, p) => {
      const s = d.adblock()!.state().settings
      const ok = (typeof p.enabled !== 'boolean' || s.enabled === p.enabled) && (typeof p.level !== 'string' || s.level === p.level)
      return { verified: ok, detail: `Ad blocking is ${s.enabled ? 'on' : 'off'} (${s.level}).` }
    }
  })

  control.register({
    id: 'settings.adblockSite',
    domain: 'settings',
    name: 'Allow or block ads on a site',
    description: 'Adds or removes a site exception: ads are allowed on that site (true) or blocked again (false).',
    params: { host: str('The site host, e.g. example.com.', true), allowed: bool('true to allow ads there.', true) },
    mutates: true,
    confirmation: 'none',
    unavailable: () => (d.adblock() ? null : "Ad blocking hasn't started."),
    run: async (p) => (await d.adblock()!.setSite(String(p.host), p.allowed === true)).settings.siteExceptions,
    verify: (_d, p) => {
      const listed = d.adblock()!.state().settings.siteExceptions.some((h) => h === String(p.host).toLowerCase().replace(/^www\./, '') || h === String(p.host))
      return { verified: listed === (p.allowed === true), detail: listed ? `Ads are allowed on ${String(p.host)}.` : `Ads are blocked on ${String(p.host)}.` }
    }
  })

  // ---------------------------------------------------------------- site permissions and browsing data

  control.registerState('permissions', () => ({ remembered: d.library.snapshot().permissions, pending: d.integration.pendingPermissions() }))

  control.register({
    id: 'permissions.list',
    domain: 'permissions',
    name: 'Site permissions',
    description: 'Remembered site permission decisions (camera, location, notifications…) and requests waiting for an answer.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => ({
      remembered: Object.entries(d.library.snapshot().permissions).map(([key, decision]) => {
        const [origin, permission] = key.split(' ')
        return { origin, permission, decision }
      }),
      pending: d.integration.pendingPermissions()
    })
  })

  control.register({
    id: 'permissions.answer',
    domain: 'permissions',
    name: "Answer a site's permission request",
    description: "Allows or blocks a pending request (from permissions.list). Allowing gives a site access to something like the camera or location, so Orbis asks the user first.",
    params: { id: str('The request id.', true), allow: bool('Allow (true) or block (false).', true), remember: bool('Remember the decision for the site.') },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => {
      const request = d.integration.pendingPermissions().find((r) => r.id === p.id)
      return `${p.allow ? 'Allow' : 'Block'} ${request ? `${request.origin} to ${request.label}` : 'the site request'}`
    },
    assess: (p) => (p.allow ? { decision: 'confirm', reason: 'This gives the site access to a device or your information.' } : { decision: 'run', reason: '' }),
    run: (p) => {
      if (!d.integration.answerPermission(String(p.id), p.allow === true, p.remember === true)) fail('not-found', 'That request is no longer waiting.', false)
      return { id: p.id }
    },
    verify: (_d, p) => {
      const gone = !d.integration.pendingPermissions().some((r) => r.id === p.id)
      return { verified: gone, detail: gone ? 'The site got its answer.' : 'The request is still waiting.' }
    }
  })

  control.register({
    id: 'permissions.set',
    domain: 'permissions',
    name: 'Remember a site permission',
    description: 'Remembers allow or block for a site and permission (e.g. https://meet.example.com, media). Allowing is a security change, so Orbis asks first.',
    params: { origin: str('Site origin, e.g. https://example.com.', true), permission: str('Permission name: media, geolocation, notifications, clipboard-read, …', true), decision: str('allow or block', true, { enum: ['allow', 'block'] }) },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `${p.decision === 'allow' ? 'Always allow' : 'Always block'} ${String(p.origin)} to use ${String(p.permission)}`,
    assess: (p) => (p.decision === 'allow' ? { decision: 'confirm', reason: 'This lets the site use it without asking.' } : { decision: 'run', reason: '' }),
    run: (p) => {
      let origin = ''
      try {
        origin = new URL(String(p.origin)).origin
      } catch {
        fail('invalid-params', 'origin must be a site address such as https://example.com.')
      }
      d.library.rememberPermission(origin, String(p.permission), p.decision as 'allow' | 'block')
      return { origin }
    },
    verify: (data, p) => {
      const now = d.library.permission((data as { origin: string }).origin, String(p.permission))
      return { verified: now === p.decision, detail: `Remembered: ${now ?? 'nothing'}.` }
    }
  })

  control.register({
    id: 'permissions.forget',
    domain: 'permissions',
    name: 'Forget site permissions',
    description: "Forgets remembered permission decisions for one site, or for every site; they'll ask again.",
    params: { origin: str('Only this site (default: all sites).') },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Forget the permissions ${p.origin ? `of ${String(p.origin)}` : 'of every site'}`,
    run: (p) => void d.library.forgetPermissions(p.origin ? String(p.origin) : undefined),
    verify: (_d, p) => {
      const left = Object.keys(d.library.snapshot().permissions).filter((k) => !p.origin || k.startsWith(`${String(p.origin)} `)).length
      return { verified: left === 0, detail: left ? `${left} decisions remain.` : 'Forgotten.' }
    }
  })

  control.register({
    id: 'browser.clearData',
    domain: 'browser',
    name: 'Clear browsing data',
    description: 'Clears cookies, site storage, cache, history, address-bar searches and site permissions (bookmarks and downloads stay). Signs you out of sites.',
    params: {},
    mutates: true,
    confirmation: 'always',
    describe: () => 'Clear all browsing data (signs you out of websites)',
    run: () => d.clearBrowsingData(),
    verify: () => {
      const s = d.library.snapshot()
      const ok = s.history.length === 0 && s.searches.length === 0
      return { verified: ok, detail: ok ? 'History, searches, cookies, storage and cache were cleared.' : 'Some history remains.' }
    }
  })

  control.register({
    id: 'browser.clearCache',
    domain: 'browser',
    name: 'Clear the cache',
    description: "Clears the browser's cache (keeps cookies and sign-ins).",
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => {
      await d.session.clearCache()
      return { bytes: await d.session.getCacheSize() }
    },
    verify: (data) => ({ verified: (data as { bytes: number }).bytes < 1_000_000, detail: `Cache is ${(data as { bytes: number }).bytes} bytes.` })
  })

  control.register({
    id: 'browser.clearCookies',
    domain: 'browser',
    name: 'Clear cookies',
    description: "Deletes cookies for one site, or all sites. This signs you out of those sites, so Orbis asks first. Cookie values are never read.",
    params: { origin: str('Only this site, e.g. https://example.com (default: all).') },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Delete the cookies of ${p.origin ? String(p.origin) : 'every site'} (signs you out)`,
    run: async (p) => {
      await d.session.clearStorageData({ ...(p.origin ? { origin: String(p.origin) } : {}), storages: ['cookies'] })
      const left = p.origin ? await d.session.cookies.get({ url: String(p.origin) }) : await d.session.cookies.get({})
      return { remaining: left.length }
    },
    verify: (data) => ({ verified: (data as { remaining: number }).remaining === 0, detail: `${(data as { remaining: number }).remaining} cookies remain.` })
  })

  control.register({
    id: 'browser.cookieCount',
    domain: 'browser',
    name: 'Count cookies',
    description: 'How many cookies a site (or all sites) has. Values are never read: they can sign someone in.',
    params: { url: str('A site address (default: all sites).') },
    mutates: false,
    confirmation: 'none',
    run: async (p) => ({ count: (await d.session.cookies.get(p.url ? { url: String(p.url) } : {})).length })
  })

  // ---------------------------------------------------------------- downloads

  const download = (id: unknown): BrowserDownload => d.library.download(String(id)) ?? fail('not-found', `No download with id ${String(id)}. See downloads.list.`, true)
  control.registerState('downloads', () => d.library.snapshot().downloads.slice(0, 50))

  control.register({
    id: 'downloads.list',
    domain: 'downloads',
    name: 'List downloads',
    description: 'Downloads with file name, URL, saved path, state (progressing, paused, completed, cancelled, interrupted) and progress.',
    params: { state: str('Only this state.'), query: str('File name or URL contains.'), limit: int('Default 50.') },
    mutates: false,
    confirmation: 'none',
    run: (p) =>
      d.library
        .snapshot()
        .downloads.filter((x) => (!p.state || x.state === p.state) && (!p.query || `${x.filename} ${x.url}`.toLowerCase().includes(String(p.query).toLowerCase())))
        .slice(0, Number(p.limit) || 50)
  })

  control.register({
    id: 'downloads.get',
    domain: 'downloads',
    name: 'A download',
    description: 'One download with its progress and whether its file exists.',
    params: { id: str('Download id.', true) },
    mutates: false,
    confirmation: 'none',
    run: (p) => {
      const record = download(p.id)
      return { ...record, fileExists: record.state === 'completed' ? existsSync(record.path) : false, progress: record.totalBytes ? record.receivedBytes / record.totalBytes : null }
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
    observe: () => new Set(d.library.snapshot().downloads.map((x) => x.id)),
    run: (p) => {
      if (!/^https?:\/\//i.test(String(p.url))) fail('invalid-params', 'Only http and https files can be downloaded.')
      d.session.downloadURL(String(p.url))
      return { url: p.url }
    },
    verify: async (_data, p, _ctx, before) => {
      const known = before as Set<string>
      const started = await until(() => d.library.snapshot().downloads.find((x) => !known.has(x.id)), Boolean, 10_000, 200)
      return { verified: Boolean(started), detail: started ? `Downloading ${started.filename} (id ${started.id}), ${started.state}.` : `No download started for ${String(p.url)} (the server may have refused it).` }
    }
  })

  const downloadAction = (id: string, name: string, action: 'cancel' | 'pause' | 'resume' | 'open' | 'show', expect?: (x: BrowserDownload) => boolean, confirmation: 'none' | 'always' = 'none'): void =>
    control.register({
      id,
      domain: 'downloads',
      name,
      description: `${name} (by download id).${action === 'open' ? ' Opening runs the file with its default program, so Orbis asks first.' : ''}`,
      params: { id: str('Download id.', true) },
      mutates: true,
      confirmation,
      describe: (p) => `${name}: ${download(p.id).filename}`,
      run: async (p) => {
        download(p.id)
        const result = await d.integration.downloadAction(String(p.id), action)
        if (!result.done) fail('failed', result.reason ?? `Couldn't ${action} it.`, false)
        return { id: p.id }
      },
      verify: async (_data, p) => {
        if (!expect) return { verified: true, detail: action === 'show' ? 'Shown in its folder.' : 'Opened with its default program.' }
        const now = await until(() => d.library.download(String(p.id)), (x) => Boolean(x && expect(x)), 3000, 150)
        return { verified: Boolean(now && expect(now)), detail: `The download is ${now?.state ?? 'gone'}.` }
      }
    })
  downloadAction('downloads.pause', 'Pause a download', 'pause', (x) => x.state === 'paused')
  downloadAction('downloads.resume', 'Resume a download', 'resume', (x) => x.state === 'progressing' || x.state === 'completed')
  downloadAction('downloads.cancel', 'Cancel a download', 'cancel', (x) => x.state === 'cancelled')
  downloadAction('downloads.open', 'Open a downloaded file', 'open', undefined, 'always')
  downloadAction('downloads.show', 'Show a download in its folder', 'show')

  control.register({
    id: 'downloads.remove',
    domain: 'downloads',
    name: 'Remove from the downloads list',
    description: 'Removes a finished download from the list (the file stays on disk).',
    params: { id: str('Download id.', true) },
    mutates: true,
    confirmation: 'none',
    run: (p) => {
      if (!d.library.removeDownload(String(download(p.id).id))) fail('failed', "A download in progress can't be removed; cancel it first.")
    },
    verify: (_d, p) => ({ verified: !d.library.download(String(p.id)), detail: 'Removed from the list.' })
  })

  control.register({
    id: 'downloads.clearFinished',
    domain: 'downloads',
    name: 'Clear finished downloads',
    description: 'Removes every finished download from the list (files stay on disk).',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => void d.library.clearFinishedDownloads(),
    verify: () => {
      const left = d.library.snapshot().downloads.filter((x) => x.state !== 'progressing').length
      return { verified: left === 0, detail: `${left} finished downloads remain.` }
    }
  })

  control.register({
    id: 'downloads.waitFor',
    domain: 'downloads',
    name: 'Wait for a download',
    description: 'Waits for a download (by id, or the newest whose name or URL contains some text) to complete; fails if it is cancelled or interrupted.',
    params: { id: str('Download id.'), match: str('Name or URL contains.'), timeoutMs: int('Default 120000.') },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => {
      const find = (): BrowserDownload | undefined => (p.id ? d.library.download(String(p.id)) : d.library.snapshot().downloads.find((x) => !p.match || `${x.filename} ${x.url}`.toLowerCase().includes(String(p.match).toLowerCase())))
      const end = Date.now() + Math.min(Number(p.timeoutMs) || 120_000, 3_600_000)
      for (;;) {
        if (ctx.signal?.aborted) fail('aborted', 'Stopped.')
        const x = find()
        if (x?.state === 'completed') return { ...x, fileExists: existsSync(x.path) }
        if (x && (x.state === 'cancelled' || x.state === 'interrupted')) fail('failed', `The download ${x.filename} was ${x.state}.`, false)
        if (Date.now() > end) fail('timeout', x ? `${x.filename} is still ${x.state}.` : 'No matching download appeared.', true)
        await sleep(500)
      }
    }
  })

  // ---------------------------------------------------------------- history and bookmarks

  control.registerState('history', () => ({ recent: d.library.searchHistory({ limit: 20 }), total: d.library.searchHistory({ limit: 100_000 }).length }))
  control.registerState('bookmarks', () => d.library.snapshot().bookmarks)

  control.register({
    id: 'history.search',
    domain: 'history',
    name: 'Search history',
    description: 'History entries (URL, title, time visited), newest first, filtered by text and time range (epoch ms).',
    params: { query: str('URL or title contains.'), from: int('Visited at or after (epoch ms).'), to: int('Visited at or before (epoch ms).'), limit: int('Default 100.') },
    mutates: false,
    confirmation: 'none',
    run: (p) => d.library.searchHistory({ query: p.query as string | undefined, from: p.from as number | undefined, to: p.to as number | undefined, limit: Number(p.limit) || 100 })
  })

  control.register({
    id: 'history.delete',
    domain: 'history',
    name: 'Delete a history entry',
    description: 'Removes a page from history.',
    params: { url: str('The page address.', true) },
    mutates: true,
    confirmation: 'none',
    run: (p) => void d.library.removeHistory(String(p.url)),
    verify: (_d, p) => {
      const left = d.library.searchHistory({ limit: 100_000 }).some((h) => h.url.split('#')[0] === String(p.url).split('#')[0])
      return { verified: !left, detail: left ? 'It is still in history.' : 'Removed from history.' }
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
    run: (p) => ({ removed: d.library.removeHistoryRange(Number(p.from), Number(p.to)) }),
    verify: (data, p) => {
      const left = d.library.searchHistory({ from: Number(p.from), to: Number(p.to), limit: 1 }).length
      return { verified: left === 0, detail: `Removed ${(data as { removed: number }).removed} entries.` }
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
    run: () => void d.library.clearHistory(),
    verify: () => ({ verified: d.library.searchHistory({ limit: 1 }).length === 0, detail: 'History is empty.' })
  })

  control.register({
    id: 'bookmarks.list',
    domain: 'bookmarks',
    name: 'List bookmarks',
    description: 'Bookmarks (URL, title, when added), newest first, optionally filtered by text. Orbis bookmarks are a single list (no folders).',
    params: { query: str('URL or title contains.') },
    mutates: false,
    confirmation: 'none',
    run: (p) => d.library.snapshot().bookmarks.filter((b) => !p.query || `${b.url} ${b.title}`.toLowerCase().includes(String(p.query).toLowerCase()))
  })

  control.register({
    id: 'bookmarks.add',
    domain: 'bookmarks',
    name: 'Bookmark a page',
    description: 'Adds a bookmark (skipped when the page is already bookmarked).',
    params: { url: str('The page address.', true), title: str('Its title.') },
    mutates: true,
    confirmation: 'none',
    run: (p) => ({ added: d.library.addBookmarks([{ url: String(p.url), title: String(p.title ?? '') }]) }),
    verify: (_d, p) => ({ verified: d.library.isBookmarked(String(p.url)), detail: d.library.isBookmarked(String(p.url)) ? 'Bookmarked.' : 'Not bookmarked (only web pages can be).' })
  })

  control.register({
    id: 'bookmarks.remove',
    domain: 'bookmarks',
    name: 'Remove a bookmark',
    description: 'Removes the bookmark for a page.',
    params: { url: str('The page address.', true) },
    mutates: true,
    confirmation: 'none',
    run: (p) => void d.library.removeBookmark(String(p.url)),
    verify: (_d, p) => ({ verified: !d.library.isBookmarked(String(p.url)), detail: 'The bookmark is gone.' })
  })

  // ---------------------------------------------------------------- clipboard

  /** The MIME types on the clipboard now (text/plain, text/html, image/png…), without reading the data. */
  const clipboardTypes = async (): Promise<string[]> => [...new Set((await clipboard.read().catch(() => [])).flatMap((item) => item.types))]
  const clipboardData = async (type: string): Promise<Blob | null> => {
    for (const item of await clipboard.read().catch(() => [])) if (item.types.includes(type)) return (await item.getType(type).catch(() => null)) as Blob | null
    return null
  }

  control.registerState('clipboard', async () => ({ types: await clipboardTypes() }))

  control.register({
    id: 'clipboard.formats',
    domain: 'clipboard',
    name: "What's on the clipboard",
    description: 'The kinds of data on the clipboard (text/plain, text/html, image/png…) without reading its contents.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => ({ types: await clipboardTypes() })
  })

  control.register({
    id: 'clipboard.read',
    domain: 'clipboard',
    name: 'Read the clipboard',
    description: 'Reads the clipboard as text, HTML or an image (PNG data URL). It may hold something private, so Orion and automations ask first.',
    params: { format: str('text (default), html or image', false, { enum: ['text', 'html', 'image'] }) },
    mutates: false,
    confirmation: 'always',
    describe: () => 'Read what is on your clipboard',
    run: async (p) => {
      const format = String(p.format ?? 'text')
      if (format === 'text') {
        const value = await clipboard.readText()
        return { format, value, empty: !value }
      }
      const blob = await clipboardData(format === 'html' ? 'text/html' : 'image/png')
      if (!blob) return { format, empty: true }
      if (format === 'html') return { format, value: await blob.text(), empty: false }
      const png = Buffer.from(await blob.arrayBuffer())
      const size = nativeImage.createFromBuffer(png).getSize()
      return { format, dataUrl: `data:image/png;base64,${png.toString('base64')}`, ...size, empty: false }
    }
  })

  control.register({
    id: 'clipboard.write',
    domain: 'clipboard',
    name: 'Copy to the clipboard',
    description: 'Puts text (and optionally HTML), or an image data URL, on the clipboard.',
    params: { text: str('Text to copy.', false, { sensitive: true }), html: str('HTML version.', false, { sensitive: true }), imageDataUrl: str('A data:image/… URL.') },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      if (typeof p.imageDataUrl === 'string') {
        const image = nativeImage.createFromDataURL(p.imageDataUrl)
        if (image.isEmpty()) fail('invalid-params', "That image couldn't be read.")
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) })])
      } else if (typeof p.html === 'string') {
        await clipboard.write([new ClipboardItem({ 'text/html': p.html, ...(typeof p.text === 'string' ? { 'text/plain': p.text } : {}) })])
      } else if (typeof p.text === 'string') await clipboard.writeText(p.text)
      else fail('invalid-params', 'Give text, html or imageDataUrl.')
    },
    verify: async (_d, p) => {
      const ok =
        typeof p.imageDataUrl === 'string'
          ? (await clipboardTypes()).includes('image/png')
          : typeof p.text === 'string'
            ? (await clipboard.readText()) === p.text
            : (await clipboardTypes()).includes('text/html')
      return { verified: ok, detail: ok ? 'The clipboard holds it.' : "The clipboard doesn't hold it." }
    }
  })

  control.register({
    id: 'clipboard.clear',
    domain: 'clipboard',
    name: 'Clear the clipboard',
    description: 'Empties the clipboard.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: () => clipboard.clear(),
    verify: async () => {
      const types = await clipboardTypes()
      return { verified: types.length === 0 || (await clipboard.readText()) === '', detail: types.length ? `Still on the clipboard: ${types.join(', ')}.` : 'The clipboard is empty.' }
    }
  })

  control.register({
    id: 'clipboard.copyFromPage',
    domain: 'clipboard',
    name: "Copy the page's selection",
    description: 'Copies what is selected in the tab, as Ctrl+C does.',
    params: {},
    mutates: true,
    confirmation: 'none',
    requires: ['web-page'],
    observe: async (_p, ctx) => page.exec<string>(asPageHandle(tab(ctx)), 'String(getSelection())'),
    run: (_p, ctx, selection) => {
      if (!String(selection).trim()) fail('invalid-params', 'Nothing is selected on the page. Select text first (page.selectText).', true)
      tab(ctx).copy()
    },
    verify: async (_d, _p, _ctx, selection) => {
      const copied = await until(async () => clipboard.readText(), (t: string) => t.replace(/\s+/g, ' ').trim() === String(selection).replace(/\s+/g, ' ').trim(), 1500)
      const ok = copied.replace(/\s+/g, ' ').trim() === String(selection).replace(/\s+/g, ' ').trim()
      return { verified: ok, detail: ok ? `Copied ${String(selection).length} characters.` : 'The clipboard does not hold the selection.' }
    }
  })

  control.register({
    id: 'clipboard.copyImageFromPage',
    domain: 'clipboard',
    name: 'Copy an image from the page',
    description: 'Copies an image element to the clipboard, as "Copy image" does.',
    params: { locator: { type: 'object', description: 'The image (see page.find).', required: true } },
    mutates: true,
    confirmation: 'none',
    requires: ['web-page'],
    run: async (p, ctx) => {
      const wc = tab(ctx)
      const found = await page.locate(asPageHandle(wc), p.locator as Locator)
      if ('error' in found) fail('not-found', found.error, true)
      const { target } = found as { target: page.TargetInfo }
      const zoom = wc.getZoomFactor()
      clipboard.clear()
      wc.copyImageAt(Math.round(target.x * zoom), Math.round(target.y * zoom))
    },
    verify: async () => {
      const ok = await until(async () => (await clipboardTypes()).includes('image/png'), Boolean, 4000, 150)
      return { verified: ok, detail: ok ? 'The image is on the clipboard.' : 'No image was copied.' }
    }
  })

  // ---------------------------------------------------------------- extensions

  const extension = async (id: unknown): Promise<InstalledExtension> => (await d.extensions.list()).find((e) => e.id === id) ?? fail('not-found', `No installed extension with id ${String(id)}. See extensions.list.`, true)
  control.registerState('extensions', () => d.extensions.list())

  control.register({
    id: 'extensions.list',
    domain: 'extensions',
    name: 'List extensions',
    description: 'Installed Chrome Web Store extensions: name, version, on/off, pinned, toolbar button and badge, options page, permission warnings.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => d.extensions.list()
  })

  control.register({
    id: 'extensions.setEnabled',
    domain: 'extensions',
    name: 'Turn an extension on or off',
    description: 'Turns an installed extension on (it gets its permissions back, so Orbis asks first) or off.',
    params: { id: str('Extension id.', true), enabled: bool('On (true) or off (false).', true) },
    mutates: true,
    confirmation: 'when-consequential',
    describe: (p) => `Turn ${p.enabled ? 'on' : 'off'} the extension ${String(p.id)}`,
    assess: async (p) => {
      if (!p.enabled) return { decision: 'run', reason: '' }
      const ext = await extension(p.id)
      return { decision: 'confirm', reason: ext.warnings.length ? `${ext.name} can: ${ext.warnings.join('; ')}.` : `${ext.name} will run again.` }
    },
    run: async (p) => {
      await extension(p.id)
      await d.extensions.setEnabled(String(p.id), p.enabled === true)
    },
    verify: async (_d, p) => {
      const ext = await extension(p.id)
      return { verified: ext.enabled === p.enabled, detail: `${ext.name} is ${ext.enabled ? 'on' : 'off'}.` }
    }
  })

  control.register({
    id: 'extensions.pin',
    domain: 'extensions',
    name: 'Pin an extension to the toolbar',
    description: "Shows (true) or hides (false) an extension's button on the browser toolbar.",
    params: { id: str('Extension id.', true), pinned: bool('Pin or unpin.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      await extension(p.id)
      await d.extensions.setPinned(String(p.id), p.pinned === true)
    },
    verify: async (_d, p) => {
      const ext = await extension(p.id)
      return { verified: ext.pinned === p.pinned, detail: `${ext.name} is ${ext.pinned ? 'pinned' : 'not pinned'}.` }
    }
  })

  control.register({
    id: 'extensions.remove',
    domain: 'extensions',
    name: 'Remove an extension',
    description: 'Uninstalls an extension from Orbis.',
    params: { id: str('Extension id.', true) },
    mutates: true,
    confirmation: 'always',
    describe: (p) => `Remove the extension ${String(p.id)}`,
    run: async (p) => {
      const ext = await extension(p.id)
      await d.extensions.remove(ext.id)
      return { name: ext.name }
    },
    verify: async (data, p) => {
      const still = (await d.extensions.list()).some((e) => e.id === p.id)
      return { verified: !still, detail: still ? 'It is still installed.' : `Removed ${(data as { name: string }).name}.` }
    }
  })

  control.register({
    id: 'extensions.update',
    domain: 'extensions',
    name: 'Update extensions',
    description: 'Checks the Chrome Web Store for newer versions of installed extensions and installs them.',
    params: {},
    mutates: true,
    confirmation: 'none',
    run: async () => {
      const { before, after } = await d.extensions.update()
      return { updated: Object.keys(after).filter((id) => before[id] && before[id] !== after[id]).map((id) => ({ id, from: before[id], to: after[id] })) }
    },
    verify: (data) => ({ verified: true, detail: `Checked the Web Store: ${(data as { updated: unknown[] }).updated.length} updated.` })
  })

  control.register({
    id: 'extensions.install',
    domain: 'extensions',
    name: 'Install an extension',
    description: "Opens an extension's Chrome Web Store page in a new tab. Installing takes the store's Add button and the user's approval in Orbis's permission prompt; Orbis never installs silently.",
    params: { id: str('The extension id (32 letters a-p), from its Web Store address.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      if (!/^[a-p]{32}$/.test(String(p.id))) fail('invalid-params', 'That is not a Chrome Web Store extension id.')
      const url = `https://chromewebstore.google.com/detail/${String(p.id)}`
      const result = await control.execute({ capability: 'tabs.create', params: { url }, source: ctx.source }, { confirm: ctx.confirm, signal: ctx.signal })
      if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? "Couldn't open the Web Store.", result.error?.recoverable)
      return { url, next: 'Click "Add to Orbis" on the page; the user approves the extension in the Orbis prompt.' }
    },
    verify: () => {
      const opened = windowControl.state?.tabs.some((t) => t.url.includes('chromewebstore.google.com/detail/'))
      return { verified: Boolean(opened), detail: opened ? 'The Web Store page is open.' : 'The Web Store page did not open.' }
    }
  })

  const extensionPages = (id?: string): { webContentsId: number; url: string; kind: 'popup' | 'tab' }[] => {
    const host = d.getWindow()?.webContents
    const tabIds = new Set(windowControl.state?.tabs.map((t) => t.webContentsId) ?? [])
    return webContents
      .getAllWebContents()
      .filter((wc) => !wc.isDestroyed() && wc.getType() === 'webview' && wc.hostWebContents === host && wc.getURL().startsWith(`chrome-extension://${id ?? ''}`))
      .map((wc) => ({ webContentsId: wc.id, url: wc.getURL(), kind: tabIds.has(wc.id) ? ('tab' as const) : ('popup' as const) }))
  }

  control.register({
    id: 'extensions.pages',
    domain: 'extensions',
    name: "Extensions' open pages",
    description: "Open extension popups and options pages, with the webContentsId to target them with page capabilities (page.click, page.type…).",
    params: { id: str('Only this extension.') },
    mutates: false,
    confirmation: 'none',
    run: (p) => extensionPages(p.id as string | undefined)
  })

  control.register({
    id: 'extensions.clickAction',
    domain: 'extensions',
    name: "Click an extension's toolbar button",
    description: "Activates an extension's toolbar button for the active tab: opens its popup (then use extensions.pages to work in it) or runs its click action.",
    params: { id: str('Extension id.', true) },
    mutates: true,
    confirmation: 'none',
    unavailable: () => (windowControl.state?.open ? null : 'The browser is closed. Open it first (browser.open).'),
    run: async (p) => {
      const ext = await extension(p.id)
      if (!ext.enabled) fail('unavailable', `${ext.name} is turned off.`, true)
      if (ext.action?.enabled === false) fail('unavailable', `${ext.name}'s button is disabled on this page.`, true)
      if (ext.action?.hasPopup) {
        await d.openExtensionPopup(ext.id)
        return { popup: true, name: ext.name }
      }
      await d.extensions.clickAction(ext.id)
      return { popup: false, name: ext.name, listening: d.extensions.bridge.isListening(ext.id, 'action.onClicked') }
    },
    verify: async (data, p) => {
      const r = data as { popup: boolean; name: string; listening?: boolean }
      if (!r.popup) return { verified: r.listening === true, detail: r.listening ? `${r.name} received the click.` : `${r.name} has no popup and doesn't handle clicks.` }
      const open = await until(() => extensionPages(String(p.id)).find((x) => x.kind === 'popup'), Boolean, 4000, 150)
      return { verified: Boolean(open), detail: open ? `${r.name}'s popup is open (webContentsId ${open.webContentsId}).` : `${r.name}'s popup did not open.` }
    }
  })

  control.register({
    id: 'extensions.openOptions',
    domain: 'extensions',
    name: "Open an extension's options",
    description: "Opens an extension's options page in a tab (then work in it with page capabilities).",
    params: { id: str('Extension id.', true) },
    mutates: true,
    confirmation: 'none',
    run: async (p, ctx) => {
      const ext = await extension(p.id)
      if (!ext.enabled) fail('unavailable', `${ext.name} is turned off.`, true)
      if (!ext.optionsUrl) fail('not-found', `${ext.name} has no options page.`)
      const result = await control.execute({ capability: 'tabs.create', params: { url: ext.optionsUrl }, source: ctx.source }, { confirm: ctx.confirm, signal: ctx.signal })
      if (!result.ok) fail(result.error?.code ?? 'failed', result.error?.message ?? "Couldn't open the options.", result.error?.recoverable)
      return { url: ext.optionsUrl }
    },
    verify: async (data) => {
      const open = await until(() => windowControl.state?.tabs.find((t) => t.url === (data as { url: string }).url), Boolean, 3000)
      return { verified: Boolean(open), detail: open ? 'The options page is open.' : 'The options page did not open.' }
    }
  })

  control.register({
    id: 'extensions.permissions',
    domain: 'extensions',
    name: "An extension's permissions",
    description: 'What an extension may access: declared permissions, host access, optional permissions granted, and what they mean.',
    params: { id: str('Extension id.', true) },
    mutates: false,
    confirmation: 'none',
    run: async (p) => {
      const ext = await extension(p.id)
      if (!ext.enabled) return { name: ext.name, enabled: false, warnings: ext.warnings }
      const granted = await d.extensions.bridge.call(ext.id, 'permissions.getAll', [])
      return { name: ext.name, enabled: true, warnings: ext.warnings, effective: granted }
    }
  })

  control.register({
    id: 'extensions.revokePermissions',
    domain: 'extensions',
    name: "Revoke an extension's optional permissions",
    description: 'Takes back optional permissions or site access an extension was granted.',
    params: { id: str('Extension id.', true), permissions: { type: 'array', description: 'Permission names.' }, origins: { type: 'array', description: 'Site patterns.' } },
    mutates: true,
    confirmation: 'none',
    run: async (p) => {
      const ext = await extension(p.id)
      if (!ext.enabled) fail('unavailable', `${ext.name} is turned off.`, true)
      const removed = await d.extensions.bridge.call(ext.id, 'permissions.remove', [{ permissions: p.permissions ?? [], origins: p.origins ?? [] }])
      if (!removed) fail('not-found', 'Those permissions were not granted as optional permissions.')
    },
    verify: async (_d, p) => {
      const all = (await d.extensions.bridge.call(String(p.id), 'permissions.getAll', [])) as { permissions: string[]; origins: string[] }
      const still = [...((p.permissions as string[]) ?? []).filter((x) => all.permissions.includes(x)), ...((p.origins as string[]) ?? []).filter((x) => all.origins.includes(x))]
      return { verified: still.length === 0, detail: still.length ? `Still granted: ${still.join(', ')}.` : 'Revoked.' }
    }
  })

  const menuContext = (p: Record<string, unknown>, ctx: ControlContext): Parameters<ExtensionsManager['menuItems']>[0] => {
    const wc = tab(ctx)
    return {
      pageUrl: wc.getURL(),
      linkUrl: p.linkUrl as string | undefined,
      srcUrl: p.srcUrl as string | undefined,
      mediaType: (p.mediaType as string | undefined) ?? (p.srcUrl ? 'image' : 'none'),
      selectionText: p.selectionText as string | undefined,
      editable: p.editable === true,
      tabId: wc.id
    }
  }
  const menuParams: Record<string, ParamSpec> = { linkUrl: str('Right-clicked link.'), srcUrl: str('Right-clicked image/media.'), mediaType: str('image, video, audio or none.'), selectionText: str('Selected text.', false, { sensitive: true }), editable: bool('In a text field.') }

  control.register({
    id: 'extensions.contextMenuItems',
    domain: 'extensions',
    name: "Extensions' right-click items",
    description: "The items installed extensions add to the page's right-click menu for a context (page, link, image, selection, field).",
    params: menuParams,
    mutates: false,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (p, ctx) => d.extensions.bridge.menuEntries(menuContext(p, ctx))
  })

  control.register({
    id: 'extensions.clickContextMenu',
    domain: 'extensions',
    name: "Choose an extension's right-click item",
    description: "Chooses an extension's right-click menu item for a context, as clicking it in the menu does.",
    params: { extensionId: str('Extension id.', true), itemId: { type: 'any', description: 'Menu item id from extensions.contextMenuItems.', required: true }, ...menuParams },
    mutates: true,
    confirmation: 'none',
    requires: ['browser-open'],
    run: (p, ctx) => {
      if (!d.extensions.bridge.clickMenuItem(String(p.extensionId), p.itemId as string | number, menuContext(p, ctx))) fail('not-found', "That menu item doesn't apply here (or is disabled).", true)
    },
    verify: () => ({ verified: true, detail: 'The extension received the menu click.' })
  })

  // ---------------------------------------------------------------- shortcuts

  control.register({
    id: 'shortcuts.list',
    domain: 'shortcuts',
    name: 'Browser shortcuts',
    description: 'Every browser command with its keyboard shortcuts. Orion’s own shortcuts are never taken by the browser.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: () => shortcutActions()
  })

  control.register({
    id: 'shortcuts.invoke',
    domain: 'shortcuts',
    name: 'Run a browser shortcut command',
    description: 'Runs the browser command behind a keyboard shortcut (new-tab, reopen-tab, zoom-in, find, history…) through the same path the key press takes, without generating key events. Prefer a specific capability when there is one.',
    params: { action: str('A command from shortcuts.list.', true, { enum: shortcutActions().map((s) => s.action) }), index: int('For select-tab: 1-8.') },
    mutates: true,
    confirmation: 'none',
    unavailable: () => (!windowControl.state?.open ? 'The browser is closed. Open it first (browser.open).' : windowControl.state.hidden ? 'The browser is behind the chat. Show it first (browser.show).' : null),
    observe: () => windowControl.state,
    run: async (p) => {
      if (!d.sendShortcut(String(p.action), p.index as number | undefined)) fail('unavailable', 'The Orbis window is not open.', true)
      return { action: p.action, after: await windowControl.nextState(900) }
    },
    verify: (data, p, _ctx, before) => {
      const b = before as typeof windowControl.state
      const a = (data as { after: typeof windowControl.state }).after
      const activeOf = (s: typeof b): Record<string, unknown> | undefined => s?.tabs.find((t) => t.active) as Record<string, unknown> | undefined
      const changes = [
        b?.tabs.length !== a?.tabs.length && 'tab count',
        b?.activeTabId !== a?.activeTabId && 'active tab',
        JSON.stringify(b?.tabs.map((t) => t.id)) !== JSON.stringify(a?.tabs.map((t) => t.id)) && 'tab order',
        b?.find.open !== a?.find.open && 'find bar',
        activeOf(b)?.zoom !== activeOf(a)?.zoom && 'zoom',
        b?.panel !== a?.panel && 'panel',
        activeOf(b)?.loading !== activeOf(a)?.loading && 'loading',
        activeOf(b)?.url !== activeOf(a)?.url && 'page'
      ].filter(Boolean)
      const noVisibleChange = ['print', 'save-page', 'devtools', 'stop', 'bookmark', 'bookmark-all', 'focus-url', 'fullscreen', 'back', 'forward', 'reload', 'hard-reload'].includes(String(p.action))
      return { verified: changes.length > 0 || noVisibleChange, detail: changes.length ? `Changed: ${changes.join(', ')}.` : noVisibleChange ? `Ran ${String(p.action)}; it doesn't change tab state.` : `Nothing changed after ${String(p.action)}.` }
    }
  })

  // ---------------------------------------------------------------- state: snapshot, discovery, conditions, log

  control.registerState('browser', () => windowControl.state ?? { open: false })
  control.registerState('capabilities', () => {
    const list = control.list()
    return { total: list.length, available: list.filter((c) => c.available).length, domains: [...new Set(list.map((c) => c.domain))] }
  })
  control.registerState('automation', () => windowControl.listRuns().map((r) => ({ id: r.id, name: r.name, status: r.status, iteration: r.iteration, currentStep: r.currentStep })))

  control.register({
    id: 'state.snapshot',
    domain: 'state',
    name: 'Read browser state',
    description: `The real current state of Orbis, read now: ${control.stateParts().join(', ')} (and any parts registered later). Ask for only the parts needed.`,
    params: { parts: { type: 'array', description: 'Which parts (default: all).' } },
    mutates: false,
    confirmation: 'none',
    run: (p) => control.snapshot(p.parts as string[] | undefined)
  })

  control.register({
    id: 'state.capabilities',
    domain: 'state',
    name: 'What Orbis can do',
    description: 'Discovers the capabilities this Orbis exposes right now, with parameters, requirements, confirmation policy and availability; search by words or domain.',
    params: { query: str('Words to search for.'), domain: str('Only this domain.'), availableOnly: bool('Only those that can run now.') },
    mutates: false,
    confirmation: 'none',
    run: (p, ctx) => control.list({ query: p.query as string | undefined, domain: p.domain as string | undefined, availableOnly: p.availableOnly === true }, ctx.source)
  })

  control.register({
    id: 'state.log',
    domain: 'state',
    name: 'Control log',
    description: 'Recent structured log entries (observation, decision, command, execution, result, verification, error, recovery), with secrets redacted.',
    params: { limit: int('Default 100.'), capability: str('Only this capability.'), runId: str('Only this run.') },
    mutates: false,
    confirmation: 'none',
    run: (p) => control.recentLog(Number(p.limit) || 100, { capability: p.capability as string | undefined, runId: p.runId as string | undefined })
  })

  control.register({
    id: 'state.check',
    domain: 'state',
    name: 'Check a condition',
    description:
      'Evaluates a condition against real state now. { check: elementExists|elementMissing (locator, tabId?), textContains|textMissing (text, locator?, tabId?), urlMatches (pattern, tabId?), pageLoaded (tabId?), downloadCompleted (id? | match?), tabExists (tabId? | url? | title?), windowExists (id? | title?), extensionExists (id? | name?, enabled?), settingEquals (key, value), capabilityAvailable (id), compare (left, op, right) } or { all: [...] } / { any: [...] } / { not: ... }.',
    params: { condition: { type: 'object', description: 'The condition.', required: true } },
    mutates: false,
    confirmation: 'none',
    run: async (p, ctx) => ({ value: await evaluate(p.condition as Condition, ctx) })
  })

  async function evaluate(condition: Condition, ctx: ControlContext): Promise<boolean> {
    if ('all' in condition) {
      for (const c of (condition as { all: Condition[] }).all) if (!(await evaluate(c, ctx))) return false
      return true
    }
    if ('any' in condition) {
      for (const c of (condition as { any: Condition[] }).any) if (await evaluate(c, ctx)) return true
      return false
    }
    if ('not' in condition) return !(await evaluate((condition as { not: Condition }).not, ctx))
    const c = condition as Record<string, unknown>
    const tabCtx = { ...ctx, target: c.tabId ? { tabId: String(c.tabId) } : ctx.target }
    const pageOf = (): WebContents | null => {
      try {
        return tab(tabCtx)
      } catch {
        return null
      }
    }
    switch (c.check) {
      case 'elementExists':
      case 'elementMissing': {
        const wc = pageOf()
        const found: { ref?: number } = wc ? await page.exec<{ ref?: number }>(asPageHandle(wc), page.locateScript((c.locator ?? {}) as Locator), 5000).catch((): { ref?: number } => ({})) : {}
        return c.check === 'elementExists' ? Boolean(found.ref) : !found.ref
      }
      case 'textContains':
      case 'textMissing': {
        const wc = pageOf()
        if (!wc) return c.check === 'textMissing'
        const text = c.locator
          ? await page.exec<string>(asPageHandle(wc), `(() => { ${page.locateScript(c.locator as Locator).slice(0, 0)} const r = ${page.locateScript(c.locator as Locator)}; const el = r.ref && document.querySelector('[data-orbis-ref="' + r.ref + '"]'); return el ? (el.innerText || el.value || '') : ''; })()`, 5000).catch(() => '')
          : await page.exec<string>(asPageHandle(wc), `document.body ? document.body.innerText : ''`, 5000).catch(() => '')
        const has = text.toLowerCase().includes(String(c.text ?? '').toLowerCase())
        return c.check === 'textContains' ? has : !has
      }
      case 'urlMatches': {
        const url = pageOf()?.getURL() ?? ''
        try {
          return new RegExp(String(c.pattern), 'i').test(url)
        } catch {
          return url.includes(String(c.pattern))
        }
      }
      case 'pageLoaded': {
        const wc = pageOf()
        return Boolean(wc && !wc.isLoading() && !d.navigation(wc.id)?.failed)
      }
      case 'downloadCompleted': {
        const x = c.id ? d.library.download(String(c.id)) : d.library.snapshot().downloads.find((y) => !c.match || `${y.filename} ${y.url}`.toLowerCase().includes(String(c.match).toLowerCase()))
        return x?.state === 'completed'
      }
      case 'tabExists':
        return Boolean(windowControl.state?.tabs.some((t) => (!c.tabId || t.id === c.tabId) && (!c.url || t.url.includes(String(c.url))) && (!c.title || t.title.toLowerCase().includes(String(c.title).toLowerCase()))))
      case 'windowExists':
        return allWindows().some(({ win }) => (!c.id || win.id === c.id) && (!c.title || win.getTitle().toLowerCase().includes(String(c.title).toLowerCase())))
      case 'extensionExists':
        return (await d.extensions.list()).some((e) => (!c.id || e.id === c.id) && (!c.name || e.name.toLowerCase().includes(String(c.name).toLowerCase())) && (typeof c.enabled !== 'boolean' || e.enabled === c.enabled))
      case 'settingEquals':
        return compare(readPath(await d.store.getSettings(), String(c.key)), '==', c.value)
      case 'capabilityAvailable':
        return control.describe(String(c.id), ctx.source)?.available === true
      case 'compare':
        return compare(c.left, String(c.op ?? '=='), c.right)
      default:
        return fail('invalid-params', `Unknown condition check "${String(c.check)}".`)
    }
  }
}
