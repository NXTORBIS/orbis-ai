/**
 * Spreading processes on a network: SIR, SIS and SEIR by exact-rate Gillespie
 * simulation, against their mean-field mass-action counterparts.
 *
 * The valuable output here is not either answer but the *divergence* between
 * them. A mass-action model assumes every individual can contact every other
 * with equal probability; a network model does not. The consequences are
 * systematic, not random:
 *
 *  - On a clustered network (a lattice, a geometric graph, a real contact
 *    network) mean-field **over**estimates spread, because an infected node's
 *    neighbours are mostly each other's neighbours too, so transmissions land
 *    repeatedly on already-infected people and are wasted.
 *  - On a heavy-tailed network the network R0 depends on the *second* moment
 *    of the degree distribution, so it is far larger than mean degree would
 *    suggest, and the epidemic threshold goes to zero as that moment diverges.
 *
 * Both are demonstrated by this module rather than asserted.
 *
 * Simulation outputs are `empirical` and carry Monte Carlo error. Two
 * distinctions are maintained carefully throughout, because conflating them
 * produces numbers that describe nothing:
 *
 *  1. The *distribution of outbreak sizes across runs* is not a *confidence
 *     interval for the mean outbreak size*. The first is about the world's
 *     variability; the second is about how well this many runs pin down one
 *     number. They are reported separately.
 *  2. Runs that die out immediately are counted separately from the size
 *     distribution of runs that took off. The final-size distribution is
 *     bimodal near the threshold, and its pooled mean sits in the empty valley
 *     between the two modes, describing neither.
 */
import { brentRoot } from '../core/numeric';
import { EngineError, Validator } from '../core/result';
import { mean, quantile, sortedCopy, quantileSorted, tConfidenceInterval } from '../stats/descriptive';
import { Random } from '../random/rng';
import { degreeSummary } from './measures';
import type { Graph, MonteCarloMeta, NetworkQuantity } from './types';
import { CONDITIONAL_ON_STRUCTURE, nq } from './types';

/* ------------------------------------------------------------- Fenwick tree */

/**
 * A Fenwick (binary indexed) tree over node weights, for O(log n) weighted
 * event selection.
 *
 * Needed because the naive alternative — scanning the infected list to pick an
 * infection event — is O(|I|) per event and so O(n^2) per run, which makes an
 * ensemble of a few hundred runs on a few thousand nodes infeasible.
 */
class Fenwick {
  private readonly tree: Float64Array;
  readonly size: number;
  constructor(n: number) {
    this.size = n;
    this.tree = new Float64Array(n + 1);
  }
  add(i: number, delta: number): void {
    if (delta === 0) return;
    for (let k = i + 1; k <= this.size; k += k & -k) this.tree[k] += delta;
  }
  total(): number {
    return this.tree.length > 0 ? this.prefix(this.size) : 0;
  }
  prefix(count: number): number {
    let s = 0;
    for (let k = count; k > 0; k -= k & -k) s += this.tree[k];
    return s;
  }
  /** Smallest index whose prefix sum exceeds x. */
  find(x: number): number {
    let idx = 0;
    let bit = 1;
    while (bit * 2 <= this.size) bit *= 2;
    let rest = x;
    for (; bit > 0; bit >>= 1) {
      const next = idx + bit;
      if (next <= this.size && this.tree[next] <= rest) {
        idx = next;
        rest -= this.tree[next];
      }
    }
    return Math.min(idx, this.size - 1);
  }
}

/** An O(1)-pick membership list with swap removal. */
class IndexSet {
  private readonly items: Int32Array;
  private readonly pos: Int32Array;
  private count = 0;
  constructor(n: number) {
    this.items = new Int32Array(n);
    this.pos = new Int32Array(n).fill(-1);
  }
  get size(): number {
    return this.count;
  }
  has(x: number): boolean {
    return this.pos[x] >= 0;
  }
  add(x: number): void {
    if (this.pos[x] >= 0) return;
    this.items[this.count] = x;
    this.pos[x] = this.count;
    this.count++;
  }
  remove(x: number): void {
    const p = this.pos[x];
    if (p < 0) return;
    const last = this.items[this.count - 1];
    this.items[p] = last;
    this.pos[last] = p;
    this.count--;
    this.pos[x] = -1;
  }
  at(i: number): number {
    return this.items[i];
  }
}

/* --------------------------------------------------------------- one run */

export type Compartment = 'S' | 'E' | 'I' | 'R';
export type SpreadModel = 'SIR' | 'SIS' | 'SEIR';

const S = 0;
const E = 1;
const I = 2;
const R = 3;

export interface SpreadParameters {
  model: SpreadModel;
  /** Transmission rate per susceptible–infected edge, per unit time. */
  beta: number;
  /** Recovery rate per infected node (I -> R for SIR/SEIR, I -> S for SIS). */
  gamma: number;
  /** Incubation rate E -> I. Required for SEIR, ignored otherwise. */
  sigma?: number;
  /** Stop after this much simulated time. */
  horizon?: number;
  /** Stop after this many events (a guard, not a modelling choice). */
  maxEvents?: number;
}

export interface SingleRunResult {
  /** Final compartment of every node. */
  state: Compartment[];
  /**
   * Distinct nodes ever infected (E or I at some point), excluding initial
   * immunes. For SIS this is NOT the same as the number of infection events,
   * since a node can be reinfected; `cumulativeInfections` holds that.
   */
  finalSize: number;
  finalFraction: number;
  /** Infection events, which for SIS exceeds `finalSize`. */
  cumulativeInfections: number;
  /** Peak simultaneous I count, and when it happened. */
  peakInfected: number;
  peakTime: number;
  /** Last event time. */
  endTime: number;
  events: number;
  /** True when the process ended with no infectious or exposed nodes left. */
  extinguished: boolean;
  /** True when the event or time guard stopped it while still active. */
  truncated: boolean;
  /** Down-sampled trajectory. */
  trajectory: { t: number; s: number; e: number; i: number; r: number }[];
}

/**
 * One exact-rate (Gillespie / continuous-time Markov) run of a spreading
 * process on the network.
 *
 * Exact in the sense that it samples the embedded jump chain of the true
 * continuous-time Markov process on the network: exponential waiting time at
 * the current total rate, then an event chosen proportionally. There is no
 * time discretisation and therefore no time-step error. (This is the same
 * principle as `ctmcGillespieSteps` in `src/engine/processes/ctmc.ts`, which
 * could not be reused: that routine takes a dense generator matrix over a
 * global state space, and the state space here is 3^n or 4^n.)
 */
export function simulateSpreadRun(
  g: Graph,
  params: SpreadParameters,
  rng: Random,
  options: { initialInfected?: ReadonlyArray<number>; immune?: ReadonlyArray<number>; trajectoryPoints?: number } = {},
): SingleRunResult {
  const v = new Validator();
  v.positive(params.beta, 'beta', 'Transmission rate beta');
  v.positive(params.gamma, 'gamma', 'Recovery rate gamma');
  if (params.model === 'SEIR') v.positive(params.sigma ?? NaN, 'sigma', 'Incubation rate sigma');
  v.throwIfInvalid();
  const horizon = params.horizon ?? Infinity;
  if (horizon <= 0) throw new EngineError(`The horizon must be positive; ${horizon} was given.`, 'range');
  const maxEvents = params.maxEvents ?? 20 * (g.n + g.m) + 1000;

  const state = new Uint8Array(g.n); // all S
  const immune = options.immune ?? [];
  for (const i of immune) {
    if (!Number.isInteger(i) || i < 0 || i >= g.n) throw new EngineError(`Immune node index ${i} is outside 0..${g.n - 1}.`, 'range');
    state[i] = R;
  }
  let seeds = options.initialInfected ? [...new Set(options.initialInfected)] : [];
  if (seeds.length === 0) {
    // One uniformly chosen non-immune node.
    const candidates: number[] = [];
    for (let i = 0; i < g.n; i++) if (state[i] === S) candidates.push(i);
    if (candidates.length === 0) {
      throw new EngineError(
        'Every node is immune, so no outbreak can start. There is nothing to simulate; this is a refusal rather ' +
          'than a run reporting a final size of 0, which would look like a result.',
        'degenerate',
      );
    }
    seeds = [candidates[rng.int(0, candidates.length - 1)]];
  }
  for (const i of seeds) {
    if (!Number.isInteger(i) || i < 0 || i >= g.n) throw new EngineError(`Initially infected node index ${i} is outside 0..${g.n - 1}.`, 'range');
    if (state[i] === R) {
      throw new EngineError(
        `Node ${g.ids[i]} is listed both as initially infected and as immune. One of the two inputs is wrong; the ` +
          'run is refused rather than silently preferring one.',
        'conflict',
      );
    }
    state[i] = I;
  }

  const infectious = new IndexSet(g.n);
  const exposed = new IndexSet(g.n);
  const susDeg = new Fenwick(g.n);
  const susCount = new Int32Array(g.n);

  const countSusceptibleNeighbours = (u: number): number => {
    let c = 0;
    for (const w of g.out[u]) if (state[w] === S) c++;
    return c;
  };
  for (const i of seeds) {
    infectious.add(i);
    susCount[i] = countSusceptibleNeighbours(i);
    susDeg.add(i, susCount[i]);
  }

  const sigma = params.sigma ?? 0;
  let t = 0;
  let events = 0;
  let sCount = 0;
  for (let i = 0; i < g.n; i++) if (state[i] === S) sCount++;
  let rCount = g.n - sCount - infectious.size - exposed.size;
  const everInfectedFlag = new Uint8Array(g.n);
  for (const i of seeds) everInfectedFlag[i] = 1;
  let everInfected = seeds.length;
  let cumulativeInfections = seeds.length;
  let peak = infectious.size;
  let peakTime = 0;
  const trajPoints = options.trajectoryPoints ?? 200;
  const trajectory: SingleRunResult['trajectory'] = [
    { t: 0, s: sCount, e: exposed.size, i: infectious.size, r: rCount },
  ];
  let truncated = false;

  const becomeInfectious = (u: number): void => {
    state[u] = I;
    infectious.add(u);
    susCount[u] = countSusceptibleNeighbours(u);
    susDeg.add(u, susCount[u]);
  };
  const stopInfectious = (u: number): void => {
    infectious.remove(u);
    susDeg.add(u, -susCount[u]);
    susCount[u] = 0;
  };

  for (;;) {
    const infRate = params.beta * susDeg.total();
    const recRate = params.gamma * infectious.size;
    const progRate = params.model === 'SEIR' ? sigma * exposed.size : 0;
    const total = infRate + recRate + progRate;
    if (total <= 0) break;
    const dt = rng.exponential(total);
    if (t + dt > horizon) {
      t = horizon;
      truncated = infectious.size > 0 || exposed.size > 0;
      break;
    }
    t += dt;
    events++;
    const u = rng.uniform() * total;
    if (u < infRate) {
      // Pick an infectious node proportional to its susceptible-neighbour count.
      const src = susDeg.find(rng.uniform() * susDeg.total());
      // Pick one of its susceptible neighbours uniformly.
      const nbs = g.out[src];
      let remaining = susCount[src] > 0 ? rng.int(0, susCount[src] - 1) : -1;
      let target = -1;
      for (const w of nbs) {
        if (state[w] !== S) continue;
        if (remaining === 0) {
          target = w;
          break;
        }
        remaining--;
      }
      if (target < 0) {
        // The Fenwick weight and the state disagreed; refuse rather than guess.
        throw new EngineError(
          `Internal: node ${src} carried a susceptible-neighbour weight of ${susCount[src]} but no susceptible ` +
            'neighbour was found. The simulation is abandoned rather than continued from an inconsistent state.',
          'internal',
        );
      }
      sCount--;
      cumulativeInfections++;
      if (!everInfectedFlag[target]) {
        everInfectedFlag[target] = 1;
        everInfected++;
      }
      // Every infectious neighbour of the target loses a susceptible.
      for (const w of g.out[target]) {
        if (state[w] === I) {
          susCount[w]--;
          susDeg.add(w, -1);
        }
      }
      if (params.model === 'SEIR') {
        state[target] = E;
        exposed.add(target);
      } else {
        becomeInfectious(target);
      }
    } else if (u < infRate + progRate) {
      const idx = rng.int(0, exposed.size - 1);
      const node = exposed.at(idx);
      exposed.remove(node);
      becomeInfectious(node);
    } else {
      const idx = rng.int(0, infectious.size - 1);
      const node = infectious.at(idx);
      stopInfectious(node);
      if (params.model === 'SIS') {
        state[node] = S;
        sCount++;
        // Infectious neighbours gain a susceptible.
        for (const w of g.out[node]) {
          if (state[w] === I) {
            susCount[w]++;
            susDeg.add(w, 1);
          }
        }
      } else {
        state[node] = R;
        rCount++;
      }
    }
    if (infectious.size > peak) {
      peak = infectious.size;
      peakTime = t;
    }
    if (trajectory.length < trajPoints || events % 64 === 0) {
      trajectory.push({ t, s: sCount, e: exposed.size, i: infectious.size, r: rCount });
    }
    if (events >= maxEvents) {
      truncated = infectious.size > 0 || exposed.size > 0;
      break;
    }
  }
  trajectory.push({ t, s: sCount, e: exposed.size, i: infectious.size, r: rCount });
  const labels: Compartment[] = ['S', 'E', 'I', 'R'];
  const immuneCount = immune.length;
  return {
    state: Array.from(state, (x) => labels[x]),
    finalSize: everInfected,
    finalFraction: g.n > immuneCount ? everInfected / (g.n - immuneCount) : 0,
    cumulativeInfections,
    peakInfected: peak,
    peakTime,
    endTime: t,
    events,
    extinguished: infectious.size === 0 && exposed.size === 0,
    truncated,
    trajectory,
  };
}

/* ------------------------------------------------------------- R0 and theory */

export interface ReproductionNumbers {
  /** beta*<k>/gamma: the mass-action value, using mean degree as contact rate. */
  massAction: NetworkQuantity;
  /** T * (<k^2> - <k>)/<k>, T = beta/(beta+gamma): the network value. */
  network: NetworkQuantity;
  /** beta/(beta+gamma): probability a given S-I edge ever transmits. */
  transmissibility: NetworkQuantity;
  /** Epidemic threshold in beta, for SIS: gamma*<k>/<k^2>. */
  sisThresholdBeta: NetworkQuantity;
  /** True when the degree distribution's second moment is large enough that the
   *  threshold is better reported as "effectively zero" than as a number. */
  thresholdEffectivelyZero: boolean;
  meanDegree: NetworkQuantity;
  secondMoment: NetworkQuantity;
  notes: string[];
  limitations: string[];
  conditionalOn: string;
}

/**
 * The two reproduction numbers, and why they differ.
 *
 * The mass-action R0 uses mean degree. The network R0 uses the mean *excess*
 * degree (<k^2> - <k>)/<k>, because an infection arriving along an edge reaches
 * a node with probability proportional to its degree — a size-biased draw, not
 * a uniform one. On a heavy-tailed network that is dramatically larger, and
 * the gap is the quantity that makes hub-targeted intervention worth it.
 */
export function reproductionNumbers(g: Graph, params: { beta: number; gamma: number }): ReproductionNumbers {
  const v = new Validator();
  v.positive(params.beta, 'beta', 'Transmission rate beta');
  v.positive(params.gamma, 'gamma', 'Recovery rate gamma');
  v.throwIfInvalid();
  const deg = degreeSummary(g);
  const k1 = deg.meanDegree.value;
  const k2 = deg.secondMoment.value;
  if (k1 <= 0) {
    throw new EngineError(
      'The mean degree is 0: every node is isolated, so no reproduction number is defined (an infection has nowhere ' +
        'to go). This is reported as a refusal rather than as R0 = 0, which would suggest a computed epidemiological result.',
      'degenerate',
    );
  }
  const T = params.beta / (params.beta + params.gamma);
  const excess = (k2 - k1) / k1;
  const r0net = T * excess;
  const r0mass = (params.beta * k1) / params.gamma;
  const betaC = (params.gamma * k1) / k2;
  // A heuristic for "the second moment is dominated by hubs and so grows with n".
  const kmax = deg.maxDegree.value;
  const hubShare = (kmax * kmax) / (k2 * g.n);
  const effectivelyZero = hubShare > 0.05;
  const notes = [
    `<k> = ${k1.toPrecision(5)}, <k^2> = ${k2.toPrecision(5)}, mean excess degree (<k^2>-<k>)/<k> = ${excess.toPrecision(5)}.`,
    `Transmissibility T = beta/(beta+gamma) = ${T.toPrecision(5)}: the probability that a particular ` +
      'susceptible–infected edge transmits before the infected node recovers.',
    r0net > r0mass
      ? `The network R0 (${r0net.toPrecision(4)}) exceeds the mass-action R0 (${r0mass.toPrecision(4)}): degree ` +
        'variation makes the infection reach high-degree nodes preferentially, which amplifies early spread.'
      : `The network R0 (${r0net.toPrecision(4)}) is below the mass-action R0 (${r0mass.toPrecision(4)}). This ` +
        'happens for a near-regular degree distribution, where mass action over-counts by ignoring that an ' +
        'infected node cannot re-infect its infector.',
  ];
  const limitations = [
    'Both are configuration-model (locally tree-like) results. Clustering, degree correlation and finite size all ' +
      'move the true early growth rate; on a clustered network the network R0 above is an OVERestimate.',
    'R0 governs the initial growth only. It does not determine the final size on a network, which also depends on ' +
      'the whole degree distribution, nor the peak, which depends on timing.',
  ];
  if (effectivelyZero) {
    limitations.push(
      `The largest hub alone contributes ${(hubShare * 100).toPrecision(3)}% of n<k^2>, so <k^2> is dominated by the ` +
        'tail and grows with n rather than converging. For such a (scale-free, exponent <= 3) network the epidemic ' +
        `threshold goes to ZERO in the large-n limit: there is no transmission rate low enough to prevent spread. ` +
        `The finite-size value beta_c = ${betaC.toPrecision(4)} below is a property of this particular sample, not of ` +
        'the model, and should not be used as a safe operating point.',
    );
  }
  return {
    massAction: nq('R0 (mass action)', r0mass, 'numerical', {
      formula: 'R0 = beta <k> / gamma',
      note: 'Treats every contact as equally likely and ignores degree variation. Appropriate only for a homogeneously mixing population.',
    }),
    network: nq('R0 (network)', r0net, 'numerical', {
      formula: 'R0 = [beta/(beta+gamma)] (<k^2> - <k>)/<k>',
      note: 'Uses the mean excess degree, because infection travels along edges and so reaches nodes in proportion to their degree.',
    }),
    transmissibility: nq('Transmissibility T', T, 'exact', { formula: 'T = beta/(beta+gamma)' }),
    sisThresholdBeta: nq('SIS epidemic threshold in beta', betaC, effectivelyZero ? 'empirical' : 'numerical', {
      formula: 'beta_c = gamma <k>/<k^2>',
      note: effectivelyZero
        ? 'NOT a usable threshold: <k^2> is hub-dominated here, so this value shrinks as the network grows. Treat the threshold as zero.'
        : 'Below beta_c an SIS process dies out; above it, it persists at an endemic level.',
    }),
    thresholdEffectivelyZero: effectivelyZero,
    meanDegree: deg.meanDegree,
    secondMoment: deg.secondMoment,
    notes,
    limitations,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
  };
}

/**
 * Outbreak probability from the initial branching process.
 *
 * Starting from one randomly chosen node, the probability of a large outbreak
 * is 1 - G0(1 - T + T u) where u solves u = G1(1 - T + T u), with G0 and G1 the
 * generating functions of the degree and excess-degree distributions. This is a
 * genuinely different question from the final size: a network can have a large
 * expected final size *conditional on takeoff* and still extinguish most of the
 * time, and planning on the unconditional mean confuses the two.
 */
export function outbreakProbability(g: Graph, params: { beta: number; gamma: number }): {
  probability: NetworkQuantity;
  extinctionProbability: NetworkQuantity;
  /** Expected large-outbreak size fraction from the same generating functions. */
  expectedOutbreakFraction: NetworkQuantity;
  iterations: number;
  notes: string[];
  limitations: string[];
} {
  const v = new Validator();
  v.positive(params.beta, 'beta', 'beta');
  v.positive(params.gamma, 'gamma', 'gamma');
  v.throwIfInvalid();
  const deg = degreeSummary(g);
  const pk = deg.distribution.map((d) => d.p);
  const k1 = deg.meanDegree.value;
  if (k1 <= 0) throw new EngineError('Mean degree 0: no branching process to analyse.', 'degenerate');
  const T = params.beta / (params.beta + params.gamma);
  const G0 = (x: number): number => {
    let s = 0;
    for (let k = 0; k < pk.length; k++) s += pk[k] * x ** k;
    return s;
  };
  const G1 = (x: number): number => {
    let s = 0;
    for (let k = 1; k < pk.length; k++) s += ((k * pk[k]) / k1) * x ** (k - 1);
    return s;
  };
  // u = G1(1 - T + T u), by fixed-point iteration from u = 0.
  let u = 0;
  let iterations = 0;
  let converged = false;
  for (let it = 0; it < 20_000; it++) {
    const next = G1(1 - T + T * u);
    iterations = it + 1;
    if (Math.abs(next - u) < 1e-14) {
      u = next;
      converged = true;
      break;
    }
    u = next;
  }
  if (!converged) {
    throw new EngineError(
      'The branching-process fixed point u = G1(1 - T + T u) did not converge in 20000 iterations. No outbreak ' +
        'probability is reported rather than an unconverged one.',
      'nonconvergent',
    );
  }
  const pOutbreak = 1 - G0(1 - T + T * u);
  // Expected giant-outbreak fraction, same generating-function machinery.
  const sFraction = pOutbreak;
  return {
    probability: nq('Outbreak probability (from one random seed)', pOutbreak, 'numerical', {
      formula: 'P = 1 - G0(1 - T + T u), u = G1(1 - T + T u)',
    }),
    extinctionProbability: nq('Extinction probability', 1 - pOutbreak, 'numerical', {
      note: 'The probability the infection dies out while still small. Near the threshold this is close to 1 even ' +
        'when a takeoff would be large — which is exactly why outbreak and extinction runs must be reported separately.',
    }),
    expectedOutbreakFraction: nq('Expected fraction infected given takeoff', sFraction, 'numerical', {
      formula: 'The same generating-function root; on a configuration model the outbreak probability from a random ' +
        'seed and the outbreak size fraction coincide.',
      note: 'A configuration-model (tree-like) prediction. Clustering reduces it.',
    }),
    iterations,
    notes: [
      `Transmissibility T = ${T.toPrecision(5)}; fixed point u = ${u.toPrecision(6)} after ${iterations} iterations.`,
      'The degree distribution is taken from the supplied graph; the branching approximation then assumes the graph ' +
        'is locally tree-like, which it is not if it is clustered.',
    ],
    limitations: [
      'A branching-process calculation describes the START of an outbreak only, while the susceptible pool is ' +
        'effectively unlimited. It says nothing about the peak or the tail.',
      'On a clustered network this overestimates the outbreak probability, because early transmissions land on ' +
        'already-infected neighbours rather than on new ones.',
    ],
  };
}

/* ------------------------------------------------------ mean-field ODE */

export interface MassActionResult {
  model: SpreadModel;
  /** Trajectory on a uniform grid. */
  trajectory: { t: number; s: number; e: number; i: number; r: number }[];
  r0: NetworkQuantity;
  /** Final attack rate from the analytic relation R = 1 - exp(-R0 R). */
  analyticFinalSize: NetworkQuantity | null;
  /** From the integration, as a cross-check on the analytic value. */
  integratedFinalSize: NetworkQuantity;
  peak: { fraction: NetworkQuantity; time: NetworkQuantity };
  notes: string[];
  limitations: string[];
}

/**
 * The mass-action (homogeneous mixing) ODE model, integrated with RK4, plus
 * the analytic final-size relation for SIR.
 *
 * The contact rate is beta * meanDegree, so the model is the mean-field limit
 * of the network process with the same parameters — making the two directly
 * comparable, which is the point.
 */
export function massActionODE(
  params: SpreadParameters & { meanDegree: number; initialInfectedFraction?: number },
  options: { horizon?: number; steps?: number } = {},
): MassActionResult {
  const v = new Validator();
  v.positive(params.beta, 'beta', 'beta');
  v.positive(params.gamma, 'gamma', 'gamma');
  v.positive(params.meanDegree, 'meanDegree', 'Mean degree');
  if (params.model === 'SEIR') v.positive(params.sigma ?? NaN, 'sigma', 'sigma');
  v.throwIfInvalid();
  const i0 = params.initialInfectedFraction ?? 1e-4;
  const vv = new Validator();
  vv.range(i0, 'initialInfectedFraction', 'Initial infected fraction', 0, 1);
  vv.throwIfInvalid();
  if (i0 <= 0) {
    throw new EngineError(
      'A mass-action model started from exactly zero infected stays at zero for ever — the disease-free state is an ' +
        'equilibrium. Supply a positive initial infected fraction.',
      'range',
    );
  }
  const horizon = options.horizon ?? 200 / params.gamma;
  const steps = options.steps ?? 4000;
  const vs = new Validator();
  vs.integer(steps, 'steps', 'Integration steps', 10, 1_000_000);
  vs.throwIfInvalid();
  const b = params.beta * params.meanDegree;
  const sigma = params.sigma ?? 0;
  const model = params.model;

  type St = [number, number, number, number];
  const deriv = (y: St): St => {
    const [s, e, i] = y;
    const newInfections = b * s * i;
    if (model === 'SEIR') return [-newInfections, newInfections - sigma * e, sigma * e - params.gamma * i, params.gamma * i];
    if (model === 'SIS') return [-newInfections + params.gamma * i, 0, newInfections - params.gamma * i, 0];
    return [-newInfections, 0, newInfections - params.gamma * i, params.gamma * i];
  };
  let y: St = model === 'SEIR' ? [1 - i0, i0, 0, 0] : [1 - i0, 0, i0, 0];
  const h = horizon / steps;
  const trajectory: MassActionResult['trajectory'] = [{ t: 0, s: y[0], e: y[1], i: y[2], r: y[3] }];
  let peakI = y[2];
  let peakT = 0;
  const record = Math.max(1, Math.floor(steps / 400));
  for (let k = 0; k < steps; k++) {
    const k1 = deriv(y);
    const y2: St = [y[0] + (h / 2) * k1[0], y[1] + (h / 2) * k1[1], y[2] + (h / 2) * k1[2], y[3] + (h / 2) * k1[3]];
    const k2 = deriv(y2);
    const y3: St = [y[0] + (h / 2) * k2[0], y[1] + (h / 2) * k2[1], y[2] + (h / 2) * k2[2], y[3] + (h / 2) * k2[3]];
    const k3 = deriv(y3);
    const y4: St = [y[0] + h * k3[0], y[1] + h * k3[1], y[2] + h * k3[2], y[3] + h * k3[3]];
    const k4 = deriv(y4);
    y = [0, 1, 2, 3].map(
      (j) => y[j] + (h / 6) * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]),
    ) as St;
    const t = (k + 1) * h;
    if (y[2] > peakI) {
      peakI = y[2];
      peakT = t;
    }
    if ((k + 1) % record === 0 || k === steps - 1) trajectory.push({ t, s: y[0], e: y[1], i: y[2], r: y[3] });
  }
  const r0 = b / params.gamma;
  let analytic: NetworkQuantity | null = null;
  if (model !== 'SIS' && r0 > 1) {
    const f = (x: number) => 1 - Math.exp(-r0 * x) - x;
    // Same bracketing care as erdosRenyiGiantFraction: R = 0 is always a root,
    // and f(1) = -exp(-R0) < 0, so the lower end must be searched for.
    let lo = 0;
    for (const candidate of [1e-12, 1e-9, 1e-6, 1e-4, 1e-3, 1e-2, 0.1]) {
      if (f(candidate) > 0) {
        lo = candidate;
        break;
      }
    }
    let root: number | null = null;
    try {
      root = lo === 0 ? null : brentRoot(f, lo, 1, { tol: 1e-15, maxIter: 400 });
    } catch {
      root = null;
    }
    if (root === null || !(root > 0)) {
      throw new EngineError(
        `Could not solve the final-size relation R = 1 - exp(-R0 R) at R0 = ${r0}. No analytic final size is reported.`,
        'nonconvergent',
      );
    }
    analytic = nq('Analytic final attack rate', root, 'numerical', {
      formula: 'R_inf = 1 - exp(-R0 R_inf)',
      note: 'Exact for the mass-action SIR model in the limit of a vanishing initial infected fraction. Identical in ' +
        'form to the Erdős–Rényi giant-component equation S = 1 - exp(-cS) — the two are the same fixed point, ' +
        'because an SIR outbreak is a percolation cluster.',
    });
  } else if (model !== 'SIS') {
    analytic = nq('Analytic final attack rate', 0, 'exact', {
      formula: 'R_inf = 0 for R0 <= 1',
      note: `R0 = ${r0.toPrecision(4)} <= 1: the mass-action model has no epidemic, and the only root of the ` +
        'final-size relation is 0.',
    });
  }
  const integrated = model === 'SIS' ? y[2] : y[3] + y[2] + y[1];
  return {
    model,
    trajectory,
    r0: nq('R0 (mass action)', r0, 'exact', { formula: 'R0 = beta <k> / gamma' }),
    analyticFinalSize: analytic,
    integratedFinalSize: nq(model === 'SIS' ? 'Endemic infected fraction' : 'Final attack rate (integrated)', integrated, 'numerical', {
      note: `RK4 with ${steps} steps to t = ${horizon.toPrecision(4)}. Agreement with the analytic value is a check ` +
        'on the integration, not independent evidence about the world.',
    }),
    peak: {
      fraction: nq('Peak infected fraction', peakI, 'numerical'),
      time: nq('Time of peak', peakT, 'numerical'),
    },
    notes: [
      `Contact rate beta x <k> = ${b.toPrecision(5)}; recovery rate ${params.gamma}.`,
      'This is the homogeneous-mixing limit: every individual is assumed equally likely to contact every other.',
    ],
    limitations: [
      'Mass action has no network at all. It ignores clustering (so it OVERestimates spread on a clustered network), ' +
        'degree variation (so it UNDERestimates early growth on a heavy-tailed one) and finite-population stochasticity ' +
        '(so it cannot produce extinction, and reports a smooth epidemic where the network model gives a bimodal outcome).',
      'The ODE is deterministic: it has no notion of an outbreak failing to take off, which on a real network near ' +
        'threshold is the most likely single outcome.',
    ],
  };
}

/* ------------------------------------------------------------ the ensemble */

export interface OutbreakSizeDistribution {
  /** Final sizes of runs that took off, sorted. */
  takeoffSizes: number[];
  /** Final sizes of runs that died out. */
  extinctionSizes: number[];
  cutoff: number;
}

export interface SpreadEnsembleResult {
  model: SpreadModel;
  meta: MonteCarloMeta;
  /** Runs that never got going, counted separately and NOT averaged in. */
  extinctionRuns: number;
  extinctionProbability: NetworkQuantity;
  takeoffRuns: number;
  /** Mean final size over TAKEOFF runs only, with a CI for that mean. */
  meanTakeoffSize: NetworkQuantity | null;
  meanTakeoffSizeInterval: { lower: number; upper: number; level: number } | null;
  /** Percentiles of the final size ACROSS takeoff runs — the spread of
   *  outcomes, which is a different statement from the interval above. */
  takeoffSizeQuantiles: { p: number; value: number }[];
  /** Reported only to be labelled: pooling the two modes describes neither. */
  pooledMeanSize: NetworkQuantity;
  distribution: OutbreakSizeDistribution;
  /** Peak height and timing over takeoff runs, with bands. */
  peakInfected: { median: number; q05: number; q95: number } | null;
  peakTime: { median: number; q05: number; q95: number } | null
  truncatedRuns: number;
  conditionalOn: string;
  notes: string[];
  limitations: string[];
}

export interface EnsembleOptions {
  runs?: number;
  initialInfected?: ReadonlyArray<number>;
  immune?: ReadonlyArray<number>;
  /** Final sizes at or below this count as "died out". Default max(10, ln n). */
  extinctionCutoff?: number;
  chunkSize?: number;
  isCancelled?: () => boolean;
}

/**
 * An ensemble of network spreading runs, as a generator yielding between
 * chunks so that a worker can be cancelled mid-ensemble.
 *
 * The result keeps extinction runs and takeoff runs apart. Averaging them
 * together produces a number that describes neither population: near the
 * threshold the final-size distribution is bimodal, with a spike at O(1) and a
 * second mode at a constant fraction of n, and the pooled mean falls in the
 * empty valley between them.
 */
export function* spreadEnsembleSteps(
  g: Graph,
  params: SpreadParameters,
  seed: string | number,
  options: EnsembleOptions = {},
): Generator<number, SpreadEnsembleResult, void> {
  const runs = options.runs ?? 200;
  const v = new Validator();
  v.integer(runs, 'runs', 'Number of runs', 1, 1_000_000);
  v.throwIfInvalid();
  const chunk = Math.max(1, options.chunkSize ?? Math.max(1, Math.floor(runs / 20)));
  const cutoff = options.extinctionCutoff ?? Math.max(10, Math.ceil(Math.log(Math.max(2, g.n))));
  const rng = new Random(seed);
  const takeoff: number[] = [];
  const extinction: number[] = [];
  const peaks: number[] = [];
  const peakTimes: number[] = [];
  let truncatedRuns = 0;
  let completed = 0;
  let cancelled = false;

  while (completed < runs) {
    const end = Math.min(runs, completed + chunk);
    for (; completed < end; completed++) {
      const r = simulateSpreadRun(g, params, rng, {
        initialInfected: options.initialInfected,
        immune: options.immune,
        trajectoryPoints: 0,
      });
      if (r.truncated) truncatedRuns++;
      if (r.finalSize <= cutoff) extinction.push(r.finalSize);
      else {
        takeoff.push(r.finalSize);
        peaks.push(r.peakInfected);
        peakTimes.push(r.peakTime);
      }
    }
    yield completed;
    if (options.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }

  const all = [...takeoff, ...extinction];
  const pooled = all.length > 0 ? mean(all) : 0;
  const sortedTakeoff = takeoff.length > 0 ? sortedCopy(takeoff) : null;
  let takeoffMean: NetworkQuantity | null = null;
  let takeoffInterval: SpreadEnsembleResult['meanTakeoffSizeInterval'] = null;
  if (takeoff.length > 0) {
    const m = mean(takeoff);
    let sd = 0;
    if (takeoff.length > 1) {
      let s2 = 0;
      for (const x of takeoff) s2 += (x - m) ** 2;
      sd = Math.sqrt(s2 / (takeoff.length - 1));
    }
    takeoffMean = nq('Mean final size | takeoff', m, 'empirical', {
      note: `Over the ${takeoff.length} runs that took off. The ${extinction.length} runs that died out are NOT ` +
        'included; including them would mix two different populations.',
    });
    if (takeoff.length > 1) {
      const ci = tConfidenceInterval(m, sd, takeoff.length, 0.95);
      takeoffInterval = { lower: ci.low, upper: ci.high, level: 0.95 };
    }
  }
  const qs = [0.05, 0.25, 0.5, 0.75, 0.95];
  const takeoffSizeQuantiles = sortedTakeoff
    ? qs.map((p) => ({ p, value: quantileSorted(sortedTakeoff, p) }))
    : [];
  const band = (xs: number[]): { median: number; q05: number; q95: number } | null =>
    xs.length === 0 ? null : { median: quantile(xs, 0.5), q05: quantile(xs, 0.05), q95: quantile(xs, 0.95) };

  const extinctionFraction = completed > 0 ? extinction.length / completed : 0;
  const notes = [
    `${completed} runs${cancelled ? ` of ${runs} requested (cancelled)` : ''} of a ${params.model} process on ` +
      `${g.n} nodes and ${g.m} edges, beta = ${params.beta}, gamma = ${params.gamma}.`,
    `${extinction.length} runs died out at or below a final size of ${cutoff} and are reported separately; ` +
      `${takeoff.length} took off.`,
  ];
  if (takeoff.length > 0 && extinction.length > 0) {
    const m = takeoffMean ? takeoffMean.value : 0;
    const em = mean(extinction);
    notes.push(
      `The pooled mean final size, ${pooled.toPrecision(4)}, lies between the extinction mean ` +
        `(${em.toPrecision(3)}) and the takeoff mean (${m.toPrecision(4)}) and matches neither. It is reported only ` +
        'so that it can be identified and discarded: no run resembles it.',
    );
  }
  if (takeoffSizeQuantiles.length > 0 && takeoffInterval) {
    notes.push(
      `Two different intervals: the 5th–95th percentile of final size across takeoff runs is ` +
        `[${takeoffSizeQuantiles[0].value}, ${takeoffSizeQuantiles[4].value}] (how much outcomes VARY), while the 95% ` +
        `confidence interval for the mean takeoff size is [${takeoffInterval.lower.toPrecision(5)}, ` +
        `${takeoffInterval.upper.toPrecision(5)}] (how precisely ${completed} runs PIN DOWN that mean). The second ` +
        'shrinks with more runs; the first does not.',
    );
  }
  const limitations = [
    'Every number is conditional on the supplied network. A different plausible contact network with the same ' +
      'degree distribution can give a materially different answer, and no amount of simulation detects that.',
    'Monte Carlo error: the extinction probability has a standard error of about ' +
      `${(Math.sqrt((extinctionFraction * (1 - extinctionFraction)) / Math.max(1, completed)) || 0).toPrecision(2)} ` +
      'at this number of runs.',
    `The extinction/takeoff split uses a cutoff of ${cutoff} infections. Near the epidemic threshold the two modes ` +
      'are not cleanly separated and the split is a convention; away from it the result is insensitive to the cutoff.',
  ];
  if (truncatedRuns > 0) {
    limitations.push(
      `${truncatedRuns} of ${completed} runs hit the time or event guard while still active, so their final sizes are ` +
        'LOWER bounds, not final sizes. Raise the horizon or the event budget.',
    );
  }
  if (cancelled) limitations.push(`PARTIAL: cancelled after ${completed} of ${runs} runs.`);

  return {
    model: params.model,
    meta: { runs: completed, requestedRuns: runs, partial: cancelled, seed },
    extinctionRuns: extinction.length,
    extinctionProbability: nq('Probability of dying out', extinctionFraction, 'empirical', {
      note: `${extinction.length} of ${completed} runs. This is a separate quantity from the final size and must not ` +
        'be folded into it.',
    }),
    takeoffRuns: takeoff.length,
    meanTakeoffSize: takeoffMean,
    meanTakeoffSizeInterval: takeoffInterval,
    takeoffSizeQuantiles,
    pooledMeanSize: nq('Pooled mean final size (MISLEADING)', pooled, 'empirical', {
      note: 'Averages extinctions and takeoffs together. The distribution is bimodal, so this number describes no ' +
        'actual outcome. Use the extinction probability and the conditional takeoff distribution instead.',
    }),
    distribution: {
      takeoffSizes: sortedTakeoff ? Array.from(sortedTakeoff) : [],
      extinctionSizes: extinction.slice().sort((a, b) => a - b),
      cutoff,
    },
    peakInfected: band(peaks),
    peakTime: band(peakTimes),
    truncatedRuns,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes,
    limitations,
  };
}

export function runSpreadEnsemble(
  g: Graph,
  params: SpreadParameters,
  seed: string | number,
  options: EnsembleOptions = {},
): SpreadEnsembleResult {
  const it = spreadEnsembleSteps(g, params, seed, options);
  let step = it.next();
  while (!step.done) step = it.next();
  return step.value;
}

/* ---------------------------------------------- network vs mean field */

export interface NetworkVsMeanFieldResult {
  networkFinalFraction: NetworkQuantity;
  meanFieldFinalFraction: NetworkQuantity;
  /** mean field minus network: positive means mean field overestimates. */
  difference: NetworkQuantity;
  clustering: NetworkQuantity;
  reproduction: ReproductionNumbers;
  ensemble: SpreadEnsembleResult;
  meanField: MassActionResult;
  verdict: string;
  conditionalOn: string;
  notes: string[];
}

/**
 * The comparison this module exists for: the simulated network final size
 * against the mean-field prediction, with the clustering that explains the gap.
 */
export function networkVersusMeanField(
  g: Graph,
  params: SpreadParameters,
  seed: string | number,
  options: EnsembleOptions & { clusteringCoefficient?: number } = {},
): NetworkVsMeanFieldResult {
  const deg = degreeSummary(g);
  const ensemble = runSpreadEnsemble(g, params, seed, options);
  const mf = massActionODE({ ...params, meanDegree: deg.meanDegree.value });
  const netFrac = ensemble.meanTakeoffSize ? ensemble.meanTakeoffSize.value / g.n : 0;
  const mfFrac = mf.analyticFinalSize ? mf.analyticFinalSize.value : mf.integratedFinalSize.value;
  const diff = mfFrac - netFrac;
  const clus = options.clusteringCoefficient;
  const rep = reproductionNumbers(g, params);
  const verdict =
    ensemble.takeoffRuns === 0
      ? 'No run took off, so there is no network final size to compare. The mean-field model, being deterministic, ' +
        'still predicts an epidemic — which is itself the discrepancy worth noting.'
      : diff > 0.02
        ? `Mean field OVERestimates the outbreak by ${(diff * 100).toPrecision(3)} percentage points of the ` +
          'population. This is the expected direction on a clustered or spatially embedded network: transmissions ' +
          'from an infected node land on neighbours who are already infected, so they are wasted, and homogeneous ' +
          'mixing cannot represent that.'
        : diff < -0.02
          ? `Mean field UNDERestimates the outbreak by ${(-diff * 100).toPrecision(3)} percentage points. This ` +
            'happens on a heavy-tailed network, where hubs amplify early spread beyond what mean degree implies.'
          : 'Mean field and the network simulation agree to within 2 percentage points, which is what to expect on a ' +
            'dense, unclustered graph — the regime where homogeneous mixing is a good approximation.';
  return {
    networkFinalFraction: nq('Network final fraction | takeoff', netFrac, 'empirical'),
    meanFieldFinalFraction: nq('Mean-field final fraction', mfFrac, 'numerical'),
    difference: nq('Mean field minus network', diff, 'empirical', {
      note: 'Positive means mean field predicts more spread than the network simulation produces.',
    }),
    clustering: nq('Clustering used for the diagnosis', clus ?? 0, clus === undefined ? 'assumed' : 'exact', {
      note: clus === undefined
        ? 'Not supplied; pass clusteringCoefficient for a clustering-based explanation of the gap. Reported as 0 by ' +
          'assumption, which is not a measurement.'
        : undefined,
    }),
    reproduction: rep,
    ensemble,
    meanField: mf,
    verdict,
    conditionalOn: CONDITIONAL_ON_STRUCTURE,
    notes: [
      `Mean degree ${deg.meanDegree.value.toPrecision(4)}, second moment ${deg.secondMoment.value.toPrecision(4)}.`,
      'The network figure is conditional on takeoff; the mean-field figure is unconditional, because a deterministic ' +
        'ODE has no extinction. That difference alone makes the raw numbers non-comparable unless the conditioning is stated.',
    ],
  };
}
