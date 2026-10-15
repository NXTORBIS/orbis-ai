/**
 * System reliability from component reliabilities.
 *
 * Structures are serialisable, recursively shaped descriptions (series,
 * parallel, k-of-n) over named components, plus an explicit edge-network form
 * for non-series-parallel systems such as the classic bridge.
 *
 * Every result states whether component independence was assumed, because it
 * nearly always is and it is nearly always the largest error in the answer.
 */

import { EngineError, Validator, type Exactness, type Explanation } from '../core/result';
import { clamp, stableSum } from '../core/numeric';

/** Maximum nesting depth accepted for a structure definition. */
export const MAX_STRUCTURE_DEPTH = 64;
/** Maximum number of minimal sets we will expand exactly. */
export const MAX_EXACT_SETS = 22;

export type Structure =
  | { kind: 'component'; id: string }
  | { kind: 'series'; children: Structure[] }
  | { kind: 'parallel'; children: Structure[] }
  | { kind: 'kofn'; k: number; children: Structure[] };

export type Reliabilities = Readonly<Record<string, number>>;

export interface SystemReliabilityResult {
  reliability: number;
  unreliability: number;
  exactness: Exactness;
  /** True when the computation treated component failures as independent. */
  independenceAssumed: boolean;
  /** Human-readable statement of the independence position, always present. */
  independenceNote: string;
  componentIds: string[];
  explanation: Explanation;
}

export interface BoundsResult {
  /** Esary–Proschan minimal-cut (lower) bound: Π_cuts (1 − Π q). */
  lower: number;
  /** Esary–Proschan minimal-path (upper) bound: 1 − Π_paths (1 − Π r). */
  upper: number;
  /** Always 'numerical': these are bounds, not the system reliability. */
  exactness: Exactness;
  isBound: true;
  independenceAssumed: boolean;
  note: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const INDEPENDENCE_ASSUMED_NOTE =
  'Component failures were treated as statistically independent. Shared causes ' +
  '(power, environment, batch, maintenance crew) make the true system reliability lower; ' +
  'use the beta-factor common-cause model to quantify how much.';

export const INDEPENDENCE_NOT_ASSUMED_NOTE =
  'Component failures were NOT treated as fully independent: a common-cause component is included.';

function validateReliability(v: Validator, value: number | undefined, id: string): void {
  if (value === undefined) {
    v.add(`No reliability was given for component "${id}".`, id, 'required');
    return;
  }
  if (!Number.isFinite(value)) {
    v.add(`Reliability of component "${id}" must be a finite number.`, id, 'finite');
    return;
  }
  if (value < 0 || value > 1) {
    v.add(`Reliability of component "${id}" is ${value}, which is outside [0, 1].`, id, 'range');
  }
}

/**
 * Walks the structure iteratively (explicit stack, no recursion) collecting
 * component ids, checking well-formedness and enforcing the depth limit.
 */
export function inspectStructure(structure: Structure): {
  ids: string[];
  duplicated: string[];
  depth: number;
  nodes: number;
} {
  const v = new Validator();
  const counts = new Map<string, number>();
  let maxDepth = 0;
  let nodes = 0;
  const stack: Array<{ node: Structure; depth: number }> = [{ node: structure, depth: 1 }];
  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    const { node, depth } = frame;
    nodes += 1;
    if (depth > maxDepth) maxDepth = depth;
    if (depth > MAX_STRUCTURE_DEPTH) {
      v.add(
        `Structure nesting exceeds the depth limit of ${MAX_STRUCTURE_DEPTH}; it is malformed or too deep to evaluate.`,
        'structure',
        'depth',
      );
      break;
    }
    if (nodes > 100000) {
      v.add('Structure has more than 100000 nodes; refusing to evaluate.', 'structure', 'size');
      break;
    }
    switch (node.kind) {
      case 'component': {
        if (typeof node.id !== 'string' || node.id.length === 0) {
          v.add('A component node has no id.', 'structure', 'required');
          break;
        }
        counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
        break;
      }
      case 'series':
      case 'parallel': {
        if (!Array.isArray(node.children) || node.children.length === 0) {
          v.add(`A ${node.kind} block has no sub-structures.`, 'structure', 'required');
          break;
        }
        for (const c of node.children) stack.push({ node: c, depth: depth + 1 });
        break;
      }
      case 'kofn': {
        if (!Array.isArray(node.children) || node.children.length === 0) {
          v.add('A k-of-n block has no sub-structures.', 'structure', 'required');
          break;
        }
        const n = node.children.length;
        if (!Number.isInteger(node.k)) {
          v.add(`k-of-n requires a whole number k; got ${node.k}.`, 'k', 'integer');
        } else if (node.k < 1) {
          v.add(`k-of-n requires k ≥ 1; got k = ${node.k}.`, 'k', 'range');
        } else if (node.k > n) {
          v.add(
            `k-of-n requires k ≤ n: k = ${node.k} but there are only n = ${n} sub-structures. ` +
              'A system cannot require more working units than it contains.',
            'k',
            'range',
          );
        }
        for (const c of node.children) stack.push({ node: c, depth: depth + 1 });
        break;
      }
      default: {
        const bad = node as { kind?: unknown };
        v.add(`Unknown structure kind "${String(bad.kind)}".`, 'structure', 'kind');
      }
    }
  }
  v.throwIfInvalid();
  const ids = [...counts.keys()].sort();
  const duplicated = ids.filter((id) => (counts.get(id) ?? 0) > 1);
  return { ids, duplicated, depth: maxDepth, nodes };
}

// ---------------------------------------------------------------------------
// k-of-n
// ---------------------------------------------------------------------------

/**
 * Exact distribution of the number of working units among independent units
 * with the given reliabilities, by dynamic-programming convolution.
 * O(n²) rather than the 2^n of enumeration.
 */
export function workingCountDistribution(reliabilities: readonly number[]): number[] {
  let dist = [1];
  for (const r of reliabilities) {
    const next = new Array<number>(dist.length + 1).fill(0);
    for (let i = 0; i < dist.length; i += 1) {
      next[i] += dist[i] * (1 - r);
      next[i + 1] += dist[i] * r;
    }
    dist = next;
  }
  return dist;
}

/** Exact P(at least k of n independent units work). */
export function kOfNReliability(k: number, reliabilities: readonly number[]): number {
  const n = reliabilities.length;
  const v = new Validator();
  if (n === 0) v.add('k-of-n needs at least one component.', 'n', 'required');
  if (!Number.isInteger(k)) v.add(`k must be a whole number; got ${k}.`, 'k', 'integer');
  else if (k < 1) v.add(`k must be at least 1; got ${k}.`, 'k', 'range');
  else if (k > n) v.add(`k must not exceed n: k = ${k}, n = ${n}.`, 'k', 'range');
  reliabilities.forEach((r, i) => validateReliability(v, r, `component ${i + 1}`));
  v.throwIfInvalid();
  const dist = workingCountDistribution(reliabilities);
  return clamp(stableSum(dist.slice(k)), 0, 1);
}

// ---------------------------------------------------------------------------
// Structure evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluates a structure in which every component appears at most once, so the
 * series/parallel/k-of-n product formulas apply directly. Iterative post-order
 * traversal: no recursion, so a deep structure cannot overflow the stack.
 */
function evaluateDistinct(structure: Structure, r: Reliabilities): number {
  type Frame = { node: Structure; values: number[]; index: number };
  const root: Frame = { node: structure, values: [], index: 0 };
  const stack: Frame[] = [root];
  let carried: number | null = null;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (carried !== null) {
      frame.values.push(carried);
      carried = null;
    }
    const node = frame.node;
    if (node.kind === 'component') {
      const value = r[node.id];
      if (value === undefined || !Number.isFinite(value)) {
        throw new EngineError(`No reliability available for component "${node.id}".`, 'required');
      }
      stack.pop();
      carried = value;
      continue;
    }
    if (frame.index < node.children.length) {
      const child = node.children[frame.index];
      frame.index += 1;
      stack.push({ node: child, values: [], index: 0 });
      continue;
    }
    stack.pop();
    if (node.kind === 'series') {
      let p = 1;
      for (const x of frame.values) p *= x;
      carried = p;
    } else if (node.kind === 'parallel') {
      let q = 1;
      for (const x of frame.values) q *= 1 - x;
      carried = 1 - q;
    } else {
      carried = kOfNReliability(node.k, frame.values);
    }
  }
  if (carried === null) throw new EngineError('Structure evaluation produced no value.', 'numerical');
  return clamp(carried, 0, 1);
}

/** Replaces every occurrence of `id` by a constant reliability. */
function pinned(r: Reliabilities, id: string, value: number): Reliabilities {
  return { ...r, [id]: value };
}

/**
 * Exact structure-function evaluation. Components repeated in the structure
 * (which is how a non-series-parallel system is written as a union of its
 * minimal paths) are handled by pivotal decomposition — Shannon expansion on
 * the repeated component — so the answer stays exact instead of double
 * counting the shared component.
 */
export function structureReliability(structure: Structure, reliabilities: Reliabilities): number {
  const info = inspectStructure(structure);
  const v = new Validator();
  for (const id of info.ids) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();
  if (info.duplicated.length > MAX_EXACT_SETS) {
    throw new EngineError(
      `The structure repeats ${info.duplicated.length} components; exact pivotal decomposition is limited to ` +
        `${MAX_EXACT_SETS} repeated components. Supply the system as a network instead.`,
      'size',
    );
  }
  const solve = (r: Reliabilities, repeats: readonly string[]): number => {
    if (repeats.length === 0) return evaluateDistinct(structure, r);
    const [pivot, ...rest] = repeats;
    const up = solve(pinned(r, pivot, 1), rest);
    const down = solve(pinned(r, pivot, 0), rest);
    const p = r[pivot];
    return p * up + (1 - p) * down;
  };
  return clamp(solve(reliabilities, info.duplicated), 0, 1);
}

export function systemReliability(structure: Structure, reliabilities: Reliabilities): SystemReliabilityResult {
  const info = inspectStructure(structure);
  const reliability = structureReliability(structure, reliabilities);
  const method = info.duplicated.length
    ? 'Structure function evaluated exactly by pivotal decomposition on repeated components'
    : 'Series / parallel / k-of-n structure formulas';
  return {
    reliability,
    unreliability: 1 - reliability,
    exactness: 'exact',
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
    componentIds: info.ids,
    explanation: {
      method,
      formula: 'series: Πrᵢ · parallel: 1 − Π(1 − rᵢ) · k-of-n: P(ΣXᵢ ≥ k) by DP convolution',
      steps: [
        { label: 'Components', value: String(info.ids.length) },
        { label: 'Nesting depth', value: String(info.depth) },
        { label: 'System reliability', value: reliability.toPrecision(10) },
      ],
      assumptions: [INDEPENDENCE_ASSUMED_NOTE, 'Each component is either working or failed; no partial states.'],
      limitations: [
        'Component reliabilities are taken as exact inputs; their own uncertainty is not propagated here.',
      ],
      exactness: 'exact',
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal path and cut sets
// ---------------------------------------------------------------------------

type IdSet = string[];

function normaliseSet(set: Iterable<string>): IdSet {
  return [...new Set(set)].sort();
}

/** Removes any set that is a superset of another, leaving the minimal ones. */
export function minimalise(sets: readonly IdSet[]): IdSet[] {
  const unique = new Map<string, IdSet>();
  for (const s of sets) {
    const norm = normaliseSet(s);
    unique.set(norm.join('\u0000'), norm);
  }
  const list = [...unique.values()].sort((a, b) => a.length - b.length);
  const kept: IdSet[] = [];
  for (const candidate of list) {
    const cs = new Set(candidate);
    const redundant = kept.some((k) => k.every((id) => cs.has(id)));
    if (!redundant) kept.push(candidate);
  }
  return kept;
}

function crossProduct(groups: readonly IdSet[][], limit: number): IdSet[] {
  let acc: IdSet[] = [[]];
  for (const group of groups) {
    const next: IdSet[] = [];
    for (const a of acc) {
      for (const b of group) {
        next.push([...a, ...b]);
        if (next.length > limit) {
          throw new EngineError(
            `Minimal set enumeration exceeded ${limit} candidate sets; the structure is too large for exact enumeration.`,
            'size',
          );
        }
      }
    }
    acc = minimalise(next);
  }
  return acc;
}

function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = [];
  const pick: T[] = [];
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push([...pick]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      pick.push(items[i]);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return out;
}

const SET_LIMIT = 200000;

/** Minimal path sets: the minimal component sets whose joint working makes the system work. */
export function minimalPathSets(structure: Structure): IdSet[] {
  inspectStructure(structure);
  const walk = (node: Structure, depth: number): IdSet[] => {
    if (depth > MAX_STRUCTURE_DEPTH) {
      throw new EngineError(`Structure nesting exceeds the depth limit of ${MAX_STRUCTURE_DEPTH}.`, 'depth');
    }
    if (node.kind === 'component') return [[node.id]];
    const childSets = node.children.map((c) => walk(c, depth + 1));
    if (node.kind === 'series') return crossProduct(childSets, SET_LIMIT);
    if (node.kind === 'parallel') return minimalise(childSets.flat());
    const out: IdSet[] = [];
    for (const combo of combinations(childSets, node.k)) {
      out.push(...crossProduct(combo, SET_LIMIT));
    }
    return minimalise(out);
  };
  return minimalise(walk(structure, 1));
}

/** Minimal cut sets: the minimal component sets whose joint failure fails the system. */
export function minimalCutSets(structure: Structure): IdSet[] {
  inspectStructure(structure);
  const walk = (node: Structure, depth: number): IdSet[] => {
    if (depth > MAX_STRUCTURE_DEPTH) {
      throw new EngineError(`Structure nesting exceeds the depth limit of ${MAX_STRUCTURE_DEPTH}.`, 'depth');
    }
    if (node.kind === 'component') return [[node.id]];
    const childSets = node.children.map((c) => walk(c, depth + 1));
    if (node.kind === 'series') return minimalise(childSets.flat());
    if (node.kind === 'parallel') return crossProduct(childSets, SET_LIMIT);
    // k-of-n fails when more than n − k units fail: any n − k + 1 of them.
    const out: IdSet[] = [];
    for (const combo of combinations(childSets, node.children.length - node.k + 1)) {
      out.push(...crossProduct(combo, SET_LIMIT));
    }
    return minimalise(out);
  };
  return minimalise(walk(structure, 1));
}

/**
 * Exact probability that at least one of the given sets has all its members
 * "on", by inclusion–exclusion. `on(id)` gives the per-component probability.
 */
export function inclusionExclusionUnion(sets: readonly IdSet[], on: (id: string) => number): number {
  if (sets.length === 0) return 0;
  if (sets.length > MAX_EXACT_SETS) {
    throw new EngineError(
      `Inclusion–exclusion over ${sets.length} sets needs 2^${sets.length} terms, beyond the limit of ` +
        `2^${MAX_EXACT_SETS}. Use the Esary–Proschan bounds instead.`,
      'size',
    );
  }
  const n = sets.length;
  const terms: number[] = [];
  for (let mask = 1; mask < 1 << n; mask += 1) {
    const union = new Set<string>();
    let bits = 0;
    for (let i = 0; i < n; i += 1) {
      if (mask & (1 << i)) {
        bits += 1;
        for (const id of sets[i]) union.add(id);
      }
    }
    let p = 1;
    for (const id of union) p *= on(id);
    terms.push(bits % 2 === 1 ? p : -p);
  }
  return clamp(stableSum(terms), 0, 1);
}

/** Exact system reliability from minimal path sets (inclusion–exclusion). */
export function reliabilityFromPathSets(sets: readonly IdSet[], reliabilities: Reliabilities): number {
  const v = new Validator();
  for (const id of new Set(sets.flat())) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();
  return inclusionExclusionUnion(sets, (id) => reliabilities[id]);
}

/** Exact system unreliability from minimal cut sets (inclusion–exclusion). */
export function unreliabilityFromCutSets(sets: readonly IdSet[], reliabilities: Reliabilities): number {
  const v = new Validator();
  for (const id of new Set(sets.flat())) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();
  return inclusionExclusionUnion(sets, (id) => 1 - reliabilities[id]);
}

/**
 * Esary–Proschan bounds. These are BOUNDS, not the system reliability: they
 * are exact only when the minimal paths (resp. cuts) share no components.
 */
export function esaryProschanBounds(structure: Structure, reliabilities: Reliabilities): BoundsResult {
  const paths = minimalPathSets(structure);
  const cuts = minimalCutSets(structure);
  const v = new Validator();
  for (const id of inspectStructure(structure).ids) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();
  // Treating the minimal paths as independent OVERSTATES reliability (the path
  // events are positively dependent through shared components), so the path
  // form is the upper bound; the cut form is the lower bound.
  let upper = 1;
  for (const path of paths) {
    let p = 1;
    for (const id of path) p *= reliabilities[id];
    upper *= 1 - p;
  }
  upper = 1 - upper;
  let lower = 1;
  for (const cut of cuts) {
    let q = 1;
    for (const id of cut) q *= 1 - reliabilities[id];
    lower *= 1 - q;
  }
  return {
    lower: clamp(lower, 0, 1),
    upper: clamp(upper, 0, 1),
    exactness: 'numerical',
    isBound: true,
    independenceAssumed: true,
    note:
      'Esary–Proschan bounds on system reliability: Π_cuts(1 − Πq) ≤ R ≤ 1 − Π_paths(1 − Πr). ' +
      'These are bounds, not the reliability: they coincide with the exact value only when the ' +
      'minimal paths and cuts share no components. ' +
      INDEPENDENCE_ASSUMED_NOTE,
  };
}

// ---------------------------------------------------------------------------
// Networks (non-series-parallel)
// ---------------------------------------------------------------------------

export interface NetworkEdge {
  /** Component id controlling this edge. */
  id: string;
  from: string;
  to: string;
  /** Undirected unless `directed` is true. */
  directed?: boolean;
}

export interface Network {
  edges: NetworkEdge[];
  source: string;
  sink: string;
}

/** All minimal source→sink paths of a network, as component id sets. */
export function networkMinimalPaths(network: Network): IdSet[] {
  const v = new Validator();
  if (!network.edges?.length) v.add('The network has no edges.', 'edges', 'required');
  if (!network.source) v.add('The network has no source node.', 'source', 'required');
  if (!network.sink) v.add('The network has no sink node.', 'sink', 'required');
  if (network.source === network.sink) {
    v.add('The source and sink nodes are the same; there is nothing to connect.', 'source', 'invalid');
  }
  const seen = new Set<string>();
  for (const e of network.edges ?? []) {
    if (!e.id) v.add('A network edge has no component id.', 'edges', 'required');
    else if (seen.has(e.id)) v.add(`Duplicate component id "${e.id}" on two edges.`, 'edges', 'duplicate');
    seen.add(e.id);
  }
  v.throwIfInvalid();
  const nodes = new Set<string>();
  for (const e of network.edges) {
    nodes.add(e.from);
    nodes.add(e.to);
  }
  if (!nodes.has(network.source)) {
    throw new EngineError(`Source node "${network.source}" does not appear on any edge.`, 'invalid');
  }
  if (!nodes.has(network.sink)) {
    throw new EngineError(`Sink node "${network.sink}" does not appear on any edge.`, 'invalid');
  }
  const paths: IdSet[] = [];
  const visited = new Set<string>([network.source]);
  const used: string[] = [];
  const walk = (node: string): void => {
    if (node === network.sink) {
      paths.push([...used]);
      if (paths.length > 100000) throw new EngineError('The network has more than 100000 simple paths.', 'size');
      return;
    }
    for (const e of network.edges) {
      let next: string | null = null;
      if (e.from === node) next = e.to;
      else if (!e.directed && e.to === node) next = e.from;
      if (next === null || visited.has(next)) continue;
      visited.add(next);
      used.push(e.id);
      walk(next);
      used.pop();
      visited.delete(next);
    }
  };
  walk(network.source);
  if (paths.length === 0) {
    throw new EngineError(
      `No path connects "${network.source}" to "${network.sink}"; the system can never work.`,
      'invalid',
    );
  }
  return minimalise(paths);
}

/** Minimal cut sets of a network, derived from its minimal path sets. */
export function networkMinimalCuts(network: Network): IdSet[] {
  const paths = networkMinimalPaths(network);
  // A cut must hit every path: minimal hitting sets of the minimal paths.
  let cuts: IdSet[] = [[]];
  for (const path of paths) {
    const next: IdSet[] = [];
    for (const c of cuts) {
      const cs = new Set(c);
      if (path.some((id) => cs.has(id))) {
        next.push(c);
        continue;
      }
      for (const id of path) next.push([...c, id]);
    }
    cuts = minimalise(next);
  }
  return minimalise(cuts);
}

/**
 * Exact reliability of a two-terminal network, by inclusion–exclusion over its
 * minimal path sets. Correct for non-series-parallel systems (the bridge).
 */
export function networkReliability(network: Network, reliabilities: Reliabilities): SystemReliabilityResult {
  const paths = networkMinimalPaths(network);
  const ids = [...new Set(network.edges.map((e) => e.id))].sort();
  const v = new Validator();
  for (const id of ids) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();
  const reliability = inclusionExclusionUnion(paths, (id) => reliabilities[id]);
  return {
    reliability,
    unreliability: 1 - reliability,
    exactness: 'exact',
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
    componentIds: ids,
    explanation: {
      method: 'Exact two-terminal network reliability by inclusion–exclusion over minimal path sets',
      formula: 'R = Σ_{∅≠S⊆paths} (−1)^{|S|+1} Π_{c ∈ ∪S} r_c',
      steps: [
        { label: 'Minimal path sets', value: String(paths.length) },
        { label: 'System reliability', value: reliability.toPrecision(10) },
      ],
      assumptions: [INDEPENDENCE_ASSUMED_NOTE, 'Nodes are perfectly reliable; only edge components can fail.'],
      limitations: [
        `Exact enumeration is limited to ${MAX_EXACT_SETS} minimal paths; larger networks must use bounds.`,
      ],
      exactness: 'exact',
    },
  };
}

/**
 * Exact reliability of a two-terminal network by pivotal decomposition
 * (factoring on one component), given as an independent route to the same
 * number as `networkReliability`.
 */
export function networkReliabilityByFactoring(network: Network, reliabilities: Reliabilities): number {
  const ids = [...new Set(network.edges.map((e) => e.id))].sort();
  const v = new Validator();
  for (const id of ids) validateReliability(v, reliabilities[id], id);
  v.throwIfInvalid();

  const contract = (edges: NetworkEdge[], id: string): { edges: NetworkEdge[]; merge: [string, string] } => {
    const target = edges.find((e) => e.id === id);
    if (!target) throw new EngineError(`Component "${id}" is not in the network.`, 'invalid');
    return { edges: edges.filter((e) => e.id !== id), merge: [target.from, target.to] };
  };

  const solve = (edges: NetworkEdge[], source: string, sink: string, depth: number): number => {
    if (depth > MAX_STRUCTURE_DEPTH) {
      throw new EngineError('Pivotal decomposition exceeded its depth limit.', 'depth');
    }
    if (source === sink) return 1;
    if (edges.length === 0) return 0;
    const pivot = edges[0].id;
    const { edges: rest, merge } = contract(edges, pivot);
    const rename = (node: string): string => (node === merge[1] ? merge[0] : node);
    const working = rest.map((e) => ({ ...e, from: rename(e.from), to: rename(e.to) }));
    const upSource = rename(source);
    const upSink = rename(sink);
    const up = upSource === upSink ? 1 : solve(working, upSource, upSink, depth + 1);
    const down = solve(rest, source, sink, depth + 1);
    const p = reliabilities[pivot];
    return p * up + (1 - p) * down;
  };
  return clamp(solve(network.edges, network.source, network.sink, 1), 0, 1);
}

/** The classic 5-component bridge network. */
export function bridgeNetwork(
  ids: readonly string[] = ['c1', 'c2', 'c3', 'c4', 'c5'],
): Network {
  if (ids.length !== 5) throw new EngineError('The bridge network needs exactly 5 component ids.', 'invalid');
  const [c1, c2, c3, c4, c5] = ids;
  return {
    source: 's',
    sink: 't',
    edges: [
      { id: c1, from: 's', to: 'a' },
      { id: c2, from: 's', to: 'b' },
      { id: c3, from: 'a', to: 'b' },
      { id: c4, from: 'a', to: 't' },
      { id: c5, from: 'b', to: 't' },
    ],
  };
}
