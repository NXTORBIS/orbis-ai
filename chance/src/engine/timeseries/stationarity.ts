/**
 * Stationarity: Augmented Dickey–Fuller, KPSS, Phillips–Perron, differencing
 * and variance-stabilising transforms.
 *
 * ADF and KPSS have OPPOSITE null hypotheses, and the correct practice is to
 * run both and read the four possible combinations. `stationarityVerdict`
 * below does exactly that, including the two inconclusive cells that a single
 * test would hide.
 *
 * The ADF and Phillips–Perron critical values are NOT quantiles of a normal or
 * t distribution — under a unit root the t-ratio has a non-standard
 * (Dickey–Fuller) limiting distribution. The values used here come from
 * MacKinnon's response-surface regressions and are interpolated in the sample
 * size, which is why every such result is labelled `numerical` and says so.
 */
import { EngineError } from '../core/result';
import { brentRoot, stableSum } from '../core/numeric';
import { explain, type TsTestResult } from './types';
import { checkPeriod, checkSeries, meanOf, ols, studentTTwoSided } from './util';

export type AdfSpecification = 'none' | 'constant' | 'constant-trend';

/**
 * MacKinnon (1996) response-surface coefficients for the τ statistic:
 * critical value = b0 + b1/T + b2/T² + b3/T³, where T is the number of
 * observations used in the ADF regression.
 */
const MACKINNON: Record<AdfSpecification, Record<string, [number, number, number, number]>> = {
  none: {
    '0.01': [-2.5658, -1.96, -10.04, 0],
    '0.05': [-1.9393, -0.398, 0, 0],
    '0.1': [-1.6156, -0.181, 0, 0],
  },
  constant: {
    '0.01': [-3.4336, -5.999, -29.25, 0],
    '0.05': [-2.8621, -2.738, -8.36, 0],
    '0.1': [-2.567, -1.438, -4.48, 0],
  },
  'constant-trend': {
    '0.01': [-3.9638, -8.353, -47.44, 0],
    '0.05': [-3.4126, -4.039, -17.83, 0],
    '0.1': [-3.1279, -2.418, -7.58, 0],
  },
};

function mackinnonCritical(spec: AdfSpecification, level: number, t: number): number {
  const key = String(level);
  const c = MACKINNON[spec][key];
  if (!c) throw new EngineError(`No tabulated Dickey–Fuller critical value for level ${level}.`, 'unsupported');
  return c[0] + c[1] / t + c[2] / (t * t) + c[3] / (t * t * t);
}

/** Bracket the p-value from the three tabulated levels; never invent a number. */
function tabulatedBracket(stat: number, cv: { level: number; value: number }[]): { p: number | null; bracket: string } {
  // Critical values are increasingly negative as the level falls.
  const sorted = [...cv].sort((a, b) => a.level - b.level); // 0.01, 0.05, 0.10
  if (stat <= sorted[0].value) return { p: null, bracket: 'p < 0.01' };
  if (stat >= sorted[sorted.length - 1].value) return { p: null, bracket: 'p > 0.10' };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (stat > a.value && stat < b.value) {
      // Linear interpolation in the statistic between two tabulated levels.
      const w = (stat - a.value) / (b.value - a.value);
      const p = a.level + w * (b.level - a.level);
      return { p, bracket: `${a.level} < p < ${b.level} (interpolated: ${p.toFixed(4)})` };
    }
  }
  return { p: null, bracket: 'p could not be bracketed from the table' };
}

export interface AdfResult extends TsTestResult {
  specification: AdfSpecification;
  /** Lag order of the augmentation actually used. */
  lags: number;
  /** Table of information-criterion values over the candidate lag orders. */
  lagSelection: { lags: number; aic: number; bic: number; chosen: boolean }[] | null;
  /** Estimated γ in Δy_t = ... + γ y_{t−1} + ... (0 under a unit root). */
  gamma: number;
  /** Implied largest autoregressive root, 1 + γ. */
  impliedRoot: number;
  observationsUsed: number;
}

/**
 * Augmented Dickey–Fuller test.
 *
 * Regression: Δy_t = α + δt + γ y_{t−1} + Σ_{i=1..p} c_i Δy_{t−i} + ε_t
 * Statistic: the t-ratio on γ. Under H₀ (γ = 0, i.e. a unit root) that ratio
 * does NOT follow a t distribution, so the MacKinnon table is used.
 *
 * Lag order p is chosen by AIC or BIC over 0..maxLags with a fixed sample (the
 * same observations for every candidate), which is required for the criteria
 * to be comparable.
 */
export function augmentedDickeyFuller(
  series: ArrayLike<number>,
  options: { specification?: AdfSpecification; lags?: number; maxLags?: number; criterion?: 'aic' | 'bic' } = {},
): AdfResult {
  const spec = options.specification ?? 'constant';
  const criterion = options.criterion ?? 'aic';
  const y = checkSeries(series, 12, 'series');
  const n = y.length;
  // Schwert's rule for the upper lag bound.
  const maxLagsDefault = Math.floor(Math.pow((n - 1) / 100, 0.25) * 12);
  const deterministic = spec === 'none' ? 0 : spec === 'constant' ? 1 : 2;
  const maxLagsCap = Math.max(0, n - 4 - deterministic - 2);
  const maxLags = Math.min(options.maxLags ?? maxLagsDefault, maxLagsCap);
  if (options.lags !== undefined && (!Number.isInteger(options.lags) || options.lags < 0)) {
    throw new EngineError(`The ADF lag order must be a non-negative whole number (received ${options.lags}).`, 'range');
  }
  if (options.lags !== undefined && options.lags > maxLagsCap) {
    throw new EngineError(
      `An ADF regression with ${options.lags} augmentation lags needs more observations than the ${n} available (at most ${maxLagsCap} lags fit).`,
      'too-short',
    );
  }

  const build = (p: number): { rows: number[][]; dy: number[]; start: number } => {
    const d = new Array<number>(n - 1);
    for (let t = 1; t < n; t++) d[t - 1] = y[t] - y[t - 1];
    // Δy_t for t = p+1 .. n-1 (0-based on d: index t-1)
    const rows: number[][] = [];
    const dyOut: number[] = [];
    for (let t = p + 1; t < n; t++) {
      const row: number[] = [];
      if (spec !== 'none') row.push(1);
      if (spec === 'constant-trend') row.push(t);
      row.push(y[t - 1]);
      for (let i = 1; i <= p; i++) row.push(d[t - 1 - i]);
      rows.push(row);
      dyOut.push(d[t - 1]);
    }
    return { rows, dy: dyOut, start: p + 1 };
  };

  let chosenLags: number;
  let lagSelection: AdfResult['lagSelection'] = null;
  if (options.lags !== undefined) {
    chosenLags = options.lags;
  } else {
    // Fixed sample across candidates: always use t = maxLags+1 .. n-1.
    const fixedStart = maxLags + 1;
    const table: { lags: number; aic: number; bic: number; chosen: boolean }[] = [];
    for (let p = 0; p <= maxLags; p++) {
      const full = build(p);
      const offset = fixedStart - full.start;
      const rows = full.rows.slice(offset);
      const dy = full.dy.slice(offset);
      if (rows.length <= rows[0].length) continue;
      let fit;
      try {
        fit = ols(rows, dy);
      } catch {
        continue;
      }
      const m = rows.length;
      const k = rows[0].length;
      const ll = -0.5 * m * (Math.log(2 * Math.PI) + Math.log(fit.rss / m) + 1);
      table.push({ lags: p, aic: -2 * ll + 2 * k, bic: -2 * ll + Math.log(m) * k, chosen: false });
    }
    if (table.length === 0) {
      throw new EngineError(
        `No ADF regression could be fitted: with n = ${n} observations and the "${spec}" specification there are not enough usable rows.`,
        'too-short',
      );
    }
    let best = table[0];
    for (const row of table) if ((criterion === 'aic' ? row.aic : row.bic) < (criterion === 'aic' ? best.aic : best.bic)) best = row;
    best.chosen = true;
    chosenLags = best.lags;
    lagSelection = table;
  }

  const { rows, dy } = build(chosenLags);
  const fit = ols(rows, dy);
  const gammaIndex = deterministic;
  const gamma = fit.beta[gammaIndex];
  const seGamma = fit.se[gammaIndex];
  if (!(seGamma > 0)) {
    throw new EngineError('The ADF regression produced a zero standard error on the lagged level; no statistic can be reported.', 'numerical');
  }
  const tau = gamma / seGamma;
  const t = fit.n;
  const criticalValues = [0.01, 0.05, 0.1].map((l) => ({ level: l, value: mackinnonCritical(spec, l, t) }));
  const { p, bracket } = tabulatedBracket(tau, criticalValues);
  const reject = criticalValues.map((c) => ({ level: c.level, reject: tau < c.value }));
  const reject5 = reject.find((r) => r.level === 0.05)?.reject ?? false;
  const specLabel = spec === 'none' ? 'no deterministic terms' : spec === 'constant' ? 'a constant' : 'a constant and a linear trend';
  const warnings: string[] = [];
  if (n < 50) warnings.push(`With n = ${n} the ADF test has very low power; failing to reject a unit root here is close to uninformative.`);
  if (spec === 'none') warnings.push('With no constant the test assumes the series has zero mean under both hypotheses. That is rarely true of real data.');
  if (chosenLags === maxLags && options.lags === undefined && maxLags > 0) {
    warnings.push(`The information criterion chose the largest candidate lag (${maxLags}); the true lag order may be higher than the search allowed.`);
  }
  return {
    name: 'Augmented Dickey–Fuller',
    statistic: tau,
    df: null,
    pValue: p,
    pValueBracket: bracket,
    criticalValues,
    rejectAt: reject,
    specification: spec,
    lags: chosenLags,
    lagSelection,
    gamma,
    impliedRoot: 1 + gamma,
    observationsUsed: t,
    nullHypothesis: 'The series has a unit root (it is non-stationary; γ = 0).',
    alternative:
      spec === 'constant-trend'
        ? 'The series is stationary around a linear trend.'
        : spec === 'constant'
          ? 'The series is stationary around a non-zero mean.'
          : 'The series is stationary around zero.',
    interpretation: reject5
      ? `τ = ${tau.toFixed(4)} is below the 5% critical value ${criticalValues[1].value.toFixed(4)}: the unit root is rejected, so the series looks stationary (${specLabel}).`
      : `τ = ${tau.toFixed(4)} is not below the 5% critical value ${criticalValues[1].value.toFixed(4)}: the unit root is NOT rejected. That is a failure to reject, not evidence of a unit root — the ADF test has notoriously low power against a root near but below 1.`,
    explanation: explain('Augmented Dickey–Fuller unit-root test with MacKinnon critical values', 'numerical', {
      formula: 'Δy_t = α + δt + γ y_{t−1} + Σ c_i Δy_{t−i} + ε_t ;  τ = γ̂ / se(γ̂)',
      steps: [
        { label: 'Specification', value: specLabel },
        { label: 'Augmentation lags', value: String(chosenLags) },
        { label: 'Lag chosen by', value: options.lags !== undefined ? 'user' : criterion.toUpperCase() },
        { label: 'Observations in the regression', value: String(t) },
        { label: 'γ̂', value: gamma.toExponential(6) },
        { label: 'Implied largest AR root', value: (1 + gamma).toFixed(6) },
        { label: 'τ statistic', value: tau.toFixed(6) },
      ],
      assumptions: [
        'The augmentation lags are enough to leave the regression errors serially uncorrelated. Check the residuals with Ljung–Box.',
        `The deterministic specification is "${spec}". The critical values change substantially between the three specifications, so choosing the wrong one changes the conclusion.`,
      ],
      limitations: [
        'The critical values are MacKinnon response-surface values interpolated in the sample size. They are tabulated approximations, not exact quantiles, and the distribution they approximate is the Dickey–Fuller one — a normal or t quantile would be flatly wrong here.',
        'Only three significance levels are tabulated, so the p-value is reported as a bracket (and, between tabulated points, a linear interpolation) rather than a precise figure.',
        'The ADF test has low power: a root of 0.95 is very hard to distinguish from 1.0 in a few hundred observations. Pair it with KPSS.',
        'A structural break in the mean or trend makes the ADF test fail to reject even for a stationary series.',
      ],
    }),
    warnings,
  };
}

export type KpssSpecification = 'level' | 'trend';

/** Kwiatkowski–Phillips–Schmidt–Shin (1992) Table 1 critical values. */
const KPSS_CRIT: Record<KpssSpecification, { level: number; value: number }[]> = {
  level: [
    { level: 0.01, value: 0.739 },
    { level: 0.025, value: 0.574 },
    { level: 0.05, value: 0.463 },
    { level: 0.1, value: 0.347 },
  ],
  trend: [
    { level: 0.01, value: 0.216 },
    { level: 0.025, value: 0.176 },
    { level: 0.05, value: 0.146 },
    { level: 0.1, value: 0.119 },
  ],
};

export interface KpssResult extends TsTestResult {
  specification: KpssSpecification;
  /** Newey–West bandwidth (Bartlett kernel) used for the long-run variance. */
  bandwidth: number;
  longRunVariance: number;
}

/**
 * KPSS test. The null is STATIONARITY — the opposite of ADF — so a small
 * p-value here means non-stationarity, the reverse of the ADF reading.
 *
 * η = n⁻² Σ_t S_t² / σ̂²_LR, where S_t are the partial sums of the residuals
 * from a regression on a constant (level) or a constant and trend (trend), and
 * σ̂²_LR is a Bartlett-kernel long-run variance estimate.
 */
export function kpss(series: ArrayLike<number>, options: { specification?: KpssSpecification; bandwidth?: number } = {}): KpssResult {
  const spec = options.specification ?? 'level';
  const y = checkSeries(series, 12, 'series');
  const n = y.length;
  const bandwidth = options.bandwidth ?? Math.floor(4 * Math.pow(n / 100, 0.25));
  if (!Number.isInteger(bandwidth) || bandwidth < 0 || bandwidth >= n) {
    throw new EngineError(`The KPSS bandwidth must be a whole number in [0, ${n - 1}] (received ${bandwidth}).`, 'range');
  }
  let e: number[];
  if (spec === 'level') {
    const m = meanOf(y);
    e = y.map((v) => v - m);
  } else {
    const rows = y.map((_, t) => [1, t + 1]);
    e = ols(rows, y).residuals;
  }
  const s = new Array<number>(n);
  let run = 0;
  for (let t = 0; t < n; t++) {
    run += e[t];
    s[t] = run;
  }
  const g0 = stableSum(e.map((v) => v * v)) / n;
  let lrv = g0;
  for (let k = 1; k <= bandwidth; k++) {
    const terms = new Array<number>(n - k);
    for (let t = k; t < n; t++) terms[t - k] = e[t] * e[t - k];
    const gk = stableSum(terms) / n;
    lrv += 2 * (1 - k / (bandwidth + 1)) * gk;
  }
  if (!(lrv > 0)) {
    throw new EngineError(
      `The Bartlett-kernel long-run variance estimate came out non-positive (${lrv.toExponential(3)}), so the KPSS statistic cannot be formed. Try a smaller bandwidth than ${bandwidth}.`,
      'numerical',
    );
  }
  const eta = stableSum(s.map((v) => v * v)) / (n * n * lrv);
  const cv = KPSS_CRIT[spec];
  const sortedAsc = [...cv].sort((a, b) => a.level - b.level);
  let bracket: string;
  let p: number | null = null;
  if (eta >= sortedAsc[0].value) bracket = 'p < 0.01';
  else if (eta <= sortedAsc[sortedAsc.length - 1].value) bracket = 'p > 0.10';
  else {
    bracket = 'p could not be bracketed from the table';
    for (let i = 0; i < sortedAsc.length - 1; i++) {
      const a = sortedAsc[i];
      const b = sortedAsc[i + 1];
      if (eta < a.value && eta > b.value) {
        const w = (a.value - eta) / (a.value - b.value);
        p = a.level + w * (b.level - a.level);
        bracket = `${a.level} < p < ${b.level} (interpolated: ${p.toFixed(4)})`;
        break;
      }
    }
  }
  const reject = cv.map((c) => ({ level: c.level, reject: eta > c.value }));
  const reject5 = reject.find((r) => r.level === 0.05)?.reject ?? false;
  return {
    name: 'KPSS',
    statistic: eta,
    df: null,
    pValue: p,
    pValueBracket: bracket,
    criticalValues: cv,
    rejectAt: reject,
    specification: spec,
    bandwidth,
    longRunVariance: lrv,
    nullHypothesis: spec === 'level' ? 'The series is stationary around a constant level.' : 'The series is stationary around a linear trend.',
    alternative: 'The series has a unit root (a random-walk component).',
    interpretation: reject5
      ? `η = ${eta.toFixed(4)} exceeds the 5% critical value ${cv.find((c) => c.level === 0.05)?.value}: stationarity is rejected, so a unit root or other non-stationarity is indicated. Note that the direction is the OPPOSITE of the ADF reading — here rejection means non-stationary.`
      : `η = ${eta.toFixed(4)} does not exceed the 5% critical value ${cv.find((c) => c.level === 0.05)?.value}: stationarity is not rejected.`,
    explanation: explain('KPSS stationarity test (Bartlett-kernel long-run variance)', 'numerical', {
      formula: 'η = n⁻² Σ S_t² / σ̂²_LR,  S_t = Σ_{i≤t} e_i',
      steps: [
        { label: 'Specification', value: spec === 'level' ? 'stationary around a level' : 'stationary around a linear trend' },
        { label: 'Observations', value: String(n) },
        { label: 'Bartlett bandwidth', value: String(bandwidth) },
        { label: 'Long-run variance', value: lrv.toExponential(6) },
        { label: 'η statistic', value: eta.toFixed(6) },
      ],
      assumptions: ['The long-run variance is estimated non-parametrically; the chosen bandwidth materially affects the statistic.'],
      limitations: [
        'The critical values are the tabulated asymptotic values of Kwiatkowski et al. (1992), interpolated between four tabulated levels. They do not come from a normal or chi-square distribution.',
        'KPSS over-rejects stationarity in small samples and is sensitive to the bandwidth.',
        'The null is stationarity, so failing to reject is weak evidence of stationarity, not proof.',
      ],
    }),
    warnings: n < 50 ? [`With n = ${n} the KPSS asymptotic critical values are unreliable.`] : [],
  };
}

export interface PhillipsPerronResult extends TsTestResult {
  specification: Exclude<AdfSpecification, 'none'> | 'none';
  bandwidth: number;
}

/**
 * Phillips–Perron Z_τ test. Same null as ADF (a unit root), but instead of
 * adding lagged differences it corrects the Dickey–Fuller t-ratio
 * non-parametrically for serial correlation, and so uses the same MacKinnon
 * critical values.
 */
export function phillipsPerron(
  series: ArrayLike<number>,
  options: { specification?: AdfSpecification; bandwidth?: number } = {},
): PhillipsPerronResult {
  const spec = options.specification ?? 'constant';
  const y = checkSeries(series, 12, 'series');
  const n = y.length;
  const rows: number[][] = [];
  const target: number[] = [];
  for (let t = 1; t < n; t++) {
    const row: number[] = [];
    if (spec !== 'none') row.push(1);
    if (spec === 'constant-trend') row.push(t);
    row.push(y[t - 1]);
    rows.push(row);
    target.push(y[t]);
  }
  const fit = ols(rows, target);
  const idx = spec === 'none' ? 0 : spec === 'constant' ? 1 : 2;
  const rho = fit.beta[idx];
  const seRho = fit.se[idx];
  if (!(seRho > 0)) throw new EngineError('The Phillips–Perron regression produced a zero standard error on the lagged level.', 'numerical');
  const tRho = (rho - 1) / seRho;
  const e = fit.residuals;
  const m = e.length;
  const bandwidth = options.bandwidth ?? Math.floor(4 * Math.pow(m / 100, 0.25));
  if (!Number.isInteger(bandwidth) || bandwidth < 0 || bandwidth >= m) {
    throw new EngineError(`The Phillips–Perron bandwidth must be a whole number in [0, ${m - 1}] (received ${bandwidth}).`, 'range');
  }
  const gamma0 = stableSum(e.map((v) => v * v)) / m;
  let lambda2 = gamma0;
  for (let k = 1; k <= bandwidth; k++) {
    const terms = new Array<number>(m - k);
    for (let t = k; t < m; t++) terms[t - k] = e[t] * e[t - k];
    lambda2 += 2 * (1 - k / (bandwidth + 1)) * (stableSum(terms) / m);
  }
  if (!(lambda2 > 0) || !(gamma0 > 0)) {
    throw new EngineError('The Phillips–Perron long-run variance estimate is non-positive; no statistic can be reported.', 'numerical');
  }
  const s = Math.sqrt(fit.sigma2);
  const zTau = Math.sqrt(gamma0 / lambda2) * tRho - ((lambda2 - gamma0) * m * seRho) / (2 * Math.sqrt(lambda2) * s);
  const criticalValues = [0.01, 0.05, 0.1].map((l) => ({ level: l, value: mackinnonCritical(spec, l, m) }));
  const { p, bracket } = tabulatedBracket(zTau, criticalValues);
  const reject = criticalValues.map((c) => ({ level: c.level, reject: zTau < c.value }));
  const reject5 = reject.find((r) => r.level === 0.05)?.reject ?? false;
  return {
    name: 'Phillips–Perron Z_τ',
    statistic: zTau,
    df: null,
    pValue: p,
    pValueBracket: bracket,
    criticalValues,
    rejectAt: reject,
    specification: spec,
    bandwidth,
    nullHypothesis: 'The series has a unit root.',
    alternative: 'The series is stationary (around the chosen deterministic terms).',
    interpretation: reject5
      ? `Z_τ = ${zTau.toFixed(4)} is below the 5% critical value ${criticalValues[1].value.toFixed(4)}: the unit root is rejected.`
      : `Z_τ = ${zTau.toFixed(4)} is not below the 5% critical value ${criticalValues[1].value.toFixed(4)}: the unit root is not rejected.`,
    explanation: explain('Phillips–Perron Z_τ with a Newey–West correction and MacKinnon critical values', 'numerical', {
      formula: 'Z_τ = √(γ̂₀/λ̂²)·t_ρ − (λ̂² − γ̂₀)·m·se(ρ̂)/(2 λ̂ s)',
      steps: [
        { label: 'Observations in the regression', value: String(m) },
        { label: 'ρ̂', value: rho.toFixed(6) },
        { label: 'Bartlett bandwidth', value: String(bandwidth) },
        { label: 'Short-run variance γ̂₀', value: gamma0.toExponential(6) },
        { label: 'Long-run variance λ̂²', value: lambda2.toExponential(6) },
      ],
      assumptions: ['The serial correlation in the errors is handled by the kernel correction rather than by augmentation lags.'],
      limitations: [
        'Same tabulated MacKinnon critical values as ADF, with the same caveat that they are interpolated approximations of a non-standard distribution.',
        'Phillips–Perron is known to have severe size distortions when the errors have a large negative moving-average component.',
      ],
    }),
    warnings: n < 50 ? [`With n = ${n} the Phillips–Perron correction is unreliable.`] : [],
  };
}

export interface StationarityVerdict {
  adf: AdfResult;
  kpss: KpssResult;
  /** One of the four combinations of the two opposite-null tests. */
  cell: 'stationary' | 'unit-root' | 'inconclusive-both-rejected' | 'inconclusive-neither-rejected';
  verdict: string;
  recommendation: string;
  warnings: string[];
}

/**
 * Run ADF and KPSS together and report which of the four cells the data falls
 * into. This is more informative than either test alone precisely because the
 * two nulls are opposites: the two "inconclusive" cells are real answers that
 * a single test would misreport as a clean conclusion.
 */
export function stationarityVerdict(
  series: ArrayLike<number>,
  options: { specification?: AdfSpecification; level?: number } = {},
): StationarityVerdict {
  const level = options.level ?? 0.05;
  const spec = options.specification ?? 'constant';
  const adfResult = augmentedDickeyFuller(series, { specification: spec });
  const kpssResult = kpss(series, { specification: spec === 'constant-trend' ? 'trend' : 'level' });
  const adfReject = adfResult.rejectAt?.find((r) => r.level === level)?.reject ?? false;
  const kpssReject = kpssResult.rejectAt?.find((r) => r.level === level)?.reject ?? false;
  let cell: StationarityVerdict['cell'];
  let verdict: string;
  let recommendation: string;
  if (adfReject && !kpssReject) {
    cell = 'stationary';
    verdict = 'ADF rejects the unit root and KPSS does not reject stationarity. Both tests agree: the series looks stationary.';
    recommendation = 'Model the series as it is; no differencing is indicated.';
  } else if (!adfReject && kpssReject) {
    cell = 'unit-root';
    verdict = 'ADF fails to reject the unit root and KPSS rejects stationarity. Both tests agree: the series looks non-stationary.';
    recommendation = 'Difference the series once and re-test. If the difference is still non-stationary, consider a second difference — but over-differencing is itself a defect.';
  } else if (adfReject && kpssReject) {
    cell = 'inconclusive-both-rejected';
    verdict = 'Both nulls are rejected, which is contradictory. This pattern typically means the series is neither a clean unit root nor clean stationary: a structural break, a changing variance, or long memory (fractional integration) produces it.';
    recommendation = 'Do not pick whichever answer is convenient. Look for a level shift or a variance change first (see the changepoint and ARCH diagnostics), and consider a variance-stabilising transform.';
  } else {
    cell = 'inconclusive-neither-rejected';
    verdict = 'Neither null is rejected. The sample simply does not contain enough information to tell a stationary series from a unit-root one — the usual case for a short series or a root near 1.';
    recommendation = 'Report the ambiguity. If a decision is needed, model both ways and compare out-of-sample forecasts rather than relying on either test.';
  }
  return {
    adf: adfResult,
    kpss: kpssResult,
    cell,
    verdict,
    recommendation,
    warnings: [...adfResult.warnings, ...kpssResult.warnings],
  };
}

export interface DifferencingResult {
  values: number[];
  /** Number of regular differences applied. */
  d: number;
  /** Number of seasonal differences applied, and the period used. */
  seasonalD: number;
  period: number | null;
  /** Observations lost: d + seasonalD × period. */
  observationsLost: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/** Apply `d` regular and `seasonalD` seasonal differences, in that order. */
export function difference(
  series: ArrayLike<number>,
  options: { d?: number; seasonalD?: number; period?: number } = {},
): DifferencingResult {
  const d = options.d ?? 1;
  const sd = options.seasonalD ?? 0;
  if (!Number.isInteger(d) || d < 0 || !Number.isInteger(sd) || sd < 0) {
    throw new EngineError('Differencing orders must be non-negative whole numbers.', 'range');
  }
  if (sd > 0 && options.period === undefined) {
    throw new EngineError('A seasonal difference needs a seasonal period.', 'required');
  }
  const period = sd > 0 ? checkPeriod(options.period as number, series.length) : (options.period ?? null);
  const lost = d + sd * (period ?? 0);
  let v = checkSeries(series, lost + 2, 'series');
  for (let i = 0; i < sd; i++) {
    const p = period as number;
    const next = new Array<number>(v.length - p);
    for (let t = p; t < v.length; t++) next[t - p] = v[t] - v[t - p];
    v = next;
  }
  for (let i = 0; i < d; i++) {
    const next = new Array<number>(v.length - 1);
    for (let t = 1; t < v.length; t++) next[t - 1] = v[t] - v[t - 1];
    v = next;
  }
  const warnings: string[] = [];
  if (d >= 2) warnings.push(`Applying ${d} regular differences is unusual. Over-differencing is a real defect: it introduces artificial negative autocorrelation (an MA component the data does not have) and inflates forecast variance.`);
  return {
    values: v,
    d,
    seasonalD: sd,
    period,
    observationsLost: lost,
    explanation: explain('Differencing', 'exact', {
      formula: sd > 0 ? `(1 − B)^${d} (1 − B^${period})^${sd} y_t` : `(1 − B)^${d} y_t`,
      steps: [
        { label: 'Regular differences', value: String(d) },
        { label: 'Seasonal differences', value: String(sd) },
        { label: 'Observations lost', value: String(lost) },
        { label: 'Remaining observations', value: String(v.length) },
      ],
      assumptions: ['The series is evenly spaced, so a one-step difference is a constant-interval change.'],
      limitations: [
        'Differencing removes a trend but also removes any information about the level; forecasts must be integrated back and inherit the level uncertainty.',
        'Over-differencing is itself a defect — check the differenced ACF for a large negative lag-1 value, the signature of one difference too many.',
      ],
    }),
    warnings,
  };
}

export interface DifferencingRecommendation {
  d: number;
  seasonalD: number;
  period: number | null;
  /** The sequence of tests performed and what each one said. */
  trail: { step: string; statistic: number; decision: string }[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Recommend differencing orders by repeated testing: seasonal differences
 * first by the strength of seasonality, then regular differences by KPSS
 * (whose null is stationarity, so it is the natural stopping rule).
 */
export function recommendDifferencing(
  series: ArrayLike<number>,
  options: { period?: number; maxD?: number; maxSeasonalD?: number; level?: number } = {},
): DifferencingRecommendation {
  const maxD = options.maxD ?? 2;
  const maxSd = options.maxSeasonalD ?? 1;
  const level = options.level ?? 0.05;
  let v = checkSeries(series, 14, 'series');
  const trail: { step: string; statistic: number; decision: string }[] = [];
  const warnings: string[] = [];
  let sd = 0;
  const period = options.period ?? null;
  if (period !== null) {
    checkPeriod(period, v.length);
    while (sd < maxSd && v.length > 2 * period + 8) {
      // Seasonal strength: the share of variance explained by the seasonal
      // means after removing a centred moving-average trend.
      const strength = seasonalStrength(v, period);
      if (strength > 0.64) {
        trail.push({ step: `seasonal strength at period ${period}`, statistic: strength, decision: 'take a seasonal difference' });
        v = difference(v, { d: 0, seasonalD: 1, period }).values;
        sd++;
      } else {
        trail.push({ step: `seasonal strength at period ${period}`, statistic: strength, decision: 'no seasonal difference' });
        break;
      }
    }
  }
  let d = 0;
  while (d < maxD && v.length >= 14) {
    const k = kpss(v, { specification: 'level' });
    const reject = k.rejectAt?.find((r) => r.level === level)?.reject ?? false;
    trail.push({ step: `KPSS on the ${d === 0 ? 'series' : `${d}×differenced series`}`, statistic: k.statistic, decision: reject ? 'difference again' : 'stop' });
    if (!reject) break;
    v = difference(v, { d: 1 }).values;
    d++;
  }
  if (d >= maxD) warnings.push(`The search reached the maximum of ${maxD} regular differences without KPSS accepting stationarity. Do not simply difference again: a series that needs three differences usually needs a transform or has a structural break instead.`);
  if (d >= 2) warnings.push('Two regular differences is already at the edge of what is usually justified. Over-differencing adds artificial negative autocorrelation and widens forecast intervals.');
  return {
    d,
    seasonalD: sd,
    period,
    trail,
    explanation: explain('Automatic differencing order by seasonal strength then repeated KPSS', 'numerical', {
      steps: trail.map((t) => ({ label: t.step, value: `${t.statistic.toFixed(4)} → ${t.decision}` })),
      assumptions: ['The stopping rule is a sequence of KPSS tests, so it inherits their small-sample size distortions.'],
      limitations: [
        'A sequence of tests has no controlled overall error rate; the recommendation is a heuristic, not an inference.',
        'Over-differencing is a defect in its own right. Always inspect the ACF of the differenced series before accepting the recommendation.',
      ],
    }),
    warnings,
  };
}

/** Share of the remainder variance removed by the seasonal component (Wang/Hyndman style). */
function seasonalStrength(x: number[], period: number): number {
  const n = x.length;
  // Centred moving average trend.
  const trend = centredMovingAverage(x, period);
  const detr: number[] = [];
  const idx: number[] = [];
  for (let t = 0; t < n; t++) {
    if (trend[t] !== null) {
      detr.push(x[t] - (trend[t] as number));
      idx.push(t);
    }
  }
  if (detr.length < period * 2) return 0;
  const sums = new Array<number>(period).fill(0);
  const counts = new Array<number>(period).fill(0);
  for (let i = 0; i < detr.length; i++) {
    const s = idx[i] % period;
    sums[s] += detr[i];
    counts[s] += 1;
  }
  const seasonal = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  const sm = meanOf(seasonal);
  const centered = seasonal.map((s) => s - sm);
  const remainder = detr.map((v, i) => v - centered[idx[i] % period]);
  const varDetr = stableSum(detr.map((v) => v * v)) / detr.length;
  const varRem = stableSum(remainder.map((v) => v * v)) / remainder.length;
  if (!(varDetr > 0)) return 0;
  return Math.max(0, 1 - varRem / varDetr);
}

/** Centred moving average of order `period`; null where the window does not fit. */
export function centredMovingAverage(x: number[], period: number): (number | null)[] {
  const n = x.length;
  const out = new Array<number | null>(n).fill(null);
  if (period % 2 === 1) {
    const h = (period - 1) / 2;
    for (let t = h; t < n - h; t++) {
      let s = 0;
      for (let j = -h; j <= h; j++) s += x[t + j];
      out[t] = s / period;
    }
  } else {
    const h = period / 2;
    for (let t = h; t < n - h; t++) {
      let s = 0.5 * x[t - h] + 0.5 * x[t + h];
      for (let j = -h + 1; j <= h - 1; j++) s += x[t + j];
      out[t] = s / period;
    }
  }
  return out;
}

export interface BoxCoxResult {
  lambda: number;
  values: number[];
  /** Profile log-likelihood at the chosen λ. */
  logLikelihood: number;
  /** Whether λ was estimated or supplied. */
  estimated: boolean;
  /** Suggested rounded λ when it is close to a conventional value. */
  suggestion: string;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Box–Cox variance-stabilising transform.
 *
 *   y^(λ) = (y^λ − 1)/λ for λ ≠ 0,   log y for λ = 0
 *
 * λ is estimated by maximising the profile log-likelihood
 *   ℓ(λ) = −(n/2) log σ̂²(λ) + (λ − 1) Σ log y_t
 * over λ ∈ [−2, 2]. All observations must be strictly positive.
 */
export function boxCox(series: ArrayLike<number>, options: { lambda?: number } = {}): BoxCoxResult {
  const y = checkSeries(series, 4, 'series');
  const n = y.length;
  for (let i = 0; i < n; i++) {
    if (!(y[i] > 0)) {
      throw new EngineError(
        `The Box–Cox transform needs strictly positive observations; index ${i} is ${y[i]}. Shift the series by a stated constant first, and report that you did.`,
        'domain',
      );
    }
  }
  const sumLog = stableSum(y.map((v) => Math.log(v)));
  const transform = (lam: number): number[] =>
    Math.abs(lam) < 1e-10 ? y.map((v) => Math.log(v)) : y.map((v) => (Math.pow(v, lam) - 1) / lam);
  const profile = (lam: number): number => {
    const z = transform(lam);
    const m = meanOf(z);
    const s2 = stableSum(z.map((v) => (v - m) * (v - m))) / n;
    if (!(s2 > 0)) return -Infinity;
    return -(n / 2) * Math.log(s2) + (lam - 1) * sumLog;
  };
  let lambda: number;
  let estimated: boolean;
  if (options.lambda !== undefined) {
    if (!Number.isFinite(options.lambda)) throw new EngineError('The Box–Cox λ must be a finite number.', 'finite');
    lambda = options.lambda;
    estimated = false;
  } else {
    // Golden-section search on a grid-refined bracket.
    let best = -2;
    let bestVal = -Infinity;
    for (let lam = -2; lam <= 2 + 1e-9; lam += 0.02) {
      const v = profile(lam);
      if (v > bestVal) {
        bestVal = v;
        best = lam;
      }
    }
    if (!Number.isFinite(bestVal)) {
      throw new EngineError('The Box–Cox profile likelihood is not finite anywhere on [−2, 2]; λ cannot be estimated for this series.', 'numerical');
    }
    // Refine by solving for a zero derivative inside the winning cell.
    const lo = Math.max(-2, best - 0.02);
    const hi = Math.min(2, best + 0.02);
    const dprofile = (lam: number): number => (profile(lam + 1e-5) - profile(lam - 1e-5)) / 2e-5;
    try {
      lambda = brentRoot(dprofile, lo, hi, { tol: 1e-8 });
    } catch {
      lambda = best;
    }
    estimated = true;
  }
  const values = transform(lambda);
  const ll = profile(lambda);
  const near = (target: number): boolean => Math.abs(lambda - target) < 0.15;
  const suggestion = near(0)
    ? 'λ is close to 0: a plain log transform is simpler and interpretable, and is usually the better choice.'
    : near(1)
      ? 'λ is close to 1: no transform is needed.'
      : near(0.5)
        ? 'λ is close to 0.5: a square-root transform is simpler and interpretable.'
        : `λ = ${lambda.toFixed(3)} has no simple interpretation; consider rounding to 0, 0.5 or 1 unless the fit is much worse.`;
  const warnings: string[] = [
    'Forecasts made on a Box–Cox scale must be transformed back, and the back-transformed interval is a median-unbiased interval, not a mean-unbiased one. Back-transforming the point forecast gives a median, not a mean.',
  ];
  if (estimated) warnings.push('λ was estimated from the same data that will be modelled; the subsequent standard errors do not account for that extra uncertainty.');
  return {
    lambda,
    values,
    logLikelihood: ll,
    estimated,
    suggestion,
    explanation: explain('Box–Cox transform with λ by profile maximum likelihood', 'numerical', {
      formula: 'y^(λ) = (y^λ − 1)/λ, λ ≠ 0 ;  log y, λ = 0',
      steps: [
        { label: 'λ', value: lambda.toFixed(6) },
        { label: 'Estimated or supplied', value: estimated ? 'estimated on [−2, 2]' : 'supplied' },
        { label: 'Profile log-likelihood', value: ll.toFixed(6) },
      ],
      assumptions: ['All observations are strictly positive.', 'The transform targets a constant variance; it does not make the series stationary in mean.'],
      limitations: ['The profile likelihood is often very flat in λ, so the estimate is imprecise even when the maximum is clear.'],
    }),
    warnings,
  };
}

/** Plain log transform, refusing on non-positive observations by index. */
export function logTransform(series: ArrayLike<number>): { values: number[]; explanation: ReturnType<typeof explain> } {
  const y = checkSeries(series, 2, 'series');
  for (let i = 0; i < y.length; i++) {
    if (!(y[i] > 0)) {
      throw new EngineError(`A log transform needs strictly positive observations; index ${i} is ${y[i]}.`, 'domain');
    }
  }
  return {
    values: y.map((v) => Math.log(v)),
    explanation: explain('Natural log transform', 'exact', {
      formula: 'z_t = log y_t',
      assumptions: ['Multiplicative variation in y is additive in z, which is what makes the variance roughly constant.'],
      limitations: ['Back-transforming a forecast with exp gives the conditional MEDIAN of y, not its mean.'],
    }),
  };
}

/** Re-export so callers can reach the t tail without importing util directly. */
export { studentTTwoSided };
