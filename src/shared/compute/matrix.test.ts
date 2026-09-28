import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { ONE, ZERO, isAlgebraError, isZero, rational, rationalToText, subtractRational, type Rational } from './algebra.ts'
import {
  MATRIX_ASSUMPTIONS,
  MATRIX_LIMITS,
  addMatrices,
  cholesky,
  determinantOf,
  eigenSymmetric,
  exactMatrix,
  gramSchmidt,
  identity,
  independence,
  invert,
  isBasis,
  isMatrixError,
  leastSquares,
  luDecompose,
  matrixPower,
  matrixToText,
  multiplyMatrices,
  numericMatrix,
  projectOnto,
  qrDecompose,
  rankOf,
  rowReduce,
  solveSystem,
  subspacesOf,
  svd,
  toNumeric,
  traceOf,
  transpose,
  type ExactMatrix,
  type NumericMatrix
} from './matrix.ts'

const r = (n: number, d = 1): Rational => {
  const one = rational(n, d)
  if (isAlgebraError(one)) throw new Error(one.message)
  return one
}

const m = (values: (number | Rational)[][]): ExactMatrix => {
  const one = exactMatrix(values)
  if (isMatrixError(one)) throw new Error(one.message)
  return one
}

const num = (values: number[][]): NumericMatrix => {
  const one = numericMatrix(values)
  if (isMatrixError(one)) throw new Error(one.message)
  return one
}

describe('building matrices', () => {
  test('a ragged matrix is refused, naming the row', () => {
    const one = exactMatrix([[1, 2], [3]])
    assert.ok(isMatrixError(one))
    assert.match(one.message, /Row 2 has 1 entries and row 1 has 2/)
  })

  test('an empty matrix is refused', () => {
    assert.ok(isMatrixError(exactMatrix([])))
    assert.ok(isMatrixError(exactMatrix([[]])))
  })

  test('a fractional entry has to be built as a rational, so nothing becomes inexact by accident', () => {
    const one = exactMatrix([[1.5]])
    assert.ok(isMatrixError(one))
    assert.match(one.message, /Build the entry as a rational/)
    assert.ok(!isMatrixError(exactMatrix([[r(3, 2)]])))
  })

  test('a matrix past the size ceiling is refused', () => {
    const big = Array.from({ length: MATRIX_LIMITS.size + 1 }, () => [0])
    assert.ok(isMatrixError(exactMatrix(big)))
  })

  test('the identity is what it should be', () => {
    const one = identity(3)
    assert.ok(!isMatrixError(one))
    assert.equal(matrixToText(one), '1\t0\t0\n0\t1\t0\n0\t0\t1')
  })
})

describe('arithmetic', () => {
  test('addition needs matching shapes, and says which two did not match', () => {
    const one = addMatrices(m([[1, 2]]), m([[1], [2]]))
    assert.ok(isMatrixError(one))
    assert.match(one.message, /1x2 matrix cannot be added to a 2x1/)
  })

  test('multiplication names the two numbers that had to be equal', () => {
    const one = multiplyMatrices(m([[1, 2, 3], [4, 5, 6]]), m([[1, 2], [3, 4], [5, 6], [7, 8]]))
    assert.ok(isMatrixError(one))
    assert.match(one.message, /first has 3 columns and the second has 4 rows/)
  })

  test('multiplication is exact', () => {
    const product = multiplyMatrices(m([[1, 2], [3, 4]]), m([[5, 6], [7, 8]]))
    assert.ok(!isMatrixError(product))
    assert.equal(matrixToText(product), '19\t22\n43\t50')
  })

  test('the transpose swaps the shape', () => {
    const one = transpose(m([[1, 2, 3]]))
    assert.equal(one.rows, 3)
    assert.equal(one.columns, 1)
  })

  test('the trace is the sum down the diagonal, and only a square matrix has one', () => {
    const trace = traceOf(m([[1, 9], [9, 4]]))
    assert.ok(!isMatrixError(trace))
    assert.equal(rationalToText(trace), '5')
    assert.ok(isMatrixError(traceOf(m([[1, 2, 3]]))))
  })

  test('a matrix power is exact, even at a size where repeated multiplication would be slow', () => {
    // [[1,1],[1,0]]^10 has Fibonacci entries: F(11)=89, F(10)=55.
    const one = matrixPower(m([[1, 1], [1, 0]]), 10)
    assert.ok(!isMatrixError(one))
    assert.equal(rationalToText(one.values[0][0]), '89')
    assert.equal(rationalToText(one.values[0][1]), '55')
  })

  test('the zeroth power is the identity, and a negative power is refused', () => {
    const zeroth = matrixPower(m([[2, 0], [0, 3]]), 0)
    assert.ok(!isMatrixError(zeroth))
    assert.equal(matrixToText(zeroth), '1\t0\n0\t1')
    assert.ok(isMatrixError(matrixPower(m([[2, 0], [0, 3]]), -1)))
  })
})

describe('elimination', () => {
  test('row reduction records every operation it performed', () => {
    const reduction = rowReduce(m([[2, 4], [1, 3]]))
    assert.ok(reduction.operations.length > 0)
    assert.ok(reduction.operations.every((one) => one.describe !== ''))
    assert.ok(reduction.operations.some((one) => one.kind === 'combine'))
  })

  test('the reduced form is the identity for an invertible matrix', () => {
    const reduction = rowReduce(m([[2, 1], [1, 1]]))
    assert.equal(matrixToText(reduction.matrix), '1\t0\n0\t1')
    assert.equal(reduction.rank, 2)
  })

  test('the rank counts the pivots', () => {
    // The third row is the sum of the first two, so the rank is two.
    assert.equal(rankOf(m([[1, 2, 3], [4, 5, 6], [5, 7, 9]])), 2)
    assert.equal(rankOf(m([[1, 0], [0, 1]])), 2)
    assert.equal(rankOf(m([[0, 0], [0, 0]])), 0)
  })

  test('a swap is recorded and changes the sign of the determinant', () => {
    const reduction = rowReduce(m([[0, 1], [1, 0]]), false)
    assert.equal(reduction.swaps, 1)
    const determinant = determinantOf(m([[0, 1], [1, 0]]))
    assert.ok(!isMatrixError(determinant))
    assert.equal(rationalToText(determinant), '-1')
  })
})

describe('determinant', () => {
  test('a 2x2 determinant is ad - bc', () => {
    const one = determinantOf(m([[1, 2], [3, 4]]))
    assert.ok(!isMatrixError(one))
    assert.equal(rationalToText(one), '-2')
  })

  test('a 3x3 determinant is exact', () => {
    const one = determinantOf(m([[6, 1, 1], [4, -2, 5], [2, 8, 7]]))
    assert.ok(!isMatrixError(one))
    assert.equal(rationalToText(one), '-306')
  })

  test('a singular matrix has a determinant of exactly zero, not a very small number', () => {
    const one = determinantOf(m([[1, 2], [2, 4]]))
    assert.ok(!isMatrixError(one))
    assert.ok(isZero(one))
    assert.equal(rationalToText(one), '0')
  })

  test('only a square matrix has a determinant', () => {
    const one = determinantOf(m([[1, 2, 3]]))
    assert.ok(isMatrixError(one))
    assert.match(one.message, /1x3/)
  })

  test('the determinant of the identity is one at any size', () => {
    for (const n of [1, 2, 5]) {
      const eye = identity(n)
      assert.ok(!isMatrixError(eye))
      const one = determinantOf(eye)
      assert.ok(!isMatrixError(one))
      assert.equal(rationalToText(one), '1')
    }
  })
})

describe('inverse', () => {
  test('an inverse is found and verified by multiplying back', () => {
    const inverted = invert(m([[4, 7], [2, 6]]))
    assert.ok(!isMatrixError(inverted))
    assert.equal(inverted.verified, true)
    assert.equal(rationalToText(inverted.determinant), '10')
    // The inverse of [[4,7],[2,6]] is [[0.6,-0.7],[-0.2,0.4]].
    assert.equal(rationalToText(inverted.inverse.values[0][0]), '3/5')
    assert.equal(rationalToText(inverted.inverse.values[0][1]), '-7/10')
  })

  test('a singular matrix is refused, with the rank explaining why', () => {
    const one = invert(m([[1, 2], [2, 4]]))
    assert.ok(isMatrixError(one))
    assert.equal(one.error, 'singular')
    assert.match(one.message, /rank is 1 out of 2/)
  })

  test('a non-square matrix is refused, and the pseudo-inverse is named as the alternative', () => {
    const one = invert(m([[1, 2, 3]]))
    assert.ok(isMatrixError(one))
    assert.match(one.message, /pseudo-inverse/)
  })

  test('the inverse of the identity is the identity', () => {
    const eye = identity(4)
    assert.ok(!isMatrixError(eye))
    const inverted = invert(eye)
    assert.ok(!isMatrixError(inverted))
    assert.equal(matrixToText(inverted.inverse), matrixToText(eye))
  })

  test('a matrix with fractional entries inverts exactly', () => {
    const inverted = invert(m([[r(1, 2), ZERO], [ZERO, r(1, 3)]]))
    assert.ok(!isMatrixError(inverted))
    assert.equal(rationalToText(inverted.inverse.values[0][0]), '2')
    assert.equal(rationalToText(inverted.inverse.values[1][1]), '3')
  })
})

describe('systems', () => {
  test('a unique solution is found exactly', () => {
    // 2x + y = 5, x - y = 1 -> x = 2, y = 1.
    const solved = solveSystem(m([[2, 1], [1, -1]]), [r(5), r(1)])
    assert.ok(!isMatrixError(solved))
    assert.equal(solved.kind, 'unique')
    assert.deepEqual(solved.particular?.map(rationalToText), ['2', '1'])
    assert.match(solved.describe, /exactly one solution/)
  })

  test('an inconsistent system has no solution, and least squares is named as the other question', () => {
    // x + y = 1 and x + y = 2 cannot both hold.
    const solved = solveSystem(m([[1, 1], [1, 1]]), [r(1), r(2)])
    assert.ok(!isMatrixError(solved))
    assert.equal(solved.kind, 'none')
    assert.equal(solved.particular, null)
    assert.match(solved.describe, /least-squares sense is a different question/)
  })

  test('an underdetermined system gives the whole family, not one member of it', () => {
    // x + y + z = 3 has two free variables.
    const solved = solveSystem(m([[1, 1, 1]]), [r(3)])
    assert.ok(!isMatrixError(solved))
    assert.equal(solved.kind, 'infinite')
    assert.equal(solved.freeVariables.length, 2)
    assert.equal(solved.nullSpace.length, 2)
    assert.match(solved.describe, /Every solution is the particular one plus/)
  })

  test('the null-space vectors really are in the null space', () => {
    const a = m([[1, 2, 3], [4, 5, 6]])
    const solved = solveSystem(a, [ZERO, ZERO])
    assert.ok(!isMatrixError(solved))
    for (const vector of solved.nullSpace) {
      const column = exactMatrix(vector.map((one) => [one]))
      assert.ok(!isMatrixError(column))
      const product = multiplyMatrices(a, column)
      assert.ok(!isMatrixError(product))
      assert.ok(product.values.every((row) => row.every(isZero)), 'a null-space vector did not map to zero')
    }
  })

  test('the particular solution really solves the system', () => {
    const a = m([[2, 1, -1], [-3, -1, 2], [-2, 1, 2]])
    const b = [r(8), r(-11), r(-3)]
    const solved = solveSystem(a, b)
    assert.ok(!isMatrixError(solved))
    assert.equal(solved.kind, 'unique')
    const column = exactMatrix((solved.particular as Rational[]).map((one) => [one]))
    assert.ok(!isMatrixError(column))
    const product = multiplyMatrices(a, column)
    assert.ok(!isMatrixError(product))
    product.values.forEach((row, i) => {
      assert.ok(isZero(subtractRational(row[0], b[i])), `row ${i} did not match`)
    })
  })

  test('a mismatched right-hand side is refused', () => {
    assert.ok(isMatrixError(solveSystem(m([[1, 1]]), [ONE, ONE])))
  })
})

describe('subspaces', () => {
  test('rank and nullity add to the number of columns', () => {
    const spaces = subspacesOf(m([[1, 2, 3], [4, 5, 6], [5, 7, 9]]))
    assert.equal(spaces.rank + spaces.nullity, 3)
    assert.match(spaces.describe, /they always do/)
  })

  test('the column space basis comes from the original columns, not the reduced ones', () => {
    const a = m([[1, 2], [3, 6]])
    const spaces = subspacesOf(a)
    // The first column is [1,3]; the reduced first column would be [1,0], which spans a different line.
    assert.deepEqual(spaces.columnSpace[0].map(rationalToText), ['1', '3'])
    assert.match(spaces.describe, /elimination changes the column space/)
  })

  test('a full-rank square matrix has a trivial null space', () => {
    const spaces = subspacesOf(m([[1, 0], [0, 1]]))
    assert.equal(spaces.nullSpace.length, 0)
    assert.equal(spaces.nullity, 0)
  })

  test('the left null space is the null space of the transpose', () => {
    const spaces = subspacesOf(m([[1, 2], [2, 4]]))
    assert.equal(spaces.leftNullSpace.length, 1)
  })
})

describe('independence and bases', () => {
  test('independent vectors are reported as independent', () => {
    const result = independence([[r(1), r(0)], [r(0), r(1)]])
    assert.ok(!isMatrixError(result))
    assert.equal(result.independent, true)
    assert.equal(result.combination, null)
  })

  test('dependent vectors come with the combination that shows it', () => {
    const result = independence([[r(1), r(2)], [r(2), r(4)]])
    assert.ok(!isMatrixError(result))
    assert.equal(result.independent, false)
    assert.ok(result.combination)
    assert.match(result.describe, /gives the zero vector/)
  })

  test('the right count of independent vectors is a basis', () => {
    const result = isBasis([[r(1), r(0)], [r(1), r(1)]], 2)
    assert.ok(!isMatrixError(result))
    assert.equal(result.basis, true)
    assert.match(result.describe, /spanning follows/)
  })

  test('too few vectors cannot span, and too many cannot be independent', () => {
    const few = isBasis([[r(1), r(0)]], 2)
    assert.ok(!isMatrixError(few))
    assert.equal(few.basis, false)
    assert.match(few.describe, /too few to span/)

    const many = isBasis([[r(1), r(0)], [r(0), r(1)], [r(1), r(1)]], 2)
    assert.ok(!isMatrixError(many))
    assert.match(many.describe, /too many to be independent/)
  })
})

describe('LU', () => {
  test('L times U reproduces the permuted matrix', () => {
    const a = num([[4, 3], [6, 3]])
    const lu = luDecompose(a)
    assert.ok(!isMatrixError(lu))
    for (let r2 = 0; r2 < 2; r2++) {
      for (let c = 0; c < 2; c++) {
        let sum = 0
        for (let k = 0; k < 2; k++) sum += lu.lower.values[r2][k] * lu.upper.values[k][c]
        assert.ok(Math.abs(sum - a.values[lu.permutation[r2]][c]) < 1e-10, `entry ${r2},${c}`)
      }
    }
  })

  test('the permutation is part of the answer, and the note says so', () => {
    const lu = luDecompose(num([[0, 1], [1, 0]]))
    assert.ok(!isMatrixError(lu))
    assert.equal(lu.swaps, 1)
    assert.ok(lu.notes.some((one) => /PA = LU rather than A = LU/.test(one)))
  })

  test('the determinant from LU matches the exact one', () => {
    const lu = luDecompose(num([[6, 1, 1], [4, -2, 5], [2, 8, 7]]))
    assert.ok(!isMatrixError(lu))
    assert.ok(Math.abs(lu.determinant + 306) < 1e-9)
  })

  test('a singular matrix is refused, naming the column', () => {
    const lu = luDecompose(num([[1, 2], [2, 4]]))
    assert.ok(isMatrixError(lu))
    assert.match(lu.message, /Column 2/)
  })
})

describe('QR', () => {
  test('Q has orthonormal columns and QR reproduces the matrix', () => {
    const a = num([[1, 1], [1, 0], [0, 1]])
    const qr = qrDecompose(a)
    assert.ok(!isMatrixError(qr))
    assert.ok(qr.orthogonalityError < 1e-12, `${qr.orthogonalityError}`)
    for (let r2 = 0; r2 < 3; r2++) {
      for (let c = 0; c < 2; c++) {
        let sum = 0
        for (let k = 0; k < 2; k++) sum += qr.q.values[r2][k] * qr.r.values[k][c]
        assert.ok(Math.abs(sum - a.values[r2][c]) < 1e-10, `entry ${r2},${c}`)
      }
    }
  })

  test('the orthogonality error is reported rather than promised away', () => {
    const qr = qrDecompose(num([[1, 0], [0, 1]]))
    assert.ok(!isMatrixError(qr))
    assert.ok(qr.notes.some((one) => /orthonormal to within/.test(one)))
  })

  test('dependent columns are refused, naming the column', () => {
    const qr = qrDecompose(num([[1, 2], [2, 4]]))
    assert.ok(isMatrixError(qr))
    assert.match(qr.message, /Column 2 is a combination/)
  })

  test('more columns than rows is refused', () => {
    assert.ok(isMatrixError(qrDecompose(num([[1, 2, 3]]))))
  })
})

describe('Cholesky', () => {
  test('a symmetric positive-definite matrix factorises, and L times L-transpose gives it back', () => {
    const a = num([[4, 12, -16], [12, 37, -43], [-16, -43, 98]])
    const result = cholesky(a)
    assert.ok(!isMatrixError(result))
    for (let r2 = 0; r2 < 3; r2++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0
        for (let k = 0; k < 3; k++) sum += result.lower.values[r2][k] * result.lower.values[c][k]
        assert.ok(Math.abs(sum - a.values[r2][c]) < 1e-9, `entry ${r2},${c}`)
      }
    }
  })

  test('a matrix that is not symmetric is refused, naming the two entries', () => {
    const result = cholesky(num([[1, 2], [3, 4]]))
    assert.ok(isMatrixError(result))
    assert.match(result.message, /\(1,2\) is 2 and \(2,1\) is 3/)
  })

  test('a matrix that is not positive definite is refused rather than filled with NaN', () => {
    const result = cholesky(num([[1, 2], [2, 1]]))
    assert.ok(isMatrixError(result))
    assert.equal(result.error, 'not-positive-definite')
    assert.match(result.message, /square root of/)
  })

  test('the checks are stated as having been done', () => {
    const result = cholesky(num([[2, 0], [0, 3]]))
    assert.ok(!isMatrixError(result))
    assert.ok(result.notes.some((one) => /checked rather than assumed/.test(one)))
  })
})

describe('eigenvalues', () => {
  test('a diagonal matrix has its diagonal as its eigenvalues', () => {
    const result = eigenSymmetric(num([[3, 0], [0, 1]]))
    assert.ok(!isMatrixError(result))
    assert.deepEqual(result.values.map((one) => Math.round(one)), [3, 1])
  })

  test('a known symmetric case comes out right', () => {
    // [[2,1],[1,2]] has eigenvalues 3 and 1.
    const result = eigenSymmetric(num([[2, 1], [1, 2]]))
    assert.ok(!isMatrixError(result))
    assert.ok(Math.abs(result.values[0] - 3) < 1e-9)
    assert.ok(Math.abs(result.values[1] - 1) < 1e-9)
  })

  test('the eigenvectors satisfy A v = lambda v, and the residual is reported', () => {
    const result = eigenSymmetric(num([[4, 1], [1, 3]]))
    assert.ok(!isMatrixError(result))
    assert.ok(Math.max(...result.residuals) < 1e-9)
    assert.ok(result.notes.some((one) => /That is the check, not a promise/.test(one)))
  })

  test('a matrix that is not symmetric is refused, and says why real answers would be wrong', () => {
    const result = eigenSymmetric(num([[0, -1], [1, 0]]))
    assert.ok(isMatrixError(result))
    assert.match(result.message, /can have complex eigenvalues/)
  })
})

describe('SVD', () => {
  test('singular values are never negative and come out largest first', () => {
    const result = svd(num([[3, 0], [0, -2]]))
    assert.ok(!isMatrixError(result))
    assert.ok(result.singularValues.every((one) => one >= 0))
    assert.ok(Math.abs(result.singularValues[0] - 3) < 1e-9)
    assert.ok(Math.abs(result.singularValues[1] - 2) < 1e-9)
  })

  test('the numeric rank comes with the tolerance it used, because the tolerance decides it', () => {
    const result = svd(num([[1, 2], [2, 4]]))
    assert.ok(!isMatrixError(result))
    assert.equal(result.rank, 1)
    assert.ok(result.tolerance > 0)
    assert.ok(result.notes.some((one) => /moving it moves the rank/.test(one)))
  })

  test('a singular matrix has an infinite condition number and says so', () => {
    const result = svd(num([[1, 2], [2, 4]]))
    assert.ok(!isMatrixError(result))
    assert.equal(result.conditionNumber, Number.POSITIVE_INFINITY)
    assert.ok(result.notes.some((one) => /condition number is infinite/.test(one)))
  })

  test('the caveat about going through A-transpose-A is stated rather than hidden', () => {
    const result = svd(num([[1, 0], [0, 1]]))
    assert.ok(!isMatrixError(result))
    assert.ok(result.notes.some((one) => /squares the condition number/.test(one)))
  })

  test('a badly conditioned matrix reports how many digits are lost', () => {
    const result = svd(num([[1, 0], [0, 1e-12]]))
    assert.ok(!isMatrixError(result))
    assert.ok(result.notes.some((one) => /digits of accuracy/.test(one)))
  })
})

describe('least squares', () => {
  test('an overdetermined system gets the best fit, with the residual reported', () => {
    // Fitting y = a + bx to (1,1), (2,2), (3,2) exactly is impossible.
    const a = num([[1, 1], [1, 2], [1, 3]])
    const result = leastSquares(a, [1, 2, 2])
    assert.ok(!isMatrixError(result))
    assert.equal(result.exact, false)
    assert.ok(result.residualNorm > 0)
    // The known best fit is intercept 2/3, slope 1/2.
    assert.ok(Math.abs(result.solution[0] - 2 / 3) < 1e-9)
    assert.ok(Math.abs(result.solution[1] - 0.5) < 1e-9)
  })

  test('a system with an exact solution has a residual of zero and says so', () => {
    const result = leastSquares(num([[1, 0], [0, 1]]), [3, 4])
    assert.ok(!isMatrixError(result))
    assert.equal(result.exact, true)
    assert.ok(result.notes.some((one) => /the best fit is it/.test(one)))
  })

  test('the method is stated, because the normal equations would lose digits', () => {
    const result = leastSquares(num([[1, 1], [1, 2], [1, 3]]), [1, 2, 2])
    assert.ok(!isMatrixError(result))
    assert.ok(result.notes.some((one) => /rather than the normal equations/.test(one)))
  })

  test('an underdetermined system is refused, because it has no single best fit', () => {
    const result = leastSquares(num([[1, 1, 1]]), [3])
    assert.ok(isMatrixError(result))
    assert.match(result.message, /infinitely many exact solutions/)
  })

  test('dependent columns are refused rather than given one of several answers', () => {
    const result = leastSquares(num([[1, 2], [2, 4], [3, 6]]), [1, 2, 3])
    assert.ok(isMatrixError(result))
    assert.match(result.message, /several different solutions give the same minimum residual/)
  })
})

describe('Gram-Schmidt and projection', () => {
  test('the result is orthonormal', () => {
    const result = gramSchmidt([[1, 1, 0], [1, 0, 1]])
    assert.ok(!isMatrixError(result))
    assert.equal(result.vectors.length, 2)
    assert.ok(result.orthogonalityError < 1e-12)
  })

  test('a dependent vector is dropped and reported, not silently kept as noise', () => {
    const result = gramSchmidt([[1, 0], [2, 0], [0, 1]])
    assert.ok(!isMatrixError(result))
    assert.deepEqual(result.dropped, [1])
    assert.equal(result.vectors.length, 2)
    assert.ok(result.notes.some((one) => /adds nothing to the span/.test(one)))
  })

  test('a short but independent vector is kept, because the test is relative', () => {
    const result = gramSchmidt([[1, 0], [0, 1e-8]])
    assert.ok(!isMatrixError(result))
    assert.equal(result.dropped.length, 0)
    assert.equal(result.vectors.length, 2)
  })

  test('a projection leaves a perpendicular remainder', () => {
    const result = projectOnto([3, 4], [[1, 0]])
    assert.ok(!isMatrixError(result))
    assert.deepEqual(result.projection, [3, 0])
    assert.deepEqual(result.perpendicular, [0, 4])
    assert.match(result.describe, /assumes the basis given is orthonormal/)
  })

  test('projecting onto nothing is refused', () => {
    assert.ok(isMatrixError(projectOnto([1, 2], [])))
  })
})

describe('exact and numeric are separate', () => {
  test('an exact matrix converts to a numeric one when a numeric method is wanted', () => {
    const converted = toNumeric(m([[r(1, 2), r(1, 3)]]))
    assert.ok(Math.abs(converted.values[0][0] - 0.5) < 1e-15)
    assert.ok(Math.abs(converted.values[0][1] - 1 / 3) < 1e-15)
  })

  test('the exact rank and the numeric rank agree on a clear case and are computed differently', () => {
    const exact = m([[1, 2], [2, 4]])
    const numeric = svd(toNumeric(exact))
    assert.ok(!isMatrixError(numeric))
    assert.equal(rankOf(exact), 1)
    assert.equal(numeric.rank, 1)
    // The exact one needs no tolerance; the numeric one reports the tolerance it used.
    assert.ok(numeric.tolerance >= 0)
  })
})

describe('the assumptions are stated', () => {
  test('the list names the distinctions the engine is built on', () => {
    assert.ok(MATRIX_ASSUMPTIONS.length >= 8)
    assert.ok(MATRIX_ASSUMPTIONS.some((one) => /Exact and numeric are separate/.test(one)))
    assert.ok(MATRIX_ASSUMPTIONS.some((one) => /elimination changes the column space/.test(one)))
    assert.ok(MATRIX_ASSUMPTIONS.some((one) => /different question/.test(one)))
  })
})
