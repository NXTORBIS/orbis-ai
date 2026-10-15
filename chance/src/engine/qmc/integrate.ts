/**
 * Generic integration over [0,1)^d and over arbitrary distributions, with every
 * sampler in this module behind one interface — and with error estimation that
 * is correct for each of them.
 *
 * ## Error estimation, which is the part that goes wrong elsewhere
 *
 *  - Plain Monte Carlo, antithetic variates, Latin hypercube: the samples (or
 *    the pairs, or the designs) are independent, so s/√N is a valid standard
 *    error. For LHS it is slightly CONSERVATIVE, because LHS removes variance
 *    that the within-design sample variance still contains.
 *  - Unrandomised QMC (Sobol, Halton, Faure, lattice with no shift): there is
 *    NO statistical error estimate. The points are deterministic; s/√N is not a
 *    statement about anything. This module returns
 *    `standardError: null` with `errorBasis.kind = 'unavailable'`, and
 *    `integrate` refuses outright if `requireStandardError` is set.
 *  - A SINGLE randomised QMC replication: still no error estimate. One
 *    randomisation is one draw from the distribution of randomised estimates.
 *  - Randomised QMC with R ≥ 2 independent randomisations: the estimate is the
 *    mean of the R replicate estimates and the standard error is their sample
 *    standard deviation divided by √R. This is the only valid route, and it is
 *    what `randomisedQmcIntegrate` does.
 *
 * The runner is a generator that yields between chunks, matching
 * `simulationSteps` in `src/engine/simulation/runner.ts`: a worker stuck in a
 * synchronous loop can never receive a `cancel` message, so the yield is what
 * makes cancellation possible. A cancelled run returns its partial result with
 * `partial: true`.
 */
import { EngineError } from '../core/result';
import { Xoshiro128, type RandomSource, type Seed } from '../random/rng';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { faureSequence } from './faure';
import { haltonSequence } from './halton';
import { DEFAULT_LATTICE_CANDIDATES, latticeRule } from './lattice';
import { sobolSequence, type SobolRandomisation } from './sobol';
import { latinHypercube } from './stratified';
import type { ErrorBasis, PointSequence } from './types';
import type { Integrand } from './variance';

export type SamplerSpec =
  | { kind: 'monte-carlo' }
  | { kind: 'antithetic' }
  | { kind: 'lhs'; placement?: 'centred' | 'jittered' }
  | { kind: 'sobol'; randomisation?: SobolRandomisation }
  | { kind: 'halton'; scramble?: boolean; leap?: number; skip?: number }
  | { kind: 'faure'; randomise?: boolean }
  | { kind: 'lattice'; randomShift?: boolean };

/** Inverse-CDF transform of coordinate j into a named distribution. */
export interface MarginalSpec {
  distributionId: string;
  params: Params;
}

export interface IntegrationRequest {
  dimension: number;
  samples: number;
  integrand: Integrand;
  sampler: SamplerSpec;
  seed: Seed;
  /**
   * One marginal per dimension. When given, each coordinate u_j is mapped to
   * F_j^{-1}(u_j) before the integrand is called, so the result estimates
   * E[f(X)] under those independent marginals. Independence is NOT assumed
   * silently: supplying marginals asserts it, and the result says so.
   */
  marginals?: MarginalSpec[];
  chunkSize?: number;
  /** Refuse (rather than return null) when no honest standard error exists. */
  requireStandardError?: boolean;
}

export interface IntegrationProgress {
  completed: number;
  total: number;
}

export interface IntegrationResult {
  method: string;
  estimate: number;
  standardError: number | null;
  errorBasis: ErrorBasis;
  samples: number;
  dimension: number;
  /** Sample variance of the evaluated values; descriptive only for QMC. */
  sampleVariance: number;
  partial: boolean;
  exactness: 'numerical' | 'empirical';
  assumptions: string[];
  warnings: string[];
}

export interface IntegrationHooks {
  onProgress?(p: IntegrationProgress): void;
  isCancelled?(): boolean;
}

/** Whether a sampler supports an honest i.i.d.-style standard error. */
function errorBasisFor(spec: SamplerSpec, randomised: boolean): ErrorBasis {
  switch (spec.kind) {
    case 'monte-carlo':
      return { kind: 'iid', note: 'Independent samples; the standard error is s/√N.' };
    case 'antithetic':
      return {
        kind: 'iid',
        note: 'Independent antithetic pairs; the standard error is computed across pair averages, not across individual evaluations.',
      };
    case 'lhs':
      return {
        kind: 'iid',
        note: 'A Latin hypercube design is a single randomised design, but the within-design sample variance gives a CONSERVATIVE standard error: it still contains the variance that stratification removed, so the true error is smaller than reported. For a sharp error bar, replicate the design.',
      };
    default:
      return {
        kind: 'unavailable',
        reason: randomised
          ? 'This is a single randomised quasi-Monte Carlo replication. One randomisation is one draw, so there is nothing to take a standard deviation over. Use randomisedQmcIntegrate with at least 8 independent randomisations; the spread across replications is the only valid error estimate for QMC.'
          : 'Unrandomised quasi-Monte Carlo has no statistical error estimate. The points are deterministic and correlated by construction, so s/√N is not a statement about the error. Randomise the point set (digital shift, Owen scramble or random lattice shift) and estimate the error across independent randomisations.',
      };
  }
}

interface Driver {
  name: string;
  randomised: boolean;
  /** Writes the i-th point into `out`; may consume two evaluations for antithetic. */
  sequence: PointSequence;
}

function buildDriver(req: IntegrationRequest, seed: Seed): Driver {
  const d = req.dimension;
  switch (req.sampler.kind) {
    case 'sobol': {
      const mode = req.sampler.randomisation ?? 'none';
      const seq = sobolSequence({ dimension: d, randomisation: mode, seed: mode === 'none' ? undefined : seed });
      return { name: seq.name, randomised: seq.randomised, sequence: seq };
    }
    case 'halton': {
      const seq = haltonSequence({
        dimension: d,
        scramble: req.sampler.scramble,
        leap: req.sampler.leap,
        skip: req.sampler.skip,
        seed,
      });
      return { name: seq.name, randomised: seq.randomised, sequence: seq };
    }
    case 'faure': {
      const seq = faureSequence({ dimension: d, randomise: req.sampler.randomise, seed });
      return { name: seq.name, randomised: seq.randomised, sequence: seq };
    }
    case 'lattice': {
      const seq = latticeRule({ dimension: d, count: req.samples, randomShift: req.sampler.randomShift, seed });
      return { name: seq.name, randomised: seq.randomised, sequence: seq };
    }
    case 'lhs': {
      const design = latinHypercube({ dimension: d, count: req.samples, seed, placement: req.sampler.placement });
      const seq: PointSequence = {
        name: design.name,
        dimension: d,
        randomised: true,
        fill: (i, out) => {
          for (let k = 0; k < d; k++) out[k] = design.values[i * d + k];
        },
        point: (i) => design.values.slice(i * d, (i + 1) * d),
      };
      return { name: design.name, randomised: true, sequence: seq };
    }
    case 'monte-carlo':
    case 'antithetic': {
      const rng = new Xoshiro128(`qmc-mc:${String(seed)}`);
      const seq: PointSequence = {
        name: req.sampler.kind === 'antithetic' ? `Antithetic Monte Carlo (${d}-d)` : `Independent uniform (${d}-d)`,
        dimension: d,
        randomised: true,
        fill: (_i, out) => {
          for (let k = 0; k < d; k++) out[k] = rng.next();
        },
        point: (i) => {
          const out = new Float64Array(d);
          seq.fill(i, out);
          return out;
        },
      };
      return { name: seq.name, randomised: true, sequence: seq };
    }
  }
}

function buildTransform(req: IntegrationRequest): ((u: Float64Array, out: Float64Array) => void) | null {
  if (!req.marginals) return null;
  if (req.marginals.length !== req.dimension) {
    throw new EngineError(`One marginal distribution per dimension is required: ${req.dimension} expected, ${req.marginals.length} given.`, 'length');
  }
  const defs = req.marginals.map((m) => getDistribution(m.distributionId));
  const params = req.marginals.map((m) => m.params);
  return (u, out) => {
    for (let k = 0; k < u.length; k++) {
      // Keep the argument strictly inside (0,1): many quantile functions are
      // infinite at the endpoints and a QMC point set does contain 0 exactly.
      const p = Math.min(1 - 1e-12, Math.max(1e-12, u[k]));
      const x = defs[k].quantile(p, params[k]);
      if (!Number.isFinite(x)) {
        throw new EngineError(
          `The inverse CDF of ${defs[k].name} returned ${String(x)} at probability ${p}; the transformed point cannot be used.`,
          'non-finite',
        );
      }
      out[k] = x;
    }
  };
}

export function integrate(req: IntegrationRequest, hooks: IntegrationHooks = {}): IntegrationResult {
  const steps = integrationSteps(req, hooks);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function* integrationSteps(
  req: IntegrationRequest,
  hooks: IntegrationHooks = {},
): Generator<IntegrationProgress, IntegrationResult, void> {
  const d = req.dimension;
  if (!Number.isInteger(d) || d < 1) {
    throw new EngineError('The integration dimension must be a whole number of at least 1.', 'range');
  }
  if (!Number.isInteger(req.samples) || req.samples < 1) {
    throw new EngineError('The number of samples must be a whole number of at least 1. Zero samples produce no estimate, not an estimate of zero.', 'range');
  }
  const antithetic = req.sampler.kind === 'antithetic';
  if (antithetic && req.samples % 2 !== 0) {
    throw new EngineError('Antithetic sampling needs an even number of samples so every point has its mirror.', 'range');
  }
  const chunk = req.chunkSize ?? 4096;
  if (!Number.isInteger(chunk) || chunk < 1) throw new EngineError('The chunk size must be a whole number of at least 1.', 'range');

  const driver = buildDriver(req, req.seed);
  const basis = errorBasisFor(req.sampler, driver.randomised);
  if (req.requireStandardError && basis.kind === 'unavailable') {
    throw new EngineError(`No standard error is available for ${driver.name}. ${basis.reason}`, 'no-error-estimate');
  }
  const transform = buildTransform(req);
  const u = new Float64Array(d);
  const mirror = new Float64Array(d);
  const xBuf = new Float64Array(d);

  // Welford accumulation over the units the error estimate is based on
  // (individual values, or pair averages for antithetic sampling).
  let count = 0;
  let mean = 0;
  let m2 = 0;
  const push = (v: number): void => {
    count++;
    const delta = v - mean;
    mean += delta / count;
    m2 += delta * (v - mean);
  };

  const total = req.samples;
  const stepUnits = antithetic ? 2 : 1;
  let done = 0;
  let cancelled = false;
  let index = 0;
  while (done < total) {
    const end = Math.min(total, done + chunk);
    while (done < end) {
      driver.sequence.fill(index, u);
      for (let k = 0; k < d; k++) {
        const value = u[k];
        if (!(value >= 0 && value < 1)) {
          throw new EngineError(`Sampler "${driver.name}" produced coordinate ${value} outside [0,1) at point ${index}.`, 'internal');
        }
      }
      let value: number;
      if (antithetic) {
        for (let k = 0; k < d; k++) mirror[k] = 1 - u[k];
        const a = evaluate(req.integrand, u, transform, xBuf, index);
        const b = evaluate(req.integrand, mirror, transform, xBuf, index);
        value = 0.5 * (a + b);
      } else {
        value = evaluate(req.integrand, u, transform, xBuf, index);
      }
      push(value);
      index++;
      done += stepUnits;
    }
    hooks.onProgress?.({ completed: done, total });
    yield { completed: done, total };
    if (hooks.isCancelled?.()) {
      cancelled = true;
      break;
    }
  }

  if (count < 1) {
    throw new EngineError('The run produced no evaluations, so there is no estimate.', 'empty');
  }
  const variance = count > 1 ? m2 / (count - 1) : 0;
  const warnings: string[] = [];
  if (cancelled) {
    warnings.push(`The run was cancelled after ${done.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} samples. The estimate below uses the completed samples only and is marked partial.`);
    if (basis.kind !== 'unavailable' && req.sampler.kind !== 'monte-carlo' && req.sampler.kind !== 'antithetic') {
      warnings.push('A partially consumed stratified or quasi-random point set is no longer balanced, so the partial estimate has worse accuracy than the sample count suggests.');
    }
  }
  if (basis.kind === 'unavailable') warnings.push(basis.reason);
  const assumptions: string[] = [];
  if (req.marginals) {
    assumptions.push('The marginals are transformed independently, which assumes the coordinates are independent. For dependent inputs, apply a copula to the point set before the inverse-CDF step.');
  }
  return {
    method: driver.name,
    estimate: mean,
    standardError: basis.kind === 'unavailable' ? null : Math.sqrt(variance / count),
    errorBasis: basis,
    samples: done,
    dimension: d,
    sampleVariance: variance,
    partial: cancelled,
    exactness: req.sampler.kind === 'monte-carlo' || req.sampler.kind === 'antithetic' || req.sampler.kind === 'lhs' ? 'empirical' : 'numerical',
    assumptions,
    warnings,
  };
}

function evaluate(
  integrand: Integrand,
  u: Float64Array,
  transform: ((u: Float64Array, out: Float64Array) => void) | null,
  xBuf: Float64Array,
  index: number,
): number {
  let v: number;
  if (transform) {
    transform(u, xBuf);
    v = integrand(xBuf);
  } else {
    v = integrand(u);
  }
  if (!Number.isFinite(v)) {
    throw new EngineError(
      `The integrand returned ${Number.isNaN(v) ? 'NaN' : String(v)} at point ${index}. A non-finite value cannot be averaged, and no substitute will be used. Restrict the integrand's domain or handle the singularity explicitly.`,
      'non-finite',
    );
  }
  return v;
}

export interface RqmcResult {
  method: string;
  estimate: number;
  standardError: number;
  errorBasis: ErrorBasis;
  replications: number;
  samplesPerReplication: number;
  /** The per-replication estimates, so the spread can be inspected. */
  replicateEstimates: number[];
  exactness: 'numerical';
  warnings: string[];
}

/**
 * Randomised QMC: R independent randomisations of the same point set.
 *
 * This is the ONLY valid way to put an error bar on a QMC estimate. The
 * estimate is the mean of the R replicate estimates and the standard error is
 * their sample standard deviation over √R, with R − 1 degrees of freedom — so R
 * should be at least 8, and 16–32 is usual.
 */
/**
 * Budget on the coordinates one randomised-QMC estimate may produce, as
 * replications x samples x dimension. R independent randomisations cost R
 * times a single estimate, and the whole thing runs synchronously: measured in
 * a browser, 64 randomisations of 65,536 points in 64 dimensions (2.7e8
 * coordinates) held the main thread for 24 seconds, 262,144 points held it
 * long enough that the tab stopped accepting input at all, and 1.2e7
 * coordinates still cost 1.7 s. Past this budget the estimate refuses rather
 * than freezing the caller.
 */
export const RQMC_WORK_LIMIT = 5e6;

/**
 * The work one `integrate` call costs, counted in coordinates produced, so
 * callers can budget before they start. It is `samples x dimension` for every
 * construction except a lattice rule, which searches its generating vector
 * when it is built: that search is `dimension x candidates x N` products and
 * dominates everything else, which is why a convergence ladder over lattice
 * rules costs far more than its sample sizes suggest.
 */
export function integrationWork(sampler: SamplerSpec, dimension: number, samples: number): number {
  const base = samples * dimension;
  if (sampler.kind !== 'lattice') return base;
  return base + dimension * Math.min(DEFAULT_LATTICE_CANDIDATES, samples) * samples;
}

export function randomisedQmcIntegrate(
  req: Omit<IntegrationRequest, 'requireStandardError'>,
  replications: number,
  workLimit = RQMC_WORK_LIMIT,
): RqmcResult {
  if (!Number.isInteger(replications) || replications < 2) {
    throw new EngineError('Randomised QMC needs at least 2 independent randomisations to estimate an error; 8 or more is advisable.', 'range');
  }
  const work = replications * integrationWork(req.sampler, req.dimension, req.samples);
  if (work > workLimit) {
    throw new EngineError(
      `${replications} randomisations of ${req.samples.toLocaleString('en-US')} points in ${req.dimension} dimension(s) would cost ${work.toExponential(2)} coordinates${req.sampler.kind === 'lattice' ? ', most of it the generating-vector search each randomisation repeats' : ''}, above the limit of ${workLimit.toExponential(2)} this build will run on one thread. It would stop the page responding. Reduce the randomisations, the evaluations, or the dimension.`,
      'limit',
    );
  }
  const randomisedSpec = ensureRandomised(req.sampler);
  const estimates: number[] = [];
  let name = '';
  for (let r = 0; r < replications; r++) {
    const result = integrate({ ...req, sampler: randomisedSpec, seed: `${String(req.seed)}#${r}` });
    estimates.push(result.estimate);
    name = result.method;
  }
  const mean = estimates.reduce((a, b) => a + b, 0) / replications;
  let ss = 0;
  for (const e of estimates) ss += (e - mean) * (e - mean);
  const variance = ss / (replications - 1);
  const warnings: string[] = [];
  if (replications < 8) {
    warnings.push(`Only ${replications} randomisations were used, so the standard error is itself very noisy. Use at least 8, and prefer 16–32.`);
  }
  return {
    method: `${name}, ${replications} independent randomisations`,
    estimate: mean,
    standardError: Math.sqrt(variance / replications),
    errorBasis: {
      kind: 'replications',
      replications,
      note: `Standard error computed across ${replications} independent randomisations of the point set. This is the only valid error estimate for quasi-Monte Carlo; the within-replication sample variance says nothing about it.`,
    },
    replications,
    samplesPerReplication: req.samples,
    replicateEstimates: estimates,
    exactness: 'numerical',
    warnings,
  };
}

function ensureRandomised(spec: SamplerSpec): SamplerSpec {
  switch (spec.kind) {
    case 'sobol':
      if (!spec.randomisation || spec.randomisation === 'none') return { kind: 'sobol', randomisation: 'digital-shift' };
      return spec;
    case 'halton':
      return { ...spec, scramble: true };
    case 'faure':
      return { ...spec, randomise: true };
    case 'lattice':
      return { ...spec, randomShift: true };
    default:
      return spec;
  }
}

/**
 * A `RandomSource` fed by a QMC point set.
 *
 * READ THIS BEFORE USING IT. A QMC point set is not a random stream. This
 * adapter is valid only for a model that consumes EXACTLY `dimension`
 * uniforms per trial, in the same order, on every trial. It refuses to wrap
 * around within a trial, because silently reusing coordinates would destroy
 * the point set's balance and the resulting error bars would be wrong without
 * anything looking wrong. `nextUint32` is derived from the coordinate and is
 * emphatically NOT a source of independent bits: do not use it for rejection
 * sampling, shuffling, or anything with a data-dependent number of draws.
 */
export class QmcStream implements RandomSource {
  private readonly buf: Float64Array;
  private cursor: number;
  private trial = -1;

  constructor(
    private readonly sequence: PointSequence,
    private readonly trials: number,
  ) {
    if (!Number.isInteger(trials) || trials < 1) {
      throw new EngineError('A QMC stream needs a whole number of at least 1 trial.', 'range');
    }
    this.buf = new Float64Array(sequence.dimension);
    this.cursor = sequence.dimension;
  }

  /** Begin the next trial. Must be called once per trial. */
  startTrial(): void {
    this.trial++;
    if (this.trial >= this.trials) {
      throw new EngineError(
        `This QMC stream was built for ${this.trials} trials and trial ${this.trial + 1} was requested. Extending a quasi-random point set past its planned size changes its balance; build a larger one instead.`,
        'exhausted',
      );
    }
    this.sequence.fill(this.trial, this.buf);
    this.cursor = 0;
  }

  next(): number {
    if (this.cursor >= this.buf.length) {
      throw new EngineError(
        `This trial has already consumed all ${this.buf.length} coordinates of its quasi-random point. A QMC point set is not a random stream: reusing coordinates, or drawing a variable number per trial, destroys the balance that makes QMC accurate and would give wrong error bars. Raise the dimension to match what the model consumes, or use a plain RNG.`,
        'exhausted',
      );
    }
    return this.buf[this.cursor++];
  }

  nextUint32(): number {
    // Derived from the coordinate so that it is reproducible, but the bits are
    // NOT independent; see the class note.
    return Math.floor(this.next() * 4294967296) >>> 0;
  }

  /** Coordinates consumed so far in the current trial. */
  get consumed(): number {
    return this.cursor;
  }
}
