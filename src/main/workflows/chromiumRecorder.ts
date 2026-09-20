import type { CdpEvent } from '../chromium/cdp.ts'
import type { CdpBrowser, CdpPage } from '../chromium/cdpPage.ts'
import { CAPTURE_SCRIPT, RecorderCore, STOP_SCRIPT } from './recorderCore.ts'
import type { RecorderBrowserState, RecordingState } from './recorderCore.ts'

/** What the recorder needs from Orbis's Chromium (the real `ChromiumControl` satisfies it). */
export interface RecorderChromium {
  browser: Pick<CdpBrowser, 'list' | 'onChange'>
  pages: { refresh(): Promise<void>; state: { open: true; tabs: { id: string; active: boolean; webContentsId?: number; url: string; title: string }[] } }
  bridge: { run<T>(expression: string): Promise<T>; watch(listener: () => void): Promise<() => void> }
}

const GROUPS = `chrome.tabGroups.query({}).then((all) => all.map((g) => ({ id: String(g.id), name: String(g.title || 'Group'), color: String(g.color || 'grey') })))`

const DOWNLOADS = `chrome.downloads.search({}).then((all) => all.map((d) => ({ id: String(d.id), filename: String(d.filename || d.url || '').split(/[\\\\/]/).pop() })))`

/**
 * Records a workflow from what the person does in Orbis's Chromium. Each tab gets the capture script while recording
 * (now, and before every new document's own scripts); its `console.debug` messages arrive as protocol events. Tabs opened,
 * closed, switched and navigated come from the browser's own tab list; downloads from Chromium's download list.
 */
export class ChromiumRecorder extends RecorderCore {
  private readonly getChromium: () => Promise<RecorderChromium>
  private readonly attached = new Map<CdpPage, () => void>()
  private stops: (() => void)[] = []
  private run = 0
  private chromium: RecorderChromium | null = null
  private groups: RecorderBrowserState['groups'] = []

  constructor(options: { getChromium(): Promise<RecorderChromium>; emit(state: RecordingState): void }) {
    super(options.emit)
    this.getChromium = options.getChromium
  }

  protected begin(): void {
    const run = ++this.run
    void this.init(run).catch(() => undefined)
  }

  private async init(run: number): Promise<void> {
    const chromium = await this.getChromium()
    if (run !== this.run || !this.state.active) return
    this.chromium = chromium
    await chromium.pages.refresh()
    this.groups = await chromium.bridge.run<RecorderBrowserState['groups']>(GROUPS).catch(() => [])
    this.lastState = this.adapt(chromium)
    for (const page of chromium.browser.list()) void this.attachPage(page)
    this.stops.push(
      chromium.browser.onChange((change) => {
        if (change.type === 'opened') void this.attachPage(change.page)
        void this.refreshState()
      })
    )
    this.stops.push(await chromium.bridge.watch(() => void this.refreshState()))
    this.downloadsBefore = new Set((await chromium.bridge.run<{ id: string }[]>(DOWNLOADS).catch(() => [])).map((d) => d.id))
    const timer = setInterval(() => void this.pollDownloads(), 700)
    this.stops.push(() => clearInterval(timer))
    if (run !== this.run || !this.state.active) this.end()
  }

  private adapt(chromium: RecorderChromium): RecorderBrowserState {
    const live = chromium.browser.list()
    return {
      open: true,
      groups: this.groups,
      tabs: chromium.pages.state.tabs.map((t) => ({ ...t, loading: live.find((p) => p.id === t.webContentsId)?.isLoading() ?? false }))
    }
  }

  private async refreshState(): Promise<void> {
    const chromium = this.chromium
    if (!chromium || !this.state.active) return
    await chromium.pages.refresh()
    const groups = await chromium.bridge.run<RecorderBrowserState['groups']>(GROUPS).catch(() => null)
    if (groups) this.groups = groups
    if (this.state.active) this.onBrowserState(this.adapt(chromium))
  }

  private async pollDownloads(): Promise<void> {
    if (!this.chromium || !this.state.active) return
    const list = await this.chromium.bridge.run<{ id: string; filename: string }[]>(DOWNLOADS).catch(() => null)
    if (list) this.onDownloads(list)
    // Tab groups have no reliable change event through the bridge, so they are polled too.
    void this.refreshState()
  }

  protected end(): void {
    this.run++
    for (const stop of this.stops.splice(0)) stop()
    for (const detach of this.attached.values()) detach()
    this.attached.clear()
    this.chromium = null
  }

  protected setCapture(on: boolean): void {
    for (const page of this.attached.keys()) void page.executeJavaScript(on ? CAPTURE_SCRIPT : STOP_SCRIPT).catch(() => undefined)
  }

  /** A tab's page, while recording. */
  private async attachPage(page: CdpPage): Promise<void> {
    if (!this.state.active || this.attached.has(page) || page.isDestroyed()) return
    const send = (method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> => page.debugger.sendCommand(method, params) as Promise<Record<string, unknown>>
    const off = page.onEvent((event: CdpEvent) => {
      if (event.method !== 'Runtime.consoleAPICalled') return
      const first = (event.params as { args?: { value?: unknown }[] }).args?.[0]?.value
      const parsed = typeof first === 'string' ? this.parseMessage(first) : null
      if (parsed) this.onPageEvent(page.id, parsed)
    })
    let scriptId: string | undefined
    this.attached.set(page, () => {
      off()
      if (page.isDestroyed()) return
      if (scriptId) void send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }).catch(() => undefined)
      void page.executeJavaScript(STOP_SCRIPT).catch(() => undefined)
    })
    try {
      await send('Runtime.enable')
      scriptId = ((await send('Page.addScriptToEvaluateOnNewDocument', { source: CAPTURE_SCRIPT })) as { identifier?: string }).identifier
      if (!this.state.active) return
      if (!this.state.paused) await page.executeJavaScript(CAPTURE_SCRIPT).catch(() => undefined)
    } catch {
      // The tab went away or is not a web page.
    }
  }
}
