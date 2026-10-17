import type { GameDate } from './library.ts'
import { nameKey, parseGameDate, dateWindow } from './library.ts'
import type { GameResult, StoredGame } from './model.ts'

/**
 * Your games, counted.
 *
 * This is the arithmetic behind the archive table and the numbers screen. It is kept here, away from the window, so
 * that every figure a person reads can be checked by a test rather than by looking at a chart and believing it.
 *
 * Three rules run through all of it, and they are the reason this file is longer than the sums in it:
 *
 * **Nothing is invented.** Every number comes out of the saved games. There is no sample record, no filled-in
 * average, no rating pulled out of the air. Where a figure cannot be worked out -- and several genuinely cannot --
 * the answer is a count of how many games could not be read that way, said out loud beside the figure.
 *
 * **"Unknown" is a real answer and is kept apart from zero.** A game with no date is not a game played in the year
 * zero, and a game where nobody wrote down who played is not a game you lost. Those games are counted into their
 * own `unknown` tallies and the screen says how many there are.
 *
 * **Which side you were is a question, not an assumption.** A saved game names two players; it does not say which
 * one is the person sitting here. So the person picks their name from the names that really appear in their own
 * games (`namesIn`), or picks "whoever played the engine", which Orbis can work out on its own for games it played.
 * Until that is settled, nothing is attributed to anybody.
 */

// ---------------------------------------------------------------------------------------------------------------
// Who "you" are

/** One name as it appears in the saved games, with how often. */
export interface NameCount {
  /** The name exactly as the games have it. */
  name: string
  games: number
  asWhite: number
  asBlack: number
  /** True when this name is the engine's in at least one game Orbis played, so it is probably not the person. */
  isEngine: boolean
}

/**
 * Who the numbers are about.
 *
 * `{ name }` is a player name as written in the games. `{ name: null }` means "whoever sat on the human side of the
 * games Orbis played against the engine", which Orbis can work out without being told, because it knows which side
 * the engine was.
 */
export interface Who {
  name: string | null
}

export const WHO_ENGINE_GAMES: Who = { name: null }

const engineNameOf = (game: StoredGame): string | null =>
  game.source.kind === 'local-engine' ? (game.source.engine ?? '').trim() || null : null

/** Every player name that really appears in these games, most games first. */
export function namesIn(games: readonly StoredGame[]): NameCount[] {
  const held = new Map<string, NameCount>()
  const note = (raw: string | undefined, side: 'w' | 'b', engine: boolean): void => {
    const name = (raw ?? '').trim()
    if (!name) return
    const key = nameKey(name)
    const had = held.get(key) ?? { name, games: 0, asWhite: 0, asBlack: 0, isEngine: false }
    had.games += 1
    if (side === 'w') had.asWhite += 1
    else had.asBlack += 1
    if (engine) had.isEngine = true
    held.set(key, had)
  }
  for (const game of games) {
    const engine = engineNameOf(game)
    const engineKey = engine === null ? null : nameKey(engine)
    note(game.meta.white.name, 'w', engineKey !== null && nameKey(game.meta.white.name ?? '') === engineKey)
    note(game.meta.black.name, 'b', engineKey !== null && nameKey(game.meta.black.name ?? '') === engineKey)
  }
  return [...held.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))
}

/**
 * Which side you played in one game, or null when the record does not say.
 *
 * For a chosen name this is name matching, folded the same way the library's search folds names so that "Kavin S"
 * and "kavin s" are one person. For "the games Orbis played" it is the other side from the engine: if one side
 * carries the engine's name, you are the other. If neither does -- a game played without giving a name, where the
 * handshake supplied nothing either -- the answer is null and the game is counted as "side not recorded" rather
 * than guessed at.
 */
export function sideFor(game: StoredGame, who: Who): 'w' | 'b' | null {
  if (who.name !== null) {
    const want = nameKey(who.name)
    if (!want) return null
    if (nameKey(game.meta.white.name ?? '') === want) return 'w'
    if (nameKey(game.meta.black.name ?? '') === want) return 'b'
    return null
  }
  if (game.source.kind !== 'local-engine') return null
  const engine = engineNameOf(game)
  if (engine === null) return null
  const key = nameKey(engine)
  if (nameKey(game.meta.white.name ?? '') === key) return 'b'
  if (nameKey(game.meta.black.name ?? '') === key) return 'w'
  return null
}

/** How many of these games Orbis itself played against the engine. */
export const engineGameCount = (games: readonly StoredGame[]): number =>
  games.filter((game) => sideFor(game, WHO_ENGINE_GAMES) !== null).length

/**
 * A first guess at who the person is, or null when there is nothing to go on.
 *
 * The guess is only ever made from a count: the name that appears in the most games and is never the engine's. It
 * is a starting point for the picker, never a claim -- the screen shows which name it is using and lets it be
 * changed.
 */
export function suggestWho(games: readonly StoredGame[]): Who | null {
  const names = namesIn(games).filter((one) => !one.isEngine)
  if (names.length > 0) return { name: names[0].name }
  return engineGameCount(games) > 0 ? WHO_ENGINE_GAMES : null
}

// ---------------------------------------------------------------------------------------------------------------
// One row of the archive table

export type GameOutcome = 'win' | 'loss' | 'draw' | 'unfinished'

/** The opening a game was in, as something that really named it. */
export interface OpeningName {
  eco: string
  name: string
  /** Where the name came from: the file's own tags, or the openings dataset matching a position in the game. */
  from: 'file' | 'dataset'
}

/** What the screen draws in one row of the table. Everything here was read off the game. */
export interface ArchiveRow {
  id: string
  game: StoredGame
  /** Which side you were, or null when the record does not say. */
  side: 'w' | 'b' | null
  outcome: GameOutcome
  /** Who you played, when the record names them. */
  opponent: string | null
  /** Their rating, only when the record carries one. */
  opponentRating: number | null
  opening: OpeningName | null
  /** How many moves were played, counting both sides. */
  moves: number
  /** How it ended, as the record says, or null. Never worked out from the result. */
  ended: string | null
  date: GameDate
  /** The first day this game could have been played, for ordering. Null when undated. */
  dayFrom: number | null
  /** The position at the end of the game, which is what the board shows for a selected row. */
  finalFen: string
}

/** The outcome of a game from one side's point of view. */
export function outcomeFor(result: GameResult, side: 'w' | 'b'): GameOutcome {
  if (result === '*') return 'unfinished'
  if (result === '1/2-1/2') return 'draw'
  const whiteWon = result === '1-0'
  return whiteWon === (side === 'w') ? 'win' : 'loss'
}

export const OUTCOME_WORDS: Record<GameOutcome, string> = {
  win: 'Won',
  loss: 'Lost',
  draw: 'Drawn',
  unfinished: 'No result'
}

/** How a game is named by the openings dataset, when the caller has one to ask. */
export type OpeningLookup = (game: StoredGame) => { eco: string; name: string } | null

/**
 * The opening of one game.
 *
 * The file's own tags come first, because a file that says what it was is better evidence than a position match.
 * When the file says nothing, the caller's lookup is asked -- that is the openings dataset, which is passed in
 * rather than imported so that this file can be tested without loading 578 kilobytes of opening data.
 */
export function openingOf(game: StoredGame, lookup?: OpeningLookup): OpeningName | null {
  const named = (game.meta.opening ?? '').trim()
  const eco = (game.meta.eco ?? '').trim()
  if (named) return { eco, name: named, from: 'file' }
  if (lookup) {
    const found = lookup(game)
    if (found) return { eco: found.eco, name: found.name, from: 'dataset' }
  }
  if (eco) return { eco, name: '', from: 'file' }
  return null
}

/** Turn the saved games into rows, from the point of view of whoever `who` is. */
export function archiveRows(games: readonly StoredGame[], who: Who | null, lookup?: OpeningLookup): ArchiveRow[] {
  return games.map((game) => {
    const side = who === null ? null : sideFor(game, who)
    const other = side === null ? null : side === 'w' ? game.meta.black : game.meta.white
    const date = parseGameDate(game.meta.date)
    const window = dateWindow(date)
    const last = game.moves[game.moves.length - 1]
    return {
      id: game.id,
      game,
      side,
      outcome: side === null ? 'unfinished' : outcomeFor(game.meta.result, side),
      opponent: (other?.name ?? '').trim() || null,
      opponentRating: typeof other?.rating === 'number' ? other.rating : null,
      opening: openingOf(game, lookup),
      moves: game.moves.length,
      ended: (game.meta.termination ?? '').trim() || null,
      date,
      dayFrom: window === null ? null : window.first,
      finalFen: last ? last.fen : game.startFen
    }
  })
}

// ---------------------------------------------------------------------------------------------------------------
// Sorting the table

export type ArchiveColumn = 'date' | 'opponent' | 'colour' | 'outcome' | 'opening' | 'moves' | 'ended' | 'rating'

export const COLUMN_WORDS: Record<ArchiveColumn, string> = {
  date: 'Date',
  opponent: 'Opponent',
  colour: 'Colour',
  outcome: 'Result',
  opening: 'Opening',
  moves: 'Moves',
  ended: 'How it ended',
  rating: 'Their rating'
}

const OUTCOME_RANK: Record<GameOutcome, number> = { win: 0, draw: 1, loss: 2, unfinished: 3 }

/**
 * Where one row sorts on one column.
 *
 * Null means "the record does not say", and a row that does not say always goes to the bottom whichever way the
 * column is pointed. Sorting undated games to the top of a date column as if they were ancient would be the table
 * making something up.
 */
function keyOf(row: ArchiveRow, column: ArchiveColumn): string | number | null {
  switch (column) {
    case 'date': return row.dayFrom
    case 'opponent': return row.opponent === null ? null : nameKey(row.opponent)
    case 'colour': return row.side === null ? null : row.side === 'w' ? 0 : 1
    case 'outcome': return row.side === null ? null : OUTCOME_RANK[row.outcome]
    case 'opening': return row.opening === null ? null : (row.opening.name || row.opening.eco).toLowerCase()
    case 'moves': return row.moves
    case 'ended': return row.ended === null ? null : row.ended.toLowerCase()
    case 'rating': return row.opponentRating
    default: return null
  }
}

export function sortRows(rows: readonly ArchiveRow[], column: ArchiveColumn, direction: 'up' | 'down'): ArchiveRow[] {
  const way = direction === 'up' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = keyOf(a, column)
    const right = keyOf(b, column)
    if (left === null && right === null) return b.game.updatedAt - a.game.updatedAt
    if (left === null) return 1
    if (right === null) return -1
    if (typeof left === 'number' && typeof right === 'number') {
      if (left !== right) return (left - right) * way
    } else if (String(left) !== String(right)) {
      return String(left).localeCompare(String(right)) * way
    }
    return b.game.updatedAt - a.game.updatedAt
  })
}

// ---------------------------------------------------------------------------------------------------------------
// The numbers

export interface Tally {
  played: number
  wins: number
  draws: number
  losses: number
  unfinished: number
  /**
   * Points out of the decided games, as chess counts them: a win is one, a draw is a half. Null when no game in
   * this tally has a result, because a score out of nothing is not zero.
   */
  score: number | null
  decided: number
}

const emptyTally = (): Tally => ({ played: 0, wins: 0, draws: 0, losses: 0, unfinished: 0, score: null, decided: 0 })

function add(tally: Tally, outcome: GameOutcome): void {
  tally.played += 1
  if (outcome === 'win') tally.wins += 1
  else if (outcome === 'loss') tally.losses += 1
  else if (outcome === 'draw') tally.draws += 1
  else tally.unfinished += 1
  tally.decided = tally.wins + tally.draws + tally.losses
  tally.score = tally.decided === 0 ? null : tally.wins + tally.draws / 2
}

/** The score as a percentage of the decided games, or null when none were decided. */
export const scoreShare = (tally: Tally): number | null =>
  tally.score === null || tally.decided === 0 ? null : tally.score / tally.decided

/** A tally said in words, with the refusal said too when there is nothing to say. */
export function tallyWords(tally: Tally): string {
  if (tally.played === 0) return 'No games.'
  const bits = [`${tally.wins} won`, `${tally.draws} drawn`, `${tally.losses} lost`]
  if (tally.unfinished > 0) bits.push(`${tally.unfinished} with no result recorded`)
  const share = scoreShare(tally)
  const scored = share === null ? '' : ` — ${Math.round(share * 100)}% of the ${tally.decided} decided`
  return `${bits.join(', ')}${scored}.`
}

export interface GroupTally extends Tally {
  /** What this group is: an opening name, a way a game ended. */
  label: string
  /** The code beside it, when there is one. Only ever an ECO code read off a game. */
  code: string
}

export interface MonthTally extends Tally {
  /** "2026-10". Only months that really have games appear. */
  month: string
}

/** One judgement mark that a game file itself carried, with how often it appears on your moves. */
export interface MarkCount {
  symbol: string
  meaning: string
  count: number
  /** How many separate games it appears in. */
  games: number
}

const MARK_MEANING: Record<string, string> = {
  '!!': 'an excellent move',
  '!': 'a good move',
  '!?': 'an interesting move',
  '?!': 'a dubious move',
  '?': 'a mistake',
  '??': 'a blunder'
}

/** The marks that mean the move was a bad one, which is what the mistakes list is counting. */
export const MISTAKE_MARKS = ['?!', '?', '??']

export interface ArchiveNumbers {
  /** How many games were counted: the ones where which side you were is known. */
  counted: number
  /** How many were left out because the record does not say which side you were. */
  sideNotRecorded: number
  all: Tally
  asWhite: Tally
  asBlack: Tally
  byOpening: GroupTally[]
  /** How many counted games had no opening name from anywhere. */
  openingNotNamed: number
  byEnding: GroupTally[]
  /** How many counted games do not say how they ended. */
  endingNotRecorded: number
  overTime: MonthTally[]
  /** How many counted games have no month, so they are in no bar of the chart. */
  undated: number
  /** Your wins over the opponents with the highest recorded rating. Empty when no opponent has one. */
  bestWins: ArchiveRow[]
  /** How many counted games carry an opponent rating at all. */
  ratingsRecorded: number
  /** The marks on your own moves, worst first. Read out of the games, never worked out here. */
  marks: MarkCount[]
  /** How many counted games carry any mark on your moves. */
  markedGames: number
  longestWinStreak: number
  /** The run of wins you are on now, counting back from the newest dated game. */
  currentWinStreak: number
  /** The average number of moves in a counted game, or null when there are none. */
  averageMoves: number | null
}

const monthOf = (date: GameDate): string | null =>
  date.year === undefined || date.month === undefined
    ? null
    : `${date.year}-${String(date.month).padStart(2, '0')}`

/** "2026-10" said the way a person reads it. */
export function monthWords(month: string): string {
  const [year, number] = month.split('-')
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const name = names[Number.parseInt(number, 10) - 1]
  return name ? `${name} ${year}` : month
}

function group(rows: readonly ArchiveRow[], of: (row: ArchiveRow) => { label: string; code: string } | null): { list: GroupTally[]; missing: number } {
  const held = new Map<string, GroupTally>()
  let missing = 0
  for (const row of rows) {
    const which = of(row)
    if (which === null) {
      missing += 1
      continue
    }
    const key = `${which.code}|${which.label}`.toLowerCase()
    const had = held.get(key) ?? { ...emptyTally(), label: which.label, code: which.code }
    add(had, row.outcome)
    held.set(key, had)
  }
  const list = [...held.values()].sort((a, b) => b.played - a.played || a.label.localeCompare(b.label))
  return { list, missing }
}

/**
 * Everything on the numbers screen, from the saved games and nothing else.
 *
 * Only games where which side you were is known are counted. The rest are counted once, into
 * `sideNotRecorded`, and the screen says the figure so that a small total is explained rather than mysterious.
 */
export function archiveNumbers(rows: readonly ArchiveRow[]): ArchiveNumbers {
  const mine = rows.filter((row) => row.side !== null)
  const all = emptyTally()
  const asWhite = emptyTally()
  const asBlack = emptyTally()
  for (const row of mine) {
    add(all, row.outcome)
    add(row.side === 'w' ? asWhite : asBlack, row.outcome)
  }

  const openings = group(mine, (row) =>
    row.opening === null ? null : { label: row.opening.name || row.opening.eco, code: row.opening.eco })
  const endings = group(mine, (row) => (row.ended === null ? null : { label: row.ended, code: '' }))

  const months = new Map<string, MonthTally>()
  let undated = 0
  for (const row of mine) {
    const month = monthOf(row.date)
    if (month === null) {
      undated += 1
      continue
    }
    const had = months.get(month) ?? { ...emptyTally(), month }
    add(had, row.outcome)
    months.set(month, had)
  }

  const rated = mine.filter((row) => row.opponentRating !== null)
  const bestWins = rated
    .filter((row) => row.outcome === 'win')
    .sort((a, b) => (b.opponentRating ?? 0) - (a.opponentRating ?? 0))
    .slice(0, 5)

  const marks = new Map<string, MarkCount>()
  let markedGames = 0
  for (const row of mine) {
    let anyHere = false
    row.game.moves.forEach((move, index) => {
      // Your moves only. Ply 0 is White's first move, so even plies are White's.
      const mover = index % 2 === 0 ? 'w' : 'b'
      if (mover !== row.side) return
      for (const written of move.nag ?? []) {
        const symbol = written.trim()
        const meaning = MARK_MEANING[symbol]
        if (!meaning) continue
        const had = marks.get(symbol) ?? { symbol, meaning, count: 0, games: 0 }
        had.count += 1
        if (!anyHere) had.games += 1
        marks.set(symbol, had)
        anyHere = true
      }
    })
    if (anyHere) markedGames += 1
  }
  // Worst first, because that is what a person is looking for in a list of their own mistakes.
  const order = ['??', '?', '?!', '!?', '!', '!!']
  const markList = [...marks.values()].sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol))

  // Streaks are counted over the dated, decided games in the order they were played. Undated games are left out
  // rather than dropped into the sequence somewhere, which would make up an order that is not known.
  const inOrder = mine
    .filter((row) => row.dayFrom !== null && row.outcome !== 'unfinished')
    .sort((a, b) => (a.dayFrom ?? 0) - (b.dayFrom ?? 0) || a.game.createdAt - b.game.createdAt)
  let longest = 0
  let run = 0
  for (const row of inOrder) {
    run = row.outcome === 'win' ? run + 1 : 0
    if (run > longest) longest = run
  }
  let current = 0
  for (let i = inOrder.length - 1; i >= 0; i--) {
    if (inOrder[i].outcome !== 'win') break
    current += 1
  }

  return {
    counted: mine.length,
    sideNotRecorded: rows.length - mine.length,
    all,
    asWhite,
    asBlack,
    byOpening: openings.list,
    openingNotNamed: openings.missing,
    byEnding: endings.list,
    endingNotRecorded: endings.missing,
    overTime: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)),
    undated,
    bestWins,
    ratingsRecorded: rated.length,
    marks: markList,
    markedGames,
    longestWinStreak: longest,
    currentWinStreak: current,
    averageMoves: mine.length === 0 ? null : Math.round(mine.reduce((sum, row) => sum + row.moves, 0) / mine.length)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// A rating, and why there is not one

/**
 * Why this screen shows no playing rating.
 *
 * A rating is a number worked out from results against opponents whose strength is already known: that is the whole
 * method, whichever formula is used. Elo needs the opponent's rating to work out what was expected; Glicko needs it
 * and a reliability figure as well. Orbis has neither for the games it holds:
 *
 *   - Games against the engine. The opponent is one of nine rungs over Stockfish's own skill dial, and
 *     `src/shared/chess/opponents.ts` refuses on purpose to put a rating on a rung, because nobody has measured one.
 *     Orbis deliberately does not set UCI_Elo either. So there is no known strength to compare a result against.
 *   - Imported games. Some PGN files carry the opponent's rating and most do not, and the ones that do are ratings
 *     from somewhere else, on somebody else's scale, at some other time.
 *
 * A number worked out from unknown strengths would be a made-up number with a decimal point on it, and this screen
 * would be the one place in Chess World that invents a figure. So there is no rating, and this sentence is shown
 * instead. The puzzle rating in `puzzleRating.ts` is a different thing and exists: the puzzles have a measured
 * difficulty, so there is something real to rate against.
 *
 * What would make a rating possible, for whoever comes to this next: a measured strength for each engine rung, from
 * a run of games between the rungs themselves. Then the rungs are the anchor and the usual Elo update applies.
 */
export const NO_PLAYING_RATING =
  'Orbis does not show a playing rating. A rating is worked out from results against opponents whose strength is already known, and none of your opponents has a strength Orbis has measured: the engine rungs are not rated, and a rating written in an imported file came from somewhere else. A number here would be invented.'

/** What the numbers screen says when there is nothing to count yet. */
export const NOTHING_YET =
  'There are no saved games yet, so there is nothing to count. Bring in a PGN file or play a game, and every figure on this screen fills in from it.'
