/**
 * Sequential Monte Carlo: the bootstrap filter, the auxiliary particle filter,
 * a general sequential-importance-resampling framework, a Rao-Blackwellised
 * filter, and the smoothers.
 *
 * WHAT THESE RESULTS ARE. Particle estimates are `empirical`. They carry Monte
 * Carlo error, and the error is NOT the particle spread: the particle cloud
 * describes the posterior, while the Monte Carlo error describes how well N
 * particles pin down that posterior's mean. Both are reported, separately.
 *
 * DEGENERACY IS THE POINT OF THIS FILE. The standard silent failure of a
 * particle filter is weight collapse: after an unlikely observation, or with a
 * poor proposal, one particle takes essentially all the weight. The filter
 * still returns a mean and a covariance, and they look perfectly reasonable —
 * but they are computed from one or two samples, so the covariance is far too
 * small and the mean is wherever that particle happened to be. Nothing in the
 * output says so unless someone looks at the effective sample size
 *
 *     ESS = 1 / Σ w_i²,
 *
 * which is why every step here reports the ESS, the largest single weight, and
 * whether resampling fired, and why the run warns loudly when the ESS ratio
 * falls below the degeneracy threshold.
 *
 * ALL WEIGHTS ZERO is a refusal, never a renormalisation. If every particle
 * gives the observation zero probability, the observation is impossible under
 * the model at that point; dividing zero by zero would manufacture a uniform
 * posterior out of nothing.
 */
import { EngineError } from '../core/result';
import { logSumExp, stableSum } from '../core/numeric';
import type { Random } from '../random/rng';
import {
  addVec,
  choleskyOrThrow,
  cloneMat,
  cols,
  forwardSubstitute,
  identity,
  matAdd,
  matMul,
  matVec,
  psdCholesky,
  rows,
  solveSPDMat,
  subVec,
  symmetrise,
  transpose,
  weightedCovariance,
  weightedMean,
  zeros,
  type Mat,
  type Vec,
} from './matrix';
import {
  explainFiltering,
  type FilterProgress,
  type Observation,
  type ParticleFilterResult,
  type ParticleModel,
  type ParticleSmootherResult,
  type ParticleStep,
  type ResamplingScheme,
  type RunControl,
} from './types';

const LOG_2PI = Math.log(2 * Math.PI);

export interface ParticleOptions extends RunControl {
  particles?: number;
  scheme?: ResamplingScheme;
  /** Resample when ESS/N falls below this. 1 resamples every step; 0 never. */
  essThreshold?: number;
  /** ESS/N below this raises a degeneracy warning for that step. */
  degeneracyThreshold?: number;
  /** Keep every particle cloud, which the FFBS smoother needs. */
  history?: boolean;
  /** Keep full ancestral trajectories, which fixed-lag smoothing needs. */
  trajectories?: boolean;
  /**
   * Record fixed-lag smoothed moments ONLINE, during the run: at step t the
   * state at t − L is re-estimated from the surviving lineage. It has to be
   * done during the run, because resampling rewrites the genealogy and the
   * weights that applied at step t − L are gone afterwards. Implies
   * `trajectories`.
   */
  fixedLag?: number;
}

/**
 * Resampling.
 *
 * All four schemes are unbiased: E[number of copies of particle i] = N·w_i.
 * They differ in the VARIANCE of those counts, and that variance is pure added
 * noise, so the low-variance schemes are strictly better:
 *
 *  - multinomial: N independent draws. Simple, highest variance.
 *  - stratified:  one draw per 1/N stratum. Count variance well below multinomial.
 *  - systematic:  one draw, then a regular 1/N comb. Lowest variance of the
 *                 four in practice; |n_i − N w_i| < 1 always.
 *  - residual:    deterministic ⌊N w_i⌋ copies, remainder by multinomial.
 *
 * `systematic` is the default. Its one caveat is that the comb introduces a
 * dependence between the resampled particles, which matters for some
 * theoretical results but not for the estimates reported here.
 */
export function resampleIndices(weights: number[], scheme: ResamplingScheme, rng: Random): number[] {
  const N = weights.length;
  if (N === 0) throw new EngineError('Resampling needs at least one particle; the weight vector is empty.', 'required');
  let total = 0;
  for (let i = 0; i < N; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w < 0) {
      throw new EngineError(`Particle weight ${i} is ${w}; weights must be finite and non-negative.`, 'invalid');
    }
    total += w;
  }
  if (!(total > 0)) {
    throw new EngineError(
      'Every particle weight is zero, so there is nothing to resample from. Renormalising zeros would invent a ' +
        'uniform posterior out of no information; the run is refused instead.',
      'degenerate',
    );
  }
  const w = weights.map((v) => v / total);
  const cumulative = new Array<number>(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += w[i];
    cumulative[i] = acc;
  }
  cumulative[N - 1] = 1;

  const pick = (u: number): number => {
    let lo = 0;
    let hi = N - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (u <= cumulative[mid]) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };

  const out = new Array<number>(N);
  if (scheme === 'multinomial') {
    for (let i = 0; i < N; i++) out[i] = pick(rng.uniform());
    return out;
  }
  if (scheme === 'stratified') {
    for (let i = 0; i < N; i++) out[i] = pick((i + rng.uniform()) / N);
    return out;
  }
  if (scheme === 'systematic') {
    const u0 = rng.uniform();
    for (let i = 0; i < N; i++) out[i] = pick((i + u0) / N);
    return out;
  }
  // Residual.
  let filled = 0;
  const residual = new Array<number>(N).fill(0);
  for (let i = 0; i < N; i++) {
    const copies = Math.floor(N * w[i]);
    for (let c = 0; c < copies && filled < N; c++) out[filled++] = i;
    residual[i] = N * w[i] - copies;
  }
  const rTotal = stableSum(residual);
  if (filled < N) {
    if (!(rTotal > 0)) {
      // Can only happen when every N·w_i is an exact integer; fill in order.
      for (let i = 0; filled < N; i = (i + 1) % N) out[filled++] = i;
      return out;
    }
    const rCum = new Array<number>(N);
    let ra = 0;
    for (let i = 0; i < N; i++) {
      ra += residual[i] / rTotal;
      rCum[i] = ra;
    }
    rCum[N - 1] = 1;
    while (filled < N) {
      const u = rng.uniform();
      let lo = 0;
      let hi = N - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (u <= rCum[mid]) hi = mid;
        else lo = mid + 1;
      }
      out[filled++] = lo;
    }
  }
  return out;
}

/** Effective sample size of normalised weights, 1 / Σ w². */
export function effectiveSampleSize(normalisedWeights: number[]): number {
  let s = 0;
  for (const w of normalisedWeights) s += w * w;
  if (!(s > 0)) throw new EngineError('The weights are all zero, so no effective sample size is defined.', 'degenerate');
  return 1 / s;
}

/** Normalise log-weights, refusing the all-impossible case. */
function normaliseLogWeights(logW: number[], t: number): { weights: number[]; logTotal: number } {
  const finite = logW.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    throw new EngineError(
      `At time ${t} every particle gives the observation a probability of zero (all log-weights are −∞). The ` +
        'observation is impossible under this model given the current particle cloud: either the model is wrong, the ' +
        'observation is an outlier the measurement noise cannot explain, or the proposal has lost the state entirely. ' +
        'The weights are NOT renormalised, because dividing zero by zero would fabricate a posterior.',
      'degenerate',
    );
  }
  for (const v of logW) {
    if (Number.isNaN(v)) {
      throw new EngineError(`At time ${t} a particle log-weight came out as NaN, so the weights cannot be normalised.`, 'finite');
    }
  }
  const lse = logSumExp(logW);
  if (!Number.isFinite(lse)) {
    throw new EngineError(`At time ${t} the log-weights sum to ${lse}, so they cannot be normalised.`, 'finite');
  }
  const weights = logW.map((v) => Math.exp(v - lse));
  const total = stableSum(weights);
  // `logTotal` is log Σ_i w_{t−1}^i p(y_t | x_t^i): with normalised incoming
  // weights that IS the incremental log-likelihood, with no 1/N factor.
  return { weights: weights.map((v) => v / total), logTotal: lse };
}

interface ProposalSpec {
  /** Draw x_t given x_{t−1}. */
  sample(x: Vec, t: number, y: Vec, normal: () => number, uniform: () => number): Vec;
  /** log q(x_t | x_{t−1}, y_t). Omit when the proposal IS the transition (bootstrap). */
  logDensity?(xNext: Vec, x: Vec, t: number, y: Vec): number;
}

export interface SirOptions extends ParticleOptions {
  proposal?: ProposalSpec;
  /** First-stage weighting for the auxiliary filter. */
  auxiliary?: boolean;
}

function observationVector(obs: Observation, t: number, m: number): Vec | null {
  if (obs === null) return null;
  if (obs.length !== m) throw new EngineError(`Observation ${t} has ${obs.length} components but the model expects ${m}.`, 'shape');
  const out: number[] = [];
  const missing: number[] = [];
  for (let j = 0; j < m; j++) if (obs[j] === null || obs[j] === undefined) missing.push(j);
  if (missing.length === m) return null;
  if (missing.length > 0) {
    throw new EngineError(
      `Observation ${t} is missing components ${missing.join(', ')} but has the others. A particle filter weights ` +
        'particles with the observation density supplied by the model, and that density cannot be marginalised over ' +
        'part of the vector from outside it. Either mark the whole observation as null, or give the model an ' +
        'observation density that handles the partial case itself. The available components are NOT silently discarded.',
      'unsupported',
    );
  }
  for (let j = 0; j < m; j++) {
    const v = obs[j];
    if (v === null || v === undefined) continue;
    if (!Number.isFinite(v)) {
      throw new EngineError(`Observation ${t}, component ${j} is ${v}, which is not a finite number. Use null for a missing measurement.`, 'finite');
    }
    out.push(v);
  }
  return out;
}

/**
 * General sequential importance resampling. The bootstrap filter is the case
 * where the proposal is the transition density, which is why the weight
 * increment there is just the observation density.
 */
export function* sequentialImportanceResamplingSteps(
  model: ParticleModel,
  observations: Observation[],
  rng: Random,
  options: SirOptions = {},
): Generator<FilterProgress, ParticleFilterResult, void> {
  const T = observations.length;
  if (T === 0) throw new EngineError('A particle filter needs at least one time step; the observation sequence is empty.', 'required');
  const N = options.particles ?? 1000;
  if (!Number.isInteger(N) || N < 1) {
    throw new EngineError(
      `The particle count must be a whole number of at least 1; received ${N}. A filter with zero particles has no ` +
        'representation of the state at all.',
      'range',
    );
  }
  if (!Number.isInteger(model.stateDim) || model.stateDim < 1) {
    throw new EngineError(`The state dimension must be a whole number of at least 1; received ${model.stateDim}.`, 'range');
  }
  const scheme = options.scheme ?? 'systematic';
  const essThreshold = options.essThreshold ?? 0.5;
  const degenThreshold = options.degeneracyThreshold ?? 0.1;
  const chunk = Math.max(1, options.chunk ?? 64);
  const proposal = options.proposal;
  const fixedLag = options.fixedLag;
  if (fixedLag !== undefined && (!Number.isInteger(fixedLag) || fixedLag < 1)) {
    throw new EngineError(`The smoothing lag must be a whole number of at least 1; received ${fixedLag}.`, 'range');
  }
  if (fixedLag !== undefined && fixedLag >= T) {
    throw new EngineError(
      `A fixed lag of ${fixedLag} was requested for a series of ${T} steps. The smoother cannot look back further ` +
        'than the series it has seen.',
      'range',
    );
  }
  const auxiliary = options.auxiliary === true;
  if (auxiliary && model.propagateMean === undefined) {
    throw new EngineError(
      'The auxiliary particle filter needs propagateMean on the model: its first stage pre-weights particles by how ' +
        'well the predicted state would explain the next observation, and there is no way to do that without it.',
      'required',
    );
  }
  const normal = () => rng.normal();
  const uniform = () => rng.uniform();

  let particles: Vec[] = Array.from({ length: N }, () => {
    const x = model.sampleInitial(normal, uniform);
    if (x.length !== model.stateDim) {
      throw new EngineError(`sampleInitial returned ${x.length} components but the state dimension is ${model.stateDim}.`, 'shape');
    }
    return x;
  });
  let weights = new Array<number>(N).fill(1 / N);
  let trajectories: Vec[][] | null =
    options.trajectories || fixedLag !== undefined ? particles.map((p) => [p.slice()]) : null;
  const lagMean: Vec[] = [];
  const lagCov: Mat[] = [];
  const lagDistinct: number[] = [];
  const history: { particles: Vec[][]; weights: number[][] } | null = options.history ? { particles: [], weights: [] } : null;

  const steps: ParticleStep[] = [];
  const resampleTimes: number[] = [];
  const degenerateSteps: number[] = [];
  const warnings: string[] = [];
  let logLikelihood = 0;
  let minEss = Infinity;
  let minEssTime = 0;
  let partial = false;
  let t = 0;

  while (t < T) {
    const stop = Math.min(T, t + chunk);
    for (; t < stop; t++) {
      const y = observationVector(observations[t], t, model.obsDim);
      let logW = new Array<number>(N).fill(0);
      let base = particles;

      if (auxiliary && y !== null && model.propagateMean !== undefined) {
        // First stage: resample ancestors using the predictive weight
        // p(y_t | E[x_t | x_{t−1}]), so particles that cannot explain the next
        // observation are dropped BEFORE they are propagated.
        const firstStage = particles.map((p, i) => {
          const mu = model.propagateMean!(p, t);
          return Math.log(Math.max(weights[i], Number.MIN_VALUE)) + model.logObservationDensity(y, mu, t);
        });
        const fs = normaliseLogWeights(firstStage, t);
        const idx = resampleIndices(fs.weights, scheme, rng);
        base = idx.map((i) => particles[i].slice());
        if (trajectories !== null) trajectories = idx.map((i) => trajectories![i].map((v) => v.slice()));
        // The second-stage correction divides out the first-stage weight.
        const corrections = idx.map((i) => model.logObservationDensity(y, model.propagateMean!(particles[i], t), t));
        resampleTimes.push(t);
        logW = corrections.map((c) => -c);
        weights = new Array<number>(N).fill(1 / N);
      } else {
        logW = weights.map((w) => Math.log(Math.max(w, Number.MIN_VALUE)));
      }

      const propagated: Vec[] = new Array<Vec>(N);
      for (let i = 0; i < N; i++) {
        const xPrev = base[i];
        let xNext: Vec;
        if (proposal !== undefined && y !== null) {
          xNext = proposal.sample(xPrev, t, y, normal, uniform);
          if (proposal.logDensity !== undefined) {
            if (model.logTransitionDensity === undefined) {
              throw new EngineError(
                'A non-bootstrap proposal needs logTransitionDensity on the model, because the importance weight is ' +
                  'p(x_t | x_{t−1}) / q(x_t | x_{t−1}, y_t) and the numerator cannot be evaluated without it.',
                'required',
              );
            }
            logW[i] += model.logTransitionDensity(xNext, xPrev, t) - proposal.logDensity(xNext, xPrev, t, y);
          }
        } else {
          xNext = model.samplePropagate(xPrev, t, normal, uniform);
        }
        if (xNext.length !== model.stateDim) {
          throw new EngineError(`The propagated state at time ${t} has ${xNext.length} components but the state dimension is ${model.stateDim}.`, 'shape');
        }
        for (let d = 0; d < xNext.length; d++) {
          if (!Number.isFinite(xNext[d])) {
            throw new EngineError(`Particle ${i} at time ${t} has a non-finite component ${d} (${xNext[d]}).`, 'finite');
          }
        }
        propagated[i] = xNext;
        if (y !== null) logW[i] += model.logObservationDensity(y, xNext, t);
      }

      particles = propagated;
      if (trajectories !== null) {
        for (let i = 0; i < N; i++) trajectories[i].push(particles[i].slice());
      }

      if (y === null) {
        // No measurement: weights are unchanged, the cloud simply spreads out.
        const { weights: w } = normaliseLogWeights(logW, t);
        weights = w;
        const mean = weightedMean(particles, weights);
        const ess = effectiveSampleSize(weights);
        steps.push(makeStep(mean, weightedCovariance(particles, weights, mean), ess, N, Math.max(...weights), false, 0));
        if (ess < minEss) {
          minEss = ess;
          minEssTime = t;
        }
        if (history !== null) {
          history.particles.push(particles.map((p) => p.slice()));
          history.weights.push(weights.slice());
        }
        continue;
      }

      const norm = normaliseLogWeights(logW, t);
      weights = norm.weights;
      const mean = weightedMean(particles, weights);
      const cov = weightedCovariance(particles, weights, mean);
      const ess = effectiveSampleSize(weights);
      const maxWeight = Math.max(...weights);
      if (ess < minEss) {
        minEss = ess;
        minEssTime = t;
      }
      if (ess / N < degenThreshold) degenerateSteps.push(t);
      if (history !== null) {
        history.particles.push(particles.map((p) => p.slice()));
        history.weights.push(weights.slice());
      }
      if (fixedLag !== undefined && trajectories !== null && t >= fixedLag) {
        const tau = t - fixedLag;
        const pts = trajectories.map((p) => p[tau + 1]);
        const m = weightedMean(pts, weights);
        lagMean.push(m);
        lagCov.push(weightedCovariance(pts, weights, m));
        lagDistinct.push(new Set(pts.map((p) => p.join(','))).size);
      }
      let resampled = false;
      if (ess / N < essThreshold) {
        const idx = resampleIndices(weights, scheme, rng);
        particles = idx.map((i) => particles[i].slice());
        if (trajectories !== null) trajectories = idx.map((i) => trajectories![i].map((v) => v.slice()));
        weights = new Array<number>(N).fill(1 / N);
        resampled = true;
        resampleTimes.push(t);
      }
      steps.push(makeStep(mean, cov, ess, N, maxWeight, resampled, norm.logTotal));
    }
    yield { completed: t, total: T };
    if (t < T && options.isCancelled?.()) {
      partial = true;
      warnings.push(`The run was cancelled after ${t} of ${T} steps; the remaining states were not estimated.`);
      break;
    }
  }

  // The log-likelihood estimate is the sum of the per-step log mean weights.
  logLikelihood = stableSum(steps.map((s) => s.logLikelihoodIncrement));

  if (degenerateSteps.length > 0) {
    warnings.push(
      `WEIGHT DEGENERACY: the effective sample size fell below ${(degenThreshold * 100).toFixed(0)}% of the ${N} ` +
        `particles at ${degenerateSteps.length} step(s), reaching ${minEss.toFixed(1)} particles at time ${minEssTime}. ` +
        'At those steps the reported mean and covariance come from a handful of samples, so they are far less certain ' +
        'than the particle spread suggests and the covariance is biased downwards. Increase the particle count, use a ' +
        'better proposal, or check whether the observations are compatible with the model at all.',
    );
  }
  const mcse = monteCarloStandardError(particles, weights);
  return {
    steps,
    logLikelihood,
    particles: N,
    resampleTimes,
    minEss,
    minEssTime,
    degenerateSteps,
    scheme,
    method: auxiliary ? 'auxiliary' : proposal !== undefined ? 'sir' : 'bootstrap',
    finalParticles: particles.map((p) => p.slice()),
    finalWeights: weights.slice(),
    monteCarloStandardError: mcse,
    exactness: 'empirical',
    explanation: explainFiltering(
      auxiliary ? 'Auxiliary particle filter' : proposal !== undefined ? 'Sequential importance resampling' : 'Bootstrap particle filter',
      'empirical',
      [
        { label: 'Particles', value: String(N) },
        { label: 'Resampling scheme', value: scheme },
        { label: 'Resampling trigger', expression: 'ESS/N < threshold', value: essThreshold.toFixed(2) },
        { label: 'Resampling events', value: String(resampleTimes.length) },
        { label: 'Minimum effective sample size', value: `${minEss.toFixed(1)} of ${N} (time ${minEssTime})` },
        { label: 'Log-likelihood estimate', value: logLikelihood.toFixed(4) },
      ],
      ['The model can be sampled from and the observation density evaluated; no Gaussianity or linearity is assumed.'],
      [
        'Every number here is a Monte Carlo estimate with sampling error, reported as the Monte Carlo standard error. It is not the same quantity as the posterior spread.',
        'The log-likelihood estimate is unbiased for the likelihood itself, so its logarithm is biased downwards; the bias shrinks with the particle count.',
        'A low effective sample size means the estimates rest on few particles whatever the particle count says.',
      ],
    ),
    warnings,
    partial,
    ...(history !== null ? { history } : {}),
    ...(trajectories !== null ? { trajectories } : {}),
    ...(fixedLag !== undefined
      ? { fixedLag: { lag: fixedLag, mean: lagMean, covariance: lagCov, distinctAncestors: lagDistinct } }
      : {}),
  };
}

function makeStep(mean: Vec, cov: Mat, ess: number, N: number, maxWeight: number, resampled: boolean, inc: number): ParticleStep {
  return { mean, covariance: cov, ess, essRatio: ess / N, maxWeight, resampled, logLikelihoodIncrement: inc };
}

function monteCarloStandardError(particles: Vec[], weights: number[]): Vec {
  const mean = weightedMean(particles, weights);
  const d = mean.length;
  const out = new Array<number>(d).fill(0);
  // Var of a weighted mean of independent draws: Σ w_i² (x_i − x̄)².
  for (let i = 0; i < particles.length; i++) {
    for (let j = 0; j < d; j++) {
      const dv = particles[i][j] - mean[j];
      out[j] += weights[i] * weights[i] * dv * dv;
    }
  }
  return out.map(Math.sqrt);
}

/** The bootstrap filter: proposal = transition, weights = observation density. */
export function bootstrapParticleFilter(
  model: ParticleModel,
  observations: Observation[],
  rng: Random,
  options: ParticleOptions = {},
): ParticleFilterResult {
  const it = sequentialImportanceResamplingSteps(model, observations, rng, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

/** The auxiliary particle filter: look-ahead first stage, then correction. */
export function auxiliaryParticleFilter(
  model: ParticleModel,
  observations: Observation[],
  rng: Random,
  options: ParticleOptions = {},
): ParticleFilterResult {
  const it = sequentialImportanceResamplingSteps(model, observations, rng, { ...options, auxiliary: true });
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

export function particleFilter(
  model: ParticleModel,
  observations: Observation[],
  rng: Random,
  options: SirOptions = {},
): ParticleFilterResult {
  const it = sequentialImportanceResamplingSteps(model, observations, rng, options);
  let s = it.next();
  while (!s.done) s = it.next();
  return s.value;
}

/**
 * Forward-filtering / backward-sampling smoother.
 *
 * Draws complete trajectories from p(x_{1..T} | y_{1..T}) by walking backwards
 * through the stored particle clouds, choosing an ancestor at time t with
 * probability proportional to w_t^i · p(x_{t+1} | x_t^i). This is the correct
 * smoother; simply looking at the surviving genealogy of a filter run gives a
 * degenerate answer at early times, because resampling has collapsed it to a
 * handful of distinct ancestors.
 */
export function particleSmootherFFBS(
  model: ParticleModel,
  filterRun: ParticleFilterResult,
  rng: Random,
  options: { trajectories?: number } = {},
): ParticleSmootherResult {
  if (filterRun.history === undefined) {
    throw new EngineError(
      'Backward sampling needs every particle cloud from the forward pass. Re-run the filter with history: true — the ' +
        'clouds cannot be reconstructed afterwards.',
      'required',
    );
  }
  if (model.logTransitionDensity === undefined) {
    throw new EngineError(
      'Backward sampling needs logTransitionDensity on the model: the backward weight is w_t^i · p(x_{t+1} | x_t^i), ' +
        'and that transition density cannot be obtained from samples alone.',
      'required',
    );
  }
  const M = options.trajectories ?? 100;
  if (!Number.isInteger(M) || M < 1) throw new EngineError(`The number of smoothed trajectories must be a whole number of at least 1; received ${M}.`, 'range');
  const { particles: clouds, weights: cloudWeights } = filterRun.history;
  const T = clouds.length;
  if (T === 0) throw new EngineError('The stored particle history is empty.', 'required');

  const trajectories: Vec[][] = [];
  for (let j = 0; j < M; j++) {
    const path: Vec[] = new Array<Vec>(T);
    // Final time: draw from the filtered cloud.
    const lastIdx = resampleIndices(cloudWeights[T - 1], 'multinomial', rng)[0];
    path[T - 1] = clouds[T - 1][lastIdx].slice();
    for (let t = T - 2; t >= 0; t--) {
      const w = cloudWeights[t];
      const logW = clouds[t].map((x, i) => Math.log(Math.max(w[i], Number.MIN_VALUE)) + model.logTransitionDensity!(path[t + 1], x, t + 1));
      const norm = normaliseLogWeights(logW, t);
      const idx = resampleIndices(norm.weights, 'multinomial', rng)[0];
      path[t] = clouds[t][idx].slice();
    }
    trajectories.push(path);
  }

  const d = model.stateDim;
  const smoothedMean: Vec[] = [];
  const smoothedCov: Mat[] = [];
  const uniformW = new Array<number>(M).fill(1 / M);
  for (let t = 0; t < T; t++) {
    const pts = trajectories.map((p) => p[t]);
    const mean = weightedMean(pts, uniformW);
    smoothedMean.push(mean);
    smoothedCov.push(weightedCovariance(pts, uniformW, mean));
  }
  if (d !== smoothedMean[0].length) {
    throw new EngineError(`The smoothed trajectories have dimension ${smoothedMean[0].length} but the model declares ${d}.`, 'shape');
  }
  return {
    trajectories,
    smoothedMean,
    smoothedCov,
    method: 'ffbs',
    exactness: 'empirical',
    explanation: explainFiltering(
      'Forward-filtering backward-sampling particle smoother',
      'empirical',
      [
        { label: 'Trajectories drawn', value: String(M) },
        { label: 'Backward weight', expression: 'w_t^i · p(x_{t+1} | x_t^i)' },
      ],
      ['The forward particle clouds approximate the filtering distributions well enough to resample from.'],
      [
        `The smoothed moments come from ${M} trajectories, so they carry Monte Carlo error of order 1/√${M}.`,
        'Backward sampling can only choose among particles the forward pass actually visited: if the forward filter never explored a region, the smoother cannot recover it.',
      ],
    ),
    warnings: [...filterRun.warnings],
    partial: filterRun.partial,
  };
}

/**
 * Fixed-lag smoothing: report the state at t − L using the particle genealogy
 * at time t. Cheap and online, and deliberately limited — beyond a modest lag
 * the surviving lineage has collapsed to few distinct ancestors and the
 * smoothed spread is an underestimate, so the lag is reported with the result.
 */
export function fixedLagSmoother(filterRun: ParticleFilterResult): ParticleSmootherResult {
  const stored = filterRun.fixedLag;
  if (stored === undefined) {
    throw new EngineError(
      'No fixed-lag moments were recorded. Fixed-lag smoothing has to happen DURING the forward pass — resampling ' +
        'rewrites the genealogy, so the weights that applied at the earlier time no longer exist afterwards. Re-run ' +
        'the filter with fixedLag set.',
      'required',
    );
  }
  const warnings = [...filterRun.warnings];
  const minDistinct = stored.distinctAncestors.length ? Math.min(...stored.distinctAncestors) : filterRun.particles;
  if (minDistinct < Math.max(2, filterRun.particles * 0.05)) {
    warnings.push(
      `At its worst step the fixed-lag smoother had only ${minDistinct} distinct ancestors out of ` +
        `${filterRun.particles} particles. Path degeneracy makes the smoothed spread there an UNDERESTIMATE of the ` +
        'real uncertainty; use the backward-sampling smoother, or a shorter lag.',
    );
  }
  return {
    trajectories: filterRun.trajectories ?? [],
    smoothedMean: stored.mean,
    smoothedCov: stored.covariance,
    method: 'fixed-lag',
    lag: stored.lag,
    exactness: 'empirical',
    explanation: explainFiltering(
      'Fixed-lag particle smoother',
      'empirical',
      [
        { label: 'Lag', value: String(stored.lag) },
        { label: 'Steps smoothed', value: String(stored.mean.length) },
        { label: 'Fewest distinct ancestors at any step', value: String(minDistinct) },
      ],
      ['The surviving lineage at time t + L, weighted by the weights in force then, is treated as a sample from the smoothing distribution at time t.'],
      [
        'Path degeneracy: the further back the lag reaches, the fewer distinct ancestors remain and the narrower the smoothed spread becomes. The count of distinct ancestors is reported so this can be judged rather than assumed away.',
        'The first `lag` steps have no fixed-lag estimate, because the lag had not yet elapsed.',
      ],
    ),
    warnings,
    partial: filterRun.partial,
  };
}

/**
 * Rao-Blackwellised particle filter.
 *
 * When the state splits into a non-linear part s_t and a part z_t that is
 * conditionally linear-Gaussian GIVEN the path of s, the linear part should
 * never be sampled: it can be integrated out exactly with a Kalman filter
 * attached to each particle. The particles then explore only the non-linear
 * subspace, so a given accuracy needs far fewer of them, and the weights are
 * the exact conditional observation densities rather than point evaluations.
 *
 * Each particle carries (s_t, mean of z_t, covariance of z_t). The weight
 * increment is the Gaussian predictive density of y_t under that particle's own
 * conditional model, which is exactly the marginalisation.
 */
export interface ConditionalLinearBlock {
  /** z_t = A z_{t−1} + b + w, w ~ N(0, Q). */
  A: Mat;
  b?: Vec;
  Q: Mat;
  /** y_t = C z_t + d + v, v ~ N(0, R). */
  C: Mat;
  d?: Vec;
  R: Mat;
}

export interface RaoBlackwellisedModel {
  nonlinearDim: number;
  linearDim: number;
  obsDim: number;
  sampleInitialNonlinear(normal: () => number, uniform: () => number): Vec;
  sampleNonlinear(s: Vec, t: number, normal: () => number, uniform: () => number): Vec;
  /** The conditional linear-Gaussian block, given the current non-linear state. */
  linear(s: Vec, t: number): ConditionalLinearBlock;
  /** Prior for the linear part. */
  mu0: Vec;
  Sigma0: Mat;
}

export interface RaoBlackwellisedResult extends ParticleFilterResult {
  /** Posterior mean of the linear part at each step, marginalised exactly. */
  linearMean: Vec[];
  linearCov: Mat[];
}

export function raoBlackwellisedParticleFilter(
  model: RaoBlackwellisedModel,
  observations: Observation[],
  rng: Random,
  options: ParticleOptions = {},
): RaoBlackwellisedResult {
  const T = observations.length;
  if (T === 0) throw new EngineError('A particle filter needs at least one time step; the observation sequence is empty.', 'required');
  const N = options.particles ?? 500;
  if (!Number.isInteger(N) || N < 1) throw new EngineError(`The particle count must be a whole number of at least 1; received ${N}.`, 'range');
  if (rows(model.Sigma0) !== model.linearDim || cols(model.Sigma0) !== model.linearDim) {
    throw new EngineError(`Sigma0 is ${rows(model.Sigma0)}×${cols(model.Sigma0)} but the linear part has dimension ${model.linearDim}.`, 'shape');
  }
  if (model.mu0.length !== model.linearDim) {
    throw new EngineError(`mu0 has ${model.mu0.length} components but the linear part has dimension ${model.linearDim}.`, 'shape');
  }
  const scheme = options.scheme ?? 'systematic';
  const essThreshold = options.essThreshold ?? 0.5;
  const degenThreshold = options.degeneracyThreshold ?? 0.1;
  const normal = () => rng.normal();
  const uniform = () => rng.uniform();

  let s: Vec[] = Array.from({ length: N }, () => model.sampleInitialNonlinear(normal, uniform));
  let zMean: Vec[] = Array.from({ length: N }, () => model.mu0.slice());
  let zCov: Mat[] = Array.from({ length: N }, () => symmetrise(model.Sigma0));
  let weights = new Array<number>(N).fill(1 / N);
  psdCholesky(symmetrise(model.Sigma0), 'Sigma0');

  const steps: ParticleStep[] = [];
  const linearMean: Vec[] = [];
  const linearCov: Mat[] = [];
  const resampleTimes: number[] = [];
  const degenerateSteps: number[] = [];
  const warnings: string[] = [];
  let minEss = Infinity;
  let minEssTime = 0;

  for (let t = 0; t < T; t++) {
    const y = observationVector(observations[t], t, model.obsDim);
    const logW = weights.map((w) => Math.log(Math.max(w, Number.MIN_VALUE)));
    const nextS: Vec[] = new Array<Vec>(N);
    const nextMean: Vec[] = new Array<Vec>(N);
    const nextCov: Mat[] = new Array<Mat>(N);
    for (let i = 0; i < N; i++) {
      const si = model.sampleNonlinear(s[i], t, normal, uniform);
      if (si.length !== model.nonlinearDim) {
        throw new EngineError(`The non-linear state at time ${t} has ${si.length} components but ${model.nonlinearDim} were declared.`, 'shape');
      }
      const blk = model.linear(si, t);
      if (rows(blk.A) !== model.linearDim || cols(blk.A) !== model.linearDim) {
        throw new EngineError(`The conditional A at time ${t} is ${rows(blk.A)}×${cols(blk.A)} but the linear part has dimension ${model.linearDim}.`, 'shape');
      }
      if (cols(blk.C) !== model.linearDim || rows(blk.C) !== model.obsDim) {
        throw new EngineError(`The conditional C at time ${t} is ${rows(blk.C)}×${cols(blk.C)}; it must be ${model.obsDim}×${model.linearDim}.`, 'shape');
      }
      let pMean = matVec(blk.A, zMean[i]);
      if (blk.b !== undefined) pMean = addVec(pMean, blk.b);
      const pCov = symmetrise(matAdd(matMul(matMul(blk.A, zCov[i]), transpose(blk.A)), blk.Q));
      if (y === null) {
        nextS[i] = si;
        nextMean[i] = pMean;
        nextCov[i] = pCov;
        continue;
      }
      const CP = matMul(blk.C, pCov);
      const S = symmetrise(matAdd(matMul(CP, transpose(blk.C)), blk.R));
      const Sl = choleskyOrThrow(S, `The conditional innovation covariance at time ${t}`);
      let yPred = matVec(blk.C, pMean);
      if (blk.d !== undefined) yPred = addVec(yPred, blk.d);
      const innov = subVec(y, yPred);
      const zz = forwardSubstitute(Sl, innov);
      let logDet = 0;
      for (let q = 0; q < Sl.length; q++) logDet += Math.log(Sl[q][q]);
      logW[i] += -0.5 * (y.length * LOG_2PI + 2 * logDet + zz.reduce((a, b) => a + b * b, 0));
      const K = transpose(solveSPDMat(S, CP, `The conditional innovation covariance at time ${t}`));
      nextS[i] = si;
      nextMean[i] = addVec(pMean, matVec(K, innov));
      const ImKC = matAdd(identity(model.linearDim), matMul(K, blk.C).map((r) => r.map((v) => -v)));
      nextCov[i] = symmetrise(matAdd(matMul(matMul(ImKC, pCov), transpose(ImKC)), matMul(matMul(K, blk.R), transpose(K))));
    }
    s = nextS;
    zMean = nextMean;
    zCov = nextCov;
    const norm = normaliseLogWeights(logW, t);
    weights = norm.weights;
    const ess = effectiveSampleSize(weights);
    if (ess < minEss) {
      minEss = ess;
      minEssTime = t;
    }
    if (ess / N < degenThreshold) degenerateSteps.push(t);
    const sMean = weightedMean(s, weights);
    steps.push(makeStep(sMean, weightedCovariance(s, weights, sMean), ess, N, Math.max(...weights), false, norm.logTotal));
    // Mixture moments of the linear part: Σ w_i mean_i, and the law of total
    // covariance Σ w_i (P_i + (m_i − m̄)(m_i − m̄)ᵀ).
    const lm = weightedMean(zMean, weights);
    const lc = zeros(model.linearDim, model.linearDim);
    for (let i = 0; i < N; i++) {
      const dv = subVec(zMean[i], lm);
      for (let a = 0; a < model.linearDim; a++) {
        for (let b = 0; b < model.linearDim; b++) lc[a][b] += weights[i] * (zCov[i][a][b] + dv[a] * dv[b]);
      }
    }
    linearMean.push(lm);
    linearCov.push(symmetrise(lc));
    if (ess / N < essThreshold) {
      const idx = resampleIndices(weights, scheme, rng);
      s = idx.map((i) => s[i].slice());
      zMean = idx.map((i) => zMean[i].slice());
      zCov = idx.map((i) => cloneMat(zCov[i]));
      weights = new Array<number>(N).fill(1 / N);
      resampleTimes.push(t);
      steps[steps.length - 1] = { ...steps[steps.length - 1], resampled: true };
    }
  }

  if (degenerateSteps.length > 0) {
    warnings.push(
      `WEIGHT DEGENERACY: the effective sample size fell to ${minEss.toFixed(1)} of ${N} particles at time ${minEssTime}. ` +
        'The non-linear part of the state is being represented by very few samples at those steps.',
    );
  }
  const logLikelihood = stableSum(steps.map((st) => st.logLikelihoodIncrement));
  return {
    steps,
    logLikelihood,
    particles: N,
    resampleTimes,
    minEss,
    minEssTime,
    degenerateSteps,
    scheme,
    method: 'rao-blackwellised',
    finalParticles: s.map((p) => p.slice()),
    finalWeights: weights.slice(),
    monteCarloStandardError: monteCarloStandardError(s, weights),
    linearMean,
    linearCov,
    exactness: 'empirical',
    explanation: explainFiltering(
      'Rao-Blackwellised particle filter',
      'empirical',
      [
        { label: 'Particles (non-linear part only)', value: String(N) },
        { label: 'Linear part', value: `integrated out exactly by a Kalman filter per particle (dimension ${model.linearDim})` },
        { label: 'Weight increment', expression: 'p(y_t | s_{1..t}, y_{1..t−1}), a Gaussian predictive density' },
        { label: 'Minimum effective sample size', value: `${minEss.toFixed(1)} of ${N}` },
      ],
      ['Given the path of the non-linear state, the remaining state is linear with Gaussian noise — checked by the caller, assumed here.'],
      [
        'Monte Carlo error affects the non-linear part only; the linear part is exact given each particle, which is the whole point of the method.',
        'The reported linear covariance is a mixture covariance (law of total covariance over the particles), not any single Kalman covariance.',
      ],
    ),
    warnings,
    partial: false,
  };
}
