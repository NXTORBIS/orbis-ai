/**
 * Dependence structure of an observed series: ACF, PACF, portmanteau tests,
 * Durbin–Watson, cross-correlation, and the effective sample size.
 *
 * The effective-sample-size section is the practical payoff of the module: it
 * is what lets the rest of the application report an honest standard error on
 * time-ordered data instead of an i.i.d. one that is too small.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { normalQuantile } from '../special/gamma';
import { explain, type TsInterval, type TsTestResult } from './types';
import { checkLag, checkSeries, chiSquareSf, meanOf, studentTTwoSided } from './util';

export interface AcfResult {
  /** acf[k] is the autocorrelation at lag k; acf[0] is exactly 1. */
  acf: number[];
  /** Autocovariances at the same lags, divided by n (the biased estimator). */
  acov: number[];
  /**
   * Standard error at each lag under the null that the series is white noise
   * beyond lag k-1 (Bartlett's formula). se[0] is 0 by definition.
   */
  se: number[];
  /** Bartlett band for the white-noise null at the requested level. */
  band: { low: number; high: number }[];
  level: number;
  n: number;
  maxLag: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Sample autocorrelation function.
 *
 * r_k = Σ_{t=k+1..n} (x_t − x̄)(x_{t−k} − x̄) / Σ_{t=1..n} (x_t − x̄)²
 *
 * The denominator uses the full sum of squares (the "biased" normalisation).
 * This is the standard choice: it guarantees |r_k| ≤ 1 and a non-negative
 * definite autocovariance sequence, which the Durbin–Levinson PACF recursion
 * relies on.
 */
export function acf(series: ArrayLike<number>, maxLag?: number, level = 0.95): AcfResult {
  const x = checkSeries(series, 3, 'series');
  const n = x.length;
  const lag = checkLag(maxLag ?? Math.min(n - 1, Math.max(10, Math.floor(10 * Math.log10(n)))), n);
  if (!(level > 0 && level < 1)) throw new EngineError(`The confidence level must be between 0 and 1 (received ${level}).`, 'range');
  const m = meanOf(x);
  const d = new Array<number>(n);
  for (let i = 0; i < n; i++) d[i] = x[i] - m;
  const c0 = stableSum(d.map((v) => v * v)) / n;
  if (!(c0 > 0)) {
    throw new EngineError(
      'The series is constant (zero variance), so no autocorrelation is defined. ' +
        'A constant series carries no information about its own dependence structure.',
      'degenerate',
    );
  }
  const acov = new Array<number>(lag + 1).fill(0);
  const r = new Array<number>(lag + 1).fill(0);
  acov[0] = c0;
  r[0] = 1;
  for (let k = 1; k <= lag; k++) {
    const terms = new Array<number>(n - k);
    for (let t = k; t < n; t++) terms[t - k] = d[t] * d[t - k];
    acov[k] = stableSum(terms) / n;
    r[k] = acov[k] / c0;
  }
  // Bartlett: Var(r_k) ≈ (1 + 2 Σ_{j=1}^{k-1} r_j²) / n under the null that
  // the process is white noise beyond lag k-1. At lag 1 this reduces to 1/n.
  const se = new Array<number>(lag + 1).fill(0);
  let cum = 0;
  for (let k = 1; k <= lag; k++) {
    se[k] = Math.sqrt((1 + 2 * cum) / n);
    cum += r[k] * r[k];
  }
  const z = normalQuantile(0.5 + level / 2);
  const band = se.map((s) => ({ low: -z * s, high: z * s }));
  return {
    acf: r,
    acov,
    se,
    band,
    level,
    n,
    maxLag: lag,
    explanation: explain('Sample autocorrelation function (biased/standard normalisation)', 'empirical', {
      formula: 'r_k = Σ (x_t − x̄)(x_{t−k} − x̄) / Σ (x_t − x̄)²',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Lags reported', value: String(lag) },
        { label: 'Sample variance (÷ n)', value: c0.toExponential(6) },
      ],
      assumptions: [
        'The series is evenly spaced in time with no missing observations.',
        'The mean is constant over the sample. On a trending series the ACF measures the trend, not the stochastic dependence; difference or detrend first.',
      ],
      limitations: [
        'An estimate from one realisation: each r_k has sampling error of order 1/√n.',
        'The Bartlett band is a pointwise band under a white-noise null. Across many lags some excursions are expected by chance; judge the pattern, not the single worst lag.',
      ],
    }),
    warnings: n < 50 ? [`With n = ${n}, autocorrelation estimates are very imprecise (standard error about ${(1 / Math.sqrt(n)).toFixed(3)} per lag).`] : [],
  };
}

export interface PacfResult {
  /** pacf[k] for k = 0..maxLag; pacf[0] is 1 by convention. */
  pacf: number[];
  /** AR coefficients of the fitted AR(k) at each order k (Yule–Walker). */
  arByOrder: number[][];
  /** Innovation variance of the fitted AR(k) at each order. */
  innovationVariance: number[];
  /** Approximate standard error 1/√n (Quenouille) and the resulting band. */
  se: number;
  band: { low: number; high: number };
  level: number;
  n: number;
  maxLag: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Partial autocorrelation function by the Durbin–Levinson recursion.
 *
 * φ_{k,k} = (r_k − Σ_{j=1}^{k−1} φ_{k−1,j} r_{k−j}) / (1 − Σ_{j=1}^{k−1} φ_{k−1,j} r_j)
 * φ_{k,j} = φ_{k−1,j} − φ_{k,k} φ_{k−1,k−j}
 *
 * The by-product `arByOrder[k]` is exactly the Yule–Walker AR(k) fit, which is
 * why `yuleWalker` below reuses this routine.
 */
export function pacf(series: ArrayLike<number>, maxLag?: number, level = 0.95): PacfResult {
  const base = acf(series, maxLag, level);
  const n = base.n;
  const lag = base.maxLag;
  const r = base.acf;
  const p = new Array<number>(lag + 1).fill(0);
  p[0] = 1;
  const arByOrder: number[][] = [[]];
  const innovationVariance: number[] = [base.acov[0]];
  let prev: number[] = [];
  let v = 1;
  for (let k = 1; k <= lag; k++) {
    let num = r[k];
    let den = 1;
    for (let j = 1; j < k; j++) {
      num -= prev[j - 1] * r[k - j];
      den -= prev[j - 1] * r[j];
    }
    if (!(Math.abs(den) > 1e-14)) {
      throw new EngineError(
        `The Durbin–Levinson recursion broke down at lag ${k}: the prediction error variance reached zero, ` +
          'which means the series is (numerically) perfectly predictable from its own past at that order. ' +
          'No partial autocorrelation can be reported beyond this lag.',
        'degenerate',
      );
    }
    const phikk = num / den;
    const cur = new Array<number>(k).fill(0);
    cur[k - 1] = phikk;
    for (let j = 1; j < k; j++) cur[j - 1] = prev[j - 1] - phikk * prev[k - 1 - j];
    p[k] = phikk;
    v *= 1 - phikk * phikk;
    arByOrder.push([...cur]);
    innovationVariance.push(base.acov[0] * v);
    prev = cur;
  }
  const se = 1 / Math.sqrt(n);
  const z = normalQuantile(0.5 + level / 2);
  return {
    pacf: p,
    arByOrder,
    innovationVariance,
    se,
    band: { low: -z * se, high: z * se },
    level,
    n,
    maxLag: lag,
    explanation: explain('Partial autocorrelation by the Durbin–Levinson recursion', 'empirical', {
      formula: 'φ_kk = (r_k − Σ φ_{k−1,j} r_{k−j}) / (1 − Σ φ_{k−1,j} r_j)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Lags reported', value: String(lag) },
      ],
      assumptions: ['The same stationarity and completeness assumptions as the ACF.'],
      limitations: [
        'The standard error 1/√n is the white-noise approximation (Quenouille); it is not valid once real dependence is present.',
        'An AR(p) shows a PACF that cuts off after lag p and an MA(q) shows an ACF that cuts off after lag q. Reading the two together identifies the order; reading either alone usually does not.',
      ],
    }),
    warnings: base.warnings,
  };
}

/**
 * Ljung–Box and Box–Pierce portmanteau tests.
 *
 * Ljung–Box:  Q = n(n+2) Σ_{k=1}^{h} r_k² / (n − k)
 * Box–Pierce: Q = n Σ_{k=1}^{h} r_k²
 *
 * `fitDf` is the number of parameters estimated in the model whose RESIDUALS
 * are being tested (for an ARMA(p,q) that is p + q). The degrees of freedom
 * become h − fitDf, because fitting those parameters forces the residual
 * autocorrelations towards zero. Omitting this adjustment — a routine error —
 * makes the test too conservative and lets a badly fitting model pass.
 */
export function portmanteau(
  residualsOrSeries: ArrayLike<number>,
  options: { lags?: number; fitDf?: number; variant?: 'ljung-box' | 'box-pierce'; onResiduals?: boolean } = {},
): TsTestResult {
  const variant = options.variant ?? 'ljung-box';
  const fitDf = options.fitDf ?? 0;
  if (!Number.isInteger(fitDf) || fitDf < 0) {
    throw new EngineError(`The number of fitted parameters must be a non-negative whole number (received ${fitDf}).`, 'range');
  }
  const x = checkSeries(residualsOrSeries, 4, options.onResiduals ?? fitDf > 0 ? 'residual series' : 'series');
  const n = x.length;
  const h = checkLag(options.lags ?? Math.min(10, Math.max(1, Math.floor(n / 5))), n);
  const df = h - fitDf;
  if (df < 1) {
    throw new EngineError(
      `The portmanteau test needs more lags than fitted parameters: ${h} lags minus ${fitDf} fitted parameters leaves ${df} degrees of freedom. ` +
        `Use at least ${fitDf + 1} lags.`,
      'df',
    );
  }
  const base = acf(x, h);
  const r = base.acf;
  let q = 0;
  for (let k = 1; k <= h; k++) {
    q += variant === 'ljung-box' ? (n * (n + 2) * r[k] * r[k]) / (n - k) : n * r[k] * r[k];
  }
  const pValue = chiSquareSf(q, df);
  const onRes = fitDf > 0;
  const name = variant === 'ljung-box' ? 'Ljung–Box Q' : 'Box–Pierce Q';
  return {
    name: `${name}${onRes ? ' (on model residuals)' : ''}`,
    statistic: q,
    df,
    pValue,
    pValueBracket: null,
    criticalValues: null,
    rejectAt: [0.1, 0.05, 0.01].map((l) => ({ level: l, reject: pValue < l })),
    nullHypothesis: `The first ${h} autocorrelations are all zero (the series is white noise up to lag ${h}).`,
    alternative: 'At least one of those autocorrelations is non-zero.',
    interpretation:
      pValue < 0.05
        ? `Autocorrelation is detected (p = ${pValue.toExponential(3)}). ${onRes ? 'The residuals still contain structure the model has not extracted, so its forecast intervals are too narrow.' : 'Treating these observations as independent would understate every standard error.'}`
        : `No autocorrelation detected up to lag ${h} (p = ${pValue.toFixed(4)}). This is not evidence of independence: with n = ${n} the test has limited power against weak or long-lag dependence.`,
    explanation: explain(
      `${name} portmanteau test${onRes ? ` with degrees of freedom reduced from ${h} to ${df} for ${fitDf} fitted parameter(s)` : ''}`,
      'numerical',
      {
        formula: variant === 'ljung-box' ? 'Q = n(n+2) Σ r_k²/(n−k),  df = h − (fitted parameters)' : 'Q = n Σ r_k²,  df = h − (fitted parameters)',
        steps: [
          { label: 'Observations', value: String(n) },
          { label: 'Lags tested', value: String(h) },
          { label: 'Fitted parameters removed from df', value: String(fitDf) },
          { label: 'Degrees of freedom', value: String(df) },
        ],
        assumptions: [
          'The chi-square reference distribution is asymptotic in n.',
          onRes
            ? 'The residuals come from a model estimated on this same sample; the df adjustment accounts for that, approximately.'
            : 'The series is being tested as raw data, so no df adjustment is applied. If these are model residuals, pass fitDf.',
        ],
        limitations: [
          variant === 'box-pierce'
            ? 'Box–Pierce is the original form and is poorly sized in small samples; Ljung–Box is the corrected version and is preferred.'
            : 'The choice of h matters: too few lags misses long-lag structure, too many dilutes power.',
          'The test detects linear autocorrelation only. Uncorrelated is not independent — squared residuals can be strongly dependent while the levels are not (see the ARCH test).',
        ],
      },
    ),
    warnings: n < 30 ? [`With n = ${n} the chi-square approximation is unreliable.`] : [],
  };
}

/**
 * Durbin–Watson statistic, d = Σ (e_t − e_{t−1})² / Σ e_t².
 *
 * d ≈ 2(1 − r_1): roughly 2 means no first-order autocorrelation, below 2
 * positive, above 2 negative. The exact null distribution depends on the
 * regression design, so no p-value is reported — only the statistic and the
 * implied lag-1 autocorrelation.
 */
export function durbinWatson(residuals: ArrayLike<number>): TsTestResult {
  const e = checkSeries(residuals, 3, 'residual series');
  const n = e.length;
  const num = new Array<number>(n - 1);
  for (let t = 1; t < n; t++) num[t - 1] = (e[t] - e[t - 1]) * (e[t] - e[t - 1]);
  const den = stableSum(e.map((v) => v * v));
  if (!(den > 0)) throw new EngineError('All residuals are zero, so the Durbin–Watson statistic is undefined.', 'degenerate');
  const d = stableSum(num) / den;
  const rho = 1 - d / 2;
  return {
    name: 'Durbin–Watson',
    statistic: d,
    df: null,
    pValue: null,
    pValueBracket: 'No p-value: the exact null distribution of d depends on the regression design matrix.',
    criticalValues: null,
    rejectAt: null,
    nullHypothesis: 'The residuals have no first-order autocorrelation (d = 2).',
    alternative: 'First-order autocorrelation is present (d ≠ 2).',
    interpretation:
      d < 1.5
        ? `d = ${d.toFixed(4)} indicates positive first-order autocorrelation (implied r₁ ≈ ${rho.toFixed(4)}). Standard errors from an i.i.d. fit are too small.`
        : d > 2.5
          ? `d = ${d.toFixed(4)} indicates negative first-order autocorrelation (implied r₁ ≈ ${rho.toFixed(4)}).`
          : `d = ${d.toFixed(4)} is close to 2, consistent with no first-order autocorrelation (implied r₁ ≈ ${rho.toFixed(4)}).`,
    explanation: explain('Durbin–Watson first-order autocorrelation statistic', 'exact', {
      formula: 'd = Σ(e_t − e_{t−1})² / Σ e_t²  ≈  2(1 − r₁)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Implied lag-1 autocorrelation', value: rho.toFixed(6) },
      ],
      assumptions: ['The residuals are in time order and evenly spaced.'],
      limitations: [
        'Only first-order autocorrelation is examined. Use Ljung–Box for higher lags.',
        'The statistic is biased towards 2 when a lagged dependent variable is among the regressors.',
        'Published d_L/d_U bounds tables are not reproduced here; the statistic is reported with its implied r₁ instead of a fabricated p-value.',
      ],
    }),
    warnings: [],
  };
}

export interface CrossCorrelationResult {
  /** Lags from −maxLag to +maxLag. */
  lags: number[];
  /** ccf[i] corresponds to lags[i]: positive lag k means x leads y by k. */
  ccf: number[];
  /** Crude ±z/√n band that is only valid if at least one series is white noise. */
  naiveBand: { low: number; high: number };
  level: number;
  n: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Cross-correlation function between two series of equal length.
 *
 * Positive lag k reports corr(x_t, y_{t+k}), i.e. x leading y.
 *
 * A warning is always attached: the ±2/√n band is derived under the assumption
 * that at least one of the two series is white noise. Between two
 * autocorrelated series the variance of the sample cross-correlation is
 * inflated by Σ_j ρ_x(j) ρ_y(j) (Bartlett), so apparently significant
 * cross-correlations appear routinely between two independent random walks.
 * The remedy is pre-whitening: fit a model to x, filter BOTH series with that
 * model's inverse, and cross-correlate the filtered pair.
 */
export function crossCorrelation(
  xSeries: ArrayLike<number>,
  ySeries: ArrayLike<number>,
  maxLag?: number,
  level = 0.95,
): CrossCorrelationResult {
  const x = checkSeries(xSeries, 4, 'first series');
  const y = checkSeries(ySeries, 4, 'second series');
  if (x.length !== y.length) {
    throw new EngineError(
      `Cross-correlation needs two series of the same length and alignment (received ${x.length} and ${y.length}). Align them on a common time index first.`,
      'length-mismatch',
    );
  }
  const n = x.length;
  const lag = checkLag(maxLag ?? Math.min(n - 2, Math.floor(10 * Math.log10(n))), n);
  const mx = meanOf(x);
  const my = meanOf(y);
  const dx = x.map((v) => v - mx);
  const dy = y.map((v) => v - my);
  const sx = Math.sqrt(stableSum(dx.map((v) => v * v)) / n);
  const sy = Math.sqrt(stableSum(dy.map((v) => v * v)) / n);
  if (!(sx > 0) || !(sy > 0)) {
    throw new EngineError('One of the two series is constant, so no cross-correlation is defined.', 'degenerate');
  }
  const lags: number[] = [];
  const ccf: number[] = [];
  for (let k = -lag; k <= lag; k++) {
    const terms: number[] = [];
    for (let t = 0; t < n; t++) {
      const u = t + k;
      if (u >= 0 && u < n) terms.push(dx[t] * dy[u]);
    }
    lags.push(k);
    ccf.push(stableSum(terms) / (n * sx * sy));
  }
  // Bartlett variance inflation for the cross-correlation of two
  // autocorrelated series, reported so the user can see the size of the problem.
  const ax = acf(x, Math.min(lag, n - 2)).acf;
  const ay = acf(y, Math.min(lag, n - 2)).acf;
  let inflation = 1;
  for (let j = 1; j < Math.min(ax.length, ay.length); j++) inflation += 2 * ax[j] * ay[j];
  const z = normalQuantile(0.5 + level / 2);
  const se = 1 / Math.sqrt(n);
  const warnings = [
    `The ±${(z * se).toFixed(4)} band assumes at least one series is white noise. The Bartlett variance-inflation factor for this pair is about ${inflation.toFixed(2)}, so the honest band is roughly ±${(z * se * Math.sqrt(Math.max(inflation, 0))).toFixed(4)}.`,
    'Cross-correlation between two autocorrelated series produces spurious significance: two independent random walks routinely show large cross-correlations at many lags. Pre-whiten before interpreting any peak — fit an ARIMA model to the input series, apply that same filter to both series, and cross-correlate the residuals.',
  ];
  return {
    lags,
    ccf,
    naiveBand: { low: -z * se, high: z * se },
    level,
    n,
    explanation: explain('Sample cross-correlation function', 'empirical', {
      formula: 'r_xy(k) = Σ (x_t − x̄)(y_{t+k} − ȳ) / (n s_x s_y)',
      steps: [
        { label: 'Observations per series', value: String(n) },
        { label: 'Lags each side', value: String(lag) },
        { label: 'Bartlett variance inflation', value: inflation.toFixed(4) },
      ],
      assumptions: [
        'Both series are evenly spaced, complete and aligned on the same time index.',
        'Both series are stationary. On trending or unit-root series the cross-correlation measures shared trend and is not interpretable.',
      ],
      limitations: [
        'Correlation at a lead does not establish causation; a common driver produces the same pattern.',
        'The reported band is the naive one. See the warnings for the corrected magnitude and the pre-whitening remedy.',
      ],
    }),
    warnings,
  };
}

export interface EffectiveSampleSizeResult {
  n: number;
  /** Effective sample size for the mean. */
  ess: number;
  /** n / ESS: how many real observations one effective observation costs. */
  varianceInflationFactor: number;
  /** Sum 1 + 2 Σ_{k=1}^{K} r_k, the quantity that inflates the variance. */
  sumFactor: number;
  /** Lag at which the autocorrelation sum was truncated, and why. */
  truncationLag: number;
  truncationRule: string;
  mean: number;
  /** Standard error that wrongly assumes independence. */
  naiveStandardError: number;
  /** Standard error corrected for autocorrelation. */
  correctedStandardError: number;
  naiveInterval: TsInterval;
  correctedInterval: TsInterval;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Effective sample size, variance-inflation factor and a corrected standard
 * error for the mean of an autocorrelated series.
 *
 * Var(x̄) = (σ²/n)(1 + 2 Σ_{k≥1} (1 − k/n) ρ_k), so the effective sample size
 * is n_eff = n / (1 + 2 Σ ρ_k). For an AR(1) the infinite sum gives the closed
 * form (1+φ)/(1−φ): at φ = 0.7 the variance of the mean is 5.67× the i.i.d.
 * value, so the i.i.d. standard error is too small by a factor of 2.4 and a
 * nominal 95% interval covers far less than 95% of the time.
 *
 * The sum is truncated by the initial-positive-sequence rule (Geyer 1992):
 * consecutive pairs ρ_{2k} + ρ_{2k+1} are accumulated while they stay
 * positive. This is a conservative, consistent truncation that does not
 * require choosing a bandwidth by hand.
 */
export function effectiveSampleSize(
  series: ArrayLike<number>,
  options: { maxLag?: number; level?: number } = {},
): EffectiveSampleSizeResult {
  const x = checkSeries(series, 8, 'series');
  const n = x.length;
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`The confidence level must be between 0 and 1 (received ${level}).`, 'range');
  const maxLag = checkLag(options.maxLag ?? Math.min(n - 2, Math.max(10, Math.floor(10 * Math.log(n)))), n);
  const base = acf(x, maxLag);
  const r = base.acf;
  let sum = 1;
  let truncation = 0;
  for (let k = 1; k + 1 <= maxLag; k += 2) {
    const pair = r[k] + r[k + 1];
    if (pair <= 0) break;
    sum += 2 * pair;
    truncation = k + 1;
  }
  if (truncation === 0 && maxLag >= 1 && r[1] > 0) {
    // A single positive lag-1 correlation with a negative lag-2 still inflates
    // the variance; keep it rather than reporting no dependence at all.
    sum += 2 * r[1];
    truncation = 1;
  }
  if (!(sum > 0)) {
    throw new EngineError(
      'The estimated autocorrelation sum is not positive, so no effective sample size can be reported. ' +
        'This happens with strongly negatively autocorrelated or over-differenced series; the mean of such a series is estimated MORE precisely than i.i.d. sampling would suggest, but the truncated estimator cannot quantify it reliably here.',
      'numerical',
    );
  }
  const ess = n / sum;
  const m = meanOf(x);
  const s2 = stableSum(x.map((v) => (v - m) * (v - m))) / (n - 1);
  const naiveSe = Math.sqrt(s2 / n);
  const correctedSe = Math.sqrt((s2 * sum) / n);
  const zNaive = normalQuantile(0.5 + level / 2);
  const tLike = zNaive; // large-sample normal quantile for both, so the only difference is the variance
  const naiveInterval: TsInterval = {
    low: m - tLike * naiveSe,
    high: m + tLike * naiveSe,
    level,
    of: 'the mean of the series, WRONGLY assuming independent observations',
    method: 'i.i.d. normal interval (shown for comparison only — do not use it on this data)',
    kind: 'estimate',
  };
  const correctedInterval: TsInterval = {
    low: m - tLike * correctedSe,
    high: m + tLike * correctedSe,
    level,
    of: 'the mean of the series, corrected for autocorrelation',
    method: 'long-run variance via the initial-positive-sequence truncated autocorrelation sum',
    kind: 'estimate',
  };
  const warnings: string[] = [];
  if (sum > 1.2) {
    warnings.push(
      `Autocorrelation inflates the variance of the mean by a factor of ${sum.toFixed(2)}: the i.i.d. standard error is too small by a factor of ${Math.sqrt(sum).toFixed(2)}. The ${Math.round(level * 100)}% interval above labelled "i.i.d." would be badly over-confident on this data.`,
    );
  }
  if (ess < 30) {
    warnings.push(`The effective sample size is only ${ess.toFixed(1)} despite n = ${n}. Any inference here rests on very little independent information.`);
  }
  if (truncation >= maxLag - 1) {
    warnings.push(`The autocorrelation sum was still positive at the last available lag (${truncation}); the reported inflation is a LOWER bound on the true one.`);
  }
  return {
    n,
    ess,
    varianceInflationFactor: sum,
    sumFactor: sum,
    truncationLag: truncation,
    truncationRule: 'initial positive sequence (Geyer): accumulate consecutive lag pairs while their sum stays positive',
    mean: m,
    naiveStandardError: naiveSe,
    correctedStandardError: correctedSe,
    naiveInterval,
    correctedInterval,
    explanation: explain('Effective sample size and autocorrelation-corrected standard error for the mean', 'empirical', {
      formula: 'VIF = 1 + 2 Σ ρ_k ;  n_eff = n / VIF ;  SE(x̄) = √(s² · VIF / n)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Variance inflation factor', value: sum.toFixed(6) },
        { label: 'Effective sample size', value: ess.toFixed(2) },
        { label: 'Truncation lag', value: String(truncation) },
        { label: 'i.i.d. standard error', value: naiveSe.toExponential(6) },
        { label: 'Corrected standard error', value: correctedSe.toExponential(6) },
      ],
      assumptions: [
        'The series is stationary with a summable autocovariance function.',
        'The reference quantile is the large-sample normal one; with a small effective sample size the interval is optimistic even after the variance correction.',
      ],
      limitations: [
        'The autocorrelation sum is estimated and truncated, so the inflation factor itself has sampling error — larger than for the mean it corrects.',
        'This corrects the variance of the MEAN. It does not make any other i.i.d. procedure valid on this series.',
      ],
    }),
    warnings,
  };
}

/**
 * Two-sided p-value for the mean against a hypothesised value, using the
 * autocorrelation-corrected standard error and the effective sample size as
 * degrees of freedom. Provided so the correction can actually be used, rather
 * than only displayed.
 */
export function correctedMeanTest(series: ArrayLike<number>, mu0 = 0): TsTestResult {
  const ess = effectiveSampleSize(series);
  const t = (ess.mean - mu0) / ess.correctedStandardError;
  const df = Math.max(1, ess.ess - 1);
  const p = studentTTwoSided(t, df);
  const naiveT = (ess.mean - mu0) / ess.naiveStandardError;
  const naiveP = studentTTwoSided(naiveT, ess.n - 1);
  return {
    name: 'Mean test with autocorrelation-corrected standard error',
    statistic: t,
    df,
    pValue: p,
    pValueBracket: null,
    criticalValues: null,
    rejectAt: [0.1, 0.05, 0.01].map((l) => ({ level: l, reject: p < l })),
    nullHypothesis: `The mean of the series equals ${mu0}.`,
    alternative: `The mean differs from ${mu0}.`,
    interpretation:
      `Corrected: t = ${t.toFixed(4)}, p = ${p.toExponential(3)} on ${df.toFixed(1)} effective degrees of freedom. ` +
      `The i.i.d. computation would have given t = ${naiveT.toFixed(4)}, p = ${naiveP.toExponential(3)} — ` +
      `${naiveP < p ? 'too small, i.e. falsely confident' : 'larger'}, because it ignores a variance inflation of ${ess.varianceInflationFactor.toFixed(2)}.`,
    explanation: explain('t test on the mean using the long-run variance', 'numerical', {
      formula: 't = (x̄ − μ₀) / √(s² · VIF / n),  df ≈ n_eff − 1',
      steps: ess.explanation.steps,
      assumptions: ess.explanation.assumptions,
      limitations: [
        ...ess.explanation.limitations,
        'Using n_eff − 1 as degrees of freedom is a pragmatic approximation, not an exact distributional result.',
      ],
    }),
    warnings: ess.warnings,
  };
}
