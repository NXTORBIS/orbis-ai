/**
 * Discrete Bayesian network structure: nodes with named states, directed
 * edges, and conditional probability tables.
 *
 * A network is a serialisable `NetworkSpec`; `BayesNet.from` validates it and
 * returns an immutable object with indexes for inference. Validation is strict
 * on purpose — a CPT row that does not sum to 1 is a modelling error, and
 * quietly renormalising it would produce confident numbers from a broken
 * model.
 */
import { EngineError, Validator } from '../core/result';
import {
  Factor,
  indicatorFactor,
  makeFactor,
  tableSize,
} from './factor';
import { DiGraph, childrenMap, requireAcyclic } from './graph';

/** One node of the network, as authored or serialised. */
export interface NodeSpec {
  id: string;
  /** Distinct state names, at least two in a useful model, at least one here. */
  states: string[];
  /** Parent node ids; the CPT's row order follows this order. */
  parents?: string[];
  /**
   * Conditional probability table. One row per parent configuration, in
   * row-major order over `parents` (last parent varies fastest); each row is a
   * distribution over `states`. A root node has exactly one row.
   */
  cpt: number[][];
  description?: string;
}

export interface NetworkSpec {
  id?: string;
  name: string;
  description?: string;
  nodes: NodeSpec[];
}

export interface BayesNode {
  readonly id: string;
  readonly states: readonly string[];
  readonly parents: readonly string[];
  readonly cpt: readonly (readonly number[])[];
  readonly description?: string;
  readonly index: number;
}

/** Hard evidence: node id → state name or state index. */
export type Evidence = Readonly<Record<string, string | number>>;

const CPT_TOLERANCE = 1e-9;

export class BayesNet {
  readonly name: string;
  readonly description?: string;
  readonly nodes: readonly BayesNode[];
  readonly order: readonly string[];
  private readonly byId: Map<string, BayesNode>;
  private readonly children: Map<string, string[]>;

  private constructor(spec: NetworkSpec, nodes: BayesNode[], order: string[], graph: DiGraph) {
    this.name = spec.name;
    this.description = spec.description;
    this.nodes = nodes;
    this.order = order;
    this.byId = new Map(nodes.map((n) => [n.id, n]));
    this.children = childrenMap(graph);
  }

  /** Validate a specification and build a network, or throw an EngineError. */
  static from(spec: NetworkSpec): BayesNet {
    const v = new Validator();
    if (!spec || typeof spec.name !== 'string' || spec.name.length === 0) {
      v.add('A network needs a non-empty name.', 'name', 'required');
    }
    if (!Array.isArray(spec?.nodes) || spec.nodes.length === 0) {
      v.add('A network needs at least one node.', 'nodes', 'required');
      v.throwIfInvalid();
    }
    const seen = new Set<string>();
    for (const n of spec.nodes) {
      if (typeof n.id !== 'string' || n.id.length === 0) {
        v.add('Every node needs a non-empty id.', 'nodes', 'required');
        continue;
      }
      if (seen.has(n.id)) v.add(`Duplicate node id "${n.id}".`, n.id, 'duplicate');
      seen.add(n.id);
      if (!Array.isArray(n.states) || n.states.length === 0) {
        v.add(`Node "${n.id}" needs at least one state.`, n.id, 'required');
        continue;
      }
      const stateSeen = new Set<string>();
      for (const s of n.states) {
        if (typeof s !== 'string' || s.length === 0) {
          v.add(`Node "${n.id}" has a state with no name.`, n.id, 'required');
        } else if (stateSeen.has(s)) {
          v.add(`Node "${n.id}" has duplicate state "${s}".`, n.id, 'duplicate');
        }
        stateSeen.add(s);
      }
    }
    v.throwIfInvalid();

    // Parents must exist.
    for (const n of spec.nodes) {
      for (const p of n.parents ?? []) {
        if (!seen.has(p)) v.add(`Node "${n.id}" lists an unknown parent "${p}".`, n.id, 'unknown');
        if (p === n.id) v.add(`Node "${n.id}" cannot be its own parent.`, n.id, 'cycle');
      }
      const dupParents = new Set<string>();
      for (const p of n.parents ?? []) {
        if (dupParents.has(p)) v.add(`Node "${n.id}" lists parent "${p}" twice.`, n.id, 'duplicate');
        dupParents.add(p);
      }
    }
    v.throwIfInvalid();

    const graph: DiGraph = {
      nodes: spec.nodes.map((n) => n.id),
      parents: new Map(spec.nodes.map((n) => [n.id, [...(n.parents ?? [])]])),
    };
    const order = requireAcyclic(graph); // throws naming the cycle

    const stateCount = new Map(spec.nodes.map((n) => [n.id, n.states.length]));

    // CPT shape and normalisation.
    for (const n of spec.nodes) {
      const parents = n.parents ?? [];
      const parentCards = parents.map((p) => stateCount.get(p)!);
      const expectedRows = tableSize(parentCards);
      if (!Array.isArray(n.cpt)) {
        v.add(`Node "${n.id}" has no conditional probability table.`, n.id, 'required');
        continue;
      }
      if (n.cpt.length !== expectedRows) {
        v.add(
          `Node "${n.id}" needs ${expectedRows} CPT row${expectedRows === 1 ? '' : 's'} ` +
            `(one per configuration of ${parents.length ? parents.join(' x ') : 'no parents'}) but has ${n.cpt.length}.`,
          n.id,
          'shape',
        );
        continue;
      }
      for (let r = 0; r < n.cpt.length; r++) {
        const row = n.cpt[r];
        const label = describeRow(parents, parentCards, spec, r);
        if (!Array.isArray(row) || row.length !== n.states.length) {
          v.add(
            `Node "${n.id}" CPT row for ${label} has ${Array.isArray(row) ? row.length : 0} entries ` +
              `but "${n.id}" has ${n.states.length} states.`,
            n.id,
            'shape',
          );
          continue;
        }
        let sum = 0;
        let bad = false;
        for (let c = 0; c < row.length; c++) {
          const p = row[c];
          if (typeof p !== 'number' || !Number.isFinite(p)) {
            v.add(`Node "${n.id}" CPT row for ${label} has a non-numeric entry for state "${n.states[c]}".`, n.id, 'finite');
            bad = true;
            continue;
          }
          if (p < 0 || p > 1) {
            v.add(
              `Node "${n.id}" CPT row for ${label} has probability ${p} for state "${n.states[c]}", ` +
                `which is outside [0, 1].`,
              n.id,
              'range',
            );
            bad = true;
          }
          sum += p;
        }
        if (!bad && Math.abs(sum - 1) > CPT_TOLERANCE) {
          v.add(
            `Node "${n.id}" CPT row for ${label} sums to ${sum} instead of 1 ` +
              `(off by ${(sum - 1).toExponential(3)}).`,
            n.id,
            'sum',
          );
        }
      }
    }
    v.throwIfInvalid();

    const nodes: BayesNode[] = spec.nodes.map((n, i) => ({
      id: n.id,
      states: [...n.states],
      parents: [...(n.parents ?? [])],
      cpt: n.cpt.map((r) => [...r]),
      description: n.description,
      index: i,
    }));
    return new BayesNet(spec, nodes, order, graph);
  }

  get graph(): DiGraph {
    return { nodes: this.nodes.map((n) => n.id), parents: new Map(this.nodes.map((n) => [n.id, n.parents])) };
  }

  node(id: string): BayesNode {
    const n = this.byId.get(id);
    if (!n) {
      throw new EngineError(
        `Unknown node "${id}". This network has: ${this.nodes.map((m) => m.id).join(', ')}.`,
        'unknown',
      );
    }
    return n;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  childrenOf(id: string): readonly string[] {
    this.node(id);
    return this.children.get(id) ?? [];
  }

  parentsOf(id: string): readonly string[] {
    return this.node(id).parents;
  }

  cardinality(id: string): number {
    return this.node(id).states.length;
  }

  /** Resolve a state name or index to an index, or throw naming the options. */
  stateIndex(id: string, state: string | number): number {
    const n = this.node(id);
    if (typeof state === 'number') {
      if (!Number.isInteger(state) || state < 0 || state >= n.states.length) {
        throw new EngineError(
          `State index ${state} is out of range for node "${id}", which has ${n.states.length} states ` +
            `(${n.states.join(', ')}).`,
          'state',
        );
      }
      return state;
    }
    const i = n.states.indexOf(state);
    if (i < 0) {
      throw new EngineError(
        `Node "${id}" has no state "${state}". Its states are: ${n.states.join(', ')}.`,
        'state',
      );
    }
    return i;
  }

  stateName(id: string, index: number): string {
    const n = this.node(id);
    if (!Number.isInteger(index) || index < 0 || index >= n.states.length) {
      throw new EngineError(`State index ${index} is out of range for node "${id}".`, 'state');
    }
    return n.states[index];
  }

  /** Validate and normalise an evidence object into node → state index. */
  resolveEvidence(evidence: Evidence | undefined): Map<string, number> {
    const out = new Map<string, number>();
    if (!evidence) return out;
    for (const [id, state] of Object.entries(evidence)) {
      out.set(id, this.stateIndex(id, state));
    }
    return out;
  }

  /** The CPT of a node as a factor over [node, ...parents]. */
  factorOf(id: string): Factor {
    const n = this.node(id);
    const vars = [n.id, ...n.parents];
    const card = [n.states.length, ...n.parents.map((p) => this.cardinality(p))];
    const rows = n.cpt.length;
    const k = n.states.length;
    const values = new Float64Array(rows * k);
    // CPT is [parentConfig][state]; factor wants [state][parentConfig].
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < k; c++) values[c * rows + r] = n.cpt[r][c];
    }
    return makeFactor(vars, card, values);
  }

  /** All CPT factors. */
  factors(): Factor[] {
    return this.nodes.map((n) => this.factorOf(n.id));
  }

  /** Indicator factors pinning each evidence variable to its observed state. */
  evidenceFactors(evidence: ReadonlyMap<string, number>): Factor[] {
    const out: Factor[] = [];
    for (const [id, state] of evidence) out.push(indicatorFactor(id, this.cardinality(id), state));
    return out;
  }

  /** Total number of entries in the full joint distribution. */
  jointSize(): number {
    return tableSize(this.nodes.map((n) => n.states.length));
  }

  /** The Markov blanket of a node: parents, children, and children's parents. */
  markovBlanket(id: string): string[] {
    this.node(id);
    const out = new Set<string>();
    for (const p of this.parentsOf(id)) out.add(p);
    for (const c of this.childrenOf(id)) {
      out.add(c);
      for (const p of this.parentsOf(c)) if (p !== id) out.add(p);
    }
    out.delete(id);
    return [...out].sort();
  }

  /** Serialise back to a plain specification. */
  toSpec(): NetworkSpec {
    return {
      name: this.name,
      description: this.description,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        states: [...n.states],
        parents: [...n.parents],
        cpt: n.cpt.map((r) => [...r]),
        description: n.description,
      })),
    };
  }

  /**
   * Graph surgery for the do-operator: cut every incoming edge of the
   * intervened nodes and replace their CPT with a point mass on the assigned
   * state. The result is a valid network over the same variables, so any query
   * can be run on it with the ordinary machinery.
   */
  intervene(assignment: Evidence): BayesNet {
    const fixed = this.resolveEvidence(assignment);
    if (fixed.size === 0) {
      throw new EngineError('An intervention must set at least one node.', 'required');
    }
    const spec = this.toSpec();
    spec.name = `${this.name} under do(${[...fixed]
      .map(([id, s]) => `${id}=${this.stateName(id, s)}`)
      .join(', ')})`;
    for (const node of spec.nodes) {
      const s = fixed.get(node.id);
      if (s === undefined) continue;
      node.parents = [];
      node.cpt = [node.states.map((_, i) => (i === s ? 1 : 0))];
    }
    return BayesNet.from(spec);
  }
}

function describeRow(
  parents: readonly string[],
  parentCards: readonly number[],
  spec: NetworkSpec,
  row: number,
): string {
  if (parents.length === 0) return 'the single (no-parent) configuration';
  const states = new Array<number>(parents.length);
  let rest = row;
  for (let i = parents.length - 1; i >= 0; i--) {
    states[i] = rest % parentCards[i];
    rest = Math.floor(rest / parentCards[i]);
  }
  return parents
    .map((p, i) => {
      const node = spec.nodes.find((n) => n.id === p);
      const name = node ? node.states[states[i]] : String(states[i]);
      return `${p}=${name}`;
    })
    .join(', ');
}
