/**
 * The bivariate copula families.
 *
 * Each family is a `CopulaDef`: a serialisable description plus the functions
 * that evaluate it. The point of the module is tail dependence — the Gaussian
 * copula used by the scenario engine has none, so extreme values of two
 * correlated variables never coincide more often than the correlation alone
 * implies. Clayton (lower), Gumbel and Joe (upper) and the Student-t (both)
 * do, and the coefficients are reported explicitly.
 */
import { brentRoot, clamp } from '../core/numeric';
import { EngineError, Validator } from '../core/result';
import { normalCdf, normalQuantile } from '../special/gamma';
import { studentT } from '../distributions/continuous';
import type { Random } from '../random/rng';
import {
  bivariateNormalCdf,
  bivariateNormalPdf,
  bivariateTCdf,
  bivariateTPdf,
  frankKendallTauIntegral,
  gaussLegendre,
} from './quadrature';
import type { CopulaDef, CopulaFamilyId, CopulaParamSpec, CopulaParams } from './types';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/** Smallest/largest value a copula draw is allowed to take, so that an
 *  underflow in a frailty variate can never produce an exact 0 or 1. */
const U_MIN = 1e-300;
const U_MAX = 1 - 1e-16;

function clampDraw(u: number): number {
  if (Number.isNaN(u)) {
    throw new EngineError('The copula sampler produced a value that is not a number.', 'numerical');
  }
  return clamp(u, U_MIN, U_MAX);
}

function requireUnit(u: number, v: number): void {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    throw new EngineError(
      `A copula is only defined on the unit square; received (u, v) = (${u}, ${v}).`,
      'range',
    );
  }
}

function validateBySpec(specs: CopulaParamSpec[], p: CopulaParams, familyName: string): void {
  const v = new Validator();
  for (const spec of specs) {
    const label = `${familyName} ${spec.symbol} (${spec.label.toLowerCase()})`;
    const value = p[spec.key];
    if (value === undefined) {
      v.add(`${label} is required.`, spec.key, 'required');
      continue;
    }
    if (!v.finite(value, spec.key, label)) continue;
    if (spec.minExclusive ? value <= spec.min : value < spec.min) {
      v.add(
        `${label} must be ${spec.minExclusive ? 'greater than' : 'at least'} ${spec.min}; received ${value}.`,
        spec.key,
        'range',
      );
    }
    if (spec.maxExclusive ? value >= spec.max : value > spec.max) {
      v.add(
        `${label} must be ${spec.maxExclusive ? 'less than' : 'at most'} ${spec.max}; received ${value}.`,
        spec.key,
        'range',
      );
    }
  }
  v.throwIfInvalid();
}

/** log(exp(z) − 1) for z > 0, accurate at both ends. */
function logExpm1(z: number): number {
  if (!(z > 0)) {
    throw new EngineError('log(exp(z) − 1) is only defined for z > 0.', 'range');
  }
  return z > 0.5 ? z + Math.log1p(-Math.exp(-z)) : Math.log(Math.expm1(z));
}

/** log(1 + exp(z)) without overflow. */
function softplus(z: number): number {
  return z > 30 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

/**
 * Spearman's ρ_S = 12·∫∫C(u, v) du dv − 3 by tensor Gauss–Legendre quadrature.
 * Used for the families with no closed form. Accuracy is ~1e-6 while C is
 * smooth; near the Fréchet bounds (very strong dependence) C develops a ridge
 * and the quadrature error grows, which the families record as a limitation.
 */
function spearmanByQuadrature(cdf: (u: number, v: number) => number, nodes = 32): number {
  const { x, w } = gaussLegendre(nodes);
  let s = 0;
  for (let i = 0; i < nodes; i++) {
    const ui = 0.5 * (1 + x[i]);
    for (let j = 0; j < nodes; j++) {
      s += w[i] * w[j] * cdf(ui, 0.5 * (1 + x[j]));
    }
  }
  return clamp(12 * (s / 4) - 3, -1, 1);
}

/** Solve an increasing conditional distribution H(v) = t for v on (0, 1). */
function invertConditional(h: (v: number) => number, t: number): number {
  const lo = 1e-16;
  const hi = 1 - 1e-16;
  const flo = h(lo) - t;
  if (flo >= 0) return lo;
  const fhi = h(hi) - t;
  if (fhi <= 0) return hi;
  return brentRoot((v) => h(v) - t, lo, hi, { tol: 1e-13 });
}

/** Standard Student-t quantile and density with ν degrees of freedom. */
function tQuantile(q: number, nu: number): number {
  if (q <= 0) return -Infinity;
  if (q >= 1) return Infinity;
  return studentT.quantile(q, { nu, mu: 0, sigma: 1 });
}

function tPdf(x: number, nu: number): number {
  return studentT.pdf(x, { nu, mu: 0, sigma: 1 });
}

function tCdf(x: number, nu: number): number {
  return studentT.cdf(x, { nu, mu: 0, sigma: 1 });
}

/* ------------------------------------------------------------------ *
 * Gaussian
 * ------------------------------------------------------------------ */

const RHO_SPEC: CopulaParamSpec = {
  key: 'rho',
  label: 'Correlation',
  symbol: 'ρ',
  description: 'Correlation of the latent normal variables (not the correlation of the data).',
  defaultValue: 0.5,
  min: -1,
  max: 1,
  sliderMin: -0.99,
  sliderMax: 0.99,
  step: 0.01,
};

export const gaussianCopula: CopulaDef = {
  id: 'gaussian',
  name: 'Gaussian copula',
  description:
    'The dependence structure of a bivariate normal distribution, reduced to ranks. Symmetric and with no tail dependence: extreme values coincide no more often than the correlation implies.',
  family: 'elliptical',
  params: [RHO_SPEC],
  formula: 'C(u, v) = Φ₂(Φ⁻¹(u), Φ⁻¹(v); ρ)',
  notes: [
    'ρ is the correlation of the latent normals. Kendall’s τ = (2/π)·arcsin(ρ) and Spearman’s ρ_S = (6/π)·arcsin(ρ/2) are both exact.',
    'ρ = 1 gives the comonotonic copula M and ρ = −1 the countermonotonic copula W.',
  ],
  limitations: [
    'No tail dependence for any |ρ| < 1. If joint extremes are the question, this family answers "no more than correlation" by construction, not because the data said so.',
    'The distribution function is a 48-point Gauss–Legendre quadrature of the Sheppard identity; accuracy degrades for |ρ| above about 0.999.',
  ],
  samplingMethod:
    'Latent normals from a Cholesky factor, mapped through the normal CDF: Z₁, Z₂ bivariate normal with correlation ρ, then U = Φ(Z₁), V = Φ(Z₂).',
  exactness: {
    cdf: 'numerical',
    density: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'exact',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: -1, max: 1 },
  validate: (p) => validateBySpec([RHO_SPEC], p, 'Gaussian copula'),
  cdf(u, v, p) {
    gaussianCopula.validate(p);
    requireUnit(u, v);
    if (u === 0 || v === 0) return 0;
    if (u === 1) return v;
    if (v === 1) return u;
    return bivariateNormalCdf(normalQuantile(u), normalQuantile(v), p.rho);
  },
  density(u, v, p) {
    gaussianCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    const x = normalQuantile(u);
    const y = normalQuantile(v);
    const marginal = Math.exp(-0.5 * (x * x + y * y)) / (2 * Math.PI);
    return bivariateNormalPdf(x, y, p.rho) / marginal;
  },
  sample(rng, p) {
    gaussianCopula.validate(p);
    const z1 = rng.normal();
    const z2 = p.rho * z1 + Math.sqrt(Math.max(0, 1 - p.rho * p.rho)) * rng.normal();
    return [clampDraw(normalCdf(z1)), clampDraw(normalCdf(z2))];
  },
  kendallTau: (p) => {
    gaussianCopula.validate(p);
    return (2 / Math.PI) * Math.asin(p.rho);
  },
  spearmanRho: (p) => {
    gaussianCopula.validate(p);
    return (6 / Math.PI) * Math.asin(p.rho / 2);
  },
  tailDependence: (p) => {
    gaussianCopula.validate(p);
    // λ = 0 for every |ρ| < 1; the boundary cases are the Fréchet copulas.
    if (p.rho === 1) return { lower: 1, upper: 1 };
    return { lower: 0, upper: 0 };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, -1, 1, 'Gaussian copula');
    return { rho: Math.sin((Math.PI * tau) / 2) };
  },
};

/* ------------------------------------------------------------------ *
 * Student-t
 * ------------------------------------------------------------------ */

const NU_SPEC: CopulaParamSpec = {
  key: 'nu',
  label: 'Degrees of freedom',
  symbol: 'ν',
  description: 'Smaller ν means heavier tails and stronger tail dependence; ν → ∞ gives the Gaussian copula.',
  defaultValue: 4,
  min: 0,
  minExclusive: true,
  max: 1e7,
  sliderMin: 1,
  sliderMax: 50,
  step: 0.5,
};

/** Default degrees of freedom used when only a target τ is supplied. */
export const T_COPULA_DEFAULT_NU = 4;

export const tCopula: CopulaDef = {
  id: 't',
  name: 'Student-t copula',
  description:
    'The dependence structure of a bivariate Student-t distribution. Symmetric like the Gaussian copula but with tail dependence in both tails, controlled by the degrees of freedom.',
  family: 'elliptical',
  params: [NU_SPEC, RHO_SPEC],
  formula: 'C(u, v) = t₂(t_ν⁻¹(u), t_ν⁻¹(v); ρ, ν)',
  notes: [
    'Kendall’s τ = (2/π)·arcsin(ρ) exactly, the same as for the Gaussian copula: τ does not identify ν.',
    'Tail dependence λ_L = λ_U = 2·t_{ν+1}(−√((ν+1)(1−ρ)/(1+ρ))), which is strictly positive even at ρ = 0.',
    'ν must be chosen from tail behaviour or by likelihood; rank correlation alone cannot determine it.',
  ],
  limitations: [
    'Tail dependence is forced to be equal in both tails. Data where only joint losses cluster is better described by Clayton.',
    'The distribution function is a chi-square mixture of bivariate normal quadratures (64 × 48 nodes); it is accurate to roughly 1e-8, not to machine precision.',
    'Spearman’s ρ_S has no closed form here and is obtained by quadrature.',
  ],
  samplingMethod:
    'Multivariate t: correlated normals from a Cholesky factor scaled by √(ν/W) with W ~ χ²_ν, then mapped through the univariate t CDF.',
  exactness: {
    cdf: 'numerical',
    density: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'numerical',
    tailDependence: 'numerical',
  },
  kendallTauRange: { min: -1, max: 1 },
  validate: (p) => validateBySpec([NU_SPEC, RHO_SPEC], p, 'Student-t copula'),
  cdf(u, v, p) {
    tCopula.validate(p);
    requireUnit(u, v);
    if (u === 0 || v === 0) return 0;
    if (u === 1) return v;
    if (v === 1) return u;
    return bivariateTCdf(tQuantile(u, p.nu), tQuantile(v, p.nu), p.rho, p.nu);
  },
  density(u, v, p) {
    tCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    const x = tQuantile(u, p.nu);
    const y = tQuantile(v, p.nu);
    return bivariateTPdf(x, y, p.rho, p.nu) / (tPdf(x, p.nu) * tPdf(y, p.nu));
  },
  sample(rng, p) {
    tCopula.validate(p);
    const z1 = rng.normal();
    const z2 = p.rho * z1 + Math.sqrt(Math.max(0, 1 - p.rho * p.rho)) * rng.normal();
    // W ~ χ²_ν, which is Gamma(ν/2) with scale 2.
    const w = 2 * rng.gamma(p.nu / 2);
    if (!(w > 0)) {
      throw new EngineError('The chi-square draw underflowed to zero; try a larger ν.', 'numerical');
    }
    const scale = Math.sqrt(p.nu / w);
    return [clampDraw(tCdf(z1 * scale, p.nu)), clampDraw(tCdf(z2 * scale, p.nu))];
  },
  kendallTau: (p) => {
    tCopula.validate(p);
    return (2 / Math.PI) * Math.asin(p.rho);
  },
  spearmanRho: (p) => {
    tCopula.validate(p);
    return spearmanByQuadrature((u, v) => tCopula.cdf(u, v, p), 24);
  },
  tailDependence: (p) => {
    tCopula.validate(p);
    if (p.rho <= -1) return { lower: 0, upper: 0 };
    const arg = -Math.sqrt(((p.nu + 1) * (1 - p.rho)) / (1 + p.rho));
    const lambda = clamp(2 * tCdf(arg, p.nu + 1), 0, 1);
    return { lower: lambda, upper: lambda };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, -1, 1, 'Student-t copula');
    return { nu: T_COPULA_DEFAULT_NU, rho: Math.sin((Math.PI * tau) / 2) };
  },
};

/* ------------------------------------------------------------------ *
 * Clayton
 * ------------------------------------------------------------------ */

const CLAYTON_THETA: CopulaParamSpec = {
  key: 'theta',
  label: 'Dependence',
  symbol: 'θ',
  description: 'θ = 0 is independence; larger θ means stronger lower-tail clustering.',
  defaultValue: 2,
  min: 0,
  max: 1e6,
  sliderMin: 0,
  sliderMax: 20,
  step: 0.1,
};

/** Below this the family is evaluated as its independence limit. */
const DEGENERATE = 1e-12;

export const claytonCopula: CopulaDef = {
  id: 'clayton',
  name: 'Clayton copula',
  description:
    'Archimedean copula with lower-tail dependence only: joint small values (joint losses) cluster, joint large values do not.',
  family: 'archimedean',
  params: [CLAYTON_THETA],
  formula: 'C(u, v) = (u^(−θ) + v^(−θ) − 1)^(−1/θ)',
  notes: [
    'Generator φ(t) = (t^(−θ) − 1)/θ, with ψ(s) = (1 + θs)^(−1/θ) the Laplace transform of a Gamma(1/θ) variable.',
    'Kendall’s τ = θ/(θ + 2), inverted exactly as θ = 2τ/(1 − τ).',
    'θ → 0 is the independence copula; θ → ∞ is the comonotonic copula.',
  ],
  limitations: [
    'Only positive association: τ ∈ [0, 1). Negative dependence cannot be represented.',
    'Upper-tail dependence is exactly 0 by construction. Using Clayton asserts that joint gains do not cluster.',
    'Asymmetric in the tails, so it is the wrong family if extremes cluster at both ends.',
  ],
  samplingMethod:
    'Marshall–Olkin frailty: V ~ Gamma(1/θ, 1), E₁, E₂ ~ Exp(1) independent, U_i = (1 + E_i/V)^(−1/θ).',
  exactness: {
    cdf: 'exact',
    density: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'numerical',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: 0, max: 1 },
  validate: (p) => validateBySpec([CLAYTON_THETA], p, 'Clayton copula'),
  cdf(u, v, p) {
    claytonCopula.validate(p);
    requireUnit(u, v);
    if (p.theta < DEGENERATE) return u * v;
    if (u === 0 || v === 0) return 0;
    return Math.exp(-claytonLogS(u, v, p.theta) / p.theta);
  },
  density(u, v, p) {
    claytonCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    if (p.theta < DEGENERATE) return 1;
    const logS = claytonLogS(u, v, p.theta);
    const logC =
      Math.log1p(p.theta) -
      (p.theta + 1) * (Math.log(u) + Math.log(v)) -
      (1 / p.theta + 2) * logS;
    return Math.exp(logC);
  },
  sample(rng, p) {
    claytonCopula.validate(p);
    if (p.theta < DEGENERATE) return [clampDraw(rng.uniformOpen()), clampDraw(rng.uniformOpen())];
    const frailty = rng.gamma(1 / p.theta);
    if (!(frailty > 0)) {
      throw new EngineError(
        'The gamma frailty underflowed to zero; θ is too large for double precision.',
        'numerical',
      );
    }
    const draw = (): number =>
      clampDraw(Math.pow(1 + rng.exponential(1) / frailty, -1 / p.theta));
    return [draw(), draw()];
  },
  kendallTau: (p) => {
    claytonCopula.validate(p);
    return p.theta / (p.theta + 2);
  },
  spearmanRho: (p) => {
    claytonCopula.validate(p);
    if (p.theta < DEGENERATE) return 0;
    return spearmanByQuadrature((u, v) => claytonCopula.cdf(u, v, p));
  },
  tailDependence: (p) => {
    claytonCopula.validate(p);
    return { lower: p.theta < DEGENERATE ? 0 : Math.pow(2, -1 / p.theta), upper: 0 };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, 0, 1, 'Clayton copula', true);
    return { theta: (2 * tau) / (1 - tau) };
  },
};

/** log(u^(−θ) + v^(−θ) − 1), computed without overflow. */
function claytonLogS(u: number, v: number, theta: number): number {
  const a = -theta * Math.log(u);
  const b = -theta * Math.log(v);
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m) - Math.exp(-m));
}

/* ------------------------------------------------------------------ *
 * Gumbel
 * ------------------------------------------------------------------ */

const GUMBEL_THETA: CopulaParamSpec = {
  key: 'theta',
  label: 'Dependence',
  symbol: 'θ',
  description: 'θ = 1 is independence; larger θ means stronger upper-tail clustering.',
  defaultValue: 2,
  min: 1,
  max: 1e6,
  sliderMin: 1,
  sliderMax: 20,
  step: 0.1,
};

export const gumbelCopula: CopulaDef = {
  id: 'gumbel',
  name: 'Gumbel copula',
  description:
    'Archimedean extreme-value copula with upper-tail dependence only: joint large values cluster, joint small values do not.',
  family: 'archimedean',
  params: [GUMBEL_THETA],
  formula: 'C(u, v) = exp(−((−ln u)^θ + (−ln v)^θ)^(1/θ))',
  notes: [
    'Generator φ(t) = (−ln t)^θ, with ψ(s) = exp(−s^(1/θ)) the Laplace transform of a positive stable variable with index 1/θ.',
    'Kendall’s τ = 1 − 1/θ, inverted exactly as θ = 1/(1 − τ).',
    'The only Archimedean copula that is also an extreme-value copula, which is why it is the natural model for joint maxima.',
  ],
  limitations: [
    'Only positive association: τ ∈ [0, 1).',
    'Lower-tail dependence is exactly 0 by construction.',
    'Mirror image of Clayton; using it asserts that joint losses do not cluster.',
  ],
  samplingMethod:
    'Marshall–Olkin frailty with a positive stable variable of index α = 1/θ drawn by the Chambers–Mallows–Stuck/Kanter representation, then U_i = exp(−(E_i/V)^(1/θ)).',
  exactness: {
    cdf: 'exact',
    density: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'numerical',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: 0, max: 1 },
  validate: (p) => validateBySpec([GUMBEL_THETA], p, 'Gumbel copula'),
  cdf(u, v, p) {
    gumbelCopula.validate(p);
    requireUnit(u, v);
    if (u === 0 || v === 0) return 0;
    if (u === 1) return v;
    if (v === 1) return u;
    if (p.theta - 1 < DEGENERATE) return u * v;
    return Math.exp(-gumbelA(u, v, p.theta));
  },
  density(u, v, p) {
    gumbelCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    const theta = p.theta;
    if (theta - 1 < DEGENERATE) return 1;
    const x = -Math.log(u);
    const y = -Math.log(v);
    const w = Math.pow(x, theta) + Math.pow(y, theta);
    const a = Math.pow(w, 1 / theta);
    const logC =
      -a +
      (theta - 1) * (Math.log(x) + Math.log(y)) +
      (1 / theta - 2) * Math.log(w) +
      Math.log(theta - 1 + a) -
      Math.log(u) -
      Math.log(v);
    return Math.exp(logC);
  },
  sample(rng, p) {
    gumbelCopula.validate(p);
    const theta = p.theta;
    if (theta - 1 < DEGENERATE) return [clampDraw(rng.uniformOpen()), clampDraw(rng.uniformOpen())];
    const frailty = positiveStable(rng, 1 / theta);
    if (!(frailty > 0) || !Number.isFinite(frailty)) {
      throw new EngineError('The positive stable frailty overflowed; θ is too extreme.', 'numerical');
    }
    const draw = (): number =>
      clampDraw(Math.exp(-Math.pow(rng.exponential(1) / frailty, 1 / theta)));
    return [draw(), draw()];
  },
  kendallTau: (p) => {
    gumbelCopula.validate(p);
    return 1 - 1 / p.theta;
  },
  spearmanRho: (p) => {
    gumbelCopula.validate(p);
    if (p.theta - 1 < DEGENERATE) return 0;
    return spearmanByQuadrature((u, v) => gumbelCopula.cdf(u, v, p));
  },
  tailDependence: (p) => {
    gumbelCopula.validate(p);
    return { lower: 0, upper: 2 - Math.pow(2, 1 / p.theta) };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, 0, 1, 'Gumbel copula', true);
    return { theta: 1 / (1 - tau) };
  },
};

/** ((−ln u)^θ + (−ln v)^θ)^(1/θ), computed in log space. */
function gumbelA(u: number, v: number, theta: number): number {
  const lx = Math.log(-Math.log(u));
  const ly = Math.log(-Math.log(v));
  const a = theta * lx;
  const b = theta * ly;
  const m = Math.max(a, b);
  return Math.exp((m + Math.log(Math.exp(a - m) + Math.exp(b - m))) / theta);
}

/**
 * A positive stable variate with Laplace transform exp(−t^α), 0 < α < 1, by
 * Kanter's (1975) representation:
 *
 *   S = (A(Θ)/E)^((1−α)/α),  Θ ~ U(0, π), E ~ Exp(1),
 *   A(θ) = [sin(αθ)/sin θ]^(1/(1−α)) · [sin((1−α)θ)/sin(αθ)]
 *
 * Evaluated in log space. The α = 1/2 case reduces to 1/(4cos²(Θ/2)·E), which
 * is the Lévy(0, 1/2) law, and that is what the Gumbel sampling test checks
 * indirectly through the copula's own distribution function.
 */
function positiveStable(rng: Random, alpha: number): number {
  if (!(alpha > 0) || !(alpha < 1)) {
    throw new EngineError('The stable index must lie strictly between 0 and 1.', 'range');
  }
  const theta = Math.PI * rng.uniformOpen();
  const e = rng.exponential(1);
  const logA =
    (alpha / (1 - alpha)) * Math.log(Math.sin(alpha * theta)) +
    Math.log(Math.sin((1 - alpha) * theta)) -
    (1 / (1 - alpha)) * Math.log(Math.sin(theta));
  return Math.exp(((1 - alpha) / alpha) * (logA - Math.log(e)));
}

/* ------------------------------------------------------------------ *
 * Frank
 * ------------------------------------------------------------------ */

const FRANK_THETA: CopulaParamSpec = {
  key: 'theta',
  label: 'Dependence',
  symbol: 'θ',
  description: 'Negative θ gives negative association, positive θ positive association. θ = 0 is excluded.',
  defaultValue: 5,
  min: -700,
  max: 700,
  sliderMin: -30,
  sliderMax: 30,
  step: 0.1,
};

export const frankCopula: CopulaDef = {
  id: 'frank',
  name: 'Frank copula',
  description:
    'Archimedean copula that is symmetric in both arguments and in both tails, permits negative association, and has no tail dependence at all.',
  family: 'archimedean',
  params: [FRANK_THETA],
  formula: 'C(u, v) = −(1/θ)·ln(1 + (e^(−θu) − 1)(e^(−θv) − 1)/(e^(−θ) − 1))',
  notes: [
    'Generator φ(t) = −ln((e^(−θt) − 1)/(e^(−θ) − 1)).',
    'The only Archimedean copula that is radially symmetric: C(u, v) = u + v − 1 + C(1 − u, 1 − v).',
    'Kendall’s τ = 1 − (4/θ)(1 − D₁(θ)) with D₁ the first Debye function; it is inverted numerically.',
    'θ = 0 is the independence limit but not an admissible parameter, since the formula divides by θ.',
  ],
  limitations: [
    'No tail dependence in either tail, like the Gaussian copula. It describes association in the middle of the distribution, not joint extremes.',
    'τ and the inversion of τ are obtained by quadrature and root finding, not in closed form.',
    '|θ| is capped at 700 because e^|θ| overflows beyond that; this still covers |τ| up to about 0.994.',
  ],
  samplingMethod:
    'Conditional inversion in closed form: draw U and T uniform, then V = −(1/θ)·ln(1 + T(e^(−θ) − 1)/(T + (1 − T)e^(−θU))).',
  exactness: {
    cdf: 'exact',
    density: 'exact',
    kendallTau: 'numerical',
    spearmanRho: 'numerical',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: -1, max: 1 },
  validate(p) {
    validateBySpec([FRANK_THETA], p, 'Frank copula');
    if (p.theta === 0) {
      throw new EngineError(
        'Frank copula θ cannot be 0: the formula divides by θ. θ → 0 is the independence copula, which is available as its own family.',
        'range',
      );
    }
  },
  cdf(u, v, p) {
    frankCopula.validate(p);
    requireUnit(u, v);
    if (u === 0 || v === 0) return 0;
    if (u === 1) return v;
    if (v === 1) return u;
    const theta = p.theta;
    if (theta > FRANK_DIRECT_MAX) {
      // Large θ: expm1(−θu) saturates at exactly −1 and the numerator cancels
      // to 0, so the equivalent form −(1/θ)·ln((p + q − pq − x)/(1 − x)) with
      // p = e^(−θu), q = e^(−θv), x = e^(−θ) is used in log space instead.
      const { logNegNum, logOneMinusX } = frankLogParts(u, v, theta);
      return clamp((logOneMinusX - logNegNum) / theta, 0, 1);
    }
    if (theta > 0) {
      // All of e^(−θx) − 1 lie in (−1, 0], so the direct form is stable.
      const g = Math.expm1(-theta);
      const num = g + Math.expm1(-theta * u) * Math.expm1(-theta * v);
      return clamp(-Math.log(num / g) / theta, 0, 1);
    }
    // θ < 0: e^(−θx) − 1 can overflow, so work with logs.
    const a = -theta;
    const lr = logExpm1(a * u) + logExpm1(a * v) - logExpm1(a);
    return clamp(softplus(lr) / a, 0, 1);
  },
  density(u, v, p) {
    frankCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    const theta = p.theta;
    if (theta > FRANK_DIRECT_MAX) {
      const { logNegNum, logOneMinusX } = frankLogParts(u, v, theta);
      return Math.exp(Math.log(theta) + logOneMinusX - theta * (u + v) - 2 * logNegNum);
    }
    if (theta > 0) {
      const g = Math.expm1(-theta);
      const num = g + Math.expm1(-theta * u) * Math.expm1(-theta * v);
      return (-theta * g * Math.exp(-theta * (u + v))) / (num * num);
    }
    const a = -theta;
    const lr = logExpm1(a * u) + logExpm1(a * v) - logExpm1(a);
    const logC = Math.log(a) - logExpm1(a) + a * (u + v) - 2 * softplus(lr);
    return Math.exp(logC);
  },
  sample(rng, p) {
    frankCopula.validate(p);
    const theta = p.theta;
    const u = rng.uniformOpen();
    const t = rng.uniformOpen();
    const g = Math.expm1(-theta);
    const eu = Math.exp(-theta * u);
    const denom = t + (1 - t) * eu;
    if (!Number.isFinite(denom) || denom === 0) {
      throw new EngineError('Frank conditional inversion lost precision; |θ| is too extreme.', 'numerical');
    }
    const v = -Math.log1p((t * g) / denom) / theta;
    return [clampDraw(u), clampDraw(v)];
  },
  kendallTau(p) {
    frankCopula.validate(p);
    return frankKendallTauIntegral(p.theta);
  },
  spearmanRho(p) {
    frankCopula.validate(p);
    return spearmanByQuadrature((u, v) => frankCopula.cdf(u, v, p));
  },
  tailDependence(p) {
    frankCopula.validate(p);
    return { lower: 0, upper: 0 };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, -1, 1, 'Frank copula');
    if (Math.abs(tau) < 1e-7) {
      throw new EngineError(
        'The Frank copula cannot represent τ = 0: that is the θ → 0 limit, which is the independence copula. Use the independence family instead.',
        'range',
      );
    }
    const lo = tau > 0 ? 1e-6 : -700;
    const hi = tau > 0 ? 700 : -1e-6;
    const f = (theta: number): number => frankCopula.kendallTau({ theta }) - tau;
    if (f(lo) * f(hi) > 0) {
      throw new EngineError(
        `The Frank copula cannot reach Kendall's τ = ${tau} within |θ| ≤ 700.`,
        'range',
      );
    }
    return { theta: brentRoot(f, lo, hi, { tol: 1e-12 }) };
  },
};


/** Above this θ the Frank copula is evaluated in log space (see cdf). */
const FRANK_DIRECT_MAX = 20;

/**
 * log(p + q − pq − x) and log(1 − x) for the Frank copula with θ > 0, where
 * p = e^(−θu), q = e^(−θv) and x = e^(−θ). The first quantity is −(g + a(u)a(v))
 * written so that no term is formed by subtracting two numbers close to 1.
 */
function frankLogParts(
  u: number,
  v: number,
  theta: number,
): { logNegNum: number; logOneMinusX: number } {
  const lp = -theta * u;
  const lq = -theta * v;
  const lx = -theta;
  const m = Math.max(lp, lq);
  const bracket =
    Math.exp(lp - m) + Math.exp(lq - m) - Math.exp(lp + lq - m) - Math.exp(lx - m);
  if (!(bracket > 0)) {
    throw new EngineError(
      'The Frank copula lost all precision at this θ; reduce |θ| (the copula is already indistinguishable from its Fréchet bound).',
      'numerical',
    );
  }
  return { logNegNum: m + Math.log(bracket), logOneMinusX: Math.log1p(-Math.exp(lx)) };
}

/* ------------------------------------------------------------------ *
 * Joe
 * ------------------------------------------------------------------ */

const JOE_THETA: CopulaParamSpec = {
  key: 'theta',
  label: 'Dependence',
  symbol: 'θ',
  description: 'θ = 1 is independence; larger θ means stronger upper-tail clustering.',
  defaultValue: 2,
  min: 1,
  max: 1e5,
  sliderMin: 1,
  sliderMax: 20,
  step: 0.1,
};

export const joeCopula: CopulaDef = {
  id: 'joe',
  name: 'Joe copula',
  description:
    'Archimedean copula with upper-tail dependence only. It shares Gumbel’s tail coefficient but concentrates dependence closer to the upper corner.',
  family: 'archimedean',
  params: [JOE_THETA],
  formula: 'C(u, v) = 1 − ((1 − u)^θ + (1 − v)^θ − (1 − u)^θ(1 − v)^θ)^(1/θ)',
  notes: [
    'Generator φ(t) = −ln(1 − (1 − t)^θ).',
    'Upper-tail dependence 2 − 2^(1/θ), the same expression as Gumbel, but the two families differ away from the corner.',
    'Kendall’s τ = 1 − 4·Σ_{k≥1} 1/(k(θk + 2)(θ(k − 1) + 2)); there is no closed form, so τ is summed numerically with an analytic tail correction.',
  ],
  limitations: [
    'Only positive association: τ ∈ [0, 1).',
    'Lower-tail dependence is exactly 0 by construction.',
    'τ and its inverse are numerical; the series is truncated at 50 000 terms plus a tail estimate, giving about 1e-12 accuracy.',
  ],
  samplingMethod:
    'Conditional inversion: draw U and T uniform, then solve ∂C/∂u(U, V) = T for V with Brent root finding (the conditional distribution is increasing from 0 to 1 in V).',
  exactness: {
    cdf: 'exact',
    density: 'exact',
    kendallTau: 'numerical',
    spearmanRho: 'numerical',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: 0, max: 1 },
  validate: (p) => validateBySpec([JOE_THETA], p, 'Joe copula'),
  cdf(u, v, p) {
    joeCopula.validate(p);
    requireUnit(u, v);
    if (u === 0 || v === 0) return 0;
    if (u === 1) return v;
    if (v === 1) return u;
    if (p.theta - 1 < DEGENERATE) return u * v;
    // −expm1(logS/θ) is 1 − S^(1/θ) without cancellation, and the log form of S
    // keeps (1 − u)^θ from underflowing to 0 for large θ.
    return clamp(-Math.expm1(joeLogS(u, v, p.theta) / p.theta), 0, 1);
  },
  density(u, v, p) {
    joeCopula.validate(p);
    requireUnit(u, v);
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) {
      throw new EngineError('The copula density is only defined on the open unit square.', 'range');
    }
    const theta = p.theta;
    if (theta - 1 < DEGENERATE) return 1;
    const logS = joeLogS(u, v, theta);
    const logC =
      (theta - 1) * (Math.log1p(-u) + Math.log1p(-v)) +
      (1 / theta - 2) * logS +
      Math.log(theta - 1 + Math.exp(logS));
    return Math.exp(logC);
  },
  sample(rng, p) {
    joeCopula.validate(p);
    if (p.theta - 1 < DEGENERATE) return [clampDraw(rng.uniformOpen()), clampDraw(rng.uniformOpen())];
    const u = rng.uniformOpen();
    const t = rng.uniformOpen();
    const v = invertConditional((vv) => joeConditional(u, vv, p.theta), t);
    return [clampDraw(u), clampDraw(v)];
  },
  kendallTau(p) {
    joeCopula.validate(p);
    return joeKendallTau(p.theta);
  },
  spearmanRho(p) {
    joeCopula.validate(p);
    if (p.theta - 1 < DEGENERATE) return 0;
    return spearmanByQuadrature((u, v) => joeCopula.cdf(u, v, p));
  },
  tailDependence(p) {
    joeCopula.validate(p);
    return { lower: 0, upper: 2 - Math.pow(2, 1 / p.theta) };
  },
  fromKendallTau(tau) {
    requireTauIn(tau, 0, 1, 'Joe copula', true);
    if (tau === 0) return { theta: 1 };
    const f = (theta: number): number => joeKendallTau(theta) - tau;
    const hi = 1e5;
    if (f(hi) < 0) {
      throw new EngineError(`The Joe copula cannot reach Kendall's τ = ${tau} within θ ≤ ${hi}.`, 'range');
    }
    return { theta: brentRoot(f, 1, hi, { tol: 1e-12 }) };
  },
};

/**
 * log S with S = a^θ + b^θ − a^θ·b^θ, a = 1 − u, b = 1 − v. Evaluated in log
 * space because a^θ underflows to 0 for large θ, which would otherwise turn
 * C into 1 instead of min(u, v).
 */
function joeLogS(u: number, v: number, theta: number): number {
  const la = theta * Math.log1p(-u);
  const lb = theta * Math.log1p(-v);
  const m = Math.max(la, lb);
  if (m === -Infinity) return -Infinity;
  const bracket = Math.exp(la - m) + Math.exp(lb - m) - Math.exp(la + lb - m);
  return m + Math.log(bracket);
}

/** ∂C/∂u for the Joe copula: the conditional CDF of V given U = u. */
function joeConditional(u: number, v: number, theta: number): number {
  const la = theta * Math.log1p(-u);
  const lb = theta * Math.log1p(-v);
  const logH =
    ((theta - 1) / theta) * la +
    Math.log(-Math.expm1(lb)) +
    (1 / theta - 1) * joeLogS(u, v, theta);
  return Math.exp(logH);
}

/**
 * Kendall's τ for the Joe copula by its series (Joe 1997):
 *   τ = 1 − 4·Σ_{k≥1} 1/(k(θk + 2)(θ(k − 1) + 2)).
 * The terms behave like 1/(θ²k³), so the sum is truncated and the remainder
 * added analytically.
 */
function joeKendallTau(theta: number): number {
  if (theta - 1 < DEGENERATE) return 0;
  const K = 50000;
  let s = 0;
  for (let k = 1; k <= K; k++) {
    s += 1 / (k * (theta * k + 2) * (theta * (k - 1) + 2));
  }
  // Σ_{k>K} 1/(θ²k³)(1 + (θ − 4)/(θk)) ≈ 1/(2θ²K²) + (θ − 4)/(3θ³K³).
  s += 1 / (2 * theta * theta * K * K) + (theta - 4) / (3 * theta ** 3 * K ** 3);
  return clamp(1 - 4 * s, 0, 1);
}

/* ------------------------------------------------------------------ *
 * Reference copulas: independence and the two Fréchet bounds
 * ------------------------------------------------------------------ */

function requireTauIn(tau: number, min: number, max: number, family: string, maxExclusive = false): void {
  if (!Number.isFinite(tau)) {
    throw new EngineError(`Kendall's τ must be a finite number; received ${tau}.`, 'finite');
  }
  const tooHigh = maxExclusive ? tau >= max : tau > max;
  if (tau < min || tooHigh) {
    throw new EngineError(
      `The ${family} can only represent Kendall's τ in [${min}, ${max}${maxExclusive ? ')' : ']'}; received ${tau}.`,
      'range',
    );
  }
}

export const independenceCopula: CopulaDef = {
  id: 'independence',
  name: 'Independence copula',
  description: 'The product copula Π(u, v) = u·v: the two variables are independent at every level.',
  family: 'reference',
  params: [],
  formula: 'C(u, v) = u·v',
  notes: [
    'Reference case. It is the limit of Clayton as θ → 0, of Gumbel and Joe as θ → 1, and of Frank as θ → 0.',
  ],
  limitations: [
    'Independence is an assumption, not a measurement. It is included as a reference point and as the null model for comparison, never as a default for unknown relationships.',
  ],
  samplingMethod: 'Two independent uniform draws.',
  exactness: {
    cdf: 'exact',
    density: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'exact',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: 0, max: 0 },
  validate: () => undefined,
  cdf(u, v) {
    requireUnit(u, v);
    return u * v;
  },
  density(u, v) {
    requireUnit(u, v);
    return 1;
  },
  sample: (rng) => [clampDraw(rng.uniformOpen()), clampDraw(rng.uniformOpen())],
  kendallTau: () => 0,
  spearmanRho: () => 0,
  tailDependence: () => ({ lower: 0, upper: 0 }),
  fromKendallTau(tau) {
    requireTauIn(tau, 0, 0, 'independence copula');
    return {};
  },
};

export const comonotonicCopula: CopulaDef = {
  id: 'comonotonic',
  name: 'Comonotonic copula (Fréchet upper bound M)',
  description:
    'Perfect positive rank dependence: V is an increasing function of U. No copula can exceed it anywhere.',
  family: 'reference',
  params: [],
  formula: 'M(u, v) = min(u, v)',
  notes: [
    'The Fréchet–Hoeffding upper bound: every copula satisfies C ≤ M.',
    'Both tail dependence coefficients equal 1.',
  ],
  limitations: [
    'Singular: the whole probability mass sits on the diagonal u = v, so there is no density. It is a bound, not a model to fit.',
  ],
  samplingMethod: 'One uniform draw used for both coordinates.',
  exactness: {
    cdf: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'exact',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: 1, max: 1 },
  validate: () => undefined,
  cdf(u, v) {
    requireUnit(u, v);
    return Math.min(u, v);
  },
  sample(rng) {
    const u = clampDraw(rng.uniformOpen());
    return [u, u];
  },
  kendallTau: () => 1,
  spearmanRho: () => 1,
  tailDependence: () => ({ lower: 1, upper: 1 }),
  fromKendallTau(tau) {
    requireTauIn(tau, 1, 1, 'comonotonic copula');
    return {};
  },
};

export const countermonotonicCopula: CopulaDef = {
  id: 'countermonotonic',
  name: 'Countermonotonic copula (Fréchet lower bound W)',
  description:
    'Perfect negative rank dependence: V is a decreasing function of U. No bivariate copula can fall below it anywhere.',
  family: 'reference',
  params: [],
  formula: 'W(u, v) = max(u + v − 1, 0)',
  notes: [
    'The Fréchet–Hoeffding lower bound: every bivariate copula satisfies C ≥ W.',
    'W is a copula in two dimensions only; in three or more it is no longer one.',
  ],
  limitations: [
    'Singular: the mass sits on the anti-diagonal u + v = 1, so there is no density.',
    'Both same-tail dependence coefficients are 0: joint extremes in the same direction never coincide, because an extreme U forces an extreme V in the opposite direction.',
  ],
  samplingMethod: 'One uniform draw u, returned as (u, 1 − u).',
  exactness: {
    cdf: 'exact',
    kendallTau: 'exact',
    spearmanRho: 'exact',
    tailDependence: 'exact',
  },
  kendallTauRange: { min: -1, max: -1 },
  validate: () => undefined,
  cdf(u, v) {
    requireUnit(u, v);
    return Math.max(u + v - 1, 0);
  },
  sample(rng) {
    const u = clampDraw(rng.uniformOpen());
    return [u, clampDraw(1 - u)];
  },
  kendallTau: () => -1,
  spearmanRho: () => -1,
  tailDependence: () => ({ lower: 0, upper: 0 }),
  fromKendallTau(tau) {
    requireTauIn(tau, -1, -1, 'countermonotonic copula');
    return {};
  },
};

/** Every implemented family, in presentation order. */
export const COPULAS: CopulaDef[] = [
  gaussianCopula,
  tCopula,
  claytonCopula,
  gumbelCopula,
  frankCopula,
  joeCopula,
  independenceCopula,
  comonotonicCopula,
  countermonotonicCopula,
];

/** Families that can be fitted to data (they have a density and a parameter). */
export const FITTABLE_COPULAS: CopulaDef[] = [
  gaussianCopula,
  tCopula,
  claytonCopula,
  gumbelCopula,
  frankCopula,
  joeCopula,
];

export function getCopula(id: CopulaFamilyId | string): CopulaDef {
  const found = COPULAS.find((c) => c.id === id);
  if (!found) {
    throw new EngineError(
      `Unknown copula family "${id}". Implemented families: ${COPULAS.map((c) => c.id).join(', ')}.`,
      'unknown',
    );
  }
  return found;
}
