/**
 * Small dense linear algebra used by correlation handling and Markov chains.
 * Matrices are plain arrays of rows.
 */

import { EngineError } from '../core/result';

export type Matrix = number[][];

/**
 * Cholesky decomposition A = L·Lᵀ for a symmetric positive-definite matrix.
 * Returns ok: false (rather than NaNs) when A is not positive definite, which
 * is how inconsistent correlation matrices are detected.
 */
export function choleskyWithCheck(a: Matrix): { ok: true; L: Matrix } | { ok: false; L: Matrix } {
  const n = a.length;
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        // A tiny positive tolerance keeps exactly-singular matrices (|ρ| = 1) out.
        if (!(s > 1e-12)) return { ok: false, L };
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return { ok: true, L };
}

export function matVec(a: Matrix, v: ArrayLike<number>): number[] {
  return a.map((row) => {
    let s = 0;
    for (let j = 0; j < row.length; j++) s += row[j] * v[j];
    return s;
  });
}

/** Row-vector times matrix: result_j = Σ_i v_i · A_ij. */
export function vecMat(v: ArrayLike<number>, a: Matrix): number[] {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const out = new Array<number>(m).fill(0);
  for (let i = 0; i < n; i++) {
    const vi = v[i];
    if (vi === 0) continue;
    for (let j = 0; j < m; j++) out[j] += vi * a[i][j];
  }
  return out;
}

export function matMul(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0].length;
  const k = b.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      const aip = a[i][p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j++) out[i][j] += aip * b[p][j];
    }
  }
  return out;
}

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/**
 * Matrix power by repeated squaring (exact for integer exponents ≥ 0).
 *
 * The halving uses `Math.floor(e / 2)` rather than `e >>>= 1`. The bitwise
 * form coerces its operand to a uint32, so every exponent of 2^32 or more was
 * silently reduced modulo 2^32: `matPow(P, 2 ** 32)` returned the identity
 * matrix, and `matPow(P, 2 ** 32 + 1)` returned P. Both are wrong answers
 * returned with no indication that anything had happened.
 */
export function matPow(a: Matrix, k: number): Matrix {
  if (!Number.isInteger(k) || k < 0) {
    throw new EngineError(`A matrix power needs a whole exponent of 0 or more; received ${k}.`, 'integer');
  }
  if (!Number.isSafeInteger(k)) {
    throw new EngineError(
      `An exponent of ${k} is beyond the range of exactly representable integers, so the result could not be trusted.`,
      'range',
    );
  }
  let result = identity(a.length);
  let base = a.map((r) => [...r]);
  let e = k;
  while (e > 0) {
    if (e % 2 === 1) result = matMul(result, base);
    base = matMul(base, base);
    e = Math.floor(e / 2);
  }
  return result;
}

/**
 * Solve A·x = b by Gaussian elimination with partial pivoting.
 * Returns null when the matrix is singular to working precision.
 */
export function solve(a: Matrix, b: number[]): number[] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    if (Math.abs(m[pivot][col]) < 1e-14) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const p = m[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}
