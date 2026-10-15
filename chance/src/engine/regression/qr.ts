/**
 * Householder QR decomposition for least squares.
 *
 * The normal equations (XᵀX)β = Xᵀy are never formed here. Forming XᵀX
 * squares the condition number of X, so a design that loses 8 digits in
 * single-pass arithmetic loses 16 through the normal equations — on a
 * near-collinear design that is the whole mantissa. Householder QR works on X
 * directly: the orthogonal factor is perfectly conditioned, so the achievable
 * accuracy is governed by cond(X) rather than cond(X)².
 *
 * X (n × p, n ≥ p) is reduced to R (p × p, upper triangular) by p reflectors.
 * The reduced Q (n × p) is formed explicitly because the hat matrix diagonal
 * h_ii = Σ_j Q_ij² and the covariance factor R⁻¹ are both needed downstream.
 */
import { EngineError } from '../core/result';

export interface QR {
  /** Reduced orthogonal factor, n × p with QᵀQ = I. */
  Q: number[][];
  /** Upper-triangular factor, p × p. */
  R: number[][];
  /** Column index of each diagonal of R whose pivot collapsed (rank deficient). */
  dependentColumns: number[];
  rank: number;
  n: number;
  p: number;
}

/**
 * Householder QR. `tolScale` multiplies the per-column tolerance used to
 * declare a pivot numerically zero; the default (n · p · EPS relative to the
 * original column norm) is the usual LAPACK-style choice.
 */
export function householderQR(X: readonly (readonly number[])[]): QR {
  const n = X.length;
  if (n === 0) throw new EngineError('The design matrix has no rows.', 'shape');
  const p = X[0].length;
  if (p === 0) throw new EngineError('The design matrix has no columns.', 'shape');
  if (n < p) {
    throw new EngineError(
      `A least-squares fit needs at least as many observations as coefficients: received ${n} rows for ${p} columns.`,
      'insufficient',
    );
  }
  // Working copy of X; reflectors are applied in place.
  const A: number[][] = X.map((row) => {
    if (row.length !== p) throw new EngineError('The design matrix is ragged.', 'shape');
    return [...row];
  });
  const originalNorms: number[] = [];
  for (let j = 0; j < p; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += A[i][j] * A[i][j];
    originalNorms.push(Math.sqrt(s));
  }
  // Stored reflectors: v_k (length n, zero above row k) and beta_k = 2/(v·v).
  const vs: number[][] = [];
  const betas: number[] = [];
  const dependentColumns: number[] = [];
  const tolFactor = n * p * Number.EPSILON;

  for (let k = 0; k < p; k++) {
    let normSq = 0;
    for (let i = k; i < n; i++) normSq += A[i][k] * A[i][k];
    const norm = Math.sqrt(normSq);
    const tol = Math.max(originalNorms[k], 1) * tolFactor;
    if (norm <= tol) {
      // The column lies (numerically) in the span of the previous columns.
      dependentColumns.push(k);
      vs.push(new Array<number>(n).fill(0));
      betas.push(0);
      for (let i = k; i < n; i++) A[i][k] = 0;
      continue;
    }
    // Sign chosen away from A[k][k] to avoid cancellation.
    const alpha = A[k][k] >= 0 ? -norm : norm;
    const v = new Array<number>(n).fill(0);
    for (let i = k; i < n; i++) v[i] = A[i][k];
    v[k] -= alpha;
    let vv = 0;
    for (let i = k; i < n; i++) vv += v[i] * v[i];
    if (vv === 0) {
      dependentColumns.push(k);
      vs.push(new Array<number>(n).fill(0));
      betas.push(0);
      continue;
    }
    const beta = 2 / vv;
    vs.push(v);
    betas.push(beta);
    // Apply (I − beta·v·vᵀ) to the trailing submatrix.
    for (let j = k; j < p; j++) {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i] * A[i][j];
      const f = beta * dot;
      if (f === 0) continue;
      for (let i = k; i < n; i++) A[i][j] -= f * v[i];
    }
    A[k][k] = alpha;
    for (let i = k + 1; i < n; i++) A[i][k] = 0;
  }

  const R: number[][] = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (j >= i ? A[i][j] : 0)),
  );
  // Reduced Q: apply the reflectors in reverse to the first p unit vectors.
  const Q: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let k = p - 1; k >= 0; k--) {
    const beta = betas[k];
    if (beta === 0) continue;
    const v = vs[k];
    for (let j = 0; j < p; j++) {
      let dot = 0;
      for (let i = k; i < n; i++) dot += v[i] * Q[i][j];
      const f = beta * dot;
      if (f === 0) continue;
      for (let i = k; i < n; i++) Q[i][j] -= f * v[i];
    }
  }
  return { Q, R, dependentColumns, rank: p - dependentColumns.length, n, p };
}

/** Qᵀ·b for the reduced factor. */
export function qTranspose(qr: QR, b: readonly number[]): number[] {
  const out = new Array<number>(qr.p).fill(0);
  for (let j = 0; j < qr.p; j++) {
    let s = 0;
    for (let i = 0; i < qr.n; i++) s += qr.Q[i][j] * b[i];
    out[j] = s;
  }
  return out;
}

/** Solve R·x = rhs by back substitution. Throws if R is singular. */
export function backSolve(R: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const p = rhs.length;
  const x = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i--) {
    let s = rhs[i];
    for (let j = i + 1; j < p; j++) s -= R[i][j] * x[j];
    const d = R[i][i];
    if (d === 0 || !Number.isFinite(d)) {
      throw new EngineError('The triangular system is singular; the design matrix is rank deficient.', 'singular');
    }
    x[i] = s / d;
  }
  return x;
}

/** Solve Rᵀ·x = rhs by forward substitution. */
export function forwardSolveT(R: readonly (readonly number[])[], rhs: readonly number[]): number[] {
  const p = rhs.length;
  const x = new Array<number>(p).fill(0);
  for (let i = 0; i < p; i++) {
    let s = rhs[i];
    for (let j = 0; j < i; j++) s -= R[j][i] * x[j];
    const d = R[i][i];
    if (d === 0 || !Number.isFinite(d)) {
      throw new EngineError('The triangular system is singular; the design matrix is rank deficient.', 'singular');
    }
    x[i] = s / d;
  }
  return x;
}

/** Least-squares solution of X·β ≈ y given a full-rank QR of X. */
export function qrSolve(qr: QR, y: readonly number[]): number[] {
  if (qr.rank < qr.p) {
    throw new EngineError('The design matrix is rank deficient; the least-squares solution is not unique.', 'singular');
  }
  return backSolve(qr.R, qTranspose(qr, y));
}

/** Inverse of R (upper triangular), p × p. */
export function invertUpper(R: readonly (readonly number[])[]): number[][] {
  const p = R.length;
  const inv: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let col = 0; col < p; col++) {
    const e = new Array<number>(p).fill(0);
    e[col] = 1;
    const x = backSolve(R, e);
    for (let i = 0; i < p; i++) inv[i][col] = x[i];
  }
  return inv;
}

/**
 * (XᵀX)⁻¹ = R⁻¹·R⁻ᵀ, obtained from R alone. XᵀX itself is never formed, so
 * the covariance matrix inherits cond(X) rather than cond(X)².
 */
export function xtxInverseFromR(R: readonly (readonly number[])[]): number[][] {
  const Rinv = invertUpper(R);
  const p = R.length;
  const out: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i++) {
    for (let j = i; j < p; j++) {
      let s = 0;
      for (let k = Math.max(i, j); k < p; k++) s += Rinv[i][k] * Rinv[j][k];
      out[i][j] = s;
      out[j][i] = s;
    }
  }
  return out;
}

/**
 * Singular values of X, obtained as the square roots of the eigenvalues of
 * RᵀR by the cyclic Jacobi method. R is p × p and p is small, so this is
 * cheap; it is used only for reporting the condition number, which is why a
 * numerical eigen-solver is acceptable here (the fit itself never uses it).
 */
export function singularValues(R: readonly (readonly number[])[]): number[] {
  const p = R.length;
  const A: number[][] = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => {
      let s = 0;
      for (let k = 0; k < p; k++) s += R[k][i] * R[k][j];
      return s;
    }),
  );
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) off += A[i][j] * A[i][j];
    if (off <= 1e-30) break;
    for (let i = 0; i < p; i++) {
      for (let j = i + 1; j < p; j++) {
        if (Math.abs(A[i][j]) < 1e-300) continue;
        const theta = (A[j][j] - A[i][i]) / (2 * A[i][j]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < p; k++) {
          const aik = A[i][k];
          const ajk = A[j][k];
          A[i][k] = c * aik - s * ajk;
          A[j][k] = s * aik + c * ajk;
        }
        for (let k = 0; k < p; k++) {
          const aki = A[k][i];
          const akj = A[k][j];
          A[k][i] = c * aki - s * akj;
          A[k][j] = s * aki + c * akj;
        }
      }
    }
  }
  const vals: number[] = [];
  for (let i = 0; i < p; i++) vals.push(Math.sqrt(Math.max(0, A[i][i])));
  return vals.sort((a, b) => b - a);
}

/** Condition number of X (ratio of largest to smallest singular value). */
export function conditionNumber(R: readonly (readonly number[])[]): number {
  const sv = singularValues(R);
  const smin = sv[sv.length - 1];
  if (!(smin > 0)) return Infinity;
  return sv[0] / smin;
}
