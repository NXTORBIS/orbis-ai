import type { PageHandle } from '../pageHandle.ts'
import type { PageResolver } from '../browserControl/pageCapabilities.ts'
import { fail } from '../browserControl/registry.ts'
import type { CdpPage } from './cdpPage.ts'

/**
 * How the page capabilities and Orion's browser agent find "the tab to work on" in Chromium.
 *
 * The browser's own tab list is the only source: the extension reports it (tab ids, which one is active, which page each one is),
 * and this keeps the latest report, refreshed by the browser's events rather than by polling. `resolve` is what the Electron
 * build's `resolvePage` was: the command's target if it names one, otherwise the active tab. It never invents a tab and it
 * never falls back to another browser.
 */

export interface ChromiumTabState {
  id: string
  active: boolean
  windowId: number
  url: string
  title: string
  targetId?: string
}

/** The parts of the browser and the extension bridge this needs (real ones in the app, small fakes in tests). */
export interface PagesBrowser {
  list(): CdpPage[]
  find(id: number): CdpPage | undefined
  newTab(url?: string): Promise<CdpPage>
  onChange(listener: (change: { type: 'opened' | 'closed' | 'changed'; page: CdpPage }) => void): () => void
}
export interface PagesBridge {
  run<T>(expression: string): Promise<T>
  watch(listener: () => void): Promise<() => void>
}

const TABS = `(async () => {
  const tabs = await chrome.tabs.query({});
  const targets = await chrome.debugger.getTargets();
  const byTab = {};
  for (const t of targets) if (t.tabId !== undefined && t.type === 'page') byTab[t.tabId] = t.id;
  const windows = await chrome.windows.getAll();
  const focused = windows.find((w) => w.focused);
  return tabs.map((t) => ({ id: String(t.id), active: t.active && (!focused || t.windowId === focused.id), windowId: t.windowId, url: t.url || t.pendingUrl || '', title: t.title || '', targetId: byTab[t.id] }));
})()`

export class ChromiumPages {
  private tabs: ChromiumTabState[] = []
  private readonly browser: PagesBrowser
  private readonly bridge: PagesBridge
  private readonly stops: (() => void)[] = []
  private refreshing: Promise<void> | null = null
  private again = false

  constructor(browser: PagesBrowser, bridge: PagesBridge) {
    this.browser = browser
    this.bridge = bridge
  }

  /** Reads the tab list now, and from then on whenever the browser says its tabs changed. */
  async start(): Promise<void> {
    await this.refresh()
    this.stops.push(await this.bridge.watch(() => void this.refresh()))
    this.stops.push(this.browser.onChange(() => void this.refresh()))
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s()
  }

  /** Reads the tab list from the browser. Several requests while one is running become one more read. */
  refresh(): Promise<void> {
    if (this.refreshing) {
      this.again = true
      return this.refreshing
    }
    this.refreshing = (async () => {
      do {
        this.again = false
        try {
          this.tabs = await this.bridge.run<ChromiumTabState[]>(TABS)
        } catch {
          /* the browser is going away or the extension is restarting: keep the last report */
        }
      } while (this.again)
    })().finally(() => {
      this.refreshing = null
    })
    return this.refreshing
  }

  /** The tabs as the browser last reported them, in the shape the agent reads (`webContentsId` is the page's id here). */
  get state(): { open: true; tabs: { id: string; active: boolean; webContentsId?: number; url: string; title: string }[] } {
    return {
      open: true,
      tabs: this.tabs.map((t) => ({ id: t.id, active: t.active, webContentsId: this.browser.list().find((p) => p.targetId === t.targetId)?.id, url: t.url, title: t.title }))
    }
  }

  readonly resolve: PageResolver = (ctx): PageHandle => {
    let page: CdpPage | undefined
    const target = ctx.target
    if (typeof target?.webContentsId === 'number') page = this.browser.find(target.webContentsId)
    else if (target?.tabId) {
      const tab = this.tabs.find((t) => t.id === target.tabId) ?? fail('not-found', `No tab with id ${target.tabId}. Read state.snapshot for the current tabs.`, true)
      page = this.browser.list().find((p) => p.targetId === tab.targetId) ?? fail('unavailable', 'That tab has no page yet.', true)
    } else {
      const active = this.tabs.find((t) => t.active) ?? fail('unavailable', 'The browser has no active tab. Open one first.', true)
      page = this.browser.list().find((p) => p.targetId === active.targetId) ?? fail('unavailable', 'The active tab has no page open yet. Navigate it first (navigation.go).', true)
    }
    if (!page || page.isDestroyed()) fail('not-found', 'That tab closed.', true)
    return page!
  }

  /** The tab Orbis should control: the active one, or a new tab when the browser has none. */
  async getTarget(): Promise<PageHandle> {
    await this.refresh()
    const active = this.tabs.find((t) => t.active) ?? this.tabs[0]
    const existing = active && this.browser.list().find((p) => p.targetId === active.targetId)
    if (existing) return existing
    const page = await this.browser.newTab('about:blank')
    await this.refresh()
    return page
  }

  findPage(id: number): PageHandle | null {
    const page = this.browser.find(id)
    return page && !page.isDestroyed() ? page : null
  }
}
