/**
 * Dense matrix routines needed by the state-space filters.
 *
 * `stats/linalg.ts` supplies the shared primitives (matMul, matVec, solve,
 * identity, choleskyWithCheck, matPow) and is deliberately NOT modified here.
 * What filtering additionally needs, and what lives in this file, is:
 *
 *  - a Cholesky factorisation that reports WHICH pivot failed and by how much,
 *    because "this covariance stopped being positive definite" is the single
 *    most common silent failure of a Kalman filter and the message has to name
 *    the place;
 *  - symmetric eigenvalues (Jacobi rotations) for condition numbers and for
 *    telling the caller which eigenvalue went negative;
 *  - rank, for the observability and controllability tests;
 *  - multivariate normal log-density and sampling from a Cholesky factor.
 *
 * Every routine either returns a correct value or throws an `EngineError`.
 * None of them substitutes 0, NaN or a jittered covariance for a failure.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { identity, matMul, matVec, solve, type Matrix } from '../stats/linalg';

export type Mat = Matrix;
export type Vec = number[];

export { identity, matMul, matVec, solve };

export function zeros(n: number, m: number): Mat {
  return Array.from({ length: n }, () => new Array<number>(m).fill(0));
}

export function cloneMat(a: Mat): Mat {
  return a.map((r) => [...r]);
}

export function rows(a: Mat): number {
  return a.length;
}

export function cols(a: Mat): number {
  return a.length === 0 ? 0 : a[0].length;
}

export function transpose(a: Mat): Mat {
  const n = rows(a);
  const m = cols(a);
  const out = zeros(m, n);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) out[j][i] = a[i][j];
  return out;
}

export function matAdd(a: Mat, b: Mat): Mat {
  return a.map((row, i) => row.map((v, j) => v + b[i][j]));
}

export function matSub(a: Mat, b: Mat): Mat {
  return a.map((row, i) => row.map((v, j) => v - b[i][j]));
}

export function scaleMat(a: Mat, s: number): Mat {
  return a.map((row) => row.map((v) => v * s));
}

/** (A + Aᵀ)/2. Covariances are symmetric in exact arithmetic; this removes the
 * asymmetry that floating point accumulates, which otherwise makes a Cholesky
 * check fail for a reason that has nothing to do with definiteness. */
export function symmetrise(a: Mat): Mat {
  const n = rows(a);
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) out[i][j] = 0.5 * (a[i][j] + a[j][i]);
  }
  return out;
}

export function addVec(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v + b[i]);
}

export function subVec(a: Vec, b: Vec): Vec {
  return a.map((v, i) => v - b[i]);
}

export function scaleVec(a: Vec, s: number): Vec {
  return a.map((v) => v * s);
}

export function dot(a: Vec, b: Vec): number {
  const terms = a.map((v, i) => v * b[i]);
  return stableSum(terms);
}

/** a·bᵀ. */
export function outer(a: Vec, b: Vec): Mat {
  return a.map((ai) => b.map((bj) => ai * bj));
}

/** A·B·Aᵀ, kept symmetric. */
export function quadForm(a: Mat, b: Mat): Mat {
  return symmetrise(matMul(matMul(a, b), transpose(a)));
}

export interface CholeskyFailure {
  ok: false;
  /** Diagonal index whose pivot was not positive. */
  pivot: number;
  /** The non-positive pivot value encountered. */
  value: number;
}

export type CholeskyOutcome = { ok: true; L: Mat } | CholeskyFailure;

/**
 * Lower-triangular Cholesky factor, A = L·Lᵀ.
 *
 * The positivity test is RELATIVE to the matrix scale. An absolute threshold
 * (as in `choleskyWithCheck`) rejects legitimately tiny covariances — a filter
 * that has nearly converged on a well-measured state has variances of 1e-14
 * and is perfectly valid — and accepts catastrophic cancellation in a
 * large-scale problem. The tolerance used is `eps · n · max_i A_ii`.
 */
export function cholesky(a: Mat): CholeskyOutcome {
  const n = rows(a);
  if (n === 0 || cols(a) !== n) {
    throw new EngineError(`A Cholesky factorisation needs a square matrix; received ${n}×${cols(a)}.`, 'shape');
  }
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(a[i][i]));
  const tol = scale > 0 ? 8 * Number.EPSILON * n * scale : 0;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > tol)) return { ok: false, pivot: i, value: s };
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return { ok: true, L };
}

/** Cholesky factor or a refusal that names the failing pivot. */
export function choleskyOrThrow(a: Mat, label: string): Mat {
  const c = cholesky(symmetrise(a));
  if (c.ok) return c.L;
  const eigs = symmetricEigenvalues(symmetrise(a));
  const minEig = eigs[0];
  throw new EngineError(
    `${label} is not positive definite: Cholesky pivot ${c.pivot} came out as ${c.value.toExponential(3)} ` +
      `(its smallest eigenvalue is ${minEig.toExponential(3)}). A covariance that has lost positive definiteness ` +
      'makes every subsequent gain, interval and likelihood meaningless, so the run is refused rather than continued.',
    'not-positive-definite',
  );
}

/** Solve L·x = b for lower-triangular L. */
export function forwardSubstitute(l: Mat, b: Vec): Vec {
  const n = rows(l);
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= l[i][k] * x[k];
    x[i] = s / l[i][i];
  }
  return x;
}

/** Solve Lᵀ·x = b for lower-triangular L. */
export function backSubstitute(l: Mat, b: Vec): Vec {
  const n = rows(l);
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let k = i + 1; k < n; k++) s -= l[k][i] * x[k];
    x[i] = s / l[i][i];
  }
  return x;
}

/** A⁻¹ for symmetric positive definite A, via its Cholesky factor. */
export function inverseSPD(a: Mat, label = 'The matrix'): Mat {
  const l = choleskyOrThrow(a, label);
  const n = rows(a);
  const inv = zeros(n, n);
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const y = forwardSubstitute(l, e);
    const x = backSubstitute(l, y);
    for (let i = 0; i < n; i++) inv[i][j] = x[i];
  }
  return symmetrise(inv);
}

/** Solve A·X = B for symmetric positive definite A. */
export function solveSPDMat(a: Mat, b: Mat, label = 'The matrix'): Mat {
  const l = choleskyOrThrow(a, label);
  const m = cols(b);
  const n = rows(a);
  const out = zeros(n, m);
  for (let j = 0; j < m; j++) {
    const colj = b.map((r) => r[j]);
    const x = backSubstitute(l, forwardSubstitute(l, colj));
    for (let i = 0; i < n; i++) out[i][j] = x[i];
  }
  return out;
}

/** Solve A·x = b for symmetric positive definite A. */
export function solveSPDVec(a: Mat, b: Vec, label = 'The matrix'): Vec {
  const l = choleskyOrThrow(a, label);
  return backSubstitute(l, forwardSubstitute(l, b));
}

/** log det A for symmetric positive definite A. */
export function logDetSPD(a: Mat, label = 'The matrix'): number {
  const l = choleskyOrThrow(a, label);
  let s = 0;
  for (let i = 0; i < rows(l); i++) s += Math.log(l[i][i]);
  return 2 * s;
}

/** General inverse by Gaussian elimination; throws when singular. */
export function inverseGeneral(a: Mat, label = 'The matrix'): Mat {
  const n = rows(a);
  if (cols(a) !== n) throw new EngineError(`${label} must be square to invert; it is ${n}×${cols(a)}.`, 'shape');
  const inv = zeros(n, n);
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const x = solve(a, e);
    if (x === null) throw new EngineError(`${label} is singular to working precision, so it cannot be inverted.`, 'singular');
    for (let i = 0; i < n; i++) inv[i][j] = x[i];
  }
  return inv;
}

/**
 * Eigenvalues of a symmetric matrix by the cyclic Jacobi method, ascending.
 *
 * Jacobi is used rather than a QR iteration because it is unconditionally
 * stable for symmetric matrices and gives the small eigenvalues to high
 * relative accuracy — which is exactly what is needed to report "eigenvalue 3
 * is −2.4e-17", the message a filter owes its caller when a covariance update
 * has gone wrong.
 */
export function symmetricEigenvalues(a0: Mat): number[] {
  const n = rows(a0);
  if (n === 0) return [];
  if (cols(a0) !== n) throw new EngineError(`Eigenvalues need a square matrix; received ${n}×${cols(a0)}.`, 'shape');
  const a = symmetrise(a0).map((r) => [...r]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off <= 1e-300) break;
    let converged = true;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) <= 1e-18 * (Math.abs(a[p][p]) + Math.abs(a[q][q]) + 1e-300)) continue;
        converged = false;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
    if (converged) break;
  }
  return Array.from({ length: n }, (_, i) => a[i][i]).sort((x, y) => x - y);
}

/** Spectral condition number of a symmetric matrix; Infinity when singular. */
export function conditionNumberSym(a: Mat): number {
  const e = symmetricEigenvalues(a).map(Math.abs).sort((x, y) => x - y);
  if (e.length === 0) return 1;
  const lo = e[0];
  const hi = e[e.length - 1];
  if (!(lo > 0)) return Infinity;
  return hi / lo;
}

/** Numerical rank by Gaussian elimination with partial pivoting and a relative tolerance. */
export function matrixRank(a: Mat, tol?: number): number {
  const n = rows(a);
  const m = cols(a);
  if (n === 0 || m === 0) return 0;
  const w = a.map((r) => [...r]);
  let scale = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) scale = Math.max(scale, Math.abs(w[i][j]));
  if (scale === 0) return 0;
  const threshold = tol ?? Math.max(n, m) * Number.EPSILON * scale * 16;
  let rank = 0;
  let row = 0;
  for (let col = 0; col < m && row < n; col++) {
    let piv = row;
    for (let r = row + 1; r < n; r++) if (Math.abs(w[r][col]) > Math.abs(w[piv][col])) piv = r;
    if (Math.abs(w[piv][col]) <= threshold) continue;
    [w[row], w[piv]] = [w[piv], w[row]];
    const p = w[row][col];
    for (let r = row + 1; r < n; r++) {
      const f = w[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c < m; c++) w[r][c] -= f * w[row][c];
    }
    rank++;
    row++;
  }
  return rank;
}

/** Stack matrices vertically. */
export function vstack(blocks: Mat[]): Mat {
  const out: Mat = [];
  for (const b of blocks) for (const r of b) out.push([...r]);
  return out;
}

/** Stack matrices horizontally. */
export function hstack(blocks: Mat[]): Mat {
  const n = rows(blocks[0]);
  const out: Mat = Array.from({ length: n }, () => [] as number[]);
  for (const b of blocks) {
    if (rows(b) !== n) throw new EngineError('Horizontal stacking needs matrices with equal row counts.', 'shape');
    for (let i = 0; i < n; i++) out[i].push(...b[i]);
  }
  return out;
}

/**
 * log N(x | mean, cov), computed from the Cholesky factor of cov.
 *
 * Refuses rather than returning −Infinity or NaN when cov is not positive
 * definite: a density value computed from a broken covariance is a plausible
 * number with no meaning, which is the thing this engine must never produce.
 */
export function mvnLogPdf(x: Vec, mean: Vec, cov: Mat, label = 'The covariance'): number {
  const k = x.length;
  if (mean.length !== k || rows(cov) !== k || cols(cov) !== k) {
    throw new EngineError(
      `A normal log-density needs matching shapes: the point has ${k} components, the mean ${mean.length}, ` +
        `and the covariance is ${rows(cov)}×${cols(cov)}.`,
      'shape',
    );
  }
  const l = choleskyOrThrow(cov, label);
  const z = forwardSubstitute(l, subVec(x, mean));
  let logDet = 0;
  for (let i = 0; i < k; i++) logDet += Math.log(l[i][i]);
  return -0.5 * (k * Math.LN2 + k * Math.log(Math.PI) + 2 * logDet + dot(z, z));
}

/** Draw from N(mean, cov) given a standard-normal generator. */
export function sampleMvn(mean: Vec, chol: Mat, normal: () => number): Vec {
  const k = mean.length;
  const z = Array.from({ length: k }, () => normal());
  const out = mean.slice();
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += chol[i][j] * z[j];
    out[i] += s;
  }
  return out;
}

/** Mean of a weighted set of vectors. Weights must sum to a positive value. */
export function weightedMean(points: Vec[], weights: number[]): Vec {
  const d = points[0].length;
  const out = new Array<number>(d).fill(0);
  for (let i = 0; i < points.length; i++) {
    const w = weights[i];
    if (w === 0) continue;
    for (let j = 0; j < d; j++) out[j] += w * points[i][j];
  }
  return out;
}

/** Weighted covariance about a supplied mean (no extra normalisation). */
export function weightedCovariance(points: Vec[], weights: number[], mean: Vec): Mat {
  const d = mean.length;
  const out = zeros(d, d);
  for (let i = 0; i < points.length; i++) {
    const w = weights[i];
    if (w === 0) continue;
    const dv = subVec(points[i], mean);
    for (let r = 0; r < d; r++) for (let c = 0; c < d; c++) out[r][c] += w * dv[r] * dv[c];
  }
  return symmetrise(out);
}

/** Weighted cross-covariance Σ w_i (a_i − ā)(b_i − b̄)ᵀ. */
export function weightedCrossCovariance(as: Vec[], bs: Vec[], weights: number[], aMean: Vec, bMean: Vec): Mat {
  const out = zeros(aMean.length, bMean.length);
  for (let i = 0; i < as.length; i++) {
    const w = weights[i];
    if (w === 0) continue;
    const da = subVec(as[i], aMean);
    const db = subVec(bs[i], bMean);
    for (let r = 0; r < da.length; r++) for (let c = 0; c < db.length; c++) out[r][c] += w * da[r] * db[c];
  }
  return out;
}

/**
 * Cholesky-style factor of a positive SEMI-definite matrix: A = L·Lᵀ with L
 * lower triangular, allowing exactly-zero pivots.
 *
 * Needed because process-noise covariances are routinely singular — a
 * constant-velocity tracker driven by acceleration noise has rank 1 Q in two
 * dimensions — and the square-root filter still needs a factor of it. A
 * NEGATIVE pivot is a genuine failure and is refused; a zero pivot is not.
 */
export function psdCholesky(a0: Mat, label = 'The matrix'): Mat {
  const a = symmetrise(a0);
  const n = rows(a);
  let scale = 0;
  for (let i = 0; i < n; i++) scale = Math.max(scale, Math.abs(a[i][i]));
  const tol = scale > 0 ? 1e-12 * n * scale : 0;
  const L = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s < -tol) {
          throw new EngineError(
            `${label} is not positive semi-definite: pivot ${i} came out as ${s.toExponential(3)}. ` +
              'A noise covariance with a negative direction is not a covariance.',
            'not-positive-definite',
          );
        }
        L[i][j] = s > tol ? Math.sqrt(s) : 0;
      } else {
        L[i][j] = L[j][j] > 0 ? s / L[j][j] : 0;
      }
    }
  }
  return L;
}

/**
 * Upper-triangular factor R from the QR decomposition of an m×n matrix
 * (m ≥ n), by Householder reflections. Only R is formed: the square-root
 * filter needs RᵀR = AᵀA and never the orthogonal factor.
 */
export function qrR(a0: Mat): Mat {
  const m = rows(a0);
  const n = cols(a0);
  if (m < n) throw new EngineError(`The QR factor needs at least as many rows as columns; received ${m}×${n}.`, 'shape');
  const a = a0.map((r) => [...r]);
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += a[i][k] * a[i][k];
    norm = Math.sqrt(norm);
    if (norm === 0) continue;
    const alpha = a[k][k] >= 0 ? -norm : norm;
    const v = new Array<number>(m).fill(0);
    for (let i = k; i < m; i++) v[i] = a[i][k];
    v[k] -= alpha;
    let vnorm2 = 0;
    for (let i = k; i < m; i++) vnorm2 += v[i] * v[i];
    if (vnorm2 === 0) continue;
    for (let j = k; j < n; j++) {
      let s = 0;
      for (let i = k; i < m; i++) s += v[i] * a[i][j];
      const f = (2 * s) / vnorm2;
      for (let i = k; i < m; i++) a[i][j] -= f * v[i];
    }
  }
  const r = zeros(n, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) r[i][j] = a[i][j];
    // Sign convention: make the diagonal non-negative so RᵀR is unchanged but
    // the factor is unique, which keeps results reproducible.
    if (r[i][i] < 0) for (let j = i; j < n; j++) r[i][j] = -r[i][j];
  }
  return r;
}
