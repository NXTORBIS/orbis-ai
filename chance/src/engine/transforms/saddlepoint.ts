/**
 * Saddlepoint approximations.
 *
 * The Lugannani–Rice tail probability and the Daniels density are built from
 * the cumulant generating function by solving K'(ŝ) = x — the saddlepoint
 * equation — and expanding the Bromwich integral about that point. Unlike an
 * Edgeworth expansion, the relative error of a saddlepoint approximation stays
 * O(1/n) uniformly into the far tail, which is why it routinely gives several
 * correct significant figures at a tail probability of 1e-6 where a normal
 * approximation is wrong by orders of magnitude.
 *
 * Two things can go wrong, and both are reported rather than patched: the
 * saddlepoint equation may have no root inside the region of convergence (x is
 * then outside the range of K', i.e. effectively outside the support), and the
 * expansion degenerates at x = E[X], where ŵ = û = 0 and the formula is
 * replaced by its known limit.
 */
import { EngineError } from '../core/result';
import { brentRoot } from '../core/numeric';
import { normalCdf, normalPdf } from '../special/gamma';
import { getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { cgf, cgfDerivative, cgfSecondDerivative, mgfRegion } from './generating';

export interface CgfSpec {
  /** K(t) = ln E[e^{tX}]. */
  K(t: number): number;
  /** K'(t). */
  dK(t: number): number;
  /** K''(t). */
  d2K(t: number): number;
  /** K'''(t), used for the limit at the mean and the second-order terms. */
  d3K(t: number): number;
  /** Open region of convergence. */
  lower: number;
  upper: number;
  description: string;
  /** Lattice span when the variable is supported on a lattice (0 = continuous). */
  latticeStep: number;
}

/**
 * The CGF of a sum of n independent copies of a registry distribution.
 * K_S(t) = n·K_X(t), so the region of convergence is unchanged.
 */
export function cgfSpecForSum(id: string, params: Params, n = 1): CgfSpec {
  if (!Number.isInteger(n) || n < 1) throw new EngineError('The number of summands n must be a whole number of at least 1.', 'range');
  const def = getDistribution(id);
  const roc = mgfRegion(def, params);
  if (!roc.exists) {
    throw new EngineError(
      `A saddlepoint approximation needs a cumulant generating function, and the ${def.name} distribution has none. ${roc.description}`,
      'no-mgf',
    );
  }
  const K = (t: number) => n * cgf(id, params, t).value;
  const dK = (t: number) => n * cgfDerivative(id, params, t).value;
  const d2K = (t: number) => n * cgfSecondDerivative(id, params, t).value;
  const d3K = (t: number) => {
    // Central difference of K'' kept well inside the region of convergence.
    const room = Math.min(roc.upper - t, t - roc.lower);
    const h = Math.min(1e-4 * Math.max(1, Math.abs(t)), Number.isFinite(room) ? room / 8 : Infinity);
    if (!(h > 0)) throw new EngineError('No finite-difference step for the third derivative of K fits inside the region of convergence.', 'out-of-region');
    return (d2K(t + h) - d2K(t - h)) / (2 * h);
  };
  return {
    K,
    dK,
    d2K,
    d3K,
    lower: roc.lower,
    upper: roc.upper,
    description: `${n} independent ${def.name} summand(s). ${roc.description}`,
    latticeStep: def.kind === 'discrete' ? 1 : 0,
  };
}

export interface SaddlepointSolution {
  /** ŝ, the root of K'(s) = x. */
  s: number;
  /** K(ŝ). */
  K: number;
  /** K''(ŝ) > 0. */
  d2K: number;
  iterationsBracketed: number;
}

/**
 * Solve K'(ŝ) = x inside the region of convergence. K' is strictly increasing
 * (K'' is a variance, hence positive), so the root is unique when it exists. It
 * fails to exist when x is outside the closure of the range of K' — which for a
 * bounded support means x outside the support, and for an exponential-tailed
 * law means nothing: the range is then all of (support min, support max).
 */
export function solveSaddlepoint(spec: CgfSpec, x: number): SaddlepointSolution {
  if (!Number.isFinite(x)) throw new EngineError('The saddlepoint equation needs a finite x.', 'finite');
  const mean = spec.dK(0);
  if (x === mean) {
    return { s: 0, K: spec.K(0), d2K: spec.d2K(0), iterationsBracketed: 0 };
  }
  const f = (s: number) => spec.dK(s) - x;
  const goingUp = x > mean;
  const boundary = goingUp ? spec.upper : spec.lower;
  let a = 0;
  let b = 0;
  let found = false;
  let steps = 0;
  if (Number.isFinite(boundary)) {
    // Approach the boundary geometrically from inside; K' typically diverges
    // there, so a root is reached quickly when one exists.
    for (let j = 1; j <= 200; j++) {
      steps = j;
      const candidate = boundary - (boundary - 0) * Math.pow(0.5, j);
      let v: number;
      try {
        v = f(candidate);
      } catch {
        break;
      }
      if (!Number.isFinite(v)) break;
      if (goingUp ? v >= 0 : v <= 0) {
        a = 0;
        b = candidate;
        found = true;
        break;
      }
    }
  } else {
    const dir = goingUp ? 1 : -1;
    let step = Math.max(1e-6, Math.abs(mean) * 1e-6, 1e-3);
    for (let j = 1; j <= 200; j++) {
      steps = j;
      const candidate = dir * step;
      let v: number;
      try {
        v = f(candidate);
      } catch {
        break;
      }
      if (!Number.isFinite(v)) break;
      if (goingUp ? v >= 0 : v <= 0) {
        a = 0;
        b = candidate;
        found = true;
        break;
      }
      step *= 2;
      if (step > 1e12) break;
    }
  }
  if (!found) {
    throw new EngineError(
      `The saddlepoint equation K'(s) = ${x} has no root inside the region of convergence (${spec.lower}, ${spec.upper}). The mean is ${mean}, and K' does not reach ${x} anywhere in that region, so x lies outside the range the cumulant generating function can represent — typically outside the support of the sum. No saddlepoint approximation is reported. ${spec.description}`,
      'no-saddlepoint',
    );
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const s = brentRoot(f, lo, hi, { tol: 1e-14 });
  const d2 = spec.d2K(s);
  if (!(d2 > 0) || !Number.isFinite(d2)) {
    throw new EngineError(
      `The saddlepoint at ŝ = ${s} has K''(ŝ) = ${d2}, which is not a positive finite number. The saddlepoint expansion divides by √K''(ŝ), so no value is reported.`,
      'numerical',
    );
  }
  return { s, K: spec.K(s), d2K: d2, iterationsBracketed: steps };
}

export interface SaddlepointTail {
  /** P(X > x). */
  survival: number;
  /** P(X ≤ x). */
  cdf: number;
  /** ŝ, ŵ and û, reported because they are the whole content of the method. */
  shat: number;
  what: number;
  uhat: number;
  /** Relative error estimate, O(1/n) in the usual asymptotic ordering. */
  relativeErrorEstimate: number;
  /** True at x = E[X], where the limiting form was used. */
  atMean: boolean;
  method: string;
  notes: string[];
}

/**
 * Lugannani–Rice tail probability:
 *   P(X > x) = 1 − Φ(ŵ) + φ(ŵ)·(1/û − 1/ŵ),
 *   ŵ = sgn(ŝ)·√(2(ŝx − K(ŝ))),  û = ŝ·√(K''(ŝ)).
 * At x = E[X] both ŵ and û vanish and the bracket has the removable limit
 *   1/2 − κ₃/(6√(2π)·κ₂^{3/2}).
 */
export function lugannaniRice(spec: CgfSpec, x: number): SaddlepointTail {
  const mean = spec.dK(0);
  if (x === mean) {
    const k2 = spec.d2K(0);
    const k3 = spec.d3K(0);
    const survival = 0.5 - k3 / (6 * Math.sqrt(2 * Math.PI) * Math.pow(k2, 1.5));
    return {
      survival,
      cdf: 1 - survival,
      shat: 0,
      what: 0,
      uhat: 0,
      relativeErrorEstimate: 1e-3,
      atMean: true,
      method: 'Lugannani–Rice, limiting form at x = E[X]',
      notes: [
        'At the mean the Lugannani–Rice expression is 0/0; the removable limit ½ − κ₃/(6√(2π)κ₂^{3/2}) was used instead.',
        spec.description,
      ],
    };
  }

  const sol = solveSaddlepoint(spec, x);
  const inner = 2 * (sol.s * x - sol.K);
  if (!(inner >= 0)) {
    throw new EngineError(
      `The Lugannani–Rice quantity 2(ŝx − K(ŝ)) evaluated to ${inner}, which has no real square root. This indicates the saddlepoint solve did not converge to the true root; no tail probability is reported.`,
      'numerical',
    );
  }
  const what = Math.sign(sol.s) * Math.sqrt(inner);
  const uhat = sol.s * Math.sqrt(sol.d2K);
  if (uhat === 0 || what === 0) {
    throw new EngineError(
      `The Lugannani–Rice formula is singular at x = ${x} (ŵ = ${what}, û = ${uhat}) although x differs from the mean. No value is reported.`,
      'numerical',
    );
  }
  const survival = 1 - normalCdf(what) + normalPdf(what) * (1 / uhat - 1 / what);
  const cdf = 1 - survival;

  // The leading neglected term is O(1/n) relative; a practical surrogate is
  // the size of the second-order correction evaluated at the saddlepoint.
  const lam3 = spec.d3K(sol.s) / Math.pow(sol.d2K, 1.5);
  const relativeErrorEstimate = Math.abs(lam3) / 6 / Math.max(1, Math.abs(what));

  const notes = [
    `Saddlepoint ŝ = ${sol.s.toPrecision(10)} solves K'(ŝ) = ${x}; ŵ = ${what.toPrecision(10)}, û = ${uhat.toPrecision(10)}.`,
    `Lugannani–Rice is a numerical approximation whose relative error is O(1/n) uniformly in the tail, not an exact answer. The second-order surrogate estimate here is ${(relativeErrorEstimate * 100).toPrecision(3)}% relative.`,
    spec.latticeStep > 0
      ? `The underlying variable is supported on a lattice of step ${spec.latticeStep}; this continuous form of Lugannani–Rice carries an additional O(step) discretisation error, and a lattice-corrected version (replacing û by (1 − e^{−ŝ·step})·√K''(ŝ)/step) would be more accurate for small counts.`
      : 'The underlying variable is continuous, so no lattice correction applies.',
    spec.description,
  ];

  if (survival < 0 || survival > 1) {
    throw new EngineError(
      `Lugannani–Rice returned a survival probability of ${survival} at x = ${x}, which is not a probability. The approximation has broken down here (ŵ = ${what}, û = ${uhat}); no value is reported rather than a clipped one.`,
      'numerical',
    );
  }

  return { survival, cdf, shat: sol.s, what, uhat, relativeErrorEstimate, atMean: false, method: 'Lugannani–Rice saddlepoint tail approximation', notes };
}

export interface SaddlepointDensity {
  density: number;
  shat: number;
  /** The leading approximation before the second-order correction. */
  leading: number;
  /** Second-order correction factor 1 + (λ₄/8 − 5λ₃²/24). */
  correctionFactor: number;
  relativeErrorEstimate: number;
  method: string;
  notes: string[];
}

/**
 * Daniels' saddlepoint density:
 *   f(x) ≈ (2π K''(ŝ))^{−1/2} · exp(K(ŝ) − ŝx),
 * with the standard second-order correction factor 1 + λ₄/8 − 5λ₃²/24
 * reported separately so its size is visible as an error indicator.
 */
export function danielsDensity(spec: CgfSpec, x: number, options: { secondOrder?: boolean } = {}): SaddlepointDensity {
  const sol = solveSaddlepoint(spec, x);
  const leading = Math.exp(sol.K - sol.s * x) / Math.sqrt(2 * Math.PI * sol.d2K);
  const lam3 = spec.d3K(sol.s) / Math.pow(sol.d2K, 1.5);
  // λ₄ by one more numerical derivative of K''.
  const room = Math.min(spec.upper - sol.s, sol.s - spec.lower);
  const h = Math.min(1e-3 * Math.max(1, Math.abs(sol.s)), Number.isFinite(room) ? room / 16 : Infinity);
  const lam4 = (spec.d3K(sol.s + h) - spec.d3K(sol.s - h)) / (2 * h) / (sol.d2K * sol.d2K);
  const correctionFactor = 1 + lam4 / 8 - (5 * lam3 * lam3) / 24;
  const useSecond = options.secondOrder ?? true;
  const density = useSecond ? leading * correctionFactor : leading;
  if (!(density >= 0) || !Number.isFinite(density)) {
    throw new EngineError(
      `The saddlepoint density at x = ${x} evaluated to ${density}, which is not a density value. No value is reported.`,
      'numerical',
    );
  }
  return {
    density,
    shat: sol.s,
    leading,
    correctionFactor,
    relativeErrorEstimate: Math.abs(correctionFactor - 1),
    method: useSecond ? "Daniels saddlepoint density with the second-order correction" : 'Daniels saddlepoint density, leading term only',
    notes: [
      `Saddlepoint ŝ = ${sol.s.toPrecision(10)}, K''(ŝ) = ${sol.d2K.toPrecision(10)}.`,
      `Second-order correction factor 1 + λ₄/8 − 5λ₃²/24 = ${correctionFactor.toPrecision(8)}; its distance from 1 (${Math.abs(correctionFactor - 1).toExponential(3)}) is the practical relative-error indicator.`,
      'The saddlepoint density is not normalised to integrate to exactly 1; renormalising it over a grid usually improves it further, and that renormalisation constant is itself a diagnostic.',
      spec.description,
    ],
  };
}

export interface RateFunctionResult {
  /** I(a) = sup_t (t·a − K(t)), the Cramér rate function. */
  rate: number;
  /** The maximising t, which is the saddlepoint at a. */
  tStar: number;
  /** exp(−I(a)) — a rigorous Chernoff bound on the tail, not an approximation. */
  bound: number;
  side: 'upper' | 'lower';
  notes: string[];
}

/**
 * Cramér's rate function and the resulting Chernoff bound.
 *
 * For a ≥ E[X]: P(X ≥ a) ≤ exp(−I(a)) with I(a) = sup_{t ≥ 0}(ta − K(t)).
 * For a ≤ E[X]: P(X ≤ a) ≤ exp(−I(a)) with the supremum over t ≤ 0.
 * This is a genuine bound derived from Markov's inequality applied to e^{tX},
 * valid for every a, not an asymptotic approximation — so it may be loose, but
 * it can never be violated.
 */
export function chernoffBound(spec: CgfSpec, a: number): RateFunctionResult {
  if (!Number.isFinite(a)) throw new EngineError('The Chernoff threshold a must be finite.', 'finite');
  const mean = spec.dK(0);
  const side: 'upper' | 'lower' = a >= mean ? 'upper' : 'lower';
  if (a === mean) {
    return {
      rate: 0,
      tStar: 0,
      bound: 1,
      side,
      notes: [
        'At a = E[X] the rate function is 0 and the Chernoff bound is the trivial 1. That is correct: no exponential bound beats 1 at the mean.',
        spec.description,
      ],
    };
  }
  let tStar: number;
  try {
    tStar = solveSaddlepoint(spec, a).s;
  } catch {
    // Without an interior saddlepoint the supremum is attained at the boundary
    // of the region of convergence; approach it and take the best value found.
    const boundary = side === 'upper' ? spec.upper : spec.lower;
    if (!Number.isFinite(boundary)) {
      throw new EngineError(
        `The Chernoff bound at a = ${a} needs sup_t(ta − K(t)), but K'(t) never reaches ${a} and the region of convergence is unbounded on that side, so the supremum could not be located. No bound is reported.`,
        'numerical',
      );
    }
    let best = 0;
    let bestT = 0;
    for (let j = 1; j <= 120; j++) {
      const t = boundary * (1 - Math.pow(0.5, j));
      let v: number;
      try {
        v = t * a - spec.K(t);
      } catch {
        break;
      }
      if (!Number.isFinite(v)) break;
      if (v > best) {
        best = v;
        bestT = t;
      }
    }
    return {
      rate: best,
      tStar: bestT,
      bound: Math.exp(-best),
      side,
      notes: [
        `The supremum is attained at the edge of the region of convergence rather than at an interior saddlepoint; t* = ${bestT.toPrecision(8)} was found by approaching the boundary ${boundary}.`,
        'The bound remains rigorous: any t in the region of convergence gives a valid Markov bound, so the best one found is valid even if the true supremum is slightly larger.',
        spec.description,
      ],
    };
  }
  const rate = tStar * a - spec.K(tStar);
  if (!(rate >= 0)) {
    throw new EngineError(
      `The rate function at a = ${a} evaluated to ${rate}, which is negative. I(a) = sup_t(ta − K(t)) ≥ 0·a − K(0) = 0 always, so the solve has failed; no bound is reported.`,
      'numerical',
    );
  }
  return {
    rate,
    tStar,
    bound: Math.exp(-rate),
    side,
    notes: [
      `I(${a}) = ${rate.toPrecision(10)} at t* = ${tStar.toPrecision(10)}; the Chernoff bound on the ${side} tail is exp(−I) = ${Math.exp(-rate).toExponential(6)}.`,
      'This is a rigorous upper bound from Markov\'s inequality on e^{tX}, exact in the exponential rate but typically loose by a polynomial factor of order 1/(t*√(2πK\'\'(t*))). Compare it with the saddlepoint approximation, which estimates that factor instead of bounding it.',
      spec.description,
    ],
  };
}
