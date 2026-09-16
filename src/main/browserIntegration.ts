import { app, clipboard, dialog, ipcMain, Menu, shell, webContents } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions, Session, WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserDownload, BrowserPermissionRequest, BrowserShortcutEvent, DeviceRequest } from '../shared/types'
import { DeviceChooser } from './deviceChooser'
import { GestureInputAdapter } from './gestureAdapter'

/** Gesture diagnostics, for working out why a trackpad is not behaving. Off unless ORBIS_GESTURE_DEBUG is set. */
const GESTURE_DEBUG = process.env.ORBIS_GESTURE_DEBUG === '1'
import { HistorySwipeRecognizer } from '../shared/historySwipe'
import type { HistorySwipeContext, HistorySwipeView } from '../shared/historySwipe'
import { BrowserLibrary, uniqueDownloadName } from './browserLibrary'
import { decideShortcut, isAutomatedInput } from './browserShortcuts'
import type { KeyInput } from './browserShortcuts'

const isWebUrl = (url: string | undefined): url is string => Boolean(url && /^https?:\/\//i.test(url))

const originOf = (url: string): string => {
  try {
    const { origin } = new URL(url)
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/** Always allowed: harmless for any site. */
const ALWAYS_ALLOWED = new Set(['fullscreen', 'clipboard-sanitized-write'])

/**
 * Asking to pick a device is allowed; reaching one is not. Chromium checks this before it will even offer the chooser,
 * so refusing here means a site is turned away with "no device selected" and no explanation. What a site may actually
 * touch is decided by the chooser the user answers, and enforced by the device permission handler.
 */
const MAY_CHOOSE_A_DEVICE = new Set(['usb', 'hid', 'serial'])

/** Asked about, in plain words. Anything else a site requests is denied. */
const ASKABLE: Record<string, string> = {
  geolocation: 'know your location',
  notifications: 'show notifications',
  midi: 'use your MIDI devices',
  midiSysex: 'use your MIDI devices',
  'clipboard-read': 'see text and images you copy',
  'display-capture': 'share your screen',
  pointerLock: 'hide and lock your mouse pointer',
  keyboardLock: 'take over your keyboard',
  'idle-detection': 'know when you are away',
  'window-management': 'manage windows on your displays',
  'storage-access': 'use its cookies while embedded in other sites',
  'top-level-storage-access': 'use its cookies while embedded in other sites'
}

function describePermission(permission: string, details: { mediaTypes?: string[] }): string {
  if (permission === 'media') {
    const types = details.mediaTypes ?? []
    return types.includes('video') && types.includes('audio') ? 'use your camera and microphone' : types.includes('video') ? 'use your camera' : 'use your microphone'
  }
  return ASKABLE[permission] ?? `use ${permission}`
}

export interface BrowserIntegrationOptions {
  getWindow(): BrowserWindow | null
  session: Session
  library: BrowserLibrary
  /** Opens a page in a separate Orbis browser window. */
  popOut(url: string): void
}

/**
 * The Orbis browser's desktop-browser behaviour in the main process: keyboard shortcuts (for pages, and for the Orbis
 * window while the browser has focus), mouse back/forward, the page context menu, link opening dispositions, history,
 * downloads, site permissions, saving pages and fullscreen.
 */
export class BrowserIntegration {
  /**
   * Choosing a USB, HID, serial or Bluetooth device for a page. Without this every such request is refused out of
   * hand and the site looks broken for no visible reason.
   */
  readonly devices = new DeviceChooser({
    canAsk: (contents) => {
      const win = this.o.getWindow()
      return Boolean(win && contents && contents.hostWebContents === win.webContents)
    },
    ask: (request) =>
      new Promise<string | null>((resolve) => {
        let answered = false
        const answer = (deviceId: string | null): void => {
          if (answered) return
          answered = true
          this.deviceWaiters.delete(request.id)
          this.pendingDevices.delete(request.id)
          resolve(deviceId)
          // The chooser goes away however it was answered.
          this.send('browser:device-answered', request.id)
        }
        this.deviceWaiters.set(request.id, answer)
        this.pendingDevices.set(request.id, request)
        this.send('browser:device-request', request)
        // A chooser nobody answers cancels, so the page is not left waiting for ever.
        setTimeout(() => answer(null), 120_000)
      })
  })
  /**
   * Two-finger history swiping. The trackpad reports movement here, in the main process, where the platform's own
   * account of it arrives — a page is never asked to guess a gesture from mouse events. What it decides is sent to the
   * window, which navigates through exactly the code the Back button uses.
   */
  private readonly swipe = new HistorySwipeRecognizer()
  private readonly gestures = new GestureInputAdapter({ emit: (event) => this.onGesture(event) })
  /** The page the gesture started on, and what it could do at the time. Worked out once, never per movement. */
  private swipeContext: HistorySwipeContext = { canGoBack: false, canGoForward: false, pageCanScrollHorizontally: false }
  private swipeContents: WebContents | null = null
  private lastSwipeView: HistorySwipeView | null = null

  private readonly deviceWaiters = new Map<string, (deviceId: string | null) => void>()
  private readonly pendingDevices = new Map<string, DeviceRequest>()

  /** The window's answer to a device chooser. */
  answerDevice(id: string, deviceId: string | null): boolean {
    const waiter = this.deviceWaiters.get(id)
    if (!waiter) return false
    waiter(deviceId)
    return true
  }

  private readonly o: BrowserIntegrationOptions
  /** The browser (or its URL bar) has focus in the Orbis window, as the window reports it. */
  private browserFocused = false
  private readonly permissionWaiters = new Map<string, (allow: boolean, remember: boolean) => void>()
  private readonly pendingRequests = new Map<string, BrowserPermissionRequest>()
  private readonly downloadItems = new Map<string, Electron.DownloadItem>()
  private libraryTimer: NodeJS.Timeout | null = null
  /** Items installed extensions add to a page's right-click menu. */
  private extensionMenu: ((context: { pageUrl: string; frameUrl?: string; linkUrl?: string; srcUrl?: string; mediaType?: string; selectionText?: string; editable: boolean; tabId: number }) => MenuItemConstructorOptions[]) | null = null

  setExtensionMenu(provider: NonNullable<BrowserIntegration['extensionMenu']>): void {
    this.extensionMenu = provider
  }

  /** The window wants to hear when the pointer moves inside a page (to tuck away fullscreen bars). */
  private watchPageMoves = false
  private lastPageMove = 0

  constructor(options: BrowserIntegrationOptions) {
    this.o = options
    this.o.library.onChange = () => this.queueLibraryUpdate()
  }

  private send(channel: string, ...args: unknown[]): void {
    const win = this.o.getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  private queueLibraryUpdate(): void {
    if (this.libraryTimer) return
    this.libraryTimer = setTimeout(() => {
      this.libraryTimer = null
      this.send('library:changed', this.o.library.snapshot())
    }, 250)
  }

  /** A key press becomes at most one browser shortcut action. */
  private route(event: Electron.Event, input: KeyInput, webContentsId?: number): void {
    const decision = decideShortcut(input)
    if (!decision.handled) return
    if (decision.consume) event.preventDefault()
    if (!decision.run) return
    const shortcut: BrowserShortcutEvent = webContentsId === undefined ? decision.shortcut : { ...decision.shortcut, webContentsId }
    this.send('browser:shortcut', shortcut)
  }

  /** The Orbis window: browser shortcuts apply only while the browser has focus; mouse back/forward buttons. */
  attachWindow(win: BrowserWindow): void {
    win.webContents.on('before-input-event', (event, input) => {
      if (this.browserFocused) this.route(event, input)
    })
    win.on('app-command', (_event, command) => {
      if (!this.browserFocused) return
      if (command === 'browser-backward') this.send('browser:shortcut', { action: 'back' })
      else if (command === 'browser-forward') this.send('browser:shortcut', { action: 'forward' })
    })
  }

  /** A browser tab's page. */
  attachGuest(contents: WebContents): void {
    this.devices.attach(contents)
    contents.on('before-input-event', (event, input) => {
      if (!isAutomatedInput(contents.id)) this.route(event, input, contents.id)
    })
    // Clicks inside a page never reach the Orbis window's document, so open menus and dropdowns hear about them here.
    contents.on('before-mouse-event', (_event, mouse) => {
      if (mouse.type === 'mouseDown') this.send('browser:page-pointer')
      // Pointer movement is only reported while the window asks for it (fullscreen bars are showing), at most every 150ms.
      else if (mouse.type === 'mouseMove' && this.watchPageMoves && Date.now() - this.lastPageMove > 150) {
        this.lastPageMove = Date.now()
        this.send('browser:page-pointer-move')
      }
    })
    // Private tabs live in an in-memory session and never write history.
    const remember = contents.session.isPersistent()
    contents.on('did-navigate', (_event, url) => {
      if (remember) this.o.library.visit(url, contents.getTitle())
    })
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (remember && isMainFrame) this.o.library.visit(url, contents.getTitle())
    })
    contents.on('page-title-updated', (_event, title) => {
      if (remember) this.o.library.retitle(contents.getURL(), title)
    })
    contents.on('context-menu', (_event, params) => this.contextMenu(contents, params))
    // Trackpad movement for the history gesture. Ordinary wheel events are dropped before anything else happens.
    contents.on('before-mouse-event', (_event, mouse) => this.onPageWheel(contents, mouse as Parameters<typeof this.onPageWheel>[1]))
    // A gesture cannot outlive what it was started on.
    contents.on('did-start-navigation', () => this.cancelSwipe())
    contents.once('destroyed', () => {
      if (this.swipeContents === contents) this.cancelSwipe()
    })
  }

  /**
   * A page's trackpad movement. Anything that is not a precision trackpad is dropped in the adapter before any work is
   * done, so an ordinary mouse wheel costs a comparison and nothing else.
   */
  private onPageWheel(contents: WebContents, mouse: { type: string; deltaX?: number; deltaY?: number; hasPreciseScrollingDeltas?: boolean; accelerationRatioX?: number }): void {
    if (GESTURE_DEBUG && mouse.type === 'mouseWheel') {
      // eslint-disable-next-line no-console
      console.log('[gesture] wheel', JSON.stringify(mouse))
    }
    if (!GestureInputAdapter.isTrackpad(mouse)) return
    if (this.swipeContents !== contents) {
      // A gesture belongs to one page. Movement from anywhere else ends whatever was running.
      this.gestures.cancel()
      this.swipeContents = contents
      this.swipeContext = {
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
        // Asked of the page once per gesture rather than per movement; until it answers, the page keeps the movement.
        pageCanScrollHorizontally: true
      }
      void this.askPageAboutScrolling(contents)
    }
    this.gestures.handleWheel(mouse)
  }

  /** Whether the page can still scroll sideways, so the page's own scrolling keeps its claim on the movement. */
  private async askPageAboutScrolling(contents: WebContents): Promise<void> {
    try {
      const scrollable = await contents.executeJavaScript(
        `(() => {
          const room = (el) => el && el.scrollWidth > el.clientWidth + 1
          if (room(document.scrollingElement) || room(document.body)) return true
          const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
          for (let node = el; node && node !== document.body; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowX
            if ((overflow === 'auto' || overflow === 'scroll') && room(node)) return true
          }
          return false
        })()`,
        false
      )
      if (this.swipeContents === contents) this.swipeContext = { ...this.swipeContext, pageCanScrollHorizontally: scrollable === true }
    } catch {
      // A page that cannot be asked keeps the movement, which is the safer way round.
    }
  }

  /** What the recogniser made of one movement: update the preview, and navigate when the fingers lift. */
  private onGesture(event: Parameters<HistorySwipeRecognizer['handle']>[0]): void {
    const contents = this.swipeContents
    const outcome = this.swipe.handle(event, this.swipeContext)
    if (GESTURE_DEBUG) {
      const v = outcome.view
      // eslint-disable-next-line no-console
      console.log(
        `[gesture] ${event.type} dx=${event.deltaX.toFixed(1)} dy=${event.deltaY.toFixed(1)} | state=${v.state} dir=${v.direction} dist=${v.distance.toFixed(0)} progress=${v.progress.toFixed(2)} commit=${v.willCommit} | back=${this.swipeContext.canGoBack} fwd=${this.swipeContext.canGoForward} pageScrollsX=${this.swipeContext.pageCanScrollHorizontally}${outcome.navigate ? ` -> NAVIGATE ${outcome.navigate}` : ''}`
      )
    }
    if (outcome.navigate && contents && !contents.isDestroyed()) {
      // Navigation goes to the window, which does it the same way the Back button does.
      this.send('browser:history-swipe', { view: outcome.view, navigate: outcome.navigate, webContentsId: contents.id })
      this.lastSwipeView = null
      return
    }
    if (outcome.show) {
      const view = outcome.view
      // Only a real change is worth telling the window about, so a still finger sends nothing.
      if (this.lastSwipeView && this.lastSwipeView.direction === view.direction && Math.abs(this.lastSwipeView.progress - view.progress) < 0.01 && this.lastSwipeView.willCommit === view.willCommit) return
      this.lastSwipeView = view
      this.send('browser:history-swipe', { view, navigate: null, webContentsId: contents?.id ?? 0 })
      return
    }
    if (outcome.hide && this.lastSwipeView) {
      this.lastSwipeView = null
      this.send('browser:history-swipe', { view: outcome.view, navigate: null, webContentsId: contents?.id ?? 0 })
    }
  }

  /** Everything that should stop a gesture in its tracks: the tab going away, the window losing focus, a navigation. */
  cancelSwipe(): void {
    this.gestures.cancel()
    const outcome = this.swipe.cancel()
    this.swipeContents = null
    if (this.lastSwipeView) {
      this.lastSwipeView = null
      this.send('browser:history-swipe', { view: outcome.view, navigate: null, webContentsId: 0 })
    }
  }

  /** Where a link or window.open from a page goes: Ctrl/middle-click a background tab, Shift+click a new window. */
  openFromPage(url: string, details: { disposition: string; features: string }): void {
    if (!isWebUrl(url)) return
    if (details.disposition === 'new-window' && !details.features) return this.o.popOut(url)
    this.send('browser:new-tab', url, { background: details.disposition === 'background-tab' })
  }

  private contextMenu(contents: WebContents, params: Electron.ContextMenuParams): void {
    const win = this.o.getWindow()
    if (!win) return
    const items: MenuItemConstructorOptions[] = []
    const openTab = (url: string, background = false): void => this.send('browser:new-tab', url, { background })
    const separate = (): void => {
      if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' })
    }

    if (isWebUrl(params.linkURL)) {
      items.push(
        { label: 'Open link in new tab', click: () => openTab(params.linkURL) },
        { label: 'Open link in background tab', click: () => openTab(params.linkURL, true) },
        { label: 'Open link in new window', click: () => this.o.popOut(params.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        { label: 'Save link as…', click: () => contents.downloadURL(params.linkURL) }
      )
      separate()
    }
    if (params.mediaType === 'image' && isWebUrl(params.srcURL)) {
      items.push(
        { label: 'Open image in new tab', click: () => openTab(params.srcURL) },
        { label: 'Copy image', click: () => contents.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
        { label: 'Save image as…', click: () => contents.downloadURL(params.srcURL) }
      )
      separate()
    } else if ((params.mediaType === 'video' || params.mediaType === 'audio') && isWebUrl(params.srcURL)) {
      items.push({ label: `Save ${params.mediaType} as…`, click: () => contents.downloadURL(params.srcURL) }, { label: `Copy ${params.mediaType} address`, click: () => clipboard.writeText(params.srcURL) })
      separate()
    }
    if (params.isEditable) {
      for (const suggestion of params.dictionarySuggestions.slice(0, 4)) items.push({ label: suggestion, click: () => contents.replaceMisspelling(suggestion) })
      separate()
      items.push(
        { label: 'Undo', enabled: params.editFlags.canUndo, click: () => contents.undo() },
        { label: 'Redo', enabled: params.editFlags.canRedo, click: () => contents.redo() },
        { type: 'separator' },
        { label: 'Cut', enabled: params.editFlags.canCut, click: () => contents.cut() },
        { label: 'Copy', enabled: params.editFlags.canCopy, click: () => contents.copy() },
        { label: 'Paste', enabled: params.editFlags.canPaste, click: () => contents.paste() },
        { label: 'Select all', click: () => contents.selectAll() }
      )
      separate()
    } else if (params.selectionText.trim()) {
      const text = params.selectionText.trim()
      items.push(
        { label: 'Copy', click: () => contents.copy() },
        { label: `Search Google for “${text.length > 30 ? `${text.slice(0, 30)}…` : text}”`, click: () => openTab(`https://www.google.com/search?q=${encodeURIComponent(text)}`) }
      )
      separate()
    }
    if (!params.linkURL && params.mediaType === 'none' && !params.isEditable && !params.selectionText.trim()) {
      const history = contents.navigationHistory
      items.push(
        { label: 'Back', enabled: history.canGoBack(), click: () => history.goBack() },
        { label: 'Forward', enabled: history.canGoForward(), click: () => history.goForward() },
        { label: 'Reload', click: () => contents.reload() },
        { type: 'separator' },
        { label: 'Save page as…', click: () => void this.savePage(contents) },
        { label: 'Print…', click: () => contents.print() },
        { label: 'View page source', enabled: isWebUrl(contents.getURL()), click: () => openTab(`view-source:${contents.getURL()}`) }
      )
      separate()
    }
    const fromExtensions = this.extensionMenu?.({
      pageUrl: params.pageURL || contents.getURL(),
      frameUrl: params.frameURL || undefined,
      linkUrl: params.linkURL || undefined,
      srcUrl: params.srcURL || undefined,
      mediaType: params.mediaType,
      selectionText: params.selectionText || undefined,
      editable: params.isEditable,
      tabId: contents.id
    })
    if (fromExtensions?.length) {
      items.push(...fromExtensions)
      separate()
    }
    items.push({ label: 'Inspect', click: () => contents.inspectElement(params.x, params.y) })
    Menu.buildFromTemplate(items).popup({ window: win })
  }

  private async savePage(contents: WebContents): Promise<boolean> {
    const win = this.o.getWindow()
    const title = contents.getTitle().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'page'
    const options = { title: 'Save page as', defaultPath: join(app.getPath('downloads'), `${title}.html`), filters: [{ name: 'Web page, complete', extensions: ['html', 'htm'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    try {
      await contents.savePage(result.filePath, 'HTMLComplete')
      return true
    } catch {
      return false
    }
  }

  /**
   * Downloads saved to the Downloads folder (never overwriting), and site permissions asked for or remembered.
   * Private tabs' in-memory session asks every time: it never reads or saves remembered permissions.
   */
  setupSession(session: Session = this.o.session): void {
    this.devices.wire(session)
    const { library } = this.o
    const remembers = session.isPersistent()
    session.on('will-download', (_event, item) => {
      const dir = app.getPath('downloads')
      const filename = uniqueDownloadName(item.getFilename(), (name) => existsSync(join(dir, name)))
      const path = join(dir, filename)
      item.setSavePath(path)
      const id = crypto.randomUUID()
      const startedAt = Date.now()
      this.downloadItems.set(id, item)
      const record = (state: BrowserDownload['state']): BrowserDownload => ({ id, url: item.getURL(), filename, path, state, receivedBytes: item.getReceivedBytes(), totalBytes: item.getTotalBytes(), startedAt })
      const started = record('progressing')
      library.upsertDownload(started)
      this.send('browser:download', { type: 'started', download: started })
      let lastUpdate = 0
      item.on('updated', (_e, state) => {
        if (Date.now() - lastUpdate < 400) return
        lastUpdate = Date.now()
        library.upsertDownload(record(state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing'))
      })
      item.once('done', (_e, state) => {
        this.downloadItems.delete(id)
        const done = { ...record(state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted'), finishedAt: Date.now() }
        library.upsertDownload(done)
        this.send('browser:download', { type: 'done', download: done })
      })
    })

    session.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (ALWAYS_ALLOWED.has(permission)) return callback(true)
      const origin = originOf(details.requestingUrl || contents.getURL())
      const askable = permission === 'media' || permission in ASKABLE
      if (!origin || !askable) return callback(false)
      const remembered = remembers ? library.permission(origin, permission) : undefined
      if (remembered) return callback(remembered === 'allow')
      // Only tabs in the Orbis window can show the prompt; elsewhere (a pop-out window) the request is declined.
      const win = this.o.getWindow()
      if (!win || contents.hostWebContents !== win.webContents) return callback(false)
      const id = crypto.randomUUID()
      let answered = false
      const answer = (allow: boolean, remember: boolean): void => {
        if (answered) return
        answered = true
        this.permissionWaiters.delete(id)
        this.pendingRequests.delete(id)
        if (remember && remembers) library.rememberPermission(origin, permission, allow ? 'allow' : 'block')
        callback(allow)
        // The window's prompt goes away however the request was answered.
        this.send('browser:permission-answered', id)
      }
      this.permissionWaiters.set(id, answer)
      const request: BrowserPermissionRequest = { id, webContentsId: contents.id, origin, permission, label: describePermission(permission, details as { mediaTypes?: string[] }) }
      this.pendingRequests.set(id, request)
      this.send('browser:permission', request)
      // A request nobody answers is declined, so the page isn't left waiting forever.
      setTimeout(() => answer(false, false), 120_000)
    })
    session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      if (ALWAYS_ALLOWED.has(permission) || MAY_CHOOSE_A_DEVICE.has(permission)) return true
      return remembers && library.permission(originOf(requestingOrigin), permission) === 'allow'
    })
  }

  /**
   * A download's controls, as the downloads list offers them. Returns what happened, so callers can tell a download
   * that can't be resumed or a file that is gone from one that worked.
   */
  async downloadAction(id: string, action: 'cancel' | 'pause' | 'resume' | 'open' | 'show'): Promise<{ done: boolean; reason?: string }> {
    const item = this.downloadItems.get(id)
    const record = this.o.library.download(id)
    if (!record) return { done: false, reason: 'There is no such download.' }
    if (action === 'cancel' || action === 'pause' || action === 'resume') {
      if (!item) return { done: false, reason: `That download is ${record.state}, so it can't be ${action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'resumed'}.` }
      if (action === 'cancel') item.cancel()
      else if (action === 'pause') item.pause()
      else if (!item.canResume()) return { done: false, reason: "The server doesn't allow resuming this download." }
      else item.resume()
      return { done: true }
    }
    if (!existsSync(record.path)) return { done: false, reason: 'The downloaded file is no longer there.' }
    if (action === 'open') {
      if (record.state !== 'completed') return { done: false, reason: 'The download has not finished.' }
      const problem = await shell.openPath(record.path)
      return problem ? { done: false, reason: problem } : { done: true }
    }
    shell.showItemInFolder(record.path)
    return { done: true }
  }

  /** Answers a site's pending permission request (camera, location…) the way the prompt's buttons do. */
  answerPermission(id: string, allow: boolean, remember: boolean): boolean {
    const waiter = this.permissionWaiters.get(id)
    if (!waiter) return false
    waiter(allow, remember)
    return true
  }

  /** Site permission requests waiting for an answer. */
  pendingPermissions(): BrowserPermissionRequest[] {
    return [...this.pendingRequests.values()]
  }

  /** Saves a tab's page (the user picks where). */
  saveTabPage(contents: WebContents): Promise<boolean> {
    return this.savePage(contents)
  }

  registerIpc(): void {
    const { library } = this.o
    ipcMain.on('browser:focus', (_event, focused: unknown) => {
      this.browserFocused = focused === true
    })
    ipcMain.on('browser:watch-page-moves', (_event, on: unknown) => {
      this.watchPageMoves = on === true
    })
    ipcMain.handle('library:get', () => library.snapshot())
    ipcMain.handle('library:toggle-bookmark', (_e, url: unknown, title: unknown) => (typeof url === 'string' ? library.toggleBookmark(url, typeof title === 'string' ? title : '') : false))
    ipcMain.handle('library:add-bookmarks', (_e, pages: unknown) =>
      Array.isArray(pages) ? library.addBookmarks(pages.filter((p): p is { url: string; title: string } => p && typeof p.url === 'string').map((p) => ({ url: p.url, title: String(p.title ?? '') }))) : 0
    )
    ipcMain.handle('library:remove-bookmark', (_e, url: unknown) => {
      if (typeof url === 'string') library.removeBookmark(url)
    })
    ipcMain.handle('library:remove-history', (_e, url: unknown) => {
      if (typeof url === 'string') library.removeHistory(url)
    })
    ipcMain.handle('library:clear-history', () => library.clearHistory())
    ipcMain.handle('library:record-search', (_e, query: unknown) => {
      if (typeof query === 'string') library.recordSearch(query)
    })
    ipcMain.handle('library:remove-search', (_e, query: unknown) => {
      if (typeof query === 'string') library.removeSearch(query)
    })
    ipcMain.handle('library:clear-searches', () => library.clearSearches())
    ipcMain.handle('library:record-pick', (_e, key: unknown) => {
      if (typeof key === 'string') library.recordPick(key)
    })
    ipcMain.handle('library:clear-downloads', () => library.clearFinishedDownloads())
    ipcMain.handle('library:download-action', async (_e, id: unknown, action: unknown) => {
      if (typeof id === 'string' && (action === 'cancel' || action === 'pause' || action === 'resume' || action === 'open' || action === 'show')) await this.downloadAction(id, action)
    })
    ipcMain.handle('browser:permission-answer', (_e, id: unknown, allow: unknown, remember: unknown) => {
      if (typeof id === 'string') this.permissionWaiters.get(id)?.(allow === true, remember === true)
    })
    ipcMain.handle('browser:device-answer', (_e, id: unknown, deviceId: unknown) => {
      if (typeof id !== 'string') return false
      return this.answerDevice(id, typeof deviceId === 'string' && deviceId ? deviceId : null)
    })
    ipcMain.handle('browser:pending-devices', () => [...this.pendingDevices.values()])
    ipcMain.handle('browser:save-page', (_e, webContentsId: unknown) => {
      const contents = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : undefined
      return contents && !contents.isDestroyed() ? this.savePage(contents) : false
    })
    ipcMain.handle('window:fullscreen', (event, on: unknown) => {
      const win = this.o.getWindow()
      if (!win || event.sender !== win.webContents) return false
      win.setFullScreen(typeof on === 'boolean' ? on : !win.isFullScreen())
      return win.isFullScreen()
    })
  }
}
