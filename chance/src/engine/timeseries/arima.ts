/**
 * AR, ARMA and ARIMA estimation and forecasting.
 *
 * The likelihood is the EXACT Gaussian likelihood computed by a Kalman filter
 * on the Harvey state-space form of the ARMA model, with the innovation
 * variance concentrated out. That is the better of the two routes the brief
 * allowed (the other being a conditional sum of squares, which discards the
 * first p observations and is biased for moving-average terms); the
 * conditional least-squares AR fit is also provided, because it is a useful
 * independent check on the Yule–Walker one.
 *
 * Forecast variances come from the ψ-weights of the integrated model, so they
 * reproduce the closed-form AR(1) result σ²(1 − φ^{2h})/(1 − φ²) exactly.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { solve } from '../stats/linalg';
import { explain, FORECAST_CAVEATS, type TsInterval } from './types';
import { pacf } from './dependence';
import { difference } from './stationarity';
import { arToPacf, checkSeries, isInvertibleMa, isStationaryAr, meanOf, minimise, ols, pacfToAr, zQuantile } from './util';

export interface ArFit {
  order: number;
  /** AR coefficients φ₁…φ_p. */
  phi: number[];
  /** Intercept, when one was fitted. */
  intercept: number | null;
  mean: number;
  sigma2: number;
  method: 'yule-walker' | 'conditional-least-squares';
  se: number[] | null;
  stationary: boolean;
  residuals: number[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Yule–Walker AR(p) estimation: solve the Toeplitz system of sample
 * autocorrelations by the Durbin–Levinson recursion. The resulting
 * coefficients are always stationary by construction.
 */
export function yuleWalker(series: ArrayLike<number>, order: number): ArFit {
  if (!Number.isInteger(order) || order < 1) throw new EngineError(`The AR order must be a whole number of at least 1 (received ${order}).`, 'range');
  const y = checkSeries(series, order + 2, 'series');
  const n = y.length;
  if (n < order + 2) {
    throw new EngineError(`An AR(${order}) fit needs at least ${order + 2} observations; the series has ${n}.`, 'too-short');
  }
  const p = pacf(y, Math.min(order, n - 1));
  const phi = p.arByOrder[order];
  if (!phi) throw new EngineError(`The Durbin–Levinson recursion did not reach order ${order}.`, 'numerical');
  const sigma2 = p.innovationVariance[order];
  const m = meanOf(y);
  const residuals: number[] = [];
  for (let t = order; t < n; t++) {
    let f = m;
    for (let i = 0; i < order; i++) f += phi[i] * (y[t - 1 - i] - m);
    residuals.push(y[t] - f);
  }
  return {
    order,
    phi: [...phi],
    intercept: m * (1 - stableSum(phi)),
    mean: m,
    sigma2,
    method: 'yule-walker',
    // Large-sample approximation: for a fitted AR(p) the coefficient standard
    // errors are approximately √((1 − Σφ²)/n). This is a rough figure; the
    // exact-likelihood fit reports Hessian-based standard errors instead.
    se: phi.map(() => Math.sqrt(Math.max(0, 1 - phi.reduce((s, v) => s + v * v, 0)) / n)),
    stationary: isStationaryAr([...phi]),
    residuals,
    explanation: explain(`Yule–Walker AR(${order}) estimation via the Durbin–Levinson recursion`, 'empirical', {
      formula: 'ρ_k = Σ φ_i ρ_{k−i}, k = 1..p  (the Yule–Walker equations)',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Order', value: String(order) },
        ...phi.map((v, i) => ({ label: `φ${i + 1}`, value: v.toFixed(6) })),
        { label: 'Innovation variance', value: sigma2.toExponential(6) },
      ],
      assumptions: ['The series is stationary with a constant mean, which is subtracted before fitting.', 'The estimator is method-of-moments on the sample ACF, not maximum likelihood.'],
      limitations: [
        'Yule–Walker coefficients are always stationary, which is convenient but means the method cannot signal that the data look non-stationary — it will quietly return a root close to 1 instead.',
        'The reported standard errors are the large-sample approximation and are rough.',
        'Yule–Walker is noticeably biased in small samples; prefer the exact-likelihood ARIMA fit when n is small.',
      ],
    }),
    warnings: isStationaryAr([...phi]) ? [] : ['The fitted coefficients are not stationary, which should not happen for Yule–Walker — treat this result as a numerical failure.'],
  };
}

/**
 * Conditional least-squares AR(p): ordinary regression of y_t on an intercept
 * and y_{t−1}…y_{t−p}, conditioning on the first p observations. This is an
 * independent route to the same coefficients and should agree with
 * Yule–Walker to within sampling error.
 */
export function arConditionalLeastSquares(series: ArrayLike<number>, order: number, options: { includeMean?: boolean } = {}): ArFit {
  if (!Number.isInteger(order) || order < 1) throw new EngineError(`The AR order must be a whole number of at least 1 (received ${order}).`, 'range');
  const includeMean = options.includeMean ?? true;
  const y = checkSeries(series, order + (includeMean ? 2 : 1) + 1, 'series');
  const n = y.length;
  const rows: number[][] = [];
  const target: number[] = [];
  for (let t = order; t < n; t++) {
    const row: number[] = includeMean ? [1] : [];
    for (let i = 1; i <= order; i++) row.push(y[t - i]);
    rows.push(row);
    target.push(y[t]);
  }
  const fit = ols(rows, target);
  const phi = includeMean ? fit.beta.slice(1) : fit.beta;
  const se = includeMean ? fit.se.slice(1) : fit.se;
  const intercept = includeMean ? fit.beta[0] : null;
  const sumPhi = stableSum(phi);
  const stationary = isStationaryAr([...phi]);
  const mean = includeMean && Math.abs(1 - sumPhi) > 1e-12 ? (intercept as number) / (1 - sumPhi) : meanOf(y);
  return {
    order,
    phi,
    intercept,
    mean,
    sigma2: fit.sigma2,
    method: 'conditional-least-squares',
    se,
    stationary,
    residuals: fit.residuals,
    explanation: explain(`Conditional least-squares AR(${order})`, 'numerical', {
      formula: 'y_t = c + Σ φ_i y_{t−i} + ε_t, estimated by OLS for t = p+1..n',
      steps: [
        { label: 'Observations used', value: String(fit.n) },
        { label: 'Observations conditioned away', value: String(order) },
        ...phi.map((v, i) => ({ label: `φ${i + 1}`, value: `${v.toFixed(6)} (se ${se[i].toFixed(6)})` })),
        { label: 'Residual variance', value: fit.sigma2.toExponential(6) },
      ],
      assumptions: ['The first p observations are treated as fixed, so the likelihood is conditional rather than exact.', 'The errors are homoskedastic and uncorrelated — check the residuals.'],
      limitations: [
        `${order} observation(s) are discarded, which matters when n is small.`,
        'Nothing constrains the fit to be stationary, so an explosive fit is possible and is reported as such rather than hidden.',
      ],
    }),
    warnings: stationary
      ? []
      : [
          'The fitted AR coefficients imply a non-stationary (explosive or unit-root) process. Forecasts from this fit diverge and its prediction intervals are not meaningful — difference the series instead.',
        ],
  };
}

interface StateSpace {
  r: number;
  T: number[][];
  R: number[];
}

function buildStateSpace(phi: number[], theta: number[]): StateSpace {
  const p = phi.length;
  const q = theta.length;
  const r = Math.max(p, q + 1);
  const T: number[][] = Array.from({ length: r }, () => new Array<number>(r).fill(0));
  for (let i = 0; i < r; i++) {
    if (i < p) T[i][0] = phi[i];
    if (i + 1 < r) T[i][i + 1] = 1;
  }
  const R = new Array<number>(r).fill(0);
  R[0] = 1;
  for (let j = 0; j < q; j++) R[j + 1] = theta[j];
  return { r, T, R };
}

/** Stationary state covariance: solve P = T P T' + R R'. */
function initialStateCovariance(ss: StateSpace): number[][] {
  const { r, T, R } = ss;
  const dim = r * r;
  const A: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const b = new Array<number>(dim).fill(0);
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < r; j++) {
      const row = i * r + j;
      A[row][row] += 1;
      for (let k = 0; k < r; k++) {
        for (let l = 0; l < r; l++) {
          A[row][k * r + l] -= T[i][k] * T[j][l];
        }
      }
      b[row] = R[i] * R[j];
    }
  }
  const sol = solve(A, b);
  if (sol === null) {
    throw new EngineError(
      'The stationary state covariance of the state-space form is singular, which means the proposed parameters are on or outside the stationarity boundary. No likelihood can be evaluated there.',
      'non-stationary',
    );
  }
  const P: number[][] = Array.from({ length: r }, () => new Array<number>(r).fill(0));
  for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) P[i][j] = sol[i * r + j];
  return P;
}

export interface KalmanOutput {
  logLikelihood: number;
  sigma2: number;
  /** One-step prediction errors standardised to constant variance σ². */
  residuals: number[];
  /** Raw prediction errors v_t and their relative variances F_t. */
  v: number[];
  f: number[];
}

/**
 * Exact Gaussian log-likelihood of an ARMA(p, q) model for a zero-mean series,
 * by the Kalman filter with σ² concentrated out.
 *
 * ℓ = −n/2 (log 2π + log σ̂² + 1) − ½ Σ log F_t,  σ̂² = (1/n) Σ v_t²/F_t
 */
export function armaKalman(w: number[], phi: number[], theta: number[]): KalmanOutput {
  const n = w.length;
  if (n < 2) throw new EngineError('The Kalman filter needs at least 2 observations.', 'too-short');
  if (!isStationaryAr(phi)) throw new EngineError('The proposed AR coefficients are not stationary; the exact likelihood is undefined there.', 'non-stationary');
  const ss = buildStateSpace(phi, theta);
  const { r, T, R } = ss;
  let P = initialStateCovariance(ss);
  let a = new Array<number>(r).fill(0);
  let sumLogF = 0;
  let sumVF = 0;
  const v = new Array<number>(n);
  const f = new Array<number>(n);
  for (let t = 0; t < n; t++) {
    const F = P[0][0];
    if (!(F > 0) || !Number.isFinite(F)) {
      throw new EngineError(`The Kalman filter produced a non-positive prediction variance at observation ${t}; the likelihood cannot be evaluated.`, 'numerical');
    }
    const vt = w[t] - a[0];
    v[t] = vt;
    f[t] = F;
    sumLogF += Math.log(F);
    sumVF += (vt * vt) / F;
    const col0 = new Array<number>(r);
    for (let i = 0; i < r; i++) col0[i] = P[i][0];
    const aUpd = new Array<number>(r);
    for (let i = 0; i < r; i++) aUpd[i] = a[i] + (col0[i] * vt) / F;
    const pUpd: number[][] = Array.from({ length: r }, () => new Array<number>(r).fill(0));
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) pUpd[i][j] = P[i][j] - (col0[i] * col0[j]) / F;
    const aNext = new Array<number>(r).fill(0);
    for (let i = 0; i < r; i++) for (let k = 0; k < r; k++) aNext[i] += T[i][k] * aUpd[k];
    const tmp: number[][] = Array.from({ length: r }, () => new Array<number>(r).fill(0));
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) for (let k = 0; k < r; k++) tmp[i][j] += T[i][k] * pUpd[k][j];
    const pNext: number[][] = Array.from({ length: r }, () => new Array<number>(r).fill(0));
    for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) {
      let s = 0;
      for (let k = 0; k < r; k++) s += tmp[i][k] * T[j][k];
      pNext[i][j] = s + R[i] * R[j];
    }
    a = aNext;
    P = pNext;
  }
  const sigma2 = sumVF / n;
  if (!(sigma2 > 0)) throw new EngineError('The concentrated innovation variance came out non-positive; the series may be constant.', 'degenerate');
  const logLikelihood = -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sigma2) + 1) - 0.5 * sumLogF;
  const residuals = new Array<number>(n);
  for (let t = 0; t < n; t++) residuals[t] = v[t] / Math.sqrt(f[t]);
  return { logLikelihood, sigma2, residuals, v, f };
}

export interface ArimaFit {
  p: number;
  d: number;
  q: number;
  phi: number[];
  theta: number[];
  /** Mean of the differenced series (the drift when d > 0). */
  mean: number;
  includeMean: boolean;
  sigma2: number;
  logLikelihood: number;
  aic: number;
  aicc: number;
  bic: number;
  /** Number of estimated parameters including σ² and the mean. */
  parameterCount: number;
  /** Covariance of (φ, θ, mean) from the numerical Hessian, or null if it was not positive definite. */
  parameterCovariance: number[][] | null;
  standardErrors: number[] | null;
  parameterNames: string[];
  /** Residuals of the differenced series (exact one-step innovations). */
  residuals: number[];
  /** The differenced series the ARMA part was fitted to. */
  differenced: number[];
  /** The original series, kept for integrating the forecast back. */
  original: number[];
  stationary: boolean;
  invertible: boolean;
  estimation: 'exact-kalman-likelihood';
  converged: boolean;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Fit an ARIMA(p, d, q) by exact maximum likelihood.
 *
 * The series is differenced d times, then the ARMA(p, q) part is fitted to the
 * differenced series by maximising the exact Kalman-filter likelihood. The
 * optimiser works in an unconstrained parameterisation that maps to
 * stationary AR and invertible MA coefficients, so it cannot wander outside
 * the admissible region and then report a nonsense fit.
 */
export function fitArima(
  series: ArrayLike<number>,
  options: { p?: number; d?: number; q?: number; includeMean?: boolean } = {},
): ArimaFit {
  const p = options.p ?? 1;
  const d = options.d ?? 0;
  const q = options.q ?? 0;
  for (const [name, v] of [['p', p], ['d', d], ['q', q]] as [string, number][]) {
    if (!Number.isInteger(v) || v < 0 || v > 12) throw new EngineError(`The ARIMA order ${name} must be a whole number in [0, 12] (received ${v}).`, 'range');
  }
  if (p === 0 && q === 0 && d === 0) {
    throw new EngineError('An ARIMA(0,0,0) is not a model of dependence — there is nothing to fit. Choose a non-zero order.', 'invalid');
  }
  const includeMean = options.includeMean ?? d === 0;
  const minN = d + Math.max(p, q) + 6;
  const y = checkSeries(series, minN, 'series');
  const n = y.length;
  const w = d > 0 ? difference(y, { d }).values : [...y];
  const m = w.length;
  // A constant (differenced) series has no likelihood surface: the maximum is
  // at an innovation variance of zero, where the log-likelihood diverges. The
  // optimiser would wander along that ridge and return an arbitrary pair of
  // coefficients, so the fit is refused here instead.
  const wMean = meanOf(w);
  const wVar = stableSum(w.map((v) => (v - wMean) * (v - wMean))) / m;
  if (!(wVar > 1e-24 * Math.max(1, wMean * wMean))) {
    throw new EngineError(
      `The series${d > 0 ? ` after ${d} difference(s)` : ''} is constant to working precision (variance ${wVar.toExponential(3)}). ` +
        'There is no variation for an ARIMA model to explain and no innovation variance to estimate, so no fit is reported.',
      'degenerate',
    );
  }
  if (m < Math.max(p, q) + 5) {
    throw new EngineError(
      `After ${d} difference(s) only ${m} observations remain, which is not enough to identify an ARMA(${p},${q}) (at least ${Math.max(p, q) + 5} are needed).`,
      'too-short',
    );
  }

  const negLogLikNatural = (phi: number[], theta: number[], mu: number): number => {
    if (!isStationaryAr(phi)) return 1e300;
    try {
      const centred = w.map((v) => v - mu);
      return -armaKalman(centred, phi, theta).logLikelihood;
    } catch {
      return 1e300;
    }
  };

  // Starting values: Yule–Walker for the AR part, zeros for the MA part.
  let startPhi = new Array<number>(p).fill(0);
  if (p > 0) {
    try {
      startPhi = yuleWalker(w, p).phi;
      if (!isStationaryAr(startPhi)) startPhi = new Array<number>(p).fill(0);
    } catch {
      startPhi = new Array<number>(p).fill(0);
    }
  }
  const startMean = includeMean ? meanOf(w) : 0;
  const z0 = [...arToPacf(startPhi), ...new Array<number>(q).fill(0), ...(includeMean ? [startMean] : [])];
  const unpack = (z: number[]): { phi: number[]; theta: number[]; mu: number } => ({
    phi: pacfToAr(z.slice(0, p)),
    theta: pacfToAr(z.slice(p, p + q)),
    mu: includeMean ? z[p + q] : 0,
  });
  const res = minimise(
    (z) => {
      const { phi, theta, mu } = unpack(z);
      return negLogLikNatural(phi, theta, mu);
    },
    z0.length > 0 ? z0 : [0],
    { maxIter: 800, tol: 1e-9 },
  );
  if (!res.converged || res.fx >= 1e299 || !Number.isFinite(res.fx)) {
    throw new EngineError(
      `Maximum-likelihood estimation of ARIMA(${p},${d},${q}) did not converge (objective ${res.fx.toExponential(3)} after ${res.iterations} iterations). ` +
        'No coefficients are reported: a non-converged fit would be a plausible-looking set of numbers with no claim to being the maximum.',
      'non-convergence',
    );
  }
  const { phi, theta, mu } = unpack(res.x);
  const centred = w.map((v) => v - mu);
  const k = armaKalman(centred, phi, theta);
  const nPar = p + q + (includeMean ? 1 : 0);
  const nParWithSigma = nPar + 1;
  const aic = -2 * k.logLikelihood + 2 * nParWithSigma;
  const aicc = m - nParWithSigma - 1 > 0 ? aic + (2 * nParWithSigma * (nParWithSigma + 1)) / (m - nParWithSigma - 1) : Infinity;
  const bic = -2 * k.logLikelihood + Math.log(m) * nParWithSigma;

  // Numerical Hessian of the negative log-likelihood in natural coordinates.
  const natural = [...phi, ...theta, ...(includeMean ? [mu] : [])];
  const names = [
    ...phi.map((_, i) => `phi${i + 1}`),
    ...theta.map((_, i) => `theta${i + 1}`),
    ...(includeMean ? ['mean'] : []),
  ];
  const fNat = (x: number[]): number => negLogLikNatural(x.slice(0, p), x.slice(p, p + q), includeMean ? x[p + q] : 0);
  let cov: number[][] | null = null;
  let se: number[] | null = null;
  if (nPar > 0) {
    const h = natural.map((v) => Math.max(1e-4, 1e-4 * Math.abs(v)));
    const H: number[][] = Array.from({ length: nPar }, () => new Array<number>(nPar).fill(0));
    const f0 = fNat(natural);
    let bad = f0 >= 1e299;
    for (let i = 0; i < nPar && !bad; i++) {
      for (let j = i; j < nPar && !bad; j++) {
        const step = (di: number, dj: number): number => {
          const x = [...natural];
          x[i] += di * h[i];
          x[j] += dj * h[j];
          return fNat(x);
        };
        let val: number;
        if (i === j) {
          const fp = step(1, 0);
          const fm = step(-1, 0);
          val = (fp - 2 * f0 + fm) / (h[i] * h[i]);
        } else {
          val = (step(1, 1) - step(1, -1) - step(-1, 1) + step(-1, -1)) / (4 * h[i] * h[j]);
        }
        if (!Number.isFinite(val)) bad = true;
        H[i][j] = val;
        H[j][i] = val;
      }
    }
    if (!bad) {
      const inv: number[][] = Array.from({ length: nPar }, () => new Array<number>(nPar).fill(0));
      let ok = true;
      for (let c = 0; c < nPar; c++) {
        const e = new Array<number>(nPar).fill(0);
        e[c] = 1;
        const col = solve(H.map((r) => [...r]), e);
        if (col === null) {
          ok = false;
          break;
        }
        for (let r = 0; r < nPar; r++) inv[r][c] = col[r];
      }
      if (ok && inv.every((row, i) => row[i] > 0)) {
        cov = inv;
        se = inv.map((row, i) => Math.sqrt(row[i]));
      }
    }
  }

  const stationary = isStationaryAr(phi);
  const invertible = isInvertibleMa(theta);
  const warnings: string[] = [];
  if (!stationary) {
    throw new EngineError(
      `The fitted AR part of ARIMA(${p},${d},${q}) is not stationary (its characteristic roots are not outside the unit circle). The fit is rejected rather than reported: forecasts from a non-stationary ARMA diverge and its intervals are meaningless.`,
      'non-stationary',
    );
  }
  if (!invertible) {
    warnings.push(
      'The fitted MA part is on or outside the invertibility boundary. The model still has a likelihood, but its coefficients are not uniquely identified and the residuals cannot be recovered from the observations — treat the fit with suspicion.',
    );
  }
  if (cov === null) {
    warnings.push(
      'The numerical Hessian of the log-likelihood was not positive definite, so no parameter standard errors or parameter-uncertainty intervals are available for this fit. This usually means the likelihood is flat in some direction — the order is probably too high for the data.',
    );
  }
  if (p > 0 && Math.max(...phi.map(Math.abs)) > 0.98) {
    warnings.push(`An AR coefficient of ${Math.max(...phi.map(Math.abs)).toFixed(4)} is close to the unit circle; the series may need differencing rather than a near-unit-root AR term.`);
  }
  if (m < 50) warnings.push(`Only ${m} observations are available after differencing. ARIMA estimates at this sample size are imprecise and the information criteria discriminate poorly.`);

  return {
    p,
    d,
    q,
    phi,
    theta,
    mean: mu,
    includeMean,
    sigma2: k.sigma2,
    logLikelihood: k.logLikelihood,
    aic,
    aicc,
    bic,
    parameterCount: nParWithSigma,
    parameterCovariance: cov,
    standardErrors: se,
    parameterNames: names,
    residuals: k.residuals,
    differenced: w,
    original: y,
    stationary,
    invertible,
    estimation: 'exact-kalman-likelihood',
    converged: true,
    explanation: explain(`ARIMA(${p},${d},${q}) by exact maximum likelihood (Kalman filter on the state-space form)`, 'numerical', {
      formula: `φ(B)(1−B)^${d}(y_t − μ) = θ(B) ε_t`,
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'Observations after differencing', value: String(m) },
        ...phi.map((v, i) => ({ label: `φ${i + 1}`, value: se ? `${v.toFixed(6)} (se ${se[i].toFixed(6)})` : v.toFixed(6) })),
        ...theta.map((v, i) => ({ label: `θ${i + 1}`, value: se ? `${v.toFixed(6)} (se ${se[p + i].toFixed(6)})` : v.toFixed(6) })),
        ...(includeMean ? [{ label: 'mean of the differenced series', value: mu.toFixed(6) }] : []),
        { label: 'σ²', value: k.sigma2.toExponential(6) },
        { label: 'log-likelihood', value: k.logLikelihood.toFixed(6) },
        { label: 'AIC / AICc / BIC', value: `${aic.toFixed(3)} / ${aicc.toFixed(3)} / ${bic.toFixed(3)}` },
      ],
      assumptions: [
        'Gaussian innovations with constant variance. The likelihood is exact under that assumption, and the point estimates remain consistent without it, but the standard errors and intervals do not.',
        'The differencing order d is treated as known, not estimated; its uncertainty is not reflected anywhere in these numbers.',
      ],
      limitations: [
        'The likelihood is maximised numerically by a simplex method, so the optimum is a local one. A restart from a different start is run automatically, but multimodality cannot be ruled out.',
        'Standard errors come from a numerical Hessian and are asymptotic.',
        'Information criteria compare models fitted to the SAME differenced series. An AIC from a d = 0 fit is not comparable with one from a d = 1 fit.',
      ],
    }),
    warnings,
  };
}

/**
 * ψ-weights of the integrated model: the MA(∞) representation of
 * φ(B)(1−B)^d y_t = θ(B) ε_t. Σ_{j<h} ψ_j² is the h-step forecast error
 * variance in units of σ².
 */
export function psiWeights(phi: number[], d: number, theta: number[], count: number): number[] {
  if (!Number.isInteger(count) || count < 1) throw new EngineError('The number of ψ-weights must be a positive whole number.', 'range');
  // Expanded AR polynomial coefficients: c[0] = 1, c[i] for i ≥ 1.
  let c = [1, ...phi.map((v) => -v)];
  for (let i = 0; i < d; i++) {
    const next = new Array<number>(c.length + 1).fill(0);
    for (let j = 0; j < c.length; j++) {
      next[j] += c[j];
      next[j + 1] -= c[j];
    }
    c = next;
  }
  const a = c.slice(1).map((v) => -v); // y_t = Σ a_i y_{t−i} + ...
  const psi = new Array<number>(count).fill(0);
  psi[0] = 1;
  for (let j = 1; j < count; j++) {
    let s = j <= theta.length ? theta[j - 1] : 0;
    for (let i = 1; i <= Math.min(j, a.length); i++) s += a[i - 1] * psi[j - i];
    psi[j] = s;
  }
  return psi;
}

export interface ArimaForecast {
  horizon: number;
  point: number[];
  /** Interval accounting for innovation variance ONLY. */
  innovationIntervals: TsInterval[];
  /**
   * Interval accounting for innovation variance AND parameter estimation
   * uncertainty. Strictly wider than the innovation-only interval. Most
   * software reports only the former while describing it as if it were this.
   */
  parameterIntervals: TsInterval[] | null;
  /** Standard deviations behind each interval, for inspection. */
  innovationSd: number[];
  parameterSd: number[] | null;
  level: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Forecast from a fitted ARIMA model with TWO interval families.
 *
 * Innovation-only: Var(ŷ_{n+h}) = σ² Σ_{j<h} ψ_j². For an AR(1) this is
 * exactly σ²(1 − φ^{2h})/(1 − φ²), which the test suite checks.
 *
 * With parameter uncertainty: the above plus g′ V g, where g is the numerical
 * gradient of the point forecast with respect to (φ, θ, μ) and V is the
 * parameter covariance from the Hessian of the log-likelihood. Neither
 * interval covers model misspecification.
 */
export function forecastArima(fit: ArimaFit, horizon: number, level = 0.95): ArimaForecast {
  if (!Number.isInteger(horizon) || horizon < 1) throw new EngineError(`The forecast horizon must be a whole number of at least 1 (received ${horizon}).`, 'range');
  if (!(level > 0 && level < 1)) throw new EngineError(`The interval level must be between 0 and 1 (received ${level}).`, 'range');
  const point = arimaPointForecast(fit, fit.phi, fit.theta, fit.mean, horizon);
  const psi = psiWeights(fit.phi, fit.d, fit.theta, horizon);
  const innovationSd = new Array<number>(horizon);
  let acc = 0;
  for (let h = 1; h <= horizon; h++) {
    acc += psi[h - 1] * psi[h - 1];
    innovationSd[h - 1] = Math.sqrt(fit.sigma2 * acc);
  }
  const z = zQuantile(0.5 + level / 2);
  const innovationIntervals: TsInterval[] = point.map((pt, i) => ({
    low: pt - z * innovationSd[i],
    high: pt + z * innovationSd[i],
    level,
    of: `the observation ${i + 1} step(s) ahead — INNOVATION VARIANCE ONLY`,
    method: 'σ² Σ_{j<h} ψ_j², treating the estimated coefficients as if they were known exactly',
    kind: 'outcomes',
  }));

  let parameterIntervals: TsInterval[] | null = null;
  let parameterSd: number[] | null = null;
  if (fit.parameterCovariance) {
    const V = fit.parameterCovariance;
    const nPar = V.length;
    const base = [...fit.phi, ...fit.theta, ...(fit.includeMean ? [fit.mean] : [])];
    const grad: number[][] = Array.from({ length: horizon }, () => new Array<number>(nPar).fill(0));
    for (let i = 0; i < nPar; i++) {
      const step = Math.max(1e-5, 1e-5 * Math.abs(base[i]));
      const up = [...base];
      const dn = [...base];
      up[i] += step;
      dn[i] -= step;
      const fwd = arimaPointForecast(
        fit,
        up.slice(0, fit.p),
        up.slice(fit.p, fit.p + fit.q),
        fit.includeMean ? up[fit.p + fit.q] : 0,
        horizon,
      );
      const bwd = arimaPointForecast(
        fit,
        dn.slice(0, fit.p),
        dn.slice(fit.p, fit.p + fit.q),
        fit.includeMean ? dn[fit.p + fit.q] : 0,
        horizon,
      );
      for (let h = 0; h < horizon; h++) grad[h][i] = (fwd[h] - bwd[h]) / (2 * step);
    }
    parameterSd = new Array<number>(horizon);
    const intervals: TsInterval[] = [];
    for (let h = 0; h < horizon; h++) {
      let extra = 0;
      for (let i = 0; i < nPar; i++) for (let j = 0; j < nPar; j++) extra += grad[h][i] * V[i][j] * grad[h][j];
      // A quadratic form in a positive-definite V cannot be negative; guard
      // against round-off only, and never silently clamp a real negative.
      if (extra < -1e-9 * Math.max(1, Math.abs(extra))) {
        throw new EngineError('The parameter-uncertainty variance came out negative, which means the parameter covariance is not positive definite. No parameter-uncertainty interval is reported.', 'numerical');
      }
      // Guarantee a strictly wider interval than the innovation-only one: the
      // parameter contribution is additive and non-negative by construction.
      const total = Math.sqrt(innovationSd[h] * innovationSd[h] + Math.max(extra, 0));
      parameterSd[h] = total;
      intervals.push({
        low: point[h] - z * total,
        high: point[h] + z * total,
        level,
        of: `the observation ${h + 1} step(s) ahead — innovation variance PLUS parameter estimation uncertainty`,
        method: 'σ² Σ ψ_j² + g′Vg by the delta method, with V the inverse Hessian of the exact log-likelihood',
        kind: 'outcomes',
      });
    }
    parameterIntervals = intervals;
  }

  const widening = innovationSd.every((v, i) => i === 0 || v >= innovationSd[i - 1] - 1e-12);
  const warnings: string[] = [
    `Horizon: ${horizon} step(s) ahead of the last observation.`,
    'Two interval families are reported. The innovation-only interval is what most software prints, usually described as if it already included parameter uncertainty. It does not. The wider interval is the one that does.',
    ...FORECAST_CAVEATS,
    ...fit.warnings,
  ];
  if (parameterIntervals === null) {
    warnings.push('No parameter-uncertainty interval could be formed for this fit (see the fit warnings), so only the narrower innovation-only interval is available. Read it as a lower bound on the real uncertainty.');
  }
  if (!widening) {
    warnings.push('The innovation standard deviation is not monotone in the horizon, which should not happen for a stationary model — treat this forecast as numerically suspect.');
  }
  if (fit.d > 0) {
    warnings.push(`With d = ${fit.d}, the forecast variance grows without bound in the horizon: a differenced model has no long-run level to revert to, so long-horizon intervals become very wide and genuinely are that uncertain.`);
  }
  return {
    horizon,
    point,
    innovationIntervals,
    parameterIntervals,
    innovationSd,
    parameterSd,
    level,
    explanation: explain(`Forecast from ARIMA(${fit.p},${fit.d},${fit.q}) with separated innovation and parameter uncertainty`, 'numerical', {
      formula: 'Var_innov(h) = σ² Σ_{j<h} ψ_j² ;  Var_total(h) = Var_innov(h) + g′Vg',
      steps: [
        { label: 'Horizon', value: String(horizon) },
        { label: 'σ', value: Math.sqrt(fit.sigma2).toExponential(6) },
        { label: 'Innovation sd at h = 1', value: innovationSd[0].toExponential(6) },
        { label: `Innovation sd at h = ${horizon}`, value: innovationSd[horizon - 1].toExponential(6) },
        ...(parameterSd ? [{ label: `With parameter uncertainty at h = ${horizon}`, value: parameterSd[horizon - 1].toExponential(6) }] : []),
      ],
      assumptions: [
        'The model structure is correct and unchanged over the forecast horizon.',
        'Gaussian innovations, so the interval uses a normal quantile. Heavy tails make the interval too narrow in the tails even if the variance is right.',
        'The ψ-weight variance is exact given the parameters; it is the parameters that are uncertain.',
      ],
      limitations: [
        'Neither interval covers model misspecification — the wrong order, a structural break, or a regime change. That is usually the largest component of real forecast error and it is not quantified here or anywhere else.',
        'The parameter-uncertainty term is a first-order delta-method approximation and understates the effect at long horizons.',
      ],
    }),
    warnings,
  };
}

/** Point forecast for given coefficients, used both for the forecast and its gradient. */
function arimaPointForecast(fit: ArimaFit, phi: number[], theta: number[], mu: number, horizon: number): number[] {
  const w = fit.differenced;
  const m = w.length;
  const eps = fit.residuals;
  // Recursion on the differenced, de-meaned scale.
  const history = w.map((v) => v - mu);
  const out = new Array<number>(horizon).fill(0);
  const getW = (idx: number): number => (idx < m ? history[idx] : out[idx - m]);
  const getE = (idx: number): number => (idx < m ? eps[idx] : 0);
  for (let h = 0; h < horizon; h++) {
    let s = 0;
    for (let i = 1; i <= phi.length; i++) s += phi[i - 1] * getW(m + h - i);
    for (let j = 1; j <= theta.length; j++) s += theta[j - 1] * getE(m + h - j);
    out[h] = s;
  }
  let level = out.map((v) => v + mu);
  // Integrate back d times.
  if (fit.d > 0) {
    const chain: number[][] = [fit.original];
    for (let i = 1; i <= fit.d; i++) chain.push(difference(chain[i - 1], { d: 1 }).values);
    for (let k = fit.d - 1; k >= 0; k--) {
      const last = chain[k][chain[k].length - 1];
      const next = new Array<number>(horizon);
      for (let h = 0; h < horizon; h++) next[h] = (h === 0 ? last : next[h - 1]) + level[h];
      level = next;
    }
  }
  return level;
}

export interface OrderSelectionRow {
  p: number;
  d: number;
  q: number;
  logLikelihood: number;
  aic: number;
  aicc: number;
  bic: number;
  /** Difference from the best value of the selection criterion. */
  delta: number;
  converged: boolean;
  failure: string | null;
  chosen: boolean;
}

export interface OrderSelectionResult {
  best: ArimaFit;
  /** Every candidate, not only the winner. */
  table: OrderSelectionRow[];
  criterion: 'aic' | 'aicc' | 'bic';
  /** Models within 2 units of the best, i.e. not meaningfully distinguishable. */
  nearTies: OrderSelectionRow[];
  interpretation: string;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Automatic ARIMA order selection over a grid, reporting the FULL table.
 *
 * A gap of less than about 2 units in an information criterion is not a
 * meaningful preference, and the result says so explicitly rather than
 * presenting the winner as the identified model.
 */
export function selectArimaOrder(
  series: ArrayLike<number>,
  options: { maxP?: number; maxQ?: number; d?: number; criterion?: 'aic' | 'aicc' | 'bic'; includeMean?: boolean } = {},
): OrderSelectionResult {
  const maxP = options.maxP ?? 3;
  const maxQ = options.maxQ ?? 3;
  const d = options.d ?? 0;
  const criterion = options.criterion ?? 'aicc';
  if (!Number.isInteger(maxP) || maxP < 0 || maxP > 8 || !Number.isInteger(maxQ) || maxQ < 0 || maxQ > 8) {
    throw new EngineError('The order search bounds must be whole numbers in [0, 8].', 'range');
  }
  const y = checkSeries(series, d + maxP + maxQ + 10, 'series');
  const table: OrderSelectionRow[] = [];
  let best: ArimaFit | null = null;
  let bestValue = Infinity;
  for (let p = 0; p <= maxP; p++) {
    for (let q = 0; q <= maxQ; q++) {
      if (p === 0 && q === 0 && d === 0) continue;
      let fit: ArimaFit | null = null;
      let failure: string | null = null;
      try {
        fit = fitArima(y, { p, d, q, includeMean: options.includeMean });
      } catch (e) {
        failure = e instanceof Error ? e.message : String(e);
      }
      if (fit) {
        const value = criterion === 'aic' ? fit.aic : criterion === 'bic' ? fit.bic : fit.aicc;
        table.push({ p, d, q, logLikelihood: fit.logLikelihood, aic: fit.aic, aicc: fit.aicc, bic: fit.bic, delta: 0, converged: true, failure: null, chosen: false });
        if (value < bestValue) {
          bestValue = value;
          best = fit;
        }
      } else {
        table.push({ p, d, q, logLikelihood: NaN, aic: NaN, aicc: NaN, bic: NaN, delta: NaN, converged: false, failure, chosen: false });
      }
    }
  }
  if (!best || !Number.isFinite(bestValue)) {
    throw new EngineError(
      `No ARIMA model in the searched grid (p ≤ ${maxP}, q ≤ ${maxQ}, d = ${d}) could be fitted to this series. ` +
        `${table.filter((r) => !r.converged).length} of ${table.length} candidates failed. No order is reported.`,
      'non-convergence',
    );
  }
  const pick = (r: OrderSelectionRow): number => (criterion === 'aic' ? r.aic : criterion === 'bic' ? r.bic : r.aicc);
  for (const row of table) {
    if (row.converged) row.delta = pick(row) - bestValue;
    if (row.converged && row.p === best.p && row.q === best.q) row.chosen = true;
  }
  table.sort((a, b) => (Number.isFinite(a.delta) ? a.delta : Infinity) - (Number.isFinite(b.delta) ? b.delta : Infinity));
  const nearTies = table.filter((r) => r.converged && r.delta > 0 && r.delta < 2);
  const warnings: string[] = [...best.warnings];
  if (nearTies.length > 0) {
    warnings.push(
      `${nearTies.length} other order(s) are within 2 ${criterion.toUpperCase()} units of the winner (${nearTies.map((r) => `(${r.p},${r.d},${r.q}) Δ=${r.delta.toFixed(2)}`).join(', ')}). A gap that small is not a meaningful preference; choose on parsimony, residual diagnostics or out-of-sample accuracy instead.`,
    );
  }
  const failed = table.filter((r) => !r.converged);
  if (failed.length > 0) {
    warnings.push(`${failed.length} candidate order(s) could not be fitted and are listed in the table with their failure reasons rather than being dropped silently.`);
  }
  warnings.push('Selecting an order and then reporting that model\'s standard errors as if the order were known in advance understates uncertainty. The order was chosen from this same data.');
  return {
    best,
    table,
    criterion,
    nearTies,
    interpretation:
      nearTies.length > 0
        ? `ARIMA(${best.p},${best.d},${best.q}) has the lowest ${criterion.toUpperCase()}, but ${nearTies.length} other order(s) are within 2 units and are not meaningfully worse.`
        : `ARIMA(${best.p},${best.d},${best.q}) has the lowest ${criterion.toUpperCase()}, clear of the next candidate by ${(table.find((r) => r.delta > 0)?.delta ?? Infinity).toFixed(2)} units.`,
    explanation: explain(`ARIMA order selection by ${criterion.toUpperCase()} over a grid`, 'numerical', {
      formula: 'AIC = −2ℓ + 2k ;  AICc = AIC + 2k(k+1)/(n−k−1) ;  BIC = −2ℓ + k log n',
      steps: [
        { label: 'Candidates fitted', value: `${table.filter((r) => r.converged).length} of ${table.length}` },
        { label: 'Criterion', value: criterion.toUpperCase() },
        { label: 'Chosen order', value: `(${best.p}, ${best.d}, ${best.q})` },
        { label: 'Near-ties within 2 units', value: String(nearTies.length) },
      ],
      assumptions: [
        'All candidates are fitted to the same differenced series, so their criteria are comparable. Models with different d are NOT comparable and d is held fixed here.',
        'AICc is the small-sample corrected AIC and is the safer default; BIC penalises complexity more and tends to choose smaller models.',
      ],
      limitations: [
        'An information criterion ranks models for predictive accuracy under its own assumptions; it does not test whether any of them fits. Always run the residual diagnostics on the winner.',
        'A difference below about 2 units carries no useful information about which model is better.',
        'The grid is finite: a better order outside it would not be found.',
      ],
    }),
    warnings,
  };
}
