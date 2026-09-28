/**
 * The page, as Orion is allowed to know it.
 *
 * Orion drives a real browser: it reads pages, clicks things, types, navigates and takes screenshots, and what it
 * does must really happen. But it should not know *whose* browser. Today a page is an Electron `WebContents`; in the
 * Chromium browser it is a `content::WebContents` reached over Mojo. Orion should not be rewritten for that, and this
 * is what makes sure it is not.
 *
 * This interface is a contract. It is exactly what Orion's agent loop uses today — no more, so nothing new is smuggled
 * in, and no less, so nothing it relies on is quietly dropped. When the browser underneath changes, one implementation
 * of this is written and Orion is untouched.
 *
 * Every method acts on the real page and returns what really happened. Nothing here may pretend.
 */

/** A picture of a page. Orion shrinks it and reads its pixels to tell whether a page has really changed. */
export interface PageImage {
  toPNG(): Buffer
  toDataURL(): string
  toBitmap(): Buffer
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width?: number; height?: number }): PageImage
}

export interface InputEvent {
  type: string
  x?: number
  y?: number
  button?: 'left' | 'middle' | 'right'
  clickCount?: number
  keyCode?: string
  modifiers?: string[]
  deltaX?: number
  deltaY?: number
  [key: string]: unknown
}

/**
 * The page's own inspector connection. Orion reads the accessibility tree through it — which is how it understands a
 * page by meaning rather than by guessing at pixels. Chromium exposes the same protocol, so this survives the move.
 */
export interface PageDebugger {
  isAttached(): boolean
  attach(protocolVersion?: string): void
  detach(): void
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>
}

/** Where a page has been, and where it can go. */
export interface PageHistory {
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
}

/**
 * One page Orion can work with. The names follow what Orion already calls, so that adopting this changes the
 * implementation underneath rather than the agent above it.
 */
export interface PageHandle {
  /** Identifies the page, so a step can tell whether it is still working on the same one. */
  readonly id: number
  /** The page has gone: the tab was closed, or the window with it. Every step checks this before acting. */
  isDestroyed(): boolean
  getURL(): string
  getTitle(): string
  getZoomFactor(): number
  /** Whether the page is still arriving; waiting for it to settle depends on this. */
  isLoading(): boolean

  /** Runs a script in the page and gives back what it evaluated to. How Orion reads and inspects a page. */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
  /** A picture of the page, for when Orion has to look rather than read. */
  capturePage(): Promise<PageImage>

  /** Types text as a person would, so a page's own handlers see it happen. */
  insertText(text: string): Promise<void>
  /** Clicks, key presses, scrolling: real input, delivered the way the platform delivers it. */
  sendInputEvent(event: InputEvent): void
  /**
   * Waits until the input sent so far has actually been delivered.
   *
   * `sendInputEvent` returns before the event reaches the page -- it has to, because input has to keep its order and a
   * click is three events. That leaves a gap in which the page has not yet seen the key, and anything that looks at the
   * page in that gap sees the state before it. Which is how "typed and pressed Enter" came to be reported about a form
   * that had not been submitted: the key was still in the queue, the page was read, nothing had changed, and the agent
   * concluded the action had no effect.
   *
   * Optional, because a platform whose input is synchronous has nothing to wait for.
   */
  flushInput?(): Promise<void>

  /** Pastes what is on the clipboard into the focused field, as the browser's own paste does. */
  paste(): void
  loadURL(url: string): Promise<void>
  reload(): void
  readonly navigationHistory: PageHistory
  readonly debugger: PageDebugger
}

/**
 * Wraps whatever the browser gives us as a page. Electron's `WebContents` already answers to these names, so this is
 * a cast today and a real adapter once Chromium is underneath — which is the point: the change lands here, not in
 * Orion.
 */
export const asPageHandle = (page: unknown): PageHandle => page as PageHandle

/** What a page can be asked for, named, so a test can say what Orion did rather than only that it finished. */
export const PAGE_HANDLE_METHODS = [
  'isDestroyed',
  'getURL',
  'getZoomFactor',
  'executeJavaScript',
  'capturePage',
  'insertText',
  'sendInputEvent',
  'loadURL',
  'reload'
] as const
