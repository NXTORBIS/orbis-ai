/**
 * The mathematics laboratories a Page can reach: algebra, matrices, discrete mathematics, calculus and geometry.
 *
 * Same contract as `engines.ts`, for the same reasons. A Page sends data, never code; where an engine wants a function
 * the Page sends an **expression as text** and the AST interpreter in `expression.ts` turns it into a callable. There
 * is no `eval` and no `new Function` on any path reachable from here.
 *
 * ## Whole numbers arrive as text
 *
 * Number theory works in `bigint`, and a Page cannot send one: JSON has no bigint, and a double silently loses whole
 * numbers past 2^53. So these operations take decimal *strings* and parse them here. A Page that sends 9007199254740993
 * as a number would have sent 9007199254740992 without knowing, and a primality test on the wrong number is worse than
 * a refusal.
 *
 * ## Exact and numeric are different doors
 *
 * `matrix.determinant` works in exact rationals and `matrix.eigen` works in floating point, and the split is
 * deliberate rather than an implementation detail. An operation here never quietly moves a Page from one to the other,
 * because "the determinant is 0.9999999999999998" is a different claim from "the determinant is 1".
 */

import {
  analyseSequence,
  canSimplify,
  dividePolynomials,
  derivativeOf,
  antiderivativeOf,
  equivalent,
  evaluatePolynomial,
  fromDecimal,
  isAlgebraError,
  degreeOf,
  polynomial,
  polynomialToText,
  rational,
  rationalToText,
  rootsOf,
  simplifyRadical,
  sumSeries,
  termsOf,
  toConjunctiveNormalForm,
  toDecimal,
  toDisjunctiveNormalForm,
  truthTable,
  type Domain,
  type Polynomial,
  type Proposition,
  type Rational,
  type SequenceRule
} from '../../shared/compute/algebra.ts'
import {
  cholesky,
  determinantOf,
  eigenSymmetric,
  exactMatrix,
  gramSchmidt,
  independence,
  invert,
  isMatrixError,
  leastSquares,
  luDecompose,
  matrixToText,
  numericMatrix,
  projectOnto,
  qrDecompose,
  rankOf,
  rowReduce,
  solveSystem,
  subspacesOf,
  svd,
  type ExactMatrix
} from '../../shared/compute/matrix.ts'
import {
  bellmanFord,
  breadthFirst,
  chineseRemainder,
  combinations,
  componentsOf,
  depthFirst,
  derangements,
  dijkstra,
  divisorsOf,
  enumerateCombinations,
  enumeratePermutations,
  equivalenceClasses,
  euclideanSteps,
  eulerian,
  extendedGcd,
  factorial,
  factorise,
  findCycle,
  gcd,
  graphOf,
  greedyColouring,
  inclusionExclusion,
  isBipartite,
  isDiscreteError,
  isPrime,
  kruskal,
  lcm,
  linearDiophantine,
  modInverse,
  modPower,
  multinomial,
  orderElements,
  pascalRow,
  permutations,
  pigeonhole,
  relationProperties,
  sieveOfEratosthenes,
  solveCongruence,
  starsAndBars,
  topologicalSort,
  totient,
  type Graph
} from '../../shared/compute/discrete.ts'
import {
  analyseShape,
  classifyOde,
  compile as compileReal,
  continuityAt,
  derivativeAt,
  equilibriaOf,
  findAsymptotes,
  heatEquation,
  integrateFunction,
  isCalculusError,
  limitAt,
  phasePortrait,
  taylorSeries,
  waveEquation
} from '../../shared/compute/calculus.ts'
import {
  angleAt,
  checkClaim,
  classifyConic,
  closestPair,
  compose,
  containsPoint,
  convexHull,
  circleThrough,
  delaunay,
  intersectCircles,
  intersectLineCircle,
  isGeometryError,
  lineThrough,
  polygonFacts,
  reflection,
  regularPolygon,
  relateLines,
  rotation,
  scaling,
  shear,
  solidFacts,
  tangentsFrom,
  translation,
  transformFacts,
  triangleFacts,
  verifyDelaunay,
  type Circle,
  type Claim,
  type Point2,
  type Transform2,
  type Triangle
} from '../../shared/compute/geometry.ts'
import {
  evaluateExpression,
  isEvaluateError,
  isParseError,
  parseExpression,
  sizeOf
} from '../../shared/compute/expression.ts'
import { BadInput, Reader } from './engines.ts'

/** Which capability each of these needs. Merged into the service's one map, so the same deny-by-default applies. */
export const MATH_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  'algebra.rational': 'computation.mathematics',
  'algebra.radical': 'computation.mathematics',
  'algebra.polynomial': 'computation.mathematics',
  'algebra.roots': 'computation.mathematics',
  'algebra.simplify': 'computation.mathematics',
  'algebra.sequence': 'computation.mathematics',
  'algebra.series': 'computation.mathematics',
  'algebra.logic': 'computation.mathematics',

  'matrix.reduce': 'computation.mathematics',
  'matrix.determinant': 'computation.mathematics',
  'matrix.invert': 'computation.mathematics',
  'matrix.solve': 'computation.mathematics',
  'matrix.subspaces': 'computation.mathematics',
  'matrix.independence': 'computation.mathematics',
  'matrix.factorise': 'computation.mathematics',
  'matrix.eigen': 'computation.mathematics',
  'matrix.svd': 'computation.mathematics',
  'matrix.leastsquares': 'computation.mathematics',
  'matrix.orthogonalise': 'computation.mathematics',

  'number.gcd': 'computation.mathematics',
  'number.modular': 'computation.mathematics',
  'number.congruence': 'computation.mathematics',
  'number.prime': 'computation.mathematics',
  'number.sieve': 'computation.mathematics',
  'number.factorise': 'computation.mathematics',
  'number.divisors': 'computation.mathematics',
  'number.diophantine': 'computation.mathematics',

  'combinatorics.count': 'computation.mathematics',
  'combinatorics.enumerate': 'computation.mathematics',
  'combinatorics.pascal': 'computation.mathematics',
  'combinatorics.pigeonhole': 'computation.mathematics',
  'combinatorics.inclusion': 'computation.mathematics',

  'graph.traverse': 'computation.mathematics',
  'graph.shortest': 'computation.mathematics',
  'graph.spanning': 'computation.mathematics',
  'graph.structure': 'computation.mathematics',
  'graph.colour': 'computation.mathematics',
  'graph.order': 'computation.mathematics',
  'relation.properties': 'computation.mathematics',

  'calculus.limit': 'computation.mathematics',
  'calculus.continuity': 'computation.mathematics',
  'calculus.derivative': 'computation.mathematics',
  'calculus.shape': 'computation.mathematics',
  'calculus.asymptotes': 'computation.mathematics',
  'calculus.taylor': 'computation.mathematics',
  'calculus.integrate': 'computation.mathematics',
  'calculus.ode': 'computation.mathematics',
  'calculus.equilibria': 'computation.mathematics',
  'calculus.phase': 'computation.mathematics',
  'calculus.pde': 'computation.mathematics',

  'geometry.line': 'computation.mathematics',
  'geometry.angle': 'computation.mathematics',
  'geometry.triangle': 'computation.mathematics',
  'geometry.circle': 'computation.mathematics',
  'geometry.conic': 'computation.mathematics',
  'geometry.polygon': 'computation.mathematics',
  'geometry.transform': 'computation.mathematics',
  'geometry.hull': 'computation.mathematics',
  'geometry.closest': 'computation.mathematics',
  'geometry.delaunay': 'computation.mathematics',
  'geometry.solid': 'computation.mathematics',
  'geometry.claim': 'computation.mathematics'
})

/** How much any one of these may be given. */
export const MATH_LIMITS: Readonly<Record<'digits' | 'degree' | 'dimension' | 'vertices' | 'edges' | 'points' | 'samples' | 'items', number>> =
  Object.freeze({
    /** Decimal digits in a whole number sent as text. Past this, factorisation stops being a calculation. */
    digits: 200,
    degree: 100,
    dimension: 200,
    vertices: 5000,
    edges: 20_000,
    points: 20_000,
    samples: 20_000,
    items: 1000
  })

const settle = <T>(value: T, isError: (one: unknown) => boolean): unknown =>
  isError(value) ? { ok: false, ...(value as object) } : { ok: true, ...(value as object) }

// ---------------------------------------------------------------- readers

/** A whole number sent as decimal text, because JSON cannot carry one past 2^53 without losing it. */
function bigintOf(read: Reader, key: string): bigint {
  const raw = read.raw(key)
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw)) {
      throw new BadInput(`"${key}" is past the range a JSON number holds exactly. Send it as text, for example "${key}": "12345678901234567890".`)
    }
    return BigInt(raw)
  }
  const text = read.text(key, MATH_LIMITS.digits + 2)
  if (!/^-?\d+$/.test(text.trim())) throw new BadInput(`"${key}" has to be a whole number.`)
  const clean = text.trim()
  if (clean.replace('-', '').length > MATH_LIMITS.digits) {
    throw new BadInput(`"${key}" has more than the ${MATH_LIMITS.digits} digits allowed.`)
  }
  return BigInt(clean)
}

const bigintOut = (value: bigint): string => value.toString()

/** A rational sent as `{n, d}`, as a decimal string, or as a plain number. */
function rationalOf(raw: unknown, where: string): Rational {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new BadInput(`${where} has to be a finite number.`)
    const one = fromDecimal(String(raw))
    if (isAlgebraError(one)) throw new BadInput(one.message)
    return one
  }
  if (typeof raw === 'string') {
    const one = fromDecimal(raw)
    if (isAlgebraError(one)) throw new BadInput(one.message)
    return one
  }
  if (typeof raw === 'object' && raw !== null) {
    const entry = new Reader(raw as Record<string, unknown>)
    const one = rational(bigintOf(entry, 'n'), entry.has('d') ? bigintOf(entry, 'd') : 1n)
    if (isAlgebraError(one)) throw new BadInput(one.message)
    return one
  }
  throw new BadInput(`${where} has to be a number, a decimal string, or {n, d}.`)
}

const rationalOut = (one: Rational): Record<string, unknown> => ({
  n: bigintOut(one.n),
  d: bigintOut(one.d),
  text: rationalToText(one),
  approximately: Number(one.n) / Number(one.d)
})

function rationalsOf(read: Reader, key: string, max = MATH_LIMITS.dimension): Rational[] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list.`)
  if (raw.length > max) throw new BadInput(`"${key}" has more than the ${max} entries allowed.`)
  return raw.map((one, i) => rationalOf(one, `"${key}" at position ${i + 1}`))
}

function exactMatrixOf(read: Reader, key: string): ExactMatrix {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of rows.`)
  if (raw.length > MATH_LIMITS.dimension) throw new BadInput(`"${key}" has more than the ${MATH_LIMITS.dimension} rows allowed.`)
  const rows = raw.map((row, i) => {
    if (!Array.isArray(row)) throw new BadInput(`"${key}" row ${i + 1} is not a list.`)
    if (row.length > MATH_LIMITS.dimension) throw new BadInput(`"${key}" row ${i + 1} has more than the ${MATH_LIMITS.dimension} entries allowed.`)
    return row.map((one, j) => rationalOf(one, `"${key}" at row ${i + 1}, column ${j + 1}`))
  })
  const built = exactMatrix(rows)
  if (isMatrixError(built)) throw new BadInput(built.message)
  return built
}

function numericMatrixOf(read: Reader, key: string) {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of rows.`)
  if (raw.length > MATH_LIMITS.dimension) throw new BadInput(`"${key}" has more than the ${MATH_LIMITS.dimension} rows allowed.`)
  const rows = raw.map((row, i) => new Reader({ row }).numbers('row', MATH_LIMITS.dimension).map((one) => {
    if (!Number.isFinite(one)) throw new BadInput(`"${key}" row ${i + 1} holds something that is not a finite number.`)
    return one
  }))
  const built = numericMatrix(rows)
  if (isMatrixError(built)) throw new BadInput(built.message)
  return built
}

function exactMatrixOut(one: ExactMatrix): Record<string, unknown> {
  return {
    rows: one.rows,
    columns: one.columns,
    values: one.values.map((row) => row.map(rationalOut)),
    text: matrixToText(one)
  }
}

function polynomialOf(read: Reader, key: string): Polynomial {
  const coefficients = rationalsOf(read, key, MATH_LIMITS.degree + 1)
  const built = polynomial(coefficients, read.optionalText('variable', 'x', 16))
  if (isAlgebraError(built)) throw new BadInput(built.message)
  return built
}

const polynomialOut = (one: Polynomial): Record<string, unknown> => ({
  degree: degreeOf(one),
  variable: one.variable,
  coefficients: one.coefficients.map(rationalOut),
  text: polynomialToText(one)
})

/** A proposition tree, checked for depth so a deeply nested one cannot overflow the stack inside the main process. */
function propositionOf(raw: unknown, depth = 0): Proposition {
  if (depth > 16) throw new BadInput('That proposition is nested more deeply than the sixteen levels allowed.')
  if (typeof raw === 'string') {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(raw)) throw new BadInput(`"${raw}" is not a usable variable name.`)
    return { kind: 'variable', name: raw }
  }
  if (typeof raw !== 'object' || raw === null) throw new BadInput('A proposition is a variable name or an object.')
  const entry = new Reader(raw as Record<string, unknown>)
  const kind = entry.choice('kind', ['variable', 'not', 'and', 'or', 'implies', 'iff'] as const, 'variable')
  if (kind === 'variable') return propositionOf(entry.text('name', 64), depth + 1)
  if (kind === 'not') return { kind: 'not', operand: propositionOf(entry.raw('operand') ?? entry.raw('of'), depth + 1) }
  return { kind, left: propositionOf(entry.raw('left'), depth + 1), right: propositionOf(entry.raw('right'), depth + 1) }
}

function graphOfInput(read: Reader): Graph {
  const vertices = read.strings('vertices', MATH_LIMITS.vertices)
  const edges = read.list('edges', MATH_LIMITS.edges).map((one) => {
    const entry = new Reader(one)
    return { from: entry.text('from', 200), to: entry.text('to', 200), weight: entry.has('weight') ? entry.number('weight') : undefined }
  })
  const built = graphOf(vertices, edges, read.boolean('directed', false))
  if (isDiscreteError(built)) throw new BadInput(built.message)
  return built
}

function pointsOf(read: Reader, key: string): Point2[] {
  const raw = read.raw(key)
  if (!Array.isArray(raw)) throw new BadInput(`"${key}" has to be a list of points.`)
  if (raw.length > MATH_LIMITS.points) throw new BadInput(`"${key}" has more than the ${MATH_LIMITS.points} points allowed.`)
  return raw.map((one, i) => {
    if (typeof one !== 'object' || one === null) throw new BadInput(`"${key}" has something at position ${i + 1} that is not a point.`)
    const entry = new Reader(one as Record<string, unknown>)
    return { x: entry.number('x'), y: entry.number('y') }
  })
}

const pointOf = (read: Reader, key: string): Point2 => {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`"${key}" has to be a point.`)
  const entry = new Reader(raw as Record<string, unknown>)
  return { x: entry.number('x'), y: entry.number('y') }
}

const circleOf = (read: Reader, key: string): Circle => {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`"${key}" has to be a circle.`)
  const entry = new Reader(raw as Record<string, unknown>)
  return { centre: pointOf(entry, 'centre'), radius: entry.number('radius') }
}

/** A single-variable function sent as an expression, compiled by the interpreter. */
function realFunctionOf(read: Reader, key = 'expression', variableKey = 'variable') {
  const built = compileReal(read.text(key), read.optionalText(variableKey, 'x', 16))
  if (isCalculusError(built)) throw new BadInput(built.message)
  return built
}

// ---------------------------------------------------------------- dispatch

export function runMathOperation(operation: string, input: Record<string, unknown>): unknown {
  const read = new Reader(input)

  switch (operation) {
    // ---------------------------------------------------------------- algebra
    case 'algebra.rational': {
      const one = rationalOf(read.raw('value'), '"value"')
      return { ok: true, ...rationalOut(one), decimal: toDecimal(one, Math.min(60, Math.round(read.optionalNumber('digits', 30)))) }
    }

    case 'algebra.radical':
      return settle(simplifyRadical(bigintOf(read, 'value')), isAlgebraError)

    case 'algebra.polynomial': {
      const one = polynomialOf(read, 'coefficients')
      const what = read.choice('what', ['describe', 'evaluate', 'derivative', 'antiderivative', 'divide'] as const, 'describe')
      switch (what) {
        case 'describe':
          return { ok: true, ...polynomialOut(one) }
        case 'evaluate':
          return { ok: true, at: rationalOut(rationalOf(read.raw('at'), '"at"')), value: rationalOut(evaluatePolynomial(one, rationalOf(read.raw('at'), '"at"'))) }
        case 'derivative': {
          const result = derivativeOf(one)
          return isAlgebraError(result) ? { ok: false, ...result } : { ok: true, ...polynomialOut(result) }
        }
        case 'antiderivative': {
          const result = antiderivativeOf(one)
          return isAlgebraError(result) ? { ok: false, ...result } : { ok: true, ...polynomialOut(result) }
        }
        case 'divide': {
          const by = polynomial(rationalsOf(read, 'by', MATH_LIMITS.degree + 1), one.variable)
          if (isAlgebraError(by)) return { ok: false, ...by }
          const result = dividePolynomials(one, by)
          if (isAlgebraError(result)) return { ok: false, ...result }
          return {
            ok: true,
            quotient: polynomialOut(result.quotient),
            remainder: polynomialOut(result.remainder),
            exact: degreeOf(result.remainder) < 0,
            describe: result.describe
          }
        }
      }
      break
    }

    case 'algebra.roots':
      return settle(rootsOf(polynomialOf(read, 'coefficients')), isAlgebraError)

    case 'algebra.simplify':
      return {
        ok: true,
        ...canSimplify(read.text('rule', 200), {
          symbol: read.text('symbol', 64),
          domain: read.choice('domain', ['real', 'positive', 'non-negative', 'non-zero', 'integer', 'natural', 'complex'] as const, 'real') as Domain,
          positive: read.has('positive') ? read.boolean('positive') : null,
          nonZero: read.has('nonZero') ? read.boolean('nonZero') : null,
          integer: read.has('integer') ? read.boolean('integer') : null,
          between: read.has('low') ? { low: read.number('low'), high: read.number('high'), inclusive: read.boolean('inclusive', true) } : null
        })
      }

    case 'algebra.sequence': {
      const what = read.choice('what', ['terms', 'analyse'] as const, 'analyse')
      if (what === 'terms') {
        const rule: SequenceRule = {
          kind: read.choice('kind', ['arithmetic', 'geometric', 'recursive', 'explicit'] as const, 'arithmetic'),
          first: read.optionalNumber('first', 0),
          difference: read.has('difference') ? read.number('difference') : undefined,
          ratio: read.has('ratio') ? read.number('ratio') : undefined,
          expression: read.has('expression') ? read.text('expression') : undefined,
          seeds: read.has('seeds') ? read.numbers('seeds', 64) : undefined
        } as SequenceRule
        return settle(termsOf(rule, Math.round(read.optionalNumber('count', 20))), isAlgebraError)
      }
      return settle(analyseSequence(read.numbers('terms', MATH_LIMITS.items)), isAlgebraError)
    }

    case 'algebra.series':
      return settle(
        sumSeries(read.numbers('terms', MATH_LIMITS.items), {
          knownForm: read.has('knownForm') ? read.choice('knownForm', ['geometric', 'harmonic', 'p-series'] as const, 'geometric') : undefined,
          parameter: read.has('parameter') ? read.number('parameter') : undefined
        }),
        isAlgebraError
      )

    case 'algebra.logic': {
      const one = propositionOf(read.raw('proposition'))
      const what = read.choice('what', ['table', 'equivalent', 'dnf', 'cnf'] as const, 'table')
      switch (what) {
        case 'table':
          return settle(truthTable(one, Math.min(16, Math.round(read.optionalNumber('maxVariables', 16)))), isAlgebraError)
        case 'equivalent':
          return settle(equivalent(one, propositionOf(read.raw('against'))), isAlgebraError)
        case 'dnf':
          return settle(toDisjunctiveNormalForm(one), isAlgebraError)
        case 'cnf':
          return settle(toConjunctiveNormalForm(one), isAlgebraError)
      }
      break
    }

    // ---------------------------------------------------------------- matrices
    case 'matrix.reduce': {
      const one = exactMatrixOf(read, 'matrix')
      const reduction = rowReduce(one, read.boolean('fullyReduced', true))
      return {
        ok: true,
        result: exactMatrixOut(reduction.matrix),
        rank: reduction.rank,
        pivots: reduction.pivots,
        swaps: reduction.swaps,
        pivotProduct: rationalOut(reduction.pivotProduct),
        operations: reduction.operations
      }
    }

    case 'matrix.determinant': {
      const result = determinantOf(exactMatrixOf(read, 'matrix'))
      return isMatrixError(result) ? { ok: false, ...result } : { ok: true, ...rationalOut(result) }
    }

    case 'matrix.invert': {
      const result = invert(exactMatrixOf(read, 'matrix'))
      if (isMatrixError(result)) return { ok: false, ...result }
      return {
        ok: true,
        inverse: exactMatrixOut(result.inverse),
        determinant: rationalOut(result.determinant),
        verified: result.verified,
        operations: result.operations
      }
    }

    case 'matrix.solve': {
      const result = solveSystem(exactMatrixOf(read, 'matrix'), rationalsOf(read, 'rightHandSide'))
      if (isMatrixError(result)) return { ok: false, ...result }
      return {
        ok: true,
        kind: result.kind,
        particular: result.particular?.map(rationalOut) ?? null,
        nullSpace: result.nullSpace.map((one) => one.map(rationalOut)),
        freeVariables: result.freeVariables,
        describe: result.describe
      }
    }

    case 'matrix.subspaces': {
      const one = exactMatrixOf(read, 'matrix')
      const result = subspacesOf(one)
      return {
        ok: true,
        rank: rankOf(one),
        columnSpace: result.columnSpace.map((v) => v.map(rationalOut)),
        rowSpace: result.rowSpace.map((v) => v.map(rationalOut)),
        nullSpace: result.nullSpace.map((v) => v.map(rationalOut)),
        leftNullSpace: result.leftNullSpace.map((v) => v.map(rationalOut)),
        describe: result.describe
      }
    }

    case 'matrix.independence': {
      const raw = read.raw('vectors')
      if (!Array.isArray(raw)) throw new BadInput('"vectors" has to be a list of vectors.')
      const vectors = raw.map((one) => rationalsOf(new Reader({ v: one }), 'v'))
      const result = independence(vectors)
      if (isMatrixError(result)) return { ok: false, ...result }
      return { ok: true, independent: result.independent, combination: result.combination?.map(rationalOut) ?? null, describe: result.describe }
    }

    case 'matrix.factorise': {
      const one = numericMatrixOf(read, 'matrix')
      const how = read.choice('how', ['lu', 'qr', 'cholesky'] as const, 'lu')
      if (how === 'lu') return settle(luDecompose(one), isMatrixError)
      if (how === 'qr') return settle(qrDecompose(one), isMatrixError)
      return settle(cholesky(one), isMatrixError)
    }

    case 'matrix.eigen':
      return settle(
        eigenSymmetric(numericMatrixOf(read, 'matrix'), Math.min(2000, Math.round(read.optionalNumber('iterations', 200)))),
        isMatrixError
      )

    case 'matrix.svd':
      return settle(svd(numericMatrixOf(read, 'matrix'), read.has('tolerance') ? read.number('tolerance') : undefined), isMatrixError)

    case 'matrix.leastsquares':
      return settle(leastSquares(numericMatrixOf(read, 'matrix'), read.numbers('rightHandSide', MATH_LIMITS.dimension)), isMatrixError)

    case 'matrix.orthogonalise': {
      const raw = read.raw('vectors')
      if (!Array.isArray(raw)) throw new BadInput('"vectors" has to be a list of vectors.')
      const vectors = raw.map((one) => new Reader({ v: one }).numbers('v', MATH_LIMITS.dimension))
      if (read.boolean('project', false)) {
        return settle(projectOnto(read.numbers('vector', MATH_LIMITS.dimension), vectors), isMatrixError)
      }
      return settle(gramSchmidt(vectors), isMatrixError)
    }

    // ---------------------------------------------------------------- number theory
    case 'number.gcd': {
      const a = bigintOf(read, 'a')
      const b = bigintOf(read, 'b')
      const bezout = extendedGcd(a, b)
      const walk = euclideanSteps(a, b)
      return {
        ok: true,
        gcd: bigintOut(gcd(a, b)),
        lcm: bigintOut(lcm(a, b)),
        bezout: { x: bigintOut(bezout.x), y: bigintOut(bezout.y), gcd: bigintOut(bezout.gcd), describe: bezout.describe },
        steps: walk.steps.map((one) => ({
          a: bigintOut(one.a),
          b: bigintOut(one.b),
          quotient: bigintOut(one.quotient),
          remainder: bigintOut(one.remainder)
        }))
      }
    }

    case 'number.modular': {
      const what = read.choice('what', ['power', 'inverse'] as const, 'power')
      if (what === 'power') {
        const result = modPower(bigintOf(read, 'base'), bigintOf(read, 'exponent'), bigintOf(read, 'modulus'))
        return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
      }
      const result = modInverse(bigintOf(read, 'value'), bigintOf(read, 'modulus'))
      if (isDiscreteError(result)) return { ok: false, ...result }
      return { ok: true, exists: result.exists, inverse: result.value === null ? null : bigintOut(result.value), describe: result.describe }
    }

    case 'number.congruence': {
      if (read.has('congruences')) {
        const congruences = read.list('congruences', 64).map((one) => {
          const entry = new Reader(one)
          return { value: bigintOf(entry, 'value'), modulus: bigintOf(entry, 'modulus') }
        })
        const result = chineseRemainder(congruences)
        if (isDiscreteError(result)) return { ok: false, ...result }
        return {
          ok: true,
          value: bigintOut(result.value),
          modulus: bigintOut(result.modulus),
          verified: result.verified,
          coprime: result.coprime,
          describe: result.describe
        }
      }
      const result = solveCongruence({ coefficient: bigintOf(read, 'coefficient'), value: bigintOf(read, 'value'), modulus: bigintOf(read, 'modulus') })
      if (isDiscreteError(result)) return { ok: false, ...result }
      return {
        ok: true,
        solutions: result.solutions.map(bigintOut),
        base: result.base === null ? null : bigintOut(result.base),
        step: result.step === null ? null : bigintOut(result.step),
        count: result.count,
        describe: result.describe
      }
    }

    case 'number.prime': {
      const result = isPrime(bigintOf(read, 'value'))
      return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, ...result, factor: result.factor === null ? null : bigintOut(result.factor) }
    }

    case 'number.sieve':
      return settle(sieveOfEratosthenes(Math.round(read.number('limit'))), isDiscreteError)

    case 'number.factorise': {
      const result = factorise(bigintOf(read, 'value'))
      if (isDiscreteError(result)) return { ok: false, ...result }
      return {
        ok: true,
        complete: result.complete,
        factors: result.factors.map((one) => ({ prime: bigintOut(one.prime), power: one.power })),
        remaining: bigintOut(result.remaining),
        divisorCount: result.divisorCount,
        describe: result.describe
      }
    }

    case 'number.divisors': {
      const result = divisorsOf(bigintOf(read, 'value'))
      if (isDiscreteError(result)) return { ok: false, ...result }
      const phi = totient(bigintOf(read, 'value'))
      return {
        ok: true,
        divisors: result.divisors.map(bigintOut),
        count: result.count,
        sum: bigintOut(result.sum),
        properSum: bigintOut(result.properSum),
        classification: result.classification,
        totient: isDiscreteError(phi) ? null : bigintOut(phi.value),
        describe: result.describe
      }
    }

    case 'number.diophantine': {
      const result = linearDiophantine(bigintOf(read, 'a'), bigintOf(read, 'b'), bigintOf(read, 'c'))
      return {
        ok: true,
        hasSolution: result.hasSolution,
        x: result.x === null ? null : bigintOut(result.x),
        y: result.y === null ? null : bigintOut(result.y),
        xStep: result.xStep === null ? null : bigintOut(result.xStep),
        yStep: result.yStep === null ? null : bigintOut(result.yStep),
        describe: result.describe
      }
    }

    // ---------------------------------------------------------------- combinatorics
    case 'combinatorics.count': {
      const what = read.choice('what', ['factorial', 'combinations', 'permutations', 'multinomial', 'stars-and-bars', 'derangements'] as const, 'combinations')
      switch (what) {
        case 'factorial': {
          const result = factorial(Math.round(read.number('n')))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
        }
        case 'combinations': {
          const result = combinations(Math.round(read.number('n')), Math.round(read.number('r')))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
        }
        case 'permutations': {
          const result = permutations(Math.round(read.number('n')), Math.round(read.number('r')))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
        }
        case 'multinomial': {
          const result = multinomial(read.numbers('parts', 256).map((one) => Math.round(one)))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
        }
        case 'stars-and-bars': {
          const result = starsAndBars(Math.round(read.number('total')), Math.round(read.number('parts')), read.boolean('positive', false))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, count: bigintOut(result.count), describe: result.describe }
        }
        case 'derangements': {
          const result = derangements(Math.round(read.number('n')))
          return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, value: bigintOut(result) }
        }
      }
      break
    }

    case 'combinatorics.enumerate': {
      const items = read.strings('items', MATH_LIMITS.items)
      const kind = read.choice('kind', ['permutations', 'combinations'] as const, 'combinations')
      const r = Math.round(read.optionalNumber('r', kind === 'permutations' ? items.length : items.length))
      const result = kind === 'permutations' ? enumeratePermutations(items, r) : enumerateCombinations(items, r)
      if (isDiscreteError(result)) return { ok: false, ...result }
      return { ok: true, count: bigintOut(result.count), complete: result.complete, items: result.items, describe: result.describe }
    }

    case 'combinatorics.pascal': {
      const result = pascalRow(Math.round(read.number('n')))
      return isDiscreteError(result) ? { ok: false, ...result } : { ok: true, n: result.n, entries: result.entries.map(bigintOut), sum: bigintOut(result.sum) }
    }

    case 'combinatorics.pigeonhole':
      return settle(
        pigeonhole(Math.round(read.number('objects')), Math.round(read.number('boxes')), read.has('target') ? Math.round(read.number('target')) : undefined),
        isDiscreteError
      )

    case 'combinatorics.inclusion': {
      // The sizes arrive as a list of {of, size}, keyed here into the map the engine wants. Built with the sorted
      // join the engine uses, so a caller listing "B,A" and one listing "A,B" mean the same intersection.
      const sets = read.strings('sets', 16)
      const sizes = new Map<string, bigint>()
      for (const one of read.list('sizes', 65_535)) {
        const entry = new Reader(one)
        const of = entry.strings('of', 16)
        for (const name of of) {
          if (!sets.includes(name)) throw new BadInput(`"${name}" is named in an intersection but is not one of the sets.`)
        }
        sizes.set([...of].sort().join('&'), bigintOf(entry, 'size'))
      }
      const result = inclusionExclusion(sets, sizes)
      return isDiscreteError(result)
        ? { ok: false, ...result }
        : {
            ok: true,
            count: bigintOut(result.count),
            terms: result.terms.map((one) => ({ ...one, value: bigintOut(one.value) })),
            missing: result.missing,
            complete: result.complete,
            describe: result.describe
          }
    }

    // ---------------------------------------------------------------- graphs
    case 'graph.traverse': {
      const graph = graphOfInput(read)
      const start = read.text('start', 200)
      const how = read.choice('how', ['breadth', 'depth'] as const, 'breadth')
      return settle(how === 'breadth' ? breadthFirst(graph, start) : depthFirst(graph, start), isDiscreteError)
    }

    case 'graph.shortest': {
      const graph = graphOfInput(read)
      const start = read.text('start', 200)
      const target = read.has('target') ? read.text('target', 200) : undefined
      const how = read.choice('how', ['dijkstra', 'bellman-ford'] as const, 'dijkstra')
      return settle(how === 'dijkstra' ? dijkstra(graph, start, target) : bellmanFord(graph, start, target), isDiscreteError)
    }

    case 'graph.spanning':
      return settle(kruskal(graphOfInput(read)), isDiscreteError)

    case 'graph.structure': {
      const graph = graphOfInput(read)
      return {
        ok: true,
        components: componentsOf(graph),
        cycle: findCycle(graph),
        bipartite: isBipartite(graph),
        eulerian: settle(eulerian(graph), isDiscreteError)
      }
    }

    case 'graph.colour':
      return { ok: true, ...greedyColouring(graphOfInput(read)) }

    case 'graph.order':
      return settle(topologicalSort(graphOfInput(read)), isDiscreteError)

    case 'relation.properties': {
      const members = read.strings('members', MATH_LIMITS.items)
      const pairs = read.list('pairs', MATH_LIMITS.edges).map((one) => {
        const entry = new Reader(one)
        return [entry.text('from', 200), entry.text('to', 200)] as [string, string]
      })
      const what = read.choice('what', ['properties', 'classes', 'order'] as const, 'properties')
      if (what === 'classes') return settle(equivalenceClasses(members, pairs), isDiscreteError)
      if (what === 'order') return settle(orderElements(members, pairs), isDiscreteError)
      return { ok: true, ...relationProperties(members, pairs) }
    }

    // ---------------------------------------------------------------- calculus
    case 'calculus.limit':
      return {
        ok: true,
        ...limitAt(realFunctionOf(read), read.number('at'), {
          from: read.choice('from', ['both', 'left', 'right'] as const, 'both'),
          steps: read.has('steps') ? Math.round(read.number('steps')) : undefined
        })
      }

    case 'calculus.continuity':
      return { ok: true, ...continuityAt(realFunctionOf(read), read.number('at')) }

    case 'calculus.derivative':
      return settle(derivativeAt(read.text('expression'), read.number('at'), read.optionalText('variable', 'x', 16)), isCalculusError)

    case 'calculus.shape':
      return settle(
        analyseShape(realFunctionOf(read), read.number('from'), read.number('to'), Math.min(MATH_LIMITS.samples, Math.round(read.optionalNumber('samples', 1000)))),
        isCalculusError
      )

    case 'calculus.asymptotes':
      return {
        ok: true,
        ...findAsymptotes(realFunctionOf(read), read.has('candidates') ? read.numbers('candidates', 200) : [], read.optionalNumber('far', 1e6))
      }

    case 'calculus.taylor':
      return settle(
        taylorSeries(
          realFunctionOf(read),
          read.number('centre'),
          Math.min(20, Math.round(read.number('order'))),
          read.has('from') ? { from: read.number('from'), to: read.number('to') } : undefined
        ),
        isCalculusError
      )

    case 'calculus.integrate':
      return settle(
        integrateFunction(realFunctionOf(read), read.number('from'), read.number('to'), {
          method: read.choice('method', ['trapezoid', 'simpson', 'adaptive-simpson', 'gauss-legendre'] as const, 'adaptive-simpson'),
          intervals: read.has('intervals') ? Math.round(read.number('intervals')) : undefined,
          tolerance: read.has('tolerance') ? read.number('tolerance') : undefined
        }),
        isCalculusError
      )

    case 'calculus.ode':
      return {
        ok: true,
        ...classifyOde(twoVariableFunction(read, 'expression'), { x: read.optionalNumber('aroundX', 1), y: read.optionalNumber('aroundY', 1) })
      }

    case 'calculus.equilibria': {
      const rate = realFunctionOf(read, 'expression', 'variable')
      const result = equilibriaOf((y) => rate(y), read.number('from'), read.number('to'), Math.min(MATH_LIMITS.samples, Math.round(read.optionalNumber('samples', 500))))
      return isCalculusError(result) ? { ok: false, ...result } : { ok: true, equilibria: result }
    }

    case 'calculus.phase': {
      const dx = twoVariableFunction(read, 'dx')
      const dy = twoVariableFunction(read, 'dy')
      return settle(
        phasePortrait(
          (x, y) => [dx(x, y), dy(x, y)],
          {
            xFrom: read.optionalNumber('xFrom', -5),
            xTo: read.optionalNumber('xTo', 5),
            yFrom: read.optionalNumber('yFrom', -5),
            yTo: read.optionalNumber('yTo', 5)
          },
          {
            grid: Math.min(60, Math.round(read.optionalNumber('grid', 20))),
            steps: Math.min(5000, Math.round(read.optionalNumber('steps', 400))),
            trajectoriesFrom: read.has('trajectoriesFrom') ? pointsOf(read, 'trajectoriesFrom') : undefined
          }
        ),
        isCalculusError
      )
    }

    case 'calculus.pde': {
      const which = read.choice('which', ['heat', 'wave'] as const, 'heat')
      // The initial condition arrives as the grid itself, not as an expression: a PDE solver's grid is where the
      // stability condition is decided, and sampling one silently would hide which spacing was actually used.
      const initial = read.numbers('initial', 200_000)
      const shared = {
        dx: read.number('dx'),
        dt: read.number('dt'),
        steps: Math.round(read.number('steps')),
        frames: read.has('frames') ? Math.round(read.number('frames')) : undefined
      }
      if (which === 'heat') {
        const boundary = read.has('boundary') ? read.numbers('boundary', 2) : null
        if (boundary !== null && boundary.length !== 2) throw new BadInput('"boundary" holds the two end values.')
        return settle(
          heatEquation(initial, {
            ...shared,
            diffusivity: read.number('diffusivity'),
            boundary: boundary === null ? undefined : ([boundary[0], boundary[1]] as [number, number])
          }),
          isCalculusError
        )
      }
      return settle(
        waveEquation(initial, {
          ...shared,
          speed: read.number('speed'),
          initialVelocity: read.has('initialVelocity') ? read.numbers('initialVelocity', 200_000) : undefined
        }),
        isCalculusError
      )
    }

    // ---------------------------------------------------------------- geometry
    case 'geometry.line': {
      const a = lineThrough(pointOf(read, 'a'), pointOf(read, 'b'))
      if (isGeometryError(a)) return { ok: false, ...a }
      if (!read.has('c')) return { ok: true, line: a }
      const b = lineThrough(pointOf(read, 'c'), pointOf(read, 'd'))
      if (isGeometryError(b)) return { ok: false, ...b }
      return { ok: true, line: a, other: b, relationship: relateLines(a, b) }
    }

    case 'geometry.angle':
      return settle(angleAt(pointOf(read, 'vertex'), pointOf(read, 'a'), pointOf(read, 'b')), isGeometryError)

    case 'geometry.triangle': {
      const triangle: Triangle = { a: pointOf(read, 'a'), b: pointOf(read, 'b'), c: pointOf(read, 'c') }
      return settle(triangleFacts(triangle), isGeometryError)
    }

    case 'geometry.circle': {
      const what = read.choice('what', ['through', 'intersect', 'line', 'tangents'] as const, 'through')
      switch (what) {
        case 'through':
          return settle(circleThrough(pointOf(read, 'a'), pointOf(read, 'b'), pointOf(read, 'c')), isGeometryError)
        case 'intersect':
          return settle(intersectCircles(circleOf(read, 'a'), circleOf(read, 'b')), isGeometryError)
        case 'line': {
          const line = lineThrough(pointOf(read, 'a'), pointOf(read, 'b'))
          if (isGeometryError(line)) return { ok: false, ...line }
          return { ok: true, ...intersectLineCircle(line, circleOf(read, 'circle')) }
        }
        case 'tangents':
          return { ok: true, ...tangentsFrom(pointOf(read, 'from'), circleOf(read, 'circle')) }
      }
      break
    }

    case 'geometry.conic':
      return {
        ok: true,
        ...classifyConic(read.number('A'), read.number('B'), read.number('C'), read.number('D'), read.number('E'), read.number('F'))
      }

    case 'geometry.polygon': {
      const vertices = read.has('sides')
        ? regularPolygon(Math.round(read.number('sides')), read.number('circumradius'))
        : null
      if (vertices !== null) return settle(vertices, isGeometryError)
      const points = pointsOf(read, 'vertices')
      const facts = polygonFacts(points)
      if (isGeometryError(facts)) return { ok: false, ...facts }
      return { ok: true, ...facts, contains: read.has('at') ? containsPoint(points, pointOf(read, 'at')) : null }
    }

    case 'geometry.transform': {
      const one = transformOf(read, 'transform')
      const second = read.has('then') ? transformOf(read, 'then') : null
      const combined = second === null ? one : compose(one, second)
      return { ok: true, transform: combined, facts: transformFacts(combined) }
    }

    case 'geometry.hull':
      return settle(convexHull(pointsOf(read, 'points')), isGeometryError)

    case 'geometry.closest':
      return settle(closestPair(pointsOf(read, 'points')), isGeometryError)

    case 'geometry.delaunay': {
      const points = pointsOf(read, 'points')
      const result = delaunay(points)
      if (isGeometryError(result)) return { ok: false, ...result }
      return { ok: true, ...result, verification: verifyDelaunay(points, result.triangles) }
    }

    case 'geometry.solid':
      return settle(
        solidFacts(
          read.choice('shape', ['cube', 'cuboid', 'sphere', 'cylinder', 'cone', 'pyramid', 'prism'] as const, 'cube'),
          read.named('dimensions', 16)
        ),
        isGeometryError
      )

    case 'geometry.claim': {
      const points = new Map<string, Point2>()
      const raw = read.raw('points')
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new BadInput('"points" has to be a set of named points.')
      for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        if (points.size >= MATH_LIMITS.items) throw new BadInput(`"points" has more than the ${MATH_LIMITS.items} entries allowed.`)
        if (typeof value !== 'object' || value === null) throw new BadInput(`Point "${name}" is not a point.`)
        const entry = new Reader(value as Record<string, unknown>)
        points.set(name, { x: entry.number('x'), y: entry.number('y') })
      }
      const claim: Claim = {
        id: read.optionalText('id', 'claim', 200),
        kind: read.choice(
          'kind',
          ['collinear', 'concurrent', 'equal-length', 'perpendicular', 'parallel', 'equal-angle', 'on-circle', 'congruent-triangles'] as const,
          'equal-length'
        ),
        points: read.strings('of', 64),
        describe: read.optionalText('describe', '', 400)
      }
      return { ok: true, ...checkClaim(claim, points) }
    }
  }

  // Reached only when an operation is in this file's capability map and has no case here, which is ours to fix.
  throw new BadInput(`"${operation}" has a capability but no implementation, which is a bug in Orbis rather than in your Page.`)
}

// ---------------------------------------------------------------- two-variable helpers

/**
 * `f(x, y)` sent as one expression in two named variables.
 *
 * Parsed once and evaluated with both names bound in the interpreter's scope. The earlier shape of this compiled a
 * one-variable function per call by substituting the y value into the text, which is textual rewriting of somebody
 * else's expression -- it reparses on every call and it gets `y^2` wrong the moment y is negative.
 */
function twoVariableFunction(read: Reader, key: string): (x: number, y: number) => number {
  const xName = read.optionalText('xVariable', 'x', 16)
  const yName = read.optionalText('yVariable', 'y', 16)
  for (const name of [xName, yName]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadInput(`"${name}" is not a usable variable name.`)
  }
  const tree = parseExpression(read.text(key))
  if (isParseError(tree)) throw new BadInput(tree.message)
  if (sizeOf(tree) > 4000) throw new BadInput('That expression is too large to work with.')

  return (x: number, y: number): number => {
    const value = evaluateExpression(tree, { [xName]: x, [yName]: y })
    // Not finite reads as "no value here", which every engine taking one of these already handles.
    return isEvaluateError(value) ? Number.NaN : value
  }
}

function transformOf(read: Reader, key: string): Transform2 {
  const raw = read.raw(key)
  if (typeof raw !== 'object' || raw === null) throw new BadInput(`"${key}" has to be a transform.`)
  const entry = new Reader(raw as Record<string, unknown>)
  const kind = entry.choice('kind', ['translation', 'rotation', 'scaling', 'reflection', 'shear', 'matrix'] as const, 'matrix')
  const about = entry.has('about') ? pointOf(entry, 'about') : { x: 0, y: 0 }
  switch (kind) {
    case 'translation':
      return translation(entry.number('dx'), entry.number('dy'))
    case 'rotation':
      return rotation(entry.number('radians'), about)
    case 'scaling':
      return scaling(entry.number('sx'), entry.number('sy'), about)
    case 'reflection':
      return reflection(entry.number('radians'))
    case 'shear':
      return shear(entry.number('kx'), entry.number('ky'))
    case 'matrix': {
      const m = entry.numbers('m', 9)
      if (m.length !== 9) throw new BadInput('A transform matrix has nine entries, in row order.')
      return { m: m as unknown as Transform2['m'], describe: entry.optionalText('describe', 'a given matrix', 200) }
    }
  }
}

