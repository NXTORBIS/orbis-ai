/**
 * Completing a partial judgement, honestly.
 *
 * A judge will often give a mean, or a range, or two quantiles, and nothing
 * more. There are then infinitely many distributions consistent with what they
 * said. Two defensible things can be done, and this file does both:
 *
 *  1. MAXIMUM ENTROPY — return the single least-committal distribution
 *     consistent with the stated constraints. This adds no information beyond
 *     what was said, which is the honest answer to "that is all I know". It is
 *     still a commitment: it picks one distribution, and the choice depends on
 *     the support and on the measure entropy is taken with respect to.
 *
 *  2. IMPRECISE — when the judge gives a RANGE for a probability or for a
 *     quantile rather than a number, return a p-box or a credal set. Collapsing
 *     a stated range to its midpoint invents precision the judge explicitly
 *     declined to supply, which is the specific failure this module exists to
 *     prevent.
 *
 * Both reuse the engine's existing solvers: `maximumEntropyDistribution` and
 * `maximumEntropyClosedForm` from the information module, and `makePBox`,
 * `credalFromIntervals` and `reachableIntervals` from the imprecise module.
 */
import { EngineError, type Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import {
  discreteSupport,
  maximumEntropyClosedForm,
  maximumEntropyDistribution,
  midpointGrid,
  type MaxEntropyResult,
  type MomentConstraint,
} from '../information/differential';
import { credalFromIntervals, reachableIntervals, type CredalSet, type IntervalTableReport } from '../imprecise/credal';
import { makePBox, type PBox } from '../imprecise/pbox';
import type { Labelled } from '../imprecise/types';
import {
  judgementBasis,
  JUDGEMENT_EXACTNESS,
  type ElicitedQuantile,
  type JudgementBasis,
  type JudgementExactness,
  validateElicitedQuantiles,
} from './types';

/* ------------------------------------------------------------------ */
/* Maximum-entropy completion                                         */
/* ------------------------------------------------------------------ */

export type JudgedSupport = 'reals' | 'positive-halfline' | 'bounded' | 'finite-set';

export interface PartialJudgement {
  /** What the judge said about where the quantity can live. */
  support: JudgedSupport;
  /** Required for 'bounded'; the lower bound for 'positive-halfline' defaults to 0. */
  range?: { lower: number; upper: number };
  /** A stated expected value. */
  mean?: number;
  /** A stated variance. Needs `mean` as well, since the constraint is on E[X²]. */
  variance?: number;
  /** Stated quantiles, each becoming the constraint E[1{X ≤ value}] = level. */
  quantiles?: readonly ElicitedQuantile[];
  /** For 'finite-set': the outcome labels, when the quantity is categorical. */
  outcomes?: readonly number[];
}

export interface MaxEntropyCompletionResult {
  /** The numerical solution on a grid. */
  solution: MaxEntropyResult;
  /** The constraints as handed to the solver, in words. */
  constraints: { name: string; target: number }[];
  /**
   * The textbook closed form, when the stated constraints are one of the
   * recognised sets. This is the answer to report: it is a named registry
   * distribution rather than a grid.
   */
  closedForm?: { distributionId: string; params: Params; reason: string };
  /**
   * Largest relative deviation between the grid density and the closed-form
   * density, when a closed form exists. A cross-check, not a result.
   */
  closedFormAgreement?: number;
  /** Mean and variance of the returned grid distribution. */
  gridMean: number;
  gridVariance: number;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * The least-committal distribution consistent with a partial judgement.
 *
 * Known closed forms this reproduces, and reports as such:
 *   - a mean on [0, ∞) → the exponential with rate 1/mean;
 *   - a mean and a variance on (−∞, ∞) → the normal;
 *   - nothing but a bounded range → the uniform;
 *   - nothing on a finite set → the uniform on that set.
 */
export function maximumEntropyCompletion(
  judgement: PartialJudgement,
  options: { gridPoints?: number; tailExtent?: number } = {},
): MaxEntropyCompletionResult {
  const gridPoints = options.gridPoints ?? 4000;
  if (!Number.isInteger(gridPoints) || gridPoints < 16) {
    throw new EngineError(`gridPoints must be a whole number of at least 16; got ${gridPoints}.`, 'integer');
  }
  // How far out the grid reaches, in multiples of the natural scale. 40 mean
  // lengths leaves exp(−40) ≈ 4e−18 of exponential mass outside; 12 standard
  // deviations leaves ~2e−33 of normal mass outside. Both are far below double
  // rounding error in the density, so the truncation is not visible in the result.
  const tailExtent = options.tailExtent ?? 40;
  if (!(tailExtent > 1)) throw new EngineError(`tailExtent must be greater than 1; got ${tailExtent}.`, 'range');

  const qs = judgement.quantiles ? validateElicitedQuantiles(judgement.quantiles, 'quantile constraints') : [];
  const { mean, variance } = judgement;
  if (mean !== undefined && !Number.isFinite(mean)) {
    throw new EngineError(`The stated mean ${String(mean)} is not a finite number.`, 'finite');
  }
  if (variance !== undefined) {
    if (!Number.isFinite(variance) || variance <= 0) {
      throw new EngineError(
        `The stated variance ${String(variance)} must be a finite number greater than 0. A variance of 0 asserts ` +
          'certainty, which is not a distribution this solver can return.',
        'range',
      );
    }
    if (mean === undefined) {
      throw new EngineError(
        'A variance was stated without a mean. The maximum-entropy constraint for a variance is on E[X²], which ' +
          'cannot be formed without the mean. State the mean as well, or state a range instead.',
        'insufficient',
      );
    }
  }
  if (mean === undefined && variance === undefined && qs.length === 0 && judgement.support !== 'bounded' && judgement.support !== 'finite-set') {
    throw new EngineError(
      `Nothing was stated: no mean, no variance and no quantiles, on the unbounded support "${judgement.support}". ` +
        'There is no maximum-entropy distribution on an unbounded support with no constraints — the entropy is ' +
        'unbounded above. State at least a range or a mean.',
      'insufficient',
    );
  }

  // Build the support grid.
  let support: ReturnType<typeof midpointGrid>;
  let supportDescription: string;
  if (judgement.support === 'finite-set') {
    const outcomes = judgement.outcomes;
    if (!outcomes || outcomes.length < 2) {
      throw new EngineError(
        `A finite-set support needs at least 2 outcomes; got ${outcomes ? outcomes.length : 0}.`,
        'too-few',
      );
    }
    if (outcomes.some((o) => !Number.isFinite(o))) {
      throw new EngineError('Every outcome of a finite set must be a finite number.', 'finite');
    }
    support = discreteSupport(outcomes);
    supportDescription = `the finite set {${outcomes.join(', ')}}`;
  } else if (judgement.support === 'bounded') {
    const r = judgement.range;
    if (!r || !Number.isFinite(r.lower) || !Number.isFinite(r.upper)) {
      throw new EngineError('A bounded support needs a finite range {lower, upper}.', 'finite');
    }
    if (!(r.upper > r.lower)) {
      throw new EngineError(
        `The stated range [${r.lower}, ${r.upper}] has zero or negative width. A zero-width range asserts ` +
          'certainty about the value, which no distribution with positive entropy can express.',
        'zero-width',
      );
    }
    support = midpointGrid(r.lower, r.upper, gridPoints);
    supportDescription = `the bounded range [${r.lower}, ${r.upper}]`;
  } else if (judgement.support === 'positive-halfline') {
    const lower = judgement.range?.lower ?? 0;
    if (!Number.isFinite(lower)) throw new EngineError('The lower bound of a positive half-line must be finite.', 'finite');
    const scale =
      mean !== undefined && mean > lower
        ? mean - lower
        : qs.length
          ? Math.max(qs[qs.length - 1].value - lower, 1e-9)
          : undefined;
    if (scale === undefined) {
      throw new EngineError(
        `A half-line support [${lower}, ∞) needs a mean greater than ${lower}, or at least one quantile, to fix the ` +
          'scale of the grid. Without one the solver has no finite region to work on.',
        'insufficient',
      );
    }
    const upper = judgement.range?.upper ?? lower + tailExtent * scale;
    if (!(upper > lower)) throw new EngineError(`The implied grid [${lower}, ${upper}] is empty.`, 'range');
    support = midpointGrid(lower, upper, gridPoints);
    supportDescription = `the half-line [${lower}, ∞), truncated at ${upper.toPrecision(6)} for the grid`;
  } else {
    const sd = variance !== undefined ? Math.sqrt(variance) : undefined;
    const centre = mean ?? (qs.length ? qs[Math.floor(qs.length / 2)].value : undefined);
    const spread =
      sd ?? (qs.length >= 2 ? Math.max((qs[qs.length - 1].value - qs[0].value) / 2, 1e-9) : undefined);
    if (centre === undefined || spread === undefined) {
      throw new EngineError(
        'A support of the whole real line needs a mean and a variance, or at least two quantiles, to fix the ' +
          'region the grid covers. Nothing stated here does that.',
        'insufficient',
      );
    }
    const lower = judgement.range?.lower ?? centre - (tailExtent / 3.3333) * spread;
    const upper = judgement.range?.upper ?? centre + (tailExtent / 3.3333) * spread;
    support = midpointGrid(lower, upper, gridPoints);
    supportDescription = `the real line, with the grid covering [${lower.toPrecision(6)}, ${upper.toPrecision(6)}]`;
  }

  const constraints: MomentConstraint[] = [];
  if (mean !== undefined) constraints.push({ name: 'mean E[X]', f: (x) => x, target: mean });
  if (variance !== undefined && mean !== undefined) {
    constraints.push({ name: 'second moment E[X²]', f: (x) => x * x, target: variance + mean * mean });
  }
  for (const q of qs) {
    constraints.push({
      name: `P(X ≤ ${q.value}) = ${q.level}`,
      f: (x) => (x <= q.value ? 1 : 0),
      target: q.level,
    });
  }

  const solution = maximumEntropyDistribution(support, constraints, { base: 'nats' });
  const gridMean = stableSum(solution.support.map((x, i) => x * solution.probabilities[i]));
  const gridVariance = stableSum(solution.support.map((x, i) => (x - gridMean) ** 2 * solution.probabilities[i]));

  // Recognise the textbook constraint sets.
  let closedForm: { distributionId: string; params: Params; reason: string } | undefined;
  const onlyMean = mean !== undefined && variance === undefined && qs.length === 0;
  const meanAndVariance = mean !== undefined && variance !== undefined && qs.length === 0;
  const nothing = mean === undefined && variance === undefined && qs.length === 0;
  if (judgement.support === 'positive-halfline' && onlyMean && (judgement.range?.lower ?? 0) === 0) {
    const cf = maximumEntropyClosedForm('mean-on-positive-halfline', { mean });
    if ('distributionId' in cf) closedForm = { distributionId: cf.distributionId, params: cf.params, reason: cf.reason };
  } else if (judgement.support === 'reals' && meanAndVariance) {
    const cf = maximumEntropyClosedForm('mean-and-variance-on-reals', { mean, variance });
    if ('distributionId' in cf) closedForm = { distributionId: cf.distributionId, params: cf.params, reason: cf.reason };
  } else if (judgement.support === 'bounded' && nothing && judgement.range) {
    const cf = maximumEntropyClosedForm('none-on-bounded-interval', { a: judgement.range.lower, b: judgement.range.upper });
    if ('distributionId' in cf) closedForm = { distributionId: cf.distributionId, params: cf.params, reason: cf.reason };
  }

  let closedFormAgreement: number | undefined;
  if (closedForm && support.continuous) {
    const def = getDistribution(closedForm.distributionId);
    let worst = 0;
    for (let i = 0; i < solution.support.length; i++) {
      const exact = def.pdf(solution.support[i], closedForm.params);
      const got = solution.density[i];
      // Compare only where the exact density is large enough that a relative
      // comparison is meaningful; in the far tail both are ~0 and the ratio is
      // dominated by the grid truncation rather than by the solver.
      if (exact > 1e-6) worst = Math.max(worst, Math.abs(got - exact) / exact);
    }
    closedFormAgreement = worst;
  }

  const warnings: string[] = [];
  warnings.push(
    'Maximum entropy is the least-committal distribution CONSISTENT WITH THE STATED CONSTRAINTS. It is not a ' +
      'claim about reality and it is not a "neutral" choice: it depends on the support and on the measure entropy ' +
      'is taken with respect to, neither of which the judge chose.',
  );
  if (closedForm) {
    warnings.push(
      `These constraints have a known closed-form answer (${closedForm.distributionId}), which is reported in ` +
        '`closedForm` and is the one to use. The grid solution is a numerical cross-check of it.',
    );
  }
  if (solution.maxMomentError > 1e-8) {
    warnings.push(
      `The solver matched the stated constraints only to ${solution.maxMomentError.toExponential(3)}. The returned ` +
        'distribution does not exactly satisfy what the judge said; treat the mismatch as part of the answer.',
    );
  }
  if (support.continuous && judgement.support !== 'bounded') {
    warnings.push(
      `The unbounded support was discretised over ${supportDescription}. Any probability the true answer places ` +
        'beyond the grid is missing from this one.',
    );
  }

  return {
    solution,
    constraints: constraints.map((c) => ({ name: c.name, target: c.target })),
    closedForm,
    closedFormAgreement,
    gridMean,
    gridVariance,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Maximum-entropy completion of a partial judgement',
      `A judge stated: ${[
        `the quantity lives on ${supportDescription}`,
        ...(mean !== undefined ? [`its mean is ${mean}`] : []),
        ...(variance !== undefined ? [`its variance is ${variance}`] : []),
        ...qs.map((q) => `P(X ≤ ${q.value}) = ${q.level}`),
      ].join('; ')} — and nothing else`,
      [
        'Maximum entropy adds no information beyond the stated constraints, but it does make a choice: one distribution out of the infinitely many that are consistent.',
        'The answer is not invariant under reparameterisation. Maximum entropy in x and in log x give different distributions.',
        'If the judge could state more, the honest move is to ask them rather than to let the entropy principle decide.',
      ],
    ),
    explanation: {
      method: 'Maximum-entropy completion (exponential family, Newton on the convex dual)',
      formula: 'p(x) ∝ w(x)·exp(Σ λ_k f_k(x)) with λ chosen so that E[f_k] equals each stated target',
      steps: [
        { label: 'Support', value: supportDescription },
        { label: 'Constraints', value: constraints.length ? constraints.map((c) => `${c.name} = ${c.target}`).join('; ') : 'none beyond the support' },
        { label: 'Grid points', value: String(solution.support.length) },
        { label: 'Largest constraint mismatch', value: solution.maxMomentError.toExponential(3) },
        { label: 'Entropy of the solution (nats)', value: solution.entropy.toPrecision(8) },
        { label: 'Grid mean', value: gridMean.toPrecision(8) },
        { label: 'Grid variance', value: gridVariance.toPrecision(8) },
        ...(closedForm
          ? [
              { label: 'Closed form', value: `${closedForm.distributionId} with ${Object.entries(closedForm.params).map(([k, v]) => `${k} = ${v.toPrecision(8)}`).join(', ')}` },
              { label: 'Why', value: closedForm.reason },
              { label: 'Grid vs closed-form density (worst relative error)', value: closedFormAgreement !== undefined ? closedFormAgreement.toExponential(3) : 'not compared' },
            ]
          : [{ label: 'Closed form', value: 'none recognised for this constraint set' }]),
      ],
      assumptions: [
        'The stated constraints are everything the judge knows, which is what makes maximum entropy the right principle rather than merely a convenient one.',
      ],
      limitations: [
        'A continuum is discretised, so the density is second-order accurate in the grid width and the far tails are truncated.',
        'Everything here is `assumed`: the constraints came from an opinion.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Imprecise elicitation: a stated RANGE stays a range                */
/* ------------------------------------------------------------------ */

export interface IntervalProbabilityJudgement {
  label: string;
  lower: number;
  upper: number;
}

export interface ImpreciseProbabilityResult {
  judgements: IntervalProbabilityJudgement[];
  /** The intervals the stated table actually implies, after tightening. */
  reachable: IntervalTableReport;
  /** The convex set of distributions consistent with the stated intervals. */
  credal: CredalSet;
  /** Total imprecision: Σ (upper_i − lower_i). 0 means the judge gave point values after all. */
  totalImprecision: number;
  /** The widest single interval, and which element it belongs to. */
  widest: { label: string; width: number };
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * A judge who gives ranges for probabilities gets a credal set, not a point
 * distribution.
 *
 * Replacing [0.2, 0.4] with 0.3 throws away the only thing the judge was sure
 * about — that they were not sure — and then reports the result with the
 * authority of a number they never gave.
 */
export function elicitImpreciseProbabilities(
  judgements: readonly IntervalProbabilityJudgement[],
): ImpreciseProbabilityResult {
  if (judgements.length < 2) {
    throw new EngineError(
      `An interval-valued probability table needs at least 2 elements; got ${judgements.length}.`,
      'too-few',
    );
  }
  const labels = judgements.map((j) => j.label);
  if (new Set(labels).size !== labels.length) {
    throw new EngineError('Two elements share a label; each element must be named once.', 'duplicate');
  }
  judgements.forEach((j) => {
    if (!Number.isFinite(j.lower) || !Number.isFinite(j.upper)) {
      throw new EngineError(`"${j.label}" has non-finite bounds [${String(j.lower)}, ${String(j.upper)}].`, 'finite');
    }
    if (j.lower > j.upper) {
      throw new EngineError(
        `"${j.label}" was given the interval [${j.lower}, ${j.upper}], whose lower bound exceeds its upper bound. ` +
          'That interval is empty and describes nothing.',
        'crossed-bounds',
      );
    }
  });
  const lower = judgements.map((j) => j.lower);
  const upper = judgements.map((j) => j.upper);
  // reachableIntervals refuses an incoherent table (Σlower > 1 or Σupper < 1)
  // and names the sums, which is the refusal wanted here.
  const reachableResult = reachableIntervals(labels, lower, upper);
  const credalResult = credalFromIntervals(labels, lower, upper);
  const widths = judgements.map((j) => j.upper - j.lower);
  const widestIndex = widths.indexOf(Math.max(...widths));
  const totalImprecision = stableSum(widths);
  const warnings = [...reachableResult.warnings, ...credalResult.warnings];
  if (totalImprecision === 0) {
    warnings.push(
      'Every stated interval has zero width, so the judge actually gave point probabilities. A credal set is still ' +
        'returned (a single vertex) but there is no imprecision to propagate; a plain coherence check is the right tool.',
    );
  }
  if (!reachableResult.value.alreadyReachable) {
    warnings.push(
      'The stated intervals were not reachable: some of them are tighter than they look once the others are taken ' +
        'into account. The tightened intervals in `reachable` are what the judge actually committed to, and they are ' +
        'narrower than what they said. The original statements are preserved in `judgements`.',
    );
  }
  warnings.push(
    `Total imprecision is ${totalImprecision.toPrecision(6)} across ${judgements.length} elements. Every quantity ` +
      'derived from this set is a BOUND, and no value inside a bound is a better estimate than any other.',
  );
  return {
    judgements: judgements.map((j) => ({ ...j })),
    reachable: reachableResult.value,
    credal: credalResult.value,
    totalImprecision,
    widest: { label: judgements[widestIndex].label, width: widths[widestIndex] },
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Interval-valued probability judgements kept as a credal set',
      `A judge gave probability RANGES, not numbers, for ${judgements.length} elements: ${judgements
        .map((j) => `${j.label} ∈ [${j.lower}, ${j.upper}]`)
        .join(', ')}`,
      [
        'The judge declined to give a number. Collapsing the interval to a point would report a precision they explicitly refused.',
        'The credal set is convex: every mixture of its vertices is admissible. It is a set of distributions, not a distribution over distributions.',
        ...credalResult.provenance.commitments,
      ],
    ),
    explanation: {
      method: 'Credal set from interval-valued elicited probabilities',
      formula: 'Coherent iff Σ lower ≤ 1 ≤ Σ upper; reachable bounds are l′_i = max(l_i, 1 − Σ_{j≠i} u_j), u′_i = min(u_i, 1 − Σ_{j≠i} l_j)',
      steps: [
        { label: 'Stated', value: judgements.map((j) => `${j.label} ∈ [${j.lower}, ${j.upper}]`).join('; ') },
        { label: 'Σ lower, Σ upper', value: `${stableSum(lower).toPrecision(8)}, ${stableSum(upper).toPrecision(8)}` },
        { label: 'Reachable (tightened)', value: labels.map((l, i) => `${l} ∈ [${reachableResult.value.lower[i].toPrecision(6)}, ${reachableResult.value.upper[i].toPrecision(6)}]`).join('; ') },
        { label: 'Already reachable', value: reachableResult.value.alreadyReachable ? 'yes' : 'no — the stated bounds were looser than they implied' },
        { label: 'Credal vertices', value: String(credalResult.value.vertices.length) },
        { label: 'Total imprecision', value: totalImprecision.toPrecision(8) },
      ],
      assumptions: ['The elements are mutually exclusive and exhaustive.'],
      limitations: [
        'An interval table cannot express a constraint linking two elements (for example "A is at least twice B"). Those need explicit linear constraints.',
        'The width of the intervals is itself a judgement, and an unpractised judge states ranges that are too narrow for the same reason their quantiles are.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

export interface IntervalQuantileJudgement {
  level: number;
  /** The judge's lowest plausible value for this quantile. */
  lower: number;
  /** Their highest plausible value for it. */
  upper: number;
}

export interface ImpreciseQuantileResult {
  judgements: IntervalQuantileJudgement[];
  pbox: PBox;
  /** The p-box with its provenance from the imprecise module. */
  labelled: Labelled<PBox>;
  /** Width of the box, in value units, at each stated level. */
  widthAtStatedLevels: { level: number; width: number }[];
  /** True when the box is unbounded below or above, because no bound was stated. */
  unboundedBelow: boolean;
  unboundedAbove: boolean;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Interval-valued quantiles become a p-box.
 *
 * The judge says "my 90th percentile is somewhere between 200 and 300". The
 * honest object is a pair of bounding CDFs, built so that EVERY distribution
 * whose quantile function passes through the stated intervals lies inside the
 * box. Outside the stated levels nothing was said, so the box is left
 * unbounded there unless a support bound was supplied.
 */
export function elicitImpreciseQuantiles(
  judgements: readonly IntervalQuantileJudgement[],
  options: { steps?: number; supportLower?: number; supportUpper?: number } = {},
): ImpreciseQuantileResult {
  if (judgements.length === 0) {
    throw new EngineError('No interval-valued quantiles were given, so no p-box can be built.', 'empty');
  }
  judgements.forEach((j, i) => {
    if (!Number.isFinite(j.level)) throw new EngineError(`Judgement ${i} has the non-finite level ${String(j.level)}.`, 'finite');
    if (!(j.level > 0 && j.level < 1)) {
      throw new EngineError(
        `Judgement ${i} has the level ${j.level}, outside (0, 1). A level of exactly 0 or 1 is a support bound, ` +
          'not a quantile; pass it as supportLower or supportUpper.',
        'range',
      );
    }
    if (!Number.isFinite(j.lower) || !Number.isFinite(j.upper)) {
      throw new EngineError(`Judgement ${i} (level ${j.level}) has non-finite bounds.`, 'finite');
    }
    if (j.lower > j.upper) {
      throw new EngineError(
        `At level ${j.level} the judge gave [${j.lower}, ${j.upper}], whose lower bound exceeds its upper bound.`,
        'crossed-bounds',
      );
    }
  });
  const sorted = [...judgements].sort((a, b) => a.level - b.level);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].level === sorted[i - 1].level) {
      throw new EngineError(`The level ${sorted[i].level} was stated twice.`, 'duplicate');
    }
    if (sorted[i].lower < sorted[i - 1].lower) {
      throw new EngineError(
        `The lower bounds are not monotone: level ${sorted[i - 1].level} has lower bound ${sorted[i - 1].lower} but ` +
          `the higher level ${sorted[i].level} has the smaller lower bound ${sorted[i].lower}. That pair is the ` +
          'offending one; a quantile function cannot decrease.',
        'non-monotone',
      );
    }
    if (sorted[i].upper < sorted[i - 1].upper) {
      throw new EngineError(
        `The upper bounds are not monotone: level ${sorted[i - 1].level} has upper bound ${sorted[i - 1].upper} but ` +
          `the higher level ${sorted[i].level} has the smaller upper bound ${sorted[i].upper}. That pair is the offending one.`,
        'non-monotone',
      );
    }
  }
  const steps = options.steps ?? 200;
  if (!Number.isInteger(steps) || steps < 2) {
    throw new EngineError(`steps must be a whole number of at least 2; got ${steps}.`, 'integer');
  }
  const supportLower = options.supportLower ?? -Infinity;
  const supportUpper = options.supportUpper ?? Infinity;
  if (Number.isFinite(supportLower) && Number.isFinite(supportUpper) && !(supportUpper > supportLower)) {
    throw new EngineError(`The stated support [${supportLower}, ${supportUpper}] is empty.`, 'range');
  }

  // Monotone linear interpolation of each bound over the stated levels, held
  // flat at the stated extremes and falling back to the support bounds outside.
  const interp = (levels: number[], values: number[], p: number, outsideLow: number, outsideHigh: number): number => {
    if (p <= levels[0]) return p === levels[0] ? values[0] : outsideLow;
    if (p >= levels[levels.length - 1]) return p === levels[levels.length - 1] ? values[values.length - 1] : outsideHigh;
    let k = 1;
    while (k < levels.length && levels[k] < p) k++;
    const t = (p - levels[k - 1]) / (levels[k] - levels[k - 1]);
    return values[k - 1] + t * (values[k] - values[k - 1]);
  };
  const levels = sorted.map((j) => j.level);
  const los = sorted.map((j) => j.lower);
  const his = sorted.map((j) => j.upper);
  // lo[i] = the smallest value the i-th probability bucket could take, which is
  // the LOWER bound of the quantile at the bucket's bottom edge; hi[i] the
  // largest, from the UPPER bound at the bucket's top edge. This keeps the box
  // an OUTER bound: nothing consistent with the judgements is excluded.
  const lo = new Float64Array(steps);
  const hi = new Float64Array(steps);
  for (let i = 0; i < steps; i++) {
    lo[i] = interp(levels, los, i / steps, supportLower, his[his.length - 1] > supportUpper ? supportUpper : los[los.length - 1]);
    hi[i] = interp(levels, his, (i + 1) / steps, his[0], supportUpper);
  }
  // Enforce the bucket invariants makePBox checks, without widening: the
  // interpolation is already monotone, so only the outer buckets can need the
  // support bounds applied.
  for (let i = 0; i < steps; i++) {
    if (Number.isFinite(supportLower)) {
      lo[i] = Math.max(lo[i], supportLower);
      hi[i] = Math.max(hi[i], supportLower);
    }
    if (Number.isFinite(supportUpper)) {
      lo[i] = Math.min(lo[i], supportUpper);
      hi[i] = Math.min(hi[i], supportUpper);
    }
    if (hi[i] < lo[i]) hi[i] = lo[i];
  }
  const box = makePBox(lo, hi);
  const widthAtStatedLevels = sorted.map((j) => ({ level: j.level, width: j.upper - j.lower }));
  const unboundedBelow = !Number.isFinite(supportLower);
  const unboundedAbove = !Number.isFinite(supportUpper);
  const warnings: string[] = [];
  warnings.push(
    'Every value between the two bounding CDFs is equally admissible. There is no best estimate inside a p-box; ' +
      'the width is the information.',
  );
  if (unboundedBelow || unboundedAbove) {
    warnings.push(
      `The judge stated nothing below level ${levels[0]} or above level ${levels[levels.length - 1]}, and no ` +
        `support bound was supplied${unboundedBelow && unboundedAbove ? ' at either end' : unboundedBelow ? ' at the lower end' : ' at the upper end'}. ` +
        'The box is therefore unbounded there and any expectation computed from it is unbounded too. Supply ' +
        'supportLower / supportUpper if the judge can state them.',
    );
  }
  if (widthAtStatedLevels.every((w) => w.width === 0)) {
    warnings.push(
      'Every stated interval has zero width, so the judge gave precise quantiles after all. Fit a parametric ' +
        'family with fitElicitedQuantiles instead; a p-box adds nothing here.',
    );
  }
  const labelledBox: Labelled<PBox> = {
    value: box,
    provenance: {
      formalism: 'pbox',
      exactness: JUDGEMENT_EXACTNESS,
      question: 'Given what the judge was willing to say, between which two CDFs must the true one lie?',
      commitments: [
        'The true CDF lies anywhere between the two bounds; no distribution inside the box is privileged.',
        'The box is an OUTER bound on what the judge said, so it is never narrower than their statements justify.',
        'Arithmetic on this box needs a dependence assumption; without one the honest answer is the unknown-dependence bound.',
      ],
      notes: [
        `Built from ${sorted.length} interval-valued quantiles by monotone interpolation of each bound over ${steps} probability buckets.`,
        'Outside the stated levels the bounds fall back to the stated support, or to ±∞ when no support was stated.',
      ],
    },
    warnings,
  };
  return {
    judgements: sorted.map((j) => ({ ...j })),
    pbox: box,
    labelled: labelledBox,
    widthAtStatedLevels,
    unboundedBelow,
    unboundedAbove,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Probability box from interval-valued elicited quantiles',
      `A judge gave a RANGE for each of ${sorted.length} quantiles: ${sorted
        .map((j) => `the ${j.level} quantile is in [${j.lower}, ${j.upper}]`)
        .join(', ')}`,
      [
        'The judge declined to pin each quantile to a number, so the result is a pair of bounding CDFs rather than one distribution.',
        'Choosing any single distribution from inside this box reintroduces exactly the precision the judge refused.',
      ],
    ),
    explanation: {
      method: 'p-box from interval-valued quantiles',
      formula: 'F̄(x) = #{i : lo[i] ≤ x}/n and F̲(x) = #{i : hi[i] ≤ x}/n, with lo and hi interpolated from the stated bounds',
      steps: [
        { label: 'Stated', value: sorted.map((j) => `${j.level}: [${j.lower}, ${j.upper}]`).join('; ') },
        { label: 'Probability buckets', value: String(steps) },
        { label: 'Support', value: `[${Number.isFinite(supportLower) ? supportLower : '−∞'}, ${Number.isFinite(supportUpper) ? supportUpper : '∞'}]` },
        { label: 'Width at the stated levels', value: widthAtStatedLevels.map((w) => `${w.level}: ${w.width.toPrecision(6)}`).join('; ') },
      ],
      assumptions: ['The stated bounds at each level are hard: the judge is sure the quantile is inside them.'],
      limitations: [
        'A p-box bounds each point of the CDF separately and cannot express a constraint linking two levels.',
        'Between the stated levels the bounds are interpolated, which is an assumption about smoothness that the judge did not make.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}
