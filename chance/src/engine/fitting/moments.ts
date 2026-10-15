/**
 * Method-of-moments estimation: a second, independent route to parameters.
 *
 * It is not as efficient as maximum likelihood, and that is the point —
 * because it uses different information (low-order sample moments rather than
 * the whole likelihood), a large disagreement between the two estimates is
 * diagnostic. It usually means the family is wrong, the tail is heavier than
 * the family allows, or a few extreme observations are dominating the moments.
 *
 * Sample central moments here divide by n (the population convention), which
 * is what the moment equations are written for.
 */
import { EngineError } from '../core/result';
import { validateParams, defaultParams } from '../distributions/registry';
import type { DistributionDef, Moment, Params } from '../distributions/types';
import { multiStartNelderMead, paramBound } from './optimize';

export interface MomentFit {
  params: Params;
  closedForm: boolean;
  converged: boolean;
  iterations: number;
  /** Moments matched, e.g. ['mean', 'variance']. */
  matched: string[];
  formula: string;
}

interface SampleMoments {
  n: number;
  mean: number;
  variance: number;
  skewness: number;
}

export function sampleMoments(data: readonly number[]): SampleMoments {
  const n = data.length;
  let m = 0;
  for (const x of data) m += x;
  m /= n;
  let m2 = 0;
  let m3 = 0;
  for (const x of data) {
    const d = x - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  return { n, mean: m, variance: m2, skewness: m2 > 0 ? m3 / Math.pow(m2, 1.5) : NaN };
}

function closedForm(def: DistributionDef, s: SampleMoments): { params: Params; matched: string[]; formula: string } | null {
  const { mean: m, variance: v } = s;
  switch (def.id) {
    case 'normal':
      return { params: { mu: m, sigma: Math.sqrt(v) }, matched: ['mean', 'variance'], formula: 'μ = x̄, σ = √m₂' };
    case 'exponential':
      return { params: { lambda: 1 / m }, matched: ['mean'], formula: 'λ = 1/x̄' };
    case 'poisson':
      return { params: { lambda: m }, matched: ['mean'], formula: 'λ = x̄' };
    case 'bernoulli':
      return { params: { p: m }, matched: ['mean'], formula: 'p = x̄' };
    case 'geometric':
      return { params: { p: 1 / m }, matched: ['mean'], formula: 'p = 1/x̄' };
    case 'gamma':
      return { params: { k: (m * m) / v, theta: v / m }, matched: ['mean', 'variance'], formula: 'k = x̄²/m₂, θ = m₂/x̄' };
    case 'lognormal': {
      const phi = 1 + v / (m * m);
      return { params: { mu: Math.log(m / Math.sqrt(phi)), sigma: Math.sqrt(Math.log(phi)) }, matched: ['mean', 'variance'], formula: 'σ² = ln(1 + m₂/x̄²), μ = ln x̄ − σ²/2' };
    }
    case 'uniform': {
      const h = Math.sqrt(3 * v);
      return { params: { a: m - h, b: m + h }, matched: ['mean', 'variance'], formula: 'a = x̄ − √(3m₂), b = x̄ + √(3m₂)' };
    }
    case 'beta': {
      const c = (m * (1 - m)) / v - 1;
      return { params: { alpha: m * c, beta: (1 - m) * c }, matched: ['mean', 'variance'], formula: 'α = x̄·c, β = (1−x̄)·c with c = x̄(1−x̄)/m₂ − 1' };
    }
    case 'negativeBinomial': {
      if (!(v > m)) {
        throw new EngineError(
          `Method of moments cannot fit a negative binomial here: the sample variance (${v.toPrecision(6)}) is not greater than the mean (${m.toPrecision(6)}), and the negative binomial is always over-dispersed. The data are under-dispersed relative to a Poisson.`,
          'degenerate',
        );
      }
      return { params: { p: m / v, r: (m * m) / (v - m) }, matched: ['mean', 'variance'], formula: 'p = x̄/m₂, r = x̄²/(m₂ − x̄)' };
    }
    case 'pareto': {
      // m₂/x̄² = 1/(α(α−2)) ⇒ α = 1 + √(1 + x̄²/m₂); needs α > 2 for a finite variance.
      const alpha = 1 + Math.sqrt(1 + (m * m) / v);
      return { params: { alpha, xm: (m * (alpha - 1)) / alpha }, matched: ['mean', 'variance'], formula: 'α = 1 + √(1 + x̄²/m₂), xₘ = x̄(α−1)/α' };
    }
    case 'cauchy':
      throw new EngineError('The Cauchy distribution has no finite mean or variance, so method of moments does not exist for it.', 'undefined');
    default:
      return null;
  }
}

/**
 * Method-of-moments estimates, or null when the distribution's free
 * parameters cannot be matched to the available moments. Throws when the
 * moment equations have no admissible solution for this data (which is itself
 * informative and must not be papered over).
 */
export function momentEstimates(def: DistributionDef, data: readonly number[], fixed: Params = {}): MomentFit | null {
  const s = sampleMoments(data);
  if (!(s.variance > 0)) throw new EngineError('The sample has zero variance, so no moment equations can be solved.', 'degenerate');
  const free = def.params.filter((p) => !(p.key in fixed));
  if (!free.length) return null;
  if (!Object.keys(fixed).length) {
    const cf = closedForm(def, s);
    if (cf) {
      const params = { ...defaultParams(def), ...cf.params };
      if (validateParams(def, params).length) return null;
      return { params, closedForm: true, converged: true, iterations: 0, matched: cf.matched, formula: cf.formula };
    }
  }
  // Generic route: match as many moments as there are free parameters, in the
  // order mean, variance, skewness. Scaled so no single moment dominates.
  const momentValue = (m: Moment): number => (m.defined ? m.value : NaN);
  const targets: { name: string; value: number; of: (p: Params) => number }[] = [
    { name: 'mean', value: s.mean, of: (p: Params) => momentValue(def.mean(p)) },
    { name: 'variance', value: s.variance, of: (p: Params) => momentValue(def.variance(p)) },
    { name: 'skewness', value: s.skewness, of: (p: Params) => momentValue(def.skewness(p)) },
  ].slice(0, Math.min(3, free.length));
  if (targets.length < free.length) return null;
  const base = { ...defaultParams(def), ...fixed };
  const objective = (v: number[]): number => {
    const p: Params = { ...base };
    free.forEach((spec, i) => (p[spec.key] = v[i]));
    if (validateParams(def, p).length) return Infinity;
    let total = 0;
    for (const t of targets) {
      const th = t.of(p);
      if (!Number.isFinite(th)) return Infinity;
      const scale = Math.max(Math.abs(t.value), 1e-8);
      total += ((th - t.value) / scale) ** 2;
    }
    return total;
  };
  const start = free.map((spec) => base[spec.key]);
  const out = multiStartNelderMead(objective, [start, start.map((x) => x * 2), start.map((x) => x / 2)], free.map(paramBound), { maxIterations: 2000, tol: 1e-12 });
  if (!out.converged || !Number.isFinite(out.value)) return null;
  const params = { ...base };
  free.forEach((spec, i) => (params[spec.key] = out.x[i]));
  if (validateParams(def, params).length) return null;
  return {
    params,
    closedForm: false,
    converged: true,
    iterations: out.iterations,
    matched: targets.map((t) => t.name),
    formula: `Numerical solution of the moment equations for ${targets.map((t) => t.name).join(', ')}`,
  };
}
