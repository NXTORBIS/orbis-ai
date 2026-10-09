/**
 * The weeks before an exam, and the day after it.
 *
 * ## Why this is a mode and not a mood
 *
 * Close to an exam a student needs different answers from the same software: plan the subject that is coming, not
 * the one that is interesting; practise producing answers, not meeting new material; stop being offered a fortnight
 * of spaced repetition that finishes after the paper. Those are decisions, and making them silently because a date
 * is near would be Orbis changing its behaviour behind somebody's back. So it is a mode, it is turned on by the
 * student, it says exactly what it changes, and it can be turned off in one press.
 *
 * ## What it will not do
 *
 * It will not lock anything, hide anything or refuse anything. It will not count down in a way designed to
 * frighten — the days left are a fact, shown once, without a colour that means panic. It will not tell somebody
 * they are behind: it says what fits in the time left and what does not, which is the same honesty the planner
 * uses every other week of the year.
 *
 * ## Afterwards
 *
 * The day after an exam there is no score to show — Orbis does not know how it went and will not ask leading
 * questions about it. What it can do is show what was covered and what was not, and ask the one useful question:
 * is this subject finished, or does it carry on?
 */

import { dayKey, daysBetween, shiftDay } from './days.ts'
import { overall, type Mastery } from './mastery.ts'
import type { Concept, Graph } from './graph.ts'
import type { Goal } from './types.ts'

export type Phase = 'none' | 'ahead' | 'preparing' | 'crunch' | 'tomorrow' | 'today' | 'after'

export interface ExamAhead {
  goalId: string
  title: string
  subject: string | null
  day: string
  daysLeft: number
  phase: Phase
  /** 0..1 across the material this exam covers, or null when there is nothing measured to go on. */
  ready: number | null
  /** What is worth the remaining time, weakest and most-covered first. */
  worthDoing: readonly { conceptId: string; name: string; score: number; why: string }[]
  /** Plainly, with no fright in it. */
  says: string
}

/** When each phase starts, in days before the paper. */
export const CRUNCH_DAYS = 3
export const PREPARING_DAYS = 14

function phaseFor(daysLeft: number): Phase {
  if (daysLeft < 0) return 'after'
  if (daysLeft === 0) return 'today'
  if (daysLeft === 1) return 'tomorrow'
  if (daysLeft <= CRUNCH_DAYS) return 'crunch'
  if (daysLeft <= PREPARING_DAYS) return 'preparing'
  return 'ahead'
}

/**
 * What is worth doing with the time left.
 *
 * Close to a paper the right thing is not the weakest topic in the course -- it is the one that is weak *and*
 * reachable. Something never started, three days out, is a worse use of an evening than something half-held that
 * one go would finish. So the ordering changes as the days run down, and it says which rule it used.
 */
export function worthDoing(
  graph: Graph,
  mastery: ReadonlyMap<string, Mastery>,
  subjects: readonly string[],
  daysLeft: number,
  limit = 8
): { conceptId: string; name: string; score: number; why: string }[] {
  const inside = subjects.length === 0 ? graph.concepts : graph.concepts.filter((one) => insideSubjects(graph, one, subjects))
  const rows = inside.map((one) => {
    const held = measured(mastery, one.id) ? mastery.get(one.id) : null
    return { concept: one, score: held ? overall(held) : 0, touched: !!held }
  })

  const close = daysLeft >= 0 && daysLeft <= CRUNCH_DAYS
  const picked = rows
    // Anything genuinely holding is left off: revising what you already have is the classic way to feel busy.
    .filter((one) => one.score < 0.7)
    .sort((a, b) => {
      if (close) {
        /*
         * In the last days: nearly-there first, and nothing untouched above something half-held.
         *
         * A topic at 0.6 that one session would finish is worth more on Thursday night than a topic at 0 that
         * needs a week. Said out loud in `why`, because a student should be able to disagree with it.
         */
        if (a.touched !== b.touched) return a.touched ? -1 : 1
        return b.score - a.score
      }
      return a.score - b.score
    })
    .slice(0, limit)

  return picked.map((one) => ({
    conceptId: one.concept.id,
    name: one.concept.name,
    score: one.score,
    why: !one.touched
      ? close
        ? 'Not started — a big ask this close, but it is on the paper.'
        : 'Not started yet.'
      : close
        ? // The same band the surprise engine uses: a few real answers land around here, and one more go finishes it.
          one.score >= 0.35
          ? 'Nearly holding — one go should finish it.'
          : 'Shaky, and worth the time while there is some.'
        : 'Weakest of what you have started.'
  }))
}

/**
 * Whether anything has actually been measured about a topic.
 *
 * A blank record is not a measurement. Orbis keeps one for every topic it knows, so asking "is it in the map" is
 * always yes -- and an exam with nothing studied for it was reporting 0% ready rather than "nothing measured yet",
 * which are different claims.
 */
function measured(mastery: ReadonlyMap<string, Mastery>, id: string): boolean {
  const held = mastery.get(id)
  return !!held && (held.attempts > 0 || Object.values(held.evidence).some((count) => count > 0))
}

function insideSubjects(graph: Graph, concept: Concept, subjects: readonly string[]): boolean {
  const chapter = graph.chapters.find((one) => one.id === concept.chapterId)
  return !!chapter && subjects.includes(chapter.subject)
}

/** Readiness across what this exam covers. Null when there is nothing measured — never a cheerful zero. */
export function readinessFor(graph: Graph, mastery: ReadonlyMap<string, Mastery>, subjects: readonly string[]): number | null {
  const inside = subjects.length === 0 ? graph.concepts : graph.concepts.filter((one) => insideSubjects(graph, one, subjects))
  if (inside.length === 0) return null
  if (!inside.some((one) => measured(mastery, one.id))) return null
  // Untouched topics count as zero: an exam you have met a third of is not two thirds ready.
  return inside.reduce((sum, one) => sum + (measured(mastery, one.id) ? overall(mastery.get(one.id) as Mastery) : 0), 0) / inside.length
}

function says(phase: Phase, daysLeft: number, title: string, ready: number | null): string {
  const holding = ready === null ? null : `${Math.round(ready * 100)}% of the material is holding`
  switch (phase) {
    case 'today':
      return `${title} is today. Nothing you do now changes much — go and sit it.`
    case 'tomorrow':
      return `${title} is tomorrow.${holding ? ` ${holding}.` : ''} Tonight is for the things you nearly have, not the things you have never met.`
    case 'crunch':
      return `${daysLeft} days to ${title}.${holding ? ` ${holding}.` : ''} This is the stretch where finishing half-held topics pays and starting new ones usually does not.`
    case 'preparing':
      return `${daysLeft} days to ${title}.${holding ? ` ${holding}.` : ''} There is still room to meet new material.`
    case 'after':
      return `${title} is done.`
    default:
      return `${title} is ${daysLeft} days away.`
  }
}

export function examAhead(
  goals: readonly Goal[],
  graph: Graph,
  mastery: ReadonlyMap<string, Mastery>,
  now: number,
  goalId?: string | null
): ExamAhead | null {
  const today = dayKey(now)
  const dated = goals
    .filter((one) => one.deadline !== null && one.state === 'active')
    .map((one) => ({ goal: one, day: dayKey(one.deadline as number), left: daysBetween(today, dayKey(one.deadline as number)) ?? 0 }))

  const chosen = goalId ? dated.find((one) => one.goal.id === goalId) : dated.filter((one) => one.left >= 0).sort((a, b) => a.left - b.left)[0]
  if (!chosen) return null

  const subjects = chosen.goal.subject ? [chosen.goal.subject] : []
  const ready = readinessFor(graph, mastery, subjects)
  const phase = phaseFor(chosen.left)

  return {
    goalId: chosen.goal.id,
    title: chosen.goal.title,
    subject: chosen.goal.subject,
    day: chosen.day,
    daysLeft: chosen.left,
    phase,
    ready,
    worthDoing: worthDoing(graph, mastery, subjects, chosen.left),
    says: says(phase, chosen.left, chosen.goal.title, ready)
  }
}

// ---------------------------------------------------------------- what the mode changes

export interface ExamSettings {
  /** The subject the plan puts first while this is on. Null means the mode is off. */
  goalId: string | null
  /** Turned on at this moment, so it can be said how long it has been on. */
  since: number | null
  /** Quieter, because somebody revising does not need a companion with opinions. */
  quieter: boolean
  /** Longer default sessions, which is what most people want in the last fortnight. */
  longerSessions: boolean
}

export const EXAM_OFF: ExamSettings = { goalId: null, since: null, quieter: true, longerSessions: true }

/** Exactly what turning it on does, in the words the screen shows. Nothing happens that is not on this list. */
export function whatChanges(settings: ExamSettings): string[] {
  const out = ['The plan puts this subject first, and says what will not fit.', 'What to do next is picked for the time left, not for the long run.']
  if (settings.quieter) out.push('Orbi stays quiet unless you ask.')
  if (settings.longerSessions) out.push('Sessions start at 50 minutes instead of your usual.')
  out.push('Nothing is locked, hidden or refused. Turn it off whenever you like.')
  return out
}

// ---------------------------------------------------------------- the day after

export interface AfterExam {
  goalId: string
  title: string
  day: string
  /** What was studied for it, counted. */
  sessions: number
  focusedSeconds: number
  covered: readonly string[]
  notCovered: readonly string[]
  /** One sentence of fact. No score, and no guess at how it went. */
  says: string
}

export function afterExam(
  goal: Goal,
  graph: Graph,
  mastery: ReadonlyMap<string, Mastery>,
  sessions: { subject: string | null; startedAt: number; focusedSeconds: number }[],
  now: number
): AfterExam {
  const day = dayKey(goal.deadline ?? now)
  const subjects = goal.subject ? [goal.subject] : []
  const inside = subjects.length === 0 ? graph.concepts : graph.concepts.filter((one) => insideSubjects(graph, one, subjects))
  const covered = inside.filter((one) => measured(mastery, one.id)).map((one) => one.name)
  const notCovered = inside.filter((one) => !measured(mastery, one.id)).map((one) => one.name)

  // Only the work that happened before the paper counts toward it.
  const mine = sessions.filter((one) => (goal.subject ? one.subject === goal.subject : true) && dayKey(one.startedAt) <= day)
  const seconds = mine.reduce((sum, one) => sum + one.focusedSeconds, 0)
  const hours = Math.round(seconds / 360) / 10

  return {
    goalId: goal.id,
    title: goal.title,
    day,
    sessions: mine.length,
    focusedSeconds: seconds,
    covered,
    notCovered,
    /*
     * A statement of what happened, and nothing about how it went.
     *
     * Orbis has no idea how the paper went and asking would be fishing. What it can say is the work that went in,
     * which is the part the student actually controlled.
     */
    says:
      mine.length === 0
        ? `No sessions recorded for ${goal.title}.`
        : `${hours} ${hours === 1 ? 'hour' : 'hours'} across ${mine.length} ${mine.length === 1 ? 'session' : 'sessions'} went into ${goal.title}.`
  }
}

/** The days from now to the paper, for a countdown that is a fact rather than a threat. */
export function daysTo(day: string, now: number): number {
  return daysBetween(dayKey(now), day) ?? 0
}

/** The last few days, as day keys, for laying out a final plan. */
export function finalDays(day: string, now: number, most = 7): string[] {
  const left = Math.max(0, Math.min(most, daysTo(day, now)))
  return Array.from({ length: left + 1 }, (_, i) => shiftDay(dayKey(now), i))
}
