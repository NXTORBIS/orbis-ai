/**
 * Interventions: who to immunise, and the friendship paradox.
 *
 * Random immunisation on a heavy-tailed network is close to useless: the doses
 * land almost entirely on low-degree nodes, because almost every node is
 * low-degree, while the hubs that carry the epidemic are untouched. Targeted
 * immunisation works, but it needs the degree of every node — which, for a
 * contact network, nobody has.
 *
 * The acquaintance (friendship-paradox) strategy resolves that: pick a node at
 * random, then immunise a random *neighbour* of that node. A neighbour reached
 * along a random edge is a size-biased draw — the probability of picking a
 * given node is proportional to its degree — so hubs are hit far more often
 * than chance, with no knowledge of the network beyond "who do you know".
 * This is the friendship paradox put to work: your friends have more friends
 * than you do, on average, and that is a property of the degree distribution
 * rather than of anyone's popularity.
 */
import { EngineError, Validator } from '../core/result';
import { Random } from '../random/rng';
import { degreeCentrality } from './centrality';
import { degreeSummary } from './measures';
import { runSpreadEnsemble } from './spreading';
import type { SpreadParameters, SpreadEnsembleResult } from './spreading';
import type { Graph, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, nq } from './types';

export type ImmunisationStrategy = 'random' | 'degree' | 'acquaintance' | 'recalculated-degree';

export interface ImmunisationSet {
  strategy: ImmunisationStrategy;
  nodes: number[];
  doses: number;
  /** Mean degree of the immunised nodes — the mechanism, made visible. */
  meanDegreeImmunised: NetworkQuantity;
  /** Mean degree of the whole graph, for comparison. */
  meanDegreeOverall: NetworkQuantity;
  /** Share of all edge endpoints covered by the immunised set. */
  edgeEndpointShare: NetworkQuantity;
  notes: string[];
}

/**
 * Choose an immunisation set of the given size under one of four strategies.
 *
 * `acquaintance` needs no knowledge of the network: it samples a node
 * uniformly and immunises one of that node's neighbours, chosen uniformly.
 */
export function chooseImmunisation(
  g: Graph,
  doses: number,
  strategy: ImmunisationStrategy,
  seed: string | number,
): ImmunisationSet {
  const v = new Validator();
  v.integer(doses, 'doses', 'Number of doses', 0, g.n);
  v.throwIfInvalid();
  const deg = degreeSummary(g);
  const rng = new Random(seed);
  const chosen = new Set<number>();

  if (strategy === 'random') {
    let guard = 0;
    while (chosen.size < doses) {
      chosen.add(rng.int(0, g.n - 1));
      if (++guard > 1000 * g.n + 10_000) break;
    }
  } else if (strategy === 'degree') {
    const order = degreeCentrality(g).ranking.map((r) => r.index);
    for (let t = 0; t < doses && t < order.length; t++) chosen.add(order[t]);
  } else if (strategy === 'recalculated-degree') {
    const d = new Int32Array(g.n);
    for (let i = 0; i < g.n; i++) d[i] = g.out[i].length;
    for (let t = 0; t < doses; t++) {
      let best = -1;
      let bestDeg = -1;
      for (let i = 0; i < g.n; i++) if (!chosen.has(i) && d[i] > bestDeg) {
        bestDeg = d[i];
        best = i;
      }
      if (best < 0) break;
      chosen.add(best);
      for (const j of g.out[best]) d[j]--;
    }
  } else {
    // Acquaintance immunisation: a random neighbour of a random node.
    let guard = 0;
    const maxGuard = 1000 * Math.max(1, doses) + 10_000;
    while (chosen.size < doses) {
      if (++guard > maxGuard) {
        throw new EngineError(
          `Acquaintance immunisation could only find ${chosen.size} distinct nodes with ${doses} doses requested. ` +
            'Too many nodes are isolated (an isolated node has no acquaintance to nominate), so the strategy cannot ' +
            'be carried out as specified. No partial set is returned as if it were the requested one.',
          'nonconvergent',
        );
      }
      const u = rng.int(0, g.n - 1);
      const nbs = g.out[u];
      if (nbs.length === 0) continue;
      chosen.add(nbs[rng.int(0, nbs.length - 1)]);
    }
  }
  const nodes = [...chosen];
  const immunisedDegrees = nodes.map((i) => deg.degree[i]);
  const meanImmunised = immunisedDegrees.length > 0 ? immunisedDegrees.reduce((a, b) => a + b, 0) / immunisedDegrees.length : 0;
  let totalEndpoints = 0;
  for (let i = 0; i < g.n; i++) totalEndpoints += deg.degree[i];
  let covered = 0;
  for (const d of immunisedDegrees) covered += d;
  const notes: string[] = [];
  if (strategy === 'acquaintance') {
    notes.push(
      `The immunised nodes have mean degree ${meanImmunised.toPrecision(4)} against the graph's ` +
        `${deg.meanDegree.value.toPrecision(4)}. The strategy reaches high-degree nodes because a node nominated by ` +
        'a random neighbour is drawn with probability proportional to its degree — the friendship paradox — and it ' +
        'does this WITHOUT anyone knowing the degree distribution or the network.',
    );
    notes.push(
      'In the configuration model the expected degree of an acquaintance is <k^2>/<k>, which exceeds <k> whenever ' +
        'degrees vary at all, and exceeds it enormously for a heavy-tailed distribution.',
    );
  } else if (strategy === 'random') {
    notes.push(
      `The immunised nodes have mean degree ${meanImmunised.toPrecision(4)}, essentially the graph average of ` +
        `${deg.meanDegree.value.toPrecision(4)} — which is the whole problem: on a heavy-tailed network the average ` +
        'node is not the node that matters.',
    );
  } else {
    notes.push(
      `The immunised nodes have mean degree ${meanImmunised.toPrecision(4)}, the highest available, but this ` +
        'strategy requires knowing every node\'s degree. For a contact or dependency network that information is ' +
        'usually not available, which is why the acquaintance strategy matters.',
    );
  }
  return {
    strategy,
    nodes,
    doses: nodes.length,
    meanDegreeImmunised: nq('Mean degree of immunised nodes', meanImmunised, 'exact'),
    meanDegreeOverall: deg.meanDegree,
    edgeEndpointShare: nq('Share of edge endpoints immunised', totalEndpoints > 0 ? covered / totalEndpoints : 0, 'exact', {
      note: 'The fraction of the network\'s transmission capacity removed, which predicts the effect far better than the dose count does.',
    }),
    notes,
  };
}

export interface InterventionComparison {
  doses: number;
  doseFraction: number;
  arms: {
    strategy: ImmunisationStrategy | 'none';
    immunisation: ImmunisationSet | null;
    ensemble: SpreadEnsembleResult;
    /** Expected infections per 100 nodes, counting extinctions as 0. */
    expectedInfectedPer100: NetworkQuantity;
  }[];
  /** Best (lowest expected infections) arm. */
  best: ImmunisationStrategy | 'none';
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

/**
 * Compare immunisation strategies at a fixed dose budget on the same network,
 * with the same seed stream for the epidemic simulations.
 *
 * The comparison statistic is the *unconditional* expected number infected —
 * extinction probability times zero plus takeoff probability times conditional
 * mean — because that is what a dose budget buys. The conditional takeoff
 * figures are kept in each arm's ensemble so the two are not confused.
 */
export function compareInterventions(
  g: Graph,
  params: SpreadParameters,
  doses: number,
  seed: string | number,
  options: { strategies?: (ImmunisationStrategy | 'none')[]; runs?: number } = {},
): InterventionComparison {
  const strategies = options.strategies ?? ['none', 'random', 'acquaintance', 'degree'];
  const runs = options.runs ?? 200;
  const v = new Validator();
  v.integer(doses, 'doses', 'Number of doses', 0, g.n - 1);
  v.integer(runs, 'runs', 'Runs per arm', 1, 1_000_000);
  v.throwIfInvalid();
  const arms: InterventionComparison['arms'] = [];
  for (const strategy of strategies) {
    const immunisation = strategy === 'none' ? null : chooseImmunisation(g, doses, strategy, `${seed}:imm:${strategy}`);
    const immune = immunisation ? immunisation.nodes : [];
    if (immune.length >= g.n) {
      throw new EngineError(
        `Strategy "${strategy}" would immunise all ${g.n} nodes, leaving nobody to seed an outbreak. Reduce the doses.`,
        'degenerate',
      );
    }
    // Seed the outbreak among the non-immune, with the same stream per arm so
    // the arms differ only by the intervention.
    const ensemble = runSpreadEnsemble(g, params, `${seed}:epi`, { runs, immune });
    const takeoffMean = ensemble.meanTakeoffSize ? ensemble.meanTakeoffSize.value : 0;
    const expected = (1 - ensemble.extinctionProbability.value) * takeoffMean + ensemble.extinctionProbability.value * meanOrZero(ensemble.distribution.extinctionSizes);
    arms.push({
      strategy,
      immunisation,
      ensemble,
      expectedInfectedPer100: nq('Expected infected per 100 nodes', (100 * expected) / g.n, 'empirical', {
        formula: 'P(takeoff) x E[size | takeoff] + P(extinction) x E[size | extinction], per 100 nodes',
        note: 'Unconditional, because a dose budget buys the unconditional outcome. The conditional-on-takeoff figure ' +
          'is in this arm\'s ensemble and is a different statement.',
      }),
    });
  }
  let best = arms[0];
  for (const a of arms) if (a.expectedInfectedPer100.value < best.expectedInfectedPer100.value) best = a;
  const deg = degreeSummary(g);
  const notes = [
    `${doses} doses (${((100 * doses) / g.n).toPrecision(3)}% of ${g.n} nodes), ${runs} epidemic runs per arm, same ` +
      'seed stream across arms so the arms differ only by who was immunised.',
    `Degree heterogeneity: <k> = ${deg.meanDegree.value.toPrecision(4)}, <k^2>/<k> = ` +
      `${(deg.secondMoment.value / Math.max(1e-12, deg.meanDegree.value)).toPrecision(4)}, k_max = ${deg.maxDegree.value}. ` +
      'The larger the gap between <k^2>/<k> and <k>, the more the acquaintance strategy beats random dosing.',
  ];
  const randomArm = arms.find((a) => a.strategy === 'random');
  const acqArm = arms.find((a) => a.strategy === 'acquaintance');
  if (randomArm && acqArm) {
    notes.push(
      `Acquaintance immunisation leaves ${acqArm.expectedInfectedPer100.value.toPrecision(4)} infected per 100 ` +
        `against ${randomArm.expectedInfectedPer100.value.toPrecision(4)} for random dosing at the same budget, ` +
        'using no network information either strategy could not obtain.',
    );
  }
  return {
    doses,
    doseFraction: doses / g.n,
    arms,
    best: best.strategy,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes,
    limitations: [
      'All arms are simulated on the SAME network. The ranking of strategies depends on the degree distribution, so ' +
        'it transfers to another network only to the extent the degree distribution does.',
      'Immunisation is assumed perfect and instantaneous, and uptake is assumed total. Partial efficacy scales the ' +
        'effect down; refusal concentrated among hubs would remove most of it.',
      'The acquaintance strategy assumes a nominated contact can actually be reached and will accept. That is an ' +
        'operational assumption, not a network property.',
    ],
  };
}

function meanOrZero(xs: ReadonlyArray<number>): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/**
 * The friendship paradox itself, measured: the mean degree of a node against
 * the mean degree of a randomly chosen neighbour.
 */
export function friendshipParadox(g: Graph): {
  meanDegree: NetworkQuantity;
  meanNeighbourDegree: NetworkQuantity;
  ratio: NetworkQuantity;
  configurationModelPrediction: NetworkQuantity;
  nodesWithFewerFriendsThanTheirFriends: NetworkQuantity;
  notes: string[];
  limitations: string[];
} {
  const deg = degreeSummary(g);
  const k1 = deg.meanDegree.value;
  const k2 = deg.secondMoment.value;
  if (k1 <= 0) {
    throw new EngineError(
      'Every node is isolated, so there are no neighbours whose degrees could be compared. The friendship paradox ' +
        'is undefined here.',
      'degenerate',
    );
  }
  // Mean degree over a uniformly chosen EDGE ENDPOINT, i.e. a random neighbour.
  let endpointSum = 0;
  let endpoints = 0;
  let below = 0;
  let withNeighbours = 0;
  for (let i = 0; i < g.n; i++) {
    const nbs = g.out[i];
    if (nbs.length === 0) continue;
    withNeighbours++;
    let s = 0;
    for (const j of nbs) {
      s += deg.degree[j];
      endpointSum += deg.degree[j];
      endpoints++;
    }
    if (s / nbs.length > deg.degree[i]) below++;
  }
  const meanNeighbour = endpoints > 0 ? endpointSum / endpoints : 0;
  return {
    meanDegree: deg.meanDegree,
    meanNeighbourDegree: nq('Mean degree of a random neighbour', meanNeighbour, 'exact', {
      formula: '(1/2m) sum_i k_i^2 — a degree-biased average, not a uniform one',
    }),
    ratio: nq('Neighbour-to-node degree ratio', meanNeighbour / k1, 'exact', {
      note: 'At least 1 for every graph, with equality only for a regular graph. It is a fact about averaging, not ' +
        'about popularity.',
    }),
    configurationModelPrediction: nq('Predicted <k^2>/<k>', k2 / k1, 'exact', {
      formula: '<k^2>/<k> = <k> + Var(k)/<k>',
      note: 'Exceeds <k> by exactly Var(k)/<k>. This is why the paradox is strongest where it matters most — on the ' +
        'heavy-tailed networks whose hubs carry epidemics.',
    }),
    nodesWithFewerFriendsThanTheirFriends: nq(
      'Fraction of nodes below their neighbours\' mean degree',
      withNeighbours > 0 ? below / withNeighbours : 0,
      'exact',
      { note: `Over the ${withNeighbours} non-isolated nodes.` },
    ),
    notes: [
      `A random node has ${k1.toPrecision(4)} neighbours; a random neighbour has ${meanNeighbour.toPrecision(4)}. ` +
        'The second number is a degree-biased average: a high-degree node is a neighbour of many nodes and so is ' +
        'sampled many times.',
    ],
    limitations: [
      'The ratio is computed on the supplied graph. It is a structural identity, so it is exact for this graph, but ' +
        'it says nothing about whether this graph is the real contact network.',
      'Isolated nodes are excluded from the neighbour average, because they have no neighbour to average over.',
    ],
  };
}
