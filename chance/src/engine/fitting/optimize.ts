/**
 * Bounded numerical optimisation for likelihood fitting.
 *
 * Nelder–Mead simplex search on a transformed, unbounded parameter space.
 * The transform (log / negative-log / logit, chosen from each parameter's
 * bounds) means the simplex can never propose a parameter outside the
 * distribution's domain, so the objective is never evaluated at an invalid
 * point and no penalty fudge is needed.
 *
 * Nelder–Mead is derivative-free, which matters here: several of the
 * log-likelihoods in this engine involve incomplete gamma/beta functions whose
 * derivatives are not available in closed form. It is not guaranteed to find a
 * global optimum, so `fitNelderMead` runs from several starts and reports
 * whether the runs agreed as well as whether each converged.
 */
import { EPS } from '../core/numeric';
import type { ParamSpec } from '../distributions/types';

/** Bounds for a single scalar parameter. ±Infinity means unbounded. */
export interface Bound {
  min: number;
  max: number;
}

/** Natural-space bounds of a registry parameter. */
export function paramBound(spec: ParamSpec): Bound {
  return { min: spec.min ?? -Infinity, max: spec.max ?? Infinity };
}

/** Bounds wider than this are treated as unbounded (the registry uses 1e12 as "no bound"). */
const WIDE = 1e9;

export interface Transform {
  toFree(x: number): number;
  toNatural(y: number): number;
}

export function makeTransform(bound: Bound): Transform {
  const lo = bound.min > -WIDE ? bound.min : -Infinity;
  const hi = bound.max < WIDE ? bound.max : Infinity;
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) {
    return { toFree: (x) => x, toNatural: (y) => y };
  }
  if (Number.isFinite(lo) && !Number.isFinite(hi)) {
    return { toFree: (x) => Math.log(Math.max(x - lo, EPS)), toNatural: (y) => lo + Math.exp(y) };
  }
  if (!Number.isFinite(lo) && Number.isFinite(hi)) {
    return { toFree: (x) => -Math.log(Math.max(hi - x, EPS)), toNatural: (y) => hi - Math.exp(-y) };
  }
  const span = hi - lo;
  return {
    toFree: (x) => {
      const u = Math.min(1 - 1e-12, Math.max(1e-12, (x - lo) / span));
      return Math.log(u / (1 - u));
    },
    toNatural: (y) => {
      // Numerically stable logistic.
      const u = y >= 0 ? 1 / (1 + Math.exp(-y)) : Math.exp(y) / (1 + Math.exp(y));
      return lo + span * Math.min(1 - 1e-15, Math.max(1e-15, u));
    },
  };
}

export interface NelderMeadOptions {
  maxIterations?: number;
  /** Convergence needs both the simplex spread and the function spread below tolerance. */
  tol?: number;
  /** Initial step in the transformed space. */
  step?: number;
}

export interface OptimizeOutcome {
  x: number[];
  value: number;
  iterations: number;
  converged: boolean;
  message: string;
}

/**
 * Nelder–Mead in the transformed space. `objective` receives NATURAL
 * parameters. A non-finite objective value is treated as +Infinity (worse than
 * any feasible point) rather than being silently replaced by a number.
 */
export function nelderMead(
  objective: (natural: number[]) => number,
  start: number[],
  bounds: Bound[],
  options: NelderMeadOptions = {},
): OptimizeOutcome {
  const maxIterations = options.maxIterations ?? 2000;
  const tol = options.tol ?? 1e-10;
  const step = options.step ?? 0.5;
  const d = start.length;
  if (d === 0) throw new Error('nelderMead requires at least one parameter.');
  const tf = bounds.map(makeTransform);
  const toNat = (y: number[]): number[] => y.map((v, i) => tf[i].toNatural(v));
  const f = (y: number[]): number => {
    const v = objective(toNat(y));
    return Number.isFinite(v) ? v : Infinity;
  };

  const y0 = start.map((v, i) => tf[i].toFree(v));
  const simplex: number[][] = [y0.slice()];
  for (let i = 0; i < d; i++) {
    const p = y0.slice();
    p[i] += step;
    simplex.push(p);
  }
  const fv = simplex.map(f);
  if (!Number.isFinite(fv[0])) {
    return { x: start.slice(), value: fv[0], iterations: 0, converged: false, message: 'The objective is not finite at the starting parameters, so the search could not begin.' };
  }

  const order = (): void => {
    const idx = simplex.map((_, i) => i).sort((a, b) => fv[a] - fv[b]);
    const s = idx.map((i) => simplex[i]);
    const v = idx.map((i) => fv[i]);
    for (let i = 0; i <= d; i++) {
      simplex[i] = s[i];
      fv[i] = v[i];
    }
  };

  let iterations = 0;
  let converged = false;
  for (; iterations < maxIterations; iterations++) {
    order();
    let spread = 0;
    for (let i = 1; i <= d; i++) {
      for (let j = 0; j < d; j++) spread = Math.max(spread, Math.abs(simplex[i][j] - simplex[0][j]));
    }
    const fSpread = Math.abs(fv[d] - fv[0]);
    if (spread < tol && fSpread < tol * (1 + Math.abs(fv[0]))) {
      converged = true;
      break;
    }
    const centroid = new Array<number>(d).fill(0);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) centroid[j] += simplex[i][j] / d;
    const worst = simplex[d];
    const reflect = centroid.map((c, j) => c + (c - worst[j]));
    const fr = f(reflect);
    if (fr < fv[0]) {
      const expand = centroid.map((c, j) => c + 2 * (c - worst[j]));
      const fe = f(expand);
      if (fe < fr) {
        simplex[d] = expand;
        fv[d] = fe;
      } else {
        simplex[d] = reflect;
        fv[d] = fr;
      }
    } else if (fr < fv[d - 1]) {
      simplex[d] = reflect;
      fv[d] = fr;
    } else {
      const outside = fr < fv[d];
      const base = outside ? reflect : worst;
      const contract = centroid.map((c, j) => c + 0.5 * (base[j] - c));
      const fc = f(contract);
      if (fc <= (outside ? fr : fv[d])) {
        simplex[d] = contract;
        fv[d] = fc;
      } else {
        for (let i = 1; i <= d; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          fv[i] = f(simplex[i]);
        }
      }
    }
  }
  order();
  return {
    x: toNat(simplex[0]),
    value: fv[0],
    iterations,
    converged,
    message: converged
      ? `Nelder–Mead converged after ${iterations} iterations (simplex and objective spread below ${tol}).`
      : `Nelder–Mead did not converge within ${maxIterations} iterations; the reported point is NOT a converged optimum.`,
  };
}

/**
 * Nelder–Mead from several starting points. Reports convergence only if at
 * least one run converged, and warns when the runs disagree (a sign of local
 * optima, which the caller must not hide).
 */
export function multiStartNelderMead(
  objective: (natural: number[]) => number,
  starts: number[][],
  bounds: Bound[],
  options: NelderMeadOptions = {},
): OptimizeOutcome & { restarts: number; disagreement: number } {
  let best: OptimizeOutcome | null = null;
  let bestConverged = false;
  let worstValue = -Infinity;
  let bestValue = Infinity;
  let totalIterations = 0;
  for (const s of starts) {
    const r = nelderMead(objective, s, bounds, options);
    totalIterations += r.iterations;
    if (Number.isFinite(r.value)) {
      bestValue = Math.min(bestValue, r.value);
      worstValue = Math.max(worstValue, r.value);
    }
    const better = best === null || r.value < best.value;
    // Prefer a converged run over an unconverged one with a marginally lower value.
    if (best === null || (r.converged && !bestConverged) || (r.converged === bestConverged && better)) {
      best = r;
      bestConverged = r.converged;
    }
  }
  if (!best) throw new Error('multiStartNelderMead requires at least one start.');
  const disagreement = Number.isFinite(bestValue) && Number.isFinite(worstValue) ? worstValue - bestValue : Infinity;
  return { ...best, iterations: totalIterations, restarts: starts.length, disagreement };
}

/**
 * Central-difference Hessian of `f` at `x`, with steps shrunk so that every
 * evaluation point stays strictly inside the bounds. Returns null when a
 * parameter sits so close to a bound that no two-sided step fits: in that case
 * the observed information is not computable and the caller must say so rather
 * than report a standard error.
 */
export function numericalHessian(
  f: (x: number[]) => number,
  x: number[],
  bounds: Bound[],
): { matrix: number[][]; steps: number[] } | null {
  const d = x.length;
  const h = new Array<number>(d);
  for (let i = 0; i < d; i++) {
    const scale = Math.max(Math.abs(x[i]), 1e-3);
    let hi = scale * 1e-4;
    const room = Math.min(x[i] - bounds[i].min, bounds[i].max - x[i]);
    if (room <= 0) return null;
    hi = Math.min(hi, room * 0.25);
    if (!(hi > 0) || !Number.isFinite(hi)) return null;
    h[i] = hi;
  }
  const at = (shift: Map<number, number>): number => {
    const p = x.slice();
    for (const [i, s] of shift) p[i] += s;
    const v = f(p);
    return Number.isFinite(v) ? v : NaN;
  };
  const f0 = at(new Map());
  if (!Number.isFinite(f0)) return null;
  const matrix: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (let i = 0; i < d; i++) {
    const fp = at(new Map([[i, h[i]]]));
    const fm = at(new Map([[i, -h[i]]]));
    if (!Number.isFinite(fp) || !Number.isFinite(fm)) return null;
    matrix[i][i] = (fp - 2 * f0 + fm) / (h[i] * h[i]);
    for (let j = i + 1; j < d; j++) {
      const fpp = at(new Map([[i, h[i]], [j, h[j]]]));
      const fpm = at(new Map([[i, h[i]], [j, -h[j]]]));
      const fmp = at(new Map([[i, -h[i]], [j, h[j]]]));
      const fmm = at(new Map([[i, -h[i]], [j, -h[j]]]));
      if (![fpp, fpm, fmp, fmm].every(Number.isFinite)) return null;
      const v = (fpp - fpm - fmp + fmm) / (4 * h[i] * h[j]);
      matrix[i][j] = v;
      matrix[j][i] = v;
    }
  }
  return { matrix, steps: h };
}
