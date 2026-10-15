/**
 * Possibility theory (Zadeh 1978; Dubois & Prade 1988).
 *
 * A possibility distribution π : Θ → [0,1] grades how *unsurprising* each
 * element is. π(ω) = 1 means "entirely unsurprising", π(ω) = 0 means
 * "ruled out". It induces two dual set functions:
 *
 *     Π(A) = sup_{ω∈A} π(ω)          (possibility)
 *     N(A) = 1 − Π(Aᶜ)               (necessity)
 *
 * The crucial structural fact — the whole reason the theory is not a disguised
 * probability — is that Π is **maxitive**: Π(A∪B) = max(Π A, Π B), never a sum.
 * Dually N is minitive: N(A∩B) = min(N A, N B).
 *
 * Total ignorance is representable: π ≡ 1 gives N(A) = 0 and Π(A) = 1 for
 * every proper non-empty A. No single probability distribution can say that.
 */
import { EngineError, Validator } from '../core/result';
import { clamp } from '../core/numeric';
import { cardinality, type Frame, makeFrame, subsetName } from './frame';
import { type Bound, bound, type Labelled, labelled, NORM_TOL, provenance } from './types';

export interface PossibilityDistribution {
  readonly frame: Frame;
  /** π(ω_i) for each element, in frame order. sup π = 1 is enforced. */
  readonly pi: readonly number[];
}

/**
 * Build a possibility distribution.
 *
 * Refuses an unnormalised π, reporting the actual supremum. Renormalising
 * silently would change the meaning of the input (a sub-normalised π encodes
 * partial inconsistency: the information rules out every element to some
 * degree), so the caller must decide what to do.
 */
export function makePossibility(elements: readonly string[], pi: readonly number[]): PossibilityDistribution {
  const frame = makeFrame(elements);
  if (pi.length !== frame.n) {
    throw new EngineError(
      `Possibility distribution has ${pi.length} degrees but the frame has ${frame.n} elements.`,
      'length',
    );
  }
  const v = new Validator();
  for (let i = 0; i < pi.length; i++) v.probability(pi[i], `pi[${i}]`, `π(${elements[i]})`);
  v.throwIfInvalid();
  let sup = -Infinity;
  for (const p of pi) if (p > sup) sup = p;
  if (Math.abs(sup - 1) > NORM_TOL) {
    throw new EngineError(
      `A possibility distribution must be normalised (sup π = 1); this one has sup π = ${sup}. ` +
        (sup < 1
          ? 'A supremum below 1 means the information is partially inconsistent — every element is ' +
            'ruled out to some degree. Decide whether to drop a constraint or to accept the ' +
            'inconsistency explicitly; this module will not rescale it for you.'
          : 'A supremum above 1 is outside the scale.'),
      'not-normalised',
    );
  }
  return { frame, pi: [...pi] };
}

/** π ≡ 1: total ignorance. Every element is entirely unsurprising. */
export function vacuousPossibility(elements: readonly string[]): PossibilityDistribution {
  return makePossibility(elements, elements.map(() => 1));
}

/** Π(A) = sup_{ω∈A} π(ω). Π(∅) = 0 by convention. */
export function possibilityOf(dist: PossibilityDistribution, mask: number): number {
  let m = 0;
  for (let i = 0; i < dist.frame.n; i++) {
    if (mask & (1 << i)) {
      const p = dist.pi[i];
      if (p > m) m = p;
    }
  }
  return mask === 0 ? 0 : m;
}

/** N(A) = 1 − Π(Aᶜ). The defining duality, computed, not asserted. */
export function necessityOf(dist: PossibilityDistribution, mask: number): number {
  return 1 - possibilityOf(dist, dist.frame.full & ~mask);
}

/** Both measures with provenance; Π and N are bounds on any dominated P(A). */
export function possibilityInterval(dist: PossibilityDistribution, mask: number): Bound {
  const lo = necessityOf(dist, mask);
  const hi = possibilityOf(dist, mask);
  return bound(
    lo,
    hi,
    provenance('possibility', 'exact', [
      `N(${subsetName(dist.frame, mask)}) ≤ P ≤ Π(${subsetName(dist.frame, mask)}) for every probability ` +
        'measure dominated by π. These are bounds, not an estimate.',
      'N(A) = 1 − Π(Aᶜ) always; the two numbers are not independent.',
    ]),
  );
}

/* ------------------------------------------------------- alpha-cuts */

export interface AlphaCut {
  /** Cut level α ∈ (0, 1]. */
  alpha: number;
  /** Bitmask of {ω : π(ω) ≥ α}. */
  mask: number;
  /** Cardinality of the cut, i.e. how unspecific the information is at α. */
  size: number;
}

/**
 * The strong-to-weak nested family of α-cuts at every distinct level of π.
 *
 * The cuts are nested: α ≥ β ⟹ A_α ⊆ A_β. This nesting is exactly what makes
 * a possibility distribution equivalent to a *consonant* belief function.
 */
export function alphaCuts(dist: PossibilityDistribution): AlphaCut[] {
  const levels = [...new Set(dist.pi.filter((p) => p > 0))].sort((a, b) => b - a);
  return levels.map((alpha) => {
    let mask = 0;
    for (let i = 0; i < dist.frame.n; i++) if (dist.pi[i] >= alpha) mask |= 1 << i;
    return { alpha, mask, size: cardinality(mask) };
  });
}

/** Reconstruct π from a nested family: π(ω) = sup{α : ω ∈ A_α}. */
export function possibilityFromAlphaCuts(frame: Frame, cuts: readonly AlphaCut[]): PossibilityDistribution {
  const pi = new Array<number>(frame.n).fill(0);
  for (const c of cuts) {
    for (let i = 0; i < frame.n; i++) if (c.mask & (1 << i)) pi[i] = Math.max(pi[i], c.alpha);
  }
  return makePossibility(frame.elements, pi);
}

/* --------------------------------- probability ↔ possibility */

/**
 * Dubois–Prade optimal (most specific) probability → possibility transform.
 *
 *     π(ω) = Σ_{ω' : p(ω') ≤ p(ω)} p(ω')
 *
 * This is the pointwise-smallest π whose Π dominates P and whose ordering
 * agrees with p's. The transform **loses information**: many different
 * probability distributions map to the same π, and the resulting Π(A) ≥ P(A)
 * with strict inequality almost everywhere. Going this way is always sound and
 * always weaker.
 */
export function probabilityToPossibility(
  elements: readonly string[],
  p: readonly number[],
): Labelled<PossibilityDistribution> {
  const frame = makeFrame(elements);
  if (p.length !== frame.n) {
    throw new EngineError(`Probability vector has ${p.length} entries but the frame has ${frame.n}.`, 'length');
  }
  const v = new Validator();
  for (let i = 0; i < p.length; i++) v.probability(p[i], `p[${i}]`, `p(${elements[i]})`);
  v.throwIfInvalid();
  let total = 0;
  for (const x of p) total += x;
  if (Math.abs(total - 1) > NORM_TOL) {
    throw new EngineError(
      `A probability distribution must sum to 1; these values sum to ${total}.`,
      'not-normalised',
    );
  }
  const pi = p.map((pi_) => {
    let s = 0;
    for (const q of p) if (q <= pi_) s += q;
    return clamp(s, 0, 1);
  });
  // The largest p always accumulates the whole mass, so sup π = 1 up to
  // rounding; clamp handles the rounding, normalisation is then structural.
  const maxIdx = pi.indexOf(Math.max(...pi));
  const fixed = pi.slice();
  fixed[maxIdx] = 1;
  return labelled(
    makePossibility(elements, fixed),
    provenance(
      'possibility',
      'exact',
      [
        'Direction: probability → possibility. This DISCARDS information: Π(A) ≥ P(A) with strict ' +
          'inequality for most A, and the map is many-to-one, so P cannot be recovered from π.',
        'The result is the most specific π consistent with P under the Dubois–Prade transform; any ' +
          'less specific π would discard still more.',
      ],
      ['You are choosing to weaken a precise probability into an ordinal plausibility ranking.'],
    ),
    ['Converting a probability to a possibility loses information and cannot be undone.'],
  );
}

/**
 * Vertices of the credal set P(π) = { P : P(A) ≤ Π(A) for all A }.
 *
 * For the consonant belief function induced by π the extreme points are
 * obtained by, for each permutation of Θ, giving each focal set's mass
 * entirely to its earliest element under that permutation. Enumerating
 * permutations is n!, so this refuses above `MAX_VERTEX_FRAME`.
 */
export const MAX_VERTEX_FRAME = 7;

export function dominatedProbabilityVertices(dist: PossibilityDistribution): Labelled<number[][]> {
  const { frame } = dist;
  if (frame.n > MAX_VERTEX_FRAME) {
    throw new EngineError(
      `Enumerating the vertices of P(π) needs ${frame.n}! permutations of the frame; the limit is ` +
        `${MAX_VERTEX_FRAME} elements (${factorial(MAX_VERTEX_FRAME)} permutations). ` +
        'Use necessityOf / possibilityOf for bounds on individual events instead.',
      'frame-too-large',
    );
  }
  const cuts = alphaCuts(dist);
  // Consonant masses: m(A_j) = α_j − α_{j+1}, with α_{k+1} = 0.
  const focal: { mask: number; mass: number }[] = cuts.map((c, j) => ({
    mask: c.mask,
    mass: c.alpha - (j + 1 < cuts.length ? cuts[j + 1].alpha : 0),
  }));
  const seen = new Set<string>();
  const vertices: number[][] = [];
  for (const perm of permutations(frame.n)) {
    const p = new Array<number>(frame.n).fill(0);
    for (const f of focal) {
      for (const idx of perm) {
        if (f.mask & (1 << idx)) {
          p[idx] += f.mass;
          break;
        }
      }
    }
    const key = p.map((x) => x.toFixed(12)).join('|');
    if (!seen.has(key)) {
      seen.add(key);
      vertices.push(p);
    }
  }
  return labelled(
    vertices,
    provenance('possibility', 'exact', [
      'These are the extreme points of the set of probability measures dominated by π.',
      'Lower and upper probabilities over this set coincide exactly with N and Π.',
    ]),
  );
}

function factorial(n: number): number {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Iterative (Heap-free) permutation generation; no recursion. */
function* permutations(n: number): Generator<number[]> {
  const a = Array.from({ length: n }, (_, i) => i);
  yield a.slice();
  const c = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
      yield a.slice();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
}

export interface ConsistencyReport {
  /** True iff P(A) ≤ Π(A) for every A (equivalently p(ω) ≤ π(ω) is NOT enough; all A are checked). */
  dominates: boolean;
  /** Zadeh's degree of consistency, Σ p(ω)·π(ω) ∈ [0,1]. */
  zadehConsistency: number;
  /** Largest violation P(A) − Π(A) found, with the offending subset. */
  worstViolation: { mask: number; excess: number } | null;
}

/**
 * The probability/possibility consistency principle: P is consistent with π
 * when Π dominates P on every event. Checked over the whole subset lattice
 * iteratively — it is NOT sufficient to check singletons.
 */
export function checkConsistency(
  dist: PossibilityDistribution,
  p: readonly number[],
): Labelled<ConsistencyReport> {
  const { frame } = dist;
  if (p.length !== frame.n) {
    throw new EngineError(`Probability vector has ${p.length} entries but the frame has ${frame.n}.`, 'length');
  }
  let worst: { mask: number; excess: number } | null = null;
  for (let mask = 1; mask <= frame.full; mask++) {
    let pa = 0;
    for (let i = 0; i < frame.n; i++) if (mask & (1 << i)) pa += p[i];
    const excess = pa - possibilityOf(dist, mask);
    if (excess > NORM_TOL && (worst === null || excess > worst.excess)) worst = { mask, excess };
  }
  let z = 0;
  for (let i = 0; i < frame.n; i++) z += p[i] * dist.pi[i];
  return labelled(
    { dominates: worst === null, zadehConsistency: z, worstViolation: worst },
    provenance('possibility', 'exact', [
      'Dominance is checked on all 2^n events, not just singletons.',
      "Zadeh's consistency degree Σ p·π is a separate, weaker summary; it can be high while dominance fails.",
    ]),
  );
}

/* ----------------------------------------- forced collapse to a probability */

/**
 * Collapse π to a single probability (pignistic / Dubois–Prade symmetric
 * transform): share each α-cut's mass equally among its members.
 *
 * Going this way **adds arbitrary commitment**. "Equally" is a choice — the
 * insufficient-reason principle — not a consequence of π. Every other
 * distribution in P(π) is equally compatible with the information.
 */
export function possibilityToProbability(dist: PossibilityDistribution): Labelled<number[]> {
  const cuts = alphaCuts(dist);
  const p = new Array<number>(dist.frame.n).fill(0);
  for (let j = 0; j < cuts.length; j++) {
    const mass = cuts[j].alpha - (j + 1 < cuts.length ? cuts[j + 1].alpha : 0);
    const share = mass / cuts[j].size;
    for (let i = 0; i < dist.frame.n; i++) if (cuts[j].mask & (1 << i)) p[i] += share;
  }
  return labelled(
    p,
    provenance(
      'possibility',
      'exact',
      [
        'Direction: possibility → probability. This ADDS commitment that π does not contain: the equal ' +
          'split inside each α-cut is an appeal to insufficient reason, not an inference.',
        'Use this only when a decision forces a single number, and report that the choice was made.',
      ],
      ['You are asserting indifference inside each α-cut, which π itself does not assert.'],
    ),
    ['The uniform split inside each α-cut is an arbitrary choice; π alone does not determine a probability.'],
  );
}

/* ------------------------------------------------ decision criteria */

export interface PossibilisticDecision {
  /** Optimistic (possibilistic maximax): max_ω min(π(ω), u(ω)). */
  optimistic: number;
  /** Pessimistic (possibilistic maximin, Whalen): min_ω max(1 − π(ω), u(ω)). */
  pessimistic: number;
}

/**
 * Qualitative possibilistic utilities. The two indices generally **disagree**
 * and there is no computation that resolves the disagreement: picking one is a
 * value judgement about attitude to ignorance, not a fact about the problem.
 */
export function possibilisticUtility(
  dist: PossibilityDistribution,
  utility: readonly number[],
): Labelled<PossibilisticDecision> {
  if (utility.length !== dist.frame.n) {
    throw new EngineError(
      `Utility vector has ${utility.length} entries but the frame has ${dist.frame.n}.`,
      'length',
    );
  }
  const v = new Validator();
  for (let i = 0; i < utility.length; i++) v.range(utility[i], `u[${i}]`, `u(${dist.frame.elements[i]})`, 0, 1);
  v.throwIfInvalid();
  let opt = 0;
  let pes = 1;
  for (let i = 0; i < dist.frame.n; i++) {
    opt = Math.max(opt, Math.min(dist.pi[i], utility[i]));
    pes = Math.min(pes, Math.max(1 - dist.pi[i], utility[i]));
  }
  return labelled(
    { optimistic: opt, pessimistic: pes },
    provenance(
      'possibility',
      'exact',
      [
        'The optimistic and pessimistic indices rank acts differently; neither is "the" answer.',
        'Both are ordinal: utilities must be on the same [0,1] plausibility scale as π.',
      ],
      ['Choosing between the optimistic and the pessimistic criterion is a value judgement.'],
    ),
    ['The optimistic and pessimistic criteria can reverse the preference order; report both.'],
  );
}
