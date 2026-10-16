import { applyMove, positionKey, type PieceLetter } from './rules.ts'
import type { StoredGame } from './model.ts'
import type { Material, SideMaterial } from './variants.ts'
import { OPENING_SOURCE, recordFor, type OpeningDataSource, type OpeningRecord } from './openings.ts'

/**
 * Finding a position among your own games (Sections 181-186).
 *
 * The question is "have I had this before, and where": a position on the board, and every game of yours that reached
 * it. The whole of this file turns on one distinction, and it is the distinction a database gets wrong:
 *
 *   - **The same position** means the same position *for the purpose of what is legal now*. That is `positionKey`
 *     from rules.ts -- the pieces, the side to move, the castling rights and the en passant square. Two boards that
 *     look identical and differ in castling rights are NOT the same position, because different moves are legal in
 *     them, and merging them would answer a question nobody asked. This is the EXACT search, and it is the only one
 *     allowed to call itself exact.
 *
 *   - **Structural** matching is looser on purpose: the same pieces whoever is to move, or the same pawn skeleton
 *     whatever the pieces are. Those are real questions -- "when have I had this pawn structure" is how people
 *     study -- but a structural answer is not the same answer. So every rule here carries its own `ignores` list in
 *     plain words, every result carries that list with it, and `exact` is true for exactly one rule. A screen cannot
 *     show a structural result without the sentence that says what it let through, because the sentence travels
 *     inside the result.
 *
 * ## Why there is an index
 *
 * A library of five thousand games holds something like four hundred thousand positions. Answering "where have I had
 * this" by walking all of them is fine once and miserable the second time, and a person setting a position up on a
 * board asks the same question twenty times in a row. So the library is read once into a map from key to the places
 * that key occurs, and a search after that is one map lookup.
 *
 * ## Why the index reads the stored positions rather than replaying the games
 *
 * A `StoredGame` keeps the position after every move (`GameMove.fen`), written by rules.ts at the moment the move was
 * played. The index reads those. Replaying instead would mean asking rules.ts for every position again -- about a
 * million moves for a library of that size, each one building a full description of itself -- which is slow enough to
 * be a different feature.
 *
 * What that costs in honesty is said out loud rather than hidden: the index trusts what was stored. `scanGames`
 * below is the other answer -- it replays every game through rules.ts and trusts nothing -- and `verifyIndex`
 * compares the two. The tests run that comparison over a fixture library, which is the only thing that makes the
 * fast answer worth believing.
 *
 * Every position read is still shape-checked, so a record whose FEN is malformed is **left out and listed** in
 * `skipped` rather than indexed as if it were a position. Nothing here is silent.
 *
 * ## What is not in here
 *
 * No evaluations, no counts of how often a move was played from a position, no ratings. This searches the person's
 * own games and reports what is in them. Nothing is inferred and nothing is invented.
 *
 * Pure: no storage, no clock, no engine, no Electron.
 */

// ---------------------------------------------------------------------------------------------------------------
// Reading a position cheaply, and agreeing with rules.ts about what it says

const PIECE_CHARS = new Set(['p', 'n', 'b', 'r', 'q', 'k', 'P', 'N', 'B', 'R', 'Q', 'K'])

interface Fields {
  placement: string
  turn: string
  castling: string
  enPassant: string
}

/**
 * A FEN split into the four fields that decide what is legal, with a shape check on the way through.
 *
 * This is **shape, not legality**. It proves the text really describes eight rows of eight squares with nothing in
 * them that is not a piece, and that the side to move is one of the two. It does not prove the position is reachable
 * or even that there are two kings; `checkFen` in rules.ts does that, and it is not run here because running it on
 * every position of every game is exactly the cost the index exists to avoid.
 *
 * That is a safe trade only because of where these positions come from: each one was written by rules.ts when the
 * move was played, so it was legal then. A malformed one means the record was damaged, and a damaged record is
 * reported rather than searched.
 *
 * The clocks are deliberately not part of this. rules.ts leaves them out of a position's identity because they
 * change what a draw *claim* does rather than what is legal now, and a search that included them would miss every
 * real repeat of a position.
 */
function fieldsOf(fen: string): Fields | null {
  const text = (fen ?? '').trim()
  if (!text) return null
  const f = text.split(/\s+/)
  if (f.length < 4) return null
  const placement = f[0]
  let squares = 0
  let rows = 1
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i]
    if (ch === '/') {
      if (squares !== 8) return null
      squares = 0
      rows += 1
      continue
    }
    if (ch >= '1' && ch <= '8') {
      squares += ch.charCodeAt(0) - 48
      continue
    }
    if (!PIECE_CHARS.has(ch)) return null
    squares += 1
  }
  if (rows !== 8 || squares !== 8) return null
  if (f[1] !== 'w' && f[1] !== 'b') return null
  return { placement, turn: f[1], castling: f[2], enPassant: f[3] }
}

/**
 * The pawns, and nothing else, written the way a board is written.
 *
 * Every piece that is not a pawn becomes an empty square, so a rook ending with the same pawns as a queen ending has
 * the same skeleton. Run lengths can never exceed eight, because they are reset at every row break, so the result
 * reads back as a board.
 */
function pawnSkeleton(placement: string): string {
  let out = ''
  let gap = 0
  const flush = (): void => {
    if (gap > 0) {
      out += String(gap)
      gap = 0
    }
  }
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i]
    if (ch === '/') {
      flush()
      out += '/'
      continue
    }
    if (ch >= '1' && ch <= '8') {
      gap += ch.charCodeAt(0) - 48
      continue
    }
    if (ch === 'P' || ch === 'p') {
      flush()
      out += ch
      continue
    }
    gap += 1
  }
  flush()
  return out
}

const blankSide = (): SideMaterial => ({ p: 0, n: 0, b: 0, r: 0, q: 0, k: 0, men: 0, lightBishops: 0, darkBishops: 0 })

/**
 * What is on the board, counted straight out of the placement field.
 *
 * `materialOf` in variants.ts counts the same thing from a list of squares, and that is the one a screen should use.
 * This one exists because the index counts material for every position of every game, and going through
 * `boardSquares` would mean loading each position into the rules library and allocating an object per piece --
 * millions of them for a real library.
 *
 * The two must agree, and `positionSearch.test.ts` holds them together over a few hundred real positions. If they
 * ever disagree, this one is wrong.
 */
function materialFromPlacement(placement: string): Material {
  const material: Material = { w: blankSide(), b: blankSide() }
  let file = 0
  let rank = 8
  for (let i = 0; i < placement.length; i++) {
    const ch = placement[i]
    if (ch === '/') {
      rank -= 1
      file = 0
      continue
    }
    if (ch >= '1' && ch <= '8') {
      file += ch.charCodeAt(0) - 48
      continue
    }
    const white = ch !== ch.toLowerCase()
    const type = ch.toLowerCase() as PieceLetter
    const side = white ? material.w : material.b
    side[type] += 1
    side.men += 1
    if (type === 'b') {
      // The same rule as `isLightSquare` in variants.ts, so the two files put a bishop in the same bucket. Only
      // whether two bishops share a bucket is ever asked here -- never what the bucket is called -- so nothing in
      // this file tells a person a square is light or dark.
      if ((file + rank) % 2 === 1) side.lightBishops += 1
      else side.darkBishops += 1
    }
    file += 1
  }
  return material
}

/** What is on the board in a position, or null when the position cannot be read. */
export function materialOfFen(fen: string): Material | null {
  const fields = fieldsOf(fen)
  return fields ? materialFromPlacement(fields.placement) : null
}

/**
 * Material written as one short string, so two positions with the same men share it.
 *
 * Bishops are counted by the colour of the square they stand on, because that is the difference between a drawn
 * ending and a won one and it costs nothing to keep.
 */
export function materialSignature(material: Material): string {
  const side = (s: SideMaterial): string => `${s.p},${s.n},${s.lightBishops},${s.darkBishops},${s.r},${s.q},${s.k}`
  return `${side(material.w)}|${side(material.b)}`
}

// ---------------------------------------------------------------------------------------------------------------
// The rules a search can match by

export type MatchRuleId = 'exact' | 'placement' | 'placement-and-turn' | 'pawns'

export interface MatchRule {
  id: MatchRuleId
  label: string
  /**
   * True for exactly one rule.
   *
   * Everything else is a structural rule and must never be shown as an exact match. The flag is carried into every
   * result so a screen cannot lose it.
   */
  exact: boolean
  /** What this rule treats as part of the position. */
  counts: string[]
  /** What it deliberately leaves out. Never empty, including for the exact rule. */
  ignores: string[]
  /** The sentence that has to be shown beside a result from this rule. */
  caution: string
  /** How a position becomes a key under this rule. Null when the position cannot be read. */
  keyOf: (fen: string) => string | null
}

/**
 * The matching rules.
 *
 * The exact rule's key is `positionKey` from rules.ts, called directly rather than rebuilt, so there is one idea of
 * "the same position" in Orbis and this file cannot drift from it.
 */
export const MATCH_RULES: readonly MatchRule[] = Object.freeze([
  Object.freeze({
    id: 'exact' as const,
    label: 'The same position',
    exact: true,
    counts: ['where every piece stands', 'whose turn it is', 'the castling rights', 'the en passant square'],
    ignores: ['the halfmove clock', 'the move number'],
    caution:
      'The clocks are not part of a position: they change what a draw claim does, not what is legal now. Everything '
      + 'that decides a legal move is matched, so a board that looks the same but has lost a castling right is not a match.',
    keyOf: (fen: string): string | null => (fieldsOf(fen) ? positionKey(fen) : null)
  }),
  Object.freeze({
    id: 'placement' as const,
    label: 'The same pieces, wherever the turn is',
    exact: false,
    counts: ['where every piece stands'],
    ignores: ['whose turn it is', 'the castling rights', 'the en passant square', 'the halfmove clock', 'the move number'],
    caution:
      'This is not an exact match. It can return a position where it is the other side to move, or where a castling '
      + 'right differs, so the moves available there are not the moves available here.',
    keyOf: (fen: string): string | null => fieldsOf(fen)?.placement ?? null
  }),
  Object.freeze({
    id: 'placement-and-turn' as const,
    label: 'The same pieces, same side to move',
    exact: false,
    counts: ['where every piece stands', 'whose turn it is'],
    ignores: ['the castling rights', 'the en passant square', 'the halfmove clock', 'the move number'],
    caution:
      'This is not an exact match. Castling rights and the en passant square are ignored, and both change what is '
      + 'legal, so a result can be a position you could not have played the same move in.',
    keyOf: (fen: string): string | null => {
      const fields = fieldsOf(fen)
      return fields ? `${fields.placement} ${fields.turn}` : null
    }
  }),
  Object.freeze({
    id: 'pawns' as const,
    label: 'The same pawn structure',
    exact: false,
    counts: ['where the pawns of both sides stand'],
    ignores: ['every piece that is not a pawn', 'whose turn it is', 'the castling rights', 'the en passant square', 'the clocks'],
    caution:
      'This is not an exact match, and it is the loosest rule here: only the pawns are compared. A rook ending and a '
      + 'queen ending with the same pawns are the same structure.',
    keyOf: (fen: string): string | null => {
      const fields = fieldsOf(fen)
      return fields ? pawnSkeleton(fields.placement) : null
    }
  })
])

export const DEFAULT_RULE: MatchRuleId = 'exact'

export const matchRule = (id: MatchRuleId): MatchRule => MATCH_RULES.find((one) => one.id === id) ?? MATCH_RULES[0]

/** The key a position has under a rule, or null when the position cannot be read. */
export const keyFor = (id: MatchRuleId, fen: string): string | null => matchRule(id).keyOf(fen)

/** A rule said in one line, for a control that has to explain itself. */
export function ruleWords(rule: MatchRule): string {
  return `${rule.exact ? 'Exact' : 'Structural'}: matches ${rule.counts.join(', ')}; ignores ${rule.ignores.join(', ')}.`
}

// ---------------------------------------------------------------------------------------------------------------
// The index

export interface PositionHit {
  gameId: string
  /** 0 is the position the game starts from; 1 is after the first move. */
  ply: number
}

export interface SkippedPosition {
  gameId: string
  ply: number
  /** Said plainly: what was wrong with the record. */
  why: string
}

export interface MaterialBucket {
  signature: string
  material: Material
  where: PositionHit[]
}

export interface LibraryIndex {
  /** Which rule `byKey` was built with. A search by another rule needs another index. */
  rule: MatchRuleId
  /** Games read into it. */
  games: number
  /** Positions read into it, counting each game's starting position. */
  positions: number
  /** Key to every place that key occurs, in the order the games were given. */
  byKey: Map<string, PositionHit[]>
  /** Material to every place it occurs. Built in the same pass, because material search needs nothing else. */
  byMaterial: Map<string, MaterialBucket>
  /** The games themselves, so a result can name one without searching the list again. */
  gamesById: Map<string, StoredGame>
  /** Positions that were left out, and why. Never silent. */
  skipped: SkippedPosition[]
}

export interface IndexProgress {
  /** Games read so far. */
  games: number
  /** Games in all. */
  total: number
  positions: number
  done: boolean
  /** 0 to 1, or null when there is nothing to read. */
  fraction: number | null
}

/**
 * A build in progress.
 *
 * Deliberately a mutable thing. The alternative -- copying a map of a hundred thousand keys once per chunk -- costs
 * far more than the whole search it is preparing for, so `stepIndex` advances the build it is given and hands it
 * back. Nothing else in this module writes to an index once it is done.
 */
export interface IndexBuild {
  index: LibraryIndex
  progress: IndexProgress
  /** The games being read, and how far through them this build is. */
  source: readonly StoredGame[]
  at: number
}

const emptyIndex = (rule: MatchRuleId): LibraryIndex => ({
  rule,
  games: 0,
  positions: 0,
  byKey: new Map(),
  byMaterial: new Map(),
  gamesById: new Map(),
  skipped: []
})

const progressOf = (at: number, total: number, positions: number): IndexProgress => ({
  games: at,
  total,
  positions,
  done: at >= total,
  fraction: total === 0 ? null : Math.min(1, at / total)
})

/** A build that has read nothing yet. */
export function startIndex(games: readonly StoredGame[], rule: MatchRuleId = DEFAULT_RULE): IndexBuild {
  return {
    index: emptyIndex(rule),
    progress: progressOf(0, games.length, 0),
    source: games,
    at: 0
  }
}

/** Every position in a game, in order: the starting position, then the position after each move. */
export function positionsOf(game: Pick<StoredGame, 'startFen' | 'moves'>): { ply: number; fen: string }[] {
  const out: { ply: number; fen: string }[] = [{ ply: 0, fen: game.startFen }]
  for (const [index, move] of game.moves.entries()) out.push({ ply: index + 1, fen: move.fen })
  return out
}

const push = (map: Map<string, PositionHit[]>, key: string, hit: PositionHit): void => {
  const had = map.get(key)
  if (had) had.push(hit)
  else map.set(key, [hit])
}

function readGame(index: LibraryIndex, game: StoredGame, keyOf: (fen: string) => string | null): void {
  index.gamesById.set(game.id, game)
  index.games += 1
  for (const { ply, fen } of positionsOf(game)) {
    const fields = fieldsOf(fen)
    if (!fields) {
      index.skipped.push({
        gameId: game.id,
        ply,
        why: ply === 0
          ? 'The position this game starts from is not a readable board, so none of it could be searched.'
          : `The position stored after move ${ply} is not a readable board, so that move was left out.`
      })
      continue
    }
    const key = keyOf(fen)
    if (key === null) {
      index.skipped.push({ gameId: game.id, ply, why: `The position after move ${ply} could not be turned into a key.` })
      continue
    }
    index.positions += 1
    const hit: PositionHit = { gameId: game.id, ply }
    push(index.byKey, key, hit)
    const material = materialFromPlacement(fields.placement)
    const signature = materialSignature(material)
    const bucket = index.byMaterial.get(signature)
    if (bucket) bucket.where.push(hit)
    else index.byMaterial.set(signature, { signature, material, where: [hit] })
  }
}

/**
 * Reads the next few games into the build.
 *
 * `games` is how many to read before handing control back, which is what lets a window stay answerable while a big
 * library is read: a screen steps the build, draws the progress, and steps it again.
 */
export function stepIndex(build: IndexBuild, games = 200): IndexBuild {
  if (build.progress.done) return build
  const keyOf = matchRule(build.index.rule).keyOf
  const until = Math.min(build.source.length, build.at + Math.max(1, Math.round(games)))
  for (let i = build.at; i < until; i++) readGame(build.index, build.source[i], keyOf)
  build.at = until
  build.progress = progressOf(until, build.source.length, build.index.positions)
  return build
}

/** The whole index in one go, reporting progress as it goes. For a small library, or for a test. */
export function buildIndex(
  games: readonly StoredGame[],
  rule: MatchRuleId = DEFAULT_RULE,
  options: { onProgress?: (progress: IndexProgress) => void; chunk?: number } = {}
): LibraryIndex {
  let build = startIndex(games, rule)
  options.onProgress?.(build.progress)
  while (!build.progress.done) {
    build = stepIndex(build, options.chunk ?? 200)
    options.onProgress?.(build.progress)
  }
  return build.index
}

// ---------------------------------------------------------------------------------------------------------------
// Searching

export interface SearchHit {
  gameId: string
  game: StoredGame
  /** Every ply in this game where it occurs, lowest first. A repeated position occurs more than once. */
  plies: number[]
  /** The first of them, which is the one a screen opens at. */
  ply: number
}

export interface PositionSearchResult {
  rule: MatchRule
  /** True only for the exact rule. Copied out of the rule so it cannot be read off the wrong thing. */
  exact: boolean
  /** What the rule ignored, in plain words, carried here so a result cannot be shown without it. */
  ignores: string[]
  caution: string
  /** The position that was asked about, as it was given. */
  fen: string
  /** Its key under this rule, or null when it could not be read. */
  key: string | null
  /** Why there is no answer, when there is none. */
  problem?: string
  hits: SearchHit[]
  /** How much was looked at to get this answer. */
  searched: { games: number; positions: number }
  /** What could not be looked at, and why. */
  skipped: SkippedPosition[]
}

function collect(places: readonly PositionHit[], gamesById: Map<string, StoredGame>): SearchHit[] {
  // Grouped by game, keeping the order the games were read in, so the list does not reshuffle between searches.
  const order: string[] = []
  const plies = new Map<string, number[]>()
  for (const place of places) {
    const had = plies.get(place.gameId)
    if (had) had.push(place.ply)
    else {
      order.push(place.gameId)
      plies.set(place.gameId, [place.ply])
    }
  }
  const out: SearchHit[] = []
  for (const gameId of order) {
    const game = gamesById.get(gameId)
    if (!game) continue
    const list = (plies.get(gameId) ?? []).slice().sort((a, b) => a - b)
    out.push({ gameId, game, plies: list, ply: list[0] ?? 0 })
  }
  return out
}

/** The answer when a key could not be made, so every caller gets the same shape. */
function noKey(index: LibraryIndex, fen: string, problem: string): PositionSearchResult {
  const rule = matchRule(index.rule)
  return {
    rule,
    exact: rule.exact,
    ignores: [...rule.ignores],
    caution: rule.caution,
    fen,
    key: null,
    problem,
    hits: [],
    searched: { games: index.games, positions: index.positions },
    skipped: index.skipped
  }
}

/** Every game in the index that reached this exact key under the index's rule. */
export function searchByKey(index: LibraryIndex, key: string, fen = ''): PositionSearchResult {
  const rule = matchRule(index.rule)
  return {
    rule,
    exact: rule.exact,
    ignores: [...rule.ignores],
    caution: rule.caution,
    fen,
    key,
    hits: collect(index.byKey.get(key) ?? [], index.gamesById),
    searched: { games: index.games, positions: index.positions },
    skipped: index.skipped
  }
}

/** Every game in the index that reached this position, by the rule the index was built with. */
export function searchIndex(index: LibraryIndex, fen: string): PositionSearchResult {
  const rule = matchRule(index.rule)
  if (!fieldsOf(fen)) {
    return noKey(index, fen, 'That is not a readable board, so there is nothing to look for.')
  }
  const key = rule.keyOf(fen)
  if (key === null) return noKey(index, fen, 'That position could not be turned into a key.')
  return searchByKey(index, key, fen)
}

// ---------------------------------------------------------------------------------------------------------------
// The slow answer, which is what makes the fast one worth believing

export type WalkedPosition = { ply: number; fen: string; skip?: undefined } | { ply: number; fen?: undefined; skip: string }

/**
 * Every position in a game, worked out rather than read.
 *
 * `replay` plays the game's moves through rules.ts from its starting position, so the positions come from the
 * authority on chess rather than from what was written down when the move was made. That is what makes it a second
 * opinion: if a record's stored position ever disagreed with the move it is supposed to follow, the index would
 * answer from the stored one and this would answer from the rules, and `verifyIndex` would say so.
 *
 * `stored` reads the positions as the record keeps them -- the same source the index uses -- and is here for the
 * one case where that is what is wanted: checking the grouping and ordering without the replay's cost.
 *
 * A move that will not play stops that game's walk and is reported. Nothing after it can be trusted, so nothing
 * after it is claimed.
 */
export function walkGame(game: Pick<StoredGame, 'startFen' | 'moves'>, how: 'replay' | 'stored' = 'replay'): WalkedPosition[] {
  if (!fieldsOf(game.startFen)) {
    return [{ ply: 0, skip: 'The position this game starts from is not a readable board, so none of it could be walked.' }]
  }
  const out: WalkedPosition[] = [{ ply: 0, fen: game.startFen }]
  if (how === 'stored') {
    for (const [index, move] of game.moves.entries()) {
      if (fieldsOf(move.fen)) out.push({ ply: index + 1, fen: move.fen })
      else out.push({ ply: index + 1, skip: `The position stored after move ${index + 1} is not a readable board.` })
    }
    return out
  }
  let fen = game.startFen
  for (const [index, move] of game.moves.entries()) {
    const made = applyMove(fen, move.uci || move.san)
    if (!made) {
      out.push({
        ply: index + 1,
        skip: `Move ${index + 1}${move.san ? ` (${move.san})` : ''} cannot be played in the position before it, so the replay stopped there.`
      })
      return out
    }
    fen = made.after
    out.push({ ply: index + 1, fen })
  }
  return out
}

/**
 * The same search done the long way.
 *
 * It is here for two reasons: a library small enough not to need an index can be searched with it directly, and
 * `verifyIndex` compares it against the index so the fast path is checked rather than assumed. By default it
 * replays every game through rules.ts, which is slow and is the point.
 */
export function scanGames(
  games: readonly StoredGame[],
  fen: string,
  ruleId: MatchRuleId = DEFAULT_RULE,
  options: { onProgress?: (progress: IndexProgress) => void; how?: 'replay' | 'stored' } = {}
): PositionSearchResult {
  const rule = matchRule(ruleId)
  const base: Omit<PositionSearchResult, 'key' | 'hits' | 'problem'> = {
    rule,
    exact: rule.exact,
    ignores: [...rule.ignores],
    caution: rule.caution,
    fen,
    searched: { games: 0, positions: 0 },
    skipped: []
  }
  if (!fieldsOf(fen)) {
    return { ...base, key: null, hits: [], problem: 'That is not a readable board, so there is nothing to look for.' }
  }
  const want = rule.keyOf(fen)
  if (want === null) return { ...base, key: null, hits: [], problem: 'That position could not be turned into a key.' }

  const hits: SearchHit[] = []
  const skipped: SkippedPosition[] = []
  let positions = 0
  for (const [index, game] of games.entries()) {
    const plies: number[] = []
    for (const step of walkGame(game, options.how ?? 'replay')) {
      if (step.fen === undefined) {
        skipped.push({ gameId: game.id, ply: step.ply, why: step.skip })
        continue
      }
      positions += 1
      if (rule.keyOf(step.fen) === want) plies.push(step.ply)
    }
    if (plies.length) hits.push({ gameId: game.id, game, plies, ply: plies[0] })
    options.onProgress?.(progressOf(index + 1, games.length, positions))
  }
  return { ...base, key: want, hits, searched: { games: games.length, positions }, skipped }
}

export interface IndexCheck {
  agree: boolean
  /** Said plainly, one line, whether it agrees or not. */
  says: string
  /** Games the index found and the scan did not, and the other way round. */
  onlyInIndex: { gameId: string; plies: number[] }[]
  onlyInScan: { gameId: string; plies: number[] }[]
  /** Games both found, at different moves. */
  differentPlies: { gameId: string; index: number[]; scan: number[] }[]
}

/** Whether the index and a replay of the same games give the same answer for one position. */
export function verifyIndex(index: LibraryIndex, games: readonly StoredGame[], fen: string): IndexCheck {
  const fast = searchIndex(index, fen)
  const slow = scanGames(games, fen, index.rule)
  const fastBy = new Map(fast.hits.map((one) => [one.gameId, one.plies]))
  const slowBy = new Map(slow.hits.map((one) => [one.gameId, one.plies]))
  const onlyInIndex: IndexCheck['onlyInIndex'] = []
  const onlyInScan: IndexCheck['onlyInScan'] = []
  const differentPlies: IndexCheck['differentPlies'] = []
  for (const [gameId, plies] of fastBy) {
    const other = slowBy.get(gameId)
    if (!other) {
      onlyInIndex.push({ gameId, plies })
      continue
    }
    if (plies.length !== other.length || plies.some((ply, i) => ply !== other[i])) {
      differentPlies.push({ gameId, index: plies, scan: other })
    }
  }
  for (const [gameId, plies] of slowBy) if (!fastBy.has(gameId)) onlyInScan.push({ gameId, plies })
  const agree = onlyInIndex.length === 0 && onlyInScan.length === 0 && differentPlies.length === 0
  return {
    agree,
    says: agree
      ? `The index and a full replay of ${games.length} ${games.length === 1 ? 'game' : 'games'} give the same ${fast.hits.length} ${fast.hits.length === 1 ? 'result' : 'results'}.`
      : `The index and a full replay disagree: ${onlyInIndex.length} only in the index, ${onlyInScan.length} only in the replay, ${differentPlies.length} at different moves.`,
    onlyInIndex,
    onlyInScan,
    differentPlies
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Material patterns: "rook endings", and the rest

export type Comparison = { at: 'least' | 'most' | 'exactly'; count: number }

export const atLeast = (count: number): Comparison => ({ at: 'least', count })
export const atMost = (count: number): Comparison => ({ at: 'most', count })
export const exactly = (count: number): Comparison => ({ at: 'exactly', count })

export interface SideCounts {
  p?: Comparison
  n?: Comparison
  b?: Comparison
  r?: Comparison
  q?: Comparison
}

export interface MaterialPattern {
  id: string
  label: string
  /** What it asks for, and what it does not ask about. Shown with every result. */
  says: string
  /**
   * How the two sides are read.
   *
   * 'as-written' means `white` is White's requirement. 'either-side' matches when one side meets `white` and the
   * other meets `black`, whichever way round -- which is what "rook and pawn against rook" has to mean, because
   * nobody searching for it cares which colour is a pawn up.
   */
  sides: 'as-written' | 'either-side'
  white?: SideCounts
  black?: SideCounts
  /** Pieces that must not be on the board at all, on either side. */
  without?: PieceLetter[]
  /** Men on the board, kings included. */
  men?: Comparison
  /**
   * Where the bishops stand.
   *
   * 'opposite-colours' means each side has at least one bishop, all of White's stand on one square colour, all of
   * Black's on the other. 'same-colour' means each side has at least one and every bishop on the board stands on
   * squares of the same colour.
   */
  bishops?: 'same-colour' | 'opposite-colours'
}

const meets = (count: number, rule: Comparison | undefined): boolean => {
  if (!rule) return true
  if (rule.at === 'least') return count >= rule.count
  if (rule.at === 'most') return count <= rule.count
  return count === rule.count
}

function sideMeets(side: SideMaterial, want: SideCounts | undefined): boolean {
  if (!want) return true
  return meets(side.p, want.p)
    && meets(side.n, want.n)
    && meets(side.lightBishops + side.darkBishops, want.b)
    && meets(side.r, want.r)
    && meets(side.q, want.q)
}

function bishopsMeet(material: Material, want: MaterialPattern['bishops']): boolean {
  if (!want) return true
  const w = { light: material.w.lightBishops, dark: material.w.darkBishops }
  const b = { light: material.b.lightBishops, dark: material.b.darkBishops }
  if (w.light + w.dark === 0 || b.light + b.dark === 0) return false
  if (want === 'opposite-colours') {
    return (w.light > 0 && w.dark === 0 && b.dark > 0 && b.light === 0)
      || (w.dark > 0 && w.light === 0 && b.light > 0 && b.dark === 0)
  }
  return (w.dark === 0 && b.dark === 0) || (w.light === 0 && b.light === 0)
}

/** Whether what is on the board matches a pattern. */
export function matchesMaterial(material: Material, pattern: MaterialPattern): boolean {
  for (const piece of pattern.without ?? []) {
    const count = piece === 'b'
      ? material.w.lightBishops + material.w.darkBishops + material.b.lightBishops + material.b.darkBishops
      : material.w[piece] + material.b[piece]
    if (count !== 0) return false
  }
  if (!meets(material.w.men + material.b.men, pattern.men)) return false
  if (!bishopsMeet(material, pattern.bishops)) return false
  const straight = sideMeets(material.w, pattern.white) && sideMeets(material.b, pattern.black)
  if (pattern.sides === 'as-written') return straight
  return straight || (sideMeets(material.b, pattern.white) && sideMeets(material.w, pattern.black))
}

/**
 * The patterns worth offering.
 *
 * Every one of them is a class of ending people really study, written out so that what it includes is readable
 * rather than hidden in a number. None of them says anything about pawns unless the ending is about pawns, because
 * "a rook ending" is about the pieces.
 */
export const MATERIAL_PATTERNS: readonly MaterialPattern[] = Object.freeze([
  Object.freeze({
    id: 'rook-endings',
    label: 'Rook endings',
    says: 'Both sides have at least one rook, and there are no queens, knights or bishops. Pawns are not counted.',
    sides: 'either-side' as const,
    white: { r: atLeast(1) },
    black: { r: atLeast(1) },
    without: ['q', 'n', 'b'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'queen-endings',
    label: 'Queen endings',
    says: 'Both sides have a queen, and there are no rooks, knights or bishops. Pawns are not counted.',
    sides: 'either-side' as const,
    white: { q: atLeast(1) },
    black: { q: atLeast(1) },
    without: ['r', 'n', 'b'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'pawn-endings',
    label: 'King and pawn endings',
    says: 'Kings and pawns only, with at least one pawn each.',
    sides: 'either-side' as const,
    white: { p: atLeast(1) },
    black: { p: atLeast(1) },
    without: ['q', 'r', 'n', 'b'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'rook-and-pawn-vs-rook',
    label: 'Rook and pawn against rook',
    says: 'One rook each, one side has at least one pawn and the other has none, and no other pieces.',
    sides: 'either-side' as const,
    white: { r: exactly(1), p: atLeast(1) },
    black: { r: exactly(1), p: exactly(0) },
    without: ['q', 'n', 'b'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'bishop-vs-knight',
    label: 'Bishop against knight',
    says: 'One side has a bishop and no knight, the other a knight and no bishop, and there are no queens or rooks.',
    sides: 'either-side' as const,
    white: { b: exactly(1), n: exactly(0) },
    black: { n: exactly(1), b: exactly(0) },
    without: ['q', 'r'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'opposite-coloured-bishops',
    label: 'Opposite-coloured bishops',
    says: 'A bishop each on squares of opposite colours, with no queens, rooks or knights.',
    sides: 'either-side' as const,
    white: { b: atLeast(1) },
    black: { b: atLeast(1) },
    without: ['q', 'r', 'n'] as PieceLetter[],
    bishops: 'opposite-colours' as const
  }),
  Object.freeze({
    id: 'queen-vs-rook',
    label: 'Queen against rook',
    says: 'One side has a queen and no rook, the other a rook and no queen, and there are no knights or bishops.',
    sides: 'either-side' as const,
    white: { q: exactly(1), r: exactly(0) },
    black: { r: exactly(1), q: exactly(0) },
    without: ['n', 'b'] as PieceLetter[]
  }),
  Object.freeze({
    id: 'lone-king',
    label: 'One side has nothing but a king',
    says: 'One side has no pawns and no pieces at all.',
    sides: 'either-side' as const,
    white: {},
    black: { p: exactly(0), n: exactly(0), b: exactly(0), r: exactly(0), q: exactly(0) }
  }),
  Object.freeze({
    id: 'seven-men-or-fewer',
    label: 'Seven men or fewer',
    says: 'Seven pieces and pawns on the board in all, kings included.',
    sides: 'as-written' as const,
    men: atMost(7)
  })
])

export const materialPattern = (id: string): MaterialPattern | undefined => MATERIAL_PATTERNS.find((one) => one.id === id)

export interface MaterialSearchResult {
  pattern: MaterialPattern
  hits: SearchHit[]
  /** Distinct sets of men tested, and how many of them matched. This is why the search is cheap. */
  tested: number
  matched: number
  searched: { games: number; positions: number }
  skipped: SkippedPosition[]
  /** A material search is never an exact position match, and says so. */
  exact: false
}

/**
 * Every game that reached a position with these men on the board.
 *
 * Material only changes when something is captured or promoted, so a library of four hundred thousand positions
 * holds only a few thousand different sets of men. The pattern is tested once per set rather than once per position,
 * which is the whole reason this is instant.
 */
export function searchMaterial(index: LibraryIndex, pattern: MaterialPattern): MaterialSearchResult {
  const places: PositionHit[] = []
  let matched = 0
  for (const bucket of index.byMaterial.values()) {
    if (!matchesMaterial(bucket.material, pattern)) continue
    matched += 1
    for (const place of bucket.where) places.push(place)
  }
  // Back into the order the games were read, which walking the buckets lost.
  const byRead = new Map([...index.gamesById.keys()].map((id, at) => [id, at]))
  places.sort((a, b) => (byRead.get(a.gameId) ?? 0) - (byRead.get(b.gameId) ?? 0) || a.ply - b.ply)
  return {
    pattern,
    hits: collect(places, index.gamesById),
    tested: index.byMaterial.size,
    matched,
    searched: { games: index.games, positions: index.positions },
    skipped: index.skipped,
    exact: false
  }
}

/** The same material search done the long way, for checking the one above. */
export function scanMaterial(
  games: readonly StoredGame[],
  pattern: MaterialPattern,
  options: { how?: 'replay' | 'stored' } = {}
): MaterialSearchResult {
  const hits: SearchHit[] = []
  const skipped: SkippedPosition[] = []
  let positions = 0
  for (const game of games) {
    const plies: number[] = []
    for (const step of walkGame(game, options.how ?? 'replay')) {
      if (step.fen === undefined) {
        skipped.push({ gameId: game.id, ply: step.ply, why: step.skip })
        continue
      }
      const material = materialOfFen(step.fen)
      if (!material) {
        skipped.push({ gameId: game.id, ply: step.ply, why: `The position at move ${step.ply} is not a readable board.` })
        continue
      }
      positions += 1
      if (matchesMaterial(material, pattern)) plies.push(step.ply)
    }
    if (plies.length) hits.push({ gameId: game.id, game, plies, ply: plies[0] })
  }
  return {
    pattern,
    hits,
    tested: positions,
    matched: hits.reduce((sum, one) => sum + one.plies.length, 0),
    searched: { games: games.length, positions },
    skipped,
    exact: false
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Games that reached an opening

/**
 * Every game of yours that reached this named opening.
 *
 * An opening in the dataset *is* a position -- its `key` is `positionKey` of the position it names -- so this is the
 * exact search with the key already worked out. It therefore needs an index built with the exact rule, and says so
 * rather than quietly answering a looser question: a structural index would return games that reached a board that
 * looks like the Najdorf but is not it.
 */
export function openingReach(index: LibraryIndex, opening: OpeningRecord): PositionSearchResult {
  if (index.rule !== 'exact') {
    return noKey(
      index,
      '',
      `An opening names one exact position, and this index was built to match "${matchRule(index.rule).label}". `
        + 'Build an index with the exact rule to ask this.'
    )
  }
  return searchByKey(index, opening.key, '')
}

export interface OpeningCount {
  /** The position's key, which is what was matched. */
  key: string
  eco: string
  name: string
  /** Games whose deepest named position is this one. */
  games: number
}

export interface OpeningSurvey {
  /** Openings found, most games first. */
  counts: OpeningCount[]
  /** Games where none of the positions looked at is in the dataset. A real answer, not a gap. */
  unnamed: number
  /** Games read. */
  games: number
  /** How far into each game the dataset was asked. See `startOpeningSurvey` for why there is a limit. */
  maxPly: number
  /** The dataset that did the naming, so a count can be traced. */
  source: OpeningDataSource
}

export interface SurveyBuild {
  survey: OpeningSurvey
  progress: IndexProgress
  source: readonly StoredGame[]
  at: number
  /** Counting is done in a map and sorted at the end, so a partial survey is still in a usable order. */
  tally: Map<string, OpeningCount>
}

/**
 * What openings are really in the library, counted.
 *
 * This is the other half of "games that reached this opening": before a person can pick one, they need the list of
 * the ones they have. Each game's deepest named position is taken, which is how openings are named -- 1.e4 e5 2.Nf3
 * Nc6 3.Bc4 Bc5 4.d3 is still the Giuoco Piano -- and a game whose positions are all outside the dataset is counted
 * as unnamed rather than guessed at.
 *
 * `maxPly` bounds the work: the dataset is asked about the first 60 positions of a game and no further. That is a
 * limit on effort, not a claim about the dataset -- a name that only appeared beyond ply 60 would be missed.
 */
export function startOpeningSurvey(games: readonly StoredGame[], options: { maxPly?: number } = {}): SurveyBuild {
  const maxPly = Math.max(1, Math.round(options.maxPly ?? 60))
  return {
    survey: { counts: [], unnamed: 0, games: 0, maxPly, source: OPENING_SOURCE },
    progress: progressOf(0, games.length, 0),
    source: games,
    at: 0,
    tally: new Map()
  }
}

function surveyGame(build: SurveyBuild, game: StoredGame): void {
  let deepest: OpeningRecord | null = null
  const until = Math.min(game.moves.length, build.survey.maxPly)
  // The starting position too: a game set up from a known position is named by it.
  for (let ply = 0; ply <= until; ply++) {
    const record = recordFor(ply === 0 ? game.startFen : game.moves[ply - 1].fen)
    if (record) deepest = record
  }
  build.survey.games += 1
  if (!deepest) {
    build.survey.unnamed += 1
    return
  }
  const had = build.tally.get(deepest.key)
  if (had) had.games += 1
  else build.tally.set(deepest.key, { key: deepest.key, eco: deepest.eco, name: deepest.name, games: 1 })
}

/** Reads the next few games into the survey. */
export function stepOpeningSurvey(build: SurveyBuild, games = 100): SurveyBuild {
  if (build.progress.done) return build
  const until = Math.min(build.source.length, build.at + Math.max(1, Math.round(games)))
  for (let i = build.at; i < until; i++) surveyGame(build, build.source[i])
  build.at = until
  build.progress = progressOf(until, build.source.length, build.survey.games)
  build.survey.counts = [...build.tally.values()].sort(
    (a, b) => b.games - a.games || (a.eco < b.eco ? -1 : a.eco > b.eco ? 1 : a.name < b.name ? -1 : 1)
  )
  return build
}

/** The whole survey in one go. */
export function openingSurvey(
  games: readonly StoredGame[],
  options: { maxPly?: number; onProgress?: (progress: IndexProgress) => void; chunk?: number } = {}
): OpeningSurvey {
  let build = startOpeningSurvey(games, options)
  options.onProgress?.(build.progress)
  while (!build.progress.done) {
    build = stepOpeningSurvey(build, options.chunk ?? 100)
    options.onProgress?.(build.progress)
  }
  return build.survey
}

// ---------------------------------------------------------------------------------------------------------------
// Saying what happened

/**
 * A result in one line.
 *
 * A structural result always carries "not an exact match" in the words themselves, not only in a flag a screen might
 * forget to read.
 */
export function resultWords(result: PositionSearchResult): string {
  if (result.problem) return result.problem
  const games = result.hits.length
  const occurrences = result.hits.reduce((sum, one) => sum + one.plies.length, 0)
  const where = games === 0
    ? `No game of yours reached this, out of ${result.searched.games.toLocaleString()} searched`
    : `${games.toLocaleString()} ${games === 1 ? 'game' : 'games'}, ${occurrences.toLocaleString()} ${occurrences === 1 ? 'time' : 'times'} in all, out of ${result.searched.games.toLocaleString()} searched`
  return result.exact ? `${where}.` : `${where} — not an exact match: ${result.rule.label.toLowerCase()}.`
}

/** A material result in one line. */
export function materialWords(result: MaterialSearchResult): string {
  const games = result.hits.length
  if (games === 0) return `No game of yours reached ${result.pattern.label.toLowerCase()}, out of ${result.searched.games.toLocaleString()} searched.`
  const occurrences = result.hits.reduce((sum, one) => sum + one.plies.length, 0)
  return `${games.toLocaleString()} ${games === 1 ? 'game' : 'games'}, ${occurrences.toLocaleString()} ${occurrences === 1 ? 'position' : 'positions'} in all, out of ${result.searched.games.toLocaleString()} games searched.`
}

/** Progress in one line, for a library big enough to need one. */
export function progressWords(progress: IndexProgress): string {
  if (progress.total === 0) return 'There are no games to read.'
  if (progress.done) return `Read ${progress.total.toLocaleString()} ${progress.total === 1 ? 'game' : 'games'}, ${progress.positions.toLocaleString()} positions.`
  return `Reading game ${progress.games.toLocaleString()} of ${progress.total.toLocaleString()}…`
}

/** What was left out, in one line, or null when nothing was. */
export function skippedWords(skipped: readonly SkippedPosition[]): string | null {
  if (!skipped.length) return null
  const games = new Set(skipped.map((one) => one.gameId)).size
  return `${skipped.length.toLocaleString()} ${skipped.length === 1 ? 'position' : 'positions'} in ${games} ${games === 1 ? 'game' : 'games'} could not be read and were left out of the search.`
}
