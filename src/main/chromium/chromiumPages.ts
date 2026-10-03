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

/**
 * What changed between two readings of the tab list.
 *
 * The browser reports its whole tab list whenever anything about it changes, so the only way to know a tab was opened
 * rather than renamed is to compare the new reading against the last one. Pure, so the awkward cases -- a tab that
 * navigates and becomes active in the same reading, the very first reading, a tab whose title changes and nothing
 * else -- can be written down and checked rather than guessed at.
 *
 * Deliberately quiet about small things. A title arriving a moment after the page did is not an event anybody wants;
 * an address changing is.
 */
export interface TabChange {
  readonly name: 'tab.created' | 'tab.closed' | 'tab.activated' | 'tab.navigated'
  readonly tabId: string
  readonly url: string
  readonly title: string
  readonly windowId: number
}

export function tabChanges(before: readonly ChromiumTabState[], after: readonly ChromiumTabState[]): TabChange[] {
  // The first reading is the state of the world, not a burst of things that just happened.
  if (before.length === 0) return []
  const was = new Map(before.map((t) => [t.id, t]))
  const now = new Map(after.map((t) => [t.id, t]))
  const out: TabChange[] = []
  const of = (t: ChromiumTabState, name: TabChange['name']): TabChange => ({ name, tabId: t.id, url: t.url, title: t.title, windowId: t.windowId })

  for (const tab of after) {
    const old = was.get(tab.id)
    if (!old) out.push(of(tab, 'tab.created'))
    // A reload is not a navigation: the address is what changed or it did not.
    else if (old.url !== tab.url && tab.url !== '') out.push(of(tab, 'tab.navigated'))
    /*
     * Which tab is in front, including a new one that opened there.
     *
     * A tab can be opened in front or behind, so being created does not say which. Leaving the activation out for a
     * new tab left anything tracking "the tab in front" still pointing at the one before it.
     */
    if (!old?.active && tab.active) out.push(of(tab, 'tab.activated'))
  }
  for (const tab of before) if (!now.has(tab.id)) out.push(of(tab, 'tab.closed'))
  return out
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
  /** Told what changed between readings, so the rest of Orbis hears about tabs without anybody polling for them. */
  private announce: ((changes: readonly TabChange[]) => void) | null = null

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

  /**
   * Who to tell when tabs change.
   *
   * Set rather than passed to the constructor because this is built deep inside starting the browser, long before the
   * things that want to listen exist. A listener that throws must not stop the tab list being kept up to date, so
   * anything it throws is stepped over here as well as on the bus.
   */
  onChanges(listener: (changes: readonly TabChange[]) => void): void {
    this.announce = listener
  }

  stop(): void {
    this.announce = null
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
          const fresh = await this.bridge.run<ChromiumTabState[]>(TABS)
          const changes = tabChanges(this.tabs, fresh)
          this.tabs = fresh
          if (changes.length && this.announce) {
            try {
              this.announce(changes)
            } catch {
              /* a listener's fault is not the tab list's problem */
            }
          }
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
