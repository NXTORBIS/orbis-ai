import type { Side } from './evaluation.ts'

/**
 * Chess clocks.
 *
 * Two decisions here, and everything else follows from them.
 *
 * **Time is measured, never counted.** A clock that subtracts a little every time the screen redraws is wrong by
 * however much the redraws were late, and it is wrong in the direction that favours whoever the computer was busy
 * for. So nothing here counts down. The state holds what each side had *as at a stamp*, and the time left now is
 * worked out from the difference between that stamp and now, every time it is asked for. A window that stops
 * redrawing for four seconds -- a save, a garbage collection, a laptop lid -- comes back to a clock that is four
 * seconds further on, because the clock was never the thing doing the counting.
 *
 * **The stamp comes from outside.** Every function takes `now`, from a source the caller owns, and that source is
 * meant to be monotonic (`performance.now()` in the window). The wall clock is not safe for this: it can be set
 * backwards by an hour by a time server or a traveller, and a clock that jumps backwards hands somebody an hour.
 * Nothing in this file reads a clock of its own, which is also what makes it testable -- the tests pass a number
 * they control and move it by hand.
 *
 * An untimed game still has a clock state. It has no time to run out, but the time each side has spent thinking is
 * a real fact and is measured the same way (Sections 053, 055).
 */

export type TimeControlKind = 'untimed' | 'bullet' | 'blitz' | 'rapid' | 'classical'

export interface TimeControl {
  /** Stable, so a chosen control can be remembered and found again. */
  id: string
  kind: TimeControlKind
  /** Seconds each side starts with. 0 when the game is untimed. */
  initialSeconds: number
  /** Seconds added to a side's clock after each of its own moves. */
  incrementSeconds: number
  /** What it is called on screen: "3 + 2", "Untimed". */
  label: string
}

/**
 * How a time control is named.
 *
 * Written down rather than left to each caller, because "is 5+3 blitz or rapid" is a question with an answer and
 * guessing differently in two places is how one screen's "Blitz" is another's "Rapid". A game's length is roughly
 * the starting time plus the increment paid about forty times, which is the convention the online chess world
 * settled on; the bounds below are in seconds of that estimate.
 */
export const ESTIMATED_MOVES = 40
export const KIND_BOUNDS = Object.freeze({ bullet: 180, blitz: 480, rapid: 1500 })

/** Roughly how long a game at this control lasts, in seconds. An estimate, and named as one. */
export function estimatedSeconds(initialSeconds: number, incrementSeconds: number): number {
  const initial = Math.max(0, Math.floor(initialSeconds || 0))
  const increment = Math.max(0, Math.floor(incrementSeconds || 0))
  return initial + increment * ESTIMATED_MOVES
}

export function kindFor(initialSeconds: number, incrementSeconds: number): TimeControlKind {
  const initial = Math.max(0, Math.floor(initialSeconds || 0))
  if (initial <= 0) return 'untimed'
  const estimate = estimatedSeconds(initial, incrementSeconds)
  if (estimate < KIND_BOUNDS.bullet) return 'bullet'
  if (estimate < KIND_BOUNDS.blitz) return 'blitz'
  if (estimate < KIND_BOUNDS.rapid) return 'rapid'
  return 'classical'
}

export const KIND_NAME: Readonly<Record<TimeControlKind, string>> = Object.freeze({
  untimed: 'Untimed',
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical'
})

/** The minutes-and-increment label the chess world writes: "3 + 2", "10 + 0". */
export function controlLabel(initialSeconds: number, incrementSeconds: number): string {
  const initial = Math.max(0, Math.floor(initialSeconds || 0))
  if (initial <= 0) return 'Untimed'
  const increment = Math.max(0, Math.floor(incrementSeconds || 0))
  // Whole minutes where it is whole minutes; the half-minute controls are written as seconds rather than "0.5".
  const minutes = initial / 60
  const left = Number.isInteger(minutes) ? String(minutes) : `${initial}s`
  return `${left} + ${increment}`
}

export const UNTIMED: TimeControl = Object.freeze({
  id: 'untimed',
  kind: 'untimed',
  initialSeconds: 0,
  incrementSeconds: 0,
  label: 'Untimed'
})

/** Builds a control from a starting time and an increment, naming and labelling it by the rule above. */
export function timeControl(initialSeconds: number, incrementSeconds: number, id?: string): TimeControl {
  const initial = Math.max(0, Math.min(86_400, Math.floor(initialSeconds || 0)))
  const increment = Math.max(0, Math.min(3600, Math.floor(incrementSeconds || 0)))
  if (initial <= 0) return UNTIMED
  return Object.freeze({
    id: id ?? `${initial}+${increment}`,
    kind: kindFor(initial, increment),
    initialSeconds: initial,
    incrementSeconds: increment,
    label: controlLabel(initial, increment)
  })
}

/** The ones offered on the setup screen. Ordinary controls people really play, not a sampler. */
export const TIME_CONTROLS: readonly TimeControl[] = Object.freeze([
  UNTIMED,
  timeControl(60, 0),
  timeControl(120, 1),
  timeControl(180, 0),
  timeControl(180, 2),
  timeControl(300, 0),
  timeControl(300, 3),
  timeControl(600, 0),
  timeControl(600, 5),
  timeControl(900, 10),
  timeControl(1800, 0),
  timeControl(1800, 20),
  timeControl(5400, 30)
])

export function timeControlById(id: string): TimeControl | null {
  return TIME_CONTROLS.find((one) => one.id === id) ?? null
}

/** Said in a sentence: "Blitz, 3 + 2 — about 6 minutes a side." */
export function describeTimeControl(control: TimeControl): string {
  if (control.kind === 'untimed') return 'Untimed — no clock runs.'
  const estimate = estimatedSeconds(control.initialSeconds, control.incrementSeconds)
  const minutes = Math.round(estimate / 60)
  const increment = control.incrementSeconds > 0 ? `, ${control.incrementSeconds}s added a move` : ''
  return `${KIND_NAME[control.kind]}, ${control.label} — about ${minutes} minute${minutes === 1 ? '' : 's'} a side${increment}.`
}

/** The PGN `TimeControl` tag: seconds and increment, or "-" when there was no clock. */
export function pgnTimeControl(control: TimeControl): string {
  if (control.kind === 'untimed') return '-'
  return `${control.initialSeconds}+${control.incrementSeconds}`
}

/** Reading that tag back. Null when the text is not a shape this understands, rather than a guess. */
export function readPgnTimeControl(text: string): TimeControl | null {
  const value = (text ?? '').trim()
  if (!value || value === '-' || value === '?') return null
  const both = /^(\d+)\+(\d+)$/.exec(value)
  if (both) return timeControl(Number(both[1]), Number(both[2]))
  const plain = /^(\d+)$/.exec(value)
  if (plain) return timeControl(Number(plain[1]), 0)
  return null
}

// ---------------------------------------------------------------- the state

export interface ClockState {
  control: TimeControl
  /**
   * Milliseconds each side had left as at `since`. Not a countdown: what is left now is worked out from this and
   * the stamp, which is what stops it drifting.
   */
  banked: { w: number; b: number }
  /** Milliseconds each side has spent thinking, as at `since`. A real fact in an untimed game too. */
  spent: { w: number; b: number }
  /** Whose clock is running, or null before the first move, while paused, and once the game is over. */
  ticking: Side | null
  /** The stamp, from the caller's monotonic source, that `banked` and `spent` are true as of. */
  since: number
  /** The side whose time ran out, once that has been settled into the state. */
  flagged: Side | null
  /** True while the clock is deliberately stopped. The paused time is charged to nobody. */
  paused: boolean
  /** Who was running when it was paused, so resuming starts the right clock. */
  pausedFrom: Side | null
  /** Moves made by each side. The increment is paid for a move, so this is what pays it. */
  moves: { w: number; b: number }
}

const other = (side: Side): Side => (side === 'w' ? 'b' : 'w')

/** A clock at the start of a game: full time each, nothing running yet. */
export function newClock(control: TimeControl, now: number): ClockState {
  const start = control.kind === 'untimed' ? 0 : control.initialSeconds * 1000
  return {
    control,
    banked: { w: start, b: start },
    spent: { w: 0, b: 0 },
    ticking: null,
    since: now,
    flagged: null,
    paused: false,
    pausedFrom: null,
    moves: { w: 0, b: 0 }
  }
}

/**
 * How long has passed since the state was last true.
 *
 * Floored at zero. A monotonic source should never go backwards, but if the caller passes a wall clock that has
 * been set back, the worst this can do is charge nothing -- never hand somebody time they did not have.
 */
export function elapsedSince(state: ClockState, now: number): number {
  const gap = now - state.since
  return Number.isFinite(gap) && gap > 0 ? gap : 0
}

export const untimed = (state: ClockState): boolean => state.control.kind === 'untimed'

/** What each side has left, now. Null when there is no clock to have time left on. */
export function remainingAt(state: ClockState, now: number): { w: number; b: number } | null {
  if (untimed(state)) return null
  const running = state.ticking
  if (!running || state.paused) return { ...state.banked }
  const used = elapsedSince(state, now)
  const left = Math.max(0, state.banked[running] - used)
  return running === 'w' ? { w: left, b: state.banked.b } : { w: state.banked.w, b: left }
}

/** How long each side has spent thinking, now. Measured in an untimed game as well. */
export function spentAt(state: ClockState, now: number): { w: number; b: number } {
  const running = state.ticking
  if (!running || state.paused) return { ...state.spent }
  const used = elapsedSince(state, now)
  return running === 'w'
    ? { w: state.spent.w + used, b: state.spent.b }
    : { w: state.spent.w, b: state.spent.b + used }
}

/**
 * Whose time has run out, now.
 *
 * Derived, not waited for. Nothing has to be ticking for this to be true: a window that was asleep for a minute
 * asks this on waking and gets the right answer, because the answer was always in the stamps.
 */
export function flaggedAt(state: ClockState, now: number): Side | null {
  if (untimed(state)) return null
  if (state.flagged) return state.flagged
  const left = remainingAt(state, now)
  if (!left) return null
  if (state.ticking && left[state.ticking] <= 0) return state.ticking
  // A side can be out of time without its clock running: it was settled to zero by a move that overran.
  if (left.w <= 0) return 'w'
  if (left.b <= 0) return 'b'
  return null
}

/** True when a side is under the low-time mark, which is only a cue to show it differently. */
export function lowTimeAt(state: ClockState, side: Side, now: number, underSeconds = 20): boolean {
  const left = remainingAt(state, now)
  if (!left) return false
  return left[side] > 0 && left[side] <= Math.max(0, underSeconds) * 1000
}

/** Rebases the state onto `now`: whatever has been used is banked and spent, and the stamp moves. */
function rebase(state: ClockState, now: number): ClockState {
  const running = state.ticking
  if (!running || state.paused) return { ...state, since: now }
  const used = elapsedSince(state, now)
  const banked = { ...state.banked }
  const spent = { ...state.spent }
  spent[running] += used
  let flagged = state.flagged
  if (!untimed(state)) {
    const left = banked[running] - used
    if (left <= 0) {
      banked[running] = 0
      // The flag fell during this stretch, and it stays fallen: the state now says so rather than working it out again.
      if (!flagged) flagged = running
    } else {
      banked[running] = left
    }
  }
  return { ...state, banked, spent, since: now, flagged }
}

/** Starts a side's clock. Used at the start of a game, from the position's own side to move. */
export function startClock(state: ClockState, side: Side, now: number): ClockState {
  if (state.flagged) return { ...state, since: now }
  const rebased = rebase(state, now)
  return { ...rebased, ticking: side, paused: false, pausedFrom: null }
}

/**
 * A move was made by `side`.
 *
 * The time it took is charged, the increment is paid, and the other clock starts. The increment is paid for a move
 * that was made in time: a move that arrives after the flag fell did not beat the clock and does not earn one.
 */
export function moveMade(state: ClockState, side: Side, now: number): ClockState {
  if (state.flagged) return { ...state, since: now }
  const rebased = rebase(state, now)
  const moves = { ...rebased.moves }
  moves[side] += 1
  if (rebased.flagged) {
    // The flag fell on the very move that was being made. The move stands with whoever is judging it; the clock
    // records that the time ran out, and pays no increment for it.
    return { ...rebased, moves, ticking: null }
  }
  const banked = { ...rebased.banked }
  if (!untimed(rebased)) banked[side] += rebased.control.incrementSeconds * 1000
  return { ...rebased, banked, moves, ticking: other(side) }
}

/** Stops the clock without ending anything: a pause the person asked for. The paused time is charged to nobody. */
export function pauseClock(state: ClockState, now: number): ClockState {
  if (state.paused) return { ...state }
  const rebased = rebase(state, now)
  return { ...rebased, paused: true, pausedFrom: rebased.ticking, ticking: null }
}

export function resumeClock(state: ClockState, now: number): ClockState {
  if (!state.paused) return { ...state, since: now }
  const side = state.pausedFrom
  return { ...state, since: now, paused: false, pausedFrom: null, ticking: state.flagged ? null : side }
}

/** The game is over. The last stretch of thinking is charged and nothing runs any more. */
export function stopClock(state: ClockState, now: number): ClockState {
  const rebased = rebase(state, now)
  return { ...rebased, ticking: null, paused: false, pausedFrom: null }
}

/**
 * Settles a fallen flag into the state.
 *
 * `flaggedAt` can answer the question at any moment; this is what makes the answer part of the record, so the game
 * that gets saved says the time ran out rather than depending on when somebody next looked.
 */
export function settleClock(state: ClockState, now: number): ClockState {
  const fallen = flaggedAt(state, now)
  if (!fallen) return state
  if (state.flagged === fallen && state.ticking === null) return state
  const rebased = rebase(state, now)
  return { ...rebased, flagged: fallen, ticking: null }
}

/**
 * A clock as people read one.
 *
 * Under ten seconds it shows tenths, because at that point the tenths are what you are watching. An hour or more
 * shows hours. Nothing is rounded up: a clock that says 1 second when it has 1.9 is honest, and one that says 2 is
 * not.
 */
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? ms : 0
  const seconds = Math.floor(total / 1000)
  if (total < 10_000) {
    const tenths = Math.floor((total % 1000) / 100)
    return `${seconds}.${tenths}`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`
}

/** Seconds left, for the `clock` a stored move carries. Null when there is no clock, so nothing invents one. */
export function clockSecondsFor(state: ClockState, side: Side, now: number): number | null {
  const left = remainingAt(state, now)
  if (!left) return null
  return Math.max(0, Math.round(left[side] / 1000))
}
