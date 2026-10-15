/**
 * Residual diagnostics and volatility modelling.
 *
 * A model whose residuals are still autocorrelated has not extracted the
 * structure, and its forecast intervals are wrong. `residualDiagnostics`
 * therefore ends in an explicit verdict on whether the residuals look like
 * white noise, rather than leaving the user to read four p-values.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { explain, type TsTestResult } from './types';
import { durbinWatson, portmanteau } from './dependence';
import { checkSeries, chiSquareSf, meanOf, minimise, ols } from './util';

/** Jarque–Bera normality test on the residuals. */
export function jarqueBera(residuals: ArrayLike<number>): TsTestResult {
  const e = checkSeries(residuals, 8, 'residual series');
  const n = e.length;
  const m = meanOf(e);
  const d = e.map((v) => v - m);
  const m2 = stableSum(d.map((v) => v * v)) / n;
  if (!(m2 > 0)) throw new EngineError('The residuals have zero variance, so no normality test is defined.', 'degenerate');
  const m3 = stableSum(d.map((v) => v * v * v)) / n;
  const m4 = stableSum(d.map((v) => v * v * v * v)) / n;
  const skew = m3 / Math.pow(m2, 1.5);
  const kurt = m4 / (m2 * m2) - 3;
  const jb = (n / 6) * (skew * skew + (kurt * kurt) / 4);
  const p = chiSquareSf(jb, 2);
  return {
    name: 'Jarque–Bera normality',
    statistic: jb,
    df: 2,
    pValue: p,
    pValueBracket: null,
    criticalValues: null,
    rejectAt: [0.1, 0.05, 0.01].map((l) => ({ level: l, reject: p < l })),
    nullHypothesis: 'The residuals are normally distributed.',
    alternative: 'The residuals have non-normal skewness or kurtosis.',
    interpretation:
      p < 0.05
        ? `Normality is rejected (skewness ${skew.toFixed(3)}, excess kurtosis ${kurt.toFixed(3)}, p = ${p.toExponential(3)}). The point forecasts remain usable but the prediction intervals, which use a normal quantile, will be wrong in the tails — usually too narrow.`
        : `Normality is not rejected (skewness ${skew.toFixed(3)}, excess kurtosis ${kurt.toFixed(3)}, p = ${p.toFixed(4)}). With n = ${n} this test has limited power against moderate non-normality.`,
    explanation: explain('Jarque–Bera test on skewness and excess kurtosis', 'numerical', {
      formula: 'JB = (n/6)(S² + K²/4),  asymptotically χ²₂',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Skewness', value: skew.toFixed(6) },
        { label: 'Excess kurtosis', value: kurt.toFixed(6) },
      ],
      assumptions: ['The chi-square reference is asymptotic and is known to be poor below about n = 50.'],
      limitations: ['Normality of the innovations matters for the intervals, not for the consistency of the coefficients.', 'The test is driven by the tails and is very sensitive to a few outliers.'],
    }),
    warnings: n < 50 ? [`With n = ${n} the Jarque–Bera chi-square approximation is unreliable; it rejects too often.`] : [],
  };
}

/**
 * Engle's LM test for ARCH effects: regress e_t² on a constant and q lags of
 * e_t², then LM = n·R² ~ χ²_q under the null of no heteroskedasticity.
 *
 * Levels can be perfectly uncorrelated while squares are strongly dependent,
 * which is the normal state of affairs in financial and demand data. When this
 * test fires, the model's prediction intervals are the wrong width at almost
 * every point in time even though they are the right width on average.
 */
export function archTest(residuals: ArrayLike<number>, lags = 5): TsTestResult {
  if (!Number.isInteger(lags) || lags < 1) throw new EngineError(`The ARCH test lag order must be a whole number of at least 1 (received ${lags}).`, 'range');
  const e = checkSeries(residuals, lags + 10, 'residual series');
  const n = e.length;
  const m = meanOf(e);
  const sq = e.map((v) => (v - m) * (v - m));
  const rows: number[][] = [];
  const target: number[] = [];
  for (let t = lags; t < n; t++) {
    const row = [1];
    for (let i = 1; i <= lags; i++) row.push(sq[t - i]);
    rows.push(row);
    target.push(sq[t]);
  }
  const fit = ols(rows, target);
  const lm = fit.n * fit.r2;
  const p = chiSquareSf(lm, lags);
  return {
    name: "Engle's ARCH LM",
    statistic: lm,
    df: lags,
    pValue: p,
    pValueBracket: null,
    criticalValues: null,
    rejectAt: [0.1, 0.05, 0.01].map((l) => ({ level: l, reject: p < l })),
    nullHypothesis: `The squared residuals have no autocorrelation up to lag ${lags} (constant conditional variance).`,
    alternative: 'The conditional variance changes over time (ARCH effects).',
    interpretation:
      p < 0.05
        ? `ARCH effects are present (LM = ${lm.toFixed(4)}, p = ${p.toExponential(3)}). The variance is not constant: volatility clusters. Prediction intervals of constant width are too narrow in turbulent periods and too wide in calm ones, even if their average width is right. Model the variance (see garch11).`
        : `No ARCH effects detected up to lag ${lags} (LM = ${lm.toFixed(4)}, p = ${p.toFixed(4)}). This does not establish constant variance; a slow variance drift would not show up here.`,
    explanation: explain("Engle's Lagrange-multiplier test for ARCH effects", 'numerical', {
      formula: 'e_t² = α₀ + Σ α_i e_{t−i}² + u_t ;  LM = n R² ~ χ²_q',
      steps: [
        { label: 'Observations in the auxiliary regression', value: String(fit.n) },
        { label: 'Lags', value: String(lags) },
        { label: 'Auxiliary R²', value: fit.r2.toFixed(6) },
      ],
      assumptions: ['The residuals are mean-zero and the mean model has already been fitted; an unmodelled mean can show up here as spurious ARCH.'],
      limitations: ['The test does not distinguish ARCH from a structural break in variance or from outliers.', 'Rejection says the variance moves, not how.'],
    }),
    warnings: [],
  };
}

export interface ResidualDiagnostics {
  n: number;
  ljungBox: TsTestResult;
  ljungBoxLongLag: TsTestResult | null;
  normality: TsTestResult;
  arch: TsTestResult;
  durbinWatson: TsTestResult;
  mean: number;
  sd: number;
  /** Whether the mean of the residuals is distinguishable from zero. */
  meanIsZero: boolean;
  /** The overall verdict on white noise, and the reasons behind it. */
  whiteNoise: boolean;
  verdict: string;
  failures: string[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Full residual diagnostic battery with a verdict.
 *
 * `fitDf` must be the number of parameters of the model the residuals came
 * from, so the Ljung–Box degrees of freedom are reduced correctly.
 */
export function residualDiagnostics(
  residuals: ArrayLike<number>,
  options: { fitDf?: number; lags?: number; archLags?: number; level?: number } = {},
): ResidualDiagnostics {
  const fitDf = options.fitDf ?? 0;
  const level = options.level ?? 0.05;
  const e = checkSeries(residuals, 16, 'residual series');
  const n = e.length;
  const lags = options.lags ?? Math.max(fitDf + 1, Math.min(10, Math.floor(n / 5)));
  const lb = portmanteau(e, { lags, fitDf, onResiduals: true });
  let lbLong: TsTestResult | null = null;
  const longLags = Math.min(n - 2, Math.max(lags * 2, 20));
  if (longLags > lags && longLags > fitDf + 1) {
    try {
      lbLong = portmanteau(e, { lags: longLags, fitDf, onResiduals: true });
    } catch {
      lbLong = null;
    }
  }
  const jb = jarqueBera(e);
  const archLags = options.archLags ?? Math.min(5, Math.max(1, Math.floor(n / 10)));
  const arch = archTest(e, archLags);
  const dw = durbinWatson(e);
  const m = meanOf(e);
  const sd = Math.sqrt(stableSum(e.map((v) => (v - m) * (v - m))) / (n - 1));
  const meanT = sd > 0 ? Math.abs(m) / (sd / Math.sqrt(n)) : 0;
  const meanIsZero = meanT < 2;
  const failures: string[] = [];
  if ((lb.pValue ?? 1) < level) failures.push(`Ljung–Box rejects at ${lags} lags (p = ${(lb.pValue ?? 1).toExponential(3)}): the residuals are still autocorrelated, so the model has not extracted the structure and its forecast intervals are too narrow.`);
  if (lbLong && (lbLong.pValue ?? 1) < level) failures.push(`Ljung–Box rejects at ${longLags} lags (p = ${(lbLong.pValue ?? 1).toExponential(3)}): there is dependence at longer lags, often a missed seasonal term.`);
  if ((arch.pValue ?? 1) < level) failures.push(`The ARCH test rejects (p = ${(arch.pValue ?? 1).toExponential(3)}): the conditional variance is not constant, so the interval WIDTH is wrong period by period.`);
  if (!meanIsZero) failures.push(`The residual mean ${m.toExponential(3)} is ${meanT.toFixed(1)} standard errors from zero: the model is biased, and every forecast inherits that bias.`);
  const normalityFailed = (jb.pValue ?? 1) < level;
  const whiteNoise = failures.length === 0;
  const verdict = whiteNoise
    ? normalityFailed
      ? `The residuals pass as white noise — no remaining autocorrelation, no ARCH effects, no bias — but they are not normally distributed (Jarque–Bera p = ${(jb.pValue ?? 1).toExponential(3)}). The model has extracted the linear structure; the prediction intervals are the right width on average but the wrong shape in the tails.`
      : 'The residuals look like white noise: no remaining autocorrelation, no ARCH effects, no bias, and normality is not rejected. This is the condition under which the model\'s prediction intervals are meaningful — though it still says nothing about whether the model will keep working out of sample.'
    : `The residuals are NOT white noise. ${failures.length} diagnostic(s) failed, so the model is misspecified and its prediction intervals should not be used as stated: ${failures.join(' ')}`;
  const warnings: string[] = [...lb.warnings, ...jb.warnings];
  if (whiteNoise) {
    warnings.push('Passing these diagnostics is a necessary condition, not a sufficient one. Residuals can look like white noise in sample and the model can still forecast badly out of sample — backtest it.');
  }
  if (fitDf === 0) {
    warnings.push('fitDf was 0, so no degrees-of-freedom adjustment was made to the Ljung–Box test. If these are model residuals, pass the number of fitted parameters or the test will be too conservative.');
  }
  return {
    n,
    ljungBox: lb,
    ljungBoxLongLag: lbLong,
    normality: jb,
    arch,
    durbinWatson: dw,
    mean: m,
    sd,
    meanIsZero,
    whiteNoise,
    verdict,
    failures,
    explanation: explain('Residual diagnostic battery with a white-noise verdict', 'numerical', {
      steps: [
        { label: 'Residuals', value: String(n) },
        { label: 'Fitted parameters removed from the Ljung–Box df', value: String(fitDf) },
        { label: `Ljung–Box (${lags} lags)`, value: `Q = ${lb.statistic.toFixed(4)}, p = ${(lb.pValue ?? NaN).toExponential(3)}` },
        ...(lbLong ? [{ label: `Ljung–Box (${longLags} lags)`, value: `Q = ${lbLong.statistic.toFixed(4)}, p = ${(lbLong.pValue ?? NaN).toExponential(3)}` }] : []),
        { label: 'Jarque–Bera', value: `JB = ${jb.statistic.toFixed(4)}, p = ${(jb.pValue ?? NaN).toExponential(3)}` },
        { label: `ARCH LM (${archLags} lags)`, value: `LM = ${arch.statistic.toFixed(4)}, p = ${(arch.pValue ?? NaN).toExponential(3)}` },
        { label: 'Durbin–Watson', value: dw.statistic.toFixed(4) },
        { label: 'Residual mean', value: `${m.toExponential(4)} (${meanT.toFixed(2)} standard errors from zero)` },
      ],
      assumptions: ['All four tests use asymptotic reference distributions.'],
      limitations: [
        'Four tests at the 5% level on the same residuals give roughly an 18% chance of at least one false alarm if the model is in fact correct. Read the pattern, not a single rejection.',
        'None of these tests can detect that the model will stop working in the future.',
      ],
    }),
    warnings,
  };
}

export interface Garch11Fit {
  omega: number;
  alpha: number;
  beta: number;
  /** α + β: how long a volatility shock persists. */
  persistence: number;
  /** Unconditional variance ω/(1 − α − β), when it exists. */
  unconditionalVariance: number | null;
  /** Fitted conditional variances σ²_t. */
  conditionalVariance: number[];
  /** Standardised residuals e_t/σ_t, which should be i.i.d. if the model fits. */
  standardisedResiduals: number[];
  logLikelihood: number;
  aic: number;
  bic: number;
  converged: boolean;
  /** Diagnostics on the standardised residuals: ARCH should no longer fire. */
  standardisedArch: TsTestResult;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * GARCH(1,1) by Gaussian maximum likelihood:
 *   σ²_t = ω + α e²_{t−1} + β σ²_{t−1}
 *
 * Parameters are reparameterised so that ω > 0 and α, β > 0 with α + β < 1 is
 * enforced during optimisation. A fit whose persistence reaches 1 is refused,
 * not reported: with α + β ≥ 1 the unconditional variance does not exist and
 * every variance forecast diverges.
 */
export function garch11(residuals: ArrayLike<number>, options: { maxPersistence?: number } = {}): Garch11Fit {
  const e = checkSeries(residuals, 40, 'residual series');
  const n = e.length;
  const maxPersistence = options.maxPersistence ?? 0.9999;
  const m = meanOf(e);
  const x = e.map((v) => v - m);
  const sampleVar = stableSum(x.map((v) => v * v)) / n;
  if (!(sampleVar > 0)) throw new EngineError('The residual series has zero variance; no GARCH model can be fitted.', 'degenerate');
  const logistic = (z: number): number => 1 / (1 + Math.exp(-z));
  // α = s·u, β = s·(1−u) with s = persistence in (0, maxPersistence).
  const unpack = (z: number[]): { omega: number; alpha: number; beta: number } => {
    const s = maxPersistence * logistic(z[0]);
    const u = logistic(z[1]);
    const omega = Math.exp(z[2]);
    return { omega, alpha: s * u, beta: s * (1 - u) };
  };
  const negLogLik = (z: number[]): number => {
    const { omega, alpha, beta } = unpack(z);
    if (!(omega > 0) || alpha + beta >= 1) return 1e300;
    let h = sampleVar;
    let ll = 0;
    for (let t = 0; t < n; t++) {
      if (!(h > 0) || !Number.isFinite(h)) return 1e300;
      ll += -0.5 * (Math.log(2 * Math.PI) + Math.log(h) + (x[t] * x[t]) / h);
      h = omega + alpha * x[t] * x[t] + beta * h;
    }
    return Number.isFinite(ll) ? -ll : 1e300;
  };
  const z0 = [Math.log(0.95 / (maxPersistence - 0.95)), Math.log(0.1 / 0.9), Math.log(Math.max(sampleVar * 0.05, 1e-12))];
  const res = minimise(negLogLik, z0, { maxIter: 1500, tol: 1e-10 });
  if (!res.converged || res.fx >= 1e299 || !Number.isFinite(res.fx)) {
    throw new EngineError(
      `GARCH(1,1) maximum likelihood did not converge (objective ${res.fx.toExponential(3)} after ${res.iterations} iterations). No volatility model is reported.`,
      'non-convergence',
    );
  }
  const { omega, alpha, beta } = unpack(res.x);
  const persistence = alpha + beta;
  if (persistence >= 1) {
    throw new EngineError(
      `The fitted GARCH(1,1) has persistence α + β = ${persistence.toFixed(6)} ≥ 1. The unconditional variance does not exist and every variance forecast diverges, so this fit is refused rather than reported. An IGARCH-type series needs a model that is built for it.`,
      'non-stationary-variance',
    );
  }
  const h = new Array<number>(n).fill(0);
  let cur = sampleVar;
  let ll = 0;
  for (let t = 0; t < n; t++) {
    h[t] = cur;
    ll += -0.5 * (Math.log(2 * Math.PI) + Math.log(cur) + (x[t] * x[t]) / cur);
    cur = omega + alpha * x[t] * x[t] + beta * cur;
  }
  const std = x.map((v, t) => v / Math.sqrt(h[t]));
  const k = 3;
  const warnings: string[] = [];
  if (persistence > 0.99) {
    warnings.push(
      `Persistence α + β = ${persistence.toFixed(5)} is very close to 1. Volatility shocks decay with a half-life of about ${(Math.log(0.5) / Math.log(persistence)).toFixed(0)} observations, the unconditional variance is barely identified, and the variance forecast is close to a random walk. Treat long-horizon variance forecasts as unusable.`,
    );
  }
  if (alpha < 1e-6) warnings.push('α is essentially zero, so the model is not responding to shocks at all — there may be no ARCH effect to model.');
  let stdArch: TsTestResult;
  try {
    stdArch = archTest(std, Math.min(5, Math.max(1, Math.floor(n / 10))));
  } catch (err) {
    throw new EngineError(
      `The GARCH fit succeeded but its standardised residuals could not be tested for remaining ARCH effects: ${err instanceof Error ? err.message : String(err)}`,
      'numerical',
    );
  }
  if ((stdArch.pValue ?? 1) < 0.05) {
    warnings.push(`The standardised residuals still show ARCH effects (p = ${(stdArch.pValue ?? 1).toExponential(3)}): GARCH(1,1) has not captured the volatility dynamics.`);
  }
  return {
    omega,
    alpha,
    beta,
    persistence,
    unconditionalVariance: omega / (1 - persistence),
    conditionalVariance: h,
    standardisedResiduals: std,
    logLikelihood: ll,
    aic: -2 * ll + 2 * k,
    bic: -2 * ll + Math.log(n) * k,
    converged: true,
    standardisedArch: stdArch,
    explanation: explain('GARCH(1,1) by Gaussian maximum likelihood', 'numerical', {
      formula: 'σ²_t = ω + α e²_{t−1} + β σ²_{t−1}',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'ω', value: omega.toExponential(6) },
        { label: 'α', value: alpha.toFixed(6) },
        { label: 'β', value: beta.toFixed(6) },
        { label: 'Persistence α + β', value: persistence.toFixed(6) },
        { label: 'Unconditional variance ω/(1−α−β)', value: (omega / (1 - persistence)).toExponential(6) },
        { label: 'Volatility half-life', value: `${(Math.log(0.5) / Math.log(persistence)).toFixed(1)} observations` },
        { label: 'log-likelihood', value: ll.toFixed(6) },
      ],
      assumptions: [
        'Gaussian innovations. Financial returns are usually heavier-tailed than that, so the coefficients stay consistent (quasi-ML) but the standard errors do not.',
        'The first conditional variance is initialised at the sample variance.',
        'The mean is removed before fitting; a GARCH fitted to residuals that still have a mean or autocorrelation will attribute that to volatility.',
      ],
      limitations: [
        'No standard errors are reported for ω, α and β: the likelihood is strongly curved near the α + β = 1 boundary and a numerical Hessian there is not trustworthy.',
        'GARCH(1,1) is symmetric: it treats a large rise and a large fall identically. Financial data usually show the opposite (leverage effects).',
        'A fit with persistence at or above 1 is refused, because such a model has no unconditional variance.',
      ],
    }),
    warnings,
  };
}
