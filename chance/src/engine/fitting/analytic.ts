/**
 * Closed-form maximum likelihood estimators.
 *
 * These are used in preference to numerical optimisation wherever they exist:
 * they are exact given the data, they cannot fail to converge, and they give
 * the numerical optimiser something to be validated against.
 *
 * Note on the normal and log-normal: the maximum likelihood estimate of the
 * variance divides by n, not n − 1. The n − 1 version is the unbiased
 * estimator, which is a different thing and is NOT the MLE.
 */
import { EngineError } from '../core/result';
import type { Params } from '../distributions/types';

export interface AnalyticFit {
  params: Params;
  /** Formula actually used, for the explanation. */
  formula: string;
  steps: { label: string; expression?: string; value?: string }[];
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const meanOf = (xs: readonly number[]): number => sum(xs) / xs.length;

/** MLE variance: divides by n (this is deliberate — see the file comment). */
function biasedVariance(xs: readonly number[], m: number): number {
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return s / xs.length;
}

/** Distributions with a closed-form MLE over all of their parameters. */
export const ANALYTIC_MLE_IDS = [
  'normal',
  'exponential',
  'poisson',
  'lognormal',
  'uniform',
  'discreteUniform',
  'pareto',
  'geometric',
  'bernoulli',
] as const;

export function hasAnalyticMle(id: string): boolean {
  return (ANALYTIC_MLE_IDS as readonly string[]).includes(id);
}

/**
 * Closed-form MLE for `id`, or null if there is none. Throws an EngineError
 * when the data make the estimator undefined (for example zero variance for a
 * normal, where no finite σ maximises the likelihood).
 */
export function analyticMle(id: string, data: readonly number[]): AnalyticFit | null {
  const n = data.length;
  switch (id) {
    case 'normal': {
      const mu = meanOf(data);
      const v = biasedVariance(data, mu);
      if (!(v > 0)) {
        throw new EngineError(
          'Every observation is identical, so the normal likelihood has no maximum over σ > 0 (it increases without bound as σ → 0). A normal distribution cannot be fitted to constant data.',
          'degenerate',
        );
      }
      return {
        params: { mu, sigma: Math.sqrt(v) },
        formula: 'μ̂ = x̄,  σ̂² = (1/n) Σ (xᵢ − x̄)²',
        steps: [
          { label: 'Sample mean', expression: 'x̄ = Σxᵢ / n', value: String(mu) },
          { label: 'MLE variance (divides by n, not n − 1)', expression: 'σ̂² = Σ(xᵢ − x̄)² / n', value: String(v) },
        ],
      };
    }
    case 'exponential': {
      const m = meanOf(data);
      if (!(m > 0)) throw new EngineError('The exponential MLE λ̂ = 1/x̄ needs a strictly positive sample mean.', 'degenerate');
      return {
        params: { lambda: 1 / m },
        formula: 'λ̂ = 1 / x̄',
        steps: [{ label: 'Sample mean', value: String(m) }, { label: 'Rate', expression: 'λ̂ = 1/x̄', value: String(1 / m) }],
      };
    }
    case 'poisson': {
      const m = meanOf(data);
      if (!(m > 0)) throw new EngineError('Every count is 0, so the Poisson MLE λ̂ = x̄ = 0 lies on the boundary λ > 0 and is not an admissible fit.', 'degenerate');
      return { params: { lambda: m }, formula: 'λ̂ = x̄', steps: [{ label: 'Sample mean of counts', value: String(m) }] };
    }
    case 'bernoulli': {
      const m = meanOf(data);
      return { params: { p: m }, formula: 'p̂ = x̄ (the observed success proportion)', steps: [{ label: 'Success proportion', value: String(m) }] };
    }
    case 'lognormal': {
      const logs = data.map((x) => Math.log(x));
      const mu = meanOf(logs);
      const v = biasedVariance(logs, mu);
      if (!(v > 0)) throw new EngineError('All log-values are identical, so no finite σ > 0 maximises the log-normal likelihood.', 'degenerate');
      return {
        params: { mu, sigma: Math.sqrt(v) },
        formula: 'μ̂ = mean(ln x),  σ̂² = (1/n) Σ (ln xᵢ − μ̂)²',
        steps: [
          { label: 'Mean of the logs', value: String(mu) },
          { label: 'MLE variance of the logs (divides by n)', value: String(v) },
        ],
      };
    }
    case 'uniform': {
      const a = Math.min(...data);
      const b = Math.max(...data);
      if (!(b > a)) throw new EngineError('All observations are identical, so the uniform MLE gives a zero-width interval with infinite density.', 'degenerate');
      return {
        params: { a, b },
        formula: 'â = min xᵢ,  b̂ = max xᵢ',
        steps: [{ label: 'Lower bound', value: String(a) }, { label: 'Upper bound', value: String(b) }],
      };
    }
    case 'discreteUniform': {
      const a = Math.min(...data);
      const b = Math.max(...data);
      return {
        params: { a, b },
        formula: 'â = min kᵢ,  b̂ = max kᵢ',
        steps: [{ label: 'Lower bound', value: String(a) }, { label: 'Upper bound', value: String(b) }],
      };
    }
    case 'pareto': {
      const xm = Math.min(...data);
      if (!(xm > 0)) throw new EngineError('A Pareto fit needs strictly positive observations.', 'support');
      let s = 0;
      for (const x of data) s += Math.log(x / xm);
      if (!(s > 0)) throw new EngineError('All observations equal the sample minimum, so the Pareto tail index α̂ = n / Σ ln(xᵢ/x̂ₘ) is undefined (the denominator is 0).', 'degenerate');
      return {
        params: { xm, alpha: n / s },
        formula: 'x̂ₘ = min xᵢ,  α̂ = n / Σ ln(xᵢ / x̂ₘ)',
        steps: [
          { label: 'Scale (sample minimum)', value: String(xm) },
          { label: 'Tail index', expression: 'α̂ = n / Σ ln(xᵢ/x̂ₘ)', value: String(n / s) },
        ],
      };
    }
    case 'geometric': {
      // This registry's geometric counts trials including the success, support {1,2,…}.
      const m = meanOf(data);
      if (!(m >= 1)) throw new EngineError('This geometric distribution counts trials including the success, so every observation must be at least 1.', 'support');
      return {
        params: { p: 1 / m },
        formula: 'p̂ = 1 / x̄  (trials-until-success parameterisation)',
        steps: [{ label: 'Mean number of trials', value: String(m) }, { label: 'Success probability', value: String(1 / m) }],
      };
    }
    default:
      return null;
  }
}
