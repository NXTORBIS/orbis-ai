import { applyMove, legalMoves, outcome, type ChessMove } from './rules.ts'
import {
  HINT_WORTH, follow, forcedMateTree, materialSwing, playablePosition,
  type Exercise, type ExerciseHint, type MoveNode
} from './exercise.ts'

/**
 * One go at one exercise: the states it can be in, and what a played move actually proves (Sections 203, 205).
 *
 * ## Legality and correctness are two questions
 *
 * The rule the whole file is built around. "Nf7" that cannot be played is a *notation or rules* problem; "Nf7" that
 * can be played but is not the answer is a *chess* problem. Telling a solver their move was illegal when it was
 * merely wrong teaches them something false about the rules, and telling them it was wrong when it was unplayable
 * leaves them hunting for an idea that does not exist. So `judge` answers the first question first, and never
 * answers the second one using the first one's vocabulary: a legal move that misses the point comes back as
 * **not the idea**.
 *
 * And it goes the other way too. A solver who finds a mate the author never wrote down has solved the exercise, and
 * is told so: where the rules can prove the objective was met, the recorded lines do not get the last word.
 *
 * ## What a wrong move is not told
 *
 * Nothing here says a move "loses" or is "a mistake" unless the rules can show it. For a mate exercise that is
 * provable with a small search, and when it is proved the verdict says so. When it is not, the verdict says the move
 * is not one of the recorded answers and stops there -- which is the whole truth available without an engine.
 *
 * ## Hints are recorded separately from correctness
 *
 * A solve is a solve and a hint is a hint; they are never mixed into one number. The attempt records which rungs
 * were taken, and `worthOf` says what the attempt proves afterwards -- the same ladder the Student uses, so an
 * answer reached with the move on screen is never filed as recall.
 *
 * Pure: every time comes in as an argument, nothing is stored, nothing is drawn.
 */

// ---------------------------------------------------------------- the states

export type AttemptState =
  /** Chosen, nothing loaded. */
  | 'ready'
  /** The position is being set up. */
  | 'loading'
  /** The solver's move. The clock runs here and nowhere else. */
  | 'active'
  /** Stopped by the solver. The clock does not run. */
  | 'paused'
  /** A move has been submitted and is being judged. */
  | 'validating'
  /** The opponent's reply is being played. */
  | 'awaiting-opponent'
  /** Something is being explained before play continues. */
  | 'awaiting-feedback'
  | 'completed'
  | 'failed'
  /** Left deliberately. */
  | 'abandoned'
  /** Taken away -- the window closed, the app quit. Can be picked up again. */
  | 'interrupted'

export const ATTEMPT_STATES: readonly AttemptState[] = Object.freeze([
  'ready', 'loading', 'active', 'paused', 'validating', 'awaiting-opponent', 'awaiting-feedback',
  'completed', 'failed', 'abandoned', 'interrupted'
])

/** The states nothing follows. A second go is a second attempt, not a restart of this one. */
export const FINAL_STATES: readonly AttemptState[] = Object.freeze(['completed', 'failed', 'abandoned'])

/**
 * Every move the machine allows, and nothing else.
 *
 * Written out rather than worked out, so a state that should not follow another cannot arrive through a clever path.
 * `interrupted` leads back to `loading` and not to `active`: a session picked up tomorrow has to put the position
 * back on the board before it can accept a move.
 */
export const TRANSITIONS: Readonly<Record<AttemptState, readonly AttemptState[]>> = Object.freeze({
  ready: Object.freeze(['loading', 'abandoned', 'interrupted'] as const),
  loading: Object.freeze(['active', 'failed', 'abandoned', 'interrupted'] as const),
  active: Object.freeze(['validating', 'paused', 'awaiting-feedback', 'failed', 'abandoned', 'interrupted'] as const),
  paused: Object.freeze(['active', 'failed', 'abandoned', 'interrupted'] as const),
  validating: Object.freeze(['active', 'awaiting-opponent', 'awaiting-feedback', 'completed', 'failed', 'interrupted'] as const),
  'awaiting-opponent': Object.freeze(['active', 'awaiting-feedback', 'completed', 'failed', 'interrupted', 'abandoned'] as const),
  'awaiting-feedback': Object.freeze(['active', 'completed', 'failed', 'abandoned', 'interrupted'] as const),
  completed: Object.freeze([] as const),
  failed: Object.freeze([] as const),
  abandoned: Object.freeze([] as const),
  interrupted: Object.freeze(['loading', 'abandoned'] as const)
})

export function isFinal(state: AttemptState): boolean {
  return FINAL_STATES.includes(state)
}

/** Whether the machine allows this step. The only authority on that. */
export function canGo(from: AttemptState, to: AttemptState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

// ---------------------------------------------------------------- the session

export interface PlayedMove {
  san: string
  uci: string
  /** The position the move was played in, and the one it produced. */
  before: string
  after: string
  by: 'solver' | 'opponent'
  at: number
  /** Milliseconds of thinking before it, from the time the solver was last on the clock. */
  tookMs: number
}

export interface AttemptSession {
  id: string
  exerciseId: string
  state: AttemptState
  startFen: string
  /** The position now. */
  fen: string
  played: readonly PlayedMove[]
  /** Which hints were taken, in order. Kept apart from whether the answer was right. */
  hintsTaken: readonly number[]
  /** Legal moves that were not the answer. */
  wrongMoves: number
  /** Moves that could not be played at all. Never counted as wrong answers. */
  illegalTries: number
  startedAt: number | null
  endedAt: number | null
  /** Milliseconds on the clock. Pauses, loading and waiting for the opponent do not count. */
  activeMs: number
  /** When the clock last started running, or null when it is not running. */
  runningSince: number | null
  outcome: 'solved' | 'failed' | 'given-up' | null
  /** Why it failed, when it did, in a person's words. */
  why: string | null
  /** Where `awaiting-feedback` goes next. */
  pending: 'continue' | 'solved' | null
  history: readonly { state: AttemptState; at: number; why?: string }[]
}

export function newAttempt(o: { id: string; exercise: Exercise; now: number }): AttemptSession {
  return {
    id: o.id,
    exerciseId: o.exercise.id,
    state: 'ready',
    startFen: o.exercise.startFen,
    fen: o.exercise.startFen,
    played: [],
    hintsTaken: [],
    wrongMoves: 0,
    illegalTries: 0,
    startedAt: null,
    endedAt: null,
    activeMs: 0,
    runningSince: null,
    outcome: null,
    why: null,
    pending: null,
    history: [{ state: 'ready', at: o.now }]
  }
}

export type AttemptEvent =
  | { kind: 'load' }
  | { kind: 'loaded' }
  | { kind: 'load-failed'; why: string }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'submit' }
  | { kind: 'verdict'; verdict: Verdict }
  | { kind: 'opponent-moved'; move: ChessMove }
  | { kind: 'feedback-done' }
  | { kind: 'give-up' }
  | { kind: 'abandon' }
  | { kind: 'interrupt' }
  | { kind: 'restore' }

export interface Advance {
  session: AttemptSession
  /** False when the machine refused the step, in which case the session is unchanged. */
  ok: boolean
  /** Why it was refused. */
  says?: string
}

/** The clock, in milliseconds, with the part that is running now included. */
export function elapsedMs(session: AttemptSession, now: number): number {
  return session.activeMs + (session.runningSince === null ? 0 : Math.max(0, now - session.runningSince))
}

function go(session: AttemptSession, to: AttemptState, now: number, why?: string): Advance {
  if (!canGo(session.state, to)) {
    return { session, ok: false, says: `An attempt cannot go from ${session.state} to ${to}.` }
  }
  // The clock runs in `active` and in `validating` (the solver is still committed to the move), nowhere else.
  const runs = to === 'active' || to === 'validating'
  const wasRunning = session.runningSince !== null
  const activeMs = wasRunning && !runs ? elapsedMs(session, now) : session.activeMs
  return {
    session: {
      ...session,
      state: to,
      activeMs,
      runningSince: runs ? (wasRunning ? session.runningSince : now) : null,
      ...(session.startedAt === null && to === 'active' ? { startedAt: now } : {}),
      ...(isFinal(to) ? { endedAt: now } : {}),
      ...(why !== undefined ? { why } : {}),
      history: [...session.history, { state: to, at: now, ...(why ? { why } : {}) }]
    },
    ok: true
  }
}

/**
 * One step of the machine.
 *
 * Judging is not done here: a verdict comes in as an event. That keeps the machine something that can be tested on
 * its own, and keeps the judge something that can be used without a session -- the Calculation Gym needs the second
 * without the first.
 */
export function advance(session: AttemptSession, event: AttemptEvent, now: number): Advance {
  switch (event.kind) {
    case 'load':
      return go(session, 'loading', now)
    case 'loaded':
      return go(session, 'active', now)
    case 'load-failed': {
      const stepped = go(session, 'failed', now, event.why)
      return stepped.ok ? { ...stepped, session: { ...stepped.session, outcome: 'failed' } } : stepped
    }
    case 'pause':
      return go(session, 'paused', now)
    case 'resume':
      return go(session, 'active', now)
    case 'submit':
      return go(session, 'validating', now)
    case 'verdict':
      return applyVerdict(session, event.verdict, now)
    case 'opponent-moved': {
      if (session.state !== 'awaiting-opponent') {
        return { session, ok: false, says: `The opponent only moves from awaiting-opponent, and this attempt is ${session.state}.` }
      }
      const move = event.move
      if (move.before !== session.fen) {
        return { session, ok: false, says: 'That reply was not played in the position the attempt is in.' }
      }
      const withMove: AttemptSession = {
        ...session,
        fen: move.after,
        played: [...session.played, { san: move.san, uci: move.uci, before: move.before, after: move.after, by: 'opponent', at: now, tookMs: 0 }]
      }
      return go(withMove, 'active', now)
    }
    case 'feedback-done': {
      if (session.state !== 'awaiting-feedback') {
        return { session, ok: false, says: `There is nothing being explained: the attempt is ${session.state}.` }
      }
      if (session.pending === 'solved') {
        const stepped = go({ ...session, pending: null }, 'completed', now)
        return stepped.ok ? { ...stepped, session: { ...stepped.session, outcome: 'solved' } } : stepped
      }
      return go({ ...session, pending: null }, 'active', now)
    }
    case 'give-up': {
      const stepped = go(session, 'failed', now, 'Asked to see the answer.')
      return stepped.ok ? { ...stepped, session: { ...stepped.session, outcome: 'given-up' } } : stepped
    }
    case 'abandon':
      return go(session, 'abandoned', now, 'Left.')
    case 'interrupt':
      return go(session, 'interrupted', now, 'Stopped before it was finished.')
    case 'restore':
      return go(session, 'loading', now)
  }
}

/** What the failure conditions say about the attempt as it stands. Null when nothing has gone over a limit. */
export function failureNow(session: AttemptSession, exercise: Exercise, now: number): string | null {
  const solverMoves = session.played.filter((m) => m.by === 'solver').length
  for (const condition of exercise.failure) {
    if (condition.kind === 'wrong-moves' && session.wrongMoves > condition.allowed) {
      return condition.allowed === 0
        ? 'That was not the idea, and this exercise asks for it first time.'
        : `That is ${session.wrongMoves} wrong moves, and this exercise allows ${condition.allowed}.`
    }
    if (condition.kind === 'move-limit' && solverMoves >= condition.moves) {
      return `The exercise allows ${condition.moves} ${condition.moves === 1 ? 'move' : 'moves'}.`
    }
    if (condition.kind === 'time-limit' && elapsedMs(session, now) > condition.seconds * 1000) {
      return `Time is up: ${condition.seconds} seconds.`
    }
  }
  return null
}

function applyVerdict(session: AttemptSession, verdict: Verdict, now: number): Advance {
  if (session.state !== 'validating') {
    return { session, ok: false, says: `A verdict only arrives from validating, and this attempt is ${session.state}.` }
  }
  if (verdict.kind === 'illegal') {
    // Nothing was played, so nothing moves on. The try is recorded, apart from the wrong answers.
    return go({ ...session, illegalTries: session.illegalTries + 1 }, 'active', now)
  }
  if (verdict.kind === 'not-the-idea') {
    const marked: AttemptSession = { ...session, wrongMoves: session.wrongMoves + 1, pending: 'continue' }
    return go(marked, 'awaiting-feedback', now, verdict.says)
  }
  if (verdict.kind === 'opponent-off-book') {
    return go({ ...session, pending: 'continue' }, 'awaiting-feedback', now, verdict.says)
  }
  if (verdict.kind === 'not-a-move-exercise' || verdict.kind === 'not-now') {
    return { session, ok: false, says: verdict.says }
  }
  const played = verdict.move
  const withMove: AttemptSession = {
    ...session,
    fen: played.after,
    played: [...session.played, {
      san: played.san, uci: played.uci, before: played.before, after: played.after, by: 'solver', at: now,
      tookMs: Math.max(0, elapsedMs(session, now) - session.played.reduce((sum, m) => sum + m.tookMs, 0))
    }]
  }
  if (verdict.kind === 'solved') {
    return go({ ...withMove, pending: 'solved' }, 'awaiting-feedback', now, verdict.says)
  }
  // On track, and somebody has to answer.
  return go(withMove, verdict.toMove === 'opponent' ? 'awaiting-opponent' : 'active', now, verdict.says)
}

// ---------------------------------------------------------------- judging

export type Verdict =
  /** The move cannot be played in this position. Not a chess mistake, and never reported as one. */
  | { kind: 'illegal'; at: number; text: string; says: string }
  /** Legal, and not one of the answers. */
  | {
      kind: 'not-the-idea'
      at: number
      san: string
      says: string
      /** False only when the rules can show the objective cannot be reached after this move. */
      couldStillBeGood: boolean
      /** What the recorded lines accept here, for the explanation afterwards. */
      accepted: readonly string[]
    }
  /** Right so far, and the exercise is not finished. */
  | { kind: 'on-track'; move: ChessMove; says: string; toMove: 'solver' | 'opponent'; accepted: readonly string[]; why?: string }
  /** Done. `viaRecordedLine` is false when the solver found something the author had not written down. */
  | { kind: 'solved'; move: ChessMove; says: string; viaRecordedLine: boolean; why?: string }
  /** The opponent played something the exercise has no answer for. The solver's problem to look at, not their fault. */
  | { kind: 'opponent-off-book'; at: number; san: string; says: string }
  /** This exercise is not answered with moves. */
  | { kind: 'not-a-move-exercise'; says: string }
  /** The attempt was not in a state to take a move. Says nothing about the move. */
  | { kind: 'not-now'; says: string }

/** Whether the material claim still holds after a capture and the recapture that may answer it. */
function materialHolds(startFen: string, fenAfter: string, exercise: Exercise): boolean {
  const target = exercise.materialAtLeast ?? 0
  if (materialSwing(startFen, fenAfter, exercise.sideToMove) < target) return false
  if (!playablePosition(fenAfter).ok) return false
  for (const reply of legalMoves(fenAfter)) {
    if (!reply.captured) continue
    if (materialSwing(startFen, reply.after, exercise.sideToMove) >= target) continue
    const saved = legalMoves(reply.after).some((again) => materialSwing(startFen, again.after, exercise.sideToMove) >= target)
    if (!saved) return false
  }
  return true
}

/**
 * Whether the rules can show that a move meets the objective, with no engine and no opinion.
 *
 * Only two objectives can be settled this way, and both are settled honestly: a mate that is on the board, and a
 * material gain that survives the recapture. Everything else comes back false, which means "this is not one of the
 * recorded answers" and not "this is wrong".
 */
function provenGood(exercise: Exercise, made: ChessMove, solverMovesBefore: number): boolean {
  if (exercise.objective === 'mate-in-n') {
    if (made.checkmate) return solverMovesBefore + 1 <= (exercise.movesToMate ?? 1)
    return false
  }
  if (exercise.objective === 'win-material') return materialHolds(exercise.startFen, made.after, exercise)
  if (exercise.objective === 'hold-draw') {
    const end = outcome(made.after)
    return end.over && end.result === '1/2-1/2'
  }
  return false
}

/**
 * Whether the rules can show the objective is now out of reach.
 *
 * Used for mate exercises only, and only to the depth a small exhaustive search can actually settle. When the search
 * runs out of budget the answer is "we do not know", which comes back as `couldStillBeGood: true` -- an honest
 * silence rather than a guess dressed as a finding.
 */
function provenHopeless(exercise: Exercise, made: ChessMove, solverMovesBefore: number, budget: number): boolean {
  if (exercise.objective !== 'mate-in-n') return false
  const left = (exercise.movesToMate ?? 1) - solverMovesBefore
  if (left < 1) return true
  if (made.checkmate) return false
  if (left === 1) return true
  // Was this move part of a forced mate in `left` at all?
  const search = forcedMateTree(made.before, left, budget)
  if (search.exceeded || search.solution === null) return false
  return !search.solution.lines.some((line) => applyMove(made.before, line.move)?.uci === made.uci)
}

export interface JudgeOptions {
  /** How many positions the mate check may look at before giving up and saying nothing. */
  budget?: number
}

/**
 * What a played sequence proves.
 *
 * `played` is every move so far, the opponent's included, in order. The two questions are answered in order and
 * never mixed: can this be played, and is it the idea.
 */
export function judge(exercise: Exercise, played: readonly string[], options: JudgeOptions = {}): Verdict {
  if (exercise.objective === 'answer') {
    return { kind: 'not-a-move-exercise', says: 'This one is not answered by playing a move.' }
  }
  if (played.length === 0) {
    return { kind: 'not-the-idea', at: 0, san: '', says: 'Nothing has been played yet.', couldStillBeGood: true, accepted: [] }
  }

  const walk = follow(exercise, played)

  // 1. Can it be played at all? This is a rules answer, and it comes first.
  if (walk.illegalAt !== null) {
    const text = played[walk.illegalAt]
    return {
      kind: 'illegal',
      at: walk.illegalAt,
      text,
      says: `"${text}" cannot be played in this position. Nothing has moved.`
    }
  }

  const last = walk.moves[walk.moves.length - 1]
  const lastIndex = walk.moves.length - 1

  // 2. Is it one of the answers? This is a chess answer, and it is a different answer.
  if (walk.divergedAt !== null) {
    if (walk.divergedAt % 2 === 1) {
      return {
        kind: 'opponent-off-book',
        at: walk.divergedAt,
        san: walk.moves[walk.divergedAt].san,
        says: `The exercise has no answer recorded for ${walk.moves[walk.divergedAt].san}. That is a gap in the exercise, not a mistake by you.`
      }
    }
    const solverMovesBefore = Math.floor(walk.divergedAt / 2)
    const diverging = walk.moves[walk.divergedAt]
    if (walk.divergedAt === lastIndex && provenGood(exercise, diverging, solverMovesBefore)) {
      return {
        kind: 'solved',
        move: diverging,
        viaRecordedLine: false,
        says: exercise.objective === 'mate-in-n'
          ? `${diverging.san} is mate. It is not the line that was written down, and it does not need to be.`
          : `${diverging.san} does it. It is not the line that was written down, and it does not need to be.`
      }
    }
    const hopeless = provenHopeless(exercise, diverging, solverMovesBefore, options.budget ?? 60_000)
    const accepted = acceptedAt(exercise, played.slice(0, walk.divergedAt))
    return {
      kind: 'not-the-idea',
      at: walk.divergedAt,
      san: diverging.san,
      couldStillBeGood: !hopeless,
      accepted: accepted.map((m) => m.san),
      says: hopeless
        ? `${diverging.san} is a legal move, and it is not the idea: after it there is no ${exercise.objective === 'mate-in-n' ? `mate in ${(exercise.movesToMate ?? 1) - solverMovesBefore}` : 'way through'}.`
        : `${diverging.san} is a legal move, and it is not the idea here. Whether it is any good is another question, and this exercise does not answer it.`
    }
  }

  // 3. On a recorded line.
  const solverMovesSoFar = Math.ceil(walk.moves.length / 2)
  if (walk.lineComplete) {
    return {
      kind: 'solved',
      move: last,
      viaRecordedLine: true,
      says: exercise.objective === 'mate-in-n' ? `${last.san} -- mate in ${solverMovesSoFar}.` : `${last.san} -- that is it.`,
      ...(walk.node?.why ? { why: walk.node.why } : {})
    }
  }
  const toMove: 'solver' | 'opponent' = walk.turn === 'solver' ? 'solver' : 'opponent'
  return {
    kind: 'on-track',
    move: last,
    toMove,
    accepted: walk.accepted.map((node) => applyMove(walk.fen, node.move)?.san ?? node.move),
    says: toMove === 'opponent' ? `${last.san}. Now ${exercise.sideToMove === 'w' ? 'Black' : 'White'} replies.` : `${last.san}. Keep going.`,
    ...(walk.node?.why ? { why: walk.node.why } : {})
  }
}

/** The moves the recorded lines accept after a given sequence, written out for the position they are played in. */
export function acceptedAt(exercise: Exercise, played: readonly string[]): ChessMove[] {
  const walk = follow(exercise, played)
  if (walk.illegalAt !== null || walk.divergedAt !== null) return []
  const out: ChessMove[] = []
  for (const node of walk.accepted) {
    const made = applyMove(walk.fen, node.move)
    if (made) out.push(made)
  }
  return out
}

/**
 * The opponent's reply, from the exercise's own lines.
 *
 * Deterministic: the same sequence and the same `pick` always give the same defence, so a solver who repeats an
 * exercise gets the same exercise. `pick` is a number the caller supplies -- an attempt counter, say -- and not a
 * random source, because this file has none.
 */
export function opponentReply(exercise: Exercise, played: readonly string[], pick = 0): ChessMove | null {
  const walk = follow(exercise, played)
  if (walk.illegalAt !== null || walk.divergedAt !== null || walk.turn !== 'opponent') return null
  const choices: MoveNode[] = [...walk.accepted]
  if (choices.length === 0) return null
  const index = ((Math.trunc(pick) % choices.length) + choices.length) % choices.length
  return applyMove(walk.fen, choices[index].move)
}

// ---------------------------------------------------------------- hints

export interface HintTaken {
  session: AttemptSession
  hint: ExerciseHint | null
  /** What the attempt is worth from here on, 0..1. */
  worth: number
  says: string
}

/** The next hint, and the attempt with it recorded. A hint changes what the attempt proves, not whether it is right. */
export function takeHint(session: AttemptSession, exercise: Exercise): HintTaken {
  const next = exercise.hints.find((h) => !session.hintsTaken.includes(h.level))
  if (!next) {
    return { session, hint: null, worth: worthOf(session, exercise).worth, says: 'There are no more hints for this one.' }
  }
  const updated: AttemptSession = { ...session, hintsTaken: [...session.hintsTaken, next.level] }
  const after = worthOf(updated, exercise)
  return { session: updated, hint: next, worth: after.worth, says: after.says }
}

export interface Worth {
  /** 0..1. What a solve from here proves about solving it unaided. */
  worth: number
  /** False when the move was shown, in which case the attempt is practice and not a solve. */
  counts: boolean
  says: string
}

/** What the attempt is worth, given the hints taken. Nothing to do with whether it was solved. */
export function worthOf(session: AttemptSession, exercise: Exercise): Worth {
  let worth = 1
  for (const level of session.hintsTaken) {
    const hint = exercise.hints.find((h) => h.level === level)
    if (hint) worth = Math.min(worth, HINT_WORTH[hint.shows])
  }
  return {
    worth,
    counts: worth > 0,
    says: worth === 1
      ? 'Solved with no help.'
      : worth === 0
        ? 'The move was shown, so this counts as practice rather than a solve.'
        : `Solved with help, which counts for less: ${Math.round(worth * 100)} per cent of a clean solve.`
  }
}

// ---------------------------------------------------------------- what the attempt leaves behind

export interface Performance {
  exerciseId: string
  solved: boolean
  /** The attempt ran out of moves, time or patience. */
  gaveUp: boolean
  hintsUsed: number
  /** What the attempt proves, after the hints: 0..1. */
  worth: number
  wrongMoves: number
  illegalTries: number
  seconds: number
  at: number
}

/**
 * The record an attempt leaves, and the only thing the scheduler is allowed to read.
 *
 * Deliberately small, and deliberately keeps the four things apart: whether it was solved, how much help was taken,
 * how many wrong moves there were, and how long it took. Flattening them into one score is how a training history
 * stops being able to answer any question worth asking.
 */
export function performanceOf(session: AttemptSession, exercise: Exercise, now: number): Performance {
  const worth = worthOf(session, exercise)
  return {
    exerciseId: session.exerciseId,
    solved: session.outcome === 'solved',
    gaveUp: session.outcome === 'given-up',
    hintsUsed: session.hintsTaken.length,
    worth: worth.worth,
    wrongMoves: session.wrongMoves,
    illegalTries: session.illegalTries,
    seconds: Math.round(elapsedMs(session, session.endedAt ?? now) / 1000),
    at: session.endedAt ?? now
  }
}

// ---------------------------------------------------------------- the convenient way round

export interface Played {
  session: AttemptSession
  verdict: Verdict
  /** False when the machine would not take the move: the attempt was not in a state to receive one. */
  ok: boolean
  says?: string
}

/**
 * Submitting a move: the machine step, the judgement, and the machine step back, in the order the machine demands.
 *
 * The long way round is still available (`advance` twice with `judge` in between) and is what the tests use, because
 * a state machine that can only be driven through a convenience wrapper is a state machine nobody can check.
 */
export function playMove(session: AttemptSession, exercise: Exercise, move: string, now: number): Played {
  const submitted = advance(session, { kind: 'submit' }, now)
  if (!submitted.ok) {
    const says = submitted.says ?? `An attempt in ${session.state} does not take moves.`
    return { session, verdict: { kind: 'not-now', says }, ok: false, says }
  }
  const sequence = [...session.played.map((m) => m.uci), move]
  const verdict = judge(exercise, sequence)
  const after = advance(submitted.session, { kind: 'verdict', verdict }, now)
  if (!after.ok) return { session: submitted.session, verdict, ok: false, ...(after.says ? { says: after.says } : {}) }

  // A limit may have been passed by that move. The machine says so rather than the caller having to remember.
  const reason = failureNow(after.session, exercise, now)
  if (reason !== null && after.session.state === 'awaiting-feedback' && after.session.pending === 'continue') {
    const failed = go({ ...after.session, pending: null }, 'failed', now, reason)
    if (failed.ok) return { session: { ...failed.session, outcome: 'failed' }, verdict, ok: true }
  }
  return { session: after.session, verdict, ok: true }
}
