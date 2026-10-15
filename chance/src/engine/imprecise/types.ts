/**
 * Shared types for imprecise probability: possibility theory, Dempster–Shafer
 * belief functions, probability boxes and credal sets.
 *
 * Why this module exists
 * ----------------------
 * A single probability number is a *commitment*. It says "I know the chance is
 * exactly this". When the user genuinely does not know, inventing a number is
 * precisely what this project forbids. Each formalism here answers a different
 * question about partial ignorance, and they are routinely conflated, so every
 * result carries a `Provenance` naming:
 *
 *  - which formalism produced it,
 *  - the question that formalism actually answers,
 *  - what the user commits to by choosing it.
 *
 * Every numeric interval produced here is a **bound**, never a point estimate.
 * The `Bound` type has no "best guess" field on purpose: there isn't one.
 */
import type { Exactness } from '../core/result';

/** Which theory of imprecise uncertainty produced a result. */
export type Formalism =
  /** Possibility theory (Zadeh, Dubois–Prade): maxitive, ordinal, fuzzy sets. */
  | 'possibility'
  /** Dempster–Shafer evidence theory: masses on subsets of a finite frame. */
  | 'belief'
  /** Probability boxes: a pair of bounding CDFs on the real line. */
  | 'pbox'
  /** Credal sets / lower previsions (Walley): a convex set of distributions. */
  | 'credal'
  /** Fuzzy arithmetic via alpha-cuts and the extension principle. */
  | 'fuzzy';

export const FORMALISM_QUESTION: Record<Formalism, string> = {
  possibility: 'How surprising would this be, on an ordinal scale where only the ranking of plausibilities is claimed?',
  belief: 'How much of my evidence directly supports this, and how much merely fails to rule it out?',
  pbox: 'Given what I know about the distribution, between which two CDFs must the true one lie?',
  credal: 'Over the set of distributions consistent with my assessments, what is the range of this quantity?',
  fuzzy: 'If the inputs are known only as fuzzy quantities, what is the fuzzy set of possible outputs?',
};

export const FORMALISM_COMMITMENT: Record<Formalism, string[]> = {
  possibility: [
    'Π is maxitive: Π(A∪B) = max(Π A, Π B). This is NOT a probability and must not be read as one.',
    'The numbers are ordinal. Only comparisons are meaningful; π = 0.6 is not "60%".',
    'Choosing a possibility distribution over a probability is a claim of less knowledge, not of different knowledge.',
  ],
  belief: [
    'Mass is assigned to sets, which commits you to saying "my evidence points at this set, with no opinion inside it".',
    'Bel and Pl are lower and upper bounds on a probability; the gap is ignorance, not variability.',
    "Dempster's rule assumes the sources are independent and that the frame is exhaustive.",
  ],
  pbox: [
    'The true CDF lies anywhere between the two bounds; no distribution inside the box is privileged.',
    'A p-box constrains each point of the CDF separately. It cannot express a joint constraint across several points.',
    'Arithmetic on p-boxes needs a dependence assumption. If you do not know it, the unknown-dependence bounds are the honest answer and they are wide.',
  ],
  credal: [
    'The set is convex: every mixture of admissible distributions is admissible.',
    'Lower and upper expectations are an envelope over the set, not a distribution over distributions.',
    'A credal set must avoid sure loss; an incoherent assessment is refused rather than repaired.',
  ],
  fuzzy: [
    'A membership degree is not a probability; it grades how compatible a value is with a vague description.',
    'Interval arithmetic that uses a variable more than once overestimates the range (the dependency problem).',
    'The extension principle assumes the inputs are non-interactive unless a joint possibility distribution is supplied.',
  ],
};

export interface Provenance {
  formalism: Formalism;
  exactness: Exactness;
  /** The question this formalism answers, so it is not read as answering another. */
  question: string;
  /** What the user commits to by accepting this result. */
  commitments: string[];
  /** Specific caveats for this particular computation. */
  notes: string[];
}

export function provenance(
  formalism: Formalism,
  exactness: Exactness,
  notes: string[] = [],
  extraCommitments: string[] = [],
): Provenance {
  return {
    formalism,
    exactness,
    question: FORMALISM_QUESTION[formalism],
    commitments: [...FORMALISM_COMMITMENT[formalism], ...extraCommitments],
    notes,
  };
}

/**
 * A two-sided bound. There is deliberately no point estimate: if the bounds
 * differ, no single number in between is more defensible than any other.
 */
export interface Bound {
  readonly kind: 'bound';
  lower: number;
  upper: number;
  /** upper − lower. The width IS the information: it is how much you do not know. */
  width: number;
  provenance: Provenance;
}

export function bound(lower: number, upper: number, prov: Provenance): Bound {
  return { kind: 'bound', lower, upper, width: upper - lower, provenance: prov };
}

/** A labelled result carrying provenance alongside a value of any shape. */
export interface Labelled<T> {
  value: T;
  provenance: Provenance;
  warnings: string[];
}

export function labelled<T>(value: T, prov: Provenance, warnings: string[] = []): Labelled<T> {
  return { value, provenance: prov, warnings };
}

/** Tolerance for treating a sum as equal to 1. Chosen as ~2^-40, far above */
/** double rounding error for sums of a few thousand terms, far below any */
/** normalisation error a user would consider negligible. */
export const NORM_TOL = 1e-12;
