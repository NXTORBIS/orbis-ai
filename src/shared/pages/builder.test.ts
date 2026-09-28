import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  BUILDER_ASSUMPTIONS,
  BUILDER_LIMITS,
  argumentsFor,
  check,
  computationsAfter,
  initialState,
  setField,
  type Component,
  type Computation,
  type Field,
  type PageDocument
} from './builder.ts'

const field = (over: Partial<Field> & { name: string }): Field => ({
  type: 'number',
  label: over.name,
  ...over
})

const document = (over: Partial<PageDocument> = {}): PageDocument => ({
  fields: [field({ name: 'celsius', label: 'Celsius' }), field({ name: 'fahrenheit', label: 'Fahrenheit', computed: true })],
  components: [
    { id: 'c1', kind: 'number-input', field: 'celsius', label: 'Celsius' },
    { id: 'c2', kind: 'value', field: 'fahrenheit', label: 'Fahrenheit' }
  ],
  computations: [
    {
      name: 'convert',
      operation: 'units.convert',
      inputs: { value: { field: 'celsius' }, from: { value: 'degC' }, to: { value: 'degF' } },
      writes: 'fahrenheit',
      when: 'change'
    }
  ],
  ...over
})

const errors = (result: ReturnType<typeof check>): string[] =>
  result.problems.filter((one) => one.severity === 'error').map((one) => one.code)

const warnings = (result: ReturnType<typeof check>): string[] =>
  result.problems.filter((one) => one.severity === 'warning').map((one) => one.code)

describe('a valid document', () => {
  it('has no errors', () => {
    const result = check(document())
    assert.deepEqual(errors(result), [], JSON.stringify(result.problems))
    assert.equal(result.canRun, true)
  })

  it('reports every operation it uses, so the manifest can be checked against it', () => {
    assert.deepEqual([...check(document()).operations], ['units.convert'])
  })
})

describe('fields', () => {
  it('refuses two fields with the same name', () => {
    const result = check(document({ fields: [field({ name: 'a' }), field({ name: 'a' })] }))
    assert.ok(errors(result).includes('duplicate-field'))
  })

  it('refuses a name that is not a name', () => {
    for (const name of ['1abc', 'has space', '__proto__-ish!', '']) {
      const result = check(document({ fields: [field({ name })] }))
      assert.ok(errors(result).includes('bad-field-name'), `"${name}" was accepted`)
    }
  })

  it('warns about a field with no label', () => {
    const result = check(document({ fields: [field({ name: 'a', label: '' })], components: [], computations: [] }))
    assert.ok(warnings(result).includes('no-label'))
  })

  it('refuses a choice with nothing to choose from', () => {
    const result = check(document({ fields: [field({ name: 'pick', type: 'choice' })], components: [], computations: [] }))
    assert.ok(errors(result).includes('no-options'))
  })

  it('refuses two options that share a value, since only one could ever be chosen', () => {
    const result = check(
      document({
        fields: [field({ name: 'pick', type: 'choice', options: [{ value: 'a', label: 'One' }, { value: 'a', label: 'Two' }] })],
        components: [],
        computations: []
      })
    )
    assert.ok(errors(result).includes('duplicate-option'))
  })

  it('refuses a quantity with no unit, which is what makes it a quantity', () => {
    const result = check(document({ fields: [field({ name: 'length', type: 'quantity' })], components: [], computations: [] }))
    assert.ok(errors(result).includes('no-unit'))
  })

  it('refuses a range whose lowest value is above its highest', () => {
    const result = check(document({ fields: [field({ name: 'n', minimum: 10, maximum: 1 })], components: [], computations: [] }))
    assert.ok(errors(result).includes('bad-range'))
  })

  it('warns about a field nothing uses', () => {
    const result = check(document({ fields: [...document().fields, field({ name: 'orphan' })] }))
    assert.ok(warnings(result).includes('unused-field'))
    assert.deepEqual([...result.unusedFields], ['orphan'])
  })
})

describe('components', () => {
  it('refuses a component connected to a field that does not exist', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'number-input', field: 'nowhere' }] }))
    assert.ok(errors(result).includes('unknown-field'))
  })

  it('refuses a component connected to nothing', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'number-input' }] }))
    assert.ok(errors(result).includes('no-field'))
  })

  it('refuses a component showing a field of the wrong type', () => {
    const result = check(
      document({
        fields: [field({ name: 'name', type: 'text' })],
        components: [{ id: 'c', kind: 'number-input', field: 'name' }],
        computations: []
      })
    )
    assert.ok(errors(result).includes('wrong-field-type'))
  })

  it('refuses an editable component bound to a computed field, whose edits would be overwritten', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'number-input', field: 'fahrenheit' }] }))
    assert.ok(errors(result).includes('editing-computed'))
  })

  it('allows a read-only component bound to a computed field', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'value', field: 'fahrenheit' }, { id: 'd', kind: 'number-input', field: 'celsius' }] }))
    assert.ok(!errors(result).includes('editing-computed'))
  })

  it('refuses two components with the same id', () => {
    const result = check(document({ components: [{ id: 'same', kind: 'divider' }, { id: 'same', kind: 'divider' }] }))
    assert.ok(errors(result).includes('duplicate-component'))
  })

  it('refuses a button that does nothing', () => {
    const result = check(document({ components: [{ id: 'b', kind: 'button', label: 'Go' }] }))
    assert.ok(errors(result).includes('button-does-nothing'))
  })

  it('refuses a button with no label', () => {
    const result = check(document({ components: [{ id: 'b', kind: 'button', runs: 'convert' }] }))
    assert.ok(errors(result).includes('button-unlabelled'))
  })

  it('refuses a button running a computation that does not exist', () => {
    const result = check(document({ components: [{ id: 'b', kind: 'button', label: 'Go', runs: 'nowhere' }] }))
    assert.ok(errors(result).includes('unknown-computation'))
  })

  it('refuses a condition that is not a true/false field', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'divider', showWhen: 'celsius' }] }))
    assert.ok(errors(result).includes('condition-not-boolean'))
  })

  it('refuses a condition naming a field that does not exist', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'divider', showWhen: 'nowhere' }] }))
    assert.ok(errors(result).includes('unknown-condition'))
  })

  it('refuses children on something that cannot hold them', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'divider', children: [{ id: 'd', kind: 'divider' }] }] }))
    assert.ok(errors(result).includes('unexpected-children'))
  })

  it('warns about an empty container', () => {
    const result = check(document({ components: [{ id: 'g', kind: 'group', children: [] }] }))
    assert.ok(warnings(result).includes('empty-container'))
  })

  it('refuses components nested deeper than anybody can follow', () => {
    let deep: Component = { id: 'leaf', kind: 'divider' }
    for (let i = 0; i < BUILDER_LIMITS.depth + 2; i++) deep = { id: `g${i}`, kind: 'group', children: [deep] }
    assert.ok(errors(check(document({ components: [deep] }))).includes('too-deep'))
  })

  it('refuses more components than allowed', () => {
    const many: Component[] = Array.from({ length: BUILDER_LIMITS.components + 1 }, (_, i) => ({ id: `c${i}`, kind: 'divider' }))
    assert.ok(errors(check(document({ components: many }))).includes('too-many-components'))
  })

  it('cannot be walked up a prototype chain by a component kind', () => {
    const result = check(document({ components: [{ id: 'c', kind: 'constructor' as never, field: 'celsius' }] }))
    // Treated as a kind that shows nothing, so the binding is a warning rather than something resolving off the prototype.
    assert.ok(warnings(result).includes('field-ignored'))
  })
})

describe('computations', () => {
  it('refuses a computation writing to a field that does not exist', () => {
    const result = check(
      document({ computations: [{ ...document().computations[0], writes: 'nowhere' }] })
    )
    assert.ok(errors(result).includes('unknown-target'))
  })

  it('refuses a computation reading a field that does not exist', () => {
    const result = check(
      document({ computations: [{ ...document().computations[0], inputs: { value: { field: 'nowhere' } } }] })
    )
    assert.ok(errors(result).includes('unknown-input'))
  })

  it('refuses an operation name that is not one', () => {
    const result = check(document({ computations: [{ ...document().computations[0], operation: 'DROP TABLE' }] }))
    assert.ok(errors(result).includes('bad-operation'))
  })

  it('warns when a computation writes a field nobody marked computed', () => {
    const result = check(
      document({ fields: [field({ name: 'celsius' }), field({ name: 'fahrenheit' })] })
    )
    assert.ok(warnings(result).includes('target-not-computed'))
  })

  it('refuses two computations with the same name', () => {
    const one = document().computations[0]
    assert.ok(errors(check(document({ computations: [one, one] }))).includes('duplicate-computation'))
  })

  it('warns about a computation no button ever runs', () => {
    const result = check(
      document({
        computations: [{ ...document().computations[0], when: 'button' }]
      })
    )
    assert.ok(warnings(result).includes('never-runs'))
  })

  it('does not warn when a button does run it', () => {
    const result = check(
      document({
        components: [...document().components, { id: 'b', kind: 'button', label: 'Convert', runs: 'convert' }],
        computations: [{ ...document().computations[0], when: 'button' }]
      })
    )
    assert.ok(!warnings(result).includes('never-runs'))
  })
})

describe('cycles', () => {
  const cyclic = (names: [string, string][]): PageDocument => ({
    fields: [...new Set(names.flat())].map((name) => field({ name, computed: true })),
    components: [],
    computations: names.map(([from, to]) => ({
      name: `make_${to}`,
      operation: 'expression.evaluate',
      inputs: { value: { field: from } },
      writes: to,
      when: 'change' as const
    }))
  })

  it('refuses a field computed from itself through another', () => {
    const result = check(cyclic([['a', 'b'], ['b', 'a']]))
    assert.ok(errors(result).includes('cycle'), JSON.stringify(result.problems))
  })

  it('refuses a longer circle', () => {
    assert.ok(errors(check(cyclic([['a', 'b'], ['b', 'c'], ['c', 'a']]))).includes('cycle'))
  })

  it('names the loop, so somebody can see which link to break', () => {
    const result = check(cyclic([['a', 'b'], ['b', 'a']]))
    const cycle = result.problems.find((one) => one.code === 'cycle')
    assert.match(cycle?.message ?? '', /→/)
  })

  it('allows a chain that is not a circle', () => {
    const result = check(cyclic([['a', 'b'], ['b', 'c']]))
    assert.ok(!errors(result).includes('cycle'))
  })

  it('does not run forever on a self-referencing computation', () => {
    assert.ok(errors(check(cyclic([['a', 'a']]))).includes('cycle'))
  })
})

describe('starting values', () => {
  it('uses what was given', () => {
    const state = initialState(document({ fields: [field({ name: 'n', initial: 42 })] }))
    assert.equal(state.values.n, 42)
  })

  it('starts a number inside its own range rather than at zero', () => {
    const state = initialState(document({ fields: [field({ name: 'n', minimum: 10, maximum: 20 })] }))
    assert.equal(state.values.n, 10)
  })

  it('starts each type at something sensible', () => {
    const state = initialState(
      document({
        fields: [
          field({ name: 'n', type: 'number' }),
          field({ name: 't', type: 'text' }),
          field({ name: 'b', type: 'boolean' }),
          field({ name: 'c', type: 'choice', options: [{ value: 'x', label: 'X' }] }),
          field({ name: 'q', type: 'quantity', unit: 'm' }),
          field({ name: 'r', type: 'result' })
        ]
      })
    )
    assert.equal(state.values.n, 0)
    assert.equal(state.values.t, '')
    assert.equal(state.values.b, false)
    assert.equal(state.values.c, 'x')
    assert.deepEqual(state.values.q, { value: 0, unit: 'm' })
    // Null, not `{}`: nothing has been worked out, and an empty object looks like a result that came back.
    assert.equal(state.values.r, null)
  })

  it('leaves out a field whose name is not a name', () => {
    const state = initialState(document({ fields: [field({ name: 'bad name' })] }))
    assert.deepEqual(Object.keys(state.values), [])
  })
})

describe('setting a field', () => {
  const doc = document({
    fields: [
      field({ name: 'n', type: 'number', minimum: 0, maximum: 10 }),
      field({ name: 't', type: 'text' }),
      field({ name: 'b', type: 'boolean' }),
      field({ name: 'c', type: 'choice', options: [{ value: 'x', label: 'X' }] })
    ],
    components: [],
    computations: []
  })
  const state = initialState(doc)

  it('sets a valid value', () => {
    const next = setField(doc, state, 'n', 5)
    assert.ok('values' in next)
    assert.equal(next.values.n, 5)
  })

  it('refuses a value of the wrong type rather than coercing it', () => {
    for (const [name, value] of [['n', 'five'], ['t', 5], ['b', 'yes'], ['c', 1]] as [string, unknown][]) {
      const result = setField(doc, state, name, value)
      assert.ok('code' in result, `${name} accepted ${String(value)}`)
      assert.equal(result.code, 'wrong-type')
    }
  })

  it('refuses a number outside its range, and says which end', () => {
    const low = setField(doc, state, 'n', -1)
    const high = setField(doc, state, 'n', 11)
    assert.ok('code' in low && low.code === 'below-minimum')
    assert.ok('code' in high && high.code === 'above-maximum')
  })

  it('refuses a choice that is not one of the options', () => {
    const result = setField(doc, state, 'c', 'not-an-option')
    assert.ok('code' in result && result.code === 'not-an-option')
  })

  it('refuses a field that does not exist', () => {
    const result = setField(doc, state, 'nowhere', 1)
    assert.ok('code' in result && result.code === 'unknown-field')
  })

  it('leaves the original state untouched', () => {
    setField(doc, state, 'n', 7)
    assert.equal(state.values.n, 0)
  })
})

describe('what runs when something changes', () => {
  it('runs a computation that reads the changed field', () => {
    const triggered = computationsAfter(document(), 'celsius')
    assert.deepEqual(triggered.map((one) => one.name), ['convert'])
  })

  it('follows the chain onward', () => {
    const chained: Computation[] = [
      { name: 'first', operation: 'expression.evaluate', inputs: { value: { field: 'a' } }, writes: 'b', when: 'change' },
      { name: 'second', operation: 'expression.evaluate', inputs: { value: { field: 'b' } }, writes: 'c', when: 'change' }
    ]
    const doc = document({
      fields: [field({ name: 'a' }), field({ name: 'b', computed: true }), field({ name: 'c', computed: true })],
      components: [],
      computations: chained
    })
    assert.deepEqual(computationsAfter(doc, 'a').map((one) => one.name), ['first', 'second'])
  })

  it('leaves a button-only computation alone', () => {
    const doc = document({ computations: [{ ...document().computations[0], when: 'button' }] })
    assert.deepEqual(computationsAfter(doc, 'celsius'), [])
  })

  it('runs nothing for a field nothing reads', () => {
    assert.deepEqual(computationsAfter(document(), 'fahrenheit'), [])
  })
})

describe('arguments for a computation', () => {
  it('takes values from fields and literals alike', () => {
    const state = { values: { celsius: 100 } }
    const args = argumentsFor(document().computations[0], state)
    assert.deepEqual(args, { value: 100, from: 'degC', to: 'degF' })
  })

  it('passes undefined for a field with no value rather than inventing one', () => {
    const args = argumentsFor(document().computations[0], { values: {} })
    assert.equal(args.value, undefined)
  })

  it('ignores an argument name that is not a name', () => {
    const computation: Computation = {
      name: 'c',
      operation: 'units.convert',
      inputs: { '__proto__': { value: 1 }, good: { value: 2 } },
      writes: 'x',
      when: 'change'
    }
    const args = argumentsFor(computation, { values: {} })
    assert.deepEqual(Object.keys(args), ['good'])
  })
})

describe('assumptions', () => {
  it('states that a built Page contains no code', () => {
    assert.ok(BUILDER_ASSUMPTIONS.some((one) => /contains no code at all/.test(one)))
  })

  it('states the limit that follows from it', () => {
    assert.ok(BUILDER_ASSUMPTIONS.some((one) => /no place to put custom code/.test(one)))
  })

  it('states that everything is checked before the Page runs', () => {
    assert.ok(BUILDER_ASSUMPTIONS.some((one) => /checked before the Page can run/.test(one)))
  })
})
