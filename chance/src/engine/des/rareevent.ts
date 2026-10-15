/**
 * Rare-event simulation: probabilities too small for plain Monte Carlo.
 *
 * To see an event of probability 1e-6 even ten times, plain Monte Carlo needs
 * about ten million runs. At any feasible sample size it usually sees the event
 * zero times, and the sample frequency is then 0 — which is not the
 * probability, and reporting it as one is a lie that looks like a measurement.
 * `plainMonteCarloRareEvent` therefore returns `null` for the estimate when
 * nothing was observed, together with the upper confidence bound the run does
 * support: "not observed in N runs, so the probability is below u with 95%
 * confidence" is a true statement, and it is the only true statement available.
 *
 * The methods that can actually estimate such probabilities all work by making
 * the rare event less rare and correcting for it:
 *
 *  - importance splitting (RESTART): reach the rare set through a sequence of
 *    nested, individually un-rare levels, multiplying the conditional
 *    probabilities;
 *  - subset simulation: the same idea with the levels chosen adaptively from
 *    the samples, and Markov-chain sampling within each level, so no problem-
 *    specific conditional sampler is needed;
 *  - the cross-entropy method: search for the importance-sampling distribution
 *    closest to the (unknown) optimal one, then estimate with it.
 *
 * Every estimator here reports its own coefficient of variation and an
 * effective sample size, because a rare-event estimate without them is
 * meaningless: these estimators can be wrong by orders of magnitude while
 * looking perfectly stable.
 */
import { EngineError } from '../core/result';
import { clopperPearsonInterval, type Interval } from '../stats/descriptive';
import { normalQuantile, normalSf } from '../special/gamma';
import { Random, Xoshiro128, type Seed } from '../random/rng';

/** Performance function: the rare event is `performance(x) > threshold`. */
export type PerformanceFunction = (x: Float64Array) => number;

function zFor(level: number): number {
  return normalQuantile(0.5 + level / 2);
}

/**
 * Lognormal interval for a positive, right-skewed estimator with known
 * coefficient of variation. Appropriate for a product of level probabilities:
 * a symmetric interval on such an estimator can reach below zero.
 */
function lognormalInterval(estimate: number, cv: number, level: number): Interval {
  if (!(estimate > 0)) {
    throw new EngineError('A lognormal interval needs a strictly positive estimate.', 'range');
  }
  const z = zFor(level);
  const sigma = Math.sqrt(Math.log1p(cv * cv));
  return {
    low: estimate * Math.exp(-z * sigma),
    high: estimate * Math.exp(z * sigma),
    level,
    method: 'Lognormal interval from the estimator\'s coefficient of variation (the estimator is a positive product, so a symmetric interval would be wrong)',
  };
}

// ---------------------------------------------------------------------------
// Plain Monte Carlo, reported honestly
// ---------------------------------------------------------------------------

export interface PlainRareEventReport {
  method: 'Plain Monte Carlo';
  trials: number;
  occurrences: number;
  /**
   * The estimated probability, or null when the event was never observed.
   * Null is deliberate: 0 is not an estimate of a positive probability, and
   * substituting it would be the exact failure this engine refuses.
   */
  estimate: number | null;
  standardError: number | null;
  /** Exact (Clopper–Pearson) interval; valid even with zero occurrences. */
  interval: Interval;
  /** One-sided upper confidence bound: 1 − α^(1/N). */
  upperBound: number;
  observed: boolean;
  /** Trials that would be needed to expect about 10 occurrences. */
  trialsForTenOccurrences: number | null;
  message: string;
  exactness: 'empirical';
}

export function plainMonteCarloRareEvent(options: {
  trials: number;
  indicator: (rng: Random, trial: number) => boolean;
  seed: Seed;
  level?: number;
  /** Name of the substream, so the indicator can be compared across methods. */
  stream?: string;
}): PlainRareEventReport {
  const level = options.level ?? 0.95;
  if (!Number.isInteger(options.trials) || options.trials < 1) {
    throw new EngineError(`The number of trials must be a whole number of at least 1 (got ${options.trials}).`, 'range');
  }
  const rng = new Random(new Xoshiro128(`${String(options.seed)}\u0000${options.stream ?? 'plain-mc'}`));
  let occurrences = 0;
  for (let i = 0; i < options.trials; i++) {
    if (options.indicator(rng, i)) occurrences++;
  }
  const n = options.trials;
  const interval = clopperPearsonInterval(occurrences, n, level);
  const alpha = 1 - level;
  const upperBound = 1 - Math.pow(alpha, 1 / n);
  if (occurrences === 0) {
    return {
      method: 'Plain Monte Carlo',
      trials: n,
      occurrences: 0,
      estimate: null,
      standardError: null,
      interval,
      upperBound,
      observed: false,
      trialsForTenOccurrences: null,
      message: `The event was not observed in ${n.toLocaleString('en-US')} runs. That does not make it impossible and its probability is NOT 0 — it is simply smaller than this many runs can resolve. What the run does support is an upper bound: the probability is below ${upperBound.toExponential(3)} with ${(level * 100).toFixed(0)}% confidence (one-sided), equivalently below ${interval.high.toExponential(3)} by the two-sided exact interval. To estimate the probability rather than bound it, use importance splitting, subset simulation or the cross-entropy method.`,
      exactness: 'empirical',
    };
  }
  const p = occurrences / n;
  return {
    method: 'Plain Monte Carlo',
    trials: n,
    occurrences,
    estimate: p,
    standardError: Math.sqrt((p * (1 - p)) / n),
    interval,
    upperBound,
    observed: true,
    trialsForTenOccurrences: Math.ceil(10 / p),
    message: `The event occurred ${occurrences.toLocaleString('en-US')} time(s) in ${n.toLocaleString('en-US')} runs, giving ${p.toExponential(3)}. ${
      occurrences < 10
        ? `With fewer than 10 occurrences the estimate is very imprecise: about ${Math.ceil(10 / p).toLocaleString('en-US')} runs would be needed for ten occurrences. Use the exact interval, not the standard error, and consider a rare-event method.`
        : 'The exact interval accounts for the small count.'
    }`,
    exactness: 'empirical',
  };
}

// ---------------------------------------------------------------------------
// Importance splitting / RESTART, fixed effort
// ---------------------------------------------------------------------------

export interface SplittingLevelReport {
  level: number;
  threshold: number;
  reached: number;
  attempts: number;
  conditionalProbability: number;
  /** Squared coefficient of variation contributed by this level. */
  varianceContribution: number;
}

export interface SplittingResult<S> {
  method: string;
  levels: SplittingLevelReport[];
  estimate: number;
  coefficientOfVariation: number;
  standardError: number;
  interval: Interval;
  /** Equivalent number of plain Monte Carlo runs. */
  effectiveSampleSize: number;
  totalAdvances: number;
  reachedTarget: boolean;
  /** States that reached the rare set, for inspecting what failure looks like. */
  survivors: S[];
  message: string;
  exactness: 'empirical';
}

/** What `advance` is told about the move it has to make. */
export interface SplittingStep<S> {
  /** A particle that has already reached `fromLevel`. */
  state: S;
  /**
   * The level the particle is known to have reached, and therefore the level
   * the move must stay conditioned on. This is NOT the particle's own value:
   * conditioning on the particle's value instead of on the level it qualified
   * for is the classic bug in splitting implementations, and it biases the
   * estimate upwards by orders of magnitude, because surviving particles sit
   * well above the level that admitted them.
   */
  fromLevel: number;
  /** The level this move is trying to reach. */
  target: number;
  rng: Random;
}

export interface SplittingOptions<S> {
  /** Strictly increasing intermediate levels; the last is the rare event. */
  levels: readonly number[];
  /** Draw a fresh state from the unconditional distribution. */
  initial: (rng: Random) => S;
  /** The level a state has reached, used to score the first, unconditional level. */
  levelOf: (state: S) => number;
  /**
   * Move a particle that has reached `fromLevel`, preserving the distribution
   * conditioned on that level, and report whether it reached `target`.
   */
  advance: (step: SplittingStep<S>) => { reached: boolean; state: S };
  /** Particles kept at each level. */
  particlesPerLevel: number;
  seed: Seed;
  level?: number;
}

/**
 * Fixed-effort importance splitting (RESTART).
 *
 * Instead of waiting for one run to reach a far-away level, the rare set is
 * reached in stages: a population of particles is advanced to the first level,
 * the survivors are resampled to restore the population, and the process
 * repeats. The probability is the product of the conditional probabilities,
 * each of which is large enough to estimate. The levels must be close enough
 * that each conditional probability is not itself rare — 0.1 to 0.5 is the
 * usual range, and the report shows each one so a bad choice is visible.
 */
export function importanceSplitting<S>(options: SplittingOptions<S>): SplittingResult<S> {
  const level = options.level ?? 0.95;
  const N = options.particlesPerLevel;
  if (!Number.isInteger(N) || N < 2) {
    throw new EngineError(`Importance splitting needs at least 2 particles per level (got ${N}).`, 'range');
  }
  if (options.levels.length < 1) {
    throw new EngineError('Importance splitting needs at least one level (the rare event itself).', 'required');
  }
  for (let i = 1; i < options.levels.length; i++) {
    if (!(options.levels[i] > options.levels[i - 1])) {
      throw new EngineError(
        `The splitting levels must be strictly increasing, but level ${i} (${options.levels[i]}) is not above level ${i - 1} (${options.levels[i - 1]}). Non-monotone levels do not nest, and the product of conditional probabilities would not estimate anything.`,
        'range',
      );
    }
  }
  const rng = new Random(new Xoshiro128(`${String(options.seed)}\u0000splitting`));
  const reports: SplittingLevelReport[] = [];
  let estimate = 1;
  let cv2 = 0;
  let totalAdvances = 0;
  let population: S[] = [];

  for (let k = 0; k < options.levels.length; k++) {
    const target = options.levels[k];
    const survivors: S[] = [];
    const fromLevel = k === 0 ? Number.NEGATIVE_INFINITY : options.levels[k - 1];
    for (let i = 0; i < N; i++) {
      if (k === 0) {
        const state = options.initial(rng);
        totalAdvances++;
        if (options.levelOf(state) > target) survivors.push(state);
        continue;
      }
      const start = population[rng.int(0, population.length - 1)];
      const step = options.advance({ state: start, fromLevel, target, rng });
      totalAdvances++;
      if (step.reached) survivors.push(step.state);
    }
    const p = survivors.length / N;
    const contribution = p > 0 ? (1 - p) / (p * N) : Number.POSITIVE_INFINITY;
    reports.push({
      level: k,
      threshold: target,
      reached: survivors.length,
      attempts: N,
      conditionalProbability: p,
      varianceContribution: contribution,
    });
    if (survivors.length === 0) {
      throw new EngineError(
        `Importance splitting lost its entire population at level ${k} (threshold ${target}): none of the ${N} particles reached it. The levels are too far apart for this many particles, so no estimate is reported — a product with a zero factor would be reported as probability 0, which is exactly the false answer this must never give. Add intermediate levels or increase the particle count.`,
        'extinction',
      );
    }
    estimate *= p;
    cv2 += contribution;
    population = survivors;
  }

  const cv = Math.sqrt(cv2);
  return {
    method: `Fixed-effort importance splitting over ${options.levels.length} level(s) with ${N} particles each`,
    levels: reports,
    estimate,
    coefficientOfVariation: cv,
    standardError: estimate * cv,
    interval: lognormalInterval(estimate, cv, level),
    effectiveSampleSize: cv2 > 0 ? (1 - estimate) / (estimate * cv2) : Number.POSITIVE_INFINITY,
    totalAdvances,
    reachedTarget: true,
    survivors: population,
    message: `The probability is estimated as ${estimate.toExponential(4)} from the product of ${options.levels.length} conditional probabilities (${reports.map((r) => r.conditionalProbability.toFixed(3)).join(' × ')}), using ${totalAdvances.toLocaleString('en-US')} state advances. Its coefficient of variation is ${(100 * cv).toFixed(1)}%, equivalent to about ${(cv2 > 0 ? (1 - estimate) / (estimate * cv2) : Number.POSITIVE_INFINITY).toExponential(2)} plain Monte Carlo runs.`,
    exactness: 'empirical',
  };
}

/**
 * A conditional sampler for a standard normal truncated below at `from`, by
 * inverse transform in the upper tail. Used by the splitting estimator when the
 * level sets are nested tails of a known distribution, in which case the
 * conditional samples are exactly independent and the estimator's variance is
 * exactly the product of the per-level binomial variances.
 */
export function normalTailAdvance(step: SplittingStep<number>): { reached: boolean; state: number } {
  const from = step.fromLevel;
  if (from === Number.NEGATIVE_INFINITY) {
    const x = step.rng.normal();
    return { reached: x > step.target, state: x };
  }
  // The particle qualified by exceeding `from`, so the move must be a draw
  // from the standard normal conditioned on X > from — not on X > its own
  // value. Inverse transform in the upper tail does that exactly, which makes
  // successive levels independent and the variance exactly the product of the
  // per-level binomial variances.
  const tail = normalSf(from);
  if (!(tail > 0)) {
    throw new EngineError(
      `A conditional normal draw was requested above ${from}, where the tail probability underflows to zero in double precision. No sample can be drawn, and inventing one would invent the answer.`,
      'numerical',
    );
  }
  const u = step.rng.uniformOpen();
  const x = normalQuantile(1 - tail * u);
  return { reached: x > step.target, state: x };
}

// ---------------------------------------------------------------------------
// Subset simulation
// ---------------------------------------------------------------------------

export interface SubsetLevelReport {
  level: number;
  intermediateThreshold: number;
  conditionalProbability: number;
  /** Fraction of Markov-chain proposals accepted at this level. */
  acceptanceRate: number;
  /** Correlation factor γ: how much the chain correlation inflates the variance. */
  correlationFactor: number;
  varianceContribution: number;
  samples: number;
}

export interface SubsetSimulationResult {
  method: string;
  estimate: number;
  levels: SubsetLevelReport[];
  coefficientOfVariation: number;
  standardError: number;
  interval: Interval;
  effectiveSampleSize: number;
  totalSamples: number;
  reachedThreshold: boolean;
  message: string;
  exactness: 'empirical';
}

/**
 * Subset simulation (Au & Beck 2001) in standard normal space.
 *
 * The intermediate levels are chosen from the samples themselves so that each
 * conditional probability is exactly p0, which removes the main difficulty of
 * importance splitting: knowing where to put the levels. Samples within a level
 * come from a component-wise Metropolis chain seeded by the previous level's
 * survivors, so no problem-specific conditional sampler is needed — only the
 * performance function.
 *
 * The price is that the within-level samples are correlated, which inflates the
 * variance. That inflation is estimated from the chains and reported as γ,
 * rather than ignored: ignoring it is how subset simulation gets published with
 * intervals several times too narrow.
 */
export function subsetSimulation(options: {
  dimension: number;
  performance: PerformanceFunction;
  threshold: number;
  samplesPerLevel?: number;
  conditionalProbability?: number;
  proposalSpread?: number;
  maxLevels?: number;
  seed: Seed;
  level?: number;
}): SubsetSimulationResult {
  const level = options.level ?? 0.95;
  const d = options.dimension;
  const N = options.samplesPerLevel ?? 2000;
  const p0 = options.conditionalProbability ?? 0.1;
  const spread = options.proposalSpread ?? 1;
  const maxLevels = options.maxLevels ?? 20;
  if (!Number.isInteger(d) || d < 1) throw new EngineError(`The dimension must be a whole number of at least 1 (got ${d}).`, 'range');
  if (!Number.isInteger(N) || N < 20) throw new EngineError(`Subset simulation needs at least 20 samples per level (got ${N}).`, 'range');
  if (!(p0 > 0 && p0 < 1)) throw new EngineError(`The conditional level probability must be strictly between 0 and 1 (got ${p0}).`, 'range');
  const seedsPerLevel = Math.round(p0 * N);
  if (seedsPerLevel < 2 || !Number.isInteger(N / seedsPerLevel)) {
    throw new EngineError(
      `With ${N} samples per level and a conditional probability of ${p0}, each level keeps ${seedsPerLevel} seed(s) and would need chains of length ${N / seedsPerLevel}. Choose N and p0 so that p0·N is a whole number of at least 2 and divides N exactly (for example N = 2000 with p0 = 0.1).`,
      'configuration',
    );
  }
  const chainLength = N / seedsPerLevel;
  const rng = new Random(new Xoshiro128(`${String(options.seed)}\u0000subset`));

  let samples: Float64Array[] = [];
  let values = new Float64Array(N);
  // Which Markov chain each sample came from. At level 0 the samples are
  // independent, so each is its own chain of length 1 and the correlation
  // factor is exactly zero.
  let chainOf = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const x = new Float64Array(d);
    for (let j = 0; j < d; j++) x[j] = rng.normal();
    samples.push(x);
    values[i] = options.performance(x);
    chainOf[i] = i;
    if (!Number.isFinite(values[i])) {
      throw new EngineError(
        `The performance function returned ${values[i]} for a sample. Subset simulation orders samples by performance, which a non-finite value makes impossible.`,
        'finite',
      );
    }
  }

  const reports: SubsetLevelReport[] = [];
  let estimate = 1;
  let cv2 = 0;
  let totalSamples = N;
  let reached = false;
  let acceptanceOfCurrentSamples = 1;

  for (let k = 0; k < maxLevels; k++) {
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => values[b] - values[a]);
    const exceeding = order.filter((i) => values[i] > options.threshold).length;
    const isFinal = exceeding >= seedsPerLevel;
    // The threshold whose exceedance probability this level estimates, and the
    // probability itself. Au & Beck's correlation factor is computed from the
    // indicator of THIS threshold within the chains that produced the current
    // samples — not from the indicator of the level that admitted them, which
    // is 1 for every sample and would give a meaningless correlation of 1.
    const thresholdUsed = isFinal ? options.threshold : values[order[seedsPerLevel - 1]];
    const p = isFinal ? exceeding / N : p0;
    const gamma =
      k === 0
        ? 0
        : chainCorrelationFactor(groupIndicators(values, chainOf, thresholdUsed), p);
    const contribution = ((1 - p) / (p * N)) * (1 + gamma);
    reports.push({
      level: k,
      intermediateThreshold: thresholdUsed,
      conditionalProbability: p,
      acceptanceRate: acceptanceOfCurrentSamples,
      correlationFactor: gamma,
      varianceContribution: contribution,
      samples: N,
    });
    estimate *= p;
    cv2 += contribution;
    if (isFinal) {
      reached = true;
      break;
    }

    // Grow one Markov chain from each seed, conditioned on exceeding the
    // intermediate threshold, until the level's sample count is restored.
    const seeds = order.slice(0, seedsPerLevel);
    const nextSamples: Float64Array[] = [];
    const nextValues = new Float64Array(N);
    const nextChainOf = new Int32Array(N);
    let accepted = 0;
    let proposed = 0;
    for (let sIndex = 0; sIndex < seedsPerLevel; sIndex++) {
      let current = samples[seeds[sIndex]];
      let currentValue = values[seeds[sIndex]];
      for (let step = 0; step < chainLength; step++) {
        const candidate = new Float64Array(d);
        for (let j = 0; j < d; j++) {
          // Component-wise Metropolis on the standard normal marginal: the
          // acceptance ratio is the ratio of standard normal densities.
          const proposal = current[j] + spread * rng.normal();
          const logRatio = 0.5 * (current[j] * current[j] - proposal * proposal);
          candidate[j] = Math.log(rng.uniformOpen()) < logRatio ? proposal : current[j];
        }
        proposed++;
        const candidateValue = options.performance(candidate);
        if (candidateValue > thresholdUsed) {
          current = candidate;
          currentValue = candidateValue;
          accepted++;
        }
        const slot = sIndex * chainLength + step;
        nextSamples.push(current);
        nextValues[slot] = currentValue;
        nextChainOf[slot] = sIndex;
      }
    }
    acceptanceOfCurrentSamples = proposed > 0 ? accepted / proposed : 0;
    samples = nextSamples;
    values = nextValues;
    chainOf = nextChainOf;
    totalSamples += N;
  }

  if (!reached) {
    throw new EngineError(
      `Subset simulation did not reach the threshold of ${options.threshold} within ${maxLevels} levels; the last intermediate level was ${reports[reports.length - 1].intermediateThreshold}. No estimate is reported: the product of the levels so far is a bound on how far the search got, not a probability. Raise the level limit, or check that the performance function can exceed the threshold at all.`,
      'not-reached',
    );
  }

  const cv = Math.sqrt(cv2);
  return {
    method: `Subset simulation: ${reports.length} level(s) at conditional probability ${p0}, ${N} samples per level, chains of length ${chainLength}`,
    estimate,
    levels: reports,
    coefficientOfVariation: cv,
    standardError: estimate * cv,
    interval: lognormalInterval(estimate, cv, level),
    effectiveSampleSize: cv2 > 0 ? (1 - estimate) / (estimate * cv2) : Number.POSITIVE_INFINITY,
    totalSamples,
    reachedThreshold: true,
    message: `The probability is estimated as ${estimate.toExponential(4)} after ${reports.length} level(s) and ${totalSamples.toLocaleString('en-US')} performance evaluations, against the ${Math.round(1 / estimate).toLocaleString('en-US')} or so plain Monte Carlo runs that would be needed to see the event once. The coefficient of variation is ${(100 * cv).toFixed(1)}%, which already includes the inflation from correlated Markov-chain samples (γ of ${reports.map((r) => r.correlationFactor.toFixed(2)).join(', ')}).`,
    exactness: 'empirical',
  };
}


/** Group each sample's level indicator by the Markov chain that produced it. */
function groupIndicators(values: Float64Array, chainOf: Int32Array, threshold: number): number[][] {
  const groups = new Map<number, number[]>();
  for (let i = 0; i < values.length; i++) {
    const key = chainOf[i];
    const list = groups.get(key);
    const indicator = values[i] > threshold ? 1 : 0;
    if (list) list.push(indicator);
    else groups.set(key, [indicator]);
  }
  return [...groups.values()];
}

/**
 * The correlation factor γ of Au & Beck: how much the within-chain correlation
 * of the level indicators inflates the variance of the level's probability
 * estimate relative to independent sampling. γ = 0 means the samples behave as
 * if independent; a large γ means the chains barely move and the level's
 * nominal sample size is mostly illusory.
 */
function chainCorrelationFactor(indicators: readonly number[][], p: number): number {
  const chains = indicators.length;
  if (chains === 0) return 0;
  const chainLength = indicators[0].length;
  const total = chains * chainLength;
  const r0 = p * (1 - p);
  if (!(r0 > 0) || chainLength < 2) return 0;
  let gamma = 0;
  for (let lag = 1; lag < chainLength; lag++) {
    let sum = 0;
    let count = 0;
    for (let c = 0; c < chains; c++) {
      const chain = indicators[c];
      for (let i = 0; i + lag < chain.length; i++) {
        sum += chain[i] * chain[i + lag];
        count++;
      }
    }
    if (count === 0) break;
    const r = sum / count - p * p;
    gamma += 2 * (1 - (lag * chains) / total) * (r / r0);
  }
  return Math.max(0, gamma);
}

// ---------------------------------------------------------------------------
// Cross-entropy method
// ---------------------------------------------------------------------------

export interface CrossEntropyIteration {
  iteration: number;
  intermediateThreshold: number;
  /** Mean of the tilted sampling distribution, per component. */
  mean: number[];
  /** Standard deviation of the tilted sampling distribution, per component. */
  sd: number[];
  eliteCount: number;
}

export interface CrossEntropyResult {
  method: string;
  iterations: CrossEntropyIteration[];
  estimate: number;
  standardError: number;
  interval: Interval;
  /** Coefficient of variation of the final importance-sampling estimate. */
  coefficientOfVariation: number;
  effectiveSampleSize: number;
  finalSamples: number;
  totalSamples: number;
  reachedThreshold: boolean;
  message: string;
  exactness: 'empirical';
}

/**
 * The cross-entropy method for a rare-event probability.
 *
 * Importance sampling needs a distribution that puts most of its mass where the
 * rare event happens; choosing one by hand is guesswork, and a bad choice gives
 * an estimator with enormous variance that nevertheless returns a plausible
 * number. The cross-entropy method finds one automatically: sample, keep the
 * most extreme fraction, move the sampling distribution towards them, repeat
 * until the extreme fraction clears the real threshold, then estimate with the
 * final tilt and the likelihood ratio.
 *
 * The family searched is the mean shift — exponential tilting of the standard
 * normal. That is a deliberate restriction. Fitting the scale as well looks
 * more general and is what the single-level formula suggests, but far into the
 * tail the likelihood-ratio weights of a narrow fitted distribution grow with
 * the sample value, so one draw takes almost all the weight, the fitted scale
 * collapses, and the search freezes short of the threshold. Set `fitScale` to
 * see that happen; the weight degeneracy is detected and reported rather than
 * left to stall silently.
 *
 * Whatever tilt is found, the final estimate is unbiased, because the
 * likelihood ratio corrects for it. The tilt affects only the variance, which
 * is reported along with the effective sample size.
 */
export function crossEntropyMethod(options: {
  dimension: number;
  performance: PerformanceFunction;
  threshold: number;
  samplesPerIteration?: number;
  eliteFraction?: number;
  maxIterations?: number;
  finalSamples?: number;
  /** Smoothing applied to the parameter update, 1 for none. */
  smoothing?: number;
  /**
   * Also fit the scale of the sampling distribution, not only its mean. Off by
   * default: see the note above on weight degeneracy.
   */
  fitScale?: boolean;
  seed: Seed;
  level?: number;
}): CrossEntropyResult {
  const level = options.level ?? 0.95;
  const d = options.dimension;
  const N = options.samplesPerIteration ?? 2000;
  const rho = options.eliteFraction ?? 0.1;
  const maxIterations = options.maxIterations ?? 40;
  const finalSamples = options.finalSamples ?? 20_000;
  const smoothing = options.smoothing ?? 1;
  if (!Number.isInteger(d) || d < 1) throw new EngineError(`The dimension must be a whole number of at least 1 (got ${d}).`, 'range');
  if (!Number.isInteger(N) || N < 20) throw new EngineError(`The cross-entropy method needs at least 20 samples per iteration (got ${N}).`, 'range');
  if (!(rho > 0 && rho < 1)) throw new EngineError(`The elite fraction must be strictly between 0 and 1 (got ${rho}).`, 'range');
  if (!(smoothing > 0 && smoothing <= 1)) throw new EngineError(`The smoothing factor must be in (0, 1] (got ${smoothing}).`, 'range');
  if (!Number.isInteger(finalSamples) || finalSamples < 100) {
    throw new EngineError(`The final importance-sampling pass needs at least 100 draws (got ${finalSamples}).`, 'range');
  }
  const eliteCount = Math.max(2, Math.round(rho * N));

  const rng = new Random(new Xoshiro128(`${String(options.seed)}\u0000cross-entropy`));
  const mu = new Float64Array(d);
  const sd = new Float64Array(d).fill(1);
  const iterations: CrossEntropyIteration[] = [];
  let totalSamples = 0;
  let reached = false;
  let bestQuantile = Number.NEGATIVE_INFINITY;

  for (let t = 0; t < maxIterations; t++) {
    const draws: Float64Array[] = [];
    const scores = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const x = new Float64Array(d);
      for (let j = 0; j < d; j++) x[j] = mu[j] + sd[j] * rng.normal();
      draws.push(x);
      scores[i] = options.performance(x);
      if (!Number.isFinite(scores[i])) {
        throw new EngineError(`The performance function returned ${scores[i]}; the cross-entropy method cannot rank samples by a non-finite score.`, 'finite');
      }
    }
    totalSamples += N;
    const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const quantile = scores[order[eliteCount - 1]];
    const gamma = Math.min(quantile, options.threshold);
    const elite = order.filter((i) => scores[i] >= gamma);
    // Likelihood-ratio weights carry the elite sample back to the original
    // measure, which is the measure the optimal sampling density is defined
    // against. With a mean-shift-only tilt these weights decrease smoothly in
    // the sample value and stay well conditioned.
    const logWeights = elite.map((i) => logStandardNormal(draws[i]) - logTiltedNormal(draws[i], mu, sd));
    const maxLogWeight = Math.max(...logWeights);
    const weights = logWeights.map((lw) => Math.exp(lw - maxLogWeight));
    const weightTotal = weights.reduce((a, b) => a + b, 0);
    const weightSquares = weights.reduce((a, b) => a + b * b, 0);
    if (!(weightTotal > 0) || !Number.isFinite(weightTotal)) {
      throw new EngineError(
        'The cross-entropy update collapsed: every elite sample has zero or non-finite likelihood-ratio weight, which means the fitted distribution no longer overlaps the original one. No estimate is reported.',
        'numerical',
      );
    }
    const weightEss = (weightTotal * weightTotal) / weightSquares;
    if (weightEss < 2 && elite.length >= 4) {
      throw new EngineError(
        `The cross-entropy update degenerated at iteration ${t}: of ${elite.length} elite samples, the likelihood-ratio weights have an effective sample size of only ${weightEss.toFixed(2)}, so the fitted distribution is being set by one or two draws. Fitting would freeze short of the threshold of ${options.threshold} (the search had reached ${quantile.toPrecision(5)}). No estimate is reported. Turn off fitScale, raise the elite fraction, or use subset simulation, which does not rely on a fitted family.`,
        'degenerate',
      );
    }
    const newMu = new Float64Array(d);
    const newSd = new Float64Array(d);
    for (let j = 0; j < d; j++) {
      let m = 0;
      for (let e = 0; e < elite.length; e++) m += weights[e] * draws[elite[e]][j];
      m /= weightTotal;
      newMu[j] = smoothing * m + (1 - smoothing) * mu[j];
      if (options.fitScale) {
        let v = 0;
        for (let e = 0; e < elite.length; e++) {
          const dj = draws[elite[e]][j] - m;
          v += weights[e] * dj * dj;
        }
        v /= weightTotal;
        newSd[j] = Math.max(1e-6, smoothing * Math.sqrt(Math.max(v, 0)) + (1 - smoothing) * sd[j]);
      } else {
        newSd[j] = 1;
      }
    }
    mu.set(newMu);
    sd.set(newSd);
    iterations.push({
      iteration: t,
      intermediateThreshold: gamma,
      mean: [...mu],
      sd: [...sd],
      eliteCount: elite.length,
    });
    if (quantile >= options.threshold) {
      reached = true;
      break;
    }
    if (quantile <= bestQuantile && t > 3) {
      throw new EngineError(
        `The cross-entropy search stopped advancing at iteration ${t}: the elite quantile moved from ${bestQuantile.toPrecision(5)} to ${quantile.toPrecision(5)}, which is no closer to the threshold of ${options.threshold}. No estimate is reported, because continuing would only produce a confidently wrong number from a sampling distribution that never reaches the rare set.`,
        'stalled',
      );
    }
    bestQuantile = Math.max(bestQuantile, quantile);
  }

  if (!reached) {
    throw new EngineError(
      `The cross-entropy method did not reach the threshold of ${options.threshold} in ${maxIterations} iterations; the last elite quantile was ${iterations[iterations.length - 1].intermediateThreshold}. No estimate is reported, because an importance-sampling estimate from a distribution that never produces the event would be 0 with no stated uncertainty.`,
      'not-reached',
    );
  }

  // Final importance-sampling estimate under the tilt that was found. Zero
  // contributions are counted too: the estimator is the mean over ALL draws.
  let sum = 0;
  let sumSquares = 0;
  let hits = 0;
  for (let i = 0; i < finalSamples; i++) {
    const x = new Float64Array(d);
    for (let j = 0; j < d; j++) x[j] = mu[j] + sd[j] * rng.normal();
    const value = options.performance(x);
    if (value > options.threshold) {
      const w = Math.exp(logStandardNormal(x) - logTiltedNormal(x, mu, sd));
      sum += w;
      sumSquares += w * w;
      hits++;
    }
  }
  totalSamples += finalSamples;
  if (hits === 0) {
    throw new EngineError(
      `The final importance-sampling pass of ${finalSamples.toLocaleString('en-US')} draws produced no occurrences of the event, even under the fitted tilt. No probability is reported: 0 is not the answer, and the fitted distribution evidently does not cover the rare set. Increase the sample size per iteration or reduce the elite fraction.`,
      'not-observed',
    );
  }
  const estimate = sum / finalSamples;
  const variance = Math.max(0, (sumSquares / finalSamples - estimate * estimate) / finalSamples);
  const standardError = Math.sqrt(variance);
  const cv = estimate > 0 ? standardError / estimate : Number.POSITIVE_INFINITY;
  const z = zFor(level);
  return {
    method: `Cross-entropy importance sampling over the mean-shift family: ${iterations.length} fitting iteration(s) of ${N} samples, then ${finalSamples.toLocaleString('en-US')} draws from the fitted tilt`,
    iterations,
    estimate,
    standardError,
    interval: {
      low: Math.max(0, estimate - z * standardError),
      high: estimate + z * standardError,
      level,
      method: 'Normal-approximation interval on the importance-sampling estimator',
    },
    coefficientOfVariation: cv,
    effectiveSampleSize: variance > 0 ? (estimate * (1 - estimate)) / variance : Number.POSITIVE_INFINITY,
    finalSamples,
    totalSamples,
    reachedThreshold: true,
    message: `The probability is estimated as ${estimate.toExponential(4)} ± ${standardError.toExponential(2)} (coefficient of variation ${(100 * cv).toFixed(2)}%), from a sampling distribution centred at ${[...mu].map((m) => m.toFixed(3)).join(', ')} with spread ${[...sd].map((v) => v.toFixed(3)).join(', ')}. The event occurred in ${hits.toLocaleString('en-US')} of ${finalSamples.toLocaleString('en-US')} tilted draws; plain Monte Carlo would have needed about ${Math.round(1 / estimate).toLocaleString('en-US')} draws to see it once, and that ratio is the whole gain.`,
    exactness: 'empirical',
  };
}

function logStandardNormal(x: Float64Array): number {
  let s = 0;
  for (let j = 0; j < x.length; j++) s += x[j] * x[j];
  return -0.5 * s - 0.5 * x.length * Math.log(2 * Math.PI);
}

function logTiltedNormal(x: Float64Array, mu: Float64Array, sd: Float64Array): number {
  let s = 0;
  for (let j = 0; j < x.length; j++) {
    const z = (x[j] - mu[j]) / sd[j];
    s += z * z + 2 * Math.log(sd[j]);
  }
  return -0.5 * s - 0.5 * x.length * Math.log(2 * Math.PI);
}
