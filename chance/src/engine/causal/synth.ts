/**
 * Synthetic control for a single treated unit.
 *
 * The counterfactual is a convex combination of donor units chosen to track
 * the treated unit before the intervention. Inference is by placebo: the whole
 * procedure is re-run pretending each donor was treated, and the treated
 * unit's post/pre fit ratio is placed in that distribution. With a handful of
 * donors the smallest achievable p-value is 1/(number of units), and the
 * result says so rather than implying more precision than exists.
 */

import { EngineError } from '../core/result.ts';
import { SC_FIT, SC_NO_SPILLOVER, CONSISTENCY, describeEstimand } from './assumptions.ts';
import { makeEstimate } from './build.ts';
import type { CausalEstimate } from './types.ts';

export interface SyntheticControlSpec {
  /** Outcome path of the treated unit, in time order. */
  treatedOutcome: readonly number[];
  /** One entry per donor, each the same length as `treatedOutcome`. */
  donors: readonly { name: string; outcome: readonly number[] }[];
  /** Number of leading periods that precede the intervention. */
  preperiods: number;
  /** Optional time labels for the plot data. */
  times?: readonly number[];
  /** Iterations of the projected-gradient solve. */
  maxIterations?: number;
}

/** Euclidean projection onto the probability simplex (Wang & Carreira-Perpiñán). */
function projectSimplex(v: readonly number[]): number[] {
  const n = v.length;
  const u = v.slice().sort((a, b) => b - a);
  let css = 0;
  let rho = 0;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    css += u[i];
    const t = (css - 1) / (i + 1);
    if (u[i] - t > 0) {
      rho = i + 1;
      theta = t;
    }
  }
  if (rho === 0) theta = (css - 1) / n;
  return v.map((x) => Math.max(0, x - theta));
}

interface SolveResult {
  weights: number[];
  preRmspe: number;
}

function solveWeights(target: readonly number[], donors: readonly number[][], pre: number, maxIter: number): SolveResult {
  const J = donors.length;
  let w = new Array<number>(J).fill(1 / J);
  // Lipschitz-ish step size from the donor Gram matrix diagonal.
  let scale = 0;
  for (let t = 0; t < pre; t++) for (let j = 0; j < J; j++) scale += donors[j][t] * donors[j][t];
  const step = scale > 0 ? pre / scale : 1;
  let prev = Infinity;
  for (let it = 0; it < maxIter; it++) {
    const grad = new Array<number>(J).fill(0);
    let sse = 0;
    for (let t = 0; t < pre; t++) {
      let f = 0;
      for (let j = 0; j < J; j++) f += w[j] * donors[j][t];
      const r = f - target[t];
      sse += r * r;
      for (let j = 0; j < J; j++) grad[j] += (2 * r * donors[j][t]) / pre;
    }
    if (Math.abs(prev - sse) < 1e-16 * Math.max(1, Math.abs(prev))) break;
    prev = sse;
    w = projectSimplex(w.map((x, j) => x - step * grad[j]));
  }
  let sse = 0;
  for (let t = 0; t < pre; t++) {
    let f = 0;
    for (let j = 0; j < J; j++) f += w[j] * donors[j][t];
    sse += (f - target[t]) * (f - target[t]);
  }
  return { weights: w, preRmspe: Math.sqrt(sse / pre) };
}

export interface SyntheticControlResult {
  estimate: CausalEstimate;
  /** Donor weights, summing to 1. */
  weights: { name: string; weight: number }[];
  /** The synthetic counterfactual path and the gap, for plotting. */
  synthetic: number[];
  gap: number[];
  times: number[];
  preRmspe: number;
  postRmspe: number;
  /** post/pre RMSPE ratio for the treated unit and each placebo donor. */
  placebo: { name: string; ratio: number; preRmspe: number }[];
  placeboPValue: number;
  /** Mean gap over the post-intervention periods. */
  averagePostGap: number;
}

export function syntheticControl(spec: SyntheticControlSpec): SyntheticControlResult {
  const T = spec.treatedOutcome.length;
  const pre = spec.preperiods;
  if (spec.donors.length === 0) {
    throw new EngineError(
      'Synthetic control: no donor units were supplied. The method builds the counterfactual from untreated ' +
        'units; with none there is nothing to build it from.',
      'empty',
    );
  }
  if (pre < 2) {
    throw new EngineError(
      `Synthetic control: ${pre} pre-intervention period(s). The donor weights are chosen to match the treated ` +
        'unit before the intervention, which needs several periods; with fewer than two the weights are ' +
        'unidentified and the "fit" is vacuous. No estimate is reported.',
      'size',
    );
  }
  if (pre >= T) {
    throw new EngineError(
      `Synthetic control: ${pre} pre-intervention periods out of ${T} total, leaving none after the ` +
        'intervention. There is no post-intervention gap to report.',
      'size',
    );
  }
  for (const d of spec.donors) {
    if (d.outcome.length !== T) {
      throw new EngineError(
        `Synthetic control: donor "${d.name}" has ${d.outcome.length} periods but the treated unit has ${T}. ` +
          'The method needs a balanced panel.',
        'length',
      );
    }
    for (const v of d.outcome) {
      if (!Number.isFinite(v)) {
        throw new EngineError(`Synthetic control: donor "${d.name}" has a non-finite outcome.`, 'finite');
      }
    }
  }
  if (pre < spec.donors.length) {
    // Not an error, but the fit is then trivially achievable and meaningless.
    // Recorded as a warning on the result below.
  }
  const donors = spec.donors.map((d) => d.outcome.slice());
  const maxIter = spec.maxIterations ?? 5000;
  const main = solveWeights(spec.treatedOutcome, donors, pre, maxIter);
  const synthetic = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) {
    let f = 0;
    for (let j = 0; j < donors.length; j++) f += main.weights[j] * donors[j][t];
    synthetic[t] = f;
  }
  const gap = spec.treatedOutcome.map((y, t) => y - synthetic[t]);
  let postSse = 0;
  for (let t = pre; t < T; t++) postSse += gap[t] * gap[t];
  const postRmspe = Math.sqrt(postSse / (T - pre));
  const averagePostGap = gap.slice(pre).reduce((a, b) => a + b, 0) / (T - pre);

  // Placebo: treat each donor as if it were the treated unit.
  const placebo: SyntheticControlResult['placebo'] = [];
  for (let k = 0; k < donors.length; k++) {
    const others = donors.filter((_, j) => j !== k);
    if (others.length === 0) continue;
    const sol = solveWeights(donors[k], others, pre, maxIter);
    let preS = 0;
    let postS = 0;
    for (let t = 0; t < T; t++) {
      let f = 0;
      for (let j = 0; j < others.length; j++) f += sol.weights[j] * others[j][t];
      const g = donors[k][t] - f;
      if (t < pre) preS += g * g;
      else postS += g * g;
    }
    const preR = Math.sqrt(preS / pre);
    const postR = Math.sqrt(postS / (T - pre));
    placebo.push({ name: spec.donors[k].name, ratio: preR > 0 ? postR / preR : Infinity, preRmspe: preR });
  }
  const treatedRatio = main.preRmspe > 0 ? postRmspe / main.preRmspe : Infinity;
  const allRatios = [treatedRatio, ...placebo.map((p) => p.ratio)];
  const rank = allRatios.filter((r) => r >= treatedRatio).length;
  const placeboPValue = rank / allRatios.length;

  const warnings: string[] = [];
  if (pre < spec.donors.length) {
    warnings.push(
      `There are ${spec.donors.length} donors and only ${pre} pre-intervention periods. With more donors than ` +
        'periods the pre-treatment fit can be made near-perfect by construction, so a good fit is no evidence ' +
        'at all that the synthetic unit tracks the counterfactual. The weights are also not unique.',
    );
  }
  const scaleY = Math.sqrt(
    spec.treatedOutcome.slice(0, pre).reduce((a, y, _, arr) => a + Math.pow(y - arr.reduce((s, v) => s + v, 0) / arr.length, 2), 0) /
      pre,
  );
  if (scaleY > 0 && main.preRmspe > 0.5 * scaleY) {
    warnings.push(
      `The pre-intervention fit is poor: RMSPE ${main.preRmspe.toPrecision(4)} against a pre-period standard ` +
        `deviation of ${scaleY.toPrecision(4)}. The synthetic unit does not reproduce the treated unit before the ` +
        'intervention, so there is no reason to think it reproduces the counterfactual after it. The gap is ' +
        'mostly fit error; it should not be reported as an effect.',
    );
  }
  if (allRatios.length < 20) {
    warnings.push(
      `Placebo inference uses ${allRatios.length} unit(s), so the smallest achievable p-value is ` +
        `${(1 / allRatios.length).toFixed(3)}. A p-value from this few placebos is a rank statement, not a ` +
        'calibrated probability, and no conventional significance threshold is meaningful here.',
    );
  }
  const concentrated = main.weights.filter((w) => w > 0.01).length;
  if (concentrated <= 2) {
    warnings.push(
      `The synthetic unit puts essentially all its weight on ${concentrated} donor(s). The counterfactual is ` +
        'then that donor\'s path, so the estimate inherits every idiosyncratic shock that hit it.',
    );
  }
  const times = spec.times ? spec.times.slice() : Array.from({ length: T }, (_, i) => i);

  const estimate = makeEstimate({
    method: 'Synthetic control (single treated unit, placebo inference)',
    estimand: describeEstimand('ATT', '— one treated unit, averaged over the post-intervention periods'),
    estimate: averagePostGap,
    standardError: null,
    level: 0.95,
    interval: null,
    pValue: placeboPValue,
    exactness: 'empirical',
    sample: {
      nTotal: 1 + spec.donors.length,
      nTreated: 1,
      nControl: spec.donors.length,
      nUsed: 1 + concentrated,
      nMatched: null,
      nDropped: spec.donors.length - concentrated,
      dropReasons: [
        `${spec.donors.length - concentrated} donor(s) receive weight below 0.01 and effectively do not ` +
          'contribute to the counterfactual.',
      ],
    },
    assumptions: [CONSISTENCY, SC_FIT, SC_NO_SPILLOVER],
    inferenceNote:
      `No standard error exists for a single treated unit: there is no replication to estimate sampling ` +
      `variability from. The reported p-value is a PLACEBO rank — the share of units (treated plus donors) whose ` +
      `post/pre fit ratio is at least as extreme as the treated unit's — over ${allRatios.length} units. It is a ` +
      'permutation statement about this fixed set of units, not a confidence statement about a population.',
    warnings,
    notes: [
      `Pre-intervention RMSPE ${main.preRmspe.toPrecision(5)}; post-intervention RMSPE ${postRmspe.toPrecision(5)}; ` +
        `ratio ${Number.isFinite(treatedRatio) ? treatedRatio.toPrecision(4) : 'infinite (perfect pre-fit)'}.`,
      `Donor weights: ${spec.donors
        .map((d, j) => `${d.name} ${main.weights[j].toFixed(4)}`)
        .filter((_, j) => main.weights[j] > 1e-4)
        .join(', ')}.`,
      `Placebo ratios: ${placebo.map((p) => `${p.name} ${Number.isFinite(p.ratio) ? p.ratio.toPrecision(3) : '∞'}`).join(', ')}.`,
      'The gap series is reported so the pre-intervention portion can be inspected. A gap that wanders before ' +
        'the intervention is the method telling you it cannot track this unit.',
    ],
  });
  return {
    estimate,
    weights: spec.donors.map((d, j) => ({ name: d.name, weight: main.weights[j] })),
    synthetic,
    gap,
    times,
    preRmspe: main.preRmspe,
    postRmspe,
    placebo,
    placeboPValue,
    averagePostGap,
  };
}
