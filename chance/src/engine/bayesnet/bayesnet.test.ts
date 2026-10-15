/**
 * Tests for the discrete Bayesian network module.
 *
 * Reference values are independent of the implementation: either hand-computed
 * with Bayes' theorem in a comment, the published parameters/qualitative
 * patterns of the standard networks, or produced by the brute-force enumerator
 * written below, which builds the full joint distribution directly from the
 * CPTs without touching the factor algebra, variable elimination or the
 * junction tree.
 */
import { describe, expect, it } from 'vitest';
import { EngineError } from '../core/result';
import type { DataRow } from './index';
import {
  BayesNet,
  NetworkSpec,
  allMarginals,
  buildJunctionTree,
  causalRoles,
  checkBackdoor,
  checkFrontdoor,
  dSeparated,
  evidenceProbability,
  exampleNetwork,
  findBackdoorAdjustmentSets,
  forwardSamplingMarginals,
  interventionDistribution,
  learnParameters,
  likelihoodWeighting,
  mapQuery,
  marginal,
  mostProbableExplanation,
  probabilityOf,
  query,
  sampleDataset,
  topologicalOrder,
} from './index';
import { EXAMPLE_NETWORK_SPECS } from './examples';

// ---------------------------------------------------------------------------
// Independent reference: brute-force enumeration of the full joint.
// ---------------------------------------------------------------------------

type Assignment = Map<string, number>;

/** Visit every complete assignment with its joint probability Π P(x | pa(x)). */
function forEachAssignment(net: BayesNet, visit: (states: Assignment, p: number) => void): void {
  const ids = net.nodes.map((n) => n.id);
  const cards = ids.map((id) => net.cardinality(id));
  const total = cards.reduce((a, b) => a * b, 1);
  for (let i = 0; i < total; i++) {
    let rest = i;
    const states: Assignment = new Map();
    for (let k = ids.length - 1; k >= 0; k--) {
      states.set(ids[k], rest % cards[k]);
      rest = Math.floor(rest / cards[k]);
    }
    let p = 1;
    for (const node of net.nodes) {
      let row = 0;
      for (const parent of node.parents) row = row * net.cardinality(parent) + states.get(parent)!;
      p *= node.cpt[row][states.get(node.id)!];
    }
    visit(states, p);
  }
}

function matches(states: Assignment, evidence: Record<string, number>): boolean {
  for (const [k, v] of Object.entries(evidence)) if (states.get(k) !== v) return false;
  return true;
}

/** P(evidence) by enumeration. */
function bruteEvidence(net: BayesNet, evidence: Record<string, number>): number {
  let total = 0;
  forEachAssignment(net, (states, p) => {
    if (matches(states, evidence)) total += p;
  });
  return total;
}

/** P(vars | evidence) by enumeration, as a flat table over `vars` (last fastest). */
function bruteJoint(net: BayesNet, vars: string[], evidence: Record<string, number> = {}): number[] {
  const cards = vars.map((v) => net.cardinality(v));
  const size = cards.reduce((a, b) => a * b, 1);
  const out = new Array<number>(size).fill(0);
  let total = 0;
  forEachAssignment(net, (states, p) => {
    if (!matches(states, evidence)) return;
    total += p;
    let idx = 0;
    for (let i = 0; i < vars.length; i++) idx = idx * cards[i] + states.get(vars[i])!;
    out[idx] += p;
  });
  if (!(total > 0)) throw new Error('brute force: zero-probability evidence');
  return out.map((x) => x / total);
}

/** The single most probable complete assignment by enumeration. */
function bruteArgmax(net: BayesNet, evidence: Record<string, number> = {}): { states: Assignment; p: number } {
  let best: Assignment = new Map();
  let bestP = -1;
  forEachAssignment(net, (states, p) => {
    if (!matches(states, evidence)) return;
    if (p > bestP) {
      bestP = p;
      best = new Map(states);
    }
  });
  return { states: best, p: bestP };
}

function expectClose(actual: number, expected: number, tol = 1e-12): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function stateOf(net: BayesNet, node: string, name: string): number {
  return net.stateIndex(node, name);
}

// ---------------------------------------------------------------------------

describe('factor algebra and network validation', () => {
  it('builds a network and exposes its structure', () => {
    const net = exampleNetwork('sprinkler');
    expect(net.nodes.map((n) => n.id).sort()).toEqual(['rain', 'sprinkler', 'wet']);
    expect(net.parentsOf('wet')).toEqual(['sprinkler', 'rain']);
    expect(net.childrenOf('rain')).toEqual(['wet']);
    expect(net.jointSize()).toBe(8);
  });

  it('gives the CPT back as a factor with the right entries', () => {
    const net = exampleNetwork('sprinkler');
    const f = net.factorOf('wet');
    expect(f.vars).toEqual(['wet', 'sprinkler', 'rain']);
    expect(f.card).toEqual([2, 2, 2]);
    // P(wet=yes | sprinkler=no, rain=yes) = 0.8 from the published table.
    const idx = 0 * 4 + 1 * 2 + 0; // wet=yes, sprinkler=no, rain=yes
    expectClose(f.values[idx], 0.8, 0);
  });

  it('rejects a CPT row that does not sum to 1, naming the node and row', () => {
    const spec: NetworkSpec = {
      name: 'bad',
      nodes: [
        { id: 'A', states: ['y', 'n'], cpt: [[0.5, 0.5]] },
        { id: 'B', states: ['y', 'n'], parents: ['A'], cpt: [[0.8, 0.2], [0.3, 0.3]] },
      ],
    };
    expect(() => BayesNet.from(spec)).toThrow(EngineError);
    try {
      BayesNet.from(spec);
      expect.unreachable('a malformed CPT must be rejected');
    } catch (e) {
      const err = e as EngineError;
      expect(err.message).toContain('"B"');
      expect(err.message).toContain('A=n');
      expect(err.message).toContain('sums to');
      expect(err.issues.some((i) => i.code === 'sum')).toBe(true);
    }
  });

  it('rejects a CPT with the wrong number of rows', () => {
    const spec: NetworkSpec = {
      name: 'bad shape',
      nodes: [
        { id: 'A', states: ['y', 'n'], cpt: [[0.5, 0.5]] },
        { id: 'B', states: ['y', 'n'], parents: ['A'], cpt: [[0.8, 0.2]] },
      ],
    };
    expect(() => BayesNet.from(spec)).toThrowError(/needs 2 CPT rows/);
  });

  it('rejects duplicate node ids and duplicate state names', () => {
    expect(() =>
      BayesNet.from({
        name: 'dup',
        nodes: [
          { id: 'A', states: ['y', 'y'], cpt: [[0.5, 0.5]] },
        ],
      }),
    ).toThrowError(/duplicate state "y"/i);
    expect(() =>
      BayesNet.from({
        name: 'dup',
        nodes: [
          { id: 'A', states: ['y', 'n'], cpt: [[0.5, 0.5]] },
          { id: 'A', states: ['y', 'n'], cpt: [[0.5, 0.5]] },
        ],
      }),
    ).toThrowError(/Duplicate node id "A"/);
  });

  it('rejects an unknown parent and an unknown state name in a query', () => {
    expect(() =>
      BayesNet.from({ name: 'x', nodes: [{ id: 'A', states: ['y', 'n'], parents: ['Q'], cpt: [[0.5, 0.5], [0.5, 0.5]] }] }),
    ).toThrowError(/unknown parent "Q"/);
    const net = exampleNetwork('sprinkler');
    expect(() => probabilityOf(net, 'rain', 'maybe')).toThrowError(/no state "maybe"/);
    expect(() => probabilityOf(net, 'thunder', 'yes')).toThrowError(/Unknown node "thunder"/);
  });
});

describe('cycle detection', () => {
  it('rejects a cyclic graph and names the cycle in order', () => {
    const spec: NetworkSpec = {
      name: 'cyclic',
      nodes: [
        { id: 'A', states: ['y', 'n'], parents: ['C'], cpt: [[0.5, 0.5], [0.5, 0.5]] },
        { id: 'B', states: ['y', 'n'], parents: ['A'], cpt: [[0.5, 0.5], [0.5, 0.5]] },
        { id: 'C', states: ['y', 'n'], parents: ['B'], cpt: [[0.5, 0.5], [0.5, 0.5]] },
      ],
    };
    try {
      BayesNet.from(spec);
      expect.unreachable('a cyclic graph must be rejected');
    } catch (e) {
      const err = e as EngineError;
      expect(err.issues[0].code).toBe('cycle');
      expect(err.message).toContain('must be acyclic');
      for (const n of ['A', 'B', 'C']) expect(err.message).toContain(n);
      // The cycle is reported as a closed walk.
      const arrow = err.message.match(/cycle ([A-Z -<>]+)\./);
      expect(arrow).not.toBeNull();
      const walk = arrow![1].split(' -> ');
      expect(walk[0]).toBe(walk[walk.length - 1]);
      expect(new Set(walk).size).toBe(3);
    }
  });

  it('rejects a self-loop', () => {
    expect(() =>
      BayesNet.from({ name: 's', nodes: [{ id: 'A', states: ['y', 'n'], parents: ['A'], cpt: [[1, 0], [1, 0]] }] }),
    ).toThrowError(/cannot be its own parent/);
  });

  it('gives a topological order in which parents precede children', () => {
    const net = exampleNetwork('asia');
    const r = topologicalOrder(net.graph);
    expect('order' in r).toBe(true);
    if (!('order' in r)) return;
    const position = new Map(r.order.map((id, i) => [id, i]));
    for (const n of net.nodes) {
      for (const p of n.parents) expect(position.get(p)!).toBeLessThan(position.get(n.id)!);
    }
  });
});

describe('hand-computed inference', () => {
  //  A -> B,  P(A=y) = 0.3,  P(B=y|A=y) = 0.8,  P(B=y|A=n) = 0.1
  //  P(B=y) = 0.3*0.8 + 0.7*0.1 = 0.24 + 0.07 = 0.31
  //  P(A=y|B=y) = 0.24 / 0.31 = 24/31
  const twoNode: NetworkSpec = {
    name: 'two node',
    nodes: [
      { id: 'A', states: ['y', 'n'], cpt: [[0.3, 0.7]] },
      { id: 'B', states: ['y', 'n'], parents: ['A'], cpt: [[0.8, 0.2], [0.1, 0.9]] },
    ],
  };

  //  ... -> C,  P(C=y|B=y) = 0.9, P(C=y|B=n) = 0.2
  //  P(C=y) = 0.31*0.9 + 0.69*0.2 = 0.279 + 0.138 = 0.417
  //  P(A=y, C=y) = 0.3 * (0.8*0.9 + 0.2*0.2) = 0.3 * 0.76 = 0.228
  //  P(A=y|C=y) = 0.228/0.417 = 76/139
  const threeNode: NetworkSpec = {
    name: 'three node chain',
    nodes: [
      ...twoNode.nodes,
      { id: 'C', states: ['y', 'n'], parents: ['B'], cpt: [[0.9, 0.1], [0.2, 0.8]] },
    ],
  };

  it('matches the hand-computed two-node answers', () => {
    const net = BayesNet.from(twoNode);
    expectClose(probabilityOf(net, 'B', 'y'), 0.31);
    expectClose(probabilityOf(net, 'A', 'y', { B: 'y' }), 24 / 31);
    expectClose(evidenceProbability(net, { B: 'y' }).probability, 0.31);
    expectClose(evidenceProbability(net, { A: 'y', B: 'y' }).probability, 0.24);
  });

  it('matches the hand-computed three-node chain answers', () => {
    const net = BayesNet.from(threeNode);
    expectClose(probabilityOf(net, 'C', 'y'), 0.417);
    expectClose(probabilityOf(net, 'A', 'y', { C: 'y' }), 76 / 139);
    // B screens off A from C: P(C=y | A=y, B=y) = P(C=y | B=y) = 0.9.
    expectClose(probabilityOf(net, 'C', 'y', { A: 'y', B: 'y' }), 0.9);
    expectClose(probabilityOf(net, 'C', 'y', { B: 'y' }), 0.9);
  });

  it('reports exactness and diagnostics for an exact query', () => {
    const net = BayesNet.from(threeNode);
    const r = query(net, ['A', 'C'], { B: 'y' });
    expect(r.exactness).toBe('exact');
    expect(r.diagnostics.method).toContain('Variable elimination');
    expect(r.diagnostics.largestFactorEntries).toBeGreaterThan(0);
    expect(r.diagnostics.inducedTreewidth).toBeGreaterThanOrEqual(0);
    // Joint over [A, C] given B=y must sum to 1.
    expectClose(Array.from(r.joint.values).reduce((a, b) => a + b, 0), 1);
  });
});

describe('explaining away in the burglary-earthquake-alarm network', () => {
  const net = exampleNetwork('alarm');

  it('shows the signature qualitative pattern', () => {
    const prior = probabilityOf(net, 'burglary', 'yes');
    const givenAlarm = probabilityOf(net, 'burglary', 'yes', { alarm: 'yes' });
    const givenBoth = probabilityOf(net, 'burglary', 'yes', { alarm: 'yes', earthquake: 'yes' });
    expectClose(prior, 0.001, 1e-15);
    expect(givenAlarm).toBeGreaterThan(prior);
    expect(givenBoth).toBeLessThan(givenAlarm);
    // Still above the prior: a burglary remains more likely than at baseline.
    expect(givenBoth).toBeGreaterThan(prior);
  });

  it('matches the enumerated posterior exactly', () => {
    const b = stateOf(net, 'burglary', 'yes');
    expectClose(
      probabilityOf(net, 'burglary', 'yes', { johnCalls: 'yes', maryCalls: 'yes' }),
      bruteJoint(net, ['burglary'], {
        johnCalls: stateOf(net, 'johnCalls', 'yes'),
        maryCalls: stateOf(net, 'maryCalls', 'yes'),
      })[b],
    );
  });

  it('d-separates burglary from earthquake marginally but not given the alarm', () => {
    const g = net.graph;
    expect(dSeparated(g, ['burglary'], ['earthquake'], []).separated).toBe(true);
    const given = dSeparated(g, ['burglary'], ['earthquake'], ['alarm']);
    expect(given.separated).toBe(false);
    expect(given.activePaths[0].description).toContain('alarm');
  });
});

describe('the sprinkler collider', () => {
  const net = exampleNetwork('sprinkler');
  const yes = (n: string): number => stateOf(net, n, 'yes');

  it('is independent marginally and dependent given wet grass, by d-separation', () => {
    const g = net.graph;
    expect(dSeparated(g, ['rain'], ['sprinkler'], []).separated).toBe(true);
    const given = dSeparated(g, ['rain'], ['sprinkler'], ['wet']);
    expect(given.separated).toBe(false);
    expect(given.activePaths[0].nodes).toEqual(['rain', 'wet', 'sprinkler']);
    expect(given.activePaths[0].reasons[0]).toContain('collider');
  });

  it('is independent marginally and dependent given wet grass, numerically', () => {
    // Marginal independence: P(rain | sprinkler) = P(rain) = 0.2 exactly.
    expectClose(probabilityOf(net, 'rain', 'yes', { sprinkler: 'yes' }), 0.2);
    expectClose(probabilityOf(net, 'rain', 'yes', { sprinkler: 'no' }), 0.2);
    // Hand computation of P(rain=yes | wet=yes):
    //  P(S=y,R=y,W=y) = 0.4*0.2*0.99 = 0.0792
    //  P(S=y,R=n,W=y) = 0.4*0.8*0.90 = 0.2880
    //  P(S=n,R=y,W=y) = 0.6*0.2*0.80 = 0.0960
    //  P(S=n,R=n,W=y) = 0
    //  P(W=y) = 0.4632 ; P(R=y|W=y) = 0.1752/0.4632
    expectClose(probabilityOf(net, 'wet', 'yes'), 0.4632);
    expectClose(probabilityOf(net, 'rain', 'yes', { wet: 'yes' }), 0.1752 / 0.4632);
    // Explaining away: the sprinkler accounts for the wet grass.
    expectClose(probabilityOf(net, 'rain', 'yes', { wet: 'yes', sprinkler: 'yes' }), 0.0792 / 0.3672);
    const givenWet = probabilityOf(net, 'rain', 'yes', { wet: 'yes' });
    const givenWetAndSprinkler = probabilityOf(net, 'rain', 'yes', { wet: 'yes', sprinkler: 'yes' });
    expect(givenWet).toBeGreaterThan(0.2);
    expect(givenWetAndSprinkler).toBeLessThan(givenWet);
    expect(yes('rain')).toBe(0);
  });
});

describe('d-separation against hand-derived truth', () => {
  const net = exampleNetwork('structures');
  const g = net.graph;

  it('blocks a chain only when the mediator is conditioned on', () => {
    // X1 -> M -> Y1
    expect(dSeparated(g, ['X1'], ['Y1'], []).separated).toBe(false);
    expect(dSeparated(g, ['X1'], ['Y1'], ['M']).separated).toBe(true);
  });

  it('blocks a fork only when the common cause is conditioned on', () => {
    // X1 <- U -> X2
    expect(dSeparated(g, ['X1'], ['X2'], []).separated).toBe(false);
    expect(dSeparated(g, ['X1'], ['X2'], ['U']).separated).toBe(true);
  });

  it('opens a collider only when the collider is conditioned on', () => {
    // X2 -> C <- W
    expect(dSeparated(g, ['X2'], ['W'], []).separated).toBe(true);
    expect(dSeparated(g, ['X2'], ['W'], ['C']).separated).toBe(false);
  });

  it('also opens a collider when only a DESCENDANT of the collider is conditioned on', () => {
    // C -> D: conditioning on D activates X2 -> C <- W even though C itself is
    // unobserved. This is the case that catches buggy implementations.
    const r = dSeparated(g, ['X2'], ['W'], ['D']);
    expect(r.separated).toBe(false);
    expect(r.activePaths[0].nodes).toEqual(['X2', 'C', 'W']);
    expect(r.activePaths[0].reasons[0]).toContain('collider');
  });

  it('matches hand-derived truth on a battery of combined cases', () => {
    const cases: { x: string[]; y: string[]; z: string[]; separated: boolean }[] = [
      { x: ['U'], y: ['M'], z: [], separated: false },
      { x: ['U'], y: ['M'], z: ['X1'], separated: true },
      { x: ['U'], y: ['Y1'], z: ['M'], separated: true },
      { x: ['W'], y: ['X1'], z: [], separated: true },
      { x: ['W'], y: ['X1'], z: ['C'], separated: false },
      { x: ['W'], y: ['X1'], z: ['C', 'U'], separated: true },
      { x: ['W'], y: ['U'], z: ['D'], separated: false },
      { x: ['W'], y: ['U'], z: ['D', 'X2'], separated: true },
      { x: ['D'], y: ['X2'], z: [], separated: false },
      { x: ['D'], y: ['X2'], z: ['C'], separated: true },
      { x: ['Y1'], y: ['X2'], z: ['U'], separated: true },
      { x: ['Y1'], y: ['X2'], z: [], separated: false },
    ];
    for (const c of cases) {
      const r = dSeparated(g, c.x, c.y, c.z);
      expect(
        r.separated,
        `{${c.x}} vs {${c.y}} given {${c.z}} should be ${c.separated ? 'separated' : 'dependent'} — ${r.explanation}`,
      ).toBe(c.separated);
    }
  });

  it('confirms each d-separation claim numerically', () => {
    // Independence implies P(x | y, z) = P(x | z) for every state combination.
    const checks: { x: string; y: string; z: Record<string, string> }[] = [
      { x: 'Y1', y: 'X1', z: { M: 'yes' } },
      { x: 'X2', y: 'X1', z: { U: 'yes' } },
      { x: 'X2', y: 'W', z: {} },
    ];
    for (const c of checks) {
      const withY = probabilityOf(net, c.x, 'yes', { ...c.z, [c.y]: 'yes' });
      const withoutY = probabilityOf(net, c.x, 'yes', c.z);
      expectClose(withY, withoutY);
    }
    // And dependence implies a difference: conditioning on the collider's
    // descendant D makes X2 and W dependent.
    const a = probabilityOf(net, 'X2', 'yes', { D: 'yes', W: 'yes' });
    const b = probabilityOf(net, 'X2', 'yes', { D: 'yes', W: 'no' });
    expect(Math.abs(a - b)).toBeGreaterThan(1e-3);
  });

  it('refuses overlapping or unknown sets instead of guessing', () => {
    expect(() => dSeparated(g, ['X1'], ['X1'], [])).toThrowError(/both X and Y/);
    expect(() => dSeparated(g, ['X1'], ['Y1'], ['X1'])).toThrowError(/both X and the conditioning set/);
    expect(() => dSeparated(g, ['nope'], ['Y1'], [])).toThrowError(/unknown node "nope"/);
  });

  it('computes the Markov blanket', () => {
    expect(net.markovBlanket('X2')).toEqual(['C', 'U', 'W']);
    expect(net.markovBlanket('M')).toEqual(['X1', 'Y1']);
    expect(exampleNetwork('asia').markovBlanket('either')).toEqual(['bronc', 'dysp', 'lung', 'tub', 'xray']);
  });
});

describe('all inference routes agree with brute-force enumeration', () => {
  for (const spec of EXAMPLE_NETWORK_SPECS) {
    it(`${spec.name}: marginals sum to 1 and match enumeration`, () => {
      const net = BayesNet.from(spec);
      const jt = allMarginals(net);
      for (const node of net.nodes) {
        const ve = marginal(net, node.id).probabilities;
        const bf = bruteJoint(net, [node.id]);
        const bp = jt.byNode[node.id];
        expectClose(ve.reduce((a, b) => a + b, 0), 1);
        expectClose(bp.reduce((a, b) => a + b, 0), 1);
        for (let i = 0; i < ve.length; i++) {
          expectClose(ve[i], bf[i]);
          expectClose(bp[i], bf[i]);
        }
      }
    });

    it(`${spec.name}: pairwise joints and P(evidence) match enumeration`, () => {
      const net = BayesNet.from(spec);
      const ids = net.nodes.map((n) => n.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const vars = [ids[i], ids[j]];
          const ve = Array.from(query(net, vars).joint.values);
          const bf = bruteJoint(net, vars);
          for (let k = 0; k < ve.length; k++) expectClose(ve[k], bf[k]);
        }
      }
      // Evidence on the first node, conditioning everything else.
      const ev = { [ids[0]]: 0 };
      const pe = bruteEvidence(net, ev);
      if (pe > 0) {
        expectClose(evidenceProbability(net, ev).probability, pe);
        const jt = allMarginals(net, ev);
        expectClose(jt.evidenceProbability, pe);
        for (const node of net.nodes) {
          const bf = bruteJoint(net, [node.id], ev);
          const ve = marginal(net, node.id, ev).probabilities;
          for (let k = 0; k < bf.length; k++) {
            expectClose(ve[k], bf[k]);
            expectClose(jt.byNode[node.id][k], bf[k]);
          }
        }
      }
    });
  }

  it('agrees with enumeration on a three-way query with evidence in the Asia network', () => {
    const net = exampleNetwork('asia');
    const ev = { xray: stateOf(net, 'xray', 'yes'), dysp: stateOf(net, 'dysp', 'yes') };
    const vars = ['tub', 'lung', 'bronc'];
    const ve = Array.from(query(net, vars, ev).joint.values);
    const bf = bruteJoint(net, vars, ev);
    for (let i = 0; i < ve.length; i++) expectClose(ve[i], bf[i]);
    expectClose(evidenceProbability(net, ev).probability, bruteEvidence(net, ev));
  });

  it('builds a junction tree that covers every CPT scope', () => {
    for (const spec of EXAMPLE_NETWORK_SPECS) {
      const net = BayesNet.from(spec);
      const tree = buildJunctionTree(net);
      expect(tree.edges.length).toBe(tree.cliques.length - 1);
      for (const node of net.nodes) {
        const scope = [node.id, ...node.parents];
        expect(
          tree.cliques.some((c) => scope.every((v) => c.includes(v))),
          `no clique covers ${scope.join(',')} in ${spec.name}`,
        ).toBe(true);
      }
      expect(tree.treewidth).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives the same answer with the min-degree ordering heuristic', () => {
    const net = exampleNetwork('asia');
    const ev = { dysp: stateOf(net, 'dysp', 'yes') };
    for (const node of net.nodes) {
      const a = marginal(net, node.id, ev, { heuristic: 'min-fill' }).probabilities;
      const b = marginal(net, node.id, ev, { heuristic: 'min-degree' }).probabilities;
      for (let i = 0; i < a.length; i++) expectClose(a[i], b[i]);
    }
  });
});

describe('size limits and refusals', () => {
  it('refuses a query whose intermediate table exceeds the limit', () => {
    const net = exampleNetwork('asia');
    try {
      query(net, ['dysp'], undefined, { maxFactorEntries: 4 });
      expect.unreachable('an over-sized query must be refused');
    } catch (e) {
      const err = e as EngineError;
      expect(err.issues[0].code).toBe('size');
      expect(err.message).toContain('limit of 4');
      expect(err.message).toContain('maxFactorEntries');
    }
  });

  it('refuses junction-tree inference over the limit too', () => {
    expect(() => allMarginals(exampleNetwork('asia'), undefined, { maxFactorEntries: 2 })).toThrowError(/limit of 2/);
  });

  it('refuses zero-probability evidence rather than dividing by zero', () => {
    // "either" is a deterministic OR, so tuberculosis=no and lung cancer=no
    // with either=yes is logically impossible.
    const net = exampleNetwork('asia');
    const ev = { tub: 'no', lung: 'no', either: 'yes' } as const;
    expect(bruteEvidence(net, {
      tub: stateOf(net, 'tub', 'no'),
      lung: stateOf(net, 'lung', 'no'),
      either: stateOf(net, 'either', 'yes'),
    })).toBe(0);
    for (const run of [
      () => query(net, ['xray'], ev),
      () => evidenceProbability(net, ev),
      () => allMarginals(net, ev),
      () => mostProbableExplanation(net, ev),
    ]) {
      try {
        run();
        expect.unreachable('zero-probability evidence must be refused');
      } catch (e) {
        const err = e as EngineError;
        expect(err).toBeInstanceOf(EngineError);
        expect(err.message).toMatch(/probability 0|total probability/);
      }
    }
  });

  it('refuses empty and contradictory requests', () => {
    const net = exampleNetwork('sprinkler');
    expect(() => query(net, [])).toThrowError(/at least one variable/);
    expect(() => query(net, ['rain', 'rain'])).toThrowError(/more than once/);
    expect(() => mapQuery(net, ['rain'], { rain: 'yes' })).toThrowError(/both observed and queried/);
    expect(() => net.intervene({})).toThrowError(/at least one node/);
  });
});

describe('MPE and MAP', () => {
  it('matches the brute-force argmax over the joint, with and without evidence', () => {
    for (const spec of EXAMPLE_NETWORK_SPECS) {
      const net = BayesNet.from(spec);
      const mpe = mostProbableExplanation(net);
      const brute = bruteArgmax(net);
      expectClose(mpe.jointProbability, brute.p);
      for (const node of net.nodes) {
        expect(mpe.indices[node.id], `${spec.name}/${node.id}`).toBe(brute.states.get(node.id));
      }
    }
  });

  it('matches the brute-force argmax under evidence in the Asia network', () => {
    const net = exampleNetwork('asia');
    const ev = { xray: 'yes', dysp: 'yes' } as const;
    const evIdx = { xray: stateOf(net, 'xray', 'yes'), dysp: stateOf(net, 'dysp', 'yes') };
    const mpe = mostProbableExplanation(net, ev);
    const brute = bruteArgmax(net, evIdx);
    expectClose(mpe.jointProbability, brute.p);
    for (const node of net.nodes) {
      if (node.id in evIdx) continue;
      expect(mpe.indices[node.id], node.id).toBe(brute.states.get(node.id));
    }
    expectClose(mpe.evidenceProbability, bruteEvidence(net, evIdx));
    expectClose(mpe.conditionalProbability, brute.p / bruteEvidence(net, evIdx));
    expect(mpe.exactness).toBe('exact');
  });

  it('answers a MAP query by summing out the other variables', () => {
    const net = exampleNetwork('asia');
    const ev = { xray: 'yes' } as const;
    const evIdx = { xray: stateOf(net, 'xray', 'yes') };
    const vars = ['tub', 'lung'];
    const map = mapQuery(net, vars, ev);
    // Independent reference: enumerate P(tub, lung, xray=yes) directly.
    const table = bruteJoint(net, vars, evIdx);
    let bestIdx = 0;
    for (let i = 1; i < table.length; i++) if (table[i] > table[bestIdx]) bestIdx = i;
    const expected = [Math.floor(bestIdx / net.cardinality('lung')), bestIdx % net.cardinality('lung')];
    expect([map.indices.tub, map.indices.lung]).toEqual(expected);
    expectClose(map.conditionalProbability, table[bestIdx]);
  });
});

describe('the do-operator differs from conditioning', () => {
  const net = exampleNetwork('confounded-treatment');

  it('shows the confounded difference and matches the back-door formula', () => {
    const comparison = interventionDistribution(net, 'treatment', 'treated', 'recovery');
    const recovered = stateOf(net, 'recovery', 'recovered');
    expect(comparison.confounded).toBe(true);
    expect(comparison.agree).toBe(false);
    expect(comparison.maxAbsoluteDifference).toBeGreaterThan(0.05);

    // Hand computation. P(health) = (0.5, 0.5) and
    //   P(rec | treated, good) = 0.95, P(rec | treated, poor) = 0.60
    // so P(rec | do(treated)) = 0.5*0.95 + 0.5*0.60 = 0.775, whereas
    //   P(health=good | treated) = 0.4/0.5 = 0.8
    // so P(rec | treated) = 0.8*0.95 + 0.2*0.60 = 0.88.
    expectClose(comparison.intervention[recovered], 0.775);
    expectClose(comparison.conditioning[recovered], 0.88);

    // Independent back-door adjustment computed here from enumeration:
    //   Σ_z P(Y | X=treated, Z=z) · P(Z=z)
    const treated = stateOf(net, 'treatment', 'treated');
    const pz = bruteJoint(net, ['health']);
    let adjusted = 0;
    for (let z = 0; z < net.cardinality('health'); z++) {
      adjusted += bruteJoint(net, ['recovery'], { treatment: treated, health: z })[recovered] * pz[z];
    }
    expectClose(comparison.intervention[recovered], adjusted);
    expect(comparison.explanation).toContain('back-door');
  });

  it('agrees with conditioning when there is no back-door path', () => {
    const chain = exampleNetwork('diagnosis-chain');
    const c = interventionDistribution(chain, 'infection', 'yes', 'fever');
    expect(c.confounded).toBe(false);
    expect(c.agree).toBe(true);
    expectClose(c.intervention[0], c.conditioning[0]);
  });

  it('cuts incoming edges only: do(X) leaves the parents at their prior', () => {
    const surgical = net.intervene({ treatment: 'treated' });
    expect(surgical.parentsOf('treatment')).toEqual([]);
    expectClose(probabilityOf(surgical, 'health', 'good'), 0.5);
    expectClose(probabilityOf(surgical, 'treatment', 'treated'), 1);
    // The intervened network is itself a validated network.
    expect(() => allMarginals(surgical)).not.toThrow();
  });
});

describe('back-door and front-door criteria', () => {
  const net = exampleNetwork('confounded-treatment');

  it('finds a valid minimal adjustment set', () => {
    const search = findBackdoorAdjustmentSets(net, 'treatment', 'recovery');
    expect(search.identifiable).toBe(true);
    expect(search.emptySetSufficient).toBe(false);
    expect(search.minimalSets).toEqual([['health']]);
    expect(checkBackdoor(net, 'treatment', 'recovery', ['health']).valid).toBe(true);
  });

  it('rejects the empty set, a collider and a descendant of the treatment', () => {
    const empty = checkBackdoor(net, 'treatment', 'recovery', []);
    expect(empty.valid).toBe(false);
    expect(empty.reasons[0]).toContain('back-door path');

    const collider = checkBackdoor(net, 'treatment', 'recovery', ['health', 'followUp']);
    expect(collider.valid).toBe(false);
    expect(collider.reasons.join(' ')).toContain('descendant of the treatment');

    const descendant = checkBackdoor(net, 'treatment', 'recovery', ['health', 'sideEffect']);
    expect(descendant.valid).toBe(false);

    expect(checkBackdoor(net, 'treatment', 'recovery', ['treatment']).valid).toBe(false);
    expect(checkBackdoor(net, 'treatment', 'recovery', ['recovery']).valid).toBe(false);
  });

  it('reports the empty set when no adjustment is needed', () => {
    const chain = exampleNetwork('diagnosis-chain');
    const search = findBackdoorAdjustmentSets(chain, 'infection', 'test');
    expect(search.emptySetSufficient).toBe(true);
    expect(search.minimalSets).toEqual([[]]);
  });

  it('identifies confounders, mediators and colliders, and warns about collider bias', () => {
    const roles = causalRoles(net, 'treatment', 'recovery');
    expect(roles.confounders).toEqual(['health']);
    expect(roles.colliders).toContain('followUp');
    expect(roles.mediators).toEqual([]);
    expect(roles.treatmentDescendants).toContain('sideEffect');
    expect(roles.openBackdoorPaths.length).toBeGreaterThan(0);
    expect(roles.warnings.join(' ')).toContain('CREATES a dependence');

    const chainRoles = causalRoles(exampleNetwork('diagnosis-chain'), 'exposure', 'test');
    expect(chainRoles.mediators).toEqual(['fever', 'infection']);
    expect(chainRoles.confounders).toEqual([]);
    expect(chainRoles.openBackdoorPaths).toEqual([]);
  });

  it('demonstrates collider bias numerically: conditioning on a collider creates dependence', () => {
    // health and sideEffect are d-separated given nothing but become dependent
    // given followUp, which is a common effect downstream of both.
    const g = net.graph;
    expect(dSeparated(g, ['health'], ['sideEffect'], []).separated).toBe(false); // via treatment
    const condOnCollider = probabilityOf(net, 'recovery', 'recovered', { treatment: 'treated', followUp: 'yes' });
    const noCollider = probabilityOf(net, 'recovery', 'recovered', { treatment: 'treated' });
    expect(Math.abs(condOnCollider - noCollider)).toBeGreaterThan(1e-3);
    // And adjusting for the collider is correctly refused as inadmissible.
    expect(checkBackdoor(net, 'treatment', 'recovery', ['health', 'followUp']).valid).toBe(false);
  });

  it('checks the front-door criterion on a confounded chain', () => {
    //  U -> X,  U -> Y,  X -> Z,  Z -> Y
    const spec: NetworkSpec = {
      name: 'front door',
      nodes: [
        { id: 'U', states: ['y', 'n'], cpt: [[0.4, 0.6]] },
        { id: 'X', states: ['y', 'n'], parents: ['U'], cpt: [[0.7, 0.3], [0.2, 0.8]] },
        { id: 'Z', states: ['y', 'n'], parents: ['X'], cpt: [[0.8, 0.2], [0.1, 0.9]] },
        {
          id: 'Y',
          states: ['y', 'n'],
          parents: ['Z', 'U'],
          cpt: [
            [0.9, 0.1],
            [0.6, 0.4],
            [0.4, 0.6],
            [0.05, 0.95],
          ],
        },
      ],
    };
    const fd = BayesNet.from(spec);
    const good = checkFrontdoor(fd, 'X', 'Y', ['Z']);
    expect(good.valid, good.reasons.join(' ')).toBe(true);
    // U is not a mediator: it does not intercept the directed path X -> Z -> Y.
    expect(checkFrontdoor(fd, 'X', 'Y', ['U']).valid).toBe(false);
    expect(checkFrontdoor(fd, 'X', 'Y', []).valid).toBe(false);
    // The back-door criterion is also satisfied here by {U}, since U is observed.
    expect(checkBackdoor(fd, 'X', 'Y', ['U']).valid).toBe(true);
    // In the sprinkler network nothing mediates rain -> wet other than nothing,
    // so the front-door criterion must fail.
    const sp = exampleNetwork('sprinkler');
    expect(checkFrontdoor(sp, 'rain', 'wet', ['sprinkler']).valid).toBe(false);
  });
});

describe('sampling', () => {
  it('forward sampling converges to the exact marginals (200,000 draws, fixed seed)', () => {
    const net = exampleNetwork('sprinkler');
    const n = 200_000;
    const sampled = forwardSamplingMarginals(net, n, 'bayesnet-forward-1');
    expect(sampled.exactness).toBe('empirical');
    for (const node of net.nodes) {
      const exact = marginal(net, node.id).probabilities;
      const est = sampled.byNode[node.id];
      expectClose(est.reduce((a, b) => a + b, 0), 1, 1e-12);
      for (let i = 0; i < exact.length; i++) {
        // 4 standard errors of a binomial proportion: ~1 in 15,000 chance of a
        // false failure per assertion, and the seed is fixed anyway.
        const se = Math.sqrt((exact[i] * (1 - exact[i])) / n);
        expect(Math.abs(est[i] - exact[i]), `${node.id} state ${i}`).toBeLessThan(4 * se + 1e-12);
      }
    }
  });

  it('forward sampling converges on the Asia network too', () => {
    const net = exampleNetwork('asia');
    const n = 200_000;
    const sampled = forwardSamplingMarginals(net, n, 'bayesnet-forward-asia');
    for (const node of net.nodes) {
      const exact = marginal(net, node.id).probabilities;
      const est = sampled.byNode[node.id];
      for (let i = 0; i < exact.length; i++) {
        const se = Math.sqrt((Math.max(exact[i], 1 / n) * (1 - exact[i])) / n);
        expect(Math.abs(est[i] - exact[i]), `${node.id} state ${i}`).toBeLessThan(4 * se + 1e-12);
      }
    }
  });

  it('likelihood weighting converges to the exact conditional marginals', () => {
    const net = exampleNetwork('asia');
    const ev = { xray: 'yes', dysp: 'yes' } as const;
    const n = 200_000;
    const lw = likelihoodWeighting(net, ev, n, 'bayesnet-lw-1');
    expect(lw.exactness).toBe('empirical');
    expect(lw.effectiveSampleSize).toBeGreaterThan(0);
    expect(lw.effectiveSampleSize).toBeLessThanOrEqual(n);
    expect(lw.efficiency).toBeGreaterThan(0);
    const pe = evidenceProbability(net, ev).probability;
    expect(Math.abs(lw.evidenceProbabilityEstimate - pe)).toBeLessThan(0.01);
    for (const node of net.nodes) {
      const exact = marginal(net, node.id, ev).probabilities;
      const est = lw.byNode[node.id];
      for (let i = 0; i < exact.length; i++) {
        const se = Math.sqrt((Math.max(exact[i], 1e-4) * (1 - exact[i])) / lw.effectiveSampleSize);
        expect(Math.abs(est[i] - exact[i]), `${node.id} state ${i}`).toBeLessThan(5 * se + 1e-3);
      }
    }
    // Evidence nodes come back as point masses.
    expectClose(lw.byNode.xray[stateOf(net, 'xray', 'yes')], 1, 1e-12);
  });

  it('reports a degenerate effective sample size instead of pretending the estimate is good', () => {
    const net = exampleNetwork('alarm');
    // The alarm almost never goes off, so the handful of samples that contain a
    // burglary or an earthquake carry nearly all of the weight.
    const n = 20_000;
    const lw = likelihoodWeighting(net, { alarm: 'yes' }, n, 'bayesnet-lw-degenerate');
    expect(lw.effectiveSampleSize).toBeLessThan(n / 100);
    expect(lw.warnings.length).toBeGreaterThan(0);
    expect(lw.warnings.join(' ')).toContain('effective sample size');
  });

  it('refuses impossible evidence and bad sample counts', () => {
    const net = exampleNetwork('asia');
    expect(() => likelihoodWeighting(net, { tub: 'no', lung: 'no', either: 'yes' }, 1000, 's')).toThrowError(
      /weight 0|probability 0/,
    );
    expect(() => likelihoodWeighting(net, { xray: 'yes' }, 0, 's')).toThrowError(/positive whole number/);
    expect(() => likelihoodWeighting(net, {}, 10, 's')).toThrowError(/at least one observed variable/);
    expect(() => forwardSamplingMarginals(net, -5, 's')).toThrowError(/positive whole number/);
  });

  it('is reproducible for a fixed seed and different for another', () => {
    const net = exampleNetwork('sprinkler');
    const a = forwardSamplingMarginals(net, 5000, 'seed-a').byNode.rain[0];
    const b = forwardSamplingMarginals(net, 5000, 'seed-a').byNode.rain[0];
    const c = forwardSamplingMarginals(net, 5000, 'seed-b').byNode.rain[0];
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('parameter learning', () => {
  it('recovers the generating CPTs from 100,000 forward samples', () => {
    const net = exampleNetwork('confounded-treatment');
    const data = sampleDataset(net, 100_000, 'bayesnet-learn-1');
    const learned = learnParameters(net, data);
    expect(learned.exactness).toBe('empirical');
    expect(learned.observations).toBe(100_000);
    expect(learned.alpha).toBe(0);
    expect(learned.method).toContain('Maximum likelihood');

    const rowsByKey = new Map(learned.rows.map((r) => [`${r.node}|${r.rowIndex}`, r]));
    for (const node of net.nodes) {
      for (let r = 0; r < node.cpt.length; r++) {
        const report = rowsByKey.get(`${node.id}|${r}`)!;
        expect(report.count).toBeGreaterThan(0);
        for (let s = 0; s < node.states.length; s++) {
          const p = node.cpt[r][s];
          const se = Math.sqrt((Math.max(p, 1e-6) * (1 - p)) / report.count);
          expect(
            Math.abs(report.probabilities[s] - p),
            `${node.id} row ${r} state ${s} (n=${report.count})`,
          ).toBeLessThan(5 * se + 1e-9);
        }
      }
    }
    // Every learned row is a distribution.
    for (const row of learned.rows) expectClose(row.probabilities.reduce((a, b) => a + b, 0), 1, 1e-12);
    // Inference on the learned network tracks inference on the generator.
    const exact = probabilityOf(net, 'recovery', 'recovered', { treatment: 'treated' });
    const fromData = probabilityOf(learned.network, 'recovery', 'recovered', { treatment: 'treated' });
    expect(Math.abs(fromData - exact)).toBeLessThan(0.01);
  });

  it('reports per-row sample counts so sparse rows are visible', () => {
    const net = exampleNetwork('alarm');
    const data = sampleDataset(net, 20_000, 'bayesnet-learn-sparse');
    const learned = learnParameters(net, data, { alpha: 1 });
    expect(learned.method).toContain('Dirichlet(1)');
    const alarmRows = learned.rows.filter((r) => r.node === 'alarm');
    expect(alarmRows.length).toBe(4);
    // Burglary and earthquake are both rare, so the (yes, yes) row is backed by
    // essentially no data and the report must say so.
    const rare = alarmRows.find((r) => r.parentConfiguration === 'burglary=yes, earthquake=yes')!;
    expect(rare.count).toBeLessThan(10);
    expect(learned.sparseRows.concat(learned.emptyRows).some((r) => r === rare)).toBe(true);
    expect(learned.warnings.join(' ')).toMatch(/fewer than 10 observations|no observations/);
    // Laplace smoothing keeps every row a proper distribution.
    for (const row of learned.rows) expectClose(row.probabilities.reduce((a, b) => a + b, 0), 1, 1e-12);
  });

  it('refuses maximum likelihood on a row with no observations instead of guessing', () => {
    const net = exampleNetwork('alarm');
    const data = [
      { burglary: 'no', earthquake: 'no', alarm: 'no', johnCalls: 'no', maryCalls: 'no' },
      { burglary: 'no', earthquake: 'no', alarm: 'yes', johnCalls: 'yes', maryCalls: 'no' },
    ];
    try {
      learnParameters(net, data);
      expect.unreachable('an unobserved CPT row has no maximum-likelihood estimate');
    } catch (e) {
      const err = e as EngineError;
      expect(err.issues[0].code).toBe('insufficient-data');
      expect(err.message).toContain('alarm');
      expect(err.message).toContain('burglary=yes');
    }
    // With a prior it is estimable, and the affected rows are flagged.
    const smoothed = learnParameters(net, data, { alpha: 1 });
    expect(smoothed.emptyRows.length).toBeGreaterThan(0);
    expect(smoothed.warnings.join(' ')).toContain('carry no information from the data');
    for (const row of smoothed.emptyRows) {
      for (const p of row.probabilities) expectClose(p, 1 / row.probabilities.length, 1e-12);
    }
  });

  it('refuses incomplete data unless told to skip it', () => {
    const net = exampleNetwork('sprinkler');
    const data: DataRow[] = [
      { rain: 'yes', sprinkler: 'yes', wet: 'yes' },
      { rain: 'yes', sprinkler: 'yes' },
    ];
    expect(() => learnParameters(net, data, { alpha: 1 })).toThrowError(/missing a value/);
    const skipped = learnParameters(net, data, { alpha: 1, skipIncomplete: true });
    expect(skipped.observations).toBe(1);
    expect(skipped.skipped).toBe(1);
    expect(() => learnParameters(net, [], { alpha: 1 })).toThrowError(/at least one data row/);
    expect(() => learnParameters(net, data, { alpha: -1 })).toThrowError(/0 or greater/);
    expect(() =>
      learnParameters(net, [{ rain: 'yes', sprinkler: 'yes', wet: 'damp' }], { alpha: 1 }),
    ).toThrowError(/no state "damp"/);
  });
});
