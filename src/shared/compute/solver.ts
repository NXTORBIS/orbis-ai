/**
 * Equations, systems, and the solvers that answer them.
 *
 * An equation is not a sum. `x^2 + 3x + 2 = 0` has no value; it has *solutions*, and finding them means recognising what
 * kind of problem it is before choosing how to attack it. So this file classifies first and solves second: a linear
 * equation is rearranged exactly, a quadratic goes through the discriminant, a higher polynomial is bracketed and
 * refined numerically, and anything else is scanned for sign changes over a range.
 *
 * ## Every answer is substituted back
 *
 * The rule the whole file is organised around. A solver that returns a number it has not checked is a solver that will
 * one day return a wrong number confidently, and the two are indistinguishable from outside. So every root here is put
 * back into the original equation, the residual is measured, and the result says which of these it is:
 *
 * ```
 * exact        -- the algebra is closed-form and the residual is zero or at floating-point noise
 * verified     -- the residual is inside tolerance
 * approximate  -- a root was found but the residual is larger than it should be
 * unverified   -- no check was possible
 * ```
 *
 * `solutions` is never populated without a matching entry in `residuals`. A caller that wants to trust a number can look
 * at the one that says how far off it is.
 *
 * Builds on `expression.ts` for the tree and `units.ts` is deliberately not involved: a unit-aware equation is a Page's
 * job to assemble, and mixing the two here would make both harder to test.
 */

import {
  binary,
  differentiate,
  evaluateExpression,
  expressionToText,
  isEvaluateError,
  isParseError,
  num,
  parseExpression,
  simplify,
  substitute,
  variablesOf,
  type Expression,
  type ParseError
} from './expression.ts'

// ---------------------------------------------------------------- equations

export interface Equation {
  left: Expression
  right: Expression
}

/** An equation as text. `=` splits it; anything without one is treated as `expression = 0`. */
export function parseEquation(input: string): Equation | ParseError {
  const text = String(input ?? '')
  const parts = text.split('=')
  if (parts.length > 2) {
    return { error: 'syntax', message: 'An equation has one equals sign, not several.', at: text.indexOf('=', text.indexOf('=') + 1) }
  }
  const left = parseExpression(parts[0])
  if (isParseError(left)) return left
  if (parts.length === 1) return { left, right: num(0) }
  const right = parseExpression(parts[1])
  if (isParseError(right)) return right
  return { left, right }
}

/** The equation rearranged so one side is zero. Every solver here works on this form. */
export const asZeroForm = (equation: Equation): Expression => simplify(binary('-', equation.left, equation.right))

export const equationToText = (equation: Equation): string =>
  `${expressionToText(equation.left)} = ${expressionToText(equation.right)}`

/** Which symbols the equation contains, so a caller can tell an unknown from a parameter. */
export const unknownsOf = (equation: Equation): string[] => {
  const found = variablesOf(equation.left)
  for (const name of variablesOf(equation.right)) if (!found.includes(name)) found.push(name)
  return found
}

// ---------------------------------------------------------------- polynomial coefficients

/** The largest polynomial degree this file will work with. Past it, the numerics are not worth the claim. */
export const MAX_DEGREE = 24

/**
 * The coefficients of a polynomial in one variable, lowest power first, or null when it is not one.
 *
 * Structural rather than sampled: `(x+1)^3` is expanded by convolution, so the answer is exact rather than fitted. Null
 * is a real answer -- `sin(x) = 0` is not a polynomial and must go to a different solver, not be approximated as one.
 *
 * `parameters` supplies values for symbols that are not the unknown, so `a*x^2 + b` can be handled once `a` and `b` are
 * known. A symbol with no value makes the whole thing non-polynomial, which is correct: nothing can be said about its
 * degree yet.
 */
export function polynomialCoefficients(
  node: Expression,
  variable: string,
  parameters: Record<string, number> = {}
): number[] | null {
  const trim = (coefficients: number[]): number[] => {
    const out = [...coefficients]
    while (out.length > 1 && out[out.length - 1] === 0) out.pop()
    return out
  }

  const walk = (current: Expression): number[] | null => {
    switch (current.kind) {
      case 'number':
        return [current.value]
      case 'symbol': {
        if (current.name === variable) return [0, 1]
        const value = evaluateExpression(current, parameters)
        return isEvaluateError(value) ? null : [value]
      }
      case 'unary': {
        const operand = walk(current.operand)
        if (!operand) return null
        return current.op === '-' ? operand.map((c) => -c) : operand
      }
      case 'binary': {
        const left = walk(current.left)
        if (!left) return null
        const right = walk(current.right)
        if (!right) return null
        switch (current.op) {
          case '+':
          case '-': {
            const sign = current.op === '+' ? 1 : -1
            const out = new Array(Math.max(left.length, right.length)).fill(0) as number[]
            for (let i = 0; i < out.length; i++) out[i] = (left[i] ?? 0) + sign * (right[i] ?? 0)
            return trim(out)
          }
          case '*': {
            if (left.length + right.length - 2 > MAX_DEGREE) return null
            const out = new Array(left.length + right.length - 1).fill(0) as number[]
            for (let i = 0; i < left.length; i++) {
              for (let j = 0; j < right.length; j++) out[i + j] += left[i] * right[j]
            }
            return trim(out)
          }
          case '/': {
            // Only by a constant. Dividing by something containing the unknown makes it a rational equation, which is a
            // different problem with different excluded values, and pretending otherwise loses them.
            if (right.length !== 1) return null
            if (right[0] === 0) return null
            return trim(left.map((c) => c / right[0]))
          }
          case '^': {
            if (right.length !== 1) return null
            const exponent = right[0]
            if (!Number.isInteger(exponent) || exponent < 0) return null
            if ((left.length - 1) * exponent > MAX_DEGREE) return null
            let out = [1]
            for (let n = 0; n < exponent; n++) {
              const next = new Array(out.length + left.length - 1).fill(0) as number[]
              for (let i = 0; i < out.length; i++) for (let j = 0; j < left.length; j++) next[i + j] += out[i] * left[j]
              out = next
            }
            return trim(out)
          }
          case '%':
            return null
        }
      }
      // eslint-disable-next-line no-fallthrough
      case 'call': {
        // A call on something that does not contain the unknown is a constant. `sin(2)` is a number; `sin(x)` is not.
        const value = evaluateExpression(current, parameters)
        return isEvaluateError(value) ? null : [value]
      }
    }
  }

  const result = walk(node)
  return result ? trim(result) : null
}

/** A polynomial's value at a point, by Horner's method -- fewer operations and less rounding than powers. */
export function polynomialAt(coefficients: number[], x: number): number {
  let total = 0
  for (let i = coefficients.length - 1; i >= 0; i--) total = total * x + coefficients[i]
  return total
}

/** The derivative of a polynomial, as coefficients. */
export const polynomialDerivative = (coefficients: number[]): number[] =>
  coefficients.length <= 1 ? [0] : coefficients.slice(1).map((c, i) => c * (i + 1))

/**
 * A bound every real root lies inside, by Cauchy's rule.
 *
 * Gives the scan somewhere definite to look instead of a guessed range, which is the difference between finding every
 * real root and finding the ones that happened to be near zero.
 */
export function rootBound(coefficients: number[]): number {
  const degree = coefficients.length - 1
  if (degree < 1) return 1
  const leading = coefficients[degree]
  if (leading === 0) return 1
  let biggest = 0
  for (let i = 0; i < degree; i++) biggest = Math.max(biggest, Math.abs(coefficients[i] / leading))
  return 1 + biggest
}

// ---------------------------------------------------------------- classification

export type ProblemKind =
  | 'identity'
  | 'contradiction'
  | 'linear'
  | 'quadratic'
  | 'polynomial'
  | 'transcendental'
  | 'underdetermined'

export interface Classification {
  kind: ProblemKind
  /** The polynomial degree when it is one. Null otherwise. */
  degree: number | null
  /** Symbols other than the unknown that still have no value. */
  parameters: string[]
  describe: string
}

/** What kind of problem this is, which decides which solver runs. */
export function classify(equation: Equation, variable: string, parameters: Record<string, number> = {}): Classification {
  const zero = asZeroForm(equation)
  const free = variablesOf(zero).filter((name) => name !== variable && !(name in parameters))

  const coefficients = polynomialCoefficients(zero, variable, parameters)
  if (!coefficients) {
    if (free.length > 0) {
      return {
        kind: 'underdetermined',
        degree: null,
        parameters: free,
        describe: `${free.join(', ')} ${free.length === 1 ? 'has' : 'have'} no value, so this cannot be solved for ${variable} yet.`
      }
    }
    return { kind: 'transcendental', degree: null, parameters: [], describe: `not a polynomial in ${variable}` }
  }

  const degree = coefficients.length - 1
  if (degree === 0) {
    // No unknown left. Either the equation is always true or it is never true, and those are different answers.
    return coefficients[0] === 0
      ? { kind: 'identity', degree: 0, parameters: free, describe: 'true for every value' }
      : { kind: 'contradiction', degree: 0, parameters: free, describe: 'true for no value' }
  }
  if (degree === 1) return { kind: 'linear', degree, parameters: free, describe: `linear in ${variable}` }
  if (degree === 2) return { kind: 'quadratic', degree, parameters: free, describe: `quadratic in ${variable}` }
  return { kind: 'polynomial', degree, parameters: free, describe: `a degree ${degree} polynomial in ${variable}` }
}

// ---------------------------------------------------------------- results

export type SolutionConfidence = 'exact' | 'verified' | 'approximate' | 'unverified'

export interface Solution {
  value: number
  /** Where it came from: closed-form algebra or a numerical search. */
  method: 'algebraic' | 'numerical'
  /** How far the original equation is from balancing at this value. Smaller is better; zero is exact. */
  residual: number
  confidence: SolutionConfidence
  /** How many times the root repeats, when the method knows. */
  multiplicity?: number
}

/** A root that is not a real number. Reported rather than dropped, because "no solution" would be untrue. */
export interface ComplexSolution {
  real: number
  imaginary: number
}

export type SolveStatus =
  | 'solved'
  | 'no-real-solution'
  | 'identity'
  | 'contradiction'
  | 'underdetermined'
  | 'unsupported'
  | 'not-converged'

export interface SolveResult {
  status: SolveStatus
  variable: string
  kind: ProblemKind
  solutions: Solution[]
  /** Complex roots, for the quadratics and polynomials that have them. */
  complex: ComplexSolution[]
  /** The method actually used, named so a result can be reproduced. */
  method: string
  /** Things true about the answer that a caller should not have to work out. */
  notes: string[]
  message: string
  /** The equation as solved, after rearranging. Useful for showing work. */
  zeroForm: string
}

/** How close to balanced counts as balanced. Relative, because an equation in millions cannot be judged absolutely. */
export const TOLERANCE = 1e-9

/**
 * How fast the equation's two sides are pulling apart near a value, measured numerically.
 *
 * A central difference on `left - right`. Null when either neighbouring point is outside the domain, which is a real
 * answer: nothing can be said about the slope at the edge of where the equation exists.
 */
function gradientAt(equation: Equation, variable: string, value: number, parameters: Record<string, number>): number | null {
  const step = Math.max(1e-8, Math.abs(value) * 1e-8)
  const at = (x: number): number | null => {
    const scope = { ...parameters, [variable]: x }
    const left = evaluateExpression(equation.left, scope)
    const right = evaluateExpression(equation.right, scope)
    if (isEvaluateError(left) || isEvaluateError(right)) return null
    return left - right
  }
  const up = at(value + step)
  const down = at(value - step)
  if (up === null || down === null) return null
  return (up - down) / (2 * step)
}

/**
 * How far the original equation is from balancing at a value, and what that means.
 *
 * Relative to the size of the terms involved: a residual of 1e-6 is noise in an equation whose sides are around 1e12 and
 * a real error in one whose sides are around 1. Judging it absolutely is how a solver comes to call a wrong answer
 * verified.
 */
export function checkSolution(equation: Equation, variable: string, value: number, parameters: Record<string, number> = {}): {
  residual: number
  confidence: SolutionConfidence
} {
  const scope = { ...parameters, [variable]: value }
  const left = evaluateExpression(equation.left, scope)
  const right = evaluateExpression(equation.right, scope)
  if (isEvaluateError(left) || isEvaluateError(right)) {
    // The value is outside the equation's domain -- a root of the rearranged form that the original cannot accept. This
    // is how extraneous solutions are caught.
    return { residual: Number.POSITIVE_INFINITY, confidence: 'unverified' }
  }
  const residual = Math.abs(left - right)
  if (residual === 0) return { residual, confidence: 'exact' }

  // Judged by backward error rather than by the residual alone.
  //
  // `x^2 - 1e8 x + 1 = 0` has a root at 1e8. The two sides there are about 1 and 0, so a residual of 1 looks enormous --
  // but the terms being subtracted are about 1e16, and 1 is the last bit of a double at that size. Comparing the residual
  // to the totals would throw away a perfectly good root; comparing it to how fast the equation is changing does not.
  //
  // The gradient is measured rather than derived, so this works for an equation of any shape. Where the gradient vanishes
  // -- a repeated root -- the term magnitudes carry the scale instead.
  const gradient = gradientAt(equation, variable, value, parameters)
  const slopeScale = gradient === null ? 0 : Math.abs(gradient) * Math.max(1, Math.abs(value))
  const scale = Math.max(1, Math.abs(left), Math.abs(right), slopeScale)

  if (residual <= scale * TOLERANCE) return { residual, confidence: 'verified' }
  if (residual <= scale * 1e-5) return { residual, confidence: 'approximate' }
  return { residual, confidence: 'unverified' }
}

// ---------------------------------------------------------------- numerical root finding

/** A root of `f` inside a bracket, by bisection then Newton polish. Null when the bracket does not contain a sign change. */
function bracketedRoot(f: (x: number) => number | null, low: number, high: number, iterations = 200): number | null {
  let a = low
  let b = high
  let fa = f(a)
  let fb = f(b)
  if (fa === null || fb === null) return null
  if (fa === 0) return a
  if (fb === 0) return b
  if (fa > 0 === fb > 0) return null
  for (let i = 0; i < iterations; i++) {
    const middle = (a + b) / 2
    const fm = f(middle)
    if (fm === null) return null
    if (fm === 0) return middle
    if (Math.abs(b - a) <= Math.max(Math.abs(middle), 1) * 1e-15) return middle
    if (fa > 0 === fm > 0) {
      a = middle
      fa = fm
    } else {
      b = middle
      fb = fm
    }
  }
  return (a + b) / 2
}

/**
 * Every real root of a polynomial, found by scanning its own root bound.
 *
 * Sign changes give brackets and bisection refines them, so each root comes with a residual rather than a promise. A
 * repeated root of even multiplicity produces no sign change, so those are looked for separately at the roots of the
 * derivative -- which is where they have to be.
 */
export function realPolynomialRoots(coefficients: number[]): { roots: number[]; notes: string[] } {
  const notes: string[] = []
  const degree = coefficients.length - 1
  if (degree < 1) return { roots: [], notes }

  const f = (x: number): number => polynomialAt(coefficients, x)
  const bound = rootBound(coefficients)
  // Enough samples that two roots inside the bound are very unlikely to share a cell, and bounded so a degree-24
  // polynomial does not become a million evaluations.
  const samples = Math.min(20000, Math.max(2000, degree * 400))
  const step = (2 * bound) / samples

  const roots: number[] = []
  const remember = (candidate: number): void => {
    // Roots closer together than this are the same root found twice.
    const tolerance = Math.max(1e-10, Math.abs(candidate) * 1e-10)
    if (!roots.some((existing) => Math.abs(existing - candidate) <= tolerance)) roots.push(candidate)
  }

  let previousX = -bound
  let previousY = f(previousX)
  if (previousY === 0) remember(previousX)
  for (let i = 1; i <= samples; i++) {
    const x = -bound + i * step
    const y = f(x)
    if (y === 0) remember(x)
    else if (previousY !== 0 && previousY > 0 !== y > 0) {
      const root = bracketedRoot((at) => f(at), previousX, x)
      if (root !== null) remember(root)
    }
    previousX = x
    previousY = y
  }

  // Even-multiplicity roots touch the axis without crossing it. They are stationary points, so they are roots of the
  // derivative too -- which is where to look for them.
  if (degree >= 2) {
    const derivative = polynomialDerivative(coefficients)
    const stationary = degree === 2 ? [-coefficients[1] / (2 * coefficients[2])] : realPolynomialRoots(derivative).roots
    for (const at of stationary) {
      if (!Number.isFinite(at)) continue
      const y = f(at)
      const scale = Math.max(1, ...coefficients.map(Math.abs))
      if (Math.abs(y) <= scale * 1e-9) remember(at)
    }
  }

  roots.sort((a, b) => a - b)
  if (roots.length < degree) {
    notes.push(
      `A degree ${degree} polynomial has ${degree} roots counted with multiplicity; ${roots.length} of them ${
        roots.length === 1 ? 'is' : 'are'
      } real.`
    )
  }
  return { roots, notes }
}

// ---------------------------------------------------------------- solving one equation

export interface SolveOptions {
  /** Values for symbols that are not the unknown. */
  parameters?: Record<string, number>
  /** Where to look, for an equation that is not a polynomial. Defaults to a range around zero. */
  searchFrom?: number
  searchTo?: number
  /** How many points to sample when scanning. More finds closer roots and costs more. */
  samples?: number
}

/**
 * An equation solved for one unknown.
 *
 * Chooses its own method from the classification, and every root it returns has been substituted back into the original
 * equation. A root of the rearranged form that the original cannot accept -- the classic extraneous solution from
 * squaring both sides, or a value that makes a denominator zero -- is dropped, and a note says so.
 */
export function solveFor(equation: Equation, variable: string, options: SolveOptions = {}): SolveResult {
  const parameters = options.parameters ?? {}
  const classification = classify(equation, variable, parameters)
  const zero = asZeroForm(equation)
  const base: Omit<SolveResult, 'status' | 'solutions' | 'complex' | 'method' | 'message'> = {
    variable,
    kind: classification.kind,
    notes: [],
    zeroForm: `${expressionToText(zero)} = 0`
  }

  /** Substitutes every candidate back, keeps the ones the original equation accepts, and records how far off each is. */
  const verify = (candidates: number[], method: Solution['method'], multiplicities?: Map<number, number>): { kept: Solution[]; dropped: number } => {
    const kept: Solution[] = []
    let dropped = 0
    for (const candidate of candidates) {
      if (!Number.isFinite(candidate)) {
        dropped += 1
        continue
      }
      const { residual, confidence } = checkSolution(equation, variable, candidate, parameters)
      if (confidence === 'unverified') {
        // Found in the rearranged form, rejected by the original. That is what an extraneous root is.
        dropped += 1
        continue
      }
      const multiplicity = multiplicities?.get(candidate)
      kept.push({ value: candidate, method, residual, confidence, ...(multiplicity ? { multiplicity } : {}) })
    }
    return { kept, dropped }
  }

  switch (classification.kind) {
    case 'identity':
      return {
        ...base,
        status: 'identity',
        solutions: [],
        complex: [],
        method: 'algebraic',
        message: `Every value of ${variable} satisfies this equation.`
      }

    case 'contradiction':
      return {
        ...base,
        status: 'contradiction',
        solutions: [],
        complex: [],
        method: 'algebraic',
        message: `No value of ${variable} satisfies this equation.`
      }

    case 'underdetermined':
      return {
        ...base,
        status: 'underdetermined',
        solutions: [],
        complex: [],
        method: 'none',
        notes: [classification.describe],
        message: `${classification.parameters.join(', ')} ${
          classification.parameters.length === 1 ? 'needs' : 'need'
        } a value before this can be solved for ${variable}.`
      }

    case 'linear': {
      const [a0, a1] = polynomialCoefficients(zero, variable, parameters) as number[]
      const root = -a0 / a1
      const { kept, dropped } = verify([root], 'algebraic')
      const notes = dropped > 0 ? ['The value found does not satisfy the original equation.'] : []
      return {
        ...base,
        status: kept.length > 0 ? 'solved' : 'no-real-solution',
        solutions: kept,
        complex: [],
        method: 'rearrangement',
        notes,
        message: kept.length > 0 ? `${variable} = ${kept[0].value}` : `No value of ${variable} satisfies this equation.`
      }
    }

    case 'quadratic': {
      const [c, b, a] = polynomialCoefficients(zero, variable, parameters) as number[]
      const discriminant = b * b - 4 * a * c
      if (discriminant < 0) {
        const real = -b / (2 * a)
        const imaginary = Math.sqrt(-discriminant) / (2 * a)
        return {
          ...base,
          status: 'no-real-solution',
          solutions: [],
          complex: [
            { real, imaginary: Math.abs(imaginary) },
            { real, imaginary: -Math.abs(imaginary) }
          ],
          method: 'discriminant',
          notes: [`The discriminant is ${discriminant}, which is negative, so both roots are complex.`],
          message: `${variable} has no real value here; the two complex roots are reported.`
        }
      }
      if (discriminant === 0) {
        const root = -b / (2 * a)
        const { kept } = verify([root], 'algebraic', new Map([[root, 2]]))
        return {
          ...base,
          status: kept.length > 0 ? 'solved' : 'no-real-solution',
          solutions: kept,
          complex: [],
          method: 'discriminant',
          notes: ['The discriminant is zero, so the two roots coincide.'],
          message: kept.length > 0 ? `${variable} = ${kept[0].value}, twice` : `No value of ${variable} satisfies this equation.`
        }
      }
      // The numerically stable pair: computing both roots from the same subtraction loses precision when b^2 dominates
      // 4ac, so one root comes from the formula and the other from the product of the roots.
      const root = -b - Math.sign(b || 1) * Math.sqrt(discriminant)
      const first = root / (2 * a)
      const second = (2 * c) / root
      const { kept, dropped } = verify([first, second].sort((x, y) => x - y), 'algebraic')
      return {
        ...base,
        status: kept.length > 0 ? 'solved' : 'no-real-solution',
        solutions: kept,
        complex: [],
        method: 'discriminant',
        notes: dropped > 0 ? [`${dropped} root of the rearranged equation does not satisfy the original.`] : [],
        message: kept.map((one) => `${variable} = ${one.value}`).join(', ') || `No value of ${variable} satisfies this equation.`
      }
    }

    case 'polynomial': {
      const coefficients = polynomialCoefficients(zero, variable, parameters) as number[]
      const { roots, notes } = realPolynomialRoots(coefficients)
      const { kept, dropped } = verify(roots, 'numerical')
      if (dropped > 0) notes.push(`${dropped} root of the rearranged equation does not satisfy the original.`)
      return {
        ...base,
        status: kept.length > 0 ? 'solved' : 'no-real-solution',
        solutions: kept,
        complex: [],
        method: 'bracketed bisection over the Cauchy root bound',
        notes,
        message:
          kept.length > 0
            ? kept.map((one) => `${variable} ≈ ${Number(one.value.toPrecision(12))}`).join(', ')
            : `This polynomial has no real root.`
      }
    }

    case 'transcendental': {
      // No structure to exploit, so scan. The range is part of the answer: a root outside it was not looked for, and
      // saying "no solution" without saying where would be a lie.
      const from = options.searchFrom ?? -100
      const to = options.searchTo ?? 100
      const samples = Math.min(200000, Math.max(1000, options.samples ?? 20000))
      const f = (x: number): number | null => {
        const value = evaluateExpression(zero, { ...parameters, [variable]: x })
        return isEvaluateError(value) ? null : value
      }
      const step = (to - from) / samples
      const found: number[] = []
      const remember = (candidate: number): void => {
        const tolerance = Math.max(1e-9, Math.abs(candidate) * 1e-9)
        if (!found.some((existing) => Math.abs(existing - candidate) <= tolerance)) found.push(candidate)
      }
      let previousX = from
      let previousY = f(previousX)
      if (previousY === 0) remember(previousX)
      for (let i = 1; i <= samples; i++) {
        const x = from + i * step
        const y = f(x)
        if (y === null) {
          previousX = x
          previousY = null
          continue
        }
        if (y === 0) remember(x)
        else if (previousY !== null && previousY !== 0 && previousY > 0 !== y > 0) {
          const root = bracketedRoot(f, previousX, x)
          if (root !== null) remember(root)
        }
        previousX = x
        previousY = y
      }
      found.sort((a, b) => a - b)
      const { kept } = verify(found, 'numerical')
      const where = `Searched ${from} to ${to} at ${samples} points.`
      return {
        ...base,
        status: kept.length > 0 ? 'solved' : 'no-real-solution',
        solutions: kept,
        complex: [],
        method: 'sign-change scan with bisection',
        notes: [
          where,
          'A root outside that range, or closer together than the sampling, was not looked for.'
        ],
        message:
          kept.length > 0
            ? kept.map((one) => `${variable} ≈ ${Number(one.value.toPrecision(12))}`).join(', ')
            : `No root was found between ${from} and ${to}.`
      }
    }
  }
}

/** Parse and solve in one step, for the common case. */
export function solve(input: string, variable?: string, options: SolveOptions = {}): SolveResult | ParseError {
  const equation = parseEquation(input)
  if ('error' in equation) return equation
  const unknowns = unknownsOf(equation).filter((name) => !(name in (options.parameters ?? {})))
  const target = variable ?? unknowns[0]
  if (!target) {
    return {
      status: classify(equation, 'x', options.parameters).kind === 'identity' ? 'identity' : 'contradiction',
      variable: '',
      kind: classify(equation, 'x', options.parameters).kind,
      solutions: [],
      complex: [],
      method: 'algebraic',
      notes: ['There is no unknown in this equation, so it is either true or false as written.'],
      message: classify(equation, 'x', options.parameters).kind === 'identity' ? 'This is true.' : 'This is not true.',
      zeroForm: `${expressionToText(asZeroForm(equation))} = 0`
    }
  }
  return solveFor(equation, target, options)
}

// ---------------------------------------------------------------- rearranging

/**
 * An equation rearranged to make one symbol the subject, where that can be done exactly.
 *
 * Only for the linear case, which is the one where an exact rearrangement always exists: `F = ma` becomes `a = F/m`.
 * Returns null for anything else rather than producing an expression that is only sometimes right -- `x^2 = a` has two
 * solutions and `x = sqrt(a)` is one of them, which is exactly the kind of quiet halving this refuses to do.
 */
export function rearrangeFor(equation: Equation, variable: string): { subject: string; expression: Expression; conditions: string[] } | null {
  const zero = asZeroForm(equation)
  // Coefficients with the other symbols left symbolic is not something the numeric extractor can do, so this works on
  // the shape instead: collect the terms with the variable and the terms without.
  const withVariable: Expression[] = []
  const without: Expression[] = []
  const collect = (node: Expression, sign: 1 | -1): boolean => {
    if (node.kind === 'binary' && (node.op === '+' || node.op === '-')) {
      return collect(node.left, sign) && collect(node.right, node.op === '+' ? sign : (-sign as 1 | -1))
    }
    if (node.kind === 'unary' && node.op === '-') return collect(node.operand, -sign as 1 | -1)
    const term = sign === 1 ? node : simplify({ kind: 'unary', op: '-', operand: node })
    if (variablesOf(node).includes(variable)) {
      // The term must be linear in the variable for this to be exact.
      const coefficients = countVariable(node, variable)
      if (coefficients !== 1) return false
      withVariable.push(term)
    } else {
      without.push(term)
    }
    return true
  }
  if (!collect(zero, 1)) return null
  if (withVariable.length !== 1) return null

  // The single term containing the variable, divided out.
  const term = withVariable[0]
  const coefficient = divideOutVariable(term, variable)
  if (!coefficient) return null
  const constant = without.reduce<Expression | null>((total, one) => (total === null ? one : binary('+', total, one)), null) ?? num(0)
  const expression = simplify(binary('/', simplify({ kind: 'unary', op: '-', operand: constant }), coefficient))
  // The condition is about the divisor, and a leading minus sign on it changes nothing about being zero.
  const divisor = coefficient.kind === 'unary' && coefficient.op === '-' ? coefficient.operand : coefficient
  const conditions = variablesOf(divisor).length > 0 ? [`${expressionToText(divisor)} must not be zero.`] : []
  return { subject: variable, expression, conditions }
}

/** How many times the variable appears as a factor in a product term. 1 means linear; anything else is not rearrangeable. */
function countVariable(node: Expression, variable: string): number {
  switch (node.kind) {
    case 'symbol':
      return node.name === variable ? 1 : 0
    case 'number':
      return 0
    case 'unary':
      return countVariable(node.operand, variable)
    case 'binary':
      if (node.op === '*') return countVariable(node.left, variable) + countVariable(node.right, variable)
      if (node.op === '/') {
        // In a denominator it is not linear in the sense this needs.
        return countVariable(node.left, variable) + (variablesOf(node.right).includes(variable) ? 2 : 0)
      }
      if (node.op === '^') return variablesOf(node.left).includes(variable) ? 2 : 0
      return variablesOf(node).includes(variable) ? 2 : 0
    case 'call':
      return variablesOf(node).includes(variable) ? 2 : 0
  }
}

/** A product term with the variable removed, leaving its coefficient. Null when the shape is not a simple product. */
function divideOutVariable(node: Expression, variable: string): Expression | null {
  if (node.kind === 'symbol' && node.name === variable) return num(1)
  if (node.kind === 'unary' && node.op === '-') {
    const inner = divideOutVariable(node.operand, variable)
    return inner ? simplify({ kind: 'unary', op: '-', operand: inner }) : null
  }
  if (node.kind === 'binary' && node.op === '*') {
    if (variablesOf(node.left).includes(variable)) {
      const left = divideOutVariable(node.left, variable)
      return left ? simplify(binary('*', left, node.right)) : null
    }
    const right = divideOutVariable(node.right, variable)
    return right ? simplify(binary('*', node.left, right)) : null
  }
  if (node.kind === 'binary' && node.op === '/' && !variablesOf(node.right).includes(variable)) {
    const left = divideOutVariable(node.left, variable)
    return left ? simplify(binary('/', left, node.right)) : null
  }
  return null
}

// ---------------------------------------------------------------- linear systems

export interface SystemResult {
  status: 'unique' | 'none' | 'infinite' | 'invalid'
  /** The value of each unknown, in the order given. Empty unless the status is unique. */
  values: Record<string, number>
  /** How far each equation is from balancing at the answer. */
  residuals: number[]
  /** The largest residual, which is the one worth judging the answer by. */
  worstResidual: number
  confidence: SolutionConfidence
  /** Unknowns that can take any value, when the system does not pin them down. */
  free: string[]
  rank: number
  notes: string[]
  message: string
}

/**
 * A system of linear equations, solved by Gaussian elimination with partial pivoting.
 *
 * Partial pivoting rather than plain elimination because a small pivot destroys precision, and a system that is merely
 * awkward should not come back wrong. The result distinguishes the three real outcomes -- one solution, none, or
 * infinitely many -- rather than collapsing the last two into a failure, and names the free unknowns when there are some.
 *
 * Every equation is checked against the answer, and the worst residual is reported.
 */
export function solveLinearSystem(equations: Equation[], unknowns?: string[]): SystemResult {
  const names =
    unknowns ??
    equations.reduce<string[]>((found, equation) => {
      for (const name of unknownsOf(equation)) if (!found.includes(name)) found.push(name)
      return found
    }, [])

  const empty: SystemResult = {
    status: 'invalid',
    values: {},
    residuals: [],
    worstResidual: Number.POSITIVE_INFINITY,
    confidence: 'unverified',
    free: [],
    rank: 0,
    notes: [],
    message: ''
  }

  if (names.length === 0) return { ...empty, message: 'There are no unknowns in this system.' }
  if (equations.length === 0) return { ...empty, message: 'There are no equations in this system.' }

  // Each row is the coefficients of one equation plus the constant, extracted structurally so the answer is exact.
  const rows: number[][] = []
  for (const equation of equations) {
    const zero = asZeroForm(equation)
    const row: number[] = new Array(names.length + 1).fill(0)
    for (let i = 0; i < names.length; i++) {
      const others = Object.fromEntries(names.filter((_, j) => j !== i).map((name) => [name, 0]))
      const coefficients = polynomialCoefficients(zero, names[i], others)
      if (!coefficients || coefficients.length > 2) {
        return {
          ...empty,
          notes: [`${equationToText(equation)} is not linear in ${names[i]}.`],
          message: 'Every equation in a linear system must be linear in every unknown.'
        }
      }
      row[i] = coefficients[1] ?? 0
    }
    // The constant: everything with all unknowns set to zero, moved to the right-hand side.
    const constant = evaluateExpression(zero, Object.fromEntries(names.map((name) => [name, 0])))
    if (isEvaluateError(constant)) {
      return { ...empty, notes: [constant.message], message: 'An equation in this system could not be read.' }
    }
    row[names.length] = -constant
    rows.push(row)
  }

  // Forward elimination with partial pivoting.
  const width = names.length
  const pivotColumns: number[] = []
  let pivotRow = 0
  for (let column = 0; column < width && pivotRow < rows.length; column++) {
    let best = pivotRow
    for (let r = pivotRow + 1; r < rows.length; r++) {
      if (Math.abs(rows[r][column]) > Math.abs(rows[best][column])) best = r
    }
    const scale = Math.max(...rows.map((row) => Math.max(...row.map(Math.abs))), 1)
    if (Math.abs(rows[best][column]) <= scale * 1e-12) continue
    ;[rows[pivotRow], rows[best]] = [rows[best], rows[pivotRow]]
    const pivot = rows[pivotRow][column]
    for (let r = 0; r < rows.length; r++) {
      if (r === pivotRow) continue
      const factor = rows[r][column] / pivot
      if (factor === 0) continue
      for (let c = column; c <= width; c++) rows[r][c] -= factor * rows[pivotRow][c]
    }
    pivotColumns.push(column)
    pivotRow += 1
  }

  const rank = pivotColumns.length

  // A row of zero coefficients with a non-zero constant is `0 = something`, which nothing satisfies.
  for (const row of rows) {
    const coefficientScale = Math.max(...row.slice(0, width).map(Math.abs))
    if (coefficientScale <= 1e-12 && Math.abs(row[width]) > Math.max(1, Math.abs(row[width])) * 1e-12) {
      return {
        ...empty,
        status: 'none',
        rank,
        notes: ['Eliminating the unknowns leaves a statement that cannot be true.'],
        message: 'These equations contradict each other, so the system has no solution.'
      }
    }
  }

  const free = names.filter((_, i) => !pivotColumns.includes(i))
  if (free.length > 0) {
    return {
      ...empty,
      status: 'infinite',
      rank,
      free,
      notes: [`${rank} independent equation${rank === 1 ? '' : 's'} for ${names.length} unknowns.`],
      message: `This system does not pin down ${free.join(', ')}; any value for ${
        free.length === 1 ? 'it' : 'them'
      } gives a solution.`
    }
  }

  // Back substitution. Every pivot column has exactly one row after elimination.
  const values: Record<string, number> = {}
  for (let i = 0; i < pivotColumns.length; i++) {
    const column = pivotColumns[i]
    values[names[column]] = rows[i][width] / rows[i][column]
  }

  const residuals = equations.map((equation) => {
    const left = evaluateExpression(equation.left, values)
    const right = evaluateExpression(equation.right, values)
    if (isEvaluateError(left) || isEvaluateError(right)) return Number.POSITIVE_INFINITY
    return Math.abs(left - right)
  })
  const worstResidual = Math.max(...residuals)
  const magnitude = Math.max(1, ...Object.values(values).map(Math.abs))
  const confidence: SolutionConfidence =
    worstResidual === 0
      ? 'exact'
      : worstResidual <= magnitude * TOLERANCE
        ? 'verified'
        : worstResidual <= magnitude * 1e-5
          ? 'approximate'
          : 'unverified'

  return {
    status: 'unique',
    values,
    residuals,
    worstResidual,
    confidence,
    free: [],
    rank,
    notes: equations.length > names.length ? [`${equations.length} equations for ${names.length} unknowns, and they agree.`] : [],
    message: names.map((name) => `${name} = ${Number(values[name].toPrecision(12))}`).join(', ')
  }
}

// ---------------------------------------------------------------- showing the work

/**
 * The steps of a solution, as a Page can display them.
 *
 * Built from what the solver actually did rather than written afterwards: each step names the transformation and shows
 * the expression it produced, so a step that is wrong is visible instead of persuasive.
 */
export function solutionSteps(equation: Equation, result: SolveResult): { label: string; detail: string }[] {
  const steps: { label: string; detail: string }[] = [{ label: 'The equation', detail: equationToText(equation) }]
  steps.push({ label: 'Rearranged so one side is zero', detail: result.zeroForm })
  steps.push({ label: 'What kind of equation this is', detail: result.kind })
  steps.push({ label: 'Method', detail: result.method })
  for (const solution of result.solutions) {
    steps.push({
      label: `${result.variable} = ${Number(solution.value.toPrecision(12))}`,
      // The residual is part of the step, not a footnote: it is the evidence the answer is right.
      detail:
        solution.confidence === 'exact'
          ? 'Substituted back into the original equation: it balances exactly.'
          : `Substituted back into the original equation: off by ${solution.residual.toExponential(2)} (${solution.confidence}).`
    })
  }
  for (const one of result.complex) {
    steps.push({ label: 'A complex root', detail: `${Number(one.real.toPrecision(12))} ${one.imaginary >= 0 ? '+' : '-'} ${Math.abs(Number(one.imaginary.toPrecision(12)))}i` })
  }
  for (const note of result.notes) steps.push({ label: 'Note', detail: note })
  return steps
}

/** A derivative of one side of an equation, for a Page that wants to show a rate of change. Re-exported for convenience. */
export { differentiate, substitute }
