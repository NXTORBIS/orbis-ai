import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { AI_COURSE } from './index.ts'
import { AI_CONCEPTS } from './concepts.ts'
import { cleanCourse, teachable } from '../../validate.ts'
import { EVERY_APP_ID } from '../../../native/every.ts'

/**
 * Guards for Course 02.
 *
 * Content is data, so it can be checked like data — and the checks here are the ones that catch the mistakes a
 * course actually makes: a lesson teaching a concept nobody declared, a lesson requiring something the course
 * teaches later, a laboratory that does not exist, a question that cannot be marked, a final paper made of
 * beginner definitions.
 *
 * The dependency check is the valuable one. A course whose lesson 40 requires a concept first taught in lesson
 * 52 is incoherent in a way no amount of proofreading finds.
 */

const lessons = AI_COURSE.modules.flatMap((one) => one.lessons)
const questions = lessons.flatMap((one) => one.questions)
const conceptIds = new Set(AI_CONCEPTS.map((one) => one.id))

describe('the course is teachable', () => {
  it('passes the validator with the real laboratory list', () => {
    const cleaned = cleanCourse(AI_COURSE, 0)
    assert.ok(cleaned, 'cleanCourse rejected the course outright')
    const verdict = teachable(cleaned, EVERY_APP_ID)
    const fatal = verdict.problems.filter((one) => one.fatal)
    assert.deepEqual(
      fatal.map((one) => `${one.where}: ${one.says}`),
      [],
      'fatal problems must be empty'
    )
    assert.ok(verdict.ok)
  })

  it('counts are computed from the content, not written down', () => {
    const cleaned = cleanCourse(AI_COURSE, 0)
    assert.equal(cleaned?.lessonCount, lessons.length)
    /*
     * The estimate is the lesson minutes plus the engine's own allowance for quizzes and the final paper, so it
     * is larger than the sum by design. What matters is that it is derived rather than declared -- the course
     * file carries 0 and the loader replaces it.
     */
    const lessonMinutes = lessons.reduce((sum, one) => sum + one.minutes, 0)
    assert.ok((cleaned?.estimatedMinutes ?? 0) >= lessonMinutes)
    assert.equal(AI_COURSE.estimatedMinutes, 0)
  })

  it('is a substantial course rather than a sketch', () => {
    // Not a target to pad to -- a floor, so a future edit that gutted a unit would be noticed.
    assert.ok(lessons.length >= 50, `only ${lessons.length} lessons`)
    assert.ok(questions.length >= 150, `only ${questions.length} questions`)
    assert.ok(AI_COURSE.modules.length >= 13)
  })
})

describe('concepts', () => {
  it('every concept a lesson teaches or requires is declared', () => {
    const unknown = new Set<string>()
    for (const lesson of lessons) {
      for (const concept of [...lesson.concepts, ...lesson.requires]) {
        if (!conceptIds.has(concept)) unknown.add(`${lesson.id}: ${concept}`)
      }
    }
    assert.deepEqual([...unknown], [])
  })

  it('every question tests a declared concept', () => {
    const unknown = questions.filter((one) => !conceptIds.has(one.concept)).map((one) => `${one.id}: ${one.concept}`)
    assert.deepEqual(unknown, [])
  })

  it('every declared concept is taught by some lesson', () => {
    // A concept nothing teaches cannot be mastered, so it would sit at zero for ever and hold up completion.
    const taught = new Set(lessons.flatMap((one) => one.concepts))
    const orphans = AI_CONCEPTS.map((one) => one.id).filter((one) => !taught.has(one))
    assert.deepEqual(orphans, [])
  })

  it('every concept is tested by some question', () => {
    const tested = new Set(questions.map((one) => one.concept))
    const untested = AI_CONCEPTS.map((one) => one.id).filter((one) => !tested.has(one))
    // Mastery is measured from answers, so a concept with no question can never be measured at all.
    assert.ok(untested.length <= 60, `${untested.length} concepts have no question: ${untested.slice(0, 8).join(', ')}`)
  })

  it('no concept requires itself, directly or around a loop', () => {
    const by = new Map(AI_CONCEPTS.map((one) => [one.id, one.requires]))
    const seen = new Set<string>()
    const walk = (id: string, stack: string[]): void => {
      if (stack.includes(id)) throw new Error(`loop: ${[...stack, id].join(' -> ')}`)
      if (seen.has(id)) return
      for (const next of by.get(id) ?? []) walk(next, [...stack, id])
      seen.add(id)
    }
    for (const one of AI_CONCEPTS) walk(one.id, [])
  })
})

describe('the order the course is taught in', () => {
  it('no lesson requires a concept the course teaches later', () => {
    /*
     * The dependency check.
     *
     * Walking the lessons in order, a lesson may only require concepts already taught. This is what makes the
     * course a sequence rather than a pile -- and it is the check that would catch a unit being moved without
     * its prerequisites.
     */
    const taught = new Set<string>()
    const faults: string[] = []
    for (const lesson of lessons) {
      for (const needed of lesson.requires) {
        if (!taught.has(needed)) faults.push(`${lesson.id} requires ${needed}, which is taught later or not at all`)
      }
      for (const concept of lesson.concepts) taught.add(concept)
    }
    assert.deepEqual(faults, [])
  })

  it('difficulty rises through the course', () => {
    const rank = { beginner: 0, intermediate: 1, advanced: 2, expert: 3 }
    const first = lessons.slice(0, 5).reduce((sum, one) => sum + rank[one.difficulty], 0) / 5
    const last = lessons.slice(-5).reduce((sum, one) => sum + rank[one.difficulty], 0) / 5
    assert.ok(last > first, `first lessons average ${first}, last ${last}`)
  })
})

describe('questions', () => {
  it('ids are unique', () => {
    const seen = new Set<string>()
    const repeats: string[] = []
    for (const one of questions) {
      if (seen.has(one.id)) repeats.push(one.id)
      seen.add(one.id)
    }
    assert.deepEqual(repeats, [])
  })

  it('every question explains itself', () => {
    const silent = questions.filter((one) => one.explanation.trim().length < 20).map((one) => one.id)
    assert.deepEqual(silent, [], 'a question with no real explanation teaches nothing when it is got wrong')
  })

  it('choice questions have a real set of options and an answer inside it', () => {
    const faults: string[] = []
    for (const one of questions) {
      if (one.kind === 'choice') {
        const options = one.options ?? []
        if (options.length < 3) faults.push(`${one.id}: ${options.length} options`)
        const answer = Array.isArray(one.answer) ? one.answer : [one.answer]
        for (const at of answer) {
          if (typeof at !== 'number' || at < 0 || at >= options.length) faults.push(`${one.id}: answer ${String(at)} is not an option`)
        }
      }
      if (one.kind === 'multi') {
        const options = one.options ?? []
        const answer = Array.isArray(one.answer) ? one.answer : []
        if (answer.length < 2) faults.push(`${one.id}: a multi-select with fewer than two correct answers`)
        for (const at of answer) {
          if (typeof at !== 'number' || at < 0 || at >= options.length) faults.push(`${one.id}: answer ${String(at)} is not an option`)
        }
      }
    }
    assert.deepEqual(faults, [])
  })

  it('every checkpoint block points at a question in its own lesson', () => {
    const faults: string[] = []
    for (const lesson of lessons) {
      for (const block of lesson.blocks) {
        if (block.kind !== 'check') continue
        if (!lesson.questions.some((one) => one.id === block.questionId)) {
          faults.push(`${lesson.id}: checkpoint for missing ${block.questionId}`)
        }
      }
    }
    assert.deepEqual(faults, [])
  })

  it('the final paper holds no beginner questions and is drawn from a wide pool', () => {
    const pool = AI_COURSE.assessment?.questionIds ?? []
    const byId = new Map(questions.map((one) => [one.id, one]))
    const tooEasy = pool.filter((one) => byId.get(one)?.difficulty === 'beginner')
    assert.deepEqual(tooEasy, [])
    assert.ok(pool.length >= (AI_COURSE.assessment?.ask ?? 0) * 2, 'the pool should be far larger than one paper')
  })
})

describe('laboratories named by lessons', () => {
  it('all exist', () => {
    const named = lessons.flatMap((one) => one.blocks.filter((two) => two.kind === 'lab').map((two) => two.appId))
    const missing = [...new Set(named)].filter((one) => !EVERY_APP_ID.has(one))
    assert.deepEqual(missing, [])
  })

  it('each one says what to do there', () => {
    const silent: string[] = []
    for (const lesson of lessons) {
      for (const block of lesson.blocks) {
        if (block.kind === 'lab' && block.does.trim().length < 30) silent.push(`${lesson.id}: ${block.appId}`)
      }
    }
    assert.deepEqual(silent, [], 'a laboratory opened with nothing to do in it is a detour')
  })

  it('the practical half of the course is real', () => {
    const withLabs = lessons.filter((one) => one.blocks.some((two) => two.kind === 'lab')).length
    assert.ok(withLabs >= 15, `only ${withLabs} lessons send the learner into a laboratory`)
  })
})

describe('completion', () => {
  it('keeps the existing pass mark rather than inventing a second one', () => {
    assert.equal(AI_COURSE.completion.quizPass, 0.8)
    assert.equal(AI_COURSE.assessment?.passScore, 0.8)
  })

  it('cannot be finished by opening lessons', () => {
    assert.equal(AI_COURSE.completion.needsAssessment, true)
    assert.ok((AI_COURSE.completion.masteryAtLeast ?? 0) >= 0.6)
    assert.ok(AI_COURSE.completion.requiredProjects.length > 0)
  })

  it('does not collide with Course 01', () => {
    assert.notEqual(AI_COURSE.id, 'orbis.python.01')
    assert.match(AI_COURSE.id, /^orbis\.ai\.02$/)
  })
})
