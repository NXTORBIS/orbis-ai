/**
 * Bayesian optimisation on top of the Gaussian-process posterior.
 *
 * The GP's calibrated uncertainty is what makes this possible: an acquisition
 * function trades off the posterior MEAN (go where the model thinks the
 * optimum is) against the posterior VARIANCE (go where the model does not
 * know), which is why Bayesian optimisation finds good points in tens of
 * evaluations where a grid search needs thousands.
 *
 * ## Conventions
 *
 * Everything here MINIMISES the objective. Acquisition values are always
 * "higher is better", so the search maximises the acquisition and minimises
 * the objective.
 *
 * ## The honest caveats, stated up front
 *
 *  - Bayesian optimisation gives **no guarantee whatsoever** of finding a
 *    global optimum in a finite number of evaluations. The regret bounds that
 *    exist (for GP-UCB, Srinivas et al. 2010) hold only under assumptions
 *    about the kernel and the function that cannot be checked from data, and
 *    they are asymptotic. A run that has not found the optimum looks exactly
 *    like a run that has.
 *  - With noisy observations, the best OBSERVED value is a biased estimate of
 *    the best achievable value: the minimum of n noisy draws is usually a
 *    lucky draw, and reporting it overstates the result. This module reports
 *    the best POSTERIOR MEAN as its recommendation and reports the best
 *    observation separately, labelled as optimistic.
 *  - The acquisition maximisation is itself a global optimisation problem,
 *    solved here approximately (low-discrepancy candidates plus multi-start
 *    local search). It is `numerical`.
 */
import { EngineError } from '../core/result';
import { normalCdf, normalPdf } from '../special/gamma';
import { Random } from '../random/rng';
import { SobolSequence } from '../qmc/sobol';
import { DEFAULT_KERNEL_ID, kernel as kernelSpecs, type KernelSpec } from './kernels';
import {
  conditionGp,
  covarianceMatrix,
  fitHyperparameters,
  predictGp,
  samplePosteriorFunctions,
  type GpModel,
} from './regression';

export type Box = readonly (readonly [number, number])[];

export type AcquisitionSpec =
  | { readonly kind: 'expected-improvement'; readonly xi?: number }
  | { readonly kind: 'probability-of-improvement'; readonly xi?: number }
  | { readonly kind: 'lower-confidence-bound'; readonly beta?: number; readonly delta?: number }
  | { readonly kind: 'thompson' }
  | { readonly kind: 'knowledge-gradient' };

export const ACQUISITION_NOTES: Readonly<Record<AcquisitionSpec['kind'], string>> = {
  'expected-improvement':
    'Expected improvement: E[max(f* − f(x), 0)] in closed form, (f* − μ)Φ(z) + σφ(z) with z = (f* − μ)/σ. It is exactly ' +
    '0 where the posterior is certain and no better than the incumbent, and never negative. Balanced and the usual ' +
    'default, but it is known to under-explore when the GP is over-confident.',
  'probability-of-improvement':
    'Probability of improvement: Φ((f* − μ)/σ). It asks only whether an improvement is likely, not how large, so it ' +
    'is strongly exploitative and tends to cluster around the incumbent.',
  'lower-confidence-bound':
    'Lower confidence bound: choose the minimiser of μ − √β·σ. β is the explicit exploration dial — larger β buys ' +
    'exploration at the cost of spending evaluations far from the optimum. The schedule β_t = 2·log(t^(d/2+2)·π²/3δ) ' +
    '(Srinivas et al. 2010) grows β with the iteration count, which is what their regret bound requires; a fixed β ' +
    '(commonly 2, i.e. about two standard deviations) is more aggressive early and explores less later.',
  thompson:
    'Thompson sampling: draw ONE function from the posterior over the candidate set and go to its minimum. Exploration ' +
    'comes from the randomness of the draw rather than from a tuning constant, which makes it attractive for batches; ' +
    'it is empirical (a different seed gives a different suggestion).',
  'knowledge-gradient':
    'Knowledge gradient: the expected improvement in the best POSTERIOR MEAN after one more observation, computed ' +
    'exactly over a finite candidate set (Frazier, Powell & Dayanik, 2009). Unlike expected improvement it values a ' +
    'measurement for what it teaches about the whole function, which is the right criterion under observation noise — ' +
    'but it is restricted to the candidate set and costs O(m² log m).',
};

/* ------------------------------------------------------------------ *
 * Acquisition functions
 * ------------------------------------------------------------------ */

export interface AcquisitionInput {
  readonly mean: number;
  readonly sd: number;
  /** Incumbent: the value to improve on (lowest so far, or best posterior mean). */
  readonly incumbent: number;
}

/**
 * Expected improvement for MINIMISATION, in closed form.
 *
 *     EI(x) = (f* − ξ − μ)·Φ(z) + σ·φ(z),   z = (f* − ξ − μ)/σ
 *
 * At σ = 0 the closed form degenerates to max(f* − ξ − μ, 0): zero when the
 * mean is no better than the incumbent, which is the correct limit and is
 * asserted in the tests.
 */
export function expectedImprovement(input: AcquisitionInput, xi = 0): number {
  const gap = input.incumbent - xi - input.mean;
  if (!(input.sd > 0)) return Math.max(gap, 0);
  const z = gap / input.sd;
  const value = gap * normalCdf(z) + input.sd * normalPdf(z);
  // The closed form is non-negative mathematically; rounding can produce a
  // value like −1e−300, which is reported as 0 rather than as a negative
  // expected improvement.
  return value > 0 ? value : 0;
}

export function probabilityOfImprovement(input: AcquisitionInput, xi = 0): number {
  const gap = input.incumbent - xi - input.mean;
  if (!(input.sd > 0)) return gap > 0 ? 1 : 0;
  return normalCdf(gap / input.sd);
}

/**
 * β for the lower-confidence-bound schedule of Srinivas et al. (2010):
 * β_t = 2·log(t^(d/2+2)·π²/(3δ)). It grows with the iteration, which is what
 * makes the cumulative-regret bound hold; the price is that late iterations
 * explore more than a practitioner usually wants.
 */
export function ucbBeta(iteration: number, dimension: number, delta = 0.1): number {
  const t = Math.max(iteration, 1);
  return 2 * Math.log((Math.pow(t, dimension / 2 + 2) * Math.PI * Math.PI) / (3 * delta));
}

export function lowerConfidenceBound(input: AcquisitionInput, beta: number): number {
  // Higher is better, so return the negated LCB.
  return -(input.mean - Math.sqrt(beta) * input.sd);
}

/**
 * E[maxᵢ(aᵢ + bᵢ·Z)] for Z ~ N(0,1), exactly, by building the upper envelope
 * of the lines and integrating each segment. Frazier, Powell & Dayanik (2009).
 */
export function expectedMaxOfLines(a: readonly number[], b: readonly number[]): number {
  const m = a.length;
  if (m === 0) throw new EngineError('No alternatives were supplied.', 'required');
  if (b.length !== m) throw new EngineError('The slope and intercept lists must have the same length.', 'length');
  const order = Array.from({ length: m }, (_, i) => i).sort((i, j) => (b[i] - b[j]) || a[i] - a[j]);
  // Keep only the lines on the upper envelope.
  const keepA: number[] = [];
  const keepB: number[] = [];
  const cuts: number[] = [];
  for (const idx of order) {
    const ai = a[idx];
    const bi = b[idx];
    if (keepA.length > 0 && bi === keepB[keepB.length - 1]) {
      if (ai <= keepA[keepA.length - 1]) continue;
      keepA.pop();
      keepB.pop();
      cuts.pop();
    }
    for (;;) {
      if (keepA.length === 0) {
        keepA.push(ai);
        keepB.push(bi);
        cuts.push(Number.NEGATIVE_INFINITY);
        break;
      }
      const last = keepA.length - 1;
      const cut = (keepA[last] - ai) / (bi - keepB[last]);
      if (cut <= cuts[last]) {
        keepA.pop();
        keepB.pop();
        cuts.pop();
        continue;
      }
      keepA.push(ai);
      keepB.push(bi);
      cuts.push(cut);
      break;
    }
  }
  let total = 0;
  for (let i = 0; i < keepA.length; i++) {
    const lo = cuts[i];
    const hi = i + 1 < cuts.length ? cuts[i + 1] : Number.POSITIVE_INFINITY;
    const Phi = (z: number): number => (z === Number.NEGATIVE_INFINITY ? 0 : z === Number.POSITIVE_INFINITY ? 1 : normalCdf(z));
    const phi = (z: number): number => (Number.isFinite(z) ? normalPdf(z) : 0);
    total += keepA[i] * (Phi(hi) - Phi(lo)) + keepB[i] * (phi(lo) - phi(hi));
  }
  return total;
}

/**
 * Discrete knowledge gradient of measuring at x, over a finite candidate set.
 *
 * After one noisy observation at x, the posterior mean at candidate i becomes
 * μᵢ + σ̃ᵢ(x)·Z with σ̃ᵢ(x) = Cov(fᵢ, f_x)/√(Var[f_x] + σ²_noise). The value of
 * the measurement is the expected improvement in min μ, which is
 * min μ − E[minᵢ(μᵢ + σ̃ᵢZ)] — computed exactly by `expectedMaxOfLines`.
 */
export function knowledgeGradient(
  means: readonly number[],
  tilde: readonly number[],
): number {
  const best = Math.min(...means);
  // E[min(a + bZ)] = −E[max(−a − bZ)].
  const expectedMin = -expectedMaxOfLines(means.map((v) => -v), tilde.map((v) => -v));
  const value = best - expectedMin;
  return value > 0 ? value : 0;
}

/* ------------------------------------------------------------------ *
 * Acquisition maximisation over a box
 * ------------------------------------------------------------------ */

export interface CandidateOptions {
  readonly count?: number;
  readonly source?: 'sobol' | 'random';
  readonly seed?: string;
}

export function validateBox(bounds: Box): void {
  if (bounds.length === 0) throw new EngineError('The search box must have at least one dimension.', 'required');
  bounds.forEach((b, i) => {
    if (!Number.isFinite(b[0]) || !Number.isFinite(b[1])) {
      throw new EngineError(`Bound ${i} must be finite; received [${b[0]}, ${b[1]}].`, 'finite');
    }
    if (!(b[1] > b[0])) {
      throw new EngineError(`Bound ${i} is empty: the upper limit ${b[1]} must exceed the lower limit ${b[0]}.`, 'range');
    }
  });
}

/**
 * Candidate inputs filling the box.
 *
 * Sobol points (from `src/engine/qmc/`) cover the box far more evenly than
 * random ones at the same count, which matters because the candidate set is
 * the only global part of the acquisition search.
 */
export function candidateSet(bounds: Box, options: CandidateOptions = {}): number[][] {
  validateBox(bounds);
  const count = options.count ?? 512;
  if (!Number.isInteger(count) || count < 1) {
    throw new EngineError(`The candidate count must be a whole number of at least 1; received ${count}.`, 'range');
  }
  const d = bounds.length;
  const out: number[][] = [];
  if ((options.source ?? 'sobol') === 'sobol') {
    const seq = new SobolSequence({ dimension: d, randomisation: 'digital-shift', seed: options.seed ?? 'bo' });
    const buf = new Float64Array(d);
    for (let i = 0; i < count; i++) {
      seq.fill(i + 1, buf);
      out.push(Array.from(buf, (u, j) => bounds[j][0] + u * (bounds[j][1] - bounds[j][0])));
    }
    return out;
  }
  const rng = new Random(`gp:candidates:${options.seed ?? 'bo'}`);
  for (let i = 0; i < count; i++) {
    out.push(bounds.map((b) => b[0] + rng.uniform() * (b[1] - b[0])));
  }
  return out;
}

export interface AcquisitionSearch {
  readonly x: readonly number[];
  readonly value: number;
  readonly candidatesEvaluated: number;
  readonly localRefinements: number;
  readonly exactness: 'numerical';
  readonly spread: readonly [number, number];
}

/**
 * Maximise a scalar acquisition over the box: low-discrepancy candidates, then
 * a shrinking pattern search from the best few.
 *
 * Refuses when the acquisition is flat to working precision over the whole
 * candidate set. A flat acquisition means the model has nothing to say about
 * where to look, and returning an arbitrary point as if it were a suggestion
 * would be a fabricated answer. The usual causes are a length scale so long
 * that every point looks identical, or an expected improvement that has
 * underflowed everywhere because the incumbent is already far better than the
 * posterior allows.
 */
export function maximiseAcquisition(
  acquisition: (x: readonly number[]) => number,
  bounds: Box,
  options: CandidateOptions & { readonly restarts?: number; readonly localSteps?: number } = {},
): AcquisitionSearch {
  const candidates = candidateSet(bounds, options);
  const values = candidates.map((x) => acquisition(x));
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new EngineError(
        `The acquisition function returned ${values[i]} at candidate ${i}. A non-finite acquisition cannot be maximised and no suggestion is produced.`,
        'numerical',
      );
    }
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  // Flatness is judged RELATIVE to the acquisition's own scale. An expected
  // improvement of 1e−73 that still varies by orders of magnitude across the
  // box is informative; a constant is not, whatever its size.
  if (hi === lo || hi - lo <= 1e-12 * Math.abs(hi)) {
    throw new EngineError(
      `The acquisition function is flat across all ${candidates.length} candidates (every value is ${hi.toExponential(3)} ` +
        'to within working precision), so it does not prefer any point in the box. No suggestion is produced. Common ' +
        'causes: a fitted length scale far longer than the box, an expected improvement that has underflowed because ' +
        'the incumbent is unreachable under the posterior, or a signal variance of effectively zero.',
      'flat-acquisition',
    );
  }
  const restarts = options.restarts ?? 5;
  const localSteps = options.localSteps ?? 40;
  const ranked = candidates
    .map((x, i) => ({ x, v: values[i] }))
    .sort((a, b) => b.v - a.v)
    .slice(0, Math.max(1, restarts));
  let bestX = ranked[0].x;
  let bestV = ranked[0].v;
  let refinements = 0;
  for (const start of ranked) {
    let x = Array.from(start.x);
    let v = start.v;
    let step = bounds.map((b) => (b[1] - b[0]) / 8);
    for (let s = 0; s < localSteps; s++) {
      let improved = false;
      for (let j = 0; j < bounds.length; j++) {
        for (const sign of [1, -1]) {
          const trial = Array.from(x);
          trial[j] = Math.min(Math.max(trial[j] + sign * step[j], bounds[j][0]), bounds[j][1]);
          if (trial[j] === x[j]) continue;
          const tv = acquisition(trial);
          refinements++;
          if (tv > v) {
            x = trial;
            v = tv;
            improved = true;
          }
        }
      }
      if (!improved) {
        step = step.map((h) => h / 2);
        if (step.every((h, j) => h < 1e-10 * (bounds[j][1] - bounds[j][0]))) break;
      }
    }
    if (v > bestV) {
      bestV = v;
      bestX = x;
    }
  }
  return {
    x: bestX,
    value: bestV,
    candidatesEvaluated: candidates.length,
    localRefinements: refinements,
    exactness: 'numerical',
    spread: [lo, hi],
  };
}

/* ------------------------------------------------------------------ *
 * The optimisation loop
 * ------------------------------------------------------------------ */

export interface ConstraintSpec {
  readonly name: string;
  /** Measured constraint value; feasible when it is ≤ threshold. */
  readonly evaluate: (x: readonly number[]) => number;
  readonly threshold: number;
  readonly noiseVariance?: number;
}

export type BatchStrategy = 'kriging-believer' | 'local-penalisation';

export interface BayesOptRequest {
  readonly objective: (x: readonly number[]) => number;
  readonly bounds: Box;
  readonly iterations: number;
  readonly seed: string;
  readonly acquisition?: AcquisitionSpec;
  readonly kernel?: KernelSpec;
  /** Noise variance of the objective. 0 declares the objective noise-free. */
  readonly noiseVariance?: number;
  /** Initial design size; defaults to 2·d + 2. */
  readonly initialDesign?: number;
  readonly initialPoints?: readonly (readonly number[])[];
  /** Refit the hyperparameters every k iterations (0 never refits). */
  readonly refitEvery?: number;
  readonly fitRestarts?: number;
  readonly batchSize?: number;
  readonly batchStrategy?: BatchStrategy;
  readonly constraints?: readonly ConstraintSpec[];
  /** Known optimal objective value, for reporting simple regret in tests. */
  readonly knownOptimum?: number;
  readonly candidates?: CandidateOptions;
  readonly maxEvaluations?: number;
}

export interface Observation {
  readonly x: readonly number[];
  readonly y: number;
  readonly iteration: number;
  readonly source: 'initial-design' | 'acquisition';
  readonly constraints?: readonly number[];
  readonly feasible: boolean;
}

export interface BayesOptProgress {
  readonly iteration: number;
  readonly iterations: number;
  readonly evaluations: number;
  readonly suggested: readonly (readonly number[])[];
  readonly acquisitionValue: number;
  readonly bestObserved: Observation;
  readonly bestPosteriorMean: { readonly x: readonly number[]; readonly mean: number; readonly sd: number };
  readonly logMarginalLikelihood: number;
  readonly refitted: boolean;
}

export interface BayesOptResult {
  readonly observations: readonly Observation[];
  readonly model: GpModel;
  /** Lowest value actually measured. Optimistic under noise. */
  readonly bestObserved: Observation;
  /**
   * The input whose POSTERIOR MEAN is lowest among those evaluated, with that
   * mean. This is the recommendation under noise.
   */
  readonly bestPosteriorMean: { readonly x: readonly number[]; readonly mean: number; readonly sd: number };
  readonly recommendation: { readonly x: readonly number[]; readonly value: number; readonly basis: string };
  /** Simple regret against a known optimum, when one was supplied. */
  readonly simpleRegret: number | null;
  readonly acquisition: AcquisitionSpec['kind'];
  readonly acquisitionNote: string;
  readonly evaluations: number;
  /** Set when the loop stopped before its iteration budget, with the reason. */
  readonly stoppedEarly: { readonly iteration: number; readonly reason: string } | null;
  readonly exactness: 'empirical';
  readonly warnings: readonly string[];
  readonly limitations: readonly string[];
  readonly history: readonly { readonly iteration: number; readonly bestObserved: number; readonly bestPosteriorMean: number }[];
}

function initialDesign(req: BayesOptRequest): number[][] {
  validateBox(req.bounds);
  if (req.initialPoints) {
    return req.initialPoints.map((p) => {
      if (p.length !== req.bounds.length) {
        throw new EngineError(`An initial point has ${p.length} coordinates but the box has ${req.bounds.length}.`, 'length');
      }
      return Array.from(p);
    });
  }
  const size = req.initialDesign ?? 2 * req.bounds.length + 2;
  if (!Number.isInteger(size) || size < 2) {
    throw new EngineError(
      `The initial design must have at least 2 points (a GP fitted to one point cannot estimate a length scale); received ${size}.`,
      'range',
    );
  }
  return candidateSet(req.bounds, { count: size, source: 'sobol', seed: `${req.seed}:design` });
}

/**
 * Bayesian optimisation as a GENERATOR that yields between iterations.
 *
 * This mirrors `simulationSteps` in `src/engine/simulation/runner.ts` and for
 * the same reason: a worker blocked inside a synchronous loop can never
 * receive a cancel message. Yielding between iterations is what makes a long
 * optimisation interruptible.
 *
 * ## Internal scaling
 *
 * The surrogate is fitted on STANDARDISED data: inputs mapped to the unit
 * box and targets to zero mean and unit variance. Without that, a GP fitted
 * to an objective whose values run to the hundreds and whose box is tens of
 * units wide routinely degenerates — the length scale collapses or the signal
 * variance runs away, the acquisition goes flat, and the run has to be
 * abandoned. Everything reported to the caller is converted back to the
 * original units; the standardisation is an implementation detail, not a
 * change of problem.
 */
export function* bayesOptSteps(req: BayesOptRequest): Generator<BayesOptProgress, BayesOptResult, void> {
  validateBox(req.bounds);
  if (!Number.isInteger(req.iterations) || req.iterations < 1) {
    throw new EngineError(`The iteration count must be a whole number of at least 1; received ${req.iterations}.`, 'range');
  }
  const d = req.bounds.length;
  const acq: AcquisitionSpec = req.acquisition ?? { kind: 'expected-improvement' };
  const noise = req.noiseVariance ?? 0;
  if (!(noise >= 0) || !Number.isFinite(noise)) {
    throw new EngineError(`The objective noise variance must be a finite number of 0 or more; received ${noise}.`, 'range');
  }
  const batchSize = req.batchSize ?? 1;
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new EngineError(`The batch size must be a whole number of at least 1; received ${batchSize}.`, 'range');
  }
  const spec: KernelSpec = req.kernel ?? kernelSpecs.base(DEFAULT_KERNEL_ID);
  const maxEvaluations = req.maxEvaluations ?? 400;
  const warnings: string[] = [];
  const rng = new Random(`gp:bo:${req.seed}`);

  const unitBounds: Box = Array.from({ length: d }, () => [0, 1] as const);
  const toUnit = (x: readonly number[]): number[] =>
    x.map((v, j) => (v - req.bounds[j][0]) / (req.bounds[j][1] - req.bounds[j][0]));
  const fromUnit = (u: readonly number[]): number[] =>
    u.map((v, j) => req.bounds[j][0] + v * (req.bounds[j][1] - req.bounds[j][0]));

  const observations: Observation[] = [];
  const evaluate = (x: readonly number[], iteration: number, source: Observation['source']): Observation => {
    const y = req.objective(x);
    if (!Number.isFinite(y)) {
      throw new EngineError(
        `The objective returned ${y} at (${x.map((v) => v.toPrecision(6)).join(', ')}). Bayesian optimisation cannot ` +
          'proceed on a non-finite observation; nothing is substituted for it.',
        'numerical',
      );
    }
    const constraintValues = req.constraints?.map((c) => c.evaluate(x));
    if (constraintValues?.some((v) => !Number.isFinite(v))) {
      throw new EngineError('A constraint returned a non-finite value; the run cannot continue on it.', 'numerical');
    }
    const feasible = !req.constraints || req.constraints.every((c, i) => (constraintValues as number[])[i] <= c.threshold);
    return { x: Array.from(x), y, iteration, source, constraints: constraintValues, feasible };
  };

  for (const x of initialDesign(req)) observations.push(evaluate(x, 0, 'initial-design'));
  if (observations.length + req.iterations * batchSize > maxEvaluations) {
    throw new EngineError(
      `This run would spend ${observations.length + req.iterations * batchSize} objective evaluations, beyond the ` +
        `maxEvaluations limit of ${maxEvaluations}. Each iteration also costs an O(n³) GP refit, so the cost grows ` +
        'super-linearly. Raise maxEvaluations deliberately if that is intended.',
      'size',
    );
  }

  /** Mean and standard deviation used to standardise a list of values. */
  const statsOf = (values: readonly number[]): { centre: number; scale: number } => {
    const centre = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - centre) ** 2, 0) / Math.max(values.length - 1, 1);
    // A scale of 0 (every value identical) would divide by zero; 1 leaves the
    // values as deviations from their common value, which is correct.
    return { centre, scale: variance > 0 ? Math.sqrt(variance) : 1 };
  };

  let kernelValues: number[] | undefined;
  let yStats = statsOf(observations.map((o) => o.y));
  // The noise variance is in the objective's own units; the surrogate works
  // on standardised targets, so it is divided by the target variance.
  const scaledNoise = (): number => noise / (yStats.scale * yStats.scale);
  let fittedNoise = scaledNoise();

  const buildModel = (obs: readonly Observation[], values: readonly number[] | undefined, noiseVariance: number): GpModel =>
    conditionGp({
      X: obs.map((o) => toUnit(o.x)),
      y: obs.map((o) => (o.y - yStats.centre) / yStats.scale),
      kernel: spec,
      kernelValues: values,
      noiseVariance,
      mean: { kind: 'constant' },
    });

  const refitEvery = req.refitEvery ?? 1;
  let model = buildModel(observations, kernelValues, fittedNoise);
  const history: { iteration: number; bestObserved: number; bestPosteriorMean: number }[] = [];
  let stoppedEarly: { iteration: number; reason: string } | null = null;

  /** The evaluated input whose posterior mean is lowest, in original units. */
  const posteriorBest = (m: GpModel, obs: readonly Observation[]): { x: number[]; mean: number; sd: number } => {
    const feasible = obs.filter((o) => o.feasible);
    const pool = feasible.length ? feasible : obs;
    const preds = predictGp(m, pool.map((o) => toUnit(o.x))).predictions;
    let bi = 0;
    for (let i = 1; i < preds.length; i++) if (preds[i].mean < preds[bi].mean) bi = i;
    return {
      x: Array.from(pool[bi].x),
      mean: preds[bi].mean * yStats.scale + yStats.centre,
      sd: preds[bi].latentSd * yStats.scale,
    };
  };

  for (let iteration = 1; iteration <= req.iterations; iteration++) {
    yStats = statsOf(observations.map((o) => o.y));
    fittedNoise = scaledNoise();
    let refitted = false;
    if (refitEvery > 0 && (iteration - 1) % refitEvery === 0 && observations.length >= Math.max(4, d + 2)) {
      try {
        const fit = fitHyperparameters(
          {
            X: observations.map((o) => toUnit(o.x)),
            y: observations.map((o) => (o.y - yStats.centre) / yStats.scale),
            kernel: spec,
            noiseVariance: noise > 0 ? scaledNoise() : 1e-6,
            mean: { kind: 'constant' },
          },
          {
            restarts: req.fitRestarts ?? 4,
            seed: `${req.seed}:fit:${iteration}`,
            fitNoise: noise > 0,
            // On the standardised scale a length scale below 1/1000 of the box
            // or a variance above 1000 is a degenerate fit, not a discovery.
            logBounds: [Math.log(1e-3), Math.log(1e3)],
          },
        );
        kernelValues = Array.from(fit.model.kernel.values);
        fittedNoise = fit.model.noiseVariance;
        refitted = true;
        if (!fit.fit.identifiable) {
          warnings.push(
            `Iteration ${iteration}: the hyperparameter fit was not identified (${fit.fit.note}). The suggestions that ` +
              'follow depend on a poorly determined model.',
          );
        }
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        warnings.push(
          `Iteration ${iteration}: the hyperparameter refit failed (${e.message}). The previous hyperparameters were kept.`,
        );
      }
    }
    model = buildModel(observations, kernelValues, fittedNoise);

    // Constraint surrogates, one standardised GP per constraint.
    const constraintStats = (req.constraints ?? []).map((_, ci) =>
      statsOf(observations.map((o) => (o.constraints as number[])[ci])),
    );
    const constraintModels = (req.constraints ?? []).map((c, ci) =>
      conditionGp({
        X: observations.map((o) => toUnit(o.x)),
        y: observations.map((o) => ((o.constraints as number[])[ci] - constraintStats[ci].centre) / constraintStats[ci].scale),
        kernel: spec,
        kernelValues,
        noiseVariance: Math.max((c.noiseVariance ?? 0) / constraintStats[ci].scale ** 2, 1e-8),
        mean: { kind: 'constant' },
      }),
    );

    // Incumbent. Under noise the best observation is a lucky draw, so the
    // incumbent is the best POSTERIOR MEAN instead.
    const feasibleObs = observations.filter((o) => o.feasible);
    if (feasibleObs.length === 0) {
      warnings.push(
        `Iteration ${iteration}: no observation is feasible yet, so the incumbent is taken from the infeasible points ` +
          'and the expected improvement is dominated by the probability of feasibility.',
      );
    }
    const pBest = posteriorBest(model, observations);
    const bestObsSoFar = (feasibleObs.length ? feasibleObs : observations).reduce((a, b) => (b.y < a.y ? b : a));
    const incumbentOriginal = noise > 0 ? pBest.mean : bestObsSoFar.y;
    let incumbent = (incumbentOriginal - yStats.centre) / yStats.scale;

    const chosen: number[][] = [];
    let acquisitionValue = 0;
    let workingModel = model;
    const workingObs = observations.slice();
    try {
    for (let b = 0; b < batchSize; b++) {
      const scalar = (u: readonly number[]): number => {
        const p = predictGp(workingModel, [u]).predictions[0];
        const base = acquisitionAt(acq, { mean: p.mean, sd: p.latentSd, incumbent }, iteration, d);
        const feasibility = constraintModels.reduce((acc, cm, ci) => {
          const cp = predictGp(cm, [u]).predictions[0];
          const thr =
            ((req.constraints as ConstraintSpec[])[ci].threshold - constraintStats[ci].centre) / constraintStats[ci].scale;
          const sd = Math.max(cp.latentSd, 1e-12);
          return acc * normalCdf((thr - cp.mean) / sd);
        }, 1);
        // Points already chosen in this batch are penalised. Under local
        // penalisation that is the whole mechanism, with a radius of a tenth
        // of the box. Under the Kriging believer the model already accounts
        // for the chosen points, so the radius is tiny and the factor acts
        // only as a guard against suggesting the very same input twice —
        // which the believer alone does not rule out, because a believed
        // value better than the incumbent keeps its own location attractive.
        const radius = (req.batchStrategy ?? 'kriging-believer') === 'local-penalisation' ? 0.1 : 1e-3;
        let penalty = 1;
        for (const c of chosen) {
          let s = 0;
          const cu = toUnit(c);
          for (let j = 0; j < d; j++) s += ((u[j] - cu[j]) / radius) ** 2;
          penalty *= 1 - Math.exp(-0.5 * s);
        }
        return base * feasibility * penalty;
      };
      let suggestion: number[];
      if (acq.kind === 'thompson' || acq.kind === 'knowledge-gradient') {
        suggestion = fromUnit(
          discreteSuggestion(acq, workingModel, req, unitBounds, iteration, chosen.map(toUnit), rng, incumbent),
        );
      } else {
        const search = maximiseAcquisition(scalar, unitBounds, {
          ...req.candidates,
          seed: `${req.seed}:acq:${iteration}:${b}`,
        });
        suggestion = fromUnit(search.x);
        if (b === 0) acquisitionValue = search.value;
      }
      chosen.push(suggestion);
      if (batchSize > 1 && (req.batchStrategy ?? 'kriging-believer') === 'kriging-believer') {
        // Kriging believer: pretend the posterior mean was measured there, so
        // the next batch member sees the reduced uncertainty. It is a
        // heuristic — the pseudo-observation is not data.
        const already = workingObs.some((o) => o.x.every((v, j) => v === suggestion[j]));
        if (!already) {
          const p = predictGp(workingModel, [toUnit(suggestion)]).predictions[0];
          workingObs.push({
            x: suggestion,
            y: p.mean * yStats.scale + yStats.centre,
            iteration,
            source: 'acquisition',
            constraints: req.constraints?.map(() => Number.NEGATIVE_INFINITY),
            feasible: true,
          });
          // The pseudo-observation sits where the posterior is already almost
          // determined, so the working model is given a small floor on its
          // noise variance to stay well conditioned. It is a scratch model
          // used only to pick the rest of the batch; the reported model is
          // always built from real observations alone.
          workingModel = buildModel(workingObs, kernelValues, Math.max(fittedNoise, 1e-6));
          // The incumbent must move with the believed observation too. Without
          // that, a believed value better than the incumbent keeps the same
          // point at the top of the acquisition and the whole batch collapses
          // onto one input.
          const pool = workingObs.filter((o) => o.feasible);
          const bestNow = (pool.length ? pool : workingObs).reduce((a, b) => (b.y < a.y ? b : a));
          incumbent = (Math.min(incumbentOriginal, bestNow.y) - yStats.centre) / yStats.scale;
        }
      }
    }

    } catch (e) {
      // A flat acquisition is a refusal from `maximiseAcquisition`, and it is
      // a meaningful one: the model prefers no point in the box, which under
      // expected improvement means it expects no improvement anywhere (and
      // under a constraint, none that is also feasible). The run STOPS and
      // says so, with the result built from the evaluations actually made.
      // The error is reported, not swallowed.
      if (e instanceof EngineError && e.issues.some((i) => i.code === 'flat-acquisition')) {
        stoppedEarly = {
          iteration,
          reason:
            `Stopped at iteration ${iteration} of ${req.iterations}: the acquisition function no longer prefers any ` +
            `point in the box (${e.message}). The result below uses the ${observations.length} evaluations already ` +
            'made; it is NOT a claim that the optimum has been found.',
        };
        warnings.push(stoppedEarly.reason);
        break;
      }
      throw e;
    }
    for (const x of chosen) observations.push(evaluate(x, iteration, 'acquisition'));
    yStats = statsOf(observations.map((o) => o.y));
    model = buildModel(observations, kernelValues, fittedNoise);
    const newBestObs = observations.reduce((a, b) => (b.y < a.y ? b : a));
    const newPBest = posteriorBest(model, observations);
    history.push({ iteration, bestObserved: newBestObs.y, bestPosteriorMean: newPBest.mean });
    yield {
      iteration,
      iterations: req.iterations,
      evaluations: observations.length,
      suggested: chosen,
      acquisitionValue,
      bestObserved: newBestObs,
      bestPosteriorMean: newPBest,
      logMarginalLikelihood: model.logMarginalLikelihood,
      refitted,
    };
  }

  const bestObserved = observations.reduce((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? a : b;
    return b.y < a.y ? b : a;
  });
  const bestPosteriorMean = posteriorBest(model, observations);
  const noisy = (req.noiseVariance ?? 0) > 0;
  return {
    observations,
    model,
    bestObserved,
    bestPosteriorMean,
    recommendation: noisy
      ? {
          x: bestPosteriorMean.x,
          value: bestPosteriorMean.mean,
          basis:
            'Best POSTERIOR MEAN among the evaluated points. With noisy observations the lowest measured value is ' +
            'usually a lucky draw and reporting it would overstate the result; the posterior mean averages the noise ' +
            'out using every observation.',
        }
      : {
          x: bestObserved.x,
          value: bestObserved.y,
          basis: 'Best observed value. The objective was declared noise-free, so the measurement is the value.',
        },
    simpleRegret:
      req.knownOptimum === undefined
        ? null
        : (noisy ? bestPosteriorMean.mean : bestObserved.y) - req.knownOptimum,
    acquisition: acq.kind,
    acquisitionNote: ACQUISITION_NOTES[acq.kind],
    stoppedEarly,
    evaluations: observations.length,
    exactness: 'empirical',
    warnings,
    limitations: [
      'Bayesian optimisation gives NO guarantee of finding a global optimum in a finite number of evaluations. The ' +
        'result is the best point this run happened to find; a run that stopped short of the optimum is indistinguishable ' +
        'from one that found it.',
      'The suggestions depend on the GP’s hyperparameters, which are themselves estimated from very few points early on. ' +
        'An over-long fitted length scale makes the search exploit a model that does not know the function yet.',
      'The acquisition maximisation is approximate (low-discrepancy candidates plus local search), so a better point ' +
        'inside the box may have been missed at every iteration.',
      ...(batchSize > 1
        ? [
            (req.batchStrategy ?? 'kriging-believer') === 'kriging-believer'
              ? 'Batch suggestions came from the Kriging believer, which substitutes the posterior mean for the ' +
                'un-measured points. That pseudo-observation is not data, and the believer tends to place later batch ' +
                'members very close to earlier ones; local penalisation spreads a batch out more.'
              : 'Batch suggestions came from local penalisation, which multiplies the acquisition by a penaliser around ' +
                'each point already chosen. The penaliser radius is a heuristic, not an estimate of anything.',
          ]
        : []),
      'The surrogate is fitted to standardised inputs and targets. That is a numerical convenience and does not change ' +
        'the problem, but it does mean the fitted length scales are in units of the box width.',
      noisy
        ? 'Under noise, the best observed value is reported separately and is OPTIMISTIC; the recommendation uses the posterior mean.'
        : 'The objective was treated as noise-free. If it is in fact noisy, the fit will interpolate noise and the suggestions will be poor.',
      ...(req.constraints?.length
        ? [
            'Constrained runs weight the acquisition by the probability of feasibility from independent GPs on each ' +
              'constraint; correlations between the constraints and the objective are not modelled.',
          ]
        : []),
    ],
    history,
  };
}

function acquisitionAt(acq: AcquisitionSpec, input: AcquisitionInput, iteration: number, d: number): number {
  switch (acq.kind) {
    case 'expected-improvement':
      return expectedImprovement(input, acq.xi ?? 0);
    case 'probability-of-improvement':
      return probabilityOfImprovement(input, acq.xi ?? 0);
    case 'lower-confidence-bound':
      return lowerConfidenceBound(input, acq.beta ?? ucbBeta(iteration, d, acq.delta ?? 0.1));
    default:
      throw new EngineError(`Acquisition "${acq.kind}" is defined over a candidate set, not point by point.`, 'internal');
  }
}

/**
 * Thompson sampling and the knowledge gradient both work over a candidate
 * set rather than point by point, so they are maximised by enumeration. All
 * coordinates here are in the standardised unit box.
 */
function discreteSuggestion(
  acq: AcquisitionSpec,
  model: GpModel,
  req: BayesOptRequest,
  unitBounds: Box,
  iteration: number,
  chosen: readonly number[][],
  rng: Random,
  incumbent: number,
): number[] {
  const count = Math.min(req.candidates?.count ?? 256, acq.kind === 'knowledge-gradient' ? 256 : 4096);
  const candidates = candidateSet(unitBounds, {
    count,
    source: req.candidates?.source ?? 'sobol',
    seed: `${req.seed}:disc:${iteration}:${chosen.length}`,
  });
  const fresh = candidates.filter((c) => !chosen.some((p) => p.every((v, j) => v === c[j])));
  if (fresh.length === 0) {
    throw new EngineError('Every candidate has already been chosen in this batch; the candidate set is too small.', 'size');
  }
  if (acq.kind === 'thompson') {
    const draw = samplePosteriorFunctions(model, fresh, 1, `${req.seed}:ts:${iteration}:${chosen.length}:${rng.int(0, 1e9)}`)
      .samples[0];
    let bi = 0;
    for (let i = 1; i < draw.length; i++) if (draw[i] < draw[bi]) bi = i;
    return fresh[bi];
  }
  const preds = predictGp(model, fresh).predictions;
  const means = preds.map((p) => p.mean);
  const Kcross = covarianceMatrix(model.kernel, fresh);
  void incumbent;
  let bestIdx = -1;
  let bestValue = -Infinity;
  for (let j = 0; j < fresh.length; j++) {
    const denom = Math.sqrt(preds[j].latentVariance + Math.max(model.noiseVariance, 1e-12));
    // σ̃ᵢ(x_j) = Cov(fᵢ, f_j)/√(Var[f_j] + σ²). The posterior cross-covariance
    // is approximated by the prior correlation scaled by the posterior
    // standard deviations — exact for i = j, and a documented approximation
    // otherwise, which is why this acquisition is numerical.
    const tilde = fresh.map(
      (_, i) =>
        (Kcross[i][j] * Math.sqrt(preds[i].latentVariance * preds[j].latentVariance)) /
        Math.max(Math.sqrt(Kcross[i][i] * Kcross[j][j]), 1e-300) /
        denom,
    );
    const value = knowledgeGradient(means, tilde);
    if (value > bestValue) {
      bestValue = value;
      bestIdx = j;
    }
  }
  if (bestIdx < 0 || !(bestValue > 0)) {
    throw new EngineError(
      'The knowledge gradient is zero at every candidate: no single additional observation would change the best ' +
        'posterior mean. The model believes it already knows the answer, so no suggestion is produced.',
      'flat-acquisition',
    );
  }
  return fresh[bestIdx];
}


export interface BayesOptHooks {
  onProgress?(p: BayesOptProgress): void;
  /** Checked between iterations; returning true stops the run. */
  isCancelled?(): boolean;
}

/** Run the generator to completion, honouring cancellation between iterations. */
export function runBayesOpt(req: BayesOptRequest, hooks: BayesOptHooks = {}): BayesOptResult {
  const gen = bayesOptSteps(req);
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
    hooks.onProgress?.(step.value);
    if (hooks.isCancelled?.()) {
      throw new EngineError(
        `The optimisation was cancelled after ${step.value.iteration} of ${step.value.iterations} iterations. No final result is reported for a cancelled run.`,
        'cancelled',
      );
    }
  }
}

/** Branin–Hoo, the standard 2-D Bayesian-optimisation test function. */
export const BRANIN = {
  bounds: [
    [-5, 10],
    [0, 15],
  ] as Box,
  optimum: 0.397887,
  /** Three global minima: (−π, 12.275), (π, 2.275) and (9.42478, 2.475). */
  minima: [
    [-Math.PI, 12.275],
    [Math.PI, 2.275],
    [9.42478, 2.475],
  ] as readonly (readonly number[])[],
  evaluate(x: readonly number[]): number {
    const a = 1;
    const b = 5.1 / (4 * Math.PI * Math.PI);
    const c = 5 / Math.PI;
    const r = 6;
    const s = 10;
    const t = 1 / (8 * Math.PI);
    return a * (x[1] - b * x[0] * x[0] + c * x[0] - r) ** 2 + s * (1 - t) * Math.cos(x[0]) + s;
  },
};
