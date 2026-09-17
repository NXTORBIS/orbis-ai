/**
 * The data behind the widgets that read something from outside a single Orbis store: recent sites from history, the
 * time elsewhere, a greeting, the weather and news feeds.
 *
 * Everything here is pure — no network, no Electron — so the rules about what may be shown can be tested on their
 * own. The two rules that matter most:
 *
 *   Nothing is made up. A forecast that did not arrive is "unavailable", not yesterday's temperature presented as
 *   today's; a feed with no items shows no items.
 *
 *   Anything from outside arrives as text and leaves as text. A feed is somebody else's writing, and it is never
 *   given the chance to become markup in the new tab: tags are stripped, entities decoded, scripts dropped whole,
 *   and only http and https links survive.
 */

// ---------------------------------------------------------------- recent sites

export interface RecentSite {
  url: string
  title: string
  host: string
  visitedAt: number
}

/**
 * The sites visited most recently, one entry per site.
 *
 * History holds every page; a person looking for "where was I" wants places, so the newest page of each host stands
 * for it. Orbis's own pages are not places anyone went, and are left out.
 */
export function recentSites(history: { url: string; title: string; visitedAt: number }[], limit = 6): RecentSite[] {
  const seen = new Set<string>()
  const out: RecentSite[] = []
  for (const entry of [...history].sort((a, b) => b.visitedAt - a.visitedAt)) {
    const host = hostOf(entry.url)
    if (!host || seen.has(host)) continue
    seen.add(host)
    out.push({ url: entry.url, title: entry.title.trim() || host, host, visitedAt: entry.visitedAt })
    if (out.length >= limit) break
  }
  return out
}

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- greeting

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/** From the hour on the person's own clock, which is the only one that means anything to them. */
export function partOfDay(date: Date): PartOfDay {
  const hour = date.getHours()
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

export function greeting(date: Date, name?: string): string {
  const said = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good night' }[partOfDay(date)]
  const who = (name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
  return who ? `${said}, ${who}` : said
}

// ---------------------------------------------------------------- world clock

export interface WorldClock {
  label: string
  zone: string
}

/** Whether this computer knows the time zone. A zone it does not know is not guessed at. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Reads "Chennai=Asia/Kolkata, London=Europe/London" into clocks.
 *
 * One line a person can type into a settings box. A zone written without a label is labelled by its city part; one
 * the computer does not recognise is reported rather than silently dropped, so a typo is visible.
 */
export function parseWorldClocks(text: string, max = 8): { clocks: WorldClock[]; unknown: string[] } {
  const clocks: WorldClock[] = []
  const unknown: string[] = []
  for (const part of text.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean)) {
    const [left, right] = part.includes('=') ? part.split('=', 2).map((p) => p.trim()) : [undefined, part]
    const zone = right ?? ''
    if (!isTimeZone(zone)) {
      unknown.push(zone || part)
      continue
    }
    const label = (left || zone.split('/').pop() || zone).replace(/_/g, ' ').slice(0, 30)
    clocks.push({ label, zone })
    if (clocks.length >= max) break
  }
  return { clocks, unknown }
}

/** The time in a zone, in the person's own locale and 12- or 24-hour preference. */
export function timeIn(zone: string, date: Date, hour12: boolean): { time: string; day: string; offsetFromHere: number } {
  const time = new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12 }).format(date)
  const day = new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short' }).format(date)
  return { time, day, offsetFromHere: zoneOffsetMinutes(zone, date) + date.getTimezoneOffset() }
}

/** Minutes the zone is ahead of UTC at this instant, so daylight saving is whatever it really is today. */
export function zoneOffsetMinutes(zone: string, date: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(date)
      .map((p) => [p.type, p.value])
  )
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute))
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000)
}

// ---------------------------------------------------------------- weather

export interface Weather {
  place: string
  /** When MET Norway made the forecast, not when Orbis fetched it. */
  updatedAt: number
  now: { temperature: number; humidity?: number; windSpeed?: number; condition: string; symbol: string }
  /** Over the next 24 hours of the forecast, which is what "today's high and low" honestly is from a forecast. */
  high?: number
  low?: number
  hours: { at: number; temperature: number; symbol: string; condition: string }[]
  /** Required by the licence, and shown. */
  attribution: string
}

/**
 * Words for MET Norway's symbol codes. The code is what they publish; the words are ours.
 * "partlycloudy_day" and "partlycloudy_night" say the same thing about the sky.
 */
const SKY: Record<string, string> = {
  clearsky: 'Clear',
  fair: 'Mostly clear',
  partlycloudy: 'Partly cloudy',
  cloudy: 'Cloudy',
  fog: 'Fog',
  lightrain: 'Light rain',
  rain: 'Rain',
  heavyrain: 'Heavy rain',
  lightrainshowers: 'Light showers',
  rainshowers: 'Showers',
  heavyrainshowers: 'Heavy showers',
  lightsleet: 'Light sleet',
  sleet: 'Sleet',
  heavysleet: 'Heavy sleet',
  lightsleetshowers: 'Light sleet showers',
  sleetshowers: 'Sleet showers',
  heavysleetshowers: 'Heavy sleet showers',
  lightsnow: 'Light snow',
  snow: 'Snow',
  heavysnow: 'Heavy snow',
  lightsnowshowers: 'Light snow showers',
  snowshowers: 'Snow showers',
  heavysnowshowers: 'Heavy snow showers'
}

export function skyWords(symbol: string): string {
  const base = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (SKY[base]) return SKY[base]
  if (base.includes('thunder')) return `${SKY[base.replace('andthunder', '')] ?? 'Rain'} and thunder`
  return 'Unknown'
}

interface MetSeries {
  time: string
  data: {
    instant?: { details?: { air_temperature?: number; relative_humidity?: number; wind_speed?: number } }
    next_1_hours?: { summary?: { symbol_code?: string } }
    next_6_hours?: { summary?: { symbol_code?: string } }
    next_12_hours?: { summary?: { symbol_code?: string } }
  }
}

/**
 * Reads a MET Norway locationforecast/2.0 "compact" answer.
 *
 * Returns nothing rather than a partial forecast when the shape is wrong: a widget showing a temperature it could not
 * actually read would be worse than one saying the weather is unavailable.
 */
export function readMetForecast(body: unknown, place: string, now = Date.now()): Weather | null {
  const root = body as { properties?: { meta?: { updated_at?: string }; timeseries?: MetSeries[] } } | null
  const series = root?.properties?.timeseries
  if (!Array.isArray(series) || !series.length) return null

  const usable = series
    .map((s) => ({ at: Date.parse(s.time), s }))
    .filter((x) => Number.isFinite(x.at) && typeof x.s.data?.instant?.details?.air_temperature === 'number')
    .sort((a, b) => a.at - b.at)
  if (!usable.length) return null

  // The reading for "now" is the latest one that has started, or the first if none has yet.
  const current = [...usable].reverse().find((x) => x.at <= now) ?? usable[0]
  const symbolOf = (s: MetSeries): string => s.data.next_1_hours?.summary?.symbol_code ?? s.data.next_6_hours?.summary?.symbol_code ?? s.data.next_12_hours?.summary?.symbol_code ?? ''
  const details = current.s.data.instant!.details!

  const day = usable.filter((x) => x.at >= current.at && x.at < current.at + 24 * 3_600_000)
  const temps = day.map((x) => x.s.data.instant!.details!.air_temperature!)
  const symbol = symbolOf(current.s)

  return {
    place,
    updatedAt: Date.parse(root?.properties?.meta?.updated_at ?? '') || current.at,
    now: {
      temperature: round1(details.air_temperature!),
      humidity: typeof details.relative_humidity === 'number' ? Math.round(details.relative_humidity) : undefined,
      windSpeed: typeof details.wind_speed === 'number' ? round1(details.wind_speed) : undefined,
      condition: symbol ? skyWords(symbol) : 'Unknown',
      symbol
    },
    high: temps.length ? round1(Math.max(...temps)) : undefined,
    low: temps.length ? round1(Math.min(...temps)) : undefined,
    hours: usable
      .filter((x) => x.at > current.at && symbolOf(x.s))
      .slice(0, 6)
      .map((x) => ({ at: x.at, temperature: round1(x.s.data.instant!.details!.air_temperature!), symbol: symbolOf(x.s), condition: skyWords(symbolOf(x.s)) })),
    attribution: 'Weather data from MET Norway (CC BY 4.0)'
  }
}

/** The person's own unit. Stored and computed in Celsius, as MET Norway publishes it. */
export function temperatureIn(celsius: number, unit: 'c' | 'f'): string {
  return unit === 'f' ? `${Math.round((celsius * 9) / 5 + 32)}°F` : `${Math.round(celsius)}°C`
}

/** Reads a Nominatim search answer into one place, or nothing. */
export function readPlace(body: unknown): { name: string; lat: number; lon: number } | null {
  const first = Array.isArray(body) ? (body[0] as { lat?: string; lon?: string; display_name?: string; name?: string } | undefined) : undefined
  if (!first) return null
  const lat = Number(first.lat)
  const lon = Number(first.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  const name = (first.name || first.display_name?.split(',')[0] || '').trim()
  // MET Norway asks for no more than four decimals, which is also plenty to find a city by.
  return { name: name.slice(0, 80), lat: round4(lat), lon: round4(lon) }
}

// ---------------------------------------------------------------- news feeds

export interface FeedItem {
  title: string
  url: string
  /** The feed's name, so a headline always says where it came from. */
  source: string
  publishedAt?: number
}

export interface Feed {
  title: string
  items: FeedItem[]
}

/**
 * Reads RSS 2.0 or Atom into plain headlines.
 *
 * Deliberately not an XML DOM: there is none in the main process, and none is needed to pull a title and a link out of
 * each item. What comes out is text and one link. Everything that could carry behaviour — tags, scripts, CDATA-wrapped
 * markup, javascript: or data: links — is stripped or refused here, before it can go anywhere near the page.
 */
export function parseFeed(xml: string, fallbackName: string, limit = 20): Feed | null {
  if (typeof xml !== 'string' || !/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) return null
  const atom = /<feed[\s>]/i.test(xml.slice(0, 2000))
  const channel = xml.replace(/<(item|entry)[\s>][\s\S]*$/i, '')
  const title = plainText(firstTag(channel, 'title')) || fallbackName

  const blocks = xml.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? []
  const items: FeedItem[] = []
  for (const block of blocks) {
    const heading = plainText(firstTag(block, 'title'))
    const link = atom ? atomLink(block) : plainText(firstTag(block, 'link')) || plainText(firstTag(block, 'guid'))
    const url = safeLink(link)
    if (!heading || !url) continue
    const date = firstTag(block, atom ? 'updated' : 'pubDate') || firstTag(block, 'published') || firstTag(block, 'dc:date')
    const at = Date.parse(plainText(date))
    items.push({ title: heading.slice(0, 300), url, source: title.slice(0, 80), publishedAt: Number.isFinite(at) ? at : undefined })
    if (items.length >= limit) break
  }
  return { title: title.slice(0, 80), items }
}

function firstTag(xml: string, name: string): string {
  const escaped = name.replace(':', '\\:')
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, 'i'))
  return match ? match[1] : ''
}

function atomLink(block: string): string {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1])
  const pick = links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel=/i.test(attrs)) ?? links[0]
  return pick?.match(/href=["']([^"']+)["']/i)?.[1] ?? ''
}

/** Text only: CDATA unwrapped, scripts and styles dropped with their contents, every other tag removed, entities decoded. */
export function plainText(value: string): string {
  return decodeEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    // Decoding can produce angle brackets from &lt;script&gt;; they are text now, but there is no reason to keep them
    // looking like markup to anything downstream that is less careful than React.
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
    }
    return NAMED[code.toLowerCase()] ?? all
  })
}

/** Only an http or https address becomes a link. Anything else — javascript:, data:, file: — is not a headline. */
export function safeLink(value: string): string | null {
  const text = decodeEntities(value.trim())
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

/** Reads the feeds setting: addresses separated by commas or new lines, only http and https, at most eight. */
export function parseFeedList(text: string, max = 8): string[] {
  const out: string[] = []
  for (const part of text.split(/[,\s]+/).filter(Boolean)) {
    const url = safeLink(part)
    if (url && !out.includes(url)) out.push(url)
    if (out.length >= max) break
  }
  return out
}

/** Items from several feeds, newest first, with undated items after dated ones rather than guessed into place. */
export function mergeFeeds(feeds: Feed[], limit: number): FeedItem[] {
  const seen = new Set<string>()
  return feeds
    .flatMap((f) => f.items)
    .filter((item) => (seen.has(item.url) ? false : (seen.add(item.url), true)))
    .sort((a, b) => (b.publishedAt ?? -Infinity) - (a.publishedAt ?? -Infinity))
    .slice(0, limit)
}

// ---------------------------------------------------------------- how old

/** "just now", "12 minutes ago", "3 hours ago" — so cached data always says how cached it is. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} days ago`
}

const round1 = (n: number): number => Math.round(n * 10) / 10
const round4 = (n: number): number => Math.round(n * 10_000) / 10_000
