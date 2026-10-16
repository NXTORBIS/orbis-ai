import { fingerprintOf, type GameResult, type GameSource, type StoredGame } from './model.ts'

/**
 * Finding one game among thousands.
 *
 * A library is only useful if it answers the question that was asked, so everything here is built on one rule: it
 * matches on what is actually stored, and it never fills a gap in. A game whose date nobody wrote down has no date;
 * it is not given today's, it is not sorted as if it were from 1970, and it is not quietly dropped from a list that
 * did not ask about dates. The same goes for a missing name, a missing event and a result nobody recorded
 * (Sections 151-160, 431-440).
 *
 * Three decisions in here are worth reading before trusting the output, because each of them is a judgement a person
 * could reasonably make differently, and all three are made the same way everywhere below:
 *
 *   - **Unknown sorts last, in both directions.** Not first ascending and last descending -- last either way. A
 *     person sorting by date wants the dated games; the ones with no date are the leftovers, and they stay the
 *     leftovers when the arrow is turned round. The alternative -- unknown being "smallest" -- means clicking to
 *     reverse the order fills the top of the screen with games that have nothing to show.
 *
 *   - **A partial date is an interval, not a point.** "2026.??.??" is some day in 2026, so it is included by any
 *     range that overlaps 2026 rather than excluded for not being precise. PGN files are full of these.
 *
 *   - **Two games with the same moves are not automatically the same game.** `compareRecords` says which of the
 *     three it is -- the same game twice, the same moves written up differently, or different games -- and it never
 *     merges anything. Merging is a decision for the person, and it needs to be told exactly what differs.
 *
 * Nothing here knows about Electron, the store or React, so all of it can be tested on its own, which matters most
 * for the parts that only go wrong at scale.
 */

// ---------------------------------------------------------------------------------------------------------------
// Text, folded so that searching works the way a person expects

/**
 * Letters that do not come apart into a letter plus an accent.
 *
 * Unicode's own decomposition handles é, ü, å and the rest: they really are a letter with a mark on it, and dropping
 * the mark leaves the letter. These ones are single letters in their own right with nothing to drop, and they are in
 * the list because they are in chess players' names -- Nepomniachtchi transliterations aside, the Scandinavian ø and
 * the Polish ł come up constantly, and a search for "Nielsen" that misses "Nielsøn" is a search that looks broken.
 */
const SINGLE_LETTERS: [RegExp, string][] = [
  [/ø/g, 'o'], [/æ/g, 'ae'], [/œ/g, 'oe'], [/ß/g, 'ss'], [/ł/g, 'l'], [/đ/g, 'd'], [/ð/g, 'd'],
  [/þ/g, 'th'], [/ħ/g, 'h'], [/ı/g, 'i'], [/ŋ/g, 'n'], [/ſ/g, 's'], [/ẗ/g, 't']
]

/**
 * Text reduced to what a search should match on: lower case, no accents.
 *
 * The order matters. Lower case first, because the single-letter replacements above are written in lower case and Ø
 * would otherwise walk straight past them; then the Unicode decomposition, which splits a letter from its marks; then
 * the marks are dropped.
 */
export function fold(text: string): string {
  let out = text.toLowerCase()
  for (const [from, to] of SINGLE_LETTERS) out = out.replace(from, to)
  return out.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** A name compared as a bag of words, so "Carlsen, Magnus" and "Magnus Carlsen" are one person and not two. */
export function nameKey(name: string): string {
  return fold(name)
    .replace(/[.,'`´-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word !== '')
    .sort()
    .join(' ')
}

// ---------------------------------------------------------------------------------------------------------------
// Dates, which arrive in PGN half-written

export interface GameDate {
  /** Absent when the record does not say, or says something that is not a year. */
  year?: number
  month?: number
  day?: number
  /** What was written, kept so it can be shown back exactly as the source had it. */
  text: string
}

const part = (value: string | undefined, low: number, high: number): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const n = Number.parseInt(value, 10)
  return n >= low && n <= high ? n : undefined
}

/**
 * A PGN date read as far as it goes.
 *
 * "2026.10.16" is a day. "2026.??.??" is a year, which is a real answer and not a broken one -- it is how PGN says
 * "this was 2026 and nobody wrote down when". "????.??.??" says nothing at all, and comes back with no year, which is
 * what everything downstream treats as unknown. The separator varies in the wild, so three are accepted.
 */
export function parseGameDate(written: string | undefined): GameDate {
  const text = (written ?? '').trim()
  if (!text) return { text: '' }
  const bits = text.split(/[.\-/]/)
  const year = part(bits[0], 1, 3000)
  if (year === undefined) return { text }
  const month = part(bits[1], 1, 12)
  const day = month === undefined ? undefined : part(bits[2], 1, 31)
  return { year, ...(month === undefined ? {} : { month }), ...(day === undefined ? {} : { day }), text }
}

const stamp = (year: number, month: number, day: number): number => year * 10_000 + month * 100 + day

/**
 * The window of time a date could mean: the first day it could be, and the last.
 *
 * A full date is a window of one day. A year on its own is a window of a year. This is what makes a range filter
 * honest about a half-written date: the game is shown when it *could* be in the range, because excluding it would be
 * claiming to know something the file never said.
 */
export function dateWindow(date: GameDate): { first: number; last: number } | null {
  if (date.year === undefined) return null
  const first = stamp(date.year, date.month ?? 1, date.day ?? 1)
  const last = stamp(date.year, date.month ?? 12, date.day ?? 31)
  return { first, last }
}

// ---------------------------------------------------------------------------------------------------------------
// Collections, which are tags with a reserved beginning

/**
 * What a collection is.
 *
 * Orbis stores a game's tags and nothing else that groups games, and this module does not get to invent a place to
 * put something new -- there is no collections file and no channel to write one. So a collection is a tag with a
 * reserved beginning, and the two are kept apart everywhere a person sees them: `plainTags` never shows a collection
 * and `collectionsOf` never shows a tag.
 *
 * The honest consequence, which the screen says out loud rather than hiding: a collection travels with the game
 * inside Orbis, because it is stored with the game, but PGN has no tag for it, so saving games to a file does not
 * carry the collections and bringing them back does not restore them.
 */
export const COLLECTION_PREFIX = 'collection:'

export const isCollectionTag = (tag: string): boolean => tag.startsWith(COLLECTION_PREFIX)
export const collectionTag = (name: string): string => `${COLLECTION_PREFIX}${name.trim()}`
export const collectionName = (tag: string): string => tag.slice(COLLECTION_PREFIX.length)

/** The person's own tags on a game: what they typed, without the collections hiding among them. */
export const plainTags = (game: Pick<StoredGame, 'tags'>): string[] => (game.tags ?? []).filter((t) => !isCollectionTag(t))

/** The collections a game is in. */
export const collectionsOf = (game: Pick<StoredGame, 'tags'>): string[] =>
  (game.tags ?? []).filter(isCollectionTag).map(collectionName)

/** Why a tag or collection name cannot be used, or null when it can. */
export function tagProblem(name: string, kind: 'tag' | 'collection' = 'tag'): string | null {
  const text = name.trim()
  if (!text) return 'It needs a name.'
  if (text.length > 60) return 'That is longer than 60 letters.'
  if (kind === 'tag' && isCollectionTag(text)) return `A tag cannot begin with "${COLLECTION_PREFIX}", because that is how a collection is stored.`
  if (kind === 'collection' && text.includes(':')) return 'A collection name cannot contain a colon.'
  return null
}

/**
 * The tag list a game should end up with, after adding some and taking others away.
 *
 * Two games in a selection rarely have the same tags, so a bulk tag has to be worked out per game rather than
 * written over the top. Comparison is case-insensitive, because "Blunders" and "blunders" being two different tags is
 * never what anybody meant; the spelling that was already there is the one that is kept.
 */
export function nextTags(current: string[] | undefined, add: string[] = [], remove: string[] = []): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const gone = new Set(remove.map((t) => fold(t.trim())))
  for (const tag of current ?? []) {
    const text = tag.trim()
    if (!text) continue
    const key = fold(text)
    if (gone.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  for (const tag of add) {
    const text = tag.trim()
    if (!text) continue
    const key = fold(text)
    if (gone.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Searching

/**
 * The fields free text is matched against.
 *
 * Every one of these is a field a `StoredGame` really has, which is the point of writing them out here rather than
 * reaching into whatever happens to be on the object. A search that silently covered nothing -- because the field it
 * read was never populated -- looks exactly like a library with nothing in it.
 */
export const SEARCH_FIELDS = [
  'white', 'black', 'event', 'site', 'round', 'date', 'opening', 'eco', 'termination', 'timeControl', 'variant',
  'tags', 'collections', 'titles'
] as const

interface Prepared {
  text: string
  updatedAt: number
}

/**
 * The folded text of a game, worked out once.
 *
 * Keyed on the game object so nothing has to be invalidated by hand, and checked against `updatedAt` as well,
 * because the store hands back a new object on every change but a caller that edits one in place would otherwise keep
 * a search index describing the game as it used to be.
 */
const prepared = new WeakMap<object, Prepared>()

export function searchText(game: StoredGame): string {
  const had = prepared.get(game)
  if (had && had.updatedAt === game.updatedAt) return had.text
  const m = game.meta
  const pieces = [
    m.white.name, m.black.name, m.white.title, m.black.title, m.event, m.site, m.round, m.date, m.opening, m.eco,
    m.termination, m.timeControl, game.variant, ...(game.tags ?? []).map((t) => (isCollectionTag(t) ? collectionName(t) : t))
  ]
  const text = fold(pieces.filter((one): one is string => typeof one === 'string' && one !== '').join(' \u0001 '))
  prepared.set(game, { text, updatedAt: game.updatedAt })
  return text
}

/**
 * Whether a game matches a typed query.
 *
 * Several words mean all of them: "carlsen 2021 london" is three narrowings, not one phrase, because that is how
 * people type into a box that is filtering a list. A phrase in quotes is matched whole.
 */
export function matchesText(game: StoredGame, query: string): boolean {
  const terms = queryTerms(query)
  if (!terms.length) return true
  const text = searchText(game)
  return terms.every((term) => text.includes(term))
}

/** A query split into the things that all have to match. Quoted runs stay together. */
export function queryTerms(query: string): string[] {
  const folded = fold(query.trim())
  if (!folded) return []
  const terms: string[] = []
  for (const match of folded.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = (match[1] ?? match[2] ?? '').trim()
    if (term) terms.push(term)
  }
  return terms
}

// ---------------------------------------------------------------------------------------------------------------
// Filtering

export type SourceKind = GameSource['kind']

export interface LibraryFilter {
  /** Free text over the fields in `SEARCH_FIELDS`. */
  text?: string
  /** One name, matched against either side. */
  player?: string
  /** One name, matched against that side only. */
  white?: string
  black?: string
  event?: string
  site?: string
  /** A date, as precise as you like: "2021", "2021.07", "2021.07.14". Inclusive at both ends. */
  from?: string
  to?: string
  /** Any of these results. '*' is "no result recorded", which is a real answer here. */
  results?: GameResult[]
  /** Any of these kinds of source -- played here, imported, from a broadcast, set up by hand. */
  sources?: SourceKind[]
  /** Any of these variants. 'standard' unless a file said otherwise. */
  variants?: string[]
  /** Every one of these tags. Collections are asked for separately. */
  tags?: string[]
  /** In any of these collections. */
  collections?: string[]
  /** True for the starred ones only, false for the rest, left out for both. */
  favourite?: boolean
  /** Matched against the opening name and the ECO code together, so "B90" and "Sicilian" both work. */
  opening?: string
  /**
   * Games carrying written notes.
   *
   * Said plainly because it is narrower than it sounds: a stored game holds comments and annotation marks, and that
   * is the only analysis in it. Engine evaluations belong to a study, not to the game record, so this cannot and does
   * not claim to know whether a game has ever been through the engine.
   */
  annotated?: boolean
  minMoves?: number
  maxMoves?: number
}

export const EMPTY_FILTER: LibraryFilter = {}

/** Whether a filter asks anything at all. A filter that asks nothing must never hide a game. */
export function filterIsEmpty(filter: LibraryFilter): boolean {
  return !describeFilter(filter).length
}

const has = (value: string | undefined, want: string): boolean =>
  typeof value === 'string' && fold(value).includes(fold(want))

function matchesDates(game: StoredGame, filter: LibraryFilter): boolean {
  const from = filter.from?.trim() ? parseGameDate(filter.from) : null
  const to = filter.to?.trim() ? parseGameDate(filter.to) : null
  if (!from?.year && !to?.year) return true
  const window = dateWindow(parseGameDate(game.meta.date))
  // No date at all cannot be shown to be in the range, and claiming it is would be inventing one.
  if (!window) return false
  if (from?.year !== undefined) {
    const bound = dateWindow(from)
    if (bound && window.last < bound.first) return false
  }
  if (to?.year !== undefined) {
    const bound = dateWindow(to)
    if (bound && window.first > bound.last) return false
  }
  return true
}

/** Whether one game passes a filter. */
export function matches(game: StoredGame, filter: LibraryFilter): boolean {
  const m = game.meta
  if (filter.text && !matchesText(game, filter.text)) return false
  if (filter.player && !(has(m.white.name, filter.player) || has(m.black.name, filter.player))) return false
  if (filter.white && !has(m.white.name, filter.white)) return false
  if (filter.black && !has(m.black.name, filter.black)) return false
  if (filter.event && !has(m.event, filter.event)) return false
  if (filter.site && !has(m.site, filter.site)) return false
  if (filter.results?.length && !filter.results.includes(m.result)) return false
  if (filter.sources?.length && !filter.sources.includes(game.source.kind)) return false
  if (filter.variants?.length && !filter.variants.includes(game.variant)) return false
  if (filter.favourite !== undefined && (game.favourite === true) !== filter.favourite) return false
  if (filter.opening && !(has(m.opening, filter.opening) || has(m.eco, filter.opening))) return false
  if (filter.minMoves !== undefined && game.moves.length < filter.minMoves) return false
  if (filter.maxMoves !== undefined && game.moves.length > filter.maxMoves) return false
  if (filter.annotated !== undefined && isAnnotated(game) !== filter.annotated) return false
  if (filter.tags?.length) {
    const own = new Set(plainTags(game).map(fold))
    if (!filter.tags.every((tag) => own.has(fold(tag)))) return false
  }
  if (filter.collections?.length) {
    const own = new Set(collectionsOf(game).map(fold))
    if (!filter.collections.some((name) => own.has(fold(name)))) return false
  }
  if (!matchesDates(game, filter)) return false
  return true
}

/** A game carries written notes when any move does. See `LibraryFilter.annotated` for why this is not "analysed". */
export const isAnnotated = (game: Pick<StoredGame, 'moves'>): boolean =>
  game.moves.some((move) => (move.comment !== undefined && move.comment !== '') || (move.nag?.length ?? 0) > 0)

export function filterGames(games: readonly StoredGame[], filter: LibraryFilter): StoredGame[] {
  if (filterIsEmpty(filter)) return [...games]
  return games.filter((game) => matches(game, filter))
}

/** What a filter is asking, in plain words, so a screen can show it and a person can take one part of it off. */
export function describeFilter(filter: LibraryFilter): { key: keyof LibraryFilter; words: string }[] {
  const out: { key: keyof LibraryFilter; words: string }[] = []
  const say = (key: keyof LibraryFilter, words: string): void => out.push({ key, words })
  if (filter.text?.trim()) say('text', `matching "${filter.text.trim()}"`)
  if (filter.player?.trim()) say('player', `either side is ${filter.player.trim()}`)
  if (filter.white?.trim()) say('white', `White is ${filter.white.trim()}`)
  if (filter.black?.trim()) say('black', `Black is ${filter.black.trim()}`)
  if (filter.event?.trim()) say('event', `event is ${filter.event.trim()}`)
  if (filter.site?.trim()) say('site', `place is ${filter.site.trim()}`)
  if (filter.from?.trim()) say('from', `from ${filter.from.trim()}`)
  if (filter.to?.trim()) say('to', `up to ${filter.to.trim()}`)
  if (filter.results?.length) say('results', `result is ${filter.results.map(resultWords).join(' or ')}`)
  if (filter.sources?.length) say('sources', `came from ${filter.sources.map(sourceWords).join(' or ')}`)
  if (filter.variants?.length) say('variants', `variant is ${filter.variants.join(' or ')}`)
  if (filter.tags?.length) say('tags', `tagged ${filter.tags.join(' and ')}`)
  if (filter.collections?.length) say('collections', `in ${filter.collections.join(' or ')}`)
  if (filter.favourite !== undefined) say('favourite', filter.favourite ? 'starred' : 'not starred')
  if (filter.opening?.trim()) say('opening', `opening is ${filter.opening.trim()}`)
  if (filter.annotated !== undefined) say('annotated', filter.annotated ? 'has notes' : 'has no notes')
  if (filter.minMoves !== undefined) say('minMoves', `at least ${filter.minMoves} moves`)
  if (filter.maxMoves !== undefined) say('maxMoves', `at most ${filter.maxMoves} moves`)
  return out
}

/** A filter with one part taken off. */
export function withoutPart(filter: LibraryFilter, key: keyof LibraryFilter): LibraryFilter {
  const next: LibraryFilter = { ...filter }
  delete next[key]
  return next
}

export const resultWords = (result: GameResult): string =>
  result === '1-0' ? 'White won' : result === '0-1' ? 'Black won' : result === '1/2-1/2' ? 'drawn' : 'no result recorded'

export const sourceWords = (kind: SourceKind): string =>
  kind === 'local-engine' ? 'played here against the engine'
    : kind === 'import' ? 'brought in from a file'
      : kind === 'broadcast' ? 'a broadcast'
        : kind === 'custom-position' ? 'set up by hand'
          : 'a study'

// ---------------------------------------------------------------------------------------------------------------
// Sorting

export type SortKey = 'date' | 'player' | 'event' | 'result' | 'updated' | 'created' | 'moves'
export type SortDirection = 'up' | 'down'
export interface SortOrder { key: SortKey; direction: SortDirection }

export const SORT_LABEL: Record<SortKey, string> = {
  date: 'Date played',
  player: 'Player',
  event: 'Event',
  result: 'Result',
  updated: 'Last changed',
  created: 'Added',
  moves: 'Number of moves'
}

export const DEFAULT_ORDER: SortOrder = { key: 'updated', direction: 'down' }

const pad = (n: number, width: number): string => Math.max(0, Math.round(n)).toString().padStart(width, '0')

/**
 * The ordering of results, which has no natural one.
 *
 * White's win, then the draw, then Black's win: the scoreline read from White's side, which is how a crosstable
 * reads. A game with no result recorded is unknown, not a fourth kind of result, so it has no rank at all.
 */
const RESULT_RANK: Record<GameResult, string | null> = { '1-0': '0', '1/2-1/2': '1', '0-1': '2', '*': null }

/**
 * What a game sorts by, as a string that compares the way the value should.
 *
 * Null means the game does not have this -- no date, no name, no result -- and null always goes last. Numbers are
 * zero-padded so that comparing the text compares the number: a move count of 9 has to come before 10, and "9" does
 * not come before "10" unless it is written "000009".
 */
export function rankOf(game: StoredGame, key: SortKey): string | null {
  if (key === 'date') {
    const window = dateWindow(parseGameDate(game.meta.date))
    // The first day the date could mean, so "2021.??.??" lands at the start of 2021 rather than anywhere inside it.
    return window ? pad(window.first, 8) : null
  }
  if (key === 'player') {
    // Whichever name there is. A game that names only Black still sorts by a name rather than falling to the bottom.
    const name = game.meta.white.name ?? game.meta.black.name
    return name ? fold(name) : null
  }
  if (key === 'event') return game.meta.event ? fold(game.meta.event) : null
  if (key === 'result') return RESULT_RANK[game.meta.result]
  if (key === 'updated') return pad(game.updatedAt, 16)
  if (key === 'created') return pad(game.createdAt, 16)
  return pad(game.moves.length, 6)
}

interface Entry { rank: string | null; updatedAt: number; id: string; game: StoredGame }

/**
 * Comparing two games for a sort.
 *
 * The tiebreak is deliberately not affected by the direction. Reversing a sort should turn the list round on the
 * thing being sorted, and leave everything that was equal in the order it already had -- otherwise a list of games
 * from the same event shuffles itself every time somebody clicks the arrow. `id` is last and is unique, so the order
 * is total: two runs over the same games give the same list, which is what makes a page of it worth remembering.
 */
function compareEntries(a: Omit<Entry, 'game'>, b: Omit<Entry, 'game'>, direction: SortDirection): number {
  if (a.rank === null && b.rank !== null) return 1
  if (b.rank === null && a.rank !== null) return -1
  if (a.rank !== null && b.rank !== null && a.rank !== b.rank) {
    const c = a.rank < b.rank ? -1 : 1
    return direction === 'up' ? c : -c
  }
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Games in order.
 *
 * The rank of each game is worked out once rather than inside the comparison, because a sort asks for it about
 * `n log n` times and reading a date out of a string that many times is the difference between a list that appears
 * and a list that stutters.
 */
export function sortGames(games: readonly StoredGame[], order: SortOrder = DEFAULT_ORDER): StoredGame[] {
  const entries: Entry[] = games.map((game) => ({ rank: rankOf(game, order.key), updatedAt: game.updatedAt, id: game.id, game }))
  entries.sort((a, b) => compareEntries(a, b, order.direction))
  return entries.map((one) => one.game)
}

// ---------------------------------------------------------------------------------------------------------------
// Pages that do not move under you

/**
 * Where a page ended, written down so the next page can start from the same place.
 *
 * Counting -- "give me games 51 to 100" -- is the obvious way to page a list and it is wrong here for a reason that
 * shows up the moment the library is being used rather than looked at: delete the first ten games and everything
 * shifts up ten places, so the second page now begins ten games earlier and ten games have been skipped past without
 * ever being seen. Importing a file does the same thing in the other direction, showing ten games twice.
 *
 * A cursor is the sort position itself, not an index, so it keeps meaning the same place when the list changes
 * around it. It survives the record it came from being deleted, because it holds that record's sort key rather than
 * a reference to it.
 */
export interface LibraryCursor {
  rank: string | null
  updatedAt: number
  id: string
}

export const cursorOf = (game: StoredGame, order: SortOrder): LibraryCursor => ({
  rank: rankOf(game, order.key),
  updatedAt: game.updatedAt,
  id: game.id
})

export interface LibraryPage {
  games: StoredGame[]
  /** How many games in the sorted list come before this page. */
  start: number
  total: number
  /** Where to carry on from, or null when this is the end. */
  nextCursor: LibraryCursor | null
  more: boolean
}

/** The first game that sorts after the cursor, found by halving the list rather than walking it. */
function firstAfter(sorted: readonly StoredGame[], cursor: LibraryCursor, order: SortOrder): number {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    const game = sorted[mid]
    const entry = { rank: rankOf(game, order.key), updatedAt: game.updatedAt, id: game.id }
    // Strictly after: the game the cursor names is the last of the previous page and must not be shown twice.
    if (compareEntries(entry, cursor, order.direction) > 0) high = mid
    else low = mid + 1
  }
  return low
}

/**
 * One page of an already sorted list.
 *
 * `sorted` has to have come out of `sortGames` with this same order, or the halving above is looking at a list that
 * is not in the order it assumes and the answer means nothing.
 */
export function pageFrom(
  sorted: readonly StoredGame[],
  o: { size: number; cursor?: LibraryCursor | null; order?: SortOrder }
): LibraryPage {
  const order = o.order ?? DEFAULT_ORDER
  const size = Math.max(1, Math.round(o.size))
  const start = o.cursor ? firstAfter(sorted, o.cursor, order) : 0
  const games = sorted.slice(start, start + size)
  const last = games[games.length - 1]
  const more = start + games.length < sorted.length
  return {
    games,
    start,
    total: sorted.length,
    nextCursor: more && last ? cursorOf(last, order) : null,
    more
  }
}

/** "Games 51-100 of 1,234", or what to say when there are none. */
export function pageWords(page: LibraryPage): string {
  if (page.total === 0) return 'No games'
  if (page.games.length === 0) return `Nothing on this page, of ${page.total.toLocaleString()}`
  const from = page.start + 1
  const to = page.start + page.games.length
  if (page.total === 1) return '1 game'
  return `Games ${from.toLocaleString()}-${to.toLocaleString()} of ${page.total.toLocaleString()}`
}

// ---------------------------------------------------------------------------------------------------------------
// The same game arriving twice

export type DuplicateVerdict = 'same-game' | 'same-moves' | 'different'

export interface RecordComparison {
  verdict: DuplicateVerdict
  /** Why, in plain words. Always at least one. */
  because: string[]
  /** Fields where the two records say different things. Empty for 'same-game'. */
  conflicts: { field: string; a: string; b: string }[]
  /** Fields one record has and the other does not. Not a conflict -- one of them simply knows more. */
  onlyOne: { field: string; which: 'a' | 'b'; value: string }[]
}

const fp = (game: StoredGame): string => game.fingerprint || fingerprintOf(game.startFen, game.moves)

/** The fields that say *which* game a record is, as opposed to describing it. */
const IDENTIFYING: { field: string; of: (g: StoredGame) => string | undefined; same?: (a: string, b: string) => boolean }[] = [
  { field: 'White', of: (g) => g.meta.white.name, same: (a, b) => nameKey(a) === nameKey(b) },
  { field: 'Black', of: (g) => g.meta.black.name, same: (a, b) => nameKey(a) === nameKey(b) },
  { field: 'Event', of: (g) => g.meta.event, same: (a, b) => fold(a) === fold(b) },
  { field: 'Place', of: (g) => g.meta.site, same: (a, b) => fold(a) === fold(b) },
  { field: 'Round', of: (g) => g.meta.round, same: (a, b) => fold(a) === fold(b) },
  { field: 'Result', of: (g) => (g.meta.result === '*' ? undefined : g.meta.result) },
  { field: 'Date', of: (g) => g.meta.date, same: (a, b) => sameDate(a, b) }
]

/**
 * Two written dates that do not contradict each other.
 *
 * "2021.??.??" and "2021.07.14" are the same date as far as either of them says. Only a part both of them have and
 * disagree on is a contradiction, which is the difference between a library that spots a duplicate and one that
 * insists two copies of the same game are different because one file was more careful.
 */
export function sameDate(a: string, b: string): boolean {
  const x = parseGameDate(a)
  const y = parseGameDate(b)
  if (x.year === undefined || y.year === undefined) return true
  if (x.year !== y.year) return false
  if (x.month !== undefined && y.month !== undefined && x.month !== y.month) return false
  if (x.day !== undefined && y.day !== undefined && x.day !== y.day) return false
  return true
}

/**
 * Whether two records are the same game.
 *
 * The fingerprint decides whether the *moves* are the same, because that is exactly what it is a hash of -- the
 * starting position and every move. Everything after that is about whether the two records describe the same event,
 * and the answer is deliberately one of three rather than yes or no:
 *
 *   - **same-game**: the same moves, and nothing either record says contradicts the other. One may know more than
 *     the other; that is listed in `onlyOne` so a person can see what they would gain by keeping which.
 *   - **same-moves**: the same moves, but the records disagree about something that says which game it is. Two
 *     players really can reach the same position by the same route in two different tournaments, and short games
 *     especially. This is the verdict that must never be merged automatically.
 *   - **different**: not the same moves, or not the same variant, or there are no moves to compare.
 *
 * The empty-game case is worth its own sentence. Two games with no moves have the same fingerprint, because there is
 * nothing in them to differ -- a blank board and a blank board. Calling those duplicates would offer to delete every
 * new board a person has ever opened, so they are 'different' and the reason says why.
 */
export function compareRecords(a: StoredGame, b: StoredGame): RecordComparison {
  if (a.id === b.id) return { verdict: 'same-game', because: ['This is one record, not two.'], conflicts: [], onlyOne: [] }
  if (a.variant !== b.variant) {
    return {
      verdict: 'different',
      because: [`One is ${a.variant} and the other is ${b.variant}, so they are not the same game even move for move.`],
      conflicts: [{ field: 'Variant', a: a.variant, b: b.variant }],
      onlyOne: []
    }
  }
  if (!a.moves.length && !b.moves.length) {
    return { verdict: 'different', because: ['Neither game has any moves, so there is nothing to compare.'], conflicts: [], onlyOne: [] }
  }
  if (fp(a) !== fp(b)) {
    const why = a.startFen !== b.startFen
      ? 'They start from different positions.'
      : a.moves.length !== b.moves.length
        ? `One has ${a.moves.length} moves and the other has ${b.moves.length}.`
        : 'The moves are not the same.'
    return { verdict: 'different', because: [why], conflicts: [], onlyOne: [] }
  }

  const conflicts: RecordComparison['conflicts'] = []
  const onlyOne: RecordComparison['onlyOne'] = []
  for (const field of IDENTIFYING) {
    const left = field.of(a)
    const right = field.of(b)
    if (left === undefined && right === undefined) continue
    if (left === undefined) { onlyOne.push({ field: field.field, which: 'b', value: right as string }); continue }
    if (right === undefined) { onlyOne.push({ field: field.field, which: 'a', value: left }); continue }
    const same = field.same ? field.same(left, right) : left === right
    if (!same) conflicts.push({ field: field.field, a: left, b: right })
  }

  if (conflicts.length) {
    return {
      verdict: 'same-moves',
      because: [
        'The moves are identical, but the records disagree about which game this is.',
        ...conflicts.map((c) => `${c.field}: "${c.a}" against "${c.b}".`)
      ],
      conflicts,
      onlyOne
    }
  }
  return {
    verdict: 'same-game',
    because: [
      'The same moves from the same position, and nothing either record says contradicts the other.',
      ...(onlyOne.length ? [`One record knows more: ${onlyOne.map((one) => one.field).join(', ')}.`] : [])
    ],
    conflicts: [],
    onlyOne
  }
}

export interface DuplicateGroup {
  /** The games that share these moves, in the order they were given. */
  ids: string[]
  verdict: Exclude<DuplicateVerdict, 'different'>
  because: string[]
  conflicts: RecordComparison['conflicts']
}

/**
 * Every set of games in the library that share their moves.
 *
 * Bucketed on the fingerprint first, so this is one pass over the games plus a comparison inside each bucket, rather
 * than every game against every other. On a library of a few thousand that is the difference between instant and
 * several seconds.
 *
 * A bucket with a mixture -- two copies of one game, and a third that only shares the moves -- comes back as
 * separate groups, because telling a person "these three are duplicates" when one of them is not is how a real game
 * gets deleted.
 */
export function duplicateGroups(games: readonly StoredGame[]): DuplicateGroup[] {
  const buckets = new Map<string, StoredGame[]>()
  for (const game of games) {
    // Nothing to compare: see compareRecords for why an empty game is never a duplicate.
    if (!game.moves.length) continue
    const key = `${game.variant}|${fp(game)}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(game)
    else buckets.set(key, [game])
  }
  const out: DuplicateGroup[] = []
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue
    const placed = new Set<string>()
    for (const game of bucket) {
      if (placed.has(game.id)) continue
      // Everything that is the same game as this one, by agreement rather than by looks.
      const sameGame: StoredGame[] = [game]
      for (const other of bucket) {
        if (other.id === game.id || placed.has(other.id)) continue
        if (compareRecords(game, other).verdict === 'same-game') sameGame.push(other)
      }
      if (sameGame.length > 1) {
        for (const one of sameGame) placed.add(one.id)
        const comparison = compareRecords(sameGame[0], sameGame[1])
        out.push({ ids: sameGame.map((one) => one.id), verdict: 'same-game', because: comparison.because, conflicts: [] })
      }
    }
    // Whatever is left shares the moves without agreeing about the game.
    const rest = bucket.filter((one) => !placed.has(one.id))
    if (rest.length > 1) {
      const comparison = compareRecords(rest[0], rest[1])
      out.push({ ids: rest.map((one) => one.id), verdict: 'same-moves', because: comparison.because, conflicts: comparison.conflicts })
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// What is in the library, counted

export interface Facet { value: string; label: string; count: number }

export interface LibraryFacets {
  total: number
  players: Facet[]
  events: Facet[]
  tags: Facet[]
  collections: Facet[]
  results: Facet[]
  sources: Facet[]
  variants: Facet[]
  years: Facet[]
  favourites: number
  annotated: number
  /** Games with no date recorded at all, said out loud rather than left as a gap in the years. */
  undated: number
}

function counted(map: Map<string, { label: string; count: number }>, limit = 40): Facet[] {
  return [...map.entries()]
    .map(([value, one]) => ({ value, label: one.label, count: one.count }))
    .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
    .slice(0, limit)
}

const bump = (map: Map<string, { label: string; count: number }>, value: string, label: string): void => {
  const had = map.get(value)
  if (had) had.count += 1
  else map.set(value, { label, count: 1 })
}

/**
 * The counts the filter controls show.
 *
 * Every number here is counted off the games that were handed in. A filter offering "Tata Steel (14)" when there are
 * no such games is worse than offering nothing, so a value that nothing has is not offered: the lists are built from
 * what is there.
 */
export function facetsOf(games: readonly StoredGame[]): LibraryFacets {
  const players = new Map<string, { label: string; count: number }>()
  const events = new Map<string, { label: string; count: number }>()
  const tags = new Map<string, { label: string; count: number }>()
  const collections = new Map<string, { label: string; count: number }>()
  const results = new Map<string, { label: string; count: number }>()
  const sources = new Map<string, { label: string; count: number }>()
  const variants = new Map<string, { label: string; count: number }>()
  const years = new Map<string, { label: string; count: number }>()
  let favourites = 0
  let annotated = 0
  let undated = 0

  for (const game of games) {
    for (const name of [game.meta.white.name, game.meta.black.name]) {
      if (name) bump(players, fold(name), name)
    }
    if (game.meta.event) bump(events, fold(game.meta.event), game.meta.event)
    for (const tag of plainTags(game)) bump(tags, fold(tag), tag)
    for (const name of collectionsOf(game)) bump(collections, fold(name), name)
    bump(results, game.meta.result, resultWords(game.meta.result))
    bump(sources, game.source.kind, sourceWords(game.source.kind))
    bump(variants, game.variant, game.variant)
    const date = parseGameDate(game.meta.date)
    if (date.year === undefined) undated += 1
    else bump(years, String(date.year), String(date.year))
    if (game.favourite === true) favourites += 1
    if (isAnnotated(game)) annotated += 1
  }

  return {
    total: games.length,
    players: counted(players),
    events: counted(events),
    tags: counted(tags, 200),
    collections: counted(collections, 200),
    results: counted(results, 4),
    sources: counted(sources, 5),
    variants: counted(variants, 20),
    // Years read newest first, which is the only order anybody wants a list of years in.
    years: [...years.entries()].map(([value, one]) => ({ value, label: one.label, count: one.count })).sort((a, b) => (a.value < b.value ? 1 : -1)),
    favourites,
    annotated,
    undated
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Saying what is about to happen

/**
 * Exactly what a delete would take, before it takes it.
 *
 * "Delete 47 games?" is not enough to answer. What a person needs to know is whether any of them is starred, whether
 * any is the only copy of something, and -- above all -- the names, because a selection made with a filter and then
 * added to by hand is very easy to be wrong about.
 */
export function deleteWarning(games: readonly StoredGame[]): { heading: string; lines: string[]; names: string[] } {
  const starred = games.filter((g) => g.favourite === true).length
  const inCollections = new Set<string>()
  for (const game of games) for (const name of collectionsOf(game)) inCollections.add(name)
  const names = games.slice(0, 8).map(gameTitle)
  const lines: string[] = []
  if (starred) lines.push(`${starred} of them ${starred === 1 ? 'is' : 'are'} starred.`)
  if (inCollections.size) lines.push(`They are in ${[...inCollections].slice(0, 6).join(', ')}, which will lose them.`)
  lines.push('This removes them from Orbis. It cannot be undone, and a PGN file you saved earlier is not affected.')
  return {
    heading: games.length === 1 ? `Remove ${gameTitle(games[0])}?` : `Remove ${games.length} games?`,
    lines,
    names
  }
}

/** A game named the way a person would name it, with nothing invented where a name is missing. */
export function gameTitle(game: StoredGame): string {
  const white = game.meta.white.name
  const black = game.meta.black.name
  if (white && black) return `${white} vs ${black}`
  if (white) return `${white} vs an unnamed player`
  if (black) return `An unnamed player vs ${black}`
  if (game.meta.event) return game.meta.event
  return `Game of ${game.moves.length} ${game.moves.length === 1 ? 'move' : 'moves'}`
}

/** The line under a game's name: only the parts that are really known, in a fixed order. */
export function gameLine(game: StoredGame): string {
  const bits: string[] = []
  if (game.meta.event) bits.push(game.meta.event)
  if (game.meta.date) bits.push(game.meta.date)
  if (game.meta.round) bits.push(`round ${game.meta.round}`)
  bits.push(`${game.moves.length} ${game.moves.length === 1 ? 'move' : 'moves'}`)
  bits.push(game.meta.result === '*' ? 'no result recorded' : game.meta.result)
  if (game.meta.eco) bits.push(game.meta.eco)
  if (game.meta.opening) bits.push(game.meta.opening)
  return bits.join(' · ')
}

/**
 * The summary an import comes back with, said in words.
 *
 * Every number is reported including the zeroes that matter: "0 brought in" with three failures is the whole story,
 * and a summary that only mentioned the successes would make a file that imported nothing look like a file that
 * imported fine.
 */
export function importWords(summary: { imported: number; skippedDuplicates: number; failed: unknown[] }): string {
  const bits = [`${summary.imported} brought in`]
  if (summary.skippedDuplicates) bits.push(`${summary.skippedDuplicates} already here`)
  if (summary.failed.length) bits.push(`${summary.failed.length} could not be read`)
  return `${bits.join(', ')}.`
}
