import { app, ipcMain, nativeImage } from 'electron'
import type { BrowserWindow, Extension, MenuItemConstructorOptions, NativeImage, Session, WebContents } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { installChromeWebStore, installExtension, uninstallExtension, updateExtensions } from 'electron-chrome-web-store'
import type { ExtensionInstallRequest, ExtensionPermissionRequest, InstalledExtension } from '../../shared/types'
import { ExtensionBridge } from './bridge'
import type { MenuContext, ReportedTab, WindowRequest } from './bridge'
import { isHostPattern } from './matchPattern'

interface StateFile {
  disabled: string[]
  pinned: string[]
  granted: Record<string, { permissions: string[]; origins: string[] }>
}

interface OnDisk {
  id: string
  path: string
  manifest: Record<string, unknown>
}

/** Chrome's own wording for what an extension's permissions let it do. */
const WARNINGS: Record<string, string> = {
  tabs: 'Read your browsing history',
  history: 'Read and change your browsing history',
  bookmarks: 'Read and change your bookmarks',
  downloads: 'Manage your downloads',
  'downloads.open': 'Open downloaded files',
  notifications: 'Display notifications',
  clipboardRead: 'Read data you copy and paste',
  clipboardWrite: 'Modify data you copy and paste',
  declarativeNetRequest: 'Block content on any page',
  declarativeNetRequestFeedback: 'Read your browsing history',
  nativeMessaging: 'Communicate with cooperating native applications',
  geolocation: 'Detect your physical location',
  management: 'Manage your apps, extensions, and themes',
  topSites: 'Read a list of your most frequently visited websites',
  debugger: 'Access the page debugger backend',
  pageCapture: 'Read and change all your data on all websites',
  privacy: 'Change your privacy-related settings',
  proxy: 'Read and change all your data on all websites',
  tabCapture: 'Capture page content',
  desktopCapture: 'Capture content of your screen',
  webNavigation: 'Read your browsing history',
  sessions: 'Read your browsing history',
  identity: 'Know your email address',
  'identity.email': 'Know your email address',
  contentSettings: 'Change your settings that control websites’ access to features such as cookies, JavaScript, plugins, geolocation, microphone, camera etc.',
  readingList: 'Read and change entries in the reading list',
  tts: 'Read all text spoken using synthesized speech',
  ttsEngine: 'Read all text spoken using synthesized speech',
  system: 'Read information about your computer'
}

export function permissionWarnings(manifest: Record<string, unknown>): string[] {
  const permissions = (manifest.permissions as string[] | undefined) ?? []
  const hosts = [...((manifest.host_permissions as string[] | undefined) ?? []), ...permissions.filter(isHostPattern)]
  const contentHosts = ((manifest.content_scripts as { matches?: string[] }[] | undefined) ?? []).flatMap((c) => c.matches ?? [])
  const allHosts = [...hosts, ...contentHosts]
  const out: string[] = []
  if (allHosts.some((h) => h === '<all_urls>' || /^\*:\/\/\*\//.test(h) || /^https?:\/\/\*\//.test(h))) out.push('Read and change all your data on all websites')
  else {
    const names = [...new Set(allHosts.map((h) => /^[^:]+:\/\/([^/]+)/.exec(h)?.[1]?.replace(/^\*\./, '') ?? '').filter(Boolean))]
    if (names.length === 1) out.push(`Read and change your data on ${names[0]}`)
    else if (names.length > 1 && names.length <= 3) out.push(`Read and change your data on ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)
    else if (names.length > 3) out.push(`Read and change your data on ${names.length} websites`)
  }
  for (const p of permissions) if (WARNINGS[p] && !out.includes(WARNINGS[p])) out.push(WARNINGS[p])
  return out
}

/** Resolves "__MSG_name__" strings from the extension's _locales. */
async function localize(ext: OnDisk, value: unknown): Promise<string> {
  const text = typeof value === 'string' ? value : ''
  const m = /^__MSG_(.+)__$/.exec(text)
  if (!m) return text
  const locales = [app.getLocale().replace('-', '_'), app.getLocale().split('-')[0], String(ext.manifest.default_locale ?? 'en'), 'en']
  for (const locale of [...new Set(locales)]) {
    try {
      const messages = JSON.parse(await fs.readFile(join(ext.path, '_locales', locale, 'messages.json'), 'utf8')) as Record<string, { message?: string }>
      const hit = Object.entries(messages).find(([key]) => key.toLowerCase() === m[1].toLowerCase())
      if (hit?.[1].message) return hit[1].message
    } catch {
      // Try the next locale.
    }
  }
  return text
}

const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

export interface ExtensionsOptions {
  session: Session
  getWindow(): BrowserWindow | null
  /** Carries out a tab or popup request in the Orbis window; resolves with a created tab's id. */
  requestWindow(request: WindowRequest): Promise<number | null>
  /** The extensions list, toolbar state or an install/permission prompt changed. */
  send(channel: string, ...args: unknown[]): void
}

/**
 * Chrome Web Store extensions in the Orbis browser session: installing from the real Web Store (with a permissions
 * prompt), loading enabled extensions at startup, enabling, disabling, pinning, updating and removing them, and the
 * extension APIs Electron lacks (through ExtensionBridge). Private tabs use an in-memory session, where Electron can't
 * load extensions.
 */
export class ExtensionsManager {
  readonly bridge: ExtensionBridge
  private readonly o: ExtensionsOptions
  private readonly extensionsPath = join(app.getPath('userData'), 'Extensions')
  private readonly stateFile = join(app.getPath('userData'), 'extensions-state.json')
  private state: StateFile = { disabled: [], pinned: [], granted: {} }
  private installed = new Map<string, OnDisk>()
  private readonly waiting = new Map<string, (answer: boolean) => void>()
  /**
   * Extension service workers with the Orbis API handler attached, kept referenced: a ServiceWorkerMain nobody holds
   * can be garbage-collected, and its IPC handler goes with it (calls then fail with "No handler registered").
   */
  private readonly hookedWorkers = new Map<number, Electron.ServiceWorkerMain>()
  private readonly installing = new Set<string>()
  private emitTimer: NodeJS.Timeout | null = null
  private updating = false

  constructor(o: ExtensionsOptions) {
    this.o = o
    this.bridge = new ExtensionBridge({
      session: o.session,
      getWindow: o.getWindow,
      getExtension: (id) => {
        const loaded = o.session.extensions.getExtension(id)
        return loaded ? { id: loaded.id, path: loaded.path, manifest: loaded.manifest as OnDisk['manifest'] } : null
      },
      requestWindow: o.requestWindow,
      getGranted: (id) => this.state.granted[id] ?? { permissions: [], origins: [] },
      setGranted: (id, granted) => {
        this.state.granted[id] = granted
        void this.saveState()
      },
      askPermissions: (id, permissions, origins) => this.askPermissions(id, permissions, origins),
      optionsUrl: (id) => this.optionsUrl(id),
      onActionChanged: () => this.queueEmit(),
      syncDir: join(app.getPath('userData'), 'extension-sync')
    })
  }

  private async loadState(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile, 'utf8')) as Partial<StateFile>
      this.state = {
        disabled: Array.isArray(raw.disabled) ? raw.disabled.filter((x) => typeof x === 'string') : [],
        pinned: Array.isArray(raw.pinned) ? raw.pinned.filter((x) => typeof x === 'string') : [],
        granted: raw.granted && typeof raw.granted === 'object' ? raw.granted : {}
      }
    } catch {
      this.state = { disabled: [], pinned: [], granted: {} }
    }
  }

  private async saveState(): Promise<void> {
    const temp = `${this.stateFile}.tmp`
    await fs.writeFile(temp, JSON.stringify(this.state))
    await fs.rename(temp, this.stateFile)
  }

  /** Installed Web Store extensions on disk, newest version of each. */
  private async discover(): Promise<Map<string, OnDisk>> {
    const found = new Map<string, OnDisk>()
    let ids: string[] = []
    try {
      ids = (await fs.readdir(this.extensionsPath, { withFileTypes: true })).filter((d) => d.isDirectory() && /^[a-p]{32}$/.test(d.name)).map((d) => d.name)
    } catch {
      return found
    }
    for (const id of ids) {
      const dir = join(this.extensionsPath, id)
      for (const version of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!version.isDirectory()) continue
        const path = join(dir, version.name)
        try {
          const manifest = JSON.parse(await fs.readFile(join(path, 'manifest.json'), 'utf8')) as Record<string, unknown>
          if (!manifest.key) continue
          const known = found.get(id)
          if (!known || compareVersions(String(known.manifest.version), String(manifest.version)) < 0) found.set(id, { id, path, manifest })
        } catch {
          // Not an extension folder.
        }
      }
    }
    return found
  }

  async start(): Promise<void> {
    await fs.mkdir(this.extensionsPath, { recursive: true })
    await this.loadState()
    const { session } = this.o

    // The Orbis extension APIs, in extension service workers and pages (the script does nothing in web pages).
    const preload = join(__dirname, '../preload/extensionApis.js')
    session.registerPreloadScript({ type: 'service-worker', id: 'orbis-extension-apis-worker', filePath: preload })
    session.registerPreloadScript({ type: 'frame', id: 'orbis-extension-apis-frame', filePath: preload })

    session.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'starting' || runningStatus === 'running') this.hookWorker(versionId)
      if (runningStatus === 'stopped') this.hookedWorkers.delete(versionId)
    })
    ipcMain.handle('orbis-ext:call', (event, method: unknown, args: unknown) => {
      const origin = event.senderFrame?.origin ?? ''
      const id = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)?.[1]
      if (!id || typeof method !== 'string') throw new Error('Not an extension page.')
      return this.bridge.call(id, method, Array.isArray(args) ? args : [], event.sender)
    })

    session.extensions.on('extension-loaded', () => this.queueEmit())
    session.extensions.on('extension-unloaded', (_event, extension) => {
      this.queueEmit()
      // Unloaded and gone from disk: it was uninstalled (from Orbis or the Web Store page).
      setTimeout(() => {
        if (!existsSync(join(this.extensionsPath, extension.id))) void this.forget(extension.id)
      }, 500)
    })

    await installChromeWebStore({
      session,
      extensionsPath: this.extensionsPath,
      loadExtensions: false,
      autoUpdate: true,
      minimumManifestVersion: 3,
      // The package's root (its preload lives in <root>/dist); found from its exported preload path.
      modulePath: dirname(dirname(createRequire(join(app.getAppPath(), 'package.json')).resolve('electron-chrome-web-store/preload'))),
      beforeInstall: async (details) => {
        const allowed = await this.confirmInstall({ id: details.id, name: details.localizedName, icon: details.icon, manifest: details.manifest as Record<string, unknown> })
        if (!allowed) return { action: 'deny' }
        this.state.disabled = this.state.disabled.filter((x) => x !== details.id)
        void this.saveState()
        // Electron itself crashes (an access violation) when the Web Store page's own install flow completes; installing
        // the same extension directly works, with the page open or not. So once the user approves, Orbis installs it
        // directly, and the page's own attempt ends there.
        void this.installApproved(details.id, details.localizedName)
        return { action: 'deny' }
      }
    })

    this.installed = await this.discover()
    for (const ext of this.installed.values()) if (!this.state.disabled.includes(ext.id)) await this.load(ext)
    this.queueEmit()
  }

  /** Downloads, unpacks and loads an extension the user approved; tells the window how it went. */
  private async installApproved(id: string, name: string): Promise<void> {
    if (this.installing.has(id)) return
    this.installing.add(id)
    try {
      await installExtension(id, { session: this.o.session, extensionsPath: this.extensionsPath })
      const ext = (await this.discover()).get(id)
      if (!ext || !(await this.load(ext))) throw new Error(`${name} was downloaded but couldn't be turned on.`)
      this.installed.set(id, ext)
      this.o.send('extensions:installed', { id, name })
    } catch (err) {
      this.o.send('extensions:installed', { id, name, error: err instanceof Error ? err.message : String(err) })
    } finally {
      this.installing.delete(id)
      this.queueEmit()
    }
  }

  private async load(ext: OnDisk): Promise<Extension | null> {
    const { session } = this.o
    try {
      const loaded = session.extensions.getExtension(ext.id) ?? (await session.extensions.loadExtension(ext.path))
      const background = loaded.manifest.background as { service_worker?: string } | undefined
      if (background?.service_worker) await session.serviceWorkers.startWorkerForScope(`chrome-extension://${loaded.id}/`).catch(() => undefined)
      return loaded
    } catch (err) {
      console.error(`[extensions] couldn't load ${ext.id}:`, err instanceof Error ? err.message : err)
      return null
    }
  }

  /**
   * Moves the extensions to another profile's session: the same extensions, each with that profile's own extension
   * storage. Called when the user switches profile.
   */
  async useSession(session: Session): Promise<void> {
    if (session === this.o.session) return
    this.o.session = session
    this.hookedWorkers.clear()
    this.bridge.useSession(session)
    await this.start()
  }

  private hookWorker(versionId: number): void {
    // Websites run service workers in this session too; only extension workers are touched, checked by scope first.
    let scope = ''
    try {
      scope = this.o.session.serviceWorkers.getInfoFromVersionID(versionId).scope
    } catch {
      return
    }
    const id = /^chrome-extension:\/\/([a-p]{32})\/$/.exec(scope)?.[1]
    if (!id) return
    let worker: Electron.ServiceWorkerMain | undefined
    try {
      worker = this.o.session.serviceWorkers.getWorkerFromVersionID(versionId)
    } catch {
      return
    }
    if (!worker) return
    const known = this.hookedWorkers.get(versionId)
    if (known === worker && !known.isDestroyed()) return
    this.hookedWorkers.set(versionId, worker)
    worker.ipc.removeHandler('orbis-ext:call')
    worker.ipc.handle('orbis-ext:call', (_event, method: unknown, args: unknown) => {
      if (typeof method !== 'string') throw new Error('Invalid call.')
      return this.bridge.call(id, method, Array.isArray(args) ? args : [])
    })
  }

  // ------------------------------------------------------------------ prompts in the Orbis window

  private ask(channel: string, request: ExtensionInstallRequest | ExtensionPermissionRequest): Promise<boolean> {
    if (!this.o.getWindow()) return Promise.resolve(false)
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(false), 5 * 60_000)
      const finish = (answer: boolean): void => {
        clearTimeout(timer)
        this.waiting.delete(request.requestId)
        resolve(answer)
      }
      this.waiting.set(request.requestId, finish)
      this.o.send(channel, request)
    })
  }

  private confirmInstall(details: { id: string; name: string; icon: NativeImage; manifest: Record<string, unknown> }): Promise<boolean> {
    return this.ask('extensions:install-request', {
      requestId: randomUUID(),
      id: details.id,
      name: details.name,
      icon: details.icon.isEmpty() ? undefined : details.icon.resize({ width: 48 }).toDataURL(),
      warnings: permissionWarnings(details.manifest)
    })
  }

  private async askPermissions(id: string, permissions: string[], origins: string[]): Promise<boolean> {
    const loaded = this.o.session.extensions.getExtension(id)
    if (!loaded) return false
    return this.ask('extensions:permission-request', {
      requestId: randomUUID(),
      id,
      name: loaded.name,
      warnings: permissionWarnings({ permissions, host_permissions: origins }),
      permissions,
      origins
    })
  }

  answer(requestId: string, allow: boolean): void {
    this.waiting.get(requestId)?.(allow)
  }

  // ------------------------------------------------------------------ state for the window

  private queueEmit(): void {
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      void this.list().then((list) => this.o.send('extensions:changed', list))
    }, 120)
  }

  private optionsUrl(id: string): string | null {
    const ext = this.o.session.extensions.getExtension(id) ?? this.installed.get(id)
    const manifest = (ext?.manifest ?? {}) as { options_ui?: { page?: string }; options_page?: string }
    const page = manifest.options_ui?.page ?? manifest.options_page
    return page ? `chrome-extension://${id}/${page.replace(/^\//, '')}` : null
  }

  private async iconOf(ext: OnDisk): Promise<string | undefined> {
    const icons = (ext.manifest.icons ?? {}) as Record<string, string>
    const action = (ext.manifest.action ?? {}) as { default_icon?: string | Record<string, string> }
    const candidates = [...Object.entries(icons), ...(typeof action.default_icon === 'object' ? Object.entries(action.default_icon) : action.default_icon ? [['16', action.default_icon] as [string, string]] : [])]
    const best = candidates.sort((a, b) => Math.abs(Number(a[0]) - 48) - Math.abs(Number(b[0]) - 48))[0]?.[1]
    if (!best) return undefined
    const file = normalize(join(ext.path, best.replace(/^\//, '')))
    if (!file.startsWith(normalize(ext.path) + sep)) return undefined
    const image = nativeImage.createFromBuffer(await fs.readFile(file).catch(() => Buffer.alloc(0)))
    return image.isEmpty() ? undefined : image.resize({ width: 32, quality: 'best' }).toDataURL()
  }

  async list(): Promise<InstalledExtension[]> {
    this.installed = await this.discover()
    const out: InstalledExtension[] = []
    for (const ext of this.installed.values()) {
      const loaded = this.o.session.extensions.getExtension(ext.id)
      const action = this.bridge.actionState(ext.id)
      const manifestAction = (ext.manifest.action ?? null) as { default_popup?: string } | null
      out.push({
        id: ext.id,
        name: await localize(ext, ext.manifest.name),
        description: await localize(ext, ext.manifest.description),
        version: String(ext.manifest.version ?? ''),
        enabled: Boolean(loaded),
        pinned: this.state.pinned.includes(ext.id),
        icon: action.icon ?? (await this.iconOf(ext)),
        hasAction: Boolean(manifestAction),
        action: loaded
          ? {
              title: action.title ? await localize(ext, action.title) : undefined,
              badgeText: action.badgeText,
              badgeBackgroundColor: action.badgeBackgroundColor,
              badgeTextColor: action.badgeTextColor,
              hasPopup: Boolean(action.popup),
              enabled: action.enabled !== false
            }
          : undefined,
        optionsUrl: this.optionsUrl(ext.id) ?? undefined,
        homepageUrl: `https://chromewebstore.google.com/detail/${ext.id}`,
        warnings: permissionWarnings(ext.manifest)
      })
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  // ------------------------------------------------------------------ actions

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const ext = (await this.discover()).get(id)
    if (!ext) throw new Error('That extension is not installed.')
    if (enabled) {
      this.state.disabled = this.state.disabled.filter((x) => x !== id)
      await this.saveState()
      if (!(await this.load(ext))) throw new Error(`${await localize(ext, ext.manifest.name)} couldn't be turned on.`)
    } else {
      if (!this.state.disabled.includes(id)) this.state.disabled.push(id)
      await this.saveState()
      if (this.o.session.extensions.getExtension(id)) this.o.session.extensions.removeExtension(id)
      this.bridge.forget(id)
    }
    this.queueEmit()
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    this.state.pinned = pinned ? [...new Set([...this.state.pinned, id])] : this.state.pinned.filter((x) => x !== id)
    await this.saveState()
    this.queueEmit()
  }

  async remove(id: string): Promise<void> {
    await uninstallExtension(id, { session: this.o.session, extensionsPath: this.extensionsPath })
    await this.forget(id)
  }

  private async forget(id: string): Promise<void> {
    this.bridge.forget(id)
    await this.bridge.forgetSync(id)
    this.state.disabled = this.state.disabled.filter((x) => x !== id)
    this.state.pinned = this.state.pinned.filter((x) => x !== id)
    delete this.state.granted[id]
    await this.saveState()
    this.queueEmit()
  }

  /** Checks the Web Store for newer versions of the enabled extensions and installs them. */
  async update(): Promise<{ before: Record<string, string>; after: Record<string, string> }> {
    if (this.updating) throw new Error('Already checking for updates.')
    this.updating = true
    try {
      const versions = async (): Promise<Record<string, string>> => Object.fromEntries([...(await this.discover()).values()].map((e) => [e.id, String(e.manifest.version)]))
      const before = await versions()
      await updateExtensions(this.o.session)
      const after = await versions()
      this.queueEmit()
      return { before, after }
    } finally {
      this.updating = false
    }
  }

  async clickAction(id: string): Promise<{ popup: string | null }> {
    return this.bridge.clickAction(id)
  }

  updateTabs(tabs: ReportedTab[]): void {
    this.bridge.updateTabs(tabs)
  }

  menuItems(context: MenuContext): MenuItemConstructorOptions[] {
    return this.bridge.menuItems(context)
  }

  /** chrome-extension:// pages of loaded extensions may open in browser tabs and popups. */
  isExtensionPage(url: string): boolean {
    const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1]
    return Boolean(id && this.o.session.extensions.getExtension(id))
  }

  isExtensionContents(contents: WebContents): boolean {
    try {
      return contents.getURL().startsWith('chrome-extension://')
    } catch {
      return false
    }
  }
}
