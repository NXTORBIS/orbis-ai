/**
 * Regression discontinuity: sharp and fuzzy designs, local linear estimation
 * with a triangular kernel, the Imbens–Kalyaraman bandwidth, a local-quadratic
 * bias correction, the McCrary density test for manipulation and
 * covariate-smoothness checks.
 *
 * The estimate is local to the cutoff. It is the effect for units at the
 * threshold and says nothing about anyone else. Every result repeats that,
 * because an RDD estimate is routinely quoted as "the effect of the policy".
 */

import { EngineError } from '../core/result.ts';
import { variance } from '../stats/descriptive.ts';
import { normalCdf } from '../special/gamma.ts';
import { CONSISTENCY, RDD_CONTINUITY, RDD_NO_MANIPULATION, SUTVA, describeEstimand } from './assumptions.ts';
import { accounting, makeEstimate } from './build.ts';
import { leastSquares, robustVcovHC1, standardErrors } from './fit.ts';
import type { CausalEstimate } from './types.ts';

export interface RddSpec {
  outcome: readonly number[];
  /** The running variable. */
  running: readonly number[];
  cutoff: number;
  /** Bandwidth; omitted means Imbens–Kalyaraman. */
  bandwidth?: number;
  /** Polynomial order of the local fit: 1 (local linear, recommended) or 2. */
  order?: 1 | 2;
  level?: number;
  /** Treatment actually received, for a fuzzy design. */
  treatment?: readonly number[];
  /** True when units at or above the cutoff are treated (the default). */
  treatAbove?: boolean;
}

function triangular(u: number): number {
  return Math.max(0, 1 - Math.abs(u));
}

interface SideFit {
  intercept: number;
  variance: number;
  n: number;
  slope: number;
}

function localFit(
  x: readonly number[],
  y: readonly number[],
  idx: readonly number[],
  cutoff: number,
  h: number,
  order: number,
  side: 'left' | 'right',
): SideFit {
  const rows: number[][] = [];
  const yv: number[] = [];
  const w: number[] = [];
  for (const i of idx) {
    const d = x[i] - cutoff;
    const k = triangular(d / h);
    if (k <= 0) continue;
    const row = [1, d];
    for (let p = 2; p <= order; p++) row.push(Math.pow(d, p));
    rows.push(row);
    yv.push(y[i]);
    w.push(k);
  }
  const need = order + 2;
  if (rows.length < need) {
    throw new EngineError(
      `Regression discontinuity: only ${rows.length} observation(s) with positive kernel weight on the ${side} of ` +
        `the cutoff within the bandwidth ${h.toPrecision(4)}, but ${need} are needed for an order-${order} local ` +
        'fit with a residual degree of freedom. The boundary value on that side is not estimated. Widen the ' +
        'bandwidth, lower the polynomial order, or accept that the data do not reach the cutoff from that side.',
      'empty-side',
    );
  }
  const fit = leastSquares(rows, yv, w, `Regression discontinuity (${side} side)`);
  const vcov = robustVcovHC1(rows, fit);
  const se = standardErrors(vcov);
  return { intercept: fit.beta[0], variance: se[0] * se[0], n: rows.length, slope: fit.beta[1] };
}

/**
 * Imbens–Kalyaraman (2012) optimal bandwidth for the sharp local linear RDD
 * with a triangular kernel, including their regularisation term.
 */
export function imbensKalyaramanBandwidth(
  running: readonly number[],
  outcome: readonly number[],
  cutoff: number,
): { bandwidth: number; notes: string[] } {
  const n = running.length;
  const sx = Math.sqrt(variance(running.slice(), 1));
  if (!(sx > 0)) {
    throw new EngineError(
      'Imbens–Kalyaraman bandwidth: the running variable is constant, so there is no discontinuity to find and no ' +
        'bandwidth to choose.',
      'zero-variance',
    );
  }
  // Step 1: pilot bandwidth.
  const h1 = 1.84 * sx * Math.pow(n, -1 / 5);
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const d = running[i] - cutoff;
    if (d < 0 && d >= -h1) left.push(outcome[i]);
    if (d >= 0 && d <= h1) right.push(outcome[i]);
  }
  if (left.length < 2 || right.length < 2) {
    throw new EngineError(
      `Imbens–Kalyaraman bandwidth: the pilot window of ±${h1.toPrecision(4)} around the cutoff contains ` +
        `${left.length} observation(s) below and ${right.length} above. The variance on at least one side cannot ` +
        'be estimated, so no automatic bandwidth is produced. Supply one explicitly and report that you chose it.',
      'empty-side',
    );
  }
  const fHat = (left.length + right.length) / (2 * n * h1);
  const s2L = variance(left, 1);
  const s2R = variance(right, 1);
  if (!(fHat > 0)) throw new EngineError('Imbens–Kalyaraman bandwidth: the estimated density at the cutoff is zero.', 'density');
  // Step 2: global cubic for the third derivative.
  const Xc: number[][] = [];
  for (let i = 0; i < n; i++) {
    const d = running[i] - cutoff;
    Xc.push([1, d >= 0 ? 1 : 0, d, d * d, d * d * d]);
  }
  const cubic = leastSquares(Xc, outcome, undefined, 'Imbens–Kalyaraman pilot cubic');
  const m3 = 6 * cubic.beta[4];
  const denom3 = Math.max(m3 * m3, 0.01);
  const nL = running.filter((v) => v < cutoff).length;
  const nR = n - nL;
  if (nL === 0 || nR === 0) {
    throw new EngineError(
      `Regression discontinuity: there are ${nL} observation(s) below the cutoff and ${nR} at or above it. With ` +
        'one side empty there is no discontinuity to estimate — the boundary limit from the empty side does not ' +
        'exist and no amount of modelling creates it. No estimate is reported.',
      'empty-side',
    );
  }
  const h2L = 3.56 * Math.pow(s2L / (fHat * denom3), 1 / 7) * Math.pow(nL, -1 / 7);
  const h2R = 3.56 * Math.pow(s2R / (fHat * denom3), 1 / 7) * Math.pow(nR, -1 / 7);
  const notes: string[] = [];
  // Step 3: local quadratics for the second derivatives.
  const secondDeriv = (side: 'left' | 'right', h2: number): { m2: number; nUsed: number } => {
    const rows: number[][] = [];
    const yv: number[] = [];
    for (let i = 0; i < n; i++) {
      const d = running[i] - cutoff;
      const inSide = side === 'left' ? d < 0 : d >= 0;
      if (!inSide || Math.abs(d) > h2) continue;
      rows.push([1, d, d * d]);
      yv.push(outcome[i]);
    }
    if (rows.length < 4) {
      throw new EngineError(
        `Imbens–Kalyaraman bandwidth: only ${rows.length} observation(s) within the ${side}-side pilot window of ` +
          `${h2.toPrecision(4)}, too few for the curvature estimate the rule requires. Supply a bandwidth ` +
          'explicitly rather than accepting a number from a failed procedure.',
        'empty-side',
      );
    }
    const q = leastSquares(rows, yv, undefined, `Imbens–Kalyaraman curvature (${side})`);
    return { m2: 2 * q.beta[2], nUsed: rows.length };
  };
  const qL = secondDeriv('left', h2L);
  const qR = secondDeriv('right', h2R);
  const rL = (2160 * s2L) / (qL.nUsed * Math.pow(h2L, 4));
  const rR = (2160 * s2R) / (qR.nUsed * Math.pow(h2R, 4));
  const curvature = Math.pow(qR.m2 - qL.m2, 2) + rL + rR;
  if (!(curvature > 0)) {
    throw new EngineError('Imbens–Kalyaraman bandwidth: the curvature term came out non-positive.', 'bandwidth');
  }
  const h = 3.4375 * Math.pow((s2L + s2R) / (fHat * curvature), 1 / 5) * Math.pow(n, -1 / 5);
  if (!Number.isFinite(h) || h <= 0) {
    throw new EngineError('Imbens–Kalyaraman bandwidth: the rule produced a non-positive or non-finite value.', 'bandwidth');
  }
  notes.push(
    `Imbens–Kalyaraman bandwidth ${h.toPrecision(5)} (pilot ${h1.toPrecision(4)}; density at the cutoff ` +
      `${fHat.toPrecision(4)}; residual variances ${s2L.toPrecision(4)} below and ${s2R.toPrecision(4)} above; ` +
      `regularisation ${(rL + rR).toPrecision(4)}).`,
    'The bandwidth is a bias–variance choice, not a fact about the data. Any RDD estimate should be reported ' +
      'across a range of bandwidths; the sensitivity list below does that.',
  );
  return { bandwidth: h, notes };
}

export interface McCraryResult {
  /** log f(c+) − log f(c−). */
  logDensityJump: number;
  standardError: number;
  zStatistic: number;
  pValue: number;
  binWidth: number;
  bandwidth: number;
  /** Bin midpoints and counts, for the density plot. */
  binMidpoints: number[];
  binCounts: number[];
  manipulationDetected: boolean;
  warnings: string[];
  note: string;
}

/**
 * McCrary (2008) density test: a local linear estimate of the density of the
 * running variable on each side of the cutoff, and a test of the jump in its
 * logarithm.
 *
 * It detects sorting that shows up as a discontinuity in the density. It
 * detects nothing else — manipulation that shifts units smoothly, or that
 * affects which units appear in the data at all, passes this test.
 */
export function mccraryDensityTest(
  running: readonly number[],
  cutoff: number,
  options: { binWidth?: number; bandwidth?: number; level?: number } = {},
): McCraryResult {
  const n = running.length;
  if (n < 20) {
    throw new EngineError(
      `McCrary density test: ${n} observations. The test is a pair of local linear density estimates and has no ` +
        'useful behaviour below a few dozen points; no result is reported rather than a meaningless p-value.',
      'size',
    );
  }
  const sd = Math.sqrt(variance(running.slice(), 1));
  if (!(sd > 0)) throw new EngineError('McCrary density test: the running variable is constant.', 'zero-variance');
  const b = options.binWidth ?? 2 * sd * Math.pow(n, -1 / 2);
  const lo = Math.min(...running);
  const hi = Math.max(...running);
  if (!(cutoff > lo && cutoff < hi)) {
    throw new EngineError(
      `McCrary density test: the cutoff ${cutoff} lies outside the observed range of the running variable ` +
        `[${lo}, ${hi}], so there is no density on one side of it to compare.`,
      'empty-side',
    );
  }
  // Bins aligned so that no bin straddles the cutoff.
  const kLo = Math.ceil((lo - cutoff) / b);
  const kHi = Math.floor((hi - cutoff) / b);
  const mids: number[] = [];
  const counts: number[] = [];
  for (let k = kLo; k <= kHi; k++) {
    const left = cutoff + k * b;
    const mid = left + b / 2;
    let c = 0;
    for (const v of running) if (v >= left && v < left + b) c++;
    mids.push(mid);
    counts.push(c);
  }
  if (mids.length < 6) {
    throw new EngineError(
      `McCrary density test: only ${mids.length} bins of width ${b.toPrecision(4)} fit in the observed range, too ` +
        'few to fit a local linear density on each side. Choose a smaller bin width deliberately.',
      'size',
    );
  }
  const h = options.bandwidth ?? Math.max(3 * b, sd * Math.pow(n, -1 / 5) * 2);
  const density = counts.map((c) => c / (n * b));
  const side = (want: 'left' | 'right'): { f: number; n: number } => {
    const rows: number[][] = [];
    const yv: number[] = [];
    const w: number[] = [];
    for (let k = 0; k < mids.length; k++) {
      const d = mids[k] - cutoff;
      if (want === 'left' ? d >= 0 : d < 0) continue;
      const kern = triangular(d / h);
      if (kern <= 0) continue;
      rows.push([1, d]);
      yv.push(density[k]);
      w.push(kern);
    }
    if (rows.length < 2) {
      throw new EngineError(
        `McCrary density test: ${rows.length} bin(s) within the bandwidth ${h.toPrecision(4)} on the ${want} of ` +
          'the cutoff. The boundary density on that side cannot be estimated; no test is reported.',
        'empty-side',
      );
    }
    const fit = leastSquares(rows, yv, w, `McCrary (${want})`);
    return { f: fit.beta[0], n: rows.length };
  };
  const L = side('left');
  const R = side('right');
  if (!(L.f > 0) || !(R.f > 0)) {
    throw new EngineError(
      `McCrary density test: the estimated density at the cutoff is non-positive on ` +
        `${L.f > 0 ? 'the right' : 'the left'} side (${Math.min(L.f, R.f).toExponential(3)}). A log-density jump ` +
        'is undefined there. This usually means the running variable has a gap at the cutoff — itself worth ' +
        'investigating — so no test statistic is reported.',
      'density',
    );
  }
  const theta = Math.log(R.f) - Math.log(L.f);
  // McCrary's asymptotic variance for the log-density difference with a
  // triangular kernel: (24/5)·(1/(n·h))·(1/f₊ + 1/f₋).
  const seTheta = Math.sqrt((24 / 5) * (1 / (n * h)) * (1 / R.f + 1 / L.f));
  const z = theta / seTheta;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const alpha = 1 - (options.level ?? 0.95);
  const detected = p < alpha;
  const warnings: string[] = [];
  if (detected) {
    warnings.push(
      `MANIPULATION INDICATED: the density of the running variable jumps by a factor of ${Math.exp(theta).toFixed(3)} ` +
        `at the cutoff (log jump ${theta.toFixed(4)}, SE ${seTheta.toFixed(4)}, z = ${z.toFixed(2)}, ` +
        `p = ${p.toExponential(2)}). Units appear to be sorting across the threshold, which means those just ` +
        'above and just below differ in ways other than treatment. The continuity assumption that the whole ' +
        'design rests on is in doubt, and the RDD estimate should not be read as causal.',
    );
  }
  return {
    logDensityJump: theta,
    standardError: seTheta,
    zStatistic: z,
    pValue: p,
    binWidth: b,
    bandwidth: h,
    binMidpoints: mids,
    binCounts: counts,
    manipulationDetected: detected,
    warnings,
    note:
      'The McCrary test looks for a discontinuity in the DENSITY of the running variable. Passing it rules out ' +
      'one specific kind of manipulation — a pile-up on the favourable side — and nothing more. Manipulation ' +
      'that moves units smoothly, or that determines whether a unit is observed at all, leaves the density ' +
      'continuous and is invisible here.',
  };
}

export interface CovariateSmoothnessRow {
  name: string;
  jump: number;
  standardError: number;
  zStatistic: number;
  pValue: number;
  smooth: boolean;
}

/**
 * Covariate smoothness: the same local linear discontinuity estimate applied
 * to each pre-treatment covariate. A jump in a covariate that the treatment
 * cannot have caused is evidence against continuity.
 */
export function covariateSmoothness(
  running: readonly number[],
  covariates: readonly { name: string; values: readonly number[] }[],
  cutoff: number,
  bandwidth: number,
  options: { order?: 1 | 2; level?: number } = {},
): { rows: CovariateSmoothnessRow[]; warnings: string[] } {
  const order = options.order ?? 1;
  const alpha = 1 - (options.level ?? 0.95);
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < running.length; i++) (running[i] < cutoff ? leftIdx : rightIdx).push(i);
  const rows = covariates.map((c) => {
    const L = localFit(running, c.values, leftIdx, cutoff, bandwidth, order, 'left');
    const R = localFit(running, c.values, rightIdx, cutoff, bandwidth, order, 'right');
    const jump = R.intercept - L.intercept;
    const se = Math.sqrt(L.variance + R.variance);
    const z = se > 0 ? jump / se : 0;
    const p = 2 * (1 - normalCdf(Math.abs(z)));
    return { name: c.name, jump, standardError: se, zStatistic: z, pValue: p, smooth: p >= alpha };
  });
  const bad = rows.filter((r) => !r.smooth);
  const warnings: string[] = [];
  if (bad.length > 0) {
    warnings.push(
      `COVARIATE DISCONTINUITY: ${bad.map((r) => `${r.name} (jump ${r.jump.toPrecision(4)}, p ${r.pValue.toExponential(2)})`).join('; ')}. ` +
        'These are pre-treatment characteristics that the treatment cannot have changed, yet they jump at the ' +
        'cutoff. Units on the two sides are therefore different kinds of unit, and the outcome jump cannot be ' +
        'attributed to treatment.',
    );
  } else {
    warnings.push(
      'No covariate shows a significant jump at the cutoff. That is reassuring about the covariates tested and ' +
        'says nothing about anything untested or unmeasured.',
    );
  }
  return { rows, warnings };
}

export interface RddResult {
  estimate: CausalEstimate;
  bandwidth: number;
  bandwidthSource: 'supplied' | 'Imbens-Kalyaraman';
  /** Left and right boundary estimates. */
  leftLimit: number;
  rightLimit: number;
  nLeft: number;
  nRight: number;
  /** Local-quadratic bias-corrected estimate at the same bandwidth. */
  biasCorrected: { estimate: number; standardError: number; note: string } | null;
  /** The same estimate at other bandwidths, so the choice can be inspected. */
  bandwidthSensitivity: { bandwidth: number; estimate: number; standardError: number | null; note?: string }[];
  /** Fuzzy designs only: the jump in actual treatment receipt. */
  firstStageJump: { estimate: number; standardError: number; weak: boolean } | null;
}

/** Sharp (and, with `treatment` supplied, fuzzy) regression discontinuity. */
export function regressionDiscontinuity(spec: RddSpec): RddResult {
  const n = spec.outcome.length;
  if (n === 0) throw new EngineError('Regression discontinuity: no observations.', 'empty');
  if (spec.running.length !== n) throw new EngineError('Regression discontinuity: running variable length differs.', 'length');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(spec.running[i]) || !Number.isFinite(spec.outcome[i])) {
      throw new EngineError(`Regression discontinuity: a non-finite value at observation ${i}.`, 'finite');
    }
  }
  const level = spec.level ?? 0.95;
  const order = spec.order ?? 1;
  const cutoff = spec.cutoff;
  const leftIdx: number[] = [];
  const rightIdx: number[] = [];
  for (let i = 0; i < n; i++) (spec.running[i] < cutoff ? leftIdx : rightIdx).push(i);
  if (leftIdx.length === 0 || rightIdx.length === 0) {
    throw new EngineError(
      `Regression discontinuity: ${leftIdx.length} observation(s) below the cutoff ${cutoff} and ` +
        `${rightIdx.length} at or above it. A discontinuity is the difference between two one-sided limits; with ` +
        'no data on one side that limit does not exist. Extrapolating across the cutoff from the populated side ' +
        'would produce a number with no empirical content, so none is reported.',
      'empty-side',
    );
  }
  let bandwidth: number;
  let bandwidthSource: 'supplied' | 'Imbens-Kalyaraman';
  const notes: string[] = [];
  if (spec.bandwidth !== undefined) {
    if (!(spec.bandwidth > 0)) throw new EngineError('Regression discontinuity: the bandwidth must be positive.', 'range');
    bandwidth = spec.bandwidth;
    bandwidthSource = 'supplied';
    notes.push(`Bandwidth ${bandwidth.toPrecision(5)} supplied by the caller.`);
  } else {
    const ik = imbensKalyaramanBandwidth(spec.running, spec.outcome, cutoff);
    bandwidth = ik.bandwidth;
    bandwidthSource = 'Imbens-Kalyaraman';
    notes.push(...ik.notes);
  }
  const L = localFit(spec.running, spec.outcome, leftIdx, cutoff, bandwidth, order, 'left');
  const R = localFit(spec.running, spec.outcome, rightIdx, cutoff, bandwidth, order, 'right');
  const treatAbove = spec.treatAbove ?? true;
  const sign = treatAbove ? 1 : -1;
  let est = sign * (R.intercept - L.intercept);
  let se = Math.sqrt(L.variance + R.variance);
  const warnings: string[] = [];

  let firstStageJump: RddResult['firstStageJump'] = null;
  if (spec.treatment) {
    if (spec.treatment.length !== n) throw new EngineError('Regression discontinuity: treatment length differs.', 'length');
    const DL = localFit(spec.running, spec.treatment, leftIdx, cutoff, bandwidth, order, 'left');
    const DR = localFit(spec.running, spec.treatment, rightIdx, cutoff, bandwidth, order, 'right');
    const dJump = sign * (DR.intercept - DL.intercept);
    const dSe = Math.sqrt(DL.variance + DR.variance);
    if (Math.abs(dJump) < 1e-8) {
      throw new EngineError(
        `Fuzzy regression discontinuity: treatment receipt jumps by ${dJump.toExponential(3)} at the cutoff — ` +
          'effectively not at all. The fuzzy estimator divides the outcome jump by this number, so there is no ' +
          'estimate: crossing the cutoff does not change who is treated, so it identifies nothing about the ' +
          'treatment.',
        'no-variation',
      );
    }
    const weak = Math.abs(dJump / dSe) < 3.16; // t² < 10, the usual weak-instrument threshold.
    firstStageJump = { estimate: dJump, standardError: dSe, weak };
    const yJump = est;
    est = yJump / dJump;
    // Delta method for the ratio of the two independent jumps.
    se = Math.sqrt(se * se / (dJump * dJump) + (yJump * yJump * dSe * dSe) / Math.pow(dJump, 4));
    notes.push(
      `Fuzzy design: outcome jump ${yJump.toPrecision(5)} divided by the treatment-receipt jump ` +
        `${dJump.toPrecision(5)} (SE ${dSe.toPrecision(4)}).`,
      'A fuzzy RDD is instrumental variables with the cutoff as the instrument. The estimate is therefore a ' +
        'LATE: the effect among units at the cutoff whose treatment status is changed by crossing it. It is not ' +
        'the effect for everyone at the cutoff, and not the effect away from the cutoff either.',
    );
    if (weak) {
      warnings.push(
        `WEAK FIRST STAGE at the cutoff: the treatment jump is ${dJump.toPrecision(4)} with standard error ` +
          `${dSe.toPrecision(4)} (t = ${(dJump / dSe).toFixed(2)}, below the √10 ≈ 3.16 that corresponds to the ` +
          'conventional F > 10). The fuzzy estimator divides by a number that is not well distinguished from ' +
          'zero, so the ratio has heavy tails, the delta-method standard error understates the uncertainty, and ' +
          'the estimate is biased towards the confounded sharp comparison.',
      );
    }
  }

  // Local-quadratic bias correction at the same bandwidth.
  let biasCorrected: RddResult['biasCorrected'] = null;
  if (order === 1) {
    try {
      const L2 = localFit(spec.running, spec.outcome, leftIdx, cutoff, bandwidth, 2, 'left');
      const R2 = localFit(spec.running, spec.outcome, rightIdx, cutoff, bandwidth, 2, 'right');
      const bc = sign * (R2.intercept - L2.intercept);
      biasCorrected = {
        estimate: spec.treatment && firstStageJump ? bc / firstStageJump.estimate : bc,
        standardError: Math.sqrt(L2.variance + R2.variance),
        note:
          'Local quadratic fit at the same bandwidth. The difference from the local linear estimate is the ' +
          'leading smoothing bias; a large difference means the estimate depends on the functional form and the ' +
          'bandwidth is too wide for a linear approximation. The quadratic standard error is larger, which is ' +
          'the price of the correction and should be reported with it rather than the linear one.',
      };
      if (Math.abs(bc - sign * (R.intercept - L.intercept)) > 2 * Math.sqrt(L.variance + R.variance)) {
        warnings.push(
          `The local quadratic estimate (${bc.toPrecision(5)}) differs from the local linear estimate ` +
            `(${(sign * (R.intercept - L.intercept)).toPrecision(5)}) by more than two local-linear standard ` +
            'errors. The result is driven by the polynomial order, so it is a modelling choice rather than a ' +
            'discontinuity in the data.',
        );
      }
    } catch {
      notes.push(
        'A local quadratic bias correction could not be fitted at this bandwidth (too few observations on one ' +
          'side), so no bias-corrected estimate is reported.',
      );
    }
  }

  // Bandwidth sensitivity.
  const sensitivity: RddResult['bandwidthSensitivity'] = [];
  for (const mult of [0.5, 0.75, 1, 1.5, 2]) {
    const h = bandwidth * mult;
    try {
      const l = localFit(spec.running, spec.outcome, leftIdx, cutoff, h, order, 'left');
      const r = localFit(spec.running, spec.outcome, rightIdx, cutoff, h, order, 'right');
      let e = sign * (r.intercept - l.intercept);
      let s: number | null = Math.sqrt(l.variance + r.variance);
      if (spec.treatment) {
        const dl = localFit(spec.running, spec.treatment, leftIdx, cutoff, h, order, 'left');
        const dr = localFit(spec.running, spec.treatment, rightIdx, cutoff, h, order, 'right');
        const dj = sign * (dr.intercept - dl.intercept);
        if (Math.abs(dj) < 1e-8) {
          sensitivity.push({ bandwidth: h, estimate: NaN, standardError: null, note: 'no treatment jump at this bandwidth' });
          continue;
        }
        s = Math.sqrt((s * s) / (dj * dj) + (e * e * (dl.variance + dr.variance)) / Math.pow(dj, 4));
        e = e / dj;
      }
      sensitivity.push({ bandwidth: h, estimate: e, standardError: s });
    } catch {
      sensitivity.push({ bandwidth: h, estimate: NaN, standardError: null, note: 'not estimable at this bandwidth' });
    }
  }
  const usable = sensitivity.filter((s) => Number.isFinite(s.estimate));
  if (usable.length >= 2) {
    const spread = Math.max(...usable.map((s) => s.estimate)) - Math.min(...usable.map((s) => s.estimate));
    if (spread > 2 * se) {
      warnings.push(
        `The estimate moves by ${spread.toPrecision(4)} across bandwidths from half to twice the chosen one — more ` +
          'than two standard errors. The number you quote is substantially a consequence of the bandwidth ' +
          'choice, not of the data at the cutoff.',
      );
    }
  }

  if (L.n < 20 || R.n < 20) {
    warnings.push(
      `Only ${L.n} observation(s) below and ${R.n} above the cutoff carry positive kernel weight. An RDD estimate ` +
        'from this few effective observations is very imprecise and the asymptotic interval is optimistic.',
    );
  }

  const estimate = makeEstimate({
    method:
      (spec.treatment ? 'Fuzzy' : 'Sharp') +
      ` regression discontinuity (local ${order === 1 ? 'linear' : 'quadratic'}, triangular kernel)`,
    estimand: describeEstimand('local-at-cutoff'),
    estimate: est,
    standardError: se,
    level,
    exactness: 'empirical',
    sample: {
      ...accounting(
        spec.running.map((v) => ((v < cutoff) === treatAbove ? 0 : 1)),
        L.n + R.n,
        null,
        [
          `${n - L.n - R.n} of ${n} observations fall outside the bandwidth ${bandwidth.toPrecision(5)} and receive ` +
            'zero kernel weight. They are not used; the estimate is local by construction.',
        ],
      ),
    },
    assumptions: [
      CONSISTENCY,
      SUTVA,
      RDD_CONTINUITY,
      RDD_NO_MANIPULATION,
      {
        name: 'Correct local approximation within the bandwidth',
        statement:
          `The conditional mean of the outcome is well approximated by an order-${order} polynomial in the running ` +
          'variable within the chosen bandwidth on each side.',
        testable: false,
        ifViolated:
          'Curvature inside the window is mistaken for a jump at the boundary. This is why the bandwidth and ' +
          'polynomial-order sensitivities are reported with every estimate.',
      },
      ...(spec.treatment
        ? [
            {
              name: 'Exclusion restriction at the cutoff (fuzzy design only)',
              statement: 'Crossing the cutoff affects the outcome only by changing treatment receipt.',
              testable: false,
              ifViolated: 'Anything else the threshold triggers is attributed to the treatment, amplified by one over the treatment jump.',
            },
            {
              name: 'Monotonicity at the cutoff (fuzzy design only)',
              statement: 'Crossing the cutoff never pushes a unit out of treatment.',
              testable: false,
              ifViolated: 'The ratio is not a weighted average of any unit\'s effect.',
            },
          ]
        : []),
    ],
    inferenceNote:
      'Heteroskedasticity-robust (HC1) standard errors from the two weighted one-sided fits, combined as ' +
      'independent limits. Asymptotic: it does not account for the bandwidth having been chosen from these data.',
    warnings,
    notes: [
      ...notes,
      `Boundary estimates: ${L.intercept.toPrecision(6)} below the cutoff (${L.n} weighted observations), ` +
        `${R.intercept.toPrecision(6)} above (${R.n}).`,
      ...sensitivity.map(
        (s) =>
          `Bandwidth ${s.bandwidth.toPrecision(4)}: estimate ` +
          (Number.isFinite(s.estimate) ? s.estimate.toPrecision(5) : `not estimable (${s.note})`) +
          (s.standardError !== null ? `, SE ${s.standardError.toPrecision(4)}` : ''),
      ),
      'LOCAL TO THE CUTOFF. This is the effect for units at the threshold, where treated and untreated units are ' +
        'comparable. It is not the effect of the policy for units far from the threshold, it is not the average ' +
        'effect in the population, and extrapolating it away from the cutoff requires exactly the modelling ' +
        'assumptions the design was chosen to avoid.',
    ],
  });
  return {
    estimate,
    bandwidth,
    bandwidthSource,
    leftLimit: L.intercept,
    rightLimit: R.intercept,
    nLeft: L.n,
    nRight: R.n,
    biasCorrected,
    bandwidthSensitivity: sensitivity,
    firstStageJump,
  };
}
