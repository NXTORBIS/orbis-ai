import { START_FEN, applyMove, boardSquares, checkFen, outcome, sideToMove, type MoveInput } from './rules.ts'
import type { GameMeta, GameMove, GameResult, GameSource } from './model.ts'
import type { Score, Side } from './evaluation.ts'
import { PIECE_NAME, PIECE_POINTS, type CommentaryStyle } from './commentary.ts'
import {
  TIME_CONTROLS,
  clockSecondsFor,
  flaggedAt,
  moveMade,
  newClock,
  pauseClock,
  pgnTimeControl,
  remainingAt,
  resumeClock,
  settleClock,
  spentAt,
  startClock,
  stopClock,
  timeControl,
  type ClockState,
  type TimeControl
} from './clock.ts'

/**
 * A game against the engine.
 *
 * This is the session: who is playing which colour, whose turn it is, what the clock says, when the engine has to
 * think, and how the game ends. It plays no moves of its own and it does not talk to the engine -- it says what
 * the engine should be asked and judges the answer. Everything here is pure, so a whole game can be played out in
 * a test with no engine, no window and no clock of its own (Sections 051-060).
 *
 * Four rules it keeps, each because of the way a play-the-computer screen goes wrong without it.
 *
 * **The engine is asked once per turn.** A screen that asks again on every redraw gets two searches for one
 * position, and the second answer arrives after the first has already been played -- which is how a program plays
 * two moves in a row. `askEngine` refuses a second ask for a position it has already asked about, and the answer
 * is only taken if it names the request that was sent and the position it was sent about.
 *
 * **A move the engine offers is checked before it is played.** Against that exact position, through `rules.ts`.
 * The engine service already does this once; it is done again here because the answer travels through the window
 * in between, and a move that cannot be played would corrupt the game rather than merely look wrong.
 *
 * **After the game is over nothing is accepted.** Not a move, not a resignation, not a draw. A terminal state is
 * terminal, and every mutator below refuses rather than quietly appending to a finished game.
 *
 * **A draw offer is an offer.** It is recorded, it waits for an answer, and it is declined by a move. Nothing
 * here turns an offer into a result, which is the one thing a careless implementation does.
 *
 * ## Strength is not a rating
 *
 * The levels below are approximate and say so everywhere they are shown. Orbis does not claim an Elo number for
 * any of them, because it has not measured one: an Elo rating is the result of playing hundreds of games against
 * rated opposition, and nothing in this repository has played one. What each level really is, is written down as
 * data -- how long the engine thinks, how deep it is allowed to go, how many of its own lines it is asked for, and
 * how often Orbis plays one of the engine's lower choices instead of its first.
 */

// ---------------------------------------------------------------- strength

export type Difficulty = 'gentle' | 'easy' | 'club' | 'strong' | 'full'

export interface DifficultyLevel {
  id: Difficulty
  name: string
  /** Said plainly on the setup screen. Never an Elo claim. */
  about: string
  /** The search limits really sent with every engine turn. */
  think: { movetime?: number; depth?: number; nodes?: number }
  /** How many of the engine's own lines to ask for, so a gentler level has something to choose between. */
  lines: number
  /** How often a line other than the engine's first choice is played, 0 to 1. */
  looseness: number
  /** How far down the engine's own list the choice may reach. 1 means the first choice only. */
  spread: number
  /**
   * What would be asked of the engine's own `Skill Level` option, when it advertises one and something can set it.
   *
   * Recorded rather than applied: there is no channel from the window that sets an engine option, so today this
   * value is not sent anywhere. It is here because it is part of what the level means, and because leaving it out
   * would make the level look like it was only ever about thinking time. `SKILL_LEVEL_NOTE` says this on screen.
   */
  skillLevel?: number
}

export const STRENGTH_NOTE =
  'These levels are approximate. Orbis does not claim a rating for any of them: no rated games have been played to measure one.'

export const SKILL_LEVEL_NOTE =
  'Strength here comes from how long the engine thinks and from how often Orbis plays one of the engine’s own lower choices. The engine’s built-in Skill Level is not set, because nothing in this window can set an engine option yet.'

export const DIFFICULTIES: readonly DifficultyLevel[] = Object.freeze([
  Object.freeze({
    id: 'gentle' as const,
    name: 'Gentle',
    about: 'Thinks for a moment and often plays its second, third or fourth choice. The easiest opponent here.',
    think: Object.freeze({ movetime: 50, depth: 4 }),
    lines: 4,
    looseness: 0.75,
    spread: 4,
    skillLevel: 1
  }),
  Object.freeze({
    id: 'easy' as const,
    name: 'Easy',
    about: 'Thinks briefly and sometimes plays its second or third choice.',
    think: Object.freeze({ movetime: 150, depth: 6 }),
    lines: 3,
    looseness: 0.5,
    spread: 3,
    skillLevel: 5
  }),
  Object.freeze({
    id: 'club' as const,
    name: 'Club',
    about: 'Thinks for about a third of a second and usually plays its first choice.',
    think: Object.freeze({ movetime: 350 }),
    lines: 3,
    looseness: 0.2,
    spread: 2,
    skillLevel: 12
  }),
  Object.freeze({
    id: 'strong' as const,
    name: 'Strong',
    about: 'A second a move, and always its first choice.',
    think: Object.freeze({ movetime: 1000 }),
    lines: 1,
    looseness: 0,
    spread: 1,
    skillLevel: 18
  }),
  Object.freeze({
    id: 'full' as const,
    name: 'Full strength',
    about: 'Three seconds a move with nothing held back. Expect to lose.',
    think: Object.freeze({ movetime: 3000 }),
    lines: 1,
    looseness: 0,
    spread: 1
  })
])

export const difficulty = (id: Difficulty): DifficultyLevel => DIFFICULTIES.find((one) => one.id === id) ?? DIFFICULTIES[2]

/** What a level really does, in one sentence, from its own data rather than from a description. */
export function describeDifficulty(level: DifficultyLevel): string {
  const bits: string[] = []
  if (level.think.movetime) bits.push(`thinks for ${level.think.movetime} ms`)
  if (level.think.depth) bits.push(`no deeper than ${level.think.depth} moves ahead`)
  if (level.think.nodes) bits.push(`at most ${level.think.nodes} positions`)
  if (level.looseness > 0) {
    bits.push(`plays one of its top ${level.spread} lines about ${Math.round(level.looseness * 100)}% of the time`)
  } else {
    bits.push('always plays its first choice')
  }
  return `${bits.join(', ')}.`
}

// ---------------------------------------------------------------- how much to think

/**
 * How long the engine may think on this turn.
 *
 * The level's own time, except that it may not spend a serious share of a clock it has to finish the game on.
 * A three-second search on a 5+0 clock with eight seconds left is the engine flagging itself, which is a loss
 * nobody chose. The share is a twentieth of what is left, plus most of an increment it is about to be paid.
 */
export const THINK_SHARE = 20
export const MIN_THINK_MS = 50

export function thinkFor(level: DifficultyLevel, clock: ClockState, side: Side, now: number): { movetime?: number; depth?: number; nodes?: number } {
  const wanted = { ...level.think }
  const left = remainingAt(clock, now)
  if (!left) return wanted
  const budget = Math.floor(left[side] / THINK_SHARE + clock.control.incrementSeconds * 800)
  const allowed = Math.max(MIN_THINK_MS, budget)
  if (wanted.movetime === undefined) return { ...wanted, movetime: allowed }
  return { ...wanted, movetime: Math.min(wanted.movetime, allowed) }
}

// ---------------------------------------------------------------- choosing from the engine's own lines

export interface EngineCandidate {
  /** Coordinates, as the engine gave them. */
  uci: string
}

export interface EngineChoice {
  uci: string
  /** Where it came in the engine's own list; 1 is its first choice. */
  rank: number
  /** True when it is not the first choice, because this level plays loosely. */
  loose: boolean
}

const COORDINATES = /^[a-h][1-8][a-h][1-8][qrbn]?$/

/**
 * Which of the engine's own lines to play.
 *
 * Every candidate came out of a real search. A gentler level does not play a worse move that Orbis invented -- it
 * plays one of the engine's own lower choices, which is a real move with a real evaluation behind it. `roll` is a
 * number from 0 up to but not including 1, supplied by the caller, so a test can decide exactly what happens.
 */
export function chooseEngineMove(candidates: readonly EngineCandidate[], level: DifficultyLevel, roll: number): EngineChoice | null {
  const usable = candidates.filter((one) => typeof one?.uci === 'string' && COORDINATES.test(one.uci))
  if (!usable.length) return null
  const chance = Math.max(0, Math.min(1, level.looseness))
  const spread = Math.max(1, Math.min(Math.floor(level.spread), usable.length))
  const dice = Number.isFinite(roll) ? Math.max(0, Math.min(0.999_999, roll)) : 0
  if (chance <= 0 || spread <= 1 || dice >= chance) return { uci: usable[0].uci, rank: 1, loose: false }
  // Inside the loose band, how far down the list the choice falls.
  const share = dice / chance
  const index = Math.min(spread - 1, 1 + Math.floor(share * (spread - 1)))
  return { uci: usable[index].uci, rank: index + 1, loose: index > 0 }
}

// ---------------------------------------------------------------- help, and how much of it

export type Assistance = 'none' | 'nudge' | 'idea' | 'best'

export interface AssistanceLevel {
  id: Assistance
  name: string
  about: string
  /** Exactly what a hint at this level may say. The bound, written down. */
  reveals: string
}

export const ASSISTANCE_LEVELS: readonly AssistanceLevel[] = Object.freeze([
  Object.freeze({
    id: 'none' as const,
    name: 'No help',
    about: 'No hints. The game is yours.',
    reveals: 'Nothing.'
  }),
  Object.freeze({
    id: 'nudge' as const,
    name: 'A nudge',
    about: 'Says which piece the engine would move, and nothing else.',
    reveals: 'The kind of piece. No square, no notation.'
  }),
  Object.freeze({
    id: 'idea' as const,
    name: 'The idea',
    about: 'Says which piece and what the move does — takes something, gives check, castles, promotes.',
    reveals: 'The kind of piece and what the move achieves. No square, no notation.'
  }),
  Object.freeze({
    id: 'best' as const,
    name: 'The move',
    about: 'Shows the engine’s move in full.',
    reveals: 'The move itself, in notation and on the board.'
  })
])

export const assistance = (id: Assistance): AssistanceLevel => ASSISTANCE_LEVELS.find((one) => one.id === id) ?? ASSISTANCE_LEVELS[0]

/** How long a hint search is given. Longer than a gentle level's own move, because a hint should be worth having. */
export const HINT_MOVETIME = 1200

// ---------------------------------------------------------------- setting a game up

export type SideChoice = 'w' | 'b' | 'random'

export interface ArenaSetup {
  side: SideChoice
  difficulty: Difficulty
  control: TimeControl
  assistance: Assistance
  commentary: CommentaryStyle
  /** Where the game starts. The usual position unless one was set up. */
  startFen: string
  /** The person's name for the record, when they gave one. Absent is absent; it is never filled in. */
  yourName?: string
}

/** The one-click default: White, a club-strength opponent, ten minutes each, no help, a friendly coach. */
export const STANDARD_SETUP: ArenaSetup = Object.freeze({
  side: 'w' as const,
  difficulty: 'club' as const,
  control: TIME_CONTROLS.find((one) => one.id === '600+0') ?? timeControl(600, 0),
  assistance: 'none' as const,
  commentary: 'coach' as const,
  startFen: START_FEN
})

export interface SetupProblem {
  /** Which part of the setup is wrong. */
  field: 'startFen' | 'control' | 'difficulty' | 'assistance' | 'commentary'
  /** Said plainly. */
  reason: string
}

/** Checks a setup before a game is started from it, so a bad position is refused rather than half-loaded. */
export function setupProblems(setup: ArenaSetup): SetupProblem[] {
  const problems: SetupProblem[] = []
  const fen = checkFen(setup.startFen)
  if (!fen.ok) problems.push({ field: 'startFen', reason: fen.reason ?? 'That position cannot be played from.' })
  else if (outcome(setup.startFen).over) problems.push({ field: 'startFen', reason: 'That position is already finished, so there is no game to play.' })
  if (!DIFFICULTIES.some((one) => one.id === setup.difficulty)) problems.push({ field: 'difficulty', reason: 'That is not a level Orbis has.' })
  if (!ASSISTANCE_LEVELS.some((one) => one.id === setup.assistance)) problems.push({ field: 'assistance', reason: 'That is not a level of help Orbis has.' })
  if (setup.control.initialSeconds < 0) problems.push({ field: 'control', reason: 'A clock cannot start below zero.' })
  return problems
}

// ---------------------------------------------------------------- the session

export type FinishReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold'
  | 'fifty-move'
  | 'resignation'
  | 'flag'
  | 'agreed-draw'

export interface ArenaFinish {
  result: GameResult
  reason: FinishReason
  /** How it went for the person, which is what the summary leads with. */
  forYou: 'win' | 'loss' | 'draw'
  /** The PGN `Termination` line: said in words, and only when there is something to say beyond the result. */
  termination?: string
  at: number
}

export interface DrawOffer {
  by: 'you' | 'engine'
  /** The half-move it was made at, so a stale offer can be recognised. */
  ply: number
  at: number
}

export interface Thinking {
  /** The request that was sent. An answer naming anything else is not this one's. */
  requestId: string
  /** The position it was sent about. An answer about anything else is not used. */
  fen: string
  /** Whether this search is for the engine's move or for a hint. They are never confused. */
  purpose: 'move' | 'hint'
  startedAt: number
}

export interface Remark {
  ply: number
  text: string
  from: 'board' | 'engine'
  id: string
}

export interface Hint {
  level: Assistance
  text: string
  /** Only ever set at the `best` level. The bound is enforced here, not by whatever shows it. */
  uci?: string
  san?: string
  /** The position it was about, so a hint cannot be shown under a different one. */
  fen: string
  at: number
}

export interface ArenaState {
  setup: ArenaSetup
  level: DifficultyLevel
  human: Side
  engine: Side
  startFen: string
  fen: string
  /** The game so far, in the shape the Library stores. */
  moves: GameMove[]
  /** The notation alone, which is what the rules need to see repetition and the fifty-move rule. */
  history: string[]
  clock: ClockState
  /** Set once, when the game ends. Nothing is accepted afterwards. */
  finish: ArenaFinish | null
  /** An offer that has been made and not answered. An offer is not a draw. */
  drawOffer: DrawOffer | null
  thinking: Thinking | null
  /**
   * The half-move the engine was last asked about. What makes "exactly once per turn" true rather than hoped for.
   */
  askedAtPly: number | null
  remarks: Remark[]
  /** The hint on screen, if any. */
  hint: Hint | null
  /** How many hints were taken, which the summary says plainly. */
  hintsTaken: number
  /** The last thing that went wrong, for the screen to show. Cleared by the next thing that works. */
  problem: string | null
  startedAt: number
  /** The id of the stored game, once it has been saved. Empty until then. */
  gameId: string
}

export type ArenaStep =
  | { ok: true; state: ArenaState; move?: GameMove; finish?: ArenaFinish }
  | { ok: false; state: ArenaState; problem: string }

const refuse = (state: ArenaState, problem: string): ArenaStep => ({ ok: false, state, problem })

const otherSide = (side: Side): Side => (side === 'w' ? 'b' : 'w')

/** The half-move the game is at: 0 before anything has been played. */
export const plyOf = (state: ArenaState): number => state.moves.length

/** Whose turn it is, asked of the position rather than counted. */
export const turnOf = (state: ArenaState): Side => sideToMove(state.fen)

export const yourTurn = (state: ArenaState): boolean => state.finish === null && turnOf(state) === state.human

export const engineTurn = (state: ArenaState): boolean => state.finish === null && turnOf(state) === state.engine

/**
 * A new game.
 *
 * `roll` decides the colour when the setup says random; it is a number from the caller so the choice can be tested.
 * The clock starts on the side the position says is to move, which is not always White -- a game set up from a
 * position can begin with Black.
 */
export function startArena(setup: ArenaSetup, o: { now: number; roll?: number }): ArenaState {
  const startFen = checkFen(setup.startFen).ok ? setup.startFen : START_FEN
  const roll = Number.isFinite(o.roll) ? Math.max(0, Math.min(0.999_999, o.roll as number)) : 0
  const human: Side = setup.side === 'random' ? (roll < 0.5 ? 'w' : 'b') : setup.side
  const clock = startClock(newClock(setup.control, o.now), sideToMove(startFen), o.now)
  return {
    setup: { ...setup, startFen },
    level: difficulty(setup.difficulty),
    human,
    engine: otherSide(human),
    startFen,
    fen: startFen,
    moves: [],
    history: [],
    clock,
    finish: null,
    drawOffer: null,
    thinking: null,
    askedAtPly: null,
    remarks: [],
    hint: null,
    hintsTaken: 0,
    problem: null,
    startedAt: o.now,
    gameId: ''
  }
}

/**
 * Whether a side could still mate with what it has.
 *
 * This decides what a fallen flag means: a flag against a player who could not mate anyway is a draw, not a loss.
 * Only the three cases that are certain are treated as a draw -- a bare king, king and one knight, king and one
 * bishop. King and two knights can mate, so it is a win; two bishops of the same colour cannot, and Orbis calls
 * that a win because telling them apart needs more than a material count and a wrong draw is worse than a wrong
 * win here.
 */
export function mateImpossibleFor(fen: string, side: Side): boolean {
  const mine = boardSquares(fen).filter((one) => one.color === side && one.type !== 'k')
  if (mine.length === 0) return true
  if (mine.length === 1 && (mine[0].type === 'n' || mine[0].type === 'b')) return true
  return false
}

/** Material in points for one side, used only for the summary. */
export function pointsFor(fen: string, side: Side): number {
  return boardSquares(fen)
    .filter((one) => one.color === side)
    .reduce((total, one) => total + PIECE_POINTS[one.type], 0)
}

const forYouFrom = (result: GameResult, human: Side): 'win' | 'loss' | 'draw' => {
  if (result === '1/2-1/2') return 'draw'
  if (result === '*') return 'draw'
  return (result === '1-0') === (human === 'w') ? 'win' : 'loss'
}

/** Ends the game, once. A second call cannot change a finished game's result. */
function finishWith(state: ArenaState, finish: Omit<ArenaFinish, 'forYou'>, now: number): ArenaState {
  if (state.finish) return state
  return {
    ...state,
    clock: stopClock(state.clock, now),
    thinking: null,
    drawOffer: null,
    hint: null,
    finish: { ...finish, forYou: forYouFrom(finish.result, state.human) }
  }
}

/** The end of the game as the rules see it, from the position and the notation that reached it. */
function naturalEnd(state: ArenaState, now: number): ArenaState {
  const ended = outcome(state.fen, state.history)
  if (!ended.over) return state
  const termination =
    ended.reason === 'checkmate'
      ? 'Checkmate'
      : ended.reason === 'stalemate'
        ? 'Stalemate'
        : ended.reason === 'insufficient-material'
          ? 'Not enough material left to mate'
          : ended.reason === 'threefold'
            ? 'The same position three times'
            : 'Fifty moves with nothing captured and no pawn moved'
  return finishWith(state, { result: ended.result, reason: ended.reason, termination, at: now }, now)
}

/**
 * A fallen flag, settled.
 *
 * Checked on every move and by `tick`, so the game ends when the time ran out rather than when somebody next
 * clicked something.
 */
export function claimFlag(state: ArenaState, now: number): ArenaState {
  if (state.finish) return state
  const fallen = flaggedAt(state.clock, now)
  if (!fallen) return state
  const settled = { ...state, clock: settleClock(state.clock, now) }
  const winner = otherSide(fallen)
  if (mateImpossibleFor(state.fen, winner)) {
    return finishWith(
      settled,
      { result: '1/2-1/2', reason: 'flag', termination: `${fallen === 'w' ? 'White' : 'Black'} ran out of time, and ${winner === 'w' ? 'White' : 'Black'} could not mate with what was left`, at: now },
      now
    )
  }
  return finishWith(
    settled,
    { result: winner === 'w' ? '1-0' : '0-1', reason: 'flag', termination: `${fallen === 'w' ? 'White' : 'Black'} ran out of time`, at: now },
    now
  )
}

/**
 * The clock moved on.
 *
 * Called by the screen on a timer. Pure: it reads the stamp it is given and ends the game if the time has gone.
 * Nothing else about the session changes, so calling it often is harmless.
 */
export function tick(state: ArenaState, now: number): ArenaState {
  if (state.finish) return state
  const fallen = flaggedAt(state.clock, now)
  if (!fallen) return state
  return claimFlag(state, now)
}

/**
 * A move, by whoever is said to have made it.
 *
 * The one place a move enters the game. It refuses a finished game, a move out of turn, and a move that is not
 * legal in this exact position, and it changes nothing when it refuses.
 */
export function playMove(state: ArenaState, move: MoveInput, by: 'you' | 'engine', now: number): ArenaStep {
  if (state.finish) return refuse(state, 'The game is over, so no more moves can be played.')
  const mover: Side = by === 'you' ? state.human : state.engine
  if (turnOf(state) !== mover) {
    return refuse(state, by === 'you' ? 'It is not your turn.' : 'It is not the engine’s turn.')
  }
  const flagged = flaggedAt(state.clock, now)
  if (flagged) {
    // The time went while this move was being made. The clock decides, not the move.
    const ended = claimFlag(state, now)
    return { ok: true, state: ended, ...(ended.finish ? { finish: ended.finish } : {}) }
  }
  const played = applyMove(state.fen, move)
  if (!played) return refuse(state, 'That move cannot be played in this position.')

  const clock = moveMade(state.clock, mover, now)
  const seconds = clockSecondsFor(clock, mover, now)
  const entry: GameMove = {
    san: played.san,
    uci: played.uci,
    fen: played.after,
    ...(seconds === null ? {} : { clock: seconds })
  }
  let next: ArenaState = {
    ...state,
    fen: played.after,
    moves: [...state.moves, entry],
    history: [...state.history, played.san],
    clock,
    // A move answers a standing offer: playing on is declining it, which is how it works over a board.
    drawOffer: null,
    thinking: null,
    askedAtPly: null,
    // The hint was about the position before this move and is not about this one.
    hint: null,
    problem: null
  }
  next = naturalEnd(next, now)
  // A move made with the flag already down is settled above; one that brings the clock to zero is caught here.
  if (!next.finish) next = claimFlag(next, now)
  return { ok: true, state: next, move: entry, ...(next.finish ? { finish: next.finish } : {}) }
}

// ---------------------------------------------------------------- the engine's turn

export interface EngineTurnRequest {
  /** What `window.api.chessAnalyse` is given. The id comes back on every update, so an answer can be matched. */
  id: string
  fen: string
  multipv: number
  movetime?: number
  depth?: number
  nodes?: number
}

/**
 * What to ask the engine for its move, or null when it must not be asked.
 *
 * Null for: a finished game, the person's turn, a search already running, and -- the important one -- a position
 * the engine has already been asked about. That last refusal is what stops a screen that redraws twice from
 * getting two answers for one turn.
 */
export function engineTurnRequest(state: ArenaState, requestId: string, now: number): EngineTurnRequest | null {
  if (state.finish || !engineTurn(state)) return null
  if (state.thinking) return null
  if (state.askedAtPly === plyOf(state)) return null
  const limits = thinkFor(state.level, state.clock, state.engine, now)
  return {
    id: requestId,
    fen: state.fen,
    multipv: Math.max(1, Math.min(5, state.level.lines)),
    ...limits
  }
}

/** Records that the engine has been asked, so it is not asked again for the same position. */
export function engineAsked(state: ArenaState, request: EngineTurnRequest, now: number): ArenaState {
  return {
    ...state,
    thinking: { requestId: request.id, fen: request.fen, purpose: 'move', startedAt: now },
    askedAtPly: plyOf(state),
    problem: null
  }
}

export interface EngineAnswer {
  /** The request this answers. Anything else is not this search's answer. */
  requestId: string
  /** The position it was about. Anything else is an answer to a different question. */
  fen: string
  /** The engine's first choice, already checked for legality by the engine service. Checked again here. */
  bestmove: string | null
  /** The engine's own lines, best first, so a gentler level has real alternatives to choose between. */
  lines?: readonly { uci: string }[]
  /** Said plainly by the engine service when its answer could not be used as given. */
  note?: string | null
}

/**
 * The engine's answer, turned into a move.
 *
 * Refused unless it names the request that was sent and the position it was sent about. An answer that arrives
 * after the board has moved on is not stale information to be shown carefully -- it is a move in the wrong
 * position, and playing it would wreck the game.
 */
export function engineAnswered(state: ArenaState, answer: EngineAnswer, o: { now: number; roll?: number }): ArenaStep {
  if (state.finish) return refuse(state, 'The game is over, so the engine’s move was not played.')
  const waiting = state.thinking
  if (!waiting || waiting.purpose !== 'move') return refuse(state, 'The engine was not asked for a move, so this answer was not used.')
  if (waiting.requestId !== answer.requestId) {
    return refuse(state, 'That answer belongs to a different search, so it was not used.')
  }
  if (answer.fen !== waiting.fen || answer.fen !== state.fen) {
    return refuse(state, 'That answer was about a different position, so it was not used.')
  }
  const candidates: EngineCandidate[] = []
  for (const line of answer.lines ?? []) if (line && typeof line.uci === 'string') candidates.push({ uci: line.uci })
  if (!candidates.length && answer.bestmove) candidates.push({ uci: answer.bestmove })
  if (!candidates.length) {
    return refuse({ ...state, thinking: null }, answer.note ?? 'The engine offered no move for this position.')
  }
  /*
   * Only the engine's own candidates that are really legal here.
   *
   * The engine service checks its `bestmove`, and this checks every line it offered, because a line's first move
   * travels through the window as text and a move that cannot be played would be appended to the game as if it
   * could.
   */
  const legal = candidates.filter((one) => applyMove(state.fen, one.uci) !== null)
  if (!legal.length) {
    return refuse({ ...state, thinking: null }, 'The engine offered no move that can be played in this position.')
  }
  const choice = chooseEngineMove(legal, state.level, Number.isFinite(o.roll) ? (o.roll as number) : 0)
  if (!choice) return refuse({ ...state, thinking: null }, 'The engine offered no move that can be played in this position.')
  return playMove({ ...state, thinking: null }, choice.uci, 'engine', o.now)
}

/**
 * The search failed, or was stopped.
 *
 * The engine is let go of and the turn is opened again, so the screen can ask once more. The reason is kept for
 * the screen to show: a turn that silently never happens looks exactly like a frozen program.
 */
export function engineFailed(state: ArenaState, why: string): ArenaState {
  return { ...state, thinking: null, askedAtPly: null, problem: why }
}

// ---------------------------------------------------------------- hints

/** What to ask the engine for a hint, or null when a hint is not available. */
export function hintRequest(state: ArenaState, requestId: string): EngineTurnRequest | null {
  if (state.finish || state.setup.assistance === 'none') return null
  if (!yourTurn(state)) return null
  if (state.thinking) return null
  return { id: requestId, fen: state.fen, multipv: 1, movetime: HINT_MOVETIME }
}

export function hintAsked(state: ArenaState, request: EngineTurnRequest, now: number): ArenaState {
  return {
    ...state,
    thinking: { requestId: request.id, fen: request.fen, purpose: 'hint', startedAt: now },
    problem: null
  }
}

/** What a move does, in words with no squares in them. Used by the middle rung of the ladder. */
function whatItDoes(fen: string, uci: string): string {
  const played = applyMove(fen, uci)
  if (!played) return 'nothing that can be described'
  if (played.checkmate) return 'it is checkmate'
  if (played.promotion) return `the pawn becomes a ${PIECE_NAME[played.promotion]}`
  if (played.special === 'k') return 'it castles short'
  if (played.special === 'q') return 'it castles long'
  if (played.special === 'e') return 'it takes a pawn en passant'
  if (played.captured && played.check) return `it takes a ${PIECE_NAME[played.captured]} and gives check`
  if (played.captured) return `it takes a ${PIECE_NAME[played.captured]}`
  if (played.check) return 'it gives check'
  return 'nothing is taken'
}

export type HintOutcome = { ok: true; state: ArenaState; hint: Hint } | { ok: false; state: ArenaState; problem: string }

/**
 * The engine's answer, turned into as much of a hint as the level allows.
 *
 * The bound is enforced here rather than by whatever shows the hint, so there is one place to check it. A nudge
 * carries no square and no notation -- not in its text and not in a field beside it -- because a hint that leaks
 * the move in a property is the same hint however it is drawn.
 */
export function revealHint(state: ArenaState, answer: { requestId: string; fen: string; bestmove: string | null }, now: number): HintOutcome {
  const level = state.setup.assistance
  if (level === 'none') return { ok: false, state, problem: 'Hints are turned off for this game.' }
  const waiting = state.thinking
  if (!waiting || waiting.purpose !== 'hint') return { ok: false, state, problem: 'No hint was asked for.' }
  if (waiting.requestId !== answer.requestId) {
    return { ok: false, state: { ...state, thinking: null }, problem: 'That answer belongs to a different search, so it was not used.' }
  }
  if (answer.fen !== state.fen) {
    return { ok: false, state: { ...state, thinking: null }, problem: 'The engine’s answer was about a different position, so it cannot be shown as a hint here.' }
  }
  const best = answer.bestmove
  const played = best ? applyMove(state.fen, best) : null
  if (!played) {
    return { ok: false, state: { ...state, thinking: null }, problem: 'The engine offered no move here that can be played, so there is no hint to give.' }
  }
  const piece = PIECE_NAME[played.piece]
  const hint: Hint =
    level === 'nudge'
      ? { level, text: `The engine would move a ${piece}.`, fen: state.fen, at: now }
      : level === 'idea'
        ? { level, text: `The engine would move a ${piece}, and ${whatItDoes(state.fen, played.uci)}.`, fen: state.fen, at: now }
        : { level, text: `The engine’s move here is ${played.san}.`, uci: played.uci, san: played.san, fen: state.fen, at: now }
  return {
    ok: true,
    state: { ...state, thinking: null, hint, hintsTaken: state.hintsTaken + 1, problem: null },
    hint
  }
}

export function clearHint(state: ArenaState): ArenaState {
  return state.hint === null ? state : { ...state, hint: null }
}

// ---------------------------------------------------------------- resigning, offering, agreeing

export function resign(state: ArenaState, by: 'you' | 'engine', now: number): ArenaStep {
  if (state.finish) return refuse(state, 'The game is already over.')
  const loser: Side = by === 'you' ? state.human : state.engine
  const winner = otherSide(loser)
  const next = finishWith(
    state,
    {
      result: winner === 'w' ? '1-0' : '0-1',
      reason: 'resignation',
      termination: `${loser === 'w' ? 'White' : 'Black'} resigned`,
      at: now
    },
    now
  )
  return { ok: true, state: next, ...(next.finish ? { finish: next.finish } : {}) }
}

/**
 * A draw offer.
 *
 * Recorded and nothing else. It is not a draw, it does not end the game, and it does not stop the clock -- it
 * waits to be answered, and a move answers it by declining it.
 */
export function offerDraw(state: ArenaState, by: 'you' | 'engine', now: number): ArenaStep {
  if (state.finish) return refuse(state, 'The game is already over.')
  if (state.drawOffer) {
    return refuse(state, state.drawOffer.by === by ? 'You have already offered a draw; it has not been answered yet.' : 'There is already a draw offer waiting for an answer.')
  }
  return { ok: true, state: { ...state, drawOffer: { by, ply: plyOf(state), at: now }, problem: null } }
}

/** Accepting the offer that is on the table. Only the side that did not make it may accept it. */
export function acceptDraw(state: ArenaState, by: 'you' | 'engine', now: number): ArenaStep {
  if (state.finish) return refuse(state, 'The game is already over.')
  const offer = state.drawOffer
  if (!offer) return refuse(state, 'There is no draw offer to accept.')
  if (offer.by === by) return refuse(state, 'You cannot accept your own offer.')
  const next = finishWith(state, { result: '1/2-1/2', reason: 'agreed-draw', termination: 'Draw agreed', at: now }, now)
  return { ok: true, state: next, ...(next.finish ? { finish: next.finish } : {}) }
}

export function declineDraw(state: ArenaState, by: 'you' | 'engine'): ArenaStep {
  if (state.finish) return refuse(state, 'The game is already over.')
  const offer = state.drawOffer
  if (!offer) return refuse(state, 'There is no draw offer to decline.')
  if (offer.by === by) return refuse(state, 'You cannot decline your own offer; withdraw it instead.')
  return { ok: true, state: { ...state, drawOffer: null } }
}

export function withdrawDraw(state: ArenaState, by: 'you' | 'engine'): ArenaStep {
  const offer = state.drawOffer
  if (!offer) return refuse(state, 'There is no draw offer to withdraw.')
  if (offer.by !== by) return refuse(state, 'That offer is not yours to withdraw.')
  return { ok: true, state: { ...state, drawOffer: null } }
}

/** How deep an evaluation has to be, and how far behind the engine has to be, before it takes a draw. */
export const MIN_DRAW_DEPTH = 8
export const DRAW_ACCEPT_CP = -150

/**
 * Whether the engine should accept a draw that has been offered to it.
 *
 * It needs a real reason, and the only honest one available without a position evaluation is the rules: a position
 * the rules already call drawn. Anything else -- "the engine thinks it is equal" -- needs an evaluation that this
 * module does not have, so with no evaluation the answer is no, and the screen says the offer was declined rather
 * than inventing a reason.
 */
export function engineShouldAcceptDraw(state: ArenaState, judgement?: { score: Score; depth?: number }): { accept: boolean; because: string } {
  const drawn = outcome(state.fen, state.history)
  if (drawn.over && drawn.result === '1/2-1/2') return { accept: true, because: 'the position is already a draw by the rules' }
  if (judgement && judgement.score.kind === 'cp' && (judgement.depth ?? 0) >= MIN_DRAW_DEPTH) {
    const fromEngineSide = state.engine === 'w' ? judgement.score.cp : -judgement.score.cp
    // Only when the engine's own search says it is not better. A draw offer accepted from a winning position
    // would be a kindness nobody asked for and would not be the engine playing.
    if (fromEngineSide <= DRAW_ACCEPT_CP) return { accept: true, because: 'its own search has it worse by more than a pawn and a half' }
  }
  return { accept: false, because: 'nothing it can check says a draw is the right result' }
}

// ---------------------------------------------------------------- pausing

export function pause(state: ArenaState, now: number): ArenaState {
  if (state.finish || state.clock.paused) return state
  return { ...state, clock: pauseClock(state.clock, now) }
}

export function resume(state: ArenaState, now: number): ArenaState {
  if (state.finish || !state.clock.paused) return state
  return { ...state, clock: resumeClock(state.clock, now) }
}

// ---------------------------------------------------------------- remarks

/** Adds a remark to the running list. Kept short: a conversation, not a transcript. */
export const REMARKS_KEPT = 40

export function addRemark(state: ArenaState, remark: Remark): ArenaState {
  const remarks = [...state.remarks, remark]
  return { ...state, remarks: remarks.length > REMARKS_KEPT ? remarks.slice(remarks.length - REMARKS_KEPT) : remarks }
}

// ---------------------------------------------------------------- the end of the game

export interface ArenaSummary {
  result: GameResult
  reason: FinishReason
  forYou: 'win' | 'loss' | 'draw'
  /** The first line of the summary: short, and true. */
  headline: string
  /** The sentence under it: how it ended, in words. */
  detail: string
  /** Full moves played. */
  moves: number
  plies: number
  /** How long each side spent thinking, in milliseconds. Measured, not estimated. */
  spent: { w: number; b: number }
  hintsTaken: number
  /** True when any hint was taken, which is said plainly rather than hidden. */
  assisted: boolean
  level: DifficultyLevel
  timeControl: string
  /** What the engine called itself, when the screen knew. Absent rather than guessed. */
  engineName?: string
}

const SIDE_NAME: Readonly<Record<Side, string>> = Object.freeze({ w: 'White', b: 'Black' })

export function summaryOf(state: ArenaState, o: { now: number; engineName?: string } = { now: 0 }): ArenaSummary | null {
  const finish = state.finish
  if (!finish) return null
  const headline =
    finish.forYou === 'win' ? 'You won.' : finish.forYou === 'loss' ? 'You lost.' : 'Drawn.'
  const detail =
    finish.reason === 'checkmate'
      ? `Checkmate. ${SIDE_NAME[finish.result === '1-0' ? 'w' : 'b']} mated after ${Math.ceil(state.moves.length / 2)} moves.`
      : finish.reason === 'resignation'
        ? `${finish.termination ?? 'A player resigned'}.`
        : finish.reason === 'flag'
          ? `${finish.termination ?? 'A clock ran out'}.`
          : finish.reason === 'agreed-draw'
            ? 'A draw was offered and accepted.'
            : `${finish.termination ?? 'The game was drawn'}.`
  return {
    result: finish.result,
    reason: finish.reason,
    forYou: finish.forYou,
    headline,
    detail,
    moves: Math.ceil(state.moves.length / 2),
    plies: state.moves.length,
    spent: spentAt(state.clock, o.now > 0 ? o.now : state.clock.since),
    hintsTaken: state.hintsTaken,
    assisted: state.hintsTaken > 0,
    level: state.level,
    timeControl: state.setup.control.label,
    ...(o.engineName ? { engineName: o.engineName } : {})
  }
}

// ---------------------------------------------------------------- saving it

/**
 * Where the game came from, for the record.
 *
 * The engine's own name when the screen knows it, which it does only after a real handshake. "Stockfish" is not
 * written in by hand: a game played against an engine that called itself something else would then be filed under
 * a name that was never there.
 */
export function sourceFor(state: ArenaState, engineName?: string): GameSource {
  return {
    kind: 'local-engine',
    engine: engineName && engineName.trim() ? engineName.trim().slice(0, 120) : 'a local engine',
    level: `${state.level.name} — ${describeDifficulty(state.level)}`
  }
}

/**
 * The game's metadata.
 *
 * What is not known is left out. A person who did not give a name has no name here, and the engine's side carries
 * the engine's own name only when the handshake supplied one. No ratings: neither player has one that Orbis knows.
 */
export function metaFor(state: ArenaState, o: { engineName?: string } = {}): GameMeta {
  const you = state.setup.yourName?.trim()
  const engineLabel = o.engineName && o.engineName.trim() ? o.engineName.trim().slice(0, 120) : undefined
  const human = you ? { name: you } : {}
  const machine = engineLabel ? { name: engineLabel } : {}
  const result: GameResult = state.finish ? state.finish.result : '*'
  const termination = state.finish?.termination
  const control = pgnTimeControl(state.setup.control)
  return {
    event: 'Orbis AI Arena',
    white: state.human === 'w' ? human : machine,
    black: state.human === 'w' ? machine : human,
    result,
    ...(termination ? { termination } : {}),
    ...(control === '-' ? {} : { timeControl: control }),
    extra: {
      OrbisLevel: state.level.name,
      OrbisStrength: describeDifficulty(state.level),
      ...(state.hintsTaken > 0 ? { OrbisHints: String(state.hintsTaken) } : {})
    }
  }
}

/** The moves as the store takes them. Already in that shape; this is here so a caller does not reach inside. */
export function movesFor(state: ArenaState): GameMove[] {
  return state.moves.map((one) => ({ ...one }))
}

/** What to show while the engine is thinking, in words rather than a spinner alone. */
export function thinkingLine(state: ArenaState, now: number): string | null {
  const thinking = state.thinking
  if (!thinking) return null
  const seconds = Math.max(0, Math.round((now - thinking.startedAt) / 100) / 10)
  if (thinking.purpose === 'hint') return `Asking the engine about this position… ${seconds.toFixed(1)}s`
  return `${state.level.name}: thinking… ${seconds.toFixed(1)}s`
}
