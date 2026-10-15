/**
 * Exact inference for discrete Bayesian networks by variable elimination,
 * plus most-probable-explanation (MPE) and maximum-a-posteriori (MAP) queries
 * by max-product elimination.
 *
 * Every result is exact up to floating-point rounding: no sampling, no
 * iterative approximation. The cost of exactness is the size of the largest
 * intermediate factor, which grows with the induced treewidth of the
 * elimination ordering. That size is reported, and a query that would exceed
 * the configured limit is refused with the clique that caused it rather than
 * being attempted (a 2^40 table would hang the browser).
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import {
  Factor,
  argmaxIndex,
  decodeIndex,
  factorTotal,
  marginalizeFactor,
  marginalizeTo,
  maxOutFactor,
  multiplyAll,
  multiplyFactors,
  normalizeFactor,
  reduceFactor,
  scalarFactor,
  tableSize,
} from './factor';
import { EliminationHeuristic, greedyEliminationOrder } from './graph';
import { BayesNet, Evidence } from './network';

/** Default ceiling on a single intermediate table: 2^22 doubles = 32 MB. */
export const DEFAULT_MAX_FACTOR_ENTRIES = 1 << 22;

export interface InferenceOptions {
  /** Largest intermediate table permitted, in entries. */
  maxFactorEntries?: number;
  /** Greedy ordering heuristic. */
  heuristic?: EliminationHeuristic;
}

export interface InferenceDiagnostics {
  method: string;
  eliminationOrder: string[];
  /** Induced width of the ordering: the treewidth this elimination achieves. */
  inducedTreewidth: number;
  /** Entries in the largest intermediate factor actually built. */
  largestFactorEntries: number;
  /** Entries in the largest factor the ordering predicts (pre-flight bound). */
  predictedLargestFactorEntries: number;
  maxFactorEntries: number;
}

export interface MarginalDistribution {
  node: string;
  states: readonly string[];
  probabilities: number[];
}

export interface QueryResult {
  /** Posterior over the query variables, normalised, in the requested order. */
  joint: Factor;
  /** The same table before normalisation: P(query, evidence). */
  unnormalized: Factor;
  /** P(evidence). Equal to 1 when there is no evidence. */
  evidenceProbability: number;
  /** Per-variable marginals of the query variables. */
  marginals: MarginalDistribution[];
  exactness: Exactness;
  diagnostics: InferenceDiagnostics;
}

function distinct(ids: readonly string[], what: string): string[] {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new EngineError(`${what} lists "${id}" more than once.`, 'duplicate');
    seen.add(id);
  }
  return [...ids];
}

/** Build the interaction graph of a set of factor scopes. */
function scopeGraph(scopes: readonly (readonly string[])[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const touch = (v: string): Set<string> => {
    let s = adj.get(v);
    if (!s) {
      s = new Set();
      adj.set(v, s);
    }
    return s;
  };
  for (const scope of scopes) {
    for (const v of scope) touch(v);
    for (let i = 0; i < scope.length; i++) {
      for (let j = i + 1; j < scope.length; j++) {
        adj.get(scope[i])!.add(scope[j]);
        adj.get(scope[j])!.add(scope[i]);
      }
    }
  }
  return adj;
}

function preflight(
  net: BayesNet,
  cliques: readonly string[][],
  maxEntries: number,
  context: string,
): number {
  let worst = 1;
  let worstClique: readonly string[] = [];
  for (const clique of cliques) {
    const size = tableSize(clique.map((v) => net.cardinality(v)));
    if (size > worst) {
      worst = size;
      worstClique = clique;
    }
  }
  if (worst > maxEntries) {
    throw new EngineError(
      `${context} would need an intermediate table of ${worst} entries over ` +
        `[${worstClique.join(', ')}], over the configured limit of ${maxEntries}. ` +
        `This network's treewidth is too high for exact inference at that limit: raise maxFactorEntries if you have ` +
        `the memory, or use likelihood-weighted sampling for an approximate answer with a reported standard error.`,
      'size',
    );
  }
  return worst;
}

function zeroEvidence(net: BayesNet, evidence: ReadonlyMap<string, number>): never {
  const described = [...evidence].map(([id, s]) => `${id}=${net.stateName(id, s)}`).join(', ');
  throw new EngineError(
    `The evidence {${described}} has probability 0 under this model, so no conditional probability is defined. ` +
      `This is a contradiction in the model rather than a small number: some CPT entry on every path that could ` +
      `produce this combination is exactly 0.`,
    'zero-probability',
  );
}

/**
 * P(query | evidence) by variable elimination.
 *
 * Evidence is applied by restricting each CPT before elimination, which is
 * both faster and keeps intermediate tables smaller than multiplying in
 * indicators.
 */
export function query(
  net: BayesNet,
  queryVars: readonly string[],
  evidence?: Evidence,
  options: InferenceOptions = {},
): QueryResult {
  const maxEntries = options.maxFactorEntries ?? DEFAULT_MAX_FACTOR_ENTRIES;
  const heuristic = options.heuristic ?? 'min-fill';
  const targets = distinct(queryVars, 'The query');
  if (targets.length === 0) throw new EngineError('A query needs at least one variable.', 'required');
  for (const t of targets) net.node(t);
  const ev = net.resolveEvidence(evidence);

  // Fully observed nodes reduce to a constant factor, which is kept because it
  // still contributes to P(evidence).
  const reduced: Factor[] = net.nodes.map((node) => reduceFactor(net.factorOf(node.id), ev));
  const observedTargets = targets.filter((t) => ev.has(t));
  const freeTargets = targets.filter((t) => !ev.has(t));

  const present = new Set<string>();
  for (const f of reduced) for (const v of f.vars) present.add(v);
  const toEliminate = [...present].filter((v) => !freeTargets.includes(v));
  const adj = scopeGraph(reduced.map((f) => f.vars));
  const { order, inducedWidth, cliques } = greedyEliminationOrder(adj, toEliminate, heuristic);
  const predicted = preflight(net, cliques, maxEntries, `Query over [${targets.join(', ')}]`);

  let factors = reduced;
  let largest = 0;
  for (const f of factors) largest = Math.max(largest, f.values.length);
  for (const v of order) {
    const involved: Factor[] = [];
    const rest: Factor[] = [];
    for (const f of factors) (f.vars.includes(v) ? involved : rest).push(f);
    if (involved.length === 0) continue;
    const product = multiplyAll(involved, maxEntries);
    largest = Math.max(largest, product.values.length);
    rest.push(marginalizeFactor(product, [v]));
    factors = rest;
  }
  const combined = multiplyAll(factors, maxEntries);
  largest = Math.max(largest, combined.values.length);

  const total = factorTotal(combined);
  if (!(total > 0)) {
    if (ev.size > 0) zeroEvidence(net, ev);
    throw new EngineError(
      `The joint distribution over [${targets.join(', ')}] has total mass ${total}, which cannot happen for a ` +
        `validated network; the model is inconsistent.`,
      'zero-probability',
    );
  }

  // Re-attach any query variable that was itself observed, as a point mass.
  let unnormalized = marginalizeTo(combined, freeTargets);
  for (const t of observedTargets) {
    unnormalized = multiplyFactors(
      unnormalized,
      {
        vars: [t],
        card: [net.cardinality(t)],
        values: pointMass(net.cardinality(t), ev.get(t)!),
      },
      maxEntries,
    );
  }
  unnormalized = marginalizeTo(unnormalized, targets);
  const { factor: joint } = normalizeFactor(unnormalized, `P(${targets.join(', ')} | evidence)`);

  const marginals = targets.map((t) => ({
    node: t,
    states: net.node(t).states,
    probabilities: Array.from(marginalizeTo(joint, [t]).values),
  }));

  return {
    joint,
    unnormalized,
    evidenceProbability: total,
    marginals,
    exactness: 'exact',
    diagnostics: {
      method: `Variable elimination (${heuristic} ordering)`,
      eliminationOrder: order,
      inducedTreewidth: inducedWidth,
      largestFactorEntries: largest,
      predictedLargestFactorEntries: predicted,
      maxFactorEntries: maxEntries,
    },
  };
}

function pointMass(card: number, at: number): Float64Array {
  const v = new Float64Array(card);
  v[at] = 1;
  return v;
}

/** Marginal distribution of a single node, given evidence. */
export function marginal(
  net: BayesNet,
  node: string,
  evidence?: Evidence,
  options: InferenceOptions = {},
): MarginalDistribution & { evidenceProbability: number; exactness: Exactness; diagnostics: InferenceDiagnostics } {
  const r = query(net, [node], evidence, options);
  return {
    node,
    states: net.node(node).states,
    probabilities: Array.from(r.joint.values),
    evidenceProbability: r.evidenceProbability,
    exactness: r.exactness,
    diagnostics: r.diagnostics,
  };
}

/** P(node = state | evidence) as a single number. */
export function probabilityOf(
  net: BayesNet,
  node: string,
  state: string | number,
  evidence?: Evidence,
  options: InferenceOptions = {},
): number {
  const i = net.stateIndex(node, state);
  return marginal(net, node, evidence, options).probabilities[i];
}

export interface EvidenceProbabilityResult {
  probability: number;
  exactness: Exactness;
  diagnostics: InferenceDiagnostics;
}

/** P(evidence): the probability of the observation itself. */
export function evidenceProbability(
  net: BayesNet,
  evidence: Evidence,
  options: InferenceOptions = {},
): EvidenceProbabilityResult {
  const ev = net.resolveEvidence(evidence);
  if (ev.size === 0) {
    throw new EngineError('P(evidence) needs at least one observed variable.', 'required');
  }
  const maxEntries = options.maxFactorEntries ?? DEFAULT_MAX_FACTOR_ENTRIES;
  const heuristic = options.heuristic ?? 'min-fill';
  const reduced = net.nodes.map((n) => reduceFactor(net.factorOf(n.id), ev));
  const present = new Set<string>();
  for (const f of reduced) for (const v of f.vars) present.add(v);
  const adj = scopeGraph(reduced.map((f) => f.vars));
  const { order, inducedWidth, cliques } = greedyEliminationOrder(adj, [...present], heuristic);
  const predicted = preflight(net, cliques, maxEntries, 'P(evidence)');
  let factors = reduced;
  let largest = 0;
  for (const v of order) {
    const involved: Factor[] = [];
    const rest: Factor[] = [];
    for (const f of factors) (f.vars.includes(v) ? involved : rest).push(f);
    if (involved.length === 0) continue;
    const product = multiplyAll(involved, maxEntries);
    largest = Math.max(largest, product.values.length);
    rest.push(marginalizeFactor(product, [v]));
    factors = rest;
  }
  const total = factorTotal(multiplyAll(factors, maxEntries));
  if (!(total > 0)) zeroEvidence(net, ev);
  return {
    probability: total,
    exactness: 'exact',
    diagnostics: {
      method: `Variable elimination (${heuristic} ordering)`,
      eliminationOrder: order,
      inducedTreewidth: inducedWidth,
      largestFactorEntries: largest,
      predictedLargestFactorEntries: predicted,
      maxFactorEntries: maxEntries,
    },
  };
}

export interface ExplanationAssignment {
  /** node → state name. */
  assignment: Record<string, string>;
  /** node → state index. */
  indices: Record<string, number>;
  /** The joint probability P(assignment, evidence) of the winning row. */
  jointProbability: number;
  /** P(assignment | evidence). */
  conditionalProbability: number;
  evidenceProbability: number;
  exactness: Exactness;
  diagnostics: InferenceDiagnostics;
}

/**
 * Most probable explanation: the single most likely complete assignment to all
 * non-evidence variables, by max-product elimination with traceback.
 */
export function mostProbableExplanation(
  net: BayesNet,
  evidence?: Evidence,
  options: InferenceOptions = {},
): ExplanationAssignment {
  const ev = net.resolveEvidence(evidence);
  const all = net.nodes.map((n) => n.id);
  return maxProduct(net, all.filter((v) => !ev.has(v)), ev, options, 'Most probable explanation');
}

/**
 * Maximum a posteriori query: the most likely joint assignment to `queryVars`
 * with all other unobserved variables summed out. This is a different and
 * strictly harder question than MPE — the maximising assignment of a subset is
 * not in general the restriction of the MPE assignment.
 */
export function mapQuery(
  net: BayesNet,
  queryVars: readonly string[],
  evidence?: Evidence,
  options: InferenceOptions = {},
): ExplanationAssignment {
  const ev = net.resolveEvidence(evidence);
  const targets = distinct(queryVars, 'A MAP query');
  if (targets.length === 0) throw new EngineError('A MAP query needs at least one variable.', 'required');
  for (const t of targets) {
    net.node(t);
    if (ev.has(t)) {
      throw new EngineError(
        `MAP variable "${t}" is also given as evidence; it cannot be both observed and queried.`,
        'conflict',
      );
    }
  }
  return maxProduct(net, targets, ev, options, 'Maximum a posteriori');
}

function maxProduct(
  net: BayesNet,
  targets: readonly string[],
  ev: ReadonlyMap<string, number>,
  options: InferenceOptions,
  label: string,
): ExplanationAssignment {
  const maxEntries = options.maxFactorEntries ?? DEFAULT_MAX_FACTOR_ENTRIES;
  const heuristic = options.heuristic ?? 'min-fill';
  const reduced = net.nodes.map((n) => reduceFactor(net.factorOf(n.id), ev));
  const present = new Set<string>();
  for (const f of reduced) for (const v of f.vars) present.add(v);
  const targetSet = new Set(targets);
  const sumVars = [...present].filter((v) => !targetSet.has(v));
  const maxVars = [...present].filter((v) => targetSet.has(v));
  const adj = scopeGraph(reduced.map((f) => f.vars));
  // Sum variables must be eliminated before max variables: max and sum do not
  // commute, so the ordering is computed and checked in two stages.
  const first = greedyEliminationOrder(adj, sumVars, heuristic);
  let predicted = preflight(net, first.cliques, maxEntries, label);

  let factors = reduced;
  let largest = 0;
  const run = (order: readonly string[], how: 'sum' | 'max'): { v: string; product: Factor }[] => {
    const trace: { v: string; product: Factor }[] = [];
    for (const v of order) {
      const involved: Factor[] = [];
      const rest: Factor[] = [];
      for (const f of factors) (f.vars.includes(v) ? involved : rest).push(f);
      if (involved.length === 0) continue;
      const product = multiplyAll(involved, maxEntries);
      largest = Math.max(largest, product.values.length);
      rest.push(how === 'sum' ? marginalizeFactor(product, [v]) : maxOutFactor(product, [v]));
      if (how === 'max') trace.push({ v, product });
      factors = rest;
    }
    return trace;
  };
  run(first.order, 'sum');

  const second = greedyEliminationOrder(scopeGraph(factors.map((f) => f.vars)), maxVars, heuristic);
  predicted = Math.max(predicted, preflight(net, second.cliques, maxEntries, label));
  const trace = run(second.order, 'max');

  const finalFactor = multiplyAll(factors, maxEntries);
  const best = finalFactor.vars.length === 0 ? finalFactor.values[0] : Math.max(...finalFactor.values);
  if (!(best > 0)) {
    if (ev.size > 0) zeroEvidence(net, ev);
    throw new EngineError(`${label} failed: every assignment has probability 0 under this model.`, 'zero-probability');
  }

  const chosen = new Map<string, number>(ev);
  if (finalFactor.vars.length > 0) {
    const states = decodeIndex(finalFactor.card, argmaxIndex(finalFactor));
    for (let i = 0; i < finalFactor.vars.length; i++) chosen.set(finalFactor.vars[i], states[i]);
  }
  for (let i = trace.length - 1; i >= 0; i--) {
    const { v, product } = trace[i];
    const others = product.vars.filter((x) => x !== v);
    const slice = reduceFactor(product, restrict(chosen, others));
    chosen.set(v, argmaxIndex(slice));
  }

  const assignment: Record<string, string> = {};
  const indices: Record<string, number> = {};
  for (const t of targets) {
    const s = chosen.get(t);
    if (s === undefined) {
      // Variable absent from every factor after reduction cannot happen for a
      // validated network, but never guess a state if it does.
      throw new EngineError(`${label} could not determine a state for "${t}".`, 'internal');
    }
    indices[t] = s;
    assignment[t] = net.stateName(t, s);
  }
  const pe = ev.size ? evidenceProbability(net, evidenceObject(net, ev), options).probability : 1;
  return {
    assignment,
    indices,
    jointProbability: best,
    conditionalProbability: best / pe,
    evidenceProbability: pe,
    exactness: 'exact',
    diagnostics: {
      method: `${label} by max-product elimination (${heuristic} ordering)`,
      eliminationOrder: [...first.order, ...second.order],
      inducedTreewidth: Math.max(first.inducedWidth, second.inducedWidth),
      largestFactorEntries: largest,
      predictedLargestFactorEntries: predicted,
      maxFactorEntries: maxEntries,
    },
  };
}

function restrict(assignment: ReadonlyMap<string, number>, keep: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const k of keep) {
    const v = assignment.get(k);
    if (v !== undefined) out.set(k, v);
  }
  return out;
}

function evidenceObject(net: BayesNet, ev: ReadonlyMap<string, number>): Evidence {
  const out: Record<string, number> = {};
  for (const [k, v] of ev) {
    net.node(k);
    out[k] = v;
  }
  return out;
}

/** Product of the joint over no variables; exported for completeness. */
export const unitFactor = scalarFactor(1);
