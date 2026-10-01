import { BrowserControl, fail } from '../browserControl/registry.ts'
import type { BrowserControlOptions } from '../browserControl/registry.ts'
import { registerPageCapabilities } from '../browserControl/pageCapabilities.ts'
import { registerMediaCapabilities } from '../browserControl/mediaCapabilities.ts'
import { registerCaptchaCapabilities } from '../browserControl/captchaCapabilities.ts'
import type { PageHandle } from '../pageHandle.ts'
import { CdpBrowser } from './cdpPage.ts'
import type { CdpConnection } from './cdp.ts'
import { launchChromium } from './launch.ts'
import type { LaunchOptions } from './launch.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { registerMoreChromiumCapabilities } from './chromiumCapabilities2.ts'
import { registerFindInPage, registerSitePermissionCapabilities } from './chromiumCapabilities3.ts'
import { registerBrowserToolCapabilities } from './chromiumCapabilities4.ts'
import { BrowserUi } from './browserUi.ts'
import { registerBrowserUiCapabilities } from './chromiumCapabilities5.ts'
import { ChromiumPages } from './chromiumPages.ts'
import { ExtensionBridge } from './extensionBridge.ts'

/**
 * The Browser Control Layer, running on real Chromium: one place that connects to the browser, follows its tabs by its own
 * events, and registers every capability (tabs, windows, navigation, downloads, history, bookmarks, cookies, groups, zoom, print,
 * extensions, reading list, and the page and CAPTCHA capabilities) on the layer Orion, workflows and automations already use.
 *
 * There is one control layer here, not a second one: this fills the same `BrowserControl` with Chromium's implementations. If the
 * browser is not there, starting fails with that reason. Nothing falls back to another browser.
 */

export interface ChromiumControlOptions {
  /** The browser's remote-debugging port (loopback only), or an open connection to it (a pipe, for a browser Orbis started). */
  port?: number
  connection?: CdpConnection
  /** The Orbis extension's id (fixed by its manifest key). */
  extensionId: string
  /** Where saved pages and PDFs go (default: the Downloads folder). */
  saveDir?: string
  /** Use an existing control layer (the app's), or one is made. */
  control?: BrowserControl
  controlOptions?: BrowserControlOptions
  /** How long to wait for the browser to be reachable while it starts. */
  waitMs?: number
  /** The system clipboard, for checking what a page copied (the app passes Electron's). */
  clipboard?: { readText(): Promise<string> | string; hasImage(): Promise<boolean> | boolean }
  /** The browser process id Orbis launched: the address-bar and developer-tools capabilities only ever act on that process's windows. */
  pid?: number
  /** Called when the browser goes away (closed by the person, or crashed). */
  onClosed?: () => void
  /**
   * Tab Lock.
   *
   * `redactTabs` is what stops a locked tab's address appearing in a listing; `sync` is how the security layer follows the
   * real browser. Both are optional: without them the layer behaves exactly as it did before tab locking existed, which is
   * what makes this safe to leave out of a test.
   */
  tabLock?: {
    redactTabs<T extends { id: string; url: string; title: string }>(rows: T[]): (T & { locked: boolean })[]
    sync(rows: { id: string; url: string; title: string; active: boolean }[]): void
    restore(rows: { id: string; url: string; title: string }[]): Promise<number> | void
  }
}

export interface ChromiumControl {
  control: BrowserControl
  browser: CdpBrowser
  pages: ChromiumPages
  bridge: ExtensionBridge
  /** What Orion's browser agent needs: the tab to work on, and following the person when they switch tabs. */
  agent: {
    getTarget(): Promise<PageHandle>
    findPage(id: number): PageHandle | null
    windowControl: { state: ChromiumPages['state'] }
  }
  stop(): void
}

export async function startChromiumControl(o: ChromiumControlOptions): Promise<ChromiumControl> {
  const end = Date.now() + (o.waitMs ?? 30_000)
  let browser: CdpBrowser | undefined
  let last: unknown
  if (o.connection) browser = await CdpBrowser.fromConnection(o.connection)
  else if (o.port === undefined) throw new Error('Give a debugging port or an open connection to the browser.')
  while (!browser) {
    try {
      browser = await CdpBrowser.connect(o.port!)
    } catch (err) {
      last = err
      if (Date.now() > end) throw new Error(`Orbis's Chromium is not reachable on port ${o.port}: ${err instanceof Error ? err.message : String(last)}`)
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  browser.conn.on('close', () => o.onClosed?.())

  const bridge = new ExtensionBridge(browser, o.extensionId)
  const pages = new ChromiumPages(browser, bridge)
  await pages.start()

  const control = o.control ?? new BrowserControl(o.controlOptions)
  const deps = { control, browser, bridge, redactTabs: o.tabLock?.redactTabs }
  registerChromiumCapabilities(deps)
  registerMoreChromiumCapabilities({ ...deps, saveDir: o.saveDir, selfExtensionId: o.extensionId })
  registerSitePermissionCapabilities(deps)
  registerFindInPage({ ...deps, activePage: async () => (await pages.getTarget()) as unknown as import('./cdpPage.ts').CdpPage })
  registerBrowserToolCapabilities({
    ...deps,
    activePage: async () => (await pages.getTarget()) as unknown as import('./cdpPage.ts').CdpPage,
    readClipboardText: async () => (o.clipboard ? o.clipboard.readText() : ''),
    hasClipboardImage: async () => (o.clipboard ? o.clipboard.hasImage() : false)
  })
  const ui = o.pid !== undefined && BrowserUi.supported() ? new BrowserUi(o.pid) : undefined
  registerBrowserUiCapabilities({ ...deps, activePage: async () => (await pages.getTarget()) as unknown as import('./cdpPage.ts').CdpPage, pid: o.pid, ui })
  registerPageCapabilities(control, pages.resolve)
  // What is playing, and waiting for it to change. The one thing that makes "when this video ends" a real condition
  // rather than a guess at how long a video is.
  registerMediaCapabilities(control, { tab: (ctx) => pages.resolve(ctx), fail })
  registerCaptchaCapabilities(control, pages.resolve)

  /**
   * Tab Lock follows the browser by the browser's own events.
   *
   * `bridge.watch` is the same signal the tab list already uses -- one "something changed" from the extension, on switch,
   * open, close and navigation. The security layer reads the rows and works out which of those happened. Nothing polls,
   * so a browser sitting still costs nothing.
   */
  let unwatch: (() => void) | undefined
  if (o.tabLock) {
    const lock = o.tabLock
    const rows = async (): Promise<{ id: string; url: string; title: string; active: boolean }[]> => {
      const state = pages.state
      return (state?.tabs ?? []).map((t) => ({ id: String(t.id), url: t.url, title: t.title, active: t.active }))
    }
    // The tabs as they are at startup, so anything that was locked when Orbis closed comes back locked before the person
    // can reach it.
    await Promise.resolve(lock.restore(await rows())).catch(() => 0)
    unwatch = await bridge.watch(() => void rows().then((r) => lock.sync(r)).catch(() => {}))
    lock.sync(await rows())
  }

  return {
    control,
    browser,
    pages,
    bridge,
    agent: {
      getTarget: () => pages.getTarget(),
      findPage: (id) => pages.findPage(id),
      // A getter, so the agent reads the tabs as they are when it looks, not as they were when it started.
      windowControl: {
        get state() {
          return pages.state
        }
      }
    },
    stop: () => {
      unwatch?.()
      ui?.close()
      pages.stop()
      browser!.close()
    }
  }
}

export interface LaunchOrbisChromiumOptions extends Omit<ChromiumControlOptions, 'port' | 'connection' | 'onClosed'>, LaunchOptions {
  onClosed?: () => void
}

/**
 * Starts the Orbis browser and the control layer on it, as the app does: the browser is a child process reached over a pipe. When
 * the browser exits, `onClosed` is called; `stop()` closes it.
 */
export async function launchOrbisChromium(o: LaunchOrbisChromiumOptions): Promise<ChromiumControl & { process: import('node:child_process').ChildProcess; exited: Promise<number | null> }> {
  const launched = launchChromium(o)
  try {
    const service = await startChromiumControl({ ...o, connection: launched.connection, onClosed: undefined, pid: launched.process.pid })
    void launched.exited.then(() => o.onClosed?.())
    return {
      ...service,
      process: launched.process,
      exited: launched.exited,
      stop: () => {
        service.stop()
        launched.process.kill()
      }
    }
  } catch (err) {
    launched.process.kill()
    throw err
  }
}
