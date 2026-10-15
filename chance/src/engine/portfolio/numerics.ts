/**
 * Numerical helpers used only by the portfolio module: Gauss–Legendre nodes for
 * tail integrals of quantile functions, a Jacobi eigensolver (so a covariance
 * matrix that is not positive definite can be refused while *naming* the
 * offending eigenvalue), exact discrete convolution, and the Euclidean
 * projection onto {Σw = 1, lo ≤ w ≤ hi} used by the constrained optimisers.
 *
 * Nothing here is specific to risk; it is kept local because the shared
 * `stats/linalg.ts` deliberately stays small.
 */
import { EngineError } from '../core/result';
import { incompleteGamma } from '../special/gamma';
import type { Matrix } from '../stats/linalg';

/** Gauss–Legendre nodes and weights on (0, 1). Exact for polynomials of degree < 2n. */
export function gaussLegendreUnit(n: number): { nodes: number[]; weights: number[] } {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('Quadrature order must be a positive whole number.', 'range');
  const nodes = new Array<number>(n).fill(0);
  const weights = new Array<number>(n).fill(0);
  const m = (n + 1) >> 1;
  for (let i = 0; i < m; i++) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      // Legendre P_n and its derivative by the standard recurrence.
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    const w = 2 / ((1 - x * x) * dp * dp);
    // Map [-1, 1] → (0, 1).
    nodes[i] = 0.5 * (1 - x);
    nodes[n - 1 - i] = 0.5 * (1 + x);
    weights[i] = 0.5 * w;
    weights[n - 1 - i] = 0.5 * w;
  }
  return { nodes, weights };
}

export interface SymmetricEigen {
  /** Eigenvalues in ascending order. */
  values: number[];
  /** Column j of `vectors` is the eigenvector for `values[j]`. */
  vectors: Matrix;
}

/** Cyclic Jacobi eigendecomposition of a symmetric matrix. */
export function jacobiEigen(a: Matrix, maxSweeps = 100): SymmetricEigen {
  const n = a.length;
  const m: Matrix = a.map((row) => [...row]);
  const v: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    if (off <= 1e-30) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(m[p][q]) < 1e-300) continue;
        const theta = (m[q][q] - m[p][p]) / (2 * m[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = m[k][p];
          const mkq = m[k][q];
          m[k][p] = c * mkp - s * mkq;
          m[k][q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = m[p][k];
          const mqk = m[q][k];
          m[p][k] = c * mpk - s * mqk;
          m[q][k] = s * mpk + c * mqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => m[i][i] - m[j][j]);
  return {
    values: order.map((i) => m[i][i]),
    vectors: Array.from({ length: n }, (_, r) => order.map((i) => v[r][i])),
  };
}

export interface CovarianceCheck {
  n: number;
  symmetric: boolean;
  eigenvalues: number[];
  smallestEigenvalue: number;
  conditionNumber: number;
  positiveDefinite: boolean;
}

/**
 * Validate a covariance matrix. Throws an `EngineError` naming the offending
 * eigenvalue when the matrix is not positive definite — never silently
 * regularises it.
 */
export function checkCovariance(sigma: Matrix, label = 'covariance matrix'): CovarianceCheck {
  const n = sigma.length;
  if (n === 0) throw new EngineError(`The ${label} is empty.`, 'required');
  for (const row of sigma) {
    if (row.length !== n) throw new EngineError(`The ${label} must be square; it has ${n} rows but a row of length ${row.length}.`, 'shape');
    for (const x of row) if (!Number.isFinite(x)) throw new EngineError(`Every entry of the ${label} must be a finite number.`, 'finite');
  }
  let maxAsym = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) maxAsym = Math.max(maxAsym, Math.abs(sigma[i][j] - sigma[j][i]));
  const scale = Math.max(1e-300, Math.max(...sigma.map((r, i) => Math.abs(r[i]))));
  if (maxAsym > 1e-9 * scale) {
    throw new EngineError(`The ${label} is not symmetric: entries differ by up to ${maxAsym.toExponential(3)} across the diagonal.`, 'shape');
  }
  const symmetrised: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => 0.5 * (sigma[i][j] + sigma[j][i])));
  const { values } = jacobiEigen(symmetrised);
  const smallest = values[0];
  const largest = values[n - 1];
  const tol = 1e-12 * Math.max(1, Math.abs(largest));
  const pd = smallest > tol;
  if (!pd) {
    throw new EngineError(
      `The ${label} is not positive definite: its smallest eigenvalue is ${smallest.toExponential(6)} (largest ${largest.toExponential(6)}). ` +
        `A portfolio variance computed from it could be negative, so no risk figure is reported. Either correct the inputs or shrink the matrix (Ledoit–Wolf shrinkage is available in this module).`,
      'notPositiveDefinite',
    );
  }
  return { n, symmetric: true, eigenvalues: values, smallestEigenvalue: smallest, conditionNumber: largest / smallest, positiveDefinite: true };
}

/** In-place iterative radix-2 complex FFT (sign = -1 forward, +1 inverse). */
function fft(re: Float64Array, im: Float64Array, sign: number): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * Convolution of two probability vectors on a common lattice. Uses the direct
 * O(mn) sum for small inputs (exact up to rounding) and FFT above that.
 */
export function convolve(a: Float64Array, b: Float64Array): Float64Array {
  const outLen = a.length + b.length - 1;
  if (a.length * b.length <= 4e6) {
    const out = new Float64Array(outLen);
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      if (ai === 0) continue;
      for (let j = 0; j < b.length; j++) out[i + j] += ai * b[j];
    }
    return out;
  }
  let n = 1;
  while (n < outLen) n <<= 1;
  const ar = new Float64Array(n);
  const ai = new Float64Array(n);
  const br = new Float64Array(n);
  const bi = new Float64Array(n);
  ar.set(a);
  br.set(b);
  fft(ar, ai, -1);
  fft(br, bi, -1);
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const m = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r;
    ai[i] = m;
  }
  fft(ar, ai, 1);
  const out = new Float64Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = Math.max(0, ar[i] / n);
  return out;
}

/**
 * Euclidean projection of v onto {w : Σw = total, lo ≤ w ≤ hi}, by bisection on
 * the Lagrange multiplier. Refuses when the box cannot reach the budget.
 */
export function projectBudgetBox(v: number[], lo: number[], hi: number[], total = 1): number[] {
  const n = v.length;
  let sumLo = 0;
  let sumHi = 0;
  for (let i = 0; i < n; i++) {
    sumLo += lo[i];
    sumHi += hi[i];
  }
  if (sumLo > total + 1e-12 || sumHi < total - 1e-12) {
    throw new EngineError(
      `The weight bounds are infeasible: they allow a total between ${sumLo} and ${sumHi}, which does not include the required total of ${total}.`,
      'infeasible',
    );
  }
  const clampAll = (theta: number): number[] => v.map((vi, i) => Math.min(hi[i], Math.max(lo[i], vi - theta)));
  const sum = (theta: number): number => clampAll(theta).reduce((a, b) => a + b, 0);
  let left = Math.min(...v) - Math.max(...hi) - 1;
  let right = Math.max(...v) - Math.min(...lo) + 1;
  for (let it = 0; it < 200; it++) {
    const mid = 0.5 * (left + right);
    if (sum(mid) > total) left = mid;
    else right = mid;
  }
  return clampAll(0.5 * (left + right));
}

/** Upper tail of the chi-square distribution: P(χ²_df > x). */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0)) throw new EngineError('Degrees of freedom must be greater than 0.', 'range');
  if (x <= 0) return 1;
  return incompleteGamma(df / 2, x / 2).upper;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** wᵀ Σ w, computed symmetrically. */
export function quadraticForm(sigma: Matrix, w: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < sigma.length; i++) {
    const wi = w[i];
    if (wi === 0) continue;
    let row = 0;
    for (let j = 0; j < sigma.length; j++) row += sigma[i][j] * w[j];
    s += wi * row;
  }
  return s;
}
