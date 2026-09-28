import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  COMPARE_ASSUMPTIONS,
  MISSING,
  NOT_APPLICABLE,
  criterion,
  differences,
  filterEntities,
  isCompareError,
  normalise,
  pareto,
  rank,
  stability,
  tradeOff,
  type Criterion,
  type Entity
} from './compare.ts'
import {
  DECISION_ASSUMPTIONS,
  checkEligibility,
  decide,
  equalWeights,
  foldTree,
  isDecisionError,
  summariseRisks,
  valueOfInformation,
  weightsFromPairwise,
  weightsFromRanking,
  type Requirement,
  type Risk,
  type TreeNode
} from './decision.ts'

const c = (id: string, name: string, kind: Parameters<typeof criterion>[2], direction: Parameters<typeof criterion>[3], options?: Partial<Criterion>): Criterion => {
  const one = criterion(id, name, kind, direction, options)
  if (isCompareError(one)) throw new Error(one.message)
  return one
}

const laptops = (): Entity[] => [
  { id: 'a', name: 'Laptop A', values: { price: 80000, ram: 16, battery: 10 }, describe: '', source: '' },
  { id: 'b', name: 'Laptop B', values: { price: 120000, ram: 32, battery: 8 }, describe: '', source: '' },
  { id: 'c', name: 'Laptop C', values: { price: 100000, ram: 16, battery: 12 }, describe: '', source: '' }
]

const criteria = (): Criterion[] => [
  c('price', 'Price', 'currency', 'lower-better', { unit: 'INR', weight: 3 }),
  c('ram', 'Memory', 'number', 'higher-better', { unit: 'GB', weight: 2 }),
  c('battery', 'Battery', 'number', 'higher-better', { unit: 'h', weight: 1 })
]

describe('criteria', () => {
  test('a target criterion needs a target', () => {
    assert.ok(isCompareError(criterion('t', 'Temperature', 'number', 'target')))
    assert.ok(!isCompareError(criterion('t', 'Temperature', 'number', 'target', { target: 20 })))
  })

  test('a range criterion needs a valid range', () => {
    assert.ok(isCompareError(criterion('r', 'R', 'number', 'range')))
    assert.ok(isCompareError(criterion('r', 'R', 'number', 'range', { range: { low: 10, high: 2 } })))
  })

  test('a rating needs ordered levels, because without an order there is nothing to compare', () => {
    const bad = criterion('q', 'Quality', 'rating', 'higher-better')
    assert.ok(isCompareError(bad))
    assert.match(bad.message, /Without an order the values cannot be compared/)
  })

  test('a negative weight is refused', () => {
    assert.ok(isCompareError(criterion('p', 'P', 'number', 'higher-better', { weight: -1 })))
  })
})

describe('normalisation', () => {
  test('lower-is-better puts the smallest at one', () => {
    const scores = normalise(laptops(), criteria()[0])
    assert.ok(!isCompareError(scores))
    assert.equal(scores.find((one) => one.entityId === 'a')?.score, 1)
    assert.equal(scores.find((one) => one.entityId === 'b')?.score, 0)
  })

  test('a score is relative to the options compared, and says so', () => {
    const scores = normalise(laptops(), criteria()[0])
    assert.ok(!isCompareError(scores))
    assert.match(scores[0].describe, /the best of these, not good in absolute terms/)
  })

  test('a missing value is left unscored rather than treated as zero', () => {
    const withGap = [...laptops(), { id: 'd', name: 'Laptop D', values: { ram: 8 }, describe: '', source: '' }]
    const scores = normalise(withGap, criteria()[0])
    assert.ok(!isCompareError(scores))
    const gap = scores.find((one) => one.entityId === 'd')
    assert.equal(gap?.score, null)
    assert.match(gap?.describe ?? '', /would rank it as if it were the worst/)
  })

  test('not applicable is distinguished from not known', () => {
    const entities: Entity[] = [{ id: 'x', name: 'X', values: { price: NOT_APPLICABLE }, describe: '', source: '' }]
    const scores = normalise(entities, criteria()[0])
    assert.ok(!isCompareError(scores))
    assert.match(scores[0].describe, /does not apply/)
  })

  test('a neutral criterion is not scored at all', () => {
    const colour = c('colour', 'Colour', 'category', 'neutral')
    const entities: Entity[] = [{ id: 'x', name: 'X', values: { colour: 'red' }, describe: '', source: '' }]
    const scores = normalise(entities, colour)
    assert.ok(!isCompareError(scores))
    assert.equal(scores[0].score, null)
    assert.match(scores[0].describe, /has no better or worse/)
  })

  test('a target criterion scores by distance from the target', () => {
    const temperature = c('t', 'Temperature', 'number', 'target', { target: 20 })
    const entities: Entity[] = [
      { id: 'a', name: 'A', values: { t: 20 }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { t: 30 }, describe: '', source: '' },
      { id: 'c', name: 'C', values: { t: 25 }, describe: '', source: '' }
    ]
    const scores = normalise(entities, temperature)
    assert.ok(!isCompareError(scores))
    assert.equal(scores.find((one) => one.entityId === 'a')?.score, 1)
    assert.ok((scores.find((one) => one.entityId === 'c')?.score ?? 0) > (scores.find((one) => one.entityId === 'b')?.score ?? 0))
  })

  test('a rating is scored by its position in the declared order', () => {
    const quality = c('q', 'Quality', 'rating', 'higher-better', { scale: ['poor', 'fair', 'good', 'excellent'] })
    const entities: Entity[] = [
      { id: 'a', name: 'A', values: { q: 'poor' }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { q: 'excellent' }, describe: '', source: '' }
    ]
    const scores = normalise(entities, quality)
    assert.ok(!isCompareError(scores))
    assert.equal(scores[0].score, 0)
    assert.equal(scores[1].score, 1)
  })

  test('every entity having the same value is reported as not separating them', () => {
    const entities: Entity[] = [
      { id: 'a', name: 'A', values: { ram: 16 }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { ram: 16 }, describe: '', source: '' }
    ]
    const scores = normalise(entities, criteria()[1])
    assert.ok(!isCompareError(scores))
    assert.match(scores[0].describe, /does not separate them/)
  })
})

describe('differences', () => {
  test('a quantitative difference is computed both ways', () => {
    const found = differences(laptops()[0], laptops()[1], criteria())
    const price = found.find((one) => one.criterionId === 'price')
    assert.equal(price?.absolute, 40000)
    assert.equal(price?.relative, 0.5)
    assert.equal(price?.better, 'a')
  })

  test('categories have no difference to subtract, and none is invented', () => {
    const material = c('m', 'Material', 'category', 'neutral')
    const a: Entity = { id: 'a', name: 'A', values: { m: 'steel' }, describe: '', source: '' }
    const b: Entity = { id: 'b', name: 'B', values: { m: 'aluminium' }, describe: '', source: '' }
    const found = differences(a, b, [material])
    assert.equal(found[0].absolute, null)
    assert.match(found[0].describe, /no difference to subtract/)
  })

  test('a criterion one side is missing is not comparable, and says which side', () => {
    const a: Entity = { id: 'a', name: 'Alpha', values: { price: 100 }, describe: '', source: '' }
    const b: Entity = { id: 'b', name: 'Beta', values: { price: MISSING }, describe: '', source: '' }
    const found = differences(a, b, criteria())
    const price = found.find((one) => one.criterionId === 'price')
    assert.equal(price?.comparable, false)
    assert.match(price?.describe ?? '', /Beta has no usable value/)
  })
})

describe('ranking', () => {
  test('the leader is the best under the weights, and never called the best outright', () => {
    const result = rank(laptops(), criteria())
    assert.ok(!isCompareError(result))
    assert.ok(result.leader)
    assert.ok(result.notes.some((one) => /no option is called the best outright/.test(one)))
  })

  test('the contributions add up to the total, so a score can be taken apart', () => {
    const result = rank(laptops(), criteria())
    assert.ok(!isCompareError(result))
    for (const score of result.scores) {
      const sum = score.contributions.reduce((total, one) => total + one.contribution, 0)
      assert.ok(Math.abs(sum / score.weightUsed - score.total) < 1e-12)
    }
  })

  test('changing the weights changes the order, which is the point', () => {
    const cheap = rank(laptops(), [c('price', 'Price', 'currency', 'lower-better', { weight: 10 }), criteria()[1]])
    const memory = rank(laptops(), [criteria()[0], c('ram', 'Memory', 'number', 'higher-better', { weight: 10 })])
    assert.ok(!isCompareError(cheap) && !isCompareError(memory))
    assert.notEqual(cheap.leader, memory.leader)
  })

  test('an entity missing a value is scored on what is known and reported as incomplete', () => {
    const withGap = [...laptops(), { id: 'd', name: 'Laptop D', values: { ram: 64 }, describe: '', source: '' }]
    const result = rank(withGap, criteria())
    assert.ok(!isCompareError(result))
    assert.ok(result.incomplete.includes('Laptop D'))
    assert.ok(result.notes.some((one) => /less weight than the others/.test(one)))
  })

  test('all-neutral criteria cannot rank anything', () => {
    const result = rank(laptops(), [c('colour', 'Colour', 'category', 'neutral')])
    assert.ok(isCompareError(result))
    assert.match(result.message, /needs a direction to contribute/)
  })

  test('a tie at the top is reported as a tie', () => {
    const identical: Entity[] = [
      { id: 'a', name: 'A', values: { ram: 16 }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { ram: 16 }, describe: '', source: '' }
    ]
    const result = rank(identical, [criteria()[1]])
    assert.ok(!isCompareError(result))
    assert.equal(result.tied, true)
  })
})

describe('stability', () => {
  test('a clear winner holds across most weightings', () => {
    // An option that is best on everything cannot be beaten by any weighting.
    const dominant: Entity[] = [
      { id: 'a', name: 'A', values: { price: 100, ram: 64, battery: 20 }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { price: 200, ram: 8, battery: 4 }, describe: '', source: '' }
    ]
    const result = stability(dominant, criteria(), { samples: 500, seed: 3 })
    assert.ok(!isCompareError(result))
    assert.equal(result.leaderHeld, 1)
    assert.equal(result.verdict, 'stable')
  })

  test('a close call is reported as sensitive, with the alternatives named', () => {
    const close: Entity[] = [
      { id: 'a', name: 'Cheap', values: { price: 100, ram: 8, battery: 4 }, describe: '', source: '' },
      { id: 'b', name: 'Powerful', values: { price: 200, ram: 64, battery: 20 }, describe: '', source: '' }
    ]
    const result = stability(close, criteria(), { samples: 500, seed: 3 })
    assert.ok(!isCompareError(result))
    assert.notEqual(result.verdict, 'stable')
    assert.ok(result.alternatives.length > 0)
    assert.match(result.describe, /statement about the weights/)
  })

  test('the same seed gives the same answer', () => {
    const first = stability(laptops(), criteria(), { samples: 300, seed: 7 })
    const again = stability(laptops(), criteria(), { samples: 300, seed: 7 })
    assert.ok(!isCompareError(first) && !isCompareError(again))
    assert.equal(first.leaderHeld, again.leaderHeld)
  })
})

describe('Pareto and trade-offs', () => {
  test('an option beaten on everything is off the frontier, and no weighting saves it', () => {
    const withLoser = [
      ...laptops(),
      { id: 'z', name: 'Laptop Z', values: { price: 200000, ram: 4, battery: 2 }, describe: '', source: '' }
    ]
    const result = pareto(withLoser, criteria())
    assert.ok(!isCompareError(result))
    assert.ok(!result.frontier.includes('z'))
    assert.match(result.describe, /no weighting makes it best/)
  })

  test('genuine trade-offs put everything on the frontier', () => {
    const result = pareto(laptops(), criteria())
    assert.ok(!isCompareError(result))
    assert.equal(result.frontier.length, 3)
    assert.match(result.describe, /genuine trade-off/)
  })

  test('a missing value cannot support domination', () => {
    const entities: Entity[] = [
      { id: 'a', name: 'A', values: { price: 100, ram: 64 }, describe: '', source: '' },
      { id: 'b', name: 'B', values: { price: 200 }, describe: '', source: '' }
    ]
    const result = pareto(entities, criteria().slice(0, 2))
    assert.ok(!isCompareError(result))
    // B is worse on price and unknown on memory, so it is not known to be dominated.
    assert.ok(result.frontier.includes('b'))
  })

  test('a trade-off names what is gained and what is lost', () => {
    const result = tradeOff(laptops()[0], laptops()[1], criteria())
    assert.ok(result.gains.length > 0)
    assert.ok(result.losses.length > 0)
    assert.match(result.describe, /gains .* and costs/)
  })

  test('an option better on everything has no trade-off against another', () => {
    const better: Entity = { id: 'x', name: 'X', values: { price: 1, ram: 999, battery: 999 }, describe: '', source: '' }
    const result = tradeOff(laptops()[0], better, criteria())
    assert.equal(result.losses.length, 0)
    assert.match(result.describe, /no trade-off/)
  })
})

describe('filtering', () => {
  test('an entity failing a filter is removed with the reason', () => {
    const result = filterEntities(laptops(), criteria(), [{ criterionId: 'price', test: 'below', value: 110000, values: [] }])
    assert.deepEqual(result.kept.sort(), ['a', 'c'])
    assert.match(result.removed[0].because, /does not pass the filter/)
  })

  test('removal for a missing value is reported separately from failing', () => {
    const withGap = [...laptops(), { id: 'd', name: 'Laptop D', values: {}, describe: '', source: '' }]
    const result = filterEntities(withGap, criteria(), [{ criterionId: 'price', test: 'below', value: 110000, values: [] }])
    assert.deepEqual(result.removedForMissing, ['d'])
    assert.match(result.describe, /not the same as failing the filter/)
  })
})

describe('eligibility', () => {
  const requirements: Requirement[] = [
    { id: 'budget', criterionId: 'price', statement: 'Price must be below 110,000', test: (value) => typeof value === 'number' && value < 110000, describe: '' }
  ]

  test('an option breaking a requirement is ineligible however good it is elsewhere', () => {
    const results = checkEligibility(laptops(), requirements)
    const b = results.find((one) => one.optionId === 'b')
    assert.equal(b?.eligibility, 'ineligible')
    assert.match(b?.describe ?? '', /not a heavy weight/)
  })

  test('an option missing the value is unknown, neither ruled in nor out', () => {
    const results = checkEligibility([{ id: 'x', name: 'X', values: {}, describe: '', source: '' }], requirements)
    assert.equal(results[0].eligibility, 'unknown')
    assert.match(results[0].describe, /neither ruled in nor ruled out/)
  })

  test('a requirement that throws counts as not met', () => {
    const throwing: Requirement[] = [
      {
        id: 'bad',
        criterionId: 'price',
        statement: 'throws',
        test: () => {
          throw new Error('boom')
        },
        describe: ''
      }
    ]
    assert.equal(checkEligibility(laptops(), throwing)[0].eligibility, 'ineligible')
  })
})

describe('weights', () => {
  test('equal weights are stated as a choice', () => {
    const result = equalWeights(criteria())
    assert.ok(Math.abs(result.weights.price - 1 / 3) < 1e-12)
    assert.match(result.notes[0], /not the absence of one/)
  })

  test('a ranking becomes weights by the rank-sum rule, and says it is one reading', () => {
    const result = weightsFromRanking(['price', 'ram', 'battery'])
    assert.ok(!isDecisionError(result))
    assert.ok(result.weights.price > result.weights.ram)
    assert.ok(result.weights.ram > result.weights.battery)
    assert.ok(Math.abs(result.weights.price + result.weights.ram + result.weights.battery - 1) < 1e-12)
    assert.match(result.notes[0], /one reasonable reading of it rather than the only one/)
  })

  test('a repeated criterion in a ranking is refused', () => {
    assert.ok(isDecisionError(weightsFromRanking(['a', 'a'])))
  })

  test('consistent pairwise judgements give sensible weights', () => {
    // Price twice memory, memory twice battery, price four times battery: perfectly consistent.
    const result = weightsFromPairwise(['price', 'ram', 'battery'], [
      { a: 'price', b: 'ram', ratio: 2 },
      { a: 'ram', b: 'battery', ratio: 2 },
      { a: 'price', b: 'battery', ratio: 4 }
    ])
    assert.ok(!isDecisionError(result))
    assert.equal(result.consistent, true)
    assert.ok(result.consistency !== null && result.consistency < 0.01)
    assert.ok(Math.abs(result.weights.price / result.weights.ram - 2) < 1e-6)
  })

  test('contradictory judgements are reported as inconsistent rather than quietly averaged', () => {
    const result = weightsFromPairwise(['a', 'b', 'c'], [
      { a: 'a', b: 'b', ratio: 9 },
      { a: 'b', b: 'c', ratio: 9 },
      { a: 'a', b: 'c', ratio: 1 / 9 }
    ])
    assert.ok(!isDecisionError(result))
    assert.equal(result.consistent, false)
    assert.ok(result.notes.some((one) => /cannot all be true/.test(one)))
  })

  test('a missing pair is refused, naming the pair', () => {
    const result = weightsFromPairwise(['a', 'b', 'c'], [{ a: 'a', b: 'b', ratio: 2 }])
    assert.ok(isDecisionError(result))
    assert.match(result.message, /No comparison was given between/)
  })
})

describe('risk', () => {
  const risks: Risk[] = [
    { id: 'r1', optionId: 'a', description: 'Supplier fails', probability: 0.1, impact: 100000, mitigation: 'second supplier', residualProbability: 0.02, source: '' },
    { id: 'r2', optionId: 'a', description: 'Minor delay', probability: 0.5, impact: 5000, mitigation: '', residualProbability: null, source: '' }
  ]

  test('expected cost and worst case are both reported, because they differ', () => {
    const summary = summariseRisks('a', risks)
    assert.ok(!isDecisionError(summary))
    assert.equal(summary.expectedCost, 0.1 * 100000 + 0.5 * 5000)
    assert.equal(summary.worstCase, 100000)
    assert.match(summary.describe, /a rare catastrophe has a small expected cost and is still a catastrophe/)
  })

  test('mitigation reduces the expected cost where a residual probability was given', () => {
    const summary = summariseRisks('a', risks)
    assert.ok(!isDecisionError(summary))
    assert.ok(summary.mitigatedExpectedCost < summary.expectedCost)
  })

  test('an option with no recorded risks says that is an absence of records', () => {
    const summary = summariseRisks('z', risks)
    assert.ok(!isDecisionError(summary))
    assert.match(summary.describe, /absence of records, not an absence of risk/)
  })

  test('a probability outside zero to one is refused', () => {
    const bad: Risk[] = [{ ...risks[0], probability: 1.5 }]
    assert.ok(isDecisionError(summariseRisks('a', bad)))
  })
})

describe('decision trees', () => {
  const tree: TreeNode = {
    kind: 'decision',
    id: 'd1',
    label: 'Invest or not',
    branches: [
      {
        label: 'Invest',
        node: {
          kind: 'chance',
          id: 'c1',
          label: 'Market',
          outcomes: [
            { label: 'Good', probability: 0.6, node: { kind: 'outcome', id: 'o1', label: 'Gain', value: 100 } },
            { label: 'Bad', probability: 0.4, node: { kind: 'outcome', id: 'o2', label: 'Loss', value: -50 } }
          ]
        }
      },
      { label: 'Do not invest', node: { kind: 'outcome', id: 'o3', label: 'Nothing', value: 0 } }
    ]
  }

  test('the tree folds to the expected value, and the choice follows from it', () => {
    const result = foldTree(tree)
    assert.ok(!isDecisionError(result))
    // 0.6*100 + 0.4*(-50) = 40, which beats 0.
    assert.ok(Math.abs(result.value - 40) < 1e-12)
    assert.equal(result.choices[0].take, 'Invest')
  })

  test('the range an expected value hides is reported beside it', () => {
    const result = foldTree(tree)
    assert.ok(!isDecisionError(result))
    assert.equal(result.range.worst, -50)
    assert.equal(result.range.best, 100)
  })

  test('probabilities that do not add to one are refused, naming the node', () => {
    const bad: TreeNode = {
      kind: 'chance',
      id: 'c',
      label: 'Coin',
      outcomes: [
        { label: 'Heads', probability: 0.6, node: { kind: 'outcome', id: 'a', label: 'A', value: 1 } },
        { label: 'Tails', probability: 0.6, node: { kind: 'outcome', id: 'b', label: 'B', value: 0 } }
      ]
    }
    const result = foldTree(bad)
    assert.ok(isDecisionError(result))
    assert.match(result.message, /adding to 1.2 rather than 1/)
  })

  test('the probabilities used are recorded as somebody’s estimates', () => {
    const result = foldTree(tree)
    assert.ok(!isDecisionError(result))
    assert.ok(result.probabilityNotes.some((one) => /probabilities somebody supplied/.test(one)))
  })

  test('a decision with no branches is refused', () => {
    assert.ok(isDecisionError(foldTree({ kind: 'decision', id: 'd', label: 'Empty', branches: [] })))
  })
})

describe('value of information', () => {
  test('where the best option depends on the outcome, knowing is worth something', () => {
    const result = valueOfInformation(
      [
        { label: 'Rain', probability: 0.5, valuesByOption: { umbrella: 10, sunglasses: -5 } },
        { label: 'Sun', probability: 0.5, valuesByOption: { umbrella: -2, sunglasses: 8 } }
      ],
      ['umbrella', 'sunglasses']
    )
    assert.ok(!isDecisionError(result))
    assert.ok(result.value > 0)
    assert.equal(result.wouldChangeDecision, true)
    assert.match(result.describe, /upper bound/)
  })

  test('where the same option wins whatever happens, knowing is worth nothing', () => {
    const result = valueOfInformation(
      [
        { label: 'Rain', probability: 0.5, valuesByOption: { good: 10, bad: 1 } },
        { label: 'Sun', probability: 0.5, valuesByOption: { good: 20, bad: 2 } }
      ],
      ['good', 'bad']
    )
    assert.ok(!isDecisionError(result))
    assert.equal(result.value, 0)
    assert.equal(result.wouldChangeDecision, false)
    assert.match(result.describe, /change nothing about the decision/)
  })

  test('probabilities that do not add to one are refused', () => {
    assert.ok(isDecisionError(valueOfInformation([{ label: 'A', probability: 0.3, valuesByOption: {} }], ['x'])))
  })
})

describe('the whole decision', () => {
  const requirements: Requirement[] = [
    { id: 'budget', criterionId: 'price', statement: 'Price must be below 110,000', test: (value) => typeof value === 'number' && value < 110000, describe: '' }
  ]

  test('eligibility comes first, so an ineligible option is never the leader', () => {
    const result = decide(laptops(), criteria(), requirements, [], { seed: 1 })
    assert.ok(!isDecisionError(result))
    assert.ok(!result.shortlist.includes('b'))
    assert.notEqual(result.ranking.leader, 'b')
    assert.ok(result.caveats.some((one) => /excluded for not meeting a requirement/.test(one)))
  })

  test('the summary is never a recommendation', () => {
    const result = decide(laptops(), criteria(), requirements, [], { seed: 1 })
    assert.ok(!isDecisionError(result))
    assert.match(result.summary, /Under the weights given/)
    assert.ok(result.caveats.some((one) => /not a recommendation/.test(one)))
  })

  test('with no eligible option, the decision says so rather than ranking the impossible', () => {
    const impossible: Requirement[] = [
      { id: 'free', criterionId: 'price', statement: 'Price must be zero', test: (value) => value === 0, describe: '' }
    ]
    const result = decide(laptops(), criteria(), impossible, [])
    assert.ok(isDecisionError(result))
    assert.match(result.message, /Either a requirement has to give/)
  })

  test('risk is reported separately and is not folded into the scores', () => {
    const risks: Risk[] = [{ id: 'r', optionId: 'a', description: 'Fails', probability: 0.1, impact: 50000, mitigation: '', residualProbability: null, source: '' }]
    const result = decide(laptops(), criteria(), requirements, risks, { seed: 1 })
    assert.ok(!isDecisionError(result))
    assert.ok(result.caveats.some((one) => /not in the scores/.test(one)))
  })

  test('an unknown-eligibility option is ranked but flagged as not known to qualify', () => {
    const withGap = [...laptops(), { id: 'd', name: 'Laptop D', values: { ram: 32, battery: 9 }, describe: '', source: '' }]
    const result = decide(withGap, criteria(), requirements, [], { seed: 1 })
    assert.ok(!isDecisionError(result))
    assert.ok(result.shortlist.includes('d'))
    assert.ok(result.caveats.some((one) => /without being known to qualify/.test(one)))
  })
})

describe('the assumptions are stated', () => {
  test('both lists name the distinctions their Page is built on', () => {
    assert.ok(COMPARE_ASSUMPTIONS.some((one) => /never zero/.test(one)))
    assert.ok(COMPARE_ASSUMPTIONS.some((one) => /no universally best option/.test(one)))
    assert.ok(DECISION_ASSUMPTIONS.some((one) => /Nothing here recommends/.test(one)))
    assert.ok(DECISION_ASSUMPTIONS.some((one) => /not a heavy weight/.test(one)))
  })
})
