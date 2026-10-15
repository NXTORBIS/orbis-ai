/**
 * Measuring whether a judge is any good.
 *
 * Everything above turns an opinion into a distribution. This file is the part
 * that finds out whether the opinion was worth anything, which is the only
 * thing that makes the rest usable: a stated 90% interval is a claim about the
 * world that can be checked, and when checked it is usually wrong in a known
 * direction and by a measurable amount.
 *
 * The scoring rules themselves live in `src/engine/information/scoring.ts` and
 * are reused here unchanged (Brier with the Murphy decomposition, the log
 * score, calibration/reliability curves, the PIT histogram, skill against
 * climatology). What this file adds is the elicitation-specific part: interval
 * hit rates, the calibration-corrected interval width, and an honest statement
 * of how little a short record can tell you.
 */
import { EngineError, type Explanation } from '../core/result';
import { stableSum } from '../core/numeric';
import { wilsonInterval, type Interval } from '../stats/descriptive';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import {
  brierScore,
  calibration,
  climatologyBrier,
  logScore,
  pitHistogram,
  skillScore,
  type BrierResult,
  type CalibrationResult,
  type LogScoreResult,
  type PitResult,
  type SkillScoreResult,
} from '../information/scoring';
import { judgementBasis, JUDGEMENT_EXACTNESS, type JudgementBasis, type JudgementExactness } from './types';

const NORMAL = getDistribution('normal');
const STANDARD: Params = { mu: 0, sigma: 1 };

/** Φ⁻¹: the standard normal quantile. */
function z(p: number): number {
  return NORMAL.quantile(p, STANDARD);
}

/** The half-width multiplier for a central interval of probability `level`. */
function zForCentralLevel(level: number): number {
  return z(0.5 + level / 2);
}

/* ------------------------------------------------------------------ */
/* Interval calibration and overconfidence                            */
/* ------------------------------------------------------------------ */

export interface StatedInterval {
  label?: string;
  lower: number;
  upper: number;
  /** The central probability the judge attached to the interval, e.g. 0.9. */
  nominalLevel: number;
}

export type IntervalDiagnosis = 'too narrow' | 'too wide' | 'consistent with nominal';

export interface IntervalCalibrationResult {
  n: number;
  nominalLevel: number;
  /** How many outcomes actually fell inside the stated interval. */
  hits: number;
  hitRate: number;
  /** nominalLevel − hitRate. Positive is overconfidence. */
  shortfall: number;
  /** Wilson interval for the realised hit rate: the uncertainty in this measurement. */
  hitRateInterval: Interval;
  /** True when the nominal level lies outside the hit rate's confidence interval. */
  significantlyMiscalibrated: boolean;
  diagnosis: IntervalDiagnosis;
  /**
   * Multiply every stated interval width by this to reach the nominal
   * coverage, under the normal-shape assumption documented below. Greater than
   * 1 means the judge's intervals must be widened.
   */
  correctedWidthMultiplier: number;
  /** The stated intervals rescaled about their own midpoints by that multiplier. */
  correctedIntervals: { label?: string; lower: number; upper: number; width: number }[];
  /** Indices of the outcomes that fell outside their interval, and on which side. */
  misses: { index: number; label?: string; side: 'below' | 'above'; distance: number }[];
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Measure the realised hit rate of stated intervals and estimate how much too
 * narrow they were.
 *
 * THE CORRECTION
 * --------------
 * A stated central interval of level L has half-width h. If the judge's real
 * uncertainty were normal with standard deviation σ, a well-calibrated
 * half-width would be h* = z_L·σ. The realised coverage c tells us what the
 * stated half-width actually corresponds to: h = z_c·σ. Dividing,
 *
 *     h* / h = z_L / z_c
 *
 * so the stated widths must be multiplied by z_L/z_c. A judge whose stated 90%
 * intervals capture 59% of outcomes has z_0.9/z_0.59 ≈ 1.645/0.824 ≈ 2.0: their
 * intervals are half as wide as they should be.
 *
 * The normal shape is an ASSUMPTION and it is the weakest part of this
 * calculation. It is stated rather than hidden, and the raw hit rate is
 * reported alongside so the correction can be ignored.
 */
export function intervalCalibration(
  intervals: readonly StatedInterval[],
  outcomes: ArrayLike<number>,
): IntervalCalibrationResult {
  const n = intervals.length;
  if (n === 0) {
    throw new EngineError('No stated intervals were given, so no hit rate can be measured.', 'empty');
  }
  if (outcomes.length !== n) {
    throw new EngineError(
      `There are ${n} stated intervals but ${outcomes.length} outcomes. Each interval needs exactly one realised value.`,
      'length',
    );
  }
  const levels = new Set<number>();
  intervals.forEach((iv, i) => {
    const name = iv.label ? `"${iv.label}"` : `interval ${i}`;
    if (!Number.isFinite(iv.lower) || !Number.isFinite(iv.upper)) {
      throw new EngineError(`${name} has non-finite bounds [${String(iv.lower)}, ${String(iv.upper)}].`, 'finite');
    }
    if (iv.upper < iv.lower) {
      throw new EngineError(
        `${name} has bounds [${iv.lower}, ${iv.upper}], whose upper bound is below its lower bound.`,
        'crossed-bounds',
      );
    }
    if (iv.upper === iv.lower) {
      throw new EngineError(
        `${name} has zero width (both bounds are ${iv.lower}). A zero-width interval claims the outcome is known ` +
          `exactly with probability ${iv.nominalLevel}, which cannot be scored as an interval and almost certainly ` +
          'means the judge was not asked for an interval at all.',
        'zero-width',
      );
    }
    if (!(iv.nominalLevel > 0 && iv.nominalLevel < 1)) {
      throw new EngineError(
        `${name} has the nominal level ${iv.nominalLevel}, outside (0, 1). An interval of level 0 or 1 makes no ` +
          'checkable claim.',
        'range',
      );
    }
    if (!Number.isFinite(outcomes[i])) {
      throw new EngineError(`The outcome for ${name} is ${String(outcomes[i])}, which is not a finite number.`, 'finite');
    }
    levels.add(iv.nominalLevel);
  });
  if (levels.size > 1) {
    throw new EngineError(
      `The stated intervals mix the nominal levels ${[...levels].join(', ')}. A single hit rate across different ` +
        'nominal levels is not interpretable; group the intervals by level and call this once per level.',
      'mixed-levels',
    );
  }
  const nominalLevel = intervals[0].nominalLevel;
  const misses: { index: number; label?: string; side: 'below' | 'above'; distance: number }[] = [];
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const y = outcomes[i];
    const iv = intervals[i];
    if (y >= iv.lower && y <= iv.upper) hits++;
    else if (y < iv.lower) misses.push({ index: i, label: iv.label, side: 'below', distance: iv.lower - y });
    else misses.push({ index: i, label: iv.label, side: 'above', distance: y - iv.upper });
  }
  const hitRate = hits / n;
  const shortfall = nominalLevel - hitRate;
  const hitRateInterval = wilsonInterval(hits, n, 0.95);
  const significantlyMiscalibrated = nominalLevel < hitRateInterval.low || nominalLevel > hitRateInterval.high;
  const diagnosis: IntervalDiagnosis = !significantlyMiscalibrated
    ? 'consistent with nominal'
    : hitRate < nominalLevel
      ? 'too narrow'
      : 'too wide';

  const zNominal = zForCentralLevel(nominalLevel);
  let correctedWidthMultiplier: number;
  if (hits === 0) {
    throw new EngineError(
      `None of the ${n} outcomes fell inside its stated interval. The realised coverage is 0, so the implied ` +
        'normal scale is infinite and no finite correction factor exists. This judge’s intervals carry no ' +
        'information about the width; re-elicit rather than rescale.',
      'degenerate',
    );
  }
  if (hits === n) {
    correctedWidthMultiplier = NaN;
  } else {
    correctedWidthMultiplier = zNominal / zForCentralLevel(hitRate);
  }
  const multiplier = Number.isFinite(correctedWidthMultiplier) ? correctedWidthMultiplier : 1;
  const correctedIntervals = intervals.map((iv) => {
    const mid = (iv.lower + iv.upper) / 2;
    const half = ((iv.upper - iv.lower) / 2) * multiplier;
    return { label: iv.label, lower: mid - half, upper: mid + half, width: 2 * half };
  });

  const warnings: string[] = [];
  if (n < 20) {
    warnings.push(
      `This hit rate rests on ${n} intervals. Its 95% confidence interval is ` +
        `[${hitRateInterval.low.toPrecision(3)}, ${hitRateInterval.high.toPrecision(3)}], which is ` +
        `${(hitRateInterval.high - hitRateInterval.low).toPrecision(3)} wide — wide enough that the correction ` +
        'factor below is barely more than a guess. Treat it as a direction, not a number.',
    );
  }
  if (diagnosis === 'too narrow') {
    warnings.push(
      `OVERCONFIDENCE: stated ${(nominalLevel * 100).toPrecision(3)}% intervals captured only ` +
        `${(hitRate * 100).toPrecision(3)}% of outcomes, a shortfall of ${(shortfall * 100).toPrecision(3)} ` +
        `percentage points. Under a normal shape the stated widths are a factor of ` +
        `${correctedWidthMultiplier.toPrecision(4)} too small. This is the expected direction and typical magnitude ` +
        'for an unpractised judge.',
    );
  }
  if (diagnosis === 'too wide') {
    warnings.push(
      `UNDERCONFIDENCE: stated ${(nominalLevel * 100).toPrecision(3)}% intervals captured ` +
        `${(hitRate * 100).toPrecision(3)}% of outcomes. This is the unusual direction; check that the questions ` +
        'were genuinely uncertain to the judge and that the intervals were not widened after seeing the outcomes.',
    );
  }
  if (hits === n) {
    warnings.push(
      `Every one of the ${n} outcomes fell inside its interval, so the realised coverage is 1 and no finite width ` +
        'correction can be computed (the implied normal scale is 0). The intervals are at least wide enough; how ' +
        'much too wide cannot be said from a record with no misses.',
    );
  }
  const belowCount = misses.filter((m) => m.side === 'below').length;
  const aboveCount = misses.length - belowCount;
  if (misses.length >= 5 && Math.min(belowCount, aboveCount) === 0) {
    warnings.push(
      `All ${misses.length} misses fell on the ${belowCount ? 'low' : 'high'} side. That is a BIAS, not just ` +
        `narrowness: widening the intervals would not fix it. The judge's central estimates are systematically ` +
        `${belowCount ? 'too high' : 'too low'}.`,
    );
  }

  return {
    n,
    nominalLevel,
    hits,
    hitRate,
    shortfall,
    hitRateInterval,
    significantlyMiscalibrated,
    diagnosis,
    correctedWidthMultiplier,
    correctedIntervals,
    misses,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Realised hit rate of stated intervals, with a normal-shape width correction',
      `${n} intervals stated by a judge at the ${nominalLevel} level, checked against ${n} known outcomes`,
      [
        'The correction factor assumes the judge’s real uncertainty is normal in shape. If their errors are heavy-tailed, the factor understates how much the intervals must widen.',
        'A hit rate measured on one set of questions transfers to another set only as far as the questions are comparable in difficulty.',
        'Rescaling the intervals fixes the width, not the centre. A biased centre needs a separate correction.',
      ],
    ),
    explanation: {
      method: 'Interval calibration: realised coverage and the implied width correction',
      formula: 'multiplier = z_L / z_c, where z_p = Φ⁻¹((1+p)/2), L is the nominal level and c the realised hit rate',
      steps: [
        { label: 'Intervals checked', value: String(n) },
        { label: 'Nominal level', value: nominalLevel.toPrecision(6) },
        { label: 'Hits', value: `${hits} of ${n}` },
        { label: 'Realised hit rate', value: hitRate.toPrecision(6) },
        { label: '95% interval for the hit rate', value: `[${hitRateInterval.low.toPrecision(6)}, ${hitRateInterval.high.toPrecision(6)}]` },
        { label: 'Shortfall below nominal', value: shortfall.toPrecision(6) },
        { label: 'Diagnosis', value: diagnosis },
        { label: 'z at the nominal level', value: zNominal.toPrecision(8) },
        { label: 'Width multiplier needed', value: Number.isFinite(correctedWidthMultiplier) ? correctedWidthMultiplier.toPrecision(8) : 'not computable (no misses)' },
        { label: 'Misses', value: misses.length ? `${belowCount} below, ${aboveCount} above` : 'none' },
      ],
      assumptions: [
        'The outcomes were unknown to the judge when the intervals were stated.',
        'The judge’s uncertainty has a normal shape, which is what makes the single multiplier meaningful.',
        'The questions are exchangeable in difficulty, so one hit rate describes them all.',
      ],
      limitations: [
        'A hit rate from a short record is extremely noisy; see the warnings for its confidence interval.',
        'Coverage says nothing about the centres. A judge can hit the nominal rate with intervals that are both too wide and badly positioned.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* Calibration uncertainty: how little a short record says            */
/* ------------------------------------------------------------------ */

export interface CalibrationUncertaintyResult {
  n: number;
  bins: number;
  /** Standard error of an observed frequency at the given mean forecast. */
  standardError: number;
  /** 95% interval for a frequency observed at that mean forecast. */
  frequencyInterval: Interval;
  /**
   * The ECE a PERFECTLY calibrated judge would show at this n and bin count,
   * from sampling noise alone. An observed ECE below this is evidence of
   * nothing.
   */
  eceNoiseFloor: number;
  /** Width of the 95% interval for the hit rate of a 0.9 interval at this n. */
  hitRateIntervalWidth: number;
  /** True only when the record is long enough for a calibration claim to mean something. */
  sufficient: boolean;
  verdict: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * How much calibration a record of length n can actually establish.
 *
 * A calibration estimate from 12 questions says almost nothing, and saying so
 * is more useful than reporting the estimate. The noise floor below is the ECE
 * that a perfectly calibrated judge would show by chance:
 *
 *     E|ō_k − p̄_k| = σ_k·√(2/π) with σ_k = √(p̄_k(1−p̄_k)/n_k)
 *
 * summed over bins with weight n_k/n. It falls as 1/√n and RISES with the bin
 * count, which is why a reliability diagram with many bins on a short record
 * looks alarming and means nothing.
 */
export function calibrationUncertainty(
  n: number,
  options: { bins?: number; meanForecast?: number; level?: number } = {},
): CalibrationUncertaintyResult {
  if (!Number.isInteger(n) || n < 1) {
    throw new EngineError(`The number of scored judgements must be a whole number of at least 1; got ${n}.`, 'integer');
  }
  const bins = options.bins ?? 10;
  if (!Number.isInteger(bins) || bins < 1) {
    throw new EngineError(`bins must be a whole number of at least 1; got ${bins}.`, 'integer');
  }
  const meanForecast = options.meanForecast ?? 0.5;
  if (!(meanForecast > 0 && meanForecast < 1)) {
    throw new EngineError(`meanForecast must lie in (0, 1); got ${meanForecast}.`, 'range');
  }
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`level must lie in (0, 1); got ${level}.`, 'range');

  const perBin = n / bins;
  const variance = meanForecast * (1 - meanForecast);
  const standardError = Math.sqrt(variance / n);
  // E|X| for X ~ N(0, σ²) is σ√(2/π); the bins are taken as equally occupied,
  // which is the best case — an unevenly filled diagram has a HIGHER floor.
  const eceNoiseFloor = Math.sqrt((2 * variance) / (Math.PI * perBin));
  const successes = Math.round(meanForecast * n);
  const frequencyInterval = wilsonInterval(successes, n, level);
  const nominal = 0.9;
  const hitInterval = wilsonInterval(Math.round(nominal * n), n, level);
  const hitRateIntervalWidth = hitInterval.high - hitInterval.low;
  const sufficient = eceNoiseFloor < 0.05 && hitRateIntervalWidth < 0.15;

  const warnings: string[] = [];
  if (!sufficient) {
    warnings.push(
      `A record of ${n} judgement${n === 1 ? '' : 's'} cannot establish calibration. A perfectly calibrated judge ` +
        `would show an ECE of about ${eceNoiseFloor.toPrecision(3)} here from noise alone, and a 90% interval hit ` +
        `rate anywhere in a band ${hitRateIntervalWidth.toPrecision(3)} wide. Any calibration conclusion drawn from ` +
        'this record is a conclusion about the sample, not about the judge.',
    );
  }
  if (perBin < 5) {
    warnings.push(
      `With ${bins} bins and ${n} judgements there are only ${perBin.toPrecision(3)} judgements per bin. The ` +
        'reliability diagram will look dramatic whatever the judge does. Use fewer bins, or do not plot one.',
    );
  }
  const verdict = sufficient
    ? `With ${n} judgements, a calibration estimate is usable: the noise floor on the ECE is ` +
      `${eceNoiseFloor.toPrecision(3)} and a hit rate is pinned to within ${hitRateIntervalWidth.toPrecision(3)}. ` +
      'Departures larger than those are about the judge.'
    : `With ${n} judgements, the noise floor on the ECE is ${eceNoiseFloor.toPrecision(3)} — comparable to or ` +
      'larger than the miscalibration anyone is trying to detect. Collect more before concluding anything. As a ' +
      'rough guide the noise floor falls as 1/√n, so detecting a 0.05 ECE needs on the order of ' +
      `${Math.ceil((2 * variance * bins) / (Math.PI * 0.05 ** 2))} judgements at ${bins} bins.`;

  return {
    n,
    bins,
    standardError,
    frequencyInterval,
    eceNoiseFloor,
    hitRateIntervalWidth,
    sufficient,
    verdict,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Sampling uncertainty of a calibration estimate',
      `The length of a judge's record (${n} scored judgement${n === 1 ? '' : 's'}) — itself not a judgement, but the ` +
        'thing that bounds what any judgement about the judge can mean',
      [
        'This is the floor from sampling noise only. Serial dependence between questions, or questions of varying difficulty, make it worse.',
        'An observed ECE below the noise floor is not evidence of calibration. It is evidence of a short record.',
      ],
    ),
    explanation: {
      method: 'Noise floor of a calibration estimate at a given record length',
      formula: 'E|ō − p̄| = √(2p̄(1−p̄)/(π·n_bin)); ECE floor = Σ (n_k/n)·that',
      steps: [
        { label: 'Judgements', value: String(n) },
        { label: 'Bins', value: String(bins) },
        { label: 'Judgements per bin', value: perBin.toPrecision(6) },
        { label: 'Standard error of a frequency', value: standardError.toPrecision(8) },
        { label: 'ECE noise floor', value: eceNoiseFloor.toPrecision(8) },
        { label: '95% band for a 0.9 hit rate', value: `[${hitInterval.low.toPrecision(5)}, ${hitInterval.high.toPrecision(5)}] (width ${hitRateIntervalWidth.toPrecision(5)})` },
        { label: 'Sufficient for a calibration claim', value: sufficient ? 'yes' : 'NO' },
      ],
      assumptions: [
        'The judgements are independent and the bins are equally occupied, which is the most favourable case.',
      ],
      limitations: [
        'This bounds what can be detected; it does not estimate the judge’s calibration.',
        'Questions chosen by the judge, or a record with correlated questions, have an effective n lower than the count.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* A judge's binary record                                            */
/* ------------------------------------------------------------------ */

export interface BinaryRecordResult {
  n: number;
  /** Brier score with the Murphy decomposition: reliability − resolution + uncertainty. */
  brier: BrierResult;
  /** Brier skill against the base rate, because a raw score alone is uninterpretable. */
  brierSkill: SkillScoreResult;
  /** The base rate and the score of the constant climatological forecast. */
  climatology: { baseRate: number; brierScore: number };
  logarithmic: LogScoreResult;
  reliability: CalibrationResult;
  /** How much of a calibration claim this record length supports. */
  uncertainty: CalibrationUncertaintyResult;
  /** Reliability and resolution pulled out of the Murphy decomposition for readability. */
  calibrationComponent: number;
  resolutionComponent: number;
  verdict: string;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Score a judge's record of binary probability judgements.
 *
 * Nothing here is new mathematics: the Brier score, its Murphy decomposition,
 * the log score, the reliability diagram and the skill score all come from the
 * information module. What this adds is the insistence that the three be read
 * together — a good Brier score with zero resolution is a judge who always
 * says the base rate, and a high resolution with bad reliability is a judge
 * who knows things but states them with the wrong confidence — and the record
 * length that bounds all of it.
 */
export function scoreBinaryRecord(
  forecasts: ArrayLike<number>,
  outcomes: ArrayLike<number>,
  options: { bins?: number } = {},
): BinaryRecordResult {
  if (forecasts.length === 0) {
    throw new EngineError('There are no judgements to score.', 'empty');
  }
  if (forecasts.length !== outcomes.length) {
    throw new EngineError(
      `There are ${forecasts.length} stated probabilities but ${outcomes.length} outcomes.`,
      'length',
    );
  }
  const n = forecasts.length;
  // brierScore validates the probabilities and outcomes and names the offender.
  const brier = brierScore(forecasts, outcomes);
  const climatology = climatologyBrier(outcomes);
  if (climatology.baseRate === 0 || climatology.baseRate === 1) {
    throw new EngineError(
      `Every one of the ${n} outcomes was ${climatology.baseRate === 1 ? 'a hit' : 'a miss'}, so the base rate is ` +
        `${climatology.baseRate} and the climatological Brier score is 0. No skill score can be formed against a ` +
        'baseline that is already perfect, and calibration is not identifiable from a record with one outcome ' +
        'value. Score this judge on a set of questions whose answers differ.',
      'degenerate',
    );
  }
  const brierSkill = skillScore(brier.brierScore, climatology.brierScore, {
    reference: `climatology (the constant forecast ${climatology.baseRate.toPrecision(4)}, the observed base rate)`,
    perfect: 0,
  });
  const logarithmic = logScore(forecasts, outcomes, { base: 'bits' });
  const bins = options.bins ?? 10;
  const reliability = calibration(forecasts, outcomes, { bins });
  const uncertainty = calibrationUncertainty(n, { bins, meanForecast: climatology.baseRate });

  const warnings: string[] = [...uncertainty.warnings];
  if (!logarithmic.finite) {
    warnings.push(
      `The log score is infinite: the judge stated probability 0 for something that happened, or 1 for something ` +
        `that did not, at ${logarithmic.offendingIndices.length} index(es) (${logarithmic.offendingIndices.slice(0, 10).join(', ')}). ` +
        'That is the correct score and it has not been clipped. A judge who states certainties cannot be scored ' +
        'logarithmically until they stop.',
    );
  }
  if (brier.resolution < 0.01) {
    warnings.push(
      `Resolution is ${brier.resolution.toPrecision(4)}, essentially zero: this judge’s probabilities barely ` +
        'separate the events that happened from the ones that did not. A well-calibrated judge with no resolution ' +
        'is just repeating the base rate and adds nothing.',
    );
  }
  if (brierSkill.skill < 0) {
    warnings.push(
      `The Brier skill against climatology is ${brierSkill.skill.toPrecision(4)}, which is NEGATIVE: this judge ` +
        'scores worse than always stating the base rate.',
    );
  }
  if (reliability.ece < uncertainty.eceNoiseFloor) {
    warnings.push(
      `The observed ECE of ${reliability.ece.toPrecision(4)} is BELOW the ${uncertainty.eceNoiseFloor.toPrecision(4)} ` +
        'a perfectly calibrated judge would show here by chance. That is consistent with good calibration but is ' +
        'not evidence of it; the record is too short to distinguish.',
    );
  }

  const verdict =
    `Over ${n} judgements: Brier ${brier.brierScore.toPrecision(4)} = reliability ` +
    `${brier.reliability.toPrecision(4)} − resolution ${brier.resolution.toPrecision(4)} + uncertainty ` +
    `${brier.uncertainty.toPrecision(4)}; skill against climatology ${brierSkill.skill.toPrecision(4)}. ` +
    `Reliability is the calibration error (0 is perfect) and resolution is the usefulness (bigger is better). ` +
    (uncertainty.sufficient
      ? 'The record is long enough for these to mean something.'
      : 'THE RECORD IS TOO SHORT for these to mean much; see the warnings.');

  return {
    n,
    brier,
    brierSkill,
    climatology,
    logarithmic,
    reliability,
    uncertainty,
    calibrationComponent: brier.reliability,
    resolutionComponent: brier.resolution,
    verdict,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Proper scoring of a judge’s binary record, with the Murphy decomposition and skill against climatology',
      `${n} probability judgements made by a judge, checked against ${n} known binary outcomes`,
      [
        'A score summarises the judge’s past on these questions. It transfers to new questions only as far as they resemble these.',
        'Reliability and resolution must be read together. Either one alone can be made to look good by a judge who is useless.',
        'The record length bounds everything above; see `uncertainty`.',
      ],
    ),
    explanation: {
      method: 'Binary judgement record: Brier with the Murphy decomposition, log score, reliability diagram, skill against climatology',
      formula: 'BS = reliability − resolution + uncertainty;  BSS = 1 − BS/BS_climatology',
      steps: [
        { label: 'Judgements', value: String(n) },
        { label: 'Base rate', value: climatology.baseRate.toPrecision(6) },
        { label: 'Brier score', value: brier.brierScore.toPrecision(8) },
        { label: 'Reliability (calibration; 0 is perfect)', value: brier.reliability.toPrecision(8) },
        { label: 'Resolution (bigger is better)', value: brier.resolution.toPrecision(8) },
        { label: 'Uncertainty (not the judge’s doing)', value: brier.uncertainty.toPrecision(8) },
        { label: 'Decomposition residual', value: brier.decompositionResidual.toExponential(3) },
        { label: 'Brier skill score vs climatology', value: brierSkill.skill.toPrecision(8) },
        { label: 'Log score (bits)', value: logarithmic.finite ? logarithmic.value.toPrecision(8) : 'infinite — a stated certainty was wrong' },
        { label: 'ECE', value: reliability.ece.toPrecision(8) },
        { label: 'ECE noise floor at this record length', value: uncertainty.eceNoiseFloor.toPrecision(8) },
      ],
      assumptions: [
        'Each probability was stated before the outcome was known.',
        'The judgements are independent enough that the record length is the effective sample size.',
      ],
      limitations: [
        'A record is retrospective. A judge can be well calibrated on easy questions and badly calibrated on the ones that matter.',
        'The decomposition is exact only when forecasts are grouped by their distinct values, which is what is done here; the residual is reported.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* A judge's continuous record: the PIT histogram                     */
/* ------------------------------------------------------------------ */

export interface PredictiveJudgement {
  distributionId: string;
  params: Params;
}

export interface ContinuousRecordResult {
  n: number;
  /** F_i(y_i) for each judgement: uniform if and only if the judge is calibrated. */
  pitValues: number[];
  pit: PitResult;
  /** The shape diagnosis in this module's vocabulary. */
  diagnosis: IntervalDiagnosis | 'biased high' | 'biased low' | 'non-uniform, shape unclear';
  /** Mean PIT; ½ under calibration. Above ½ means the judge forecasts low. */
  meanPit: number;
  /** Variance of the PIT; 1/12 ≈ 0.08333 under calibration. Above means too narrow. */
  variancePit: number;
  /** Realised coverage of the central 90% of each predictive distribution. */
  central90Coverage: number;
  uncertainty: CalibrationUncertaintyResult;
  exactness: JudgementExactness;
  basis: JudgementBasis;
  explanation: Explanation;
  warnings: string[];
}

/**
 * Score a judge's record of continuous predictive distributions by the
 * probability integral transform.
 *
 * Each stated distribution is evaluated at what actually happened. Under
 * calibration those numbers are uniform; the SHAPE of the departure says which
 * failure it is, and `pitHistogram` in the information module already does that
 * diagnosis. Here it is translated into the elicitation vocabulary — too
 * narrow, too wide, biased — and paired with the realised central coverage,
 * which is the number a judge can act on.
 */
export function scoreContinuousRecord(
  predictive: readonly PredictiveJudgement[],
  outcomes: ArrayLike<number>,
  options: { bins?: number } = {},
): ContinuousRecordResult {
  const n = predictive.length;
  if (n === 0) throw new EngineError('There are no predictive judgements to score.', 'empty');
  if (outcomes.length !== n) {
    throw new EngineError(
      `There are ${n} predictive distributions but ${outcomes.length} outcomes.`,
      'length',
    );
  }
  const pitValues: number[] = [];
  let inside90 = 0;
  for (let i = 0; i < n; i++) {
    const def = getDistribution(predictive[i].distributionId);
    if (def.kind === 'discrete') {
      throw new EngineError(
        `Judgement ${i} used the discrete distribution "${def.id}". The PIT is not uniform for a discrete ` +
          'predictive distribution even under perfect calibration, so this diagnosis would be wrong. Use a ' +
          'randomised PIT, or score discrete judgements as binary ones.',
        'discrete',
      );
    }
    const y = outcomes[i];
    if (!Number.isFinite(y)) {
      throw new EngineError(`Outcome ${i} is ${String(y)}, which is not a finite number.`, 'finite');
    }
    const u = def.cdf(y, predictive[i].params);
    if (!Number.isFinite(u)) {
      throw new EngineError(
        `The predictive CDF of judgement ${i} (${def.id}) evaluated to ${String(u)} at the outcome ${y}; no PIT ` +
          'value can be formed.',
        'numerical',
      );
    }
    pitValues.push(Math.min(1, Math.max(0, u)));
    const lo = def.quantile(0.05, predictive[i].params);
    const hi = def.quantile(0.95, predictive[i].params);
    if (y >= lo && y <= hi) inside90++;
  }
  const pit = pitHistogram(pitValues, { bins: options.bins ?? 10 });
  const meanPit = stableSum(pitValues) / n;
  const variancePit = stableSum(pitValues.map((u) => (u - meanPit) ** 2)) / n;
  const central90Coverage = inside90 / n;

  // Translate the information module's diagnosis into this module's vocabulary
  // without re-deciding it: the test is the same one, read through the shape.
  const text = pit.diagnosis;
  const diagnosis: ContinuousRecordResult['diagnosis'] = text.includes('TOO NARROW')
    ? 'too narrow'
    : text.includes('TOO WIDE')
      ? 'too wide'
      : text.includes('biased LOW')
        ? 'biased low'
        : text.includes('biased HIGH')
          ? 'biased high'
          : text.startsWith('Consistent with uniform')
            ? 'consistent with nominal'
            : 'non-uniform, shape unclear';

  const uncertainty = calibrationUncertainty(n, { bins: options.bins ?? 10 });
  const warnings: string[] = [...uncertainty.warnings];
  if (diagnosis === 'too narrow') {
    warnings.push(
      `OVERCONFIDENCE: the PIT histogram is U-shaped (variance ${variancePit.toPrecision(4)} against the 0.08333 ` +
        `expected under calibration), and the central 90% of the stated distributions captured only ` +
        `${(central90Coverage * 100).toPrecision(3)}% of outcomes. The stated distributions are too narrow. Use ` +
        'intervalCalibration on the same record to get the width correction factor.',
    );
  }
  if (diagnosis === 'too wide') {
    warnings.push(
      `The PIT histogram is hump-shaped: the stated distributions are too WIDE and the judge is underconfident. ` +
        `The central 90% captured ${(central90Coverage * 100).toPrecision(3)}% of outcomes.`,
    );
  }
  if (diagnosis === 'biased low' || diagnosis === 'biased high') {
    warnings.push(
      `The PIT histogram is sloped (mean ${meanPit.toPrecision(4)} against the 0.5 expected): the judge is ` +
        `${diagnosis === 'biased low' ? 'forecasting too LOW — outcomes keep landing in the upper tail' : 'forecasting too HIGH — outcomes keep landing in the lower tail'}. ` +
        'This is a location error; widening the distributions would not fix it.',
    );
  }
  return {
    n,
    pitValues,
    pit,
    diagnosis,
    meanPit,
    variancePit,
    central90Coverage,
    uncertainty,
    exactness: JUDGEMENT_EXACTNESS,
    basis: judgementBasis(
      'Probability integral transform of a judge’s continuous predictive distributions',
      `${n} predictive distributions stated by a judge, each evaluated at the value that actually occurred`,
      [
        'The PIT diagnoses the SHAPE of a miscalibration, not its cause.',
        'A flat PIT histogram is necessary for calibration but not sufficient: compensating errors in opposite directions also look flat.',
        'The χ² reference used inside assumes the judgements are independent.',
      ],
    ),
    explanation: {
      method: 'PIT histogram of a continuous judgement record, with the shape diagnosed',
      formula: 'u_i = F_i(y_i); under calibration u ~ Uniform(0,1), so E[u] = ½ and Var[u] = 1/12',
      steps: [
        { label: 'Judgements', value: String(n) },
        { label: 'Mean PIT (½ expected)', value: meanPit.toPrecision(8) },
        { label: 'Variance of PIT (0.0833333 expected)', value: variancePit.toPrecision(8) },
        { label: `χ² against uniform (df = ${pit.degreesOfFreedom})`, value: pit.chiSquared.toPrecision(8) },
        { label: 'Realised coverage of the central 90%', value: central90Coverage.toPrecision(6) },
        { label: 'Diagnosis', value: `${diagnosis} — ${pit.diagnosis}` },
      ],
      assumptions: [
        'Each predictive distribution was stated before the outcome was known.',
        'The predictive distributions are continuous, so the PIT is uniform under calibration.',
      ],
      limitations: [
        'The shape diagnosis needs tens of judgements to be reliable; on a short record the histogram is noise.',
        'Serial dependence invalidates the χ² reference.',
      ],
      exactness: JUDGEMENT_EXACTNESS,
    },
    warnings,
  };
}
