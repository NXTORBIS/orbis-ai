/**
 * Difference-in-differences: the 2×2 estimator, two-way fixed effects, the
 * event study that lets the user look at the pre-trends, and cluster-robust
 * inference.
 *
 * The parallel-trends assumption is the whole design, and it is about a path
 * that was never observed. Flat pre-trends make it more believable; they do
 * not test it. Everything here says so.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import { normalQuantile } from '../special/gamma.ts';
import { fSurvival } from '../stats/tests.ts';
import { CONSISTENCY, NO_ANTICIPATION, PARALLEL_TRENDS, SUTVA, describeEstimand } from './assumptions.ts';
import { accounting, makeEstimate } from './build.ts';
import { clusterVcov, leastSquares, standardErrors, type LeastSquares } from './fit.ts';
import type { AssumptionStatement, CausalEstimate } from './types.ts';

export interface PanelRow {
  unit: string | number;
  time: number;
  outcome: number;
  /** 1 if this unit is under treatment in this period. */
  treated: number;
}

export interface PanelCovariate {
  name: string;
  values: readonly number[];
}

function indexBy<T>(keys: readonly T[]): { ids: number[]; levels: T[] } {
  const map = new Map<string, number>();
  const levels: T[] = [];
  const ids = keys.map((k) => {
    const s = String(k);
    let v = map.get(s);
    if (v === undefined) {
      v = levels.length;
      map.set(s, v);
      levels.push(k);
    }
    return v;
  });
  return { ids, levels };
}

/**
 * The canonical 2×2 difference-in-differences: (Ȳ_treated,post − Ȳ_treated,pre)
 * − (Ȳ_control,post − Ȳ_control,pre).
 *
 * All four cells must be non-empty. A design with one period or one group is
 * refused: with one period there is no change to difference, and with one
 * group there is nothing to difference against.
 */
export function diffInDiff2x2(
  outcome: readonly number[],
  group: readonly number[],
  post: readonly number[],
  options: { level?: number; clusters?: readonly (string | number)[] } = {},
): CausalEstimate {
  const n = outcome.length;
  if (n === 0) throw new EngineError('Difference-in-differences: no observations.', 'empty');
  if (group.length !== n || post.length !== n) {
    throw new EngineError('Difference-in-differences: group and period indicators must match the outcome length.', 'length');
  }
  const level = options.level ?? 0.95;
  const cells: number[][] = [[], [], [], []];
  for (let i = 0; i < n; i++) {
    if (group[i] !== 0 && group[i] !== 1) throw new EngineError(`Group must be 0 or 1; unit ${i} has ${group[i]}.`, 'binary');
    if (post[i] !== 0 && post[i] !== 1) throw new EngineError(`Period must be 0 or 1; unit ${i} has ${post[i]}.`, 'binary');
    if (!Number.isFinite(outcome[i])) throw new EngineError(`The outcome is non-finite at row ${i}.`, 'finite');
    cells[group[i] * 2 + post[i]].push(outcome[i]);
  }
  const names = ['control pre', 'control post', 'treated pre', 'treated post'];
  const empty = names.filter((_, k) => cells[k].length === 0);
  if (empty.length > 0) {
    const onePeriod = cells[0].length + cells[2].length === 0 || cells[1].length + cells[3].length === 0;
    const oneGroup = cells[0].length + cells[1].length === 0 || cells[2].length + cells[3].length === 0;
    throw new EngineError(
      `Difference-in-differences needs all four group × period cells to be non-empty; ${empty.join(', ')} ` +
        `${empty.length === 1 ? 'is' : 'are'} empty. ` +
        (onePeriod
          ? 'With observations in only one period there is no before-and-after change to difference, so the ' +
            'design does not exist — a cross-sectional comparison is all the data support, and it identifies ' +
            'nothing causal without ignorability.'
          : oneGroup
            ? 'With only one group there is nothing to difference against: any change over time is the treatment ' +
              'effect plus everything else that happened, and the two cannot be separated.'
            : 'The missing cell is the counterfactual trend; without it the estimator is not defined.'),
      'incomplete-design',
    );
  }
  const m = cells.map((c) => mean(c));
  const est = m[3] - m[2] - (m[1] - m[0]);
  const X: number[][] = [];
  for (let i = 0; i < n; i++) X.push([1, group[i], post[i], group[i] * post[i]]);
  const fit = leastSquares(X, outcome, undefined, 'Difference-in-differences');
  let se: number;
  let inferenceNote: string;
  const warnings: string[] = [];
  if (options.clusters) {
    const cv = clusterVcov(X, fit, options.clusters);
    se = standardErrors(cv.vcov)[3];
    inferenceNote = `Cluster-robust standard error over ${cv.nClusters} clusters.`;
    warnings.push(...cv.warnings);
  } else {
    let v = 0;
    for (let k = 0; k < 4; k++) {
      if (cells[k].length < 2) {
        throw new EngineError(
          `Difference-in-differences: the "${names[k]}" cell has ${cells[k].length} observation(s), too few for a ` +
            'variance. No standard error is reported — a point estimate from single observations has unknown ' +
            'precision, and pretending otherwise would be the fabrication this module exists to avoid.',
          'size',
        );
      }
      v += variance(cells[k], 1) / cells[k].length;
    }
    se = Math.sqrt(v);
    inferenceNote =
      'Standard error from the four independent cell means. This assumes observations are independent within a ' +
      'cell; with repeated observations on the same units, pass `clusters` — otherwise the interval is far too ' +
      'narrow.';
    warnings.push(
      'No cluster identifiers were supplied. If the same units appear in both periods, their residuals are ' +
        'correlated and this standard error is too small, often by a factor of several. Supply `clusters` with ' +
        'the unit identifier.',
    );
  }
  const z = normalQuantile(1 - (1 - level) / 2);
  return makeEstimate({
    method: '2×2 difference-in-differences',
    estimand: describeEstimand('ATT'),
    estimate: est,
    standardError: se,
    level,
    interval: { low: est - z * se, high: est + z * se, level },
    exactness: 'empirical',
    sample: accounting(group, n, null, []),
    assumptions: [CONSISTENCY, SUTVA, PARALLEL_TRENDS, NO_ANTICIPATION],
    inferenceNote,
    warnings,
    notes: [
      `Cell means — control pre ${m[0].toFixed(6)}, control post ${m[1].toFixed(6)}, treated pre ${m[2].toFixed(6)}, ` +
        `treated post ${m[3].toFixed(6)}.`,
      `Cell sizes — ${cells.map((c, k) => `${names[k]}: ${c.length}`).join(', ')}.`,
      `Treated group change ${(m[3] - m[2]).toFixed(6)}; control group change ${(m[1] - m[0]).toFixed(6)}. The ` +
        'estimate is the difference between those two changes, and it equals the causal effect only if the ' +
        'control change is what the treated group would have experienced.',
      'With only two periods there are no pre-trends to inspect. The parallel-trends assumption is therefore ' +
        'completely unexamined here — not merely untested but unexamined. Use `eventStudy` if more periods exist.',
    ],
  });
}

/** Alternating-projection two-way demeaning, for unit and time fixed effects. */
function twoWayDemean(
  values: readonly number[],
  unitIds: readonly number[],
  timeIds: readonly number[],
  nUnits: number,
  nTimes: number,
): number[] {
  const x = values.slice();
  for (let iter = 0; iter < 200; iter++) {
    let maxShift = 0;
    for (const [ids, count] of [
      [unitIds, nUnits],
      [timeIds, nTimes],
    ] as const) {
      const sum = new Array<number>(count).fill(0);
      const cnt = new Array<number>(count).fill(0);
      for (let i = 0; i < x.length; i++) {
        sum[ids[i]] += x[i];
        cnt[ids[i]]++;
      }
      for (let i = 0; i < x.length; i++) {
        const g = ids[i];
        if (cnt[g] === 0) continue;
        const shift = sum[g] / cnt[g];
        x[i] -= shift;
        if (Math.abs(shift) > maxShift) maxShift = Math.abs(shift);
      }
    }
    if (maxShift < 1e-12) break;
  }
  return x;
}

export interface TwfeResult {
  estimate: CausalEstimate;
  nUnits: number;
  nPeriods: number;
  /** Adoption cohorts: distinct first-treatment times among treated units. */
  cohorts: { firstTreated: number | null; nUnits: number }[];
  staggered: boolean;
}

/**
 * Two-way fixed-effects difference-in-differences, fitted by absorbing the
 * unit and time effects through alternating projections.
 *
 * When adoption is staggered this estimator is reported with the modern
 * warning: it is a weighted average of many 2×2 comparisons, some of which use
 * already-treated units as controls, and some of those weights are NEGATIVE,
 * so the coefficient need not lie between any of the underlying effects.
 */
export function twoWayFixedEffects(
  panel: readonly PanelRow[],
  options: { level?: number; covariates?: readonly PanelCovariate[]; clusterByUnit?: boolean } = {},
): TwfeResult {
  if (panel.length === 0) throw new EngineError('Two-way fixed effects: no rows supplied.', 'empty');
  const level = options.level ?? 0.95;
  const { ids: unitIds, levels: unitLevels } = indexBy(panel.map((r) => r.unit));
  const { ids: timeIds, levels: timeLevels } = indexBy(panel.map((r) => r.time));
  const nUnits = unitLevels.length;
  const nTimes = timeLevels.length;
  if (nTimes < 2) {
    throw new EngineError(
      `Two-way fixed effects: the panel has only ${nTimes} time period. A difference-in-differences design needs ` +
        'at least two periods — with one period the time fixed effect absorbs everything and the treatment ' +
        'coefficient is not identified. No estimate is reported.',
      'single-period',
    );
  }
  if (nUnits < 2) {
    throw new EngineError(
      `Two-way fixed effects: the panel has only ${nUnits} unit. With one unit there is no untreated comparison ` +
        'and the unit fixed effect absorbs the level, so nothing distinguishes the treatment from any other ' +
        'change over time. This is an interrupted time series, not a DiD; use `interruptedTimeSeries` and accept ' +
        'its weaker assumption.',
      'single-group',
    );
  }
  for (const r of panel) {
    if (r.treated !== 0 && r.treated !== 1) {
      throw new EngineError(`Two-way fixed effects: the treated indicator must be 0 or 1; found ${r.treated}.`, 'binary');
    }
    if (!Number.isFinite(r.outcome)) throw new EngineError('Two-way fixed effects: a non-finite outcome.', 'finite');
  }
  let anyTreated = 0;
  for (const r of panel) anyTreated += r.treated;
  if (anyTreated === 0 || anyTreated === panel.length) {
    throw new EngineError(
      `Two-way fixed effects: ${anyTreated === 0 ? 'no row is treated' : 'every row is treated'}. There is no ` +
        'variation in treatment status to exploit, so the coefficient is not identified.',
      'no-variation',
    );
  }
  // Adoption cohorts.
  const firstTreated = new Map<number, number | null>();
  for (let i = 0; i < panel.length; i++) {
    const u = unitIds[i];
    if (!firstTreated.has(u)) firstTreated.set(u, null);
    if (panel[i].treated === 1) {
      const cur = firstTreated.get(u);
      if (cur === null || cur === undefined || panel[i].time < cur) firstTreated.set(u, panel[i].time);
    }
  }
  const cohortMap = new Map<string, number>();
  for (const v of firstTreated.values()) cohortMap.set(String(v), (cohortMap.get(String(v)) ?? 0) + 1);
  const cohorts = [...cohortMap.entries()].map(([k, v]) => ({
    firstTreated: k === 'null' ? null : Number(k),
    nUnits: v,
  }));
  const treatedCohorts = cohorts.filter((c) => c.firstTreated !== null);
  const staggered = treatedCohorts.length > 1;

  const covs = options.covariates ?? [];
  for (const c of covs) {
    if (c.values.length !== panel.length) throw new EngineError(`Covariate "${c.name}" has the wrong length.`, 'length');
  }
  const d = twoWayDemean(panel.map((r) => r.treated), unitIds, timeIds, nUnits, nTimes);
  if (!(variance(d, 1) > 1e-20)) {
    throw new EngineError(
      'Two-way fixed effects: after absorbing the unit and time effects the treatment indicator has no variation ' +
        'left. Every unit switches at the same time, so the treatment is collinear with the time effects and the ' +
        'effect cannot be separated from a common shock. No estimate is reported.',
      'collinear',
    );
  }
  const y = twoWayDemean(panel.map((r) => r.outcome), unitIds, timeIds, nUnits, nTimes);
  const demeanedCovs = covs.map((c) => twoWayDemean(c.values, unitIds, timeIds, nUnits, nTimes));
  const X = panel.map((_, i) => [d[i], ...demeanedCovs.map((c) => c[i])]);
  const absorbed = nUnits + nTimes - 1;
  const fit = leastSquares(X, y, undefined, 'Two-way fixed effects');
  // Correct the residual degrees of freedom for the absorbed fixed effects.
  const dfAdj = panel.length - absorbed - X[0].length;
  if (dfAdj <= 0) {
    throw new EngineError(
      `Two-way fixed effects: ${panel.length} rows cannot support ${absorbed} fixed effects plus ${X[0].length} ` +
        'regressor(s). The model is saturated, the residual variance is zero by construction and no standard ' +
        'error exists.',
      'underdetermined',
    );
  }
  const rss = fit.residuals.reduce((a, r) => a + r * r, 0);
  const adjusted: LeastSquares = { ...fit, sigma2: rss / dfAdj, df: dfAdj };
  let se: number;
  let inferenceNote: string;
  const warnings: string[] = [];
  if (options.clusterByUnit ?? true) {
    const cv = clusterVcov(X, adjusted, unitIds);
    se = standardErrors(cv.vcov)[0];
    inferenceNote =
      `Cluster-robust standard error over ${cv.nClusters} units, with the residual degrees of freedom corrected ` +
      `for the ${absorbed} absorbed fixed effects.`;
    warnings.push(...cv.warnings);
  } else {
    se = Math.sqrt(adjusted.xwxInv[0][0] * adjusted.sigma2);
    inferenceNote = 'Classical standard error with the degrees of freedom corrected for the absorbed fixed effects.';
    warnings.push(
      'Standard errors are not clustered. Panel residuals are serially correlated within a unit, so this ' +
        'interval is too narrow; cluster by unit unless you have a specific reason not to.',
    );
  }
  if (staggered) {
    warnings.push(
      `STAGGERED ADOPTION: units start treatment at ${treatedCohorts.length} different times ` +
        `(${treatedCohorts.map((c) => c.firstTreated).join(', ')}). The two-way fixed-effects coefficient is a ` +
        'weighted average of every available 2×2 comparison, and some of those comparisons use ALREADY-TREATED ' +
        'units as the control group. Goodman-Bacon (2021) shows the implied weights can be NEGATIVE, and ' +
        'de Chaisemartin–D\'Haultfœuille (2020) show that with a negative weight the coefficient can have the ' +
        'opposite sign to every single unit-level effect — even when parallel trends holds exactly. If the effect ' +
        'grows or fades over time this is not a corner case, it is the normal situation. Read the event study ' +
        'below, and prefer a cohort-time estimator (Callaway–Sant\'Anna, Sun–Abraham) over this coefficient.',
    );
  }
  const z = normalQuantile(1 - (1 - level) / 2);
  const estimate = makeEstimate({
    method: 'Two-way fixed-effects difference-in-differences',
    estimand: describeEstimand(staggered ? 'ATT-event-time' : 'ATT'),
    estimate: fit.beta[0],
    standardError: se,
    level,
    interval: { low: fit.beta[0] - z * se, high: fit.beta[0] + z * se, level },
    exactness: 'empirical',
    sample: accounting(
      panel.map((r) => r.treated),
      panel.length,
      null,
      [],
    ),
    assumptions: [
      CONSISTENCY,
      SUTVA,
      PARALLEL_TRENDS,
      NO_ANTICIPATION,
      {
        name: 'Homogeneous effects across cohorts and time (two-way fixed effects only)',
        statement:
          'The treatment effect is the same for every unit and does not change with time since adoption. The ' +
          'single two-way fixed-effects coefficient is only a sensible summary under this condition.',
        testable: false,
        ifViolated:
          'The coefficient is a weighted average with possibly negative weights and need not lie within the ' +
          'range of the true effects.',
      },
    ],
    inferenceNote,
    warnings,
    notes: [
      `${nUnits} units × ${nTimes} periods, ${panel.length} rows, ${absorbed} fixed effects absorbed.`,
      `Adoption cohorts: ${cohorts
        .map((c) => `${c.firstTreated === null ? 'never treated' : `first treated at ${c.firstTreated}`}: ${c.nUnits} unit(s)`)
        .join('; ')}.`,
      cohorts.some((c) => c.firstTreated === null)
        ? 'A never-treated group exists, which gives the cleanest available control.'
        : 'There is NO never-treated group. Every comparison relies on not-yet-treated units, so the late ' +
          'adopters do all the work of the control group and the estimate is only as good as their trend.',
    ],
  });
  return { estimate, nUnits, nPeriods: nTimes, cohorts, staggered };
}

export interface EventStudyPoint {
  /** Periods relative to the unit's own adoption. Negative is pre-treatment. */
  eventTime: number;
  coefficient: number;
  standardError: number;
  ciLow: number;
  ciHigh: number;
  nObservations: number;
  /** True for the omitted reference period, whose coefficient is 0 by construction. */
  reference: boolean;
}

export interface EventStudyResult {
  points: EventStudyPoint[];
  /** Joint test that all pre-treatment coefficients are zero. */
  preTrendTest: { statistic: number; numeratorDf: number; denominatorDf: number; pValue: number } | null;
  referenceEventTime: number;
  warnings: string[];
  notes: string[];
  assumptions: AssumptionStatement[];
  untestability: string;
}

/**
 * Event study / dynamic difference-in-differences: one coefficient per period
 * relative to adoption, with the reference period omitted.
 *
 * The pre-treatment coefficients are the point of this: they are the plot the
 * user should look at before believing any DiD number. They are reported as
 * data, with a joint test, and with a clear statement of what passing it does
 * and does not establish.
 */
export function eventStudy(
  panel: readonly PanelRow[],
  options: { level?: number; referenceEventTime?: number; minObservations?: number; window?: [number, number] } = {},
): EventStudyResult {
  if (panel.length === 0) throw new EngineError('Event study: no rows supplied.', 'empty');
  const level = options.level ?? 0.95;
  const { ids: unitIds, levels: unitLevels } = indexBy(panel.map((r) => r.unit));
  const { ids: timeIds, levels: timeLevels } = indexBy(panel.map((r) => r.time));
  const nUnits = unitLevels.length;
  const nTimes = timeLevels.length;
  if (nTimes < 3) {
    throw new EngineError(
      `Event study: ${nTimes} time period(s). Inspecting pre-trends needs at least two pre-treatment periods plus ` +
        'one post-treatment period. With fewer there is nothing to plot, and a 2×2 DiD is all the data support — ' +
        'with its parallel-trends assumption completely unexamined.',
      'single-period',
    );
  }
  const first = new Map<number, number | null>();
  for (let i = 0; i < panel.length; i++) {
    const u = unitIds[i];
    if (!first.has(u)) first.set(u, null);
    if (panel[i].treated === 1) {
      const cur = first.get(u);
      if (cur === null || cur === undefined || panel[i].time < cur) first.set(u, panel[i].time);
    }
  }
  const everTreated = [...first.values()].filter((v) => v !== null).length;
  if (everTreated === 0) {
    throw new EngineError('Event study: no unit is ever treated, so there is no event to study.', 'no-variation');
  }
  const eventTime: (number | null)[] = panel.map((r, i) => {
    const f = first.get(unitIds[i]);
    return f === null || f === undefined ? null : r.time - f;
  });
  const ref = options.referenceEventTime ?? -1;
  const window = options.window;
  const present = new Map<number, number>();
  for (const e of eventTime) {
    if (e === null) continue;
    if (window && (e < window[0] || e > window[1])) continue;
    present.set(e, (present.get(e) ?? 0) + 1);
  }
  const minObs = options.minObservations ?? 2;
  const levelsE = [...present.keys()].filter((e) => e !== ref && (present.get(e) as number) >= minObs).sort((a, b) => a - b);
  if (!present.has(ref)) {
    throw new EngineError(
      `Event study: the reference event time ${ref} does not occur in the data, so there is nothing to normalise ` +
        'against. Choose a reference period that exists.',
      'reference',
    );
  }
  if (levelsE.length === 0) {
    throw new EngineError('Event study: no event-time period other than the reference has enough observations.', 'size');
  }
  const dummies = levelsE.map((e) => panel.map((_, i) => (eventTime[i] === e ? 1 : 0)));
  const demeaned = dummies.map((dd) => twoWayDemean(dd, unitIds, timeIds, nUnits, nTimes));
  const y = twoWayDemean(panel.map((r) => r.outcome), unitIds, timeIds, nUnits, nTimes);
  const X = panel.map((_, i) => demeaned.map((c) => c[i]));
  const absorbed = nUnits + nTimes - 1;
  const fit = leastSquares(X, y, undefined, 'Event study');
  const dfAdj = panel.length - absorbed - X[0].length;
  if (dfAdj <= 0) {
    throw new EngineError(
      `Event study: ${panel.length} rows cannot support ${absorbed} fixed effects plus ${X[0].length} event-time ` +
        'coefficients. Narrow the event window.',
      'underdetermined',
    );
  }
  const rss = fit.residuals.reduce((a, r) => a + r * r, 0);
  const adjusted: LeastSquares = { ...fit, sigma2: rss / dfAdj, df: dfAdj };
  const cv = clusterVcov(X, adjusted, unitIds);
  const se = standardErrors(cv.vcov);
  const z = normalQuantile(1 - (1 - level) / 2);
  const points: EventStudyPoint[] = levelsE.map((e, j) => ({
    eventTime: e,
    coefficient: fit.beta[j],
    standardError: se[j],
    ciLow: fit.beta[j] - z * se[j],
    ciHigh: fit.beta[j] + z * se[j],
    nObservations: present.get(e) as number,
    reference: false,
  }));
  points.push({
    eventTime: ref,
    coefficient: 0,
    standardError: 0,
    ciLow: 0,
    ciHigh: 0,
    nObservations: present.get(ref) as number,
    reference: true,
  });
  points.sort((a, b) => a.eventTime - b.eventTime);

  // Joint test of the pre-treatment coefficients, by comparing the restricted fit.
  const preIdx = levelsE.map((e, j) => ({ e, j })).filter((x) => x.e < 0);
  let preTrendTest: EventStudyResult['preTrendTest'] = null;
  const warnings = cv.warnings.slice();
  if (preIdx.length > 0) {
    const keep = levelsE.map((_, j) => j).filter((j) => !preIdx.some((p) => p.j === j));
    const Xr = panel.map((_, i) => keep.map((j) => demeaned[j][i]));
    const rssR =
      keep.length === 0
        ? y.reduce((a, v) => a + v * v, 0)
        : leastSquares(Xr, y, undefined, 'Event study (restricted)').residuals.reduce((a, r) => a + r * r, 0);
    const f = ((rssR - rss) / preIdx.length) / (rss / dfAdj);
    preTrendTest = {
      statistic: f,
      numeratorDf: preIdx.length,
      denominatorDf: dfAdj,
      pValue: fSurvival(Math.max(f, 0), preIdx.length, dfAdj),
    };
    if (preTrendTest.pValue < 0.05) {
      warnings.push(
        `PRE-TRENDS REJECTED: the ${preIdx.length} pre-treatment event-time coefficients are jointly different ` +
          `from zero (F = ${f.toFixed(3)}, p = ${preTrendTest.pValue.toExponential(2)}). The treated and control ` +
          'groups were already moving apart before treatment began, which is direct evidence against parallel ' +
          'trends. The difference-in-differences estimate is not a treatment effect: it contains the ' +
          'continuation of this divergence. Do not report the DiD coefficient as causal.',
      );
    } else {
      warnings.push(
        `Pre-trends are not rejected (F = ${f.toFixed(3)}, p = ${preTrendTest.pValue.toFixed(3)}), but this is a ` +
          'weak reassurance and not a test of the assumption. The test has low power — small samples fail to ' +
          'reject real divergence routinely — and parallel pre-trends are logically compatible with ' +
          'non-parallel counterfactual post-trends. Passing this test does not make the estimate causal.',
      );
    }
    if (preIdx.length === 1) {
      warnings.push(
        'Only one pre-treatment period other than the reference is available, so the "pre-trend" is a single ' +
          'point. A trend cannot be seen in one point.',
      );
    }
  } else {
    warnings.push(
      'No pre-treatment periods are available before the reference period, so the pre-trends cannot be inspected ' +
        'at all. The identifying assumption is entirely unexamined.',
    );
  }
  const anticipation = points.filter((p) => p.eventTime < 0 && !p.reference && (p.ciLow > 0 || p.ciHigh < 0));
  if (anticipation.length > 0) {
    warnings.push(
      `Individually significant pre-treatment coefficients at event time(s) ${anticipation
        .map((p) => p.eventTime)
        .join(', ')}. Either the groups were diverging already, or units anticipated the treatment. Either way ` +
        'the "before" period is contaminated.',
    );
  }
  return {
    points,
    preTrendTest,
    referenceEventTime: ref,
    warnings,
    notes: [
      `Event-time coefficients relative to event time ${ref}, which is normalised to zero by construction. ` +
        'The level of the whole path is therefore arbitrary; only differences between periods are meaningful.',
      `${nUnits} units × ${nTimes} periods; ${everTreated} unit(s) ever treated.`,
      'These coefficients are the data for the pre-trend plot. Look at them before quoting any DiD estimate.',
    ],
    assumptions: [PARALLEL_TRENDS, NO_ANTICIPATION, CONSISTENCY, SUTVA],
    untestability:
      'Parallel trends is an assumption about an unobserved counterfactual path and cannot be tested. The ' +
      'pre-trend coefficients above examine a necessary-looking implication only.',
  };
}

export interface ItsResult {
  estimate: CausalEstimate;
  /** Immediate level change at the intervention. */
  levelChange: { estimate: number; standardError: number };
  /** Change in slope after the intervention. */
  slopeChange: { estimate: number; standardError: number };
}

/**
 * Interrupted time series on a single series: level and slope change at the
 * intervention, against the extrapolated pre-intervention trend.
 *
 * With no control series, anything else that happened at the same time is
 * indistinguishable from the intervention. That is said in the result, because
 * ITS is frequently presented with the confidence of a DiD while resting on a
 * strictly weaker design.
 */
export function interruptedTimeSeries(
  time: readonly number[],
  outcome: readonly number[],
  interventionTime: number,
  options: { level?: number } = {},
): ItsResult {
  const n = time.length;
  if (outcome.length !== n) throw new EngineError('Interrupted time series: time and outcome lengths differ.', 'length');
  const level = options.level ?? 0.95;
  const pre = time.filter((t) => t < interventionTime).length;
  const post = n - pre;
  if (pre < 3 || post < 3) {
    throw new EngineError(
      `Interrupted time series: ${pre} pre-intervention and ${post} post-intervention observations. At least three ` +
        'on each side are needed to estimate a level and a slope with any residual degrees of freedom. With ' +
        (pre < 3 ? 'too few pre-intervention points the counterfactual trend is not estimated, only asserted.' : 'too few post-intervention points the level and slope change cannot be separated.'),
      'size',
    );
  }
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const afterT = time[i] >= interventionTime ? 1 : 0;
    X.push([1, time[i] - interventionTime, afterT, afterT * (time[i] - interventionTime)]);
  }
  const fit = leastSquares(X, outcome, undefined, 'Interrupted time series');
  const se = standardErrors(fit.xwxInv.map((r) => r.map((v) => v * fit.sigma2)));
  const z = normalQuantile(1 - (1 - level) / 2);
  // Serial correlation check on the residuals (lag-1 autocorrelation).
  let num = 0;
  let den = 0;
  const rbar = mean(fit.residuals);
  for (let i = 1; i < n; i++) num += (fit.residuals[i] - rbar) * (fit.residuals[i - 1] - rbar);
  for (let i = 0; i < n; i++) den += (fit.residuals[i] - rbar) * (fit.residuals[i] - rbar);
  const rho = den > 0 ? num / den : 0;
  const warnings: string[] = [];
  if (Math.abs(rho) > 2 / Math.sqrt(n)) {
    warnings.push(
      `The residuals are autocorrelated (lag-1 ρ = ${rho.toFixed(3)}). Ordinary standard errors assume ` +
        'independent errors, so these intervals are too narrow — often substantially. Model the serial ' +
        'correlation before quoting the p-value.',
    );
  }
  const estimate = makeEstimate({
    method: 'Interrupted time series (level and slope change)',
    estimand: describeEstimand('ATT', '— the single treated series, at the moment of the intervention'),
    estimate: fit.beta[2],
    standardError: se[2],
    level,
    interval: { low: fit.beta[2] - z * se[2], high: fit.beta[2] + z * se[2], level },
    exactness: 'empirical',
    sample: {
      nTotal: n,
      nTreated: post,
      nControl: pre,
      nUsed: n,
      nMatched: null,
      nDropped: 0,
      dropReasons: [],
    },
    assumptions: [
      CONSISTENCY,
      {
        name: 'The pre-intervention trend would have continued',
        statement:
          'Absent the intervention the series would have followed its fitted pre-intervention level and linear ' +
          'slope through the post-intervention period.',
        testable: false,
        ifViolated: 'The estimate is the sum of the effect and whatever else changed, with no way to separate them.',
      },
      {
        name: 'No concurrent change (no control series)',
        statement:
          'Nothing else that affects the outcome changed at the intervention time. With a single series there is ' +
          'no control group to difference away a common shock, so this must be assumed outright.',
        testable: false,
        ifViolated: 'A coincident event is attributed entirely to the intervention.',
      },
      {
        name: 'Correct functional form for the trend',
        statement: 'The pre-intervention trend is linear in time on this scale.',
        testable: false,
        ifViolated:
          'A curved trend extrapolated linearly produces a spurious level change at the intervention, whose ' +
          'size grows with the length of the post period.',
      },
    ],
    inferenceNote: 'Classical standard errors from the segmented regression; no serial-correlation correction.',
    warnings,
    notes: [
      `Level change at the intervention: ${fit.beta[2].toFixed(6)} (SE ${se[2].toFixed(6)}).`,
      `Slope change after the intervention: ${fit.beta[3].toFixed(6)} (SE ${se[3].toFixed(6)}) per unit of time.`,
      `Pre-intervention slope: ${fit.beta[1].toFixed(6)}.`,
      'This design has NO control group. Every rival explanation that is coincident with the intervention — a ' +
        'policy announced at the same time, a seasonal turn, a change in how the outcome is measured — produces ' +
        'exactly the same jump. A difference-in-differences with a comparison series is strictly stronger where ' +
        'one is available.',
    ],
  });
  return {
    estimate,
    levelChange: { estimate: fit.beta[2], standardError: se[2] },
    slopeChange: { estimate: fit.beta[3], standardError: se[3] },
  };
}
