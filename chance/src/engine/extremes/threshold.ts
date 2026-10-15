/**
 * Threshold selection for peaks over threshold.
 *
 * There is no estimator for the threshold: it is a bias/variance trade-off the
 * analyst makes. Too low and the generalised Pareto limit does not hold, so
 * the fit is biased; too high and almost no data is left, so the variance
 * explodes. Both diagnostics below are *visual aids* for that judgement, and
 * the automatic suggestion is a starting point, never an answer.
 *
 *  - Mean residual life (mean excess) plot: for a GPD the mean excess
 *    E[X − v | X > v] = (σ + ξ(v − u))/(1 − ξ) is linear in v. The plot should
 *    be read for the lowest v above which it is straight.
 *  - Parameter stability plot: the shape ξ and the modified scale
 *    σ* = σ − ξu are constant in u once the limit holds, so they should settle
 *    to horizontal lines.
 */
import { type EngineResult, type Explanation, fail, ok } from '../core/result';
import { mean, quantile, sortedCopy, variance } from '../stats/descriptive';
import { linspace } from '../core/numeric';
import { normalQuantile } from '../special/gamma';
import { fitGpdPot, MIN_EXCEEDANCES, RECOMMENDED_EXCEEDANCES } from './fit';

export interface MeanExcessPoint {
  threshold: number;
  /** Mean of (x − threshold) over the exceedances. */
  meanExcess: number;
  /** Number of exceedances at this threshold. */
  count: number;
  /** Normal-approximation confidence limits for the mean excess, or null if n < 2. */
  lower: number | null;
  upper: number | null;
}

export interface MeanResidualLifePlot {
  points: MeanExcessPoint[];
  level: number;
  explanation: Explanation;
}

/**
 * Mean residual life plot data. Thresholds run from `from` to `to` (defaults:
 * the median to the second largest observation), stopping before the count
 * falls below `minCount`, since a mean excess over three points is noise.
 */
export function meanResidualLifePlot(
  data: ArrayLike<number>,
  options: { from?: number; to?: number; points?: number; minCount?: number; level?: number } = {},
): EngineResult<MeanResidualLifePlot> {
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) values.push(data[i]);
  if (values.length < 20) {
    return fail(
      `A mean residual life plot needs at least 20 usable observations; ${values.length} were supplied.`,
    );
  }
  const sorted = Array.from(sortedCopy(values));
  const minCount = options.minCount ?? 10;
  const level = options.level ?? 0.95;
  const z = normalQuantile((1 + level) / 2);
  const from = options.from ?? quantile(sorted, 0.5);
  const to = options.to ?? sorted[sorted.length - 2];
  if (!(to > from)) {
    return fail('The threshold range for the mean residual life plot is empty: the upper end is not above the lower.');
  }
  const grid = linspace(from, to, options.points ?? 50);
  const points: MeanExcessPoint[] = [];
  for (const v of grid) {
    const excesses = sorted.filter((x) => x > v).map((x) => x - v);
    if (excesses.length < minCount) continue;
    const m = mean(excesses);
    let lower: number | null = null;
    let upper: number | null = null;
    if (excesses.length >= 2) {
      const se = Math.sqrt(variance(excesses, 1) / excesses.length);
      lower = m - z * se;
      upper = m + z * se;
    }
    points.push({ threshold: v, meanExcess: m, count: excesses.length, lower, upper });
  }
  if (points.length === 0) {
    return fail(
      `No threshold in the requested range leaves at least ${minCount} exceedances, so no mean residual life plot can be drawn.`,
    );
  }
  return ok({
    points,
    level,
    explanation: {
      method: 'Mean residual life (mean excess) plot',
      formula: 'e(v) = mean of (x − v) over x > v; for a GPD this is (σ + ξ(v − u))/(1 − ξ), linear in v',
      steps: [
        { label: 'Thresholds plotted', value: String(points.length) },
        { label: 'Smallest exceedance count', value: String(Math.min(...points.map((p) => p.count))) },
      ],
      assumptions: ['The confidence limits use the normal approximation for the sample mean of the excesses.'],
      limitations: [
        'Reading the point where the plot becomes straight is a judgement, and different readers choose different thresholds from the same plot.',
        'The points share data, so they are strongly dependent: the curve wanders more smoothly than independent error bars suggest.',
      ],
      exactness: 'empirical',
    },
  });
}

export interface StabilityPoint {
  threshold: number;
  exceedances: number;
  shape: number;
  shapeStandardError: number | null;
  /** Modified scale σ* = σ − ξu, which is constant in u when the model holds. */
  modifiedScale: number;
  scale: number;
}

export interface ParameterStabilityPlot {
  points: StabilityPoint[];
  /** Thresholds that were tried but could not be fitted, with the reason. */
  skipped: { threshold: number; reason: string }[];
  explanation: Explanation;
}

/** Fit the GPD at a range of thresholds and report ξ and σ* at each. */
export function parameterStabilityPlot(
  data: ArrayLike<number>,
  options: { quantileFrom?: number; quantileTo?: number; points?: number } = {},
): EngineResult<ParameterStabilityPlot> {
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) values.push(data[i]);
  if (values.length < 50) {
    return fail(
      `A parameter stability plot needs at least 50 usable observations to fit the GPD repeatedly; ${values.length} were supplied.`,
    );
  }
  const sorted = Array.from(sortedCopy(values));
  const qFrom = options.quantileFrom ?? 0.7;
  const qTo = options.quantileTo ?? 0.99;
  const grid = linspace(qFrom, qTo, options.points ?? 20).map((q) => quantile(sorted, q));
  const points: StabilityPoint[] = [];
  const skipped: { threshold: number; reason: string }[] = [];
  for (const u of grid) {
    const fit = fitGpdPot(sorted, { threshold: u, totalObservations: sorted.length });
    if (!fit.ok) {
      skipped.push({ threshold: u, reason: fit.errors.map((e) => e.message).join(' ') });
      continue;
    }
    const { params, estimates, exceedances } = fit.value;
    points.push({
      threshold: u,
      exceedances: exceedances.length,
      shape: params.shape,
      shapeStandardError: estimates[1].standardError,
      modifiedScale: params.scale - params.shape * u,
      scale: params.scale,
    });
  }
  if (points.length === 0) {
    return fail('No threshold in the requested range produced a converged GPD fit, so no stability plot can be drawn.');
  }
  return ok({
    points,
    skipped,
    explanation: {
      method: 'Parameter stability plot: GPD refitted at a range of thresholds',
      formula: 'σ* = σ_u − ξu and ξ are both free of u once the threshold is high enough',
      steps: [
        { label: 'Thresholds fitted', value: String(points.length) },
        { label: 'Thresholds refused', value: String(skipped.length) },
      ],
      assumptions: ['Each point is a separate maximum-likelihood fit to the exceedances above that threshold.'],
      limitations: [
        'Neighbouring points reuse almost all the same exceedances, so the curve is far smoother than independent fits would be; do not read small wiggles as information.',
        'Choosing where the lines become flat is a judgement that changes the fitted model and every return level taken from it.',
      ],
      exactness: 'numerical',
    },
  });
}

export interface ThresholdSuggestion {
  threshold: number;
  /** Quantile of the data the suggestion corresponds to. */
  dataQuantile: number;
  exceedances: number;
  shape: number;
  /** How the candidate was selected. */
  rule: 'shape-stability' | 'fallback-quantile';
  /** Every candidate considered, for the interface to show. */
  candidates: StabilityPoint[];
  explanation: Explanation;
}

const JUDGEMENT_WARNING =
  'Threshold choice is a judgement call, not a computation. It materially changes the fitted shape, the fitted scale and every return level and tail risk number derived from them. This suggestion is a starting point for inspecting the mean residual life and parameter-stability plots, not a result.';

/**
 * Suggest a threshold by shape stability: the lowest candidate above which
 * every higher candidate's shape estimate stays within two standard errors of
 * it, keeping at least `minExceedances` exceedances. Falls back to a fixed
 * quantile, saying so, when no candidate is stable.
 */
export function suggestThreshold(
  data: ArrayLike<number>,
  options: { minExceedances?: number; fallbackQuantile?: number } = {},
): EngineResult<ThresholdSuggestion> {
  const minExceedances = options.minExceedances ?? RECOMMENDED_EXCEEDANCES;
  const fallbackQuantile = options.fallbackQuantile ?? 0.9;
  const stability = parameterStabilityPlot(data, { quantileFrom: 0.7, quantileTo: 0.98, points: 25 });
  if (!stability.ok) return stability;
  const values: number[] = [];
  for (let i = 0; i < data.length; i++) if (Number.isFinite(data[i])) values.push(data[i]);
  const sorted = Array.from(sortedCopy(values));
  const candidates = stability.value.points.filter((p) => p.exceedances >= Math.max(minExceedances, MIN_EXCEEDANCES));
  if (candidates.length === 0) {
    return fail(
      `No candidate threshold leaves at least ${Math.max(minExceedances, MIN_EXCEEDANCES)} exceedances. The record is too short for a threshold model: it has ${sorted.length} observations.`,
    );
  }

  let chosen: StabilityPoint | null = null;
  for (let i = 0; i < candidates.length; i++) {
    const base = candidates[i];
    const se = base.shapeStandardError;
    if (se === null || !(se > 0)) continue;
    const stable = candidates.slice(i + 1).every((p) => Math.abs(p.shape - base.shape) <= 2 * se);
    if (stable) {
      chosen = base;
      break;
    }
  }

  const rule: ThresholdSuggestion['rule'] = chosen ? 'shape-stability' : 'fallback-quantile';
  if (!chosen) {
    const u = quantile(sorted, fallbackQuantile);
    let nearest = candidates[0];
    for (const c of candidates) if (Math.abs(c.threshold - u) < Math.abs(nearest.threshold - u)) nearest = c;
    chosen = nearest;
  }
  const exceedingFraction = sorted.filter((x) => x > (chosen as StabilityPoint).threshold).length / sorted.length;

  return ok(
    {
      threshold: chosen.threshold,
      dataQuantile: 1 - exceedingFraction,
      exceedances: chosen.exceedances,
      shape: chosen.shape,
      rule,
      candidates,
      explanation: {
        method:
          rule === 'shape-stability'
            ? 'Automatic threshold suggestion by shape stability across refitted thresholds'
            : 'Automatic threshold suggestion fell back to a fixed data quantile because no candidate was stable',
        steps: [
          { label: 'Suggested threshold', value: chosen.threshold.toPrecision(6) },
          { label: 'Exceedances above it', value: String(chosen.exceedances) },
          { label: 'Data quantile', value: (1 - exceedingFraction).toPrecision(4) },
          { label: 'Rule used', value: rule },
        ],
        assumptions: [
          'Stability is judged against the asymptotic standard error of the shape at the candidate threshold.',
        ],
        limitations: [
          JUDGEMENT_WARNING,
          rule === 'fallback-quantile'
            ? `No candidate threshold had a stable shape, so the ${fallbackQuantile * 100}% data quantile was used instead. This is a default, and the fit above it may well be biased.`
            : 'Stability over the candidates examined does not prove the limit model holds; it only shows the estimates did not move much.',
        ],
        exactness: 'numerical',
      },
    },
    [JUDGEMENT_WARNING],
  );
}
