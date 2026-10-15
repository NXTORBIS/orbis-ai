/**
 * Elicitation protocols: how the numbers get out of the judge's head.
 *
 * A protocol is not a formality. The same person, asked about the same
 * quantity, gives reproducibly different answers depending on whether they are
 * asked for a value at a fixed probability or a probability at a fixed value,
 * and on whether they place chips in bins or type a number. The effect is
 * large, well replicated, and in a known direction, so each protocol here
 * carries the effect it is known to produce.
 *
 * The functions that produce the NEXT QUESTION exist so that an interface can
 * run a real protocol — median first, then bisect — instead of presenting a
 * form and accepting whatever is typed. The order of the questions is itself
 * part of the method: asking for the extremes first anchors the judge and
 * narrows everything that follows.
 */
import { EngineError, type Explanation } from '../core/result';
import { linspace, stableSum } from '../core/numeric';
import { getDistribution } from '../distributions/registry';
import {
  judgementBasis,
  JUDGEMENT_EXACTNESS,
  type ElicitedQuantile,
  type JudgementBasis,
  type JudgementExactness,
  validateElicitedQuantiles,
} from './types';
import { fitElicitedQuantiles, type QuantileFitOptions, type QuantileFitResult } from './quantiles';

/* ------------------------------------------------------------------ */
/* Framings                                                           */
/* ------------------------------------------------------------------ */

export type Framing = 'fixed-probability' | 'fixed-value' | 'trial-roulette' | 'probability-wheel';

export interface FramingNote {
  question: string;
  description: string;
  /** The documented, replicated effect of using this framing. */
  knownEffect: string;
}

export const FRAMING_NOTES: Readonly<Record<Framing, FramingNote>> = {
  'fixed-probability': {
    question: 'What value are you 90% sure the quantity is below?',
    description:
      'The probability is fixed by the analyst and the judge supplies the value. This is the variable-interval or ' +
      'fractile method and is what a quantile fit consumes directly.',
    knownEffect:
      'Produces the NARROWEST intervals of the framings here: the judge adjusts outward from a central value and ' +
      'stops too soon. Expect stated 90% intervals to capture far less than 90%.',
  },
  'fixed-value': {
    question: 'How likely is it that the quantity is below 500?',
    description:
      'The analyst fixes the value and the judge supplies the probability. The fixed-interval or probability method.',
    knownEffect:
      'Produces WIDER, better-calibrated intervals than fixed-probability for the same judge and quantity, because ' +
      'the judge is not anchored on their own central estimate. The analyst instead chooses the values, which ' +
      'anchors the judge differently: a badly chosen grid is its own bias.',
  },
  'trial-roulette': {
    question: 'You have 20 chips. Distribute them over these bins to show how likely each is.',
    description:
      'The judge allocates a fixed number of chips (a histogram) across bins. Also called chip allocation.',
    knownEffect:
      'The fixed chip count forces the judge to confront the whole distribution at once, which reduces ' +
      'overconfidence relative to fixed-probability. But the ANSWER DEPENDS ON THE BINS: a quantity split into ' +
      'more bins attracts more total probability in the region that was split (partition dependence), and the ' +
      'chip granularity puts a floor on how small a stated probability can be.',
  },
  'probability-wheel': {
    question: 'Set the shaded fraction of this wheel so that you would be indifferent between the two bets.',
    description:
      'A visual, continuous device for a single probability, usually used with an explicit indifference ' +
      'comparison against a reference gamble.',
    knownEffect:
      'Reduces the pull of round numbers and of verbal anchors, and avoids the numeracy failures of asking for ' +
      'percentages. It compresses the extremes: probabilities below about 0.05 and above 0.95 are hard to set and ' +
      'get dragged toward the middle.',
  },
};

export interface FramingEntry {
  framing: Framing;
  quantiles: readonly ElicitedQuantile[];
}

export interface FramingComparison {
  perFraming: {
    framing: Framing;
    impliedMedian: number;
    /** Width of the widest stated interval, in the judge's units. */
    statedWidth: number;
    innerLevel: number;
    outerLevel: number;
    note: string;
  }[];
  /** Spread of the implied medians across framings. */
  medianSpread: number;
  /** Ratio of widest to narrowest stated width across framings. */
  widthRatio: number;
  /** True when the framings disagree by more than the judge's own stated width. */
  framingEffectDetected: boolean;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Compare the same quantity elicited under different framings.
 *
 * There is no "correct" framing to reconcile to. The disagreement IS the
 * result: it bounds how much of the stated number came from the quantity and
 * how much from the question.
 */
export function compareFramings(entries: readonly FramingEntry[]): FramingComparison {
  if (entries.length < 2) {
    throw new EngineError(
      `Comparing framings needs at least two framings of the same quantity; got ${entries.length}. ` +
        'A single framing cannot reveal a framing effect.',
      'too-few',
    );
  }
  const seen = new Set<Framing>();
  for (const e of entries) {
    if (seen.has(e.framing)) {
      throw new EngineError(`The framing "${e.framing}" appears twice; each framing must appear once.`, 'duplicate');
    }
    seen.add(e.framing);
  }
  const perFraming = entries.map((e) => {
    const qs = validateElicitedQuantiles(e.quantiles, `${e.framing} quantiles`);
    if (qs.length < 2) {
      throw new EngineError(
        `The framing "${e.framing}" supplied only ${qs.length} quantile; a width cannot be formed from it.`,
        'too-few',
      );
    }
    const inner = qs[0];
    const outer = qs[qs.length - 1];
    // The median is read off directly when stated, and interpolated on the
    // quantile scale otherwise — never assumed to be the midpoint.
    const exact = qs.find((q) => q.level === 0.5);
    let impliedMedian: number;
    if (exact) impliedMedian = exact.value;
    else {
      const below = [...qs].reverse().find((q) => q.level < 0.5);
      const above = qs.find((q) => q.level > 0.5);
      if (!below || !above) {
        throw new EngineError(
          `The framing "${e.framing}" stated only levels on one side of the median (${qs
            .map((q) => q.level)
            .join(', ')}), so no median can be read off without extrapolating into a region the judge did not speak about.`,
          'insufficient',
        );
      }
      const t = (0.5 - below.level) / (above.level - below.level);
      impliedMedian = below.value + t * (above.value - below.value);
    }
    return {
      framing: e.framing,
      impliedMedian,
      statedWidth: outer.value - inner.value,
      innerLevel: inner.level,
      outerLevel: outer.level,
      note: FRAMING_NOTES[e.framing].knownEffect,
    };
  });
  const medians = perFraming.map((p) => p.impliedMedian);
  const widths = perFraming.map((p) => p.statedWidth);
  const medianSpread = Math.max(...medians) - Math.min(...medians);
  const minWidth = Math.min(...widths);
  const widthRatio = minWidth > 0 ? Math.max(...widths) / minWidth : Infinity;
  const narrowest = perFraming[widths.indexOf(minWidth)];
  const framingEffectDetected = medianSpread > minWidth * 0.1 || widthRatio > 1.25;
  const levelsDiffer = new Set(perFraming.map((p) => `${p.innerLevel}-${p.outerLevel}`)).size > 1;
  const warnings: string[] = [];
  if (levelsDiffer) {
    warnings.push(
      'The framings were elicited at different probability levels, so the stated widths are not directly ' +
        'comparable; the width ratio below mixes a framing effect with a level difference.',
    );
  }
  if (framingEffectDetected) {
    warnings.push(
      `A framing effect is present: the implied medians span ${medianSpread.toPrecision(4)} and the stated ` +
        `widths differ by a factor of ${Number.isFinite(widthRatio) ? widthRatio.toPrecision(3) : '∞'}. ` +
        'Neither framing is the true one. Do not average them silently; report the range.',
    );
  }
  return {
    perFraming,
    medianSpread,
    widthRatio,
    framingEffectDetected,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      `Comparison of ${entries.length} elicitation framings of the same quantity`,
      `The same judge's statements about one quantity under the framings: ${entries.map((e) => e.framing).join(', ')}`,
      [
        'A framing effect is a property of the question, not of the quantity. It cannot be averaged away.',
        `The narrowest answer came from the ${narrowest.framing} framing, which is the framing known to narrow: ${FRAMING_NOTES[narrowest.framing].knownEffect}`,
      ],
    ),
    explanation: {
      method: 'Framing comparison for an elicited quantity',
      steps: [
        ...perFraming.map((p) => ({
          label: p.framing,
          value: `median ${p.impliedMedian.toPrecision(6)}, stated width ${p.statedWidth.toPrecision(6)} over levels ${p.innerLevel}–${p.outerLevel}`,
        })),
        { label: 'Median spread across framings', value: medianSpread.toPrecision(6) },
        { label: 'Width ratio (widest / narrowest)', value: Number.isFinite(widthRatio) ? widthRatio.toPrecision(6) : '∞' },
        { label: 'Framing effect detected', value: framingEffectDetected ? 'yes' : 'not at this threshold' },
      ],
      assumptions: ['The framings were applied to the same quantity by the same judge.'],
      limitations: [
        'Order effects are not separated here: a judge asked under two framings in sequence is anchored by the first.',
        'Two framings bound the effect only in the directions those two framings pull.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Trial roulette / chip allocation                                   */
/* ------------------------------------------------------------------ */

export interface ChipBin {
  lower: number;
  /** Exclusive upper edge; must equal the next bin's lower edge. */
  upper: number;
  chips: number;
}

export interface ChipAllocationResult {
  bins: (ChipBin & {
    /** chips / total chips. */
    statedProbability: number;
    /** Probability the fitted distribution assigns to the same bin. */
    fittedProbability: number;
    residual: number;
  })[];
  totalChips: number;
  /** The smallest non-zero probability the chip count can express. */
  granularity: number;
  /** Cumulative probabilities at the interior bin edges, as fed to the fit. */
  impliedQuantiles: ElicitedQuantile[];
  fit: QuantileFitResult;
  /** Largest absolute difference between a stated and a fitted bin probability. */
  maxBinResidual: number;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Fit a distribution to a chip allocation (trial roulette).
 *
 * The chip counts give the cumulative probability at each INTERIOR bin edge,
 * and those are elicited quantiles, so the same least-squares quantile fit
 * applies. Bins whose cumulative probability is 0 or 1 carry no information
 * about a continuous quantity and are dropped, with the reason reported.
 */
export function fitChipAllocation(
  bins: readonly ChipBin[],
  options: QuantileFitOptions = {},
): ChipAllocationResult {
  if (bins.length < 2) {
    throw new EngineError(
      `A chip allocation needs at least 2 bins to imply a cumulative probability at an interior edge; got ${bins.length}.`,
      'too-few',
    );
  }
  bins.forEach((b, i) => {
    if (!Number.isFinite(b.lower) || !Number.isFinite(b.upper)) {
      throw new EngineError(`Bin ${i} has non-finite edges [${String(b.lower)}, ${String(b.upper)}].`, 'finite');
    }
    if (!(b.upper > b.lower)) {
      throw new EngineError(
        `Bin ${i} has edges [${b.lower}, ${b.upper}], which has zero or negative width. Every bin must have a positive width.`,
        'zero-width',
      );
    }
    if (!Number.isFinite(b.chips) || b.chips < 0 || !Number.isInteger(b.chips)) {
      throw new EngineError(`Bin ${i} has ${String(b.chips)} chips; chips must be a whole number of 0 or more.`, 'integer');
    }
    if (i > 0 && bins[i - 1].upper !== b.lower) {
      throw new EngineError(
        `Bins ${i - 1} and ${i} are not contiguous: bin ${i - 1} ends at ${bins[i - 1].upper} but bin ${i} starts ` +
          `at ${b.lower}. A gap or overlap means the stated probabilities do not form a distribution.`,
        'non-contiguous',
      );
    }
  });
  const totalChips = bins.reduce((a, b) => a + b.chips, 0);
  if (totalChips === 0) {
    throw new EngineError(
      'No chips were allocated, so the judge stated nothing. No distribution is returned.',
      'empty',
    );
  }
  const stated = bins.map((b) => b.chips / totalChips);
  const impliedQuantiles: ElicitedQuantile[] = [];
  const dropped: string[] = [];
  let cumulative = 0;
  for (let i = 0; i < bins.length - 1; i++) {
    cumulative += stated[i];
    if (cumulative <= 0) {
      dropped.push(`edge ${bins[i].upper} (cumulative 0: every chip is above it, which only bounds the support)`);
      continue;
    }
    if (cumulative >= 1) {
      dropped.push(`edge ${bins[i].upper} (cumulative 1: every chip is below it, which only bounds the support)`);
      continue;
    }
    impliedQuantiles.push({ level: cumulative, value: bins[i].upper });
  }
  if (impliedQuantiles.length === 0) {
    throw new EngineError(
      'Every chip sits in a single bin, so no interior edge has a cumulative probability strictly between 0 and 1 ' +
        'and no quantile can be formed. The allocation says only that the quantity lies in one bin; use that bin ' +
        'as a range and a maximum-entropy completion instead.',
      'insufficient',
    );
  }
  const fit = fitElicitedQuantiles(impliedQuantiles, options);
  const def = getDistribution(fit.best.distributionId);
  const resolved = bins.map((b, i) => {
    const fitted = def.cdf(b.upper, fit.best.params) - def.cdf(b.lower, fit.best.params);
    return { ...b, statedProbability: stated[i], fittedProbability: fitted, residual: fitted - stated[i] };
  });
  const maxBinResidual = Math.max(...resolved.map((r) => Math.abs(r.residual)));
  const granularity = 1 / totalChips;
  const warnings = [...fit.warnings];
  if (dropped.length) {
    warnings.push(`Edges dropped as uninformative for a continuous fit: ${dropped.join('; ')}.`);
  }
  if (totalChips < 20) {
    warnings.push(
      `Only ${totalChips} chips were allocated, so the smallest probability the judge could express is ` +
        `${granularity.toPrecision(3)}. Every tail probability below that is an artefact of the fitted family, not ` +
        'something the judge said.',
    );
  }
  if (maxBinResidual > 0.05) {
    warnings.push(
      `The fitted distribution misses a stated bin probability by ${maxBinResidual.toPrecision(3)}. The judge's ` +
        'histogram has a shape (bimodal, or a spike) that no fitted family reproduces.',
    );
  }
  return {
    bins: resolved,
    totalChips,
    granularity,
    impliedQuantiles,
    fit,
    maxBinResidual,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Trial roulette (chip allocation) converted to cumulative probabilities and fitted by least squares on the quantile scale',
      `${totalChips} chips placed by a judge across ${bins.length} bins spanning [${bins[0].lower}, ${bins[bins.length - 1].upper}]`,
      [
        FRAMING_NOTES['trial-roulette'].knownEffect,
        `The chip count limits the resolution to ${granularity.toPrecision(3)}; nothing finer was stated.`,
        'The bin edges were chosen by the analyst. Different edges would have produced a different histogram from the same judge.',
      ],
    ),
    explanation: {
      method: 'Distribution fitted to a chip allocation',
      formula: 'P(X ≤ edge_i) = (Σ_{j ≤ i} chips_j) / totalChips, then least squares on the quantile scale',
      steps: [
        { label: 'Chips', value: `${totalChips} across ${bins.length} bins` },
        { label: 'Implied interior quantiles', value: impliedQuantiles.map((q) => `${q.level.toPrecision(4)} → ${q.value}`).join('; ') },
        { label: 'Fitted family', value: `${fit.best.distributionName} (${fit.best.distributionId})` },
        { label: 'Largest bin-probability residual', value: maxBinResidual.toPrecision(4) },
      ],
      assumptions: [
        'Each chip represents an equal share of the judge’s belief and the bins are exhaustive.',
        'The quantity is continuous within each bin; the fit says nothing about the shape inside a bin.',
      ],
      limitations: [
        'Partition dependence: splitting a bin in two typically attracts more total probability to that region.',
        'The granularity floor means the fitted tails are supplied by the family, not by the judge.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Protocol drivers: the next question to ask                          */
/* ------------------------------------------------------------------ */

export interface NextQuestion {
  protocol: 'bisection' | 'fixed-interval';
  /** True when the protocol has nothing further to ask. */
  done: boolean;
  /** The question, ready to show. Empty when done. */
  prompt: string;
  /** Bisection: the cumulative probability the judge should supply a value for. */
  targetLevel?: number;
  /** Fixed-interval: the value the judge should supply a probability for. */
  targetValue?: number;
  /** Bisection: the bracket being split, so the interface can show the context. */
  bracket?: { lowLevel: number; lowValue: number; highLevel: number; highValue: number };
  /** How many questions have been answered so far. */
  answered: number;
  rationale: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
}

export interface BisectionOptions {
  /** Stop after this many answers. Default 7 (median, quartiles, octiles). */
  maxQuestions?: number;
  /** Stop splitting a bracket narrower than this in probability. Default 0.05. */
  minLevelGap?: number;
}

/**
 * The next question in a bisection protocol.
 *
 * The protocol is: the median first, then recursively the median of the widest
 * remaining probability bracket. Asking the median first is deliberate — the
 * alternative, asking for the extremes first, anchors the judge on their own
 * extremes and reproducibly narrows everything afterwards.
 *
 * Brackets are split in PROBABILITY, not in value, so each answer carries the
 * same amount of information.
 */
export function nextBisectionQuestion(
  answers: readonly ElicitedQuantile[],
  options: BisectionOptions = {},
): NextQuestion {
  const maxQuestions = options.maxQuestions ?? 7;
  if (!Number.isInteger(maxQuestions) || maxQuestions < 1) {
    throw new EngineError(`maxQuestions must be a whole number of at least 1; got ${maxQuestions}.`, 'integer');
  }
  const minLevelGap = options.minLevelGap ?? 0.05;
  if (!(minLevelGap > 0 && minLevelGap < 0.5)) {
    throw new EngineError(`minLevelGap must lie in (0, 0.5); got ${minLevelGap}.`, 'range');
  }
  const qs = answers.length ? validateElicitedQuantiles(answers, 'bisection answers') : [];
  const basis = judgementBasis(
    'Bisection protocol driver',
    qs.length
      ? `${qs.length} value${qs.length === 1 ? '' : 's'} already supplied by the judge at the levels ${qs.map((q) => q.level).join(', ')}`
      : 'No judgements yet; the protocol has not started',
    [
      'The median is asked first on purpose. Asking for the extremes first anchors the judge and narrows every later answer.',
      'Bisection is a fixed-probability framing, which is the framing that produces the narrowest intervals. Measure the judge’s hit rate before trusting the width.',
      'Each answer is conditioned on the judge remembering their earlier answers, so the later answers are not independent judgements.',
    ],
  );
  const common = { protocol: 'bisection' as const, answered: qs.length, exactness: JUDGEMENT_EXACTNESS, basis };

  if (qs.length === 0) {
    return {
      ...common,
      done: false,
      prompt:
        'What value is the quantity equally likely to be above or below? (Your median: you would take either side of that bet.)',
      targetLevel: 0.5,
      rationale:
        'The median is the first question in a bisection protocol: it is the judgement people make most reliably, ' +
        'and it fixes the centre before any extreme can anchor it.',
    };
  }
  if (qs.length >= maxQuestions) {
    return {
      ...common,
      done: true,
      prompt: '',
      rationale: `The protocol stops at ${maxQuestions} answers. Fit a distribution to them now.`,
    };
  }
  // Brackets between consecutive answered levels, plus the two outer brackets
  // against the (never-asked) 0 and 1.
  const levels = [0, ...qs.map((q) => q.level), 1];
  let bestIndex = -1;
  let bestGap = 0;
  for (let i = 1; i < levels.length; i++) {
    const gap = levels[i] - levels[i - 1];
    if (gap > bestGap) {
      bestGap = gap;
      bestIndex = i;
    }
  }
  if (bestGap <= minLevelGap * 2) {
    return {
      ...common,
      done: true,
      prompt: '',
      rationale:
        `Every remaining probability bracket is narrower than ${(minLevelGap * 2).toPrecision(3)}, so a further ` +
        'split would ask the judge to distinguish probabilities they cannot distinguish. The protocol stops here.',
    };
  }
  const lowLevel = levels[bestIndex - 1];
  const highLevel = levels[bestIndex];
  const targetLevel = (lowLevel + highLevel) / 2;
  const lowValue = lowLevel === 0 ? -Infinity : qs[bestIndex - 2].value;
  const highValue = highLevel === 1 ? Infinity : qs[bestIndex - 1].value;
  const describe = (x: number): string => (Number.isFinite(x) ? x.toPrecision(6) : x > 0 ? 'the upper end' : 'the lower end');
  const prompt =
    Number.isFinite(lowValue) && Number.isFinite(highValue)
      ? `You said the quantity lies between ${describe(lowValue)} and ${describe(highValue)} with probability ${(
          highLevel - lowLevel
        ).toPrecision(3)}. What value splits THAT range so the quantity is equally likely to fall in either half of it?`
      : Number.isFinite(highValue)
        ? `You said there is a ${highLevel.toPrecision(3)} chance the quantity is below ${describe(highValue)}. What value is it half as likely to be below — i.e. your ${targetLevel.toPrecision(3)} value?`
        : `You said there is a ${(1 - lowLevel).toPrecision(3)} chance the quantity is above ${describe(lowValue)}. What value splits that upper range in half — i.e. your ${targetLevel.toPrecision(3)} value?`;
  return {
    ...common,
    done: false,
    prompt,
    targetLevel,
    bracket: { lowLevel, lowValue, highLevel, highValue },
    rationale:
      `The widest unsplit probability bracket is (${lowLevel.toPrecision(3)}, ${highLevel.toPrecision(3)}), worth ` +
      `${bestGap.toPrecision(3)} of probability. Splitting the widest bracket means each answer buys the most ` +
      'information, and splitting in probability rather than in value keeps the answers comparable.',
  };
}

export interface FixedIntervalOptions {
  /** How many values to ask about across the range. Default 5. */
  points?: number;
}

/**
 * The next question in a fixed-interval protocol: the analyst names a value,
 * the judge supplies the probability.
 *
 * This is the framing that produces better-calibrated widths, at the cost of
 * moving the anchoring from the judge's own central estimate onto the
 * analyst's choice of grid. The grid is reported for exactly that reason.
 */
export function nextFixedIntervalQuestion(
  answered: readonly ElicitedQuantile[],
  range: { lower: number; upper: number },
  options: FixedIntervalOptions = {},
): NextQuestion {
  if (!Number.isFinite(range.lower) || !Number.isFinite(range.upper)) {
    throw new EngineError(
      `The fixed-interval grid needs a finite plausible range; got [${String(range.lower)}, ${String(range.upper)}].`,
      'finite',
    );
  }
  if (!(range.upper > range.lower)) {
    throw new EngineError(
      `The plausible range [${range.lower}, ${range.upper}] has zero or negative width, so no grid of distinct ` +
        'values can be formed.',
      'zero-width',
    );
  }
  const points = options.points ?? 5;
  if (!Number.isInteger(points) || points < 2) {
    throw new EngineError(`points must be a whole number of at least 2; got ${points}.`, 'integer');
  }
  // Interior grid points only: the endpoints of a "plausible range" invite the
  // answers 0 and 1, which constrain nothing.
  const grid = linspace(range.lower, range.upper, points + 2).slice(1, -1);
  const askedValues = new Set(answered.map((a) => a.value));
  const basis = judgementBasis(
    'Fixed-interval (fixed-value) protocol driver',
    answered.length
      ? `${answered.length} probability judgement${answered.length === 1 ? '' : 's'} already supplied at the values ${answered.map((a) => a.value).join(', ')}`
      : 'No judgements yet; the protocol has not started',
    [
      FRAMING_NOTES['fixed-value'].knownEffect,
      `The grid ${grid.map((g) => g.toPrecision(6)).join(', ')} was chosen by the analyst from the stated plausible ` +
        `range [${range.lower}, ${range.upper}]. A different range would anchor the judge differently and change the answers.`,
    ],
  );
  const common = { protocol: 'fixed-interval' as const, answered: answered.length, exactness: JUDGEMENT_EXACTNESS, basis };
  const next = grid.find((g) => !askedValues.has(g));
  if (next === undefined) {
    return {
      ...common,
      done: true,
      prompt: '',
      rationale: `All ${grid.length} grid values have been answered. Fit a distribution to them now.`,
    };
  }
  return {
    ...common,
    done: false,
    prompt: `What is the probability that the quantity is at most ${next.toPrecision(6)}?`,
    targetValue: next,
    rationale:
      `Grid value ${grid.indexOf(next) + 1} of ${grid.length}, taken from the interior of the stated plausible range. ` +
      'The endpoints are deliberately not asked: they invite the answers 0 and 1, which constrain no distribution.',
  };
}

/**
 * Convert fixed-interval answers (a probability at each analyst-chosen value)
 * into elicited quantiles, so the same fit applies.
 *
 * Refuses a probability of exactly 0 or 1, naming the value: those are
 * statements of certainty and the quantile validator rejects them for the same
 * reason.
 */
export function quantilesFromFixedInterval(
  answers: readonly { value: number; probability: number }[],
): ElicitedQuantile[] {
  if (answers.length === 0) {
    throw new EngineError('No fixed-interval answers were given, so no quantiles can be formed.', 'empty');
  }
  const qs: ElicitedQuantile[] = answers.map((a, i) => {
    if (!Number.isFinite(a.probability)) {
      throw new EngineError(`Answer ${i} (value ${a.value}) has the non-finite probability ${String(a.probability)}.`, 'finite');
    }
    if (!(a.probability > 0 && a.probability < 1)) {
      throw new EngineError(
        `The judge gave probability ${a.probability} at the value ${a.value}. A probability of exactly 0 or 1 is a ` +
          'statement of certainty and constrains no continuous distribution; it must be excluded or re-asked.',
        'range',
      );
    }
    return { level: a.probability, value: a.value };
  });
  return validateElicitedQuantiles(qs, 'fixed-interval answers');
}

/* ------------------------------------------------------------------ */
/* Probability wheel                                                  */
/* ------------------------------------------------------------------ */

export interface ProbabilityWheelResult {
  /** The probability the shaded fraction represents. */
  probability: number;
  /** The shaded fraction as read off the wheel, before any snapping. */
  shadedFraction: number;
  /** The wheel's angular resolution, as a probability. */
  resolution: number;
  /** Equivalent expressions, because the format changes how the number reads. */
  asPercentage: string;
  asFrequency: string;
  asOdds: string;
  /** True in the compression zone where a wheel is known to be unreliable. */
  inCompressionZone: boolean;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Read a probability off a probability wheel, with the wheel's own resolution
 * and the known compression of the extremes reported alongside.
 */
export function readProbabilityWheel(
  shadedFraction: number,
  options: { sectors?: number } = {},
): ProbabilityWheelResult {
  if (!Number.isFinite(shadedFraction)) {
    throw new EngineError(`The shaded fraction ${String(shadedFraction)} is not a finite number.`, 'finite');
  }
  if (shadedFraction < 0 || shadedFraction > 1) {
    throw new EngineError(
      `The shaded fraction must lie in [0, 1]; got ${shadedFraction}. A wheel cannot show a fraction outside its own area.`,
      'range',
    );
  }
  const sectors = options.sectors ?? 100;
  if (!Number.isInteger(sectors) || sectors < 2) {
    throw new EngineError(`sectors must be a whole number of at least 2; got ${sectors}.`, 'integer');
  }
  const resolution = 1 / sectors;
  const p = shadedFraction;
  const inCompressionZone = p < 0.05 || p > 0.95;
  const warnings: string[] = [];
  if (inCompressionZone) {
    warnings.push(
      `The wheel reads ${p.toPrecision(3)}, inside the zone below 0.05 or above 0.95 where a wheel is known to ` +
        'compress: judges cannot set these sectors accurately and the answers are dragged toward the middle. ' +
        'Re-elicit an extreme probability as a frequency ("how many times in 1000?") instead.',
    );
  }
  if (p > 0 && p < resolution) {
    warnings.push(
      `The reading ${p.toPrecision(3)} is finer than the wheel's own resolution of ${resolution.toPrecision(3)}; ` +
        'the extra digits are not something the judge could have set.',
    );
  }
  const odds = p === 0 ? '0 : 1' : p === 1 ? '1 : 0' : `${(p / (1 - p)).toPrecision(4)} : 1`;
  const frequency = p === 0 ? '0 in 1000' : `about ${Math.round(p * 1000)} in 1000`;
  return {
    probability: p,
    shadedFraction,
    resolution,
    asPercentage: `${(p * 100).toPrecision(4)}%`,
    asFrequency: frequency,
    asOdds: odds,
    inCompressionZone,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Probability wheel reading',
      `A judge set a wheel of ${sectors} sectors to a shaded fraction of ${shadedFraction}`,
      [
        FRAMING_NOTES['probability-wheel'].knownEffect,
        `Nothing finer than ${resolution.toPrecision(3)} was expressible on this wheel.`,
      ],
    ),
    explanation: {
      method: 'Probability wheel (visual analogue) reading',
      steps: [
        { label: 'Shaded fraction', value: shadedFraction.toPrecision(6) },
        { label: 'Wheel resolution', value: resolution.toPrecision(6) },
        { label: 'As a percentage', value: `${(p * 100).toPrecision(4)}%` },
        { label: 'As a frequency', value: frequency },
        { label: 'As odds', value: odds },
      ],
      assumptions: ['The judge set the wheel by indifference against a reference gamble, not by converting a number they already had in mind.'],
      limitations: [
        'A wheel compresses the extremes: probabilities below 0.05 and above 0.95 cannot be set reliably.',
        'The three expressions above are the same number; judges give different answers depending on which one they are shown, so showing all three is a check, not a decoration.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/** Total of a probability vector, used by the coherence checks. Exposed for reuse. */
export function sumProbabilities(values: readonly number[]): number {
  return stableSum(values);
}
