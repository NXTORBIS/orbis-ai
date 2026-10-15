/**
 * Exact analysis of finite discrete-time Markov chains.
 *
 * Everything here is computed by linear algebra rather than simulation, so the
 * results are exact up to floating-point rounding:
 *
 *  - n-step distribution: π₀ Pⁿ, by repeated squaring.
 *  - Stationary distribution: solves πP = π with Σπ = 1. For an irreducible
 *    aperiodic chain this is the unique long-run distribution. For a reducible
 *    chain the solution is not unique and the engine says so rather than
 *    returning one arbitrary answer.
 *  - Classification: recurrent/transient classes by strongly connected
 *    components of the transition graph; periodicity by gcd of cycle lengths.
 *  - Absorbing chains: expected steps to absorption and absorption
 *    probabilities from the fundamental matrix N = (I − Q)⁻¹.
 */
import { EngineError } from '../core/result';
import { identity, matPow, solve, vecMat, type Matrix } from './linalg';

export interface ChainClassification {
  /** Index groups of communicating states. */
  classes: { states: number[]; recurrent: boolean; period: number | null }[];
  irreducible: boolean;
  aperiodic: boolean;
  absorbingStates: number[];
  note: string;
}

export function validateChain(matrix: Matrix): void {
  const n = matrix.length;
  if (n < 1) throw new EngineError('The chain needs at least one state.', 'shape');
  for (let i = 0; i < n; i++) {
    if (matrix[i].length !== n) throw new EngineError(`Row ${i + 1} must have ${n} entries.`, 'shape');
    let s = 0;
    for (const v of matrix[i]) {
      if (!Number.isFinite(v) || v < 0) throw new EngineError(`Row ${i + 1} contains an invalid probability.`, 'range');
      s += v;
    }
    if (Math.abs(s - 1) > 1e-9) {
      throw new EngineError(`Row ${i + 1} sums to ${s.toPrecision(8)}, not 1. Every row of a transition matrix must sum to 1.`, 'sum');
    }
  }
}

/** Distribution after n steps from an initial distribution. */
export function nStepDistribution(matrix: Matrix, initial: number[], steps: number): number[] {
  validateChain(matrix);
  if (!Number.isInteger(steps) || steps < 0) throw new EngineError('The number of steps must be a whole number of 0 or more.', 'range');
  const sum = initial.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-9) {
    throw new EngineError(`The starting distribution sums to ${sum.toPrecision(8)}, not 1.`, 'sum');
  }
  if (steps === 0) return [...initial];
  if (steps <= 64) {
    let v = [...initial];
    for (let i = 0; i < steps; i++) v = vecMat(v, matrix);
    return normalise(v);
  }
  return normalise(vecMat(initial, matPow(matrix, steps)));
}

/** n-step transition matrix Pⁿ. */
export function nStepMatrix(matrix: Matrix, steps: number): Matrix {
  validateChain(matrix);
  if (!Number.isInteger(steps) || steps < 0) throw new EngineError('The number of steps must be a whole number of 0 or more.', 'range');
  return steps === 0 ? identity(matrix.length) : matPow(matrix, steps);
}

function normalise(v: number[]): number[] {
  const s = v.reduce((a, b) => a + b, 0);
  return s > 0 ? v.map((x) => x / s) : v;
}

/** Tarjan strongly connected components of the transition graph. */
function stronglyConnectedComponents(matrix: Matrix): number[][] {
  const n = matrix.length;
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let counter = 0;
  const strongConnect = (v: number) => {
    // Iterative Tarjan to avoid deep recursion on large chains.
    const callStack: { v: number; child: number }[] = [{ v, child: 0 }];
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    while (callStack.length) {
      const frame = callStack[callStack.length - 1];
      if (frame.child < n) {
        const w = frame.child++;
        if (matrix[frame.v][w] <= 0) continue;
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = true;
          callStack.push({ v: w, child: 0 });
        } else if (onStack[w]) {
          low[frame.v] = Math.min(low[frame.v], index[w]);
        }
      } else {
        callStack.pop();
        if (callStack.length) {
          const parent = callStack[callStack.length - 1];
          low[parent.v] = Math.min(low[parent.v], low[frame.v]);
        }
        if (low[frame.v] === index[frame.v]) {
          const comp: number[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack[w] = false;
            comp.push(w);
            if (w === frame.v) break;
          }
          out.push(comp.sort((a, b) => a - b));
        }
      }
    }
  };
  for (let v = 0; v < n; v++) if (index[v] === -1) strongConnect(v);
  return out;
}

/** Period of a communicating class: gcd of the lengths of its cycles. */
function classPeriod(matrix: Matrix, states: number[]): number {
  const set = new Set(states);
  const level = new Map<number, number>();
  const start = states[0];
  level.set(start, 0);
  const queue = [start];
  let period = 0;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  while (queue.length) {
    const v = queue.shift()!;
    const lv = level.get(v)!;
    for (const w of states) {
      if (matrix[v][w] <= 0 || !set.has(w)) continue;
      if (level.has(w)) {
        const diff = lv + 1 - level.get(w)!;
        if (diff !== 0) period = gcd(period, Math.abs(diff));
      } else {
        level.set(w, lv + 1);
        queue.push(w);
      }
    }
  }
  return period || 1;
}

export function classifyChain(matrix: Matrix): ChainClassification {
  validateChain(matrix);
  const n = matrix.length;
  const comps = stronglyConnectedComponents(matrix);
  const compOf = new Map<number, number>();
  comps.forEach((c, i) => c.forEach((s) => compOf.set(s, i)));
  const classes = comps.map((states) => {
    // A class is recurrent when no transition leaves it.
    let closed = true;
    for (const s of states) {
      for (let j = 0; j < n; j++) {
        if (matrix[s][j] > 0 && compOf.get(j) !== compOf.get(s)) closed = false;
      }
    }
    return { states, recurrent: closed, period: closed ? classPeriod(matrix, states) : null };
  });
  const absorbing = Array.from({ length: n }, (_, i) => i).filter((i) => matrix[i][i] === 1);
  const irreducible = comps.length === 1;
  const recurrentClasses = classes.filter((c) => c.recurrent);
  const aperiodic = recurrentClasses.every((c) => c.period === 1);
  let note: string;
  if (irreducible && aperiodic) {
    note = 'The chain is irreducible and aperiodic, so it has a unique stationary distribution that it converges to from any starting point.';
  } else if (irreducible) {
    note = `The chain is irreducible but periodic (period ${recurrentClasses[0]?.period}). A unique stationary distribution exists, but the chain cycles rather than settling: the distribution after n steps keeps oscillating.`;
  } else {
    note = `The chain is reducible: it has ${comps.length} communicating classes, of which ${recurrentClasses.length} are recurrent. Where the chain ends up depends on the starting state, so there is no single long-run distribution.`;
  }
  return { classes, irreducible, aperiodic, absorbingStates: absorbing, note };
}

export interface StationaryResult {
  distribution: number[] | null;
  unique: boolean;
  /** Expected return time to each state, 1/πᵢ, where defined. */
  meanRecurrenceTimes: (number | null)[];
  classification: ChainClassification;
  method: string;
  limitations: string[];
}

/** Stationary distribution π solving πP = π, Σπ = 1. */
export function stationaryDistribution(matrix: Matrix): StationaryResult {
  validateChain(matrix);
  const n = matrix.length;
  const classification = classifyChain(matrix);
  const limitations: string[] = [];
  if (!classification.irreducible) {
    limitations.push(
      'Because the chain is reducible, more than one stationary distribution exists and none of them describes the chain from every starting point. Analyse each recurrent class separately, or use the absorption analysis below.',
    );
  }
  if (classification.irreducible && !classification.aperiodic) {
    limitations.push(
      'The chain is periodic, so the distribution after n steps does not converge to the stationary distribution; it cycles. The stationary distribution still gives the long-run average time spent in each state.',
    );
  }
  // Solve (Pᵀ − I)π = 0 with the normalisation Σπ = 1 replacing the last row.
  const a: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => matrix[j][i] - (i === j ? 1 : 0)));
  const b = new Array<number>(n).fill(0);
  a[n - 1] = new Array<number>(n).fill(1);
  b[n - 1] = 1;
  const sol = solve(a, b);
  const distribution = sol && sol.every((x) => Number.isFinite(x) && x >= -1e-9) ? normalise(sol.map((x) => Math.max(0, x))) : null;
  if (!distribution) {
    limitations.push('No stationary distribution could be computed from this matrix: the linear system is singular, which happens for reducible chains.');
  }
  return {
    distribution,
    unique: classification.irreducible,
    meanRecurrenceTimes: distribution ? distribution.map((p) => (p > 0 ? 1 / p : null)) : new Array(n).fill(null),
    classification,
    method: 'Solves πP = π with Σπ = 1 by Gaussian elimination — exact linear algebra, not simulation.',
    limitations,
  };
}

export interface AbsorptionResult {
  absorbingStates: number[];
  transientStates: number[];
  /** Expected number of steps to absorption from each transient state. */
  expectedSteps: number[];
  /** absorptionProbability[t][a] = P(absorbed in a | start in transient t). */
  absorptionProbability: number[][];
  method: string;
  limitations: string[];
}

/**
 * Absorption analysis for a chain with at least one absorbing state.
 * Uses the fundamental matrix N = (I − Q)⁻¹ where Q is the transient-to-
 * transient block: row sums of N give expected steps, and N·R gives
 * absorption probabilities.
 */
export function absorptionAnalysis(matrix: Matrix): AbsorptionResult {
  validateChain(matrix);
  const n = matrix.length;
  const absorbing = Array.from({ length: n }, (_, i) => i).filter((i) => matrix[i][i] === 1);
  if (!absorbing.length) {
    throw new EngineError(
      'This chain has no absorbing state (no state with a self-transition probability of 1), so there is nothing to be absorbed into. Use the stationary distribution instead.',
      'unsupported',
    );
  }
  const transient = Array.from({ length: n }, (_, i) => i).filter((i) => !absorbing.includes(i));
  if (!transient.length) {
    return {
      absorbingStates: absorbing,
      transientStates: [],
      expectedSteps: [],
      absorptionProbability: [],
      method: 'Every state is absorbing, so the chain never moves.',
      limitations: [],
    };
  }
  const t = transient.length;
  // I − Q
  const iq: Matrix = Array.from({ length: t }, (_, i) =>
    Array.from({ length: t }, (_, j) => (i === j ? 1 : 0) - matrix[transient[i]][transient[j]]),
  );
  // Expected steps: solve (I − Q)·x = 1
  const steps = solve(iq, new Array<number>(t).fill(1));
  if (!steps || steps.some((x) => !Number.isFinite(x) || x < 0)) {
    throw new EngineError(
      'Expected time to absorption is infinite or undefined for this chain: some transient states cannot reach an absorbing state. Check the transition probabilities.',
      'undefined',
    );
  }
  // Absorption probabilities: solve (I − Q)·X = R, column by column.
  const probability: number[][] = Array.from({ length: t }, () => new Array<number>(absorbing.length).fill(0));
  absorbing.forEach((a, ai) => {
    const r = transient.map((ti) => matrix[ti][a]);
    const col = solve(iq, r);
    if (!col) throw new EngineError('Absorption probabilities could not be computed: the system is singular.', 'undefined');
    col.forEach((v, ti) => {
      probability[ti][ai] = Math.min(1, Math.max(0, v));
    });
  });
  return {
    absorbingStates: absorbing,
    transientStates: transient,
    expectedSteps: steps,
    absorptionProbability: probability,
    method: 'Fundamental matrix N = (I − Q)⁻¹: row sums give the expected number of steps to absorption, and N·R gives the probability of ending in each absorbing state.',
    limitations: [
      'Expected steps to absorption is a long-run average; individual paths vary widely, and the distribution of absorption times is usually skewed.',
      'These figures assume the transition probabilities stay constant over time.',
    ],
  };
}
