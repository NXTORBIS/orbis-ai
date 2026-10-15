/**
 * Dempster–Shafer evidence theory.
 *
 * A basic probability assignment (mass function) m : 2^Θ → [0,1] with
 * Σ m(A) = 1 and m(∅) = 0 puts mass on *sets*, which is how it expresses
 * "my evidence points here, and I have no opinion about where inside":
 *
 *     Bel(A) = Σ_{B ⊆ A} m(B)        (what the evidence supports)
 *     Pl(A)  = Σ_{B ∩ A ≠ ∅} m(B)    (what the evidence does not rule out)
 *     q(A)   = Σ_{B ⊇ A} m(B)        (commonality)
 *
 * Bel(A) ≤ Pl(A) and Bel(A) = 1 − Pl(Aᶜ). The gap Pl − Bel is ignorance.
 *
 * Subsets are bitmasks and the lattice sums are fast zeta transforms, so a
 * frame of 20 elements costs 20 passes over a flat array and no recursion.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import {
  cardinality,
  type Frame,
  makeFrame,
  mobiusSubsets,
  subsetName,
  zetaSubsets,
  zetaSupersets,
} from './frame';
import { alphaCuts, makePossibility, type PossibilityDistribution } from './possibility';
import { type Bound, bound, type Labelled, labelled, NORM_TOL, provenance } from './types';

export interface FocalSet {
  mask: number;
  mass: number;
}

export interface MassFunction {
  readonly frame: Frame;
  /** m over every subset, indexed by bitmask. m[0] = 0 for a normalised bpa. */
  readonly m: Float64Array;
  /** Subsets with positive mass, for sparse combination. */
  readonly focal: readonly FocalSet[];
}

/**
 * Build a mass function from a sparse list of focal sets.
 *
 * Refuses: a negative mass (naming the subset), a total other than 1
 * (reporting the actual total), and mass on ∅ (which encodes contradiction and
 * must be handled explicitly by a combination rule, never carried silently).
 */
export function makeMass(
  elements: readonly string[],
  focal: readonly { set: readonly string[]; mass: number }[],
): MassFunction {
  const frame = makeFrame(elements);
  const m = new Float64Array(frame.size);
  const v = new Validator();
  for (const f of focal) {
    if (!v.finite(f.mass, 'mass', `m({${f.set.join(', ')}})`)) continue;
    if (f.mass < 0) {
      v.add(
        `m({${f.set.join(', ')}}) = ${f.mass} is negative. A basic probability assignment cannot ` +
          'have negative mass; a signed set function is a different object and is not supported here.',
        'mass',
        'negative-mass',
      );
      continue;
    }
    let mask = 0;
    for (const label of f.set) {
      const i = frame.elements.indexOf(label);
      if (i < 0) {
        v.add(`"${label}" is not in the frame {${frame.elements.join(', ')}}.`, 'set', 'unknown-element');
        mask = -1;
        break;
      }
      mask |= 1 << i;
    }
    if (mask < 0) continue;
    if (mask === 0) {
      v.add(
        'Mass was assigned to the empty set. m(∅) > 0 means the evidence is self-contradictory ' +
          'relative to the frame; either the frame is not exhaustive or a combination rule must ' +
          'dispose of the conflict explicitly.',
        'set',
        'mass-on-empty',
      );
      continue;
    }
    m[mask] += f.mass;
  }
  v.throwIfInvalid();
  const total = stableSum(m);
  if (Math.abs(total - 1) > NORM_TOL) {
    throw new EngineError(
      `A basic probability assignment must sum to 1; these masses sum to ${total} ` +
        `(short by ${1 - total}). Add the missing mass explicitly — assigning it to the whole ` +
        'frame Θ states "the rest of my belief is uncommitted", which is a different claim from ' +
        'rescaling what you gave.',
      'not-normalised',
    );
  }
  return { frame, m, focal: collectFocal(m) };
}

function collectFocal(m: Float64Array): FocalSet[] {
  const out: FocalSet[] = [];
  for (let s = 0; s < m.length; s++) if (m[s] > 0) out.push({ mask: s, mass: m[s] });
  return out;
}

/** Internal constructor that trusts an already validated dense array. */
function massFromArray(frame: Frame, m: Float64Array): MassFunction {
  return { frame, m, focal: collectFocal(m) };
}

/** All mass on Θ: the vacuous belief function. Total ignorance. */
export function vacuousMass(elements: readonly string[]): MassFunction {
  const frame = makeFrame(elements);
  const m = new Float64Array(frame.size);
  m[frame.full] = 1;
  return massFromArray(frame, m);
}

/** A Bayesian mass function: all mass on singletons, i.e. an ordinary probability. */
export function bayesianMass(elements: readonly string[], p: readonly number[]): MassFunction {
  return makeMass(
    elements,
    p.map((mass, i) => ({ set: [elements[i]], mass })),
  );
}

/* ----------------------------------------------- lattice transforms */

/** Bel over every subset, by fast zeta transform. O(n·2^n), iterative. */
export function beliefArray(mass: MassFunction): Float64Array {
  const a = Float64Array.from(mass.m);
  zetaSubsets(a, mass.frame.n);
  return a;
}

/** q over every subset (commonality), by superset zeta transform. */
export function commonalityArray(mass: MassFunction): Float64Array {
  const a = Float64Array.from(mass.m);
  zetaSupersets(a, mass.frame.n);
  return a;
}

/** Pl over every subset, from Bel by the duality Pl(A) = 1 − Bel(Aᶜ). */
export function plausibilityArray(mass: MassFunction): Float64Array {
  const bel = beliefArray(mass);
  const out = new Float64Array(mass.frame.size);
  for (let s = 0; s < out.length; s++) out[s] = 1 - bel[mass.frame.full & ~s];
  // Pl(∅) = 0 by definition, not by subtraction: 1 − Bel(Θ) rounds to ~1e-16.
  out[0] = 0;
  return out;
}

export function belief(mass: MassFunction, mask: number): number {
  let s = 0;
  for (const f of mass.focal) if ((f.mask & ~mask) === 0) s += f.mass;
  return s;
}

export function plausibility(mass: MassFunction, mask: number): number {
  let s = 0;
  for (const f of mass.focal) if ((f.mask & mask) !== 0) s += f.mass;
  return s;
}

export function commonality(mass: MassFunction, mask: number): number {
  let s = 0;
  for (const f of mass.focal) if ((mask & ~f.mask) === 0) s += f.mass;
  return s;
}

/** [Bel(A), Pl(A)] — a bound on P(A) over the credal set of m. */
export function beliefInterval(mass: MassFunction, mask: number): Bound {
  return bound(
    belief(mass, mask),
    plausibility(mass, mask),
    provenance('belief', 'exact', [
      `Bel(${subsetName(mass.frame, mask)}) ≤ P ≤ Pl(${subsetName(mass.frame, mask)}) for every ` +
        'probability measure in the credal set of m. These are bounds, not an estimate.',
      'The width Pl − Bel is ignorance about where inside the focal sets the truth lies.',
    ]),
  );
}

/** Recover m from an arbitrary Bel array by Möbius inversion (for diagnostics). */
export function massFromBelief(frame: Frame, bel: Float64Array): MassFunction {
  const a = Float64Array.from(bel);
  mobiusSubsets(a, frame.n);
  for (let s = 0; s < a.length; s++) {
    if (a[s] < -NORM_TOL) {
      throw new EngineError(
        `Möbius inversion of the given Bel yields m(${subsetName(frame, s)}) = ${a[s]}, which is ` +
          'negative. The supplied set function is therefore not a belief function (it is not ' +
          'totally monotone); no mass function represents it.',
        'not-a-belief-function',
      );
    }
    if (a[s] < 0) a[s] = 0;
  }
  return massFromArray(frame, a);
}

/* ----------------------------- possibility ↔ consonant belief function */

/**
 * The consonant mass function of a possibility distribution.
 *
 * Focal sets are the α-cuts, which are nested, with m(A_j) = α_j − α_{j+1}.
 * For the result, Pl = Π and Bel = N on **every** subset: a possibility
 * distribution and a consonant belief function are the same object.
 */
export function consonantMassFromPossibility(dist: PossibilityDistribution): Labelled<MassFunction> {
  const cuts = alphaCuts(dist);
  const m = new Float64Array(dist.frame.size);
  for (let j = 0; j < cuts.length; j++) {
    m[cuts[j].mask] += cuts[j].alpha - (j + 1 < cuts.length ? cuts[j + 1].alpha : 0);
  }
  return labelled(
    massFromArray(dist.frame, m),
    provenance('belief', 'exact', [
      'Consonant (nested) focal sets. Pl = Π and Bel = N on every subset — this is an exact ' +
        're-encoding, not an approximation, and it loses nothing in either direction.',
    ]),
  );
}

/**
 * Recover the possibility distribution of a consonant mass function.
 * Refuses a non-nested (non-consonant) m, naming two incomparable focal sets:
 * such an m is strictly more expressive than any possibility distribution.
 */
export function possibilityFromConsonantMass(mass: MassFunction): Labelled<PossibilityDistribution> {
  const focal = [...mass.focal].sort((a, b) => cardinality(a.mask) - cardinality(b.mask));
  for (let i = 1; i < focal.length; i++) {
    const a = focal[i - 1].mask;
    const b = focal[i].mask;
    if ((a & ~b) !== 0) {
      throw new EngineError(
        `This mass function is not consonant: focal sets ${subsetName(mass.frame, a)} and ` +
          `${subsetName(mass.frame, b)} are not nested. Only consonant belief functions correspond ` +
          'to possibility distributions; converting a non-consonant one would discard the conflict ' +
          'it encodes.',
        'not-consonant',
      );
    }
  }
  const pl = plausibilityArray(mass);
  const pi = mass.frame.elements.map((_, i) => pl[1 << i]);
  return labelled(
    makePossibility(mass.frame.elements, pi),
    provenance('possibility', 'exact', [
      'π(ω) = Pl({ω}) for a consonant mass function; the correspondence is exact both ways.',
    ]),
  );
}

/* ------------------------------------------------ combination rules */

export type ConflictPolicy = 'warn' | 'refuse';

export interface CombinationResult {
  mass: MassFunction;
  /** Conflict mass K = Σ_{A∩B=∅} m₁(A)m₂(B), discarded by Dempster's rule. */
  conflict: number;
  /** True when K is high enough that Dempster's rule is known to misbehave. */
  pathological: boolean;
}

/**
 * Threshold above which Dempster's normalisation is flagged. At K = 0.9 the
 * surviving 10% of the product mass decides the whole answer, which is how
 * Zadeh's counterexample turns two confident, contradictory sources into
 * certainty about a hypothesis both of them nearly excluded.
 */
export const HIGH_CONFLICT = 0.9;

/** Unnormalised conjunctive combination; keeps the conflict on ∅. */
function conjunctive(a: MassFunction, b: MassFunction): { raw: Float64Array; conflict: number } {
  assertSameFrame(a, b);
  const raw = new Float64Array(a.frame.size);
  for (const f of a.focal) {
    for (const g of b.focal) {
      raw[f.mask & g.mask] += f.mass * g.mass;
    }
  }
  const conflict = raw[0];
  return { raw, conflict };
}

function assertSameFrame(a: MassFunction, b: MassFunction): void {
  if (a.frame.n !== b.frame.n || a.frame.elements.some((e, i) => e !== b.frame.elements[i])) {
    throw new EngineError(
      `Cannot combine mass functions on different frames: {${a.frame.elements.join(', ')}} and ` +
        `{${b.frame.elements.join(', ')}}. Refine both to a common frame first.`,
      'frame-mismatch',
    );
  }
}

/**
 * Dempster's rule of combination: conjunctive pooling, then normalisation by
 * 1 − K. Assumes the two sources are **independent** and that the frame is
 * exhaustive.
 *
 * Division by 1 − K is the rule's notorious weak point. When K is near 1 the
 * answer is decided by a vanishing sliver of agreement and bears no sensible
 * relation to either input. This implementation never hides that: it reports K,
 * flags the pathology, and with `policy: 'refuse'` throws rather than returning
 * a confident-looking number.
 */
export function dempsterCombine(
  a: MassFunction,
  b: MassFunction,
  policy: ConflictPolicy = 'warn',
): Labelled<CombinationResult> {
  const { raw, conflict } = conjunctive(a, b);
  if (1 - conflict <= NORM_TOL) {
    throw new EngineError(
      `Total conflict: K = ${conflict}, so no pair of focal sets intersects and Dempster's rule ` +
        'divides by zero. The two sources agree on nothing, which means the frame is not ' +
        'exhaustive or at least one source is wrong. No combined belief function exists.',
      'total-conflict',
    );
  }
  const pathological = conflict >= HIGH_CONFLICT;
  if (pathological && policy === 'refuse') {
    throw new EngineError(
      `Conflict mass K = ${conflict} ≥ ${HIGH_CONFLICT}. Dempster's rule would renormalise by ` +
        `1 − K = ${1 - conflict}, letting that sliver of agreement determine the entire result — ` +
        "Zadeh's counterexample. Refusing. Use Yager's rule (conflict → Θ), the disjunctive rule, " +
        'or averaging, and state which you chose.',
      'high-conflict',
    );
  }
  const m = new Float64Array(raw.length);
  const scale = 1 / (1 - conflict);
  for (let s = 1; s < raw.length; s++) m[s] = raw[s] * scale;
  const warnings: string[] = [];
  if (pathological) {
    warnings.push(
      `PATHOLOGICAL: conflict mass K = ${conflict.toPrecision(6)}. Dempster's rule divided by ` +
        `1 − K = ${(1 - conflict).toPrecision(6)}, so this result is an amplification of the ` +
        'sources\' only point of agreement, however marginal they both considered it. This is ' +
        "Zadeh's counterexample. Do not act on this number without comparing an alternative rule.",
    );
  } else if (conflict > 0.3) {
    warnings.push(`Substantial conflict: K = ${conflict.toPrecision(4)} of the product mass was discarded.`);
  }
  return labelled(
    { mass: massFromArray(a.frame, m), conflict, pathological },
    provenance(
      'belief',
      'exact',
      [
        'Dempster normalisation discards the conflict mass K entirely rather than accounting for it.',
        'The rule is only justified when the two sources are independent.',
      ],
      ['You are asserting that the sources are independent and that the frame contains the truth.'],
    ),
    warnings,
  );
}

/**
 * Yager's rule: identical to Dempster's conjunctive step, but the conflict mass
 * is moved to Θ instead of renormalised away.
 *
 * Sacrifices: associativity (combining three sources depends on the order) and
 * idempotent-looking sharpness — it is deliberately less committal, so strong
 * agreement yields weaker conclusions than Dempster's rule.
 */
export function yagerCombine(a: MassFunction, b: MassFunction): Labelled<CombinationResult> {
  const { raw, conflict } = conjunctive(a, b);
  const m = new Float64Array(raw.length);
  for (let s = 1; s < raw.length; s++) m[s] = raw[s];
  m[0] = 0;
  m[a.frame.full] += conflict;
  return labelled(
    { mass: massFromArray(a.frame, m), conflict, pathological: false },
    provenance('belief', 'exact', [
      'Conflict is reinterpreted as ignorance and assigned to Θ, so no renormalisation occurs.',
      'Sacrifices associativity: the result of combining three or more sources depends on the order.',
      'Deliberately less committal than Dempster; it will not manufacture certainty from conflict.',
    ]),
    conflict >= HIGH_CONFLICT
      ? [`Conflict K = ${conflict.toPrecision(6)} was transferred to Θ, so the result is close to vacuous — which is the honest reading of two sources that contradict each other.`]
      : [],
  );
}

/**
 * Disjunctive (Dubois–Prade) pooling: m(A ∪ B) += m₁(A)·m₂(B).
 *
 * Assumes only that **at least one** source is right, so it never conflicts and
 * never needs normalisation. Sacrifices specificity: the result is always at
 * least as unspecific as either input, often much more.
 */
export function disjunctiveCombine(a: MassFunction, b: MassFunction): Labelled<CombinationResult> {
  assertSameFrame(a, b);
  const m = new Float64Array(a.frame.size);
  for (const f of a.focal) for (const g of b.focal) m[f.mask | g.mask] += f.mass * g.mass;
  return labelled(
    { mass: massFromArray(a.frame, m), conflict: 0, pathological: false },
    provenance('belief', 'exact', [
      'Assumes at least one source is reliable, not both; hence no conflict can arise.',
      'Sacrifices specificity: focal sets grow, so Bel falls and Pl rises.',
    ]),
  );
}

/**
 * Dubois–Prade's hybrid rule: intersect when the intersection is non-empty,
 * union when it is empty. Keeps conjunctive sharpness where the sources agree
 * and falls back to disjunctive caution exactly where they clash.
 * Sacrifices associativity.
 */
export function duboisPradeCombine(a: MassFunction, b: MassFunction): Labelled<CombinationResult> {
  assertSameFrame(a, b);
  const m = new Float64Array(a.frame.size);
  let conflict = 0;
  for (const f of a.focal) {
    for (const g of b.focal) {
      const inter = f.mask & g.mask;
      if (inter !== 0) m[inter] += f.mass * g.mass;
      else {
        m[f.mask | g.mask] += f.mass * g.mass;
        conflict += f.mass * g.mass;
      }
    }
  }
  return labelled(
    { mass: massFromArray(a.frame, m), conflict, pathological: false },
    provenance('belief', 'exact', [
      'Conflicting pairs are resolved disjunctively instead of being renormalised away.',
      'Sacrifices associativity; the reported conflict is informational, not discarded.',
    ]),
  );
}

/**
 * Simple averaging (Murphy): m = (m₁ + m₂)/2.
 *
 * Sacrifices convergence with accumulating evidence — averaging n agreeing
 * sources is no more committed than one of them — and is not a pooling rule in
 * the evidential sense at all. Its virtue is that it cannot produce a
 * conclusion that neither source supports.
 */
export function averageCombine(a: MassFunction, b: MassFunction, weight = 0.5): Labelled<CombinationResult> {
  assertSameFrame(a, b);
  const v = new Validator();
  v.range(weight, 'weight', 'Weight on the first source', 0, 1);
  v.throwIfInvalid();
  const m = new Float64Array(a.frame.size);
  for (let s = 0; s < m.length; s++) m[s] = weight * a.m[s] + (1 - weight) * b.m[s];
  return labelled(
    { mass: massFromArray(a.frame, m), conflict: 0, pathological: false },
    provenance('belief', 'exact', [
      'Averaging is not evidential pooling: repeated agreeing evidence does not sharpen the result.',
      'In exchange, it can never concentrate belief where neither source put any.',
    ]),
  );
}

/* --------------------------------------------- pignistic and discounting */

/**
 * Pignistic (betting) transform: BetP(ω) = Σ_{A ∋ ω} m(A)/|A|.
 *
 * Smets' transformable level: this is what you must bet on if forced to bet,
 * and it is the pignistic *choice* of indifference inside each focal set, not
 * an inference from m. On a Bayesian mass function it is the identity.
 */
export function pignisticTransform(mass: MassFunction): Labelled<number[]> {
  const p = new Array<number>(mass.frame.n).fill(0);
  for (const f of mass.focal) {
    const share = f.mass / cardinality(f.mask);
    for (let i = 0; i < mass.frame.n; i++) if (f.mask & (1 << i)) p[i] += share;
  }
  return labelled(
    p,
    provenance(
      'belief',
      'exact',
      [
        'The equal split inside each focal set is a betting convention (insufficient reason), not a ' +
          'consequence of the evidence. Every distribution between Bel and Pl remains admissible.',
        'Collapsing to BetP throws away the Bel/Pl gap, i.e. the record of how much you did not know.',
      ],
      ['You are committing to indifference inside each focal set in order to get a single number.'],
    ),
    ['BetP is a decision aid, not a belief: the underlying ignorance is still there.'],
  );
}

/**
 * Shafer–Smets discounting of an unreliable source (Pichon & Denoeux's
 * reliability reading): with probability α the source says nothing, so
 * m'(A) = (1−α)m(A) for A ≠ Θ and m'(Θ) = (1−α)m(Θ) + α.
 */
export function discount(mass: MassFunction, alpha: number): Labelled<MassFunction> {
  const v = new Validator();
  v.probability(alpha, 'alpha', 'Discount rate α (probability the source is unreliable)');
  v.throwIfInvalid();
  const m = new Float64Array(mass.frame.size);
  for (let s = 1; s < m.length; s++) m[s] = (1 - alpha) * mass.m[s];
  m[mass.frame.full] += alpha;
  return labelled(
    massFromArray(mass.frame, m),
    provenance('belief', 'exact', [
      `α = ${alpha} is the probability that the source is unreliable, in which case its testimony is ` +
        'replaced by the vacuous belief function rather than by its negation.',
      'Discounting always weakens: Bel falls and Pl rises for every subset.',
    ]),
  );
}

/**
 * Contextual discounting (Pichon & Denoeux 2009) on the singleton partition:
 * the source may be unreliable to a different degree about each element. In
 * terms of the implicability function b(A) = Σ_{B⊆A} m(B) (= Bel for a
 * normalised bpa), the disjunctive construction gives
 *
 *     b'(A) = b(A) · Π_{ω ∉ A} (1 − α_ω)
 *
 * computed by a subset zeta transform, the pointwise product and the Möbius
 * inversion. `discount` above is the coarsest-partition case of the same
 * family (one rate for the whole frame) and is NOT the equal-rate case of this
 * function: a finer partition is a different, more expressive operator.
 * Refuses if the inversion yields a negative mass.
 */
export function contextualDiscount(mass: MassFunction, alpha: readonly number[]): Labelled<MassFunction> {
  const { frame } = mass;
  if (alpha.length !== frame.n) {
    throw new EngineError(
      `Contextual discounting needs one rate per frame element: got ${alpha.length}, need ${frame.n}.`,
      'length',
    );
  }
  const v = new Validator();
  for (let i = 0; i < alpha.length; i++) v.probability(alpha[i], `alpha[${i}]`, `α(${frame.elements[i]})`);
  v.throwIfInvalid();
  const b = Float64Array.from(mass.m);
  zetaSubsets(b, frame.n);
  for (let s = 0; s < b.length; s++) {
    let factor = 1;
    for (let i = 0; i < frame.n; i++) if (!(s & (1 << i))) factor *= 1 - alpha[i];
    b[s] *= factor;
  }
  mobiusSubsets(b, frame.n);
  for (let s = 0; s < b.length; s++) {
    if (b[s] < -1e-10) {
      throw new EngineError(
        `Contextual discounting produced m(${subsetName(frame, s)}) = ${b[s]}, which is negative. ` +
          'The supplied reliability profile is not representable as a discounting of this mass ' +
          'function; no valid bpa results.',
        'negative-mass',
      );
    }
    if (b[s] < 0) b[s] = 0;
  }
  const total = stableSum(b);
  if (Math.abs(total - 1) > 1e-9) {
    throw new EngineError(
      `Contextual discounting produced masses summing to ${total}, not 1. Refusing to rescale.`,
      'not-normalised',
    );
  }
  return labelled(
    massFromArray(frame, b),
    provenance('belief', 'exact', [
      'Per-element reliabilities: α(ω) is the degree to which the source is discounted about ω.',
      'All rates 0 leaves m unchanged; all rates 1 reduces m to the vacuous belief function.',
      'This is the singleton-partition operator. The single-rate `discount` is the coarsest-partition ' +
        'member of the same family, so the two agree only in special cases.',
    ]),
  );
}

/* ------------------------------------------- uncertainty measures */

export interface UncertaintyMeasures {
  /** Hartley non-specificity Σ m(A) log₂|A|: "how little I have pinned down". */
  nonSpecificity: number;
  /** Yager dissonance −Σ m(A) log₂ Pl(A): "how much my evidence fights itself". */
  dissonance: number;
  /** Höhle confusion −Σ m(A) log₂ Bel(A). */
  confusion: number;
  /** Klir–Parviz strife: discord measured against the evidence's own overlap. */
  strife: number;
  /** nonSpecificity + dissonance: the Lamata–Moral total uncertainty. */
  total: number;
  /** log₂|Θ|, the maximum non-specificity, for scale. */
  maxNonSpecificity: number;
}

/**
 * Non-specificity and discord are *different* kinds of not-knowing and a single
 * probability can express neither separately:
 *
 *  - vacuous m (no evidence):      nonSpecificity = log₂|Θ|, dissonance = 0
 *  - uniform Bayesian m (conflict): nonSpecificity = 0,       dissonance = log₂|Θ|
 *
 * Both have the same pignistic probability. Only the pair of measures tells you
 * whether you are ignorant or merely torn.
 */
export function uncertaintyMeasures(mass: MassFunction): Labelled<UncertaintyMeasures> {
  const pl = plausibilityArray(mass);
  const bel = beliefArray(mass);
  let nonSpec = 0;
  let diss = 0;
  let conf = 0;
  let strife = 0;
  for (const f of mass.focal) {
    nonSpec += f.mass * Math.log2(cardinality(f.mask));
    diss -= f.mass * Math.log2(pl[f.mask]);
    conf -= f.mass * Math.log2(bel[f.mask] > 0 ? bel[f.mask] : Number.MIN_VALUE);
    let overlap = 0;
    for (const g of mass.focal) overlap += g.mass * (cardinality(f.mask & g.mask) / cardinality(f.mask));
    strife -= f.mass * Math.log2(overlap);
  }
  return labelled(
    {
      nonSpecificity: nonSpec,
      dissonance: diss,
      confusion: conf,
      strife,
      total: nonSpec + diss,
      maxNonSpecificity: Math.log2(mass.frame.n),
    },
    provenance('belief', 'exact', [
      'Non-specificity measures missing evidence; dissonance/strife measure conflicting evidence. ' +
        'They are not interchangeable and neither alone is "the" uncertainty.',
      'Units are bits. The total is an additive aggregate, not a probability.',
    ]),
  );
}

export type CommitmentOrder = 'equal' | 'first-more-committed' | 'second-more-committed' | 'incomparable';

/**
 * Weak (pl/bel) inclusion ordering: m₁ is at least as committed as m₂ when
 * Bel₁(A) ≥ Bel₂(A) for every A.
 *
 * Note: weak inclusion is **necessary but not sufficient** for m₁ to be a
 * specialisation of m₂ (which additionally requires a stochastic matrix moving
 * each focal set's mass only to its own subsets). The least-committed choice
 * among candidates is the one no other is strictly below.
 */
export function commitmentOrder(a: MassFunction, b: MassFunction): Labelled<CommitmentOrder> {
  assertSameFrame(a, b);
  const ba = beliefArray(a);
  const bb = beliefArray(b);
  let aAbove = false;
  let bAbove = false;
  for (let s = 1; s < ba.length; s++) {
    if (ba[s] > bb[s] + NORM_TOL) aAbove = true;
    else if (bb[s] > ba[s] + NORM_TOL) bAbove = true;
  }
  const order: CommitmentOrder =
    aAbove && bAbove ? 'incomparable' : aAbove ? 'first-more-committed' : bAbove ? 'second-more-committed' : 'equal';
  return labelled(
    order,
    provenance('belief', 'exact', [
      'Weak inclusion (Bel ordering). Necessary but not sufficient for specialisation.',
      'Walley\'s least-commitment principle says to prefer the least committed admissible belief function.',
    ]),
  );
}
