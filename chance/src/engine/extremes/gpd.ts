/**
 * Generalised Pareto distribution (GPD), the limit law for exceedances over a
 * high threshold (Pickands 1975; Coles 2001, §4.2).
 *
 * With y = x − u ≥ 0:
 *
 *   ξ ≠ 0:  F(x) = 1 − (1 + ξy/σ)^(−1/ξ)   on  1 + ξy/σ > 0
 *   ξ = 0:  F(x) = 1 − exp(−y/σ)           on  y ≥ 0     (exponential limit)
 *
 * As with the GEV, ξ = 0 uses the closed exponential form rather than dividing
 * by ξ, and the general branch uses `log1p`/`expm1` so the two agree
 * continuously as ξ → 0.
 *
 *   ξ > 0  heavy (Pareto) tail, no upper bound.
 *   ξ = 0  exponential tail.
 *   ξ < 0  short tail with a finite upper endpoint u − σ/ξ.
 *
 * Closed form, so 'exact' up to floating-point rounding.
 */
import { EngineError } from '../core/result';
import { Random } from '../random/rng';
import type { MomentValue, Support } from './gev';

export interface GpdParams {
  /** Scale σ > 0. */
  scale: number;
  /** Shape ξ. */
  shape: number;
  /** Threshold u (location). Exceedances are measured above this. */
  threshold: number;
}

export function validateGpd(p: GpdParams): void {
  if (!Number.isFinite(p.threshold)) {
    throw new EngineError('GPD threshold u must be a finite number.', 'finite');
  }
  if (!Number.isFinite(p.scale) || p.scale <= 0) {
    throw new EngineError('GPD scale σ must be a finite number greater than 0.', 'range');
  }
  if (!Number.isFinite(p.shape)) {
    throw new EngineError('GPD shape ξ must be a finite number.', 'finite');
  }
}

/** Exact support [u, u − σ/ξ) for ξ < 0, [u, ∞) otherwise. */
export function gpdSupport(p: GpdParams): Support {
  validateGpd(p);
  return {
    lower: p.threshold,
    upper: p.shape < 0 ? p.threshold - p.scale / p.shape : Infinity,
  };
}

export function gpdPdf(x: number, p: GpdParams): number {
  const lp = gpdLogPdf(x, p);
  return lp === -Infinity ? 0 : Math.exp(lp);
}

export function gpdLogPdf(x: number, p: GpdParams): number {
  validateGpd(p);
  const support = gpdSupport(p);
  if (!(x >= support.lower) || x > support.upper) return -Infinity;
  if (p.shape < 0 && x === support.upper) {
    // At the finite endpoint w = 1 + ξy is exactly 0 and the density is
    // w^(−1/ξ−1)/σ: zero for −1 < ξ < 0, the uniform density 1/σ at ξ = −1,
    // and infinite for ξ < −1. Handled explicitly because 0 · (−∞) is NaN.
    if (p.shape > -1) return -Infinity;
    if (p.shape === -1) return -Math.log(p.scale);
    return Infinity;
  }
  const y = (x - p.threshold) / p.scale;
  if (p.shape === 0) return -Math.log(p.scale) - y;
  const w = 1 + p.shape * y;
  if (w <= 0) return -Infinity;
  return -Math.log(p.scale) - (1 / p.shape + 1) * Math.log1p(p.shape * y);
}

export function gpdCdf(x: number, p: GpdParams): number {
  validateGpd(p);
  const support = gpdSupport(p);
  if (x <= support.lower) return 0;
  if (x >= support.upper) return 1;
  return -Math.expm1(gpdLogSf(x, p));
}

/** Survival function, computed in logs so extreme tails keep full precision. */
export function gpdSf(x: number, p: GpdParams): number {
  const ls = gpdLogSf(x, p);
  return ls === -Infinity ? 0 : Math.exp(ls);
}

export function gpdLogSf(x: number, p: GpdParams): number {
  validateGpd(p);
  const support = gpdSupport(p);
  if (x <= support.lower) return 0; // log 1
  if (x >= support.upper) return -Infinity;
  const y = (x - p.threshold) / p.scale;
  if (p.shape === 0) return -y;
  return (-1 / p.shape) * Math.log1p(p.shape * y);
}

/** Quantile: u + σ((1 − p)^(−ξ) − 1)/ξ, and u − σ·ln(1 − p) at ξ = 0. */
export function gpdQuantile(prob: number, p: GpdParams): number {
  validateGpd(p);
  if (!(prob >= 0) || prob > 1) {
    throw new EngineError('GPD quantile requires a probability between 0 and 1.', 'range');
  }
  const support = gpdSupport(p);
  if (prob === 0) return support.lower;
  if (prob === 1) return support.upper;
  const s = 1 - prob; // survival probability, > 0
  if (p.shape === 0) return p.threshold - p.scale * Math.log(s);
  const q = p.threshold + (p.scale * Math.expm1(-p.shape * Math.log(s))) / p.shape;
  return p.shape < 0 ? Math.min(q, support.upper) : Math.max(q, support.lower);
}

export function gpdSample(rng: Random, p: GpdParams): number {
  return gpdQuantile(rng.uniformOpen(), p);
}

/** Mean u + σ/(1 − ξ); infinite (reported as undefined) for ξ ≥ 1. */
export function gpdMean(p: GpdParams): MomentValue {
  validateGpd(p);
  if (p.shape >= 1) {
    return {
      value: null,
      undefinedReason:
        'The GPD mean is infinite for ξ ≥ 1: the tail is so heavy that the expected exceedance does not exist. No finite average loss can be quoted.',
    };
  }
  return { value: p.threshold + p.scale / (1 - p.shape) };
}

/** Variance σ²/((1 − ξ)²(1 − 2ξ)); infinite for ξ ≥ 1/2. */
export function gpdVariance(p: GpdParams): MomentValue {
  validateGpd(p);
  if (p.shape >= 0.5) {
    return { value: null, undefinedReason: 'The GPD variance is infinite for ξ ≥ 1/2.' };
  }
  const a = 1 - p.shape;
  return { value: (p.scale * p.scale) / (a * a * (1 - 2 * p.shape)) };
}

/**
 * Mean excess over a higher threshold v ≥ u: E[X − v | X > v] = (σ + ξ(v − u))/(1 − ξ).
 * Linear in v — the fact the mean residual life plot exploits.
 */
export function gpdMeanExcess(v: number, p: GpdParams): MomentValue {
  validateGpd(p);
  if (v < p.threshold) {
    throw new EngineError('Mean excess requires a level at or above the GPD threshold.', 'range');
  }
  if (p.shape >= 1) {
    return { value: null, undefinedReason: 'The mean excess is infinite for ξ ≥ 1.' };
  }
  return { value: (p.scale + p.shape * (v - p.threshold)) / (1 - p.shape) };
}
