import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  cancel,
  compiled,
  describeStage,
  failed,
  GENERATION_LIMITS,
  isExpired,
  isSessionError,
  planned,
  recover,
  resolved,
  RESTING,
  startSession,
  tried,
  validated,
  WORKING,
  type GenerationSession,
  type SessionError,
  type Stage
} from './generation.ts'
import type { Resolution } from './resolution.ts'
import type { ValidationResult } from './validation.ts'
import { compile, isCompileError } from './compiler.ts'
import { SPEC_VERSION, type PageSpec } from './spec.ts'

const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({ 'motion.projectile': 'computation.physics' })

const spec: PageSpec = {
  specVersion: SPEC_VERSION,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Launch speed', initial: 20, minimum: 0, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Launch angle', initial: 45, minimum: 0, maximum: 90 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } },
      when: 'change'
    }
  ],
  outputs: [{ name: 'range', label: 'How far it goes', display: 'statistic', step: 'flight', pick: 'range' }],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range']
}

const built = (): { spec: PageSpec; manifest: Parameters<typeof compiled>[1]['manifest']; document: Parameters<typeof compiled>[1]['document'] } => {
  const one = compile(spec, { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' })
  assert.ok(!isCompileError(one))
  return { spec: one.spec, manifest: one.manifest, document: one.document }
}

const generateResolution: Resolution = { action: 'generate', request: 'projectile range', near: [], because: ['Nothing in the library does this.'] }

const passing: ValidationResult = { gates: [], passed: true, incomplete: true, problems: [] }
const failing: ValidationResult = { gates: [], passed: false, incomplete: false, problems: ['It asks for something none of its calculations need.'] }

/**
 * A transition that was expected to work.
 *
 * Not generic: a generic `<T>(value: T | SessionError) => T` infers `T` as the whole union, so every call site gets
 * back something that might still be an error and typechecks as though it could not be.
 */
const ok = (value: GenerationSession | SessionError): GenerationSession => {
  assert.ok(!isSessionError(value), isSessionError(value) ? value.message : '')
  return value
}

const start = (now = 1000): GenerationSession => ok(startSession({ sessionId: 's1', request: 'projectile range', profileId: 'p1', now }))

describe('starting', () => {
  it('begins at the first rung of the ladder rather than at the model', () => {
    const session = start()
    assert.equal(session.stage, 'resolving')
    assert.equal(session.attempts, 1)
    assert.equal(session.history.length, 1)
  })

  it('refuses nothing, and refuses a document', () => {
    for (const request of ['', '   ', 'x'.repeat(GENERATION_LIMITS.requestLength + 1)]) {
      const result = startSession({ sessionId: 's1', request, profileId: 'p1', now: 1000 })
      assert.ok(isSessionError(result) && result.error === 'bad-request', JSON.stringify(request.slice(0, 8)))
    }
  })
})

describe('the way through', () => {
  const wholeWay = (): GenerationSession => {
    let session = start()
    session = ok(resolved(session, generateResolution, 2000))
    session = ok(planned(session, '{"specVersion":1}', 3000))
    session = ok(compiled(session, built(), 4000))
    session = ok(validated(session, passing, 5000))
    return ok(tried(session, { ...passing, incomplete: false }, 6000))
  }

  it('reaches ready, through every stage, in order', () => {
    const session = wholeWay()
    assert.equal(session.stage, 'ready')
    assert.deepEqual(session.history.map((one) => one.stage), ['resolving', 'planning', 'compiling', 'validating', 'trying', 'ready'])
    assert.ok(session.built !== null)
    assert.ok(session.spec !== null)
  })

  it('stops when something already answers the question', () => {
    let session = start()
    const already: Resolution = { action: 'decline', because: ['This is a news query, which is a thing to look up rather than work out.'] }
    session = ok(resolved(session, already, 2000))
    assert.equal(session.stage, 'failed')
    assert.equal(session.failure?.code, 'nothing-to-build')
    assert.ok(session.failure?.message.includes('look up'))
  })

  it('never calls a model when an existing Page answers it', () => {
    const reuse: Resolution = {
      action: 'open',
      because: ['It matches on every word.'],
      // Only the action is read here; the suggestion is carried for whoever shows it.
      suggestion: { page: {}, confidence: 1, because: [], prefill: null, direct: true } as never
    }
    const session = ok(resolved(start(), reuse, 2000))
    assert.equal(session.stage, 'failed')
    assert.equal(session.raw, null, 'nothing was ever asked of a model')
  })

  it('keeps what the model said as evidence and never as a source of fields', () => {
    let session = ok(resolved(start(), generateResolution, 2000))
    session = ok(planned(session, '{"specVersion":1,"capabilities":["secrets.read"]}', 3000))
    assert.ok(session.raw?.includes('secrets.read'))
    // And the spec is still null, because nothing has been read out of it yet.
    assert.equal(session.spec, null)
  })

  it('caps how much of the model output it keeps', () => {
    let session = ok(resolved(start(), generateResolution, 2000))
    session = ok(planned(session, 'x'.repeat(GENERATION_LIMITS.rawLength + 5000), 3000))
    assert.equal(session.raw?.length, GENERATION_LIMITS.rawLength)
  })

  it('ends at the gates rather than running a Page that failed them', () => {
    let session = ok(resolved(start(), generateResolution, 2000))
    session = ok(planned(session, '{}', 3000))
    session = ok(compiled(session, built(), 4000))
    session = ok(validated(session, failing, 5000))
    assert.equal(session.stage, 'failed')
    assert.equal(session.failure?.code, 'gates-failed')
    assert.equal(session.history.at(-1)?.stage, 'failed')
  })

  it('fails when the Page would not run', () => {
    let session = ok(resolved(start(), generateResolution, 2000))
    session = ok(planned(session, '{}', 3000))
    session = ok(compiled(session, built(), 4000))
    session = ok(validated(session, passing, 5000))
    session = ok(tried(session, failing, 6000))
    assert.equal(session.stage, 'failed')
    assert.equal(session.failure?.code, 'would-not-run')
  })

  it('refuses a step out of order', () => {
    const session = start()
    // Compiling before anything was planned.
    const jumped = compiled(session, built(), 2000)
    assert.ok(isSessionError(jumped) && jumped.error === 'bad-transition')
  })

  it('refuses anything at all once it has finished', () => {
    const done = ok(cancel(start(), 2000))
    for (const attempt of [
      () => resolved(done, generateResolution, 3000),
      () => planned(done, '{}', 3000),
      () => cancel(done, 3000),
      () => failed(done, { code: 'model-failed', message: 'no', problems: [] }, 3000)
    ]) {
      const result = attempt()
      assert.ok(isSessionError(result) && result.error === 'already-finished')
    }
  })

  it('can be stopped from any working stage', () => {
    let session = start()
    assert.ok(!isSessionError(cancel(session, 2000)))
    session = ok(resolved(session, generateResolution, 2000))
    assert.ok(!isSessionError(cancel(session, 3000)))
    session = ok(planned(session, '{}', 3000))
    assert.ok(!isSessionError(cancel(session, 4000)))
  })

  it('agrees with itself about which stages are working and which are resting', () => {
    const all: Stage[] = ['resolving', 'planning', 'compiling', 'validating', 'trying', 'ready', 'failed', 'cancelled']
    for (const stage of all) {
      assert.equal(WORKING.has(stage) !== RESTING.has(stage), true, `${stage} is one or the other, never both or neither`)
    }
  })
})

describe('picking up the pieces', () => {
  const interrupted = (stage: Stage, updatedAt: number, attempts = 1): GenerationSession => ({
    ...start(),
    stage,
    attempts,
    updatedAt,
    raw: 'half an answer',
    spec,
    built: built()
  })

  it('leaves a session that was not in the middle of anything', () => {
    const done = ok(cancel(start(), 2000))
    assert.equal(recover(done, 9_000_000).action, 'leave')
  })

  it('leaves a session something is probably still working on', () => {
    const now = 1_000_000
    const result = recover(interrupted('planning', now - 1000), now)
    assert.equal(result.action, 'leave')
    assert.ok(result.because.includes('run both'))
  })

  it('picks up a session nothing has touched, and starts from the ladder again', () => {
    const now = 1_000_000
    const result = recover(interrupted('planning', now - GENERATION_LIMITS.staleAfterMs - 1), now)
    assert.equal(result.action, 'restart')
    if (result.action !== 'restart') return
    assert.equal(result.from, 'resolving')
    assert.equal(result.session.attempts, 2)
    // Everything from the interrupted attempt is cleared, so nothing shows half of it.
    assert.equal(result.session.raw, null)
    assert.equal(result.session.spec, null)
    assert.equal(result.session.built, null)
    assert.equal(result.session.resolution, null)
  })

  it('gives up rather than looping forever', () => {
    const now = 1_000_000
    const result = recover(interrupted('planning', now - GENERATION_LIMITS.staleAfterMs - 1, GENERATION_LIMITS.attempts), now)
    assert.equal(result.action, 'give-up')
    if (result.action !== 'give-up') return
    assert.equal(result.session.stage, 'failed')
    assert.equal(result.session.failure?.code, 'gave-up')
    assert.ok(result.session.failure?.message.includes('interrupted'))
  })

  it('reaches giving up by restarting, rather than by a number nobody can get to', () => {
    // The counter has to actually climb, or the cap is unreachable and the loop is real.
    const now = 1_000_000
    let session = interrupted('planning', now - GENERATION_LIMITS.staleAfterMs - 1)
    let restarts = 0
    for (let i = 0; i < GENERATION_LIMITS.attempts + 2; i++) {
      const result = recover(session, now)
      if (result.action === 'give-up') break
      assert.equal(result.action, 'restart')
      if (result.action !== 'restart') break
      restarts++
      session = { ...result.session, stage: 'planning', updatedAt: now - GENERATION_LIMITS.staleAfterMs - 1 }
    }
    assert.equal(restarts, GENERATION_LIMITS.attempts - 1)
    assert.equal(recover(session, now).action, 'give-up')
  })
})

describe('keeping and forgetting', () => {
  it('keeps a finished session for a while and then not', () => {
    const done = ok(cancel(start(), 2000))
    assert.equal(isExpired(done, 2000 + GENERATION_LIMITS.keepForMs - 1), false)
    assert.ok(isExpired(done, 2000 + GENERATION_LIMITS.keepForMs + 1))
  })

  it('never expires one that is still working, however long it has been', () => {
    const session = { ...start(), stage: 'planning' as const, updatedAt: 2000 }
    assert.equal(isExpired(session, 2000 + GENERATION_LIMITS.keepForMs * 10), false)
  })
})

describe('describeStage', () => {
  it('says something for every stage', () => {
    const all: Stage[] = ['resolving', 'planning', 'compiling', 'validating', 'trying', 'ready', 'failed', 'cancelled']
    for (const stage of all) {
      assert.ok(describeStage({ ...start(), stage }).length > 0, stage)
    }
  })

  it('says why, when it failed', () => {
    const session = ok(failed(start(), { code: 'no-model', message: 'There is no model configured to write one.', problems: [] }, 2000))
    assert.equal(describeStage(session), 'There is no model configured to write one.')
  })
})
