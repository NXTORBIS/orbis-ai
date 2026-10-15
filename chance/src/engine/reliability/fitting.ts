/**
 * Reliability data analysis: censored-data lifetime fitting, the Weibull
 * probability plot, reliability growth, and spare-parts provisioning.
 *
 * Right censoring is the norm in real reliability data — most units are still
 * running when the study ends — and ignoring it biases every estimate
 * downwards. Each observation therefore carries an explicit `failed` flag.
 */

import { EngineError, Validator, type Exactness } from '../core/result';
import { brentRoot, stableSum } from '../core/numeric';
import { logFactorial, normalQuantile } from '../special/gamma';
import { getDistribution } from '../distributions/registry';

export interface LifetimeObservation {
  /** Time on test: the failure time, or the censoring time if still running. */
  time: number;
  /** True for an observed failure, false for a right-censored (suspended) unit. */
  failed: boolean;
}

export type CensoringType = 'type-I' | 'type-II' | 'none' | 'mixed';

export interface CensoredSample {
  observations: LifetimeObservation[];
  failures: number;
  censored: number;
  totalTimeOnTest: number;
  censoringType: CensoringType;
}

export function prepareSample(observations: readonly LifetimeObservation[]): CensoredSample {
  const v = new Validator();
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new EngineError('No lifetime observations were supplied.', 'required');
  }
  observations.forEach((o, i) => {
    if (!o || typeof o.failed !== 'boolean') {
      v.add(`Observation ${i + 1} does not say whether it is a failure or a censored unit.`, `obs${i}`, 'required');
      return;
    }
    if (!Number.isFinite(o.time)) v.add(`Observation ${i + 1} has a non-finite time.`, `obs${i}`, 'finite');
    else if (o.time <= 0) {
      v.add(`Observation ${i + 1} has time ${o.time}; lifetimes must be strictly positive.`, `obs${i}`, 'range');
    }
  });
  v.throwIfInvalid();
  const failures = observations.filter((o) => o.failed).length;
  const censored = observations.length - failures;
  if (failures === 0) {
    throw new EngineError(
      `All ${observations.length} observations are right-censored: not one failure was observed. ` +
        'A lifetime distribution cannot be fitted from censoring times alone — the likelihood has no maximum. ' +
        'Report a lower confidence bound on the characteristic life instead, or keep testing.',
      'insufficient',
    );
  }
  const censoringTimes = new Set(observations.filter((o) => !o.failed).map((o) => o.time));
  const maxFailure = Math.max(...observations.filter((o) => o.failed).map((o) => o.time));
  let censoringType: CensoringType = 'none';
  if (censored > 0) {
    if (censoringTimes.size === 1) {
      const [ct] = [...censoringTimes];
      censoringType = ct >= maxFailure ? 'type-I' : 'mixed';
      // Type II (stop at the r-th failure) also leaves all suspensions at one
      // time, equal to the last failure time.
      if (ct === maxFailure) censoringType = 'type-II';
    } else {
      censoringType = 'mixed';
    }
  }
  return {
    observations: [...observations],
    failures,
    censored,
    totalTimeOnTest: stableSum(observations.map((o) => o.time)),
    censoringType,
  };
}

// ---------------------------------------------------------------------------
// Exponential MLE with right censoring
// ---------------------------------------------------------------------------

export interface ExponentialFit {
  rate: number;
  mttf: number;
  rateStandardError: number;
  /** Two-sided confidence interval for the rate, from the chi-square pivot. */
  rateInterval: { level: number; lower: number; upper: number };
  failures: number;
  censored: number;
  totalTimeOnTest: number;
  censoringType: CensoringType;
  exactness: Exactness;
  formula: string;
  notes: string[];
}

/**
 * λ̂ = d / T where d is the number of failures and T the total time on test
 * (failures plus censored running times). This is the exact MLE and is the
 * reason censoring must be recorded: dropping censored units removes their
 * time on test and inflates λ̂.
 */
export function fitExponentialCensored(
  observations: readonly LifetimeObservation[],
  level = 0.95,
): ExponentialFit {
  const sample = prepareSample(observations);
  const v = new Validator();
  v.range(level, 'level', 'Confidence level', 0.5, 0.999999);
  v.throwIfInvalid();
  const d = sample.failures;
  const T = sample.totalTimeOnTest;
  if (T <= 0) throw new EngineError('The total time on test is zero; nothing can be estimated.', 'insufficient');
  const rate = d / T;
  const se = rate / Math.sqrt(d);
  const chi = getDistribution('chiSquare');
  const alpha = 1 - level;
  const lower = chi.quantile(alpha / 2, { k: 2 * d }) / (2 * T);
  const upper = chi.quantile(1 - alpha / 2, { k: 2 * d + 2 }) / (2 * T);
  return {
    rate,
    mttf: 1 / rate,
    rateStandardError: se,
    rateInterval: { level, lower, upper },
    failures: d,
    censored: sample.censored,
    totalTimeOnTest: T,
    censoringType: sample.censoringType,
    exactness: 'exact',
    formula: 'λ̂ = d / Σtᵢ  (d failures, Σtᵢ over failures AND censored units)',
    notes: [
      'The standard error λ̂/√d is the asymptotic (Fisher information) value.',
      'The interval uses the exact chi-square pivot for time-terminated testing and is conservative.',
      sample.censored > 0
        ? `${sample.censored} of ${observations.length} units are right-censored; their time on test is included.`
        : 'No censored units: this is a complete sample.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Weibull MLE with right censoring
// ---------------------------------------------------------------------------

export interface WeibullFit {
  /** Shape β. */
  shape: number;
  /** Scale (characteristic life) η. */
  scale: number;
  shapeStandardError: number;
  scaleStandardError: number;
  mttf: number;
  failures: number;
  censored: number;
  censoringType: CensoringType;
  logLikelihood: number;
  iterations: number;
  exactness: Exactness;
  formula: string;
  notes: string[];
}

function weibullLogLikelihood(
  observations: readonly LifetimeObservation[],
  beta: number,
  eta: number,
): number {
  let ll = 0;
  for (const o of observations) {
    const z = Math.pow(o.time / eta, beta);
    if (o.failed) ll += Math.log(beta / eta) + (beta - 1) * Math.log(o.time / eta) - z;
    else ll -= z;
  }
  return ll;
}

/**
 * Weibull MLE for right-censored data. The scale is profiled out:
 *     η(β) = (Σ_all tᵢ^β / d)^{1/β}
 * leaving one equation in β:
 *     g(β) = Σ_all tᵢ^β ln tᵢ / Σ_all tᵢ^β − 1/β − (1/d) Σ_failures ln tᵢ = 0.
 * Solved with Brent's method on a bracket found by expansion; if no bracket
 * can be found the fit is refused rather than reported.
 */
export function fitWeibullCensored(observations: readonly LifetimeObservation[]): WeibullFit {
  const sample = prepareSample(observations);
  const obs = sample.observations;
  const d = sample.failures;
  const failureLogs = obs.filter((o) => o.failed).map((o) => Math.log(o.time));
  const meanFailureLog = stableSum(failureLogs) / d;
  const distinctFailureTimes = new Set(obs.filter((o) => o.failed).map((o) => o.time)).size;
  if (d < 2 || distinctFailureTimes < 2) {
    throw new EngineError(
      `A Weibull fit needs at least two distinct failure times; this sample has ${distinctFailureTimes} ` +
        `(from ${d} failure${d === 1 ? '' : 's'}). The shape parameter is not identifiable. ` +
        'Fit an exponential (fixed shape 1) instead, or collect more failures.',
      'insufficient',
    );
  }

  const g = (beta: number): number => {
    const w = obs.map((o) => Math.pow(o.time, beta));
    const sw = stableSum(w);
    const swl = stableSum(obs.map((o, i) => w[i] * Math.log(o.time)));
    return swl / sw - 1 / beta - meanFailureLog;
  };

  let lo = 0.05;
  let hi = 0.05;
  let glo = g(lo);
  let found = false;
  for (let i = 0; i < 60; i += 1) {
    hi *= 1.6;
    const ghi = g(hi);
    if (Number.isFinite(glo) && Number.isFinite(ghi) && glo * ghi <= 0) {
      found = true;
      break;
    }
    lo = hi;
    glo = ghi;
    if (hi > 1e4) break;
  }
  if (!found) {
    throw new EngineError(
      'The Weibull shape likelihood equation could not be bracketed between β = 0.05 and β = 10000, ' +
        'so the maximum-likelihood fit did not converge. No estimate is returned. ' +
        'Check for duplicated or near-identical failure times, or too few failures.',
      'numerical',
    );
  }
  const shape = brentRoot(g, lo, hi, { tol: 1e-12, maxIter: 400 });
  if (!Number.isFinite(shape) || shape <= 0) {
    throw new EngineError('The Weibull shape estimate is not a finite positive number; the fit failed.', 'numerical');
  }
  const scale = Math.pow(stableSum(obs.map((o) => Math.pow(o.time, shape))) / d, 1 / shape);
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new EngineError('The Weibull scale estimate is not a finite positive number; the fit failed.', 'numerical');
  }

  // Observed Fisher information by central differences of the log-likelihood.
  const hb = Math.max(shape * 1e-4, 1e-7);
  const he = Math.max(scale * 1e-4, 1e-7);
  const ll = (b: number, e: number): number => weibullLogLikelihood(obs, b, e);
  const l0 = ll(shape, scale);
  const lbb = (ll(shape + hb, scale) - 2 * l0 + ll(shape - hb, scale)) / (hb * hb);
  const lee = (ll(shape, scale + he) - 2 * l0 + ll(shape, scale - he)) / (he * he);
  const lbe =
    (ll(shape + hb, scale + he) - ll(shape + hb, scale - he) - ll(shape - hb, scale + he) + ll(shape - hb, scale - he)) /
    (4 * hb * he);
  // Information matrix is −Hessian; invert the 2×2.
  const i11 = -lbb;
  const i22 = -lee;
  const i12 = -lbe;
  const det = i11 * i22 - i12 * i12;
  if (!Number.isFinite(det) || det <= 0) {
    throw new EngineError(
      'The observed information matrix at the Weibull MLE is not positive definite, so standard errors ' +
        'cannot be computed. The fit is not trustworthy and no standard errors are invented.',
      'numerical',
    );
  }
  const varShape = i22 / det;
  const varScale = i11 / det;
  if (varShape <= 0 || varScale <= 0) {
    throw new EngineError('Negative variance from the information matrix; the Weibull fit failed.', 'numerical');
  }
  const weibull = getDistribution('weibull');
  const mean = weibull.mean({ k: shape, lambda: scale });
  if (!mean.defined) throw new EngineError(`MTTF undefined for the fitted Weibull: ${mean.reason}`, 'undefined');

  return {
    shape,
    scale,
    shapeStandardError: Math.sqrt(varShape),
    scaleStandardError: Math.sqrt(varScale),
    mttf: mean.value,
    failures: d,
    censored: sample.censored,
    censoringType: sample.censoringType,
    logLikelihood: l0,
    iterations: 1,
    exactness: 'numerical',
    formula: 'Profile MLE: η(β) = (Σtᵢ^β/d)^{1/β}; β solves Σtᵢ^β ln tᵢ / Σtᵢ^β − 1/β − (1/d)Σ_fail ln tᵢ = 0',
    notes: [
      'Censored units contribute their survival only (−(t/η)^β), not a density term.',
      'Standard errors come from the observed information matrix evaluated by central differences; ' +
        'they are asymptotic and understate the uncertainty for small failure counts.',
      `${sample.censored} of ${obs.length} units are right-censored (${sample.censoringType} censoring).`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Weibull probability plot (median-rank regression)
// ---------------------------------------------------------------------------

export interface WeibullPlotPoint {
  time: number;
  /** Adjusted rank (Johnson/Leonard), equal to the plain rank with no censoring. */
  adjustedRank: number;
  /** Bernard's median-rank estimate of F(t). */
  medianRank: number;
  x: number;
  y: number;
}

export interface WeibullPlotResult {
  points: WeibullPlotPoint[];
  /** Shape from the regression slope. */
  shape: number;
  /** Scale from the regression intercept. */
  scale: number;
  /** r² of the straight-line fit; a poor value means the Weibull is wrong. */
  rSquared: number;
  exactness: Exactness;
  formula: string;
  notes: string[];
}

/**
 * Median-rank regression on a Weibull probability plot. Censored units are
 * handled by Johnson's rank adjustment, which advances the rank increment past
 * each suspension instead of discarding it.
 */
export function weibullProbabilityPlot(observations: readonly LifetimeObservation[]): WeibullPlotResult {
  const sample = prepareSample(observations);
  const sorted = [...sample.observations].sort((a, b) => a.time - b.time || Number(a.failed) - Number(b.failed));
  const n = sorted.length;
  const points: WeibullPlotPoint[] = [];
  let previousRank = 0;
  for (let i = 0; i < n; i += 1) {
    if (!sorted[i].failed) continue;
    const reverseRank = n - i; // units at risk, counting this one
    const increment = (n + 1 - previousRank) / (1 + reverseRank);
    const adjustedRank = previousRank + increment;
    previousRank = adjustedRank;
    const medianRank = (adjustedRank - 0.3) / (n + 0.4); // Bernard's approximation
    if (medianRank <= 0 || medianRank >= 1) {
      throw new EngineError(
        `A median rank of ${medianRank} fell outside (0, 1); the plotting positions are invalid.`,
        'numerical',
      );
    }
    points.push({
      time: sorted[i].time,
      adjustedRank,
      medianRank,
      x: Math.log(sorted[i].time),
      y: Math.log(-Math.log(1 - medianRank)),
    });
  }
  if (points.length < 2) {
    throw new EngineError(
      `A Weibull probability plot needs at least two failures; this sample has ${points.length}.`,
      'insufficient',
    );
  }
  const m = points.length;
  const mx = stableSum(points.map((p) => p.x)) / m;
  const my = stableSum(points.map((p) => p.y)) / m;
  const sxx = stableSum(points.map((p) => (p.x - mx) ** 2));
  const sxy = stableSum(points.map((p) => (p.x - mx) * (p.y - my)));
  const syy = stableSum(points.map((p) => (p.y - my) ** 2));
  if (sxx <= 0) {
    throw new EngineError(
      'All failures occurred at the same time, so the probability plot has no slope and no Weibull fit exists.',
      'insufficient',
    );
  }
  const slope = sxy / sxx;
  if (!Number.isFinite(slope) || slope <= 0) {
    throw new EngineError(
      `The probability-plot slope is ${slope}, which is not a valid Weibull shape. The data do not follow a Weibull law.`,
      'numerical',
    );
  }
  const intercept = my - slope * mx;
  return {
    points,
    shape: slope,
    scale: Math.exp(-intercept / slope),
    rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1,
    exactness: 'numerical',
    formula: 'ln(−ln(1−F)) = β·ln t − β·ln η; median ranks by Bernard, censoring by Johnson rank adjustment',
    notes: [
      'Median-rank regression is a graphical estimator: it weights the plotted failures equally and is not ' +
        'the maximum-likelihood fit. Compare it with the MLE — a large gap signals an ill-fitting model or ' +
        'influential early failures.',
      `${sample.censored} censored units were handled by rank adjustment, not discarded.`,
    ],
  };
}

// ---------------------------------------------------------------------------
// Reliability growth: Duane and Crow–AMSAA
// ---------------------------------------------------------------------------

export interface GrowthResult {
  /** Crow–AMSAA shape β̂ (growth when β < 1). */
  shape: number;
  /** Crow–AMSAA scale λ̂, with E[N(t)] = λ t^β. */
  scale: number;
  /** Duane growth rate α = 1 − β. */
  growthRate: number;
  /** Cumulative MTBF at the end of the test. */
  cumulativeMtbf: number;
  /** Instantaneous (current) MTBF at the end of the test. */
  instantaneousMtbf: number;
  /** Duane log–log regression estimates for comparison. */
  duaneRegression: { slope: number; intercept: number; rSquared: number };
  failures: number;
  testTime: number;
  exactness: Exactness;
  formula: string;
  notes: string[];
}

/**
 * Crow–AMSAA (NHPP power law) reliability growth from successive failure
 * times, plus the classic Duane log–log regression on cumulative MTBF.
 * Time-terminated test at `testTime`.
 */
export function reliabilityGrowth(failureTimes: readonly number[], testTime?: number): GrowthResult {
  const v = new Validator();
  if (!Array.isArray(failureTimes) || failureTimes.length < 2) {
    v.add('Reliability growth needs at least two cumulative failure times.', 'failureTimes', 'insufficient');
  }
  (failureTimes ?? []).forEach((t, i) => {
    if (!Number.isFinite(t)) v.add(`Failure time ${i + 1} is not finite.`, `t${i}`, 'finite');
    else if (t <= 0) v.add(`Failure time ${i + 1} is ${t}; cumulative times must be positive.`, `t${i}`, 'range');
  });
  v.throwIfInvalid();
  const times = [...failureTimes].sort((a, b) => a - b);
  const n = times.length;
  const T = testTime ?? times[n - 1];
  if (!Number.isFinite(T) || T < times[n - 1]) {
    throw new EngineError(
      `The test time ${T} is earlier than the last failure at ${times[n - 1]}; the data are inconsistent.`,
      'range',
    );
  }
  const terminatedByFailure = T === times[n - 1];
  // Failure-terminated (type II) uses n − 1 in the numerator; time-terminated uses n.
  const denom = stableSum(times.map((t) => Math.log(T / t)));
  if (denom <= 0) {
    throw new EngineError(
      'All failures occurred at the test end time, so the Crow–AMSAA shape is not estimable.',
      'insufficient',
    );
  }
  const shape = (terminatedByFailure ? n - 1 : n) / denom;
  if (!Number.isFinite(shape) || shape <= 0) {
    throw new EngineError('The Crow–AMSAA shape estimate is not a finite positive number.', 'numerical');
  }
  const scale = n / Math.pow(T, shape);
  const instantaneousRate = scale * shape * Math.pow(T, shape - 1);
  if (instantaneousRate <= 0) {
    throw new EngineError('The fitted instantaneous failure rate is not positive; the growth fit failed.', 'numerical');
  }

  // Duane: regress ln(cumulative MTBF) on ln(cumulative time).
  const xs = times.map((t) => Math.log(t));
  const ys = times.map((t, i) => Math.log(t / (i + 1)));
  const mx = stableSum(xs) / n;
  const my = stableSum(ys) / n;
  const sxx = stableSum(xs.map((x) => (x - mx) ** 2));
  const sxy = stableSum(xs.map((x, i) => (x - mx) * (ys[i] - my)));
  const syy = stableSum(ys.map((y) => (y - my) ** 2));
  if (sxx <= 0) {
    throw new EngineError('All cumulative failure times are equal; the Duane regression has no slope.', 'insufficient');
  }
  const slope = sxy / sxx;

  return {
    shape,
    scale,
    growthRate: 1 - shape,
    cumulativeMtbf: T / n,
    instantaneousMtbf: 1 / instantaneousRate,
    duaneRegression: {
      slope,
      intercept: my - slope * mx,
      rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1,
    },
    failures: n,
    testTime: T,
    exactness: 'numerical',
    formula: 'Crow–AMSAA: E[N(t)] = λ t^β, β̂ = n / Σ ln(T/tᵢ); instantaneous MTBF = 1/(λβT^{β−1})',
    notes: [
      shape < 1
        ? `β̂ = ${shape.toPrecision(4)} < 1: the failure intensity is falling, so reliability is growing. ` +
          `The Duane growth rate is α = ${(1 - shape).toPrecision(4)}.`
        : shape === 1
          ? 'β̂ = 1: no growth — failures arrive at a constant rate (homogeneous Poisson process).'
          : `β̂ = ${shape.toPrecision(4)} > 1: the failure intensity is RISING. Reliability is getting worse, not better.`,
      terminatedByFailure
        ? 'Treated as failure-terminated (type II): the last failure ends the test.'
        : 'Treated as time-terminated (type I) at the given test time.',
      'Cumulative MTBF is a backward-looking average; instantaneous MTBF describes the system as it is now. ' +
        'Quote the instantaneous value when claiming current reliability.',
      'The Duane regression is reported for comparison only; the Crow–AMSAA MLE is the estimator to use.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Spare-parts provisioning
// ---------------------------------------------------------------------------

export interface SparesResult {
  spares: number;
  /** Expected demand over the period: n·λ·T (Poisson mean). */
  expectedDemand: number;
  /** Achieved P(demand ≤ spares) — at least the requested confidence. */
  achievedConfidence: number;
  requestedConfidence: number;
  /** Confidence that would be achieved with one spare fewer. */
  confidenceWithOneFewer: number;
  exactness: Exactness;
  formula: string;
  assumptions: string[];
}

/**
 * Smallest number of spares s with P(N ≤ s) ≥ confidence, where the number of
 * replacements N over the period is Poisson with mean units·rate·period.
 */
export function sparesRequired(input: {
  units: number;
  failureRate: number;
  period: number;
  confidence: number;
}): SparesResult {
  const v = new Validator();
  v.integer(input.units, 'units', 'Number of installed units', 1, 1e9);
  v.positive(input.failureRate, 'failureRate', 'Failure rate per unit per unit time');
  v.positive(input.period, 'period', 'Provisioning period');
  v.range(input.confidence, 'confidence', 'Target confidence', 0.5, 1 - 1e-12);
  v.throwIfInvalid();
  const mean = input.units * input.failureRate * input.period;
  if (!Number.isFinite(mean) || mean <= 0) {
    throw new EngineError('The expected spares demand is not a finite positive number.', 'numerical');
  }
  // P(N ≤ s) accumulated from exact Poisson terms.
  let cumulative = 0;
  let previous = 0;
  let spares = -1;
  for (let k = 0; k <= 10_000_000; k += 1) {
    const term = Math.exp(k * Math.log(mean) - mean - logFactorial(k));
    previous = cumulative;
    cumulative += term;
    if (cumulative >= input.confidence) {
      spares = k;
      break;
    }
    if (k === 10_000_000) break;
  }
  if (spares < 0) {
    throw new EngineError(
      `Could not reach confidence ${input.confidence} within 10,000,000 spares for an expected demand of ${mean}. ` +
        'No number is returned in its place.',
      'numerical',
    );
  }
  return {
    spares,
    expectedDemand: mean,
    achievedConfidence: Math.min(cumulative, 1),
    requestedConfidence: input.confidence,
    confidenceWithOneFewer: spares === 0 ? 0 : previous,
    exactness: 'exact',
    formula: 's = min{ s : Σ_{k≤s} e^{−m} m^k/k! ≥ C },  m = units · λ · period',
    assumptions: [
      'Failures arrive as a Poisson process at a constant rate, independently across units.',
      'Each failure consumes exactly one spare and a replacement is available instantly if in stock.',
      'No repair/return pipeline: spares are not replenished during the period.',
      'A constant failure rate is a strong assumption — with Weibull wear-out (β > 1) the demand clusters ' +
        'and more spares are needed late in life.',
    ],
  };
}

/** Normal-approximation spares count, exposed only to contrast with the exact Poisson answer. */
export function sparesNormalApproximation(mean: number, confidence: number): number {
  if (!Number.isFinite(mean) || mean <= 0) throw new EngineError('The expected demand must be positive.', 'range');
  if (!(confidence > 0 && confidence < 1)) throw new EngineError('Confidence must be in (0, 1).', 'range');
  return Math.ceil(mean + normalQuantile(confidence) * Math.sqrt(mean));
}
