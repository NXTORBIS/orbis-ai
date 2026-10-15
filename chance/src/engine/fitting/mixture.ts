/**
 * Gaussian mixture fitting by expectation–maximisation.
 *
 * EM has a guarantee that is worth using as a correctness check: the
 * observed-data log-likelihood can never decrease from one iteration to the
 * next. Every iteration's log-likelihood is recorded and checked here, and a
 * decrease is reported as a defect rather than smoothed over.
 *
 * Two honest caveats come with every mixture fit: the likelihood has many
 * local optima (hence multiple random restarts), and the component labels are
 * arbitrary — "component 1" in one fit is not "component 1" in another.
 */
import { EngineError } from '../core/result';
import { logSumExp } from '../core/numeric';
import { Random, Xoshiro128, type Seed } from '../random/rng';
import { quantileSorted, sortedCopy, variance } from '../stats/descriptive';

export interface GaussianComponent {
  weight: number;
  mean: number;
  sd: number;
}

export interface MixtureFit {
  components: GaussianComponent[];
  logLikelihood: number;
  /** One entry per iteration, in order. Must be non-decreasing. */
  logLikelihoodPath: number[];
  monotone: boolean;
  iterations: number;
  converged: boolean;
  restarts: number;
  /** 3m − 1 free parameters for m components (weights sum to 1). */
  parameterCount: number;
  n: number;
  aic: number;
  bic: number;
  warnings: string[];
  caveats: string[];
}

export interface MixtureOptions {
  restarts?: number;
  maxIterations?: number;
  tol?: number;
  seed?: Seed;
}

const CAVEATS = [
  'Component labels are arbitrary (label switching): the same fit found from a different start may list the same components in a different order. Compare components by their means, not their index.',
  'The mixture likelihood is unbounded and riddled with local optima: a component can chase a single point and drive its variance towards zero. Several random restarts were used, and the best was kept, but a global optimum is not guaranteed.',
  'A two-component mixture can fit mildly skewed unimodal data well without there being two real subpopulations. A better BIC is not evidence that the groups exist.',
];

function componentLogPdf(x: number, c: GaussianComponent): number {
  const z = (x - c.mean) / c.sd;
  return Math.log(c.weight) - Math.log(c.sd) - 0.5 * Math.log(2 * Math.PI) - 0.5 * z * z;
}

function mixtureLogLikelihood(data: readonly number[], comps: readonly GaussianComponent[]): number {
  let total = 0;
  const buf = new Array<number>(comps.length);
  for (const x of data) {
    for (let j = 0; j < comps.length; j++) buf[j] = componentLogPdf(x, comps[j]);
    const l = logSumExp(buf);
    if (!Number.isFinite(l)) return -Infinity;
    total += l;
  }
  return total;
}

function initialise(data: readonly number[], m: number, rng: Random, sorted: Float64Array, sd: number): GaussianComponent[] {
  // Means at random observations (k-means++ style spread), common starting sd.
  const means: number[] = [];
  means.push(data[rng.int(0, data.length - 1)]);
  while (means.length < m) {
    let best = data[rng.int(0, data.length - 1)];
    let bestD = -Infinity;
    for (let t = 0; t < 8; t++) {
      const cand = data[rng.int(0, data.length - 1)];
      const d = Math.min(...means.map((mu) => Math.abs(cand - mu)));
      if (d > bestD) {
        bestD = d;
        best = cand;
      }
    }
    means.push(best);
  }
  const spread = Math.max(sd / m, (quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25)) / (2 * m), 1e-9);
  return means.map((mu) => ({ weight: 1 / m, mean: mu, sd: spread }));
}

/**
 * Fit an m-component Gaussian mixture by EM with random restarts.
 * Throws when every restart degenerates (a component variance collapsing on a
 * single point) — that is a real failure, not a fit.
 */
export function fitGaussianMixture(data: ArrayLike<number>, m: number, options: MixtureOptions = {}): MixtureFit {
  if (!Number.isInteger(m) || m < 1 || m > 5) throw new EngineError('The number of mixture components must be a whole number from 1 to 5.', 'range');
  const xs: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) xs.push(data[i]);
  }
  const n = xs.length;
  const parameterCount = 3 * m - 1;
  if (n < 10 * m) {
    throw new EngineError(
      `A ${m}-component Gaussian mixture has ${parameterCount} free parameters; fitting it from ${n} observations is not meaningful. At least ${10 * m} observations are needed.`,
      'insufficient',
    );
  }
  const sorted = sortedCopy(xs);
  const sd = Math.sqrt(variance(xs, 1));
  if (!(sd > 0)) throw new EngineError('All observations are identical, so no mixture can be fitted.', 'degenerate');
  // A component narrower than this is chasing individual points, not a subpopulation.
  const sdFloor = (sorted[n - 1] - sorted[0]) / (100 * n) + 1e-12;
  const restarts = Math.max(1, options.restarts ?? 10);
  const maxIterations = options.maxIterations ?? 500;
  const tol = options.tol ?? 1e-9;
  const rng = new Random(new Xoshiro128(options.seed ?? 'mixture'));

  let best: { comps: GaussianComponent[]; ll: number; path: number[]; iterations: number; converged: boolean; monotone: boolean } | null = null;
  let degenerate = 0;
  const warnings: string[] = [];

  for (let r = 0; r < restarts; r++) {
    let comps = m === 1
      ? [{ weight: 1, mean: xs.reduce((a, b) => a + b, 0) / n, sd }]
      : initialise(xs, m, rng, sorted, sd);
    const path: number[] = [];
    let converged = false;
    let monotone = true;
    let iterations = 0;
    let failed = false;
    for (; iterations < maxIterations; iterations++) {
      // E step: responsibilities in log space.
      const resp: number[][] = [];
      const logs = new Array<number>(m);
      let ll = 0;
      for (const x of xs) {
        for (let j = 0; j < m; j++) logs[j] = componentLogPdf(x, comps[j]);
        const d = logSumExp(logs);
        if (!Number.isFinite(d)) {
          failed = true;
          break;
        }
        ll += d;
        resp.push(logs.map((l) => Math.exp(l - d)));
      }
      if (failed) break;
      const prev = path.length ? path[path.length - 1] : -Infinity;
      path.push(ll);
      // EM guarantees ll >= prev. A decrease beyond rounding is a defect.
      if (path.length > 1 && ll < prev - 1e-8 * (1 + Math.abs(prev))) monotone = false;
      if (path.length > 1 && ll - prev <= tol * (1 + Math.abs(ll))) {
        converged = true;
        iterations++;
        break;
      }
      // M step.
      const next: GaussianComponent[] = [];
      for (let j = 0; j < m; j++) {
        let nk = 0;
        let mu = 0;
        for (let i = 0; i < n; i++) {
          nk += resp[i][j];
          mu += resp[i][j] * xs[i];
        }
        if (!(nk > 1e-10)) {
          failed = true;
          break;
        }
        mu /= nk;
        let v = 0;
        for (let i = 0; i < n; i++) v += resp[i][j] * (xs[i] - mu) ** 2;
        v /= nk;
        const s = Math.sqrt(v);
        if (!(s > sdFloor)) {
          failed = true;
          break;
        }
        next.push({ weight: nk / n, mean: mu, sd: s });
      }
      if (failed) break;
      comps = next;
    }
    if (failed || !path.length) {
      degenerate++;
      continue;
    }
    const ll = path[path.length - 1];
    if (!best || ll > best.ll) best = { comps, ll, path, iterations, converged, monotone };
  }

  if (!best) {
    throw new EngineError(
      `Every one of the ${restarts} EM restarts for a ${m}-component mixture degenerated (a component variance collapsed onto individual observations). No fit is reported. This usually means ${m} components is more than the data support.`,
      'numerical',
    );
  }
  if (degenerate) warnings.push(`${degenerate} of ${restarts} restarts degenerated (a component collapsed onto individual points) and were discarded.`);
  if (!best.monotone) {
    warnings.push('DEFECT: the EM log-likelihood decreased between iterations. EM cannot do that, so this fit is not trustworthy and the implementation must be examined.');
  }
  if (!best.converged) {
    warnings.push(`EM reached the iteration limit (${maxIterations}) without the log-likelihood settling; the parameters are the last iterate and are NOT a converged fit.`);
  }
  const sortedComps = [...best.comps].sort((a, b) => a.mean - b.mean);
  const ll = mixtureLogLikelihood(xs, sortedComps);
  const aic = 2 * parameterCount - 2 * ll;
  const bic = parameterCount * Math.log(n) - 2 * ll;
  const minWeight = Math.min(...sortedComps.map((c) => c.weight));
  if (minWeight * n < 10) {
    warnings.push(`The smallest component holds about ${(minWeight * n).toFixed(1)} observations. A component supported by so few points is not reliably estimated.`);
  }
  return {
    components: sortedComps,
    logLikelihood: ll,
    logLikelihoodPath: best.path,
    monotone: best.monotone,
    iterations: best.iterations,
    converged: best.converged,
    restarts,
    parameterCount,
    n,
    aic,
    bic,
    warnings,
    caveats: CAVEATS,
  };
}

export interface MixtureSelection {
  fits: MixtureFit[];
  best: MixtureFit;
  /** Components considered that could not be fitted, with the reason. */
  rejected: { components: number; reason: string }[];
  statements: string[];
}

/** BIC-based choice of component count over a range (1–5). */
export function selectGaussianMixture(
  data: ArrayLike<number>,
  options: MixtureOptions & { min?: number; max?: number } = {},
): MixtureSelection {
  const lo = options.min ?? 1;
  const hi = options.max ?? 5;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > 5 || hi < lo) {
    throw new EngineError('The component range must be whole numbers within 1 to 5, with min ≤ max.', 'range');
  }
  const fits: MixtureFit[] = [];
  const rejected: { components: number; reason: string }[] = [];
  for (let m = lo; m <= hi; m++) {
    try {
      fits.push(fitGaussianMixture(data, m, options));
    } catch (e) {
      rejected.push({ components: m, reason: e instanceof EngineError ? e.message : String(e) });
    }
  }
  if (!fits.length) {
    throw new EngineError(`No mixture with ${lo} to ${hi} components could be fitted. ${rejected.map((r) => r.reason).join(' ')}`, 'numerical');
  }
  const best = fits.reduce((a, b) => (b.bic < a.bic ? b : a));
  const sortedByBic = [...fits].sort((a, b) => a.bic - b.bic);
  const gap = sortedByBic.length > 1 ? sortedByBic[1].bic - sortedByBic[0].bic : Infinity;
  const statements = [
    `BIC selects ${best.components.length} component(s) among ${lo}–${hi}.`,
    gap < 2
      ? `The next-best component count is only ${gap.toPrecision(3)} BIC units away, which is not a meaningful preference. Treat the component count as undetermined.`
      : `The next-best component count is ${gap.toPrecision(3)} BIC units worse.`,
    'BIC chooses among Gaussian mixtures only. A skewed single distribution (log-normal, gamma) often beats any of them and should be compared separately.',
    ...CAVEATS,
  ];
  return { fits, best, rejected, statements };
}
