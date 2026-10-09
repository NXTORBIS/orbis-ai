import { dayKey, partOfDay } from './days.ts'
import { candidates, radar, type Candidate, type PlanInput } from './planner.ts'
import { weaknesses } from './mastery.ts'
import type { FocusSession, StudentTask } from './types.ts'

/**
 * What would genuinely help this student right now.
 *
 * ## One answer, not twelve
 *
 * At any moment there are a dozen defensible things to say: revision is due, an exam is close, a subject has been
 * neglected, a task is unfinished, a record is nearly beaten, a quest is one step from done. Showing all of them is
 * the failure mode of every study tool -- the student reads none of it and the recommendations become wallpaper.
 *
 * So this engine scores every possible intervention and returns **one**, with its reason, or `no-action`.
 *
 * ## no-action is the most important decision here
 *
 * It is not a fallback for when nothing scored. It wins outright whenever the student is already doing the thing:
 * mid-session, mid-break, typing, in a locked session, or inside quiet hours. A companion that interrupts somebody
 * who is already working is worse than one that says nothing, because it gets switched off and then says nothing
 * for ever.
 *
 * ## The budget
 *
 * Every intervention costs from a daily budget. A high-priority one can spend what a low-priority one cannot, and
 * when the budget is gone only the critical things get through. That is what stops a motivational line, a
 * reminder, an achievement, a quest nudge and a recommendation all arriving in the same minute.
 *
 * Pure: the caller hands in the state and the history, and gets a decision back.
 */

export type Decision =
  | 'no-action'
  | 'start-focus'
  | 'start-revision'
  | 'continue-task'
  | 'recommend-task'
  | 'recommend-subject'
  | 'take-break'
  | 'recover'
  | 'motivate'
  | 'save-distraction'
  | 'show-deadline'
  | 'show-exam'
  | 'show-progress'
  | 'show-record'
  | 'recommend-orion'
  | 'recommend-recall'
  | 'recommend-quiz'
  | 'recommend-practice'
  | 'recommend-mistakes'
  | 'easier-task'
  | 'reschedule'
  | 'organize-tabs'
  | 'restore-session'
  | 'celebrate'
  | 'comeback'
  | 'good-stop'
  | 'short-session'

export type Priority = 'critical' | 'high' | 'normal' | 'low'

export interface Intervention {
  decision: Decision
  priority: Priority
  /** The headline. One line, in the student's own terms. */
  title: string
  /** Why this, said so the student could check it against their own history. */
  because: string
  /** What the buttons should be. The first is the main one. */
  actions: readonly { id: string; label: string }[]
  /** What it is about, when it is about something. */
  subject: string | null
  conceptId: string | null
  minutes: number | null
  forId: string | null
  /** 0..1. For diagnosis; never shown to a student. */
  score: number
}

export const NOTHING: Intervention = {
  decision: 'no-action',
  priority: 'low',
  title: '',
  because: '',
  actions: [],
  subject: null,
  conceptId: null,
  minutes: null,
  forId: null,
  score: 0
}

// ---------------------------------------------------------------- the budget

/** What each priority costs, and what a day holds. */
const COST: Record<Priority, number> = { critical: 0, high: 2, normal: 3, low: 5 }
export const DAILY_BUDGET = 12

export interface InterventionLog {
  /** The day this budget belongs to. */
  day: string
  spent: number
  /** When each decision was last made, so the same one does not come round again immediately. */
  last: Readonly<Record<string, number>>
  /** How each decision has been received. This is what makes the engine learn. */
  outcomes: Readonly<Record<string, { shown: number; accepted: number; dismissed: number }>>
}

export function newLog(day: string): InterventionLog {
  return { day, spent: 0, last: {}, outcomes: {} }
}

/** How long before the same decision may be made again. */
const COOLDOWN: Record<Priority, number> = { critical: 10 * 60_000, high: 45 * 60_000, normal: 3 * 3600_000, low: 8 * 3600_000 }

/**
 * How well a kind of intervention has gone down.
 *
 * Returns 1 until there is real evidence, so nothing is suppressed on the strength of two dismissals. Past that,
 * something repeatedly dismissed is quietly scaled down and something repeatedly accepted is scaled up -- which is
 * the whole of the learning here, deliberately: a bounded multiplier, not a model that can talk itself into
 * silence.
 */
export function reception(log: InterventionLog, decision: Decision): number {
  const held = log.outcomes[decision]
  if (!held || held.shown < 4) return 1
  const share = held.accepted / Math.max(1, held.accepted + held.dismissed)
  return Math.max(0.35, Math.min(1.5, 0.5 + share))
}

export function record(log: InterventionLog, decision: Decision, what: 'shown' | 'accepted' | 'dismissed', at: number, priority: Priority): InterventionLog {
  const day = dayKey(at)
  const base = log.day === day ? log : newLog(day)
  const held = base.outcomes[decision] ?? { shown: 0, accepted: 0, dismissed: 0 }
  return {
    day,
    spent: what === 'shown' ? base.spent + COST[priority] : base.spent,
    last: what === 'shown' ? { ...base.last, [decision]: at } : base.last,
    outcomes: { ...base.outcomes, [decision]: { ...held, [what]: held[what] + 1 } }
  }
}

// ---------------------------------------------------------------- what the engine is told

export interface DecideInput extends PlanInput {
  /** The running session, if there is one. */
  session: FocusSession | null
  /** What the student is doing right now. Each of these is a reason to say nothing. */
  busy: { typing: boolean; reading: boolean; quizzing: boolean; waitingOnOrion: boolean }
  tasks: readonly StudentTask[]
  /** Days since the last finished session. 0 means today. */
  daysAway: number
  /** Today's totals, for knowing when enough has been done. */
  today: { focusedSeconds: number; sessions: number; completed: number; plannedMinutes: number }
  /** A personal record within reach, when there is one. */
  record: { what: string; inSeconds: number; beaten: boolean } | null
  /** Open browser tabs, for the one observation worth making about them. */
  tabs: readonly { url: string; title: string }[]
  /** A session that was interrupted and not picked up. */
  interrupted: FocusSession | null
  log: InterventionLog
  /** Quiet hours, as local hours. Null when none are set. */
  quietHours: { from: number; to: number } | null
  /** Whether the student has asked Orbi to stay quiet. */
  paused: boolean
  /** How long the student has been idle, in minutes. */
  idleMinutes: number
}

export function insideQuietHours(hours: { from: number; to: number } | null, at: number): boolean {
  if (!hours) return false
  const hour = new Date(at).getHours()
  // A window that crosses midnight is two windows.
  return hours.from <= hours.to ? hour >= hours.from && hour < hours.to : hour >= hours.from || hour < hours.to
}

// ---------------------------------------------------------------- the decision

/**
 * One intervention, or nothing.
 *
 * The order is load-bearing. The silence checks come first and return outright: nothing below them can override
 * somebody who is mid-sentence or mid-session. Only then is anything scored.
 */
/**
 * A piece of work, named with its subject in front of it.
 *
 * The subject is left off when the title already carries it, which is the common case for a chapter nobody has
 * opened yet — the planner falls back to the subject as the title, and prefixing it produced "Chemistry —
 * Chemistry" on the student's home screen.
 */
export function titleWith(subject: string | null | undefined, title: string): string {
  const name = (title ?? '').trim()
  const of = (subject ?? '').trim()
  if (!of) return name
  if (!name) return of
  if (name.toLowerCase() === of.toLowerCase()) return of
  if (name.toLowerCase().startsWith(`${of.toLowerCase()} `)) return name
  return `${of} — ${name}`
}

export function decide(input: DecideInput): Intervention {
  const at = input.now

  // ---- the silences, in order. Each of these is final.
  if (input.paused) return NOTHING
  if (input.busy.typing || input.busy.waitingOnOrion) return NOTHING
  if (input.session && input.session.state === 'active') {
    /*
     * Mid-session.
     *
     * Two exceptions, and only two: a break that is genuinely due, and a record about to be beaten. Everything
     * else can wait until the session is over -- that is what the session is for.
     */
    if (input.session.focusedSeconds >= 50 * 60 && input.session.breaks.breakMinutes === 0) {
      return spend(input, {
        decision: 'take-break',
        priority: 'normal',
        title: 'A break is available',
        because: `${Math.round(input.session.focusedSeconds / 60)} minutes without one.`,
        actions: [
          { id: 'break', label: 'Take ten minutes' },
          { id: 'dismiss', label: 'Keep going' }
        ],
        subject: input.session.subject,
        conceptId: null,
        minutes: 10,
        forId: null,
        score: 0.5
      })
    }
    if (input.record && !input.record.beaten && input.record.inSeconds <= 300) {
      return spend(input, {
        decision: 'show-record',
        priority: 'low',
        title: `${Math.round(input.record.inSeconds / 60)} minutes from ${input.record.what}`,
        because: 'Your own record, from your own history.',
        actions: [{ id: 'dismiss', label: 'Got it' }],
        subject: input.session.subject,
        conceptId: null,
        minutes: null,
        forId: null,
        score: 0.3
      })
    }
    return NOTHING
  }
  if (input.session && (input.session.state === 'break' || input.session.state === 'paused' || input.session.state === 'recovering')) return NOTHING
  if (insideQuietHours(input.quietHours, at)) return NOTHING

  // ---- a session that was left hanging outranks everything, because it is the student's own unfinished work.
  if (input.interrupted) {
    return spend(input, {
      decision: 'restore-session',
      priority: 'critical',
      title: 'Your session is still here',
      because: `${input.interrupted.title} — ${Math.round(input.interrupted.focusedSeconds / 60)} minutes done.`,
      actions: [
        { id: 'resume', label: 'Carry on' },
        { id: 'end', label: 'Finish it here' }
      ],
      subject: input.interrupted.subject,
      conceptId: null,
      minutes: Math.max(1, input.interrupted.plannedMinutes - Math.round(input.interrupted.focusedSeconds / 60)),
      forId: null,
      score: 1
    })
  }

  // ---- coming back after a while. Said once, gently, and it leads somewhere small.
  if (input.daysAway >= 3) {
    return spend(input, {
      decision: 'comeback',
      priority: 'high',
      title: 'Welcome back',
      because: input.daysAway >= 14 ? 'It has been a while. Starting small is the easiest way back.' : `Last session was ${input.daysAway} days ago.`,
      actions: [
        { id: 'short', label: 'Ten minutes' },
        { id: 'plan', label: 'Show me the plan' },
        { id: 'dismiss', label: 'Not now' }
      ],
      subject: null,
      conceptId: null,
      minutes: 10,
      forId: null,
      score: 0.9
    })
  }

  // ---- done enough for today. This is a real decision, not an absence of one.
  const plannedToday = input.today.plannedMinutes
  if (plannedToday > 0 && input.today.focusedSeconds >= plannedToday * 60 && input.today.completed > 0) {
    return spend(input, {
      decision: 'good-stop',
      priority: 'low',
      title: "That's today done",
      because: `${Math.round(input.today.focusedSeconds / 60)} minutes against a plan of ${plannedToday}.`,
      actions: [
        { id: 'dismiss', label: 'Thanks' },
        { id: 'more', label: 'One more anyway' }
      ],
      subject: null,
      conceptId: null,
      minutes: null,
      forId: null,
      score: 0.4
    })
  }

  // ---- everything else is scored.
  const scored: Intervention[] = []

  // An unfinished task that was actually started.
  const active = input.tasks.find((one) => one.state === 'active')
  if (active) {
    scored.push({
      decision: 'continue-task',
      priority: 'high',
      title: `Carry on with ${active.title}`,
      because: active.actual > 0 ? `${active.actual} minutes in already.` : 'You started this one.',
      actions: [
        { id: 'start', label: 'Start' },
        { id: 'other', label: 'Something else' }
      ],
      subject: active.subject,
      conceptId: null,
      minutes: active.estimate ?? 25,
      forId: active.id,
      score: 0.78
    })
  }

  // What is coming, and how ready it looks.
  const coming = radar(input)
  const pressing = coming[0]
  if (pressing && pressing.daysLeft <= 10) {
    scored.push({
      decision: pressing.kind === 'exam' ? 'show-exam' : 'show-deadline',
      priority: pressing.daysLeft <= 2 ? 'critical' : 'high',
      title: `${pressing.title} ${pressing.daysLeft === 0 ? 'is today' : pressing.daysLeft === 1 ? 'is tomorrow' : `is ${pressing.daysLeft} days away`}`,
      because: pressing.note,
      actions: [
        { id: 'start', label: 'Work on it' },
        { id: 'plan', label: 'Plan the days' }
      ],
      subject: null,
      conceptId: null,
      minutes: 30,
      forId: pressing.id,
      score: 0.72 + Math.max(0, (10 - pressing.daysLeft) / 40)
    })
  }

  // The best single piece of work the planner can find.
  const pool = candidates(input)
  const best = pool[0]
  if (best) {
    scored.push({
      decision: decisionFor(best),
      priority: 'normal',
      title: titleWith(best.subject, best.title),
      because: best.because,
      actions: [
        { id: 'start', label: `Start ${best.minutes} minutes` },
        { id: 'other', label: 'Something else' },
        { id: 'plan', label: 'Show the plan' }
      ],
      subject: best.subject || null,
      conceptId: best.conceptId,
      minutes: best.minutes,
      forId: best.forId,
      score: 0.4 + best.value * 0.45
    })
  }

  // Something weak, when there is real evidence it is weak.
  const weak = weaknesses([...input.mastery.values()], at, 1)[0]
  if (weak) {
    const concept = input.graph.concepts.find((one) => one.id === weak.conceptId)
    if (concept) {
      scored.push({
        decision: weak.weakest === 'recall' ? 'recommend-recall' : weak.weakest === 'application' ? 'recommend-practice' : 'recommend-orion',
        priority: 'normal',
        title: concept.name,
        because: weak.why,
        actions: [
          { id: 'start', label: 'Fifteen minutes on it' },
          { id: 'orion', label: 'Ask Orion first' },
          { id: 'dismiss', label: 'Not now' }
        ],
        subject: input.graph.chapters.find((one) => one.id === concept.chapterId)?.subject ?? null,
        conceptId: concept.id,
        minutes: 15,
        forId: null,
        score: 0.42 + weak.need * 0.3
      })
    }
  }

  // The one observation about tabs worth making, and only when there are plainly too many.
  if (input.tabs.length >= 15) {
    scored.push({
      decision: 'organize-tabs',
      priority: 'low',
      title: `${input.tabs.length} tabs open`,
      because: 'Some of them look like they belong together.',
      actions: [
        { id: 'organize', label: 'Put them in a space' },
        { id: 'dismiss', label: 'Leave them' }
      ],
      subject: null,
      conceptId: null,
      minutes: null,
      forId: null,
      score: 0.3
    })
  }

  // Nothing is planned and there is nothing outstanding: a short session keeps things alive.
  if (scored.length === 0 && input.subjects.length > 0 && input.idleMinutes > 5) {
    scored.push({
      decision: 'short-session',
      priority: 'low',
      title: 'Ten minutes?',
      because: input.today.sessions === 0 ? 'Nothing today yet.' : 'Nothing is due, so this is just keeping momentum.',
      actions: [
        { id: 'start', label: 'Start ten minutes' },
        { id: 'dismiss', label: 'Not now' }
      ],
      subject: input.subjects[0],
      conceptId: null,
      minutes: 10,
      forId: null,
      score: 0.22
    })
  }

  // ---- the single best one, after what the student has made of each kind before.
  const ranked = scored
    .map((one) => ({ ...one, score: one.score * reception(input.log, one.decision) }))
    .filter((one) => {
      const last = input.log.last[one.decision] ?? 0
      return at - last >= COOLDOWN[one.priority]
    })
    .sort((a, b) => b.score - a.score)

  const chosen = ranked[0]
  if (!chosen) return NOTHING
  return spend(input, chosen)
}

function decisionFor(one: Candidate): Decision {
  switch (one.kind) {
    case 'revise':
      return 'start-revision'
    case 'recall':
      return 'recommend-recall'
    case 'practice':
      return 'recommend-practice'
    case 'mistakes':
      return 'recommend-mistakes'
    case 'mock':
      return 'recommend-quiz'
    default:
      return 'start-focus'
  }
}

/**
 * Whether there is budget for this one.
 *
 * Critical interventions always pass -- an unfinished session or an exam tomorrow is not something to withhold
 * because the day has been chatty. Everything else is refused once the budget is gone, and refused silently.
 */
function spend(input: DecideInput, one: Intervention): Intervention {
  if (one.priority === 'critical') return one
  const log = input.log.day === dayKey(input.now) ? input.log : newLog(dayKey(input.now))
  return log.spent + COST[one.priority] <= DAILY_BUDGET ? one : NOTHING
}

/**
 * The same question, asked for a screen rather than for an interruption.
 *
 * The dashboard is allowed to show the best recommendation whenever it is open: the student came looking, so there
 * is nothing to interrupt and no budget to spend. This is the difference between answering and intruding.
 */
export function recommend(input: DecideInput): Intervention {
  /*
   * `paused` is cleared here as well as the quiet hours.
   *
   * Quiet means "do not interrupt me", not "do not answer me". Exam mode turns the companion down, and a student
   * who then opens the screen and asks what to do was getting silence back -- which reads as broken rather than as
   * restrained.
   */
  return decide({ ...input, log: newLog(dayKey(input.now)), quietHours: null, paused: false, idleMinutes: 99 })
}

/**
 * Whether Orbi should appear by itself.
 *
 * The question is not "does Orbis know something?" but "will appearing right now genuinely help?". So it needs a
 * decision worth making, a student who is not already busy, a time of day they actually study, and budget — and if
 * any of those is missing, Orbi stays where it is.
 */
export function shouldAppear(input: DecideInput, usualHours: readonly number[]): { appear: boolean; intervention: Intervention; why: string } {
  if (input.session) return { appear: false, intervention: NOTHING, why: 'a session is running' }
  if (input.paused) return { appear: false, intervention: NOTHING, why: 'Orbi is paused' }
  if (insideQuietHours(input.quietHours, input.now)) return { appear: false, intervention: NOTHING, why: 'quiet hours' }
  if (input.busy.typing || input.busy.reading) return { appear: false, intervention: NOTHING, why: 'busy' }

  const hour = new Date(input.now).getHours()
  // Only at an hour they actually study, once there is enough history to know what those are.
  if (usualHours.length >= 3 && !usualHours.includes(hour)) return { appear: false, intervention: NOTHING, why: 'not a time they study' }
  if (partOfDay(input.now) === 'night' && usualHours.length < 3) return { appear: false, intervention: NOTHING, why: 'late, and nothing says they study late' }

  const intervention = decide(input)
  if (intervention.decision === 'no-action') return { appear: false, intervention, why: 'nothing worth saying' }
  if (intervention.priority === 'low') return { appear: false, intervention, why: 'not worth appearing for' }
  return { appear: true, intervention, why: '' }
}

/**
 * The hours this student actually studies, from their own sessions.
 *
 * Null until there is enough to mean anything. Three sessions do not establish a habit, and treating them as one
 * produces a companion that turns up at the wrong time and is never trusted again.
 */
export function usualHours(sessions: readonly { startedAt: number; focusedSeconds: number }[]): number[] {
  const real = sessions.filter((one) => one.focusedSeconds >= 300)
  if (real.length < 6) return []
  const counts = new Map<number, number>()
  for (const one of real) {
    const hour = new Date(one.startedAt).getHours()
    counts.set(hour, (counts.get(hour) ?? 0) + 1)
  }
  const most = Math.max(...counts.values())
  // Any hour used at least a third as often as the commonest one counts as a time they study.
  return [...counts.entries()]
    .filter(([, count]) => count >= Math.max(2, most / 3))
    .map(([hour]) => hour)
    .sort((a, b) => a - b)
}
