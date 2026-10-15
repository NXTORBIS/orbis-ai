/**
 * Coherence of stated probabilities, and the known biases that break it.
 *
 * Elicited probabilities do not satisfy the probability axioms. That is not an
 * occasional slip: subadditivity over a partition, the conjunction fallacy and
 * partition dependence are among the most robust findings in the literature.
 * So the question is never "is this set coherent" but "by how much is it
 * incoherent, and where".
 *
 * THE RULE THIS FILE OBEYS
 * ------------------------
 * An incoherent set is REPORTED, naming the violation and its size. It is
 * never silently repaired. A repair is produced only when the caller passes
 * `adjust`, and then the transformation is returned in full: the adjusted
 * vector, the per-element change, and what rule produced it. Renormalising an
 * incoherent judgement without saying so converts a detected error into a
 * confident number, which is the exact failure this engine exists to avoid.
 */
import { EngineError, type Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { pearson } from '../stats/descriptive';
import {
  judgementBasis,
  JUDGEMENT_EXACTNESS,
  type JudgementBasis,
  type JudgementExactness,
} from './types';

export interface StatedProbability {
  label: string;
  probability: number;
}

export type ViolationCode =
  | 'range'
  | 'partition-sum'
  | 'conjunction'
  | 'disjunction'
  | 'frechet'
  | 'subadditivity'
  | 'monotonicity';

export interface CoherenceViolation {
  code: ViolationCode;
  /** The axiom or bound that was broken, and by how much. */
  message: string;
  /** The size of the violation, in probability. Always > 0. */
  amount: number;
  /** The labels involved, so the interface can point at them. */
  involves: string[];
}

export type AdjustmentRule = 'least-squares' | 'kl';

export interface CoherenceAdjustment {
  rule: AdjustmentRule;
  adjusted: number[];
  /** adjusted − stated, element by element. */
  delta: number[];
  maxAbsChange: number;
  totalAbsChange: number;
  /** Euclidean distance from the stated vector to the adjusted one. */
  distance: number;
  /** Elements the least-squares projection pushed to exactly 0. */
  clampedToZero: string[];
  rationale: string;
}

export interface PartitionCoherenceResult {
  stated: StatedProbability[];
  sum: number;
  /** sum − 1. Positive means the judge gave away more than all the probability. */
  excess: number;
  coherent: boolean;
  violations: CoherenceViolation[];
  /** Present ONLY when `adjust` was explicitly requested. */
  adjustment?: CoherenceAdjustment;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/** Sums within this of 1 are treated as coherent: a judge's rounding, not an error. */
export const COHERENCE_TOLERANCE = 1e-9;

/**
 * Euclidean projection of a vector onto the probability simplex.
 *
 * This is the exact minimum-adjustment coherent set under the L2 norm: the
 * closest vector that is non-negative and sums to 1. The algorithm (sort
 * descending, find the threshold τ, take max(0, s_i − τ)) is exact, not
 * iterative, so the returned vector is provably the nearest one — any other
 * non-negative vector summing to 1 is strictly further away.
 */
function projectOntoSimplex(stated: readonly number[]): { adjusted: number[]; theta: number } {
  const n = stated.length;
  const sorted = [...stated].sort((a, b) => b - a);
  let cumulative = 0;
  let theta = 0;
  let rho = 0;
  for (let i = 0; i < n; i++) {
    cumulative += sorted[i];
    const candidate = (cumulative - 1) / (i + 1);
    if (sorted[i] - candidate > 0) {
      rho = i + 1;
      theta = candidate;
    }
  }
  if (rho === 0) theta = (stableSum(stated) - 1) / n;
  return { adjusted: stated.map((v) => Math.max(0, v - theta)), theta };
}

/**
 * The I-projection: the coherent vector minimising KL(adjusted ‖ stated),
 * which is proportional renormalisation. It is a DIFFERENT answer from the
 * least-squares projection — it preserves ratios and so moves large
 * probabilities most, where least squares moves every element equally.
 */
function projectByKl(stated: readonly number[]): number[] {
  const total = stableSum(stated);
  if (!(total > 0)) {
    throw new EngineError(
      'The stated probabilities sum to zero or less, so proportional (KL) renormalisation is undefined — there is ' +
        'no mass to rescale. Use the least-squares adjustment, which is defined here, or re-elicit.',
      'degenerate',
    );
  }
  return stated.map((v) => v / total);
}

/**
 * Check a set of stated probabilities over an exhaustive, mutually exclusive
 * partition against the probability axioms.
 *
 * Pass `adjust` to also receive the minimum-adjustment coherent set. Without
 * it, nothing is renormalised and `adjustment` is absent.
 */
export function checkPartitionCoherence(
  stated: readonly StatedProbability[],
  options: { adjust?: AdjustmentRule; tolerance?: number } = {},
): PartitionCoherenceResult {
  if (stated.length < 2) {
    throw new EngineError(
      `A partition needs at least 2 categories to be checked for coherence; got ${stated.length}.`,
      'too-few',
    );
  }
  const labels = new Set<string>();
  stated.forEach((s, i) => {
    if (!Number.isFinite(s.probability)) {
      throw new EngineError(`"${s.label}" (index ${i}) has the non-finite probability ${String(s.probability)}.`, 'finite');
    }
    if (labels.has(s.label)) {
      throw new EngineError(`The label "${s.label}" appears twice; each category must be named once.`, 'duplicate');
    }
    labels.add(s.label);
  });
  const tolerance = options.tolerance ?? COHERENCE_TOLERANCE;
  if (!(tolerance >= 0)) throw new EngineError(`tolerance must be 0 or greater; got ${tolerance}.`, 'range');
  const values = stated.map((s) => s.probability);
  const sum = stableSum(values);
  const excess = sum - 1;

  const violations: CoherenceViolation[] = [];
  stated.forEach((s) => {
    if (s.probability < 0) {
      violations.push({
        code: 'range',
        message: `"${s.label}" was given the probability ${s.probability}, which is negative. A probability cannot be below 0.`,
        amount: -s.probability,
        involves: [s.label],
      });
    } else if (s.probability > 1) {
      violations.push({
        code: 'range',
        message: `"${s.label}" was given the probability ${s.probability}, which exceeds 1 by ${(s.probability - 1).toPrecision(6)}.`,
        amount: s.probability - 1,
        involves: [s.label],
      });
    }
  });
  if (Math.abs(excess) > tolerance) {
    violations.push({
      code: 'partition-sum',
      message:
        `The ${stated.length} stated probabilities over this partition sum to ${sum.toPrecision(10)}, not 1. ` +
        (excess > 0
          ? `The EXCESS is ${excess.toPrecision(10)}: the judge gave away ${(excess * 100).toPrecision(4)} percentage ` +
            'points more than exists. This is superadditivity, the usual direction when categories are judged one at a time.'
          : `The SHORTFALL is ${(-excess).toPrecision(10)}: ${((-excess) * 100).toPrecision(4)} percentage points are ` +
            'unaccounted for. Either the partition is not exhaustive or the judge has left probability on an unnamed category.'),
      amount: Math.abs(excess),
      involves: stated.map((s) => s.label),
    });
  }
  const coherent = violations.length === 0;

  let adjustment: CoherenceAdjustment | undefined;
  if (options.adjust) {
    if (coherent) {
      adjustment = {
        rule: options.adjust,
        adjusted: [...values],
        delta: values.map(() => 0),
        maxAbsChange: 0,
        totalAbsChange: 0,
        distance: 0,
        clampedToZero: [],
        rationale: 'The stated set is already coherent, so no adjustment was made. Every change below is exactly 0.',
      };
    } else {
      const adjusted =
        options.adjust === 'least-squares' ? projectOntoSimplex(values).adjusted : projectByKl(values);
      const delta = adjusted.map((v, i) => v - values[i]);
      adjustment = {
        rule: options.adjust,
        adjusted,
        delta,
        maxAbsChange: Math.max(...delta.map(Math.abs)),
        totalAbsChange: stableSum(delta.map(Math.abs)),
        distance: Math.sqrt(stableSum(delta.map((d) => d * d))),
        clampedToZero: stated.filter((_s, i) => adjusted[i] === 0 && values[i] !== 0).map((s) => s.label),
        rationale:
          options.adjust === 'least-squares'
            ? 'Euclidean projection onto the probability simplex: the nearest non-negative vector summing to 1. ' +
              'Every element is shifted by the SAME amount (then clipped at 0), so the adjustment is spread evenly ' +
              'and does not privilege the large probabilities. This is the exact minimiser, not an iterative ' +
              'approximation: no other coherent vector is closer.'
            : 'Proportional renormalisation, which is the vector minimising KL(adjusted ‖ stated) subject to summing ' +
              'to 1. It preserves the RATIOS between the stated probabilities, so it moves the large ones most. ' +
              'It is a different answer from the least-squares projection; neither is more correct, they encode ' +
              'different beliefs about where the judge’s error lies.',
      };
    }
  }

  const warnings: string[] = [];
  if (!coherent && !options.adjust) {
    warnings.push(
      `This set of judgements is INCOHERENT by ${Math.abs(excess).toPrecision(6)} and has NOT been repaired. ` +
        'Nothing downstream may treat these numbers as probabilities until the judge is re-asked or an explicit ' +
        'adjustment rule is chosen (pass `adjust`).',
    );
  }
  if (!coherent && options.adjust) {
    warnings.push(
      `The stated set was incoherent and has been adjusted on explicit request using the ${options.adjust} rule. ` +
        'The adjusted numbers are NOT what the judge said; the per-element changes are reported in `adjustment.delta` ' +
        'and must be shown wherever the adjusted numbers are shown.',
    );
  }
  if (excess > 0.02) {
    warnings.push(
      `The excess of ${excess.toPrecision(4)} is in the direction and of the magnitude typical of SUPERADDITIVITY ` +
        'from judging categories separately. Re-eliciting with the categories shown side by side, and with the ' +
        'running total visible, usually removes most of it.',
    );
  }

  return {
    stated: stated.map((s) => ({ ...s })),
    sum,
    excess,
    coherent,
    violations,
    adjustment,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Coherence check of stated probabilities over a partition' + (options.adjust ? ` with an explicitly requested ${options.adjust} adjustment` : ''),
      `${stated.length} probabilities asserted by a judge over the partition {${stated.map((s) => s.label).join(', ')}}`,
      [
        'Stated probabilities over a partition routinely sum to more than 1. The excess is a measurable property of the judge, not noise.',
        'A coherent set is not an accurate set. Coherence is the minimum requirement, not evidence of calibration.',
        ...(options.adjust ? ['The adjusted numbers are the analyst’s construction, not the judge’s statement.'] : []),
      ],
    ),
    explanation: {
      method: 'Probability-axiom check over a partition' + (options.adjust ? `, plus the minimum-adjustment coherent set (${options.adjust})` : ''),
      formula: 'Coherence requires p_i ≥ 0 for all i and Σ p_i = 1',
      steps: [
        { label: 'Stated', value: stated.map((s) => `${s.label} = ${s.probability}`).join('; ') },
        { label: 'Sum', value: sum.toPrecision(12) },
        { label: 'Excess over 1', value: excess.toPrecision(12) },
        { label: 'Coherent', value: coherent ? 'yes' : `no — ${violations.length} violation(s)` },
        ...violations.map((v) => ({ label: `Violation (${v.code})`, value: v.message })),
        ...(adjustment
          ? [
              { label: `Adjusted (${adjustment.rule})`, value: stated.map((s, i) => `${s.label} = ${adjustment.adjusted[i].toPrecision(8)}`).join('; ') },
              { label: 'Change applied', value: stated.map((s, i) => `${s.label} ${adjustment.delta[i] >= 0 ? '+' : ''}${adjustment.delta[i].toPrecision(6)}`).join('; ') },
              { label: 'Euclidean distance moved', value: adjustment.distance.toPrecision(8) },
            ]
          : [{ label: 'Adjustment', value: 'none — not requested, so nothing was renormalised' }]),
      ],
      assumptions: [
        'The categories are mutually exclusive and exhaustive. If they are not, a sum different from 1 is not a violation but a mis-specified partition.',
      ],
      limitations: [
        'Additivity over one partition is a weak test. The same judge can be additive here and badly partition-dependent under a different split of the same uncertainty.',
        'The two adjustment rules give different answers. Choosing between them is a judgement about where the error lies and cannot be made by the arithmetic.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Conjunction and disjunction                                        */
/* ------------------------------------------------------------------ */

export interface ConjunctionAssessment {
  labelA: string;
  labelB: string;
  probabilityA: number;
  probabilityB: number;
  probabilityAandB: number;
  /** Optional: the judge's stated P(A or B). */
  probabilityAorB?: number;
}

export interface ConjunctionCheckResult {
  assessment: ConjunctionAssessment;
  violations: CoherenceViolation[];
  coherent: boolean;
  /** The Fréchet bounds for P(A and B) implied by P(A) and P(B) alone — NO independence assumed. */
  conjunctionBound: { lower: number; upper: number; width: number };
  /** The Fréchet bounds for P(A or B). */
  disjunctionBound: { lower: number; upper: number; width: number };
  /** What P(A and B) would be if A and B were independent. Reported for contrast, NOT assumed. */
  productIfIndependent: number;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Conjunction and disjunction coherence, with Fréchet bounds rather than an
 * independence assumption.
 *
 * P(A and B) is pinned down by P(A) and P(B) only to the interval
 * [max(0, P(A)+P(B)−1), min(P(A), P(B))]. The product P(A)P(B) is one point
 * inside that interval and is correct only under independence, which nobody
 * elicited. It is reported for contrast and never used as the answer.
 */
export function checkConjunction(assessment: ConjunctionAssessment): ConjunctionCheckResult {
  const { labelA, labelB, probabilityA: pA, probabilityB: pB, probabilityAandB: pAB, probabilityAorB: pAorB } = assessment;
  const named: [string, number][] = [
    [`P(${labelA})`, pA],
    [`P(${labelB})`, pB],
    [`P(${labelA} and ${labelB})`, pAB],
  ];
  if (pAorB !== undefined) named.push([`P(${labelA} or ${labelB})`, pAorB]);
  for (const [name, v] of named) {
    if (!Number.isFinite(v)) throw new EngineError(`${name} = ${String(v)} is not a finite number.`, 'finite');
    if (v < 0 || v > 1) {
      throw new EngineError(`${name} = ${v} is outside [0, 1] and is not a probability at all.`, 'range');
    }
  }
  if (labelA === labelB) {
    throw new EngineError(`Both events are labelled "${labelA}"; a conjunction needs two distinct events.`, 'duplicate');
  }

  const violations: CoherenceViolation[] = [];
  if (pAB > pA) {
    violations.push({
      code: 'conjunction',
      message:
        `CONJUNCTION FALLACY: the judge stated P(${labelA} and ${labelB}) = ${pAB}, which is greater than ` +
        `P(${labelA}) = ${pA} by ${(pAB - pA).toPrecision(6)}. A conjunction cannot be more likely than either of ` +
        'its parts — every case in which both happen is a case in which the first happens. This is the ' +
        'representativeness effect: the conjunction told a more plausible story.',
      amount: pAB - pA,
      involves: [labelA, `${labelA} and ${labelB}`],
    });
  }
  if (pAB > pB) {
    violations.push({
      code: 'conjunction',
      message:
        `CONJUNCTION FALLACY: the judge stated P(${labelA} and ${labelB}) = ${pAB}, which is greater than ` +
        `P(${labelB}) = ${pB} by ${(pAB - pB).toPrecision(6)}. A conjunction cannot be more likely than either of its parts.`,
      amount: pAB - pB,
      involves: [labelB, `${labelA} and ${labelB}`],
    });
  }
  const conjLower = Math.max(0, pA + pB - 1);
  const conjUpper = Math.min(pA, pB);
  if (pAB < conjLower - COHERENCE_TOLERANCE) {
    violations.push({
      code: 'frechet',
      message:
        `P(${labelA} and ${labelB}) = ${pAB} is below the Fréchet lower bound ${conjLower.toPrecision(6)} implied by ` +
        `P(${labelA}) = ${pA} and P(${labelB}) = ${pB}. Even if the two events overlapped as little as logically ` +
        `possible, they would both hold with probability at least ${conjLower.toPrecision(6)}.`,
      amount: conjLower - pAB,
      involves: [labelA, labelB, `${labelA} and ${labelB}`],
    });
  }
  const disjLower = Math.max(pA, pB);
  const disjUpper = Math.min(1, pA + pB);
  if (pAorB !== undefined) {
    if (pAorB < disjLower - COHERENCE_TOLERANCE) {
      violations.push({
        code: 'disjunction',
        message:
          `DISJUNCTION VIOLATION: the judge stated P(${labelA} or ${labelB}) = ${pAorB}, below ` +
          `max(P(${labelA}), P(${labelB})) = ${disjLower.toPrecision(6)} by ${(disjLower - pAorB).toPrecision(6)}. ` +
          'A disjunction cannot be less likely than either of its parts.',
        amount: disjLower - pAorB,
        involves: [labelA, labelB, `${labelA} or ${labelB}`],
      });
    }
    if (pAorB > disjUpper + COHERENCE_TOLERANCE) {
      violations.push({
        code: 'disjunction',
        message:
          `P(${labelA} or ${labelB}) = ${pAorB} exceeds min(1, P(${labelA}) + P(${labelB})) = ` +
          `${disjUpper.toPrecision(6)} by ${(pAorB - disjUpper).toPrecision(6)}, which no pair of events can do.`,
        amount: pAorB - disjUpper,
        involves: [labelA, labelB, `${labelA} or ${labelB}`],
      });
    }
    // Inclusion–exclusion must hold exactly: P(A∪B) = P(A) + P(B) − P(A∩B).
    const implied = pA + pB - pAB;
    if (Math.abs(implied - pAorB) > 1e-9) {
      violations.push({
        code: 'monotonicity',
        message:
          `Inclusion–exclusion fails: P(${labelA}) + P(${labelB}) − P(${labelA} and ${labelB}) = ` +
          `${implied.toPrecision(8)}, but the judge stated P(${labelA} or ${labelB}) = ${pAorB}. The discrepancy is ` +
          `${Math.abs(implied - pAorB).toPrecision(8)}; the four stated numbers cannot all be right.`,
        amount: Math.abs(implied - pAorB),
        involves: [labelA, labelB, `${labelA} and ${labelB}`, `${labelA} or ${labelB}`],
      });
    }
  }

  const warnings: string[] = [];
  if (violations.length) {
    warnings.push(
      `${violations.length} coherence violation(s) found in this assessment. The numbers are reported as stated and ` +
        'have NOT been adjusted. Re-elicit; a conjunction fallacy usually disappears when the judge is shown ' +
        'P(A) and P(A and B) side by side.',
    );
  }
  warnings.push(
    `P(${labelA} and ${labelB}) is bounded by [${conjLower.toPrecision(6)}, ${conjUpper.toPrecision(6)}] given only ` +
      `P(${labelA}) and P(${labelB}); the bound is ${(conjUpper - conjLower).toPrecision(6)} wide. The product ` +
      `${(pA * pB).toPrecision(6)} sits inside it but is the answer ONLY under independence, which was not elicited.`,
  );

  return {
    assessment: { ...assessment },
    violations,
    coherent: violations.length === 0,
    conjunctionBound: { lower: conjLower, upper: conjUpper, width: conjUpper - conjLower },
    disjunctionBound: { lower: disjLower, upper: disjUpper, width: disjUpper - disjLower },
    productIfIndependent: pA * pB,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Conjunction and disjunction coherence check with Fréchet bounds',
      `Probabilities asserted by a judge for "${labelA}", "${labelB}" and their conjunction`,
      [
        'The conjunction fallacy is one of the most reproducible findings in judgement research. Its presence is expected, not surprising.',
        'No independence is assumed anywhere here. Where the relationship between the events is unknown, the answer is a bound.',
      ],
    ),
    explanation: {
      method: 'Conjunction / disjunction coherence with Fréchet–Hoeffding bounds',
      formula: 'max(0, P(A)+P(B)−1) ≤ P(A∩B) ≤ min(P(A), P(B));  max(P(A),P(B)) ≤ P(A∪B) ≤ min(1, P(A)+P(B))',
      steps: [
        { label: `P(${labelA})`, value: pA.toPrecision(8) },
        { label: `P(${labelB})`, value: pB.toPrecision(8) },
        { label: `P(${labelA} and ${labelB}) as stated`, value: pAB.toPrecision(8) },
        { label: 'Fréchet bound on the conjunction', value: `[${conjLower.toPrecision(8)}, ${conjUpper.toPrecision(8)}]` },
        { label: 'Value under independence (NOT assumed)', value: (pA * pB).toPrecision(8) },
        ...(pAorB !== undefined ? [{ label: `P(${labelA} or ${labelB}) as stated`, value: pAorB.toPrecision(8) }] : []),
        { label: 'Violations', value: violations.length ? violations.map((v) => v.code).join(', ') : 'none' },
      ],
      assumptions: ['The judge meant the conjunction as the joint occurrence of both events, not as a sequence or a causal claim.'],
      limitations: [
        'Coherence of three numbers says nothing about whether any of them is right.',
        'The Fréchet bound is usually wide. Narrowing it requires eliciting the dependence, which is harder than eliciting either marginal.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Subadditivity over a partition of one event                        */
/* ------------------------------------------------------------------ */

export interface SubadditivityResult {
  /** The event elicited as a whole. */
  wholeLabel: string;
  directProbability: number;
  parts: StatedProbability[];
  partsSum: number;
  /** partsSum − directProbability. Positive is the usual direction: unpacking inflates. */
  unpackingExcess: number;
  subadditive: boolean;
  violations: CoherenceViolation[];
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Compare an event judged as a whole against the same event judged as the sum
 * of its parts.
 *
 * Unpacking an event into components reliably raises the total: the parts sum
 * to more than the whole. The difference is the measurable size of the effect
 * for this judge and this event, and it is reported rather than reconciled.
 */
export function checkSubadditivity(
  wholeLabel: string,
  directProbability: number,
  parts: readonly StatedProbability[],
  options: { tolerance?: number } = {},
): SubadditivityResult {
  if (parts.length < 2) {
    throw new EngineError(
      `Subadditivity needs the event unpacked into at least 2 parts; got ${parts.length}. One part is the same question.`,
      'too-few',
    );
  }
  if (!Number.isFinite(directProbability) || directProbability < 0 || directProbability > 1) {
    throw new EngineError(
      `The direct probability for "${wholeLabel}" is ${String(directProbability)}, which is not a probability in [0, 1].`,
      'range',
    );
  }
  parts.forEach((p) => {
    if (!Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) {
      throw new EngineError(`Part "${p.label}" has the probability ${String(p.probability)}, which is not in [0, 1].`, 'range');
    }
  });
  const tolerance = options.tolerance ?? 1e-9;
  const partsSum = stableSum(parts.map((p) => p.probability));
  const unpackingExcess = partsSum - directProbability;
  const violations: CoherenceViolation[] = [];
  if (Math.abs(unpackingExcess) > tolerance) {
    violations.push({
      code: 'subadditivity',
      message:
        `"${wholeLabel}" was judged ${directProbability} as a whole, but its ${parts.length} parts were judged ` +
        `${parts.map((p) => p.probability).join(' + ')} = ${partsSum.toPrecision(10)}. ` +
        (unpackingExcess > 0
          ? `Unpacking INFLATED the event by ${unpackingExcess.toPrecision(10)} (${((unpackingExcess / Math.max(directProbability, 1e-12)) * 100).toPrecision(4)}% of the direct judgement). ` +
            'This is support-theory subadditivity: each named part brings its own reasons to mind.'
          : `The parts total ${(-unpackingExcess).toPrecision(10)} LESS than the whole, which is the unusual ` +
            'direction and usually means the parts are not exhaustive of the event.'),
      amount: Math.abs(unpackingExcess),
      involves: [wholeLabel, ...parts.map((p) => p.label)],
    });
  }
  const warnings: string[] = [];
  if (unpackingExcess > tolerance) {
    warnings.push(
      `Subadditivity of ${unpackingExcess.toPrecision(6)} detected. Neither number is the right one: the direct ` +
        'judgement is typically too low and the unpacked sum typically too high. Nothing has been reconciled here. ' +
        'If a single number is needed, elicit the event a third way and report the range.',
    );
  }
  return {
    wholeLabel,
    directProbability,
    parts: parts.map((p) => ({ ...p })),
    partsSum,
    unpackingExcess,
    subadditive: unpackingExcess > tolerance,
    violations,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Subadditivity check: one event judged directly and as a sum of parts',
      `A judge's direct probability for "${wholeLabel}" compared with their probabilities for its ${parts.length} parts`,
      [
        'Unpacking an event into parts reliably raises its total probability. The direction of the effect is known in advance.',
        'The two numbers cannot both be right, and the arithmetic cannot say which is closer to the truth.',
      ],
    ),
    explanation: {
      method: 'Subadditivity (support-theory unpacking) check',
      formula: 'Coherence requires Σ P(part_i) = P(whole) when the parts partition the whole',
      steps: [
        { label: `P(${wholeLabel}) judged directly`, value: directProbability.toPrecision(8) },
        { label: 'Parts', value: parts.map((p) => `${p.label} = ${p.probability}`).join('; ') },
        { label: 'Sum of parts', value: partsSum.toPrecision(10) },
        { label: 'Unpacking excess', value: unpackingExcess.toPrecision(10) },
      ],
      assumptions: ['The parts are mutually exclusive and together exhaust the whole event, as presented to the judge.'],
      limitations: [
        'If the parts are not genuinely exhaustive, the difference is a specification error rather than a bias.',
        'The size of the effect depends on how the parts were named, so it is not a stable property of the judge alone.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Partition dependence                                               */
/* ------------------------------------------------------------------ */

export interface PartitionAssessment {
  partitionName: string;
  categories: readonly StatedProbability[];
  /** The labels, within this partition, that make up the target event. */
  targetCategories: readonly string[];
}

export interface PartitionDependenceResult {
  perPartition: {
    partitionName: string;
    categoryCount: number;
    targetCategoryCount: number;
    targetProbability: number;
    sum: number;
  }[];
  /** Highest minus lowest probability given to the same event. */
  spread: number;
  /**
   * Correlation between how many categories the target was split into and the
   * probability it received. Positive is the documented direction.
   */
  splitCorrelation: number;
  detected: boolean;
  threshold: number;
  direction: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Detect partition dependence: the same event elicited under different splits
 * of the same uncertainty attracts different total probability, and more
 * categories attract more.
 *
 * This is the bias that makes a chip-allocation or a category-based elicitation
 * depend on the analyst's bin choice, so it must be measured whenever the same
 * uncertainty is available under two partitions.
 */
export function detectPartitionDependence(
  assessments: readonly PartitionAssessment[],
  options: { threshold?: number } = {},
): PartitionDependenceResult {
  if (assessments.length < 2) {
    throw new EngineError(
      `Partition dependence can only be detected by comparing at least 2 partitions of the same uncertainty; got ` +
        `${assessments.length}.`,
      'too-few',
    );
  }
  const threshold = options.threshold ?? 0.05;
  if (!(threshold > 0 && threshold < 1)) throw new EngineError(`threshold must lie in (0, 1); got ${threshold}.`, 'range');
  const perPartition = assessments.map((a) => {
    if (a.categories.length < 2) {
      throw new EngineError(
        `Partition "${a.partitionName}" has ${a.categories.length} categories; a partition needs at least 2.`,
        'too-few',
      );
    }
    if (a.targetCategories.length === 0) {
      throw new EngineError(
        `Partition "${a.partitionName}" names no target categories, so there is no common event to compare across partitions.`,
        'empty',
      );
    }
    const byLabel = new Map(a.categories.map((c) => [c.label, c.probability]));
    const missing = a.targetCategories.filter((t) => !byLabel.has(t));
    if (missing.length) {
      throw new EngineError(
        `Partition "${a.partitionName}" names the target categories [${missing.join(', ')}], which are not among its ` +
          `categories [${a.categories.map((c) => c.label).join(', ')}].`,
        'unknown',
      );
    }
    a.categories.forEach((c) => {
      if (!Number.isFinite(c.probability) || c.probability < 0 || c.probability > 1) {
        throw new EngineError(
          `Category "${c.label}" in partition "${a.partitionName}" has the probability ${String(c.probability)}, which is not in [0, 1].`,
          'range',
        );
      }
    });
    return {
      partitionName: a.partitionName,
      categoryCount: a.categories.length,
      targetCategoryCount: a.targetCategories.length,
      targetProbability: stableSum(a.targetCategories.map((t) => byLabel.get(t) as number)),
      sum: stableSum(a.categories.map((c) => c.probability)),
    };
  });
  const probs = perPartition.map((p) => p.targetProbability);
  const spread = Math.max(...probs) - Math.min(...probs);
  const counts = perPartition.map((p) => p.targetCategoryCount);
  const countsVary = new Set(counts).size > 1;
  // pearson needs variation in both series and at least two points.
  const splitCorrelation = countsVary && assessments.length >= 2 && new Set(probs).size > 1 ? pearson(counts, probs) : NaN;
  const detected = spread > threshold;
  const direction = !countsVary
    ? 'Every partition split the target event into the same number of categories, so the DIRECTION of the effect cannot be read off here — only its size.'
    : Number.isFinite(splitCorrelation) && splitCorrelation > 0
      ? 'The target event received MORE probability when it was split into more categories, which is the documented direction of partition dependence.'
      : Number.isFinite(splitCorrelation) && splitCorrelation < 0
        ? 'The target event received LESS probability when split into more categories, the opposite of the usual direction. Check that the partitions really describe the same event.'
        : 'The probabilities did not vary, so there is no direction to report.';
  const warnings: string[] = [];
  const incoherent = perPartition.filter((p) => Math.abs(p.sum - 1) > 1e-6);
  if (incoherent.length) {
    warnings.push(
      `These partitions do not sum to 1: ${incoherent.map((p) => `${p.partitionName} sums to ${p.sum.toPrecision(6)}`).join('; ')}. ` +
        'The comparison below therefore mixes partition dependence with plain non-additivity; check each partition ' +
        'with checkPartitionCoherence first.',
    );
  }
  if (detected) {
    warnings.push(
      `PARTITION DEPENDENCE: the same event was given probabilities spanning ${spread.toPrecision(6)} depending only ` +
        'on how the surrounding uncertainty was carved up. The analyst’s choice of categories is contributing ' +
        `${spread.toPrecision(6)} to the answer. No single one of these numbers is the judge’s probability.`,
    );
  }
  if (assessments.length < 3) {
    warnings.push(
      `Only ${assessments.length} partitions were compared, so the correlation with the category count rests on ` +
        `${assessments.length} points and carries essentially no evidential weight. The SPREAD is the usable number here.`,
    );
  }
  return {
    perPartition,
    spread,
    splitCorrelation,
    detected,
    threshold,
    direction,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Partition-dependence detection across alternative splits of one uncertainty',
      `One event's probability as stated by a judge under ${assessments.length} different partitions: ${assessments
        .map((a) => a.partitionName)
        .join(', ')}`,
      [
        'Partition dependence means the analyst, not the judge, supplied part of the answer by choosing the categories.',
        'The effect grows with the number of categories the target is split into, so a fine-grained partition inflates its own region.',
      ],
    ),
    explanation: {
      method: 'Partition dependence: one event, several partitions',
      steps: [
        ...perPartition.map((p) => ({
          label: p.partitionName,
          value: `${p.categoryCount} categories (${p.targetCategoryCount} in the target) → P(target) = ${p.targetProbability.toPrecision(8)}`,
        })),
        { label: 'Spread across partitions', value: spread.toPrecision(8) },
        { label: 'Correlation with target category count', value: Number.isFinite(splitCorrelation) ? splitCorrelation.toPrecision(6) : 'not computable' },
        { label: 'Detected at threshold', value: `${detected ? 'yes' : 'no'} (threshold ${threshold})` },
      ],
      assumptions: ['The target event is genuinely the same event under each partition.'],
      limitations: [
        'A handful of partitions cannot estimate the size of the effect, only demonstrate it.',
        'The effect is confounded with the order in which the partitions were presented to the judge.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Anchoring                                                          */
/* ------------------------------------------------------------------ */

export interface AnchoredJudgement {
  label: string;
  /** A number the judge saw before answering (a seed, a previous estimate, a "is it more than X?" question). */
  anchor: number;
  /** What they then answered. */
  judgement: number;
}

export interface AnchoringResult {
  n: number;
  /** Least-squares slope of judgement on anchor. 0 means no anchoring; 1 means the anchor was the answer. */
  anchorSlope: number;
  /** Correlation between the anchor shown and the answer given. */
  anchorCorrelation: number;
  /** Correlation between each answer and the PREVIOUS answer, i.e. self-anchoring down a sequence. */
  serialCorrelation: number;
  detected: boolean;
  threshold: number;
  interpretation: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Detect anchoring across a sequence of related judgements.
 *
 * Two things are measured: the pull of an externally supplied anchor (the
 * slope of the answer on the anchor) and the pull of the judge's own previous
 * answer (serial correlation). Both are reported because they are different
 * failures: the first is the analyst's doing, the second is the protocol's.
 */
export function detectAnchoring(
  sequence: readonly AnchoredJudgement[],
  options: { threshold?: number } = {},
): AnchoringResult {
  if (sequence.length < 3) {
    throw new EngineError(
      `Anchoring detection needs at least 3 judgements to form a slope that is not simply the line through two ` +
        `points; got ${sequence.length}.`,
      'too-few',
    );
  }
  sequence.forEach((s, i) => {
    if (!Number.isFinite(s.anchor)) throw new EngineError(`Judgement ${i} ("${s.label}") has the non-finite anchor ${String(s.anchor)}.`, 'finite');
    if (!Number.isFinite(s.judgement)) throw new EngineError(`Judgement ${i} ("${s.label}") is the non-finite value ${String(s.judgement)}.`, 'finite');
  });
  const threshold = options.threshold ?? 0.2;
  if (!(threshold > 0)) throw new EngineError(`threshold must be greater than 0; got ${threshold}.`, 'range');
  const anchors = sequence.map((s) => s.anchor);
  const judgements = sequence.map((s) => s.judgement);
  if (new Set(anchors).size === 1) {
    throw new EngineError(
      `Every judgement was shown the same anchor (${anchors[0]}), so the effect of the anchor cannot be separated ` +
        'from the judge’s own opinion. Anchoring is detected by VARYING the anchor across judgements.',
      'no-variation',
    );
  }
  const n = sequence.length;
  const ma = stableSum(anchors) / n;
  const mj = stableSum(judgements) / n;
  const sxx = stableSum(anchors.map((a) => (a - ma) ** 2));
  const sxy = stableSum(anchors.map((a, i) => (a - ma) * (judgements[i] - mj)));
  const anchorSlope = sxx > 0 ? sxy / sxx : NaN;
  const anchorCorrelation = new Set(judgements).size > 1 ? pearson(anchors, judgements) : 0;
  const serialCorrelation =
    n >= 4 && new Set(judgements.slice(0, -1)).size > 1 && new Set(judgements.slice(1)).size > 1
      ? pearson(judgements.slice(0, -1), judgements.slice(1))
      : NaN;
  const detected = Number.isFinite(anchorSlope) && Math.abs(anchorSlope) > threshold;
  const interpretation = !Number.isFinite(anchorSlope)
    ? 'The anchors did not vary enough to estimate a slope.'
    : `A slope of ${anchorSlope.toPrecision(4)} means that moving the anchor by 1 moved the judge's answer by ` +
      `${anchorSlope.toPrecision(4)}. A slope of 0 would mean the anchor was ignored; a slope of 1 would mean the ` +
      'judge simply repeated the anchor. ' +
      (detected
        ? 'This is ANCHORING: a measurable part of these judgements came from the numbers the judge was shown, not ' +
          'from the quantity. Re-elicit without the anchors, or with anchors deliberately varied in the opposite direction.'
        : `This is below the detection threshold of ${threshold}, which is not evidence of absence — see the sample-size warning.`);
  const warnings: string[] = [];
  warnings.push(
    `This slope rests on ${n} judgements. With fewer than about 20, the slope is dominated by noise and a null ` +
      'result means nothing; a clearly non-zero slope with few points is still informative, a near-zero one is not.',
  );
  if (detected) {
    warnings.push(
      `ANCHORING DETECTED: slope ${anchorSlope.toPrecision(4)} (threshold ${threshold}), correlation ` +
        `${anchorCorrelation.toPrecision(4)}. These judgements are partly a function of the anchors the analyst supplied.`,
    );
  }
  if (Number.isFinite(serialCorrelation) && Math.abs(serialCorrelation) > 0.7) {
    warnings.push(
      `The answers are serially correlated at ${serialCorrelation.toPrecision(4)}: each judgement is close to the ` +
        'previous one. The judge is anchoring on their own last answer, so these are not independent judgements and ' +
        'must not be counted as such when scoring the record.',
    );
  }
  return {
    n,
    anchorSlope,
    anchorCorrelation,
    serialCorrelation,
    detected,
    threshold,
    interpretation,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Anchoring detection by regression of the judgement on the anchor shown',
      `${n} judgements made by a judge after being shown a varying anchor`,
      [
        'Anchoring is produced by the analyst. An anchor shown in the question is part of the measuring instrument.',
        'A slope near 0 from a short sequence is not evidence that the judge was unaffected.',
      ],
    ),
    explanation: {
      method: 'Anchoring: least-squares slope of judgement on anchor, plus serial correlation',
      formula: 'slope = Σ(a_i − ā)(j_i − j̄) / Σ(a_i − ā)²',
      steps: [
        { label: 'Judgements', value: String(n) },
        { label: 'Slope of judgement on anchor', value: Number.isFinite(anchorSlope) ? anchorSlope.toPrecision(8) : 'not computable' },
        { label: 'Correlation with anchor', value: anchorCorrelation.toPrecision(6) },
        { label: 'Serial correlation of consecutive answers', value: Number.isFinite(serialCorrelation) ? serialCorrelation.toPrecision(6) : 'not computable (needs 4+ varying judgements)' },
        { label: 'Detected at threshold', value: `${detected ? 'yes' : 'no'} (threshold ${threshold})` },
      ],
      assumptions: [
        'The judgements concern comparable quantities, so that a single slope is meaningful.',
        'The anchors were shown BEFORE the answers. A slope computed the other way round measures nothing.',
      ],
      limitations: [
        'A real relationship between the anchor and the quantity would also produce a slope. The anchors must be uninformative by construction for this to isolate anchoring.',
        'The slope is a within-judge summary and does not transfer to another judge.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Scale and format effects                                          */
/* ------------------------------------------------------------------ */

export type ProbabilityFormat = 'percentage' | 'natural-frequency' | 'odds' | 'verbal';

export const FORMAT_NOTES: Readonly<Record<ProbabilityFormat, { description: string; knownEffect: string }>> = {
  percentage: {
    description: 'A number out of 100, e.g. "there is a 30% chance".',
    knownEffect:
      'The default, and the worst for small probabilities: judges cannot distinguish 0.1% from 0.01% on a ' +
      'percentage scale and round both to "about 0". Percentages also invite round numbers, which cluster the ' +
      'answers on multiples of 5 and 10.',
  },
  'natural-frequency': {
    description: 'A count out of a reference class, e.g. "3 in 1000".',
    knownEffect:
      'REDUCES ERROR, reliably. Frequency framings improve Bayesian updating and make small probabilities ' +
      'expressible; they are the recommended format for anything below about 5%. The reference class must be ' +
      'stated explicitly, because an unstated one is chosen by the judge.',
  },
  odds: {
    description: 'A ratio, e.g. "3 to 1 against".',
    knownEffect:
      'Familiar to judges used to betting and good for extreme probabilities, where the odds scale expands what ' +
      'the percentage scale compresses. Poorly understood by everyone else, and routinely confused with ' +
      'probabilities (reading "3 to 1" as 0.3).',
  },
  verbal: {
    description: 'Words, e.g. "likely", "a real possibility".',
    knownEffect:
      'The widest spread of any format: a single verbal term maps to probabilities spanning 0.3 or more across ' +
      'readers, and the same reader maps it differently depending on the context and the stakes. Never use a ' +
      'verbal term as a number without an agreed numeric key.',
  },
};

export interface FormatComparisonResult {
  entries: { format: ProbabilityFormat; probability: number; note: string }[];
  spread: number;
  /** Ratio of the largest to the smallest stated probability. */
  ratio: number;
  detected: boolean;
  threshold: number;
  recommendedFormat: ProbabilityFormat;
  recommendation: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Compare the same probability as stated in different formats.
 *
 * The formats are mathematically interchangeable and empirically are not. The
 * spread is the size of the format effect for this judge and this event, and
 * the frequency format is recommended because frequency framings reduce error
 * — a documented finding, not a stylistic preference.
 */
export function compareProbabilityFormats(
  entries: readonly { format: ProbabilityFormat; probability: number }[],
  options: { threshold?: number } = {},
): FormatComparisonResult {
  if (entries.length < 2) {
    throw new EngineError(
      `Comparing formats needs at least two formats of the same judgement; got ${entries.length}.`,
      'too-few',
    );
  }
  const seen = new Set<ProbabilityFormat>();
  entries.forEach((e) => {
    if (!Number.isFinite(e.probability) || e.probability < 0 || e.probability > 1) {
      throw new EngineError(
        `The ${e.format} entry has the value ${String(e.probability)}, which is not a probability in [0, 1]. ` +
          'Convert odds and frequencies to a probability before comparing them.',
        'range',
      );
    }
    if (seen.has(e.format)) throw new EngineError(`The format "${e.format}" appears twice.`, 'duplicate');
    seen.add(e.format);
  });
  const threshold = options.threshold ?? 0.05;
  if (!(threshold > 0 && threshold < 1)) throw new EngineError(`threshold must lie in (0, 1); got ${threshold}.`, 'range');
  const ps = entries.map((e) => e.probability);
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  const spread = hi - lo;
  const detected = spread > threshold;
  const hasFrequency = entries.some((e) => e.format === 'natural-frequency');
  const smallProbability = hi < 0.05;
  const recommendedFormat: ProbabilityFormat = smallProbability || hasFrequency ? 'natural-frequency' : 'natural-frequency';
  const warnings: string[] = [];
  if (detected) {
    warnings.push(
      `FORMAT EFFECT: the same judgement spans ${spread.toPrecision(6)} in probability (from ${lo.toPrecision(6)} to ` +
        `${hi.toPrecision(6)}) depending only on how it was asked. These are not repeated measurements of one ` +
        'number and must not be averaged into one.',
    );
  }
  if (entries.some((e) => e.format === 'verbal')) {
    warnings.push(
      'A verbal entry is included. Verbal probability terms have no stable numeric meaning across people or ' +
        'contexts; whatever number was attached to it here was supplied by whoever did the translation, not by the judge.',
    );
  }
  if (smallProbability && !hasFrequency) {
    warnings.push(
      `Every stated value is below 0.05, where percentage and verbal formats are least reliable. Re-elicit as a ` +
        'natural frequency ("how many times in 10,000?"), which is the format documented to reduce error in this range.',
    );
  }
  return {
    entries: entries.map((e) => ({ format: e.format, probability: e.probability, note: FORMAT_NOTES[e.format].knownEffect })),
    spread,
    ratio: lo > 0 ? hi / lo : Infinity,
    detected,
    threshold,
    recommendedFormat,
    recommendation:
      'Elicit as a natural frequency with an explicit reference class ("how many times in 1000?"). Frequency ' +
      'framings reduce error relative to percentages, especially below 5%, and they make the reference class ' +
      'visible so it cannot be chosen silently by the judge.',
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      `Comparison of the same probability judgement across ${entries.length} response formats`,
      `One event's probability as stated by a judge in the formats: ${entries.map((e) => e.format).join(', ')}`,
      [
        'The response format is part of the measuring instrument. Changing it changes the measurement.',
        'Frequency framings reduce error; percentage and verbal framings increase it, most sharply for small probabilities.',
      ],
    ),
    explanation: {
      method: 'Scale and format effects on a stated probability',
      steps: [
        ...entries.map((e) => ({ label: e.format, value: e.probability.toPrecision(8) })),
        { label: 'Spread', value: spread.toPrecision(8) },
        { label: 'Ratio (largest / smallest)', value: lo > 0 ? (hi / lo).toPrecision(6) : '∞' },
        { label: 'Format effect detected', value: `${detected ? 'yes' : 'no'} (threshold ${threshold})` },
      ],
      assumptions: ['Each format was used for the same event, and any conversion into a probability was faithful.'],
      limitations: [
        'Order effects are not separated: a judge asked in two formats in sequence is anchored by the first answer.',
        'There is no "true" format. The spread bounds the effect; it does not identify the right number.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}
