import { dayKey, daysBetween, shiftDay } from './days.ts'
import { decayed, overall, type Mastery } from './mastery.ts'
import type { Chapter, Concept, Graph } from './graph.ts'

/**
 * What to do today, and what to do when today did not happen.
 *
 * ## The rule that makes a planner usable
 *
 * **It never plans more than there is time for.** A plan that cannot be finished is read once and then ignored, and
 * after that the planner is furniture. So every plan here is built by filling a budget of minutes the student
 * actually said they have -- work that does not fit is left out and *said* to be left out, rather than being
 * stacked up to be carried for ever.
 *
 * That has a consequence worth stating: when somebody falls behind, the backlog is **not** added to tomorrow.
 * `replan` reshapes the remaining days instead, dropping what is least valuable, because the alternative -- eleven
 * hours of catching up on a Tuesday -- is how a student concludes that studying is impossible.
 *
 * ## No guilt
 *
 * Nothing in here records a day as failed, colours anything red, or says anything about whether somebody is behind
 * as a person. A missed session is an input to the next plan and nothing else.
 *
 * Pure.
 */

export type WorkKind = 'learn' | 'practice' | 'recall' | 'revise' | 'mistakes' | 'mock' | 'read' | 'break'

export interface PlanItem {
  id: string
  kind: WorkKind
  /** Minutes. Always a real number of minutes somebody could do. */
  minutes: number
  subject: string | null
  chapterId: string | null
  conceptId: string | null
  /** What it is, in the student's words. */
  title: string
  /** Why it was chosen. One sentence, checkable against their own history. */
  because: string
  /** 0..1, how much it matters. Used when something has to be dropped. */
  value: number
  /** Set when a deadline or an exam is what makes this urgent. */
  forId: string | null
  state: 'planned' | 'done' | 'skipped' | 'moved'
}

export interface DayPlan {
  day: string
  items: readonly PlanItem[]
  minutes: number
  /** What there was no room for, so the student is told rather than left to notice. */
  leftOut: readonly { title: string; minutes: number; why: string }[]
  /** One sentence about the shape of the day. */
  note: string
}

export interface Availability {
  /** Minutes free on each day, by day key. A day that is not listed is a day with no time. */
  minutes: Readonly<Record<string, number>>
  /** The longest single stretch somebody wants to sit for. Sessions are never longer than this. */
  longestSession: number
  /** Minutes of break between sessions, when more than one fits. */
  breakMinutes: number
}

export interface Exam {
  id: string
  name: string
  /** The day it happens. */
  day: string
  subjects: readonly string[]
  /** Which chapters it covers. Empty means the whole subject. */
  chapterIds: readonly string[]
  importance: number
}

export interface Deadline {
  id: string
  title: string
  day: string
  subject: string | null
  /** Minutes of work left on it, as the student estimated. */
  minutesLeft: number
  importance: number
}

export interface PlanInput {
  graph: Graph
  mastery: ReadonlyMap<string, Mastery>
  availability: Availability
  exams: readonly Exam[]
  deadlines: readonly Deadline[]
  /** Subjects the student is actually working on. Anything outside this is not planned. */
  subjects: readonly string[]
  /** When each subject was last studied, by subject. */
  lastStudied: Readonly<Record<string, number>>
  now: number
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value))

/** How urgent something dated is. Rises sharply in the last few days and is flat a month out. */
function urgency(day: string, today: string, importance: number): number {
  const left = daysBetween(today, day)
  if (left === null) return importance * 0.3
  if (left < 0) return importance
  if (left === 0) return importance
  // 1 day -> ~0.9, 7 days -> ~0.5, 30 days -> ~0.15.
  return clamp(importance * (1 / (1 + left / 6)))
}

// ---------------------------------------------------------------- what is worth doing

export interface Candidate {
  kind: WorkKind
  minutes: number
  subject: string
  chapterId: string | null
  conceptId: string | null
  title: string
  because: string
  value: number
  forId: string | null
}

/**
 * Everything that could usefully be done, scored.
 *
 * Six sources, each with its own reason attached, because a recommendation a student cannot check is one they
 * stop trusting: revision that has decayed, concepts that are weak, work for a near exam, work for a near
 * deadline, the next unstarted concept in a chapter, and a subject that has been left alone.
 */
export function candidates(input: PlanInput): Candidate[] {
  const today = dayKey(input.now)
  const out: Candidate[] = []
  const byChapter = new Map<string, Chapter>(input.graph.chapters.map((one) => [one.id, one]))
  const subjectOf = (concept: Concept): string => byChapter.get(concept.chapterId)?.subject ?? ''

  // --- revision that has decayed
  for (const [conceptId, held] of input.mastery) {
    const concept = input.graph.concepts.find((one) => one.id === conceptId)
    if (!concept) continue
    const subject = subjectOf(concept)
    if (!input.subjects.includes(subject)) continue
    const stale = decayed(held, input.now)
    if (!stale.due) continue
    out.push({
      kind: 'revise',
      minutes: 10,
      subject,
      chapterId: concept.chapterId,
      conceptId,
      title: concept.name,
      because: `Last looked at ${stale.days} ${stale.days === 1 ? 'day' : 'days'} ago.`,
      value: clamp(0.4 + concept.importance * 0.3 + Math.min(0.3, (stale.days - stale.allowed) / 30)),
      forId: null
    })
  }

  // --- what is weak
  for (const [conceptId, held] of input.mastery) {
    const concept = input.graph.concepts.find((one) => one.id === conceptId)
    if (!concept) continue
    const subject = subjectOf(concept)
    if (!input.subjects.includes(subject)) continue
    const score = overall(held)
    if (score >= 0.5 && held.state !== 'slipping') continue
    if (held.confidence < 0.2) continue
    const weakest = held.scores.recall < held.scores.application ? 'recall' : 'practice'
    out.push({
      kind: weakest === 'recall' ? 'recall' : 'practice',
      minutes: 15,
      subject,
      chapterId: concept.chapterId,
      conceptId,
      title: concept.name,
      because: held.state === 'slipping' ? 'This was solid and has started slipping.' : 'This one is not holding yet.',
      value: clamp(0.45 + (1 - score) * 0.4 + concept.importance * 0.2),
      forId: null
    })
  }

  // --- exams
  for (const exam of input.exams) {
    const left = daysBetween(today, exam.day)
    if (left === null || left < 0) continue
    const need = urgency(exam.day, today, exam.importance)
    for (const subject of exam.subjects) {
      if (!input.subjects.includes(subject)) continue
      const chapters = exam.chapterIds.length > 0 ? exam.chapterIds : input.graph.chapters.filter((one) => one.subject === subject).map((one) => one.id)
      // Within four days of an exam, the useful work is revision and mocks rather than new material.
      const kind: WorkKind = left <= 2 ? 'mock' : left <= 6 ? 'revise' : 'practice'
      const weakest = chapters
        .map((chapterId) => {
          const inside = input.graph.concepts.filter((one) => one.chapterId === chapterId)
          const score = inside.length === 0 ? 0 : inside.reduce((sum, one) => sum + (input.mastery.has(one.id) ? overall(input.mastery.get(one.id) as Mastery) : 0), 0) / inside.length
          return { chapterId, score, name: byChapter.get(chapterId)?.name ?? '' }
        })
        .sort((a, b) => a.score - b.score)[0]
      if (!weakest) continue
      out.push({
        kind,
        minutes: kind === 'mock' ? 30 : 20,
        subject,
        chapterId: weakest.chapterId,
        conceptId: null,
        title: weakest.name || subject,
        because: `${exam.name} is ${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days away`}.`,
        value: clamp(0.5 + need * 0.5),
        forId: exam.id
      })
    }
  }

  // --- deadlines
  for (const one of input.deadlines) {
    if (one.minutesLeft <= 0) continue
    const left = daysBetween(today, one.day)
    if (left === null) continue
    out.push({
      kind: 'practice',
      minutes: Math.min(45, Math.max(10, Math.round(one.minutesLeft / Math.max(1, (left ?? 0) + 1)))),
      subject: one.subject ?? '',
      chapterId: null,
      conceptId: null,
      title: one.title,
      because: left < 0 ? 'This date has passed.' : left === 0 ? 'Due today.' : `Due in ${left} ${left === 1 ? 'day' : 'days'}.`,
      value: clamp(0.45 + urgency(one.day, today, one.importance) * 0.55),
      forId: one.id
    })
  }

  // --- the next thing in a chapter that has been started
  for (const subject of input.subjects) {
    const chapters = input.graph.chapters.filter((one) => one.subject === subject)
    for (const chapter of chapters) {
      const inside = input.graph.concepts.filter((one) => one.chapterId === chapter.id).sort((a, b) => a.order - b.order)
      const started = inside.some((one) => input.mastery.has(one.id))
      const next = inside.find((one) => !input.mastery.has(one.id))
      if (!started || !next) continue
      out.push({
        kind: 'learn',
        minutes: 20,
        subject,
        chapterId: chapter.id,
        conceptId: next.id,
        title: next.name,
        because: `The next one in ${chapter.name}.`,
        value: clamp(0.35 + next.importance * 0.3),
        forId: null
      })
    }
  }

  // --- a subject left alone
  for (const subject of input.subjects) {
    const last = input.lastStudied[subject]
    const days = last ? (daysBetween(dayKey(last), today) ?? 0) : 99
    if (days < 4) continue
    const chapter = input.graph.chapters.find((one) => one.subject === subject)
    out.push({
      kind: 'revise',
      minutes: 15,
      subject,
      chapterId: chapter?.id ?? null,
      conceptId: null,
      title: subject,
      because: days >= 99 ? 'Not started yet.' : `Not touched for ${days} days.`,
      // Deliberately modest: being old is not the same as being important.
      value: clamp(0.3 + Math.min(0.25, days / 40)),
      forId: null
    })
  }

  return out.sort((a, b) => b.value - a.value)
}

// ---------------------------------------------------------------- a day

/**
 * One day, filled to the time available and no further.
 *
 * Sessions are capped at the longest stretch the student said they want, a break goes between them, one subject
 * never takes the whole day unless there is nothing else, and whatever did not fit is reported.
 */
export function planDay(input: PlanInput, day: string, pool?: readonly Candidate[]): DayPlan {
  const budget = Math.max(0, Math.round(input.availability.minutes[day] ?? 0))
  const options = [...(pool ?? candidates(input))]
  const items: PlanItem[] = []
  const leftOut: { title: string; minutes: number; why: string }[] = []
  const perSubject = new Map<string, number>()
  let used = 0
  let n = 0

  if (budget < 5) {
    return { day, items: [], minutes: 0, leftOut: [], note: 'No time set aside for today.' }
  }

  for (const one of options) {
    const remaining = budget - used
    if (remaining < 5) {
      leftOut.push({ title: one.title, minutes: one.minutes, why: 'No time left today.' })
      continue
    }
    // No single subject takes more than two thirds of a day unless it is the only thing there is.
    const already = perSubject.get(one.subject) ?? 0
    const cap = Math.max(input.availability.longestSession, Math.round(budget * 0.66))
    if (already >= cap && options.some((other) => other.subject !== one.subject)) {
      leftOut.push({ title: one.title, minutes: one.minutes, why: `Enough ${one.subject} for one day.` })
      continue
    }

    const minutes = Math.min(one.minutes, input.availability.longestSession, remaining)
    if (minutes < 5) {
      leftOut.push({ title: one.title, minutes: one.minutes, why: 'Not enough time left for this one.' })
      continue
    }

    // A break between sessions, once there has been a real stretch of work.
    if (items.length > 0 && input.availability.breakMinutes > 0 && used >= 45 && remaining > minutes + input.availability.breakMinutes) {
      const breakMinutes = Math.min(input.availability.breakMinutes, remaining - minutes)
      items.push({
        id: `${day}-b${n++}`,
        kind: 'break',
        minutes: breakMinutes,
        subject: null,
        chapterId: null,
        conceptId: null,
        title: 'Break',
        because: 'Stand up, look at something further away.',
        value: 0,
        forId: null,
        state: 'planned'
      })
      used += breakMinutes
    }

    items.push({
      id: `${day}-${n++}`,
      kind: one.kind,
      minutes,
      subject: one.subject || null,
      chapterId: one.chapterId,
      conceptId: one.conceptId,
      title: one.title,
      because: one.because,
      value: one.value,
      forId: one.forId,
      state: 'planned'
    })
    used += minutes
    perSubject.set(one.subject, already + minutes)
  }

  const work = items.filter((one) => one.kind !== 'break')
  return {
    day,
    items,
    minutes: used,
    leftOut: leftOut.slice(0, 8),
    note:
      work.length === 0
        ? 'Nothing to plan today.'
        : `${work.length} ${work.length === 1 ? 'thing' : 'things'}, ${used} minutes${leftOut.length > 0 ? `. ${leftOut.length} left for another day.` : '.'}`
  }
}

/** Several days ahead, each filled from what is left after the ones before it. */
export function planAhead(input: PlanInput, days: number): DayPlan[] {
  const out: DayPlan[] = []
  const today = dayKey(input.now)
  let pool = candidates(input)
  for (let i = 0; i < Math.max(1, Math.min(60, days)); i += 1) {
    const day = shiftDay(today, i)
    const plan = planDay(input, day, pool)
    out.push(plan)
    // What was planned today is not planned again tomorrow; what was left out is still available.
    const placed = new Set(plan.items.filter((one) => one.kind !== 'break').map((one) => `${one.kind}|${one.title}|${one.conceptId ?? ''}`))
    pool = pool.filter((one) => !placed.has(`${one.kind}|${one.title}|${one.conceptId ?? ''}`))
  }
  return out
}

// ---------------------------------------------------------------- when today did not happen

export interface Replan {
  days: readonly DayPlan[]
  /** What is being let go of, so nothing disappears silently. */
  dropped: readonly { title: string; why: string }[]
  /** One sentence, with no blame in it. */
  note: string
}

/**
 * The plan reshaped after a missed day.
 *
 * The missed work is **not** added on top of tomorrow. It goes back into the pool, the remaining days are filled
 * again from scratch, and whatever genuinely does not fit before its date is dropped and named. Carrying a backlog
 * forward is how a plan becomes a list of failures.
 */
export function replan(input: PlanInput, missed: readonly PlanItem[], days = 7): Replan {
  const plans = planAhead(input, days)
  const planned = new Set(plans.flatMap((one) => one.items.map((item) => `${item.kind}|${item.title}`)))
  const dropped = missed
    .filter((one) => one.kind !== 'break' && !planned.has(`${one.kind}|${one.title}`))
    .map((one) => ({ title: one.title, why: one.forId ? 'There is not time for this before its date.' : 'Something more useful came first.' }))

  const moved = missed.filter((one) => one.kind !== 'break').length - dropped.length
  return {
    days: plans,
    dropped: dropped.slice(0, 10),
    note:
      missed.length === 0
        ? 'Nothing to move.'
        : dropped.length === 0
          ? `Yesterday's work is back in the plan. Today is no heavier than usual.`
          : `${moved} ${moved === 1 ? 'thing is' : 'things are'} back in the plan. ${dropped.length} ${dropped.length === 1 ? 'did' : 'did'} not fit, so ${dropped.length === 1 ? 'it has' : 'they have'} been let go.`
  }
}

/**
 * A way back when a lot has been missed.
 *
 * Takes the time there actually is between now and the date, and fills it with the highest-value work that fits --
 * then says plainly what is not going to happen. A recovery plan that pretends everything is still achievable is
 * worse than no plan, because the student finds out on the day.
 */
export function recovery(input: PlanInput, until: string): { days: readonly DayPlan[]; honest: string; covered: number; total: number } {
  const today = dayKey(input.now)
  const span = Math.max(1, Math.min(60, (daysBetween(today, until) ?? 0) + 1))
  const pool = candidates(input)
  const total = pool.reduce((sum, one) => sum + one.minutes, 0)
  const days = planAhead(input, span)
  const covered = days.reduce((sum, day) => sum + day.items.filter((one) => one.kind !== 'break').reduce((inner, one) => inner + one.minutes, 0), 0)

  return {
    days,
    covered,
    total,
    honest:
      total === 0
        ? 'Nothing outstanding.'
        : covered >= total
          ? `There is room for all of it before ${until}.`
          : `There are ${Math.round(covered / 60)} hours available before ${until} and about ${Math.round(total / 60)} hours of work outstanding. The most useful ${Math.round((covered / total) * 100)}% is planned; the rest is not going to fit, so it has been left out rather than hidden.`
  }
}

// ---------------------------------------------------------------- the short versions

/**
 * What to do with very little time.
 *
 * The point is continuity rather than coverage: a few minutes of recall on the thing most at risk keeps a subject
 * alive. It is never presented as equivalent to a real session.
 */
export function shortPlan(input: PlanInput, minutes: number): { items: readonly PlanItem[]; note: string } {
  const budget = Math.max(1, Math.min(60, Math.round(minutes)))
  const pool = candidates(input).filter((one) => one.kind === 'revise' || one.kind === 'recall' || one.kind === 'mistakes')
  const items: PlanItem[] = []
  let used = 0
  let n = 0
  for (const one of pool) {
    const left = budget - used
    if (left < 1) break
    const take = Math.max(1, Math.min(one.minutes, left, Math.max(1, Math.round(budget / 2))))
    items.push({
      id: `short-${n++}`,
      kind: one.kind,
      minutes: take,
      subject: one.subject || null,
      chapterId: one.chapterId,
      conceptId: one.conceptId,
      title: one.title,
      because: one.because,
      value: one.value,
      forId: one.forId,
      state: 'planned'
    })
    used += take
    if (items.length >= 3) break
  }
  return {
    items,
    note: items.length === 0 ? 'Nothing is due, so a short session would not add much.' : `${budget} minutes of keeping things alive. Not a replacement for a real session.`
  }
}

// ---------------------------------------------------------------- what is coming

export interface Dated {
  id: string
  kind: 'exam' | 'deadline'
  title: string
  day: string
  daysLeft: number
  /** 0..1, how ready this looks from the mastery underneath it. Null when there is nothing to measure. */
  ready: number | null
  /** What is left, in words. */
  note: string
}

/**
 * What is coming, in the order it needs attention.
 *
 * Ordered by how much work is left against how much time there is, not simply by date -- an exam in nine days with
 * nothing done needs attention before one in four days that is ready.
 */
export function radar(input: PlanInput): Dated[] {
  const today = dayKey(input.now)
  const out: Dated[] = []

  for (const exam of input.exams) {
    const left = daysBetween(today, exam.day)
    if (left === null || left < 0) continue
    const chapters = exam.chapterIds.length > 0 ? exam.chapterIds : input.graph.chapters.filter((one) => exam.subjects.includes(one.subject)).map((one) => one.id)
    const concepts = input.graph.concepts.filter((one) => chapters.includes(one.chapterId))
    const ready = concepts.length === 0 ? null : concepts.reduce((sum, one) => sum + (input.mastery.has(one.id) ? overall(input.mastery.get(one.id) as Mastery) : 0), 0) / concepts.length
    out.push({
      id: exam.id,
      kind: 'exam',
      title: exam.name,
      day: exam.day,
      daysLeft: left,
      ready,
      note: ready === null ? 'Nothing to measure yet.' : `${Math.round(ready * 100)}% of the material is holding.`
    })
  }

  for (const one of input.deadlines) {
    const left = daysBetween(today, one.day)
    if (left === null) continue
    out.push({
      id: one.id,
      kind: 'deadline',
      title: one.title,
      day: one.day,
      daysLeft: left,
      ready: null,
      note: one.minutesLeft > 0 ? `About ${one.minutesLeft} minutes of work left.` : 'Nothing left on it.'
    })
  }

  return out.sort((a, b) => {
    // Pressure: work left over time left. Higher comes first.
    const pressure = (one: Dated): number => (1 - (one.ready ?? 0.5)) / Math.max(0.5, one.daysLeft + 1)
    return pressure(b) - pressure(a)
  })
}
