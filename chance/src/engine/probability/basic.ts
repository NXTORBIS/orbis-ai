/**
 * Basic probability: conversions, complements, unions, intersections,
 * conditional and total probability, Bayes' theorem, odds and relative
 * frequency.
 *
 * Where the inputs are exactly representable as rationals, results are
 * computed exactly and reported as both a fraction and a decimal. The
 * explanation returned with each result is derived from the actual numbers
 * used, never from a template filled with invented values.
 */
import { formatOneIn, formatPercent } from '../core/numeric';
import { EngineError, type Explanation, type Issue, Validator } from '../core/result';
import { Rational } from '../core/rational';

export interface ProbabilityValue {
  /** Decimal probability in [0, 1]. */
  p: number;
  /** Exact fraction when the computation stayed exact. */
  fraction: string | null;
  percent: string;
  oneIn: string | null;
}

export function probabilityValue(p: number, exact?: Rational | null): ProbabilityValue {
  return {
    p,
    fraction: exact && exact.isDisplayable() ? exact.toFractionString() : null,
    percent: formatPercent(p),
    oneIn: formatOneIn(p),
  };
}

/** Parse user text into a probability, accepting decimals, percentages and fractions. */
export function parseProbability(text: string): { value: number; exact: Rational } {
  const r = Rational.parse(text);
  if (!r) throw new EngineError(`"${text}" is not a number, percentage or fraction.`, 'parse');
  const v = r.toNumber();
  if (v < 0 || v > 1) {
    throw new EngineError(
      `A probability must be between 0 and 1 (or 0% and 100%); "${text}" gives ${v}.`,
      'range',
    );
  }
  return { value: v, exact: r };
}

export interface SingleEventResult {
  probability: ProbabilityValue;
  complement: ProbabilityValue;
  oddsFor: string;
  oddsAgainst: string;
  explanation: Explanation;
}

/** Complement, odds and alternative representations of a single probability. */
export function describeProbability(input: { p: number; exact?: Rational | null }): SingleEventResult {
  const v = new Validator();
  v.probability(input.p, 'p', 'Probability');
  v.throwIfInvalid();
  const exact = input.exact ?? safeExact(input.p);
  const compExact = exact ? Rational.ONE.sub(exact) : null;
  const comp = 1 - input.p;
  return {
    probability: probabilityValue(input.p, exact),
    complement: probabilityValue(comp, compExact),
    oddsFor: formatOdds(input.p),
    oddsAgainst: formatOdds(comp),
    explanation: {
      method: 'Complement rule and probability representations',
      formula: 'P(not A) = 1 − P(A)',
      steps: [
        { label: 'Given', expression: 'P(A)', value: formatValue(input.p, exact) },
        { label: 'Complement', expression: `1 − ${exact?.isDisplayable() ? exact.toFractionString() : input.p}`, value: formatValue(comp, compExact) },
        { label: 'Odds in favour', expression: 'P(A) : P(not A)', value: formatOdds(input.p) },
      ],
      assumptions: ['P(A) is the probability you supplied; nothing further is assumed.'],
      limitations: [
        'A probability describes long-run frequency or degree of belief. A probability of 0.25 does not mean exactly one success in every four attempts.',
      ],
      exactness: exact ? 'exact' : 'numerical',
    },
  };
}

export type EventRelationship = 'independent' | 'mutually-exclusive' | 'given-intersection' | 'given-conditional' | 'unknown';

export const EVENT_RELATIONSHIPS: { id: EventRelationship; label: string; description: string }[] = [
  {
    id: 'independent',
    label: 'Independent',
    description: 'Knowing whether A happened tells you nothing about B. Then P(A and B) = P(A)·P(B).',
  },
  {
    id: 'mutually-exclusive',
    label: 'Mutually exclusive',
    description: 'A and B cannot both happen. Then P(A and B) = 0 and P(A or B) = P(A) + P(B).',
  },
  {
    id: 'given-intersection',
    label: 'Overlap supplied',
    description: 'You know P(A and B) directly, so no assumption about the relationship is needed.',
  },
  {
    id: 'given-conditional',
    label: 'Conditional supplied',
    description: 'You know P(B | A), so P(A and B) = P(A)·P(B | A).',
  },
  {
    id: 'unknown',
    label: 'Unknown',
    description: 'Not enough information to determine the overlap. Only bounds can be given.',
  },
];

export interface TwoEventInput {
  pA: number;
  pB: number;
  relationship: EventRelationship;
  /** Required for 'given-intersection'. */
  pAnd?: number;
  /** Required for 'given-conditional': P(B | A). */
  pBGivenA?: number;
  exactA?: Rational | null;
  exactB?: Rational | null;
}

export interface TwoEventResult {
  intersection: ProbabilityValue | null;
  union: ProbabilityValue | null;
  /** Bounds on P(A and B) implied by the marginals alone. */
  intersectionBounds: { low: number; high: number };
  unionBounds: { low: number; high: number };
  aGivenB: ProbabilityValue | null;
  bGivenA: ProbabilityValue | null;
  onlyA: ProbabilityValue | null;
  onlyB: ProbabilityValue | null;
  neither: ProbabilityValue | null;
  /** Whether the supplied numbers actually imply independence. */
  independenceCheck: { applicable: boolean; independent: boolean; productOfMarginals: number } | null;
  explanation: Explanation;
  warnings: string[];
}

export function validateTwoEvents(input: TwoEventInput): Issue[] {
  const v = new Validator();
  v.probability(input.pA, 'pA', 'P(A)');
  v.probability(input.pB, 'pB', 'P(B)');
  if (input.relationship === 'given-intersection') {
    if (input.pAnd === undefined) v.add('Enter P(A and B).', 'pAnd', 'required');
    else if (v.probability(input.pAnd, 'pAnd', 'P(A and B)')) {
      const high = Math.min(input.pA, input.pB);
      const low = Math.max(0, input.pA + input.pB - 1);
      if (input.pAnd > high + 1e-12) {
        v.add(
          `P(A and B) cannot exceed the smaller of P(A) and P(B), which is ${high}. The overlap of two events is never larger than either event.`,
          'pAnd',
          'inconsistent',
        );
      }
      if (input.pAnd < low - 1e-12) {
        v.add(
          `P(A and B) cannot be below ${low.toPrecision(6)}: since P(A) + P(B) = ${(input.pA + input.pB).toPrecision(6)} exceeds 1, the events must overlap by at least that much.`,
          'pAnd',
          'inconsistent',
        );
      }
    }
  }
  if (input.relationship === 'given-conditional') {
    if (input.pBGivenA === undefined) v.add('Enter P(B | A).', 'pBGivenA', 'required');
    else if (v.probability(input.pBGivenA, 'pBGivenA', 'P(B | A)')) {
      if (input.pA === 0) v.add('P(B | A) is undefined when P(A) = 0, because the condition never occurs.', 'pBGivenA', 'undefined');
      else {
        const and = input.pA * input.pBGivenA;
        if (and > input.pB + 1e-12) {
          v.add(
            `P(A)·P(B | A) = ${and.toPrecision(6)} exceeds P(B) = ${input.pB}. P(A and B) cannot be larger than P(B), so these three numbers are inconsistent.`,
            'pBGivenA',
            'inconsistent',
          );
        }
      }
    }
  }
  if (input.relationship === 'mutually-exclusive' && input.pA + input.pB > 1 + 1e-12) {
    v.add(
      `Mutually exclusive events cannot have probabilities summing to more than 1, but P(A) + P(B) = ${(input.pA + input.pB).toPrecision(6)}. Either the events overlap or one of the probabilities is wrong.`,
      'pB',
      'inconsistent',
    );
  }
  return v.issues;
}

export function analyseTwoEvents(input: TwoEventInput): TwoEventResult {
  const issues = validateTwoEvents(input);
  if (issues.length) throw new EngineError(issues);
  const { pA, pB } = input;
  const exactA = input.exactA ?? safeExact(pA);
  const exactB = input.exactB ?? safeExact(pB);
  const warnings: string[] = [];
  const steps = [
    { label: 'Given', expression: 'P(A)', value: formatValue(pA, exactA) },
    { label: 'Given', expression: 'P(B)', value: formatValue(pB, exactB) },
  ];
  const intersectionBounds = { low: Math.max(0, pA + pB - 1), high: Math.min(pA, pB) };
  const unionBounds = { low: Math.max(pA, pB), high: Math.min(1, pA + pB) };

  let and: number | null = null;
  let exactAnd: Rational | null = null;
  let method: string;
  let formula: string;
  const assumptions: string[] = [];

  switch (input.relationship) {
    case 'independent':
      and = pA * pB;
      exactAnd = exactA && exactB ? tryExact(() => exactA.mul(exactB)) : null;
      method = 'Multiplication rule for independent events';
      formula = 'P(A and B) = P(A) · P(B)';
      assumptions.push('A and B are independent: knowing whether one occurred does not change the probability of the other. This was your choice, not something derived from the numbers.');
      steps.push({ label: 'Independence assumption', expression: `P(A and B) = ${pA} × ${pB}`, value: formatValue(and, exactAnd) });
      break;
    case 'mutually-exclusive':
      and = 0;
      exactAnd = Rational.ZERO;
      method = 'Addition rule for mutually exclusive events';
      formula = 'P(A or B) = P(A) + P(B),  P(A and B) = 0';
      assumptions.push('A and B are mutually exclusive: they cannot both occur.');
      steps.push({ label: 'Mutual exclusivity', expression: 'P(A and B)', value: '0' });
      break;
    case 'given-intersection':
      and = input.pAnd!;
      exactAnd = safeExact(and);
      method = 'General addition rule with the overlap supplied';
      formula = 'P(A or B) = P(A) + P(B) − P(A and B)';
      steps.push({ label: 'Given', expression: 'P(A and B)', value: formatValue(and, exactAnd) });
      break;
    case 'given-conditional': {
      const cond = input.pBGivenA!;
      and = pA * cond;
      const exactCond = safeExact(cond);
      exactAnd = exactA && exactCond ? tryExact(() => exactA.mul(exactCond)) : null;
      method = 'Multiplication rule with a conditional probability';
      formula = 'P(A and B) = P(A) · P(B | A)';
      steps.push({ label: 'Given', expression: 'P(B | A)', value: formatValue(cond, exactCond) });
      steps.push({ label: 'Multiplication rule', expression: `P(A and B) = ${pA} × ${cond}`, value: formatValue(and, exactAnd) });
      break;
    }
    case 'unknown':
      method = 'Bounds from the marginal probabilities alone';
      formula = 'max(0, P(A) + P(B) − 1) ≤ P(A and B) ≤ min(P(A), P(B))';
      break;
  }

  if (input.relationship === 'unknown') {
    return {
      intersection: null,
      union: null,
      intersectionBounds,
      unionBounds,
      aGivenB: null,
      bGivenA: null,
      onlyA: null,
      onlyB: null,
      neither: null,
      independenceCheck: null,
      warnings: [
        'The relationship between A and B is unknown, so no single value for P(A and B) or P(A or B) follows from P(A) and P(B) alone. The ranges below contain every value consistent with what you supplied. To obtain a single answer, state the relationship or supply P(A and B) or P(B | A).',
      ],
      explanation: {
        method,
        formula,
        steps: [
          ...steps,
          { label: 'Overlap range', expression: formula, value: `${intersectionBounds.low.toPrecision(6)} to ${intersectionBounds.high.toPrecision(6)}` },
          { label: 'Union range', expression: 'max(P(A), P(B)) ≤ P(A or B) ≤ min(1, P(A) + P(B))', value: `${unionBounds.low.toPrecision(6)} to ${unionBounds.high.toPrecision(6)}` },
        ],
        assumptions: ['Only the two marginal probabilities were used. No independence was assumed.'],
        limitations: [
          'These are the tightest bounds obtainable from the marginal probabilities (the Fréchet–Hoeffding bounds). Narrowing them requires information about how the events relate.',
        ],
        exactness: 'exact',
      },
    };
  }

  const union = pA + pB - and!;
  const exactUnion = exactA && exactB && exactAnd ? tryExact(() => exactA.add(exactB).sub(exactAnd!)) : null;
  steps.push({ label: 'Addition rule', expression: `P(A or B) = ${pA} + ${pB} − ${and}`, value: formatValue(union, exactUnion) });

  const product = pA * pB;
  const independenceCheck =
    input.relationship === 'given-intersection' || input.relationship === 'given-conditional'
      ? { applicable: true, independent: Math.abs(and! - product) <= 1e-12 * Math.max(1, product), productOfMarginals: product }
      : null;
  if (independenceCheck?.applicable) {
    if (independenceCheck.independent) {
      warnings.push(`The numbers you supplied happen to satisfy P(A and B) = P(A)·P(B), so A and B are independent according to this data.`);
    } else if (and! > product) {
      warnings.push(`P(A and B) = ${and!.toPrecision(6)} is greater than P(A)·P(B) = ${product.toPrecision(6)}, so the events occur together more often than independence would give — they are positively associated.`);
    } else {
      warnings.push(`P(A and B) = ${and!.toPrecision(6)} is less than P(A)·P(B) = ${product.toPrecision(6)}, so the events occur together less often than independence would give — they are negatively associated.`);
    }
  }
  if (input.relationship === 'mutually-exclusive' && pA > 0 && pB > 0) {
    warnings.push('Mutually exclusive events with non-zero probabilities are never independent: if one occurs, the other definitely does not.');
  }

  const bGivenA = pA > 0 ? and! / pA : null;
  const aGivenB = pB > 0 ? and! / pB : null;
  if (pA === 0) warnings.push('P(B | A) is undefined because P(A) = 0: the condition never occurs.');
  if (pB === 0) warnings.push('P(A | B) is undefined because P(B) = 0: the condition never occurs.');

  return {
    intersection: probabilityValue(and!, exactAnd),
    union: probabilityValue(union, exactUnion),
    intersectionBounds,
    unionBounds,
    aGivenB: aGivenB === null ? null : probabilityValue(aGivenB, exactAnd && exactB && !exactB.isZero() ? tryExact(() => exactAnd!.div(exactB)) : null),
    bGivenA: bGivenA === null ? null : probabilityValue(bGivenA, exactAnd && exactA && !exactA.isZero() ? tryExact(() => exactAnd!.div(exactA)) : null),
    onlyA: probabilityValue(pA - and!, exactA && exactAnd ? tryExact(() => exactA.sub(exactAnd!)) : null),
    onlyB: probabilityValue(pB - and!, exactB && exactAnd ? tryExact(() => exactB.sub(exactAnd!)) : null),
    neither: probabilityValue(1 - union, exactUnion ? tryExact(() => Rational.ONE.sub(exactUnion)) : null),
    independenceCheck,
    warnings,
    explanation: {
      method,
      formula,
      steps,
      assumptions: assumptions.length ? assumptions : ['Only the values you supplied were used.'],
      limitations: [
        'These rules apply to the events exactly as you have defined them. If the events are not well defined, or the probabilities come from a biased source, the arithmetic is still correct but the conclusion may not be.',
      ],
      exactness: exactAnd && exactUnion ? 'exact' : 'numerical',
    },
  };
}

/** Law of total probability over a partition. */
export interface PartitionBranch {
  label: string;
  /** P(Hᵢ) */
  prior: number;
  /** P(E | Hᵢ) */
  likelihood: number;
}

export interface TotalProbabilityResult {
  evidenceProbability: ProbabilityValue;
  contributions: { label: string; joint: number; share: number }[];
  explanation: Explanation;
}

export function totalProbability(branches: PartitionBranch[]): TotalProbabilityResult {
  const v = new Validator();
  if (!branches.length) v.add('Add at least one case.', 'branches', 'required');
  let sum = 0;
  branches.forEach((b, i) => {
    v.probability(b.prior, `prior:${i}`, `P(${b.label})`);
    v.probability(b.likelihood, `likelihood:${i}`, `P(E | ${b.label})`);
    sum += b.prior;
  });
  if (branches.length && Math.abs(sum - 1) > 1e-9) {
    v.add(
      `The case probabilities sum to ${sum.toPrecision(8)}, not 1. The law of total probability needs a complete set of mutually exclusive cases covering every possibility. Adjust the probabilities or add a remaining case.`,
      'branches',
      'sum',
    );
  }
  v.throwIfInvalid();
  let pe = 0;
  for (const b of branches) pe += b.prior * b.likelihood;
  return {
    evidenceProbability: probabilityValue(pe),
    contributions: branches.map((b) => ({ label: b.label, joint: b.prior * b.likelihood, share: pe > 0 ? (b.prior * b.likelihood) / pe : NaN })),
    explanation: {
      method: 'Law of total probability',
      formula: 'P(E) = Σᵢ P(Hᵢ) · P(E | Hᵢ)',
      steps: [
        ...branches.map((b) => ({
          label: b.label,
          expression: `P(${b.label}) × P(E | ${b.label}) = ${b.prior} × ${b.likelihood}`,
          value: (b.prior * b.likelihood).toPrecision(8),
        })),
        { label: 'Total', expression: 'Sum of the contributions above', value: pe.toPrecision(8) },
      ],
      assumptions: ['The cases are mutually exclusive and together cover every possibility (they form a partition).'],
      limitations: ['The result is only as good as the supplied case probabilities and conditional probabilities.'],
      exactness: 'numerical',
    },
  };
}

export interface BayesHypothesis {
  label: string;
  prior: number;
  likelihood: number;
}

export interface BayesResult {
  evidenceProbability: number;
  posteriors: { label: string; prior: number; likelihood: number; joint: number; posterior: number; bayesFactor: number | null }[];
  explanation: Explanation;
  warnings: string[];
}

/**
 * Bayes' theorem for one or more hypotheses forming a partition.
 * Posterior(Hᵢ) = P(Hᵢ)·P(E | Hᵢ) / Σⱼ P(Hⱼ)·P(E | Hⱼ)
 */
export function bayes(hypotheses: BayesHypothesis[]): BayesResult {
  const v = new Validator();
  if (hypotheses.length < 2) v.add('Bayes’ theorem needs at least two hypotheses covering every possibility (for example "has the condition" and "does not have the condition").', 'hypotheses', 'required');
  let priorSum = 0;
  hypotheses.forEach((h, i) => {
    v.probability(h.prior, `prior:${i}`, `Prior for ${h.label}`);
    v.probability(h.likelihood, `likelihood:${i}`, `P(evidence | ${h.label})`);
    priorSum += h.prior;
  });
  if (hypotheses.length >= 2 && Math.abs(priorSum - 1) > 1e-9) {
    v.add(
      `The prior probabilities sum to ${priorSum.toPrecision(8)}, not 1. Bayes' theorem requires the hypotheses to be mutually exclusive and to cover every possibility.`,
      'hypotheses',
      'sum',
    );
  }
  v.throwIfInvalid();
  const joints = hypotheses.map((h) => h.prior * h.likelihood);
  const pe = joints.reduce((a, b) => a + b, 0);
  const warnings: string[] = [];
  if (pe === 0) {
    throw new EngineError(
      'The probability of the evidence is 0 under every hypothesis, so no posterior can be computed. At least one hypothesis must assign the observed evidence a non-zero probability.',
      'undefined',
    );
  }
  const posteriors = hypotheses.map((h, i) => {
    const others = joints.reduce((a, j, k) => (k === i ? a : a + j), 0);
    const otherPrior = 1 - h.prior;
    // Bayes factor for this hypothesis against all others combined.
    const likelihoodOthers = otherPrior > 0 ? others / otherPrior : null;
    return {
      label: h.label,
      prior: h.prior,
      likelihood: h.likelihood,
      joint: joints[i],
      posterior: joints[i] / pe,
      bayesFactor: likelihoodOthers && likelihoodOthers > 0 ? h.likelihood / likelihoodOthers : null,
    };
  });
  // Base-rate effect: a rare hypothesis that the evidence favours strongly can
  // still end up unlikely. Flag it whenever that is what the numbers show.
  for (const h of posteriors) {
    if (h.prior < 0.05 && h.posterior < 0.5 && h.bayesFactor !== null && h.bayesFactor > 3) {
      warnings.push(
        `Even though the evidence favours "${h.label}" by a factor of about ${h.bayesFactor.toPrecision(3)}, its probability is still only ${formatPercent(h.posterior)} because it started out rare (prior ${formatPercent(h.prior)}). This is the base-rate effect.`,
      );
    }
  }
  return {
    evidenceProbability: pe,
    posteriors,
    warnings,
    explanation: {
      method: "Bayes' theorem",
      formula: 'P(H | E) = P(H) · P(E | H) / P(E),  where P(E) = Σ P(Hᵢ) · P(E | Hᵢ)',
      steps: [
        ...hypotheses.map((h, i) => ({
          label: `Joint probability for ${h.label}`,
          expression: `P(${h.label}) × P(E | ${h.label}) = ${h.prior} × ${h.likelihood}`,
          value: joints[i].toPrecision(8),
        })),
        { label: 'Probability of the evidence P(E)', expression: 'Sum of the joint probabilities', value: pe.toPrecision(8) },
        ...posteriors.map((p) => ({
          label: `Posterior for ${p.label}`,
          expression: `${p.joint.toPrecision(8)} ÷ ${pe.toPrecision(8)}`,
          value: `${p.posterior.toPrecision(8)} (${formatPercent(p.posterior)})`,
        })),
      ],
      assumptions: [
        'The hypotheses are mutually exclusive and cover every possibility.',
        'The prior probabilities and the likelihoods are the values you supplied. Both are modelling inputs: the prior expresses what was believed before the evidence, the likelihood how probable the evidence is under each hypothesis.',
      ],
      limitations: [
        'Changing the prior changes the posterior. If the prior is uncertain, try a range of priors and see how much the conclusion moves.',
        'The result is a probability for the hypothesis given this evidence and this model. It is not a diagnosis, a decision, or a statement about any individual case beyond the model.',
      ],
      exactness: 'numerical',
    },
  };
}

/** Diagnostic-test framing of Bayes' theorem (sensitivity / specificity / prevalence). */
export interface DiagnosticInput {
  prevalence: number;
  sensitivity: number;
  specificity: number;
}

export interface DiagnosticResult {
  positivePredictiveValue: number;
  negativePredictiveValue: number;
  probabilityOfPositiveTest: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  /** Counts per 100 000 people, for an intuitive breakdown. */
  per100k: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
  explanation: Explanation;
}

export function diagnostic(input: DiagnosticInput): DiagnosticResult {
  const v = new Validator();
  v.probability(input.prevalence, 'prevalence', 'Prevalence (base rate)');
  v.probability(input.sensitivity, 'sensitivity', 'Sensitivity');
  v.probability(input.specificity, 'specificity', 'Specificity');
  v.throwIfInvalid();
  const { prevalence: pr, sensitivity: se, specificity: sp } = input;
  const tp = pr * se;
  const fn = pr * (1 - se);
  const fp = (1 - pr) * (1 - sp);
  const tn = (1 - pr) * sp;
  const pPos = tp + fp;
  const pNeg = tn + fn;
  const N = 100000;
  return {
    positivePredictiveValue: pPos > 0 ? tp / pPos : NaN,
    negativePredictiveValue: pNeg > 0 ? tn / pNeg : NaN,
    probabilityOfPositiveTest: pPos,
    falsePositiveRate: 1 - sp,
    falseNegativeRate: 1 - se,
    per100k: { truePositive: tp * N, falsePositive: fp * N, trueNegative: tn * N, falseNegative: fn * N },
    explanation: {
      method: "Bayes' theorem applied to a diagnostic test",
      formula: 'P(condition | positive) = (prevalence × sensitivity) / (prevalence × sensitivity + (1 − prevalence) × (1 − specificity))',
      steps: [
        { label: 'True positives', expression: `prevalence × sensitivity = ${pr} × ${se}`, value: tp.toPrecision(8) },
        { label: 'False positives', expression: `(1 − prevalence) × (1 − specificity) = ${(1 - pr).toPrecision(6)} × ${(1 - sp).toPrecision(6)}`, value: fp.toPrecision(8) },
        { label: 'Probability of a positive result', expression: 'true positives + false positives', value: pPos.toPrecision(8) },
        {
          label: 'Probability the condition is present given a positive result',
          expression: `${tp.toPrecision(8)} ÷ ${pPos.toPrecision(8)}`,
          value: pPos > 0 ? formatPercent(tp / pPos) : 'undefined',
        },
        { label: `Out of ${N.toLocaleString('en-US')} people`, expression: 'true positives / false positives', value: `${Math.round(tp * N).toLocaleString('en-US')} / ${Math.round(fp * N).toLocaleString('en-US')}` },
      ],
      assumptions: [
        'The prevalence, sensitivity and specificity you entered apply to the population being tested. Test performance measured in one population often differs in another.',
        'The test result is the only evidence used. Symptoms, exposure history and repeat testing are not included.',
      ],
      limitations: [
        'This is a worked probability calculation, not medical advice. Real interpretation of a test depends on clinical context, test quality, and factors outside this model.',
        'Sensitivity and specificity are themselves estimates with their own uncertainty, which this calculation does not propagate.',
      ],
      exactness: 'numerical',
    },
  };
}

/** Relative frequency from observed counts, with an interval. */
export interface FrequencyInput {
  successes: number;
  trials: number;
}

export function relativeFrequency(input: FrequencyInput): {
  estimate: ProbabilityValue;
  explanation: Explanation;
  warnings: string[];
} {
  const v = new Validator();
  v.integer(input.trials, 'trials', 'Number of observations', 1);
  v.integer(input.successes, 'successes', 'Number of successes', 0);
  if (v.valid && input.successes > input.trials) {
    v.add('The number of successes cannot exceed the number of observations.', 'successes', 'range');
  }
  v.throwIfInvalid();
  const p = input.successes / input.trials;
  const warnings: string[] = [];
  if (input.trials < 30) {
    warnings.push(`With only ${input.trials} observations the estimate is imprecise. The interval shown reflects that.`);
  }
  if (input.successes === 0 || input.successes === input.trials) {
    warnings.push(
      `Every observation fell on the same side, so the point estimate is ${p}. That does not mean the true probability is exactly ${p} — the interval gives the plausible range.`,
    );
  }
  return {
    estimate: probabilityValue(p, Rational.of(input.successes, input.trials)),
    warnings,
    explanation: {
      method: 'Relative frequency (empirical probability)',
      formula: 'p̂ = successes / observations',
      steps: [{ label: 'Estimate', expression: `${input.successes} ÷ ${input.trials}`, value: `${p.toPrecision(8)} (${formatPercent(p)})` }],
      assumptions: [
        'The observations come from repetitions of the same process under the same conditions, and are independent of one another.',
      ],
      limitations: [
        'This is an estimate from data, not an exact probability. A different set of observations would give a different value.',
      ],
      exactness: 'empirical',
    },
  };
}

/** Odds-to-probability and probability-to-odds conversion. */
export function oddsToProbability(favourable: number, against: number): { p: number; explanation: Explanation } {
  const v = new Validator();
  v.nonNegative(favourable, 'favourable', 'Favourable outcomes');
  v.nonNegative(against, 'against', 'Unfavourable outcomes');
  if (v.valid && favourable + against === 0) v.add('At least one of the two numbers must be greater than 0.', 'favourable', 'range');
  v.throwIfInvalid();
  const p = favourable / (favourable + against);
  return {
    p,
    explanation: {
      method: 'Odds to probability',
      formula: 'P = favourable / (favourable + unfavourable)',
      steps: [{ label: 'Conversion', expression: `${favourable} ÷ (${favourable} + ${against})`, value: `${p.toPrecision(8)} (${formatPercent(p)})` }],
      assumptions: ['The odds are expressed as favourable : unfavourable outcomes, not as betting odds including a margin.'],
      limitations: ['Bookmakers’ odds include a margin and do not convert directly into fair probabilities.'],
      exactness: 'exact',
    },
  };
}

export function formatOdds(p: number): string {
  if (p === 0) return '0 : 1 (never)';
  if (p === 1) return '1 : 0 (certain)';
  const exact = safeExact(p);
  if (exact && exact.isDisplayable(9)) {
    const against = Rational.ONE.sub(exact);
    // Scale both sides to integers.
    const num = exact.num * against.den;
    const den = against.num * exact.den;
    const g = gcdBig(num < 0n ? -num : num, den < 0n ? -den : den);
    return `${num / g} : ${den / g}`;
  }
  const ratio = p / (1 - p);
  return ratio >= 1 ? `${ratio.toPrecision(4)} : 1` : `1 : ${(1 / ratio).toPrecision(4)}`;
}

function gcdBig(a: bigint, b: bigint): bigint {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a || 1n;
}

function safeExact(p: number): Rational | null {
  try {
    return Rational.fromNumber(p);
  } catch {
    return null;
  }
}

function tryExact(fn: () => Rational): Rational | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

function formatValue(p: number, exact?: Rational | null): string {
  const pct = formatPercent(p);
  if (exact && exact.isDisplayable() && !exact.isInteger()) return `${exact.toFractionString()} = ${p.toPrecision(8)} (${pct})`;
  return `${p.toPrecision(8)} (${pct})`;
}
