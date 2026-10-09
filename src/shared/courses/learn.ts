/**
 * Revision, adaptation, practice and recommendations — the parts that make a course respond to the person.
 *
 * ## Revision is offered, never imposed
 *
 * Nothing here puts a task on somebody's list. It works out what is worth going over and when, and hands that to
 * whatever is deciding what to show. A course that fills a queue with overdue reviews is a course people stop
 * opening, because the queue is the first thing they see and it is always an accusation.
 *
 * ## Adaptation is small and reversible
 *
 * Difficulty moves one step at a time and comes back the moment somebody is coping. A system that reacts hard to
 * two wrong answers teaches people to be afraid of guessing, which is the opposite of what practice is for.
 *
 * ## Recommendations are few
 *
 * Three at most, each with a reason. A wall of suggestions is a wall, and nobody reads it.
 */

import { NEEDS, faded } from './mastery.ts'
import { worthOf, type Graph } from './graph.ts'
import type { Course, CourseSummary, Difficulty, Enrollment, MasteryRecord } from './types.ts'

// ---------------------------------------------------------------- revision

/**
 * How long until a concept is worth seeing again.
 *
 * Doubling-ish, and stretched by how well it is known: something solid comes back in a fortnight, something shaky
 * tomorrow. The first few gaps are short because that is when forgetting is fastest.
 */
export const GAPS_DAYS = [1, 3, 7, 14, 30, 60]

export function nextReview(record: MasteryRecord, now: number): number {
  const step = Math.min(GAPS_DAYS.length - 1, record.reviews)
  const base = GAPS_DAYS[step]
  // Known well: wait longer. Shaky: come back sooner, but never sooner than a few hours.
  const stretch = 0.4 + record.score * 1.2
  return now + Math.max(4 * 3_600_000, base * stretch * 86_400_000)
}

export interface Due {
  concept: string
  name: string
  score: number
  /** How overdue, in days. Negative means not yet. */
  overdueDays: number
  /** Why it is worth doing, in words. */
  says: string
}

/**
 * What is worth going over now.
 *
 * Sorted by what it costs to have forgotten — weak and important first — rather than purely by how overdue it is.
 * Strict ordering by date sends people to a trivial concept they happened to learn first.
 */
export function dueForReview(
  enrollment: Enrollment,
  graph: Graph,
  now: number,
  most = 6
): Due[] {
  const out: Due[] = []
  for (const record of Object.values(enrollment.mastery)) {
    if (record.seen === 0) continue
    const score = faded(record, now)
    // Already solid and not yet due: leave it alone.
    const due = record.reviewAt ?? nextReview(record, record.lastAt)
    if (now < due && score >= NEEDS.applied.score) continue
    const concept = graph.concepts.get(record.concept)
    if (!concept) continue
    const overdueDays = (now - due) / 86_400_000
    out.push({
      concept: record.concept,
      name: concept.name,
      score,
      overdueDays,
      says: score < NEEDS.recalled.score ? 'Worth a proper look' : overdueDays > 0 ? 'Due for a review' : 'Nearly due'
    })
  }
  return out
    .sort((a, b) => {
      const costA = (1 - a.score) * worthOf(graph, a.concept) + Math.max(0, a.overdueDays) * 0.02
      const costB = (1 - b.score) * worthOf(graph, b.concept) + Math.max(0, b.overdueDays) * 0.02
      return costB - costA
    })
    .slice(0, most)
}

// ---------------------------------------------------------------- adapting

export const LADDER: readonly Difficulty[] = ['beginner', 'intermediate', 'advanced', 'expert']

export interface Coping {
  /** The last few answers, newest last. */
  recent: readonly boolean[]
  hintsUsed: number
}

/**
 * Whether to move the difficulty, and which way.
 *
 * Three right in a row with no hints moves up; two wrong in a row moves down. Both deliberately quick to reverse:
 * the point is to keep somebody at the edge of what they can do, not to make a judgement about them.
 */
export function adapt(current: Difficulty, coping: Coping): { next: Difficulty; moved: 'up' | 'down' | 'same'; says: string } {
  const at = Math.max(0, LADDER.indexOf(current))
  const last3 = coping.recent.slice(-3)
  const last2 = coping.recent.slice(-2)

  if (last3.length === 3 && last3.every(Boolean) && coping.hintsUsed === 0 && at < LADDER.length - 1) {
    return { next: LADDER[at + 1], moved: 'up', says: 'These are going well — here is a harder one.' }
  }
  if (last2.length === 2 && last2.every((one) => !one) && at > 0) {
    return { next: LADDER[at - 1], moved: 'down', says: 'Let us take a step back and build it up again.' }
  }
  return { next: current, moved: 'same', says: '' }
}

/**
 * What to say when somebody is struggling.
 *
 * Never about them. Each of these is about the work, and each comes with something to do.
 */
export function helpFor(wrongRun: number): { says: string; offer: { id: string; label: string }[] } | null {
  if (wrongRun < 2) return null
  if (wrongRun === 2) {
    return {
      says: 'This one is not landing yet.',
      offer: [
        { id: 'hint', label: 'Give me a hint' },
        { id: 'explain', label: 'Explain it again' }
      ]
    }
  }
  return {
    says: 'Let us come at this differently.',
    offer: [
      { id: 'simpler', label: 'Show me a simpler version' },
      { id: 'teach', label: 'Teach me this' },
      { id: 'back', label: 'Go back to the lesson' }
    ]
  }
}

// ---------------------------------------------------------------- practice

export type PracticeKind = 'concept' | 'mixed' | 'weak' | 'revision' | 'challenge'

export interface PracticePlan {
  kind: PracticeKind
  concepts: string[]
  /** How many questions to ask. */
  count: number
  difficulty: Difficulty
  says: string
}

/** What a practice session should be about, from what the learner actually needs. */
export function planPractice(
  enrollment: Enrollment,
  graph: Graph,
  now: number,
  options: { kind?: PracticeKind; concept?: string; minutes?: number } = {}
): PracticePlan {
  const minutes = options.minutes ?? 10
  const count = Math.max(3, Math.min(20, Math.round(minutes * 1.2)))

  if (options.kind === 'concept' && options.concept) {
    const name = graph.concepts.get(options.concept)?.name ?? 'this'
    return { kind: 'concept', concepts: [options.concept], count, difficulty: 'intermediate', says: `${count} questions on ${name}.` }
  }

  const records = Object.values(enrollment.mastery).filter((one) => one.seen > 0)
  const weak = records
    .filter((one) => faded(one, now) < NEEDS.applied.score)
    .sort((a, b) => faded(a, now) - faded(b, now))
    .slice(0, 4)
    .map((one) => one.concept)

  if (options.kind === 'weak' || (weak.length > 0 && !options.kind)) {
    return {
      kind: 'weak',
      concepts: weak,
      count,
      difficulty: 'intermediate',
      says: weak.length > 0 ? `${count} questions on the bits that need work.` : `${count} mixed questions.`
    }
  }

  if (options.kind === 'revision') {
    const due = dueForReview(enrollment, graph, now, 5).map((one) => one.concept)
    return { kind: 'revision', concepts: due, count, difficulty: 'intermediate', says: `Going back over ${due.length} ${due.length === 1 ? 'thing' : 'things'}.` }
  }

  if (options.kind === 'challenge') {
    const strong = records.filter((one) => faded(one, now) >= NEEDS.applied.score).map((one) => one.concept)
    return { kind: 'challenge', concepts: strong, count: Math.min(count, 8), difficulty: 'advanced', says: 'Harder questions on what you already know.' }
  }

  return { kind: 'mixed', concepts: records.map((one) => one.concept), count, difficulty: 'intermediate', says: `${count} mixed questions.` }
}

// ---------------------------------------------------------------- what to do next

export interface Suggestion {
  courseId: string
  title: string
  /** Why this one, in words. A recommendation without a reason is noise. */
  because: string
  score: number
}

/**
 * A few courses worth doing next.
 *
 * Scored from what somebody has actually finished and what they are weak in, never from popularity — there is no
 * popularity here, and inventing one would be inventing data.
 */
export function recommend(
  catalogue: readonly CourseSummary[],
  enrollments: readonly Enrollment[],
  options: { interests?: readonly string[]; weakSubjects?: readonly string[]; most?: number } = {}
): Suggestion[] {
  const started = new Set(enrollments.map((one) => one.courseId))
  const finished = enrollments.filter((one) => one.completedAt !== null)
  const finishedTags = new Set(
    finished.flatMap((one) => catalogue.find((two) => two.id === one.courseId)?.tags ?? [])
  )
  const finishedCategories = new Set(
    finished.map((one) => catalogue.find((two) => two.id === one.courseId)?.category).filter((one): one is string => !!one)
  )
  const interests = new Set((options.interests ?? []).map((one) => one.toLowerCase()))
  const weak = new Set((options.weakSubjects ?? []).map((one) => one.toLowerCase()))

  const out: Suggestion[] = []
  for (const course of catalogue) {
    if (started.has(course.id)) continue
    let score = 0
    const why: string[] = []

    if (finishedCategories.has(course.category)) {
      score += 0.45
      why.push(`follows on from the ${course.category.toLowerCase()} you have finished`)
    }
    const sharedTags = course.tags.filter((one) => finishedTags.has(one))
    if (sharedTags.length > 0) {
      score += Math.min(0.3, sharedTags.length * 0.12)
      why.push(`same ground as what you have done`)
    }
    if (interests.has(course.category.toLowerCase()) || course.tags.some((one) => interests.has(one.toLowerCase()))) {
      score += 0.35
      why.push('something you said you are interested in')
    }
    if (weak.has(course.category.toLowerCase())) {
      score += 0.4
      why.push('an area you have been finding hard')
    }
    // A beginner course after finishing nothing is a reasonable place to start.
    if (finished.length === 0 && course.difficulty === 'beginner') {
      score += 0.2
      why.push('a good place to start')
    }

    if (score <= 0) continue
    out.push({ courseId: course.id, title: course.title, because: why[0] ?? 'might suit you', score })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, options.most ?? 3)
}

/** Everything a course can contribute to the rest of Orbis, so nothing has to reach into this. */
export interface LearningSignals {
  /** The course being learned now, when there is one. */
  current: { courseId: string; title: string; lessonId: string | null; lessonTitle: string | null } | null
  /** Concepts due for review, across every course. */
  dueCount: number
  /** Concepts that keep going wrong. */
  weak: string[]
  /** Courses untouched for a while that are not finished. */
  stale: { courseId: string; title: string; daysAway: number }[]
  /** A module that is nearly done, which is the most useful nudge there is. */
  nearlyDone: { courseId: string; title: string; left: number } | null
}

export function signalsFrom(
  courses: readonly Course[],
  enrollments: readonly Enrollment[],
  now: number
): LearningSignals {
  const live = enrollments.filter((one) => !one.archived && one.completedAt === null)
  const newest = [...live].sort((a, b) => b.lastAt - a.lastAt)[0] ?? null
  const course = newest ? courses.find((one) => one.id === newest.courseId) ?? null : null

  const weakAll = new Set<string>()
  for (const one of live) {
    for (const record of Object.values(one.mastery)) {
      if (record.seen > 0 && faded(record, now) < NEEDS.recalled.score) weakAll.add(record.concept)
    }
  }

  let due = 0
  for (const one of live) {
    for (const record of Object.values(one.mastery)) {
      if (record.seen === 0) continue
      const at = record.reviewAt ?? nextReview(record, record.lastAt)
      if (now >= at) due += 1
    }
  }

  const stale = live
    .filter((one) => now - one.lastAt > 5 * 86_400_000)
    .map((one) => ({
      courseId: one.courseId,
      title: courses.find((two) => two.id === one.courseId)?.title ?? 'A course',
      daysAway: Math.floor((now - one.lastAt) / 86_400_000)
    }))
    .sort((a, b) => a.daysAway - b.daysAway)
    .slice(0, 2)

  let nearlyDone: LearningSignals['nearlyDone'] = null
  for (const enrollment of live) {
    const found = courses.find((one) => one.id === enrollment.courseId)
    if (!found) continue
    for (const module of found.modules) {
      const left = module.lessons.filter((one) => !enrollment.lessons.some((two) => two.lessonId === one.id && two.state === 'done')).length
      if (left > 0 && left <= 2) {
        nearlyDone = { courseId: found.id, title: module.title, left }
        break
      }
    }
    if (nearlyDone) break
  }

  const lesson = course && newest?.at ? course.modules.flatMap((one) => one.lessons).find((one) => one.id === newest.at?.lessonId) ?? null : null

  return {
    current: course ? { courseId: course.id, title: course.title, lessonId: lesson?.id ?? null, lessonTitle: lesson?.title ?? null } : null,
    dueCount: due,
    weak: [...weakAll].slice(0, 8),
    stale,
    nearlyDone
  }
}
