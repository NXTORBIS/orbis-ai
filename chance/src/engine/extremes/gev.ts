/**
 * Generalised extreme value (GEV) distribution.
 *
 * Parameterisation (Coles 2001, §3.1), with z = (x − μ)/σ:
 *
 *   ξ ≠ 0:  F(x) = exp(−(1 + ξz)^(−1/ξ))   on  1 + ξz > 0
 *   ξ = 0:  F(x) = exp(−exp(−z))           on  ℝ        (Gumbel limit)
 *
 * The ξ = 0 case is the *limit* of the other two, not a separate model, so it
 * is evaluated with the closed Gumbel form instead of dividing by ξ. For small
 * non-zero ξ the general form stays accurate because (1/ξ)·log1p(ξz) is
 * computed with `log1p`, which is exact to machine precision as its argument
 * goes to zero. The two branches therefore agree continuously at ξ → 0.
 *
 * Shape regimes:
 *   ξ > 0  Fréchet type   — heavy tail, bounded below by μ − σ/ξ, no upper bound.
 *   ξ = 0  Gumbel type    — light (exponential) tail, unbounded both ways.
 *   ξ < 0  Weibull type   — bounded above by μ − σ/ξ (a finite worst case).
 *
 * All formulas here are closed form, so results are 'exact' in the engine's
 * sense: the only error is floating-point rounding. Fitted parameters are not,
 * and are labelled 'numerical' where they are produced.
 */
import { EngineError } from '../core/result';
import { gammaFn } from '../special/gamma';
import { Random } from '../random/rng';

export interface GevParams {
  /** Location μ. */
  location: number;
  /** Scale σ > 0. */
  scale: number;
  /** Shape ξ. */
  shape: number;
}

export interface Support {
  lower: number;
  upper: number;
}

export function validateGev(p: GevParams): void {
  if (!Number.isFinite(p.location)) {
    throw new EngineError('GEV location μ must be a finite number.', 'finite');
  }
  if (!Number.isFinite(p.scale) || p.scale <= 0) {
    throw new EngineError('GEV scale σ must be a finite number greater than 0.', 'range');
  }
  if (!Number.isFinite(p.shape)) {
    throw new EngineError('GEV shape ξ must be a finite number.', 'finite');
  }
}

/** Exact support of the GEV. The finite endpoint μ − σ/ξ is attained as a bound. */
export function gevSupport(p: GevParams): Support {
  validateGev(p);
  const { location: mu, scale: sigma, shape: xi } = p;
  if (xi === 0) return { lower: -Infinity, upper: Infinity };
  const endpoint = mu - sigma / xi;
  return xi > 0 ? { lower: endpoint, upper: Infinity } : { lower: -Infinity, upper: endpoint };
}

/**
 * −log of the "reduced variable" t(x) = (1 + ξz)^(−1/ξ); returns
 * logT = log t(x), or −Infinity / +Infinity outside the support.
 */
function logReducedVariable(x: number, p: GevParams): number {
  const z = (x - p.location) / p.scale;
  if (p.shape === 0) return -z; // log(exp(−z))
  const w = 1 + p.shape * z;
  if (w <= 0) {
    // Beyond the endpoint. t → ∞ below a ξ>0 lower bound, t → 0 above a ξ<0 upper bound.
    return p.shape > 0 ? Infinity : -Infinity;
  }
  return (-1 / p.shape) * Math.log1p(p.shape * z);
}

/** Probability density. Exactly 0 outside the support. */
export function gevPdf(x: number, p: GevParams): number {
  validateGev(p);
  if (!Number.isFinite(x)) return 0;
  const support = gevSupport(p);
  if (x <= support.lower || x >= support.upper) return 0;
  const logT = logReducedVariable(x, p);
  if (!Number.isFinite(logT)) return 0;
  const t = Math.exp(logT);
  // f = (1/σ) t^(ξ+1) e^(−t); in logs to avoid overflow for large t.
  const logF = -Math.log(p.scale) + (p.shape + 1) * logT - t;
  return Math.exp(logF);
}

export function gevLogPdf(x: number, p: GevParams): number {
  validateGev(p);
  const support = gevSupport(p);
  if (!(x > support.lower) || !(x < support.upper)) return -Infinity;
  const logT = logReducedVariable(x, p);
  if (!Number.isFinite(logT)) return -Infinity;
  return -Math.log(p.scale) + (p.shape + 1) * logT - Math.exp(logT);
}

/** Cumulative distribution function. Exactly 0 / 1 outside the support. */
export function gevCdf(x: number, p: GevParams): number {
  validateGev(p);
  const support = gevSupport(p);
  if (x <= support.lower) return 0;
  if (x >= support.upper) return 1;
  const logT = logReducedVariable(x, p);
  if (logT === Infinity) return 0;
  if (logT === -Infinity) return 1;
  return Math.exp(-Math.exp(logT));
}

/** Survival function 1 − F(x), computed directly so the far tail keeps precision. */
export function gevSf(x: number, p: GevParams): number {
  validateGev(p);
  const support = gevSupport(p);
  if (x <= support.lower) return 1;
  if (x >= support.upper) return 0;
  const logT = logReducedVariable(x, p);
  if (logT === Infinity) return 1;
  if (logT === -Infinity) return 0;
  return -Math.expm1(-Math.exp(logT));
}

/**
 * Quantile function. x_p = μ + σ·((−ln p)^(−ξ) − 1)/ξ, with the Gumbel limit
 * μ − σ·ln(−ln p) at ξ = 0. The result never crosses a finite support endpoint.
 */
export function gevQuantile(prob: number, p: GevParams): number {
  validateGev(p);
  if (!(prob >= 0) || prob > 1) {
    throw new EngineError('GEV quantile requires a probability between 0 and 1.', 'range');
  }
  const support = gevSupport(p);
  if (prob === 0) return support.lower;
  if (prob === 1) return support.upper;
  const y = -Math.log(prob); // y > 0
  if (p.shape === 0) return p.location - p.scale * Math.log(y);
  // (y^(−ξ) − 1)/ξ written with expm1 so it stays accurate as ξ → 0.
  const q = p.location + (p.scale * Math.expm1(-p.shape * Math.log(y))) / p.shape;
  if (p.shape < 0) return Math.min(q, support.upper);
  return Math.max(q, support.lower);
}

/** Draw one GEV variate by inverting the cdf at a uniform in (0, 1). */
export function gevSample(rng: Random, p: GevParams): number {
  return gevQuantile(rng.uniformOpen(), p);
}

export interface MomentValue {
  /** The moment, or null when it does not exist. */
  value: number | null;
  /** Why it does not exist, when it does not. */
  undefinedReason?: string;
}

/**
 * Mean. Exists only for ξ < 1.
 *   ξ = 0: μ + σγ (γ = Euler–Mascheroni)
 *   ξ ≠ 0: μ + σ(Γ(1 − ξ) − 1)/ξ
 */
export const EULER_MASCHERONI = 0.5772156649015329;

export function gevMean(p: GevParams): MomentValue {
  validateGev(p);
  if (p.shape >= 1) {
    return {
      value: null,
      undefinedReason: 'The GEV mean is infinite for ξ ≥ 1; the tail is too heavy for a finite expectation.',
    };
  }
  if (p.shape === 0) return { value: p.location + p.scale * EULER_MASCHERONI };
  return { value: p.location + (p.scale * (gammaFn(1 - p.shape) - 1)) / p.shape };
}

/** Variance. Exists only for ξ < 1/2. ξ = 0: σ²π²/6. */
export function gevVariance(p: GevParams): MomentValue {
  validateGev(p);
  if (p.shape >= 0.5) {
    return {
      value: null,
      undefinedReason: 'The GEV variance is infinite for ξ ≥ 1/2.',
    };
  }
  if (p.shape === 0) return { value: (p.scale * p.scale * Math.PI * Math.PI) / 6 };
  const g1 = gammaFn(1 - p.shape);
  const g2 = gammaFn(1 - 2 * p.shape);
  return { value: (p.scale * p.scale * (g2 - g1 * g1)) / (p.shape * p.shape) };
}

/** Median: μ + σ((ln 2)^(−ξ) − 1)/ξ, and μ − σ·ln(ln 2) at ξ = 0. */
export function gevMedian(p: GevParams): number {
  return gevQuantile(0.5, p);
}
