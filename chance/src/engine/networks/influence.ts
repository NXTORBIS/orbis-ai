/**
 * Influence spread: the independent cascade and linear threshold models, and
 * greedy influence maximisation.
 *
 * Choosing the k nodes whose activation spreads furthest is NP-hard. The
 * greedy algorithm — repeatedly add the node with the largest marginal gain —
 * nevertheless comes with a worst-case guarantee: because the expected spread
 * is a monotone submodular set function, greedy achieves at least (1 - 1/e),
 * about 63.2%, of the optimum (Kempe, Kleinberg, Tardos 2003; Nemhauser,
 * Wolsey, Fisher 1978). That guarantee is a theorem about the *expected*
 * spread, so it is only inherited by this implementation up to the Monte Carlo
 * error in estimating that expectation — which is stated with every result
 * rather than quietly ignored.
 */
import { EngineError, Validator } from '../core/result';
import { mean } from '../stats/descriptive';
import { Random } from '../random/rng';
import type { Graph, MonteCarloMeta, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, NETWORK_LIMITS, nq } from './types';

export const GREEDY_APPROXIMATION_RATIO = 1 - 1 / Math.E;

/* ------------------------------------------------- independent cascade */

/**
 * One independent-cascade realisation: every newly active node gets one
 * chance to activate each inactive neighbour, with probability p (or the edge
 * weight, when `useEdgeWeights` is set and weights are probabilities).
 */
export function independentCascadeRun(
  g: Graph,
  seeds: ReadonlyArray<number>,
  p: number,
  rng: Random,
  options: { useEdgeWeights?: boolean } = {},
): { active: Uint8Array; count: number } {
  const v = new Validator();
  v.probability(p, 'p', 'Activation probability p');
  v.throwIfInvalid();
  const active = new Uint8Array(g.n);
  let frontier: number[] = [];
  for (const s of seeds) {
    if (!Number.isInteger(s) || s < 0 || s >= g.n) throw new EngineError(`Seed index ${s} is outside 0..${g.n - 1}.`, 'range');
    if (!active[s]) {
      active[s] = 1;
      frontier.push(s);
    }
  }
  let count = frontier.length;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const u of frontier) {
      const nbs = g.out[u];
      const ws = g.outWeights[u];
      for (let k = 0; k < nbs.length; k++) {
        const w = nbs[k];
        if (active[w]) continue;
        const prob = options.useEdgeWeights ? ws[k] : p;
        if (prob < 0 || prob > 1) {
          throw new EngineError(
            `Edge (${g.ids[u]}, ${g.ids[w]}) has weight ${prob}, which is not a probability. With useEdgeWeights the ` +
              'weights must lie in [0,1]; they are not rescaled silently.',
            'range',
          );
        }
        if (rng.uniform() < prob) {
          active[w] = 1;
          count++;
          next.push(w);
        }
      }
    }
    frontier = next;
  }
  return { active, count };
}

/**
 * Linear threshold: a node activates once the total weight of its active
 * neighbours reaches its threshold.
 *
 * Edge influence weights into a node must sum to at most 1 for the model to be
 * well posed; this normalises by in-degree by default and refuses a supplied
 * weighting that over-sums, naming the node.
 */
export function linearThresholdRun(
  g: Graph,
  seeds: ReadonlyArray<number>,
  rng: Random,
  options: { thresholds?: ReadonlyArray<number>; useEdgeWeights?: boolean } = {},
): { active: Uint8Array; count: number; rounds: number } {
  const n = g.n;
  const thresholds = options.thresholds ?? Array.from({ length: n }, () => rng.uniform());
  if (thresholds.length !== n) {
    throw new EngineError(`${thresholds.length} thresholds were supplied for ${n} nodes.`, 'shape');
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(thresholds[i]) || thresholds[i] < 0 || thresholds[i] > 1) {
      throw new EngineError(`Threshold for node ${g.ids[i]} is ${thresholds[i]}; thresholds must lie in [0,1].`, 'range');
    }
  }
  // Incoming influence weights.
  const weightOf: number[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) {
    const inn = g.in[i];
    const ws = g.inWeights[i];
    let total = 0;
    for (let k = 0; k < inn.length; k++) total += options.useEdgeWeights ? ws[k] : 1;
    if (options.useEdgeWeights && total > 1 + 1e-9) {
      throw new EngineError(
        `The incoming influence weights of node ${g.ids[i]} sum to ${total.toPrecision(6)}, above 1. The linear ` +
          'threshold model is not defined for an over-determined node; normalise the weights or drop useEdgeWeights.',
        'range',
      );
    }
    for (let k = 0; k < inn.length; k++) {
      weightOf[i].push(options.useEdgeWeights ? ws[k] : total > 0 ? 1 / total : 0);
    }
  }
  const active = new Uint8Array(n);
  const accumulated = new Float64Array(n);
  let frontier: number[] = [];
  for (const s of seeds) {
    if (!Number.isInteger(s) || s < 0 || s >= n) throw new EngineError(`Seed index ${s} is outside 0..${n - 1}.`, 'range');
    if (!active[s]) {
      active[s] = 1;
      frontier.push(s);
    }
  }
  let count = frontier.length;
  let rounds = 0;
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const w of g.out[u]) {
        if (active[w]) continue;
        const inn = g.in[w];
        let add = 0;
        for (let k = 0; k < inn.length; k++) if (inn[k] === u) add += weightOf[w][k];
        accumulated[w] += add;
        if (accumulated[w] >= thresholds[w]) {
          active[w] = 1;
          count++;
          next.push(w);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
    rounds++;
  }
  return { active, count, rounds };
}

/* -------------------------------------------------------- spread estimate */

export interface SpreadEstimate {
  seeds: number[];
  seedIds: string[];
  expectedSpread: NetworkQuantity;
  standardError: number;
  replicates: number;
}

/** Monte Carlo estimate of the expected spread from a seed set. */
export function estimateSpread(
  g: Graph,
  seeds: ReadonlyArray<number>,
  rng: Random,
  options: { model?: 'independent-cascade' | 'linear-threshold'; p?: number; replicates?: number; useEdgeWeights?: boolean } = {},
): SpreadEstimate {
  const replicates = options.replicates ?? 100;
  const v = new Validator();
  v.integer(replicates, 'replicates', 'Replicates', 1, 1_000_000);
  v.throwIfInvalid();
  const model = options.model ?? 'independent-cascade';
  const p = options.p ?? 0.1;
  const counts = new Array<number>(replicates);
  for (let r = 0; r < replicates; r++) {
    counts[r] =
      model === 'independent-cascade'
        ? independentCascadeRun(g, seeds, p, rng, { useEdgeWeights: options.useEdgeWeights }).count
        : linearThresholdRun(g, seeds, rng, { useEdgeWeights: options.useEdgeWeights }).count;
  }
  const m = mean(counts);
  let s2 = 0;
  for (const c of counts) s2 += (c - m) ** 2;
  const se = replicates > 1 ? Math.sqrt(s2 / (replicates - 1) / replicates) : 0;
  return {
    seeds: [...seeds],
    seedIds: [...seeds].map((i) => g.ids[i]),
    expectedSpread: nq('Expected spread', m, 'empirical', {
      note: `Mean over ${replicates} realisations; standard error ${se.toPrecision(3)}.`,
    }),
    standardError: se,
    replicates,
  };
}

/* ------------------------------------------------- influence maximisation */

export interface InfluenceMaximisationResult {
  seeds: number[];
  seedIds: string[];
  expectedSpread: NetworkQuantity;
  /** Marginal gain at each greedy step — non-increasing, by submodularity. */
  marginalGains: number[];
  /** The worst-case guarantee this algorithm carries. */
  approximationGuarantee: NetworkQuantity;
  /** A lower bound on the optimum implied by the greedy value and the ratio. */
  impliedOptimumBounds: { lower: number; upperBound: number };
  meta: MonteCarloMeta;
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

/**
 * Greedy influence maximisation with lazy (CELF) marginal-gain evaluation, as
 * a generator yielding after each seed chosen.
 *
 * The (1 - 1/e) guarantee holds for the *exact* expected spread. Here the
 * expected spread is estimated by simulation, so the guarantee is inherited
 * only up to the Monte Carlo error, which is reported. Submodularity is also
 * *checked* against the observed marginal gains: a sequence of gains that
 * increases indicates the estimates are too noisy for the guarantee to mean
 * anything, and that is said rather than hidden.
 */
export function* influenceMaximisationSteps(
  g: Graph,
  k: number,
  seed: string | number,
  options: { model?: 'independent-cascade' | 'linear-threshold'; p?: number; replicates?: number; isCancelled?: () => boolean } = {},
): Generator<number, InfluenceMaximisationResult, void> {
  const v = new Validator();
  v.integer(k, 'k', 'Number of seeds k', 1, g.n);
  v.throwIfInvalid();
  const replicates = options.replicates ?? 100;
  const model = options.model ?? 'independent-cascade';
  const p = options.p ?? 0.1;
  const rng = new Random(seed);
  const chosen: number[] = [];
  const gains: number[] = [];
  let currentSpread = 0;
  let cancelled = false;

  const spreadOf = (set: number[]): number =>
    estimateSpread(g, set, rng, { model, p, replicates }).expectedSpread.value;

  // Lazy evaluation: an upper bound per candidate, refreshed only when it tops the heap.
  const bound = new Float64Array(g.n).fill(Infinity);
  const fresh = new Uint8Array(g.n);
  for (let step = 0; step < k; step++) {
    fresh.fill(0);
    let best = -1;
    let bestGain = -Infinity;
    for (;;) {
      // Candidate with the largest (possibly stale) bound.
      let cand = -1;
      let candBound = -Infinity;
      for (let i = 0; i < g.n; i++) {
        if (chosen.includes(i)) continue;
        if (bound[i] > candBound) {
          candBound = bound[i];
          cand = i;
        }
      }
      if (cand < 0) break;
      if (fresh[cand]) {
        best = cand;
        bestGain = bound[cand];
        break;
      }
      const gain = spreadOf([...chosen, cand]) - currentSpread;
      bound[cand] = gain;
      fresh[cand] = 1;
      if (gain >= bestGain) {
        bestGain = gain;
        best = cand;
      }
    }
    if (best < 0) break;
    chosen.push(best);
    gains.push(bestGain);
    currentSpread = spreadOf(chosen);
    yield chosen.length;
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }
  if (chosen.length === 0) {
    throw new EngineError('Influence maximisation selected no seed; no result is reported.', 'internal');
  }
  const finalEstimate = estimateSpread(g, chosen, rng, { model, p, replicates });
  let submodularityViolated = false;
  for (let i = 1; i < gains.length; i++) if (gains[i] > gains[i - 1] + 1e-9) submodularityViolated = true;

  const limitations = [
    'The (1 - 1/e) guarantee is a theorem about the exact expected spread. Here the expected spread is estimated by ' +
      `${replicates} simulations per candidate evaluation, so the achieved ratio is (1 - 1/e) minus an allowance for ` +
      `Monte Carlo error (standard error of the final estimate: ${finalEstimate.standardError.toPrecision(3)}).`,
    'The guarantee is a WORST CASE. On most graphs greedy does far better; it also never certifies that the chosen ' +
      'set is optimal, and the true optimum is not computed here (that is NP-hard).',
  ];
  if (submodularityViolated) {
    limitations.push(
      'The observed marginal gains are NOT non-increasing, although the true expected spread is submodular. The ' +
        'estimates are therefore too noisy at this number of replicates for the approximation guarantee to be ' +
        'meaningful. Increase the replicates.',
    );
  }
  if (cancelled) limitations.push(`PARTIAL: cancelled after choosing ${chosen.length} of ${k} seeds.`);

  return {
    seeds: chosen,
    seedIds: chosen.map((i) => g.ids[i]),
    expectedSpread: finalEstimate.expectedSpread,
    marginalGains: gains,
    approximationGuarantee: nq('Approximation ratio guarantee', GREEDY_APPROXIMATION_RATIO, 'exact', {
      formula: 'greedy >= (1 - 1/e) x optimum',
      note: 'Holds because the expected spread of a seed set is monotone and submodular (Kempe–Kleinberg–Tardos), so ' +
        'the Nemhauser–Wolsey–Fisher bound for greedy maximisation of a submodular function applies.',
    }),
    impliedOptimumBounds: {
      lower: finalEstimate.expectedSpread.value,
      upperBound: finalEstimate.expectedSpread.value / GREEDY_APPROXIMATION_RATIO,
    },
    meta: { runs: chosen.length, requestedRuns: k, partial: cancelled, seed },
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `${chosen.length} seeds chosen greedily with lazy evaluation; marginal gains ${gains.map((x) => x.toPrecision(3)).join(', ')}.`,
      `The optimum lies in [${finalEstimate.expectedSpread.value.toPrecision(4)}, ` +
        `${(finalEstimate.expectedSpread.value / GREEDY_APPROXIMATION_RATIO).toPrecision(4)}]: at least what greedy ` +
        'achieved, and at most that divided by (1 - 1/e).',
    ],
    limitations,
  };
}

export function runInfluenceMaximisation(
  g: Graph,
  k: number,
  seed: string | number,
  options: Parameters<typeof influenceMaximisationSteps>[3] = {},
): InfluenceMaximisationResult {
  const it = influenceMaximisationSteps(g, k, seed, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/**
 * Brute-force optimal seed set, by enumerating every set of size k.
 *
 * Only feasible on a tiny graph, which is exactly where it is useful: it lets
 * the greedy guarantee be checked rather than taken on trust. Refused above a
 * small node limit, naming the combinatorial cost.
 */
export function bruteForceInfluenceMaximisation(
  g: Graph,
  k: number,
  seed: string | number,
  options: { model?: 'independent-cascade' | 'linear-threshold'; p?: number; replicates?: number } = {},
): { seeds: number[]; expectedSpread: NetworkQuantity; setsEvaluated: number } {
  const v = new Validator();
  v.integer(k, 'k', 'Number of seeds k', 1, g.n);
  v.throwIfInvalid();
  if (g.n > NETWORK_LIMITS.bruteForceInfluenceMaxNodes) {
    const sets = binomialApprox(g.n, k);
    throw new EngineError(
      `Brute-force influence maximisation on ${g.n} nodes is refused: it would evaluate about ${sets.toPrecision(3)} ` +
        `seed sets (C(${g.n},${k})), each by simulation. The limit is ${NETWORK_LIMITS.bruteForceInfluenceMaxNodes} ` +
        'nodes. Use the greedy algorithm, which carries a (1 - 1/e) guarantee.',
      'limit',
    );
  }
  const rng = new Random(seed);
  const replicates = options.replicates ?? 100;
  const model = options.model ?? 'independent-cascade';
  const p = options.p ?? 0.1;
  let bestSet: number[] = [];
  let bestValue = -Infinity;
  let evaluated = 0;
  const combo = new Array<number>(k).fill(0);
  const recurseFree = (start: number, depth: number): void => {
    if (depth === k) {
      const val = estimateSpread(g, combo, rng, { model, p, replicates }).expectedSpread.value;
      evaluated++;
      if (val > bestValue) {
        bestValue = val;
        bestSet = [...combo];
      }
      return;
    }
    for (let i = start; i < g.n; i++) {
      combo[depth] = i;
      recurseFree(i + 1, depth + 1);
    }
  };
  // Depth is bounded by k, not by the graph size, so this recursion cannot grow
  // with n — the project's no-deep-recursion rule is about graph traversal.
  recurseFree(0, 0);
  if (evaluated === 0) throw new EngineError(`No seed set of size ${k} exists on ${g.n} nodes.`, 'range');
  return {
    seeds: bestSet,
    expectedSpread: nq('Optimal expected spread (brute force)', bestValue, 'empirical', {
      note: `Best of ${evaluated} enumerated seed sets, each estimated from ${replicates} simulations. "Optimal" here ` +
        'means optimal with respect to the ESTIMATED spread; two sets within Monte Carlo error of each other cannot ' +
        'be separated at this number of replicates.',
    }),
    setsEvaluated: evaluated,
  };
}

function binomialApprox(n: number, k: number): number {
  let r = 1;
  for (let i = 0; i < k; i++) r *= (n - i) / (i + 1);
  return r;
}
