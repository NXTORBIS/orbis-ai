import type { BreakPlan, FocusSession, PolicyState, SessionLogEntry, SessionState, TimerView } from './types.ts'

/**
 * The Focus session: a state machine, and a clock that cannot be fooled.
 *
 * ## Why the clock works the way it does
 *
 * A study timer is worth XP, so it is worth cheating, and it has to survive four things that have nothing to do with
 * cheating: the laptop lid closing, the application being closed, the application crashing, and the system clock
 * moving. `setInterval(() => seconds--)` survives none of them, and counting `Date.now() - startedAt` survives all of
 * them in the wrong direction -- it credits a student for eight hours of sleep.
 *
 * So time is credited in **ticks**, never computed from the start:
 *
 *   - Something alive (the main process) calls `tick()` every few seconds.
 *   - Each tick credits *at most* `MAX_TICK` seconds, however long it has actually been.
 *   - A gap longer than `GAP` means nobody was watching -- asleep, closed, crashed. The gap is not credited, and the
 *     session goes to `recovering` so the student is told rather than silently charged or silently paid.
 *
 * That one rule handles all four cases at once. Sleep cannot inflate the total, because a gap is never credited. A
 * clock pushed forward cannot inflate it either, for exactly the same reason. A crash loses at most one tick. And
 * nothing is lost by a restart, because what has been credited is already on disk.
 *
 * Monotonic time is used as a second opinion while the process lives: if the wall clock and the monotonic clock
 * disagree about how long a tick was, the smaller is taken. Across a restart only the wall clock exists, which is
 * why the per-tick cap matters more than either clock.
 *
 * Pure. Every function takes the time it should use and returns a new session.
 */

/** The most a single tick may credit, in seconds. Generous enough for a slow machine, small enough to bound a lie. */
export const MAX_TICK = 20
/** Longer than this between ticks and Orbis was not watching. */
export const GAP = 90
/** How often something should call `tick`. */
export const TICK_EVERY = 5

/** Legal moves. Anything not listed is refused, which is how an impossible state stays impossible. */
const MOVES: Record<SessionState, readonly SessionState[]> = {
  created: ['ready', 'ended-early'],
  ready: ['active', 'ended-early'],
  active: ['paused', 'break', 'completed', 'ended-early', 'interrupted', 'recovering'],
  paused: ['active', 'completed', 'ended-early', 'interrupted', 'recovering'],
  break: ['active', 'completed', 'ended-early', 'interrupted', 'recovering'],
  recovering: ['active', 'paused', 'completed', 'ended-early', 'expired'],
  restored: ['active', 'paused', 'break', 'recovering', 'completed', 'ended-early', 'expired'],
  interrupted: ['restored', 'recovering', 'expired', 'ended-early'],
  completed: [],
  'ended-early': [],
  expired: []
}

export function canMove(from: SessionState, to: SessionState): boolean {
  return from === to || MOVES[from].includes(to)
}

/** Whether a session is over, one way or another. */
export function isOver(state: SessionState): boolean {
  return state === 'completed' || state === 'ended-early' || state === 'expired'
}

const entry = (from: SessionState, to: SessionState, at: number, note: string): SessionLogEntry => ({ at, from, to, note })

function moved(session: FocusSession, to: SessionState, at: number, note: string): FocusSession {
  if (!canMove(session.state, to)) return session
  return {
    ...session,
    state: to,
    log: [...session.log, entry(session.state, to, at, note)].slice(-120),
    updatedAt: at
  }
}

// ---------------------------------------------------------------- starting

export interface SessionDraft {
  id: string
  profileId: string
  title: string
  subject: string | null
  taskId: string | null
  goalId: string | null
  milestoneId: string | null
  conceptId: string | null
  intention: string
  oneThing: string
  level: FocusSession['level']
  policy: FocusSession['policy']
  breaks: BreakPlan
  plannedMinutes: number
  atmosphere: string | null
  playlistId: string | null
  capsuleId: string | null
  spaceId: string | null
}

export function newSession(draft: SessionDraft, now: number, mono: number | null): FocusSession {
  const minutes = Math.min(600, Math.max(1, Math.round(draft.plannedMinutes)))
  return {
    ...draft,
    plannedMinutes: minutes,
    state: 'active',
    startedAt: now,
    startedMono: mono,
    endedAt: null,
    focusedSeconds: 0,
    breakSeconds: 0,
    breakNow: 0,
    log: [entry('created', 'active', now, 'started')],
    milestonesHit: [],
    interruptions: 0,
    distractionAttempts: 0,
    savedForLater: 0,
    orionTurns: 0,
    xpAwarded: 0,
    journal: '',
    settled: false,
    createdAt: now,
    updatedAt: now
  }
}

// ---------------------------------------------------------------- the clock

/** What the last tick saw, kept beside the session rather than in it: it is about the process, not about the study. */
export interface Beat {
  at: number
  mono: number | null
}

export interface TickResult {
  session: FocusSession
  /** Seconds credited by this tick. Zero when nothing was credited, which is not an error. */
  credited: number
  /** Set when a gap was found: how long nobody was watching. */
  gap: number | null
  /** Milestones passed by this tick, as fractions of the planned time. */
  milestones: readonly number[]
  /** Set when the planned time ran out on this tick. */
  finished: boolean
  /** Set when a focus block ended and a break is due. */
  breakDue: boolean
  /** Set when a break's time is up. */
  breakOver: boolean
}

/** The fractions of the way through a session that are worth saying something about. */
export const MILESTONES: readonly number[] = [0.25, 0.5, 0.75, 0.9]

/**
 * One tick of the clock.
 *
 * Takes the wall clock and, when the process can offer one, a monotonic reading. Returns a new session and a plain
 * account of what changed, so whatever called it can decide what to announce without re-deriving any of it.
 */
export function tick(session: FocusSession, beat: Beat, now: number, mono: number | null): TickResult {
  const still: TickResult = { session, credited: 0, gap: null, milestones: [], finished: false, breakDue: false, breakOver: false }
  if (isOver(session.state)) return still

  const wallDelta = Math.max(0, (now - beat.at) / 1000)
  // Monotonic is the second opinion. When the two disagree the smaller is taken, because the only way to disagree is
  // for one of them to have been interfered with, and crediting less is the safe direction.
  const monoDelta = mono !== null && beat.mono !== null ? Math.max(0, (mono - beat.mono) / 1000) : wallDelta
  const delta = Math.min(wallDelta, monoDelta)

  if (delta > GAP) {
    // Nobody was watching. Credit nothing, say so, and let the student decide.
    const paused = moved(session, 'recovering', now, `Orbis was not running for ${Math.round(delta / 60)} minutes`)
    return { ...still, session: { ...paused, interruptions: paused.interruptions + 1 }, gap: delta }
  }

  const credited = Math.min(delta, MAX_TICK)

  if (session.state === 'break') {
    const next = { ...session, breakSeconds: session.breakSeconds + credited, breakNow: session.breakNow + credited, updatedAt: now }
    const allowed = session.breaks.breakMinutes * 60
    return { ...still, session: next, credited, breakOver: allowed > 0 && next.breakNow >= allowed }
  }

  if (session.state !== 'active') return still

  const before = session.focusedSeconds
  const after = before + credited
  const planned = session.plannedMinutes * 60
  const hit = MILESTONES.filter((one) => before < planned * one && after >= planned * one && !session.milestonesHit.includes(one))

  let next: FocusSession = {
    ...session,
    focusedSeconds: after,
    milestonesHit: hit.length ? [...session.milestonesHit, ...hit] : session.milestonesHit,
    updatedAt: now
  }

  const blockSeconds = session.breaks.focusMinutes * 60
  const finished = after >= planned
  // A break is due at the end of a block, but never instead of finishing: the last block ends the session.
  const breakDue = !finished && blockSeconds > 0 && Math.floor(after / blockSeconds) > Math.floor(before / blockSeconds)
  if (breakDue) next = { ...moved(next, 'break', now, 'block finished, break due'), breakNow: 0 }

  return { ...still, session: next, credited, milestones: hit, finished, breakDue, breakOver: false }
}

// ---------------------------------------------------------------- what somebody does to it

export function pause(session: FocusSession, now: number): FocusSession {
  return moved(session, 'paused', now, 'paused')
}

export function resume(session: FocusSession, now: number): FocusSession {
  return moved(session, 'active', now, 'resumed')
}

export function beginBreak(session: FocusSession, now: number): FocusSession {
  const next = moved(session, 'break', now, 'break started')
  return next.state === 'break' ? { ...next, breakNow: 0 } : next
}

export function endBreak(session: FocusSession, now: number): FocusSession {
  return moved(session, 'active', now, 'break over')
}

export function complete(session: FocusSession, now: number): FocusSession {
  const done = moved(session, 'completed', now, 'completed')
  return done.state === 'completed' ? { ...done, endedAt: now } : done
}

export function endEarly(session: FocusSession, now: number, note = 'ended early'): FocusSession {
  const done = moved(session, 'ended-early', now, note)
  return done.state === 'ended-early' ? { ...done, endedAt: now } : done
}

/** The window closed or the process stopped. Not an ending: the session can still be picked up. */
export function interrupt(session: FocusSession, now: number, note = 'Orbis closed'): FocusSession {
  const next = moved(session, 'interrupted', now, note)
  return next.state === 'interrupted' ? { ...next, interruptions: next.interruptions + 1 } : next
}

/**
 * Picking an interrupted session back up, after a restart or a crash.
 *
 * Three answers, and which one it is depends only on time that was never credited:
 *
 *   - the planned time was already finished when Orbis stopped: it is complete, and pays out once;
 *   - the gap is long: it is `recovering`, and the student is asked whether to carry on;
 *   - the gap is short: it carries on, because closing a window for thirty seconds is not an abandoned session.
 */
export function restoreSession(session: FocusSession, beat: Beat, now: number): { session: FocusSession; kind: 'complete' | 'ask' | 'continue' | 'expired'; gapMinutes: number } {
  const gap = Math.max(0, (now - beat.at) / 1000)
  const gapMinutes = Math.round(gap / 60)
  const planned = session.plannedMinutes * 60

  if (session.focusedSeconds >= planned) {
    const done = complete({ ...session, state: session.state === 'interrupted' ? 'recovering' : session.state }, now)
    return { session: done, kind: 'complete', gapMinutes }
  }
  // Away for most of a day: the session is not something anybody is coming back to.
  if (gap > 6 * 3600) {
    const expired = moved({ ...session, state: 'interrupted' }, 'expired', now, `left for ${Math.round(gap / 3600)} hours`)
    return { session: { ...expired, endedAt: now }, kind: 'expired', gapMinutes }
  }
  if (gap > GAP) {
    const asking = moved({ ...session, state: 'interrupted' }, 'recovering', now, `Orbis was closed for ${gapMinutes} minutes`)
    return { session: asking, kind: 'ask', gapMinutes }
  }
  const back = moved({ ...session, state: 'interrupted' }, 'restored', now, 'restored')
  return { session: moved(back, 'active', now, 'carried on'), kind: 'continue', gapMinutes }
}

/** Carrying on from `recovering`, which is the student's decision and nobody else's. */
export function carryOn(session: FocusSession, now: number): FocusSession {
  return moved(session, 'active', now, 'carried on after a gap')
}

// ---------------------------------------------------------------- what the screen shows

export function timerView(session: FocusSession): TimerView {
  const planned = session.plannedMinutes * 60
  const elapsed = Math.min(session.focusedSeconds, planned);
  const blockSeconds = session.breaks.focusMinutes * 60
  const blocks = blockSeconds > 0 ? Math.max(1, Math.ceil(planned / blockSeconds)) : 1
  const next = MILESTONES.map((one) => Math.round(planned * one)).find((one) => one > session.focusedSeconds) ?? null
  return {
    state: session.state,
    elapsed: Math.round(session.focusedSeconds),
    remaining: Math.max(0, Math.round(planned - session.focusedSeconds)),
    plannedSeconds: planned,
    through: planned > 0 ? Math.min(1, session.focusedSeconds / planned) : 0,
    nextMilestone: next,
    breakRemaining: session.state === 'break' && session.breaks.breakMinutes > 0 ? Math.max(0, Math.round(session.breaks.breakMinutes * 60 - session.breakNow)) : null,
    block: blockSeconds > 0 ? Math.min(blocks, Math.floor(elapsed / blockSeconds) + 1) : 1,
    blocks,
    locked: session.policy.locked
  }
}

export function policyStateOf(session: FocusSession | null): PolicyState {
  if (!session || isOver(session.state)) return 'normal'
  if (session.state === 'break') return 'break'
  if (session.policy.locked) return 'locked'
  return session.level
}

/** Minutes and seconds, as a clock. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** A length of time in words, for a summary rather than a timer. */
export function spell(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  // Under a minute stays in seconds. Rounding 45 up to "1m" reads as a lie about a number somebody can see.
  if (whole < 60) return `${whole}s`
  const h = Math.floor(whole / 3600)
  const m = Math.round((whole % 3600) / 60)
  if (h > 0 && m > 0) return `${h}h ${m}m`
  if (h > 0) return `${h}h`
  return `${m}m`
}

/**
 * Whether a finished session counts for anything.
 *
 * The guard against the shortest way to farm XP: start a session, end it, repeat. A session has to have been most of
 * what it said it would be, or at least a few real minutes, before it pays anything at all.
 */
export function counts(session: FocusSession): boolean {
  if (session.focusedSeconds < 300) return false
  const planned = session.plannedMinutes * 60
  return session.state === 'completed' || session.focusedSeconds >= planned * 0.6
}
