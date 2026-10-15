/**
 * Sample-based methods: the sample average approximation and its statistical
 * optimality gap, scenario generation, and scenario reduction.
 *
 * The bias that has to be stated
 * ------------------------------
 * The in-sample optimum of an N-scenario approximation is OPTIMISTICALLY BIASED
 * for a minimisation problem: E[v̂_N] <= v*, because the same sample that
 * defines the objective is used to choose the decision. Reporting v̂_N as "the
 * answer" therefore reports a number known to be too good, and the size of the
 * error is not small on hard problems. This module never returns v̂_N on its
 * own. It returns:
 *
 *   LOWER bound  — the mean of v̂_N across independent replications, with its
 *                  own confidence limit. It estimates E[v̂_N] <= v*.
 *   UPPER bound  — the value of ONE candidate decision x̄ evaluated on a fresh,
 *                  independent sample. It is unbiased for f(x̄) >= v*.
 *   GAP          — upper minus lower, with a one-sided confidence bound
 *                  (Mak, Morton & Wood 1999). The interval is what makes the
 *                  SAA answer honest, and the tests check that it covers the
 *                  true gap at approximately its nominal rate.
 *
 * Scenario reduction reports the Wasserstein distance from the original measure
 * to the reduced one, so the approximation's cost is a measured number rather
 * than a hope that a hundred scenarios is "enough".
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { latinHypercube } from '../qmc/stratified';
import { Random } from '../random/rng';
import type { Seed } from '../random/rng';
import { mean as sampleMean, variance as sampleVariance } from '../stats/descriptive';
import { normalQuantile } from '../special/gamma';
import type { Provenance } from './types';

/* ------------------------------------------------- scenario generation */

/**
 * Latin hypercube scenarios, built on `src/engine/qmc/stratified`. LHS removes
 * the sampling variance of every additive part of the integrand, which on a
 * recourse function is usually most of it, and distinct LHS designs remain
 * independent of each other, so the replication-based gap estimate below stays
 * valid. That second property is why LHS is used here and an unrandomised
 * low-discrepancy set is not.
 */
export function latinHypercubeScenarios(
  dimension: number,
  count: number,
  seed: Seed,
  inverseCdf: (u: number, coordinate: number) => number,
): number[][] {
  const set = latinHypercube({ dimension, count, seed });
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const row: number[] = [];
    for (let k = 0; k < dimension; k++) {
      const v = inverseCdf(set.values[i * dimension + k], k);
      if (!Number.isFinite(v)) {
        throw new EngineError(
          `The inverse CDF for coordinate ${k + 1} returned ${String(v)} at u = ${set.values[i * dimension + k].toPrecision(6)}. A scenario value must be finite; a distribution with an infinite quantile must be truncated explicitly.`,
          'finite',
        );
      }
      row.push(v);
    }
    out.push(row);
  }
  return out;
}

/** Independent Monte Carlo scenarios, for comparison against the stratified set. */
export function monteCarloScenarios(
  dimension: number,
  count: number,
  seed: Seed,
  inverseCdf: (u: number, coordinate: number) => number,
): number[][] {
  const rng = new Random(seed);
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const row: number[] = [];
    for (let k = 0; k < dimension; k++) row.push(inverseCdf(rng.uniformOpen(), k));
    out.push(row);
  }
  return out;
}

/* ------------------------------------------------------------ the SAA */

export interface SaaProblem<S> {
  name: string;
  /** Draw one scenario. */
  sample(rng: Random): S;
  /** Solve the N-scenario approximation (equal probabilities). */
  solve(scenarios: S[]): { x: number[]; objective: number };
  /** Evaluate a FIXED decision on a scenario sample; must be unbiased for its true value. */
  evaluate(x: number[], scenarios: S[]): number;
}

export interface SaaOptions {
  /** Scenarios per replication, N. */
  sampleSize: number;
  /** Independent replications, M, used for the lower bound. */
  replications: number;
  /** Fresh scenarios used to evaluate the candidate, N'. */
  evaluationSize: number;
  seed: Seed;
  /** One-sided confidence level for the gap bound. */
  confidence?: number;
}

export interface SaaResult {
  candidate: number[];
  /** Mean of the replicate in-sample optima: an estimate of E[v̂_N] <= v*. */
  lowerBoundEstimate: number;
  lowerBoundStandardError: number;
  /** One-sided lower confidence limit on v*. */
  lowerConfidenceLimit: number;
  /** Unbiased estimate of f(candidate) >= v*. */
  upperBoundEstimate: number;
  upperBoundStandardError: number;
  upperConfidenceLimit: number;
  /** Point estimate of the optimality gap of the candidate. */
  gapEstimate: number;
  /** One-sided upper confidence bound on the gap. The honest headline number. */
  gapUpperConfidenceBound: number;
  confidence: number;
  replicateObjectives: number[];
  sampleSize: number;
  evaluationSize: number;
  provenance: Provenance;
}

/**
 * Sample average approximation with a statistical optimality gap.
 *
 * The candidate is the replicate decision with the best FRESH-SAMPLE value, not
 * the best in-sample value; selecting on the in-sample value would reuse the
 * sample that is already biased and would make the upper bound biased too.
 */
export function sampleAverageApproximation<S>(problem: SaaProblem<S>, options: SaaOptions): SaaResult {
  const { sampleSize: N, replications: M, evaluationSize: NP } = options;
  const confidence = options.confidence ?? 0.95;
  if (!Number.isInteger(N) || N < 2) throw new EngineError('The SAA sample size must be a whole number of at least 2.', 'range');
  if (!Number.isInteger(M) || M < 2) throw new EngineError('The gap estimate needs at least 2 independent replications; with one there is no variance to estimate and no interval can be reported.', 'range');
  if (!Number.isInteger(NP) || NP < 2) throw new EngineError('The evaluation sample must contain at least 2 scenarios.', 'range');
  if (!Number.isFinite(confidence) || confidence <= 0.5 || confidence >= 1) throw new EngineError(`The confidence level must lie in (0.5, 1); got ${String(confidence)}.`, 'range');

  const rng = new Random(options.seed);
  const replicateObjectives: number[] = [];
  const candidates: number[][] = [];
  for (let r = 0; r < M; r++) {
    const scenarios = Array.from({ length: N }, () => problem.sample(rng));
    const sol = problem.solve(scenarios);
    if (!Number.isFinite(sol.objective)) {
      throw new EngineError(`Replication ${r + 1} of the SAA for "${problem.name}" returned objective ${String(sol.objective)}; an unsolved replication cannot be averaged into a bound.`, 'finite');
    }
    replicateObjectives.push(sol.objective);
    candidates.push(sol.x);
  }
  const evalRng = new Random(`${String(options.seed)}:evaluate`);
  const evalScenarios = Array.from({ length: NP }, () => problem.sample(evalRng));
  let best = 0;
  let bestValue = Infinity;
  const values: number[] = [];
  for (let r = 0; r < M; r++) {
    const v = problem.evaluate(candidates[r], evalScenarios);
    values.push(v);
    if (v < bestValue) {
      bestValue = v;
      best = r;
    }
  }
  const candidate = candidates[best];
  // Fresh, independent sample for the upper bound, so the selection above does
  // not contaminate it.
  const ubRng = new Random(`${String(options.seed)}:upper`);
  const perScenario: number[] = [];
  for (let i = 0; i < NP; i++) perScenario.push(problem.evaluate(candidate, [problem.sample(ubRng)]));
  const ubMean = sampleMean(perScenario);
  const ubSe = Math.sqrt(sampleVariance(perScenario) / NP);
  const lbMean = sampleMean(replicateObjectives);
  const lbSe = Math.sqrt(sampleVariance(replicateObjectives) / M);
  const z = normalQuantile(confidence);
  const lowerConfidenceLimit = lbMean - z * lbSe;
  const upperConfidenceLimit = ubMean + z * ubSe;
  const gap = ubMean - lbMean;
  // One-sided bound on the gap: combine the two standard errors in quadrature.
  const gapSe = Math.sqrt(ubSe * ubSe + lbSe * lbSe);
  const gapUpper = gap + z * gapSe;
  return {
    candidate,
    lowerBoundEstimate: lbMean,
    lowerBoundStandardError: lbSe,
    lowerConfidenceLimit,
    upperBoundEstimate: ubMean,
    upperBoundStandardError: ubSe,
    upperConfidenceLimit,
    gapEstimate: gap,
    gapUpperConfidenceBound: gapUpper,
    confidence,
    replicateObjectives,
    sampleSize: N,
    evaluationSize: NP,
    provenance: {
      exactness: 'empirical',
      method: `Sample average approximation: ${M} independent replications of ${N} scenarios for the lower bound, ${NP} fresh scenarios for the candidate's value, one-sided ${(confidence * 100).toFixed(1)}% gap bound`,
      assumedInputs: [
        'The scenario sampler draws independently from the distribution the problem refers to. Every statement below rests on that and on the central limit theorem for the two sample means.',
      ],
      limitations: [
        `The in-sample optimum is optimistically biased: E[v̂_N] <= v*. The replicate mean ${lbMean.toPrecision(8)} is therefore NOT an estimate of the optimal value but of a lower bound on it, and the bias shrinks only as N grows.`,
        `The candidate decision has optimality gap at most ${gapUpper.toPrecision(6)} with confidence ${(confidence * 100).toFixed(1)}%. The point estimate ${gap.toPrecision(6)} is not the gap; the bound is.`,
        'Both bounds are random. A single run that happens to report a small gap has not proved the gap is small; the confidence statement is the whole content of the result.',
      ],
    },
  };
}

/* ------------------------------------------------- scenario reduction */

export interface ScenarioReduction {
  /** Indices of the retained scenarios, in the order they were selected. */
  indices: number[];
  /** Redistributed probabilities of the retained scenarios. */
  probabilities: number[];
  /** Wasserstein-1 distance from the original measure to the reduced one. */
  wassersteinDistance: number;
  /** Which original scenario was absorbed into which retained one. */
  assignment: number[];
  provenance: Provenance;
}

function distance(a: number[], b: number[]): number {
  let acc = 0;
  for (let k = 0; k < a.length; k++) {
    const d = a[k] - b[k];
    acc += d * d;
  }
  return Math.sqrt(acc);
}

/**
 * Wasserstein-1 distance of the reduction that assigns every discarded scenario
 * to its nearest retained one. For that fixed assignment the transport cost is
 * Σ_i p_i · min_{j ∈ S} ‖ξ_i − ξ_j‖, and the nearest-neighbour assignment is
 * optimal among all assignments to S, so this IS the W₁ distance between the
 * original measure and the best measure supported on S.
 */
export function reductionDistance(points: number[][], probabilities: number[], retained: number[]): { distance: number; assignment: number[] } {
  const assignment: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    let bestJ = retained[0];
    let bestD = Infinity;
    for (const j of retained) {
      const d = distance(points[i], points[j]);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    assignment.push(bestJ);
    total += probabilities[i] * bestD;
  }
  return { distance: total, assignment };
}

/**
 * Forward-selection scenario reduction (Dupačová, Gröwe-Kuska & Römisch 2003).
 *
 * Greedily add the scenario that reduces the Wasserstein distance most, then
 * redistribute each discarded scenario's probability to its nearest retained
 * one. Because adding a point can only shrink every nearest-neighbour distance,
 * the reported distance is monotone non-increasing in the retained count by
 * construction — which is checked here, not assumed.
 */
export function reduceScenarios(points: number[][], probabilities: number[], retain: number): ScenarioReduction {
  const n = points.length;
  if (n === 0) throw new EngineError('Scenario reduction needs a non-empty scenario set.', 'empty');
  if (probabilities.length !== n) throw new EngineError(`There are ${n} scenarios but ${probabilities.length} probabilities.`, 'shape');
  const sum = stableSum(probabilities);
  if (Math.abs(sum - 1) > 1e-9) throw new EngineError(`The scenario probabilities sum to ${sum.toPrecision(12)}, not 1.`, 'sum');
  if (!Number.isInteger(retain) || retain < 1 || retain > n) {
    throw new EngineError(`Asked to retain ${String(retain)} of ${n} scenarios; the count must be a whole number between 1 and ${n}.`, 'range');
  }
  const dim = points[0].length;
  for (const p of points) if (p.length !== dim) throw new EngineError('All scenarios must have the same dimension.', 'shape');

  const retained: number[] = [];
  let lastDistance = Infinity;
  while (retained.length < retain) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let j = 0; j < n; j++) {
      if (retained.includes(j)) continue;
      const d = reductionDistance(points, probabilities, [...retained, j]).distance;
      if (d < bestDist - 1e-15) {
        bestDist = d;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) break;
    if (bestDist > lastDistance + 1e-9) {
      throw new EngineError(
        `Retaining one more scenario INCREASED the Wasserstein distance from ${lastDistance.toPrecision(10)} to ${bestDist.toPrecision(10)}. That is impossible for nearest-neighbour redistribution and indicates a numerical failure.`,
        'degenerate',
      );
    }
    lastDistance = bestDist;
    retained.push(bestIdx);
  }
  const { distance: wd, assignment } = reductionDistance(points, probabilities, retained);
  const probs = retained.map((j) => stableSum(probabilities.filter((_, i) => assignment[i] === j)));
  return {
    indices: retained,
    probabilities: probs,
    wassersteinDistance: wd,
    assignment,
    provenance: {
      exactness: 'numerical',
      method: `Forward-selection scenario reduction from ${n} to ${retained.length} scenarios with nearest-neighbour probability redistribution; Wasserstein-1 distance ${wd.toPrecision(6)}`,
      assumedInputs: ['The metric on scenario space is the Euclidean one. A different metric gives a different reduction, and the right metric depends on how the recourse cost responds to each coordinate.'],
      limitations: [
        `The reduction costs something and the cost is ${wd.toPrecision(6)} in Wasserstein distance. For a recourse function with Lipschitz constant L the objective error is at most L times that, so the distance is only useful alongside a view of L.`,
        'Forward selection is greedy: the retained set is not the W₁-optimal set of its size, only a good one found in n·k distance sweeps.',
      ],
    },
  };
}
