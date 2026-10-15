/**
 * Matching: on the propensity score, on covariates by Mahalanobis distance,
 * and coarsened exact matching.
 *
 * Matching is a data-pruning step, not an estimator. Its output here is a set
 * of pairs plus per-unit weights, and — just as importantly — an account of
 * which treated units found no partner, because dropping them narrows the
 * population the estimate is about.
 */

import { EngineError } from '../core/result.ts';
import { variance } from '../stats/descriptive.ts';
import { solve, type Matrix } from '../stats/linalg.ts';
import type { Covariate } from './balance.ts';

export type MatchOrder = 'greedy-descending' | 'greedy-random' | 'optimal';

export interface MatchOptions {
  /** Draw controls with replacement (a control may serve several treated units). */
  withReplacement?: boolean;
  /** Maximum allowed distance. Pairs beyond it are refused, not stretched. */
  caliper?: number;
  /** Controls per treated unit (only without replacement for `optimal`). */
  ratio?: number;
  order?: MatchOrder;
  /** Cap on the optimal-matching problem size, to keep the O(n³) solve bounded. */
  optimalSizeLimit?: number;
}

export interface MatchPair {
  treated: number;
  control: number;
  distance: number;
}

export interface MatchResult {
  method: string;
  pairs: MatchPair[];
  /** Treated indices with no acceptable partner. */
  unmatchedTreated: number[];
  /** Control indices never used. */
  unusedControl: number[];
  /**
   * Per-unit weight for the matched estimator: 1 for each matched treated
   * unit, and for a control the number of times it was used divided by the
   * ratio. Unmatched units get 0.
   */
  weights: number[];
  nTreated: number;
  nControl: number;
  nMatched: number;
  nDropped: number;
  dropReasons: string[];
  warnings: string[];
  /** Mean and maximum distance of the accepted pairs. */
  meanDistance: number;
  maxDistance: number;
  /**
   * The one-dimensional matching distance per unit, when the method has one
   * (the propensity score). Used by the Abadie–Imbens variance estimator to
   * find each control's nearest neighbour within its own arm; absent for
   * methods whose metric is multivariate.
   */
  distanceValues?: readonly number[];
}

function arms(treatment: readonly number[]): { tIdx: number[]; cIdx: number[] } {
  const tIdx: number[] = [];
  const cIdx: number[] = [];
  for (let i = 0; i < treatment.length; i++) {
    if (treatment[i] !== 0 && treatment[i] !== 1) {
      throw new EngineError(`Matching: treatment must be 0 or 1; found ${treatment[i]} at unit ${i}.`, 'binary');
    }
    (treatment[i] === 1 ? tIdx : cIdx).push(i);
  }
  if (tIdx.length === 0 || cIdx.length === 0) {
    throw new EngineError(
      `Matching: ${tIdx.length === 0 ? 'no treated units' : 'no control units'} were supplied. A match needs both arms.`,
      'one-arm',
    );
  }
  return { tIdx, cIdx };
}

function finish(
  method: string,
  pairs: MatchPair[],
  tIdx: number[],
  cIdx: number[],
  n: number,
  ratio: number,
  caliper: number | undefined,
  extraWarnings: string[],
): MatchResult {
  const matchedTreated = new Set(pairs.map((p) => p.treated));
  const usedControl = new Map<number, number>();
  for (const p of pairs) usedControl.set(p.control, (usedControl.get(p.control) ?? 0) + 1);
  const unmatchedTreated = tIdx.filter((i) => !matchedTreated.has(i));
  const unusedControl = cIdx.filter((i) => !usedControl.has(i));
  const weights = new Array<number>(n).fill(0);
  for (const i of matchedTreated) weights[i] = 1;
  for (const [i, k] of usedControl) weights[i] = k / ratio;

  if (pairs.length === 0) {
    throw new EngineError(
      `${method}: zero pairs were formed` +
        (caliper !== undefined
          ? `. Every candidate pair exceeded the caliper of ${caliper}, which means no treated unit has a ` +
            'comparable control unit at the tolerance you asked for.'
          : '. No treated unit could be matched to a control unit.') +
        ' A matched estimate of zero pairs is not a small estimate — it does not exist. Widen the caliper, allow ' +
        'replacement, or accept that these groups are not comparable.',
      'no-pairs',
    );
  }

  const dropReasons: string[] = [];
  if (unmatchedTreated.length > 0) {
    dropReasons.push(
      `${unmatchedTreated.length} of ${tIdx.length} treated units found no partner` +
        (caliper !== undefined ? ` within the caliper of ${caliper}` : '') +
        ' and are excluded. The estimand is therefore the effect among MATCHED treated units, a narrower ' +
        'population than the treated group you started with.',
    );
  }
  if (unusedControl.length > 0) {
    dropReasons.push(
      `${unusedControl.length} of ${cIdx.length} control units were never used. They are discarded, which costs ` +
        'precision but does not bias the matched contrast.',
    );
  }
  const warnings = extraWarnings.slice();
  if (unmatchedTreated.length > 0.1 * tIdx.length) {
    warnings.push(
      `${((unmatchedTreated.length / tIdx.length) * 100).toFixed(1)}% of treated units are unmatched. When this ` +
        'much of the treated group is dropped, the surviving subgroup can differ systematically from the whole, ' +
        'so the matched estimate does not generalise to the treated population.',
    );
  }
  const distances = pairs.map((p) => p.distance);
  const meanDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  const maxDistance = Math.max(...distances);
  return {
    method,
    pairs,
    unmatchedTreated,
    unusedControl,
    weights,
    nTreated: tIdx.length,
    nControl: cIdx.length,
    nMatched: pairs.length,
    nDropped: unmatchedTreated.length + unusedControl.length,
    dropReasons,
    warnings,
    meanDistance,
    maxDistance,
  };
}

/**
 * Nearest-neighbour matching on a one-dimensional distance (normally the
 * propensity score, or its logit, which spreads out the tails).
 */
export function nearestNeighbourMatch(
  distanceValue: readonly number[],
  treatment: readonly number[],
  options: MatchOptions = {},
  methodLabel = 'Nearest-neighbour propensity matching',
): MatchResult {
  const { tIdx, cIdx } = arms(treatment);
  const withReplacement = options.withReplacement ?? false;
  const ratio = Math.max(1, Math.round(options.ratio ?? 1));
  const caliper = options.caliper;
  const order = options.order ?? 'greedy-descending';
  const warnings: string[] = [];

  if (order === 'optimal') {
    if (withReplacement) {
      throw new EngineError(
        'Optimal matching minimises the total distance over a one-to-one assignment, which is only defined ' +
          'without replacement. Choose either `optimal` or `withReplacement`, not both.',
        'options',
      );
    }
    return optimalMatch(distanceValue, treatment, options, methodLabel + ' (optimal, total-distance minimising)');
  }
  if (!withReplacement && cIdx.length < tIdx.length * ratio) {
    warnings.push(
      `Only ${cIdx.length} control units for ${tIdx.length} treated units at ${ratio}:1 without replacement. ` +
        'Some treated units must go unmatched whatever the algorithm does; the shortage, not the data, decides ' +
        'who is dropped.',
    );
  }
  const queue = tIdx.slice();
  if (order === 'greedy-descending') {
    // Match the hardest units (highest score) first: greedy matching is
    // order-dependent, and taking the extremes first is the conventional
    // choice because they have the fewest candidates.
    queue.sort((a, b) => distanceValue[b] - distanceValue[a]);
  }
  const used = new Set<number>();
  const pairs: MatchPair[] = [];
  for (const t of queue) {
    for (let r = 0; r < ratio; r++) {
      let best = -1;
      let bestD = Infinity;
      for (const c of cIdx) {
        if (!withReplacement && used.has(c)) continue;
        const d = Math.abs(distanceValue[t] - distanceValue[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best < 0) break;
      if (caliper !== undefined && bestD > caliper) break;
      pairs.push({ treated: t, control: best, distance: bestD });
      if (!withReplacement) used.add(best);
    }
  }
  if (withReplacement) {
    const counts = new Map<number, number>();
    for (const p of pairs) counts.set(p.control, (counts.get(p.control) ?? 0) + 1);
    const maxUse = Math.max(...counts.values());
    if (maxUse > 1) {
      warnings.push(
        `Matching with replacement: one control unit is used ${maxUse} times. Reused controls make the matched ` +
          'sample less independent than its size suggests, so the naive paired standard error is too small; the ' +
          'bootstrap interval reported with the estimate accounts for the reuse.',
      );
    }
  }
  if (!withReplacement) {
    const usedShare = pairs.length / cIdx.length;
    if (usedShare > 0.5) {
      warnings.push(
        `Greedy matching without replacement used ${pairs.length} of ${cIdx.length} available controls ` +
          `(${(usedShare * 100).toFixed(0)}%). Once the control pool runs low the remaining treated units take ` +
          'whatever is left, so the later pairs are poor and the estimate is biased — not merely imprecise. ' +
          'Matching with replacement, or a caliper with the unmatched units reported, is more honest when the ' +
          'arms are of similar size.',
      );
    }
  }
  return {
    ...finish(
      methodLabel + (withReplacement ? ' (with replacement)' : ' (without replacement, greedy)'),
      pairs,
      tIdx,
      cIdx,
      treatment.length,
      ratio,
      caliper,
      warnings,
    ),
    distanceValues: distanceValue.slice(),
  };
}

/**
 * Optimal one-to-one matching by the Hungarian algorithm on the treated ×
 * control cost matrix. Pairs beyond the caliper are given an infinite cost and
 * then removed, so the caliper is respected rather than traded away.
 */
export function optimalMatch(
  distanceValue: readonly number[],
  treatment: readonly number[],
  options: MatchOptions = {},
  methodLabel = 'Optimal propensity matching',
): MatchResult {
  const { tIdx, cIdx } = arms(treatment);
  const limit = options.optimalSizeLimit ?? 400;
  if (tIdx.length > limit || cIdx.length > limit) {
    throw new EngineError(
      `Optimal matching solves an assignment problem whose cost is cubic in the group sizes; ${tIdx.length} ` +
        `treated × ${cIdx.length} control exceeds the limit of ${limit} per arm. No partial answer is returned, ` +
        'because a truncated assignment is not the optimal one. Use greedy nearest-neighbour matching, which is ' +
        'reported as greedy, or raise `optimalSizeLimit` deliberately.',
      'size',
    );
  }
  const caliper = options.caliper;
  const nR = tIdx.length;
  const nC = cIdx.length;
  const BIG = 1e9;
  const cost: number[][] = tIdx.map((t) =>
    cIdx.map((c) => {
      const d = Math.abs(distanceValue[t] - distanceValue[c]);
      return caliper !== undefined && d > caliper ? BIG : d;
    }),
  );
  // Jonker–Volgenant shortest augmenting path for a rectangular problem with
  // nR ≤ nC; when nR > nC the surplus rows simply remain unassigned.
  const rows = Math.min(nR, nC);
  const transpose = nR > nC;
  const C = transpose ? Array.from({ length: nC }, (_, j) => cost.map((r) => r[j])) : cost;
  const n1 = C.length;
  const n2 = C[0].length;
  const u = new Array<number>(n1 + 1).fill(0);
  const v = new Array<number>(n2 + 1).fill(0);
  const p = new Array<number>(n2 + 1).fill(-1);
  const way = new Array<number>(n2 + 1).fill(-1);
  for (let i = 0; i < n1; i++) {
    p[n2] = i;
    let j0 = n2;
    const minv = new Array<number>(n2 + 1).fill(Infinity);
    const usedCol = new Array<boolean>(n2 + 1).fill(false);
    do {
      usedCol[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = -1;
      for (let j = 0; j < n2; j++) {
        if (usedCol[j]) continue;
        const cur = C[i0][j] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      if (j1 < 0) {
        throw new EngineError('Optimal matching: the assignment problem has no feasible completion.', 'assignment');
      }
      for (let j = 0; j <= n2; j++) {
        if (usedCol[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== -1);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== n2);
  }
  const pairs: MatchPair[] = [];
  for (let j = 0; j < n2; j++) {
    const i = p[j];
    if (i < 0 || i >= n1) continue;
    const d = C[i][j];
    if (d >= BIG) continue;
    const t = transpose ? tIdx[j] : tIdx[i];
    const c = transpose ? cIdx[i] : cIdx[j];
    pairs.push({ treated: t, control: c, distance: Math.abs(distanceValue[t] - distanceValue[c]) });
  }
  const warnings: string[] = [];
  if (rows < nR) {
    warnings.push(
      `${nR - nC} treated unit(s) cannot be matched one-to-one because there are only ${nC} controls. The optimal ` +
        'assignment leaves them out; that is a data shortage, not a property of those units.',
    );
  }
  return { ...finish(methodLabel, pairs, tIdx, cIdx, treatment.length, 1, caliper, warnings), distanceValues: distanceValue.slice() };
}

/** Pooled within-arm covariance, used for the Mahalanobis metric. */
function pooledCovariance(covariates: readonly Covariate[], treatment: readonly number[]): Matrix {
  const k = covariates.length;
  const tIdx: number[] = [];
  const cIdx: number[] = [];
  for (let i = 0; i < treatment.length; i++) (treatment[i] === 1 ? tIdx : cIdx).push(i);
  const cov: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const idx of [tIdx, cIdx]) {
    const m = covariates.map((c) => idx.reduce((a, i) => a + c.values[i], 0) / idx.length);
    for (let a = 0; a < k; a++)
      for (let b = 0; b < k; b++) {
        let s = 0;
        for (const i of idx) s += (covariates[a].values[i] - m[a]) * (covariates[b].values[i] - m[b]);
        cov[a][b] += s;
      }
  }
  const df = tIdx.length + cIdx.length - 2;
  if (df <= 0) throw new EngineError('Mahalanobis matching: too few units to estimate a covariance.', 'size');
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) cov[a][b] /= df;
  return cov;
}

/** Mahalanobis-distance matching directly on the covariates. */
export function mahalanobisMatch(
  covariates: readonly Covariate[],
  treatment: readonly number[],
  options: MatchOptions = {},
): MatchResult {
  if (covariates.length === 0) throw new EngineError('Mahalanobis matching: no covariates supplied.', 'empty');
  for (const c of covariates) {
    if (!(variance(c.values.slice(), 1) > 0)) {
      throw new EngineError(
        `Mahalanobis matching: covariate "${c.name}" has zero variance, so the covariance matrix is singular and ` +
          'the distance is undefined. Remove the constant covariate.',
        'zero-variance',
      );
    }
  }
  const { tIdx, cIdx } = arms(treatment);
  const cov = pooledCovariance(covariates, treatment);
  const k = covariates.length;
  const inv: Matrix = [];
  for (let j = 0; j < k; j++) {
    const e = new Array<number>(k).fill(0);
    e[j] = 1;
    const col = solve(
      cov.map((r) => r.slice()),
      e,
    );
    if (col === null) {
      throw new EngineError(
        'Mahalanobis matching: the pooled covariance matrix is singular, which means two covariates are exactly ' +
          'collinear. The distance is undefined; drop one of them.',
        'singular',
      );
    }
    inv.push(col);
  }
  const invT: Matrix = Array.from({ length: k }, (_, i) => inv.map((c) => c[i]));
  const dist = (i: number, j: number): number => {
    const d = covariates.map((c) => c.values[i] - c.values[j]);
    let s = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) s += d[a] * invT[a][b] * d[b];
    return Math.sqrt(Math.max(0, s));
  };
  const withReplacement = options.withReplacement ?? false;
  const caliper = options.caliper;
  const used = new Set<number>();
  const pairs: MatchPair[] = [];
  for (const t of tIdx) {
    let best = -1;
    let bestD = Infinity;
    for (const c of cIdx) {
      if (!withReplacement && used.has(c)) continue;
      const d = dist(t, c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best < 0) continue;
    if (caliper !== undefined && bestD > caliper) continue;
    pairs.push({ treated: t, control: best, distance: bestD });
    if (!withReplacement) used.add(best);
  }
  return finish(
    'Mahalanobis covariate matching' + (withReplacement ? ' (with replacement)' : ' (without replacement)'),
    pairs,
    tIdx,
    cIdx,
    treatment.length,
    1,
    caliper,
    [],
  );
}

export interface CoarsenedStratum {
  key: string;
  nTreated: number;
  nControl: number;
  /** Strata with an empty arm contribute nothing and are listed as dropped. */
  retained: boolean;
}

export interface CoarsenedMatchResult extends MatchResult {
  strata: CoarsenedStratum[];
  nStrataRetained: number;
  nStrataDropped: number;
}

/**
 * Coarsened exact matching: bin each covariate, then require an exact match on
 * the binned signature. Within-stratum weights make the control group match
 * the treated distribution across retained strata.
 *
 * CEM trades sample size for exactness. Strata containing only one arm are
 * dropped outright, which is honest — there is no counterfactual in them — but
 * it changes the population, and the result says so.
 */
export function coarsenedExactMatch(
  covariates: readonly Covariate[],
  treatment: readonly number[],
  /** Bin count per covariate, or explicit cut points. */
  coarsening: readonly (number | readonly number[])[],
): CoarsenedMatchResult {
  if (covariates.length === 0) throw new EngineError('Coarsened exact matching: no covariates supplied.', 'empty');
  if (coarsening.length !== covariates.length) {
    throw new EngineError(
      `Coarsened exact matching: ${covariates.length} covariates but ${coarsening.length} coarsening rules.`,
      'length',
    );
  }
  const { tIdx, cIdx } = arms(treatment);
  const n = treatment.length;
  const edges: number[][] = covariates.map((c, j) => {
    const rule = coarsening[j];
    if (Array.isArray(rule)) return rule.slice().sort((a, b) => a - b);
    const bins = Math.max(1, Math.round(rule as number));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of c.values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) {
      throw new EngineError(
        `Coarsened exact matching: covariate "${c.name}" has zero variance, so it cannot be binned.`,
        'zero-variance',
      );
    }
    const e: number[] = [];
    for (let b = 1; b < bins; b++) e.push(lo + ((hi - lo) * b) / bins);
    return e;
  });
  const binOf = (v: number, e: readonly number[]): number => {
    let b = 0;
    while (b < e.length && v > e[b]) b++;
    return b;
  };
  const keyOf = (i: number): string => covariates.map((c, j) => binOf(c.values[i], edges[j])).join('|');
  const byKey = new Map<string, { t: number[]; c: number[] }>();
  for (let i = 0; i < n; i++) {
    const k = keyOf(i);
    let g = byKey.get(k);
    if (!g) {
      g = { t: [], c: [] };
      byKey.set(k, g);
    }
    (treatment[i] === 1 ? g.t : g.c).push(i);
  }
  const strata: CoarsenedStratum[] = [];
  const weights = new Array<number>(n).fill(0);
  const pairs: MatchPair[] = [];
  let retained = 0;
  let matchedTreated = 0;
  for (const [key, g] of byKey) {
    const keep = g.t.length > 0 && g.c.length > 0;
    strata.push({ key, nTreated: g.t.length, nControl: g.c.length, retained: keep });
    if (!keep) continue;
    retained++;
    matchedTreated += g.t.length;
    for (const i of g.t) weights[i] = 1;
    // Each stratum's controls together stand in for its treated units.
    const w = g.t.length / g.c.length;
    for (const i of g.c) weights[i] = w;
    // Record representative pairs so the pair accounting is populated.
    for (const t of g.t) pairs.push({ treated: t, control: g.c[0], distance: 0 });
  }
  const base = finish(
    'Coarsened exact matching',
    pairs,
    tIdx,
    cIdx,
    n,
    1,
    undefined,
    retained < byKey.size
      ? [
          `${byKey.size - retained} of ${byKey.size} coarsened strata contain only one treatment arm and are ` +
            'dropped entirely. Those covariate cells have no counterfactual at all, so no amount of modelling ' +
            'recovers an effect in them; the estimate applies only to the cells where both arms occur.',
        ]
      : [],
  );
  // CEM weights are stratum-based, not pair-based: override the pair weights.
  base.weights = weights;
  base.nMatched = matchedTreated;
  return { ...base, strata, nStrataRetained: retained, nStrataDropped: byKey.size - retained };
}

export interface PropensityStratum {
  low: number;
  high: number;
  nTreated: number;
  nControl: number;
  /** Stratum-specific mean difference; null when an arm is empty. */
  effect: number | null;
  retained: boolean;
}

/**
 * Propensity-score stratification (subclassification). Strata with an empty
 * arm are reported and excluded; they carry no information about a contrast.
 */
export function propensityStrata(
  scores: readonly number[],
  treatment: readonly number[],
  outcome: readonly number[],
  nStrata = 5,
): { strata: PropensityStratum[]; warnings: string[] } {
  const n = scores.length;
  arms(treatment);
  if (nStrata < 2) throw new EngineError('Stratification needs at least 2 strata.', 'options');
  const sorted = scores.slice().sort((a, b) => a - b);
  const cuts: number[] = [];
  for (let s = 1; s < nStrata; s++) {
    const q = (s / nStrata) * (sorted.length - 1);
    const lo = Math.floor(q);
    const hi = Math.ceil(q);
    cuts.push(sorted[lo] + (q - lo) * (sorted[hi] - sorted[lo]));
  }
  const bounds = [-Infinity, ...cuts, Infinity];
  const strata: PropensityStratum[] = [];
  const warnings: string[] = [];
  for (let s = 0; s < nStrata; s++) {
    const t: number[] = [];
    const c: number[] = [];
    for (let i = 0; i < n; i++) {
      if (scores[i] > bounds[s] && scores[i] <= bounds[s + 1]) (treatment[i] === 1 ? t : c).push(i);
    }
    const keep = t.length > 0 && c.length > 0;
    const effect = keep
      ? t.reduce((a, i) => a + outcome[i], 0) / t.length - c.reduce((a, i) => a + outcome[i], 0) / c.length
      : null;
    strata.push({ low: bounds[s], high: bounds[s + 1], nTreated: t.length, nControl: c.length, effect, retained: keep });
  }
  const dropped = strata.filter((s) => !s.retained).length;
  if (dropped === nStrata) {
    throw new EngineError(
      `Propensity stratification: every one of the ${nStrata} strata contains only one treatment arm, so no ` +
        'within-stratum contrast exists anywhere. The two arms do not share any region of the propensity score ' +
        'at this resolution; no stratified estimate is reported.',
      'no-overlap',
    );
  }
  if (dropped > 0) {
    warnings.push(
      `${dropped} of ${nStrata} propensity strata have an empty arm and are excluded. The stratified estimate is ` +
        'an average over the remaining strata only, so it refers to a subpopulation rather than the full sample.',
    );
  }
  return { strata, warnings };
}
