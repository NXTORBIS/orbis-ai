import type { Feed, Weather } from '../shared/widgetData.ts'
import { parseFeed, readMetForecast, readPlace } from '../shared/widgetData.ts'

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Where the weather and news widgets get what they show.
 *
 * Both are other people's services, used on their terms. MET Norway's forecast API is free for any use including
 * commercial, asks to be identified and cached against, and requires attribution; OpenStreetMap's Nominatim turns a
 * typed city into coordinates, asks for no more than one request a second, and requires attribution. News feeds are
 * whatever addresses the person chose. Nothing here needs a key, and nobody using Orbis is asked for one.
 *
 * Everything is cached. A widget redrawing does not fetch; a new tab opening does not fetch; only data that has gone
 * stale does, and a source that has been failing is left alone for a while rather than asked again every time.
 *
 * What comes back is always one of three honest things: fresh data, cached data with its age, or a reason there is
 * none. Never a guess.
 */

export type Sourced<T> =
  | { ok: true; data: T; fetchedAt: number; stale: boolean }
  | { ok: false; reason: string; retryAfter?: number }

interface Entry<T> {
  data: T
  fetchedAt: number
  expiresAt: number
  lastModified?: string
}

interface Failing {
  count: number
  until: number
}

const WEATHER_TTL = 30 * 60_000
const FEED_TTL = 20 * 60_000
/** The most a feed may be. Headlines do not need more, and a feed that is larger is not a feed worth reading. */
const FEED_MAX_BYTES = 2_000_000
const TIMEOUT = 10_000

export class WidgetFeeds {
  private readonly fetchFn: FetchFn
  private readonly userAgent: string
  private readonly now: () => number
  private readonly places = new Map<string, { name: string; lat: number; lon: number } | null>()
  private readonly forecasts = new Map<string, Entry<Weather>>()
  private readonly feeds = new Map<string, Entry<Feed>>()
  private readonly failing = new Map<string, Failing>()
  private lastGeocode = 0
  private geocodeGate: Promise<void> = Promise.resolve()
  private readonly inFlight = new Map<string, Promise<unknown>>()

  constructor(options: { fetch: FetchFn; appVersion: string; contact?: string; now?: () => number }) {
    this.fetchFn = options.fetch
    this.now = options.now ?? Date.now
    // Both services ask to be told who is calling. A contact is added only when one was configured for this build;
    // nobody's personal address is ever put here.
    this.userAgent = `Orbis/${options.appVersion}${options.contact ? ` (${options.contact})` : ''}`
  }

  // ---------------------------------------------------------------- weather

  async weather(city: string): Promise<Sourced<Weather>> {
    const asked = city.replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!asked) return { ok: false, reason: 'Choose a city in this widget’s settings.' }

    const place = await this.place(asked)
    if (place === 'failed') return this.refused(`place:${asked.toLowerCase()}`, 'The weather service could not be reached.')
    if (!place) return { ok: false, reason: `No place called “${asked}” was found.` }

    const key = `${place.lat},${place.lon}`
    return this.cached(key, this.forecasts, async (previous) => {
      const res = await this.get(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${place.lat}&lon=${place.lon}`, previous?.lastModified)
      if (res.status === 304 && previous) return { ...previous, expiresAt: this.expiry(res, WEATHER_TTL), fetchedAt: this.now() }
      if (!res.ok) throw new SourceError(res.status === 429 ? 'The weather service asked Orbis to slow down.' : `The weather service answered ${res.status}.`, res.status === 429)
      const weather = readMetForecast(await res.json(), place.name || asked, this.now())
      if (!weather) throw new SourceError('The weather service sent a forecast Orbis could not read.')
      return { data: weather, fetchedAt: this.now(), expiresAt: this.expiry(res, WEATHER_TTL), lastModified: res.headers.get('last-modified') ?? undefined }
    })
  }

  /** A city's coordinates, asked for at most once a second, and remembered for as long as Orbis runs. */
  private async place(city: string): Promise<{ name: string; lat: number; lon: number } | null | 'failed'> {
    const key = city.toLowerCase()
    if (this.places.has(key)) return this.places.get(key)!
    if (this.backedOff(`place:${key}`)) return 'failed'

    // One at a time, a second apart, which is what Nominatim asks of every application.
    const turn = this.geocodeGate.then(async () => {
      const wait = this.lastGeocode + 1100 - this.now()
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
      this.lastGeocode = this.now()
    })
    this.geocodeGate = turn.catch(() => undefined)
    await turn

    try {
      const res = await this.get(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(city)}`)
      if (!res.ok) throw new SourceError(`The place search answered ${res.status}.`, res.status === 429)
      const place = readPlace(await res.json())
      this.places.set(key, place)
      this.failing.delete(`place:${key}`)
      return place
    } catch {
      this.noteFailure(`place:${key}`)
      return 'failed'
    }
  }

  // ---------------------------------------------------------------- news

  async feed(url: string): Promise<Sourced<Feed>> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, reason: 'That is not a web address.' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, reason: 'Only web addresses can be feeds.' }
    // A feed on this computer or its network is not news, and fetching one from the main process would let a typed
    // address reach things a web page could not.
    if (isPrivateHost(parsed.hostname)) return { ok: false, reason: 'Feeds have to be on the public web.' }

    return this.cached(parsed.toString(), this.feeds, async (previous) => {
      const res = await this.get(parsed.toString(), previous?.lastModified, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8')
      if (res.status === 304 && previous) return { ...previous, fetchedAt: this.now(), expiresAt: this.now() + FEED_TTL }
      if (!res.ok) throw new SourceError(`The feed answered ${res.status}.`, res.status === 429)
      const length = Number(res.headers.get('content-length'))
      if (Number.isFinite(length) && length > FEED_MAX_BYTES) throw new SourceError('That feed is too large to read.')
      const text = await readCapped(res, FEED_MAX_BYTES)
      if (text === null) throw new SourceError('That feed is too large to read.')
      const feed = parseFeed(text, parsed.hostname)
      if (!feed) throw new SourceError('That address is not an RSS or Atom feed.')
      return { data: feed, fetchedAt: this.now(), expiresAt: this.now() + FEED_TTL, lastModified: res.headers.get('last-modified') ?? undefined }
    })
  }

  // ---------------------------------------------------------------- shared

  /**
   * Fresh when it can be, cached when it cannot, and honest about which.
   *
   * Two widgets asking for the same thing at once share one request. A source that fails keeps its last good data on
   * show, marked stale, and is not asked again until its back-off has passed.
   */
  private async cached<T>(key: string, store: Map<string, Entry<T>>, load: (previous?: Entry<T>) => Promise<Entry<T>>): Promise<Sourced<T>> {
    const previous = store.get(key)
    if (previous && previous.expiresAt > this.now()) return { ok: true, data: previous.data, fetchedAt: previous.fetchedAt, stale: false }
    if (this.backedOff(key)) {
      return previous ? { ok: true, data: previous.data, fetchedAt: previous.fetchedAt, stale: true } : this.refused(key, 'This source has been failing, so Orbis is waiting before asking again.')
    }

    const running = this.inFlight.get(key) as Promise<Entry<T>> | undefined
    const request = running ?? load(previous)
    if (!running) this.inFlight.set(key, request)
    try {
      const entry = await request
      store.set(key, entry)
      this.failing.delete(key)
      return { ok: true, data: entry.data, fetchedAt: entry.fetchedAt, stale: false }
    } catch (err) {
      if (!running) this.noteFailure(key, err instanceof SourceError && err.slowDown)
      const reason = err instanceof SourceError ? err.message : offline(err) ? 'Offline. Orbis will try again when connected.' : 'The source could not be reached.'
      return previous ? { ok: true, data: previous.data, fetchedAt: previous.fetchedAt, stale: true } : { ok: false, reason, retryAfter: this.failing.get(key)?.until }
    } finally {
      if (!running) this.inFlight.delete(key)
    }
  }

  /**
   * One request, following redirects by hand.
   *
   * Letting fetch follow them would let a public feed address bounce to 127.0.0.1 or a router's admin page, and the
   * check that refused a private address typed in directly would never see it. Every hop is checked the same way.
   */
  private async get(url: string, ifModifiedSince?: string, accept = 'application/json'): Promise<Response> {
    let at = url
    for (let hop = 0; hop <= 4; hop++) {
      const res = await this.fetchFn(at, {
        headers: { 'User-Agent': this.userAgent, Accept: accept, ...(ifModifiedSince ? { 'If-Modified-Since': ifModifiedSince } : {}) },
        signal: AbortSignal.timeout(TIMEOUT),
        redirect: 'manual'
      })
      const location = res.status >= 300 && res.status < 400 && res.status !== 304 ? res.headers.get('location') : null
      if (!location) return res
      const next = new URL(location, at)
      if ((next.protocol !== 'http:' && next.protocol !== 'https:') || isPrivateHost(next.hostname)) {
        throw new SourceError('That address redirects somewhere Orbis will not fetch from.')
      }
      at = next.toString()
    }
    throw new SourceError('That address redirects too many times.')
  }

  /** MET Norway says when a forecast expires; that is honoured, within reason. */
  private expiry(res: Response, fallback: number): number {
    const expires = Date.parse(res.headers.get('expires') ?? '')
    const now = this.now()
    return Number.isFinite(expires) ? Math.min(now + 6 * 3_600_000, Math.max(now + 5 * 60_000, expires)) : now + fallback
  }

  /** One minute, then two, four, eight — up to an hour. Longer when the source asked Orbis to slow down. */
  private noteFailure(key: string, slowDown = false): void {
    const count = (this.failing.get(key)?.count ?? 0) + 1
    const wait = Math.min(60 * 60_000, 60_000 * 2 ** (count - 1)) * (slowDown ? 4 : 1)
    this.failing.set(key, { count, until: this.now() + wait })
  }

  private backedOff(key: string): boolean {
    return (this.failing.get(key)?.until ?? 0) > this.now()
  }

  private refused<T>(key: string, reason: string): Sourced<T> {
    return { ok: false, reason, retryAfter: this.failing.get(key)?.until }
  }
}

class SourceError extends Error {
  readonly slowDown: boolean
  constructor(message: string, slowDown = false) {
    super(message)
    this.slowDown = slowDown
  }
}

function offline(err: unknown): boolean {
  const text = String((err as { message?: string; cause?: { code?: string } })?.cause?.code ?? (err as Error)?.message ?? '')
  return /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|fetch failed/i.test(text)
}

/** Reads a body up to a limit, and gives up rather than holding a runaway response in memory. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return (await res.text()).slice(0, max)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Addresses that belong to this computer or a private network, which a feed has no reason to be on. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (h === '::1' || h === '0.0.0.0' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!v4) return false
  const [a, b] = [Number(v4[1]), Number(v4[2])]
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)
}
