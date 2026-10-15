/**
 * Robust optimisation: protect against every member of an uncertainty set
 * rather than against a distribution.
 *
 * The four classical sets and their tractable counterparts, each exact rather
 * than approximate:
 *
 *  - BOX  a ∈ [ā−â, ā+â]:        āᵀx + âᵀ|x| <= b.          Linear.
 *  - ELLIPSOIDAL  (a−ā)ᵀΣ⁻¹(a−ā) <= Ω²:  āᵀx + Ω‖Σ^{1/2}x‖ <= b.  Conic;
 *    identical in form to the Gaussian chance constraint with Ω = z_{1−ε},
 *    which is not a coincidence and is the cleanest bridge between the robust
 *    and the probabilistic reading of the same data.
 *  - POLYHEDRAL  a = ā + Pζ, Dζ <= d:  by LP duality, ∃λ >= 0 with
 *    āᵀx + dᵀλ <= b and Dᵀλ = Pᵀx.     Linear.
 *  - BUDGETED (Bertsimas–Sim) ‖ζ‖_∞ <= 1, ‖ζ‖₁ <= Γ:  linear, and Γ is a dial
 *    from the nominal problem (Γ = 0) to the box (Γ = m).
 *
 * What the module is actually for
 * -------------------------------
 * The PRICE OF ROBUSTNESS curve: objective value as a function of Γ. A robust
 * solution is conservative by construction, so saying it is "safer" is not
 * informative; what a decision-maker needs is the exchange rate, and that curve
 * is it. `crossEvaluate` completes the picture by scoring the robust, the
 * stochastic and the nominal decision under each other's assumptions, because a
 * robust solution's cost under benign conditions is part of its honest
 * presentation and is routinely omitted.
 *
 * Distributionally robust optimisation closes the loop with the project's rule
 * that an unknown relationship must produce bounds: given only a mean and a
 * covariance, `worstCaseExpectedExcess` returns the largest expectation any
 * distribution with those moments can produce, together with the two-point
 * distribution that attains it. That is a bound, not an invented value.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { matVec, type Matrix } from '../stats/linalg';
import { constraintSd, requirePositiveDefinite } from './chance';
import { requireOptimal, solveConvexLp, solveLp, type ConvexConstraint, type ConvexSolution } from './linear';
import type { LpProblem, LpRow, Provenance, SolveStatus } from './types';

/* -------------------------------------------------------- shared parts */

export interface UncertainRow {
  name: string;
  /** Nominal coefficients ā. */
  nominal: number[];
  /** Per-coefficient half-width â >= 0 (box and budgeted sets). */
  deviation?: number[];
  rhs: number;
}

function checkUncertainRow(row: UncertainRow, n: number): number[] {
  if (row.nominal.length !== n) throw new EngineError(`Uncertain row "${row.name}" has ${row.nominal.length} nominal coefficients but the program has ${n} variables.`, 'shape');
  const dev = row.deviation ?? new Array<number>(n).fill(0);
  if (dev.length !== n) throw new EngineError(`Uncertain row "${row.name}" has ${dev.length} deviations but the program has ${n} variables.`, 'shape');
  for (const v of dev) {
    if (!Number.isFinite(v) || v < 0) {
      throw new EngineError(`Uncertain row "${row.name}" has a deviation of ${String(v)}. A half-width must be finite and non-negative; use 0 for a coefficient that is known exactly.`, 'range');
    }
  }
  if (dev.every((v) => v === 0)) {
    throw new EngineError(
      `Uncertain row "${row.name}" has zero deviation in every coefficient, so its uncertainty set is the single point ā. A degenerate uncertainty set makes the robust problem the nominal problem; state it as a deterministic row instead.`,
      'degenerate',
    );
  }
  return dev;
}

/**
 * Extend a program with absolute-value variables u_j >= |x_j|, needed by the box
 * and budgeted counterparts when x may be negative. Variables already known to
 * be non-negative get u_j = x_j by a single equality, which keeps the program
 * smaller and the bound tight.
 */
interface Extended {
  objective: number[];
  rows: LpRow[];
  lower: number[];
  upper: number[];
  total: number;
  /** Index of u_j in the extended vector. */
  absIndex: number[];
}

function withAbsoluteValues(lp: LpProblem): Extended {
  const n = lp.objective.length;
  const lower = lp.lower ?? new Array<number>(n).fill(0);
  const upper = lp.upper ?? new Array<number>(n).fill(Infinity);
  const needsAbs = lower.map((v) => v < 0);
  const absIndex = new Array<number>(n).fill(-1);
  let next = n;
  for (let j = 0; j < n; j++) if (needsAbs[j]) absIndex[j] = next++;
  const total = next;
  const objective = new Array<number>(total).fill(0);
  for (let j = 0; j < n; j++) objective[j] = lp.objective[j];
  const rows: LpRow[] = lp.rows.map((r, i) => {
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] = r.coef[j];
    return { coef, sense: r.sense, rhs: r.rhs, name: r.name ?? `row ${i + 1}` };
  });
  for (let j = 0; j < n; j++) {
    if (!needsAbs[j]) continue;
    const a = new Array<number>(total).fill(0);
    a[j] = 1;
    a[absIndex[j]] = -1;
    rows.push({ coef: a, sense: '<=', rhs: 0, name: `|x${j + 1}| >= x${j + 1}` });
    const bb = new Array<number>(total).fill(0);
    bb[j] = -1;
    bb[absIndex[j]] = -1;
    rows.push({ coef: bb, sense: '<=', rhs: 0, name: `|x${j + 1}| >= −x${j + 1}` });
  }
  const lo = new Array<number>(total).fill(0);
  const up = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < n; j++) {
    lo[j] = lower[j];
    up[j] = upper[j];
  }
  return { objective, rows, lower: lo, upper: up, total, absIndex };
}

/** Coefficient of |x_j| in a robust row: u_j if it exists, otherwise x_j itself. */
const absSlot = (ext: Extended, j: number): number => (ext.absIndex[j] >= 0 ? ext.absIndex[j] : j);

export interface RobustSolution {
  status: SolveStatus;
  x: number[];
  /** Objective of the robust counterpart. */
  objective: number;
  /** Worst-case left-hand side of each uncertain row at the solution. */
  worstCase: { name: string; worstLhs: number; rhs: number; slack: number }[];
  provenance: Provenance;
}

/* ------------------------------------------------------------ box set */

export function solveBoxRobust(lp: LpProblem, uncertain: UncertainRow[]): RobustSolution {
  if (uncertain.length === 0) throw new EngineError('A robust counterpart needs at least one uncertain row.', 'empty');
  const n = lp.objective.length;
  const devs = uncertain.map((r) => checkUncertainRow(r, n));
  const ext = withAbsoluteValues(lp);
  const rows = [...ext.rows];
  uncertain.forEach((r, i) => {
    const coef = new Array<number>(ext.total).fill(0);
    for (let j = 0; j < n; j++) coef[j] += r.nominal[j];
    for (let j = 0; j < n; j++) coef[absSlot(ext, j)] += devs[i][j];
    rows.push({ coef, sense: '<=', rhs: r.rhs, name: `box-robust ${r.name}` });
  });
  const sol = requireOptimal({ sense: lp.sense, objective: ext.objective, rows, lower: ext.lower, upper: ext.upper, constant: lp.constant }, 'The box-robust counterpart');
  const x = sol.x.slice(0, n);
  return {
    status: 'optimal',
    x,
    objective: sol.objective,
    worstCase: uncertain.map((r, i) => {
      const w = stableSum(r.nominal.map((a, j) => a * x[j])) + stableSum(devs[i].map((d, j) => d * Math.abs(x[j])));
      return { name: r.name, worstLhs: w, rhs: r.rhs, slack: r.rhs - w };
    }),
    provenance: {
      exactness: 'exact',
      method: 'Box (interval) robust counterpart: āᵀx + âᵀ|x| <= b, an exact linear reformulation solved to optimality',
      assumedInputs: ['The interval half-widths are the user\'s claim about the largest possible deviation. A box set has no probability attached and makes no distributional claim.'],
      limitations: [
        'The box set assumes every coefficient can hit its extreme simultaneously, which is the most conservative assumption consistent with the intervals. If the coefficients are not perfectly co-monotone this is pessimistic; the budgeted set is the dial that relaxes it.',
      ],
    },
  };
}

/* ---------------------------------------------------- ellipsoidal set */

export interface EllipsoidalRow extends UncertainRow {
  /** Shape matrix of the ellipsoid; must be positive definite. */
  covariance: Matrix;
  /** Radius Ω in units of the shape matrix. */
  radius: number;
}

export function ellipsoidalConstraint(row: EllipsoidalRow, n: number): ConvexConstraint {
  if (row.nominal.length !== n) throw new EngineError(`Uncertain row "${row.name}" has ${row.nominal.length} nominal coefficients but the program has ${n} variables.`, 'shape');
  if (!(row.radius > 0)) {
    throw new EngineError(
      `Ellipsoidal row "${row.name}" has radius ${String(row.radius)}. A radius of 0 collapses the set to the single point ā, which is the nominal problem rather than a robust one; a negative radius has no meaning.`,
      'degenerate',
    );
  }
  requirePositiveDefinite(row.covariance, n, `The shape matrix of ellipsoidal row "${row.name}"`);
  return {
    name: `ellipsoidal ${row.name}`,
    value: (x) => stableSum(row.nominal.map((a, j) => a * x[j])) + row.radius * constraintSd(row.covariance, x) - row.rhs,
    gradient: (x) => {
      const sd = constraintSd(row.covariance, x);
      const sx = matVec(row.covariance, x);
      return row.nominal.map((a, j) => a + (sd > 1e-14 ? (row.radius * sx[j]) / sd : 0));
    },
  };
}

export function solveEllipsoidalRobust(lp: LpProblem, uncertain: EllipsoidalRow[]): RobustSolution & { solution: ConvexSolution } {
  if (uncertain.length === 0) throw new EngineError('A robust counterpart needs at least one uncertain row.', 'empty');
  const n = lp.objective.length;
  const constraints = uncertain.map((r) => ellipsoidalConstraint(r, n));
  const sol = solveConvexLp(lp, constraints);
  if (sol.status !== 'optimal') {
    throw new EngineError(`The ellipsoidal robust counterpart ended "${sol.status}", so no robust decision can be reported.`, sol.status);
  }
  return {
    status: 'optimal',
    x: sol.x,
    objective: sol.objective,
    solution: sol,
    worstCase: uncertain.map((r) => {
      const w = stableSum(r.nominal.map((a, j) => a * sol.x[j])) + r.radius * constraintSd(r.covariance, sol.x);
      return { name: r.name, worstLhs: w, rhs: r.rhs, slack: r.rhs - w };
    }),
    provenance: {
      exactness: 'numerical',
      method: `Ellipsoidal robust counterpart āᵀx + Ω‖Σ^{1/2}x‖ <= b solved by Kelley cutting planes (${sol.cuts} cuts, largest residual ${sol.maxViolation.toExponential(2)})`,
      assumedInputs: ['The shape matrix and radius define the set the decision is protected against. They carry no probability unless the user supplies one.'],
      limitations: [
        'This is the same algebraic form as a Gaussian chance constraint with Ω = z_{1−ε}. Reading the radius as a reliability level imports the Gaussian assumption; reading it as a set does not.',
        'Labelled numerical because the cone boundary is approached by a finite cut sequence; the residual above is the distance from it.',
      ],
    },
  };
}

/* ----------------------------------------------------- polyhedral set */

export interface PolyhedralRow extends UncertainRow {
  /** a = ā + P ζ. P is n × k. */
  P: Matrix;
  /** The primitive set D ζ <= d, D is r × k. */
  D: Matrix;
  d: number[];
}

/**
 * Robust counterpart of a polyhedral set, by linear-programming duality rather
 * than by enumerating vertices. Exact, and linear in the size of the primitive
 * description.
 */
export function solvePolyhedralRobust(lp: LpProblem, uncertain: PolyhedralRow[]): RobustSolution {
  if (uncertain.length === 0) throw new EngineError('A robust counterpart needs at least one uncertain row.', 'empty');
  const n = lp.objective.length;
  uncertain.forEach((r) => {
    if (r.P.length !== n) throw new EngineError(`Polyhedral row "${r.name}": P has ${r.P.length} rows but the program has ${n} variables.`, 'shape');
    const k = r.P[0].length;
    for (const row of r.P) if (row.length !== k) throw new EngineError(`Polyhedral row "${r.name}": P is ragged.`, 'shape');
    if (r.D.length !== r.d.length) throw new EngineError(`Polyhedral row "${r.name}": D has ${r.D.length} rows but d has ${r.d.length} entries.`, 'shape');
    if (r.D.length === 0) {
      throw new EngineError(`Polyhedral row "${r.name}": the primitive set Dζ <= d has no rows, so ζ is unbounded and the worst case is +∞. A degenerate uncertainty set cannot be made robust against.`, 'degenerate');
    }
    for (const row of r.D) if (row.length !== k) throw new EngineError(`Polyhedral row "${r.name}": a row of D has ${row.length} entries but P has ${k} columns.`, 'shape');
  });
  // λ_i >= 0, one block of r_i multipliers per uncertain row.
  const offsets: number[] = [];
  let total = n;
  for (const r of uncertain) {
    offsets.push(total);
    total += r.D.length;
  }
  const objective = new Array<number>(total).fill(0);
  for (let j = 0; j < n; j++) objective[j] = lp.objective[j];
  const rows: LpRow[] = lp.rows.map((r, i) => {
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] = r.coef[j];
    return { coef, sense: r.sense, rhs: r.rhs, name: r.name ?? `row ${i + 1}` };
  });
  uncertain.forEach((r, i) => {
    const off = offsets[i];
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] = r.nominal[j];
    for (let l = 0; l < r.D.length; l++) coef[off + l] = r.d[l];
    rows.push({ coef, sense: '<=', rhs: r.rhs, name: `polyhedral-robust ${r.name}` });
    const k = r.P[0].length;
    for (let c = 0; c < k; c++) {
      const eq = new Array<number>(total).fill(0);
      for (let l = 0; l < r.D.length; l++) eq[off + l] = r.D[l][c];
      for (let j = 0; j < n; j++) eq[j] -= r.P[j][c];
      rows.push({ coef: eq, sense: '=', rhs: 0, name: `${r.name}: dual balance ${c + 1}` });
    }
  });
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < n; j++) {
    lower[j] = lp.lower?.[j] ?? 0;
    upper[j] = lp.upper?.[j] ?? Infinity;
  }
  const sol = requireOptimal({ sense: lp.sense, objective, rows, lower, upper, constant: lp.constant }, 'The polyhedral robust counterpart');
  const x = sol.x.slice(0, n);
  return {
    status: 'optimal',
    x,
    objective: sol.objective,
    worstCase: uncertain.map((r) => {
      // Worst case recovered by maximising over ζ directly, independently of the duals.
      const k = r.P[0].length;
      const px = Array.from({ length: k }, (_, c) => stableSum(x.map((v, j) => r.P[j][c] * v)));
      const inner = solveLp({
        sense: 'max',
        objective: px,
        rows: r.D.map((row, l) => ({ coef: [...row], sense: '<=' as const, rhs: r.d[l], name: `primitive ${l + 1}` })),
        lower: new Array<number>(k).fill(-Infinity),
        upper: new Array<number>(k).fill(Infinity),
      });
      const extra = inner.status === 'optimal' ? inner.objective : Infinity;
      const w = stableSum(r.nominal.map((a, j) => a * x[j])) + extra;
      return { name: r.name, worstLhs: w, rhs: r.rhs, slack: r.rhs - w };
    }),
    provenance: {
      exactness: 'exact',
      method: 'Polyhedral robust counterpart by linear-programming duality over the primitive set, solved to optimality as one linear program',
      assumedInputs: ['The primitive description Dζ <= d is the user\'s claim about which joint deviations are possible.'],
      limitations: ['The counterpart adds one multiplier per primitive row per uncertain row, so a finely described set makes a large program.'],
    },
  };
}

/* ------------------------------------------- budgeted (Bertsimas–Sim) */

export interface BudgetedSolution extends RobustSolution {
  /** The protection budget Γ: how many coefficients may deviate fully at once. */
  budget: number;
  /** Bertsimas–Sim's probabilistic bound on violating the row, under symmetric independent deviations. */
  violationBound: number;
}

/**
 * Bertsimas–Sim budgeted uncertainty: ζ ∈ [−1,1]^n with ‖ζ‖₁ <= Γ. Γ = 0 is the
 * nominal problem and Γ = n is the box, so Γ is a continuous dial between them.
 *
 * The accompanying probabilistic bound (violation probability at most
 * exp(−Γ²/(2n)) for independent symmetric deviations) is reported, and is
 * labelled as resting on that independence, which is an assumption and not a
 * consequence of the set.
 */
export function solveBudgetedRobust(lp: LpProblem, uncertain: UncertainRow[], budget: number): BudgetedSolution {
  if (uncertain.length === 0) throw new EngineError('A robust counterpart needs at least one uncertain row.', 'empty');
  const n = lp.objective.length;
  const devs = uncertain.map((r) => checkUncertainRow(r, n));
  if (!Number.isFinite(budget) || budget < 0) throw new EngineError(`The protection budget Γ is ${String(budget)}; it must be finite and non-negative.`, 'range');
  const maxBudget = Math.max(...devs.map((d) => d.filter((v) => v > 0).length));
  if (budget > maxBudget + 1e-12) {
    throw new EngineError(
      `The protection budget Γ = ${budget} exceeds the number of genuinely uncertain coefficients (${maxBudget}). Beyond that the set is already the whole box and a larger Γ buys nothing, so the request is a modelling mistake rather than extra safety.`,
      'range',
    );
  }
  const ext = withAbsoluteValues(lp);
  // Per uncertain row i: θ_i >= 0 and p_ij >= 0.
  const thetaAt: number[] = [];
  const pAt: number[] = [];
  let total = ext.total;
  uncertain.forEach(() => {
    thetaAt.push(total++);
    pAt.push(total);
    total += n;
  });
  const objective = new Array<number>(total).fill(0);
  for (let j = 0; j < ext.total; j++) objective[j] = ext.objective[j];
  const rows: LpRow[] = ext.rows.map((r) => ({ coef: [...r.coef, ...new Array<number>(total - ext.total).fill(0)], sense: r.sense, rhs: r.rhs, name: r.name }));
  uncertain.forEach((r, i) => {
    const coef = new Array<number>(total).fill(0);
    for (let j = 0; j < n; j++) coef[j] += r.nominal[j];
    coef[thetaAt[i]] += budget;
    for (let j = 0; j < n; j++) coef[pAt[i] + j] += 1;
    rows.push({ coef, sense: '<=', rhs: r.rhs, name: `budgeted-robust ${r.name}` });
    for (let j = 0; j < n; j++) {
      // p_ij + θ_i >= â_ij · |x_j|
      const c2 = new Array<number>(total).fill(0);
      c2[pAt[i] + j] = 1;
      c2[thetaAt[i]] = 1;
      c2[absSlot(ext, j)] -= devs[i][j];
      rows.push({ coef: c2, sense: '>=', rhs: 0, name: `${r.name}: protection of coefficient ${j + 1}` });
    }
  });
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < ext.total; j++) {
    lower[j] = ext.lower[j];
    upper[j] = ext.upper[j];
  }
  const sol = requireOptimal({ sense: lp.sense, objective, rows, lower, upper, constant: lp.constant }, `The budgeted robust counterpart at Γ = ${budget}`);
  const x = sol.x.slice(0, n);
  const violationBound = Math.min(1, Math.exp(-(budget * budget) / (2 * Math.max(1, maxBudget))));
  return {
    status: 'optimal',
    x,
    objective: sol.objective,
    budget,
    violationBound,
    worstCase: uncertain.map((r, i) => {
      // Worst case over the budgeted set: the Γ largest â_ij|x_j| terms, with a fractional remainder.
      const terms = devs[i].map((d, j) => d * Math.abs(x[j])).sort((a, b) => b - a);
      let extra = 0;
      let remaining = budget;
      for (const t of terms) {
        if (remaining <= 0) break;
        extra += Math.min(1, remaining) * t;
        remaining -= 1;
      }
      const w = stableSum(r.nominal.map((a, j) => a * x[j])) + extra;
      return { name: r.name, worstLhs: w, rhs: r.rhs, slack: r.rhs - w };
    }),
    provenance: {
      exactness: 'exact',
      method: `Bertsimas–Sim budgeted robust counterpart at Γ = ${budget}, an exact linear reformulation solved to optimality`,
      assumedInputs: [
        'The half-widths â bound each coefficient\'s deviation; Γ bounds how many may deviate fully at once. Γ is a choice about how much protection to buy, not an estimate of anything.',
      ],
      limitations: [
        `The probabilistic violation bound exp(−Γ²/(2n)) = ${violationBound.toExponential(3)} assumes the deviations are independent and symmetric about zero. The SET-based guarantee needs no such assumption; the probability attached to it does.`,
        'Γ = 0 reproduces the nominal problem and Γ = n the box set; intermediate values are the useful range and the price-of-robustness curve is how to choose one.',
      ],
    },
  };
}

export interface PriceOfRobustnessPoint {
  budget: number;
  objective: number;
  /** Objective minus the nominal (Γ = 0) objective: what this protection costs. */
  costOfProtection: number;
  violationBound: number;
  x: number[];
}

/**
 * The price-of-robustness curve: objective against Γ. Monotone in Γ for a
 * minimisation problem because the uncertainty sets are nested, and that
 * monotonicity is checked here rather than assumed, so a non-monotone curve
 * surfaces as an error instead of as a plausible-looking chart.
 */
export function priceOfRobustness(lp: LpProblem, uncertain: UncertainRow[], budgets: number[]): { curve: PriceOfRobustnessPoint[]; provenance: Provenance } {
  if (budgets.length === 0) throw new EngineError('The price-of-robustness curve needs at least one protection budget.', 'empty');
  const sorted = [...budgets].sort((a, b) => a - b);
  const dir = lp.sense === 'min' ? 1 : -1;
  const curve: PriceOfRobustnessPoint[] = [];
  let base = NaN;
  for (const budget of sorted) {
    const sol = solveBudgetedRobust(lp, uncertain, budget);
    if (!Number.isFinite(base)) base = sol.objective;
    curve.push({ budget, objective: sol.objective, costOfProtection: dir * (sol.objective - base), violationBound: sol.violationBound, x: sol.x });
  }
  for (let i = 1; i < curve.length; i++) {
    const step = dir * (curve[i].objective - curve[i - 1].objective);
    if (step < -1e-7 * (1 + Math.abs(curve[i].objective))) {
      throw new EngineError(
        `The price-of-robustness curve is not monotone: raising Γ from ${curve[i - 1].budget} to ${curve[i].budget} IMPROVED the objective by ${Math.abs(step).toExponential(3)}. The budgeted uncertainty sets are nested, so that is impossible and indicates a numerical failure, not a cheaper form of protection.`,
        'degenerate',
      );
    }
  }
  return {
    curve,
    provenance: {
      exactness: 'exact',
      method: `Price-of-robustness curve from ${curve.length} exact budgeted robust counterparts at Γ ∈ {${sorted.join(', ')}}`,
      assumedInputs: ['Each point is the exact optimum of its own robust counterpart; only the half-widths are assumed.'],
      limitations: [
        'The curve shows what protection costs in objective units. It cannot say how much protection is worth, which is a judgement about consequences the model does not contain.',
      ],
    },
  };
}

/* ------------------------------------------ cross-evaluation of regimes */

export interface CrossEvaluation {
  /** evaluations[solution][criterion]. */
  table: number[][];
  solutionNames: string[];
  criterionNames: string[];
  /** For each criterion, which solution is best, and by how much over the others. */
  best: { criterion: string; solution: string; value: number; regretOfOthers: { solution: string; regret: number }[] }[];
  provenance: Provenance;
}

/**
 * Score every candidate decision under every criterion: the robust solution
 * under benign conditions, the nominal solution in the worst case, and so on.
 * A single row of this table is the usual presentation and is the misleading
 * one; the whole table is the honest one.
 */
export function crossEvaluate(
  solutions: { name: string; x: number[] }[],
  criteria: { name: string; evaluate(x: number[]): number; better?: 'lower' | 'higher' }[],
): CrossEvaluation {
  if (solutions.length === 0 || criteria.length === 0) throw new EngineError('Cross-evaluation needs at least one solution and one criterion.', 'empty');
  const table = solutions.map((s) =>
    criteria.map((c) => {
      const v = c.evaluate(s.x);
      if (!Number.isFinite(v) && v !== Infinity && v !== -Infinity) {
        throw new EngineError(`Criterion "${c.name}" returned ${String(v)} for solution "${s.name}". A criterion must return a real number or an explicit infinity (for infeasible).`, 'finite');
      }
      return v;
    }),
  );
  const best = criteria.map((c, k) => {
    const lower = (c.better ?? 'lower') === 'lower';
    let bi = 0;
    for (let i = 1; i < solutions.length; i++) {
      if (lower ? table[i][k] < table[bi][k] : table[i][k] > table[bi][k]) bi = i;
    }
    return {
      criterion: c.name,
      solution: solutions[bi].name,
      value: table[bi][k],
      regretOfOthers: solutions.map((s, i) => ({ solution: s.name, regret: lower ? table[i][k] - table[bi][k] : table[bi][k] - table[i][k] })),
    };
  });
  return {
    table,
    solutionNames: solutions.map((s) => s.name),
    criterionNames: criteria.map((c) => c.name),
    best,
    provenance: {
      exactness: 'numerical',
      method: `Cross-evaluation of ${solutions.length} decisions under ${criteria.length} criteria; each cell is that decision scored under that criterion's own assumptions`,
      assumedInputs: ['Each criterion encodes a different view of the uncertainty. They disagree, and choosing between them is a judgement rather than a calculation.'],
      limitations: [
        'No row of this table dominates: a decision that is best in the worst case is normally worse on average, and vice versa. The table shows the exchange rate and stops there.',
      ],
    },
  };
}

/* ------------------------------- distributionally robust, moment-based */

export interface TwoPointDistribution {
  values: number[];
  probabilities: number[];
}

export interface WorstCaseExcess {
  /** sup E[(X − b)⁺] over all laws with this mean and variance. */
  bound: number;
  /** The two-point law that attains it, which the moment constraints pin down uniquely. */
  extremal: TwoPointDistribution;
  mean: number;
  variance: number;
  threshold: number;
  provenance: Provenance;
}

/**
 * The moment bound sup E[(X − b)⁺] = ½[(μ − b) + sqrt((μ − b)² + σ²)] over every
 * distribution with mean μ and variance σ² (Scarf 1958; Ben-Tal & Hochman 1972).
 *
 * The extremal law is two-point and in closed form: the mass sits at b ± t with
 * t = sqrt((μ−b)² + σ²) and P(b + t) = (μ − b + t)/(2t). The three moment
 * conditions (total mass, mean, second moment about b) determine it uniquely
 * once the value is known, so there is nothing to search for; the construction
 * is returned so the bound can be checked against the law that attains it
 * instead of taken on trust.
 */
export function worstCaseExpectedExcess(mean: number, variance: number, threshold: number): WorstCaseExcess {
  if (!Number.isFinite(mean) || !Number.isFinite(threshold)) throw new EngineError('The mean and the threshold must both be finite.', 'finite');
  if (!(variance > 0)) {
    throw new EngineError(
      `The variance is ${String(variance)}. With zero or negative variance the moment ambiguity set is a single point mass (or is empty), so there is no worst case to bound; evaluate the point mass directly.`,
      'degenerate',
    );
  }
  const d = mean - threshold;
  const t = Math.sqrt(d * d + variance);
  const bound = 0.5 * (d + t);
  const pUp = (d + t) / (2 * t);
  return {
    bound,
    extremal: { values: [threshold + t, threshold - t], probabilities: [pUp, 1 - pUp] },
    mean,
    variance,
    threshold,
    provenance: {
      exactness: 'exact',
      method: 'Scarf / Ben-Tal–Hochman moment bound sup E[(X−b)⁺] = ½[(μ−b) + sqrt((μ−b)²+σ²)], with the attaining two-point law in closed form',
      assumedInputs: ['The mean and variance are taken as known. Nothing else about the distribution is assumed, which is the point.'],
      limitations: [
        'This is a BOUND, not an estimate. No distribution with these two moments can exceed it, and the two-point law returned here attains it exactly — which is also why it is loose for any realistic law: the worst case is a law that puts all its mass at two points.',
        'Knowing more than two moments, or a support restriction, tightens the bound substantially. Supplying those is the way to narrow it.',
      ],
    },
  };
}

/**
 * Worst-case CVaR over the same moment set: μ + σ·sqrt(α/(1−α)) (El Ghaoui,
 * Oks & Oustry 2003). Equal to the worst-case VaR over that set, which is the
 * Cantelli bound — the two coincide precisely because the extremal law is
 * two-point.
 */
export function worstCaseCvar(mean: number, variance: number, level: number): { bound: number; cantelliVar: number; provenance: Provenance } {
  if (!(variance > 0)) throw new EngineError(`The variance is ${String(variance)}; the moment ambiguity set is degenerate.`, 'degenerate');
  if (!Number.isFinite(level) || level <= 0 || level >= 1) throw new EngineError(`The CVaR level must lie strictly inside (0,1); got ${String(level)}.`, 'range');
  const k = Math.sqrt(level / (1 - level));
  const bound = mean + Math.sqrt(variance) * k;
  return {
    bound,
    cantelliVar: bound,
    provenance: {
      exactness: 'exact',
      method: 'Worst-case CVaR over a mean–covariance ambiguity set: μ + σ·sqrt(α/(1−α))',
      assumedInputs: ['Only the mean and variance are assumed known.'],
      limitations: [
        'Worst-case CVaR and worst-case VaR coincide over a moment set, so this single number is simultaneously the tightest distribution-free bound on both. Under a specific distribution they differ, and CVaR is the larger.',
      ],
    },
  };
}

/** Cantelli's bound on P(X >= b) given only a mean and a variance. */
export function cantelliExceedanceBound(mean: number, variance: number, threshold: number): number {
  if (!(variance > 0)) throw new EngineError(`The variance is ${String(variance)}; Cantelli's bound needs a positive variance.`, 'degenerate');
  const d = threshold - mean;
  if (d <= 0) return 1;
  return variance / (variance + d * d);
}

export interface DroSolution {
  x: number[];
  /** cᵀx plus the worst-case expected excess, weighted. */
  objective: number;
  worstCaseExcess: number;
  /** cᵀx alone. */
  nominalPart: number;
  provenance: Provenance;
}

/**
 * min cᵀx + w · sup_{P ∈ 𝒫(μ,Σ)} E_P[(ξᵀx − b)⁺], over the moment ambiguity set.
 *
 * The inner supremum has the closed form above with μ_x = μᵀx and σ²_x = xᵀΣx,
 * and is convex in x, so the whole thing is a convex programme solved by the
 * same cutting-plane machinery as the conic constraints.
 */
export function solveDistributionallyRobustExcess(
  lp: LpProblem,
  spec: { meanCoef: number[]; covariance: Matrix; threshold: number; weight: number },
): DroSolution {
  const n = lp.objective.length;
  if (spec.meanCoef.length !== n) throw new EngineError(`The mean coefficient vector has ${spec.meanCoef.length} entries but the program has ${n} variables.`, 'shape');
  requirePositiveDefinite(spec.covariance, n, 'The covariance of the ambiguity set');
  if (!(spec.weight > 0)) throw new EngineError(`The weight on the worst-case excess is ${String(spec.weight)}; it must be positive or the term does nothing.`, 'range');
  const worst = (x: number[]): { value: number; grad: number[] } => {
    const mu = stableSum(spec.meanCoef.map((a, j) => a * x[j]));
    const sx = matVec(spec.covariance, x);
    let v = 0;
    for (let j = 0; j < n; j++) v += x[j] * sx[j];
    v = Math.max(0, v);
    const d = mu - spec.threshold;
    const t = Math.sqrt(d * d + v);
    if (t < 1e-14) return { value: 0, grad: new Array<number>(n).fill(0) };
    const grad = spec.meanCoef.map((a, j) => 0.5 * (a + (d * a + sx[j]) / t));
    return { value: 0.5 * (d + t), grad };
  };
  // Epigraph variable τ for the worst-case term.

  const objective = [...lp.objective, spec.weight];
  const rows: LpRow[] = lp.rows.map((r, i) => ({ coef: [...r.coef, 0], sense: r.sense, rhs: r.rhs, name: r.name ?? `row ${i + 1}` }));
  const lower = [...(lp.lower ?? new Array<number>(n).fill(0)), 0];
  const upper = [...(lp.upper ?? new Array<number>(n).fill(Infinity)), Infinity];
  const constraint: ConvexConstraint = {
    name: 'worst-case expected excess',
    value: (z) => worst(z.slice(0, n)).value - z[n],
    gradient: (z) => [...worst(z.slice(0, n)).grad, -1],
  };
  const sol = solveConvexLp({ sense: 'min', objective, rows, lower, upper, constant: lp.constant }, [constraint]);
  if (sol.status !== 'optimal') {
    throw new EngineError(`The distributionally robust program ended "${sol.status}", so no decision can be reported.`, sol.status);
  }
  const x = sol.x.slice(0, n);
  const w = worst(x);
  return {
    x,
    objective: sol.objective,
    worstCaseExcess: w.value,
    nominalPart: stableSum(lp.objective.map((c, j) => c * x[j])),
    provenance: {
      exactness: 'numerical',
      method: `Moment-based distributionally robust programme: the inner supremum in closed form (Scarf bound), the outer minimisation by Kelley cutting planes (${sol.cuts} cuts, residual ${sol.maxViolation.toExponential(2)})`,
      assumedInputs: ['The mean vector and covariance matrix are assumed known; no distributional shape is assumed.'],
      limitations: [
        'The objective is a worst case over a very large family, so it is pessimistic by design. Under any specific law with these moments the realised cost is lower, and the gap between them is the price of not knowing the distribution.',
        'Labelled numerical because of the finite cut sequence; the inner bound itself is exact.',
      ],
    },
  };
}
