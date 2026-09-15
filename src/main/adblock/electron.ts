import { ipcMain, webContents } from 'electron'
import type { Session, WebContents } from 'electron'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FiltersEngine } from '@ghostery/adblocker'
import type { AdBlockCategory, AdBlockEvent, AdBlockListInfo, AdBlockPageReport, AdBlockSettings, AdBlockState } from '../../shared/types'
import { AdBlockCore, ENGINE_CONFIG, activeCategories, extractPopupHosts, hostOf, normalizeSettings } from './blocker'
import type { EngineCategory } from './blocker'
import { FilterStore, countRules, sha256 } from './store'
import type { Catalog, LoadedFilters } from './store'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type AdBlockAction = 'report' | 'allow_site' | 'block_site' | 'allow_resource' | 'strict' | 'standard' | 'enable' | 'disable' | 'update'

const CATEGORY_WORDS: Record<AdBlockCategory, [string, string]> = {
  ads: ['ad', 'ads'],
  trackers: ['tracker', 'trackers'],
  annoyances: ['overlay or anti-adblock element', 'overlays and anti-adblock elements'],
  popups: ['popup', 'popups'],
  redirects: ['ad redirect', 'ad redirects']
}
const plural = (n: number, category: AdBlockCategory): string => `${n} ${CATEGORY_WORDS[category][n === 1 ? 0 : 1]}`

/** Set ORBIS_ADBLOCK_DEBUG=1 to log navigation, popup and cosmetic decisions (for diagnosing a site), one line each. */
const debug = (...parts: unknown[]): void => {
  if (process.env.ORBIS_ADBLOCK_DEBUG === '1') console.log('[adblock]', parts.map((p) => (typeof p === 'string' || typeof p === 'number' ? p : JSON.stringify(p))).join(' '))
}

/**
 * Runs a scriptlet in its own function scope. The lists' scriptlets declare top-level helpers, so running several in a
 * page's global scope makes their declarations collide (and breaks sites such as YouTube). They still share one
 * `scriptletGlobals` object, as they expect.
 */
function isolateScriptlet(script: string): string {
  return `(function () {\nvar scriptletGlobals = globalThis.__orbisScriptletGlobals || (globalThis.__orbisScriptletGlobals = {});\n${script}\n})();`
}

/**
 * Ad blocking in the Orbis browser session: filter lists (with updates, rollback and recovery), network, CSP and
 * cosmetic filtering, popup and redirect protection, per-tab results, and the commands Orion can run.
 */
export class OrbisAdBlock {
  readonly core = new AdBlockCore()
  /** Created once the catalog has been read in start(). */
  private store!: FilterStore
  private catalog!: Catalog
  private loaded?: LoadedFilters
  private lists: AdBlockListInfo[] = []
  private updating = false
  private notice?: string
  private readonly statTimers = new Map<number, NodeJS.Timeout>()
  /** Scriptlets already run per frame document, so none runs twice. */
  private readonly ranScriptlets = new Map<string, Set<string>>()

  /** Records a scriptlet for a frame document; false when it already ran there. */
  private markScriptlet(frameKey: string, script: string): boolean {
    let ran = this.ranScriptlets.get(frameKey)
    if (!ran) {
      // Old frame documents are forgotten so the record stays small over a long session.
      if (this.ranScriptlets.size > 500) this.ranScriptlets.delete(this.ranScriptlets.keys().next().value!)
      ran = new Set()
      this.ranScriptlets.set(frameKey, ran)
    }
    const digest = sha256(script)
    if (ran.has(digest)) return false
    ran.add(digest)
    return true
  }

  constructor(
    private readonly o: {
      dataDir: string
      bundledDir: string
      appPath: string
      session: Session
      fetchFn: FetchFn
      emit(event: AdBlockEvent): void
    }
  ) {}

  /** Wires the session straight away (requests pass until the lists are ready), then loads the lists and checks for updates. */
  async start(): Promise<void> {
    this.catalog = JSON.parse(await readFile(join(this.o.bundledDir, 'catalog.json'), 'utf8')) as Catalog
    this.store = new FilterStore({ dir: this.o.dataDir, bundledDir: this.o.bundledDir, catalog: this.catalog, fetchFn: this.o.fetchFn })
    this.core.settings = await this.readSettings()
    this.core.onStats = (id) => this.queueStats(id)
    this.wireSession()
    await this.loadEngines()
    const last = this.loaded?.manifest.checkedAt ?? this.loaded?.manifest.updatedAt ?? 0
    if (Date.now() - last > this.catalog.updateIntervalHours * 3_600_000) setTimeout(() => void this.updateFilters(), 15_000)
  }

  private async readSettings(): Promise<AdBlockSettings> {
    try {
      return normalizeSettings(JSON.parse(await readFile(join(this.o.dataDir, 'settings.json'), 'utf8')))
    } catch {
      return normalizeSettings({})
    }
  }

  private async saveSettings(): Promise<void> {
    await mkdir(this.o.dataDir, { recursive: true })
    await writeFile(join(this.o.dataDir, 'settings.json'), JSON.stringify(this.core.settings, null, 2))
  }

  private wireSession(): void {
    const { session } = this.o
    const preload = createRequire(join(this.o.appPath, 'package.json')).resolve('@ghostery/adblocker-electron-preload')
    session.registerPreloadScript({ type: 'frame', filePath: preload })
    session.registerPreloadScript({ type: 'frame', filePath: join(__dirname, '../preload/adblockFrame.js') })
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        const decision = this.core.onRequest(details)
        callback(decision.action === 'block' ? { cancel: true } : decision.action === 'redirect' ? { redirectURL: decision.redirectUrl } : {})
      } catch {
        callback({})
      }
    })
    session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, callback) => {
      try {
        if (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame') return callback({})
        const csp = this.core.csp(details)
        if (!csp) return callback({})
        const headers = { ...(details.responseHeaders ?? {}) }
        const policies = csp.split(';').map((p) => p.trim())
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'content-security-policy') {
            policies.push(...headers[name])
            delete headers[name]
          }
        }
        callback({ responseHeaders: { ...headers, 'content-security-policy': [policies.join(';')] } })
      } catch {
        callback({})
      }
    })
    // The in-page script (registered above) asks for cosmetic filters on load and again as new elements appear.
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url: unknown, msg?: { classes?: string[]; hrefs?: string[]; ids?: string[] }) => {
      if (event.sender.session !== session || typeof url !== 'string') return
      const { styles, scripts } = this.core.cosmetics(url, msg, event.sender.id)
      const frame = event.senderFrame
      // Scriptlets run once, in the frame that asked. Running them again (or in the top page on a subframe's behalf)
      // redeclares their helpers and breaks sites such as YouTube.
      const key = frame ? `${frame.processId}:${frame.routingId}:${url.split('#')[0]}` : ''
      const fresh = frame ? scripts.filter((script) => this.markScriptlet(key, script)) : []
      debug('cosmetics', event.sender.id, url.slice(0, 80), msg ? `update(${msg.classes?.length ?? 0} classes)` : 'initial', `css=${styles.join('').length}`, `scripts=${scripts.length}`, `run=${fresh.length}`)
      for (const css of styles) void event.sender.insertCSS(css, { cssOrigin: 'user' }).catch(() => undefined)
      for (const script of fresh) void frame!.executeJavaScript(isolateScriptlet(script), true).catch(() => undefined)
    })
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => event.sender.session === session && this.core.settings.enabled)
  }

  private async loadEngines(): Promise<void> {
    let loaded: LoadedFilters
    try {
      loaded = await this.store.load()
    } catch (err) {
      this.notice = err instanceof Error ? err.message : String(err)
      this.emitState()
      return
    }
    this.loaded = loaded
    if (loaded.recovered) this.notice = loaded.recovered
    const resources = loaded.texts.get(this.catalog.resources.id) ?? ''
    const resourcesChecksum = loaded.manifest.lists[this.catalog.resources.id]?.checksum ?? sha256(resources)
    const listsFor = (category: EngineCategory): string[] =>
      this.catalog.lists.filter((l) => (category === 'ads' ? l.category === 'ads' || l.category === 'orbis' : l.category === category) && loaded.texts.has(l.id)).map((l) => l.id)
    const keys = (['ads', 'trackers', 'annoyances'] as const).map((category) => {
      const parts = listsFor(category).map((id) => loaded.manifest.lists[id]?.checksum ?? sha256(loaded.texts.get(id) ?? ''))
      return { category, key: `${category}-${sha256(`${category}|${parts.join(',')}|${resourcesChecksum}`).slice(0, 20)}` }
    })
    const engines: Partial<Record<EngineCategory, FiltersEngine>> = {}
    for (const { category, key } of keys) {
      let engine: FiltersEngine | null = null
      const cached = await this.store.readEngine(key)
      if (cached) {
        try {
          engine = FiltersEngine.deserialize(cached)
        } catch {
          // A cache from another engine version or a damaged file: compile again.
          await this.store.discardEngine(key)
        }
      }
      if (!engine) {
        const text = listsFor(category).map((id) => loaded.texts.get(id)).join('\n')
        engine = FiltersEngine.parse(text, category === 'trackers' ? { ...ENGINE_CONFIG, loadCosmeticFilters: false } : ENGINE_CONFIG)
        if (resources && category !== 'trackers') engine.updateResources(resources, resourcesChecksum)
        await this.store.writeEngine(key, engine.serialize(), keys.map((k) => k.key)).catch(() => undefined)
      }
      engines[category] = engine
    }
    const popupHosts = [...listsFor('ads'), ...listsFor('annoyances')].flatMap((id) => extractPopupHosts(loaded.texts.get(id) ?? ''))
    this.core.setEngines(engines, popupHosts)
    this.lists = this.catalog.lists
      .filter((l) => loaded.texts.has(l.id))
      .map((l) => {
        const entry = loaded.manifest.lists[l.id]
        return {
          id: l.id,
          name: l.name,
          category: l.category,
          rules: entry?.rules ?? countRules(loaded.texts.get(l.id) ?? ''),
          updatedAt: entry?.updatedAt ?? loaded.manifest.updatedAt ?? 0,
          source: entry?.source ?? 'bundled'
        }
      })
    this.emitState()
  }

  private queueStats(webContentsId: number): void {
    if (this.statTimers.has(webContentsId)) return
    this.statTimers.set(
      webContentsId,
      setTimeout(() => {
        this.statTimers.delete(webContentsId)
        const report = this.core.report(webContentsId)
        if (report) this.o.emit({ type: 'stats', webContentsId, counts: report.counts })
      }, 400)
    )
  }

  private emitState(): void {
    this.o.emit({ type: 'state', state: this.state() })
  }

  state(): AdBlockState {
    return {
      settings: this.core.settings,
      active: this.core.active(),
      ready: this.core.ready,
      updating: this.updating,
      version: this.loaded?.manifest.version ?? '',
      updatedAt: this.loaded?.manifest.updatedAt ?? 0,
      checkedAt: this.loaded?.manifest.checkedAt,
      canRollback: this.loaded?.canRollback ?? false,
      lists: this.lists,
      notice: this.notice
    }
  }

  /** Popup, redirect and page tracking for one browser tab. `openTab` opens an allowed popup as an Orbis tab. */
  attachWebview(contents: WebContents, openTab: (url: string, details: { disposition: string; features: string }) => void): void {
    const id = contents.id
    contents.on('did-start-navigation', (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.core.startPage(id, details.url)
    })
    contents.on('destroyed', () => this.core.dropPage(id))
    // A page that started loading before this tab was observed still gets its record.
    const ensurePage = (): void => {
      const current = contents.getURL()
      if (!this.core.report(id) && /^https?:/i.test(current)) this.core.startPage(id, current)
    }
    contents.setWindowOpenHandler(({ url, referrer, disposition, features }) => {
      if (!/^https?:/i.test(url)) return { action: 'deny' }
      ensurePage()
      // Pages can't ask for a background tab, or a new window without features: those come from the user's own clicks.
      const userOpened = disposition === 'background-tab' || (disposition === 'new-window' && !features)
      const verdict = this.core.popup({ url, webContentsId: id, openerUrl: referrer?.url || undefined, userOpened })
      debug('popup', id, url.slice(0, 80), verdict)
      if (!verdict.block) openTab(url, { disposition, features })
      return { action: 'deny' }
    })
    const guard = (redirect: boolean) => (details: Electron.Event<{ url: string; isMainFrame: boolean }>, legacyUrl?: string) => {
      debug(redirect ? 'will-redirect' : 'will-navigate', id, { detailsUrl: details.url, legacyUrl, isMainFrame: details.isMainFrame, page: this.core.report(id)?.pageUrl ?? null })
      if (details.isMainFrame === false) return
      ensurePage()
      const verdict = this.core.navigation({ url: details.url ?? legacyUrl ?? '', webContentsId: id, redirect })
      debug('navigation verdict', id, verdict)
      if (!verdict.block) return
      details.preventDefault()
      this.o.emit({ type: 'navigation-blocked', webContentsId: id, url: details.url, reason: verdict.reason })
    }
    contents.on('will-navigate', guard(false))
    contents.on('will-redirect', guard(true))
  }

  private changed(): AdBlockState {
    void this.saveSettings()
    const state = this.state()
    this.o.emit({ type: 'state', state })
    return state
  }

  /**
   * Resources loaded while blocking was off (or weaker) sit in the browser cache, and cached loads never reach the
   * request filter. Clearing the cache makes stronger blocking apply on the very next load.
   */
  private async clearCacheIfStronger(before: AdBlockSettings): Promise<void> {
    const now = this.core.settings
    const was = activeCategories(before)
    const is = activeCategories(now)
    const stronger =
      (Object.keys(is) as AdBlockCategory[]).some((c) => is[c] && !was[c]) ||
      before.siteExceptions.some((s) => !now.siteExceptions.includes(s)) ||
      before.resourceExceptions.some((r) => !now.resourceExceptions.includes(r)) ||
      (now.level === 'strict' && before.level !== 'strict')
    if (!stronger) return
    // Browser tabs also drop their in-memory resource cache (see preload/adblockFrame.ts); nothing is reloaded.
    for (const tab of webContents.getAllWebContents()) {
      if (!tab.isDestroyed() && tab.session === this.o.session) tab.send('orbis-adblock:clear-memory-cache')
    }
    // Waited for, so a page loaded right after the change is filtered rather than served from the cache.
    await this.o.session.clearCache().catch(() => undefined)
  }

  async updateSettings(update: Partial<AdBlockSettings>): Promise<AdBlockState> {
    const before = this.core.settings
    this.core.updateSettings(update)
    await this.clearCacheIfStronger(before)
    return this.changed()
  }

  async setSite(host: string, allowed: boolean): Promise<AdBlockState> {
    const before = this.core.settings
    this.core.setSite(host, allowed)
    await this.clearCacheIfStronger(before)
    return this.changed()
  }

  allowResource(url: string): AdBlockState {
    this.core.allowResource(url)
    return this.changed()
  }

  async removeException(kind: 'site' | 'resource', value: string): Promise<AdBlockState> {
    const before = this.core.settings
    this.core.removeException(kind, value)
    await this.clearCacheIfStronger(before)
    return this.changed()
  }

  async updateFilters(): Promise<AdBlockState> {
    if (this.updating) return this.state()
    this.updating = true
    this.emitState()
    try {
      const result = await this.store.update()
      if (result.updated.length) await this.loadEngines()
      else this.loaded = await this.store.load()
      this.notice = result.failed.length ? `Some filter lists couldn't be updated: ${result.failed.map((f) => `${f.id} (${f.reason})`).join('; ')}. They keep their current version.` : undefined
    } catch (err) {
      this.notice = `Filter update failed: ${err instanceof Error ? err.message : String(err)}. The current lists stay in use.`
    } finally {
      this.updating = false
    }
    return this.changed()
  }

  async rollback(): Promise<AdBlockState> {
    try {
      await this.store.rollback()
      await this.loadEngines()
      this.notice = 'Went back to the previous version of the filter lists.'
    } catch (err) {
      this.notice = err instanceof Error ? err.message : String(err)
    }
    return this.changed()
  }

  /** Runs an ad blocking command from Orion and returns the facts to answer with, taken only from the engine. */
  async command(action: AdBlockAction, target: string | null, pageUrl: string | undefined): Promise<string> {
    let report: AdBlockPageReport | null = pageUrl ? this.core.reportForUrl(pageUrl) : null
    const host = pageUrl ? hostOf(pageUrl) : ''
    let done = ''
    const reload = (): void => {
      const tab = report ? webContents.fromId(report.webContentsId) : undefined
      tab?.reload()
    }
    switch (action) {
      case 'allow_site': {
        const site = target && /\.[a-z]{2,}/i.test(target) ? target : host
        if (!site) done = 'No site was changed: no page is open in the Orbis browser and no site was named.'
        else {
          await this.setSite(site, true)
          done = `Added a site exception: nothing is blocked on ${hostOf(`https://${site.replace(/^https?:\/\//, '')}`)} now.${report && site === host ? ' The page was reloaded.' : ''}`
          if (site === host) reload()
        }
        break
      }
      case 'block_site': {
        const site = target && /\.[a-z]{2,}/i.test(target) ? hostOf(`https://${target.replace(/^https?:\/\//, '')}`) : host
        if (!site || !this.core.settings.siteExceptions.includes(site)) done = `${site || 'This site'} had no site exception, so blocking was already on there.`
        else {
          await this.removeException('site', site)
          done = `Removed the site exception: ads and trackers are blocked on ${site} again.`
          if (site === host) reload()
        }
        break
      }
      case 'allow_resource': {
        const candidates = (report?.recent ?? []).filter((e) => e.action === 'blocked' || e.action === 'redirected')
        const match = target ? candidates.find((e) => e.url.toLowerCase().includes(target.toLowerCase())) : candidates.length === 1 ? candidates[0] : undefined
        if (match) {
          this.allowResource(match.url)
          done = `Added a resource exception for ${match.url.split('?')[0]} (it was blocked by the rule ${match.rule ?? 'unknown'}). Everything else stays blocked. The page was reloaded.`
          reload()
        } else done = target ? `No blocked resource on this page matches "${target}", so nothing was changed.` : 'Nothing was changed: say which blocked resource to allow (for example by its address).'
        break
      }
      case 'strict':
      case 'standard':
        await this.updateSettings({ level: action, enabled: true })
        done = `Ad blocking is now ${action === 'strict' ? 'Strict' : 'Standard'}. It applies to pages as they load.`
        break
      case 'enable':
      case 'disable':
        await this.updateSettings({ enabled: action === 'enable' })
        done = action === 'enable' ? 'Turned ad blocking on.' : 'Turned ad blocking off everywhere (site exceptions are kept).'
        break
      case 'update': {
        const state = await this.updateFilters()
        done = `Checked for filter list updates. ${state.notice ?? `Lists version: ${state.version}.`}`
        break
      }
      case 'report':
        break
    }
    if (pageUrl) report = this.core.reportForUrl(pageUrl)
    return this.facts(done, pageUrl, report)
  }

  private facts(done: string, pageUrl: string | undefined, report: AdBlockPageReport | null): string {
    const s = this.core.settings
    const active = this.core.active()
    const rules = this.lists.reduce((n, l) => n + l.rules, 0)
    const lines = [
      "Ad blocking facts from Orbis's blocking engine. Answer only from these facts; never add numbers, resources or reasons that aren't listed.",
      `Ad blocking: ${s.enabled ? `on (${s.level === 'custom' ? 'Custom' : s.level === 'strict' ? 'Strict' : 'Standard'})` : 'off'}${this.core.ready ? '' : ', filter lists still loading'}. Blocking now: ${(Object.keys(active) as AdBlockCategory[]).map((c) => `${CATEGORY_WORDS[c][1]} ${active[c] ? 'on' : 'off'}`).join(', ')}.`,
      `Filter lists: ${this.lists.length} lists with ${rules.toLocaleString('en-US')} rules, version ${this.state().version || 'unknown'}.`,
      `Site exceptions: ${s.siteExceptions.join(', ') || 'none'}. Resource exceptions: ${s.resourceExceptions.join(', ') || 'none'}.`
    ]
    if (!pageUrl) lines.push('No page is open in the Orbis browser.')
    else if (!report) lines.push(`The open page (${pageUrl}) has no blocking record: it loaded before blocking started or in another tab. Reloading it will record what gets blocked.`)
    else {
      const counts = (Object.keys(report.counts) as AdBlockCategory[]).map((c) => plural(report.counts[c], c)).join(', ')
      lines.push(`Open page: ${report.pageUrl}. Site exception: ${report.siteAllowed ? 'yes (nothing is blocked here)' : 'no'}. Blocked since it loaded: ${counts}. Element-hiding rules applied: ${report.hidingRules}; scriptlets injected: ${report.scriptlets}.`)
      const acted = report.recent.filter((e) => e.action === 'blocked' || e.action === 'redirected').slice(0, 25)
      if (acted.length) lines.push(`Most recent blocked requests (newest first):\n${acted.map((e) => `- ${e.action} ${CATEGORY_WORDS[e.category][0]} (${e.type}) ${e.url} — rule: ${e.rule ?? 'unknown'}`).join('\n')}`)
      const allowed = report.recent.filter((e) => e.action === 'uncertain' || e.action === 'allowed-by-exception').slice(0, 15)
      if (allowed.length) lines.push(`Matched a rule but allowed (uncertain matches kept to avoid breaking the site, or exceptions):\n${allowed.map((e) => `- ${e.action} (${e.type}) ${e.url} — rule: ${e.rule ?? 'unknown'}`).join('\n')}`)
      lines.push('If the page seems broken, a blocked request above may be essential: the smallest fix is allowing that one resource, not the whole site.')
    }
    if (done) lines.push(`Action taken just now: ${done}`)
    if (this.notice) lines.push(`Filter list notice: ${this.notice}`)
    return lines.join('\n')
  }
}
