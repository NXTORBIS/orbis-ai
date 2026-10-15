/**
 * A *marginal* exposure: either a named distribution from the distribution
 * registry or an observed sample. Risk measures of a single marginal are
 * computed exactly where a closed form exists, by Gauss–Legendre quadrature of
 * the quantile function otherwise, and exactly from the order statistics for a
 * sample.
 */
import { EngineError, type Exactness } from '../core/result';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { sortedCopy } from '../stats/descriptive';
import {
  assertLevel,
  empiricalEs,
  empiricalLeftTailVar,
  empiricalVar,
  populationSd,
  sampleMean,
} from './empirical';
import { closedFormNormalRisk } from './measures';
import { gaussLegendreUnit } from './numerics';
import { lawEs, lawLeftTailVar, lawMean, lawVar, makeLaw, type DiscreteLaw, type LatticeLaw } from './discrete';

export type Marginal =
  | { kind: 'distribution'; label: string; id: string; params: Params; scale?: number }
  | { kind: 'sample'; label: string; values: number[] };

export function distributionMarginal(label: string, id: string, params: Params, scale = 1): Marginal {
  const def = getDistribution(id);
  if (!(scale > 0)) throw new EngineError(`${label}: the exposure scale must be greater than 0; received ${scale}.`, 'range');
  void def;
  return { kind: 'distribution', label, id, params, scale };
}

export function sampleMarginal(label: string, values: ArrayLike<number>): Marginal {
  if (values.length < 2) throw new EngineError(`${label}: at least 2 observations are needed.`, 'insufficient');
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) throw new EngineError(`${label}: every observation must be a finite number.`, 'finite');
    out.push(values[i]);
  }
  return { kind: 'sample', label, values: out };
}

export function marginalLabel(m: Marginal, i: number): string {
  return m.label || `Exposure ${i + 1}`;
}

/** The quantile function of the marginal, q(u) = inf{x : F(x) ≥ u}. */
export function marginalQuantile(m: Marginal, u: number): number {
  if (!(u >= 0 && u <= 1)) throw new EngineError(`A quantile level must lie in [0, 1]; received ${u}.`, 'range');
  if (m.kind === 'sample') {
    const sorted = sortedCopy(m.values);
    if (u <= 0) return sorted[0];
    if (u >= 1) return sorted[sorted.length - 1];
    return sorted[Math.min(sorted.length - 1, Math.ceil(u * sorted.length) - 1)];
  }
  const def = getDistribution(m.id);
  return (m.scale ?? 1) * def.quantile(u, m.params);
}

export function marginalMean(m: Marginal): number {
  if (m.kind === 'sample') return sampleMean(sortedCopy(m.values));
  const def = getDistribution(m.id);
  const mom = def.mean(m.params);
  if (!mom.defined) {
    throw new EngineError(`${m.label}: this distribution has no finite mean (${mom.reason}), so no aggregate expectation can be reported.`, 'undefinedMoment');
  }
  if (!Number.isFinite(mom.value)) {
    throw new EngineError(
      `${m.label}: this distribution has an infinite mean, so neither the portfolio expectation nor Expected Shortfall exists for it. Value at Risk is still defined; use a quantile-based measure, or a distribution with a finite tail mean.`,
      'undefinedMoment',
    );
  }
  return (m.scale ?? 1) * mom.value;
}

export function marginalSd(m: Marginal): number {
  if (m.kind === 'sample') return populationSd(sortedCopy(m.values));
  const def = getDistribution(m.id);
  const mom = def.variance(m.params);
  if (!mom.defined) {
    throw new EngineError(`${m.label}: this distribution has no finite variance (${mom.reason}), so it cannot be discretised on a scale derived from it.`, 'undefinedMoment');
  }
  return (m.scale ?? 1) * Math.sqrt(mom.value);
}

export interface MarginalRisk {
  label: string;
  level: number;
  valueAtRisk: number;
  expectedShortfall: number;
  /** Left-tail VaR, (1/α)∫₀^α q(u) du — the best-case counterpart used by the VaR bounds. */
  leftTailVar: number;
  mean: number;
  exactness: Exactness;
  method: string;
}

const GL = gaussLegendreUnit(96);
const SUBSTITUTION_POWER = 3;

/**
 * (1/(b−a))·∫_a^b q(u) du by Gauss–Legendre quadrature after the substitution
 * u = a + (b − a)wᵏ, which concentrates nodes at the singular end of the
 * quantile function. Non-finite nodes mean the tail is not integrable and are
 * refused rather than truncated.
 */
function quantileAverage(m: Marginal, a: number, b: number, towardsUpper: boolean): number {
  const k = SUBSTITUTION_POWER;
  let s = 0;
  for (let i = 0; i < GL.nodes.length; i++) {
    const w = GL.nodes[i];
    const wk = Math.pow(w, k);
    const u = towardsUpper ? b - (b - a) * wk : a + (b - a) * wk;
    const q = marginalQuantile(m, u);
    if (!Number.isFinite(q)) {
      throw new EngineError(
        `${m.label}: the quantile function is not finite at level ${u}, so the tail average over (${a}, ${b}) does not exist. This distribution has an infinite tail mean; Expected Shortfall is undefined for it.`,
        'undefinedMoment',
      );
    }
    s += GL.weights[i] * k * Math.pow(w, k - 1) * q;
  }
  if (!Number.isFinite(s)) throw new EngineError(`${m.label}: the tail average did not converge to a finite value.`, 'numerical');
  return s;
}

export function marginalRisk(m: Marginal, level: number): MarginalRisk {
  assertLevel(level);
  const label = m.label;
  if (m.kind === 'sample') {
    const sorted = sortedCopy(m.values);
    return {
      label,
      level,
      valueAtRisk: empiricalVar(sorted, level),
      expectedShortfall: empiricalEs(sorted, level),
      leftTailVar: empiricalLeftTailVar(sorted, level),
      mean: sampleMean(sorted),
      exactness: 'empirical',
      method: 'Exact functionals of the empirical distribution of the sample (order statistics); subject to sampling error because the sample is finite.',
    };
  }
  const scale = m.scale ?? 1;
  if (m.id === 'normal') {
    const cf = closedFormNormalRisk(scale * m.params.mu, scale * m.params.sigma, level);
    return {
      label,
      level,
      valueAtRisk: cf.valueAtRisk,
      expectedShortfall: cf.expectedShortfall,
      leftTailVar: cf.leftTailVar,
      mean: scale * m.params.mu,
      exactness: 'exact',
      method: cf.formula,
    };
  }
  const def = getDistribution(m.id);
  if (def.kind === 'discrete') {
    // A discrete distribution has a finitely supported law, so every
    // functional is computed exactly instead of by quadrature of a step
    // function (which converges badly).
    const law = marginalExactLaw(m);
    return {
      label,
      level,
      valueAtRisk: lawVar(law, level),
      expectedShortfall: lawEs(law, level),
      leftTailVar: lawLeftTailVar(law, level),
      mean: lawMean(law),
      exactness: 'exact',
      method: 'Exact functionals of the finitely supported law of the distribution, truncated only where the remaining probability is below 1e-14.',
    };
  }
  // A finite tail mean is required for Expected Shortfall to exist at all;
  // without it the quadrature below would return a plausible but meaningless
  // number, so the distribution's own moment is checked first.
  const meanValue = marginalMean(m);
  return {
    label,
    level,
    valueAtRisk: marginalQuantile(m, level),
    expectedShortfall: quantileAverage(m, level, 1, true),
    leftTailVar: quantileAverage(m, 0, level, false),
    mean: meanValue,
    exactness: 'numerical',
    method:
      '96-node Gauss–Legendre quadrature of the quantile function after the substitution u = 1 − (1 − α)w³, which concentrates nodes in the tail. VaR itself is the exact quantile of the stated distribution.',
  };
}

/** Is this marginal supported on the integers? (Then convolution can be exact.) */
export function isIntegerLattice(m: Marginal): boolean {
  if (m.kind === 'sample') return m.values.every((v) => Number.isInteger(v));
  const def = getDistribution(m.id);
  return def.kind === 'discrete' && (m.scale ?? 1) === 1;
}

/**
 * Put the marginal on a lattice (value = origin + j·step) so that independent
 * sums can be formed by convolution. For an integer-valued marginal with
 * step = 1 this is exact; for a continuous marginal each cell takes the
 * probability of the interval around its centre, which costs at most step/2 in
 * any reported quantile.
 */
export function marginalLattice(m: Marginal, step: number, tailProbability = 1e-12): LatticeLaw {
  if (!(step > 0)) throw new EngineError(`${m.label}: the lattice step must be greater than 0.`, 'range');
  const lower = marginalQuantile(m, tailProbability);
  const upper = marginalQuantile(m, 1 - tailProbability);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new EngineError(`${m.label}: the support is unbounded at the ${Number.isFinite(lower) ? 'upper' : 'lower'} end even at probability ${tailProbability}; it cannot be put on a finite lattice.`, 'numerical');
  }
  const firstIndex = Math.floor(lower / step);
  const lastIndex = Math.ceil(upper / step);
  const cells = lastIndex - firstIndex + 1;
  if (cells > 4_000_000) {
    throw new EngineError(
      `${m.label}: discretising this marginal with step ${step} would need ${cells} lattice points, above the limit of 4,000,000. Use a coarser resolution or aggregate by simulation.`,
      'limit',
    );
  }
  const mass = new Float64Array(cells);
  if (m.kind === 'sample') {
    const w = 1 / m.values.length;
    for (const v of m.values) {
      const j = Math.round(v / step) - firstIndex;
      mass[Math.min(cells - 1, Math.max(0, j))] += w;
    }
  } else {
    const def = getDistribution(m.id);
    const scale = m.scale ?? 1;
    if (def.kind === 'discrete' && scale === 1 && step === 1) {
      for (let j = 0; j < cells; j++) mass[j] = def.pdf(firstIndex + j, m.params);
    } else {
      for (let j = 0; j < cells; j++) {
        const centre = (firstIndex + j) * step;
        const lo = (centre - step / 2) / scale;
        const hi = (centre + step / 2) / scale;
        mass[j] = Math.max(0, def.cdf(hi, m.params) - def.cdf(lo, m.params));
      }
    }
  }
  let total = 0;
  for (let j = 0; j < cells; j++) total += mass[j];
  if (!(total > 0)) throw new EngineError(`${m.label}: the discretised marginal carries no probability mass.`, 'numerical');
  for (let j = 0; j < cells; j++) mass[j] /= total;
  return { origin: firstIndex * step, step, mass };
}

/** The marginal as an exact finitely supported law (samples and discrete distributions only). */
export function marginalExactLaw(m: Marginal, tailProbability = 1e-14): DiscreteLaw {
  if (m.kind === 'sample') {
    const n = m.values.length;
    return makeLaw(m.values, new Array<number>(n).fill(1 / n));
  }
  const def = getDistribution(m.id);
  if (def.kind !== 'discrete') {
    throw new EngineError(`${m.label}: ${def.name} is continuous, so it has no exact finite support. Use a lattice discretisation or simulation.`, 'unsupported');
  }
  const scale = m.scale ?? 1;
  const lo = Math.max(def.support(m.params).min, def.quantile(tailProbability, m.params));
  const hi = def.quantile(1 - tailProbability, m.params);
  const vals: number[] = [];
  const ps: number[] = [];
  for (let k = Math.ceil(lo - 1e-9); k <= hi + 1e-9; k++) {
    const p = def.pdf(k, m.params);
    if (p > 0) {
      vals.push(scale * k);
      ps.push(p);
    }
  }
  const total = ps.reduce((a, b) => a + b, 0);
  return makeLaw(vals, ps.map((p) => p / total));
}
