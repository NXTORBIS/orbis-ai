/**
 * Fuzzy numbers, α-cut interval arithmetic and Zadeh's extension principle.
 *
 * A fuzzy number is a possibility distribution on ℝ: μ(x) grades how
 * compatible x is with a vague quantity ("about 5"). Its α-cuts
 * A_α = {x : μ(x) ≥ α} are nested closed intervals, and arithmetic is done
 * interval-wise on the cuts.
 *
 * THE DEPENDENCY PROBLEM
 * ----------------------
 * Interval arithmetic treats every occurrence of a variable as a separate,
 * independently varying quantity. So naive interval arithmetic computes
 * X − X as [a − c, c − a], a non-degenerate interval, when the true range is
 * exactly {0}. This module keeps the two routes under different names:
 * `naiveIntervalFunction` (fast, overestimates whenever a variable repeats)
 * and `extensionPrinciple` (treats the variable as one quantity, so it is
 * correct). The API does not let you confuse them.
 */
import { EngineError, Validator } from '../core/result';
import { linspace } from '../core/numeric';
import { type Bound, bound, type Labelled, labelled, provenance } from './types';

export interface AlphaInterval {
  alpha: number;
  lo: number;
  hi: number;
}

export type FuzzyKind = 'triangular' | 'trapezoidal' | 'discretised';

export interface FuzzyNumber {
  readonly kind: FuzzyKind;
  /** α-cuts in ASCENDING α; nested, so lo is non-decreasing and hi non-increasing. */
  readonly levels: readonly AlphaInterval[];
  /** Defining vertices for triangular [a,b,c] and trapezoidal [a,b,c,d] shapes. */
  readonly vertices?: readonly number[];
}

/** Default number of α levels, including α = 0 and α = 1. */
export const DEFAULT_ALPHA_LEVELS = 17;

/** α levels on a dyadic grid: 0, 1/(k−1), …, 1 with k = 2^j + 1 exactly representable. */
export function alphaGrid(count = DEFAULT_ALPHA_LEVELS): number[] {
  const v = new Validator();
  v.integer(count, 'count', 'Number of α levels', 2, 4097);
  v.throwIfInvalid();
  return linspace(0, 1, count);
}

function checkNested(levels: readonly AlphaInterval[]): void {
  for (let i = 0; i < levels.length; i++) {
    if (!(levels[i].lo <= levels[i].hi)) {
      throw new EngineError(
        `α-cut at α = ${levels[i].alpha} has lo = ${levels[i].lo} > hi = ${levels[i].hi}; an α-cut ` +
          'must be a non-empty interval.',
        'crossed-cut',
      );
    }
    if (i > 0 && (levels[i].lo < levels[i - 1].lo - 1e-12 || levels[i].hi > levels[i - 1].hi + 1e-12)) {
      throw new EngineError(
        `α-cuts are not nested: the cut at α = ${levels[i].alpha} is [${levels[i].lo}, ${levels[i].hi}] ` +
          `which is not contained in the cut at α = ${levels[i - 1].alpha} = [${levels[i - 1].lo}, ` +
          `${levels[i - 1].hi}]. A fuzzy number requires nested cuts (equivalently a quasi-concave μ).`,
        'not-nested',
      );
    }
  }
}

export function triangularFuzzy(a: number, b: number, c: number, levels = alphaGrid()): FuzzyNumber {
  const v = new Validator();
  v.finite(a, 'a');
  v.finite(b, 'b');
  v.finite(c, 'c');
  v.throwIfInvalid();
  if (!(a <= b && b <= c)) {
    throw new EngineError(
      `A triangular fuzzy number needs a ≤ b ≤ c; got a = ${a}, b = ${b}, c = ${c}.`,
      'order',
    );
  }
  const cuts = levels.map((alpha) => ({ alpha, lo: a + alpha * (b - a), hi: c - alpha * (c - b) }));
  checkNested(cuts);
  return { kind: 'triangular', levels: cuts, vertices: [a, b, c] };
}

export function trapezoidalFuzzy(
  a: number,
  b: number,
  c: number,
  d: number,
  levels = alphaGrid(),
): FuzzyNumber {
  const v = new Validator();
  v.finite(a, 'a');
  v.finite(b, 'b');
  v.finite(c, 'c');
  v.finite(d, 'd');
  v.throwIfInvalid();
  if (!(a <= b && b <= c && c <= d)) {
    throw new EngineError(
      `A trapezoidal fuzzy number needs a ≤ b ≤ c ≤ d; got ${a}, ${b}, ${c}, ${d}.`,
      'order',
    );
  }
  const cuts = levels.map((alpha) => ({ alpha, lo: a + alpha * (b - a), hi: d - alpha * (d - c) }));
  checkNested(cuts);
  return { kind: 'trapezoidal', levels: cuts, vertices: [a, b, c, d] };
}

export function discretisedFuzzy(levels: readonly AlphaInterval[]): FuzzyNumber {
  const sorted = [...levels].sort((x, y) => x.alpha - y.alpha);
  if (sorted.length < 2) throw new EngineError('A fuzzy number needs at least two α levels.', 'length');
  checkNested(sorted);
  return { kind: 'discretised', levels: sorted };
}

/** The α-cut at a given level, by exact formula for shaped numbers, else by linear interpolation. */
export function alphaCutOf(fn: FuzzyNumber, alpha: number): Bound {
  const v = new Validator();
  v.range(alpha, 'alpha', 'α', 0, 1);
  v.throwIfInvalid();
  const vert = fn.vertices;
  if (vert && fn.kind === 'triangular') {
    const [a, b, c] = vert;
    return bound(a + alpha * (b - a), c - alpha * (c - b), cutProvenance('exact'));
  }
  if (vert && fn.kind === 'trapezoidal') {
    const [a, b, c, d] = vert;
    return bound(a + alpha * (b - a), d - alpha * (d - c), cutProvenance('exact'));
  }
  const L = fn.levels;
  if (alpha <= L[0].alpha) return bound(L[0].lo, L[0].hi, cutProvenance('exact'));
  const last = L[L.length - 1];
  if (alpha >= last.alpha) return bound(last.lo, last.hi, cutProvenance('exact'));
  let i = 1;
  while (i < L.length && L[i].alpha < alpha) i++;
  const t = (alpha - L[i - 1].alpha) / (L[i].alpha - L[i - 1].alpha);
  return bound(
    L[i - 1].lo + t * (L[i].lo - L[i - 1].lo),
    L[i - 1].hi + t * (L[i].hi - L[i - 1].hi),
    cutProvenance('numerical'),
  );
}

function cutProvenance(exactness: 'exact' | 'numerical') {
  return provenance('fuzzy', exactness, [
    'An α-cut is the set of values at least α-compatible with the fuzzy quantity. It is a bound on ' +
      'the quantity at that confidence-like level, not a confidence interval.',
    ...(exactness === 'numerical'
      ? ['Interpolated between stored α levels; refine the level grid for a tighter cut.']
      : []),
  ]);
}

/** μ(x) = sup{α : x ∈ A_α}. */
export function membership(fn: FuzzyNumber, x: number): number {
  const vert = fn.vertices;
  if (vert && fn.kind === 'triangular') {
    const [a, b, c] = vert;
    if (x < a || x > c) return 0;
    if (x === b) return 1;
    return x < b ? (b > a ? (x - a) / (b - a) : 1) : c > b ? (c - x) / (c - b) : 1;
  }
  if (vert && fn.kind === 'trapezoidal') {
    const [a, b, c, d] = vert;
    if (x < a || x > d) return 0;
    if (x >= b && x <= c) return 1;
    return x < b ? (x - a) / (b - a) : (d - x) / (d - c);
  }
  let best = 0;
  for (const l of fn.levels) if (x >= l.lo && x <= l.hi && l.alpha > best) best = l.alpha;
  return best;
}

/* ------------------------------------------- interval arithmetic */

export interface Ival {
  lo: number;
  hi: number;
}

export function ivAdd(x: Ival, y: Ival): Ival {
  return { lo: x.lo + y.lo, hi: x.hi + y.hi };
}
export function ivSub(x: Ival, y: Ival): Ival {
  return { lo: x.lo - y.hi, hi: x.hi - y.lo };
}
export function ivMul(x: Ival, y: Ival): Ival {
  const p = [x.lo * y.lo, x.lo * y.hi, x.hi * y.lo, x.hi * y.hi];
  return { lo: Math.min(...p), hi: Math.max(...p) };
}
export function ivDiv(x: Ival, y: Ival): Ival {
  if (y.lo <= 0 && y.hi >= 0) {
    throw new EngineError(
      `Interval division by [${y.lo}, ${y.hi}], which contains 0. The result is unbounded; there is ` +
        'no finite interval to return. Split the divisor away from zero or reformulate.',
      'division-by-zero-interval',
    );
  }
  const p = [x.lo / y.lo, x.lo / y.hi, x.hi / y.lo, x.hi / y.hi];
  return { lo: Math.min(...p), hi: Math.max(...p) };
}

type BinOp = 'add' | 'sub' | 'mul' | 'div';

const OPS: Record<BinOp, (x: Ival, y: Ival) => Ival> = {
  add: ivAdd,
  sub: ivSub,
  mul: ivMul,
  div: ivDiv,
};

function commonLevels(x: FuzzyNumber, y: FuzzyNumber): number[] {
  const set = new Set<number>();
  for (const l of x.levels) set.add(l.alpha);
  for (const l of y.levels) set.add(l.alpha);
  return [...set].sort((a, b) => a - b);
}

/**
 * Binary arithmetic on two **distinct, non-interactive** fuzzy numbers, done
 * interval-wise on matched α-cuts. This is exact for distinct variables: the
 * sum of two triangular fuzzy numbers is the triangular number with summed
 * vertices, and so on.
 */
export function fuzzyBinary(x: FuzzyNumber, y: FuzzyNumber, op: BinOp): Labelled<FuzzyNumber> {
  const alphas = commonLevels(x, y);
  const f = OPS[op];
  const levels: AlphaInterval[] = alphas.map((alpha) => {
    const cx = alphaCutOf(x, alpha);
    const cy = alphaCutOf(y, alpha);
    const r = f({ lo: cx.lower, hi: cx.upper }, { lo: cy.lower, hi: cy.upper });
    return { alpha, lo: r.lo, hi: r.hi };
  });
  const exact = (op === 'add' || op === 'sub') && x.vertices !== undefined && y.vertices !== undefined;
  return labelled(
    discretisedFuzzy(levels),
    provenance('fuzzy', exact ? 'exact' : 'numerical', [
      'The two operands are treated as distinct, non-interactive quantities. If they are in fact the ' +
        'same quantity, or dependent, this OVERESTIMATES the result — use extensionPrinciple instead.',
      ...(op === 'add' || op === 'sub'
        ? ['Addition and subtraction of shaped fuzzy numbers are closed in shape and exact on the cuts.']
        : ['Multiplication and division are not shape-preserving; the result is the α-cut envelope.']),
    ]),
  );
}

export const fuzzyAdd = (x: FuzzyNumber, y: FuzzyNumber) => fuzzyBinary(x, y, 'add');
export const fuzzySub = (x: FuzzyNumber, y: FuzzyNumber) => fuzzyBinary(x, y, 'sub');
export const fuzzyMul = (x: FuzzyNumber, y: FuzzyNumber) => fuzzyBinary(x, y, 'mul');
export const fuzzyDiv = (x: FuzzyNumber, y: FuzzyNumber) => fuzzyBinary(x, y, 'div');

/* ---------------------------------- the dependency problem, made explicit */

/**
 * NAIVE interval evaluation: every occurrence of the variable is allowed to
 * vary independently. Fast, and WRONG whenever the variable repeats.
 *
 * Supplied so the overestimate can be seen and compared, never as a default.
 * `X − X` through this route gives [a − c, c − a], not {0}.
 */
export function naiveIntervalFunction(
  x: FuzzyNumber,
  f: (occurrences: Ival[]) => Ival,
  occurrenceCount: number,
): Labelled<FuzzyNumber> {
  const v = new Validator();
  v.integer(occurrenceCount, 'occurrenceCount', 'Number of occurrences of the variable', 1, 32);
  v.throwIfInvalid();
  const levels: AlphaInterval[] = x.levels.map((l) => {
    const occ = Array.from({ length: occurrenceCount }, () => ({ lo: l.lo, hi: l.hi }));
    const r = f(occ);
    return { alpha: l.alpha, lo: r.lo, hi: r.hi };
  });
  return labelled(
    discretisedFuzzy(levels),
    provenance('fuzzy', 'numerical', [
      `DEPENDENCY PROBLEM: the variable occurs ${occurrenceCount} times and each occurrence was ` +
        'allowed to vary independently, so this result is an OUTER bound on the true range and is ' +
        'strictly too wide unless the variable occurs exactly once.',
      'The classic symptom is X − X evaluating to a non-degenerate interval instead of {0}.',
    ]),
    occurrenceCount > 1
      ? [
          'This is a naive interval evaluation with a repeated variable. The interval is too wide. ' +
            'Use extensionPrinciple for the true range.',
        ]
      : [],
  );
}

export type ExtensionMode =
  /** f is monotone on each α-cut, so the range is attained at the cut endpoints: exact. */
  | 'monotone'
  /** Dense sampling inside each α-cut: a numerical inner approximation of the range. */
  | 'sampled';

export interface ExtensionOptions {
  mode?: ExtensionMode;
  /** Samples per α-cut in 'sampled' mode. */
  samples?: number;
}

/**
 * Zadeh's extension principle for a function of ONE fuzzy variable,
 * propagated cut by cut:
 *
 *     f(A)_α = { f(x) : x ∈ A_α }
 *
 * Because x is a single quantity, repeated occurrences of x inside f cause no
 * overestimation — this is the α-cut optimisation route that avoids the
 * dependency problem. For a monotone f the range is exactly the image of the
 * two endpoints.
 */
export function extensionPrinciple(
  x: FuzzyNumber,
  f: (x: number) => number,
  opts: ExtensionOptions = {},
): Labelled<FuzzyNumber> {
  const mode = opts.mode ?? 'monotone';
  const samples = opts.samples ?? 65;
  const v = new Validator();
  v.integer(samples, 'samples', 'Samples per α-cut', 2, 100001);
  v.throwIfInvalid();
  const levels: AlphaInterval[] = x.levels.map((l) => {
    let lo: number;
    let hi: number;
    if (mode === 'monotone') {
      const a = f(l.lo);
      const b = f(l.hi);
      if (!Number.isFinite(a) || !Number.isFinite(b)) {
        throw new EngineError(
          `f is not finite at an endpoint of the α = ${l.alpha} cut [${l.lo}, ${l.hi}]: f gave ` +
            `${a} and ${b}. The image of that cut is not a bounded interval.`,
          'non-finite',
        );
      }
      lo = Math.min(a, b);
      hi = Math.max(a, b);
    } else {
      lo = Infinity;
      hi = -Infinity;
      const xs = l.hi === l.lo ? [l.lo] : linspace(l.lo, l.hi, samples);
      for (const xi of xs) {
        const y = f(xi);
        if (!Number.isFinite(y)) {
          throw new EngineError(
            `f(${xi}) = ${y} is not finite inside the α = ${l.alpha} cut; the image is unbounded.`,
            'non-finite',
          );
        }
        if (y < lo) lo = y;
        if (y > hi) hi = y;
      }
    }
    return { alpha: l.alpha, lo, hi };
  });
  // The image of nested sets is nested, but a sampled scan can break nesting by
  // a rounding-sized amount; enforce it monotonically from α = 1 downwards.
  for (let i = levels.length - 2; i >= 0; i--) {
    levels[i].lo = Math.min(levels[i].lo, levels[i + 1].lo);
    levels[i].hi = Math.max(levels[i].hi, levels[i + 1].hi);
  }
  return labelled(
    discretisedFuzzy(levels),
    provenance('fuzzy', mode === 'monotone' ? 'exact' : 'numerical', [
      'Single-variable extension principle: x is treated as ONE quantity, so repeated occurrences of ' +
        'x inside f do not inflate the result. This is the dependency-safe route.',
      mode === 'monotone'
        ? 'Assumes f is monotone on every α-cut. If it is not, the interval is too narrow — use mode "sampled".'
        : `Range found by scanning ${samples} points per cut: an INNER approximation, so a sharp ` +
          'extremum between samples can be missed.',
    ]),
    mode === 'monotone'
      ? ['Monotonicity of f on each α-cut is assumed and is not verified.']
      : ['Sampled range: an inner approximation of the true image.'],
  );
}

/**
 * Extension principle for a function of two **non-interactive** fuzzy
 * variables, over the α-cut rectangle. Monotone mode uses the four corners
 * (exact for functions monotone in each argument); sampled mode scans a grid.
 */
export function extensionPrinciple2(
  x: FuzzyNumber,
  y: FuzzyNumber,
  f: (x: number, y: number) => number,
  opts: ExtensionOptions = {},
): Labelled<FuzzyNumber> {
  const mode = opts.mode ?? 'monotone';
  const samples = opts.samples ?? 25;
  const alphas = commonLevels(x, y);
  const levels: AlphaInterval[] = alphas.map((alpha) => {
    const cx = alphaCutOf(x, alpha);
    const cy = alphaCutOf(y, alpha);
    const xs = mode === 'monotone' ? [cx.lower, cx.upper] : linspace(cx.lower, cx.upper, samples);
    const ys = mode === 'monotone' ? [cy.lower, cy.upper] : linspace(cy.lower, cy.upper, samples);
    let lo = Infinity;
    let hi = -Infinity;
    for (const xi of xs) {
      for (const yj of ys) {
        const z = f(xi, yj);
        if (!Number.isFinite(z)) {
          throw new EngineError(
            `f(${xi}, ${yj}) = ${z} is not finite inside the α = ${alpha} cut rectangle.`,
            'non-finite',
          );
        }
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    }
    return { alpha, lo, hi };
  });
  for (let i = levels.length - 2; i >= 0; i--) {
    levels[i].lo = Math.min(levels[i].lo, levels[i + 1].lo);
    levels[i].hi = Math.max(levels[i].hi, levels[i + 1].hi);
  }
  return labelled(
    discretisedFuzzy(levels),
    provenance('fuzzy', mode === 'monotone' ? 'exact' : 'numerical', [
      'The two inputs are assumed NON-INTERACTIVE: the joint possibility is min(μ_x, μ_y), so the ' +
        'α-cut of the pair is the rectangle. A dependence between them would shrink this.',
      mode === 'monotone'
        ? 'Corner evaluation; exact only if f is monotone in each argument over every cut rectangle.'
        : `Grid scan at ${samples}² points per cut: an inner approximation.`,
    ]),
  );
}

/** Defuzzify by the centroid of the membership function (for reporting only). */
export function centroid(fn: FuzzyNumber): Labelled<number> {
  let num = 0;
  let den = 0;
  for (let i = 1; i < fn.levels.length; i++) {
    const a = fn.levels[i - 1];
    const b = fn.levels[i];
    const dAlpha = b.alpha - a.alpha;
    const mLo = (a.lo + b.lo) / 2;
    const mHi = (a.hi + b.hi) / 2;
    num += dAlpha * ((mLo + mHi) / 2) * (mHi - mLo === 0 ? 1 : mHi - mLo);
    den += dAlpha * (mHi - mLo === 0 ? 1 : mHi - mLo);
  }
  if (den === 0) {
    throw new EngineError('The fuzzy number has zero area; its centroid is undefined.', 'degenerate');
  }
  return labelled(
    num / den,
    provenance('fuzzy', 'numerical', [
      'Defuzzification discards the whole fuzzy set in favour of one number. It is a reporting ' +
        'convenience and carries none of the original uncertainty.',
    ]),
    ['The centroid is not a mean and not a most-possible value; it is a shape summary.'],
  );
}
