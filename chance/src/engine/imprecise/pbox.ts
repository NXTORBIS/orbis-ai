/**
 * Probability boxes.
 *
 * A p-box is a pair of bounding CDFs [F̲, F̄] with F̲ ≤ F̄: the true CDF lies
 * somewhere between them and nothing inside the box is privileged.
 *
 * DISCRETISATION
 * --------------
 * A p-box is stored as 2n quantile bounds. For each probability bucket
 * i ∈ {0,…,n−1} covering [i/n, (i+1)/n], the value of X in that bucket is
 * known only to lie in [lo[i], hi[i]], where
 *
 *     lo[i] = F̄⁻¹(i/n)        hi[i] = F̲⁻¹((i+1)/n)
 *
 * so that the step functions
 *
 *     F̄(x) = #{i : lo[i] ≤ x} / n       F̲(x) = #{i : hi[i] ≤ x} / n
 *
 * are OUTER bounds on the true CDF at every x. Every operation below keeps
 * that outer property: a p-box result here is never narrower than the truth.
 *
 * ARITHMETIC AND DEPENDENCE
 * -------------------------
 * You cannot add two random variables without saying how they are related.
 * Four assumptions are offered; `'unknown'` computes the Fréchet/Williamson–
 * Downs bounds, which hold for EVERY possible dependence. That answer is
 * usually shockingly wide, and the width is the point: it is the price of not
 * knowing the copula. Assuming independence to make the answer narrow is
 * assuming information you do not have.
 */
import { EngineError, Validator } from '../core/result';
import { linspace, stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { sortedCopy } from '../stats/descriptive';
import type { PossibilityDistribution } from './possibility';
import { type Bound, bound, type Labelled, labelled, provenance } from './types';

export const DEFAULT_PBOX_STEPS = 200;

export interface PBox {
  /** Number of equal-probability buckets. */
  readonly n: number;
  /** Left value bound of each bucket; non-decreasing. May begin at −∞. */
  readonly lo: Float64Array;
  /** Right value bound of each bucket; non-decreasing. May end at +∞. */
  readonly hi: Float64Array;
}

/** Dependence assumption for arithmetic between two p-boxes. */
export type Dependence =
  /** The two variables are independent (a strong, often unjustified claim). */
  | 'independent'
  /** Perfect positive dependence: both are increasing functions of one driver. */
  | 'comonotonic'
  /** Perfect negative dependence. */
  | 'countermonotonic'
  /** No assumption at all: Fréchet bounds, valid for every copula. */
  | 'unknown';

export const DEPENDENCE_MEANING: Record<Dependence, string> = {
  independent: 'Assumes the two variables carry no information about each other. This is a claim, not a default.',
  comonotonic: 'Assumes perfect positive dependence (the upper Fréchet copula M).',
  countermonotonic: 'Assumes perfect negative dependence (the lower Fréchet copula W).',
  unknown: 'Assumes nothing about the dependence. The bounds hold for every joint distribution with these margins.',
};

/**
 * Build a p-box from quantile bounds, refusing crossed or non-monotone bounds
 * and naming the offending probability level.
 */
export function makePBox(lo: ArrayLike<number>, hi: ArrayLike<number>): PBox {
  if (lo.length !== hi.length) {
    throw new EngineError(
      `A p-box needs equally many lower and upper quantile bounds; got ${lo.length} and ${hi.length}.`,
      'length',
    );
  }
  const n = lo.length;
  if (n < 2) throw new EngineError('A p-box needs at least 2 probability buckets.', 'length');
  const L = Float64Array.from(lo);
  const H = Float64Array.from(hi);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(L[i]) || Number.isNaN(H[i])) {
      throw new EngineError(
        `Quantile bound at probability level ${(i / n).toPrecision(4)} is NaN. A p-box bound must be ` +
          'a real number or ±∞; NaN carries no information and will not be substituted for.',
        'nan',
      );
    }
    if (L[i] > H[i]) {
      throw new EngineError(
        `The p-box bounds cross at probability level [${(i / n).toPrecision(4)}, ` +
          `${((i + 1) / n).toPrecision(4)}]: lower bound ${L[i]} exceeds upper bound ${H[i]} ` +
          `(by ${L[i] - H[i]}). Equivalently F̲ > F̄ there, so NO distribution satisfies the ` +
          'constraints. Check the inputs that produced these bounds.',
        'crossed-bounds',
      );
    }
    if (i > 0 && L[i] < L[i - 1]) {
      throw new EngineError(
        `The lower quantile bound is not non-decreasing: lo[${i - 1}] = ${L[i - 1]} > lo[${i}] = ${L[i]}. ` +
          'A CDF bound must be monotone.',
        'not-monotone',
      );
    }
    if (i > 0 && H[i] < H[i - 1]) {
      throw new EngineError(
        `The upper quantile bound is not non-decreasing: hi[${i - 1}] = ${H[i - 1]} > hi[${i}] = ${H[i]}.`,
        'not-monotone',
      );
    }
  }
  return { n, lo: L, hi: H };
}

/** F̄(x): the upper bounding CDF (the most probability that could be ≤ x). */
export function cdfUpper(box: PBox, x: number): number {
  let c = 0;
  for (let i = 0; i < box.n; i++) if (box.lo[i] <= x) c++;
  return c / box.n;
}

/** F̲(x): the lower bounding CDF (the least probability that could be ≤ x). */
export function cdfLower(box: PBox, x: number): number {
  let c = 0;
  for (let i = 0; i < box.n; i++) if (box.hi[i] <= x) c++;
  return c / box.n;
}

/** [F̲(x), F̄(x)] as an explicit bound. */
export function cdfBound(box: PBox, x: number): Bound {
  return bound(
    cdfLower(box, x),
    cdfUpper(box, x),
    provenance('pbox', 'numerical', [
      `P(X ≤ ${x}) is bounded by the two CDFs; no value inside the interval is a better estimate.`,
      `Resolution is 1/${box.n} in probability; the bound is outer, so the truth is inside.`,
    ]),
  );
}

/** [P(X > t) lower, upper]. */
export function exceedanceBound(box: PBox, t: number): Bound {
  return bound(
    1 - cdfUpper(box, t),
    1 - cdfLower(box, t),
    provenance('pbox', 'numerical', [
      `P(X > ${t}) bounds, obtained as 1 − F̄ and 1 − F̲. Bounds, not an estimate.`,
    ]),
  );
}

/** Bounds on the p-quantile. */
export function quantileBound(box: PBox, p: number): Bound {
  const v = new Validator();
  v.range(p, 'p', 'Probability level', 0, 1);
  v.throwIfInvalid();
  const iLo = Math.min(box.n - 1, Math.max(0, Math.floor(p * box.n)));
  const iHi = Math.min(box.n - 1, Math.max(0, Math.ceil(p * box.n) - 1));
  return bound(
    box.lo[iLo],
    box.hi[iHi],
    provenance('pbox', 'numerical', [
      `Bounds on the ${p} quantile. This is a bound on a quantile of the unknown distribution, which ` +
        'is a different statement from a confidence interval for an estimated quantile.',
    ]),
  );
}

/** Bounds on E[X]: the averages of the two quantile bound arrays. */
export function meanBound(box: PBox): Bound {
  const lower = stableSum(box.lo) / box.n;
  const upper = stableSum(box.hi) / box.n;
  const notes = [
    'E[X] is bounded by the mean of each bounding quantile function. This is the exact imprecise ' +
      'expectation of the discretised box.',
  ];
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    notes.push(
      'A bound is infinite because the box has an unbounded tail bucket. That is the honest answer ' +
        'for an unbounded distribution at this resolution; construct the box with an explicit ' +
        'tailTruncation if a finite bound is needed, and report the truncation.',
    );
  }
  return bound(lower, upper, provenance('pbox', 'numerical', notes));
}

/**
 * Bounds on Var(X).
 *
 * Upper: for any admissible selection x_i ∈ [lo_i, hi_i] with mean m inside the
 * mean bounds, Var = (1/n)Σ(x_i − m)² ≤ (1/n)Σ max((lo_i − m)², (hi_i − m)²),
 * maximised over m in the mean bounds — a valid outer bound, not necessarily tight.
 * Lower: Var ≥ min_m (1/n)Σ dist(m, [lo_i, hi_i])², also valid.
 */
export function varianceBound(box: PBox, mGrid = 201): Bound {
  const mb = meanBound(box);
  if (!Number.isFinite(mb.lower) || !Number.isFinite(mb.upper)) {
    throw new EngineError(
      'Variance bounds need finite mean bounds, but this p-box has an unbounded tail bucket so the ' +
        `mean bounds are [${mb.lower}, ${mb.upper}]. Construct the box with an explicit ` +
        'tailTruncation, or bound the variance from the moment information directly.',
      'unbounded',
    );
  }
  const ms = mb.lower === mb.upper ? [mb.lower] : linspace(mb.lower, mb.upper, mGrid);
  let upper = -Infinity;
  let lower = Infinity;
  for (const m of ms) {
    let up = 0;
    let lw = 0;
    for (let i = 0; i < box.n; i++) {
      const dl = box.lo[i] - m;
      const dh = box.hi[i] - m;
      up += Math.max(dl * dl, dh * dh);
      const d = m < box.lo[i] ? box.lo[i] - m : m > box.hi[i] ? m - box.hi[i] : 0;
      lw += d * d;
    }
    upper = Math.max(upper, up / box.n);
    lower = Math.min(lower, lw / box.n);
  }
  return bound(
    lower,
    upper,
    provenance('pbox', 'numerical', [
      'Outer bounds on the variance. The upper bound is valid but may not be attained; the lower ' +
        'bound is the minimum achievable scatter around any admissible centre.',
      `The centre was scanned on a grid of ${ms.length} points between the mean bounds.`,
    ]),
  );
}

/**
 * Lower and upper expectation of f(X) over the box.
 * In 'monotone' mode f is assumed monotone, so the bucket extremes are the
 * endpoints and the bounds are valid. In 'sampled' mode the per-bucket extremes
 * are found by scanning, which is an INNER approximation of each extreme.
 */
export function expectationBound(
  box: PBox,
  f: (x: number) => number,
  mode: 'monotone' | 'sampled' = 'monotone',
  samples = 17,
): Bound {
  let lower = 0;
  let upper = 0;
  for (let i = 0; i < box.n; i++) {
    const a = box.lo[i];
    const b = box.hi[i];
    let mn: number;
    let mx: number;
    if (mode === 'monotone' || !Number.isFinite(a) || !Number.isFinite(b)) {
      const fa = f(a);
      const fb = f(b);
      mn = Math.min(fa, fb);
      mx = Math.max(fa, fb);
    } else {
      mn = Infinity;
      mx = -Infinity;
      for (const x of a === b ? [a] : linspace(a, b, samples)) {
        const y = f(x);
        if (y < mn) mn = y;
        if (y > mx) mx = y;
      }
    }
    lower += mn;
    upper += mx;
  }
  return bound(
    lower / box.n,
    upper / box.n,
    provenance('pbox', 'numerical', [
      'Imprecise expectation: the lower and upper expectation of f over every distribution in the box.',
      mode === 'monotone'
        ? 'Monotonicity of f on each bucket is ASSUMED. If f is not monotone the interval is too narrow.'
        : `Per-bucket extremes scanned at ${samples} points: an inner approximation of each extreme.`,
    ]),
  );
}

/* --------------------------------------------------- constructions */

export interface DistributionBoxOptions {
  steps?: number;
  /**
   * Explicitly truncate unbounded tails at this probability, so the outermost
   * buckets become finite. Any value set here is reported as a warning: the
   * resulting bounds are conditional on the truncation.
   */
  tailTruncation?: number;
}

/** A precise distribution as a degenerate p-box (coincident bounds up to the grid). */
export function pboxFromDistribution(
  id: string,
  params: Params,
  opts: DistributionBoxOptions = {},
): Labelled<PBox> {
  const def = getDistribution(id);
  const n = opts.steps ?? DEFAULT_PBOX_STEPS;
  const v = new Validator();
  v.integer(n, 'steps', 'Number of probability buckets', 2, 20000);
  if (opts.tailTruncation !== undefined) {
    v.range(opts.tailTruncation, 'tailTruncation', 'Tail truncation probability', 0, 0.5);
  }
  v.throwIfInvalid();
  const t = opts.tailTruncation;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pL = i / n;
    const pH = (i + 1) / n;
    lo[i] = def.quantile(t !== undefined && pL === 0 ? t : pL, params);
    hi[i] = def.quantile(t !== undefined && pH === 1 ? 1 - t : pH, params);
  }
  const warnings: string[] = [];
  if (t !== undefined) {
    warnings.push(
      `Tails truncated at probability ${t}: the outermost buckets are the ${t} and ${1 - t} quantiles, ` +
        `so up to ${2 * t} of the probability is unaccounted for and the bounds are conditional on ` +
        'that truncation.',
    );
  }
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', 'numerical', [
      `Precise distribution ${def.name} discretised into ${n} equal-probability buckets. The bounds ` +
        `differ only by the discretisation (at most 1/${n} in probability) and bracket the true CDF.`,
      ...(t !== undefined ? ['Tails explicitly truncated; see warnings.'] : []),
    ]),
    warnings,
  );
}

/**
 * A distribution family whose parameters are known only to intervals.
 *
 * The envelope is taken over a grid of parameter combinations. For a family
 * monotone in each parameter the corner combinations suffice and the result is
 * the exact envelope; otherwise it is an INNER approximation of the envelope
 * and is reported as such. Grid size is `gridPerParam ^ (#intervals)`.
 */
export function pboxFromIntervalParams(
  id: string,
  ranges: Record<string, { lo: number; hi: number } | number>,
  opts: DistributionBoxOptions & { gridPerParam?: number } = {},
): Labelled<PBox> {
  const def = getDistribution(id);
  const n = opts.steps ?? DEFAULT_PBOX_STEPS;
  const g = opts.gridPerParam ?? 3;
  const v = new Validator();
  v.integer(n, 'steps', 'Number of probability buckets', 2, 20000);
  v.integer(g, 'gridPerParam', 'Grid points per interval parameter', 2, 21);
  v.throwIfInvalid();
  const keys = Object.keys(ranges);
  const axes: number[][] = keys.map((k) => {
    const r = ranges[k];
    if (typeof r === 'number') return [r];
    if (!(r.lo <= r.hi)) {
      throw new EngineError(`Interval for parameter "${k}" has lo = ${r.lo} > hi = ${r.hi}.`, 'range');
    }
    return r.lo === r.hi ? [r.lo] : linspace(r.lo, r.hi, g);
  });
  const combos = axes.reduce((acc, axis) => acc * axis.length, 1);
  if (combos > 20000) {
    throw new EngineError(
      `The parameter grid has ${combos} combinations, above the limit of 20000. Reduce ` +
        'gridPerParam or the number of interval parameters.',
      'too-large',
    );
  }
  const lo = new Float64Array(n).fill(Infinity);
  const hi = new Float64Array(n).fill(-Infinity);
  const idx = new Array<number>(keys.length).fill(0);
  let count = 0;
  for (;;) {
    const p: Params = {};
    for (let k = 0; k < keys.length; k++) p[keys[k]] = axes[k][idx[k]];
    for (let i = 0; i < n; i++) {
      lo[i] = Math.min(lo[i], def.quantile(i / n, p));
      hi[i] = Math.max(hi[i], def.quantile((i + 1) / n, p));
    }
    count++;
    let k = keys.length - 1;
    while (k >= 0 && ++idx[k] >= axes[k].length) {
      idx[k] = 0;
      k--;
    }
    if (k < 0) break;
  }
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', 'numerical', [
      `Envelope of ${def.name} over ${count} parameter combinations drawn from the supplied intervals.`,
      'Exact envelope if the quantile function is monotone in each parameter; otherwise an INNER ' +
        'approximation of the envelope, so the true box could be slightly wider. Refine gridPerParam.',
      'Every distribution in the family with parameters in the intervals is inside this box; the box ' +
        'also contains distributions that are in no member of the family.',
    ]),
    [
      'Parameter intervals are taken as a set of admissible parameters with no distribution over ' +
        'them; this is not a hierarchical Bayesian model.',
    ],
  );
}

/** Markov: P(X ≥ t) ≤ E[X]/t for a non-negative X. */
export function markovBound(mean: number, t: number): Labelled<number> {
  const v = new Validator();
  v.nonNegative(mean, 'mean', 'E[X] (X must be non-negative)');
  v.positive(t, 't', 'Threshold t');
  v.throwIfInvalid();
  return labelled(
    Math.min(1, mean / t),
    provenance('pbox', 'exact', [
      'Markov inequality. Requires X ≥ 0 and uses only the mean; it is very loose by design.',
      'This is an upper bound on a tail probability, never an estimate of it.',
    ]),
  );
}

/** Chebyshev: P(|X − μ| ≥ kσ) ≤ 1/k², two-sided. */
export function chebyshevBound(k: number): Labelled<number> {
  const v = new Validator();
  v.positive(k, 'k', 'Number of standard deviations k');
  v.throwIfInvalid();
  return labelled(
    Math.min(1, 1 / (k * k)),
    provenance('pbox', 'exact', [
      'Chebyshev inequality, two-sided. Uses only μ and σ and holds for every distribution with them.',
      'It bounds the TOTAL of the two tails jointly, which no p-box can express pointwise.',
    ]),
  );
}

/** Cantelli: P(X − μ ≥ kσ) ≤ 1/(1 + k²), one-sided and strictly tighter per tail. */
export function cantelliBound(k: number): Labelled<number> {
  const v = new Validator();
  v.positive(k, 'k', 'Number of standard deviations k');
  v.throwIfInvalid();
  return labelled(
    Math.min(1, 1 / (1 + k * k)),
    provenance('pbox', 'exact', [
      'Cantelli (one-sided Chebyshev) inequality. Tighter than Chebyshev for a single tail: ' +
        '1/(1+k²) < 1/k² for every k > 0.',
      'Attained by a two-point distribution, so it cannot be improved without more moments.',
    ]),
  );
}

/**
 * The Cantelli p-box from a known mean and standard deviation: the
 * distribution-free envelope
 *
 *     F̄(x) = σ²/(σ² + (μ−x)²) for x < μ, else 1
 *     F̲(x) = 1 − σ²/(σ² + (x−μ)²) for x > μ, else 0
 *
 * In quantile form lo[i] = μ − σ√((1−p)/p) at p = i/n and
 * hi[i] = μ + σ√(p/(1−p)) at p = (i+1)/n.
 */
export function pboxFromMoments(
  mean: number,
  sd: number,
  opts: DistributionBoxOptions = {},
): Labelled<PBox> {
  const n = opts.steps ?? DEFAULT_PBOX_STEPS;
  const v = new Validator();
  v.finite(mean, 'mean', 'Mean μ');
  v.positive(sd, 'sd', 'Standard deviation σ');
  v.integer(n, 'steps', 'Number of probability buckets', 2, 20000);
  if (opts.tailTruncation !== undefined) {
    v.range(opts.tailTruncation, 'tailTruncation', 'Tail truncation probability', 0, 0.5);
  }
  v.throwIfInvalid();
  const t = opts.tailTruncation;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let pL = i / n;
    let pH = (i + 1) / n;
    if (t !== undefined) {
      if (pL === 0) pL = t;
      if (pH === 1) pH = 1 - t;
    }
    lo[i] = pL === 0 ? -Infinity : mean - sd * Math.sqrt((1 - pL) / pL);
    hi[i] = pH === 1 ? Infinity : mean + sd * Math.sqrt(pH / (1 - pH));
  }
  const warnings = [
    'A p-box constrains each point of the CDF separately, so it cannot carry the JOINT two-sided ' +
      "Chebyshev constraint. Pointwise these bounds are Cantelli's, which are tighter per tail than " +
      'Chebyshev; but the pair of tails taken together is only Cantelli-constrained here, so the sum ' +
      'of the two tail bounds (2/(1+k²)) can exceed the true Chebyshev limit 1/k².',
  ];
  if (t !== undefined) {
    warnings.push(`Tails truncated at probability ${t}; bounds are conditional on that truncation.`);
  }
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', 'exact', [
      'Distribution-free: every distribution with this mean and standard deviation lies inside this ' +
        'box, including ones with any skewness or tail shape.',
      'The box is attained by two-point distributions, so it cannot be narrowed without more ' +
        'information (e.g. a known support or a third moment).',
    ]),
    warnings,
  );
}

/**
 * Kolmogorov–Smirnov / DKW confidence band around an empirical CDF:
 * F̂(x) ± d with d = √(ln(2/α)/(2m)) (Massart's constant), a simultaneous
 * (1−α) band. The result is a p-box whose coverage statement is about the
 * BAND, not about any individual quantile.
 */
export function pboxFromData(
  data: ArrayLike<number>,
  level = 0.95,
  opts: DistributionBoxOptions = {},
): Labelled<PBox> {
  const m = data.length;
  const n = opts.steps ?? DEFAULT_PBOX_STEPS;
  const v = new Validator();
  v.integer(n, 'steps', 'Number of probability buckets', 2, 20000);
  v.range(level, 'level', 'Confidence level', 0.5, 0.999999);
  if (m < 2) v.add(`A KS band needs at least 2 observations; got ${m}.`, 'data', 'length');
  v.throwIfInvalid();
  const xs = sortedCopy(data);
  for (let i = 0; i < m; i++) {
    if (!Number.isFinite(xs[i])) {
      throw new EngineError(`Observation ${i} is ${xs[i]}; the data must be finite.`, 'finite');
    }
  }
  const alpha = 1 - level;
  const d = Math.sqrt(Math.log(2 / alpha) / (2 * m));
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  // F̄ = min(1, F̂ + d) ⟹ lo[i] = inf{x : F̂(x) ≥ i/n − d}
  // F̲ = max(0, F̂ − d) ⟹ hi[i] = inf{x : F̂(x) ≥ (i+1)/n + d}
  for (let i = 0; i < n; i++) {
    const pL = i / n - d;
    const pH = (i + 1) / n + d;
    lo[i] = pL <= 0 ? -Infinity : xs[Math.min(m - 1, Math.ceil(pL * m) - 1)];
    hi[i] = pH >= 1 ? Infinity : xs[Math.min(m - 1, Math.ceil(pH * m) - 1)];
  }
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', 'empirical', [
      `Simultaneous ${(level * 100).toFixed(1)}% Kolmogorov–Smirnov band from ${m} observations, ` +
        `half-width d = ${d.toPrecision(4)} in probability (Dvoretzky–Kiefer–Wolfowitz with ` +
        "Massart's constant, so the coverage is a guarantee, not an approximation).",
      'The statement is about the whole band at once: with probability ≥ the stated level, the true ' +
        'CDF lies inside. That is NOT a confidence interval for any particular quantile.',
      'The outer buckets are unbounded because the band reaches 0 and 1 outside the data range; the ' +
        'data cannot bound the tails.',
    ]),
    [
      'Sampling-based: a different sample gives a different band.',
      'The band assumes i.i.d. observations from a single fixed distribution.',
    ],
  );
}

/**
 * The p-box induced by a possibility distribution over an ORDERED finite
 * domain: F̄(x) = Π((−∞, x]) and F̲(x) = N((−∞, x]).
 *
 * This is the set of probability measures dominated by π, read as a p-box. The
 * p-box reading is weaker: it keeps only the CDF bounds and forgets the
 * constraints π places on non-interval events.
 */
export function pboxFromPossibility(
  dist: PossibilityDistribution,
  values: readonly number[],
  opts: DistributionBoxOptions = {},
): Labelled<PBox> {
  const n = opts.steps ?? DEFAULT_PBOX_STEPS;
  const v = new Validator();
  v.integer(n, 'steps', 'Number of probability buckets', 2, 20000);
  if (values.length !== dist.frame.n) {
    v.add(
      `Need one numeric value per frame element: got ${values.length}, need ${dist.frame.n}.`,
      'values',
      'length',
    );
  }
  v.throwIfInvalid();
  for (let i = 1; i < values.length; i++) {
    if (!(values[i] > values[i - 1])) {
      throw new EngineError(
        `Values must be strictly increasing to read π as a p-box; values[${i - 1}] = ${values[i - 1]} ` +
          `and values[${i}] = ${values[i]}.`,
        'order',
      );
    }
  }
  const k = values.length;
  const Fu = new Float64Array(k);
  const Fl = new Float64Array(k);
  let run = 0;
  for (let j = 0; j < k; j++) {
    run = Math.max(run, dist.pi[j]);
    Fu[j] = run;
  }
  for (let j = 0; j < k; j++) {
    let supAbove = 0;
    for (let t = j + 1; t < k; t++) supAbove = Math.max(supAbove, dist.pi[t]);
    Fl[j] = 1 - supAbove;
  }
  const { lo, hi } = invertCdfBounds(values, Fl, Fu, n);
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', 'exact', [
      'F̄ = Π((−∞,x]) and F̲ = N((−∞,x]). Every probability dominated by π is inside this box.',
      'Information is LOST going this way: the p-box constrains only interval events, while π also ' +
        'constrains unions of disjoint intervals. The box is therefore weaker than π, not equivalent.',
    ]),
    ['The p-box reading of a possibility distribution is strictly weaker than the distribution itself.'],
  );
}

/**
 * Generic p-box from step-function CDF bounds on a value grid:
 * lo[i] = inf{x : F̄(x) ≥ i/n}, hi[i] = inf{x : F̲(x) ≥ (i+1)/n}.
 */
export function invertCdfBounds(
  xs: readonly number[],
  Fl: ArrayLike<number>,
  Fu: ArrayLike<number>,
  n: number,
): { lo: Float64Array; hi: Float64Array } {
  const k = xs.length;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pL = i / n;
    const pH = (i + 1) / n;
    let j = 0;
    while (j < k && !(Fu[j] >= pL && (pL > 0 || Fu[j] > 0))) j++;
    lo[i] = j < k ? xs[j] : Infinity;
    let j2 = 0;
    while (j2 < k && Fl[j2] < pH) j2++;
    hi[i] = j2 < k ? xs[j2] : Infinity;
  }
  return { lo, hi };
}

/* ------------------------------------------------------- arithmetic */

type IncreasingOp = (x: number, y: number) => number;

function requireSameResolution(a: PBox, b: PBox): void {
  if (a.n !== b.n) {
    throw new EngineError(
      `The two p-boxes use different discretisations (${a.n} and ${b.n} buckets). Rebuild both with ` +
        'the same steps; mixing resolutions would silently misalign the probability levels.',
      'resolution-mismatch',
    );
  }
}

/**
 * Binary arithmetic for an operation increasing in both arguments.
 *
 * Fréchet ('unknown') uses the discrete Williamson–Downs formulas, derived from
 * the inverses of
 *     F̲_Z(z) = sup_x max(0, F̲_X(x) + F̲_Y(z−x) − 1)
 *     F̄_Z(z) = inf_x min(1, F̄_X(x) + F̄_Y(z−x))
 * namely q̲_Z(p) = sup_{a+b=p} (q_X(a)+q_Y(b)) and
 *        q̄_Z(p) = inf_{a∈[p,1]} (q_X(a)+q_Y(1+p−a)),
 * which on the bucket grid become
 *     lo[k] = max_{i≤k} op(loX[i], loY[k−i])
 *     hi[k] = min_{i≥k} op(hiX[i], hiY[n−1+k−i]).
 * These provably contain the comonotonic, countermonotonic and independent
 * results computed below.
 */
export function pboxBinary(
  a: PBox,
  b: PBox,
  op: IncreasingOp,
  dependence: Dependence,
  opLabel = 'op',
): Labelled<PBox> {
  requireSameResolution(a, b);
  const n = a.n;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  let exactness: 'exact' | 'numerical' = 'numerical';
  if (dependence === 'unknown') {
    for (let k = 0; k < n; k++) {
      let mx = -Infinity;
      for (let i = 0; i <= k; i++) mx = Math.max(mx, op(a.lo[i], b.lo[k - i]));
      lo[k] = mx;
      let mn = Infinity;
      for (let i = k; i < n; i++) mn = Math.min(mn, op(a.hi[i], b.hi[n - 1 + k - i]));
      hi[k] = mn;
    }
    exactness = 'exact';
  } else if (dependence === 'comonotonic') {
    for (let i = 0; i < n; i++) {
      lo[i] = op(a.lo[i], b.lo[i]);
      hi[i] = op(a.hi[i], b.hi[i]);
    }
  } else if (dependence === 'countermonotonic') {
    const l: number[] = [];
    const h: number[] = [];
    for (let i = 0; i < n; i++) {
      l.push(op(a.lo[i], b.lo[n - 1 - i]));
      h.push(op(a.hi[i], b.hi[n - 1 - i]));
    }
    l.sort((p, q) => p - q);
    h.sort((p, q) => p - q);
    for (let i = 0; i < n; i++) {
      lo[i] = l[i];
      hi[i] = h[i];
    }
  } else {
    const l = new Float64Array(n * n);
    const h = new Float64Array(n * n);
    let t = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        l[t] = op(a.lo[i], b.lo[j]);
        h[t] = op(a.hi[i], b.hi[j]);
        t++;
      }
    }
    l.sort();
    h.sort();
    for (let k = 0; k < n; k++) {
      lo[k] = l[k * n];
      hi[k] = h[(k + 1) * n - 1];
    }
  }
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(lo[i]) || Number.isNaN(hi[i])) {
      throw new EngineError(
        `The ${opLabel} produced NaN at probability bucket ${i} (typically ∞·0 from an unbounded ` +
          'tail). Restrict the supports or construct the inputs with an explicit tailTruncation.',
        'nan',
      );
    }
  }
  const notes = [
    DEPENDENCE_MEANING[dependence],
    dependence === 'unknown'
      ? 'Discrete Williamson–Downs / Fréchet bounds: these hold for EVERY joint distribution with ' +
        'these margins, so the result is wide by necessity, not by sloppiness. Narrowing it requires ' +
        'evidence about the dependence.'
      : 'This is a result CONDITIONAL on the stated dependence. If the dependence is unknown, this ' +
        'number is narrower than your knowledge warrants — compute the unknown-dependence bounds too.',
    `Probability resolution 1/${n}; the bounds are outer.`,
  ];
  return labelled(
    makePBox(lo, hi),
    provenance('pbox', exactness, notes),
    dependence === 'independent'
      ? ['Independence was assumed. It is a substantive assumption, not a neutral default.']
      : [],
  );
}

export const pboxAdd = (a: PBox, b: PBox, dependence: Dependence) =>
  pboxBinary(a, b, (x, y) => x + y, dependence, 'sum');

/** −X: reverse and negate the quantile bounds. */
export function pboxNegate(box: PBox): PBox {
  const n = box.n;
  const lo = new Float64Array(n);
  const hi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lo[i] = -box.hi[n - 1 - i];
    hi[i] = -box.lo[n - 1 - i];
  }
  return makePBox(lo, hi);
}

/** X − Y, computed as X + (−Y). Note that 'comonotonic' in X and Y means */
/** countermonotonic in X and −Y, which is handled by the flip. */
export function pboxSub(a: PBox, b: PBox, dependence: Dependence): Labelled<PBox> {
  const flipped: Dependence =
    dependence === 'comonotonic'
      ? 'countermonotonic'
      : dependence === 'countermonotonic'
        ? 'comonotonic'
        : dependence;
  return pboxAdd(a, pboxNegate(b), flipped);
}

/** X·Y for p-boxes supported on the positive half-line. */
export function pboxMul(a: PBox, b: PBox, dependence: Dependence): Labelled<PBox> {
  for (const [name, box] of [
    ['first', a],
    ['second', b],
  ] as const) {
    if (!(box.lo[0] >= 0)) {
      throw new EngineError(
        `Multiplication of p-boxes here requires non-negative supports, but the ${name} box starts ` +
          `at ${box.lo[0]}. Multiplication is not increasing in both arguments across zero; split the ` +
          'box at 0 or reformulate.',
        'sign',
      );
    }
  }
  return pboxBinary(a, b, (x, y) => x * y, dependence, 'product');
}

/** Pointwise width of the box in probability at x, i.e. F̄(x) − F̲(x). */
export function cdfWidthAt(box: PBox, x: number): number {
  return cdfUpper(box, x) - cdfLower(box, x);
}

/** Does every CDF value of a precise distribution lie inside the box? */
export function containsCdf(box: PBox, cdf: (x: number) => number, xs: readonly number[]): boolean {
  for (const x of xs) {
    const p = cdf(x);
    if (p < cdfLower(box, x) - 1e-12 || p > cdfUpper(box, x) + 1e-12) return false;
  }
  return true;
}
