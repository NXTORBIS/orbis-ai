import { parseRequest, type Constraints, type ListeningIntent } from './intent.ts'
import type { CanonicalTrack } from './identity.ts'
import type { ProviderQuery, SearchResult } from './provider.ts'

/**
 * Searching for music, in the way people actually ask.
 *
 * Two kinds of search arrive at the same box and must not be confused:
 *
 *   - **a name.** "Blinding Lights", "The Weeknd", "After Hours". This is a lookup, and the answer is rows.
 *   - **a description.** "calm Tamil songs I haven't heard", "something like this but slower". This is a request,
 *     and the answer is a *selection* -- which means the words have to become constraints the engine can enforce.
 *
 * Telling them apart is the whole job of this file. Treating a description as a literal string finds nothing and
 * reads as a broken search; treating a name as a description throws the name away and plays something unrelated.
 *
 * Nothing here invents a result. It produces a query and a set of constraints; what comes back is whatever the
 * providers and the ranking engine genuinely have.
 */

export interface ParsedSearch {
  /** What to look up, with the describing words taken out. Empty when the whole thing was a description. */
  text: string
  /** What was asked for, when anything was. */
  constraints: Constraints
  intent: ListeningIntent
  /** Which words Orbis could not read, so it can say so rather than quietly ignoring them. */
  notUnderstood: readonly string[]
  /** How much of this was a description rather than a name. 0 is a pure lookup, 1 a pure request. */
  described: number
  filters: Filters
}

export interface Filters {
  /** Only tracks the student has, or has not, heard. */
  heard?: 'heard' | 'unheard'
  year?: { from?: number; to?: number }
  language?: string
  artist?: string
  album?: string
  genre?: string
  favourite?: boolean
  /** Only what is in the library, or only what is not. */
  inLibrary?: boolean
  /** Only what can actually be played. */
  playable?: boolean
  minDuration?: number
  maxDuration?: number
  energy?: { from?: number; to?: number }
  tempo?: { from?: number; to?: number }
}

/** Words that mean the student is describing rather than naming. */
const DESCRIBING = /\b(something|anything|songs?|music|tracks?|like|similar|more|less|calm|calmer|energetic|chill|sad|happy|dark|darker|upbeat|slow|slower|fast|faster|loud|quiet|instrumental|vocal|new|fresh|old|familiar|unheard|heard|discover|surprise|random|workout|running|study|focus|focused|sleep|sleepy|party|relax|relaxing|background|driving|nostalgic|from the|haven'?t|have not|never|again|vibe|mood|playlist|mix|minutes?|hours?|hour)\b/gi

/** A year, a decade, or a range of them. */
const YEARS = /\b(?:from\s+)?(?:the\s+)?(19|20)(\d0)s\b|\b(19|20)\d{2}\b/g

/**
 * What somebody typed, read.
 *
 * `plain` strips the describing words to leave a name, and `described` reports how much was taken out -- which is
 * what lets the interface show a "top result" for a lookup and a selection for a request without guessing.
 */
export function parseSearch(said: string, now = Date.now()): ParsedSearch {
  const raw = (said ?? '').trim()
  if (!raw) return { text: '', constraints: {}, intent: 'unspecified', notUnderstood: [], described: 0, filters: {} }

  const request = parseRequest(raw, now)
  const describing = raw.match(DESCRIBING) ?? []
  const years = raw.match(YEARS) ?? []

  // The name is what is left once the describing words and the numbers are gone.
  const text = raw
    .replace(DESCRIBING, ' ')
    .replace(YEARS, ' ')
    .replace(/\b(in|for|by|with|and|the|a|an|of|to|that|me|my|i)\b/gi, ' ')
    .replace(/[^\p{L}\p{N}\s'&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words = raw.split(/\s+/).filter(Boolean).length
  const described = words === 0 ? 0 : Math.min(1, (describing.length + years.length) / words)

  return {
    text,
    constraints: request.intent.constraints,
    intent: request.intent.intent,
    notUnderstood: request.notUnderstood,
    described,
    filters: filtersFrom(raw, request.intent.constraints)
  }
}

/** The narrowings in what was said, as something retrieval can apply. */
export function filtersFrom(said: string, constraints: Constraints): Filters {
  const raw = (said ?? '').toLowerCase()
  const out: Filters = {}

  if (constraints.heard === 'only-new') out.heard = 'unheard'
  else if (constraints.heard === 'only-known') out.heard = 'heard'
  else if (/\b(haven'?t|have not|never)\s+(heard|played|listened)|\bunheard\b|\bnew to me\b/.test(raw)) out.heard = 'unheard'
  else if (/\b(i|i've|ive)\s+(heard|played|know)\b|\bfamiliar\b|\balready\b/.test(raw)) out.heard = 'heard'

  const decade = /\b(?:from\s+)?(?:the\s+)?(19|20)(\d)0s\b/.exec(raw)
  if (decade) {
    const from = Number(`${decade[1]}${decade[2]}0`)
    out.year = { from, to: from + 9 }
  } else {
    const year = /\b(19\d{2}|20\d{2})\b/.exec(raw)
    if (year) out.year = { from: Number(year[1]), to: Number(year[1]) }
  }

  // A language arrives as an "only this" constraint rather than a field of its own.
  const language = (constraints.only ?? []).find((one) => one.dimension === 'language')
  if (language && language.values.length > 0) out.language = language.values[0]
  const artist = (constraints.only ?? []).find((one) => one.dimension === 'artist')
  if (artist && artist.values.length > 0) out.artist = artist.values[0]
  if (/\bfavourites?\b|\bfavorites?\b|\bloved\b|\bliked\b/.test(raw)) out.favourite = true
  if (/\binstrumental\b/.test(raw)) out.genre = undefined
  if (/\bmy (music|library|songs)\b|\bon this computer\b|\blocal\b/.test(raw)) out.inLibrary = true

  /*
   * Energy and tempo arrive as a target and a direction, and a filter needs a range.
   *
   * "Calmer" is a direction with no target, so it becomes an upper bound; "about this energetic" is a target, so
   * it becomes a band either side of it. Nothing is invented: a request with neither leaves the filter alone.
   */
  if (constraints.energy) out.energy = bandFrom(constraints.energy)
  if (constraints.tempo) out.tempo = constraints.tempo.target !== undefined ? { from: constraints.tempo.target - 12, to: constraints.tempo.target + 12 } : undefined
  return out
}

/** A target and a direction turned into the range a filter can use. */
function bandFrom(one: { target?: number; direction?: 'up' | 'down' | 'steady' }): { from?: number; to?: number } | undefined {
  if (one.target !== undefined) return { from: Math.max(0, one.target - 0.15), to: Math.min(1, one.target + 0.15) }
  if (one.direction === 'down') return { to: 0.45 }
  if (one.direction === 'up') return { from: 0.6 }
  return undefined
}

/** The query handed to the providers. Narrowings they can do themselves are passed on. */
export function queryFor(parsed: ParsedSearch, limit = 60): ProviderQuery {
  return {
    text: parsed.text || '',
    limit,
    year: parsed.filters.year,
    language: parsed.filters.language,
    artist: parsed.filters.artist,
    album: parsed.filters.album
  }
}

// ---------------------------------------------------------------- what comes back, arranged

export interface SearchRow {
  canonical: CanonicalTrack
  from: string
  playable: boolean
  source: string | null
  artwork: string | null
  /** True when this exact recording is already in the library. */
  inLibrary: boolean
  libraryId: string | null
  favourite: boolean
  /** How many times it has been played, from the student's own history. */
  plays: number
}

export interface ArrangedSearch {
  /** The one row that is almost certainly what was meant. Null when nothing stands out. */
  top: SearchRow | null
  tracks: readonly SearchRow[]
  artists: SearchResult['artists']
  albums: SearchResult['albums']
  inLibrary: readonly SearchRow[]
  /** Set when there is nothing to show, with the reason. */
  empty: { title: string; detail: string; retry: boolean } | null
  asked: SearchResult['asked']
}

/**
 * Which row is the one somebody meant.
 *
 * A top result is only offered when one row is clearly ahead: an exact title match, or something already in the
 * library and played before. Showing a "top result" that is merely the first row is how a search comes to feel
 * arbitrary, so when nothing stands out there is no top result at all.
 */
export function topOf(rows: readonly SearchRow[], text: string): SearchRow | null {
  const wanted = text.trim().toLowerCase()
  if (!wanted || rows.length === 0) return null
  const score = (row: SearchRow): number => {
    const title = row.canonical.name.toLowerCase()
    const artist = row.canonical.artist.toLowerCase()
    let value = 0
    if (title === wanted) value += 100
    else if (title.startsWith(wanted)) value += 60
    else if (title.includes(wanted)) value += 30
    if (artist === wanted) value += 70
    else if (artist.includes(wanted)) value += 20
    if (row.inLibrary) value += 14
    if (row.favourite) value += 10
    value += Math.min(20, row.plays * 2)
    if (!row.playable) value -= 25
    /*
     * A plain name means the original.
     *
     * The display name has the bracket stripped, so "Blinding Lights" and "Blinding Lights (Remix)" both match the
     * typed words exactly -- and without this they tie, no row stands out, and the search offers no top result for
     * the most obvious search there is. Somebody who wants the remix types the word.
     */
    const asked = /\b(live|acoustic|remix|instrumental|remaster|extended|radio|demo|sped|slowed|clean|explicit)\b/i.test(text)
    if (row.canonical.version.kind === 'original') value += 6
    else if (!asked) value -= 14
    return value
  }
  const ranked = [...rows].sort((a, b) => score(b) - score(a))
  const best = score(ranked[0])
  const second = ranked[1] ? score(ranked[1]) : 0
  return best >= 40 && best - second >= 10 ? ranked[0] : null
}

/** The filters applied to rows, for the parts no provider could do itself. */
export function applyFilters(rows: readonly SearchRow[], filters: Filters): SearchRow[] {
  return rows.filter((row) => {
    if (filters.heard === 'unheard' && row.plays > 0) return false
    if (filters.heard === 'heard' && row.plays === 0) return false
    if (filters.favourite && !row.favourite) return false
    if (filters.inLibrary !== undefined && row.inLibrary !== filters.inLibrary) return false
    if (filters.playable && !row.playable) return false
    const seconds = row.canonical.duration
    if (seconds !== null) {
      if (filters.minDuration !== undefined && seconds < filters.minDuration) return false
      if (filters.maxDuration !== undefined && seconds > filters.maxDuration) return false
    }
    const year = row.canonical.year
    if (filters.year && year !== null) {
      if (filters.year.from !== undefined && year < filters.year.from) return false
      if (filters.year.to !== undefined && year > filters.year.to) return false
    }
    return true
  })
}

/** How a search should be written out, with a reason instead of a blank when there is nothing. */
export function arrange(result: SearchResult, rows: readonly SearchRow[], parsed: ParsedSearch, explain: (result: SearchResult, text: string) => { title: string; detail: string; retry: boolean }): ArrangedSearch {
  const filtered = applyFilters(rows, parsed.filters)
  const top = topOf(filtered, parsed.text)
  return {
    top,
    // The top result is not repeated in the list below it.
    tracks: top ? filtered.filter((one) => one !== top) : filtered,
    artists: result.artists,
    albums: result.albums,
    inLibrary: filtered.filter((one) => one.inLibrary),
    empty: filtered.length === 0 && result.artists.length === 0 && result.albums.length === 0 ? explain(result, parsed.text || parsed.intent) : null,
    asked: result.asked
  }
}

// ---------------------------------------------------------------- ways of asking that are not a search box

/**
 * The named ways of exploring, each a real set of constraints rather than a label.
 *
 * "Surprise me" is the one worth stating plainly: it does **not** mean random. It means high novelty with the
 * taste model still enforced -- a student should be pleasantly surprised, not confused by something that has
 * nothing to do with them.
 */
export const EXPLORATIONS: readonly { id: string; label: string; blurb: string; constraints: Constraints; intent: ListeningIntent }[] = [
  { id: 'surprise', label: 'Surprise me', blurb: 'Things you have not heard that still sound like you.', constraints: { heard: 'only-new', discovery: 0.8 }, intent: 'discovery' },
  { id: 'deeper', label: 'Go deeper', blurb: 'Further into what you already like.', constraints: { heard: 'only-new', discovery: 0.55 }, intent: 'genre-exploration' },
  { id: 'familiar', label: 'Familiar', blurb: 'Only things you know.', constraints: { heard: 'only-known', discovery: 0 }, intent: 'familiar' },
  { id: 'forgotten', label: 'Forgotten favourites', blurb: 'Things you loved and have not played for a while.', constraints: { heard: 'only-known', discovery: 0.1 }, intent: 'nostalgia' },
  { id: 'calm', label: 'Calmer', blurb: 'Lower energy, slower.', constraints: { energy: { direction: 'down' } }, intent: 'calm' },
  { id: 'energy', label: 'More energy', blurb: 'Higher energy, faster.', constraints: { energy: { direction: 'up' } }, intent: 'energy' }
]

export function explorationById(id: string): (typeof EXPLORATIONS)[number] | null {
  return EXPLORATIONS.find((one) => one.id === id) ?? null
}

/**
 * "Take me back to 2018", and the like.
 *
 * Only ever reads a year or a decade out of what was said. A phrase like "last summer" is deliberately not guessed
 * at: Orbis does not know what somebody was listening to last summer unless the history says so, and guessing
 * would be inventing.
 */
export function takeMeBack(said: string): { from: number; to: number } | null {
  const raw = (said ?? '').toLowerCase()
  const decade = /\b(19|20)(\d)0s\b/.exec(raw)
  if (decade) {
    const from = Number(`${decade[1]}${decade[2]}0`)
    return { from, to: from + 9 }
  }
  const year = /\b(19\d{2}|20\d{2})\b/.exec(raw)
  return year ? { from: Number(year[1]), to: Number(year[1]) } : null
}
