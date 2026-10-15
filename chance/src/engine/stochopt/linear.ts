/**
 * The linear-programming layer every other file in this module stands on.
 *
 * The simplex itself is NOT reimplemented here: `simplexMaximize` from
 * `src/engine/sequential/lp.ts` is a two-phase primal simplex for
 * `max cᵀx s.t. A x = b, x >= 0`, which is exactly the standard form this
 * layer reduces to. What is added here is the part that form lacks:
 *
 *  - general row senses, a `min` sense, finite upper bounds and free variables,
 *    reduced to the standard form by an explicit, invertible transformation;
 *  - the DUAL program, constructed symbolically and solved by the same simplex,
 *    so the strong-duality residual is a measured number rather than a claim.
 *    Nothing here reads duals out of a final tableau; two independent solves
 *    that agree is the stronger statement and is what the tests check;
 *  - an infeasibility diagnosis that names the rows that cannot be met and by
 *    how much, found by minimising total elastic violation. An infeasible
 *    program never returns a vector.
 *
 * An LP reported `optimal` here is exact up to floating point; the simplex's
 * pivot tolerance (1e-11) is carried on every solution as `tolerance`.
 */
import { EngineError } from '../core/result';
import { simplexMaximize } from '../sequential/lp';
import { stableSum } from '../core/numeric';
import type { LpProblem, LpRow, LpSolution, InfeasibilityWitness } from './types';

/** Pivot tolerance of the reused simplex, restated so results can carry it. */
export const SIMPLEX_TOLERANCE = 1e-11;
/** Residual above which a row counts as violated when diagnosing infeasibility. */
export const FEASIBILITY_TOLERANCE = 1e-7;

export function rowName(row: LpRow, i: number): string {
  return row.name ?? `row ${i + 1}`;
}

function checkShape(p: LpProblem): number {
  const n = p.objective.length;
  if (n === 0) throw new EngineError('A linear program needs at least one decision variable.', 'empty');
  for (let j = 0; j < n; j++) {
    if (!Number.isFinite(p.objective[j])) {
      throw new EngineError(`Objective coefficient ${j + 1} is ${String(p.objective[j])}; every cost must be finite.`, 'finite');
    }
  }
  p.rows.forEach((row, i) => {
    if (row.coef.length !== n) {
      throw new EngineError(
        `${rowName(row, i)} has ${row.coef.length} coefficients but the program has ${n} variables.`,
        'shape',
      );
    }
    for (const v of row.coef) {
      if (!Number.isFinite(v)) throw new EngineError(`${rowName(row, i)} contains a non-finite coefficient.`, 'finite');
    }
    if (!Number.isFinite(row.rhs)) throw new EngineError(`${rowName(row, i)} has a non-finite right-hand side.`, 'finite');
  });
  if (p.lower && p.lower.length !== n) throw new EngineError('The lower-bound vector must have one entry per variable.', 'shape');
  if (p.upper && p.upper.length !== n) throw new EngineError('The upper-bound vector must have one entry per variable.', 'shape');
  if (p.lower && p.upper) {
    for (let j = 0; j < n; j++) {
      if (p.lower[j] > p.upper[j]) {
        throw new EngineError(
          `Variable ${p.names?.[j] ?? j + 1} has lower bound ${p.lower[j]} above its upper bound ${p.upper[j]}, so its feasible set is empty.`,
          'range',
        );
      }
    }
  }
  return n;
}

/**
 * Each original variable becomes one or two non-negative canonical variables:
 * `x_j = shift_j + Σ_k sign_k · z_k`.
 */
interface VarMap {
  shift: number;
  parts: { index: number; sign: number }[];
}

interface Canonical {
  /** Minimised cost over canonical non-negative variables. */
  c: number[];
  rows: LpRow[];
  constant: number;
  maps: VarMap[];
  nCanonical: number;
}

/** Reduce any `LpProblem` to `min cᵀz, rows, z >= 0`. */
export function canonicalise(p: LpProblem): Canonical {
  const n = checkShape(p);
  const lower = p.lower ?? new Array<number>(n).fill(0);
  const upper = p.upper ?? new Array<number>(n).fill(Infinity);
  const maps: VarMap[] = [];
  let next = 0;
  const extraRows: LpRow[] = [];
  for (let j = 0; j < n; j++) {
    const lo = lower[j];
    const hi = upper[j];
    if (Number.isFinite(lo)) {
      const idx = next++;
      maps.push({ shift: lo, parts: [{ index: idx, sign: 1 }] });
      if (Number.isFinite(hi)) extraRows.push({ coef: [], sense: '<=', rhs: hi - lo, name: `upper bound on ${p.names?.[j] ?? `x${j + 1}`}` });
    } else if (Number.isFinite(hi)) {
      // x = hi - z, z >= 0.
      const idx = next++;
      maps.push({ shift: hi, parts: [{ index: idx, sign: -1 }] });
    } else {
      const a = next++;
      const b = next++;
      maps.push({ shift: 0, parts: [{ index: a, sign: 1 }, { index: b, sign: -1 }] });
    }
  }
  const nCanonical = next;
  // Fill the deferred upper-bound rows now that the width is known.
  let cursor = 0;
  const boundRows: LpRow[] = [];
  for (let j = 0; j < n; j++) {
    if (Number.isFinite(lower[j]) && Number.isFinite(upper[j])) {
      const row = extraRows[cursor++];
      const coef = new Array<number>(nCanonical).fill(0);
      coef[maps[j].parts[0].index] = 1;
      boundRows.push({ ...row, coef });
    }
  }
  const dir = p.sense === 'max' ? -1 : 1;
  const c = new Array<number>(nCanonical).fill(0);
  let constant = dir * (p.constant ?? 0);
  for (let j = 0; j < n; j++) {
    const cost = dir * p.objective[j];
    constant += cost * maps[j].shift;
    for (const part of maps[j].parts) c[part.index] += cost * part.sign;
  }
  const rows: LpRow[] = [];
  p.rows.forEach((row, i) => {
    const coef = new Array<number>(nCanonical).fill(0);
    let rhs = row.rhs;
    for (let j = 0; j < n; j++) {
      const a = row.coef[j];
      if (a === 0) continue;
      rhs -= a * maps[j].shift;
      for (const part of maps[j].parts) coef[part.index] += a * part.sign;
    }
    rows.push({ coef, sense: row.sense, rhs, name: rowName(row, i) });
  });
  return { c, rows: [...rows, ...boundRows], constant, maps, nCanonical };
}

function recover(maps: VarMap[], z: number[]): number[] {
  return maps.map((m) => {
    let v = m.shift;
    for (const part of m.parts) v += part.sign * z[part.index];
    return v;
  });
}

/** Solve `min cᵀz, rows, z >= 0` by adding slacks and calling the reused simplex. */
function solveCanonical(can: Canonical): { status: 'optimal' | 'infeasible' | 'unbounded' | 'iteration-limit'; z: number[]; iterations: number } {
  const slackCount = can.rows.reduce((acc, r) => acc + (r.sense === '=' ? 0 : 1), 0);
  const width = can.nCanonical + slackCount;
  const A: number[][] = [];
  const b: number[] = [];
  let slack = 0;
  for (const row of can.rows) {
    const full = new Array<number>(width).fill(0);
    for (let j = 0; j < can.nCanonical; j++) full[j] = row.coef[j];
    if (row.sense === '<=') full[can.nCanonical + slack++] = 1;
    else if (row.sense === '>=') full[can.nCanonical + slack++] = -1;
    A.push(full);
    b.push(row.rhs);
  }
  const obj = new Array<number>(width).fill(0);
  for (let j = 0; j < can.nCanonical; j++) obj[j] = -can.c[j];
  if (A.length === 0) {
    // No rows: the minimum is 0 unless some cost is negative, in which case the
    // program is unbounded below over the non-negative orthant.
    if (can.c.some((v) => v < -SIMPLEX_TOLERANCE)) return { status: 'unbounded', z: [], iterations: 0 };
    return { status: 'optimal', z: new Array<number>(can.nCanonical).fill(0), iterations: 0 };
  }
  const sol = simplexMaximize(A, b, obj);
  if (sol.status !== 'optimal') return { status: sol.status, z: [], iterations: sol.iterations };
  return { status: 'optimal', z: sol.x.slice(0, can.nCanonical), iterations: sol.iterations };
}

/**
 * Solve a linear program. The returned status is the honest one; `x` is empty
 * unless the status is `optimal`, so an infeasible or unbounded program can
 * never be mistaken for a solved one.
 */
export function solveLp(p: LpProblem): LpSolution {
  const can = canonicalise(p);
  const res = solveCanonical(can);
  if (res.status === 'iteration-limit') {
    throw new EngineError(
      `The simplex reached its pivot limit after ${res.iterations} iterations without proving optimality, so no objective value can be reported for this program.`,
      'convergence',
    );
  }
  if (res.status === 'unbounded') {
    return { status: 'unbounded', x: [], objective: p.sense === 'min' ? -Infinity : Infinity, iterations: res.iterations, tolerance: SIMPLEX_TOLERANCE };
  }
  if (res.status === 'infeasible') {
    return {
      status: 'infeasible',
      x: [],
      objective: NaN,
      iterations: res.iterations,
      tolerance: SIMPLEX_TOLERANCE,
      witnesses: diagnoseInfeasibility(p),
    };
  }
  const x = recover(can.maps, res.z);
  const terms = x.map((v, j) => p.objective[j] * v);
  const objective = stableSum(terms) + (p.constant ?? 0);
  return { status: 'optimal', x, objective, iterations: res.iterations, tolerance: SIMPLEX_TOLERANCE };
}

/** Solve, or throw an `EngineError` naming why there is no answer. */
export function requireOptimal(p: LpProblem, context: string): LpSolution {
  const sol = solveLp(p);
  if (sol.status === 'optimal') return sol;
  if (sol.status === 'unbounded') {
    throw new EngineError(
      `${context}: the objective is unbounded ${p.sense === 'min' ? 'below' : 'above'} over the feasible set, so there is no optimal solution. Add the missing bound on the decision variables or the missing constraint.`,
      'unbounded',
    );
  }
  const list = (sol.witnesses ?? [])
    .map((w) => `${w.name} (short by ${w.violation.toPrecision(6)})`)
    .join('; ');
  throw new EngineError(
    `${context}: the constraints cannot all be satisfied. The least-violating point still misses ${list || 'at least one row'}.`,
    'infeasible',
  );
}

/**
 * Find which rows make a program infeasible, and by how much, by minimising the
 * total elastic violation. The elastic program is always feasible, so this
 * always returns a concrete answer instead of a shrug.
 */
export function diagnoseInfeasibility(p: LpProblem): InfeasibilityWitness[] {
  const can = canonicalise(p);
  const m = can.rows.length;
  const width = can.nCanonical + 2 * m;
  const rows: LpRow[] = can.rows.map((row, i) => {
    const coef = new Array<number>(width).fill(0);
    for (let j = 0; j < can.nCanonical; j++) coef[j] = row.coef[j];
    coef[can.nCanonical + 2 * i] = 1; // surplus added to the left-hand side
    coef[can.nCanonical + 2 * i + 1] = -1; // deficit removed from it
    return { coef, sense: row.sense, rhs: row.rhs, name: row.name };
  });
  const objective = new Array<number>(width).fill(0);
  for (let i = 0; i < 2 * m; i++) objective[can.nCanonical + i] = 1;
  const elastic = solveLp({ sense: 'min', objective, rows });
  if (elastic.status !== 'optimal') {
    return [{ row: -1, name: 'the whole program', violation: Infinity }];
  }
  const out: InfeasibilityWitness[] = [];
  can.rows.forEach((row, i) => {
    const v = Math.abs(elastic.x[can.nCanonical + 2 * i]) + Math.abs(elastic.x[can.nCanonical + 2 * i + 1]);
    if (v > FEASIBILITY_TOLERANCE) out.push({ row: i, name: row.name ?? `row ${i + 1}`, violation: v });
  });
  return out;
}

/* ------------------------------------------------------------- duality */

/**
 * The dual of `min cᵀx s.t. rows, x >= 0`:
 *
 *   max bᵀπ  s.t.  Aᵀπ <= c,  π_i >= 0 for '>=', π_i <= 0 for '<=', free for '='.
 *
 * Only the non-negative-orthant min form is dualised. Anything else is first
 * canonicalised by the caller; the dual of a transformed program is the dual of
 * a different program, and silently returning it would be wrong.
 */
export function dualProblem(p: LpProblem): LpProblem {
  if (p.sense !== 'min') throw new EngineError('dualProblem expects a minimisation program; negate the objective first.', 'shape');
  const n = checkShape(p);
  if (p.lower && p.lower.some((v) => v !== 0)) throw new EngineError('dualProblem expects variables with lower bound 0; canonicalise first.', 'shape');
  if (p.upper && p.upper.some((v) => Number.isFinite(v))) throw new EngineError('dualProblem expects variables without finite upper bounds; move them into rows first.', 'shape');
  const m = p.rows.length;
  const rows: LpRow[] = [];
  for (let j = 0; j < n; j++) {
    rows.push({ coef: p.rows.map((r) => r.coef[j]), sense: '<=', rhs: p.objective[j], name: `dual of variable ${p.names?.[j] ?? j + 1}` });
  }
  const lower = new Array<number>(m).fill(0);
  const upper = new Array<number>(m).fill(Infinity);
  p.rows.forEach((r, i) => {
    if (r.sense === '<=') {
      lower[i] = -Infinity;
      upper[i] = 0;
    } else if (r.sense === '=') {
      lower[i] = -Infinity;
      upper[i] = Infinity;
    }
  });
  return {
    sense: 'max',
    objective: p.rows.map((r) => r.rhs),
    rows,
    lower,
    upper,
    constant: p.constant ?? 0,
    names: p.rows.map((r, i) => rowName(r, i)),
  };
}

export interface PrimalDualSolution extends LpSolution {
  /** One multiplier per row of the primal, in row order. */
  duals: number[];
  dualObjective: number;
  /** |primal − dual| at optimality. Zero up to floating point by strong duality. */
  dualityResidual: number;
}

/**
 * Solve a program and its dual independently and report the strong-duality
 * residual. The dual multipliers are what Benders decomposition cuts with, so
 * they are obtained from an actual optimal dual solution, not inferred.
 */
export function solveLpWithDuals(p: LpProblem): PrimalDualSolution {
  if (p.sense !== 'min' || (p.lower && p.lower.some((v) => v !== 0)) || (p.upper && p.upper.some((v) => Number.isFinite(v)))) {
    throw new EngineError('solveLpWithDuals needs a minimisation program over the non-negative orthant.', 'shape');
  }
  const primal = solveLp(p);
  if (primal.status !== 'optimal') {
    return { ...primal, duals: [], dualObjective: NaN, dualityResidual: NaN };
  }
  const dual = solveLp(dualProblem(p));
  if (dual.status !== 'optimal') {
    throw new EngineError(
      `The primal program solved to optimality but its dual terminated "${dual.status}". That cannot happen for a bounded feasible linear program, so the model is numerically degenerate and no multipliers can be reported.`,
      'degenerate',
    );
  }
  return {
    ...primal,
    duals: dual.x,
    dualObjective: dual.objective,
    dualityResidual: Math.abs(primal.objective - dual.objective),
  };
}

/* ------------------------------------------- convex constraints by cuts */

export interface ConvexConstraint {
  name: string;
  /** g(x) <= 0 with g convex. */
  value(x: number[]): number;
  gradient(x: number[]): number[];
}

export interface ConvexSolution extends LpSolution {
  /** Largest g_k(x) at the returned point; <= `residualTolerance` on success. */
  maxViolation: number;
  cuts: number;
  /** Safety margin the cut right-hand sides were tightened by, if any. */
  margin: number;
}

/**
 * Kelley cutting-plane solution of `min cᵀx` over linear rows plus convex
 * constraints `g_k(x) <= 0`.
 *
 * An outer approximation is optimistic: it can return a point that violates the
 * true convex constraint slightly. That is not acceptable for a chance
 * constraint, so after the cut loop converges the constraint right-hand sides
 * are tightened by the observed violation and the loop repeats until the
 * returned point actually satisfies every convex constraint to
 * `residualTolerance`. The margin finally used is reported, and the result is
 * labelled `numerical` because of it.
 */
export function solveConvexLp(
  p: LpProblem,
  constraints: ConvexConstraint[],
  options: { maxCuts?: number; residualTolerance?: number; maxRestarts?: number } = {},
): ConvexSolution {
  const maxCuts = options.maxCuts ?? 200;
  const tol = options.residualTolerance ?? 1e-9;
  const maxRestarts = options.maxRestarts ?? 12;
  if (constraints.length === 0) {
    const sol = solveLp(p);
    return { ...sol, maxViolation: 0, cuts: 0, margin: 0 };
  }
  const n = p.objective.length;
  let margin = 0;
  let last: ConvexSolution | null = null;
  for (let restart = 0; restart <= maxRestarts; restart++) {
    const rows: LpRow[] = [...p.rows];
    let cuts = 0;
    let sol = solveLp({ ...p, rows });
    for (let it = 0; it < maxCuts; it++) {
      if (sol.status !== 'optimal') break;
      let worst = -Infinity;
      let added = 0;
      for (const g of constraints) {
        const gv = g.value(sol.x);
        if (!Number.isFinite(gv)) {
          throw new EngineError(`Convex constraint "${g.name}" evaluated to ${String(gv)}; a constraint function must be finite on the feasible set.`, 'finite');
        }
        worst = Math.max(worst, gv);
        if (gv > tol / 10) {
          const grad = g.gradient(sol.x);
          if (grad.length !== n) throw new EngineError(`The gradient of "${g.name}" has ${grad.length} entries but the program has ${n} variables.`, 'shape');
          // g(x0) + ∇g(x0)ᵀ(x − x0) <= −margin
          let rhs = -margin - gv;
          for (let j = 0; j < n; j++) rhs += grad[j] * sol.x[j];
          rows.push({ coef: [...grad], sense: '<=', rhs, name: `cut ${cuts + 1} on ${g.name}` });
          cuts++;
          added++;
        }
      }
      if (added === 0) break;
      sol = solveLp({ ...p, rows });
    }
    if (sol.status !== 'optimal') {
      return { ...sol, maxViolation: NaN, cuts, margin };
    }
    const violation = Math.max(...constraints.map((g) => g.value(sol.x)));
    last = { ...sol, maxViolation: violation, cuts, margin };
    if (violation <= tol) return last;
    margin = margin === 0 ? Math.max(violation, tol) : margin * 2;
  }
  if (!last) throw new EngineError('The cutting-plane solver produced no iterate at all.', 'convergence');
  throw new EngineError(
    `The cutting-plane solve did not reach a point satisfying every convex constraint: the best point still violates one by ${last.maxViolation.toExponential(3)} after ${maxRestarts} tightening rounds. The convex constraint set may be empty or may have empty interior.`,
    'convergence',
  );
}
