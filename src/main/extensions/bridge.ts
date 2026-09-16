import { nativeImage, webContents as electronWebContents } from 'electron'
import type { BrowserWindow, MenuItemConstructorOptions, Session, WebContents } from 'electron'
import { readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, normalize, sep } from 'node:path'
import { isHostPattern, matchesAny, matchesPattern } from './matchPattern'

/** An Orbis browser tab as the window reports it; its id is the page's WebContents id, as Chrome's tab ids are to extensions. */
export interface ReportedTab {
  id: number
  index: number
  url: string
  title: string
  favIconUrl?: string
  active: boolean
  pinned: boolean
  audible: boolean
  muted: boolean
  loading: boolean
}

/** What an extension asks the Orbis window to do. */
export type WindowRequest =
  | { kind: 'create-tab'; url?: string; active: boolean; index?: number; pinned?: boolean }
  | { kind: 'update-tab'; tabId: number; url?: string; active?: boolean; pinned?: boolean; muted?: boolean }
  | { kind: 'remove-tabs'; tabIds: number[] }
  | { kind: 'move-tab'; tabId: number; index: number }
  | { kind: 'open-popup'; extensionId: string }

export interface BridgeExtension {
  id: string
  path: string
  manifest: Record<string, unknown> & { permissions?: string[]; host_permissions?: string[]; optional_permissions?: string[]; optional_host_permissions?: string[] }
}

export interface ActionState {
  title?: string
  popup?: string
  /** A data URL. */
  icon?: string
  badgeText?: string
  badgeBackgroundColor?: [number, number, number, number]
  badgeTextColor?: [number, number, number, number]
  enabled?: boolean
}

export interface BridgeOptions {
  session: Session
  getWindow(): BrowserWindow | null
  getExtension(id: string): BridgeExtension | null
  /** Carries out a request in the Orbis window; for create-tab, resolves with the new tab's id. */
  requestWindow(request: WindowRequest): Promise<number | null>
  /** Optional permissions the user has granted, per extension. */
  getGranted(id: string): { permissions: string[]; origins: string[] }
  setGranted(id: string, granted: { permissions: string[]; origins: string[] }): void
  /** Asks the user to grant optional permissions; resolves whether they allowed it. */
  askPermissions(id: string, permissions: string[], origins: string[]): Promise<boolean>
  optionsUrl(id: string): string | null
  /** Toolbar state (badge, icon, title, popup) changed. */
  onActionChanged(extensionId: string): void
  /** Where each extension's chrome.storage.sync data is kept. */
  syncDir: string
}

/** Chrome's limits for chrome.storage.sync. */
const SYNC_QUOTA = { QUOTA_BYTES: 102_400, QUOTA_BYTES_PER_ITEM: 8_192, MAX_ITEMS: 512 }

interface MenuItem {
  id: string | number
  parentId?: string | number
  title?: string
  type?: 'normal' | 'checkbox' | 'radio' | 'separator'
  checked?: boolean
  enabled?: boolean
  visible?: boolean
  contexts?: string[]
  documentUrlPatterns?: string[]
  targetUrlPatterns?: string[]
}

export interface MenuContext {
  pageUrl: string
  frameUrl?: string
  linkUrl?: string
  srcUrl?: string
  mediaType?: string
  selectionText?: string
  editable: boolean
  tabId: number
}

const fail = (message: string): never => {
  throw new Error(message)
}

const toColor = (value: unknown): [number, number, number, number] | undefined => {
  if (Array.isArray(value) && value.length === 4) return value.map((n) => Math.max(0, Math.min(255, Number(n) || 0))) as [number, number, number, number]
  if (typeof value === 'string') {
    const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
    if (hex) {
      const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]
    }
  }
  return undefined
}

/**
 * Implements the Chrome extension APIs Electron lacks, for real, against Orbis's tabs, window, toolbar and context
 * menu. Calls arrive from extension service workers and pages through the extension preload; events are delivered back
 * to them, waking a stopped service worker when it listens for the event.
 */
export class ExtensionBridge {
  private readonly o: BridgeOptions
  private tabs = new Map<number, ReportedTab>()
  private activeTabId: number | null = null
  private readonly actions = new Map<string, { global: ActionState; perTab: Map<number, ActionState> }>()
  private readonly menus = new Map<string, MenuItem[]>()
  /** Event names each extension listens to, so stopped workers are woken only when needed. */
  private readonly listening = new Map<string, Set<string>>()
  /** activeTab: tabs an extension may see because the user invoked it there. */
  private readonly activeTabGrants = new Map<string, Set<number>>()
  private windowFocused = true

  constructor(o: BridgeOptions) {
    this.o = o
  }

  // ------------------------------------------------------------------ permissions

  private permissionsOf(ext: BridgeExtension): { apis: Set<string>; hosts: string[] } {
    const granted = this.o.getGranted(ext.id)
    const declared = [...(ext.manifest.permissions ?? []), ...granted.permissions]
    const hosts = [...(ext.manifest.host_permissions ?? []), ...declared.filter(isHostPattern), ...granted.origins]
    return { apis: new Set(declared.filter((p) => !isHostPattern(p))), hosts }
  }

  private canSeeTab(ext: BridgeExtension, tab: ReportedTab): boolean {
    const { apis, hosts } = this.permissionsOf(ext)
    return apis.has('tabs') || matchesAny(hosts, tab.url) || Boolean(this.activeTabGrants.get(ext.id)?.has(tab.id))
  }

  private windowId(): number {
    return this.o.getWindow()?.id ?? 1
  }

  /** A Chrome Tab object, with url/title/favicon only where the extension may see them. */
  private tabInfo(ext: BridgeExtension, tab: ReportedTab): Record<string, unknown> {
    const visible = this.canSeeTab(ext, tab)
    return {
      id: tab.id,
      index: tab.index,
      windowId: this.windowId(),
      highlighted: tab.active,
      active: tab.active,
      pinned: tab.pinned,
      audible: tab.audible,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      mutedInfo: { muted: tab.muted },
      status: tab.loading ? 'loading' : 'complete',
      incognito: false,
      selected: tab.active,
      groupId: -1,
      ...(visible ? { url: tab.url, title: tab.title, ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}) } : {})
    }
  }

  private windowInfo(ext: BridgeExtension, populate = false): Record<string, unknown> {
    const win = this.o.getWindow()
    const bounds = win?.getBounds()
    return {
      id: this.windowId(),
      focused: this.windowFocused,
      top: bounds?.y ?? 0,
      left: bounds?.x ?? 0,
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
      incognito: false,
      type: 'normal',
      state: win?.isFullScreen() ? 'fullscreen' : win?.isMinimized() ? 'minimized' : win?.isMaximized() ? 'maximized' : 'normal',
      alwaysOnTop: false,
      ...(populate ? { tabs: this.sortedTabs().map((t) => this.tabInfo(ext, t)) } : {})
    }
  }

  private sortedTabs(): ReportedTab[] {
    return [...this.tabs.values()].sort((a, b) => a.index - b.index)
  }

  // ------------------------------------------------------------------ tabs reported by the window

  /** The window's current tabs; differences become chrome.tabs events. */
  updateTabs(next: ReportedTab[]): void {
    const previous = this.tabs
    const nextMap = new Map(next.map((t) => [t.id, t]))
    this.tabs = nextMap
    const nextActive = next.find((t) => t.active)?.id ?? null

    for (const tab of next) {
      const before = previous.get(tab.id)
      if (!before) {
        this.emitPerExtension('tabs.onCreated', (ext) => [this.tabInfo(ext, tab)])
        continue
      }
      if (before.url !== tab.url) {
        // Chrome clears an activeTab grant once the tab navigates away.
        for (const grants of this.activeTabGrants.values()) if (new URL(before.url || 'about:blank').origin !== new URL(tab.url || 'about:blank').origin) grants.delete(tab.id)
      }
      const change: Record<string, unknown> = {}
      if (before.loading !== tab.loading) change.status = tab.loading ? 'loading' : 'complete'
      if (before.pinned !== tab.pinned) change.pinned = tab.pinned
      if (before.audible !== tab.audible) change.audible = tab.audible
      if (before.muted !== tab.muted) change.mutedInfo = { muted: tab.muted }
      const sensitive: Record<string, unknown> = {}
      if (before.url !== tab.url) sensitive.url = tab.url
      if (before.title !== tab.title) sensitive.title = tab.title
      if (before.favIconUrl !== tab.favIconUrl && tab.favIconUrl) sensitive.favIconUrl = tab.favIconUrl
      if (Object.keys(change).length || Object.keys(sensitive).length) {
        this.emitPerExtension('tabs.onUpdated', (ext) => {
          const info = { ...change, ...(this.canSeeTab(ext, tab) ? sensitive : {}) }
          return Object.keys(info).length ? [tab.id, info, this.tabInfo(ext, tab)] : null
        })
      }
      if (before.index !== tab.index) this.emitPerExtension('tabs.onMoved', () => [tab.id, { windowId: this.windowId(), fromIndex: before.index, toIndex: tab.index }])
    }
    for (const id of previous.keys()) {
      if (nextMap.has(id)) continue
      for (const grants of this.activeTabGrants.values()) grants.delete(id)
      for (const state of this.actions.values()) state.perTab.delete(id)
      this.emitPerExtension('tabs.onRemoved', () => [id, { windowId: this.windowId(), isWindowClosing: false }])
    }
    if (nextActive !== null && nextActive !== this.activeTabId) {
      this.emitPerExtension('tabs.onActivated', () => [{ tabId: nextActive, windowId: this.windowId() }])
      this.emitPerExtension('tabs.onHighlighted', () => [{ tabIds: [nextActive], windowId: this.windowId() }])
    }
    this.activeTabId = nextActive
    if (nextActive !== null) for (const id of this.actions.keys()) this.o.onActionChanged(id)
  }

  setWindowFocused(focused: boolean): void {
    if (this.windowFocused === focused) return
    this.windowFocused = focused
    this.emitPerExtension('windows.onFocusChanged', () => [focused ? this.windowId() : -1])
  }

  // ------------------------------------------------------------------ toolbar actions

  /** The toolbar button's effective state for the active tab. */
  actionState(extensionId: string, tabId = this.activeTabId): ActionState {
    const ext = this.o.getExtension(extensionId)
    const manifestAction = (ext?.manifest.action ?? ext?.manifest.browser_action ?? {}) as { default_title?: string; default_popup?: string }
    const state = this.actions.get(extensionId)
    return {
      title: manifestAction.default_title,
      popup: manifestAction.default_popup,
      enabled: true,
      ...state?.global,
      ...(tabId !== null ? state?.perTab.get(tabId) : undefined)
    }
  }

  private setAction(ext: BridgeExtension, tabId: unknown, patch: ActionState): void {
    let state = this.actions.get(ext.id)
    if (!state) this.actions.set(ext.id, (state = { global: {}, perTab: new Map() }))
    if (typeof tabId === 'number') {
      if (!this.tabs.has(tabId)) fail(`No tab with id: ${tabId}.`)
      state.perTab.set(tabId, { ...state.perTab.get(tabId), ...patch })
    } else state.global = { ...state.global, ...patch }
    this.o.onActionChanged(ext.id)
  }

  /** The user clicked an extension's toolbar button in a tab: grants activeTab and either opens its popup or fires onClicked. */
  async clickAction(extensionId: string): Promise<{ popup: string | null }> {
    const ext = this.o.getExtension(extensionId) ?? fail('That extension is not installed.')
    const tabId = this.activeTabId
    const tab = tabId !== null ? this.tabs.get(tabId) : undefined
    if (tab) this.grantActiveTab(ext, tab.id)
    const state = this.actionState(ext.id)
    if (state.enabled === false) return { popup: null }
    if (state.popup) return { popup: `chrome-extension://${ext.id}/${state.popup.replace(/^\//, '')}` }
    if (tab) await this.emitTo(ext.id, 'action.onClicked', [this.tabInfo(ext, tab)])
    return { popup: null }
  }

  private grantActiveTab(ext: BridgeExtension, tabId: number): void {
    if (!this.permissionsOf(ext).apis.has('activeTab')) return
    let grants = this.activeTabGrants.get(ext.id)
    if (!grants) this.activeTabGrants.set(ext.id, (grants = new Set()))
    grants.add(tabId)
  }

  private iconFromPath(ext: BridgeExtension, path: unknown): string | undefined {
    const choose = typeof path === 'string' ? path : path && typeof path === 'object' ? Object.entries(path as Record<string, string>).sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1] : undefined
    if (!choose) return undefined
    const file = normalize(join(ext.path, choose.replace(/^\//, '')))
    if (!file.startsWith(normalize(ext.path) + sep)) fail('Icon path is outside the extension.')
    const image = nativeImage.createFromBuffer(readFileSync(file))
    return image.isEmpty() ? undefined : image.toDataURL()
  }

  private iconFromImageData(imageData: unknown): string | undefined {
    const pick = (value: unknown): { width: number; height: number; data: number[] } | undefined => {
      const d = value as { width?: number; height?: number; data?: number[] }
      return d && typeof d.width === 'number' && typeof d.height === 'number' && Array.isArray(d.data) ? (d as { width: number; height: number; data: number[] }) : undefined
    }
    const direct = pick(imageData)
    const candidate = direct ?? Object.values((imageData ?? {}) as Record<string, unknown>).map(pick).filter(Boolean).sort((a, b) => b!.width - a!.width)[0]
    if (!candidate || candidate.data.length !== candidate.width * candidate.height * 4) return undefined
    // ImageData is RGBA; Electron bitmaps are BGRA.
    const bgra = Buffer.alloc(candidate.data.length)
    for (let i = 0; i < candidate.data.length; i += 4) {
      bgra[i] = candidate.data[i + 2]
      bgra[i + 1] = candidate.data[i + 1]
      bgra[i + 2] = candidate.data[i]
      bgra[i + 3] = candidate.data[i + 3]
    }
    return nativeImage.createFromBitmap(bgra, { width: candidate.width, height: candidate.height }).toDataURL()
  }

  // ------------------------------------------------------------------ context menus

  /** Whether an extension's menu item belongs in the menu for this right-click. */
  private menuItemApplies(item: MenuItem, context: MenuContext): boolean {
    if (item.visible === false) return false
    const contexts = new Set(['all', 'page'])
    if (context.selectionText) contexts.add('selection')
    if (context.linkUrl) contexts.add('link')
    if (context.editable) contexts.add('editable')
    if (context.mediaType === 'image') contexts.add('image')
    if (context.mediaType === 'video') contexts.add('video')
    if (context.mediaType === 'audio') contexts.add('audio')
    if (context.frameUrl && context.frameUrl !== context.pageUrl) contexts.add('frame')
    const wanted = item.contexts?.length ? item.contexts : ['page']
    const inContext = wanted.includes('all') ? true : wanted.some((c) => c !== 'page' && contexts.has(c)) || (wanted.includes('page') && !context.selectionText && !context.linkUrl && !context.editable && (!context.mediaType || context.mediaType === 'none'))
    if (!inContext) return false
    if (item.documentUrlPatterns?.length && !matchesAny(item.documentUrlPatterns, context.frameUrl || context.pageUrl)) return false
    const target = context.linkUrl || context.srcUrl
    if (item.targetUrlPatterns?.length && (!target || !matchesAny(item.targetUrlPatterns, target))) return false
    return true
  }

  /** Chooses an extension's menu item for a right-click, as clicking it in the menu does. Returns false if it doesn't apply. */
  clickMenuItem(extensionId: string, itemId: string | number, context: MenuContext): boolean {
    const ext = this.o.getExtension(extensionId)
    const item = this.menus.get(extensionId)?.find((i) => i.id === itemId)
    if (!ext || !item || item.type === 'separator' || item.enabled === false || !this.menuItemApplies(item, context)) return false
    const tab = this.tabs.get(context.tabId)
    if (tab) this.grantActiveTab(ext, tab.id)
    if (item.type === 'checkbox') item.checked = !item.checked
    if (item.type === 'radio') item.checked = true
    const info = {
      menuItemId: item.id,
      ...(item.parentId !== undefined ? { parentMenuItemId: item.parentId } : {}),
      editable: context.editable,
      pageUrl: context.pageUrl,
      ...(context.frameUrl ? { frameUrl: context.frameUrl } : {}),
      ...(context.linkUrl ? { linkUrl: context.linkUrl } : {}),
      ...(context.srcUrl ? { srcUrl: context.srcUrl } : {}),
      ...(context.mediaType && context.mediaType !== 'none' ? { mediaType: context.mediaType } : {}),
      ...(context.selectionText ? { selectionText: context.selectionText } : {}),
      ...(item.type === 'checkbox' || item.type === 'radio' ? { checked: item.checked, wasChecked: !item.checked } : {})
    }
    void this.emitTo(ext.id, 'contextMenus.onClicked', [info, tab ? this.tabInfo(ext, tab) : undefined])
    return true
  }

  /** Extensions' menu items for a right-click, flat, with what each is (for the control layer). */
  menuEntries(context: MenuContext): { extensionId: string; extension: string; itemId: string | number; parentId?: string | number; title: string; type: string; checked?: boolean; enabled: boolean }[] {
    const out: ReturnType<ExtensionBridge['menuEntries']> = []
    for (const [extensionId, items] of this.menus) {
      const ext = this.o.getExtension(extensionId)
      if (!ext) continue
      for (const item of items) {
        if (item.type === 'separator' || !this.menuItemApplies(item, context)) continue
        out.push({
          extensionId,
          extension: String(ext.manifest.name ?? extensionId),
          itemId: item.id,
          ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
          title: (item.title ?? '').replace(/%s/g, (context.selectionText ?? '').slice(0, 40)),
          type: item.type ?? 'normal',
          ...(item.type === 'checkbox' || item.type === 'radio' ? { checked: Boolean(item.checked) } : {}),
          enabled: item.enabled !== false
        })
      }
    }
    return out
  }

  /** Items an extension added for this click, for the page's right-click menu. */
  menuItems(context: MenuContext): MenuItemConstructorOptions[] {
    const out: MenuItemConstructorOptions[] = []
    for (const [extensionId, items] of this.menus) {
      const ext = this.o.getExtension(extensionId)
      if (!ext) continue
      const build = (parentId: string | number | undefined): MenuItemConstructorOptions[] =>
        items
          .filter((item) => item.parentId === parentId && this.menuItemApplies(item, context))
          .map((item) => {
            const children = build(item.id)
            const label = (item.title ?? '').replace(/%s/g, (context.selectionText ?? '').slice(0, 40))
            if (item.type === 'separator') return { type: 'separator' as const }
            return {
              label,
              enabled: item.enabled !== false,
              ...(item.type === 'checkbox' || item.type === 'radio' ? { type: item.type, checked: Boolean(item.checked) } : {}),
              ...(children.length ? { submenu: children } : { click: () => void this.clickMenuItem(extensionId, item.id, context) })
            }
          })
      const top = build(undefined)
      if (!top.length) continue
      const name = String(ext.manifest.name ?? ext.id)
      // Like Chrome: one item goes straight in the menu; several are grouped under the extension's name.
      out.push(...(top.length === 1 ? top : [{ label: name, submenu: top }]))
    }
    return out
  }

  // ------------------------------------------------------------------ event delivery

  private extensionIds(): string[] {
    return [...new Set([...this.listening.keys()])]
  }

  /** Sends an event to one extension's pages and service worker (waking the worker if it listens for it). */
  async emitTo(extensionId: string, name: string, args: unknown[]): Promise<void> {
    for (const contents of electronWebContents.getAllWebContents()) {
      if (contents.isDestroyed()) continue
      let url = ''
      try {
        url = contents.getURL()
      } catch {
        continue
      }
      if (url.startsWith(`chrome-extension://${extensionId}/`)) contents.send('orbis-ext:event', name, args)
    }
    if (!this.listening.get(extensionId)?.has(name)) return
    const scope = `chrome-extension://${extensionId}/`
    try {
      const running = Object.entries(this.o.session.serviceWorkers.getAllRunning()).find(([, info]) => info.scope === scope)
      const worker = running ? this.o.session.serviceWorkers.getWorkerFromVersionID(Number(running[0])) : await this.o.session.serviceWorkers.startWorkerForScope(scope)
      if (worker && !worker.isDestroyed()) worker.send('orbis-ext:event', name, args)
    } catch {
      // The extension has no service worker (or it can't start); its pages still got the event.
    }
  }

  private emitPerExtension(name: string, payload: (ext: BridgeExtension) => unknown[] | null): void {
    for (const id of this.extensionIds()) {
      const ext = this.o.getExtension(id)
      if (!ext || !this.listening.get(id)?.has(name)) continue
      const args = payload(ext)
      if (args) void this.emitTo(id, name, args)
    }
  }

  /** Whether an extension has a listener for an event (e.g. action.onClicked). */
  isListening(extensionId: string, name: string): boolean {
    return Boolean(this.listening.get(extensionId)?.has(name))
  }

  // ------------------------------------------------------------------ chrome.storage.sync
  // Electron has no chrome.storage.sync. Orbis keeps each extension's sync area on this computer, as Chrome does for a
  // profile that isn't signed in, with Chrome's quotas and change events.

  private readonly syncCache = new Map<string, Record<string, unknown>>()
  private readonly syncWrites = new Map<string, Promise<void>>()

  private async readSync(extensionId: string): Promise<Record<string, unknown>> {
    const cached = this.syncCache.get(extensionId)
    if (cached) return cached
    let data: Record<string, unknown> = {}
    try {
      const parsed: unknown = JSON.parse(await readFile(join(this.o.syncDir, `${extensionId}.json`), 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>
    } catch {
      // Nothing stored yet.
    }
    this.syncCache.set(extensionId, data)
    return data
  }

  private writeSync(extensionId: string, data: Record<string, unknown>): Promise<void> {
    this.syncCache.set(extensionId, data)
    const file = join(this.o.syncDir, `${extensionId}.json`)
    const run = (this.syncWrites.get(extensionId) ?? Promise.resolve()).then(async () => {
      await mkdir(this.o.syncDir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify(data))
      await rename(`${file}.tmp`, file)
    })
    this.syncWrites.set(extensionId, run.catch(() => undefined))
    return run
  }

  private syncChange(extensionId: string, changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void {
    if (Object.keys(changes).length) void this.emitTo(extensionId, 'storage.onChanged', [changes, 'sync'])
  }

  /** Forgets an uninstalled extension's sync data. */
  async forgetSync(extensionId: string): Promise<void> {
    this.syncCache.delete(extensionId)
    await rm(join(this.o.syncDir, `${extensionId}.json`), { force: true })
  }

  forget(extensionId: string): void {
    this.actions.delete(extensionId)
    this.menus.delete(extensionId)
    this.listening.delete(extensionId)
    this.activeTabGrants.delete(extensionId)
  }

  // ------------------------------------------------------------------ calls from extensions

  async call(extensionId: string, method: string, args: unknown[], sender?: WebContents): Promise<unknown> {
    const ext = this.o.getExtension(extensionId) ?? fail('Extension is not loaded.')
    const handler = this.handlers[method] ?? fail(`chrome.${method} is not available.`)
    return handler(ext, Array.isArray(args) ? args : [], sender)
  }

  private tabOrFail(id: unknown): ReportedTab {
    return (typeof id === 'number' ? this.tabs.get(id) : undefined) ?? fail(`No tab with id: ${String(id)}.`)
  }

  private async waitForTab(ext: BridgeExtension, id: number | null): Promise<Record<string, unknown> | undefined> {
    if (id === null) return undefined
    for (let i = 0; i < 50 && !this.tabs.has(id); i++) await new Promise((r) => setTimeout(r, 100))
    const tab = this.tabs.get(id)
    return tab ? this.tabInfo(ext, tab) : undefined
  }

  private resolveUrl(ext: BridgeExtension, url: unknown): string | undefined {
    if (url === undefined) return undefined
    if (typeof url !== 'string') fail('Invalid url.')
    const text = (url as string).trim()
    const absolute = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `chrome-extension://${ext.id}/${text.replace(/^\//, '')}`
    if (!/^(https?|chrome-extension|data):/i.test(absolute) || (absolute.startsWith('chrome-extension://') && !absolute.startsWith(`chrome-extension://${ext.id}/`))) fail(`Cannot open ${text} in a tab.`)
    return absolute
  }

  private queryTabs(ext: BridgeExtension, q: Record<string, unknown>): Record<string, unknown>[] {
    const patterns = q.url === undefined ? null : Array.isArray(q.url) ? (q.url as string[]) : [q.url as string]
    const titleRe = typeof q.title === 'string' ? new RegExp(`^${(q.title as string).split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`) : null
    const windowId = q.windowId
    return this.sortedTabs()
      .filter((t) => {
        if (typeof q.active === 'boolean' && t.active !== q.active) return false
        if (typeof q.highlighted === 'boolean' && t.active !== q.highlighted) return false
        if (typeof q.pinned === 'boolean' && t.pinned !== q.pinned) return false
        if (typeof q.audible === 'boolean' && t.audible !== q.audible) return false
        if (typeof q.muted === 'boolean' && t.muted !== q.muted) return false
        if (typeof q.status === 'string' && (t.loading ? 'loading' : 'complete') !== q.status) return false
        if (typeof q.index === 'number' && t.index !== q.index) return false
        if (typeof windowId === 'number' && windowId !== -2 && windowId !== this.windowId()) return false
        if (q.incognito === true || q.discarded === true || q.frozen === true) return false
        if (typeof q.groupId === 'number' && q.groupId !== -1) return false
        if ((q.currentWindow === false || q.lastFocusedWindow === false) && true) return false
        if (patterns && !(this.canSeeTab(ext, t) && patterns.some((p) => matchesPattern(p, t.url)))) return false
        if (titleRe && !(this.canSeeTab(ext, t) && titleRe.test(t.title))) return false
        return true
      })
      .map((t) => this.tabInfo(ext, t))
  }

  private readonly handlers: Record<string, (ext: BridgeExtension, args: unknown[], sender?: WebContents) => unknown> = {
    'events.listen': (ext, [name]) => {
      if (typeof name !== 'string') return
      let set = this.listening.get(ext.id)
      if (!set) this.listening.set(ext.id, (set = new Set()))
      set.add(name)
    },

    // tabs
    'tabs.query': (ext, [q]) => this.queryTabs(ext, (q ?? {}) as Record<string, unknown>),
    'tabs.get': (ext, [id]) => this.tabInfo(ext, this.tabOrFail(id)),
    'tabs.getCurrent': (ext, _args, sender) => {
      const tab = sender ? this.tabs.get(sender.id) ?? (sender.hostWebContents ? undefined : undefined) : undefined
      return tab ? this.tabInfo(ext, tab) : undefined
    },
    'tabs.create': async (ext, [props]) => {
      const p = (props ?? {}) as { url?: string; active?: boolean; index?: number; pinned?: boolean; selected?: boolean }
      const id = await this.o.requestWindow({ kind: 'create-tab', url: this.resolveUrl(ext, p.url), active: p.active ?? p.selected ?? true, index: p.index, pinned: p.pinned })
      return this.waitForTab(ext, id)
    },
    'tabs.update': async (ext, args) => {
      const [first, second] = args
      const tabId = typeof first === 'number' ? first : (this.activeTabId ?? fail('No active tab.'))
      const props = ((typeof first === 'number' ? second : first) ?? {}) as { url?: string; active?: boolean; highlighted?: boolean; pinned?: boolean; muted?: boolean }
      this.tabOrFail(tabId)
      await this.o.requestWindow({ kind: 'update-tab', tabId, url: this.resolveUrl(ext, props.url), active: props.active ?? props.highlighted, pinned: props.pinned, muted: props.muted })
      await new Promise((r) => setTimeout(r, 150))
      return this.waitForTab(ext, tabId)
    },
    'tabs.remove': async (_ext, [ids]) => {
      const list = (Array.isArray(ids) ? ids : [ids]).map((id) => this.tabOrFail(id).id)
      await this.o.requestWindow({ kind: 'remove-tabs', tabIds: list })
    },
    'tabs.reload': (_ext, args) => {
      const [first, second] = args
      const tabId = typeof first === 'number' ? first : (this.activeTabId ?? fail('No active tab.'))
      const props = ((typeof first === 'number' ? second : first) ?? {}) as { bypassCache?: boolean }
      this.tabOrFail(tabId)
      const contents = electronWebContents.fromId(tabId) ?? fail(`No tab with id: ${tabId}.`)
      if (props.bypassCache) contents.reloadIgnoringCache()
      else contents.reload()
    },
    'tabs.duplicate': async (ext, [id]) => {
      const tab = this.tabOrFail(id)
      const created = await this.o.requestWindow({ kind: 'create-tab', url: tab.url, active: true, index: tab.index + 1 })
      return this.waitForTab(ext, created)
    },
    'tabs.move': async (ext, [ids, props]) => {
      const index = Number((props as { index?: number })?.index)
      const list = (Array.isArray(ids) ? ids : [ids]).map((id) => this.tabOrFail(id))
      for (const [offset, tab] of list.entries()) await this.o.requestWindow({ kind: 'move-tab', tabId: tab.id, index: index < 0 ? this.tabs.size - 1 : index + offset })
      await new Promise((r) => setTimeout(r, 150))
      const moved = list.map((t) => this.tabs.get(t.id)).filter(Boolean).map((t) => this.tabInfo(ext, t!))
      return Array.isArray(ids) ? moved : moved[0]
    },
    'tabs.highlight': async (ext, [info]) => {
      const indices = (info as { tabs?: number | number[] })?.tabs
      const first = Array.isArray(indices) ? indices[0] : indices
      const tab = this.sortedTabs().find((t) => t.index === first) ?? fail('No tab at that index.')
      await this.o.requestWindow({ kind: 'update-tab', tabId: tab.id, active: true })
      return this.windowInfo(ext, true)
    },
    'tabs.goBack': (_ext, [id]) => {
      const contents = electronWebContents.fromId(this.tabOrFail(typeof id === 'number' ? id : this.activeTabId).id) ?? fail('No such tab.')
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack()
    },
    'tabs.goForward': (_ext, [id]) => {
      const contents = electronWebContents.fromId(this.tabOrFail(typeof id === 'number' ? id : this.activeTabId).id) ?? fail('No such tab.')
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward()
    },

    // windows (Orbis has one browser window)
    'windows.get': (ext, [id, info]) => {
      if (typeof id === 'number' && id !== -2 && id !== this.windowId()) fail(`No window with id: ${id}.`)
      return this.windowInfo(ext, Boolean((info as { populate?: boolean })?.populate))
    },
    'windows.getCurrent': (ext, [info]) => this.windowInfo(ext, Boolean((info as { populate?: boolean })?.populate)),
    'windows.getLastFocused': (ext, [info]) => this.windowInfo(ext, Boolean((info as { populate?: boolean })?.populate)),
    'windows.getAll': (ext, [info]) => [this.windowInfo(ext, Boolean((info as { populate?: boolean })?.populate))],
    'windows.create': async (ext, [data]) => {
      const d = (data ?? {}) as { url?: string | string[]; focused?: boolean }
      const urls = d.url === undefined ? [undefined] : Array.isArray(d.url) ? d.url : [d.url]
      for (const [i, url] of urls.entries()) await this.o.requestWindow({ kind: 'create-tab', url: this.resolveUrl(ext, url), active: i === 0 })
      if (d.focused !== false) this.o.getWindow()?.focus()
      await new Promise((r) => setTimeout(r, 200))
      return this.windowInfo(ext, true)
    },
    'windows.update': (ext, [id, info]) => {
      const win = this.o.getWindow() ?? fail('No window.')
      if (typeof id === 'number' && id !== -2 && id !== this.windowId()) fail(`No window with id: ${id}.`)
      const u = (info ?? {}) as { focused?: boolean; state?: string; drawAttention?: boolean }
      if (u.state === 'fullscreen') win.setFullScreen(true)
      else if (u.state === 'maximized') win.maximize()
      else if (u.state === 'minimized') win.minimize()
      else if (u.state === 'normal') {
        if (win.isFullScreen()) win.setFullScreen(false)
        if (win.isMaximized()) win.unmaximize()
        if (win.isMinimized()) win.restore()
      }
      if (u.focused) win.focus()
      if (u.drawAttention) win.flashFrame(true)
      return this.windowInfo(ext)
    },
    'windows.remove': () => fail('Extensions cannot close the Orbis window.'),

    // context menus
    'contextMenus.create': (ext, [props]) => {
      const item = { ...(props as MenuItem) }
      if (item.id === undefined) fail('Menu items need an id.')
      const items = this.menus.get(ext.id) ?? []
      if (items.some((i) => i.id === item.id)) fail(`Cannot create item with duplicate id ${String(item.id)}`)
      if (item.parentId !== undefined && !items.some((i) => i.id === item.parentId)) fail(`Cannot find menu item with id ${String(item.parentId)}`)
      items.push(item)
      this.menus.set(ext.id, items)
      return item.id
    },
    'contextMenus.update': (ext, [id, props]) => {
      const item = this.menus.get(ext.id)?.find((i) => i.id === id) ?? fail(`Cannot find menu item with id ${String(id)}`)
      Object.assign(item, props, { id: item.id })
    },
    'contextMenus.remove': (ext, [id]) => {
      const items = this.menus.get(ext.id) ?? []
      if (!items.some((i) => i.id === id)) fail(`Cannot find menu item with id ${String(id)}`)
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const i of items) if (i.parentId !== undefined && doomed.has(i.parentId) && !doomed.has(i.id)) doomed.add(i.id), (grew = true)
      }
      this.menus.set(ext.id, items.filter((i) => !doomed.has(i.id)))
    },
    'contextMenus.removeAll': (ext) => void this.menus.delete(ext.id),

    // action (toolbar button)
    'action.setBadgeText': (ext, [d]) => this.setAction(ext, (d as { tabId?: number })?.tabId, { badgeText: String((d as { text?: string })?.text ?? '').slice(0, 8) }),
    'action.getBadgeText': (ext, [d]) => this.actionState(ext.id, (d as { tabId?: number })?.tabId ?? null).badgeText ?? '',
    'action.setBadgeBackgroundColor': (ext, [d]) => this.setAction(ext, (d as { tabId?: number })?.tabId, { badgeBackgroundColor: toColor((d as { color?: unknown })?.color) ?? fail('Invalid color.') }),
    'action.getBadgeBackgroundColor': (ext, [d]) => this.actionState(ext.id, (d as { tabId?: number })?.tabId ?? null).badgeBackgroundColor ?? [217, 48, 37, 255],
    'action.setBadgeTextColor': (ext, [d]) => this.setAction(ext, (d as { tabId?: number })?.tabId, { badgeTextColor: toColor((d as { color?: unknown })?.color) ?? fail('Invalid color.') }),
    'action.getBadgeTextColor': (ext, [d]) => this.actionState(ext.id, (d as { tabId?: number })?.tabId ?? null).badgeTextColor ?? [255, 255, 255, 255],
    'action.setTitle': (ext, [d]) => this.setAction(ext, (d as { tabId?: number })?.tabId, { title: String((d as { title?: string })?.title ?? '') }),
    'action.getTitle': (ext, [d]) => this.actionState(ext.id, (d as { tabId?: number })?.tabId ?? null).title ?? '',
    'action.setIcon': (ext, [d]) => {
      const details = (d ?? {}) as { path?: unknown; imageData?: unknown; tabId?: number }
      const icon = details.imageData ? this.iconFromImageData(details.imageData) : this.iconFromPath(ext, details.path)
      if (!icon) fail('Could not load the icon.')
      this.setAction(ext, details.tabId, { icon })
    },
    'action.setPopup': (ext, [d]) => this.setAction(ext, (d as { tabId?: number })?.tabId, { popup: String((d as { popup?: string })?.popup ?? '') }),
    'action.getPopup': (ext, [d]) => {
      const popup = this.actionState(ext.id, (d as { tabId?: number })?.tabId ?? null).popup
      return popup ? `chrome-extension://${ext.id}/${popup.replace(/^\//, '')}` : ''
    },
    'action.enable': (ext, [tabId]) => this.setAction(ext, tabId, { enabled: true }),
    'action.disable': (ext, [tabId]) => this.setAction(ext, tabId, { enabled: false }),
    'action.isEnabled': (ext, [tabId]) => this.actionState(ext.id, typeof tabId === 'number' ? tabId : null).enabled !== false,
    'action.openPopup': async (ext) => {
      if (!this.actionState(ext.id).popup) fail('This extension has no popup.')
      await this.o.requestWindow({ kind: 'open-popup', extensionId: ext.id })
    },
    'action.getUserSettings': () => ({ isOnToolbar: true }),

    // permissions
    'permissions.getAll': (ext) => {
      const { apis, hosts } = this.permissionsOf(ext)
      return { permissions: [...apis], origins: [...new Set(hosts)] }
    },
    'permissions.contains': (ext, [req]) => {
      const r = (req ?? {}) as { permissions?: string[]; origins?: string[] }
      const { apis, hosts } = this.permissionsOf(ext)
      return (r.permissions ?? []).every((p) => apis.has(p)) && (r.origins ?? []).every((origin) => hosts.some((h) => h === origin || h === '<all_urls>' || matchesPattern(h, origin.replace(/\*/g, 'x'))))
    },
    'permissions.request': async (ext, [req]) => {
      const r = (req ?? {}) as { permissions?: string[]; origins?: string[] }
      const optional = new Set([...(ext.manifest.optional_permissions ?? []), ...(ext.manifest.optional_host_permissions ?? [])])
      const { apis, hosts } = this.permissionsOf(ext)
      const permissions = (r.permissions ?? []).filter((p) => !apis.has(p))
      const origins = (r.origins ?? []).filter((o) => !hosts.includes(o))
      for (const p of [...permissions, ...origins]) if (!optional.has(p) && !optional.has('<all_urls>')) fail(`Only permissions specified in the manifest may be requested: ${p}`)
      if (!permissions.length && !origins.length) return true
      if (!(await this.o.askPermissions(ext.id, permissions, origins))) return false
      const granted = this.o.getGranted(ext.id)
      this.o.setGranted(ext.id, { permissions: [...new Set([...granted.permissions, ...permissions])], origins: [...new Set([...granted.origins, ...origins])] })
      void this.emitTo(ext.id, 'permissions.onAdded', [{ permissions, origins }])
      return true
    },
    'permissions.remove': (ext, [req]) => {
      const r = (req ?? {}) as { permissions?: string[]; origins?: string[] }
      const granted = this.o.getGranted(ext.id)
      const permissions = (r.permissions ?? []).filter((p) => granted.permissions.includes(p))
      const origins = (r.origins ?? []).filter((o) => granted.origins.includes(o))
      if (!permissions.length && !origins.length) return false
      this.o.setGranted(ext.id, { permissions: granted.permissions.filter((p) => !permissions.includes(p)), origins: granted.origins.filter((o) => !origins.includes(o)) })
      void this.emitTo(ext.id, 'permissions.onRemoved', [{ permissions, origins }])
      return true
    },

    // storage.sync
    'storage.sync.get': async (ext, [keys]) => {
      const data = await this.readSync(ext.id)
      if (keys === null || keys === undefined) return structuredClone(data)
      if (typeof keys === 'string') return keys in data ? { [keys]: structuredClone(data[keys]) } : {}
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k): k is string => typeof k === 'string' && k in data).map((k) => [k, structuredClone(data[k])]))
      if (typeof keys === 'object') return Object.fromEntries(Object.entries(keys as Record<string, unknown>).map(([k, fallback]) => [k, k in data ? structuredClone(data[k]) : fallback]))
      return fail('Invalid value for keys.')
    },
    'storage.sync.getBytesInUse': async (ext, [keys]) => {
      const data = await this.readSync(ext.id)
      const names = keys === null || keys === undefined ? Object.keys(data) : Array.isArray(keys) ? keys.map(String) : [String(keys)]
      return names.filter((k) => k in data).reduce((sum, k) => sum + k.length + JSON.stringify(data[k]).length, 0)
    },
    'storage.sync.set': async (ext, [items]) => {
      if (!items || typeof items !== 'object' || Array.isArray(items)) fail('Invalid value for items.')
      const data = { ...(await this.readSync(ext.id)) }
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
        if (value === undefined) continue
        const json = JSON.stringify(value)
        if (key.length + json.length > SYNC_QUOTA.QUOTA_BYTES_PER_ITEM) fail('QUOTA_BYTES_PER_ITEM quota exceeded')
        if (JSON.stringify(data[key]) !== json) changes[key] = { ...(key in data ? { oldValue: data[key] } : {}), newValue: value }
        data[key] = structuredClone(value)
      }
      if (Object.keys(data).length > SYNC_QUOTA.MAX_ITEMS) fail('MAX_ITEMS quota exceeded')
      if (Object.entries(data).reduce((sum, [k, v]) => sum + k.length + JSON.stringify(v).length, 0) > SYNC_QUOTA.QUOTA_BYTES) fail('QUOTA_BYTES quota exceeded')
      await this.writeSync(ext.id, data)
      this.syncChange(ext.id, changes)
    },
    'storage.sync.remove': async (ext, [keys]) => {
      const data = { ...(await this.readSync(ext.id)) }
      const changes: Record<string, { oldValue?: unknown }> = {}
      for (const key of (Array.isArray(keys) ? keys : [keys]).map(String)) {
        if (!(key in data)) continue
        changes[key] = { oldValue: data[key] }
        delete data[key]
      }
      await this.writeSync(ext.id, data)
      this.syncChange(ext.id, changes)
    },
    'storage.sync.clear': async (ext) => {
      const data = await this.readSync(ext.id)
      const changes = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { oldValue: v }]))
      await this.writeSync(ext.id, {})
      this.syncChange(ext.id, changes)
    },

    // runtime
    'runtime.openOptionsPage': async (ext) => {
      const url = this.o.optionsUrl(ext.id) ?? fail('This extension has no options page.')
      await this.o.requestWindow({ kind: 'create-tab', url, active: true })
    }
  }
}
