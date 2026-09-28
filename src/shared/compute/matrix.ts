/**
 * Linear algebra: matrices, systems, decompositions and the spaces they describe.
 *
 * Two arithmetics, kept apart on purpose. **Exact** works in rationals and gives answers that are right -- a rank is a
 * rank, a determinant of zero means singular. **Numeric** works in doubles and gives answers that are close, with the
 * error reported rather than left for the reader to assume away.
 *
 * ## Why both
 *
 * An exact rank of a 3x3 integer matrix is a fact. A numeric rank is a count of singular values above a tolerance, and
 * moving the tolerance moves the answer. Neither is wrong; they answer different questions, and conflating them is how
 * a matrix that is exactly singular gets reported as invertible with a very large inverse.
 *
 * ## Why elimination remembers
 *
 * `rowReduce` returns the operations it performed. Not for display -- although it is useful there -- but because the
 * same sequence applied to the identity gives the inverse, and applied to a right-hand side solves the system. Keeping
 * them is cheaper than doing the elimination three times.
 */

import {
  ONE,
  ZERO,
  addRational,
  compareRational,
  divideRational,
  isAlgebraError,
  isZero,
  multiplyRational,
  negateRational,
  rational,
  rationalToText,
  subtractRational,
  toNumber,
  type Rational
} from './algebra.ts'

export interface MatrixError {
  error: string
  message: string
}

export const isMatrixError = (value: unknown): value is MatrixError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): MatrixError => ({ error, message })

export const MATRIX_LIMITS: Readonly<Record<'size' | 'entries' | 'iterations' | 'power', number>> = Object.freeze({
  size: 512,
  entries: 250_000,
  iterations: 2_000,
  power: 1_000
})

// ---------------------------------------------------------------- shape

export interface ExactMatrix {
  rows: number
  columns: number
  /** Row-major. `values[r][c]`. */
  values: Rational[][]
}

export interface NumericMatrix {
  rows: number
  columns: number
  values: number[][]
}

/** An exact matrix from numbers or rationals, with the shape checked rather than assumed. */
export function exactMatrix(values: readonly (readonly (number | Rational)[])[]): ExactMatrix | MatrixError {
  if (values.length === 0) return fail('empty', 'A matrix needs at least one row.')
  const columns = values[0].length
  if (columns === 0) return fail('empty', 'A matrix needs at least one column.')
  if (values.length > MATRIX_LIMITS.size || columns > MATRIX_LIMITS.size) {
    return fail('too-large', `A matrix is limited to ${MATRIX_LIMITS.size} rows and columns.`)
  }
  if (values.length * columns > MATRIX_LIMITS.entries) {
    return fail('too-large', `That matrix has ${(values.length * columns).toLocaleString('en')} entries, past the ${MATRIX_LIMITS.entries.toLocaleString('en')} allowed.`)
  }

  const out: Rational[][] = []
  for (let r = 0; r < values.length; r++) {
    if (values[r].length !== columns) {
      return fail('ragged', `Row ${r + 1} has ${values[r].length} entries and row 1 has ${columns}. Every row of a matrix has the same length.`)
    }
    const row: Rational[] = []
    for (const value of values[r]) {
      if (typeof value === 'number') {
        if (!Number.isInteger(value)) {
          return fail('invalid-argument', `${value} is not a whole number. Build the entry as a rational to keep it exact.`)
        }
        const one = rational(value)
        if (isAlgebraError(one)) return fail(one.error, one.message)
        row.push(one)
      } else {
        row.push(value)
      }
    }
    out.push(row)
  }
  return { rows: values.length, columns, values: out }
}

export function numericMatrix(values: readonly (readonly number[])[]): NumericMatrix | MatrixError {
  if (values.length === 0) return fail('empty', 'A matrix needs at least one row.')
  const columns = values[0].length
  if (columns === 0) return fail('empty', 'A matrix needs at least one column.')
  if (values.length > MATRIX_LIMITS.size || columns > MATRIX_LIMITS.size) {
    return fail('too-large', `A matrix is limited to ${MATRIX_LIMITS.size} rows and columns.`)
  }
  for (let r = 0; r < values.length; r++) {
    if (values[r].length !== columns) return fail('ragged', `Row ${r + 1} has ${values[r].length} entries and row 1 has ${columns}.`)
    for (const value of values[r]) {
      if (!Number.isFinite(value)) return fail('not-finite', 'Every entry of a matrix has to be a finite number.')
    }
  }
  return { rows: values.length, columns, values: values.map((row) => [...row]) }
}

export const toNumeric = (one: ExactMatrix): NumericMatrix => ({
  rows: one.rows,
  columns: one.columns,
  values: one.values.map((row) => row.map(toNumber))
})

export const identity = (n: number): ExactMatrix | MatrixError =>
  exactMatrix(Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))))

export const zeros = (rows: number, columns: number): ExactMatrix | MatrixError =>
  exactMatrix(Array.from({ length: rows }, () => new Array<number>(columns).fill(0)))

export const isSquare = (one: ExactMatrix | NumericMatrix): boolean => one.rows === one.columns

// ---------------------------------------------------------------- basic operations

export function addMatrices(a: ExactMatrix, b: ExactMatrix): ExactMatrix | MatrixError {
  if (a.rows !== b.rows || a.columns !== b.columns) {
    return fail('shape', `A ${a.rows}x${a.columns} matrix cannot be added to a ${b.rows}x${b.columns} one. Addition is entry by entry, so the shapes have to match.`)
  }
  return {
    rows: a.rows,
    columns: a.columns,
    values: a.values.map((row, r) => row.map((value, c) => addRational(value, b.values[r][c])))
  }
}

export function subtractMatrices(a: ExactMatrix, b: ExactMatrix): ExactMatrix | MatrixError {
  if (a.rows !== b.rows || a.columns !== b.columns) {
    return fail('shape', `A ${a.rows}x${a.columns} matrix cannot have a ${b.rows}x${b.columns} one subtracted from it.`)
  }
  return {
    rows: a.rows,
    columns: a.columns,
    values: a.values.map((row, r) => row.map((value, c) => subtractRational(value, b.values[r][c])))
  }
}

export const scaleMatrix = (one: ExactMatrix, factor: Rational): ExactMatrix => ({
  rows: one.rows,
  columns: one.columns,
  values: one.values.map((row) => row.map((value) => multiplyRational(value, factor)))
})

/**
 * Matrix multiplication.
 *
 * The shape check has the useful message: `2x3` times `4x2` fails because 3 and 4 differ, and saying which two numbers
 * had to match is the difference between fixing it and staring at it.
 */
export function multiplyMatrices(a: ExactMatrix, b: ExactMatrix): ExactMatrix | MatrixError {
  if (a.columns !== b.rows) {
    return fail(
      'shape',
      `A ${a.rows}x${a.columns} matrix cannot multiply a ${b.rows}x${b.columns} one: the first has ${a.columns} columns and the second has ${b.rows} rows, and those have to be equal.`
    )
  }
  const values: Rational[][] = []
  for (let r = 0; r < a.rows; r++) {
    const row: Rational[] = []
    for (let c = 0; c < b.columns; c++) {
      let sum = ZERO
      for (let k = 0; k < a.columns; k++) sum = addRational(sum, multiplyRational(a.values[r][k], b.values[k][c]))
      row.push(sum)
    }
    values.push(row)
  }
  return { rows: a.rows, columns: b.columns, values }
}

export const transpose = (one: ExactMatrix): ExactMatrix => ({
  rows: one.columns,
  columns: one.rows,
  values: Array.from({ length: one.columns }, (_, r) => Array.from({ length: one.rows }, (_, c) => one.values[c][r]))
})

export function traceOf(one: ExactMatrix): Rational | MatrixError {
  if (!isSquare(one)) return fail('shape', 'Only a square matrix has a trace; it is the sum down the main diagonal.')
  let sum = ZERO
  for (let i = 0; i < one.rows; i++) sum = addRational(sum, one.values[i][i])
  return sum
}

export function matrixPower(one: ExactMatrix, exponent: number): ExactMatrix | MatrixError {
  if (!isSquare(one)) return fail('shape', 'Only a square matrix can be raised to a power.')
  if (!Number.isInteger(exponent) || exponent < 0) return fail('invalid-argument', 'A matrix power needs a whole exponent that is not negative. For a negative one, invert first.')
  if (exponent > MATRIX_LIMITS.power) return fail('too-large', `An exponent past ${MATRIX_LIMITS.power} is refused.`)

  let result = identity(one.rows)
  if (isMatrixError(result)) return result
  // Exponentiation by squaring: a thousandth power in ten multiplications rather than a thousand, and the exact
  // entries grow fast enough that the difference matters.
  let base = one
  let n = exponent
  while (n > 0) {
    if (n & 1) {
      const next = multiplyMatrices(result, base)
      if (isMatrixError(next)) return next
      result = next
    }
    n >>= 1
    if (n > 0) {
      const squared = multiplyMatrices(base, base)
      if (isMatrixError(squared)) return squared
      base = squared
    }
  }
  return result
}

// ---------------------------------------------------------------- elimination

export type RowOperation =
  | { kind: 'swap'; a: number; b: number; describe: string }
  | { kind: 'scale'; row: number; factor: Rational; describe: string }
  | { kind: 'combine'; target: number; source: number; factor: Rational; describe: string }

export interface Reduction {
  matrix: ExactMatrix
  operations: RowOperation[]
  /** Column index of each pivot, in order. Its length is the rank. */
  pivots: number[]
  rank: number
  /** How many row swaps were made, which decides the sign of the determinant. */
  swaps: number
  /** The product of the pivots before any scaling, which is the determinant of a square matrix. */
  pivotProduct: Rational
}

/**
 * Gauss-Jordan elimination, keeping every operation.
 *
 * The operations are the point. Applied to the identity they give the inverse; applied to a right-hand side they solve
 * the system; read out they are the working somebody can check. Doing the elimination once and reusing it is both
 * faster and impossible to get inconsistent.
 *
 * Exact arithmetic, so a pivot is zero or it is not -- there is no tolerance, and a matrix that is singular is found
 * to be singular rather than found to have a very small determinant.
 */
export function rowReduce(one: ExactMatrix, reduced = true): Reduction {
  const values = one.values.map((row) => [...row])
  const operations: RowOperation[] = []
  const pivots: number[] = []
  let swaps = 0
  let pivotProduct = ONE
  let row = 0

  for (let column = 0; column < one.columns && row < one.rows; column++) {
    // Find a pivot. Exact arithmetic means any non-zero entry will do; the largest is chosen anyway so the numbers
    // stay smaller, which keeps the rationals from growing denominators faster than they need to.
    let best = -1
    for (let r = row; r < one.rows; r++) {
      if (isZero(values[r][column])) continue
      if (best === -1 || compareRational(absOf(values[r][column]), absOf(values[best][column])) > 0) best = r
    }
    if (best === -1) continue

    if (best !== row) {
      const temp = values[row]
      values[row] = values[best]
      values[best] = temp
      swaps += 1
      operations.push({ kind: 'swap', a: row, b: best, describe: `R${row + 1} <-> R${best + 1}` })
    }

    const pivot = values[row][column]
    pivotProduct = multiplyRational(pivotProduct, pivot)
    pivots.push(column)

    if (reduced) {
      const factor = divideRational(ONE, pivot)
      if (!isAlgebraError(factor) && !isZero(subtractRational(factor, ONE))) {
        for (let c = 0; c < one.columns; c++) values[row][c] = multiplyRational(values[row][c], factor)
        operations.push({ kind: 'scale', row, factor, describe: `R${row + 1} <- (${rationalToText(factor)})R${row + 1}` })
      }
    }

    for (let r = 0; r < one.rows; r++) {
      if (r === row) continue
      // In echelon form only the rows below are cleared; in reduced form, every other row.
      if (!reduced && r < row) continue
      if (isZero(values[r][column])) continue
      const factor = divideRational(values[r][column], values[row][column])
      if (isAlgebraError(factor)) continue
      for (let c = 0; c < one.columns; c++) {
        values[r][c] = subtractRational(values[r][c], multiplyRational(factor, values[row][c]))
      }
      operations.push({
        kind: 'combine',
        target: r,
        source: row,
        factor,
        describe: `R${r + 1} <- R${r + 1} - (${rationalToText(factor)})R${row + 1}`
      })
    }
    row += 1
  }

  return { matrix: { rows: one.rows, columns: one.columns, values }, operations, pivots, rank: pivots.length, swaps, pivotProduct }
}

const absOf = (one: Rational): Rational => ({ n: one.n < 0n ? -one.n : one.n, d: one.d })

export function rankOf(one: ExactMatrix): number {
  return rowReduce(one, false).rank
}

/**
 * The determinant, exactly, from the elimination.
 *
 * `swaps` gives the sign and the pivots give the magnitude. Cofactor expansion would be `n!` operations; this is `n^3`
 * and gives the same answer, because exact arithmetic means the elimination loses nothing.
 */
export function determinantOf(one: ExactMatrix): Rational | MatrixError {
  if (!isSquare(one)) return fail('shape', `Only a square matrix has a determinant. This one is ${one.rows}x${one.columns}.`)
  const reduction = rowReduce(one, false)
  if (reduction.rank < one.rows) return ZERO
  return reduction.swaps % 2 === 0 ? reduction.pivotProduct : negateRational(reduction.pivotProduct)
}

export interface Inversion {
  inverse: ExactMatrix
  determinant: Rational
  operations: RowOperation[]
  /** `A * A^-1 = I`, checked rather than assumed. */
  verified: boolean
}

/**
 * The inverse, by reducing `[A | I]`.
 *
 * Verified by multiplying back. In exact arithmetic that check is either true or false with nothing in between, so it
 * costs one multiplication and removes any doubt about the result.
 */
export function invert(one: ExactMatrix): Inversion | MatrixError {
  if (!isSquare(one)) return fail('shape', `Only a square matrix has an inverse. This one is ${one.rows}x${one.columns}; a non-square matrix has a pseudo-inverse instead.`)

  const determinant = determinantOf(one)
  if (isMatrixError(determinant)) return determinant
  if (isZero(determinant)) {
    return fail(
      'singular',
      `This matrix is singular: its determinant is exactly zero, so it has no inverse. Its rank is ${rankOf(one)} out of ${one.rows}, meaning ${one.rows - rankOf(one)} of its rows are combinations of the others.`
    )
  }

  const n = one.rows
  const augmented = exactMatrix(
    one.values.map((row, r) => [...row, ...Array.from({ length: n }, (_, c) => (r === c ? 1 : 0))])
  )
  if (isMatrixError(augmented)) return augmented

  const reduction = rowReduce(augmented, true)
  const inverse: ExactMatrix = {
    rows: n,
    columns: n,
    values: reduction.matrix.values.map((row) => row.slice(n))
  }

  const product = multiplyMatrices(one, inverse)
  const verified = !isMatrixError(product) && product.values.every((row, r) => row.every((value, c) => (r === c ? isZero(subtractRational(value, ONE)) : isZero(value))))

  return { inverse, determinant, operations: reduction.operations, verified }
}

// ---------------------------------------------------------------- systems

export type SolutionKind = 'unique' | 'infinite' | 'none'

export interface SystemSolution {
  kind: SolutionKind
  /** The particular solution, where there is one. For an infinite family, the one with free variables at zero. */
  particular: Rational[] | null
  /** A basis for the null space: each vector can be added to the particular solution in any multiple. */
  nullSpace: Rational[][]
  freeVariables: number[]
  pivotVariables: number[]
  rank: number
  describe: string
  operations: RowOperation[]
}

/**
 * `Ax = b`, solved exactly.
 *
 * The three outcomes are genuinely different and are reported as such. A unique solution is a vector. An infinite
 * family is a particular solution plus a basis for the null space, which is the whole family rather than one member of
 * it. And no solution is no solution -- the least-squares answer is a different question, and `leastSquares` is where
 * it is asked.
 */
export function solveSystem(a: ExactMatrix, b: readonly Rational[]): SystemSolution | MatrixError {
  if (b.length !== a.rows) {
    return fail('shape', `The matrix has ${a.rows} rows and the right-hand side has ${b.length} entries. They have to match.`)
  }

  const augmented = exactMatrix(a.values.map((row, r) => [...row, b[r]]))
  if (isMatrixError(augmented)) return augmented
  const reduction = rowReduce(augmented, true)

  // A pivot in the last column means a row reading 0 = 1, which is a contradiction.
  const inconsistent = reduction.pivots.includes(a.columns)
  const pivotVariables = reduction.pivots.filter((one) => one < a.columns)
  const rank = pivotVariables.length
  const freeVariables: number[] = []
  for (let c = 0; c < a.columns; c++) if (!pivotVariables.includes(c)) freeVariables.push(c)

  if (inconsistent) {
    return {
      kind: 'none',
      particular: null,
      nullSpace: [],
      freeVariables,
      pivotVariables,
      rank,
      describe: `There is no solution. Eliminating leaves a row saying that zero equals something that is not zero, which means the equations contradict each other. The closest point in the least-squares sense is a different question.`,
      operations: reduction.operations
    }
  }

  const particular: Rational[] = new Array(a.columns).fill(ZERO)
  pivotVariables.forEach((column, i) => {
    particular[column] = reduction.matrix.values[i][a.columns]
  })

  const nullSpace: Rational[][] = freeVariables.map((free) => {
    const vector: Rational[] = new Array(a.columns).fill(ZERO)
    vector[free] = ONE
    pivotVariables.forEach((column, i) => {
      vector[column] = negateRational(reduction.matrix.values[i][free])
    })
    return vector
  })

  if (freeVariables.length === 0) {
    return {
      kind: 'unique',
      particular,
      nullSpace: [],
      freeVariables,
      pivotVariables,
      rank,
      describe: `There is exactly one solution: the rank is ${rank}, which equals the number of unknowns, so nothing is free.`,
      operations: reduction.operations
    }
  }

  return {
    kind: 'infinite',
    particular,
    nullSpace,
    freeVariables,
    pivotVariables,
    rank,
    describe: `There are infinitely many solutions. The rank is ${rank} and there are ${a.columns} unknowns, leaving ${freeVariables.length} free. Every solution is the particular one plus any combination of the ${nullSpace.length} null-space vectors.`,
    operations: reduction.operations
  }
}

// ---------------------------------------------------------------- the four subspaces

export interface Subspaces {
  columnSpace: Rational[][]
  rowSpace: Rational[][]
  nullSpace: Rational[][]
  leftNullSpace: Rational[][]
  rank: number
  nullity: number
  describe: string
}

/**
 * Bases for the four fundamental subspaces.
 *
 * The column space basis is taken from the *original* columns at the pivot positions, not from the reduced ones.
 * Elimination changes the column space -- it preserves the row space and the null space -- so using the reduced
 * columns would give a basis for the wrong space, which is the classic mistake here.
 */
export function subspacesOf(one: ExactMatrix): Subspaces {
  const reduction = rowReduce(one, true)
  const rank = reduction.rank

  const columnSpace = reduction.pivots.map((column) => one.values.map((row) => row[column]))
  const rowSpace = reduction.matrix.values.slice(0, rank).map((row) => [...row])

  const solved = solveSystem(one, new Array(one.rows).fill(ZERO))
  const nullSpace = isMatrixError(solved) ? [] : solved.nullSpace

  const transposed = transpose(one)
  const leftSolved = solveSystem(transposed, new Array(transposed.rows).fill(ZERO))
  const leftNullSpace = isMatrixError(leftSolved) ? [] : leftSolved.nullSpace

  return {
    columnSpace,
    rowSpace,
    nullSpace,
    leftNullSpace,
    rank,
    nullity: one.columns - rank,
    describe: `Rank ${rank}, nullity ${one.columns - rank}. Those add to ${one.columns}, the number of columns, which they always do. The column space basis is taken from the original columns at the pivot positions: elimination changes the column space, so the reduced columns would describe a different one.`
  }
}

/** Whether a set of vectors is linearly independent, with the combination that shows it is not when it is not. */
export function independence(vectors: readonly (readonly Rational[])[]): { independent: boolean; combination: Rational[] | null; describe: string } | MatrixError {
  if (vectors.length === 0) return fail('empty', 'There are no vectors to test.')
  const length = vectors[0].length
  if (!vectors.every((one) => one.length === length)) return fail('ragged', 'Every vector has to have the same number of entries.')

  // Vectors as columns: they are independent exactly when the only solution to Ax = 0 is x = 0.
  const matrix = exactMatrix(Array.from({ length }, (_, r) => vectors.map((one) => one[r])))
  if (isMatrixError(matrix)) return matrix

  const solved = solveSystem(matrix, new Array(length).fill(ZERO))
  if (isMatrixError(solved)) return solved

  if (solved.nullSpace.length === 0) {
    return { independent: true, combination: null, describe: `The ${vectors.length} vectors are independent: no combination of them except all-zero gives the zero vector.` }
  }
  const combination = solved.nullSpace[0]
  const terms = combination
    .map((coefficient, i) => ({ coefficient, i }))
    .filter((one) => !isZero(one.coefficient))
    .map((one) => `${rationalToText(one.coefficient)}*v${one.i + 1}`)
  return {
    independent: false,
    combination,
    describe: `The vectors are dependent: ${terms.join(' + ')} gives the zero vector, so at least one of them adds nothing the others do not already give.`
  }
}

/** Whether vectors form a basis for a space of the stated dimension: independent, and enough of them. */
export function isBasis(vectors: readonly (readonly Rational[])[], dimension: number): { basis: boolean; describe: string } | MatrixError {
  if (vectors.length === 0) return fail('empty', 'There are no vectors to test.')
  const independent = independence(vectors)
  if (isMatrixError(independent)) return independent

  if (vectors.length !== dimension) {
    return {
      basis: false,
      describe: `${vectors.length} vectors cannot be a basis for a ${dimension}-dimensional space. ${vectors.length < dimension ? 'There are too few to span it' : 'There are too many to be independent'}.`
    }
  }
  return {
    basis: independent.independent,
    describe: independent.independent
      ? `${vectors.length} independent vectors in a ${dimension}-dimensional space are a basis: independence plus the right count is enough, and spanning follows.`
      : independent.describe
  }
}

// ---------------------------------------------------------------- numeric decompositions

export interface LuResult {
  lower: NumericMatrix
  upper: NumericMatrix
  /** The row order used. Pivoting is not optional: without it a perfectly ordinary matrix divides by zero. */
  permutation: number[]
  swaps: number
  determinant: number
  notes: string[]
}

/** `PA = LU`, with partial pivoting. The permutation is returned because `A = LU` is false without it. */
export function luDecompose(one: NumericMatrix): LuResult | MatrixError {
  if (!isSquare(one)) return fail('shape', 'LU decomposition here is for a square matrix.')
  const n = one.rows
  const a = one.values.map((row) => [...row])
  const permutation = Array.from({ length: n }, (_, i) => i)
  let swaps = 0

  for (let k = 0; k < n; k++) {
    let best = k
    for (let r = k + 1; r < n; r++) if (Math.abs(a[r][k]) > Math.abs(a[best][k])) best = r
    if (Math.abs(a[best][k]) < 1e-14) {
      return fail(
        'singular',
        `Column ${k + 1} has no usable pivot: every entry at or below the diagonal is within rounding of zero, so the matrix is singular or very close to it.`
      )
    }
    if (best !== k) {
      const temp = a[k]
      a[k] = a[best]
      a[best] = temp
      const p = permutation[k]
      permutation[k] = permutation[best]
      permutation[best] = p
      swaps += 1
    }
    for (let r = k + 1; r < n; r++) {
      const factor = a[r][k] / a[k][k]
      a[r][k] = factor
      for (let c = k + 1; c < n; c++) a[r][c] -= factor * a[k][c]
    }
  }

  const lower = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : r > c ? a[r][c] : 0)))
  const upper = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r <= c ? a[r][c] : 0)))

  let determinant = swaps % 2 === 0 ? 1 : -1
  for (let i = 0; i < n; i++) determinant *= a[i][i]

  const l = numericMatrix(lower)
  const u = numericMatrix(upper)
  if (isMatrixError(l)) return l
  if (isMatrixError(u)) return u

  return {
    lower: l,
    upper: u,
    permutation,
    swaps,
    determinant,
    notes: [
      swaps === 0
        ? 'No rows were swapped, so A = LU directly.'
        : `${swaps} row swap${swaps === 1 ? '' : 's'} were needed, so this is PA = LU rather than A = LU. The permutation is part of the answer.`
    ]
  }
}

export interface QrResult {
  q: NumericMatrix
  r: NumericMatrix
  /** How far the columns of Q are from being orthonormal. Reported, because it is the quality of the answer. */
  orthogonalityError: number
  notes: string[]
}

/**
 * `A = QR` by modified Gram-Schmidt.
 *
 * Modified rather than classical: the classical version subtracts all the projections computed against the original
 * vector, and loses orthogonality badly on anything near-dependent. The modified version subtracts each projection
 * from the running remainder, which costs the same and is far more stable. The residual orthogonality error is
 * reported either way, because it is what tells you whether to believe the result.
 */
export function qrDecompose(one: NumericMatrix): QrResult | MatrixError {
  const m = one.rows
  const n = one.columns
  if (n > m) return fail('shape', `QR here needs at least as many rows as columns. This matrix is ${m}x${n}.`)

  const columns: number[][] = Array.from({ length: n }, (_, c) => one.values.map((row) => row[c]))
  const q: number[][] = []
  const r: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))

  for (let j = 0; j < n; j++) {
    let v = [...columns[j]]
    for (let i = 0; i < j; i++) {
      // Against the running remainder, not the original column. That is the whole difference from the classical form.
      let dot = 0
      for (let k = 0; k < m; k++) dot += q[i][k] * v[k]
      r[i][j] = dot
      v = v.map((value, k) => value - dot * q[i][k])
    }
    const norm = Math.sqrt(v.reduce((sum, value) => sum + value * value, 0))
    r[j][j] = norm
    if (norm < 1e-13) {
      return fail(
        'rank-deficient',
        `Column ${j + 1} is a combination of the ones before it, to within rounding. QR by Gram-Schmidt needs independent columns; this matrix does not have them.`
      )
    }
    q.push(v.map((value) => value / norm))
  }

  // How far Q'Q is from the identity: the honest measure of what the decomposition is worth.
  let orthogonalityError = 0
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let dot = 0
      for (let k = 0; k < m; k++) dot += q[i][k] * q[j][k]
      orthogonalityError = Math.max(orthogonalityError, Math.abs(dot - (i === j ? 1 : 0)))
    }
  }

  const qMatrix = numericMatrix(Array.from({ length: m }, (_, row) => q.map((column) => column[row])))
  const rMatrix = numericMatrix(r)
  if (isMatrixError(qMatrix)) return qMatrix
  if (isMatrixError(rMatrix)) return rMatrix

  return {
    q: qMatrix,
    r: rMatrix,
    orthogonalityError,
    notes: [
      orthogonalityError < 1e-10
        ? `The columns of Q are orthonormal to within ${orthogonalityError.toExponential(2)}, which is rounding.`
        : `The columns of Q are only orthonormal to within ${orthogonalityError.toExponential(2)}. The columns of the original are close to dependent, and anything built on this decomposition carries that error.`
    ]
  }
}

export interface CholeskyResult {
  lower: NumericMatrix
  notes: string[]
}

/**
 * `A = LL'` for a symmetric positive-definite matrix.
 *
 * Both conditions are checked rather than assumed. A matrix that is not symmetric has no Cholesky factor at all, and
 * one that is not positive definite produces a square root of a negative number partway through -- which without the
 * check comes back as `NaN` scattered through an otherwise plausible-looking factor.
 */
export function cholesky(one: NumericMatrix): CholeskyResult | MatrixError {
  if (!isSquare(one)) return fail('shape', 'Cholesky is for a square matrix.')
  const n = one.rows

  for (let r = 0; r < n; r++) {
    for (let c = r + 1; c < n; c++) {
      if (Math.abs(one.values[r][c] - one.values[c][r]) > 1e-12 * Math.max(1, Math.abs(one.values[r][c]))) {
        return fail('not-symmetric', `This matrix is not symmetric: entry (${r + 1},${c + 1}) is ${one.values[r][c]} and (${c + 1},${r + 1}) is ${one.values[c][r]}. Cholesky needs symmetry.`)
      }
    }
  }

  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = one.values[i][j]
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
      if (i === j) {
        if (sum <= 0) {
          return fail(
            'not-positive-definite',
            `This matrix is not positive definite: the pivot at position ${i + 1} would need the square root of ${Number(sum.toPrecision(4))}. Cholesky only exists for a positive-definite matrix.`
          )
        }
        L[i][j] = Math.sqrt(sum)
      } else {
        L[i][j] = sum / L[j][j]
      }
    }
  }

  const lower = numericMatrix(L)
  if (isMatrixError(lower)) return lower
  return { lower, notes: ['The matrix is symmetric and positive definite, both of which were checked rather than assumed.'] }
}

export interface EigenResult {
  /** Real eigenvalues, largest magnitude first. */
  values: number[]
  vectors: number[][]
  /** Whether the method was able to find them all. */
  complete: boolean
  method: string
  /** `Av - Lv` for each pair: the check, reported rather than promised. */
  residuals: number[]
  notes: string[]
}

/**
 * Eigenvalues and eigenvectors of a symmetric matrix, by the Jacobi rotation method.
 *
 * Restricted to symmetric matrices on purpose. A symmetric matrix has real eigenvalues and an orthogonal eigenbasis,
 * and Jacobi finds them reliably. A general matrix can have complex eigenvalues and defective eigenspaces, and a
 * method that returned real numbers for one would be returning something that is not the answer.
 */
export function eigenSymmetric(one: NumericMatrix, iterations = 200): EigenResult | MatrixError {
  if (!isSquare(one)) return fail('shape', 'Eigenvalues are for a square matrix.')
  const n = one.rows

  for (let r = 0; r < n; r++) {
    for (let c = r + 1; c < n; c++) {
      if (Math.abs(one.values[r][c] - one.values[c][r]) > 1e-10 * Math.max(1, Math.abs(one.values[r][c]))) {
        return fail(
          'not-symmetric',
          'This method is for a symmetric matrix, whose eigenvalues are real and whose eigenvectors are orthogonal. A general matrix can have complex eigenvalues, and returning real numbers for it would not be the answer.'
        )
      }
    }
  }

  const a = one.values.map((row) => [...row])
  // Annotated: the identity it starts as would otherwise give it literal 0 | 1 types, and the rotations below write
  // arbitrary numbers into it.
  const v: number[][] = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)))

  let sweeps = 0
  for (; sweeps < iterations; sweeps++) {
    let off = 0
    for (let r = 0; r < n; r++) for (let c = r + 1; c < n; c++) off += a[r][c] * a[r][c]
    if (Math.sqrt(off) < 1e-14) break

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-16) continue
        // The rotation that zeroes a[p][q]. Computed through t rather than theta: fewer transcendental calls and
        // better conditioned when the diagonal entries are close.
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c

        for (let k = 0; k < n; k++) {
          const akp = a[k][p]
          const akq = a[k][q]
          a[k][p] = c * akp - s * akq
          a[k][q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k]
          const aqk = a[q][k]
          a[p][k] = c * apk - s * aqk
          a[q][k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p]
          const vkq = v[k][q]
          v[k][p] = c * vkp - s * vkq
          v[k][q] = s * vkp + c * vkq
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({ value: a[i][i], vector: v.map((row) => row[i]) }))
  pairs.sort((x, y) => Math.abs(y.value) - Math.abs(x.value))

  const residuals = pairs.map((pair) => {
    let worst = 0
    for (let r = 0; r < n; r++) {
      let sum = 0
      for (let c = 0; c < n; c++) sum += one.values[r][c] * pair.vector[c]
      worst = Math.max(worst, Math.abs(sum - pair.value * pair.vector[r]))
    }
    return worst
  })

  return {
    values: pairs.map((one2) => one2.value),
    vectors: pairs.map((one2) => one2.vector),
    complete: sweeps < iterations,
    method: 'Jacobi rotations',
    residuals,
    notes: [
      sweeps < iterations
        ? `Converged in ${sweeps} sweep${sweeps === 1 ? '' : 's'}.`
        : `Stopped after ${iterations} sweeps without the off-diagonal reaching rounding. The values are approximate and the residuals say by how much.`,
      `The largest residual of A*v - lambda*v is ${Math.max(...residuals).toExponential(2)}. That is the check, not a promise.`
    ]
  }
}

export interface SvdResult {
  /** Singular values, largest first. Never negative. */
  singularValues: number[]
  u: NumericMatrix
  v: NumericMatrix
  /** Count above the tolerance. Moving the tolerance moves this, which is why it is reported with it. */
  rank: number
  tolerance: number
  /** Largest over smallest. `Infinity` for a singular matrix. */
  conditionNumber: number
  notes: string[]
}

/**
 * The singular values, from the eigenvalues of `A'A`.
 *
 * Via `A'A` rather than a direct bidiagonalisation: it is the short implementation, and it squares the condition
 * number, so the smallest singular values of a badly conditioned matrix come out less accurately than a direct method
 * would give. That is stated in the notes rather than left for somebody to discover.
 */
export function svd(one: NumericMatrix, tolerance?: number): SvdResult | MatrixError {
  const m = one.rows
  const n = one.columns

  const ata: number[][] = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => {
      let sum = 0
      for (let k = 0; k < m; k++) sum += one.values[k][r] * one.values[k][c]
      return sum
    })
  )
  const symmetric = numericMatrix(ata)
  if (isMatrixError(symmetric)) return symmetric

  const eigen = eigenSymmetric(symmetric)
  if (isMatrixError(eigen)) return eigen

  // A tiny negative eigenvalue is rounding on something that is mathematically zero, not a negative singular value.
  const singularValues = eigen.values.map((value) => Math.sqrt(Math.max(0, value)))
  const order = singularValues.map((value, i) => ({ value, i })).sort((a, b) => b.value - a.value)
  const sorted = order.map((one2) => one2.value)
  const vectors = order.map((one2) => eigen.vectors[one2.i])

  const largest = sorted[0] ?? 0
  const used = tolerance ?? Math.max(m, n) * largest * Number.EPSILON
  const rank = sorted.filter((value) => value > used).length
  // The *last* singular value, not the last one above the tolerance. Using the latter would give a singular matrix a
  // condition number of one -- it would be reporting the conditioning of the matrix restricted to its own range, which
  // is exactly the number that hides the problem.
  const smallest = sorted[sorted.length - 1] ?? 0

  const u: number[][] = Array.from({ length: m }, () => new Array<number>(rank).fill(0))
  for (let j = 0; j < rank; j++) {
    for (let r = 0; r < m; r++) {
      let sum = 0
      for (let c = 0; c < n; c++) sum += one.values[r][c] * vectors[j][c]
      u[r][j] = sum / sorted[j]
    }
  }

  const uMatrix = numericMatrix(rank > 0 ? u : [[0]])
  const vMatrix = numericMatrix(Array.from({ length: n }, (_, r) => vectors.map((vector) => vector[r])))
  if (isMatrixError(uMatrix)) return uMatrix
  if (isMatrixError(vMatrix)) return vMatrix

  const conditionNumber = smallest > 0 ? largest / smallest : Number.POSITIVE_INFINITY

  const notes = [
    `Rank ${rank}, counting singular values above ${used.toExponential(2)}. That tolerance is a choice: moving it moves the rank, which is why a numeric rank is not the same kind of statement as an exact one.`,
    'Computed through A-transpose-A, which squares the condition number. For a badly conditioned matrix the smallest singular values come out less accurately than a direct method would give.'
  ]
  if (conditionNumber === Number.POSITIVE_INFINITY) {
    notes.push('The condition number is infinite: the matrix is singular to within the tolerance used.')
  } else if (conditionNumber > 1e10) {
    notes.push(
      `The condition number is ${conditionNumber.toExponential(2)}. Solving with this matrix loses roughly ${Math.round(Math.log10(conditionNumber))} digits of accuracy, so an answer that looks precise may not be.`
    )
  }

  return { singularValues: sorted, u: uMatrix, v: vMatrix, rank, tolerance: used, conditionNumber, notes }
}

// ---------------------------------------------------------------- least squares and projections

export interface LeastSquaresResult {
  solution: number[]
  residuals: number[]
  /** The Euclidean norm of the residual: how far the best fit is from actually solving the system. */
  residualNorm: number
  /** Present when the system has an exact solution, which makes the residual zero. */
  exact: boolean
  conditionNumber: number
  notes: string[]
}

/**
 * The `x` minimising `||Ax - b||`.
 *
 * Solved through QR rather than the normal equations. `A'A x = A'b` is the textbook form and squares the condition
 * number, which for a fit that is already poorly conditioned loses half the significant digits. QR costs about twice
 * as much and does not.
 */
export function leastSquares(a: NumericMatrix, b: readonly number[]): LeastSquaresResult | MatrixError {
  if (b.length !== a.rows) return fail('shape', `The matrix has ${a.rows} rows and the right-hand side has ${b.length} entries.`)
  if (a.rows < a.columns) {
    return fail('shape', `There are ${a.rows} equations and ${a.columns} unknowns. An underdetermined system has infinitely many exact solutions rather than one best fit; solve it instead.`)
  }

  const qr = qrDecompose(a)
  if (isMatrixError(qr)) {
    // Rank deficiency means something different here than it does for a decomposition: not "QR needs independent
    // columns" but "there is no single best fit", which is the thing the caller actually needs to know.
    if (qr.error === 'rank-deficient') {
      return fail(
        'rank-deficient',
        'The columns are not independent, so there is no unique best fit: several different solutions give the same minimum residual. Drop the redundant columns, or use the pseudo-inverse, which picks the shortest of them.'
      )
    }
    return qr
  }

  // Q'b, then back-substitute through R.
  const qtb: number[] = []
  for (let c = 0; c < a.columns; c++) {
    let sum = 0
    for (let r = 0; r < a.rows; r++) sum += qr.q.values[r][c] * b[r]
    qtb.push(sum)
  }

  // Back-substitution. No zero-pivot guard here: `qrDecompose` refuses a column whose remainder is within rounding of
  // zero, so every diagonal entry of R is already known to be usable. A check that can never fire would be a safeguard
  // in appearance only.
  const solution = new Array<number>(a.columns).fill(0)
  for (let i = a.columns - 1; i >= 0; i--) {
    let sum = qtb[i]
    for (let j = i + 1; j < a.columns; j++) sum -= qr.r.values[i][j] * solution[j]
    solution[i] = sum / qr.r.values[i][i]
  }

  const residuals = b.map((value, r) => {
    let predicted = 0
    for (let c = 0; c < a.columns; c++) predicted += a.values[r][c] * solution[c]
    return value - predicted
  })
  const residualNorm = Math.sqrt(residuals.reduce((sum, one) => sum + one * one, 0))

  const decomposition = svd(a)
  const conditionNumber = isMatrixError(decomposition) ? Number.NaN : decomposition.conditionNumber

  const scale = Math.sqrt(b.reduce((sum, one) => sum + one * one, 0))
  const exact = residualNorm < Math.max(1e-10, scale * 1e-12)

  const notes = [
    exact
      ? 'The residual is within rounding of zero, so this system has an exact solution and the best fit is it.'
      : `The residual norm is ${Number(residualNorm.toPrecision(6))}. The system has no exact solution; this is the closest point in the column space.`,
    'Solved through QR rather than the normal equations, which would square the condition number and lose about half the significant digits.'
  ]
  if (Number.isFinite(conditionNumber) && conditionNumber > 1e8) {
    notes.push(`The condition number is ${conditionNumber.toExponential(2)}, so small changes in the data move the fit a lot.`)
  }

  return { solution, residuals, residualNorm, exact, conditionNumber, notes }
}

export interface GramSchmidtResult {
  vectors: number[][]
  /** The original vectors that turned out to be combinations of the earlier ones. */
  dropped: number[]
  orthogonalityError: number
  notes: string[]
}

/** Gram-Schmidt, modified form. A vector that is a combination of the earlier ones is dropped and reported. */
export function gramSchmidt(vectors: readonly (readonly number[])[]): GramSchmidtResult | MatrixError {
  if (vectors.length === 0) return fail('empty', 'There are no vectors to orthogonalise.')
  const length = vectors[0].length
  if (!vectors.every((one) => one.length === length)) return fail('ragged', 'Every vector has to have the same number of entries.')

  const out: number[][] = []
  const dropped: number[] = []

  for (let i = 0; i < vectors.length; i++) {
    let v = [...vectors[i]]
    for (const previous of out) {
      let dot = 0
      for (let k = 0; k < length; k++) dot += previous[k] * v[k]
      v = v.map((value, k) => value - dot * previous[k])
    }
    const norm = Math.sqrt(v.reduce((sum, value) => sum + value * value, 0))
    const original = Math.sqrt(vectors[i].reduce((sum, value) => sum + value * value, 0))
    // Relative to the original length: an absolute threshold would drop a short vector that is genuinely independent.
    if (norm < Math.max(1e-13, original * 1e-12)) {
      dropped.push(i)
      continue
    }
    out.push(v.map((value) => value / norm))
  }

  let orthogonalityError = 0
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length; j++) {
      let dot = 0
      for (let k = 0; k < length; k++) dot += out[i][k] * out[j][k]
      orthogonalityError = Math.max(orthogonalityError, Math.abs(dot - (i === j ? 1 : 0)))
    }
  }

  const notes = [`${out.length} orthonormal vector${out.length === 1 ? '' : 's'} from ${vectors.length}.`]
  if (dropped.length > 0) {
    notes.push(
      `Vector${dropped.length === 1 ? '' : 's'} ${dropped.map((one) => one + 1).join(', ')} ${dropped.length === 1 ? 'was' : 'were'} dropped: ${dropped.length === 1 ? 'it is' : 'they are'} a combination of the earlier ones and adds nothing to the span.`
    )
  }
  notes.push(`The result is orthonormal to within ${orthogonalityError.toExponential(2)}.`)

  return { vectors: out, dropped, orthogonalityError, notes }
}

/** The projection of a vector onto the span of an orthonormal set, and the part left over. */
export function projectOnto(vector: readonly number[], basis: readonly (readonly number[])[]): { projection: number[]; perpendicular: number[]; describe: string } | MatrixError {
  if (basis.length === 0) return fail('empty', 'There is no space to project onto.')
  if (!basis.every((one) => one.length === vector.length)) return fail('ragged', 'The vector and the basis have to have the same number of entries.')

  const projection = new Array<number>(vector.length).fill(0)
  for (const one of basis) {
    let dot = 0
    for (let k = 0; k < vector.length; k++) dot += one[k] * vector[k]
    for (let k = 0; k < vector.length; k++) projection[k] += dot * one[k]
  }
  const perpendicular = vector.map((value, k) => value - projection[k])
  const distance = Math.sqrt(perpendicular.reduce((sum, one) => sum + one * one, 0))

  return {
    projection,
    perpendicular,
    describe: `The projection is the closest point in the span; what is left over is perpendicular to it, with length ${Number(distance.toPrecision(6))}. This assumes the basis given is orthonormal -- if it is not, the projection is wrong.`
  }
}

export function matrixToText(one: ExactMatrix): string {
  return one.values.map((row) => row.map(rationalToText).join('\t')).join('\n')
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const MATRIX_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Exact and numeric are separate. An exact rank is a fact; a numeric rank counts singular values above a tolerance, and the tolerance is reported with it.',
  'A determinant of exactly zero means singular. Nothing here reports a singular matrix as having a very small determinant.',
  'The column space basis comes from the original columns, because elimination changes the column space.',
  'Every decomposition reports how far its result is from the property it claims, rather than promising the property.',
  'Least squares is solved through QR, not the normal equations, which would square the condition number.',
  'Eigenvalues here are for symmetric matrices, whose eigenvalues are real. A general matrix is refused rather than given real answers it does not have.',
  'A system with no solution is reported as having none. The least-squares answer is a different question.',
  'Cholesky checks symmetry and positive definiteness rather than producing a factor full of NaN.'
])
