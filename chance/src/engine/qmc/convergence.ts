/**
 * Convergence comparison harness.
 *
 * Runs the same integrand through several samplers at a geometric ladder of
 * sample sizes and returns error-vs-N curves, plus the OBSERVED convergence
 * rate for each: the least-squares slope of log(error) against log(N).
 *
 * The slopes are measurements, not the textbook rates. Plain Monte Carlo
 * should come out near −0.5 and will wander by a few hundredths on any single
 * run; Sobol on a smooth low-dimensional integrand typically comes out between
 * −0.8 and −1.0, approaching the theoretical O(N^{-1} (log N)^d) only when N is
 * large relative to 2^d. If a measured slope is flat, that is the honest
 * answer for that integrand — most often because it is not smooth, or because
 * the effective dimension is high.
 *
 * For randomised samplers the "error" at each N is the root-mean-square error
 * across independent replications, which is the quantity QMC theory is about.
 * For an unrandomised sampler it is the single deterministic absolute error;
 * that single number has no error bar of its own (see integrate.ts).
 */
import { EngineError } from '../core/result';
import { integrate, integrationWork, type MarginalSpec, type SamplerSpec } from './integrate';
import type { Integrand } from './variance';

export interface ConvergencePoint {
  samples: number;
  /** RMSE across replications for a randomised sampler, |error| for a fixed one. */
  error: number;
  /** Mean estimate across replications. */
  estimate: number;
  replications: number;
}

export interface SlopeFit {
  /** Least-squares slope of log(error) on log(N). */
  slope: number;
  /** Intercept, so the fitted curve can be drawn. */
  intercept: number;
  /** Coefficient of determination of the log–log fit. */
  rSquared: number;
  points: number;
}

export interface MethodConvergence {
  label: string;
  sampler: SamplerSpec;
  randomised: boolean;
  curve: ConvergencePoint[];
  fit: SlopeFit;
  warnings: string[];
}

export interface ConvergenceComparison {
  exactValue: number;
  dimension: number;
  sampleSizes: number[];
  methods: MethodConvergence[];
  /** Error ratios at the largest N, relative to plain Monte Carlo. */
  errorRatioAtLargestN: Record<string, number>;
}

/** Least-squares fit of log(error) = intercept + slope · log(N). */
export function fitLogLogSlope(points: { samples: number; error: number }[]): SlopeFit {
  const usable = points.filter((p) => p.error > 0 && Number.isFinite(p.error) && p.samples > 0);
  if (usable.length < 3) {
    throw new EngineError(
      `Fitting a convergence rate needs at least three points with a positive error; ${usable.length} were usable. A zero error at some N means the integrand was integrated exactly there, which no rate can describe.`,
      'insufficient-data',
    );
  }
  const xs = usable.map((p) => Math.log(p.samples));
  const ys = usable.map((p) => Math.log(p.error));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (!(sxx > 0)) throw new EngineError('All sample sizes were identical, so no convergence rate can be fitted.', 'insufficient-data');
  const slope = sxy / sxx;
  return {
    slope,
    intercept: my - slope * mx,
    rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 1,
    points: n,
  };
}

const DEFAULT_METHODS: { label: string; sampler: SamplerSpec }[] = [
  { label: 'Plain Monte Carlo', sampler: { kind: 'monte-carlo' } },
  { label: 'Antithetic', sampler: { kind: 'antithetic' } },
  { label: 'Latin hypercube', sampler: { kind: 'lhs' } },
  { label: 'Sobol (unrandomised)', sampler: { kind: 'sobol', randomisation: 'none' } },
  { label: 'Sobol (randomised, digital shift)', sampler: { kind: 'sobol', randomisation: 'digital-shift' } },
];

export interface ComparisonRequest {
  dimension: number;
  integrand: Integrand;
  /** The exact value, which is what makes this an error curve rather than a spread. */
  exactValue: number;
  /** Sample sizes; powers of two are kindest to Sobol. */
  sampleSizes: number[];
  seed: string;
  /** Replications per randomised method (default 12). */
  replications?: number;
  methods?: { label: string; sampler: SamplerSpec }[];
  marginals?: MarginalSpec[];
  /** Override for `CONVERGENCE_WORK_LIMIT`; raise it deliberately off the main thread. */
  workLimit?: number;
}

function isRandomised(spec: SamplerSpec): boolean {
  switch (spec.kind) {
    case 'monte-carlo':
    case 'antithetic':
    case 'lhs':
      return true;
    case 'sobol':
      return (spec.randomisation ?? 'none') !== 'none';
    case 'halton':
      return spec.scramble === true;
    case 'faure':
      return spec.randomise === true;
    case 'lattice':
      return spec.randomShift === true;
  }
}

/**
 * Budget on the comparison's work, measured as
 * (sum of sample sizes) x (replications summed over the methods) x dimension,
 * which is the number of coordinates the harness has to produce. It runs
 * synchronously on whatever thread asks for it; measured in a browser, 5.2e7
 * held the main thread for 5.7 s and 1.6e7 for 1.1 s, so this budget keeps the
 * worst case near a second. Past it the comparison refuses rather than freezing the caller.
 */
export const CONVERGENCE_WORK_LIMIT = 6e6;

/**
 * The coordinate count `compareConvergence` budgets, exposed so an interface
 * can state the cost of the settings it is offering before anything runs.
 */
export function convergenceWork(
  sampleSizes: number[],
  methods: { sampler: SamplerSpec }[],
  replications: number,
  dimension: number,
): number {
  let work = 0;
  for (const m of methods) {
    const r = isRandomised(m.sampler) ? replications : 1;
    for (const n of sampleSizes) work += r * integrationWork(m.sampler, dimension, n);
  }
  return work;
}

export function compareConvergence(req: ComparisonRequest): ConvergenceComparison {
  if (!Number.isFinite(req.exactValue)) {
    throw new EngineError('The exact value must be a finite number; without it there is no error to plot.', 'finite');
  }
  if (req.sampleSizes.length < 3) {
    throw new EngineError('At least three sample sizes are needed to fit a convergence rate.', 'length');
  }
  for (const n of req.sampleSizes) {
    if (!Number.isInteger(n) || n < 2) throw new EngineError('Every sample size must be a whole number of at least 2.', 'range');
  }
  const sizes = [...req.sampleSizes].sort((a, b) => a - b);
  const reps = req.replications ?? 12;
  if (!Number.isInteger(reps) || reps < 2) throw new EngineError('At least 2 replications are needed for a randomised method.', 'range');
  const methods = req.methods ?? DEFAULT_METHODS;

  const work = convergenceWork(sizes, methods, reps, req.dimension);
  const limit = req.workLimit ?? CONVERGENCE_WORK_LIMIT;
  if (work > limit) {
    const lattice = methods.some((m) => m.sampler.kind === 'lattice');
    throw new EngineError(
      `The comparison would cost ${work.toExponential(2)} coordinates over ${methods.length} methods at ${sizes.length} sample sizes in ${req.dimension} dimension(s) with ${reps} replications${lattice ? ', most of it the generating-vector search a lattice rule repeats at every sample size' : ''} — above the limit of ${limit.toExponential(2)} this build will run on one thread. It would stop the page responding for seconds. Reduce the dimension or the number of replications${lattice ? ', or compare a construction other than a lattice rule' : ''}.`,
      'limit',
    );
  }

  // Every sampler is constructed once at a trivial sample size first, so a
  // sampler this build cannot provide at this dimension — Sobol beyond its
  // direction numbers, for one — fails here instead of after minutes of work
  // on the methods that happened to come earlier in the list.
  for (const m of methods) {
    integrate({
      dimension: req.dimension,
      samples: 4,
      integrand: req.integrand,
      sampler: m.sampler,
      seed: `${req.seed}|preflight|${m.label}`,
      marginals: req.marginals,
    });
  }

  const out: MethodConvergence[] = [];
  for (const m of methods) {
    const randomised = isRandomised(m.sampler);
    const curve: ConvergencePoint[] = [];
    const warnings: string[] = [];
    for (const n of sizes) {
      const samples = m.sampler.kind === 'antithetic' && n % 2 !== 0 ? n + 1 : n;
      const r = randomised ? reps : 1;
      let sumSq = 0;
      let sumEst = 0;
      for (let k = 0; k < r; k++) {
        const result = integrate({
          dimension: req.dimension,
          samples,
          integrand: req.integrand,
          sampler: m.sampler,
          seed: `${req.seed}|${m.label}|${n}|${k}`,
          marginals: req.marginals,
        });
        const err = result.estimate - req.exactValue;
        sumSq += err * err;
        sumEst += result.estimate;
      }
      curve.push({ samples, error: Math.sqrt(sumSq / r), estimate: sumEst / r, replications: r });
    }
    if (!randomised) {
      warnings.push(
        'This sampler is unrandomised, so each error above is a single deterministic number with no error bar. The fitted slope describes this one point set, not a distribution of them.',
      );
    }
    out.push({ label: m.label, sampler: m.sampler, randomised, curve, fit: fitLogLogSlope(curve), warnings });
  }
  const largest = sizes[sizes.length - 1];
  const baseline = out.find((m) => m.sampler.kind === 'monte-carlo');
  const ratios: Record<string, number> = {};
  if (baseline) {
    const base = baseline.curve.find((p) => p.samples >= largest)?.error ?? NaN;
    for (const m of out) {
      const e = m.curve.find((p) => p.samples >= largest)?.error ?? NaN;
      ratios[m.label] = base > 0 ? e / base : NaN;
    }
  }
  return {
    exactValue: req.exactValue,
    dimension: req.dimension,
    sampleSizes: sizes,
    methods: out,
    errorRatioAtLargestN: ratios,
  };
}

/**
 * Test integrands with exactly known values, used by the tests and useful as
 * demonstrations. Every value here is derived analytically, not from this
 * codebase's own output.
 */
export const TEST_INTEGRANDS = {
  /** ∫₀¹ x dx = 1/2. */
  linear: { dimension: 1, f: (x: Float64Array): number => x[0], exact: 0.5, name: 'x on [0,1]' },
  /** ∫₀¹ x² dx = 1/3. */
  quadratic: { dimension: 1, f: (x: Float64Array): number => x[0] * x[0], exact: 1 / 3, name: 'x² on [0,1]' },
  /** ∫₀¹ 4/(1+x²) dx = π. */
  pi: { dimension: 1, f: (x: Float64Array): number => 4 / (1 + x[0] * x[0]), exact: Math.PI, name: '4/(1+x²) on [0,1]' },
  /** ∫₀¹ (x − ½)² dx = 1/12; symmetric, so antithetic sampling cannot help. */
  symmetric: {
    dimension: 1,
    f: (x: Float64Array): number => (x[0] - 0.5) * (x[0] - 0.5),
    exact: 1 / 12,
    name: '(x − ½)² on [0,1]',
  },
  /** ∫ over [0,1]^d of Π x_i = 2^{−d}. */
  product: (d: number) => ({
    dimension: d,
    f: (x: Float64Array): number => {
      let p = 1;
      for (let k = 0; k < d; k++) p *= x[k];
      return p;
    },
    exact: 2 ** -d,
    name: `Π x_i on [0,1]^${d}`,
  }),
  /** Genz "continuous" family: Π exp(−a_i |x_i − u_i|), with the exact value. */
  genzContinuous: (d: number, a = 5, u = 0.5) => ({
    dimension: d,
    f: (x: Float64Array): number => {
      let s = 0;
      for (let k = 0; k < d; k++) s -= a * Math.abs(x[k] - u);
      return Math.exp(s);
    },
    // ∫₀¹ exp(−a|x−u|) dx = (2 − e^{−au} − e^{−a(1−u)})/a per coordinate.
    exact: ((2 - Math.exp(-a * u) - Math.exp(-a * (1 - u))) / a) ** d,
    name: `Genz continuous (d = ${d}, a = ${a})`,
  }),
  /** Genz "oscillatory" family in one dimension: cos(2π w + Σ a_i x_i). */
  genzOscillatory1d: (a = 1, w = 0.3) => ({
    dimension: 1,
    f: (x: Float64Array): number => Math.cos(2 * Math.PI * w + a * x[0]),
    // ∫₀¹ cos(c + a x) dx = (sin(c + a) − sin(c))/a.
    exact: (Math.sin(2 * Math.PI * w + a) - Math.sin(2 * Math.PI * w)) / a,
    name: `Genz oscillatory (a = ${a}, w = ${w})`,
  }),
  /** Genz "product peak": Π 1/(a^{-2} + (x_i − u_i)²). */
  genzProductPeak: (d: number, a = 5, u = 0.5) => ({
    dimension: d,
    f: (x: Float64Array): number => {
      let p = 1;
      for (let k = 0; k < d; k++) p *= 1 / (1 / (a * a) + (x[k] - u) * (x[k] - u));
      return p;
    },
    // ∫₀¹ dx/(a^{-2}+(x−u)²) = a·[arctan(a(1−u)) + arctan(a u)].
    exact: (a * (Math.atan(a * (1 - u)) + Math.atan(a * u))) ** d,
    name: `Genz product peak (d = ${d}, a = ${a})`,
  }),
} as const;
