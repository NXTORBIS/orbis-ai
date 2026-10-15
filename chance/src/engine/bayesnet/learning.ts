/**
 * Parameter learning for a fixed discrete structure from complete data.
 *
 *  - Maximum likelihood: each CPT row is the observed conditional frequency.
 *  - Bayesian / Laplace smoothing: a Dirichlet(alpha) prior per row, giving the
 *    posterior mean (n_ijk + alpha) / (n_ij + alpha·k).
 *
 * Learned parameters are EMPIRICAL, and the per-row sample count is reported
 * with every row. That count is the thing that decides whether a number means
 * anything: a row estimated from 3 observations is not comparable to one
 * estimated from 30,000, and maximum likelihood on a row with no observations
 * is undefined — it is refused rather than filled in with a uniform guess.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { tableSize } from './factor';
import { BayesNet, NetworkSpec } from './network';

/** One record of complete data: node id → state name or state index. */
export type DataRow = Readonly<Record<string, string | number>>;

export interface RowEvidenceReport {
  node: string;
  /** Parent configuration as "P=state, Q=state", or null for a root node. */
  parentConfiguration: string | null;
  rowIndex: number;
  /** Observations backing this row. */
  count: number;
  /** The estimated row. */
  probabilities: number[];
}

export interface LearningOptions {
  /**
   * Dirichlet concentration added to every cell. 0 gives maximum likelihood,
   * 1 gives Laplace smoothing, 0.5 the Jeffreys prior.
   */
  alpha?: number;
  /** Ignore rows with missing or unknown values instead of refusing. */
  skipIncomplete?: boolean;
}

export interface LearnedParameters {
  spec: NetworkSpec;
  network: BayesNet;
  /** Every CPT row with the number of observations behind it. */
  rows: RowEvidenceReport[];
  /** Rows with no observations at all. */
  emptyRows: RowEvidenceReport[];
  /** Rows with fewer than 10 observations. */
  sparseRows: RowEvidenceReport[];
  observations: number;
  skipped: number;
  alpha: number;
  exactness: Exactness;
  method: string;
  warnings: string[];
}

/**
 * Learn the CPTs of `structure` from complete data. The structure (nodes,
 * states, edges) is taken from the given network; only the numbers are learned.
 */
export function learnParameters(
  structure: BayesNet,
  data: readonly DataRow[],
  options: LearningOptions = {},
): LearnedParameters {
  const alpha = options.alpha ?? 0;
  if (!Number.isFinite(alpha) || alpha < 0) {
    throw new EngineError(`The Dirichlet concentration alpha must be 0 or greater, not ${alpha}.`, 'range');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new EngineError('Parameter learning needs at least one data row.', 'required');
  }
  const nodes = structure.nodes;
  const counts = new Map<string, Float64Array>();
  const rowCounts = new Map<string, Float64Array>();
  for (const n of nodes) {
    const rows = tableSize(n.parents.map((p) => structure.cardinality(p)));
    counts.set(n.id, new Float64Array(rows * n.states.length));
    rowCounts.set(n.id, new Float64Array(rows));
  }

  let used = 0;
  let skipped = 0;
  for (let t = 0; t < data.length; t++) {
    const row = data[t];
    const resolved = new Map<string, number>();
    let complete = true;
    for (const n of nodes) {
      const raw = row[n.id];
      if (raw === undefined || raw === null) {
        complete = false;
        break;
      }
      try {
        resolved.set(n.id, structure.stateIndex(n.id, raw));
      } catch (e) {
        if (!options.skipIncomplete) {
          throw new EngineError(
            `Data row ${t} is not usable: ${(e as Error).message} Pass skipIncomplete to drop such rows instead.`,
            'state',
          );
        }
        complete = false;
        break;
      }
    }
    if (!complete) {
      if (!options.skipIncomplete) {
        throw new EngineError(
          `Data row ${t} is missing a value for at least one node. Parameter learning here requires complete data; ` +
            `pass skipIncomplete to drop incomplete rows (which biases the estimates if the data are not missing ` +
            `completely at random).`,
          'required',
        );
      }
      skipped++;
      continue;
    }
    used++;
    for (const n of nodes) {
      let r = 0;
      for (const p of n.parents) r = r * structure.cardinality(p) + resolved.get(p)!;
      counts.get(n.id)![r * n.states.length + resolved.get(n.id)!] += 1;
      rowCounts.get(n.id)![r] += 1;
    }
  }
  if (used === 0) {
    throw new EngineError('Every data row was incomplete, so no parameters could be estimated.', 'required');
  }

  const rows: RowEvidenceReport[] = [];
  const emptyRows: RowEvidenceReport[] = [];
  const sparseRows: RowEvidenceReport[] = [];
  const spec: NetworkSpec = {
    name: `${structure.name} (parameters learned from ${used} observations)`,
    description: structure.description,
    nodes: nodes.map((n) => {
      const k = n.states.length;
      const nRows = rowCounts.get(n.id)!.length;
      const c = counts.get(n.id)!;
      const cpt: number[][] = [];
      for (let r = 0; r < nRows; r++) {
        const total = rowCounts.get(n.id)![r];
        const denominator = total + alpha * k;
        if (!(denominator > 0)) {
          throw new EngineError(
            `No observations support the CPT row of node "${n.id}" for ${describeRow(structure, n.id, r) ?? 'the root configuration'}, ` +
              `and alpha is 0, so the maximum-likelihood estimate for that row does not exist. Use alpha > 0 ` +
              `(Laplace or Jeffreys smoothing) to get a defensible estimate, or collect data covering this case.`,
            'insufficient-data',
          );
        }
        const probabilities: number[] = [];
        for (let s = 0; s < k; s++) probabilities.push((c[r * k + s] + alpha) / denominator);
        cpt.push(probabilities);
        const report: RowEvidenceReport = {
          node: n.id,
          parentConfiguration: describeRow(structure, n.id, r),
          rowIndex: r,
          count: total,
          probabilities,
        };
        rows.push(report);
        if (total === 0) emptyRows.push(report);
        else if (total < 10) sparseRows.push(report);
      }
      return { id: n.id, states: [...n.states], parents: [...n.parents], cpt, description: n.description };
    }),
  };

  const warnings: string[] = [];
  if (emptyRows.length) {
    warnings.push(
      `${emptyRows.length} CPT row(s) had no observations and rest entirely on the Dirichlet(alpha=${alpha}) prior: ` +
        emptyRows.map((r) => `${r.node} | ${r.parentConfiguration ?? 'root'}`).join('; ') +
        `. These numbers carry no information from the data.`,
    );
  }
  if (sparseRows.length) {
    warnings.push(
      `${sparseRows.length} CPT row(s) were estimated from fewer than 10 observations: ` +
        sparseRows.map((r) => `${r.node} | ${r.parentConfiguration ?? 'root'} (n=${r.count})`).join('; ') + '.',
    );
  }
  if (skipped) warnings.push(`${skipped} incomplete row(s) were dropped.`);

  return {
    spec,
    network: BayesNet.from(spec),
    rows,
    emptyRows,
    sparseRows,
    observations: used,
    skipped,
    alpha,
    exactness: 'empirical',
    method:
      alpha === 0
        ? `Maximum likelihood from ${used} complete observations`
        : `Bayesian posterior mean with a Dirichlet(${alpha}) prior per row, from ${used} complete observations`,
    warnings,
  };
}

function describeRow(net: BayesNet, nodeId: string, row: number): string | null {
  const parents = net.parentsOf(nodeId);
  if (parents.length === 0) return null;
  const cards = parents.map((p) => net.cardinality(p));
  const states = new Array<number>(parents.length);
  let rest = row;
  for (let i = parents.length - 1; i >= 0; i--) {
    states[i] = rest % cards[i];
    rest = Math.floor(rest / cards[i]);
  }
  return parents.map((p, i) => `${p}=${net.stateName(p, states[i])}`).join(', ');
}
