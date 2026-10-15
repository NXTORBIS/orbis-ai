/**
 * Group comparison: the weighted log-rank family, its stratified version, a
 * trend test across ordered groups, and crossing-curve detection.
 *
 * The weights are not a detail. The log-rank test is the most powerful member
 * of this family only under proportional hazards; when the curves cross it can
 * be badly underpowered, and a different weight can flip the conclusion. Every
 * result therefore names the weight it used and says what it assumes.
 */

import { attempt, EngineError, Validator, type EngineResult, type Explanation } from '../core/result.ts';
import { incompleteGamma } from '../special/gamma.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import {
  INDEPENDENT_CENSORING,
  censoringNote,
  heavyCensoringWarnings,
  summarizeFollowUp,
  validateSurvivalInput,
  type FollowUpSummary,
} from './data.ts';
import { kaplanMeierOrThrow } from './km.ts';

export type LogRankWeight =
  | { kind: 'log-rank' }
  | { kind: 'gehan-breslow-wilcoxon' }
  | { kind: 'tarone-ware' }
  | { kind: 'peto-peto' }
  | { kind: 'fleming-harrington'; p: number; q: number };

export const WEIGHT_DESCRIPTION: Record<string, string> = {
  'log-rank': 'w_j = 1. Equal weight to every event time; most powerful under proportional hazards.',
  'gehan-breslow-wilcoxon': 'w_j = n_j. Weights early event times, where the risk set is large.',
  'tarone-ware': 'w_j = √n_j. A compromise between log-rank and Gehan–Breslow–Wilcoxon.',
  'peto-peto': 'w_j = S̃(t_j), a modified pooled survival estimate. Weights early events, more robust to unequal censoring than Gehan.',
  'fleming-harrington':
    'w_j = Ŝ(t_{j−1})^p (1 − Ŝ(t_{j−1}))^q. p > q weights early differences, q > p weights late ones; p = q = 0 is the log-rank.',
};

export const PROPORTIONAL_HAZARDS_CAVEAT =
  'The log-rank test is the most powerful test of this family when the hazards are proportional. ' +
  'When the survival curves cross — an early advantage that reverses later — the positive and ' +
  'negative contributions cancel and the log-rank test can be badly underpowered, while a single ' +
  'hazard ratio describes nothing real. In that situation compare restricted mean survival times, ' +
  'or report survival at pre-specified time points, instead of a single test or ratio.';

export interface LogRankGroupResult {
  group: number | string;
  n: number;
  observed: number;
  expected: number;
  /** Weighted O − E; for w = 1 this is the usual observed minus expected. */
  weightedDifference: number;
  /** O/E ratio; reported only when expected > 0. */
  observedOverExpected: number | null;
}

export interface LogRankResult {
  weight: LogRankWeight;
  weightDescription: string;
  groups: LogRankGroupResult[];
  statistic: number;
  degreesOfFreedom: number;
  pValue: number;
  summary: FollowUpSummary;
  /** Per-group follow-up and censoring, since unequal censoring matters here. */
  groupSummaries: { group: number | string; summary: FollowUpSummary }[];
  /** Number of distinct event times contributing to the statistic. */
  eventTimesUsed: number;
  explanation: Explanation;
}

function chiSquareSurvival(x: number, df: number): number {
  if (df <= 0) throw new EngineError('Chi-square degrees of freedom must be positive.', 'domain');
  if (!(x >= 0)) throw new EngineError('Chi-square statistic must be non-negative.', 'domain');
  if (x === 0) return 1;
  return incompleteGamma(df / 2, x / 2).upper;
}

export { chiSquareSurvival };

interface GroupedTable {
  groups: (number | string)[];
  /** Per event time: at-risk and events by group, plus pooled counts. */
  times: {
    time: number;
    atRisk: number;
    events: number;
    atRiskByGroup: number[];
    eventsByGroup: number[];
  }[];
}

function groupedRiskTable(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
): GroupedTable {
  const groups = [...new Set(group)].sort((a, b) =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
  );
  const gi = new Map(groups.map((g, i) => [g, i]));
  const byTime = new Map<number, { events: number[]; exits: number[] }>();
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    let cell = byTime.get(t);
    if (!cell) {
      cell = { events: new Array<number>(groups.length).fill(0), exits: new Array<number>(groups.length).fill(0) };
      byTime.set(t, cell);
    }
    const g = gi.get(group[i])!;
    cell.exits[g]++;
    if (status[i] === 1) cell.events[g]++;
  }
  const remaining = groups.map((g) => group.filter((x) => x === g).length);
  const times: GroupedTable['times'] = [];
  for (const t of [...byTime.keys()].sort((a, b) => a - b)) {
    const cell = byTime.get(t)!;
    const totalEvents = cell.events.reduce((a, b) => a + b, 0);
    if (totalEvents > 0) {
      times.push({
        time: t,
        atRisk: remaining.reduce((a, b) => a + b, 0),
        events: totalEvents,
        atRiskByGroup: [...remaining],
        eventsByGroup: [...cell.events],
      });
    }
    for (let g = 0; g < groups.length; g++) remaining[g] -= cell.exits[g];
  }
  return { groups, times };
}

function validateGroups(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
): void {
  validateSurvivalInput(time, status);
  const v = new Validator();
  if (group.length !== time.length) {
    v.add(
      `Mismatched lengths: ${time.length} times but ${group.length} group labels.`,
      'group',
      'length',
    );
    v.throwIfInvalid();
  }
  const distinct = new Set(group);
  if (distinct.size < 2) {
    v.add(
      `Only ${distinct.size} distinct group${distinct.size === 1 ? '' : 's'} supplied; a comparison needs at least 2.`,
      'group',
      'groups',
    );
  }
  v.throwIfInvalid();
}

function weightSeries(
  table: GroupedTable,
  weight: LogRankWeight,
): number[] {
  const n = table.times.length;
  switch (weight.kind) {
    case 'log-rank':
      return new Array<number>(n).fill(1);
    case 'gehan-breslow-wilcoxon':
      return table.times.map((t) => t.atRisk);
    case 'tarone-ware':
      return table.times.map((t) => Math.sqrt(t.atRisk));
    case 'peto-peto': {
      // S̃(t_j) = Π_{t_i ≤ t_j} (1 − d_i/(n_i + 1)).
      const out: number[] = [];
      let s = 1;
      for (const t of table.times) {
        s *= 1 - t.events / (t.atRisk + 1);
        out.push(s);
      }
      return out;
    }
    case 'fleming-harrington': {
      const v = new Validator();
      v.nonNegative(weight.p, 'p', 'Fleming–Harrington p');
      v.nonNegative(weight.q, 'q', 'Fleming–Harrington q');
      v.throwIfInvalid();
      // Uses the pooled Kaplan–Meier at the previous event time (left-continuous).
      const out: number[] = [];
      let sPrev = 1;
      for (const t of table.times) {
        out.push(Math.pow(sPrev, weight.p) * Math.pow(1 - sPrev, weight.q));
        sPrev *= 1 - t.events / t.atRisk;
      }
      return out;
    }
  }
}

function weightKey(weight: LogRankWeight): string {
  return weight.kind;
}

/** Accumulated weighted O−E vector and its covariance over event times. */
interface Accumulated {
  z: number[];
  v: Matrix;
  observed: number[];
  expected: number[];
  weightedDiff: number[];
  eventTimes: number;
}

function accumulate(table: GroupedTable, weights: readonly number[]): Accumulated {
  const G = table.groups.length;
  const z = new Array<number>(G).fill(0);
  const observed = new Array<number>(G).fill(0);
  const expected = new Array<number>(G).fill(0);
  const v: Matrix = Array.from({ length: G }, () => new Array<number>(G).fill(0));
  let used = 0;
  table.times.forEach((row, j) => {
    const w = weights[j];
    const n = row.atRisk;
    const d = row.events;
    for (let g = 0; g < G; g++) {
      const e = (d * row.atRiskByGroup[g]) / n;
      observed[g] += row.eventsByGroup[g];
      expected[g] += e;
      z[g] += w * (row.eventsByGroup[g] - e);
    }
    if (n > 1) {
      used++;
      const factor = (d * (n - d)) / (n - 1);
      for (let g = 0; g < G; g++) {
        for (let h = 0; h < G; h++) {
          const term =
            factor *
            ((g === h ? row.atRiskByGroup[g] / n : 0) - (row.atRiskByGroup[g] * row.atRiskByGroup[h]) / (n * n));
          v[g][h] += w * w * term;
        }
      }
    }
  });
  return { z, v, observed, expected, weightedDiff: z, eventTimes: used };
}

function quadraticForm(z: readonly number[], v: Matrix, G: number): number {
  // Drop the last group: the vector sums to zero, so the full covariance is singular.
  const k = G - 1;
  const zr = z.slice(0, k);
  const vr: Matrix = Array.from({ length: k }, (_, i) => v[i].slice(0, k));
  const sol = solve(vr, zr);
  if (!sol) {
    throw new EngineError([
      {
        code: 'singular',
        message:
          'The covariance matrix of the weighted log-rank scores is singular, so the test statistic ' +
          'is undefined. This happens when a group contributes no information (no subjects at risk ' +
          'at any event time) or when groups are duplicated.',
        field: 'group',
      },
    ]);
  }
  let q = 0;
  for (let i = 0; i < k; i++) q += zr[i] * sol[i];
  return q;
}

export interface LogRankOptions {
  weight?: LogRankWeight;
}

/** Weighted log-rank test across two or more groups. */
export function logRankTest(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
  options: LogRankOptions = {},
): EngineResult<LogRankResult> {
  return attempt(() => {
    validateGroups(time, status, group);
    const weight = options.weight ?? { kind: 'log-rank' };
    const table = groupedRiskTable(time, status, group);
    if (table.times.length === 0) {
      throw new EngineError([
        { code: 'no-events', message: 'No events were observed, so no groups can be compared.', field: 'status' },
      ]);
    }
    const weights = weightSeries(table, weight);
    const acc = accumulate(table, weights);
    const G = table.groups.length;
    const statistic = quadraticForm(acc.z, acc.v, G);
    const df = G - 1;
    const pValue = chiSquareSurvival(statistic, df);
    const summary = summarizeFollowUp(time, status);
    const groupSummaries = table.groups.map((g) => {
      const idx: number[] = [];
      for (let i = 0; i < group.length; i++) if (group[i] === g) idx.push(i);
      return {
        group: g,
        summary: summarizeFollowUp(
          idx.map((i) => time[i]),
          idx.map((i) => status[i]),
        ),
      };
    });
    const groups: LogRankGroupResult[] = table.groups.map((g, i) => ({
      group: g,
      n: groupSummaries[i].summary.n,
      observed: acc.observed[i],
      expected: acc.expected[i],
      weightedDifference: acc.weightedDiff[i],
      observedOverExpected: acc.expected[i] > 0 ? acc.observed[i] / acc.expected[i] : null,
    }));
    const unequalCensoring = (() => {
      const fs = groupSummaries.map((s) => s.summary.censoringFraction);
      return Math.max(...fs) - Math.min(...fs) > 0.2;
    })();
    const steps = [
      { label: 'Sample', value: censoringNote(summary) },
      { label: 'Weight', value: `${weightKey(weight)} — ${WEIGHT_DESCRIPTION[weightKey(weight)]}` },
      { label: 'Event times used', value: String(acc.eventTimes) },
      { label: 'Statistic', expression: 'χ² = zᵀ V⁻¹ z', value: statistic.toFixed(6) },
      { label: 'Degrees of freedom', value: String(df) },
      ...groups.map((g) => ({
        label: `Group ${String(g.group)}`,
        value: `n = ${g.n}, observed ${g.observed}, expected ${g.expected.toFixed(3)}`,
      })),
      ...heavyCensoringWarnings(summary).map((w) => ({ label: 'Warning', value: w })),
      ...(unequalCensoring
        ? [
            {
              label: 'Warning',
              value:
                'Censoring differs markedly between groups. Weighted tests (Gehan in particular) are ' +
                'sensitive to that; Peto–Peto or the unweighted log-rank are safer here.',
            },
          ]
        : []),
    ];
    return {
      weight,
      weightDescription: WEIGHT_DESCRIPTION[weightKey(weight)],
      groups,
      statistic,
      degreesOfFreedom: df,
      pValue,
      summary,
      groupSummaries,
      eventTimesUsed: acc.eventTimes,
      explanation: {
        method: `Weighted log-rank test (${weightKey(weight)})`,
        formula: 'z_g = Σ_j w_j (d_{jg} − d_j n_{jg}/n_j),  χ² = zᵀ V⁻¹ z',
        steps,
        assumptions: [
          INDEPENDENT_CENSORING,
          'The p-value comes from the asymptotic chi-square distribution of the score statistic, not from an exact permutation distribution.',
        ],
        limitations: [
          PROPORTIONAL_HAZARDS_CAVEAT,
          'Different weights answer different questions. Choosing the weight after seeing the curves invalidates the p-value.',
          'A non-significant result is not evidence of equal survival, particularly at low event counts.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

export interface StratifiedLogRankResult extends Omit<LogRankResult, 'groupSummaries'> {
  strata: { stratum: number | string; eventTimes: number }[];
  groupSummaries: { group: number | string; summary: FollowUpSummary }[];
}

/**
 * Stratified log-rank: scores and covariances are accumulated within strata and
 * summed, so differences in baseline hazard between strata do not contribute.
 */
export function stratifiedLogRankTest(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
  stratum: readonly (number | string)[],
  options: LogRankOptions = {},
): EngineResult<StratifiedLogRankResult> {
  return attempt(() => {
    validateGroups(time, status, group);
    const v0 = new Validator();
    if (stratum.length !== time.length) {
      v0.add(`Mismatched lengths: ${time.length} times but ${stratum.length} stratum labels.`, 'stratum', 'length');
    }
    v0.throwIfInvalid();
    const weight = options.weight ?? { kind: 'log-rank' };
    const allGroups = [...new Set(group)].sort((a, b) =>
      typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)),
    );
    const G = allGroups.length;
    const z = new Array<number>(G).fill(0);
    const observed = new Array<number>(G).fill(0);
    const expected = new Array<number>(G).fill(0);
    const V: Matrix = Array.from({ length: G }, () => new Array<number>(G).fill(0));
    const strataInfo: { stratum: number | string; eventTimes: number }[] = [];
    let totalTimes = 0;
    for (const s of [...new Set(stratum)]) {
      const idx: number[] = [];
      for (let i = 0; i < stratum.length; i++) if (stratum[i] === s) idx.push(i);
      const st = idx.map((i) => time[i]);
      const ss = idx.map((i) => status[i]);
      const sg = idx.map((i) => group[i]);
      if (!ss.some((x) => x === 1)) {
        strataInfo.push({ stratum: s, eventTimes: 0 });
        continue;
      }
      const table = groupedRiskTable(st, ss, sg);
      const weights = weightSeries(table, weight);
      const acc = accumulate(table, weights);
      // Map this stratum's group indices onto the global group ordering.
      const map = table.groups.map((g) => allGroups.indexOf(g));
      for (let a = 0; a < table.groups.length; a++) {
        z[map[a]] += acc.z[a];
        observed[map[a]] += acc.observed[a];
        expected[map[a]] += acc.expected[a];
        for (let b = 0; b < table.groups.length; b++) V[map[a]][map[b]] += acc.v[a][b];
      }
      strataInfo.push({ stratum: s, eventTimes: acc.eventTimes });
      totalTimes += acc.eventTimes;
    }
    if (totalTimes === 0) {
      throw new EngineError([
        {
          code: 'no-events',
          message: 'No stratum contained an event time with more than one subject at risk; the stratified test is undefined.',
          field: 'stratum',
        },
      ]);
    }
    const statistic = quadraticForm(z, V, G);
    const df = G - 1;
    const summary = summarizeFollowUp(time, status);
    const groupSummaries = allGroups.map((g) => {
      const idx: number[] = [];
      for (let i = 0; i < group.length; i++) if (group[i] === g) idx.push(i);
      return {
        group: g,
        summary: summarizeFollowUp(
          idx.map((i) => time[i]),
          idx.map((i) => status[i]),
        ),
      };
    });
    return {
      weight,
      weightDescription: WEIGHT_DESCRIPTION[weightKey(weight)],
      groups: allGroups.map((g, i) => ({
        group: g,
        n: groupSummaries[i].summary.n,
        observed: observed[i],
        expected: expected[i],
        weightedDifference: z[i],
        observedOverExpected: expected[i] > 0 ? observed[i] / expected[i] : null,
      })),
      statistic,
      degreesOfFreedom: df,
      pValue: chiSquareSurvival(statistic, df),
      summary,
      groupSummaries,
      strata: strataInfo,
      eventTimesUsed: totalTimes,
      explanation: {
        method: `Stratified weighted log-rank test (${weightKey(weight)})`,
        formula: 'z = Σ_strata z^(s),  V = Σ_strata V^(s)',
        steps: [
          { label: 'Sample', value: censoringNote(summary) },
          { label: 'Strata', value: String(strataInfo.length) },
          { label: 'Statistic', value: statistic.toFixed(6) },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'The group effect is assumed common across strata; only the baseline hazard may differ. If the group effect itself differs by stratum, the stratified test averages over a real interaction.',
        ],
        limitations: [
          PROPORTIONAL_HAZARDS_CAVEAT,
          'Strata with no events contribute nothing and are listed as such.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

export interface TrendTestResult {
  scores: number[];
  groups: (number | string)[];
  statistic: number;
  degreesOfFreedom: 1;
  pValue: number;
  explanation: Explanation;
}

/** Trend test across ordered groups: a single degree of freedom in the scores. */
export function logRankTrendTest(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
  options: LogRankOptions & { scores?: number[] } = {},
): EngineResult<TrendTestResult> {
  return attempt(() => {
    validateGroups(time, status, group);
    const weight = options.weight ?? { kind: 'log-rank' };
    const table = groupedRiskTable(time, status, group);
    const G = table.groups.length;
    const scores = options.scores ?? table.groups.map((_, i) => i + 1);
    const v = new Validator();
    if (scores.length !== G) {
      v.add(`Expected ${G} trend scores (one per group) but received ${scores.length}.`, 'scores', 'length');
    }
    scores.forEach((s, i) => v.finite(s, 'scores', `Score ${i + 1}`));
    v.throwIfInvalid();
    const weights = weightSeries(table, weight);
    const acc = accumulate(table, weights);
    let num = 0;
    for (let g = 0; g < G; g++) num += scores[g] * acc.z[g];
    let den = 0;
    for (let g = 0; g < G; g++) for (let h = 0; h < G; h++) den += scores[g] * scores[h] * acc.v[g][h];
    if (!(den > 0)) {
      throw new EngineError([
        {
          code: 'singular',
          message:
            'The variance of the trend statistic is zero, so the test is undefined. The chosen scores ' +
            'may be constant, or there may be no event time with more than one subject at risk.',
          field: 'scores',
        },
      ]);
    }
    const statistic = (num * num) / den;
    return {
      scores,
      groups: table.groups,
      statistic,
      degreesOfFreedom: 1,
      pValue: chiSquareSurvival(statistic, 1),
      explanation: {
        method: 'Log-rank test for trend across ordered groups',
        formula: 'χ²₁ = (Σ a_g z_g)² / (aᵀ V a)',
        steps: [
          { label: 'Scores', value: scores.join(', ') },
          { label: 'Statistic', value: statistic.toFixed(6) },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'The groups are assumed ordered and the effect assumed monotone in the supplied scores. Equally spaced default scores are an assumption about the exposure scale.',
        ],
        limitations: [
          PROPORTIONAL_HAZARDS_CAVEAT,
          'A trend test has no power against non-monotone patterns; use the overall log-rank test alongside it.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

export interface CrossingResult {
  crossed: boolean;
  /** Approximate times at which the two curves swap order. */
  crossingTimes: number[];
  /** Largest absolute difference between the curves, and where. */
  maxDifference: number;
  maxDifferenceTime: number;
  warning: string | null;
  explanation: Explanation;
}

/**
 * Crossing-curve detection for two groups. When curves cross, the hazards are
 * not proportional, and both the log-rank test and any single hazard ratio are
 * misleading summaries.
 */
export function detectCrossingCurves(
  time: readonly number[],
  status: readonly number[],
  group: readonly (number | string)[],
  options: { tolerance?: number; minAtRisk?: number } = {},
): EngineResult<CrossingResult> {
  return attempt(() => {
    validateGroups(time, status, group);
    const distinct = [...new Set(group)];
    if (distinct.length !== 2) {
      throw new EngineError([
        {
          code: 'groups',
          message: `Crossing detection compares exactly two curves; ${distinct.length} groups were supplied.`,
          field: 'group',
        },
      ]);
    }
    const tolerance = options.tolerance ?? 0.02;
    const minAtRisk = options.minAtRisk ?? 5;
    const curves = distinct.map((g) => {
      const idx: number[] = [];
      for (let i = 0; i < group.length; i++) if (group[i] === g) idx.push(i);
      return kaplanMeierOrThrow(
        idx.map((i) => time[i]),
        idx.map((i) => status[i]),
      );
    });
    const stepAt = (km: { curve: { time: number; survival: number; atRisk: number; events: number }[] }, t: number) => {
      let s = 1;
      let atRisk = km.curve.length ? km.curve[0].atRisk : 0;
      for (const p of km.curve) {
        if (p.time > t) break;
        s = p.survival;
        atRisk = p.atRisk - p.events;
      }
      return { s, atRisk };
    };
    const allTimes = [...new Set(curves.flatMap((c) => c.curve.map((p) => p.time)))].sort((a, b) => a - b);
    const crossingTimes: number[] = [];
    let maxDifference = 0;
    let maxDifferenceTime = allTimes.length ? allTimes[0] : 0;
    let lastSign = 0;
    for (const t of allTimes) {
      const a = stepAt(curves[0], t);
      const b = stepAt(curves[1], t);
      if (a.atRisk < minAtRisk || b.atRisk < minAtRisk) continue;
      const diff = a.s - b.s;
      if (Math.abs(diff) > maxDifference) {
        maxDifference = Math.abs(diff);
        maxDifferenceTime = t;
      }
      const sign = Math.abs(diff) <= tolerance ? 0 : Math.sign(diff);
      if (sign !== 0) {
        if (lastSign !== 0 && sign !== lastSign) crossingTimes.push(t);
        lastSign = sign;
      }
    }
    const crossed = crossingTimes.length > 0;
    return {
      crossed,
      crossingTimes,
      maxDifference,
      maxDifferenceTime,
      warning: crossed
        ? `The survival curves cross (around t = ${crossingTimes.map((t) => String(t)).join(', ')}). ` +
          PROPORTIONAL_HAZARDS_CAVEAT
        : null,
      explanation: {
        method: 'Crossing detection on the two Kaplan–Meier curves',
        steps: [
          { label: 'Tolerance', value: `differences below ${tolerance} are treated as no ordering` },
          { label: 'Minimum risk set', value: `${minAtRisk} per group; sparser tails are ignored` },
          { label: 'Crossings found', value: String(crossingTimes.length) },
          { label: 'Largest difference', value: `${maxDifference.toFixed(4)} at t = ${maxDifferenceTime}` },
        ],
        assumptions: [INDEPENDENT_CENSORING],
        limitations: [
          'This is a descriptive check on the estimated curves, not a test. Sampling noise can produce apparent crossings, and a true crossing can be missed when the risk sets are small.',
          'Not crossing does not establish proportional hazards. Use the Schoenfeld residual test for that.',
        ],
        exactness: 'empirical',
      },
    };
  });
}
