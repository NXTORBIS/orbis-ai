import { PYTHON_COURSE } from '../../shared/courses/content/python/index.ts'
import { AI_COURSE } from '../../shared/courses/content/ai/index.ts'
import { QUANTUM_COURSE } from '../../shared/courses/content/quantum/index.ts'
import type { Courses } from './service.ts'

/**
 * The courses Orbis ships with.
 *
 * ## Installed through the ordinary door
 *
 * These go through `courses.install()` like any imported course, which means they are cleaned and checked by
 * `validate.ts` before being stored. A built-in course gets no special trust: if one of them had a prerequisite
 * loop or a question with no answer, it would be refused and reported rather than quietly taught.
 *
 * ## Only when it is not already there, or has moved on
 *
 * Reinstalling on every start would rewrite the file every time Orbis opened, for nothing. It happens when the
 * course is absent, or when the version shipped is higher than the version stored — and when it does, anybody
 * already enrolled is handled by `afterVersionChange`, which keeps what they have done and tells them what moved.
 *
 * ## A failure here is never fatal
 *
 * If a course cannot be installed, Orbis starts without it and says so in the log. A broken shipped course must
 * not stop the application opening.
 */

const BUILT_IN = [PYTHON_COURSE, AI_COURSE, QUANTUM_COURSE]

export interface Installed {
  /** Courses written this time, by id. */
  added: string[]
  /** Courses already present at the same version, left alone. */
  kept: string[]
  /** Courses that could not be installed, with what was wrong. */
  refused: { id: string; says: string }[]
}

/**
 * Put the shipped courses on the shelf.
 *
 * Returns what actually happened rather than nothing, so the caller can log something true — "three courses
 * ready" and "one refused because two questions share an id" are different facts and should not read the same.
 */
export async function installBuiltInCourses(courses: Courses): Promise<Installed> {
  const out: Installed = { added: [], kept: [], refused: [] }

  const held = await courses.catalogue().catch(() => [])
  const versions = new Map(held.map((one) => [one.id, one.version]))

  for (const course of BUILT_IN) {
    const have = versions.get(course.id)
    if (have !== undefined && have >= course.version) {
      out.kept.push(course.id)
      continue
    }
    const result = await courses.install(course).catch((err: unknown) => ({
      ok: false as const,
      says: err instanceof Error ? err.message : 'It could not be installed.'
    }))
    if (result.ok) out.added.push(course.id)
    else out.refused.push({ id: course.id, says: result.says })
  }

  return out
}
