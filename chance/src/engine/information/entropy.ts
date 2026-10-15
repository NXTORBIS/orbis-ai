/**
 * Discrete entropy and information measures.
 *
 * Conventions used throughout:
 *  - 0·log0 = 0. This is the continuity convention (x log x → 0 as x → 0⁺) and
 *    it is applied explicitly everywhere; a zero-probability outcome never
 *    produces NaN.
 *  - All sums are accumulated in nats with compensated summation and converted
 *    to the requested unit once, at the end.
 *  - Powers Σ pᵃ are evaluated with logSumExp over a·log p rather than as a
 *    naive product, which underflows for long vectors or large a.
 */
import { EngineError } from '../core/result';
import type { Explanation } from '../core/result';
import { logSumExp, stableSum } from '../core/numeric';
import {
  BASE_LABEL,
  BASE_NUMBER,
  fromNats,
  quantity,
  resolveBase,
  type BaseOptions,
  type InfoQuantity,
  type LogBase,
} from './types';
import {
  flattenNested,
  nestedShape,
  validateDistribution,
  validateJoint,
  type NestedProbabilities,
  type NormaliseOptions,
} from './distribution';

/** x·ln x with the 0·log0 = 0 convention applied explicitly. */
export function xLogX(x: number): number {
  if (x === 0) return 0;
  if (x < 0) throw new EngineError(`x·log x is undefined for the negative value ${x}.`, 'range');
  return x * Math.log(x);
}

/** Shannon entropy in nats of an already-validated probability vector. */
export function entropyNats(p: readonly number[]): number {
  const terms = new Array<number>(p.length);
  for (let i = 0; i < p.length; i++) terms[i] = -xLogX(p[i]);
  // Rounding can make a deterministic distribution come out as a tiny
  // negative number; entropy is non-negative by definition.
  return Math.max(0, stableSum(terms));
}

export type InfoOptions = BaseOptions & NormaliseOptions;

export interface EntropyResult extends InfoQuantity {
  /** Number of outcomes supplied. */
  outcomes: number;
  /** Number of outcomes with strictly positive probability. */
  support: number;
  /** log(support size) — the maximum entropy attainable on this support. */
  maximum: number;
  /** H / maximum, i.e. how close the distribution is to uniform (0 when a single outcome). */
  efficiency: number;
  /** maximum − H: how far from uniform, in the same unit. */
  redundancy: number;
  /** base^H — the equivalent number of equally likely outcomes. */
  perplexity: number;
  /** Set when the caller allowed normalisation and it was applied. */
  transformation?: string;
  explanation: Explanation;
}

/** Shannon entropy H(X) = −Σ p log p. */
export function shannonEntropy(probabilities: ArrayLike<number>, options: InfoOptions = {}): EntropyResult {
  const base = resolveBase(options);
  const v = validateDistribution(probabilities, options);
  const nats = entropyNats(v.p);
  const support = v.p.filter((x) => x > 0).length;
  const maxNats = Math.log(support);
  const value = fromNats(nats, base);
  const maximum = fromNats(maxNats, base);
  const explanation: Explanation = {
    method: 'Shannon entropy',
    formula: `H(X) = −Σ p(x) log_${BASE_NUMBER[base]} p(x)`,
    steps: [
      { label: 'Outcomes', value: String(v.p.length) },
      { label: 'Outcomes with positive probability', value: String(support) },
      { label: 'Entropy', expression: 'H(X)', value: `${value.toPrecision(10)} ${base}` },
      { label: 'Maximum on this support', expression: `log_${BASE_NUMBER[base]} ${support}`, value: `${maximum.toPrecision(10)} ${base}` },
      { label: 'Perplexity', expression: `${BASE_NUMBER[base]}^H`, value: Math.exp(nats).toPrecision(10) },
    ],
    assumptions: ['The listed probabilities are the complete distribution of X.'],
    limitations: [
      'Entropy depends only on the probabilities, not on the labels or the numeric values of the outcomes; it is not a measure of spread.',
      'The 0·log0 = 0 convention is used, so zero-probability outcomes contribute nothing.',
      `Reported in ${BASE_LABEL[base]}.`,
    ],
    exactness: 'exact',
  };
  if (v.transformation) explanation.steps.unshift({ label: 'Normalisation applied', value: v.transformation });
  return {
    value,
    base,
    baseLabel: BASE_LABEL[base],
    exactness: 'exact',
    outcomes: v.p.length,
    support,
    maximum,
    efficiency: maxNats > 0 ? nats / maxNats : 0,
    redundancy: maximum - value,
    perplexity: Math.exp(nats),
    transformation: v.transformation,
    explanation,
  };
}

/** Entropy of an arbitrary-dimensional joint distribution (the joint entropy). */
export function jointEntropy(table: NestedProbabilities, options: InfoOptions = {}): EntropyResult {
  nestedShape(table, options.field ?? 'joint distribution');
  return shannonEntropy(flattenNested(table), options);
}

export interface MutualInformationResult {
  base: LogBase;
  baseLabel: string;
  /** H(X). */
  hx: number;
  /** H(Y). */
  hy: number;
  /** H(X,Y). */
  hxy: number;
  /** H(X|Y). */
  hxGivenY: number;
  /** H(Y|X). */
  hyGivenX: number;
  /** I(X;Y). */
  mutualInformation: number;
  /** Information gained about X by learning Y — numerically identical to I(X;Y). */
  informationGainAboutX: number;
  /** Information gained about Y by learning X. */
  informationGainAboutY: number;
  /** I(X;Y) / sqrt(H(X)·H(Y)). */
  normalisedSqrt: number;
  /** I(X;Y) / min(H(X), H(Y)). */
  normalisedMin: number;
  /** I(X;Y) / max(H(X), H(Y)). */
  normalisedMax: number;
  /** 2·I(X;Y) / (H(X)+H(Y)) — "symmetric uncertainty". */
  normalisedSum: number;
  /** I(X;Y) / H(X,Y) — the redundancy / "normalised joint" variant. */
  normalisedJoint: number;
  /** H(X|Y) + H(Y|X) — variation of information, a metric. */
  variationOfInformation: number;
  /** VI / H(X,Y) ∈ [0,1] — the normalised metric. */
  normalisedVariationOfInformation: number;
  /** Marginal of X. */
  px: number[];
  /** Marginal of Y. */
  py: number[];
  exactness: 'exact';
  explanation: Explanation;
}

/**
 * Mutual information and the associated conditional entropies from a joint
 * table. All three standard forms of I(X;Y) agree by construction here because
 * the same compensated sums feed each one.
 */
export function mutualInformation(
  table: readonly ArrayLike<number>[],
  options: InfoOptions = {},
): MutualInformationResult {
  const base = resolveBase(options);
  const j = validateJoint(table, options);
  const hxyN = entropyNats(j.joint.flat());
  const hxN = entropyNats(j.px);
  const hyN = entropyNats(j.py);
  // I(X;Y) = Σ p(x,y) log(p(x,y) / (p(x)p(y))) — computed directly, in logs,
  // so the value is accurate even when the sum H(X)+H(Y)−H(X,Y) would cancel.
  const terms: number[] = [];
  for (let i = 0; i < j.rows; i++) {
    for (let k = 0; k < j.cols; k++) {
      const pxy = j.joint[i][k];
      if (pxy === 0) continue; // 0·log0 = 0
      terms.push(pxy * (Math.log(pxy) - Math.log(j.px[i]) - Math.log(j.py[k])));
    }
  }
  const miN = Math.max(0, stableSum(terms));
  const hxGivenYN = Math.max(0, hxyN - hyN);
  const hyGivenXN = Math.max(0, hxyN - hxN);
  const viN = hxGivenYN + hyGivenXN;
  const c = (x: number) => fromNats(x, base);
  const explanation: Explanation = {
    method: 'Mutual information from a joint distribution',
    formula: 'I(X;Y) = Σ p(x,y) log[p(x,y) / (p(x)p(y))] = H(X) + H(Y) − H(X,Y) = H(X) − H(X|Y)',
    steps: [
      { label: 'H(X)', value: `${c(hxN).toPrecision(10)} ${base}` },
      { label: 'H(Y)', value: `${c(hyN).toPrecision(10)} ${base}` },
      { label: 'H(X,Y)', value: `${c(hxyN).toPrecision(10)} ${base}` },
      { label: 'I(X;Y)', value: `${c(miN).toPrecision(10)} ${base}` },
      { label: 'Variation of information', expression: 'H(X|Y) + H(Y|X)', value: `${c(viN).toPrecision(10)} ${base}` },
    ],
    assumptions: ['The joint table is the complete joint distribution of (X, Y).'],
    limitations: [
      'Mutual information measures statistical dependence of any shape, not a direction of causation.',
      'I(X;Y) = 0 if and only if X and Y are independent; it is never negative.',
      'The normalised variants have different ranges and are not interchangeable — compare like with like.',
      `Reported in ${BASE_LABEL[base]}.`,
    ],
    exactness: 'exact',
  };
  if (j.transformation) explanation.steps.unshift({ label: 'Normalisation applied', value: j.transformation });
  const hx = c(hxN);
  const hy = c(hyN);
  const hxy = c(hxyN);
  const mi = c(miN);
  const safeDiv = (a: number, b: number) => (b > 0 ? a / b : 0);
  return {
    base,
    baseLabel: BASE_LABEL[base],
    hx,
    hy,
    hxy,
    hxGivenY: c(hxGivenYN),
    hyGivenX: c(hyGivenXN),
    mutualInformation: mi,
    informationGainAboutX: mi,
    informationGainAboutY: mi,
    normalisedSqrt: hxN > 0 && hyN > 0 ? miN / Math.sqrt(hxN * hyN) : 0,
    normalisedMin: safeDiv(miN, Math.min(hxN, hyN)),
    normalisedMax: safeDiv(miN, Math.max(hxN, hyN)),
    normalisedSum: safeDiv(2 * miN, hxN + hyN),
    normalisedJoint: safeDiv(miN, hxyN),
    variationOfInformation: c(viN),
    normalisedVariationOfInformation: safeDiv(viN, hxyN),
    px: j.px,
    py: j.py,
    exactness: 'exact',
    explanation,
  };
}

/** Conditional entropy H(Y|X) = H(X,Y) − H(X) from a joint table. */
export function conditionalEntropy(table: readonly ArrayLike<number>[], options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const j = validateJoint(table, options);
  const nats = Math.max(0, entropyNats(j.joint.flat()) - entropyNats(j.px));
  return quantity(nats, base, 'exact');
}

export interface CrossEntropyResult extends InfoQuantity {
  finite: boolean;
  offendingIndices: number[];
  infiniteReason?: string;
  /** H(p) — cross-entropy minus KL. */
  entropyOfP: number;
  explanation: Explanation;
}

/**
 * Cross-entropy H(P, Q) = −Σ p log q. Infinite whenever Q assigns zero
 * probability to an outcome P gives positive probability: that case is
 * reported, not returned as a bare Infinity.
 */
export function crossEntropy(
  pIn: ArrayLike<number>,
  qIn: ArrayLike<number>,
  options: InfoOptions = {},
): CrossEntropyResult {
  const base = resolveBase(options);
  if (pIn.length !== qIn.length) {
    throw new EngineError(
      `Cross-entropy needs P and Q on the same support, but P has ${pIn.length} outcome(s) and Q has ${qIn.length}.`,
      'support',
    );
  }
  const p = validateDistribution(pIn, { ...options, field: 'P' }).p;
  const q = validateDistribution(qIn, { ...options, field: 'Q' }).p;
  const offending: number[] = [];
  const terms: number[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i] === 0) continue; // 0·log0 = 0 regardless of q
    if (q[i] === 0) {
      offending.push(i);
      continue;
    }
    terms.push(-p[i] * Math.log(q[i]));
  }
  const finite = offending.length === 0;
  const nats = finite ? stableSum(terms) : Infinity;
  const hp = entropyNats(p);
  const explanation: Explanation = {
    method: 'Cross-entropy',
    formula: 'H(P, Q) = −Σ p(x) log q(x) = H(P) + D_KL(P ‖ Q)',
    steps: [
      { label: 'H(P)', value: `${fromNats(hp, base).toPrecision(10)} ${base}` },
      {
        label: 'H(P, Q)',
        value: finite ? `${fromNats(nats, base).toPrecision(10)} ${base}` : 'infinite',
      },
    ],
    assumptions: ['P is the reference (data) distribution and Q is the model; the order is not symmetric.'],
    limitations: [
      'Cross-entropy is not symmetric: H(P, Q) ≠ H(Q, P).',
      'It is infinite when the model Q rules out something P allows, which is reported explicitly rather than returned as a number.',
      `Reported in ${BASE_LABEL[base]}.`,
    ],
    exactness: 'exact',
  };
  return {
    value: finite ? fromNats(nats, base) : Infinity,
    base,
    baseLabel: BASE_LABEL[base],
    exactness: 'exact',
    finite,
    offendingIndices: offending,
    infiniteReason: finite
      ? undefined
      : `Q assigns zero probability to outcome(s) ${offending.join(', ')} where P is positive, so the cross-entropy is infinite.`,
    entropyOfP: fromNats(hp, base),
    explanation,
  };
}

/* ------------------------------------------------------------------ */
/* Multivariate measures                                              */
/* ------------------------------------------------------------------ */

/** Marginalise a flat joint over `shape` down to the chosen axes. */
function marginal(flat: readonly number[], shape: readonly number[], keep: readonly number[]): number[] {
  const strides = new Array<number>(shape.length);
  let s = 1;
  for (let d = shape.length - 1; d >= 0; d--) {
    strides[d] = s;
    s *= shape[d];
  }
  const outSize = keep.reduce((acc, d) => acc * shape[d], 1);
  const out = new Array<number>(outSize).fill(0);
  for (let idx = 0; idx < flat.length; idx++) {
    let rem = idx;
    const coords = new Array<number>(shape.length);
    for (let d = 0; d < shape.length; d++) {
      coords[d] = Math.floor(rem / strides[d]);
      rem -= coords[d] * strides[d];
    }
    let o = 0;
    for (const d of keep) o = o * shape[d] + coords[d];
    out[o] += flat[idx];
  }
  return out;
}

export interface MultiJoint {
  flat: number[];
  shape: number[];
}

/** Validate an n-dimensional joint distribution. */
export function validateMultiJoint(table: NestedProbabilities, options: NormaliseOptions = {}): MultiJoint {
  const shape = nestedShape(table, options.field ?? 'joint distribution');
  if (shape.length < 1) throw new EngineError('A joint distribution needs at least one axis.', 'shape');
  const v = validateDistribution(flattenNested(table), options);
  return { flat: v.p, shape };
}

/** Entropy in nats of a set of axes of an n-dimensional joint. */
function axisEntropy(j: MultiJoint, axes: readonly number[]): number {
  if (axes.length === 0) return 0;
  return entropyNats(marginal(j.flat, j.shape, axes));
}

/**
 * Conditional mutual information I(X;Y|Z) for a 3-axis joint
 * (axes 0 = X, 1 = Y, 2 = Z) = H(X,Z) + H(Y,Z) − H(X,Y,Z) − H(Z).
 */
export function conditionalMutualInformation(
  table: NestedProbabilities,
  options: InfoOptions = {},
): InfoQuantity & { explanation: Explanation } {
  const base = resolveBase(options);
  const j = validateMultiJoint(table, options);
  if (j.shape.length !== 3) {
    throw new EngineError(
      `Conditional mutual information needs a 3-dimensional joint table (X, Y, Z); the table supplied has ${j.shape.length} axis/axes.`,
      'shape',
    );
  }
  const nats = Math.max(
    0,
    axisEntropy(j, [0, 2]) + axisEntropy(j, [1, 2]) - axisEntropy(j, [0, 1, 2]) - axisEntropy(j, [2]),
  );
  const q = quantity(nats, base, 'exact');
  return {
    ...q,
    explanation: {
      method: 'Conditional mutual information',
      formula: 'I(X;Y|Z) = H(X,Z) + H(Y,Z) − H(X,Y,Z) − H(Z)',
      steps: [{ label: 'I(X;Y|Z)', value: `${q.value.toPrecision(10)} ${base}` }],
      assumptions: ['Axis 0 is X, axis 1 is Y and axis 2 is the conditioning variable Z.'],
      limitations: [
        'Conditioning can either raise or lower mutual information: I(X;Y|Z) may exceed or fall below I(X;Y).',
        'A conditional mutual information of 0 means conditional independence given Z, which does not imply marginal independence.',
      ],
      exactness: 'exact',
    },
  };
}

/**
 * Interaction information (co-information) for three variables,
 * II = I(X;Y|Z) − I(X;Y). Positive means Z *enables* the X–Y dependence
 * (synergy); negative means the dependence is redundant with Z. Unlike mutual
 * information it can legitimately be negative.
 */
export function interactionInformation(table: NestedProbabilities, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const j = validateMultiJoint(table, options);
  if (j.shape.length !== 3) {
    throw new EngineError(
      `Interaction information needs a 3-dimensional joint table; the table supplied has ${j.shape.length} axis/axes.`,
      'shape',
    );
  }
  const cmi = axisEntropy(j, [0, 2]) + axisEntropy(j, [1, 2]) - axisEntropy(j, [0, 1, 2]) - axisEntropy(j, [2]);
  const mi = axisEntropy(j, [0]) + axisEntropy(j, [1]) - axisEntropy(j, [0, 1]);
  return quantity(cmi - mi, base, 'exact');
}

/**
 * Total correlation (multi-information) C = Σ H(Xᵢ) − H(X₁,…,Xₙ) ≥ 0, the
 * amount of shared information across all axes at once.
 */
export function totalCorrelation(table: NestedProbabilities, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const j = validateMultiJoint(table, options);
  let sum = 0;
  for (let d = 0; d < j.shape.length; d++) sum += axisEntropy(j, [d]);
  const all = j.shape.map((_, d) => d);
  return quantity(Math.max(0, sum - axisEntropy(j, all)), base, 'exact');
}

/** Dual total correlation (binding information) = H(X) − Σ H(Xᵢ | rest). */
export function dualTotalCorrelation(table: NestedProbabilities, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const j = validateMultiJoint(table, options);
  const all = j.shape.map((_, d) => d);
  const hAll = axisEntropy(j, all);
  let sum = 0;
  for (let d = 0; d < j.shape.length; d++) {
    const rest = all.filter((x) => x !== d);
    sum += hAll - axisEntropy(j, rest);
  }
  return quantity(Math.max(0, hAll - sum), base, 'exact');
}

/* ------------------------------------------------------------------ */
/* Generalised entropies                                              */
/* ------------------------------------------------------------------ */

/** log Σ pᵃ evaluated in log space (no underflow for large a). */
function logPowerSum(p: readonly number[], a: number): number {
  const logs: number[] = [];
  for (const v of p) if (v > 0) logs.push(a * Math.log(v)); // 0^a = 0 for a > 0
  if (logs.length === 0) return -Infinity;
  return logSumExp(logs);
}

export interface RenyiResult extends InfoQuantity {
  alpha: number;
  /** Name of the special case, when α is one of them. */
  specialCase?: string;
  explanation: Explanation;
}

/**
 * Rényi entropy H_α = (1/(1−α)) log Σ pᵃ. Special cases: α → 0 Hartley
 * (log of the support size), α → 1 Shannon, α = 2 collision, α → ∞ min-entropy.
 */
export function renyiEntropy(probabilities: ArrayLike<number>, alpha: number, options: InfoOptions = {}): RenyiResult {
  const base = resolveBase(options);
  if (Number.isNaN(alpha) || alpha < 0) {
    throw new EngineError(`Rényi order α must be a number ≥ 0 (α = ∞ gives the min-entropy); got ${alpha}.`, 'range');
  }
  const v = validateDistribution(probabilities, options);
  const p = v.p;
  let nats: number;
  let specialCase: string | undefined;
  let exactness: 'exact' | 'numerical' = 'exact';
  if (alpha === 0) {
    nats = Math.log(p.filter((x) => x > 0).length);
    specialCase = 'Hartley (max-)entropy: the logarithm of the number of possible outcomes, ignoring their probabilities.';
  } else if (Math.abs(alpha - 1) < 1e-8) {
    // The α → 1 limit is Shannon entropy; the quotient form is numerically
    // useless there, so the limit is used instead and labelled.
    nats = entropyNats(p);
    specialCase = alpha === 1 ? 'Shannon entropy (the α → 1 limit).' : 'Shannon entropy used as the α → 1 limit (|α − 1| < 1e-8).';
    if (alpha !== 1) exactness = 'numerical';
  } else if (alpha === Infinity) {
    nats = -Math.log(Math.max(...p));
    specialCase = 'Min-entropy: −log of the largest probability.';
  } else {
    nats = logPowerSum(p, alpha) / (1 - alpha);
    if (alpha === 2) specialCase = 'Collision entropy: −log of the probability that two independent draws coincide.';
  }
  nats = Math.max(0, nats);
  return {
    ...quantity(nats, base, exactness),
    alpha,
    specialCase,
    explanation: {
      method: `Rényi entropy of order ${alpha}`,
      formula: 'H_α(X) = (1/(1−α)) log Σ p(x)^α',
      steps: [{ label: `H_${alpha}`, value: `${fromNats(nats, base).toPrecision(10)} ${base}` }],
      assumptions: ['The probabilities are the complete distribution of X.'],
      limitations: [
        'The Rényi family is non-increasing in α: larger α weights the most likely outcomes more heavily.',
        'Only α = 1 (Shannon) is additive for independent variables in the usual sense; the others are not interchangeable with it.',
        `Reported in ${BASE_LABEL[base]}.`,
      ],
      exactness,
    },
  };
}

/** Min-entropy H_∞ = −log max p — the worst-case guessing measure. */
export function minEntropy(probabilities: ArrayLike<number>, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const v = validateDistribution(probabilities, options);
  return quantity(-Math.log(Math.max(...v.p)), base, 'exact');
}

/** Collision entropy H₂ = −log Σ p². */
export function collisionEntropy(probabilities: ArrayLike<number>, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const v = validateDistribution(probabilities, options);
  return quantity(-logPowerSum(v.p, 2), base, 'exact');
}

/** Hartley entropy H₀ = log |support| — counts possibilities, ignores probabilities. */
export function hartleyEntropy(probabilities: ArrayLike<number>, options: InfoOptions = {}): InfoQuantity {
  const base = resolveBase(options);
  const v = validateDistribution(probabilities, options);
  return quantity(Math.log(v.p.filter((x) => x > 0).length), base, 'exact');
}

/**
 * Tsallis entropy S_q = (1 − Σ pᵒ)/(q − 1), scaled so that the q → 1 limit is
 * the Shannon entropy in the requested unit.
 */
export function tsallisEntropy(
  probabilities: ArrayLike<number>,
  q: number,
  options: InfoOptions = {},
): InfoQuantity & { q: number } {
  const base = resolveBase(options);
  if (!Number.isFinite(q) || q < 0) throw new EngineError(`Tsallis order q must be a finite number ≥ 0; got ${q}.`, 'range');
  const v = validateDistribution(probabilities, options);
  if (Math.abs(q - 1) < 1e-8) {
    return { ...quantity(entropyNats(v.p), base, q === 1 ? 'exact' : 'numerical'), q };
  }
  const powerSum = Math.exp(logPowerSum(v.p, q));
  // (1 − Σ p^q)/(q − 1) is in "nats" in the sense that its q → 1 limit is the
  // natural-log Shannon entropy, so the same unit conversion applies.
  return { ...quantity((1 - powerSum) / (q - 1), base, 'exact'), q };
}

/**
 * Perplexity: base^H, the number of equally likely outcomes with the same
 * entropy. Reported unit-free because base^H is invariant: 2^(H in bits) =
 * e^(H in nats).
 */
export function perplexity(probabilities: ArrayLike<number>, options: NormaliseOptions = {}): number {
  const v = validateDistribution(probabilities, options);
  return Math.exp(entropyNats(v.p));
}

/* ------------------------------------------------------------------ */
/* Information gain ranking                                           */
/* ------------------------------------------------------------------ */

export interface GainCandidate {
  name: string;
  /** Joint distribution of (target, candidate): rows index the target. */
  joint: readonly ArrayLike<number>[];
}

export interface GainRanking {
  name: string;
  /** I(target; candidate) in the requested unit. */
  gain: number;
  /** Gain as a fraction of H(target) — the share of uncertainty removed. */
  fractionOfTargetEntropy: number;
  /** Remaining uncertainty about the target after the measurement. */
  residualEntropy: number;
}

/**
 * Rank candidate measurements by the information they give about a target.
 * Each candidate supplies the joint distribution of (target, candidate), so
 * the gain is exactly I(target; candidate) = H(target) − H(target | candidate).
 */
export function rankInformationGain(
  candidates: readonly GainCandidate[],
  options: InfoOptions = {},
): { base: LogBase; targetEntropy: number; ranking: GainRanking[]; explanation: Explanation } {
  const base = resolveBase(options);
  if (candidates.length === 0) throw new EngineError('No candidate measurements were supplied to rank.', 'empty');
  const rows: GainRanking[] = [];
  let targetEntropy: number | null = null;
  for (const cand of candidates) {
    const mi = mutualInformation(cand.joint, options);
    if (targetEntropy === null) targetEntropy = mi.hx;
    else if (Math.abs(targetEntropy - mi.hx) > 1e-9) {
      throw new EngineError(
        `Candidate "${cand.name}" implies a target entropy of ${mi.hx.toPrecision(10)} ${base}, but an earlier candidate implied ` +
          `${targetEntropy.toPrecision(10)} ${base}. Every candidate's joint table must have the same target marginal, or the gains are not comparable.`,
        'consistency',
      );
    }
    rows.push({
      name: cand.name,
      gain: mi.mutualInformation,
      fractionOfTargetEntropy: mi.hx > 0 ? mi.mutualInformation / mi.hx : 0,
      residualEntropy: mi.hxGivenY,
    });
  }
  rows.sort((a, b) => b.gain - a.gain);
  return {
    base,
    targetEntropy: targetEntropy ?? 0,
    ranking: rows,
    explanation: {
      method: 'Information gain ranking',
      formula: 'gain(Y) = I(target; Y) = H(target) − H(target | Y)',
      steps: rows.map((r) => ({ label: r.name, value: `${r.gain.toPrecision(6)} ${base}` })),
      assumptions: ['Each joint table is the true joint distribution of the target and that candidate.'],
      limitations: [
        'This ranks single measurements. Information is not additive across measurements: two individually informative variables can be largely redundant, and two uninformative ones can be jointly informative.',
        'Cost is not considered — gain per unit cost may order the candidates differently.',
      ],
      exactness: 'exact',
    },
  };
}
