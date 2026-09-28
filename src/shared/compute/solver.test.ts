import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expressionToText, parseExpression, type Expression } from './expression.ts'
import {
  asZeroForm,
  checkSolution,
  classify,
  equationToText,
  parseEquation,
  polynomialAt,
  polynomialCoefficients,
  polynomialDerivative,
  realPolynomialRoots,
  rearrangeFor,
  rootBound,
  solve,
  solveFor,
  solveLinearSystem,
  solutionSteps,
  unknownsOf,
  type Equation,
  type SolveResult
} from './solver.ts'

const equation = (text: string): Equation => {
  const parsed = parseEquation(text)
  assert.equal('error' in parsed, false, `could not parse "${text}": ${JSON.stringify(parsed)}`)
  return parsed as Equation
}

const solved = (text: string, variable?: string, options = {}): SolveResult => {
  const result = solve(text, variable, options)
  assert.equal('error' in result, false, `could not solve "${text}": ${JSON.stringify(result)}`)
  return result as SolveResult
}

const near = (actual: number, expected: number, tolerance = 1e-8): void =>
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-10, Math.abs(expected) * tolerance), `expected ${expected}, got ${actual}`)

/** Every root a result reports, sorted, so a test can compare sets without depending on order. */
const roots = (result: SolveResult): number[] => result.solutions.map((one) => one.value).sort((a, b) => a - b)

// ---------------------------------------------------------------- reading an equation

test('an equation splits on its equals sign, and one without a sign is against zero', () => {
  assert.equal(equationToText(equation('x + 1 = 5')), 'x + 1 = 5')
  assert.equal(equationToText(equation('x^2 - 4')), 'x^2 - 4 = 0')
  assert.equal((parseEquation('x = 1 = 2') as { error: string }).error, 'syntax')
})

test('the unknowns in an equation are reported from both sides', () => {
  assert.deepEqual(unknownsOf(equation('a*x = b')), ['a', 'x', 'b'])
  // A named constant is not an unknown.
  assert.deepEqual(unknownsOf(equation('2*pi*r = c')), ['r', 'c'])
})

test('rearranging to zero form keeps the meaning', () => {
  assert.equal(expressionToText(asZeroForm(equation('x + 1 = 5'))), 'x + 1 - 5')
})

// ---------------------------------------------------------------- polynomial extraction

test('coefficients are extracted exactly, by expansion rather than by fitting', () => {
  assert.deepEqual(polynomialCoefficients(parseExpression('x^2 + 3*x + 2') as Expression, 'x'), [2, 3, 1])
  assert.deepEqual(polynomialCoefficients(parseExpression('(x + 1)^3') as Expression, 'x'), [1, 3, 3, 1])
  assert.deepEqual(polynomialCoefficients(parseExpression('(x + 1)*(x - 1)') as Expression, 'x'), [-1, 0, 1])
  assert.deepEqual(polynomialCoefficients(parseExpression('5') as Expression, 'x'), [5])
  assert.deepEqual(polynomialCoefficients(parseExpression('x/2') as Expression, 'x'), [0, 0.5])
  // A symbol with a supplied value is a constant.
  assert.deepEqual(polynomialCoefficients(parseExpression('a*x') as Expression, 'x', { a: 3 }), [0, 3])
})

test('something that is not a polynomial is reported as not one, not approximated', () => {
  assert.equal(polynomialCoefficients(parseExpression('sin(x)') as Expression, 'x'), null)
  assert.equal(polynomialCoefficients(parseExpression('2^x') as Expression, 'x'), null)
  // Dividing by the unknown makes it rational, which has excluded values a polynomial does not.
  assert.equal(polynomialCoefficients(parseExpression('1/x') as Expression, 'x'), null)
  // A symbol with no value: nothing can be said about the degree yet.
  assert.equal(polynomialCoefficients(parseExpression('a*x') as Expression, 'x'), null)
})

test('Horner evaluation and the derivative agree with the expression they came from', () => {
  const coefficients = [2, 3, 1]
  assert.equal(polynomialAt(coefficients, 2), 2 + 6 + 4)
  assert.deepEqual(polynomialDerivative(coefficients), [3, 2])
  assert.deepEqual(polynomialDerivative([7]), [0])
})

test('the root bound really does contain every real root', () => {
  const coefficients = [-6, 11, -6, 1] // (x-1)(x-2)(x-3)
  const bound = rootBound(coefficients)
  for (const root of [1, 2, 3]) assert.ok(Math.abs(root) <= bound, `${root} is outside the bound ${bound}`)
})

// ---------------------------------------------------------------- classification

test('an equation is classified before it is solved', () => {
  assert.equal(classify(equation('2*x + 1 = 5'), 'x').kind, 'linear')
  assert.equal(classify(equation('x^2 = 4'), 'x').kind, 'quadratic')
  assert.equal(classify(equation('x^4 - 1 = 0'), 'x').kind, 'polynomial')
  assert.equal(classify(equation('x^4 - 1 = 0'), 'x').degree, 4)
  assert.equal(classify(equation('sin(x) = 0.5'), 'x').kind, 'transcendental')
  assert.equal(classify(equation('x = x'), 'x').kind, 'identity')
  assert.equal(classify(equation('x + 1 = x + 2'), 'x').kind, 'contradiction')
  assert.equal(classify(equation('a*x = b'), 'x').kind, 'underdetermined')
})

// ---------------------------------------------------------------- linear

test('a linear equation is rearranged exactly', () => {
  const result = solved('2*x + 1 = 5')
  assert.equal(result.status, 'solved')
  assert.equal(result.solutions.length, 1)
  near(result.solutions[0].value, 2)
  // Exact algebra should balance exactly, not nearly.
  assert.equal(result.solutions[0].confidence, 'exact')
  assert.equal(result.solutions[0].residual, 0)
  assert.equal(result.solutions[0].method, 'algebraic')
})

test('an equation that is always true and one that is never true are different answers', () => {
  assert.equal(solved('x = x').status, 'identity')
  assert.equal(solved('2*x = 2*x').status, 'identity')
  assert.equal(solved('x + 1 = x + 2').status, 'contradiction')
  assert.match(solved('x = x').message, /Every value/)
})

test('an equation with an unvalued parameter says what it needs rather than guessing', () => {
  const result = solved('a*x = b')
  assert.equal(result.status, 'underdetermined')
  assert.match(result.message, /a|b/)
  // And once the parameters are given it solves.
  const known = solved('a*x = b', 'x', { parameters: { a: 2, b: 10 } })
  assert.equal(known.status, 'solved')
  near(known.solutions[0].value, 5)
})

// ---------------------------------------------------------------- quadratic

test('a quadratic with two real roots gives both', () => {
  const result = solved('x^2 + 3*x + 2 = 0')
  assert.deepEqual(roots(result), [-2, -1])
  for (const one of result.solutions) assert.ok(one.confidence === 'exact' || one.confidence === 'verified')
})

test('a repeated root is reported once, with its multiplicity', () => {
  const result = solved('x^2 - 2*x + 1 = 0')
  assert.equal(result.solutions.length, 1)
  near(result.solutions[0].value, 1)
  assert.equal(result.solutions[0].multiplicity, 2)
  assert.match(result.notes.join(' '), /discriminant is zero/)
})

test('a quadratic with no real root reports the complex pair instead of claiming there is nothing', () => {
  const result = solved('x^2 + 1 = 0')
  assert.equal(result.status, 'no-real-solution')
  assert.equal(result.solutions.length, 0)
  assert.equal(result.complex.length, 2)
  near(result.complex[0].real, 0)
  near(Math.abs(result.complex[0].imaginary), 1)
  assert.match(result.notes.join(' '), /negative/)
})

test('a quadratic whose roots differ enormously in size is still accurate', () => {
  // The case the naive formula loses: b^2 dominates 4ac, so both roots from the same subtraction destroys the small one.
  const result = solved('x^2 - 1e8*x + 1 = 0')
  const found = roots(result)
  assert.equal(found.length, 2)
  // The small root is 1e-8 to a very good approximation. A naive implementation returns 0 here.
  near(found[0], 1e-8, 1e-6)
  near(found[1], 1e8, 1e-9)
  for (const one of result.solutions) {
    assert.notEqual(one.confidence, 'unverified', `residual ${one.residual} at ${one.value}`)
  }
})

// ---------------------------------------------------------------- higher polynomials

test('a cubic with three real roots finds all three', () => {
  const result = solved('x^3 - 6*x^2 + 11*x - 6 = 0')
  const found = roots(result)
  assert.equal(found.length, 3)
  near(found[0], 1)
  near(found[1], 2)
  near(found[2], 3)
})

test('a polynomial with fewer real roots than its degree says so', () => {
  const result = solved('x^3 - x^2 + x - 1 = 0')
  // Only x = 1 is real; the other two are a complex pair.
  assert.deepEqual(roots(result).map((one) => Number(one.toPrecision(8))), [1])
  assert.match(result.notes.join(' '), /counted with multiplicity/)
})

test('a root that only touches the axis is still found', () => {
  // (x-2)^2 (x+1): the double root at 2 produces no sign change, so a scan alone would miss it.
  const result = solved('(x - 2)^2 * (x + 1) = 0')
  const found = roots(result).map((one) => Number(one.toPrecision(6)))
  assert.ok(found.includes(-1), `expected -1 among ${found}`)
  assert.ok(found.includes(2), `expected 2 among ${found}`)
})

test('a polynomial with no real root reports none rather than inventing one', () => {
  const result = solved('x^4 + 1 = 0')
  assert.equal(result.status, 'no-real-solution')
  assert.equal(result.solutions.length, 0)
})

// ---------------------------------------------------------------- transcendental

test('an equation with no algebraic structure is scanned, and the range is part of the answer', () => {
  const result = solved('sin(x) = 0.5', 'x', { searchFrom: 0, searchTo: 3 })
  assert.equal(result.status, 'solved')
  near(result.solutions[0].value, Math.PI / 6, 1e-6)
  // Saying "no solution" without saying where you looked would be untrue.
  assert.match(result.notes.join(' '), /Searched 0 to 3/)
  assert.match(result.notes.join(' '), /outside that range/)
})

test('a transcendental equation with no root in range says where it looked', () => {
  const result = solved('exp(x) = -1', 'x', { searchFrom: -10, searchTo: 10 })
  assert.equal(result.status, 'no-real-solution')
  assert.match(result.message, /between -10 and 10/)
})

test('a scanned root is verified against the original equation', () => {
  const result = solved('x = cos(x)', 'x', { searchFrom: -5, searchTo: 5 })
  assert.equal(result.solutions.length, 1)
  near(result.solutions[0].value, 0.7390851332, 1e-6)
  assert.notEqual(result.solutions[0].confidence, 'unverified')
})

// ---------------------------------------------------------------- verification is not optional

test('every reported solution carries a residual', () => {
  for (const text of ['2*x = 8', 'x^2 - 9 = 0', 'x^3 - 8 = 0', 'sin(x) = 0.25']) {
    const result = solved(text, 'x', { searchFrom: -5, searchTo: 5 })
    for (const one of result.solutions) {
      assert.equal(typeof one.residual, 'number', text)
      assert.ok(Number.isFinite(one.residual), `${text} reported a non-finite residual`)
      assert.notEqual(one.confidence, 'unverified', `${text} reported an unverified solution`)
    }
  }
})

test('a root of the rearranged equation that the original rejects is dropped', () => {
  // Squaring both sides is where extraneous roots come from. sqrt(x) = -2 has none, but x = 4 satisfies the squared form.
  const result = solved('sqrt(x) = -2', 'x', { searchFrom: -1, searchTo: 20 })
  assert.equal(result.solutions.length, 0, `should have found nothing, found ${JSON.stringify(result.solutions)}`)
})

test('checkSolution judges a residual against the size of the terms, not absolutely', () => {
  const big = equation('x = 1e12')
  // Off by one part in 1e12 is noise at this scale and would be a real error at a scale of 1.
  const loose = checkSolution(big, 'x', 1e12 + 1)
  assert.ok(loose.confidence === 'verified' || loose.confidence === 'approximate')
  const small = equation('x = 1')
  assert.equal(checkSolution(small, 'x', 2).confidence, 'unverified')
  assert.equal(checkSolution(small, 'x', 1).confidence, 'exact')
})

test('a value outside the equation\'s domain cannot be verified', () => {
  const { confidence, residual } = checkSolution(equation('ln(x) = 0'), 'x', -1)
  assert.equal(confidence, 'unverified')
  assert.equal(residual, Number.POSITIVE_INFINITY)
})

// ---------------------------------------------------------------- root finding on its own

test('real roots are found from coefficients alone', () => {
  const { roots: found } = realPolynomialRoots([-6, 11, -6, 1])
  assert.equal(found.length, 3)
  near(found[0], 1)
  near(found[2], 3)
})

test('a constant has no roots, and a linear one has exactly one', () => {
  assert.deepEqual(realPolynomialRoots([5]).roots, [])
  const { roots: single } = realPolynomialRoots([-4, 2])
  assert.equal(single.length, 1)
  near(single[0], 2)
})

// ---------------------------------------------------------------- rearranging for a subject

test('a linear equation can be made to name a different subject', () => {
  const rearranged = rearrangeFor(equation('F = m*a'), 'a')
  assert.ok(rearranged)
  assert.equal(rearranged!.subject, 'a')
  // F/m, however the simplifier chooses to write it.
  assert.equal(expressionToText(rearranged!.expression), 'F / m')
  // And the condition that makes it valid travels with it.
  assert.match(rearranged!.conditions.join(' '), /m must not be zero/)
})

test('rearranging refuses anything where the answer would only sometimes be right', () => {
  // x^2 = a has two solutions. Returning sqrt(a) would silently discard one of them.
  assert.equal(rearrangeFor(equation('x^2 = a'), 'x'), null)
  assert.equal(rearrangeFor(equation('sin(x) = a'), 'x'), null)
  // And an unknown on both sides of a product is not linear in it.
  assert.equal(rearrangeFor(equation('x*x = 4'), 'x'), null)
})

// ---------------------------------------------------------------- linear systems

test('a system with one solution gives it, and every equation is checked', () => {
  const result = solveLinearSystem([equation('x + y = 10'), equation('x - y = 2')])
  assert.equal(result.status, 'unique')
  near(result.values.x, 6)
  near(result.values.y, 4)
  assert.equal(result.residuals.length, 2)
  assert.ok(result.confidence === 'exact' || result.confidence === 'verified')
  assert.ok(result.worstResidual < 1e-9)
})

test('a system that contradicts itself has no solution, and says why', () => {
  const result = solveLinearSystem([equation('x + y = 1'), equation('x + y = 2')])
  assert.equal(result.status, 'none')
  assert.match(result.message, /contradict/)
})

test('a system that does not pin everything down names the free unknowns', () => {
  const result = solveLinearSystem([equation('x + y = 10')])
  assert.equal(result.status, 'infinite')
  assert.equal(result.free.length, 1)
  assert.equal(result.rank, 1)
  assert.match(result.message, /any value/)
})

test('more equations than unknowns is fine when they agree', () => {
  const result = solveLinearSystem([equation('x = 3'), equation('2*x = 6'), equation('x + 1 = 4')])
  assert.equal(result.status, 'unique')
  near(result.values.x, 3)
})

test('a three-unknown system is solved correctly', () => {
  const result = solveLinearSystem([
    equation('x + y + z = 6'),
    equation('2*x - y + z = 3'),
    equation('x + 2*y - z = 2')
  ])
  assert.equal(result.status, 'unique')
  near(result.values.x, 1)
  near(result.values.y, 2)
  near(result.values.z, 3)
})

test('a system needing a pivot swap is still solved', () => {
  // A zero in the first pivot position: without partial pivoting this divides by zero.
  const result = solveLinearSystem([equation('0*x + y = 2'), equation('x + y = 5')])
  assert.equal(result.status, 'unique')
  near(result.values.x, 3)
  near(result.values.y, 2)
})

test('a non-linear equation is refused by the linear solver rather than mis-solved', () => {
  const result = solveLinearSystem([equation('x^2 + y = 1'), equation('x + y = 0')])
  assert.equal(result.status, 'invalid')
  assert.match(result.message, /linear/)
})

// ---------------------------------------------------------------- showing the work

test('the steps come from what the solver did, and include the evidence', () => {
  const eq = equation('x^2 + 3*x + 2 = 0')
  const steps = solutionSteps(eq, solveFor(eq, 'x'))
  const labels = steps.map((one) => one.label)
  assert.ok(labels.includes('The equation'))
  assert.ok(labels.includes('Method'))
  // Every root's step states the residual, because that is the evidence rather than a footnote.
  const rootSteps = steps.filter((one) => one.label.startsWith('x ='))
  assert.equal(rootSteps.length, 2)
  for (const step of rootSteps) assert.match(step.detail, /Substituted back/)
})

test('an equation with no unknown is judged true or false rather than solved', () => {
  assert.equal(solved('2 + 2 = 4').status, 'identity')
  assert.equal(solved('2 + 2 = 5').status, 'contradiction')
})
