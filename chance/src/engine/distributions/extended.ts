/**
 * Extended library of probability distributions.
 *
 * Every definition here implements the full `DistributionDef` contract. Three
 * conventions are observed throughout:
 *
 *  - The survival function is computed *directly* wherever a direct form
 *    exists, never as 1 − F(x). In the far tail 1 − F(x) underflows to exactly
 *    0 and every digit of the answer is lost.
 *  - Moments that do not exist for some parameter values return
 *    `undefinedMoment` with the reason. No substitute number is produced.
 *  - Where no closed form exists, the value is obtained by a documented
 *    numerical method (series, finite sum, quadrature, root finding) and
 *    `closedFormQuantile` is set to false for the quantile.
 */
import { logSumExp, logAddExp } from '../core/numeric';
import { EngineError, type Issue } from '../core/result';
import {
  erf,
  erfc,
  gammaFn,
  incompleteBeta,
  incompleteGamma,
  logBeta,
  logChoose,
  logFactorial,
  logGamma,
  normalCdf,
  normalPdf,
  normalQuantile,
  normalSf,
} from '../special/gamma';
import type { Random } from '../random/rng';
import { assertQuantileLevel, invertContinuous, invertDiscrete } from './inversion';
import { defined, undefinedMoment, type DistributionDef, type Params } from './types';

const LOG_SQRT_2PI = 0.9189385332046727;
const SQRT_2 = Math.SQRT2;
/** Euler–Mascheroni constant γ. */
const EULER_GAMMA = 0.5772156649015329;
/** Gumbel skewness: 12√6·ζ(3)/π³. */
const GUMBEL_SKEWNESS = 1.1395470994046486;

const isInt = (x: number) => Number.isInteger(x);

/* ------------------------------------------------------------------ *
 * Small numerical helpers
 * ------------------------------------------------------------------ */

/**
 * log Φ(−z) = log of the standard normal survival function. For z above 30 the
 * survival function itself is accurate but its logarithm is wanted without the
 * intermediate underflow, so the standard asymptotic expansion is used.
 */
function logNormalSf(z: number): number {
  if (z < 30) {
    const s = normalSf(z);
    return s > 0 ? Math.log(s) : -Infinity;
  }
  const z2 = z * z;
  const series = 1 - 1 / z2 + 3 / (z2 * z2) - 15 / (z2 * z2 * z2);
  return -0.5 * z2 - LOG_SQRT_2PI - Math.log(z) + Math.log(series);
}

/**
 * log Iν(x) — modified Bessel function of the first kind — from its power
 * series, summed in log space so that no term overflows:
 *   Iν(x) = Σ_{m≥0} (x/2)^{2m+ν} / (m! Γ(m+ν+1)).
 * The terms peak near m ≈ x/2; summation stops once the terms are 45 natural
 * logs below the running total *and* the peak has been passed.
 */
export function logBesselI(nu: number, x: number): number {
  if (!(x >= 0) || !Number.isFinite(x) || !(nu >= 0) || !Number.isFinite(nu)) {
    throw new EngineError(`Modified Bessel I is evaluated here only for finite ν ≥ 0 and x ≥ 0; received ν=${nu}, x=${x}.`, 'domain');
  }
  if (x === 0) return nu === 0 ? 0 : -Infinity;
  const logHalfX = Math.log(x / 2);
  let total = -Infinity;
  const maxIter = 200000;
  for (let m = 0; m < maxIter; m++) {
    const term = (2 * m + nu) * logHalfX - logFactorial(m) - logGamma(m + nu + 1);
    total = logAddExp(total, term);
    if (m > x / 2 + nu && term < total - 45) return total;
  }
  throw new EngineError(`The series for I_${nu}(${x}) did not converge within ${maxIter} terms.`, 'numerical');
}

interface CentralMoments {
  variance: number;
  skewness: number;
  excessKurtosis: number;
}

/** Central moments from the first four raw moments. */
function centralFromRaw(m1: number, m2: number, m3: number, m4: number): CentralMoments {
  const variance = m2 - m1 * m1;
  const mu3 = m3 - 3 * m1 * m2 + 2 * m1 * m1 * m1;
  const mu4 = m4 - 4 * m1 * m3 + 6 * m1 * m1 * m2 - 3 * m1 * m1 * m1 * m1;
  return {
    variance,
    skewness: mu3 / Math.pow(variance, 1.5),
    excessKurtosis: mu4 / (variance * variance) - 3,
  };
}

/** A tiny bounded cache for per-parameter lookup tables. */
class TableCache<T> {
  private readonly map = new Map<string, T>();
  constructor(private readonly limit = 32) {}
  get(key: string, build: () => T): T {
    const hit = this.map.get(key);
    if (hit !== undefined) {
      // Refresh recency.
      this.map.delete(key);
      this.map.set(key, hit);
      return hit;
    }
    const value = build();
    this.map.set(key, value);
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
    return value;
  }
}

/**
 * Generalised inverse CDF for a discrete distribution whose support is
 * unbounded below. A finite bracket is found by expanding geometrically from
 * the centre, then the shared integer bisection is used.
 */
function invertDiscreteUnbounded(
  q: number,
  cdf: (k: number) => number,
  sf: (k: number) => number,
  centre: number,
  scale: number,
): number {
  if (q < 0 || q > 1 || Number.isNaN(q)) throw new EngineError('Quantile level must be between 0 and 1.', 'range');
  if (q === 0) return -Infinity;
  if (q === 1) return Infinity;
  const step = Math.max(1, Math.abs(scale));
  let lo = Math.floor(centre) - step;
  let hi = Math.ceil(centre) + step;
  for (let i = 0; i < 200 && cdf(lo) >= q; i++) lo -= step * Math.pow(2, i + 1);
  for (let i = 0; i < 200 && sf(hi) > 1 - q; i++) hi += step * Math.pow(2, i + 1);
  if (cdf(lo) >= q || sf(hi) > 1 - q) {
    throw new EngineError('Quantile search could not bracket the requested level.', 'numerical');
  }
  return invertDiscrete(q, cdf, sf, { min: lo, max: hi }, Math.round(centre));
}

/* ------------------------------------------------------------------ *
 * Laplace
 * ------------------------------------------------------------------ */

export const laplace: DistributionDef = {
  id: 'laplace',
  name: 'Laplace (double exponential)',
  kind: 'continuous',
  description: 'Two exponential tails placed back to back around μ; sharply peaked with heavier tails than the normal.',
  useCases: ['Differences of two waiting times', 'Robust location models and L1 regression errors', 'Additive noise for differential privacy'],
  formula: 'f(x) = (1 / (2b)) · exp(−|x − μ| / b)',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'mu', label: 'Location', symbol: 'μ', description: 'Centre of the distribution (also the median and mode)', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'b', label: 'Scale', symbol: 'b', description: 'Scale parameter; the variance is 2b²', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['Both tails are computed from the exponential form directly, so tail probabilities stay accurate far from μ.'],
  closedFormQuantile: true,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (x, { mu, b }) => -Math.log(2 * b) - Math.abs(x - mu) / b,
  pdf: (x, prm) => Math.exp(laplace.logPdf(x, prm)),
  cdf: (x, { mu, b }) => (x < mu ? 0.5 * Math.exp((x - mu) / b) : 1 - 0.5 * Math.exp(-(x - mu) / b)),
  sf: (x, { mu, b }) => (x < mu ? 1 - 0.5 * Math.exp((x - mu) / b) : 0.5 * Math.exp(-(x - mu) / b)),
  quantile: (q, { mu, b }) => {
    assertQuantileLevel(q);
    if (q === 0) return -Infinity;
    if (q === 1) return Infinity;
    return q < 0.5 ? mu + b * Math.log(2 * q) : mu - b * Math.log(2 * (1 - q));
  },
  mean: ({ mu }) => defined(mu),
  variance: ({ b }) => defined(2 * b * b),
  skewness: () => defined(0),
  excessKurtosis: () => defined(3),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { mu, b }) => mu + b * (rng.exponential(1) - rng.exponential(1)),
};

/* ------------------------------------------------------------------ *
 * Logistic
 * ------------------------------------------------------------------ */

export const logistic: DistributionDef = {
  id: 'logistic',
  name: 'Logistic',
  kind: 'continuous',
  description: 'Symmetric S-shaped distribution resembling the normal but with heavier tails; the CDF is the logistic function.',
  useCases: ['Logistic regression latent errors', 'Growth and adoption curves', 'Rating and choice models (Bradley–Terry, Rasch)'],
  formula: 'f(x) = e^{−z} / (s (1 + e^{−z})²),  z = (x − μ)/s',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'mu', label: 'Location', symbol: 'μ', description: 'Centre (mean, median and mode)', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 's', label: 'Scale', symbol: 's', description: 'Scale parameter; the variance is s²π²/3', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['The standard deviation is s·π/√3 ≈ 1.8138·s, not s.', 'CDF and quantile are both exact closed forms.'],
  closedFormQuantile: true,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (x, { mu, s }) => {
    const z = Math.abs((x - mu) / s);
    return -z - Math.log(s) - 2 * Math.log1p(Math.exp(-z));
  },
  pdf: (x, prm) => Math.exp(logistic.logPdf(x, prm)),
  cdf: (x, { mu, s }) => {
    const z = (x - mu) / s;
    return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  },
  sf: (x, prm) => logistic.cdf(2 * prm.mu - x, prm),
  quantile: (q, { mu, s }) => {
    assertQuantileLevel(q);
    if (q === 0) return -Infinity;
    if (q === 1) return Infinity;
    return mu + s * (Math.log(q) - Math.log1p(-q));
  },
  mean: ({ mu }) => defined(mu),
  variance: ({ s }) => defined((s * s * Math.PI * Math.PI) / 3),
  skewness: () => defined(0),
  excessKurtosis: () => defined(6 / 5),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { mu, s }) => {
    const u = rng.uniformOpen();
    return mu + s * (Math.log(u) - Math.log1p(-u));
  },
};

/* ------------------------------------------------------------------ *
 * Rayleigh
 * ------------------------------------------------------------------ */

export const rayleigh: DistributionDef = {
  id: 'rayleigh',
  name: 'Rayleigh',
  kind: 'continuous',
  description: 'Length of a two-dimensional vector whose components are independent zero-mean normals with the same scale σ.',
  useCases: ['Wind speed magnitude', 'Radio signal envelope with fading', 'Miss distance in two dimensions'],
  formula: 'f(x) = (x / σ²) · exp(−x² / (2σ²))  for x ≥ 0',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'sigma', label: 'Scale', symbol: 'σ', description: 'Scale of each underlying normal component', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['σ is the scale of the underlying components, not the standard deviation of X: the mean is σ√(π/2) and the variance is (2 − π/2)σ².', 'Equal to a Weibull distribution with shape 2 and scale σ√2.'],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { sigma }) => {
    if (x < 0) return -Infinity;
    if (x === 0) return -Infinity;
    return Math.log(x) - 2 * Math.log(sigma) - (x * x) / (2 * sigma * sigma);
  },
  pdf: (x, prm) => (x < 0 ? 0 : x === 0 ? 0 : Math.exp(rayleigh.logPdf(x, prm))),
  cdf: (x, { sigma }) => (x <= 0 ? 0 : -Math.expm1(-(x * x) / (2 * sigma * sigma))),
  sf: (x, { sigma }) => (x <= 0 ? 1 : Math.exp(-(x * x) / (2 * sigma * sigma))),
  quantile: (q, { sigma }) => {
    assertQuantileLevel(q);
    if (q >= 1) return Infinity;
    return sigma * Math.sqrt(-2 * Math.log1p(-q));
  },
  mean: ({ sigma }) => defined(sigma * Math.sqrt(Math.PI / 2)),
  variance: ({ sigma }) => defined((2 - Math.PI / 2) * sigma * sigma),
  skewness: () => defined((2 * Math.sqrt(Math.PI) * (Math.PI - 3)) / Math.pow(4 - Math.PI, 1.5)),
  excessKurtosis: () => defined(-(6 * Math.PI * Math.PI - 24 * Math.PI + 16) / ((4 - Math.PI) * (4 - Math.PI))),
  mode: ({ sigma }) => defined(sigma),
  sample: (rng, { sigma }) => sigma * Math.sqrt(-2 * Math.log(rng.uniformOpen())),
};

/* ------------------------------------------------------------------ *
 * Gumbel (extreme value type I, maximum)
 * ------------------------------------------------------------------ */

export const gumbel: DistributionDef = {
  id: 'gumbel',
  name: 'Gumbel (extreme value type I)',
  kind: 'continuous',
  description: 'Limiting distribution of the maximum of many independent light-tailed variables.',
  useCases: ['Annual maximum rainfall or river level', 'Peak load and record values', 'Discrete choice models (Gumbel errors give the logit)'],
  formula: 'f(x) = (1/β) · exp(−(z + e^{−z})),  z = (x − μ)/β',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'mu', label: 'Location', symbol: 'μ', description: 'Location of the mode', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'beta', label: 'Scale', symbol: 'β', description: 'Scale parameter', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['This is the maximum (right-skewed) form. The mean is μ + βγ with γ the Euler–Mascheroni constant ≈ 0.5772156649.', 'The upper tail is computed as −expm1(−e^{−z}), which keeps full precision where 1 − F would round to 0.'],
  closedFormQuantile: true,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (x, { mu, beta }) => {
    const z = (x - mu) / beta;
    return -Math.log(beta) - z - Math.exp(-z);
  },
  pdf: (x, prm) => Math.exp(gumbel.logPdf(x, prm)),
  cdf: (x, { mu, beta }) => Math.exp(-Math.exp(-(x - mu) / beta)),
  sf: (x, { mu, beta }) => -Math.expm1(-Math.exp(-(x - mu) / beta)),
  quantile: (q, { mu, beta }) => {
    assertQuantileLevel(q);
    if (q === 0) return -Infinity;
    if (q === 1) return Infinity;
    return mu - beta * Math.log(-Math.log(q));
  },
  mean: ({ mu, beta }) => defined(mu + beta * EULER_GAMMA),
  variance: ({ beta }) => defined((Math.PI * Math.PI * beta * beta) / 6),
  skewness: () => defined(GUMBEL_SKEWNESS),
  excessKurtosis: () => defined(12 / 5),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { mu, beta }) => mu - beta * Math.log(-Math.log(rng.uniformOpen())),
};

/* ------------------------------------------------------------------ *
 * Fréchet (extreme value type II)
 * ------------------------------------------------------------------ */

const frechetRawMoment = (n: number, { alpha, s }: Params): number =>
  Math.pow(s, n) * gammaFn(1 - n / alpha);

export const frechet: DistributionDef = {
  id: 'frechet',
  name: 'Fréchet (extreme value type II)',
  kind: 'continuous',
  description: 'Limiting distribution of the maximum of heavy-tailed variables; a power-law upper tail with index α.',
  useCases: ['Maximum insurance claim or flood level', 'Extreme wind gusts', 'Maxima of heavy-tailed financial losses'],
  formula: 'f(x) = (α/s) · ((x − m)/s)^{−1−α} · exp(−((x − m)/s)^{−α})  for x > m',
  supportText: 'x ∈ (m, ∞)',
  params: [
    { key: 'alpha', label: 'Shape', symbol: 'α', description: 'Tail index; moments of order ≥ α do not exist', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.5, sliderMax: 20, step: 0.1 },
    { key: 's', label: 'Scale', symbol: 's', description: 'Scale parameter', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
    { key: 'm', label: 'Location', symbol: 'm', description: 'Lower limit of the support', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
  ],
  notes: ['The mean exists only for α > 1, the variance only for α > 2, the skewness only for α > 3 and the kurtosis only for α > 4.', 'Moments are reported from Γ(1 − n/α); outside those ranges they are reported as undefined rather than computed.'],
  closedFormQuantile: true,
  support: ({ m }) => ({ min: m, max: Infinity }),
  logPdf: (x, { alpha, s, m }) => {
    if (x <= m) return -Infinity;
    const z = (x - m) / s;
    return Math.log(alpha / s) - (1 + alpha) * Math.log(z) - Math.pow(z, -alpha);
  },
  pdf: (x, prm) => (x <= prm.m ? 0 : Math.exp(frechet.logPdf(x, prm))),
  cdf: (x, { alpha, s, m }) => (x <= m ? 0 : Math.exp(-Math.pow((x - m) / s, -alpha))),
  sf: (x, { alpha, s, m }) => (x <= m ? 1 : -Math.expm1(-Math.pow((x - m) / s, -alpha))),
  quantile: (q, { alpha, s, m }) => {
    assertQuantileLevel(q);
    if (q === 0) return m;
    if (q === 1) return Infinity;
    return m + s * Math.pow(-Math.log(q), -1 / alpha);
  },
  mean: (prm) =>
    prm.alpha > 1 ? defined(prm.m + frechetRawMoment(1, prm)) : undefinedMoment('The mean is infinite for α ≤ 1.'),
  variance: (prm) =>
    prm.alpha > 2
      ? defined(frechetRawMoment(2, prm) - frechetRawMoment(1, prm) ** 2)
      : undefinedMoment('The variance is infinite for α ≤ 2.'),
  skewness: (prm) => {
    if (!(prm.alpha > 3)) return undefinedMoment('The skewness requires α > 3; the third moment is infinite otherwise.');
    const g1 = frechetRawMoment(1, prm);
    const g2 = frechetRawMoment(2, prm);
    const g3 = frechetRawMoment(3, prm);
    return defined((g3 - 3 * g1 * g2 + 2 * g1 ** 3) / Math.pow(g2 - g1 * g1, 1.5));
  },
  excessKurtosis: (prm) => {
    if (!(prm.alpha > 4)) return undefinedMoment('The kurtosis requires α > 4; the fourth moment is infinite otherwise.');
    const g1 = frechetRawMoment(1, prm);
    const g2 = frechetRawMoment(2, prm);
    const g3 = frechetRawMoment(3, prm);
    const g4 = frechetRawMoment(4, prm);
    return defined(centralFromRaw(g1, g2, g3, g4).excessKurtosis);
  },
  mode: ({ alpha, s, m }) => defined(m + s * Math.pow(alpha / (1 + alpha), 1 / alpha)),
  sample: (rng, { alpha, s, m }) => m + s * Math.pow(-Math.log(rng.uniformOpen()), -1 / alpha),
};

/* ------------------------------------------------------------------ *
 * F distribution
 * ------------------------------------------------------------------ */

export const fDistribution: DistributionDef = {
  id: 'fDistribution',
  name: 'F (Fisher–Snedecor)',
  kind: 'continuous',
  description: 'Ratio of two independent scaled chi-square variables; the null distribution of a variance ratio.',
  useCases: ['Analysis of variance and regression F-tests', 'Comparing two sample variances', 'Nested model comparison'],
  formula: 'f(x) = (d₁/d₂)^{d₁/2} x^{d₁/2−1} (1 + d₁x/d₂)^{−(d₁+d₂)/2} / B(d₁/2, d₂/2)',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'd1', label: 'Numerator degrees of freedom', symbol: 'd₁', description: 'Degrees of freedom of the numerator', defaultValue: 5, min: 0, minExclusive: true, max: 1e7, sliderMin: 1, sliderMax: 50, step: 1 },
    { key: 'd2', label: 'Denominator degrees of freedom', symbol: 'd₂', description: 'Degrees of freedom of the denominator', defaultValue: 10, min: 0, minExclusive: true, max: 1e7, sliderMin: 1, sliderMax: 50, step: 1 },
  ],
  notes: [
    'The mean exists only for d₂ > 2, the variance for d₂ > 4, the skewness for d₂ > 6 and the kurtosis for d₂ > 8. Outside those ranges the moment is reported as undefined, not computed.',
    'Both tails come from the regularised incomplete beta function evaluated on the side that avoids cancellation.',
    'F(1, d₂) is the square of a Student t with d₂ degrees of freedom.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { d1, d2 }) => {
    if (x < 0) return -Infinity;
    if (x === 0) return d1 < 2 ? Infinity : d1 === 2 ? 0 : -Infinity;
    return (
      (d1 / 2) * Math.log(d1) +
      (d2 / 2) * Math.log(d2) +
      (d1 / 2 - 1) * Math.log(x) -
      ((d1 + d2) / 2) * Math.log(d2 + d1 * x) -
      logBeta(d1 / 2, d2 / 2)
    );
  },
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(fDistribution.logPdf(x, prm))),
  cdf: (x, { d1, d2 }) => (x <= 0 ? 0 : x === Infinity ? 1 : incompleteBeta((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2).lower),
  // Direct upper tail: P(X > x) = I_{d₂/(d₂+d₁x)}(d₂/2, d₁/2).
  sf: (x, { d1, d2 }) => (x <= 0 ? 1 : x === Infinity ? 0 : incompleteBeta(d2 / (d2 + d1 * x), d2 / 2, d1 / 2).lower),
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => fDistribution.cdf(x, prm),
      (x) => fDistribution.sf(x, prm),
      { min: 0, max: Infinity },
      { center: 1, scale: 2 },
    ),
  mean: ({ d2 }) => (d2 > 2 ? defined(d2 / (d2 - 2)) : undefinedMoment('The mean does not exist for d₂ ≤ 2.')),
  variance: ({ d1, d2 }) =>
    d2 > 4
      ? defined((2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) * (d2 - 2) * (d2 - 4)))
      : undefinedMoment('The variance does not exist for d₂ ≤ 4.'),
  skewness: ({ d1, d2 }) =>
    d2 > 6
      ? defined(((2 * d1 + d2 - 2) * Math.sqrt(8 * (d2 - 4))) / ((d2 - 6) * Math.sqrt(d1 * (d1 + d2 - 2))))
      : undefinedMoment('The skewness does not exist for d₂ ≤ 6.'),
  excessKurtosis: ({ d1, d2 }) =>
    d2 > 8
      ? defined(
          (12 * (d1 * (5 * d2 - 22) * (d1 + d2 - 2) + (d2 - 4) * (d2 - 2) * (d2 - 2))) /
            (d1 * (d2 - 6) * (d2 - 8) * (d1 + d2 - 2)),
        )
      : undefinedMoment('The kurtosis does not exist for d₂ ≤ 8.'),
  mode: ({ d1, d2 }) =>
    d1 > 2
      ? defined(((d1 - 2) / d1) * (d2 / (d2 + 2)))
      : d1 === 2
        ? defined(0)
        : undefinedMoment('For d₁ < 2 the density is unbounded as x → 0, so there is no mode.'),
  sample: (rng, { d1, d2 }) => ((2 * rng.gamma(d1 / 2)) / d1) / ((2 * rng.gamma(d2 / 2)) / d2),
};

/* ------------------------------------------------------------------ *
 * Inverse Gaussian (Wald)
 * ------------------------------------------------------------------ */

export const inverseGaussian: DistributionDef = {
  id: 'inverseGaussian',
  name: 'Inverse Gaussian (Wald)',
  kind: 'continuous',
  description: 'First passage time of a Brownian motion with positive drift to a fixed level; right-skewed with a light tail.',
  useCases: ['Reaction and response times', 'Time to reach a threshold in a drift–diffusion model', 'Insurance and reliability lifetimes'],
  formula: 'f(x) = √(λ / (2πx³)) · exp(−λ(x − μ)² / (2μ²x))  for x > 0',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'mu', label: 'Mean', symbol: 'μ', description: 'Mean of the distribution', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
    { key: 'lambda', label: 'Shape', symbol: 'λ', description: 'Shape parameter; the variance is μ³/λ', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
  ],
  notes: [
    'Mean–shape parameterisation: E[X] = μ and Var(X) = μ³/λ.',
    'The CDF is the exact two-term expression in the standard normal CDF; the second term is evaluated in log space so that e^{2λ/μ} never overflows.',
    'The survival function is formed as a log-space difference of the same two terms. Both terms share the leading exponential, so for x more than a few orders of magnitude above μ the difference loses roughly log₁₀(x/2μ) digits — still far better than 1 − F, which underflows to 0.',
    'Sampling uses the Michael–Schucany–Haas transformation, which is exact (no rejection).',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { mu, lambda }) => {
    if (x <= 0) return -Infinity;
    return 0.5 * Math.log(lambda) - LOG_SQRT_2PI - 1.5 * Math.log(x) - (lambda * (x - mu) * (x - mu)) / (2 * mu * mu * x);
  },
  pdf: (x, prm) => (x <= 0 ? 0 : Math.exp(inverseGaussian.logPdf(x, prm))),
  cdf: (x, { mu, lambda }) => {
    if (x <= 0) return 0;
    if (x === Infinity) return 1;
    const r = Math.sqrt(lambda / x);
    const a = r * (x / mu - 1);
    const b = r * (x / mu + 1);
    const first = normalCdf(a);
    const second = Math.exp((2 * lambda) / mu + logNormalSf(b));
    return Math.min(1, first + second);
  },
  sf: (x, { mu, lambda }) => {
    if (x <= 0) return 1;
    if (x === Infinity) return 0;
    const r = Math.sqrt(lambda / x);
    const a = r * (x / mu - 1);
    const b = r * (x / mu + 1);
    // S(x) = Φ(−a) − e^{2λ/μ} Φ(−b); both terms are positive, so the
    // difference is formed in log space to avoid forming 1 − F.
    const logA = logNormalSf(a);
    const logB = (2 * lambda) / mu + logNormalSf(b);
    if (logA === -Infinity) return 0;
    const d = logB - logA;
    if (d >= 0) return 0;
    return Math.max(0, -Math.exp(logA) * Math.expm1(d));
  },
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => inverseGaussian.cdf(x, prm),
      (x) => inverseGaussian.sf(x, prm),
      { min: 0, max: Infinity },
      { center: prm.mu, scale: Math.sqrt((prm.mu * prm.mu * prm.mu) / prm.lambda) },
    ),
  mean: ({ mu }) => defined(mu),
  variance: ({ mu, lambda }) => defined((mu * mu * mu) / lambda),
  skewness: ({ mu, lambda }) => defined(3 * Math.sqrt(mu / lambda)),
  excessKurtosis: ({ mu, lambda }) => defined((15 * mu) / lambda),
  mode: ({ mu, lambda }) => {
    const r = mu / lambda;
    return defined(mu * (Math.sqrt(1 + (9 * mu * mu) / (4 * lambda * lambda)) - (3 * r) / 2));
  },
  sample: (rng, { mu, lambda }) => {
    const v = rng.normal();
    const y = v * v;
    const x = mu + (mu * mu * y) / (2 * lambda) - (mu / (2 * lambda)) * Math.sqrt(4 * mu * lambda * y + mu * mu * y * y);
    return rng.uniform() <= mu / (mu + x) ? x : (mu * mu) / x;
  },
};

/* ------------------------------------------------------------------ *
 * Beta prime
 * ------------------------------------------------------------------ */

const betaPrimeRawMoment = (n: number, { alpha, beta }: Params): number =>
  Math.exp(logGamma(alpha + n) + logGamma(beta - n) - logGamma(alpha) - logGamma(beta));

export const betaPrime: DistributionDef = {
  id: 'betaPrime',
  name: 'Beta prime',
  kind: 'continuous',
  description: 'Distribution of the odds ratio X/(1 − X) when X has a beta distribution; a positive variable with a power-law tail.',
  useCases: ['Odds derived from a beta-distributed probability', 'Ratios of independent gamma variables', 'Bayesian priors for positive scale ratios'],
  formula: 'f(x) = x^{α−1} (1 + x)^{−α−β} / B(α, β)  for x > 0',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'alpha', label: 'First shape', symbol: 'α', description: 'Shape parameter of the numerator', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
    { key: 'beta', label: 'Second shape', symbol: 'β', description: 'Shape parameter of the denominator; the tail index', defaultValue: 4, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
  ],
  notes: [
    'If Y ~ Beta(α, β) then X = Y/(1 − Y) has this distribution.',
    'Raw moments are E[Xⁿ] = Γ(α+n)Γ(β−n)/(Γ(α)Γ(β)) and exist only for n < β, so the mean requires β > 1, the variance β > 2, the skewness β > 3 and the kurtosis β > 4.',
    'The upper tail is computed as I_{1/(1+x)}(β, α), which is direct rather than 1 − F.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { alpha, beta }) => {
    if (x <= 0) return x === 0 && alpha < 1 ? Infinity : -Infinity;
    return (alpha - 1) * Math.log(x) - (alpha + beta) * Math.log1p(x) - logBeta(alpha, beta);
  },
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(betaPrime.logPdf(x, prm))),
  cdf: (x, { alpha, beta }) => (x <= 0 ? 0 : x === Infinity ? 1 : incompleteBeta(x / (1 + x), alpha, beta).lower),
  sf: (x, { alpha, beta }) => (x <= 0 ? 1 : x === Infinity ? 0 : incompleteBeta(1 / (1 + x), beta, alpha).lower),
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => betaPrime.cdf(x, prm),
      (x) => betaPrime.sf(x, prm),
      { min: 0, max: Infinity },
      { center: prm.alpha / prm.beta, scale: 1 + prm.alpha / prm.beta },
    ),
  mean: (prm) =>
    prm.beta > 1 ? defined(betaPrimeRawMoment(1, prm)) : undefinedMoment('The mean is infinite for β ≤ 1.'),
  variance: (prm) =>
    prm.beta > 2
      ? defined(betaPrimeRawMoment(2, prm) - betaPrimeRawMoment(1, prm) ** 2)
      : undefinedMoment('The variance is infinite for β ≤ 2.'),
  skewness: (prm) =>
    prm.beta > 3
      ? defined(
          centralFromRaw(
            betaPrimeRawMoment(1, prm),
            betaPrimeRawMoment(2, prm),
            betaPrimeRawMoment(3, prm),
            betaPrimeRawMoment(3, prm),
          ).skewness,
        )
      : undefinedMoment('The skewness requires β > 3.'),
  excessKurtosis: (prm) =>
    prm.beta > 4
      ? defined(
          centralFromRaw(
            betaPrimeRawMoment(1, prm),
            betaPrimeRawMoment(2, prm),
            betaPrimeRawMoment(3, prm),
            betaPrimeRawMoment(4, prm),
          ).excessKurtosis,
        )
      : undefinedMoment('The kurtosis requires β > 4.'),
  mode: ({ alpha, beta }) =>
    alpha >= 1
      ? defined((alpha - 1) / (beta + 1))
      : undefinedMoment('For α < 1 the density is unbounded as x → 0, so there is no mode.'),
  sample: (rng, { alpha, beta }) => rng.gamma(alpha) / rng.gamma(beta),
};

/* ------------------------------------------------------------------ *
 * Erlang
 * ------------------------------------------------------------------ */

export const erlang: DistributionDef = {
  id: 'erlang',
  name: 'Erlang',
  kind: 'continuous',
  description: 'Waiting time until the k-th event of a Poisson process with rate λ; a gamma distribution with integer shape.',
  useCases: ['Total service time of k sequential stages', 'Telephone and queueing traffic models', 'Time to the k-th failure at a constant rate'],
  formula: 'f(x) = λᵏ x^{k−1} e^{−λx} / (k − 1)!  for x ≥ 0',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'k', label: 'Number of stages', symbol: 'k', description: 'Number of events waited for (a whole number)', defaultValue: 3, min: 1, max: 10000, integer: true, sliderMin: 1, sliderMax: 30, step: 1 },
    { key: 'lambda', label: 'Rate', symbol: 'λ', description: 'Events per unit time; the mean is k/λ', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.05, sliderMax: 10, step: 0.05 },
  ],
  notes: [
    'Identical to a gamma distribution with shape k and scale 1/λ, restricted to integer k.',
    'The survival function is the exact finite Poisson sum S(x) = Σ_{n<k} e^{−λx}(λx)ⁿ/n!, evaluated in log space; the CDF uses the regularised incomplete gamma function.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { k, lambda }) => {
    if (x < 0) return -Infinity;
    if (x === 0) return k === 1 ? Math.log(lambda) : -Infinity;
    return k * Math.log(lambda) + (k - 1) * Math.log(x) - lambda * x - logFactorial(k - 1);
  },
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(erlang.logPdf(x, prm))),
  cdf: (x, { k, lambda }) => (x <= 0 ? 0 : incompleteGamma(k, lambda * x).lower),
  sf: (x, { k, lambda }) => {
    if (x <= 0) return 1;
    const y = lambda * x;
    if (!Number.isFinite(y)) return 0;
    const logY = Math.log(y);
    const terms = new Float64Array(k);
    for (let n = 0; n < k; n++) terms[n] = n * logY - y - logFactorial(n);
    return Math.min(1, Math.exp(logSumExp(terms)));
  },
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => erlang.cdf(x, prm),
      (x) => erlang.sf(x, prm),
      { min: 0, max: Infinity },
      { center: prm.k / prm.lambda, scale: Math.sqrt(prm.k) / prm.lambda },
    ),
  mean: ({ k, lambda }) => defined(k / lambda),
  variance: ({ k, lambda }) => defined(k / (lambda * lambda)),
  skewness: ({ k }) => defined(2 / Math.sqrt(k)),
  excessKurtosis: ({ k }) => defined(6 / k),
  mode: ({ k, lambda }) => defined((k - 1) / lambda),
  sample: (rng, { k, lambda }) => rng.gamma(k) / lambda,
};

/* ------------------------------------------------------------------ *
 * Nakagami
 * ------------------------------------------------------------------ */

const nakagamiRawMoment = (n: number, { m, omega }: Params): number =>
  Math.exp(logGamma(m + n / 2) - logGamma(m)) * Math.pow(omega / m, n / 2);

export const nakagami: DistributionDef = {
  id: 'nakagami',
  name: 'Nakagami',
  kind: 'continuous',
  description: 'Magnitude of a fading signal; the square root of a gamma variable, interpolating between Rayleigh and near-constant amplitude.',
  useCases: ['Radio channel fading amplitude', 'Ultrasound and radar envelope statistics', 'Wireless link budget simulation'],
  formula: 'f(x) = (2mᵐ / (Γ(m) Ωᵐ)) · x^{2m−1} · exp(−m x² / Ω)  for x > 0',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'm', label: 'Shape', symbol: 'm', description: 'Fading figure; m = 1 is Rayleigh fading', defaultValue: 1, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
    { key: 'omega', label: 'Spread', symbol: 'Ω', description: 'Mean of X², i.e. the mean power', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: [
    'Ω is the second moment E[X²] (mean power), not the variance.',
    'X² has a gamma distribution with shape m and scale Ω/m, so both tails come from the regularised incomplete gamma function directly.',
    'Raw moments are E[Xⁿ] = (Γ(m + n/2)/Γ(m))·(Ω/m)^{n/2}; all of them are finite.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { m, omega }) => {
    if (x <= 0) return -Infinity;
    return Math.log(2) + m * Math.log(m) - logGamma(m) - m * Math.log(omega) + (2 * m - 1) * Math.log(x) - (m * x * x) / omega;
  },
  pdf: (x, prm) => (x <= 0 ? 0 : Math.exp(nakagami.logPdf(x, prm))),
  cdf: (x, { m, omega }) => (x <= 0 ? 0 : incompleteGamma(m, (m * x * x) / omega).lower),
  sf: (x, { m, omega }) => (x <= 0 ? 1 : incompleteGamma(m, (m * x * x) / omega).upper),
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => nakagami.cdf(x, prm),
      (x) => nakagami.sf(x, prm),
      { min: 0, max: Infinity },
      { center: Math.sqrt(prm.omega), scale: Math.sqrt(prm.omega) / 2 },
    ),
  mean: (prm) => defined(nakagamiRawMoment(1, prm)),
  variance: (prm) => defined(prm.omega - nakagamiRawMoment(1, prm) ** 2),
  skewness: (prm) =>
    defined(
      centralFromRaw(
        nakagamiRawMoment(1, prm),
        nakagamiRawMoment(2, prm),
        nakagamiRawMoment(3, prm),
        nakagamiRawMoment(4, prm),
      ).skewness,
    ),
  excessKurtosis: (prm) =>
    defined(
      centralFromRaw(
        nakagamiRawMoment(1, prm),
        nakagamiRawMoment(2, prm),
        nakagamiRawMoment(3, prm),
        nakagamiRawMoment(4, prm),
      ).excessKurtosis,
    ),
  mode: ({ m, omega }) =>
    m > 0.5
      ? defined(Math.sqrt(((2 * m - 1) * omega) / (2 * m)))
      : m === 0.5
        ? defined(0)
        : undefinedMoment('For m < 1/2 the density is unbounded as x → 0, so there is no mode.'),
  sample: (rng, { m, omega }) => Math.sqrt((rng.gamma(m) * omega) / m),
};

/* ------------------------------------------------------------------ *
 * Burr XII (Singh–Maddala)
 * ------------------------------------------------------------------ */

const burrRawMoment = (n: number, { c, k }: Params): number => k * Math.exp(logBeta(k - n / c, n / c + 1));

export const burr12: DistributionDef = {
  id: 'burr12',
  name: 'Burr XII (Singh–Maddala)',
  kind: 'continuous',
  description: 'Flexible positive distribution with a power-law tail of index c·k; widely used for income and loss data.',
  useCases: ['Income and wealth distributions', 'Insurance loss severity', 'Reliability with non-monotone hazard'],
  formula: 'f(x) = c k x^{c−1} (1 + x^c)^{−k−1}  for x > 0',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'c', label: 'First shape', symbol: 'c', description: 'Shape controlling behaviour near 0', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
    { key: 'k', label: 'Second shape', symbol: 'k', description: 'Shape controlling the tail', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
  ],
  notes: [
    'The tail index is c·k: the n-th moment exists only when n < c·k, so the mean needs ck > 1, the variance ck > 2, the skewness ck > 3 and the kurtosis ck > 4.',
    'Survival function, CDF and quantile are all exact closed forms; the survival function (1 + x^c)^{−k} is evaluated directly.',
  ],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { c, k }) => {
    if (x <= 0) return x === 0 && c < 1 ? Infinity : -Infinity;
    return Math.log(c) + Math.log(k) + (c - 1) * Math.log(x) - (k + 1) * Math.log1p(Math.pow(x, c));
  },
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(burr12.logPdf(x, prm))),
  cdf: (x, { c, k }) => (x <= 0 ? 0 : -Math.expm1(-k * Math.log1p(Math.pow(x, c)))),
  sf: (x, { c, k }) => (x <= 0 ? 1 : Math.exp(-k * Math.log1p(Math.pow(x, c)))),
  quantile: (q, { c, k }) => {
    assertQuantileLevel(q);
    if (q === 0) return 0;
    if (q === 1) return Infinity;
    return Math.pow(Math.expm1(-Math.log1p(-q) / k), 1 / c);
  },
  mean: (prm) =>
    prm.c * prm.k > 1 ? defined(burrRawMoment(1, prm)) : undefinedMoment('The mean is infinite unless c·k > 1.'),
  variance: (prm) =>
    prm.c * prm.k > 2
      ? defined(burrRawMoment(2, prm) - burrRawMoment(1, prm) ** 2)
      : undefinedMoment('The variance is infinite unless c·k > 2.'),
  skewness: (prm) =>
    prm.c * prm.k > 3
      ? defined(
          centralFromRaw(burrRawMoment(1, prm), burrRawMoment(2, prm), burrRawMoment(3, prm), burrRawMoment(3, prm))
            .skewness,
        )
      : undefinedMoment('The skewness is infinite unless c·k > 3.'),
  excessKurtosis: (prm) =>
    prm.c * prm.k > 4
      ? defined(
          centralFromRaw(burrRawMoment(1, prm), burrRawMoment(2, prm), burrRawMoment(3, prm), burrRawMoment(4, prm))
            .excessKurtosis,
        )
      : undefinedMoment('The kurtosis is infinite unless c·k > 4.'),
  mode: ({ c, k }) =>
    c > 1
      ? defined(Math.pow((c - 1) / (c * k + 1), 1 / c))
      : undefinedMoment('For c ≤ 1 the density decreases from an unbounded value at 0, so there is no interior mode.'),
  sample: (rng, { c, k }) => Math.pow(Math.expm1(-Math.log(rng.uniformOpen()) / k), 1 / c),
};

/* ------------------------------------------------------------------ *
 * Half-normal
 * ------------------------------------------------------------------ */

export const halfNormal: DistributionDef = {
  id: 'halfNormal',
  name: 'Half-normal',
  kind: 'continuous',
  description: 'Absolute value of a zero-mean normal variable: the distribution of a magnitude when the sign is discarded.',
  useCases: ['Absolute measurement error', 'Prior for a non-negative scale parameter', 'Magnitude of a centred deviation'],
  formula: 'f(x) = (2 / (σ√(2π))) · exp(−x² / (2σ²))  for x ≥ 0',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'sigma', label: 'Scale', symbol: 'σ', description: 'Scale of the underlying normal (not the standard deviation of X)', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: [
    'If Z ~ Normal(0, σ) then X = |Z| has this distribution; F(x) = 2Φ(x/σ) − 1 = erf(x/(σ√2)).',
    'The mean is σ√(2/π) ≈ 0.7979σ and the variance is σ²(1 − 2/π) ≈ 0.3634σ².',
    'The survival function is 2Φ(−x/σ), computed directly from the complementary error function.',
  ],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { sigma }) => {
    if (x < 0) return -Infinity;
    const z = x / sigma;
    return Math.log(2) - LOG_SQRT_2PI - Math.log(sigma) - 0.5 * z * z;
  },
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(halfNormal.logPdf(x, prm))),
  cdf: (x, { sigma }) => (x <= 0 ? 0 : erf(x / (sigma * SQRT_2))),
  sf: (x, { sigma }) => (x <= 0 ? 1 : erfc(x / (sigma * SQRT_2))),
  quantile: (q, { sigma }) => {
    assertQuantileLevel(q);
    if (q >= 1) return Infinity;
    return sigma * normalQuantile((1 + q) / 2);
  },
  mean: ({ sigma }) => defined(sigma * Math.sqrt(2 / Math.PI)),
  variance: ({ sigma }) => defined(sigma * sigma * (1 - 2 / Math.PI)),
  skewness: () => defined((Math.SQRT2 * (4 - Math.PI)) / Math.pow(Math.PI - 2, 1.5)),
  excessKurtosis: () => defined((8 * (Math.PI - 3)) / ((Math.PI - 2) * (Math.PI - 2))),
  mode: () => defined(0),
  sample: (rng, { sigma }) => Math.abs(sigma * rng.normal()),
};

/* ------------------------------------------------------------------ *
 * Truncated normal
 * ------------------------------------------------------------------ */

interface TruncNormalScale {
  alpha: number;
  beta: number;
  /** Φ(β) − Φ(α), computed on the side that avoids cancellation. */
  z: number;
  /** True when the interval lies in the upper tail, so survival forms are used. */
  upper: boolean;
}

function truncNormalScale({ mu, sigma, a, b }: Params): TruncNormalScale {
  const alpha = (a - mu) / sigma;
  const beta = (b - mu) / sigma;
  const upper = alpha > 0;
  const z = upper ? normalSf(alpha) - normalSf(beta) : normalCdf(beta) - normalCdf(alpha);
  return { alpha, beta, z, upper };
}

function truncNormalZ(p: Params): number {
  const { z } = truncNormalScale(p);
  if (!(z > 0)) {
    throw new EngineError(
      'The truncation interval [a, b] has probability 0 under the untruncated normal, so no truncated distribution exists. Move the bounds closer to μ or increase σ.',
      'range',
    );
  }
  return z;
}

/** E[ξᵏ] for the standard normal truncated to [α, β], by the standard recursion. */
function truncNormalStdMoments(s: TruncNormalScale, order: number): number[] {
  const phiA = Number.isFinite(s.alpha) ? normalPdf(s.alpha) : 0;
  const phiB = Number.isFinite(s.beta) ? normalPdf(s.beta) : 0;
  const m: number[] = [1];
  for (let k = 1; k <= order; k++) {
    const edge =
      (Number.isFinite(s.alpha) ? Math.pow(s.alpha, k - 1) * phiA : 0) -
      (Number.isFinite(s.beta) ? Math.pow(s.beta, k - 1) * phiB : 0);
    m[k] = (k - 1) * (m[k - 2] ?? 0) + edge / s.z;
  }
  return m;
}

export const truncatedNormal: DistributionDef = {
  id: 'truncatedNormal',
  name: 'Truncated normal',
  kind: 'continuous',
  description: 'A normal distribution restricted to the interval [a, b] and renormalised so that the retained mass integrates to 1.',
  useCases: ['A quantity known to be normal but physically bounded (a non-negative duration, a bounded measurement)', 'Censored or screened observations', 'Bounded priors in simulation inputs'],
  formula: 'f(x) = φ((x − μ)/σ) / (σ · (Φ(β) − Φ(α))),  α = (a − μ)/σ, β = (b − μ)/σ',
  supportText: 'x ∈ [a, b]',
  params: [
    { key: 'mu', label: 'Untruncated mean', symbol: 'μ', description: 'Mean of the normal before truncation (not the mean of X)', defaultValue: 0, min: -1e300, max: 1e300, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'sigma', label: 'Untruncated standard deviation', symbol: 'σ', description: 'Standard deviation before truncation', defaultValue: 1, min: 0, minExclusive: true, max: 1e300, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
    { key: 'a', label: 'Lower bound', symbol: 'a', description: 'Lower truncation point', defaultValue: -1, min: -1e300, max: 1e300, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'b', label: 'Upper bound', symbol: 'b', description: 'Upper truncation point', defaultValue: 1, min: -1e300, max: 1e300, sliderMin: -10, sliderMax: 10, step: 0.1 },
  ],
  notes: [
    'μ and σ describe the normal *before* truncation. The mean and variance of X are different and are reported separately.',
    'The functions accept a = −∞ and b = +∞ for a one-sided truncation; with both infinite the distribution reduces exactly to the normal.',
    'All of the normalising constant, the CDF and the quantile are evaluated through the survival function when the interval lies in the upper tail, so extreme truncation such as a = μ + 20σ still gives full relative precision instead of 0/0.',
    'Moments come from the exact recursion E[ξᵏ] = (k−1)E[ξ^{k−2}] + (α^{k−1}φ(α) − β^{k−1}φ(β))/Z.',
  ],
  closedFormQuantile: true,
  validateExtra: (p): Issue[] => {
    if (!(p.b > p.a)) {
      return [{ code: 'range', field: 'b', message: 'Upper bound (b) must be greater than lower bound (a).' }];
    }
    const { z } = truncNormalScale(p);
    if (!(z > 0)) {
      return [
        {
          code: 'range',
          field: 'a',
          message:
            'The truncation interval has probability 0 under the untruncated normal (it lies too far from μ to be represented). No truncated distribution exists for these values.',
        },
      ];
    }
    return [];
  },
  support: ({ a, b }) => ({ min: a, max: b }),
  logPdf: (x, p) => {
    if (x < p.a || x > p.b) return -Infinity;
    const z = truncNormalZ(p);
    const xi = (x - p.mu) / p.sigma;
    return -LOG_SQRT_2PI - 0.5 * xi * xi - Math.log(p.sigma) - Math.log(z);
  },
  pdf: (x, p) => (x < p.a || x > p.b ? 0 : Math.exp(truncatedNormal.logPdf(x, p))),
  cdf: (x, p) => {
    if (x <= p.a) return 0;
    if (x >= p.b) return 1;
    const s = truncNormalScale(p);
    if (!(s.z > 0)) truncNormalZ(p);
    const xi = (x - p.mu) / p.sigma;
    const num = s.upper ? normalSf(s.alpha) - normalSf(xi) : normalCdf(xi) - normalCdf(s.alpha);
    return Math.min(1, Math.max(0, num / s.z));
  },
  sf: (x, p) => {
    if (x <= p.a) return 1;
    if (x >= p.b) return 0;
    const s = truncNormalScale(p);
    if (!(s.z > 0)) truncNormalZ(p);
    const xi = (x - p.mu) / p.sigma;
    const num = xi > 0 ? normalSf(xi) - normalSf(s.beta) : normalCdf(s.beta) - normalCdf(xi);
    return Math.min(1, Math.max(0, num / s.z));
  },
  quantile: (q, p) => {
    assertQuantileLevel(q);
    if (q === 0) return p.a;
    if (q === 1) return p.b;
    const s = truncNormalScale(p);
    if (!(s.z > 0)) truncNormalZ(p);
    let xi: number;
    if (s.upper) {
      // Work with survival probabilities: S(ξ) = S(α) − q·Z.
      const target = normalSf(s.alpha) - q * s.z;
      xi = target <= 0 ? s.beta : -normalQuantile(target);
    } else {
      const target = normalCdf(s.alpha) + q * s.z;
      xi = target >= 1 ? s.beta : normalQuantile(target);
    }
    return Math.min(p.b, Math.max(p.a, p.mu + p.sigma * xi));
  },
  mean: (p) => {
    const s = truncNormalScale(p);
    if (!(s.z > 0)) return undefinedMoment('The truncation interval has probability 0 under the untruncated normal.');
    const m = truncNormalStdMoments(s, 1);
    return defined(p.mu + p.sigma * m[1]);
  },
  variance: (p) => {
    const s = truncNormalScale(p);
    if (!(s.z > 0)) return undefinedMoment('The truncation interval has probability 0 under the untruncated normal.');
    const m = truncNormalStdMoments(s, 2);
    return defined(p.sigma * p.sigma * (m[2] - m[1] * m[1]));
  },
  skewness: (p) => {
    const s = truncNormalScale(p);
    if (!(s.z > 0)) return undefinedMoment('The truncation interval has probability 0 under the untruncated normal.');
    const m = truncNormalStdMoments(s, 3);
    return defined(centralFromRaw(m[1], m[2], m[3], m[3]).skewness);
  },
  excessKurtosis: (p) => {
    const s = truncNormalScale(p);
    if (!(s.z > 0)) return undefinedMoment('The truncation interval has probability 0 under the untruncated normal.');
    const m = truncNormalStdMoments(s, 4);
    return defined(centralFromRaw(m[1], m[2], m[3], m[4]).excessKurtosis);
  },
  mode: (p) => defined(Math.min(p.b, Math.max(p.a, p.mu))),
  sample: (rng, p) => truncatedNormal.quantile(rng.uniformOpen(), p),
};

/* ------------------------------------------------------------------ *
 * Von Mises (circular)
 * ------------------------------------------------------------------ */

/** 5-point Gauss–Legendre nodes and weights on [−1, 1]. */
const GL5_X = [0, 0.5384693101056831, -0.5384693101056831, 0.906179845938664, -0.906179845938664];
const GL5_W = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

/** Panels per full turn used for the von Mises CDF quadrature. */
const vonMisesPanels = (kappa: number) => Math.max(256, Math.ceil(128 * Math.sqrt(1 + kappa)));

/**
 * P(X ≤ x) for the von Mises distribution, by panel-wise Gauss–Legendre
 * quadrature of the density from μ − π. Panels are anchored to a fixed grid and
 * each contributes a non-negative amount, so the result is monotone in x by
 * construction.
 */
function vonMisesCdf(x: number, { mu, kappa }: Params): number {
  const lo = mu - Math.PI;
  const hi = mu + Math.PI;
  if (x <= lo) return 0;
  if (x >= hi) return 1;
  const n = vonMisesPanels(kappa);
  const h = (2 * Math.PI) / n;
  const logNorm = Math.log(2 * Math.PI) + logBesselI(0, kappa);
  const density = (t: number) => Math.exp(kappa * Math.cos(t - mu) - logNorm);
  const panel = (left: number, right: number) => {
    const half = (right - left) / 2;
    const mid = (right + left) / 2;
    let acc = 0;
    for (let i = 0; i < 5; i++) acc += GL5_W[i] * density(mid + half * GL5_X[i]);
    return acc * half;
  };
  const full = Math.floor((x - lo) / h);
  let total = 0;
  for (let j = 0; j < full; j++) total += panel(lo + j * h, lo + (j + 1) * h);
  const edge = lo + full * h;
  if (x > edge) total += panel(edge, x);
  return Math.min(1, total);
}

export const vonMises: DistributionDef = {
  id: 'vonMises',
  name: 'Von Mises (circular normal)',
  kind: 'continuous',
  description: 'The natural bell-shaped distribution for an angle: a direction concentrated around μ with concentration κ.',
  useCases: ['Wind, current and animal movement directions', 'Phase angles and time-of-day effects', 'Circular measurement error'],
  formula: 'f(x) = exp(κ·cos(x − μ)) / (2π I₀(κ))',
  supportText: 'x ∈ [μ − π, μ + π] (an angle, wrapped modulo 2π)',
  params: [
    { key: 'mu', label: 'Mean direction', symbol: 'μ', description: 'Mean direction in radians', defaultValue: 0, min: -Math.PI, max: Math.PI, sliderMin: -Math.PI, sliderMax: Math.PI, step: 0.05 },
    { key: 'kappa', label: 'Concentration', symbol: 'κ', description: 'Concentration; κ = 0 is uniform on the circle, large κ is nearly normal', defaultValue: 2, min: 0, minExclusive: true, max: 200, sliderMin: 0.1, sliderMax: 50, step: 0.1 },
  ],
  notes: [
    'THE SUPPORT IS CIRCULAR. Values are reported on one full turn [μ − π, μ + π]; a value and that value plus 2π are the same direction. The CDF is defined relative to the cut at μ − π and is not comparable across different μ.',
    'Because the support is a circle, there is no meaningful linear variance, skewness or kurtosis; these are reported as undefined and the circular variance 1 − I₁(κ)/I₀(κ) is given in the reason instead.',
    'The CDF has no closed form and is computed by panel-wise Gauss–Legendre quadrature anchored to a fixed grid, which makes it monotone by construction.',
    'Sampling uses the Best–Fisher (1979) rejection algorithm.',
  ],
  closedFormQuantile: false,
  support: ({ mu }) => ({ min: mu - Math.PI, max: mu + Math.PI }),
  logPdf: (x, { mu, kappa }) => {
    if (x < mu - Math.PI || x > mu + Math.PI) return -Infinity;
    return kappa * Math.cos(x - mu) - Math.log(2 * Math.PI) - logBesselI(0, kappa);
  },
  pdf: (x, prm) => (x < prm.mu - Math.PI || x > prm.mu + Math.PI ? 0 : Math.exp(vonMises.logPdf(x, prm))),
  cdf: vonMisesCdf,
  sf: (x, prm) => {
    // By the symmetry of the density about μ, S(x) = F(2μ − x).
    if (x <= prm.mu - Math.PI) return 1;
    if (x >= prm.mu + Math.PI) return 0;
    return vonMisesCdf(2 * prm.mu - x, prm);
  },
  quantile: (q, prm) =>
    invertContinuous(
      q,
      (x) => vonMises.cdf(x, prm),
      (x) => vonMises.sf(x, prm),
      { min: prm.mu - Math.PI, max: prm.mu + Math.PI },
      { center: prm.mu, scale: 1 },
    ),
  mean: ({ mu }) => defined(mu),
  variance: ({ kappa }) => {
    const r = Math.exp(logBesselI(1, kappa) - logBesselI(0, kappa));
    return undefinedMoment(
      `A linear variance is not meaningful on a circle. The circular variance is 1 − I₁(κ)/I₀(κ) = ${(1 - r).toPrecision(8)}.`,
    );
  },
  skewness: () => undefinedMoment('Linear skewness is not meaningful for a circular distribution; the density is symmetric about μ.'),
  excessKurtosis: () => undefinedMoment('Linear kurtosis is not meaningful for a circular distribution.'),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { mu, kappa }) => {
    // Best & Fisher (1979).
    const a = 1 + Math.sqrt(1 + 4 * kappa * kappa);
    const b = (a - Math.sqrt(2 * a)) / (2 * kappa);
    const r = (1 + b * b) / (2 * b);
    for (let i = 0; i < 1000; i++) {
      const u1 = rng.uniform();
      const z = Math.cos(Math.PI * u1);
      const f = (1 + r * z) / (r + z);
      const c = kappa * (r - f);
      const u2 = rng.uniformOpen();
      if (c * (2 - c) - u2 > 0 || Math.log(c / u2) + 1 - c >= 0) {
        const u3 = rng.uniform();
        const theta = Math.acos(Math.min(1, Math.max(-1, f)));
        return mu + (u3 > 0.5 ? theta : -theta);
      }
    }
    throw new EngineError('The von Mises rejection sampler failed to accept a value in 1000 attempts.', 'numerical');
  },
};

/* ------------------------------------------------------------------ *
 * Lévy
 * ------------------------------------------------------------------ */

export const levy: DistributionDef = {
  id: 'levy',
  name: 'Lévy',
  kind: 'continuous',
  description: 'Extremely heavy-tailed positive distribution: the hitting time of a level by a driftless Brownian motion. It has no mean.',
  useCases: ['First passage time of a driftless random walk', 'Stable-law modelling of extreme fluctuations (index 1/2)', 'Demonstrating that sample means need not converge'],
  formula: 'f(x) = √(c / 2π) · exp(−c / (2(x − μ))) / (x − μ)^{3/2}  for x > μ',
  supportText: 'x ∈ (μ, ∞)',
  params: [
    { key: 'mu', label: 'Location', symbol: 'μ', description: 'Lower limit of the support', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'c', label: 'Scale', symbol: 'c', description: 'Scale parameter', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: [
    'NO MOMENTS EXIST. The tail decays like x^{−3/2}, so even the mean diverges. Sample means of Lévy draws do not settle down, and simulation summaries based on averages are meaningless here; use quantiles.',
    'F(x) = erfc(√(c/(2(x−μ)))) and S(x) = erf(√(c/(2(x−μ)))) are both exact and direct.',
    'If Z is standard normal then μ + c/Z² has exactly this distribution, which is how sampling is done.',
  ],
  closedFormQuantile: true,
  support: ({ mu }) => ({ min: mu, max: Infinity }),
  logPdf: (x, { mu, c }) => {
    if (x <= mu) return -Infinity;
    const y = x - mu;
    return 0.5 * Math.log(c) - LOG_SQRT_2PI - 1.5 * Math.log(y) - c / (2 * y);
  },
  pdf: (x, prm) => (x <= prm.mu ? 0 : Math.exp(levy.logPdf(x, prm))),
  cdf: (x, { mu, c }) => (x <= mu ? 0 : erfc(Math.sqrt(c / (2 * (x - mu))))),
  sf: (x, { mu, c }) => (x <= mu ? 1 : erf(Math.sqrt(c / (2 * (x - mu))))),
  quantile: (q, { mu, c }) => {
    assertQuantileLevel(q);
    if (q === 0) return mu;
    if (q >= 1) return Infinity;
    const z = normalQuantile(q / 2);
    return mu + c / (z * z);
  },
  mean: () => undefinedMoment('The mean does not exist: with a x^{−3/2} tail the defining integral diverges.'),
  variance: () => undefinedMoment('The variance does not exist, because the mean does not exist.'),
  skewness: () => undefinedMoment('The skewness does not exist: no moment of order ≥ 1/2 is finite.'),
  excessKurtosis: () => undefinedMoment('The kurtosis does not exist: no moment of order ≥ 1/2 is finite.'),
  mode: ({ mu, c }) => defined(mu + c / 3),
  sample: (rng, { mu, c }) => {
    let z = 0;
    while (z === 0) z = rng.normal();
    return mu + c / (z * z);
  },
};

/* ------------------------------------------------------------------ *
 * Kumaraswamy
 * ------------------------------------------------------------------ */

const kumaraswamyRawMoment = (n: number, { a, b }: Params): number =>
  Math.exp(Math.log(b) + logBeta(1 + n / a, b));

export const kumaraswamy: DistributionDef = {
  id: 'kumaraswamy',
  name: 'Kumaraswamy',
  kind: 'continuous',
  description: 'A flexible distribution on [0, 1] shaped much like the beta, but with a closed-form CDF and quantile.',
  useCases: ['Proportions and fractions when a closed-form quantile is needed', 'Hydrology (storage and flow fractions)', 'Fast simulation of bounded quantities'],
  formula: 'f(x) = a b x^{a−1} (1 − x^a)^{b−1}  for 0 < x < 1',
  supportText: 'x ∈ [0, 1]',
  params: [
    { key: 'a', label: 'First shape', symbol: 'a', description: 'Shape controlling behaviour near 0', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
    { key: 'b', label: 'Second shape', symbol: 'b', description: 'Shape controlling behaviour near 1', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
  ],
  notes: [
    'Unlike the beta distribution both the CDF 1 − (1 − x^a)^b and the quantile (1 − (1 − q)^{1/b})^{1/a} are exact closed forms.',
    'Raw moments are E[Xⁿ] = b·B(1 + n/a, b); all are finite because the support is bounded.',
    'a = b = 1 is the standard uniform distribution.',
  ],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: 1 }),
  logPdf: (x, { a, b }) => {
    if (x < 0 || x > 1) return -Infinity;
    if (x === 0) return a < 1 ? Infinity : a === 1 ? Math.log(a * b) + (b - 1) * Math.log1p(-0) : -Infinity;
    if (x === 1) return b < 1 ? Infinity : b === 1 ? Math.log(a * b) : -Infinity;
    return Math.log(a) + Math.log(b) + (a - 1) * Math.log(x) + (b - 1) * Math.log1p(-Math.pow(x, a));
  },
  pdf: (x, prm) => (x < 0 || x > 1 ? 0 : Math.exp(kumaraswamy.logPdf(x, prm))),
  cdf: (x, { a, b }) => (x <= 0 ? 0 : x >= 1 ? 1 : -Math.expm1(b * Math.log1p(-Math.pow(x, a)))),
  sf: (x, { a, b }) => (x <= 0 ? 1 : x >= 1 ? 0 : Math.exp(b * Math.log1p(-Math.pow(x, a)))),
  quantile: (q, { a, b }) => {
    assertQuantileLevel(q);
    if (q === 0) return 0;
    if (q === 1) return 1;
    return Math.pow(-Math.expm1(Math.log1p(-q) / b), 1 / a);
  },
  mean: (prm) => defined(kumaraswamyRawMoment(1, prm)),
  variance: (prm) => defined(kumaraswamyRawMoment(2, prm) - kumaraswamyRawMoment(1, prm) ** 2),
  skewness: (prm) =>
    defined(
      centralFromRaw(
        kumaraswamyRawMoment(1, prm),
        kumaraswamyRawMoment(2, prm),
        kumaraswamyRawMoment(3, prm),
        kumaraswamyRawMoment(4, prm),
      ).skewness,
    ),
  excessKurtosis: (prm) =>
    defined(
      centralFromRaw(
        kumaraswamyRawMoment(1, prm),
        kumaraswamyRawMoment(2, prm),
        kumaraswamyRawMoment(3, prm),
        kumaraswamyRawMoment(4, prm),
      ).excessKurtosis,
    ),
  mode: ({ a, b }) => {
    if (a === 1 && b === 1) return undefinedMoment('a = b = 1 is the uniform distribution: every value in [0, 1] has the same density.');
    if (a >= 1 && b >= 1) return defined(Math.pow((a - 1) / (a * b - 1), 1 / a));
    return undefinedMoment('For a < 1 or b < 1 the density is unbounded at an endpoint, so there is no interior mode.');
  },
  sample: (rng, prm) => kumaraswamy.quantile(rng.uniformOpen(), prm),
};

/* ------------------------------------------------------------------ *
 * Beta-binomial
 * ------------------------------------------------------------------ */

function betaBinomialLogPmf(k: number, { n, alpha, beta }: Params): number {
  if (!isInt(k) || k < 0 || k > n) return -Infinity;
  return logChoose(n, k) + logBeta(k + alpha, n - k + beta) - logBeta(alpha, beta);
}

/** Exact summation of the pmf over the support, used for the higher moments. */
function betaBinomialMoments(p: Params): CentralMoments {
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let k = 0; k <= p.n; k++) {
    const w = Math.exp(betaBinomialLogPmf(k, p));
    m1 += k * w;
    m2 += k * k * w;
    m3 += k * k * k * w;
    m4 += k * k * k * k * w;
  }
  return centralFromRaw(m1, m2, m3, m4);
}

export const betaBinomial: DistributionDef = {
  id: 'betaBinomial',
  name: 'Beta-binomial',
  kind: 'discrete',
  description: 'Number of successes in n trials when the success probability is itself uncertain, drawn from a Beta(α, β) distribution. Overdispersed relative to the binomial.',
  useCases: ['Clustered or contagious counts where trials are not independent', 'Overdispersed survey or defect counts', 'Bayesian predictive distribution for a binomial with a beta prior'],
  formula: 'P(X = k) = C(n, k) · B(k + α, n − k + β) / B(α, β)',
  supportText: 'k ∈ {0, 1, …, n}',
  params: [
    { key: 'n', label: 'Number of trials', symbol: 'n', description: 'Number of trials', defaultValue: 10, min: 0, max: 100000, integer: true, sliderMin: 1, sliderMax: 100, step: 1 },
    { key: 'alpha', label: 'First shape', symbol: 'α', description: 'Beta prior shape for success', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
    { key: 'beta', label: 'Second shape', symbol: 'β', description: 'Beta prior shape for failure', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 20, step: 0.1 },
  ],
  notes: [
    'The pmf is evaluated through log Β, so large n causes no overflow.',
    'α = β = 1 gives the discrete uniform distribution on {0, …, n}. As α and β grow with α/(α+β) fixed, the distribution approaches Binomial(n, α/(α+β)).',
    'The mean nα/(α+β) and variance are closed forms; the skewness and excess kurtosis are obtained by exact summation of the pmf over the n + 1 support points.',
    'Both tails are summed directly from the end of the support that is being asked about, so neither is formed as 1 minus the other.',
  ],
  closedFormQuantile: false,
  support: ({ n }) => ({ min: 0, max: n }),
  logPdf: (k, p) => betaBinomialLogPmf(k, p),
  pdf: (k, p) => {
    const l = betaBinomialLogPmf(k, p);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, p) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    if (k >= p.n) return 1;
    let acc = 0;
    for (let j = 0; j <= k; j++) acc += Math.exp(betaBinomialLogPmf(j, p));
    return Math.min(1, acc);
  },
  sf: (x, p) => {
    const k = Math.floor(x);
    if (k < 0) return 1;
    if (k >= p.n) return 0;
    let acc = 0;
    for (let j = p.n; j > k; j--) acc += Math.exp(betaBinomialLogPmf(j, p));
    return Math.min(1, acc);
  },
  quantile: (q, p) =>
    invertDiscrete(
      q,
      (k) => betaBinomial.cdf(k, p),
      (k) => betaBinomial.sf(k, p),
      { min: 0, max: p.n },
      (p.n * p.alpha) / (p.alpha + p.beta),
    ),
  mean: ({ n, alpha, beta }) => defined((n * alpha) / (alpha + beta)),
  variance: ({ n, alpha, beta }) => {
    const s = alpha + beta;
    return defined((n * alpha * beta * (s + n)) / (s * s * (s + 1)));
  },
  skewness: (p) => {
    if (p.n === 0) return undefinedMoment('With n = 0 the distribution is a point mass at 0 and has no skewness.');
    return defined(betaBinomialMoments(p).skewness);
  },
  excessKurtosis: (p) => {
    if (p.n === 0) return undefinedMoment('With n = 0 the distribution is a point mass at 0 and has no kurtosis.');
    return defined(betaBinomialMoments(p).excessKurtosis);
  },
  mode: (p) => {
    let best = 0;
    let bestLog = -Infinity;
    let tie = false;
    for (let k = 0; k <= p.n; k++) {
      const l = betaBinomialLogPmf(k, p);
      if (l > bestLog) {
        bestLog = l;
        best = k;
        tie = false;
      } else if (l === bestLog) {
        tie = true;
      }
    }
    return tie ? undefinedMoment('Several values share the maximum probability, so the mode is not unique.') : defined(best);
  },
  sample: (rng, { n, alpha, beta }) => rng.binomial(n, rng.beta(alpha, beta)),
};

/* ------------------------------------------------------------------ *
 * Zipf (zeta) on a finite support
 * ------------------------------------------------------------------ */

interface ZipfTable {
  /** cum[i] = Σ_{k=1..i+1} k^{−s}. */
  cum: Float64Array;
  total: number;
}

const zipfCache = new TableCache<ZipfTable>();

function zipfTable({ s, bigN }: Params): ZipfTable {
  return zipfCache.get(`${s}|${bigN}`, () => {
    const cum = new Float64Array(bigN);
    let acc = 0;
    for (let k = 1; k <= bigN; k++) {
      acc += Math.pow(k, -s);
      cum[k - 1] = acc;
    }
    return { cum, total: acc };
  });
}

/** Generalised harmonic number H(N, r) = Σ_{k=1..N} k^{−r}. */
function harmonic(bigN: number, r: number): number {
  let acc = 0;
  for (let k = 1; k <= bigN; k++) acc += Math.pow(k, -r);
  return acc;
}

export const zipf: DistributionDef = {
  id: 'zipf',
  name: 'Zipf (zeta, finite support)',
  kind: 'discrete',
  description: 'Rank-frequency law: the k-th most common item has probability proportional to k^{−s}, over N ranks.',
  useCases: ['Word frequencies and city sizes', 'Popularity of items in a catalogue', 'Cache and access-pattern modelling'],
  formula: 'P(X = k) = k^{−s} / H(N, s),  H(N, s) = Σ_{j=1..N} j^{−s}',
  supportText: 'k ∈ {1, 2, …, N}',
  params: [
    { key: 's', label: 'Exponent', symbol: 's', description: 'Rank exponent; larger s concentrates mass on the top ranks', defaultValue: 1, min: 0, minExclusive: true, max: 100, sliderMin: 0.1, sliderMax: 5, step: 0.05 },
    { key: 'bigN', label: 'Number of ranks', symbol: 'N', description: 'Size of the support (largest rank)', defaultValue: 100, min: 1, max: 100000, integer: true, sliderMin: 2, sliderMax: 1000, step: 1 },
  ],
  notes: [
    'This is the FINITE form, normalised by the generalised harmonic number H(N, s) rather than by ζ(s). Because the support is finite, every moment exists even for s ≤ 2.',
    'The upper tail is summed directly over the ranks above k instead of being formed as 1 − F(k).',
    'Moments are exact ratios of generalised harmonic numbers, E[Xⁿ] = H(N, s − n)/H(N, s).',
  ],
  closedFormQuantile: false,
  support: ({ bigN }) => ({ min: 1, max: bigN }),
  logPdf: (k, p) => {
    if (!isInt(k) || k < 1 || k > p.bigN) return -Infinity;
    return -p.s * Math.log(k) - Math.log(zipfTable(p).total);
  },
  pdf: (k, p) => {
    const l = zipf.logPdf(k, p);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, p) => {
    const k = Math.floor(x);
    if (k < 1) return 0;
    if (k >= p.bigN) return 1;
    const t = zipfTable(p);
    return t.cum[k - 1] / t.total;
  },
  sf: (x, p) => {
    const k = Math.floor(x);
    if (k < 1) return 1;
    if (k >= p.bigN) return 0;
    let acc = 0;
    for (let j = p.bigN; j > k; j--) acc += Math.pow(j, -p.s);
    return acc / zipfTable(p).total;
  },
  quantile: (q, p) =>
    invertDiscrete(q, (k) => zipf.cdf(k, p), (k) => zipf.sf(k, p), { min: 1, max: p.bigN }, 1),
  mean: ({ s, bigN }) => defined(harmonic(bigN, s - 1) / harmonic(bigN, s)),
  variance: ({ s, bigN }) => {
    const h = harmonic(bigN, s);
    const m1 = harmonic(bigN, s - 1) / h;
    return defined(harmonic(bigN, s - 2) / h - m1 * m1);
  },
  skewness: ({ s, bigN }) => {
    if (bigN === 1) return undefinedMoment('With N = 1 the distribution is a point mass at 1 and has no skewness.');
    const h = harmonic(bigN, s);
    const c = centralFromRaw(
      harmonic(bigN, s - 1) / h,
      harmonic(bigN, s - 2) / h,
      harmonic(bigN, s - 3) / h,
      harmonic(bigN, s - 4) / h,
    );
    return defined(c.skewness);
  },
  excessKurtosis: ({ s, bigN }) => {
    if (bigN === 1) return undefinedMoment('With N = 1 the distribution is a point mass at 1 and has no kurtosis.');
    const h = harmonic(bigN, s);
    const c = centralFromRaw(
      harmonic(bigN, s - 1) / h,
      harmonic(bigN, s - 2) / h,
      harmonic(bigN, s - 3) / h,
      harmonic(bigN, s - 4) / h,
    );
    return defined(c.excessKurtosis);
  },
  mode: () => defined(1),
  sample: (rng, p) => rng.categorical(zipfTable(p).cum) + 1,
};

/* ------------------------------------------------------------------ *
 * Skellam
 * ------------------------------------------------------------------ */

function poissonLogPmf(k: number, lambda: number): number {
  if (!isInt(k) || k < 0) return -Infinity;
  if (lambda === 0) return k === 0 ? 0 : -Infinity;
  return -lambda + k * Math.log(lambda) - logFactorial(k);
}

function skellamLogPmf(k: number, { mu1, mu2 }: Params): number {
  if (!isInt(k)) return -Infinity;
  if (mu2 === 0) return poissonLogPmf(k, mu1);
  if (mu1 === 0) return poissonLogPmf(-k, mu2);
  const root = 2 * Math.sqrt(mu1 * mu2);
  return -(mu1 + mu2) + (k / 2) * (Math.log(mu1) - Math.log(mu2)) + logBesselI(Math.abs(k), root);
}

const SKELLAM_MAX_TERMS = 200000;

export const skellam: DistributionDef = {
  id: 'skellam',
  name: 'Skellam',
  kind: 'discrete',
  description: 'Difference of two independent Poisson counts; the natural law for a score margin or a net change.',
  useCases: ['Goal or point difference between two teams', 'Net change in a population counted by arrivals and departures', 'Difference of two photon or particle counts'],
  formula: 'P(X = k) = e^{−(μ₁+μ₂)} (μ₁/μ₂)^{k/2} I_{|k|}(2√(μ₁μ₂))',
  supportText: 'k ∈ {…, −2, −1, 0, 1, 2, …} (all integers)',
  params: [
    { key: 'mu1', label: 'First rate', symbol: 'μ₁', description: 'Mean of the first Poisson count', defaultValue: 3, min: 0, max: 1e6, sliderMin: 0, sliderMax: 30, step: 0.1 },
    { key: 'mu2', label: 'Second rate', symbol: 'μ₂', description: 'Mean of the second Poisson count (subtracted)', defaultValue: 2, min: 0, max: 1e6, sliderMin: 0, sliderMax: 30, step: 0.1 },
  ],
  notes: [
    'The modified Bessel function I_k is computed from its power series in log space, so no term overflows for large μ.',
    'With μ₂ = 0 this is exactly Poisson(μ₁); with μ₁ = 0 it is the negative of a Poisson(μ₂).',
    'Each tail is summed directly from the requested point outwards, so the tail being asked about never comes from subtracting the other from 1.',
    'The mode has no closed form and is found by scanning the pmf over a window around μ₁ − μ₂ wide enough to contain it.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (k, p) => skellamLogPmf(k, p),
  pdf: (k, p) => {
    const l = skellamLogPmf(k, p);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, p) => {
    if (x === -Infinity) return 0;
    if (x === Infinity) return 1;
    const k = Math.floor(x);
    const centre = p.mu1 - p.mu2;
    let acc = 0;
    for (let j = k, i = 0; i < SKELLAM_MAX_TERMS; j--, i++) {
      const term = Math.exp(skellamLogPmf(j, p));
      acc += term;
      if (j < centre && (term === 0 || term < acc * 1e-18)) return Math.min(1, acc);
      if (term === 0 && j < -1 && p.mu2 === 0) return Math.min(1, acc);
    }
    throw new EngineError('The Skellam lower-tail sum did not converge.', 'numerical');
  },
  sf: (x, p) => {
    if (x === -Infinity) return 1;
    if (x === Infinity) return 0;
    const k = Math.floor(x);
    const centre = p.mu1 - p.mu2;
    let acc = 0;
    for (let j = k + 1, i = 0; i < SKELLAM_MAX_TERMS; j++, i++) {
      const term = Math.exp(skellamLogPmf(j, p));
      acc += term;
      if (j > centre && (term === 0 || term < acc * 1e-18)) return Math.min(1, acc);
      if (term === 0 && j > 1 && p.mu1 === 0) return Math.min(1, acc);
    }
    throw new EngineError('The Skellam upper-tail sum did not converge.', 'numerical');
  },
  quantile: (q, p) => {
    assertQuantileLevel(q);
    const sd = Math.sqrt(p.mu1 + p.mu2);
    return invertDiscreteUnbounded(
      q,
      (k) => skellam.cdf(k, p),
      (k) => skellam.sf(k, p),
      p.mu1 - p.mu2,
      Math.max(2, Math.ceil(4 * sd)),
    );
  },
  mean: ({ mu1, mu2 }) => defined(mu1 - mu2),
  variance: ({ mu1, mu2 }) => defined(mu1 + mu2),
  skewness: ({ mu1, mu2 }) =>
    mu1 + mu2 === 0
      ? undefinedMoment('With μ₁ = μ₂ = 0 the distribution is a point mass at 0 and has no skewness.')
      : defined((mu1 - mu2) / Math.pow(mu1 + mu2, 1.5)),
  excessKurtosis: ({ mu1, mu2 }) =>
    mu1 + mu2 === 0
      ? undefinedMoment('With μ₁ = μ₂ = 0 the distribution is a point mass at 0 and has no kurtosis.')
      : defined(1 / (mu1 + mu2)),
  mode: (p) => {
    const sd = Math.sqrt(p.mu1 + p.mu2);
    const lo = Math.floor(p.mu1 - p.mu2 - 10 - 6 * sd);
    const hi = Math.ceil(p.mu1 - p.mu2 + 10 + 6 * sd);
    let best = lo;
    let bestLog = -Infinity;
    let tie = false;
    for (let k = lo; k <= hi; k++) {
      const l = skellamLogPmf(k, p);
      if (l > bestLog) {
        bestLog = l;
        best = k;
        tie = false;
      } else if (l === bestLog && l > -Infinity) {
        tie = true;
      }
    }
    return tie ? undefinedMoment('Two adjacent values share the maximum probability, so the mode is not unique.') : defined(best);
  },
  sample: (rng, { mu1, mu2 }) => rng.poisson(mu1) - rng.poisson(mu2),
};

/* ------------------------------------------------------------------ *
 * Logarithmic (log-series)
 * ------------------------------------------------------------------ */

const logarithmicLogPmf = (k: number, p: number): number =>
  !isInt(k) || k < 1 ? -Infinity : k * Math.log(p) - Math.log(k) - Math.log(-Math.log1p(-p));

const LOGSERIES_DIRECT_LIMIT = 2000;
const LOGSERIES_MAX_TERMS = 20000000;

function logarithmicTail(k: number, p: number): number {
  // S(k) = −(1/ln(1−p)) Σ_{j>k} p^j / j, summed directly (geometric decay).
  const scale = -1 / Math.log1p(-p);
  let acc = 0;
  let term = Math.pow(p, k + 1);
  for (let j = k + 1, i = 0; i < LOGSERIES_MAX_TERMS; j++, i++) {
    const contribution = term / j;
    acc += contribution;
    if (contribution === 0 || contribution < acc * 1e-18) return Math.min(1, scale * acc);
    term *= p;
  }
  throw new EngineError('The log-series tail sum did not converge.', 'numerical');
}

export const logarithmic: DistributionDef = {
  id: 'logarithmic',
  name: 'Logarithmic (log-series)',
  kind: 'discrete',
  description: 'Counts on {1, 2, 3, …} with probabilities proportional to pᵏ/k; the classic model for species abundance.',
  useCases: ['Number of individuals per species in an ecological sample', 'Number of items per purchase', 'The mixing law behind the negative binomial'],
  formula: 'P(X = k) = −pᵏ / (k · ln(1 − p))',
  supportText: 'k ∈ {1, 2, 3, …}',
  params: [
    { key: 'p', label: 'Parameter', symbol: 'p', description: 'Shape parameter in (0, 1); larger p gives a heavier tail', defaultValue: 0.5, min: 0, minExclusive: true, max: 0.999, sliderMin: 0.01, sliderMax: 0.99, step: 0.01 },
  ],
  notes: [
    'Raw moments are exact: with L = −1/ln(1−p) and q = 1−p, E[X] = L·p/q, E[X²] = L·p/q², E[X³] = L·p(1+p)/q³, E[X⁴] = L·p(1+4p+p²)/q⁴.',
    `The upper tail is summed directly. The CDF is summed directly for k ≤ ${LOGSERIES_DIRECT_LIMIT}; above that it is reported as 1 − S(k), which is the accurate representation there (the CDF is within rounding of 1).`,
    'Sampling uses Kemp\'s LK algorithm, which is exact.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 1, max: Infinity }),
  logPdf: (k, { p }) => logarithmicLogPmf(k, p),
  pdf: (k, { p }) => {
    const l = logarithmicLogPmf(k, p);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, { p }) => {
    const k = Math.floor(x);
    if (k < 1) return 0;
    if (k === Infinity) return 1;
    if (k > LOGSERIES_DIRECT_LIMIT) return Math.max(0, 1 - logarithmicTail(k, p));
    const scale = -1 / Math.log1p(-p);
    let acc = 0;
    let term = p;
    for (let j = 1; j <= k; j++) {
      acc += term / j;
      term *= p;
    }
    return Math.min(1, scale * acc);
  },
  sf: (x, { p }) => {
    const k = Math.floor(x);
    if (k < 1) return 1;
    if (k === Infinity) return 0;
    return logarithmicTail(k, p);
  },
  quantile: (q, { p }) =>
    invertDiscrete(q, (k) => logarithmic.cdf(k, { p }), (k) => logarithmic.sf(k, { p }), { min: 1, max: Infinity }, 2),
  mean: ({ p }) => defined((-1 / Math.log1p(-p)) * (p / (1 - p))),
  variance: ({ p }) => {
    const l = -1 / Math.log1p(-p);
    const q = 1 - p;
    const m1 = (l * p) / q;
    const m2 = (l * p) / (q * q);
    return defined(m2 - m1 * m1);
  },
  skewness: ({ p }) => {
    const l = -1 / Math.log1p(-p);
    const q = 1 - p;
    return defined(
      centralFromRaw(
        (l * p) / q,
        (l * p) / (q * q),
        (l * p * (1 + p)) / (q * q * q),
        (l * p * (1 + 4 * p + p * p)) / (q * q * q * q),
      ).skewness,
    );
  },
  excessKurtosis: ({ p }) => {
    const l = -1 / Math.log1p(-p);
    const q = 1 - p;
    return defined(
      centralFromRaw(
        (l * p) / q,
        (l * p) / (q * q),
        (l * p * (1 + p)) / (q * q * q),
        (l * p * (1 + 4 * p + p * p)) / (q * q * q * q),
      ).excessKurtosis,
    );
  },
  mode: () => defined(1),
  sample: (rng, { p }) => {
    // Kemp (1981) "LK" algorithm.
    const r = Math.log1p(-p);
    for (;;) {
      const v = rng.uniformOpen();
      if (v >= p) return 1;
      const u = rng.uniformOpen();
      const q = -Math.expm1(r * u);
      if (v <= q * q) {
        const result = Math.floor(1 + Math.log(v) / Math.log(q));
        if (result < 1) continue;
        return result;
      }
      return v <= q ? 2 : 1;
    }
  },
};

/* ------------------------------------------------------------------ *
 * Yule–Simon
 * ------------------------------------------------------------------ */

const yuleLogPmf = (k: number, rho: number): number =>
  !isInt(k) || k < 1 ? -Infinity : Math.log(rho) + logBeta(k, rho + 1);

const YULE_DIRECT_LIMIT = 200;

export const yuleSimon: DistributionDef = {
  id: 'yuleSimon',
  name: 'Yule–Simon',
  kind: 'discrete',
  description: 'Power-law distribution on {1, 2, 3, …} arising from preferential attachment: rich-get-richer growth.',
  useCases: ['Word frequencies and citation counts', 'Degree distribution of a growing network', 'Size of groups formed by preferential attachment'],
  formula: 'P(X = k) = ρ · B(k, ρ + 1)',
  supportText: 'k ∈ {1, 2, 3, …}',
  params: [
    { key: 'rho', label: 'Shape', symbol: 'ρ', description: 'Power-law exponent parameter; the tail decays like k^{−(ρ+1)}', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: [
    'The survival function is the exact closed form S(k) = k·B(k, ρ+1), evaluated through log Β, so the power-law tail keeps full relative precision.',
    `The CDF is summed directly for k ≤ ${YULE_DIRECT_LIMIT} and taken as 1 − S(k) above that, where 1 − S is the accurate representation.`,
    'The mean exists only for ρ > 1, the variance for ρ > 2, the skewness for ρ > 3 and the kurtosis for ρ > 4.',
    'Mixture representation used for sampling: p ~ Beta(ρ, 1) and then X ~ Geometric(p) on {1, 2, …}, which reproduces the pmf exactly.',
  ],
  closedFormQuantile: false,
  support: () => ({ min: 1, max: Infinity }),
  logPdf: (k, { rho }) => yuleLogPmf(k, rho),
  pdf: (k, { rho }) => {
    const l = yuleLogPmf(k, rho);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, { rho }) => {
    const k = Math.floor(x);
    if (k < 1) return 0;
    if (k === Infinity) return 1;
    if (k > YULE_DIRECT_LIMIT) return Math.max(0, 1 - Math.exp(Math.log(k) + logBeta(k, rho + 1)));
    let acc = 0;
    for (let j = 1; j <= k; j++) acc += Math.exp(yuleLogPmf(j, rho));
    return Math.min(1, acc);
  },
  sf: (x, { rho }) => {
    const k = Math.floor(x);
    if (k < 1) return 1;
    if (k === Infinity) return 0;
    return Math.min(1, Math.exp(Math.log(k) + logBeta(k, rho + 1)));
  },
  quantile: (q, { rho }) =>
    invertDiscrete(q, (k) => yuleSimon.cdf(k, { rho }), (k) => yuleSimon.sf(k, { rho }), { min: 1, max: Infinity }, 2),
  mean: ({ rho }) => (rho > 1 ? defined(rho / (rho - 1)) : undefinedMoment('The mean is infinite for ρ ≤ 1.')),
  variance: ({ rho }) =>
    rho > 2
      ? defined((rho * rho) / ((rho - 1) * (rho - 1) * (rho - 2)))
      : undefinedMoment('The variance is infinite for ρ ≤ 2.'),
  skewness: ({ rho }) =>
    rho > 3
      ? defined(((rho + 1) * (rho + 1) * Math.sqrt(rho - 2)) / ((rho - 3) * Math.sqrt(rho)))
      : undefinedMoment('The skewness is infinite for ρ ≤ 3.'),
  excessKurtosis: ({ rho }) =>
    rho > 4
      ? defined(rho + 3 + (11 * rho * rho * rho - 49 * rho - 22) / ((rho - 4) * (rho - 3) * rho))
      : undefinedMoment('The kurtosis is infinite for ρ ≤ 4.'),
  mode: () => defined(1),
  sample: (rng, { rho }) => {
    const p = Math.pow(rng.uniformOpen(), 1 / rho);
    return 1 + rng.geometricFailures(p);
  },
};

/* ------------------------------------------------------------------ *
 * Conway–Maxwell–Poisson
 * ------------------------------------------------------------------ */

interface ComTable {
  /** Normalised probabilities from k = 0 upwards. */
  probs: Float64Array;
  /** Cumulative probabilities (last entry ≈ 1). */
  cum: Float64Array;
  logZ: number;
}

const comCache = new TableCache<ComTable>();
const COM_MAX_TERMS = 2000000;
/** Largest tolerated λ^{1/ν}: beyond this the normalising sum is impractical. */
const COM_MAX_LOG_RATIO = 11.5;

function comLogTerm(k: number, lambda: number, nu: number): number {
  return k * Math.log(lambda) - nu * logFactorial(k);
}

function comConvergenceIssue({ lambda, nu }: Params): Issue | null {
  if (nu === 0) {
    return lambda < 1
      ? null
      : {
          code: 'range',
          field: 'lambda',
          message: 'With ν = 0 the normalising constant is the geometric series Σλᵏ, which converges only for λ < 1.',
        };
  }
  if (Math.log(lambda) / nu > COM_MAX_LOG_RATIO) {
    return {
      code: 'range',
      field: 'nu',
      message:
        'The normalising constant Z(λ, ν) = Σ λᵏ/(k!)^ν only starts to decay beyond k ≈ λ^{1/ν}, which is too large here to sum to a usable tolerance. Increase ν or decrease λ.',
    };
  }
  return null;
}

function comTable(p: Params): ComTable {
  const issue = comConvergenceIssue(p);
  if (issue) throw new EngineError([issue]);
  const { lambda, nu } = p;
  return comCache.get(`${lambda}|${nu}`, () => {
    const logTerms: number[] = [];
    let maxLog = -Infinity;
    let argmax = 0;
    let k = 0;
    for (; k < COM_MAX_TERMS; k++) {
      const t = comLogTerm(k, lambda, nu);
      logTerms.push(t);
      if (t > maxLog) {
        maxLog = t;
        argmax = k;
      }
      if (k > argmax && t < maxLog - 80) break;
    }
    if (k >= COM_MAX_TERMS) {
      throw new EngineError(
        `The normalising constant Z(λ=${lambda}, ν=${nu}) had not converged after ${COM_MAX_TERMS} terms; no value is reported.`,
        'numerical',
      );
    }
    const logZ = logSumExp(logTerms);
    const probs = new Float64Array(logTerms.length);
    const cum = new Float64Array(logTerms.length);
    let acc = 0;
    for (let i = 0; i < logTerms.length; i++) {
      probs[i] = Math.exp(logTerms[i] - logZ);
      acc += probs[i];
      cum[i] = acc;
    }
    return { probs, cum, logZ };
  });
}

function comMoments(p: Params): { m1: number; central: CentralMoments } {
  const { probs } = comTable(p);
  let m1 = 0;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let k = 0; k < probs.length; k++) {
    const w = probs[k];
    m1 += k * w;
    m2 += k * k * w;
    m3 += k * k * k * w;
    m4 += k * k * k * k * w;
  }
  return { m1, central: centralFromRaw(m1, m2, m3, m4) };
}

export const comPoisson: DistributionDef = {
  id: 'comPoisson',
  name: 'Conway–Maxwell–Poisson',
  kind: 'discrete',
  description: 'A generalisation of the Poisson distribution with a tunable dispersion: ν < 1 gives overdispersion, ν > 1 underdispersion.',
  useCases: ['Counts that are more or less variable than a Poisson allows', 'Underdispersed counts (ν > 1), which no Poisson or negative binomial can represent', 'Queueing with state-dependent service rates'],
  formula: 'P(X = k) = λᵏ / ((k!)^ν · Z(λ, ν)),  Z(λ, ν) = Σ_{j≥0} λʲ/(j!)^ν',
  supportText: 'k ∈ {0, 1, 2, …}',
  params: [
    { key: 'lambda', label: 'Rate', symbol: 'λ', description: 'Rate-like parameter (equal to the Poisson mean only when ν = 1)', defaultValue: 4, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 30, step: 0.1 },
    { key: 'nu', label: 'Dispersion', symbol: 'ν', description: 'Dispersion: ν = 1 is Poisson, ν < 1 overdispersed, ν > 1 underdispersed', defaultValue: 1, min: 0, max: 1000, sliderMin: 0, sliderMax: 5, step: 0.05 },
  ],
  notes: [
    'ν = 1 reduces exactly to Poisson(λ); ν = 0 with λ < 1 is the geometric distribution on {0, 1, …} with success probability 1 − λ; ν → ∞ approaches Bernoulli(λ/(1+λ)).',
    'λ is NOT the mean unless ν = 1.',
    'The normalising constant has no closed form. It is summed until the terms are 80 natural logs below the peak; if that has not happened within 2,000,000 terms the computation is refused with an error rather than reporting a partial sum.',
    'Because no closed form exists, the mean, variance, skewness and kurtosis are obtained by summation over the same truncated support, which carries the same (negligible, < e^{−80} relative) truncation as the normalising constant.',
    'The upper tail is summed directly from k + 1 upwards.',
  ],
  closedFormQuantile: false,
  validateExtra: (p) => {
    const issue = comConvergenceIssue(p);
    return issue ? [issue] : [];
  },
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (k, p) => {
    if (!isInt(k) || k < 0) return -Infinity;
    return comLogTerm(k, p.lambda, p.nu) - comTable(p).logZ;
  },
  pdf: (k, p) => {
    const l = comPoisson.logPdf(k, p);
    return l === -Infinity ? 0 : Math.exp(l);
  },
  cdf: (x, p) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    const { cum } = comTable(p);
    if (k >= cum.length - 1) return 1;
    return Math.min(1, cum[k]);
  },
  sf: (x, p) => {
    const k = Math.floor(x);
    if (k < 0) return 1;
    const { probs } = comTable(p);
    if (k >= probs.length - 1) return 0;
    let acc = 0;
    for (let j = probs.length - 1; j > k; j--) acc += probs[j];
    return Math.min(1, acc);
  },
  quantile: (q, p) => {
    const { m1 } = comMoments(p);
    return invertDiscrete(q, (k) => comPoisson.cdf(k, p), (k) => comPoisson.sf(k, p), { min: 0, max: Infinity }, m1);
  },
  mean: (p) => defined(comMoments(p).m1),
  variance: (p) => defined(comMoments(p).central.variance),
  skewness: (p) => {
    const { central } = comMoments(p);
    return central.variance > 0
      ? defined(central.skewness)
      : undefinedMoment('The distribution is concentrated on a single value, so the skewness is undefined.');
  },
  excessKurtosis: (p) => {
    const { central } = comMoments(p);
    return central.variance > 0
      ? defined(central.excessKurtosis)
      : undefinedMoment('The distribution is concentrated on a single value, so the kurtosis is undefined.');
  },
  mode: (p) => {
    const { probs } = comTable(p);
    let best = 0;
    let bestP = -1;
    let tie = false;
    for (let k = 0; k < probs.length; k++) {
      if (probs[k] > bestP) {
        bestP = probs[k];
        best = k;
        tie = false;
      } else if (probs[k] === bestP) {
        tie = true;
      }
    }
    return tie ? undefinedMoment('Two values share the maximum probability, so the mode is not unique.') : defined(best);
  },
  sample: (rng: Random, p: Params) => rng.categorical(comTable(p).cum),
};

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export const EXTENDED_DISTRIBUTIONS: DistributionDef[] = [
  laplace,
  logistic,
  rayleigh,
  gumbel,
  frechet,
  fDistribution,
  inverseGaussian,
  betaPrime,
  erlang,
  nakagami,
  burr12,
  halfNormal,
  truncatedNormal,
  vonMises,
  levy,
  kumaraswamy,
  betaBinomial,
  zipf,
  skellam,
  logarithmic,
  yuleSimon,
  comPoisson,
];
