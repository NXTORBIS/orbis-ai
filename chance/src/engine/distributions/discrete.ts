/**
 * Discrete probability distributions.
 *
 * CDFs use the incomplete beta / gamma identities rather than summing the pmf,
 * so they remain accurate and fast for large parameters:
 *   Binomial:      P(X ≤ k) = I_{1−p}(n − k, k + 1)
 *   Poisson:       P(X ≤ k) = Q(k + 1, λ)
 *   Neg. binomial: P(X ≤ k) = I_p(r, k + 1)
 */
import { incompleteBeta, incompleteGamma, logChoose, logFactorial } from '../special/gamma';
import { assertQuantileLevel, invertDiscrete } from './inversion';
import { defined, undefinedMoment, type DistributionDef, type Params } from './types';

const isInt = (x: number) => Number.isInteger(x);

function expOrZero(logv: number): number {
  return logv === -Infinity ? 0 : Math.exp(logv);
}

export const bernoulli: DistributionDef = {
  id: 'bernoulli',
  name: 'Bernoulli',
  kind: 'discrete',
  description: 'A single trial with two outcomes: success (1) with probability p, failure (0) otherwise.',
  useCases: ['One coin toss', 'Whether a single event occurs'],
  formula: 'P(X = 1) = p,  P(X = 0) = 1 − p',
  supportText: 'k ∈ {0, 1}',
  params: [
    { key: 'p', label: 'Success probability', symbol: 'p', description: 'Probability of success', defaultValue: 0.5, min: 0, max: 1, sliderMin: 0, sliderMax: 1, step: 0.01 },
  ],
  notes: [],
  closedFormQuantile: true,
  support: () => ({ min: 0, max: 1 }),
  pdf: (x, { p }) => (x === 1 ? p : x === 0 ? 1 - p : 0),
  logPdf: (x, prm) => Math.log(bernoulli.pdf(x, prm)),
  cdf: (x, { p }) => (x < 0 ? 0 : x < 1 ? 1 - p : 1),
  sf: (x, { p }) => (x < 0 ? 1 : x < 1 ? p : 0),
  quantile: (q, { p }) => {
    assertQuantileLevel(q);
    return q <= 1 - p ? 0 : 1;
  },
  mean: ({ p }) => defined(p),
  variance: ({ p }) => defined(p * (1 - p)),
  skewness: ({ p }) =>
    p === 0 || p === 1 ? undefinedMoment('Undefined when p is 0 or 1 (zero variance).') : defined((1 - 2 * p) / Math.sqrt(p * (1 - p))),
  excessKurtosis: ({ p }) =>
    p === 0 || p === 1 ? undefinedMoment('Undefined when p is 0 or 1 (zero variance).') : defined((1 - 6 * p * (1 - p)) / (p * (1 - p))),
  mode: ({ p }) => (p === 0.5 ? undefinedMoment('Both 0 and 1 are modes when p = 0.5.') : defined(p > 0.5 ? 1 : 0)),
  sample: (rng, { p }) => (rng.bernoulli(p) ? 1 : 0),
};

function binomLogPmf(k: number, n: number, p: number): number {
  if (!isInt(k) || k < 0 || k > n) return -Infinity;
  if (p === 0) return k === 0 ? 0 : -Infinity;
  if (p === 1) return k === n ? 0 : -Infinity;
  return logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p);
}

export const binomial: DistributionDef = {
  id: 'binomial',
  name: 'Binomial',
  kind: 'discrete',
  description: 'Number of successes in n independent trials, each succeeding with the same probability p.',
  useCases: ['Heads in n coin tosses', 'Defective items in a batch (sampling with replacement)', 'Successes across repeated attempts'],
  formula: 'P(X = k) = C(n, k) · pᵏ · (1 − p)ⁿ⁻ᵏ',
  supportText: 'k ∈ {0, 1, …, n}',
  params: [
    { key: 'n', label: 'Number of trials', symbol: 'n', description: 'Independent trials', defaultValue: 10, min: 0, max: 10_000_000, integer: true, sliderMin: 1, sliderMax: 200, step: 1 },
    { key: 'p', label: 'Success probability', symbol: 'p', description: 'Probability of success per trial', defaultValue: 0.5, min: 0, max: 1, sliderMin: 0, sliderMax: 1, step: 0.01 },
  ],
  notes: ['Assumes trials are independent and p is identical for every trial.'],
  closedFormQuantile: false,
  support: ({ n }) => ({ min: 0, max: n }),
  pdf: (k, { n, p }) => expOrZero(binomLogPmf(k, n, p)),
  logPdf: (k, { n, p }) => binomLogPmf(k, n, p),
  cdf: (x, { n, p }) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    if (k >= n) return 1;
    if (p === 0) return 1;
    if (p === 1) return 0;
    return incompleteBeta(1 - p, n - k, k + 1).lower;
  },
  sf: (x, { n, p }) => {
    const k = Math.floor(x);
    if (k < 0) return 1;
    if (k >= n) return 0;
    if (p === 0) return 0;
    if (p === 1) return 1;
    return incompleteBeta(1 - p, n - k, k + 1).upper;
  },
  quantile: (q, prm) =>
    invertDiscrete(q, (k) => binomial.cdf(k, prm), (k) => binomial.sf(k, prm), { min: 0, max: prm.n }, Math.floor(prm.n * prm.p)),
  mean: ({ n, p }) => defined(n * p),
  variance: ({ n, p }) => defined(n * p * (1 - p)),
  skewness: ({ n, p }) =>
    n * p * (1 - p) === 0 ? undefinedMoment('Undefined when the variance is zero.') : defined((1 - 2 * p) / Math.sqrt(n * p * (1 - p))),
  excessKurtosis: ({ n, p }) =>
    n * p * (1 - p) === 0
      ? undefinedMoment('Undefined when the variance is zero.')
      : defined((1 - 6 * p * (1 - p)) / (n * p * (1 - p))),
  mode: ({ n, p }) => {
    const m = (n + 1) * p;
    if (isInt(m) && p > 0 && p < 1) return undefinedMoment(`Two modes: ${m - 1} and ${m}.`);
    return defined(Math.min(n, Math.floor(m)));
  },
  sample: (rng, { n, p }) => rng.binomial(n, p),
};

export const geometric: DistributionDef = {
  id: 'geometric',
  name: 'Geometric',
  kind: 'discrete',
  description: 'Number of independent trials needed to obtain the first success (counting the successful trial).',
  useCases: ['Attempts until the first success', 'Rolls until a six appears'],
  formula: 'P(X = k) = (1 − p)ᵏ⁻¹ · p',
  supportText: 'k ∈ {1, 2, 3, …}',
  params: [
    { key: 'p', label: 'Success probability', symbol: 'p', description: 'Probability of success per trial', defaultValue: 0.2, min: 0, minExclusive: true, max: 1, sliderMin: 0.01, sliderMax: 1, step: 0.01 },
  ],
  notes: ['Convention: X counts trials including the first success (support starts at 1). The number of failures before the first success is X − 1.'],
  closedFormQuantile: true,
  support: () => ({ min: 1, max: Infinity }),
  logPdf: (k, { p }) => {
    if (!isInt(k) || k < 1) return -Infinity;
    if (p === 1) return k === 1 ? 0 : -Infinity;
    return (k - 1) * Math.log1p(-p) + Math.log(p);
  },
  pdf: (k, prm) => expOrZero(geometric.logPdf(k, prm)),
  cdf: (x, { p }) => {
    const k = Math.floor(x);
    if (k < 1) return 0;
    return -Math.expm1(k * Math.log1p(-p));
  },
  sf: (x, { p }) => {
    const k = Math.floor(x);
    if (k < 1) return 1;
    if (p === 1) return 0;
    return Math.exp(k * Math.log1p(-p));
  },
  quantile: (q, prm) => {
    assertQuantileLevel(q);
    const { p } = prm;
    if (q <= 0) return 1;
    if (q >= 1) return p === 1 ? 1 : Infinity;
    if (p === 1) return 1;
    const guess = Math.max(1, Math.ceil(Math.log1p(-q) / Math.log1p(-p)));
    return invertDiscrete(q, (k) => geometric.cdf(k, prm), (k) => geometric.sf(k, prm), { min: 1, max: Infinity }, Math.max(1, guess - 1));
  },
  mean: ({ p }) => defined(1 / p),
  variance: ({ p }) => defined((1 - p) / (p * p)),
  skewness: ({ p }) => (p === 1 ? undefinedMoment('Undefined when p = 1 (zero variance).') : defined((2 - p) / Math.sqrt(1 - p))),
  excessKurtosis: ({ p }) => (p === 1 ? undefinedMoment('Undefined when p = 1 (zero variance).') : defined(6 + (p * p) / (1 - p))),
  mode: () => defined(1),
  sample: (rng, { p }) => rng.geometricFailures(p) + 1,
};

function negBinLogPmf(k: number, r: number, p: number): number {
  if (!isInt(k) || k < 0) return -Infinity;
  if (p === 1) return k === 0 ? 0 : -Infinity;
  // C(k + r − 1, k) generalised via log-gamma so r may be non-integer.
  return logChoose(k + r - 1, k) + r * Math.log(p) + k * Math.log1p(-p);
}

export const negativeBinomial: DistributionDef = {
  id: 'negativeBinomial',
  name: 'Negative binomial',
  kind: 'discrete',
  description: 'Number of failures observed before the r-th success in independent trials with success probability p.',
  useCases: ['Failures before reaching a target number of successes', 'Over-dispersed count data'],
  formula: 'P(X = k) = C(k + r − 1, k) · pʳ · (1 − p)ᵏ',
  supportText: 'k ∈ {0, 1, 2, …}',
  params: [
    { key: 'r', label: 'Target successes', symbol: 'r', description: 'Number of successes required (may be non-integer in the generalised form)', defaultValue: 3, min: 0, minExclusive: true, max: 1e6, sliderMin: 1, sliderMax: 50, step: 1 },
    { key: 'p', label: 'Success probability', symbol: 'p', description: 'Probability of success per trial', defaultValue: 0.4, min: 0, minExclusive: true, max: 1, sliderMin: 0.01, sliderMax: 1, step: 0.01 },
  ],
  notes: ['Convention: X counts failures (not total trials). Total trials = X + r.'],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (k, { r, p }) => negBinLogPmf(k, r, p),
  pdf: (k, { r, p }) => expOrZero(negBinLogPmf(k, r, p)),
  cdf: (x, { r, p }) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    if (p === 1) return 1;
    return incompleteBeta(p, r, k + 1).lower;
  },
  sf: (x, { r, p }) => {
    const k = Math.floor(x);
    if (k < 0) return 1;
    if (p === 1) return 0;
    return incompleteBeta(p, r, k + 1).upper;
  },
  quantile: (q, prm) =>
    invertDiscrete(q, (k) => negativeBinomial.cdf(k, prm), (k) => negativeBinomial.sf(k, prm), { min: 0, max: Infinity }, Math.floor((prm.r * (1 - prm.p)) / prm.p)),
  mean: ({ r, p }) => defined((r * (1 - p)) / p),
  variance: ({ r, p }) => defined((r * (1 - p)) / (p * p)),
  skewness: ({ r, p }) => (p === 1 ? undefinedMoment('Undefined when p = 1.') : defined((2 - p) / Math.sqrt(r * (1 - p)))),
  excessKurtosis: ({ r, p }) => (p === 1 ? undefinedMoment('Undefined when p = 1.') : defined(6 / r + (p * p) / (r * (1 - p)))),
  mode: ({ r, p }) => defined(r > 1 ? Math.floor(((r - 1) * (1 - p)) / p) : 0),
  sample: (rng, { r, p }) => {
    // Gamma–Poisson mixture: X ~ Poisson(Λ), Λ ~ Gamma(r, (1−p)/p).
    if (p === 1) return 0;
    return rng.poisson(rng.gamma(r) * ((1 - p) / p));
  },
};

function hyperLogPmf(k: number, N: number, K: number, n: number): number {
  if (!isInt(k)) return -Infinity;
  const lo = Math.max(0, n + K - N);
  const hi = Math.min(n, K);
  if (k < lo || k > hi) return -Infinity;
  return logChoose(K, k) + logChoose(N - K, n - k) - logChoose(N, n);
}

function hyperCdfSum(x: number, prm: Params, upper: boolean): number {
  const { N, K, n } = prm;
  const lo = Math.max(0, n + K - N);
  const hi = Math.min(n, K);
  const k = Math.floor(x);
  if (k < lo) return upper ? 1 : 0;
  if (k >= hi) return upper ? 0 : 1;
  // Sum the shorter side for accuracy.
  let s = 0;
  if (!upper) for (let i = lo; i <= k; i++) s += Math.exp(hyperLogPmf(i, N, K, n));
  else for (let i = k + 1; i <= hi; i++) s += Math.exp(hyperLogPmf(i, N, K, n));
  return Math.min(1, s);
}

export const hypergeometric: DistributionDef = {
  id: 'hypergeometric',
  name: 'Hypergeometric',
  kind: 'discrete',
  description: 'Number of successes in n draws without replacement from a population of N items containing K successes.',
  useCases: ['Aces in a poker hand', 'Defective items in a sample taken without replacement', 'Lottery matches'],
  formula: 'P(X = k) = C(K, k) · C(N − K, n − k) / C(N, n)',
  supportText: 'k ∈ {max(0, n + K − N), …, min(n, K)}',
  params: [
    { key: 'N', label: 'Population size', symbol: 'N', description: 'Total items', defaultValue: 52, min: 1, max: 1_000_000, integer: true, sliderMin: 1, sliderMax: 200, step: 1 },
    { key: 'K', label: 'Successes in population', symbol: 'K', description: 'Items counted as successes', defaultValue: 4, min: 0, max: 1_000_000, integer: true, sliderMin: 0, sliderMax: 200, step: 1 },
    { key: 'n', label: 'Draws', symbol: 'n', description: 'Items drawn without replacement', defaultValue: 5, min: 0, max: 1_000_000, integer: true, sliderMin: 0, sliderMax: 200, step: 1 },
  ],
  notes: ['Draws are without replacement, so successive draws are dependent.'],
  validateExtra: ({ N, K, n }) => {
    const out = [];
    if (K > N) out.push({ code: 'range', field: 'K', message: 'Successes in population (K) cannot exceed population size (N).' });
    if (n > N) out.push({ code: 'range', field: 'n', message: 'Draws (n) cannot exceed population size (N) when sampling without replacement.' });
    return out;
  },
  closedFormQuantile: false,
  support: ({ N, K, n }) => ({ min: Math.max(0, n + K - N), max: Math.min(n, K) }),
  logPdf: (k, { N, K, n }) => hyperLogPmf(k, N, K, n),
  pdf: (k, { N, K, n }) => expOrZero(hyperLogPmf(k, N, K, n)),
  cdf: (x, prm) => hyperCdfSum(x, prm, false),
  sf: (x, prm) => hyperCdfSum(x, prm, true),
  quantile: (q, prm) => {
    const s = hypergeometric.support(prm);
    return invertDiscrete(q, (k) => hypergeometric.cdf(k, prm), (k) => hypergeometric.sf(k, prm), s, s.min);
  },
  mean: ({ N, K, n }) => defined((n * K) / N),
  variance: ({ N, K, n }) => (N === 1 ? defined(0) : defined((n * K * (N - K) * (N - n)) / (N * N * (N - 1)))),
  skewness: ({ N, K, n }) => {
    const v = N > 1 ? (n * K * (N - K) * (N - n)) / (N * N * (N - 1)) : 0;
    if (v === 0 || N <= 2) return undefinedMoment('Undefined when the variance is zero.');
    return defined(((N - 2 * K) * Math.sqrt(N - 1) * (N - 2 * n)) / (Math.sqrt(n * K * (N - K) * (N - n)) * (N - 2)));
  },
  excessKurtosis: ({ N, K, n }) => {
    const v = N > 1 ? (n * K * (N - K) * (N - n)) / (N * N * (N - 1)) : 0;
    if (v === 0 || N <= 3) return undefinedMoment('Undefined when the variance is zero or N ≤ 3.');
    const num =
      (N - 1) * N * N * (N * (N + 1) - 6 * K * (N - K) - 6 * n * (N - n)) + 6 * n * K * (N - K) * (N - n) * (5 * N - 6);
    return defined(num / (n * K * (N - K) * (N - n) * (N - 2) * (N - 3)));
  },
  mode: ({ N, K, n }) => defined(Math.floor(((n + 1) * (K + 1)) / (N + 2))),
  sample: (rng, { N, K, n }) => {
    if (n <= 5000) {
      // Sequential draws: exact, O(n).
      let successes = 0;
      let remaining = N;
      let good = K;
      for (let i = 0; i < n; i++) {
        if (rng.uniform() * remaining < good) {
          successes++;
          good--;
        }
        remaining--;
      }
      return successes;
    }
    // Inversion for large n.
    const u = rng.uniform();
    return hypergeometric.quantile(u === 0 ? Number.MIN_VALUE : u, { N, K, n });
  },
};

export const poisson: DistributionDef = {
  id: 'poisson',
  name: 'Poisson',
  kind: 'discrete',
  description: 'Number of events in a fixed interval when events occur independently at a constant average rate λ.',
  useCases: ['Calls arriving per hour', 'Defects per unit', 'Rare events over a period'],
  formula: 'P(X = k) = λᵏ e^{−λ} / k!',
  supportText: 'k ∈ {0, 1, 2, …}',
  params: [
    { key: 'lambda', label: 'Rate', symbol: 'λ', description: 'Average number of events per interval', defaultValue: 4, min: 0, minExclusive: true, max: 1e7, sliderMin: 0.1, sliderMax: 50, step: 0.1 },
  ],
  notes: ['Assumes events occur independently at a constant rate.'],
  closedFormQuantile: false,
  support: () => ({ min: 0, max: Infinity }),
  logPdf: (k, { lambda }) => (!isInt(k) || k < 0 ? -Infinity : k * Math.log(lambda) - lambda - logFactorial(k)),
  pdf: (k, prm) => expOrZero(poisson.logPdf(k, prm)),
  cdf: (x, { lambda }) => {
    const k = Math.floor(x);
    if (k < 0) return 0;
    return incompleteGamma(k + 1, lambda).upper;
  },
  sf: (x, { lambda }) => {
    const k = Math.floor(x);
    if (k < 0) return 1;
    return incompleteGamma(k + 1, lambda).lower;
  },
  quantile: (q, prm) =>
    invertDiscrete(q, (k) => poisson.cdf(k, prm), (k) => poisson.sf(k, prm), { min: 0, max: Infinity }, Math.floor(prm.lambda)),
  mean: ({ lambda }) => defined(lambda),
  variance: ({ lambda }) => defined(lambda),
  skewness: ({ lambda }) => defined(1 / Math.sqrt(lambda)),
  excessKurtosis: ({ lambda }) => defined(1 / lambda),
  mode: ({ lambda }) => (isInt(lambda) ? undefinedMoment(`Two modes: ${lambda - 1} and ${lambda}.`) : defined(Math.floor(lambda))),
  sample: (rng, { lambda }) => rng.poisson(lambda),
};

export const discreteUniform: DistributionDef = {
  id: 'discreteUniform',
  name: 'Discrete uniform',
  kind: 'discrete',
  description: 'Every integer from a to b is equally likely.',
  useCases: ['A fair die (a = 1, b = 6)', 'Random selection of an item by index'],
  formula: 'P(X = k) = 1 / (b − a + 1)',
  supportText: 'k ∈ {a, a + 1, …, b}',
  params: [
    { key: 'a', label: 'Minimum', symbol: 'a', description: 'Smallest value', defaultValue: 1, min: -1e9, max: 1e9, integer: true, sliderMin: -20, sliderMax: 20, step: 1 },
    { key: 'b', label: 'Maximum', symbol: 'b', description: 'Largest value', defaultValue: 6, min: -1e9, max: 1e9, integer: true, sliderMin: -20, sliderMax: 50, step: 1 },
  ],
  notes: [],
  validateExtra: ({ a, b }) => (b < a ? [{ code: 'range', field: 'b', message: 'Maximum (b) must be at least the minimum (a).' }] : []),
  closedFormQuantile: true,
  support: ({ a, b }) => ({ min: a, max: b }),
  pdf: (k, { a, b }) => (isInt(k) && k >= a && k <= b ? 1 / (b - a + 1) : 0),
  logPdf: (k, prm) => Math.log(discreteUniform.pdf(k, prm)),
  cdf: (x, { a, b }) => {
    const k = Math.floor(x);
    return k < a ? 0 : k >= b ? 1 : (k - a + 1) / (b - a + 1);
  },
  sf: (x, { a, b }) => {
    const k = Math.floor(x);
    return k < a ? 1 : k >= b ? 0 : (b - k) / (b - a + 1);
  },
  quantile: (q, { a, b }) => {
    assertQuantileLevel(q);
    if (q <= 0) return a;
    if (q >= 1) return b;
    const n = b - a + 1;
    // Start from the closed form, then correct for floating-point error by
    // checking the exact CDF either side. Rounding in q·n can place the
    // estimate one step out in either direction, and the definition is the
    // smallest k with F(k) ≥ q.
    let k = Math.min(b, Math.max(a, a + Math.ceil(q * n) - 1));
    while (k > a && (k - a) / n >= q) k--;
    while (k < b && (k - a + 1) / n < q) k++;
    return k;
  },
  mean: ({ a, b }) => defined((a + b) / 2),
  variance: ({ a, b }) => defined(((b - a + 1) ** 2 - 1) / 12),
  skewness: ({ a, b }) => (a === b ? undefinedMoment('Undefined for a single point.') : defined(0)),
  excessKurtosis: ({ a, b }) => {
    const n = b - a + 1;
    return n === 1 ? undefinedMoment('Undefined for a single point.') : defined(-(6 * (n * n + 1)) / (5 * (n * n - 1)));
  },
  mode: ({ a, b }) => (a === b ? defined(a) : undefinedMoment('Every value in the support is a mode.')),
  sample: (rng, { a, b }) => rng.int(a, b),
};

export const DISCRETE_DISTRIBUTIONS: DistributionDef[] = [
  bernoulli,
  binomial,
  geometric,
  negativeBinomial,
  hypergeometric,
  poisson,
  discreteUniform,
];
