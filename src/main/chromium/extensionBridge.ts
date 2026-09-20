import type { CdpBrowser } from './cdpPage.ts'
import { CdpError } from './cdp.ts'

/**
 * Reaches Chromium's own browser APIs (tabs, windows, downloads, history, bookmarks, cookies, browsing data) through the
 * Orbis extension's service worker. Those APIs are Chromium's real ones, running with the permissions the extension
 * declares in its manifest; nothing here re-implements a browser system. The bridge only evaluates a script inside the
 * extension and hands the answer back. Attaching to the worker also keeps it from being put to sleep while Orbis works.
 */
export class ExtensionBridge {
  private sessionId: string | undefined
  private readonly browser: CdpBrowser
  private readonly extensionId: string

  constructor(browser: CdpBrowser, extensionId: string) {
    this.browser = browser
    this.extensionId = extensionId
  }

  private async attach(): Promise<string> {
    // The extension's worker may still be starting when the browser has only just opened: give it a few seconds.
    let worker: { targetId: string; type: string; url: string } | undefined
    for (let i = 0; i < 40 && !worker; i++) {
      const { targetInfos } = await this.browser.conn.send<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets')
      worker = targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith(`chrome-extension://${this.extensionId}/`))
      if (!worker) await new Promise((r) => setTimeout(r, 250))
    }
    if (!worker) throw new CdpError('The Orbis extension is not running in this browser.')
    const { sessionId } = await this.browser.conn.send<{ sessionId: string }>('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
    await this.browser.conn.send('Runtime.enable', {}, sessionId)
    // A worker that has only just started has no `chrome` object yet: wait until the extension's APIs are really there.
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      const probe = await this.browser.conn.send<{ result?: { value?: unknown } }>('Runtime.evaluate', { expression: "typeof chrome !== 'undefined' && !!chrome.tabs && !!chrome.downloads", returnByValue: true }, sessionId)
      ready = probe.result?.value === true
      if (!ready) await new Promise((r) => setTimeout(r, 250))
    }
    if (!ready) throw new CdpError('The Orbis extension did not finish starting.')
    this.sessionId = sessionId
    return sessionId
  }

  /** Runs an expression in the extension (it may `await` and use `chrome.*`) and returns its JSON-able value. */
  async run<T = unknown>(expression: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const session = this.sessionId ?? (await this.attach())
        const result = await this.browser.conn.send<{ result?: { value?: unknown }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true },
          session
        )
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
        return result.result?.value as T
      } catch (err) {
        // The worker restarted, so the session is gone: attach to the new one, once.
        if (attempt === 0 && err instanceof CdpError) {
          this.sessionId = undefined
          continue
        }
        throw err
      }
    }
  }
}
