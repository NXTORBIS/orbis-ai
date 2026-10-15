/**
 * Overlap and balance diagnostics.
 *
 * These decide whether an adjusted estimate means anything. An IPW estimate
 * with an effective sample size of 12 out of 2000 is not an estimate of an
 * average; it is a description of a dozen unusual units. The job of this file
 * is to make that visible before anyone quotes the number.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import type { BalanceReport, CovariateBalanceRow, OverlapReport, WeightReport } from './types.ts';

/** The conventional standardised-mean-difference threshold (Normand et al.). */
export const SMD_THRESHOLD = 0.1;

export interface Covariate {
  name: string;
  values: readonly number[];
}

function weightedMean(x: readonly number[], w: readonly number[], idx: readonly number[]): number {
  let s = 0;
  let sw = 0;
  for (const i of idx) {
    s += w[i] * x[i];
    sw += w[i];
  }
  if (sw <= 0) throw new EngineError('Balance: a group has zero total weight.', 'weight');
  return s / sw;
}

function weightedVariance(x: readonly number[], w: readonly number[], idx: readonly number[], m: number): number {
  let s = 0;
  let sw = 0;
  for (const i of idx) {
    s += w[i] * (x[i] - m) * (x[i] - m);
    sw += w[i];
  }
  return s / sw;
}

/**
 * Standardised mean differences and variance ratios, optionally weighted.
 *
 * The denominator is the pooled standard deviation of the UNWEIGHTED sample,
 * held fixed between the before and after columns, so that the two are
 * comparable: a weighting scheme that shrinks the spread must not be able to
 * improve its own SMD by moving the yardstick.
 */
export function covariateBalance(
  covariates: readonly Covariate[],
  treatment: readonly number[],
  weights?: readonly number[],
): CovariateBalanceRow[] {
  const n = treatment.length;
  const treatedIdx: number[] = [];
  const controlIdx: number[] = [];
  for (let i = 0; i < n; i++) (treatment[i] === 1 ? treatedIdx : controlIdx).push(i);
  if (treatedIdx.length === 0 || controlIdx.length === 0) {
    throw new EngineError(
      'Balance: one treatment arm is empty, so there is nothing to compare across arms.',
      'one-arm',
    );
  }
  const w = weights ? weights.slice() : new Array<number>(n).fill(1);
  return covariates.map((c) => {
    if (c.values.length !== n) {
      throw new EngineError(`Balance: covariate "${c.name}" has ${c.values.length} values for ${n} units.`, 'length');
    }
    const rawT = treatedIdx.map((i) => c.values[i]);
    const rawC = controlIdx.map((i) => c.values[i]);
    const vT = variance(rawT, 1);
    const vC = variance(rawC, 1);
    const pooled = Math.sqrt((vT + vC) / 2);
    if (!(pooled > 0)) {
      throw new EngineError(
        `Balance: covariate "${c.name}" has zero variance within both arms, so a standardised mean difference ` +
          'would divide by zero. No value is reported for it; remove the covariate or check the data.',
        'zero-variance',
      );
    }
    const mT = weightedMean(c.values, w, treatedIdx);
    const mC = weightedMean(c.values, w, controlIdx);
    const wvT = weights ? weightedVariance(c.values, w, treatedIdx, mT) : vT;
    const wvC = weights ? weightedVariance(c.values, w, controlIdx, mC) : vC;
    const smd = (mT - mC) / pooled;
    return {
      name: c.name,
      treatedMean: mT,
      controlMean: mC,
      smd,
      varianceRatio: wvC > 0 ? wvT / wvC : null,
      balanced: Math.abs(smd) <= SMD_THRESHOLD,
    };
  });
}

export function balanceReport(
  covariates: readonly Covariate[],
  treatment: readonly number[],
  adjustedWeights?: readonly number[],
  /** For matching: the index subset retained, with per-unit multiplicities in `adjustedWeights`. */
  label = 'adjustment',
): BalanceReport {
  const before = covariateBalance(covariates, treatment);
  const after = adjustedWeights ? covariateBalance(covariates, treatment, adjustedWeights) : null;
  const worstBefore = before.reduce((m, r) => Math.max(m, Math.abs(r.smd)), 0);
  const worstAfter = after ? after.reduce((m, r) => Math.max(m, Math.abs(r.smd)), 0) : null;
  const warnings: string[] = [];
  if (after && worstAfter !== null && worstAfter > SMD_THRESHOLD) {
    const bad = after.filter((r) => Math.abs(r.smd) > SMD_THRESHOLD).map((r) => `${r.name} (${r.smd.toFixed(3)})`);
    warnings.push(
      `After ${label}, ${bad.length} covariate(s) remain imbalanced above the conventional 0.1 threshold: ` +
        `${bad.join(', ')}. The adjustment has not removed the measured confounding it was supposed to remove, so ` +
        'the estimate is still biased by these covariates — before considering anything unmeasured.',
    );
  }
  for (const r of after ?? []) {
    if (r.varianceRatio !== null && (r.varianceRatio > 2 || r.varianceRatio < 0.5)) {
      warnings.push(
        `Variance ratio for "${r.name}" is ${r.varianceRatio.toFixed(2)} after ${label} (outside [0.5, 2]). Means ` +
          'can match while distributions differ in spread; higher moments are still unbalanced.',
      );
    }
  }
  if (!after && worstBefore > SMD_THRESHOLD) {
    warnings.push(
      `Unadjusted imbalance up to ${worstBefore.toFixed(3)} standardised units. A raw comparison of means is a ` +
        'comparison of different kinds of unit, not an estimate of a treatment effect.',
    );
  }
  return { before, after, smdThreshold: SMD_THRESHOLD, worstBeforeSmd: worstBefore, worstAfterSmd: worstAfter, warnings };
}

/** Propensity-score overlap, common support and the units outside it. */
export function overlapReport(scores: readonly number[], treatment: readonly number[], bins = 20): OverlapReport {
  const n = scores.length;
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) (treatment[i] === 1 ? t : c).push(scores[i]);
  if (t.length === 0 || c.length === 0) {
    throw new EngineError('Overlap: one treatment arm is empty.', 'one-arm');
  }
  const treatedRange: [number, number] = [Math.min(...t), Math.max(...t)];
  const controlRange: [number, number] = [Math.min(...c), Math.max(...c)];
  const lo = Math.max(treatedRange[0], controlRange[0]);
  const hi = Math.min(treatedRange[1], controlRange[1]);
  const warnings: string[] = [];
  const commonSupport: [number, number] | null = lo <= hi ? [lo, hi] : null;
  if (commonSupport === null) {
    throw new EngineError(
      `No common support: the treated propensity scores span [${treatedRange[0].toFixed(4)}, ` +
        `${treatedRange[1].toFixed(4)}] and the control scores span [${controlRange[0].toFixed(4)}, ` +
        `${controlRange[1].toFixed(4)}], and these ranges do not overlap at all. Not one treated unit has a ` +
        'comparable control unit. Positivity fails completely, so there is no covariate value at which both ' +
        'potential outcomes can be estimated and no adjusted effect exists. Any number produced here would be ' +
        'pure model extrapolation. Restrict the question to a subpopulation where both arms occur, or collect ' +
        'comparable controls.',
      'no-overlap',
    );
  }
  let outside = 0;
  for (const s of scores) if (s < lo || s > hi) outside++;
  const proportion = outside / n;
  if (proportion > 0.1) {
    warnings.push(
      `${outside} of ${n} units (${(proportion * 100).toFixed(1)}%) lie outside the common propensity support ` +
        `[${lo.toFixed(4)}, ${hi.toFixed(4)}]. For those units one arm is empty, so their contribution to any ` +
        'ATE is extrapolated from the model rather than estimated from data.',
    );
  }
  const edges: number[] = [];
  for (let b = 0; b <= bins; b++) edges.push(b / bins);
  const tc = new Array<number>(bins).fill(0);
  const cc = new Array<number>(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(scores[i] * bins)));
    if (treatment[i] === 1) tc[b]++;
    else cc[b]++;
  }
  let emptyBins = 0;
  for (let b = 0; b < bins; b++) if ((tc[b] > 0 && cc[b] === 0) || (cc[b] > 0 && tc[b] === 0)) emptyBins++;
  if (emptyBins >= bins / 2) {
    warnings.push(
      `${emptyBins} of ${bins} propensity bins contain units from only one arm. The two arms barely occupy the ` +
        'same region of covariate space; a single adjusted average over this sample is not well supported.',
    );
  }
  return {
    treatedRange,
    controlRange,
    commonSupport,
    proportionOutsideCommonSupport: proportion,
    nOutsideCommonSupport: outside,
    binEdges: edges,
    treatedCounts: tc,
    controlCounts: cc,
    warnings,
  };
}

/**
 * Weight diagnostics: the maximum weight, Kish's effective sample size and
 * the concentration of weight in the heaviest units.
 *
 * ESS is reported per arm as well as overall, because an IPW estimate is a
 * difference of two weighted means and either one can collapse on its own.
 */
export function weightReport(
  weights: readonly number[],
  treatment: readonly number[],
  kind: WeightReport['kind'],
): WeightReport {
  const n = weights.length;
  if (n === 0) throw new EngineError('Weight diagnostics: no weights supplied.', 'empty');
  const ess = (idx: number[]): number => {
    let s = 0;
    let s2 = 0;
    for (const i of idx) {
      s += weights[i];
      s2 += weights[i] * weights[i];
    }
    if (s2 <= 0) {
      throw new EngineError(
        'Weight diagnostics: a group has only zero weights, so its effective sample size is zero and no ' +
          'weighted mean exists for it.',
        'weight',
      );
    }
    return (s * s) / s2;
  };
  const all: number[] = [];
  const tIdx: number[] = [];
  const cIdx: number[] = [];
  for (let i = 0; i < n; i++) {
    all.push(i);
    (treatment[i] === 1 ? tIdx : cIdx).push(i);
  }
  if (tIdx.length === 0 || cIdx.length === 0) throw new EngineError('Weight diagnostics: one arm is empty.', 'one-arm');
  const maxWeight = Math.max(...weights);
  const total = weights.reduce((a, b) => a + b, 0);
  const sorted = weights.slice().sort((a, b) => b - a);
  const topCount = Math.max(1, Math.round(n * 0.01));
  const topShare = sorted.slice(0, topCount).reduce((a, b) => a + b, 0) / total;
  const essAll = ess(all);
  const essT = ess(tIdx);
  const essC = ess(cIdx);
  const warnings: string[] = [];
  const meanW = total / n;
  if (maxWeight > 10 * meanW) {
    warnings.push(
      `The largest weight is ${(maxWeight / meanW).toFixed(1)}× the mean weight. A single unit is carrying that ` +
        'much of the estimate; the weighted mean is close to that unit\'s outcome and its sampling variability ' +
        'dominates the standard error.',
    );
  }
  if (essAll < 0.25 * n) {
    warnings.push(
      `Effective sample size ${essAll.toFixed(1)} out of ${n} units (${((essAll / n) * 100).toFixed(1)}%). Most of ` +
        'the data contributes almost nothing. The precision of this weighted estimate is that of a much smaller ' +
        'study, and it is a statement about the heavily weighted units rather than the sample.',
    );
  }
  if (essT < 20 || essC < 20) {
    warnings.push(
      `Effective sample size per arm: ${essT.toFixed(1)} treated, ${essC.toFixed(1)} control. Below roughly 20 ` +
        'the weighted mean of that arm rests on a handful of units and the normal-approximation interval is ' +
        'unreliable.',
    );
  }
  if (topShare > 0.3) {
    warnings.push(
      `The heaviest ${topCount} unit(s) hold ${(topShare * 100).toFixed(1)}% of the total weight. This estimate is ` +
        'determined by extreme-propensity units, which is a positivity failure showing up as instability rather ' +
        'than as a refusal.',
    );
  }
  return {
    kind,
    maxWeight,
    effectiveSampleSize: essAll,
    effectiveSampleSizeTreated: essT,
    effectiveSampleSizeControl: essC,
    topOnePercentWeightShare: topShare,
    warnings,
  };
}

/** Mean of a subset — small helper used by the estimators. */
export function subsetMean(y: readonly number[], idx: readonly number[]): number {
  if (idx.length === 0) throw new EngineError('Mean of an empty group is undefined.', 'empty');
  return mean(idx.map((i) => y[i]));
}
