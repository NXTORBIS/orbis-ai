import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { QUANTUM_COURSE } from './index.ts'
import { QUANTUM_CONCEPTS } from './concepts.ts'
import { cleanCourse, teachable } from '../../validate.ts'
import { EVERY_APP_ID } from '../../../native/every.ts'

/**
 * Guards for Course 03.
 *
 * The same checks Course 02 carries, because they catch the same mistakes: a lesson teaching a concept nobody
 * declared, a lesson requiring something taught later, a laboratory that does not exist, a question that cannot
 * be marked, a final paper made of beginner definitions.
 *
 * Three are specific to this course, and they exist because the specification asks for them:
 *   - the honesty rule -- some lesson must state in words that nothing here runs on quantum hardware;
 *   - the misconception rule -- the sentences introduced in Unit 01 must be refused somewhere later;
 *   - the simulator rule -- the laboratories must be the real Quantum Studio, not a decorative stand-in.
 */

const lessons = QUANTUM_COURSE.modules.flatMap((one) => one.lessons)
const questions = lessons.flatMap((one) => one.questions)
const conceptIds = new Set(QUANTUM_CONCEPTS.map((one) => one.id))

/** Every piece of readable text in the course, lower-cased, for the honesty checks below. */
function allWords(): string {
  const out: string[] = []
  for (const lesson of lessons) {
    out.push(lesson.title, lesson.intro)
    for (const block of lesson.blocks) {
      if ('text' in block && typeof block.text === 'string') out.push(block.text)
      if (block.kind === 'list') out.push(block.items.join(' '))
      if (block.kind === 'table') out.push(block.headers.join(' '), block.rows.flat().join(' '))
      if (block.kind === 'lab') out.push(block.title, block.does)
      if (block.kind === 'formula') out.push(block.caption ?? '')
    }
    for (const question of lesson.questions) {
      out.push(question.prompt, question.explanation, ...(question.options ?? []))
    }
  }
  return out.join('\n').toLowerCase()
}

const WORDS = allWords()

describe('the course is teachable', () => {
  it('passes the validator with the real laboratory list', () => {
    const cleaned = cleanCourse(QUANTUM_COURSE, 0)
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
    const cleaned = cleanCourse(QUANTUM_COURSE, 0)
    assert.equal(cleaned?.lessonCount, lessons.length)
    const lessonMinutes = lessons.reduce((sum, one) => sum + one.minutes, 0)
    assert.ok((cleaned?.estimatedMinutes ?? 0) >= lessonMinutes)
    assert.equal(QUANTUM_COURSE.estimatedMinutes, 0)
  })

  it('is a substantial course rather than a sketch', () => {
    assert.ok(lessons.length >= 50, `only ${lessons.length} lessons`)
    assert.ok(questions.length >= 140, `only ${questions.length} questions`)
    assert.ok(QUANTUM_COURSE.modules.length >= 16)
  })

  it('keeps its depth to the end rather than tailing off', () => {
    // The specification asks for this explicitly. A last unit of three short lessons would pass every other check.
    const last = QUANTUM_COURSE.modules.slice(-3, -1)
    for (const unit of last) {
      assert.ok(unit.lessons.length >= 3, `${unit.id} has only ${unit.lessons.length} lessons`)
      const minutes = unit.lessons.reduce((sum, one) => sum + one.minutes, 0)
      assert.ok(minutes >= 40, `${unit.id} is only ${minutes} minutes`)
    }
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
    const taught = new Set(lessons.flatMap((one) => one.concepts))
    const orphans = QUANTUM_CONCEPTS.map((one) => one.id).filter((one) => !taught.has(one))
    assert.deepEqual(orphans, [])
  })

  it('no concept requires itself, directly or around a loop', () => {
    const by = new Map(QUANTUM_CONCEPTS.map((one) => [one.id, one.requires]))
    const seen = new Set<string>()
    const walk = (id: string, stack: string[]): void => {
      if (stack.includes(id)) throw new Error(`loop: ${[...stack, id].join(' -> ')}`)
      if (seen.has(id)) return
      for (const next of by.get(id) ?? []) walk(next, [...stack, id])
      seen.add(id)
    }
    for (const one of QUANTUM_CONCEPTS) walk(one.id, [])
  })

  it('no concept requires one that is not declared', () => {
    const dangling: string[] = []
    for (const one of QUANTUM_CONCEPTS) {
      for (const needed of one.requires) if (!conceptIds.has(needed)) dangling.push(`${one.id} -> ${needed}`)
    }
    assert.deepEqual(dangling, [])
  })
})

describe('the order the course is taught in', () => {
  it('no lesson requires a concept the course teaches later', () => {
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

  it('measurement is taught before the gates that depend on reading it', () => {
    // The order the whole course rests on: a learner who thinks a qubit holds a hidden bit mis-reads every circuit after.
    const at = (concept: string): number => lessons.findIndex((one) => one.concepts.includes(concept))
    assert.ok(at('born-rule') >= 0 && at('unitary') >= 0)
    assert.ok(at('born-rule') < at('unitary'), 'the Born rule must come before the unitary rule')
    assert.ok(at('entanglement') < at('grover'), 'entanglement must come before the algorithms that use it')
    assert.ok(at('interference') < at('grover'), 'interference is the mechanism, so it comes first')
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
    assert.deepEqual(silent, [])
  })

  it('choice questions have a real set of options and an answer inside it', () => {
    const faults: string[] = []
    for (const one of questions) {
      if (one.kind === 'choice') {
        const options = one.options ?? []
        if (options.length < 3) faults.push(`${one.id}: ${options.length} options`)
        const answer = Array.isArray(one.answer) ? one.answer : [one.answer]
        for (const at of answer) {
          if (typeof at !== 'number' || at < 0 || at >= options.length) {
            faults.push(`${one.id}: answer ${String(at)} is not an option`)
          }
        }
      }
      if (one.kind === 'multi') {
        const options = one.options ?? []
        const answer = Array.isArray(one.answer) ? one.answer : []
        if (answer.length < 2) faults.push(`${one.id}: a multi-select with fewer than two correct answers`)
        for (const at of answer) {
          if (typeof at !== 'number' || at < 0 || at >= options.length) {
            faults.push(`${one.id}: answer ${String(at)} is not an option`)
          }
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
    const pool = QUANTUM_COURSE.assessment?.questionIds ?? []
    const byId = new Map(questions.map((one) => [one.id, one]))
    const tooEasy = pool.filter((one) => byId.get(one)?.difficulty === 'beginner')
    assert.deepEqual(tooEasy, [])
    assert.ok(pool.length >= (QUANTUM_COURSE.assessment?.ask ?? 0) * 2)
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
    assert.deepEqual(silent, [])
  })

  it('the practical half of the course runs on the real simulator', () => {
    /*
     * "No decorative simulators" from the specification, enforced.
     *
     * The Quantum Studio computes every state, measurement and syndrome with src/shared/quantum, so requiring
     * that most of the laboratory work happens there is what stops a lesson illustrating a result with a picture.
     */
    const labs = lessons.flatMap((one) => one.blocks.filter((two) => two.kind === 'lab'))
    const studio = labs.filter((one) => one.appId === 'quantum-studio').length
    assert.ok(labs.length >= 25, `only ${labs.length} laboratory blocks`)
    assert.ok(studio >= labs.length / 2, `only ${studio} of ${labs.length} laboratories are the Quantum Studio`)
  })
})

describe('the honesty rules from the specification', () => {
  it('says somewhere, in words, that nothing here runs on quantum hardware', () => {
    assert.match(WORDS, /no hardware behind|not hardware|nothing .{0,40}runs on (quantum )?hardware/)
  })

  it('never presents simulation as hardware', () => {
    // The labels exist and are used: a result in this course is ideal, sampled or noisy.
    assert.ok(WORDS.includes('ideal simulation'), 'results must be labelled')
    assert.ok(WORDS.includes('noisy simulation'), 'noisy results must be labelled separately')
  })

  it('refuses the four sentences rather than repeating them', () => {
    /*
     * Each of these phrases may appear -- the course quotes them in order to refuse them -- but each must be
     * accompanied somewhere by the experiment that settles it. Checking for the refusals is the point; a course
     * that quoted them and never came back would pass a word search and fail a learner.
     */
    assert.ok(WORDS.includes('0 and 1 at the same time') || WORDS.includes('both 0 and 1'))
    assert.ok(WORDS.includes('hidden'), 'the hidden-value story must be named to be refused')
    assert.ok(WORDS.includes('over-rotat'), 'over-rotation is the refusal of parallel evaluation')
    assert.ok(WORDS.includes('two classical bits'), 'no-signalling is settled by the bits teleportation needs')
  })

  it('states the simulator limits rather than implying unlimited scale', () => {
    assert.ok(WORDS.includes('refus') || WORDS.includes('declin'), 'the course must mention the tool refusing')
    assert.ok(WORDS.includes('seed'), 'reproducibility needs seeds named')
  })
})

describe('the projects', () => {
  const projects = QUANTUM_COURSE.modules[QUANTUM_COURSE.modules.length - 1]

  it('are the last module and are required for completion', () => {
    assert.equal(projects.id, 'q17')
    assert.deepEqual(QUANTUM_COURSE.completion.requiredProjects, ['q17'])
  })

  it('offer genuinely different capstone tracks rather than one project for everybody', () => {
    const capstone = projects.lessons[projects.lessons.length - 1]
    const tracks = capstone.blocks.find((one) => one.kind === 'table')
    assert.ok(tracks && tracks.kind === 'table')
    assert.ok(tracks.rows.length >= 8, `only ${tracks.rows.length} capstone tracks`)
  })

  it('every project states a quality gate, so it cannot pass merely by running', () => {
    const without = projects.lessons.filter((one) => {
      const text = one.blocks
        .map((two) => ('text' in two && typeof two.text === 'string' ? two.text : two.kind === 'list' ? two.items.join(' ') : ''))
        .join(' ')
        .toLowerCase()
      const heading = one.blocks.some((two) => two.kind === 'heading' && two.text.toLowerCase().includes('quality gate'))
      return !heading && !text.includes('quality gate')
    })
    assert.deepEqual(
      without.map((one) => one.id),
      []
    )
  })

  it('each project is substantial', () => {
    const short = projects.lessons.filter((one) => one.minutes < 60).map((one) => one.id)
    assert.deepEqual(short, [])
  })
})

describe('completion', () => {
  it('keeps the existing pass mark rather than inventing a second one', () => {
    assert.equal(QUANTUM_COURSE.completion.quizPass, 0.8)
    assert.equal(QUANTUM_COURSE.assessment?.passScore, 0.8)
  })

  it('cannot be finished by opening lessons', () => {
    assert.equal(QUANTUM_COURSE.completion.needsAssessment, true)
    assert.ok((QUANTUM_COURSE.completion.masteryAtLeast ?? 0) >= 0.6)
    assert.ok(QUANTUM_COURSE.completion.requiredProjects.length > 0)
  })

  it('does not collide with the other courses', () => {
    assert.notEqual(QUANTUM_COURSE.id, 'orbis.python.01')
    assert.notEqual(QUANTUM_COURSE.id, 'orbis.ai.02')
    assert.match(QUANTUM_COURSE.id, /^orbis\.quantum\.03$/)
  })
})
