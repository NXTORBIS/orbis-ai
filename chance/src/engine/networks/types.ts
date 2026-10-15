/**
 * Random graphs, percolation and spreading processes — shared types.
 *
 * Every other risk module in this engine treats exposures as a list: a vector
 * of probabilities, one per component, combined under an assumed dependence.
 * Real risk is usually a *network*. Failures propagate along dependencies,
 * infections along contacts, defaults along obligations. On a network the
 * useful question is not "what is the probability that each node fails" but
 * "is there a giant connected component", and the answer to that is a *phase
 * transition*: at mean degree just below 1 an Erdős–Rényi graph is a dust of
 * O(log n) fragments, and just above 1 a constant fraction of it is a single
 * connected blob. Intuition built on independent exposures is therefore not
 * merely imprecise here, it is qualitatively wrong.
 *
 * Three principles hold throughout this module.
 *
 *  1. **Every result is conditional on the supplied structure.** A network
 *     result is only ever as good as the network, and real contact,
 *     dependency and obligation networks are almost never known. Each result
 *     type carries `conditionalOn` saying so; nothing here can tell you
 *     whether the edges you supplied are the real ones.
 *  2. **Exactness is labelled.** Measures computed on a given graph are
 *     `exact` (they are deterministic functions of that graph, whatever the
 *     graph's own provenance). Spectra, located percolation thresholds and
 *     ODE integrations are `numerical`. Simulated spreading is `empirical`
 *     and carries Monte Carlo error.
 *  3. **No plausible-looking numbers.** An edge naming a non-existent node, a
 *     duplicate edge, a negative probability, a degree sequence no simple
 *     graph can realise, a request for the diameter of a disconnected graph,
 *     a size-limit breach and an empty graph each raise an `EngineError`
 *     naming the problem. Nothing substitutes 0, NaN or Infinity.
 */
import type { Exactness } from '../core/result';

/** An edge as supplied by a caller, by node id. */
export interface EdgeInput {
  source: string;
  target: string;
  /** Strictly positive. Defaults to 1. */
  weight?: number;
}

export interface GraphInput {
  /** Unique node ids. At least one. */
  nodes: string[];
  edges: EdgeInput[];
  /** Directed graphs keep edge orientation; undirected store both directions. */
  directed?: boolean;
  /** Self-loops are rejected unless this is set. */
  allowSelfLoops?: boolean;
}

/**
 * A validated graph in index space.
 *
 * Nodes are 0..n-1; `ids[i]` recovers the caller's label. Adjacency is stored
 * as parallel arrays of neighbour indices and weights so that every algorithm
 * in this module can be written as an explicit loop over a flat array. For an
 * undirected graph `out` and `in` are the same arrays.
 */
export interface Graph {
  readonly directed: boolean;
  readonly n: number;
  /** Edge count: distinct unordered pairs when undirected, arcs when directed. */
  readonly m: number;
  readonly ids: readonly string[];
  readonly index: ReadonlyMap<string, number>;
  readonly out: readonly number[][];
  readonly outWeights: readonly number[][];
  readonly in: readonly number[][];
  readonly inWeights: readonly number[][];
  readonly selfLoops: number;
  readonly weighted: boolean;
}

/** A single number together with how it was obtained. */
export interface NetworkQuantity {
  label: string;
  value: number;
  exactness: Exactness;
  formula?: string;
  note?: string;
}

export function nq(
  label: string,
  value: number,
  exactness: Exactness,
  extra: { formula?: string; note?: string } = {},
): NetworkQuantity {
  if (!Number.isFinite(value)) {
    // An engine function that cannot produce a number must say so, not pass a
    // NaN or an Infinity along inside a labelled quantity.
    throw new Error(`Internal: quantity "${label}" is not finite (${value}).`);
  }
  return { label, value, exactness, ...extra };
}

/**
 * The sentence that belongs on every network result. Exposed as a constant so
 * that it is attached uniformly rather than paraphrased per function.
 */
export const CONDITIONAL_ON_STRUCTURE =
  'Conditional on the supplied network structure. Contact, dependency and obligation networks are almost never ' +
  'observed directly; if the edge set is wrong, every number here is wrong in ways this module cannot detect.';

/**
 * Size limits, with the cost that motivates each one. Exceeding a limit is a
 * refusal naming the limit and the cost — the alternative is freezing the
 * browser tab, which tells the user nothing.
 */
export const NETWORK_LIMITS = {
  /** Construction: adjacency lists are held in memory. */
  maxNodes: 300_000,
  maxEdges: 3_000_000,
  /** Brandes betweenness is O(n·m). */
  betweennessMaxNodes: 4_000,
  /** All-pairs BFS for mean path length and diameter is O(n·m). */
  pathsMaxNodes: 6_000,
  /** The Jacobi eigensolver is O(n^3) time and O(n^2) memory. */
  spectralMaxNodes: 500,
  /** Brute-force influence maximisation enumerates C(n,k) seed sets. */
  bruteForceInfluenceMaxNodes: 24,
} as const;

/** A Monte Carlo run that may have been cut short by cancellation. */
export interface MonteCarloMeta {
  runs: number;
  requestedRuns: number;
  /** True when the run was cancelled and the result covers fewer runs. */
  partial: boolean;
  seed: string | number;
}
