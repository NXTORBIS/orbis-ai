/**
 * Divergences and distances between discrete distributions, plus closed-form
 * KL divergences within the standard parametric families.
 *
 * The KL divergence is the one measure here that is neither symmetric nor
 * always finite. Both facts are surfaced in the returned object: the direction
 * is labelled, and a zero-support violation is reported as such instead of
 * being handed back as the number `Infinity`.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { stableSum, logSumExp } from '../core/numeric';
import { logBeta, logGamma, digamma } from '../special/gamma';
import { BASE_LABEL, BASE_NUMBER, fromNats, quantity, resolveBase, type InfoQuantity, type LogBase } from './types';
import { validateDistribution, validatePair, type NormaliseOptions } from './distribution';
import { entropyNats, type InfoOptions } from './entropy';

export interface KlResult extends InfoQuantity {
  finite: boolean;
  /** Indices where Q = 0 < P, which make the divergence infinite. */
  offendingIndices: number[];
  infiniteReason?: string;
  /** Human-readable statement of which direction was computed. */
  direction: string;
  /** The reverse divergence D(Q‖P), when it is finite. */
  reverse: number;
  reverseFinite: boolean;
  symmetric: boolean;
  transformations: string[];
  explanation: Explanation;
}

/** D_KL(P‖Q) in nats, or `null` when a zero-support violation makes it infinite. */
export function klNats(p: readonly number[], q: readonly number[]): { nats: number | null; offending: number[] } {
  const offending: number[] = [];
  const terms: number[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue; // 0·log(0/q) = 0 by convention, even if q = 0
    if (q[i] === 0) {
      offending.push(i);
      continue;
    }
    terms.push(p[i] * (Math.log(p[i]) - Math.log(q[i])));
  }
  if (offending.length) return { nats: null, offending };
  // Gibbs' inequality guarantees D ≥ 0; clamp only the rounding noise.
  return { nats: Math.max(0, stableSum(terms)), offending };
}

/**
 * Kullback–Leibler divergence D(P‖Q): the expected extra description length,
 * in the chosen unit, from coding P's outcomes with a code built for Q.
 */
export function klDivergence(pIn: ArrayLike<number>, qIn: ArrayLike<number>, options: InfoOptions = {}): KlResult {
  const base = resolveBase(options);
  const { p, q, transformations } = validatePair(pIn, qIn, options);
  const fwd = klNats(p, q);
  const rev = klNats(q, p);
  const finite = fwd.nats !== null;
  const infiniteReason = finite
    ? undefined
    : `D(P‖Q) is infinite: Q assigns zero probability to outcome(s) ${fwd.offending.join(', ')} where P is positive. ` +
      'No finite number represents this — the model Q rules out something that happens under P.';
  const value = finite ? fromNats(fwd.nats as number, base) : Infinity;
  const reverse = rev.nats !== null ? fromNats(rev.nats, base) : Infinity;
  return {
    value,
    base,
    baseLabel: BASE_LABEL[base],
    exactness: 'exact',
    finite,
    offendingIndices: fwd.offending,
    infiniteReason,
    direction: 'D(P ‖ Q): P is the reference/true distribution, Q the approximation. Swapping them gives a different number.',
    reverse,
    reverseFinite: rev.nats !== null,
    symmetric: finite && rev.nats !== null && Math.abs(value - reverse) <= 1e-12 * Math.max(1, Math.abs(value)),
    transformations,
    explanation: {
      method: 'Kullback–Leibler divergence',
      formula: `D(P ‖ Q) = Σ p(x) log_${BASE_NUMBER[base]}[p(x) / q(x)]`,
      steps: [
        { label: 'D(P ‖ Q)', value: finite ? `${value.toPrecision(10)} ${base}` : 'infinite' },
        { label: 'D(Q ‖ P)', value: rev.nats !== null ? `${reverse.toPrecision(10)} ${base}` : 'infinite' },
      ],
      assumptions: ['P and Q are defined on the same, aligned support.'],
      limitations: [
        'KL divergence is ASYMMETRIC: D(P‖Q) ≠ D(Q‖P) in general, so the direction must always be stated.',
        'It is not a metric: it fails both symmetry and the triangle inequality.',
        'It is infinite when Q gives zero probability where P does not. That case is reported, never returned as a finite number.',
        'For a symmetric, always-finite, bounded alternative use the Jensen–Shannon divergence.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'exact',
    },
  };
}

export interface JsdResult extends InfoQuantity {
  /** sqrt(JSD) — a true metric when the divergence is measured in bits or nats. */
  distance: number;
  /** The upper bound log 2 in the chosen unit. */
  upperBound: number;
  explanation: Explanation;
}

/**
 * Jensen–Shannon divergence: the symmetrised, smoothed KL divergence against
 * the mixture M = (P+Q)/2. Always finite and bounded by log 2.
 */
export function jensenShannonDivergence(
  pIn: ArrayLike<number>,
  qIn: ArrayLike<number>,
  options: InfoOptions = {},
): JsdResult {
  const base = resolveBase(options);
  const { p, q } = validatePair(pIn, qIn, options);
  const m = p.map((v, i) => 0.5 * (v + q[i]));
  // H(M) − ½H(P) − ½H(Q) is the identity form: always finite because M = 0
  // only where both P and Q are 0.
  const nats = Math.max(0, Math.min(Math.LN2, entropyNats(m) - 0.5 * entropyNats(p) - 0.5 * entropyNats(q)));
  const value = fromNats(nats, base);
  return {
    value,
    base,
    baseLabel: BASE_LABEL[base],
    exactness: 'exact',
    distance: Math.sqrt(value),
    upperBound: fromNats(Math.LN2, base),
    explanation: {
      method: 'Jensen–Shannon divergence',
      formula: 'JSD(P, Q) = ½D(P‖M) + ½D(Q‖M) = H(M) − ½H(P) − ½H(Q),  M = (P+Q)/2',
      steps: [
        { label: 'JSD', value: `${value.toPrecision(10)} ${base}` },
        { label: 'Jensen–Shannon distance', expression: '√JSD', value: Math.sqrt(value).toPrecision(10) },
      ],
      assumptions: ['P and Q are on the same support.'],
      limitations: [
        'JSD is symmetric, always finite and bounded above by log 2 (1 bit), which is why it is usable where KL is not.',
        'Its square root is a metric; the divergence itself is not.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness: 'exact',
    },
  };
}

export interface DistanceSet {
  /** ½Σ|p−q| ∈ [0,1]. */
  totalVariation: number;
  /** Hellinger distance √(½Σ(√p−√q)²) ∈ [0,1]. */
  hellinger: number;
  /** Squared Hellinger distance. */
  hellingerSquared: number;
  /** Bhattacharyya coefficient Σ√(pq) ∈ [0,1]. */
  bhattacharyyaCoefficient: number;
  /** −log BC; infinite when the supports are disjoint. */
  bhattacharyyaDistance: number;
  bhattacharyyaFinite: boolean;
  /** χ²(P‖Q) = Σ (p−q)²/q; infinite when Q = 0 < P. */
  chiSquared: number;
  chiSquaredFinite: boolean;
  base: LogBase;
  explanation: Explanation;
}

/** Total variation, Hellinger, Bhattacharyya and χ² together, with their relationships. */
export function distances(pIn: ArrayLike<number>, qIn: ArrayLike<number>, options: InfoOptions = {}): DistanceSet {
  const base = resolveBase(options);
  const { p, q } = validatePair(pIn, qIn, options);
  const tv = 0.5 * stableSum(p.map((v, i) => Math.abs(v - q[i])));
  const h2 = 0.5 * stableSum(p.map((v, i) => (Math.sqrt(v) - Math.sqrt(q[i])) ** 2));
  const bc = stableSum(p.map((v, i) => Math.sqrt(v * q[i])));
  let chi2 = 0;
  let chiFinite = true;
  const chiTerms: number[] = [];
  for (let i = 0; i < p.length; i++) {
    if (q[i] === 0) {
      if (p[i] > 0) chiFinite = false;
      continue;
    }
    chiTerms.push((p[i] - q[i]) ** 2 / q[i]);
  }
  chi2 = chiFinite ? stableSum(chiTerms) : Infinity;
  const bcClamped = Math.min(1, Math.max(0, bc));
  return {
    totalVariation: Math.min(1, Math.max(0, tv)),
    hellinger: Math.sqrt(Math.min(1, Math.max(0, h2))),
    hellingerSquared: Math.min(1, Math.max(0, h2)),
    bhattacharyyaCoefficient: bcClamped,
    bhattacharyyaDistance: bcClamped > 0 ? -Math.log(bcClamped) / (base === 'nats' ? 1 : Math.log(BASE_NUMBER[base])) : Infinity,
    bhattacharyyaFinite: bcClamped > 0,
    chiSquared: chi2,
    chiSquaredFinite: chiFinite,
    base,
    explanation: {
      method: 'f-divergences and metric distances',
      formula: 'TV = ½Σ|p−q|;  H² = ½Σ(√p−√q)²;  BC = Σ√(pq);  χ² = Σ(p−q)²/q',
      steps: [
        { label: 'Total variation', value: tv.toPrecision(10) },
        { label: 'Hellinger', value: Math.sqrt(h2).toPrecision(10) },
        { label: 'Bhattacharyya coefficient', value: bcClamped.toPrecision(10) },
        { label: 'χ² divergence', value: chiFinite ? chi2.toPrecision(10) : 'infinite' },
      ],
      assumptions: ['P and Q are on the same support.'],
      limitations: [
        'Total variation and Hellinger are bounded metrics; χ² is an asymmetric divergence and can be infinite.',
        'The Bhattacharyya distance is infinite when the two supports do not overlap at all.',
        'Known relations: H² ≤ TV ≤ H√(2−H²), and TV ≤ √(KL/2) (Pinsker).',
      ],
      exactness: 'exact',
    },
  };
}

/** Rényi (α-)divergence D_α(P‖Q) = (1/(α−1)) log Σ pᵃ q^(1−α). */
export function renyiDivergence(
  pIn: ArrayLike<number>,
  qIn: ArrayLike<number>,
  alpha: number,
  options: InfoOptions = {},
): InfoQuantity & { alpha: number; finite: boolean; note?: string } {
  const base = resolveBase(options);
  if (!Number.isFinite(alpha) || alpha <= 0) {
    throw new EngineError(`Rényi divergence order α must be a finite number > 0; got ${alpha}.`, 'range');
  }
  const { p, q } = validatePair(pIn, qIn, options);
  if (Math.abs(alpha - 1) < 1e-8) {
    const k = klNats(p, q);
    return {
      ...quantity(k.nats ?? Infinity, base, alpha === 1 ? 'exact' : 'numerical'),
      alpha,
      finite: k.nats !== null,
      note: 'The α → 1 limit of the Rényi divergence is the KL divergence, which is used here.',
    };
  }
  const logs: number[] = [];
  let finite = true;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue;
    if (q[i] === 0) {
      // p^α q^(1−α) with 1−α < 0 blows up; with 1−α > 0 the term is 0.
      if (alpha > 1) finite = false;
      continue;
    }
    logs.push(alpha * Math.log(p[i]) + (1 - alpha) * Math.log(q[i]));
  }
  if (!finite) {
    return {
      ...quantity(Infinity, base, 'exact'),
      alpha,
      finite: false,
      note: `For α = ${alpha} > 1 the divergence is infinite because Q assigns zero probability where P is positive.`,
    };
  }
  const nats = logs.length === 0 ? Infinity : logSumExp(logs) / (alpha - 1);
  return { ...quantity(Math.max(0, nats), base, 'exact'), alpha, finite: Number.isFinite(nats) };
}

/* ------------------------------------------------------------------ */
/* Wasserstein-1                                                      */
/* ------------------------------------------------------------------ */

export interface WassersteinResult {
  value: number;
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Wasserstein-1 (earth mover's) distance between two one-dimensional discrete
 * distributions with numeric support points.
 *
 * W₁ = ∫|F(x) − G(x)| dx, evaluated exactly as a sum over the intervals
 * between consecutive atoms of the pooled support — on each such interval both
 * CDFs are constant, so the integral is a finite sum of rectangles with no
 * approximation.
 */
export function wasserstein1(
  xValues: ArrayLike<number>,
  pIn: ArrayLike<number>,
  yValues: ArrayLike<number>,
  qIn: ArrayLike<number>,
  options: NormaliseOptions = {},
): WassersteinResult {
  if (xValues.length !== pIn.length) {
    throw new EngineError(
      `P has ${pIn.length} probabilities but ${xValues.length} support values were given.`,
      'shape',
    );
  }
  if (yValues.length !== qIn.length) {
    throw new EngineError(
      `Q has ${qIn.length} probabilities but ${yValues.length} support values were given.`,
      'shape',
    );
  }
  const vp = validateDistribution(pIn, { ...options, field: 'P' });
  const vq = validateDistribution(qIn, { ...options, field: 'Q' });
  for (let i = 0; i < xValues.length; i++) {
    if (!Number.isFinite(xValues[i])) throw new EngineError(`Support value for P at index ${i} is not finite.`, 'finite');
  }
  for (let i = 0; i < yValues.length; i++) {
    if (!Number.isFinite(yValues[i])) throw new EngineError(`Support value for Q at index ${i} is not finite.`, 'finite');
  }
  type Atom = { x: number; p: number; q: number };
  const map = new Map<number, Atom>();
  const put = (x: number, p: number, q: number) => {
    const cur = map.get(x);
    if (cur) {
      cur.p += p;
      cur.q += q;
    } else map.set(x, { x, p, q });
  };
  for (let i = 0; i < xValues.length; i++) put(xValues[i], vp.p[i], 0);
  for (let i = 0; i < yValues.length; i++) put(yValues[i], 0, vq.p[i]);
  const atoms = [...map.values()].sort((a, b) => a.x - b.x);
  let cp = 0;
  let cq = 0;
  const parts: number[] = [];
  for (let i = 0; i < atoms.length - 1; i++) {
    cp += atoms[i].p;
    cq += atoms[i].q;
    parts.push(Math.abs(cp - cq) * (atoms[i + 1].x - atoms[i].x));
  }
  const value = stableSum(parts);
  return {
    value,
    exactness: 'exact',
    explanation: {
      method: 'Wasserstein-1 (earth mover’s) distance, 1-D',
      formula: 'W₁(P, Q) = ∫ |F(x) − G(x)| dx',
      steps: [
        { label: 'Pooled support points', value: String(atoms.length) },
        { label: 'W₁', value: value.toPrecision(10) },
      ],
      assumptions: ['The support values are on a meaningful numeric scale — W₁ has the units of that scale, unlike the entropy-based measures.'],
      limitations: [
        'W₁ is exact here because both CDFs are piecewise constant between atoms; no quadrature is involved.',
        'Unlike KL or JSD, W₁ is sensitive to how far apart the outcomes are, not only to how the mass is split. It is also finite for disjoint supports.',
      ],
      exactness: 'exact',
    },
  };
}

/* ------------------------------------------------------------------ */
/* Closed-form KL within families                                     */
/* ------------------------------------------------------------------ */

export interface ClosedFormKl {
  family: string;
  /** D(P‖Q) in nats. */
  nats: number;
  /** D(P‖Q) in the requested unit. */
  value: number;
  base: LogBase;
  formula: string;
  exactness: 'exact';
}

function req(params: Record<string, number>, key: string, family: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new EngineError(`Closed-form KL for the ${family} family requires a finite parameter "${key}".`, 'finite');
  }
  return v;
}

function pos(params: Record<string, number>, key: string, family: string): number {
  const v = req(params, key, family);
  if (v <= 0) throw new EngineError(`Closed-form KL for the ${family} family requires "${key}" > 0; got ${v}.`, 'range');
  return v;
}

/**
 * Exact KL divergence between two members of the same parametric family.
 *
 * Supported ids: normal, exponential, gamma, poisson, beta, bernoulli,
 * dirichlet. These are analytic, so they carry exactness 'exact'.
 */
export function closedFormKl(
  family: string,
  pParams: Record<string, number>,
  qParams: Record<string, number>,
  options: { base?: LogBase } = {},
): ClosedFormKl {
  const base = resolveBase(options);
  let nats: number;
  let formula: string;
  switch (family) {
    case 'normal': {
      const m1 = req(pParams, 'mu', 'normal');
      const s1 = pos(pParams, 'sigma', 'normal');
      const m2 = req(qParams, 'mu', 'normal');
      const s2 = pos(qParams, 'sigma', 'normal');
      nats = Math.log(s2 / s1) + (s1 * s1 + (m1 - m2) ** 2) / (2 * s2 * s2) - 0.5;
      formula = 'D = ln(σ₂/σ₁) + (σ₁² + (μ₁−μ₂)²)/(2σ₂²) − ½';
      break;
    }
    case 'exponential': {
      const l1 = pos(pParams, 'lambda', 'exponential');
      const l2 = pos(qParams, 'lambda', 'exponential');
      nats = Math.log(l1 / l2) + l2 / l1 - 1;
      formula = 'D = ln(λ₁/λ₂) + λ₂/λ₁ − 1';
      break;
    }
    case 'gamma': {
      const k1 = pos(pParams, 'k', 'gamma');
      const t1 = pos(pParams, 'theta', 'gamma');
      const k2 = pos(qParams, 'k', 'gamma');
      const t2 = pos(qParams, 'theta', 'gamma');
      nats =
        (k1 - k2) * digamma(k1) -
        logGamma(k1) +
        logGamma(k2) +
        k2 * (Math.log(t2) - Math.log(t1)) +
        (k1 * (t1 - t2)) / t2;
      formula = 'D = (k₁−k₂)ψ(k₁) − lnΓ(k₁) + lnΓ(k₂) + k₂ln(θ₂/θ₁) + k₁(θ₁−θ₂)/θ₂';
      break;
    }
    case 'poisson': {
      const l1 = pos(pParams, 'lambda', 'poisson');
      const l2 = pos(qParams, 'lambda', 'poisson');
      nats = l2 - l1 + l1 * Math.log(l1 / l2);
      formula = 'D = λ₂ − λ₁ + λ₁ ln(λ₁/λ₂)';
      break;
    }
    case 'beta': {
      const a1 = pos(pParams, 'alpha', 'beta');
      const b1 = pos(pParams, 'beta', 'beta');
      const a2 = pos(qParams, 'alpha', 'beta');
      const b2 = pos(qParams, 'beta', 'beta');
      nats =
        logBeta(a2, b2) -
        logBeta(a1, b1) +
        (a1 - a2) * digamma(a1) +
        (b1 - b2) * digamma(b1) +
        (a2 - a1 + b2 - b1) * digamma(a1 + b1);
      formula = 'D = ln[B(α₂,β₂)/B(α₁,β₁)] + (α₁−α₂)ψ(α₁) + (β₁−β₂)ψ(β₁) + (α₂−α₁+β₂−β₁)ψ(α₁+β₁)';
      break;
    }
    case 'bernoulli': {
      const p1 = req(pParams, 'p', 'bernoulli');
      const p2 = req(qParams, 'p', 'bernoulli');
      if (p1 < 0 || p1 > 1 || p2 < 0 || p2 > 1) {
        throw new EngineError('Bernoulli parameters must lie in [0, 1].', 'range');
      }
      if ((p1 > 0 && p2 === 0) || (p1 < 1 && p2 === 1)) {
        throw new EngineError(
          `KL(Bernoulli(${p1}) ‖ Bernoulli(${p2})) is infinite: Q rules out an outcome P allows. No finite value exists.`,
          'support',
        );
      }
      const t1 = p1 === 0 ? 0 : p1 * Math.log(p1 / p2);
      const t2 = p1 === 1 ? 0 : (1 - p1) * Math.log((1 - p1) / (1 - p2));
      nats = t1 + t2;
      formula = 'D = p ln(p/q) + (1−p) ln[(1−p)/(1−q)]';
      break;
    }
    case 'dirichlet': {
      throw new EngineError(
        'Use dirichletKl(alphaP, alphaQ) for the Dirichlet family — its parameters are vectors, not named scalars.',
        'shape',
      );
    }
    default:
      throw new EngineError(
        `No closed-form KL divergence is implemented for the family "${family}". ` +
          'Available: normal, exponential, gamma, poisson, beta, bernoulli (and dirichletKl for the Dirichlet).',
        'unknown',
      );
  }
  if (!Number.isFinite(nats)) {
    throw new EngineError(`The closed-form KL for the ${family} family evaluated to a non-finite value; check the parameters.`, 'numerical');
  }
  return { family, nats: Math.max(0, nats), value: fromNats(Math.max(0, nats), base), base, formula, exactness: 'exact' };
}

/** Exact KL divergence between two Dirichlet distributions. */
export function dirichletKl(
  alphaP: ArrayLike<number>,
  alphaQ: ArrayLike<number>,
  options: { base?: LogBase } = {},
): ClosedFormKl {
  const base = resolveBase(options);
  if (alphaP.length !== alphaQ.length) {
    throw new EngineError(
      `Dirichlet KL needs the same dimension for both: P has ${alphaP.length} components and Q has ${alphaQ.length}.`,
      'support',
    );
  }
  const n = alphaP.length;
  if (n < 2) throw new EngineError('A Dirichlet distribution needs at least 2 components.', 'shape');
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    if (!(alphaP[i] > 0) || !(alphaQ[i] > 0)) {
      throw new EngineError(`Dirichlet concentration parameters must all be > 0; index ${i} is not.`, 'range');
    }
    s1 += alphaP[i];
    s2 += alphaQ[i];
  }
  let nats = logGamma(s1) - logGamma(s2);
  for (let i = 0; i < n; i++) {
    nats += logGamma(alphaQ[i]) - logGamma(alphaP[i]);
    nats += (alphaP[i] - alphaQ[i]) * (digamma(alphaP[i]) - digamma(s1));
  }
  return {
    family: 'dirichlet',
    nats: Math.max(0, nats),
    value: fromNats(Math.max(0, nats), base),
    base,
    formula: 'D = lnΓ(α₀) − Σ lnΓ(αᵢ) − lnΓ(β₀) + Σ lnΓ(βᵢ) + Σ (αᵢ−βᵢ)[ψ(αᵢ) − ψ(α₀)]',
    exactness: 'exact',
  };
}

/* ------------------------------------------------------------------ */
/* Inequalities between divergences                                   */
/* ------------------------------------------------------------------ */

export interface DivergenceBounds {
  /** Total variation distance. */
  totalVariation: number;
  /** KL divergence in nats (the unit Pinsker's inequality is stated in). */
  klNats: number;
  klFinite: boolean;
  /** Pinsker bound √(KL/2) on the total variation. */
  pinskerBound: number;
  pinskerHolds: boolean;
  /** Bretagnolle–Huber bound √(1 − e^{−KL}) — tighter than Pinsker for large KL. */
  bretagnolleHuberBound: number;
  bretagnolleHuberHolds: boolean;
  /** Hellinger-based sandwich H² ≤ TV ≤ H√(2 − H²). */
  hellingerSquared: number;
  hellingerUpperBound: number;
  hellingerSandwichHolds: boolean;
  explanation: Explanation;
}

/**
 * Check the standard inequalities between the divergences on a concrete pair,
 * so the user can see that the measures are mutually consistent rather than
 * taking it on trust.
 */
export function divergenceBounds(
  pIn: ArrayLike<number>,
  qIn: ArrayLike<number>,
  options: NormaliseOptions = {},
): DivergenceBounds {
  const { p, q } = validatePair(pIn, qIn, options);
  const d = distances(p, q, { base: 'nats' });
  const k = klNats(p, q);
  const kl = k.nats ?? Infinity;
  const pinsker = Math.sqrt(kl / 2);
  const bh = Math.sqrt(1 - Math.exp(-kl));
  const h2 = d.hellingerSquared;
  const hUpper = d.hellinger * Math.sqrt(2 - h2);
  // Slack of 1e-12 absorbs floating-point noise only; the inequalities are exact.
  const slack = 1e-12;
  return {
    totalVariation: d.totalVariation,
    klNats: kl,
    klFinite: k.nats !== null,
    pinskerBound: pinsker,
    pinskerHolds: d.totalVariation <= pinsker + slack,
    bretagnolleHuberBound: bh,
    bretagnolleHuberHolds: d.totalVariation <= bh + slack,
    hellingerSquared: h2,
    hellingerUpperBound: hUpper,
    hellingerSandwichHolds: h2 <= d.totalVariation + slack && d.totalVariation <= hUpper + slack,
    explanation: {
      method: 'Consistency checks between divergences',
      formula: 'TV ≤ √(KL/2) (Pinsker);  TV ≤ √(1 − e^{−KL}) (Bretagnolle–Huber);  H² ≤ TV ≤ H√(2 − H²)',
      steps: [
        { label: 'Total variation', value: d.totalVariation.toPrecision(10) },
        { label: 'KL (nats)', value: Number.isFinite(kl) ? kl.toPrecision(10) : 'infinite' },
        { label: 'Pinsker bound', value: Number.isFinite(pinsker) ? pinsker.toPrecision(10) : 'infinite' },
        { label: 'Bretagnolle–Huber bound', value: bh.toPrecision(10) },
      ],
      assumptions: ['KL is taken in nats, which is the form in which Pinsker’s inequality is stated.'],
      limitations: [
        'Pinsker is loose for large KL (the bound can exceed 1 while TV cannot); Bretagnolle–Huber is the better bound there.',
        'These are one-directional bounds: a small KL implies a small TV, but a large KL does not imply a large TV.',
      ],
      exactness: 'exact',
    },
  };
}
