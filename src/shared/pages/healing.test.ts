import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  afterRound,
  classify,
  constraintFor,
  engineForVisual,
  fromGates,
  fromLayout,
  fromRun,
  fromSpec,
  fromVisual,
  HEALING_LIMITS,
  NOTHING_ATTEMPTED,
  planHealing,
  type Attempted,
  type Defect
} from './healing.ts'

const defect = (over: Partial<Defect> & { code: string }): Defect => ({
  found: 'layout',
  message: `something about ${over.code}`,
  at: 'somewhere',
  severity: 'error',
  ...over
})

describe('what to do about one defect', () => {
  it('fixes a layout defect by laying it out again, with no model', () => {
    for (const code of ['columns-too-narrow', 'too-narrow-to-draw', 'wider-than-the-row', 'off-screen', 'overlapping', 'clipped']) {
      const repair = classify(defect({ code }))
      assert.equal(repair.deterministic, true, code)
      assert.equal(repair.engine, 'layout', code)
    }
  })

  it('fixes a section that holds too much by splitting it', () => {
    const repair = classify(defect({ code: 'section-too-full' }))
    assert.equal(repair.strategy, 'split')
    assert.ok(repair.deterministic)
  })

  it('fixes a control nobody can hit by choosing a different one', () => {
    const repair = classify(defect({ code: 'too-small', found: 'visual' }))
    assert.equal(repair.engine, 'component')
    assert.ok(repair.deterministic)
  })

  it('fixes an answer that never arrived by working it out again', () => {
    const repair = classify(defect({ code: 'no-answer', found: 'visual' }))
    assert.equal(repair.strategy, 'rerun')
    assert.equal(repair.engine, 'runtime')
    assert.ok(repair.deterministic)
  })

  it('moves work off the typing path when a Page does too much per keystroke', () => {
    const repair = classify(
      defect({
        code: 'gate',
        found: 'gate',
        message: 'Typing in "Speed" sets off 9 calculations, and the most that can happen while somebody types is 6. Some of them should wait for a button.'
      })
    )
    assert.equal(repair.strategy, 'defer')
    assert.equal(repair.engine, 'interaction')
    assert.ok(repair.deterministic)
  })

  it('asks the model only about meaning', () => {
    for (const code of ['unknown-operation', 'no-such-argument', 'not-an-option', 'nothing-picked', 'unknown-input']) {
      const repair = classify(defect({ code, found: 'spec' }))
      assert.equal(repair.strategy, 'respecify', code)
      assert.equal(repair.deterministic, false, code)
    }
  })

  it('carries the specific complaint, not a summary', () => {
    const repair = classify(
      defect({
        code: 'no-such-argument',
        found: 'spec',
        at: 'steps[0].arguments.velocity',
        message: 'motion.projectile does not take "velocity". It takes speed, angle, gravity.'
      })
    )
    assert.ok(repair.because.includes('steps[0].arguments.velocity'))
    assert.ok(repair.because.includes('It takes speed, angle, gravity'))
  })

  it('asks the model about an engine refusing, because its own sentence is the most specific thing anybody has', () => {
    const repair = classify(defect({ code: 'refused', found: 'run', message: 'The angle has to be between 0 and 90.' }))
    assert.equal(repair.strategy, 'respecify')
    assert.equal(repair.because, 'The angle has to be between 0 and 90.')
  })

  it('gives up by name rather than guessing when nothing fits', () => {
    const repair = classify(defect({ code: 'something-nobody-planned-for', found: 'gate' }))
    assert.equal(repair.strategy, 'give-up')
  })

  it('does not find a strategy on Object.prototype', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal(classify(defect({ code, found: 'gate' })).strategy, 'give-up', code)
    }
  })
})

describe('planning a round of repair', () => {
  it('does nothing when nothing is wrong', () => {
    const plan = planHealing([])
    assert.deepEqual(plan.repairs, [])
    assert.ok(plan.exhausted)
    assert.ok(plan.because.includes('nothing wrong'))
  })

  it('ignores warnings, because a round spent on one is a round a real defect does not get', () => {
    const plan = planHealing([defect({ code: 'buried', severity: 'warning' })])
    assert.deepEqual(plan.repairs, [])
    assert.ok(plan.exhausted)
  })

  it('does everything deterministic before it asks anybody anything', () => {
    const plan = planHealing([
      defect({ code: 'unknown-operation', found: 'spec' }),
      defect({ code: 'columns-too-narrow' }),
      defect({ code: 'section-too-full' })
    ])
    assert.equal(plan.repairs.length, 3)
    assert.ok(plan.repairs[0].deterministic)
    assert.ok(plan.repairs[1].deterministic)
    assert.equal(plan.repairs[2].strategy, 'respecify')
  })

  it('puts every meaning defect into one ask rather than one per round', () => {
    const plan = planHealing([
      defect({ code: 'unknown-operation', found: 'spec', message: 'no such calculation' }),
      defect({ code: 'no-such-argument', found: 'spec', message: 'no such argument' }),
      defect({ code: 'not-an-option', found: 'spec', message: 'not an option' })
    ])
    const asks = plan.repairs.filter((one) => one.strategy === 'respecify')
    assert.equal(asks.length, 1)
    // And it carries all three, because the model is told everything at once or asked again about a Page that has
    // since been replaced.
    for (const said of ['no such calculation', 'no such argument', 'not an option']) {
      assert.ok(asks[0].because.includes(said), said)
    }
  })

  it('does not repeat itself when two findings are the same finding', () => {
    const same = defect({ code: 'unknown-operation', found: 'spec', message: 'no such calculation' })
    const plan = planHealing([same, { ...same }])
    const asks = plan.repairs.filter((one) => one.strategy === 'respecify')
    assert.equal(asks[0].because.split(String.fromCharCode(10)).length, 1)
  })

  it('keeps two findings in different places, because they are two things to fix', () => {
    const one = defect({ code: 'no-such-argument', found: 'spec', at: 'steps[0]', message: 'no such argument' })
    const plan = planHealing([one, { ...one, at: 'steps[1]' }])
    const asks = plan.repairs.filter((each) => each.strategy === 'respecify')
    const said = asks[0].because.split(String.fromCharCode(10))
    assert.equal(said.length, 2)
    assert.ok(said[0].startsWith('steps[0]'))
    assert.ok(said[1].startsWith('steps[1]'))
  })

  it('stops after enough rounds', () => {
    const attempted: Attempted = { ...NOTHING_ATTEMPTED, rounds: HEALING_LIMITS.rounds }
    const plan = planHealing([defect({ code: 'columns-too-narrow' })], attempted)
    assert.ok(plan.exhausted)
    assert.ok(plan.because.includes('rounds of repair'))
  })

  it('stops when it has taken longer than anybody would wait', () => {
    const attempted: Attempted = { ...NOTHING_ATTEMPTED, spentMs: HEALING_LIMITS.budgetMs + 1 }
    assert.ok(planHealing([defect({ code: 'columns-too-narrow' })], attempted).exhausted)
  })

  it('stops asking the model once it has been asked enough', () => {
    const attempted: Attempted = { ...NOTHING_ATTEMPTED, asks: HEALING_LIMITS.asks }
    const plan = planHealing([defect({ code: 'unknown-operation', found: 'spec' })], attempted)
    assert.ok(plan.exhausted)
    assert.ok(plan.because.includes('same question'))
  })

  it('stops asking one layer once it has failed enough', () => {
    const attempted: Attempted = { ...NOTHING_ATTEMPTED, byEngine: { layout: HEALING_LIMITS.perLayer } }
    const plan = planHealing([defect({ code: 'columns-too-narrow' })], attempted)
    assert.ok(plan.exhausted)
  })

  it('still repairs another layer when one has given up', () => {
    const attempted: Attempted = { ...NOTHING_ATTEMPTED, byEngine: { layout: HEALING_LIMITS.perLayer } }
    const plan = planHealing([defect({ code: 'columns-too-narrow' }), defect({ code: 'too-small', found: 'visual' })], attempted)
    assert.equal(plan.exhausted, false)
    assert.deepEqual(plan.repairs.map((one) => one.engine), ['component'])
  })

  it('says why it gave up, in words', () => {
    const plan = planHealing([defect({ code: 'something-nobody-planned-for', found: 'gate', message: 'the moon is wrong' })])
    assert.ok(plan.exhausted)
    assert.ok(plan.because.includes('the moon is wrong'))
  })
})

describe('counting what has been tried', () => {
  it('counts a round, the layers used and the model asks separately', () => {
    const plan = planHealing([defect({ code: 'columns-too-narrow' }), defect({ code: 'unknown-operation', found: 'spec' })])
    const after = afterRound(NOTHING_ATTEMPTED, plan.repairs, 1200)
    assert.equal(after.rounds, 1)
    assert.equal(after.asks, 1)
    assert.equal(after.byEngine.layout, 1)
    assert.equal(after.byEngine.planner, 1)
    assert.equal(after.spentMs, 1200)
  })

  it('reaches the limits by repairing, rather than by a number nobody can get to', () => {
    // The cap has to actually be reachable, or the loop is real and the limit is decoration.
    let attempted = NOTHING_ATTEMPTED
    let rounds = 0
    for (let i = 0; i < HEALING_LIMITS.rounds + 3; i++) {
      const plan = planHealing([defect({ code: 'columns-too-narrow' }), defect({ code: 'too-small', found: 'visual' })], attempted)
      if (plan.exhausted) break
      rounds++
      attempted = afterRound(attempted, plan.repairs, 10)
    }
    assert.ok(rounds > 0, 'it never repaired anything')
    assert.ok(planHealing([defect({ code: 'columns-too-narrow' })], attempted).exhausted)
  })
})

describe('the constraint a repair passes back', () => {
  it('gives every deterministic repair something its engine did not already have', () => {
    // An engine asked again with nothing new returns what it returned before, which is a loop that cannot converge.
    for (const code of ['columns-too-narrow', 'too-narrow-to-draw', 'section-too-full', 'too-small', 'no-answer']) {
      const repair = classify(defect({ code, found: 'visual' }))
      const constraint = constraintFor(repair)
      assert.ok(constraint !== null, code)
      assert.equal(constraint.engine, repair.engine, code)
    }
  })

  it('asks for the whole row when something drawn is too narrow', () => {
    assert.equal(constraintFor(classify(defect({ code: 'too-narrow-to-draw' })))?.kind, 'full-row')
  })

  it('asks for fewer columns when they are too narrow', () => {
    assert.equal(constraintFor(classify(defect({ code: 'columns-too-narrow' })))?.kind, 'fewer-columns')
  })

  it('asks for a reorder when the Page leads with nothing or with everything', () => {
    assert.equal(constraintFor(classify(defect({ code: 'nothing-leads' })))?.kind, 'reorder')
    assert.equal(constraintFor(classify(defect({ code: 'buried', found: 'visual' })))?.kind, 'reorder')
  })

  it('has nothing to pass back for a repair that needs a model', () => {
    assert.equal(constraintFor(classify(defect({ code: 'unknown-operation', found: 'spec' }))), null)
  })
})

describe('reading defects from every finder', () => {
  it('reads one from each, keeping what each said', () => {
    assert.deepEqual(fromSpec([{ at: 'steps[0]', severity: 'error', code: 'unknown-operation', message: 'no' }]), [
      { found: 'spec', code: 'unknown-operation', message: 'no', at: 'steps[0]', severity: 'error' }
    ])
    assert.equal(fromLayout([{ at: 'a', severity: 'warning', code: 'buried', message: 'down' }])[0].found, 'layout')
    assert.equal(fromVisual([{ at: 'a', severity: 'error', code: 'no-answer', message: 'empty' }])[0].found, 'visual')
    assert.equal(fromGates(['it asks for too much'])[0].found, 'gate')
    assert.equal(fromRun([{ name: 'flight', message: 'refused' }])[0].at, 'flight')
  })

  it('keeps a warning a warning, so planning can ignore it', () => {
    assert.equal(fromLayout([{ at: 'a', severity: 'warning', code: 'buried', message: 'down' }])[0].severity, 'warning')
  })

  it('treats everything a run refused as an error, because a refusal is not advice', () => {
    assert.equal(fromRun([{ name: 'flight', message: 'refused' }])[0].severity, 'error')
  })
})

describe('who owns a visual defect', () => {
  it('agrees with the visual module about every code', () => {
    assert.equal(engineForVisual('no-answer'), 'runtime')
    assert.equal(engineForVisual('off-screen'), 'layout')
    assert.equal(engineForVisual('too-small'), 'component')
    assert.equal(engineForVisual('empty-page'), 'compiler')
  })
})
