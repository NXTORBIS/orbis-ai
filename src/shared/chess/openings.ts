import { START_FEN, applyMove, checkFen, legalMoves, outcome, positionKey, sideToMove, type ChessMove } from './rules.ts'
import { OPENINGS_DATA, OPENINGS_SOURCE, type OpeningDataSource } from './openingsData.ts'
import type { Side } from './evaluation.ts'

/**
 * Naming an opening, and exploring what the dataset knows from here.
 *
 * Three things happen in this file and they are kept apart on purpose:
 *
 *   - **Identifying.** A position either is in the dataset or is not. "Not in the dataset" is a real answer and is
 *     given plainly, with the dataset named, rather than guessed at from the nearest thing (Sections 131, 134).
 *   - **Exploring.** The continuations shown from a position are the moves that lead to another position the dataset
 *     names. They are listed alphabetically because the dataset counts nothing: it is a list of named positions, not
 *     a record of games, so there is no popularity here and none is invented (Section 136).
 *   - **Transpositions.** Two move orders meet when they reach the same position, and "the same position" means
 *     `positionKey` from rules.ts: the same pieces, the same side to move, the same castling rights and the same en
 *     passant square. Two boards that look alike but differ in castling rights are NOT the same position and are
 *     never merged, because what is legal differs (Sections 137, 138).
 *
 * The dataset and its licence live in openingsData.ts. Everything here is pure: no Electron, no files, no clock.
 */

export type { OpeningDataSource }

/** The dataset's own description of itself, carried into every answer so a name can always be traced. */
export const OPENING_SOURCE = OPENINGS_SOURCE

export interface OpeningRecord {
  /** The position this name belongs to: `positionKey`, so castling rights and en passant are part of it. */
  key: string
  eco: string
  name: string
  /** The move order the dataset itself gives for reaching it, in standard notation. */
  line: string[]
}

/**
 * The dataset is parsed once, when something first asks a question of it.
 *
 * It is 3,865 lines of text in the bundle rather than 3,865 objects, and this is where it becomes a lookup. Doing it
 * on first use rather than at import means a window that never opens the Opening Lab never pays for it.
 */
let table: Map<string, OpeningRecord> | null = null
let ordered: OpeningRecord[] | null = null

function parse(): void {
  const map = new Map<string, OpeningRecord>()
  const list: OpeningRecord[] = []
  for (const row of OPENINGS_DATA.split('\n')) {
    if (!row) continue
    const parts = row.split('\t')
    if (parts.length < 4) continue
    const record: OpeningRecord = { key: parts[0], eco: parts[1], name: parts[2], line: parts[3].split(' ').filter(Boolean) }
    // A duplicated key would mean two names for one position. The generator refuses to emit one; if a row ever
    // arrived twice the first stays, so the answer cannot change with the order the file happens to be in.
    if (!map.has(record.key)) {
      map.set(record.key, record)
      list.push(record)
    }
  }
  table = map
  ordered = list
}

function byKey(): Map<string, OpeningRecord> {
  if (!table) parse()
  return table as Map<string, OpeningRecord>
}

function all(): OpeningRecord[] {
  if (!ordered) parse()
  return ordered as OpeningRecord[]
}

/** How many named positions the dataset holds. Counted, not quoted from the header. */
export function datasetSize(): number {
  return all().length
}

/** The record for exactly this position, or null. The only lookup in the file; everything else is built on it. */
export function recordFor(fen: string): OpeningRecord | null {
  if (!checkFen(fen).ok) return null
  return byKey().get(positionKey(fen)) ?? null
}

// ---- walking a line

export interface LineStep {
  /** 1 for the position after the first move. */
  ply: number
  san: string
  uci: string
  fen: string
  /** What the dataset calls the position this move reaches, when it calls it anything. */
  record: OpeningRecord | null
}

export interface LineWalk {
  ok: boolean
  startFen: string
  steps: LineStep[]
  /** Set when a move would not play: which move, and where. Nothing after it was walked. */
  problem?: { ply: number; move: string; fen: string; reason: string }
}

/**
 * Playing a line out, position by position, and asking the dataset about each one.
 *
 * It has to be done this way round: a name belongs to a position, not to a move list, so the only way to know what a
 * line is called is to reach each position and look it up. This is also what makes a transposition name itself
 * without any special handling -- 1.Nf3 Nf6 2.c4 e6 3.d4 arrives at a position the dataset lists under 1.d4, and the
 * lookup simply finds it.
 */
export function walkLine(moves: string[], startFen: string = START_FEN): LineWalk {
  const check = checkFen(startFen)
  if (!check.ok) {
    return { ok: false, startFen, steps: [], problem: { ply: 0, move: '', fen: startFen, reason: check.reason ?? 'That starting position is not valid.' } }
  }
  const steps: LineStep[] = []
  let fen = startFen
  for (const [index, written] of moves.entries()) {
    const made = applyMove(fen, written)
    if (!made) {
      return { ok: false, startFen, steps, problem: { ply: index + 1, move: written, fen, reason: `"${written}" cannot be played in the position it reaches.` } }
    }
    fen = made.after
    steps.push({ ply: index + 1, san: made.san, uci: made.uci, fen, record: recordFor(fen) })
  }
  return { ok: true, startFen, steps }
}

// ---- identifying

export interface OpeningKnown {
  known: true
  eco: string
  name: string
  record: OpeningRecord
  /**
   * True when the position in front of you is the named one. False when the name comes from an earlier position in
   * the line, which is how openings are named: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.d3 is still the Giuoco Piano even
   * though the dataset stops naming positions before it.
   */
  exact: boolean
  /** Which ply of the line fixed the name, when a line was given. */
  ply?: number
  /** The dataset's own move order, when the line given reached the position by a different one. */
  transposedFrom?: string[]
  source: OpeningDataSource
}

export interface OpeningUnknown {
  known: false
  /** Why there is no name: said plainly, never dressed up as a guess. */
  reason: string
  /** 'not-in-dataset' is the ordinary answer. 'illegal-line' and 'bad-position' mean the question was broken. */
  problem: 'not-in-dataset' | 'illegal-line' | 'bad-position'
  source: OpeningDataSource
}

export type Identification = OpeningKnown | OpeningUnknown

export interface IdentifyInput {
  /** The position. Enough on its own for an exact answer. */
  fen?: string
  /** The moves that led here. With these, a name can come from an earlier position, which is how naming works. */
  moves?: string[]
  startFen?: string
}

const sameLine = (a: string[], b: string[]): boolean => a.length === b.length && a.every((san, i) => san === b[i])

/**
 * What this opening is called.
 *
 * Give it moves and it walks them, taking the last position the dataset names: that is the name a chess player would
 * use. Give it only a position and it can answer for that position alone, and says so when it cannot -- because
 * without the moves there is no earlier position to fall back on, and inventing one would be a different answer
 * dressed as this one.
 */
export function identify(input: IdentifyInput): Identification {
  const source = OPENINGS_SOURCE
  if (input.moves && input.moves.length) {
    const walk = walkLine(input.moves, input.startFen ?? START_FEN)
    if (!walk.ok) {
      return { known: false, problem: 'illegal-line', reason: walk.problem?.reason ?? 'That line cannot be played.', source }
    }
    let deepest: LineStep | null = null
    for (const step of walk.steps) if (step.record) deepest = step
    if (!deepest || !deepest.record) {
      const startRecord = recordFor(walk.startFen)
      if (startRecord) {
        return { known: true, eco: startRecord.eco, name: startRecord.name, record: startRecord, exact: walk.steps.length === 0, ply: 0, source }
      }
      return {
        known: false,
        problem: 'not-in-dataset',
        reason: `None of the ${walk.steps.length} positions in this line is in the ${source.dataset} dataset, so it has no name here.`,
        source
      }
    }
    const played = walk.steps.slice(0, deepest.ply).map((s) => s.san)
    const transposed = !sameLine(played, deepest.record.line)
    return {
      known: true,
      eco: deepest.record.eco,
      name: deepest.record.name,
      record: deepest.record,
      exact: deepest.ply === walk.steps.length,
      ply: deepest.ply,
      ...(transposed ? { transposedFrom: deepest.record.line } : {}),
      source
    }
  }
  const fen = input.fen ?? input.startFen
  if (!fen) return { known: false, problem: 'bad-position', reason: 'There is no position and no line to identify.', source }
  const check = checkFen(fen)
  if (!check.ok) return { known: false, problem: 'bad-position', reason: check.reason ?? 'That position is not valid.', source }
  const record = recordFor(fen)
  if (record) return { known: true, eco: record.eco, name: record.name, record, exact: true, source }
  return {
    known: false,
    problem: 'not-in-dataset',
    reason: `This exact position is not in the ${source.dataset} dataset. Only the position was given, not the moves that led to it, so no earlier position could be named instead.`,
    source
  }
}

// ---- exploring

export interface Continuation {
  san: string
  uci: string
  /** The position this move reaches. */
  fen: string
  /** What the dataset calls that position. A continuation is only listed when the dataset names where it goes. */
  record: OpeningRecord
  /** Whose move this is. */
  side: Side
  /** True when the name stays the same and only the detail deepens. */
  samePlace: boolean
}

export interface ExplorerStatistics {
  /** Always false for this dataset, and said out loud rather than shown as a zero. */
  available: false
  why: string
}

export interface ExplorerResult {
  fen: string
  /** What the position in front of you is called. */
  position: Identification
  /** The moves from here that reach a position the dataset names. */
  moves: Continuation[]
  /** How many legal moves lead somewhere the dataset says nothing about. A count, not a judgement. */
  unnamed: number
  /** The total number of legal moves, so the two numbers above can be read against something. */
  legal: number
  statistics: ExplorerStatistics
  /** Why the moves are in the order they are in. */
  order: 'alphabetical'
  source: OpeningDataSource
}

/**
 * Could this position occur in a game at all?
 *
 * A FEN can pass every check and still be impossible: the clearest case is the side that is NOT to move standing in
 * check, which no legal move could have produced. It matters here because asking for the continuations of such a
 * position asks the move generator to take a king, and that is not a move -- it throws. So the position is turned
 * round and the rules are asked whether the other side is in check, and an impossible position is reported as one
 * rather than crashing the panel.
 */
function canOccur(fen: string): boolean {
  const fields = fen.trim().split(/\s+/)
  fields[1] = fields[1] === 'w' ? 'b' : 'w'
  // The en passant square belongs to the turn that was; with the turn swapped it would describe a capture nobody
  // could make, and chess.js rejects the position outright rather than answering the question asked.
  fields[3] = '-'
  const state = outcome(fields.join(' '))
  return !(state.over ? state.reason === 'checkmate' : state.check)
}

/**
 * What the dataset knows from here.
 *
 * Every legal move is played and the position it reaches is looked up. That is the whole method, and it is why the
 * explorer is honest about transpositions for free: a move that leads into a position named under a different first
 * move still appears, under the name the dataset gives it.
 *
 * The order is alphabetical, deliberately. A list of openings ordered by anything else would be claiming to know
 * which ones people play, and this dataset does not say (Section 136).
 */
export function explore(fen: string): ExplorerResult {
  const source = OPENINGS_SOURCE
  const statistics: ExplorerStatistics = {
    available: false,
    why: `${source.dataset} is a list of named positions. It counts no games and no players, so there is no popularity or score to show here.`
  }
  const refuse = (reason: string): ExplorerResult => ({
    fen,
    position: { known: false, problem: 'bad-position', reason, source },
    moves: [],
    unnamed: 0,
    legal: 0,
    statistics,
    order: 'alphabetical',
    source
  })
  const check = checkFen(fen)
  if (!check.ok) return refuse(check.reason ?? 'That position is not valid.')
  if (!canOccur(fen)) {
    return refuse('This position cannot occur in a game: the side that is not to move is in check, so there is no move that could have led here. Nothing can be explored from it.')
  }
  const here = identify({ fen })
  const hereName = here.known ? here.name : null
  // The net under the check above. Listing the moves of a position nobody can reach is not a question with an
  // answer, and a panel that disappeared would be a worse answer than a sentence saying so.
  let legal: ChessMove[]
  try {
    legal = legalMoves(fen)
  } catch {
    return refuse('The rules could not list the moves from this position, which means it is not a position a game could be in.')
  }
  const side = sideToMove(fen)
  const moves: Continuation[] = []
  let unnamed = 0
  for (const move of legal) {
    const record = recordFor(move.after)
    if (!record) { unnamed += 1; continue }
    moves.push({ san: move.san, uci: move.uci, fen: move.after, record, side, samePlace: record.name === hereName })
  }
  moves.sort((a, b) => (a.san < b.san ? -1 : a.san > b.san ? 1 : 0))
  return { fen, position: here, moves, unnamed, legal: legal.length, statistics, order: 'alphabetical', source }
}

// ---- transpositions

export type PositionDifference = 'placement' | 'turn' | 'castling' | 'en-passant'

export interface TranspositionResult {
  /** False when one of the lines cannot be played at all; then nothing is claimed about either. */
  ok: boolean
  /** Do the two lines meet? */
  same: boolean
  /** Said in plain words: why they meet, or why they do not. */
  reason: string
  keys: { a: string | null; b: string | null }
  fens: { a: string | null; b: string | null }
  /** Which parts of the position differ, when they do. */
  differences: PositionDifference[]
  /** The first ply at which the two lines played something different. */
  divergedAt?: number
  /** True when both lines played the same moves, in a different order. */
  sameMoves?: boolean
  /** What the dataset calls the meeting point, when it names it. */
  opening?: OpeningRecord | null
  /** The fifty-move counts, when they differ: the key ignores them on purpose, and that is worth knowing. */
  clocks?: { a: number; b: number }
  problem?: string
}

const field = (fen: string, n: number): string => fen.trim().split(/\s+/)[n] ?? '-'

const sortedSans = (list: string[]): string => [...list].sort().join(' ')

/**
 * Do two move orders meet, and why.
 *
 * The answer is `positionKey`'s answer, which is the point of this function existing. A check that compared only the
 * pieces would merge a position where a rook has been to g1 and back with one where it never moved: the boards look
 * identical and the castling rights do not, so one side may castle and the other may not. Calling those the same
 * position would be wrong in the one way that matters (Sections 137, 138).
 */
export function transposition(a: string[], b: string[], startFen: string = START_FEN): TranspositionResult {
  const walkA = walkLine(a, startFen)
  const walkB = walkLine(b, startFen)
  const empty: TranspositionResult = { ok: false, same: false, reason: '', keys: { a: null, b: null }, fens: { a: null, b: null }, differences: [] }
  if (!walkA.ok || !walkB.ok) {
    const broken = !walkA.ok ? walkA : walkB
    const which = !walkA.ok ? 'first' : 'second'
    return {
      ...empty,
      reason: `The ${which} line cannot be played, so there is nothing to compare: ${broken.problem?.reason ?? 'a move would not play.'}`,
      problem: broken.problem?.reason ?? 'A move would not play.'
    }
  }
  const fenA = walkA.steps.length ? walkA.steps[walkA.steps.length - 1].fen : startFen
  const fenB = walkB.steps.length ? walkB.steps[walkB.steps.length - 1].fen : startFen
  const keyA = positionKey(fenA)
  const keyB = positionKey(fenB)
  const sansA = walkA.steps.map((s) => s.san)
  const sansB = walkB.steps.map((s) => s.san)
  let divergedAt: number | undefined
  for (let i = 0; i < Math.max(sansA.length, sansB.length); i++) {
    if (sansA[i] !== sansB[i]) { divergedAt = i + 1; break }
  }
  const sameMoves = sansA.length === sansB.length && sortedSans(sansA) === sortedSans(sansB)
  const base = {
    ok: true,
    keys: { a: keyA, b: keyB },
    fens: { a: fenA, b: fenB },
    ...(divergedAt === undefined ? {} : { divergedAt }),
    sameMoves
  }
  if (keyA === keyB) {
    const clockA = Number.parseInt(field(fenA, 4), 10)
    const clockB = Number.parseInt(field(fenB, 4), 10)
    const clocksDiffer = Number.isFinite(clockA) && Number.isFinite(clockB) && clockA !== clockB
    const record = recordFor(fenA)
    const how = divergedAt === undefined
      ? 'The two lines are the same line, move for move.'
      : sameMoves
        ? `Both lines play the same ${sansA.length} moves and first differ at move ${Math.floor((divergedAt - 1) / 2) + 1}, so this is the same position reached in a different order.`
        : `The lines differ from move ${Math.floor((divergedAt - 1) / 2) + 1} and do not play the same moves, yet they arrive at the same position.`
    const parts = [
      how,
      'They meet because everything that decides what is legal matches: the pieces stand on the same squares, the same side is to move, the castling rights are the same, and the en passant square is the same.'
    ]
    if (record) parts.push(`The dataset calls it ${record.eco} ${record.name}.`)
    if (clocksDiffer) {
      parts.push(`The fifty-move counts differ (${clockA} against ${clockB}). A position's identity here deliberately leaves the clocks out: they change when a draw can be claimed, not what may be played.`)
    }
    return {
      ...base,
      same: true,
      reason: parts.join(' '),
      differences: [],
      opening: record,
      ...(clocksDiffer ? { clocks: { a: clockA, b: clockB } } : {})
    }
  }
  const differences: PositionDifference[] = []
  if (field(fenA, 0) !== field(fenB, 0)) differences.push('placement')
  if (field(fenA, 1) !== field(fenB, 1)) differences.push('turn')
  if (field(fenA, 2) !== field(fenB, 2)) differences.push('castling')
  if (field(fenA, 3) !== field(fenB, 3)) differences.push('en-passant')
  const said: string[] = []
  if (differences.includes('placement')) said.push('the pieces stand differently')
  if (differences.includes('turn')) said.push(`it is ${field(fenA, 1) === 'w' ? 'White' : 'Black'} to move in the first line and ${field(fenB, 1) === 'w' ? 'White' : 'Black'} in the second`)
  if (differences.includes('castling')) {
    said.push(`the castling rights differ (${field(fenA, 2)} against ${field(fenB, 2)}), so a king or rook has moved in one line and not the other and the two sides may not castle alike`)
  }
  if (differences.includes('en-passant')) said.push(`the en passant square differs (${field(fenA, 3)} against ${field(fenB, 3)}), so a capture available in one line is not available in the other`)
  const onlyRights = differences.length > 0 && !differences.includes('placement')
  const reason = onlyRights
    ? `These lines do not meet. The boards look alike, but ${said.join(', and ')}. That is part of the position, not a detail about it, so the two are not merged.`
    : `These lines do not meet: ${said.join(', and ')}.`
  return { ...base, same: false, reason, differences }
}

// ---- finding an opening by name

export interface OpeningSearchResult {
  record: OpeningRecord
  /** Where the words matched: the name, or the ECO code. */
  matched: 'name' | 'eco'
}

/**
 * Looking an opening up by name or ECO code.
 *
 * Shorter names come first, because a shorter name is the main line and a longer one is a variation of it -- "Italian
 * Game" before "Italian Game: Giuoco Pianissimo, Canal Variation". Nothing is ranked by how often it is played; the
 * dataset does not say.
 */
export function searchOpenings(text: string, limit: number = 25): OpeningSearchResult[] {
  const query = text.trim().toLowerCase()
  if (!query) return []
  const ecoQuery = /^[a-e][0-9]{0,2}$/.test(query) ? query.toUpperCase() : null
  const out: OpeningSearchResult[] = []
  for (const record of all()) {
    if (ecoQuery && record.eco.startsWith(ecoQuery)) { out.push({ record, matched: 'eco' }); continue }
    if (record.name.toLowerCase().includes(query)) out.push({ record, matched: 'name' })
  }
  out.sort((x, y) => {
    const a = x.record
    const b = y.record
    if (a.name.length !== b.name.length) return a.name.length - b.name.length
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.eco < b.eco ? -1 : a.eco > b.eco ? 1 : 0
  })
  return out.slice(0, Math.max(0, limit))
}

/** The ECO volumes, with how many named positions each holds. Counted from the data, not written down twice. */
export function volumes(): { volume: string; entries: number }[] {
  const counts = new Map<string, number>()
  for (const record of all()) {
    const volume = record.eco[0] ?? '?'
    counts.set(volume, (counts.get(volume) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([volume, entries]) => ({ volume, entries }))
}
