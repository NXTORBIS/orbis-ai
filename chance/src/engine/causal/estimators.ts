/**
 * The adjustment estimators: naive contrast, IPW (plain and stabilised),
 * g-computation / standardisation, AIPW, TMLE, matched and stratified
 * estimates.
 *
 * Every function returns a `CausalEstimate`, which cannot be constructed
 * without its assumption list.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import { brentRoot, clamp } from '../core/numeric.ts';
import { Random, type Seed } from '../random/rng.ts';
import {
  CORE_ADJUSTMENT,
  CORRECT_OUTCOME_MODEL,
  CORRECT_PS_MODEL,
  DOUBLE_ROBUSTNESS,
  SUTVA,
  CONSISTENCY,
  describeEstimand,
} from './assumptions.ts';
import { accounting, makeEstimate, normalInterval } from './build.ts';
import { balanceReport, overlapReport, weightReport, type Covariate } from './balance.ts';
import { fitPropensity, leastSquares, robustVcovHC1, type PropensityModel } from './fit.ts';
import { propensityStrata, type MatchResult } from './matching.ts';
import type { BalanceReport, CausalEstimate, OverlapReport, WeightReport } from './types.ts';

export interface AdjustmentSpec {
  outcome: readonly number[];
  /** 0/1 treatment indicator. */
  treatment: readonly number[];
  /** Confounders used by both models unless overridden below. */
  covariates: readonly Covariate[];
  /** Covariates for the treatment model only (to study misspecification). */
  propensityCovariates?: readonly Covariate[];
  /** Covariates for the outcome model only. */
  outcomeCovariates?: readonly Covariate[];
  level?: number;
  /** Pre-fitted propensity scores, if the caller has their own model. */
  propensityScores?: readonly number[];
}

function validate(spec: AdjustmentSpec): { n: number; level: number } {
  const n = spec.outcome.length;
  if (n === 0) throw new EngineError('No observations were supplied.', 'empty');
  if (spec.treatment.length !== n) {
    throw new EngineError(`${n} outcomes but ${spec.treatment.length} treatment values.`, 'length');
  }
  let nT = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(spec.outcome[i])) {
      throw new EngineError(
        `The outcome is missing or non-finite at unit ${i}. Units with no outcome are not dropped silently: ` +
          'supply a complete outcome vector, or decide explicitly how missingness is to be handled, because ' +
          'dropping it is itself a causal assumption.',
        'finite',
      );
    }
    if (spec.treatment[i] !== 0 && spec.treatment[i] !== 1) {
      throw new EngineError(`Treatment must be 0 or 1; unit ${i} has ${spec.treatment[i]}.`, 'binary');
    }
    nT += spec.treatment[i];
  }
  if (nT === 0 || nT === n) {
    throw new EngineError(
      `${nT === 0 ? 'No unit is treated' : 'Every unit is treated'}, so there is no contrast to estimate. A ` +
        'treatment effect requires units in both arms.',
      'one-arm',
    );
  }
  const level = spec.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`Confidence level must be in (0,1); got ${level}.`, 'range');
  return { n, level };
}

function psCovariates(spec: AdjustmentSpec): readonly Covariate[] {
  return spec.propensityCovariates ?? spec.covariates;
}
function outCovariates(spec: AdjustmentSpec): readonly Covariate[] {
  return spec.outcomeCovariates ?? spec.covariates;
}

/**
 * The unadjusted difference in means. Reported so the user can see what the
 * association is, and told plainly what it would take for that to be causal.
 */
export function naiveDifference(spec: AdjustmentSpec): CausalEstimate {
  const { n, level } = validate(spec);
  const t: number[] = [];
  const c: number[] = [];
  for (let i = 0; i < n; i++) (spec.treatment[i] === 1 ? t : c).push(spec.outcome[i]);
  if (t.length < 2 || c.length < 2) {
    throw new EngineError(
      `An unadjusted contrast needs at least two units per arm to have a variance; found ${t.length} treated and ` +
        `${c.length} control.`,
      'size',
    );
  }
  const est = mean(t) - mean(c);
  const se = Math.sqrt(variance(t, 1) / t.length + variance(c, 1) / c.length);
  return makeEstimate({
    method: 'Unadjusted difference in means',
    estimand: describeEstimand('ATE', '(and only if treatment was randomised)'),
    estimate: est,
    standardError: se,
    level,
    exactness: 'empirical',
    sample: accounting(spec.treatment, n, null, []),
    assumptions: [
      CONSISTENCY,
      SUTVA,
      {
        name: 'Unconditional ignorability (randomisation)',
        statement:
          'Treatment is independent of the potential outcomes with no conditioning at all: {Y(1), Y(0)} ⫫ T. ' +
          'This holds by construction in a randomised experiment and essentially never in observational data.',
        testable: false,
        ifViolated:
          'This number is an association, not an effect. It equals the causal effect plus the baseline difference ' +
          'between the kinds of unit that take the treatment and those that do not.',
      },
    ],
    inferenceNote: 'Welch standard error for a difference of two independent means.',
    notes: [
      'This is the number a user would compute without this module. It is included for comparison with the ' +
        'adjusted estimates: the gap between them is the measured confounding, and says nothing about the ' +
        'unmeasured confounding.',
    ],
  });
}

export interface TrimSpec {
  /** Keep units with propensity in [low, high]. */
  low?: number;
  high?: number;
  /** Keep only the common-support intersection of the two arms. */
  commonSupportOnly?: boolean;
}

export interface PropensityWorkspace {
  scores: number[];
  model: PropensityModel | null;
  overlap: OverlapReport;
  /** Indices kept after trimming. */
  kept: number[];
  trimNotes: string[];
  trimmed: boolean;
}

/**
 * Fit (or accept) the propensity score, check overlap and apply trimming.
 *
 * Trimming is where an honest module earns its keep: after it, the estimand is
 * the effect in the retained subpopulation and nothing else.
 */
export function propensityWorkspace(spec: AdjustmentSpec, trim?: TrimSpec): PropensityWorkspace {
  const { n } = validate(spec);
  let scores: number[];
  let model: PropensityModel | null = null;
  if (spec.propensityScores) {
    if (spec.propensityScores.length !== n) {
      throw new EngineError(`${n} units but ${spec.propensityScores.length} supplied propensity scores.`, 'length');
    }
    for (const s of spec.propensityScores) {
      if (!(s > 0 && s < 1)) {
        throw new EngineError(
          `A supplied propensity score of ${s} is not strictly inside (0,1). A score of exactly 0 or 1 says the ` +
            'unit could not possibly have received the other treatment, so its counterfactual is undefined and ' +
            'its inverse-probability weight is infinite. No estimate is produced from such scores.',
          'positivity',
        );
      }
    }
    scores = spec.propensityScores.slice();
  } else {
    model = fitPropensity(psCovariates(spec), spec.treatment);
    scores = model.scores;
  }
  const overlap = overlapReport(scores, spec.treatment);
  const lo = trim?.commonSupportOnly ? (overlap.commonSupport as [number, number])[0] : (trim?.low ?? 0);
  const hi = trim?.commonSupportOnly ? (overlap.commonSupport as [number, number])[1] : (trim?.high ?? 1);
  const kept: number[] = [];
  for (let i = 0; i < n; i++) if (scores[i] >= lo && scores[i] <= hi) kept.push(i);
  const trimmed = kept.length < n;
  const trimNotes: string[] = [];
  if (trimmed) {
    let keptT = 0;
    for (const i of kept) keptT += spec.treatment[i];
    if (keptT === 0 || keptT === kept.length) {
      throw new EngineError(
        `Trimming to the propensity range [${lo}, ${hi}] left ${keptT === 0 ? 'no treated' : 'no control'} units. ` +
          'There is no contrast inside the retained region, so no trimmed estimate exists.',
        'one-arm',
      );
    }
    trimNotes.push(
      `Trimmed to propensity scores in [${lo.toFixed(4)}, ${hi.toFixed(4)}]: ${n - kept.length} of ${n} units ` +
        `removed, leaving ${keptT} treated and ${kept.length - keptT} control.`,
      'THE ESTIMAND HAS CHANGED. This is no longer the average effect in the sample you supplied; it is the ' +
        'average effect among the retained units — those with enough overlap to have a comparison. That ' +
        'subpopulation is defined by the fitted propensity model, so it is not a group you can describe in ' +
        'advance, and the result does not transfer to the units that were dropped.',
    );
  }
  return { scores, model, overlap, kept, trimNotes, trimmed };
}

function subset<T>(xs: readonly T[], idx: readonly number[]): T[] {
  return idx.map((i) => xs[i]);
}

export interface IpwOptions {
  stabilised?: boolean;
  estimand?: 'ATE' | 'ATT';
  trim?: TrimSpec;
  /** Cap weights at this quantile of the weight distribution (Winsorising). */
  truncateAtQuantile?: number;
}

export interface IpwResult {
  estimate: CausalEstimate;
  weights: number[];
  weightDiagnostics: WeightReport;
  balance: BalanceReport;
  overlap: OverlapReport;
}

/**
 * Inverse-probability weighting, as the Hájek (weight-normalised) estimator.
 *
 * The normalised form is used rather than the raw Horvitz–Thompson average
 * because the raw version is not even guaranteed to lie inside the range of
 * the outcome, which would be a visibly impossible answer.
 */
export function ipwEstimate(spec: AdjustmentSpec, options: IpwOptions = {}): IpwResult {
  const { level } = validate(spec);
  const ws = propensityWorkspace(spec, options.trim);
  const idx = ws.kept;
  const estimand = options.estimand ?? 'ATE';
  const stabilised = options.stabilised ?? false;
  const y = subset(spec.outcome, idx);
  const t = subset(spec.treatment, idx);
  const e = subset(ws.scores, idx);
  const m = idx.length;
  const pTreat = t.reduce((a, b) => a + b, 0) / m;

  const w = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i++) {
    if (estimand === 'ATT') {
      w[i] = t[i] === 1 ? 1 : e[i] / (1 - e[i]);
    } else {
      w[i] = t[i] === 1 ? 1 / e[i] : 1 / (1 - e[i]);
      if (stabilised) w[i] *= t[i] === 1 ? pTreat : 1 - pTreat;
    }
    if (!Number.isFinite(w[i]) || w[i] < 0) {
      throw new EngineError(
        `Unit ${idx[i]} has an inverse-probability weight of ${w[i]} (propensity ${e[i]}). A non-finite weight ` +
          'means the model says this unit could not have received the other treatment, so no weighted average ' +
          'including it exists. Trim the sample explicitly rather than letting the weight blow up.',
        'weight',
      );
    }
  }
  const notes = ws.trimNotes.slice();
  if (options.truncateAtQuantile !== undefined) {
    const q = options.truncateAtQuantile;
    if (!(q > 0.5 && q < 1)) throw new EngineError('Weight truncation quantile must lie in (0.5, 1).', 'range');
    const sorted = w.slice().sort((a, b) => a - b);
    const cap = sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
    let capped = 0;
    for (let i = 0; i < m; i++)
      if (w[i] > cap) {
        w[i] = cap;
        capped++;
      }
    notes.push(
      `${capped} weight(s) truncated at the ${(q * 100).toFixed(0)}th percentile (${cap.toFixed(3)}). Truncation ` +
        'trades variance for bias: the estimator is no longer consistent for the ATE even if every assumption ' +
        'holds, because the heavy units are being under-counted on purpose.',
    );
  }

  let num1 = 0;
  let den1 = 0;
  let num0 = 0;
  let den0 = 0;
  for (let i = 0; i < m; i++) {
    if (t[i] === 1) {
      num1 += w[i] * y[i];
      den1 += w[i];
    } else {
      num0 += w[i] * y[i];
      den0 += w[i];
    }
  }
  if (!(den1 > 0) || !(den0 > 0)) {
    throw new EngineError('IPW: one arm carries zero total weight, so its weighted mean does not exist.', 'weight');
  }
  const mu1 = num1 / den1;
  const mu0 = num0 / den0;
  const est = mu1 - mu0;

  // Influence-function variance of the Hájek difference, treating the
  // propensity as known. Ignoring the estimation of e(X) is conservative for
  // the ATE (Lunceford & Davidian 2004), so the interval is if anything a
  // little wide — the safe direction for a causal claim.
  let v = 0;
  for (let i = 0; i < m; i++) {
    const psi = t[i] === 1 ? (w[i] / (den1 / m)) * (y[i] - mu1) : -(w[i] / (den0 / m)) * (y[i] - mu0);
    v += psi * psi;
  }
  const se = Math.sqrt(v) / m;

  const wDiag = weightReport(w, t, estimand === 'ATT' ? 'ipw-att' : stabilised ? 'stabilised-ate' : 'ipw-ate');
  const covs = outCovariates(spec).map((c) => ({ name: c.name, values: subset(c.values, idx) }));
  const bal = balanceReport(covs, t, w, 'weighting');
  const warnings = [...ws.overlap.warnings, ...wDiag.warnings, ...bal.warnings, ...(ws.model?.warnings ?? [])];

  const estimate = makeEstimate({
    method:
      (stabilised ? 'Stabilised inverse-probability weighting' : 'Inverse-probability weighting') +
      ` (Hájek, ${estimand})`,
    estimand: describeEstimand(ws.trimmed ? 'ATE-trimmed' : estimand === 'ATT' ? 'ATT' : 'ATE'),
    estimate: est,
    standardError: se,
    level,
    exactness: 'empirical',
    sample: accounting(spec.treatment, m, null, ws.trimNotes),
    assumptions: [...CORE_ADJUSTMENT, CORRECT_PS_MODEL],
    inferenceNote:
      'Influence-function standard error for the weight-normalised difference, treating the fitted propensity ' +
      'score as known. That omission makes the interval conservative rather than optimistic for the ATE.',
    warnings,
    notes: [
      ...notes,
      `Weighted means: treated ${mu1.toFixed(6)}, control ${mu0.toFixed(6)}.`,
      `Maximum weight ${wDiag.maxWeight.toFixed(3)}; effective sample size ${wDiag.effectiveSampleSize.toFixed(1)} ` +
        `of ${m} (treated ${wDiag.effectiveSampleSizeTreated.toFixed(1)}, control ` +
        `${wDiag.effectiveSampleSizeControl.toFixed(1)}).`,
    ],
  });
  return { estimate, weights: w, weightDiagnostics: wDiag, balance: bal, overlap: ws.overlap };
}

interface ArmModel {
  predictAll: number[];
  beta: number[];
  vcov: number[][];
  design: (i: number) => number[];
  n: number;
}

function fitArm(
  spec: AdjustmentSpec,
  idx: readonly number[],
  arm: 0 | 1,
  covs: readonly Covariate[],
): ArmModel {
  const rows = idx.filter((i) => spec.treatment[i] === arm);
  const p = covs.length + 1;
  if (rows.length <= p) {
    throw new EngineError(
      `Outcome model for the ${arm === 1 ? 'treated' : 'control'} arm: ${rows.length} units for ${p} parameters. ` +
        'The arm-specific regression is not estimable, so no standardised estimate is produced. Reduce the ' +
        'covariate set or accept that this arm is too small to model.',
      'underdetermined',
    );
  }
  const design = (i: number): number[] => [1, ...covs.map((c) => c.values[i])];
  const X = rows.map(design);
  const yv = rows.map((i) => spec.outcome[i]);
  const fit = leastSquares(X, yv, undefined, `Outcome model (${arm === 1 ? 'treated' : 'control'} arm)`);
  const vcov = robustVcovHC1(X, fit);
  const predictAll = idx.map((i) => {
    const d = design(i);
    let s = 0;
    for (let j = 0; j < p; j++) s += d[j] * fit.beta[j];
    return s;
  });
  return { predictAll, beta: fit.beta, vcov, design, n: rows.length };
}

export interface GComputationOptions {
  trim?: TrimSpec;
  /**
   * 'bootstrap' resamples units; 'delta' uses the analytic delta-method
   * variance of the standardised contrast. Bootstrap is the default because
   * standardisation is a non-linear functional of the fit in general.
   */
  inference?: 'bootstrap' | 'delta';
  bootstrapSamples?: number;
  seed?: Seed;
}

export interface GComputationResult {
  estimate: CausalEstimate;
  /** Per-unit predicted potential outcomes — the imputed counterfactuals. */
  predictedY1: number[];
  predictedY0: number[];
}

/**
 * Regression adjustment / g-computation (standardisation).
 *
 * Separate outcome models are fitted in each arm, each unit's two potential
 * outcomes are predicted, and the contrast is averaged over the sample. Fitting
 * the arms separately means treatment-by-covariate interactions are included
 * by construction, which a single pooled model with an additive treatment term
 * silently assumes away.
 */
export function gComputation(spec: AdjustmentSpec, options: GComputationOptions = {}): GComputationResult {
  const { level } = validate(spec);
  const ws = propensityWorkspace(spec, options.trim);
  const idx = ws.kept;
  const covs = outCovariates(spec);
  if (covs.length === 0) {
    throw new EngineError(
      'g-computation with no covariates is just the unadjusted difference in means. Supply the confounders you ' +
        'intend to standardise over, or call `naiveDifference`, which labels itself honestly.',
      'empty',
    );
  }
  for (const c of covs) {
    if (c.values.length !== spec.outcome.length) {
      throw new EngineError(`Covariate "${c.name}" has the wrong length.`, 'length');
    }
    const vals = idx.map((i) => c.values[i]);
    if (!(variance(vals, 1) > 0)) {
      throw new EngineError(
        `g-computation: covariate "${c.name}" has zero variance in the analysed sample, making the design matrix ` +
          'singular. Remove it.',
        'zero-variance',
      );
    }
  }
  const m1 = fitArm(spec, idx, 1, covs);
  const m0 = fitArm(spec, idx, 0, covs);
  const contrasts = m1.predictAll.map((a, k) => a - m0.predictAll[k]);
  const est = mean(contrasts);

  let se: number;
  let interval: ReturnType<typeof normalInterval> | null;
  let inferenceNote: string;
  const warnings = [...ws.overlap.warnings, ...(ws.model?.warnings ?? [])];
  const notes = ws.trimNotes.slice();

  if ((options.inference ?? 'bootstrap') === 'bootstrap') {
    const B = options.bootstrapSamples ?? 400;
    if (B < 50) throw new EngineError('Bootstrap standard errors need at least 50 resamples.', 'options');
    const rng = new Random(options.seed ?? 'g-computation');
    const draws: number[] = [];
    let failures = 0;
    for (let b = 0; b < B; b++) {
      const pick = Array.from({ length: idx.length }, () => idx[rng.int(0, idx.length - 1)]);
      try {
        const b1 = fitArm({ ...spec }, pick, 1, covs);
        const b0 = fitArm({ ...spec }, pick, 0, covs);
        draws.push(mean(b1.predictAll.map((a, k) => a - b0.predictAll[k])));
      } catch {
        failures++;
      }
    }
    if (draws.length < Math.max(50, 0.5 * B)) {
      throw new EngineError(
        `Bootstrap failed in ${failures} of ${B} resamples (only ${draws.length} succeeded), typically because a ` +
          'resample had too few units in one arm to fit the outcome model. With this much failure the bootstrap ' +
          'distribution is not the sampling distribution, so no standard error is reported.',
        'bootstrap',
      );
    }
    draws.sort((a, b) => a - b);
    const alpha = (1 - level) / 2;
    const at = (q: number): number => draws[Math.min(draws.length - 1, Math.max(0, Math.round(q * (draws.length - 1))))];
    interval = { low: at(alpha), high: at(1 - alpha), level };
    se = Math.sqrt(variance(draws, 1));
    inferenceNote = `Non-parametric bootstrap over units, ${draws.length} successful resamples of ${B}; percentile interval.`;
    if (failures > 0) {
      warnings.push(`${failures} of ${B} bootstrap resamples could not be fitted and were discarded.`);
    }
  } else {
    // Delta method. With linear arm models the standardised contrast is
    // (a1−a0) + x̄'(b1−b0), linear in the stacked coefficients, so the variance
    // is c'V1c + c'V0c plus the term from the sampling variability of x̄.
    const xbar = [1, ...covs.map((c) => mean(idx.map((i) => c.values[i])))];
    let v = 0;
    for (let a = 0; a < xbar.length; a++)
      for (let b = 0; b < xbar.length; b++) v += xbar[a] * (m1.vcov[a][b] + m0.vcov[a][b]) * xbar[b];
    const d = m1.beta.map((b, j) => b - m0.beta[j]);
    for (let a = 1; a < xbar.length; a++)
      for (let b = 1; b < xbar.length; b++) {
        let cab = 0;
        const ma = xbar[a];
        const mb = xbar[b];
        for (const i of idx) cab += (covs[a - 1].values[i] - ma) * (covs[b - 1].values[i] - mb);
        v += (d[a] * d[b] * cab) / (idx.length * (idx.length - 1));
      }
    se = Math.sqrt(v);
    interval = normalInterval(est, se, level);
    inferenceNote =
      'Delta-method standard error of the standardised contrast, with HC1 covariance for each arm model plus the ' +
      'sampling variability of the covariate means.';
  }

  const estimate = makeEstimate({
    method: 'g-computation (regression standardisation, separate model per arm)',
    estimand: describeEstimand(ws.trimmed ? 'ATE-trimmed' : 'ATE'),
    estimate: est,
    standardError: se,
    level,
    interval,
    exactness: 'empirical',
    sample: accounting(spec.treatment, idx.length, null, ws.trimNotes),
    assumptions: [...CORE_ADJUSTMENT, CORRECT_OUTCOME_MODEL],
    inferenceNote,
    warnings,
    notes: [
      ...notes,
      `Arm model sizes: ${m1.n} treated, ${m0.n} control, ${covs.length} covariate(s) plus intercept each.`,
      'Each unit\'s two potential outcomes are PREDICTIONS, not observations. For a unit with no comparable ' +
        'counterpart in the other arm the prediction is extrapolation, and the regression gives no sign that it ' +
        'has left the data.',
    ],
  });
  return { estimate, predictedY1: m1.predictAll, predictedY0: m0.predictAll };
}

export interface AipwResult {
  estimate: CausalEstimate;
  /** The per-unit influence contributions, for diagnostics. */
  influence: number[];
  weightDiagnostics: WeightReport;
  overlap: OverlapReport;
}

/**
 * Augmented inverse-probability weighting (doubly robust).
 *
 * ψ = [T/e·(Y−m₁) + m₁] − [(1−T)/(1−e)·(Y−m₀) + m₀], averaged over units.
 * Consistent if either the propensity model or the outcome model is right.
 */
export function aipwEstimate(spec: AdjustmentSpec, options: { trim?: TrimSpec } = {}): AipwResult {
  const { level } = validate(spec);
  const ws = propensityWorkspace(spec, options.trim);
  const idx = ws.kept;
  const covs = outCovariates(spec);
  if (covs.length === 0) {
    throw new EngineError('AIPW needs an outcome model; supply the covariates to regress the outcome on.', 'empty');
  }
  const m1 = fitArm(spec, idx, 1, covs);
  const m0 = fitArm(spec, idx, 0, covs);
  const m = idx.length;
  const psi = new Array<number>(m).fill(0);
  const w = new Array<number>(m).fill(0);
  const t: number[] = [];
  for (let k = 0; k < m; k++) {
    const i = idx[k];
    const e = ws.scores[i];
    const ti = spec.treatment[i];
    t.push(ti);
    w[k] = ti === 1 ? 1 / e : 1 / (1 - e);
    const a = (ti / e) * (spec.outcome[i] - m1.predictAll[k]) + m1.predictAll[k];
    const b = ((1 - ti) / (1 - e)) * (spec.outcome[i] - m0.predictAll[k]) + m0.predictAll[k];
    psi[k] = a - b;
  }
  const est = mean(psi);
  const se = Math.sqrt(variance(psi, 1) / m);
  const wDiag = weightReport(w, t, 'ipw-ate');
  const estimate = makeEstimate({
    method: 'AIPW / doubly robust augmented weighting',
    estimand: describeEstimand(ws.trimmed ? 'ATE-trimmed' : 'ATE'),
    estimate: est,
    standardError: se,
    level,
    exactness: 'empirical',
    sample: accounting(spec.treatment, m, null, ws.trimNotes),
    assumptions: [...CORE_ADJUSTMENT, DOUBLE_ROBUSTNESS],
    inferenceNote:
      'Influence-function standard error: the sample standard deviation of the per-unit augmented contrast ' +
      'divided by √n. Valid when at least one of the two nuisance models is correctly specified.',
    warnings: [...ws.overlap.warnings, ...wDiag.warnings, ...(ws.model?.warnings ?? [])],
    notes: [
      ...ws.trimNotes,
      'Double robustness protects against getting ONE of the two nuisance models wrong. It does nothing about a ' +
        'confounder that was never measured: if X is incomplete, both models are wrong in the same way and the ' +
        'estimate is biased like any other.',
      `Maximum inverse-probability weight ${wDiag.maxWeight.toFixed(3)}; effective sample size ` +
        `${wDiag.effectiveSampleSize.toFixed(1)} of ${m}.`,
    ],
  });
  return { estimate, influence: psi, weightDiagnostics: wDiag, overlap: ws.overlap };
}

/**
 * Targeted maximum likelihood estimation with a logistic fluctuation.
 *
 * The outcome is mapped to [0,1] using its own observed range (or a supplied
 * range), the initial arm predictions are mapped with it, and a single
 * fluctuation parameter ε is solved from the clever-covariate score equation.
 * The result is doubly robust and, unlike AIPW, respects the bounds of the
 * outcome by construction.
 */
export function tmleEstimate(
  spec: AdjustmentSpec,
  options: { trim?: TrimSpec; outcomeRange?: [number, number] } = {},
): CausalEstimate {
  const { level } = validate(spec);
  const ws = propensityWorkspace(spec, options.trim);
  const idx = ws.kept;
  const covs = outCovariates(spec);
  if (covs.length === 0) throw new EngineError('TMLE needs an outcome model; supply covariates.', 'empty');
  const ys = idx.map((i) => spec.outcome[i]);
  const a = options.outcomeRange ? options.outcomeRange[0] : Math.min(...ys);
  const b = options.outcomeRange ? options.outcomeRange[1] : Math.max(...ys);
  if (!(b > a)) {
    throw new EngineError(
      'TMLE: the outcome is constant in the analysed sample, so there is no variation to explain and the ' +
        'logistic fluctuation is undefined. A constant outcome means the effect is exactly zero by inspection; ' +
        'no model is fitted.',
      'zero-variance',
    );
  }
  const m1 = fitArm(spec, idx, 1, covs);
  const m0 = fitArm(spec, idx, 0, covs);
  const m = idx.length;
  const scale = (v: number): number => clamp((v - a) / (b - a), 1e-6, 1 - 1e-6);
  const logit = (p: number): number => Math.log(p / (1 - p));
  const expit = (x: number): number => 1 / (1 + Math.exp(-x));
  const yStar = ys.map(scale);
  const q1 = m1.predictAll.map(scale);
  const q0 = m0.predictAll.map(scale);
  const qA: number[] = [];
  const H: number[] = [];
  for (let k = 0; k < m; k++) {
    const i = idx[k];
    const ti = spec.treatment[i];
    const e = ws.scores[i];
    qA.push(ti === 1 ? q1[k] : q0[k]);
    H.push(ti === 1 ? 1 / e : -1 / (1 - e));
  }
  const score = (eps: number): number => {
    let s = 0;
    for (let k = 0; k < m; k++) s += H[k] * (yStar[k] - expit(logit(qA[k]) + eps * H[k]));
    return s;
  };
  let eps: number;
  const s0 = score(0);
  if (Math.abs(s0) < 1e-12) eps = 0;
  else {
    let lo = -1;
    let hi = 1;
    let tries = 0;
    while (score(lo) * score(hi) > 0 && tries < 40) {
      lo *= 2;
      hi *= 2;
      tries++;
    }
    if (score(lo) * score(hi) > 0) {
      throw new EngineError(
        'TMLE: the fluctuation parameter could not be bracketed — the score equation has no sign change over a ' +
          'range of ±2^40. This happens when extreme propensity scores make the clever covariate enormous, so the ' +
          'targeting step is numerically meaningless. No TMLE estimate is reported; trim the sample or use AIPW ' +
          'with explicit weight diagnostics.',
        'convergence',
      );
    }
    const root = brentRoot(score, lo, hi, { tol: 1e-12, maxIter: 200 });
    if (!Number.isFinite(root)) {
      throw new EngineError('TMLE: the targeting step did not converge; no estimate is reported.', 'convergence');
    }
    eps = root;
  }
  const q1s = q1.map((q, k) => expit(logit(q) + eps * (1 / ws.scores[idx[k]])));
  const q0s = q0.map((q, k) => expit(logit(q) - eps * (1 / (1 - ws.scores[idx[k]]))));
  const est = (b - a) * mean(q1s.map((v, k) => v - q0s[k]));
  // Influence curve of the targeted estimator, on the original outcome scale.
  const psiBar = mean(q1s.map((v, k) => v - q0s[k]));
  const ic = new Array<number>(m).fill(0);
  for (let k = 0; k < m; k++) {
    const qAs = spec.treatment[idx[k]] === 1 ? q1s[k] : q0s[k];
    ic[k] = (b - a) * (H[k] * (yStar[k] - qAs) + (q1s[k] - q0s[k]) - psiBar);
  }
  const se = Math.sqrt(variance(ic, 1) / m);
  return makeEstimate({
    method: 'TMLE (targeted maximum likelihood, logistic fluctuation)',
    estimand: describeEstimand(ws.trimmed ? 'ATE-trimmed' : 'ATE'),
    estimate: est,
    standardError: se,
    level,
    exactness: 'empirical',
    sample: accounting(spec.treatment, m, null, ws.trimNotes),
    assumptions: [...CORE_ADJUSTMENT, DOUBLE_ROBUSTNESS],
    inferenceNote: 'Efficient influence-curve standard error after the targeting step.',
    warnings: [...ws.overlap.warnings, ...(ws.model?.warnings ?? [])],
    notes: [
      ...ws.trimNotes,
      `Fluctuation parameter ε = ${eps.toExponential(3)}; outcome mapped through the range [${a}, ${b}].`,
      'TMLE is doubly robust and efficient, which means its interval is the narrowest an honest estimator can ' +
        'offer under these assumptions. Narrow is not the same as correct: the assumptions are still untestable.',
    ],
  });
}

/**
 * The matched-sample estimate. For one-to-one matching without replacement the
 * standard error is the paired one; otherwise a unit-level bootstrap over
 * treated units is used, because reused controls break independence.
 */
export function matchedEstimate(
  spec: AdjustmentSpec,
  match: MatchResult,
  options: { seed?: Seed } = {},
): CausalEstimate {
  void options;
  const { level } = validate(spec);
  if (match.pairs.length === 0) throw new EngineError('Matched estimate: no pairs.', 'no-pairs');
  const diffs = match.pairs.map((p) => spec.outcome[p.treated] - spec.outcome[p.control]);
  const est = mean(diffs);
  const controlUse = new Map<number, number>();
  for (const p of match.pairs) controlUse.set(p.control, (controlUse.get(p.control) ?? 0) + 1);
  const reused = [...controlUse.values()].some((k) => k > 1);
  let se: number;
  // Left undefined for the paired case so that `makeEstimate` builds the
  // normal interval; set explicitly to a percentile interval when bootstrapped.
  let interval: ReturnType<typeof normalInterval> | undefined;
  let note: string;
  if (!reused) {
    if (diffs.length < 2) {
      throw new EngineError(
        `Matched estimate: only ${diffs.length} pair. A single pair has no variance, so no standard error or ` +
          'interval exists; the point estimate alone is the difference between two units and carries no ' +
          'information about an average.',
        'size',
      );
    }
    se = Math.sqrt(variance(diffs, 1) / diffs.length);
    note = `Paired standard error over ${diffs.length} independent matched pairs.`;
  } else {
    // Abadie–Imbens (2006) variance for matching WITH replacement. The paired
    // variance alone is wrong here: a control used K times appears in K pair
    // differences, which are then correlated. The second term below is exactly
    // that extra variance, and without it the interval is far too narrow.
    const tau = est;
    let term1 = 0;
    for (const d of diffs) term1 += (d - tau) * (d - tau);
    const n1 = diffs.length;
    const controlIdx: number[] = [];
    for (let i = 0; i < spec.treatment.length; i++) if (spec.treatment[i] === 0) controlIdx.push(i);
    // Within-arm nearest-neighbour variance estimate σ̂²(X_i, 0) = (Y_i − Y_j)²/2.
    const dv = match.distanceValues;
    const sigma2 = new Map<number, number>();
    if (dv) {
      for (const c of controlUse.keys()) {
        let best = -1;
        let bestD = Infinity;
        for (const o of controlIdx) {
          if (o === c) continue;
          const dd = Math.abs(dv[c] - dv[o]);
          if (dd < bestD) {
            bestD = dd;
            best = o;
          }
        }
        if (best < 0) {
          throw new EngineError(
            'Matched variance: a used control unit has no other control to form a within-arm variance estimate ' +
              'against, so the Abadie–Imbens variance is not computable. With a single control unit there is no ' +
              'replication to estimate the outcome variance from.',
            'size',
          );
        }
        const diff = spec.outcome[c] - spec.outcome[best];
        sigma2.set(c, (diff * diff) / 2);
      }
    } else {
      const pooled = variance(controlIdx.map((i) => spec.outcome[i]), 1);
      for (const c of controlUse.keys()) sigma2.set(c, pooled);
    }
    let term2 = 0;
    for (const [c, K] of controlUse) term2 += K * (K - 1) * (sigma2.get(c) as number);
    const v = (term1 + term2) / (n1 * n1);
    if (!(v > 0)) {
      throw new EngineError(
        'Matched variance: the Abadie–Imbens estimator came out non-positive, which means every matched ' +
          'difference is identical and no sampling variability can be estimated. No standard error is reported.',
        'variance',
      );
    }
    se = Math.sqrt(v);
    note =
      'Abadie–Imbens (2006) variance for matching with replacement: the variance of the matched differences plus ' +
      `the extra term from reusing controls (${[...controlUse.values()].filter((k) => k > 1).length} control ` +
      'unit(s) matched more than once), with the within-arm outcome variance estimated by each control\'s nearest ' +
      'neighbour in its own arm. It does not account for the propensity score having been estimated from these ' +
      'same data.';
  }
  return makeEstimate({
    method: match.method + ' — matched contrast',
    estimand: describeEstimand('ATT-matched'),
    estimate: est,
    standardError: se,
    level,
    interval,
    exactness: 'empirical',
    sample: {
      ...accounting(spec.treatment, match.pairs.length * 2, match.nMatched, match.dropReasons),
      nUsed: new Set([...match.pairs.map((p) => p.treated), ...match.pairs.map((p) => p.control)]).size,
    },
    assumptions: [...CORE_ADJUSTMENT, CORRECT_PS_MODEL],
    inferenceNote: note,
    warnings: match.warnings,
    notes: [
      ...match.dropReasons,
      `Pair distances: mean ${match.meanDistance.toExponential(3)}, maximum ${match.maxDistance.toExponential(3)}.`,
      'Matching removes imbalance in the covariates it matched on, and only those. It cannot remove imbalance in ' +
        'anything unmeasured, and a well-balanced matched sample is not evidence that nothing was missed.',
    ],
  });
}

/** Stratified (subclassified) estimate on the propensity score. */
export function stratifiedEstimate(
  spec: AdjustmentSpec,
  options: { nStrata?: number; weightBy?: 'ATE' | 'ATT' } = {},
): CausalEstimate {
  const { n, level } = validate(spec);
  const ws = propensityWorkspace(spec);
  const { strata, warnings } = propensityStrata(ws.scores, spec.treatment, spec.outcome, options.nStrata ?? 5);
  const kept = strata.filter((s) => s.retained);
  const weightBy = options.weightBy ?? 'ATE';
  let totalW = 0;
  let est = 0;
  let varSum = 0;
  let used = 0;
  for (const s of kept) {
    const w = weightBy === 'ATT' ? s.nTreated : s.nTreated + s.nControl;
    totalW += w;
    est += w * (s.effect as number);
    used += s.nTreated + s.nControl;
  }
  if (!(totalW > 0)) throw new EngineError('Stratified estimate: no stratum carries any weight.', 'weight');
  est /= totalW;
  // Within-stratum variances of the two arm means.
  for (const s of kept) {
    const tVals: number[] = [];
    const cVals: number[] = [];
    for (let i = 0; i < n; i++) {
      if (ws.scores[i] > s.low && ws.scores[i] <= s.high) (spec.treatment[i] === 1 ? tVals : cVals).push(spec.outcome[i]);
    }
    if (tVals.length < 2 || cVals.length < 2) {
      warnings.push(
        `A retained stratum has ${tVals.length} treated and ${cVals.length} control units, too few for a variance. ` +
          'Its contribution to the standard error is omitted, so the interval is narrower than it should be.',
      );
      continue;
    }
    const w = (weightBy === 'ATT' ? s.nTreated : s.nTreated + s.nControl) / totalW;
    varSum += w * w * (variance(tVals, 1) / tVals.length + variance(cVals, 1) / cVals.length);
  }
  if (!(varSum > 0)) {
    throw new EngineError(
      'Stratified estimate: no stratum had enough units in both arms to contribute a variance, so no standard ' +
        'error exists. Use fewer strata or a weighting estimator.',
      'variance',
    );
  }
  return makeEstimate({
    method: `Propensity-score stratification (${kept.length} retained strata, ${weightBy} weighting)`,
    estimand: describeEstimand(weightBy === 'ATT' ? 'ATT' : 'ATE'),
    estimate: est,
    standardError: Math.sqrt(varSum),
    level,
    exactness: 'empirical',
    sample: accounting(spec.treatment, used, null, warnings),
    assumptions: [...CORE_ADJUSTMENT, CORRECT_PS_MODEL],
    inferenceNote: 'Stratum-weighted difference in means with the stratum-weighted sum of within-stratum variances.',
    warnings: [...warnings, ...ws.overlap.warnings],
    notes: [
      'Stratification assumes units within a propensity stratum are exchangeable. Coarse strata leave residual ' +
        'confounding inside each one; fine strata empty an arm. The per-stratum effects are reported so that a ' +
        'constant effect is not assumed where the strata disagree.',
      ...strata.map(
        (s) =>
          `Stratum (${s.low === -Infinity ? '−∞' : s.low.toFixed(4)}, ${s.high === Infinity ? '∞' : s.high.toFixed(4)}]: ` +
          `${s.nTreated} treated, ${s.nControl} control, effect ${s.effect === null ? 'not identified (empty arm)' : s.effect.toFixed(6)}`,
      ),
    ],
  });
}
