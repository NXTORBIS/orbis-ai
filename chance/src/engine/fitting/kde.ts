/**
 * Gaussian kernel density estimation.
 *
 * Bandwidth, not kernel shape, is what matters: Silverman's and Scott's rules
 * are both derived under the assumption that the true density is normal, so
 * they oversmooth multimodal or skewed data. A user bandwidth is therefore a
 * first-class option, and the choice is always reported.
 *
 * For data with a known boundary (a positive quantity, a proportion), the
 * kernel leaks probability past the boundary and the estimate is biased
 * downwards there. Reflection correction fixes that by folding the leaked mass
 * back inside.
 */
import { EngineError } from '../core/result';
import { linspace } from '../core/numeric';
import { quantileSorted, sortedCopy, variance } from '../stats/descriptive';
import { normalPdf } from '../special/gamma';
import type { PlotPoint } from './types';

export type BandwidthRule = 'silverman' | 'scott';

export interface KdeOptions {
  rule?: BandwidthRule;
  /** Explicit bandwidth; overrides the rule. */
  bandwidth?: number;
  /** Known support boundaries for reflection correction. */
  bounds?: { min?: number; max?: number };
  points?: number;
  /** Grid range; defaults to the data range padded by 3 bandwidths. */
  range?: { min: number; max: number };
}

export interface KdeResult {
  bandwidth: number;
  bandwidthSource: 'silverman' | 'scott' | 'user';
  points: PlotPoint[];
  reflected: { min: boolean; max: boolean };
  n: number;
  warnings: string[];
  method: string;
  limitations: string[];
}

export function silvermanBandwidth(data: ArrayLike<number>): number {
  const n = data.length;
  const sorted = sortedCopy(data);
  const sd = Math.sqrt(variance(data, 1));
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const spread = iqr > 0 ? Math.min(sd, iqr / 1.349) : sd;
  if (!(spread > 0)) throw new EngineError('The data have no spread, so no kernel bandwidth is defined.', 'degenerate');
  return 0.9 * spread * Math.pow(n, -1 / 5);
}

export function scottBandwidth(data: ArrayLike<number>): number {
  const sd = Math.sqrt(variance(data, 1));
  if (!(sd > 0)) throw new EngineError('The data have no spread, so no kernel bandwidth is defined.', 'degenerate');
  return 1.059 * sd * Math.pow(data.length, -1 / 5);
}

export function kernelDensity(data: ArrayLike<number>, options: KdeOptions = {}): KdeResult {
  const n = data.length;
  if (n < 3) throw new EngineError('Kernel density estimation needs at least 3 observations.', 'insufficient');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(data[i])) throw new EngineError('Kernel density estimation needs finite observations; remove or explain the missing values first.', 'finite');
  }
  const rule = options.rule ?? 'silverman';
  let h: number;
  let source: KdeResult['bandwidthSource'];
  if (options.bandwidth !== undefined) {
    if (!(options.bandwidth > 0) || !Number.isFinite(options.bandwidth)) throw new EngineError('The bandwidth must be a finite positive number.', 'range');
    h = options.bandwidth;
    source = 'user';
  } else {
    h = rule === 'scott' ? scottBandwidth(data) : silvermanBandwidth(data);
    source = rule;
  }
  const lo = options.bounds?.min;
  const hi = options.bounds?.max;
  if (lo !== undefined) {
    for (let i = 0; i < n; i++) if (data[i] < lo) throw new EngineError(`Observation ${data[i]} lies below the stated lower bound ${lo}.`, 'range');
  }
  if (hi !== undefined) {
    for (let i = 0; i < n; i++) if (data[i] > hi) throw new EngineError(`Observation ${data[i]} lies above the stated upper bound ${hi}.`, 'range');
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    min = Math.min(min, data[i]);
    max = Math.max(max, data[i]);
  }
  let gridMin = options.range?.min ?? min - 3 * h;
  let gridMax = options.range?.max ?? max + 3 * h;
  if (lo !== undefined) gridMin = Math.max(gridMin, lo);
  if (hi !== undefined) gridMax = Math.min(gridMax, hi);
  const points = options.points ?? 256;
  const grid = linspace(gridMin, gridMax, points);
  const out: PlotPoint[] = grid.map((x) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      s += normalPdf((x - data[i]) / h);
      // Reflection: the mass the kernel puts outside a known boundary belongs inside.
      if (lo !== undefined) s += normalPdf((x - (2 * lo - data[i])) / h);
      if (hi !== undefined) s += normalPdf((x - (2 * hi - data[i])) / h);
    }
    return { x, y: s / (n * h) };
  });
  const warnings: string[] = [];
  if (source !== 'user') {
    warnings.push(`${source === 'scott' ? "Scott's" : "Silverman's"} rule assumes the underlying density is roughly normal. On multimodal or strongly skewed data it oversmooths and can hide a second mode; compare against a smaller bandwidth.`);
  }
  if (lo === undefined && min >= 0 && min < 3 * h) {
    warnings.push('The data stop near 0 but no lower bound was given, so the estimate spreads probability below the smallest observation. If the quantity cannot be negative, pass that bound so the boundary correction applies.');
  }
  return {
    bandwidth: h,
    bandwidthSource: source,
    points: out,
    reflected: { min: lo !== undefined, max: hi !== undefined },
    n,
    warnings,
    method: `Gaussian kernel density estimate, bandwidth ${h.toPrecision(6)} (${source})${lo !== undefined || hi !== undefined ? ', with boundary reflection' : ''}.`,
    limitations: [
      'A kernel density estimate is not a distribution you can extrapolate from: outside the data range it decays like the kernel, not like any real tail.',
      'It cannot be used for tail risk beyond the observed maximum.',
      ...(lo !== undefined || hi !== undefined
        ? ['Reflection makes the estimate have zero derivative at the boundary, which is correct for a density that is positive at the boundary but wrong for one that genuinely falls to zero there.']
        : []),
    ],
  };
}

/** Trapezoidal integral of a KDE curve — used to confirm it integrates to 1. */
export function integrateCurve(points: readonly PlotPoint[]): number {
  let s = 0;
  for (let i = 1; i < points.length; i++) {
    s += ((points[i].y + points[i - 1].y) / 2) * (points[i].x - points[i - 1].x);
  }
  return s;
}
