/**
 * Orbis's specialized search categories, and what comes back from them.
 *
 * Orbis searches the web one way and searches images, videos, news, maps, music, science, files and social media
 * another. The two are kept apart on purpose: ordinary web search stays on the provider it has always used, and the
 * specialized categories go through an aggregation layer that queries each kind of source properly — an image API for
 * images, a scholarly API for papers, a map service for places.
 *
 * This file knows nothing about how that aggregation layer works or where it lives. It knows what a category is, what
 * a result of each kind looks like, and how to turn what comes back into something Orbis can draw. Anything that does
 * not arrive is simply absent: a result never gains a thumbnail, a duration or an author it did not come with.
 *
 * Pure — no network, no browser.
 */

/** The categories that go to the specialized provider. Ordinary web search is not one of them. */
export type SpecializedCategory = 'images' | 'videos' | 'news' | 'maps' | 'music' | 'science' | 'files' | 'social'

export const SPECIALIZED_CATEGORIES: SpecializedCategory[] = ['images', 'videos', 'news', 'maps', 'music', 'science', 'files', 'social']

/** What each Orbis category is called by the aggregation layer. */
export const PROVIDER_CATEGORY: Record<SpecializedCategory, string> = {
  images: 'images',
  videos: 'videos',
  news: 'news',
  maps: 'map',
  music: 'music',
  science: 'science',
  files: 'files',
  social: 'social media'
}

export function isSpecialized(value: string): value is SpecializedCategory {
  return (SPECIALIZED_CATEGORIES as string[]).includes(value)
}

/**
 * One specialized result.
 *
 * Every field beyond a title and an address is optional because every one of them is optional in reality: an image
 * with no dimensions, a video with no duration, a paper with no date. A missing field is left out rather than filled
 * in, so nothing on screen is ever something Orbis made up.
 */
export interface SpecializedResult {
  kind: SpecializedCategory
  title: string
  url: string
  /** The site it came from, as a person would say it. */
  site: string
  snippet?: string
  /** A small picture to show for it. */
  thumbnail?: string
  /** The full-size image, for an image result. */
  image?: string
  width?: number
  height?: number
  /** Seconds, for something that plays. */
  durationSec?: number
  /** A player that may legitimately be embedded, when the source offers one. */
  embed?: string
  /** Sound, for a music result the source offers directly. */
  audio?: string
  /** Who made it: a channel, an author, an artist. */
  author?: string
  /** Who published it: a newspaper, a journal. */
  publisher?: string
  /** YYYY-MM-DD. Absent when the source states none; never guessed. */
  published?: string
  /** Where it is, for a place. */
  address?: string
  latitude?: number
  longitude?: number
  /** Which engine found it, kept because several of them ask to be credited. */
  via: string
}

/** What one search of one category produced. */
export interface SpecializedOutcome {
  category: SpecializedCategory
  query: string
  results: SpecializedResult[]
  /** Engines that did not answer. Named, so a thin page is explained rather than mysterious. */
  unavailable: string[]
  /** Why there is nothing, when there is nothing. */
  problem: string | null
  tookMs: number
}

// ---------------------------------------------------------------- reading what came back

const text = (value: unknown, max = 500): string | undefined => {
  if (typeof value !== 'string') return undefined
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean && clean !== 'None' ? clean.slice(0, max) : undefined
}

const number = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) ? n : undefined
}

/** Only http(s). A result addressed by anything else is not something Orbis will open. */
const webUrl = (value: unknown): string | undefined => {
  const raw = text(value, 2000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

export const siteOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./i, '')
  } catch {
    return url
  }
}

/** A date the source stated, as YYYY-MM-DD. Anything unparseable is left out rather than guessed at. */
const isoDate = (value: unknown): string | undefined => {
  const raw = text(value, 60)
  if (!raw) return undefined
  const time = Date.parse(raw)
  if (!Number.isFinite(time)) return undefined
  const year = new Date(time).getUTCFullYear()
  if (year < 1800 || year > new Date().getUTCFullYear() + 1) return undefined
  return new Date(time).toISOString().slice(0, 10)
}

/** Where a place is. The aggregation layer gives a GeoJSON point: longitude first, which is easy to get backwards. */
function coordinates(raw: Record<string, unknown>): { latitude?: number; longitude?: number } {
  const geo = raw.geojson as { type?: string; coordinates?: unknown } | undefined
  const pair = Array.isArray(geo?.coordinates) ? geo.coordinates : null
  if (!pair || pair.length < 2) return {}
  const longitude = number(pair[0])
  const latitude = number(pair[1])
  if (latitude === undefined || longitude === undefined) return {}
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return {}
  return { latitude, longitude }
}

/** An address given as its parts, said the way an address is said. */
function addressOf(raw: Record<string, unknown>): string | undefined {
  const flat = text(raw.address)
  const parts = raw.address as Record<string, unknown> | undefined
  if (!parts || typeof parts !== 'object' || Array.isArray(parts)) return flat
  const said = ['house_number', 'road', 'locality', 'postcode', 'country']
    .map((key) => text(parts[key], 80))
    .filter(Boolean)
    .join(', ')
  return said || text(parts.name, 120)
}

/**
 * One result from the aggregation layer, as Orbis holds it.
 *
 * Returns null when there is nothing worth showing — no address to open, or no name to show it under. A half-result is
 * worse than one fewer result.
 */
export function readResult(raw: unknown, kind: SpecializedCategory): SpecializedResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  const image = webUrl(r.img_src)
  // An image result is the picture: its own address is the page it sits on, and the picture is what is shown.
  const url = webUrl(r.url) ?? (kind === 'images' ? image : undefined)
  if (!url) return null

  const title = text(r.title, 300) ?? (kind === 'images' ? siteOf(url) : undefined)
  if (!title) return null

  const engines = Array.isArray(r.engines) ? r.engines.filter((e): e is string => typeof e === 'string') : []
  const via = text(r.engine) ?? engines[0] ?? 'unknown'

  const length = number(r.length)
  const result: SpecializedResult = {
    kind,
    title,
    url,
    site: siteOf(url),
    via,
    ...(text(r.content, 600) ? { snippet: text(r.content, 600) } : {}),
    ...(webUrl(r.thumbnail) ? { thumbnail: webUrl(r.thumbnail) } : {}),
    ...(image ? { image } : {}),
    ...(number(r.img_width) !== undefined ? { width: number(r.img_width) } : {}),
    ...(number(r.img_height) !== undefined ? { height: number(r.img_height) } : {}),
    // A length of zero is no length at all.
    ...(length ? { durationSec: Math.round(length) } : {}),
    ...(webUrl(r.iframe_src) ? { embed: webUrl(r.iframe_src) } : {}),
    ...(webUrl(r.audio_src) ? { audio: webUrl(r.audio_src) } : {}),
    ...(text(r.author, 120) ? { author: text(r.author, 120) } : {}),
    ...(text(r.publisher ?? r.journal, 160) ? { publisher: text(r.publisher ?? r.journal, 160) } : {}),
    ...(isoDate(r.publishedDate) ? { published: isoDate(r.publishedDate) } : {})
  }

  if (kind === 'maps') {
    const where = addressOf(r)
    const { latitude, longitude } = coordinates(r)
    if (where) result.address = where
    if (latitude !== undefined) result.latitude = latitude
    if (longitude !== undefined) result.longitude = longitude
  }

  // An image with no picture to show is not an image result.
  if (kind === 'images' && !result.image && !result.thumbnail) return null
  return result
}

/**
 * A whole answer from the aggregation layer, read into Orbis's own shape.
 *
 * Duplicates are dropped — several engines finding the same thing is one thing — and engines that failed are named
 * rather than quietly ignored, because a category that came back thin should say why.
 */
export function readOutcome(payload: unknown, kind: SpecializedCategory, query: string, tookMs: number, limit = 60): SpecializedOutcome {
  const body = (payload ?? {}) as { results?: unknown; unresponsive_engines?: unknown }
  const rows = Array.isArray(body.results) ? body.results : []

  const seen = new Set<string>()
  const results: SpecializedResult[] = []
  for (const row of rows) {
    const result = readResult(row, kind)
    if (!result) continue
    const key = (result.image ?? result.url).replace(/[#?].*$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    results.push(result)
    if (results.length >= limit) break
  }

  // Reported as [engine, reason] pairs; only the name is worth showing.
  const unavailable = (Array.isArray(body.unresponsive_engines) ? body.unresponsive_engines : [])
    .map((entry) => (Array.isArray(entry) ? text(entry[0], 60) : text(entry, 60)))
    .filter((name): name is string => Boolean(name))

  return {
    category: kind,
    query,
    results,
    unavailable,
    problem: results.length
      ? null
      : unavailable.length
        ? `Nothing came back. ${unavailable.length === 1 ? 'One source' : `${unavailable.length} sources`} could not be reached.`
        : 'Nothing came back for that.',
    tookMs
  }
}

/** A duration said the way a person says it: 3:07, or 1:02:44. */
export function saidDuration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds < 1) return undefined
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
