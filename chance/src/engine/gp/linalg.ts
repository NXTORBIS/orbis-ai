/**
 * Numerically careful linear algebra for Gaussian processes.
 *
 * Rules this file exists to enforce:
 *
 *  1. **No explicit matrix inverse is ever formed.** Every linear system is
 *     solved by forward and backward substitution against the Cholesky
 *     factor. Where a diagonal of K⁻¹ is genuinely needed (the closed-form
 *     leave-one-out formulas) it is assembled from triangular solves of unit
 *     vectors, which is numerically stable and never materialises K⁻¹.
 *  2. **No determinant is ever computed directly.** log|K| = 2·Σ log Lᵢᵢ.
 *  3. **Jitter is reported, never hidden.** Adding to the diagonal is adding
 *     assumed noise. A result that needed jitter is not the result for the
 *     model as specified, and the caller is told how much was added.
 *
 * `src/engine/stats/linalg.ts` supplies the shared primitives (matMul, matVec,
 * identity, solve, choleskyWithCheck); the triangular solves, the jitter
 * escalation and the L-BFGS optimiser live here because they are specific to
 * this module.
 */
import { EngineError } from '../core/result';
import type { Matrix } from '../stats/linalg';
import { GP_LIMITS, type JitterReport } from './types';

/** Solve L·x = b for lower-triangular L (forward substitution). */
export function solveLower(L: Matrix, b: readonly number[]): number[] {
  const n = L.length;
  const x = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    const row = L[i];
    for (let j = 0; j < i; j++) s -= row[j] * x[j];
    x[i] = s / row[i];
  }
  return x;
}

/** Solve Lᵀ·x = b for lower-triangular L (backward substitution). */
export function solveLowerTranspose(L: Matrix, b: readonly number[]): number[] {
  const n = L.length;
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= L[j][i] * x[j];
    x[i] = s / L[i][i];
  }
  return x;
}

/** Solve (L·Lᵀ)·x = b, i.e. apply K⁻¹ without ever forming it. */
export function choleskySolve(L: Matrix, b: readonly number[]): number[] {
  return solveLowerTranspose(L, solveLower(L, b));
}

/** Column-wise L⁻¹·B. */
export function solveLowerMatrix(L: Matrix, B: Matrix): Matrix {
  const m = B[0]?.length ?? 0;
  const cols: number[][] = [];
  for (let c = 0; c < m; c++) {
    cols.push(solveLower(L, B.map((row) => row[c])));
  }
  return B.map((_, i) => cols.map((col) => col[i]));
}

/** Column-wise (L·Lᵀ)⁻¹·B. */
export function choleskySolveMatrix(L: Matrix, B: Matrix): Matrix {
  const m = B[0]?.length ?? 0;
  const cols: number[][] = [];
  for (let c = 0; c < m; c++) {
    cols.push(choleskySolve(L, B.map((row) => row[c])));
  }
  return B.map((_, i) => cols.map((col) => col[i]));
}

/** log|K| = 2·Σ log Lᵢᵢ. The determinant itself is never formed. */
export function logDetFromCholesky(L: Matrix): number {
  let s = 0;
  for (let i = 0; i < L.length; i++) s += Math.log(L[i][i]);
  return 2 * s;
}

/**
 * diag(K⁻¹) from the Cholesky factor, as Σₖ (L⁻¹)ₖᵢ².
 *
 * Obtained from n forward substitutions against unit vectors: the inverse is
 * never assembled, only one column of L⁻¹ at a time.
 */
export function choleskyInverseDiagonal(L: Matrix): number[] {
  const n = L.length;
  const out = new Array<number>(n).fill(0);
  const e = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    e.fill(0);
    e[i] = 1;
    const z = solveLower(L, e);
    let s = 0;
    for (let k = i; k < n; k++) s += z[k] * z[k];
    out[i] = s;
  }
  return out;
}

/** trace(K⁻¹·M) without forming K⁻¹: solve K·V = M and sum diag(V). */
export function traceCholeskySolve(L: Matrix, M: Matrix): number {
  const n = L.length;
  let t = 0;
  for (let c = 0; c < n; c++) {
    const v = choleskySolve(L, M.map((row) => row[c]));
    t += v[c];
  }
  return t;
}

/** Plain lower Cholesky; null when the matrix is not positive definite. */
export function cholesky(a: Matrix): Matrix | null {
  const n = a.length;
  const L: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (!(s > 0)) return null;
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

export interface JitteredCholesky {
  readonly L: Matrix;
  readonly jitter: JitterReport;
}

/**
 * Cholesky factorisation with escalating jitter.
 *
 * A GP covariance matrix is singular to working precision whenever two inputs
 * are close or identical, which happens constantly in practice (repeated
 * measurements, grids, Bayesian-optimisation batches). The fix is a small
 * addition to the diagonal, and the honest treatment is to add the SMALLEST
 * one that works and to say what was added: jitter is assumed extra noise and
 * it widens the latent interval.
 *
 * Refuses, with the jitter values tried and the smallest eigenvalue of the
 * matrix, when even the largest jitter fails — that matrix is not a valid
 * covariance and no number is returned for it.
 */
export function choleskyWithJitter(
  a: Matrix,
  options: { readonly baseScale?: number; readonly maxRelativeJitter?: number } = {},
): JitteredCholesky {
  const n = a.length;
  if (n === 0) throw new EngineError('Cannot factorise an empty matrix.', 'required');
  let meanDiag = 0;
  for (let i = 0; i < n; i++) meanDiag += a[i][i];
  meanDiag /= n;
  const scale = options.baseScale ?? Math.max(Math.abs(meanDiag), 1e-12);
  const maxRel = options.maxRelativeJitter ?? 1e-2;

  const plain = cholesky(a);
  if (plain) {
    return {
      L: plain,
      jitter: {
        added: 0,
        attempts: [],
        needed: false,
        note: 'The covariance matrix factorised without jitter: the reported variances are those of the model as specified.',
      },
    };
  }
  const attempts: number[] = [];
  let j = scale * 1e-12;
  for (let step = 0; step < GP_LIMITS.maxJitterAttempts; step++) {
    attempts.push(j);
    const perturbed = a.map((row, i) => row.map((x, k) => (i === k ? x + j : x)));
    const L = cholesky(perturbed);
    if (L) {
      return {
        L,
        jitter: {
          added: j,
          attempts,
          needed: true,
          note:
            `The covariance matrix was singular to working precision, so ${j.toExponential(3)} was added to its diagonal ` +
            `(${(j / scale).toExponential(2)} of the mean diagonal) to restore positive definiteness. That jitter is extra ` +
            'assumed observation noise: the latent variances reported are slightly larger than those of the model as ' +
            'specified, and the fit is no longer the exact model fit. Near-duplicate inputs are the usual cause.',
        },
      };
    }
    j *= 10;
    if (j > scale * maxRel) break;
  }
  const smallest = smallestEigenvalue(a);
  throw new EngineError(
    `The covariance matrix is not positive definite and jitter did not fix it. Jitter values tried: ` +
      `${attempts.map((x) => x.toExponential(2)).join(', ')} (up to ${(maxRel * 100).toFixed(1)}% of the mean diagonal ` +
      `${scale.toExponential(3)}). Its smallest eigenvalue is ${smallest.toExponential(3)}. A matrix this far from ` +
      'positive definite is not a covariance matrix: check for a kernel parameter outside its valid range, a ' +
      'hand-supplied covariance, or contradictory duplicate inputs. No prediction is produced.',
    'not-positive-definite',
  );
}

/**
 * Eigenvalues of a symmetric matrix by the cyclic Jacobi method.
 *
 * Used for diagnostics only — to report HOW far from positive definite a
 * refused matrix is. It is O(n³) with a large constant and is never on the
 * inference path.
 */
export function symmetricEigenvalues(a: Matrix): number[] {
  const n = a.length;
  const m = a.map((row) => [...row]);
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += m[i][j] * m[i][j];
    if (off < 1e-24) break;
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
      }
    }
  }
  return Array.from({ length: n }, (_, i) => m[i][i]).sort((x, y) => x - y);
}

export function smallestEigenvalue(a: Matrix): number {
  return symmetricEigenvalues(a)[0];
}

/* ------------------------------------------------------------------ *
 * L-BFGS
 * ------------------------------------------------------------------ */

export interface OptimiserResult {
  readonly x: number[];
  readonly value: number;
  readonly gradient: number[];
  readonly iterations: number;
  readonly functionEvaluations: number;
  readonly converged: boolean;
  readonly reason: string;
  readonly gradientNorm: number;
}

export interface LbfgsOptions {
  readonly maxIterations?: number;
  readonly memory?: number;
  readonly gradientTolerance?: number;
  readonly valueTolerance?: number;
  readonly maxLineSearchSteps?: number;
  /** Hard box on each coordinate (the log-parameters), to keep steps sane. */
  readonly bounds?: readonly (readonly [number, number])[];
}

/**
 * L-BFGS with a backtracking line search satisfying the Armijo condition.
 *
 * MINIMISES `f`. The marginal-likelihood fit passes the negative log marginal
 * likelihood. Non-convergence is reported, not hidden: a fit that stopped
 * because it ran out of iterations is flagged so the caller can refuse.
 */
export function minimizeLbfgs(
  f: (x: readonly number[]) => { value: number; gradient: number[] },
  x0: readonly number[],
  options: LbfgsOptions = {},
): OptimiserResult {
  const maxIter = options.maxIterations ?? 200;
  const memory = options.memory ?? 10;
  const gTol = options.gradientTolerance ?? 1e-6;
  const vTol = options.valueTolerance ?? 1e-11;
  const maxLs = options.maxLineSearchSteps ?? 40;
  const bounds = options.bounds;
  const n = x0.length;

  const clampToBounds = (x: number[]): number[] => {
    if (!bounds) return x;
    return x.map((v, i) => {
      const b = bounds[i];
      if (!b) return v;
      return v < b[0] ? b[0] : v > b[1] ? b[1] : v;
    });
  };

  let x = clampToBounds(Array.from(x0));
  let evals = 0;
  const evaluate = (p: readonly number[]): { value: number; gradient: number[] } => {
    evals++;
    const r = f(p);
    if (!Number.isFinite(r.value)) {
      return { value: Number.POSITIVE_INFINITY, gradient: new Array<number>(n).fill(0) };
    }
    return r;
  };
  let { value, gradient } = evaluate(x);
  if (!Number.isFinite(value)) {
    return {
      x,
      value,
      gradient,
      iterations: 0,
      functionEvaluations: evals,
      converged: false,
      reason: 'The objective was not finite at the starting point, so no descent direction exists.',
      gradientNorm: Number.NaN,
    };
  }
  const sList: number[][] = [];
  const yList: number[][] = [];
  const rhoList: number[] = [];
  let iter = 0;
  let reason = 'Reached the iteration limit without meeting the gradient tolerance.';
  let converged = false;

  const norm = (v: readonly number[]): number => Math.sqrt(v.reduce((s, c) => s + c * c, 0));

  for (; iter < maxIter; iter++) {
    const gn = norm(gradient);
    if (gn <= gTol) {
      converged = true;
      reason = `The gradient norm fell to ${gn.toExponential(2)}, within the tolerance ${gTol.toExponential(1)}.`;
      break;
    }
    // Two-loop recursion for the L-BFGS direction.
    const q = gradient.map((g) => g);
    const alphas: number[] = [];
    for (let i = sList.length - 1; i >= 0; i--) {
      const a = rhoList[i] * dot(sList[i], q);
      alphas[i] = a;
      for (let k = 0; k < n; k++) q[k] -= a * yList[i][k];
    }
    let gammaScale = 1;
    if (sList.length > 0) {
      const last = sList.length - 1;
      const yy = dot(yList[last], yList[last]);
      if (yy > 0) gammaScale = dot(sList[last], yList[last]) / yy;
    }
    for (let k = 0; k < n; k++) q[k] *= gammaScale;
    for (let i = 0; i < sList.length; i++) {
      const b = rhoList[i] * dot(yList[i], q);
      for (let k = 0; k < n; k++) q[k] += (alphas[i] - b) * sList[i][k];
    }
    const direction = q.map((v) => -v);
    let slope = dot(direction, gradient);
    if (!(slope < 0)) {
      // The quasi-Newton direction is not a descent direction (curvature
      // information has gone stale): reset to steepest descent.
      sList.length = 0;
      yList.length = 0;
      rhoList.length = 0;
      for (let k = 0; k < n; k++) direction[k] = -gradient[k];
      slope = dot(direction, gradient);
    }
    let step = 1;
    let accepted = false;
    let nextX = x;
    let nextValue = value;
    let nextGrad = gradient;
    for (let ls = 0; ls < maxLs; ls++) {
      const trial = clampToBounds(x.map((v, i) => v + step * direction[i]));
      const r = evaluate(trial);
      if (Number.isFinite(r.value) && r.value <= value + 1e-4 * step * slope) {
        nextX = trial;
        nextValue = r.value;
        nextGrad = r.gradient;
        accepted = true;
        break;
      }
      step *= 0.5;
    }
    if (!accepted) {
      reason =
        `The line search failed after ${maxLs} backtracking steps at iteration ${iter}: no step along the descent ` +
        'direction reduced the objective. This usually means the objective is flat or the gradient is wrong.';
      break;
    }
    const s = nextX.map((v, i) => v - x[i]);
    const yv = nextGrad.map((g, i) => g - gradient[i]);
    const sy = dot(s, yv);
    if (sy > 1e-12) {
      sList.push(s);
      yList.push(yv);
      rhoList.push(1 / sy);
      if (sList.length > memory) {
        sList.shift();
        yList.shift();
        rhoList.shift();
      }
    }
    const improvement = value - nextValue;
    x = nextX;
    gradient = nextGrad;
    value = nextValue;
    if (improvement <= vTol * (Math.abs(value) + vTol)) {
      converged = true;
      reason = `The objective stopped improving (change ${improvement.toExponential(2)}) at iteration ${iter}.`;
      break;
    }
  }
  return {
    x,
    value,
    gradient,
    iterations: iter,
    functionEvaluations: evals,
    converged,
    reason,
    gradientNorm: norm(gradient),
  };
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
