/**
 * Sparse and subset approximations for Gaussian processes.
 *
 * ## Why these exist, and what they cost
 *
 * Exact GP inference is O(n³) in time and O(n²) in memory, so beyond about a
 * thousand points it is refused by `conditionGp` rather than attempted. The
 * approximations here trade exactness for an O(n·m²) cost with m inducing
 * points. Every one of them is labelled `numerical` and carries its BIAS
 * DIRECTION, because a sparse GP's uncertainty is wrong in a specific,
 * known way and reporting it as if it were exact would be dishonest:
 *
 *  - **Subset of data** fits an exact GP to m of the n points. It throws
 *    information away, so its predictive variance is too LARGE (conservative)
 *    and its mean is noisier. It is the only approximation here that is still
 *    an exact GP — of a smaller dataset.
 *  - **SoR** (subset of regressors, also "deterministic inducing
 *    conditional") replaces the covariance everywhere by the rank-m
 *    Q = K_fu·K_uu⁻¹·K_uf. Since Q ⪯ K, its predictive variance
 *    UNDERESTIMATES the truth — badly, and worst far from the inducing points,
 *    which is exactly where honest uncertainty matters most. It is included
 *    for comparison and is not recommended.
 *  - **FITC** (fully independent training conditional) keeps the exact
 *    diagonal, adding diag(K_ff − Q_ff) back, so its predictive variance is
 *    larger than SoR's and much closer to exact. Its known failure is on the
 *    other side: when hyperparameters are fitted under FITC, the heteroskedastic
 *    diagonal absorbs signal, and FITC UNDERESTIMATES the noise variance
 *    (Bauer, van der Wilk & Rasmussen, 2016). Fit hyperparameters on an exact
 *    subset and then apply FITC if you care about the noise estimate.
 */
import { EngineError } from '../core/result';
import { normalQuantile } from '../special/gamma';
import { Random } from '../random/rng';
import type { Matrix } from '../stats/linalg';
import { choleskySolve, choleskyWithJitter, logDetFromCholesky, solveLower } from './linalg';
import { buildKernel, type KernelSpec } from './kernels';
import { conditionGp, covarianceMatrix, predictGp, type GpModel, type GpPredictionSet } from './regression';
import { INTERVAL_LABEL, type GpPrediction, type JitterReport } from './types';

export type SparseMethod = 'subset-of-data' | 'sor' | 'fitc';

export interface SparseRequest {
  readonly X: readonly (readonly number[])[];
  readonly y: readonly number[];
  readonly kernel: KernelSpec;
  readonly kernelValues?: readonly number[];
  readonly noiseVariance: number;
  readonly method: SparseMethod;
  /** Number of inducing points / retained observations. */
  readonly inducingCount: number;
  /** Explicit inducing inputs; otherwise chosen by `selection`. */
  readonly inducingPoints?: readonly (readonly number[])[];
  readonly selection?: 'farthest-point' | 'random';
  readonly seed?: string;
}

export interface SparseModel {
  readonly method: SparseMethod;
  readonly inducingPoints: readonly (readonly number[])[];
  readonly n: number;
  readonly m: number;
  readonly biasDirection: string;
  readonly exactness: 'numerical';
  readonly limitations: readonly string[];
  /** Approximate log marginal likelihood, or null for subset-of-data (exact on its subset). */
  readonly approximateLogMarginalLikelihood: number | null;
  readonly jitter: JitterReport;
  /** Set for subset-of-data: the exact GP on the retained subset. */
  readonly exactSubset: GpModel | null;
  predict(Xstar: readonly (readonly number[])[], level?: number): GpPredictionSet;
}

/**
 * Farthest-point (max–min) selection: deterministic, space-filling and much
 * better than a random subset for covering the input domain.
 */
export function selectInducingPoints(
  X: readonly (readonly number[])[],
  m: number,
  method: 'farthest-point' | 'random',
  seed: string,
): number[][] {
  const n = X.length;
  if (!Number.isInteger(m) || m < 1) {
    throw new EngineError(`The number of inducing points must be a whole number of at least 1; received ${m}.`, 'range');
  }
  if (m > n) {
    throw new EngineError(
      `${m} inducing points were requested but there are only ${n} observations. A sparse approximation with more inducing points than data is pointless; use the exact GP.`,
      'range',
    );
  }
  if (method === 'random') {
    const rng = new Random(`gp:inducing:${seed}`);
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    return idx.slice(0, m).sort((a, b) => a - b).map((i) => Array.from(X[i]));
  }
  const chosen: number[] = [0];
  const dist = X.map((x) => squaredDistance(x, X[0]));
  while (chosen.length < m) {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < n; i++) {
      if (dist[i] > bestD) {
        bestD = dist[i];
        best = i;
      }
    }
    if (best < 0 || bestD <= 0) break;
    chosen.push(best);
    for (let i = 0; i < n; i++) dist[i] = Math.min(dist[i], squaredDistance(X[i], X[best]));
  }
  if (chosen.length < m) {
    throw new EngineError(
      `Only ${chosen.length} distinct inputs are available but ${m} inducing points were requested: the remaining candidates are exact duplicates of points already chosen.`,
      'range',
    );
  }
  return chosen.map((i) => Array.from(X[i]));
}

function squaredDistance(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return s;
}

export function fitSparseGp(req: SparseRequest): SparseModel {
  const X = req.X.map((r) => Array.from(r));
  const y = Array.from(req.y);
  const n = X.length;
  if (n === 0) throw new EngineError('The training set is empty, so there is nothing to approximate.', 'required');
  if (y.length !== n) throw new EngineError(`${n} inputs but ${y.length} targets.`, 'length');
  if (!(req.noiseVariance > 0) && req.method !== 'subset-of-data') {
    throw new EngineError(
      'The SoR and FITC approximations divide by the per-point noise, so they need a strictly positive noise variance. Noise-free interpolation must use the exact GP (possibly on a subset).',
      'range',
    );
  }
  const d = X[0].length;
  const inducing = req.inducingPoints
    ? req.inducingPoints.map((r) => Array.from(r))
    : selectInducingPoints(X, req.inducingCount, req.selection ?? 'farthest-point', req.seed ?? 'default');
  const m = inducing.length;
  const k = buildKernel(req.kernel, d, req.kernelValues);

  if (req.method === 'subset-of-data') {
    const keys = new Set(inducing.map((p) => p.join(',')));
    const idx = X.map((x, i) => (keys.has(x.join(',')) ? i : -1)).filter((i) => i >= 0);
    const model = conditionGp({
      X: idx.map((i) => X[i]),
      y: idx.map((i) => y[i]),
      kernel: req.kernel,
      kernelValues: req.kernelValues,
      noiseVariance: req.noiseVariance,
    });
    return {
      method: 'subset-of-data',
      inducingPoints: inducing,
      n,
      m: idx.length,
      biasDirection:
        `Predictive variance errs UPWARD (too wide): ${n - idx.length} of ${n} observations were discarded, so the ` +
        'model knows less than the exact GP does. The mean is noisier but the uncertainty is conservative.',
      exactness: 'numerical',
      limitations: [
        'This is an exact GP on a subset, so it is exact for the subset and an approximation only to the full-data posterior.',
        'The discarded observations are not used at all: any structure only they show is lost.',
      ],
      approximateLogMarginalLikelihood: model.logMarginalLikelihood,
      jitter: model.jitter,
      exactSubset: model,
      predict(Xstar, level) {
        const set = predictGp(model, Xstar, { level });
        return {
          ...set,
          notes: [
            ...set.notes,
            `Subset of data: ${idx.length} of ${n} observations retained. The predictive variance is conservative.`,
          ],
        };
      },
    };
  }

  const Kuu = covarianceMatrix(k, inducing);
  const uu = choleskyWithJitter(Kuu);
  const Kfu = covarianceMatrix(k, X, inducing); // n×m
  // Lam = L_uu⁻¹·K_uf (m×n), so Q_ff = Lamᵀ·Lam.
  const Lam: Matrix = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const col = solveLower(uu.L, Kfu[i]);
    for (let a = 0; a < m; a++) Lam[a][i] = col[a];
  }
  const diagK = X.map((x) => k.k(x, x));
  const D = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let q = 0;
    for (let a = 0; a < m; a++) q += Lam[a][i] * Lam[a][i];
    const correction = req.method === 'fitc' ? Math.max(diagK[i] - q, 0) : 0;
    D[i] = correction + req.noiseVariance;
    if (!(D[i] > 0)) {
      throw new EngineError(
        `The effective noise for observation ${i} came out as ${D[i]}, which cannot be inverted. Increase the noise variance.`,
        'numerical',
      );
    }
  }
  // A = K_uu + K_uf·D⁻¹·K_fu.
  const A: Matrix = Kuu.map((row) => [...row]);
  for (let a = 0; a < m; a++) {
    for (let b = 0; b <= a; b++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (Kfu[i][a] * Kfu[i][b]) / D[i];
      A[a][b] += s;
      if (b !== a) A[b][a] += s;
    }
  }
  const aa = choleskyWithJitter(A);
  const rhs = new Array<number>(m).fill(0);
  for (let a = 0; a < m; a++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += (Kfu[i][a] * y[i]) / D[i];
    rhs[a] = s;
  }
  const weights = choleskySolve(aa.L, rhs); // A⁻¹K_uf D⁻¹ y

  // Approximate log marginal likelihood of the N(0, Q_ff + D) model:
  // log|Q+D| = log|A| − log|K_uu| + Σ log Dᵢ, and the quadratic form follows
  // from the matrix-inversion lemma. No inverse is formed.
  const logDet = logDetFromCholesky(aa.L) - logDetFromCholesky(uu.L) + D.reduce((s, v) => s + Math.log(v), 0);
  let quad = 0;
  for (let i = 0; i < n; i++) quad += (y[i] * y[i]) / D[i];
  let correction = 0;
  for (let a = 0; a < m; a++) correction += rhs[a] * weights[a];
  const lml = -0.5 * (quad - correction) - 0.5 * logDet - (n / 2) * Math.log(2 * Math.PI);

  const isFitc = req.method === 'fitc';
  const jitter: JitterReport = uu.jitter.needed ? uu.jitter : aa.jitter;
  return {
    method: req.method,
    inducingPoints: inducing,
    n,
    m,
    biasDirection: isFitc
      ? 'Predictive variance is close to exact (the exact diagonal is retained), but FITC UNDERESTIMATES the noise ' +
        'variance when hyperparameters are fitted under it: the heteroskedastic diagonal absorbs signal that belongs ' +
        'to the noise term. Fit the hyperparameters on an exact subset if the noise estimate matters.'
      : 'Predictive variance errs DOWNWARD (too narrow, over-confident): SoR replaces K by the rank-' +
        `${m} approximation Q ⪯ K everywhere, so the uncertainty it reports is smaller than the truth, and most so ` +
        'far from the inducing points. Not recommended; FITC is strictly better behaved.',
    exactness: 'numerical',
    limitations: [
      `Rank-${m} approximation to an n = ${n} covariance: the posterior is not the exact posterior and the difference is not bounded here.`,
      'The inducing points were chosen by a space-filling heuristic, not optimised. Optimising them would change the answer.',
      isFitc
        ? 'FITC’s fitted noise variance is biased downward; its predictive mean is usually good.'
        : 'SoR’s predictive variance is biased downward, which is the dangerous direction for a model whose purpose is honest uncertainty.',
    ],
    approximateLogMarginalLikelihood: lml,
    jitter,
    exactSubset: null,
    predict(Xstar, level = 0.95) {
      const z = normalQuantile(0.5 + level / 2);
      const predictions: GpPrediction[] = Xstar.map((xs) => {
        const ksu = inducing.map((u) => k.k(xs, u));
        let mean = 0;
        for (let a = 0; a < m; a++) mean += ksu[a] * weights[a];
        const va = solveLower(aa.L, ksu);
        let varA = 0;
        for (let a = 0; a < m; a++) varA += va[a] * va[a];
        let latent = varA;
        if (isFitc) {
          const vu = solveLower(uu.L, ksu);
          let q = 0;
          for (let a = 0; a < m; a++) q += vu[a] * vu[a];
          latent = Math.max(k.k(xs, xs) - q, 0) + varA;
        }
        const predictive = latent + req.noiseVariance;
        return {
          x: xs,
          mean,
          latentVariance: latent,
          latentSd: Math.sqrt(latent),
          latentInterval: {
            kind: 'latent-credible',
            level,
            lower: mean - z * Math.sqrt(latent),
            upper: mean + z * Math.sqrt(latent),
            label: INTERVAL_LABEL['latent-credible'],
          },
          predictiveVariance: predictive,
          predictiveSd: Math.sqrt(predictive),
          predictiveInterval: {
            kind: 'predictive',
            level,
            lower: mean - z * Math.sqrt(predictive),
            upper: mean + z * Math.sqrt(predictive),
            label: INTERVAL_LABEL.predictive,
          },
          noiseVariance: req.noiseVariance,
        };
      });
      return {
        predictions,
        exactness: 'numerical',
        jitter,
        warnings: [
          `These are ${isFitc ? 'FITC' : 'SoR'} approximate predictions, NOT exact GP predictions. ` +
            (isFitc
              ? 'The variance is close to exact; the fitted noise variance is biased downward.'
              : 'The variance is biased DOWNWARD: this model is over-confident.'),
        ],
        notes: [
          INTERVAL_LABEL['latent-credible'],
          INTERVAL_LABEL.predictive,
          `Approximation: ${req.method} with ${m} inducing points. The `.concat(
            'exactness of the numbers is numerical, not exact, despite the closed-form look of the formulas.',
          ),
        ],
      };
    },
  };
}
