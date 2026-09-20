import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine } from '@ghostery/adblocker'
import { AdBlockCore, normalizeSettings, type EngineCategory } from '../adblock/blocker.ts'
import type { CdpEvent } from './cdp.ts'
import type { CdpBrowser, CdpPage } from './cdpPage.ts'

/**
 * Runs the ad blocker's page scripts (the lists' "scriptlets") in each page BEFORE the page's own scripts, the way the Electron
 * build did with its in-process session. Network rules and element hiding cannot stop what a site does inside its own page (the
 * ads YouTube builds into its player data, anti-adblock checks, forced popups): the lists fix those by running small scripts first.
 *
 * A browser extension cannot run code that early on every site (its scripts arrive after the page has started, or are refused by
 * the site's own security policy). Orbis controls the browser, so it does what developer tools do: it pauses each page load, works
 * out which scripts the lists want for that address, registers them to run first in the new document, and lets the load continue.
 * Nothing about where the person browses leaves this computer: the lists are matched here, locally.
 */

/** A scriptlet in its own scope: they declare helpers of the same names, which collide in a shared global scope. */
export function isolateScriptlet(script: string): string {
  return `(function () {\nvar scriptletGlobals = globalThis.__orbisScriptletGlobals || (globalThis.__orbisScriptletGlobals = {});\n${script}\n})();`
}

/**
 * The code registered for one address. It runs in that site's documents only: a redirect to another host of the same domain still
 * matches, and any other document created next in the same tab does not run it.
 */
export function guardedSource(domain: string, scripts: string[], styles: string[] = []): string {
  const d = JSON.stringify(domain.toLowerCase())
  const body = scripts.map((s) => `try {\n${isolateScriptlet(s)}\n} catch (e) {}`).join('\n')
  // Element hiding goes in with the first paint, so ads are never seen and then removed.
  const css = styles.join('\n')
  const hide = css
    ? `try { var css = ${JSON.stringify(css)}; var addStyle = function () { var st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); }; if (document.documentElement) addStyle(); else document.addEventListener('DOMContentLoaded', addStyle); } catch (e) {}`
    : ''
  return `(function () {\nvar h = location.hostname.toLowerCase();\nif (!(h === ${d} || h.endsWith('.' + ${d}))) return;\n${hide}\n${body}\n})();`
}

export interface InjectorOptions {
  browser: Pick<CdpBrowser, 'list' | 'onChange'>
  /** The Orbis extension's own folder for its ad-blocking files (`engines/*.bin`, `popup-hosts.json`). */
  adblockDir: string
  /** The blocker's settings as the extension keeps them (on/off, strength, categories, exceptions); read fresh, briefly cached. */
  readSettings(): Promise<unknown>
  /** How long a read of the settings is reused. */
  settingsMs?: number
}

const NAVIGATION_SCRIPTS_KEPT = 12

export class AdblockInjector {
  private readonly core = new AdBlockCore()
  private readonly attached = new Map<CdpPage, () => void>()
  private stopChange: (() => void) | null = null
  private settingsAt = 0
  private readonly o: InjectorOptions

  constructor(options: InjectorOptions) {
    this.o = options
  }

  get ready(): boolean {
    return this.core.ready
  }

  async start(): Promise<void> {
    const engines: Partial<Record<EngineCategory, FiltersEngine>> = {}
    for (const category of ['ads', 'trackers', 'annoyances'] as const) {
      try {
        engines[category] = FiltersEngine.deserialize(new Uint8Array(await readFile(join(this.o.adblockDir, 'engines', `${category}.bin`))))
      } catch {
        /* the lists have not been built: nothing to run, and the network rules are unaffected */
      }
    }
    const popupHosts = await readFile(join(this.o.adblockDir, 'popup-hosts.json'), 'utf8').then((t) => JSON.parse(t) as string[]).catch(() => [])
    this.core.setEngines(engines, popupHosts)
    for (const page of this.o.browser.list()) void this.attach(page)
    this.stopChange = this.o.browser.onChange((change) => {
      if (change.type === 'opened') void this.attach(change.page)
      else if (change.type === 'closed') this.detach(change.page)
    })
  }

  stop(): void {
    this.stopChange?.()
    for (const off of this.attached.values()) off()
    this.attached.clear()
  }

  private detach(page: CdpPage): void {
    this.attached.get(page)?.()
    this.attached.delete(page)
  }

  private async settings(): Promise<void> {
    if (Date.now() - this.settingsAt < (this.o.settingsMs ?? 1500)) return
    this.settingsAt = Date.now()
    try {
      this.core.settings = normalizeSettings(await this.o.readSettings())
    } catch {
      /* keep the last settings */
    }
  }

  private async attach(page: CdpPage): Promise<void> {
    if (this.attached.has(page) || page.isDestroyed()) return
    const registered: string[] = []
    const off = page.onEvent((event) => void this.onEvent(page, event, registered))
    this.attached.set(page, off)
    try {
      // Only page loads are paused: every request for a document (the page, and frames inside it) waits for a moment, and no other.
      await page.debugger.sendCommand('Fetch.enable', { patterns: [{ urlPattern: 'http*://*', resourceType: 'Document', requestStage: 'Request' }] })
    } catch {
      this.detach(page)
    }
  }

  private async onEvent(page: CdpPage, event: CdpEvent, registered: string[]): Promise<void> {
    if (event.method !== 'Fetch.requestPaused') return
    const { requestId, request } = event.params as { requestId: string; request: { url: string } }
    try {
      await this.settings()
      if (this.core.ready && this.core.settings.enabled && /^https?:/i.test(request.url) && !this.core.siteAllowed(request.url)) {
        const { scripts, styles } = this.core.cosmetics(request.url, undefined)
        if (scripts.length || styles.length) {
          const fallback = new URL(request.url).hostname.replace(/^www\./, '')
          const domain = this.core.domainOf(request.url) || fallback
          const { identifier } = (await page.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: guardedSource(domain, scripts, styles) })) as { identifier: string }
          registered.push(identifier)
          // Scripts for old navigations are dropped, so a long session does not pile them up.
          while (registered.length > NAVIGATION_SCRIPTS_KEPT) void page.debugger.sendCommand('Page.removeScriptToEvaluateOnNewDocument', { identifier: registered.shift()! }).catch(() => undefined)
        }
      }
    } catch {
      /* a failure here must never stop a page from loading */
    } finally {
      await page.debugger.sendCommand('Fetch.continueRequest', { requestId }).catch(() => undefined)
    }
  }
}
