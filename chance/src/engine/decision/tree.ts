/**
 * Decision trees: validation, rollback (backward induction), risk profiles and
 * stochastic dominance.
 *
 * Rollback
 * --------
 * Working from the leaves back to the root: a chance node takes the
 * probability-weighted average of its branches' utilities; a decision node
 * takes the maximum over its alternatives. The result is the optimal policy —
 * what to choose at every decision node that can still be reached.
 *
 * The traversal is **iterative**. A decision tree supplied by a user can be
 * arbitrarily deep, and a recursive rollback would overflow the stack on a
 * deep or deliberately hostile tree. Nodes are discovered with an explicit
 * stack (parents before children) and then valued in reverse discovery order
 * (children before parents). A depth limit of MAX_DEPTH is enforced anyway so
 * that a pathological input fails with a message instead of exhausting memory.
 *
 * Risk profile
 * ------------
 * A rollback returns one number per node. That number hides everything about
 * the spread of outcomes, and two strategies with the same expected value can
 * differ enormously in risk. The risk profile is the full outcome
 * distribution of the chosen strategy: every payoff that can result and its
 * probability. The quantiles reported with it are **percentiles of the
 * outcome distribution**, not a confidence interval for an estimate — they are
 * statements about what can happen, not about estimation error.
 *
 * Stochastic dominance
 * --------------------
 * First-order dominance (F_A ≤ F_B everywhere) means A is preferred by every
 * decision maker who prefers more to less. Second-order dominance (the
 * integral of F_A never exceeds that of F_B) means A is preferred by every
 * risk-averse decision maker. Both are checked exactly on the step functions,
 * so no utility function has to be assumed.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import type {
  Alternative,
  ChanceNode,
  DecisionPoint,
  DecisionTree,
  OutcomePoint,
  Provenance,
  TreeNode,
} from './types';
import { utilityFunction, type UtilitySpec } from './utility';

/** Documented depth limit for tree traversal. */
export const MAX_DEPTH = 10_000;
/** Documented limit on the number of distinct outcome paths enumerated. */
export const MAX_PATHS = 500_000;
/** Tolerance on the sum of a chance node's branch probabilities. */
export const PROBABILITY_SUM_TOLERANCE = 1e-9;

interface Discovered {
  node: TreeNode;
  /** Payoffs accumulated from the root down to and including the edge into this node. */
  prefix: number;
  depth: number;
  childIndices: number[];
}

function describe(node: TreeNode): string {
  return node.label ? `"${node.label}" (${node.id})` : `"${node.id}"`;
}

/**
 * Validate the structure of a tree and return every node in an order where a
 * parent always precedes its children.
 *
 * Refuses: a chance node whose branch probabilities do not sum to 1 (naming the
 * node), a probability outside [0, 1], a node reached twice (a cycle or a
 * re-used subtree), a duplicate node id, a decision or chance node with no
 * children (a path that does not terminate), and a tree deeper than MAX_DEPTH.
 */
export function validateTree(tree: DecisionTree): Discovered[] {
  const v = new Validator();
  if (!tree.root) {
    v.add('The decision tree has no root node.', 'root', 'required');
    v.throwIfInvalid();
  }
  const discovered: Discovered[] = [];
  const ids = new Set<string>();
  const onPath = new Set<TreeNode>();
  const seen = new Set<TreeNode>();
  // Explicit stack: (index into discovered) of nodes whose children are pending.
  const stack: { index: number }[] = [];
  const push = (node: TreeNode, prefix: number, depth: number): number => {
    if (depth > MAX_DEPTH) {
      throw new EngineError(
        `The decision tree is deeper than the supported limit of ${MAX_DEPTH} levels (at node ${describe(node)}).`,
        'depth',
      );
    }
    if (seen.has(node)) {
      throw new EngineError(
        `Node ${describe(node)} is reached more than once. A decision tree must be acyclic and must not re-use a ` +
          'subtree object; clone the subtree if the same structure is genuinely needed twice.',
        'cycle',
      );
    }
    if (ids.has(node.id)) {
      throw new EngineError(
        `Duplicate node id "${node.id}". Every node needs a unique id so values can be reported per node.`,
        'duplicate',
      );
    }
    seen.add(node);
    ids.add(node.id);
    discovered.push({ node, prefix, depth, childIndices: [] });
    return discovered.length - 1;
  };

  const rootIndex = push(tree.root, 0, 0);
  stack.push({ index: rootIndex });
  while (stack.length) {
    const frame = stack.pop();
    if (!frame) break;
    const entry = discovered[frame.index];
    const node = entry.node;
    if (onPath.has(node)) onPath.delete(node);
    if (node.kind === 'terminal') {
      if (!Number.isFinite(node.payoff)) {
        v.add(`Terminal node ${describe(node)} has a payoff that is not a finite number.`, node.id, 'finite');
      }
      continue;
    }
    if (node.kind === 'chance') {
      if (!node.branches.length) {
        throw new EngineError(
          `Chance node ${describe(node)} has no branches, so a path through the tree never terminates.`,
          'incomplete',
        );
      }
      const probs: number[] = [];
      node.branches.forEach((b, i) => {
        const label = `Probability of branch "${b.label}" at chance node ${describe(node)}`;
        if (v.probability(b.probability, `${node.id}.branch[${i}].probability`, label)) probs.push(b.probability);
        if (b.payoff !== undefined) {
          v.finite(b.payoff, `${node.id}.branch[${i}].payoff`, `Payoff on branch "${b.label}" of ${describe(node)}`);
        }
      });
      v.throwIfInvalid();
      const total = stableSum(probs);
      if (Math.abs(total - 1) > PROBABILITY_SUM_TOLERANCE) {
        throw new EngineError(
          `The branch probabilities at chance node ${describe(node)} sum to ${total}, not 1. ` +
            `Branches: ${node.branches.map((b) => `${b.label}=${b.probability}`).join(', ')}.`,
          'sum',
        );
      }
      for (let i = node.branches.length - 1; i >= 0; i--) {
        const b = node.branches[i];
        const idx = push(b.child, entry.prefix + (b.payoff ?? 0), entry.depth + 1);
        entry.childIndices[i] = idx;
        stack.push({ index: idx });
      }
      continue;
    }
    if (!node.alternatives.length) {
      throw new EngineError(
        `Decision node ${describe(node)} has no alternatives, so there is nothing to choose and a path through the ` +
          'tree never terminates.',
        'incomplete',
      );
    }
    node.alternatives.forEach((a, i) => {
      if (a.payoff !== undefined) {
        v.finite(a.payoff, `${node.id}.alternative[${i}].payoff`, `Payoff of alternative "${a.label}" at ${describe(node)}`);
      }
    });
    v.throwIfInvalid();
    for (let i = node.alternatives.length - 1; i >= 0; i--) {
      const a = node.alternatives[i];
      const idx = push(a.child, entry.prefix + (a.payoff ?? 0), entry.depth + 1);
      entry.childIndices[i] = idx;
      stack.push({ index: idx });
    }
  }
  v.throwIfInvalid();
  return discovered;
}

export interface NodeValuation {
  id: string;
  kind: TreeNode['kind'];
  label: string;
  depth: number;
  /** Payoffs accumulated from the root down to this node. */
  pathPayoff: number;
  /** Expected utility of the optimal continuation from this node. */
  expectedUtility: number;
  /**
   * Total payoff, counting the path already travelled, that is equivalent to
   * continuing optimally from this node. Equals the expected value under a
   * linear utility.
   */
  certaintyEquivalent: number;
  /** Expected total payoff of continuing optimally from this node. */
  expectedValue: number;
  /** Probability of reaching this node under the optimal policy; 0 if off-policy. */
  reachProbability: number;
  chosenAlternative?: { index: number; label: string };
}

export interface PolicyEntry {
  nodeId: string;
  nodeLabel: string;
  alternativeIndex: number;
  alternativeLabel: string;
  /** Certainty equivalent of each alternative, so the margin is visible. */
  alternativeValues: { label: string; certaintyEquivalent: number; expectedValue: number }[];
  reachProbability: number;
}

export interface PathStep {
  nodeId: string;
  nodeLabel: string;
  kind: TreeNode['kind'];
  /** The chosen alternative at a decision node. */
  choice?: string;
  /** At a chance node, the branches the path forks into. */
  forks?: { label: string; probability: number }[];
  payoff?: number;
}

export interface QuantilePoint {
  level: number;
  payoff: number;
}

export interface RiskProfile {
  label: string;
  /** Distinct payoffs and their probabilities, sorted ascending. */
  outcomes: OutcomePoint[];
  /** Right-continuous CDF of the outcome distribution. */
  cumulative: { payoff: number; cumulativeProbability: number }[];
  expectedValue: number;
  variance: number;
  standardDeviation: number;
  min: number;
  max: number;
  /** Percentiles OF THE OUTCOME DISTRIBUTION — not a confidence interval. */
  percentiles: QuantilePoint[];
  pathCount: number;
  notes: string[];
}

export interface RollbackResult {
  treeId: string;
  treeName: string;
  unit?: string;
  utilityLabel: string;
  /** Expected utility at the root under the optimal policy. */
  expectedUtility: number;
  /** Certainty equivalent of the whole decision. */
  certaintyEquivalent: number;
  /** Expected value of the optimal policy (risk-neutral measure of the same policy). */
  expectedValue: number;
  /** expectedValue − certaintyEquivalent: what the remaining risk costs. */
  riskPremium: number;
  /** Value at every node, keyed by node id, so the whole tree can be annotated. */
  nodes: Record<string, NodeValuation>;
  nodeOrder: string[];
  /** The choice at every reachable decision node: the optimal strategy. */
  policy: PolicyEntry[];
  /** Root-to-first-uncertainty trace of the optimal strategy. */
  optimalPath: PathStep[];
  riskProfile: RiskProfile;
  provenance: Provenance;
  notes: string[];
}

function nodeLabel(node: TreeNode): string {
  return node.label ?? node.id;
}

function buildRiskProfile(points: { payoff: number; probability: number }[], label: string): RiskProfile {
  const merged = new Map<string, OutcomePoint>();
  for (const p of points) {
    if (p.probability === 0) continue;
    const key = p.payoff.toPrecision(15);
    const existing = merged.get(key);
    if (existing) existing.probability += p.probability;
    else merged.set(key, { payoff: p.payoff, probability: p.probability });
  }
  const outcomes = [...merged.values()].sort((a, b) => a.payoff - b.payoff);
  if (!outcomes.length) {
    throw new EngineError('The strategy has no reachable outcome with positive probability.', 'empty');
  }
  const ev = stableSum(outcomes.map((o) => o.probability * o.payoff));
  const varc = stableSum(outcomes.map((o) => o.probability * (o.payoff - ev) * (o.payoff - ev)));
  const cumulative: { payoff: number; cumulativeProbability: number }[] = [];
  let acc = 0;
  for (const o of outcomes) {
    acc += o.probability;
    cumulative.push({ payoff: o.payoff, cumulativeProbability: Math.min(1, acc) });
  }
  const levels = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
  const percentiles = levels.map((level) => {
    const hit = cumulative.find((c) => c.cumulativeProbability >= level - 1e-12);
    return { level, payoff: hit ? hit.payoff : outcomes[outcomes.length - 1].payoff };
  });
  return {
    label,
    outcomes,
    cumulative,
    expectedValue: ev,
    variance: varc,
    standardDeviation: Math.sqrt(varc),
    min: outcomes[0].payoff,
    max: outcomes[outcomes.length - 1].payoff,
    percentiles,
    pathCount: points.length,
    notes: [
      'This is the full outcome distribution of the strategy, not a summary: two strategies with the same expected value can appear here as very different risks.',
      'The percentiles are percentiles of the outcome distribution — statements about what can happen. They are not a confidence interval for an estimate.',
      'The probabilities are exactly those supplied in the tree; the enumeration over paths is exact.',
    ],
  };
}

/** Enumerate the outcome distribution of a strategy: a choice at each decision node. */
export function strategyRiskProfile(
  tree: DecisionTree,
  policy: Record<string, number>,
  label = 'Strategy',
): RiskProfile {
  validateTree(tree);
  const points: { payoff: number; probability: number }[] = [];
  const work: { node: TreeNode; acc: number; prob: number }[] = [{ node: tree.root, acc: 0, prob: 1 }];
  while (work.length) {
    const item = work.pop();
    if (!item) break;
    if (points.length > MAX_PATHS) {
      throw new EngineError(
        `The strategy has more than ${MAX_PATHS} outcome paths; the risk profile cannot be enumerated exactly.`,
        'size',
      );
    }
    const { node, acc, prob } = item;
    if (node.kind === 'terminal') {
      points.push({ payoff: acc + node.payoff, probability: prob });
      continue;
    }
    if (node.kind === 'chance') {
      for (const b of node.branches) {
        if (b.probability === 0) continue;
        work.push({ node: b.child, acc: acc + (b.payoff ?? 0), prob: prob * b.probability });
      }
      continue;
    }
    const choice = policy[node.id];
    if (choice === undefined || !Number.isInteger(choice) || choice < 0 || choice >= node.alternatives.length) {
      throw new EngineError(
        `The strategy does not say what to choose at decision node ${describe(node)}, which is reachable. ` +
          'A strategy must specify a choice at every reachable decision node.',
        'incomplete',
      );
    }
    const alt = node.alternatives[choice];
    work.push({ node: alt.child, acc: acc + (alt.payoff ?? 0), prob });
  }
  return buildRiskProfile(points, label);
}

/**
 * Rollback / backward induction. Returns the optimal policy, the certainty
 * equivalent, the value at every node, and the risk profile of the optimal
 * strategy.
 */
export function rollback(tree: DecisionTree, spec: UtilitySpec = { kind: 'linear' }): RollbackResult {
  const discovered = validateTree(tree);
  const uf = utilityFunction(spec);
  const n = discovered.length;
  const eu = new Array<number>(n).fill(NaN);
  const ev = new Array<number>(n).fill(NaN);
  const choice = new Array<number>(n).fill(-1);

  // Children were discovered after their parent, so reverse order values
  // children before parents. This is the iterative backward induction.
  for (let i = n - 1; i >= 0; i--) {
    const entry = discovered[i];
    const node = entry.node;
    if (node.kind === 'terminal') {
      const total = entry.prefix + node.payoff;
      eu[i] = uf.u(total);
      ev[i] = total;
      continue;
    }
    if (node.kind === 'chance') {
      const terms: number[] = [];
      const evTerms: number[] = [];
      node.branches.forEach((b, k) => {
        const ci = entry.childIndices[k];
        terms.push(b.probability * eu[ci]);
        evTerms.push(b.probability * ev[ci]);
      });
      eu[i] = stableSum(terms);
      ev[i] = stableSum(evTerms);
      continue;
    }
    let bestIdx = 0;
    let bestEu = -Infinity;
    node.alternatives.forEach((_a, k) => {
      const ci = entry.childIndices[k];
      if (eu[ci] > bestEu) {
        bestEu = eu[ci];
        bestIdx = k;
      }
    });
    choice[i] = bestIdx;
    eu[i] = bestEu;
    ev[i] = ev[entry.childIndices[bestIdx]];
  }

  // Forward pass for reach probabilities under the optimal policy.
  const reach = new Array<number>(n).fill(0);
  reach[0] = 1;
  for (let i = 0; i < n; i++) {
    const entry = discovered[i];
    const node = entry.node;
    if (reach[i] === 0) continue;
    if (node.kind === 'chance') {
      node.branches.forEach((b, k) => {
        reach[entry.childIndices[k]] += reach[i] * b.probability;
      });
    } else if (node.kind === 'decision') {
      reach[entry.childIndices[choice[i]]] += reach[i];
    }
  }

  const nodes: Record<string, NodeValuation> = {};
  const nodeOrder: string[] = [];
  const policyMap: Record<string, number> = {};
  const policy: PolicyEntry[] = [];
  discovered.forEach((entry, i) => {
    const node = entry.node;
    const valuation: NodeValuation = {
      id: node.id,
      kind: node.kind,
      label: nodeLabel(node),
      depth: entry.depth,
      pathPayoff: entry.prefix,
      expectedUtility: eu[i],
      certaintyEquivalent: uf.inverse(eu[i]),
      expectedValue: ev[i],
      reachProbability: reach[i],
    };
    if (node.kind === 'decision') {
      const k = choice[i];
      valuation.chosenAlternative = { index: k, label: node.alternatives[k].label };
      policyMap[node.id] = k;
      policy.push({
        nodeId: node.id,
        nodeLabel: nodeLabel(node),
        alternativeIndex: k,
        alternativeLabel: node.alternatives[k].label,
        alternativeValues: node.alternatives.map((a, j) => ({
          label: a.label,
          certaintyEquivalent: uf.inverse(eu[entry.childIndices[j]]),
          expectedValue: ev[entry.childIndices[j]],
        })),
        reachProbability: reach[i],
      });
    }
    nodes[node.id] = valuation;
    nodeOrder.push(node.id);
  });

  // Trace the optimal path from the root until uncertainty forks it.
  const optimalPath: PathStep[] = [];
  let cursor: TreeNode | null = tree.root;
  let guard = 0;
  while (cursor && guard++ <= MAX_DEPTH) {
    const node: TreeNode = cursor;
    if (node.kind === 'terminal') {
      optimalPath.push({ nodeId: node.id, nodeLabel: nodeLabel(node), kind: 'terminal', payoff: node.payoff });
      break;
    }
    if (node.kind === 'chance') {
      optimalPath.push({
        nodeId: node.id,
        nodeLabel: nodeLabel(node),
        kind: 'chance',
        forks: node.branches.map((b) => ({ label: b.label, probability: b.probability })),
      });
      break;
    }
    const k = policyMap[node.id];
    const alt: Alternative = node.alternatives[k];
    optimalPath.push({
      nodeId: node.id,
      nodeLabel: nodeLabel(node),
      kind: 'decision',
      choice: alt.label,
      payoff: alt.payoff,
    });
    cursor = alt.child;
  }

  const riskProfile = strategyRiskProfile(tree, policyMap, 'Optimal strategy');
  const ce = uf.inverse(eu[0]);
  const rootEv = ev[0];

  return {
    treeId: tree.id,
    treeName: tree.name,
    unit: tree.unit,
    utilityLabel: uf.label,
    expectedUtility: eu[0],
    certaintyEquivalent: ce,
    expectedValue: rootEv,
    riskPremium: rootEv - ce,
    nodes,
    nodeOrder,
    policy,
    optimalPath,
    riskProfile,
    provenance: {
      exactness: 'exact',
      assumedInputs: [
        'The branch probabilities at every chance node are user assumptions.',
        'The payoffs at the leaves are user estimates.',
      ],
      regime: 'probabilities-given',
    },
    notes: [
      'Backward induction: expectation at chance nodes, maximisation at decision nodes. The arithmetic is exact for the inputs given.',
      'The traversal is iterative, so a deep tree cannot overflow the stack.',
      `Depth limit: ${MAX_DEPTH} levels; path limit for the risk profile: ${MAX_PATHS}.`,
      'The certainty equivalent is in the same units as the payoffs and counts cash flows along the whole path.',
      ...(spec.kind === 'linear'
        ? ['Under the linear utility the certainty equivalent equals the expected value and the risk premium is 0.']
        : ['The optimal policy maximises expected utility; the expected value shown is that of the same policy, not of the EV-maximising policy.']),
      ...uf.notes,
    ],
  };
}

/** The risk profile of one lottery, for comparing strategies side by side. */
export function lotteryRiskProfile(outcomes: OutcomePoint[], label = 'Lottery'): RiskProfile {
  const total = stableSum(outcomes.map((o) => o.probability));
  if (Math.abs(total - 1) > 1e-9) {
    throw new EngineError(`Outcome probabilities must sum to 1; they sum to ${total}.`, 'sum');
  }
  for (const o of outcomes) {
    if (!Number.isFinite(o.payoff)) throw new EngineError('Every outcome needs a finite payoff.', 'finite');
    if (!(o.probability >= 0 && o.probability <= 1)) {
      throw new EngineError('Every outcome probability must lie in [0, 1].', 'range');
    }
  }
  return buildRiskProfile(outcomes.map((o) => ({ payoff: o.payoff, probability: o.probability })), label);
}

/* ------------------------------------------------------- stochastic dominance */

export type DominanceOrder = 'first-order' | 'second-order' | 'none';

export interface DominanceResult {
  /** Which profile dominates, or null when neither does. */
  dominant: 'a' | 'b' | null;
  order: DominanceOrder;
  /** True when the two distributions are identical. */
  identical: boolean;
  expectedValues: { a: number; b: number };
  /** max over x of F_b(x) − F_a(x); positive when a is ahead somewhere. */
  maxCdfAdvantageA: number;
  maxCdfAdvantageB: number;
  statement: string;
  provenance: Provenance;
  notes: string[];
}

function cdfAt(profile: RiskProfile, x: number): number {
  let acc = 0;
  for (const o of profile.outcomes) {
    if (o.payoff <= x + 0) acc += o.probability;
    else break;
  }
  return Math.min(1, acc);
}

/**
 * First- and second-order stochastic dominance between two outcome
 * distributions.
 *
 * A first-order dominates B iff F_A(x) ≤ F_B(x) for every x, with strict
 * inequality somewhere: every decision maker who prefers more to less prefers
 * A, whatever their utility function. A second-order dominates B iff
 * ∫_{-∞}^{t} (F_B − F_A) dx ≥ 0 for every t: every *risk-averse* decision
 * maker prefers A. First-order dominance implies second-order dominance and
 * implies a higher (or equal) expected value.
 *
 * Both CDFs are step functions, so the comparison is checked exactly at the
 * breakpoints: the difference of the CDFs is piecewise constant and the
 * difference of their integrals piecewise linear, so a violation anywhere
 * shows up at a breakpoint.
 */
export function stochasticDominance(a: RiskProfile, b: RiskProfile, tol = 1e-12): DominanceResult {
  const support = [...new Set([...a.outcomes.map((o) => o.payoff), ...b.outcomes.map((o) => o.payoff)])].sort(
    (x, y) => x - y,
  );
  const fa = support.map((x) => cdfAt(a, x));
  const fb = support.map((x) => cdfAt(b, x));
  let aAhead = 0;
  let bAhead = 0;
  for (let i = 0; i < support.length; i++) {
    aAhead = Math.max(aAhead, fb[i] - fa[i]);
    bAhead = Math.max(bAhead, fa[i] - fb[i]);
  }
  const identical = aAhead <= tol && bAhead <= tol;
  // Integrated CDFs at each breakpoint.
  const intA: number[] = [];
  const intB: number[] = [];
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < support.length; i++) {
    if (i > 0) {
      const w = support[i] - support[i - 1];
      sa += fa[i - 1] * w;
      sb += fb[i - 1] * w;
    }
    intA.push(sa);
    intB.push(sb);
  }
  let aSsd = true;
  let bSsd = true;
  for (let i = 0; i < support.length; i++) {
    if (intA[i] - intB[i] > tol) aSsd = false;
    if (intB[i] - intA[i] > tol) bSsd = false;
  }
  const aFsd = bAhead <= tol && aAhead > tol;
  const bFsd = aAhead <= tol && bAhead > tol;

  let dominant: 'a' | 'b' | null = null;
  let order: DominanceOrder = 'none';
  if (aFsd) {
    dominant = 'a';
    order = 'first-order';
  } else if (bFsd) {
    dominant = 'b';
    order = 'first-order';
  } else if (!identical && aSsd && !bSsd) {
    dominant = 'a';
    order = 'second-order';
  } else if (!identical && bSsd && !aSsd) {
    dominant = 'b';
    order = 'second-order';
  }

  const names = { a: a.label, b: b.label };
  let statement: string;
  if (identical) {
    statement = `${names.a} and ${names.b} have the same outcome distribution; neither dominates.`;
  } else if (order === 'first-order') {
    const win = dominant === 'a' ? names.a : names.b;
    const lose = dominant === 'a' ? names.b : names.a;
    statement = `${win} dominates ${lose} in the first order: every decision maker who prefers more to less prefers it, with no utility function needed.`;
  } else if (order === 'second-order') {
    const win = dominant === 'a' ? names.a : names.b;
    const lose = dominant === 'a' ? names.b : names.a;
    statement = `${win} dominates ${lose} in the second order: every risk-averse decision maker prefers it, but a risk-seeking one need not.`;
  } else {
    statement = `Neither ${names.a} nor ${names.b} dominates the other at first or second order. The choice depends on the decision maker's risk attitude, so a utility function (or a direct judgement) is required.`;
  }

  return {
    dominant,
    order,
    identical,
    expectedValues: { a: a.expectedValue, b: b.expectedValue },
    maxCdfAdvantageA: aAhead,
    maxCdfAdvantageB: bAhead,
    statement,
    provenance: {
      exactness: 'exact',
      assumedInputs: ['The outcome probabilities of both strategies are user assumptions.'],
      regime: 'probabilities-given',
    },
    notes: [
      'Checked exactly at the breakpoints of the two step CDFs.',
      'First-order dominance implies second-order dominance and a weakly higher expected value.',
      'No dominance is not a tie: it means the comparison genuinely needs a risk attitude.',
    ],
  };
}

/** Narrowing helpers for consumers walking a tree. */
export const isChance = (n: TreeNode): n is ChanceNode => n.kind === 'chance';
export const isDecision = (n: TreeNode): n is DecisionPoint => n.kind === 'decision';
