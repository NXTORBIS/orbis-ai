/**
 * Elicitation: turning human judgement into a usable probability distribution,
 * and measuring whether the judgement was any good.
 *
 * WHY THIS MODULE CARRIES ITS OWN EXACTNESS CONVENTION
 * ----------------------------------------------------
 * The engine's `Exactness` has four values. Three of them (`exact`,
 * `numerical`, `empirical`) describe a computation or an observation. The
 * fourth, `assumed`, describes an *opinion*, and until now nothing in the
 * engine produced it deliberately. Yet most real inputs to this application
 * are opinions: a rate somebody estimated, a probability somebody asserted.
 *
 * Every result-producing function in this module therefore returns a value
 * carrying `exactness: 'assumed'` AND a `JudgementBasis` naming the judgement
 * it rests on, the protocol that collected it and the biases known to affect
 * that protocol. A number derived from an opinion must never be presented with
 * the authority of a measurement, and here that is enforced by the type.
 *
 * The arithmetic inside is ordinary numerical mathematics and is as accurate
 * as anywhere else in the engine. `assumed` is not a claim about the
 * arithmetic; it is a claim about the *input*, and the input dominates.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';

/** Every result in this module is `assumed`. There is no other option. */
export type JudgementExactness = 'assumed';

export const JUDGEMENT_EXACTNESS: JudgementExactness = 'assumed';

/**
 * Why a number is only as good as the judgement under it.
 *
 * `restsOn` is deliberately prose: it is what the interface shows next to the
 * number so the reader knows whose opinion they are looking at.
 */
export interface JudgementBasis {
  exactness: JudgementExactness;
  /** The human judgement the number rests on, in words. */
  restsOn: string;
  /** The elicitation protocol or aggregation rule applied to it. */
  method: string;
  /** Biases and limitations known to affect this protocol. Never empty. */
  caveats: string[];
}

/** Caveats that apply to EVERY elicited quantity, whatever the protocol. */
export const UNIVERSAL_ELICITATION_CAVEATS: readonly string[] = [
  'This is an expressed opinion, not a measurement. Its accuracy is bounded by the judge, not by the arithmetic.',
  'Elicited intervals are systematically too narrow: stated 90% intervals typically capture 30–60% of outcomes. Correct with a measured hit rate before using the width.',
  'The elicitation format changes the answer. The same person asked the same question in a different framing gives a different number, reproducibly.',
];

export function judgementBasis(method: string, restsOn: string, caveats: readonly string[] = []): JudgementBasis {
  return {
    exactness: JUDGEMENT_EXACTNESS,
    restsOn,
    method,
    caveats: [...UNIVERSAL_ELICITATION_CAVEATS, ...caveats],
  };
}

/** The common shape of every result this module produces. */
export interface JudgementResult {
  exactness: JudgementExactness;
  basis: JudgementBasis;
  warnings: string[];
}

/** A stated quantile: "I am `level` sure that the quantity is at most `value`". */
export interface ElicitedQuantile {
  /** Cumulative probability, strictly inside (0, 1). */
  level: number;
  /** The value the judge attached to that probability. */
  value: number;
}

/**
 * Validate and sort a set of elicited quantiles.
 *
 * Refuses, by name:
 *  - a level at or outside (0, 1) — 0 and 1 carry no information about a
 *    continuous quantity and cannot be matched by any unbounded family;
 *  - a repeated level with two different values (the judge contradicted
 *    themselves and no number can be chosen between them);
 *  - a non-monotone pair, naming the offending pair;
 *  - two distinct levels sharing a value, i.e. a stated interval of zero
 *    width, which asserts certainty and cannot be fitted.
 */
export function validateElicitedQuantiles(
  quantiles: readonly ElicitedQuantile[],
  field = 'quantiles',
): ElicitedQuantile[] {
  if (quantiles.length === 0) {
    throw new EngineError(`No elicited quantiles were given in ${field}; there is nothing to fit.`, 'empty');
  }
  quantiles.forEach((q, i) => {
    if (!Number.isFinite(q.level)) {
      throw new EngineError(`${field}[${i}] has the non-finite probability level ${String(q.level)}.`, 'finite');
    }
    if (!(q.level > 0 && q.level < 1)) {
      throw new EngineError(
        `${field}[${i}] has the probability level ${q.level}, which is outside the open interval (0, 1). ` +
          'A level of exactly 0 or 1 states certainty and constrains no continuous distribution; state an ' +
          'interior level such as 0.05 or 0.95 instead.',
        'range',
      );
    }
    if (!Number.isFinite(q.value)) {
      throw new EngineError(
        `${field}[${i}] (level ${q.level}) has the non-finite value ${String(q.value)}.`,
        'finite',
      );
    }
  });
  const sorted = [...quantiles].sort((a, b) => a.level - b.level);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a.level === b.level) {
      if (a.value !== b.value) {
        throw new EngineError(
          `The level ${a.level} was stated twice with different values (${a.value} and ${b.value}). ` +
            'These cannot both be true; no distribution is returned.',
          'contradiction',
        );
      }
      continue;
    }
    if (b.value < a.value) {
      throw new EngineError(
        `The elicited quantiles are not monotone: level ${a.level} was given the value ${a.value} but the ` +
          `higher level ${b.level} was given the smaller value ${b.value}. A cumulative distribution cannot ` +
          'decrease, so this pair is the offending one and must be corrected before any fit.',
        'non-monotone',
      );
    }
    if (b.value === a.value) {
      throw new EngineError(
        `Levels ${a.level} and ${b.level} were both given the value ${a.value}, so the stated interval ` +
          `between them has zero width. That asserts ${((b.level - a.level) * 100).toPrecision(3)}% of the ` +
          'probability sits on a single point, which no continuous family can represent. Widen the interval ' +
          'or state fewer levels.',
        'zero-width',
      );
    }
  }
  // Collapse exact duplicates (same level, same value) after the checks above.
  const out: ElicitedQuantile[] = [];
  for (const q of sorted) {
    if (out.length === 0 || out[out.length - 1].level !== q.level) out.push({ level: q.level, value: q.value });
  }
  return out;
}

/**
 * The three-point elicitation everybody actually uses: a median and a credible
 * interval. `level` is the interval's central probability (0.9 for a 5–95
 * interval).
 */
export function quantilesFromInterval(
  median: number,
  lower: number,
  upper: number,
  level = 0.9,
): ElicitedQuantile[] {
  if (!(level > 0 && level < 1)) {
    throw new EngineError(`The credible level must lie in (0, 1); got ${level}.`, 'range');
  }
  const tail = (1 - level) / 2;
  return validateElicitedQuantiles([
    { level: tail, value: lower },
    { level: 0.5, value: median },
    { level: 1 - tail, value: upper },
  ]);
}

/** Guard: an `Exactness` from a reused sibling module, narrowed to this module's convention. */
export function asJudgement(_inner: Exactness): JudgementExactness {
  // The inner computation may be exact or numerical; the RESULT is still an
  // opinion, because the input was. The inner exactness is kept in the
  // provenance of whatever sibling produced it and is not promoted here.
  return JUDGEMENT_EXACTNESS;
}
