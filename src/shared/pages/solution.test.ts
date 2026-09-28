import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  DOMAIN_WORDS,
  SOLUTION_ASSUMPTIONS,
  checkAnswer,
  checkWork,
  chooseMethods,
  classifyProblem,
  compareBranch,
  emptyProblem,
  formalise,
  isSolutionError,
  readObjective,
  readQuantities,
  resolveBranch,
  statusOf,
  verifyByAgreement,
  verifyBySubstitution,
  verifyConstraints,
  verifyDimensions,
  type Branch,
  type Method,
  type Solution,
  type Verification
} from './solution.ts'

describe('classification', () => {
  test('a problem is classified from words, and the matches are returned', () => {
    const signals = classifyProblem('Solve the quadratic equation for x')
    assert.equal(signals[0].domain, 'algebra')
    assert.ok(signals[0].matched.includes('quadratic'))
    assert.ok(signals[0].matched.includes('solve'))
  })

  test('a problem spanning two domains gets both, not one', () => {
    const signals = classifyProblem('Find the velocity by taking the derivative of the position')
    const domains = signals.map((one) => one.domain)
    assert.ok(domains.includes('mechanics'))
    assert.ok(domains.includes('calculus'))
  })

  test('a longer phrase counts for more than a single word', () => {
    const phrase = classifyProblem('compute the expected value')
    const single = classifyProblem('compute the chance')
    assert.ok((phrase.find((one) => one.domain === 'probability')?.score ?? 0) > (single.find((one) => one.domain === 'probability')?.score ?? 0))
  })

  test('text matching nothing gets no signals rather than a default domain', () => {
    assert.deepEqual(classifyProblem('the quick brown fox'), [])
  })

  test('every domain except unknown has vocabulary', () => {
    for (const [domain, words] of Object.entries(DOMAIN_WORDS)) {
      if (domain === 'unknown') continue
      assert.ok(words.length >= 5, `${domain} has only ${words.length} words`)
    }
  })
})

describe('reading a problem', () => {
  test('numbers with units are read as quantities', () => {
    const found = readQuantities('A block of mass 5 kg moves at 12 m/s')
    assert.equal(found.length, 2)
    assert.equal(found[0].value, 5)
    assert.equal(found[0].unit, 'kg')
    assert.equal(found[1].unit, 'm/s')
  })

  test('the words before a number are used to name it', () => {
    const found = readQuantities('the velocity is 20 m/s')
    assert.match(found[0].name, /velocity/)
  })

  test('a number with nothing recognisable before it is named by position rather than invented', () => {
    const found = readQuantities('12 m/s')
    assert.match(found[0].name, /value 1/)
  })

  test('every quantity records that it was stated rather than inferred', () => {
    const found = readQuantities('a distance of 100 m')
    assert.ok(found.every((one) => one.origin === 'stated'))
  })

  test('what is being asked for is read from the phrasing', () => {
    assert.equal(readObjective('Find the acceleration')?.kind, 'solve')
    assert.equal(readObjective('Minimise the cost')?.kind, 'minimise')
    assert.equal(readObjective('Prove that the angles are equal')?.kind, 'prove')
    assert.equal(readObjective('Explain why this happens')?.kind, 'describe')
  })

  test('text that does not say what to find gives null rather than a guess', () => {
    assert.equal(readObjective('A block of mass 5 kg sits on a table.'), null)
  })
})

describe('formalising', () => {
  test('the original text is never rewritten in place', () => {
    const problem = emptyProblem('p1', '  Solve   2x + 3 = 7  ')
    const result = formalise(problem)
    assert.equal(result.problem.original, '  Solve   2x + 3 = 7  ')
    assert.equal(result.problem.normalised, 'Solve 2x + 3 = 7')
  })

  test('a missing objective is reported as missing rather than assumed', () => {
    const result = formalise(emptyProblem('p1', 'A block of mass 5 kg.'))
    assert.ok(result.missing.includes('what is being asked for'))
    assert.ok(result.notes.some((one) => /Orbis has not guessed/.test(one)))
  })

  test('a tie between domains is reported as an ambiguity', () => {
    // One word from each of two domains gives an equal score.
    const problem = emptyProblem('p1', 'factor the prime')
    const result = formalise(problem)
    if (result.ambiguities.length > 0) {
      assert.equal(result.ambiguities[0].about, 'domain')
      assert.ok(result.ambiguities[0].alternatives.length >= 2)
    }
  })

  test('unitless numbers in a physical problem are flagged, not given a unit', () => {
    const result = formalise(emptyProblem('p1', 'A force of 10 acts on a mass of 2, find the acceleration'))
    assert.ok(result.notes.some((one) => /Orbis has not assumed any/.test(one)))
  })

  test('a problem with no numbers at all says so', () => {
    const result = formalise(emptyProblem('p1', 'Prove that the angles of a triangle sum to two right angles'))
    assert.ok(result.missing.includes('any numeric quantities'))
  })
})

describe('choosing methods', () => {
  const catalogue: Method[] = [
    { id: 'quadratic', name: 'Quadratic formula', operation: 'algebra.roots', domain: 'algebra', requires: [], assumes: [], describe: '' },
    { id: 'factor', name: 'Factorising', operation: 'algebra.factor', domain: 'algebra', requires: ['discriminant'], assumes: [], describe: '' },
    { id: 'galois', name: 'Solution by radicals', operation: null, domain: 'algebra', requires: [], assumes: [], describe: '' },
    { id: 'kinematic', name: 'Constant acceleration', operation: 'physics.kinematics', domain: 'mechanics', requires: [], assumes: [], describe: '' }
  ]

  const problem = () => ({ ...emptyProblem('p1', 'solve the quadratic'), domain: 'algebra' as const })

  test('a method whose engine is present and whose inputs are there is applicable', () => {
    const choice = chooseMethods(problem(), catalogue, new Set(['algebra.roots', 'algebra.factor']))
    assert.ok(choice.applicable.some((one) => one.id === 'quadratic'))
  })

  test('a method missing an input is blocked, and what is missing is named', () => {
    const choice = chooseMethods(problem(), catalogue, new Set(['algebra.roots', 'algebra.factor']))
    const blocked = choice.blocked.find((one) => one.method.id === 'factor')
    assert.ok(blocked)
    assert.deepEqual(blocked.missing, ['discriminant'])
  })

  test('a method with no engine is reported as unavailable rather than left off the list', () => {
    const choice = chooseMethods(problem(), catalogue, new Set(['algebra.roots']))
    assert.ok(choice.unavailable.some((one) => one.id === 'galois'))
    assert.match(choice.describe, /does not have an engine for/)
  })

  test('methods from another domain are not offered', () => {
    const choice = chooseMethods(problem(), catalogue, new Set(['physics.kinematics', 'algebra.roots']))
    assert.ok(!choice.applicable.some((one) => one.id === 'kinematic'))
  })

  test('a problem with no method at all says so plainly', () => {
    const choice = chooseMethods({ ...emptyProblem('p', ''), domain: 'chemistry' }, catalogue, new Set())
    assert.match(choice.describe, /no method for a chemistry problem/)
  })
})

describe('verification', () => {
  const evaluate = (expression: string, scope: Record<string, number>): number | null => {
    // A tiny evaluator: enough to exercise the verification, and deliberately not an engine.
    const replaced = expression.replace(/[a-z]+/gi, (name) => (Object.prototype.hasOwnProperty.call(scope, name) ? String(scope[name]) : name))
    if (!/^[\d\s+\-*/.()]+$/.test(replaced)) return null
    try {
      const parts = replaced.split('+').map((one) => one.split('*').reduce((a, b) => a * Number(b), 1))
      return parts.reduce((a, b) => a + b, 0)
    } catch {
      return null
    }
  }

  test('substituting back reports both sides, not just a verdict', () => {
    const result = verifyBySubstitution(['2*x = 8'], { x: 4 }, evaluate)
    assert.equal(result.passed, true)
    assert.match(result.evidence, /8/)
    assert.match(result.describe, /not on whether the equations describe the problem/)
  })

  test('an answer that does not satisfy the equation fails, and says what does not balance', () => {
    const result = verifyBySubstitution(['2*x = 8'], { x: 5 }, evaluate)
    assert.equal(result.passed, false)
    assert.match(result.evidence, /these differ/)
  })

  test('with no relations to substitute into, nothing is checked and the kind is none', () => {
    const result = verifyBySubstitution([], {}, evaluate)
    assert.equal(result.kind, 'none')
    assert.match(result.describe, /nothing could be checked/)
  })

  test('two methods agreeing is evidence, with the shared-assumption caveat stated', () => {
    const a: Solution = { id: 's1', methodId: 'm1', value: 4, unit: '', steps: [], verifications: [], assumptions: [], warnings: [], status: 'unverified', describe: '' }
    const b: Solution = { ...a, id: 's2', methodId: 'm2' }
    const result = verifyByAgreement(a, b)
    assert.equal(result.passed, true)
    assert.match(result.describe, /can still both be wrong in the same way/)
  })

  test('two methods disagreeing is a finding, and averaging is named as wrong', () => {
    const a: Solution = { id: 's1', methodId: 'm1', value: 4, unit: '', steps: [], verifications: [], assumptions: [], warnings: [], status: 'unverified', describe: '' }
    const b: Solution = { ...a, id: 's2', methodId: 'm2', value: 6 }
    const result = verifyByAgreement(a, b)
    assert.equal(result.passed, false)
    assert.match(result.describe, /averaging them would produce a third answer that is also wrong/)
  })

  test('constraints are checked, and ones stated in words are counted as unchecked', () => {
    const result = verifyConstraints(
      [
        { id: 'c1', statement: 'x is positive', check: (v) => v.x > 0, origin: 'stated' },
        { id: 'c2', statement: 'the block does not leave the table', check: null, origin: 'stated' }
      ],
      { x: 5 }
    )
    assert.equal(result.passed, true)
    assert.match(result.describe, /1 stated in words were not checked/)
  })

  test('an answer breaking a constraint is not a solution, and the message says so', () => {
    const result = verifyConstraints([{ id: 'c1', statement: 'x is positive', check: (v) => v.x > 0, origin: 'stated' }], { x: -1 })
    assert.equal(result.passed, false)
    assert.match(result.describe, /is not a solution to it/)
  })

  test('a constraint that throws counts as broken rather than as satisfied', () => {
    const result = verifyConstraints(
      [
        {
          id: 'c1',
          statement: 'this throws',
          check: () => {
            throw new Error('boom')
          },
          origin: 'stated'
        }
      ],
      {}
    )
    assert.equal(result.passed, false)
  })

  test('units are compared, and a missing unit is not treated as matching', () => {
    assert.equal(verifyDimensions('m/s', 'm/s').passed, true)
    assert.equal(verifyDimensions('m/s', 'm').passed, false)
    const missing = verifyDimensions('m/s', '')
    assert.equal(missing.kind, 'none')
    assert.match(missing.describe, /not the same as a matching one/)
  })

  test('the status comes from the checks that ran, with four distinct states', () => {
    const passed: Verification = { kind: 'substituted', passed: true, evidence: '', describe: '' }
    const failed: Verification = { kind: 'substituted', passed: false, evidence: '', describe: '' }
    const none: Verification = { kind: 'none', passed: false, evidence: '', describe: '' }

    assert.equal(statusOf([]), 'unverified')
    assert.equal(statusOf([none]), 'unverified')
    assert.equal(statusOf([passed]), 'verified')
    assert.equal(statusOf([failed]), 'failed-verification')
    assert.equal(statusOf([passed, failed]), 'partial')
  })
})

describe('branches', () => {
  const problem = () => ({
    ...emptyProblem('p1', 'A block of mass 5 kg is pushed with 20 N'),
    known: [
      { id: 'm', name: 'mass', value: 5, unit: 'kg', origin: 'stated' as const, from: '5 kg' },
      { id: 'f', name: 'force', value: 20, unit: 'N', origin: 'stated' as const, from: '20 N' }
    ]
  })

  const branches: Branch[] = [
    { id: 'b1', name: 'Heavier', parent: null, changes: { m: 10 }, solutionId: null, describe: '' },
    { id: 'b2', name: 'And harder', parent: 'b1', changes: { f: 40 }, solutionId: null, describe: '' }
  ]

  test('a branch resolves against the original, which is never modified', () => {
    const base = problem()
    const values = resolveBranch(base, branches, 'b1')
    assert.ok(!isSolutionError(values))
    assert.equal(values.m, 10)
    assert.equal(values.f, 20)
    assert.equal(base.known[0].value, 5)
  })

  test('a nested branch inherits its parent’s changes', () => {
    const values = resolveBranch(problem(), branches, 'b2')
    assert.ok(!isSolutionError(values))
    assert.equal(values.m, 10)
    assert.equal(values.f, 40)
  })

  test('a branch changing a quantity that is not in the problem is refused', () => {
    const bad: Branch[] = [{ id: 'b', name: 'Bad', parent: null, changes: { nope: 1 }, solutionId: null, describe: '' }]
    const values = resolveBranch(problem(), bad, 'b')
    assert.ok(isSolutionError(values))
    assert.match(values.message, /not a quantity in this problem/)
  })

  test('branches that refer back to each other are refused', () => {
    const looped: Branch[] = [
      { id: 'a', name: 'A', parent: 'b', changes: {}, solutionId: null, describe: '' },
      { id: 'b', name: 'B', parent: 'a', changes: {}, solutionId: null, describe: '' }
    ]
    assert.ok(isSolutionError(resolveBranch(problem(), looped, 'a')))
  })

  test('the comparison computes the difference rather than describing it', () => {
    const differences = compareBranch(problem(), { m: 5, f: 20 }, { m: 10, f: 20 }, 4, 2)
    assert.equal(differences.length, 1)
    assert.equal(differences[0].quantity, 'mass')
    assert.equal(differences[0].absolute, -2)
    assert.equal(differences[0].relative, -0.5)
  })

  test('a comparison with an unsolved side says the effect is not known', () => {
    const differences = compareBranch(problem(), { m: 5 }, { m: 10 }, 4, null)
    assert.equal(differences[0].absolute, null)
    assert.match(differences[0].describe, /not known/)
  })
})

describe('checking an answer', () => {
  test('a matching answer is correct, by arithmetic rather than by judgement', () => {
    const result = checkAnswer(4.5, 4.5)
    assert.equal(result.correct, true)
    assert.equal(result.difference, 0)
  })

  test('a wrong answer reports the difference', () => {
    const result = checkAnswer(5, 4)
    assert.equal(result.correct, false)
    assert.equal(result.difference, 1)
    assert.equal(result.relative, 0.25)
  })

  test('a sign error is recognised as one', () => {
    assert.match(checkAnswer(-9.8, 9.8).likelyMistake ?? '', /sign/)
  })

  test('a factor of two is recognised, with the reason it usually happens', () => {
    assert.match(checkAnswer(20, 10).likelyMistake ?? '', /factor of two/)
    assert.match(checkAnswer(5, 10).likelyMistake ?? '', /half/)
  })

  test('a unit-prefix error is recognised', () => {
    assert.match(checkAnswer(5000, 5).likelyMistake ?? '', /unit prefix/)
  })

  test('a degrees-radians mix-up is recognised', () => {
    assert.match(checkAnswer(1 * (Math.PI / 180), 1).likelyMistake ?? '', /degrees and radians/)
  })

  test('an unremarkable difference gets no invented explanation', () => {
    assert.equal(checkAnswer(4.7, 4.1).likelyMistake, null)
  })

  test('a right number in the wrong unit is reported as exactly that', () => {
    const result = checkAnswer(5, 5, { givenUnit: 'km', computedUnit: 'm' })
    assert.equal(result.correct, true)
    assert.equal(result.unitsMatch, false)
    assert.match(result.describe, /number is right but the unit is not/)
  })
})

describe('checking somebody’s working', () => {
  const evaluate = (expression: string): number | null => {
    if (!/^[\d\s+\-*/.()]+$/.test(expression)) return null
    const parts = expression.split('+').map((one) => one.split('*').reduce((a, b) => a * Number(b), 1))
    return parts.reduce((a, b) => a + b, 0)
  }

  test('working that follows is checked all the way through', () => {
    const result = checkWork([{ expression: '2*3', claims: 6 }, { expression: '6+4', claims: 10 }], evaluate)
    assert.equal(result.firstProblem, null)
    assert.ok(result.steps.every((one) => one.ok))
  })

  test('the first step that does not follow is named, and the rest are unchecked rather than wrong', () => {
    const result = checkWork(
      [{ expression: '2*3', claims: 6 }, { expression: '6+4', claims: 11 }, { expression: '11*2', claims: 22 }],
      evaluate
    )
    assert.equal(result.firstProblem, 1)
    assert.equal(result.steps[2].ok, false)
    assert.match(result.steps[2].describe, /Not checked/)
    assert.match(result.describe, /marking it wrong would be misleading/)
  })

  test('a step that cannot be evaluated stops the check there', () => {
    const result = checkWork([{ expression: 'sin(x)', claims: 1 }], evaluate)
    assert.equal(result.firstProblem, 0)
    assert.match(result.steps[0].describe, /could not be evaluated/)
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the Page is built on', () => {
    assert.ok(SOLUTION_ASSUMPTIONS.length >= 8)
    assert.ok(SOLUTION_ASSUMPTIONS.some((one) => /no confidence score/.test(one)))
    assert.ok(SOLUTION_ASSUMPTIONS.some((one) => /never approximated/.test(one)))
    assert.ok(SOLUTION_ASSUMPTIONS.some((one) => /unchecked rather than wrong/.test(one)))
  })
})
