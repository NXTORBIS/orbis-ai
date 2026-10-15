/**
 * Maximum likelihood with right-censored observations.
 *
 * A right-censored observation says only "the value is at least t" — the unit
 * was still working when observation stopped. Treating t as if it were the
 * event time biases every lifetime estimate downwards, which is the single
 * most common error in reliability data. The censored likelihood uses the
 * survival function for those observations:
 *
 *   ln L = Σ_events ln f(tᵢ) + Σ_censored ln S(tᵢ)
 */
import { EngineError, type Explanation } from '../core/result';
import { defaultParams, validateParams } from '../distributions/registry';
import type { DistributionDef, Params } from '../distributions/types';
import { momentEstimates } from './moments';
import { multiStartNelderMead, paramBound } from './optimize';
import { aiccOf, NON_REGULAR, prepareData, uncertaintyFromNll, WALD_LIMITATION } from './mle';
import type { FitOptions } from './mle';
import type { FitResult } from './types';

export interface CensoredObservation {
  /** Observed time: the event time, or the time observation stopped. */
  time: number;
  /** True when the unit had not failed by `time` (right-censored). */
  censored: boolean;
}

export function censoredLogLikelihood(def: DistributionDef, params: Params, obs: readonly CensoredObservation[]): number {
  if (validateParams(def, params).length) return -Infinity;
  let total = 0;
  for (const o of obs) {
    if (o.censored) {
      const s = def.sf(o.time, params);
      if (!(s > 0)) return -Infinity;
      total += Math.log(s);
    } else {
      const lp = def.logPdf(o.time, params);
      if (!Number.isFinite(lp)) return -Infinity;
      total += lp;
    }
  }
  return total;
}

/**
 * Fit a distribution to right-censored data. The exponential case is closed
 * form (λ̂ = events / total time on test); everything else is optimised
 * numerically and must converge or no fit is returned.
 */
export function fitRightCensored(def: DistributionDef, obs: readonly CensoredObservation[], options: FitOptions = {}): FitResult {
  const fixed = { ...(options.fixed ?? {}) };
  const level = options.level ?? 0.95;
  const clean: CensoredObservation[] = [];
  let discarded = 0;
  for (const o of obs) {
    if (Number.isFinite(o.time)) clean.push(o);
    else discarded++;
  }
  const reasons = discarded ? [`${discarded} observation(s) discarded: the time was not a finite number.`] : [];
  if (!clean.length) throw new EngineError('No finite observations were supplied.', 'empty');
  // Support compatibility is the same question as for uncensored data.
  prepareData(def, clean.map((o) => o.time));
  const events = clean.filter((o) => !o.censored);
  const nEvents = events.length;
  const specs = def.params.filter((s) => !(s.key in fixed));
  const k = specs.length;
  if (nEvents < k + 1) {
    throw new EngineError(
      `Only ${nEvents} of ${clean.length} observations are actual events (the rest are censored). Estimating ${k} parameter(s) needs more than ${k} events: censored observations carry information but cannot by themselves locate the distribution.`,
      'insufficient',
    );
  }
  if (specs.some((s) => s.integer)) {
    throw new EngineError(`${def.name} has whole-number parameters that are design constants, not quantities to estimate from censored data. Supply them as fixed values.`, 'unsupported');
  }

  const warnings = [...reasons];
  const nll = (p: Params): number => -censoredLogLikelihood(def, p, clean);
  let params: Params;
  let converged: boolean;
  let iterations: number;
  let message: string;
  let exactness: FitResult['exactness'];
  const steps: Explanation['steps'] = [];

  if (def.id === 'exponential' && !Object.keys(fixed).length) {
    let totalTime = 0;
    for (const o of clean) totalTime += o.time;
    if (!(totalTime > 0)) throw new EngineError('The total time on test is 0, so no rate can be estimated.', 'degenerate');
    params = { lambda: nEvents / totalTime };
    converged = true;
    iterations = 0;
    message = 'Closed-form censored estimator: no iteration required.';
    exactness = 'exact';
    steps.push(
      { label: 'Events (uncensored failures)', value: String(nEvents) },
      { label: 'Total time on test (all observations, censored included)', value: String(totalTime) },
      { label: 'Rate', expression: 'λ̂ = events / total time on test', value: String(nEvents / totalTime) },
    );
  } else {
    const start = momentEstimates(def, events.map((o) => o.time), fixed);
    const base = { ...defaultParams(def), ...fixed, ...(start?.params ?? {}) };
    const starts = [specs.map((s) => base[s.key]), specs.map((s) => base[s.key] * 1.5), specs.map((s) => base[s.key] * 0.6)];
    const objective = (v: number[]): number => {
      const p: Params = { ...defaultParams(def), ...fixed };
      specs.forEach((s, i) => (p[s.key] = v[i]));
      return nll(p);
    };
    const out = multiStartNelderMead(objective, starts, specs.map(paramBound), { maxIterations: 4000, tol: 1e-11 });
    if (!out.converged || !Number.isFinite(out.value)) {
      throw new EngineError(`The censored likelihood optimisation for ${def.name} did not converge; no fit is reported.`, 'numerical');
    }
    params = { ...defaultParams(def), ...fixed };
    specs.forEach((s, i) => (params[s.key] = out.x[i]));
    const issues = validateParams(def, params);
    if (issues.length) throw new EngineError(issues);
    converged = true;
    iterations = out.iterations;
    message = out.message;
    exactness = 'numerical';
    steps.push({ label: 'Optimiser', value: `Nelder–Mead on the censored log-likelihood, ${out.restarts} starts, ${out.iterations} iterations` });
  }

  const ll = censoredLogLikelihood(def, params, clean);
  if (!Number.isFinite(ll)) throw new EngineError('The censored log-likelihood at the fitted parameters is not finite.', 'numerical');
  const { uncertainty, warnings: uw } = uncertaintyFromNll(def, params, nll, specs, level);
  warnings.push(...uw);
  const n = clean.length;
  const aic = 2 * k - 2 * ll;
  const censoredCount = n - nEvents;
  if (censoredCount / n > 0.8) {
    warnings.push(`${censoredCount} of ${n} observations (${((100 * censoredCount) / n).toFixed(0)}%) are censored. With so little observed failure the fit depends heavily on the assumed family, especially in the tail.`);
  }
  steps.push(
    { label: 'Censored observations', value: `${censoredCount} of ${n}` },
    { label: 'Censored log-likelihood', expression: 'ln L = Σ_events ln f(tᵢ) + Σ_censored ln S(tᵢ)', value: String(ll) },
  );
  return {
    distributionId: def.id,
    distributionName: def.name,
    params,
    fixedParams: fixed,
    estimatedParams: k,
    logLikelihood: ll,
    n,
    nDiscarded: discarded,
    discardReasons: reasons,
    method: 'censored-mle',
    exactness,
    convergence: { converged, iterations, message },
    uncertainty,
    aic,
    aicc: aiccOf(aic, k, n),
    bic: k * Math.log(n) - 2 * ll,
    warnings,
    explanation: {
      method: `Right-censored maximum likelihood for the ${def.name} distribution.`,
      formula: 'ln L = Σ_events ln f(tᵢ) + Σ_censored ln S(tᵢ)',
      steps,
      assumptions: [
        'Censoring is independent of the failure process (non-informative censoring): a unit being censored says nothing about when it would have failed.',
        'Observations are independent.',
      ],
      limitations: [
        WALD_LIMITATION,
        'Only right censoring is handled. Left-censored and interval-censored observations need a different likelihood.',
        ...(NON_REGULAR[def.id]?.length ? ['Some parameters of this family are support endpoints, for which the observed information gives no standard error.'] : []),
      ],
      exactness,
    },
  };
}
