/**
 * Multi-stage stochastic programming on a scenario tree.
 *
 * Non-anticipativity — the requirement that a decision depend only on what is
 * known when it is taken — is enforced BY CONSTRUCTION here rather than by
 * added constraints: there is exactly one decision vector per tree NODE, and
 * every scenario passing through that node shares it. Two scenarios that are
 * indistinguishable up to stage t therefore take identical decisions up to
 * stage t because they are literally the same variables.
 *
 * The alternative formulation — one decision vector per scenario per stage plus
 * explicit equality constraints tying them together — is equivalent, and is
 * what progressive hedging needs; it is not used here because an omitted or
 * mistyped non-anticipativity constraint is silent, and this formulation cannot
 * omit one. `nonAnticipativityStatement` reports which decisions are shared, so
 * the property is visible in the output and not merely true in the code.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import { requireOptimal, rowName } from './linear';
import type { LpProblem, LpRow, Provenance, RowSense } from './types';

export interface TreeRow {
  /** Coefficients on this node's own decision variables. */
  own: number[];
  /** Coefficients on the PARENT node's decision variables. Empty at the root. */
  parent?: number[];
  sense: RowSense;
  rhs: number;
  name?: string;
}

export interface TreeNode {
  name: string;
  /** Index of the parent node, or null for the root. Must be smaller than this node's index. */
  parent: number | null;
  /** Probability of reaching this node GIVEN its parent. 1 at the root. */
  conditionalProbability: number;
  /** Cost of this node's decisions, minimised, weighted by the node's path probability. */
  cost: number[];
  rows: TreeRow[];
  lower?: number[];
  upper?: number[];
}

export interface ScenarioTree {
  name: string;
  nodes: TreeNode[];
}

export interface MultistageSolution {
  status: 'optimal';
  objective: number;
  /** Decision vector at every node, in node order. */
  decisions: { node: string; stage: number; pathProbability: number; x: number[]; cost: number }[];
  /** Stage of each node, derived from the tree. */
  stages: number[];
  /** Leaf nodes and the probability of each complete scenario. */
  scenarios: { leaf: string; probability: number; path: string[] }[];
  nonAnticipativityStatement: string;
  provenance: Provenance;
}

interface TreeShape {
  stages: number[];
  pathProbability: number[];
  children: number[][];
  offsets: number[];
  total: number;
}

export function validateScenarioTree(tree: ScenarioTree): TreeShape {
  const v = new Validator();
  const nodes = tree.nodes;
  if (nodes.length === 0) {
    v.add('The scenario tree is empty. A multi-stage problem needs at least a root node.', 'nodes', 'empty');
    v.throwIfInvalid();
  }
  if (nodes[0].parent !== null) v.add('The first node of the tree must be the root and have no parent.', 'nodes', 'shape');
  const stages = new Array<number>(nodes.length).fill(0);
  const pathProbability = new Array<number>(nodes.length).fill(0);
  const children: number[][] = nodes.map(() => []);
  nodes.forEach((node, i) => {
    if (node.cost.length === 0) v.add(`Node "${node.name || i}" has no decision variables.`, 'nodes', 'empty');
    if (node.parent === null) {
      if (i !== 0) v.add(`Node "${node.name || i}" has no parent but is not the root; a tree has exactly one root.`, 'nodes', 'shape');
      stages[i] = 0;
      pathProbability[i] = node.conditionalProbability;
      if (Math.abs(node.conditionalProbability - 1) > 1e-12) {
        v.add(`The root node has conditional probability ${node.conditionalProbability}; the root is reached with certainty, so it must be 1.`, 'nodes', 'range');
      }
    } else {
      if (!Number.isInteger(node.parent) || node.parent < 0 || node.parent >= i) {
        v.add(`Node "${node.name || i}" names parent index ${String(node.parent)}; a parent must be an earlier node, so the tree cannot contain a cycle.`, 'nodes', 'shape');
        return;
      }
      children[node.parent].push(i);
      stages[i] = stages[node.parent] + 1;
      pathProbability[i] = pathProbability[node.parent] * node.conditionalProbability;
      if (!(node.conditionalProbability >= 0) || node.conditionalProbability > 1) {
        v.add(`Node "${node.name || i}" has conditional probability ${String(node.conditionalProbability)}; it must lie in [0,1].`, 'nodes', 'range');
      }
    }
    node.rows.forEach((r, k) => {
      if (r.own.length !== node.cost.length) {
        v.add(`Node "${node.name || i}", ${r.name ?? `row ${k + 1}`}: ${r.own.length} own coefficients but ${node.cost.length} decision variables.`, 'nodes', 'shape');
      }
      const parentWidth = node.parent === null ? 0 : nodes[node.parent].cost.length;
      const given = r.parent?.length ?? 0;
      if (given !== 0 && given !== parentWidth) {
        v.add(`Node "${node.name || i}", ${r.name ?? `row ${k + 1}`}: ${given} parent coefficients but the parent has ${parentWidth} decision variables.`, 'nodes', 'shape');
      }
      if (node.parent === null && given > 0) {
        v.add(`Node "${node.name || i}" is the root and has no parent, but ${r.name ?? `row ${k + 1}`} carries parent coefficients.`, 'nodes', 'shape');
      }
    });
  });
  v.throwIfInvalid();
  // Sibling conditional probabilities must sum to 1 at every branching node.
  children.forEach((kids, i) => {
    if (kids.length === 0) return;
    const sum = stableSum(kids.map((k) => nodes[k].conditionalProbability));
    if (Math.abs(sum - 1) > 1e-9) {
      v.add(
        `The children of node "${nodes[i].name || i}" have conditional probabilities summing to ${sum.toPrecision(12)}, not 1. Conditional on reaching that node, something must happen next.`,
        'nodes',
        'sum',
      );
    }
  });
  v.throwIfInvalid();
  const offsets: number[] = [];
  let total = 0;
  for (const node of nodes) {
    offsets.push(total);
    total += node.cost.length;
  }
  return { stages, pathProbability, children, offsets, total };
}

/** Build the node formulation as one linear program. */
export function multistageLp(tree: ScenarioTree): { lp: LpProblem; shape: TreeShape } {
  const shape = validateScenarioTree(tree);
  const { offsets, total, pathProbability } = shape;
  const objective = new Array<number>(total).fill(0);
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  const names: string[] = [];
  tree.nodes.forEach((node, i) => {
    node.cost.forEach((c, j) => {
      objective[offsets[i] + j] = pathProbability[i] * c;
      lower[offsets[i] + j] = node.lower?.[j] ?? 0;
      upper[offsets[i] + j] = node.upper?.[j] ?? Infinity;
      names.push(`${node.name || `node ${i}`}:x${j + 1}`);
    });
  });
  const rows: LpRow[] = [];
  tree.nodes.forEach((node, i) => {
    node.rows.forEach((r, k) => {
      const coef = new Array<number>(total).fill(0);
      for (let j = 0; j < r.own.length; j++) coef[offsets[i] + j] = r.own[j];
      if (r.parent && node.parent !== null) {
        for (let j = 0; j < r.parent.length; j++) coef[offsets[node.parent] + j] += r.parent[j];
      }
      rows.push({ coef, sense: r.sense, rhs: r.rhs, name: `${node.name || `node ${i}`}: ${rowName({ coef: [], sense: r.sense, rhs: r.rhs, name: r.name }, k)}` });
    });
  });
  return { lp: { sense: 'min', objective, rows, lower, upper, names }, shape };
}

export function solveMultistage(tree: ScenarioTree): MultistageSolution {
  const { lp, shape } = multistageLp(tree);
  const sol = requireOptimal(lp, `The multi-stage programme "${tree.name}"`);
  const { offsets, stages, pathProbability, children } = shape;
  const decisions = tree.nodes.map((node, i) => {
    const x = sol.x.slice(offsets[i], offsets[i] + node.cost.length);
    return { node: node.name || `node ${i}`, stage: stages[i], pathProbability: pathProbability[i], x, cost: stableSum(node.cost.map((c, j) => c * x[j])) };
  });
  const leaves = children.map((kids, i) => (kids.length === 0 ? i : -1)).filter((i) => i >= 0);
  const scenarios = leaves.map((leaf) => {
    const path: string[] = [];
    let cur: number | null = leaf;
    while (cur !== null) {
      path.unshift(tree.nodes[cur].name || `node ${cur}`);
      cur = tree.nodes[cur].parent;
    }
    return { leaf: tree.nodes[leaf].name || `node ${leaf}`, probability: pathProbability[leaf], path };
  });
  const leafMass = stableSum(scenarios.map((s) => s.probability));
  if (Math.abs(leafMass - 1) > 1e-8) {
    throw new EngineError(
      `The leaf probabilities of the tree sum to ${leafMass.toPrecision(12)}, not 1, so the tree does not describe a probability distribution over complete scenarios.`,
      'sum',
    );
  }
  const maxStage = Math.max(...stages);
  const shared = tree.nodes
    .map((node, i) => ({ node: node.name || `node ${i}`, stage: stages[i], scenarios: scenarios.filter((s) => s.path.includes(node.name || `node ${i}`)).length }))
    .filter((e) => e.scenarios > 1);
  return {
    status: 'optimal',
    objective: sol.objective,
    decisions,
    stages,
    scenarios,
    nonAnticipativityStatement:
      `Non-anticipativity holds by construction: the tree has ${tree.nodes.length} nodes over ${maxStage + 1} stages and ${scenarios.length} complete scenarios, and there is exactly one decision vector per node. ` +
      `${shared.length} nodes are shared by more than one scenario (${shared.map((s) => `${s.node} by ${s.scenarios}`).join(', ')}), so those decisions cannot depend on information that arrives later — not because a constraint forbids it but because the variables are the same variables. ` +
      'No non-anticipativity constraint can therefore be accidentally omitted from this formulation.',
    provenance: {
      exactness: 'exact',
      method: `Node formulation of the multi-stage programme as one linear program (${lp.objective.length} variables, ${lp.rows.length} rows), solved to optimality`,
      assumedInputs: [
        'The scenario tree, its branching structure and its conditional probabilities are the user\'s model of how information arrives. The tree IS the model of the filtration, and a coarser tree is a different problem rather than an approximation of this one.',
      ],
      limitations: [
        'The node formulation grows with the number of nodes, which grows geometrically in the number of stages. Four stages with ten branches each is ten thousand leaves; the deterministic equivalent is then large but still a single linear program.',
        'A scenario tree built by sampling carries the sampling error of the tree itself, which this exact solve of the tree says nothing about.',
      ],
    },
  };
}
