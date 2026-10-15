/**
 * Continuous probability distributions.
 *
 * For a continuous distribution the density f(x) is NOT the probability of
 * observing exactly x — that probability is 0. Probabilities come from
 * integrating the density over an interval: P(a < X ≤ b) = F(b) − F(a).
 */
import { gammaFn, incompleteBeta, incompleteGamma, logBeta, logGamma, normalCdf, normalQuantile } from '../special/gamma';
import { assertQuantileLevel, invertContinuous } from './inversion';
import { defined, undefinedMoment, type DistributionDef, type Params } from './types';

const LOG_SQRT_2PI = 0.9189385332046727;

export const uniform: DistributionDef = {
  id: 'uniform',
  name: 'Continuous uniform',
  kind: 'continuous',
  description: 'Every value between a and b is equally likely (constant density).',
  useCases: ['A random point on an interval', 'Complete ignorance within known bounds (as an assumption)'],
  formula: 'f(x) = 1 / (b − a)  for a ≤ x ≤ b',
  supportText: 'x ∈ [a, b]',
  params: [
    { key: 'a', label: 'Lower bound', symbol: 'a', description: 'Minimum value', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'b', label: 'Upper bound', symbol: 'b', description: 'Maximum value', defaultValue: 1, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 20, step: 0.1 },
  ],
  notes: [],
  validateExtra: ({ a, b }) => (b <= a ? [{ code: 'range', field: 'b', message: 'Upper bound (b) must be greater than lower bound (a).' }] : []),
  closedFormQuantile: true,
  support: ({ a, b }) => ({ min: a, max: b }),
  pdf: (x, { a, b }) => (x >= a && x <= b ? 1 / (b - a) : 0),
  logPdf: (x, prm) => Math.log(uniform.pdf(x, prm)),
  cdf: (x, { a, b }) => (x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a)),
  sf: (x, { a, b }) => (x <= a ? 1 : x >= b ? 0 : (b - x) / (b - a)),
  quantile: (q, { a, b }) => {
    assertQuantileLevel(q);
    return a + q * (b - a);
  },
  mean: ({ a, b }) => defined((a + b) / 2),
  variance: ({ a, b }) => defined(((b - a) * (b - a)) / 12),
  skewness: () => defined(0),
  excessKurtosis: () => defined(-6 / 5),
  mode: () => undefinedMoment('Every value in [a, b] has the same density.'),
  sample: (rng, { a, b }) => rng.uniformRange(a, b),
};

export const normal: DistributionDef = {
  id: 'normal',
  name: 'Normal (Gaussian)',
  kind: 'continuous',
  description: 'Symmetric bell-shaped distribution determined by its mean μ and standard deviation σ.',
  useCases: ['Measurement error', 'Sums of many small independent effects (central limit theorem)', 'Heights, test scores (approximately)'],
  formula: 'f(x) = (1 / (σ√(2π))) · exp(−(x − μ)² / (2σ²))',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'mu', label: 'Mean', symbol: 'μ', description: 'Centre of the distribution', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'sigma', label: 'Standard deviation', symbol: 'σ', description: 'Spread', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['Tail probabilities are computed with the complementary error function and remain accurate far from the mean.'],
  closedFormQuantile: true,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (x, { mu, sigma }) => {
    const z = (x - mu) / sigma;
    return -LOG_SQRT_2PI - Math.log(sigma) - 0.5 * z * z;
  },
  pdf: (x, prm) => Math.exp(normal.logPdf(x, prm)),
  cdf: (x, { mu, sigma }) => normalCdf((x - mu) / sigma),
  sf: (x, { mu, sigma }) => normalCdf((mu - x) / sigma),
  quantile: (q, { mu, sigma }) => {
    assertQuantileLevel(q);
    return mu + sigma * normalQuantile(q);
  },
  mean: ({ mu }) => defined(mu),
  variance: ({ sigma }) => defined(sigma * sigma),
  skewness: () => defined(0),
  excessKurtosis: () => defined(0),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { mu, sigma }) => mu + sigma * rng.normal(),
};

export const exponential: DistributionDef = {
  id: 'exponential',
  name: 'Exponential',
  kind: 'continuous',
  description: 'Waiting time until the next event in a process where events occur at a constant rate λ (memoryless).',
  useCases: ['Time between arrivals', 'Lifetime of components with a constant failure rate'],
  formula: 'f(x) = λ e^{−λx}  for x ≥ 0',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'lambda', label: 'Rate', symbol: 'λ', description: 'Events per unit time (mean = 1/λ)', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.05, sliderMax: 10, step: 0.05 },
  ],
  notes: ['Parameterised by rate λ; the mean waiting time is 1/λ.'],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { lambda }) => (x < 0 ? -Infinity : Math.log(lambda) - lambda * x),
  pdf: (x, prm) => (x < 0 ? 0 : Math.exp(exponential.logPdf(x, prm))),
  cdf: (x, { lambda }) => (x <= 0 ? 0 : -Math.expm1(-lambda * x)),
  sf: (x, { lambda }) => (x <= 0 ? 1 : Math.exp(-lambda * x)),
  quantile: (q, { lambda }) => {
    assertQuantileLevel(q);
    return q >= 1 ? Infinity : -Math.log1p(-q) / lambda;
  },
  mean: ({ lambda }) => defined(1 / lambda),
  variance: ({ lambda }) => defined(1 / (lambda * lambda)),
  skewness: () => defined(2),
  excessKurtosis: () => defined(6),
  mode: () => defined(0),
  sample: (rng, { lambda }) => rng.exponential(lambda),
};

const gammaGuess = (k: number, theta: number) => ({ center: k * theta, scale: Math.sqrt(k) * theta });

export const gamma: DistributionDef = {
  id: 'gamma',
  name: 'Gamma',
  kind: 'continuous',
  description: 'Waiting time until the k-th event of a constant-rate process; a flexible model for positive skewed quantities.',
  useCases: ['Total time for k sequential exponential stages', 'Insurance claim sizes', 'Rainfall amounts'],
  formula: 'f(x) = x^{k−1} e^{−x/θ} / (Γ(k) θᵏ)  for x > 0',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'k', label: 'Shape', symbol: 'k', description: 'Shape parameter', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 30, step: 0.1 },
    { key: 'theta', label: 'Scale', symbol: 'θ', description: 'Scale parameter (rate = 1/θ)', defaultValue: 2, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['Shape–scale parameterisation. With rate β, use θ = 1/β.'],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { k, theta }) => {
    if (x < 0) return -Infinity;
    if (x === 0) return k < 1 ? Infinity : k === 1 ? -Math.log(theta) : -Infinity;
    return (k - 1) * Math.log(x) - x / theta - logGamma(k) - k * Math.log(theta);
  },
  pdf: (x, prm) => Math.exp(gamma.logPdf(x, prm)),
  cdf: (x, { k, theta }) => (x <= 0 ? 0 : incompleteGamma(k, x / theta).lower),
  sf: (x, { k, theta }) => (x <= 0 ? 1 : incompleteGamma(k, x / theta).upper),
  quantile: (q, prm) =>
    invertContinuous(q, (x) => gamma.cdf(x, prm), (x) => gamma.sf(x, prm), { min: 0, max: Infinity }, gammaGuess(prm.k, prm.theta)),
  mean: ({ k, theta }) => defined(k * theta),
  variance: ({ k, theta }) => defined(k * theta * theta),
  skewness: ({ k }) => defined(2 / Math.sqrt(k)),
  excessKurtosis: ({ k }) => defined(6 / k),
  mode: ({ k, theta }) => (k >= 1 ? defined((k - 1) * theta) : undefinedMoment('Density is unbounded at 0 when k < 1.')),
  sample: (rng, { k, theta }) => rng.gamma(k) * theta,
};

function betaSkew(a: number, b: number) {
  return (2 * (b - a) * Math.sqrt(a + b + 1)) / ((a + b + 2) * Math.sqrt(a * b));
}
function betaKurt(a: number, b: number) {
  return (6 * ((a - b) ** 2 * (a + b + 1) - a * b * (a + b + 2))) / (a * b * (a + b + 2) * (a + b + 3));
}
function betaMode(a: number, b: number) {
  if (a > 1 && b > 1) return defined((a - 1) / (a + b - 2));
  if (a === 1 && b === 1) return undefinedMoment('Uniform on [0, 1]: every value is a mode.');
  if (a <= 1 && b > 1) return defined(0);
  if (a > 1 && b <= 1) return defined(1);
  return undefinedMoment('Bimodal at 0 and 1 (density unbounded at the ends).');
}

export const beta: DistributionDef = {
  id: 'beta',
  name: 'Beta',
  kind: 'continuous',
  description: 'Distribution on [0, 1], commonly used to represent uncertainty about a probability or proportion.',
  useCases: ['Uncertain success rate', 'Bayesian prior/posterior for a probability', 'Proportions'],
  formula: 'f(x) = x^{α−1} (1 − x)^{β−1} / B(α, β)',
  supportText: 'x ∈ [0, 1]',
  params: [
    { key: 'alpha', label: 'Shape α', symbol: 'α', description: 'First shape parameter', defaultValue: 2, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 30, step: 0.1 },
    { key: 'beta', label: 'Shape β', symbol: 'β', description: 'Second shape parameter', defaultValue: 5, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.1, sliderMax: 30, step: 0.1 },
  ],
  notes: ['When α < 1 or β < 1 the density is unbounded at the corresponding end of the interval.'],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: 1 }),
  logPdf: (x, { alpha, beta: b }) => {
    if (x < 0 || x > 1) return -Infinity;
    if (x === 0) return alpha < 1 ? Infinity : alpha === 1 ? -logBeta(alpha, b) : -Infinity;
    if (x === 1) return b < 1 ? Infinity : b === 1 ? -logBeta(alpha, b) : -Infinity;
    return (alpha - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - logBeta(alpha, b);
  },
  pdf: (x, prm) => Math.exp(beta.logPdf(x, prm)),
  cdf: (x, { alpha, beta: b }) => (x <= 0 ? 0 : x >= 1 ? 1 : incompleteBeta(x, alpha, b).lower),
  sf: (x, { alpha, beta: b }) => (x <= 0 ? 1 : x >= 1 ? 0 : incompleteBeta(x, alpha, b).upper),
  quantile: (q, prm) => {
    const m = prm.alpha / (prm.alpha + prm.beta);
    return invertContinuous(q, (x) => beta.cdf(x, prm), (x) => beta.sf(x, prm), { min: 0, max: 1 }, { center: m, scale: 0.1 });
  },
  mean: ({ alpha, beta: b }) => defined(alpha / (alpha + b)),
  variance: ({ alpha, beta: b }) => defined((alpha * b) / ((alpha + b) ** 2 * (alpha + b + 1))),
  skewness: ({ alpha, beta: b }) => defined(betaSkew(alpha, b)),
  excessKurtosis: ({ alpha, beta: b }) => defined(betaKurt(alpha, b)),
  mode: ({ alpha, beta: b }) => betaMode(alpha, b),
  sample: (rng, { alpha, beta: b }) => rng.beta(alpha, b),
};

export const lognormal: DistributionDef = {
  id: 'lognormal',
  name: 'Log-normal',
  kind: 'continuous',
  description: 'A positive quantity whose logarithm is normally distributed; arises from products of many positive factors.',
  useCases: ['Incomes and asset prices (approximately)', 'Task durations', 'Particle sizes'],
  formula: 'f(x) = (1 / (xσ√(2π))) · exp(−(ln x − μ)² / (2σ²))',
  supportText: 'x ∈ (0, ∞)',
  params: [
    { key: 'mu', label: 'Log-mean', symbol: 'μ', description: 'Mean of ln X', defaultValue: 0, min: -1e3, max: 1e3, sliderMin: -3, sliderMax: 5, step: 0.05 },
    { key: 'sigma', label: 'Log-standard deviation', symbol: 'σ', description: 'Standard deviation of ln X', defaultValue: 0.5, min: 0, minExclusive: true, max: 50, sliderMin: 0.05, sliderMax: 3, step: 0.05 },
  ],
  notes: ['μ and σ are the mean and standard deviation of ln X, not of X itself.'],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { mu, sigma }) => {
    if (x <= 0) return -Infinity;
    const z = (Math.log(x) - mu) / sigma;
    return -LOG_SQRT_2PI - Math.log(sigma) - Math.log(x) - 0.5 * z * z;
  },
  pdf: (x, prm) => (x <= 0 ? 0 : Math.exp(lognormal.logPdf(x, prm))),
  cdf: (x, { mu, sigma }) => (x <= 0 ? 0 : normalCdf((Math.log(x) - mu) / sigma)),
  sf: (x, { mu, sigma }) => (x <= 0 ? 1 : normalCdf((mu - Math.log(x)) / sigma)),
  quantile: (q, { mu, sigma }) => {
    assertQuantileLevel(q);
    return Math.exp(mu + sigma * normalQuantile(q));
  },
  mean: ({ mu, sigma }) => defined(Math.exp(mu + (sigma * sigma) / 2)),
  variance: ({ mu, sigma }) => defined(Math.expm1(sigma * sigma) * Math.exp(2 * mu + sigma * sigma)),
  skewness: ({ sigma }) => defined((Math.exp(sigma * sigma) + 2) * Math.sqrt(Math.expm1(sigma * sigma))),
  excessKurtosis: ({ sigma }) => {
    const s2 = sigma * sigma;
    return defined(Math.exp(4 * s2) + 2 * Math.exp(3 * s2) + 3 * Math.exp(2 * s2) - 6);
  },
  mode: ({ mu, sigma }) => defined(Math.exp(mu - sigma * sigma)),
  sample: (rng, { mu, sigma }) => Math.exp(mu + sigma * rng.normal()),
};

export const weibull: DistributionDef = {
  id: 'weibull',
  name: 'Weibull',
  kind: 'continuous',
  description: 'Flexible lifetime distribution; shape k < 1 gives a decreasing failure rate, k > 1 an increasing one.',
  useCases: ['Component lifetimes', 'Wind speeds', 'Time to failure'],
  formula: 'f(x) = (k/λ)(x/λ)^{k−1} e^{−(x/λ)ᵏ}  for x ≥ 0',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'k', label: 'Shape', symbol: 'k', description: 'Shape parameter', defaultValue: 1.5, min: 0, minExclusive: true, max: 1e3, sliderMin: 0.2, sliderMax: 10, step: 0.1 },
    { key: 'lambda', label: 'Scale', symbol: 'λ', description: 'Scale parameter', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: [],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { k, lambda }) => {
    if (x < 0) return -Infinity;
    if (x === 0) return k < 1 ? Infinity : k === 1 ? -Math.log(lambda) : -Infinity;
    const z = x / lambda;
    return Math.log(k / lambda) + (k - 1) * Math.log(z) - Math.pow(z, k);
  },
  pdf: (x, prm) => Math.exp(weibull.logPdf(x, prm)),
  cdf: (x, { k, lambda }) => (x <= 0 ? 0 : -Math.expm1(-Math.pow(x / lambda, k))),
  sf: (x, { k, lambda }) => (x <= 0 ? 1 : Math.exp(-Math.pow(x / lambda, k))),
  quantile: (q, { k, lambda }) => {
    assertQuantileLevel(q);
    return q >= 1 ? Infinity : lambda * Math.pow(-Math.log1p(-q), 1 / k);
  },
  mean: ({ k, lambda }) => defined(lambda * gammaFn(1 + 1 / k)),
  variance: ({ k, lambda }) => defined(lambda * lambda * (gammaFn(1 + 2 / k) - gammaFn(1 + 1 / k) ** 2)),
  skewness: ({ k }) => {
    const g1 = gammaFn(1 + 1 / k);
    const g2 = gammaFn(1 + 2 / k);
    const g3 = gammaFn(1 + 3 / k);
    return defined((g3 - 3 * g1 * g2 + 2 * g1 ** 3) / Math.pow(g2 - g1 * g1, 1.5));
  },
  excessKurtosis: ({ k }) => {
    const g1 = gammaFn(1 + 1 / k);
    const g2 = gammaFn(1 + 2 / k);
    const g3 = gammaFn(1 + 3 / k);
    const g4 = gammaFn(1 + 4 / k);
    return defined((-6 * g1 ** 4 + 12 * g1 * g1 * g2 - 3 * g2 * g2 - 4 * g1 * g3 + g4) / (g2 - g1 * g1) ** 2);
  },
  mode: ({ k, lambda }) => (k > 1 ? defined(lambda * Math.pow((k - 1) / k, 1 / k)) : defined(0)),
  sample: (rng, { k, lambda }) => lambda * Math.pow(-Math.log(rng.uniformOpen()), 1 / k),
};

function tStandardTails(t: number, nu: number): { lower: number; upper: number } {
  // P(T ≤ t) for the standard t distribution with ν degrees of freedom.
  if (t === 0) return { lower: 0.5, upper: 0.5 };
  const t2 = t * t;
  let tail: number; // P(|T| > |t|) / 2 ... computed as P(T > |t|)
  if (t2 < nu) {
    // Use y = t²/(ν + t²) to avoid rounding of x = ν/(ν+t²) near 1.
    const y = t2 / (nu + t2);
    tail = 0.5 * incompleteBeta(y, 0.5, nu / 2).upper;
  } else {
    const x = nu / (nu + t2);
    tail = 0.5 * incompleteBeta(x, nu / 2, 0.5).lower;
  }
  return t > 0 ? { lower: 1 - tail, upper: tail } : { lower: tail, upper: 1 - tail };
}

export const studentT: DistributionDef = {
  id: 'studentT',
  name: "Student's t",
  kind: 'continuous',
  description: 'Symmetric bell-shaped distribution with heavier tails than the normal; used for inference with estimated variance.',
  useCases: ['Confidence intervals for a mean with unknown variance', 'Heavy-tailed measurement noise'],
  formula: 'f(t) = Γ((ν+1)/2) / (√(νπ) Γ(ν/2)) · (1 + t²/ν)^{−(ν+1)/2}',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'nu', label: 'Degrees of freedom', symbol: 'ν', description: 'Degrees of freedom', defaultValue: 5, min: 0, minExclusive: true, max: 1e7, sliderMin: 0.5, sliderMax: 60, step: 0.5 },
    { key: 'mu', label: 'Location', symbol: 'μ', description: 'Centre (0 for the standard t)', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'sigma', label: 'Scale', symbol: 's', description: 'Scale (1 for the standard t)', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['Location–scale form: X = μ + s·T where T has the standard t distribution with ν degrees of freedom.', 'The mean is undefined for ν ≤ 1 and the variance is infinite for 1 < ν ≤ 2.'],
  closedFormQuantile: false,
  support: () => ({ min: -Infinity, max: Infinity }),
  logPdf: (x, { nu, mu, sigma }) => {
    const t = (x - mu) / sigma;
    return logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(sigma) - ((nu + 1) / 2) * Math.log1p((t * t) / nu);
  },
  pdf: (x, prm) => Math.exp(studentT.logPdf(x, prm)),
  cdf: (x, { nu, mu, sigma }) => tStandardTails((x - mu) / sigma, nu).lower,
  sf: (x, { nu, mu, sigma }) => tStandardTails((x - mu) / sigma, nu).upper,
  quantile: (q, prm) => {
    if (q === 0.5) return prm.mu;
    const scale = prm.nu > 2 ? prm.sigma * Math.sqrt(prm.nu / (prm.nu - 2)) : prm.sigma * 2;
    return invertContinuous(q, (x) => studentT.cdf(x, prm), (x) => studentT.sf(x, prm), { min: -Infinity, max: Infinity }, { center: prm.mu, scale });
  },
  mean: ({ nu, mu }) => (nu > 1 ? defined(mu) : undefinedMoment('The mean is undefined for ν ≤ 1.')),
  variance: ({ nu, sigma }) =>
    nu > 2 ? defined((sigma * sigma * nu) / (nu - 2)) : nu > 1 ? defined(Infinity) : undefinedMoment('The variance is undefined for ν ≤ 1.'),
  skewness: ({ nu }) => (nu > 3 ? defined(0) : undefinedMoment('Skewness is undefined for ν ≤ 3.')),
  excessKurtosis: ({ nu }) =>
    nu > 4 ? defined(6 / (nu - 4)) : nu > 2 ? defined(Infinity) : undefinedMoment('Kurtosis is undefined for ν ≤ 2.'),
  mode: ({ mu }) => defined(mu),
  sample: (rng, { nu, mu, sigma }) => mu + sigma * (rng.normal() / Math.sqrt((2 * rng.gamma(nu / 2)) / nu)),
};

export const chiSquare: DistributionDef = {
  id: 'chiSquare',
  name: 'Chi-square',
  kind: 'continuous',
  description: 'Distribution of a sum of k squared independent standard normal variables.',
  useCases: ['Goodness-of-fit tests', 'Variance estimates from normal samples', 'Contingency tables'],
  formula: 'f(x) = x^{k/2−1} e^{−x/2} / (2^{k/2} Γ(k/2))',
  supportText: 'x ∈ [0, ∞)',
  params: [
    { key: 'k', label: 'Degrees of freedom', symbol: 'k', description: 'Degrees of freedom', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 0.5, sliderMax: 60, step: 0.5 },
  ],
  notes: ['Equivalent to Gamma(shape = k/2, scale = 2).'],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (x, { k }) => gamma.logPdf(x, { k: k / 2, theta: 2 }),
  pdf: (x, { k }) => gamma.pdf(x, { k: k / 2, theta: 2 }),
  cdf: (x, { k }) => gamma.cdf(x, { k: k / 2, theta: 2 }),
  sf: (x, { k }) => gamma.sf(x, { k: k / 2, theta: 2 }),
  quantile: (q, { k }) => gamma.quantile(q, { k: k / 2, theta: 2 }),
  mean: ({ k }) => defined(k),
  variance: ({ k }) => defined(2 * k),
  skewness: ({ k }) => defined(Math.sqrt(8 / k)),
  excessKurtosis: ({ k }) => defined(12 / k),
  mode: ({ k }) => (k >= 2 ? defined(k - 2) : undefinedMoment('Density is unbounded at 0 when k < 2.')),
  sample: (rng, { k }) => 2 * rng.gamma(k / 2),
};

export const triangular: DistributionDef = {
  id: 'triangular',
  name: 'Triangular',
  kind: 'continuous',
  description: 'Defined by a minimum, most likely value and maximum; a common way to encode expert three-point estimates.',
  useCases: ['Task duration estimates', 'Cost estimates with min / likely / max'],
  formula: 'f(x) = 2(x − a)/((b − a)(c − a)) for a ≤ x < c;  2(b − x)/((b − a)(b − c)) for c ≤ x ≤ b',
  supportText: 'x ∈ [a, b]',
  params: [
    { key: 'a', label: 'Minimum', symbol: 'a', description: 'Lowest possible value', defaultValue: 2, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 30, step: 0.5 },
    { key: 'c', label: 'Most likely', symbol: 'c', description: 'Mode', defaultValue: 4, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 30, step: 0.5 },
    { key: 'b', label: 'Maximum', symbol: 'b', description: 'Highest possible value', defaultValue: 9, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 40, step: 0.5 },
  ],
  notes: ['A subjective modelling choice: it assigns zero probability outside [a, b].'],
  validateExtra: ({ a, b, c }) => {
    if (!(b > a)) return [{ code: 'range', field: 'b', message: 'Maximum must be greater than minimum.' }];
    if (c < a || c > b) return [{ code: 'range', field: 'c', message: 'Most likely value must lie between minimum and maximum.' }];
    return [];
  },
  closedFormQuantile: true,
  support: ({ a, b }) => ({ min: a, max: b }),
  pdf: (x, { a, b, c }) => {
    if (x < a || x > b) return 0;
    if (x < c) return (2 * (x - a)) / ((b - a) * (c - a));
    if (x === c) return 2 / (b - a);
    return (2 * (b - x)) / ((b - a) * (b - c));
  },
  logPdf: (x, prm) => Math.log(triangular.pdf(x, prm)),
  cdf: (x, { a, b, c }) => {
    if (x <= a) return 0;
    if (x >= b) return 1;
    if (x <= c) return ((x - a) * (x - a)) / ((b - a) * (c - a));
    return 1 - ((b - x) * (b - x)) / ((b - a) * (b - c));
  },
  sf: (x, { a, b, c }) => {
    if (x <= a) return 1;
    if (x >= b) return 0;
    if (x <= c) return 1 - ((x - a) * (x - a)) / ((b - a) * (c - a));
    return ((b - x) * (b - x)) / ((b - a) * (b - c));
  },
  quantile: (q, { a, b, c }) => {
    assertQuantileLevel(q);
    const fc = (c - a) / (b - a);
    return q < fc ? a + Math.sqrt(q * (b - a) * (c - a)) : b - Math.sqrt((1 - q) * (b - a) * (b - c));
  },
  mean: ({ a, b, c }) => defined((a + b + c) / 3),
  variance: ({ a, b, c }) => defined((a * a + b * b + c * c - a * b - a * c - b * c) / 18),
  skewness: ({ a, b, c }) => {
    const d = a * a + b * b + c * c - a * b - a * c - b * c;
    return defined((Math.SQRT2 * (a + b - 2 * c) * (2 * a - b - c) * (a - 2 * b + c)) / (5 * Math.pow(d, 1.5)));
  },
  excessKurtosis: () => defined(-3 / 5),
  mode: ({ c }) => defined(c),
  sample: (rng, prm) => triangular.quantile(rng.uniform(), prm),
};

function pertShape({ a, m, b }: Params) {
  return { alpha: 1 + (4 * (m - a)) / (b - a), beta: 1 + (4 * (b - m)) / (b - a) };
}

export const pert: DistributionDef = {
  id: 'pert',
  name: 'PERT (beta-PERT)',
  kind: 'continuous',
  description: 'A smooth three-point estimate distribution (min, most likely, max) based on a scaled beta distribution.',
  useCases: ['Project task durations', 'Expert estimates where extremes are less likely than under a triangular model'],
  formula: 'X = a + (b − a)·Y,  Y ~ Beta(1 + 4(m − a)/(b − a), 1 + 4(b − m)/(b − a))',
  supportText: 'x ∈ [a, b]',
  params: [
    { key: 'a', label: 'Minimum', symbol: 'a', description: 'Optimistic value', defaultValue: 2, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 30, step: 0.5 },
    { key: 'm', label: 'Most likely', symbol: 'm', description: 'Mode', defaultValue: 4, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 30, step: 0.5 },
    { key: 'b', label: 'Maximum', symbol: 'b', description: 'Pessimistic value', defaultValue: 9, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 40, step: 0.5 },
  ],
  notes: ['Uses the standard PERT weighting λ = 4, giving mean (a + 4m + b) / 6.'],
  validateExtra: ({ a, b, m }) => {
    if (!(b > a)) return [{ code: 'range', field: 'b', message: 'Maximum must be greater than minimum.' }];
    if (m < a || m > b) return [{ code: 'range', field: 'm', message: 'Most likely value must lie between minimum and maximum.' }];
    return [];
  },
  closedFormQuantile: false,
  support: ({ a, b }) => ({ min: a, max: b }),
  logPdf: (x, prm) => beta.logPdf((x - prm.a) / (prm.b - prm.a), pertShape(prm)) - Math.log(prm.b - prm.a),
  pdf: (x, prm) => (x < prm.a || x > prm.b ? 0 : Math.exp(pert.logPdf(x, prm))),
  cdf: (x, prm) => beta.cdf((x - prm.a) / (prm.b - prm.a), pertShape(prm)),
  sf: (x, prm) => beta.sf((x - prm.a) / (prm.b - prm.a), pertShape(prm)),
  quantile: (q, prm) => prm.a + (prm.b - prm.a) * beta.quantile(q, pertShape(prm)),
  mean: ({ a, m, b }) => defined((a + 4 * m + b) / 6),
  variance: (prm) => {
    const { alpha, beta: bb } = pertShape(prm);
    return defined((prm.b - prm.a) ** 2 * ((alpha * bb) / ((alpha + bb) ** 2 * (alpha + bb + 1))));
  },
  skewness: (prm) => {
    const s = pertShape(prm);
    return defined(betaSkew(s.alpha, s.beta));
  },
  excessKurtosis: (prm) => {
    const s = pertShape(prm);
    return defined(betaKurt(s.alpha, s.beta));
  },
  mode: ({ m }) => defined(m),
  sample: (rng, prm) => {
    const s = pertShape(prm);
    return prm.a + (prm.b - prm.a) * rng.beta(s.alpha, s.beta);
  },
};

export const cauchy: DistributionDef = {
  id: 'cauchy',
  name: 'Cauchy',
  kind: 'continuous',
  description: 'Extremely heavy-tailed symmetric distribution with no defined mean or variance.',
  useCases: ['Demonstrating when averages fail to converge', 'Resonance line shapes in physics'],
  formula: 'f(x) = 1 / (πγ[1 + ((x − x₀)/γ)²])',
  supportText: 'x ∈ (−∞, ∞)',
  params: [
    { key: 'x0', label: 'Location', symbol: 'x₀', description: 'Median and mode', defaultValue: 0, min: -1e12, max: 1e12, sliderMin: -10, sliderMax: 10, step: 0.1 },
    { key: 'gamma', label: 'Scale', symbol: 'γ', description: 'Half-width at half-maximum', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
  ],
  notes: ['The sample mean of Cauchy data does not converge as the sample grows — the law of large numbers does not apply.'],
  closedFormQuantile: true,
  support: () => ({ min: -Infinity, max: Infinity }),
  pdf: (x, { x0, gamma: g }) => 1 / (Math.PI * g * (1 + ((x - x0) / g) ** 2)),
  logPdf: (x, prm) => Math.log(cauchy.pdf(x, prm)),
  cdf: (x, { x0, gamma: g }) => {
    const z = (x - x0) / g;
    return z < -1 ? Math.atan(-1 / z) / Math.PI : 0.5 + Math.atan(z) / Math.PI;
  },
  sf: (x, { x0, gamma: g }) => {
    const z = (x - x0) / g;
    return z > 1 ? Math.atan(1 / z) / Math.PI : 0.5 - Math.atan(z) / Math.PI;
  },
  quantile: (q, { x0, gamma: g }) => {
    assertQuantileLevel(q);
    if (q === 0) return -Infinity;
    if (q === 1) return Infinity;
    // Use the reflected forms in the tails so the result keeps relative precision.
    if (q < 0.25) return x0 - g / Math.tan(Math.PI * q);
    if (q > 0.75) return x0 + g / Math.tan(Math.PI * (1 - q));
    return x0 + g * Math.tan(Math.PI * (q - 0.5));
  },
  mean: () => undefinedMoment('The Cauchy distribution has no mean.'),
  variance: () => undefinedMoment('The Cauchy distribution has no variance.'),
  skewness: () => undefinedMoment('Undefined for the Cauchy distribution.'),
  excessKurtosis: () => undefinedMoment('Undefined for the Cauchy distribution.'),
  mode: ({ x0 }) => defined(x0),
  sample: (rng, { x0, gamma: g }) => x0 + g * Math.tan(Math.PI * (rng.uniformOpen() - 0.5)),
};

export const pareto: DistributionDef = {
  id: 'pareto',
  name: 'Pareto',
  kind: 'continuous',
  description: 'Power-law tail distribution: large values are rare but far more likely than under thin-tailed models.',
  useCases: ['Large insurance losses', 'City or firm sizes', 'Heavy-tailed risk modelling'],
  formula: 'f(x) = α x_mᵅ / x^{α+1}  for x ≥ x_m',
  supportText: 'x ∈ [x_m, ∞)',
  params: [
    { key: 'xm', label: 'Minimum (scale)', symbol: 'x_m', description: 'Smallest possible value', defaultValue: 1, min: 0, minExclusive: true, max: 1e12, sliderMin: 0.1, sliderMax: 10, step: 0.1 },
    { key: 'alpha', label: 'Tail index', symbol: 'α', description: 'Smaller α means a heavier tail', defaultValue: 2.5, min: 0, minExclusive: true, max: 1e3, sliderMin: 0.2, sliderMax: 10, step: 0.1 },
  ],
  notes: ['The mean is infinite for α ≤ 1 and the variance is infinite for α ≤ 2.'],
  closedFormQuantile: true,
  support: ({ xm }) => ({ min: xm, max: Infinity }),
  logPdf: (x, { xm, alpha }) => (x < xm ? -Infinity : Math.log(alpha) + alpha * Math.log(xm) - (alpha + 1) * Math.log(x)),
  pdf: (x, prm) => (x < prm.xm ? 0 : Math.exp(pareto.logPdf(x, prm))),
  cdf: (x, { xm, alpha }) => (x <= xm ? 0 : -Math.expm1(alpha * Math.log(xm / x))),
  sf: (x, { xm, alpha }) => (x <= xm ? 1 : Math.exp(alpha * Math.log(xm / x))),
  quantile: (q, { xm, alpha }) => {
    assertQuantileLevel(q);
    return q >= 1 ? Infinity : xm * Math.exp(-Math.log1p(-q) / alpha);
  },
  mean: ({ xm, alpha }) => (alpha > 1 ? defined((alpha * xm) / (alpha - 1)) : defined(Infinity)),
  variance: ({ xm, alpha }) =>
    alpha > 2 ? defined((xm * xm * alpha) / ((alpha - 1) ** 2 * (alpha - 2))) : alpha > 1 ? defined(Infinity) : undefinedMoment('Undefined when the mean is infinite (α ≤ 1).'),
  skewness: ({ alpha }) =>
    alpha > 3 ? defined(((2 * (1 + alpha)) / (alpha - 3)) * Math.sqrt((alpha - 2) / alpha)) : undefinedMoment('Skewness is undefined for α ≤ 3.'),
  excessKurtosis: ({ alpha }) =>
    alpha > 4
      ? defined((6 * (alpha ** 3 + alpha ** 2 - 6 * alpha - 2)) / (alpha * (alpha - 3) * (alpha - 4)))
      : undefinedMoment('Kurtosis is undefined for α ≤ 4.'),
  mode: ({ xm }) => defined(xm),
  sample: (rng, { xm, alpha }) => xm * Math.pow(rng.uniformOpen(), -1 / alpha),
};

export const CONTINUOUS_DISTRIBUTIONS: DistributionDef[] = [
  uniform,
  normal,
  exponential,
  gamma,
  beta,
  lognormal,
  weibull,
  studentT,
  chiSquare,
  triangular,
  pert,
  cauchy,
  pareto,
];
