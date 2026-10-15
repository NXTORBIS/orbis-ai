/**
 * Forecast scoring, calibration and sharpness.
 *
 * The organising principle: the goal is MAXIMUM SHARPNESS SUBJECT TO
 * CALIBRATION. A forecast that always says "50%" is perfectly calibrated and
 * useless; a forecast that always says "99%" may be sharp and badly wrong.
 * Conflating the two is the classic error, so calibration (reliability, ECE,
 * MCE, PIT) and sharpness (the spread of the forecasts, the width of the
 * predictive distributions) are reported as separate quantities and never
 * combined into one headline number.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { normalCdf, normalPdf } from '../special/gamma';
import { wilsonInterval, type Interval } from '../stats/descriptive';
import { BASE_LABEL, fromNats, resolveBase, type BaseOptions, type LogBase } from './types';

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

function validateForecasts(forecasts: ArrayLike<number>, outcomes: ArrayLike<number>): { p: number[]; o: number[] } {
  if (forecasts.length !== outcomes.length) {
    throw new EngineError(
      `There are ${forecasts.length} forecast(s) but ${outcomes.length} outcome(s); every forecast needs exactly one outcome.`,
      'shape',
    );
  }
  const n = forecasts.length;
  if (n === 0) throw new EngineError('There are no forecasts to score.', 'empty');
  const p = new Array<number>(n);
  const o = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const f = forecasts[i];
    if (!Number.isFinite(f) || f < 0 || f > 1) {
      throw new EngineError(`Forecast ${i} = ${String(f)} is not a probability in [0, 1].`, 'range');
    }
    const y = outcomes[i];
    if (y !== 0 && y !== 1) {
      throw new EngineError(`Outcome ${i} = ${String(y)} must be 0 (did not happen) or 1 (happened).`, 'range');
    }
    p[i] = f;
    o[i] = y;
  }
  return { p, o };
}

/* ------------------------------------------------------------------ */
/* Brier score and the Murphy decomposition                           */
/* ------------------------------------------------------------------ */

export interface MurphyBin {
  /** Bin label — the distinct forecast value, or the bin range. */
  label: string;
  count: number;
  /** Mean forecast in the bin. */
  meanForecast: number;
  /** Observed frequency in the bin. */
  observedFrequency: number;
}

export interface BrierResult {
  /** Mean squared error of the probabilities, in [0, 1]. Lower is better. */
  brierScore: number;
  n: number;
  /** Base rate of the event. */
  baseRate: number;
  /** Reliability (calibration): weighted mean squared gap between forecast and observed frequency. 0 is perfect. */
  reliability: number;
  /** Resolution: how far the conditional frequencies move away from the base rate. Larger is better. */
  resolution: number;
  /** Uncertainty: ō(1−ō), the Brier score of the climatological forecast. Not under the forecaster's control. */
  uncertainty: number;
  /**
   * Within-bin contribution: the spread of the forecasts inside each bin and
   * its covariance with the outcomes. Exactly 0 when binning by distinct
   * value, which is why the three-term identity is exact there.
   */
  withinBinTerm: number;
  /** reliability − resolution + uncertainty + withinBinTerm. */
  decompositionTotal: number;
  /** |decompositionTotal − brierScore|. Zero (to rounding) when the decomposition is exact. */
  decompositionResidual: number;
  decompositionExact: boolean;
  bins: MurphyBin[];
  binning: 'distinct-values' | 'fixed-bins';
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Brier score with the Murphy (1973) three-term decomposition
 *   BS = reliability − resolution + uncertainty.
 *
 * The identity is EXACT when the forecasts are grouped by their distinct
 * values, which is the default here. With fixed-width bins the grouping loses
 * the within-bin spread, so a fourth term (the within-bin variance of the
 * forecasts) is reported and the identity closes with it; the residual is
 * always shown either way, because an unchecked decomposition is worthless.
 */
export function brierScore(
  forecasts: ArrayLike<number>,
  outcomes: ArrayLike<number>,
  options: { bins?: number } = {},
): BrierResult {
  const { p, o } = validateForecasts(forecasts, outcomes);
  const n = p.length;
  const bs = stableSum(p.map((v, i) => (v - o[i]) ** 2)) / n;
  const baseRate = stableSum(o) / n;

  const useFixed = options.bins !== undefined;
  if (useFixed) {
    const b = options.bins as number;
    if (!Number.isInteger(b) || b < 1) throw new EngineError(`bins must be a positive whole number; got ${b}.`, 'integer');
  }
  type Group = { key: string; idx: number[] };
  const groups = new Map<string, Group>();
  for (let i = 0; i < n; i++) {
    const key = useFixed
      ? String(Math.min((options.bins as number) - 1, Math.floor(p[i] * (options.bins as number))))
      : p[i].toPrecision(17);
    const g = groups.get(key);
    if (g) g.idx.push(i);
    else groups.set(key, { key, idx: [i] });
  }
  const bins: MurphyBin[] = [];
  const relTerms: number[] = [];
  const resTerms: number[] = [];
  const withinTerms: number[] = [];
  for (const g of groups.values()) {
    const nk = g.idx.length;
    const pbar = stableSum(g.idx.map((i) => p[i])) / nk;
    const obar = stableSum(g.idx.map((i) => o[i])) / nk;
    relTerms.push((nk / n) * (pbar - obar) ** 2);
    resTerms.push((nk / n) * (obar - baseRate) ** 2);
    // The exact closing term: Σ[(pᵢ−oᵢ)² − (p̄_k−oᵢ)²]/n. It vanishes when
    // every forecast in the bin equals p̄_k, i.e. when bins are distinct values.
    withinTerms.push(stableSum(g.idx.map((i) => (p[i] - o[i]) ** 2 - (pbar - o[i]) ** 2)) / n);
    bins.push({
      label: useFixed
        ? `[${(Number(g.key) / (options.bins as number)).toFixed(3)}, ${((Number(g.key) + 1) / (options.bins as number)).toFixed(3)})`
        : pbar.toPrecision(6),
      count: nk,
      meanForecast: pbar,
      observedFrequency: obar,
    });
  }
  bins.sort((a, b) => a.meanForecast - b.meanForecast);
  const reliability = stableSum(relTerms);
  const resolution = stableSum(resTerms);
  const uncertainty = baseRate * (1 - baseRate);
  const within = stableSum(withinTerms);
  const total = reliability - resolution + uncertainty + within;
  const residual = Math.abs(total - bs);
  return {
    brierScore: bs,
    n,
    baseRate,
    reliability,
    resolution,
    uncertainty,
    withinBinTerm: within,
    decompositionTotal: total,
    decompositionResidual: residual,
    // 1e-12 is far above double rounding on sums of n ≤ 10⁶ terms in [0,1]
    // and far below any real decomposition error.
    decompositionExact: residual <= 1e-12,
    bins,
    binning: useFixed ? 'fixed-bins' : 'distinct-values',
    exactness: 'exact',
    explanation: {
      method: 'Brier score with the Murphy decomposition',
      formula: 'BS = reliability − resolution + uncertainty (+ a within-bin term when binning is coarse)',
      steps: [
        { label: 'Brier score', value: bs.toPrecision(12) },
        { label: 'Reliability (calibration; 0 is perfect)', value: reliability.toPrecision(12) },
        { label: 'Resolution (discrimination; larger is better)', value: resolution.toPrecision(12) },
        { label: 'Uncertainty (climatology; not controllable)', value: uncertainty.toPrecision(12) },
        { label: 'Within-bin contribution', value: within.toPrecision(12) },
        { label: 'Decomposition residual', value: residual.toExponential(3) },
      ],
      assumptions: ['Each outcome is a binary event and each forecast is the stated probability that it happens.'],
      limitations: [
        'Reliability and resolution are estimated from a finite sample: with few forecasts per bin both are noisy, and reliability is biased upward (a perfectly calibrated forecaster shows non-zero reliability by chance).',
        'A low Brier score can come from an easy problem (small uncertainty) rather than a good forecaster — compare against a baseline with a skill score.',
        'The Brier score is strictly proper: it is minimised in expectation by reporting the true probability.',
      ],
      exactness: 'exact',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Logarithmic, spherical and ranked scores                           */
/* ------------------------------------------------------------------ */

export interface LogScoreResult {
  /** Mean negative log score (lower is better), in the requested unit. Infinite when a confident forecast was wrong. */
  value: number;
  base: LogBase;
  baseLabel: string;
  finite: boolean;
  /** Indices where the forecast assigned probability 0 to what happened. */
  offendingIndices: number[];
  /** Set when clipping was explicitly requested, giving the clip used and its effect. */
  clip?: { epsilon: number; clippedCount: number; valueWithClip: number; effect: string };
  n: number;
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Logarithmic score (negative log-likelihood per forecast).
 *
 * A probability of 0 for something that happened gives an infinite score. That
 * is the correct answer and it is reported as such. Clipping is available but
 * only on explicit request, and the clip and its effect on the number are
 * always reported — a silently clipped log score is a fabricated number.
 */
export function logScore(
  forecasts: ArrayLike<number>,
  outcomes: ArrayLike<number>,
  options: BaseOptions & { clipEpsilon?: number } = {},
): LogScoreResult {
  const base = resolveBase(options);
  const { p, o } = validateForecasts(forecasts, outcomes);
  const n = p.length;
  const offending: number[] = [];
  const terms: number[] = [];
  for (let i = 0; i < n; i++) {
    const q = o[i] === 1 ? p[i] : 1 - p[i];
    if (q <= 0) {
      offending.push(i);
      continue;
    }
    terms.push(-Math.log(q));
  }
  const finite = offending.length === 0;
  const nats = finite ? stableSum(terms) / n : Infinity;
  let clip: LogScoreResult['clip'];
  if (options.clipEpsilon !== undefined) {
    const eps = options.clipEpsilon;
    if (!(eps > 0 && eps < 0.5)) throw new EngineError(`clipEpsilon must lie in (0, 0.5); got ${eps}.`, 'range');
    let clipped = 0;
    const cterms = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const raw = o[i] === 1 ? p[i] : 1 - p[i];
      const q = Math.min(1 - eps, Math.max(eps, raw));
      if (q !== raw) clipped += 1;
      cterms[i] = -Math.log(q);
    }
    const withClip = fromNats(stableSum(cterms) / n, base);
    clip = {
      epsilon: eps,
      clippedCount: clipped,
      valueWithClip: withClip,
      effect:
        `${clipped} of ${n} forecast probabilities were moved to the nearest end of [${eps}, ${1 - eps}] before scoring. ` +
        `The clipped mean log score is ${withClip.toPrecision(8)} ${base}; the largest single penalty any forecast can receive ` +
        `is capped at ${fromNats(-Math.log(eps), base).toPrecision(6)} ${base}. This is a modelling choice, not the log score.`,
    };
  }
  return {
    value: finite ? fromNats(nats, base) : Infinity,
    base,
    baseLabel: BASE_LABEL[base],
    finite,
    offendingIndices: offending,
    clip,
    n,
    exactness: 'exact',
    explanation: {
      method: 'Logarithmic score',
      formula: 'S = −(1/n) Σ log[ oᵢ pᵢ + (1−oᵢ)(1−pᵢ) ]',
      steps: [
        { label: 'Mean log score', value: finite ? `${fromNats(nats, base).toPrecision(10)} ${base}` : 'infinite' },
        ...(offending.length ? [{ label: 'Forecasts that ruled out what happened', value: offending.join(', ') }] : []),
        ...(clip ? [{ label: 'Clipped score', value: clip.effect }] : []),
      ],
      assumptions: ['Each outcome is binary and each forecast is the stated probability of the event.'],
      limitations: [
        'The log score is INFINITE when a forecast of 0 (or 1) turns out wrong. That is not a defect — it is the price of claiming certainty — and it is reported rather than hidden.',
        'Clipping bounds the penalty but changes the score, and the clipped value is no longer a strictly proper score of the stated probabilities. Any clip applied is reported above with its size and effect.',
        'The log score is strictly proper and is the only proper score that is local (it depends only on the probability given to what actually happened).',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'exact',
    },
  };
}

function validateCategorical(forecasts: readonly ArrayLike<number>[], outcomes: ArrayLike<number>): { p: number[][]; y: number[] } {
  if (forecasts.length !== outcomes.length) {
    throw new EngineError(`There are ${forecasts.length} forecast vector(s) but ${outcomes.length} outcome(s).`, 'shape');
  }
  if (forecasts.length === 0) throw new EngineError('There are no forecasts to score.', 'empty');
  const k = forecasts[0].length;
  if (k < 2) throw new EngineError('A categorical forecast needs at least 2 categories.', 'shape');
  const p: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < forecasts.length; i++) {
    if (forecasts[i].length !== k) {
      throw new EngineError(`Forecast ${i} has ${forecasts[i].length} categories but forecast 0 has ${k}.`, 'shape');
    }
    const row = new Array<number>(k);
    let s = 0;
    for (let j = 0; j < k; j++) {
      const v = forecasts[i][j];
      if (!Number.isFinite(v) || v < 0) throw new EngineError(`Forecast ${i} category ${j} = ${String(v)} is not a valid probability.`, 'range');
      row[j] = v;
      s += v;
    }
    if (Math.abs(s - 1) > 1e-9) {
      throw new EngineError(`Forecast ${i} is not normalised: its categories sum to ${s.toPrecision(12)}, not 1.`, 'sum');
    }
    const o = outcomes[i];
    if (!Number.isInteger(o) || o < 0 || o >= k) {
      throw new EngineError(`Outcome ${i} = ${String(o)} must be a category index in 0…${k - 1}.`, 'range');
    }
    p.push(row);
    y.push(o);
  }
  return { p, y };
}

/**
 * Spherical score, a strictly proper rule: S = p_y / ‖p‖₂. Reported as a
 * reward (larger is better) and as the loss 1 − S for comparison with the
 * Brier and log scores, which are losses.
 */
export function sphericalScore(
  forecasts: readonly ArrayLike<number>[],
  outcomes: ArrayLike<number>,
): { reward: number; loss: number; n: number; exactness: 'exact'; explanation: Explanation } {
  const { p, y } = validateCategorical(forecasts, outcomes);
  const n = p.length;
  const terms = p.map((row, i) => {
    const norm = Math.sqrt(stableSum(row.map((v) => v * v)));
    if (!(norm > 0)) throw new EngineError(`Forecast ${i} has zero norm, which cannot happen for a normalised distribution.`, 'numerical');
    return row[y[i]] / norm;
  });
  const reward = stableSum(terms) / n;
  return {
    reward,
    loss: 1 - reward,
    n,
    exactness: 'exact',
    explanation: {
      method: 'Spherical score',
      formula: 'S(p, y) = p_y / √(Σ pⱼ²), averaged over forecasts',
      steps: [
        { label: 'Mean spherical reward (1 is perfect)', value: reward.toPrecision(10) },
        { label: 'As a loss', value: (1 - reward).toPrecision(10) },
      ],
      assumptions: ['Each forecast is a normalised distribution over the same category set.'],
      limitations: [
        'The spherical score is strictly proper but not local: it depends on the whole forecast vector, not only on the probability given to what happened.',
        'It is bounded, so unlike the log score it never diverges for a confidently wrong forecast — which also means it penalises overconfidence less harshly.',
      ],
      exactness: 'exact',
    },
  };
}

/**
 * Ranked probability score for ORDERED categories: the mean squared distance
 * between the forecast cumulative distribution and the observed step function,
 * normalised by K − 1 so it lies in [0, 1].
 */
export function rankedProbabilityScore(
  forecasts: readonly ArrayLike<number>[],
  outcomes: ArrayLike<number>,
): { value: number; n: number; categories: number; exactness: 'exact'; explanation: Explanation } {
  const { p, y } = validateCategorical(forecasts, outcomes);
  const k = p[0].length;
  const n = p.length;
  const per = p.map((row, i) => {
    let cp = 0;
    const parts: number[] = [];
    for (let j = 0; j < k - 1; j++) {
      cp += row[j];
      const co = j >= y[i] ? 1 : 0;
      parts.push((cp - co) ** 2);
    }
    return stableSum(parts) / (k - 1);
  });
  const value = stableSum(per) / n;
  return {
    value,
    n,
    categories: k,
    exactness: 'exact',
    explanation: {
      method: 'Ranked probability score (ordered categories)',
      formula: 'RPS = (1/(K−1)) Σ_{j<K} [F_p(j) − F_o(j)]², averaged over forecasts',
      steps: [
        { label: 'Categories', value: String(k) },
        { label: 'RPS (0 is perfect)', value: value.toPrecision(10) },
      ],
      assumptions: ['The categories are ORDERED, and the given order is the meaningful one — the score changes if they are permuted.'],
      limitations: [
        'RPS is only meaningful for ordered categories. Applying it to unordered ones produces a number with no interpretation; use the Brier or log score there.',
        'It rewards getting close: being one category out is penalised less than being far out, which is the point, but it also means it is not a pure probability score.',
      ],
      exactness: 'exact',
    },
  };
}

/* ------------------------------------------------------------------ */
/* CRPS                                                               */
/* ------------------------------------------------------------------ */

export interface CrpsResult {
  value: number;
  exactness: 'exact' | 'numerical' | 'empirical';
  method: string;
  explanation: Explanation;
}

/**
 * CRPS of a normal predictive distribution, in closed form:
 *   CRPS(N(μ,σ), y) = σ[ z(2Φ(z) − 1) + 2φ(z) − 1/√π ],  z = (y−μ)/σ.
 *
 * As σ → 0 this tends to |y − μ|, i.e. a point forecast is scored by its
 * absolute error — the property that makes CRPS the natural generalisation of
 * the absolute error to distributional forecasts.
 */
export function crpsNormal(mu: number, sigma: number, y: number): CrpsResult {
  if (!Number.isFinite(mu) || !Number.isFinite(y)) throw new EngineError('The predictive mean and the observation must be finite.', 'finite');
  if (!Number.isFinite(sigma) || sigma < 0) throw new EngineError(`The predictive standard deviation must be finite and ≥ 0; got ${String(sigma)}.`, 'range');
  if (sigma === 0) {
    return {
      value: Math.abs(y - mu),
      exactness: 'exact',
      method: 'Degenerate (point) forecast: CRPS reduces exactly to the absolute error |y − μ|.',
      explanation: {
        method: 'CRPS of a point forecast',
        formula: 'CRPS = |y − μ|',
        steps: [{ label: 'CRPS', value: Math.abs(y - mu).toPrecision(10) }],
        assumptions: ['The forecast claims certainty, so its CDF is a step at μ.'],
        limitations: ['A point forecast expresses no uncertainty; CRPS cannot reward or penalise calibration here, only accuracy.'],
        exactness: 'exact',
      },
    };
  }
  const z = (y - mu) / sigma;
  const value = sigma * (z * (2 * normalCdf(z) - 1) + 2 * normalPdf(z) - 1 / Math.sqrt(Math.PI));
  return {
    value,
    exactness: 'exact',
    method: 'Closed form for a normal predictive distribution.',
    explanation: {
      method: 'CRPS, normal predictive distribution',
      formula: 'CRPS = σ[ z(2Φ(z) − 1) + 2φ(z) − 1/√π ],  z = (y − μ)/σ',
      steps: [
        { label: 'z', value: z.toPrecision(10) },
        { label: 'CRPS (lower is better, units of y)', value: value.toPrecision(10) },
      ],
      assumptions: ['The predictive distribution is exactly normal.'],
      limitations: [
        'CRPS has the UNITS OF THE OBSERVATION, so it cannot be compared across variables measured differently.',
        'CRPS is proper but less sensitive to the tails than the log score: a badly calibrated tail costs relatively little.',
      ],
      exactness: 'exact',
    },
  };
}

/** CRPS from an ensemble / sample of the predictive distribution (the exact formula for the empirical CDF). */
export function crpsEnsemble(members: ArrayLike<number>, y: number): CrpsResult {
  const m = members.length;
  if (m === 0) throw new EngineError('An ensemble CRPS needs at least one member.', 'empty');
  if (!Number.isFinite(y)) throw new EngineError('The observation must be finite.', 'finite');
  const x = new Array<number>(m);
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(members[i])) throw new EngineError(`Ensemble member ${i} is not finite.`, 'finite');
    x[i] = members[i];
  }
  const a = stableSum(x.map((v) => Math.abs(v - y))) / m;
  let pairs = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) pairs += Math.abs(x[i] - x[j]);
  const value = a - pairs / (2 * m * m);
  return {
    value,
    exactness: 'empirical',
    method: 'Energy form of the CRPS applied to the empirical CDF of the ensemble: E|X − y| − ½E|X − X′|.',
    explanation: {
      method: 'CRPS from an ensemble',
      formula: 'CRPS = (1/m)Σ|xᵢ − y| − (1/2m²)ΣΣ|xᵢ − xⱼ|',
      steps: [
        { label: 'Members', value: String(m) },
        { label: 'CRPS', value: value.toPrecision(10) },
      ],
      assumptions: ['The ensemble members are an exchangeable sample from the predictive distribution.'],
      limitations: [
        'This is the CRPS of the EMPIRICAL CDF of the ensemble, which is biased low relative to the CRPS of the distribution the ensemble is drawn from; the bias is of order 1/m. The fair-CRPS variant divides the pair term by m(m−1) instead.',
        'CRPS has the units of the observation.',
      ],
      exactness: 'empirical',
    },
  };
}

/** CRPS by numerical integration of its definition, for cross-checking a closed form. */
export function crpsNumerical(
  cdf: (x: number) => number,
  y: number,
  lower: number,
  upper: number,
  panels = 4000,
): CrpsResult {
  if (!(upper > lower)) throw new EngineError(`The integration range needs upper > lower; got [${lower}, ${upper}].`, 'range');
  // Simpson's rule on the integrand (F(x) − 1{x ≥ y})², with the kink at y
  // placed on a panel boundary by splitting the range there.
  // `shift` is the value of the indicator 1{x ≥ y} on the piece being
  // integrated. It is passed in rather than evaluated pointwise so that the
  // shared endpoint x = y gets the right value on each side of the kink;
  // evaluating the indicator at x = y inside the left piece would use the
  // wrong branch and leave an O(h) error.
  const integrate = (a: number, b: number, k: number, shift: 0 | 1): number => {
    const even = k % 2 === 0 ? k : k + 1;
    const h = (b - a) / even;
    const parts: number[] = [];
    for (let i = 0; i <= even; i++) {
      const x = a + i * h;
      const g = (cdf(x) - shift) ** 2;
      const w = i === 0 || i === even ? 1 : i % 2 === 1 ? 4 : 2;
      parts.push(w * g);
    }
    return (h / 3) * stableSum(parts);
  };
  const half = Math.ceil(panels / 2);
  const value =
    y > lower && y < upper
      ? integrate(lower, y, half, 0) + integrate(y, upper, half, 1)
      : integrate(lower, upper, panels, y <= lower ? 1 : 0);
  return {
    value,
    exactness: 'numerical',
    method: `Simpson's rule on ∫(F(x) − 1{x ≥ y})² dx over [${lower}, ${upper}], split at the observation.`,
    explanation: {
      method: 'CRPS by quadrature',
      formula: 'CRPS = ∫ (F(x) − 1{x ≥ y})² dx',
      steps: [{ label: 'CRPS', value: value.toPrecision(10) }],
      assumptions: ['The integration range covers essentially all of the predictive mass.'],
      limitations: [
        'Truncating the integration range omits the tail contribution, which biases the value downward. Widen the range until the value stops moving.',
        'CRPS has the units of the observation.',
      ],
      exactness: 'numerical',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Calibration                                                        */
/* ------------------------------------------------------------------ */

export interface ReliabilityBin {
  lower: number;
  upper: number;
  count: number;
  meanForecast: number;
  observedFrequency: number;
  /** Wilson interval for the observed frequency — the uncertainty of the point on the diagram. */
  interval: Interval;
  /** observedFrequency − meanForecast; positive means under-forecasting. */
  gap: number;
}

export interface CalibrationResult {
  bins: ReliabilityBin[];
  /** Expected calibration error: Σ (n_k/n)|ō_k − p̄_k|. */
  ece: number;
  /** Maximum calibration error over non-empty bins. */
  mce: number;
  /** Index of the bin attaining the MCE. */
  mceBin: number;
  n: number;
  /** Spread of the forecasts themselves — the sharpness, reported SEPARATELY from calibration. */
  sharpness: SharpnessResult;
  exactness: 'empirical';
  explanation: Explanation;
}

export interface SharpnessResult {
  /** Variance of the issued probabilities. A constant forecast has 0 and is maximally unsharp. */
  forecastVariance: number;
  /** Mean of p(1−p): the average predictive variance. Smaller means sharper. */
  meanPredictiveVariance: number;
  /** Fraction of forecasts outside [0.4, 0.6] — a readable "decisiveness" measure. */
  fractionDecisive: number;
  note: string;
}

export function sharpness(forecasts: ArrayLike<number>): SharpnessResult {
  const n = forecasts.length;
  if (n === 0) throw new EngineError('There are no forecasts to measure the sharpness of.', 'empty');
  const p = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = forecasts[i];
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new EngineError(`Forecast ${i} = ${String(v)} is not a probability.`, 'range');
    p[i] = v;
  }
  const m = stableSum(p) / n;
  return {
    forecastVariance: stableSum(p.map((v) => (v - m) ** 2)) / n,
    meanPredictiveVariance: stableSum(p.map((v) => v * (1 - v))) / n,
    fractionDecisive: p.filter((v) => v < 0.4 || v > 0.6).length / n,
    note:
      'Sharpness is a property of the FORECASTS ALONE: it does not look at the outcomes and says nothing about whether they are right. ' +
      'The goal is maximum sharpness SUBJECT TO calibration — read this together with the ECE, never instead of it.',
  };
}

/** Reliability-diagram data with per-bin confidence intervals, plus ECE and MCE. */
export function calibration(
  forecasts: ArrayLike<number>,
  outcomes: ArrayLike<number>,
  options: { bins?: number; level?: number } = {},
): CalibrationResult {
  const { p, o } = validateForecasts(forecasts, outcomes);
  const n = p.length;
  const k = options.bins ?? 10;
  if (!Number.isInteger(k) || k < 1) throw new EngineError(`bins must be a positive whole number; got ${k}.`, 'integer');
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`level must lie in (0, 1); got ${level}.`, 'range');
  const idx: number[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < n; i++) idx[Math.min(k - 1, Math.floor(p[i] * k))].push(i);
  const bins: ReliabilityBin[] = [];
  let ece = 0;
  let mce = 0;
  let mceBin = -1;
  for (let b = 0; b < k; b++) {
    const g = idx[b];
    if (g.length === 0) {
      bins.push({
        lower: b / k,
        upper: (b + 1) / k,
        count: 0,
        meanForecast: NaN,
        observedFrequency: NaN,
        interval: { low: NaN, high: NaN, level, method: 'No observations in this bin — no value is reported.' },
        gap: NaN,
      });
      continue;
    }
    const pbar = stableSum(g.map((i) => p[i])) / g.length;
    const successes = g.reduce((acc, i) => acc + o[i], 0);
    const obar = successes / g.length;
    const gap = obar - pbar;
    ece += (g.length / n) * Math.abs(gap);
    if (Math.abs(gap) > mce) {
      mce = Math.abs(gap);
      mceBin = b;
    }
    bins.push({
      lower: b / k,
      upper: (b + 1) / k,
      count: g.length,
      meanForecast: pbar,
      observedFrequency: obar,
      interval: wilsonInterval(successes, g.length, level),
      gap,
    });
  }
  return {
    bins,
    ece,
    mce,
    mceBin,
    n,
    sharpness: sharpness(p),
    exactness: 'empirical',
    explanation: {
      method: 'Reliability diagram, ECE and MCE',
      formula: 'ECE = Σ (n_k/n)|ō_k − p̄_k|;  MCE = max_k |ō_k − p̄_k|',
      steps: [
        { label: 'Forecasts', value: String(n) },
        { label: 'Bins', value: String(k) },
        { label: 'ECE', value: ece.toPrecision(8) },
        { label: 'MCE', value: mce.toPrecision(8) },
        { label: 'Sharpness (forecast variance)', value: sharpness(p).forecastVariance.toPrecision(8) },
      ],
      assumptions: ['The forecasts and outcomes are paired and come from a comparable forecasting setting.'],
      limitations: [
        'ECE and MCE are BIASED UPWARD: a perfectly calibrated forecaster shows a non-zero ECE from sampling noise alone, and the bias grows with the number of bins and shrinks with n. Compare against the per-bin confidence intervals, not against 0.',
        'Both depend on the bin count. MCE in particular is dominated by the emptiest bin.',
        'Calibration says nothing about usefulness. Always read it next to the sharpness, which is reported separately here for that reason.',
      ],
      exactness: 'empirical',
    },
  };
}

export interface PitResult {
  /** The PIT values F_i(y_i) ∈ [0,1]. Uniform if and only if the forecasts are calibrated. */
  values: number[];
  /** Histogram counts over equal-width bins. */
  counts: number[];
  bins: number;
  /** Expected count per bin under calibration. */
  expected: number;
  /** Pearson χ² statistic against uniformity, with bins − 1 degrees of freedom. */
  chiSquared: number;
  degreesOfFreedom: number;
  /** Mean of the PIT values; ½ under calibration. */
  mean: number;
  /** Variance of the PIT values; 1/12 under calibration. */
  variance: number;
  diagnosis: string;
  exactness: 'empirical';
  explanation: Explanation;
}

/**
 * Probability integral transform histogram for continuous forecasts: evaluate
 * each predictive CDF at the value that actually occurred. Under a calibrated
 * sequence of forecasts these values are uniform on [0, 1]; the SHAPE of the
 * departure diagnoses the failure — U-shaped means too narrow (overconfident),
 * hump-shaped means too wide, sloped means biased.
 */
export function pitHistogram(
  pitValues: ArrayLike<number>,
  options: { bins?: number } = {},
): PitResult {
  const n = pitValues.length;
  if (n === 0) throw new EngineError('There are no PIT values to histogram.', 'empty');
  const k = options.bins ?? 10;
  if (!Number.isInteger(k) || k < 2) throw new EngineError(`bins must be a whole number ≥ 2; got ${k}.`, 'integer');
  const values = new Array<number>(n);
  const counts = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const u = pitValues[i];
    if (!Number.isFinite(u) || u < 0 || u > 1) {
      throw new EngineError(`PIT value ${i} = ${String(u)} is outside [0, 1]; it must be F_i(y_i) for the predictive CDF F_i.`, 'range');
    }
    values[i] = u;
    counts[Math.min(k - 1, Math.floor(u * k))] += 1;
  }
  const expected = n / k;
  const chi2 = stableSum(counts.map((c) => (c - expected) ** 2 / expected));
  const mean = stableSum(values) / n;
  const variance = stableSum(values.map((u) => (u - mean) ** 2)) / n;
  // Shape diagnosis from the ends versus the middle of the histogram.
  const ends = counts[0] + counts[k - 1];
  const middleStart = Math.floor(k / 2) - 1;
  const middle = counts[middleStart] + counts[middleStart + 1];
  let diagnosis: string;
  if (chi2 <= k - 1) {
    diagnosis = 'Consistent with uniform: no evidence of miscalibration in this sample (which is not proof of calibration).';
  } else if (mean > 0.55) {
    diagnosis = 'Sloped upward: the observations land high in the predictive distributions, so the forecasts are biased LOW.';
  } else if (mean < 0.45) {
    diagnosis = 'Sloped downward: the observations land low in the predictive distributions, so the forecasts are biased HIGH.';
  } else if (ends > 1.5 * middle) {
    diagnosis = 'U-shaped: the predictive distributions are TOO NARROW — the forecasts are overconfident and observations land in the tails too often.';
  } else if (middle > 1.5 * ends) {
    diagnosis = 'Hump-shaped: the predictive distributions are TOO WIDE — the forecasts are underconfident.';
  } else {
    diagnosis = 'Non-uniform in a shape that is neither a clean U, hump nor slope; inspect the histogram directly.';
  }
  return {
    values,
    counts,
    bins: k,
    expected,
    chiSquared: chi2,
    degreesOfFreedom: k - 1,
    mean,
    variance,
    diagnosis,
    exactness: 'empirical',
    explanation: {
      method: 'PIT histogram',
      formula: 'uᵢ = Fᵢ(yᵢ); under calibration u ~ Uniform(0,1), so E[u] = ½ and Var[u] = 1/12',
      steps: [
        { label: 'Forecasts', value: String(n) },
        { label: 'Mean PIT (½ expected)', value: mean.toPrecision(6) },
        { label: 'Variance of PIT (0.08333 expected)', value: variance.toPrecision(6) },
        { label: `χ² against uniform (df = ${k - 1})`, value: chi2.toPrecision(6) },
        { label: 'Diagnosis', value: diagnosis },
      ],
      assumptions: [
        'Each PIT value was computed from the predictive CDF issued BEFORE the observation, and the forecasts are at least approximately independent.',
      ],
      limitations: [
        'For a DISCRETE predictive distribution the PIT is not uniform even under perfect calibration; a randomised PIT must be used instead.',
        'Serial dependence between forecasts invalidates the χ² reference distribution, which assumes independence.',
        'Uniformity is necessary for calibration but not sufficient: a forecaster can produce a flat PIT while making compensating errors in opposite directions.',
      ],
      exactness: 'empirical',
    },
  };
}

/** PIT values for normal predictive distributions. */
export function normalPitValues(mus: ArrayLike<number>, sigmas: ArrayLike<number>, ys: ArrayLike<number>): number[] {
  if (mus.length !== sigmas.length || mus.length !== ys.length) {
    throw new EngineError(`The predictive means, standard deviations and observations must have equal length; got ${mus.length}, ${sigmas.length}, ${ys.length}.`, 'shape');
  }
  const out = new Array<number>(mus.length);
  for (let i = 0; i < mus.length; i++) {
    if (!(sigmas[i] > 0)) throw new EngineError(`Predictive standard deviation ${i} must be > 0 for a PIT; got ${String(sigmas[i])}.`, 'range');
    if (!Number.isFinite(mus[i]) || !Number.isFinite(ys[i])) throw new EngineError(`Forecast or observation ${i} is not finite.`, 'finite');
    out[i] = normalCdf((ys[i] - mus[i]) / sigmas[i]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Skill scores                                                       */
/* ------------------------------------------------------------------ */

export interface SkillScoreResult {
  score: number;
  referenceScore: number;
  /** 1 − score/reference for a loss; positive means better than the reference. */
  skill: number;
  /** Perfect score for the rule, used to state the attainable range. */
  perfect: number;
  reference: string;
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Skill score against a baseline. A raw Brier or log score is uninterpretable
 * on its own — 0.2 is excellent for a coin flip and terrible for a near-certain
 * event — so the comparison is the number that means something.
 */
export function skillScore(
  score: number,
  referenceScore: number,
  options: { reference?: string; perfect?: number } = {},
): SkillScoreResult {
  if (!Number.isFinite(score)) throw new EngineError('The score must be finite to form a skill score.', 'finite');
  if (!Number.isFinite(referenceScore)) throw new EngineError('The reference score must be finite to form a skill score.', 'finite');
  const perfect = options.perfect ?? 0;
  if (referenceScore === perfect) {
    throw new EngineError(
      `The reference score equals the perfect score (${perfect}), so the skill score 1 − score/reference is undefined (division by zero). ` +
        'This happens when the baseline is already perfect — there is no room for skill to be measured.',
      'degenerate',
    );
  }
  const skill = 1 - (score - perfect) / (referenceScore - perfect);
  return {
    score,
    referenceScore,
    skill,
    perfect,
    reference: options.reference ?? 'supplied baseline',
    exactness: 'exact',
    explanation: {
      method: 'Skill score against a baseline',
      formula: 'SS = 1 − (S − S_perfect)/(S_ref − S_perfect)',
      steps: [
        { label: 'Score', value: score.toPrecision(10) },
        { label: 'Reference score', value: referenceScore.toPrecision(10) },
        { label: 'Skill', value: skill.toPrecision(10) },
      ],
      assumptions: ['The score and the reference were computed with the same rule on the same events.'],
      limitations: [
        'A skill score is only as meaningful as its baseline. Beating a coin flip is not an achievement; beating climatology on the same events is.',
        'Skill is 1 for a perfect forecast, 0 for one as good as the baseline, and NEGATIVE for one worse than the baseline. It is not bounded below.',
        'Skill scores are not themselves proper: maximising a skill score can be gamed where maximising the underlying proper score cannot.',
      ],
      exactness: 'exact',
    },
  };
}

/** The Brier score of the constant climatological forecast (the base rate), the natural baseline. */
export function climatologyBrier(outcomes: ArrayLike<number>): { baseRate: number; brierScore: number } {
  const n = outcomes.length;
  if (n === 0) throw new EngineError('There are no outcomes to form a climatology from.', 'empty');
  let s = 0;
  for (let i = 0; i < n; i++) {
    const y = outcomes[i];
    if (y !== 0 && y !== 1) throw new EngineError(`Outcome ${i} = ${String(y)} must be 0 or 1.`, 'range');
    s += y;
  }
  const r = s / n;
  // The constant forecast r gives mean (r − o)² = r(1 − r).
  return { baseRate: r, brierScore: r * (1 - r) };
}

/* ------------------------------------------------------------------ */
/* Propriety verification                                             */
/* ------------------------------------------------------------------ */

export type BinaryScoringRule = (reported: number, outcome: 0 | 1) => number;

export const SCORING_RULES: Record<string, { rule: BinaryScoringRule; proper: boolean; description: string }> = {
  brier: {
    rule: (r, o) => (r - o) ** 2,
    proper: true,
    description: 'Brier (quadratic) score — strictly proper.',
  },
  log: {
    rule: (r, o) => -Math.log(o === 1 ? r : 1 - r),
    proper: true,
    description: 'Logarithmic score — strictly proper, and infinite for a confidently wrong forecast.',
  },
  spherical: {
    rule: (r, o) => 1 - (o === 1 ? r : 1 - r) / Math.sqrt(r * r + (1 - r) ** 2),
    proper: true,
    description: 'Spherical score as a loss — strictly proper.',
  },
  absolute: {
    rule: (r, o) => Math.abs(r - o),
    proper: false,
    description:
      'Absolute (linear) score — IMPROPER. Its expected value is minimised by reporting 0 or 1, whichever is more likely, so it ' +
      'rewards pretending to be certain. It is included here precisely to be shown failing.',
  },
};

export interface ProprietyCheck {
  rule: string;
  trueProbability: number;
  /** Grid of reported probabilities tested. */
  grid: number[];
  /** Expected score at each grid point. */
  expectedScores: number[];
  /** Grid point minimising the expected score. */
  optimalReport: number;
  /** Expected score at the optimum. */
  optimalScore: number;
  /** Expected score at the truth. */
  scoreAtTruth: number;
  /** |optimalReport − trueProbability| ≤ grid spacing. */
  optimisedAtTruth: boolean;
  /** What the rule actually rewards. */
  verdict: string;
  exactness: 'numerical';
  explanation: Explanation;
}

/**
 * Demonstrate numerically whether a binary scoring rule is PROPER: compute the
 * expected score E_p[S(r, O)] = p·S(r,1) + (1−p)·S(r,0) over a grid of
 * reported probabilities r, and see whether the minimum sits at r = p.
 *
 * A proper rule is minimised at the truth, so honesty is the optimal strategy.
 * An improper rule is minimised somewhere else, which is exactly what makes it
 * dangerous: the forecaster is paid to misreport.
 */
export function verifyPropriety(
  ruleName: string,
  trueProbability: number,
  options: { gridPoints?: number; rule?: BinaryScoringRule } = {},
): ProprietyCheck {
  const entry = SCORING_RULES[ruleName];
  const rule = options.rule ?? entry?.rule;
  if (!rule) {
    throw new EngineError(
      `Unknown scoring rule "${ruleName}". Built in: ${Object.keys(SCORING_RULES).join(', ')}. Pass a rule function to test your own.`,
      'unknown',
    );
  }
  const p = trueProbability;
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new EngineError(`The true probability must lie in [0, 1]; got ${String(p)}.`, 'range');
  const m = options.gridPoints ?? 2001;
  if (!Number.isInteger(m) || m < 3) throw new EngineError(`gridPoints must be a whole number ≥ 3; got ${m}.`, 'integer');
  // The endpoints 0 and 1 are trimmed because the log score is infinite there;
  // that is a property of the rule, not of the grid, and the improper rules
  // still show their optimum at the trimmed end.
  const edge = 1e-6;
  const grid = new Array<number>(m);
  for (let i = 0; i < m; i++) grid[i] = edge + ((1 - 2 * edge) * i) / (m - 1);
  const expectedScores = grid.map((r) => p * rule(r, 1) + (1 - p) * rule(r, 0));
  let best = 0;
  for (let i = 1; i < m; i++) if (expectedScores[i] < expectedScores[best]) best = i;
  const spacing = (1 - 2 * edge) / (m - 1);
  const scoreAtTruth = p * rule(Math.min(1 - edge, Math.max(edge, p)), 1) + (1 - p) * rule(Math.min(1 - edge, Math.max(edge, p)), 0);
  const optimisedAtTruth = Math.abs(grid[best] - p) <= 1.5 * spacing;
  return {
    rule: ruleName,
    trueProbability: p,
    grid,
    expectedScores,
    optimalReport: grid[best],
    optimalScore: expectedScores[best],
    scoreAtTruth,
    optimisedAtTruth,
    verdict: optimisedAtTruth
      ? `The expected score is minimised at r = ${grid[best].toPrecision(6)}, which is the true probability ${p}. Reporting the truth is optimal, so the rule behaves properly here.`
      : `The expected score is minimised at r = ${grid[best].toPrecision(6)}, NOT at the true probability ${p}. This rule rewards misreporting and is IMPROPER. ${entry?.description ?? ''}`,
    exactness: 'numerical',
    explanation: {
      method: 'Numerical propriety check',
      formula: 'E_p[S(r, O)] = p·S(r, 1) + (1 − p)·S(r, 0), minimised over r on a grid',
      steps: [
        { label: 'True probability', value: String(p) },
        { label: 'Grid points', value: String(m) },
        { label: 'Optimal report', value: grid[best].toPrecision(8) },
        { label: 'Expected score at the optimum', value: expectedScores[best].toPrecision(8) },
        { label: 'Expected score at the truth', value: scoreAtTruth.toPrecision(8) },
        { label: 'Verdict', value: optimisedAtTruth ? 'proper at this p' : 'IMPROPER' },
      ],
      assumptions: ['The outcome really is Bernoulli(p); propriety is a statement about the expectation under the true distribution.'],
      limitations: [
        `The optimum is located on a grid of spacing ${spacing.toExponential(2)}, so "at the truth" means within 1.5 grid steps.`,
        'Checking one value of p does not prove propriety for all p; it demonstrates the behaviour at that p. Sweep p to see the pattern.',
        'The grid is trimmed slightly away from 0 and 1 so that the log score stays finite.',
      ],
      exactness: 'numerical',
    },
  };
}
