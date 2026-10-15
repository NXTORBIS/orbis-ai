/**
 * Derivative-free minimisation and numerical derivatives used by the extreme
 * value fits.
 *
 * Optimiser: Nelder–Mead downhill simplex (Nelder & Mead 1965) with the
 * standard coefficients (reflection 1, expansion 2, contraction 1/2,
 * shrink 1/2). It is used because the GEV/GPD negative log-likelihoods are
 * only piecewise smooth — the support constraint 1 + ξz > 0 makes the
 * objective jump to +∞ — which defeats gradient methods, while a simplex
 * simply refuses to step into the infinite region.
 *
 * Convergence is declared only when BOTH the spread of the simplex vertices
 * and the spread of the function values fall below tolerance within the
 * iteration budget. Otherwise `converged` is false and the caller must report
 * a failure: the last iterate is never presented as a fitted value.
 */

export interface MinimizeOptions {
  /** Initial step for building the simplex, per coordinate. */
  step?: number[];
  maxIterations?: number;
  /** Tolerance on the simplex diameter. */
  xTolerance?: number;
  /** Tolerance on the spread of function values. */
  fTolerance?: number;
  /** Number of restarts from the current best point (guards against premature collapse). */
  restarts?: number;
}

export interface MinimizeResult {
  /** Best point found. Only meaningful when `converged` is true. */
  x: number[];
  /** Objective value at `x`. */
  fx: number;
  converged: boolean;
  iterations: number;
  /** Function evaluations used. */
  evaluations: number;
  /** Why the run stopped. */
  reason: 'converged' | 'max-iterations' | 'invalid-start' | 'non-finite';
}

export function nelderMead(
  objective: (x: number[]) => number,
  start: number[],
  options: MinimizeOptions = {},
): MinimizeResult {
  const n = start.length;
  const maxIterations = options.maxIterations ?? 2000;
  const xTol = options.xTolerance ?? 1e-10;
  const fTol = options.fTolerance ?? 1e-12;
  const restarts = options.restarts ?? 1;
  const step = (options.step ?? start.map((v) => (v === 0 ? 0.1 : Math.abs(v) * 0.1))).slice();

  let evaluations = 0;
  const f = (x: number[]): number => {
    evaluations++;
    const v = objective(x);
    return Number.isNaN(v) ? Infinity : v;
  };

  let best = start.slice();
  let bestValue = f(best);
  if (!Number.isFinite(bestValue)) {
    return { x: best, fx: bestValue, converged: false, iterations: 0, evaluations, reason: 'invalid-start' };
  }

  let totalIterations = 0;
  let reason: MinimizeResult['reason'] = 'max-iterations';

  for (let attempt = 0; attempt <= restarts; attempt++) {
    // Build the simplex around the current best point.
    const points: number[][] = [best.slice()];
    const values: number[] = [bestValue];
    for (let i = 0; i < n; i++) {
      const candidate = best.slice();
      const s = step[i] === 0 ? 0.1 : step[i];
      candidate[i] += s;
      let value = f(candidate);
      if (!Number.isFinite(value)) {
        // The forward step left the feasible region; try the other direction.
        candidate[i] = best[i] - s;
        value = f(candidate);
      }
      if (!Number.isFinite(value)) {
        // Both directions infeasible at this scale; shrink until feasible.
        let shrunk = s;
        for (let k = 0; k < 40 && !Number.isFinite(value); k++) {
          shrunk /= 2;
          candidate[i] = best[i] + shrunk;
          value = f(candidate);
        }
      }
      if (!Number.isFinite(value)) {
        return {
          x: best,
          fx: bestValue,
          converged: false,
          iterations: totalIterations,
          evaluations,
          reason: 'non-finite',
        };
      }
      points.push(candidate);
      values.push(value);
    }

    let converged = false;
    let iter = 0;
    for (; iter < maxIterations; iter++) {
      // Order vertices by objective value.
      const order = values.map((_v, i) => i).sort((a, b) => values[a] - values[b]);
      const sortedPoints = order.map((i) => points[i].slice());
      const sortedValues = order.map((i) => values[i]);
      for (let i = 0; i <= n; i++) {
        points[i] = sortedPoints[i];
        values[i] = sortedValues[i];
      }

      // Convergence: both the simplex size and the function spread must be small.
      let diameter = 0;
      for (let i = 1; i <= n; i++) {
        for (let j = 0; j < n; j++) {
          diameter = Math.max(diameter, Math.abs(points[i][j] - points[0][j]));
        }
      }
      const scale = Math.max(1, ...points[0].map(Math.abs));
      const fSpread = Math.abs(values[n] - values[0]);
      const fScale = Math.max(1, Math.abs(values[0]));
      if (diameter <= xTol * scale && fSpread <= fTol * fScale) {
        converged = true;
        break;
      }

      // Centroid of all but the worst vertex.
      const centroid = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) centroid[j] += points[i][j] / n;
      }

      const reflect = centroid.map((c, j) => c + (c - points[n][j]));
      const fReflect = f(reflect);

      if (fReflect < values[0]) {
        const expand = centroid.map((c, j) => c + 2 * (c - points[n][j]));
        const fExpand = f(expand);
        if (fExpand < fReflect) {
          points[n] = expand;
          values[n] = fExpand;
        } else {
          points[n] = reflect;
          values[n] = fReflect;
        }
      } else if (fReflect < values[n - 1]) {
        points[n] = reflect;
        values[n] = fReflect;
      } else {
        // Contract, outside if the reflection improved on the worst vertex.
        const outside = fReflect < values[n];
        const contract = outside
          ? centroid.map((c, j) => c + 0.5 * (c - points[n][j]))
          : centroid.map((c, j) => c - 0.5 * (c - points[n][j]));
        const fContract = f(contract);
        if (fContract < Math.min(fReflect, values[n])) {
          points[n] = contract;
          values[n] = fContract;
        } else {
          // Shrink the whole simplex towards the best vertex.
          for (let i = 1; i <= n; i++) {
            points[i] = points[i].map((v, j) => points[0][j] + 0.5 * (v - points[0][j]));
            values[i] = f(points[i]);
          }
        }
      }
    }

    totalIterations += iter;
    let improvedIndex = 0;
    for (let i = 1; i <= n; i++) if (values[i] < values[improvedIndex]) improvedIndex = i;
    if (values[improvedIndex] < bestValue) {
      bestValue = values[improvedIndex];
      best = points[improvedIndex].slice();
    }
    if (converged || reason === 'converged') reason = 'converged';
    if (converged && attempt > 0) break;
    if (!converged) break;
    // After a converged pass, restart with a smaller simplex to confirm.
    for (let i = 0; i < n; i++) step[i] = Math.max(Math.abs(step[i]) * 0.1, 1e-6);
  }

  return {
    x: best,
    fx: bestValue,
    converged: reason === 'converged',
    iterations: totalIterations,
    evaluations,
    reason,
  };
}

/**
 * Hessian by central differences, step h_i scaled to each coordinate.
 * Returns null when any required evaluation is non-finite (which happens when
 * the optimum sits against a support boundary) — the caller must then say the
 * standard errors are unavailable rather than invent them.
 */
export function numericalHessian(
  objective: (x: number[]) => number,
  x: number[],
  relativeStep = 1e-4,
): number[][] | null {
  const n = x.length;
  const h = x.map((v) => relativeStep * Math.max(Math.abs(v), 1e-2));
  const at = (deltas: number[]): number | null => {
    const point = x.map((v, i) => v + deltas[i]);
    const value = objective(point);
    return Number.isFinite(value) ? value : null;
  };
  const f0 = at(new Array<number>(n).fill(0));
  if (f0 === null) return null;
  const hessian: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const di = new Array<number>(n).fill(0);
    di[i] = h[i];
    const plus = at(di);
    di[i] = -h[i];
    const minus = at(di);
    if (plus === null || minus === null) return null;
    hessian[i][i] = (plus - 2 * f0 + minus) / (h[i] * h[i]);
    for (let j = i + 1; j < n; j++) {
      const d = new Array<number>(n).fill(0);
      d[i] = h[i];
      d[j] = h[j];
      const pp = at(d);
      d[j] = -h[j];
      const pm = at(d);
      d[i] = -h[i];
      d[j] = h[j];
      const mp = at(d);
      d[j] = -h[j];
      const mm = at(d);
      if (pp === null || pm === null || mp === null || mm === null) return null;
      const mixed = (pp - pm - mp + mm) / (4 * h[i] * h[j]);
      hessian[i][j] = mixed;
      hessian[j][i] = mixed;
    }
  }
  for (const row of hessian) for (const v of row) if (!Number.isFinite(v)) return null;
  return hessian;
}

/** Gradient by central differences. Returns null if any evaluation is non-finite. */
export function numericalGradient(
  objective: (x: number[]) => number,
  x: number[],
  relativeStep = 1e-5,
): number[] | null {
  const out = new Array<number>(x.length).fill(0);
  for (let i = 0; i < x.length; i++) {
    const h = relativeStep * Math.max(Math.abs(x[i]), 1e-3);
    const plus = x.slice();
    plus[i] += h;
    const minus = x.slice();
    minus[i] -= h;
    const fp = objective(plus);
    const fm = objective(minus);
    if (!Number.isFinite(fp) || !Number.isFinite(fm)) return null;
    out[i] = (fp - fm) / (2 * h);
  }
  return out;
}
