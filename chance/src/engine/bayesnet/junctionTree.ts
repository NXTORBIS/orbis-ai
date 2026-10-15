/**
 * Junction-tree (clique-tree) belief propagation: all node marginals from two
 * passes of message passing instead of one variable-elimination run per node.
 *
 * Messages use the Shafer-Shenoy scheme — each message is recomputed as the
 * product of the clique potential and every *other* incoming message — rather
 * than the HUGIN divide-by-separator scheme. That avoids dividing by zero when
 * evidence makes separator entries exactly 0, which is precisely the case the
 * engine must never turn into NaN.
 *
 * Construction: moralise, triangulate with the greedy min-fill ordering, take
 * the maximal cliques of the triangulated graph, and join them with a maximum
 * spanning tree on separator size (Jensen & Jensen 1994) — which satisfies the
 * running-intersection property for cliques obtained this way.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import {
  Factor,
  factorTotal,
  marginalizeTo,
  multiplyAll,
  tableSize,
} from './factor';
import { greedyEliminationOrder, moralGraph } from './graph';
import { BayesNet, Evidence } from './network';
import { DEFAULT_MAX_FACTOR_ENTRIES, InferenceDiagnostics, InferenceOptions, MarginalDistribution } from './inference';

interface Clique {
  readonly vars: string[];
  readonly card: number[];
}

export interface JunctionTreeStructure {
  cliques: string[][];
  /** Tree edges as clique index pairs, with their separator variables. */
  edges: { a: number; b: number; separator: string[] }[];
  treewidth: number;
  largestCliqueEntries: number;
}

export interface AllMarginalsResult {
  marginals: MarginalDistribution[];
  /** Keyed by node id for convenience. */
  byNode: Record<string, number[]>;
  evidenceProbability: number;
  exactness: Exactness;
  structure: JunctionTreeStructure;
  diagnostics: InferenceDiagnostics;
}

/** Build the clique tree of a network (independent of any evidence). */
export function buildJunctionTree(net: BayesNet, options: InferenceOptions = {}): JunctionTreeStructure {
  const heuristic = options.heuristic ?? 'min-fill';
  const adj = moralGraph(net.graph);
  const { cliques: raw, inducedWidth } = greedyEliminationOrder(adj, net.nodes.map((n) => n.id), heuristic);
  // Keep only maximal cliques.
  const sets = raw.map((c) => new Set(c));
  const keep: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    let subsumed = false;
    for (let j = 0; j < sets.length && !subsumed; j++) {
      if (i === j) continue;
      if (sets[i].size > sets[j].size) continue;
      if (sets[i].size === sets[j].size && j > i) continue;
      let inside = true;
      for (const v of sets[i]) if (!sets[j].has(v)) { inside = false; break; }
      if (inside) subsumed = true;
    }
    if (!subsumed) keep.push(i);
  }
  const cliques = keep.map((i) => [...sets[i]].sort());

  // Maximum spanning tree over separator sizes (Kruskal).
  const candidates: { a: number; b: number; separator: string[] }[] = [];
  for (let i = 0; i < cliques.length; i++) {
    for (let j = i + 1; j < cliques.length; j++) {
      const sep = cliques[i].filter((v) => cliques[j].includes(v));
      candidates.push({ a: i, b: j, separator: sep });
    }
  }
  candidates.sort((x, y) => y.separator.length - x.separator.length);
  const parentOf = cliques.map((_, i) => i);
  const find = (x: number): number => {
    let r = x;
    while (parentOf[r] !== r) r = parentOf[r];
    let c = x;
    while (parentOf[c] !== c) {
      const next = parentOf[c];
      parentOf[c] = r;
      c = next;
    }
    return r;
  };
  const edges: { a: number; b: number; separator: string[] }[] = [];
  for (const e of candidates) {
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra === rb) continue;
    parentOf[ra] = rb;
    edges.push(e);
    if (edges.length === cliques.length - 1) break;
  }
  if (cliques.length > 1 && edges.length !== cliques.length - 1) {
    throw new EngineError(
      `Could not connect the clique tree for "${net.name}": ${cliques.length} cliques but only ${edges.length} ` +
        `edges. The network's moral graph appears to be disconnected in an unexpected way.`,
      'internal',
    );
  }
  let largest = 1;
  for (const c of cliques) largest = Math.max(largest, tableSize(c.map((v) => net.cardinality(v))));
  return { cliques, edges, treewidth: inducedWidth, largestCliqueEntries: largest };
}

/**
 * All node marginals at once, given evidence. Exact.
 *
 * Evidence enters as indicator factors rather than by restricting scopes, so
 * observed nodes come back as point masses and P(evidence) is the total mass of
 * any calibrated clique.
 */
export function allMarginals(
  net: BayesNet,
  evidence?: Evidence,
  options: InferenceOptions = {},
): AllMarginalsResult {
  const maxEntries = options.maxFactorEntries ?? DEFAULT_MAX_FACTOR_ENTRIES;
  const ev = net.resolveEvidence(evidence);
  const structure = buildJunctionTree(net, options);
  if (structure.largestCliqueEntries > maxEntries) {
    const worst = structure.cliques.reduce(
      (acc, c) => (tableSize(c.map((v) => net.cardinality(v))) > tableSize(acc.map((v) => net.cardinality(v))) ? c : acc),
      structure.cliques[0],
    );
    throw new EngineError(
      `Junction-tree inference on "${net.name}" needs a clique table of ${structure.largestCliqueEntries} entries ` +
        `over [${worst.join(', ')}], over the configured limit of ${maxEntries}. Raise maxFactorEntries or use ` +
        `likelihood-weighted sampling instead.`,
      'size',
    );
  }

  const cliques: Clique[] = structure.cliques.map((vars) => ({ vars, card: vars.map((v) => net.cardinality(v)) }));
  const potentials: Factor[][] = cliques.map(() => []);
  const assign = (f: Factor): void => {
    for (let i = 0; i < cliques.length; i++) {
      if (f.vars.every((v) => cliques[i].vars.includes(v))) {
        potentials[i].push(f);
        return;
      }
    }
    throw new EngineError(
      `No clique contains the scope [${f.vars.join(', ')}]; the clique tree is not a valid cover of the network.`,
      'internal',
    );
  };
  for (const n of net.nodes) assign(net.factorOf(n.id));
  for (const f of net.evidenceFactors(ev)) assign(f);

  const psi: Factor[] = cliques.map((c, i) => {
    const ones: Factor = { vars: c.vars, card: c.card, values: new Float64Array(tableSize(c.card)).fill(1) };
    return multiplyAll([ones, ...potentials[i]], maxEntries);
  });

  // Root the tree and build an ordering from the root outwards.
  const neighbours: { to: number; separator: string[] }[][] = cliques.map(() => []);
  for (const e of structure.edges) {
    neighbours[e.a].push({ to: e.b, separator: e.separator });
    neighbours[e.b].push({ to: e.a, separator: e.separator });
  }
  const parent = new Array<number>(cliques.length).fill(-1);
  const bfs: number[] = [0];
  const visited = new Array<boolean>(cliques.length).fill(false);
  visited[0] = true;
  for (let head = 0; head < bfs.length; head++) {
    const n = bfs[head];
    for (const { to } of neighbours[n]) {
      if (visited[to]) continue;
      visited[to] = true;
      parent[to] = n;
      bfs.push(to);
    }
  }

  const messages = new Map<string, Factor>();
  const key = (from: number, to: number): string => `${from}->${to}`;
  const separatorOf = (from: number, to: number): string[] => {
    const e = neighbours[from].find((x) => x.to === to);
    if (!e) throw new EngineError('Internal clique-tree error: missing separator.', 'internal');
    return e.separator;
  };
  const sendMessage = (from: number, to: number): void => {
    const incoming: Factor[] = [];
    for (const { to: other } of neighbours[from]) {
      if (other === to) continue;
      const m = messages.get(key(other, from));
      if (!m) throw new EngineError('Internal clique-tree error: message order violated.', 'internal');
      incoming.push(m);
    }
    const product = multiplyAll([psi[from], ...incoming], maxEntries);
    messages.set(key(from, to), marginalizeTo(product, separatorOf(from, to)));
  };

  // Collect: children before parents (reverse BFS order).
  for (let i = bfs.length - 1; i >= 1; i--) sendMessage(bfs[i], parent[bfs[i]]);
  // Distribute: parents before children.
  for (let i = 1; i < bfs.length; i++) sendMessage(parent[bfs[i]], bfs[i]);

  const beliefs = cliques.map((_, i) => {
    const incoming: Factor[] = [];
    for (const { to: other } of neighbours[i]) incoming.push(messages.get(key(other, i))!);
    return multiplyAll([psi[i], ...incoming], maxEntries);
  });
  const total = factorTotal(beliefs[0]);
  if (!(total > 0)) {
    const described = [...ev].map(([id, s]) => `${id}=${net.stateName(id, s)}`).join(', ');
    throw new EngineError(
      ev.size
        ? `The evidence {${described}} has probability 0 under this model, so no conditional distribution exists.`
        : `The network "${net.name}" assigns total probability 0, which cannot happen for a validated model.`,
      'zero-probability',
    );
  }

  const byNode: Record<string, number[]> = {};
  const marginals: MarginalDistribution[] = [];
  for (const n of net.nodes) {
    let pick = -1;
    for (let i = 0; i < cliques.length; i++) {
      if (!cliques[i].vars.includes(n.id)) continue;
      if (pick < 0 || beliefs[i].values.length < beliefs[pick].values.length) pick = i;
    }
    if (pick < 0) {
      throw new EngineError(`No clique contains node "${n.id}"; the clique tree is incomplete.`, 'internal');
    }
    const m = marginalizeTo(beliefs[pick], [n.id]);
    const probs = Array.from(m.values, (x) => x / total);
    byNode[n.id] = probs;
    marginals.push({ node: n.id, states: n.states, probabilities: probs });
  }

  let largest = 0;
  for (const b of beliefs) largest = Math.max(largest, b.values.length);
  return {
    marginals,
    byNode,
    evidenceProbability: total,
    exactness: 'exact',
    structure,
    diagnostics: {
      method: 'Junction tree, Shafer-Shenoy belief propagation',
      eliminationOrder: [],
      inducedTreewidth: structure.treewidth,
      largestFactorEntries: largest,
      predictedLargestFactorEntries: structure.largestCliqueEntries,
      maxFactorEntries: maxEntries,
    },
  };
}
