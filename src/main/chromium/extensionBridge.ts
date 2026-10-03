import type { CdpBrowser } from './cdpPage.ts'
import { CdpError } from './cdp.ts'

/**
 * Reaches Chromium's own browser APIs (tabs, windows, downloads, history, bookmarks, cookies, browsing data) through the
 * Orbis extension's service worker. Those APIs are Chromium's real ones, running with the permissions the extension
 * declares in its manifest; nothing here re-implements a browser system. The bridge only evaluates a script inside the
 * extension and hands the answer back. Attaching to the worker also keeps it from being put to sleep while Orbis works.
 */
/** One download, as Chromium reports it when it stops being in progress. */
export interface DownloadChange {
  id: string
  /** Chromium's own word for it: `complete` or `interrupted`. Nothing here decides which. */
  state: string
  filename: string
  path: string
  bytes: number
  error: string
}

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

  private readonly listeners = new Set<() => void>()
  private watching = false
  private readonly downloadListeners = new Set<(one: DownloadChange) => void>()
  private watchingDownloads = false

  /**
   * Calls `listener` whenever the browser's tabs or windows change (opened, closed, moved, switched, navigated), so the
   * Orbis side follows the real browser by its own events instead of asking over and over. The extension reports each
   * change through a binding on the connection; nothing is polled.
   */
  async watch(listener: () => void): Promise<() => void> {
    this.listeners.add(listener)
    if (!this.watching) {
      this.watching = true
      this.browser.conn.on('event', (event: { method: string; params: { name?: string }; sessionId?: string }) => {
        if (event.method === 'Runtime.bindingCalled' && event.params.name === 'orbisTabsChanged') for (const l of this.listeners) l()
      })
      await this.run('1')
      await this.browser.conn.send('Runtime.addBinding', { name: 'orbisTabsChanged' }, this.sessionId)
      await this.run(`(() => {
        if (globalThis.__orbisWatching) return true
        globalThis.__orbisWatching = true
        const changed = () => globalThis.orbisTabsChanged('x')
        for (const e of ['onActivated', 'onUpdated', 'onRemoved', 'onCreated', 'onMoved', 'onAttached', 'onDetached', 'onReplaced']) chrome.tabs[e].addListener(changed)
        chrome.windows.onFocusChanged.addListener(changed)
        chrome.tabGroups.onUpdated.addListener(changed)
        return true
      })()`)
    }
    return () => void this.listeners.delete(listener)
  }

  /**
   * Calls `listener` when a download finishes, fails or is cancelled.
   *
   * Chromium's own download state, reported by the extension as it changes -- not a folder being watched and not a
   * guess from a file appearing. A file on disk is not a finished download: a half-written one is also a file, and
   * Chromium is the only thing that knows which it is.
   */
  async watchDownloads(listener: (one: DownloadChange) => void): Promise<() => void> {
    this.downloadListeners.add(listener)
    if (!this.watchingDownloads) {
      this.watchingDownloads = true
      this.browser.conn.on('event', (event: { method: string; params: { name?: string; payload?: string } }) => {
        if (event.method !== 'Runtime.bindingCalled' || event.params.name !== 'orbisDownloadChanged') return
        let one: DownloadChange
        try {
          one = JSON.parse(event.params.payload ?? '{}') as DownloadChange
        } catch {
          return
        }
        if (!one.id || !one.state) return
        for (const l of this.downloadListeners) l(one)
      })
      await this.run('1')
      await this.browser.conn.send('Runtime.addBinding', { name: 'orbisDownloadChanged' }, this.sessionId)
      await this.run(`(() => {
        if (globalThis.__orbisDownloadWatch) return true
        globalThis.__orbisDownloadWatch = true
        /*
         * Only the end of a download is reported. Progress is not an event anybody wants told about, and reporting
         * every byte would be a message a second for a large file.
         */
        const say = (item) => globalThis.orbisDownloadChanged(JSON.stringify({
          id: String(item.id),
          state: item.state,
          /*
           * The name on its own, from a Windows or a POSIX path.
           *
           * The separator is written as a character code rather than typed. This whole script lives inside a
           * template literal and is parsed again inside the extension, so a backslash here has to survive two rounds
           * of escaping -- and it did not: one round left an unterminated string, which stopped the listener being
           * installed at all and silently cost every download event. A character code survives both.
           */
          filename: (() => { const whole = String(item.filename || ''); const cut = Math.max(whole.lastIndexOf('/'), whole.lastIndexOf(String.fromCharCode(92))); return cut >= 0 ? whole.slice(cut + 1) : whole })(),
          path: String(item.filename || ''),
          bytes: item.bytesReceived || 0,
          error: item.error || ''
        }))
        chrome.downloads.onChanged.addListener((delta) => {
          if (!delta.state || delta.state.current === 'in_progress') return
          chrome.downloads.search({ id: delta.id }).then((found) => { if (found[0]) say(found[0]) }).catch(() => undefined)
        })
        return true
      })()`)
    }
    return () => void this.downloadListeners.delete(listener)
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
