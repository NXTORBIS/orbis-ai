/**
 * Percolation: the phase transition, and the robustness asymmetry.
 *
 * Removing nodes or edges at random from a network does nothing much, and then
 * suddenly does everything. Below the percolation threshold the network is a
 * dust of small fragments; above it a constant fraction of it is one connected
 * blob. The transition is *sharp*: on a large network a change of a few per
 * cent in connectivity moves the system from fragmented to essentially fully
 * connected. That sharpness is the headline output of this file, because it is
 * what a list-of-independent-exposures model cannot represent at all.
 *
 * The second result here is the asymmetry between random and targeted removal.
 * A scale-free network is extremely robust to random failure — you can delete
 * most of it at random and the giant component survives, because most nodes
 * are not hubs — and extremely fragile to an attacker who removes hubs first.
 * The same network, the same number of nodes removed, two qualitatively
 * different outcomes. This is the single most operationally useful fact in
 * network risk, and both curves are produced so the gap can be seen.
 */
import { EngineError, Validator } from '../core/result';
import { mean } from '../stats/descriptive';
import { Random } from '../random/rng';
import { edgePairs } from './graph';
import { betweennessCentrality, degreeCentrality } from './centrality';
import { degreeSummary } from './measures';
import type { Graph, MonteCarloMeta, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, NETWORK_LIMITS, nq } from './types';

/* ------------------------------------------------------------- union-find */

/** Disjoint-set union with path halving — iterative, no recursion. */
class UnionFind {
  private readonly parent: Int32Array;
  private readonly size: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    this.size = new Int32Array(n).fill(1);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    let r = x;
    while (this.parent[r] !== r) {
      this.parent[r] = this.parent[this.parent[r]];
      r = this.parent[r];
    }
    return r;
  }
  union(a: number, b: number): boolean {
    let ra = this.find(a);
    let rb = this.find(b);
    if (ra === rb) return false;
    if (this.size[ra] < this.size[rb]) {
      const t = ra;
      ra = rb;
      rb = t;
    }
    this.parent[rb] = ra;
    this.size[ra] += this.size[rb];
    return true;
  }
  componentSize(x: number): number {
    return this.size[this.find(x)];
  }
}

export interface ClusterStats {
  /** Fraction of the ORIGINAL n in the largest surviving component. */
  giantFraction: number;
  largest: number;
  secondLargest: number;
  aliveNodes: number;
  /** Mean cluster size excluding the largest: the finite-size susceptibility
   *  whose peak locates the threshold. */
  susceptibility: number;
  clusterCount: number;
}

/**
 * Component statistics on a masked graph, by union-find.
 *
 * `aliveNode` null means every node present (bond percolation); `keepEdge`
 * null means every edge present (site percolation).
 */
export function maskedClusterStats(
  g: Graph,
  edges: ReadonlyArray<readonly [number, number]>,
  aliveNode: Uint8Array | null,
  keepEdge: Uint8Array | null,
): ClusterStats {
  const uf = new UnionFind(g.n);
  for (let e = 0; e < edges.length; e++) {
    if (keepEdge && !keepEdge[e]) continue;
    const [a, b] = edges[e];
    if (aliveNode && (!aliveNode[a] || !aliveNode[b])) continue;
    uf.union(a, b);
  }
  const sizes = new Map<number, number>();
  let alive = 0;
  for (let i = 0; i < g.n; i++) {
    if (aliveNode && !aliveNode[i]) continue;
    alive++;
    const r = uf.find(i);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  let largest = 0;
  let second = 0;
  for (const s of sizes.values()) {
    if (s > largest) {
      second = largest;
      largest = s;
    } else if (s > second) second = s;
  }
  // Susceptibility: sum s^2 / sum s over the non-giant clusters.
  let num = 0;
  let den = 0;
  let seenLargest = false;
  for (const s of sizes.values()) {
    if (!seenLargest && s === largest) {
      seenLargest = true;
      continue;
    }
    num += s * s;
    den += s;
  }
  return {
    giantFraction: largest / g.n,
    largest,
    secondLargest: second,
    aliveNodes: alive,
    susceptibility: den > 0 ? num / den : 0,
    clusterCount: sizes.size,
  };
}

/* ------------------------------------------------------ percolation curve */

export interface PercolationPoint {
  p: number;
  giantFraction: number;
  giantFractionSe: number;
  susceptibility: number;
  secondLargest: number;
  replicates: number;
}

export interface PercolationCurve {
  kind: 'site' | 'bond';
  points: PercolationPoint[];
  /** Located numerically from the susceptibility peak. */
  threshold: NetworkQuantity;
  /** Order-parameter exponent beta in S ~ (p - p_c)^beta, if estimable. */
  betaExponent: NetworkQuantity | null;
  /** Susceptibility exponent gamma in chi ~ |p - p_c|^-gamma, if estimable. */
  gammaExponent: NetworkQuantity | null;
  /** How abruptly S rises: max dS/dp over the grid. */
  maxSlope: NetworkQuantity;
  meta: MonteCarloMeta;
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

export interface PercolationOptions {
  kind?: 'site' | 'bond';
  /** Occupation probabilities to evaluate. Defaults to 41 points on [0,1]. */
  probabilities?: number[];
  replicates?: number;
  isCancelled?: () => boolean;
}

/**
 * Site or bond percolation as a generator, yielding after each occupation
 * probability so a worker can be cancelled. A cancelled run returns the
 * probabilities it finished, marked partial.
 */
export function* percolationCurveSteps(
  g: Graph,
  seed: string | number,
  options: PercolationOptions = {},
): Generator<number, PercolationCurve, void> {
  const kind = options.kind ?? 'bond';
  const replicates = options.replicates ?? 20;
  const v = new Validator();
  v.integer(replicates, 'replicates', 'Replicates per probability', 1, 100_000);
  v.throwIfInvalid();
  const probs = options.probabilities ?? defaultGrid(41);
  for (const p of probs) {
    const pv = new Validator();
    pv.probability(p, 'probabilities', `Occupation probability ${p}`);
    pv.throwIfInvalid();
  }
  if (g.m === 0) {
    throw new EngineError(
      'Percolation on a graph with no edges is trivial and uninformative: every cluster is a single node at every ' +
        'occupation probability. No curve is produced.',
      'degenerate',
    );
  }
  const edges = edgePairs(g);
  const rng = new Random(seed);
  const points: PercolationPoint[] = [];
  let cancelled = false;
  for (let pi = 0; pi < probs.length; pi++) {
    const p = probs[pi];
    const giants: number[] = [];
    const chis: number[] = [];
    const seconds: number[] = [];
    for (let r = 0; r < replicates; r++) {
      let aliveNode: Uint8Array | null = null;
      let keepEdge: Uint8Array | null = null;
      if (kind === 'site') {
        aliveNode = new Uint8Array(g.n);
        for (let i = 0; i < g.n; i++) aliveNode[i] = rng.uniform() < p ? 1 : 0;
      } else {
        keepEdge = new Uint8Array(edges.length);
        for (let e = 0; e < edges.length; e++) keepEdge[e] = rng.uniform() < p ? 1 : 0;
      }
      const st = maskedClusterStats(g, edges, aliveNode, keepEdge);
      giants.push(st.giantFraction);
      chis.push(st.susceptibility);
      seconds.push(st.secondLargest);
    }
    const m = mean(giants);
    let varSum = 0;
    for (const x of giants) varSum += (x - m) ** 2;
    const se = replicates > 1 ? Math.sqrt(varSum / (replicates - 1) / replicates) : 0;
    points.push({
      p,
      giantFraction: m,
      giantFractionSe: se,
      susceptibility: mean(chis),
      secondLargest: mean(seconds),
      replicates,
    });
    yield pi + 1;
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }
  if (points.length < 3) {
    throw new EngineError(
      `Only ${points.length} occupation probabilities were evaluated${cancelled ? ' before cancellation' : ''}. A ` +
        'threshold cannot be located from fewer than three points; no threshold is reported.',
      cancelled ? 'cancelled' : 'too-few',
    );
  }
  return summarisePercolation(kind, points, { runs: points.length, requestedRuns: probs.length, partial: cancelled, seed }, g);
}

export function runPercolationCurve(g: Graph, seed: string | number, options: PercolationOptions = {}): PercolationCurve {
  const it = percolationCurveSteps(g, seed, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

function defaultGrid(count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(i / (count - 1));
  return out;
}

function summarisePercolation(
  kind: 'site' | 'bond',
  points: PercolationPoint[],
  meta: MonteCarloMeta,
  g: Graph,
): PercolationCurve {
  // Threshold: the susceptibility peak, parabolically refined on the grid.
  let bi = 0;
  for (let i = 1; i < points.length; i++) if (points[i].susceptibility > points[bi].susceptibility) bi = i;
  let pc = points[bi].p;
  if (bi > 0 && bi < points.length - 1) {
    const y0 = points[bi - 1].susceptibility;
    const y1 = points[bi].susceptibility;
    const y2 = points[bi + 1].susceptibility;
    const denom = y0 - 2 * y1 + y2;
    if (denom !== 0) {
      const shift = (0.5 * (y0 - y2)) / denom;
      if (Math.abs(shift) <= 1) {
        const h = (points[bi + 1].p - points[bi - 1].p) / 2;
        pc = points[bi].p + shift * h;
      }
    }
  }
  pc = Math.min(1, Math.max(0, pc));

  // Steepest rise of the order parameter: the sharpness of the transition.
  let maxSlope = 0;
  let maxSlopeAt = points[0].p;
  for (let i = 1; i < points.length; i++) {
    const dp = points[i].p - points[i - 1].p;
    if (dp <= 0) continue;
    const slope = (points[i].giantFraction - points[i - 1].giantFraction) / dp;
    if (slope > maxSlope) {
      maxSlope = slope;
      maxSlopeAt = (points[i].p + points[i - 1].p) / 2;
    }
  }

  const beta = fitExponent(points.filter((pt) => pt.p > pc + 1e-9 && pt.giantFraction > 1e-6).map((pt) => [pt.p - pc, pt.giantFraction]));
  const gamma = fitExponent(
    points.filter((pt) => Math.abs(pt.p - pc) > 1e-9 && pt.susceptibility > 1e-9).map((pt) => [Math.abs(pt.p - pc), pt.susceptibility]),
  );

  const deg = degreeSummary(g);
  const notes = [
    `${kind === 'site' ? 'Site' : 'Bond'} percolation on ${g.n} nodes and ${g.m} edges, ` +
      `${points[0].replicates} replicates per occupation probability.`,
    `The threshold is located as the peak of the finite-size susceptibility (mean non-giant cluster size), ` +
      `parabolically interpolated on the grid: p_c = ${pc.toPrecision(5)}.`,
    `Sharpness: the giant-component fraction rises at up to ${maxSlope.toPrecision(4)} per unit p, near p = ${maxSlopeAt.toPrecision(3)}. ` +
      'On a larger graph this slope diverges — the transition is discontinuous in the infinite-size limit.',
  ];
  if (kind === 'site') {
    const c = deg.meanDegree.value;
    if (c > 0) {
      notes.push(
        `For a configuration-model network the site threshold is f_c = <k>/(<k^2> - <k>) = ` +
          `${(deg.meanDegree.value / Math.max(1e-12, deg.secondMoment.value - deg.meanDegree.value)).toPrecision(5)}; ` +
          `for a Poisson degree distribution that reduces to 1/<k> = ${(1 / c).toPrecision(5)}.`,
      );
    }
  }
  return {
    kind,
    points,
    threshold: nq('Percolation threshold', pc, 'numerical', {
      formula: 'argmax_p chi(p), chi = sum_{s != largest} s^2 / sum_{s != largest} s',
      note: 'A finite-size estimate. It is biased relative to the infinite-system threshold by O(n^-1/nu), and the ' +
        'bias does not shrink with more replicates — only with a larger graph.',
    }),
    betaExponent: beta
      ? nq('Order-parameter exponent beta', beta.exponent, 'numerical', {
          formula: 'S ~ (p - p_c)^beta, fitted by OLS on log-log',
          note: `R^2 = ${beta.rSquared.toPrecision(3)} over ${beta.points} points. Critical exponents measured on a ` +
            'finite graph over a coarse grid are rough: the scaling law only holds asymptotically close to p_c, ' +
            'where the finite-size rounding of the transition is largest. Treat this as an order of magnitude.',
        })
      : null,
    gammaExponent: gamma
      ? nq('Susceptibility exponent gamma', -gamma.exponent, 'numerical', {
          formula: 'chi ~ |p - p_c|^-gamma',
          note: `R^2 = ${gamma.rSquared.toPrecision(3)} over ${gamma.points} points. Same caveat as beta.`,
        })
      : null,
    maxSlope: nq('Maximum dS/dp', maxSlope, 'numerical', { note: `Attained near p = ${maxSlopeAt.toPrecision(4)}.` }),
    meta,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes,
    limitations: [
      'Every number here is a finite-size estimate on one particular graph. The threshold of the model that graph ' +
        'was drawn from is a different (and unknown) quantity.',
      meta.partial ? `Cancelled: ${meta.runs} of ${meta.requestedRuns} occupation probabilities were evaluated.` : '',
      'Percolation treats removals as independent. Correlated failure (a shared power supply, a common counterparty) ' +
        'is not this model and is typically worse.',
    ].filter((s) => s.length > 0),
  };
}

function fitExponent(pts: [number, number][]): { exponent: number; rSquared: number; points: number } | null {
  if (pts.length < 3) return null;
  const xs = pts.map(([x]) => Math.log(x));
  const ys = pts.map(([, y]) => Math.log(y));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) return null;
  return { exponent: sxy / sxx, rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0, points: n };
}

/* ------------------------------------------------- random vs targeted attack */

export type AttackStrategy = 'random' | 'degree' | 'betweenness' | 'recalculated-degree';

export interface RobustnessPoint {
  removedFraction: number;
  giantFraction: number;
  giantFractionSe: number;
  secondLargest: number;
}

export interface RobustnessCurve {
  strategy: AttackStrategy;
  points: RobustnessPoint[];
  /** Area under S(f): a single-number robustness index in [0, 0.5]. */
  robustnessIndex: NetworkQuantity;
  /** Removed fraction at which S first drops below 1/10 of its initial value. */
  collapseFraction: NetworkQuantity | null;
  meta: MonteCarloMeta;
  conditionalOn: string;
  notes: string[];
}

export interface RobustnessOptions {
  strategies?: AttackStrategy[];
  fractions?: number[];
  /** Replicates — only the random strategy is stochastic, so targeted
   *  strategies use one replicate regardless. */
  replicates?: number;
  isCancelled?: () => boolean;
}

export interface RobustnessComparison {
  curves: RobustnessCurve[];
  /** Random minus targeted giant fraction at each removal level — the asymmetry. */
  asymmetry: { removedFraction: number; random: number; targeted: number; gap: number }[];
  maxGap: NetworkQuantity;
  meta: MonteCarloMeta;
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

/**
 * Random versus targeted removal, as a generator.
 *
 * `degree` removes the highest-degree nodes in one shot; `recalculated-degree`
 * recomputes degrees after each removal, which is a stronger attack; and
 * `betweenness` targets flow control rather than degree (and is refused on a
 * large graph, being O(n*m) per removal level).
 */
export function* robustnessSteps(
  g: Graph,
  seed: string | number,
  options: RobustnessOptions = {},
): Generator<number, RobustnessComparison, void> {
  const strategies = options.strategies ?? ['random', 'degree'];
  const fractions = options.fractions ?? defaultGrid(21).slice(0, 20);
  const replicates = options.replicates ?? 10;
  const v = new Validator();
  v.integer(replicates, 'replicates', 'Replicates', 1, 100_000);
  v.throwIfInvalid();
  for (const f of fractions) {
    const fv = new Validator();
    fv.range(f, 'fractions', `Removed fraction ${f}`, 0, 1);
    fv.throwIfInvalid();
  }
  if (g.n < 4) {
    throw new EngineError(`A robustness curve on ${g.n} nodes carries no information; use at least 4 nodes.`, 'too-small');
  }
  const edges = edgePairs(g);
  const rng = new Random(seed);
  const curves: RobustnessCurve[] = [];
  let cancelled = false;
  let done = 0;
  const total = strategies.length;

  for (const strategy of strategies) {
    if (strategy === 'betweenness' && g.n > NETWORK_LIMITS.betweennessMaxNodes) {
      throw new EngineError(
        `A betweenness-targeted attack on ${g.n} nodes is refused: betweenness costs O(n*m) and the limit is ` +
          `${NETWORK_LIMITS.betweennessMaxNodes} nodes. Use the 'degree' or 'recalculated-degree' strategy, which ` +
          'an attacker is also far more likely to be able to compute.',
        'limit',
      );
    }
    const stochastic = strategy === 'random';
    const reps = stochastic ? replicates : 1;
    const points: RobustnessPoint[] = [];
    // Static orderings are computed once.
    let staticOrder: number[] | null = null;
    if (strategy === 'degree') {
      staticOrder = degreeCentrality(g).ranking.map((r) => r.index);
    } else if (strategy === 'betweenness') {
      staticOrder = betweennessCentrality(g).ranking.map((r) => r.index);
    }
    for (const f of fractions) {
      const count = Math.floor(f * g.n);
      const vals: number[] = [];
      const seconds: number[] = [];
      for (let r = 0; r < reps; r++) {
        const alive = new Uint8Array(g.n).fill(1);
        if (strategy === 'random') {
          const perm = shuffledIndices(g.n, rng);
          for (let t = 0; t < count; t++) alive[perm[t]] = 0;
        } else if (staticOrder) {
          for (let t = 0; t < count; t++) alive[staticOrder[t]] = 0;
        } else {
          // recalculated-degree: peel the current highest-degree node repeatedly.
          const deg = new Int32Array(g.n);
          for (let i = 0; i < g.n; i++) deg[i] = g.out[i].length;
          for (let t = 0; t < count; t++) {
            let best = -1;
            let bestDeg = -1;
            for (let i = 0; i < g.n; i++) if (alive[i] && deg[i] > bestDeg) {
              bestDeg = deg[i];
              best = i;
            }
            if (best < 0) break;
            alive[best] = 0;
            for (const j of g.out[best]) if (alive[j]) deg[j]--;
          }
        }
        const st = maskedClusterStats(g, edges, alive, null);
        vals.push(st.giantFraction);
        seconds.push(st.secondLargest);
      }
      const m = mean(vals);
      let varSum = 0;
      for (const x of vals) varSum += (x - m) ** 2;
      points.push({
        removedFraction: f,
        giantFraction: m,
        giantFractionSe: reps > 1 ? Math.sqrt(varSum / (reps - 1) / reps) : 0,
        secondLargest: mean(seconds),
      });
    }
    const initial = points[0]?.giantFraction ?? 0;
    let collapse: number | null = null;
    for (const pt of points) {
      if (pt.giantFraction < 0.1 * initial) {
        collapse = pt.removedFraction;
        break;
      }
    }
    // Trapezoidal area under S(f), normalised by the f-range covered.
    let area = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].removedFraction - points[i - 1].removedFraction;
      area += (dx * (points[i].giantFraction + points[i - 1].giantFraction)) / 2;
    }
    const span = points.length > 1 ? points[points.length - 1].removedFraction - points[0].removedFraction : 1;
    curves.push({
      strategy,
      points,
      robustnessIndex: nq('Robustness index R', span > 0 ? area / span : 0, 'empirical', {
        formula: 'R = (1/span) integral S(f) df over the removal range sampled',
        note: 'Higher is more robust. Comparable only between curves computed over the same removal range.',
      }),
      collapseFraction:
        collapse === null
          ? null
          : nq('Removed fraction at collapse', collapse, 'empirical', {
              note: 'First sampled removal level at which the giant component falls below a tenth of its initial size.',
            }),
      meta: { runs: reps, requestedRuns: reps, partial: false, seed },
      conditionalOn: CONDITIONAL_ON_STRUCTURE,
      notes: [
        strategy === 'random'
          ? `Random removal, averaged over ${reps} replicates.`
          : 'Targeted removal is deterministic given the graph, so one replicate is exact for this graph (the ' +
            'sampling error is zero; the structural uncertainty is not).',
      ],
    });
    done++;
    yield done;
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }

  const randomCurve = curves.find((c) => c.strategy === 'random');
  const targetedCurve = curves.find((c) => c.strategy !== 'random');
  const asymmetry: RobustnessComparison['asymmetry'] = [];
  let maxGap = 0;
  let maxGapAt = 0;
  if (randomCurve && targetedCurve) {
    for (let i = 0; i < Math.min(randomCurve.points.length, targetedCurve.points.length); i++) {
      const rp = randomCurve.points[i];
      const tp = targetedCurve.points[i];
      const gap = rp.giantFraction - tp.giantFraction;
      asymmetry.push({ removedFraction: rp.removedFraction, random: rp.giantFraction, targeted: tp.giantFraction, gap });
      if (gap > maxGap) {
        maxGap = gap;
        maxGapAt = rp.removedFraction;
      }
    }
  }
  const deg = degreeSummary(g);
  return {
    curves,
    asymmetry,
    maxGap: nq('Largest random-minus-targeted gap in S', maxGap, 'empirical', {
      note: `Attained at a removed fraction of ${maxGapAt.toPrecision(3)}.`,
    }),
    meta: { runs: done, requestedRuns: total, partial: cancelled, seed },
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      'Random removal models accident; targeted removal models an adversary, or a correlated failure that happens to ' +
        'hit the busiest nodes first. They are not interchangeable and the gap between them is the quantity to plan against.',
      `This graph has mean degree ${deg.meanDegree.value.toPrecision(4)} and maximum degree ${deg.maxDegree.value}. ` +
        'The more skewed that ratio, the larger the asymmetry: a heavy-tailed network is robust to accident and ' +
        'fragile to attack, a homogeneous one is about equally (un)robust to both.',
    ],
    limitations: [
      'Nodes are removed and the rest of the network is assumed unchanged. Real systems reroute, and real operators ' +
        'respond; neither is modelled here. See the cascading-failure model for the opposite bias, where redistributed ' +
        'load makes things worse rather than better.',
      cancelled ? `Cancelled after ${done} of ${total} strategies; the comparison covers only those.` : '',
    ].filter((s) => s.length > 0),
  };
}

export function runRobustness(g: Graph, seed: string | number, options: RobustnessOptions = {}): RobustnessComparison {
  const it = robustnessSteps(g, seed, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

function shuffledIndices(n: number, rng: Random): Int32Array {
  const perm = new Int32Array(n);
  for (let i = 0; i < n; i++) perm[i] = i;
  for (let i = n - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = perm[i];
    perm[i] = perm[j];
    perm[j] = t;
  }
  return perm;
}

/* ------------------------------------------------------ cascading failure */

export interface CascadeResult {
  /** Nodes failed at the end, including the seed. */
  failed: boolean[];
  failedCount: number;
  failedFraction: NetworkQuantity;
  /** Failures added at each propagation round. */
  rounds: number[];
  /** Giant-component fraction of what survives. */
  survivingGiantFraction: NetworkQuantity;
  tolerance: number;
  loadMeasure: 'degree' | 'betweenness';
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

/**
 * Cascading failure by load redistribution (Motter–Lai).
 *
 * Each node carries an initial load (its degree, or its betweenness, which is
 * the flow-based choice) and a capacity of (1 + tolerance) times that load.
 * When a node fails its load is redistributed over its surviving neighbours;
 * any neighbour pushed above capacity fails in turn, iteratively until no
 * further failures occur.
 *
 * The non-obvious output is that a *single* well-chosen initial failure can
 * take down a large fraction of a heterogeneous network at a tolerance that
 * looks generous, while the same failure in a homogeneous network does nothing.
 */
export function cascadingFailure(
  g: Graph,
  seeds: ReadonlyArray<number>,
  options: { tolerance?: number; loadMeasure?: 'degree' | 'betweenness'; maxRounds?: number } = {},
): CascadeResult {
  const tolerance = options.tolerance ?? 0.2;
  const v = new Validator();
  v.nonNegative(tolerance, 'tolerance', 'Capacity tolerance');
  v.throwIfInvalid();
  if (seeds.length === 0) {
    throw new EngineError('A cascade needs at least one initially failed node; none were given.', 'empty');
  }
  for (const s of seeds) {
    if (!Number.isInteger(s) || s < 0 || s >= g.n) {
      throw new EngineError(`Seed node index ${s} is outside 0..${g.n - 1}.`, 'range');
    }
  }
  const loadMeasure = options.loadMeasure ?? 'degree';
  let load: number[];
  if (loadMeasure === 'betweenness') {
    load = betweennessCentrality(g, { normalised: false }).raw.map((x) => x + 1);
  } else {
    load = degreeSummary(g).degree.map((k) => k);
  }
  const capacity = load.map((l) => (1 + tolerance) * l);
  const current = load.slice();
  const failed = new Array<boolean>(g.n).fill(false);
  const rounds: number[] = [];
  let frontier: number[] = [...new Set(seeds)];
  for (const s of frontier) failed[s] = true;
  rounds.push(frontier.length);
  const maxRounds = options.maxRounds ?? g.n;
  let round = 0;
  while (frontier.length > 0 && round < maxRounds) {
    const next: number[] = [];
    for (const u of frontier) {
      const alive = g.out[u].filter((j) => !failed[j]);
      if (alive.length === 0) continue;
      const share = current[u] / alive.length;
      for (const j of alive) {
        current[j] += share;
        if (current[j] > capacity[j] && !failed[j]) {
          failed[j] = true;
          next.push(j);
        }
      }
    }
    if (next.length === 0) break;
    rounds.push(next.length);
    frontier = next;
    round++;
  }
  let failedCount = 0;
  for (const f of failed) if (f) failedCount++;
  const alive = new Uint8Array(g.n);
  for (let i = 0; i < g.n; i++) alive[i] = failed[i] ? 0 : 1;
  const st = maskedClusterStats(g, edgePairs(g), alive, null);
  return {
    failed,
    failedCount,
    failedFraction: nq('Failed fraction', failedCount / g.n, 'exact', {
      note: 'Deterministic given the graph, the seeds, the load measure and the tolerance. The uncertainty is in those inputs, not in this number.',
    }),
    rounds,
    survivingGiantFraction: nq('Giant component of survivors', st.giantFraction, 'exact'),
    tolerance,
    loadMeasure,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `${rounds.length} propagation rounds, failing ${rounds.join(' + ')} nodes respectively.`,
      `Load proxied by ${loadMeasure}; capacity = (1 + ${tolerance}) x initial load.`,
    ],
    limitations: [
      'Load is a proxy (degree or betweenness), not a measured flow, and redistribution is uniform over surviving ' +
        'neighbours rather than flow-conserving. A real routed network redistributes according to its routing, which ' +
        'can be better or much worse than this.',
      'There is no repair, no load shedding and no operator response. The result is therefore an upper bound on the ' +
        'cascade for the assumed tolerance, not a forecast.',
    ],
  };
}

/* ----------------------------------------------------- bootstrap percolation */

export interface BootstrapPercolationResult {
  threshold: number;
  active: boolean[];
  activeCount: number;
  activeFraction: NetworkQuantity;
  rounds: number[];
  /** True when the whole graph ended active. */
  fullyActivated: boolean;
  conditionalOn: string;
  notes: string[];
}

/**
 * Bootstrap percolation: a node activates once at least k of its neighbours
 * are active, iteratively from a seed set.
 *
 * Unlike ordinary percolation this has a *reinforcement* requirement, which
 * makes it the right model for a failure that needs corroboration — a bank
 * writing down an exposure only after several counterparties default, a person
 * adopting a behaviour only after several contacts do. The consequence is a
 * much more abrupt, sometimes discontinuous, transition in the seed fraction.
 */
export function bootstrapPercolation(
  g: Graph,
  seeds: ReadonlyArray<number>,
  threshold: number,
): BootstrapPercolationResult {
  const v = new Validator();
  v.integer(threshold, 'threshold', 'Activation threshold k', 1);
  v.throwIfInvalid();
  for (const s of seeds) {
    if (!Number.isInteger(s) || s < 0 || s >= g.n) {
      throw new EngineError(`Seed node index ${s} is outside 0..${g.n - 1}.`, 'range');
    }
  }
  const active = new Array<boolean>(g.n).fill(false);
  const activeNeighbours = new Int32Array(g.n);
  let frontier: number[] = [...new Set(seeds)];
  for (const s of frontier) active[s] = true;
  const rounds: number[] = [frontier.length];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const j of g.out[u]) {
        if (active[j]) continue;
        activeNeighbours[j]++;
        if (activeNeighbours[j] >= threshold) {
          active[j] = true;
          next.push(j);
        }
      }
    }
    if (next.length === 0) break;
    rounds.push(next.length);
    frontier = next;
  }
  let count = 0;
  for (const a of active) if (a) count++;
  return {
    threshold,
    active,
    activeCount: count,
    activeFraction: nq('Active fraction', count / g.n, 'exact', {
      note: 'Deterministic given the graph, the seed set and k. Bootstrap percolation is monotone: adding a seed can ' +
        'never reduce the final active set.',
    }),
    rounds,
    fullyActivated: count === g.n,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `k = ${threshold}: a node activates once ${threshold} of its neighbours have. Nodes of degree below ${threshold} ` +
        'can never activate unless seeded — which is why a low-degree periphery can be structurally immune here but not under ordinary percolation.',
      `${rounds.length} rounds, activating ${rounds.join(' + ')} nodes.`,
    ],
  };
}

/* ----------------------------------------------------- explosive percolation */

export interface ExplosivePercolationResult {
  /** Giant fraction as edges are added, under each rule. */
  points: { edgesPerNode: number; productRule: number; randomRule: number }[];
  /** Largest single-step jump in the giant fraction, per rule. */
  maxJumpProductRule: NetworkQuantity;
  maxJumpRandomRule: NetworkQuantity;
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

/**
 * Explosive percolation: the Achlioptas product rule.
 *
 * At each step two candidate edges are drawn and only the one whose addition
 * creates the smaller product of component sizes is kept. Deliberately
 * suppressing large merges delays the transition and then makes it far more
 * abrupt than random edge addition — the giant component appears in a single
 * jump of O(n) nodes at finite n.
 *
 * The honest caveat: the transition under the product rule is now known to be
 * *continuous* in the infinite-size limit, despite looking discontinuous at
 * every size anyone simulates. The jump measured here is a finite-size effect,
 * and this result says so rather than claiming a discontinuity.
 */
export function explosivePercolation(
  n: number,
  seed: string | number,
  options: { maxEdgesPerNode?: number; samples?: number } = {},
): ExplosivePercolationResult {
  const v = new Validator();
  v.integer(n, 'n', 'Number of nodes', 10, NETWORK_LIMITS.maxNodes);
  v.throwIfInvalid();
  const maxEpn = options.maxEdgesPerNode ?? 1.2;
  v.positive(maxEpn, 'maxEdgesPerNode', 'Maximum edges per node');
  v.throwIfInvalid();
  const totalEdges = Math.floor(maxEpn * n);
  const samples = options.samples ?? 120;
  const rng = new Random(seed);
  const record = Math.max(1, Math.floor(totalEdges / samples));

  const run = (productRule: boolean): { xs: number[]; ys: number[]; maxJump: number } => {
    const uf = new UnionFind(n);
    let largest = 1;
    const xs: number[] = [];
    const ys: number[] = [];
    let maxJump = 0;
    let prev = 1 / n;
    for (let e = 1; e <= totalEdges; e++) {
      let a = rng.int(0, n - 1);
      let b = rng.int(0, n - 1);
      while (b === a) b = rng.int(0, n - 1);
      if (productRule) {
        const c = rng.int(0, n - 1);
        let d = rng.int(0, n - 1);
        while (d === c) d = rng.int(0, n - 1);
        const p1 = uf.componentSize(a) * uf.componentSize(b);
        const p2 = uf.componentSize(c) * uf.componentSize(d);
        if (p2 < p1) {
          a = c;
          b = d;
        }
      }
      uf.union(a, b);
      const s = uf.componentSize(a);
      if (s > largest) largest = s;
      const frac = largest / n;
      if (frac - prev > maxJump) maxJump = frac - prev;
      prev = frac;
      if (e % record === 0 || e === totalEdges) {
        xs.push(e / n);
        ys.push(frac);
      }
    }
    return { xs, ys, maxJump };
  };

  const prod = run(true);
  const rand = run(false);
  const points: ExplosivePercolationResult['points'] = [];
  for (let i = 0; i < Math.min(prod.xs.length, rand.xs.length); i++) {
    points.push({ edgesPerNode: prod.xs[i], productRule: prod.ys[i], randomRule: rand.ys[i] });
  }
  return {
    points,
    maxJumpProductRule: nq('Largest single-edge jump in S (product rule)', prod.maxJump, 'empirical', {
      note: 'Measured on one realisation at this n.',
    }),
    maxJumpRandomRule: nq('Largest single-edge jump in S (random rule)', rand.maxJump, 'empirical'),
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `n = ${n}, up to ${totalEdges} edges (${maxEpn} per node), one realisation per rule with a shared seed stream.`,
      'The product rule delays the transition past the random rule\'s mean-degree-1 threshold and then crosses it far ' +
        'more abruptly: competitive edge selection is a mechanism for making a system *look* safe and then fail all at once.',
    ],
    limitations: [
      'The product-rule transition is continuous in the infinite-size limit (Riordan–Warnke); the jump measured here ' +
        'is a finite-size effect and shrinks, slowly, with n. It is reported as a measured jump at this n, not as a discontinuity.',
      'One realisation per rule. The jump size fluctuates between realisations; for a distribution, re-run with other seeds.',
    ],
  };
}
