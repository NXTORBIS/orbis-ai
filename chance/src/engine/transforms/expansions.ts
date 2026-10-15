/**
 * Edgeworth and Gram–Charlier expansions, the normal and Poisson
 * approximations with their explicit error bounds, and the Cornish–Fisher
 * quantile expansion (deferred to the portfolio module, which already has it).
 *
 * The point of this file is the validity domain. An Edgeworth or Gram–Charlier
 * series is a polynomial times a normal density: for anything but mild
 * non-normality it goes negative somewhere and its "CDF" stops being monotone.
 * A negative probability is not a small inaccuracy, it is a wrong answer, so
 * these functions detect it and refuse. Likewise the normal and Poisson
 * approximations are returned only together with a bound — Berry–Esseen and
 * Le Cam respectively — that says how wrong they can be.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { linspace, stableSum } from '../core/numeric';
import { normalCdf, normalPdf, normalSf } from '../special/gamma';
import { gaussLegendreUnit } from '../portfolio/numerics';
import { cornishFisherQuantiles, type CornishFisherResult } from '../portfolio/scenario';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';

/**
 * Cornish–Fisher is NOT reimplemented here. `cornishFisherQuantiles` in
 * `../portfolio/scenario` already performs the fourth-order expansion and
 * already checks its monotonicity domain exactly (the derivative with respect
 * to z is a quadratic whose minimum is known in closed form, and a negative
 * minimum is refused). This module re-exports it so that transform-based code
 * has one implementation to use rather than a second, divergent one.
 */
export { cornishFisherQuantiles };
export type { CornishFisherResult };

/* ------------------------------------------------------------------ *
 * Hermite polynomials                                                *
 * ------------------------------------------------------------------ */

/** Probabilists' Hermite polynomial He_n(z). */
export function hermiteHe(n: number, z: number): number {
  if (!Number.isInteger(n) || n < 0) throw new EngineError('The Hermite order must be a non-negative whole number.', 'range');
  if (n === 0) return 1;
  if (n === 1) return z;
  let prev = 1;
  let cur = z;
  for (let k = 2; k <= n; k++) {
    const next = z * cur - (k - 1) * prev;
    prev = cur;
    cur = next;
  }
  return cur;
}

/* ------------------------------------------------------------------ *
 * Edgeworth / Gram–Charlier                                          *
 * ------------------------------------------------------------------ */

export interface ExpansionInput {
  mean: number;
  sd: number;
  /** γ₁ = κ₃/κ₂^{3/2}. */
  skewness: number;
  /** γ₂ = κ₄/κ₂². */
  excessKurtosis: number;
  /**
   * Number of i.i.d. summands, when the expansion is being used for a sum. The
   * shape parameters are then scaled as γ₁/√n and γ₂/n, which is the whole
   * reason an Edgeworth expansion improves with n.
   */
  n?: number;
}

export interface ValidityDomain {
  /** Widest symmetric interval in standardised z over which the density stays ≥ 0. */
  nonNegativeFrom: number;
  nonNegativeTo: number;
  /** True when the density is non-negative over the whole scanned range. */
  globallyNonNegative: boolean;
  /** True when the expansion's CDF is non-decreasing over the scanned range. */
  monotoneCdf: boolean;
  scannedFrom: number;
  scannedTo: number;
  notes: string[];
}

interface Standardised {
  mean: number;
  sd: number;
  g1: number;
  g2: number;
  n: number;
}

function standardise(input: ExpansionInput): Standardised {
  const n = input.n ?? 1;
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The number of summands n must be a whole number of at least 1.', 'range');
  if (!(input.sd > 0) || !Number.isFinite(input.sd)) throw new EngineError('The expansion needs a finite positive standard deviation.', 'range');
  if (!Number.isFinite(input.mean) || !Number.isFinite(input.skewness) || !Number.isFinite(input.excessKurtosis)) {
    throw new EngineError('The expansion needs finite mean, skewness and excess kurtosis.', 'finite');
  }
  return {
    mean: n * input.mean,
    sd: Math.sqrt(n) * input.sd,
    g1: input.skewness / Math.sqrt(n),
    g2: input.excessKurtosis / n,
    n,
  };
}

/** Standardised Edgeworth density factor, including the γ₁² term. */
function edgeworthFactor(z: number, g1: number, g2: number): number {
  return 1 + (g1 / 6) * hermiteHe(3, z) + (g2 / 24) * hermiteHe(4, z) + ((g1 * g1) / 72) * hermiteHe(6, z);
}

/** Standardised Gram–Charlier A factor: the first two correction terms only. */
function gramCharlierFactor(z: number, g1: number, g2: number): number {
  return 1 + (g1 / 6) * hermiteHe(3, z) + (g2 / 24) * hermiteHe(4, z);
}

const SCAN_LIMIT = 8;
const SCAN_POINTS = 1601;

/**
 * Scan the standardised range [−8, 8] for a negative density and for a
 * decreasing CDF. 1601 points is a spacing of 0.01, fine enough to catch the
 * sign changes of a degree-6 polynomial, whose roots are well separated on
 * this scale.
 */
function validityDomain(g1: number, g2: number, factor: (z: number, a: number, b: number) => number): ValidityDomain {
  const zs = linspace(-SCAN_LIMIT, SCAN_LIMIT, SCAN_POINTS);
  let lo = -SCAN_LIMIT;
  let hi = SCAN_LIMIT;
  let global = true;
  let monotone = true;
  // The density is φ(z)·factor(z), so its sign is the sign of `factor`.
  // Find the largest interval around 0 on which it stays non-negative.
  for (const z of zs) {
    if (factor(z, g1, g2) < 0) {
      global = false;
      if (z < 0 && z > lo) lo = z;
      if (z > 0 && z < hi) hi = z;
    }
  }
  if (factor(0, g1, g2) < 0) {
    lo = 0;
    hi = 0;
  }
  // The CDF of the expansion is monotone exactly where the density is ≥ 0, so
  // monotonicity over the scan is the same test; it is reported separately
  // because the two are distinct statements about the user's answer.
  monotone = global;
  return {
    nonNegativeFrom: lo,
    nonNegativeTo: hi,
    globallyNonNegative: global,
    monotoneCdf: monotone,
    scannedFrom: -SCAN_LIMIT,
    scannedTo: SCAN_LIMIT,
    notes: [
      `Scanned the standardised range [−${SCAN_LIMIT}, ${SCAN_LIMIT}] at ${SCAN_POINTS} points (spacing ${(2 * SCAN_LIMIT) / (SCAN_POINTS - 1)}).`,
      global
        ? 'The expansion density stays non-negative throughout the scanned range, and its CDF is therefore non-decreasing there.'
        : `The expansion density goes NEGATIVE outside z ∈ [${lo.toPrecision(4)}, ${hi.toPrecision(4)}]. An Edgeworth or Gram–Charlier series is a polynomial times φ(z), so for this much skewness (γ₁ = ${g1.toPrecision(4)}) and excess kurtosis (γ₂ = ${g2.toPrecision(4)}) it is not a probability distribution at all. Values outside that interval are refused.`,
    ],
  };
}


/**
 * A point is admissible only when the expansion is non-negative there AND the
 * expansion is non-negative over the whole scanned range, or the point lies
 * inside the interval where it is. A positive polynomial value at a point
 * outside that interval is an accident, not a licence: the "distribution" has
 * negative mass nearby and its CDF is not monotone, so the number at the point
 * is not a probability density of anything.
 */
function admissible(validity: ValidityDomain, z: number): boolean {
  if (validity.globallyNonNegative) return true;
  return z >= validity.nonNegativeFrom && z <= validity.nonNegativeTo;
}

export interface ExpansionDensity {
  density: number;
  /** Standardised point used. */
  z: number;
  /** The normal density at the same point, for comparison. */
  normalDensity: number;
  validity: ValidityDomain;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Edgeworth density to order n^{−1}. Refused at any point where the expansion
 * is negative: a clipped negative density would be an invented number.
 */
export function edgeworthDensity(input: ExpansionInput, x: number): ExpansionDensity {
  const st = standardise(input);
  const z = (x - st.mean) / st.sd;
  const validity = validityDomain(st.g1, st.g2, edgeworthFactor);
  const factor = edgeworthFactor(z, st.g1, st.g2);
  if (factor < 0 || !admissible(validity, z)) {
    throw new EngineError(
      `The Edgeworth expansion is not a density at x = ${x} (standardised z = ${z.toPrecision(6)}): the correction factor is ${factor.toPrecision(6)}, giving a density of ${(normalPdf(z) * factor / st.sd).toExponential(3)}. A negative density is not a small inaccuracy, so no value is reported. The expansion is non-negative only for z ∈ [${validity.nonNegativeFrom.toPrecision(4)}, ${validity.nonNegativeTo.toPrecision(4)}] with γ₁ = ${st.g1.toPrecision(4)} and γ₂ = ${st.g2.toPrecision(4)}. Use a saddlepoint approximation, which stays positive by construction, or increase n.`,
      'outside-validity',
    );
  }
  return {
    density: (normalPdf(z) * factor) / st.sd,
    z,
    normalDensity: normalPdf(z) / st.sd,
    validity,
    exactness: 'numerical',
    method: 'Edgeworth expansion to order n^{−1} (γ₁He₃/6 + γ₂He₄/24 + γ₁²He₆/72)',
    notes: [
      `Shape parameters after scaling by n = ${st.n}: γ₁ = ${st.g1.toPrecision(6)}, γ₂ = ${st.g2.toPrecision(6)}.`,
      `Correction factor at this point: ${factor.toPrecision(8)} (1 would be exactly normal).`,
      'The Edgeworth series is an asymptotic expansion in n^{−1/2}: it is accurate near the centre and degrades in the tail, where the omitted terms grow like powers of z. It is the wrong tool beyond about |z| = 3; use Lugannani–Rice there.',
      ...validity.notes,
    ],
  };
}

/** Gram–Charlier A density, with the same refusal on negativity. */
export function gramCharlierDensity(input: ExpansionInput, x: number): ExpansionDensity {
  const st = standardise(input);
  const z = (x - st.mean) / st.sd;
  const validity = validityDomain(st.g1, st.g2, gramCharlierFactor);
  const factor = gramCharlierFactor(z, st.g1, st.g2);
  if (factor < 0 || !admissible(validity, z)) {
    throw new EngineError(
      `The Gram–Charlier A expansion is not a density at x = ${x} (standardised z = ${z.toPrecision(6)}, factor ${factor.toPrecision(6)}). No density is reported. Gram–Charlier is non-negative over the whole real line only inside a small region of the (γ₁, γ₂) plane; with γ₁ = ${st.g1.toPrecision(4)} and γ₂ = ${st.g2.toPrecision(4)} it is outside it, and the series is non-negative only for z ∈ [${validity.nonNegativeFrom.toPrecision(4)}, ${validity.nonNegativeTo.toPrecision(4)}].`,
      'outside-validity',
    );
  }
  return {
    density: (normalPdf(z) * factor) / st.sd,
    z,
    normalDensity: normalPdf(z) / st.sd,
    validity,
    exactness: 'numerical',
    method: 'Gram–Charlier type A expansion, terms through He₄',
    notes: [
      `γ₁ = ${st.g1.toPrecision(6)}, γ₂ = ${st.g2.toPrecision(6)}.`,
      'Gram–Charlier differs from Edgeworth in which terms are retained: it truncates the series in the Hermite basis rather than in powers of n^{−1/2}, and so omits the γ₁²He₆/72 term that Edgeworth keeps at the same order.',
      ...validity.notes,
    ],
  };
}

export interface ExpansionCdf {
  cdf: number;
  z: number;
  normalCdf: number;
  validity: ValidityDomain;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Edgeworth CDF:
 *   F(z) ≈ Φ(z) − φ(z)[γ₁He₂/6 + γ₂He₃/24 + γ₁²He₅/72].
 * Refused when the result is not a probability, or when the underlying density
 * is negative at the point (which is where the CDF stops being monotone).
 */
export function edgeworthCdf(input: ExpansionInput, x: number): ExpansionCdf {
  const st = standardise(input);
  const z = (x - st.mean) / st.sd;
  const validity = validityDomain(st.g1, st.g2, edgeworthFactor);
  if (edgeworthFactor(z, st.g1, st.g2) < 0 || !admissible(validity, z)) {
    throw new EngineError(
      `The Edgeworth expansion's density is negative somewhere at or inside z = ${z.toPrecision(6)}, so its CDF is decreasing there and is not a distribution function. No probability is reported. Non-negativity holds only for z ∈ [${validity.nonNegativeFrom.toPrecision(4)}, ${validity.nonNegativeTo.toPrecision(4)}].`,
      'outside-validity',
    );
  }
  const correction =
    normalPdf(z) * ((st.g1 / 6) * hermiteHe(2, z) + (st.g2 / 24) * hermiteHe(3, z) + ((st.g1 * st.g1) / 72) * hermiteHe(5, z));
  const cdf = normalCdf(z) - correction;
  if (cdf < 0 || cdf > 1) {
    throw new EngineError(
      `The Edgeworth CDF at x = ${x} evaluated to ${cdf}, which is not a probability. The expansion is outside its validity domain here; no clipped value is reported.`,
      'outside-validity',
    );
  }
  return {
    cdf,
    z,
    normalCdf: normalCdf(z),
    validity,
    exactness: 'numerical',
    method: 'Edgeworth CDF expansion to order n^{−1}',
    notes: [
      `Correction to Φ(z): ${(-correction).toExponential(4)}; the normal value alone is ${normalCdf(z).toPrecision(8)}.`,
      'The expansion is an asymptotic series in n^{−1/2}, valid in the central region. In the far tail the relative error is unbounded even when the absolute error is small — a tail probability of 1e-6 can come out negative or off by a factor of many.',
      ...validity.notes,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Normal approximation with a Berry–Esseen bound                     *
 * ------------------------------------------------------------------ */

export interface NormalApproximation {
  /** Φ((x − nμ)/(σ√n)). */
  cdf: number;
  /** Berry–Esseen bound on sup_x |F_n(x) − Φ(x)|. */
  berryEsseenBound: number;
  /** E|X − μ|³, the third absolute central moment used by the bound. */
  thirdAbsoluteMoment: number;
  constant: number;
  n: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/** E|X − μ|³ of a registry distribution, by quadrature or summation. */
export function thirdAbsoluteCentralMoment(id: string, params: Params): { value: number; exactness: Exactness; notes: string[] } {
  const def = getDistribution(id);
  const m = def.mean(params);
  if (!m.defined || !Number.isFinite(m.value)) {
    throw new EngineError(
      `E|X − μ|³ needs a finite mean, and the ${def.name} distribution does not have one${m.defined ? '' : `: ${m.reason}`}. The Berry–Esseen bound does not apply. No value is reported.`,
      'undefined-moment',
    );
  }
  const v = def.variance(params);
  if (!v.defined || !Number.isFinite(v.value)) {
    throw new EngineError(
      `E|X − μ|³ needs a finite variance, and the ${def.name} distribution does not have one${v.defined ? '' : `: ${v.reason}`}. The central limit theorem itself does not apply, so no Berry–Esseen bound is reported.`,
      'undefined-moment',
    );
  }
  const sup = def.support(params);
  if (def.kind === 'discrete') {
    const lo = Math.round(Number.isFinite(sup.min) ? sup.min : def.quantile(1e-15, params));
    const hi = Math.round(Number.isFinite(sup.max) ? sup.max : def.quantile(1 - 1e-15, params));
    const terms: number[] = [];
    for (let k = lo; k <= hi; k++) terms.push(def.pdf(k, params) * Math.abs(k - m.value) ** 3);
    return {
      value: stableSum(terms),
      exactness: 'numerical',
      notes: [`Summed over the support ${lo}…${hi}, which carries all but about 1e-15 of the mass.`],
    };
  }
  const lo = Number.isFinite(sup.min) ? sup.min : def.quantile(1e-14, params);
  const hi = Number.isFinite(sup.max) ? sup.max : def.quantile(1 - 1e-14, params);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new EngineError(`E|X − μ|³ of "${id}" could not be bracketed on a finite range.`, 'numerical');
  }
  const { nodes, weights } = gaussLegendreUnit(16);
  const panels = 256;
  const h = (hi - lo) / panels;
  const terms: number[] = [];
  for (let panel = 0; panel < panels; panel++) {
    const a = lo + panel * h;
    for (let i = 0; i < nodes.length; i++) {
      const x = a + nodes[i] * h;
      terms.push(weights[i] * h * def.pdf(x, params) * Math.abs(x - m.value) ** 3);
    }
  }
  return {
    value: stableSum(terms),
    exactness: 'numerical',
    notes: [`Integrated over [${lo.toPrecision(6)}, ${hi.toPrecision(6)}] with ${panels * 16} Gauss–Legendre nodes; the truncated tails carry about 2e-14 of the mass, but they are weighted by |x − μ|³ so the integral is slightly understated for a heavy-tailed law.`],
  };
}

/**
 * Normal approximation to the CDF of a sum of n i.i.d. summands, together with
 * the Berry–Esseen bound
 *   sup_x |F_n(x) − Φ(x)| ≤ C·ρ / (σ³√n),  C = 0.4748 (Shevtsova 2011),
 * where ρ = E|X − μ|³. The bound is uniform in x and shrinks like 1/√n, and it
 * is reported alongside the approximation so the user can see that a central
 * limit theorem says nothing useful about a 1e-6 tail at modest n.
 */
export function normalApproximation(id: string, params: Params, n: number, x: number): NormalApproximation {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The number of summands n must be a whole number of at least 1.', 'range');
  const def = getDistribution(id);
  const m = def.mean(params);
  const v = def.variance(params);
  if (!m.defined || !Number.isFinite(m.value) || !v.defined || !Number.isFinite(v.value) || !(v.value > 0)) {
    throw new EngineError(
      `A normal approximation needs a finite mean and a finite positive variance. The ${def.name} distribution with these parameters does not provide them, so no approximation and no error bound are reported.`,
      'undefined-moment',
    );
  }
  const rho = thirdAbsoluteCentralMoment(id, params);
  const sigma = Math.sqrt(v.value);
  const C = 0.4748;
  const bound = (C * rho.value) / (sigma ** 3 * Math.sqrt(n));
  const z = (x - n * m.value) / (sigma * Math.sqrt(n));
  const cdf = normalCdf(z);
  return {
    cdf,
    berryEsseenBound: bound,
    thirdAbsoluteMoment: rho.value,
    constant: C,
    n,
    exactness: 'numerical',
    method: 'Normal (central limit) approximation with a Berry–Esseen error bound',
    notes: [
      `Standardised point z = ${z.toPrecision(8)}; Φ(z) = ${cdf.toPrecision(10)}, and the upper tail is ${normalSf(z).toExponential(6)}.`,
      `Berry–Esseen: |F_n(x) − Φ(z)| ≤ ${C}·ρ/(σ³√n) = ${C}·${rho.value.toPrecision(6)}/(${(sigma ** 3).toPrecision(6)}·√${n}) = ${bound.toExponential(4)}, uniformly in x. The constant 0.4748 is Shevtsova's (2011) value for the i.i.d. case.`,
      `The bound is ABSOLUTE, not relative. At a tail probability near ${normalSf(z).toExponential(2)} it permits an error of ${bound.toExponential(2)}, i.e. a factor of ${normalSf(z) > 0 ? (bound / normalSf(z)).toExponential(2) : '∞'} — which is why a normal approximation must not be used for a far tail however large n is.`,
      ...rho.notes,
    ],
  };
}

/* ------------------------------------------------------------------ *
 * Poisson approximation with a Le Cam bound                          *
 * ------------------------------------------------------------------ */

export interface PoissonApproximation {
  lambda: number;
  /** Total-variation bound on the approximation, Le Cam's inequality. */
  totalVariationBound: number;
  /** Bound on the error of any single probability (half the TV bound). */
  pointwiseBound: number;
  exactness: Exactness;
  method: string;
  notes: string[];
}

/**
 * Poisson approximation to a sum of independent Bernoulli trials, with Le Cam's
 * inequality: Σ_k |P(S = k) − e^{−λ}λ^k/k!| ≤ 2·Σ p_i², so the total-variation
 * distance is at most Σ p_i². The bound does not involve n at all, only the
 * sizes of the individual probabilities — which is the correct statement: the
 * Poisson limit is about rare events, not about many of them.
 */
export function poissonApproximation(probabilities: readonly number[]): PoissonApproximation {
  if (probabilities.length === 0) throw new EngineError('The Poisson approximation needs at least one Bernoulli probability.', 'invalid');
  for (const p of probabilities) {
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new EngineError(`"${p}" is not a probability; every Bernoulli success probability must lie in [0, 1]. No approximation is reported.`, 'range');
    }
  }
  const lambda = stableSum(probabilities);
  const sumSq = stableSum(probabilities.map((p) => p * p));
  return {
    lambda,
    totalVariationBound: Math.min(1, sumSq),
    pointwiseBound: Math.min(1, sumSq),
    exactness: 'numerical',
    method: "Poisson approximation to a Poisson-binomial sum, with Le Cam's total-variation bound",
    notes: [
      `λ = Σ p_i = ${lambda.toPrecision(10)}; Σ p_i² = ${sumSq.toExponential(6)}.`,
      "Le Cam's inequality: Σ_k |P(S = k) − Poisson(λ)(k)| ≤ 2 Σ p_i², so the total-variation distance is at most Σ p_i² = " + sumSq.toExponential(6) + ' and no single probability can be wrong by more than that.',
      'The bound depends only on how small the individual p_i are, not on how many there are. For identical p it is n·p², so the approximation is good when p is small even if np is large.',
    ],
  };
}

/** Le Cam bound specialised to a binomial: λ = np and Σp² = np². */
export function poissonApproximationToBinomial(n: number, p: number): PoissonApproximation {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The binomial n must be a whole number of at least 1.', 'range');
  if (!Number.isFinite(p) || p < 0 || p > 1) throw new EngineError('The binomial p must lie in [0, 1].', 'range');
  const sumSq = n * p * p;
  return {
    lambda: n * p,
    totalVariationBound: Math.min(1, sumSq),
    pointwiseBound: Math.min(1, sumSq),
    exactness: 'numerical',
    method: "Poisson approximation to Binomial(n, p), with Le Cam's bound",
    notes: [
      `λ = np = ${(n * p).toPrecision(10)}; the Le Cam total-variation bound is np² = ${sumSq.toExponential(6)}.`,
      sumSq >= 0.5
        ? `The bound ${sumSq.toExponential(3)} is too large to be informative: with p = ${p} the Poisson approximation is not justified here, and the exact binomial should be used.`
        : 'The bound is small, so the Poisson approximation is justified for these parameters.',
    ],
  };
}
