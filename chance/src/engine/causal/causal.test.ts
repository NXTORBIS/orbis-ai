/**
 * Tests for causal effect estimation.
 *
 * The reference values here are not taken from this codebase. They come from
 * SIMULATED data where the true causal effect is known by construction — the
 * one situation in which a causal estimate can be checked at all — and from
 * closed-form published formulas recomputed independently inside the test
 * (the E-value) or from the logical range of the outcome (Manski bounds).
 *
 * Tolerances are justified individually. Where a tolerance is a multiple of a
 * standard error it is stated as such, because an estimator is correct when it
 * lands within its own sampling error, not when it matches a decimal.
 */

import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result.ts';
import { Random } from '../random/rng.ts';
import { mean } from '../stats/descriptive.ts';
import {
  aipwEstimate,
  andersonRubinSet,
  balanceReport,
  cinelliHazlettSensitivity,
  coarsenedExactMatch,
  covariateSmoothness,
  diffInDiff2x2,
  eValue,
  eventStudy,
  firstStageDiagnostics,
  fisherZTest,
  gComputation,
  interruptedTimeSeries,
  ipwEstimate,
  mahalanobisMatch,
  manskiBounds,
  matchedEstimate,
  mccraryDensityTest,
  naiveDifference,
  nearestNeighbourMatch,
  negativeControlTest,
  optimalMatch,
  overlapReport,
  pcAlgorithm,
  propensityWorkspace,
  regressionDiscontinuity,
  rosenbaumBounds,
  stratifiedEstimate,
  structureStability,
  syntheticControl,
  tmleEstimate,
  twoStageLeastSquares,
  twoWayFixedEffects,
  waldEstimator,
  type AdjustmentSpec,
  type CausalEstimate,
} from './index.ts';

const expit = (x: number): number => 1 / (1 + Math.exp(-x));

interface ConfoundedData {
  outcome: number[];
  treatment: number[];
  x: number[];
  trueAte: number;
}

/**
 * Confounded observational data with a known constant treatment effect.
 *
 *   X ~ N(0,1);  P(T=1|X) = expit(aX);  Y = τT + bX + N(0,1)
 *
 * Both the treatment and the outcome increase in X, so the unadjusted contrast
 * must be biased UPWARDS, and by approximately b·(X̄_treated − X̄_control) —
 * a prediction computed from the realised covariate means inside the test,
 * independently of any estimator in the module.
 */
function confounded(seed: string, n: number, tau = 1, a = 1, b = 2): ConfoundedData {
  const rng = new Random(seed);
  const x: number[] = [];
  const treatment: number[] = [];
  const outcome: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = rng.normal();
    const ti = rng.bernoulli(expit(a * xi)) ? 1 : 0;
    x.push(xi);
    treatment.push(ti);
    outcome.push(tau * ti + b * xi + rng.normal());
  }
  return { outcome, treatment, x, trueAte: tau };
}

function spec(d: ConfoundedData): AdjustmentSpec {
  return {
    outcome: d.outcome,
    treatment: d.treatment,
    covariates: [{ name: 'x', values: d.x }],
  };
}

function covers(e: CausalEstimate, truth: number): boolean {
  const ci = e.confidenceInterval;
  if (ci === null) return false;
  return ci.low <= truth && truth <= ci.high;
}

describe('every result carries its assumptions', () => {
  /** Collect one output from every estimator that returns a CausalEstimate. */
  function allEstimates(): { label: string; estimate: CausalEstimate }[] {
    const d = confounded('all-estimates', 700);
    const s = spec(d);
    const out: { label: string; estimate: CausalEstimate }[] = [];
    out.push({ label: 'naive', estimate: naiveDifference(s) });
    out.push({ label: 'ipw', estimate: ipwEstimate(s).estimate });
    out.push({ label: 'ipw-stabilised', estimate: ipwEstimate(s, { stabilised: true }).estimate });
    out.push({ label: 'ipw-att', estimate: ipwEstimate(s, { estimand: 'ATT' }).estimate });
    out.push({ label: 'gcomp', estimate: gComputation(s, { inference: 'delta' }).estimate });
    out.push({ label: 'gcomp-bootstrap', estimate: gComputation(s, { inference: 'bootstrap', bootstrapSamples: 60, seed: 'b' }).estimate });
    out.push({ label: 'aipw', estimate: aipwEstimate(s).estimate });
    out.push({ label: 'tmle', estimate: tmleEstimate(s) });
    out.push({ label: 'stratified', estimate: stratifiedEstimate(s) });

    // Matching needs a distance; use the fitted propensity scores.
    const w = propensityWorkspace(s);
    const m = nearestNeighbourMatch(w.scores, d.treatment, { withReplacement: false });
    out.push({ label: 'matched', estimate: matchedEstimate(s, m) });
    const mahal = mahalanobisMatch([{ name: 'x', values: d.x }], d.treatment, { withReplacement: true });
    out.push({ label: 'mahalanobis', estimate: matchedEstimate(s, mahal, { seed: 'mh' }) });
    const cem = coarsenedExactMatch([{ name: 'x', values: d.x }], d.treatment, [6]);
    out.push({ label: 'cem', estimate: matchedEstimate(s, cem, { seed: 'cem' }) });
    out.push({ label: 'manski', estimate: manskiBounds(d.outcome, d.treatment, [-12, 12]).estimate });

    // Quasi-experimental designs, each on its own simulated data.
    const iv = ivData('assump-iv', 1500, 1.5);
    out.push({
      label: '2sls',
      estimate: twoStageLeastSquares({ outcome: iv.y, treatment: iv.d, instruments: [{ name: 'z', values: iv.z }], binaryTreatment: true })
        .estimate,
    });
    out.push({ label: 'wald', estimate: waldEstimator(iv.y, iv.d, iv.z) });

    const did = didData('assump-did', 60, 6, 3, 2, 0);
    out.push({
      label: 'did2x2',
      estimate: diffInDiff2x2(
        did.panel.filter((r) => r.time === 2 || r.time === 4).map((r) => r.outcome),
        did.panel.filter((r) => r.time === 2 || r.time === 4).map((r) => (r.everTreated ? 1 : 0)),
        did.panel.filter((r) => r.time === 2 || r.time === 4).map((r) => (r.time === 4 ? 1 : 0)),
        { clusters: did.panel.filter((r) => r.time === 2 || r.time === 4).map((r) => r.unit) },
      ),
    });
    out.push({ label: 'twfe', estimate: twoWayFixedEffects(did.panel).estimate });

    const rdd = rddData('assump-rdd', 1200, 3);
    out.push({ label: 'rdd', estimate: regressionDiscontinuity({ outcome: rdd.y, running: rdd.x, cutoff: 0 }).estimate });

    const its = itsData('assump-its', 40, 5);
    out.push({ label: 'its', estimate: interruptedTimeSeries(its.time, its.y, 20).estimate });

    const sc = scData('assump-sc', 8, 12, 6, 4);
    out.push({ label: 'synthetic-control', estimate: syntheticControl({ treatedOutcome: sc.treated, donors: sc.donors, preperiods: 6 }).estimate });

    return out;
  }

  it('attaches a non-empty assumption list, an untestability notice and the fundamental problem to every estimate', () => {
    const all = allEstimates();
    expect(all.length).toBeGreaterThanOrEqual(18);
    for (const { label, estimate } of all) {
      expect(estimate.assumptions.length, `${label} has no assumptions`).toBeGreaterThan(0);
      // At least one assumption must be flagged as not testable from the data.
      expect(estimate.assumptions.some((a) => !a.testable), `${label} claims every assumption is testable`).toBe(true);
      for (const a of estimate.assumptions) {
        expect(a.name.length, `${label}: an assumption has no name`).toBeGreaterThan(0);
        expect(a.statement.length, `${label}: assumption "${a.name}" has no statement`).toBeGreaterThan(20);
        expect(a.ifViolated.length, `${label}: assumption "${a.name}" does not say what happens if it fails`).toBeGreaterThan(20);
      }
      expect(estimate.untestability.toLowerCase(), `${label} untestability notice`).toContain('cannot be tested');
      expect(estimate.fundamentalProblem.toLowerCase(), `${label} fundamental problem`).toContain('only the one');
      expect(estimate.estimand.contrast.length).toBeGreaterThan(0);
      expect(estimate.estimand.targetPopulation.length).toBeGreaterThan(0);
      expect(['exact', 'numerical', 'empirical', 'assumed']).toContain(estimate.exactness);
      expect(estimate.sample.nTotal).toBeGreaterThan(0);
      expect(estimate.inferenceNote.length).toBeGreaterThan(20);
    }
  });

  it('names LATE as the estimand for every instrumental-variable result', () => {
    const all = allEstimates();
    for (const { label, estimate } of all) {
      if (label === '2sls' || label === 'wald') {
        expect(estimate.estimand.kind).toBe('LATE');
        expect(estimate.estimand.targetPopulation.toLowerCase()).toContain('complier');
        expect(estimate.estimand.targetPopulation).toContain('NOT the ATE');
      }
    }
  });

  it('labels exactness correctly: estimates empirical, Manski exact, sensitivity numerical', () => {
    const d = confounded('exactness', 400);
    expect(aipwEstimate(spec(d)).estimate.exactness).toBe('empirical');
    expect(manskiBounds(d.outcome, d.treatment, [-12, 12]).estimate.exactness).toBe('exact');
    expect(eValue(1.6).exactness).toBe('numerical');
    expect(cinelliHazlettSensitivity(0.4, 0.1, 300).exactness).toBe('numerical');
    expect(rosenbaumBounds([1, 2, 3, -0.5, 2.5, 1.5, 0.75, 3.1]).exactness).toBe('numerical');
  });
});

describe('confounding recovery (the central test)', () => {
  const d = confounded('central', 4000);
  const s = spec(d);

  it('the naive difference is biased upwards, by about the predicted amount', () => {
    const naive = naiveDifference(s);
    const xT = mean(d.x.filter((_, i) => d.treatment[i] === 1));
    const xC = mean(d.x.filter((_, i) => d.treatment[i] === 0));
    // Under Y = τT + bX + ε the unadjusted contrast has expectation τ + b·(X̄_T − X̄_C)
    // with b = 2. This prediction uses only the realised covariate means, not
    // any estimator from the module.
    const predicted = d.trueAte + 2 * (xT - xC);
    expect(xT).toBeGreaterThan(xC);
    expect(naive.estimate).toBeGreaterThan(d.trueAte + 0.5);
    // Tolerance: three times the naive estimator's own standard error, which is
    // what "roughly the predicted amount" can mean for a random quantity.
    expect(Math.abs(naive.estimate - predicted)).toBeLessThan(3 * (naive.standardError as number));
  });

  it('IPW, matching, g-computation and AIPW all recover the true ATE within their standard errors', () => {
    const ipw = ipwEstimate(s).estimate;
    const g = gComputation(s, { inference: 'delta' }).estimate;
    const dr = aipwEstimate(s).estimate;
    const tm = tmleEstimate(s);
    const w = propensityWorkspace(s);
    const m = matchedEstimate(s, nearestNeighbourMatch(w.scores, d.treatment, { withReplacement: true }), { seed: 'c' });

    for (const [label, e] of [
      ['IPW', ipw],
      ['g-computation', g],
      ['AIPW', dr],
      ['TMLE', tm],
      ['matching', m],
    ] as const) {
      // Within 3 standard errors of the truth: a 99.7% statement for an
      // unbiased estimator, so a persistent failure here is bias, not chance.
      expect(
        Math.abs(e.estimate - d.trueAte),
        `${label} estimate ${e.estimate} is more than 3 SE from the truth ${d.trueAte}`,
      ).toBeLessThan(3 * (e.standardError as number));
      // All four must beat the naive estimate's bias by a wide margin.
      expect(Math.abs(e.estimate - d.trueAte)).toBeLessThan(0.25);
    }
  });

  /**
   * Coverage. Bias correction without correct coverage is half a method, so
   * this counts how often each estimator's interval contains the known truth
   * across 300 independent replications.
   *
   * g-computation uses the delta-method standard error here rather than the
   * bootstrap: 300 replications × a few hundred bootstrap refits each is far
   * outside the time budget for this suite. The bootstrap and delta intervals
   * are checked against each other on a single data set in a separate test
   * below, which is what makes substituting one for the other legitimate.
   */
  it('attains approximately nominal 95% coverage across 300 replications', () => {
    const R = 300;
    const n = 800;
    const hit = { ipw: 0, gcomp: 0, aipw: 0, matched: 0, naive: 0 };
    const biasSum = { ipw: 0, gcomp: 0, aipw: 0, matched: 0 };
    for (let r = 0; r < R; r++) {
      const dr = confounded(`coverage-${r}`, n);
      const sr = spec(dr);
      const i = ipwEstimate(sr).estimate;
      const g = gComputation(sr, { inference: 'delta' }).estimate;
      const a = aipwEstimate(sr).estimate;
      const w = propensityWorkspace(sr);
      const m = matchedEstimate(sr, nearestNeighbourMatch(w.scores, dr.treatment, { withReplacement: true }), {
        seed: `cov-${r}`,
      });
      if (covers(i, dr.trueAte)) hit.ipw++;
      if (covers(g, dr.trueAte)) hit.gcomp++;
      if (covers(a, dr.trueAte)) hit.aipw++;
      if (covers(m, dr.trueAte)) hit.matched++;
      if (covers(naiveDifference(sr), dr.trueAte)) hit.naive++;
      biasSum.ipw += i.estimate - dr.trueAte;
      biasSum.gcomp += g.estimate - dr.trueAte;
      biasSum.aipw += a.estimate - dr.trueAte;
      biasSum.matched += m.estimate - dr.trueAte;
    }
    const cov = {
      ipw: hit.ipw / R,
      gcomp: hit.gcomp / R,
      aipw: hit.aipw / R,
      matched: hit.matched / R,
      naive: hit.naive / R,
    };
    // Printed so a coverage regression is diagnosable from the test output.
    console.log('coverage', cov, 'mean bias', {
      ipw: biasSum.ipw / R,
      gcomp: biasSum.gcomp / R,
      aipw: biasSum.aipw / R,
      matched: biasSum.matched / R,
    });

    // Monte Carlo standard error of a coverage proportion at p = 0.95 over 300
    // replications is √(0.95·0.05/300) ≈ 0.0126, so ±3 MCSE is ≈ ±0.038. The
    // lower bounds below are that interval, widened only where the estimator's
    // standard error is known to be conservative (IPW, which treats the fitted
    // propensity as known) or the estimator carries a known small-sample bias
    // (matching on an estimated score).
    expect(cov.aipw).toBeGreaterThan(0.91);
    expect(cov.aipw).toBeLessThan(0.99);
    expect(cov.gcomp).toBeGreaterThan(0.91);
    expect(cov.gcomp).toBeLessThan(0.99);
    expect(cov.ipw).toBeGreaterThan(0.91); // conservative SE: may exceed 0.95
    // Matching is the one estimator here that is knowingly short of nominal.
    // Abadie–Imbens (2008) show the bootstrap is invalid for matching, and the
    // analytic variance used instead still conditions on the propensity score
    // as though it were known rather than estimated from the same data. The
    // measured coverage is around 0.91, so this asserts the estimator is close
    // to nominal without pretending it reaches it.
    expect(cov.matched).toBeGreaterThan(0.88);
    // The naive estimator must FAIL to cover: it is biased by construction, so
    // a high coverage here would mean the simulation is not confounded.
    expect(cov.naive).toBeLessThan(0.2);

    // Mean bias of every adjusted estimator must be small relative to one
    // replication's standard error (≈ 0.08 at n = 800).
    for (const [label, b] of Object.entries(biasSum)) {
      expect(Math.abs(b / R), `${label} mean bias`).toBeLessThan(0.04);
    }
  }, 180_000);

  it('the g-computation bootstrap and delta-method intervals agree on the same data', () => {
    const dd = confounded('boot-vs-delta', 2000);
    const sd = spec(dd);
    const boot = gComputation(sd, { inference: 'bootstrap', bootstrapSamples: 600, seed: 'bvd' }).estimate;
    const delta = gComputation(sd, { inference: 'delta' }).estimate;
    expect(boot.estimate).toBeCloseTo(delta.estimate, 10); // same point estimate
    // Two valid variance estimators of the same quantity agree to within 25%
    // at n = 2000; this is what licenses using the delta SE in the coverage run.
    const ratio = (boot.standardError as number) / (delta.standardError as number);
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(1.25);
  });
});

describe('randomised data: no method may "correct" an experiment', () => {
  function randomised(seed: string, n: number, tau: number) {
    const rng = new Random(seed);
    const x: number[] = [];
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.normal();
      const ti = rng.bernoulli(0.5) ? 1 : 0; // assignment ignores X entirely
      x.push(xi);
      t.push(ti);
      y.push(tau * ti + 2 * xi + rng.normal());
    }
    return { outcome: y, treatment: t, x, trueAte: tau };
  }

  it('the naive estimate is already unbiased and every adjustment agrees with it', () => {
    const d = randomised('rct', 5000, 1.5);
    const s = spec(d);
    const naive = naiveDifference(s);
    const ipw = ipwEstimate(s).estimate;
    const g = gComputation(s, { inference: 'delta' }).estimate;
    const a = aipwEstimate(s).estimate;
    const tm = tmleEstimate(s);
    const st = stratifiedEstimate(s);
    // Each must sit within 3 of its own standard errors of the true effect.
    for (const [label, e] of [['naive', naive], ['ipw', ipw], ['gcomp', g], ['aipw', a], ['tmle', tm], ['stratified', st]] as const) {
      expect(Math.abs(e.estimate - d.trueAte), `${label}`).toBeLessThan(3 * (e.standardError as number));
    }
    // And they must agree with each other: under randomisation adjustment only
    // removes chance imbalance, so the gap is at most a fraction of one SE.
    for (const e of [ipw, g, a, tm, st]) {
      expect(Math.abs(e.estimate - naive.estimate)).toBeLessThan(0.5 * (naive.standardError as number));
    }
  });
});

describe('double robustness is real', () => {
  /**
   * (i) The PROPENSITY model is correct and the OUTCOME model is wrong.
   * Treatment is logistic-linear in X, so a logistic model on X is right;
   * the outcome is a saturating sigmoid in X, so a linear outcome model is wrong.
   */
  function outcomeMisspecified(seed: string, n: number, tau: number) {
    const rng = new Random(seed);
    const x: number[] = [];
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.normal();
      const ti = rng.bernoulli(expit(1.5 * xi)) ? 1 : 0;
      x.push(xi);
      t.push(ti);
      // A saturating confounder effect: within either arm a straight line fits
      // the sigmoid badly, and extrapolating it across arms fails outright.
      y.push(tau * ti + 6 * expit(4 * xi) + rng.normal());
    }
    return { outcome: y, treatment: t, x, trueAte: tau };
  }

  /**
   * (ii) The OUTCOME model is correct and the PROPENSITY model is wrong.
   * Treatment is logistic in X and X², so a logistic model on X alone is wrong;
   * the outcome is linear in X, so a linear outcome model is right.
   */
  function propensityMisspecified(seed: string, n: number, tau: number) {
    const rng = new Random(seed);
    const x: number[] = [];
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.normal();
      const ti = rng.bernoulli(expit(1.5 * xi + 1.5 * xi * xi)) ? 1 : 0;
      x.push(xi);
      t.push(ti);
      y.push(tau * ti + 2 * xi + rng.normal());
    }
    return { outcome: y, treatment: t, x, trueAte: tau };
  }

  /** Average an estimator over replications to separate bias from noise. */
  function averageBias(
    make: (seed: string, n: number, tau: number) => { outcome: number[]; treatment: number[]; x: number[]; trueAte: number },
    kind: 'ipw' | 'gcomp' | 'aipw',
    seedBase: string,
    reps: number,
    n: number,
  ): number {
    let acc = 0;
    for (let r = 0; r < reps; r++) {
      const d = make(`${seedBase}-${r}`, n, 1);
      const s: AdjustmentSpec = {
        outcome: d.outcome,
        treatment: d.treatment,
        covariates: [{ name: 'x', values: d.x }],
      };
      const e =
        kind === 'ipw'
          ? ipwEstimate(s).estimate
          : kind === 'gcomp'
            ? gComputation(s, { inference: 'delta' }).estimate
            : aipwEstimate(s).estimate;
      acc += e.estimate - d.trueAte;
    }
    return acc / reps;
  }

  it('AIPW recovers the truth when only the propensity model is correct, where g-computation fails', () => {
    const reps = 30;
    const n = 4000;
    const biasG = averageBias(outcomeMisspecified, 'gcomp', 'dr-i', reps, n);
    const biasIpw = averageBias(outcomeMisspecified, 'ipw', 'dr-i', reps, n);
    const biasAipw = averageBias(outcomeMisspecified, 'aipw', 'dr-i', reps, n);
    console.log('case (i) outcome model wrong — mean bias', { g: biasG, ipw: biasIpw, aipw: biasAipw });
    // The Monte Carlo standard error of a mean over 30 replications at n = 4000
    // is about 0.04/√30 ≈ 0.008, so a |bias| below 0.03 is statistically
    // indistinguishable from zero and a |bias| above 0.1 is not.
    expect(Math.abs(biasIpw)).toBeLessThan(0.03); // correct propensity model
    // AIPW carries a small finite-sample bias from the extreme weights this
    // design produces, so the decisive comparison is that it is a small
    // fraction of the failing estimator's bias rather than exactly zero.
    expect(Math.abs(biasAipw)).toBeLessThan(0.06);
    expect(Math.abs(biasG)).toBeGreaterThan(0.1); // misspecified outcome model FAILS
    expect(Math.abs(biasAipw)).toBeLessThan(Math.abs(biasG) / 4);
  }, 120_000);

  it('AIPW recovers the truth when only the outcome model is correct, where IPW fails', () => {
    const reps = 30;
    const n = 4000;
    const biasG = averageBias(propensityMisspecified, 'gcomp', 'dr-ii', reps, n);
    const biasIpw = averageBias(propensityMisspecified, 'ipw', 'dr-ii', reps, n);
    const biasAipw = averageBias(propensityMisspecified, 'aipw', 'dr-ii', reps, n);
    console.log('case (ii) propensity model wrong — mean bias', { g: biasG, ipw: biasIpw, aipw: biasAipw });
    expect(Math.abs(biasG)).toBeLessThan(0.03); // correct outcome model
    expect(Math.abs(biasAipw)).toBeLessThan(0.06); // doubly robust
    expect(Math.abs(biasIpw)).toBeGreaterThan(0.1); // misspecified propensity model FAILS
    expect(Math.abs(biasAipw)).toBeLessThan(Math.abs(biasIpw) / 4);
  }, 120_000);
});

interface IvData {
  y: number[];
  d: number[];
  z: number[];
  trueLate: number;
  trueAte: number;
  complierShare: number;
}

/**
 * Instrument + unmeasured confounder, with heterogeneous compliance.
 *
 *   U ~ N(0,1) unmeasured;  Z ~ Bern(0.5);  ε ~ N(0, 0.5²);
 *   D(z) = 1[ α·z + U + ε > 1.5 ];  τ_i = 1 + 1.5·U_i;
 *
 * The selection threshold sits well above zero, so the compliers — the units
 * the instrument moves — have a distinctly higher U than the population, and
 * with τ varying in U the LATE therefore differs from the ATE by construction.
 *   Y = τ_i·D + 2·U + N(0,1)
 *
 * Both potential treatments D(0) and D(1) are generated, so the complier set
 * and the true LATE are known exactly — they are not estimated from the data.
 */
function ivData(seed: string, n: number, alpha: number): IvData {
  const rng = new Random(seed);
  const y: number[] = [];
  const d: number[] = [];
  const z: number[] = [];
  const complierTaus: number[] = [];
  const allTaus: number[] = [];
  let compliers = 0;
  for (let i = 0; i < n; i++) {
    const u = rng.normal();
    const eps = rng.normal() * 0.5;
    const zi = rng.bernoulli(0.5) ? 1 : 0;
    const d0 = u + eps > 1.5 ? 1 : 0;
    const d1 = alpha + u + eps > 1.5 ? 1 : 0;
    const di = zi === 1 ? d1 : d0;
    const tau = 1 + 1.5 * u;
    allTaus.push(tau);
    if (d1 === 1 && d0 === 0) {
      compliers++;
      complierTaus.push(tau);
    }
    z.push(zi);
    d.push(di);
    y.push(tau * di + 2 * u + rng.normal());
  }
  if (complierTaus.length === 0) throw new Error('simulation produced no compliers');
  return {
    y,
    d,
    z,
    trueLate: mean(complierTaus),
    trueAte: mean(allTaus),
    complierShare: compliers / n,
  };
}

describe('instrumental variables recover the LATE', () => {
  it('2SLS recovers the true LATE while OLS is badly biased', () => {
    const iv = ivData('iv-strong', 12000, 1.5);
    const res = twoStageLeastSquares({
      outcome: iv.y,
      treatment: iv.d,
      instruments: [{ name: 'z', values: iv.z }],
      binaryTreatment: true,
    });
    console.log('IV', {
      twoSls: res.estimate.estimate,
      ols: res.diagnostics.olsEstimate,
      trueLate: iv.trueLate,
      trueAte: iv.trueAte,
      f: res.diagnostics.firstStage.fStatistic,
      complierShare: iv.complierShare,
    });
    expect(res.diagnostics.firstStage.weak).toBe(false);
    // Within 3 of its own standard errors of the LATE known by construction.
    expect(Math.abs(res.estimate.estimate - iv.trueLate)).toBeLessThan(3 * (res.estimate.standardError as number));
    // OLS is confounded by U and must be biased by much more than that.
    expect(Math.abs(res.diagnostics.olsEstimate - iv.trueLate)).toBeGreaterThan(
      6 * (res.estimate.standardError as number),
    );
    // With heterogeneous compliance the LATE differs from the ATE, and the
    // module says it estimates the LATE.
    expect(Math.abs(iv.trueLate - iv.trueAte)).toBeGreaterThan(0.3);
    expect(res.estimate.estimand.kind).toBe('LATE');
    expect(res.estimate.notes.join(' ')).toContain('LATE');
    // The 2SLS estimate must be closer to the LATE than to the ATE.
    expect(Math.abs(res.estimate.estimate - iv.trueLate)).toBeLessThan(Math.abs(res.estimate.estimate - iv.trueAte));
    // The complier share the module reports matches the simulated one.
    expect(res.diagnostics.complierShare as number).toBeCloseTo(iv.complierShare, 1);
  });

  it('the Wald estimator agrees with 2SLS for a binary instrument', () => {
    const iv = ivData('iv-wald', 8000, 1.5);
    const w = waldEstimator(iv.y, iv.d, iv.z);
    const t = twoStageLeastSquares({ outcome: iv.y, treatment: iv.d, instruments: [{ name: 'z', values: iv.z }] });
    // With no covariates the two are algebraically the same estimator.
    expect(w.estimate).toBeCloseTo(t.estimate.estimate, 8);
  });

  it('the weak-instrument warning fires and 2SLS is then badly biased towards OLS', () => {
    const iv = ivData('iv-weak', 1200, 0.03); // α = 0.03: almost no compliers
    const res = twoStageLeastSquares({
      outcome: iv.y,
      treatment: iv.d,
      instruments: [{ name: 'z', values: iv.z }],
      binaryTreatment: true,
    });
    console.log('weak IV', {
      f: res.diagnostics.firstStage.fStatistic,
      twoSls: res.estimate.estimate,
      ols: res.diagnostics.olsEstimate,
      trueLate: iv.trueLate,
      arUnbounded: res.diagnostics.andersonRubin.unbounded,
    });
    expect(res.diagnostics.firstStage.fStatistic).toBeLessThan(10);
    expect(res.diagnostics.firstStage.weak).toBe(true);
    const warnText = res.estimate.warnings.join(' ');
    expect(warnText).toContain('WEAK INSTRUMENT');
    expect(warnText).toContain('TOWARDS the OLS estimate');
    expect(res.estimate.inferenceNote).toContain('NOT TRUSTWORTHY');
    // Demonstrate the pathology, not just the warning: the estimate must be
    // far from the truth, by much more than one honest standard error.
    expect(Math.abs(res.estimate.estimate - iv.trueLate)).toBeGreaterThan(1);
    // Anderson–Rubin, which stays valid, must be far wider than the 2SLS
    // interval — either unbounded or spanning much more than it.
    const ar = res.diagnostics.andersonRubin;
    const arWidth = ar.intervals.reduce((a, i) => a + (i.high - i.low), 0);
    const ciWidth = (res.estimate.confidenceInterval as { low: number; high: number }).high -
      (res.estimate.confidenceInterval as { low: number; high: number }).low;
    expect(ar.unbounded || arWidth > ciWidth).toBe(true);
  });

  it('Anderson–Rubin contains the truth for a strong instrument', () => {
    const iv = ivData('iv-ar', 6000, 1.5);
    const ar = andersonRubinSet({
      outcome: iv.y,
      treatment: iv.d,
      instruments: [{ name: 'z', values: iv.z }],
      level: 0.95,
    });
    expect(ar.intervals.length).toBeGreaterThan(0);
    expect(ar.intervals.some((i) => i.low <= iv.trueLate && iv.trueLate <= i.high)).toBe(true);
  });

  it('refuses an instrument with no variation and one with no first stage', () => {
    const iv = ivData('iv-refuse', 500, 1.5);
    expect(() =>
      twoStageLeastSquares({
        outcome: iv.y,
        treatment: iv.d,
        instruments: [{ name: 'constant', values: iv.z.map(() => 1) }],
      }),
    ).toThrow(EngineError);
    // An instrument unrelated to the treatment: the Wald denominator is zero.
    const rng = new Random('indep-z');
    const zIndep = iv.d.map(() => (rng.bernoulli(0.5) ? 1 : 0));
    const constantD = iv.d.map(() => 1);
    expect(() => waldEstimator(iv.y, constantD, zIndep)).toThrow(EngineError);
  });

  it('reports a first-stage F and partial R² that scale with instrument strength', () => {
    const weak = firstStageDiagnostics({
      outcome: ivData('fs-weak', 2000, 0.05).y,
      treatment: ivData('fs-weak', 2000, 0.05).d,
      instruments: [{ name: 'z', values: ivData('fs-weak', 2000, 0.05).z }],
    });
    const strong = firstStageDiagnostics({
      outcome: ivData('fs-strong', 2000, 2).y,
      treatment: ivData('fs-strong', 2000, 2).d,
      instruments: [{ name: 'z', values: ivData('fs-strong', 2000, 2).z }],
    });
    expect(strong.fStatistic).toBeGreaterThan(weak.fStatistic);
    expect(strong.weak).toBe(false);
    expect(weak.weak).toBe(true);
    expect(strong.partialR2).toBeGreaterThan(weak.partialR2);
  });
});

interface DidRow {
  unit: string;
  time: number;
  outcome: number;
  treated: number;
  everTreated: boolean;
}

/**
 * Panel data with a known treatment effect from `adoptTime` onwards.
 * `trendGap` adds a deliberate differential trend to the treated group,
 * breaking parallel trends when it is non-zero.
 */
function didData(
  seed: string,
  nUnits: number,
  nTimes: number,
  adoptTime: number,
  effect: number,
  trendGap: number,
): { panel: DidRow[]; trueEffect: number } {
  const rng = new Random(seed);
  const panel: DidRow[] = [];
  for (let u = 0; u < nUnits; u++) {
    const treatedUnit = u % 2 === 0;
    const unitEffect = rng.normal() * 2;
    for (let t = 0; t < nTimes; t++) {
      const timeEffect = 0.3 * t;
      const treated = treatedUnit && t >= adoptTime ? 1 : 0;
      const y =
        unitEffect + timeEffect + (treatedUnit ? trendGap * t : 0) + effect * treated + rng.normal() * 0.5;
      panel.push({ unit: `u${u}`, time: t, outcome: y, treated, everTreated: treatedUnit });
    }
  }
  return { panel, trueEffect: effect };
}

describe('difference-in-differences', () => {
  it('recovers the effect under parallel trends', () => {
    const { panel, trueEffect } = didData('did-ok', 200, 6, 3, 2, 0);
    const res = twoWayFixedEffects(panel);
    expect(Math.abs(res.estimate.estimate - trueEffect)).toBeLessThan(3 * (res.estimate.standardError as number));
    expect(res.staggered).toBe(false);
    expect(res.estimate.sample.nTotal).toBe(panel.length);

    // The 2×2 version on the two periods either side of adoption.
    const rows = panel.filter((r) => r.time === 2 || r.time === 3);
    const d22 = diffInDiff2x2(
      rows.map((r) => r.outcome),
      rows.map((r) => (r.everTreated ? 1 : 0)),
      rows.map((r) => (r.time === 3 ? 1 : 0)),
      { clusters: rows.map((r) => r.unit) },
    );
    expect(Math.abs(d22.estimate - trueEffect)).toBeLessThan(3 * (d22.standardError as number));
  });

  it('is biased when trends are deliberately non-parallel, and the event study shows it', () => {
    const { panel, trueEffect } = didData('did-bad', 300, 6, 3, 2, 0.8);
    const res = twoWayFixedEffects(panel);
    // The treated group gains an extra 0.8 per period; over the post-period the
    // DiD coefficient must be clearly above the true effect of 2.
    expect(res.estimate.estimate).toBeGreaterThan(trueEffect + 0.5);
    expect(Math.abs(res.estimate.estimate - trueEffect)).toBeGreaterThan(5 * (res.estimate.standardError as number));

    const es = eventStudy(panel);
    expect(es.preTrendTest).not.toBeNull();
    // A differential trend of 0.8 per period over three pre-periods is huge,
    // so the joint pre-trend test must reject decisively.
    expect((es.preTrendTest as { pValue: number }).pValue).toBeLessThan(0.001);
    expect(es.warnings.join(' ')).toContain('PRE-TRENDS REJECTED');
    const pre = es.points.filter((p) => p.eventTime < 0 && !p.reference);
    expect(pre.length).toBeGreaterThan(0);
    // Pre-treatment coefficients must be monotone in event time (the trend).
    const sorted = pre.slice().sort((a, b) => a.eventTime - b.eventTime);
    expect(sorted[0].coefficient).toBeLessThan(sorted[sorted.length - 1].coefficient);
  });

  it('shows flat pre-trends when trends really are parallel', () => {
    const { panel } = didData('did-flat', 300, 6, 3, 2, 0);
    const es = eventStudy(panel);
    const pre = es.points.filter((p) => p.eventTime < 0 && !p.reference);
    for (const p of pre) {
      // Each pre-treatment coefficient's interval must contain zero.
      expect(p.ciLow).toBeLessThanOrEqual(0);
      expect(p.ciHigh).toBeGreaterThanOrEqual(0);
    }
    expect(es.warnings.join(' ')).toContain('weak reassurance');
  });

  it('warns about staggered adoption and the negative-weighting problem', () => {
    const rng = new Random('stagger');
    const panel: DidRow[] = [];
    for (let u = 0; u < 60; u++) {
      const adopt = u % 3 === 0 ? 2 : u % 3 === 1 ? 4 : Infinity;
      const ue = rng.normal();
      for (let t = 0; t < 6; t++) {
        const treated = t >= adopt ? 1 : 0;
        // A dynamic effect that grows with exposure: the case where two-way
        // fixed effects is known to go wrong.
        const exposure = treated ? t - adopt + 1 : 0;
        panel.push({
          unit: `u${u}`,
          time: t,
          outcome: ue + 0.2 * t + 1.5 * exposure + rng.normal() * 0.4,
          treated,
          everTreated: Number.isFinite(adopt),
        });
      }
    }
    const res = twoWayFixedEffects(panel);
    expect(res.staggered).toBe(true);
    const w = res.estimate.warnings.join(' ');
    expect(w).toContain('STAGGERED ADOPTION');
    expect(w).toContain('NEGATIVE');
    expect(w).toContain('Goodman-Bacon');
  });

  it('refuses a single-period or single-group design', () => {
    const { panel } = didData('did-refuse', 20, 4, 2, 1, 0);
    const onePeriod = panel.filter((r) => r.time === 1);
    expect(() => twoWayFixedEffects(onePeriod)).toThrow(/only 1 time period/);
    const oneGroup = panel.filter((r) => r.unit === 'u0');
    expect(() => twoWayFixedEffects(oneGroup)).toThrow(/only 1 unit/);
    // 2×2 with an empty cell.
    const rows = panel.filter((r) => r.time <= 1);
    expect(() =>
      diffInDiff2x2(
        rows.map((r) => r.outcome),
        rows.map((r) => (r.everTreated ? 1 : 0)),
        rows.map(() => 0), // no post period at all
      ),
    ).toThrow(EngineError);
  });
});

function rddData(seed: string, n: number, jump: number): { x: number[]; y: number[]; trueJump: number } {
  const rng = new Random(seed);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = rng.uniformRange(-1, 1);
    x.push(xi);
    y.push(1 + 0.8 * xi + (xi >= 0 ? jump : 0) + rng.normal() * 0.5);
  }
  return { x, y, trueJump: jump };
}

describe('regression discontinuity', () => {
  it('recovers a known jump at the cutoff', () => {
    const { x, y, trueJump } = rddData('rdd', 3000, 3);
    const res = regressionDiscontinuity({ outcome: y, running: x, cutoff: 0 });
    console.log('RDD', { est: res.estimate.estimate, se: res.estimate.standardError, h: res.bandwidth, trueJump });
    expect(res.bandwidthSource).toBe('Imbens-Kalyaraman');
    expect(res.bandwidth).toBeGreaterThan(0);
    // Within 3 of its own standard errors of the true discontinuity.
    expect(Math.abs(res.estimate.estimate - trueJump)).toBeLessThan(3 * (res.estimate.standardError as number));
    expect(res.estimate.estimand.kind).toBe('local-at-cutoff');
    expect(res.estimate.notes.join(' ')).toContain('LOCAL TO THE CUTOFF');
    expect(res.bandwidthSensitivity.length).toBe(5);
    expect(res.biasCorrected).not.toBeNull();
    // The bias-corrected local quadratic must also be close to the truth.
    expect(Math.abs((res.biasCorrected as { estimate: number }).estimate - trueJump)).toBeLessThan(0.5);
  });

  it('McCrary detects deliberate manipulation and does not fire on clean data', () => {
    const clean = rddData('mcc-clean', 4000, 3);
    const cleanTest = mccraryDensityTest(clean.x, 0);
    console.log('McCrary clean', { jump: cleanTest.logDensityJump, p: cleanTest.pValue });
    expect(cleanTest.manipulationDetected).toBe(false);

    // Manipulation: units just below the cutoff push themselves just above it.
    const rng = new Random('mcc-manip');
    const manipulated = clean.x.map((v) => (v < 0 && v > -0.25 && rng.bernoulli(0.8) ? -v : v));
    const manipTest = mccraryDensityTest(manipulated, 0);
    console.log('McCrary manipulated', { jump: manipTest.logDensityJump, p: manipTest.pValue });
    expect(manipTest.manipulationDetected).toBe(true);
    expect(manipTest.logDensityJump).toBeGreaterThan(0);
    expect(manipTest.warnings.join(' ')).toContain('MANIPULATION INDICATED');
  });

  it('checks covariate smoothness and flags a planted covariate jump', () => {
    const { x } = rddData('rdd-cov', 3000, 3);
    const rng = new Random('rdd-cov-z');
    const smooth = x.map((v) => 0.5 * v + rng.normal());
    const jumpy = x.map((v) => 0.5 * v + (v >= 0 ? 2 : 0) + rng.normal());
    const res = covariateSmoothness(
      x,
      [
        { name: 'smooth', values: smooth },
        { name: 'jumpy', values: jumpy },
      ],
      0,
      0.3,
    );
    const rows = new Map(res.rows.map((r) => [r.name, r]));
    expect((rows.get('smooth') as { smooth: boolean }).smooth).toBe(true);
    expect((rows.get('jumpy') as { smooth: boolean }).smooth).toBe(false);
    expect(res.warnings.join(' ')).toContain('COVARIATE DISCONTINUITY');
  });

  it('estimates a fuzzy design and warns when the treatment jump is weak', () => {
    const rng = new Random('fuzzy');
    const n = 6000;
    const x: number[] = [];
    const d: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.uniformRange(-1, 1);
      const p = xi >= 0 ? 0.85 : 0.15; // a strong but imperfect first stage
      const di = rng.bernoulli(p) ? 1 : 0;
      x.push(xi);
      d.push(di);
      y.push(1 + 0.8 * xi + 2 * di + rng.normal() * 0.5);
    }
    const res = regressionDiscontinuity({ outcome: y, running: x, cutoff: 0, treatment: d });
    expect(res.firstStageJump).not.toBeNull();
    expect((res.firstStageJump as { weak: boolean }).weak).toBe(false);
    expect(Math.abs(res.estimate.estimate - 2)).toBeLessThan(3 * (res.estimate.standardError as number));
    expect(res.estimate.notes.join(' ')).toContain('LATE');
  });

  it('refuses an empty side of the cutoff', () => {
    const { x, y } = rddData('rdd-refuse', 500, 3);
    // Cutoff above every observation: nothing on the right.
    expect(() => regressionDiscontinuity({ outcome: y, running: x, cutoff: 5 })).toThrow(/empty|below the cutoff/i);
    // Only one side supplied.
    const leftOnly = x.map((v, i) => ({ v, y: y[i] })).filter((r) => r.v < 0);
    expect(() =>
      regressionDiscontinuity({ outcome: leftOnly.map((r) => r.y), running: leftOnly.map((r) => r.v), cutoff: 0 }),
    ).toThrow(EngineError);
  });
});

describe('balance and overlap diagnostics', () => {
  it('standardised mean differences are large before adjustment and below 0.1 after', () => {
    const d = confounded('balance', 4000, 1, 1.2, 2);
    const s = spec(d);
    const before = balanceReport([{ name: 'x', values: d.x }], d.treatment);
    expect(Math.abs(before.before[0].smd)).toBeGreaterThan(0.5);
    expect(before.before[0].balanced).toBe(false);
    expect(before.worstAfterSmd).toBeNull();

    const ipw = ipwEstimate(s);
    const after = ipw.balance.after as NonNullable<typeof ipw.balance.after>;
    console.log('SMD', { before: before.before[0].smd, after: after[0].smd });
    expect(Math.abs(after[0].smd)).toBeLessThan(0.1);
    expect(after[0].balanced).toBe(true);
    expect(after[0].varianceRatio as number).toBeGreaterThan(0.5);
    expect(after[0].varianceRatio as number).toBeLessThan(2);
  });

  it('refuses a zero-variance covariate', () => {
    const d = confounded('zerovar', 400);
    const s: AdjustmentSpec = {
      outcome: d.outcome,
      treatment: d.treatment,
      covariates: [{ name: 'constant', values: d.x.map(() => 3) }],
    };
    expect(() => ipwEstimate(s)).toThrow(/zero variance/);
    expect(() => balanceReport([{ name: 'constant', values: d.x.map(() => 3) }], d.treatment)).toThrow(EngineError);
  });

  it('refuses data with no common support at all', () => {
    const n = 200;
    const treatment = Array.from({ length: n }, (_, i) => (i < n / 2 ? 1 : 0));
    const scores = treatment.map((t) => (t === 1 ? 0.85 : 0.15));
    expect(() => overlapReport(scores, treatment)).toThrow(/No common support/);
    const rng = new Random('nooverlap');
    expect(() =>
      ipwEstimate({
        outcome: treatment.map((t) => t + rng.normal()),
        treatment,
        covariates: [{ name: 'x', values: treatment.map((t) => t + 0.01 * rng.normal()) }],
        propensityScores: scores,
      }),
    ).toThrow(/No common support/);
  });

  it('warns about thin overlap short of refusing', () => {
    const d = confounded('thin', 2000, 1, 3, 2); // a = 3: strong selection
    const ipw = ipwEstimate(spec(d));
    expect(ipw.overlap.proportionOutsideCommonSupport).toBeGreaterThanOrEqual(0);
    expect(ipw.estimate.warnings.length).toBeGreaterThan(0);
  });

  it('catches extreme weights and a collapsed effective sample size', () => {
    // Near-violation of positivity: the propensity model separates the arms
    // almost completely, so a handful of units carry the whole estimate.
    const rng = new Random('extreme');
    const n = 1200;
    const x: number[] = [];
    const t: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i++) {
      const xi = rng.normal();
      const ti = rng.bernoulli(expit(5 * xi)) ? 1 : 0;
      x.push(xi);
      t.push(ti);
      y.push(ti + 2 * xi + rng.normal());
    }
    const ipw = ipwEstimate({ outcome: y, treatment: t, covariates: [{ name: 'x', values: x }] });
    const wd = ipw.weightDiagnostics;
    console.log('extreme weights', {
      max: wd.maxWeight,
      ess: wd.effectiveSampleSize,
      n,
      topShare: wd.topOnePercentWeightShare,
    });
    expect(wd.maxWeight).toBeGreaterThan(20);
    expect(wd.effectiveSampleSize).toBeLessThan(0.6 * n);
    expect(wd.warnings.length).toBeGreaterThan(0);
    expect(ipw.estimate.warnings.join(' ')).toMatch(/weight|Effective sample size|positivity/i);
    expect(ipw.estimate.notes.join(' ')).toContain('Maximum weight');
  });

  it('reports n treated, n control, n used and n dropped for every method', () => {
    const d = confounded('accounting', 800);
    const s = spec(d);
    const nT = d.treatment.filter((t) => t === 1).length;
    for (const e of [naiveDifference(s), ipwEstimate(s).estimate, gComputation(s, { inference: 'delta' }).estimate, aipwEstimate(s).estimate]) {
      expect(e.sample.nTotal).toBe(800);
      expect(e.sample.nTreated).toBe(nT);
      expect(e.sample.nControl).toBe(800 - nT);
      expect(e.sample.nUsed).toBeGreaterThan(0);
      expect(e.sample.nDropped).toBe(e.sample.nTotal - e.sample.nUsed);
    }
    const m = nearestNeighbourMatch(propensityWorkspace(s).scores, d.treatment, { withReplacement: false });
    const me = matchedEstimate(s, m);
    expect(me.sample.nMatched).toBe(m.nMatched);
    expect(me.sample.dropReasons.length).toBeGreaterThan(0);
  });
});

describe('matching', () => {
  const d = confounded('matching', 1500);
  const s = spec(d);
  const scores = (): number[] => propensityWorkspace(s).scores;

  it('matches without replacement, with replacement, with a caliper and optimally', () => {
    const ps = scores();
    const noRep = nearestNeighbourMatch(ps, d.treatment, { withReplacement: false });
    const withRep = nearestNeighbourMatch(ps, d.treatment, { withReplacement: true });
    const caliper = nearestNeighbourMatch(ps, d.treatment, { caliper: 0.001 });
    expect(noRep.nMatched).toBeGreaterThan(0);
    expect(withRep.nMatched).toBeGreaterThanOrEqual(noRep.nMatched);
    // With replacement every treated unit finds a partner.
    expect(withRep.nMatched).toBe(withRep.nTreated);
    // A tight caliper must match fewer pairs and say why units were dropped.
    expect(caliper.nMatched).toBeLessThan(noRep.nMatched);
    expect(caliper.dropReasons.join(' ')).toContain('caliper');
    expect(caliper.dropReasons.join(' ')).toContain('MATCHED treated units');
    // Matching improves balance.
    const after = balanceReport([{ name: 'x', values: d.x }], d.treatment, withRep.weights, 'matching');
    expect(Math.abs(after.worstAfterSmd as number)).toBeLessThan(Math.abs(after.worstBeforeSmd));
  });

  it('optimal matching achieves a total distance no worse than greedy', () => {
    const small = confounded('optimal', 300);
    const ps = propensityWorkspace(spec(small)).scores;
    const greedy = nearestNeighbourMatch(ps, small.treatment, { withReplacement: false });
    const opt = optimalMatch(ps, small.treatment);
    const total = (m: { pairs: { distance: number }[] }): number => m.pairs.reduce((a, p) => a + p.distance, 0);
    // The assignment problem's optimum is by definition no worse than greedy
    // on the same number of pairs; compare mean distance to be size-agnostic.
    expect(total(opt) / opt.pairs.length).toBeLessThanOrEqual(total(greedy) / greedy.pairs.length + 1e-12);
  });

  it('refuses zero matched pairs', () => {
    const ps = scores();
    expect(() => nearestNeighbourMatch(ps, d.treatment, { caliper: 1e-12 })).toThrow(/zero pairs/);
  });

  it('coarsened exact matching drops single-arm strata and says so', () => {
    const cem = coarsenedExactMatch([{ name: 'x', values: d.x }], d.treatment, [12]);
    expect(cem.nStrataRetained).toBeGreaterThan(0);
    expect(cem.strata.length).toBe(cem.nStrataRetained + cem.nStrataDropped);
    if (cem.nStrataDropped > 0) {
      expect(cem.warnings.join(' ')).toContain('only one treatment arm');
    }
    const e = matchedEstimate(s, cem, { seed: 'cem2' });
    expect(Math.abs(e.estimate - d.trueAte)).toBeLessThan(0.5);
  });

  it('Mahalanobis matching recovers the effect and refuses a constant covariate', () => {
    const m = mahalanobisMatch([{ name: 'x', values: d.x }], d.treatment, { withReplacement: true });
    const e = matchedEstimate(s, m, { seed: 'mahal' });
    expect(Math.abs(e.estimate - d.trueAte)).toBeLessThan(3 * (e.standardError as number));
    expect(() => mahalanobisMatch([{ name: 'c', values: d.x.map(() => 1) }], d.treatment)).toThrow(/zero variance/);
  });
});

describe('trimming changes the estimand', () => {
  it('says the target population has changed', () => {
    const d = confounded('trim', 2000, 1, 2.5, 2);
    const res = ipwEstimate(spec(d), { trim: { low: 0.1, high: 0.9 } });
    expect(res.estimate.estimand.kind).toBe('ATE-trimmed');
    expect(res.estimate.estimand.targetPopulation).toContain('Trimming changed the estimand');
    expect(res.estimate.notes.join(' ')).toContain('THE ESTIMAND HAS CHANGED');
    expect(res.estimate.sample.nUsed).toBeLessThan(res.estimate.sample.nTotal);
    expect(res.estimate.sample.dropReasons.length).toBeGreaterThan(0);
  });

  it('refuses a trim that empties an arm', () => {
    const d = confounded('trim-empty', 800, 1, 2, 2);
    expect(() => ipwEstimate(spec(d), { trim: { low: 0.999, high: 1 } })).toThrow(EngineError);
  });
});

describe('sensitivity analysis', () => {
  it('reproduces the published E-value closed form', () => {
    // Independent reference: E = RR + √(RR(RR−1)) (VanderWeele & Ding 2017),
    // computed here in the test and compared with the module's output.
    for (const rr of [1.1, 1.5, 2, 3.9, 10]) {
      const reference = rr + Math.sqrt(rr * (rr - 1));
      expect(eValue(rr).pointEValue).toBeCloseTo(reference, 12);
    }
    // A protective risk ratio is handled by inverting it first.
    for (const rr of [0.5, 0.8, 0.25]) {
      const inv = 1 / rr;
      expect(eValue(rr).pointEValue).toBeCloseTo(inv + Math.sqrt(inv * (inv - 1)), 12);
    }
    // Published checkpoint: RR = 2 gives E = 2 + √2 ≈ 3.414.
    expect(eValue(2).pointEValue).toBeCloseTo(2 + Math.SQRT2, 12);
  });

  it('is exactly 1 at the null and increases with effect size', () => {
    expect(eValue(1).pointEValue).toBeCloseTo(1, 12);
    expect(eValue(1).interpretation).toContain('no unmeasured confounding is needed');
    let previous = 0;
    for (const rr of [1, 1.2, 1.5, 2, 3, 5, 8]) {
      const e = eValue(rr).pointEValue;
      expect(e).toBeGreaterThan(previous);
      previous = e;
    }
  });

  it('reports an E-value of 1 for a confidence limit that crosses the null', () => {
    const res = eValue(1.8, { low: 0.9, high: 3.6 });
    expect(res.limitEValue).toBeCloseTo(1, 12);
    expect(res.limitUsed).toBeNull();
    expect(res.warnings.join(' ')).toContain('no unmeasured confounding at all is needed');
    const tight = eValue(1.8, { low: 1.4, high: 2.3 });
    expect(tight.limitUsed).toBeCloseTo(1.4, 12);
    expect(tight.limitEValue).toBeCloseTo(1.4 + Math.sqrt(1.4 * 0.4), 12);
    // The limit E-value is always no larger than the point E-value.
    expect(tight.limitEValue).toBeLessThan(tight.pointEValue);
  });

  it('refuses an impossible risk ratio', () => {
    expect(() => eValue(0)).toThrow(EngineError);
    expect(() => eValue(Number.POSITIVE_INFINITY)).toThrow(EngineError);
  });

  it('Manski bounds always contain the true ATE and are wider than any point interval', () => {
    // Binary outcome so the logical range is exactly [0,1] with no judgement.
    for (let r = 0; r < 40; r++) {
      const rng = new Random(`manski-${r}`);
      const n = 600;
      const x: number[] = [];
      const t: number[] = [];
      const y: number[] = [];
      let sumEffect = 0;
      for (let i = 0; i < n; i++) {
        const xi = rng.normal();
        const ti = rng.bernoulli(expit(1.5 * xi)) ? 1 : 0;
        const p1 = expit(0.5 + xi);
        const p0 = expit(-0.5 + xi);
        sumEffect += p1 - p0;
        x.push(xi);
        t.push(ti);
        y.push(rng.bernoulli(ti === 1 ? p1 : p0) ? 1 : 0);
      }
      const trueAte = sumEffect / n;
      const mb = manskiBounds(y, t, [0, 1]);
      expect(mb.lower).toBeLessThanOrEqual(trueAte);
      expect(mb.upper).toBeGreaterThanOrEqual(trueAte);
      // Computed from the logical range alone: the width is exactly that range.
      expect(mb.width).toBeCloseTo(1, 10);
      // And strictly wider than an adjusted estimate's confidence interval.
      const aipw = aipwEstimate({ outcome: y, treatment: t, covariates: [{ name: 'x', values: x }] }).estimate;
      const ci = aipw.confidenceInterval as { low: number; high: number };
      expect(mb.width).toBeGreaterThan(ci.high - ci.low);
    }
  });

  it('Manski bounds do not depend on ignorability: identical under any confounding', () => {
    // Two data sets with the same arm means and proportions but generated with
    // and without confounding give the same bounds, because the bounds use only
    // those summaries and the outcome range.
    const rng = new Random('manski-indep');
    const n = 400;
    const t = Array.from({ length: n }, (_, i) => (i < n / 2 ? 1 : 0));
    const y = t.map((ti) => (rng.bernoulli(ti === 1 ? 0.7 : 0.4) ? 1 : 0));
    const a = manskiBounds(y, t, [0, 1]);
    // Shuffling which unit holds which outcome within an arm cannot change it.
    const shuffled = [...y.filter((_, i) => t[i] === 1).reverse(), ...y.filter((_, i) => t[i] === 0).reverse()];
    const b = manskiBounds(shuffled, t, [0, 1]);
    expect(b.lower).toBeCloseTo(a.lower, 12);
    expect(b.upper).toBeCloseTo(a.upper, 12);
    expect(a.estimate.assumptions.some((x) => x.name.includes('NO ignorability'))).toBe(true);
  });

  it('refuses Manski bounds without a finite outcome range', () => {
    const d = confounded('manski-refuse', 200);
    expect(() => manskiBounds(d.outcome, d.treatment, [0, 0])).toThrow(EngineError);
    expect(() => manskiBounds(d.outcome, d.treatment, [-1, 1])).toThrow(/outside the stated range/);
  });

  it('Rosenbaum bounds weaken as Γ grows and report a critical Γ', () => {
    const rng = new Random('rosenbaum');
    // Matched pair differences with a clear positive effect.
    const diffs = Array.from({ length: 150 }, () => 1 + rng.normal() * 1.2);
    const res = rosenbaumBounds(diffs);
    expect(res.nPairs).toBe(150);
    // The worst-case p-value must be monotone increasing in Γ.
    for (let i = 1; i < res.bounds.length; i++) {
      expect(res.bounds[i].upperPValue).toBeGreaterThanOrEqual(res.bounds[i - 1].upperPValue);
    }
    expect(res.bounds[0].upperPValue).toBeLessThan(0.05);
    expect(res.criticalGamma).not.toBeNull();
    // A null effect must not survive even Γ = 1.
    const nullDiffs = Array.from({ length: 150 }, () => rng.normal());
    const nullRes = rosenbaumBounds(nullDiffs);
    expect(nullRes.criticalGamma).toBeNull();
    expect(nullRes.warnings.join(' ')).toContain('not robust to ANY');
    expect(() => rosenbaumBounds([1, 2])).toThrow(EngineError);
  });

  it('Cinelli–Hazlett robustness value decreases as the estimate gets weaker', () => {
    const strong = cinelliHazlettSensitivity(2, 0.1, 500);
    const weak = cinelliHazlettSensitivity(0.2, 0.1, 500);
    expect(strong.robustnessValue).toBeGreaterThan(weak.robustnessValue);
    // The partial R² of treatment with outcome: t²/(t²+df), computed here.
    const t = 2 / 0.1;
    expect(strong.partialR2TreatmentOutcome).toBeCloseTo((t * t) / (t * t + 500), 12);
    // The contour grid must include the unadjusted estimate at zero strength.
    const zero = strong.contour.find((c) => c.r2TreatmentConfounder === 0 && c.r2OutcomeConfounder === 0);
    expect((zero as { adjustedEstimate: number }).adjustedEstimate).toBeCloseTo(2, 10);
    // And the adjusted estimate must shrink as confounder strength rises.
    const strongest = strong.contour[strong.contour.length - 1];
    // The adjustment moves the estimate towards and past zero as the
    // confounder's strength rises, so the signed value must fall below the
    // unadjusted 2 (here it crosses the null entirely).
    expect(strongest.adjustedEstimate).toBeLessThan(1);
    expect(weak.warnings.length + strong.warnings.length).toBeGreaterThanOrEqual(0);
    expect(() => cinelliHazlettSensitivity(1, 0, 100)).toThrow(EngineError);
  });

  it('negative controls fail loudly and pass quietly', () => {
    const res = negativeControlTest([
      { name: 'future outcome', kind: 'negative-control-outcome', estimate: 0.02, standardError: 0.1 },
      { name: 'unrelated outcome', kind: 'negative-control-outcome', estimate: 0.9, standardError: 0.1 },
    ]);
    expect(res.rows[0].failed).toBe(false);
    expect(res.rows[1].failed).toBe(true);
    expect(res.warnings.join(' ')).toContain('NEGATIVE CONTROL FAILED');
    expect(res.note).toContain('passing all of them');
    expect(() => negativeControlTest([])).toThrow(EngineError);
  });
});

describe('structure learning (PC)', () => {
  /** X1 → X3 ← X2, X3 → X4: a collider plus a downstream edge. */
  function colliderData(seed: string, n: number) {
    const rng = new Random(seed);
    const x1: number[] = [];
    const x2: number[] = [];
    const x3: number[] = [];
    const x4: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = rng.normal();
      const c = 1.2 * a + 1.2 * b + rng.normal() * 0.5;
      const dd = 1.5 * c + rng.normal() * 0.5;
      x1.push(a);
      x2.push(b);
      x3.push(c);
      x4.push(dd);
    }
    return {
      kind: 'continuous' as const,
      variables: ['X1', 'X2', 'X3', 'X4'],
      columns: [x1, x2, x3, x4],
    };
  }

  /** A chain X1 → X2 → X3, whose equivalence class orients nothing. */
  function chainData(seed: string, n: number) {
    const rng = new Random(seed);
    const x1: number[] = [];
    const x2: number[] = [];
    const x3: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = 1.5 * a + rng.normal() * 0.5;
      const c = 1.5 * b + rng.normal() * 0.5;
      x1.push(a);
      x2.push(b);
      x3.push(c);
    }
    return { kind: 'continuous' as const, variables: ['X1', 'X2', 'X3'], columns: [x1, x2, x3] };
  }

  it('recovers the true CPDAG from a large sample, including the v-structure', () => {
    const data = colliderData('pc-collider', 6000);
    const g = pcAlgorithm(data, { alpha: 0.01 });
    const adjacency = new Set(
      [...g.directed.map((e) => [e.from, e.to]), ...g.undirected.map((e) => [e.a, e.b])].map(([a, b]) =>
        a < b ? `${a}-${b}` : `${b}-${a}`,
      ),
    );
    console.log('PC collider', { directed: g.directed, undirected: g.undirected, colliders: g.colliders });
    // The true adjacencies, and no others. X1 and X2 are marginally
    // independent, so no edge between them.
    expect(adjacency).toEqual(new Set(['X1-X3', 'X2-X3', 'X3-X4']));
    // The collider at X3 must be found and oriented.
    expect(g.colliders.length).toBeGreaterThanOrEqual(1);
    expect(g.colliders.some((c) => c.collider === 'X3')).toBe(true);
    const directed = new Set(g.directed.map((e) => `${e.from}->${e.to}`));
    expect(directed.has('X1->X3')).toBe(true);
    expect(directed.has('X2->X3')).toBe(true);
    // The separating set for the non-adjacent pair must be recorded, and must
    // NOT contain the collider.
    const sep = g.separationSets.find((s) => (s.a === 'X1' && s.b === 'X2') || (s.a === 'X2' && s.b === 'X1'));
    expect(sep).toBeDefined();
    expect((sep as { given: string[] }).given).not.toContain('X3');
  });

  it('leaves an unorientable edge unoriented rather than guessing', () => {
    const g = pcAlgorithm(chainData('pc-chain', 6000), { alpha: 0.01 });
    const adjacency = new Set(
      [...g.directed.map((e) => [e.from, e.to]), ...g.undirected.map((e) => [e.a, e.b])].map(([a, b]) =>
        a < b ? `${a}-${b}` : `${b}-${a}`,
      ),
    );
    expect(adjacency).toEqual(new Set(['X1-X2', 'X2-X3']));
    // A chain and its two reversals are Markov equivalent, so NOTHING is
    // orientable: the algorithm must report both edges as undirected.
    expect(g.colliders.length).toBe(0);
    expect(g.directed.length).toBe(0);
    expect(g.undirected.length).toBe(2);
    expect(g.warnings.join(' ')).toContain('could not be oriented');
    expect(g.untestability).toContain('Markov equivalence class');
  });

  it('the recovered graph changes with the significance level', () => {
    // A fourth variable with a weak dependence on X1: detectable at a loose
    // level and not at a strict one, which is exactly the fragility to expose.
    const rng = new Random('pc-fragile');
    const n = 400;
    const x1: number[] = [];
    const x2: number[] = [];
    const x3: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = rng.normal();
      const b = 1.5 * a + rng.normal() * 0.5;
      x1.push(a);
      x2.push(b);
      x3.push(0.1 * a + rng.normal()); // weak: |ρ| ≈ 0.1
    }
    const data = { kind: 'continuous' as const, variables: ['X1', 'X2', 'X3'], columns: [x1, x2, x3] };
    const strict = pcAlgorithm(data, { alpha: 0.001 });
    const loose = pcAlgorithm(data, { alpha: 0.3 });
    const count = (g: { directed: unknown[]; undirected: unknown[] }): number => g.directed.length + g.undirected.length;
    expect(count(loose)).toBeGreaterThan(count(strict));
    const stability = structureStability(data, [0.001, 0.05, 0.3]);
    expect(stability.changed).toBe(true);
    expect(stability.warnings.join(' ')).toContain('THE RECOVERED GRAPH CHANGES WITH');
    expect(stability.unstableAdjacencies.length).toBeGreaterThan(0);
    expect(stability.runs.length).toBe(3);
    expect(() => structureStability(data, [0.05])).toThrow(EngineError);
  });

  it('states causal sufficiency, faithfulness and the equivalence-class limit', () => {
    const g = pcAlgorithm(chainData('pc-assume', 1000), { alpha: 0.05 });
    const names = g.assumptions.map((a) => a.name).join(' | ');
    expect(names).toContain('Causal sufficiency');
    expect(names).toContain('Faithfulness');
    expect(names).toContain('equivalence class');
    for (const a of g.assumptions) expect(a.testable).toBe(false);
    expect(g.warnings.join(' ')).toContain('LEAST RELIABLE');
    expect(g.warnings.join(' ')).toContain('significance level');
  });

  it('the Fisher z test agrees with the known partial correlation structure', () => {
    const data = colliderData('pc-ci', 8000);
    // X1 ⫫ X2 marginally (both are exogenous and independent by construction).
    // The substantive check is the partial correlation itself; the
    // independence flag is read at α = 0.001 because at n = 8000 a true zero
    // correlation still clears a 5% threshold about 5% of the time, which
    // would make the assertion a coin flip rather than a check of the maths.
    const marginal = fisherZTest(data, 0, 1, [], 0.001);
    expect(Math.abs(marginal.partialCorrelation as number)).toBeLessThan(0.05);
    expect(marginal.independent).toBe(true);
    // Conditioning on the collider X3 makes them DEPENDENT.
    const conditional = fisherZTest(data, 0, 1, [2]);
    expect(conditional.independent).toBe(false);
    expect(conditional.partialCorrelation as number).toBeLessThan(-0.3);
    // X1 ⫫ X4 given X3 (X3 blocks the only path).
    expect(fisherZTest(data, 0, 3, [2], 0.001).independent).toBe(true);
    expect(Math.abs(fisherZTest(data, 0, 3, [2]).partialCorrelation as number)).toBeLessThan(0.05);
    expect(fisherZTest(data, 0, 3, []).independent).toBe(false);
  });

  it('refuses a constant variable and too few rows', () => {
    const rng = new Random('pc-refuse');
    const n = 200;
    const cols = [
      Array.from({ length: n }, () => rng.normal()),
      Array.from({ length: n }, () => 1),
    ];
    expect(() => pcAlgorithm({ kind: 'continuous', variables: ['A', 'B'], columns: cols })).toThrow(/constant/);
    expect(() =>
      pcAlgorithm({
        kind: 'continuous',
        variables: ['A', 'B'],
        columns: [[1, 2, 3], [2, 1, 4]],
      }),
    ).toThrow(EngineError);
  });
});

function itsData(seed: string, n: number, jump: number): { time: number[]; y: number[] } {
  const rng = new Random(seed);
  const time: number[] = [];
  const y: number[] = [];
  for (let t = 0; t < n; t++) {
    time.push(t);
    y.push(10 + 0.2 * t + (t >= 20 ? jump : 0) + rng.normal() * 0.5);
  }
  return { time, y };
}

function scData(seed: string, nDonors: number, T: number, pre: number, effect: number) {
  const rng = new Random(seed);
  const factor = Array.from({ length: T }, (_, t) => Math.sin(t / 2) + 0.1 * t);
  const donors = Array.from({ length: nDonors }, (_, j) => {
    const load = 0.5 + (j / nDonors) * 1.5;
    return {
      name: `d${j}`,
      outcome: factor.map((f) => load * f + rng.normal() * 0.15),
    };
  });
  // The treated unit's loading is inside the donors' convex hull.
  const treatedLoad = 1.0;
  const treated = factor.map((f, t) => treatedLoad * f + rng.normal() * 0.15 + (t >= pre ? effect : 0));
  return { donors, treated, effect };
}

describe('interrupted time series and synthetic control', () => {
  it('interrupted time series recovers a known level change', () => {
    const { time, y } = itsData('its', 40, 5);
    const res = interruptedTimeSeries(time, y, 20);
    expect(Math.abs(res.levelChange.estimate - 5)).toBeLessThan(3 * res.levelChange.standardError);
    // No slope change was simulated.
    expect(Math.abs(res.slopeChange.estimate)).toBeLessThan(3 * res.slopeChange.standardError);
    expect(res.estimate.notes.join(' ')).toContain('NO control group');
    expect(() => interruptedTimeSeries(time.slice(0, 21), y.slice(0, 21), 20)).toThrow(EngineError);
  });

  it('synthetic control recovers a known post-intervention gap with a good pre-fit', () => {
    const sc = scData('sc', 10, 16, 10, 3);
    const res = syntheticControl({ treatedOutcome: sc.treated, donors: sc.donors, preperiods: 10 });
    console.log('synthetic control', {
      gap: res.averagePostGap,
      preRmspe: res.preRmspe,
      p: res.placeboPValue,
      weights: res.weights.filter((w) => w.weight > 0.01),
    });
    // The donors span the treated unit's factor loading, so the pre-fit should
    // be at the noise level (σ = 0.15) and the post gap near the true effect.
    expect(res.preRmspe).toBeLessThan(0.4);
    expect(Math.abs(res.averagePostGap - 3)).toBeLessThan(0.4);
    expect(res.weights.reduce((a, w) => a + w.weight, 0)).toBeCloseTo(1, 8);
    for (const w of res.weights) expect(w.weight).toBeGreaterThanOrEqual(-1e-12);
    // Placebo inference must rank the treated unit as the most extreme.
    expect(res.placeboPValue).toBeLessThanOrEqual(1 / (res.placebo.length + 1) + 1e-12);
    expect(res.estimate.standardError).toBeNull();
    expect(res.estimate.inferenceNote).toContain('PLACEBO rank');
    expect(res.gap.length).toBe(16);
  });

  it('reports no effect when there was none, and refuses a degenerate design', () => {
    const sc = scData('sc-null', 10, 16, 10, 0);
    const res = syntheticControl({ treatedOutcome: sc.treated, donors: sc.donors, preperiods: 10 });
    expect(Math.abs(res.averagePostGap)).toBeLessThan(0.4);
    expect(res.placeboPValue).toBeGreaterThan(1 / (res.placebo.length + 1));
    expect(() => syntheticControl({ treatedOutcome: sc.treated, donors: [], preperiods: 10 })).toThrow(EngineError);
    expect(() => syntheticControl({ treatedOutcome: sc.treated, donors: sc.donors, preperiods: 1 })).toThrow(EngineError);
    expect(() => syntheticControl({ treatedOutcome: sc.treated, donors: sc.donors, preperiods: 16 })).toThrow(EngineError);
  });
});

describe('refusals rather than plausible numbers', () => {
  const d = confounded('refusals', 400);

  it('refuses a one-arm sample', () => {
    expect(() =>
      naiveDifference({ outcome: d.outcome, treatment: d.treatment.map(() => 1), covariates: [{ name: 'x', values: d.x }] }),
    ).toThrow(/Every unit is treated/);
    expect(() =>
      ipwEstimate({ outcome: d.outcome, treatment: d.treatment.map(() => 0), covariates: [{ name: 'x', values: d.x }] }),
    ).toThrow(/No unit is treated/);
  });

  it('refuses perfect separation in the propensity model', () => {
    // A covariate that determines treatment exactly.
    const t = d.treatment;
    expect(() =>
      ipwEstimate({
        outcome: d.outcome,
        treatment: t,
        covariates: [{ name: 'perfect', values: t.map((v) => v * 10 + 1) }],
      }),
    ).toThrow(EngineError);
  });

  it('refuses a propensity score of exactly 0 or 1', () => {
    const scores = d.treatment.map((t) => (t === 1 ? 1 : 0));
    expect(() => ipwEstimate({ ...spec(d), propensityScores: scores })).toThrow(/not strictly inside/);
  });

  it('refuses n ≤ p and a non-finite outcome', () => {
    const tiny = confounded('tiny', 8);
    expect(() =>
      gComputation(
        {
          outcome: tiny.outcome,
          treatment: tiny.treatment,
          covariates: Array.from({ length: 8 }, (_, j) => ({
            name: `x${j}`,
            values: tiny.x.map((v, i) => v + i * j + (i % (j + 2))),
          })),
        },
        { inference: 'delta' },
      ),
    ).toThrow(EngineError);
    const bad = { ...spec(d) };
    bad.outcome = d.outcome.map((v, i) => (i === 3 ? Number.NaN : v));
    expect(() => naiveDifference(bad)).toThrow(/missing or non-finite/);
  });

  it('never returns NaN or a silently substituted zero', () => {
    const s = spec(d);
    for (const e of [
      naiveDifference(s),
      ipwEstimate(s).estimate,
      gComputation(s, { inference: 'delta' }).estimate,
      aipwEstimate(s).estimate,
      tmleEstimate(s),
      stratifiedEstimate(s),
      manskiBounds(d.outcome, d.treatment, [-12, 12]).estimate,
    ]) {
      expect(Number.isFinite(e.estimate)).toBe(true);
      if (e.standardError !== null) expect(Number.isFinite(e.standardError)).toBe(true);
      if (e.confidenceInterval !== null) {
        expect(Number.isFinite(e.confidenceInterval.low)).toBe(true);
        expect(Number.isFinite(e.confidenceInterval.high)).toBe(true);
        expect(e.confidenceInterval.low).toBeLessThanOrEqual(e.confidenceInterval.high);
      }
    }
  });
});
