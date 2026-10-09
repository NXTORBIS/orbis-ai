/**
 * How far through a course somebody is, and whether they have finished it.
 *
 * ## Progress counts work, not pages turned
 *
 * The number on the dashboard is lessons actually completed, quizzes actually passed and mastery actually
 * measured — weighted. A bar that fills because somebody pressed Next is the single easiest thing to build here
 * and the single most dishonest.
 *
 * ## Finishing is a course's own decision
 *
 * One course needs a project, another a final assessment, another neither. The rules live with the course and
 * `canComplete` reports every unmet one in words, so "why can't I finish?" always has an answer on screen rather
 * than a disabled button.
 */

import { faded, overall } from './mastery.ts'
import { bestScore, hasPassed } from './quiz.ts'
import type { Course, Enrollment, Lesson, LessonProgress, MasteryRecord, Module } from './types.ts'

/** What a lesson is worth towards the course, before anything else. */
export const XP = {
  lesson: 10,
  practice: 15,
  quizPassed: 25,
  challenge: 40,
  project: 100,
  assessment: 150,
  course: 500,
  /** Going back over something and getting it right. Small, and real. */
  revision: 8
}

export function lessonsOf(course: Course): Lesson[] {
  return course.modules.flatMap((one) => one.lessons)
}

export function moduleOf(course: Course, lessonId: string): Module | null {
  return course.modules.find((one) => one.lessons.some((two) => two.id === lessonId)) ?? null
}

export function lessonById(course: Course, lessonId: string): Lesson | null {
  for (const one of course.modules) {
    const found = one.lessons.find((two) => two.id === lessonId)
    if (found) return found
  }
  return null
}

export function progressOf(enrollment: Enrollment, lessonId: string): LessonProgress | null {
  return enrollment.lessons.find((one) => one.lessonId === lessonId) ?? null
}

export function isDone(enrollment: Enrollment, lessonId: string): boolean {
  return progressOf(enrollment, lessonId)?.state === 'done'
}

export interface ModuleProgress {
  moduleId: string
  title: string
  lessons: number
  done: number
  /** 0..1 across the module's lessons. */
  share: number
  quizPassed: boolean
  quizBest: number
  state: 'not-started' | 'in-progress' | 'done'
}

export function moduleProgress(course: Course, enrollment: Enrollment, module: Module): ModuleProgress {
  const done = module.lessons.filter((one) => isDone(enrollment, one.id)).length
  const quizPassed = hasPassed(enrollment.quizzes, module.id)
  const share = module.lessons.length === 0 ? 0 : done / module.lessons.length
  return {
    moduleId: module.id,
    title: module.title,
    lessons: module.lessons.length,
    done,
    share,
    quizPassed,
    quizBest: bestScore(enrollment.quizzes, module.id),
    state: done === 0 ? 'not-started' : share >= 1 && (quizPassed || course.completion.requiredQuizzes.length > 0) ? 'done' : 'in-progress'
  }
}

/**
 * How far through the course, 0..1.
 *
 * Three parts, weighted. Lessons are most of it because they are most of the work; quizzes matter because they
 * are the part that proves something; mastery is folded in last so a course read end to end without any of it
 * sticking does not read as finished.
 */
export function courseProgress(course: Course, enrollment: Enrollment, now: number): number {
  const lessons = lessonsOf(course)
  if (lessons.length === 0) return 0
  const doneShare = lessons.filter((one) => isDone(enrollment, one.id)).length / lessons.length

  const quizzable = course.modules.filter((one) => one.lessons.length > 0)
  const quizShare = quizzable.length === 0 ? doneShare : quizzable.filter((one) => hasPassed(enrollment.quizzes, one.id)).length / quizzable.length

  const records = Object.values(enrollment.mastery)
  const masteryShare = records.length === 0 ? 0 : overall(records, now)

  return Math.max(0, Math.min(1, doneShare * 0.6 + quizShare * 0.25 + masteryShare * 0.15))
}

export interface Unmet {
  what: string
  /** What to do about it, in words, next to a way of doing it. */
  says: string
  action?: { id: string; label: string }
}

/** Whether the course can be finished, and everything standing in the way. */
export function canComplete(course: Course, enrollment: Enrollment, now: number): { can: boolean; unmet: Unmet[] } {
  const rules = course.completion
  const lessons = lessonsOf(course)
  const unmet: Unmet[] = []

  const required = lessons.filter((one) => one.required)
  const requiredDone = required.filter((one) => isDone(enrollment, one.id))
  if (rules.requiredLessons && requiredDone.length < required.length) {
    const left = required.length - requiredDone.length
    unmet.push({
      what: 'lessons',
      says: `${left} ${left === 1 ? 'lesson' : 'lessons'} still to do.`,
      action: { id: 'continue', label: 'Carry on' }
    })
  }

  const doneShare = lessons.length === 0 ? 0 : lessons.filter((one) => isDone(enrollment, one.id)).length / lessons.length
  if (doneShare < rules.lessonShare - 0.001) {
    unmet.push({ what: 'coverage', says: `${Math.round(rules.lessonShare * 100)}% of the course needs to be covered.`, action: { id: 'continue', label: 'Carry on' } })
  }

  // Named quizzes, or every module's quiz when the course names none.
  const needed = rules.requiredQuizzes.length > 0 ? rules.requiredQuizzes : course.modules.filter((one) => one.lessons.length > 0).map((one) => one.id)
  const failing = needed.filter((one) => !hasPassed(enrollment.quizzes, one))
  if (failing.length > 0) {
    unmet.push({
      what: 'quizzes',
      says: `${failing.length} ${failing.length === 1 ? 'quiz' : 'quizzes'} still to pass at ${Math.round(rules.quizPass * 100)}%.`,
      action: { id: 'quiz', label: 'Take it' }
    })
  }

  if (rules.needsAssessment && course.assessment && !hasPassed(enrollment.quizzes, course.assessment.id)) {
    unmet.push({ what: 'assessment', says: 'The final assessment is still to pass.', action: { id: 'assessment', label: 'Start it' } })
  }

  if (rules.masteryAtLeast !== null) {
    const score = overall(Object.values(enrollment.mastery), now)
    if (score < rules.masteryAtLeast) {
      unmet.push({ what: 'mastery', says: 'A few concepts still need to stick. Some practice will do it.', action: { id: 'practise', label: 'Practise' } })
    }
  }

  for (const projectId of rules.requiredProjects) {
    const done = enrollment.projects.find((one) => one.projectId === projectId)?.doneAt
    if (!done) unmet.push({ what: 'project', says: 'The project is still to finish.', action: { id: 'project', label: 'Open it' } })
  }

  return { can: unmet.length === 0, unmet }
}

/**
 * The next thing to do.
 *
 * Where they stopped, if they stopped mid-lesson. Otherwise the first unfinished lesson in course order, and
 * after that whatever the completion rules are still waiting on — so the answer is never "nothing" while the
 * course is unfinished.
 */
export function nextUp(
  course: Course,
  enrollment: Enrollment,
  now: number
): { kind: 'lesson' | 'quiz' | 'assessment' | 'project' | 'done'; id: string; title: string; says: string } {
  if (enrollment.at) {
    const lesson = lessonById(course, enrollment.at.lessonId)
    if (lesson && !isDone(enrollment, lesson.id)) {
      return { kind: 'lesson', id: lesson.id, title: lesson.title, says: 'Where you stopped' }
    }
  }

  for (const module of course.modules) {
    for (const lesson of module.lessons) {
      if (!isDone(enrollment, lesson.id)) return { kind: 'lesson', id: lesson.id, title: lesson.title, says: module.title }
    }
    // Every lesson in the module done, but its quiz not passed: the quiz is next.
    if (module.lessons.length > 0 && !hasPassed(enrollment.quizzes, module.id)) {
      return { kind: 'quiz', id: module.id, title: `${module.title} quiz`, says: 'Everything in this module is read' }
    }
  }

  if (course.assessment && course.completion.needsAssessment && !hasPassed(enrollment.quizzes, course.assessment.id)) {
    return { kind: 'assessment', id: course.assessment.id, title: course.assessment.title, says: 'The last thing' }
  }

  for (const projectId of course.completion.requiredProjects) {
    if (!enrollment.projects.find((one) => one.projectId === projectId)?.doneAt) {
      return { kind: 'project', id: projectId, title: 'Project', says: 'The practical part' }
    }
  }

  const { can } = canComplete(course, enrollment, now)
  return can ? { kind: 'done', id: course.id, title: course.title, says: 'Finished' } : { kind: 'lesson', id: '', title: '', says: 'Nothing left in order' }
}

/** XP for finishing a lesson, which is more for a longer and harder one. */
export function lessonXp(lesson: Lesson): number {
  const byDifficulty = { beginner: 1, intermediate: 1.2, advanced: 1.5, expert: 1.8 }[lesson.difficulty]
  const byLength = Math.min(2, Math.max(0.6, lesson.minutes / 10))
  return Math.round(XP.lesson * byDifficulty * byLength)
}

/** What a course is worth all told, so a detail page can say so before anybody starts. */
export function courseXp(course: Course): number {
  const lessons = lessonsOf(course).reduce((sum, one) => sum + lessonXp(one), 0)
  const quizzes = course.modules.filter((one) => one.lessons.length > 0).length * XP.quizPassed
  const assessment = course.assessment ? XP.assessment : 0
  const projects = course.completion.requiredProjects.length * XP.project
  return lessons + quizzes + assessment + projects + XP.course
}

/** Minutes, from the lessons themselves rather than a number somebody typed. */
export function estimateMinutes(course: Course): number {
  const lessons = lessonsOf(course).reduce((sum, one) => sum + Math.max(1, one.minutes), 0)
  const quizzes = course.modules.filter((one) => one.lessons.length > 0).length * 6
  const assessment = course.assessment?.minutes ?? (course.assessment ? 25 : 0)
  return lessons + quizzes + assessment
}

/** The record after a lesson is marked done. Idempotent: finishing twice is finishing once. */
export function markLessonDone(enrollment: Enrollment, lessonId: string, now: number, seconds: number): Enrollment {
  const held = progressOf(enrollment, lessonId)
  if (held?.state === 'done') return enrollment
  const next: LessonProgress = held
    ? { ...held, state: 'done', doneAt: now, seconds: held.seconds + seconds, visits: held.visits }
    : { lessonId, state: 'done', atBlock: 0, seconds, startedAt: now, doneAt: now, visits: 1 }
  return {
    ...enrollment,
    lessons: held ? enrollment.lessons.map((one) => (one.lessonId === lessonId ? next : one)) : [...enrollment.lessons, next],
    lastAt: now,
    seconds: enrollment.seconds + seconds
  }
}

/** Where somebody is, written down so closing Orbis does not lose their place. */
export function markAt(enrollment: Enrollment, moduleId: string, lessonId: string, block: number, now: number): Enrollment {
  const held = progressOf(enrollment, lessonId)
  const lessons = held
    ? enrollment.lessons.map((one) => (one.lessonId === lessonId ? { ...one, atBlock: Math.max(one.atBlock, block), state: one.state === 'done' ? ('done' as const) : ('reading' as const) } : one))
    : [...enrollment.lessons, { lessonId, state: 'reading' as const, atBlock: block, seconds: 0, startedAt: now, doneAt: null, visits: 1 }]
  return { ...enrollment, lessons, at: { moduleId, lessonId, block }, lastAt: now }
}

export function newEnrollment(course: Course, profileId: string, now: number): Enrollment {
  const mastery: Record<string, MasteryRecord> = {}
  return {
    courseId: course.id,
    courseVersion: course.version,
    profileId,
    startedAt: now,
    lastAt: now,
    at: null,
    lessons: [],
    quizzes: [],
    attempts: [],
    mastery,
    projects: [],
    completedAt: null,
    certificateId: null,
    seconds: 0,
    archived: false
  }
}

/**
 * What a course version change means for somebody part way through.
 *
 * Progress is kept and never silently discarded. Lessons that no longer exist simply stop counting; everything
 * else carries over. Losing somebody's work because a typo was fixed in lesson nine would be unforgivable.
 */
export function afterVersionChange(enrollment: Enrollment, course: Course): { enrollment: Enrollment; says: string | null } {
  if (enrollment.courseVersion === course.version) return { enrollment, says: null }
  const known = new Set(lessonsOf(course).map((one) => one.id))
  const kept = enrollment.lessons.filter((one) => known.has(one.lessonId))
  const lost = enrollment.lessons.length - kept.length
  return {
    enrollment: {
      ...enrollment,
      courseVersion: course.version,
      lessons: kept,
      at: enrollment.at && known.has(enrollment.at.lessonId) ? enrollment.at : null
    },
    says:
      lost > 0
        ? `This course has been updated. Your progress is kept; ${lost} ${lost === 1 ? 'lesson' : 'lessons'} you had done ${lost === 1 ? 'is' : 'are'} no longer part of it.`
        : 'This course has been updated. Your progress is kept.'
  }
}

/** Mastery across the course, for the detail page. */
export function masteryOf(enrollment: Enrollment, now: number): { score: number; records: MasteryRecord[] } {
  const records = Object.values(enrollment.mastery)
  return { score: overall(records, now), records: records.sort((a, b) => faded(a, now) - faded(b, now)) }
}
