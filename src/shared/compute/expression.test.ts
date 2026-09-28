import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSTANTS,
  depthOf,
  describeExpression,
  differentiate,
  evaluate,
  evaluateExpression,
  expressionToText,
  FUNCTIONS,
  functionsOf,
  isEvaluateError,
  isParseError,
  parseExpression,
  sameExpression,
  simplify,
  sizeOf,
  substitute,
  variablesOf,
  type Expression
} from './expression.ts'

/** A parsed expression, or a test failure. */
const parse = (text: string): Expression => {
  const parsed = parseExpression(text)
  assert.equal(isParseError(parsed), false, `could not parse "${text}": ${JSON.stringify(parsed)}`)
  return parsed as Expression
}

const value = (text: string, scope: Record<string, number> = {}): number => {
  const result = evaluate(text, scope)
  assert.equal(typeof result, 'number', `"${text}" did not evaluate: ${JSON.stringify(result)}`)
  return result as number
}

const near = (actual: number, expected: number, tolerance = 1e-9): void =>
  assert.ok(Math.abs(actual - expected) <= Math.abs(expected || 1) * tolerance, `expected ${expected}, got ${actual}`)

// ---------------------------------------------------------------- parsing

test('arithmetic respects precedence and association', () => {
  assert.equal(value('2 + 3 * 4'), 14)
  assert.equal(value('(2 + 3) * 4'), 20)
  assert.equal(value('10 - 3 - 2'), 5, 'subtraction groups to the left')
  assert.equal(value('2^3^2'), 512, 'exponentiation groups to the right')
  assert.equal(value('-2^2'), -4, 'a minus sign applies to the whole power')
  assert.equal(value('(-2)^2'), 4)
  assert.equal(value('100 / 5 / 2'), 10)
  assert.equal(value('7 % 3'), 1)
})

test('implicit multiplication is understood, because that is how mathematics is written', () => {
  assert.equal(value('2x', { x: 5 }), 10)
  assert.equal(value('3(x + 1)', { x: 2 }), 9)
  assert.equal(value('(x + 1)(x - 1)', { x: 3 }), 8)
  near(value('2sin(0)'), 0)
  assert.equal(value('2x^2', { x: 3 }), 18, 'the power binds tighter than the implied product')
})

test('two adjacent letters are one name, so a Page can have a variable called mass', () => {
  // The deliberate choice: splitting identifiers into single letters would make `velocity` unusable as a name.
  assert.deepEqual(variablesOf(parse('xy')), ['xy'])
  assert.deepEqual(variablesOf(parse('mass * velocity')), ['mass', 'velocity'])
  // Somebody who means the product writes the operator.
  assert.equal(value('x*y', { x: 3, y: 4 }), 12)
})

test('scientific notation is one number, not three tokens', () => {
  near(value('1e-3'), 0.001)
  near(value('2.5e3'), 2500)
  near(value('1e3 + 1'), 1001)
})

test('the characters people actually type are accepted', () => {
  assert.equal(value('2 × 3'), 6)
  assert.equal(value('6 ÷ 2'), 3)
  assert.equal(value('x²', { x: 4 }), 16)
  near(value('√(16)'), 4)
  near(value('2π'), Math.PI * 2)
})

test('a malformed expression is refused, with the place it gave up', () => {
  for (const bad of ['2 +', '(2 + 3', '2 + 3)', '*3', '2 $ 3', 'sin(', '2..3']) {
    const parsed = parseExpression(bad)
    assert.equal(isParseError(parsed), true, `"${bad}" should not parse`)
    assert.equal(typeof (parsed as { at: number }).at, 'number')
  }
})

test('an empty expression says so rather than being zero', () => {
  assert.equal((parseExpression('') as { error: string }).error, 'empty')
  assert.equal((parseExpression('   ') as { error: string }).error, 'empty')
})

test('an unknown function is refused at parse time, by name', () => {
  const parsed = parseExpression('frobnicate(2)')
  assert.equal((parsed as { error: string }).error, 'unknown-function')
  assert.match((parsed as { message: string }).message, /frobnicate/)
})

test('a function called with the wrong number of arguments is refused', () => {
  const parsed = parseExpression('sin(1, 2)')
  assert.equal((parsed as { error: string }).error, 'arity')
  assert.match((parsed as { message: string }).message, /1 argument/)
  // And one that genuinely takes two is fine.
  near(value('atan2(1, 1)'), Math.PI / 4)
  // As is an optional second.
  near(value('log(8, 2)'), 3)
  near(value('log(100)'), 2)
})

test('every declared function can actually be called', () => {
  // The table describing itself. A function in the registry that cannot be evaluated is a promise the parser breaks.
  for (const [name, definition] of Object.entries(FUNCTIONS)) {
    const least = typeof definition.arity === 'number' ? definition.arity : definition.arity[0]
    // 0.5 is inside every domain here: positive, and between -1 and 1.
    const args = Array.from({ length: least }, () => '0.5').join(', ')
    const result = evaluate(`${name}(${args})`)
    assert.equal(typeof result, 'number', `${name} could not be called: ${JSON.stringify(result)}`)
  }
})

// ---------------------------------------------------------------- evaluation

test('a symbol with no value names itself rather than becoming NaN', () => {
  const failed = evaluate('x + 1')
  assert.equal(isEvaluateError(failed), true)
  assert.equal((failed as { error: string }).error, 'unknown-symbol')
  assert.equal((failed as { symbol?: string }).symbol, 'x')
})

test('the named constants are available, and a scope may shadow them', () => {
  near(value('pi'), Math.PI)
  near(value('e'), Math.E)
  near(value('tau'), Math.PI * 2)
  // A Page is allowed a variable called `e`, and its value wins.
  assert.equal(value('e', { e: 5 }), 5)
  assert.ok('phi' in CONSTANTS)
})

test('division by zero is refused rather than returning infinity', () => {
  assert.equal((evaluate('1/0') as { error: string }).error, 'domain')
  assert.equal((evaluate('1 % 0') as { error: string }).error, 'domain')
})

test('a domain error says what the function needed', () => {
  assert.match((evaluate('sqrt(-4)') as { message: string }).message, /negative/)
  assert.match((evaluate('ln(0)') as { message: string }).message, /greater than zero/)
  assert.match((evaluate('asin(2)') as { message: string }).message, /between -1 and 1/)
})

test('a negative base with a fractional power has no real value, and says so', () => {
  assert.equal((evaluate('(-8)^(1/2)') as { error: string }).error, 'domain')
  // The cube root of a negative number does exist, and has its own function.
  near(value('cbrt(-8)'), -2)
  assert.equal((evaluate('0^-1') as { error: string }).error, 'domain')
})

test('an expression nested past the limit is refused rather than overflowing the stack', () => {
  // Brackets are transparent -- `((1))` is the same tree as `1` -- so depth has to come from real operators.
  const deep = Array.from({ length: 400 }, () => '1').join(' + ')
  const parsed = parse(deep)
  assert.ok(depthOf(parsed) > 256)
  assert.equal((evaluateExpression(parsed) as { error: string }).error, 'too-deep')
  // And one just inside the limit still evaluates.
  const shallow = parse(Array.from({ length: 100 }, () => '1').join(' + '))
  assert.equal(evaluateExpression(shallow), 100)
})

// ---------------------------------------------------------------- reading a tree

test('the variables an expression mentions are reported, constants excluded', () => {
  assert.deepEqual(variablesOf(parse('a*x^2 + b*x + c')), ['a', 'x', 'b', 'c'])
  // `pi` is a constant, not an unknown -- listing it would make a solvable equation look unsolvable.
  assert.deepEqual(variablesOf(parse('2*pi*r')), ['r'])
  assert.deepEqual(variablesOf(parse('2*pi*r'), true), ['pi', 'r'])
})

test('the functions an expression calls are reported', () => {
  assert.deepEqual(functionsOf(parse('sin(x) + cos(sqrt(x))')).sort(), ['cos', 'sin', 'sqrt'])
})

test('depth and size measure the tree, for the guards that use them', () => {
  assert.equal(depthOf(parse('1')), 1)
  assert.equal(sizeOf(parse('1 + 2')), 3)
  assert.ok(depthOf(parse('1 + 2 * 3 ^ 4')) > 2)
})

// ---------------------------------------------------------------- substitution and simplification

test('substitution replaces a symbol everywhere and leaves an expression', () => {
  const after = substitute(parse('x^2 + x'), 'x', parse('y + 1'))
  assert.equal(value(expressionToText(after), { y: 2 }), 12)
  // And substituting a number leaves an expression that happens to be constant.
  assert.equal(value(expressionToText(substitute(parse('x^2'), 'x', parse('3')))), 9)
})

test('simplification removes what does not matter', () => {
  const shows = (input: string, expected: string): void =>
    assert.equal(expressionToText(simplify(parse(input))), expected, input)
  shows('x + 0', 'x')
  shows('0 + x', 'x')
  shows('x * 1', 'x')
  shows('1 * x', 'x')
  shows('x * 0', '0')
  shows('x / 1', 'x')
  shows('x ^ 1', 'x')
  shows('x ^ 0', '1')
  shows('x - x', '0')
  shows('x / x', '1')
  shows('--x', 'x')
  shows('2 + 3', '5')
  shows('2 * 3 * x', '6 * x')
})

test('simplification never changes what an expression means', () => {
  // sqrt(x^2) is |x|, not x. A simplifier that "tidies" it has changed the answer for every negative x.
  const tidied = simplify(parse('sqrt(x^2)'))
  assert.equal(value(expressionToText(tidied), { x: -3 }), 3)
  assert.notEqual(expressionToText(tidied), 'x')
})

test('simplification runs to a fixed point', () => {
  // One rule firing exposes another: the inner product folds, then the outer identity applies.
  assert.equal(expressionToText(simplify(parse('(x * 1) + (0 * y)'))), 'x')
  assert.equal(expressionToText(simplify(parse('((x + 0) * 1) ^ 1'))), 'x')
})

// ---------------------------------------------------------------- differentiation

test('the ordinary rules of differentiation hold', () => {
  const derivativeOf = (input: string, variable = 'x'): string => {
    const result = differentiate(parse(input), variable)
    assert.equal('error' in result, false, `${input} would not differentiate: ${JSON.stringify(result)}`)
    return expressionToText(result as Expression)
  }
  assert.equal(derivativeOf('5'), '0')
  assert.equal(derivativeOf('x'), '1')
  assert.equal(derivativeOf('y'), '0', 'with respect to x, y is a constant')
  assert.equal(derivativeOf('x^2'), '2 * x')
  assert.equal(derivativeOf('3x'), '3')
  assert.equal(derivativeOf('x^3'), '3 * x^2')
})

test('a derivative is checked against the function it came from', () => {
  // The honest test: compare the symbolic derivative with a numerical one at several points. A wrong rule shows up here
  // even when the expression it produces looks plausible.
  const cases = ['x^2', 'x^3 + 2x', 'sin(x)', 'cos(x)', 'exp(x)', 'ln(x)', 'sqrt(x)', 'sin(x^2)', 'x*sin(x)', 'sin(x)/x', 'tanh(x)', 'atan(x)', '2^x', 'x^x']
  for (const input of cases) {
    const tree = parse(input)
    const derivative = differentiate(tree, 'x')
    assert.equal('error' in derivative, false, `${input} would not differentiate`)
    for (const at of [0.35, 0.8, 1.4, 2.2]) {
      const step = 1e-6
      const up = evaluateExpression(tree, { x: at + step })
      const down = evaluateExpression(tree, { x: at - step })
      const exact = evaluateExpression(derivative as Expression, { x: at })
      if (isEvaluateError(up) || isEvaluateError(down) || isEvaluateError(exact)) continue
      const numerical = (up - down) / (2 * step)
      assert.ok(
        Math.abs(numerical - exact) <= Math.max(1e-4, Math.abs(numerical) * 1e-4),
        `d/dx ${input} at ${at}: symbolic ${exact}, numerical ${numerical}`
      )
    }
  }
})

test('a function with no derivative rule is refused by name, not approximated', () => {
  const refused = differentiate(parse('floor(x)'), 'x')
  assert.equal('error' in refused, true)
  assert.equal((refused as { what: string }).what, 'floor')
  // abs is the same case: it has no derivative at zero, and pretending otherwise is the bug.
  assert.equal('error' in differentiate(parse('abs(x)'), 'x'), true)
})

// ---------------------------------------------------------------- writing back out

test('an expression written out and parsed again is the same expression', () => {
  const cases = [
    '1 + 2 * 3',
    '(1 + 2) * 3',
    'x^2 + 3 * x + 2',
    '10 - 3 - 2',
    '10 - (3 - 2)',
    '2^3^2',
    '(2^3)^2',
    '-x^2',
    '(-x)^2',
    'sin(x) / cos(x)',
    'a / (b * c)',
    'a / b * c',
    'min(1, 2, 3)',
    'sqrt(x^2 + y^2)',
    '-5',
    '2 * (-1)'
  ]
  for (const input of cases) {
    const first = simplify(parse(input))
    const again = simplify(parse(expressionToText(first)))
    assert.ok(
      sameExpression(first, again),
      `"${input}" became "${expressionToText(first)}" which parsed back differently ("${expressionToText(again)}")`
    )
  }
})

test('brackets appear where they are needed and nowhere else', () => {
  // Parsing alone does not reorder anything; moving the number to the left is a simplification.
  assert.equal(expressionToText(parse('(x + 1) * 2')), '(x + 1) * 2')
  assert.equal(expressionToText(simplify(parse('(x + 1) * 2'))), '2 * (x + 1)')
  assert.equal(expressionToText(parse('x + 1 * 2')), 'x + 1 * 2')
  assert.equal(expressionToText(parse('a - (b - c)')), 'a - (b - c)')
  assert.equal(expressionToText(parse('x^2')), 'x^2')
})

test('an expression describes itself for a label', () => {
  assert.equal(describeExpression(parse('2 + 2')), 'a constant')
  assert.equal(describeExpression(parse('x^2')), 'a function of x')
  assert.equal(describeExpression(parse('x + y')), 'a function of x and y')
  assert.equal(describeExpression(parse('a + b + c')), 'a function of a, b and c')
})

test('a name that Object.prototype answers for is not a function or a constant', () => {
  // `FUNCTIONS['constructor']` on a plain object returns the Object constructor, which is truthy. A guard written as
  // `if (!FUNCTIONS[name])` would let this through and then work with a function where a definition belongs.
  for (const name of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__']) {
    const parsed = parseExpression(`${name}(1)`)
    assert.equal(isParseError(parsed), true, `${name} should not be a function`)
    assert.equal((parsed as { error: string }).error, 'unknown-function', name)
  }
  // And as a bare symbol it is an unknown, not a value inherited from the prototype.
  for (const name of ['constructor', 'toString', 'valueOf']) {
    const result = evaluate(name)
    assert.equal(isEvaluateError(result), true, name)
    assert.equal((result as { error: string }).error, 'unknown-symbol', name)
  }
  // A scope may legitimately supply one, and then it is just a variable.
  assert.equal(evaluate('constructor + 1', { constructor: 4 }), 5)
})

test('a name Object.prototype answers for has no derivative either', () => {
  assert.deepEqual(variablesOf(parse('constructor')), ['constructor'])
  const refused = differentiate(parse('toString'), 'x')
  // It is a plain symbol, so its derivative with respect to x is zero -- not an inherited function being differentiated.
  assert.equal('error' in refused, false)
  assert.equal(expressionToText(refused as Expression), '0')
})
