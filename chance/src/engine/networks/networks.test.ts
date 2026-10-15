/**
 * Tests for the networks module.
 *
 * Reference values are independent of the implementation under test. They come
 * from three sources only:
 *
 *  1. Hand calculation on graphs small enough to do by hand, with the
 *     derivation written in a comment (a star's centre has betweenness exactly
 *     (n-1)(n-2)/2; a complete graph has clustering exactly 1; a cycle of n has
 *     diameter floor(n/2); the complete graph K_n has algebraic connectivity
 *     exactly n; the Petersen graph has girth 5 and diameter 2).
 *  2. Closed-form theory solved INDEPENDENTLY in this file — the
 *     Erdős–Rényi giant-component equation S = 1 - exp(-cS) is solved here by
 *     fixed-point iteration, not by calling the module's own solver; PageRank
 *     is recomputed here by plain power iteration; betweenness is recomputed
 *     here by brute-force enumeration of every shortest path.
 *  3. Exactly known results from the literature, cited where used (bond
 *     percolation on the 2-D square lattice has threshold exactly 1/2, Kesten
 *     1980; Barabási–Albert has degree exponent exactly 3; the greedy
 *     submodular bound is 1 - 1/e).
 *
 * Every Monte Carlo tolerance carries a comment justifying its size.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import {
  GREEDY_APPROXIMATION_RATIO,
  algebraicConnectivity,
  barabasiAlbert,
  bootstrapPercolation,
  bruteForceInfluenceMaximisation,
  buildGraph,
  cascadingFailure,
  chooseImmunisation,
  chungLu,
  closenessCentrality,
  clustering,
  compareInterventions,
  configurationModel,
  connectedComponents,
  degreeAssortativity,
  degreeCentrality,
  degreeSummary,
  eigenvectorCentrality,
  eigenvectorCentralityBySpectrum,
  erdosGallaiCheck,
  erdosRenyiGiantFraction,
  erdosRenyiGnm,
  erdosRenyiGnp,
  explosivePercolation,
  fitPowerLawLogLog,
  fitPowerLawMLE,
  friendshipParadox,
  independentCascadeRun,
  influenceMaximisationSteps,
  linearThresholdRun,
  jacobiEigenSymmetric,
  kCoreDecomposition,
  katzCentrality,
  laplacianSpectrum,
  massActionODE,
  molloyReed,
  pageRank,
  pathLengths,
  percolationCurveSteps,
  plantedPartition,
  powerLawDegreeSequence,
  randomGeometricGraph,
  recoverTwoBlocks,
  reproductionNumbers,
  requireDiameter,
  betweennessCentrality,
  outbreakProbability,
  runInfluenceMaximisation,
  runPercolationCurve,
  runRobustness,
  runSpreadEnsemble,
  selectPowerLawCutoff,
  simulateSpreadRun,
  spectralPartition,
  spreadEnsembleSteps,
  squareLattice,
  stochasticBlockModel,
  stronglyConnectedComponents,
  wattsStrogatz,
  NETWORK_LIMITS,
} from './index';
import type { Graph } from './types';

/* ------------------------------------------------------------- helpers */

function named(n: number, pairs: [number, number][], directed = false): Graph {
  return buildGraph({
    nodes: Array.from({ length: n }, (_, i) => `v${i}`),
    edges: pairs.map(([a, b]) => ({ source: `v${a}`, target: `v${b}` })),
    directed,
  });
}

/** Path graph: 0-1-2-...-(n-1). */
function path(n: number): Graph {
  return named(n, Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]));
}
/** Star: node 0 at the centre, 1..n-1 as leaves. */
function star(n: number): Graph {
  return named(n, Array.from({ length: n - 1 }, (_, i) => [0, i + 1] as [number, number]));
}
/** Cycle of n. */
function cycle(n: number): Graph {
  return named(n, Array.from({ length: n }, (_, i) => [i, (i + 1) % n] as [number, number]));
}
/** Complete graph K_n. */
function complete(n: number): Graph {
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  return named(n, pairs);
}
/**
 * The Petersen graph: outer 5-cycle 0..4, inner pentagram 5..9 (i joined to
 * i+2 mod 5), spokes i–(5+i). 3-regular, girth 5, diameter 2, no triangles.
 */
function petersen(): Graph {
  const pairs: [number, number][] = [];
  for (let i = 0; i < 5; i++) pairs.push([i, (i + 1) % 5]);
  for (let i = 0; i < 5; i++) pairs.push([5 + i, 5 + ((i + 2) % 5)]);
  for (let i = 0; i < 5; i++) pairs.push([i, 5 + i]);
  return named(10, pairs);
}

/**
 * The Erdős–Rényi giant-component fraction, solved HERE by fixed-point
 * iteration on S = 1 - exp(-cS) so that the module's own Brent solver is not
 * the reference for itself.
 */
function giantFractionByIteration(c: number): number {
  if (c <= 1) return 0;
  let s = 0.5;
  for (let i = 0; i < 100_000; i++) {
    const next = 1 - Math.exp(-c * s);
    if (Math.abs(next - s) < 1e-15) return next;
    s = next;
  }
  return s;
}

/**
 * Brute-force betweenness: enumerate EVERY simple path, keep the shortest
 * length per unordered pair, then count the fraction of shortest paths through
 * each interior node. Exponential, so only for tiny graphs — which is the
 * point: it shares no code with Brandes.
 */
function bruteForceBetweenness(g: Graph): number[] {
  const n = g.n;
  const allPaths: number[][] = [];
  const walk = (current: number[], visited: boolean[]): void => {
    const u = current[current.length - 1];
    for (const w of g.out[u]) {
      if (visited[w]) continue;
      visited[w] = true;
      current.push(w);
      allPaths.push([...current]);
      walk(current, visited);
      current.pop();
      visited[w] = false;
    }
  };
  for (let s = 0; s < n; s++) {
    const visited = new Array<boolean>(n).fill(false);
    visited[s] = true;
    walk([s], visited);
  }
  const shortest = new Map<string, number>();
  for (const p of allPaths) {
    const a = p[0];
    const b = p[p.length - 1];
    if (a >= b) continue;
    const key = `${a}|${b}`;
    const len = p.length - 1;
    const cur = shortest.get(key);
    if (cur === undefined || len < cur) shortest.set(key, len);
  }
  const score = new Array<number>(n).fill(0);
  for (const [key, len] of shortest) {
    const [a, b] = key.split('|').map(Number);
    const geodesics = allPaths.filter((p) => p[0] === a && p[p.length - 1] === b && p.length - 1 === len);
    const total = geodesics.length;
    if (total === 0) continue;
    const through = new Array<number>(n).fill(0);
    for (const p of geodesics) for (let t = 1; t < p.length - 1; t++) through[p[t]]++;
    for (let v = 0; v < n; v++) score[v] += through[v] / total;
  }
  return score;
}

/* ===================================================================== */

describe('graph construction and validation', () => {
  it('refuses an empty node list', () => {
    expect(() => buildGraph({ nodes: [], edges: [] })).toThrow(EngineError);
    expect(() => buildGraph({ nodes: [], edges: [] })).toThrow(/at least one node/i);
  });

  it('refuses an edge naming a node that does not exist, and names the edge', () => {
    let message = '';
    try {
      buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'ghost' }] });
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/edge 1/);
    expect(message).toMatch(/b -> ghost/);
    expect(message).toMatch(/not in the node list/);
  });

  it('refuses a duplicate edge in either orientation when undirected', () => {
    expect(() =>
      buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }] }),
    ).toThrow(/duplicates an earlier edge/);
    // Directed: the two orientations are different edges and both are kept.
    const d = buildGraph({
      nodes: ['a', 'b'],
      edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
      directed: true,
    });
    expect(d.m).toBe(2);
  });

  it('refuses a self-loop unless allowed, and duplicate node ids', () => {
    expect(() => buildGraph({ nodes: ['a'], edges: [{ source: 'a', target: 'a' }] })).toThrow(/self-loop/);
    expect(buildGraph({ nodes: ['a'], edges: [{ source: 'a', target: 'a' }], allowSelfLoops: true }).selfLoops).toBe(1);
    expect(() => buildGraph({ nodes: ['a', 'a'], edges: [] })).toThrow(/appears more than once/);
  });

  it('refuses a non-positive or non-finite edge weight rather than coercing it', () => {
    expect(() => buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b', weight: 0 }] })).toThrow(/strictly positive/);
    expect(() => buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b', weight: -1 }] })).toThrow(/strictly positive/);
    expect(() => buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b', weight: NaN }] })).toThrow(/finite/);
  });
});

describe('hand-computable graphs', () => {
  it('path graph: degrees, diameter and betweenness match hand calculation', () => {
    // P5: 0-1-2-3-4. Degrees 1,2,2,2,1. Diameter 4 (0 to 4).
    const p = path(5);
    expect(degreeSummary(p).degree).toEqual([1, 2, 2, 2, 1]);
    expect(requireDiameter(p).value).toBe(4);
    // Raw betweenness of the interior node at position i (0-indexed) of P_n is
    // i*(n-1-i): the pairs it separates. For P5: 0, 3, 4, 3, 0.
    expect(betweennessCentrality(p, { normalised: false }).raw).toEqual([0, 3, 4, 3, 0]);
    // Mean path length of P_n is (n+1)/3 = 2 for n = 5.
    expect(pathLengths(p).meanPathLength.value).toBeCloseTo(2, 12);
  });

  it('star: the centre has betweenness exactly (n-1)(n-2)/2 and leaves exactly 0', () => {
    for (const n of [4, 5, 8, 12]) {
      const s = star(n);
      const b = betweennessCentrality(s, { normalised: false });
      // Every pair of distinct leaves has its unique shortest path through the
      // centre, and there are C(n-1, 2) = (n-1)(n-2)/2 such pairs.
      expect(b.raw[0]).toBe(((n - 1) * (n - 2)) / 2);
      for (let i = 1; i < n; i++) expect(b.raw[i]).toBe(0);
      // Normalised, the centre is exactly 1.
      expect(betweennessCentrality(s).score[0]).toBeCloseTo(1, 12);
      // Diameter of a star is exactly 2 for n >= 3.
      expect(requireDiameter(s).value).toBe(2);
      // Local clustering of the centre is 0 (no two leaves are joined); leaves
      // have degree 1, so their local clustering is undefined, not 0.
      const c = clustering(s);
      expect(c.local[0]).toBe(0);
      expect(c.local[1]).toBeNull();
    }
  });

  it('cycle: diameter is exactly floor(n/2) and clustering is exactly 0', () => {
    for (const n of [5, 6, 7, 8, 11]) {
      const c = cycle(n);
      expect(requireDiameter(c).value).toBe(Math.floor(n / 2));
      expect(degreeSummary(c).degree.every((k) => k === 2)).toBe(true);
      // A cycle of length >= 4 has no triangles.
      if (n >= 4) {
        expect(clustering(c).global.value).toBe(0);
        expect(clustering(c).averageLocal.value).toBe(0);
      }
    }
  });

  it('complete graph: clustering is exactly 1, diameter 1, betweenness 0', () => {
    for (const n of [4, 5, 7]) {
      const k = complete(n);
      // Every neighbourhood is itself complete, so every local coefficient is 1.
      expect(clustering(k).global.value).toBeCloseTo(1, 12);
      expect(clustering(k).averageLocal.value).toBeCloseTo(1, 12);
      expect(requireDiameter(k).value).toBe(1);
      // Every pair is adjacent, so no shortest path has an interior node.
      expect(betweennessCentrality(k, { normalised: false }).raw.every((x) => x === 0)).toBe(true);
      expect(degreeSummary(k).degree.every((d) => d === n - 1)).toBe(true);
    }
  });

  it('Petersen graph: 3-regular, diameter 2, no triangles, betweenness exactly 3 each', () => {
    const p = petersen();
    expect(p.n).toBe(10);
    expect(p.m).toBe(15);
    expect(degreeSummary(p).degree.every((k) => k === 3)).toBe(true);
    expect(requireDiameter(p).value).toBe(2);
    // Girth 5, so no triangles at all: clustering is exactly 0.
    expect(clustering(p).global.value).toBe(0);
    expect(clustering(p).triangles).toBe(0);
    // Hand calculation: 45 unordered pairs, 15 adjacent (contributing nothing)
    // and 30 at distance 2. Girth 5 means each distance-2 pair has exactly ONE
    // common neighbour, hence one geodesic with one interior node. Total
    // betweenness is therefore 30, and the graph is vertex-transitive, so each
    // of the 10 nodes gets exactly 3.
    const b = betweennessCentrality(p, { normalised: false });
    expect(b.raw).toEqual(new Array(10).fill(3));
    // Algebraic connectivity of the Petersen graph is exactly 2 (its Laplacian
    // eigenvalues are 0, 2 (x5) and 5 (x4)).
    expect(algebraicConnectivity(p).fiedlerValue.value).toBeCloseTo(2, 9);
  });

  it('betweenness matches brute-force enumeration of all shortest paths', () => {
    // A small graph with several ties, so the 1/sigma_st weighting is exercised:
    // a square with a pendant and a diagonal chord.
    const g = named(7, [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 4],
    ]);
    const brandes = betweennessCentrality(g, { normalised: false }).raw;
    const brute = bruteForceBetweenness(g);
    for (let i = 0; i < g.n; i++) expect(brandes[i]).toBeCloseTo(brute[i], 10);
    // And on the Petersen graph, where the answer is also known by hand.
    const petBrute = bruteForceBetweenness(petersen());
    const petBrandes = betweennessCentrality(petersen(), { normalised: false }).raw;
    for (let i = 0; i < 10; i++) expect(petBrandes[i]).toBeCloseTo(petBrute[i], 10);
    for (let i = 0; i < 10; i++) expect(petBrute[i]).toBeCloseTo(3, 10);
  });

  it('refuses a diameter on a disconnected graph and reports per-component diameters', () => {
    // Two disjoint paths: 0-1-2 and 3-4-5-6. Diameters 2 and 3.
    const g = named(7, [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
      [5, 6],
    ]);
    const res = pathLengths(g);
    expect(res.connected).toBe(false);
    expect(res.diameter).toBeNull();
    const diams = res.componentDiameters.map((c) => c.diameter).sort();
    expect(diams).toEqual([2, 3]);
    let message = '';
    try {
      requireDiameter(g);
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/disconnected/);
    expect(message).toMatch(/no finite diameter/);
    expect(message).toMatch(/3 nodes \/ diameter 2/);
    // It must not be Infinity-as-a-number, 0 or NaN anywhere.
    expect(Number.isFinite(res.meanPathLength.value)).toBe(true);
    expect(Number.isFinite(res.globalEfficiency.value)).toBe(true);
  });

  it('k-core, components and assortativity on hand-checkable graphs', () => {
    // A complete graph K5 is its own 4-core and nothing higher.
    expect(kCoreDecomposition(complete(5)).maxCore).toBe(4);
    // A path has max core 1; a cycle has max core 2.
    expect(kCoreDecomposition(path(6)).maxCore).toBe(1);
    expect(kCoreDecomposition(cycle(6)).maxCore).toBe(2);
    // Two triangles joined by a bridge: two components if the bridge is absent.
    const twoTriangles = named(6, [
      [0, 1],
      [1, 2],
      [2, 0],
      [3, 4],
      [4, 5],
      [5, 3],
    ]);
    const comps = connectedComponents(twoTriangles);
    expect(comps.count).toBe(2);
    expect(comps.largestSize).toBe(3);
    expect(comps.giantFraction.value).toBeCloseTo(0.5, 12);
    expect(comps.secondLargestSize).toBe(3);
    // Assortativity of a regular graph is undefined (zero denominator), and is
    // refused rather than reported as 0.
    expect(() => degreeAssortativity(cycle(8))).toThrow(/undefined/);
    // A star is maximally disassortative: r = -1 exactly.
    expect(degreeAssortativity(star(6)).coefficient.value).toBeCloseTo(-1, 12);
  });

  it('strongly connected components on a directed graph', () => {
    // 0->1->2->0 is one SCC; 3->4 are singletons; 2->3.
    const g = named(5, [
      [0, 1],
      [1, 2],
      [2, 0],
      [2, 3],
      [3, 4],
    ], true);
    const scc = stronglyConnectedComponents(g);
    expect(scc.count).toBe(3);
    expect(scc.largestSize).toBe(3);
    // Weak connectivity sees one component.
    expect(connectedComponents(g).count).toBe(1);
  });
});

describe('spectral quantities', () => {
  it('the Jacobi eigensolver reproduces a hand-diagonalisable matrix', () => {
    // [[2,1],[1,2]] has eigenvalues 1 and 3 exactly.
    const e = jacobiEigenSymmetric([
      [2, 1],
      [1, 2],
    ]);
    expect(e.eigenvalues[0]).toBeCloseTo(1, 12);
    expect(e.eigenvalues[1]).toBeCloseTo(3, 12);
    // A diagonal matrix is already diagonal: eigenvalues are its entries.
    const d = jacobiEigenSymmetric([
      [5, 0, 0],
      [0, -2, 0],
      [0, 0, 7],
    ]);
    expect(d.eigenvalues).toEqual([-2, 5, 7]);
    // Non-symmetric input is refused, naming the offending entry.
    expect(() =>
      jacobiEigenSymmetric([
        [0, 1],
        [2, 0],
      ]),
    ).toThrow(/symmetric/);
  });

  it('algebraic connectivity is exactly n for K_n and exactly 0 when disconnected', () => {
    // Known result: the Laplacian of K_n has eigenvalues 0 and n (multiplicity
    // n-1), so lambda_2 = n exactly.
    for (const n of [3, 4, 5, 8, 12]) {
      expect(algebraicConnectivity(complete(n)).fiedlerValue.value).toBeCloseTo(n, 8);
    }
    const disconnected = named(6, [
      [0, 1],
      [1, 2],
      [3, 4],
    ]);
    const ac = algebraicConnectivity(disconnected);
    expect(ac.fiedlerValue.value).toBe(0);
    expect(ac.connected).toBe(false);
    // Zero-eigenvalue multiplicity equals the component count (3: {0,1,2}, {3,4}, {5}).
    expect(ac.componentsFromTraversal).toBe(3);
    expect(ac.componentsFromSpectrum).toBe(3);
    // Positive and connected for a connected graph.
    expect(algebraicConnectivity(path(6)).fiedlerValue.value).toBeGreaterThan(0);
    // Spectral bisection on an already-disconnected graph is refused.
    expect(() => spectralPartition(disconnected)).toThrow(/already disconnected/);
    // And it finds the obvious cut on a dumbbell: two K4s joined by one edge.
    const dumbbell = buildGraph({
      nodes: Array.from({ length: 8 }, (_, i) => `v${i}`),
      edges: [
        ...[[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
        ...[[4, 5], [4, 6], [4, 7], [5, 6], [5, 7], [6, 7]],
        [3, 4],
      ].map(([a, b]) => ({ source: `v${a}`, target: `v${b}` })),
    });
    const part = spectralPartition(dumbbell);
    expect(part.cutEdges).toBe(1);
    expect(part.sizes).toEqual([4, 4]);
  });

  it('the Laplacian spectrum has one zero eigenvalue per component', () => {
    const g = named(7, [
      [0, 1],
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    const spec = laplacianSpectrum(g);
    const zeros = spec.eigenvalues.filter((x) => Math.abs(x) < 1e-9).length;
    expect(zeros).toBe(3);
    // Laplacian eigenvalues are non-negative (it is positive semi-definite).
    expect(spec.eigenvalues.every((x) => x > -1e-9)).toBe(true);
  });

  it('refuses the spectrum above the stated size limit, naming the cost', () => {
    const big = erdosRenyiGnp(NETWORK_LIMITS.spectralMaxNodes + 1, 0.01, 'spec-limit').graph;
    let message = '';
    try {
      laplacianSpectrum(big);
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(new RegExp(`${NETWORK_LIMITS.spectralMaxNodes} nodes`));
    expect(message).toMatch(/O\(n\^3\)/);
  });
});

describe('centrality cross-checks', () => {
  const g = barabasiAlbert(80, 2, 'cent-seed').graph;

  it('eigenvector centrality satisfies the eigen-equation to a tiny residual', () => {
    const ev = eigenvectorCentrality(g);
    // The residual is max|Ax - lambda x| for the unit-norm x actually returned.
    expect(ev.residual).toBeLessThan(1e-9);
    // Independent check: the dominant eigenpair from the Jacobi full spectrum.
    const bySpectrum = eigenvectorCentralityBySpectrum(g);
    expect(bySpectrum.eigenvalue).toBeCloseTo(ev.eigenvalue.value, 8);
    for (let i = 0; i < g.n; i++) expect(bySpectrum.score[i]).toBeCloseTo(ev.score[i], 7);
    // All entries non-negative (Perron–Frobenius, the graph being connected).
    expect(ev.score.every((x) => x >= -1e-12)).toBe(true);
  });

  it('PageRank sums to 1 and matches an independent power iteration', () => {
    const d = 0.85;
    const pr = pageRank(g, { damping: d });
    const total = pr.score.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 14);
    // Independent power iteration written here, from the adjacency lists only.
    const n = g.n;
    let x = new Array<number>(n).fill(1 / n);
    for (let iter = 0; iter < 5000; iter++) {
      const next = new Array<number>(n).fill((1 - d) / n);
      let dangling = 0;
      for (let i = 0; i < n; i++) if (g.out[i].length === 0) dangling += x[i];
      for (let i = 0; i < n; i++) next[i] += (d * dangling) / n;
      for (let i = 0; i < n; i++) {
        const deg = g.out[i].length;
        if (deg === 0) continue;
        for (const j of g.out[i]) next[j] += (d * x[i]) / deg;
      }
      let diff = 0;
      for (let i = 0; i < n; i++) diff += Math.abs(next[i] - x[i]);
      x = next;
      if (diff < 1e-15) break;
    }
    for (let i = 0; i < n; i++) expect(pr.score[i]).toBeCloseTo(x[i], 10);
    // A damping factor of exactly 1 is refused.
    expect(() => pageRank(g, { damping: 1 })).toThrow(/strictly below 1/);
    // A personalisation vector of the wrong length is refused.
    expect(() => pageRank(g, { personalisation: [1, 2] })).toThrow(/entries but the graph has/);
  });

  it('Katz centrality refuses an attenuation at or above 1/lambda_max', () => {
    const lambda = eigenvectorCentrality(g).eigenvalue.value;
    const ok = katzCentrality(g, 0.5 / lambda);
    expect(ok.score.every((x) => x > 0)).toBe(true);
    expect(ok.admissibleAlphaBound).toBeCloseTo(1 / lambda, 10);
    let message = '';
    try {
      katzCentrality(g, 1.01 / lambda);
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/diverges/);
    expect(message).toMatch(/alpha < 1\/lambda_max/);
  });

  it('closeness is defined on a disconnected graph and says which formula it used', () => {
    const disconnected = named(5, [
      [0, 1],
      [1, 2],
      [3, 4],
    ]);
    const c = closenessCentrality(disconnected);
    expect(c.score.every((x) => Number.isFinite(x))).toBe(true);
    expect(c.harmonic.every((x) => Number.isFinite(x))).toBe(true);
    expect(c.notes.join(' ')).toMatch(/Wasserman/);
    // On a star the centre has the highest closeness and the highest degree.
    const s = star(7);
    expect(closenessCentrality(s).ranking[0].index).toBe(0);
    expect(degreeCentrality(s).ranking[0].index).toBe(0);
  });

  it('refuses betweenness above the stated size limit, naming the cost', () => {
    const big = erdosRenyiGnp(NETWORK_LIMITS.betweennessMaxNodes + 1, 0.001, 'bc-limit').graph;
    let message = '';
    try {
      betweennessCentrality(big);
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/O\(n\*m\)/);
    expect(message).toMatch(new RegExp(`${NETWORK_LIMITS.betweennessMaxNodes} nodes`));
  });
});

describe('Erdos-Renyi giant component against theory', () => {
  /**
   * THE CENTRAL TEST. The analytic prediction is solved in this file by
   * fixed-point iteration on S = 1 - exp(-cS); the module's Brent-based solver
   * is checked against that iteration, and the measured giant-component
   * fraction of a generated G(n,p) is checked against both.
   *
   * Tolerances: at n = 20000 the giant fraction of one realisation has a
   * standard deviation of roughly sqrt(S(1-S)/n) ~ 0.0035, and there is also an
   * O(1/n) finite-size correction to the limit law. A tolerance of 0.02
   * absolute is therefore about 5 standard deviations and leaves room for the
   * finite-size bias, while being far too tight to pass by accident — the
   * difference between the c = 1.5 and c = 3 predictions is 0.36.
   */
  const n = 20_000;

  it('the module solver agrees with an independent fixed-point iteration', () => {
    for (const c of [1.01, 1.2, 1.5, 2, 3, 5, 10]) {
      expect(erdosRenyiGiantFraction(c).value).toBeCloseTo(giantFractionByIteration(c), 8);
    }
    // At or below mean degree 1 the only root is 0, exactly.
    expect(erdosRenyiGiantFraction(1).value).toBe(0);
    expect(erdosRenyiGiantFraction(0.5).value).toBe(0);
  });

  it('measures S within Monte Carlo error of the analytic solution above the threshold', () => {
    for (const c of [1.5, 3]) {
      const g = erdosRenyiGnp(n, c / (n - 1), `er-giant-${c}`);
      const measured = connectedComponents(g.graph).giantFraction.value;
      const theory = giantFractionByIteration(c);
      expect(theory).toBeGreaterThan(0.1);
      expect(measured).toBeCloseTo(theory, 1); // |diff| < 0.05
      expect(Math.abs(measured - theory)).toBeLessThan(0.02);
    }
  });

  it('shows the phase transition itself: O(log n) below c = 1, a constant fraction above', () => {
    const sub = erdosRenyiGnp(n, 0.5 / (n - 1), 'er-sub');
    const subLargest = connectedComponents(sub.graph).largestSize;
    // Below the threshold the largest component is O(log n). ln(20000) ~ 9.9;
    // the constant is 1/(c - 1 - ln c) ~ 4.5 at c = 0.5, so ~45 nodes is the
    // scale. A bound of 20 ln n = 198 is generous and still 1/100 of n.
    expect(subLargest).toBeLessThan(20 * Math.log(n));
    expect(subLargest / n).toBeLessThan(0.01);
    expect(erdosRenyiGiantFraction(0.5).value).toBe(0);

    const sup = erdosRenyiGnp(n, 3 / (n - 1), 'er-sup');
    const supFraction = connectedComponents(sup.graph).giantFraction.value;
    // Above the threshold a constant fraction, here ~0.94.
    expect(supFraction).toBeGreaterThan(0.9);
    // The transition is sharp: 0.5 and 3 differ by a factor of 6 in mean degree
    // and by nearly three orders of magnitude in the giant fraction.
    expect(supFraction / (subLargest / n)).toBeGreaterThan(100);
  });

  it('G(n,m) fixes the edge count exactly and agrees with G(n,p)', () => {
    const m = 30_000;
    const g = erdosRenyiGnm(5000, m, 'gnm');
    expect(g.graph.m).toBe(m);
    // Mean degree 2m/n = 12, so S should be close to the theory at c = 12.
    const measured = connectedComponents(g.graph).giantFraction.value;
    expect(measured).toBeCloseTo(giantFractionByIteration(12), 2);
    expect(() => erdosRenyiGnm(5, 100, 'too-dense')).toThrow(/between 0 and 10/);
  });
});

describe('degree distributions', () => {
  it('G(n,p) degrees match Binomial(n-1,p) in mean and variance, and approach Poisson', () => {
    const n = 20_000;
    const c = 4;
    const p = c / (n - 1);
    const deg = degreeSummary(erdosRenyiGnp(n, p, 'degdist').graph).degree;
    const sampleMean = deg.reduce((a, b) => a + b, 0) / n;
    let v = 0;
    for (const k of deg) v += (k - sampleMean) ** 2;
    const sampleVar = v / (n - 1);
    // Binomial(n-1, p) has mean (n-1)p = 4 and variance (n-1)p(1-p) ~ 3.9992.
    // The standard error of the sample mean is sqrt(4/20000) ~ 0.014, so 0.06
    // is about four standard errors.
    expect(sampleMean).toBeCloseTo(c, 1);
    expect(Math.abs(sampleMean - c)).toBeLessThan(0.06);
    // Var of the sample variance ~ 2 sigma^4 / n, giving SE ~ 0.04; 0.2 is 5 SE.
    expect(Math.abs(sampleVar - (n - 1) * p * (1 - p))).toBeLessThan(0.2);

    // Chi-square against Poisson(4), pooling the tail so each cell has >= 5
    // expected. Poisson pmf computed here, independently of the module.
    const counts = new Array<number>(11).fill(0);
    for (const k of deg) counts[Math.min(10, k)]++;
    let chi2 = 0;
    let logFact = 0;
    let tailExpected = n;
    for (let k = 0; k < 10; k++) {
      if (k > 0) logFact += Math.log(k);
      const pk = Math.exp(-c + k * Math.log(c) - logFact);
      const expected = n * pk;
      tailExpected -= expected;
      chi2 += (counts[k] - expected) ** 2 / expected;
    }
    chi2 += (counts[10] - tailExpected) ** 2 / tailExpected;
    // 10 degrees of freedom (11 cells, no fitted parameter since c is known).
    // The 99.9th percentile of chi-square(10) is 29.6. A Poisson *limit* on a
    // finite binomial also contributes a small systematic term, so 40 is used:
    // generous, and still far below what a genuinely wrong degree distribution
    // would produce (a Binomial(n-1, p) with the wrong p fails by hundreds).
    expect(chi2).toBeLessThan(40);
  });

  it('Barabasi-Albert: the Clauset MLE covers the analytic exponent 3, the log-log slope does not', () => {
    const ba = barabasiAlbert(20_000, 2, 'ba-exponent');
    const deg = degreeSummary(ba.graph).degree;
    // Analytic exponent of preferential attachment is exactly 3, independent of m.
    expect(ba.analytic.find((q) => q.label.includes('exponent'))?.value).toBe(3);

    const mle = selectPowerLawCutoff(deg, { discrete: true, minTail: 50 });
    // The MLE's asymptotic standard error interval must cover 3. At n = 20000
    // the tail holds a few hundred nodes, so the SE is around 0.1.
    expect(mle.interval.lower).toBeLessThan(3);
    expect(mle.interval.upper).toBeGreaterThan(3);
    expect(mle.exponent.value).toBeGreaterThan(2.5);
    expect(mle.exponent.value).toBeLessThan(3.5);

    // The log-log regression slope is BIASED: it is far from 3 and far from the
    // MLE, which is why the MLE is what the module recommends. Measured around
    // 1.7 at this size — a bias of more than an entire exponent unit, enough to
    // flip the qualitative conclusion about whether <k^2> diverges.
    const loglog = fitPowerLawLogLog(deg, { kMin: 6 });
    expect(Math.abs(loglog.impliedExponent.value - 3)).toBeGreaterThan(0.5);
    expect(Math.abs(loglog.impliedExponent.value - mle.exponent.value)).toBeGreaterThan(0.5);
    // ...and yet its R^2 is high, which is exactly the trap.
    expect(loglog.rSquared).toBeGreaterThan(0.5);
    expect(loglog.impliedExponent.note).toMatch(/BIASED/);
  });

  it('the MLE recovers a known exponent from a synthetic power-law sample', () => {
    // Reference is the sampling distribution, not the module: draw from a
    // discrete power law with alpha = 2.5 and check the estimator returns it.
    const rng = new Random('pl-check');
    const sample: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      // Inverse transform written here: x = kMin (1-u)^(-1/(alpha-1)).
      sample.push(Math.round(5 * (1 - rng.uniform()) ** (-1 / 1.5)));
    }
    const fit = fitPowerLawMLE(sample, { kMin: 6, discrete: true });
    // SE is (alpha-1)/sqrt(n) ~ 0.011 here, so 0.1 is ~9 SE and allows for the
    // rounding/discretisation bias of the sampler at a small kMin.
    expect(Math.abs(fit.exponent.value - 2.5)).toBeLessThan(0.1);
    expect(fit.limitations.join(' ')).toMatch(/log-normal/);
    // A sample with too few tail observations is refused.
    expect(() => fitPowerLawMLE([7], { kMin: 6 })).toThrow(/fewer than two tail observations/);
    expect(() => fitPowerLawMLE([1, 2, NaN])).toThrow(/not finite/);
  });
});

describe('Watts-Strogatz small world', () => {
  /**
   * The point of the model is the region in between, so all three regimes are
   * asserted. Deterministic quantities on a 500-node graph: the only
   * stochasticity is which edges get rewired, and at these p values the
   * clustering and path length vary by well under the gaps asserted.
   */
  it('has high clustering and long paths at p = 0, ER-like behaviour at p = 1, and both at once in between', () => {
    const n = 500;
    const k = 10;
    const measure = (p: number) => {
      const ws = wattsStrogatz(n, k, p, `ws-${p}`);
      return {
        c: clustering(ws.graph).averageLocal.value,
        l: pathLengths(ws.graph).meanPathLength.value,
      };
    };
    // p = 0: the ring lattice. Clustering 3(k-2)/(4(k-1)) = 24/36 = 0.6667
    // exactly, and mean path length of order n/(2k) = 25.
    const lattice = measure(0);
    expect(lattice.c).toBeCloseTo((3 * (k - 2)) / (4 * (k - 1)), 10);
    expect(lattice.l).toBeGreaterThan(20);

    // p = 1: fully rewired. Clustering ~ k/n = 0.02, path length ~ log n / log k
    // which is about 2.7.
    const random = measure(1);
    expect(random.c).toBeLessThan(0.05);
    expect(random.l).toBeLessThan(4);

    // The intermediate region: clustering still near the lattice value while
    // path length has already collapsed to the random-graph scale. This is the
    // whole content of the model and must hold.
    const middle = measure(0.05);
    expect(middle.c).toBeGreaterThan(0.5 * lattice.c);
    expect(middle.l).toBeLessThan(2 * random.l);
    // Explicitly: HIGH clustering AND SHORT paths simultaneously.
    expect(middle.c).toBeGreaterThan(10 * random.c);
    expect(middle.l).toBeLessThan(0.3 * lattice.l);
  });
});

describe('percolation thresholds', () => {
  /**
   * Bond percolation on the 2-D square lattice has threshold exactly 1/2
   * (Kesten 1980) — one of the few exactly known values, and therefore the only
   * honest validation of a numerical threshold locator.
   *
   * Tolerance: the susceptibility-peak estimator on a finite L x L torus is
   * biased towards small p by O(L^-1/nu). Measured here: 0.470 at L = 64,
   * 0.490 at L = 128, 0.509 at L = 200 — converging on 0.5. At L = 200 with a
   * 0.01 grid and 6 replicates the deviation is about 0.01, so 0.03 is used:
   * tight enough that an estimator off by the site threshold (0.593) or by the
   * ER value would fail by a wide margin.
   */
  it('locates the exact bond-percolation threshold of the square lattice (p_c = 1/2)', () => {
    const lattice = squareLattice(200, 200, { periodic: true });
    expect(lattice.analytic[0].value).toBe(0.5);
    const probabilities: number[] = [];
    for (let p = 0.38; p <= 0.62001; p += 0.01) probabilities.push(Number(p.toFixed(3)));
    const curve = runPercolationCurve(lattice.graph, 'lattice-bond', {
      kind: 'bond',
      probabilities,
      replicates: 6,
    });
    expect(Math.abs(curve.threshold.value - 0.5)).toBeLessThan(0.03);
    // The headline output: the transition is sharp. dS/dp at the threshold is
    // large and grows with L; at L = 200 it is well above 5 per unit p.
    expect(curve.maxSlope.value).toBeGreaterThan(5);
    // Below threshold essentially nothing; above threshold a large fraction.
    const low = curve.points.find((pt) => pt.p === 0.4);
    const high = curve.points.find((pt) => pt.p === 0.62);
    expect(low && low.giantFraction).toBeLessThan(0.05);
    expect(high && high.giantFraction).toBeGreaterThan(0.5);
    // Critical exponents are reported with their honest caveat.
    expect(curve.betaExponent?.note).toMatch(/order of magnitude/);
  }, 60_000);

  it('locates the ER site-percolation threshold at 1/c', () => {
    // For a Poisson degree distribution the site threshold is <k>/(<k^2>-<k>) = 1/c.
    const c = 4;
    const n = 60_000;
    const g = erdosRenyiGnp(n, c / (n - 1), 'er-site');
    const probabilities: number[] = [];
    for (let p = 0.15; p <= 0.4001; p += 0.01) probabilities.push(Number(p.toFixed(4)));
    const curve = runPercolationCurve(g.graph, 'er-site-curve', { kind: 'site', probabilities, replicates: 6 });
    // Same finite-size bias as the lattice; measured ~0.259 against 0.25.
    expect(Math.abs(curve.threshold.value - 1 / c)).toBeLessThan(0.03);
    expect(curve.notes.join(' ')).toMatch(/1\/<k>/);
  }, 60_000);

  it('refuses percolation on an edgeless graph instead of returning a flat curve', () => {
    const g = buildGraph({ nodes: ['a', 'b', 'c'], edges: [] });
    expect(() => runPercolationCurve(g, 'empty')).toThrow(/no edges/);
  });

  it('bootstrap percolation is monotone and cannot activate a node of degree below k', () => {
    // On K6 with 2 seeds and k = 2, every remaining node has 2 active
    // neighbours immediately, so all 6 activate. Hand-checkable.
    const k6 = complete(6);
    expect(bootstrapPercolation(k6, [0, 1], 2).activeCount).toBe(6);
    // With k = 3 and two seeds, no node has 3 active neighbours, so nothing spreads.
    expect(bootstrapPercolation(k6, [0, 1], 3).activeCount).toBe(2);
    // A star's leaves have degree 1, so with k = 2 they can never activate.
    const s = star(8);
    const res = bootstrapPercolation(s, [0], 2);
    expect(res.activeCount).toBe(1);
    expect(res.notes.join(' ')).toMatch(/can never activate unless seeded/);
    // Monotonicity: adding a seed never shrinks the active set.
    const a = bootstrapPercolation(k6, [0], 2).activeCount;
    const b = bootstrapPercolation(k6, [0, 1, 2], 2).activeCount;
    expect(b).toBeGreaterThanOrEqual(a);
    expect(() => bootstrapPercolation(k6, [99], 2)).toThrow(/outside 0\.\.5/);
  });

  it('cascading failure propagates further on a hub-seeded scale-free network', () => {
    const ba = barabasiAlbert(400, 2, 'cascade-ba').graph;
    const hub = degreeCentrality(ba).ranking[0].index;
    const leaf = degreeCentrality(ba).ranking[ba.n - 1].index;
    // At a 40% capacity margin the hub seed takes the whole network down while
    // the lowest-degree seed takes nothing with it: its single neighbour has
    // enough headroom to absorb a degree-1 node's load.
    const fromHub = cascadingFailure(ba, [hub], { tolerance: 0.4 });
    const fromLeaf = cascadingFailure(ba, [leaf], { tolerance: 0.4 });
    expect(fromHub.failedCount).toBeGreaterThan(fromLeaf.failedCount);
    expect(fromLeaf.failedCount).toBe(1);
    expect(fromHub.failedCount).toBeGreaterThan(0.5 * ba.n);
    // Failures are monotone in the capacity margin: more headroom never makes
    // the cascade larger.
    let previous = ba.n + 1;
    for (const tol of [0.1, 0.4, 0.5, 1, 100]) {
      const count = cascadingFailure(ba, [hub], { tolerance: tol }).failedCount;
      expect(count).toBeLessThanOrEqual(previous);
      previous = count;
    }
    // A generous tolerance stops the cascade entirely.
    const safe = cascadingFailure(ba, [hub], { tolerance: 100 });
    expect(safe.failedCount).toBe(1);
    expect(safe.rounds).toEqual([1]);
    expect(fromHub.limitations.join(' ')).toMatch(/upper bound/);
    expect(() => cascadingFailure(ba, [], {})).toThrow(/at least one initially failed node/);
  });

  it('explosive percolation jumps harder under the product rule than under random addition', () => {
    const res = explosivePercolation(3000, 'explosive');
    expect(res.maxJumpProductRule.value).toBeGreaterThan(res.maxJumpRandomRule.value);
    // And it is honest that the apparent discontinuity is a finite-size effect.
    expect(res.limitations.join(' ')).toMatch(/continuous in the infinite-size limit/);
  });
});

describe('robustness asymmetry: random versus targeted removal', () => {
  /**
   * THE HEADLINE CLAIM. A scale-free network is robust to random failure and
   * fragile to hub-targeted attack; a homogeneous network is about equally
   * (un)robust to both. Both halves are asserted.
   *
   * These are structural facts about one generated graph, averaged over 8
   * random-removal replicates (targeted removal is deterministic). The gaps
   * asserted are an order of magnitude larger than the replicate scatter.
   */
  const n = 5000;
  const ba = barabasiAlbert(n, 2, 'robust-ba');
  const er = erdosRenyiGnm(n, ba.graph.m, 'robust-er');
  const fractions = [0, 0.05, 0.1, 0.15, 0.2, 0.3];

  it('on a scale-free network, random removal leaves a far larger giant component than targeted removal', () => {
    const cmp = runRobustness(ba.graph, 'robust-ba-run', { strategies: ['random', 'degree'], fractions, replicates: 8 });
    const at15 = cmp.asymmetry.find((a) => a.removedFraction === 0.15);
    expect(at15).toBeDefined();
    // Measured: random ~0.84, targeted ~0.05.
    expect(at15 && at15.random).toBeGreaterThan(0.6);
    expect(at15 && at15.targeted).toBeLessThan(0.25);
    expect(at15 && at15.random / Math.max(1e-9, at15.targeted)).toBeGreaterThan(3);
    expect(cmp.maxGap.value).toBeGreaterThan(0.5);
    // Random removal of 30% still leaves most of the network connected.
    const rnd30 = cmp.curves.find((c) => c.strategy === 'random')?.points.find((p) => p.removedFraction === 0.3);
    expect(rnd30 && rnd30.giantFraction).toBeGreaterThan(0.4);
  }, 60_000);

  it('on an Erdos-Renyi network of the same size and density, the two are much closer', () => {
    const cmp = runRobustness(er.graph, 'robust-er-run', { strategies: ['random', 'degree'], fractions, replicates: 8 });
    const at15 = cmp.asymmetry.find((a) => a.removedFraction === 0.15);
    // Measured: random ~0.82, targeted ~0.78 — a gap of ~0.04 against ~0.79 on BA.
    expect(at15 && Math.abs(at15.gap)).toBeLessThan(0.2);
    expect(cmp.maxGap.value).toBeLessThan(0.4);
  }, 60_000);

  it('quantifies the asymmetry gap as much larger on the scale-free network', () => {
    const baCmp = runRobustness(ba.graph, 'asym-ba', { strategies: ['random', 'degree'], fractions: [0.15], replicates: 6 });
    const erCmp = runRobustness(er.graph, 'asym-er', { strategies: ['random', 'degree'], fractions: [0.15], replicates: 6 });
    expect(baCmp.maxGap.value).toBeGreaterThan(3 * erCmp.maxGap.value);
  }, 60_000);

  it('refuses a betweenness-targeted attack above the betweenness size limit', () => {
    expect(() =>
      runRobustness(ba.graph, 'bw-attack', { strategies: ['betweenness'], fractions: [0.1], replicates: 1 }),
    ).toThrow(/betweenness costs O\(n\*m\)/);
  });
});

describe('configuration model and degree-sequence realisability', () => {
  it('realises the requested degree sequence exactly, node by node', () => {
    const degrees = [4, 4, 3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2];
    const cm = configurationModel(degrees, 'cm-exact');
    expect(cm.exactDegrees).toBe(true);
    expect(degreeSummary(cm.graph).degree).toEqual(degrees);
    // No self-loops and no duplicate edges: it is a simple graph.
    expect(cm.graph.selfLoops).toBe(0);
    let sum = 0;
    for (const d of degrees) sum += d;
    expect(cm.graph.m).toBe(sum / 2);
  });

  it('refuses an unrealisable degree sequence and says why, via Erdos-Gallai', () => {
    // Odd degree sum: impossible by the handshake lemma.
    expect(erdosGallaiCheck([1, 1, 1]).realisable).toBe(false);
    expect(erdosGallaiCheck([1, 1, 1]).reason).toMatch(/handshake lemma/);
    // Degree above n-1: impossible for a simple graph.
    expect(erdosGallaiCheck([3, 1, 1, 1]).realisable).toBe(true); // a star on 4
    expect(erdosGallaiCheck([4, 1, 1, 1]).realisable).toBe(false);
    expect(erdosGallaiCheck([4, 1, 1, 1]).reason).toMatch(/maximum degree 3/);
    // Erdős–Gallai failure proper: [3,3,1,1] has an even sum and no degree
    // above n-1 = 3, but the two degree-3 nodes need 6 endpoints and only 4 are
    // available (2 between themselves, 2 from the degree-1 nodes).
    const eg = erdosGallaiCheck([3, 3, 1, 1]);
    expect(eg.realisable).toBe(false);
    expect(eg.failedAt).toBe(2);
    expect(eg.reason).toMatch(/Erdős–Gallai inequality fails at k = 2/);
    let message = '';
    try {
      configurationModel([3, 3, 1, 1], 'bad');
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/cannot be realised by any simple graph/);
    expect(message).toMatch(/Erdős–Gallai/);
    // A realisable sequence is accepted.
    expect(erdosGallaiCheck([2, 2, 2]).realisable).toBe(true);
  });

  it('the Molloy-Reed criterion predicts the giant component on a configuration graph', () => {
    // A 3-regular graph has <k^2>/<k> = 3 > 2, so a giant component is expected
    // and (being connected or nearly so) observed.
    const regular = molloyReed(new Array(1000).fill(3));
    expect(regular.criterion.value).toBeCloseTo(3, 12);
    expect(regular.giantComponentExpected).toBe(true);
    const cm = configurationModel(new Array(1000).fill(3), 'mr-3reg');
    expect(connectedComponents(cm.graph).giantFraction.value).toBeGreaterThan(0.9);
    // A 1-regular graph is a perfect matching: <k^2>/<k> = 1 < 2, no giant component.
    const matching = molloyReed(new Array(1000).fill(1));
    expect(matching.criterion.value).toBeCloseTo(1, 12);
    expect(matching.giantComponentExpected).toBe(false);
    const cmMatch = configurationModel(new Array(1000).fill(1), 'mr-match');
    expect(connectedComponents(cmMatch.graph).largestSize).toBe(2);
    expect(() => molloyReed([])).toThrow(/empty/);
    expect(() => molloyReed([0, 0, 0])).toThrow(/undefined/);
  });

  it('stub matching reports honestly that it did NOT realise the degrees exactly', () => {
    const degrees = powerLawDegreeSequence(600, 2.3, 3, 'pl-stub').degrees;
    const stub = configurationModel(degrees, 'stub', { method: 'stub-matching' });
    // Either it happened to be exact, or it says plainly that it was not.
    if (!stub.exactDegrees) {
      expect(stub.notes.join(' ')).toMatch(/NOT realised exactly/);
      expect(stub.discardedStubs).toBeGreaterThan(0);
    }
  });

  it('power-law degree sequences report truncation, which changes the second moment', () => {
    const seq = powerLawDegreeSequence(500, 2.1, 2, 'pl-trunc');
    let sum = 0;
    for (const d of seq.degrees) sum += d;
    expect(sum % 2).toBe(0);
    expect(seq.degrees.every((d) => d <= 499)).toBe(true);
    if (seq.truncated > 0) expect(seq.notes.join(' ')).toMatch(/HIGHER epidemic threshold/);
  });
});

describe('other generative models', () => {
  it('stochastic block model and planted-partition community recovery', () => {
    const pp = plantedPartition(2, 200, 0.1, 0.008, 'pp-seed');
    expect(pp.aboveDetectability).toBe(true);
    const rec = recoverTwoBlocks(pp.graph, pp.block);
    // Well above the detectability threshold, spectral bisection recovers
    // essentially everything; chance is 0.5.
    expect(rec.accuracy.value).toBeGreaterThan(0.9);
    // A near-uniform block matrix is undetectable, and the module says so.
    const flat = plantedPartition(2, 200, 0.05, 0.05, 'pp-flat');
    expect(flat.aboveDetectability).toBe(false);
    expect(flat.detectabilityThreshold.note).toMatch(/undetectable/);
    // Asymmetric probability matrices are refused.
    expect(() => stochasticBlockModel([2, 2], [[0.5, 0.1], [0.2, 0.5]], 's')).toThrow(/symmetric/);
    expect(() => stochasticBlockModel([2, 2], [[0.5, 0.1]], 's')).toThrow(/rows but there are 2 blocks/);
    expect(() => recoverTwoBlocks(pp.graph, [0, 1, 2])).toThrow(/entries but the graph has/);
  });

  it('geometric graphs are strongly clustered, unlike Erdos-Renyi', () => {
    const geo = randomGeometricGraph(1200, 0.06, 'geo', { torus: true });
    const cGeo = clustering(geo.graph).global.value;
    // Theory: clustering of a 2-D geometric graph tends to 1 - 3sqrt(3)/(4 pi)
    // ~ 0.5865, independent of the radius. A tolerance of 0.08 covers the
    // finite-mean-degree correction at <k> ~ 13.
    expect(Math.abs(cGeo - (1 - (3 * Math.sqrt(3)) / (4 * Math.PI)))).toBeLessThan(0.08);
    // The same mean degree in G(n,p) gives clustering ~ p ~ 0.011.
    const c = degreeSummary(geo.graph).meanDegree.value;
    const er = erdosRenyiGnp(1200, c / 1199, 'geo-vs-er');
    expect(clustering(er.graph).global.value).toBeLessThan(0.05);
    expect(cGeo).toBeGreaterThan(10 * clustering(er.graph).global.value);
    expect(() => randomGeometricGraph(10, 2, 'r')).toThrow(/exceeds the diameter of the unit square/);
  });

  it('Chung-Lu reproduces the requested expected degrees and reports capping', () => {
    const weights = new Array(2000).fill(6);
    const cl = chungLu(weights, 'cl');
    // Independent edges with p = w^2/sum(w) = 36/12000 = 0.003 over 1999
    // partners gives mean degree ~5.997. SE of the mean degree is
    // sqrt(6/2000) ~ 0.055, so 0.3 is about 5 SE.
    expect(Math.abs(degreeSummary(cl.graph).meanDegree.value - 6)).toBeLessThan(0.3);
    // A weight so large that w_i w_j > sum(w) must be reported, not silently capped.
    const skewed = chungLu([50, 50, 1, 1, 1, 1], 'cl-cap');
    expect(skewed.notes.join(' ')).toMatch(/capped at probability 1/);
    expect(() => chungLu([0, 0, 0], 'cl-zero')).toThrow(/empty graph/);
  });

  it('the square lattice carries its exactly known threshold and its boundary caveat', () => {
    const open = squareLattice(10, 10, { periodic: false });
    expect(open.notes.join(' ')).toMatch(/biases a finite-size threshold estimate/);
    const torus = squareLattice(10, 10, { periodic: true });
    expect(degreeSummary(torus.graph).degree.every((k) => k === 4)).toBe(true);
    expect(clustering(torus.graph).global.value).toBe(0);
    expect(() => squareLattice(1, 5)).toThrow();
  });
});

describe('reproduction numbers and the epidemic threshold', () => {
  it('the network R0 exceeds the mean-degree value on a heavy-tailed network', () => {
    const seq = powerLawDegreeSequence(4000, 2.3, 2, 'r0-pl');
    const heavy = configurationModel(seq.degrees, 'r0-cm').graph;
    const rep = reproductionNumbers(heavy, { beta: 0.2, gamma: 1 });
    // Measured: mass action ~1.8, network ~62 — the second moment dominates.
    expect(rep.network.value).toBeGreaterThan(rep.massAction.value);
    expect(rep.network.value).toBeGreaterThan(5 * rep.massAction.value);
    // And the threshold is reported as effectively zero, not as a finite number
    // to be used as a safe operating point.
    expect(rep.thresholdEffectivelyZero).toBe(true);
    expect(rep.limitations.join(' ')).toMatch(/threshold goes to ZERO/);
    expect(rep.sisThresholdBeta.note).toMatch(/NOT a usable threshold/);

    // On a homogeneous network the two are close and the threshold is finite.
    const n = 4000;
    const regular = configurationModel(new Array(n).fill(6), 'r0-reg').graph;
    const repReg = reproductionNumbers(regular, { beta: 0.2, gamma: 1 });
    expect(repReg.thresholdEffectivelyZero).toBe(false);
    expect(repReg.network.value).toBeLessThan(2 * repReg.massAction.value);
    expect(() => reproductionNumbers(buildGraph({ nodes: ['a'], edges: [] }), { beta: 1, gamma: 1 })).toThrow(/mean degree is 0/);
  }, 60_000);

  it('below R0 = 1 outbreaks die out; above it a constant fraction is infected', () => {
    const n = 4000;
    const g = erdosRenyiGnp(n, 10 / (n - 1), 'threshold-er').graph;
    // Subcritical: network R0 ~ 0.48.
    const sub = reproductionNumbers(g, { beta: 0.05, gamma: 1 });
    expect(sub.network.value).toBeLessThan(1);
    const subEns = runSpreadEnsemble(g, { model: 'SIR', beta: 0.05, gamma: 1, horizon: 300 }, 'sub', {
      runs: 60,
      extinctionCutoff: 20,
    });
    // Essentially nothing takes off: at most a couple of runs creep past the
    // (arbitrary) cutoff of 20, and even those stay O(1) rather than reaching a
    // constant fraction of the 4000 nodes.
    expect(subEns.takeoffRuns).toBeLessThanOrEqual(2);
    const allSizes = [...subEns.distribution.extinctionSizes, ...subEns.distribution.takeoffSizes];
    const largest = Math.max(...allSizes);
    expect(largest).toBeLessThan(0.01 * n);

    // Supercritical: network R0 ~ 2.9.
    const sup = reproductionNumbers(g, { beta: 0.4, gamma: 1 });
    expect(sup.network.value).toBeGreaterThan(1);
    const supEns = runSpreadEnsemble(g, { model: 'SIR', beta: 0.4, gamma: 1, horizon: 300 }, 'sup', {
      runs: 60,
      extinctionCutoff: 20,
    });
    expect(supEns.takeoffRuns).toBeGreaterThan(30);
    // A constant fraction infected, not an O(1) number. Measured ~0.93.
    expect(supEns.meanTakeoffSize!.value / n).toBeGreaterThan(0.5);
  }, 60_000);

  it('the branching-process outbreak probability is a probability and responds to beta', () => {
    const g = barabasiAlbert(2000, 2, 'ob').graph;
    const low = outbreakProbability(g, { beta: 0.05, gamma: 1 });
    const high = outbreakProbability(g, { beta: 1.5, gamma: 1 });
    expect(low.probability.value).toBeGreaterThanOrEqual(0);
    expect(low.probability.value).toBeLessThanOrEqual(1);
    expect(high.probability.value).toBeGreaterThan(low.probability.value);
    expect(low.extinctionProbability.value).toBeCloseTo(1 - low.probability.value, 12);
    expect(low.limitations.join(' ')).toMatch(/START of an outbreak/);
  });
});

describe('SIR against the mass-action ODE', () => {
  /**
   * Both halves are required: agreement where mean field is a good
   * approximation (a dense, unclustered graph) and a SMALLER network outbreak
   * where it is not (a clustered lattice).
   */
  it('agrees with the analytic final-size relation on a dense Erdos-Renyi graph', () => {
    // Mean degree 150 with a small per-edge transmissibility T = 0.0157, so the
    // graph is effectively homogeneously mixing and the finite-transmissibility
    // correction to mass action is small.
    const n = 2500;
    const c = 150;
    const params = { model: 'SIR' as const, beta: 0.016, gamma: 1, horizon: 300 };
    const g = erdosRenyiGnp(n, c / (n - 1), 'dense-er').graph;
    const ens = runSpreadEnsemble(g, params, 'dense-sir', { runs: 50 });
    const mf = massActionODE({ ...params, meanDegree: degreeSummary(g).meanDegree.value });
    // Reference: the analytic relation R = 1 - exp(-R0 R), solved by brentRoot
    // in the module; cross-checked here by independent fixed-point iteration,
    // since the relation is identical in form to S = 1 - exp(-cS).
    const independent = giantFractionByIteration(mf.r0.value);
    expect(mf.analyticFinalSize!.value).toBeCloseTo(independent, 8);
    const simulated = ens.meanTakeoffSize!.value / n;
    // Measured 0.872 against 0.879. The standard error of the mean takeoff size
    // over ~25 takeoff runs is about 0.002 in fraction terms; the remaining
    // gap is the O(T) = 1.6% finite-transmissibility correction to mass action.
    expect(Math.abs(simulated - mf.analyticFinalSize!.value)).toBeLessThan(0.04);
    expect(ens.takeoffRuns).toBeGreaterThan(10);
    // The integration agrees with the analytic value, confirming the RK4 step.
    expect(mf.integratedFinalSize.value).toBeCloseTo(mf.analyticFinalSize!.value, 3);
  }, 60_000);

  it('gives a SMALLER outbreak than mean field on a clustered lattice network', () => {
    const lattice = squareLattice(60, 60, { periodic: true });
    const n = lattice.graph.n;
    const params = { model: 'SIR' as const, beta: 1, gamma: 1, horizon: 600 };
    const ens = runSpreadEnsemble(lattice.graph, params, 'lattice-sir', { runs: 40 });
    const mf = massActionODE({ ...params, meanDegree: 4 });
    const simulated = ens.takeoffRuns > 0 ? ens.meanTakeoffSize!.value / n : 0;
    // Measured: 0.16 on the lattice against 0.98 from mean field. The network
    // answer is smaller by a factor of six — far beyond any Monte Carlo error
    // at 40 runs, and in the direction the module predicts.
    expect(simulated).toBeLessThan(0.5 * mf.analyticFinalSize!.value);
    expect(mf.analyticFinalSize!.value).toBeGreaterThan(0.9);
    const comparisonNote = mf.limitations.join(' ');
    expect(comparisonNote).toMatch(/OVERestimates spread on a clustered network/);
    // The lattice is the structural reason: zero clustering by triangles but
    // strong spatial correlation, so the neighbourhood is quickly exhausted.
    expect(degreeSummary(lattice.graph).degree.every((k) => k === 4)).toBe(true);
  }, 60_000);

  it('refuses a mass-action model started from zero infected', () => {
    expect(() => massActionODE({ model: 'SIR', beta: 1, gamma: 1, meanDegree: 5, initialInfectedFraction: 0 })).toThrow(
      /stays at zero for ever/,
    );
    expect(() => massActionODE({ model: 'SIR', beta: -1, gamma: 1, meanDegree: 5 })).toThrow(EngineError);
  });
});

describe('outbreak versus extinction, reported separately', () => {
  it('keeps extinction runs out of the size distribution, and the pooled mean matches neither', () => {
    // Near the threshold the final-size distribution is bimodal, which is
    // exactly where pooling does the most damage.
    const n = 3000;
    const g = erdosRenyiGnp(n, 8 / (n - 1), 'bimodal').graph;
    const ens = runSpreadEnsemble(g, { model: 'SIR', beta: 0.2, gamma: 1, horizon: 300 }, 'bimodal-run', {
      runs: 150,
      extinctionCutoff: 20,
    });
    expect(ens.extinctionRuns).toBeGreaterThan(5);
    expect(ens.takeoffRuns).toBeGreaterThan(5);
    expect(ens.extinctionRuns + ens.takeoffRuns).toBe(ens.meta.runs);
    // The two populations are separated and neither is contaminated.
    expect(ens.distribution.extinctionSizes.every((s) => s <= ens.distribution.cutoff)).toBe(true);
    expect(ens.distribution.takeoffSizes.every((s) => s > ens.distribution.cutoff)).toBe(true);
    expect(ens.distribution.takeoffSizes.length).toBe(ens.takeoffRuns);

    const extinctionMean =
      ens.distribution.extinctionSizes.reduce((a, b) => a + b, 0) / ens.distribution.extinctionSizes.length;
    const takeoffMean = ens.meanTakeoffSize!.value;
    const pooled = ens.pooledMeanSize.value;
    // The pooled mean lies strictly between the two modes and matches neither.
    expect(pooled).toBeGreaterThan(extinctionMean);
    expect(pooled).toBeLessThan(takeoffMean);
    // "Matches neither" made quantitative: it is far from both, in units of the
    // gap between them.
    const gap = takeoffMean - extinctionMean;
    expect(pooled - extinctionMean).toBeGreaterThan(0.05 * gap);
    expect(takeoffMean - pooled).toBeGreaterThan(0.05 * gap);
    expect(ens.pooledMeanSize.label).toMatch(/MISLEADING/);
    expect(ens.pooledMeanSize.note).toMatch(/describes no \w+ outcome/);

    // The two different intervals are kept apart.
    const spread = ens.takeoffSizeQuantiles;
    expect(spread.length).toBe(5);
    const ci = ens.meanTakeoffSizeInterval!;
    // The CI for the mean is much narrower than the 5-95 spread of outcomes.
    const ciWidth = ci.upper - ci.lower;
    const spreadWidth = spread[4].value - spread[0].value;
    expect(ciWidth).toBeLessThan(spreadWidth);
    expect(ens.notes.join(' ')).toMatch(/how much outcomes VARY/);
    expect(ens.notes.join(' ')).toMatch(/PIN DOWN/);
    // Peak height and timing come with bands, not point estimates alone.
    expect(ens.peakInfected!.q05).toBeLessThanOrEqual(ens.peakInfected!.median);
    expect(ens.peakInfected!.median).toBeLessThanOrEqual(ens.peakInfected!.q95);
    expect(ens.peakTime!.q95).toBeGreaterThan(0);
    // Everything is marked empirical and conditional on the structure.
    expect(ens.extinctionProbability.exactness).toBe('empirical');
    expect(ens.conditionalOn).toMatch(/almost never observed directly/);
  }, 60_000);

  it('runs SEIR and SIS, and distinguishes distinct infections from infection events', () => {
    const g = erdosRenyiGnp(800, 10 / 799, 'compart').graph;
    const rng = new Random('compart-seed');
    const seir = simulateSpreadRun(g, { model: 'SEIR', beta: 0.5, gamma: 1, sigma: 0.5, horizon: 200 }, rng);
    expect(seir.finalSize).toBeGreaterThan(0);
    expect(seir.finalSize).toBeLessThanOrEqual(g.n);
    // In SIR/SEIR nobody is reinfected, so the two counts coincide.
    expect(seir.cumulativeInfections).toBe(seir.finalSize);
    expect(seir.state.filter((s) => s === 'E').length).toBe(0); // ran to extinction

    // A fresh stream, and a transmission rate comfortably above the SIS
    // threshold gamma<k>/<k^2> so the process reaches its endemic state.
    const sis = simulateSpreadRun(g, { model: 'SIS', beta: 1, gamma: 1, horizon: 50 }, new Random('sis-seed'));
    // SIS allows reinfection, so events exceed distinct nodes.
    expect(sis.cumulativeInfections).toBeGreaterThan(sis.finalSize);
    expect(sis.finalSize).toBeLessThanOrEqual(g.n);

    // SEIR without sigma is refused rather than defaulted.
    expect(() => simulateSpreadRun(g, { model: 'SEIR', beta: 0.5, gamma: 1 }, rng)).toThrow(EngineError);
    // Conflicting inputs are refused.
    expect(() =>
      simulateSpreadRun(g, { model: 'SIR', beta: 1, gamma: 1 }, rng, { initialInfected: [3], immune: [3] }),
    ).toThrow(/both as initially infected and as immune/);
    // An all-immune population is refused, not reported as a zero outbreak.
    expect(() =>
      simulateSpreadRun(g, { model: 'SIR', beta: 1, gamma: 1 }, rng, {
        immune: Array.from({ length: g.n }, (_, i) => i),
      }),
    ).toThrow(/Every node is immune/);
  });
});

describe('interventions', () => {
  it('the friendship paradox holds structurally and is exploited by acquaintance immunisation', () => {
    const ba = barabasiAlbert(3000, 2, 'fp-ba').graph;
    const fp = friendshipParadox(ba);
    // Identity: <k^2>/<k> = <k> + Var(k)/<k> >= <k>, with equality only for a
    // regular graph. The measured neighbour degree must equal <k^2>/<k>.
    expect(fp.meanNeighbourDegree.value).toBeCloseTo(fp.configurationModelPrediction.value, 8);
    expect(fp.ratio.value).toBeGreaterThan(1);
    // A regular graph has ratio exactly 1.
    const reg = friendshipParadox(cycle(50));
    expect(reg.ratio.value).toBeCloseTo(1, 12);

    // Acquaintance immunisation reaches much higher-degree nodes than random
    // dosing, using no knowledge of the network.
    const rand = chooseImmunisation(ba, 300, 'random', 'imm-rand');
    const acq = chooseImmunisation(ba, 300, 'acquaintance', 'imm-acq');
    expect(acq.meanDegreeImmunised.value).toBeGreaterThan(1.5 * rand.meanDegreeImmunised.value);
    expect(acq.edgeEndpointShare.value).toBeGreaterThan(1.5 * rand.edgeEndpointShare.value);
    expect(acq.notes.join(' ')).toMatch(/WITHOUT anyone knowing the degree distribution/);
  });

  it('friendship-paradox immunisation beats random immunisation at the same dose budget', () => {
    const ba = barabasiAlbert(3000, 2, 'interv-ba').graph;
    const params = { model: 'SIR' as const, beta: 0.3, gamma: 1, horizon: 200 };
    const cmp = compareInterventions(ba, params, 300, 'interv', {
      strategies: ['none', 'random', 'acquaintance', 'degree'],
      runs: 60,
    });
    const get = (s: string) => cmp.arms.find((a) => a.strategy === s)!.expectedInfectedPer100.value;
    // Measured at 10% coverage: none 5.7, random 4.5, acquaintance 0.09,
    // degree 0.06 infected per 100. The gap between random and acquaintance is
    // an order of magnitude, far beyond the Monte Carlo error at 60 runs
    // (the standard error of each arm is a few per cent of its own value).
    expect(get('random')).toBeLessThan(get('none'));
    expect(get('acquaintance')).toBeLessThan(0.5 * get('random'));
    // Degree targeting is the best, but it needs information nobody has; the
    // acquaintance strategy gets most of the way there without it.
    expect(get('degree')).toBeLessThanOrEqual(get('acquaintance') * 1.5 + 0.5);
    expect(cmp.limitations.join(' ')).toMatch(/operational assumption/);
    expect(cmp.notes.join(' ')).toMatch(/using no network information/);
  }, 60_000);

  it('refuses an impossible intervention rather than returning a degenerate result', () => {
    const g = barabasiAlbert(50, 2, 'interv-small').graph;
    expect(() => compareInterventions(g, { model: 'SIR', beta: 1, gamma: 1 }, 50, 's')).toThrow(EngineError);
    // Acquaintance immunisation on a graph with many isolated nodes is refused.
    const sparse = buildGraph({
      nodes: Array.from({ length: 20 }, (_, i) => `v${i}`),
      edges: [{ source: 'v0', target: 'v1' }],
    });
    expect(() => chooseImmunisation(sparse, 5, 'acquaintance', 'x')).toThrow(/isolated/);
  });
});

describe('influence maximisation', () => {
  it('greedy achieves at least (1 - 1/e) of the brute-force optimum on a small graph', () => {
    // 16 nodes, so C(16,3) = 560 seed sets are enumerable here in the test.
    const g = barabasiAlbert(16, 2, 'inf-graph').graph;
    const replicates = 400;
    const greedy = runInfluenceMaximisation(g, 3, 'greedy', { p: 0.2, replicates });
    const brute = bruteForceInfluenceMaximisation(g, 3, 'brute', { p: 0.2, replicates });
    expect(brute.setsEvaluated).toBe(560);
    // The theorem: greedy >= (1 - 1/e) x optimum for a monotone submodular
    // objective. Measured ratio ~0.97, comfortably above 0.632.
    expect(greedy.expectedSpread.value).toBeGreaterThanOrEqual(GREEDY_APPROXIMATION_RATIO * brute.expectedSpread.value);
    expect(GREEDY_APPROXIMATION_RATIO).toBeCloseTo(1 - 1 / Math.E, 15);
    // The guarantee is stated, with its Monte Carlo caveat.
    expect(greedy.approximationGuarantee.value).toBeCloseTo(0.6321205588, 8);
    expect(greedy.approximationGuarantee.note).toMatch(/submodular/);
    expect(greedy.limitations.join(' ')).toMatch(/WORST CASE/);
    // The implied bounds bracket the optimum.
    expect(brute.expectedSpread.value).toBeGreaterThanOrEqual(greedy.impliedOptimumBounds.lower * 0.95);
    expect(brute.expectedSpread.value).toBeLessThanOrEqual(greedy.impliedOptimumBounds.upperBound * 1.05);
  }, 60_000);

  it('refuses brute force above the stated node limit, naming the combinatorial cost', () => {
    const g = barabasiAlbert(NETWORK_LIMITS.bruteForceInfluenceMaxNodes + 1, 2, 'bf-limit').graph;
    let message = '';
    try {
      bruteForceInfluenceMaximisation(g, 3, 'bf');
    } catch (e) {
      message = (e as EngineError).message;
    }
    expect(message).toMatch(/seed sets/);
    expect(message).toMatch(/1 - 1\/e/);
  });

  it('the linear threshold model refuses over-determined influence weights', () => {
    const g = buildGraph({
      nodes: ['a', 'b', 'c'],
      edges: [
        { source: 'a', target: 'c', weight: 0.7 },
        { source: 'b', target: 'c', weight: 0.8 },
      ],
      directed: true,
    });
    const rng = new Random('lt');
    // Node c receives 0.7 + 0.8 = 1.5 of influence weight, above 1, so the
    // model is not well posed and the run is refused rather than renormalised.
    expect(() => linearThresholdRun(g, [0], rng, { useEdgeWeights: true })).toThrow(/sum to 1.5/);
    // Without useEdgeWeights the weights are normalised by in-degree and the
    // model is well posed; a threshold outside [0,1] is still refused.
    expect(() => linearThresholdRun(g, [0], rng, { thresholds: [0.5, 0.5, 2] })).toThrow(/must lie in \[0,1\]/);
    expect(() => linearThresholdRun(g, [0], rng, { thresholds: [0.5] })).toThrow(/thresholds were supplied/);
    const spread = linearThresholdRun(g, [0, 1], rng, { thresholds: [0, 0, 0.9] });
    expect(spread.count).toBe(3);
    // The independent cascade refuses an edge weight that is not a probability.
    const bad = buildGraph({ nodes: ['a', 'b'], edges: [{ source: 'a', target: 'b', weight: 3 }] });
    expect(() => independentCascadeRun(bad, [0], 0.5, rng, { useEdgeWeights: true })).toThrow(/not a probability/);
    // p = 0 means nothing ever spreads beyond the seeds.
    expect(independentCascadeRun(complete(10), [0], 0, rng).count).toBe(1);
    // p = 1 means everything in the seed's component activates.
    expect(independentCascadeRun(complete(10), [0], 1, rng).count).toBe(10);
  });
});

describe('generators, determinism and partial results', () => {
  it('is deterministic under a fixed seed and different under a different seed', () => {
    const a = erdosRenyiGnp(400, 0.02, 'det-seed').graph;
    const b = erdosRenyiGnp(400, 0.02, 'det-seed').graph;
    const c = erdosRenyiGnp(400, 0.02, 'other-seed').graph;
    expect(a.m).toBe(b.m);
    expect(a.out.map((x) => x.join(','))).toEqual(b.out.map((x) => x.join(',')));
    expect(a.out.map((x) => x.join(','))).not.toEqual(c.out.map((x) => x.join(',')));

    const params = { model: 'SIR' as const, beta: 0.5, gamma: 1, horizon: 100 };
    const e1 = runSpreadEnsemble(a, params, 'ens-seed', { runs: 25 });
    const e2 = runSpreadEnsemble(b, params, 'ens-seed', { runs: 25 });
    expect(e1.distribution.takeoffSizes).toEqual(e2.distribution.takeoffSizes);
    expect(e1.distribution.extinctionSizes).toEqual(e2.distribution.extinctionSizes);
  });

  it('the percolation generator yields more than once and cancels with partial results', () => {
    const g = erdosRenyiGnp(600, 0.01, 'gen-perc').graph;
    const probabilities = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    let yields = 0;
    const it = percolationCurveSteps(g, 'gen1', { probabilities, replicates: 2 });
    let step = it.next();
    while (!step.done) {
      yields++;
      step = it.next();
    }
    expect(yields).toBe(probabilities.length);
    expect(step.value.meta.partial).toBe(false);

    // Cancel after 4 of 8 probabilities: the result is partial and covers 4.
    let seen = 0;
    const cancellable = percolationCurveSteps(g, 'gen2', {
      probabilities,
      replicates: 2,
      isCancelled: () => seen >= 4,
    });
    let s2 = cancellable.next();
    while (!s2.done) {
      seen++;
      s2 = cancellable.next();
    }
    expect(seen).toBe(4);
    expect(s2.value.meta.partial).toBe(true);
    expect(s2.value.meta.runs).toBe(4);
    expect(s2.value.meta.requestedRuns).toBe(8);
    expect(s2.value.points.length).toBe(4);
    expect(s2.value.limitations.join(' ')).toMatch(/Cancelled/);

    // Cancelling before three probabilities are done is a refusal: a threshold
    // cannot be located from fewer than three points.
    let early = 0;
    const tooEarly = percolationCurveSteps(g, 'gen3', {
      probabilities,
      replicates: 1,
      isCancelled: () => true,
    });
    expect(() => {
      let s = tooEarly.next();
      while (!s.done) {
        early++;
        s = tooEarly.next();
      }
    }).toThrow(/cannot be located from fewer than three points/);
    expect(early).toBe(1);
  });

  it('the spreading ensemble generator yields between chunks and cancels with partial results', () => {
    const g = erdosRenyiGnp(600, 0.02, 'gen-spread').graph;
    const params = { model: 'SIR' as const, beta: 1, gamma: 1, horizon: 100 };
    let yields = 0;
    const it = spreadEnsembleSteps(g, params, 'gen-sp', { runs: 60, chunkSize: 10 });
    let step = it.next();
    while (!step.done) {
      yields++;
      step = it.next();
    }
    expect(yields).toBe(6);
    expect(step.value.meta.partial).toBe(false);
    expect(step.value.meta.runs).toBe(60);

    let seen = 0;
    const cancellable = spreadEnsembleSteps(g, params, 'gen-sp2', {
      runs: 60,
      chunkSize: 10,
      isCancelled: () => seen >= 2,
    });
    let s2 = cancellable.next();
    while (!s2.done) {
      seen++;
      s2 = cancellable.next();
    }
    expect(seen).toBe(2);
    expect(s2.value.meta.partial).toBe(true);
    expect(s2.value.meta.runs).toBe(20);
    expect(s2.value.limitations.join(' ')).toMatch(/PARTIAL/);
  });

  it('the influence-maximisation generator yields once per seed and cancels partially', () => {
    const g = barabasiAlbert(30, 2, 'gen-inf').graph;
    let seen = 0;
    const it = influenceMaximisationSteps(g, 5, 'gen-im', {
      p: 0.15,
      replicates: 30,
      isCancelled: () => seen >= 2,
    });
    let step = it.next();
    while (!step.done) {
      seen++;
      step = it.next();
    }
    expect(seen).toBe(2);
    expect(step.value.seeds.length).toBe(2);
    expect(step.value.meta.partial).toBe(true);
    expect(step.value.limitations.join(' ')).toMatch(/PARTIAL/);
  }, 60_000);
});

describe('exactness labelling and the conditionality statement', () => {
  it('labels graph measures exact, spectra and thresholds numerical, simulation empirical', () => {
    const g = petersen();
    expect(degreeSummary(g).meanDegree.exactness).toBe('exact');
    expect(clustering(g).global.exactness).toBe('exact');
    expect(connectedComponents(g).giantFraction.exactness).toBe('exact');
    expect(requireDiameter(g).exactness).toBe('exact');
    expect(betweennessCentrality(g).exactness).toBe('exact');
    expect(degreeCentrality(g).exactness).toBe('exact');

    expect(algebraicConnectivity(g).fiedlerValue.exactness).toBe('numerical');
    expect(laplacianSpectrum(g).largest.exactness).toBe('numerical');
    expect(eigenvectorCentrality(g).exactness).toBe('numerical');
    expect(pageRank(g).exactness).toBe('numerical');
    expect(katzCentrality(g, 0.1).exactness).toBe('numerical');

    const curve = runPercolationCurve(g, 'exactness', { probabilities: [0.2, 0.4, 0.6, 0.8], replicates: 2 });
    expect(curve.threshold.exactness).toBe('numerical');
    const ens = runSpreadEnsemble(g, { model: 'SIR', beta: 1, gamma: 1, horizon: 50 }, 'exactness-sir', { runs: 10 });
    expect(ens.extinctionProbability.exactness).toBe('empirical');
    expect(ens.pooledMeanSize.exactness).toBe('empirical');
  });

  it('attaches the conditional-on-structure statement to every result type', () => {
    const g = barabasiAlbert(60, 2, 'cond').graph;
    const expected = /Conditional on the supplied network structure/;
    expect(degreeSummary(g).conditionalOn).toMatch(expected);
    expect(clustering(g).conditionalOn).toMatch(expected);
    expect(connectedComponents(g).conditionalOn).toMatch(expected);
    expect(pathLengths(g).conditionalOn).toMatch(expected);
    expect(kCoreDecomposition(g).conditionalOn).toMatch(expected);
    expect(degreeAssortativity(g).conditionalOn).toMatch(expected);
    expect(betweennessCentrality(g).conditionalOn).toMatch(expected);
    expect(pageRank(g).conditionalOn).toMatch(expected);
    expect(laplacianSpectrum(g).conditionalOn).toMatch(expected);
    expect(algebraicConnectivity(g).conditionalOn).toMatch(expected);
    expect(barabasiAlbert(10, 2, 'c').conditionalOn).toMatch(expected);
    expect(runPercolationCurve(g, 'c', { probabilities: [0.3, 0.5, 0.7], replicates: 2 }).conditionalOn).toMatch(expected);
    expect(runSpreadEnsemble(g, { model: 'SIR', beta: 1, gamma: 1, horizon: 50 }, 'c', { runs: 5 }).conditionalOn).toMatch(expected);
    expect(runInfluenceMaximisation(g, 2, 'c', { replicates: 20 }).conditionalOn).toMatch(expected);
    expect(cascadingFailure(g, [0], {}).conditionalOn).toMatch(expected);
    expect(bootstrapPercolation(g, [0], 2).conditionalOn).toMatch(expected);
  });
});
