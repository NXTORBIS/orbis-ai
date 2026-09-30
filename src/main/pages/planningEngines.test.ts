/**
 * The planning and deciding door: what a Page may ask for, what it gets back, and what it is refused.
 *
 * These go through `runPlanningOperation` rather than calling the engines directly, because the door is where
 * untrusted input is read and where a mistyped argument has to become a refusal rather than a wrong answer.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

import { PLANNING_CAPABILITY, runPlanningOperation } from './planningEngines.ts'
import { BadInput } from './engines.ts'
import { CAPABILITIES } from '../../shared/pages/capabilities.ts'

const run = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> =>
  runPlanningOperation(operation, input) as Record<string, unknown>

const good = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, true, `${operation} came back not-ok: ${JSON.stringify(out).slice(0, 300)}`)
  return out
}

const refused = (operation: string, input: Record<string, unknown> = {}): Record<string, unknown> => {
  const out = run(operation, input)
  assert.equal(out.ok, false, `${operation} was expected to refuse and did not`)
  return out
}

const rejects = (operation: string, input: Record<string, unknown>, pattern: RegExp): void => {
  assert.throws(
    () => run(operation, input),
    (error: unknown) => {
      assert.ok(error instanceof BadInput, `expected BadInput, got ${String(error)}`)
      assert.match((error as Error).message, pattern)
      return true
    }
  )
}

/** Three tasks in a chain: design, build, test. The build is the long one. */
const chainPlan = {
  id: 'p1',
  title: 'Release',
  startDay: 0,
  goals: [{ id: 'g1', title: 'Ship it', deadline: 20, priority: 'high' }],
  tasks: [
    { id: 'design', title: 'Design', duration: 3, goalId: 'g1' },
    { id: 'build', title: 'Build', duration: 10, goalId: 'g1' },
    { id: 'test', title: 'Test', duration: 4, goalId: 'g1' }
  ],
  dependencies: [
    { from: 'design', to: 'build', kind: 'finish-to-start', lag: 0 },
    { from: 'build', to: 'test', kind: 'finish-to-start', lag: 0 }
  ],
  resources: []
}

/** Two laptops against three criteria, one value deliberately unknown. */
const laptops = {
  options: [
    { id: 'a', name: 'Light one', values: { price: 1200, weight: 1.1, battery: 10 } },
    { id: 'b', name: 'Fast one', values: { price: 900, weight: 2.4, battery: 'missing' } }
  ],
  criteria: [
    { id: 'price', name: 'Price', kind: 'currency', direction: 'lower-better', weight: 2 },
    { id: 'weight', name: 'Weight', kind: 'number', direction: 'lower-better', weight: 1 },
    { id: 'battery', name: 'Battery', kind: 'number', direction: 'higher-better', weight: 1 }
  ]
}

describe('the capability map', () => {
  it('splits planning from deciding, and both capabilities exist', () => {
    const needed = new Set(Object.values(PLANNING_CAPABILITY))
    assert.deepEqual([...needed].sort(), ['computation.deciding', 'computation.planning'])
    for (const id of needed) {
      assert.ok(Object.prototype.hasOwnProperty.call(CAPABILITIES, id), `${id} is not declared`)
    }
  })

  it('puts every plan operation under planning and every choice operation under deciding', () => {
    for (const [operation, capability] of Object.entries(PLANNING_CAPABILITY)) {
      if (operation.startsWith('decide.')) assert.equal(capability, 'computation.deciding', operation)
      else assert.equal(capability, 'computation.planning', operation)
    }
  })

  it('answers every operation it advertises', () => {
    for (const operation of Object.keys(PLANNING_CAPABILITY)) {
      try {
        run(operation, {})
      } catch (error) {
        assert.ok(error instanceof BadInput, `${operation} threw something other than BadInput`)
        assert.doesNotMatch(
          (error as Error).message,
          /is not a planning operation/,
          `${operation} is advertised but not handled`
        )
      }
    }
  })

  it('refuses an operation it does not advertise', () => {
    rejects('plan.do-it-for-me', {}, /not a planning operation/)
  })

  it('reaches no clock and no randomness', () => {
    const source = readFileSync(new URL('./planningEngines.ts', import.meta.url), 'utf8')
    const body = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    assert.doesNotMatch(body, /Date\.now|new Date|Math\.random/)
  })
})

describe('plans', () => {
  it('checks a sound plan without claiming the call failed', () => {
    const out = good('plan.check', { plan: chainPlan })
    // `sound` is the plan's verdict; `ok` is the call's. Spreading the check would have collapsed them.
    assert.equal(out.sound, true)
    assert.ok(Array.isArray(out.problems))
  })

  it('reports an unsound plan as a successful call with problems', () => {
    const out = good('plan.check', {
      plan: { ...chainPlan, dependencies: [{ from: 'design', to: 'nothing', kind: 'finish-to-start', lag: 0 }] }
    })
    assert.equal(out.ok, true, 'the call worked')
    assert.equal(out.sound, false, 'the plan did not')
    assert.ok((out.problems as unknown[]).length > 0)
  })

  it('schedules a chain end to end', () => {
    const out = good('plan.schedule', { plan: chainPlan })
    // 3 + 10 + 4 with nothing in parallel.
    assert.equal(out.duration, 17)
  })

  it('puts every task of a pure chain on the critical path', () => {
    const out = good('plan.schedule', { plan: chainPlan })
    assert.deepEqual(out.criticalPath, ['design', 'build', 'test'])
  })

  it('leaves slack on a task that is not on the critical path', () => {
    const out = good('plan.schedule', {
      plan: {
        ...chainPlan,
        tasks: [...chainPlan.tasks, { id: 'docs', title: 'Docs', duration: 2, goalId: 'g1' }],
        dependencies: [
          ...chainPlan.dependencies,
          { from: 'design', to: 'docs', kind: 'finish-to-start', lag: 0 },
          { from: 'docs', to: 'test', kind: 'finish-to-start', lag: 0 }
        ]
      }
    })
    assert.equal(out.duration, 17, 'the short branch does not extend the plan')
    assert.equal((out.criticalPath as string[]).includes('docs'), false)
  })

  it('reports a missed deadline rather than moving it', () => {
    const out = good('plan.schedule', { plan: { ...chainPlan, goals: [{ id: 'g1', title: 'Ship it', deadline: 10, priority: 'high' }] } })
    const missed = out.missedDeadlines as { lateBy: number }[]
    assert.equal(missed.length, 1)
    assert.equal(missed[0].lateBy, 7)
  })

  it('refuses a dependency cycle rather than a partial order', () => {
    const out = refused('plan.order', {
      plan: {
        ...chainPlan,
        dependencies: [
          { from: 'design', to: 'build', kind: 'finish-to-start', lag: 0 },
          { from: 'build', to: 'design', kind: 'finish-to-start', lag: 0 }
        ]
      }
    })
    assert.ok(typeof out.message === 'string' && (out.message as string).length > 0)
  })

  it('gives a run order with dependencies before dependents', () => {
    const out = good('plan.order', { plan: chainPlan })
    assert.deepEqual(out.order, ['design', 'build', 'test'])
  })

  it('returns the order as a list rather than as numeric keys on the result', () => {
    // Spreading an array onto the result would give {ok: true, 0: 'design', ...}, which is a shape no caller
    // would expect and which quietly breaks anything reading `order`.
    const out = good('plan.order', { plan: chainPlan })
    assert.ok(Array.isArray(out.order))
    assert.equal(Object.prototype.hasOwnProperty.call(out, '0'), false)
  })


  it('computes progress from the task states rather than a typed-in number', () => {
    const out = good('plan.progress', {
      plan: {
        ...chainPlan,
        tasks: [
          { id: 'design', title: 'Design', duration: 3, state: 'done' },
          { id: 'build', title: 'Build', duration: 10, state: 'not-started' },
          { id: 'test', title: 'Test', duration: 4, state: 'not-started' }
        ],
        dependencies: []
      },
      rule: 'by-duration'
    })
    // 3 of 17 days done.
    assert.ok(Math.abs((out.fraction as number) - 3 / 17) < 1e-12)
    assert.equal(out.done, 1)
  })

  it('counts progress differently by count and by duration, and says which it used', () => {
    const plan = {
      ...chainPlan,
      tasks: [
        { id: 'design', title: 'Design', duration: 3, state: 'done' },
        { id: 'build', title: 'Build', duration: 10, state: 'not-started' },
        { id: 'test', title: 'Test', duration: 4, state: 'not-started' }
      ],
      dependencies: []
    }
    const byCount = good('plan.progress', { plan, rule: 'by-count' })
    const byDuration = good('plan.progress', { plan, rule: 'by-duration' })
    assert.notEqual(byCount.fraction, byDuration.fraction)
    assert.equal(byCount.rule, 'by-count')
  })

  it('finds a resource clash between two tasks needing the same person at once', () => {
    const out = good('plan.conflicts', {
      plan: {
        ...chainPlan,
        tasks: [
          { id: 'one', title: 'One', duration: 5, resources: ['sam'] },
          { id: 'two', title: 'Two', duration: 5, resources: ['sam'] }
        ],
        dependencies: [],
        resources: [{ id: 'sam', name: 'Sam', capacity: 1, unavailable: [] }]
      }
    })
    assert.ok((out.conflicts as unknown[]).length > 0)
  })

  it('finds no clash when there is enough of the resource', () => {
    const out = good('plan.conflicts', {
      plan: {
        ...chainPlan,
        tasks: [
          { id: 'one', title: 'One', duration: 5, resources: ['team'] },
          { id: 'two', title: 'Two', duration: 5, resources: ['team'] }
        ],
        dependencies: [],
        resources: [{ id: 'team', name: 'Team', capacity: 2, unavailable: [] }]
      }
    })
    assert.equal((out.conflicts as unknown[]).length, 0)
  })

  it('takes today from the Page rather than reading a clock', () => {
    // A plan where nothing has started reads the same on any day, quite correctly. The reading only matters once
    // something is under way, so that is the case that proves where the date came from.
    const running = {
      ...chainPlan,
      tasks: [
        { id: 'design', title: 'Design', duration: 3, state: 'done', goalId: 'g1' },
        { id: 'build', title: 'Build', duration: 10, state: 'in-progress', fraction: 0.2, goalId: 'g1' }
      ],
      dependencies: [{ from: 'design', to: 'build', kind: 'finish-to-start', lag: 0 }]
    }
    const early = good('plan.health', { plan: running, today: 5 })
    const late = good('plan.health', { plan: running, today: 500 })
    assert.equal(early.health, 'on-track')
    assert.equal(late.health, 'late')
    // And the same day always gives the same answer, which a clock would not.
    assert.deepEqual(good('plan.health', { plan: running, today: 500 }), late)
  })

  it('names the task that made the plan late and says it moved the whole plan', () => {
    const running = {
      ...chainPlan,
      tasks: [
        { id: 'design', title: 'Design', duration: 3, state: 'done', goalId: 'g1' },
        { id: 'build', title: 'Build', duration: 10, state: 'in-progress', fraction: 0.2, goalId: 'g1' }
      ],
      dependencies: [{ from: 'design', to: 'build', kind: 'finish-to-start', lag: 0 }]
    }
    const out = good('plan.health', { plan: running, today: 500 })
    const reasons = out.reasons as { about: string; describe: string }[]
    assert.equal(reasons[0].about, 'build')
    assert.match(reasons[0].describe, /critical path/)
  })

  it('refuses a health report with no today', () => {
    rejects('plan.health', { plan: chainPlan }, /today/)
  })

  it('shows what a delay costs the finish date', () => {
    const out = good('plan.what-if', { plan: chainPlan, taskId: 'build', extraDays: 5 })
    const before = out.before as { duration: number }
    const after = out.after as { duration: number }
    assert.equal(before.duration, 17)
    assert.equal(after.duration, 22)
  })

  it('refuses a what-if about a task that is not in the plan', () => {
    const out = refused('plan.what-if', { plan: chainPlan, taskId: 'nothing', extraDays: 1 })
    assert.ok(typeof out.message === 'string')
  })

  it('compares two plans', () => {
    const longer = {
      ...chainPlan,
      tasks: chainPlan.tasks.map((one) => (one.id === 'build' ? { ...one, duration: 15 } : one))
    }
    const out = good('plan.compare', { before: chainPlan, after: longer })
    assert.ok(JSON.stringify(out).length > 20)
  })

  it('refuses a plan that is not an object', () => {
    rejects('plan.schedule', { plan: 'my plan' }, /plan object/)
  })

  it('refuses a task with no duration', () => {
    rejects('plan.schedule', { plan: { ...chainPlan, tasks: [{ id: 'x', title: 'X' }] } }, /duration/)
  })

  it('refuses a task state it does not know', () => {
    rejects(
      'plan.schedule',
      { plan: { ...chainPlan, tasks: [{ id: 'x', title: 'X', duration: 1, state: 'nearly' }] } },
      /not one of/
    )
  })

  it('refuses a dependency kind it does not know', () => {
    rejects(
      'plan.schedule',
      { plan: { ...chainPlan, dependencies: [{ from: 'design', to: 'build', kind: 'sort-of-after' }] } },
      /not one of/
    )
  })

  it('leaves a deadline absent rather than defaulting it to day zero', () => {
    const out = good('plan.schedule', { plan: { ...chainPlan, goals: [{ id: 'g1', title: 'Ship it', priority: 'high' }] } })
    assert.equal((out.missedDeadlines as unknown[]).length, 0)
  })

  it('serves the vocabulary a Page needs to build a plan', () => {
    const out = good('plan.dependency-kinds')
    assert.equal((out.kinds as unknown[]).length, 4)
    assert.equal((out.states as unknown[]).length, 7)
    assert.equal((out.progressRules as unknown[]).length, 3)
  })
})

describe('choices', () => {
  it('ranks options against weighted criteria', () => {
    const out = good('decide.rank', laptops)
    assert.ok(JSON.stringify(out).includes('a') && JSON.stringify(out).includes('b'))
  })

  it('treats a missing value as missing rather than as zero', () => {
    const withMissing = good('decide.rank', laptops)
    const withZero = good('decide.rank', {
      ...laptops,
      options: [laptops.options[0], { id: 'b', name: 'Fast one', values: { price: 900, weight: 2.4, battery: 0 } }]
    })
    assert.notEqual(JSON.stringify(withMissing), JSON.stringify(withZero))
  })

  it('normalises one criterion across the options', () => {
    const out = good('decide.normalise', { ...laptops, criterionId: 'price' })
    assert.ok(Array.isArray(out.normalised))
    assert.equal((out.normalised as unknown[]).length, 2)
  })

  it('refuses a criterion id that is not among the criteria', () => {
    rejects('decide.normalise', { ...laptops, criterionId: 'colour' }, /no criterion/)
  })

  it('gives the same sensitivity answer for the same seed', () => {
    const first = good('decide.stability', { ...laptops, seed: 7, samples: 200 })
    const second = good('decide.stability', { ...laptops, seed: 7, samples: 200 })
    assert.deepEqual(first, second)
  })

  it('finds the options nothing beats outright', () => {
    const out = good('decide.pareto', laptops)
    assert.ok(JSON.stringify(out).length > 10)
  })

  it('weighs one option against another', () => {
    const out = good('decide.trade-off', { ...laptops, first: 'a', second: 'b' })
    assert.ok(JSON.stringify(out).length > 10)
  })

  it('refuses a trade-off naming an option that was not given', () => {
    rejects('decide.trade-off', { ...laptops, first: 'a', second: 'z' }, /no option with the id "z"/)
  })

  it('lists the differences between two options', () => {
    const out = good('decide.differences', { ...laptops, first: 'a', second: 'b' })
    assert.ok((out.differences as unknown[]).length > 0)
  })

  it('filters options by a stated condition', () => {
    const out = good('decide.filter', {
      ...laptops,
      filters: [{ criterionId: 'price', test: 'below', value: 1000 }]
    })
    assert.deepEqual(out.kept, ['b'])
  })

  it('distinguishes an option dropped for a missing value from one that failed', () => {
    const out = good('decide.filter', {
      ...laptops,
      filters: [{ criterionId: 'battery', test: 'above', value: 5 }]
    })
    assert.ok(Object.prototype.hasOwnProperty.call(out, 'removed'))
    assert.deepEqual(out.kept, ['a'])
  })

  it('gives equal weights that sum to one', () => {
    const out = good('decide.weights-equal', laptops)
    const weights = Object.values(out.weights as Record<string, number>)
    assert.ok(Math.abs(weights.reduce((sum, one) => sum + one, 0) - 1) < 1e-12)
  })

  it('turns a ranking into weights', () => {
    const out = good('decide.weights-ranking', { order: ['price', 'weight', 'battery'] })
    const weights = out.weights as Record<string, number>
    assert.ok(weights.price > weights.weight)
    assert.ok(weights.weight > weights.battery)
  })

  it('reports the consistency of contradictory pairwise comparisons', () => {
    const out = good('decide.weights-pairwise', {
      criteria: ['price', 'weight', 'battery'],
      comparisons: [
        { a: 'price', b: 'weight', ratio: 2 },
        { a: 'weight', b: 'battery', ratio: 2 },
        // Consistent would be 4. Saying 2 contradicts the other two.
        { a: 'price', b: 'battery', ratio: 2 }
      ]
    })
    assert.ok(typeof out.consistency === 'number')
    assert.ok((out.consistency as number) > 0)
    assert.equal(out.method, 'pairwise')
  })

  it('gives a near-zero consistency ratio for comparisons that agree', () => {
    const out = good('decide.weights-pairwise', {
      criteria: ['price', 'weight', 'battery'],
      comparisons: [
        { a: 'price', b: 'weight', ratio: 2 },
        { a: 'weight', b: 'battery', ratio: 2 },
        { a: 'price', b: 'battery', ratio: 4 }
      ]
    })
    assert.ok((out.consistency as number) < 0.05)
    assert.equal(out.consistent, true, 'comparisons that agree should be judged consistent')
  })

  it('summarises risks for one option', () => {
    const out = good('decide.risks', {
      optionId: 'a',
      risks: [
        { id: 'r1', optionId: 'a', description: 'Supplier late', probability: 0.3, impact: 5000, residualProbability: 0.1 },
        { id: 'r2', optionId: 'a', description: 'Price rises', probability: 0.5, impact: 1000 }
      ]
    })
    assert.ok(JSON.stringify(out).length > 20)
  })

  it('keeps a risk with no mitigation distinct from one whose mitigation changes nothing', () => {
    const none = good('decide.risks', {
      optionId: 'a',
      risks: [{ id: 'r', optionId: 'a', description: 'X', probability: 0.4, impact: 100 }]
    })
    const useless = good('decide.risks', {
      optionId: 'a',
      risks: [{ id: 'r', optionId: 'a', description: 'X', probability: 0.4, impact: 100, residualProbability: 0.4 }]
    })
    assert.notDeepEqual(none, useless)
  })

  it('refuses a criterion value that is neither a number, a word nor explicitly absent', () => {
    rejects(
      'decide.rank',
      { ...laptops, options: [{ id: 'a', name: 'A', values: { price: [1, 2] } }] },
      /missing.*not-applicable|number, a word/
    )
  })

  it('refuses a criterion direction it does not know', () => {
    rejects(
      'decide.rank',
      { ...laptops, criteria: [{ id: 'price', name: 'Price', kind: 'number', direction: 'cheaper-ish' }] },
      /not one of/
    )
  })

  it('refuses an option with no values object', () => {
    rejects('decide.rank', { ...laptops, options: [{ id: 'a', name: 'A' }] }, /values/)
  })

  it('serves the vocabulary a Page needs to build a comparison', () => {
    const out = good('decide.criterion-kinds')
    assert.equal((out.kinds as unknown[]).length, 7)
    assert.equal((out.directions as unknown[]).length, 5)
  })
})

describe('provenance', () => {
  it('serves every engine assumption list', () => {
    const out = good('planning.assumptions')
    for (const key of ['planning', 'comparing', 'deciding']) {
      assert.ok(Array.isArray(out[key]), `${key} assumptions missing`)
      assert.ok((out[key] as unknown[]).length >= 5, `${key} assumptions too thin`)
    }
  })

  it('says why there is no single decide operation', () => {
    const out = good('planning.assumptions')
    assert.match(out.noSingleDecide as string, /predicate function/)
    assert.equal(Object.prototype.hasOwnProperty.call(PLANNING_CAPABILITY, 'decide.decide'), false)
  })
})
