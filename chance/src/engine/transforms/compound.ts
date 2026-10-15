/**
 * Compound and aggregate distributions: Panjer recursion, the FFT alternative,
 * discretisation of a continuous severity, stop-loss premiums, and the
 * alpha-stable family.
 *
 * Panjer recursion is the standard exact method for an aggregate loss
 * S = X₁ + … + X_N with N in the (a, b, 0) class (Poisson, binomial,
 * negative binomial) and an arithmetic severity. It is exact up to the
 * discretisation of the severity, which is why the discretisation method and
 * the direction of the bias it introduces are reported with every result
 * rather than left implicit.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { gaussLegendreUnit } from '../portfolio/numerics';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { cDiv, cExp, cMul, cPowReal, cScale, cSub, cUnit, complex, fft, nextPowerOfTwo, type Complex } from './complex';
import { makeLattice, type Lattice } from './convolution';

/* ------------------------------------------------------------------ *
 * Frequency: the (a, b, 0) class                                     *
 * ------------------------------------------------------------------ */

export type FrequencySpec =
  | { kind: 'poisson'; lambda: number }
  | { kind: 'binomial'; n: number; q: number }
  | { kind: 'negativeBinomial'; r: number; p: number };

interface AbPair {
  a: number;
  b: number;
  /** PGF of N, needed for P(S = 0) when the severity has an atom at 0. */
  pgf(z: number): number;
  /** Complex PGF, for the FFT route. */
  cpgf(z: Complex): Complex;
  mean: number;
  variance: number;
  label: string;
}

/**
 * The (a, b, 0) recursion constants. P(N = k) = (a + b/k)·P(N = k − 1).
 *  - Poisson(λ):              a = 0,            b = λ
 *  - Binomial(n, q):          a = −q/(1 − q),   b = (n + 1)q/(1 − q)
 *  - NegBin(r, p) on failures: a = 1 − p,        b = (r − 1)(1 − p)
 */
export function abPair(freq: FrequencySpec): AbPair {
  if (freq.kind === 'poisson') {
    const { lambda } = freq;
    if (!(lambda > 0) || !Number.isFinite(lambda)) throw new EngineError('The Poisson frequency λ must be a finite positive number.', 'range');
    return {
      a: 0,
      b: lambda,
      pgf: (z) => Math.exp(lambda * (z - 1)),
      cpgf: (z) => cExp(cScale(cSub(z, complex(1, 0)), lambda)),
      mean: lambda,
      variance: lambda,
      label: `Poisson(λ = ${lambda})`,
    };
  }
  if (freq.kind === 'binomial') {
    const { n, q } = freq;
    if (!Number.isInteger(n) || n < 1) throw new EngineError('The binomial frequency n must be a whole number of at least 1.', 'range');
    if (!(q > 0) || q >= 1) {
      throw new EngineError('The binomial frequency q must lie strictly between 0 and 1; at q = 1 the (a, b, 0) constants are not defined.', 'range');
    }
    return {
      a: -q / (1 - q),
      b: ((n + 1) * q) / (1 - q),
      pgf: (z) => Math.pow(1 - q + q * z, n),
      cpgf: (z) => cPowReal(cAddReal(cScale(z, q), 1 - q), n),
      mean: n * q,
      variance: n * q * (1 - q),
      label: `Binomial(n = ${n}, q = ${q})`,
    };
  }
  const { r, p } = freq;
  if (!(r > 0) || !Number.isFinite(r)) throw new EngineError('The negative-binomial r must be a finite positive number.', 'range');
  if (!(p > 0) || p >= 1) throw new EngineError('The negative-binomial p must lie strictly between 0 and 1.', 'range');
  return {
    a: 1 - p,
    b: (r - 1) * (1 - p),
    pgf: (z) => {
      const den = 1 - (1 - p) * z;
      if (den <= 0) throw new EngineError('The negative-binomial PGF is not defined at or beyond its pole z = 1/(1 − p).', 'range');
      return Math.pow(p / den, r);
    },
    cpgf: (z) => cPowReal(cDiv(complex(p, 0), cSub(complex(1, 0), cScale(z, 1 - p))), r),
    mean: (r * (1 - p)) / p,
    variance: (r * (1 - p)) / (p * p),
    label: `NegativeBinomial(r = ${r}, p = ${p}) counting failures`,
  };
}

function cAddReal(z: Complex, x: number): Complex {
  return { re: z.re + x, im: z.im };
}

/**
 * Rigorous upper bound on P(S > threshold) for a compound distribution with a
 * bounded arithmetic severity, by Chernoff on the compound cumulant generating
 * function K_S(t) = ln G_N(M_X(t)). M_X is a finite sum, so it is finite for
 * every t; G_N restricts t only for the negative-binomial case, where
 * (1 − p)·M_X(t) must stay below 1. Every t in the admissible set gives a
 * valid bound, so the smallest value found over a geometric scan is valid even
 * if it is not quite the optimum. Chebyshev's inequality is computed too and
 * the better of the two is returned.
 */
function aggregateTailBound(ab: AbPair, severity: Lattice, threshold: number, mean: number, variance: number): number {
  const chebyshev = threshold > mean ? Math.min(1, variance / (threshold - mean) ** 2) : 1;
  if (!(threshold > mean)) return 1;
  const vals = Array.from(severity.p, (_p, j) => j * severity.step);
  const mx = (t: number): number => stableSum(severity.p.map((p, j) => p * Math.exp(t * vals[j])));
  let best = chebyshev;
  for (let i = 0; i <= 400; i++) {
    const t = Math.exp(Math.log(1e-6) + (i / 400) * (Math.log(50) - Math.log(1e-6)));
    const m = mx(t);
    if (!Number.isFinite(m)) break;
    let g: number;
    try {
      g = ab.pgf(m);
    } catch {
      break;
    }
    if (!Number.isFinite(g) || g <= 0) break;
    const bound = Math.exp(Math.log(g) - t * threshold);
    if (Number.isFinite(bound) && bound < best) best = bound;
  }
  return Math.min(1, best);
}

/* ------------------------------------------------------------------ *
 * Severity discretisation                                            *
 * ------------------------------------------------------------------ */

export type DiscretisationMethod = 'mass-dispersal' | 'local-moment' | 'lower-bound' | 'upper-bound';

export interface DiscretisedSeverity {
  /** Probability vector on 0, h, 2h, …; index 0 is the atom at 0. */
  lattice: Lattice;
  step: number;
  method: DiscretisationMethod;
  /** Mean of the discretised severity. */
  mean: number;
  /** Mean of the true continuous severity, where it is finite. */
  trueMean: number;
  /** Mass left beyond the last lattice point. */
  omittedTail: number;
  biasDirection: 'understates the mean' | 'overstates the mean' | 'preserves the mean exactly';
  notes: string[];
}

/** E[X ∧ d] = ∫₀^d S(x) dx, by composite Gauss–Legendre on the survival function. */
function limitedExpectedValueContinuous(sf: (x: number) => number, d: number, panels = 64): number {
  if (d <= 0) return 0;
  const { nodes, weights } = gaussLegendreUnit(12);
  const h = d / panels;
  const terms: number[] = [];
  for (let panel = 0; panel < panels; panel++) {
    const a = panel * h;
    for (let i = 0; i < nodes.length; i++) terms.push(weights[i] * h * sf(a + nodes[i] * h));
  }
  return stableSum(terms);
}

/**
 * Discretise a non-negative continuous severity on to the lattice 0, h, 2h, …
 *
 * Bias directions, which are properties of the method and not of the data:
 *  - `local-moment` matches the first moment on every span, so the discretised
 *    mean equals the true mean exactly.
 *  - `lower-bound` moves every value down to the lattice point below it, so
 *    the discretised variable is stochastically smaller: it understates the
 *    mean and every stop-loss premium.
 *  - `upper-bound` moves every value up, so it overstates both. Together these
 *    two bracket the true answer.
 *  - `mass-dispersal` (the method of rounding) moves each value to the nearest
 *    lattice point. Its mean is not exact; for a decreasing density more mass
 *    moves down than up within each cell, so it understates the mean. Its
 *    error is O(h²) rather than O(h), which is why it is the usual default.
 */
export function discretiseSeverity(
  id: string,
  params: Params,
  step: number,
  options: { method?: DiscretisationMethod; points?: number; tailMass?: number } = {},
): DiscretisedSeverity {
  const def = getDistribution(id);
  if (def.kind !== 'continuous') {
    throw new EngineError(`"${id}" is already discrete; discretisation applies to a continuous severity. Use it directly as an arithmetic severity instead.`, 'invalid');
  }
  const sup = def.support(params);
  if (sup.min < 0) {
    throw new EngineError(
      `The severity "${id}" has support reaching ${sup.min}, below zero. Panjer recursion and the compound models here require a non-negative severity; no discretisation is reported.`,
      'invalid',
    );
  }
  if (!(step > 0) || !Number.isFinite(step)) throw new EngineError('The discretisation step h must be a finite positive number.', 'range');

  const method = options.method ?? 'mass-dispersal';
  const tailMass = options.tailMass ?? 1e-12;
  const upper = Number.isFinite(sup.max) ? sup.max : def.quantile(1 - tailMass, params);
  if (!Number.isFinite(upper)) {
    throw new EngineError(`The severity "${id}" could not be truncated: its ${1 - tailMass} quantile is not finite. No discretisation is reported.`, 'numerical');
  }
  const m = options.points ?? Math.ceil(upper / step) + 2;
  if (!Number.isInteger(m) || m < 2 || m > 4_000_000) {
    throw new EngineError(`The discretisation would need ${m} lattice points, which is outside the allowed range 2…4,000,000. Use a larger step h.`, 'too-large');
  }

  const F = (x: number) => def.cdf(x, params);
  const S = (x: number) => def.sf(x, params);
  const f = new Float64Array(m);

  if (method === 'mass-dispersal') {
    f[0] = F(step / 2);
    for (let j = 1; j < m; j++) f[j] = F((j + 0.5) * step) - F((j - 0.5) * step);
  } else if (method === 'lower-bound') {
    for (let j = 0; j < m; j++) f[j] = F((j + 1) * step) - (j === 0 ? 0 : F(j * step));
  } else if (method === 'upper-bound') {
    f[0] = F(0);
    for (let j = 1; j < m; j++) f[j] = F(j * step) - F((j - 1) * step);
  } else {
    // Local moment matching on two points per span (Klugman–Panjer–Willmot):
    //   f_0 = 1 − E[X ∧ h]/h
    //   f_j = (2E[X ∧ jh] − E[X ∧ (j−1)h] − E[X ∧ (j+1)h]) / h
    const lev: number[] = [];
    for (let j = 0; j <= m; j++) lev.push(limitedExpectedValueContinuous(S, j * step));
    f[0] = 1 - lev[1] / step;
    for (let j = 1; j < m; j++) {
      f[j] = (2 * lev[j] - lev[j - 1] - lev[j + 1]) / step;
    }
  }

  for (let j = 0; j < m; j++) {
    if (f[j] < 0) {
      // Local moment matching can return a tiny negative value from quadrature
      // rounding; anything beyond rounding is a genuine failure and is refused.
      if (f[j] < -1e-10) {
        throw new EngineError(
          `Discretisation by ${method} produced a negative probability ${f[j]} at lattice point ${j}. That is not a distribution, so no severity is reported.`,
          'numerical',
        );
      }
      f[j] = 0;
    }
  }

  const mass = stableSum(f);
  const meanDisc = stableSum(Array.from(f, (p, j) => p * j * step));
  const trueMeanMoment = def.mean(params);
  const trueMean = trueMeanMoment.defined ? trueMeanMoment.value : NaN;

  const biasDirection: DiscretisedSeverity['biasDirection'] =
    method === 'local-moment'
      ? 'preserves the mean exactly'
      : method === 'upper-bound'
        ? 'overstates the mean'
        : 'understates the mean';

  return {
    lattice: makeLattice(f, 0, step),
    step,
    method,
    mean: meanDisc,
    trueMean,
    omittedTail: Math.max(0, 1 - mass),
    biasDirection,
    notes: [
      `${method} discretisation of ${def.name} on to the lattice 0, ${step}, 2·${step}, … with ${m} points (covering up to ${((m - 1) * step).toPrecision(6)}).`,
      `Discretised mean ${meanDisc.toPrecision(10)} against a true mean of ${Number.isFinite(trueMean) ? trueMean.toPrecision(10) : 'undefined'}: this method ${biasDirection}.`,
      `Mass omitted beyond the last lattice point: ${Math.max(0, 1 - mass).toExponential(3)}.`,
      method === 'lower-bound' || method === 'upper-bound'
        ? 'The lower-bound and upper-bound discretisations bracket the true aggregate distribution in stochastic order, so running both gives a rigorous interval around any stop-loss premium.'
        : method === 'local-moment'
          ? 'Local moment matching preserves the mean exactly but the variance only to O(h²); the atom at 0 can be large for a small h, which the Panjer recursion handles explicitly.'
          : 'Mass dispersal has an O(h²) error in the mean. Its bias direction depends on the curvature of the density: for a decreasing density it understates the mean.',
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Panjer recursion                                                   *
 * ------------------------------------------------------------------ */

export interface AggregateResult {
  /** Probability vector of S on 0, h, 2h, … */
  lattice: Lattice;
  route: 'panjer' | 'fft';
  exactness: Exactness;
  /** Exact mean and variance from the frequency and severity moments. */
  exactMean: number;
  exactVariance: number;
  /** Mean and variance of the computed vector, as a consistency check. */
  computedMean: number;
  computedVariance: number;
  totalMass: number;
  /** P(S = 0). */
  atZero: number;
  notes: string[];
}

/** E[X] and E[X²] of a lattice severity. */
function severityMoments(sev: Lattice): { m1: number; m2: number; atZero: number } {
  if (sev.origin !== 0) {
    throw new EngineError(
      `The severity lattice starts at ${sev.origin}, not at 0. Panjer recursion needs an arithmetic severity on 0, h, 2h, …; a shifted lattice is not arithmetic in the required sense. No aggregate is reported.`,
      'non-arithmetic',
    );
  }
  const vals = Array.from(sev.p, (_p, j) => j * sev.step);
  return {
    m1: stableSum(sev.p.map((p, j) => p * vals[j])),
    m2: stableSum(sev.p.map((p, j) => p * vals[j] * vals[j])),
    atZero: sev.p[0],
  };
}

function assertArithmetic(sev: Lattice): void {
  if (sev.origin !== 0) {
    throw new EngineError(
      `The severity must be arithmetic on 0, h, 2h, … but this lattice has origin ${sev.origin}. Panjer recursion is not defined for a severity off that grid, and shifting it silently would change the aggregate. No result is reported.`,
      'non-arithmetic',
    );
  }
  if (!(sev.step > 0) || !Number.isFinite(sev.step)) {
    throw new EngineError('The severity lattice step must be a finite positive number.', 'range');
  }
  if (sev.p[0] >= 1) {
    throw new EngineError(
      'The severity places all of its mass at 0, so every claim is of size zero and the aggregate is degenerate at 0. Panjer recursion would divide by 1 − a·f₀ with f₀ = 1; no recursion is reported. Remove the degenerate severity instead.',
      'degenerate',
    );
  }
  const mass = stableSum(sev.p);
  if (!(mass > 0.5)) {
    throw new EngineError(
      `The severity vector carries only ${mass.toPrecision(6)} of probability mass. A Panjer recursion on it would produce an aggregate missing most of its mass; no result is reported.`,
      'invalid',
    );
  }
}

/**
 * Panjer recursion for an (a, b, 0) frequency and an arithmetic severity.
 *
 *   g₀ = G_N(f₀)
 *   g_k = [ Σ_{j=1}^{k} (a + b·j/k)·f_j·g_{k−j} ] / (1 − a·f₀),  k ≥ 1
 *
 * The atom f₀ = P(X = 0) is handled explicitly: a severity that can be zero
 * makes g₀ the PGF of N at f₀ rather than P(N = 0), and puts the 1 − a·f₀
 * factor in the denominator. Getting that wrong is the classic way to produce
 * an aggregate distribution that is quietly wrong everywhere, so it is done
 * here and refused when 1 − a·f₀ is not safely positive.
 */
export function panjerRecursion(
  freq: FrequencySpec,
  severity: Lattice,
  options: { points?: number; tailMass?: number } = {},
): AggregateResult {
  assertArithmetic(severity);
  const ab = abPair(freq);
  const f = severity.p;
  const f0 = f[0];
  const denom = 1 - ab.a * f0;
  if (!(denom > 1e-12)) {
    throw new EngineError(
      `Panjer recursion needs 1 − a·f₀ to be safely positive, but with a = ${ab.a} and f₀ = ${f0} it is ${denom}. The recursion would divide by (almost) zero and return meaningless probabilities; no aggregate is reported.`,
      'numerical',
    );
  }

  const sev = severityMoments(severity);
  const exactMean = ab.mean * sev.m1;
  const exactVariance = ab.mean * (sev.m2 - sev.m1 * sev.m1) + ab.variance * sev.m1 * sev.m1;

  const tail = options.tailMass ?? 1e-12;
  // Enough lattice points to cover the mean plus many standard deviations, or
  // the caller's explicit count.
  const sd = Math.sqrt(Math.max(exactVariance, 0));
  const defaultPoints = Math.ceil((exactMean + 12 * sd) / severity.step) + f.length + 8;
  const n = options.points ?? Math.max(f.length, defaultPoints);
  if (!Number.isInteger(n) || n < 1 || n > 4_000_000) {
    throw new EngineError(`The Panjer recursion would need ${n} lattice points, outside the allowed range 1…4,000,000. Use a larger step h.`, 'too-large');
  }

  const g = new Float64Array(n);
  g[0] = ab.pgf(f0);
  if (!(g[0] >= 0) || !Number.isFinite(g[0])) {
    throw new EngineError(`The frequency PGF at f₀ = ${f0} evaluated to ${g[0]}, which is not a probability. No aggregate is reported.`, 'numerical');
  }
  const maxJ = f.length - 1;
  for (let k = 1; k < n; k++) {
    const jHi = Math.min(k, maxJ);
    const terms: number[] = [];
    for (let j = 1; j <= jHi; j++) {
      const w = ab.a + (ab.b * j) / k;
      terms.push(w * f[j] * g[k - j]);
    }
    const v = stableSum(terms) / denom;
    // A binomial frequency has a < 0, so individual terms are signed and a
    // tiny negative total is rounding; a large one is a genuine failure.
    if (v < 0) {
      if (v < -1e-12) {
        throw new EngineError(
          `Panjer recursion produced a negative probability ${v} at lattice point ${k}. The recursion has become numerically unstable (this happens for a binomial frequency with a large |a|); no aggregate is reported.`,
          'numerical',
        );
      }
      g[k] = 0;
    } else {
      g[k] = v;
    }
  }

  const mass = stableSum(g);
  const computedMean = stableSum(Array.from(g, (p, k) => p * k * severity.step));
  const computedM2 = stableSum(Array.from(g, (p, k) => p * (k * severity.step) ** 2));
  const computedVariance = computedM2 - computedMean * computedMean;

  return {
    lattice: makeLattice(g, 0, severity.step),
    route: 'panjer',
    exactness: 'exact',
    exactMean,
    exactVariance,
    computedMean,
    computedVariance,
    totalMass: mass,
    atZero: g[0],
    notes: [
      `Panjer recursion with ${ab.label}: a = ${ab.a}, b = ${ab.b}, f₀ = ${f0.toPrecision(8)}, 1 − a·f₀ = ${denom.toPrecision(10)}.`,
      `${n} lattice points of step ${severity.step}, covering S up to ${((n - 1) * severity.step).toPrecision(8)}; the recursion captured ${mass.toPrecision(12)} of the total mass, leaving ${Math.max(0, 1 - mass).toExponential(3)} beyond the grid.`,
      `Exact compound moments from the frequency and severity moments: mean = E[N]·E[X] = ${exactMean.toPrecision(12)}, variance = E[N]·Var(X) + Var(N)·E[X]² = ${exactVariance.toPrecision(12)}. The recursion's own vector gives ${computedMean.toPrecision(12)} and ${computedVariance.toPrecision(12)}; the gap is the mass left beyond the grid, not a recursion error.`,
      'The recursion is exact arithmetic on the discretised severity: its only error is the severity discretisation, whose method and bias direction are reported by `discretiseSeverity`.',
      mass < 1 - Math.max(tail, 1e-9)
        ? `WARNING: ${Math.max(0, 1 - mass).toExponential(3)} of the aggregate mass lies beyond the grid, which is more than the requested tolerance ${tail}. Increase the point count.`
        : 'The grid covers all but a negligible part of the aggregate distribution.',
    ],
  };
}

/**
 * The same aggregate by FFT: ĝ = G_N(f̂) evaluated on the transform of the
 * severity, inverted back. It is O(M log M) instead of Panjer's O(M²), but it
 * computes a *cyclic* convolution, so any aggregate mass beyond M·h wraps
 * around on to the head of the distribution. That wrap-around is measured here
 * (as the mass the Panjer-exact moments say should be outside the grid) and
 * reported, because a wrapped aggregate looks entirely plausible.
 */
export function compoundByFft(
  freq: FrequencySpec,
  severity: Lattice,
  options: { points?: number; maxWrapMass?: number } = {},
): AggregateResult {
  assertArithmetic(severity);
  const ab = abPair(freq);
  const sev = severityMoments(severity);
  const exactMean = ab.mean * sev.m1;
  const exactVariance = ab.mean * (sev.m2 - sev.m1 * sev.m1) + ab.variance * sev.m1 * sev.m1;
  const sd = Math.sqrt(Math.max(exactVariance, 0));

  const wanted = options.points ?? Math.ceil((exactMean + 14 * sd) / severity.step) + severity.p.length + 8;
  const M = nextPowerOfTwo(wanted);
  if (M > 1 << 24) {
    throw new EngineError(`An FFT compound at ${M} points exceeds the limit of ${1 << 24}. Use a larger step h.`, 'too-large');
  }
  // The mass beyond the grid is exactly the mass that wraps around, so it is
  // bounded rigorously rather than guessed. A Chernoff bound on the compound
  // CGF K_S(t) = ln G_N(M_X(t)) is used, because Chebyshev's inequality is
  // many orders of magnitude too loose here and would refuse grids that are
  // in fact ample.
  const gridTop = (M - 1) * severity.step;
  const wrapBound = aggregateTailBound(ab, severity, gridTop, exactMean, exactVariance);
  const maxWrap = options.maxWrapMass ?? 1e-6;
  if (wrapBound > maxWrap) {
    throw new EngineError(
      `An FFT compound on ${M} points of step ${severity.step} reaches only S = ${gridTop.toPrecision(8)}, while the aggregate has mean ${exactMean.toPrecision(8)} and standard deviation ${sd.toPrecision(8)}. The mass beyond the grid is bounded at ${wrapBound.toExponential(3)}, above the tolerance ${maxWrap}, and in a cyclic convolution that mass does not vanish — it is added back on to the low end of the distribution. No result is reported; increase the grid.`,
      'wrap-around',
    );
  }

  const re = new Float64Array(M);
  const im = new Float64Array(M);
  for (let j = 0; j < Math.min(severity.p.length, M); j++) re[j] = severity.p[j];
  fft(re, im, false);
  for (let k = 0; k < M; k++) {
    const z = ab.cpgf(complex(re[k], im[k]));
    re[k] = z.re;
    im[k] = z.im;
  }
  fft(re, im, true);

  const g = new Float64Array(M);
  let negative = 0;
  let imagResidue = 0;
  for (let k = 0; k < M; k++) {
    imagResidue = Math.max(imagResidue, Math.abs(im[k]));
    if (re[k] < 0) {
      negative = Math.max(negative, -re[k]);
      g[k] = 0;
    } else {
      g[k] = re[k];
    }
  }

  const mass = stableSum(g);
  const computedMean = stableSum(Array.from(g, (p, k) => p * k * severity.step));
  const computedM2 = stableSum(Array.from(g, (p, k) => p * (k * severity.step) ** 2));

  return {
    lattice: makeLattice(g, 0, severity.step),
    route: 'fft',
    exactness: 'numerical',
    exactMean,
    exactVariance,
    computedMean,
    computedVariance: computedM2 - computedMean * computedMean,
    totalMass: mass,
    atZero: g[0],
    notes: [
      `FFT compound with ${ab.label} at transform length ${M} (step ${severity.step}, grid reaching ${gridTop.toPrecision(8)}).`,
      `Rigorous Chernoff bound on the mass beyond the grid — which in a cyclic convolution wraps on to the head — is ${wrapBound.toExponential(3)}, within the tolerance ${maxWrap}. Any aggregate probability below that figure could be wrap-around rather than signal.`,
      `Rounding residues: largest spurious imaginary part ${imagResidue.toExponential(3)}, largest negative probability ${negative.toExponential(3)} (clipped to 0 and reported, not hidden). Aggregate probabilities below about ${Math.max(imagResidue, negative).toExponential(2)} are noise.`,
      `Exact compound moments: mean ${exactMean.toPrecision(12)}, variance ${exactVariance.toPrecision(12)}. The FFT vector gives ${computedMean.toPrecision(12)} and ${(computedM2 - computedMean * computedMean).toPrecision(12)}.`,
      'This route is numerical, not exact: compare it against the Panjer recursion on the same severity, which is exact up to the discretisation.',
    ],
  };
}

export interface CrossCheck {
  maxAbsoluteDifference: number;
  maxRelativeDifference: number;
  comparedPoints: number;
  /** Threshold below which probabilities were excluded from the relative test. */
  relativeFloor: number;
  agrees: boolean;
  notes: string[];
}

/** Compare the Panjer and FFT aggregates point by point. */
export function crossCheckAggregates(a: AggregateResult, b: AggregateResult, tolerance = 1e-9): CrossCheck {
  if (Math.abs(a.lattice.step - b.lattice.step) > 1e-15 * a.lattice.step) {
    throw new EngineError('The two aggregates live on different lattices and cannot be compared point by point.', 'incompatible');
  }
  const n = Math.min(a.lattice.p.length, b.lattice.p.length);
  const floor = 1e-14;
  let maxAbs = 0;
  let maxRel = 0;
  for (let k = 0; k < n; k++) {
    const d = Math.abs(a.lattice.p[k] - b.lattice.p[k]);
    maxAbs = Math.max(maxAbs, d);
    const scale = Math.max(a.lattice.p[k], b.lattice.p[k]);
    if (scale > floor) maxRel = Math.max(maxRel, d / scale);
  }
  return {
    maxAbsoluteDifference: maxAbs,
    maxRelativeDifference: maxRel,
    comparedPoints: n,
    relativeFloor: floor,
    agrees: maxAbs <= tolerance,
    notes: [
      `Compared ${n} lattice points: largest absolute difference ${maxAbs.toExponential(3)}, largest relative difference ${maxRel.toExponential(3)} among probabilities above ${floor.toExponential(1)}.`,
      maxAbs <= tolerance
        ? 'The exact recursion and the FFT route agree within tolerance, which is evidence that neither has wrapped around or lost mass.'
        : `The two routes DISAGREE by ${maxAbs.toExponential(3)}, above the tolerance ${tolerance}. One of them is wrong: check the FFT grid for wrap-around and the recursion for the mass left beyond its grid.`,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Stop-loss premiums and limited expected values                     *
 * ------------------------------------------------------------------ */

export interface StopLossResult {
  retention: number;
  /** E[(S − d)₊]. */
  stopLossPremium: number;
  /** E[S ∧ d] = E[S] − E[(S − d)₊]. */
  limitedExpectedValue: number;
  /** P(S > d). */
  exceedanceProbability: number;
  exactness: Exactness;
  notes: string[];
}

/**
 * Stop-loss premium E[(S − d)₊] and limited expected value E[S ∧ d] from a
 * lattice aggregate. The retention must lie on the lattice: between lattice
 * points the stop-loss premium of a discretised variable is piecewise linear
 * and does not equal the continuous answer, so an off-lattice retention is
 * refused rather than interpolated.
 */
export function stopLossPremium(aggregate: AggregateResult, retention: number): StopLossResult {
  if (!Number.isFinite(retention) || retention < 0) {
    throw new EngineError('The retention d must be a finite non-negative number.', 'range');
  }
  const step = aggregate.lattice.step;
  const idx = retention / step;
  if (Math.abs(idx - Math.round(idx)) > 1e-9) {
    throw new EngineError(
      `The retention d = ${retention} does not lie on the aggregate's lattice of step ${step}. The stop-loss premium of a lattice distribution is piecewise linear between lattice points and interpolating it would not give the continuous answer, so no premium is reported. Choose a multiple of ${step}, or re-discretise with a step that divides ${retention}.`,
      'non-arithmetic',
    );
  }
  const p = aggregate.lattice.p;
  const terms: number[] = [];
  const tailTerms: number[] = [];
  for (let k = 0; k < p.length; k++) {
    const s = k * step;
    if (s > retention) {
      terms.push(p[k] * (s - retention));
      tailTerms.push(p[k]);
    }
  }
  const premium = stableSum(terms);
  const exceed = stableSum(tailTerms);
  return {
    retention,
    stopLossPremium: premium,
    limitedExpectedValue: aggregate.exactMean - premium,
    exceedanceProbability: exceed,
    exactness: aggregate.exactness,
    notes: [
      `E[(S − ${retention})₊] = ${premium.toPrecision(12)} summed over ${terms.length} lattice points above the retention; P(S > ${retention}) = ${exceed.toExponential(6)}.`,
      `E[S ∧ ${retention}] = E[S] − E[(S − d)₊] = ${aggregate.exactMean.toPrecision(12)} − ${premium.toPrecision(12)} = ${(aggregate.exactMean - premium).toPrecision(12)}, using the EXACT compound mean rather than the grid's own mean so that mass beyond the grid does not understate the limited expected value.`,
      `The mass beyond the aggregate's grid is ${Math.max(0, 1 - aggregate.totalMass).toExponential(3)}; it contributes to the true stop-loss premium with a weight of at least (gridTop − d), so the premium reported here is a slight UNDERSTATEMENT when that mass is not negligible.`,
      ...(aggregate.route === 'fft'
        ? ['The underlying aggregate came from the FFT route, so this premium is numerical; recompute it from the Panjer recursion for an exact figure.']
        : []),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Alpha-stable distributions                                         *
 * ------------------------------------------------------------------ */

export interface StableParams {
  /** Stability index α ∈ (0, 2]. */
  alpha: number;
  /** Skewness β ∈ [−1, 1]. */
  beta: number;
  /** Scale c > 0. */
  scale: number;
  /** Location δ. */
  location: number;
}

export function validateStable(p: StableParams): void {
  if (!Number.isFinite(p.alpha) || p.alpha <= 0 || p.alpha > 2) {
    throw new EngineError('The stable index α must lie in (0, 2].', 'range');
  }
  if (!Number.isFinite(p.beta) || p.beta < -1 || p.beta > 1) {
    throw new EngineError('The stable skewness β must lie in [−1, 1].', 'range');
  }
  if (!(p.scale > 0) || !Number.isFinite(p.scale)) throw new EngineError('The stable scale c must be a finite positive number.', 'range');
  if (!Number.isFinite(p.location)) throw new EngineError('The stable location δ must be finite.', 'finite');
  if (p.alpha === 1 && p.beta !== 0) {
    // Permitted, but the α = 1 branch of the CF is a different formula; it is
    // implemented, so this is only a note, not an error.
  }
}

/**
 * Characteristic function of an alpha-stable law in the S1 parametrisation:
 *
 *   α ≠ 1:  φ(t) = exp( iδt − |ct|^α [1 − iβ·tan(πα/2)·sgn t] )
 *   α = 1:  φ(t) = exp( iδt − c|t| [1 + iβ(2/π)·sgn t·ln|t|] )
 *
 * At α = 2 this is exp(iδt − c²t²), i.e. a normal with σ = c√2, and at α = 1
 * with β = 0 it is exp(iδt − c|t|), i.e. a Cauchy with scale c. No closed-form
 * density exists for general α, which is why the stable family is a natural
 * customer for the inversion routines in this module.
 */
export function stableCf(p: StableParams): (t: number) => Complex {
  validateStable(p);
  const { alpha, beta, scale, location } = p;
  return (t: number): Complex => {
    if (!Number.isFinite(t)) throw new EngineError('The characteristic-function argument t must be finite.', 'finite');
    if (t === 0) return complex(1, 0);
    const sgn = t > 0 ? 1 : -1;
    const at = Math.abs(t);
    let reExp: number;
    let imExp: number;
    if (alpha === 1) {
      reExp = -scale * at;
      imExp = location * t - scale * at * beta * (2 / Math.PI) * sgn * Math.log(at);
    } else {
      const mag = Math.pow(scale * at, alpha);
      reExp = -mag;
      imExp = location * t + mag * beta * Math.tan((Math.PI * alpha) / 2) * sgn;
    }
    return cMul(cExp(complex(reExp, 0)), cUnit(imExp));
  };
}

export interface StableMoments {
  mean: { defined: true; value: number } | { defined: false; reason: string };
  variance: { defined: true; value: number } | { defined: false; reason: string };
  notes: string[];
}

/**
 * The moments a stable law actually has. For α < 2 the variance is infinite,
 * and for α ≤ 1 the mean does not exist either. These are reported as
 * undefined with the reason, never computed into a finite number — a sample
 * variance of simulated stable draws always returns something, and that
 * something is meaningless.
 */
export function stableMoments(p: StableParams): StableMoments {
  validateStable(p);
  const { alpha, beta, scale, location } = p;
  const notes = [
    `α = ${alpha}, β = ${beta}, c = ${scale}, δ = ${location}. E|X|^q is finite exactly for q < α (and for q = 2 only at α = 2).`,
  ];
  if (alpha === 2) {
    notes.push('At α = 2 the stable law is exactly normal with mean δ and variance 2c²; the skewness parameter β has no effect there.');
    return { mean: { defined: true, value: location }, variance: { defined: true, value: 2 * scale * scale }, notes };
  }
  const variance = {
    defined: false as const,
    reason: `The variance of a stable law is infinite for α < 2; with α = ${alpha} no second moment exists. Any finite variance reported for such a variable is an artefact of the sample, not a property of the distribution.`,
  };
  if (alpha <= 1) {
    notes.push('For α ≤ 1 the first absolute moment diverges as well, so the distribution has no mean. The Cauchy case α = 1, β = 0 is the familiar example: its sample mean does not converge.');
    return {
      mean: {
        defined: false,
        reason: `The mean of a stable law does not exist for α ≤ 1; with α = ${alpha} the integral ∫|x|f(x)dx diverges. The location parameter δ is a centre of symmetry (for β = 0), not a mean.`,
      },
      variance,
      notes,
    };
  }
  notes.push(`For 1 < α < 2 the mean exists and equals δ in this parametrisation, but the variance does not.`);
  return { mean: { defined: true, value: location }, variance, notes };
}
