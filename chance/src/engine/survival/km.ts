/**
 * Non-parametric survival estimation: Kaplan–Meier, Nelson–Aalen,
 * Fleming–Harrington, median and quantile survival, RMST, the actuarial
 * life table and a kernel-smoothed hazard.
 *
 * All of these are *empirical*: they are estimates read off the data with no
 * distributional model. Their standard errors and intervals, however, are
 * asymptotic approximations, and are labelled as such.
 */

import { EngineError, Validator, attempt, type EngineResult, type Explanation } from '../core/result.ts';
import { brentRoot } from '../core/numeric.ts';
import { normalPdf } from '../special/gamma.ts';
import {
  CENSORING_FRAGILITY,
  INDEPENDENT_CENSORING,
  buildRiskTable,
  censoringNote,
  heavyCensoringWarnings,
  summarizeFollowUp,
  validateSurvivalInput,
  zForLevel,
  type FollowUpSummary,
  type RiskRow,
} from './data.ts';

/** One step of the Kaplan–Meier curve, at a time where at least one event occurred. */
export interface KMPoint {
  time: number;
  atRisk: number;
  events: number;
  /** Observations censored in [time, next event time). */
  censored: number;
  /** Ŝ(time), the estimated probability of surviving beyond `time`. */
  survival: number;
  /** Greenwood standard error of Ŝ(time). */
  stdError: number;
  /** Running Greenwood sum Σ d/(n(n−d)); the variance of Ŝ is Ŝ²·this. */
  greenwoodSum: number;
  /** Pointwise CI on the log–log scale (stays inside [0, 1]). */
  lower: number;
  upper: number;
  /** Naive linear (Greenwood) CI, for comparison only — it can leave [0, 1]. */
  linearLower: number;
  linearUpper: number;
  /** Nelson–Aalen cumulative hazard at this time. */
  cumulativeHazard: number;
  /** Standard error of the Nelson–Aalen estimate. */
  cumulativeHazardStdError: number;
  /** Fleming–Harrington survival estimate exp(−Λ̂). */
  flemingHarrington: number;
}

export interface ConfidenceBandPoint {
  time: number;
  survival: number;
  lower: number;
  upper: number;
}

export interface MedianEstimable {
  estimable: true;
  time: number;
  /** Brookmeyer–Crowley confidence interval; a bound is null when not reached. */
  lower: number | null;
  upper: number | null;
}

export interface MedianNotEstimable {
  estimable: false;
  reason: string;
  /** The lowest value the curve reached — evidence, not an estimate of the median. */
  lowestSurvival: number;
}

export type MedianSurvival = MedianEstimable | MedianNotEstimable;

export interface QuantileSurvival {
  p: number;
  estimable: boolean;
  time: number | null;
  reason?: string;
}

export interface RMSTResult {
  horizon: number;
  /** ∫₀^τ Ŝ(u) du. */
  rmst: number;
  stdError: number;
  lower: number;
  upper: number;
  /** True when the horizon exceeds the last observed time (the tail is extrapolated flat). */
  horizonBeyondData: boolean;
}

export interface KaplanMeierResult {
  summary: FollowUpSummary;
  /** Full risk table over every distinct observed time. */
  riskTable: RiskRow[];
  /** The survival curve: one point per distinct event time. */
  curve: KMPoint[];
  level: number;
  median: MedianSurvival;
  quantiles: QuantileSurvival[];
  /** Simultaneous Hall–Wellner band over the event times. */
  hallWellnerBand: ConfidenceBandPoint[];
  /** Simultaneous equal-precision (Nair) band over the event times. */
  equalPrecisionBand: ConfidenceBandPoint[];
  /** Critical values actually used for the two bands. */
  bandCriticalValues: { hallWellner: number; equalPrecision: number };
  explanation: Explanation;
}

const LOGLOG_RATIONALE =
  'Pointwise intervals are computed on the log(−log Ŝ) scale and transformed back, so they always ' +
  'lie inside [0, 1]. The naive linear interval Ŝ ± z·se can run below 0 or above 1, especially in ' +
  'the tails and at small risk sets, which is why it is reported only for comparison.';

const BAND_NOTE =
  'A pointwise interval covers Ŝ(t) at one chosen time t with the stated probability. A ' +
  'simultaneous band covers the whole curve over the band range at once, so it is wider. Reading a ' +
  'pointwise interval as if it covered the whole curve overstates the precision.';

/** Kolmogorov distribution: P(sup|B| > h) = 2 Σ (−1)^{k+1} exp(−2k²h²). */
function supBrownianBridgeTail(h: number): number {
  if (h <= 0) return 1;
  let s = 0;
  for (let k = 1; k <= 200; k++) {
    const term = Math.exp(-2 * k * k * h * h);
    s += (k % 2 === 1 ? 1 : -1) * term;
    if (term < 1e-18) break;
  }
  return Math.min(1, Math.max(0, 2 * s));
}

/** Critical value h_α with P(sup₀≤x≤1 |B(x)| > h) = α. h_0.05 ≈ 1.358099. */
export function hallWellnerCritical(level: number): number {
  const alpha = 1 - level;
  return brentRoot((h) => supBrownianBridgeTail(h) - alpha, 0.2, 6, { tol: 1e-12 });
}

/**
 * Equal-precision critical value, Miller–Siegmund approximation for the
 * standardised Brownian bridge U(x) = B(x)/√(x(1−x)):
 *   P(sup_{a≤x≤b} |U| ≥ d) ≈ 4φ(d)/d + φ(d)(d − 1/d)·log[b(1−a)/(a(1−b))].
 * This is an approximation, not an exact tail, and the band is labelled so.
 */
export function equalPrecisionCritical(level: number, a: number, b: number): number {
  const alpha = 1 - level;
  const lo = Math.min(Math.max(a, 1e-6), 1 - 1e-6);
  const hi = Math.min(Math.max(b, lo + 1e-6), 1 - 1e-6);
  const L = Math.log((hi * (1 - lo)) / (lo * (1 - hi)));
  const tail = (d: number): number => 4 * (normalPdf(d) / d) + normalPdf(d) * (d - 1 / d) * L;
  // tail is monotone decreasing in d over the region of interest.
  let upper = 2;
  while (tail(upper) > alpha && upper < 20) upper *= 1.5;
  if (tail(1.0) < alpha) return 1.0;
  return brentRoot((d) => tail(d) - alpha, 1.0, upper, { tol: 1e-12 });
}

export interface KaplanMeierOptions {
  level?: number;
  /** Quantiles of the survival distribution to report; default 0.25, 0.5, 0.75. */
  quantiles?: number[];
}

/** Kaplan–Meier product-limit estimator with Greenwood variance. */
export function kaplanMeier(
  time: readonly number[],
  status: readonly number[],
  options: KaplanMeierOptions = {},
): EngineResult<KaplanMeierResult> {
  return attempt(() => kaplanMeierOrThrow(time, status, options), []);
}

export function kaplanMeierOrThrow(
  time: readonly number[],
  status: readonly number[],
  options: KaplanMeierOptions = {},
): KaplanMeierResult {
  validateSurvivalInput(time, status);
  const level = options.level ?? 0.95;
  const z = zForLevel(level);
  const summary = summarizeFollowUp(time, status);
  const riskTable = buildRiskTable(time, status);
  const n = summary.n;

  const curve: KMPoint[] = [];
  let survival = 1;
  let gSum = 0;
  let cumHaz = 0;
  let cumHazVar = 0;
  // Censorings are attributed forward: the `censored` field of an event time t_j
  // counts observations censored in [t_j, t_{j+1}), the standard risk-table layout.
  for (const row of riskTable) {
    if (row.events === 0) {
      // Censorings at a time with no events attach to the previous step; those
      // before the first event belong to no step and appear in the risk table only.
      if (curve.length > 0) curve[curve.length - 1].censored += row.censored;
      continue;
    }
    const d = row.events;
    const atRisk = row.atRisk;
    survival *= 1 - d / atRisk;
    gSum += atRisk === d ? Infinity : d / (atRisk * (atRisk - d));
    cumHaz += d / atRisk;
    // Aalen variance estimator for Nelson–Aalen: Σ (n−d)d / n³  (finite-sample form).
    cumHazVar += ((atRisk - d) * d) / (atRisk * atRisk * atRisk);
    const stdError = survival === 0 || !Number.isFinite(gSum) ? 0 : survival * Math.sqrt(gSum);
    const point: KMPoint = {
      time: row.time,
      atRisk,
      events: d,
      censored: row.censored,
      survival,
      stdError,
      greenwoodSum: gSum,
      ...loglogInterval(survival, gSum, z),
      linearLower: Math.max(0, survival - z * stdError),
      linearUpper: Math.min(1, survival + z * stdError),
      cumulativeHazard: cumHaz,
      cumulativeHazardStdError: Math.sqrt(cumHazVar),
      flemingHarrington: Math.exp(-cumHaz),
    };
    curve.push(point);
  }


  const median = medianFromCurve(curve, z);
  const qs = options.quantiles ?? [0.25, 0.5, 0.75];
  const quantiles = qs.map((p) => quantileFromCurve(curve, p));

  const { hallWellnerBand, equalPrecisionBand, bandCriticalValues } = confidenceBands(curve, n, level);

  const warnings = heavyCensoringWarnings(summary);
  const explanation: Explanation = {
    method: 'Kaplan–Meier product-limit estimator with Greenwood variance',
    formula: 'Ŝ(t) = Π_{t_j ≤ t} (1 − d_j / n_j)',
    steps: [
      { label: 'Sample', value: censoringNote(summary) },
      { label: 'Distinct event times', value: String(curve.length) },
      {
        label: 'Greenwood variance',
        expression: 'Var(Ŝ(t)) = Ŝ(t)² · Σ_{t_j ≤ t} d_j / (n_j (n_j − d_j))',
      },
      {
        label: 'Pointwise interval',
        expression: 'Ŝ^exp(±z·σ/|log Ŝ|) on the log(−log) scale',
      },
      ...warnings.map((w) => ({ label: 'Warning', value: w })),
    ],
    assumptions: [
      INDEPENDENT_CENSORING,
      'Censoring times are assumed to be observed exactly; a subject censored at t is counted in the risk set at t.',
    ],
    limitations: [
      LOGLOG_RATIONALE,
      BAND_NOTE,
      'The curve cannot be estimated beyond the largest observed time; it is flat there by convention, not by evidence.',
      'Greenwood standard errors and the bands are asymptotic approximations, poor when the risk set is small.',
      CENSORING_FRAGILITY,
    ],
    exactness: 'empirical',
  };
  return {
    summary,
    riskTable,
    curve,
    level,
    median,
    quantiles,
    hallWellnerBand,
    equalPrecisionBand,
    bandCriticalValues,
    explanation,
  };
}

function loglogInterval(
  s: number,
  gSum: number,
  z: number,
): { lower: number; upper: number } {
  if (s <= 0 || s >= 1 || !Number.isFinite(gSum)) {
    // log(−log S) is undefined at S = 0 or 1; fall back to the degenerate bound.
    return { lower: s <= 0 ? 0 : 1, upper: s <= 0 ? 0 : 1 };
  }
  const sigma = Math.sqrt(gSum) / Math.abs(Math.log(s));
  return {
    lower: Math.pow(s, Math.exp(z * sigma)),
    upper: Math.pow(s, Math.exp(-z * sigma)),
  };
}

function confidenceBands(
  curve: readonly KMPoint[],
  n: number,
  level: number,
): {
  hallWellnerBand: ConfidenceBandPoint[];
  equalPrecisionBand: ConfidenceBandPoint[];
  bandCriticalValues: { hallWellner: number; equalPrecision: number };
} {
  if (curve.length === 0) {
    return {
      hallWellnerBand: [],
      equalPrecisionBand: [],
      bandCriticalValues: { hallWellner: NaN, equalPrecision: NaN },
    };
  }
  const usable = curve.filter((p) => Number.isFinite(p.greenwoodSum) && p.greenwoodSum > 0 && p.survival > 0);
  const aOf = (p: KMPoint): number => (n * p.greenwoodSum) / (1 + n * p.greenwoodSum);
  const aLow = usable.length ? aOf(usable[0]) : 0.1;
  const aHigh = usable.length ? aOf(usable[usable.length - 1]) : 0.9;
  const h = hallWellnerCritical(level);
  const e = equalPrecisionCritical(level, aLow, aHigh);
  const hallWellnerBand: ConfidenceBandPoint[] = [];
  const equalPrecisionBand: ConfidenceBandPoint[] = [];
  for (const p of curve) {
    const g = p.greenwoodSum;
    if (!Number.isFinite(g) || p.survival <= 0) {
      hallWellnerBand.push({ time: p.time, survival: p.survival, lower: 0, upper: p.survival > 0 ? 1 : 0 });
      equalPrecisionBand.push({ time: p.time, survival: p.survival, lower: 0, upper: p.survival > 0 ? 1 : 0 });
      continue;
    }
    // Both bands are built on the log(−log) scale so that they stay inside [0, 1].
    const logS = Math.log(p.survival);
    const sigma = Math.sqrt(g);
    const hwHalf = (h * (1 + n * g)) / (Math.sqrt(n) * Math.abs(logS));
    const epHalf = (e * sigma) / Math.abs(logS);
    hallWellnerBand.push({
      time: p.time,
      survival: p.survival,
      lower: Math.pow(p.survival, Math.exp(hwHalf)),
      upper: Math.pow(p.survival, Math.exp(-hwHalf)),
    });
    equalPrecisionBand.push({
      time: p.time,
      survival: p.survival,
      lower: Math.pow(p.survival, Math.exp(epHalf)),
      upper: Math.pow(p.survival, Math.exp(-epHalf)),
    });
  }
  return { hallWellnerBand, equalPrecisionBand, bandCriticalValues: { hallWellner: h, equalPrecision: e } };
}

const MEDIAN_NOT_REACHED =
  'The estimated survival curve never falls to or below 0.5, so the median survival time is NOT ' +
  'estimable from this data. It is not the largest observed time, and it is not infinite — it is ' +
  'simply beyond the follow-up achieved. Reporting the last observed time as a median is the most ' +
  'common dishonesty in survival reporting. Use the restricted mean survival time instead.';

function medianFromCurve(curve: readonly KMPoint[], z: number): MedianSurvival {
  const lowest = curve.length ? curve[curve.length - 1].survival : 1;
  const idx = curve.findIndex((p) => p.survival <= 0.5);
  if (idx < 0) {
    return { estimable: false, reason: MEDIAN_NOT_REACHED, lowestSurvival: lowest };
  }
  const time = curve[idx].time;
  // Brookmeyer–Crowley test-based interval: the set of t for which the test of
  // H0: S(t) = 0.5 is not rejected, i.e. (Ŝ(t) − 0.5)² ≤ z² · Var(Ŝ(t)).
  const inSet = curve.filter((p) => {
    if (!Number.isFinite(p.greenwoodSum)) return false;
    const se = p.survival * Math.sqrt(p.greenwoodSum);
    if (se === 0) return false;
    return Math.abs(p.survival - 0.5) <= z * se;
  });
  if (inSet.length === 0) return { estimable: true, time, lower: null, upper: null };
  const lower = inSet[0].time;
  const upper = inSet[inSet.length - 1].time;
  const reachedEnd = inSet[inSet.length - 1] === curve[curve.length - 1];
  return { estimable: true, time, lower, upper: reachedEnd ? null : upper };
}

function quantileFromCurve(curve: readonly KMPoint[], p: number): QuantileSurvival {
  const v = new Validator();
  if (!(p > 0 && p < 1)) {
    v.add(`Quantile probability must be strictly between 0 and 1 (got ${p}).`, 'p', 'range');
    v.throwIfInvalid();
  }
  const target = 1 - p;
  const hit = curve.find((q) => q.survival <= target);
  if (!hit) {
    return {
      p,
      estimable: false,
      time: null,
      reason:
        `The curve never falls to ${target.toFixed(4)}, so the ${p} quantile of survival time is not ` +
        'estimable within the observed follow-up.',
    };
  }
  return { p, estimable: true, time: hit.time };
}

/**
 * Median survival as its own result, so that "not estimable" is a refusal
 * rather than a number the caller might mistake for an estimate.
 */
export function medianSurvival(
  time: readonly number[],
  status: readonly number[],
  level = 0.95,
): EngineResult<MedianEstimable> {
  return attempt(() => {
    const km = kaplanMeierOrThrow(time, status, { level });
    if (!km.median.estimable) {
      throw new EngineError([
        {
          code: 'not-estimable',
          message:
            MEDIAN_NOT_REACHED +
            ` Lowest estimated survival reached: ${km.median.lowestSurvival.toFixed(6)}.`,
          field: 'median',
        },
      ]);
    }
    return km.median;
  });
}

/**
 * Restricted mean survival time up to `horizon`: the area under the
 * Kaplan–Meier curve on [0, τ]. This is the robust summary when the median is
 * not reached, and it is a time, not a ratio, so it does not need
 * proportional hazards to mean anything.
 */
export function restrictedMeanSurvival(
  time: readonly number[],
  status: readonly number[],
  horizon: number,
  level = 0.95,
): EngineResult<RMSTResult> {
  return attempt(() => {
    const v = new Validator();
    v.positive(horizon, 'horizon', 'Horizon τ');
    v.throwIfInvalid();
    const km = kaplanMeierOrThrow(time, status, { level });
    return rmstFromCurve(km.curve, km.summary.maxTime, horizon, level);
  });
}

export function rmstFromCurve(
  curve: readonly KMPoint[],
  maxObserved: number,
  horizon: number,
  level: number,
): RMSTResult {
  const z = zForLevel(level);
  // Step function: S = 1 on [0, t1), then curve[j].survival on [t_j, t_{j+1}).
  const pts = curve.filter((p) => p.time < horizon);
  let area = 0;
  let prevTime = 0;
  let prevS = 1;
  for (const p of pts) {
    area += prevS * (p.time - prevTime);
    prevTime = p.time;
    prevS = p.survival;
  }
  area += prevS * (horizon - prevTime);

  // Var(RMST) = Σ_{t_j ≤ τ} ( ∫_{t_j}^{τ} Ŝ(u) du )² · d_j / (n_j (n_j − d_j)).
  // Tail integrals are accumulated from the right so this stays O(k).
  const tails = new Array<number>(pts.length).fill(0);
  for (let j = pts.length - 1; j >= 0; j--) {
    const next = j + 1 < pts.length ? pts[j + 1].time : horizon;
    tails[j] = pts[j].survival * (next - pts[j].time) + (j + 1 < pts.length ? tails[j + 1] : 0);
  }
  let variance = 0;
  for (let j = 0; j < pts.length; j++) {
    const p = pts[j];
    if (p.atRisk === p.events) continue;
    const tail = tails[j];
    variance += tail * tail * (p.events / (p.atRisk * (p.atRisk - p.events)));
  }
  const se = Math.sqrt(variance);
  return {
    horizon,
    rmst: area,
    stdError: se,
    lower: Math.max(0, area - z * se),
    upper: area + z * se,
    horizonBeyondData: horizon > maxObserved,
  };
}

/** Nelson–Aalen cumulative hazard, reported on its own. */
export interface NelsonAalenPoint {
  time: number;
  atRisk: number;
  events: number;
  cumulativeHazard: number;
  stdError: number;
  lower: number;
  upper: number;
  /** Fleming–Harrington survival estimate exp(−Λ̂(t)). */
  survival: number;
}

export interface NelsonAalenResult {
  summary: FollowUpSummary;
  curve: NelsonAalenPoint[];
  level: number;
  explanation: Explanation;
}

export function nelsonAalen(
  time: readonly number[],
  status: readonly number[],
  level = 0.95,
): EngineResult<NelsonAalenResult> {
  return attempt(() => {
    validateSurvivalInput(time, status);
    const z = zForLevel(level);
    const summary = summarizeFollowUp(time, status);
    const rows = buildRiskTable(time, status);
    const curve: NelsonAalenPoint[] = [];
    let cum = 0;
    let varSum = 0;
    for (const row of rows) {
      if (row.events === 0) continue;
      cum += row.events / row.atRisk;
      varSum += ((row.atRisk - row.events) * row.events) / Math.pow(row.atRisk, 3);
      const se = Math.sqrt(varSum);
      curve.push({
        time: row.time,
        atRisk: row.atRisk,
        events: row.events,
        cumulativeHazard: cum,
        stdError: se,
        // Log-transformed interval keeps the cumulative hazard positive.
        lower: cum * Math.exp((-z * se) / Math.max(cum, 1e-300)),
        upper: cum * Math.exp((z * se) / Math.max(cum, 1e-300)),
        survival: Math.exp(-cum),
      });
    }
    return {
      summary,
      curve,
      level,
      explanation: {
        method: 'Nelson–Aalen cumulative hazard estimator (Fleming–Harrington survival = exp(−Λ̂))',
        formula: 'Λ̂(t) = Σ_{t_j ≤ t} d_j / n_j',
        steps: [
          { label: 'Sample', value: censoringNote(summary) },
          { label: 'Variance', expression: 'Var(Λ̂(t)) = Σ (n_j − d_j) d_j / n_j³ (Aalen)' },
          {
            label: 'Relation to Kaplan–Meier',
            value:
              'exp(−Λ̂) ≥ Ŝ_KM always, with the gap shrinking as risk sets grow; the two agree to first order.',
          },
        ],
        assumptions: [INDEPENDENT_CENSORING],
        limitations: [
          'The interval for Λ̂ is a log-transformed asymptotic interval, not exact.',
          CENSORING_FRAGILITY,
        ],
        exactness: 'empirical',
      },
    };
  });
}

/** Actuarial (life-table) estimator for grouped or interval-censored counts. */
export interface LifeTableInterval {
  /** Left endpoint of the interval, inclusive. */
  start: number;
  /** Right endpoint, exclusive; Infinity is allowed for the last interval. */
  end: number;
  /** Events observed in the interval. */
  events: number;
  /** Withdrawals (censorings) in the interval. */
  withdrawn: number;
}

export interface LifeTableRow extends LifeTableInterval {
  entering: number;
  /** Effective number at risk: entering − withdrawn/2 (uniform withdrawal). */
  effectiveAtRisk: number;
  conditionalEventProbability: number;
  survivalAtEnd: number;
  stdError: number;
  lower: number;
  upper: number;
}

export interface LifeTableResult {
  rows: LifeTableRow[];
  level: number;
  explanation: Explanation;
}

export function lifeTable(
  intervals: readonly LifeTableInterval[],
  level = 0.95,
): EngineResult<LifeTableResult> {
  return attempt(() => {
    const v = new Validator();
    if (intervals.length === 0) v.add('No intervals supplied.', 'intervals', 'empty');
    let totalEvents = 0;
    intervals.forEach((iv, i) => {
      if (!(iv.end > iv.start)) {
        v.add(`Interval ${i + 1} must have end > start (got [${iv.start}, ${iv.end}]).`, 'intervals', 'range');
      }
      v.integer(iv.events, 'events', `Interval ${i + 1} events`, 0);
      v.integer(iv.withdrawn, 'withdrawn', `Interval ${i + 1} withdrawals`, 0);
      totalEvents += iv.events;
    });
    v.throwIfInvalid();
    if (totalEvents === 0) {
      throw new EngineError([
        {
          code: 'no-events',
          message: 'No events occurred in any interval, so no survival curve is estimable.',
          field: 'intervals',
        },
      ]);
    }
    const z = zForLevel(level);
    let entering = intervals.reduce((s, iv) => s + iv.events + iv.withdrawn, 0);
    let survival = 1;
    let gSum = 0;
    const rows: LifeTableRow[] = [];
    for (const iv of intervals) {
      const effective = entering - iv.withdrawn / 2;
      if (effective <= 0) {
        throw new EngineError([
          {
            code: 'empty-interval',
            message:
              `Interval [${iv.start}, ${iv.end}) has no effective subjects at risk ` +
              `(entering ${entering}, withdrawn ${iv.withdrawn}); the conditional probability is undefined.`,
            field: 'intervals',
          },
        ]);
      }
      if (iv.events > effective) {
        throw new EngineError([
          {
            code: 'inconsistent',
            message:
              `Interval [${iv.start}, ${iv.end}) reports ${iv.events} events but only ${effective} ` +
              'effective subjects at risk.',
            field: 'intervals',
          },
        ]);
      }
      const q = iv.events / effective;
      survival *= 1 - q;
      gSum += effective === iv.events ? Infinity : q / (effective * (1 - q));
      const se = Number.isFinite(gSum) ? survival * Math.sqrt(gSum) : 0;
      rows.push({
        ...iv,
        entering,
        effectiveAtRisk: effective,
        conditionalEventProbability: q,
        survivalAtEnd: survival,
        stdError: se,
        ...loglogInterval(survival, gSum, z),
      });
      entering -= iv.events + iv.withdrawn;
    }
    return {
      rows,
      level,
      explanation: {
        method: 'Actuarial (life-table) survival estimator',
        formula: 'q_i = d_i / (n_i − w_i/2),  Ŝ = Π (1 − q_i)',
        steps: [
          { label: 'Intervals', value: String(intervals.length) },
          {
            label: 'Withdrawal correction',
            value: 'Withdrawals are assumed uniform within the interval, so half of them are at risk.',
          },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'Events and withdrawals are assumed uniformly spread within each interval. With wide intervals this matters.',
        ],
        limitations: [
          'Grouping discards the exact event times; the life table is coarser than Kaplan–Meier and should only be used when exact times are unavailable.',
          'Intervals must be supplied in increasing order and must not overlap; this is not checked beyond end > start.',
        ],
        exactness: 'empirical',
      },
    };
  });
}

/** Kernel-smoothed hazard from the Nelson–Aalen increments. */
export interface SmoothedHazardPoint {
  time: number;
  hazard: number;
  stdError: number;
}

export interface SmoothedHazardResult {
  bandwidth: number;
  points: SmoothedHazardPoint[];
  explanation: Explanation;
}

export function smoothedHazard(
  time: readonly number[],
  status: readonly number[],
  options: { bandwidth?: number; grid?: number[]; gridPoints?: number } = {},
): EngineResult<SmoothedHazardResult> {
  return attempt(() => {
    validateSurvivalInput(time, status);
    const rows = buildRiskTable(time, status).filter((r) => r.events > 0);
    const summary = summarizeFollowUp(time, status);
    const span = summary.maxTime - summary.minTime;
    const bandwidth =
      options.bandwidth ?? (span > 0 ? span / Math.max(2, Math.cbrt(summary.events)) : 1);
    const v = new Validator();
    v.positive(bandwidth, 'bandwidth', 'Bandwidth');
    v.throwIfInvalid();
    const gridPoints = options.gridPoints ?? 50;
    const grid =
      options.grid ??
      Array.from({ length: gridPoints }, (_, i) =>
        summary.minTime + ((i + 0.5) * span) / gridPoints,
      );
    // Epanechnikov kernel, K(u) = 0.75(1 − u²) on |u| ≤ 1.
    const K = (u: number): number => (Math.abs(u) <= 1 ? 0.75 * (1 - u * u) : 0);
    const points = grid.map((t) => {
      let h = 0;
      let varSum = 0;
      for (const r of rows) {
        const w = K((t - r.time) / bandwidth) / bandwidth;
        if (w === 0) continue;
        h += w * (r.events / r.atRisk);
        varSum += w * w * (((r.atRisk - r.events) * r.events) / Math.pow(r.atRisk, 3));
      }
      return { time: t, hazard: h, stdError: Math.sqrt(varSum) };
    });
    return {
      bandwidth,
      points,
      explanation: {
        method: 'Kernel-smoothed hazard (Epanechnikov kernel on Nelson–Aalen increments)',
        formula: 'ĥ(t) = (1/b) Σ_j K((t − t_j)/b) · d_j / n_j',
        steps: [
          { label: 'Bandwidth b', value: String(bandwidth) },
          { label: 'Grid points', value: String(points.length) },
        ],
        assumptions: [INDEPENDENT_CENSORING, 'The underlying hazard is assumed smooth on the scale of the bandwidth.'],
        limitations: [
          'The smoothed hazard depends strongly on the bandwidth; a default chosen from the data is a convenience, not an optimum.',
          'The estimate is biased near the boundaries of the observed range, where the kernel is truncated.',
        ],
        exactness: 'empirical',
      },
    };
  });
}
