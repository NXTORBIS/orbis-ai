/**
 * Tests for the predictive model comparison toolkit.
 *
 * Reference values are independent of the implementation: criterion
 * arithmetic is recomputed from its definition inside this file, leave-one-out
 * is computed in closed form for a conjugate normal model (and by brute-force
 * refitting elsewhere), marginal likelihoods are compared with the analytic
 * conjugate result, and the behavioural claims the module makes (in-sample fit
 * always improves, Bayes factors are driven by the prior, posterior predictive
 * p-values are conservative, the boundary chi-square is wrong) are each
 * demonstrated by simulation rather than asserted.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import { solve, type Matrix } from '../stats/linalg';
import {
  analyticEvidence,
  bayesFactor,
  bayesFactorPriorSensitivity,
  compareElpd,
  compareModels,
  criterionWeights,
  dic,
  elpdDifference,
  estimateEvidence,
  exactLeaveOneOut,
  informationCriteria,
  kFoldCrossValidation,
  likelihoodRatioTest,
  posteriorModelProbabilities,
  posteriorPredictiveCheck,
  psisLoo,
  pseudoBmaWeights,
  savageDickey,
  scoreTest,
  stackingWeights,
  vuongTest,
  averagePredictiveDraws,
  bayesianModelAverage,
  scoreBinaryForecast,
  scoreDistributionalForecast,
  waic,
  waldTest,
  type ElpdEstimate,
} from './index';

/* ================================================================== */
/* Shared helpers — all independent of the module under test          */
/* ================================================================== */

const LOG_2PI = Math.log(2 * Math.PI);

function normalLogPdf(y: number, mu: number, sd: number): number {
  const z = (y - mu) / sd;
  return -0.5 * LOG_2PI - Math.log(sd) - 0.5 * z * z;
}

/** Conjugate normal model: y_i ~ N(mu, 1), mu ~ N(0, tau^2). */
interface Conjugate {
  readonly y: number[];
  readonly tau: number;
}

function posterior(c: Conjugate, exclude = -1): { mean: number; variance: number; n: number } {
  let s = 0;
  let n = 0;
  for (let i = 0; i < c.y.length; i++) {
    if (i === exclude) continue;
    s += c.y[i];
    n++;
  }
  const precision = n + 1 / (c.tau * c.tau);
  return { mean: s / precision, variance: 1 / precision, n };
}

/** Closed-form leave-one-out log predictive density for the conjugate model. */
function exactLooPointwise(c: Conjugate): number[] {
  return c.y.map((yi, i) => {
    const p = posterior(c, i);
    return normalLogPdf(yi, p.mean, Math.sqrt(1 + p.variance));
  });
}

/** Posterior draws of mu, drawn analytically (no MCMC error beyond sampling). */
function posteriorDraws(c: Conjugate, draws: number, seed: string): number[] {
  const p = posterior(c);
  const rng = new Random(seed);
  const sd = Math.sqrt(p.variance);
  return Array.from({ length: draws }, () => p.mean + sd * rng.normal());
}

/** Pointwise log-likelihood matrix [draw][observation] for the conjugate model. */
function conjugateLogLik(c: Conjugate, mus: readonly number[]): number[][] {
  return mus.map((mu) => c.y.map((yi) => normalLogPdf(yi, mu, 1)));
}

/** Analytic log marginal likelihood of the conjugate model with prior sd tau. */
function analyticLogEvidence(y: readonly number[], tau: number): number {
  const n = y.length;
  let s = 0;
  let ss = 0;
  for (const v of y) {
    s += v;
    ss += v * v;
  }
  const t2 = tau * tau;
  return -0.5 * n * LOG_2PI - 0.5 * Math.log(1 + n * t2) - 0.5 * (ss - (t2 * s * s) / (1 + n * t2));
}

/** Analytic log marginal likelihood of the point-null model mu = 0. */
function analyticLogEvidenceNull(y: readonly number[]): number {
  let ss = 0;
  for (const v of y) ss += v * v;
  return -0.5 * y.length * LOG_2PI - 0.5 * ss;
}

function normalSample(n: number, mean: number, sd: number, seed: string): number[] {
  const rng = new Random(seed);
  return Array.from({ length: n }, () => mean + sd * rng.normal());
}

/** Ordinary least squares by the normal equations, for the polynomial tests. */
function ols(x: readonly number[], y: readonly number[], order: number): number[] | null {
  const p = order + 1;
  const xtx: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = Array.from({ length: p }, (_, j) => Math.pow(x[i], j));
    for (let a = 0; a < p; a++) {
      xty[a] += row[a] * y[i];
      for (let b = 0; b < p; b++) xtx[a][b] += row[a] * row[b];
    }
  }
  return solve(xtx, xty);
}

function dot(a: readonly number[], b: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Least squares for an arbitrary design matrix, by the normal equations. */
function leastSquares(x: readonly (readonly number[])[], y: readonly number[]): number[] {
  const p = x[0].length;
  const xtx: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (let i = 0; i < x.length; i++) {
    for (let a = 0; a < p; a++) {
      xty[a] += x[i][a] * y[i];
      for (let b = 0; b < p; b++) xtx[a][b] += x[i][a] * x[i][b];
    }
  }
  const beta = solve(xtx, xty);
  if (beta === null) throw new EngineError('singular design matrix in the test fixture', 'singular');
  return beta;
}

function polyPredict(beta: readonly number[], x: number): number {
  let s = 0;
  for (let j = 0; j < beta.length; j++) s += beta[j] * Math.pow(x, j);
  return s;
}

function residualSumOfSquares(x: readonly number[], y: readonly number[], beta: readonly number[]): number {
  let rss = 0;
  for (let i = 0; i < x.length; i++) {
    const e = y[i] - polyPredict(beta, x[i]);
    rss += e * e;
  }
  return rss;
}

/** Gaussian maximised log-likelihood of a least squares fit (sigma profiled out). */
function gaussianLogLik(n: number, rss: number): number {
  const sigma2 = rss / n;
  return -0.5 * n * (LOG_2PI + Math.log(sigma2) + 1);
}

/** Abramowitz-Stegun 7.1.26 error function, for an independent CRPS reference. */
function erfApprox(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

function fakeEstimate(name: string, pointwise: readonly number[]): ElpdEstimate {
  const n = pointwise.length;
  const elpd = pointwise.reduce((a, b) => a + b, 0);
  const m = elpd / n;
  let v = 0;
  for (const p of pointwise) v += (p - m) * (p - m);
  return {
    name,
    method: 'psis-loo',
    elpd,
    standardError: Math.sqrt((n * v) / (n - 1)),
    pointwise: [...pointwise],
    effectiveParameters: null,
    informationCriterion: -2 * elpd,
    exactness: 'empirical',
    warnings: [],
  };
}

/* ================================================================== */

describe('information criteria arithmetic', () => {
  it('matches AIC = 2k − 2lnL, AICc and BIC recomputed from the definitions', () => {
    const cases = [
      { logLikelihood: -120.5, parameters: 3, observations: 40 },
      { logLikelihood: -58.25, parameters: 7, observations: 20 },
      { logLikelihood: 14.75, parameters: 1, observations: 500 },
    ];
    for (const c of cases) {
      const got = informationCriteria({ name: 'm', ...c });
      // Reference values computed here, from the textbook formulae only.
      const aic = 2 * c.parameters - 2 * c.logLikelihood;
      const aicc = aic + (2 * c.parameters * (c.parameters + 1)) / (c.observations - c.parameters - 1);
      const bic = c.parameters * Math.log(c.observations) - 2 * c.logLikelihood;
      expect(got.aic).toBe(aic); // identical arithmetic, so exact equality is the right assertion
      expect(got.aicc).toBe(aicc);
      expect(got.bic).toBe(bic);
    }
  });

  it('refuses AICc when n − k − 1 is not positive, instead of returning a number', () => {
    const got = informationCriteria({ name: 'overparameterised', logLikelihood: -3, parameters: 10, observations: 11 });
    expect(got.aicc).toBeNull();
    expect(() => criterionWeights([{ name: 'a', logLikelihood: -3, parameters: 10, observations: 11 }], 'aicc')).toThrow(
      /AICc is undefined/,
    );
  });

  it('produces Akaike weights that sum to exactly 1 and match exp(−Δ/2) normalised', () => {
    const inputs = [
      { name: 'a', logLikelihood: -100, parameters: 2, observations: 50 },
      { name: 'b', logLikelihood: -98, parameters: 4, observations: 50 },
      { name: 'c', logLikelihood: -97.5, parameters: 6, observations: 50 },
      { name: 'd', logLikelihood: -300, parameters: 3, observations: 50 }, // far enough to underflow a naive sum
    ];
    const ranking = criterionWeights(inputs, 'aic');
    const sum = ranking.weights.reduce((a, w) => a + w.weight, 0);
    expect(sum).toBe(1);
    // Independent reference: AIC values and weights computed here by hand.
    const aics = inputs.map((i) => 2 * i.parameters - 2 * i.logLikelihood);
    const best = Math.min(...aics);
    const raw = aics.map((a) => Math.exp(-(a - best) / 2));
    const total = raw.reduce((a, b) => a + b, 0);
    ranking.weights.forEach((w, k) => {
      expect(w.delta).toBeCloseTo(aics[k] - best, 12);
      expect(w.weight).toBeCloseTo(raw[k] / total, 12);
    });
    expect(ranking.weights[3].weight).toBeGreaterThanOrEqual(0); // no underflow to a negative or NaN
  });

  it('says plainly that a gap under about 2 is not a preference', () => {
    const ranking = criterionWeights(
      [
        { name: 'simple', logLikelihood: -100, parameters: 2, observations: 80 },
        { name: 'complex', logLikelihood: -99.5, parameters: 3, observations: 80 },
      ],
      'aic',
    );
    expect(ranking.indistinguishable).toBe(true);
    expect(ranking.statement).toMatch(/not a meaningful preference|cannot be separated/);
    expect(ranking.warnings.join(' ')).toMatch(/AIC estimates predictive loss/);
    expect(ranking.warnings.join(' ')).toMatch(/different questions/);
  });

  it('states that BIC approximates a marginal likelihood under a particular prior scaling', () => {
    const ranking = criterionWeights(
      [
        { name: 'a', logLikelihood: -100, parameters: 2, observations: 80 },
        { name: 'b', logLikelihood: -90, parameters: 6, observations: 80 },
      ],
      'bic',
    );
    expect(ranking.warnings.join(' ')).toMatch(/unit-information prior/);
    expect(ranking.warnings.join(' ')).toMatch(/not an estimate of predictive accuracy/);
  });
});

describe('DIC', () => {
  it('computes the plug-in effective parameter count and warns about its defects', () => {
    const c: Conjugate = { y: normalSample(30, 0.4, 1, 'dic-data'), tau: 5 };
    const mus = posteriorDraws(c, 2000, 'dic-draws');
    const totals = mus.map((mu) => c.y.reduce((a, yi) => a + normalLogPdf(yi, mu, 1), 0));
    const meanMu = mus.reduce((a, b) => a + b, 0) / mus.length;
    const atMean = c.y.reduce((a, yi) => a + normalLogPdf(yi, meanMu, 1), 0);
    const res = dic({ name: 'conjugate', logLikDraws: totals, logLikAtPosteriorMean: atMean });
    // One parameter is being estimated, so pD should be near 1 (near 0.5 for a
    // normal posterior with a known variance: D̄ − D(θ̄) = tr(I·Var) ≈ 1).
    expect(res.effectiveParameters).toBeGreaterThan(0.5);
    expect(res.effectiveParameters).toBeLessThan(1.6);
    // Independent reference for the identity DIC = D(θ̄) + 2·pD.
    const dBar = (-2 * totals.reduce((a, b) => a + b, 0)) / totals.length;
    expect(res.posteriorMeanDeviance).toBeCloseTo(dBar, 9);
    expect(res.dic).toBeCloseTo(-2 * atMean + 2 * (dBar - -2 * atMean), 9);
    expect(res.warnings.join(' ')).toMatch(/not invariant to reparameterisation/);
    expect(res.warnings.join(' ')).toMatch(/can be negative/);
  });

  it('can be negative for continuous data, and says so rather than hiding it', () => {
    // A tightly concentrated continuous density has log-likelihood > 0.
    const c: Conjugate = { y: normalSample(40, 0, 0.02, 'dic-neg'), tau: 5 };
    const rng = new Random('dic-neg-draws');
    const ybar = c.y.reduce((a, b) => a + b, 0) / c.y.length;
    const postSd = 0.02 / Math.sqrt(c.y.length);
    const mus = Array.from({ length: 500 }, () => ybar + postSd * rng.normal());
    const totals = mus.map((mu) => c.y.reduce((a, yi) => a + normalLogPdf(yi, mu, 0.02), 0));
    const meanMu = mus.reduce((a, b) => a + b, 0) / mus.length;
    const atMean = c.y.reduce((a, yi) => a + normalLogPdf(yi, meanMu, 0.02), 0);
    const res = dic({ name: 'tight', logLikDraws: totals, logLikAtPosteriorMean: atMean });
    expect(res.dic).toBeLessThan(0);
    expect(res.warnings.join(' ')).toMatch(/can be negative/);
  });

  it('refuses too few draws', () => {
    expect(() => dic({ name: 'x', logLikDraws: new Array<number>(10).fill(-5) })).toThrow(/at least 50 posterior draws/);
  });
});

describe('PSIS-LOO against exact leave-one-out', () => {
  const c: Conjugate = { y: normalSample(40, 0.5, 1, 'psis-well-behaved'), tau: 5 };
  const mus = posteriorDraws(c, 4000, 'psis-well-behaved-draws');
  const matrix = conjugateLogLik(c, mus);

  it('matches the closed-form exact LOO within the standard error it reports, with low Pareto k', () => {
    const psis = psisLoo('conjugate', matrix);
    const reference = exactLooPointwise(c); // closed form, computed in this file
    const exactElpd = reference.reduce((a, b) => a + b, 0);
    // The literal requirement: the estimate agrees with the truth inside its
    // own reported standard error.
    expect(Math.abs(psis.elpd - exactElpd)).toBeLessThan(psis.standardError);
    // And much more tightly than that, pointwise: PSIS error here is Monte
    // Carlo noise on 4000 draws, so 0.02 nats per observation is generous.
    psis.pointwise.forEach((v, i) => expect(Math.abs(v - reference[i])).toBeLessThan(0.02));
    expect(Math.max(...psis.diagnostics.paretoK)).toBeLessThan(0.7);
    expect(psis.diagnostics.bands.bad + psis.diagnostics.bands.veryBad).toBe(0);
    expect(psis.reliable).toBe(true);
    // The effective parameter count should be near 1 for a one-parameter model.
    expect(psis.effectiveParameters).toBeGreaterThan(0.3);
    expect(psis.effectiveParameters).toBeLessThan(2);
  });

  it('agrees with exact LOO computed by brute-force refitting through kFoldCrossValidation', () => {
    const psis = psisLoo('conjugate', matrix);
    const cv = exactLeaveOneOut('conjugate (brute force)', c.y.length, (_train, test) =>
      test.map((i) => {
        const p = posterior(c, i);
        return normalLogPdf(c.y[i], p.mean, Math.sqrt(1 + p.variance));
      }),
    );
    expect(cv.method).toBe('exact-loo');
    expect(cv.exactness).toBe('exact');
    expect(Math.abs(psis.elpd - cv.elpd)).toBeLessThan(0.3); // ~0.007 per observation
    // Pointwise, the approximation error is Monte Carlo noise on 4000 draws.
    psis.pointwise.forEach((v, i) => expect(Math.abs(v - cv.pointwise[i])).toBeLessThan(0.02));
  });

  it('REPORTS a high Pareto k for an extreme outlier instead of hiding it', () => {
    const base = normalSample(12, 0, 1, 'psis-outlier');
    const withOutlier: Conjugate = { y: [...base, 14], tau: 10 };
    const draws = posteriorDraws(withOutlier, 4000, 'psis-outlier-draws');
    const psis = psisLoo('with-outlier', conjugateLogLik(withOutlier, draws));
    const outlierIndex = withOutlier.y.length - 1;
    expect(psis.diagnostics.paretoK[outlierIndex]).toBeGreaterThan(0.7);
    expect(psis.reliable).toBe(false);
    expect(psis.diagnostics.unreliableObservations.map((u) => u.index)).toContain(outlierIndex);
    expect(psis.warnings.join(' ')).toMatch(new RegExp(`index ${outlierIndex}`));
    expect(psis.warnings.join(' ')).toMatch(/FAILED/);
    // The k bands are reported for every observation, not just the bad ones.
    const bands = psis.diagnostics.bands;
    expect(bands.good + bands.ok + bands.bad + bands.veryBad).toBe(withOutlier.y.length);
  });
});

describe('WAIC', () => {
  const c: Conjugate = { y: normalSample(40, 0.5, 1, 'psis-well-behaved'), tau: 5 };
  const mus = posteriorDraws(c, 4000, 'psis-well-behaved-draws');
  const matrix = conjugateLogLik(c, mus);

  it('agrees with exact LOO within its reported standard error', () => {
    const w = waic('conjugate', matrix);
    const exactElpd = exactLooPointwise(c).reduce((a, b) => a + b, 0);
    expect(Math.abs(w.elpd - exactElpd)).toBeLessThan(w.standardError);
    // WAIC's bias relative to exact LOO is O(1/n) here; 0.05 nats per
    // observation is a loose but meaningful bound on a 40-observation problem.
    expect(Math.abs(w.elpd - exactElpd) / c.y.length).toBeLessThan(0.05);
    expect(w.effectiveParameters).toBeGreaterThan(0.3);
    expect(w.effectiveParameters).toBeLessThan(2);
    expect(w.informationCriterion).toBeCloseTo(-2 * w.elpd, 12);
  });

  it('carries the standard error and the instruction to use the paired difference', () => {
    const w = waic('conjugate', matrix);
    expect(w.standardError).toBeGreaterThan(0);
    expect(w.exactness).toBe('empirical');
    expect(w.warnings.join(' ')).toMatch(/standard error of the paired DIFFERENCE/);
  });
});

describe('the standard error of a difference is not the difference of standard errors', () => {
  it('is smaller than the independent-models formula for correlated models, which is the whole point', () => {
    // Two models whose pointwise predictive accuracy is strongly correlated:
    // the same observations are hard for both. This is what two serious models
    // fitted to the same data always look like.
    const rng = new Random('paired-se');
    const n = 60;
    const shared: number[] = [];
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const hard = 2 * rng.normal(); // a per-observation difficulty, common to both
      shared.push(hard);
      a.push(-1.5 + hard + 0.1 * rng.normal());
      b.push(-1.9 + hard + 0.1 * rng.normal());
    }
    expect(shared.length).toBe(n);
    const d = elpdDifference(fakeEstimate('A', a), fakeEstimate('B', b));
    expect(d.better).toBe('A');
    // Independent reference for both formulae, computed here.
    const diffs = a.map((v, i) => v - b[i]);
    const dm = diffs.reduce((x, y) => x + y, 0) / n;
    const dv = diffs.reduce((x, y) => x + (y - dm) * (y - dm), 0) / (n - 1);
    expect(d.standardError).toBeCloseTo(Math.sqrt(n * dv), 10);
    const naive = Math.sqrt(
      fakeEstimate('A', a).standardError ** 2 + fakeEstimate('B', b).standardError ** 2,
    );
    expect(d.naiveStandardError).toBeCloseTo(naive, 10);
    // The two are genuinely different, and the correlation makes the correct
    // one far smaller: here by more than an order of magnitude.
    expect(d.standardError).toBeLessThan(d.naiveStandardError);
    expect(d.standardError * 5).toBeLessThan(d.naiveStandardError);
    // With the naive standard error this clear difference would look like noise.
    expect(d.difference / d.naiveStandardError).toBeLessThan(2);
    expect(d.zScore).toBeGreaterThan(4);
    expect(d.verdict).toBe('clear');
  });

  it('calls two models indistinguishable rather than naming a winner', () => {
    // A WAIC difference well inside the standard error of the difference.
    const rng = new Random('indistinguishable');
    const n = 50;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < n; i++) {
      const base = -1 + 0.5 * rng.normal();
      a.push(base);
      b.push(base + 0.3 * rng.normal()); // mean-zero divergence: no real difference
    }
    const d = elpdDifference(fakeEstimate('A', a), fakeEstimate('B', b));
    expect(Math.abs(d.zScore)).toBeLessThan(2);
    expect(d.verdict).toBe('indistinguishable');
    expect(d.statement).toMatch(/cannot be separated/);
    expect(d.statement).not.toMatch(/predicts better/);
    const table = compareElpd([fakeEstimate('A', a), fakeEstimate('B', b)]);
    expect(table.tiedWithBest).toHaveLength(1);
    expect(table.statement).toMatch(/indistinguishable|does not distinguish/);
    expect(table.warnings.join(' ')).toMatch(/not the sum or the difference/);
  });

  it('states that it ranks only the models supplied', () => {
    const table = compareElpd([fakeEstimate('A', [-1, -1.2, -0.9, -1.1]), fakeEstimate('B', [-2, -2.2, -1.9, -2.1])]);
    expect(table.warnings.join(' ')).toMatch(/ranks only the models supplied/);
    expect(table.warnings.join(' ')).toMatch(/none of the models in the set is likely to be true/);
  });
});

describe('in-sample fit always improves with complexity; out-of-sample does not', () => {
  it('shows monotone in-sample log-likelihood and a cross-validated peak at the true order', () => {
    const n = 60;
    const rng = new Random('poly-truth');
    const x = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
    // Truth is quadratic: 1 + 2x − 3x², with noise sd 0.5.
    const y = x.map((v) => 1 + 2 * v - 3 * v * v + 0.5 * rng.normal());
    const orders = [0, 1, 2, 3, 4, 5, 6];
    const inSample = orders.map((o) => {
      const beta = ols(x, y, o);
      expect(beta).not.toBeNull();
      return gaussianLogLik(n, residualSumOfSquares(x, y, beta ?? []));
    });
    for (let k = 1; k < inSample.length; k++) {
      // Strictly increasing: a nested larger model can always do at least as
      // well in sample, and with continuous data it does strictly better.
      expect(inSample[k]).toBeGreaterThan(inSample[k - 1]);
    }
    const cvScores = orders.map((o) =>
      kFoldCrossValidation(
        `order ${o}`,
        n,
        10,
        (train, test) => {
          const xt = train.map((i) => x[i]);
          const yt = train.map((i) => y[i]);
          const beta = ols(xt, yt, o);
          if (beta === null) throw new EngineError('singular design', 'singular');
          const rss = residualSumOfSquares(xt, yt, beta);
          const sigma2 = rss / Math.max(1, xt.length - (o + 1));
          const sd = Math.sqrt(sigma2);
          return test.map((i) => normalLogPdf(y[i], polyPredict(beta, x[i]), sd));
        },
        { seed: 'poly-folds' },
      ).elpd,
    );
    const bestOrder = cvScores.indexOf(Math.max(...cvScores));
    expect(bestOrder).toBeGreaterThanOrEqual(2);
    expect(bestOrder).toBeLessThanOrEqual(3); // at or near the true order
    // And the point of the module: the in-sample ranking is the opposite.
    expect(inSample.indexOf(Math.max(...inSample))).toBe(orders.length - 1);
    expect(cvScores[6]).toBeLessThan(cvScores[2]);
  });
});

describe('AIC and BIC answer different questions, demonstrably', () => {
  const n = 40;
  const orders = [0, 1, 2, 3, 4, 5, 6];

  function selectByCriterion(
    x: readonly number[],
    y: readonly number[],
    kind: 'aic' | 'bic',
    candidates: readonly number[] = orders,
  ): { order: number; beta: number[]; sd: number } {
    const fits = candidates.map((o) => {
      const beta = ols(x, y, o) ?? [];
      const rss = residualSumOfSquares(x, y, beta);
      return { o, beta, rss, logLik: gaussianLogLik(x.length, rss) };
    });
    const ranking = criterionWeights(
      fits.map((f) => ({ name: `order ${f.o}`, logLikelihood: f.logLik, parameters: f.o + 2, observations: x.length })),
      kind,
    );
    const chosen = fits[candidates.indexOf(Number(ranking.best.split(' ')[1]))];
    return { order: chosen.o, beta: chosen.beta, sd: Math.sqrt(chosen.rss / x.length) };
  }

  it('BIC recovers the true model more often than AIC when the truth is in the set', () => {
    let aicCorrect = 0;
    let bicCorrect = 0;
    const reps = 60;
    for (let r = 0; r < reps; r++) {
      const rng = new Random(`truth-in-set-${r}`);
      const x = Array.from({ length: n }, (_, i) => -1 + (2 * i) / (n - 1));
      const y = x.map((v) => 1 + 2 * v - 3 * v * v + rng.normal());
      if (selectByCriterion(x, y, 'aic').order === 2) aicCorrect++;
      if (selectByCriterion(x, y, 'bic').order === 2) bicCorrect++;
    }
    expect(bicCorrect).toBeGreaterThan(aicCorrect);
  });

  it('AIC predicts better than BIC when the truth is NOT in the set', () => {
    // The canonical tapering-coefficients setup: 30 real predictors with
    // decaying coefficients, of which only the first 12 are ever offered as
    // candidates, so no candidate model is correct. AIC keeps more of the
    // small real effects; BIC, which is trying to identify a true model that
    // is not on the list, truncates too early and predicts worse.
    const predictors = 30;
    const candidates = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const beta = Array.from({ length: predictors }, (_, j) => 1.1 / (j + 1));
    const nTrain = 60;
    const nTest = 400;
    const reps = 30;
    let aicScore = 0;
    let bicScore = 0;
    for (let r = 0; r < reps; r++) {
      const rng = new Random(`tapering-${r}`);
      const design = (rows: number): { x: number[][]; y: number[] } => {
        const x: number[][] = [];
        const y: number[] = [];
        for (let i = 0; i < rows; i++) {
          const row = Array.from({ length: predictors }, () => rng.normal());
          let mean = 0;
          for (let j = 0; j < predictors; j++) mean += beta[j] * row[j];
          x.push(row);
          y.push(mean + rng.normal());
        }
        return { x, y };
      };
      const train = design(nTrain);
      const test = design(nTest);
      const fits = candidates.map((p) => {
        const sub = train.x.map((row) => [1, ...row.slice(0, p)]);
        const b = leastSquares(sub, train.y);
        const rss = sub.reduce((acc, row, i) => {
          const e = train.y[i] - dot(b, row);
          return acc + e * e;
        }, 0);
        return { p, b, rss, logLik: gaussianLogLik(nTrain, rss) };
      });
      for (const kind of ['aic', 'bic'] as const) {
        const ranking = criterionWeights(
          fits.map((f) => ({ name: `p ${f.p}`, logLikelihood: f.logLik, parameters: f.p + 2, observations: nTrain })),
          kind,
        );
        const chosen = fits[candidates.indexOf(Number(ranking.best.split(' ')[1]))];
        // Unbiased residual scale, so a larger model is not flattered by an
        // optimistically small plug-in sigma.
        const sd = Math.sqrt(chosen.rss / (nTrain - chosen.p - 1));
        let score = 0;
        for (let i = 0; i < nTest; i++) {
          const row = [1, ...test.x[i].slice(0, chosen.p)];
          score += normalLogPdf(test.y[i], dot(chosen.b, row), sd) / nTest;
        }
        if (kind === 'aic') aicScore += score / reps;
        else bicScore += score / reps;
      }
    }
    expect(aicScore).toBeGreaterThan(bicScore);
  });
});

describe('Bayesian evidence', () => {
  const y = normalSample(20, 0.35, 1, 'evidence-data');

  it('bridge sampling matches the analytic conjugate marginal likelihood within its reported relative error', () => {
    const tau = 2;
    const c: Conjugate = { y, tau };
    const draws = posteriorDraws(c, 3000, 'evidence-draws').map((mu) => [mu]);
    const logJoint = (v: readonly number[]) => {
      const mu = v[0];
      return y.reduce((a, yi) => a + normalLogPdf(yi, mu, 1), 0) + normalLogPdf(mu, 0, tau);
    };
    const est = estimateEvidence('M1', draws, logJoint, 'evidence-bridge');
    const reference = analyticLogEvidence(y, tau); // analytic, derived in this file
    // On the log scale the relative standard error of Z is the standard error
    // of log Z, so 5 of them plus a floor for round-off is a fair bound.
    expect(Math.abs(est.logMarginalLikelihood - reference)).toBeLessThan(
      Math.max(5 * est.relativeStandardError, 0.02),
    );
    expect(est.relativeStandardError).toBeGreaterThanOrEqual(0);
    expect(est.exactness).toBe('empirical');

    const bf = bayesFactor(est, analyticEvidence('M0', analyticLogEvidenceNull(y)));
    const referenceLogBf = reference - analyticLogEvidenceNull(y);
    expect(bf.logBayesFactor).toBeCloseTo(referenceLogBf, 1);
    expect(bf.warnings.join(' ')).toMatch(/Jeffreys-Lindley/);
    expect(bf.warnings.join(' ')).toMatch(/not a measure of predictive accuracy/);
    expect(bf.warnings.join(' ')).toMatch(/diffuse prior is not a neutral prior/);
  });

  it('importance sampling gives the same evidence as bridge sampling, with a larger relative error', () => {
    const tau = 2;
    const draws = posteriorDraws({ y, tau }, 3000, 'evidence-draws').map((mu) => [mu]);
    const logJoint = (v: readonly number[]) =>
      y.reduce((a, yi) => a + normalLogPdf(yi, v[0], 1), 0) + normalLogPdf(v[0], 0, tau);
    const is = estimateEvidence('M1', draws, logJoint, 'evidence-is', { method: 'importance-sampling' });
    expect(is.method).toBe('importance-sampling');
    expect(Math.abs(is.logMarginalLikelihood - analyticLogEvidence(y, tau))).toBeLessThan(
      Math.max(5 * is.relativeStandardError, 0.05),
    );
  });

  it('demonstrates the Jeffreys-Lindley paradox: widening the prior drives the Bayes factor toward the simpler model without bound', () => {
    // Data fixed, with a small apparent effect. Chosen so that S² < n, which
    // is exactly the regime in which log BF falls monotonically in the prior
    // width: d/dτ² [−½ln(1+nτ²) + ½τ²S²/(1+nτ²)] < 0 whenever S² < n(1+nτ²).
    const fixed = new Array<number>(20).fill(0.2);
    const s = fixed.reduce((a, b) => a + b, 0);
    expect(s * s).toBeLessThan(fixed.length);
    const scales = [1, 2, 5, 10, 30, 100, 300, 1000, 3000, 10000];
    const sensitivity = bayesFactorPriorSensitivity({
      priorScales: scales,
      logEvidenceRicher: (tau) => analyticLogEvidence(fixed, tau),
      logEvidenceSimpler: analyticLogEvidenceNull(fixed),
      richerName: 'mu free',
      simplerName: 'mu = 0',
      exactness: 'exact',
    });
    expect(sensitivity.monotoneTowardSimpler).toBe(true);
    // Each tenfold widening of a prior the data has already ruled out costs the
    // richer model about a factor of ten: the slope of log BF against log tau
    // tends to −1 for one extra parameter.
    expect(sensitivity.asymptoticSlope).toBeLessThan(-0.9);
    expect(sensitivity.asymptoticSlope).toBeGreaterThan(-1.1);
    // Unbounded: the widest prior sends log BF far below the narrowest.
    const first = sensitivity.curve[0].logBayesFactor;
    const last = sensitivity.curve[sensitivity.curve.length - 1].logBayesFactor;
    expect(last).toBeLessThan(first - 5);
    expect(last).toBeLessThan(-7);
    // Doubling the widest scale again must keep driving it down, with no floor.
    const further = bayesFactorPriorSensitivity({
      priorScales: [1e4, 1e6, 1e8],
      logEvidenceRicher: (tau) => analyticLogEvidence(fixed, tau),
      logEvidenceSimpler: analyticLogEvidenceNull(fixed),
    });
    expect(further.curve[2].logBayesFactor).toBeLessThan(last - 5);
    expect(sensitivity.statement).toMatch(/Jeffreys-Lindley/);
  });

  it('gives posterior model probabilities that are conditional on an exhaustive set, and says so', () => {
    const res = posteriorModelProbabilities([
      analyticEvidence('M0', analyticLogEvidenceNull(y)),
      analyticEvidence('M1', analyticLogEvidence(y, 2)),
    ]);
    const sum = res.probabilities.reduce((a, p) => a + p.posteriorProbability, 0);
    expect(sum).toBeCloseTo(1, 12);
    // Independent reference from the two analytic evidences.
    const l0 = analyticLogEvidenceNull(y);
    const l1 = analyticLogEvidence(y, 2);
    const expected1 = 1 / (1 + Math.exp(l0 - l1));
    expect(res.probabilities[1].posteriorProbability).toBeCloseTo(expected1, 10);
    expect(res.warnings.join(' ')).toMatch(/conditional on the model set being exhaustive/);
    expect(res.warnings.join(' ')).toMatch(/It never is/);
  });

  it('Savage-Dickey agrees with the direct Bayes factor on a conjugate nested pair', () => {
    const tau = 2;
    const draws = posteriorDraws({ y, tau }, 40000, 'savage-dickey-draws');
    const sd = savageDickey({
      posteriorDraws: draws,
      priorDensityAt: (theta) => Math.exp(normalLogPdf(theta, 0, tau)),
      point: 0,
    });
    const directLogBf01 = analyticLogEvidenceNull(y) - analyticLogEvidence(y, tau);
    // Kernel smoothing biases the posterior ordinate slightly; with 40 000
    // draws and Silverman's bandwidth the bias plus Monte Carlo error is a few
    // per cent, so 8% relative is a justified tolerance.
    expect(sd.logBayesFactorRestricted).toBeCloseTo(directLogBf01, 1);
    expect(Math.abs(sd.bayesFactorRestricted / Math.exp(directLogBf01) - 1)).toBeLessThan(0.08);
    expect(sd.warnings.join(' ')).toMatch(/kernel density estimate/);
  });
});

describe('model averaging and stacking', () => {
  it('puts the weights on the simplex, summing to exactly 1', () => {
    const rng = new Random('stacking-simplex');
    const n = 40;
    const a = Array.from({ length: n }, () => -1 + 0.3 * rng.normal());
    const b = Array.from({ length: n }, () => -1.4 + 0.3 * rng.normal());
    const cc = Array.from({ length: n }, () => -3 + 0.3 * rng.normal());
    const w = stackingWeights([fakeEstimate('A', a), fakeEstimate('B', b), fakeEstimate('C', cc)]);
    expect(w.weights.every((v) => v >= 0)).toBe(true);
    expect(w.weights.reduce((x, y2) => x + y2, 0)).toBe(1);
    expect(w.method).toBe('stacking');
  });

  it('reduces to the single best model when one model dominates', () => {
    const n = 50;
    const a = new Array<number>(n).fill(-1);
    const b = new Array<number>(n).fill(-5);
    const w = stackingWeights([fakeEstimate('A', a), fakeEstimate('B', b)]);
    expect(w.weights[0]).toBeGreaterThan(0.99);
    expect(w.statement).toMatch(/essentially all weight/);
  });

  it('spreads weight when two models are complementary, and beats the best single model', () => {
    const n = 60;
    const a = Array.from({ length: n }, (_, i) => (i < n / 2 ? -0.5 : -4));
    const b = Array.from({ length: n }, (_, i) => (i < n / 2 ? -4 : -0.5));
    const w = stackingWeights([fakeEstimate('A', a), fakeEstimate('B', b)]);
    expect(w.weights[0]).toBeGreaterThan(0.2);
    expect(w.weights[1]).toBeGreaterThan(0.2);
    expect(w.mixtureLogScore).not.toBeNull();
    expect(w.bestSingleLogScore).not.toBeNull();
    // The objective is concave on the simplex, so the optimum is at least as
    // good as any vertex, i.e. as any single model.
    expect(w.mixtureLogScore ?? -Infinity).toBeGreaterThan((w.bestSingleLogScore ?? 0) + 0.1);
    expect(w.statement).toMatch(/complementary/);
  });

  it('never scores below the best single model, even when one model dominates', () => {
    const n = 50;
    const a = new Array<number>(n).fill(-1);
    const b = new Array<number>(n).fill(-5);
    const w = stackingWeights([fakeEstimate('A', a), fakeEstimate('B', b)]);
    expect(w.mixtureLogScore ?? -Infinity).toBeGreaterThanOrEqual((w.bestSingleLogScore ?? 0) - 1e-9);
  });

  it('pseudo-BMA+ with the Bayesian bootstrap is less concentrated than plain pseudo-BMA', () => {
    const rng = new Random('pseudo-bma');
    const n = 40;
    // Two models separated by about 2 nats in total elpd, with pointwise noise
    // far larger than that: the difference is well inside its own error.
    const a = Array.from({ length: n }, () => -1 + rng.normal());
    const b = a.map((v) => v - 0.05);
    const plain = pseudoBmaWeights([fakeEstimate('A', a), fakeEstimate('B', b)]);
    const plus = pseudoBmaWeights([fakeEstimate('A', a), fakeEstimate('B', b)], {
      bayesianBootstrap: true,
      seed: 'pseudo-bma-boot',
      replicates: 500,
    });
    expect(plain.weights.reduce((x, y2) => x + y2, 0)).toBe(1);
    expect(plus.weights.reduce((x, y2) => x + y2, 0)).toBe(1);
    expect(Math.max(...plus.weights)).toBeLessThan(Math.max(...plain.weights));
    expect(plain.warnings.join(' ')).toMatch(/overconfident/);
    expect(plus.method).toBe('pseudo-bma+');
    expect(plus.warnings.join(' ')).toMatch(/Bayesian bootstrap/);
  });

  it('reports that averaging usually beats selecting', () => {
    const w = stackingWeights([fakeEstimate('A', [-1, -2, -1, -2]), fakeEstimate('B', [-2, -1, -2, -1])]);
    expect(w.warnings.join(' ')).toMatch(/Averaging .*usually predicts better than selecting/);
    expect(w.warnings.join(' ')).toMatch(/selecting a single model understates uncertainty/);
  });
});

describe('Bayesian model averaging and mixture prediction', () => {
  it('normalises Akaike weights onto the simplex and insists on averaging, not selecting', () => {
    const ranking = criterionWeights(
      [
        { name: 'a', logLikelihood: -100, parameters: 2, observations: 80 },
        { name: 'b', logLikelihood: -99, parameters: 3, observations: 80 },
        { name: 'c', logLikelihood: -110, parameters: 2, observations: 80 },
      ],
      'aic',
    );
    const bma = bayesianModelAverage({
      names: ranking.weights.map((w) => w.name),
      weights: ranking.weights.map((w) => w.weight),
      source: 'akaike',
    });
    expect(bma.weights.reduce((x, y2) => x + y2, 0)).toBe(1);
    bma.weights.forEach((w, k) => expect(w).toBeCloseTo(ranking.weights[k].weight, 12));
    expect(bma.statement).toMatch(/weighted mixture/);
    expect(bma.warnings.join(' ')).toMatch(/closest in Kullback-Leibler divergence/);
    expect(() => bayesianModelAverage({ names: ['a'], weights: [0], source: 'akaike' })).toThrow(/all zero/);
    expect(() => bayesianModelAverage({ names: ['a', 'b'], weights: [1], source: 'akaike' })).toThrow(/one per model/);
  });

  it('samples the mixture predictive distribution in proportion to the weights', () => {
    const draws = [new Array<number>(500).fill(0), new Array<number>(500).fill(10)];
    const out = averagePredictiveDraws({ draws, weights: [0.25, 0.75], size: 8000, seed: 'mixture' });
    const share = out.filter((v) => v === 10).length / out.length;
    // Binomial standard error on 8000 draws is 0.005, so 0.02 is 4 SE.
    expect(Math.abs(share - 0.75)).toBeLessThan(0.02);
    expect(() => averagePredictiveDraws({ draws, weights: [1], size: 10, seed: 's' })).toThrow(/for 1 weights/);
  });
});

describe('proper scoring of predictive distributions', () => {
  it('reports calibration and sharpness separately, and the log score honestly', () => {
    const rng = new Random('scoring');
    const n = 400;
    const forecasts: number[] = [];
    const outcomes: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = 0.1 + 0.8 * rng.uniform();
      forecasts.push(p);
      outcomes.push(rng.uniform() < p ? 1 : 0);
    }
    const scored = scoreBinaryForecast('calibrated', forecasts, outcomes);
    // A well calibrated forecast on this construction has a small expected
    // calibration error; 0.12 is loose enough for 400 observations in 10 bins.
    expect(scored.calibration.ece).toBeLessThan(0.12);
    expect(scored.sharpness.forecastVariance).toBeGreaterThan(0);
    expect(scored.logScore.finite).toBe(true);
    expect(scored.brier.brierScore).toBeGreaterThan(0);
    expect(scored.warnings.join(' ')).toMatch(/Calibration and sharpness are reported separately/);
    // The climatological forecast is perfectly calibrated and useless: it has
    // zero sharpness, which is exactly why one number cannot serve for both.
    const base = outcomes.reduce((a, b) => a + b, 0) / n;
    const flat = scoreBinaryForecast('climatology', new Array<number>(n).fill(base), outcomes);
    expect(flat.sharpness.forecastVariance).toBe(0);
    expect(flat.brier.brierScore).toBeGreaterThan(scored.brier.brierScore);
  });

  it('scores continuous predictive distributions by CRPS and refuses zero density at an observation', () => {
    const y = [0.5, -0.2, 1.4];
    const res = scoreDistributionalForecast({
      name: 'normal predictive',
      observations: y,
      normal: y.map(() => ({ mean: 0, sd: 1 })),
      logPredictiveDensity: y.map((v) => normalLogPdf(v, 0, 1)),
    });
    // Independent reference: CRPS(N(0,1), 0) = 2φ(0) − 1/√π for y = 0, and the
    // closed form is checked here for the first observation.
    const z = 0.5;
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    const cdf = 0.5 * (1 + erfApprox(z / Math.SQRT2));
    expect(res.perObservation[0].value).toBeCloseTo(z * (2 * cdf - 1) + 2 * phi - 1 / Math.sqrt(Math.PI), 6);
    expect(res.meanLogPredictiveDensity).toBeCloseTo(
      y.reduce((a, v) => a + normalLogPdf(v, 0, 1), 0) / y.length,
      12,
    );
    expect(() =>
      scoreDistributionalForecast({
        name: 'broken',
        observations: y,
        normal: y.map(() => ({ mean: 0, sd: 1 })),
        logPredictiveDensity: [0, -Infinity, 0],
      }),
    ).toThrow(/zero density to an observed value/);
    expect(() => scoreDistributionalForecast({ name: 'x', observations: y })).toThrow(/exactly one of/);
  });
});

describe('posterior predictive checks', () => {
  it('is conservative: under the null its distribution is shrunk toward 0.5, not uniform', () => {
    const pValues: number[] = [];
    const reps = 120;
    for (let r = 0; r < reps; r++) {
      const rng = new Random(`ppc-${r}`);
      const n = 20;
      const y = Array.from({ length: n }, () => rng.normal()); // the model is TRUE here
      const c: Conjugate = { y, tau: 10 };
      const p = posterior(c);
      const observed = y.reduce((a, b) => a + b, 0) / n;
      const replicated: number[] = [];
      for (let s = 0; s < 200; s++) {
        const mu = p.mean + Math.sqrt(p.variance) * rng.normal();
        let m = 0;
        for (let i = 0; i < n; i++) m += (mu + rng.normal()) / n;
        replicated.push(m);
      }
      const check = posteriorPredictiveCheck({ statistic: 'sample mean', observed, replicated });
      pValues.push(check.pValue);
      expect(check.warnings.join(' ')).toMatch(/NOT uniform under the null/);
      expect(check.warnings.join(' ')).toMatch(/used twice/);
    }
    const mean = pValues.reduce((a, b) => a + b, 0) / reps;
    const sd = Math.sqrt(pValues.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (reps - 1));
    // A uniform distribution has mean 0.5 and sd 1/sqrt(12) = 0.2887. The
    // posterior predictive p-value for a statistic the model fits by
    // construction is concentrated around 0.5, so its sd must be well below
    // that; 0.2 leaves ample room for Monte Carlo error on 120 replications.
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
    expect(sd).toBeLessThan(0.2);
    // And the tails are far thinner than uniform: 10% of uniform draws fall
    // below 0.05, which is the test a user would wrongly apply.
    const extreme = pValues.filter((p) => p < 0.05 || p > 0.95).length / reps;
    expect(extreme).toBeLessThan(0.05);
  });

  it('detects a discrepancy the model genuinely cannot reproduce', () => {
    const rng = new Random('ppc-misfit');
    const n = 40;
    // Data with heavy tails, fitted by a normal model: the maximum is the
    // discrepancy the model cannot match.
    const y = Array.from({ length: n }, () => 3 * Math.tan(Math.PI * (rng.uniform() - 0.5)) * 0.3);
    const c: Conjugate = { y, tau: 10 };
    const p = posterior(c);
    const observed = Math.max(...y.map(Math.abs));
    const replicated = Array.from({ length: 500 }, () => {
      const mu = p.mean + Math.sqrt(p.variance) * rng.normal();
      let max = 0;
      for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(mu + rng.normal()));
      return max;
    });
    const check = posteriorPredictiveCheck({ statistic: 'largest absolute value', observed, replicated });
    expect(check.pValue).toBeLessThan(0.05);
    expect(check.extreme).toBe(true);
    expect(check.statement).toMatch(/cannot reproduce/);
  });

  it('refuses too few replicates', () => {
    expect(() =>
      posteriorPredictiveCheck({ statistic: 't', observed: 1, replicated: new Array<number>(50).fill(0) }),
    ).toThrow(/at least 100 replicated datasets/);
  });
});

describe('nested model tests', () => {
  it('matches a chi-square tail computed independently', () => {
    const res = likelihoodRatioTest({ restrictedLogLikelihood: -110, fullLogLikelihood: -105, degreesOfFreedom: 2 });
    expect(res.statistic).toBe(10);
    // Reference: for df = 2 the chi-square survival function is exp(−x/2).
    expect(res.pValue).toBeCloseTo(Math.exp(-5), 12);
    expect(res.naivePValue).toBe(res.pValue);
    expect(res.onBoundary).toBe(false);
    expect(res.reject(0.05)).toBe(true);
  });

  it('refuses a negative likelihood-ratio statistic instead of reporting a p-value', () => {
    expect(() =>
      likelihoodRatioTest({ restrictedLogLikelihood: -100, fullLogLikelihood: -103, degreesOfFreedom: 1 }),
    ).toThrow(/not nested|did not converge/);
  });

  it('boundary case: the naive chi-square has the wrong size and the mixture correction has the right one', () => {
    // The canonical boundary problem: theta >= 0 with theta-hat = max(0, Z),
    // Z ~ N(0,1) under the null. Then the LR statistic is Z² when Z > 0 and
    // exactly 0 otherwise — the half-and-half mixture Chernoff described.
    const reps = 4000;
    const rng = new Random('boundary-lrt');
    let naiveRejections = 0;
    let correctedRejections = 0;
    for (let r = 0; r < reps; r++) {
      const z = rng.normal();
      const statistic = z > 0 ? z * z : 0;
      const res = likelihoodRatioTest({
        restrictedLogLikelihood: -50,
        fullLogLikelihood: -50 + statistic / 2,
        degreesOfFreedom: 1,
        boundaryParameters: 1,
      });
      if (res.naivePValue < 0.05) naiveRejections++;
      if (res.pValue < 0.05) correctedRejections++;
    }
    const naiveSize = naiveRejections / reps;
    const correctedSize = correctedRejections / reps;
    // The naive chi-square rejects only half as often as its nominal level,
    // because half the time the statistic is exactly 0. Binomial standard
    // error on 4000 replications is about 0.0025, so these windows are ±4 SE.
    expect(naiveSize).toBeGreaterThan(0.015);
    expect(naiveSize).toBeLessThan(0.035);
    expect(Math.abs(naiveSize - 0.05)).toBeGreaterThan(0.01); // demonstrably wrong
    // The mixture-corrected p-value has approximately the nominal size.
    expect(correctedSize).toBeGreaterThan(0.04);
    expect(correctedSize).toBeLessThan(0.061);
    const res = likelihoodRatioTest({
      restrictedLogLikelihood: -50,
      fullLogLikelihood: -48,
      degreesOfFreedom: 1,
      boundaryParameters: 1,
    });
    // One boundary parameter: p = ½·P(chi²₁ > Λ), computed independently.
    expect(res.pValue).toBeCloseTo(res.naivePValue / 2, 12);
    expect(res.warnings.join(' ')).toMatch(/boundary/);
    expect(res.warnings.join(' ')).toMatch(/is WRONG here/);
    expect(res.statement).toMatch(/mixture/);
  });

  it('computes Wald and score statistics from the quadratic forms, and refuses singular matrices', () => {
    const wald = waldTest({ estimate: [2, -1], covariance: [[1, 0], [0, 0.25]] });
    // Reference: 2²/1 + (−1)²/0.25 = 4 + 4 = 8 on 2 degrees of freedom,
    // so p = exp(−4) for df = 2.
    expect(wald.statistic).toBeCloseTo(8, 12);
    expect(wald.pValue).toBeCloseTo(Math.exp(-4), 10);
    expect(wald.warnings.join(' ')).toMatch(/depends on the parameterisation/);
    const score = scoreTest({ score: [3], information: [[9]] });
    expect(score.statistic).toBeCloseTo(1, 12);
    expect(() => waldTest({ estimate: [1, 1], covariance: [[1, 1], [1, 1]] })).toThrow(/singular/);
    expect(() => scoreTest({ score: [1, 1], information: [[0, 0], [0, 0]] })).toThrow(/singular/);
  });

  it("Vuong's test compares non-nested models and refuses a degenerate ratio", () => {
    const rng = new Random('vuong');
    const n = 200;
    const y = Array.from({ length: n }, () => rng.normal());
    const normalLl = y.map((v) => normalLogPdf(v, 0, 1));
    // Laplace with the matching mean absolute deviation: non-nested, and wrong.
    const b = Math.sqrt(0.5);
    const laplaceLl = y.map((v) => -Math.log(2 * b) - Math.abs(v) / b);
    const res = vuongTest({
      nameA: 'normal',
      nameB: 'laplace',
      pointwiseLogLikA: normalLl,
      pointwiseLogLikB: laplaceLl,
    });
    // Independent reference for the statistic.
    const lr = normalLl.map((v, i) => v - laplaceLl[i]);
    const m = lr.reduce((a, c) => a + c, 0) / n;
    const sd = Math.sqrt(lr.reduce((a, c) => a + (c - m) * (c - m), 0) / n);
    expect(res.statistic).toBeCloseTo((Math.sqrt(n) * m) / sd, 10);
    expect(res.favours).toBe('normal'); // the true model, on 200 normal observations
    expect(res.warnings.join(' ')).toMatch(/strictly non-nested/);
    expect(() =>
      vuongTest({ nameA: 'a', nameB: 'b', pointwiseLogLikA: normalLl, pointwiseLogLikB: normalLl }),
    ).toThrow(/zero variance/);
  });
});

describe('the toolkit entry point', () => {
  it('compares models end to end and refuses to name a winner when it cannot', () => {
    const base = normalSample(35, 0.3, 1, 'toolkit-data');
    const tight: Conjugate = { y: base, tau: 1 };
    const loose: Conjugate = { y: base, tau: 10 };
    const result = compareModels(
      [
        { name: 'prior sd 1', logLik: conjugateLogLik(tight, posteriorDraws(tight, 2000, 'toolkit-a')) },
        { name: 'prior sd 10', logLik: conjugateLogLik(loose, posteriorDraws(loose, 2000, 'toolkit-b')) },
      ],
      { seed: 'toolkit-seed', bootstrapReplicates: 200 },
    );
    expect(result.loo).toHaveLength(2);
    expect(result.waic).toHaveLength(2);
    expect(result.reliable).toBe(true);
    expect(result.stacking?.weights.reduce((a, b) => a + b, 0)).toBe(1);
    expect(result.pseudoBma?.weights.reduce((a, b) => a + b, 0)).toBe(1);
    // Two priors this similar cannot be separated by 35 observations.
    expect(result.comparison.verdict).toBe('indistinguishable');
    expect(result.recommendation).toMatch(/Do not select one of these models|cannot be separated/);
    expect(result.recommendation).toMatch(/ranks only the models supplied/);
    expect(result.explanation.exactness).toBe('empirical');
  });
});

describe('refusals', () => {
  const c: Conjugate = { y: normalSample(15, 0, 1, 'refusal-data'), tau: 5 };
  const good = conjugateLogLik(c, posteriorDraws(c, 200, 'refusal-draws'));

  it('refuses an empty model set', () => {
    expect(() => compareModels([])).toThrow(EngineError);
    expect(() => compareModels([])).toThrow(/model set is empty/);
    expect(() => compareElpd([])).toThrow(/nothing to compare/);
    expect(() => criterionWeights([], 'aic')).toThrow(/model set is empty/);
    expect(() => posteriorModelProbabilities([])).toThrow(/model set is empty/);
  });

  it('refuses a log-likelihood matrix of the wrong shape, naming the dimensions', () => {
    const ragged = good.map((row, s) => (s === 3 ? row.slice(0, 5) : row));
    expect(() => waic('ragged', ragged)).toThrow(/row 3 .* has 5 entries but row 0 has 15/);
    expect(() =>
      compareModels([
        { name: 'a', logLik: good },
        { name: 'b', logLik: good.map((row) => row.slice(0, 10)) },
      ]),
    ).toThrow(/has 10 observations but model "a" has 15/);
    expect(() => waic('empty', [])).toThrow(/no rows/);
    expect(() => waic('no columns', [[], [], []])).toThrow(/0 columns/);
  });

  it('refuses non-finite log-likelihoods, reporting their indices', () => {
    const broken = good.map((row) => [...row]);
    broken[7][2] = -Infinity;
    broken[9][4] = NaN;
    expect(() => psisLoo('broken', broken)).toThrow(/\[draw 7\]\[observation 2\]/);
    expect(() => psisLoo('broken', broken)).toThrow(/\[draw 9\]\[observation 4\]/);
  });

  it('refuses too few posterior draws for a stable estimate', () => {
    expect(() => waic('thin', good.slice(0, 20))).toThrow(/too few for a stable estimate/);
    expect(() => psisLoo('thin', good.slice(0, 20))).toThrow(/at least 50/);
  });

  it('refuses a degenerate stacking problem', () => {
    expect(() => stackingWeights([fakeEstimate('only', [-1, -1, -1])])).toThrow(/at least 2 models/);
    expect(() => stackingWeights([])).toThrow(/model set is empty/);
    const withInfinity = fakeEstimate('bad', [-1, -Infinity, -1]);
    expect(() => stackingWeights([withInfinity, fakeEstimate('ok', [-1, -1, -1])])).toThrow(
      /zero predictive density|is -Infinity/,
    );
  });

  it('refuses the Savage-Dickey ratio when the draws cannot support the ordinate', () => {
    expect(() =>
      savageDickey({ posteriorDraws: [1, 2, 3], priorDensityAt: () => 1 }),
    ).toThrow(/at least 200 posterior draws/);
    const far = normalSample(2000, 50, 1, 'savage-far');
    expect(() => savageDickey({ posteriorDraws: far, priorDensityAt: () => 0.4, point: 0 })).toThrow(
      /within one bandwidth/,
    );
  });

  it('refuses a prior sensitivity curve too short to show a trend', () => {
    expect(() =>
      bayesFactorPriorSensitivity({
        priorScales: [1, 10],
        logEvidenceRicher: () => -5,
        logEvidenceSimpler: -6,
      }),
    ).toThrow(/at least 3 prior scales/);
  });

  it('refuses cross-validation with an impossible fold count or a shape mismatch from the refit', () => {
    expect(() => kFoldCrossValidation('x', 10, 11, () => [0], { seed: 's' })).toThrow(/between 2 and/);
    expect(() => exactLeaveOneOut('x', 6, () => [0, 0])).toThrow(/must return one value per held-out observation/);
    expect(() => exactLeaveOneOut('x', 6, () => [-Infinity])).toThrow(/has failed cross-validation/);
    expect(() => kFoldCrossValidation('x', 10, 5, () => [0, 0])).toThrow(/needs an explicit seed/);
  });
});
