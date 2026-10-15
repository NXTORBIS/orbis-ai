/**
 * Open Jackson networks.
 *
 * A Jackson network of M/M/c nodes has a product-form stationary
 * distribution, so once the traffic equations are solved each node can be
 * analysed as an independent M/M/c queue at its own total arrival rate. That
 * decomposition is exact for this class of network — it is not an
 * approximation — but it rests on exponential service and Markovian routing.
 *
 * Traffic equations:  λ_j = r_j + Σ_i λ_i·P(i → j)
 */
import { EngineError, type Issue } from '../core/result';
import { analyseMmc } from './models';
import { STANDARD_ASSUMPTIONS, checkLittlesLaw, littlesLaw } from './support';
import type { QueueAnalysis } from './types';

export interface JacksonNode {
  id: string;
  /** External (outside-the-network) arrival rate at this node. */
  externalArrivalRate: number;
  serviceRate: number;
  servers?: number;
}

export interface JacksonRoute {
  from: string;
  to: string;
  probability: number;
}

export interface JacksonConfig {
  nodes: JacksonNode[];
  routes: JacksonRoute[];
}

export interface JacksonNodeResult {
  id: string;
  /** Total arrival rate solved from the traffic equations. */
  arrivalRate: number;
  /** Probability a departure from this node leaves the network. */
  departureProbability: number;
  analysis: QueueAnalysis;
}

export interface JacksonResult {
  nodes: JacksonNodeResult[];
  /** Total external arrival rate into the network. */
  externalArrivalRate: number;
  /** Mean number of customers in the whole network. */
  L: number;
  /** Mean total time a customer spends in the network. */
  W: number;
  Lq: number;
  Wq: number;
  littlesLaw: ReturnType<typeof checkLittlesLaw>;
  assumptions: string[];
  limitations: string[];
  exactness: 'exact';
}

function validateConfig(config: JacksonConfig): Map<string, JacksonNode> {
  const issues: Issue[] = [];
  const nodes = config?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new EngineError([{ code: 'required', field: 'nodes', message: 'A Jackson network needs at least one node.' }]);
  }
  if (nodes.length > 200) {
    throw new EngineError([{ code: 'range', field: 'nodes', message: 'At most 200 nodes are supported.' }]);
  }
  const byId = new Map<string, JacksonNode>();
  nodes.forEach((n, i) => {
    if (typeof n?.id !== 'string' || n.id.length === 0) {
      issues.push({ code: 'required', field: `nodes.${i}.id`, message: `Node ${i + 1} needs a non-empty id.` });
      return;
    }
    if (byId.has(n.id)) {
      issues.push({ code: 'conflict', field: `nodes.${i}.id`, message: `Duplicate node id "${n.id}".` });
      return;
    }
    if (!Number.isFinite(n.externalArrivalRate) || n.externalArrivalRate < 0) {
      issues.push({
        code: 'range',
        field: `nodes.${i}.externalArrivalRate`,
        message: `Node "${n.id}": external arrival rate must be a finite number, 0 or greater.`,
      });
    }
    if (!Number.isFinite(n.serviceRate) || n.serviceRate <= 0) {
      issues.push({ code: 'range', field: `nodes.${i}.serviceRate`, message: `Node "${n.id}": service rate must be greater than 0.` });
    }
    const c = n.servers ?? 1;
    if (!Number.isInteger(c) || c < 1) {
      issues.push({ code: 'range', field: `nodes.${i}.servers`, message: `Node "${n.id}": servers must be a whole number, at least 1.` });
    }
    byId.set(n.id, n);
  });
  const routes = config.routes ?? [];
  if (!Array.isArray(routes)) {
    issues.push({ code: 'invalid', field: 'routes', message: 'Routes must be a list of {from, to, probability}.' });
  } else {
    const outgoing = new Map<string, number>();
    routes.forEach((r, i) => {
      if (!byId.has(r?.from)) {
        issues.push({ code: 'unknown', field: `routes.${i}.from`, message: `Route ${i + 1} starts at unknown node "${String(r?.from)}".` });
      }
      if (!byId.has(r?.to)) {
        issues.push({ code: 'unknown', field: `routes.${i}.to`, message: `Route ${i + 1} ends at unknown node "${String(r?.to)}".` });
      }
      if (!Number.isFinite(r?.probability) || r.probability < 0 || r.probability > 1) {
        issues.push({ code: 'range', field: `routes.${i}.probability`, message: `Route ${i + 1}: probability must be between 0 and 1.` });
        return;
      }
      outgoing.set(r.from, (outgoing.get(r.from) ?? 0) + r.probability);
    });
    for (const [from, total] of outgoing) {
      if (total > 1 + 1e-12) {
        issues.push({
          code: 'sum',
          field: 'routes',
          message: `The routing probabilities leaving node "${from}" sum to ${total.toPrecision(6)}, which is more than 1. The remainder after routing is the probability of leaving the network, so the outgoing probabilities cannot exceed 1.`,
        });
      }
    }
  }
  const totalExternal = nodes.reduce((s, n) => s + (Number.isFinite(n?.externalArrivalRate) ? n.externalArrivalRate : 0), 0);
  if (issues.length === 0 && !(totalExternal > 0)) {
    issues.push({
      code: 'range',
      field: 'nodes',
      message: 'No external arrivals enter the network, so there is nothing to analyse. An open network needs at least one node with a positive external arrival rate.',
    });
  }
  if (issues.length) throw new EngineError(issues);
  return byId;
}

/** Solve A x = b by Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-14) {
      throw new EngineError(
        'The traffic equations of this network have no unique solution. This usually means a set of nodes routes customers only among themselves with probability 1, so work can never leave — that is a closed subnetwork, not an open Jackson network.',
        'numerical',
      );
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x;
}

/**
 * Solve and analyse an open Jackson network. Every node must be stable; an
 * unstable node is refused by name, because a single saturated node makes the
 * whole network's steady state nonexistent.
 */
export function analyseJacksonNetwork(config: JacksonConfig): JacksonResult {
  const byId = validateConfig(config);
  const ids = config.nodes.map((n) => n.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const P: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const r of config.routes ?? []) {
    const i = index.get(r.from) as number;
    const j = index.get(r.to) as number;
    P[i][j] += r.probability;
  }
  // λ_j − Σ_i λ_i P(i→j) = r_j  ⇒  (I − Pᵀ) λ = r
  const A: number[][] = Array.from({ length: n }, (_, j) => Array.from({ length: n }, (_, i) => (i === j ? 1 : 0) - P[i][j]));
  const r = ids.map((id) => (byId.get(id) as JacksonNode).externalArrivalRate);
  const lambdas = solveLinear(A, r);
  lambdas.forEach((v, i) => {
    if (!Number.isFinite(v) || v < -1e-12) {
      throw new EngineError(
        `The traffic equations gave a non-physical arrival rate (${v}) at node "${ids[i]}". Check the routing probabilities.`,
        'numerical',
      );
    }
  });
  const nodes: JacksonNodeResult[] = ids.map((id, i) => {
    const node = byId.get(id) as JacksonNode;
    const servers = node.servers ?? 1;
    const lam = Math.max(0, lambdas[i]);
    const capacity = servers * node.serviceRate;
    if (lam >= capacity) {
      throw new EngineError(
        [
          {
            code: 'unstable',
            field: `nodes.${i}`,
            message:
              `Node "${id}" is unstable: the traffic equations send ${lam.toPrecision(6)} customers per unit time to it, but its ${servers} server(s) can clear only ${capacity.toPrecision(
                6,
              )} (ρ = ${(lam / capacity).toPrecision(6)} ≥ 1). The queue at that node grows without bound, so the network has no steady state. ` +
              'Note that feedback routing can make a node’s total arrival rate much larger than the external rate — check the solved rates, not the inputs.',
          },
        ],
      );
    }
    if (lam === 0) {
      throw new EngineError(
        `Node "${id}" receives no arrivals at all once the traffic equations are solved, so no waiting time exists for it. Remove the node or route work to it.`,
        'range',
      );
    }
    const departureProbability = 1 - P[i].reduce((s, v) => s + v, 0);
    return {
      id,
      arrivalRate: lam,
      departureProbability,
      analysis: analyseMmc({ arrivalRate: lam, serviceRate: node.serviceRate, servers }),
    };
  });
  const L = nodes.reduce((s, nd) => s + nd.analysis.metrics.L, 0);
  const Lq = nodes.reduce((s, nd) => s + nd.analysis.metrics.Lq, 0);
  const externalArrivalRate = r.reduce((s, v) => s + v, 0);
  const W = littlesLaw({ arrivalRate: externalArrivalRate, numberInSystem: L }).timeInSystem;
  const Wq = Lq / externalArrivalRate;
  return {
    nodes,
    externalArrivalRate,
    L,
    W,
    Lq,
    Wq,
    littlesLaw: checkLittlesLaw({ effectiveArrivalRate: externalArrivalRate, L, W, Lq, Wq, usesEffectiveRate: false }),
    assumptions: [
      'External arrivals to each node are independent Poisson processes.',
      STANDARD_ASSUMPTIONS.exponentialService,
      'Routing is Markovian: after service, a customer picks its next node (or leaves) by fixed probabilities, independently of its history and of the state of the network.',
      'Every node has unlimited waiting room, so nothing is ever blocked and nodes never stall one another.',
      STANDARD_ASSUMPTIONS.steadyState,
      'Under these conditions Jackson’s theorem gives a product-form stationary distribution, so each node is exactly an independent M/M/c queue at its solved arrival rate.',
    ],
    limitations: [
      'The arrival process AT a node is generally not Poisson when there is feedback; the product form still holds for the stationary distribution, but per-node waiting-time distributions do not simply compose.',
      'Finite buffers break the product form entirely: with blocking, nodes interact and these results no longer apply.',
      'Class-dependent routing or service, priorities, and synchronisation (forks and joins) are outside the Jackson class.',
    ],
    exactness: 'exact',
  };
}
