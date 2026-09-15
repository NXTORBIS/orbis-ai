import { app, clipboard, dialog, ipcMain, Menu, shell, webContents } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions, Session, WebContents } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserDownload, BrowserPermissionRequest, BrowserShortcutEvent } from '../shared/types'
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
  private readonly o: BrowserIntegrationOptions
  /** The browser (or its URL bar) has focus in the Orbis window, as the window reports it. */
  private browserFocused = false
  private readonly permissionWaiters = new Map<string, (allow: boolean, remember: boolean) => void>()
  private readonly downloadItems = new Map<string, Electron.DownloadItem>()
  private libraryTimer: NodeJS.Timeout | null = null

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
    contents.on('before-input-event', (event, input) => {
      if (!isAutomatedInput(contents.id)) this.route(event, input, contents.id)
    })
    contents.on('did-navigate', (_event, url) => this.o.library.visit(url, contents.getTitle()))
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) this.o.library.visit(url, contents.getTitle())
    })
    contents.on('page-title-updated', (_event, title) => this.o.library.retitle(contents.getURL(), title))
    contents.on('context-menu', (_event, params) => this.contextMenu(contents, params))
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

  /** Downloads saved to the Downloads folder (never overwriting), and site permissions asked for or remembered. */
  setupSession(): void {
    const { session, library } = this.o
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
      const remembered = library.permission(origin, permission)
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
        if (remember) library.rememberPermission(origin, permission, allow ? 'allow' : 'block')
        callback(allow)
      }
      this.permissionWaiters.set(id, answer)
      const request: BrowserPermissionRequest = { id, webContentsId: contents.id, origin, permission, label: describePermission(permission, details as { mediaTypes?: string[] }) }
      this.send('browser:permission', request)
      // A request nobody answers is declined, so the page isn't left waiting forever.
      setTimeout(() => answer(false, false), 120_000)
    })
    session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
      if (ALWAYS_ALLOWED.has(permission)) return true
      return library.permission(originOf(requestingOrigin), permission) === 'allow'
    })
  }

  registerIpc(): void {
    const { library } = this.o
    ipcMain.on('browser:focus', (_event, focused: unknown) => {
      this.browserFocused = focused === true
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
      if (typeof id !== 'string') return
      const item = this.downloadItems.get(id)
      const record = library.download(id)
      if (action === 'cancel') item?.cancel()
      else if (action === 'pause') item?.pause()
      else if (action === 'resume' && item?.canResume()) item.resume()
      else if (action === 'open' && record?.state === 'completed' && existsSync(record.path)) await shell.openPath(record.path)
      else if (action === 'show' && record && existsSync(record.path)) shell.showItemInFolder(record.path)
    })
    ipcMain.handle('browser:permission-answer', (_e, id: unknown, allow: unknown, remember: unknown) => {
      if (typeof id === 'string') this.permissionWaiters.get(id)?.(allow === true, remember === true)
    })
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
