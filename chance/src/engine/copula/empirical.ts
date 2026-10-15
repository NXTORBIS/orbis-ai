/**
 * Going the other way: from paired data to a copula.
 *
 * Pseudo-observations (ranks divided by n + 1) remove the margins, the
 * empirical copula is their joint distribution function, and a family can be
 * fitted by matching Kendall's τ. Families are then compared by pseudo
 * log-likelihood and AIC — a comparison *among the implemented families only*,
 * which every result here states explicitly.
 */
import type { Exactness, EngineResult } from '../core/result';
import { attempt, EngineError, fail, ok } from '../core/result';
import { FITTABLE_COPULAS, getCopula } from './families';
import type { CopulaDef, CopulaFamilyId, CopulaParams, TailDependence } from './types';

export interface Pair {
  x: number;
  y: number;
}

/** Degrees of freedom tried when profiling the Student-t copula. */
const T_NU_GRID = [2, 2.5, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50, 100];

/** Ties are averaged; the result is the mid-rank of each value (1-based). */
export function midRanks(values: readonly number[]): number[] {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++;
    const mid = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]] = mid;
    i = j + 1;
  }
  return ranks;
}

/**
 * Pseudo-observations: ranks/(n + 1), which land strictly inside (0, 1) so that
 * a copula density can be evaluated at them. The division by n + 1 rather than
 * n is the standard scaling and is what keeps the pseudo-likelihood finite.
 */
export function pseudoObservations(pairs: readonly Pair[]): { u: number[]; v: number[] } {
  if (pairs.length < 2) {
    throw new EngineError('Pseudo-observations need at least 2 pairs.', 'insufficient');
  }
  const n = pairs.length;
  for (const p of pairs) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new EngineError('Every pair must consist of two finite numbers.', 'finite');
    }
  }
  const rx = midRanks(pairs.map((p) => p.x));
  const ry = midRanks(pairs.map((p) => p.y));
  return { u: rx.map((r) => r / (n + 1)), v: ry.map((r) => r / (n + 1)) };
}

export interface EmpiricalCopula {
  n: number;
  u: number[];
  v: number[];
  /** Ĉ_n(u, v) = (1/n)·#{i : Û_i ≤ u, V̂_i ≤ v}. */
  cdf(u: number, v: number): number;
  exactness: Exactness;
  limitations: string[];
}

/** The empirical copula of paired data, built from its pseudo-observations. */
export function empiricalCopula(pairs: readonly Pair[]): EmpiricalCopula {
  const { u, v } = pseudoObservations(pairs);
  const n = pairs.length;
  return {
    n,
    u,
    v,
    cdf(a: number, b: number): number {
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || a > 1 || b < 0 || b > 1) {
        throw new EngineError(
          `The empirical copula is only defined on the unit square; received (${a}, ${b}).`,
          'range',
        );
      }
      let count = 0;
      for (let i = 0; i < n; i++) if (u[i] <= a && v[i] <= b) count++;
      return count / n;
    },
    exactness: 'empirical',
    limitations: [
      `A step function with ${n} jumps: it cannot resolve the copula on a scale finer than 1/${n}.`,
      'Its sampling error is largest in the corners, which is exactly where tail dependence lives, so it cannot settle tail questions on its own.',
    ],
  };
}

/**
 * Sample Kendall's τ_b. With no ties the discordant pairs are counted by
 * merge sort in O(n log n), which is what makes 10⁵–10⁶ pairs practical. With
 * ties the O(n²) definition is used, and refused above a size limit rather
 * than silently approximated.
 */
export function sampleKendallTau(pairs: readonly Pair[]): number {
  const n = pairs.length;
  if (n < 2) throw new EngineError("Kendall's τ needs at least 2 pairs.", 'insufficient');
  const xs = pairs.map((p) => p.x);
  const ys = pairs.map((p) => p.y);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
      throw new EngineError('Every pair must consist of two finite numbers.', 'finite');
    }
  }
  const hasTies = countTiedPairs(xs) > 0 || countTiedPairs(ys) > 0;
  if (!hasTies) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a] - xs[b]);
    const sortedY = order.map((i) => ys[i]);
    const discordant = countInversions(sortedY);
    return 1 - (4 * discordant) / (n * (n - 1));
  }
  const limit = 4000;
  if (n > limit) {
    throw new EngineError(
      `The data contain tied values, which require the O(n²) definition of τ_b; that is refused above ${limit} pairs (received ${n}). De-duplicate or jitter the ties first.`,
      'size',
    );
  }
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = Math.sign(xs[i] - xs[j]) * Math.sign(ys[i] - ys[j]);
      if (s > 0) concordant++;
      else if (s < 0) discordant++;
    }
  }
  const total = (n * (n - 1)) / 2;
  const denom = Math.sqrt((total - countTiedPairs(xs)) * (total - countTiedPairs(ys)));
  if (!(denom > 0)) {
    throw new EngineError(
      "Kendall's τ is undefined: one of the two variables is constant.",
      'degenerate',
    );
  }
  return (concordant - discordant) / denom;
}

/** Number of pairs tied within a single variable. */
function countTiedPairs(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  let tied = 0;
  let run = 1;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && sorted[i] === sorted[i - 1]) run++;
    else {
      tied += (run * (run - 1)) / 2;
      run = 1;
    }
  }
  return tied;
}

/** Inversions of an array, counted by merge sort. */
function countInversions(values: readonly number[]): number {
  const work = [...values];
  const buffer = new Array<number>(work.length).fill(0);
  let count = 0;
  const sort = (lo: number, hi: number): void => {
    if (hi - lo < 2) return;
    const mid = (lo + hi) >> 1;
    sort(lo, mid);
    sort(mid, hi);
    let i = lo;
    let j = mid;
    let k = lo;
    while (i < mid || j < hi) {
      if (j >= hi || (i < mid && work[i] <= work[j])) buffer[k++] = work[i++];
      else {
        count += mid - i;
        buffer[k++] = work[j++];
      }
    }
    for (let t = lo; t < hi; t++) work[t] = buffer[t];
  };
  sort(0, work.length);
  return count;
}

/** Sample Spearman's ρ: the Pearson correlation of the mid-ranks. */
export function sampleSpearmanRho(pairs: readonly Pair[]): number {
  const n = pairs.length;
  if (n < 3) throw new EngineError("Spearman's ρ needs at least 3 pairs.", 'insufficient');
  const rx = midRanks(pairs.map((p) => p.x));
  const ry = midRanks(pairs.map((p) => p.y));
  const mean = (n + 1) / 2;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = rx[i] - mean;
    const b = ry[i] - mean;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (!(sxx > 0) || !(syy > 0)) {
    throw new EngineError("Spearman's ρ is undefined: one of the two variables is constant.", 'degenerate');
  }
  return sxy / Math.sqrt(sxx * syy);
}

export interface CopulaFit {
  familyId: CopulaFamilyId;
  familyName: string;
  params: CopulaParams;
  /** Sample τ of the data: the quantity that was matched. */
  sampleKendallTau: number;
  /** τ the fitted parameters actually produce. */
  fittedKendallTau: number;
  /** Pseudo log-likelihood at the pseudo-observations, or null without a density. */
  logLikelihood: number | null;
  parameterCount: number;
  aic: number | null;
  tailDependence: TailDependence;
  n: number;
  exactness: Exactness;
  method: string;
  limitations: string[];
}

/** Pseudo log-likelihood Σ log c(û_i, v̂_i); null if the family has no density. */
function pseudoLogLikelihood(def: CopulaDef, params: CopulaParams, u: number[], v: number[]): number | null {
  if (!def.density) return null;
  let total = 0;
  for (let i = 0; i < u.length; i++) {
    const d = def.density(u[i], v[i], params);
    if (!(d > 0) || !Number.isFinite(d)) return null;
    total += Math.log(d);
  }
  return Number.isFinite(total) ? total : null;
}

function buildFit(
  def: CopulaDef,
  params: CopulaParams,
  tau: number,
  u: number[],
  v: number[],
  parameterCount: number,
  method: string,
): CopulaFit {
  const logLikelihood = pseudoLogLikelihood(def, params, u, v);
  return {
    familyId: def.id,
    familyName: def.name,
    params,
    sampleKendallTau: tau,
    fittedKendallTau: def.kendallTau(params),
    logLikelihood,
    parameterCount,
    aic: logLikelihood === null ? null : 2 * parameterCount - 2 * logLikelihood,
    tailDependence: def.tailDependence(params),
    n: u.length,
    exactness: 'empirical',
    method,
    limitations: [
      ...def.limitations,
      'Fitted by matching Kendall’s τ, which uses only the rank concordance of the data; it does not check that the shape of the dependence matches the family.',
      'The log-likelihood is a pseudo-likelihood evaluated at rank-based pseudo-observations, so it is not comparable with likelihoods that include the margins.',
    ],
  };
}

/**
 * Fit one family by inverting Kendall's τ (the method of moments for
 * dependence). For the Student-t copula τ fixes ρ but says nothing about ν, so
 * ν is profiled over a grid by pseudo-likelihood and that is stated in the
 * method string.
 */
export function fitCopulaByKendallTau(
  pairs: readonly Pair[],
  family: CopulaFamilyId | string,
): EngineResult<CopulaFit> {
  return attempt(() => {
    const def = getCopula(family);
    if (pairs.length < 5) {
      throw new EngineError(
        `Fitting a copula needs at least 5 pairs; received ${pairs.length}.`,
        'insufficient',
      );
    }
    const tau = sampleKendallTau(pairs);
    const { u, v } = pseudoObservations(pairs);
    if (def.id === 't') {
      const rho = def.fromKendallTau(tau).rho;
      let best: { params: CopulaParams; ll: number } | null = null;
      for (const nu of T_NU_GRID) {
        const candidate: CopulaParams = { nu, rho };
        const ll = pseudoLogLikelihood(def, candidate, u, v);
        if (ll !== null && (best === null || ll > best.ll)) best = { params: candidate, ll };
      }
      if (!best) {
        throw new EngineError(
          'The Student-t pseudo-likelihood was not finite at any ν on the grid, so ν could not be chosen.',
          'numerical',
        );
      }
      return buildFit(
        def,
        best.params,
        tau,
        u,
        v,
        2,
        "ρ from Kendall's τ (ρ = sin(πτ/2)); ν chosen by profiling the pseudo-likelihood over a fixed grid, so ν is a grid point and not a maximum-likelihood estimate.",
      );
    }
    const params = def.fromKendallTau(tau);
    return buildFit(def, params, tau, u, v, def.params.length, "Inversion of Kendall's τ.");
  });
}

export interface SkippedFamily {
  familyId: CopulaFamilyId;
  reason: string;
}

export interface CopulaComparison {
  /** Fits that produced a finite AIC, best first. */
  ranked: (CopulaFit & { deltaAic: number })[];
  best: CopulaFit & { deltaAic: number };
  skipped: SkippedFamily[];
  sampleKendallTau: number;
  sampleSpearmanRho: number;
  n: number;
  exactness: Exactness;
  /** The honest scope of the conclusion. */
  statement: string;
  limitations: string[];
}

/**
 * Fit every candidate family by Kendall's τ and rank them by AIC.
 *
 * The returned `statement` is part of the result on purpose: the "best" family
 * is the best *of the ones implemented here*, chosen on a pseudo-likelihood,
 * and a small AIC gap is not evidence that one family is right.
 */
export function compareCopulaFamilies(
  pairs: readonly Pair[],
  families: readonly (CopulaFamilyId | string)[] = FITTABLE_COPULAS.map((c) => c.id),
): EngineResult<CopulaComparison> {
  if (pairs.length < 5) {
    return fail(`Comparing copula families needs at least 5 pairs; received ${pairs.length}.`);
  }
  const fits: CopulaFit[] = [];
  const skipped: SkippedFamily[] = [];
  for (const id of families) {
    const attemptFit = fitCopulaByKendallTau(pairs, id);
    if (!attemptFit.ok) {
      skipped.push({ familyId: getCopula(id).id, reason: attemptFit.errors.map((e) => e.message).join('; ') });
      continue;
    }
    if (attemptFit.value.aic === null) {
      skipped.push({
        familyId: attemptFit.value.familyId,
        reason: 'No tractable density, or the pseudo-likelihood was not finite at the fitted parameters.',
      });
      continue;
    }
    fits.push(attemptFit.value);
  }
  if (fits.length === 0) {
    return fail(
      `No candidate family could be fitted to these data. Reasons: ${
        skipped.map((s) => `${s.familyId}: ${s.reason}`).join(' | ') || 'none recorded'
      }`,
    );
  }
  fits.sort((a, b) => (a.aic as number) - (b.aic as number));
  const bestAic = fits[0].aic as number;
  const ranked = fits.map((f) => ({ ...f, deltaAic: (f.aic as number) - bestAic }));
  const tau = fits[0].sampleKendallTau;
  const names = ranked.map((f) => f.familyName).join(', ');
  const runnerUp = ranked.length > 1 ? ranked[1] : null;
  const statement =
    `${ranked[0].familyName} has the lowest AIC among the families actually compared (${names}).` +
    ' This is a selection among the implemented families only: it is not evidence that the data were generated by this copula, and a family that was not compared may fit better.' +
    (runnerUp
      ? ` The next best is ${runnerUp.familyName} with ΔAIC = ${runnerUp.deltaAic.toFixed(2)}${
          runnerUp.deltaAic < 2
            ? ', which is too small to distinguish the two: both remain plausible, and they can differ sharply in tail dependence.'
            : '.'
        }`
      : '');
  return ok({
    ranked,
    best: ranked[0],
    skipped,
    sampleKendallTau: tau,
    sampleSpearmanRho: sampleSpearmanRho(pairs),
    n: pairs.length,
    exactness: 'empirical',
    statement,
    limitations: [
      'All families were fitted by inverting Kendall’s τ, not by maximising the likelihood, so the AIC values are not those of maximum-likelihood fits.',
      'AIC counts the Student-t copula as two parameters, but its ν came from a grid search, which understates its flexibility slightly.',
      'Tail dependence is a property of the family, not something these data can confirm: the number of observations in the extreme corners is small by definition.',
      ...(skipped.length
        ? [`Not compared: ${skipped.map((s) => `${s.familyId} (${s.reason})`).join('; ')}.`]
        : []),
    ],
  });
}
