/**
 * Numerical machinery shared by the copula families: Gauss–Legendre
 * quadrature, the bivariate normal and bivariate Student-t distribution
 * functions, and the Debye functions used by the Frank copula.
 *
 * Nothing here is approximated silently: every routine either returns a value
 * whose accuracy is documented in the copula definition's `limitations`, or
 * throws an `EngineError` saying what is out of range.
 */
import { clamp } from '../core/numeric';
import { EngineError } from '../core/result';
import { normalCdf } from '../special/gamma';
import { getDistribution } from '../distributions/registry';

export interface GaussLegendreRule {
  /** Nodes on [−1, 1]. */
  readonly x: readonly number[];
  /** Weights on [−1, 1] (they sum to 2). */
  readonly w: readonly number[];
}

const RULES = new Map<number, GaussLegendreRule>();

/**
 * Nodes and weights of the n-point Gauss–Legendre rule on [−1, 1], obtained by
 * Newton iteration on the Legendre polynomial. Cached per n.
 */
export function gaussLegendre(n: number): GaussLegendreRule {
  if (!Number.isInteger(n) || n < 1) {
    throw new EngineError('A Gauss–Legendre rule needs a positive whole number of nodes.', 'range');
  }
  const cached = RULES.get(n);
  if (cached) return cached;
  const x = new Array<number>(n).fill(0);
  const w = new Array<number>(n).fill(0);
  const half = (n + 1) >> 1;
  for (let i = 0; i < half; i++) {
    // Initial guess (Abramowitz & Stegun 25.4.30).
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 1;
    for (let iter = 0; iter < 100; iter++) {
      let p0 = 1;
      let p1 = z;
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (z * p1 - p0)) / (z * z - 1);
      const step = p1 / dp;
      z -= step;
      if (Math.abs(step) < 1e-16) break;
    }
    x[i] = -z;
    x[n - 1 - i] = z;
    const weight = 2 / ((1 - z * z) * dp * dp);
    w[i] = weight;
    w[n - 1 - i] = weight;
  }
  const rule: GaussLegendreRule = { x, w };
  RULES.set(n, rule);
  return rule;
}

/** Integrate f over [a, b] with the n-point Gauss–Legendre rule. */
export function integrate(f: (t: number) => number, a: number, b: number, n = 48): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new EngineError('Gauss–Legendre integration needs finite limits.', 'range');
  }
  if (a === b) return 0;
  const { x, w } = gaussLegendre(n);
  const mid = 0.5 * (a + b);
  const halfWidth = 0.5 * (b - a);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += w[i] * f(mid + halfWidth * x[i]);
  return s * halfWidth;
}

/** Composite Gauss–Legendre: [a, b] split into `segments` panels of n nodes. */
export function integrateComposite(
  f: (t: number) => number,
  a: number,
  b: number,
  segments: number,
  n = 24,
): number {
  if (segments < 1) throw new EngineError('At least one integration panel is required.', 'range');
  const h = (b - a) / segments;
  let total = 0;
  for (let s = 0; s < segments; s++) total += integrate(f, a + s * h, a + (s + 1) * h, n);
  return total;
}

/**
 * Bivariate standard normal distribution function P(X ≤ h, Y ≤ k) with
 * correlation ρ, using the Sheppard/Drezner–Wesolowsky identity
 *
 *   Φ₂(h, k, ρ) = Φ(h)·Φ(k) + (1/2π)·∫₀^{arcsin ρ} exp(−(h² − 2hk·sinθ + k²)/(2cos²θ)) dθ
 *
 * which follows from ∂Φ₂/∂ρ = φ₂(h, k, ρ) and the substitution ρ = sin θ. The
 * integrand is bounded and smooth, so a fixed 48-point Gauss–Legendre rule is
 * used. The perfect-correlation cases are handled in closed form.
 */
export function bivariateNormalCdf(h: number, k: number, rho: number): number {
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
    throw new EngineError(`The correlation must lie in [−1, 1]; received ${rho}.`, 'range');
  }
  if (Number.isNaN(h) || Number.isNaN(k)) {
    throw new EngineError('The bivariate normal CDF needs numeric arguments.', 'finite');
  }
  if (h === -Infinity || k === -Infinity) return 0;
  if (h === Infinity && k === Infinity) return 1;
  if (h === Infinity) return normalCdf(k);
  if (k === Infinity) return normalCdf(h);
  const ph = normalCdf(h);
  const pk = normalCdf(k);
  if (rho >= 1 - 1e-14) return Math.min(ph, pk);
  if (rho <= -1 + 1e-14) return Math.max(0, ph + pk - 1);
  if (rho === 0) return ph * pk;
  const upper = Math.asin(rho);
  const extra = integrate(
    (theta) => {
      const s = Math.sin(theta);
      const c2 = Math.cos(theta) ** 2;
      return Math.exp(-(h * h - 2 * h * k * s + k * k) / (2 * c2));
    },
    0,
    upper,
    48,
  );
  return clamp(ph * pk + extra / (2 * Math.PI), 0, 1);
}

/** Bivariate standard normal density with correlation ρ. */
export function bivariateNormalPdf(h: number, k: number, rho: number): number {
  const d = 1 - rho * rho;
  if (!(d > 0)) {
    throw new EngineError('The bivariate normal density is singular when |ρ| = 1.', 'range');
  }
  return Math.exp(-(h * h - 2 * rho * h * k + k * k) / (2 * d)) / (2 * Math.PI * Math.sqrt(d));
}

const CHI_SQUARE = getDistribution('chiSquare');
const T_MIXTURE_NODES = 64;
const chiQuantileCache = new Map<number, number[]>();

/**
 * Chi-square quantiles at the Gauss–Legendre nodes of [0, 1], cached per ν.
 * Used to turn the chi-square mixture representation of the bivariate t into a
 * well-behaved integral over a probability.
 */
function chiSquareNodes(nu: number): number[] {
  const cached = chiQuantileCache.get(nu);
  if (cached) return cached;
  const { x } = gaussLegendre(T_MIXTURE_NODES);
  const nodes = x.map((xi) => CHI_SQUARE.quantile(0.5 * (1 + xi), { k: nu }));
  chiQuantileCache.set(nu, nodes);
  return nodes;
}

/**
 * Bivariate Student-t distribution function P(X ≤ x, Y ≤ y) for the standard
 * bivariate t with ν degrees of freedom and correlation parameter ρ.
 *
 * Uses the scale-mixture representation X = Z·√(ν/W), W ~ χ²_ν independent of
 * Z ~ N(0, R):
 *
 *   T_{ν,ρ}(x, y) = E_W[ Φ₂(x·√(W/ν), y·√(W/ν), ρ) ]
 *
 * The expectation is evaluated as an integral over the probability scale,
 * W = F⁻¹_{χ²_ν}(p), p ∈ (0, 1), where the integrand is bounded and smooth.
 */
export function bivariateTCdf(x: number, y: number, rho: number, nu: number): number {
  if (!Number.isFinite(nu) || nu <= 0) {
    throw new EngineError(`The degrees of freedom must be greater than 0; received ${nu}.`, 'range');
  }
  if (!Number.isFinite(rho) || rho < -1 || rho > 1) {
    throw new EngineError(`The correlation must lie in [−1, 1]; received ${rho}.`, 'range');
  }
  if (x === -Infinity || y === -Infinity) return 0;
  const { x: gx, w } = gaussLegendre(T_MIXTURE_NODES);
  const nodes = chiSquareNodes(nu);
  let s = 0;
  for (let i = 0; i < gx.length; i++) {
    const r = Math.sqrt(nodes[i] / nu);
    s += w[i] * bivariateNormalCdf(x * r, y * r, rho);
  }
  // The rule's weights sum to 2 over [−1, 1]; halving maps it to [0, 1].
  return clamp(s / 2, 0, 1);
}

/** Bivariate standard Student-t density with ν degrees of freedom. */
export function bivariateTPdf(x: number, y: number, rho: number, nu: number): number {
  const d = 1 - rho * rho;
  if (!(d > 0)) {
    throw new EngineError('The bivariate t density is singular when |ρ| = 1.', 'range');
  }
  const q = (x * x - 2 * rho * x * y + y * y) / d;
  return (1 / (2 * Math.PI * Math.sqrt(d))) * Math.pow(1 + q / nu, -(nu + 2) / 2);
}

/**
 * First Debye function D₁(θ) = (1/θ)·∫₀^θ t/(eᵗ − 1) dt, defined for θ ≠ 0 and
 * extended continuously with D₁(0) = 1. Valid for negative θ as well, where the
 * integral runs from θ to 0.
 */
export function debye1(theta: number): number {
  if (!Number.isFinite(theta)) {
    throw new EngineError('The Debye function needs a finite argument.', 'finite');
  }
  if (theta === 0) return 1;
  const panels = Math.max(1, Math.ceil(Math.abs(theta) / 4));
  const integral = integrateComposite(debyeIntegrand1, 0, theta, panels, 24);
  return integral / theta;
}

function debyeIntegrand1(t: number): number {
  if (t === 0) return 1;
  // t/(eᵗ − 1); expm1 keeps the small-|t| case accurate.
  return t / Math.expm1(t);
}

/**
 * Kendall's τ for the Frank copula, in the cancellation-free form
 *
 *   τ(θ) = (4/θ²)·∫₀^θ k(t) dt,   k(t) = t/(eᵗ − 1) − 1 + t/2
 *
 * which is algebraically identical to the usual τ = 1 − (4/θ)(1 − D₁(θ)) but
 * does not subtract two numbers close to 1. Written the usual way, τ at
 * θ = 1e−5 loses five significant digits; this way it keeps them, and the
 * leading behaviour τ → θ/9 comes out at full precision because
 * k(t) = t²/12 + O(t⁴).
 */
export function frankKendallTauIntegral(theta: number): number {
  if (!Number.isFinite(theta) || theta === 0) {
    throw new EngineError('Frank\u2019s τ is only defined for finite θ ≠ 0.', 'range');
  }
  const panels = Math.max(1, Math.ceil(Math.abs(theta) / 4));
  const integral = integrateComposite(frankTauIntegrand, 0, theta, panels, 24);
  return clamp((4 * integral) / (theta * theta), -1, 1);
}

/** k(t) = t/(eᵗ − 1) − 1 + t/2, an even function with k(t) = t²/12 − t⁴/720 + … */
function frankTauIntegrand(t: number): number {
  if (t === 0) return 0;
  if (Math.abs(t) < 0.1) {
    const t2 = t * t;
    return t2 * (1 / 12 + t2 * (-1 / 720 + t2 / 30240));
  }
  return t / Math.expm1(t) - 1 + t / 2;
}
