/**
 * Centrality: which nodes matter, under five different meanings of "matter".
 *
 * The five disagree, and the disagreement is informative rather than a defect.
 * Degree is local exposure; betweenness is control of flow; closeness is
 * reach; eigenvector centrality is "important because connected to important
 * nodes"; PageRank is the same idea made well-defined on a directed graph with
 * dangling nodes. A node can be top-ranked by one and unremarkable by another.
 *
 * All iterative. Betweenness is O(n*m) and is refused above a stated size.
 */
import { EngineError, Validator } from '../core/result';
import { requireSize } from './graph';
import { degreeSummary } from './measures';
import { adjacencySpectrum } from './spectral';
import type { Graph, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, NETWORK_LIMITS, nq } from './types';

export interface CentralityResult {
  measure: string;
  /** Score per node, in node-index order. */
  score: number[];
  /** Node ids sorted by descending score. */
  ranking: { id: string; index: number; score: number }[];
  exactness: 'exact' | 'numerical';
  formula: string;
  iterations?: number;
  conditionalOn: string;
  notes: string[];
}

function rank(g: Graph, score: number[]): CentralityResult['ranking'] {
  return score
    .map((s, index) => ({ id: g.ids[index], index, score: s }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/* ------------------------------------------------------------ betweenness */

/**
 * Brandes betweenness centrality, unweighted, iterative BFS.
 *
 * Normalised by the number of ordered (directed) or unordered (undirected)
 * pairs not involving the node, so values lie in [0,1]; `raw` carries the
 * unnormalised pair counts, which is what hand calculations give. For a star
 * on n nodes the centre's raw betweenness is exactly (n-1)(n-2)/2.
 */
export function betweennessCentrality(g: Graph, options: { normalised?: boolean } = {}): CentralityResult & { raw: number[] } {
  requireSize(
    g,
    NETWORK_LIMITS.betweennessMaxNodes,
    'Betweenness centrality',
    'O(n*m) time — a full single-source shortest-path sweep from every node',
  );
  const n = g.n;
  const raw = new Array<number>(n).fill(0);
  const sigma = new Float64Array(n);
  const dist = new Int32Array(n);
  const delta = new Float64Array(n);
  const order = new Int32Array(n);
  const queue = new Int32Array(n);
  const preds: number[][] = Array.from({ length: n }, () => []);

  for (let s = 0; s < n; s++) {
    sigma.fill(0);
    delta.fill(0);
    dist.fill(-1);
    for (let i = 0; i < n; i++) preds[i].length = 0;
    sigma[s] = 1;
    dist[s] = 0;
    let head = 0;
    let tail = 0;
    let ordered = 0;
    queue[tail++] = s;
    while (head < tail) {
      const u = queue[head++];
      order[ordered++] = u;
      const nb = g.out[u];
      for (let k = 0; k < nb.length; k++) {
        const w = nb[k];
        if (dist[w] < 0) {
          dist[w] = dist[u] + 1;
          queue[tail++] = w;
        }
        if (dist[w] === dist[u] + 1) {
          sigma[w] += sigma[u];
          preds[w].push(u);
        }
      }
    }
    for (let t = ordered - 1; t > 0; t--) {
      const w = order[t];
      const coeff = (1 + delta[w]) / sigma[w];
      const pr = preds[w];
      for (let k = 0; k < pr.length; k++) {
        const u = pr[k];
        delta[u] += sigma[u] * coeff;
      }
      if (w !== s) raw[w] += delta[w];
    }
  }
  // Undirected: every pair was counted from both endpoints.
  if (!g.directed) for (let i = 0; i < n; i++) raw[i] /= 2;

  const normalised = options.normalised ?? true;
  const pairs = g.directed ? (n - 1) * (n - 2) : ((n - 1) * (n - 2)) / 2;
  const score = normalised && pairs > 0 ? raw.map((x) => x / pairs) : raw.slice();
  return {
    measure: 'betweenness',
    score,
    raw,
    ranking: rank(g, score),
    exactness: 'exact',
    formula: 'C_B(v) = sum_{s != v != t} sigma_st(v) / sigma_st  (Brandes accumulation)',
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      normalised
        ? `Normalised by ${pairs} node pairs, so scores are in [0,1]; "raw" holds the unnormalised pair counts.`
        : 'Unnormalised pair counts.',
      'Pairs with no connecting path contribute nothing; on a disconnected graph betweenness is computed within components.',
    ],
  };
}

/* --------------------------------------------------------------- closeness */

/**
 * Closeness, plus the harmonic variant.
 *
 * Plain closeness (n-1 over the sum of distances) is undefined on a
 * disconnected graph. Rather than substitute a number, this returns the
 * Wasserman–Faust component-corrected closeness, which is comparable across
 * components, and harmonic closeness, which is defined unconditionally.
 */
export function closenessCentrality(g: Graph): CentralityResult & { harmonic: number[] } {
  requireSize(g, NETWORK_LIMITS.pathsMaxNodes, 'Closeness centrality', 'O(n*m) time (a BFS from every node)');
  const score = new Array<number>(g.n).fill(0);
  const harmonic = new Array<number>(g.n).fill(0);
  let anyDisconnected = false;
  for (let s = 0; s < g.n; s++) {
    const dist = new Int32Array(g.n).fill(-1);
    const queue = new Int32Array(g.n);
    let head = 0;
    let tail = 0;
    dist[s] = 0;
    queue[tail++] = s;
    let sum = 0;
    let reached = 0;
    let inv = 0;
    while (head < tail) {
      const u = queue[head++];
      const nb = g.out[u];
      for (let k = 0; k < nb.length; k++) {
        const w = nb[k];
        if (dist[w] < 0) {
          dist[w] = dist[u] + 1;
          queue[tail++] = w;
          sum += dist[w];
          inv += 1 / dist[w];
          reached++;
        }
      }
    }
    if (reached < g.n - 1) anyDisconnected = true;
    // Wasserman–Faust: (reached/(n-1)) * (reached/sum).
    score[s] = sum > 0 ? (reached / (g.n - 1)) * (reached / sum) : 0;
    harmonic[s] = g.n > 1 ? inv / (g.n - 1) : 0;
  }
  return {
    measure: 'closeness',
    score,
    harmonic,
    ranking: rank(g, score),
    exactness: 'exact',
    formula: 'C_WF(v) = (r_v/(n-1)) * (r_v / sum_{u reachable} d(v,u)); harmonic: (1/(n-1)) sum 1/d(v,u)',
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: anyDisconnected
      ? [
          'This graph is disconnected, so the textbook closeness (n-1)/sum(d) is undefined. The Wasserman–Faust ' +
            'component-corrected form is reported instead, and "harmonic" is the harmonic closeness, which is ' +
            'defined without any correction. Neither is the textbook formula; they are not interchangeable with it.',
        ]
      : ['The graph is connected, so Wasserman–Faust closeness coincides with the textbook (n-1)/sum(d) form.'],
  };
}

/* ----------------------------------------------- eigenvector / Katz / rank */

export interface PowerIterationOptions {
  tolerance?: number;
  maxIterations?: number;
}

/**
 * Eigenvector centrality by power iteration on the adjacency matrix: the
 * dominant eigenvector, L2-normalised and signed positive.
 *
 * Refuses to return a vector it did not converge to. On a disconnected graph
 * the dominant eigenvector is supported on one component only, which is a real
 * property of the measure and is reported as a warning rather than patched.
 */
export function eigenvectorCentrality(
  g: Graph,
  options: PowerIterationOptions = {},
): CentralityResult & { eigenvalue: NetworkQuantity; residual: number } {
  const tol = options.tolerance ?? 1e-12;
  const maxIter = options.maxIterations ?? 10_000;
  if (g.m === 0) {
    throw new EngineError(
      'Eigenvector centrality is undefined on a graph with no edges: the adjacency matrix is zero and has no ' +
        'dominant eigenvector. Every node is equally (un)important, which is a statement about the graph, not a score.',
      'undefined',
    );
  }
  let x = new Float64Array(g.n).fill(1 / Math.sqrt(g.n));
  let y = new Float64Array(g.n);
  let lambda = 0;
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    y.fill(0);
    for (let i = 0; i < g.n; i++) {
      const nb = g.in[i];
      const ws = g.inWeights[i];
      let s = 0;
      for (let k = 0; k < nb.length; k++) s += ws[k] * x[nb[k]];
      y[i] = s;
    }
    let norm = 0;
    for (let i = 0; i < g.n; i++) norm += y[i] * y[i];
    norm = Math.sqrt(norm);
    if (norm === 0) {
      throw new EngineError(
        'Power iteration collapsed to the zero vector: the adjacency matrix annihilated the starting vector, which ' +
          'happens on a bipartite-like or empty structure. No eigenvector centrality is reported.',
        'nonconvergent',
      );
    }
    lambda = norm;
    let diff = 0;
    for (let i = 0; i < g.n; i++) {
      const next = y[i] / norm;
      diff += Math.abs(next - x[i]);
      y[i] = next;
    }
    const tmp = x;
    x = y;
    y = tmp;
    iterations = it + 1;
    if (diff < tol) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(
      `Eigenvector centrality did not converge in ${maxIter} power iterations (last L1 change above the ${tol} ` +
        'tolerance). This happens when the two largest eigenvalues are nearly equal in modulus, for example on a ' +
        'bipartite graph. No score is returned rather than an unconverged one.',
      'nonconvergent',
    );
  }
  // Sign convention: make the vector non-negative (Perron–Frobenius).
  let negative = 0;
  for (let i = 0; i < g.n; i++) if (x[i] < 0) negative++;
  if (negative > g.n / 2) for (let i = 0; i < g.n; i++) x[i] = -x[i];
  // Residual of the eigen-equation, as an honest accuracy statement.
  let residual = 0;
  for (let i = 0; i < g.n; i++) {
    const nb = g.in[i];
    const ws = g.inWeights[i];
    let s = 0;
    for (let k = 0; k < nb.length; k++) s += ws[k] * x[nb[k]];
    residual = Math.max(residual, Math.abs(s - lambda * x[i]));
  }
  const score = Array.from(x);
  const zeros = score.filter((s) => Math.abs(s) < 1e-10).length;
  return {
    measure: 'eigenvector',
    score,
    ranking: rank(g, score),
    exactness: 'numerical',
    formula: 'A x = lambda_max x, ||x||_2 = 1, computed by power iteration',
    iterations,
    eigenvalue: nq('Leading adjacency eigenvalue', lambda, 'numerical', {
      formula: 'lambda_max(A)',
      note: 'For an SIS process the epidemic threshold is 1/lambda_max, so this number is the connectivity that matters.',
    }),
    residual,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes:
      zeros > 0
        ? [
            `${zeros} nodes score (numerically) zero. The dominant eigenvector of a disconnected graph is supported ` +
              'on a single component, so nodes elsewhere score zero however well connected they are locally. That is ' +
              'a known limitation of the measure, not an artefact of this computation; Katz or PageRank avoid it.',
            `Eigen-equation residual max|Ax - lambda x| = ${residual.toExponential(2)}.`,
          ]
        : [`Eigen-equation residual max|Ax - lambda x| = ${residual.toExponential(2)}.`],
  };
}

/**
 * Katz centrality: sum over all walks, discounted by alpha^length.
 *
 * Requires alpha < 1/lambda_max for the series to converge. A larger alpha is
 * refused with the admissible bound named, rather than iterated to a divergent
 * value that looks like a score.
 */
export function katzCentrality(
  g: Graph,
  alpha: number,
  options: PowerIterationOptions & { beta?: number } = {},
): CentralityResult & { admissibleAlphaBound: number } {
  const v = new Validator();
  v.positive(alpha, 'alpha', 'Katz attenuation alpha');
  const beta = options.beta ?? 1;
  v.positive(beta, 'beta', 'Katz baseline beta');
  v.throwIfInvalid();
  const lambdaMax = eigenvectorCentrality(g, options).eigenvalue.value;
  const bound = 1 / lambdaMax;
  if (alpha >= bound) {
    throw new EngineError(
      `Katz centrality needs alpha < 1/lambda_max = ${bound.toPrecision(6)} for the walk series sum_k alpha^k A^k ` +
        `to converge; alpha = ${alpha} is at or above that. The series diverges, so there is no centrality to report.`,
      'range',
    );
  }
  const tol = options.tolerance ?? 1e-12;
  const maxIter = options.maxIterations ?? 10_000;
  const x = new Float64Array(g.n).fill(beta);
  const next = new Float64Array(g.n);
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    for (let i = 0; i < g.n; i++) {
      const nb = g.in[i];
      const ws = g.inWeights[i];
      let s = 0;
      for (let k = 0; k < nb.length; k++) s += ws[k] * x[nb[k]];
      next[i] = alpha * s + beta;
    }
    let diff = 0;
    for (let i = 0; i < g.n; i++) {
      diff += Math.abs(next[i] - x[i]);
      x[i] = next[i];
    }
    iterations = it + 1;
    if (diff < tol) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(
      `Katz centrality did not converge in ${maxIter} iterations at alpha = ${alpha} (the admissible bound is ` +
        `${bound.toPrecision(6)}; convergence is slow close to it).`,
      'nonconvergent',
    );
  }
  return {
    measure: 'katz',
    score: Array.from(x),
    ranking: rank(g, Array.from(x)),
    exactness: 'numerical',
    formula: 'x = alpha A^T x + beta 1, equivalently x = beta (I - alpha A^T)^-1 1',
    iterations,
    admissibleAlphaBound: bound,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `alpha = ${alpha} against the convergence bound 1/lambda_max = ${bound.toPrecision(6)}.`,
      'Unlike eigenvector centrality, Katz gives every node at least beta, so it is defined on a disconnected graph.',
    ],
  };
}

/**
 * PageRank by power iteration, with dangling mass redistributed so the vector
 * sums to exactly 1 (within floating-point renormalisation) at every step.
 */
export function pageRank(
  g: Graph,
  options: PowerIterationOptions & { damping?: number; personalisation?: number[] } = {},
): CentralityResult & { damping: number } {
  const d = options.damping ?? 0.85;
  const v = new Validator();
  v.range(d, 'damping', 'PageRank damping factor', 0, 1);
  v.throwIfInvalid();
  if (d === 1) {
    throw new EngineError(
      'A damping factor of exactly 1 makes PageRank the stationary distribution of the bare random walk, which need ' +
        'not exist or be unique on a graph with absorbing regions. Use a damping factor strictly below 1.',
      'range',
    );
  }
  const n = g.n;
  let teleport: Float64Array;
  if (options.personalisation) {
    if (options.personalisation.length !== n) {
      throw new EngineError(
        `The personalisation vector has ${options.personalisation.length} entries but the graph has ${n} nodes.`,
        'shape',
      );
    }
    let s = 0;
    for (const p of options.personalisation) {
      if (!Number.isFinite(p) || p < 0) {
        throw new EngineError('Personalisation weights must be finite and non-negative.', 'range');
      }
      s += p;
    }
    if (s <= 0) throw new EngineError('The personalisation vector sums to 0, so it defines no teleport distribution.', 'range');
    teleport = new Float64Array(options.personalisation.map((p) => p / s));
  } else {
    teleport = new Float64Array(n).fill(1 / n);
  }
  // Out-weight per node (undirected: the degree).
  const outW = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ws = g.outWeights[i];
    let s = 0;
    for (let k = 0; k < ws.length; k++) s += ws[k];
    outW[i] = s;
  }
  const x = new Float64Array(teleport);
  const next = new Float64Array(n);
  const tol = options.tolerance ?? 1e-13;
  const maxIter = options.maxIterations ?? 10_000;
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < maxIter; it++) {
    let dangling = 0;
    for (let i = 0; i < n; i++) if (outW[i] === 0) dangling += x[i];
    for (let i = 0; i < n; i++) next[i] = (1 - d) * teleport[i] + d * dangling * teleport[i];
    for (let i = 0; i < n; i++) {
      if (outW[i] === 0) continue;
      const nb = g.out[i];
      const ws = g.outWeights[i];
      const share = (d * x[i]) / outW[i];
      for (let k = 0; k < nb.length; k++) next[nb[k]] += share * ws[k];
    }
    let total = 0;
    for (let i = 0; i < n; i++) total += next[i];
    let diff = 0;
    for (let i = 0; i < n; i++) {
      next[i] /= total;
      diff += Math.abs(next[i] - x[i]);
      x[i] = next[i];
    }
    iterations = it + 1;
    if (diff < tol) {
      converged = true;
      break;
    }
  }
  if (!converged) {
    throw new EngineError(`PageRank did not converge in ${maxIter} iterations at damping ${d}.`, 'nonconvergent');
  }
  // Renormalise once more so the reported vector sums to 1 to full precision.
  let total = 0;
  for (let i = 0; i < n; i++) total += x[i];
  const score = Array.from(x, (p) => p / total);
  return {
    measure: 'pagerank',
    score,
    ranking: rank(g, score),
    exactness: 'numerical',
    formula: 'x = (1-d) v + d (A^T D^-1 x + dangling-mass * v), sum x = 1',
    iterations,
    damping: d,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      'PageRank is a probability distribution over nodes and sums to 1; the dangling mass of out-degree-zero nodes ' +
        'is redistributed over the teleport vector rather than being allowed to leak.',
    ],
  };
}

/** Degree centrality, for completeness and as the cheapest hub proxy. */
export function degreeCentrality(g: Graph): CentralityResult {
  const deg = degreeSummary(g).degree;
  const denom = g.n > 1 ? g.n - 1 : 1;
  const score = deg.map((k) => k / denom);
  return {
    measure: 'degree',
    score,
    ranking: rank(g, score),
    exactness: 'exact',
    formula: 'C_D(v) = k_v / (n-1)',
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: ['The cheapest centrality, and the one a targeted attacker can estimate without knowing the whole network.'],
  };
}

/**
 * Eigenvector centrality via the full symmetric spectrum rather than power
 * iteration, as an independent cross-check on small graphs.
 */
export function eigenvectorCentralityBySpectrum(g: Graph): { score: number[]; eigenvalue: number } {
  if (g.directed) {
    throw new EngineError(
      'The symmetric eigensolver applies to undirected graphs only; a directed adjacency matrix is not symmetric and ' +
        'may have complex eigenvalues. Use power iteration (eigenvectorCentrality) or PageRank instead.',
      'unsupported',
    );
  }
  const spec = adjacencySpectrum(g);
  const last = spec.eigenvalues.length - 1;
  const vec = spec.eigenvectors[last].slice();
  let negative = 0;
  for (const x of vec) if (x < 0) negative++;
  if (negative > vec.length / 2) for (let i = 0; i < vec.length; i++) vec[i] = -vec[i];
  return { score: vec, eigenvalue: spec.eigenvalues[last] };
}
