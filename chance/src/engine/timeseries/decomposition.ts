/**
 * Decomposition and smoothing: classical additive/multiplicative
 * decomposition, a loess-based STL, moving averages, EWMA, Holt's linear and
 * Holt–Winters seasonal smoothing with SSE optimisation, and the
 * Hodrick–Prescott filter.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { explain, FORECAST_CAVEATS, type TsInterval } from './types';
import { centredMovingAverage } from './stationarity';
import { checkPeriod, checkSeries, meanOf, minimise, zQuantile } from './util';

export type DecompositionModel = 'additive' | 'multiplicative';

export interface DecompositionResult {
  model: DecompositionModel;
  period: number;
  /** Trend-cycle; null where the centred moving-average window does not fit. */
  trend: (number | null)[];
  /** Seasonal component, repeating with `period`. */
  seasonal: number[];
  /** Remainder; null wherever the trend is null. */
  remainder: (number | null)[];
  /** The seasonal pattern by position within the cycle (one full cycle). */
  seasonalPattern: number[];
  /** Share of the detrended variance explained by the seasonal component. */
  seasonalStrength: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Classical decomposition.
 *
 * additive:        y_t = T_t + S_t + R_t
 * multiplicative:  y_t = T_t × S_t × R_t
 *
 * The trend is a centred moving average of order `period` (a 2×m average when
 * m is even, so the window is centred on an observation). The seasonal
 * component is the average detrended value at each position in the cycle,
 * centred to sum to 0 (additive) or average to 1 (multiplicative).
 *
 * The components reconstruct the series exactly wherever the trend is defined;
 * at the ⌊period/2⌋ observations at each end the moving average has no window,
 * and the trend is reported as null rather than extrapolated.
 */
export function classicalDecomposition(
  series: ArrayLike<number>,
  period: number,
  options: { model?: DecompositionModel } = {},
): DecompositionResult {
  const model = options.model ?? 'additive';
  const y = checkSeries(series, 3, 'series');
  const n = y.length;
  checkPeriod(period, n);
  if (n < 2 * period) {
    throw new EngineError(
      `Classical decomposition needs at least two complete cycles: ${2 * period} observations for a period of ${period}, but n = ${n}.`,
      'too-short',
    );
  }
  if (model === 'multiplicative') {
    for (let i = 0; i < n; i++) {
      if (!(y[i] > 0)) {
        throw new EngineError(
          `A multiplicative decomposition needs strictly positive observations; index ${i} is ${y[i]}. Use the additive model, or transform the series.`,
          'domain',
        );
      }
    }
  }
  const trend = centredMovingAverage(y, period);
  const detrended: (number | null)[] = y.map((v, t) => {
    const tr = trend[t];
    if (tr === null) return null;
    if (model === 'multiplicative') {
      if (!(Math.abs(tr) > 0)) {
        throw new EngineError(`The trend is zero at index ${t}, so a multiplicative seasonal ratio is undefined there.`, 'degenerate');
      }
      return v / tr;
    }
    return v - tr;
  });
  const sums = new Array<number>(period).fill(0);
  const counts = new Array<number>(period).fill(0);
  for (let t = 0; t < n; t++) {
    const d = detrended[t];
    if (d === null) continue;
    sums[t % period] += d;
    counts[t % period] += 1;
  }
  for (let s = 0; s < period; s++) {
    if (counts[s] === 0) {
      throw new EngineError(
        `No detrended observation is available for position ${s} of the ${period}-step cycle, so its seasonal value cannot be estimated. The series is too short relative to the period.`,
        'too-short',
      );
    }
  }
  let pattern = sums.map((s, i) => s / counts[i]);
  if (model === 'additive') {
    const m = meanOf(pattern);
    pattern = pattern.map((v) => v - m);
  } else {
    const m = meanOf(pattern);
    if (!(m > 0)) throw new EngineError('The average seasonal ratio is not positive; a multiplicative decomposition cannot be normalised.', 'degenerate');
    pattern = pattern.map((v) => v / m);
  }
  const seasonal = y.map((_, t) => pattern[t % period]);
  const remainder: (number | null)[] = y.map((v, t) => {
    const tr = trend[t];
    if (tr === null) return null;
    return model === 'additive' ? v - tr - seasonal[t] : v / (tr * seasonal[t]);
  });
  const dd = detrended.filter((v): v is number => v !== null);
  const rr: number[] = [];
  for (let t = 0; t < n; t++) {
    const r = remainder[t];
    if (r !== null) rr.push(model === 'additive' ? r : r - 1);
  }
  const varD = dd.length > 1 ? stableSum(dd.map((v) => (v - meanOf(dd)) * (v - meanOf(dd)))) / dd.length : 0;
  const varR = rr.length > 1 ? stableSum(rr.map((v) => (v - meanOf(rr)) * (v - meanOf(rr)))) / rr.length : 0;
  const strength = varD > 0 ? Math.max(0, 1 - varR / varD) : 0;
  const lost = Math.floor(period / 2);
  return {
    model,
    period,
    trend,
    seasonal,
    remainder,
    seasonalPattern: pattern,
    seasonalStrength: strength,
    explanation: explain(`Classical ${model} decomposition with a centred ${period}-period moving average`, 'empirical', {
      formula: model === 'additive' ? 'y_t = T_t + S_t + R_t' : 'y_t = T_t × S_t × R_t',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Period', value: String(period) },
        { label: 'Trend undefined at each end', value: `${lost} observations` },
        { label: 'Seasonal strength', value: strength.toFixed(4) },
      ],
      assumptions: [
        'The seasonal pattern is the same in every cycle. Classical decomposition cannot represent a seasonal shape that changes over time — use STL for that.',
        'The trend is smooth on the scale of one period.',
      ],
      limitations: [
        `The trend and remainder are undefined for the first and last ${lost} observations; they are reported as null rather than filled in.`,
        'A single extreme observation distorts the seasonal average for its position in the cycle; classical decomposition is not robust.',
        'The components reconstruct the series exactly wherever the trend is defined; this is an algebraic identity, not a fitted model.',
      ],
    }),
    warnings: n < 3 * period ? [`Only ${(n / period).toFixed(1)} cycles are available; each seasonal value is an average of about ${Math.floor(n / period)} observations and is correspondingly noisy.`] : [],
  };
}

/**
 * Local regression (loess) smoother on the integer index, degree 0 or 1, with
 * tricube weights over the `span` nearest neighbours. Used by STL.
 */
export function loess(y: number[], span: number, degree: 0 | 1 = 1, weights?: number[]): number[] {
  const n = y.length;
  if (!Number.isInteger(span) || span < 2) throw new EngineError(`The loess span must be a whole number of at least 2 (received ${span}).`, 'range');
  const q = Math.min(span, n);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    // Nearest q indices around i.
    let lo = Math.max(0, i - Math.floor((q - 1) / 2));
    let hi = lo + q - 1;
    if (hi > n - 1) {
      hi = n - 1;
      lo = Math.max(0, hi - q + 1);
    }
    const h = Math.max(Math.abs(i - lo), Math.abs(i - hi), 1e-12);
    let sw = 0;
    let swx = 0;
    let swy = 0;
    let swxx = 0;
    let swxy = 0;
    for (let j = lo; j <= hi; j++) {
      const u = Math.abs(j - i) / h;
      let w = u >= 1 ? 0 : Math.pow(1 - u * u * u, 3);
      if (weights) w *= weights[j];
      if (w <= 0) continue;
      const x = j - i;
      sw += w;
      swx += w * x;
      swy += w * y[j];
      swxx += w * x * x;
      swxy += w * x * y[j];
    }
    if (!(sw > 0)) {
      out[i] = y[i];
      continue;
    }
    if (degree === 0) {
      out[i] = swy / sw;
      continue;
    }
    const det = sw * swxx - swx * swx;
    if (Math.abs(det) < 1e-12 * (Math.abs(sw * swxx) + 1)) {
      out[i] = swy / sw;
    } else {
      // Fitted value at x = 0 is the intercept.
      out[i] = (swxx * swy - swx * swxy) / det;
    }
  }
  return out;
}

export interface StlResult {
  period: number;
  trend: number[];
  seasonal: number[];
  remainder: number[];
  /** Inner loop iterations and robustness iterations actually run. */
  innerIterations: number;
  robustIterations: number;
  seasonalStrength: number;
  trendStrength: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * STL: seasonal-trend decomposition by loess (Cleveland et al. 1990),
 * additive only.
 *
 * This is a faithful but simplified implementation of the inner loop:
 * cycle-subseries smoothing, a low-pass filter (m, m, 3 moving averages
 * followed by a linear loess) removed from the smoothed subseries to give the
 * seasonal component, then a loess on the deseasonalised series for the trend.
 * Robustness iterations reweight by the remainder with the bisquare function.
 *
 * Unlike classical decomposition, STL allows the seasonal shape to change
 * slowly over time and defines the trend at every observation including the
 * endpoints.
 */
export function stl(
  series: ArrayLike<number>,
  period: number,
  options: { seasonalSpan?: number; trendSpan?: number; lowPassSpan?: number; innerIterations?: number; robustIterations?: number } = {},
): StlResult {
  const y = checkSeries(series, 3, 'series');
  const n = y.length;
  checkPeriod(period, n);
  if (n < 2 * period) {
    throw new EngineError(`STL needs at least two complete cycles (${2 * period} observations for a period of ${period}); n = ${n}.`, 'too-short');
  }
  const odd = (v: number): number => (v % 2 === 0 ? v + 1 : v);
  // Default: a 7-point loess on each cycle-subseries, which lets the seasonal
  // shape drift slowly. A larger span forces it closer to a fixed pattern.
  const seasonalSpan = options.seasonalSpan ?? 7;
  const trendSpan = options.trendSpan ?? odd(Math.ceil((1.5 * period) / (1 - 1.5 / seasonalSpan)));
  const lowPassSpan = options.lowPassSpan ?? odd(period);
  const inner = options.innerIterations ?? 2;
  const robust = options.robustIterations ?? 0;
  if (!Number.isInteger(inner) || inner < 1) throw new EngineError('STL needs at least one inner iteration.', 'range');
  if (!Number.isInteger(robust) || robust < 0) throw new EngineError('The number of STL robustness iterations must be non-negative.', 'range');

  let trend = new Array<number>(n).fill(0);
  let seasonal = new Array<number>(n).fill(0);
  let rw: number[] | undefined;
  const ma = (v: number[], k: number): number[] => {
    // Trailing-centred moving average, shortening the window at the ends so
    // the output keeps full length.
    const out = new Array<number>(v.length).fill(0);
    const h = Math.floor(k / 2);
    for (let i = 0; i < v.length; i++) {
      let s = 0;
      let c = 0;
      for (let j = i - h; j <= i + h; j++) {
        if (j < 0 || j >= v.length) continue;
        s += v[j];
        c++;
      }
      out[i] = s / c;
    }
    return out;
  };
  for (let r = 0; r <= robust; r++) {
    for (let it = 0; it < inner; it++) {
      // 1. Detrend.
      const detrended = y.map((v, t) => v - trend[t]);
      // 2. Smooth each cycle-subseries.
      const smoothedSub = new Array<number>(n).fill(0);
      for (let s = 0; s < period; s++) {
        const idx: number[] = [];
        for (let t = s; t < n; t += period) idx.push(t);
        const sub = idx.map((t) => detrended[t]);
        const subW = rw ? idx.map((t) => (rw as number[])[t]) : undefined;
        const sm = loess(sub, Math.min(seasonalSpan, sub.length), 1, subW);
        for (let i = 0; i < idx.length; i++) smoothedSub[idx[i]] = sm[i];
      }
      // 3. Low-pass filter of the smoothed subseries, then remove it.
      const lp = loess(ma(ma(ma(smoothedSub, period), period), 3), Math.min(lowPassSpan, n), 1);
      seasonal = smoothedSub.map((v, t) => v - lp[t]);
      // 4. Deseasonalise and smooth for the trend.
      const deseason = y.map((v, t) => v - seasonal[t]);
      trend = loess(deseason, Math.min(trendSpan, n), 1, rw);
    }
    if (r < robust) {
      const rem = y.map((v, t) => v - trend[t] - seasonal[t]);
      const absRem = rem.map(Math.abs).sort((a, b) => a - b);
      const h = 6 * absRem[Math.floor(absRem.length / 2)];
      rw = rem.map((v) => {
        if (!(h > 0)) return 1;
        const u = Math.abs(v) / h;
        return u >= 1 ? 0 : Math.pow(1 - u * u, 2);
      });
    }
  }
  const remainder = y.map((v, t) => v - trend[t] - seasonal[t]);
  const varOf = (v: number[]): number => {
    const m = meanOf(v);
    return stableSum(v.map((u) => (u - m) * (u - m))) / v.length;
  };
  const varR = varOf(remainder);
  const seasonalStrength = Math.max(0, 1 - varR / Math.max(varOf(remainder.map((v, t) => v + seasonal[t])), 1e-300));
  const trendStrength = Math.max(0, 1 - varR / Math.max(varOf(remainder.map((v, t) => v + trend[t])), 1e-300));
  return {
    period,
    trend,
    seasonal,
    remainder,
    innerIterations: inner,
    robustIterations: robust,
    seasonalStrength,
    trendStrength,
    explanation: explain('STL: seasonal-trend decomposition by loess (simplified inner loop, additive)', 'empirical', {
      formula: 'y_t = T_t + S_t + R_t, with T and S fitted by local regression',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Period', value: String(period) },
        { label: 'Seasonal loess span', value: String(seasonalSpan) },
        { label: 'Trend loess span', value: String(trendSpan) },
        { label: 'Inner iterations', value: String(inner) },
        { label: 'Robustness iterations', value: String(robust) },
        { label: 'Seasonal strength', value: seasonalStrength.toFixed(4) },
        { label: 'Trend strength', value: trendStrength.toFixed(4) },
      ],
      assumptions: ['Additive components. For multiplicative behaviour, decompose the log of the series.', 'The seasonal shape changes only slowly, at the rate the seasonal span allows.'],
      limitations: [
        'This is a simplified STL: the cycle-subseries are not extended one period beyond each end before smoothing, so the seasonal component is slightly less stable at the endpoints than in the reference implementation.',
        'The spans are tuning parameters. A short seasonal span lets the seasonal component absorb noise; a long one forces it to be constant.',
        'The decomposition is descriptive. It is not a model and produces no forecast or prediction interval on its own.',
      ],
    }),
    warnings: n < 3 * period ? [`Only ${(n / period).toFixed(1)} cycles are available; STL has little to work with and the seasonal component will be poorly determined.`] : [],
  };
}

/** Simple trailing moving average of order k; null until the window fills. */
export function movingAverage(series: ArrayLike<number>, k: number, options: { centred?: boolean } = {}): (number | null)[] {
  const y = checkSeries(series, 2, 'series');
  if (!Number.isInteger(k) || k < 2) throw new EngineError(`The moving-average order must be a whole number of at least 2 (received ${k}).`, 'range');
  if (k > y.length) throw new EngineError(`The moving-average order (${k}) exceeds the series length (${y.length}).`, 'range');
  if (options.centred) return centredMovingAverage(y, k);
  const out = new Array<number | null>(y.length).fill(null);
  for (let t = k - 1; t < y.length; t++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += y[t - j];
    out[t] = s / k;
  }
  return out;
}

export interface SmoothingResult {
  method: string;
  /** Fitted one-step-ahead predictions, aligned with the observations. */
  fitted: number[];
  /** One-step-ahead errors y_t − ŷ_{t|t−1}. */
  residuals: number[];
  sse: number;
  /** Parameters actually used, with whether they were optimised. */
  parameters: { name: string; value: number; optimised: boolean }[];
  /** Final state, for forecasting. */
  level: number;
  trend: number | null;
  seasonal: number[] | null;
  period: number | null;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}
function logit(p: number): number {
  const q = Math.min(0.999999, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
}

/**
 * Exponentially weighted moving average (simple exponential smoothing).
 * ℓ_t = α y_t + (1 − α) ℓ_{t−1}; the forecast is flat at ℓ_n.
 */
export function ewma(series: ArrayLike<number>, options: { alpha?: number } = {}): SmoothingResult {
  const y = checkSeries(series, 4, 'series');
  const n = y.length;
  const run = (alpha: number): { fitted: number[]; residuals: number[]; sse: number; level: number } => {
    let l = y[0];
    const fitted = new Array<number>(n);
    const residuals = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      fitted[t] = l;
      residuals[t] = y[t] - l;
      l = alpha * y[t] + (1 - alpha) * l;
    }
    return { fitted, residuals, sse: stableSum(residuals.map((v) => v * v)), level: l };
  };
  let alpha: number;
  let optimised: boolean;
  if (options.alpha !== undefined) {
    if (!(options.alpha > 0 && options.alpha <= 1)) throw new EngineError(`α must be in (0, 1] (received ${options.alpha}).`, 'range');
    alpha = options.alpha;
    optimised = false;
  } else {
    const res = minimise((z) => run(logistic(z[0])).sse, [logit(0.3)]);
    if (!res.converged) {
      throw new EngineError('The exponential-smoothing optimiser did not converge on a value of α; no smoothed series is reported.', 'non-convergence');
    }
    alpha = logistic(res.x[0]);
    optimised = true;
  }
  const out = run(alpha);
  return {
    method: 'Simple exponential smoothing (EWMA)',
    fitted: out.fitted,
    residuals: out.residuals,
    sse: out.sse,
    parameters: [{ name: 'alpha', value: alpha, optimised }],
    level: out.level,
    trend: null,
    seasonal: null,
    period: null,
    explanation: explain('Simple exponential smoothing with α by SSE minimisation', 'numerical', {
      formula: 'ℓ_t = α y_t + (1 − α) ℓ_{t−1},  ŷ_{n+h} = ℓ_n',
      steps: [
        { label: 'α', value: alpha.toFixed(6) },
        { label: 'One-step SSE', value: out.sse.toExponential(6) },
        { label: 'Final level', value: out.level.toFixed(6) },
      ],
      assumptions: ['No trend and no seasonality: the forecast function is a horizontal line.', 'α is fitted by minimising the in-sample one-step SSE, not by maximising a likelihood.'],
      limitations: ['α near 1 means the smoother is tracking noise; α near 0 means it is ignoring recent data.', ...FORECAST_CAVEATS],
    }),
    warnings: alpha > 0.95 ? [`α = ${alpha.toFixed(3)} is almost 1, so the smoother is essentially the last observation — the naive forecast. That is a sign there is no smoothable structure.`] : [],
  };
}

/** Holt's linear trend method, with α and β by SSE minimisation. */
export function holt(
  series: ArrayLike<number>,
  options: { alpha?: number; beta?: number; damped?: boolean; phi?: number } = {},
): SmoothingResult {
  const y = checkSeries(series, 6, 'series');
  const n = y.length;
  const damped = options.damped ?? false;
  const run = (alpha: number, beta: number, phi: number) => {
    let l = y[0];
    let b = y[1] - y[0];
    const fitted = new Array<number>(n);
    const residuals = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      const f = l + phi * b;
      fitted[t] = f;
      residuals[t] = y[t] - f;
      const lPrev = l;
      l = alpha * y[t] + (1 - alpha) * (lPrev + phi * b);
      b = beta * (l - lPrev) + (1 - beta) * phi * b;
    }
    return { fitted, residuals, sse: stableSum(residuals.map((v) => v * v)), level: l, trend: b };
  };
  const fixedAlpha = options.alpha;
  const fixedBeta = options.beta;
  const fixedPhi = options.phi;
  for (const [name, v] of [['alpha', fixedAlpha], ['beta', fixedBeta], ['phi', fixedPhi]] as [string, number | undefined][]) {
    if (v !== undefined && !(v > 0 && v <= 1)) throw new EngineError(`${name} must be in (0, 1] (received ${v}).`, 'range');
  }
  const freeNames: string[] = [];
  if (fixedAlpha === undefined) freeNames.push('alpha');
  if (fixedBeta === undefined) freeNames.push('beta');
  if (damped && fixedPhi === undefined) freeNames.push('phi');
  const pack = (z: number[]): [number, number, number] => {
    let i = 0;
    const a = fixedAlpha ?? logistic(z[i++]);
    const b = fixedBeta ?? logistic(z[i++]);
    const p = damped ? (fixedPhi ?? 0.8 + 0.199 * logistic(z[i++])) : (fixedPhi ?? 1);
    return [a, b, p];
  };
  let alpha: number;
  let beta: number;
  let phi: number;
  if (freeNames.length === 0) {
    [alpha, beta, phi] = pack([]);
  } else {
    const start = freeNames.map((nm) => (nm === 'phi' ? 0 : logit(nm === 'alpha' ? 0.3 : 0.1)));
    const res = minimise((z) => {
      const [a, b, p] = pack(z);
      return run(a, b, p).sse;
    }, start);
    if (!res.converged) {
      throw new EngineError("Holt's method did not converge on smoothing parameters; no fit is reported.", 'non-convergence');
    }
    [alpha, beta, phi] = pack(res.x);
  }
  const out = run(alpha, beta, phi);
  return {
    method: damped ? "Holt's linear trend method (damped)" : "Holt's linear trend method",
    fitted: out.fitted,
    residuals: out.residuals,
    sse: out.sse,
    parameters: [
      { name: 'alpha', value: alpha, optimised: fixedAlpha === undefined },
      { name: 'beta', value: beta, optimised: fixedBeta === undefined },
      ...(damped ? [{ name: 'phi', value: phi, optimised: fixedPhi === undefined }] : []),
    ],
    level: out.level,
    trend: out.trend,
    seasonal: null,
    period: null,
    explanation: explain("Holt's linear trend exponential smoothing, parameters by SSE minimisation", 'numerical', {
      formula: 'ℓ_t = α y_t + (1−α)(ℓ_{t−1} + φ b_{t−1}) ;  b_t = β(ℓ_t − ℓ_{t−1}) + (1−β) φ b_{t−1}',
      steps: [
        { label: 'α', value: alpha.toFixed(6) },
        { label: 'β', value: beta.toFixed(6) },
        ...(damped ? [{ label: 'φ', value: phi.toFixed(6) }] : []),
        { label: 'One-step SSE', value: out.sse.toExponential(6) },
      ],
      assumptions: ['A local linear trend with no seasonality.'],
      limitations: [
        damped ? 'The damped trend flattens the forecast as the horizon grows, which is usually safer than an indefinitely extrapolated line.' : 'An undamped linear trend extrapolates indefinitely. Over a long horizon this is almost always too confident; consider the damped variant.',
        ...FORECAST_CAVEATS,
      ],
    }),
    warnings: [],
  };
}

/**
 * Holt–Winters seasonal exponential smoothing, additive or multiplicative,
 * with α, β and γ chosen by minimising the in-sample one-step SSE.
 */
export function holtWinters(
  series: ArrayLike<number>,
  period: number,
  options: { model?: DecompositionModel; alpha?: number; beta?: number; gamma?: number; damped?: boolean } = {},
): SmoothingResult {
  const model = options.model ?? 'additive';
  const y = checkSeries(series, 3, 'series');
  const n = y.length;
  checkPeriod(period, n);
  if (n < 2 * period + 2) {
    throw new EngineError(
      `Holt–Winters needs at least two complete cycles plus a little slack: ${2 * period + 2} observations for a period of ${period}, but n = ${n}.`,
      'too-short',
    );
  }
  if (model === 'multiplicative') {
    for (let i = 0; i < n; i++) {
      if (!(y[i] > 0)) {
        throw new EngineError(`Multiplicative Holt–Winters needs strictly positive observations; index ${i} is ${y[i]}.`, 'domain');
      }
    }
  }
  // Initial state from the first two cycles.
  const first = y.slice(0, period);
  const second = y.slice(period, 2 * period);
  const l0 = meanOf(first);
  const b0 = (meanOf(second) - l0) / period;
  const s0 = first.map((v) => (model === 'additive' ? v - l0 : v / l0));
  if (model === 'additive') {
    const sm = meanOf(s0);
    for (let i = 0; i < period; i++) s0[i] -= sm;
  } else {
    const sm = meanOf(s0);
    if (!(sm > 0)) throw new EngineError('The initial multiplicative seasonal factors do not average to a positive number.', 'degenerate');
    for (let i = 0; i < period; i++) s0[i] /= sm;
  }
  const damped = options.damped ?? false;
  const run = (alpha: number, beta: number, gamma: number, phi: number) => {
    let l = l0;
    let b = b0;
    const s = [...s0];
    const fitted = new Array<number>(n);
    const residuals = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      const si = s[t % period];
      const base = l + phi * b;
      const f = model === 'additive' ? base + si : base * si;
      fitted[t] = f;
      residuals[t] = y[t] - f;
      const lPrev = l;
      if (model === 'additive') {
        l = alpha * (y[t] - si) + (1 - alpha) * base;
        s[t % period] = gamma * (y[t] - base) + (1 - gamma) * si;
      } else {
        if (!(Math.abs(si) > 1e-12) || !(Math.abs(base) > 1e-12)) return null;
        l = alpha * (y[t] / si) + (1 - alpha) * base;
        s[t % period] = gamma * (y[t] / base) + (1 - gamma) * si;
      }
      b = beta * (l - lPrev) + (1 - beta) * phi * b;
    }
    return { fitted, residuals, sse: stableSum(residuals.map((v) => v * v)), level: l, trend: b, seasonal: s };
  };
  const fixed = { alpha: options.alpha, beta: options.beta, gamma: options.gamma };
  for (const [name, v] of Object.entries(fixed)) {
    if (v !== undefined && !(v > 0 && v <= 1)) throw new EngineError(`${name} must be in (0, 1] (received ${v}).`, 'range');
  }
  const free: ('alpha' | 'beta' | 'gamma' | 'phi')[] = [];
  if (fixed.alpha === undefined) free.push('alpha');
  if (fixed.beta === undefined) free.push('beta');
  if (fixed.gamma === undefined) free.push('gamma');
  if (damped) free.push('phi');
  const pack = (z: number[]): [number, number, number, number] => {
    let i = 0;
    const a = fixed.alpha ?? logistic(z[i++]);
    const b = fixed.beta ?? logistic(z[i++]);
    const g = fixed.gamma ?? logistic(z[i++]);
    const p = damped ? 0.8 + 0.199 * logistic(z[i++]) : 1;
    return [a, b, g, p];
  };
  let params: [number, number, number, number];
  if (free.length === 0) {
    params = pack([]);
  } else {
    const start = free.map((nm) => (nm === 'phi' ? 0 : logit(nm === 'alpha' ? 0.3 : 0.1)));
    const res = minimise((z) => {
      const [a, b, g, p] = pack(z);
      const r = run(a, b, g, p);
      return r === null ? 1e300 : r.sse;
    }, start, { maxIter: 1200 });
    if (!res.converged || !Number.isFinite(res.fx) || res.fx >= 1e299) {
      throw new EngineError(
        'Holt–Winters did not converge on smoothing parameters (the multiplicative recursion may have hit a near-zero level or seasonal factor). No fit is reported.',
        'non-convergence',
      );
    }
    params = pack(res.x);
  }
  const out = run(params[0], params[1], params[2], params[3]);
  if (out === null) {
    throw new EngineError('The Holt–Winters recursion broke down (a zero level or seasonal factor). No fit is reported.', 'numerical');
  }
  return {
    method: `Holt–Winters ${model} seasonal exponential smoothing${damped ? ', damped trend' : ''}`,
    fitted: out.fitted,
    residuals: out.residuals,
    sse: out.sse,
    parameters: [
      { name: 'alpha', value: params[0], optimised: fixed.alpha === undefined },
      { name: 'beta', value: params[1], optimised: fixed.beta === undefined },
      { name: 'gamma', value: params[2], optimised: fixed.gamma === undefined },
      ...(damped ? [{ name: 'phi', value: params[3], optimised: true }] : []),
    ],
    level: out.level,
    trend: out.trend,
    seasonal: out.seasonal,
    period,
    explanation: explain(`Holt–Winters ${model} seasonal smoothing, parameters by SSE minimisation`, 'numerical', {
      formula:
        model === 'additive'
          ? 'ŷ_{t+h} = ℓ_t + h b_t + s_{t+h−m⌈h/m⌉}'
          : 'ŷ_{t+h} = (ℓ_t + h b_t) · s_{t+h−m⌈h/m⌉}',
      steps: [
        { label: 'Period', value: String(period) },
        { label: 'Cycles available', value: (n / period).toFixed(2) },
        { label: 'α', value: params[0].toFixed(6) },
        { label: 'β', value: params[1].toFixed(6) },
        { label: 'γ', value: params[2].toFixed(6) },
        ...(damped ? [{ label: 'φ', value: params[3].toFixed(6) }] : []),
        { label: 'One-step SSE', value: out.sse.toExponential(6) },
      ],
      assumptions: [
        'The seasonal period is known and fixed. Supplying the wrong period makes the fit meaningless; identify it from the periodogram if unsure.',
        'Parameters are chosen by in-sample SSE, so they are optimistic about out-of-sample accuracy. Backtest before trusting them.',
      ],
      limitations: [
        'The initial level, trend and seasonal values come from the first two cycles and are not optimised; with few cycles they influence the fit noticeably.',
        'SSE minimisation is not maximum likelihood, so the parameter estimates carry no standard errors here.',
        ...FORECAST_CAVEATS,
      ],
    }),
    warnings: n < 3 * period ? [`Only ${(n / period).toFixed(1)} cycles are available; the seasonal component is poorly determined.`] : [],
  };
}

export interface SmoothingForecast {
  horizon: number;
  point: number[];
  /** Innovation-variance-only intervals, from the in-sample residual variance. */
  intervals: TsInterval[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Forecast from a fitted smoothing model. Intervals use the in-sample
 * residual standard deviation grown by the method's own variance expansion,
 * and are labelled as innovation-only: they do NOT include uncertainty in
 * α, β, γ, which SSE minimisation leaves unquantified.
 */
export function smoothingForecast(fit: SmoothingResult, horizon: number, level = 0.95): SmoothingForecast {
  if (!Number.isInteger(horizon) || horizon < 1) throw new EngineError(`The forecast horizon must be a whole number of at least 1 (received ${horizon}).`, 'range');
  if (!(level > 0 && level < 1)) throw new EngineError(`The interval level must be between 0 and 1 (received ${level}).`, 'range');
  const alpha = fit.parameters.find((p) => p.name === 'alpha')?.value ?? 0.3;
  const beta = fit.parameters.find((p) => p.name === 'beta')?.value ?? 0;
  const phi = fit.parameters.find((p) => p.name === 'phi')?.value ?? 1;
  const n = fit.residuals.length;
  const k = fit.parameters.length;
  if (n <= k) throw new EngineError(`The fitted model has ${n} residuals for ${k} parameters; no residual variance can be estimated.`, 'too-short');
  const sigma2 = stableSum(fit.residuals.map((v) => v * v)) / (n - k);
  const point = new Array<number>(horizon);
  const m = fit.period;
  for (let h = 1; h <= horizon; h++) {
    let damp = 0;
    for (let i = 1; i <= h; i++) damp += Math.pow(phi, i);
    const base = fit.level + (fit.trend !== null ? damp * fit.trend : 0);
    if (m !== null && fit.seasonal !== null) {
      const s = fit.seasonal[(n + h - 1) % m];
      point[h - 1] = fit.method.includes('multiplicative') ? base * s : base + s;
    } else {
      point[h - 1] = base;
    }
  }
  const z = zQuantile(0.5 + level / 2);
  const intervals: TsInterval[] = [];
  const hasTrend = fit.trend !== null;
  for (let h = 1; h <= horizon; h++) {
    // Variance expansion for the additive-error state-space form of these
    // methods: ETS(A,N,N) gives σ²[1 + (h−1)α²] and ETS(A,A,N) gives
    // σ²[1 + Σ_{j=1}^{h−1}(α + jβ)²] (Hyndman et al. 2008).
    let c = 1;
    for (let j = 1; j < h; j++) {
      const w = hasTrend ? alpha + j * beta * (phi === 1 ? 1 : (1 - Math.pow(phi, j)) / (j * (1 - phi))) : alpha;
      c += w * w;
    }
    const sd = Math.sqrt(sigma2 * c);
    intervals.push({
      low: point[h - 1] - z * sd,
      high: point[h - 1] + z * sd,
      level,
      of: `the observation ${h} step(s) ahead (innovation variance only)`,
      method: 'in-sample residual variance expanded by the smoothing recursion; excludes uncertainty in the smoothing parameters',
      kind: 'outcomes',
    });
  }
  return {
    horizon,
    point,
    intervals,
    explanation: explain(`Forecast from ${fit.method}`, 'numerical', {
      steps: [
        { label: 'Horizon', value: String(horizon) },
        { label: 'Residual standard deviation', value: Math.sqrt(sigma2).toExponential(6) },
        { label: 'Interval level', value: `${(level * 100).toFixed(0)}%` },
      ],
      assumptions: [
        'The smoothing parameters are treated as known. Their estimation uncertainty is NOT in these intervals.',
        'The innovations are homoskedastic and uncorrelated. Check the residuals before using the intervals.',
      ],
      limitations: [
        'These are innovation-only intervals. Compare the arima forecast, which reports both an innovation-only and a parameter-uncertainty interval.',
        ...FORECAST_CAVEATS,
      ],
    }),
    warnings: [
      `The forecast horizon is ${horizon} step(s). Beyond a few periods a smoothing forecast is essentially an extrapolation of the current state and the interval understates the real risk.`,
    ],
  };
}

export interface HpFilterResult {
  lambda: number;
  trend: number[];
  cycle: number[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Hodrick–Prescott filter: minimise Σ (y_t − τ_t)² + λ Σ (Δ²τ_t)², i.e. solve
 * the pentadiagonal system (I + λ D′D) τ = y where D is the second-difference
 * matrix. Solved with a banded Cholesky, so the cost is linear in n.
 */
export function hodrickPrescott(series: ArrayLike<number>, options: { lambda?: number } = {}): HpFilterResult {
  const y = checkSeries(series, 5, 'series');
  const n = y.length;
  const lambda = options.lambda ?? 1600;
  if (!(lambda > 0) || !Number.isFinite(lambda)) throw new EngineError(`The HP smoothing parameter λ must be a positive finite number (received ${lambda}).`, 'range');
  // Band storage: a[i][k] = A[i][i+k] for k = 0,1,2 (symmetric).
  const a: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
  // Upper triangle only: the symmetric partner of each entry is implied by the
  // accessor below. Adding both would double every off-diagonal element.
  const add = (i: number, j: number, v: number): void => {
    if (i < 0 || j < 0 || i >= n || j >= n || i > j) return;
    const k = j - i;
    if (k <= 2) a[i][k] += v;
  };
  for (let i = 0; i < n; i++) add(i, i, 1);
  // Rows of D: τ_{t} − 2τ_{t+1} + τ_{t+2} for t = 0..n-3.
  for (let t = 0; t + 2 < n; t++) {
    const idx = [t, t + 1, t + 2];
    const c = [1, -2, 1];
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) add(idx[p], idx[q], lambda * c[p] * c[q]);
  }
  // Banded Cholesky, L[i][i-k] stored at l[i][k], k = 0..2.
  const l: number[][] = Array.from({ length: n }, () => [0, 0, 0]);
  const L = (i: number, j: number): number => {
    const k = i - j;
    return k >= 0 && k <= 2 ? l[i][k] : 0;
  };
  const A = (i: number, j: number): number => {
    const lo = Math.min(i, j);
    const k = Math.abs(i - j);
    return k <= 2 ? a[lo][k] : 0;
  };
  for (let i = 0; i < n; i++) {
    for (let j = Math.max(0, i - 2); j <= i; j++) {
      let s = A(i, j);
      for (let k = Math.max(0, i - 2); k < j; k++) s -= L(i, k) * L(j, k);
      if (j === i) {
        if (!(s > 0)) throw new EngineError(`The HP filter system is not positive definite at row ${i}; no trend can be reported.`, 'numerical');
        l[i][0] = Math.sqrt(s);
      } else {
        l[i][i - j] = s / l[j][0];
      }
    }
  }
  // Forward and back substitution.
  const z = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = y[i];
    for (let k = Math.max(0, i - 2); k < i; k++) s -= L(i, k) * z[k];
    z[i] = s / l[i][0];
  }
  const trend = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = z[i];
    for (let k = i + 1; k <= Math.min(n - 1, i + 2); k++) s -= L(k, i) * trend[k];
    trend[i] = s / l[i][0];
  }
  const cycle = y.map((v, i) => v - trend[i]);
  return {
    lambda,
    trend,
    cycle,
    explanation: explain('Hodrick–Prescott filter (banded Cholesky solution)', 'exact', {
      formula: 'min_τ Σ (y_t − τ_t)² + λ Σ (τ_{t+2} − 2τ_{t+1} + τ_t)²  ⇒  (I + λ D′D) τ = y',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'λ', value: String(lambda) },
        { label: 'Cycle standard deviation', value: Math.sqrt(stableSum(cycle.map((v) => v * v)) / n).toExponential(6) },
      ],
      assumptions: ['λ is a choice, not an estimate. The conventional values (1600 quarterly, 129600 monthly, 6.25 annual) are conventions.'],
      limitations: [
        'The HP filter has severe end-point bias: the first and last few trend values move substantially when new data arrive.',
        'It can create spurious cycles in series that have none (Hamilton 2018). Treat the "cycle" as a filtered residual, not as an economic cycle.',
        'The solution is the exact minimiser of the stated objective, so it is exact given λ — but the objective itself embodies a strong smoothness assumption.',
      ],
    }),
    warnings: ['The HP filter is not a forecasting model and the end-point values are unreliable; do not interpret the most recent trend points as settled.'],
  };
}
