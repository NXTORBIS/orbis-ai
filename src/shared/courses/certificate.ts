/**
 * Certificates, and why most people will not get one.
 *
 * ## It has to mean something
 *
 * A certificate issued for clicking through is worth nothing, and worse, it makes every other certificate Orbis
 * issues worth nothing too. So one is only ever produced when the course's own completion rules are met in full,
 * and it carries what was actually achieved — lessons done out of lessons total, the average quiz score, the
 * assessment result — so the claim on it can be checked against the record behind it.
 *
 * ## It survives the course changing
 *
 * The version is on the certificate. A course updated afterwards does not invalidate what somebody did, and does
 * not quietly upgrade it either: the certificate says which version was passed.
 *
 * ## The id is derived, not random
 *
 * Built from the profile, the course and the version, so re-issuing produces the same id rather than a second
 * certificate for the same achievement.
 */

import { canComplete, lessonsOf } from './progress.ts'
import { bestScore, hasPassed } from './quiz.ts'
import type { Certificate, Course, Enrollment } from './types.ts'

/** A short, stable id from the things that identify the achievement. No clock, so it never changes. */
export function certificateId(profileId: string, courseId: string, version: number): string {
  const seed = `${profileId}:${courseId}:v${version}`
  let hash = 2_166_136_261
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16_777_619)
  }
  const stamp = (hash >>> 0).toString(36).toUpperCase().padStart(7, '0')
  return `ORB-${courseId.slice(0, 6).toUpperCase().replace(/[^A-Z0-9]/g, '')}-${stamp}`
}

export interface Eligibility {
  eligible: boolean
  /** Everything still in the way, in words. Shown instead of a disabled button with no explanation. */
  unmet: { what: string; says: string }[]
  says: string
}

export function eligibleFor(course: Course, enrollment: Enrollment, now: number): Eligibility {
  if (!course.certificate) {
    return { eligible: false, unmet: [], says: 'This course does not issue a certificate.' }
  }
  const { can, unmet } = canComplete(course, enrollment, now)
  return {
    eligible: can,
    unmet: unmet.map((one) => ({ what: one.what, says: one.says })),
    says: can ? 'Everything is done — the certificate is ready.' : 'Not everything is finished yet.'
  }
}

/**
 * The certificate for a finished course.
 *
 * Returns null when the rules are not met. There is deliberately no way to force one: a certificate that can be
 * issued regardless of the record is a certificate that says nothing about the record.
 */
export function issue(
  course: Course,
  enrollment: Enrollment,
  learnerName: string,
  now: number,
  issuer = 'Orbis'
): Certificate | null {
  if (!eligibleFor(course, enrollment, now).eligible) return null

  const lessons = lessonsOf(course)
  const done = lessons.filter((one) => enrollment.lessons.some((two) => two.lessonId === one.id && two.state === 'done')).length

  const moduleScores = course.modules
    .filter((one) => one.lessons.length > 0)
    .map((one) => bestScore(enrollment.quizzes, one.id))
    .filter((one) => one > 0)
  const averageQuiz = moduleScores.length === 0 ? 0 : moduleScores.reduce((sum, one) => sum + one, 0) / moduleScores.length

  const assessmentScore = course.assessment && hasPassed(enrollment.quizzes, course.assessment.id) ? bestScore(enrollment.quizzes, course.assessment.id) : null

  return {
    id: certificateId(enrollment.profileId, course.id, course.version),
    courseId: course.id,
    courseTitle: course.title,
    courseVersion: course.version,
    profileId: enrollment.profileId,
    // Trimmed, and never empty: a certificate with a blank name on it is embarrassing to show anybody.
    learnerName: learnerName.trim().slice(0, 120) || 'Learner',
    issuedAt: now,
    lessonsDone: done,
    lessonsTotal: lessons.length,
    averageQuiz,
    assessmentScore,
    issuer
  }
}

/** What the certificate says, in words, for the card and for a screen reader. */
export function describeCertificate(one: Certificate): string {
  const bits = [`${one.lessonsDone} of ${one.lessonsTotal} lessons`]
  if (one.averageQuiz > 0) bits.push(`${Math.round(one.averageQuiz * 100)}% average on the quizzes`)
  if (one.assessmentScore !== null) bits.push(`${Math.round(one.assessmentScore * 100)}% in the final assessment`)
  return `${one.courseTitle} — ${bits.join(', ')}.`
}
