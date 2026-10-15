/**
 * Posterior summaries from MCMC draws.
 *
 * Two kinds of interval are produced and kept apart on purpose:
 *  - the equal-tailed credible interval, which cuts equal posterior
 *    probability from each tail;
 *  - the highest density interval (HDI), the shortest interval holding the
 *    requested probability.
 * They answer different questions and coincide only for a symmetric
 * posterior. Neither is a confidence interval for an estimate: both are
 * statements about the posterior itself, while the Monte Carlo standard error
 * in `diagnostics.ts` is the sampling error of our estimate of it.
 */
import { EngineError } from '../core/result';
import { logSumExp } from '../core/numeric';
import { Random, Xoshiro128 } from '../random/rng';
import { mean as meanOf, quantileSorted, sortedCopy, variance } from '../stats/descriptive';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import type { Interval, LogDensity, ParameterSummary, PlotData } from './types';

export const SUMMARY_QUANTILES = [0.025, 0.05, 0.25, 0.5, 0.75, 0.95, 0.975] as const;

/**
 * Highest density interval from draws: slide a window holding ceil(level·n)
 * sorted draws and keep the narrowest. Valid for a unimodal posterior; for a
 * multimodal one the highest density *region* is a union of intervals and a
 * single interval overstates the support between the modes.
 */
export function highestDensityInterval(draws: ArrayLike<number>, level = 0.95): Interval {
  const n = draws.length;
  if (n < 2) throw new EngineError('A highest density interval needs at least 2 draws.', 'insufficient');
  if (!(level > 0 && level < 1)) throw new EngineError('The interval level must lie strictly between 0 and 1.', 'range');
  const sorted = sortedCopy(draws);
  const windowSize = Math.max(2, Math.ceil(level * n));
  if (windowSize >= n) return { lower: sorted[0], upper: sorted[n - 1], level };
  let bestLo = 0;
  let bestWidth = Infinity;
  for (let i = 0; i + windowSize - 1 < n; i++) {
    const width = sorted[i + windowSize - 1] - sorted[i];
    if (width < bestWidth) {
      bestWidth = width;
      bestLo = i;
    }
  }
  return { lower: sorted[bestLo], upper: sorted[bestLo + windowSize - 1], level };
}

export function equalTailedInterval(draws: ArrayLike<number>, level = 0.95): Interval {
  if (draws.length < 2) throw new EngineError('A credible interval needs at least 2 draws.', 'insufficient');
  const sorted = sortedCopy(draws);
  const alpha = (1 - level) / 2;
  return { lower: quantileSorted(sorted, alpha), upper: quantileSorted(sorted, 1 - alpha), level };
}

export function summariseParameter(parameter: string, draws: ArrayLike<number>, level = 0.95): ParameterSummary {
  if (draws.length < 2) {
    throw new EngineError(
      `Parameter "${parameter}" has ${draws.length} draw(s); at least 2 are needed to summarise it.`,
      'insufficient',
    );
  }
  const sorted = sortedCopy(draws);
  return {
    parameter,
    mean: meanOf(draws),
    sd: Math.sqrt(variance(draws, 1)),
    median: quantileSorted(sorted, 0.5),
    quantiles: SUMMARY_QUANTILES.map((p) => ({ p, value: quantileSorted(sorted, p) })),
    equalTailedInterval: equalTailedInterval(draws, level),
    highestDensityInterval: highestDensityInterval(draws, level),
    draws: draws.length,
  };
}

/** Plain arrays for the interface: trace, running mean, rank histogram, ACF. */
export function plotData(
  parameter: string,
  chains: readonly ArrayLike<number>[],
  autocorrelation: PlotData['autocorrelation'],
  maxPoints = 2000,
  rankBins = 20,
): PlotData {
  const trace: number[][] = [];
  const runningMean: number[][] = [];
  for (const c of chains) {
    const n = c.length;
    const stride = Math.max(1, Math.ceil(n / maxPoints));
    const t: number[] = [];
    const rm: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += c[i];
      if (i % stride === 0 || i === n - 1) {
        t.push(c[i]);
        rm.push(sum / (i + 1));
      }
    }
    trace.push(t);
    runningMean.push(rm);
  }

  // Rank plot: rank every draw within the pooled sample, then histogram the
  // ranks per chain. Well-mixed chains give flat, equal histograms.
  const pooled: { v: number; c: number }[] = [];
  for (let c = 0; c < chains.length; c++) for (let i = 0; i < chains[c].length; i++) pooled.push({ v: chains[c][i], c });
  pooled.sort((a, b) => a.v - b.v);
  const N = pooled.length;
  const counts: number[][] = chains.map(() => new Array<number>(rankBins).fill(0));
  for (let r = 0; r < N; r++) {
    const bin = Math.min(rankBins - 1, Math.floor((r / N) * rankBins));
    counts[pooled[r].c][bin]++;
  }
  const binCentres: number[] = [];
  for (let b = 0; b < rankBins; b++) binCentres.push(((b + 0.5) / rankBins) * N);

  return { parameter, trace, runningMean, rankHistogram: { binCentres, counts }, autocorrelation };
}

/**
 * Posterior predictive draws: for each posterior draw of the parameters,
 * generate one replicate from the model's sampling distribution. The spread
 * includes both parameter uncertainty and sampling variability, which is what
 * makes it wider than a credible interval for a parameter.
 */
export function posteriorPredictive(
  posteriorDraws: readonly (readonly number[])[],
  generate: (parameters: readonly number[], rng: Random) => number,
  seed: string,
  count?: number,
): Float64Array {
  if (!posteriorDraws.length) {
    throw new EngineError('Posterior predictive sampling needs at least one posterior draw.', 'insufficient');
  }
  const n = count ?? posteriorDraws.length;
  if (!Number.isInteger(n) || n < 1) {
    throw new EngineError('The number of posterior predictive draws must be a whole number of at least 1.', 'range');
  }
  const rng = new Random(new Xoshiro128(seed));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const params = posteriorDraws[rng.int(0, posteriorDraws.length - 1)];
    const v = generate(params, rng);
    if (!Number.isFinite(v)) {
      throw new EngineError(
        `The posterior predictive generator returned ${String(v)} at draw ${i}. It must return a finite number.`,
        'nonfinite',
      );
    }
    out[i] = v;
  }
  return out;
}

export interface MarginalLikelihoodResult {
  readonly logMarginalLikelihood: number;
  readonly method: 'bridge-sampling' | 'importance-sampling';
  /** Relative standard error of the normalising constant, when estimable. */
  readonly relativeStandardError: number;
  readonly iterations: number;
  readonly warnings: string[];
}

interface GaussianProposal {
  readonly mean: number[];
  readonly L: Matrix;
  readonly logDet: number;
  readonly d: number;
}

function fitGaussian(draws: readonly (readonly number[])[]): GaussianProposal {
  const n = draws.length;
  const d = draws[0].length;
  const mean = new Array<number>(d).fill(0);
  for (const x of draws) for (let i = 0; i < d; i++) mean[i] += x[i] / n;
  const cov: Matrix = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const x of draws) {
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) cov[i][j] += ((x[i] - mean[i]) * (x[j] - mean[j])) / (n - 1);
    }
  }
  for (let i = 0; i < d; i++) cov[i][i] += 1e-10;
  const chol = choleskyWithCheck(cov);
  if (!chol.ok) {
    throw new EngineError(
      'The posterior draws have a singular covariance, so no Gaussian proposal can be fitted for the marginal likelihood. This usually means the chain barely moved.',
      'not-positive-definite',
    );
  }
  let logDet = 0;
  for (let i = 0; i < d; i++) logDet += 2 * Math.log(chol.L[i][i]);
  return { mean, L: chol.L, logDet, d };
}

function proposalLogPdf(p: GaussianProposal, x: readonly number[]): number {
  // Solve L·y = x - mean by forward substitution; quadratic form is yᵀy.
  const y = new Array<number>(p.d).fill(0);
  for (let i = 0; i < p.d; i++) {
    let s = x[i] - p.mean[i];
    for (let j = 0; j < i; j++) s -= p.L[i][j] * y[j];
    y[i] = s / p.L[i][i];
  }
  let q = 0;
  for (let i = 0; i < p.d; i++) q += y[i] * y[i];
  return -0.5 * (p.d * Math.LN2 + p.d * Math.log(Math.PI) + p.logDet + q);
}

function proposalDraw(p: GaussianProposal, rng: Random): number[] {
  const z = new Array<number>(p.d);
  for (let i = 0; i < p.d; i++) z[i] = rng.normal();
  const x = new Array<number>(p.d).fill(0);
  for (let i = 0; i < p.d; i++) {
    let s = 0;
    for (let j = 0; j <= i; j++) s += p.L[i][j] * z[j];
    x[i] = p.mean[i] + s;
  }
  return x;
}

/**
 * Marginal likelihood (model evidence) by bridge sampling (Meng & Wong 1996)
 * with a Gaussian proposal moment-matched to the posterior draws, falling
 * back to plain importance sampling.
 *
 * Read the warnings. Marginal likelihoods, and therefore Bayes factors, are
 * the least reliable quantity in this module: they depend on the *normalised*
 * prior, so an improper or merely vague prior makes the number arbitrary, and
 * the estimator itself is sensitive to the proposal's tails. A Bayes factor
 * from this function is an indication, not a measurement.
 */
export function marginalLikelihood(
  posteriorDraws: readonly (readonly number[])[],
  logDensity: LogDensity,
  seed: string,
  options: { readonly method?: 'bridge-sampling' | 'importance-sampling'; readonly proposalDraws?: number } = {},
): MarginalLikelihoodResult {
  if (posteriorDraws.length < 20) {
    throw new EngineError(
      `Estimating a marginal likelihood needs at least 20 posterior draws; ${posteriorDraws.length} were supplied.`,
      'insufficient',
    );
  }
  const warnings = [
    'Marginal likelihood and Bayes factor estimates are unreliable. They are defined only for proper, normalised priors, they change materially with a prior the posterior barely notices, and this estimator is sensitive to the fit of its Gaussian proposal. Treat the value as an order of magnitude, and never as a decisive test.',
  ];
  const proposal = fitGaussian(posteriorDraws);
  const rng = new Random(new Xoshiro128(seed));
  const n2 = options.proposalDraws ?? posteriorDraws.length;
  const method = options.method ?? 'bridge-sampling';

  // Importance sampling: Z = E_q[ exp(logp(x) - logq(x)) ].
  const isLogWeights: number[] = [];
  for (let i = 0; i < n2; i++) {
    const x = proposalDraw(proposal, rng);
    const lp = logDensity(x);
    if (!Number.isFinite(lp)) continue;
    isLogWeights.push(lp - proposalLogPdf(proposal, x));
  }
  if (isLogWeights.length < 10) {
    throw new EngineError(
      'The fitted proposal put almost all of its mass outside the support of the target, so the marginal likelihood cannot be estimated. The posterior is probably strongly non-Gaussian.',
      'insufficient',
    );
  }
  const logZis = logSumExp(isLogWeights) - Math.log(isLogWeights.length);

  if (method === 'importance-sampling') {
    const rse = relativeSeFromLogWeights(isLogWeights, logZis);
    if (rse > 0.2) {
      warnings.push(
        `The importance weights are extremely uneven (relative standard error ${(rse * 100).toFixed(0)}%). The estimate is dominated by a handful of draws.`,
      );
    }
    return {
      logMarginalLikelihood: logZis,
      method: 'importance-sampling',
      relativeStandardError: rse,
      iterations: 1,
      warnings,
    };
  }

  // Bridge sampling with the optimal geometric bridge, solved by the usual
  // fixed-point iteration on log r.
  const l1: number[] = []; // logp - logq at posterior draws
  for (const x of posteriorDraws) {
    const lp = logDensity(x);
    if (Number.isFinite(lp)) l1.push(lp - proposalLogPdf(proposal, x));
  }
  if (l1.length < 10) {
    throw new EngineError(
      'The target log-density is not finite at the posterior draws, so bridge sampling cannot proceed.',
      'nonfinite',
    );
  }
  const s1 = l1.length / (l1.length + isLogWeights.length);
  const s2 = isLogWeights.length / (l1.length + isLogWeights.length);
  let logR = logZis;
  let iterations = 0;
  for (let it = 0; it < 500; it++) {
    iterations++;
    // numerator: mean over proposal draws of l2 / (s1·exp(l2) + s2·exp(logR))
    const num: number[] = isLogWeights.map((l2) => l2 - logAddWeighted(s1, l2, s2, logR));
    const den: number[] = l1.map((l) => -logAddWeighted(s1, l, s2, logR));
    const next =
      logSumExp(num) - Math.log(num.length) - (logSumExp(den) - Math.log(den.length));
    if (!Number.isFinite(next)) {
      warnings.push('Bridge sampling did not produce a finite estimate; the importance sampling estimate is reported instead.');
      return {
        logMarginalLikelihood: logZis,
        method: 'importance-sampling',
        relativeStandardError: relativeSeFromLogWeights(isLogWeights, logZis),
        iterations,
        warnings,
      };
    }
    const delta = Math.abs(next - logR);
    logR = next;
    if (delta < 1e-10) break;
  }
  const rse = relativeSeFromLogWeights(isLogWeights, logR);
  if (rse > 0.2) {
    warnings.push(
      `The bridge weights are very uneven (relative standard error ${(rse * 100).toFixed(0)}%). Treat the estimate as indicative only.`,
    );
  }
  return { logMarginalLikelihood: logR, method: 'bridge-sampling', relativeStandardError: rse, iterations, warnings };
}

/** log(w1·exp(a) + w2·exp(b)) without overflow. */
function logAddWeighted(w1: number, a: number, w2: number, b: number): number {
  const x = Math.log(w1) + a;
  const y = Math.log(w2) + b;
  const m = Math.max(x, y);
  if (m === -Infinity) return -Infinity;
  return m + Math.log(Math.exp(x - m) + Math.exp(y - m));
}

function relativeSeFromLogWeights(logWeights: readonly number[], logZ: number): number {
  const n = logWeights.length;
  // Coefficient of variation of the normalised weights / sqrt(n).
  const centred = logWeights.map((l) => l - logZ);
  const m = Math.max(...centred);
  let s = 0;
  let s2 = 0;
  for (const c of centred) {
    const w = Math.exp(c - m);
    s += w;
    s2 += w * w;
  }
  const meanW = s / n;
  const varW = s2 / n - meanW * meanW;
  if (!(varW > 0) || !(meanW > 0)) return 0;
  return Math.sqrt(varW / n) / meanW;
}

/**
 * Bayes factor B10 = Z1 / Z0 on the log scale, with the same caveats as
 * `marginalLikelihood` — doubled, because the ratio multiplies both errors.
 */
export function logBayesFactor(a: MarginalLikelihoodResult, b: MarginalLikelihoodResult): {
  readonly logBayesFactor: number;
  readonly warnings: string[];
} {
  return {
    logBayesFactor: a.logMarginalLikelihood - b.logMarginalLikelihood,
    warnings: [
      ...a.warnings,
      ...b.warnings,
      'A Bayes factor inherits the error of both marginal likelihood estimates and both prior specifications. Do not read a factor near 1 (|log| below about 1) as evidence of anything.',
    ],
  };
}
