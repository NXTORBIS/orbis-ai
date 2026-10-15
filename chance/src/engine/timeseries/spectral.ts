/**
 * Spectral analysis: FFT, periodogram, Welch's method and dominant-period
 * identification. This is what answers "is there a cycle, and how long is it?"
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { explain } from './types';
import { checkSeries, meanOf } from './util';

/** Largest series length the direct O(n²) DFT is allowed to handle. */
export const MAX_DIRECT_DFT = 4096;

/**
 * In-place iterative radix-2 Cooley–Tukey FFT. `re` and `im` must have a
 * length that is a power of two. Transform convention:
 *   X_k = Σ_t x_t e^{−2πi k t / n}
 */
export function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (im.length !== n) throw new EngineError('Internal: FFT real and imaginary parts differ in length.', 'invalid');
  if (n < 2 || (n & (n - 1)) !== 0) throw new EngineError(`The radix-2 FFT needs a power-of-two length (received ${n}).`, 'range');
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Direct O(n²) DFT, used when n is not a power of two. */
export function directDft(x: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const n = x.length;
  if (n > MAX_DIRECT_DFT) {
    throw new EngineError(
      `The series length ${n} is not a power of two, so the transform would fall back to a direct DFT costing O(n²) = ${n * n} operations. ` +
        `The limit is ${MAX_DIRECT_DFT}. Trim or pad the series to a power of two (and note that padding changes the periodogram), or analyse a shorter window.`,
      'too-large',
    );
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let sr = 0;
    let si = 0;
    for (let t = 0; t < n; t++) {
      const ang = (-2 * Math.PI * k * t) / n;
      sr += x[t] * Math.cos(ang);
      si += x[t] * Math.sin(ang);
    }
    re[k] = sr;
    im[k] = si;
  }
  return { re, im };
}

/** Transform of a real series by FFT when possible, direct DFT otherwise. */
export function dft(x: ArrayLike<number>): { re: Float64Array; im: Float64Array; route: 'fft' | 'direct' } {
  const n = x.length;
  if (n >= 2 && (n & (n - 1)) === 0) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = x[i];
    fftRadix2(re, im);
    return { re, im, route: 'fft' };
  }
  const d = directDft(x);
  return { ...d, route: 'direct' };
}

export interface PeriodogramResult {
  /** Fourier frequencies in cycles per observation, j/n for j = 1..⌊n/2⌋. */
  frequency: number[];
  /** Periods in observations, 1/frequency. */
  period: number[];
  /** I(f_j) = |Σ (x_t − x̄) e^{−2πi j t/n}|² / n. */
  power: number[];
  /** Σ_{j=1}^{n−1} I(f_j) over the full circle, which equals Σ (x_t − x̄)². */
  totalPower: number;
  /** Population variance of the series: totalPower / n (Parseval). */
  variance: number;
  dominant: { frequency: number; period: number; power: number; shareOfVariance: number };
  /** Which transform route was used. */
  route: 'fft' | 'direct';
  n: number;
  detrended: boolean;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Raw periodogram of a series, mean-removed (and optionally linearly
 * detrended, because a trend puts enormous power at the lowest frequencies and
 * swamps any real cycle).
 *
 * Parseval's identity holds exactly here: summing the power over all n Fourier
 * frequencies returns Σ (x_t − x̄)², so `totalPower / n` is the population
 * variance. The test suite asserts this to 1e-10 as an FFT correctness check.
 */
export function periodogram(series: ArrayLike<number>, options: { detrend?: boolean } = {}): PeriodogramResult {
  const x0 = checkSeries(series, 4, 'series');
  const n = x0.length;
  const detrend = options.detrend ?? false;
  let x: number[];
  if (detrend) {
    // Least-squares line removal, done in closed form.
    const tbar = (n - 1) / 2;
    const ybar = meanOf(x0);
    let sxy = 0;
    let sxx = 0;
    for (let t = 0; t < n; t++) {
      sxy += (t - tbar) * (x0[t] - ybar);
      sxx += (t - tbar) * (t - tbar);
    }
    const slope = sxx > 0 ? sxy / sxx : 0;
    x = x0.map((v, t) => v - (ybar + slope * (t - tbar)));
  } else {
    const m = meanOf(x0);
    x = x0.map((v) => v - m);
  }
  const { re, im, route } = dft(x);
  const full = new Array<number>(n);
  for (let k = 0; k < n; k++) full[k] = (re[k] * re[k] + im[k] * im[k]) / n;
  const totalPower = stableSum(full.slice(1));
  const half = Math.floor(n / 2);
  if (half < 1) throw new EngineError('The series is too short to have any Fourier frequency other than zero.', 'too-short');
  const frequency: number[] = [];
  const period: number[] = [];
  const power: number[] = [];
  for (let j = 1; j <= half; j++) {
    frequency.push(j / n);
    period.push(n / j);
    power.push(full[j]);
  }
  let bi = 0;
  for (let i = 1; i < power.length; i++) if (power[i] > power[bi]) bi = i;
  const variance = totalPower / n;
  // A frequency strictly inside (0, 0.5) appears twice on the full circle.
  const isNyquist = Math.abs(frequency[bi] - 0.5) < 1e-12;
  const dominantPower = power[bi] * (isNyquist ? 1 : 2);
  const warnings: string[] = [];
  if (!detrend) warnings.push('The series was only mean-removed. A trend concentrates power at the lowest frequencies and can mask or imitate a cycle; pass detrend: true to remove a linear trend first.');
  if (route === 'direct') warnings.push(`n = ${n} is not a power of two, so a direct O(n²) DFT was used. The result is identical to the FFT, just slower.`);
  warnings.push(`The periodogram resolves periods only at n/j for whole j, so the available periods near the peak are ${period[Math.max(0, bi - 1)].toFixed(2)}, ${period[bi].toFixed(2)} and ${period[Math.min(period.length - 1, bi + 1)].toFixed(2)} observations. A true period between two of these cannot be distinguished.`);
  warnings.push('The raw periodogram is an inconsistent estimator of the spectral density: its variance does not fall as n grows, only its resolution improves. For a smooth spectrum estimate use Welch\'s method.');
  return {
    frequency,
    period,
    power,
    totalPower,
    variance,
    dominant: {
      frequency: frequency[bi],
      period: period[bi],
      power: power[bi],
      shareOfVariance: totalPower > 0 ? dominantPower / totalPower : 0,
    },
    route,
    n,
    detrended: detrend,
    explanation: explain('Raw periodogram via the discrete Fourier transform', 'numerical', {
      formula: 'I(f_j) = |Σ_t (x_t − x̄) e^{−2πi j t/n}|² / n,  f_j = j/n',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Transform route', value: route === 'fft' ? 'radix-2 FFT' : 'direct DFT' },
        { label: 'Total power (= Σ(x_t − x̄)²)', value: totalPower.toExponential(8) },
        { label: 'Implied variance (Parseval)', value: variance.toExponential(8) },
        { label: 'Dominant period', value: `${period[bi].toFixed(4)} observations` },
        { label: 'Share of variance at the dominant frequency', value: ((totalPower > 0 ? dominantPower / totalPower : 0) * 100).toFixed(2) + '%' },
      ],
      assumptions: [
        'The series is evenly spaced; the frequency axis is in cycles per observation, so converting to real time needs the sampling interval.',
        'Periods longer than the series cannot be seen at all, and periods shorter than 2 observations are aliased.',
      ],
      limitations: [
        'A single large periodogram ordinate is not by itself evidence of a cycle: under white noise the ordinates are exponentially distributed, so the largest of ⌊n/2⌋ of them is routinely several times the mean.',
        'Resolution is fixed at 1/n in frequency; neighbouring true cycles are not separable.',
      ],
    }),
    warnings,
  };
}

export interface WelchResult {
  frequency: number[];
  period: number[];
  /** Averaged power spectral density over the overlapping segments. */
  power: number[];
  segments: number;
  segmentLength: number;
  overlap: number;
  dominant: { frequency: number; period: number; power: number };
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Welch's method: average the periodograms of overlapping, Hann-windowed
 * segments. This trades frequency resolution for a much lower variance, which
 * is what makes the resulting spectrum estimate consistent.
 */
export function welch(
  series: ArrayLike<number>,
  options: { segmentLength?: number; overlap?: number } = {},
): WelchResult {
  const x0 = checkSeries(series, 16, 'series');
  const n = x0.length;
  const m = meanOf(x0);
  const x = x0.map((v) => v - m);
  const segLen = options.segmentLength ?? Math.max(8, Math.pow(2, Math.floor(Math.log2(n / 4))));
  if (!Number.isInteger(segLen) || segLen < 4) {
    throw new EngineError(`The Welch segment length must be a whole number of at least 4 (received ${segLen}).`, 'range');
  }
  if (segLen > n) {
    throw new EngineError(`The Welch segment length (${segLen}) exceeds the series length (${n}).`, 'range');
  }
  if ((segLen & (segLen - 1)) !== 0 && segLen > MAX_DIRECT_DFT) {
    throw new EngineError(`The Welch segment length ${segLen} is neither a power of two nor within the direct-DFT limit.`, 'too-large');
  }
  const overlap = options.overlap ?? 0.5;
  if (!(overlap >= 0 && overlap < 1)) throw new EngineError(`The Welch overlap must be in [0, 1) (received ${overlap}).`, 'range');
  const step = Math.max(1, Math.round(segLen * (1 - overlap)));
  const half = Math.floor(segLen / 2);
  const acc = new Array<number>(half).fill(0);
  // Hann window and its power, needed to normalise the density.
  const w = new Array<number>(segLen);
  for (let i = 0; i < segLen; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (segLen - 1)));
  const wPow = stableSum(w.map((v) => v * v));
  let segments = 0;
  for (let start = 0; start + segLen <= n; start += step) {
    const seg = new Array<number>(segLen);
    const segMean = meanOf(x.slice(start, start + segLen));
    for (let i = 0; i < segLen; i++) seg[i] = (x[start + i] - segMean) * w[i];
    const { re, im } = dft(seg);
    for (let j = 1; j <= half; j++) acc[j - 1] += (re[j] * re[j] + im[j] * im[j]) / wPow;
    segments++;
  }
  if (segments === 0) {
    throw new EngineError(`No complete segment of length ${segLen} fits in a series of ${n} observations.`, 'too-short');
  }
  const power = acc.map((v) => v / segments);
  const frequency: number[] = [];
  const period: number[] = [];
  for (let j = 1; j <= half; j++) {
    frequency.push(j / segLen);
    period.push(segLen / j);
  }
  let bi = 0;
  for (let i = 1; i < power.length; i++) if (power[i] > power[bi]) bi = i;
  return {
    frequency,
    period,
    power,
    segments,
    segmentLength: segLen,
    overlap,
    dominant: { frequency: frequency[bi], period: period[bi], power: power[bi] },
    explanation: explain("Welch's averaged periodogram (Hann window)", 'numerical', {
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Segment length', value: String(segLen) },
        { label: 'Segments averaged', value: String(segments) },
        { label: 'Overlap', value: `${(overlap * 100).toFixed(0)}%` },
        { label: 'Dominant period', value: `${period[bi].toFixed(4)} observations` },
      ],
      assumptions: ['Each segment is treated as a realisation of the same stationary process; a structural break inside the series violates this.'],
      limitations: [
        `Frequency resolution is 1/${segLen} rather than 1/${n}: the price of the reduced variance. Cycles longer than ${segLen} observations cannot be seen.`,
        'Overlapping segments are not independent, so the effective number of averages is smaller than the segment count.',
        'The Hann window leaks a little power into neighbouring frequencies.',
      ],
    }),
    warnings: segments < 4 ? [`Only ${segments} segments were averaged; the variance reduction is small. A longer series or a shorter segment would help.`] : [],
  };
}

export interface DominantPeriodResult {
  period: number;
  frequency: number;
  /** Share of the total variance at the dominant frequency. */
  shareOfVariance: number;
  /** Fisher's g statistic: the peak ordinate divided by the sum of all ordinates. */
  fisherG: number;
  /** Exact p-value for Fisher's test of a single periodicity in Gaussian white noise. */
  fisherPValue: number;
  /** The strongest few candidate periods, so a near-tie is visible. */
  candidates: { period: number; power: number; shareOfVariance: number }[];
  interpretation: string;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Identify the dominant period and test it with Fisher's g test, whose exact
 * null distribution under Gaussian white noise is
 *   P(g > x) = Σ_{j=1..⌊1/x⌋} (−1)^{j−1} C(m, j) (1 − j x)^{m−1}
 * with m the number of periodogram ordinates. Without such a test a large
 * peak means little: the maximum of m exponential variables is large by
 * construction.
 */
export function dominantPeriod(series: ArrayLike<number>, options: { detrend?: boolean; topK?: number } = {}): DominantPeriodResult {
  const pg = periodogram(series, { detrend: options.detrend ?? true });
  const topK = options.topK ?? 5;
  const m = pg.power.length;
  const total = stableSum(pg.power);
  if (!(total > 0)) throw new EngineError('The periodogram has zero total power; the series carries no variation to decompose.', 'degenerate');
  const order = pg.power.map((p, i) => [p, i] as [number, number]).sort((a, b) => b[0] - a[0]);
  const peak = order[0];
  const g = peak[0] / total;
  // Fisher's exact tail.
  let tail = 0;
  const jMax = Math.min(m, Math.floor(1 / g));
  for (let j = 1; j <= jMax; j++) {
    let logC = 0;
    for (let i = 0; i < j; i++) logC += Math.log(m - i) - Math.log(i + 1);
    const term = Math.exp(logC + (m - 1) * Math.log1p(-j * g));
    tail += (j % 2 === 1 ? 1 : -1) * term;
  }
  const pValue = Math.min(1, Math.max(0, tail));
  const candidates = order.slice(0, topK).map(([p, i]) => ({
    period: pg.period[i],
    power: p,
    shareOfVariance: p / total,
  }));
  const warnings = [...pg.warnings];
  if (candidates.length > 1 && candidates[1].power > 0.8 * candidates[0].power) {
    warnings.push(`The second strongest period (${candidates[1].period.toFixed(2)}) has ${((candidates[1].power / candidates[0].power) * 100).toFixed(0)}% of the peak's power. The dominant period is not clearly identified; treat the top candidates as equally plausible.`);
  }
  return {
    period: pg.period[peak[1]],
    frequency: pg.frequency[peak[1]],
    shareOfVariance: peak[0] / total,
    fisherG: g,
    fisherPValue: pValue,
    candidates,
    interpretation:
      pValue < 0.05
        ? `A cycle of about ${pg.period[peak[1]].toFixed(2)} observations is present (Fisher's g = ${g.toFixed(4)}, p = ${pValue.toExponential(3)}). It accounts for ${((peak[0] / total) * 100).toFixed(1)}% of the periodogram power.`
        : `No periodicity is established: the largest peak (period ${pg.period[peak[1]].toFixed(2)}) is within what white noise produces by chance (Fisher's g = ${g.toFixed(4)}, p = ${pValue.toFixed(4)}). Reporting this period as a cycle would be reading noise.`,
    explanation: explain("Dominant period from the periodogram with Fisher's exact g test", 'numerical', {
      formula: "g = max_j I(f_j) / Σ_j I(f_j)",
      steps: [
        ...pg.explanation.steps,
        { label: "Fisher's g", value: g.toFixed(6) },
        { label: 'Exact p-value under Gaussian white noise', value: pValue.toExponential(6) },
      ],
      assumptions: ["Fisher's test assumes Gaussian white noise under the null. Against an autocorrelated null it over-rejects, because a smooth spectrum already has a peak."],
      limitations: [
        'The test looks for ONE periodicity at a Fourier frequency. A cycle whose period is not n/j for whole j is split across neighbouring ordinates and the test loses power.',
        ...pg.explanation.limitations,
      ],
    }),
    warnings,
  };
}
