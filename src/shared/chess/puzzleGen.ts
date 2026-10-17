import type { PositionEval } from './analysis.ts'
import { forSide, lossFrom, type Score, type Side } from './evaluation.ts'
import {
  forcedMateTree, materialSwing, newExercise, playablePosition, validateExercise,
  type Exercise, type ExerciseCheck, type Provenance, type Solution
} from './exercise.ts'
import { nestLine } from './lessons.ts'
import { fenAt, type StoredGame } from './model.ts'
import {
  applyMove, legalMoves, moveNumber, outcome, positionKey, sideToMove, type ChessMove
} from './rules.ts'
import {
  GAME_TAG_PREFIX, PUZZLE_FAILURE, checkedThemes, gameTag, hintsFor, newPuzzle, verifyPuzzle,
  type Puzzle, type ThemeClaim
} from './puzzles.ts'

/**
 * Making puzzles out of somebody's own games (Sections 073, 074).
 *
 * ## What a generated puzzle has to survive
 *
 * A moment in a game is not a puzzle. It is a *suggestion*, and the step from one to the other is where every puzzle
 * generator that has ever shipped something embarrassing went wrong. So the suggestion has to get past all of this
 * before it becomes a puzzle:
 *
 *   1. **A real evaluation swing.** The move played gave up at least `minLossCp`, measured between two searches that
 *      both reached `minDepth`, neither of them a bound the engine had not settled.
 *   2. **A clearly better move existed.** The engine named one, and it is not the move that was played.
 *   3. **It is not trivial.** One legal move is not a puzzle. Nor is a position that was already decided before the
 *      mistake and still was afterwards. Nor is a recapture that is the only way to take back on the square the
 *      opponent just captured on -- nobody *finds* that.
 *   4. **It is not ambiguous.** Two first moves the engine scores within `ambiguityCp` of each other means the
 *      position has two answers and the solver would be told they were wrong for finding the other one.
 *   5. **The solution does what the puzzle says.** Not "the engine said so" -- the *rules* say so. A mate puzzle's
 *      solution comes out of `forcedMateTree`, an exhaustive search over the real rules, so every defence is in it
 *      by construction. A material puzzle's line is played out and the material counted, including the recapture
 *      that so often takes it straight back.
 *   6. **`validateExercise` passes.** The same check every other exercise in Orbis goes through, run again from the
 *      position rather than trusted from the record. Anything with a fault is **rejected and reported**, never
 *      quietly dropped.
 *
 * ## Two ways in, and one of them needs no engine at all
 *
 * `generateFromGame` is the engine route: it takes evaluations as input and nothing in this file calls an engine or
 * knows what one is.
 *
 * `scanForMates` is the other route, and it exists because a forced mate is a fact about the rules, not an opinion
 * about a position. `forcedMateTree` can find one without an engine, so Orbis can make real, fully verified puzzles
 * out of a person's games on a machine where Stockfish has never been installed. It costs about three milliseconds
 * a position to look for a mate in one and about a quarter of a second to look for a mate in two, which is why both
 * routes are also available one position at a time (`considerPly`, `mateAt`) -- a screen has to be able to do this
 * without going still.
 *
 * ## What "unverified" means here
 *
 * A puzzle whose objective the rules cannot settle -- `find-best`, which is an engine's opinion by definition --
 * can never be verified, and comes through only when it is asked for, marked `unverified` and `needs: 'engine'`.
 * A moment found by a search shallower than `minDepth` is skipped by default and, when asked for, comes through
 * marked `shallow`. The one exception is said out loud in the code: when the *rules* proved a forced mate, the
 * engine's depth does not matter, because the engine only chose where to look.
 *
 * Pure: no engine, no clock, no storage. `now` is an argument.
 */

// ---------------------------------------------------------------- what comes in

/** The part of a saved game this file needs. */
export type SourceGame = Pick<StoredGame, 'id' | 'startFen' | 'moves' | 'meta'>

/**
 * One position's evaluation, as `analysis.ts` already defines it, plus the other first moves the engine scored.
 *
 * The alternatives are what makes an ambiguity check possible. Without them a puzzle cannot be shown to have one
 * answer, and that is said rather than assumed: `Generated.answersChecked` is false and the note says so.
 */
export interface GenEval extends PositionEval {
  /** MultiPV lines from the same search, best first, scored White-positive. */
  alternatives?: readonly { uci: string; score: Score }[]
}

/** What the engine was and how it was asked, kept with every puzzle it helped find. */
export interface EngineSettings {
  name?: string
  version?: string
  movetime?: number
  depth?: number
  nodes?: number
  multipv?: number
}

export interface GenerateOptions {
  now: number
  /** Centipawns the move played must have given up. */
  minLossCp?: number
  /** Depth both searches must have reached before their difference is used. */
  minDepth?: number
  /** Two first moves within this many centipawns of each other make the position ambiguous. */
  ambiguityCp?: number
  /** More accepted first moves than this and the puzzle has too many answers to be one. */
  maxAnswers?: number
  /** A position both sides of the mistake this far apart was already decided. */
  alreadyDecidedCp?: number
  /** How many of the solver's own moves the rules may look ahead for a forced mate. */
  mateDepth?: number
  /** Positions the mate search may look at before giving up and saying so. */
  mateBudget?: number
  /** The least material a material puzzle must really win, in centipawns. */
  materialAtLeast?: number
  /** Only moments where this side was to move. */
  side?: Side
  /** Shallow moments come through, marked, rather than being skipped. */
  includeShallow?: boolean
  /** Moments the rules cannot settle come through as `find-best`, marked unverified. */
  includeEngineOnly?: boolean
  /** For the mate scan: leave out mates that were actually played in the game. True by default. */
  onlyMissed?: boolean
  fromPly?: number
  toPly?: number
  maxPuzzles?: number
  engine?: EngineSettings
}

export const GENERATE_DEFAULTS = Object.freeze({
  minLossCp: 150,
  minDepth: 12,
  ambiguityCp: 50,
  maxAnswers: 3,
  alreadyDecidedCp: 600,
  mateDepth: 2,
  mateBudget: 200_000,
  materialAtLeast: 200,
  includeShallow: false,
  includeEngineOnly: false,
  onlyMissed: true,
  maxPuzzles: 40
})

// ---------------------------------------------------------------- what comes out

export type SkipReason =
  | 'no-evaluation'
  | 'position-mismatch'
  | 'provisional'
  | 'shallow'
  | 'no-better-move'
  | 'loss-too-small'
  | 'already-decided'
  | 'one-legal-move'
  | 'position-over'
  | 'bad-position'
  | 'forced-recapture'
  | 'two-good-moves'
  | 'too-many-answers'
  | 'not-provable'
  | 'wrong-side'
  | 'mate-not-found'
  | 'mate-search-exceeded'
  | 'mate-was-played'
  | 'enough-already'

export const SKIP_WORDS: Readonly<Record<SkipReason, string>> = Object.freeze({
  'no-evaluation': 'Nothing was searched here',
  'position-mismatch': 'The evaluation belongs to a different position',
  provisional: 'The engine only gave a bound, so the number is not settled',
  shallow: 'The search was too shallow to judge the move',
  'no-better-move': 'The engine did not name a better move',
  'loss-too-small': 'The move played did not give up enough to be worth finding',
  'already-decided': 'The position was already decided before the move and still was after it',
  'one-legal-move': 'There is only one legal move, so there is nothing to find',
  'position-over': 'The game is already over in this position',
  'bad-position': 'The position cannot be used',
  'forced-recapture': 'The answer is the only way to take back on that square, so nobody has to find it',
  'two-good-moves': 'Two different moves are about as good, so a solver finding the other one would be told they were wrong',
  'too-many-answers': 'Too many moves work for this to be a puzzle',
  'not-provable': 'Nothing here could be proved from the rules, so there would be no way to tell a solver whether they were right',
  'wrong-side': 'The other side was to move',
  'mate-not-found': 'No forced mate within the depth looked at',
  'mate-search-exceeded': 'The mate search ran out of budget, so it says nothing either way',
  'mate-was-played': 'The mate was played in the game, so there is nothing left to find',
  'enough-already': 'Enough puzzles have been made from this game'
})

export interface Moment {
  /** The number of moves played before the puzzle's position. The position is `fenAt(game, ply)`. */
  ply: number
  fen: string
  /** The move number shown beside it. */
  number: number
  /** Who is to move, and therefore who solves it. */
  side: Side
  /** What was actually played from this position, when the game went on. */
  playedSan: string | null
  playedUci: string | null
  /** White-positive, from the evaluations handed in. Null on the rules-only route. */
  before: Score | null
  after: Score | null
  /** Centipawns given up by the move played, from the mover's point of view. Null when it cannot be compared. */
  lossCp: number | null
  /** The shallower of the two searches behind the moment. Null on the rules-only route. */
  depth: number | null
  found: 'engine-swing' | 'rules-mate-scan'
}

export interface Generated {
  puzzle: Puzzle
  /** What `validateExercise` found. Kept so a screen can show the coverage and the cautions. */
  check: ExerciseCheck
  moment: Moment
  engine: EngineSettings | null
  /** True when the engine search behind the moment was shallower than `minDepth` and it was asked for anyway. */
  shallow: boolean
  /** False when there was no MultiPV data, so nobody has shown the puzzle has one answer. */
  answersChecked: boolean
  says: string
}

export interface Rejected {
  ply: number
  playedSan: string | null
  /** The faults `validateExercise` found, in its own words. */
  problems: readonly string[]
  says: string
}

export interface Skipped {
  ply: number
  playedSan: string | null
  reason: SkipReason
  says: string
}

export type Candidate =
  | { kind: 'puzzle'; made: Generated }
  | { kind: 'rejected'; rejected: Rejected }
  | { kind: 'skipped'; skipped: Skipped }

export interface GenerateResult {
  gameId: string
  generated: readonly Generated[]
  rejected: readonly Rejected[]
  skipped: readonly Skipped[]
  coverage: {
    /** Moves in the game. */
    plies: number
    /** Positions looked at. */
    considered: number
    /** Positions that had an evaluation Orbis could use. */
    evaluated: number
    /** Positions whose search was too shallow. */
    shallow: number
    /** Evaluations handed in that were not used, with the reason. */
    ignored: readonly { ply: number; reason: string }[]
  }
  says: string
}

// ---------------------------------------------------------------- the evaluations, indexed and checked

export interface PlyIndex {
  byPly: Map<number, GenEval>
  ignored: { ply: number; reason: string }[]
}

/**
 * Evaluations matched to the game they claim to be about.
 *
 * The same guard `analysis.ts` uses, for the same reason: a number calculated in a different position is worse than
 * no number, because it looks exactly like a real one. A deeper search of the same position replaces a shallower.
 */
export function indexEvaluations(game: SourceGame, evaluations: readonly GenEval[]): PlyIndex {
  const byPly = new Map<number, GenEval>()
  const ignored: { ply: number; reason: string }[] = []
  const plies = game.moves.length
  for (const one of evaluations) {
    if (!Number.isInteger(one.ply) || one.ply < 0 || one.ply > plies) {
      ignored.push({ ply: one.ply, reason: 'That position is not in this game.' })
      continue
    }
    if (positionKey(fenAt(game, one.ply)) !== positionKey(one.fen)) {
      ignored.push({ ply: one.ply, reason: `The position does not match this game after ${one.ply} ${one.ply === 1 ? 'move' : 'moves'}, so the number is not used.` })
      continue
    }
    const held = byPly.get(one.ply)
    if (held) {
      const a = held.depth ?? -1
      const b = one.depth ?? -1
      if (b < a) {
        ignored.push({ ply: one.ply, reason: 'A deeper search of the same position is being used instead.' })
        continue
      }
      ignored.push({ ply: one.ply, reason: 'Replaced by a deeper search of the same position.' })
    }
    byPly.set(one.ply, one)
  }
  return { byPly, ignored }
}

// ---------------------------------------------------------------- the small, shared checks

function skip(ply: number, playedSan: string | null, reason: SkipReason, extra?: string): Candidate {
  return { kind: 'skipped', skipped: { ply, playedSan, reason, says: extra ? `${SKIP_WORDS[reason]}: ${extra}` : `${SKIP_WORDS[reason]}.` } }
}

/** Whether the position is one a puzzle can start from at all, and not one with nothing to find. */
function positionUsable(fen: string): SkipReason | null {
  if (!playablePosition(fen).ok) return 'bad-position'
  if (outcome(fen).over) return 'position-over'
  if (legalMoves(fen).length <= 1) return 'one-legal-move'
  return null
}

/**
 * Whether the answer is the only way to take back on the square the opponent just captured on.
 *
 * The commonest false puzzle: the opponent takes, there is exactly one recapture, and a generator presents it as
 * something to find. Nobody finds a forced recapture; they play it.
 */
function isForcedRecapture(game: SourceGame, ply: number, answers: readonly ChessMove[]): boolean {
  if (ply < 1 || answers.length === 0) return false
  const previous = game.moves[ply - 1]
  if (!previous) return false
  const made = applyMove(fenAt(game, ply - 1), previous.uci)
  if (!made || !made.captured) return false
  const square = made.to
  if (!answers.every((answer) => answer.to === square && answer.captured)) return false
  const fen = fenAt(game, ply)
  const ways = legalMoves(fen).filter((move) => move.to === square && move.captured)
  return ways.length === 1
}

/**
 * Whether the engine scored a second, different first move about as well as the best one.
 *
 * Returns null when there is no MultiPV data to go on. Null is not "no", and the caller keeps the difference:
 * `answersChecked` goes out false so a screen can say nobody has shown this puzzle has one answer.
 */
function secondGoodMove(evaluation: GenEval, side: Side, ambiguityCp: number): { uci: string; gap: number } | null | undefined {
  const lines = evaluation.alternatives
  if (!lines || lines.length < 2) return undefined
  const best = evaluation.bestmove ?? lines[0]?.uci ?? null
  if (!best) return undefined
  const scoreOf = (one: { uci: string; score: Score }): Score => forSide(one.score, side)
  const bestLine = lines.find((one) => one.uci === best) ?? lines[0]
  const bestScore = scoreOf(bestLine)
  for (const one of lines) {
    if (one.uci === bestLine.uci) continue
    const theirs = scoreOf(one)
    // Two forced mates of the same length are two answers to the same puzzle, which the solution tree can hold.
    // Two ordinary scores within the window are two different ideas, and only one of them would be accepted.
    if (bestScore.kind === 'cp' && theirs.kind === 'cp' && theirs.cp >= bestScore.cp - ambiguityCp) {
      return { uci: one.uci, gap: bestScore.cp - theirs.cp }
    }
  }
  return null
}

// ---------------------------------------------------------------- building the exercise

interface Draft {
  id: string
  fen: string
  objective: 'mate-in-n' | 'win-material' | 'find-best'
  movesToMate?: number
  materialAtLeast?: number
  solution: Solution
  prompt: string
  lesson: string
  source: Provenance
  tags: string[]
  strict: boolean
}

/**
 * A draft turned into a verified puzzle, or a report of why it is not one.
 *
 * The order matters and is the reason this is one function: the exercise is built without hints, checked, its themes
 * worked out from what the check proved, the hints built from those themes, and only then is the real puzzle made
 * and checked again. Hints built before the check would be hints about a claim nobody had tested.
 */
function finishDraft(draft: Draft, moment: Moment, options: GenerateOptions, shallow: boolean, answersChecked: boolean): Candidate {
  const base = {
    id: draft.id,
    kind: 'puzzle' as const,
    startFen: draft.fen,
    objective: draft.objective,
    prompt: draft.prompt,
    solution: draft.solution,
    ...(draft.movesToMate !== undefined ? { movesToMate: draft.movesToMate } : {}),
    ...(draft.materialAtLeast !== undefined ? { materialAtLeast: draft.materialAtLeast } : {}),
    failure: draft.strict ? undefined : PUZZLE_FAILURE,
    source: draft.source,
    tags: draft.tags,
    lesson: draft.lesson
  }
  const probe: Exercise = newExercise(base)
  const firstCheck = validateExercise(probe, options.now)
  if (!firstCheck.ok) {
    return {
      kind: 'rejected',
      rejected: {
        ply: moment.ply,
        playedSan: moment.playedSan,
        problems: firstCheck.problems.filter((one) => one.severity === 'fault').map((one) => one.says),
        says: `This moment was not turned into a puzzle: ${firstCheck.problems.find((one) => one.severity === 'fault')?.says ?? 'the check did not pass.'}`
      }
    }
  }
  const themes: readonly ThemeClaim[] = checkedThemes(probe, firstCheck)
  const hints = hintsFor(probe, themes)

  const made = newPuzzle({ ...base, hints, addedAt: options.now })
  const verified = verifyPuzzle(made, options.now)
  if (!verified.check.ok) {
    return {
      kind: 'rejected',
      rejected: {
        ply: moment.ply,
        playedSan: moment.playedSan,
        problems: verified.check.problems.filter((one) => one.severity === 'fault').map((one) => one.says),
        says: `This moment was not turned into a puzzle: ${verified.check.problems.find((one) => one.severity === 'fault')?.says ?? 'the check did not pass.'}`
      }
    }
  }

  const status = verified.puzzle.exercise.verification.status
  return {
    kind: 'puzzle',
    made: {
      puzzle: verified.puzzle,
      check: verified.check,
      moment,
      engine: options.engine ?? null,
      shallow,
      answersChecked,
      says: [
        status === 'verified'
          ? 'Checked by the rules: the position is legal, the moves can be played, and they do what the puzzle says.'
          : `Not checked: ${verified.puzzle.exercise.verification.needs === 'engine' ? 'settling this one needs an engine.' : 'somebody has to look at it.'}`,
        shallow ? 'The engine search that found this moment was shallower than asked for.' : '',
        answersChecked ? '' : 'Nobody has shown this position has only one answer: the search did not report alternatives.'
      ].filter(Boolean).join(' ')
    }
  }
}

/** The names and places the record really has, for the provenance. Nothing is filled in. */
function gameProvenance(game: SourceGame, ply: number, note: string, now: number): Provenance {
  const meta = game.meta
  const parts: { white?: string; black?: string; event?: string; date?: string; ply?: number } = { ply }
  if (meta.white.name) parts.white = meta.white.name
  if (meta.black.name) parts.black = meta.black.name
  if (meta.event) parts.event = meta.event
  if (meta.date) parts.date = meta.date
  return { kind: 'from-game', by: 'Orbis puzzle maker', game: parts, at: now, note }
}

/** What the engine was, in words, for the record. Only what is known is said. */
export function engineWords(engine: EngineSettings | undefined): string {
  if (!engine) return 'Found by the rules alone, with no engine.'
  const parts: string[] = []
  if (engine.name) parts.push(engine.version ? `${engine.name} ${engine.version}` : engine.name)
  if (engine.depth !== undefined) parts.push(`depth ${engine.depth}`)
  if (engine.movetime !== undefined) parts.push(`${engine.movetime} ms a position`)
  if (engine.nodes !== undefined) parts.push(`${engine.nodes} nodes`)
  if (engine.multipv !== undefined) parts.push(`${engine.multipv} ${engine.multipv === 1 ? 'line' : 'lines'}`)
  return parts.length ? `Found from an engine search: ${parts.join(', ')}.` : 'Found from an engine search; the settings were not recorded.'
}

const sideWord = (side: Side): string => (side === 'w' ? 'White' : 'Black')

// ---------------------------------------------------------------- the mate route

interface MateFound {
  moves: number
  solution: Solution
  answers: ChessMove[]
}

/**
 * The shortest forced mate in a position, up to `mateDepth`, as a complete solution tree.
 *
 * Shortest, because the engine saying "mate in 3" when there is a mate in 2 would make the puzzle ask for the wrong
 * thing and `validateExercise` would -- correctly -- reject it. The tree comes out of an exhaustive search over the
 * real rules, so every defence is answered by construction.
 */
function shortestMate(fen: string, mateDepth: number, budget: number): { found: MateFound | null; exceeded: boolean } {
  for (let moves = 1; moves <= Math.max(1, mateDepth); moves++) {
    const search = forcedMateTree(fen, moves, budget)
    if (search.exceeded) return { found: null, exceeded: true }
    if (search.solution) {
      const answers: ChessMove[] = []
      for (const line of search.solution.lines) {
        const made = applyMove(fen, line.move)
        if (made) answers.push(made)
      }
      return { found: { moves, solution: search.solution, answers }, exceeded: false }
    }
  }
  return { found: null, exceeded: false }
}

function mateCandidate(game: SourceGame, moment: Moment, options: GenerateOptions, shallow: boolean, answersChecked: boolean, note: string): Candidate {
  const mateDepth = options.mateDepth ?? GENERATE_DEFAULTS.mateDepth
  const budget = options.mateBudget ?? GENERATE_DEFAULTS.mateBudget
  const maxAnswers = options.maxAnswers ?? GENERATE_DEFAULTS.maxAnswers
  const { found, exceeded } = shortestMate(moment.fen, mateDepth, budget)
  if (exceeded) return skip(moment.ply, moment.playedSan, 'mate-search-exceeded', `${budget} positions were not enough to settle it`)
  if (!found) return skip(moment.ply, moment.playedSan, 'mate-not-found', `nothing within ${mateDepth} of your own ${mateDepth === 1 ? 'move' : 'moves'}`)

  // Too many first moves mate: the position is not asking anything.
  if (found.answers.length > maxAnswers) {
    return skip(moment.ply, moment.playedSan, 'too-many-answers', `${found.answers.length} different moves force the mate, and ${maxAnswers} is the most a puzzle may have`)
  }
  if (isForcedRecapture(game, moment.ply, found.answers)) {
    return skip(moment.ply, moment.playedSan, 'forced-recapture')
  }
  const played = moment.playedUci
  const wasPlayed = played !== null && found.answers.some((answer) => answer.uci === played)
  if (wasPlayed && (options.onlyMissed ?? GENERATE_DEFAULTS.onlyMissed)) {
    return skip(moment.ply, moment.playedSan, 'mate-was-played')
  }

  const sans = found.answers.map((one) => one.san)
  const lesson = wasPlayed
    ? `${moment.playedSan} was played in the game, and it is the mate.`
    : moment.playedSan
      ? `In the game ${moment.playedSan} was played here. The mate was ${sans.join(' or ')}.`
      : `The mate was ${sans.join(' or ')}.`

  return finishDraft({
    id: `pz-${game.id}-${moment.ply}-m${found.moves}`,
    fen: moment.fen,
    objective: 'mate-in-n',
    movesToMate: found.moves,
    solution: found.solution,
    prompt: `${sideWord(moment.side)} to play. There is a forced mate in ${found.moves}.`,
    lesson,
    source: gameProvenance(game, moment.ply, note, options.now),
    tags: [gameTag(game.id), `ply:${moment.ply}`],
    strict: false
  }, moment, options, shallow, answersChecked)
}

// ---------------------------------------------------------------- the material route

/**
 * The shortest prefix of the engine's line that really wins material, by the rules.
 *
 * Walks the line, stopping only on the solver's own moves (a line that ends with the opponent to move has nothing
 * recorded for the solver to play, which `validateExercise` calls a dead end and is right to). At each stop the
 * material is counted from the board, and the target is set to exactly what was won -- which is what makes the
 * recapture guard in `validateExercise` bite: a line that stops one move before the material comes back fails.
 */
function materialLine(fen: string, pv: readonly string[], side: Side, atLeast: number): { moves: string[]; won: number } | null {
  let position = fen
  const played: string[] = []
  for (const [index, uci] of pv.entries()) {
    const made = applyMove(position, uci)
    if (!made) break
    position = made.after
    played.push(uci)
    // Only the solver's own moves may end a line, and the solver moves at even indexes.
    if (index % 2 !== 0) continue
    const won = materialSwing(fen, position, side)
    if (won >= atLeast) return { moves: [...played], won }
  }
  return null
}

function materialCandidate(
  game: SourceGame,
  moment: Moment,
  evaluation: GenEval,
  options: GenerateOptions,
  shallow: boolean,
  answersChecked: boolean,
  note: string
): Candidate | null {
  const atLeast = options.materialAtLeast ?? GENERATE_DEFAULTS.materialAtLeast
  const pv = evaluation.pvUci ?? []
  if (pv.length === 0) return null
  // Try the shortest line that wins the material, then longer ones if the check says it stopped too early.
  let target = atLeast
  for (let attempt = 0; attempt < 6; attempt++) {
    const line = materialLine(moment.fen, pv, moment.side, target)
    if (!line) return null
    const first = applyMove(moment.fen, line.moves[0])
    if (!first) return null
    if (isForcedRecapture(game, moment.ply, [first])) return skip(moment.ply, moment.playedSan, 'forced-recapture')
    const solution: Solution = { lines: nestLine(line.moves) }
    const draft: Draft = {
      id: `pz-${game.id}-${moment.ply}-w${line.won}`,
      fen: moment.fen,
      objective: 'win-material',
      materialAtLeast: line.won,
      solution,
      prompt: `${sideWord(moment.side)} to play. There is material to be won here — at least ${line.won} centipawns by the end of the line, and it stays won.`,
      lesson: moment.playedSan
        ? `In the game ${moment.playedSan} was played here. ${first.san} wins ${line.won} centipawns: ${describeLine(moment.fen, line.moves)}.`
        : `${first.san} wins ${line.won} centipawns: ${describeLine(moment.fen, line.moves)}.`,
      source: gameProvenance(game, moment.ply, note, options.now),
      tags: [gameTag(game.id), `ply:${moment.ply}`],
      strict: false
    }
    const candidate = finishDraft(draft, moment, options, shallow, answersChecked)
    if (candidate.kind === 'puzzle') return candidate
    // "Stops too early" means the line has to go further. Anything else is a real fault and is reported.
    const tooEarly = candidate.kind === 'rejected' && candidate.rejected.problems.some((one) => one.includes('stops too early'))
    if (!tooEarly) return candidate
    target = line.won + 1
  }
  return null
}

/** A line written out in readable notation, for the explanation after a solve. */
function describeLine(fen: string, uci: readonly string[]): string {
  const sans: string[] = []
  let position = fen
  for (const one of uci) {
    const made = applyMove(position, one)
    if (!made) break
    sans.push(made.san)
    position = made.after
  }
  return sans.join(' ')
}

// ---------------------------------------------------------------- the engine-only route

function bestMoveCandidate(
  game: SourceGame,
  moment: Moment,
  evaluation: GenEval,
  options: GenerateOptions,
  shallow: boolean,
  answersChecked: boolean,
  note: string
): Candidate {
  const best = evaluation.bestmove ?? null
  if (!best) return skip(moment.ply, moment.playedSan, 'no-better-move')
  const made = applyMove(moment.fen, best)
  if (!made) return skip(moment.ply, moment.playedSan, 'not-provable', 'the engine’s move cannot be played in this position')
  if (isForcedRecapture(game, moment.ply, [made])) return skip(moment.ply, moment.playedSan, 'forced-recapture')
  return finishDraft({
    id: `pz-${game.id}-${moment.ply}-b`,
    fen: moment.fen,
    objective: 'find-best',
    solution: { lines: [{ move: best }] },
    prompt: `${sideWord(moment.side)} to play. The engine thinks there is something much better here than what was played.`,
    lesson: moment.playedSan
      ? `In the game ${moment.playedSan} was played. The engine preferred ${made.san}. Which move is better is the engine’s opinion, and the rules cannot settle it.`
      : `The engine preferred ${made.san}. Which move is better is the engine’s opinion, and the rules cannot settle it.`,
    source: gameProvenance(game, moment.ply, note, options.now),
    tags: [gameTag(game.id), `ply:${moment.ply}`],
    strict: false
  }, moment, options, shallow, answersChecked)
}

// ---------------------------------------------------------------- one position, the engine route

/**
 * One position of a game, considered as a puzzle, using the evaluations handed in.
 *
 * Separate from `generateFromGame` so a screen can do this a position at a time and stay alive between them.
 */
export function considerPly(game: SourceGame, ply: number, index: PlyIndex, options: GenerateOptions): Candidate {
  const minLoss = options.minLossCp ?? GENERATE_DEFAULTS.minLossCp
  const minDepth = options.minDepth ?? GENERATE_DEFAULTS.minDepth
  const ambiguityCp = options.ambiguityCp ?? GENERATE_DEFAULTS.ambiguityCp
  const decided = options.alreadyDecidedCp ?? GENERATE_DEFAULTS.alreadyDecidedCp

  const fen = fenAt(game, ply)
  const move = game.moves[ply] ?? null
  const playedSan = move ? move.san : null
  const unusable = positionUsable(fen)
  if (unusable) return skip(ply, playedSan, unusable)

  const side = sideToMove(fen)
  if (options.side && options.side !== side) return skip(ply, playedSan, 'wrong-side')

  const before = index.byPly.get(ply)
  const after = index.byPly.get(ply + 1)
  if (!before) return skip(ply, playedSan, 'no-evaluation', 'the position before the move was not searched')
  if (!move) return skip(ply, playedSan, 'no-evaluation', 'nothing was played from this position, so there is no mistake to find')
  if (!after) return skip(ply, playedSan, 'no-evaluation', 'the position after the move was not searched')
  if (before.provisional || after.provisional) return skip(ply, playedSan, 'provisional')

  const depth = before.depth !== null && after.depth !== null ? Math.min(before.depth, after.depth) : null
  const shallow = depth === null || depth < minDepth
  if (shallow && !(options.includeShallow ?? GENERATE_DEFAULTS.includeShallow)) {
    return skip(ply, playedSan, 'shallow', depth === null ? 'the depth was not recorded' : `depth ${depth}, and ${minDepth} is the least that can judge a move`)
  }

  const lossCp = lossFrom(before.score, after.score, side)
  const beforeForSide = forSide(before.score, side)
  const afterForSide = forSide(after.score, side)
  const missedMate = beforeForSide.kind === 'mate' && beforeForSide.moves > 0 && !(afterForSide.kind === 'mate' && afterForSide.moves > 0)

  const moment: Moment = {
    ply,
    fen,
    number: moveNumber(fen),
    side,
    playedSan,
    playedUci: move.uci,
    before: before.score,
    after: after.score,
    lossCp,
    depth,
    found: 'engine-swing'
  }

  const best = before.bestmove ?? null
  if (!best || best === move.uci) return skip(ply, playedSan, 'no-better-move', best ? 'the move played was the engine’s own choice' : undefined)

  // Was anything really given up? A missed forced mate counts even when no centipawn number describes it.
  if (!missedMate) {
    if (lossCp === null) return skip(ply, playedSan, 'not-provable', 'the two scores cannot be put on one scale, so nothing can be said about what the move cost')
    if (lossCp < minLoss) return skip(ply, playedSan, 'loss-too-small', `${lossCp} centipawns, and ${minLoss} is the least worth finding`)
    if (beforeForSide.kind === 'cp' && afterForSide.kind === 'cp'
      && Math.abs(beforeForSide.cp) >= decided && Math.abs(afterForSide.cp) >= decided
      && Math.sign(beforeForSide.cp) === Math.sign(afterForSide.cp)) {
      return skip(ply, playedSan, 'already-decided', `${beforeForSide.cp} centipawns before and ${afterForSide.cp} after`)
    }
  }

  const second = secondGoodMove(before, side, ambiguityCp)
  const answersChecked = second !== undefined
  if (second) {
    const other = applyMove(fen, second.uci)
    return skip(ply, playedSan, 'two-good-moves', `${other ? other.san : second.uci} is only ${second.gap} centipawns behind`)
  }

  const note = engineWords(options.engine)

  // A mate first: the rules can prove it, and a proof beats an opinion.
  const mate = mateCandidate(game, moment, options, shallow, answersChecked, note)
  if (mate.kind === 'puzzle') {
    // The rules settled this one, so how deep the engine looked only decided where to look.
    return { kind: 'puzzle', made: { ...mate.made, shallow: false } }
  }
  if (mate.kind === 'rejected') return mate

  const material = materialCandidate(game, moment, before, options, shallow, answersChecked, note)
  if (material) return material

  if (options.includeEngineOnly ?? GENERATE_DEFAULTS.includeEngineOnly) {
    return bestMoveCandidate(game, moment, before, options, shallow, answersChecked, note)
  }
  return skip(ply, playedSan, 'not-provable', 'neither a forced mate nor material that can be counted')
}

// ---------------------------------------------------------------- one position, the rules-only route

/**
 * One position of a game, considered for a forced mate, with no engine at all.
 *
 * `forcedMateTree` is an exhaustive search over the rules, so what it finds is proved rather than suggested. This is
 * how Orbis makes real puzzles out of somebody's games on a machine that has never had Stockfish on it.
 */
export function mateAt(game: SourceGame, ply: number, options: GenerateOptions): Candidate {
  const fen = fenAt(game, ply)
  const move = game.moves[ply] ?? null
  const playedSan = move ? move.san : null
  const unusable = positionUsable(fen)
  if (unusable) return skip(ply, playedSan, unusable)
  const side = sideToMove(fen)
  if (options.side && options.side !== side) return skip(ply, playedSan, 'wrong-side')
  const moment: Moment = {
    ply,
    fen,
    number: moveNumber(fen),
    side,
    playedSan,
    playedUci: move ? move.uci : null,
    before: null,
    after: null,
    lossCp: null,
    depth: null,
    found: 'rules-mate-scan'
  }
  return mateCandidate(game, moment, options, false, true, 'Found by the rules alone, with no engine: an exhaustive search for a forced mate.')
}

// ---------------------------------------------------------------- whole games

function collect(gameId: string, plies: number, candidates: readonly Candidate[], index: PlyIndex | null): GenerateResult {
  const generated: Generated[] = []
  const rejected: Rejected[] = []
  const skipped: Skipped[] = []
  let shallow = 0
  for (const candidate of candidates) {
    if (candidate.kind === 'puzzle') {
      generated.push(candidate.made)
      if (candidate.made.shallow) shallow += 1
    } else if (candidate.kind === 'rejected') rejected.push(candidate.rejected)
    else {
      skipped.push(candidate.skipped)
      if (candidate.skipped.reason === 'shallow') shallow += 1
    }
  }
  const verified = generated.filter((one) => one.puzzle.exercise.verification.status === 'verified').length
  const parts: string[] = []
  parts.push(generated.length === 0
    ? 'No puzzles came out of this game.'
    : `${generated.length} ${generated.length === 1 ? 'puzzle' : 'puzzles'} made, ${verified} of them checked by the rules.`)
  if (rejected.length) parts.push(`${rejected.length} ${rejected.length === 1 ? 'moment was' : 'moments were'} thrown out because the solution did not hold up.`)
  if (skipped.length) parts.push(`${skipped.length} ${skipped.length === 1 ? 'position' : 'positions'} gave nothing.`)
  return {
    gameId,
    generated: Object.freeze(generated),
    rejected: Object.freeze(rejected),
    skipped: Object.freeze(skipped),
    coverage: {
      plies,
      considered: candidates.length,
      evaluated: index ? index.byPly.size : 0,
      shallow,
      ignored: Object.freeze(index ? index.ignored : [])
    },
    says: parts.join(' ')
  }
}

/** Which positions of a game to look at, given the options. */
export function plyRange(game: SourceGame, options: GenerateOptions): number[] {
  const last = game.moves.length
  const from = Math.max(0, Math.min(last, options.fromPly ?? 0))
  const to = Math.max(from, Math.min(last, options.toPly ?? last))
  const out: number[] = []
  for (let ply = from; ply <= to; ply++) out.push(ply)
  return out
}

/** Every puzzle a game and a set of evaluations give, with everything that was skipped and why. */
export function generateFromGame(game: SourceGame, evaluations: readonly GenEval[], options: GenerateOptions): GenerateResult {
  const index = indexEvaluations(game, evaluations)
  const max = options.maxPuzzles ?? GENERATE_DEFAULTS.maxPuzzles
  const candidates: Candidate[] = []
  let made = 0
  for (const ply of plyRange(game, options)) {
    if (made >= max) {
      candidates.push(skip(ply, game.moves[ply]?.san ?? null, 'enough-already'))
      continue
    }
    const candidate = considerPly(game, ply, index, options)
    if (candidate.kind === 'puzzle') made += 1
    candidates.push(candidate)
  }
  return collect(game.id, game.moves.length, candidates, index)
}

/** Every forced mate a game contains, found by the rules, with no engine. */
export function scanForMates(game: SourceGame, options: GenerateOptions): GenerateResult {
  const max = options.maxPuzzles ?? GENERATE_DEFAULTS.maxPuzzles
  const candidates: Candidate[] = []
  let made = 0
  for (const ply of plyRange(game, options)) {
    if (made >= max) {
      candidates.push(skip(ply, game.moves[ply]?.san ?? null, 'enough-already'))
      continue
    }
    const candidate = mateAt(game, ply, options)
    if (candidate.kind === 'puzzle') made += 1
    candidates.push(candidate)
  }
  return collect(game.id, game.moves.length, candidates, null)
}

/** How long a mate scan is likely to take, so a screen can warn before starting one rather than after. */
export function scanCost(game: SourceGame, options: GenerateOptions): { positions: number; roughlySeconds: number; says: string } {
  const positions = plyRange(game, options).length
  const depth = options.mateDepth ?? GENERATE_DEFAULTS.mateDepth
  // Measured on the machine this was written for: about 3 ms a position for a mate in one, about 230 ms for a mate
  // in two, because the second one looks at every reply to every move. It is a guide, not a promise.
  const perPosition = depth <= 1 ? 0.003 : 0.23
  const roughlySeconds = Math.max(1, Math.round(positions * perPosition))
  return {
    positions,
    roughlySeconds,
    says: depth <= 1
      ? `${positions} positions to look through for a mate in one. A second or two.`
      : `${positions} positions to look through for a mate in up to ${depth}. Roughly ${roughlySeconds} ${roughlySeconds === 1 ? 'second' : 'seconds'} on this kind of machine, and you can stop it.`
  }
}

/** The game a generated puzzle came from, read back off its tags. */
export const sourceGameId = (puzzle: Puzzle): string | null => {
  const tag = puzzle.exercise.tags.find((one) => one.startsWith(GAME_TAG_PREFIX))
  return tag ? tag.slice(GAME_TAG_PREFIX.length) : null
}
