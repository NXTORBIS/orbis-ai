/**
 * Generic maximum likelihood fitting over the distribution registry.
 *
 * The same code fits every distribution: the parameter vector, its bounds and
 * its integrality come from the distribution's own `params` spec, and the
 * objective is the sum of its own `logPdf`. Closed-form estimators are used
 * where they exist (see `analytic.ts`); everything else goes through bounded
 * Nelder–Mead.
 *
 * Nothing here returns a parameter value without saying how it was obtained,
 * whether the search converged, and how many observations were used.
 */
import { EngineError, type Explanation, type Exactness } from '../core/result';
import { normalQuantile } from '../special/gamma';
import { brentRoot } from '../core/numeric';
import { solve } from '../stats/linalg';
import { defaultParams, validateParams } from '../distributions/registry';
import type { DistributionDef, ParamSpec, Params } from '../distributions/types';
import { analyticMle, hasAnalyticMle } from './analytic';
import { momentEstimates } from './moments';
import { multiStartNelderMead, numericalHessian, paramBound } from './optimize';
import type { Convergence, FitInterval, FitResult, ParamUncertainty } from './types';

export interface PreparedData {
  used: number[];
  nDiscarded: number;
  reasons: string[];
}

/**
 * Union of the distribution's support over a sample of its parameter space.
 * Used to decide whether a dataset could possibly have come from the family at
 * any parameter values, without pretending to know the parameters yet.
 */
export function supportEnvelope(def: DistributionDef): { min: number; max: number } {
  const base = defaultParams(def);
  const candidates: Params[] = [base];
  for (const spec of def.params) {
    for (const v of [spec.sliderMin, spec.sliderMax, spec.min, spec.max]) {
      if (v === undefined || !Number.isFinite(v)) continue;
      const p: Params = { ...base, [spec.key]: spec.integer ? Math.round(v) : v };
      if (!validateParams(def, p).length) candidates.push(p);
    }
  }
  let min = Infinity;
  let max = -Infinity;
  for (const p of candidates) {
    const s = def.support(p);
    min = Math.min(min, s.min);
    max = Math.max(max, s.max);
  }
  if (!Number.isFinite(min) && min !== -Infinity) min = -Infinity;
  return { min, max };
}

/**
 * Filter a dataset for a distribution, reporting every discarded observation
 * and why. Throws when the data are fundamentally incompatible with the family
 * (so the caller can skip that distribution with a stated reason) rather than
 * quietly dropping most of the sample.
 */
export function prepareData(def: DistributionDef, data: ArrayLike<number>): PreparedData {
  const reasons: string[] = [];
  const finite: number[] = [];
  let nonFinite = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    if (typeof x === 'number' && Number.isFinite(x)) finite.push(x);
    else nonFinite++;
  }
  if (nonFinite) reasons.push(`${nonFinite} observation(s) discarded: not a finite number.`);
  if (!finite.length) throw new EngineError('No finite observations were supplied.', 'empty');
  if (def.kind === 'discrete') {
    const nonInt = finite.filter((x) => !Number.isInteger(x)).length;
    if (nonInt) {
      throw new EngineError(
        `${def.name} only takes whole-number values but ${nonInt} of ${finite.length} observations are not whole numbers. Fitting it would misrepresent the data.`,
        'support',
      );
    }
  }
  const env = supportEnvelope(def);
  const outside = finite.filter((x) => x < env.min || x > env.max);
  if (outside.length) {
    const sample = outside.slice(0, 3).map((x) => x.toPrecision(6)).join(', ');
    throw new EngineError(
      `${outside.length} of ${finite.length} observations lie outside every possible support of ${def.name} (${env.min} to ${env.max}); for example ${sample}. No parameter values can describe this data.`,
      'support',
    );
  }
  return { used: finite, nDiscarded: nonFinite, reasons };
}

export function logLikelihood(def: DistributionDef, params: Params, data: readonly number[]): number {
  if (validateParams(def, params).length) return -Infinity;
  let s = 0;
  for (const x of data) {
    const lp = def.logPdf(x, params);
    if (!Number.isFinite(lp)) return -Infinity;
    s += lp;
  }
  return s;
}

export interface FitOptions {
  /** Parameters held at a known value (design constants such as a binomial n). */
  fixed?: Params;
  level?: number;
  /** Number of restarts for the numerical optimiser. */
  restarts?: number;
}

/** Parameters whose MLE is a support endpoint: the observed information does not apply. */
export const NON_REGULAR: Record<string, string[]> = {
  uniform: ['a', 'b'],
  discreteUniform: ['a', 'b'],
  pareto: ['xm'],
  triangular: ['a', 'b'],
  pert: ['a', 'b'],
};

export function aiccOf(aic: number, k: number, n: number): number {
  const denom = n - k - 1;
  return denom > 0 ? aic + (2 * k * (k + 1)) / denom : Infinity;
}

function freeSpecs(def: DistributionDef, fixed: Params): ParamSpec[] {
  return def.params.filter((s) => !(s.key in fixed));
}

/** Starting points for the numerical search: moments first, then spec defaults. */
function startingPoints(def: DistributionDef, data: readonly number[], fixed: Params, specs: ParamSpec[], restarts: number): number[][] {
  const base = { ...defaultParams(def), ...fixed };
  const starts: number[][] = [];
  const push = (p: Params): void => {
    const full = { ...base, ...p };
    if (validateParams(def, full).length) return;
    starts.push(specs.map((s) => full[s.key]));
  };
  const mom = momentEstimates(def, data, fixed);
  if (mom) push(mom.params);
  push(base);
  // Deterministic spread of further starts: scale each free parameter.
  const factors = [0.5, 2, 0.25, 4, 0.1, 10];
  for (let i = 0; starts.length < restarts && i < factors.length; i++) {
    const p: Params = {};
    for (const s of specs) {
      const v = (mom?.params[s.key] ?? base[s.key]) * factors[i];
      const b = paramBound(s);
      const lo = Number.isFinite(b.min) ? b.min : -Infinity;
      const hi = Number.isFinite(b.max) ? b.max : Infinity;
      const nudge = (hi - lo) * 1e-6;
      p[s.key] = Math.min(Number.isFinite(hi) ? hi - (Number.isFinite(nudge) ? nudge : 0) : v, Math.max(Number.isFinite(lo) ? lo + (Number.isFinite(nudge) ? nudge : 1e-9) : v, v));
    }
    push(p);
  }
  if (!starts.length) throw new EngineError(`No valid starting parameters could be constructed for ${def.name}.`, 'numerical');
  return starts;
}

/**
 * Observed-information standard errors and Wald intervals for the regular
 * parameters of a fit. Parameters whose estimator is a support endpoint, and
 * cases where the Hessian is not positive definite, are reported as
 * unavailable with a reason — never as a number.
 */
export function uncertaintyFromNll(
  def: DistributionDef,
  params: Params,
  nllOf: (p: Params) => number,
  specs: ParamSpec[],
  level: number,
): { uncertainty: ParamUncertainty[]; warnings: string[] } {
  const warnings: string[] = [];
  const nonRegular = NON_REGULAR[def.id] ?? [];
  const regular = specs.filter((s) => !nonRegular.includes(s.key));
  const uncertainty: ParamUncertainty[] = specs.map((s) => ({ key: s.key, estimate: params[s.key], standardError: null, wald: null }));
  const byKey = new Map(uncertainty.map((u) => [u.key, u]));
  for (const s of specs) {
    if (nonRegular.includes(s.key)) {
      const u = byKey.get(s.key);
      if (u) {
        u.unavailableReason =
          `The maximum likelihood estimate of ${s.label} is a support endpoint (an order statistic). The likelihood is not differentiable there, so the observed information gives no standard error. Use the parametric bootstrap interval instead.`;
      }
    }
  }
  if (!regular.length) return { uncertainty, warnings };
  const nll = (v: number[]): number => {
    const p: Params = { ...params };
    regular.forEach((s, i) => (p[s.key] = v[i]));
    return nllOf(p);
  };
  const x = regular.map((s) => params[s.key]);
  const h = numericalHessian(nll, x, regular.map(paramBound));
  if (!h) {
    warnings.push('The observed information could not be evaluated (the log-likelihood is not finite in a neighbourhood of the estimate), so no standard errors are reported.');
    for (const s of regular) {
      const u = byKey.get(s.key);
      if (u) u.unavailableReason = 'The numerical Hessian of the negative log-likelihood could not be evaluated at the estimate.';
    }
    return { uncertainty, warnings };
  }
  const d = regular.length;
  const cov: number[][] = [];
  let singular = false;
  for (let j = 0; j < d; j++) {
    const e = new Array<number>(d).fill(0);
    e[j] = 1;
    const col = solve(h.matrix.map((r) => r.slice()), e);
    if (!col) {
      singular = true;
      break;
    }
    cov.push(col);
  }
  if (singular) {
    warnings.push('The observed information matrix is singular at the estimate: the parameters are not separately identified by this data, so no standard errors are reported.');
    for (const s of regular) {
      const u = byKey.get(s.key);
      if (u) u.unavailableReason = 'The observed information matrix is singular (parameters not separately identified).';
    }
    return { uncertainty, warnings };
  }
  const z = normalQuantile(0.5 + level / 2);
  for (let j = 0; j < d; j++) {
    const varj = cov[j][j];
    const u = byKey.get(regular[j].key);
    if (!u) continue;
    if (!(varj > 0) || !Number.isFinite(varj)) {
      u.unavailableReason =
        'The inverse observed information has a non-positive variance for this parameter: the estimate is not at a well-behaved interior maximum, so a standard error would be meaningless.';
      warnings.push(`No standard error for ${regular[j].label}: the observed information is not positive definite there.`);
      continue;
    }
    const se = Math.sqrt(varj);
    u.standardError = se;
    u.wald = {
      low: params[regular[j].key] - z * se,
      high: params[regular[j].key] + z * se,
      level,
      method: 'Wald: estimate ± z · SE, with SE from the inverse observed information (numerical Hessian of the negative log-likelihood)',
    };
  }
  return { uncertainty, warnings };
}

export const WALD_LIMITATION =
  'Wald intervals assume the log-likelihood is approximately quadratic near the maximum. For small samples, or parameters near a bound, the profile-likelihood interval is more reliable because it follows the actual shape of the likelihood.';

export function fitDistribution(def: DistributionDef, data: ArrayLike<number>, options: FitOptions = {}): FitResult {
  const fixed = { ...(options.fixed ?? {}) };
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError('Confidence level must be between 0 and 1.', 'range');
  const prep = prepareData(def, data);
  const used = prep.used;
  const n = used.length;
  const specs = freeSpecs(def, fixed);
  const k = specs.length;
  if (n < k + 1) {
    throw new EngineError(
      `${def.name} has ${k} free parameter(s); fitting them needs more than ${k} observations and only ${n} are available. With n ≤ k the fit is unidentified or interpolates the data.`,
      'insufficient',
    );
  }
  for (const key of Object.keys(fixed)) {
    if (!def.params.some((s) => s.key === key)) throw new EngineError(`${def.name} has no parameter "${key}".`, 'unknown');
  }

  const integerFree = specs.filter((s) => s.integer);
  const analytic = hasAnalyticMle(def.id) && Object.keys(fixed).length === 0 ? analyticMle(def.id, used) : null;
  if (!analytic && integerFree.length) {
    throw new EngineError(
      `${def.name} has whole-number parameter(s) ${integerFree.map((s) => s.label).join(', ')} that are design constants rather than quantities estimated from a sample (for example the number of trials, or the population size). Supply them as fixed values to fit the rest.`,
      'unsupported',
    );
  }

  const warnings = [...prep.reasons];
  let params: Params;
  let convergence: Convergence;
  let method: FitResult['method'];
  let exactness: Exactness;
  const steps: Explanation['steps'] = [];
  let formula: string | undefined;

  if (analytic) {
    params = analytic.params;
    const issues = validateParams(def, params);
    if (issues.length) throw new EngineError(issues);
    convergence = { converged: true, iterations: 0, message: 'Closed-form estimator: no iteration required.' };
    method = 'analytic-mle';
    exactness = 'exact';
    formula = analytic.formula;
    steps.push(...analytic.steps);
  } else {
    const restarts = Math.max(1, options.restarts ?? 4);
    const starts = startingPoints(def, used, fixed, specs, restarts);
    const bounds = specs.map(paramBound);
    const objective = (v: number[]): number => {
      const p: Params = { ...defaultParams(def), ...fixed };
      specs.forEach((s, i) => (p[s.key] = v[i]));
      return -logLikelihood(def, p, used);
    };
    const outcome = multiStartNelderMead(objective, starts, bounds, { maxIterations: 4000, tol: 1e-11 });
    if (!outcome.converged || !Number.isFinite(outcome.value)) {
      throw new EngineError(
        `The likelihood optimisation for ${def.name} did not converge (${outcome.restarts} starting points, ${outcome.iterations} iterations). No fit is reported: the last iterate is not a maximum.`,
        'numerical',
      );
    }
    params = { ...defaultParams(def), ...fixed };
    specs.forEach((s, i) => (params[s.key] = outcome.x[i]));
    const issues = validateParams(def, params);
    if (issues.length) throw new EngineError(issues);
    convergence = { converged: true, iterations: outcome.iterations, message: `${outcome.message} ${outcome.restarts} starting point(s) were used.` };
    method = 'numerical-mle';
    exactness = 'numerical';
    if (outcome.disagreement > 1e-4 * (1 + Math.abs(outcome.value))) {
      warnings.push(
        `The restarts reached log-likelihoods differing by ${outcome.disagreement.toPrecision(3)}; the likelihood surface has local optima, so this may be a local rather than a global maximum.`,
      );
    }
    steps.push({ label: 'Optimiser', value: `Nelder–Mead on bound-transformed parameters, ${outcome.restarts} starts, ${outcome.iterations} total iterations` });
  }

  const ll = logLikelihood(def, params, used);
  if (!Number.isFinite(ll)) {
    throw new EngineError(`The log-likelihood of the fitted ${def.name} is not finite, so the fit is not usable.`, 'numerical');
  }
  const { uncertainty, warnings: uw } = uncertaintyFromNll(def, params, (p) => -logLikelihood(def, p, used), specs, level);
  warnings.push(...uw);
  const aic = 2 * k - 2 * ll;
  const bic = k * Math.log(n) - 2 * ll;
  const aicc = aiccOf(aic, k, n);
  if (!Number.isFinite(aicc)) {
    warnings.push(`AICc is undefined here because n − k − 1 = ${n - k - 1} ≤ 0: the sample is too small for the small-sample correction.`);
  }
  steps.push({ label: 'Log-likelihood', expression: 'ln L = Σ ln f(xᵢ; θ̂)', value: String(ll) });
  steps.push({ label: 'AIC', expression: 'AIC = 2k − 2 ln L', value: String(aic) });
  steps.push({ label: 'BIC', expression: 'BIC = k ln n − 2 ln L', value: String(bic) });

  return {
    distributionId: def.id,
    distributionName: def.name,
    params,
    fixedParams: fixed,
    estimatedParams: k,
    logLikelihood: ll,
    n,
    nDiscarded: prep.nDiscarded,
    discardReasons: prep.reasons,
    method,
    exactness,
    convergence,
    uncertainty,
    aic,
    aicc,
    bic,
    warnings,
    explanation: {
      method: analytic
        ? `Closed-form maximum likelihood estimate for the ${def.name} distribution.`
        : `Maximum likelihood by bounded Nelder–Mead optimisation of the ${def.name} log-likelihood.`,
      formula,
      steps,
      assumptions: [
        'The observations are independent and identically distributed.',
        'The distribution family is assumed; fitting it does not test whether it is the right family (see the goodness-of-fit results).',
        ...(Object.keys(fixed).length ? [`Held fixed, not estimated: ${Object.keys(fixed).join(', ')}.`] : []),
      ],
      limitations: [
        WALD_LIMITATION,
        ...(analytic
          ? ['The estimate is exact given the data; the standard errors are still numerical, being derived from a finite-difference Hessian.']
          : ['Nelder–Mead finds a local optimum. Several starting points were used, but a global maximum is not guaranteed.']),
      ],
      exactness,
    },
  };
}

/**
 * Profile-likelihood interval for one parameter: the set of values whose
 * maximised log-likelihood (over the other parameters) is within
 * χ²₁(level)/2 of the overall maximum. More reliable than the Wald interval
 * for small samples because it uses the actual curvature of the likelihood
 * rather than a quadratic approximation, and it cannot cross a bound.
 */
export function profileLikelihoodInterval(
  def: DistributionDef,
  data: ArrayLike<number>,
  fit: FitResult,
  key: string,
  level = 0.95,
): FitInterval {
  const spec = def.params.find((s) => s.key === key);
  if (!spec) throw new EngineError(`${def.name} has no parameter "${key}".`, 'unknown');
  const prep = prepareData(def, data);
  const used = prep.used;
  const others = def.params.filter((s) => s.key !== key && !(s.key in fit.fixedParams));
  const z = normalQuantile(0.5 + level / 2);
  const threshold = (z * z) / 2; // χ²₁(level)/2 = z²/2.
  const llHat = fit.logLikelihood;
  const bound = paramBound(spec);

  const profile = (v: number): number => {
    const base: Params = { ...fit.params, [key]: v };
    if (!others.length) return logLikelihood(def, base, used);
    const objective = (arr: number[]): number => {
      const p: Params = { ...base };
      others.forEach((s, i) => (p[s.key] = arr[i]));
      return -logLikelihood(def, p, used);
    };
    const out = multiStartNelderMead(objective, [others.map((s) => fit.params[s.key])], others.map(paramBound), { maxIterations: 2000, tol: 1e-10 });
    return -out.value;
  };
  const g = (v: number): number => llHat - profile(v) - threshold;

  const est = fit.params[key];
  const se = fit.uncertainty.find((u) => u.key === key)?.standardError ?? Math.max(Math.abs(est) * 0.1, 1e-3);
  const search = (dir: -1 | 1): number => {
    let step = Math.max(se, Math.abs(est) * 1e-3, 1e-6);
    let prev = est;
    for (let i = 0; i < 60; i++) {
      let cand = est + dir * step;
      if (cand <= bound.min) cand = bound.min + (prev - bound.min) / 2;
      if (cand >= bound.max) cand = bound.max - (bound.max - prev) / 2;
      const gv = g(cand);
      if (Number.isFinite(gv) && gv > 0) return brentRoot(g, Math.min(prev, cand), Math.max(prev, cand), { tol: 1e-9, maxIter: 200 });
      prev = cand;
      step *= 1.6;
      if (!Number.isFinite(cand)) break;
    }
    throw new EngineError(
      `The profile likelihood for ${spec.label} does not drop by the required amount within the parameter's range, so the ${(level * 100).toFixed(0)}% limit in that direction is unbounded by this data.`,
      'numerical',
    );
  };
  return {
    low: search(-1),
    high: search(1),
    level,
    method: `Profile likelihood: values of ${spec.symbol} with 2(ln L̂ − ln L_profile) ≤ χ²₁(${level}) = ${(z * z).toPrecision(6)}. Preferred over the Wald interval for small samples, and it respects the parameter's bounds.`,
  };
}
