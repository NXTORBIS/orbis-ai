/**
 * Fault trees: AND / OR / k-of-n / NOT gates over basic events.
 *
 * The exact top-event probability, the minimal cut sets, and the rare-event
 * approximation — which is always labelled as an approximation together with
 * its direction of bias (it overestimates).
 */

import { EngineError, Validator, type Exactness, type Explanation } from '../core/result';
import { clamp, stableSum } from '../core/numeric';
import { INDEPENDENCE_ASSUMED_NOTE, MAX_EXACT_SETS, inclusionExclusionUnion, minimalise } from './structures';

export type FaultTreeNode =
  | { id: string; kind: 'basic'; probability: number; label?: string }
  | { id: string; kind: 'and' | 'or'; children: string[]; label?: string }
  | { id: string; kind: 'kofn'; k: number; children: string[]; label?: string }
  | { id: string; kind: 'not'; children: string[]; label?: string };

export interface FaultTree {
  topId: string;
  nodes: FaultTreeNode[];
}

export interface FaultTreeValidation {
  nodesById: Map<string, FaultTreeNode>;
  basicEvents: string[];
  hasNot: boolean;
  /** Nodes in a post-order (children before parents) evaluation sequence. */
  order: string[];
}

/** Maximum basic events we will evaluate by exhaustive enumeration. */
export const MAX_ENUMERATION_EVENTS = 22;

export function validateFaultTree(tree: FaultTree): FaultTreeValidation {
  const v = new Validator();
  if (!tree || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    throw new EngineError('The fault tree has no nodes.', 'required');
  }
  const nodesById = new Map<string, FaultTreeNode>();
  for (const node of tree.nodes) {
    if (!node.id) {
      v.add('A fault tree node has no id.', 'nodes', 'required');
      continue;
    }
    if (nodesById.has(node.id)) {
      v.add(`Duplicate fault tree node id "${node.id}".`, node.id, 'duplicate');
      continue;
    }
    nodesById.set(node.id, node);
  }
  if (!tree.topId) v.add('The fault tree has no top event id.', 'topId', 'required');
  else if (!nodesById.has(tree.topId)) {
    v.add(`The top event "${tree.topId}" is not among the tree's nodes.`, 'topId', 'missing');
  }
  v.throwIfInvalid();

  const basicEvents: string[] = [];
  let hasNot = false;
  for (const node of nodesById.values()) {
    if (node.kind === 'basic') {
      if (!Number.isFinite(node.probability)) {
        v.add(`Basic event "${node.id}" has a non-finite probability.`, node.id, 'finite');
      } else if (node.probability < 0 || node.probability > 1) {
        v.add(
          `Basic event "${node.id}" has probability ${node.probability}, which is outside [0, 1].`,
          node.id,
          'range',
        );
      }
      basicEvents.push(node.id);
      continue;
    }
    if (!Array.isArray(node.children) || node.children.length === 0) {
      v.add(`Gate "${node.id}" (${node.kind}) has no inputs.`, node.id, 'required');
      continue;
    }
    for (const child of node.children) {
      if (!nodesById.has(child)) {
        v.add(`Gate "${node.id}" references an unknown node "${child}".`, node.id, 'missing');
      }
    }
    if (node.kind === 'not') {
      hasNot = true;
      if (node.children.length !== 1) {
        v.add(`A NOT gate takes exactly one input; "${node.id}" has ${node.children.length}.`, node.id, 'arity');
      }
    }
    if (node.kind === 'kofn') {
      const n = node.children.length;
      if (!Number.isInteger(node.k)) v.add(`Gate "${node.id}" needs a whole number k.`, node.id, 'integer');
      else if (node.k < 1) v.add(`Gate "${node.id}" needs k ≥ 1; got ${node.k}.`, node.id, 'range');
      else if (node.k > n) {
        v.add(
          `Gate "${node.id}" requires k = ${node.k} of only n = ${n} inputs; k must not exceed n.`,
          node.id,
          'range',
        );
      }
    }
  }
  v.throwIfInvalid();

  // Cycle detection with an explicit stack, reporting the actual cycle.
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of nodesById.keys()) colour.set(id, WHITE);
  const order: string[] = [];
  const path: string[] = [];
  const stack: Array<{ id: string; index: number }> = [];

  const childrenOf = (id: string): string[] => {
    const node = nodesById.get(id);
    if (!node) throw new EngineError(`Unknown fault tree node "${id}".`, 'missing');
    return node.kind === 'basic' ? [] : node.children;
  };

  for (const root of [tree.topId, ...nodesById.keys()]) {
    if (colour.get(root) !== WHITE) continue;
    stack.push({ id: root, index: 0 });
    colour.set(root, GREY);
    path.push(root);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const kids = childrenOf(frame.id);
      if (frame.index < kids.length) {
        const child = kids[frame.index];
        frame.index += 1;
        const c = colour.get(child);
        if (c === GREY) {
          const start = path.indexOf(child);
          const cycle = [...path.slice(start), child].join(' → ');
          throw new EngineError(
            `The fault tree contains a cycle: ${cycle}. A fault tree must be acyclic.`,
            'cycle',
          );
        }
        if (c === WHITE) {
          colour.set(child, GREY);
          path.push(child);
          stack.push({ id: child, index: 0 });
        }
        continue;
      }
      colour.set(frame.id, BLACK);
      order.push(frame.id);
      path.pop();
      stack.pop();
    }
  }

  return { nodesById, basicEvents: basicEvents.sort(), hasNot, order };
}

/** Evaluates the tree's gate logic for one assignment of the basic events. */
export function evaluateFaultTreeLogic(
  validation: FaultTreeValidation,
  topId: string,
  state: Readonly<Record<string, boolean>>,
): boolean {
  const value = new Map<string, boolean>();
  for (const id of validation.order) {
    const node = validation.nodesById.get(id);
    if (!node) throw new EngineError(`Unknown fault tree node "${id}".`, 'missing');
    if (node.kind === 'basic') {
      const s = state[id];
      if (s === undefined) throw new EngineError(`No state supplied for basic event "${id}".`, 'required');
      value.set(id, s);
      continue;
    }
    const kids = node.children.map((c) => {
      const got = value.get(c);
      if (got === undefined) throw new EngineError(`Node "${c}" was evaluated out of order.`, 'numerical');
      return got;
    });
    if (node.kind === 'and') value.set(id, kids.every(Boolean));
    else if (node.kind === 'or') value.set(id, kids.some(Boolean));
    else if (node.kind === 'not') value.set(id, !kids[0]);
    else if (node.kind === 'kofn') value.set(id, kids.filter(Boolean).length >= node.k);
    else throw new EngineError(`Unknown gate kind on node "${id}".`, 'kind');
  }
  const top = value.get(topId);
  if (top === undefined) throw new EngineError(`The top event "${topId}" was not evaluated.`, 'numerical');
  return top;
}

/**
 * Minimal cut sets of a coherent fault tree (no NOT gates), bottom-up.
 * A NOT gate makes the tree non-coherent, for which "minimal cut set" is not
 * defined; that is refused rather than silently answered.
 */
export function faultTreeMinimalCutSets(tree: FaultTree): string[][] {
  const validation = validateFaultTree(tree);
  if (validation.hasNot) {
    throw new EngineError(
      'This fault tree contains a NOT gate, so it is non-coherent and minimal cut sets are not defined for it. ' +
        'Use the exact top-event probability instead.',
      'noncoherent',
    );
  }
  const sets = new Map<string, string[][]>();
  const combine = (groups: string[][][], limit: number): string[][] => {
    let acc: string[][] = [[]];
    for (const g of groups) {
      const next: string[][] = [];
      for (const a of acc) {
        for (const b of g) {
          next.push([...a, ...b]);
          if (next.length > limit) {
            throw new EngineError(
              `Minimal cut set generation exceeded ${limit} candidates; the tree is too large for exact expansion.`,
              'size',
            );
          }
        }
      }
      acc = minimalise(next);
    }
    return acc;
  };
  const choose = <T,>(items: readonly T[], k: number): T[][] => {
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
  };
  for (const id of validation.order) {
    const node = validation.nodesById.get(id);
    if (!node) continue;
    if (node.kind === 'basic') {
      sets.set(id, [[id]]);
      continue;
    }
    const groups = node.children.map((c) => sets.get(c) ?? []);
    if (node.kind === 'or') sets.set(id, minimalise(groups.flat()));
    else if (node.kind === 'and') sets.set(id, combine(groups, 200000));
    else if (node.kind === 'kofn') {
      const out: string[][] = [];
      for (const combo of choose(groups, node.k)) out.push(...combine(combo, 200000));
      sets.set(id, minimalise(out));
    }
  }
  const result = sets.get(tree.topId);
  if (!result) throw new EngineError(`Could not derive cut sets for top event "${tree.topId}".`, 'numerical');
  return minimalise(result);
}

export interface FaultTreeResult {
  topEventProbability: number;
  exactness: Exactness;
  method: 'inclusion-exclusion over minimal cut sets' | 'exhaustive enumeration of basic events';
  minimalCutSets: string[][] | null;
  independenceAssumed: boolean;
  independenceNote: string;
  explanation: Explanation;
}

export function faultTreeProbability(tree: FaultTree): FaultTreeResult {
  const validation = validateFaultTree(tree);
  const probabilityOf = (id: string): number => {
    const node = validation.nodesById.get(id);
    if (!node || node.kind !== 'basic') throw new EngineError(`"${id}" is not a basic event.`, 'invalid');
    return node.probability;
  };

  if (!validation.hasNot) {
    const cuts = faultTreeMinimalCutSets(tree);
    if (cuts.length <= MAX_EXACT_SETS) {
      const p = inclusionExclusionUnion(cuts, probabilityOf);
      return {
        topEventProbability: p,
        exactness: 'exact',
        method: 'inclusion-exclusion over minimal cut sets',
        minimalCutSets: cuts,
        independenceAssumed: true,
        independenceNote: INDEPENDENCE_ASSUMED_NOTE,
        explanation: {
          method: 'Exact top-event probability by inclusion–exclusion over minimal cut sets',
          formula: 'P(top) = Σ_{∅≠S⊆cuts} (−1)^{|S|+1} Π_{e ∈ ∪S} p_e',
          steps: [
            { label: 'Minimal cut sets', value: String(cuts.length) },
            { label: 'P(top event)', value: p.toPrecision(10) },
          ],
          assumptions: [INDEPENDENCE_ASSUMED_NOTE],
          limitations: [`Exact inclusion–exclusion is limited to ${MAX_EXACT_SETS} minimal cut sets.`],
          exactness: 'exact',
        },
      };
    }
  }

  const events = validation.basicEvents;
  if (events.length > MAX_ENUMERATION_EVENTS) {
    throw new EngineError(
      `This fault tree has ${events.length} basic events and cannot be reduced to at most ${MAX_EXACT_SETS} ` +
        `minimal cut sets, so no exact method applies (exhaustive enumeration is limited to ` +
        `${MAX_ENUMERATION_EVENTS} basic events). No approximate number is returned in its place.`,
      'size',
    );
  }
  const n = events.length;
  const terms: number[] = [];
  for (let mask = 0; mask < 1 << n; mask += 1) {
    const state: Record<string, boolean> = {};
    let weight = 1;
    for (let i = 0; i < n; i += 1) {
      const on = (mask & (1 << i)) !== 0;
      state[events[i]] = on;
      const p = probabilityOf(events[i]);
      weight *= on ? p : 1 - p;
    }
    if (weight === 0) continue;
    if (evaluateFaultTreeLogic(validation, tree.topId, state)) terms.push(weight);
  }
  const p = clamp(stableSum(terms), 0, 1);
  return {
    topEventProbability: p,
    exactness: 'exact',
    method: 'exhaustive enumeration of basic events',
    minimalCutSets: null,
    independenceAssumed: true,
    independenceNote: INDEPENDENCE_ASSUMED_NOTE,
    explanation: {
      method: 'Exact top-event probability by exhaustive enumeration of basic-event states',
      formula: 'P(top) = Σ_states 1[top] · Π p_e^{x_e}(1−p_e)^{1−x_e}',
      steps: [
        { label: 'Basic events', value: String(n) },
        { label: 'States enumerated', value: String(1 << n) },
        { label: 'P(top event)', value: p.toPrecision(10) },
      ],
      assumptions: [
        INDEPENDENCE_ASSUMED_NOTE,
        'NOT gates make the tree non-coherent, so enumeration is used instead of cut sets.',
      ],
      limitations: [`Limited to ${MAX_ENUMERATION_EVENTS} basic events.`],
      exactness: 'exact',
    },
  };
}

export interface RareEventResult {
  /** Σ over minimal cut sets of the cut probability. */
  value: number;
  exactness: Exactness;
  isApproximation: true;
  /** Always 'over': the rare-event sum omits the subtracted overlap terms. */
  biasDirection: 'over';
  note: string;
  minimalCutSets: string[][];
}

/**
 * Rare-event approximation: the sum of minimal cut set probabilities. This is
 * the first term of inclusion–exclusion, so it always OVERESTIMATES the exact
 * top-event probability (it is a conservative upper bound while it stays ≤ 1).
 */
export function rareEventApproximation(tree: FaultTree): RareEventResult {
  const validation = validateFaultTree(tree);
  const cuts = faultTreeMinimalCutSets(tree);
  const values = cuts.map((cut) => {
    let p = 1;
    for (const id of cut) {
      const node = validation.nodesById.get(id);
      if (!node || node.kind !== 'basic') throw new EngineError(`"${id}" is not a basic event.`, 'invalid');
      p *= node.probability;
    }
    return p;
  });
  const sum = stableSum(values);
  return {
    value: sum,
    exactness: 'numerical',
    isApproximation: true,
    biasDirection: 'over',
    note:
      'Rare-event approximation: the sum of minimal cut set probabilities. This is the leading term of ' +
      'inclusion–exclusion with the subtracted overlap terms dropped, so it OVERESTIMATES the exact top-event ' +
      'probability. It is accurate only when the cut probabilities are small. ' +
      (sum > 1 ? 'Here the sum exceeds 1, so it is not even a probability — use the exact value. ' : '') +
      INDEPENDENCE_ASSUMED_NOTE,
    minimalCutSets: cuts,
  };
}
