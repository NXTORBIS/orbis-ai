/**
 * Causal reasoning on a discrete Bayesian network: the do-operator by graph
 * surgery, the back-door and front-door criteria, adjustment-set search, and
 * identification of confounders, mediators and colliders.
 *
 * The central distinction: P(Y | X = x) is what you see among the units that
 * happen to have X = x; P(Y | do(X = x)) is what you would see if X were set
 * to x for everyone. They differ exactly when an unblocked back-door path
 * (confounding) connects X and Y, and showing that difference is the point.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { DiGraph, ancestorsOf, descendantsOf, directedPaths } from './graph';
import { dSeparated } from './dseparation';
import { BayesNet, Evidence } from './network';
import { InferenceOptions, query } from './inference';

/** Graph with every edge out of `cut` removed (the back-door graph G_X̲). */
export function cutOutgoing(graph: DiGraph, cut: Iterable<string>): DiGraph {
  const cutSet = new Set(cut);
  const parents = new Map<string, string[]>();
  for (const n of graph.nodes) {
    parents.set(n, (graph.parents.get(n) ?? []).filter((p) => !cutSet.has(p)));
  }
  return { nodes: [...graph.nodes], parents };
}

/** Graph with every edge into `cut` removed (the intervention graph G_X̄). */
export function cutIncoming(graph: DiGraph, cut: Iterable<string>): DiGraph {
  const cutSet = new Set(cut);
  const parents = new Map<string, string[]>();
  for (const n of graph.nodes) parents.set(n, cutSet.has(n) ? [] : [...(graph.parents.get(n) ?? [])]);
  return { nodes: [...graph.nodes], parents };
}

export interface InterventionComparison {
  treatment: string;
  treatmentState: string;
  outcome: string;
  states: readonly string[];
  /** P(Y | do(X = x)) from the mutilated graph. */
  intervention: number[];
  /** P(Y | X = x) from the observational model. */
  conditioning: number[];
  /** intervention − conditioning, per outcome state. */
  difference: number[];
  /** Largest absolute difference. */
  maxAbsoluteDifference: number;
  /** True when the two coincide to within `tolerance`. */
  agree: boolean;
  confounded: boolean;
  explanation: string;
  exactness: Exactness;
}

/** P(Y | do(X = x)) by graph surgery, with the observational P(Y | X = x) beside it. */
export function interventionDistribution(
  net: BayesNet,
  treatment: string,
  treatmentState: string | number,
  outcome: string,
  options: InferenceOptions & { tolerance?: number } = {},
): InterventionComparison {
  const tolerance = options.tolerance ?? 1e-12;
  net.node(treatment);
  net.node(outcome);
  if (treatment === outcome) {
    throw new EngineError(`The treatment and the outcome are both "${treatment}"; choose different nodes.`, 'conflict');
  }
  const stateIndex = net.stateIndex(treatment, treatmentState);
  const stateName = net.stateName(treatment, stateIndex);
  const surgical = net.intervene({ [treatment]: stateIndex });
  const doDist = query(surgical, [outcome], undefined, options).joint.values;
  const obsDist = query(net, [outcome], { [treatment]: stateIndex }, options).joint.values;
  const difference = Array.from(doDist, (p, i) => p - obsDist[i]);
  const maxAbs = difference.reduce((m, d) => Math.max(m, Math.abs(d)), 0);
  const backdoor = hasOpenBackdoorPath(net.graph, treatment, outcome);
  const agree = maxAbs <= tolerance;
  return {
    treatment,
    treatmentState: stateName,
    outcome,
    states: net.node(outcome).states,
    intervention: Array.from(doDist),
    conditioning: Array.from(obsDist),
    difference,
    maxAbsoluteDifference: maxAbs,
    agree,
    confounded: backdoor.open,
    explanation: agree
      ? `P(${outcome} | do(${treatment}=${stateName})) equals P(${outcome} | ${treatment}=${stateName}). ` +
        (backdoor.open
          ? `A back-door path exists but the numbers happen to coincide for these parameters.`
          : `There is no unblocked back-door path from "${treatment}" to "${outcome}", so conditioning is already causal here.`)
      : `P(${outcome} | do(${treatment}=${stateName})) differs from P(${outcome} | ${treatment}=${stateName}) by up to ` +
        `${maxAbs.toExponential(3)}. ` +
        (backdoor.open
          ? `The back-door path ${backdoor.paths[0]} is open, so the observational comparison is confounded: ` +
            `units with ${treatment}=${stateName} differ from the population in ways that also affect ${outcome}.`
          : `The difference comes from conditioning on a descendant structure rather than from back-door confounding.`),
    exactness: 'exact',
  };
}

/** P(Y | do(X = x)) alone, as a distribution over Y's states. */
export function doQuery(
  net: BayesNet,
  intervention: Evidence,
  outcome: readonly string[],
  observations?: Evidence,
  options: InferenceOptions = {},
): { probabilities: number[]; states: readonly (readonly string[])[]; exactness: Exactness } {
  const surgical = net.intervene(intervention);
  const r = query(surgical, outcome, observations, options);
  return {
    probabilities: Array.from(r.joint.values),
    states: outcome.map((o) => net.node(o).states),
    exactness: 'exact',
  };
}

function hasOpenBackdoorPath(graph: DiGraph, x: string, y: string): { open: boolean; paths: string[] } {
  const gx = cutOutgoing(graph, [x]);
  const r = dSeparated(gx, [x], [y], []);
  return { open: !r.separated, paths: r.activePaths.map((p) => p.description) };
}

export interface AdjustmentCheck {
  set: string[];
  valid: boolean;
  reasons: string[];
}

/**
 * Back-door criterion. A set Z is admissible for (X, Y) when
 *  (1) no member of Z is a descendant of X, and
 *  (2) Z blocks every back-door path from X to Y, i.e. X and Y are
 *      d-separated given Z in the graph with X's outgoing edges removed.
 * Then P(Y | do(X=x)) = Σ_z P(Y | X=x, Z=z) P(Z=z).
 */
export function checkBackdoor(net: BayesNet, x: string, y: string, z: readonly string[]): AdjustmentCheck {
  net.node(x);
  net.node(y);
  const set = [...new Set(z)];
  for (const v of set) net.node(v);
  const reasons: string[] = [];
  let valid = true;
  if (set.includes(x)) {
    reasons.push(`The adjustment set contains the treatment "${x}" itself.`);
    valid = false;
  }
  if (set.includes(y)) {
    reasons.push(`The adjustment set contains the outcome "${y}" itself.`);
    valid = false;
  }
  const graph = net.graph;
  const descX = descendantsOf(graph, [x]);
  for (const v of set) {
    if (descX.has(v)) {
      reasons.push(
        `"${v}" is a descendant of the treatment "${x}". Conditioning on it blocks part of the causal effect, ` +
          `or (if it is a collider) creates new spurious dependence, so the back-door criterion excludes it.`,
      );
      valid = false;
    }
  }
  if (valid) {
    const gx = cutOutgoing(graph, [x]);
    const sep = dSeparated(gx, [x], [y], set);
    if (!sep.separated) {
      valid = false;
      reasons.push(
        `The back-door path ${sep.activePaths[0].description} stays open given {${set.join(', ') || '∅'}}, ` +
          `so confounding remains.`,
      );
    } else {
      reasons.push(
        `Every back-door path from "${x}" to "${y}" is blocked by {${set.join(', ') || '∅'}}, and no member is a ` +
          `descendant of "${x}", so the effect is identified by adjustment.`,
      );
    }
  }
  return { set, valid, reasons };
}

export interface AdjustmentSearchResult {
  /** All valid sets of the smallest admissible size (possibly the empty set). */
  minimalSets: string[][];
  /** True when no adjustment is needed at all. */
  emptySetSufficient: boolean;
  /** Variables considered as candidates. */
  candidates: string[];
  /** Sets examined and rejected, with the reason, for the explanation. */
  rejected: AdjustmentCheck[];
  identifiable: boolean;
  explanation: string;
}

/**
 * Search for a minimal admissible back-door adjustment set by increasing size.
 * Candidates exclude X, Y and every descendant of X, since those can never be
 * part of an admissible set.
 */
export function findBackdoorAdjustmentSets(
  net: BayesNet,
  x: string,
  y: string,
  options: { maxSetSize?: number; maxCandidates?: number } = {},
): AdjustmentSearchResult {
  net.node(x);
  net.node(y);
  const maxSetSize = options.maxSetSize ?? 4;
  const maxCandidates = options.maxCandidates ?? 24;
  const graph = net.graph;
  const descX = descendantsOf(graph, [x]);
  const relevant = new Set<string>([
    ...ancestorsOf(graph, [x, y]),
    x,
    y,
  ]);
  const candidates = graph.nodes.filter((n) => n !== x && n !== y && !descX.has(n) && relevant.has(n));
  if (candidates.length > maxCandidates) {
    throw new EngineError(
      `There are ${candidates.length} candidate adjustment variables for (${x} -> ${y}), over the search limit of ` +
        `${maxCandidates}. Narrow the candidate set or raise maxCandidates; an exhaustive search over ` +
        `2^${candidates.length} subsets is not feasible.`,
      'size',
    );
  }
  const rejected: AdjustmentCheck[] = [];
  for (let size = 0; size <= Math.min(maxSetSize, candidates.length); size++) {
    const found: string[][] = [];
    for (const subset of combinations(candidates, size)) {
      const check = checkBackdoor(net, x, y, subset);
      if (check.valid) found.push(subset);
      else rejected.push(check);
    }
    if (found.length) {
      return {
        minimalSets: found,
        emptySetSufficient: size === 0,
        candidates,
        rejected,
        identifiable: true,
        explanation:
          size === 0
            ? `No adjustment is needed: there is no unblocked back-door path from "${x}" to "${y}", so ` +
              `P(${y} | do(${x})) = P(${y} | ${x}).`
            : `The effect of "${x}" on "${y}" is identified by adjusting for ` +
              found.map((s) => `{${s.join(', ')}}`).join(' or ') +
              `; each of these is a minimal admissible set of size ${size}.`,
      };
    }
  }
  return {
    minimalSets: [],
    emptySetSufficient: false,
    candidates,
    rejected,
    identifiable: false,
    explanation:
      `No admissible back-door adjustment set of size ${maxSetSize} or less was found for (${x} -> ${y}) among ` +
      `{${candidates.join(', ')}}. The effect may still be identified by the front-door criterion or another ` +
      `strategy, but it is not identified by back-door adjustment on these variables.`,
  };
}

function* combinations(items: readonly string[], k: number): Generator<string[]> {
  if (k === 0) {
    yield [];
    return;
  }
  const idx = Array.from({ length: k }, (_, i) => i);
  if (k > items.length) return;
  for (;;) {
    yield idx.map((i) => items[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === items.length - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** Σ_z P(Y | X=x, Z=z) · P(Z=z): the back-door adjustment formula. */
export function backdoorAdjustedDistribution(
  net: BayesNet,
  x: string,
  xState: string | number,
  y: string,
  z: readonly string[],
  options: InferenceOptions = {},
): { probabilities: number[]; states: readonly string[]; adjustmentSet: string[]; exactness: Exactness } {
  const check = checkBackdoor(net, x, y, z);
  if (!check.valid) {
    throw new EngineError(
      `{${check.set.join(', ') || '∅'}} is not an admissible back-door adjustment set for (${x} -> ${y}): ` +
        check.reasons.join(' '),
      'identification',
    );
  }
  const xi = net.stateIndex(x, xState);
  const k = net.cardinality(y);
  const out = new Array<number>(k).fill(0);
  const zs = [...z];
  if (zs.length === 0) {
    const d = query(net, [y], { [x]: xi }, options).joint.values;
    return { probabilities: Array.from(d), states: net.node(y).states, adjustmentSet: zs, exactness: 'exact' };
  }
  const zMarginal = query(net, zs, undefined, options).joint;
  const cards = zs.map((v) => net.cardinality(v));
  const total = cards.reduce((a, b) => a * b, 1);
  for (let idx = 0; idx < total; idx++) {
    let rest = idx;
    const assignment: Record<string, number> = { [x]: xi };
    for (let i = zs.length - 1; i >= 0; i--) {
      assignment[zs[i]] = rest % cards[i];
      rest = Math.floor(rest / cards[i]);
    }
    const pz = zMarginal.values[idx];
    if (pz === 0) continue;
    const cond = query(net, [y], assignment, options).joint.values;
    for (let j = 0; j < k; j++) out[j] += cond[j] * pz;
  }
  return { probabilities: out, states: net.node(y).states, adjustmentSet: zs, exactness: 'exact' };
}

export interface FrontdoorCheck {
  set: string[];
  valid: boolean;
  reasons: string[];
}

/**
 * Front-door criterion. Z satisfies it for (X, Y) when
 *  (1) Z intercepts every directed path from X to Y,
 *  (2) there is no unblocked back-door path from X to Z, and
 *  (3) every back-door path from Z to Y is blocked by X.
 * Then P(Y | do(X=x)) = Σ_z P(z | x) Σ_x' P(Y | x', z) P(x').
 */
export function checkFrontdoor(net: BayesNet, x: string, y: string, z: readonly string[]): FrontdoorCheck {
  net.node(x);
  net.node(y);
  const set = [...new Set(z)];
  for (const v of set) net.node(v);
  const reasons: string[] = [];
  let valid = true;
  if (set.length === 0) {
    return { set, valid: false, reasons: ['The front-door criterion needs at least one mediating variable.'] };
  }
  if (set.includes(x) || set.includes(y)) {
    return { set, valid: false, reasons: [`The mediator set must not contain "${x}" or "${y}".`] };
  }
  const graph = net.graph;
  const paths = directedPaths(graph, x, y);
  if (paths.length === 0) {
    reasons.push(`There is no directed path from "${x}" to "${y}", so there is no causal effect to identify.`);
    valid = false;
  }
  const uncovered = paths.filter((p) => !p.some((n) => set.includes(n)));
  if (uncovered.length) {
    reasons.push(
      `The directed path ${uncovered[0].join(' -> ')} does not pass through {${set.join(', ')}}, so the mediator ` +
        `set does not intercept all of the causal effect.`,
    );
    valid = false;
  }
  const gx = cutOutgoing(graph, [x]);
  const backXZ = dSeparated(gx, [x], set, []);
  if (!backXZ.separated) {
    reasons.push(
      `The back-door path ${backXZ.activePaths[0].description} from "${x}" to the mediators is open, so condition (2) fails.`,
    );
    valid = false;
  }
  const gz = cutOutgoing(graph, set);
  const backZY = dSeparated(gz, set, [y], [x]);
  if (!backZY.separated) {
    reasons.push(
      `The back-door path ${backZY.activePaths[0].description} from the mediators to "${y}" stays open given "${x}", ` +
        `so condition (3) fails.`,
    );
    valid = false;
  }
  if (valid) {
    reasons.push(
      `{${set.join(', ')}} intercepts every directed path from "${x}" to "${y}", has no open back-door path from ` +
        `"${x}", and its back-door paths to "${y}" are blocked by "${x}": the front-door formula identifies the effect.`,
    );
  }
  return { set, valid, reasons };
}

export interface CausalRoles {
  treatment: string;
  outcome: string;
  /** Common causes of treatment and outcome: adjusting for these removes bias. */
  confounders: string[];
  /** Nodes on a directed path from treatment to outcome. */
  mediators: string[];
  /** Common effects of treatment and outcome (and their descendants). */
  colliders: string[];
  /** Descendants of the outcome: never adjust for these. */
  outcomeDescendants: string[];
  /** Descendants of the treatment that are not mediators. */
  treatmentDescendants: string[];
  openBackdoorPaths: string[];
  warnings: string[];
  notes: string[];
}

/**
 * Classify the variables around a treatment–outcome pair.
 *
 * The collider warning matters more than it looks: conditioning on a common
 * effect of two variables CREATES a dependence between them that does not
 * exist in the population. Adding a collider to an adjustment set makes an
 * unbiased estimate biased, which is the opposite of the usual intuition that
 * controlling for more variables is safer.
 */
export function causalRoles(net: BayesNet, treatment: string, outcome: string): CausalRoles {
  net.node(treatment);
  net.node(outcome);
  if (treatment === outcome) {
    throw new EngineError(`The treatment and outcome are both "${treatment}".`, 'conflict');
  }
  const graph = net.graph;
  const ancT = ancestorsOf(graph, [treatment]);
  const ancY = ancestorsOf(graph, [outcome]);
  const descT = descendantsOf(graph, [treatment]);
  const descY = descendantsOf(graph, [outcome]);

  const mediators = [...descT].filter((n) => ancY.has(n) && n !== outcome).sort();
  const mediatorSet = new Set(mediators);
  const confounders = [...ancT].filter((n) => ancY.has(n) && !mediatorSet.has(n) && !descT.has(n)).sort();

  // A node is a collider for this pair when two of its parents are reachable
  // from the treatment side and the outcome side respectively.
  const colliderSeeds: string[] = [];
  for (const n of graph.nodes) {
    const ps = graph.parents.get(n) ?? [];
    if (ps.length < 2) continue;
    const fromT = ps.filter((p) => p === treatment || descT.has(p));
    const fromY = ps.filter((p) => p === outcome || descY.has(p));
    const hasPair = fromT.some((a) => fromY.some((b) => a !== b));
    if (hasPair) colliderSeeds.push(n);
  }
  const colliders = [...new Set([...colliderSeeds, ...descendantsOf(graph, colliderSeeds)])].sort();

  const open = dSeparated(cutOutgoing(graph, [treatment]), [treatment], [outcome], []);
  const warnings: string[] = [];
  if (colliders.length) {
    warnings.push(
      `Collider bias risk: {${colliders.join(', ')}} ${colliders.length === 1 ? 'is a common effect' : 'are common effects'} ` +
        `of "${treatment}" and "${outcome}" (or descendants of one). Conditioning on such a variable CREATES a ` +
        `dependence between treatment and outcome that is not there in the population, so including it in an ` +
        `adjustment set introduces bias rather than removing it.`,
    );
  }
  if (descY.size) {
    warnings.push(
      `Never adjust for descendants of the outcome ({${[...descY].sort().join(', ')}}): they are downstream of the ` +
        `effect you are trying to measure.`,
    );
  }
  if (mediators.length) {
    warnings.push(
      `{${mediators.join(', ')}} ${mediators.length === 1 ? 'is a mediator' : 'are mediators'} on the causal path. ` +
        `Adjusting for a mediator removes the part of the effect that flows through it, giving a direct rather than ` +
        `a total effect.`,
    );
  }
  const notes: string[] = [];
  notes.push(
    open.separated
      ? `There is no open back-door path from "${treatment}" to "${outcome}", so P(${outcome} | ${treatment}) is ` +
        `already the causal quantity.`
      : `Confounding is present: ${open.activePaths.length} back-door trail(s) remain open with nothing adjusted for.`,
  );
  if (confounders.length) {
    notes.push(`Common causes of both: {${confounders.join(', ')}}.`);
  }
  return {
    treatment,
    outcome,
    confounders,
    mediators,
    colliders,
    outcomeDescendants: [...descY].sort(),
    treatmentDescendants: [...descT].filter((n) => !mediatorSet.has(n) && n !== outcome).sort(),
    openBackdoorPaths: open.activePaths.map((p) => p.description),
    warnings,
    notes,
  };
}
