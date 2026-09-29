import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { check, initialState, setField, argumentsFor, computationsAfter } from './builder.ts'
import { capabilitiesFor, compile, isCompileError, iconFor, categoriesFor, resultFieldFor } from './compiler.ts'
import { checkSpec, readSpec, SPEC_LIMITS, SPEC_VERSION, specErrors, type PageSpec } from './spec.ts'

/** A small operation table, so these tests do not depend on how many engines exist today. */
const OPERATIONS: Readonly<Record<string, string>> = Object.freeze({
  'units.convert': 'computation.units',
  'statistics.summary': 'computation.statistics',
  'motion.projectile': 'computation.physics',
  'plot.series': 'computation.plot'
})

const minimal = (): PageSpec => ({
  specVersion: SPEC_VERSION,
  title: 'Projectile Range',
  purpose: 'Work out how far something thrown at an angle travels before it lands.',
  inputs: [
    { name: 'speed', kind: 'number', label: 'Speed', initial: 20, minimum: 0, maximum: 200 },
    { name: 'angle', kind: 'number', label: 'Angle', initial: 45, minimum: 0, maximum: 90 }
  ],
  steps: [
    {
      name: 'flight',
      operation: 'motion.projectile',
      arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, gravity: { value: 9.81 } },
      when: 'change',
      describe: 'The trajectory with no air resistance'
    }
  ],
  outputs: [{ name: 'range', label: 'Range', display: 'statistic', step: 'flight', pick: 'range' }],
  sections: [
    { title: 'The throw', members: ['speed', 'angle'] },
    { title: 'Where it lands', members: ['range'] }
  ],
  notes: ['There is no air resistance in this calculation.'],
  keywords: ['projectile', 'range']
})

const errorCodes = (spec: unknown): string[] => specErrors(checkSpec(spec, OPERATIONS).problems).map((one) => one.code)

describe('checkSpec', () => {
  it('accepts a specification that describes a working Page', () => {
    const checked = checkSpec(minimal(), OPERATIONS)
    assert.deepEqual(specErrors(checked.problems), [])
    assert.ok(checked.usable)
    assert.deepEqual(checked.operations, ['motion.projectile'])
  })

  it('refuses anything that is not an object', () => {
    for (const bad of [null, 'a spec', 42, [], undefined]) {
      assert.deepEqual(errorCodes(bad), ['not-a-spec'])
    }
  })

  it('refuses a version it does not build, and says so rather than guessing', () => {
    assert.deepEqual(errorCodes({ ...minimal(), specVersion: 2 }), ['wrong-version'])
    // And stops there: reading the rest of a spec written against a format this version does not know would be
    // reporting problems against rules that may not apply to it.
    assert.equal(checkSpec({ specVersion: 2 }, OPERATIONS).problems.length, 1)
  })

  // ------------------------------------------------------------ the security boundary

  it('refuses an operation Orbis does not have', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], operation: 'secrets.read' }]
    // The first error, and then the ones that follow from it: the output showing that step, and the section showing
    // that output. All of them are reported, because fixing only the one named is rarely the whole fix.
    assert.equal(errorCodes({ ...spec, steps })[0], 'unknown-operation')
  })

  it('refuses an operation that is on Object.prototype rather than in the table', () => {
    // `OPERATIONS['constructor']` on a plain object is truthy. A membership test written with `in` or a plain lookup
    // would let `constructor` through, and this is exactly the shape of thing a generated spec might contain.
    const spec = minimal()
    for (const sneaky of ['constructor', 'to-string', 'has-own-property']) {
      const steps = [{ ...spec.steps[0], operation: `object.${sneaky}` }]
      assert.equal(errorCodes({ ...spec, steps })[0], 'unknown-operation', sneaky)
    }
  })

  it('has nowhere to put a capability, a URL or a script', () => {
    // Not a test of a rule; a test that there is no field. Anything extra is simply not read, and the compiled Page
    // below therefore cannot carry it.
    const spec = {
      ...minimal(),
      capabilities: ['secrets.read'],
      url: 'https://example.invalid/steal',
      script: 'fetch("https://example.invalid")'
    }
    const checked = checkSpec(spec, OPERATIONS)
    assert.deepEqual(specErrors(checked.problems), [])
    const compiled = compile(spec, { operations: OPERATIONS, pageId: 'page_' + 'a'.repeat(24) })
    assert.ok(!isCompileError(compiled))
    assert.deepEqual(compiled.manifest.capabilities, ['computation.physics'])
    assert.equal(JSON.stringify(compiled.document).includes('example.invalid'), false)
  })

  it('refuses a literal carrying a reserved key', () => {
    const spec = minimal()
    // An object literal written with `__proto__:` sets the prototype rather than a key, so the key is defined
    // explicitly -- which is also the only way a spec that arrived as parsed JSON could be carrying one.
    const argument: Record<string, unknown> = {}
    Object.defineProperty(argument, '__proto__', { value: { polluted: true }, enumerable: true, writable: true, configurable: true })
    const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, extra: { value: argument } } }]
    assert.equal(errorCodes({ ...spec, steps })[0], 'literal-reserved-key')
  })

  it('refuses text with characters that do not print', () => {
    for (const nasty of ['Range‮egnaR', 'Range\u0000', 'Ra​nge']) {
      assert.equal(errorCodes({ ...minimal(), title: nasty })[0], 'text-has-control-characters', JSON.stringify(nasty))
    }
  })

  it('refuses a literal that is not data', () => {
    const spec = minimal()
    for (const bad of [Number.POSITIVE_INFINITY, Number.NaN]) {
      const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, gravity: { value: bad } } }]
      assert.equal(errorCodes({ ...spec, steps })[0], 'literal-not-finite', String(bad))
    }
    const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, gravity: { value: () => 9.81 } } }]
    assert.equal(errorCodes({ ...spec, steps })[0], 'literal-not-data')
  })

  it('refuses a literal that is too deep or too wide', () => {
    const spec = minimal()
    let deep: unknown = 1
    for (let i = 0; i <= SPEC_LIMITS.literalDepth + 1; i++) deep = { inner: deep }
    let steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, gravity: { value: deep } } }]
    assert.equal(errorCodes({ ...spec, steps })[0], 'literal-too-deep')

    steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, gravity: { value: new Array(SPEC_LIMITS.literalItems + 1).fill(0) } } }]
    assert.equal(errorCodes({ ...spec, steps })[0], 'literal-too-many')
  })

  // ------------------------------------------------------------ references

  it('refuses a step reading an input that is not there', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, speed: { input: 'nothing' } } }]
    assert.equal(errorCodes({ ...spec, steps })[0], 'unknown-input')
  })

  it('refuses a step reading a later step, so the order in the list is the order things happen', () => {
    const spec = minimal()
    const steps = [
      { ...spec.steps[0], arguments: { ...spec.steps[0].arguments, extra: { step: 'second', pick: 'range' } } },
      { name: 'second', operation: 'statistics.summary', arguments: { values: { value: [1, 2] } }, when: 'change' as const }
    ]
    assert.ok(errorCodes({ ...spec, steps }).includes('unknown-step'))
  })

  it('allows a step reading an earlier one', () => {
    const spec = minimal()
    const checked = checkSpec(
      {
        ...spec,
        steps: [
          ...spec.steps,
          { name: 'spread', operation: 'statistics.summary', arguments: { values: { step: 'flight', pick: 'path' } }, when: 'change' }
        ],
        outputs: [...spec.outputs, { name: 'mean', label: 'Mean height', display: 'statistic', step: 'spread', pick: 'mean' }],
        sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      },
      OPERATIONS
    )
    assert.deepEqual(specErrors(checked.problems), [])
    assert.deepEqual(checked.operations, ['motion.projectile', 'statistics.summary'])
  })

  it('refuses a pick that is a path rather than a name', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, angle: { input: 'angle' } } }]
    const withChain = {
      ...spec,
      steps: [
        ...steps,
        { name: 'after', operation: 'statistics.summary', arguments: { values: { step: 'flight', pick: 'path.0.x' } }, when: 'change' as const }
      ],
      outputs: [...spec.outputs, { name: 'mean', label: 'Mean', display: 'statistic' as const, step: 'after', pick: 'mean' }],
      sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
    }
    assert.equal(errorCodes(withChain)[0], 'bad-pick')
  })

  it('refuses an argument that comes from two places, or from none', () => {
    const spec = minimal()
    // Deliberately malformed, so the arguments are typed as what actually arrives -- parsed JSON -- rather than as
    // the shape the spec is supposed to have.
    const withBoth: Record<string, unknown> = { speed: { input: 'speed', value: 3 }, angle: { input: 'angle' } }
    const withNeither: Record<string, unknown> = { speed: {}, angle: { input: 'angle' } }
    for (const bad of [withBoth, withNeither]) {
      const steps = [{ ...spec.steps[0], arguments: bad }]
      assert.equal(errorCodes({ ...spec, steps })[0], 'ambiguous-argument')
    }
  })

  it('refuses one name used for two things', () => {
    const spec = minimal()
    assert.deepEqual(errorCodes({ ...spec, steps: [{ ...spec.steps[0], name: 'speed' }] }).slice(0, 1), ['duplicate-name'])
    assert.deepEqual(
      errorCodes({ ...spec, outputs: [{ ...spec.outputs[0], name: 'flight' }] }).slice(0, 1),
      ['duplicate-name']
    )
  })

  it('insists that a single-number display says which number', () => {
    const spec = minimal()
    const outputs = [{ name: 'range', label: 'Range', display: 'statistic' as const, step: 'flight' }]
    assert.equal(errorCodes({ ...spec, outputs })[0], 'nothing-picked')
  })

  it('does not require a pick for a plot or a table, which show the whole result', () => {
    const spec = minimal()
    const outputs = [{ name: 'path', label: 'Path', display: 'plot' as const, step: 'flight' }]
    const sections = [spec.sections[0], { title: 'Where it lands', members: ['path'] }]
    assert.deepEqual(specErrors(checkSpec({ ...spec, outputs, sections }, OPERATIONS).problems), [])
  })

  // ------------------------------------------------------------ layout

  it('refuses something shown twice, or not at all', () => {
    const spec = minimal()
    assert.equal(errorCodes({ ...spec, sections: [{ title: 'All', members: ['speed', 'angle', 'range', 'speed'] }] })[0], 'placed-twice')
    assert.deepEqual(errorCodes({ ...spec, sections: [{ title: 'Some', members: ['speed', 'angle'] }] }), ['not-placed'])
  })

  it('refuses a section naming something that is not part of the Page', () => {
    const spec = minimal()
    const sections = [spec.sections[0], { title: 'Where it lands', members: ['range', 'flight'] }]
    // `flight` is a step, and a step is not shown directly -- an output shows it.
    assert.ok(errorCodes({ ...spec, sections }).includes('unknown-member'))
  })

  // ------------------------------------------------------------ things that are only warnings

  it('warns rather than refuses when a control does nothing', () => {
    const spec = minimal()
    const inputs = [...spec.inputs, { name: 'unused', kind: 'number' as const, label: 'Unused' }]
    const sections = [{ title: 'The throw', members: ['speed', 'angle', 'unused'] }, spec.sections[1]]
    const checked = checkSpec({ ...spec, inputs, sections }, OPERATIONS)
    assert.deepEqual(specErrors(checked.problems), [])
    assert.ok(checked.problems.some((one) => one.code === 'input-goes-nowhere'))
  })

  it('warns when a Page states no limits at all', () => {
    const checked = checkSpec({ ...minimal(), notes: [] }, OPERATIONS)
    assert.deepEqual(specErrors(checked.problems), [])
    assert.ok(checked.problems.some((one) => one.code === 'no-limits-stated'))
  })

  it('refuses a Page that calculates nothing or shows nothing', () => {
    const spec = minimal()
    assert.ok(errorCodes({ ...spec, steps: [], outputs: [], sections: [{ title: 'The throw', members: ['speed', 'angle'] }] }).includes('nothing-computed'))
  })

  it('caps every list', () => {
    const spec = minimal()
    const inputs = new Array(SPEC_LIMITS.inputs + 1).fill(0).map((_, i) => ({ name: `a${i}`, kind: 'number' as const, label: `A${i}` }))
    assert.ok(errorCodes({ ...spec, inputs }).includes('list-too-long'))
  })
})

describe('checking arguments against what an operation really takes', () => {
  const SIGNATURES = {
    'motion.projectile': { speed: { optional: false }, angle: { optional: false }, gravity: { optional: true } }
  }

  it('accepts a step giving exactly what the operation takes', () => {
    assert.deepEqual(specErrors(checkSpec(minimal(), OPERATIONS, SIGNATURES).problems), [])
  })

  it('accepts one that leaves out an argument that may be left out', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, angle: { input: 'angle' } } }]
    assert.deepEqual(specErrors(checkSpec({ ...spec, steps }, OPERATIONS, SIGNATURES).problems), [])
  })

  it('refuses an argument the operation does not take, and says what it does', () => {
    // The quiet failure: the engine ignores it, the Page works, and a control somebody moves does nothing.
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, velocity: { input: 'speed' } } }]
    const problems = specErrors(checkSpec({ ...spec, steps }, OPERATIONS, SIGNATURES).problems)
    assert.equal(problems[0].code, 'no-such-argument')
    assert.ok(problems[0].message.includes('It takes speed, angle, gravity'))
  })

  it('refuses a required argument that was left out, rather than letting the engine refuse it later', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, gravity: { value: 9.81 } } }]
    const problems = specErrors(checkSpec({ ...spec, steps }, OPERATIONS, SIGNATURES).problems)
    assert.equal(problems[0].code, 'missing-argument')
    assert.ok(problems[0].message.includes('needs \"angle\"'))
  })

  it('refuses a choice the engine has never heard of, and says what it accepts', () => {
    const withChoice = {
      'motion.projectile': {
        speed: { optional: false },
        angle: { optional: false },
        mode: { optional: true, options: ['flat', 'from-height'] }
      }
    }
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, mode: { value: 'ballistic' } } }]
    const problems = specErrors(checkSpec({ ...spec, steps }, OPERATIONS, withChoice).problems)
    assert.equal(problems[0].code, 'not-an-option')
    assert.ok(problems[0].message.includes('flat, from-height'))
  })

  it('accepts a choice that is one of them', () => {
    const withChoice = {
      'motion.projectile': { speed: { optional: false }, angle: { optional: false }, mode: { optional: true, options: ['flat'] } }
    }
    const spec = minimal()
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, mode: { value: 'flat' } } }]
    assert.deepEqual(specErrors(checkSpec({ ...spec, steps }, OPERATIONS, withChoice).problems), [])
  })

  it('does not second-guess a choice that comes from an input', () => {
    // Whatever somebody picks on the day. The input's own options were checked when it was read.
    const withChoice = {
      'motion.projectile': { speed: { optional: false }, angle: { optional: false }, mode: { optional: true, options: ['flat'] } }
    }
    const spec = minimal()
    const inputs = [
      ...spec.inputs,
      { name: 'mode', kind: 'choice' as const, label: 'Ground', options: [{ value: 'flat', label: 'Flat' }] }
    ]
    const steps = [{ ...spec.steps[0], arguments: { speed: { input: 'speed' }, angle: { input: 'angle' }, mode: { input: 'mode' } } }]
    const sections = [{ title: 'The throw', members: ['speed', 'angle', 'mode'] }, spec.sections[1]]
    assert.deepEqual(specErrors(checkSpec({ ...spec, inputs, steps, sections }, OPERATIONS, withChoice).problems), [])
  })

  it('checks nothing for an operation it has no signature for, rather than assuming it takes nothing', () => {
    const spec = minimal()
    const steps = [
      ...spec.steps,
      { name: 'spread', operation: 'statistics.summary', arguments: { anything: { input: 'speed' } }, when: 'change' as const }
    ]
    const withOutput = {
      ...spec,
      steps,
      outputs: [...spec.outputs, { name: 'mean', label: 'Mean', display: 'statistic' as const, step: 'spread', pick: 'mean' }],
      sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
    }
    assert.deepEqual(specErrors(checkSpec(withOutput, OPERATIONS, SIGNATURES).problems), [])
  })

  it('does not find a signature on Object.prototype', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], operation: 'motion.constructor' }]
    // Refused for not existing at all, which is the first gate; the point is that it is not silently signatureless.
    assert.equal(specErrors(checkSpec({ ...spec, steps }, OPERATIONS, SIGNATURES).problems)[0].code, 'unknown-operation')
  })
})

describe('readSpec', () => {
  it('normalises rather than leaving what a model happened to type', () => {
    const read = readSpec({ ...minimal(), title: '  Projectile Range  ', keywords: [' Projectile ', 'RANGE'] }, OPERATIONS)
    assert.ok('spec' in read)
    assert.equal(read.spec.title, 'Projectile Range')
    assert.deepEqual(read.spec.keywords, ['projectile', 'range'])
  })

  it('returns only the errors when a spec is unusable, never a half-read spec', () => {
    const read = readSpec({ ...minimal(), steps: [] }, OPERATIONS)
    assert.ok('problems' in read)
    assert.ok(read.problems.every((one) => one.severity === 'error'))
  })

  it('fills a choice default from the first option rather than leaving it empty', () => {
    const spec = minimal()
    const inputs = [
      ...spec.inputs,
      { name: 'surface', kind: 'choice' as const, label: 'Surface', options: [{ value: 'grass', label: 'Grass' }, { value: 'sand', label: 'Sand' }] }
    ]
    const steps = [{ ...spec.steps[0], arguments: { ...spec.steps[0].arguments, surface: { input: 'surface' } } }]
    const sections = [{ title: 'The throw', members: ['speed', 'angle', 'surface'] }, spec.sections[1]]
    const read = readSpec({ ...spec, inputs, steps, sections }, OPERATIONS)
    assert.ok('spec' in read)
    assert.equal(read.spec.inputs[2].initial, 'grass')
  })
})

describe('compile', () => {
  const pageId = 'page_a1b2c3d4e5f6a7b8c9d0e1f2'

  it('produces a document the builder will run', () => {
    const compiled = compile(minimal(), { operations: OPERATIONS, pageId })
    assert.ok(!isCompileError(compiled))
    const checked = check(compiled.document)
    assert.deepEqual(
      checked.problems.filter((one) => one.severity === 'error'),
      []
    )
    assert.ok(checked.canRun)
    assert.deepEqual(checked.operations, ['motion.projectile'])
  })

  it('derives the capabilities from the calculations and nothing else', () => {
    const compiled = compile(minimal(), { operations: OPERATIONS, pageId })
    assert.ok(!isCompileError(compiled))
    assert.deepEqual(compiled.manifest.capabilities, ['computation.physics'])
    assert.equal(compiled.manifest.owner, 'orion')
  })

  it('adds storage only when Orbis says so, never because the description asked', () => {
    const plain = compile(minimal(), { operations: OPERATIONS, pageId })
    const stored = compile(minimal(), { operations: OPERATIONS, pageId, allowStorage: true })
    assert.ok(!isCompileError(plain) && !isCompileError(stored))
    assert.equal(plain.manifest.capabilities.includes('storage.page'), false)
    assert.deepEqual(stored.manifest.capabilities, ['computation.physics', 'storage.page'])
    assert.ok(stored.manifest.capabilityReasons['storage.page'].length > 0)
  })

  it('marks every generated Page as generated, so nothing has to read it to know', () => {
    const compiled = compile(minimal(), { operations: OPERATIONS, pageId })
    assert.ok(!isCompileError(compiled))
    assert.ok(compiled.manifest.categories.includes('generated'))
    assert.ok(compiled.manifest.limitations[0].includes('nobody has reviewed'))
  })

  it('takes a slug that is not already used', () => {
    const compiled = compile(minimal(), { operations: OPERATIONS, pageId, taken: ['projectile-range', 'projectile-range-2'] })
    assert.ok(!isCompileError(compiled))
    assert.equal(compiled.manifest.slug, 'projectile-range-3')
  })

  it('refuses a specification it cannot build, and says everything that is wrong', () => {
    const compiled = compile({ ...minimal(), steps: [{ ...minimal().steps[0], operation: 'secrets.read' }] }, { operations: OPERATIONS, pageId })
    assert.ok(isCompileError(compiled))
    assert.equal(compiled.error, 'spec-rejected')
    assert.ok(compiled.problems.some((one) => one.code === 'unknown-operation'))
  })

  it('makes a slider only when both ends are known', () => {
    const spec = minimal()
    const inputs = [spec.inputs[0], { name: 'angle', kind: 'number' as const, label: 'Angle', initial: 45 }]
    const compiled = compile({ ...spec, inputs }, { operations: OPERATIONS, pageId })
    assert.ok(!isCompileError(compiled))
    const section = compiled.document.components[0].children ?? []
    assert.equal(section[0].kind, 'slider')
    assert.equal(section[1].kind, 'number-input')
  })

  it('puts a button beside the inputs, where the hand already is', () => {
    const spec = minimal()
    const steps = [{ ...spec.steps[0], when: 'button' as const }]
    const compiled = compile({ ...spec, steps }, { operations: OPERATIONS, pageId })
    assert.ok(!isCompileError(compiled))
    const first = compiled.document.components[0].children ?? []
    assert.equal(first[first.length - 1].kind, 'button')
    assert.equal(first[first.length - 1].runs, 'flight')
    // And the button check in `builder` is satisfied, so it is not a computation that never runs.
    assert.equal(
      check(compiled.document).problems.some((one) => one.code === 'never-runs'),
      false
    )
  })

  it('carries a chain through as a pick rather than a second calculation', () => {
    const spec = minimal()
    const compiled = compile(
      {
        ...spec,
        steps: [
          ...spec.steps,
          { name: 'spread', operation: 'statistics.summary', arguments: { values: { step: 'flight', pick: 'path' } }, when: 'change' }
        ],
        outputs: [...spec.outputs, { name: 'mean', label: 'Mean', display: 'statistic', step: 'spread', pick: 'mean' }],
        sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      },
      { operations: OPERATIONS, pageId }
    )
    assert.ok(!isCompileError(compiled))
    const spread = compiled.document.computations.find((one) => one.name === 'spread')
    assert.deepEqual(spread?.inputs.values, { field: resultFieldFor('flight'), pick: 'path' })
    assert.deepEqual(compiled.manifest.capabilities, ['computation.physics', 'computation.statistics'])
  })
})

describe('a compiled Page actually runs', () => {
  it('recomputes when an input changes, with the arguments the spec named', () => {
    const compiled = compile(minimal(), { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' })
    assert.ok(!isCompileError(compiled))
    const state = initialState(compiled.document)
    const after = setField(compiled.document, state, 'speed', 30)
    assert.ok(!('at' in after), 'setting a number within its range is accepted')
    const triggered = computationsAfter(compiled.document, 'speed')
    assert.deepEqual(triggered.map((one) => one.name), ['flight'])
    assert.deepEqual(argumentsFor(triggered[0], after), { speed: 30, angle: 45, gravity: 9.81 })
  })

  it('picks one property out of a result rather than passing the whole thing on', () => {
    const spec = minimal()
    const compiled = compile(
      {
        ...spec,
        steps: [
          ...spec.steps,
          { name: 'spread', operation: 'statistics.summary', arguments: { values: { step: 'flight', pick: 'path' } }, when: 'change' }
        ],
        outputs: [...spec.outputs, { name: 'mean', label: 'Mean', display: 'statistic', step: 'spread', pick: 'mean' }],
        sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      },
      { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' }
    )
    assert.ok(!isCompileError(compiled))
    const state = initialState(compiled.document)
    const withResult = { values: { ...state.values, [resultFieldFor('flight')]: { range: 40.8, path: [1, 2, 3] } } }
    const spread = compiled.document.computations.find((one) => one.name === 'spread')
    assert.deepEqual(argumentsFor(spread!, withResult), { values: [1, 2, 3] })
  })

  it('gives undefined, not the whole result, when the step it picks from has not run', () => {
    // A generated Page opens with nothing computed. Passing the whole empty result to the next engine would have it
    // refused for a reason naming the wrong argument.
    const spec = minimal()
    const compiled = compile(
      {
        ...spec,
        steps: [
          ...spec.steps,
          { name: 'spread', operation: 'statistics.summary', arguments: { values: { step: 'flight', pick: 'path' } }, when: 'change' }
        ],
        outputs: [...spec.outputs, { name: 'mean', label: 'Mean', display: 'statistic', step: 'spread', pick: 'mean' }],
        sections: [spec.sections[0], { title: 'Where it lands', members: ['range', 'mean'] }]
      },
      { operations: OPERATIONS, pageId: 'page_a1b2c3d4e5f6a7b8c9d0e1f2' }
    )
    assert.ok(!isCompileError(compiled))
    const state = initialState(compiled.document)
    const spread = compiled.document.computations.find((one) => one.name === 'spread')
    assert.deepEqual(argumentsFor(spread!, state), { values: undefined })
  })
})

describe('capabilitiesFor', () => {
  it('collapses several calculations needing the same permission into one request', () => {
    const table = { 'a.one': 'computation.maths', 'a.two': 'computation.maths' }
    assert.deepEqual(capabilitiesFor(['a.one', 'a.two'], table), { capabilities: ['computation.maths'] })
  })

  it('names the operation it has no capability for rather than skipping it', () => {
    assert.deepEqual(capabilitiesFor(['a.one'], {}), { missing: 'a.one' })
  })
})

describe('icons and categories', () => {
  it('takes an icon from what the Page computes, not from what it is called', () => {
    assert.equal(iconFor(['motion.projectile']), 'target')
    assert.equal(iconFor(['units.convert']), 'ruler')
    // Two families is no family, so the neutral one.
    assert.equal(iconFor(['motion.projectile', 'units.convert']), 'square-function')
    assert.equal(iconFor(['unheard.of']), 'square-function')
  })

  it('files a generated Page under generated, first', () => {
    assert.deepEqual(categoriesFor(['motion.projectile', 'units.convert']), ['generated', 'generated.motion', 'generated.units'])
  })
})
