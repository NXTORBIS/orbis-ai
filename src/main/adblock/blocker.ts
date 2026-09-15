import { FiltersEngine, Request } from '@ghostery/adblocker'
import type { AdBlockCategories, AdBlockCategory, AdBlockEntry, AdBlockPageReport, AdBlockSettings } from '../../shared/types'

/** The three compiled engines: ads (with Orbis's own rules), trackers, and annoyances (overlays, anti-adblock, cookie notices). */
export type EngineCategory = 'ads' | 'trackers' | 'annoyances'

export const ENGINE_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: true,
  loadGenericCosmeticsFilters: true,
  loadExtendedSelectors: true,
  loadExceptionFilters: true,
  loadCSPFilters: true,
  loadPreprocessors: true,
  enableMutationObserver: true,
  enablePushInjectionsOnNavigationEvents: true,
  enableHtmlFiltering: false,
  enableOptimizations: true,
  guessRequestTypeFromUrl: true,
  integrityCheck: true
}

export const DEFAULT_SETTINGS: AdBlockSettings = {
  enabled: true,
  level: 'standard',
  custom: { ads: true, trackers: true, annoyances: true, popups: true, redirects: true },
  siteExceptions: [],
  resourceExceptions: []
}

const ALL_OFF: AdBlockCategories = { ads: false, trackers: false, annoyances: false, popups: false, redirects: false }
const EMPTY_COUNTS = (): Record<AdBlockCategory, number> => ({ ads: 0, trackers: 0, annoyances: 0, popups: 0, redirects: 0 })
const MAX_RECENT = 250

export function activeCategories(settings: AdBlockSettings): AdBlockCategories {
  if (!settings.enabled) return { ...ALL_OFF }
  if (settings.level === 'strict') return { ads: true, trackers: true, annoyances: true, popups: true, redirects: true }
  if (settings.level === 'custom') return { ...settings.custom }
  return { ads: true, trackers: true, annoyances: false, popups: true, redirects: true }
}

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const strings = (value: unknown): string[] => (Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim().toLowerCase()))] : [])

/** Settings read from disk or sent by the window, with anything invalid replaced by defaults. */
export function normalizeSettings(raw: unknown): AdBlockSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdBlockSettings>
  const custom = (s.custom && typeof s.custom === 'object' ? s.custom : {}) as Partial<AdBlockCategories>
  return {
    enabled: bool(s.enabled, true),
    level: s.level === 'strict' || s.level === 'custom' ? s.level : 'standard',
    custom: {
      ads: bool(custom.ads, true),
      trackers: bool(custom.trackers, true),
      annoyances: bool(custom.annoyances, true),
      popups: bool(custom.popups, true),
      redirects: bool(custom.redirects, true)
    },
    siteExceptions: strings(s.siteExceptions),
    resourceExceptions: strings(s.resourceExceptions)
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

/** A resource exception key: host and path, without query or fragment. */
export function resourceKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.hostname.replace(/^www\./, '')}${u.pathname}`.toLowerCase()
  } catch {
    return url.trim().toLowerCase()
  }
}

/** The registrable domain ("example.co.uk"), so subdomains of one site count as the same site. */
function siteOf(url: string): string {
  try {
    const request = Request.fromRawDetails({ url })
    return request.domain || request.hostname
  } catch {
    return hostOf(url)
  }
}

interface PageStats {
  pageUrl: string
  startedAt: number
  /** The page this one replaced, so a navigation stopped as an ad redirect can put it back. */
  previous?: PageStats
  counts: Record<AdBlockCategory, number>
  hidingRules: number
  scriptlets: number
  recent: AdBlockEntry[]
  popupTimes: number[]
}

export interface RequestDetails {
  id?: number
  url: string
  /** Electron resource type: mainFrame, subFrame, script, image, xhr, media, ... */
  resourceType?: string
  referrer?: string
  webContentsId?: number
}

export type RequestDecision =
  | { action: 'allow' }
  | { action: 'block'; category: EngineCategory; rule?: string }
  | { action: 'redirect'; category: EngineCategory; redirectUrl: string; rule?: string }

export type Verdict = { block: false } | { block: true; reason: string; rule?: string }

/** Trackers first: a tracker that the ad lists also block is still reported as a tracker. */
const NETWORK_ORDER: EngineCategory[] = ['trackers', 'ads', 'annoyances']
const COSMETIC_ORDER: EngineCategory[] = ['ads', 'annoyances']
/** Request types where a generic rule matching a first-party request may be the site's own functionality. */
const FUNCTIONAL_TYPES = new Set(['xhr', 'xmlhttprequest', 'fetch', 'script', 'subFrame', 'sub_frame', 'webSocket', 'websocket'])

const ALLOW: RequestDecision = { action: 'allow' }

/**
 * The blocking engine as Orbis uses it: classifies every browser request (block, redirect to a harmless stand-in,
 * allow, or uncertain), supplies cosmetic filters and scriptlets for pages, decides on popups and ad redirects,
 * applies site and resource exceptions, and keeps the real per-page results.
 */
export class AdBlockCore {
  settings: AdBlockSettings
  private engines: Partial<Record<EngineCategory, FiltersEngine>> = {}
  /** Hosts the lists block as popups, from their $popup rules. */
  private popupHosts = new Set<string>()
  private readonly pages = new Map<number, PageStats>()
  /** Called whenever a page's results change. */
  onStats?: (webContentsId: number) => void

  constructor(settings: AdBlockSettings = DEFAULT_SETTINGS) {
    this.settings = normalizeSettings(settings)
  }

  setEngines(engines: Partial<Record<EngineCategory, FiltersEngine>>, popupHosts: Iterable<string> = []): void {
    this.engines = engines
    this.popupHosts = new Set(popupHosts)
  }

  get ready(): boolean {
    return Boolean(this.engines.ads)
  }

  active(): AdBlockCategories {
    return activeCategories(this.settings)
  }

  /** A new page loaded in a tab: its results start from zero. The same page reported again moments later is kept. */
  startPage(webContentsId: number, url: string): void {
    const current = this.pages.get(webContentsId)
    if (current && current.pageUrl === url && Date.now() - current.startedAt < 3000) return
    const previous = current ? { ...current, previous: undefined } : undefined
    this.pages.set(webContentsId, { pageUrl: url, startedAt: Date.now(), previous, counts: EMPTY_COUNTS(), hidingRules: 0, scriptlets: 0, recent: [], popupTimes: [] })
    this.onStats?.(webContentsId)
  }

  dropPage(webContentsId: number): void {
    this.pages.delete(webContentsId)
  }

  siteAllowed(url: string): boolean {
    const host = hostOf(url)
    return Boolean(host) && this.settings.siteExceptions.some((site) => host === site || host.endsWith(`.${site}`))
  }

  resourceAllowed(url: string): boolean {
    const key = resourceKey(url)
    return this.settings.resourceExceptions.some((allowed) => key === allowed || key.startsWith(allowed.endsWith('/') ? allowed : `${allowed}/`) || key.startsWith(`${allowed}?`))
  }

  setSite(host: string, allowed: boolean): void {
    const site = hostOf(host.includes('://') ? host : `https://${host}`)
    if (!site) return
    const rest = this.settings.siteExceptions.filter((s) => s !== site)
    this.settings = { ...this.settings, siteExceptions: allowed ? [...rest, site] : rest }
  }

  allowResource(url: string): string {
    const key = resourceKey(url)
    if (key && !this.settings.resourceExceptions.includes(key)) this.settings = { ...this.settings, resourceExceptions: [...this.settings.resourceExceptions, key] }
    return key
  }

  removeException(kind: 'site' | 'resource', value: string): void {
    const v = value.trim().toLowerCase()
    this.settings = kind === 'site' ? { ...this.settings, siteExceptions: this.settings.siteExceptions.filter((s) => s !== v) } : { ...this.settings, resourceExceptions: this.settings.resourceExceptions.filter((r) => r !== v) }
  }

  updateSettings(update: Partial<AdBlockSettings>): void {
    this.settings = normalizeSettings({ ...this.settings, ...update, custom: { ...this.settings.custom, ...(update.custom ?? {}) } })
  }

  private page(webContentsId: number | undefined): PageStats | undefined {
    return webContentsId === undefined ? undefined : this.pages.get(webContentsId)
  }

  private record(webContentsId: number | undefined, entry: Omit<AdBlockEntry, 'at'>): void {
    const page = this.page(webContentsId)
    if (!page || webContentsId === undefined) return
    page.recent.unshift({ ...entry, url: entry.url.slice(0, 400), at: Date.now() })
    if (page.recent.length > MAX_RECENT) page.recent.length = MAX_RECENT
    if (entry.action === 'blocked' || entry.action === 'redirected') page.counts[entry.category]++
    this.onStats?.(webContentsId)
  }

  /** Network filtering for one request, before it leaves the device. */
  onRequest(d: RequestDetails): RequestDecision {
    const active = this.active()
    const type = d.resourceType || 'other'
    // Documents the user navigates to are never blocked here (ad redirects are handled by navigation()). The document
    // request is the most reliable start of a page: a new tab can start loading before its navigation is observed.
    if (type === 'mainFrame') {
      if (d.webContentsId !== undefined && d.webContentsId > 0 && /^https?:/i.test(d.url)) this.startPage(d.webContentsId, d.url)
      return ALLOW
    }
    if (!this.settings.enabled || !this.ready || !/^(https?|wss?):/i.test(d.url)) return ALLOW
    const pageUrl = this.page(d.webContentsId)?.pageUrl || d.referrer || ''
    if (pageUrl && this.siteAllowed(pageUrl)) return ALLOW

    const request = Request.fromRawDetails({ requestId: `${d.id ?? 0}`, tabId: d.webContentsId ?? 0, url: d.url, type: type as never, sourceUrl: pageUrl || undefined })
    if (request.type === 'other') request.guessTypeOfRequest()
    for (const category of NETWORK_ORDER) {
      const engine = this.engines[category]
      if (!engine || !active[category]) continue
      const result = engine.match(request)
      if (!result.match && !result.redirect) continue
      const rule = result.filter?.toString()
      const base = { category, url: d.url, type, rule }
      if (this.resourceAllowed(d.url)) {
        this.record(d.webContentsId, { ...base, action: 'allowed-by-exception' })
        return ALLOW
      }
      if (this.settings.level !== 'strict' && isUncertain(request, rule, type)) {
        this.record(d.webContentsId, { ...base, action: 'uncertain' })
        return ALLOW
      }
      if (result.redirect) {
        this.record(d.webContentsId, { ...base, action: 'redirected' })
        return { action: 'redirect', category, redirectUrl: result.redirect.dataUrl, rule }
      }
      this.record(d.webContentsId, { ...base, action: 'blocked' })
      return { action: 'block', category, rule }
    }
    return ALLOW
  }

  /** Content-Security-Policy additions the lists ask for on a document (e.g. to stop inline ad scripts). */
  csp(d: RequestDetails): string | undefined {
    const active = this.active()
    if (!this.settings.enabled || !this.ready || !active.ads) return undefined
    const pageUrl = d.resourceType === 'mainFrame' ? d.url : this.page(d.webContentsId)?.pageUrl || d.url
    if (this.siteAllowed(pageUrl)) return undefined
    const request = Request.fromRawDetails({ url: d.url, type: (d.resourceType || 'other') as never, sourceUrl: d.referrer })
    return this.engines.ads?.getCSPDirectives(request)
  }

  /**
   * Element-hiding styles and scriptlets for a page (or frame). The first call for a page gets the base and site rules;
   * later calls, sent by the in-page observer as new elements appear, get rules for those classes, ids and links.
   */
  cosmetics(
    url: string,
    dom: { classes?: string[]; hrefs?: string[]; ids?: string[] } | undefined,
    webContentsId?: number
  ): { styles: string[]; scripts: string[] } {
    const out = { styles: [] as string[], scripts: [] as string[] }
    const active = this.active()
    const pageUrl = this.page(webContentsId)?.pageUrl || url
    if (!this.settings.enabled || !this.ready || this.siteAllowed(pageUrl) || this.siteAllowed(url)) return out
    const request = Request.fromRawDetails({ url })
    const first = dom === undefined
    for (const category of COSMETIC_ORDER) {
      const engine = this.engines[category]
      if (!engine || !active[category]) continue
      const { active: enabled, styles, scripts } = engine.getCosmeticsFilters({
        url,
        hostname: request.hostname,
        // IP addresses and localhost have no registrable domain; the hostname stands in so generic rules still apply.
        domain: request.domain || request.hostname,
        classes: dom?.classes,
        hrefs: dom?.hrefs,
        ids: dom?.ids,
        getBaseRules: first,
        getInjectionRules: first,
        getExtendedRules: false,
        getRulesFromHostname: first,
        getRulesFromDOM: !first,
        callerContext: {}
      })
      if (enabled === false) continue
      if (styles) out.styles.push(styles)
      out.scripts.push(...scripts)
    }
    const page = this.page(webContentsId)
    if (page && webContentsId !== undefined && (out.styles.length || out.scripts.length)) {
      page.hidingRules += out.styles.reduce((n, css) => n + countSelectors(css), 0)
      page.scriptlets += out.scripts.length
      this.onStats?.(webContentsId)
    }
    return out
  }

  /**
   * Whether a page may open a new window or tab. `userOpened` is a link the user deliberately opened (middle-click,
   * Ctrl+click, Shift+click): known ad servers are still stopped, but it never counts as the page spamming windows.
   */
  popup(p: { url: string; webContentsId: number; openerUrl?: string; now?: number; userOpened?: boolean }): Verdict {
    const active = this.active()
    if (!active.popups || !this.ready) return { block: false }
    const page = this.page(p.webContentsId)
    const pageUrl = page?.pageUrl || p.openerUrl || ''
    if ((pageUrl && this.siteAllowed(pageUrl)) || this.resourceAllowed(p.url)) return { block: false }
    const now = p.now ?? Date.now()
    const block = (reason: string, rule?: string): Verdict => {
      this.record(p.webContentsId, { category: 'popups', url: p.url, type: 'popup', rule, action: 'blocked' })
      return { block: true, reason, rule }
    }
    const host = hostOf(p.url)
    for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) {
      if (this.popupHosts.has(h)) return block(`${host} is a known popup ad server`, `||${h}^$popup`)
    }
    // A popup that opens an ad or tracking server the lists block anywhere is an ad popup too.
    for (const category of ['ads', 'trackers'] as const) {
      const engine = this.engines[category]
      if (!engine || !active[category]) continue
      for (const type of ['main_frame', 'sub_frame']) {
        const result = engine.match(Request.fromRawDetails({ url: p.url, type: type as never, sourceUrl: pageUrl || undefined }))
        if (result.match) return block(`${host} is a known ${category === 'ads' ? 'ad' : 'tracking'} server`, result.filter?.toString())
      }
    }
    if (p.userOpened) return { block: false }
    if (page) {
      page.popupTimes = [...page.popupTimes.filter((t) => now - t < 10_000), now]
      if (page.popupTimes.length > 2) return block('the page kept opening new windows')
    }
    if (this.settings.level === 'strict' && p.openerUrl && pageUrl && siteOf(p.openerUrl) !== siteOf(pageUrl)) return block('a third-party frame on the page tried to open it')
    return { block: false }
  }

  /** Whether a page-initiated navigation or a redirect is taking the tab to an ad or tracking server. */
  navigation(n: { url: string; webContentsId: number; redirect: boolean }): Verdict & { category?: EngineCategory } {
    const active = this.active()
    if (!active.redirects || !this.ready || !/^https?:/i.test(n.url)) return { block: false }
    // The document request for the destination can arrive before the navigation event, already starting its record:
    // then the page being navigated away from is the one it replaced.
    let page = this.page(n.webContentsId)
    const arrivedFirst = Boolean(page && page.previous && resourceKey(page.pageUrl) === resourceKey(n.url))
    if (arrivedFirst) page = page!.previous
    const from = page?.pageUrl || ''
    if (!from || this.siteAllowed(from) || this.resourceAllowed(n.url) || siteOf(n.url) === siteOf(from)) return { block: false }
    // Blocking keeps the tab on the page it was on, so that page's record comes back.
    if (arrivedFirst && page) this.pages.set(n.webContentsId, page)
    for (const category of ['ads', 'trackers'] as const) {
      const engine = this.engines[category]
      if (!engine || !active[category]) continue
      for (const type of ['main_frame', 'sub_frame', 'popup']) {
        const result = engine.match(Request.fromRawDetails({ url: n.url, type: type as never, sourceUrl: from }))
        if (!result.match) continue
        const rule = result.filter?.toString()
        this.record(n.webContentsId, { category: 'redirects', url: n.url, type: n.redirect ? 'redirect' : 'navigation', rule, action: 'blocked' })
        return { block: true, category, reason: `${hostOf(n.url)} is a known ${category === 'ads' ? 'ad' : 'tracking'} server`, rule }
      }
    }
    // Not blocked: the destination's own record stays the current page.
    if (arrivedFirst) {
      const destination = this.pages.get(n.webContentsId)
      if (destination && resourceKey(destination.pageUrl) !== resourceKey(n.url) && page) this.startPage(n.webContentsId, n.url)
    }
    return { block: false }
  }

  report(webContentsId: number): AdBlockPageReport | null {
    const page = this.pages.get(webContentsId)
    if (!page) return null
    return {
      webContentsId,
      pageUrl: page.pageUrl,
      host: hostOf(page.pageUrl),
      siteAllowed: this.siteAllowed(page.pageUrl),
      counts: { ...page.counts },
      hidingRules: page.hidingRules,
      scriptlets: page.scriptlets,
      recent: page.recent.slice(0, 100)
    }
  }

  /** The report for the tab showing `url` (the page open in the browser). */
  reportForUrl(url: string): AdBlockPageReport | null {
    const target = resourceKey(url)
    for (const [id, page] of [...this.pages.entries()].reverse()) if (resourceKey(page.pageUrl) === target) return this.report(id)
    return null
  }
}

/**
 * A generic rule (not anchored to an ad host, not limited to certain sites) matching a site's own script, XHR or frame:
 * possibly advertising, but blocking it risks breaking the site. Standard allows these and records them; Strict blocks.
 */
function isUncertain(request: Request, rule: string | undefined, type: string): boolean {
  if (!rule || !FUNCTIONAL_TYPES.has(type)) return false
  return request.isFirstParty && !rule.startsWith('||') && !/[$,]domain=/.test(rule)
}

/**
 * Hostnames of the lists' popup rules ("||popads.net^$popup"). The matching engine drops the $popup option, so these
 * are compiled into a domain set that the popup check uses instead.
 */
export function extractPopupHosts(text: string): string[] {
  const hosts = new Set<string>()
  for (const raw of text.split('\n')) {
    const match = /^\|\|([a-z0-9.-]+\.[a-z]{2,})\^?\$([^#]*)$/i.exec(raw.trim())
    if (!match) continue
    const options = match[2].toLowerCase().split(',')
    // Only plain popup rules: rules limited to certain sites, or exceptions, need the full engine.
    if (options.includes('popup') && !options.some((o) => o.startsWith('domain=') || o.startsWith('~popup'))) hosts.add(match[1].toLowerCase())
  }
  return [...hosts]
}

function countSelectors(css: string): number {
  return css
    .split('}')
    .filter((block) => block.includes('{'))
    .reduce((n, block) => n + block.split('{')[0].split(',').filter((s) => s.trim()).length, 0)
}
