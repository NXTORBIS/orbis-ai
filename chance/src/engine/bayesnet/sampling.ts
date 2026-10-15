/**
 * Sampling from a discrete Bayesian network.
 *
 *  - Forward (ancestral) sampling draws complete configurations from the joint
 *    distribution by walking the topological order.
 *  - Likelihood weighting handles evidence without rejection: evidence nodes
 *    are clamped and the sample carries the product of their conditional
 *    probabilities as its weight.
 *
 * Both are EMPIRICAL estimates. Likelihood weighting degenerates when the
 * evidence is unlikely — a handful of samples end up carrying almost all the
 * weight — so the effective sample size is reported with every result. An ESS
 * of 40 out of 200,000 draws is a warning that the numbers mean very little,
 * and the caller is told rather than left to assume the estimate is good.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { Random, Seed } from '../random/rng';
import { BayesNet, Evidence } from './network';

export interface SampleStats {
  node: string;
  states: readonly string[];
  probabilities: number[];
  /** Standard error of each probability estimate. */
  standardErrors: number[];
}

export interface ForwardSamplingResult {
  samples: number;
  marginals: SampleStats[];
  byNode: Record<string, number[]>;
  exactness: Exactness;
  method: string;
}

function parentRowIndex(net: BayesNet, node: string, states: ReadonlyMap<string, number>): number {
  let idx = 0;
  for (const p of net.parentsOf(node)) {
    const s = states.get(p);
    if (s === undefined) {
      throw new EngineError(
        `Cannot sample "${node}": its parent "${p}" has no value yet. The sampling order is not topological.`,
        'internal',
      );
    }
    idx = idx * net.cardinality(p) + s;
  }
  return idx;
}

function drawFromRow(row: readonly number[], u: number, node: string, rowIndex: number): number {
  let acc = 0;
  for (let i = 0; i < row.length; i++) {
    acc += row[i];
    if (u < acc) return i;
  }
  // Only reachable through floating-point slack at the very top of [0,1).
  for (let i = row.length - 1; i >= 0; i--) if (row[i] > 0) return i;
  throw new EngineError(
    `CPT row ${rowIndex} of node "${node}" has no positive probability, so no state can be drawn.`,
    'zero-probability',
  );
}

/** One complete draw from the joint distribution, as node → state index. */
export function forwardSample(net: BayesNet, rng: Random): Map<string, number> {
  const states = new Map<string, number>();
  for (const id of net.order) {
    const row = net.node(id).cpt[parentRowIndex(net, id, states)];
    states.set(id, drawFromRow(row, rng.uniform(), id, 0));
  }
  return states;
}

/** Forward sampling estimates of every node's marginal distribution. */
export function forwardSamplingMarginals(net: BayesNet, samples: number, seed: Seed): ForwardSamplingResult {
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new EngineError(`The number of samples must be a positive whole number, not ${samples}.`, 'range');
  }
  const rng = new Random(seed);
  const counts = new Map<string, Float64Array>();
  for (const n of net.nodes) counts.set(n.id, new Float64Array(n.states.length));
  const states = new Map<string, number>();
  for (let t = 0; t < samples; t++) {
    states.clear();
    for (const id of net.order) {
      const row = net.node(id).cpt[parentRowIndex(net, id, states)];
      states.set(id, drawFromRow(row, rng.uniform(), id, 0));
    }
    for (const [id, s] of states) counts.get(id)![s] += 1;
  }
  const marginals: SampleStats[] = [];
  const byNode: Record<string, number[]> = {};
  for (const n of net.nodes) {
    const c = counts.get(n.id)!;
    const probabilities = Array.from(c, (x) => x / samples);
    const standardErrors = probabilities.map((p) => Math.sqrt((p * (1 - p)) / samples));
    byNode[n.id] = probabilities;
    marginals.push({ node: n.id, states: n.states, probabilities, standardErrors });
  }
  return {
    samples,
    marginals,
    byNode,
    exactness: 'empirical',
    method: `Forward (ancestral) sampling, ${samples} draws`,
  };
}

export interface LikelihoodWeightingResult {
  samples: number;
  marginals: SampleStats[];
  byNode: Record<string, number[]>;
  /** Σ w_i / n: an unbiased estimate of P(evidence). */
  evidenceProbabilityEstimate: number;
  /** (Σ w)² / Σ w²: how many equally weighted samples this is worth. */
  effectiveSampleSize: number;
  /** effectiveSampleSize / samples, in (0, 1]. */
  efficiency: number;
  exactness: Exactness;
  method: string;
  warnings: string[];
}

/**
 * Likelihood-weighted sampling for approximate inference with evidence.
 *
 * Standard errors use the weighted-sample formula with the effective sample
 * size, so they widen automatically as the weights degenerate.
 */
export function likelihoodWeighting(
  net: BayesNet,
  evidence: Evidence,
  samples: number,
  seed: Seed,
): LikelihoodWeightingResult {
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new EngineError(`The number of samples must be a positive whole number, not ${samples}.`, 'range');
  }
  const ev = net.resolveEvidence(evidence);
  if (ev.size === 0) {
    throw new EngineError(
      'Likelihood weighting needs at least one observed variable; with no evidence use forward sampling.',
      'required',
    );
  }
  const rng = new Random(seed);
  const weighted = new Map<string, Float64Array>();
  for (const n of net.nodes) weighted.set(n.id, new Float64Array(n.states.length));
  let sumW = 0;
  let sumW2 = 0;
  const states = new Map<string, number>();
  for (let t = 0; t < samples; t++) {
    states.clear();
    let w = 1;
    for (const id of net.order) {
      const row = net.node(id).cpt[parentRowIndex(net, id, states)];
      const observed = ev.get(id);
      if (observed === undefined) {
        states.set(id, drawFromRow(row, rng.uniform(), id, 0));
      } else {
        states.set(id, observed);
        w *= row[observed];
        if (w === 0) break;
      }
    }
    sumW += w;
    sumW2 += w * w;
    if (w === 0) continue;
    for (const [id, s] of states) weighted.get(id)![s] += w;
  }
  const warnings: string[] = [];
  if (!(sumW > 0)) {
    throw new EngineError(
      `All ${samples} likelihood-weighted samples had weight 0, so no estimate exists. Either the evidence has ` +
        `probability 0 under this model, or it is far too unlikely for this many samples — use exact inference.`,
      'zero-probability',
    );
  }
  const ess = (sumW * sumW) / sumW2;
  const marginals: SampleStats[] = [];
  const byNode: Record<string, number[]> = {};
  for (const n of net.nodes) {
    const c = weighted.get(n.id)!;
    const probabilities = Array.from(c, (x) => x / sumW);
    const standardErrors = probabilities.map((p) => Math.sqrt((p * (1 - p)) / ess));
    byNode[n.id] = probabilities;
    marginals.push({ node: n.id, states: n.states, probabilities, standardErrors });
  }
  if (ess < 100) {
    warnings.push(
      `The effective sample size is only ${ess.toFixed(1)} out of ${samples} draws: the weights are highly ` +
        `degenerate and these estimates are unreliable. Use exact inference if the network allows it.`,
    );
  } else if (ess < samples * 0.01) {
    warnings.push(
      `The effective sample size is ${ess.toFixed(0)}, under 1% of the ${samples} draws, because the evidence is ` +
        `unlikely under the prior. Treat the estimates as rough.`,
    );
  }
  return {
    samples,
    marginals,
    byNode,
    evidenceProbabilityEstimate: sumW / samples,
    effectiveSampleSize: ess,
    efficiency: ess / samples,
    exactness: 'empirical',
    method: `Likelihood weighting, ${samples} draws`,
    warnings,
  };
}

/** Forward samples as records of state names, for display or for learning. */
export function sampleDataset(net: BayesNet, samples: number, seed: Seed): Record<string, string>[] {
  if (!Number.isInteger(samples) || samples <= 0) {
    throw new EngineError(`The number of samples must be a positive whole number, not ${samples}.`, 'range');
  }
  const rng = new Random(seed);
  const out: Record<string, string>[] = new Array(samples);
  for (let t = 0; t < samples; t++) {
    const states = forwardSample(net, rng);
    const row: Record<string, string> = {};
    for (const [id, s] of states) row[id] = net.stateName(id, s);
    out[t] = row;
  }
  return out;
}
