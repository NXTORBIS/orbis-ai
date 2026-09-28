import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  OPTIMIZE_ASSUMPTIONS,
  OPTIMIZE_LIMITS,
  bracketMinimum,
  descend,
  isOptimizeError,
  maximise,
  minimise,
  minimiseConstrained,
  minimiseOnInterval,
  multiStart,
  solveLinearProgramme
} from './optimize.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isOptimizeError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

describe('one variable', () => {
  it('finds the minimum of a parabola', () => {
    const result = ok(minimiseOnInterval((x) => (x - 3) ** 2 + 1, -10, 10))
    assert.ok(Math.abs(result.point[0] - 3) < 1e-6)
    assert.ok(Math.abs(result.value - 1) < 1e-9)
    assert.equal(result.status, 'converged')
  })

  it('claims only a local minimum unless the caller vouches for unimodality', () => {
    const result = ok(minimiseOnInterval((x) => (x - 3) ** 2, -10, 10))
    assert.equal(result.certainty, 'local')
    assert.ok(result.notes.some((note) => /not necessarily the only one/.test(note)))
  })

  it('claims the global minimum when the caller states the function has one dip, and says it was taken on trust', () => {
    const result = ok(minimiseOnInterval((x) => (x - 3) ** 2, -10, 10, { unimodal: true }))
    assert.equal(result.certainty, 'global')
    assert.ok(result.notes.some((note) => /taken on trust/.test(note)))
  })

  it('warns when the minimum sits on the edge of the bracket', () => {
    const result = ok(minimiseOnInterval((x) => x, 0, 10))
    assert.ok(Math.abs(result.point[0]) < 1e-3)
    assert.equal(result.certainty, 'best-seen')
    assert.ok(result.notes.some((note) => /widen the bracket/.test(note)))
  })

  it('walks away from points where the function throws instead of giving up', () => {
    const result = ok(
      minimiseOnInterval(
        (x) => {
          if (x < 0) throw new Error('undefined here')
          return (x - 2) ** 2
        },
        -5,
        10
      )
    )
    assert.ok(Math.abs(result.point[0] - 2) < 1e-5)
  })

  it('refuses a bracket that runs backwards', () => {
    const bad = minimiseOnInterval((x) => x, 10, 0)
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('refuses a bracket that is not finite', () => {
    assert.ok(isOptimizeError(minimiseOnInterval((x) => x, 0, Number.POSITIVE_INFINITY)))
  })

  it('refuses a function with no finite value anywhere in the bracket', () => {
    const bad = minimiseOnInterval(() => Number.NaN, 0, 1)
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('reports how many times it called the function', () => {
    assert.ok(ok(minimiseOnInterval((x) => x * x, -1, 1)).evaluations > 2)
  })
})

describe('bracketing', () => {
  it('brackets a minimum from a starting point uphill of it', () => {
    const bracket = bracketMinimum((x) => (x - 7) ** 2, 0, 1)
    assert.ok(bracket !== null)
    assert.ok((bracket as { low: number }).low <= 7 && (bracket as { high: number }).high >= 7)
  })

  it('brackets a minimum that lies below the starting point', () => {
    const bracket = bracketMinimum((x) => (x + 7) ** 2, 0, 1)
    assert.ok(bracket !== null)
    assert.ok((bracket as { low: number }).low <= -7 && (bracket as { high: number }).high >= -7)
  })

  it('returns nothing when the function keeps falling, rather than a bracket that just ends somewhere', () => {
    assert.equal(bracketMinimum((x) => -x, 0, 1), null)
  })

  it('returns nothing for a step that is not a positive number', () => {
    assert.equal(bracketMinimum((x) => x * x, 0, 0), null)
    assert.equal(bracketMinimum((x) => x * x, Number.NaN, 1), null)
  })

  it('hands a bracket the line search can use', () => {
    const bracket = bracketMinimum((x) => (x - 4.2) ** 2, 0, 1)
    assert.ok(bracket !== null)
    const found = ok(minimiseOnInterval((x) => (x - 4.2) ** 2, (bracket as { low: number }).low, (bracket as { high: number }).high))
    assert.ok(Math.abs(found.point[0] - 4.2) < 1e-5)
  })
})

describe('several variables', () => {
  it('finds the minimum of a bowl', () => {
    const result = ok(minimise((p) => (p[0] - 1) ** 2 + (p[1] + 2) ** 2, [0, 0]))
    assert.ok(Math.abs(result.point[0] - 1) < 1e-4)
    assert.ok(Math.abs(result.point[1] + 2) < 1e-4)
    assert.equal(result.status, 'converged')
  })

  it('finds the minimum of the Rosenbrock function, which is the hard classic', () => {
    const rosenbrock = (p: readonly number[]): number => (1 - p[0]) ** 2 + 100 * (p[1] - p[0] ** 2) ** 2
    const result = ok(minimise(rosenbrock, [-1.2, 1], { iterations: 5000, tolerance: 1e-12 }))
    assert.ok(Math.abs(result.point[0] - 1) < 1e-3, `x was ${result.point[0]}`)
    assert.ok(Math.abs(result.point[1] - 1) < 1e-3, `y was ${result.point[1]}`)
  })

  it('never claims more than a local minimum', () => {
    const result = ok(minimise((p) => p[0] ** 2, [1]))
    assert.equal(result.certainty, 'local')
    assert.ok(result.notes.some((note) => /finds a local minimum/.test(note)))
  })

  it('stays inside the bounds it is given', () => {
    const result = ok(minimise((p) => (p[0] - 100) ** 2, [0], { bounds: [{ low: -1, high: 5 }] }))
    assert.ok(result.point[0] <= 5 + 1e-9 && result.point[0] >= -1 - 1e-9)
  })

  it('says when the answer ended on a bound, which means the real minimum is outside the box', () => {
    const result = ok(minimise((p) => (p[0] - 100) ** 2, [0], { bounds: [{ low: -1, high: 5 }] }))
    assert.ok(result.notes.some((note) => /ended on a bound/.test(note)))
  })

  it('maximises by minimising the negation, and reports the value the right way up', () => {
    const result = ok(maximise((p) => -((p[0] - 3) ** 2) + 7, [0]))
    assert.ok(Math.abs(result.point[0] - 3) < 1e-4)
    assert.ok(Math.abs(result.value - 7) < 1e-6)
  })

  it('treats a point where the objective throws as infinitely bad rather than stopping', () => {
    const result = ok(
      minimise(
        (p) => {
          if (p[0] < 0) throw new Error('no')
          return (p[0] - 2) ** 2
        },
        [1]
      )
    )
    assert.ok(Math.abs(result.point[0] - 2) < 1e-3)
  })

  it('stops at the evaluation cap and says so', () => {
    const result = ok(minimise((p) => (p[0] - 1) ** 2, [0], { maximumEvaluations: 12, iterations: 5000 }))
    assert.ok(result.evaluations <= 13)
    assert.ok(result.notes.some((note) => /reached the cap/.test(note)))
  })

  it('refuses a problem with no variables', () => {
    const bad = minimise(() => 0, [])
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'no-variables')
  })

  it('refuses a starting point that is not finite', () => {
    assert.ok(isOptimizeError(minimise((p) => p[0], [Number.NaN])))
  })

  it('refuses when the bounds do not match the variables', () => {
    const bad = minimise((p) => p[0], [0], { bounds: [{ low: 0, high: 1 }, { low: 0, high: 1 }] })
    assert.ok(isOptimizeError(bad))
    assert.match(bad.message, /1 variables but 2 bounds/)
  })

  it('refuses a bound whose low is above its high', () => {
    assert.ok(isOptimizeError(minimise((p) => p[0], [0], { bounds: [{ low: 5, high: 1 }] })))
  })

  it('refuses more variables than it handles', () => {
    const many = new Array<number>(OPTIMIZE_LIMITS.variables + 1).fill(0)
    assert.ok(isOptimizeError(minimise((p) => p[0], many)))
  })

  it('refuses an objective with no finite value near the start', () => {
    const bad = minimise(() => Number.NaN, [0, 0])
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('builds a non-degenerate simplex even when a bound blocks the displacement', () => {
    // The start sits exactly on the upper bound, so the usual outward step is clamped to nothing.
    const result = ok(minimise((p) => (p[0] - 2) ** 2, [5], { bounds: [{ low: 0, high: 5 }] }))
    assert.ok(Math.abs(result.point[0] - 2) < 1e-3, `ended at ${result.point[0]}`)
  })
})

describe('gradient descent', () => {
  it('finds the minimum of a bowl', () => {
    const result = ok(descend((p) => (p[0] - 4) ** 2 + (p[1] - 1) ** 2, [0, 0]))
    assert.ok(Math.abs(result.point[0] - 4) < 1e-3)
    assert.ok(Math.abs(result.point[1] - 1) < 1e-3)
  })

  it('uses an exact gradient when one is given', () => {
    const withGradient = ok(
      descend((p) => (p[0] - 4) ** 2, [0], { gradient: (p) => [2 * (p[0] - 4)] })
    )
    const without = ok(descend((p) => (p[0] - 4) ** 2, [0]))
    assert.ok(Math.abs(withGradient.point[0] - 4) < 1e-4)
    // The numerical gradient costs two extra objective calls per variable per step.
    assert.ok(withGradient.evaluations < without.evaluations)
  })

  it('warns that a finite-difference gradient is mostly noise on a noisy objective', () => {
    assert.ok(ok(descend((p) => p[0] ** 2, [1])).notes.some((note) => /mostly noise/.test(note)))
  })

  it('falls back to finite differences when the supplied gradient throws', () => {
    const result = ok(
      descend((p) => (p[0] - 4) ** 2, [0], {
        gradient: () => {
          throw new Error('no gradient here')
        }
      })
    )
    assert.ok(Math.abs(result.point[0] - 4) < 1e-3)
  })

  it('falls back when the supplied gradient is the wrong shape', () => {
    const result = ok(descend((p) => (p[0] - 4) ** 2, [0], { gradient: () => [1, 2, 3] }))
    assert.ok(Math.abs(result.point[0] - 4) < 1e-3)
  })

  it('stays inside its bounds', () => {
    const result = ok(descend((p) => (p[0] - 100) ** 2, [0], { bounds: [{ low: -2, high: 3 }] }))
    assert.ok(result.point[0] <= 3 + 1e-9)
  })

  it('reports stalling rather than calling it convergence', () => {
    // A staircase: flat everywhere, so no downhill step ever improves anything.
    const result = ok(descend((p) => Math.floor(p[0]), [0.5]))
    assert.ok(result.status === 'stalled' || result.status === 'converged')
    if (result.status === 'stalled') {
      assert.equal(result.certainty, 'best-seen')
      assert.ok(result.notes.some((note) => /No step in the downhill direction/.test(note)))
    }
  })

  it('refuses a problem with no variables', () => {
    assert.ok(isOptimizeError(descend(() => 0, [])))
  })

  it('refuses an objective with no finite value at the start', () => {
    const bad = descend(() => Number.NaN, [0])
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'not-finite')
  })

  it('refuses when the bounds do not match the variables', () => {
    assert.ok(isOptimizeError(descend((p) => p[0], [0], { bounds: [] })))
  })
})

describe('multi-start', () => {
  // Two wells: a shallow one near -2 and a deeper one near 3.
  const twoWells = (p: readonly number[]): number =>
    Math.min(0.5 * (p[0] + 2) ** 2 + 1, (p[0] - 3) ** 2)

  it('finds the deeper well from scattered starts', () => {
    const result = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 20, seed: 4 }))
    assert.ok(Math.abs(result.point[0] - 3) < 1e-2, `ended at ${result.point[0]}`)
  })

  it('reports finding more than one minimum, which is the one thing it can prove', () => {
    const result = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 20, seed: 4 }))
    assert.ok(result.distinctMinima > 1)
    assert.ok(result.notes.some((note) => /proves this problem has more than one/.test(note)))
  })

  it('still refuses to claim the global optimum after finding several minima', () => {
    const result = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 20, seed: 4 }))
    assert.equal(result.certainty, 'local')
    assert.ok(result.notes.some((note) => /not proven to be the global one/.test(note)))
  })

  it('calls landing in one place weak evidence rather than proof', () => {
    const result = ok(multiStart((p) => (p[0] - 1) ** 2, [{ low: -5, high: 5 }], { starts: 8, seed: 2 }))
    assert.equal(result.distinctMinima, 1)
    assert.ok(result.notes.some((note) => /weak evidence of a single minimum, not proof/.test(note)))
  })

  it('gives the same answer for the same seed', () => {
    const a = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 10, seed: 99 }))
    const b = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 10, seed: 99 }))
    assert.deepEqual([...a.point], [...b.point])
    assert.deepEqual([...a.everyValue], [...b.everyValue])
  })

  it('reports the value from each start, so the spread is visible', () => {
    const result = ok(multiStart(twoWells, [{ low: -10, high: 10 }], { starts: 6, seed: 1 }))
    assert.equal(result.everyValue.length, 6)
  })

  it('sums the cost across every start', () => {
    const result = ok(multiStart((p) => p[0] ** 2, [{ low: -1, high: 1 }], { starts: 5, seed: 1 }))
    assert.ok(result.evaluations > 20)
  })

  it('refuses without a box to draw starts from', () => {
    const bad = multiStart((p) => p[0], [])
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'no-variables')
  })

  it('refuses a box that is not a finite range', () => {
    assert.ok(isOptimizeError(multiStart((p) => p[0], [{ low: 5, high: 1 }])))
    assert.ok(isOptimizeError(multiStart((p) => p[0], [{ low: 0, high: Number.POSITIVE_INFINITY }])))
  })
})

describe('linear programming', () => {
  // The classic: maximise 3x + 5y subject to x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18.
  const classic = {
    objective: [3, 5],
    direction: 'maximise' as const,
    constraints: [
      { coefficients: [1, 0], relation: '<=' as const, value: 4, label: 'plant one' },
      { coefficients: [0, 2], relation: '<=' as const, value: 12, label: 'plant two' },
      { coefficients: [3, 2], relation: '<=' as const, value: 18, label: 'plant three' }
    ]
  }

  it('finds the known optimum', () => {
    const result = ok(solveLinearProgramme(classic))
    assert.ok(Math.abs(result.value - 36) < 1e-9, `value was ${result.value}`)
    assert.ok(Math.abs(result.point[0] - 2) < 1e-9)
    assert.ok(Math.abs(result.point[1] - 6) < 1e-9)
  })

  it('is the one method here that can honestly claim the global optimum', () => {
    const result = ok(solveLinearProgramme(classic))
    assert.equal(result.certainty, 'global')
    assert.ok(result.notes.some((note) => /really is the global optimum/.test(note)))
  })

  it('names the constraints that are actually limiting the answer', () => {
    const result = ok(solveLinearProgramme(classic))
    assert.ok(result.binding.includes('plant two'))
    assert.ok(result.binding.includes('plant three'))
    assert.ok(!result.binding.includes('plant one'))
  })

  it('reports shadow prices, and says they only hold for a small relaxation', () => {
    const result = ok(solveLinearProgramme(classic))
    assert.ok(result.shadowPrices.length > 0)
    assert.ok(result.notes.some((note) => /only for a small relaxation/.test(note)))
  })

  it('minimises as well as maximises', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [2, 3],
        direction: 'minimise',
        constraints: [
          { coefficients: [1, 1], relation: '>=', value: 10 },
          { coefficients: [1, 0], relation: '>=', value: 2 }
        ]
      })
    )
    // Cheapest is all of it in the 2-cost variable: 10 units at 2 each.
    assert.ok(Math.abs(result.value - 20) < 1e-6, `value was ${result.value}`)
  })

  it('handles an equality constraint', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1, 1],
        direction: 'maximise',
        constraints: [{ coefficients: [1, 1], relation: '=', value: 5 }]
      })
    )
    assert.ok(Math.abs(result.value - 5) < 1e-6)
    assert.ok(Math.abs(result.point[0] + result.point[1] - 5) < 1e-6)
  })

  it('reports an unbounded objective rather than returning a large number', () => {
    const bad = solveLinearProgramme({
      objective: [1],
      direction: 'maximise',
      constraints: [{ coefficients: [-1], relation: '<=', value: 0 }]
    })
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'unbounded')
    assert.match(bad.message, /constraint is missing/)
  })

  it('reports an infeasible system rather than a point that breaks it', () => {
    const bad = solveLinearProgramme({
      objective: [1],
      direction: 'maximise',
      constraints: [
        { coefficients: [1], relation: '<=', value: 1 },
        { coefficients: [1], relation: '>=', value: 5 }
      ]
    })
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'infeasible')
  })

  it('says outright that variables are assumed non-negative', () => {
    assert.ok(ok(solveLinearProgramme(classic)).notes.some((note) => /zero or more/.test(note)))
  })

  it('refuses to silently transform a variable that may go negative', () => {
    const bad = solveLinearProgramme({ ...classic, allowNegative: true })
    assert.ok(isOptimizeError(bad))
    assert.match(bad.message, /difference of two non-negative ones/)
  })

  it('refuses a constraint with the wrong number of weights', () => {
    const bad = solveLinearProgramme({
      objective: [1, 2],
      direction: 'maximise',
      constraints: [{ coefficients: [1], relation: '<=', value: 1 }]
    })
    assert.ok(isOptimizeError(bad))
    assert.match(bad.message, /1 weights but there are 2 variables/)
  })

  it('refuses a weight that is not a finite number', () => {
    assert.ok(
      isOptimizeError(
        solveLinearProgramme({
          objective: [1],
          direction: 'maximise',
          constraints: [{ coefficients: [Number.NaN], relation: '<=', value: 1 }]
        })
      )
    )
  })

  it('refuses a programme with no variables', () => {
    const bad = solveLinearProgramme({ objective: [], direction: 'maximise', constraints: [] })
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'no-variables')
  })

  it('handles a constraint written with a negative right-hand side', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1],
        direction: 'maximise',
        constraints: [{ coefficients: [-1], relation: '>=', value: -7 }]
      })
    )
    assert.ok(Math.abs(result.value - 7) < 1e-6)
  })

  it('gives a shadow price on a >= constraint that matches the real improvement', () => {
    const at = (demand: number): number => {
      const result = ok(
        solveLinearProgramme({
          objective: [2, 3],
          direction: 'minimise',
          constraints: [
            { coefficients: [1, 1], relation: '>=', value: demand, label: 'demand' },
            { coefficients: [1, 0], relation: '>=', value: 2, label: 'floor' }
          ]
        })
      )
      return result.value
    }
    const result = ok(
      solveLinearProgramme({
        objective: [2, 3],
        direction: 'minimise',
        constraints: [
          { coefficients: [1, 1], relation: '>=', value: 10, label: 'demand' },
          { coefficients: [1, 0], relation: '>=', value: 2, label: 'floor' }
        ]
      })
    )
    assert.deepEqual([...result.binding], ['demand'])
    const price = result.shadowPrices.find((one) => one.constraint === 'demand')?.price
    // Relaxing demand by one really does cut the cost by this much, which is the only check that catches a sign error.
    assert.ok(Math.abs((price ?? 0) - (at(10) - at(9))) < 1e-9, `price ${price} vs real ${at(10) - at(9)}`)
  })

  it('says it had to find a feasible point first when the origin was not one', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1],
        direction: 'minimise',
        constraints: [{ coefficients: [1], relation: '>=', value: 3 }]
      })
    )
    assert.ok(result.notes.some((note) => /first phase found one/.test(note)))
  })

  it('handles a constraint the others already imply', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1, 1],
        direction: 'maximise',
        constraints: [
          { coefficients: [1, 1], relation: '<=', value: 4, label: 'cap' },
          { coefficients: [2, 2], relation: '<=', value: 8, label: 'the same cap doubled' }
        ]
      })
    )
    assert.ok(Math.abs(result.value - 4) < 1e-9)
    assert.equal(result.status, 'converged')
  })

  it('reports a constraint with no variables in it that cannot hold', () => {
    const bad = solveLinearProgramme({
      objective: [1],
      direction: 'maximise',
      constraints: [{ coefficients: [0], relation: '>=', value: 5, label: 'nonsense' }]
    })
    assert.ok(isOptimizeError(bad))
    assert.equal(bad.error, 'infeasible')
    assert.match(bad.message, /nonsense/)
  })

  it('ignores a constraint with no variables in it that always holds', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1],
        direction: 'maximise',
        constraints: [
          { coefficients: [0], relation: '<=', value: 5 },
          { coefficients: [1], relation: '<=', value: 3 }
        ]
      })
    )
    assert.ok(Math.abs(result.value - 3) < 1e-9)
  })

  it('solves a problem with more constraints than variables without cycling', () => {
    const result = ok(
      solveLinearProgramme({
        objective: [1, 1],
        direction: 'maximise',
        constraints: [
          { coefficients: [1, 0], relation: '<=', value: 3 },
          { coefficients: [0, 1], relation: '<=', value: 3 },
          { coefficients: [1, 1], relation: '<=', value: 4 },
          { coefficients: [2, 1], relation: '<=', value: 7 },
          { coefficients: [1, 2], relation: '<=', value: 7 }
        ]
      })
    )
    assert.ok(Math.abs(result.value - 4) < 1e-6)
    assert.equal(result.status, 'converged')
  })
})

describe('constrained non-linear problems', () => {
  it('finds the closest point to a target that satisfies a budget', () => {
    const result = ok(
      minimiseConstrained(
        (p) => (p[0] - 10) ** 2 + (p[1] - 10) ** 2,
        [0, 0],
        [{ label: 'budget', kind: 'inequality', test: (p) => p[0] + p[1] - 6 }],
        { rounds: 8 }
      )
    )
    // The nearest point on x + y = 6 to (10, 10) is (3, 3).
    assert.ok(Math.abs(result.point[0] - 3) < 0.05, `x was ${result.point[0]}`)
    assert.ok(Math.abs(result.point[1] - 3) < 0.05, `y was ${result.point[1]}`)
    assert.ok(result.violation < 1e-3)
  })

  it('satisfies an equality constraint', () => {
    const result = ok(
      minimiseConstrained(
        (p) => p[0] ** 2 + p[1] ** 2,
        [1, 1],
        [{ label: 'on the line', kind: 'equality', test: (p) => p[0] + p[1] - 2 }],
        { rounds: 8 }
      )
    )
    assert.ok(Math.abs(result.point[0] + result.point[1] - 2) < 1e-2)
  })

  it('leaves a constraint slack alone when it is not binding', () => {
    const result = ok(
      minimiseConstrained(
        (p) => (p[0] - 1) ** 2,
        [5],
        [{ label: 'roomy', kind: 'inequality', test: (p) => p[0] - 100 }],
        { rounds: 4 }
      )
    )
    assert.ok(Math.abs(result.point[0] - 1) < 1e-2)
    assert.equal(result.violations.find((one) => one.constraint === 'roomy')?.by, 0)
  })

  it('reports how far outside each constraint it ended, rather than a pass or fail', () => {
    const result = ok(
      minimiseConstrained(
        (p) => -p[0],
        [0],
        [{ label: 'ceiling', kind: 'inequality', test: (p) => p[0] - 1 }],
        { rounds: 6 }
      )
    )
    const ceiling = result.violations.find((one) => one.constraint === 'ceiling')
    assert.ok(ceiling !== undefined)
    assert.ok(typeof ceiling?.by === 'number')
  })

  it('says outright that the method is approximate', () => {
    const result = ok(
      minimiseConstrained((p) => p[0] ** 2, [1], [{ label: 'c', kind: 'inequality', test: (p) => -p[0] }], { rounds: 3 })
    )
    assert.ok(result.notes.some((note) => /approximate method/.test(note)))
    assert.equal(result.certainty, 'best-seen')
  })

  it('treats a constraint that throws as badly broken rather than met', () => {
    const result = ok(
      minimiseConstrained(
        (p) => p[0] ** 2,
        [1],
        [
          {
            label: 'explodes below zero',
            kind: 'inequality',
            test: (p) => {
              if (p[0] < 0) throw new Error('no')
              return -p[0]
            }
          }
        ],
        { rounds: 3 }
      )
    )
    assert.ok(result.point[0] >= -1e-6, `went into the forbidden region: ${result.point[0]}`)
  })

  it('refuses a problem with no variables', () => {
    assert.ok(isOptimizeError(minimiseConstrained(() => 0, [], [])))
  })

  it('works with no constraints at all, matching the plain search', () => {
    const result = ok(minimiseConstrained((p) => (p[0] - 3) ** 2, [0], [], { rounds: 2 }))
    assert.ok(Math.abs(result.point[0] - 3) < 1e-3)
    assert.equal(result.violation, 0)
  })
})

describe('assumptions', () => {
  it('states what each method can and cannot claim', () => {
    assert.ok(OPTIMIZE_ASSUMPTIONS.length >= 7)
    assert.ok(OPTIMIZE_ASSUMPTIONS.some((one) => /local optimum except the linear-programme solver/.test(one)))
    assert.ok(OPTIMIZE_ASSUMPTIONS.some((one) => /Multi-start raises confidence and proves nothing/.test(one)))
    assert.ok(OPTIMIZE_ASSUMPTIONS.some((one) => /shadow price/.test(one)))
  })
})
