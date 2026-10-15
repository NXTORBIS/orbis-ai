/**
 * Rolling-origin cross-validation (backtesting) and forecast accuracy metrics.
 *
 * A forecast that cannot beat the naive "last value" or seasonal-naive
 * baseline is worthless, so the baseline comparison is computed and reported
 * on every backtest — it is not optional.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { explain } from './types';
import { fitArima, forecastArima } from './arima';
import { holtWinters, smoothingForecast, ewma, holt } from './decomposition';
import { checkPeriod, checkSeries, meanOf } from './util';

/** A forecaster takes a training series and a horizon and returns h point forecasts. */
export type Forecaster = (train: number[], horizon: number) => number[];

export interface AccuracyMetrics {
  n: number;
  me: number;
  rmse: number;
  mae: number;
  /** null when the actuals contain a zero or near-zero: MAPE is undefined there. */
  mape: number | null;
  mapeRefusal: string | null;
  /** Symmetric MAPE, reported alongside because it at least stays bounded. */
  smape: number | null;
  /** Mean absolute scaled error against the in-sample naive benchmark. */
  mase: number;
  /** The scaling denominator: in-sample mean |y_t − y_{t−m}|. */
  maseScale: number;
  /** m used for the scaling: 1 for naive, the period for seasonal naive. */
  maseSeasonality: number;
}

/**
 * Accuracy metrics for a set of forecasts against their actuals.
 *
 * MAPE is REFUSED, not approximated, when any actual is zero or close to it:
 * the ratio is undefined at zero and explodes near it. MAPE is also
 * asymmetric — it penalises an over-forecast more heavily than an equally
 * wrong under-forecast — so it should not be used to compare methods that are
 * biased in opposite directions.
 */
export function accuracyMetrics(
  actual: ArrayLike<number>,
  forecast: ArrayLike<number>,
  options: { trainingSeries?: ArrayLike<number>; seasonalPeriod?: number; mapeFloor?: number } = {},
): AccuracyMetrics {
  const a = checkSeries(actual, 1, 'actual series');
  const f = checkSeries(forecast, 1, 'forecast series');
  if (a.length !== f.length) {
    throw new EngineError(`There are ${a.length} actual values and ${f.length} forecasts; they must correspond one to one.`, 'length-mismatch');
  }
  const n = a.length;
  const err = a.map((v, i) => v - f[i]);
  const me = meanOf(err);
  const rmse = Math.sqrt(stableSum(err.map((v) => v * v)) / n);
  const mae = stableSum(err.map(Math.abs)) / n;
  const floor = options.mapeFloor ?? 1e-12;
  const zeroAt: number[] = [];
  for (let i = 0; i < n; i++) if (Math.abs(a[i]) <= floor) zeroAt.push(i);
  let mape: number | null = null;
  let mapeRefusal: string | null = null;
  if (zeroAt.length > 0) {
    mapeRefusal =
      `MAPE is undefined: the actual value is zero (or within ${floor} of zero) at index ${zeroAt[0]}` +
      (zeroAt.length > 1 ? ` and ${zeroAt.length - 1} other position(s)` : '') +
      '. Dividing by it would give an infinite or arbitrarily large percentage, so no MAPE is reported. Use MASE or RMSE on this data.';
  } else {
    mape = (100 * stableSum(err.map((v, i) => Math.abs(v / a[i])))) / n;
  }
  const smapeDen = a.map((v, i) => (Math.abs(v) + Math.abs(f[i])) / 2);
  const smape = smapeDen.every((v) => v > floor) ? (100 * stableSum(err.map((v, i) => Math.abs(v) / smapeDen[i]))) / n : null;

  const m = options.seasonalPeriod ?? 1;
  if (!Number.isInteger(m) || m < 1) throw new EngineError(`The MASE seasonality must be a whole number of at least 1 (received ${m}).`, 'range');
  const train = options.trainingSeries ? checkSeries(options.trainingSeries, m + 2, 'training series') : a;
  if (train.length <= m) {
    throw new EngineError(`MASE scaling needs more than ${m} training observations; ${train.length} were supplied.`, 'too-short');
  }
  const diffs: number[] = [];
  for (let t = m; t < train.length; t++) diffs.push(Math.abs(train[t] - train[t - m]));
  const scale = meanOf(diffs);
  if (!(scale > 0)) {
    throw new EngineError(
      `The MASE scaling denominator is zero: the ${m === 1 ? 'naive' : `seasonal-naive (m = ${m})`} benchmark makes no errors at all on the training data, so a scaled error is undefined. The training series is constant or exactly periodic.`,
      'degenerate',
    );
  }
  return { n, me, rmse, mae, mape, mapeRefusal, smape, mase: mae / scale, maseScale: scale, maseSeasonality: m };
}

export interface BacktestFold {
  /** Index of the last training observation. */
  origin: number;
  trainSize: number;
  horizon: number;
  actual: number[];
  forecast: number[];
  errors: number[];
  failure: string | null;
}

export interface BacktestResult {
  method: string;
  horizon: number;
  folds: number;
  /** Folds that could not be fitted, kept visible rather than dropped. */
  failedFolds: number;
  /** Metrics pooled over all folds and horizons. */
  overall: AccuracyMetrics;
  /** Metrics per horizon step, so the degradation with h is visible. */
  byHorizon: { h: number; metrics: AccuracyMetrics }[];
  /** The naive and seasonal-naive baselines on exactly the same folds. */
  baselines: { name: string; overall: AccuracyMetrics }[];
  /** Whether the method beat every baseline on MASE. */
  beatsBaselines: boolean;
  verdict: string;
  foldDetail: BacktestFold[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/** Last-value (random walk) forecaster. */
export const naiveForecaster: Forecaster = (train, horizon) => new Array<number>(horizon).fill(train[train.length - 1]);

/** Seasonal-naive forecaster: repeat the value from one period ago. */
export function seasonalNaiveForecaster(period: number): Forecaster {
  return (train, horizon) => {
    if (train.length < period) throw new EngineError(`The seasonal-naive forecaster needs at least ${period} training observations.`, 'too-short');
    const out = new Array<number>(horizon);
    for (let h = 1; h <= horizon; h++) out[h - 1] = train[train.length - period + ((h - 1) % period)];
    return out;
  };
}

/** Historical-mean forecaster. */
export const meanForecaster: Forecaster = (train, horizon) => new Array<number>(horizon).fill(meanOf(train));

/** Forecaster from an ARIMA fit of fixed order, refitted on every fold. */
export function arimaForecaster(order: { p: number; d: number; q: number; includeMean?: boolean }): Forecaster {
  return (train, horizon) => forecastArima(fitArima(train, order), horizon).point;
}

/** Forecaster from Holt–Winters, refitted on every fold. */
export function holtWintersForecaster(period: number, options: { model?: 'additive' | 'multiplicative' } = {}): Forecaster {
  return (train, horizon) => smoothingForecast(holtWinters(train, period, options), horizon).point;
}

/** Forecaster from simple exponential smoothing, refitted on every fold. */
export const ewmaForecaster: Forecaster = (train, horizon) => smoothingForecast(ewma(train), horizon).point;

/** Forecaster from Holt's linear trend method, refitted on every fold. */
export const holtForecaster: Forecaster = (train, horizon) => smoothingForecast(holt(train), horizon).point;

/**
 * Rolling-origin cross-validation.
 *
 * The origin advances by `step` from `minTrain` to the end, the model is
 * refitted on every fold (refitting matters: a single fit evaluated on later
 * data is not out-of-sample for the parameters), and the same folds are used
 * for the baselines so the comparison is exact.
 */
export function backtest(
  series: ArrayLike<number>,
  forecaster: Forecaster,
  options: { horizon?: number; minTrain?: number; step?: number; seasonalPeriod?: number; methodName?: string; expandingWindow?: boolean; windowSize?: number } = {},
): BacktestResult {
  const horizon = options.horizon ?? 1;
  if (!Number.isInteger(horizon) || horizon < 1) throw new EngineError(`The backtest horizon must be a whole number of at least 1 (received ${horizon}).`, 'range');
  const y = checkSeries(series, horizon + 12, 'series');
  const n = y.length;
  const period = options.seasonalPeriod;
  if (period !== undefined) checkPeriod(period, n);
  const minTrain = options.minTrain ?? Math.max(period !== undefined ? 2 * period + 2 : 10, Math.floor(n / 3));
  if (!Number.isInteger(minTrain) || minTrain < 3) throw new EngineError(`The minimum training size must be a whole number of at least 3 (received ${minTrain}).`, 'range');
  if (minTrain + horizon > n) {
    throw new EngineError(
      `A backtest with a minimum training size of ${minTrain} and a horizon of ${horizon} needs at least ${minTrain + horizon} observations; the series has ${n}. There is nothing to validate on.`,
      'too-short',
    );
  }
  const step = options.step ?? 1;
  if (!Number.isInteger(step) || step < 1) throw new EngineError(`The backtest step must be a whole number of at least 1 (received ${step}).`, 'range');
  const expanding = options.expandingWindow ?? true;
  const windowSize = options.windowSize;
  if (!expanding && (windowSize === undefined || !Number.isInteger(windowSize) || windowSize < minTrain)) {
    throw new EngineError('A rolling (non-expanding) window needs a windowSize of at least minTrain.', 'range');
  }

  const runOne = (fc: Forecaster): { folds: BacktestFold[]; failed: number } => {
    const folds: BacktestFold[] = [];
    let failed = 0;
    for (let origin = minTrain; origin + horizon <= n; origin += step) {
      const start = expanding ? 0 : Math.max(0, origin - (windowSize as number));
      const train = y.slice(start, origin);
      const actual = y.slice(origin, origin + horizon);
      let forecast: number[] | null = null;
      let failure: string | null = null;
      try {
        forecast = fc(train, horizon);
        if (forecast.length !== horizon || forecast.some((v) => !Number.isFinite(v))) {
          failure = `The forecaster returned ${forecast.length} value(s), or a non-finite value, at origin ${origin}.`;
          forecast = null;
        }
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (forecast === null) {
        failed++;
        folds.push({ origin, trainSize: train.length, horizon, actual, forecast: [], errors: [], failure });
      } else {
        folds.push({ origin, trainSize: train.length, horizon, actual, forecast, errors: actual.map((v, i) => v - forecast[i]), failure: null });
      }
    }
    return { folds, failed };
  };

  const main = runOne(forecaster);
  const usable = main.folds.filter((f) => f.failure === null);
  if (usable.length === 0) {
    throw new EngineError(
      `Every one of the ${main.folds.length} backtest folds failed. First reason: ${main.folds[0]?.failure ?? 'unknown'}. No accuracy figures are reported.`,
      'non-convergence',
    );
  }
  const pool = (folds: BacktestFold[]): { actual: number[]; forecast: number[] } => {
    const actual: number[] = [];
    const forecast: number[] = [];
    for (const f of folds) {
      if (f.failure !== null) continue;
      actual.push(...f.actual);
      forecast.push(...f.forecast);
    }
    return { actual, forecast };
  };
  const trainForScale = y.slice(0, minTrain);
  const metricsFor = (folds: BacktestFold[], m: number): AccuracyMetrics => {
    const { actual, forecast } = pool(folds);
    return accuracyMetrics(actual, forecast, { trainingSeries: trainForScale, seasonalPeriod: m });
  };
  const maseM = period ?? 1;
  const overall = metricsFor(usable, maseM);
  const byHorizon: { h: number; metrics: AccuracyMetrics }[] = [];
  for (let h = 1; h <= horizon; h++) {
    const sliced = usable.map((f) => ({ ...f, actual: [f.actual[h - 1]], forecast: [f.forecast[h - 1]] }));
    byHorizon.push({ h, metrics: metricsFor(sliced, maseM) });
  }
  const baselineSpecs: { name: string; fc: Forecaster }[] = [
    { name: 'naive (last value)', fc: naiveForecaster },
    { name: 'historical mean', fc: meanForecaster },
  ];
  if (period !== undefined) baselineSpecs.push({ name: `seasonal naive (m = ${period})`, fc: seasonalNaiveForecaster(period) });
  const baselines: { name: string; overall: AccuracyMetrics }[] = [];
  for (const spec of baselineSpecs) {
    const r = runOne(spec.fc);
    const u = r.folds.filter((f) => f.failure === null);
    if (u.length === 0) continue;
    baselines.push({ name: spec.name, overall: metricsFor(u, maseM) });
  }
  const beats = baselines.every((b) => overall.mase < b.overall.mase);
  const methodName = options.methodName ?? 'the supplied forecaster';
  const bestBaseline = baselines.reduce<{ name: string; overall: AccuracyMetrics } | null>((acc, b) => (acc === null || b.overall.mase < acc.overall.mase ? b : acc), null);
  const verdict = beats
    ? `${methodName} beats every baseline out of sample: MASE ${overall.mase.toFixed(4)} against ${baselines.map((b) => `${b.name} ${b.overall.mase.toFixed(4)}`).join(', ')}.`
    : `${methodName} does NOT beat ${bestBaseline ? bestBaseline.name : 'the baseline'} out of sample: MASE ${overall.mase.toFixed(4)} against ${bestBaseline ? bestBaseline.overall.mase.toFixed(4) : 'n/a'}. On this evidence the model adds no forecasting value over simply ${bestBaseline?.name.startsWith('naive') ? 'repeating the last observation' : `using the ${bestBaseline?.name} rule`}, and reporting it as a forecast would be misleading.`;
  const warnings: string[] = [
    `A MASE of 1 means the method is exactly as accurate as the in-sample ${maseM === 1 ? 'naive' : 'seasonal-naive'} benchmark. Above 1 is worse than naive.`,
  ];
  if (overall.mapeRefusal) warnings.push(overall.mapeRefusal);
  if (overall.mape !== null) {
    warnings.push('MAPE is asymmetric: it penalises an over-forecast more than an equally large under-forecast, and it explodes as the actual approaches zero. Use MASE for comparisons across series.');
  }
  if (main.failed > 0) warnings.push(`${main.failed} of ${main.folds.length} folds failed to fit and were excluded from the metrics. Their reasons are in foldDetail.`);
  if (usable.length < 10) warnings.push(`Only ${usable.length} usable folds: the accuracy estimates are themselves very noisy, and a MASE difference of less than roughly ${(1 / Math.sqrt(usable.length)).toFixed(2)} should not be read as a real difference.`);
  if (horizon > 1) warnings.push('Overlapping folds share observations, so the fold errors are correlated and the pooled metrics are more precise-looking than they are.');
  return {
    method: methodName,
    horizon,
    folds: usable.length,
    failedFolds: main.failed,
    overall,
    byHorizon,
    baselines,
    beatsBaselines: beats,
    verdict,
    foldDetail: main.folds,
    explanation: explain('Rolling-origin cross-validation with refitting at every origin', 'empirical', {
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Minimum training size', value: String(minTrain) },
        { label: 'Window', value: expanding ? 'expanding' : `rolling, ${windowSize} observations` },
        { label: 'Origins', value: String(main.folds.length) },
        { label: 'Usable folds', value: String(usable.length) },
        { label: 'Horizon', value: String(horizon) },
        { label: 'RMSE / MAE / MASE', value: `${overall.rmse.toFixed(6)} / ${overall.mae.toFixed(6)} / ${overall.mase.toFixed(6)}` },
        { label: 'MAPE', value: overall.mape === null ? 'refused (zero in the actuals)' : `${overall.mape.toFixed(4)}%` },
        ...baselines.map((b) => ({ label: `baseline: ${b.name}`, value: `MASE ${b.overall.mase.toFixed(6)}, RMSE ${b.overall.rmse.toFixed(6)}` })),
      ],
      assumptions: [
        'The model is refitted at every origin, so the metrics reflect the whole procedure (order selection excepted, if the order was chosen on the full sample — that leaks).',
        'The future resembles the backtest period. A backtest cannot detect a change that has not happened yet.',
      ],
      limitations: [
        'Folds overlap, so the errors are not independent and the metrics have fewer effective degrees of freedom than the fold count suggests.',
        'If the model order or any transform was chosen using the whole series, the backtest is optimistically biased.',
        'MAPE is undefined at zero and asymmetric; MASE is the scale-free metric to prefer.',
      ],
    }),
    warnings,
  };
}
