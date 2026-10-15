/**
 * Tests for the hidden Markov model and advanced discrete-chain module.
 *
 * Reference values are independent of the implementation under test: either
 * hand computed in a comment, derived from a closed form, or obtained by
 * brute-force enumeration written here in the test file. Nothing is asserted
 * against this module's own output.
 */
import { describe, expect, it } from 'vitest';
import { Random } from '../random/rng';
import type { Matrix } from '../stats/linalg';
import {
  baumWelch,
  canonicaliseStates,
  compareDecodings,
  convergenceRate,
  forward,
  backward,
  fundamentalMatrix,
  hittingProbabilities,
  markovPropertyTest,
  meanFirstPassageTimes,
  pathLogProbability,
  periodicity,
  posteriors,
  predict,
  qrEigenvalues,
  reversibility,
  selectChainOrder,
  selectStateCount,
  tvDistanceToStationary,
  sequenceLogLikelihood,
  simulateHmm,
  supervisedFit,
  viterbi,
} from './index';
import type { DiscreteEmission, HmmModel } from './types';

/** Discrete HMM helper. */
function discreteModel(initial: number[], transition: Matrix, emission: Matrix, symbols?: string[]): HmmModel {
  return {
    stateNames: initial.map((_, i) => `S${i + 1}`),
    initial,
    transition,
    emission: { kind: 'discrete', symbols: symbols ?? emission[0].map((_, i) => `o${i + 1}`), matrix: emission },
  };
}

/**
 * Ground truth by brute force: enumerate every one of N^T state paths,
 * accumulate the joint probability of each, and read off the exact sequence
 * likelihood, the exact most likely path and the exact per-timestep marginals.
 * This is written independently of the algorithms being tested.
 */
function enumerate(model: HmmModel, observations: number[]): {
  likelihood: number;
  bestPath: number[];
  bestJoint: number;
  marginals: number[][];
  pairMarginals: number[][][];
} {
  const n = model.stateNames.length;
  const T = observations.length;
  const emission = model.emission as DiscreteEmission;
  const b = emission.matrix;
  let likelihood = 0;
  let bestJoint = -1;
  let bestPath: number[] = [];
  const marginals: number[][] = Array.from({ length: T }, () => new Array<number>(n).fill(0));
  const pairMarginals: number[][][] = Array.from({ length: Math.max(0, T - 1) }, () =>
    Array.from({ length: n }, () => new Array<number>(n).fill(0)),
  );
  const path = new Array<number>(T).fill(0);
  const totalPaths = Math.pow(n, T);
  for (let code = 0; code < totalPaths; code++) {
    let rest = code;
    for (let t = 0; t < T; t++) {
      path[t] = rest % n;
      rest = Math.floor(rest / n);
    }
    let p = model.initial[path[0]] * b[path[0]][observations[0]];
    for (let t = 1; t < T; t++) p *= model.transition[path[t - 1]][path[t]] * b[path[t]][observations[t]];
    likelihood += p;
    if (p > bestJoint) {
      bestJoint = p;
      bestPath = [...path];
    }
    for (let t = 0; t < T; t++) marginals[t][path[t]] += p;
    for (let t = 0; t < T - 1; t++) pairMarginals[t][path[t]][path[t + 1]] += p;
  }
  for (let t = 0; t < T; t++) for (let i = 0; i < n; i++) marginals[t][i] /= likelihood;
  for (let t = 0; t < T - 1; t++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) pairMarginals[t][i][j] /= likelihood;
  return { likelihood, bestPath, bestJoint, marginals, pairMarginals };
}

function simulateChain(matrix: Matrix, length: number, rng: Random, start = 0): number[] {
  const out = new Array<number>(length);
  let s = start;
  for (let t = 0; t < length; t++) {
    out[t] = s;
    const u = rng.uniform();
    let c = 0;
    for (let j = 0; j < matrix.length; j++) {
      c += matrix[s][j];
      if (u < c) {
        s = j;
        break;
      }
    }
  }
  return out;
}

describe('HMM: brute-force cross-check against complete path enumeration', () => {
  const model = discreteModel(
    [0.55, 0.3, 0.15],
    [
      [0.6, 0.3, 0.1],
      [0.2, 0.5, 0.3],
      [0.35, 0.15, 0.5],
    ],
    [
      [0.7, 0.2, 0.1],
      [0.1, 0.6, 0.3],
      [0.25, 0.25, 0.5],
    ],
  );
  const observations = [0, 2, 1, 1, 0, 2, 0]; // 3^7 = 2187 paths enumerated

  it('reproduces the exact sequence likelihood from the summed path probabilities', () => {
    const truth = enumerate(model, observations);
    const f = forward(model, observations);
    expect(Math.exp(f.logLikelihood)).toBeCloseTo(truth.likelihood, 12);
    expect(Math.abs(Math.exp(f.logLikelihood) - truth.likelihood)).toBeLessThan(1e-12);
  });

  it('reproduces the exact Viterbi path and its joint probability', () => {
    const truth = enumerate(model, observations);
    const v = viterbi(model, observations);
    expect(v.path).toEqual(truth.bestPath);
    expect(Math.exp(v.logProbability)).toBeCloseTo(truth.bestJoint, 14);
  });

  it('reproduces the exact posterior marginals at every timestep', () => {
    const truth = enumerate(model, observations);
    const post = posteriors(model, observations);
    for (let t = 0; t < observations.length; t++) {
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(post.gamma[t][i] - truth.marginals[t][i])).toBeLessThan(1e-12);
      }
    }
  });

  it('reproduces the exact pairwise posteriors', () => {
    const truth = enumerate(model, observations);
    const post = posteriors(model, observations);
    for (let t = 0; t < observations.length - 1; t++) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          expect(Math.abs(post.xi[t][i][j] - truth.pairMarginals[t][i][j])).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('agrees with enumeration for a 2-state model over a length-8 sequence (256 paths)', () => {
    const small = discreteModel([0.3, 0.7], [[0.85, 0.15], [0.45, 0.55]], [[0.2, 0.8], [0.9, 0.1]]);
    const obs = [1, 1, 0, 1, 0, 0, 1, 0];
    const truth = enumerate(small, obs);
    const f = forward(small, obs);
    expect(Math.abs(Math.exp(f.logLikelihood) - truth.likelihood)).toBeLessThan(1e-12);
    expect(viterbi(small, obs).path).toEqual(truth.bestPath);
  });
});

describe('HMM: forward and backward consistency', () => {
  const model = discreteModel(
    [0.2, 0.5, 0.3],
    [
      [0.5, 0.25, 0.25],
      [0.3, 0.4, 0.3],
      [0.1, 0.1, 0.8],
    ],
    [
      [0.5, 0.3, 0.2],
      [0.2, 0.2, 0.6],
      [0.1, 0.7, 0.2],
    ],
  );
  const observations = [0, 1, 2, 2, 1, 0, 1, 2, 0, 0, 1, 2];

  it('reaches the same likelihood from both ends of the sequence', () => {
    const f = forward(model, observations);
    const b = backward(model, observations);
    expect(Math.abs(f.logLikelihood - b.logLikelihood)).toBeLessThan(1e-10);
  });

  it('gives a posterior that sums to 1 at every timestep', () => {
    const post = posteriors(model, observations);
    for (const row of post.gamma) {
      expect(Math.abs(row.reduce((a, x) => a + x, 0) - 1)).toBeLessThan(1e-12);
    }
  });

  it('gives pairwise posteriors that sum to 1 at every transition', () => {
    const post = posteriors(model, observations);
    expect(post.xi).toHaveLength(observations.length - 1);
    for (const slice of post.xi) {
      const total = slice.reduce((a, row) => a + row.reduce((x, y) => x + y, 0), 0);
      expect(Math.abs(total - 1)).toBeLessThan(1e-12);
    }
  });

  it('has xi marginalising to gamma', () => {
    const post = posteriors(model, observations);
    for (let t = 0; t < observations.length - 1; t++) {
      for (let i = 0; i < 3; i++) {
        const rowSum = post.xi[t][i].reduce((a, x) => a + x, 0);
        expect(Math.abs(rowSum - post.gamma[t][i])).toBeLessThan(1e-12);
      }
    }
  });
});

describe('HMM: hand-computed forward probabilities', () => {
  /*
   * π = (0.6, 0.4)
   * A = [[0.7, 0.3], [0.4, 0.6]]
   * B = [[0.1, 0.9], [0.8, 0.2]]   symbols: a = 0, b = 1
   * Observations: a, b
   *
   * α₁(0) = 0.6 × 0.1 = 0.06
   * α₁(1) = 0.4 × 0.8 = 0.32
   * α₂(0) = (0.06 × 0.7 + 0.32 × 0.4) × 0.9 = (0.042 + 0.128) × 0.9 = 0.17 × 0.9 = 0.153
   * α₂(1) = (0.06 × 0.3 + 0.32 × 0.6) × 0.2 = (0.018 + 0.192) × 0.2 = 0.21 × 0.2 = 0.042
   * P(a, b) = 0.153 + 0.042 = 0.195
   */
  const model = discreteModel([0.6, 0.4], [[0.7, 0.3], [0.4, 0.6]], [[0.1, 0.9], [0.8, 0.2]], ['a', 'b']);

  it('matches the hand computation at t = 1 and t = 2', () => {
    const f = forward(model, [0, 1]);
    expect(Math.abs(Math.exp(f.logAlpha[0][0]) - 0.06)).toBeLessThan(1e-12);
    expect(Math.abs(Math.exp(f.logAlpha[0][1]) - 0.32)).toBeLessThan(1e-12);
    expect(Math.abs(Math.exp(f.logAlpha[1][0]) - 0.153)).toBeLessThan(1e-12);
    expect(Math.abs(Math.exp(f.logAlpha[1][1]) - 0.042)).toBeLessThan(1e-12);
    expect(Math.abs(Math.exp(f.logLikelihood) - 0.195)).toBeLessThan(1e-12);
  });

  it('gives the filtered distribution at t = 2 as 0.153/0.195 and 0.042/0.195', () => {
    const f = forward(model, [0, 1]);
    expect(Math.abs(f.filtered[1][0] - 0.153 / 0.195)).toBeLessThan(1e-12);
    expect(Math.abs(f.filtered[1][1] - 0.042 / 0.195)).toBeLessThan(1e-12);
  });
});

describe('HMM: underflow resistance', () => {
  const model = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.15, 0.85]], [[0.6, 0.3, 0.1], [0.1, 0.3, 0.6]]);

  it('computes a finite, large, negative log-likelihood for 100,000 observations', () => {
    const rng = new Random('underflow');
    const sim = simulateHmm(model, 100000, rng);
    expect(sim.observations).toHaveLength(100000);
    const f = forward(model, sim.observations);
    expect(Number.isFinite(f.logLikelihood)).toBe(true);
    expect(f.logLikelihood).toBeLessThan(0);
    // Each observation costs at least log(1/3) ≈ −1.1 nats of likelihood, so a
    // 100,000-long sequence must sit far below −10,000. A naive un-scaled
    // forward pass returns exactly 0 (log −Infinity) here.
    expect(f.logLikelihood).toBeLessThan(-10000);
    expect(f.logLikelihood).toBeGreaterThan(-1e7);
  });

  it('decodes a 100,000-step Viterbi path without stack overflow or underflow', () => {
    const rng = new Random('underflow-viterbi');
    const sim = simulateHmm(model, 100000, rng);
    const v = viterbi(model, sim.observations);
    expect(v.path).toHaveLength(100000);
    expect(Number.isFinite(v.logProbability)).toBe(true);
    expect(v.logProbability).toBeLessThan(-10000);
    // The Viterbi joint can never exceed the total likelihood of the sequence.
    expect(v.logProbability).toBeLessThanOrEqual(forward(model, sim.observations).logLikelihood + 1e-9);
  });

  it('keeps the backward pass finite over 100,000 observations', () => {
    const rng = new Random('underflow-backward');
    const sim = simulateHmm(model, 100000, rng);
    const f = forward(model, sim.observations);
    const b = backward(model, sim.observations);
    expect(Number.isFinite(b.logLikelihood)).toBe(true);
    expect(Math.abs(f.logLikelihood - b.logLikelihood)).toBeLessThan(1e-6);
  });
});

describe('HMM: Viterbi is not the posterior-mode path', () => {
  /*
   * A deliberately constrained model with a single, uninformative observation
   * symbol, so the posteriors are just the prior marginals and can be checked
   * by hand.
   *
   * π = (0.5, 0.25, 0.25)
   * A = [[0, 0.6, 0.4], [0.9, 0.1, 0], [0.9, 0, 0.1]]
   *
   * Marginal at t = 1: π, so the most likely state is 0 (0.5).
   * Marginal at t = 2: πA = (0.25×0.9 + 0.25×0.9, 0.5×0.6 + 0.25×0.1,
   *                          0.5×0.4 + 0.25×0.1) = (0.45, 0.325, 0.225),
   * so the most likely state is again 0.
   * The posterior-mode path is therefore (0, 0) — but A[0][0] = 0, so that
   * path is impossible. The Viterbi path is (0, 1), with joint 0.5 × 0.6 = 0.3.
   */
  const model = discreteModel([0.5, 0.25, 0.25], [[0, 0.6, 0.4], [0.9, 0.1, 0], [0.9, 0, 0.1]], [[1], [1], [1]]);

  it('produces two genuinely different decodings', () => {
    const cmp = compareDecodings(model, [0, 0]);
    expect(cmp.viterbi.path).toEqual([0, 1]);
    expect(cmp.posterior.posteriorModePath).toEqual([0, 0]);
    expect(cmp.disagreements).toEqual([1]);
    expect(Math.abs(Math.exp(cmp.viterbi.logProbability) - 0.3)).toBeLessThan(1e-12);
  });

  it('shows the posterior-mode path is impossible under the model', () => {
    const cmp = compareDecodings(model, [0, 0]);
    expect(cmp.posteriorModePathImpossible).toBe(true);
    expect(cmp.posteriorModePathLogProbability).toBe(-Infinity);
    expect(pathLogProbability(model, [0, 0], [0, 0])).toBe(-Infinity);
  });

  it('matches the hand-computed marginals', () => {
    const post = posteriors(model, [0, 0]);
    expect(post.gamma[0]).toEqual([0.5, 0.25, 0.25]);
    expect(Math.abs(post.gamma[1][0] - 0.45)).toBeLessThan(1e-12);
    expect(Math.abs(post.gamma[1][1] - 0.325)).toBeLessThan(1e-12);
    expect(Math.abs(post.gamma[1][2] - 0.225)).toBeLessThan(1e-12);
  });
});

describe('HMM: a perfectly revealing emission model reduces to a plain Markov chain', () => {
  const transition: Matrix = [
    [0.7, 0.2, 0.1],
    [0.1, 0.8, 0.1],
    [0.3, 0.3, 0.4],
  ];
  const model = discreteModel([1 / 3, 1 / 3, 1 / 3], transition, [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]);

  it('recovers the true state sequence exactly and leaves no posterior uncertainty', () => {
    const rng = new Random('degenerate');
    const sim = simulateHmm(model, 500, rng);
    expect(sim.observations).toEqual(sim.states);
    const v = viterbi(model, sim.observations);
    expect(v.path).toEqual(sim.states);
    const post = posteriors(model, sim.observations);
    for (let t = 0; t < 500; t++) {
      expect(post.entropy[t]).toBeCloseTo(0, 12);
      expect(post.gamma[t][sim.states[t]]).toBeCloseTo(1, 12);
    }
    expect(post.posteriorModePath).toEqual(sim.states);
  });

  it('gives the likelihood as the plain Markov chain path probability', () => {
    const rng = new Random('degenerate-ll');
    const sim = simulateHmm(model, 40, rng);
    let logP = Math.log(1 / 3);
    for (let t = 1; t < 40; t++) logP += Math.log(transition[sim.states[t - 1]][sim.states[t]]);
    expect(forward(model, sim.observations).logLikelihood).toBeCloseTo(logP, 12);
  });
});

describe('HMM: posterior entropy locates the uncertainty', () => {
  it('is maximal when the emissions carry no information and zero when they are decisive', () => {
    const blind = discreteModel([0.5, 0.5], [[0.5, 0.5], [0.5, 0.5]], [[0.5, 0.5], [0.5, 0.5]]);
    const blindPost = posteriors(blind, [0, 1, 0, 1]);
    for (const h of blindPost.entropy) expect(h).toBeCloseTo(1, 12);
    expect(blindPost.maxEntropy).toBeCloseTo(1, 12);

    const sharp = discreteModel([0.5, 0.5], [[0.5, 0.5], [0.5, 0.5]], [[1, 0], [0, 1]]);
    for (const h of posteriors(sharp, [0, 1, 0, 1]).entropy) expect(h).toBeCloseTo(0, 12);
  });
});

describe('HMM: filtering and prediction', () => {
  const model = discreteModel([0.6, 0.4], [[0.8, 0.2], [0.3, 0.7]], [[0.9, 0.1], [0.2, 0.8]]);

  it('filters to the same thing the forward pass normalises to', () => {
    const f = forward(model, [0, 0, 1]);
    const sum = f.filtered[2].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it('predicts one step ahead by pushing the filter through the transition matrix', () => {
    const f = forward(model, [0, 0, 1]);
    const p = predict(model, [0, 0, 1], 3);
    const expected0 = f.filtered[2][0] * 0.8 + f.filtered[2][1] * 0.3;
    expect(p.stateDistribution[0][0]).toBeCloseTo(expected0, 12);
    expect(p.symbolProbability).not.toBeNull();
    expect(p.symbolProbability![0].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('converges to the stationary distribution at a long horizon', () => {
    // π solves πP = π for P = [[0.8,0.2],[0.3,0.7]]: π = (0.6, 0.4).
    const p = predict(model, [0, 0, 1], 200);
    expect(p.stateDistribution[199][0]).toBeCloseTo(0.6, 9);
    expect(p.stateDistribution[199][1]).toBeCloseTo(0.4, 9);
  });

  it('gives a Gaussian predictive mixture mean and variance', () => {
    const g: HmmModel = {
      stateNames: ['low', 'high'],
      initial: [0.5, 0.5],
      transition: [[0.9, 0.1], [0.1, 0.9]],
      emission: { kind: 'gaussian', mean: [0, 10], variance: [1, 1] },
    };
    const p = predict(g, [0.2, -0.1, 0.4], 2);
    expect(p.mixtureMean).not.toBeNull();
    expect(p.mixtureVariance).not.toBeNull();
    // Almost certainly in the low state, so the mean is near 0 but the mixture
    // variance is inflated by the small chance of the high state.
    expect(p.mixtureMean![0]).toBeLessThan(2);
    expect(p.mixtureVariance![0]).toBeGreaterThan(1);
  });
});

describe('HMM: Baum-Welch monotonicity', () => {
  const truth = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.2, 0.8]], [[0.85, 0.15], [0.15, 0.85]]);

  it('never decreases the log-likelihood, on any of eight random starts', () => {
    const rng = new Random('em-mono-data');
    const sequences = Array.from({ length: 10 }, () => simulateHmm(truth, 120, rng).observations);
    const fit = baumWelch(sequences, 2, truth.emission, { restarts: 8, maxIterations: 60, seed: 'em-mono', tolerance: 1e-12 });
    expect(fit.runs).toHaveLength(8);
    for (const run of fit.runs) {
      expect(run.history.length).toBeGreaterThan(1);
      for (let i = 1; i < run.history.length; i++) {
        // EM cannot decrease the observed-data log-likelihood. The only slack
        // allowed is floating-point noise, scaled by the magnitude involved.
        expect(run.history[i]).toBeGreaterThanOrEqual(run.history[i - 1] - 1e-9 * Math.abs(run.history[i - 1]));
      }
    }
    expect(fit.worstMonotonicityViolation).toBeLessThan(1e-6);
  });

  it('holds for a three-state fit as well', () => {
    const rng = new Random('em-mono3');
    const sequences = Array.from({ length: 8 }, () => simulateHmm(truth, 150, rng).observations);
    const fit = baumWelch(sequences, 3, truth.emission, { restarts: 4, maxIterations: 50, seed: 'em-mono3' });
    for (const run of fit.runs) {
      for (let i = 1; i < run.history.length; i++) {
        expect(run.history[i]).toBeGreaterThanOrEqual(run.history[i - 1] - 1e-9 * Math.abs(run.history[i - 1]));
      }
    }
  });

  it('holds for Gaussian emissions', () => {
    const g: HmmModel = {
      stateNames: ['a', 'b'],
      initial: [0.5, 0.5],
      transition: [[0.85, 0.15], [0.25, 0.75]],
      emission: { kind: 'gaussian', mean: [-2, 3], variance: [1, 2] },
    };
    const rng = new Random('em-gauss');
    const sequences = Array.from({ length: 6 }, () => simulateHmm(g, 150, rng).observations);
    const fit = baumWelch(sequences, 2, g.emission, { restarts: 3, maxIterations: 60, seed: 'em-gauss-fit' });
    for (const run of fit.runs) {
      for (let i = 1; i < run.history.length; i++) {
        expect(run.history[i]).toBeGreaterThanOrEqual(run.history[i - 1] - 1e-9 * Math.abs(run.history[i - 1]));
      }
    }
    expect(Number.isFinite(fit.logLikelihood)).toBe(true);
  });
});

describe('HMM: Baum-Welch parameter recovery', () => {
  const truth = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.2, 0.8]], [[0.95, 0.05], [0.05, 0.95]]);
  // One expensive fit shared by both assertions: 50 sequences of length 200
  // from the known model, fitted with four random restarts.
  const rng = new Random('em-recover-data');
  const sequences = Array.from({ length: 50 }, () => simulateHmm(truth, 200, rng).observations);
  let cached: ReturnType<typeof baumWelch> | null = null;
  const fitted = (): ReturnType<typeof baumWelch> => {
    if (!cached) {
      cached = baumWelch(sequences, 2, truth.emission, { restarts: 4, maxIterations: 300, seed: 'em-recover', tolerance: 1e-9 });
    }
    return cached;
  };

  it('recovers the generating parameters from 50 sequences of length 200', () => {
    const fit = fitted();
    // Label switching makes the raw parameters incomparable; both models are
    // put in the same canonical state order first.
    const got = canonicaliseStates(fit.model).model;
    const want = canonicaliseStates(truth).model;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        // 10,000 observations with well-separated emissions; the standard error
        // on a transition probability here is of order 0.01, so 0.05 is a
        // generous but still meaningful tolerance.
        expect(Math.abs(got.transition[i][j] - want.transition[i][j])).toBeLessThan(0.05);
        expect(
          Math.abs(
            (got.emission as DiscreteEmission).matrix[i][j] - (want.emission as DiscreteEmission).matrix[i][j],
          ),
        ).toBeLessThan(0.05);
      }
    }
  });

  it('fits the training data at least as well as the true parameters do', () => {
    const fit = fitted();
    const truthLl = sequenceLogLikelihood(truth, sequences);
    // Maximum likelihood on the training data must beat any fixed parameter
    // vector, including the one that generated it.
    expect(fit.logLikelihood).toBeGreaterThanOrEqual(truthLl - 1e-6);
  });

  it('reports label switching and order unidentifiability as limitations', () => {
    const quick = new Random('em-limits');
    const short = Array.from({ length: 4 }, () => simulateHmm(truth, 60, quick).observations);
    const fit = baumWelch(short, 2, truth.emission, { maxIterations: 20, seed: 'em-limits' });
    expect(fit.limitations.join(' ')).toMatch(/[Ll]abel switching/);
    expect(fit.limitations.join(' ')).toMatch(/not identifiable/);
    expect(fit.exactness).toBe('numerical');
  });
});

describe('HMM: supervised learning from labelled sequences', () => {
  it('recovers the generating matrices from 200,000 labelled steps', () => {
    const truth = discreteModel([0.5, 0.5, 0], [
      [0.7, 0.2, 0.1],
      [0.1, 0.6, 0.3],
      [0.25, 0.25, 0.5],
    ], [
      [0.6, 0.3, 0.1],
      [0.2, 0.5, 0.3],
      [0.1, 0.2, 0.7],
    ]);
    const rng = new Random('supervised');
    const sim = simulateHmm(truth, 200000, rng);
    const fit = supervisedFit([sim.states], [sim.observations], 3, truth.emission, { smoothing: 1 });
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        // Each state is visited of order 60,000 times, so the standard error on
        // a transition probability is about sqrt(0.25/60000) ≈ 0.002. 0.01 is
        // five standard errors and also swamps the Laplace smoothing bias.
        expect(Math.abs(fit.model.transition[i][j] - truth.transition[i][j])).toBeLessThan(0.01);
        expect(
          Math.abs((fit.model.emission as DiscreteEmission).matrix[i][j] - (truth.emission as DiscreteEmission).matrix[i][j]),
        ).toBeLessThan(0.01);
      }
    }
    expect(fit.exactness).toBe('empirical');
  });

  it('reports the per-row counts and flags rows estimated from almost nothing', () => {
    const template: DiscreteEmission = { kind: 'discrete', symbols: ['x', 'y'], matrix: [[0.5, 0.5], [0.5, 0.5]] };
    const states = [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]];
    const obs = states[0].map((s) => s);
    const fit = supervisedFit(states, [obs], 2, template, { smoothing: 1 });
    expect(fit.transitionRowTotals[0]).toBe(25);
    expect(fit.transitionRowTotals[1]).toBe(0);
    expect(fit.sparseRows.map((r) => r.state)).toContain(1);
    expect(fit.transitionCounts[0][0]).toBe(24);
    expect(fit.transitionCounts[0][1]).toBe(1);
    // With no observed transitions out of state 1, Laplace smoothing is the
    // only thing holding the row up, and it must come out uniform.
    expect(fit.model.transition[1][0]).toBeCloseTo(0.5, 12);
  });
});

describe('HMM: model selection over the number of hidden states', () => {
  it('tabulates AIC and BIC and warns that the likelihood always improves', () => {
    const truth = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.15, 0.85]], [[0.9, 0.1], [0.1, 0.9]]);
    const rng = new Random('select-data');
    const sequences = Array.from({ length: 6 }, () => simulateHmm(truth, 200, rng).observations);
    const sel = selectStateCount(sequences, [1, 2, 3], truth.emission, { restarts: 2, maxIterations: 120, seed: 'select' });
    expect(sel.rows).toHaveLength(3);
    for (let i = 1; i < sel.rows.length; i++) {
      // Monotone in the number of states, up to EM landing in a local optimum.
      expect(sel.rows[i].logLikelihood).toBeGreaterThan(sel.rows[i - 1].logLikelihood - 1);
      expect(sel.rows[i].freeParameters).toBeGreaterThan(sel.rows[i - 1].freeParameters);
    }
    expect(sel.warnings.join(' ')).toMatch(/always improves/);
    expect(sel.warnings.join(' ')).toMatch(/weak guidance/);
    expect([1, 2, 3]).toContain(sel.bestByBic);
  });
});

describe('HMM: refusals', () => {
  const good = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.2, 0.8]], [[0.7, 0.3], [0.3, 0.7]]);

  it('names the transition row that does not sum to 1', () => {
    const bad = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.2, 0.9]], [[0.7, 0.3], [0.3, 0.7]]);
    expect(() => forward(bad, [0, 1])).toThrow(/Transition row 2/);
  });

  it('names the emission row that does not sum to 1', () => {
    const bad = discreteModel([0.5, 0.5], [[0.9, 0.1], [0.2, 0.8]], [[0.7, 0.4], [0.3, 0.7]]);
    expect(() => forward(bad, [0, 1])).toThrow(/Emission row 1/);
  });

  it('rejects a negative probability, naming the row', () => {
    const bad = discreteModel([0.5, 0.5], [[1.1, -0.1], [0.2, 0.8]], [[0.7, 0.3], [0.3, 0.7]]);
    expect(() => forward(bad, [0, 1])).toThrow(/Transition row 1/);
  });

  it('rejects an initial distribution that does not sum to 1', () => {
    const bad = discreteModel([0.5, 0.6], [[0.9, 0.1], [0.2, 0.8]], [[0.7, 0.3], [0.3, 0.7]]);
    expect(() => forward(bad, [0])).toThrow(/initial state distribution/);
  });

  it('rejects duplicate state names and duplicate symbols', () => {
    expect(() =>
      forward({ ...good, stateNames: ['same', 'same'] }, [0]),
    ).toThrow(/appears more than once/);
    expect(() =>
      forward({ ...good, emission: { kind: 'discrete', symbols: ['x', 'x'], matrix: [[0.7, 0.3], [0.3, 0.7]] } }, [0]),
    ).toThrow(/appears more than once/);
  });

  it('names an unknown observation symbol and its index', () => {
    expect(() => forward(good, [0, 1, 5])).toThrow(/index 2/);
    expect(() => forward(good, [0, 1, 5])).toThrow(/not one of the 2 symbols/);
    expect(() => viterbi(good, [0, 0.5])).toThrow(/index 1/);
  });

  it('refuses an observation sequence that is impossible rather than reporting -Infinity', () => {
    const constrained = discreteModel([1, 0], [[1, 0], [0, 1]], [[1, 0], [0, 1]]);
    expect(() => forward(constrained, [0, 1])).toThrow(/probability exactly zero/);
    expect(() => viterbi(constrained, [0, 1])).toThrow(/probability exactly zero/);
    expect(() => posteriors(constrained, [0, 1])).toThrow(/probability exactly zero/);
  });

  it('rejects an empty observation sequence', () => {
    expect(() => forward(good, [])).toThrow(/empty/);
  });

  it('rejects a mismatched dimension, naming the shape', () => {
    const bad: HmmModel = { ...good, transition: [[0.9, 0.1]] };
    expect(() => forward(bad, [0])).toThrow(/1 rows but there are 2 hidden states/);
  });

  it('rejects a non-positive Gaussian variance naming the state', () => {
    const bad: HmmModel = {
      stateNames: ['a', 'b'],
      initial: [0.5, 0.5],
      transition: [[0.5, 0.5], [0.5, 0.5]],
      emission: { kind: 'gaussian', mean: [0, 1], variance: [1, 0] },
    };
    expect(() => forward(bad, [0.1])).toThrow(/variance for state 2/);
  });

  it('refuses a prediction horizon of zero', () => {
    expect(() => predict(good, [0, 1], 0)).toThrow(/1 or more/);
  });

  it('reports Baum-Welch non-convergence rather than presenting the last iterate as a fit', () => {
    const rng = new Random('nonconv');
    const sequences = Array.from({ length: 5 }, () => simulateHmm(good, 150, rng).observations);
    const fit = baumWelch(sequences, 3, good.emission, { maxIterations: 2, restarts: 1, seed: 'nonconv', tolerance: 1e-14 });
    expect(fit.converged).toBe(false);
    expect(fit.warnings.join(' ')).toMatch(/did not converge/);
  });

  it('names the sequence and index of an unknown symbol in training data', () => {
    expect(() => baumWelch([[0, 1], [0, 7]], 2, good.emission, { seed: 'bad-symbol' })).toThrow(/Sequence 2/);
  });
});

describe('Chain: mean first passage times', () => {
  it('matches the closed form for a two-state chain', () => {
    // P = [[1-p, p], [q, 1-q]] has π = (q/(p+q), p/(p+q)),
    // m_01 = 1/p and m_10 = 1/q.
    const p = 0.3;
    const q = 0.45;
    const res = meanFirstPassageTimes([[1 - p, p], [q, 1 - q]]);
    expect(res.mfpt[0][1]).toBeCloseTo(1 / p, 10);
    expect(res.mfpt[1][0]).toBeCloseTo(1 / q, 10);
    expect(res.stationary[0]).toBeCloseTo(q / (p + q), 10);
  });

  it('matches a hand computation on a three-state cycle', () => {
    /*
     * P = [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]
     * Expected steps to reach state 3 (index 2):
     *   m₁ = 1 + 0.5 m₁ + 0.5 m₂
     *   m₂ = 1 + 0.5 m₂          ⇒ 0.5 m₂ = 1 ⇒ m₂ = 2
     *   0.5 m₁ = 1 + 0.5 × 2 = 2 ⇒ m₁ = 4
     */
    const res = meanFirstPassageTimes([
      [0.5, 0.5, 0],
      [0, 0.5, 0.5],
      [0.5, 0, 0.5],
    ]);
    expect(Math.abs(res.mfpt[0][2] - 4)).toBeLessThan(1e-10);
    expect(Math.abs(res.mfpt[1][2] - 2)).toBeLessThan(1e-10);
  });

  it('satisfies the identity m_ii = 1 / pi_i', () => {
    const chains: Matrix[] = [
      [[0.2, 0.5, 0.3], [0.6, 0.1, 0.3], [0.25, 0.25, 0.5]],
      [[0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]],
      [[0.1, 0.2, 0.3, 0.4], [0.4, 0.1, 0.2, 0.3], [0.3, 0.4, 0.1, 0.2], [0.2, 0.3, 0.4, 0.1]],
    ];
    for (const chain of chains) {
      const res = meanFirstPassageTimes(chain);
      for (let i = 0; i < chain.length; i++) {
        expect(Math.abs(res.returnTimes[i] - 1 / res.stationary[i])).toBeLessThan(1e-10);
        // Independent route to the same number: the expected return time is
        // 1 + Σ_j P_ij m_ji, built only from the off-diagonal passage times.
        let viaOneStep = 1;
        for (let j = 0; j < chain.length; j++) if (j !== i) viaOneStep += chain[i][j] * res.mfpt[j][i];
        expect(Math.abs(viaOneStep - 1 / res.stationary[i])).toBeLessThan(1e-9);
      }
    }
  });

  it('refuses a reducible chain', () => {
    expect(() => meanFirstPassageTimes([[1, 0], [0.5, 0.5]])).toThrow(/irreducible/);
  });
});

describe('Chain: Kemeny constant', () => {
  it('is the same from every starting state', () => {
    const chains: Matrix[] = [
      [[0.2, 0.5, 0.3], [0.6, 0.1, 0.3], [0.25, 0.25, 0.5]],
      [[0.9, 0.05, 0.05], [0.1, 0.8, 0.1], [0.2, 0.2, 0.6]],
      [[0.1, 0.2, 0.3, 0.4], [0.4, 0.1, 0.2, 0.3], [0.3, 0.4, 0.1, 0.2], [0.2, 0.3, 0.4, 0.1]],
    ];
    for (const chain of chains) {
      const res = meanFirstPassageTimes(chain);
      expect(res.kemenyInvariance).toBeLessThan(1e-9);
      for (const k of res.kemenyByStart) expect(Math.abs(k - res.kemeny)).toBeLessThan(1e-9);
    }
  });

  it('equals n - 1 over 2 for a two-state chain with p = q = 1/2', () => {
    // P = [[0.5,0.5],[0.5,0.5]] gives m_01 = m_10 = 2 and π = (0.5, 0.5),
    // so K = 0.5 × 0 + 0.5 × 2 = 1.
    const res = meanFirstPassageTimes([[0.5, 0.5], [0.5, 0.5]]);
    expect(res.kemeny).toBeCloseTo(1, 12);
  });
});

describe('Chain: hitting probabilities', () => {
  it('gives 1 on the target and the gamblers-ruin answer elsewhere', () => {
    /*
     * A symmetric random walk on 0..4 with absorbing ends. The probability of
     * hitting {4} before anything else from state i is i/4 for a fair walk,
     * but here we ask for hitting {4} EVER, and 0 is absorbing, so the answer
     * is the classic gambler's ruin value i/4.
     */
    const n = 5;
    const p: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    p[0][0] = 1;
    p[4][4] = 1;
    for (let i = 1; i <= 3; i++) {
      p[i][i - 1] = 0.5;
      p[i][i + 1] = 0.5;
    }
    const res = hittingProbabilities(p, [4]);
    expect(res.probability[0]).toBe(0);
    expect(res.probability[4]).toBe(1);
    for (let i = 1; i <= 3; i++) expect(res.probability[i]).toBeCloseTo(i / 4, 10);
  });

  it('reports exactly 0 for states from which the target is unreachable', () => {
    const p: Matrix = [
      [1, 0, 0],
      [0.5, 0.5, 0],
      [0, 0.5, 0.5],
    ];
    const res = hittingProbabilities(p, [2]);
    expect(res.probability[0]).toBe(0);
    expect(res.probability[1]).toBe(0);
    expect(res.unreachableFrom).toEqual([0, 1]);
  });

  it('refuses an empty or out-of-range target set', () => {
    expect(() => hittingProbabilities([[1, 0], [0, 1]], [])).toThrow(/empty/);
    expect(() => hittingProbabilities([[1, 0], [0, 1]], [3])).toThrow(/not one of the 2 states/);
  });
});

describe('Chain: fundamental matrix and absorption variance', () => {
  const p: Matrix = [
    [0.5, 0.3, 0.2],
    [0.1, 0.6, 0.3],
    [0, 0, 1],
  ];

  it('matches the closed form for a single transient state', () => {
    // One transient state with escape probability a: absorption time is
    // Geometric(a) on {1,2,...}, mean 1/a and variance (1-a)/a².
    const a = 0.25;
    const res = fundamentalMatrix([[1 - a, a], [0, 1]]);
    expect(res.expectedSteps[0]).toBeCloseTo(1 / a, 10);
    expect(res.varianceSteps[0]).toBeCloseTo((1 - a) / (a * a), 10);
    expect(res.visits[0][0]).toBeCloseTo(1 / a, 10);
  });

  it('cross-checks the variance against 200,000 direct simulations', () => {
    const res = fundamentalMatrix(p);
    const rng = new Random('absorb-sim');
    const runs = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let r = 0; r < runs; r++) {
      let s = 0;
      let steps = 0;
      while (s !== 2) {
        const u = rng.uniform();
        let c = 0;
        for (let j = 0; j < 3; j++) {
          c += p[s][j];
          if (u < c) {
            s = j;
            break;
          }
        }
        steps += 1;
      }
      sum += steps;
      sumSq += steps * steps;
    }
    const meanSim = sum / runs;
    const varSim = sumSq / runs - meanSim * meanSim;
    expect(meanSim).toBeCloseTo(res.expectedSteps[0], 1);
    /*
     * The standard error of a variance estimate is sd²·sqrt((κ − 1)/N). For a
     * geometric-tailed absorption time the excess kurtosis is around 6, giving
     * a relative standard error near sqrt(6/200000) ≈ 0.55%. A 5% relative
     * tolerance is therefore about nine standard errors — loose enough to be
     * stable across seeds, tight enough that a wrong formula (the common error
     * is to forget the −τ∘τ term, which changes the answer by a factor of
     * order τ) fails immediately.
     */
    expect(Math.abs(varSim - res.varianceSteps[0]) / res.varianceSteps[0]).toBeLessThan(0.05);
  });

  it('reports the expected visit counts and refuses a chain with no absorbing state', () => {
    const res = fundamentalMatrix(p);
    expect(res.transientStates).toEqual([0, 1]);
    expect(res.absorbingStates).toEqual([2]);
    expect(res.visits[0][0]).toBeGreaterThan(1);
    expect(res.sdSteps[0]).toBeCloseTo(Math.sqrt(res.varianceSteps[0]), 12);
    expect(() => fundamentalMatrix([[0.5, 0.5], [0.5, 0.5]])).toThrow(/no absorbing state/);
  });
});

describe('Chain: periodicity and aperiodicity', () => {
  it('detects period 2 in a deterministic alternation and refuses a mixing time', () => {
    const flip: Matrix = [[0, 1], [1, 0]];
    const per = periodicity(flip);
    expect(per.period).toBe(2);
    expect(per.aperiodic).toBe(false);
    expect(per.notes.join(' ')).toMatch(/does not converge/);
    expect(() => convergenceRate(flip)).toThrow(/periodic/);
    expect(() => convergenceRate(flip)).toThrow(/never converges/);
  });

  it('detects period 3 in a deterministic cycle', () => {
    const cycle: Matrix = [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ];
    expect(periodicity(cycle).period).toBe(3);
    expect(() => convergenceRate(cycle)).toThrow(/periodic/);
  });

  it('reports period 1 for an aperiodic chain', () => {
    const per = periodicity([[0.5, 0.5], [0.3, 0.7]]);
    expect(per.period).toBe(1);
    expect(per.aperiodic).toBe(true);
  });
});

describe('Chain: convergence rate', () => {
  it('matches the closed-form SLEM of a two-state chain', () => {
    // The eigenvalues of [[1-p, p], [q, 1-q]] are 1 and 1 - p - q exactly.
    for (const [p, q] of [[0.3, 0.5], [0.1, 0.2], [0.05, 0.05], [0.6, 0.7]]) {
      const res = convergenceRate([[1 - p, p], [q, 1 - q]]);
      expect(Math.abs(res.slem - Math.abs(1 - p - q))).toBeLessThan(1e-8);
      expect(Math.abs(res.slemCrossCheck - Math.abs(1 - p - q))).toBeLessThan(1e-6);
      expect(res.relaxationTime).toBeCloseTo(1 / (1 - Math.abs(1 - p - q)), 6);
    }
  });

  it('matches the eigenvalues of a three-state matrix against its characteristic polynomial', () => {
    const m: Matrix = [
      [0.5, 0.3, 0.2],
      [0.2, 0.6, 0.2],
      [0.3, 0.1, 0.6],
    ];
    const eig = qrEigenvalues(m);
    expect(eig.converged).toBe(true);
    expect(eig.traceResidual).toBeLessThan(1e-9);
    // Independent checks: the eigenvalues must sum to the trace and multiply
    // to the determinant, and 1 must be among them for a stochastic matrix.
    const trace = 0.5 + 0.6 + 0.6;
    const det =
      0.5 * (0.6 * 0.6 - 0.2 * 0.1) - 0.3 * (0.2 * 0.6 - 0.2 * 0.3) + 0.2 * (0.2 * 0.1 - 0.6 * 0.3);
    let sumRe = 0;
    let prodRe = 1;
    let prodIm = 0;
    for (const v of eig.values) {
      sumRe += v.re;
      const nr = prodRe * v.re - prodIm * v.im;
      const ni = prodRe * v.im + prodIm * v.re;
      prodRe = nr;
      prodIm = ni;
    }
    expect(sumRe).toBeCloseTo(trace, 9);
    expect(prodRe).toBeCloseTo(det, 9);
    expect(Math.abs(prodIm)).toBeLessThan(1e-9);
    expect(Math.min(...eig.values.map((v) => Math.hypot(v.re - 1, v.im)))).toBeLessThan(1e-8);
  });

  it('recovers a complex conjugate pair', () => {
    // An asymmetric 3-cycle with a self-loop has complex eigenvalues.
    const m: Matrix = [
      [0.1, 0.8, 0.1],
      [0.1, 0.1, 0.8],
      [0.8, 0.1, 0.1],
    ];
    const eig = qrEigenvalues(m);
    expect(eig.values.filter((v) => Math.abs(v.im) > 1e-6)).toHaveLength(2);
    expect(eig.traceResidual).toBeLessThan(1e-9);
    const res = convergenceRate(m);
    // Eigenvalues are 1 and (0.1 - 0.8ω - 0.1ω²)-type values; their modulus is
    // 0.7 by the circulant formula |0.1 + 0.8ω + 0.1ω²| with ω = e^{2πi/3}:
    //   0.1 + 0.8(-0.5 + i√3/2) + 0.1(-0.5 - i√3/2) = -0.35 + i·0.35√3,
    //   modulus = 0.35 × 2 = 0.7.
    expect(res.slem).toBeCloseTo(0.7, 8);
  });

  it('decays at the geometric rate the SLEM predicts, and reaches zero', () => {
    const p = 0.3;
    const q = 0.5;
    const res = convergenceRate([[1 - p, p], [q, 1 - q]], { threshold: 0.01 });
    // For a two-state chain the total-variation distance is exactly
    // C·|1-p-q|ⁿ, so successive ratios equal the SLEM to machine precision.
    const slem = Math.abs(1 - p - q);
    // Beyond about eight steps the distance itself is below 1e-6 and the
    // ratio is dominated by the rounding error in P^n, so the check stops there.
    for (let i = 1; i < 8; i++) {
      expect(res.tvDistance[i] / res.tvDistance[i - 1]).toBeCloseTo(slem, 9);
    }
    const far = convergenceRate([[1 - p, p], [q, 1 - q]], { threshold: 1e-9 });
    expect(far.tvDistance[far.tvDistance.length - 1]).toBeLessThan(1e-9);
    expect(far.mixingTime).toBeGreaterThan(res.mixingTime);
  });

  it('agrees between the two independent eigenvalue methods', () => {
    const m: Matrix = [
      [0.4, 0.3, 0.2, 0.1],
      [0.1, 0.5, 0.2, 0.2],
      [0.25, 0.25, 0.25, 0.25],
      [0.2, 0.1, 0.3, 0.4],
    ];
    const res = convergenceRate(m);
    /*
     * The SLEM of this matrix is a complex conjugate pair, so the power
     * method's per-step growth ratio oscillates and only its running geometric
     * mean converges — at order 1/k, not geometrically. After 100,000
     * iterations the two methods agree to about 1e-6; 1e-5 is the honest
     * tolerance for a first-order method cross-checking a QR iteration.
     */
    expect(res.slemAgreement).toBeLessThan(1e-5);
    expect(res.eigenConverged).toBe(true);
    expect(res.eigenMethod).toMatch(/QR/);
    expect(res.crossCheckMethod).toMatch(/[Pp]ower method/);
  });

  it('never approaches stationarity for a periodic chain', () => {
    // Computed directly, bypassing the refusal, to show the refusal is right.
    const tv = tvDistanceToStationary([[0, 1], [1, 0]], [0.5, 0.5], 50);
    for (const d of tv) expect(d).toBeCloseTo(0.5, 12);
    expect(Math.min(...tv)).toBeGreaterThan(0.49);
  });
});

describe('Chain: reversibility', () => {
  it('detects a reversible birth-death chain with detailed balance to 1e-12', () => {
    const bd: Matrix = [
      [0.5, 0.5, 0],
      [0.25, 0.5, 0.25],
      [0, 0.5, 0.5],
    ];
    const res = reversibility(bd);
    expect(res.reversible).toBe(true);
    expect(res.maxViolation).toBeLessThan(1e-12);
    // Every birth-death chain is reversible, so every eigenvalue is real.
    for (const v of qrEigenvalues(bd).values) expect(Math.abs(v.im)).toBeLessThan(1e-8);
  });

  it('detects that an asymmetric cycle is not reversible', () => {
    const cyc: Matrix = [
      [0, 0.9, 0.1],
      [0.1, 0, 0.9],
      [0.9, 0.1, 0],
    ];
    const res = reversibility(cyc);
    expect(res.reversible).toBe(false);
    expect(res.maxViolation).toBeGreaterThan(0.1);
    expect(res.worstPair).not.toBeNull();
    expect(res.notes.join(' ')).toMatch(/not reversible/);
  });

  it('finds a symmetric matrix reversible with the uniform stationary distribution', () => {
    const res = reversibility([[0.5, 0.25, 0.25], [0.25, 0.5, 0.25], [0.25, 0.25, 0.5]]);
    expect(res.reversible).toBe(true);
    for (const x of res.stationary) expect(x).toBeCloseTo(1 / 3, 12);
  });
});

describe('Chain: testing the Markov property', () => {
  const firstOrder: Matrix = [[0.7, 0.3], [0.4, 0.6]];

  /** A genuinely second-order binary chain: two in a row makes a switch likely. */
  function simulateSecondOrder(length: number, rng: Random): number[] {
    const out = new Array<number>(length);
    out[0] = 0;
    out[1] = 1;
    for (let t = 2; t < length; t++) {
      const i = out[t - 2];
      const j = out[t - 1];
      const pStay = i === j ? 0.1 : 0.9;
      out[t] = rng.uniform() < pStay ? j : 1 - j;
    }
    return out;
  }

  it('keeps the false-positive rate near 5% on data from a true first-order chain', () => {
    const replications = 100;
    let rejections = 0;
    for (let r = 0; r < replications; r++) {
      const rng = new Random(`first-order-${r}`);
      const seq = simulateChain(firstOrder, 2000, rng, r % 2);
      if (markovPropertyTest(seq, 2, 0.05).reject) rejections += 1;
    }
    // Under the null the rejection count is Binomial(100, 0.05): mean 5,
    // sd 2.18. Twelve rejections is over three standard deviations away, so
    // this bound catches a mis-specified null distribution (wrong degrees of
    // freedom, or a statistic that is not G²) while tolerating chance.
    expect(rejections).toBeLessThanOrEqual(12);
  });

  it('rejects with high power on data from a true second-order chain', () => {
    const replications = 20;
    let rejections = 0;
    for (let r = 0; r < replications; r++) {
      const rng = new Random(`second-order-${r}`);
      const seq = simulateSecondOrder(2000, rng);
      const res = markovPropertyTest(seq, 2, 0.05);
      if (res.reject) rejections += 1;
    }
    expect(rejections).toBe(replications);
    const rng = new Random('second-order-detail');
    const res = markovPropertyTest(simulateSecondOrder(5000, rng), 2, 0.05);
    expect(res.pValue).toBeLessThan(1e-12);
    expect(res.degreesOfFreedom).toBe(2);
    expect(res.statistic).toBeGreaterThan(100);
  });

  it('reports a statistic of 0 when the data exactly satisfies the first-order model', () => {
    // A deterministic period-2 sequence: the triple counts factorise exactly,
    // so the likelihood ratio is 1 and G² is 0.
    const seq = Array.from({ length: 500 }, (_, i) => i % 2);
    const res = markovPropertyTest(seq, 2);
    expect(res.statistic).toBeCloseTo(0, 10);
    expect(res.reject).toBe(false);
  });

  it('warns that a high p-value is not evidence for the Markov property', () => {
    const rng = new Random('markov-notes');
    const res = markovPropertyTest(simulateChain(firstOrder, 500, rng), 2);
    expect(res.notes.join(' ')).toMatch(/not evidence/);
    expect(res.exactness).toBe('empirical');
  });

  it('refuses a sequence containing a value outside the state space', () => {
    expect(() => markovPropertyTest([0, 1, 0, 4, 1], 2)).toThrow(/index 3/);
    expect(() => markovPropertyTest([0, 1], 2)).toThrow(/too few/);
  });
});

describe('Chain: order selection', () => {
  it('prefers order 1 for first-order data and order 2 for second-order data', () => {
    const rng = new Random('order-1');
    const first = simulateChain([[0.75, 0.25], [0.35, 0.65]], 8000, rng);
    const selFirst = selectChainOrder(first, 2, 3);
    expect(selFirst.bestByBic).toBe(1);

    const rng2 = new Random('order-2');
    const second = new Array<number>(8000);
    second[0] = 0;
    second[1] = 1;
    for (let t = 2; t < 8000; t++) {
      const pStay = second[t - 2] === second[t - 1] ? 0.1 : 0.9;
      second[t] = rng2.uniform() < pStay ? second[t - 1] : 1 - second[t - 1];
    }
    const selSecond = selectChainOrder(second, 2, 3);
    expect(selSecond.bestByBic).toBe(2);
  });

  it('has a log-likelihood that is non-decreasing in the order and says so', () => {
    const rng = new Random('order-mono');
    const seq = simulateChain([[0.6, 0.4], [0.3, 0.7]], 4000, rng);
    const sel = selectChainOrder(seq, 2, 4);
    for (let i = 1; i < sel.rows.length; i++) {
      expect(sel.rows[i].logLikelihood).toBeGreaterThanOrEqual(sel.rows[i - 1].logLikelihood - 1e-9);
    }
    expect(sel.notes.join(' ')).toMatch(/increases with the order/);
    expect(() => selectChainOrder(seq, 2, 9)).toThrow(/between 1 and 4/);
  });
});
