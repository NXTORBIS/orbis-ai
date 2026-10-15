/**
 * Hidden Markov model inference: forward, backward, smoothing, filtering,
 * prediction and Viterbi decoding.
 *
 * Everything here runs in log space. That is not a stylistic choice: the
 * un-scaled forward recursion multiplies a probability below 1 at every
 * timestep, so it underflows to exactly 0 after a few hundred observations and
 * then reports a likelihood of zero for a sequence the model generated itself.
 * A silently-zero likelihood is precisely the kind of plausible-looking fake
 * number this engine refuses to produce, so the recursions carry logs and
 * combine them with logSumExp.
 *
 * All recursions are iterative loops. A recursive formulation would overflow
 * the JavaScript stack on the 100,000-observation sequences this module is
 * expected to handle.
 */
import { logSumExp } from '../core/numeric';
import { EngineError, type Exactness } from '../core/result';
import { normalPdf } from '../special/gamma';
import type { Random } from '../random/rng';
import type { EmissionModel, EmissionOps, HmmModel } from './types';

const SUM_TOL = 1e-9;

/** Bind the emission family operations to a concrete emission model. */
export function emissionOps(emission: EmissionModel): EmissionOps {
  switch (emission.kind) {
    case 'discrete': {
      const b = emission.matrix;
      const s = emission.symbols.length;
      const logB = b.map((row) => row.map((p) => (p > 0 ? Math.log(p) : -Infinity)));
      return {
        kind: 'discrete',
        states: b.length,
        logProb: (state, observation) => logB[state][observation],
        freeParameters: () => b.length * (s - 1),
        checkObservation: (observation, index) => {
          if (!Number.isInteger(observation) || observation < 0 || observation >= s) {
            throw new EngineError(
              `Observation at index ${index} is ${observation}, which is not one of the ${s} symbols in the alphabet (valid symbol indices are 0 to ${s - 1}: ${emission.symbols.join(', ')}).`,
              'alphabet',
            );
          }
        },
        describe: () => `Categorical emissions over ${s} symbols (${emission.symbols.join(', ')}).`,
      };
    }
    case 'gaussian': {
      const { mean, variance } = emission;
      const sd = variance.map((v) => Math.sqrt(v));
      return {
        kind: 'gaussian',
        states: mean.length,
        logProb: (state, observation) => {
          const z = (observation - mean[state]) / sd[state];
          const p = normalPdf(z) / sd[state];
          return p > 0 ? Math.log(p) : -0.5 * z * z - Math.log(sd[state]) - 0.5 * Math.log(2 * Math.PI);
        },
        freeParameters: () => 2 * mean.length,
        checkObservation: (observation, index) => {
          if (!Number.isFinite(observation)) {
            throw new EngineError(`Observation at index ${index} is ${observation}, which is not a finite number.`, 'range');
          }
        },
        describe: () => `Gaussian emissions with one mean and variance per state.`,
      };
    }
  }
}

function checkStochasticRow(row: number[], label: string, expected: number): void {
  if (row.length !== expected) {
    throw new EngineError(`${label} has ${row.length} entries but ${expected} were expected.`, 'shape');
  }
  let sum = 0;
  for (let j = 0; j < row.length; j++) {
    const v = row[j];
    if (!Number.isFinite(v) || v < 0) {
      throw new EngineError(`${label} contains an invalid probability at position ${j + 1}: ${v}.`, 'range');
    }
    sum += v;
  }
  if (Math.abs(sum - 1) > SUM_TOL) {
    throw new EngineError(`${label} sums to ${sum.toPrecision(10)}, not 1.`, 'sum');
  }
}

function checkUnique(names: string[], what: string): void {
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    if (seen.has(names[i])) throw new EngineError(`${what} "${names[i]}" appears more than once (position ${i + 1}); names must be unique.`, 'duplicate');
    seen.add(names[i]);
  }
}

/** Full structural validation. Throws an EngineError naming the offending row. */
export function validateHmm(model: HmmModel): void {
  const n = model.stateNames.length;
  if (n < 1) throw new EngineError('A hidden Markov model needs at least one hidden state.', 'shape');
  checkUnique(model.stateNames, 'Hidden state name');
  checkStochasticRow(model.initial, 'The initial state distribution', n);
  if (model.transition.length !== n) {
    throw new EngineError(`The transition matrix has ${model.transition.length} rows but there are ${n} hidden states.`, 'shape');
  }
  for (let i = 0; i < n; i++) {
    checkStochasticRow(model.transition[i], `Transition row ${i + 1} ("${model.stateNames[i]}")`, n);
  }
  const e = model.emission;
  if (e.kind === 'discrete') {
    if (e.symbols.length < 1) throw new EngineError('The observation alphabet is empty.', 'shape');
    checkUnique(e.symbols, 'Observation symbol');
    if (e.matrix.length !== n) {
      throw new EngineError(`The emission matrix has ${e.matrix.length} rows but there are ${n} hidden states.`, 'shape');
    }
    for (let i = 0; i < n; i++) {
      checkStochasticRow(e.matrix[i], `Emission row ${i + 1} ("${model.stateNames[i]}")`, e.symbols.length);
    }
  } else {
    if (e.mean.length !== n || e.variance.length !== n) {
      throw new EngineError(`The Gaussian emission model gives ${e.mean.length} means and ${e.variance.length} variances but there are ${n} hidden states.`, 'shape');
    }
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(e.mean[i])) throw new EngineError(`Emission mean for state ${i + 1} ("${model.stateNames[i]}") is not a finite number.`, 'range');
      if (!(e.variance[i] > 0) || !Number.isFinite(e.variance[i])) {
        throw new EngineError(`Emission variance for state ${i + 1} ("${model.stateNames[i]}") must be greater than 0; it is ${e.variance[i]}.`, 'range');
      }
    }
  }
}

/** Validates every observation against the model's support. */
export function validateObservations(model: HmmModel, observations: number[]): void {
  if (!observations.length) throw new EngineError('The observation sequence is empty, so there is nothing to infer from.', 'required');
  const ops = emissionOps(model.emission);
  for (let t = 0; t < observations.length; t++) ops.checkObservation(observations[t], t);
}

function logVector(p: number[]): number[] {
  return p.map((x) => (x > 0 ? Math.log(x) : -Infinity));
}

function logMatrix(a: number[][]): number[][] {
  return a.map(logVector);
}

export interface ForwardResult {
  /** logAlpha[t][i] = log P(o_1..o_t, q_t = i). */
  logAlpha: number[][];
  /** log P(o_1..o_T) — finite and negative for any realisable sequence. */
  logLikelihood: number;
  /** Normalised forward probabilities P(q_t = i | o_1..o_t): the filter. */
  filtered: number[][];
  exactness: Exactness;
  method: string;
}

function impossible(observations: number[]): never {
  throw new EngineError(
    `This observation sequence has probability exactly zero under the model: it is impossible, not merely unlikely, so there is no likelihood to report and no state path to decode. The sequence has ${observations.length} observations; check for a symbol that no state can emit, or a transition the model forbids.`,
    'impossible',
  );
}

/** Forward algorithm in log space. O(T·N²) time, O(T·N) memory. */
export function forward(model: HmmModel, observations: number[]): ForwardResult {
  validateHmm(model);
  validateObservations(model, observations);
  const ops = emissionOps(model.emission);
  const n = model.stateNames.length;
  const T = observations.length;
  const logPi = logVector(model.initial);
  const logA = logMatrix(model.transition);
  const logAlpha: number[][] = new Array<number[]>(T);
  const scratch = new Array<number>(n);
  let prev = new Array<number>(n);
  for (let i = 0; i < n; i++) prev[i] = logPi[i] + ops.logProb(i, observations[0]);
  logAlpha[0] = prev.slice();
  for (let t = 1; t < T; t++) {
    const cur = new Array<number>(n);
    const o = observations[t];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) scratch[i] = prev[i] + logA[i][j];
      cur[j] = logSumExp(scratch) + ops.logProb(j, o);
    }
    logAlpha[t] = cur;
    prev = cur;
  }
  const logLikelihood = logSumExp(logAlpha[T - 1]);
  if (!Number.isFinite(logLikelihood)) impossible(observations);
  const filtered = logAlpha.map((row) => {
    const z = logSumExp(row);
    return row.map((x) => Math.exp(x - z));
  });
  return {
    logAlpha,
    logLikelihood,
    filtered,
    exactness: 'exact',
    method: 'Forward recursion carried out in log space with logSumExp, so the likelihood of arbitrarily long sequences is computed without underflow.',
  };
}

export interface BackwardResult {
  /** logBeta[t][i] = log P(o_{t+1}..o_T | q_t = i). */
  logBeta: number[][];
  /** The same likelihood, reached from the other end of the sequence. */
  logLikelihood: number;
  exactness: Exactness;
}

/** Backward algorithm in log space. */
export function backward(model: HmmModel, observations: number[]): BackwardResult {
  validateHmm(model);
  validateObservations(model, observations);
  const ops = emissionOps(model.emission);
  const n = model.stateNames.length;
  const T = observations.length;
  const logPi = logVector(model.initial);
  const logA = logMatrix(model.transition);
  const logBeta: number[][] = new Array<number[]>(T);
  logBeta[T - 1] = new Array<number>(n).fill(0);
  const scratch = new Array<number>(n);
  for (let t = T - 2; t >= 0; t--) {
    const next = logBeta[t + 1];
    const o = observations[t + 1];
    const cur = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) scratch[j] = logA[i][j] + ops.logProb(j, o) + next[j];
      cur[i] = logSumExp(scratch);
    }
    logBeta[t] = cur;
  }
  const first = new Array<number>(n);
  for (let i = 0; i < n; i++) first[i] = logPi[i] + ops.logProb(i, observations[0]) + logBeta[0][i];
  const logLikelihood = logSumExp(first);
  if (!Number.isFinite(logLikelihood)) impossible(observations);
  return { logBeta, logLikelihood, exactness: 'exact' };
}

export interface PosteriorResult {
  /** gamma[t][i] = P(q_t = i | all observations). Each row sums to 1. */
  gamma: number[][];
  /** xi[t][i][j] = P(q_t = i, q_{t+1} = j | all observations). Each slice sums to 1. */
  xi: number[][][];
  logLikelihood: number;
  /** Per-timestep Shannon entropy of the state posterior, in bits. */
  entropy: number[];
  /** log2 of the number of states: the entropy of complete ignorance. */
  maxEntropy: number;
  /** argmax_i gamma[t][i]: the individually most likely state at each time. */
  posteriorModePath: number[];
  exactness: Exactness;
  notes: string[];
}

/**
 * Smoothed posteriors. γ answers "given everything I saw, where was the system
 * at time t?"; the entropy beside it answers "and how sure is that?" — which is
 * the honest counterpart to a Viterbi path, because a decoded path always looks
 * equally confident whether the evidence was decisive or nearly uninformative.
 */
export function posteriors(model: HmmModel, observations: number[]): PosteriorResult {
  const f = forward(model, observations);
  const b = backward(model, observations);
  const ops = emissionOps(model.emission);
  const n = model.stateNames.length;
  const T = observations.length;
  const logA = logMatrix(model.transition);
  const ll = f.logLikelihood;
  const gamma: number[][] = new Array<number[]>(T);
  const entropy = new Array<number>(T);
  const posteriorModePath = new Array<number>(T);
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = Math.exp(f.logAlpha[t][i] + b.logBeta[t][i] - ll);
      row[i] = p;
      sum += p;
    }
    // Renormalise: the three logs are each accurate to a few ulp, so the ratio
    // can sit a few 1e-16 away from summing to 1. γ must sum to exactly 1.
    for (let i = 0; i < n; i++) row[i] /= sum;
    let h = 0;
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (row[i] > 0) h -= row[i] * Math.log2(row[i]);
      if (row[i] > row[best]) best = i;
    }
    gamma[t] = row;
    entropy[t] = h;
    posteriorModePath[t] = best;
  }
  const xi: number[][][] = new Array<number[][]>(Math.max(0, T - 1));
  for (let t = 0; t < T - 1; t++) {
    const slice: number[][] = new Array<number[]>(n);
    let sum = 0;
    const o = observations[t + 1];
    for (let i = 0; i < n; i++) {
      const row = new Array<number>(n);
      for (let j = 0; j < n; j++) {
        const p = Math.exp(f.logAlpha[t][i] + logA[i][j] + ops.logProb(j, o) + b.logBeta[t + 1][j] - ll);
        row[j] = p;
        sum += p;
      }
      slice[i] = row;
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) slice[i][j] /= sum;
    xi[t] = slice;
  }
  return {
    gamma,
    xi,
    logLikelihood: ll,
    entropy,
    maxEntropy: Math.log2(n),
    posteriorModePath,
    exactness: 'exact',
    notes: [
      'γ gives the marginal posterior for each timestep separately. Reading off the most likely state at every step (the posterior-mode path) maximises the expected number of individually correct states, but the resulting path need not be a path the model allows at all.',
      `Entropy is in bits; complete ignorance between ${n} states is ${Math.log2(n).toPrecision(4)} bits and 0 means the evidence pins the state down exactly.`,
    ],
  };
}

export interface ViterbiResult {
  /** The single most likely state sequence. */
  path: number[];
  pathNames: string[];
  /** log P(path, observations) — the joint, not a posterior. */
  logProbability: number;
  /** log P(path | observations). */
  logPosterior: number;
  exactness: Exactness;
  method: string;
}

/** Viterbi decoding in log space with explicit backpointers. */
export function viterbi(model: HmmModel, observations: number[]): ViterbiResult {
  validateHmm(model);
  validateObservations(model, observations);
  const ops = emissionOps(model.emission);
  const n = model.stateNames.length;
  const T = observations.length;
  const logPi = logVector(model.initial);
  const logA = logMatrix(model.transition);
  // Backpointers as a flat typed array: at T = 100,000 and N = 20 this is a
  // single 2 MB buffer rather than 100,000 small arrays.
  const back = new Int32Array(T * n);
  let prev = new Array<number>(n);
  for (let i = 0; i < n; i++) prev[i] = logPi[i] + ops.logProb(i, observations[0]);
  for (let t = 1; t < T; t++) {
    const cur = new Array<number>(n);
    const o = observations[t];
    for (let j = 0; j < n; j++) {
      let bestVal = -Infinity;
      let bestArg = 0;
      for (let i = 0; i < n; i++) {
        const v = prev[i] + logA[i][j];
        if (v > bestVal) {
          bestVal = v;
          bestArg = i;
        }
      }
      cur[j] = bestVal + ops.logProb(j, o);
      back[t * n + j] = bestArg;
    }
    prev = cur;
  }
  let endArg = 0;
  for (let i = 1; i < n; i++) if (prev[i] > prev[endArg]) endArg = i;
  const logProbability = prev[endArg];
  if (!Number.isFinite(logProbability)) {
    throw new EngineError(
      `No state sequence can produce these ${T} observations: every path has probability exactly zero, so there is no most likely path. Check for a symbol no state emits or a transition the model forbids.`,
      'impossible',
    );
  }
  const path = new Array<number>(T);
  path[T - 1] = endArg;
  for (let t = T - 1; t > 0; t--) path[t - 1] = back[t * n + path[t]];
  // The posterior of the path needs the total likelihood, which is a second
  // O(T·N²) pass; it is reported because log P(path, o) alone is unreadable.
  const totalLogLikelihood = forward(model, observations).logLikelihood;
  return {
    path,
    pathNames: path.map((i) => model.stateNames[i]),
    logProbability,
    logPosterior: logProbability - totalLogLikelihood,
    exactness: 'exact',
    method: 'Viterbi dynamic programming in log space with backpointers; the maximisation is exact (no summation, so no approximation beyond floating point).',
  };
}

export interface DecodingComparison {
  viterbi: ViterbiResult;
  posterior: PosteriorResult;
  /** Timesteps at which the two paths disagree. */
  disagreements: number[];
  /** True when the posterior-mode path has probability zero under the model. */
  posteriorModePathImpossible: boolean;
  /** log P(posterior-mode path, observations), or −Infinity if impossible. */
  posteriorModePathLogProbability: number;
  notes: string[];
}

/** log P(given state path, observations) — used to compare decodings. */
export function pathLogProbability(model: HmmModel, observations: number[], path: number[]): number {
  validateHmm(model);
  validateObservations(model, observations);
  if (path.length !== observations.length) {
    throw new EngineError(`The state path has ${path.length} entries but there are ${observations.length} observations.`, 'shape');
  }
  const n = model.stateNames.length;
  for (let t = 0; t < path.length; t++) {
    if (!Number.isInteger(path[t]) || path[t] < 0 || path[t] >= n) {
      throw new EngineError(`The state path contains ${path[t]} at index ${t}, which is not one of the ${n} hidden states.`, 'range');
    }
  }
  const ops = emissionOps(model.emission);
  const logPi = logVector(model.initial);
  const logA = logMatrix(model.transition);
  let lp = logPi[path[0]] + ops.logProb(path[0], observations[0]);
  for (let t = 1; t < path.length; t++) {
    lp += logA[path[t - 1]][path[t]] + ops.logProb(path[t], observations[t]);
    if (lp === -Infinity) return -Infinity;
  }
  return lp;
}

/**
 * Both decodings side by side.
 *
 * The Viterbi path and the sequence of individually most likely states are
 * different answers to different questions, and they can differ. In the
 * extreme, the posterior-mode path can be a sequence the model assigns
 * probability zero to — every step individually most likely, the whole
 * impossible — while the Viterbi path contains no individually-optimal state at
 * all. Software almost never shows the contrast; this function does.
 */
export function compareDecodings(model: HmmModel, observations: number[]): DecodingComparison {
  const v = viterbi(model, observations);
  const p = posteriors(model, observations);
  const disagreements: number[] = [];
  for (let t = 0; t < v.path.length; t++) if (v.path[t] !== p.posteriorModePath[t]) disagreements.push(t);
  const modeLp = pathLogProbability(model, observations, p.posteriorModePath);
  return {
    viterbi: v,
    posterior: p,
    disagreements,
    posteriorModePathImpossible: modeLp === -Infinity,
    posteriorModePathLogProbability: modeLp,
    notes: [
      'The Viterbi path maximises the probability of the whole sequence of states. The posterior-mode path maximises the probability of each state separately. These are different optimisation problems and the answers differ whenever the transition structure couples the timesteps strongly.',
      disagreements.length
        ? `The two decodings disagree at ${disagreements.length} of ${v.path.length} timesteps.`
        : 'The two decodings agree everywhere for this sequence, which is common but not guaranteed.',
      modeLp === -Infinity
        ? 'The posterior-mode path has probability exactly zero under this model: each of its states is individually most likely, yet the sequence as a whole cannot happen. This is the clearest demonstration that per-timestep modes do not compose into a path.'
        : 'The posterior-mode path is a possible path here, but it is still not the most likely path.',
      'Read the Viterbi path together with the per-timestep posterior entropy. A decoded path looks equally confident at every step; the entropy shows where the inference was actually decided by the data and where it was a coin flip.',
    ],
  };
}

export interface PredictionResult {
  /** stateDistribution[h][i] = P(q_{T+h} = i | observations), h = 1..horizon. */
  stateDistribution: number[][];
  /**
   * Predicted observations. For discrete emissions, symbolProbability[h][s].
   * For Gaussian emissions the mixture mean and variance per horizon.
   */
  symbolProbability: number[][] | null;
  mixtureMean: number[] | null;
  mixtureVariance: number[] | null;
  exactness: Exactness;
  notes: string[];
}

/** Forecast hidden states and observations forward from the filtered state. */
export function predict(model: HmmModel, observations: number[], horizon: number): PredictionResult {
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new EngineError('The prediction horizon must be a whole number of 1 or more.', 'range');
  }
  const f = forward(model, observations);
  const n = model.stateNames.length;
  let cur = f.filtered[f.filtered.length - 1].slice();
  const stateDistribution: number[][] = [];
  for (let h = 0; h < horizon; h++) {
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const pi = cur[i];
      if (pi === 0) continue;
      for (let j = 0; j < n; j++) next[j] += pi * model.transition[i][j];
    }
    cur = next;
    stateDistribution.push(next.slice());
  }
  const e = model.emission;
  let symbolProbability: number[][] | null = null;
  let mixtureMean: number[] | null = null;
  let mixtureVariance: number[] | null = null;
  if (e.kind === 'discrete') {
    symbolProbability = stateDistribution.map((d) => {
      const out = new Array<number>(e.symbols.length).fill(0);
      for (let i = 0; i < n; i++) for (let s = 0; s < e.symbols.length; s++) out[s] += d[i] * e.matrix[i][s];
      return out;
    });
  } else {
    mixtureMean = stateDistribution.map((d) => d.reduce((a, p, i) => a + p * e.mean[i], 0));
    mixtureVariance = stateDistribution.map((d, h) => {
      const m = mixtureMean![h];
      let v = 0;
      for (let i = 0; i < n; i++) v += d[i] * (e.variance[i] + (e.mean[i] - m) ** 2);
      return v;
    });
  }
  return {
    stateDistribution,
    symbolProbability,
    mixtureMean,
    mixtureVariance,
    exactness: 'exact',
    notes: [
      'These are predictive distributions conditional on the observations so far and on the model being exactly right. They are not confidence intervals for an estimated parameter: they are percentiles of where the process itself may go.',
      'Prediction uncertainty grows with the horizon and converges to the stationary distribution of the transition matrix, after which the current observation has stopped mattering.',
    ],
  };
}

export interface SimulatedSequence {
  states: number[];
  observations: number[];
  exactness: Exactness;
}

/** Simulate a hidden state path and the observations it emits. */
export function simulateHmm(model: HmmModel, length: number, rng: Random): SimulatedSequence {
  validateHmm(model);
  if (!Number.isInteger(length) || length < 1) throw new EngineError('The sequence length must be a whole number of 1 or more.', 'range');
  const pick = (probs: number[]): number => {
    const u = rng.uniform();
    let c = 0;
    for (let i = 0; i < probs.length; i++) {
      c += probs[i];
      if (u < c) return i;
    }
    return probs.length - 1;
  };
  const e = model.emission;
  const states = new Array<number>(length);
  const observations = new Array<number>(length);
  let s = pick(model.initial);
  for (let t = 0; t < length; t++) {
    states[t] = s;
    observations[t] = e.kind === 'discrete' ? pick(e.matrix[s]) : e.mean[s] + Math.sqrt(e.variance[s]) * rng.normal();
    if (t + 1 < length) s = pick(model.transition[s]);
  }
  return { states, observations, exactness: 'empirical' };
}
