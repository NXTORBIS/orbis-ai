import { CdpConnection, CdpError, type CdpEvent } from './cdp.ts'
import { ChromiumImage } from './png.ts'
import type { InputEvent, PageDebugger, PageHandle, PageHistory, PageImage } from '../pageHandle.ts'

/**
 * Real Chromium tabs, as the pages Orion and the Browser Control Layer already know how to drive.
 *
 * `CdpPage` implements `PageHandle`, the contract Orion was built against, over the browser's own DevTools protocol. It
 * is not a second automation system: the layer above is the same code, and it now acts on Chromium. State that the
 * contract reads synchronously (the URL, the title, whether the page is loading, whether it can go back) is kept current
 * by the browser's own events, never by polling and never invented.
 */

const MODIFIER_BITS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 }
const MODIFIER_BUTTONS: Record<string, number> = { leftbuttondown: 1, rightbuttondown: 2, middlebuttondown: 4 }

interface KeyInfo {
  key: string
  code: string
  vk: number
}
/** The names the control layer uses for keys (Electron's `keyCode` names), and what the protocol calls them. */
const NAMED_KEYS: Record<string, KeyInfo> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  Up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  Right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  PageDown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  PageUp: { key: 'PageUp', code: 'PageUp', vk: 33 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Delete: { key: 'Delete', code: 'Delete', vk: 46 },
  Home: { key: 'Home', code: 'Home', vk: 36 },
  End: { key: 'End', code: 'End', vk: 35 },
  Space: { key: ' ', code: 'Space', vk: 32 }
}

export function keyInfo(name: string): KeyInfo {
  const named = NAMED_KEYS[name]
  if (named) return named
  if (name.length === 1) {
    const upper = name.toUpperCase()
    const isLetter = /[A-Z]/.test(upper)
    const isDigit = /[0-9]/.test(name)
    return { key: name, code: isLetter ? `Key${upper}` : isDigit ? `Digit${name}` : '', vk: upper.charCodeAt(0) }
  }
  return { key: name, code: name, vk: 0 }
}

export function modifierMask(modifiers: string[] | undefined): number {
  let mask = 0
  for (const m of modifiers ?? []) mask |= MODIFIER_BITS[m.toLowerCase()] ?? 0
  return mask
}

interface TargetInfo {
  targetId: string
  type: string
  title: string
  url: string
  openerId?: string
}

/**
 * Lifecycle names that mean the page is up.
 *
 * Any one of them is enough. Which a given page reaches depends on the page -- one that keeps a connection open never
 * reaches networkIdle -- so waiting for a particular one is waiting for ever on some perfectly ordinary sites.
 */
const LOADED_ENOUGH = new Set(['load', 'DOMContentLoaded', 'networkIdle', 'networkAlmostIdle', 'InteractiveTime', 'firstMeaningfulPaint'])

/** One real Chromium tab. */
export class CdpPage implements PageHandle {
  readonly id: number
  readonly navigationHistory: PageHistory
  readonly debugger: PageDebugger
  private url = ''
  private title = ''
  private loading = false
  /**
   * The page's own top frame, learned from the first navigation it reports.
   *
   * Everything about loading is judged against this one. Without it a sub-frame -- an advert, an embedded video, a
   * tracker the blocker is about to refuse -- can say it has started loading and leave the whole tab looking busy
   * for as long as it takes that frame to give up, which for a blocked one is never.
   */
  private mainFrameId = ''
  /** The poll that asks the page whether it has finished, for the loads nothing announces. */
  private readyWatch: NodeJS.Timeout | null = null
  private destroyed = false
  private history = { entries: [] as { id: number; url?: string; title?: string }[], index: -1 }
  /** Input events are sent one after another, in the order they were given, without the caller having to wait. */
  private inputQueue: Promise<unknown> = Promise.resolve()
  private loadWaiters: (() => void)[] = []
  private readonly eventListeners = new Set<(event: CdpEvent) => void>()

  private readonly conn: CdpConnection
  readonly targetId: string
  private readonly sessionId: string
  private readonly onGone: (page: CdpPage) => void

  constructor(id: number, conn: CdpConnection, targetId: string, sessionId: string, info: TargetInfo, onGone: (page: CdpPage) => void) {
    this.conn = conn
    this.targetId = targetId
    this.sessionId = sessionId
    this.onGone = onGone
    this.id = id
    this.url = info.url
    this.title = info.title
    this.navigationHistory = {
      canGoBack: () => this.history.index > 0,
      canGoForward: () => this.history.index >= 0 && this.history.index < this.history.entries.length - 1,
      goBack: () => this.go(-1),
      goForward: () => this.go(1)
    }
    this.debugger = {
      isAttached: () => !this.destroyed,
      attach: () => undefined,
      detach: () => undefined,
      sendCommand: (method, params) => this.send(method, params)
    }
  }

  /** Starts listening to this tab. Called once, after the browser has attached to it. */
  async start(): Promise<void> {
    // First, before anything that needs the page to be running.
    //
    // A renderer attached to before it began is paused, waiting to be told to go. Nothing says so: the tab looks
    // ordinary, its title and address are right, and every command that does not need the page to run works. Only
    // the ones that do never come back -- and Page.enable is one of them, so asking this afterwards is asking from
    // behind the thing it was meant to unblock. It is harmless for a tab that was not waiting.
    await this.send('Runtime.runIfWaitingForDebugger').catch(() => undefined)
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Page.setLifecycleEventsEnabled', { enabled: true }).catch(() => undefined)
    await this.refreshHistory()
  }

  private send<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
    if (this.destroyed) return Promise.reject(new CdpError('The tab has been closed.'))
    return this.conn.send<T>(method, params, this.sessionId, timeoutMs)
  }

  /**
   * Done loading, whichever way the tab chose to say so.
   *
   * The address and title are read back from the browser's own history entry before anyone waiting is told, so what
   * they read next is what the tab really shows.
   */
  private settled(): void {
    this.stopWatching()
    this.loading = false
    void this.refreshHistory().then(() => this.flushLoadWaiters())
  }

  private stopWatching(): void {
    if (this.readyWatch) clearTimeout(this.readyWatch)
    this.readyWatch = null
  }

  /**
   * Asks the page whether it has finished, rather than waiting to be told.
   *
   * Measured in this build of Chromium: a tab being reloaded sends `frameStartedLoading` and then, for the *first*
   * reload, one lifecycle event -- and for every reload after that, nothing at all. `InteractiveTime` is reported
   * once in a page's life, `frameStoppedLoading` and `loadEventFired` never arrived at all. So there is no event that
   * can be relied on to say a page is up, and a tab that waited for one stayed "loading" for ever: every wait on it
   * timed out, and reloading a page reported failure after twenty seconds on a page that had reloaded perfectly.
   *
   * `document.readyState` is always there and always true, so this asks it. Only while a load is actually in flight,
   * four times a second, and it stops the moment the page says `complete` -- or when the tab is gone, or after long
   * enough that a page which is genuinely still loading is genuinely still loading and saying so is correct.
   */
  private watchReady(): void {
    if (this.readyWatch || this.destroyed) return
    const started = Date.now()
    const look = async (): Promise<void> => {
      this.readyWatch = null
      if (this.destroyed || !this.loading) return
      const state = await this.executeJavaScript('document.readyState').catch(() => null)
      if (state === 'complete') return this.settled()
      // Past this, a page that still says it is loading is loading, and the honest answer is to say so.
      if (Date.now() - started > 45_000) return
      this.readyWatch = setTimeout(() => void look(), 250)
    }
    this.readyWatch = setTimeout(() => void look(), 200)
  }

  /** Browser events for this tab. */
  handle(event: CdpEvent): void {
    for (const listener of this.eventListeners) listener(event)
    const p = event.params as { frameId?: string; name?: string; frame?: { id?: string; parentId?: string } } | undefined
    /*
     * Whether this event is about the tab itself rather than something embedded in it.
     *
     * Before the top frame is known, an event with no frame at all is taken as the tab's: that is how the top frame
     * becomes known in the first place.
     */
    const ours = (id: string | undefined): boolean => this.mainFrameId === '' || id === undefined || id === this.mainFrameId

    switch (event.method) {
      case 'Page.frameStartedNavigating':
      case 'Page.frameStartedLoading':
        if (!ours(p?.frameId)) break
        if (this.mainFrameId === '' && p?.frameId) this.mainFrameId = p.frameId
        this.loading = true
        this.watchReady()
        break
      case 'Page.frameStoppedLoading':
      case 'Page.loadEventFired':
        if (!ours(p?.frameId)) break
        this.settled()
        break
      /*
       * The one that actually arrives.
       *
       * This build of Chromium sends no `frameStoppedLoading` and no `loadEventFired` for a reload -- measured, not
       * assumed: the only completion signal a reloading tab emits is a lifecycle event. Nothing was listening for
       * those, so a reloaded tab stayed "loading" for ever, every wait for it timed out, and reloading a page
       * reported failure after twenty seconds on a page that had reloaded perfectly well.
       *
       * Several names are accepted because which of them a page reaches depends on the page: one that never goes
       * quiet never reaches networkIdle, and one with no script may not report InteractiveTime. Any of them means
       * the page is up and usable, which is what everything waiting on this wants to know.
       */
      case 'Page.lifecycleEvent':
        if (!ours(p?.frameId)) break
        if (p?.name && LOADED_ENOUGH.has(p.name)) this.settled()
        break
      case 'Page.frameNavigated':
        if (p?.frame && !p.frame.parentId && p.frame.id) this.mainFrameId = p.frame.id
        void this.refreshHistory()
        break
      case 'Page.navigatedWithinDocument':
        void this.refreshHistory()
        break
      case 'Inspector.detached':
      case 'Inspector.targetCrashed':
        break
    }
    void p
  }

  /** Every protocol event this tab sends, for code that needs more than the page contract. */
  onEvent(listener: (event: CdpEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /** Target metadata (URL and title) as the browser reports it. */
  updateInfo(info: TargetInfo): void {
    this.url = info.url
    this.title = info.title
  }

  markGone(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stopWatching()
    this.loading = false
    this.flushLoadWaiters()
    this.onGone(this)
  }

  private flushLoadWaiters(): void {
    const waiters = this.loadWaiters
    this.loadWaiters = []
    for (const w of waiters) w()
  }

  private async refreshHistory(): Promise<void> {
    if (this.destroyed) return
    try {
      const h = await this.send<{ currentIndex: number; entries: { id: number; url?: string; title?: string }[] }>('Page.getNavigationHistory')
      this.history = { entries: h.entries, index: h.currentIndex }
      const current = h.entries[h.currentIndex]
      if (current?.url) this.url = current.url
      if (current?.title) this.title = current.title
    } catch {
      /* the tab went away or is not ready: keep what was known */
    }
  }

  private go(delta: number): void {
    const target = this.history.entries[this.history.index + delta]
    if (target) void this.send('Page.navigateToHistoryEntry', { entryId: target.id }).catch(() => undefined)
  }

  isDestroyed(): boolean {
    return this.destroyed
  }
  getURL(): string {
    return this.url
  }
  getTitle(): string {
    return this.title
  }
  /**
   * Input coordinates in the protocol are already the page's own CSS pixels, so no browser zoom has to be applied to
   * them: the factor Orion multiplies by is 1.
   */
  getZoomFactor(): number {
    return 1
  }
  isLoading(): boolean {
    return this.loading
  }

  async executeJavaScript(code: string, userGesture = false, timeoutMs?: number): Promise<unknown> {
    const result = await this.send<{ result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      {
        expression: code,
        awaitPromise: true,
        returnByValue: true,
        userGesture,
        allowUnsafeEvalBlockedByCSP: true
      },
      // Only when the caller says so; everything else keeps the default, which is right for a script that is not a wait.
      timeoutMs
    )
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result?.value
  }

  async capturePage(): Promise<PageImage> {
    const shot = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }, 15_000)
    return ChromiumImage.fromPng(Buffer.from(shot.data, 'base64'))
  }

  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }

  /**
   * Whether this page has been told to behave as though it were focused.
   *
   * Chromium gives keyboard input to the focused widget, and a tab that is not the one in front -- or is in a window
   * something else is covering -- has no focused widget to give it to. The key is then dropped, silently: the page reports
   * `document.hasFocus()` as true, `document.activeElement` is the field, and nothing at all happens. It is the same
   * reason a background tab cannot steal your typing, and it is correct; it just makes driving a tab you are not looking
   * at impossible.
   *
   * `Emulation.setFocusEmulationEnabled` is the way out: the renderer treats itself as focused for input purposes without
   * anything being raised or taken from the person. Done once, on the first real input, so a page nothing drives is left
   * exactly as it was.
   */
  private focusEmulated = false

  sendInputEvent(event: InputEvent): void {
    const command = this.inputCommand(event)
    if (!command) return
    if (!this.focusEmulated) {
      this.focusEmulated = true
      this.inputQueue = this.inputQueue.then(() =>
        // Not fatal if it is unavailable: input still works on a tab that is in front, which is the common case.
        this.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined)
      )
    }
    this.inputQueue = this.inputQueue.then(() => this.send(command.method, command.params).catch(() => undefined))
  }

  /** Waits for the queued input to be delivered. See `flushInput` on PageHandle for why anything needs this. */
  async flushInput(): Promise<void> {
    await this.inputQueue
  }

  private inputCommand(e: InputEvent): { method: string; params: Record<string, unknown> } | null {
    const modifiers = modifierMask(e.modifiers)
    const buttons = (e.modifiers ?? []).reduce((n, m) => n | (MODIFIER_BUTTONS[m.toLowerCase()] ?? 0), 0)
    switch (e.type) {
      case 'mouseMove':
        return { method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved', x: e.x ?? 0, y: e.y ?? 0, modifiers, buttons } }
      case 'mouseDown':
      case 'mouseUp':
        return { method: 'Input.dispatchMouseEvent', params: { type: e.type === 'mouseDown' ? 'mousePressed' : 'mouseReleased', x: e.x ?? 0, y: e.y ?? 0, button: e.button ?? 'left', clickCount: e.clickCount ?? 1, modifiers } }
      case 'mouseWheel':
        return { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: e.x ?? 0, y: e.y ?? 0, deltaX: e.deltaX ?? 0, deltaY: e.deltaY ?? 0, modifiers } }
      case 'keyDown':
      case 'keyUp': {
        const k = keyInfo(String(e.keyCode ?? ''))
        return { method: 'Input.dispatchKeyEvent', params: { type: e.type === 'keyDown' ? 'rawKeyDown' : 'keyUp', key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers } }
      }
      case 'char': {
        const text = String(e.keyCode ?? '')
        return { method: 'Input.dispatchKeyEvent', params: { type: 'char', text, unmodifiedText: text, modifiers } }
      }
      default:
        return null
    }
  }

  /** The browser's own paste command, so the page sees a real paste (its handlers and the clipboard permission rules apply). */
  paste(): void {
    this.inputQueue = this.inputQueue.then(() =>
      this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86, modifiers: 2, commands: ['paste'] }).catch(() => undefined)
    )
  }

  async loadURL(url: string): Promise<void> {
    const done = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 30_000)
      this.loadWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    const nav = await this.send<{ errorText?: string }>('Page.navigate', { url })
    if (nav.errorText) throw new Error(nav.errorText)
    await done
  }

  reload(): void {
    void this.send('Page.reload').catch(() => undefined)
  }

  /** Brings this tab to the front so the person (and screenshots) see it. */
  async activate(): Promise<void> {
    await this.conn.send('Target.activateTarget', { targetId: this.targetId })
  }
}

/** The Chromium browser: its tabs, opened and closed for real. */
export class CdpBrowser {
  private readonly pages = new Map<string, CdpPage>()
  private readonly bySession = new Map<string, CdpPage>()
  private nextPageId = 1
  private readonly infos = new Map<string, TargetInfo>()
  private readonly listeners = new Set<(change: { type: 'opened' | 'closed' | 'changed'; page: CdpPage }) => void>()

  readonly conn: CdpConnection

  private constructor(conn: CdpConnection) {
    this.conn = conn
    conn.on('event', (event: CdpEvent) => void this.onEvent(event))
  }

  /** Connects to a Chromium started with `--remote-debugging-port`. Only this computer's loopback address is used. */
  static async connect(port: number): Promise<CdpBrowser> {
    const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string }
    return CdpBrowser.fromConnection(await CdpConnection.open(version.webSocketDebuggerUrl))
  }

  /** Starts following the browser on a connection that is already open (a debugging port's, or the pipe of a browser Orbis started). */
  static async fromConnection(conn: CdpConnection): Promise<CdpBrowser> {
    const browser = new CdpBrowser(conn)
    await browser.conn.send('Target.setDiscoverTargets', { discover: true })
    const { targetInfos } = await browser.conn.send<{ targetInfos: TargetInfo[] }>('Target.getTargets')
    for (const info of targetInfos) if (info.type === 'page') await browser.adopt(info)
    return browser
  }

  onChange(listener: (change: { type: 'opened' | 'closed' | 'changed'; page: CdpPage }) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  list(): CdpPage[] {
    return [...this.pages.values()]
  }

  find(id: number): CdpPage | undefined {
    return this.list().find((p) => p.id === id)
  }

  private async adopt(info: TargetInfo): Promise<CdpPage | undefined> {
    const existing = this.pages.get(info.targetId)
    if (existing) return existing
    // Only real web pages and Orbis's own pages are tabs; the browser's UI surfaces are not.
    const { sessionId } = await this.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: info.targetId, flatten: true })
    const page = new CdpPage(this.nextPageId++, this.conn, info.targetId, sessionId, info, (gone) => {
      this.pages.delete(gone.targetId)
      this.bySession.delete(sessionId)
      for (const l of this.listeners) l({ type: 'closed', page: gone })
    })
    this.pages.set(info.targetId, page)
    this.bySession.set(sessionId, page)
    // Bounded, and never fatal. Adopting a tab is not worth the whole browser: one page that will not answer
    // used to leave the control layer waiting for it forever, so Orbis came up with no browser at all and said
    // so about every request. A tab that does not start is simply a tab that is listed and not yet listening.
    await Promise.race([page.start(), new Promise((r) => setTimeout(r, 10_000))]).catch(() => undefined)
    for (const l of this.listeners) l({ type: 'opened', page })
    return page
  }

  private async onEvent(event: CdpEvent): Promise<void> {
    const p = event.params as { targetInfo?: TargetInfo; targetId?: string; sessionId?: string }
    if (event.sessionId) {
      this.bySession.get(event.sessionId)?.handle(event)
      return
    }
    if (event.method === 'Target.targetCreated' && p.targetInfo?.type === 'page') {
      this.infos.set(p.targetInfo.targetId, p.targetInfo)
      await this.adopt(p.targetInfo).catch(() => undefined)
    } else if (event.method === 'Target.targetInfoChanged' && p.targetInfo) {
      this.infos.set(p.targetInfo.targetId, p.targetInfo)
      const page = this.pages.get(p.targetInfo.targetId)
      if (page) {
        page.updateInfo(p.targetInfo)
        for (const l of this.listeners) l({ type: 'changed', page })
      }
    } else if (event.method === 'Target.targetDestroyed' && p.targetId) {
      this.pages.get(p.targetId)?.markGone()
    } else if (event.method === 'Target.detachedFromTarget' && p.sessionId) {
      this.bySession.get(p.sessionId)?.markGone()
    }
  }

  /** A new real tab. */
  async newTab(url = 'about:blank'): Promise<CdpPage> {
    const { targetId } = await this.conn.send<{ targetId: string }>('Target.createTarget', { url })
    for (let i = 0; i < 50; i++) {
      const page = this.pages.get(targetId)
      if (page) return page
      await new Promise((r) => setTimeout(r, 40))
    }
    throw new CdpError('The new tab did not appear.')
  }

  async closeTab(page: CdpPage): Promise<void> {
    await this.conn.send('Target.closeTarget', { targetId: page.targetId })
  }

  close(): void {
    this.conn.close()
  }
}
