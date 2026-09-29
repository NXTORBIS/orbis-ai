import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  check,
  COMPARISONS,
  COMPARISON_WORDS,
  feasible,
  isConstraintError,
  narrow,
  plain,
  rank,
  valuesFrom,
  type Constraint,
  type ConstraintError
} from './constraints.ts'

/**
 * Unwraps a result that may be an error.
 *
 * `Exclude` rather than a plain `T`: with a plain one, TypeScript solves `T | ConstraintError` by setting `T` to the whole
 * union, so every use site stays unnarrowed and the compiler stops checking field names on it.
 */
const ok = <T>(value: T): Exclude<T, ConstraintError> => {
  assert.ok(!isConstraintError(value), isConstraintError(value) ? value.message : '')
  return value as Exclude<T, ConstraintError>
}

const range = (id: string, variable: string, extra: Partial<Extract<Constraint, { kind: 'range' }>> = {}): Constraint => ({
  kind: 'range',
  id,
  label: id,
  variable,
  ...extra
})

describe('range constraints', () => {
  it('passes a value inside its range and reports the room to spare', () => {
    const report = ok(check([range('r', 'x', { minimum: plain(0), maximum: plain(10) })], valuesFrom({ x: 4 })))
    assert.equal(report.checks[0]?.status, 'satisfied')
    assert.equal(report.checks[0]?.margin, 4)
    assert.equal(report.allSatisfied, true)
  })

  it('fails a value outside and says which end', () => {
    const report = ok(check([range('r', 'x', { minimum: plain(0), maximum: plain(10) })], valuesFrom({ x: 12 })))
    assert.equal(report.checks[0]?.status, 'violated')
    assert.match(report.checks[0]?.why ?? '', /above the maximum/)
    assert.equal(report.allSatisfied, false)
  })

  it('marks a value exactly on the limit as binding', () => {
    const report = ok(check([range('r', 'x', { maximum: plain(10) })], valuesFrom({ x: 10 })))
    assert.equal(report.checks[0]?.status, 'satisfied')
    assert.equal(report.checks[0]?.binding, true)
    assert.match(report.checks[0]?.why ?? '', /holding the answer where it is/)
    assert.deepEqual([...report.binding], ['r'])
  })

  it('honours an exclusive bound', () => {
    const inclusive = ok(check([range('r', 'x', { maximum: plain(10) })], valuesFrom({ x: 10 })))
    const exclusive = ok(check([range('r', 'x', { maximum: plain(10), maximumInclusive: false })], valuesFrom({ x: 10 })))
    assert.equal(inclusive.checks[0]?.status, 'satisfied')
    assert.equal(exclusive.checks[0]?.status, 'violated')
  })

  it('converts units before comparing', () => {
    const report = ok(check([range('r', 'length', { maximum: { value: 1, unit: 'm' } })], valuesFrom({ length: { value: 50, unit: 'cm' } })))
    assert.equal(report.checks[0]?.status, 'satisfied')
    const over = ok(check([range('r', 'length', { maximum: { value: 1, unit: 'm' } })], valuesFrom({ length: { value: 150, unit: 'cm' } })))
    assert.equal(over.checks[0]?.status, 'violated')
  })

  it('calls a comparison between different kinds of quantity malformed, not violated', () => {
    const report = ok(check([range('r', 'length', { maximum: { value: 1, unit: 's' } })], valuesFrom({ length: { value: 2, unit: 'm' } })))
    assert.equal(report.checks[0]?.status, 'malformed')
    assert.match(report.checks[0]?.why ?? '', /the rule is broken, not the value/)
    assert.equal(report.malformed, 1)
    assert.equal(report.violated, 0)
  })

  it('calls a range with no bounds malformed', () => {
    const report = ok(check([range('r', 'x')], valuesFrom({ x: 1 })))
    assert.equal(report.checks[0]?.status, 'malformed')
    assert.match(report.checks[0]?.why ?? '', /which is not a constraint/)
  })

  it('is unevaluable when the value is missing, and says that is not passing', () => {
    const report = ok(check([range('r', 'x', { maximum: plain(10) })], valuesFrom({})))
    assert.equal(report.checks[0]?.status, 'unevaluable')
    assert.deepEqual([...(report.checks[0]?.missing ?? [])], ['x'])
    assert.match(report.checks[0]?.why ?? '', /not the same as the rule holding/)
  })
})

describe('the three-state discipline', () => {
  it('does not count an unevaluable constraint as satisfied', () => {
    const report = ok(
      check(
        [range('a', 'x', { maximum: plain(10) }), range('b', 'y', { maximum: plain(10) })],
        valuesFrom({ x: 1 })
      )
    )
    assert.equal(report.satisfied, 1)
    assert.equal(report.unevaluable, 1)
    assert.equal(report.violated, 0)
    // Nothing is violated, and it is still not all satisfied.
    assert.equal(report.allSatisfied, false)
    assert.match(report.why, /has not been met/)
  })

  it('does not count a malformed constraint as satisfied either', () => {
    const report = ok(check([range('a', 'x')], valuesFrom({ x: 1 })))
    assert.equal(report.allSatisfied, false)
    assert.match(report.why, /a problem with the rule, not with the values/)
  })

  it('does not call an empty set of constraints satisfied', () => {
    const report = ok(check([], valuesFrom({ x: 1 })))
    assert.equal(report.allSatisfied, false)
    assert.match(report.why, /not the same as everything being fine/)
  })

  it('is satisfied only when everything was checked and everything held', () => {
    const report = ok(check([range('a', 'x', { maximum: plain(10) })], valuesFrom({ x: 1 })))
    assert.equal(report.allSatisfied, true)
  })
})

describe('comparison constraints', () => {
  it('compares two expressions', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'stress under limit', left: 'force / area', comparison: 'less', right: 'limit' }
    const report = ok(check([one], valuesFrom({ force: 100, area: 10, limit: 20 })))
    assert.equal(report.checks[0]?.status, 'satisfied')
    assert.equal(report.checks[0]?.margin, 10)
    assert.match(report.checks[0]?.why ?? '', /is below/)
  })

  it('fails when the comparison does not hold', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a * b', comparison: 'less-or-equal', right: 'c' }
    const report = ok(check([one], valuesFrom({ a: 5, b: 5, c: 10 })))
    assert.equal(report.checks[0]?.status, 'violated')
    assert.equal(report.checks[0]?.margin, -15)
  })

  it('supports every comparison it lists', () => {
    for (const cmp of COMPARISONS) {
      const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a', comparison: cmp, right: 'b' }
      const report = ok(check([one], valuesFrom({ a: 5, b: 5 })))
      const expected = cmp === 'less-or-equal' || cmp === 'greater-or-equal' || cmp === 'equals'
      assert.equal(report.checks[0]?.status, expected ? 'satisfied' : 'violated', cmp)
      assert.ok(COMPARISON_WORDS[cmp].length > 0, cmp)
    }
  })

  it('honours a tolerance on equality', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a', comparison: 'equals', right: 'b', tolerance: 0.1 }
    assert.equal(ok(check([one], valuesFrom({ a: 1, b: 1.05 }))).checks[0]?.status, 'satisfied')
    assert.equal(ok(check([one], valuesFrom({ a: 1, b: 1.5 }))).checks[0]?.status, 'violated')
  })

  it('gives a not-equals no margin, because there is no room to spare', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a', comparison: 'not-equals', right: 'b' }
    const report = ok(check([one], valuesFrom({ a: 1, b: 2 })))
    assert.equal(report.checks[0]?.status, 'satisfied')
    assert.equal(report.checks[0]?.margin, null)
  })

  it('is unevaluable when an expression variable is missing', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a + b', comparison: 'less', right: 'c' }
    const report = ok(check([one], valuesFrom({ a: 1 })))
    assert.equal(report.checks[0]?.status, 'unevaluable')
    assert.deepEqual([...(report.checks[0]?.missing ?? [])].sort(), ['b', 'c'])
  })

  it('calls an unparsable expression malformed', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'a +', comparison: 'less', right: 'b' }
    const report = ok(check([one], valuesFrom({ a: 1, b: 2 })))
    assert.equal(report.checks[0]?.status, 'malformed')
    assert.match(report.checks[0]?.why ?? '', /left side does not parse/)
  })

  it('refuses to mix kinds of quantity inside one comparison', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'distance', comparison: 'less', right: 'duration' }
    const report = ok(check([one], valuesFrom({ distance: { value: 1, unit: 'm' }, duration: { value: 2, unit: 's' } })))
    assert.equal(report.checks[0]?.status, 'malformed')
    assert.match(report.checks[0]?.why ?? '', /a number with no meaning/)
  })

  it('does not let a variable named like a prototype property reach one', () => {
    const one: Constraint = { kind: 'comparison', id: 'c', label: 'c', left: 'constructor', comparison: 'less', right: 'x' }
    const report = ok(check([one], valuesFrom({ x: 1 })))
    // It is missing, not silently resolved to a function.
    assert.equal(report.checks[0]?.status, 'unevaluable')
    assert.deepEqual([...(report.checks[0]?.missing ?? [])], ['constructor'])
  })
})

describe('sum constraints', () => {
  it('adds values up and compares them against a total', () => {
    const one: Constraint = { kind: 'sum', id: 's', label: 'shares', variables: ['a', 'b', 'c'], total: plain(100) }
    assert.equal(ok(check([one], valuesFrom({ a: 50, b: 30, c: 20 }))).checks[0]?.status, 'satisfied')
    const off = ok(check([one], valuesFrom({ a: 50, b: 30, c: 25 })))
    assert.equal(off.checks[0]?.status, 'violated')
    assert.match(off.checks[0]?.why ?? '', /5 over the target/)
  })

  it('converts units in the sum', () => {
    const one: Constraint = { kind: 'sum', id: 's', label: 's', variables: ['a', 'b'], total: { value: 2, unit: 'm' } }
    const report = ok(check([one], valuesFrom({ a: { value: 150, unit: 'cm' }, b: { value: 0.5, unit: 'm' } })))
    assert.equal(report.checks[0]?.status, 'satisfied')
  })

  it('honours a tolerance', () => {
    const one: Constraint = { kind: 'sum', id: 's', label: 's', variables: ['a', 'b'], total: plain(1), tolerance: 0.01 }
    assert.equal(ok(check([one], valuesFrom({ a: 0.5, b: 0.505 }))).checks[0]?.status, 'satisfied')
  })

  it('is unevaluable with a missing part', () => {
    const one: Constraint = { kind: 'sum', id: 's', label: 's', variables: ['a', 'b'], total: plain(1) }
    assert.equal(ok(check([one], valuesFrom({ a: 0.5 }))).checks[0]?.status, 'unevaluable')
  })

  it('calls an empty sum malformed', () => {
    const one: Constraint = { kind: 'sum', id: 's', label: 's', variables: [], total: plain(1) }
    assert.equal(ok(check([one], valuesFrom({}))).checks[0]?.status, 'malformed')
  })
})

describe('required constraints', () => {
  it('treats absence as a violation rather than something unevaluable', () => {
    const one: Constraint = { kind: 'required', id: 'q', label: 'must have', variables: ['a', 'b'] }
    const report = ok(check([one], valuesFrom({ a: 1 })))
    assert.equal(report.checks[0]?.status, 'violated')
    assert.match(report.checks[0]?.why ?? '', /the rule is about presence, and absence is the answer/)
  })

  it('passes when everything is present', () => {
    const one: Constraint = { kind: 'required', id: 'q', label: 'q', variables: ['a'] }
    assert.equal(ok(check([one], valuesFrom({ a: 1 }))).checks[0]?.status, 'satisfied')
  })
})

describe('ordered constraints', () => {
  it('accepts values in order', () => {
    const one: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b', 'c'] }
    assert.equal(ok(check([one], valuesFrom({ a: 1, b: 2, c: 3 }))).checks[0]?.status, 'satisfied')
  })

  it('reports which pair broke the order', () => {
    const one: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b', 'c'] }
    const report = ok(check([one], valuesFrom({ a: 1, b: 5, c: 3 })))
    assert.equal(report.checks[0]?.status, 'violated')
    assert.match(report.checks[0]?.why ?? '', /b \(5\) is above c \(3\)/)
  })

  it('distinguishes strict from non-strict at a tie', () => {
    const loose: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b'] }
    const strict: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b'], strict: true }
    assert.equal(ok(check([loose], valuesFrom({ a: 1, b: 1 }))).checks[0]?.status, 'satisfied')
    assert.equal(ok(check([strict], valuesFrom({ a: 1, b: 1 }))).checks[0]?.status, 'violated')
  })

  it('marks a tie in a non-strict ordering as binding', () => {
    const one: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b'] }
    assert.equal(ok(check([one], valuesFrom({ a: 1, b: 1 }))).checks[0]?.binding, true)
  })

  it('refuses to order different kinds of quantity', () => {
    const one: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a', 'b'] }
    const report = ok(check([one], valuesFrom({ a: { value: 1, unit: 'm' }, b: { value: 2, unit: 'kg' } })))
    assert.equal(report.checks[0]?.status, 'malformed')
  })

  it('needs at least two variables', () => {
    const one: Constraint = { kind: 'ordered', id: 'o', label: 'o', variables: ['a'] }
    assert.equal(ok(check([one], valuesFrom({ a: 1 }))).checks[0]?.status, 'malformed')
  })
})

describe('check, overall', () => {
  it('refuses duplicate constraint ids', () => {
    const result = check([range('r', 'x', { maximum: plain(1) }), range('r', 'y', { maximum: plain(1) })], valuesFrom({}))
    assert.ok(isConstraintError(result))
    assert.match(result.message, /share the id/)
  })

  it('refuses a constraint with no id', () => {
    assert.ok(isConstraintError(check([range('', 'x', { maximum: plain(1) })], valuesFrom({}))))
  })
})

describe('feasible', () => {
  it('finds a rule that contradicts itself', () => {
    const result = ok(feasible([range('r', 'x', { minimum: plain(10), maximum: plain(5) })]))
    assert.equal(result.possible, false)
    assert.match(result.conflicts[0]?.detail ?? '', /the rule contradicts itself/)
  })

  it('finds two rules that contradict each other', () => {
    const result = ok(feasible([range('a', 'x', { minimum: plain(10) }), range('b', 'x', { maximum: plain(5) })]))
    assert.equal(result.possible, false)
    assert.deepEqual([...(result.conflicts[0]?.constraintIds ?? [])].sort(), ['a', 'b'])
    assert.match(result.conflicts[0]?.detail ?? '', /Each is satisfiable alone/)
  })

  it('finds a conflict that only exclusivity creates', () => {
    const shared = ok(feasible([range('a', 'x', { minimum: plain(5), maximum: plain(5) })]))
    assert.equal(shared.possible, true)
    const exclusive = ok(feasible([range('a', 'x', { minimum: plain(5), maximum: plain(5), maximumInclusive: false })]))
    assert.equal(exclusive.possible, false)
  })

  it('accepts ranges that overlap', () => {
    const result = ok(feasible([range('a', 'x', { minimum: plain(0), maximum: plain(10) }), range('b', 'x', { minimum: plain(5), maximum: plain(20) })]))
    assert.equal(result.possible, true)
    const interval = result.intervals.find((one) => one.variable === 'x')
    assert.equal(interval?.minimum, 5)
    assert.equal(interval?.maximum, 10)
  })

  it('never claims to have proved satisfiability', () => {
    const result = ok(feasible([range('a', 'x', { maximum: plain(1) })]))
    assert.equal(result.possible, true)
    assert.match(result.why, /nothing was proved impossible rather than that everything is possible/)
  })

  it('says a contradiction is not fixed by a better value', () => {
    const result = ok(feasible([range('a', 'x', { minimum: plain(10) }), range('b', 'x', { maximum: plain(5) })]))
    assert.match(result.why, /looking for a better value will not help/)
  })
})

describe('narrow', () => {
  it('narrows ranges from a sum', () => {
    const constraints: Constraint[] = [
      range('rx', 'x', { minimum: plain(0), maximum: plain(100) }),
      range('ry', 'y', { minimum: plain(0), maximum: plain(100) }),
      { kind: 'sum', id: 's', label: 'total', variables: ['x', 'y'], total: plain(50) }
    ]
    const result = ok(narrow(constraints))
    const x = result.intervals.find((one) => one.variable === 'x')
    assert.equal(x?.maximum, 50)
    assert.ok(result.narrowed.some((one) => one.variable === 'x'))
  })

  it('pins a variable when only one value is left, and calls it a deduction', () => {
    const constraints: Constraint[] = [
      range('rx', 'x', { minimum: plain(0), maximum: plain(100) }),
      range('ry', 'y', { minimum: plain(30), maximum: plain(30) }),
      { kind: 'sum', id: 's', label: 'total', variables: ['x', 'y'], total: plain(50) }
    ]
    const result = ok(narrow(constraints))
    const x = result.intervals.find((one) => one.variable === 'x')
    assert.equal(x?.minimum, 20)
    assert.equal(x?.maximum, 20)
    assert.match(result.why, /a deduction from the constraints, not a measurement/)
  })

  it('says plainly when it narrowed nothing', () => {
    const result = ok(narrow([range('rx', 'x', { minimum: plain(0), maximum: plain(10) })]))
    assert.match(result.why, /the constraints do not inform each other/)
    assert.equal(result.narrowed.length, 0)
  })

  it('never claims to have solved anything', () => {
    const result = ok(narrow([range('rx', 'x', { minimum: plain(0), maximum: plain(10) })]))
    assert.match(result.why, /does not find the answer/)
  })

  it('settles rather than running to the pass limit on an ordinary problem', () => {
    const constraints: Constraint[] = [
      range('rx', 'x', { minimum: plain(0), maximum: plain(100) }),
      range('ry', 'y', { minimum: plain(0), maximum: plain(100) }),
      range('rz', 'z', { minimum: plain(0), maximum: plain(100) }),
      { kind: 'sum', id: 's', label: 'total', variables: ['x', 'y', 'z'], total: plain(60) }
    ]
    const result = ok(narrow(constraints))
    assert.equal(result.stoppedEarly, false)
    assert.ok(result.passes < 50)
  })
})

describe('rank', () => {
  it('puts violations first, then malformed, then binding, then the rest', () => {
    const constraints: Constraint[] = [
      range('fine', 'a', { maximum: plain(100) }),
      range('broken', 'b'),
      range('bad', 'c', { maximum: plain(1) }),
      range('tight', 'd', { maximum: plain(5) }),
      range('unknown', 'e', { maximum: plain(1) })
    ]
    const report = ok(check(constraints, valuesFrom({ a: 1, b: 1, c: 50, d: 5 })))
    const ordered = rank(report).map((one) => one.constraintId)
    assert.equal(ordered[0], 'bad')
    assert.equal(ordered[1], 'broken')
    assert.equal(ordered[2], 'tight')
    assert.equal(ordered[3], 'unknown')
    // A satisfied constraint with room to spare is the least urgent thing on the list, below even the unknowns.
    assert.equal(ordered[ordered.length - 1], 'fine')
  })
})
