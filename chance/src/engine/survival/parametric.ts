/**
 * Parametric survival models fitted by maximum likelihood with right-censoring:
 * exponential, Weibull, log-normal and log-logistic, in accelerated failure
 * time (AFT) form
 *
 *   log T = μ + xᵀβ + σ W,
 *
 * with W the standard extreme-value, normal or logistic variate. The Weibull
 * is the one model that is both AFT and proportional hazards: its PH
 * coefficient is −β/σ and its shape is 1/σ, which is the bridge to the
 * reliability module's Weibull work.
 *
 * AIC compares these models with each other and with a Cox fit — but only
 * loosely in the Cox case, because the Cox partial likelihood is not a
 * likelihood for the same data. That caveat is reported, not hidden.
 */

import { attempt, EngineError, Validator, type EngineResult, type Explanation } from '../core/result.ts';
import { normalCdf, normalPdf } from '../special/gamma.ts';
import { choleskyWithCheck, solve, type Matrix } from '../stats/linalg.ts';
import {
  INDEPENDENT_CENSORING,
  censoringNote,
  heavyCensoringWarnings,
  summarizeFollowUp,
  validateSurvivalInput,
  zForLevel,
  type FollowUpSummary,
} from './data.ts';

export type ParametricFamily = 'exponential' | 'weibull' | 'lognormal' | 'loglogistic';

interface ErrorDistribution {
  /** log f₀(z). */
  logPdf(z: number): number;
  /** log S₀(z). */
  logSurvival(z: number): number;
}

const EXTREME_VALUE: ErrorDistribution = {
  // Smallest extreme value: f₀(z) = exp(z − e^z), S₀(z) = exp(−e^z).
  logPdf: (z) => z - Math.exp(z),
  logSurvival: (z) => -Math.exp(z),
};

const NORMAL: ErrorDistribution = {
  logPdf: (z) => Math.log(Math.max(normalPdf(z), Number.MIN_VALUE)),
  logSurvival: (z) => {
    const s = 1 - normalCdf(z);
    if (s > 1e-300) return Math.log(s);
    // Asymptotic log of the upper normal tail, for numerical stability far out.
    return -0.5 * z * z - Math.log(z * Math.sqrt(2 * Math.PI));
  },
};

const LOGISTIC: ErrorDistribution = {
  logPdf: (z) => z - 2 * log1pExp(z),
  logSurvival: (z) => -log1pExp(z),
};

function log1pExp(z: number): number {
  return z > 30 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

function errorDistribution(family: ParametricFamily): ErrorDistribution {
  switch (family) {
    case 'exponential':
    case 'weibull':
      return EXTREME_VALUE;
    case 'lognormal':
      return NORMAL;
    case 'loglogistic':
      return LOGISTIC;
  }
}

export interface ParametricCoefficient {
  name: string;
  estimate: number;
  stdError: number;
  z: number;
  pValue: number;
  lower: number;
  upper: number;
}

export interface WeibullPHForm {
  /** Shape k = 1/σ. */
  shape: number;
  /** Scale exp(μ) for a subject with all covariates zero. */
  scale: number;
  /** Proportional-hazards log hazard ratios, −β/σ. */
  logHazardRatios: { name: string; value: number }[];
}

export interface ParametricFit {
  family: ParametricFamily;
  /** Intercept μ on the log-time scale. */
  intercept: number;
  /** Scale σ; fixed at 1 for the exponential. */
  scale: number;
  coefficients: ParametricCoefficient[];
  /** μ, β…, log σ — the parameter vector actually optimised. */
  parameters: number[];
  parameterNames: string[];
  covariance: Matrix;
  logLikelihood: number;
  parameterCount: number;
  aic: number;
  bic: number;
  iterations: number;
  summary: FollowUpSummary;
  /** Present for the Weibull and exponential only. */
  proportionalHazards: WeibullPHForm | null;
  explanation: Explanation;
}

export interface ParametricOptions {
  names?: string[];
  level?: number;
  maxIterations?: number;
  tolerance?: number;
}

/** Negative log-likelihood for the AFT model; theta = [μ, β…, log σ]. */
function makeObjective(
  family: ParametricFamily,
  logTime: readonly number[],
  status: readonly number[],
  covariates: readonly number[][],
): (theta: readonly number[]) => number {
  const dist = errorDistribution(family);
  const p = covariates.length > 0 ? covariates[0].length : 0;
  const fixedScale = family === 'exponential';
  return (theta) => {
    const mu = theta[0];
    const logSigma = fixedScale ? 0 : theta[1 + p];
    const sigma = Math.exp(logSigma);
    if (!Number.isFinite(sigma) || sigma <= 0) return Infinity;
    let total = 0;
    for (let i = 0; i < logTime.length; i++) {
      let lin = mu;
      for (let j = 0; j < p; j++) lin += theta[1 + j] * covariates[i][j];
      const z = (logTime[i] - lin) / sigma;
      total += status[i] === 1 ? dist.logPdf(z) - logSigma : dist.logSurvival(z);
    }
    return Number.isFinite(total) ? -total : Infinity;
  };
}

function numericGradient(f: (t: readonly number[]) => number, theta: readonly number[], f0: number): number[] {
  return theta.map((_, j) => {
    const h = 1e-5 * Math.max(1, Math.abs(theta[j]));
    const up = [...theta];
    const down = [...theta];
    up[j] += h;
    down[j] -= h;
    const fu = f(up);
    const fd = f(down);
    if (!Number.isFinite(fu) || !Number.isFinite(fd)) return (f(up) - f0) / h;
    return (fu - fd) / (2 * h);
  });
}

function numericHessian(f: (t: readonly number[]) => number, theta: readonly number[], f0: number): Matrix {
  const n = theta.length;
  const h = theta.map((x) => 1e-4 * Math.max(1, Math.abs(x)));
  const H: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    const up = [...theta];
    const down = [...theta];
    up[a] += h[a];
    down[a] -= h[a];
    H[a][a] = (f(up) - 2 * f0 + f(down)) / (h[a] * h[a]);
    for (let b = 0; b < a; b++) {
      const pp = [...theta];
      const pm = [...theta];
      const mp = [...theta];
      const mm = [...theta];
      pp[a] += h[a];
      pp[b] += h[b];
      pm[a] += h[a];
      pm[b] -= h[b];
      mp[a] -= h[a];
      mp[b] += h[b];
      mm[a] -= h[a];
      mm[b] -= h[b];
      const v = (f(pp) - f(pm) - f(mp) + f(mm)) / (4 * h[a] * h[b]);
      H[a][b] = v;
      H[b][a] = v;
    }
  }
  return H;
}

/** Fit one parametric AFT model to right-censored data. */
export function fitParametric(
  family: ParametricFamily,
  time: readonly number[],
  status: readonly number[],
  covariates: readonly number[][] = [],
  options: ParametricOptions = {},
): EngineResult<ParametricFit> {
  return attempt(() => fitParametricOrThrow(family, time, status, covariates, options));
}

export function fitParametricOrThrow(
  family: ParametricFamily,
  time: readonly number[],
  status: readonly number[],
  covariates: readonly number[][] = [],
  options: ParametricOptions = {},
): ParametricFit {
  validateSurvivalInput(time, status);
  const v = new Validator();
  const n = time.length;
  for (let i = 0; i < n; i++) {
    if (!(time[i] > 0)) {
      v.add(
        `Observation ${i + 1} has time ${time[i]}. Parametric models here work on the log-time scale, ` +
          'so every time must be strictly positive. Zero-time observations need a different model ' +
          '(or a cure/immediate-failure component) rather than a silent nudge away from zero.',
        'time',
        'range',
      );
      break;
    }
  }
  const p = covariates.length > 0 ? covariates[0].length : 0;
  if (covariates.length > 0 && covariates.length !== n) {
    v.add(`Mismatched lengths: ${n} times but ${covariates.length} covariate rows.`, 'covariates', 'length');
  }
  covariates.forEach((row, i) => {
    if (row.length !== p) v.add(`Covariate row ${i + 1} has ${row.length} values but row 1 has ${p}.`, 'covariates', 'length');
    row.forEach((x, j) => {
      if (!Number.isFinite(x)) v.add(`Covariate ${j + 1} of subject ${i + 1} is not finite.`, 'covariates', 'finite');
    });
  });
  if (options.names && options.names.length !== p) {
    v.add(`Expected ${p} covariate names but received ${options.names.length}.`, 'names', 'length');
  }
  v.throwIfInvalid();

  const level = options.level ?? 0.95;
  const z = zForLevel(level);
  const logTime = time.map((t) => Math.log(t));
  const X = covariates.length > 0 ? covariates.map((r) => [...r]) : time.map(() => [] as number[]);
  const f = makeObjective(family, logTime, status, X);
  const fixedScale = family === 'exponential';
  const dim = 1 + p + (fixedScale ? 0 : 1);

  // Start from the least-squares fit of log time on the covariates, which is
  // the exact MLE when nothing is censored and the error is normal.
  const theta = new Array<number>(dim).fill(0);
  theta[0] = logTime.reduce((a, b) => a + b, 0) / n;
  if (!fixedScale) {
    const varLog = logTime.reduce((a, b) => a + (b - theta[0]) * (b - theta[0]), 0) / Math.max(1, n - 1);
    theta[dim - 1] = 0.5 * Math.log(Math.max(varLog, 1e-6));
  }

  const maxIterations = options.maxIterations ?? 200;
  const gradTol = options.tolerance ?? 1e-7;
  let current = f(theta);
  if (!Number.isFinite(current)) {
    throw new EngineError([
      {
        code: 'no-start',
        message: `The ${family} log-likelihood is not finite at the starting values; the model cannot be fitted to this data.`,
        field: 'time',
      },
    ]);
  }
  let iterations = 0;
  let converged = false;
  let beta = [...theta];
  for (; iterations < maxIterations; iterations++) {
    const g = numericGradient(f, beta, current);
    const gnorm = Math.max(...g.map((x) => Math.abs(x)));
    if (gnorm < gradTol) {
      converged = true;
      break;
    }
    const H = numericHessian(f, beta, current);
    // The Newton direction is only a descent direction when the Hessian of the
    // negative log-likelihood is positive definite, which it need not be away
    // from the maximum. Fall back to steepest descent when it is not.
    const directions: number[][] = [];
    if (choleskyWithCheck(H.map((r) => [...r])).ok) {
      const st = solve(
        H.map((r) => [...r]),
        g.map((x) => -x),
      );
      if (st && st.every((x) => Number.isFinite(x))) directions.push(st);
    }
    directions.push(g.map((x) => -x / Math.max(1, gnorm)));
    let accepted = false;
    for (const dir of directions) {
      let scale = 1;
      for (let halving = 0; halving < 60; halving++) {
        const cand = beta.map((b, j) => b + scale * dir[j]);
        const fc = f(cand);
        if (Number.isFinite(fc) && fc < current - 1e-14) {
          beta = cand;
          current = fc;
          accepted = true;
          break;
        }
        scale /= 2;
      }
      if (accepted) break;
    }
    if (!accepted) {
      // No direction improves the objective. That is convergence only if the
      // gradient is already negligible on the scale of the log-likelihood.
      if (gnorm < 1e-4 * Math.max(1, Math.abs(current))) {
        converged = true;
        break;
      }
      throw new EngineError([
        {
          code: 'no-convergence',
          message:
            `The ${family} maximum-likelihood search stalled at a point where the score is still ` +
            `${gnorm.toExponential(3)}: no step in either the Newton or the gradient direction improves ` +
            'the likelihood. No parameters are reported.',
          field: 'time',
        },
      ]);
    }
  }
  if (!converged && iterations >= maxIterations) {
    throw new EngineError([
      {
        code: 'no-convergence',
        message:
          `The ${family} maximum-likelihood fit did not converge within ${maxIterations} iterations. ` +
          'No parameters are reported: a non-converged fit is not an estimate.',
        field: 'time',
      },
    ]);
  }

  const logLikelihood = -current;
  const H = numericHessian(f, beta, current);
  const covariance = invertMatrix(H);
  if (!covariance || covariance.some((r, i) => !(r[i] > 0))) {
    throw new EngineError([
      {
        code: 'singular',
        message:
          `The ${family} information matrix is singular or not positive definite at the maximum, so no ` +
          'standard errors exist. A covariate may be collinear or constant, or the data may be too ' +
          'heavily censored to identify the scale parameter.',
        field: 'covariates',
      },
    ]);
  }
  const names = options.names ?? Array.from({ length: p }, (_, j) => `x${j + 1}`);
  const parameterNames = ['(intercept)', ...names, ...(fixedScale ? [] : ['log(scale)'])];
  const coefficients: ParametricCoefficient[] = parameterNames.map((name, j) => {
    const est = beta[j];
    const se = Math.sqrt(covariance[j][j]);
    const stat = est / se;
    return {
      name,
      estimate: est,
      stdError: se,
      z: stat,
      pValue: 2 * (1 - normalCdf(Math.abs(stat))),
      lower: est - z * se,
      upper: est + z * se,
    };
  });
  const sigma = fixedScale ? 1 : Math.exp(beta[dim - 1]);
  const summary = summarizeFollowUp(time, status);
  const k = dim;
  const ph: WeibullPHForm | null =
    family === 'weibull' || family === 'exponential'
      ? {
          shape: 1 / sigma,
          scale: Math.exp(beta[0]),
          logHazardRatios: names.map((nm, j) => ({ name: nm, value: -beta[1 + j] / sigma })),
        }
      : null;

  return {
    family,
    intercept: beta[0],
    scale: sigma,
    coefficients,
    parameters: beta,
    parameterNames,
    covariance,
    logLikelihood,
    parameterCount: k,
    aic: -2 * logLikelihood + 2 * k,
    bic: -2 * logLikelihood + k * Math.log(n),
    iterations,
    summary,
    proportionalHazards: ph,
    explanation: {
      method: `${family} accelerated failure time model, maximum likelihood with right-censoring`,
      formula: 'log T = μ + xᵀβ + σ W',
      steps: [
        { label: 'Sample', value: censoringNote(summary) },
        { label: 'Parameters', value: parameterNames.join(', ') },
        { label: 'Log-likelihood', value: logLikelihood.toFixed(6) },
        { label: 'AIC', value: (-2 * logLikelihood + 2 * k).toFixed(4) },
        ...(ph
          ? [
              {
                label: 'Proportional-hazards form',
                value:
                  `Weibull shape k = 1/σ = ${(1 / sigma).toFixed(6)}; PH log hazard ratios are −β/σ. ` +
                  'k > 1 means the hazard increases with time, k < 1 that it decreases, k = 1 is the exponential.',
              },
            ]
          : []),
        ...heavyCensoringWarnings(summary).map((w) => ({ label: 'Warning', value: w })),
      ],
      assumptions: [
        INDEPENDENT_CENSORING,
        `The failure time is assumed ${family === 'exponential' ? 'exponential (constant hazard — a strong assumption, and usually wrong)' : family}. A parametric model buys precision with that assumption and pays for it if the shape is wrong.`,
        'Covariate effects are assumed to act multiplicatively on time (AFT).',
      ],
      limitations: [
        'Standard errors come from a numerically differentiated observed information matrix, so they carry a small numerical error on top of the statistical one.',
        'Extrapolation beyond the observed follow-up is possible with a parametric model but rests entirely on the assumed shape, not on data.',
        'AIC comparisons are only valid between models fitted to exactly the same observations, and never against a Cox partial likelihood without the caveat attached to it.',
      ],
      exactness: 'numerical',
    },
  };
}

function invertMatrix(m: Matrix): Matrix | null {
  const n = m.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const col = solve(
      m.map((r) => [...r]),
      e,
    );
    if (!col) return null;
    for (let i = 0; i < n; i++) out[i][j] = col[i];
  }
  return out;
}

export interface ModelComparisonRow {
  model: string;
  logLikelihood: number;
  parameters: number;
  aic: number;
  deltaAic: number;
  /** Akaike weight, exp(−Δ/2) normalised across the compared models. */
  weight: number;
  comparable: boolean;
  note?: string;
}

export interface ModelComparison {
  rows: ModelComparisonRow[];
  best: string;
  explanation: Explanation;
}

/**
 * AIC comparison across parametric families, optionally including a Cox fit.
 *
 * A Cox model's partial likelihood is not a full likelihood, so its "AIC" is
 * not on the same scale as the parametric ones. It is listed with
 * `comparable: false` and a note, rather than ranked silently alongside them.
 */
export function compareParametricModels(
  fits: readonly ParametricFit[],
  coxFit?: { logLikelihood: number; parameterCount: number },
): EngineResult<ModelComparison> {
  return attempt(() => {
    if (fits.length === 0) {
      throw new EngineError([{ code: 'empty', message: 'No fitted models were supplied to compare.', field: 'fits' }]);
    }
    const ns = new Set(fits.map((f) => f.summary.n));
    if (ns.size > 1) {
      throw new EngineError([
        {
          code: 'incomparable',
          message:
            `The supplied models were fitted to different numbers of observations (${[...ns].join(', ')}). ` +
            'AIC is only comparable across models fitted to exactly the same data.',
          field: 'fits',
        },
      ]);
    }
    const rows: ModelComparisonRow[] = fits.map((f) => ({
      model: f.family,
      logLikelihood: f.logLikelihood,
      parameters: f.parameterCount,
      aic: f.aic,
      deltaAic: 0,
      weight: 0,
      comparable: true,
    }));
    const bestAic = Math.min(...rows.map((r) => r.aic));
    let wSum = 0;
    for (const r of rows) {
      r.deltaAic = r.aic - bestAic;
      r.weight = Math.exp(-r.deltaAic / 2);
      wSum += r.weight;
    }
    for (const r of rows) r.weight /= wSum;
    if (coxFit) {
      const aic = -2 * coxFit.logLikelihood + 2 * coxFit.parameterCount;
      rows.push({
        model: 'cox (partial likelihood)',
        logLikelihood: coxFit.logLikelihood,
        parameters: coxFit.parameterCount,
        aic,
        deltaAic: NaN,
        weight: NaN,
        comparable: false,
        note:
          'The Cox partial likelihood conditions on the observed event times and is not a full ' +
          'likelihood for the data, so this AIC is NOT on the same scale as the parametric ones and ' +
          'must not be ranked against them. It is shown for reference only.',
      });
    }
    const best = rows.filter((r) => r.comparable).reduce((a, b) => (a.aic <= b.aic ? a : b)).model;
    return {
      rows,
      best,
      explanation: {
        method: 'AIC comparison of parametric survival models',
        formula: 'AIC = −2ℓ̂ + 2k',
        steps: [
          ...rows.map((r) => ({
            label: r.model,
            value: `ℓ = ${r.logLikelihood.toFixed(4)}, k = ${r.parameters}, AIC = ${r.aic.toFixed(4)}${r.comparable ? `, ΔAIC = ${r.deltaAic.toFixed(4)}` : ' (not comparable)'}`,
          })),
          { label: 'Best by AIC', value: best },
        ],
        assumptions: ['All compared parametric models were fitted to the same observations by maximum likelihood.'],
        limitations: [
          'A smaller AIC means a better trade-off of fit against parameters in this set of candidates; it does not mean the chosen model is correct.',
          'Differences below about 2 AIC units are not evidence for one model over another.',
          'The Cox row, when present, is not comparable — see its note.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

/** Survival function implied by a fitted parametric model at covariate x. */
export function parametricSurvival(
  fit: ParametricFit,
  times: readonly number[],
  covariates: readonly number[] = [],
): EngineResult<{ curve: { time: number; survival: number }[]; explanation: Explanation }> {
  return attempt(() => {
    const p = fit.coefficients.length - 1 - (fit.family === 'exponential' ? 0 : 1);
    const v = new Validator();
    if (covariates.length !== p) {
      v.add(`Expected ${p} covariate values but received ${covariates.length}.`, 'covariates', 'length');
    }
    times.forEach((t, i) => {
      if (!(t > 0)) v.add(`Time ${i + 1} must be strictly positive (got ${t}).`, 'times', 'range');
    });
    v.throwIfInvalid();
    const dist = errorDistribution(fit.family);
    let lin = fit.intercept;
    for (let j = 0; j < p; j++) lin += fit.parameters[1 + j] * covariates[j];
    return {
      curve: times.map((t) => ({
        time: t,
        survival: Math.exp(dist.logSurvival((Math.log(t) - lin) / fit.scale)),
      })),
      explanation: {
        method: `Survival function from the fitted ${fit.family} AFT model`,
        formula: 'S(t | x) = S₀((log t − μ − xᵀβ)/σ)',
        steps: [{ label: 'Linear predictor', value: lin.toFixed(6) }, { label: 'Scale σ', value: fit.scale.toFixed(6) }],
        assumptions: [`The fitted ${fit.family} shape is assumed correct.`, INDEPENDENT_CENSORING],
        limitations: [
          'No interval is attached: the uncertainty in the fitted parameters is not propagated here.',
          'Values beyond the observed follow-up are extrapolation from the assumed shape.',
        ],
        exactness: 'numerical',
      },
    };
  });
}
