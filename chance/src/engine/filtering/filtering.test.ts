/**
 * Tests for the state-space filtering module.
 *
 * Every reference value is independent of this implementation: hand-derived
 * closed forms, a multivariate-normal density written out in this file from the
 * definition, the exact Kalman answer used as the reference for the particle
 * filter, and the chi-square calibration of the covariance. Monte Carlo
 * tolerances are justified where they appear, and every seed is fixed.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import {
  auxiliaryParticleFilter,
  conditionNumberSym,
  bootstrapParticleFilter,
  constantVelocityTracker,
  extendedKalmanFilter,
  fitByEm,
  fixedLagSmoother,
  innovationWhiteness,
  intervalCoverage,
  kalmanFilter,
  kalmanFilterSteps,
  kalmanSmoother,
  linearGaussianAsParticleModel,
  localLevel,
  localLinearTrend,
  maximiseLikelihood,
  nees,
  noisyPendulum,
  particleSmootherFFBS,
  raoBlackwellisedParticleFilter,
  resampleIndices,
  simulateLinearGaussian,
  simulateNonlinear,
  steadyStateGain,
  stochasticVolatility,
  symmetricEigenvalues,
  structuralAnalysis,
  unscentedKalmanFilter,
  univariateGrowth,
  type LinearGaussianModel,
  type Observation,
  type ParticleModel,
} from './index';
import { emSteps } from './em';
import { sequentialImportanceResamplingSteps } from './particle';

// ---------------------------------------------------------------------------
// Reference implementations written here, from the definitions, so that no
// assertion below is checked against this codebase's own machinery.
// ---------------------------------------------------------------------------

/** Independent Cholesky, written from the definition for use by the test only. */
function testCholesky(a: number[][]): number[][] {
  const n = a.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        expect(s).toBeGreaterThan(0);
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

/**
 * log N(x | mean, cov) from the definition:
 *   −½[ k log 2π + log det Σ + (x−μ)ᵀ Σ⁻¹ (x−μ) ].
 * Solved with the local Cholesky above.
 */
function testMvnLogPdf(x: number[], mean: number[], cov: number[][]): number {
  const k = x.length;
  const L = testCholesky(cov);
  const d = x.map((v, i) => v - mean[i]);
  const z = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    let s = d[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * z[j];
    z[i] = s / L[i][i];
  }
  let logDet = 0;
  for (let i = 0; i < k; i++) logDet += Math.log(L[i][i]);
  const quad = z.reduce((a, b) => a + b * b, 0);
  return -0.5 * (k * Math.log(2 * Math.PI) + 2 * logDet + quad);
}

function mse(estimates: number[], truth: number[]): number {
  let s = 0;
  for (let i = 0; i < estimates.length; i++) s += (estimates[i] - truth[i]) ** 2;
  return s / estimates.length;
}

// ---------------------------------------------------------------------------

describe('scalar Kalman filter against the hand-derived closed form', () => {
  /*
   * A one-dimensional CONSTANT state: A = 1, Q = 0, C = 1, R = r.
   * The posterior is conjugate, so by hand:
   *
   *   predicted variance at step 1 = p0
   *   S     = p0 + r
   *   K     = p0 / (p0 + r)
   *   P_1   = (1 − K)² p0 + K² r = p0 r / (p0 + r)
   *
   * and because each measurement adds precision 1/r to a state that does not
   * move, after n measurements
   *
   *   1/P_n = 1/p0 + n/r      →      P_n = p0 r / (r + n p0).
   *
   * With p0 = 4 and r = 2 this is P_n = 8 / (2 + 4n): P_1 = 4/3, P_2 = 0.8,
   * P_3 = 8/14. Asserted to 1e-12 — these are closed forms, so only floating
   * point stands between the two numbers.
   */
  const p0 = 4;
  const r = 2;
  const model: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[0]], R: [[r]], mu0: [0], Sigma0: [[p0]] };
  const obs: Observation[] = [[1], [1.5], [0.5], [1.1], [0.9], [1.3]];

  it('reproduces the closed-form gain and posterior variance exactly', () => {
    const run = kalmanFilter(model, obs);
    expect(run.exactness).toBe('exact');
    expect(run.steps[0].gain?.[0][0]).toBeCloseTo(p0 / (p0 + r), 12);
    for (let n = 1; n <= obs.length; n++) {
      const expected = (p0 * r) / (r + n * p0);
      expect(run.steps[n - 1].filteredCov[0][0]).toBeCloseTo(expected, 12);
    }
  });

  it('gives the same answer in the Joseph, square-root and naive forms on a well-conditioned problem', () => {
    const joseph = kalmanFilter(model, obs, { form: 'joseph' });
    const sqrt = kalmanFilter(model, obs, { form: 'sqrt' });
    const naive = kalmanFilter(model, obs, { form: 'naive' });
    expect(joseph.form).toBe('joseph');
    for (let t = 0; t < obs.length; t++) {
      expect(sqrt.steps[t].filteredCov[0][0]).toBeCloseTo(joseph.steps[t].filteredCov[0][0], 12);
      expect(naive.steps[t].filteredCov[0][0]).toBeCloseTo(joseph.steps[t].filteredCov[0][0], 12);
      expect(sqrt.steps[t].filteredMean[0]).toBeCloseTo(joseph.steps[t].filteredMean[0], 12);
    }
    expect(sqrt.logLikelihood).toBeCloseTo(joseph.logLikelihood, 10);
  });

  it('decreases the posterior variance monotonically', () => {
    const run = kalmanFilter(model, obs);
    for (let t = 1; t < run.steps.length; t++) {
      expect(run.steps[t].filteredCov[0][0]).toBeLessThan(run.steps[t - 1].filteredCov[0][0]);
    }
  });

  it('converges to the analytic steady-state variance of a local level model', () => {
    /*
     * Local level with q = r = 1. The steady-state PREDICTED variance P solves
     * the scalar Riccati equation P = P − P²/(P + r) + q, i.e. P² − qP − qr = 0,
     * so P = (q + √(q² + 4qr))/2 = (1 + √5)/2 = 1.6180339887498949 — the golden
     * ratio, which is a pleasant and entirely independent check. The filtered
     * variance is then P r/(P + r) and the gain P/(P + r).
     */
    const golden = (1 + Math.sqrt(5)) / 2;
    const ll = localLevel({ levelNoise: 1, measurementNoise: 1, priorLevelSd: 1 });
    const ss = steadyStateGain(ll);
    expect(ss.predictedCov[0][0]).toBeCloseTo(golden, 10);
    expect(ss.filteredCov[0][0]).toBeCloseTo(golden / (golden + 1), 10);
    expect(ss.gain[0][0]).toBeCloseTo(golden / (golden + 1), 10);

    const rng = new Random('steady-state-convergence');
    const sim = simulateLinearGaussian(ll, 400, rng);
    const run = kalmanFilter(ll, sim.observations);
    const last = run.steps[run.steps.length - 1];
    expect(last.predictedCov[0][0]).toBeCloseTo(golden, 8);
    expect(last.filteredCov[0][0]).toBeCloseTo(golden / (golden + 1), 8);
  });
});

describe('the filter beats the measurements and the smoother beats the filter', () => {
  it('orders the mean squared errors smoother < filter < raw measurement', () => {
    /*
     * The decisive cheap check: a sign or transpose error almost always breaks
     * this ordering. The measurement noise variance is 4, so the raw MSE should
     * be about 4 and both estimates materially below it.
     */
    const model = constantVelocityTracker({
      dt: 1,
      accelerationNoise: 0.2,
      measurementNoise: 2,
      priorPositionSd: 5,
      priorVelocitySd: 2,
    });
    const rng = new Random('mse-ordering');
    const sim = simulateLinearGaussian(model, 600, rng);
    const truth = sim.states.map((s) => s[0]);
    const raw = sim.values.map((y) => y[0]);
    const filtered = kalmanFilter(model, sim.observations);
    const smoothed = kalmanSmoother(model, sim.observations);

    const rawMse = mse(raw, truth);
    const filterMse = mse(filtered.steps.map((s) => s.filteredMean[0]), truth);
    const smoothMse = mse(smoothed.smoothedMean.map((m) => m[0]), truth);

    expect(rawMse).toBeGreaterThan(3); // nominal 4, sampling error over 600 points
    expect(filterMse).toBeLessThan(0.6 * rawMse);
    expect(smoothMse).toBeLessThan(filterMse);
  });
});

describe('covariance calibration — the honesty test', () => {
  it('covers the true state about 95% of the time and has mean NEES near the state dimension', () => {
    /*
     * A filter with a WRONG covariance still produces plausible means, so this
     * is the only test that catches it.
     *
     * 150 independent runs of 40 steps on a 2-state model give 6000 state
     * vectors. The mean NEES of a consistent filter is the state dimension, 2,
     * with standard error √(2·d/N) = √(4/6000) = 0.026; the tolerance of 0.12
     * below is over four standard errors. Coverage of a nominal 95% interval
     * has standard error √(0.95·0.05/6000) = 0.0028 per component, but
     * consecutive steps are strongly dependent, so the tolerance is set to
     * 0.02 — far tighter than a broken covariance could ever pass, and loose
     * enough that the dependence cannot fail it.
     */
    const model = constantVelocityTracker({
      dt: 0.5,
      accelerationNoise: 0.8,
      measurementNoise: 1,
      priorPositionSd: 2,
      priorVelocitySd: 1,
    });
    const runs = 150;
    const T = 40;
    let neesTotal = 0;
    const coverTotals = [0, 0];
    for (let i = 0; i < runs; i++) {
      const rng = new Random(`calibration-${i}`);
      const sim = simulateLinearGaussian(model, T, rng);
      const run = kalmanFilter(model, sim.observations);
      const n = nees(run.steps, sim.states);
      neesTotal += n.mean;
      const cover = intervalCoverage(run.steps, sim.states, 0.95);
      coverTotals[0] += cover.coverage[0];
      coverTotals[1] += cover.coverage[1];
    }
    const meanNees = neesTotal / runs;
    const coverage = coverTotals.map((c) => c / runs);
    expect(meanNees).toBeGreaterThan(2 - 0.12);
    expect(meanNees).toBeLessThan(2 + 0.12);
    expect(coverage[0]).toBeGreaterThan(0.93);
    expect(coverage[0]).toBeLessThan(0.97);
    expect(coverage[1]).toBeGreaterThan(0.93);
    expect(coverage[1]).toBeLessThan(0.97);
  });

  it('reports an overconfident filter as inconsistent', () => {
    // Halving the assumed measurement noise makes the filter's covariance too
    // small; the NEES diagnostic must notice.
    const truth = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const wrong = localLevel({ levelNoise: 0.5, measurementNoise: 0.1, priorLevelSd: 1 });
    const rng = new Random('overconfident');
    const sim = simulateLinearGaussian(truth, 400, rng);
    const run = kalmanFilter(wrong, sim.observations);
    const n = nees(run.steps, sim.states);
    expect(n.consistent).toBe(false);
    expect(n.mean).toBeGreaterThan(1);
    expect(n.warnings.join(' ')).toContain('OVERCONFIDENT');
  });
});

describe('likelihood cross-check against the multivariate normal definition', () => {
  it('matches the direct joint density of the whole observation vector', () => {
    /*
     * For the local level model with A = C = 1:
     *   x_t = x_0 + Σ_{i≤t} w_i,  so Cov(x_s, x_t) = Σ0 + min(s,t)·q
     *   y_t = x_t + v_t,          so Cov(y_s, y_t) = Σ0 + min(s,t)·q + r·δ_st
     * and E[y_t] = mu0. The marginal covariance is therefore written out below
     * from first principles, and the joint log-density is evaluated with the
     * independent routine at the top of this file. The Kalman recursion's
     * log-likelihood must equal it — this validates the recursion against the
     * definition of the thing it claims to compute.
     */
    const mu0 = 0.5;
    const s0 = 2;
    const q = 0.7;
    const r = 1.3;
    const model: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[q]], R: [[r]], mu0: [mu0], Sigma0: [[s0]] };
    const y = [1.2, -0.3, 0.8, 2.1, 0.4];
    const T = y.length;
    const cov: number[][] = Array.from({ length: T }, () => new Array<number>(T).fill(0));
    for (let s = 1; s <= T; s++) {
      for (let t = 1; t <= T; t++) {
        cov[s - 1][t - 1] = s0 + Math.min(s, t) * q + (s === t ? r : 0);
      }
    }
    const direct = testMvnLogPdf(y, new Array<number>(T).fill(mu0), cov);
    const recursive = kalmanFilter(model, y.map((v) => [v])).logLikelihood;
    expect(recursive).toBeCloseTo(direct, 10);
  });
});

describe('numerical robustness of the covariance update', () => {
  it('survives an ill-conditioned problem in the Joseph and square-root forms where the naive form fails', () => {
    /*
     * The classic ill-conditioned measurement (Grewal & Andrews): two
     * near-identical measurements of the same pair of states,
     *
     *   C = [[1, 1], [1, 1 + 1e-6]],
     *
     * with a measurement noise of 1e-8 and a prior variance of 1e6. The two
     * rows of C are parallel to within 1e-6, so the innovation covariance is
     * ill-conditioned and the Kalman gain is computed with heavy cancellation.
     * The naive update P = (I − KC)P then subtracts two nearly equal matrices
     * and the result acquires a negative eigenvalue. The Joseph form writes the
     * SAME quantity as a sum of two positive semi-definite congruences, so it
     * cannot.
     *
     * This is the test that justifies the default: with the naive form the
     * filter silently produces negative variances, and with the default it
     * does not.
     */
    const ill: LinearGaussianModel = {
      A: [
        [1, 0],
        [0, 1],
      ],
      C: [
        [1, 1],
        [1, 1 + 1e-6],
      ],
      Q: [
        [0, 0],
        [0, 0],
      ],
      R: [
        [1e-8, 0],
        [0, 1e-8],
      ],
      mu0: [0, 0],
      Sigma0: [
        [1e6, 0],
        [0, 1e6],
      ],
    };
    const obs: Observation[] = Array.from({ length: 60 }, () => [1, 1]);

    // The problem really is ill conditioned: the condition number of the
    // innovation covariance is reported, not assumed.
    const joseph = kalmanFilter(ill, obs, { form: 'joseph' });
    const sqrt = kalmanFilter(ill, obs, { form: 'sqrt' });
    expect(conditionNumberSym(joseph.steps[0].innovationCov as number[][])).toBeGreaterThan(1e8);
    for (const run of [joseph, sqrt]) {
      expect(run.steps).toHaveLength(60);
      for (const step of run.steps) {
        expect(symmetricEigenvalues(step.filteredCov)[0]).toBeGreaterThanOrEqual(0);
      }
    }
    // Both robust forms agree on the answer to the accuracy the problem allows
    // — and no further: on a system with a condition number above 1e8 the two
    // arrangements of the same algebra differ in the fifth digit, which is the
    // honest accuracy here rather than a defect.
    expect(sqrt.steps[59].filteredMean[0]).toBeCloseTo(joseph.steps[59].filteredMean[0], 3);

    // The naive form loses positive definiteness and must refuse rather than
    // carry on producing plausible numbers.
    let naiveError: unknown = null;
    try {
      kalmanFilter(ill, obs, { form: 'naive' });
    } catch (e) {
      naiveError = e;
    }
    expect(naiveError).toBeInstanceOf(EngineError);
    expect((naiveError as EngineError).message).toContain('positive definite');
    expect((naiveError as EngineError).issues[0].code).toBe('not-positive-definite');
    expect((naiveError as EngineError).message).toContain('joseph');
  });

  it('shows the square-root form surviving where even the Joseph form gives up', () => {
    /*
     * Three constant states with only their SUM measured, no process noise and
     * a measurement noise of 1e-14 against a prior of 1e9: a dynamic range of
     * 23 orders of magnitude between the measured direction and the two
     * unmeasured ones. Here even the Joseph form's explicit covariance loses
     * definiteness, while the square-root filter — which never forms P as a
     * sum or difference at all, only a triangular factor — comes through. That
     * is why both forms are offered rather than one.
     */
    const extreme: LinearGaussianModel = {
      A: [
        [1, 1, 0],
        [0, 1, 1],
        [0, 0, 1],
      ],
      C: [[1, 1, 1]],
      Q: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      R: [[1e-14]],
      mu0: [0, 0, 0],
      Sigma0: [
        [1e9, 0, 0],
        [0, 1e9, 0],
        [0, 0, 1e9],
      ],
    };
    const obs: Observation[] = Array.from({ length: 300 }, () => [1]);
    expect(() => kalmanFilter(extreme, obs, { form: 'joseph' })).toThrow(EngineError);
    const sqrt = kalmanFilter(extreme, obs, { form: 'sqrt' });
    expect(sqrt.steps).toHaveLength(300);
    expect(symmetricEigenvalues(sqrt.steps[299].filteredCov)[0]).toBeGreaterThanOrEqual(-1e-20);
  });
});

describe('missing observations', () => {
  it('matches a filter on the decimated series with the composed dynamics', () => {
    /*
     * Local level, 24 steps, with every observation at an EVEN index removed.
     * The first retained observation is at index 1, so exactly two transitions
     * separate consecutive retained observations: over two steps the composed
     * dynamics are A² = 1 and the accumulated process noise is 2q. A filter on
     * the decimated series with Q = 2q must therefore agree with the filter on
     * the full series at the retained times, to machine precision — nothing
     * about this involves an approximation.
     */
    const q = 0.4;
    const r = 0.9;
    const full: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[q]], R: [[r]], mu0: [0.2], Sigma0: [[1.5]] };
    const decimated: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[2 * q]], R: [[r]], mu0: [0.2], Sigma0: [[1.5]] };
    const rng = new Random('missing-observations');
    const sim = simulateLinearGaussian(full, 24, rng);
    const gappy: Observation[] = sim.observations.map((o, i) => (i % 2 === 1 ? o : null));
    const kept: Observation[] = sim.observations.filter((_, i) => i % 2 === 1);

    const gappyRun = kalmanFilter(full, gappy);
    const keptRun = kalmanFilter(decimated, kept);
    expect(gappyRun.warnings.join(' ')).toContain('no usable measurement');
    let j = 0;
    for (let t = 1; t < 24; t += 2) {
      expect(gappyRun.steps[t].filteredMean[0]).toBeCloseTo(keptRun.steps[j].filteredMean[0], 10);
      expect(gappyRun.steps[t].filteredCov[0][0]).toBeCloseTo(keptRun.steps[j].filteredCov[0][0], 10);
      j++;
    }
    expect(gappyRun.logLikelihood).toBeCloseTo(keptRun.logLikelihood, 10);
    // The skipped steps carry the prediction forward and widen, never impute.
    expect(gappyRun.steps[0].missing).toBe(true);
    expect(gappyRun.steps[0].innovation).toBeNull();
    expect(gappyRun.steps[0].filteredCov[0][0]).toBeGreaterThan(gappyRun.steps[1].filteredCov[0][0]);
  });

  it('handles a partially observed vector by using only the available channels', () => {
    const model: LinearGaussianModel = {
      A: [
        [1, 0],
        [0, 1],
      ],
      C: [
        [1, 0],
        [0, 1],
      ],
      Q: [
        [0.1, 0],
        [0, 0.1],
      ],
      R: [
        [1, 0],
        [0, 1],
      ],
      mu0: [0, 0],
      Sigma0: [
        [5, 0],
        [0, 5],
      ],
    };
    const partial = kalmanFilter(model, [[1, 2], [3, null], [null, 4]]);
    expect(partial.steps[1].innovation).toHaveLength(1);
    expect(partial.steps[2].innovation).toHaveLength(1);
    // The channel with no measurement at step 1 must not have been updated by it.
    expect(partial.steps[1].filteredCov[1][1]).toBeGreaterThan(partial.steps[1].filteredCov[0][0]);
  });
});

describe('observability and the steady-state gain', () => {
  it('accepts an observable system and refuses a steady-state gain for an unobservable one', () => {
    const observable = constantVelocityTracker({ dt: 1, accelerationNoise: 0.3, measurementNoise: 1 });
    const okStructure = structuralAnalysis(observable);
    expect(okStructure.observable).toBe(true);
    expect(okStructure.observabilityRank).toBe(2);
    expect(() => steadyStateGain(observable)).not.toThrow();

    // Two independent constant states, only the first measured: the second
    // never influences any measurement.
    const unobservable: LinearGaussianModel = {
      A: [
        [1, 0],
        [0, 1],
      ],
      C: [[1, 0]],
      Q: [
        [0.1, 0],
        [0, 0.1],
      ],
      R: [[1]],
      mu0: [0, 0],
      Sigma0: [
        [1, 0],
        [0, 1],
      ],
    };
    const bad = structuralAnalysis(unobservable);
    expect(bad.observable).toBe(false);
    expect(bad.observabilityRank).toBe(1);
    expect(bad.unobservableDimensions).toBe(1);
    expect(bad.warnings.join(' ')).toContain('NOT observable');
    expect(() => steadyStateGain(unobservable)).toThrow(EngineError);
    try {
      steadyStateGain(unobservable);
    } catch (e) {
      expect((e as EngineError).issues[0].code).toBe('unobservable');
      expect((e as EngineError).message).toContain('not observable');
    }
  });

  it('reports an uncontrollable but observable model without refusing it', () => {
    const trend = localLinearTrend({ levelNoise: 0.5, slopeNoise: 0, measurementNoise: 1 });
    const s = structuralAnalysis(trend);
    expect(s.observable).toBe(true);
    expect(s.controllable).toBe(false);
    expect(s.warnings.join(' ')).toContain('does not excite');
  });
});

describe('EM parameter learning', () => {
  it('never decreases the log-likelihood and recovers known noise levels', () => {
    /*
     * A local level model with q = 0.25 and r = 1 simulated for 3000 steps,
     * started from badly wrong noise levels. EM's log-likelihood is monotone by
     * construction, so ANY decrease is an implementation bug and is asserted
     * away entirely rather than tolerated.
     *
     * Recovery tolerance: the two variances of a local level model are
     * identified at a rate of roughly 1/√T, and with T = 3000 the standard
     * error on each is a few percent; 25% relative is a generous band that
     * still fails decisively if the M-step is wrong (the wrong start is off by
     * a factor of 16 in q and 9 in r).
     */
    const truth = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const rng = new Random('em-recovery');
    const sim = simulateLinearGaussian(truth, 3000, rng);
    const start: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[4]], R: [[9]], mu0: [0], Sigma0: [[1]] };
    const fit = fitByEm(start, sim.observations, { maxIterations: 300, tolerance: 1e-10, update: { A: false, C: false } });

    expect(fit.monotonicityViolations).toEqual([]);
    for (let i = 1; i < fit.logLikelihoodPath.length; i++) {
      expect(fit.logLikelihoodPath[i]).toBeGreaterThanOrEqual(fit.logLikelihoodPath[i - 1] - 1e-7 * (Math.abs(fit.logLikelihoodPath[i - 1]) + 1));
    }
    expect(fit.converged).toBe(true);
    const q = (fit.model.Q as number[][])[0][0];
    const r = (fit.model.R as number[][])[0][0];
    expect(q).toBeGreaterThan(0.25 * 0.75);
    expect(q).toBeLessThan(0.25 * 1.25);
    expect(r).toBeGreaterThan(1 * 0.75);
    expect(r).toBeLessThan(1 * 1.25);
    // The fit must beat the starting point it was given.
    expect(fit.logLikelihood).toBeGreaterThan(kalmanFilter(start, sim.observations).logLikelihood);
  });

  it('improves the likelihood at every single iteration of a short run', () => {
    const truth = localLinearTrend({ levelNoise: 0.3, slopeNoise: 0.05, measurementNoise: 1 });
    const rng = new Random('em-monotone-short');
    const sim = simulateLinearGaussian(truth, 400, rng);
    const start: LinearGaussianModel = {
      A: [
        [1, 1],
        [0, 1],
      ],
      C: [[1, 0]],
      Q: [
        [1, 0],
        [0, 1],
      ],
      R: [[5]],
      mu0: [0, 0],
      Sigma0: [
        [10, 0],
        [0, 1],
      ],
    };
    const it = emSteps(start, sim.observations, { maxIterations: 25, update: { A: false, C: false } });
    let step = it.next();
    let yields = 0;
    while (!step.done) {
      yields++;
      step = it.next();
    }
    expect(yields).toBeGreaterThan(1);
    const path = step.value.logLikelihoodPath;
    expect(step.value.monotonicityViolations).toEqual([]);
    for (let i = 1; i < path.length; i++) expect(path[i]).toBeGreaterThanOrEqual(path[i - 1] - 1e-9 * (Math.abs(path[i - 1]) + 1));
  });

  it('maximises the exact likelihood directly to the same place EM reaches', () => {
    const truth = localLevel({ levelNoise: 0.6, measurementNoise: 1.2, priorLevelSd: 1 });
    const rng = new Random('direct-likelihood');
    const sim = simulateLinearGaussian(truth, 800, rng);
    const start: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[1]], R: [[1]], mu0: [0], Sigma0: [[1]] };
    const em = fitByEm(start, sim.observations, { maxIterations: 400, tolerance: 1e-12, update: { A: false, C: false, mu0: false } });
    // Parameterised by log standard deviations so the search is unconstrained.
    const direct = maximiseLikelihood(
      (p) => ({ A: [[1]], C: [[1]], Q: [[Math.exp(2 * p[0])]], R: [[Math.exp(2 * p[1])]], mu0: [0], Sigma0: [[1]] }),
      [0, 0],
      sim.observations,
      { maxIterations: 4000, tolerance: 1e-12 },
    );
    expect(direct.converged).toBe(true);
    // Two different optimisers on the same exact likelihood must agree on its
    // value far more closely than on the parameters.
    expect(direct.logLikelihood).toBeCloseTo(em.logLikelihood, 4);
  });
});

describe('innovation whiteness diagnostic, in both directions', () => {
  const truth = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
  const rng = new Random('whiteness');
  const sim = simulateLinearGaussian(truth, 800, rng);

  it('does not reject a correctly specified model', () => {
    const run = kalmanFilter(truth, sim.observations);
    const w = innovationWhiteness(run.steps, { level: 0.95 });
    expect(w.rejected).toBe(false);
    expect(w.pValue).toBeGreaterThan(0.05);
    // The standardised innovations should have unit variance.
    expect(Math.abs(w.sampleCovariance[0][0] - 1)).toBeLessThan(0.15);
  });

  it('rejects when the process noise is understated by a factor of 10000', () => {
    // Too little assumed process noise makes the filter refuse to follow the
    // state; the innovations then inherit the state's own autocorrelation.
    const stiff = localLevel({ levelNoise: 0.005, measurementNoise: 1, priorLevelSd: 1 });
    const run = kalmanFilter(stiff, sim.observations);
    const w = innovationWhiteness(run.steps, { level: 0.95 });
    expect(w.rejected).toBe(true);
    expect(w.pValue).toBeLessThan(0.01);
    expect(w.warnings.join(' ')).toContain('NOT white');
  });

  it('flags a badly overstated process noise through the innovation covariance', () => {
    const loose = localLevel({ levelNoise: 50, measurementNoise: 1, priorLevelSd: 1 });
    const run = kalmanFilter(loose, sim.observations);
    const w = innovationWhiteness(run.steps, { level: 0.95 });
    expect(w.covarianceDeviation).toBeGreaterThan(0.5);
    expect(w.warnings.join(' ')).toContain('departing from the identity');
  });
});

describe('non-linear filters on the pendulum', () => {
  it('has the unscented filter beat the extended filter, with the EKF failure visible in its diagnostics', () => {
    /*
     * A pendulum released near the inverted region (2 radians), filtered from
     * a prior that starts at zero with a wide covariance, measured coarsely
     * (dt = 0.2, measurement noise 1.0). Over that width sin θ is nothing like
     * θ, so the EKF's linearisation about a single point is a poor description
     * of the propagated uncertainty.
     *
     * Two claims, both averaged over 12 fixed-seed realisations so neither is
     * one lucky path:
     *
     *  1. the UKF's angle error is lower than the EKF's;
     *  2. the EKF's failure is INVISIBLE in its own covariance and visible
     *     only from outside it. Its mean NEES comes out far above the state
     *     dimension of 2 — it is overconfident, exactly as the theory says a
     *     linearised filter becomes — while the UKF's sits near 2. The whole
     *     reason the diagnostics exist is that the EKF's reported covariance
     *     says nothing is wrong.
     */
    const config = {
      dt: 0.2,
      processNoise: 0.2,
      measurementNoise: 1,
      measure: 'angle' as const,
    };
    const truthModel = noisyPendulum({ ...config, initialAngle: 2, initialRate: 0, priorAngleSd: 0.01, priorRateSd: 0.01 });
    const filterModel = noisyPendulum({ ...config, initialAngle: 0, initialRate: 0, priorAngleSd: 3, priorRateSd: 3 });
    let ekfTotal = 0;
    let ukfTotal = 0;
    let ekfNeesTotal = 0;
    let ukfNeesTotal = 0;
    let ekfInconsistent = 0;
    let ukfInconsistent = 0;
    let ekfRejections = 0;
    let ukfRejections = 0;
    const realisations = 12;
    for (let i = 0; i < realisations; i++) {
      const rng = new Random(`pendulum-${i}`);
      const sim = simulateNonlinear(truthModel, 150, rng);
      const truth = sim.states.map((s) => s[0]);
      const ekf = extendedKalmanFilter(filterModel, sim.observations);
      const ukf = unscentedKalmanFilter(filterModel, sim.observations);
      ekfTotal += mse(ekf.steps.map((s) => s.filteredMean[0]), truth);
      ukfTotal += mse(ukf.steps.map((s) => s.filteredMean[0]), truth);
      const ekfNees = nees(ekf.steps, sim.states);
      const ukfNees = nees(ukf.steps, sim.states);
      ekfNeesTotal += ekfNees.mean;
      ukfNeesTotal += ukfNees.mean;
      if (!ekfNees.consistent) ekfInconsistent++;
      if (!ukfNees.consistent) ukfInconsistent++;
      if (innovationWhiteness(ekf.steps).rejected) ekfRejections++;
      if (innovationWhiteness(ukf.steps).rejected) ukfRejections++;
    }
    expect(ukfTotal).toBeLessThan(ekfTotal);
    // The EKF is overconfident by a factor of three in its NEES; the UKF is
    // calibrated. Expected value for a consistent filter is the state
    // dimension, 2.
    expect(ekfNeesTotal / realisations).toBeGreaterThan(4);
    expect(ukfNeesTotal / realisations).toBeLessThan(3);
    expect(ekfInconsistent).toBeGreaterThan(ukfInconsistent);
    expect(ekfRejections).toBeGreaterThanOrEqual(ukfRejections);
    // And the EKF's own covariance is small and respectable-looking throughout
    // — which is the failure mode: nothing inside the filter complains.
    const rng = new Random('pendulum-0');
    const sim = simulateNonlinear(truthModel, 150, rng);
    const ekf = extendedKalmanFilter(filterModel, sim.observations);
    expect(ekf.steps[149].filteredCov[0][0]).toBeLessThan(1);
  });

  it('labels the EKF as numerical and carries the divergence caveat', () => {
    const model = noisyPendulum({ dt: 0.05, processNoise: 0.2, measurementNoise: 0.2, initialAngle: 0.3 });
    const rng = new Random('ekf-caveat');
    const sim = simulateNonlinear(model, 40, rng);
    const ekf = extendedKalmanFilter(model, sim.observations);
    expect(ekf.exactness).toBe('numerical');
    expect(ekf.warnings.join(' ')).toContain('can diverge');
    expect(ekf.explanation.limitations.join(' ')).toContain('not the exact value');
    const ukf = unscentedKalmanFilter(model, sim.observations);
    expect(ukf.exactness).toBe('numerical');
    expect(ukf.method).toBe('ukf');
  });

  it('matches the Kalman filter on a linear model, as both approximations must', () => {
    // Exactness check for the non-linear machinery: given a linear f and h the
    // EKF and the UKF both reduce to the Kalman filter.
    const lin = localLinearTrend({ levelNoise: 0.4, slopeNoise: 0.1, measurementNoise: 0.8, priorLevelSd: 2, priorSlopeSd: 1 });
    const rng = new Random('linear-reduction');
    const sim = simulateLinearGaussian(lin, 60, rng);
    const exact = kalmanFilter(lin, sim.observations);
    const asNonlinear = {
      stateDim: 2,
      obsDim: 1,
      f: (x: number[]) => [x[0] + x[1], x[1]],
      h: (x: number[]) => [x[0]],
      jacobianF: () => [
        [1, 1],
        [0, 1],
      ],
      jacobianH: () => [[1, 0]],
      Q: lin.Q as number[][],
      R: lin.R as number[][],
      mu0: lin.mu0,
      Sigma0: lin.Sigma0,
    };
    const ekf = extendedKalmanFilter(asNonlinear, sim.observations);
    const ukf = unscentedKalmanFilter(asNonlinear, sim.observations);
    for (let t = 0; t < 60; t++) {
      expect(ekf.steps[t].filteredMean[0]).toBeCloseTo(exact.steps[t].filteredMean[0], 9);
      expect(ukf.steps[t].filteredMean[0]).toBeCloseTo(exact.steps[t].filteredMean[0], 7);
      expect(ukf.steps[t].filteredCov[0][0]).toBeCloseTo(exact.steps[t].filteredCov[0][0], 7);
    }
    expect(ekf.approximateLogLikelihood).toBeCloseTo(exact.logLikelihood, 8);
  });

  it('falls back to a numerical Jacobian and says that it did', () => {
    const growth = univariateGrowth({ rate: 0.3, capacity: 100, processNoise: 1, measurementNoise: 2, initialLevel: 5 });
    const rng = new Random('numerical-jacobian');
    const sim = simulateNonlinear(growth, 40, rng);
    const analytic = extendedKalmanFilter(growth, sim.observations);
    const { jacobianF: _f, jacobianH: _h, ...withoutJacobians } = growth;
    const numeric = extendedKalmanFilter(withoutJacobians, sim.observations);
    expect(analytic.numericalJacobian).toBe(false);
    expect(numeric.numericalJacobian).toBe(true);
    expect(numeric.warnings.join(' ')).toContain('finite differences');
    // Close, but not identical — which is exactly why it is labelled.
    expect(numeric.steps[39].filteredMean[0]).toBeCloseTo(analytic.steps[39].filteredMean[0], 5);
  });
});

describe('particle filters', () => {
  it('converges to the exact Kalman mean at a rate consistent with 1/sqrt(N)', () => {
    /*
     * The strongest test available for a particle filter: on a linear-Gaussian
     * model the exact filtered mean is known, so the particle error can be
     * measured rather than guessed. Averaged over 4 seeds per particle count to
     * damp the seed-to-seed variation. The assertion is that the error falls,
     * and that the fall from N = 250 to N = 16000 (a factor of 64 in N, so 8 in
     * √N) lies between 3 and 25 — a band wide enough that Monte Carlo noise in
     * the estimate of the rate cannot fail it, and narrow enough to rule out
     * both no convergence and a wrong rate.
     */
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const pm = linearGaussianAsParticleModel(model);
    const rng = new Random('pf-vs-kf-data');
    const sim = simulateLinearGaussian(model, 30, rng);
    const exact = kalmanFilter(model, sim.observations);
    const exactMeans = exact.steps.map((s) => s.filteredMean[0]);

    const counts = [250, 1000, 4000, 16000];
    const errors = counts.map((N) => {
      let total = 0;
      for (let seed = 0; seed < 4; seed++) {
        const r = new Random(`pf-${N}-${seed}`);
        const run = bootstrapParticleFilter(pm, sim.observations, r, { particles: N });
        expect(run.exactness).toBe('empirical');
        total += Math.sqrt(mse(run.steps.map((s) => s.mean[0]), exactMeans));
      }
      return total / 4;
    });
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThan(errors[i - 1]);
    const ratio = errors[0] / errors[errors.length - 1];
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(25);
    // And the likelihood estimate should be near the exact value.
    const r = new Random('pf-loglik');
    const run = bootstrapParticleFilter(pm, sim.observations, r, { particles: 20000 });
    expect(run.logLikelihood).toBeCloseTo(exact.logLikelihood, 0);
  });

  it('keeps a healthy effective sample size on a well-specified run', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const pm = linearGaussianAsParticleModel(model);
    const rng = new Random('ess-healthy-data');
    const sim = simulateLinearGaussian(model, 100, rng);
    const run = bootstrapParticleFilter(pm, sim.observations, new Random('ess-healthy'), { particles: 2000 });
    expect(run.minEss / run.particles).toBeGreaterThan(0.1);
    expect(run.degenerateSteps).toEqual([]);
    expect(run.warnings.join(' ')).not.toContain('DEGENERACY');
    expect(run.monteCarloStandardError[0]).toBeGreaterThan(0);
    // The Monte Carlo error of the mean is far smaller than the posterior
    // spread: they are different quantities and must not be confused.
    expect(run.monteCarloStandardError[0]).toBeLessThan(Math.sqrt(run.steps[99].covariance[0][0]));
  });

  it('collapses the effective sample size on an outlier and warns loudly', () => {
    const model = localLevel({ levelNoise: 0.2, measurementNoise: 0.5, priorLevelSd: 0.5 });
    const pm = linearGaussianAsParticleModel(model);
    const rng = new Random('ess-collapse-data');
    const sim = simulateLinearGaussian(model, 40, rng);
    const poisoned = sim.observations.slice();
    poisoned[20] = [8]; // Sixteen measurement standard deviations away.
    const run = bootstrapParticleFilter(pm, poisoned, new Random('ess-collapse'), { particles: 2000 });
    expect(run.degenerateSteps).toContain(20);
    expect(run.minEss).toBeLessThan(0.1 * run.particles);
    expect(run.warnings.join(' ')).toContain('WEIGHT DEGENERACY');
  });

  it('refuses rather than renormalising when every weight is zero', () => {
    // A model with bounded measurement support: an observation outside it is
    // impossible under the model, not merely unlikely.
    const bounded: ParticleModel = {
      stateDim: 1,
      obsDim: 1,
      sampleInitial: (normal) => [normal()],
      samplePropagate: (x, _t, normal) => [x[0] + 0.1 * normal()],
      logObservationDensity: (y, x) => (Math.abs(y[0] - x[0]) <= 1 ? -Math.log(2) : -Infinity),
    };
    expect(() => bootstrapParticleFilter(bounded, [[0.2], [50]], new Random('zero-weights'), { particles: 200 })).toThrow(EngineError);
    try {
      bootstrapParticleFilter(bounded, [[0.2], [50]], new Random('zero-weights'), { particles: 200 });
    } catch (e) {
      expect((e as EngineError).message).toContain('probability of zero');
      expect((e as EngineError).message).toContain('NOT renormalised');
    }
  });

  it('runs the auxiliary filter on the stochastic volatility model', () => {
    const sv = stochasticVolatility({ mu: -1, phi: 0.95, sigma: 0.3 });
    const rng = new Random('sv-data');
    // Simulate from the model definition itself, using its own samplers.
    const normal = () => rng.normal();
    const uniform = () => rng.uniform();
    let h = sv.sampleInitial(normal, uniform);
    const obs: Observation[] = [];
    for (let t = 0; t < 120; t++) {
      h = sv.samplePropagate(h, t, normal, uniform);
      obs.push([Math.exp(h[0] / 2) * rng.normal()]);
    }
    const boot = bootstrapParticleFilter(sv, obs, new Random('sv-boot'), { particles: 2000 });
    const aux = auxiliaryParticleFilter(sv, obs, new Random('sv-aux'), { particles: 2000 });
    expect(boot.method).toBe('bootstrap');
    expect(aux.method).toBe('auxiliary');
    expect(aux.steps).toHaveLength(120);
    // Two different filters on the same data should agree on the latent level.
    const bootMean = boot.steps.map((s) => s.mean[0]);
    const auxMean = aux.steps.map((s) => s.mean[0]);
    expect(Math.sqrt(mse(bootMean, auxMean))).toBeLessThan(0.5);
    expect(aux.explanation.exactness).toBe('empirical');
  });

  it('smooths with forward-filtering backward-sampling and with a fixed lag', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const pm = linearGaussianAsParticleModel(model);
    const rng = new Random('smoothing-data');
    const sim = simulateLinearGaussian(model, 40, rng);
    const exactSmooth = kalmanSmoother(model, sim.observations).smoothedMean.map((m) => m[0]);

    const run = bootstrapParticleFilter(pm, sim.observations, new Random('ffbs-filter'), {
      particles: 3000,
      history: true,
      fixedLag: 5,
    });
    const ffbs = particleSmootherFFBS(pm, run, new Random('ffbs-backward'), { trajectories: 300 });
    expect(ffbs.method).toBe('ffbs');
    expect(ffbs.smoothedMean).toHaveLength(40);
    // 300 trajectories from 3000 particles: a Monte Carlo answer to a problem
    // whose exact answer is known. The state standard deviation here is about
    // 0.5, so 0.25 is a loose but meaningful band.
    expect(Math.sqrt(mse(ffbs.smoothedMean.map((m) => m[0]), exactSmooth))).toBeLessThan(0.25);
    // The smoother should be closer to the truth than the filter was.
    const truth = sim.states.map((s) => s[0]);
    expect(mse(ffbs.smoothedMean.map((m) => m[0]), truth)).toBeLessThan(mse(run.steps.map((s) => s.mean[0]), truth));

    const lagged = fixedLagSmoother(run);
    expect(lagged.method).toBe('fixed-lag');
    expect(lagged.lag).toBe(5);
    expect(lagged.smoothedMean).toHaveLength(40 - 5);
    expect(lagged.explanation.limitations.join(' ')).toContain('Path degeneracy');
  });

  it('refuses to smooth without the stored history it needs', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const pm = linearGaussianAsParticleModel(model);
    const rng = new Random('no-history');
    const sim = simulateLinearGaussian(model, 10, rng);
    const run = bootstrapParticleFilter(pm, sim.observations, new Random('no-history-run'), { particles: 100 });
    expect(() => particleSmootherFFBS(pm, run, new Random('x'))).toThrow(EngineError);
    expect(() => fixedLagSmoother(run)).toThrow(EngineError);
  });

  it('refuses zero particles', () => {
    const pm = linearGaussianAsParticleModel(localLevel({ levelNoise: 1, measurementNoise: 1 }));
    expect(() => bootstrapParticleFilter(pm, [[1]], new Random('zero'), { particles: 0 })).toThrow(EngineError);
    try {
      bootstrapParticleFilter(pm, [[1]], new Random('zero'), { particles: 0 });
    } catch (e) {
      expect((e as EngineError).message).toContain('no representation of the state');
    }
  });

  it('marginalises the linear part exactly in the Rao-Blackwellised filter', () => {
    /*
     * A Rao-Blackwellised filter whose non-linear part is a constant (so every
     * particle carries the same conditional model) must reproduce the exact
     * Kalman filter on the linear part, because the only approximation left —
     * the sampling of the non-linear state — has nothing to sample. That makes
     * the exact Kalman answer a reference value for the marginalisation.
     */
    const linear = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 2 });
    const rng = new Random('rb-data');
    const sim = simulateLinearGaussian(linear, 40, rng);
    const exact = kalmanFilter(linear, sim.observations);
    const rb = raoBlackwellisedParticleFilter(
      {
        nonlinearDim: 1,
        linearDim: 1,
        obsDim: 1,
        sampleInitialNonlinear: () => [0],
        sampleNonlinear: () => [0],
        linear: () => ({ A: [[1]], Q: [[0.25]], C: [[1]], R: [[1]] }),
        mu0: linear.mu0,
        Sigma0: linear.Sigma0,
      },
      sim.observations,
      new Random('rb-run'),
      { particles: 50 },
    );
    expect(rb.method).toBe('rao-blackwellised');
    for (let t = 0; t < 40; t++) {
      expect(rb.linearMean[t][0]).toBeCloseTo(exact.steps[t].filteredMean[0], 9);
      expect(rb.linearCov[t][0][0]).toBeCloseTo(exact.steps[t].filteredCov[0][0], 9);
    }
    expect(rb.logLikelihood).toBeCloseTo(exact.logLikelihood, 8);
  });
});

describe('resampling schemes', () => {
  const schemes = ['multinomial', 'stratified', 'systematic', 'residual'] as const;
  const N = 20;
  // A deliberately uneven weight vector: equal weights would make every scheme
  // look identical.
  const raw = Array.from({ length: N }, (_, i) => (i + 1) ** 1.5);
  const total = raw.reduce((a, b) => a + b, 0);
  const weights = raw.map((v) => v / total);

  it('is unbiased for every scheme: the expected copy count is N times the weight', () => {
    /*
     * 6000 replications per scheme with a fixed seed. The count of copies of
     * particle i has mean N·w_i; for multinomial its standard deviation is
     * √(N w (1−w)) ≤ √(N/4) = 2.24, so the standard error of the mean over
     * 6000 replications is at most 0.029. A tolerance of 0.12 is four times
     * that, and the low-variance schemes are tighter still.
     */
    const reps = 6000;
    for (const scheme of schemes) {
      const rng = new Random(`unbiased-${scheme}`);
      const counts = new Array<number>(N).fill(0);
      for (let r = 0; r < reps; r++) {
        const idx = resampleIndices(weights, scheme, rng);
        expect(idx).toHaveLength(N);
        for (const i of idx) counts[i]++;
      }
      for (let i = 0; i < N; i++) {
        expect(counts[i] / reps).toBeCloseTo(N * weights[i], 1);
        expect(Math.abs(counts[i] / reps - N * weights[i])).toBeLessThan(0.12);
      }
    }
  });

  it('has lower count variance for stratified and systematic than for multinomial', () => {
    const reps = 3000;
    const variance = (scheme: (typeof schemes)[number]): number => {
      const rng = new Random(`variance-${scheme}`);
      const sums = new Array<number>(N).fill(0);
      const sumSquares = new Array<number>(N).fill(0);
      for (let r = 0; r < reps; r++) {
        const counts = new Array<number>(N).fill(0);
        for (const i of resampleIndices(weights, scheme, rng)) counts[i]++;
        for (let i = 0; i < N; i++) {
          sums[i] += counts[i];
          sumSquares[i] += counts[i] * counts[i];
        }
      }
      let totalVar = 0;
      for (let i = 0; i < N; i++) {
        const m = sums[i] / reps;
        totalVar += sumSquares[i] / reps - m * m;
      }
      return totalVar;
    };
    const multinomial = variance('multinomial');
    expect(variance('stratified')).toBeLessThan(multinomial);
    expect(variance('systematic')).toBeLessThan(multinomial);
    // Systematic bounds |n_i − N w_i| below 1, so its variance is the smallest.
    expect(variance('systematic')).toBeLessThanOrEqual(variance('stratified') * 1.05);
  });

  it('refuses an all-zero weight vector and an empty one', () => {
    expect(() => resampleIndices([0, 0, 0], 'systematic', new Random('z'))).toThrow(EngineError);
    expect(() => resampleIndices([], 'systematic', new Random('z'))).toThrow(EngineError);
    expect(() => resampleIndices([0.5, -0.1], 'systematic', new Random('z'))).toThrow(EngineError);
  });
});

describe('generators, determinism and cancellation', () => {
  it('yields more than once and returns a partial result when cancelled', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const rng = new Random('cancel-data');
    const sim = simulateLinearGaussian(model, 500, rng);
    const it = kalmanFilterSteps(model, sim.observations, { chunk: 50, isCancelled: () => true });
    let yields = 0;
    let step = it.next();
    while (!step.done) {
      yields++;
      step = it.next();
    }
    expect(yields).toBeGreaterThanOrEqual(1);
    expect(step.value.partial).toBe(true);
    expect(step.value.steps.length).toBeLessThan(500);
    expect(step.value.warnings.join(' ')).toContain('cancelled');

    const full = kalmanFilterSteps(model, sim.observations, { chunk: 50 });
    let n = 0;
    let s = full.next();
    while (!s.done) {
      n++;
      s = full.next();
    }
    expect(n).toBeGreaterThan(1);
    expect(s.value.partial).toBe(false);
    expect(s.value.steps).toHaveLength(500);
  });

  it('yields from the particle filter and cancels it', () => {
    const pm = linearGaussianAsParticleModel(localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 }));
    const rng = new Random('pf-cancel-data');
    const sim = simulateLinearGaussian(localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 }), 300, rng);
    const it = sequentialImportanceResamplingSteps(pm, sim.observations, new Random('pf-cancel'), {
      particles: 200,
      chunk: 20,
      isCancelled: () => true,
    });
    let yields = 0;
    let step = it.next();
    while (!step.done) {
      yields++;
      step = it.next();
    }
    expect(yields).toBeGreaterThanOrEqual(1);
    expect(step.value.partial).toBe(true);
    expect(step.value.steps.length).toBeLessThan(300);
  });

  it('is deterministic under a fixed seed', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 1, priorLevelSd: 1 });
    const pm = linearGaussianAsParticleModel(model);
    const a = simulateLinearGaussian(model, 30, new Random('determinism'));
    const b = simulateLinearGaussian(model, 30, new Random('determinism'));
    expect(a.values).toEqual(b.values);
    const run1 = bootstrapParticleFilter(pm, a.observations, new Random('pf-determinism'), { particles: 500 });
    const run2 = bootstrapParticleFilter(pm, a.observations, new Random('pf-determinism'), { particles: 500 });
    expect(run1.steps.map((s) => s.mean[0])).toEqual(run2.steps.map((s) => s.mean[0]));
    expect(run1.logLikelihood).toBe(run2.logLikelihood);
  });
});

describe('refusals', () => {
  const base: LinearGaussianModel = { A: [[1]], C: [[1]], Q: [[1]], R: [[1]], mu0: [0], Sigma0: [[1]] };

  it('names the offending pair on a dimension mismatch', () => {
    const wrongC: LinearGaussianModel = { ...base, A: [[1, 0], [0, 1]], mu0: [0, 0], Sigma0: [[1, 0], [0, 1]], Q: [[1, 0], [0, 1]], C: [[1, 0, 0]] };
    expect(() => kalmanFilter(wrongC, [[1]])).toThrow(/C and A disagree/);
    const wrongQ: LinearGaussianModel = { ...base, A: [[1, 0], [0, 1]], mu0: [0, 0], Sigma0: [[1, 0], [0, 1]], C: [[1, 0]], Q: [[1]] };
    expect(() => kalmanFilter(wrongQ, [[1]])).toThrow(/Q and A disagree/);
    const wrongR: LinearGaussianModel = { ...base, R: [[1, 0], [0, 1]] };
    expect(() => kalmanFilter(wrongR, [[1]])).toThrow(/R and C disagree/);
    const wrongMu: LinearGaussianModel = { ...base, mu0: [0, 0] };
    expect(() => kalmanFilter(wrongMu, [[1]])).toThrow(/mu0/);
  });

  it('refuses a prior covariance that is not positive semi-definite', () => {
    const bad: LinearGaussianModel = {
      A: [[1, 0], [0, 1]],
      C: [[1, 0]],
      Q: [[1, 0], [0, 1]],
      R: [[1]],
      mu0: [0, 0],
      Sigma0: [
        [1, 2],
        [2, 1],
      ],
    };
    expect(() => kalmanFilter(bad, [[1]])).toThrow(EngineError);
    try {
      kalmanFilter(bad, [[1]]);
    } catch (e) {
      expect((e as EngineError).message).toContain('not positive semi-definite');
      expect((e as EngineError).message).toContain('pivot');
    }
  });

  it('refuses a measurement-noise covariance that is singular', () => {
    expect(() => kalmanFilter({ ...base, R: [[0]] }, [[1]])).toThrow(/not positive definite/);
  });

  it('reports the index of a non-finite observation', () => {
    expect(() => kalmanFilter(base, [[1], [2], [Number.NaN]])).toThrow(/Observation 2, component 0/);
    expect(() => kalmanFilter(base, [[1], [Number.POSITIVE_INFINITY]])).toThrow(/Observation 1, component 0/);
    // And it tells the caller what to do instead.
    try {
      kalmanFilter(base, [[Number.NaN]]);
    } catch (e) {
      expect((e as EngineError).message).toContain('null');
    }
  });

  it('refuses an empty observation sequence', () => {
    expect(() => kalmanFilter(base, [])).toThrow(/at least one time step/);
  });

  it('refuses EM on a series too short to estimate a transition', () => {
    expect(() => fitByEm(base, [[1]])).toThrow(/at least 2 time steps/);
  });

  it('refuses a whiteness test with too few innovations to mean anything', () => {
    const run = kalmanFilter(base, [[1], [2], [3]]);
    expect(() => innovationWhiteness(run.steps)).toThrow(/at least 8/);
  });

  it('refuses a steady-state gain for a time-varying model', () => {
    const varying: LinearGaussianModel = { ...base, A: [[[1]], [[1]]] };
    expect(() => steadyStateGain(varying)).toThrow(/time-invariant/);
  });
});

describe('time-varying models', () => {
  it('uses the matrices supplied for each step', () => {
    /*
     * Measuring the state at the first step and nothing informative at the
     * second (via a huge R) must leave the second step's posterior essentially
     * equal to its prediction — an independent consequence of using the
     * per-step matrices rather than the first one twice.
     */
    const model: LinearGaussianModel = {
      A: [[[1]], [[1]]],
      C: [[[1]], [[1]]],
      Q: [[[0]], [[0]]],
      R: [[[1]], [[1e12]]],
      mu0: [0],
      Sigma0: [[1]],
    };
    const run = kalmanFilter(model, [[2], [100]]);
    expect(run.steps[0].filteredMean[0]).toBeCloseTo(1, 12); // gain 1/2 on an observation of 2
    expect(run.steps[1].filteredMean[0]).toBeCloseTo(run.steps[1].predictedMean[0], 6);
    expect(run.steps[1].filteredCov[0][0]).toBeCloseTo(run.steps[0].filteredCov[0][0], 6);
  });
});

describe('state uncertainty is kept distinct from observation spread', () => {
  it('reports a predictive observation covariance wider than the state covariance by R', () => {
    const model = localLevel({ levelNoise: 0.5, measurementNoise: 2, priorLevelSd: 1 });
    const rng = new Random('state-vs-observation');
    const sim = simulateLinearGaussian(model, 50, rng);
    const run = kalmanFilter(model, sim.observations);
    const last = run.steps[49];
    expect(last.observationPredCov).not.toBeNull();
    const S = (last.observationPredCov as number[][])[0][0];
    // S = C P_pred Cᵀ + R, so it exceeds both the predicted and the filtered
    // state variance by at least R = 4.
    expect(S).toBeCloseTo(last.predictedCov[0][0] + 4, 10);
    expect(S).toBeGreaterThan(last.filteredCov[0][0] + 4);
    expect(run.explanation.limitations.join(' ')).toContain('uncertainty in the STATE');
  });
});

describe('model library', () => {
  it('builds every catalogued model and filters it', () => {
    const cv = constantVelocityTracker({ dt: 1, accelerationNoise: 0.1, measurementNoise: 1 });
    expect(cv.stateNames).toEqual(['position', 'velocity']);
    const ll = localLevel({ levelNoise: 1, measurementNoise: 1 });
    const lt = localLinearTrend({ levelNoise: 1, slopeNoise: 0.1, measurementNoise: 1 });
    for (const m of [cv, ll, lt]) {
      const sim = simulateLinearGaussian(m, 20, new Random(`library-${m.stateNames?.join()}`));
      expect(kalmanFilter(m, sim.observations).steps).toHaveLength(20);
    }
    const pend = noisyPendulum({ dt: 0.05, processNoise: 0.1, measurementNoise: 0.1, initialAngle: 0.5 });
    const growth = univariateGrowth({ rate: 0.2, capacity: 50, processNoise: 0.5, measurementNoise: 1, initialLevel: 2 });
    for (const m of [pend, growth]) {
      const sim = simulateNonlinear(m, 20, new Random(`library-nl-${m.stateDim}`));
      expect(unscentedKalmanFilter(m, sim.observations).steps).toHaveLength(20);
    }
    expect(() => stochasticVolatility({ mu: 0, phi: 1, sigma: 0.2 })).toThrow(/stationary/);
    expect(() => constantVelocityTracker({ dt: 0, accelerationNoise: 1, measurementNoise: 1 })).toThrow(EngineError);
  });
});
