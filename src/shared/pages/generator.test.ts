import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  GENERATOR_ASSUMPTIONS,
  checkSpecification,
  generateDataset,
  generateIdentifiers,
  generateSchedule,
  isGeneratorError,
  revise,
  validate,
  type FieldSpec,
  type Specification
} from './generator.ts'

const field = (name: string, options: Partial<FieldSpec> = {}): FieldSpec => ({
  name,
  kind: options.kind ?? 'number',
  // `in` rather than `??`: passing null explicitly has to mean "no distribution", which `??` would silently replace.
  distribution: 'distribution' in options ? (options.distribution ?? null) : { kind: 'normal', mean: 0, standardDeviation: 1 },
  categories: options.categories ?? [],
  bounds: options.bounds ?? { low: null, high: null },
  unique: options.unique ?? false,
  missingRate: options.missingRate ?? 0
})

const spec = (options: Partial<Specification> = {}): Specification => ({
  id: options.id ?? 's1',
  kind: options.kind ?? 'dataset',
  quantity: options.quantity ?? 100,
  fields: options.fields ?? [field('value')],
  constraints: options.constraints ?? [],
  correlations: options.correlations ?? [],
  seed: options.seed ?? 1,
  distinct: options.distinct ?? false,
  describe: options.describe ?? ''
})

describe('specifications', () => {
  test('a categorical field with no categories is refused', () => {
    const check = checkSpecification(spec({ fields: [field('c', { kind: 'category', distribution: null })] }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /no categories to draw from/.test(one)))
  })

  test('a numeric field with neither a distribution nor bounds is refused', () => {
    const check = checkSpecification(spec({ fields: [field('n', { distribution: null })] }))
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /nothing to draw from/.test(one)))
  })

  test('a unique field with fewer possible values than rows is refused, with the arithmetic', () => {
    const check = checkSpecification(
      spec({
        quantity: 100,
        fields: [field('c', { kind: 'category', distribution: null, unique: true, categories: [{ value: 'a', weight: 1 }, { value: 'b', weight: 1 }] })]
      })
    )
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /cannot fill 100 rows/.test(one)))
  })

  test('a unique integer field with too narrow a range is refused', () => {
    const check = checkSpecification(
      spec({ quantity: 100, fields: [field('n', { kind: 'integer', distribution: null, unique: true, bounds: { low: 1, high: 10 } })] })
    )
    assert.equal(check.ok, false)
    assert.ok(check.problems.some((one) => /allow 10 values/.test(one)))
  })

  test('two fields with the same name are refused', () => {
    const check = checkSpecification(spec({ fields: [field('a'), field('a')] }))
    assert.equal(check.ok, false)
  })

  test('a missing rate outside zero to one is refused', () => {
    assert.equal(checkSpecification(spec({ fields: [field('a', { missingRate: 2 })] })).ok, false)
  })

  test('constraints come with a warning about what rejection sampling can do', () => {
    const check = checkSpecification(spec({ constraints: [{ id: 'c', describe: 'x > 0', holds: () => true }] }))
    assert.ok(check.notes.some((one) => /it will say so rather than returning fewer/.test(one)))
  })
})

describe('generating datasets', () => {
  test('the quantity asked for is the quantity produced', () => {
    const result = generateDataset(spec({ quantity: 250 }))
    assert.ok(!isGeneratorError(result))
    assert.equal(result.produced, 250)
    assert.equal(result.requested, 250)
    assert.equal(result.complete, true)
  })

  test('the same specification and seed give the same data', () => {
    const first = generateDataset(spec({ quantity: 50, seed: 7 }))
    const again = generateDataset(spec({ quantity: 50, seed: 7 }))
    assert.ok(!isGeneratorError(first) && !isGeneratorError(again))
    assert.deepEqual(first.items, again.items)
  })

  test('a different seed gives different data', () => {
    const first = generateDataset(spec({ quantity: 50, seed: 1 }))
    const other = generateDataset(spec({ quantity: 50, seed: 2 }))
    assert.ok(!isGeneratorError(first) && !isGeneratorError(other))
    assert.notDeepEqual(first.items, other.items)
  })

  test('bounds are respected', () => {
    const result = generateDataset(spec({ quantity: 500, fields: [field('v', { bounds: { low: -1, high: 1 } })] }))
    assert.ok(!isGeneratorError(result))
    for (const item of result.items) {
      assert.ok((item.v as number) >= -1 && (item.v as number) <= 1)
    }
  })

  test('an integer field produces whole numbers', () => {
    const result = generateDataset(spec({ quantity: 100, fields: [field('n', { kind: 'integer' })] }))
    assert.ok(!isGeneratorError(result))
    assert.ok(result.items.every((one) => Number.isInteger(one.n)))
  })

  test('a categorical field only produces its own categories', () => {
    const result = generateDataset(
      spec({
        quantity: 200,
        fields: [field('c', { kind: 'category', distribution: null, categories: [{ value: 'steel', weight: 3 }, { value: 'aluminium', weight: 1 }] })]
      })
    )
    assert.ok(!isGeneratorError(result))
    assert.ok(result.items.every((one) => one.c === 'steel' || one.c === 'aluminium'))
    // The weights should show up in roughly the right proportion.
    const steel = result.items.filter((one) => one.c === 'steel').length
    assert.ok(Math.abs(steel / 200 - 0.75) < 0.1)
  })

  test('a missing rate produces missing values at roughly that rate', () => {
    const result = generateDataset(spec({ quantity: 1000, fields: [field('v', { missingRate: 0.3 })] }))
    assert.ok(!isGeneratorError(result))
    const missing = result.items.filter((one) => one.v === null).length
    assert.ok(Math.abs(missing / 1000 - 0.3) < 0.05)
  })

  test('a unique field really is unique', () => {
    const result = generateDataset(spec({ quantity: 200, fields: [field('id', { kind: 'integer', distribution: null, unique: true, bounds: { low: 1, high: 100000 } })] }))
    assert.ok(!isGeneratorError(result))
    assert.equal(new Set(result.items.map((one) => one.id)).size, result.items.length)
  })

  test('a constraint is satisfied by every item', () => {
    const result = generateDataset(
      spec({ quantity: 200, constraints: [{ id: 'positive', describe: 'value is positive', holds: (item) => (item.value as number) > 0 }] })
    )
    assert.ok(!isGeneratorError(result))
    assert.ok(result.items.every((one) => (one.value as number) > 0))
    assert.ok(result.rejected > 0)
  })

  test('a constraint too narrow to fill the quantity gives a partial result and says so', () => {
    const result = generateDataset(
      spec({
        quantity: 100,
        // A normal draw is essentially never above 10 standard deviations.
        constraints: [{ id: 'impossible', describe: 'value above 10', holds: (item) => (item.value as number) > 10 }]
      })
    )
    assert.ok(!isGeneratorError(result))
    assert.equal(result.complete, false)
    assert.ok(result.produced < 100)
    assert.ok(result.notes.some((one) => /partial result, not a complete one/.test(one)))
  })

  test('correlated normal fields come out with roughly the correlation asked for', () => {
    const result = generateDataset(
      spec({
        quantity: 4000,
        seed: 5,
        fields: [field('a'), field('b')],
        correlations: [{ a: 'a', b: 'b', value: 0.8 }]
      })
    )
    assert.ok(!isGeneratorError(result))
    const xs = result.items.map((one) => one.a as number)
    const ys = result.items.map((one) => one.b as number)
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length
    const my = ys.reduce((s, v) => s + v, 0) / ys.length
    let cov = 0
    let vx = 0
    let vy = 0
    for (let i = 0; i < xs.length; i++) {
      cov += (xs[i] - mx) * (ys[i] - my)
      vx += (xs[i] - mx) ** 2
      vy += (ys[i] - my) ** 2
    }
    const r = cov / Math.sqrt(vx * vy)
    assert.ok(Math.abs(r - 0.8) < 0.05, `correlation came out ${r}`)
  })

  test('a correlated field with a non-normal distribution is refused rather than approximated', () => {
    const result = generateDataset(
      spec({
        fields: [field('a'), field('b', { distribution: { kind: 'uniform', low: 0, high: 1 } })],
        correlations: [{ a: 'a', b: 'b', value: 0.5 }]
      })
    )
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /not what was asked for/)
  })

  test('correlations that cannot all hold are refused', () => {
    const result = generateDataset(
      spec({
        fields: [field('a'), field('b'), field('c')],
        correlations: [
          { a: 'a', b: 'b', value: -0.9 },
          { a: 'a', b: 'c', value: -0.9 },
          { a: 'b', b: 'c', value: -0.9 }
        ]
      })
    )
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /negative variance/)
  })

  test('a field called __proto__ becomes a field, not a change to the item’s prototype', () => {
    const result = generateDataset(spec({ quantity: 5, fields: [field('__proto__', { kind: 'integer' })] }))
    assert.ok(!isGeneratorError(result))
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.ok(Object.prototype.hasOwnProperty.call(result.items[0], '__proto__'))
  })
})

describe('validation', () => {
  test('the count check catches producing fewer than were asked for', () => {
    const result = validate(spec({ quantity: 500 }), Array.from({ length: 487 }, () => ({ value: 1 })))
    assert.equal(result.ok, false)
    const count = result.results.find((one) => one.rule === 'count')
    assert.equal(count?.passed, false)
    assert.match(count?.detail ?? '', /failure of the request, not a rounding/)
  })

  test('a repeat in a unique field is caught', () => {
    const one = spec({ quantity: 2, fields: [field('id', { unique: true })] })
    const result = validate(one, [{ id: 'a' }, { id: 'a' }])
    assert.equal(result.ok, false)
    assert.ok(result.results.some((r) => r.rule === 'unique:id' && !r.passed))
  })

  test('a value outside its bounds is caught', () => {
    const one = spec({ quantity: 1, fields: [field('v', { bounds: { low: 0, high: 10 } })] })
    const result = validate(one, [{ v: 99 }])
    assert.ok(result.results.some((r) => r.rule === 'bounds:v' && !r.passed))
  })

  test('a fractional value in an integer field is caught', () => {
    const one = spec({ quantity: 1, fields: [field('n', { kind: 'integer' })] })
    assert.ok(validate(one, [{ n: 2.5 }]).results.some((r) => r.rule === 'integer:n' && !r.passed))
  })

  test('a value outside the declared categories is caught', () => {
    const one = spec({ quantity: 1, fields: [field('c', { kind: 'category', distribution: null, categories: [{ value: 'a', weight: 1 }] })] })
    assert.ok(validate(one, [{ c: 'z' }]).results.some((r) => r.rule === 'categories:c' && !r.passed))
  })

  test('a broken constraint is caught, naming it', () => {
    const one = spec({ quantity: 1, constraints: [{ id: 'positive', describe: 'value is positive', holds: (item) => (item.value as number) > 0 }] })
    const result = validate(one, [{ value: -1 }])
    assert.ok(result.results.some((r) => r.rule === 'constraint:positive' && !r.passed))
    assert.match(result.describe, /value is positive/)
  })

  test('generated output passes its own validation', () => {
    const one = spec({
      quantity: 200,
      fields: [field('v', { bounds: { low: -2, high: 2 } }), field('n', { kind: 'integer', distribution: null, bounds: { low: 1, high: 100000 }, unique: true })]
    })
    const generated = generateDataset(one)
    assert.ok(!isGeneratorError(generated))
    assert.equal(validate(one, generated.items).ok, true)
  })

  test('an extra rule can be supplied and is run', () => {
    const result = validate(spec({ quantity: 1 }), [{ value: 1 }], [
      { id: 'custom', describe: '', check: () => ({ passed: false, detail: 'a custom rule failed' }) }
    ])
    assert.equal(result.ok, false)
    assert.ok(result.results.some((one) => one.rule === 'custom'))
  })
})

describe('schedules', () => {
  const item = (id: string, duration: number, notBefore = 0, notAfter = 100, resource = 'room'): ScheduleItem => ({
    id,
    label: id,
    duration,
    resource,
    notBefore,
    notAfter
  })
  type ScheduleItem = { id: string; label: string; duration: number; resource: string; notBefore: number; notAfter: number }

  test('items are placed without overlapping on a resource', () => {
    const result = generateSchedule({ items: [item('a', 10), item('b', 10), item('c', 10)], blocked: [], horizon: 100, seed: 1 })
    assert.ok(!isGeneratorError(result))
    assert.equal(result.produced, 3)
    for (let i = 1; i < result.items.length; i++) {
      assert.ok(result.items[i].start >= result.items[i - 1].start + result.items[i - 1].duration)
    }
  })

  test('items on different resources can run at the same time', () => {
    const result = generateSchedule({ items: [item('a', 10, 0, 100, 'r1'), item('b', 10, 0, 100, 'r2')], blocked: [], horizon: 100, seed: 1 })
    assert.ok(!isGeneratorError(result))
    assert.equal(result.items[0].start, result.items[1].start)
  })

  test('a blocked window is avoided', () => {
    const result = generateSchedule({ items: [item('a', 10)], blocked: [{ from: 0, to: 20, resource: 'room' }], horizon: 100, seed: 1 })
    assert.ok(!isGeneratorError(result))
    assert.ok(result.items[0].start >= 20)
  })

  test('an item that cannot be placed is left unplaced rather than squeezed in', () => {
    const result = generateSchedule({
      items: [item('a', 10, 0, 20), item('b', 10, 0, 20), item('c', 10, 0, 20)],
      blocked: [],
      horizon: 100,
      seed: 1
    })
    assert.ok(!isGeneratorError(result))
    assert.equal(result.complete, false)
    assert.equal(result.unplaced.length, 1)
    assert.match(result.unplaced[0].why, /rather than put somewhere that breaks a constraint/)
  })

  test('a window too narrow for the item is refused up front', () => {
    const result = generateSchedule({ items: [item('a', 50, 0, 10)], blocked: [], horizon: 100, seed: 1 })
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /No placement fits it/)
  })

  test('a non-positive duration is refused', () => {
    assert.ok(isGeneratorError(generateSchedule({ items: [item('a', 0)], blocked: [], horizon: 100, seed: 1 })))
  })
})

describe('identifiers', () => {
  test('identifiers are unique and the right length', () => {
    const result = generateIdentifiers(1000, { seed: 3, length: 10 })
    assert.ok(!isGeneratorError(result))
    assert.equal(result.produced, 1000)
    assert.equal(new Set(result.items).size, 1000)
    assert.ok(result.items.every((one) => one.length === 10))
  })

  test('a prefix is applied', () => {
    const result = generateIdentifiers(10, { prefix: 'ord-' })
    assert.ok(!isGeneratorError(result))
    assert.ok(result.items.every((one) => one.startsWith('ord-')))
  })

  test('the same seed gives the same identifiers', () => {
    const first = generateIdentifiers(20, { seed: 11 })
    const again = generateIdentifiers(20, { seed: 11 })
    assert.ok(!isGeneratorError(first) && !isGeneratorError(again))
    assert.deepEqual(first.items, again.items)
  })

  test('the determinism is stated as making them unsuitable for anything unguessable', () => {
    const result = generateIdentifiers(5)
    assert.ok(!isGeneratorError(result))
    assert.ok(result.notes.some((one) => /not for anything that has to be unguessable/.test(one)))
  })

  test('asking for too many of too short an identifier is refused', () => {
    const result = generateIdentifiers(1_000_000, { length: 4 })
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /makes repeats likely/)
  })
})

describe('revision', () => {
  test('the original specification is never modified', () => {
    const original = spec({ quantity: 100 })
    const result = revise(original, [{ kind: 'quantity', to: 200 }])
    assert.ok(!isGeneratorError(result))
    assert.equal(original.quantity, 100)
    assert.equal(result.specification.quantity, 200)
    assert.match(result.describe, /the original is unchanged/)
  })

  test('a field can be added and removed', () => {
    const added = revise(spec(), [{ kind: 'add-field', field: field('extra') }])
    assert.ok(!isGeneratorError(added))
    assert.equal(added.specification.fields.length, 2)

    const removed = revise(added.specification, [{ kind: 'remove-field', name: 'extra' }])
    assert.ok(!isGeneratorError(removed))
    assert.equal(removed.specification.fields.length, 1)
  })

  test('removing a field that a correlation uses is refused', () => {
    const one = spec({ fields: [field('a'), field('b')], correlations: [{ a: 'a', b: 'b', value: 0.5 }] })
    const result = revise(one, [{ kind: 'remove-field', name: 'a' }])
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /Remove the correlation first/)
  })

  test('a revision that makes the specification impossible is refused', () => {
    const one = spec({ quantity: 5, fields: [field('c', { kind: 'category', distribution: null, unique: true, categories: [{ value: 'a', weight: 1 }, { value: 'b', weight: 1 }, { value: 'c', weight: 1 }, { value: 'd', weight: 1 }, { value: 'e', weight: 1 }] })] })
    const result = revise(one, [{ kind: 'quantity', to: 100 }])
    assert.ok(isGeneratorError(result))
    assert.match(result.message, /cannot be satisfied/)
  })

  test('a duplicate field is refused', () => {
    assert.ok(isGeneratorError(revise(spec(), [{ kind: 'add-field', field: field('value') }])))
  })

  test('no changes is reported as no changes', () => {
    const result = revise(spec(), [])
    assert.ok(!isGeneratorError(result))
    assert.equal(result.describe, 'Nothing changed.')
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(GENERATOR_ASSUMPTIONS.length >= 8)
    assert.ok(GENERATOR_ASSUMPTIONS.some((one) => /Producing fewer is a partial result/.test(one)))
    assert.ok(GENERATOR_ASSUMPTIONS.some((one) => /has to be unguessable/.test(one)))
    assert.ok(GENERATOR_ASSUMPTIONS.some((one) => /a hole is more useful than a conflict/.test(one)))
  })
})
