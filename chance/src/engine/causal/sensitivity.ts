/**
 * Sensitivity analysis: how much unmeasured confounding would be needed to
 * overturn the result?
 *
 * The key assumption of every adjustment method is untestable, so this file is
 * the most valuable part of the module. It does not make the estimate more
 * credible; it tells the reader exactly how fragile it is, in units they can
 * argue about.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import { normalCdf } from '../special/gamma.ts';
import { CONSISTENCY, SUTVA, describeEstimand } from './assumptions.ts';
import { accounting, makeEstimate } from './build.ts';
import type { CausalEstimate, Interval } from './types.ts';

export interface EValueResult {
  /** The risk ratio the E-value was computed from. */
  riskRatio: number;
  /** E-value for the point estimate. */
  pointEValue: number;
  /** E-value for the confidence limit nearest the null; 1 when the CI crosses it. */
  limitEValue: number;
  /** Which limit was used, or null when the interval includes the null. */
  limitUsed: number | null;
  exactness: 'numerical';
  interpretation: string;
  warnings: string[];
}

/**
 * VanderWeele–Ding E-value: the minimum strength of association, on the risk
 * ratio scale, that an unmeasured confounder would need to have with BOTH the
 * treatment and the outcome — above and beyond the measured covariates — to
 * explain away the observed effect.
 *
 * E = RR + √(RR·(RR−1)) for RR ≥ 1, applied to 1/RR when RR < 1.
 */
export function eValue(riskRatio: number, confidenceInterval?: { low: number; high: number }): EValueResult {
  if (!(riskRatio > 0) || !Number.isFinite(riskRatio)) {
    throw new EngineError(
      `E-value: the risk ratio must be a finite positive number; got ${riskRatio}. A risk ratio of zero or ` +
        'infinity means one arm had no events at all, and the E-value for it is unbounded rather than large.',
      'range',
    );
  }
  const formula = (rr: number): number => {
    const r = rr < 1 ? 1 / rr : rr;
    return r + Math.sqrt(r * (r - 1));
  };
  const point = formula(riskRatio);
  let limitEValue = 1;
  let limitUsed: number | null = null;
  const warnings: string[] = [];
  if (confidenceInterval) {
    const { low, high } = confidenceInterval;
    if (!(low > 0) || !(high > 0) || !(high >= low)) {
      throw new EngineError(
        `E-value: the confidence interval [${low}, ${high}] is not a valid interval of positive risk ratios.`,
        'range',
      );
    }
    if (low <= 1 && high >= 1) {
      limitEValue = 1;
      limitUsed = null;
      warnings.push(
        'The confidence interval includes a risk ratio of 1, so the E-value for the limit is 1: no unmeasured ' +
          'confounding at all is needed to make the interval compatible with no effect. The point estimate\'s ' +
          'E-value should not be quoted on its own in that situation.',
      );
    } else {
      limitUsed = low > 1 ? low : high;
      limitEValue = formula(limitUsed);
    }
  }
  const nullish = Math.abs(riskRatio - 1) < 1e-12;
  return {
    riskRatio,
    pointEValue: point,
    limitEValue,
    limitUsed,
    exactness: 'numerical',
    interpretation: nullish
      ? 'The observed risk ratio is exactly 1. The E-value is 1: no unmeasured confounding is needed to explain ' +
        'away an effect of nothing.'
      : `An unmeasured confounder would need to be associated with both the treatment and the outcome by a risk ` +
        `ratio of at least ${point.toFixed(3)} each — beyond everything already adjusted for — to move the ` +
        `observed risk ratio of ${riskRatio.toFixed(4)} to 1. ` +
        (limitUsed !== null
          ? `To move the confidence limit of ${limitUsed.toFixed(4)} to 1 requires only ${limitEValue.toFixed(3)}. ` +
            'The limit E-value is the more conservative number and is the one to argue about.'
          : '') +
        ' Whether that strength is plausible is a judgement about the subject matter, not a statistical question: ' +
        'the E-value converts an untestable assumption into a quantity a domain expert can dispute.',
    warnings,
  };
}

/**
 * Convert a standardised mean difference to an approximate risk ratio, so that
 * continuous outcomes can be put on the E-value scale (VanderWeele 2017:
 * RR ≈ exp(0.91·d)).
 */
export function standardisedDifferenceToRiskRatio(d: number, sd: number): number {
  if (!(sd > 0)) {
    throw new EngineError(
      'Converting an effect to the risk-ratio scale needs a positive outcome standard deviation; the outcome ' +
        'appears to be constant.',
      'zero-variance',
    );
  }
  return Math.exp((0.91 * d) / sd);
}

export interface RosenbaumBound {
  gamma: number;
  /** Worst-case one-sided p-value at this Γ. */
  upperPValue: number;
  /** Most favourable one-sided p-value at this Γ. */
  lowerPValue: number;
  significantAtGamma: boolean;
}

export interface RosenbaumResult {
  nPairs: number;
  /** Wilcoxon signed-rank statistic of the matched differences. */
  statistic: number;
  bounds: RosenbaumBound[];
  /** The largest Γ at which the worst case is still significant. */
  criticalGamma: number | null;
  exactness: 'numerical';
  interpretation: string;
  warnings: string[];
}

/**
 * Rosenbaum bounds for a matched design.
 *
 * Γ is the largest ratio by which two matched units' odds of treatment could
 * differ because of something unmeasured. At Γ = 1 the design is as good as
 * randomised within pairs; the bounds report the worst-case p-value as Γ grows.
 */
export function rosenbaumBounds(
  matchedDifferences: readonly number[],
  options: { gammas?: readonly number[]; alpha?: number } = {},
): RosenbaumResult {
  const nonZero = matchedDifferences.filter((d) => d !== 0);
  const n = nonZero.length;
  if (n < 5) {
    throw new EngineError(
      `Rosenbaum bounds: ${n} matched pair(s) with a non-zero difference. The signed-rank statistic has no useful ` +
        'normal approximation below a handful of pairs, so no sensitivity bound is reported rather than a ' +
        'misleading one. (Pairs with an exactly zero difference carry no sign and are excluded, as in the ' +
        'standard test.)',
      'size',
    );
  }
  if (matchedDifferences.length > n) {
    // Recorded as a warning below.
  }
  const abs = nonZero.map((d, i) => ({ a: Math.abs(d), s: d > 0 ? 1 : 0, i }));
  abs.sort((x, y) => x.a - y.a);
  const ranks = new Array<number>(n).fill(0);
  let k = 0;
  while (k < n) {
    let j = k;
    while (j + 1 < n && abs[j + 1].a === abs[k].a) j++;
    const r = (k + j) / 2 + 1;
    for (let m = k; m <= j; m++) ranks[m] = r;
    k = j + 1;
  }
  let W = 0;
  for (let m = 0; m < n; m++) if (abs[m].s === 1) W += ranks[m];
  const sumRanks = ranks.reduce((a, b) => a + b, 0);
  const sumSqRanks = ranks.reduce((a, b) => a + b * b, 0);
  const gammas = options.gammas ?? [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
  const alpha = options.alpha ?? 0.05;
  const bounds: RosenbaumBound[] = [];
  let critical: number | null = null;
  for (const g of gammas) {
    if (!(g >= 1)) throw new EngineError(`Rosenbaum bounds: Γ must be at least 1; got ${g}.`, 'range');
    const pPlus = g / (1 + g);
    const pMinus = 1 / (1 + g);
    const upper = (() => {
      const muMax = pPlus * sumRanks;
      const sdMax = Math.sqrt(pPlus * (1 - pPlus) * sumSqRanks);
      if (!(sdMax > 0)) return 1;
      return 1 - normalCdf((W - muMax) / sdMax);
    })();
    const lower = (() => {
      const muMin = pMinus * sumRanks;
      const sdMin = Math.sqrt(pMinus * (1 - pMinus) * sumSqRanks);
      if (!(sdMin > 0)) return 0;
      return 1 - normalCdf((W - muMin) / sdMin);
    })();
    const sig = upper < alpha;
    if (sig) critical = g;
    bounds.push({ gamma: g, upperPValue: upper, lowerPValue: lower, significantAtGamma: sig });
  }
  const warnings: string[] = [];
  if (matchedDifferences.length > n) {
    warnings.push(
      `${matchedDifferences.length - n} matched pair(s) had an exactly zero difference and are excluded from the ` +
        'signed-rank statistic, as the standard test requires. With many ties the normal approximation degrades.',
    );
  }
  if (critical === null) {
    warnings.push(
      `The worst-case p-value already exceeds ${alpha} at Γ = ${gammas[0]}. The finding is not robust to ANY ` +
        'departure from random assignment within pairs — indeed it is not significant even under the assumption ' +
        'that matching worked perfectly.',
    );
  } else if (critical <= 1.25) {
    warnings.push(
      `The finding stops being significant once Γ exceeds about ${critical}. A confounder that changes the odds ` +
        'of treatment between matched units by only a quarter would overturn it, which is a very weak confounder ' +
        'by the standards of most observational data.',
    );
  }
  return {
    nPairs: n,
    statistic: W,
    bounds,
    criticalGamma: critical,
    exactness: 'numerical',
    interpretation:
      critical === null
        ? 'No Γ in the tested range leaves the result significant.'
        : `The result survives up to Γ = ${critical}: an unmeasured confounder would have to change the odds of ` +
          `treatment between two matched units by a factor of more than ${critical} to make the finding ` +
          'non-significant. Γ is about the treatment-assignment side only; the bound is worst-case over the ' +
          'confounder\'s relationship with the outcome, so it is deliberately pessimistic.',
    warnings,
  };
}

export interface CinelliHazlettResult {
  /** Partial R² of the treatment with the outcome, given the covariates. */
  partialR2TreatmentOutcome: number;
  /** Robustness value: the partial R² a confounder needs with BOTH to nullify. */
  robustnessValue: number;
  /** Robustness value for reducing the estimate to the edge of significance. */
  robustnessValueSignificance: number;
  /** Contour data: adjusted estimate over a grid of confounder strengths. */
  contour: { r2TreatmentConfounder: number; r2OutcomeConfounder: number; adjustedEstimate: number; adjustedSe: number }[];
  /** Bias and adjusted estimate if the confounder were as strong as a named covariate. */
  benchmarks: { covariate: string; timesStronger: number; adjustedEstimate: number }[];
  exactness: 'numerical';
  interpretation: string;
  warnings: string[];
}

/**
 * Cinelli–Hazlett (2020) partial-R² sensitivity for a regression coefficient.
 *
 * The robustness value RV is the partial R² an unmeasured confounder would
 * need with both the treatment and the outcome to bring the estimate to zero.
 * The contour data let the user see the whole trade-off rather than one number.
 */
export function cinelliHazlettSensitivity(
  estimate: number,
  standardError: number,
  degreesOfFreedom: number,
  options: {
    /** Threshold the estimate must be reduced to; 0 is the null. */
    reduceTo?: number;
    significanceLevel?: number;
    gridPoints?: number;
    /** Observed covariates to benchmark against, with their own partial R² values. */
    benchmarks?: readonly { covariate: string; r2TreatmentCovariate: number; r2OutcomeCovariate: number; timesStronger?: number }[];
  } = {},
): CinelliHazlettResult {
  if (!(standardError > 0)) {
    throw new EngineError('Cinelli–Hazlett sensitivity needs a positive standard error.', 'variance');
  }
  if (!(degreesOfFreedom >= 1)) {
    throw new EngineError(
      `Cinelli–Hazlett sensitivity needs at least one residual degree of freedom; got ${degreesOfFreedom}. With a ` +
        'saturated model the partial R² is 1 by construction and the sensitivity analysis is vacuous.',
      'size',
    );
  }
  const t = estimate / standardError;
  const r2dy = (t * t) / (t * t + degreesOfFreedom);
  const rv = (q: number): number => {
    const fq = (q * Math.abs(t)) / Math.sqrt(degreesOfFreedom);
    const f2 = fq * fq;
    return 0.5 * (Math.sqrt(f2 * f2 + 4 * f2) - f2);
  };
  const q = options.reduceTo === undefined ? 1 : 1 - options.reduceTo / estimate;
  const robustnessValue = rv(Math.abs(q));
  const alpha = options.significanceLevel ?? 0.05;
  // Reduce the t statistic to the critical value rather than to zero.
  const tCrit = 1.959963984540054; // two-sided 5% normal critical value; widened below for small df.
  const critical = alpha === 0.05 ? tCrit : Math.abs(invNormal(1 - alpha / 2));
  const qSig = Math.max(0, 1 - (critical * standardError) / Math.abs(estimate));
  const robustnessValueSignificance = rv(qSig);
  const points = options.gridPoints ?? 9;
  const contour: CinelliHazlettResult['contour'] = [];
  const sign = Math.sign(estimate) || 1;
  for (let a = 0; a < points; a++) {
    for (let b = 0; b < points; b++) {
      const r2dz = (a / (points - 1)) * 0.8;
      const r2yz = (b / (points - 1)) * 0.8;
      if (r2dz >= 1) continue;
      const bias = standardError * Math.sqrt(degreesOfFreedom) * Math.sqrt((r2yz * r2dz) / (1 - r2dz));
      const adjSe =
        standardError * Math.sqrt((1 - r2yz) / (1 - r2dz)) * Math.sqrt(degreesOfFreedom / Math.max(degreesOfFreedom - 1, 1));
      contour.push({
        r2TreatmentConfounder: r2dz,
        r2OutcomeConfounder: r2yz,
        adjustedEstimate: estimate - sign * bias,
        adjustedSe: adjSe,
      });
    }
  }
  const benchmarks = (options.benchmarks ?? []).map((bm) => {
    const times = bm.timesStronger ?? 1;
    const r2dz = Math.min(0.999, times * bm.r2TreatmentCovariate);
    const r2yz = Math.min(0.999, times * bm.r2OutcomeCovariate);
    const bias = standardError * Math.sqrt(degreesOfFreedom) * Math.sqrt((r2yz * r2dz) / (1 - r2dz));
    return { covariate: bm.covariate, timesStronger: times, adjustedEstimate: estimate - sign * bias };
  });
  const warnings: string[] = [];
  if (robustnessValue < 0.05) {
    warnings.push(
      `The robustness value is ${(robustnessValue * 100).toFixed(2)}%: a confounder explaining only that much of ` +
        'the residual variation in both the treatment and the outcome would reduce the estimate to zero. That is ' +
        'a very weak confounder, so this estimate is not robust.',
    );
  }
  return {
    partialR2TreatmentOutcome: r2dy,
    robustnessValue,
    robustnessValueSignificance,
    contour,
    benchmarks,
    exactness: 'numerical',
    interpretation:
      `Unmeasured confounding would have to explain at least ${(robustnessValue * 100).toFixed(2)}% of the ` +
      'residual variation in BOTH the treatment and the outcome to bring this estimate to the stated threshold, ' +
      `and ${(robustnessValueSignificance * 100).toFixed(2)}% to make it statistically indistinguishable from ` +
      `zero at the ${((1 - alpha) * 100).toFixed(0)}% level. For comparison, the treatment itself explains ` +
      `${(r2dy * 100).toFixed(2)}% of the residual variation in the outcome. The contour grid shows the whole ` +
      'trade-off: a confounder strongly related to the treatment needs much less relation to the outcome, and ' +
      'vice versa.',
    warnings,
  };
}

/** Small-tail-accurate normal quantile for the few places a non-5% level is used. */
function invNormal(p: number): number {
  // Newton on the CDF; the starting point is the Beasley–Springer rational guess.
  let x = 0;
  const y = p - 0.5;
  if (Math.abs(y) < 0.42) {
    const r = y * y;
    x = (y * (((-25.44106049637 * r + 41.39119773534) * r - 18.61500062529) * r + 2.50662823884)) /
      ((((3.13082909833 * r - 21.06224101826) * r + 23.08336743743) * r - 8.4735109309) * r + 1);
  } else {
    let r = p;
    if (y > 0) r = 1 - p;
    r = Math.sqrt(-Math.log(r));
    x =
      (((2.32121276858 * r + 4.85014127135) * r - 2.29796479134) * r - 2.78718931138) /
      ((1.63706781897 * r + 3.54388924762) * r + 1);
    if (y < 0) x = -x;
  }
  for (let i = 0; i < 60; i++) {
    const f = normalCdf(x) - p;
    const d = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    if (!(d > 0)) break;
    const step = f / d;
    x -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return x;
}

export interface ManskiBoundsResult {
  estimate: CausalEstimate;
  lower: number;
  upper: number;
  width: number;
  /** The bounds on each potential-outcome mean separately. */
  meanY1: Interval;
  meanY0: Interval;
  outcomeRange: [number, number];
}

/**
 * Manski no-assumption (worst-case) bounds on the ATE.
 *
 * The only inputs are the observed arm means, the arm proportions and the
 * logical range of the outcome. Nothing is assumed about how treatment was
 * assigned: the missing potential outcome of each unit is replaced by the
 * worst and then the best value it could logically take.
 *
 * The bounds are wide. That width IS the answer: it is what the data alone
 * imply about the effect, and everything narrower in this module is bought
 * with an untestable assumption.
 */
export function manskiBounds(
  outcome: readonly number[],
  treatment: readonly number[],
  outcomeRange: [number, number],
  level = 0.95,
): ManskiBoundsResult {
  const n = outcome.length;
  if (n === 0) throw new EngineError('Manski bounds: no observations.', 'empty');
  if (treatment.length !== n) throw new EngineError('Manski bounds: treatment and outcome lengths differ.', 'length');
  const [yLo, yHi] = outcomeRange;
  if (!(yHi > yLo) || !Number.isFinite(yLo) || !Number.isFinite(yHi)) {
    throw new EngineError(
      `Manski bounds: the outcome range [${yLo}, ${yHi}] is not a valid finite interval. These bounds are ` +
        'computed from the logical limits of the outcome, so an unbounded outcome gives unbounded bounds — which ' +
        'is the true answer, not a number. Supply the range the outcome cannot leave (for a binary outcome, ' +
        '[0, 1]).',
      'range',
    );
  }
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) {
    if (outcome[i] < yLo - 1e-9 || outcome[i] > yHi + 1e-9) {
      throw new EngineError(
        `Manski bounds: the observed outcome ${outcome[i]} at unit ${i} lies outside the stated range ` +
          `[${yLo}, ${yHi}]. The bounds depend entirely on that range being correct, so an inconsistency in it ` +
          'invalidates them; no bounds are reported.',
        'range',
      );
    }
    (treatment[i] === 1 ? t : c).push(outcome[i]);
  }
  if (t.length === 0 || c.length === 0) throw new EngineError('Manski bounds: one arm is empty.', 'one-arm');
  const p1 = t.length / n;
  const p0 = c.length / n;
  const m1 = mean(t);
  const m0 = mean(c);
  const y1Low = p1 * m1 + p0 * yLo;
  const y1High = p1 * m1 + p0 * yHi;
  const y0Low = p0 * m0 + p1 * yLo;
  const y0High = p0 * m0 + p1 * yHi;
  const lower = y1Low - y0High;
  const upper = y1High - y0Low;
  const width = upper - lower;
  const estimate = makeEstimate({
    method: 'Manski no-assumption bounds on the ATE',
    estimand: describeEstimand('ATE'),
    estimate: (lower + upper) / 2,
    standardError: null,
    level,
    interval: { low: lower, high: upper, level },
    pValue: null,
    exactness: 'exact',
    sample: accounting(treatment, n, null, []),
    assumptions: [
      CONSISTENCY,
      SUTVA,
      {
        name: 'A known logical range for the outcome',
        statement:
          `The outcome cannot fall outside [${yLo}, ${yHi}] for any unit under any treatment. This is the ONLY ` +
          'substantive input beyond the observed data.',
        testable: false,
        ifViolated: 'The bounds are not bounds. They are only as wide as the range is correct.',
      },
      {
        name: 'NO ignorability assumed',
        statement:
          'Nothing is assumed about how treatment was assigned. Unmeasured confounding of any strength and any ' +
          'direction is permitted, and the bounds still contain the true ATE.',
        testable: false,
        ifViolated:
          'Not applicable — this is the absence of an assumption, which is why these bounds are the one result ' +
          'in this module that cannot be overturned by a confounder.',
      },
    ],
    inferenceNote:
      'These are population bounds computed exactly from the observed arm means, the arm proportions and the ' +
      'outcome range; they are not a confidence interval and have no sampling interpretation. The reported ' +
      '"interval" is the identified SET for the ATE, and the midpoint is reported only as a label for it — it is ' +
      'not an estimate and should not be quoted as one. Sampling uncertainty in the arm means would widen the ' +
      'set further.',
    warnings: [
      `The bounds have width ${width.toPrecision(5)}, which is ${((width / (yHi - yLo)) * 100).toFixed(1)}% of the ` +
        'whole outcome range. Worst-case bounds are wide by construction, and when they contain zero the honest ' +
        'summary is that the data alone do not determine the sign of the effect.',
    ],
    notes: [
      `Observed means: treated ${m1.toPrecision(6)} (${t.length} units, ${(p1 * 100).toFixed(1)}%), control ` +
        `${m0.toPrecision(6)} (${c.length} units).`,
      `E[Y(1)] is bounded in [${y1Low.toPrecision(6)}, ${y1High.toPrecision(6)}] and E[Y(0)] in ` +
        `[${y0Low.toPrecision(6)}, ${y0High.toPrecision(6)}].`,
      `The width ${width.toPrecision(5)} equals the outcome range ${(yHi - yLo).toPrecision(5)} exactly, because ` +
        'each unobserved potential outcome is replaced by the extremes of the range. Narrower bounds require ' +
        'assumptions, and every other estimator in this module is buying its precision with one.',
      'Contains the true ATE whatever the confounding. Compare its width with the confidence interval of any ' +
        'adjusted estimate: the difference is the contribution of the identifying assumptions, not of the data.',
    ],
  });
  return {
    estimate,
    lower,
    upper,
    width,
    meanY1: { low: y1Low, high: y1High, level: 1 },
    meanY0: { low: y0Low, high: y0High, level: 1 },
    outcomeRange,
  };
}

export interface NegativeControlResult {
  name: string;
  kind: 'negative-control-outcome' | 'negative-control-exposure' | 'placebo-period';
  estimate: number;
  standardError: number;
  ciLow: number;
  ciHigh: number;
  /** True when the interval excludes zero: the control test FAILS. */
  failed: boolean;
  interpretation: string;
}

/**
 * Negative-control / placebo tests.
 *
 * A negative control is a contrast the treatment cannot have caused. If the
 * method finds an effect there, residual confounding is demonstrated — a rare
 * case where something about the untestable assumption can be learned. Finding
 * nothing proves nothing.
 */
export function negativeControlTest(
  controls: readonly { name: string; kind: NegativeControlResult['kind']; estimate: number; standardError: number }[],
  level = 0.95,
): { rows: NegativeControlResult[]; warnings: string[]; note: string } {
  if (controls.length === 0) {
    throw new EngineError(
      'Negative-control test: no control contrasts were supplied. There is nothing to test, and reporting a ' +
        'passed test would be false.',
      'empty',
    );
  }
  const z = Math.abs(invNormal(1 - (1 - level) / 2));
  const rows = controls.map((c) => {
    if (!(c.standardError > 0)) {
      throw new EngineError(
        `Negative-control test: the control "${c.name}" has a non-positive standard error, so no interval can be ` +
          'formed and the test cannot be run.',
        'variance',
      );
    }
    const low = c.estimate - z * c.standardError;
    const high = c.estimate + z * c.standardError;
    const failed = low > 0 || high < 0;
    return {
      name: c.name,
      kind: c.kind,
      estimate: c.estimate,
      standardError: c.standardError,
      ciLow: low,
      ciHigh: high,
      failed,
      interpretation: failed
        ? `A non-zero effect was found where none can exist. This is positive evidence of residual confounding ` +
          'or a specification error, and it applies to the main estimate too, since the same model produced both.'
        : 'No effect detected where none should be. This is consistent with the design but is NOT evidence that ' +
          'the main estimate is unconfounded — the test has limited power, and a confounder can affect the real ' +
          'outcome without affecting this control.',
    };
  });
  const failures = rows.filter((r) => r.failed);
  const warnings: string[] = [];
  if (failures.length > 0) {
    warnings.push(
      `NEGATIVE CONTROL FAILED: ${failures.map((f) => `${f.name} (${f.estimate.toPrecision(4)}, CI [${f.ciLow.toPrecision(4)}, ${f.ciHigh.toPrecision(4)}])`).join('; ')}. ` +
        'The analysis detects an effect on something the treatment cannot affect. The main estimate from the ' +
        'same model should not be reported as causal until this is explained.',
    );
  }
  return {
    rows,
    warnings,
    note:
      'Negative controls are asymmetric evidence. Failing one demonstrates a problem; passing all of them ' +
      'demonstrates nothing, because the assumption being probed is untestable and a control can only ever ' +
      'detect confounding that happens to act on it too.',
  };
}

/**
 * The simulation-free summary used by the tests and the interface: given an
 * estimate and its interval on a difference scale, report the E-value after
 * converting to the risk-ratio scale.
 */
export function eValueForMeanDifference(
  estimate: number,
  confidenceInterval: { low: number; high: number },
  outcomeSd: number,
): EValueResult {
  const rr = standardisedDifferenceToRiskRatio(estimate, outcomeSd);
  const res = eValue(rr, {
    low: standardisedDifferenceToRiskRatio(confidenceInterval.low, outcomeSd),
    high: standardisedDifferenceToRiskRatio(confidenceInterval.high, outcomeSd),
  });
  return {
    ...res,
    warnings: [
      ...res.warnings,
      'The effect was converted from a mean difference to an approximate risk ratio with RR ≈ exp(0.91·d) ' +
        '(VanderWeele 2017). That approximation is rough; the E-value it yields is indicative, and a difference ' +
        'in sign or a wildly different outcome distribution makes it unreliable.',
    ],
  };
}

/** Sample standard deviation helper for the conversion above. */
export function outcomeStandardDeviation(outcome: readonly number[]): number {
  const v = variance(outcome.slice(), 1);
  if (!(v > 0)) {
    throw new EngineError('The outcome has zero variance, so it cannot be standardised.', 'zero-variance');
  }
  return Math.sqrt(v);
}
