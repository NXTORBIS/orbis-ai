/**
 * A library of ready-made inference problems.
 *
 * Each builder returns a `TargetSpec` whose `logDensity` is the unnormalised
 * log posterior, including every normalising constant that depends on the
 * parameters — and, where a parameter is transformed to an unconstrained
 * scale, the log Jacobian of that transform. Omitting the Jacobian would
 * sample a different distribution, which is exactly the kind of silent error
 * that makes MCMC output untrustworthy, so each one is written out.
 *
 * The first few targets have closed-form answers and exist so the samplers
 * can be checked against something independent of this code.
 */
import { EngineError } from '../core/result';
import { logGamma } from '../special/gamma';
import { choleskyWithCheck, type Matrix } from '../stats/linalg';
import type { FullConditional, TargetSpec } from './types';

const LOG_SQRT_2PI = 0.5 * Math.log(2 * Math.PI);

function normalLogPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return -0.5 * z * z - Math.log(sd) - LOG_SQRT_2PI;
}

/**
 * A log-density that overflows to a non-finite value at absurd parameter
 * values is reporting zero density there, not an error: map it to -Infinity
 * so the sampler rejects the move. NaN from arithmetic such as Inf/Inf is
 * exactly this case.
 */
function densityOrOutsideSupport(value: number): number {
  return Number.isFinite(value) ? value : -Infinity;
}

function requireFiniteData(values: readonly number[], label: string): void {
  if (!values.length) throw new EngineError(`${label} is empty; there is nothing to condition on.`, 'insufficient');
  for (const v of values) {
    if (!Number.isFinite(v)) throw new EngineError(`${label} contains a non-finite value (${String(v)}).`, 'finite');
  }
}

/* ------------------------------------------------------------------ *
 * Targets with known answers, used for verification.
 * ------------------------------------------------------------------ */

/** Independent standard normals: mean 0, sd 1, 2.5% quantile -1.959964. */
export function standardNormalTarget(dimension = 1): TargetSpec {
  if (!Number.isInteger(dimension) || dimension < 1) {
    throw new EngineError('The dimension must be a whole number of at least 1.', 'range');
  }
  const names = Array.from({ length: dimension }, (_, i) => (dimension === 1 ? 'x' : `x[${i + 1}]`));
  return {
    id: 'standard-normal',
    name: `Standard normal in ${dimension} dimension${dimension === 1 ? '' : 's'}`,
    dimension,
    parameterNames: names,
    description: 'Reference target with a closed-form mean, sd and quantiles.',
    logDensity: (x) => {
      let s = 0;
      for (let i = 0; i < dimension; i++) s += -0.5 * x[i] * x[i];
      return s - dimension * LOG_SQRT_2PI;
    },
    gradLogDensity: (x) => {
      const g = new Array<number>(dimension);
      for (let i = 0; i < dimension; i++) g[i] = -x[i];
      return g;
    },
    fullConditionals: Array.from(
      { length: dimension },
      (): FullConditional =>
        (_state, rng) =>
          rng.normal(),
    ),
  };
}

/**
 * Bivariate normal with unit marginals and correlation rho. A badly tuned
 * random-walk sampler fails here: proposals along the short axis of the
 * posterior are the only ones accepted, so the chain crawls.
 */
export function correlatedNormalTarget(rho = 0.9): TargetSpec {
  if (!(Math.abs(rho) < 1)) throw new EngineError('The correlation must satisfy |rho| < 1.', 'range');
  const det = 1 - rho * rho;
  const cov: Matrix = [
    [1, rho],
    [rho, 1],
  ];
  const chol = choleskyWithCheck(cov);
  if (!chol.ok) throw new EngineError('The correlation matrix is not positive definite.', 'not-positive-definite');
  return {
    id: 'correlated-normal',
    name: `Bivariate normal, correlation ${rho}`,
    dimension: 2,
    parameterNames: ['x', 'y'],
    description: 'Reference target: unit marginals and a known correlation.',
    logDensity: (v) => {
      const q = (v[0] * v[0] - 2 * rho * v[0] * v[1] + v[1] * v[1]) / det;
      return -0.5 * q - 0.5 * Math.log(det) - 2 * LOG_SQRT_2PI;
    },
    gradLogDensity: (v) => [-(v[0] - rho * v[1]) / det, -(v[1] - rho * v[0]) / det],
    fullConditionals: [
      (state, rng) => rho * state[1] + Math.sqrt(det) * rng.normal(),
      (state, rng) => rho * state[0] + Math.sqrt(det) * rng.normal(),
    ],
  };
}

/**
 * A well-separated two-component mixture in one dimension. Used to show that
 * R-hat actually fires: chains started in different modes will not mix in a
 * short run, and must not be reported as converged.
 */
export function bimodalTarget(separation = 8, sd = 1): TargetSpec {
  if (!(separation > 0) || !(sd > 0)) throw new EngineError('The separation and sd must be positive.', 'range');
  const m = separation / 2;
  return {
    id: 'bimodal-mixture',
    name: `Two-component normal mixture, modes at ${-m} and ${m}`,
    dimension: 1,
    parameterNames: ['x'],
    description: 'Reference multimodal target: a short run from dispersed starts must be flagged as not converged.',
    logDensity: (x) => {
      const a = normalLogPdf(x[0], -m, sd);
      const b = normalLogPdf(x[0], m, sd);
      const hi = Math.max(a, b);
      return hi + Math.log(0.5 * Math.exp(a - hi) + 0.5 * Math.exp(b - hi));
    },
  };
}

/**
 * Beta–Binomial posterior. With a Beta(priorA, priorB) prior and `successes`
 * out of `successes + failures` Bernoulli trials, the posterior is exactly
 * Beta(priorA + successes, priorB + failures) — which is what the conjugate
 * code in `src/engine/probability/bayesian.ts` computes. Sampling this target
 * and comparing against that closed form is the sharpest available check.
 *
 * `parameterisation`:
 *  - 'probability': theta = p on (0, 1); the log-density is -Infinity outside.
 *  - 'logit': theta = log(p / (1 - p)) on R, with the log Jacobian
 *    log(p) + log(1 - p) included, which gradient-based samplers need.
 */
export function betaBinomialPosterior(opts: {
  successes: number;
  failures: number;
  priorA?: number;
  priorB?: number;
  parameterisation?: 'probability' | 'logit';
}): TargetSpec {
  const { successes, failures } = opts;
  const a = opts.priorA ?? 1;
  const b = opts.priorB ?? 1;
  const mode = opts.parameterisation ?? 'probability';
  if (!Number.isInteger(successes) || successes < 0 || !Number.isInteger(failures) || failures < 0) {
    throw new EngineError('Successes and failures must be whole numbers of 0 or more.', 'range');
  }
  if (!(a > 0) || !(b > 0)) throw new EngineError('Both Beta prior parameters must be positive.', 'range');
  const postA = a + successes;
  const postB = b + failures;
  const kernel = (p: number): number => (postA - 1) * Math.log(p) + (postB - 1) * Math.log1p(-p);

  if (mode === 'probability') {
    return {
      id: 'beta-binomial',
      name: `Beta-Binomial posterior (${successes} of ${successes + failures}, Beta(${a}, ${b}) prior)`,
      dimension: 1,
      parameterNames: ['p'],
      description: `Conjugate answer: Beta(${postA}, ${postB}).`,
      suggestedStarts: [[0.5], [0.2], [0.8], [0.35]],
      logDensity: (x) => {
        const p = x[0];
        if (!(p > 0) || !(p < 1)) return -Infinity;
        return kernel(p);
      },
      fullConditionals: [(_state, rng) => rng.beta(postA, postB)],
    };
  }
  return {
    id: 'beta-binomial-logit',
    name: `Beta-Binomial posterior on the logit scale (${successes} of ${successes + failures})`,
    dimension: 1,
    parameterNames: ['logit_p'],
    description: `Conjugate answer after transforming back: Beta(${postA}, ${postB}).`,
    suggestedStarts: [[0], [-1], [1], [0.5]],
    logDensity: (x) => {
      const t = x[0];
      if (!Number.isFinite(t)) return -Infinity;
      const p = 1 / (1 + Math.exp(-t));
      if (!(p > 0) || !(p < 1)) return -Infinity;
      // Jacobian of p = sigmoid(t): dp/dt = p(1-p).
      return kernel(p) + Math.log(p) + Math.log1p(-p);
    },
    gradLogDensity: (x) => {
      const p = 1 / (1 + Math.exp(-x[0]));
      // d/dt [ (A-1)log p + (B-1)log(1-p) + log p + log(1-p) ] = A - (A+B)p
      return [postA - (postA + postB) * p];
    },
  };
}

/**
 * Gamma–Poisson posterior. With a Gamma(shape, rate) prior on the rate and
 * `counts` observed over `exposure` units of time, the posterior is exactly
 * Gamma(shape + sum(counts), rate + exposure).
 */
export function gammaPoissonPosterior(opts: {
  counts: readonly number[];
  priorShape?: number;
  priorRate?: number;
  exposure?: number;
}): TargetSpec {
  const counts = opts.counts;
  requireFiniteData(counts, 'The count data');
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0) throw new EngineError('Poisson counts must be whole numbers of 0 or more.', 'range');
  }
  const shape = opts.priorShape ?? 1;
  const rate = opts.priorRate ?? 1;
  if (!(shape > 0) || !(rate > 0)) throw new EngineError('The Gamma prior shape and rate must be positive.', 'range');
  const exposure = opts.exposure ?? counts.length;
  if (!(exposure > 0)) throw new EngineError('The exposure must be positive.', 'range');
  let total = 0;
  let logFactorials = 0;
  for (const c of counts) {
    total += c;
    logFactorials += logGamma(c + 1);
  }
  const postShape = shape + total;
  const postRate = rate + exposure;
  return {
    id: 'gamma-poisson',
    name: `Gamma-Poisson posterior (${total} events, exposure ${exposure})`,
    dimension: 1,
    parameterNames: ['lambda'],
    description: `Conjugate answer: Gamma(${postShape}, ${postRate}).`,
    suggestedStarts: [[Math.max(0.1, total / exposure)], [0.2], [3], [1]],
    logDensity: (x) => {
      const lambda = x[0];
      if (!(lambda > 0)) return -Infinity;
      return (postShape - 1) * Math.log(lambda) - postRate * lambda - logFactorials;
    },
    gradLogDensity: (x) => {
      const lambda = x[0];
      if (!(lambda > 0)) return [NaN];
      return [(postShape - 1) / lambda - postRate];
    },
    fullConditionals: [(_state, rng) => rng.gamma(postShape) / postRate],
  };
}

/* ------------------------------------------------------------------ *
 * Problems with no conjugate answer: the reason MCMC is here.
 * ------------------------------------------------------------------ */

/**
 * Logistic regression posterior with independent normal priors on the
 * coefficients. Parameters are [intercept, beta_1 ... beta_k].
 * log p = sum_i [ y_i·eta_i - log(1 + exp(eta_i)) ] + sum_j log N(beta_j | 0, priorSd).
 */
export function logisticRegressionPosterior(opts: {
  predictors: readonly (readonly number[])[];
  outcomes: readonly number[];
  priorSd?: number;
  predictorNames?: readonly string[];
}): TargetSpec {
  const { predictors, outcomes } = opts;
  if (!predictors.length || predictors.length !== outcomes.length) {
    throw new EngineError(
      `Logistic regression needs one predictor row per outcome: ${predictors.length} rows and ${outcomes.length} outcomes were supplied.`,
      'shape',
    );
  }
  const k = predictors[0].length;
  for (const row of predictors) {
    if (row.length !== k) throw new EngineError('Every predictor row must have the same number of columns.', 'shape');
    requireFiniteData(row, 'A predictor row');
  }
  for (const y of outcomes) {
    if (y !== 0 && y !== 1) throw new EngineError('Logistic regression outcomes must be 0 or 1.', 'range');
  }
  const priorSd = opts.priorSd ?? 2.5;
  if (!(priorSd > 0)) throw new EngineError('The prior standard deviation must be positive.', 'range');
  const d = k + 1;
  const names = ['intercept', ...(opts.predictorNames ?? Array.from({ length: k }, (_, j) => `beta[${j + 1}]`))];
  if (names.length !== d) throw new EngineError('The number of predictor names must match the number of predictors.', 'shape');

  const eta = (theta: readonly number[], i: number): number => {
    let s = theta[0];
    const row = predictors[i];
    for (let j = 0; j < k; j++) s += theta[j + 1] * row[j];
    return s;
  };

  return {
    id: 'logistic-regression',
    name: `Logistic regression posterior (${outcomes.length} observations, ${k} predictor${k === 1 ? '' : 's'})`,
    dimension: d,
    parameterNames: names,
    description: 'No conjugate form exists; the posterior is available only up to a constant.',
    logDensity: (theta) => {
      let s = 0;
      for (let i = 0; i < outcomes.length; i++) {
        const e = eta(theta, i);
        // log(1 + exp(e)) computed stably.
        const logOnePlus = e > 0 ? e + Math.log1p(Math.exp(-e)) : Math.log1p(Math.exp(e));
        s += outcomes[i] * e - logOnePlus;
      }
      for (let j = 0; j < d; j++) s += normalLogPdf(theta[j], 0, priorSd);
      return densityOrOutsideSupport(s);
    },
    gradLogDensity: (theta) => {
      const g = new Array<number>(d).fill(0);
      for (let i = 0; i < outcomes.length; i++) {
        const e = eta(theta, i);
        const p = 1 / (1 + Math.exp(-e));
        const r = outcomes[i] - p;
        g[0] += r;
        for (let j = 0; j < k; j++) g[j + 1] += r * predictors[i][j];
      }
      for (let j = 0; j < d; j++) g[j] -= theta[j] / (priorSd * priorSd);
      return g;
    },
    suggestedStarts: [new Array<number>(d).fill(0), new Array<number>(d).fill(0.5), new Array<number>(d).fill(-0.5), new Array<number>(d).fill(1)],
  };
}

/**
 * Poisson rate with a log-normal prior — the standard non-conjugate
 * alternative to the Gamma prior. Sampled on the unconstrained scale
 * theta = log(lambda), so the prior is normal in theta and the Poisson
 * likelihood contributes y·theta - exposure·exp(theta). No Jacobian term is
 * needed beyond that because the prior is specified on theta itself.
 */
export function poissonRateLogNormalPrior(opts: {
  counts: readonly number[];
  priorLogMean?: number;
  priorLogSd?: number;
  exposure?: number;
}): TargetSpec {
  requireFiniteData(opts.counts, 'The count data');
  const mu = opts.priorLogMean ?? 0;
  const sigma = opts.priorLogSd ?? 1;
  if (!(sigma > 0)) throw new EngineError('The log-normal prior sd must be positive.', 'range');
  const exposure = opts.exposure ?? opts.counts.length;
  if (!(exposure > 0)) throw new EngineError('The exposure must be positive.', 'range');
  let total = 0;
  let logFactorials = 0;
  for (const c of opts.counts) {
    if (!Number.isInteger(c) || c < 0) throw new EngineError('Poisson counts must be whole numbers of 0 or more.', 'range');
    total += c;
    logFactorials += logGamma(c + 1);
  }
  return {
    id: 'poisson-lognormal',
    name: `Poisson rate with a log-normal prior (${total} events, exposure ${exposure})`,
    dimension: 1,
    parameterNames: ['log_lambda'],
    description: 'Non-conjugate: the rate has a log-normal prior, so there is no closed-form posterior.',
    suggestedStarts: [[Math.log(Math.max(0.1, total / exposure))], [-1], [1], [0]],
    logDensity: (x) => {
      const theta = x[0];
      if (!Number.isFinite(theta)) return -Infinity;
      return densityOrOutsideSupport(
        total * theta - exposure * Math.exp(theta) - logFactorials + normalLogPdf(theta, mu, sigma),
      );
    },
    gradLogDensity: (x) => [total - exposure * Math.exp(x[0]) - (x[0] - mu) / (sigma * sigma)],
  };
}

/**
 * Normal with unknown mean AND unknown variance, sampled as
 * (mu, log sigma) so both parameters are unconstrained. Priors: mu ~ N(priorMeanMean,
 * priorMeanSd), sigma ~ Half-Normal(priorSigmaScale). The log Jacobian of
 * sigma = exp(log sigma) is log(sigma), included below.
 */
export function normalUnknownMeanAndVariance(opts: {
  data: readonly number[];
  priorMeanMean?: number;
  priorMeanSd?: number;
  priorSigmaScale?: number;
}): TargetSpec {
  const data = opts.data;
  requireFiniteData(data, 'The observations');
  if (data.length < 2) throw new EngineError('At least 2 observations are needed to learn both a mean and a variance.', 'insufficient');
  const m0 = opts.priorMeanMean ?? 0;
  const s0 = opts.priorMeanSd ?? 10;
  const scale = opts.priorSigmaScale ?? 5;
  if (!(s0 > 0) || !(scale > 0)) throw new EngineError('The prior scales must be positive.', 'range');
  const n = data.length;
  let sum = 0;
  for (const v of data) sum += v;
  const dataMean = sum / n;
  let sumSq = 0;
  for (const v of data) sumSq += (v - dataMean) * (v - dataMean);

  return {
    id: 'normal-unknown-mean-variance',
    name: `Normal with unknown mean and variance (${n} observations)`,
    dimension: 2,
    parameterNames: ['mu', 'log_sigma'],
    description: 'Both parameters unknown; sampled on (mu, log sigma) with the log Jacobian included.',
    suggestedStarts: [
      [dataMean, Math.log(Math.sqrt(sumSq / Math.max(1, n - 1)) || 1)],
      [dataMean + 2, 0],
      [dataMean - 2, 1],
      [0, -0.5],
    ],
    logDensity: (x) => {
      const mu = x[0];
      const logSigma = x[1];
      if (!Number.isFinite(mu) || !Number.isFinite(logSigma)) return -Infinity;
      const sigma = Math.exp(logSigma);
      const quad = sumSq + n * (dataMean - mu) * (dataMean - mu);
      const loglik = -n * logSigma - n * LOG_SQRT_2PI - quad / (2 * sigma * sigma);
      const priorMu = normalLogPdf(mu, m0, s0);
      // Half-normal prior on sigma, plus log|dsigma/dlog sigma| = log sigma.
      const priorSigma = -0.5 * (sigma / scale) * (sigma / scale) - Math.log(scale) + 0.5 * Math.log(2 / Math.PI);
      return densityOrOutsideSupport(loglik + priorMu + priorSigma + logSigma);
    },
    gradLogDensity: (x) => {
      const mu = x[0];
      const logSigma = x[1];
      const sigma = Math.exp(logSigma);
      const inv2 = 1 / (sigma * sigma);
      const quad = sumSq + n * (dataMean - mu) * (dataMean - mu);
      const dMu = n * (dataMean - mu) * inv2 - (mu - m0) / (s0 * s0);
      const dLogSigma = -n + quad * inv2 - (sigma * sigma) / (scale * scale) + 1;
      return [dMu, dLogSigma];
    },
  };
}

/**
 * The eight-schools hierarchical model (Rubin 1981), in the non-centred
 * parameterisation: theta_j = mu + tau·eta_j. The non-centred form is used
 * because the centred one has a funnel-shaped posterior that random-walk and
 * gradient samplers both struggle with — a modelling choice that matters more
 * than any sampler setting.
 *
 * Parameters: [mu, log_tau, eta_1 ... eta_J], with log|dtau/dlog tau| = log tau.
 */
export function hierarchicalEightSchools(opts?: {
  effects?: readonly number[];
  standardErrors?: readonly number[];
  priorMuSd?: number;
  priorTauScale?: number;
}): TargetSpec {
  const effects = opts?.effects ?? [28, 8, -3, 7, -1, 1, 18, 12];
  const ses = opts?.standardErrors ?? [15, 10, 16, 11, 9, 11, 10, 18];
  requireFiniteData(effects, 'The observed effects');
  requireFiniteData(ses, 'The standard errors');
  if (effects.length !== ses.length) {
    throw new EngineError('Each observed effect needs exactly one standard error.', 'shape');
  }
  for (const s of ses) if (!(s > 0)) throw new EngineError('Every standard error must be positive.', 'range');
  const J = effects.length;
  const muSd = opts?.priorMuSd ?? 10;
  const tauScale = opts?.priorTauScale ?? 5;
  if (!(muSd > 0) || !(tauScale > 0)) throw new EngineError('The prior scales must be positive.', 'range');
  const d = 2 + J;
  const names = ['mu', 'log_tau', ...Array.from({ length: J }, (_, j) => `eta[${j + 1}]`)];
  return {
    id: 'eight-schools',
    name: `Hierarchical partial pooling, ${J} groups (non-centred)`,
    dimension: d,
    parameterNames: names,
    description: 'Partial pooling across groups; tau controls how much the group estimates are shrunk towards mu.',
    suggestedStarts: [
      [0, 0, ...new Array<number>(J).fill(0)],
      [10, 1, ...new Array<number>(J).fill(0.5)],
      [-5, -1, ...new Array<number>(J).fill(-0.5)],
      [5, 0.5, ...new Array<number>(J).fill(0.2)],
    ],
    logDensity: (x) => {
      const mu = x[0];
      const logTau = x[1];
      if (!Number.isFinite(mu) || !Number.isFinite(logTau)) return -Infinity;
      const tau = Math.exp(logTau);
      let s = normalLogPdf(mu, 0, muSd);
      // Half-normal prior on tau plus the log Jacobian log tau.
      s += -0.5 * (tau / tauScale) * (tau / tauScale) - Math.log(tauScale) + 0.5 * Math.log(2 / Math.PI) + logTau;
      for (let j = 0; j < J; j++) {
        const eta = x[2 + j];
        if (!Number.isFinite(eta)) return -Infinity;
        s += normalLogPdf(eta, 0, 1);
        s += normalLogPdf(effects[j], mu + tau * eta, ses[j]);
      }
      return densityOrOutsideSupport(s);
    },
    gradLogDensity: (x) => {
      const mu = x[0];
      const tau = Math.exp(x[1]);
      const g = new Array<number>(d).fill(0);
      g[0] = -mu / (muSd * muSd);
      g[1] = -(tau * tau) / (tauScale * tauScale) + 1;
      for (let j = 0; j < J; j++) {
        const eta = x[2 + j];
        const theta = mu + tau * eta;
        const r = (effects[j] - theta) / (ses[j] * ses[j]);
        g[0] += r;
        g[1] += r * tau * eta; // chain rule through tau = exp(log tau)
        g[2 + j] = -eta + r * tau;
      }
      return g;
    },
  };
}

/**
 * Change-point model: counts are Poisson with rate lambda1 before an unknown
 * change point and lambda2 after it. Parameters are
 * [changePoint, log_lambda1, log_lambda2]; the change point is continuous
 * with a uniform prior on [0, n] and enters through floor(), which makes the
 * log-density piecewise constant in it. That is deliberate — the quantity is
 * genuinely discrete — but it means no useful gradient exists, so use slice
 * sampling or Metropolis here, not HMC.
 */
export function changePointPoisson(opts: {
  counts: readonly number[];
  priorLogMean?: number;
  priorLogSd?: number;
}): TargetSpec {
  const counts = opts.counts;
  requireFiniteData(counts, 'The count series');
  if (counts.length < 4) throw new EngineError('A change-point model needs at least 4 observations.', 'insufficient');
  for (const c of counts) {
    if (!Number.isInteger(c) || c < 0) throw new EngineError('Counts must be whole numbers of 0 or more.', 'range');
  }
  const n = counts.length;
  const mu = opts.priorLogMean ?? 0;
  const sd = opts.priorLogSd ?? 2;
  if (!(sd > 0)) throw new EngineError('The prior sd must be positive.', 'range');
  // Prefix sums make each evaluation O(1) in the data length.
  const prefix = new Float64Array(n + 1);
  let logFactorials = 0;
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + counts[i];
    logFactorials += logGamma(counts[i] + 1);
  }
  return {
    id: 'change-point-poisson',
    name: `Poisson change-point model (${n} observations)`,
    dimension: 3,
    parameterNames: ['change_point', 'log_lambda1', 'log_lambda2'],
    description: 'A rate that changes at an unknown time; the change point is a parameter with its own posterior.',
    suggestedStarts: [
      [n / 2, 0, 0],
      [n / 4, 0.5, -0.5],
      [(3 * n) / 4, -0.5, 0.5],
      [n / 3, 1, 1],
    ],
    logDensity: (x) => {
      const cp = x[0];
      if (!(cp >= 0) || !(cp <= n)) return -Infinity;
      const l1 = x[1];
      const l2 = x[2];
      if (!Number.isFinite(l1) || !Number.isFinite(l2)) return -Infinity;
      const k = Math.min(n, Math.max(0, Math.floor(cp)));
      const before = prefix[k];
      const after = prefix[n] - before;
      const r1 = Math.exp(l1);
      const r2 = Math.exp(l2);
      if (!Number.isFinite(r1) || !Number.isFinite(r2)) return -Infinity;
      const loglik = before * l1 - k * r1 + after * l2 - (n - k) * r2 - logFactorials;
      // Uniform prior on [0, n] for the change point contributes -log n.
      return densityOrOutsideSupport(loglik + normalLogPdf(l1, mu, sd) + normalLogPdf(l2, mu, sd) - Math.log(n));
    },
  };
}

export interface InferenceProblem {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  /** Sampler that suits this posterior, as a starting suggestion. */
  readonly recommendedSampler: 'adaptive-metropolis' | 'hmc' | 'slice' | 'gibbs';
  readonly build: () => TargetSpec;
}

/**
 * Ready-made problems with data attached, so the interface has something to
 * run without the user having to specify a model first.
 */
export const INFERENCE_PROBLEMS: readonly InferenceProblem[] = [
  {
    id: 'logistic-regression',
    name: 'Logistic regression',
    summary:
      'Probability of a binary outcome as a function of one predictor, with weakly informative normal priors on the coefficients. No conjugate posterior exists.',
    recommendedSampler: 'hmc',
    build: () =>
      logisticRegressionPosterior({
        predictors: [
          [-2.1], [-1.6], [-1.3], [-0.9], [-0.6], [-0.2], [0.1], [0.4], [0.7], [1.1],
          [1.4], [1.8], [2.2], [2.6], [-1.9], [-0.4], [0.9], [1.6], [2.9], [0.3],
        ],
        outcomes: [0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0],
        priorSd: 2.5,
        predictorNames: ['slope'],
      }),
  },
  {
    id: 'poisson-lognormal',
    name: 'Poisson rate, log-normal prior',
    summary:
      'An event rate with a log-normal prior instead of the conjugate Gamma. The prior is specified on the log scale, where beliefs about rates are usually easier to state.',
    recommendedSampler: 'slice',
    build: () => poissonRateLogNormalPrior({ counts: [2, 4, 1, 3, 5, 2, 0, 3, 4, 2], priorLogMean: 0.7, priorLogSd: 0.5 }),
  },
  {
    id: 'normal-unknown-mean-variance',
    name: 'Normal, unknown mean and variance',
    summary:
      'Both the mean and the spread are unknown, with a half-normal prior on the standard deviation. Reported on (mu, log sigma) so the sampler works in an unconstrained space.',
    recommendedSampler: 'hmc',
    build: () =>
      normalUnknownMeanAndVariance({
        data: [5.1, 4.4, 6.2, 5.8, 4.9, 5.5, 6.9, 4.2, 5.3, 5.9, 6.1, 4.8],
        priorMeanMean: 0,
        priorMeanSd: 10,
        priorSigmaScale: 5,
      }),
  },
  {
    id: 'eight-schools',
    name: 'Hierarchical partial pooling (eight schools)',
    summary:
      'Eight noisy estimates of the same kind of effect. The model learns how much the groups really differ, and shrinks each estimate towards the overall mean accordingly.',
    recommendedSampler: 'hmc',
    build: () => hierarchicalEightSchools(),
  },
  {
    id: 'change-point-poisson',
    name: 'Poisson change-point',
    summary:
      'A count series whose rate changes at an unknown time. The change point has a posterior of its own, which is the point of fitting it rather than eyeballing the series.',
    recommendedSampler: 'slice',
    build: () =>
      changePointPoisson({
        counts: [4, 5, 4, 1, 0, 4, 3, 4, 0, 6, 3, 3, 4, 0, 2, 6, 3, 3, 5, 4, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 2],
        priorLogMean: 1,
        priorLogSd: 1,
      }),
  },
];

export function getInferenceProblem(id: string): InferenceProblem {
  const found = INFERENCE_PROBLEMS.find((p) => p.id === id);
  if (!found) {
    throw new EngineError(
      `Unknown inference problem "${id}". Available: ${INFERENCE_PROBLEMS.map((p) => p.id).join(', ')}.`,
      'unknown',
    );
  }
  return found;
}
