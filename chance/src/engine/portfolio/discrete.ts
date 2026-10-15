/**
 * Exact arithmetic on finitely supported loss distributions ("laws"): sorting,
 * quantile integrals, convolution under independence and quantile addition
 * under comonotonicity. Everything here is exact for a discrete law — no
 * interpolation, no simulation.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { convolve } from './numerics';
import { assertLevel } from './empirical';

export interface DiscreteLaw {
  /** Support points, strictly increasing. */
  values: Float64Array;
  /** Probabilities, same length, non-negative, summing to 1. */
  probs: Float64Array;
}

export function makeLaw(values: ArrayLike<number>, probs: ArrayLike<number>): DiscreteLaw {
  if (values.length !== probs.length) throw new EngineError('A discrete law needs one probability per support point.', 'shape');
  if (values.length === 0) throw new EngineError('A discrete law needs at least one support point.', 'required');
  const idx = Array.from({ length: values.length }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const vs: number[] = [];
  const ps: number[] = [];
  for (const i of idx) {
    if (!Number.isFinite(values[i])) throw new EngineError('Every support point must be a finite number.', 'finite');
    if (!(probs[i] >= 0)) throw new EngineError('Every probability in a discrete law must be 0 or greater.', 'range');
    if (vs.length && values[i] === vs[vs.length - 1]) ps[ps.length - 1] += probs[i];
    else {
      vs.push(values[i]);
      ps.push(probs[i]);
    }
  }
  const total = stableSum(ps);
  if (!(Math.abs(total - 1) < 1e-9)) {
    throw new EngineError(`The probabilities of a discrete law must sum to 1; they sum to ${total}.`, 'sum');
  }
  for (let i = 0; i < ps.length; i++) ps[i] /= total;
  return { values: Float64Array.from(vs), probs: Float64Array.from(ps) };
}

export function lawMean(law: DiscreteLaw): number {
  const t = new Float64Array(law.values.length);
  for (let i = 0; i < t.length; i++) t[i] = law.values[i] * law.probs[i];
  return stableSum(t);
}

export function lawVariance(law: DiscreteLaw): number {
  const m = lawMean(law);
  const t = new Float64Array(law.values.length);
  for (let i = 0; i < t.length; i++) t[i] = law.probs[i] * (law.values[i] - m) * (law.values[i] - m);
  return stableSum(t);
}

/** The quantile at any u ∈ [0, 1]; used internally where u is a grid midpoint. */
export function lawQuantileAt(law: DiscreteLaw, u: number): number {
  const target = Math.min(1, Math.max(0, u));
  let cum = 0;
  for (let i = 0; i < law.values.length; i++) {
    cum += law.probs[i];
    if (cum >= target - 1e-15) return law.values[i];
  }
  return law.values[law.values.length - 1];
}

/** VaR_α = inf{x : F(x) ≥ α}; exact for a discrete law. */
export function lawVar(law: DiscreteLaw, alpha: number): number {
  assertLevel(alpha);
  let cum = 0;
  for (let i = 0; i < law.values.length; i++) {
    cum += law.probs[i];
    if (cum >= alpha - 1e-15) return law.values[i];
  }
  return law.values[law.values.length - 1];
}

/** (1/(b−a))·∫_a^b q(u) du for a discrete law — exact. */
export function lawQuantileAverage(law: DiscreteLaw, a: number, b: number): number {
  if (!(b > a)) throw new EngineError(`The probability range must satisfy a < b; received [${a}, ${b}].`, 'range');
  let cum = 0;
  const terms: number[] = [];
  for (let i = 0; i < law.values.length; i++) {
    const lo = cum;
    cum += law.probs[i];
    const overlap = Math.min(cum, b) - Math.max(lo, a);
    if (overlap > 0) terms.push(overlap * law.values[i]);
  }
  return stableSum(terms) / (b - a);
}

export function lawEs(law: DiscreteLaw, alpha: number): number {
  assertLevel(alpha);
  return lawQuantileAverage(law, alpha, 1);
}

export function lawLeftTailVar(law: DiscreteLaw, alpha: number): number {
  assertLevel(alpha);
  return lawQuantileAverage(law, 0, alpha);
}

/** The law of X + Y with X, Y **independent** — exact convolution. */
export function convolveLaws(x: DiscreteLaw, y: DiscreteLaw): DiscreteLaw {
  const vals: number[] = [];
  const ps: number[] = [];
  for (let i = 0; i < x.values.length; i++) {
    for (let j = 0; j < y.values.length; j++) {
      const p = x.probs[i] * y.probs[j];
      if (p === 0) continue;
      vals.push(x.values[i] + y.values[j]);
      ps.push(p);
    }
  }
  return makeLaw(vals, ps);
}

/**
 * The law of X + Y when X and Y are **comonotonic** (both driven by the same
 * uniform): the quantile functions add. Exact.
 */
export function comonotonicSumLaw(laws: DiscreteLaw[]): DiscreteLaw {
  if (!laws.length) throw new EngineError('At least one marginal is required.', 'required');
  // Merge all cumulative breakpoints; on each cell every marginal is constant.
  const cuts = new Set<number>([1]);
  for (const law of laws) {
    let cum = 0;
    for (let i = 0; i < law.probs.length; i++) {
      cum += law.probs[i];
      cuts.add(Math.min(1, cum));
    }
  }
  const sortedCuts = [...cuts].sort((a, b) => a - b);
  const vals: number[] = [];
  const ps: number[] = [];
  let prev = 0;
  for (const c of sortedCuts) {
    const p = c - prev;
    if (p <= 0) continue;
    const mid = 0.5 * (prev + c);
    let s = 0;
    for (const law of laws) s += lawQuantileAt(law, mid);
    vals.push(s);
    ps.push(p);
    prev = c;
  }
  return makeLaw(vals, ps);
}

/**
 * The law of X + Y when X and Y are **countermonotonic** (Y driven by 1 − U).
 * Only defined for a pair: no three or more random variables can be mutually
 * countermonotonic, which is why this refuses more than two marginals.
 */
export function countermonotonicSumLaw(x: DiscreteLaw, y: DiscreteLaw): DiscreteLaw {
  const cuts = new Set<number>([1]);
  let cum = 0;
  for (let i = 0; i < x.probs.length; i++) {
    cum += x.probs[i];
    cuts.add(Math.min(1, cum));
  }
  cum = 0;
  for (let i = 0; i < y.probs.length; i++) {
    cum += y.probs[i];
    cuts.add(Math.min(1, Math.max(0, 1 - cum)));
  }
  const sortedCuts = [...cuts].filter((c) => c > 0).sort((a, b) => a - b);
  const vals: number[] = [];
  const ps: number[] = [];
  let prev = 0;
  for (const c of sortedCuts) {
    const p = c - prev;
    if (p <= 0) continue;
    const mid = 0.5 * (prev + c);
    vals.push(lawQuantileAt(x, mid) + lawQuantileAt(y, 1 - mid));
    ps.push(p);
    prev = c;
  }
  return makeLaw(vals, ps);
}

/**
 * Convolve laws that live on a common lattice (value = origin + k·step), which
 * lets the FFT be used. Exact for genuinely lattice-valued laws.
 */
export interface LatticeLaw {
  origin: number;
  step: number;
  mass: Float64Array;
}

export function convolveLattice(a: LatticeLaw, b: LatticeLaw): LatticeLaw {
  if (Math.abs(a.step - b.step) > 1e-12 * Math.max(a.step, b.step)) {
    throw new EngineError('Lattice convolution requires both laws to use the same step.', 'shape');
  }
  return { origin: a.origin + b.origin, step: a.step, mass: convolve(a.mass, b.mass) };
}

export function latticeToLaw(l: LatticeLaw): DiscreteLaw {
  const vals: number[] = [];
  const ps: number[] = [];
  for (let i = 0; i < l.mass.length; i++) {
    if (l.mass[i] <= 0) continue;
    vals.push(l.origin + i * l.step);
    ps.push(l.mass[i]);
  }
  if (!vals.length) throw new EngineError('The lattice distribution carries no probability mass.', 'numerical');
  return makeLaw(vals, ps);
}
