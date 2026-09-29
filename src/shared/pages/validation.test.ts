import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compile, isCompileError, type Compiled } from './compiler.ts'
import { SPEC_VERSION, type PageSpec } from './spec.ts'
import { GENERATED_MAY_HOLD, VALIDATION_LIMITS, validate, whatToRun, type GateName, type ValidateInput } from './validation.ts'

const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'units.convert': 'computation.units',
  'statistics.summary': 'computation.statistics',
  'motion.projectile': 'computation.physics'
})

const spec = (parts: Partial<PageSpec> = {}): PageSpec => ({
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
  keywords: ['projectile', 'range'],
  ...parts
})

const build = (one: PageSpec, allowStorage = false): Compiled => {
  const compiled = compile(one, { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2', allowStorage })
  assert.ok(!isCompileError(compiled), JSON.stringify(isCompileError(compiled) ? compiled.problems : ''))
  return compiled
}

const inputFor = (one: Compiled, allowStorage = false, evidence?: ValidateInput['evidence']): ValidateInput => ({
  spec: one.spec,
  manifest: one.manifest,
  document: one.document,
  operations: OPERATIONS,
  allowStorage,
  evidence
})

const gate = (result: ReturnType<typeof validate>, name: GateName): { outcome: string; because: readonly string[] } => {
  const found = result.gates.find((one) => one.gate === name)
  assert.ok(found !== undefined, `no ${name} gate`)
  return found
}

describe('validate', () => {
  it('passes a Page the compiler built, except for the one gate nobody could run', () => {
    const result = validate(inputFor(build(spec())))
    assert.deepEqual(
      result.gates.filter((one) => one.outcome === 'failed'),
      []
    )
    assert.equal(gate(result, 'running').outcome, 'not-run')
    assert.ok(result.passed)
    assert.ok(result.incomplete, 'a pass with something unchecked is not a full pass')
  })

  it('says why even when a gate passed, so a pass can be audited', () => {
    const result = validate(inputFor(build(spec())))
    for (const one of result.gates) assert.ok(one.because.length > 0, one.gate)
  })

  it('has no score anywhere in it', () => {
    // Deliberately structural. A number between 0 and 1 covering "is this any good" gets read as a probability.
    const result = validate(inputFor(build(spec())))
    assert.equal(JSON.stringify(result).includes('confidence'), false)
    assert.equal(JSON.stringify(result).includes('score'), false)
  })
})

describe('the permissions gate', () => {
  it('refuses a capability none of the calculations need', () => {
    const built = build(spec())
    const tampered = { ...built.manifest, capabilities: [...built.manifest.capabilities, 'computation.units'] }
    const result = validate({ ...inputFor(built), manifest: tampered })
    assert.equal(gate(result, 'permissions').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('none of its calculations need it')))
  })

  it('refuses a calculation whose capability was not asked for, rather than letting it fail on the first click', () => {
    const built = build(spec())
    const tampered = { ...built.manifest, capabilities: [] }
    const result = validate({ ...inputFor(built), manifest: tampered })
    assert.equal(gate(result, 'permissions').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('refused when somebody clicked')))
  })

  it('refuses anything a generated Page may not hold, however reasonable it would be for a written one', () => {
    const built = build(spec())
    for (const asked of ['clipboard.read', 'network.fetch', 'files.read']) {
      const tampered = { ...built.manifest, capabilities: [...built.manifest.capabilities, asked] }
      const result = validate({ ...inputFor(built), manifest: tampered })
      assert.equal(gate(result, 'permissions').outcome, 'failed', asked)
    }
  })

  it('refuses storage that Orbis did not grant', () => {
    const built = build(spec(), true)
    assert.ok(built.manifest.capabilities.includes('storage.page'))
    const result = validate(inputFor(built, false))
    assert.equal(gate(result, 'permissions').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('was not granted')))
  })

  it('allows only calculation and its own storage', () => {
    assert.ok(GENERATED_MAY_HOLD('computation.physics'))
    assert.ok(GENERATED_MAY_HOLD('storage.page'))
    for (const no of ['storage.profile', 'network.fetch', 'clipboard.read', 'page.send']) {
      assert.equal(GENERATED_MAY_HOLD(no), false, no)
    }
  })
})

describe('the legibility gate', () => {
  it('refuses a box labelled with its own name', () => {
    const result = validate(
      inputFor(build(spec({ inputs: [{ name: 'speed', kind: 'number', label: 'speed' }, spec().inputs[1]] })))
    )
    assert.equal(gate(result, 'legibility').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('labelled with its own name')))
  })

  it('refuses two things labelled the same', () => {
    const one = spec()
    const result = validate(
      inputFor(
        build(
          spec({
            inputs: [
              { ...one.inputs[0], label: 'Value' },
              { ...one.inputs[1], label: 'value' }
            ]
          })
        )
      )
    )
    assert.equal(gate(result, 'legibility').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('labelled')))
  })

  it('refuses a Page with more on it than somebody would fill in', () => {
    const many = new Array(VALIDATION_LIMITS.controls).fill(0).map((_, i) => ({
      name: `a${i}`,
      kind: 'number' as const,
      label: `Measurement number ${i}`
    }))
    const one = spec()
    const built = build(
      spec({
        inputs: many,
        steps: [
          {
            name: 'flight',
            operation: 'motion.projectile',
            arguments: Object.fromEntries(many.slice(0, 20).map((input) => [input.name, { input: input.name }])),
            when: 'button'
          }
        ],
        sections: [{ title: 'Everything', members: [...many.map((input) => input.name), 'range'] }],
        outputs: one.outputs
      })
    )
    const result = validate(inputFor(built))
    assert.equal(gate(result, 'legibility').outcome, 'failed')
  })
})

describe('the responsiveness gate', () => {
  it('counts what one keystroke really sets off, not how many calculations there are', () => {
    // Seven steps, each reading its own input. Typing in one sets off one, so this passes despite the count.
    const inputs = new Array(7).fill(0).map((_, i) => ({ name: `in${i}`, kind: 'number' as const, label: `Reading ${i}` }))
    const steps = inputs.map((input, i) => ({
      name: `step${i}`,
      operation: 'statistics.summary' as const,
      arguments: { values: { input: input.name } },
      when: 'change' as const
    }))
    const outputs = steps.map((step, i) => ({
      name: `out${i}`,
      label: `Answer ${i}`,
      display: 'statistic' as const,
      step: step.name,
      pick: 'mean'
    }))
    const result = validate(
      inputFor(
        build(
          spec({
            inputs,
            steps,
            outputs,
            sections: [{ title: 'Readings', members: [...inputs.map((one) => one.name), ...outputs.map((one) => one.name)] }]
          })
        )
      )
    )
    assert.equal(gate(result, 'responsiveness').outcome, 'passed')
    assert.ok(gate(result, 'responsiveness').because[0].includes('At most 1'))
  })

  it('refuses when one keystroke sets off more than somebody will wait for', () => {
    const steps = new Array(VALIDATION_LIMITS.perKeystroke + 1).fill(0).map((_, i) => ({
      name: `step${i}`,
      operation: 'statistics.summary' as const,
      // Every one of them reads the same box, so typing in it sets off all of them.
      arguments: { values: { input: 'speed' } },
      when: 'change' as const
    }))
    const outputs = steps.map((step, i) => ({
      name: `out${i}`,
      label: `Answer ${i}`,
      display: 'statistic' as const,
      step: step.name,
      pick: 'mean'
    }))
    const result = validate(
      inputFor(
        build(
          spec({
            inputs: [spec().inputs[0]],
            steps,
            outputs,
            sections: [{ title: 'All', members: ['speed', ...outputs.map((one) => one.name)] }]
          })
        )
      )
    )
    assert.equal(gate(result, 'responsiveness').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('should wait for a button')))
  })

  it('does not count a calculation that waits for a button', () => {
    const steps = new Array(VALIDATION_LIMITS.perKeystroke + 1).fill(0).map((_, i) => ({
      name: `step${i}`,
      operation: 'statistics.summary' as const,
      arguments: { values: { input: 'speed' } },
      when: 'button' as const
    }))
    const outputs = steps.map((step, i) => ({
      name: `out${i}`,
      label: `Answer ${i}`,
      display: 'statistic' as const,
      step: step.name,
      pick: 'mean'
    }))
    const result = validate(
      inputFor(
        build(
          spec({
            inputs: [spec().inputs[0]],
            steps,
            outputs,
            sections: [{ title: 'All', members: ['speed', ...outputs.map((one) => one.name)] }]
          })
        )
      )
    )
    assert.equal(gate(result, 'responsiveness').outcome, 'passed')
  })
})

describe('the persistence gate', () => {
  it('refuses a Page with something to type at length and nowhere to keep it', () => {
    const one = spec()
    const result = validate(
      inputFor(
        build(
          spec({
            inputs: [{ name: 'note', kind: 'text', label: 'Your working' }, one.inputs[1]],
            steps: [{ ...one.steps[0], arguments: { speed: { input: 'note' }, angle: { input: 'angle' }, gravity: { value: 9.81 } } }],
            sections: [{ title: 'The throw', members: ['note', 'angle'] }, one.sections[1]]
          })
        )
      )
    )
    assert.equal(gate(result, 'persistence').outcome, 'failed')
    assert.ok(result.problems.some((one) => one.includes('lost every time')))
  })

  it('passes the same Page once it is allowed to remember', () => {
    const one = spec()
    const built = build(
      spec({
        inputs: [{ name: 'note', kind: 'text', label: 'Your working' }, one.inputs[1]],
        steps: [{ ...one.steps[0], arguments: { speed: { input: 'note' }, angle: { input: 'angle' }, gravity: { value: 9.81 } } }],
        sections: [{ title: 'The throw', members: ['note', 'angle'] }, one.sections[1]]
      }),
      true
    )
    assert.equal(gate(validate(inputFor(built, true)), 'persistence').outcome, 'passed')
  })

  it('passes a Page of numbers that remembers nothing', () => {
    assert.equal(gate(validate(inputFor(build(spec()))), 'persistence').outcome, 'passed')
  })
})

describe('the honesty gate', () => {
  it('refuses a Page that does not say it was generated', () => {
    const built = build(spec())
    const tampered = { ...built.manifest, limitations: ['It works out a range.'] }
    const result = validate({ ...inputFor(built), manifest: tampered })
    assert.equal(gate(result, 'honesty').outcome, 'failed')
  })

  it('refuses a Page that states nothing at all', () => {
    const built = build(spec())
    const result = validate({ ...inputFor(built), manifest: { ...built.manifest, limitations: [] } })
    assert.equal(gate(result, 'honesty').outcome, 'failed')
  })

  it('notices when a Page states no limits beyond the ones every generated Page states', () => {
    const built = build(spec({ notes: [] }))
    const result = validate(inputFor(built))
    assert.equal(gate(result, 'honesty').outcome, 'passed')
    assert.ok(gate(result, 'honesty').because[0].includes('no limits of its own'))
  })
})

describe('the running gate', () => {
  it('does not count as passed when nobody ran it', () => {
    const result = validate(inputFor(build(spec())))
    assert.equal(gate(result, 'running').outcome, 'not-run')
    assert.ok(result.incomplete)
  })

  it('fails when a calculation was refused', () => {
    const result = validate(
      inputFor(build(spec()), false, { results: [{ name: 'flight', ok: false, message: 'the angle has to be between 0 and 90' }], notRun: [] })
    )
    assert.equal(gate(result, 'running').outcome, 'failed')
    assert.equal(result.passed, false)
    assert.ok(result.problems.some((one) => one.includes('between 0 and 90')))
  })

  it('fails when it ran and there was nothing at all to run', () => {
    const result = validate(inputFor(build(spec()), false, { results: [], notRun: [] }))
    assert.equal(gate(result, 'running').outcome, 'failed')
  })

  it('does not fail a Page whose calculations all wait for a button', () => {
    // An ordinary Page that asks before it works. Refusing it here failed every one of them.
    const result = validate(inputFor(build(spec()), false, { results: [], notRun: ['flight'] }))
    assert.equal(gate(result, 'running').outcome, 'passed')
    assert.ok(gate(result, 'running').because[0].includes('waits for a button'))
  })

  it('fails when the Page shows a property the calculation does not return', () => {
    // The quiet failure this exists for: the Page opens, the calculation answers, and the box is empty.
    const result = validate(
      inputFor(build(spec()), false, { results: [{ name: 'flight', ok: true, keys: ['distance', 'highest', 'seconds'] }], notRun: [] })
    )
    assert.equal(gate(result, 'running').outcome, 'failed')
    assert.ok(result.problems[0].includes('does not return that'))
    // And it says what is there, so a second attempt has something to work from.
    assert.ok(result.problems[0].includes('distance, highest, seconds'))
  })

  it('does not object to a property of a calculation that has not run', () => {
    const one = spec()
    const built = build(
      spec({
        steps: [one.steps[0], { name: 'later', operation: 'statistics.summary', arguments: { values: { input: 'speed' } }, when: 'button' }],
        outputs: [one.outputs[0], { name: 'mean', label: 'Average', display: 'statistic', step: 'later', pick: 'mean' }],
        sections: [one.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      })
    )
    const result = validate(inputFor(built, false, { results: [{ name: 'flight', ok: true, keys: ['range'] }], notRun: ['later'] }))
    assert.equal(gate(result, 'running').outcome, 'passed')
  })

  it('says nothing about picks when the run did not report what came back', () => {
    // Evidence without keys is evidence from something that could not look. Inventing a failure from it would fail
    // every Page whenever the runner was the older kind.
    const result = validate(inputFor(build(spec()), false, { results: [{ name: 'flight', ok: true }], notRun: [] }))
    assert.equal(gate(result, 'running').outcome, 'passed')
  })

  it('passes, and says plainly that an answer is not the right answer', () => {
    const result = validate(inputFor(build(spec()), false, { results: [{ name: 'flight', ok: true, keys: ['range'] }], notRun: [] }))
    assert.equal(gate(result, 'running').outcome, 'passed')
    assert.ok(result.passed)
    assert.equal(result.incomplete, false)
    assert.ok(gate(result, 'running').because.some((one) => one.includes('does not mean it is the right one')))
  })
})

describe('whatToRun', () => {
  it('names the calculations that happen on their own, and the ones waiting for a button', () => {
    const one = spec()
    const built = build(
      spec({
        steps: [one.steps[0], { name: 'later', operation: 'statistics.summary', arguments: { values: { input: 'speed' } }, when: 'button' }],
        outputs: [one.outputs[0], { name: 'mean', label: 'Average', display: 'statistic', step: 'later', pick: 'mean' }],
        sections: [one.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      })
    )
    const plan = whatToRun(built.document)
    assert.deepEqual(plan.run, ['flight'])
    assert.deepEqual(plan.waiting, ['later'])
  })

  it('leaves a button out by default, because running one is pressing something on somebody’s behalf', () => {
    const one = spec()
    const built = build(spec({ steps: [{ ...one.steps[0], when: 'button' }] }))
    assert.deepEqual(whatToRun(built.document).run, [])
    assert.deepEqual(whatToRun(built.document).waiting, ['flight'])
  })

  it('includes it when asked, which is what the trial run during generation does', () => {
    const one = spec()
    const built = build(spec({ steps: [{ ...one.steps[0], when: 'button' }] }))
    assert.deepEqual(whatToRun(built.document, true).run, ['flight'])
    assert.deepEqual(whatToRun(built.document, true).waiting, [])
  })

  it('includes a calculation no field reaches, which is what a Page of constants is', () => {
    // 52 choose 5 reads no box. Leaving it out was a Page that opened showing "nothing yet" for ever, because the
    // only thing that ever triggered a calculation was somebody changing something.
    const one = spec()
    const built = build(
      spec({
        inputs: [one.inputs[0]],
        steps: [
          { ...one.steps[0], arguments: { speed: { input: 'speed' }, angle: { value: 45 }, gravity: { value: 9.81 } } },
          { name: 'fixed', operation: 'statistics.summary', arguments: { values: { value: [1, 2, 3] } }, when: 'change' }
        ],
        outputs: [one.outputs[0], { name: 'mean', label: 'Average', display: 'statistic', step: 'fixed', pick: 'mean' }],
        sections: [{ title: 'The throw', members: ['speed'] }, { title: 'Answers', members: ['range', 'mean'] }]
      })
    )
    const plan = whatToRun(built.document)
    assert.deepEqual([...plan.run].sort(), ['fixed', 'flight'])
    assert.deepEqual(plan.waiting, [])
  })

  it('still leaves a literal-only calculation waiting when it waits for a button', () => {
    const one = spec()
    const built = build(
      spec({
        steps: [{ ...one.steps[0], when: 'button' }]
      })
    )
    assert.deepEqual(whatToRun(built.document).run, [])
    assert.deepEqual(whatToRun(built.document).waiting, ['flight'])
  })

  it('runs each calculation once even when several inputs feed it', () => {
    const built = build(spec())
    const plan = whatToRun(built.document, true)
    assert.deepEqual(plan.run, ['flight'])
  })
})
