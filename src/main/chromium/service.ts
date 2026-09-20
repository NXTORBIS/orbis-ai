import { BrowserControl } from '../browserControl/registry.ts'
import type { BrowserControlOptions } from '../browserControl/registry.ts'
import { registerPageCapabilities } from '../browserControl/pageCapabilities.ts'
import { registerCaptchaCapabilities } from '../browserControl/captchaCapabilities.ts'
import type { PageHandle } from '../pageHandle.ts'
import { CdpBrowser } from './cdpPage.ts'
import type { CdpConnection } from './cdp.ts'
import { launchChromium } from './launch.ts'
import type { LaunchOptions } from './launch.ts'
import { registerChromiumCapabilities } from './chromiumCapabilities.ts'
import { registerMoreChromiumCapabilities } from './chromiumCapabilities2.ts'
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
  /** Called when the browser goes away (closed by the person, or crashed). */
  onClosed?: () => void
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
  const deps = { control, browser, bridge }
  registerChromiumCapabilities(deps)
  registerMoreChromiumCapabilities({ ...deps, saveDir: o.saveDir, selfExtensionId: o.extensionId })
  registerPageCapabilities(control, pages.resolve)
  registerCaptchaCapabilities(control, pages.resolve)

  return {
    control,
    browser,
    pages,
    bridge,
    agent: {
      getTarget: () => pages.getTarget(),
      findPage: (id) => pages.findPage(id),
      get windowControl() {
        return { state: pages.state }
      }
    },
    stop: () => {
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
    const service = await startChromiumControl({ ...o, connection: launched.connection, onClosed: undefined })
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
