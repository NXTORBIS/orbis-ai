/**
 * Chart scales, tick generation and number formatting.
 *
 * Axes always include the zero baseline for bar/area charts so bar lengths are
 * proportional to their values. Line charts may use a non-zero baseline, and
 * when they do the axis range is shown explicitly rather than implied.
 */

export interface LinearScale {
  domain: [number, number];
  range: [number, number];
  (value: number): number;
  invert(pixel: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  let [d0, d1] = domain;
  if (!Number.isFinite(d0) || !Number.isFinite(d1)) {
    d0 = 0;
    d1 = 1;
  }
  if (d0 === d1) {
    // Avoid a zero-width domain: widen symmetrically.
    const pad = Math.abs(d0) > 0 ? Math.abs(d0) * 0.05 : 0.5;
    d0 -= pad;
    d1 += pad;
  }
  const [r0, r1] = range;
  // A span can overflow to Infinity even when both ends are finite, for example
  // a domain of [-1e308, 1e308]; the ratio then comes out 0 or NaN and reaches
  // the SVG as `x="NaN"`. Halving every term keeps the same ratio while staying
  // representable, so the mapping is unchanged for ordinary domains.
  const scaleDown = Number.isFinite(d1 - d0) ? 1 : 0.5;
  const lo = d0 * scaleDown;
  const span = d1 * scaleDown - lo;
  const scale = ((value: number) => {
    const t = (value * scaleDown - lo) / span;
    if (!Number.isFinite(t)) {
      // Keep an unusable value inside the plot area rather than emitting
      // invalid geometry.
      return Number.isNaN(value) ? r0 : value > d1 ? r1 : r0;
    }
    const pixel = r0 + t * (r1 - r0);
    return Number.isFinite(pixel) ? pixel : r0;
  }) as LinearScale;
  scale.domain = [d0, d1];
  scale.range = range;
  scale.invert = (pixel: number) => (lo + ((pixel - r0) / (r1 - r0)) * span) / scaleDown;
  return scale;
}

/**
 * "Nice" ticks at 1/2/5 × 10ⁿ steps, as many as fit the requested count.
 */
export function ticks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // Snap tiny floating-point residue to the step grid.
    out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
  }
  return out;
}

/** Integer ticks for discrete axes; never produces fractional categories. */
export function integerTicks(min: number, max: number, count = 8): number[] {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  const span = hi - lo;
  if (span <= 0) return [lo];
  const step = Math.max(1, Math.ceil((span + 1) / count));
  const out: number[] = [];
  for (let v = lo; v <= hi; v += step) out.push(v);
  if (out[out.length - 1] !== hi && out.length < count + 1) out.push(hi);
  return out;
}

/** Compact axis label: 1.2K, 3.4M, 5e-7. */
export function formatTick(value: number, span = 1): string {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6)}M`;
  if (abs >= 1e4) return `${trim(value / 1e3)}K`;
  if (abs < 1e-4) return value.toExponential(1).replace('e+', 'e');
  // Choose decimals from the axis span so neighbouring ticks differ.
  const decimals = span >= 100 ? 0 : span >= 10 ? 1 : span >= 1 ? 2 : span >= 0.1 ? 3 : 4;
  return Number(value.toFixed(decimals)).toString();
}

function trim(v: number): string {
  return Number(v.toFixed(1)).toString();
}

/**
 * Clamp a caller's requested precision into the range `toPrecision` accepts.
 *
 * `digits` here is a count of SIGNIFICANT FIGURES, not decimal places. That
 * distinction is easy to miss, and `toPrecision(0)` throws a RangeError rather
 * than rounding — which took down two whole tool screens through the error
 * boundary, because a caller reasonably read `formatPercent(level, 0)` as "no
 * decimal places". A presentation helper should never be able to do that: the
 * numbers it was given are perfectly good, and only their rendering was
 * over-specified. Clamping is safe for the same reason it would be wrong in
 * the engine — nothing is being computed here, only displayed.
 */
function safeDigits(digits: number): number {
  if (!Number.isFinite(digits)) return 6;
  // 21 is the most significant figures a double can distinguish; beyond that
  // the extra places are noise, and `toPrecision` caps out at 100 anyway.
  return Math.min(21, Math.max(1, Math.round(digits)));
}

/**
 * Full-precision value for tooltips and tables.
 *
 * `digits` is significant figures (see `safeDigits`).
 */
export function formatValue(value: number, digits = 6): string {
  if (Number.isNaN(value)) return 'undefined';
  if (value === Infinity) return '∞';
  if (value === -Infinity) return '−∞';
  if (value === 0) return '0';
  const d = safeDigits(digits);
  const abs = Math.abs(value);
  if (abs >= 1e-4 && abs < 1e12) {
    return Number(value.toPrecision(d)).toLocaleString('en-US', { maximumSignificantDigits: d });
  }
  return value.toExponential(Math.max(1, d - 3)).replace('e+', 'e');
}

export function formatProbability(p: number): string {
  if (Number.isNaN(p)) return 'undefined';
  if (p === 0) return '0';
  if (p === 1) return '1';
  if (p < 1e-4) return p.toExponential(2).replace('e-', '×10⁻');
  return Number(p.toPrecision(4)).toString();
}

/**
 * A probability as a percentage. `digits` is significant figures, not decimal
 * places — `formatPercent(0.95)` gives "95%", and asking for fewer figures
 * than the value has will round it.
 */
export function formatPercent(p: number, digits = 3): string {
  if (Number.isNaN(p)) return 'undefined';
  if (p === 0) return '0%';
  if (p === 1) return '100%';
  const pct = p * 100;
  if (Math.abs(pct) < 1e-3) return `${pct.toExponential(2)}%`;
  return `${Number(pct.toPrecision(safeDigits(digits)))}%`;
}

/** The validated categorical series colours, in fixed order. */
export const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

/**
 * Colour for series index i. Never cycles: beyond the eighth slot the caller
 * must fold the remainder into an "Other" series, so an out-of-range index is
 * a programming error and returns the muted ink rather than a repeat colour.
 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index] ?? 'var(--text-muted)';
}

/** The maximum number of distinct series a chart may show at once. */
export const MAX_SERIES = SERIES_COLORS.length;
/** All-pairs chart forms (scatter, bubble) are capped at three validated slots. */
export const MAX_SERIES_ALL_PAIRS = 3;

/** Texture pattern id for the accessibility channel, by series index. */
export function texturePatternId(index: number): string {
  return `oc-texture-${index % 2 === 0 ? 'a' : 'b'}-${index}`;
}

/** Downsample a long series for drawing while keeping its extremes. */
export function downsample<T>(points: T[], maxPoints: number, valueOf: (p: T) => number): { points: T[]; reduced: boolean } {
  if (points.length <= maxPoints) return { points, reduced: false };
  // Largest-triangle-like simplification: keep bucket min and max so peaks survive.
  const bucketSize = points.length / Math.floor(maxPoints / 2);
  const out: T[] = [];
  for (let b = 0; b < Math.floor(maxPoints / 2); b++) {
    const start = Math.floor(b * bucketSize);
    const end = Math.min(points.length, Math.floor((b + 1) * bucketSize));
    if (end <= start) continue;
    let minI = start;
    let maxI = start;
    for (let i = start; i < end; i++) {
      if (valueOf(points[i]) < valueOf(points[minI])) minI = i;
      if (valueOf(points[i]) > valueOf(points[maxI])) maxI = i;
    }
    const [a, c] = minI <= maxI ? [minI, maxI] : [maxI, minI];
    out.push(points[a]);
    if (c !== a) out.push(points[c]);
  }
  return { points: out, reduced: true };
}
