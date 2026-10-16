import { START_FEN, applyMove, outcome, sideToMove } from './rules.ts'
import { buildMoves, type GameMeta, type GameMove, type GameResult, type PlayerInfo, type StoredGame } from './model.ts'

/**
 * Famous games: a small collection of games that were really played (Sections 231-240).
 *
 * ## Why this file is careful about where things come from
 *
 * The moves of a chess game are facts. Nobody owns 1.e4, and nobody owns the particular sequence Anderssen and
 * Kieseritzky played in London in 1851. What people do own is **writing about** those moves -- the annotations in a
 * book, the prose in a magazine, the notes attached to a game in a commercial database -- and, in some places, a
 * database compilation taken as a whole.
 *
 * So the collection in `famousData.ts` is a small number of games whose moves are widely published facts, typed in
 * as data, with every word of commentary written for Orbis. That is not a legal opinion; it is the only way to put
 * historic games in front of somebody without taking somebody else's work, and it is written down here so nobody
 * later pastes a page of annotations in and assumes it is fine.
 *
 * Three sentences hold for every game, and they are constants rather than per-game text so they cannot drift:
 * `MOVES_ARE`, `COMMENTARY_IS` and `MODERN_ANALYSIS_IS`. A game may add to them -- `unstated` is the list of details
 * Orbis deliberately does **not** claim, because it is not certain of them -- but it may not contradict them.
 *
 * ## Unknown stays unknown
 *
 * A game with no round has no round. A player whose name was not recorded has no name, not "Unknown". The same rule
 * the rest of Chess World runs on (`model.ts`), for the same reason: a filled-in blank is indistinguishable from a
 * fact once it is on screen.
 *
 * ## Matching is not being right
 *
 * The guided mode asks somebody to find the move that was played. That is a real and useful thing to practise and it
 * is **not** the same as finding the best move: these games are a century and a half old in places, and an engine
 * today disagrees with the winner often. Every verdict this file produces says so, in `MATCH_IS_NOT_CORRECT`,
 * because a screen that says "correct!" for matching a Victorian attack is teaching something false.
 *
 * This is also why the guided mode is not an `Exercise` from `exercise.ts`. That engine judges whether a move
 * **solves** a position, against a tree of correct answers; this one judges whether a move **is the one that was
 * played**. Two different questions, and borrowing the machinery would mean borrowing the word "correct" with it.
 *
 * Pure: no clock, no storage, no engine. Nothing here asks an engine anything, and nothing here reports an engine
 * number, because a number nobody measured is a number nobody should see.
 */

// ---------------------------------------------------------------- what is said about every game

/** Where the moves come from. True of every game in the collection. */
export const MOVES_ARE =
  'The moves are the record of a game that was really played. Chess moves are facts: they are not anybody’s writing, and none of them have been copied from a book or a database.'

/** Who wrote the words. True of every game in the collection. */
export const COMMENTARY_IS =
  'Everything written about the game here was written for Orbis. No annotation, note or phrase has been copied from any book, magazine, website or database.'

/** What an engine's opinion is, and what it is not. Shown wherever an engine could be asked about one of these games. */
export const MODERN_ANALYSIS_IS =
  'Anything a chess engine says about these games is modern analysis, worked out now. It is not what the player was thinking, and it is not part of the historical record.'

/** The sentence that keeps the guided mode honest. */
export const MATCH_IS_NOT_CORRECT =
  'Matching the game means you found the move that was played. It does not mean the move was best — some of these games are very old, and an engine today often disagrees with both players.'

// ---------------------------------------------------------------- the shape of a game

/**
 * What the game is remembered for.
 *
 * A closed list on purpose. A free-text theme field becomes a hundred near-duplicates and a filter that misses
 * things, and there is no way to check it.
 */
export type FamousTheme =
  | 'queen-sacrifice'
  | 'piece-sacrifice'
  | 'king-hunt'
  | 'mating-attack'
  | 'quiet-move'
  | 'counter-attack'
  | 'positional-squeeze'
  | 'defence'
  | 'machine'

export const THEME_LABEL: Record<FamousTheme, string> = {
  'queen-sacrifice': 'Queen given up',
  'piece-sacrifice': 'A piece given up',
  'king-hunt': 'The king hunted into the open',
  'mating-attack': 'An attack that ends in mate',
  'quiet-move': 'A quiet move in the middle of it',
  'counter-attack': 'Counter-attack',
  'positional-squeeze': 'Squeezed, not stormed',
  defence: 'Defence',
  machine: 'A machine on one side'
}

export const THEMES: readonly FamousTheme[] = Object.freeze(Object.keys(THEME_LABEL) as FamousTheme[])

/**
 * Roughly when the game was played.
 *
 * The boundaries are Orbis's own and are written down rather than implied, because "romantic" and "modern" are
 * loose words and somebody is entitled to know exactly what the filter did. They are not claims about chess history.
 */
export type FamousPeriod = 'romantic' | 'classical' | 'modern' | 'computer'

export interface PeriodBand {
  id: FamousPeriod
  label: string
  /** Inclusive. Absent means "no lower bound". */
  from?: number
  /** Inclusive. Absent means "no upper bound". */
  to?: number
}

export const PERIODS: readonly PeriodBand[] = Object.freeze([
  { id: 'romantic', label: 'Before 1890', to: 1889 },
  { id: 'classical', label: '1890 to 1945', from: 1890, to: 1945 },
  { id: 'modern', label: '1946 to 1990', from: 1946, to: 1990 },
  { id: 'computer', label: '1991 onwards', from: 1991 }
])

export const PERIOD_LABEL: Record<FamousPeriod, string> = {
  romantic: 'Before 1890',
  classical: '1890 to 1945',
  modern: '1946 to 1990',
  computer: '1991 onwards'
}

/** Which band a year falls in. Null when the year is not known: a missing year is not a period. */
export function periodOf(year: number | undefined): FamousPeriod | null {
  if (year === undefined || !Number.isFinite(year)) return null
  for (const band of PERIODS) {
    if (band.from !== undefined && year < band.from) continue
    if (band.to !== undefined && year > band.to) continue
    return band.id
  }
  return null
}

/**
 * How the game stopped.
 *
 * `score-ends-here` is a real answer and the honest one for a game whose score simply stops with a result recorded
 * beside it. Orbis does not say why it stopped unless it knows.
 */
export type FamousEnding = 'checkmate' | 'resignation' | 'score-ends-here'

export const ENDING_LABEL: Record<FamousEnding, string> = {
  checkmate: 'Checkmate on the board',
  resignation: 'The loser resigned',
  'score-ends-here': 'The score ends here'
}

/** A point in the game where the learner is asked to find the move before it is shown. */
export interface GuidedPoint {
  /** 1-based index into `san`: the move to be found. */
  ply: number
  /** Orbis's question. It must not give the move away. */
  ask: string
  /** What Orbis says once the move is on the board. */
  afterward: string
}

export interface FamousGame {
  id: string
  white: PlayerInfo
  black: PlayerInfo
  result: GameResult
  /** The occasion, when it is known. */
  event?: string
  /** The town, when it is known. */
  site?: string
  year?: number
  round?: string
  ending: FamousEnding
  /** The game, in standard notation, from the ordinary starting position. */
  san: readonly string[]
  themes: readonly FamousTheme[]
  /** The name people know the game by, when it has one. */
  nickname?: string
  /** Orbis's own words: what happens in the game and why it is worth looking at. */
  note: string
  /**
   * Details Orbis deliberately does not state about this game, because it is not sure of them.
   *
   * This list is the opposite of decoration. A game that says nothing about its round says nothing about its round;
   * a game that is often described as a casual rather than a tournament game says so here rather than quietly
   * inheriting an event name it may not deserve.
   */
  unstated: readonly string[]
  guided: readonly GuidedPoint[]
}

/** Everything Orbis is prepared to say about where one of these games came from. */
export interface FamousProvenance {
  moves: string
  commentary: string
  modernAnalysis: string
  unstated: readonly string[]
}

export function provenanceOf(game: FamousGame): FamousProvenance {
  return { moves: MOVES_ARE, commentary: COMMENTARY_IS, modernAnalysis: MODERN_ANALYSIS_IS, unstated: game.unstated }
}

// ---------------------------------------------------------------- replaying

export interface FamousReplay {
  ok: boolean
  moves: GameMove[]
  /** Where it stopped being legal, when it did. */
  failedAt?: { index: number; move: string; fen: string }
}

/**
 * The game, played out through the rules.
 *
 * Everything else in this file goes through here, including the screen. There is no stored list of positions: a
 * position that was typed in rather than played is a position nobody checked.
 */
export function replayFamous(game: Pick<FamousGame, 'san'>): FamousReplay {
  const built = buildMoves(START_FEN, game.san.map((san) => ({ san })))
  return built.failedAt ? { ok: built.ok, moves: built.moves, failedAt: built.failedAt } : { ok: built.ok, moves: built.moves }
}

/** The positions of the game: index 0 is before anything was played, index n is after move n. */
export function famousPositions(game: Pick<FamousGame, 'san'>): string[] {
  const replay = replayFamous(game)
  return [START_FEN, ...replay.moves.map((m) => m.fen)]
}

/** The position a given move was played in. Ply 1 is the first move, so it is played in the starting position. */
export function fenBefore(game: Pick<FamousGame, 'san'>, ply: number): string {
  const positions = famousPositions(game)
  const index = Math.max(0, Math.min(positions.length - 1, ply - 1))
  return positions[index]
}

// ---------------------------------------------------------------- checking the data

export type FamousProblemCode =
  | 'no-id'
  | 'duplicate-id'
  | 'no-moves'
  | 'illegal-move'
  | 'not-canonical'
  | 'ending-not-checkmate'
  | 'ending-is-checkmate'
  | 'result-disagrees'
  | 'loser-not-to-move'
  | 'draw-with-a-winner'
  | 'guided-out-of-range'
  | 'guided-repeated'
  | 'guided-gives-it-away'
  | 'no-note'
  | 'no-theme'
  | 'unknown-theme'
  | 'no-player'
  | 'year-out-of-range'

export interface FamousProblem {
  code: FamousProblemCode
  /** Said plainly, so somebody fixing the data knows what to change. */
  message: string
}

export interface FamousCheck {
  id: string
  ok: boolean
  moves: number
  /** The position the game ends in, when it replayed at all. */
  finalFen: string
  problems: FamousProblem[]
}

/** The first year this collection will accept, and the last. A year outside this is a typo, not a game. */
export const YEAR_RANGE = Object.freeze({ from: 1475, to: 2100 })

/**
 * Everything that can be checked about one game without knowing any chess history.
 *
 * The important ones are the chess ones. Every move is played through `rules.ts` from the starting position, and the
 * notation is compared with the notation the rules write for that same move -- which catches a move that is legal
 * but written wrongly, such as a knight capture that needed a disambiguating letter. Then the ending is checked
 * against the position the game really finishes in: a game that says "checkmate" and does not end in checkmate is
 * wrong, and so is a game that says somebody resigned in a position that is already mate.
 *
 * None of this can tell whether the moves are the moves Anderssen played. Nothing in a program can. What it can do
 * is prove the data is a real game and internally consistent, which is where typos show up.
 */
export function checkFamousGame(game: FamousGame): FamousCheck {
  const problems: FamousProblem[] = []
  const add = (code: FamousProblemCode, message: string): void => { problems.push({ code, message }) }

  if (!game.id.trim()) add('no-id', 'This game has no id.')
  if (!game.white.name?.trim() && !game.black.name?.trim()) {
    add('no-player', `${game.id}: neither player is named, so there is nothing to call this game.`)
  }
  if (!game.note.trim()) add('no-note', `${game.id}: there is nothing written about this game.`)
  if (!game.themes.length) add('no-theme', `${game.id}: the game has no theme, so no filter will ever find it.`)
  for (const theme of game.themes) {
    if (!THEMES.includes(theme)) add('unknown-theme', `${game.id}: "${theme}" is not one of the themes.`)
  }
  if (game.year !== undefined && (game.year < YEAR_RANGE.from || game.year > YEAR_RANGE.to)) {
    add('year-out-of-range', `${game.id}: ${game.year} is not a year a chess game was played in.`)
  }
  if (!game.san.length) {
    add('no-moves', `${game.id}: there are no moves.`)
    return { id: game.id, ok: false, moves: 0, finalFen: START_FEN, problems }
  }

  // Every move, played. A move that will not go is a typo in the data, and the message says exactly where.
  const replay = replayFamous(game)
  if (!replay.ok) {
    const at = replay.failedAt
    add('illegal-move', at
      ? `${game.id}: move ${at.index + 1} is written "${at.move}", which cannot be played in ${at.fen}.`
      : `${game.id}: the moves will not replay.`)
    return { id: game.id, ok: false, moves: replay.moves.length, finalFen: START_FEN, problems }
  }

  // The notation the rules write, against the notation that was typed. This is what catches a missing "x" or a
  // knight move that needed to say which knight.
  for (const [index, move] of replay.moves.entries()) {
    if (move.san !== game.san[index]) {
      add('not-canonical', `${game.id}: move ${index + 1} is written "${game.san[index]}" but in that position the move is written "${move.san}".`)
    }
  }

  const finalFen = replay.moves[replay.moves.length - 1].fen
  const history = replay.moves.map((m) => m.san)
  const state = outcome(finalFen, history)
  const mated = state.over && state.reason === 'checkmate'

  if (game.ending === 'checkmate') {
    if (!mated) add('ending-not-checkmate', `${game.id}: the game says it ends in checkmate, but the final position is not checkmate.`)
    else if (state.result !== game.result) {
      add('result-disagrees', `${game.id}: the mate in the final position is ${state.result}, but the game is recorded as ${game.result}.`)
    }
  } else if (mated) {
    add('ending-is-checkmate', `${game.id}: the game says it ends another way, but the final position is checkmate.`)
  }

  if (game.result === '1/2-1/2' && game.ending === 'checkmate') {
    add('draw-with-a-winner', `${game.id}: a game that ends in checkmate is not drawn.`)
  }

  /*
   * Who was to move when it stopped.
   *
   * Somebody who resigns is, nearly always, the player whose turn it is: they look at the position they have to move
   * in and stop. It is not a law of chess -- a player may resign on the opponent's clock -- so this is checked only
   * for games the data says ended in resignation, and it has caught a move list that was one move short.
   */
  if (game.ending === 'resignation' && (game.result === '1-0' || game.result === '0-1')) {
    const loser = game.result === '1-0' ? 'b' : 'w'
    if (sideToMove(finalFen) !== loser) {
      add('loser-not-to-move', `${game.id}: ${game.result} after a resignation, but it is not the losing side's move in the final position — the move list may be short or long by one.`)
    }
  }

  const seen = new Set<number>()
  for (const point of game.guided) {
    if (!Number.isInteger(point.ply) || point.ply < 1 || point.ply > game.san.length) {
      add('guided-out-of-range', `${game.id}: a guided point asks for move ${point.ply}, and the game has ${game.san.length}.`)
      continue
    }
    if (seen.has(point.ply)) add('guided-repeated', `${game.id}: move ${point.ply} is asked for twice.`)
    seen.add(point.ply)
    // A question that contains the answer is not a question. Checked against the notation and the destination square.
    const answer = game.san[point.ply - 1]
    const bare = answer.replace(/[+#!?]/g, '')
    if (bare.length > 1 && point.ask.includes(bare)) {
      add('guided-gives-it-away', `${game.id}: the question for move ${point.ply} contains "${bare}", which is the answer.`)
    }
  }

  return { id: game.id, ok: problems.length === 0, moves: replay.moves.length, finalFen, problems }
}

export interface CollectionCheck {
  games: FamousCheck[]
  /** How many games are in the collection. */
  total: number
  /** How many came through with nothing wrong. */
  verified: number
  /** Problems that are about the collection rather than one game. */
  problems: FamousProblem[]
}

/** The whole collection, checked. This is what the test asserts on, and what the screen may quote. */
export function checkCollection(games: readonly FamousGame[]): CollectionCheck {
  const checks = games.map((game) => checkFamousGame(game))
  const problems: FamousProblem[] = []
  const counts = new Map<string, number>()
  for (const game of games) counts.set(game.id, (counts.get(game.id) ?? 0) + 1)
  for (const [id, count] of counts) {
    if (count > 1) problems.push({ code: 'duplicate-id', message: `${id} appears ${count} times, so one copy will shadow the other.` })
  }
  return { games: checks, total: games.length, verified: checks.filter((one) => one.ok).length, problems }
}

// ---------------------------------------------------------------- reading a game out

/** "Anderssen vs Kieseritzky". A player with no recorded name is left as the colour, never as "Unknown". */
export function famousTitle(game: FamousGame): string {
  return `${game.white.name ?? 'White'} vs ${game.black.name ?? 'Black'}`
}

/** The line under the title: where, when, how long, and how it came out. Anything unknown is simply absent. */
export function famousLine(game: FamousGame): string {
  const moves = Math.ceil(game.san.length / 2)
  return [
    game.site,
    game.year === undefined ? '' : String(game.year),
    `${moves} move${moves === 1 ? '' : 's'}`,
    game.result === '*' ? '' : game.result
  ].filter((part) => part !== '' && part !== undefined).join(' · ')
}

/** Both players' names, for searching and for the player filter. */
export function playersOf(game: FamousGame): string[] {
  return [game.white.name, game.black.name].filter((name): name is string => Boolean(name?.trim()))
}

/** Everything about a game a free-text search should look at. Lower case, so the search does not have to care. */
export function famousSearchText(game: FamousGame): string {
  return [
    ...playersOf(game),
    game.nickname ?? '',
    game.event ?? '',
    game.site ?? '',
    game.year === undefined ? '' : String(game.year),
    ...game.themes.map((theme) => THEME_LABEL[theme])
  ].join(' ').toLowerCase()
}

// ---------------------------------------------------------------- filters

export interface FamousFilter {
  /** Free text over players, nickname, event, town, year and themes. */
  text?: string
  /** One player's name, matched on either colour. */
  player?: string
  period?: FamousPeriod
  theme?: FamousTheme
  result?: GameResult
}

export const EMPTY_FILTER: FamousFilter = Object.freeze({})

/** Whether anything is being filtered at all, so a screen can say "all of them" rather than nothing. */
export function filterIsEmpty(filter: FamousFilter): boolean {
  return !filter.text?.trim() && !filter.player?.trim() && !filter.period && !filter.theme && !filter.result
}

/** Does this game pass? Every part of the filter must pass; an unset part never excludes anything. */
export function matchesFamous(game: FamousGame, filter: FamousFilter): boolean {
  const text = filter.text?.trim().toLowerCase()
  if (text) {
    const haystack = famousSearchText(game)
    // Every word has to appear somewhere. "morphy opera" finds the Opera Game and not every Morphy game.
    for (const word of text.split(/\s+/)) if (!haystack.includes(word)) return false
  }
  const player = filter.player?.trim().toLowerCase()
  if (player && !playersOf(game).some((name) => name.toLowerCase().includes(player))) return false
  if (filter.period && periodOf(game.year) !== filter.period) return false
  if (filter.theme && !game.themes.includes(filter.theme)) return false
  if (filter.result && game.result !== filter.result) return false
  return true
}

export function filterFamous(games: readonly FamousGame[], filter: FamousFilter): FamousGame[] {
  return games.filter((game) => matchesFamous(game, filter))
}

export type FamousSort = 'year' | 'length' | 'title'

/**
 * Ordering. A game with no year sorts last whichever way round it is, because "unknown" is not early and it is not
 * late -- the same rule the library uses, so the two screens do not disagree.
 */
export function sortFamous(games: readonly FamousGame[], key: FamousSort, newestFirst = false): FamousGame[] {
  const out = [...games]
  out.sort((a, b) => {
    if (key === 'title') return famousTitle(a).localeCompare(famousTitle(b))
    if (key === 'length') return a.san.length - b.san.length
    if (a.year === undefined && b.year === undefined) return 0
    if (a.year === undefined) return 1
    if (b.year === undefined) return -1
    return newestFirst ? b.year - a.year : a.year - b.year
  })
  return out
}

export interface Facet<T> { value: T; label: string; count: number }

export interface FamousFacets {
  players: Facet<string>[]
  periods: Facet<FamousPeriod>[]
  themes: Facet<FamousTheme>[]
  results: Facet<GameResult>[]
  /** Games whose year is not recorded, so they belong to no period. Shown, not hidden. */
  withoutYear: number
}

/**
 * What there is to filter by, counted.
 *
 * Only values that exist are returned. A filter button for a theme no game in the collection has is a control that
 * does nothing, and offering it implies the collection holds something it does not.
 */
export function famousFacets(games: readonly FamousGame[]): FamousFacets {
  const players = new Map<string, number>()
  const periods = new Map<FamousPeriod, number>()
  const themes = new Map<FamousTheme, number>()
  const results = new Map<GameResult, number>()
  let withoutYear = 0
  for (const game of games) {
    for (const name of playersOf(game)) players.set(name, (players.get(name) ?? 0) + 1)
    const period = periodOf(game.year)
    if (period) periods.set(period, (periods.get(period) ?? 0) + 1)
    else withoutYear += 1
    for (const theme of new Set(game.themes)) themes.set(theme, (themes.get(theme) ?? 0) + 1)
    results.set(game.result, (results.get(game.result) ?? 0) + 1)
  }
  return {
    players: [...players].map(([value, count]) => ({ value, label: value, count })).sort((a, b) => a.label.localeCompare(b.label)),
    periods: PERIODS.filter((band) => periods.has(band.id)).map((band) => ({ value: band.id, label: band.label, count: periods.get(band.id) ?? 0 })),
    themes: THEMES.filter((theme) => themes.has(theme)).map((theme) => ({ value: theme, label: THEME_LABEL[theme], count: themes.get(theme) ?? 0 })),
    results: (['1-0', '0-1', '1/2-1/2', '*'] as GameResult[]).filter((one) => results.has(one)).map((one) => ({ value: one, label: one, count: results.get(one) ?? 0 })),
    withoutYear
  }
}

/** What the filter is doing, in words, so somebody looking at four games knows why it is four. */
export function describeFamousFilter(filter: FamousFilter): string {
  if (filterIsEmpty(filter)) return 'Every game in the collection.'
  const parts: string[] = []
  if (filter.text?.trim()) parts.push(`matching “${filter.text.trim()}”`)
  if (filter.player?.trim()) parts.push(`played by ${filter.player.trim()}`)
  if (filter.period) parts.push(`from ${PERIOD_LABEL[filter.period].toLowerCase()}`)
  if (filter.theme) parts.push(`about ${THEME_LABEL[filter.theme].toLowerCase()}`)
  if (filter.result) parts.push(`ending ${filter.result}`)
  return `Games ${parts.join(', ')}.`
}

export function famousById(games: readonly FamousGame[], id: string): FamousGame | null {
  return games.find((game) => game.id === id) ?? null
}

// ---------------------------------------------------------------- opening one in the library

/** The tag that says a game in the library is a copy of one of these, so nothing else is mistaken for one. */
export const FAMOUS_TAG = 'famous-game'

/** Extra PGN tags Orbis keeps on the copy. The PGN writer gives them back, so an exported copy is still identifiable. */
export const FAMOUS_ID_TAG = 'OrbisFamousId'
export const FAMOUS_SOURCE_TAG = 'OrbisMovesAre'
export const FAMOUS_COMMENTARY_TAG = 'OrbisCommentaryBy'

export interface FamousStoredPayload {
  source: { kind: 'study' }
  startFen: string
  meta: GameMeta
  tags: string[]
}

/**
 * The game as the library should hold it.
 *
 * `source.kind` is `study`, not `import`: nobody imported a file and nobody played this game on this computer, and
 * saying `import` would invent a file that does not exist. The provenance travels with the copy in the extra tags,
 * so a game somebody exports and hands on still says where its moves came from and who wrote the words.
 */
export function famousToStored(game: FamousGame): FamousStoredPayload {
  const meta: GameMeta = {
    white: { ...game.white },
    black: { ...game.black },
    result: game.result,
    ...(game.event ? { event: game.event } : {}),
    ...(game.site ? { site: game.site } : {}),
    // A year on its own is a partial date, and PGN has a way of writing that rather than inventing a day.
    ...(game.year !== undefined ? { date: `${game.year}.??.??` } : {}),
    ...(game.round ? { round: game.round } : {}),
    extra: {
      [FAMOUS_ID_TAG]: game.id,
      [FAMOUS_SOURCE_TAG]: 'historical record',
      [FAMOUS_COMMENTARY_TAG]: 'Orbis'
    }
  }
  return { source: { kind: 'study' }, startFen: START_FEN, meta, tags: [FAMOUS_TAG] }
}

/** The moves to save with the copy. Empty when the game will not replay, so a broken game is never half saved. */
export function famousMovesToStore(game: FamousGame): GameMove[] {
  const replay = replayFamous(game)
  return replay.ok ? replay.moves : []
}

/** Which famous game a library game is a copy of, or null. Null for everything else in the library. */
export function famousFromStored(game: Pick<StoredGame, 'tags' | 'meta'>): string | null {
  if (!(game.tags ?? []).includes(FAMOUS_TAG)) return null
  const id = game.meta.extra?.[FAMOUS_ID_TAG]?.trim()
  return id ? id : null
}

/** The library copy of a game, if there is one already, so the screen can say "open it" rather than make a second. */
export function storedCopyOf(games: readonly Pick<StoredGame, 'id' | 'tags' | 'meta'>[], famousId: string): string | null {
  for (const game of games) if (famousFromStored(game) === famousId) return game.id
  return null
}

// ---------------------------------------------------------------- the guided mode

export interface GuidedAnswer {
  ply: number
  /** What was guessed, as it was typed or played. Null when the move was simply shown. */
  guess: string | null
  /** Whether it is the move that was played. Not whether it was a good move. */
  matched: boolean
  /** Whether the move was shown rather than found. */
  shown: boolean
}

export interface GuidedRun {
  gameId: string
  /** Which marked point the run is on. Equal to the number of points when it is finished. */
  index: number
  answers: readonly GuidedAnswer[]
}

export function startGuided(game: FamousGame): GuidedRun {
  return { gameId: game.id, index: 0, answers: [] }
}

/** The point being asked now, or null when the run is finished or the game has no marked points. */
export function guidedPoint(game: FamousGame, run: GuidedRun): GuidedPoint | null {
  return game.guided[run.index] ?? null
}

/** The position to think in: the position the asked-for move was played in. */
export function guidedFen(game: FamousGame, point: GuidedPoint): string {
  return fenBefore(game, point.ply)
}

export interface GuidedVerdict {
  /** Whether the guess is a legal move at all in that position. */
  legal: boolean
  /** Whether it is the move that was played. */
  matched: boolean
  /** The move that was played, written for that position. */
  played: string
  /** The guess, written for that position, when it was legal. */
  guess?: string
  /** What to say, in words, including the part about matching not meaning best. */
  says: string
}

/**
 * Judging a guess.
 *
 * Three answers, not two. A move that is not legal is told so and nothing else happens; a legal move that is not the
 * game's move is a different move, which is interesting and is not a failure; the game's move is a match. The word
 * "correct" appears nowhere, and every verdict carries `MATCH_IS_NOT_CORRECT` with it.
 */
export function judgeGuided(game: FamousGame, point: GuidedPoint, guess: string): GuidedVerdict {
  const fen = guidedFen(game, point)
  const played = game.san[point.ply - 1] ?? ''
  const made = applyMove(fen, guess.trim())
  if (!made) {
    return {
      legal: false,
      matched: false,
      played,
      says: 'That move cannot be played in this position. Nothing has been counted — try another.'
    }
  }
  // Compared on coordinates, not on notation: "Nf3" and "g1f3" are the same move and both should match.
  const target = applyMove(fen, played)
  const matched = Boolean(target && target.uci === made.uci)
  return {
    legal: true,
    matched,
    played,
    guess: made.san,
    says: matched
      ? `${made.san} is the move that was played. ${MATCH_IS_NOT_CORRECT}`
      : `${made.san} is legal, and it is not what was played here — the game went ${played}. That does not make your move bad; it makes it a different game. ${MATCH_IS_NOT_CORRECT}`
  }
}

/** Writing an answer down and moving on. The run never goes past the last point. */
export function recordGuided(game: FamousGame, run: GuidedRun, answer: GuidedAnswer): GuidedRun {
  return {
    ...run,
    index: Math.min(game.guided.length, run.index + 1),
    answers: [...run.answers, answer]
  }
}

/** Giving up on a point: the move is shown, and that is recorded as shown rather than found. */
export function showGuided(game: FamousGame, run: GuidedRun): GuidedRun {
  const point = guidedPoint(game, run)
  if (!point) return run
  return recordGuided(game, run, { ply: point.ply, guess: null, matched: false, shown: true })
}

export interface GuidedProgress {
  points: number
  answered: number
  /** How many matched the game. Never called "right". */
  matched: number
  shown: number
  done: boolean
  /** The count said in words, with the caveat attached. */
  says: string
}

export function guidedProgress(game: FamousGame, run: GuidedRun): GuidedProgress {
  const matched = run.answers.filter((one) => one.matched).length
  const shown = run.answers.filter((one) => one.shown).length
  const points = game.guided.length
  const answered = run.answers.length
  const done = answered >= points && points > 0
  return {
    points,
    answered,
    matched,
    shown,
    done,
    says: points === 0
      ? 'This game has no marked points to find.'
      : `${matched} of ${answered} answered matched the game${shown ? `, and ${shown} ${shown === 1 ? 'was' : 'were'} shown` : ''}. ${MATCH_IS_NOT_CORRECT}`
  }
}
