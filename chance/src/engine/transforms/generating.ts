/**
 * Generating functions and transforms of the registry's distributions:
 * probability generating functions, moment generating functions,
 * characteristic functions, cumulant generating functions and cumulants.
 *
 * The central honesty point of this file is the **region of convergence**. The
 * moment generating function does not exist everywhere, and for a heavy-tailed
 * distribution (Cauchy, Student t, Pareto, Lévy, Fréchet, Burr, beta-prime,
 * Yule–Simon, F) it does not exist at any t > 0 — for Cauchy and Student t it
 * exists only at the single point t = 0, which is no function at all. Those
 * cases are reported as an `EngineError` naming the region, never computed
 * through to a plausible-looking number. The characteristic function, by
 * contrast, always exists, which is exactly why inversion in this module is
 * built on it rather than on the MGF.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { logSumExp, stableSum } from '../core/numeric';
import { digamma, logGamma, normalCdf } from '../special/gamma';
import { gaussLegendreUnit } from '../portfolio/numerics';
import { getDistribution } from '../distributions/registry';
import type { DistributionDef, Params } from '../distributions/types';
import { cExp, cMul, cScale, cUnit, complex, type Complex } from './complex';

/* ------------------------------------------------------------------ *
 * Region of convergence                                              *
 * ------------------------------------------------------------------ */

export interface RegionOfConvergence {
  lower: number;
  upper: number;
  lowerInclusive: boolean;
  upperInclusive: boolean;
  /**
   * False when the MGF exists only at t = 0 (so there is no neighbourhood of 0
   * on which it is a function, and no moment can be read off it).
   */
  exists: boolean;
  /** Plain-language statement of where the MGF is finite, for display. */
  description: string;
}

const ALL_REAL: RegionOfConvergence = {
  lower: -Infinity,
  upper: Infinity,
  lowerInclusive: false,
  upperInclusive: false,
  exists: true,
  description: 'The MGF is finite for every real t (the distribution has bounded support or a tail lighter than any exponential).',
};

function upTo(upper: number, inclusive: boolean, why: string): RegionOfConvergence {
  return {
    lower: -Infinity,
    upper,
    lowerInclusive: false,
    upperInclusive: inclusive,
    exists: true,
    description: `The MGF is finite for t ${inclusive ? '≤' : '<'} ${upper} and infinite above it. ${why}`,
  };
}

function symmetricAbout(half: number, why: string): RegionOfConvergence {
  return {
    lower: -half,
    upper: half,
    lowerInclusive: false,
    upperInclusive: false,
    exists: true,
    description: `The MGF is finite for |t| < ${half} and infinite outside. ${why}`,
  };
}

const ONLY_ZERO: RegionOfConvergence = {
  lower: 0,
  upper: 0,
  lowerInclusive: true,
  upperInclusive: true,
  exists: false,
  description:
    'The MGF exists only at t = 0, where it is trivially 1. The distribution has tails too heavy on both sides for E[e^{tX}] to be finite at any other t, so there is no moment generating function and no cumulant expansion. Use the characteristic function instead.',
};

/** Heavy right tail: the MGF exists for t ≤ 0 only. */
function nonPositiveOnly(why: string): RegionOfConvergence {
  return {
    lower: -Infinity,
    upper: 0,
    lowerInclusive: false,
    upperInclusive: true,
    exists: true,
    description: `The MGF is finite only for t ≤ 0 and infinite for every t > 0. ${why}`,
  };
}

type RegionFn = (p: Params) => RegionOfConvergence;

const POWER_LAW = 'The right tail falls off like a power of x, which no exponential can dominate, so E[e^{tX}] diverges for every positive t.';

const MGF_REGIONS: Record<string, RegionFn> = {
  // Bounded or super-exponentially light: finite everywhere.
  bernoulli: () => ALL_REAL,
  binomial: () => ALL_REAL,
  hypergeometric: () => ALL_REAL,
  poisson: () => ALL_REAL,
  discreteUniform: () => ALL_REAL,
  uniform: () => ALL_REAL,
  normal: () => ALL_REAL,
  beta: () => ALL_REAL,
  triangular: () => ALL_REAL,
  pert: () => ALL_REAL,
  rayleigh: () => ALL_REAL,
  nakagami: () => ALL_REAL,
  halfNormal: () => ALL_REAL,
  truncatedNormal: () => ALL_REAL,
  vonMises: () => ALL_REAL,
  kumaraswamy: () => ALL_REAL,
  betaBinomial: () => ALL_REAL,
  skellam: () => ALL_REAL,
  zipf: () => ALL_REAL,
  comPoisson: () => ALL_REAL,

  // Geometric-type tails: finite up to the tail decay rate.
  geometric: ({ p }) =>
    p >= 1 ? ALL_REAL : upTo(-Math.log1p(-p), false, 'The pmf decays like (1 − p)^k, so the MGF diverges once e^t reaches 1/(1 − p).'),
  negativeBinomial: ({ p }) =>
    p >= 1 ? ALL_REAL : upTo(-Math.log1p(-p), false, 'The pmf decays like (1 − p)^k, so the MGF diverges once e^t reaches 1/(1 − p).'),
  logarithmic: ({ p }) => upTo(-Math.log(p), false, 'The pmf decays like p^k/k, so the MGF diverges once e^t reaches 1/p.'),
  exponential: ({ lambda }) => upTo(lambda, false, 'The density decays like e^{−λx}, so the MGF diverges at t = λ.'),
  gamma: ({ theta }) => upTo(1 / theta, false, 'The density decays like e^{−x/θ}, so the MGF diverges at t = 1/θ.'),
  erlang: ({ lambda }) => upTo(lambda, false, 'The density decays like e^{−λx}, so the MGF diverges at t = λ.'),
  chiSquare: () => upTo(0.5, false, 'A chi-square is a gamma with scale 2, so the MGF diverges at t = 1/2.'),
  gumbel: ({ beta }) => upTo(1 / beta, false, 'The MGF is e^{μt}Γ(1 − βt), whose gamma factor has a pole at t = 1/β.'),
  inverseGaussian: ({ mu, lambda }) =>
    upTo(lambda / (2 * mu * mu), true, 'The MGF is finite up to and including t = λ/(2μ²), where the square root in the exponent reaches zero.'),
  laplace: ({ b }) => symmetricAbout(1 / b, 'Both tails decay like e^{−|x|/b}.'),
  logistic: ({ s }) => symmetricAbout(1 / s, 'Both tails decay like e^{−|x|/s}.'),
  weibull: ({ k, lambda }) =>
    k > 1
      ? ALL_REAL
      : k === 1
        ? upTo(1 / lambda, false, 'With shape 1 the Weibull is an exponential with rate 1/λ.')
        : nonPositiveOnly('With shape k < 1 the tail e^{−(x/λ)^k} is sub-exponential, so no positive t gives a finite expectation.'),
  lognormal: () =>
    nonPositiveOnly(
      'The lognormal MGF diverges for every t > 0: the density falls off only like e^{−(ln x)²}, far slower than any exponential. The lognormal has all its moments but no moment generating function on the positive side.',
    ),

  // Power-law right tails: nothing positive.
  pareto: () => nonPositiveOnly(POWER_LAW),
  frechet: () => nonPositiveOnly(POWER_LAW),
  betaPrime: () => nonPositiveOnly(POWER_LAW),
  burr12: () => nonPositiveOnly(POWER_LAW),
  levy: () => nonPositiveOnly(POWER_LAW),
  fDistribution: () => nonPositiveOnly(POWER_LAW),
  yuleSimon: () => nonPositiveOnly(POWER_LAW),

  // Two-sided power-law tails: the MGF exists nowhere but 0.
  cauchy: () => ONLY_ZERO,
  studentT: () => ONLY_ZERO,
};

/**
 * Where the MGF of `def` is finite. Throws rather than guessing for a
 * distribution whose tail behaviour this module has not been told about: a
 * fabricated region of convergence would make every downstream saddlepoint and
 * cumulant result silently unreliable.
 */
export function mgfRegion(def: DistributionDef, params: Params): RegionOfConvergence {
  const fn = MGF_REGIONS[def.id];
  if (!fn) {
    throw new EngineError(
      `The region of convergence of the MGF of "${def.id}" is not recorded in the transforms module, and it cannot be determined numerically (a finite numerical integral never proves convergence). Add it to MGF_REGIONS, or use the characteristic function, which always exists.`,
      'unsupported',
    );
  }
  return fn(params);
}

export function inRegion(roc: RegionOfConvergence, t: number): boolean {
  if (!Number.isFinite(t)) return false;
  if (t < roc.lower || (t === roc.lower && !roc.lowerInclusive)) return false;
  if (t > roc.upper || (t === roc.upper && !roc.upperInclusive)) return false;
  return true;
}

function assertInRegion(def: DistributionDef, roc: RegionOfConvergence, t: number): void {
  if (!roc.exists) {
    throw new EngineError(
      `The ${def.name} distribution has no moment generating function. ${roc.description}`,
      'no-mgf',
    );
  }
  if (!inRegion(roc, t)) {
    throw new EngineError(
      `t = ${t} lies outside the region of convergence of the ${def.name} MGF. ${roc.description} No value is reported, because E[e^{tX}] is infinite there.`,
      'out-of-region',
    );
  }
}

/* ------------------------------------------------------------------ *
 * Analytic transform table                                           *
 * ------------------------------------------------------------------ */

interface AnalyticTransform {
  /** log E[e^{tX}], valid on the region of convergence. */
  cgf(t: number, p: Params): number;
  /** dK/dt, analytic where it is cheap; otherwise numerical differentiation. */
  dcgf?(t: number, p: Params): number;
  /** d²K/dt², likewise. */
  d2cgf?(t: number, p: Params): number;
  /** E[e^{itX}] in closed form. */
  cf?(t: number, p: Params): Complex;
  /** E[z^X] in closed form, for a discrete distribution. */
  pgf?(z: number, p: Params): number;
  mgfFormula: string;
  cfFormula?: string;
  pgfFormula?: string;
}

/** log(1 − q e^t) with care when q e^t approaches 1. */
function logOneMinusQExp(q: number, t: number): number {
  const x = Math.log(q) + t;
  if (x >= 0) {
    throw new EngineError('Internal: geometric-type MGF evaluated at or beyond its pole.', 'out-of-region');
  }
  return Math.log1p(-Math.exp(x));
}

const ANALYTIC: Record<string, AnalyticTransform> = {
  bernoulli: {
    cgf: (t, { p }) => Math.log(1 - p + p * Math.exp(t)),
    dcgf: (t, { p }) => {
      const e = p * Math.exp(t);
      return e / (1 - p + e);
    },
    d2cgf: (t, { p }) => {
      const e = p * Math.exp(t);
      const m = e / (1 - p + e);
      return m * (1 - m);
    },
    cf: (t, { p }) => complex(1 - p + p * Math.cos(t), p * Math.sin(t)),
    pgf: (z, { p }) => 1 - p + p * z,
    mgfFormula: 'M(t) = 1 − p + p·e^t',
    cfFormula: 'φ(t) = 1 − p + p·e^{it}',
    pgfFormula: 'G(z) = 1 − p + p·z',
  },
  binomial: {
    cgf: (t, { n, p }) => n * Math.log(1 - p + p * Math.exp(t)),
    dcgf: (t, { n, p }) => {
      const e = p * Math.exp(t);
      return (n * e) / (1 - p + e);
    },
    d2cgf: (t, { n, p }) => {
      const e = p * Math.exp(t);
      const m = e / (1 - p + e);
      return n * m * (1 - m);
    },
    cf: (t, { n, p }) => {
      const base = complex(1 - p + p * Math.cos(t), p * Math.sin(t));
      let acc = complex(1, 0);
      for (let i = 0; i < n; i++) acc = cMul(acc, base);
      return acc;
    },
    pgf: (z, { n, p }) => Math.pow(1 - p + p * z, n),
    mgfFormula: 'M(t) = (1 − p + p·e^t)^n',
    cfFormula: 'φ(t) = (1 − p + p·e^{it})^n',
    pgfFormula: 'G(z) = (1 − p + p·z)^n',
  },
  // Registry convention: X counts trials INCLUDING the first success, so the
  // support starts at 1 and the PGF carries a factor z.
  geometric: {
    cgf: (t, { p }) => (p >= 1 ? t : t + Math.log(p) - logOneMinusQExp(1 - p, t)),
    dcgf: (t, { p }) => {
      if (p >= 1) return 1;
      const q = (1 - p) * Math.exp(t);
      return 1 + q / (1 - q);
    },
    d2cgf: (t, { p }) => {
      if (p >= 1) return 0;
      const q = (1 - p) * Math.exp(t);
      return q / ((1 - q) * (1 - q));
    },
    cf: (t, { p }) => {
      const num = cScale(cUnit(t), p);
      const den = { re: 1 - (1 - p) * Math.cos(t), im: -(1 - p) * Math.sin(t) };
      const d = den.re * den.re + den.im * den.im;
      return complex((num.re * den.re + num.im * den.im) / d, (num.im * den.re - num.re * den.im) / d);
    },
    pgf: (z, { p }) => {
      const den = 1 - (1 - p) * z;
      if (den === 0) throw new EngineError('The geometric PGF has a pole at z = 1/(1 − p); it is not defined there.', 'range');
      return (p * z) / den;
    },
    mgfFormula: 'M(t) = p·e^t / (1 − (1 − p)·e^t)   for t < −ln(1 − p)',
    pgfFormula: 'G(z) = p·z / (1 − (1 − p)·z)   for |z| < 1/(1 − p)',
  },
  // Registry convention: X counts FAILURES before the r-th success.
  negativeBinomial: {
    cgf: (t, { r, p }) => (p >= 1 ? 0 : r * (Math.log(p) - logOneMinusQExp(1 - p, t))),
    dcgf: (t, { r, p }) => {
      if (p >= 1) return 0;
      const q = (1 - p) * Math.exp(t);
      return (r * q) / (1 - q);
    },
    d2cgf: (t, { r, p }) => {
      if (p >= 1) return 0;
      const q = (1 - p) * Math.exp(t);
      return (r * q) / ((1 - q) * (1 - q));
    },
    pgf: (z, { r, p }) => {
      const den = 1 - (1 - p) * z;
      if (den <= 0) throw new EngineError('The negative-binomial PGF has a pole at z = 1/(1 − p); it is not defined there or beyond.', 'range');
      return Math.pow(p / den, r);
    },
    mgfFormula: 'M(t) = (p / (1 − (1 − p)·e^t))^r   for t < −ln(1 − p)',
    pgfFormula: 'G(z) = (p / (1 − (1 − p)·z))^r',
  },
  poisson: {
    cgf: (t, { lambda }) => lambda * Math.expm1(t),
    dcgf: (t, { lambda }) => lambda * Math.exp(t),
    d2cgf: (t, { lambda }) => lambda * Math.exp(t),
    cf: (t, { lambda }) => cExp(complex(lambda * (Math.cos(t) - 1), lambda * Math.sin(t))),
    pgf: (z, { lambda }) => Math.exp(lambda * (z - 1)),
    mgfFormula: 'M(t) = exp(λ(e^t − 1))',
    cfFormula: 'φ(t) = exp(λ(e^{it} − 1))',
    pgfFormula: 'G(z) = exp(λ(z − 1))',
  },
  discreteUniform: {
    cgf: (t, { a, b }) => {
      const terms: number[] = [];
      for (let k = a; k <= b; k++) terms.push(k * t);
      return logSumExp(terms) - Math.log(b - a + 1);
    },
    dcgf: (t, { a, b }) => weightedMoments(a, b, t).m1,
    d2cgf: (t, { a, b }) => {
      const { m1, m2 } = weightedMoments(a, b, t);
      return m2 - m1 * m1;
    },
    pgf: (z, { a, b }) => {
      const m = b - a + 1;
      let acc = 0;
      for (let k = a; k <= b; k++) acc += Math.pow(z, k);
      return acc / m;
    },
    mgfFormula: 'M(t) = (1/m)·Σ_{k=a}^{b} e^{kt},  m = b − a + 1',
    pgfFormula: 'G(z) = (1/m)·Σ_{k=a}^{b} z^k',
  },
  logarithmic: {
    cgf: (t, { p }) => {
      const x = Math.log(p) + t;
      if (x >= 0) throw new EngineError('Internal: log-series MGF evaluated at or beyond its pole.', 'out-of-region');
      return Math.log(-Math.log1p(-Math.exp(x))) - Math.log(-Math.log1p(-p));
    },
    pgf: (z, { p }) => {
      if (p * z >= 1) throw new EngineError('The log-series PGF is not defined for p·z ≥ 1.', 'range');
      return Math.log1p(-p * z) / Math.log1p(-p);
    },
    mgfFormula: 'M(t) = ln(1 − p·e^t) / ln(1 − p)',
    pgfFormula: 'G(z) = ln(1 − p·z) / ln(1 − p)',
  },
  skellam: {
    cgf: (t, { mu1, mu2 }) => -(mu1 + mu2) + mu1 * Math.exp(t) + mu2 * Math.exp(-t),
    dcgf: (t, { mu1, mu2 }) => mu1 * Math.exp(t) - mu2 * Math.exp(-t),
    d2cgf: (t, { mu1, mu2 }) => mu1 * Math.exp(t) + mu2 * Math.exp(-t),
    mgfFormula: 'M(t) = exp(μ₁(e^t − 1) + μ₂(e^{−t} − 1))',
  },

  normal: {
    cgf: (t, { mu, sigma }) => mu * t + 0.5 * sigma * sigma * t * t,
    dcgf: (t, { mu, sigma }) => mu + sigma * sigma * t,
    d2cgf: (_t, { sigma }) => sigma * sigma,
    cf: (t, { mu, sigma }) => cScale(cUnit(mu * t), Math.exp(-0.5 * sigma * sigma * t * t)),
    mgfFormula: 'M(t) = exp(μt + σ²t²/2)',
    cfFormula: 'φ(t) = exp(iμt − σ²t²/2)',
  },
  exponential: {
    cgf: (t, { lambda }) => Math.log(lambda) - Math.log(lambda - t),
    dcgf: (t, { lambda }) => 1 / (lambda - t),
    d2cgf: (t, { lambda }) => 1 / ((lambda - t) * (lambda - t)),
    cf: (t, { lambda }) => {
      const d = lambda * lambda + t * t;
      return complex((lambda * lambda) / d, (lambda * t) / d);
    },
    mgfFormula: 'M(t) = λ / (λ − t)   for t < λ',
    cfFormula: 'φ(t) = λ / (λ − it)',
  },
  gamma: {
    cgf: (t, { k, theta }) => -k * Math.log1p(-theta * t),
    dcgf: (t, { k, theta }) => (k * theta) / (1 - theta * t),
    d2cgf: (t, { k, theta }) => (k * theta * theta) / ((1 - theta * t) * (1 - theta * t)),
    cf: (t, { k, theta }) => {
      // (1 − iθt)^{−k} on the principal branch.
      const r = Math.hypot(1, -theta * t);
      const a = Math.atan2(-theta * t, 1);
      return cScale(cUnit(-k * a), Math.pow(r, -k));
    },
    mgfFormula: 'M(t) = (1 − θt)^{−k}   for t < 1/θ',
    cfFormula: 'φ(t) = (1 − iθt)^{−k}',
  },
  erlang: {
    cgf: (t, { k, lambda }) => -k * Math.log1p(-t / lambda),
    dcgf: (t, { k, lambda }) => k / (lambda - t),
    d2cgf: (t, { k, lambda }) => k / ((lambda - t) * (lambda - t)),
    mgfFormula: 'M(t) = (1 − t/λ)^{−k}   for t < λ',
  },
  chiSquare: {
    cgf: (t, { k }) => -0.5 * k * Math.log1p(-2 * t),
    dcgf: (t, { k }) => k / (1 - 2 * t),
    d2cgf: (t, { k }) => (2 * k) / ((1 - 2 * t) * (1 - 2 * t)),
    cf: (t, { k }) => {
      const r = Math.hypot(1, -2 * t);
      const a = Math.atan2(-2 * t, 1);
      return cScale(cUnit((-k / 2) * a), Math.pow(r, -k / 2));
    },
    mgfFormula: 'M(t) = (1 − 2t)^{−k/2}   for t < 1/2',
  },
  uniform: {
    cgf: (t, { a, b }) => {
      if (t === 0) return 0;
      const w = b - a;
      // log((e^{bt} − e^{at}) / (t·w)) written so that neither exponential
      // overflows and the t → 0 limit is approached smoothly.
      const m = Math.max(a * t, b * t);
      const diff = Math.exp(a * t - m) - Math.exp(b * t - m);
      return m + Math.log(Math.abs(diff)) - Math.log(Math.abs(t * w));
    },
    cf: (t, { a, b }) => {
      if (t === 0) return complex(1, 0);
      const w = b - a;
      const hi = cUnit(b * t);
      const lo = cUnit(a * t);
      // (e^{ibt} − e^{iat}) / (i t w)
      const num = { re: hi.re - lo.re, im: hi.im - lo.im };
      const s = 1 / (t * w);
      return complex(num.im * s, -num.re * s);
    },
    mgfFormula: 'M(t) = (e^{bt} − e^{at}) / (t(b − a)),  M(0) = 1',
  },
  laplace: {
    cgf: (t, { mu, b }) => mu * t - Math.log1p(-b * b * t * t),
    dcgf: (t, { mu, b }) => mu + (2 * b * b * t) / (1 - b * b * t * t),
    cf: (t, { mu, b }) => cScale(cUnit(mu * t), 1 / (1 + b * b * t * t)),
    mgfFormula: 'M(t) = e^{μt} / (1 − b²t²)   for |t| < 1/b',
  },
  logistic: {
    cgf: (t, { mu, s }) => mu * t + logGamma(1 - s * t) + logGamma(1 + s * t),
    dcgf: (t, { mu, s }) => mu + s * (digamma(1 + s * t) - digamma(1 - s * t)),
    mgfFormula: 'M(t) = e^{μt}·Γ(1 − st)·Γ(1 + st)   for |t| < 1/s',
  },
  gumbel: {
    cgf: (t, { mu, beta }) => mu * t + logGamma(1 - beta * t),
    dcgf: (t, { mu, beta }) => mu - beta * digamma(1 - beta * t),
    mgfFormula: 'M(t) = e^{μt}·Γ(1 − βt)   for t < 1/β',
  },
  inverseGaussian: {
    cgf: (t, { mu, lambda }) => (lambda / mu) * (1 - Math.sqrt(1 - (2 * mu * mu * t) / lambda)),
    dcgf: (t, { mu, lambda }) => mu / Math.sqrt(1 - (2 * mu * mu * t) / lambda),
    d2cgf: (t, { mu, lambda }) => ((mu * mu * mu) / lambda) * Math.pow(1 - (2 * mu * mu * t) / lambda, -1.5),
    mgfFormula: 'M(t) = exp((λ/μ)(1 − √(1 − 2μ²t/λ)))   for t ≤ λ/(2μ²)',
  },
  halfNormal: {
    cgf: (t, { sigma }) => Math.LN2 + 0.5 * sigma * sigma * t * t + Math.log(normalCdf(sigma * t)),
    mgfFormula: 'M(t) = 2·exp(σ²t²/2)·Φ(σt)',
  },
  rayleigh: {
    cgf: (t, { sigma }) => {
      const st = sigma * t;
      // 1 + σt·e^{σ²t²/2}·√(π/2)·(1 + erf(σt/√2)); the bracket equals
      // 2Φ(σt), reused from the special-function module.
      const m = 1 + st * Math.exp(0.5 * st * st) * Math.sqrt(Math.PI / 2) * 2 * normalCdf(st);
      if (!(m > 0)) {
        throw new EngineError('Internal: the Rayleigh MGF evaluated non-positive, so its logarithm is undefined.', 'numerical');
      }
      return Math.log(m);
    },
    mgfFormula: 'M(t) = 1 + σt·e^{σ²t²/2}·√(2π)·Φ(σt)',
  },
  cauchy: {
    cgf: () => {
      throw new EngineError('The Cauchy distribution has no moment generating function; see its region of convergence.', 'no-mgf');
    },
    cf: (t, { x0, gamma }) => cScale(cUnit(x0 * t), Math.exp(-gamma * Math.abs(t))),
    mgfFormula: 'No MGF exists.',
    cfFormula: 'φ(t) = exp(i·x₀t − γ|t|)',
  },
};

/** Σ k·w_k and Σ k²·w_k for the exponentially tilted discrete uniform. */
function weightedMoments(a: number, b: number, t: number): { m1: number; m2: number } {
  const ks: number[] = [];
  for (let k = a; k <= b; k++) ks.push(k);
  const logs = ks.map((k) => k * t);
  const lse = logSumExp(logs);
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < ks.length; i++) {
    const w = Math.exp(logs[i] - lse);
    m1 += ks[i] * w;
    m2 += ks[i] * ks[i] * w;
  }
  return { m1, m2 };
}

/* ------------------------------------------------------------------ *
 * Numerical quadrature fallback                                      *
 * ------------------------------------------------------------------ */

/** Tail mass left outside the truncation used by a numerical transform. */
const NUMERIC_TAIL = 1e-13;
/** Gauss–Legendre panels and nodes per panel for the continuous fallback. */
const PANELS = 96;
const NODES = 16;

interface NumericGrid {
  /** Abscissae. */
  x: number[];
  /** Weights already including the density (continuous) or the pmf (discrete). */
  w: number[];
  truncation: { lower: number; upper: number; tailMass: number; terms: number };
}

const gridCache = new Map<string, NumericGrid>();

function numericGrid(def: DistributionDef, params: Params): NumericGrid {
  const key = `${def.id}|${JSON.stringify(params)}`;
  const cached = gridCache.get(key);
  if (cached) return cached;

  const sup = def.support(params);
  let grid: NumericGrid;
  if (def.kind === 'discrete') {
    const lo = Number.isFinite(sup.min) ? sup.min : def.quantile(NUMERIC_TAIL, params);
    const hi = Number.isFinite(sup.max) ? sup.max : def.quantile(1 - NUMERIC_TAIL, params);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new EngineError(
        `A numerical transform of "${def.id}" needs a finite truncation of its support, but the ${NUMERIC_TAIL} and ${1 - NUMERIC_TAIL} quantiles are not finite. No value is reported.`,
        'numerical',
      );
    }
    const terms = Math.round(hi - lo) + 1;
    if (terms > 2_000_000) {
      throw new EngineError(
        `A numerical transform of "${def.id}" would need ${terms} pmf evaluations to cover all but ${2 * NUMERIC_TAIL} of the mass. That is beyond the limit of 2,000,000 terms, so no value is reported.`,
        'too-large',
      );
    }
    const x: number[] = [];
    const w: number[] = [];
    for (let k = Math.round(lo); k <= Math.round(hi); k++) {
      x.push(k);
      w.push(def.pdf(k, params));
    }
    const mass = stableSum(w);
    grid = { x, w, truncation: { lower: lo, upper: hi, tailMass: Math.max(0, 1 - mass), terms } };
  } else {
    // Quantile substitution: ∫ g(x)f(x) dx = ∫₀¹ g(Q(u)) du. This is the only
    // robust choice across the registry. A fixed x-range quadrature loses
    // almost all of the mass of a heavy-tailed law — a Pareto's 1 − 1e-13
    // quantile is astronomically large, and a few hundred panels spread over
    // that range capture a couple of percent of the density, which would make
    // φ(0) come out at 0.02 instead of 1. Under the substitution the weights
    // sum to 1 − 2δ by construction, so no mass can be silently lost.
    const delta = NUMERIC_TAIL;
    const { nodes, weights } = gaussLegendreUnit(NODES);
    const x: number[] = [];
    const w: number[] = [];
    const h = (1 - 2 * delta) / PANELS;
    for (let panel = 0; panel < PANELS; panel++) {
      const a = delta + panel * h;
      for (let i = 0; i < nodes.length; i++) {
        const u = a + nodes[i] * h;
        const xi = def.quantile(u, params);
        if (!Number.isFinite(xi)) {
          throw new EngineError(
            `A numerical transform of "${def.id}" needs finite quantiles over (0, 1), but Q(${u}) is not finite. No value is reported.`,
            'numerical',
          );
        }
        x.push(xi);
        w.push(weights[i] * h);
      }
    }
    const mass = stableSum(w);
    grid = {
      x,
      w,
      truncation: {
        lower: x[0],
        upper: x[x.length - 1],
        tailMass: Math.abs(1 - mass),
        terms: x.length,
      },
    };
  }
  gridCache.set(key, grid);
  return grid;
}

/* ------------------------------------------------------------------ *
 * Public transform evaluations                                       *
 * ------------------------------------------------------------------ */

export type TransformRoute = 'analytic' | 'numerical-quadrature' | 'numerical-summation';

export interface RealTransformValue {
  value: number;
  route: TransformRoute;
  exactness: Exactness;
  formula: string;
  /** Present for a numerical route: what was truncated away. */
  truncation?: { lower: number; upper: number; tailMass: number; terms: number };
  notes: string[];
}

export interface ComplexTransformValue extends Omit<RealTransformValue, 'value'> {
  value: Complex;
}

/** E[z^X] for a discrete distribution. */
export function pgf(id: string, params: Params, z: number): RealTransformValue {
  const def = getDistribution(id);
  if (def.kind !== 'discrete') {
    throw new EngineError(
      `A probability generating function is only defined for a discrete distribution; "${id}" is continuous. Use the MGF or the characteristic function instead.`,
      'invalid',
    );
  }
  if (!Number.isFinite(z)) throw new EngineError('The PGF argument z must be a finite number.', 'finite');
  const a = ANALYTIC[id];
  if (a?.pgf) {
    return {
      value: a.pgf(z, params),
      route: 'analytic',
      exactness: 'exact',
      formula: a.pgfFormula ?? a.mgfFormula,
      notes: [],
    };
  }
  const grid = numericGrid(def, params);
  const terms = grid.x.map((k, i) => grid.w[i] * Math.pow(z, k));
  const value = stableSum(terms);
  if (!Number.isFinite(value)) {
    throw new EngineError(
      `The PGF of "${id}" at z = ${z} overflowed: Σ p_k z^k is not finite, so the series does not converge there. No value is reported.`,
      'out-of-region',
    );
  }
  return {
    value,
    route: 'numerical-summation',
    exactness: 'numerical',
    formula: 'G(z) = Σ_k P(X = k)·z^k, summed directly over the truncated support',
    truncation: grid.truncation,
    notes: [
      `Summed over ${grid.truncation.terms} support points from ${grid.truncation.lower} to ${grid.truncation.upper}; the omitted tail carries about ${grid.truncation.tailMass.toExponential(2)} of the mass.`,
    ],
  };
}

/** log E[e^{tX}] — the cumulant generating function. */
export function cgf(id: string, params: Params, t: number): RealTransformValue {
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  assertInRegion(def, roc, t);
  const a = ANALYTIC[id];
  if (a) {
    return { value: a.cgf(t, params), route: 'analytic', exactness: 'exact', formula: `K(t) = ln M(t),  ${a.mgfFormula}`, notes: [roc.description] };
  }
  const m = mgf(id, params, t);
  if (!(m.value > 0)) {
    throw new EngineError(
      `The numerical MGF of "${id}" at t = ${t} evaluated to ${m.value}, which has no logarithm. No cumulant generating value is reported.`,
      'numerical',
    );
  }
  return { ...m, value: Math.log(m.value), formula: 'K(t) = ln M(t), M computed numerically' };
}

/** E[e^{tX}] — the moment generating function, refused outside its region. */
export function mgf(id: string, params: Params, t: number): RealTransformValue {
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  assertInRegion(def, roc, t);
  const a = ANALYTIC[id];
  if (a) {
    return {
      value: Math.exp(a.cgf(t, params)),
      route: 'analytic',
      exactness: 'exact',
      formula: a.mgfFormula,
      notes: [roc.description],
    };
  }
  const grid = numericGrid(def, params);
  const terms = grid.x.map((x, i) => grid.w[i] * Math.exp(t * x));
  const value = stableSum(terms);
  if (!Number.isFinite(value)) {
    throw new EngineError(
      `The numerical MGF of "${id}" at t = ${t} overflowed. No value is reported. ${roc.description}`,
      'numerical',
    );
  }
  const route: TransformRoute = def.kind === 'discrete' ? 'numerical-summation' : 'numerical-quadrature';
  return {
    value,
    route,
    exactness: 'numerical',
    formula: 'M(t) = ∫ e^{tx} f(x) dx (or Σ e^{tk} p_k), evaluated on a truncated range',
    truncation: grid.truncation,
    notes: [
      roc.description,
      `Evaluated on the quantile range [${grid.truncation.lower.toPrecision(6)}, ${grid.truncation.upper.toPrecision(6)}] with ${grid.truncation.terms} points; the quadrature reproduces the total mass to ${grid.truncation.tailMass.toExponential(2)}. For large t the omitted ${NUMERIC_TAIL} of upper tail matters far more than that figure suggests, because it is weighted by e^{tx}.`,
    ],
  };
}

/** E[e^{itX}] — the characteristic function, which always exists. */
export function cf(id: string, params: Params, t: number): ComplexTransformValue {
  const def = getDistribution(id);
  if (!Number.isFinite(t)) throw new EngineError('The characteristic-function argument t must be finite.', 'finite');
  const a = ANALYTIC[id];
  if (a?.cf) {
    return {
      value: a.cf(t, params),
      route: 'analytic',
      exactness: 'exact',
      formula: a.cfFormula ?? 'φ(t) = E[e^{itX}]',
      notes: ['The characteristic function exists for every distribution and every real t; no region of convergence restricts it.'],
    };
  }
  const grid = numericGrid(def, params);
  let re = 0;
  let im = 0;
  const reTerms: number[] = [];
  const imTerms: number[] = [];
  for (let i = 0; i < grid.x.length; i++) {
    reTerms.push(grid.w[i] * Math.cos(t * grid.x[i]));
    imTerms.push(grid.w[i] * Math.sin(t * grid.x[i]));
  }
  re = stableSum(reTerms);
  im = stableSum(imTerms);
  const route: TransformRoute = def.kind === 'discrete' ? 'numerical-summation' : 'numerical-quadrature';
  return {
    value: complex(re, im),
    route,
    exactness: 'numerical',
    formula: 'φ(t) = ∫ e^{itx} f(x) dx (or Σ e^{itk} p_k), evaluated on a truncated range',
    truncation: grid.truncation,
    notes: [
      `Truncated to [${grid.truncation.lower.toPrecision(6)}, ${grid.truncation.upper.toPrecision(6)}] with ${grid.truncation.terms} evaluation points; total mass reproduced to ${grid.truncation.tailMass.toExponential(2)}.`,
      `The quadrature resolves the oscillation e^{itx} only while |t| is small compared with ${(Math.PI / ((grid.truncation.upper - grid.truncation.lower) / (PANELS * NODES))).toPrecision(4)}; beyond that the reported value is unreliable.`,
    ],
  };
}

/** φ of a sum of independent components: the product of their CFs. */
export function cfOfSum(components: readonly { id: string; params: Params }[], t: number): ComplexTransformValue {
  if (components.length === 0) throw new EngineError('A sum needs at least one component.', 'invalid');
  let acc = complex(1, 0);
  let exact = true;
  const notes: string[] = [];
  for (const c of components) {
    const v = cf(c.id, c.params, t);
    if (v.exactness !== 'exact') exact = false;
    acc = cMul(acc, v.value);
    if (v.notes.length) notes.push(`${c.id}: ${v.notes[0]}`);
  }
  return {
    value: acc,
    route: exact ? 'analytic' : 'numerical-quadrature',
    exactness: exact ? 'exact' : 'numerical',
    formula: 'φ_S(t) = Π_j φ_j(t), valid because the components are independent',
    notes: [
      'The product form assumes the components are independent. With an unknown dependence the CF of the sum is not determined by the marginals at all.',
      ...notes,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Cumulants                                                          *
 * ------------------------------------------------------------------ */

/**
 * dK/dt. Analytic where the table has it; otherwise a Richardson-extrapolated
 * central difference, whose error is reported alongside.
 */
export function cgfDerivative(id: string, params: Params, t: number): { value: number; exactness: Exactness; step?: number } {
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  assertInRegion(def, roc, t);
  const a = ANALYTIC[id];
  if (a?.dcgf) return { value: a.dcgf(t, params), exactness: 'exact' };
  const K = (u: number) => cgf(id, params, u).value;
  const h = stepFor(roc, t);
  return { value: richardsonFirst(K, t, h), exactness: 'numerical', step: h };
}

/** d²K/dt². */
export function cgfSecondDerivative(id: string, params: Params, t: number): { value: number; exactness: Exactness; step?: number } {
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  assertInRegion(def, roc, t);
  const a = ANALYTIC[id];
  if (a?.d2cgf) return { value: a.d2cgf(t, params), exactness: 'exact' };
  const K = (u: number) => cgf(id, params, u).value;
  const h = stepFor(roc, t);
  return { value: richardsonSecond(K, t, h), exactness: 'numerical', step: h };
}

/**
 * A finite-difference step that stays strictly inside the region of
 * convergence: stepping across the boundary would evaluate an infinite MGF and
 * return a meaningless derivative.
 */
function stepFor(roc: RegionOfConvergence, t: number): number {
  const scale = Math.max(1, Math.abs(t));
  let h = 1e-3 * scale;
  const room = Math.min(roc.upper - t, t - roc.lower);
  if (Number.isFinite(room)) h = Math.min(h, room / 8);
  if (!(h > 0)) {
    throw new EngineError(
      `No finite-difference step fits inside the region of convergence at t = ${t}. ${roc.description} No derivative is reported.`,
      'out-of-region',
    );
  }
  return h;
}

/** Central difference with Richardson extrapolation: error O(h⁴). */
function richardsonFirst(f: (x: number) => number, x: number, h: number): number {
  const d = (s: number) => (f(x + s) - f(x - s)) / (2 * s);
  return (4 * d(h / 2) - d(h)) / 3;
}

/** Second central difference with Richardson extrapolation: error O(h⁴). */
function richardsonSecond(f: (x: number) => number, x: number, h: number): number {
  const d = (s: number) => (f(x + s) - 2 * f(x) + f(x - s)) / (s * s);
  return (4 * d(h / 2) - d(h)) / 3;
}

export interface CumulantsResult {
  /** κ₁ … κ_order. κ₁ is the mean and κ₂ the variance. */
  cumulants: number[];
  /** Central moments μ₂ … μ_order implied by the cumulants. */
  centralMoments: number[];
  skewness: number;
  excessKurtosis: number;
  exactness: Exactness;
  route: string;
  notes: string[];
}

/**
 * Cumulants κ_r = K^{(r)}(0), with the standard relations to the central
 * moments: μ₂ = κ₂, μ₃ = κ₃, μ₄ = κ₄ + 3κ₂², and the standardised shape
 * measures γ₁ = κ₃/κ₂^{3/2}, γ₂ = κ₄/κ₂².
 */
export function cumulants(id: string, params: Params, order = 4): CumulantsResult {
  if (!Number.isInteger(order) || order < 1 || order > 6) {
    throw new EngineError('The cumulant order must be a whole number between 1 and 6.', 'range');
  }
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  if (!roc.exists) {
    throw new EngineError(
      `No cumulants of the ${def.name} distribution can be read from its MGF. ${roc.description}`,
      'no-mgf',
    );
  }
  assertInRegion(def, roc, 0);

  const first = cgfDerivative(id, params, 0);
  const second = cgfSecondDerivative(id, params, 0);
  const ks = [first.value, second.value];
  let exactness: Exactness = first.exactness === 'exact' && second.exactness === 'exact' ? 'exact' : 'numerical';

  if (order > 2) {
    const K = (u: number) => cgf(id, params, u).value;
    const h = stepFor(roc, 0);
    for (let r = 3; r <= order; r++) {
      ks.push(centralDerivative(K, 0, h, r));
      exactness = 'numerical';
    }
  }

  const k2 = ks[1];
  const centralMoments: number[] = [k2];
  if (order >= 3) centralMoments.push(ks[2]);
  if (order >= 4) centralMoments.push(ks[3] + 3 * k2 * k2);
  if (order >= 5) centralMoments.push(ks[4] + 10 * ks[2] * k2);
  if (order >= 6) centralMoments.push(ks[5] + 15 * ks[3] * k2 + 10 * ks[2] * ks[2] + 15 * k2 * k2 * k2);

  const skewness = order >= 3 && k2 > 0 ? ks[2] / Math.pow(k2, 1.5) : 0;
  const excessKurtosis = order >= 4 && k2 > 0 ? ks[3] / (k2 * k2) : 0;

  return {
    cumulants: ks,
    centralMoments,
    skewness,
    excessKurtosis,
    exactness,
    route: exactness === 'exact' ? 'analytic CGF derivatives at t = 0' : 'Richardson-extrapolated central differences of the CGF at t = 0',
    notes: [
      roc.description,
      'κ₁ = mean, κ₂ = variance, μ₃ = κ₃, μ₄ = κ₄ + 3κ₂². Cumulants of order 3 and above are obtained by finite differences, so they carry a differentiation error of roughly 1e-8 relative for well-scaled parameters.',
    ],
  };
}

/** r-th derivative by a central difference stencil of order 2 accuracy. */
function centralDerivative(f: (x: number) => number, x: number, h: number, r: number): number {
  // Central stencil: f^{(r)}(x) ≈ h^{−r} Σ_{j} (−1)^j C(r, j) f(x + (r/2 − j)h).
  let acc = 0;
  for (let j = 0; j <= r; j++) {
    const c = binom(r, j) * (j % 2 === 0 ? 1 : -1);
    acc += c * f(x + (r / 2 - j) * h);
  }
  return acc / Math.pow(h, r);
}

function binom(n: number, k: number): number {
  let acc = 1;
  for (let i = 0; i < k; i++) acc = (acc * (n - i)) / (i + 1);
  return Math.round(acc);
}

/** The analytic transform formulas available for a distribution, for display. */
export function transformFormulas(id: string): { mgf: string | null; cf: string | null; pgf: string | null } {
  const a = ANALYTIC[id];
  return { mgf: a?.mgfFormula ?? null, cf: a?.cfFormula ?? null, pgf: a?.pgfFormula ?? null };
}
