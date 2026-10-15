/**
 * Diagnostic plot data for a fitted distribution: plain point arrays, no
 * drawing and no decisions. The chart components receive computed values.
 *
 * The Q–Q envelope is the important one. A Q–Q plot without an envelope is a
 * Rorschach test — every finite sample wanders away from the line in the
 * tails. The envelope shows how far a sample of this size from the fitted
 * distribution typically wanders, so deviations can be judged instead of
 * imagined.
 */
import { EngineError } from '../core/result';
import { histogram, sortedCopy } from '../stats/descriptive';
import { Random, Xoshiro128, type Seed } from '../random/rng';
import type { DistributionDef, Params } from '../distributions/types';
import { sampleFrom } from './bootstrap';
import type { PlotPoint, QqEnvelopePoint } from './types';

/** Plotting position (i − 0.5)/n: the standard compromise, symmetric in the tails. */
function plottingPosition(i: number, n: number): number {
  return (i + 0.5) / n;
}

export interface QqResult {
  points: PlotPoint[];
  /** y = slope·x + intercept. Identity for a fitted distribution. */
  referenceLine: { slope: number; intercept: number; label: string };
  note: string;
}

/** Q–Q plot: theoretical quantile (x) against observed order statistic (y). */
export function qqPlotData(data: ArrayLike<number>, def: DistributionDef, params: Params): QqResult {
  const sorted = sortedCopy(data);
  const n = sorted.length;
  if (n < 3) throw new EngineError('A Q–Q plot needs at least 3 observations.', 'insufficient');
  const points: PlotPoint[] = [];
  for (let i = 0; i < n; i++) {
    const q = def.quantile(plottingPosition(i, n), params);
    if (!Number.isFinite(q)) continue;
    points.push({ x: q, y: sorted[i] });
  }
  if (points.length < 3) throw new EngineError('The fitted distribution returned no finite quantiles, so no Q–Q plot can be drawn.', 'numerical');
  return {
    points,
    referenceLine: { slope: 1, intercept: 0, label: 'y = x (perfect agreement with the fitted distribution)' },
    note:
      'Theoretical quantiles come from the fitted parameters, so the reference line is the identity. Points curving away at the ends mean the tails are wrong, which matters more than a wobble in the middle. Compare against the bootstrap envelope before concluding anything.',
  };
}

/** P–P plot: fitted CDF at each observation (x) against the empirical position (y). */
export function ppPlotData(data: ArrayLike<number>, def: DistributionDef, params: Params): { points: PlotPoint[]; note: string } {
  const sorted = sortedCopy(data);
  const n = sorted.length;
  const points: PlotPoint[] = [];
  for (let i = 0; i < n; i++) points.push({ x: def.cdf(sorted[i], params), y: plottingPosition(i, n) });
  return {
    points,
    note: 'A P–P plot compresses the tails, where probabilities are all close to 0 or 1, so it hides exactly the misfit a Q–Q plot exposes. Use it to judge the middle of the distribution.',
  };
}

export interface CdfComparison {
  empirical: PlotPoint[];
  fitted: PlotPoint[];
  /** Largest vertical gap and where it occurs — the KS statistic. */
  largestGap: { x: number; gap: number };
}

export function cdfComparisonData(data: ArrayLike<number>, def: DistributionDef, params: Params, points = 300): CdfComparison {
  const sorted = sortedCopy(data);
  const n = sorted.length;
  if (n < 2) throw new EngineError('At least 2 observations are needed to compare distribution functions.', 'insufficient');
  const empirical: PlotPoint[] = [];
  let gap = 0;
  let gapAt = sorted[0];
  for (let i = 0; i < n; i++) {
    const f = def.cdf(sorted[i], params);
    const e = (i + 1) / n;
    empirical.push({ x: sorted[i], y: e });
    const g = Math.max(Math.abs(e - f), Math.abs(i / n - f));
    if (g > gap) {
      gap = g;
      gapAt = sorted[i];
    }
  }
  const lo = sorted[0];
  const hi = sorted[n - 1];
  const fitted: PlotPoint[] = [];
  const pad = (hi - lo) * 0.05 || 1;
  for (let i = 0; i < points; i++) {
    const x = lo - pad + ((hi - lo + 2 * pad) * i) / (points - 1);
    fitted.push({ x, y: def.cdf(x, params) });
  }
  return { empirical, fitted, largestGap: { x: gapAt, gap } };
}

export interface HistogramOverlay {
  bins: { x0: number; x1: number; density: number; count: number }[];
  density: PlotPoint[];
  note: string;
}

export function histogramOverlayData(data: ArrayLike<number>, def: DistributionDef, params: Params, bins?: number, points = 300): HistogramOverlay {
  // histogram() expects sorted input.
  const h = histogram(sortedCopy(data), bins === undefined ? {} : { bins });
  if (!h.length) throw new EngineError('No histogram could be built from this data.', 'empty');
  const lo = h[0].x0;
  const hi = h[h.length - 1].x1;
  const density: PlotPoint[] = [];
  if (def.kind === 'discrete') {
    for (let k = Math.ceil(lo); k <= Math.floor(hi); k++) density.push({ x: k, y: def.pdf(k, params) });
  } else {
    for (let i = 0; i < points; i++) {
      const x = lo + ((hi - lo) * i) / (points - 1);
      density.push({ x, y: def.pdf(x, params) });
    }
  }
  return {
    bins: h.map((b) => ({ x0: b.x0, x1: b.x1, density: b.density, count: b.count })),
    density,
    note:
      def.kind === 'discrete'
        ? 'The overlay is a probability mass, not a density: compare the heights to the bar proportions, not to a curve.'
        : 'The visual match depends on the bin width as much as on the fit. Changing the number of bins changes the impression; the Q–Q plot and Anderson–Darling statistic do not.',
  };
}

export interface QqEnvelopeOptions {
  replicates?: number;
  level?: number;
  seed?: Seed;
  chunk?: number;
}

export interface QqEnvelopeResult {
  points: QqEnvelopePoint[];
  replicates: number;
  level: number;
  /** Fraction of observed points outside the envelope. */
  outsideFraction: number;
  method: string;
  caveats: string[];
}

/**
 * Pointwise Q–Q envelope by parametric bootstrap: simulate samples of the same
 * size from the fitted distribution, sort each, and take the level-quantiles
 * of each order statistic. A generator, so a worker can cancel it.
 */
export function* qqEnvelopeSteps(
  data: ArrayLike<number>,
  def: DistributionDef,
  params: Params,
  options: QqEnvelopeOptions = {},
): Generator<number, QqEnvelopeResult, void> {
  const replicates = options.replicates ?? 200;
  const level = options.level ?? 0.95;
  const chunk = Math.max(1, options.chunk ?? 20);
  if (!Number.isInteger(replicates) || replicates < 50) throw new EngineError('A Q–Q envelope needs at least 50 simulated samples.', 'range');
  if (!(level > 0 && level < 1)) throw new EngineError('The envelope level must be between 0 and 1.', 'range');
  const sorted = sortedCopy(data);
  const n = sorted.length;
  if (n < 5) throw new EngineError('A Q–Q envelope needs at least 5 observations.', 'insufficient');
  const rng = new Random(new Xoshiro128(options.seed ?? 'qq-envelope'));
  const columns: Float64Array[] = [];
  let done = 0;
  while (done < replicates) {
    const end = Math.min(replicates, done + chunk);
    for (; done < end; done++) {
      const s = sampleFrom(def, params, n, rng);
      s.sort((a, b) => a - b);
      columns.push(Float64Array.from(s));
    }
    yield done;
  }
  const alpha = (1 - level) / 2;
  const points: QqEnvelopePoint[] = [];
  let outside = 0;
  const buf = new Float64Array(replicates);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < replicates; r++) buf[r] = columns[r][i];
    const col = Array.from(buf).sort((a, b) => a - b);
    const pick = (q: number): number => {
      const h = (col.length - 1) * q;
      const l = Math.floor(h);
      const u = Math.min(col.length - 1, l + 1);
      return col[l] + (h - l) * (col[u] - col[l]);
    };
    const low = pick(alpha);
    const high = pick(1 - alpha);
    const theoretical = def.quantile(plottingPosition(i, n), params);
    if (sorted[i] < low || sorted[i] > high) outside++;
    points.push({ theoretical, observed: sorted[i], low, high });
  }
  return {
    points,
    replicates,
    level,
    outsideFraction: outside / n,
    method: `Pointwise ${(level * 100).toFixed(0)}% envelope from ${replicates} samples of size ${n} simulated from the fitted distribution.`,
    caveats: [
      'The band is POINTWISE: about ' + ((1 - level) * 100).toFixed(0) + '% of points will fall outside it even when the fit is perfect. A few excursions mean nothing; a run of consecutive points outside, or a systematic curve, means something.',
      'The envelope assumes the fitted parameters are the truth, so it understates the spread slightly — the real parameters were estimated from this same data.',
    ],
  };
}

export function qqEnvelope(data: ArrayLike<number>, def: DistributionDef, params: Params, options: QqEnvelopeOptions = {}): QqEnvelopeResult {
  const steps = qqEnvelopeSteps(data, def, params, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
