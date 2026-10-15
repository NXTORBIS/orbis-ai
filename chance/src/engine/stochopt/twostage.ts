/**
 * Two-stage stochastic programming with recourse.
 *
 *     min  cᵀx + Σ_s p_s · Q(x, ω_s),
 *     Q(x, ω) = min { qᵀy : W(ω) y ~ h(ω) − T(ω) x, y ∈ [y, ȳ] },  x ∈ X.
 *
 * Two independent routes compute the same number, which is the only strong
 * correctness evidence available for a solver:
 *
 *  1. The DETERMINISTIC EQUIVALENT (extensive form): one copy of the recourse
 *     variables per scenario in a single linear program. Exact, and the natural
 *     reference, but its size grows linearly in the scenario count.
 *  2. BENDERS DECOMPOSITION (the L-shaped method): a master problem in x and a
 *     single aggregated recourse epigraph variable θ, refined by optimality
 *     cuts from the scenario duals and feasibility cuts from the scenario
 *     elastic programs. Terminates on a measured gap, which is reported; the
 *     status is `feasible-with-gap` whenever that gap has not closed.
 *
 * The two diagnostics
 * -------------------
 * Both are computed on every problem, because "just use the average" is what
 * people actually do and these two numbers are what it costs:
 *
 *   EVPI = RP − WS   the value of perfect information: what foresight is worth.
 *   VSS  = EEV − RP  the value of the stochastic solution: what optimising
 *                    against the mean scenario instead of the distribution
 *                    costs you.
 *
 * Both are >= 0 for a minimisation problem by construction (WS <= RP <= EEV),
 * and that is asserted here rather than assumed, so a sign error surfaces as an
 * `EngineError` instead of as a confident negative number.
 */
import { EngineError, Validator } from '../core/result';
import { stableSum } from '../core/numeric';
import { requireOptimal, rowName, solveLp, solveLpWithDuals, FEASIBILITY_TOLERANCE, SIMPLEX_TOLERANCE } from './linear';
import type {
  CutReport,
  LpProblem,
  LpRow,
  MeanValueReport,
  Provenance,
  Scenario,
  ScenarioRow,
  StochasticDiagnostics,
  TwoStageProblem,
  TwoStageSolution,
} from './types';

export const PROBABILITY_SUM_TOLERANCE = 1e-9;

export interface TwoStageShape {
  n1: number;
  n2: number;
  m2: number;
}

/** Validate a two-stage problem, refusing every malformed case by name. */
export function validateTwoStage(p: TwoStageProblem): TwoStageShape {
  const v = new Validator();
  const n1 = p.c.length;
  const n2 = p.q.length;
  if (n1 === 0) v.add('The first stage has no decision variables, so there is nothing to decide now.', 'c', 'empty');
  if (n2 === 0) v.add('The second stage has no recourse variables, so the problem has no recourse to optimise.', 'q', 'empty');
  if (p.scenarios.length === 0) {
    v.add('The scenario set is empty. A two-stage problem needs at least one scenario with a probability.', 'scenarios', 'empty');
    v.throwIfInvalid();
  }
  for (const [i, s] of p.scenarios.entries()) {
    if (!Number.isFinite(s.probability) || s.probability < 0) {
      v.add(`Scenario "${s.name || i + 1}" has probability ${String(s.probability)}; probabilities must be finite and non-negative.`, 'scenarios', 'range');
    }
  }
  const sum = stableSum(p.scenarios.map((s) => s.probability));
  if (Math.abs(sum - 1) > PROBABILITY_SUM_TOLERANCE) {
    v.add(
      `The scenario probabilities sum to ${sum.toPrecision(12)}, not 1. Normalise them or add the missing scenario; a shortfall of ${(1 - sum).toPrecision(6)} is unaccounted probability, not a rounding detail.`,
      'scenarios',
      'sum',
    );
  }
  const m2 = p.scenarios[0].rows.length;
  if (m2 === 0) v.add('Every scenario has an empty constraint list, so the recourse decision is unconstrained and the problem is not a recourse problem.', 'scenarios', 'empty');
  p.scenarios.forEach((s, i) => {
    if (s.rows.length !== m2) {
      v.add(
        `Scenario "${s.name || i + 1}" has ${s.rows.length} recourse constraints but scenario "${p.scenarios[0].name || 1}" has ${m2}. The right-hand side and the matrices may vary with the scenario; the problem's shape may not.`,
        'scenarios',
        'shape',
      );
      return;
    }
    s.rows.forEach((r, k) => {
      if (r.T.length !== n1) v.add(`Scenario "${s.name || i + 1}", ${rowName({ coef: [], sense: r.sense, rhs: r.rhs, name: r.name }, k)}: T has ${r.T.length} entries, expected ${n1}.`, 'scenarios', 'shape');
      if (r.W.length !== n2) v.add(`Scenario "${s.name || i + 1}", ${rowName({ coef: [], sense: r.sense, rhs: r.rhs, name: r.name }, k)}: W has ${r.W.length} entries, expected ${n2}.`, 'scenarios', 'shape');
      if (r.sense !== p.scenarios[0].rows[k].sense) {
        v.add(`Scenario "${s.name || i + 1}" row ${k + 1} has sense "${r.sense}" but scenario 1 row ${k + 1} has sense "${p.scenarios[0].rows[k].sense}". Row senses are part of the problem's shape.`, 'scenarios', 'shape');
      }
    });
  });
  v.throwIfInvalid();
  return { n1, n2, m2 };
}

const pad = (coef: number[], before: number, total: number): number[] => {
  const out = new Array<number>(total).fill(0);
  for (let j = 0; j < coef.length; j++) out[before + j] = coef[j];
  return out;
};

/**
 * Build the extensive form: x, then one block of recourse variables per
 * scenario. Returned as a plain `LpProblem` so it can be inspected or solved
 * by anything that takes one.
 */
export function deterministicEquivalent(p: TwoStageProblem): { lp: LpProblem; shape: TwoStageShape } {
  const shape = validateTwoStage(p);
  const { n1, n2 } = shape;
  const S = p.scenarios.length;
  const total = n1 + S * n2;
  const objective = new Array<number>(total).fill(0);
  for (let j = 0; j < n1; j++) objective[j] = p.c[j];
  p.scenarios.forEach((s, i) => {
    for (let j = 0; j < n2; j++) objective[n1 + i * n2 + j] = s.probability * p.q[j];
  });
  const rows: LpRow[] = p.firstStageRows.map((r, i) => ({
    coef: pad(r.coef, 0, total),
    sense: r.sense,
    rhs: r.rhs,
    name: `first stage: ${rowName(r, i)}`,
  }));
  p.scenarios.forEach((s, i) => {
    s.rows.forEach((r, k) => {
      const coef = new Array<number>(total).fill(0);
      for (let j = 0; j < n1; j++) coef[j] = r.T[j];
      for (let j = 0; j < n2; j++) coef[n1 + i * n2 + j] = r.W[j];
      rows.push({ coef, sense: r.sense, rhs: r.rhs, name: `${s.name || `scenario ${i + 1}`}: ${r.name ?? `row ${k + 1}`}` });
    });
  });
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < n1; j++) {
    lower[j] = p.lower?.[j] ?? 0;
    upper[j] = p.upper?.[j] ?? Infinity;
  }
  for (let i = 0; i < S; i++) {
    for (let j = 0; j < n2; j++) {
      lower[n1 + i * n2 + j] = p.yLower?.[j] ?? 0;
      upper[n1 + i * n2 + j] = p.yUpper?.[j] ?? Infinity;
    }
  }
  const names: string[] = [];
  for (let j = 0; j < n1; j++) names.push(p.firstStageNames?.[j] ?? `x${j + 1}`);
  p.scenarios.forEach((s, i) => {
    for (let j = 0; j < n2; j++) names.push(`${p.secondStageNames?.[j] ?? `y${j + 1}`}[${s.name || i + 1}]`);
  });
  return { lp: { sense: 'min', objective, rows, lower, upper, names }, shape };
}

/* ----------------------------------------------------- the subproblem */

export interface RecourseResult {
  status: 'optimal' | 'infeasible';
  cost: number;
  y: number[];
  /** Multipliers on the scenario rows, used to build Benders cuts. */
  duals: number[];
  /** Total elastic violation when infeasible; which rows and by how much. */
  violations: { row: string; violation: number }[];
}

/**
 * Build the scenario subproblem in the non-negative-orthant minimisation form
 * `solveLpWithDuals` needs: y = yLower + y', finite upper bounds moved into
 * rows so that the scenario rows stay first and their multipliers are directly
 * addressable.
 */
function subproblemLp(p: TwoStageProblem, s: Scenario, x: number[], n2: number): { lp: LpProblem; constant: number; shift: number[] } {
  const yLower = p.yLower ?? new Array<number>(n2).fill(0);
  const yUpper = p.yUpper ?? new Array<number>(n2).fill(Infinity);
  for (let j = 0; j < n2; j++) {
    if (!Number.isFinite(yLower[j])) {
      throw new EngineError(
        `Recourse variable ${p.secondStageNames?.[j] ?? `y${j + 1}`} has no finite lower bound. The decomposition route needs finitely bounded-below recourse variables to produce multipliers; use the deterministic-equivalent route instead.`,
        'range',
      );
    }
  }
  const constant = stableSum(p.q.map((qj, j) => qj * yLower[j]));
  const rows: LpRow[] = s.rows.map((r, k) => {
    let rhs = r.rhs;
    for (let j = 0; j < x.length; j++) rhs -= r.T[j] * x[j];
    for (let j = 0; j < n2; j++) rhs -= r.W[j] * yLower[j];
    return { coef: [...r.W], sense: r.sense, rhs, name: r.name ?? `row ${k + 1}` };
  });
  for (let j = 0; j < n2; j++) {
    if (Number.isFinite(yUpper[j])) {
      const coef = new Array<number>(n2).fill(0);
      coef[j] = 1;
      rows.push({ coef, sense: '<=', rhs: yUpper[j] - yLower[j], name: `upper bound on ${p.secondStageNames?.[j] ?? `y${j + 1}`}` });
    }
  }
  return { lp: { sense: 'min', objective: [...p.q], rows, constant }, constant, shift: yLower };
}

/** Elastic version of the subproblem: always feasible, value 0 iff recourse exists. */
function elasticLp(base: LpProblem, nRows: number): LpProblem {
  const n = base.objective.length;
  const width = n + 2 * nRows;
  const rows: LpRow[] = base.rows.map((r, i) => {
    const coef = new Array<number>(width).fill(0);
    for (let j = 0; j < n; j++) coef[j] = r.coef[j];
    if (i < nRows) {
      coef[n + 2 * i] = 1;
      coef[n + 2 * i + 1] = -1;
    }
    return { coef, sense: r.sense, rhs: r.rhs, name: r.name };
  });
  const objective = new Array<number>(width).fill(0);
  for (let i = 0; i < 2 * nRows; i++) objective[n + i] = 1;
  return { sense: 'min', objective, rows };
}

/** Optimal recourse for one scenario at a fixed first-stage decision. */
export function recourseValue(p: TwoStageProblem, s: Scenario, x: number[], n2: number): RecourseResult {
  const { lp } = subproblemLp(p, s, x, n2);
  const m = s.rows.length;
  const primal = solveLp(lp);
  if (primal.status === 'unbounded') {
    throw new EngineError(
      `The recourse cost in scenario "${s.name}" is unbounded below, so the expected cost is −∞ and no decision is optimal. Bound the recourse variables or correct the recourse cost vector q.`,
      'unbounded',
    );
  }
  if (primal.status === 'infeasible') {
    const el = solveLp(elasticLp(lp, m));
    const violations: { row: string; violation: number }[] = [];
    if (el.status === 'optimal') {
      for (let i = 0; i < m; i++) {
        const vv = Math.abs(el.x[n2 + 2 * i]) + Math.abs(el.x[n2 + 2 * i + 1]);
        if (vv > FEASIBILITY_TOLERANCE) violations.push({ row: s.rows[i].name ?? `row ${i + 1}`, violation: vv });
      }
    }
    return { status: 'infeasible', cost: Infinity, y: [], duals: [], violations };
  }
  const withDuals = solveLpWithDuals(lp);
  if (withDuals.status !== 'optimal') {
    throw new EngineError(`The recourse subproblem for scenario "${s.name}" solved but its dual did not; the model is numerically degenerate.`, 'degenerate');
  }
  if (withDuals.dualityResidual > 1e-6 * (1 + Math.abs(withDuals.objective))) {
    throw new EngineError(
      `Strong duality failed on the recourse subproblem for scenario "${s.name}": primal ${withDuals.objective.toPrecision(10)} vs dual ${withDuals.dualObjective.toPrecision(10)}. No multipliers can be trusted, so no Benders cut is generated.`,
      'degenerate',
    );
  }
  const yLower = p.yLower ?? new Array<number>(n2).fill(0);
  return {
    status: 'optimal',
    cost: withDuals.objective,
    y: withDuals.x.map((v, j) => v + yLower[j]),
    duals: withDuals.duals.slice(0, m),
    violations: [],
  };
}

/** Total elastic violation and its multipliers: the feasibility cut's ingredients. */
function feasibilityCut(p: TwoStageProblem, s: Scenario, x: number[], n2: number): { value: number; duals: number[] } {
  const { lp } = subproblemLp(p, s, x, n2);
  const m = s.rows.length;
  const el = elasticLp(lp, m);
  const sol = solveLpWithDuals(el);
  if (sol.status !== 'optimal') {
    throw new EngineError(
      `The elastic recourse program for scenario "${s.name}" is itself not solvable (status "${sol.status}"). It is feasible by construction, so this indicates numerically degenerate recourse data.`,
      'degenerate',
    );
  }
  return { value: sol.objective, duals: sol.duals.slice(0, m) };
}

/* -------------------------------------- route 1: deterministic equivalent */

export function solveDeterministicEquivalent(p: TwoStageProblem): TwoStageSolution {
  const { lp, shape } = deterministicEquivalent(p);
  const sol = requireOptimal(lp, `The extensive form of "${p.name}"`);
  const { n1, n2 } = shape;
  const x = sol.x.slice(0, n1);
  const firstStageCost = stableSum(p.c.map((cj, j) => cj * x[j]));
  const recourse = p.scenarios.map((s, i) => {
    const y = sol.x.slice(n1 + i * n2, n1 + (i + 1) * n2);
    return { scenario: s.name, probability: s.probability, y, cost: stableSum(p.q.map((qj, j) => qj * y[j])) };
  });
  const expectedRecourseCost = stableSum(recourse.map((r) => r.probability * r.cost));
  const provenance: Provenance = {
    exactness: 'exact',
    method: `Deterministic equivalent (extensive form): a single linear program in ${lp.objective.length} variables and ${lp.rows.length} rows, solved to optimality by two-phase simplex with pivot tolerance ${SIMPLEX_TOLERANCE.toExponential(0)}`,
    assumedInputs: [
      'The scenario set and its probabilities are the user\'s model of the uncertainty, not an observed fact.',
      'Recourse is assumed to be freely chosen after the uncertainty is observed, with no further stages.',
    ],
    limitations: [
      'The extensive form grows linearly in the scenario count; past a few thousand scenarios use the L-shaped route.',
      'The optimum is a vertex; a degenerate problem may have other decisions with the same expected cost, and this route reports one of them.',
    ],
  };
  return {
    status: 'optimal',
    route: 'deterministic-equivalent',
    x,
    objective: sol.objective,
    firstStageCost,
    expectedRecourseCost,
    recourse,
    gap: 0,
    provenance,
  };
}

/* ----------------------------------------- route 2: Benders / L-shaped */

export interface LShapedOptions {
  /** Relative gap at which the method may declare optimality. */
  tolerance?: number;
  maxIterations?: number;
}

/**
 * A valid lower bound on Σ_s p_s Q(x, ω_s) over all feasible x, obtained by
 * relaxing x inside each scenario subproblem. Needed so the master problem is
 * bounded at the first iteration without an invented big-M.
 */
function recourseLowerBound(p: TwoStageProblem, shape: TwoStageShape): number {
  const { n1, n2 } = shape;
  let acc = 0;
  for (const s of p.scenarios) {
    const total = n1 + n2;
    const objective = new Array<number>(total).fill(0);
    for (let j = 0; j < n2; j++) objective[n1 + j] = p.q[j];
    const rows: LpRow[] = p.firstStageRows.map((r, i) => ({ coef: pad(r.coef, 0, total), sense: r.sense, rhs: r.rhs, name: rowName(r, i) }));
    s.rows.forEach((r, k) => {
      const coef = new Array<number>(total).fill(0);
      for (let j = 0; j < n1; j++) coef[j] = r.T[j];
      for (let j = 0; j < n2; j++) coef[n1 + j] = r.W[j];
      rows.push({ coef, sense: r.sense, rhs: r.rhs, name: r.name ?? `row ${k + 1}` });
    });
    const lower = new Array<number>(total).fill(0);
    const upper = new Array<number>(total).fill(Infinity);
    for (let j = 0; j < n1; j++) {
      lower[j] = p.lower?.[j] ?? 0;
      upper[j] = p.upper?.[j] ?? Infinity;
    }
    for (let j = 0; j < n2; j++) {
      lower[n1 + j] = p.yLower?.[j] ?? 0;
      upper[n1 + j] = p.yUpper?.[j] ?? Infinity;
    }
    const sol = solveLp({ sense: 'min', objective, rows, lower, upper });
    if (sol.status === 'unbounded') {
      throw new EngineError(
        `The recourse cost in scenario "${s.name}" is unbounded below even with the first stage free, so the expected-cost objective has no finite optimum. Bound the recourse variables.`,
        'unbounded',
      );
    }
    if (sol.status === 'infeasible') {
      const w = (sol.witnesses ?? []).map((x) => `${x.name} (by ${x.violation.toPrecision(6)})`).join('; ');
      throw new EngineError(
        `Scenario "${s.name}" admits no feasible (x, y) at all, so the two-stage problem is infeasible. Violated: ${w || 'at least one row'}.`,
        'infeasible',
      );
    }
    acc += s.probability * sol.objective;
  }
  return acc;
}

export function solveLShaped(p: TwoStageProblem, options: LShapedOptions = {}): TwoStageSolution {
  const shape = validateTwoStage(p);
  const { n1, n2 } = shape;
  const tol = options.tolerance ?? 1e-10;
  const maxIterations = options.maxIterations ?? 500;
  const thetaFloor = recourseLowerBound(p, shape);

  const total = n1 + 1; // x, then θ
  const objective = [...p.c, 1];
  const baseRows: LpRow[] = p.firstStageRows.map((r, i) => ({ coef: pad(r.coef, 0, total), sense: r.sense, rhs: r.rhs, name: `first stage: ${rowName(r, i)}` }));
  const lower = new Array<number>(total).fill(0);
  const upper = new Array<number>(total).fill(Infinity);
  for (let j = 0; j < n1; j++) {
    lower[j] = p.lower?.[j] ?? 0;
    upper[j] = p.upper?.[j] ?? Infinity;
  }
  lower[n1] = thetaFloor;

  const cuts: LpRow[] = [];
  let optimalityCuts = 0;
  let feasibilityCuts = 0;
  let lowerBound = -Infinity;
  let upperBound = Infinity;
  let bestX: number[] | null = null;
  let iterations = 0;

  for (let it = 0; it < maxIterations; it++) {
    iterations = it + 1;
    const master = requireOptimal(
      { sense: 'min', objective, rows: [...baseRows, ...cuts], lower, upper },
      `The L-shaped master problem of "${p.name}" at iteration ${iterations}`,
    );
    const x = master.x.slice(0, n1);
    const theta = master.x[n1];
    lowerBound = master.objective;

    // Feasibility pass.
    let infeasibleFound = false;
    for (const s of p.scenarios) {
      const fc = feasibilityCut(p, s, x, n2);
      if (fc.value <= FEASIBILITY_TOLERANCE) continue;
      infeasibleFound = true;
      // D_s(x_k) − (T_sᵀσ)ᵀ(x − x_k) <= 0
      const grad = new Array<number>(n1).fill(0);
      s.rows.forEach((r, k) => {
        for (let j = 0; j < n1; j++) grad[j] -= r.T[j] * fc.duals[k];
      });
      let rhs = -fc.value;
      for (let j = 0; j < n1; j++) rhs += grad[j] * x[j];
      cuts.push({ coef: [...grad, 0], sense: '<=', rhs, name: `feasibility cut ${feasibilityCuts + 1} (${s.name})` });
      feasibilityCuts++;
    }
    if (infeasibleFound) continue;

    // Optimality pass: one aggregated cut.
    let expected = 0;
    const grad = new Array<number>(n1).fill(0);
    for (const s of p.scenarios) {
      const r = recourseValue(p, s, x, n2);
      if (r.status !== 'optimal') {
        throw new EngineError(
          `Scenario "${s.name}" has no feasible recourse at the master solution although the feasibility pass found none; the feasibility tolerance ${FEASIBILITY_TOLERANCE.toExponential(0)} is too loose for this data.`,
          'degenerate',
        );
      }
      expected += s.probability * r.cost;
      s.rows.forEach((row, k) => {
        for (let j = 0; j < n1; j++) grad[j] -= s.probability * row.T[j] * r.duals[k];
      });
    }
    const firstStageCost = stableSum(p.c.map((cj, j) => cj * x[j]));
    const candidate = firstStageCost + expected;
    if (candidate < upperBound) {
      upperBound = candidate;
      bestX = x;
    }
    const gapNow = upperBound - lowerBound;
    if (gapNow <= tol * (1 + Math.abs(upperBound))) break;
    if (expected <= theta + tol * (1 + Math.abs(expected))) break;
    let rhs = -expected;
    for (let j = 0; j < n1; j++) rhs += grad[j] * x[j];
    cuts.push({ coef: [...grad, -1], sense: '<=', rhs, name: `optimality cut ${optimalityCuts + 1}` });
    optimalityCuts++;
  }

  if (!bestX) {
    throw new EngineError(
      `The L-shaped method completed ${iterations} iterations without ever finding a first-stage decision with feasible recourse in every scenario, so no incumbent exists. The problem has no relatively-complete recourse and may be infeasible.`,
      'infeasible',
    );
  }
  const gap = Math.max(0, upperBound - lowerBound);
  const relativeGap = gap / (1 + Math.abs(upperBound));
  const converged = relativeGap <= tol;
  const recourse = p.scenarios.map((s) => {
    const r = recourseValue(p, s, bestX as number[], n2);
    return { scenario: s.name, probability: s.probability, y: r.y, cost: r.cost };
  });
  const firstStageCost = stableSum(p.c.map((cj, j) => cj * (bestX as number[])[j]));
  const expectedRecourseCost = stableSum(recourse.map((r) => r.probability * r.cost));
  const report: CutReport = { optimalityCuts, feasibilityCuts, iterations, gap, relativeGap, lowerBound, upperBound };
  const provenance: Provenance = {
    exactness: converged ? 'exact' : 'numerical',
    method: `Benders decomposition (L-shaped, single aggregated cut): ${iterations} master solves, ${optimalityCuts} optimality cuts, ${feasibilityCuts} feasibility cuts; terminal gap ${gap.toExponential(3)} (relative ${relativeGap.toExponential(3)})`,
    assumedInputs: [
      'The scenario set and its probabilities are the user\'s model of the uncertainty.',
      'The recourse value function is convex in x because the subproblems are linear programs; the cuts are valid only under that linearity.',
    ],
    limitations: converged
      ? ['The reported decision is the incumbent that attained the upper bound; the bounds met to within the requested tolerance.']
      : [
          `The method stopped with an open gap of ${gap.toExponential(3)}. The incumbent is feasible and its expected cost is the reported upper bound, but it is NOT proven optimal: the true optimum lies in [${lowerBound.toPrecision(10)}, ${upperBound.toPrecision(10)}].`,
        ],
  };
  return {
    status: converged ? 'optimal' : 'feasible-with-gap',
    route: 'l-shaped',
    x: bestX,
    objective: upperBound,
    firstStageCost,
    expectedRecourseCost,
    recourse,
    gap,
    cuts: report,
    provenance,
  };
}

/** Solve by whichever route suits the size, reporting which was used. */
export function solveTwoStage(p: TwoStageProblem, options: { route?: 'auto' | 'deterministic-equivalent' | 'l-shaped'; tolerance?: number } = {}): TwoStageSolution {
  const shape = validateTwoStage(p);
  const route = options.route ?? 'auto';
  const size = shape.n2 * p.scenarios.length;
  if (route === 'deterministic-equivalent' || (route === 'auto' && size <= 20000)) return solveDeterministicEquivalent(p);
  return solveLShaped(p, { tolerance: options.tolerance });
}

/* --------------------------------------------- the mean scenario and EVPI */

/** Probability-weighted average of the scenario data: the "just use the average" model. */
export function meanScenario(p: TwoStageProblem): Scenario {
  const shape = validateTwoStage(p);
  const rows: ScenarioRow[] = [];
  for (let k = 0; k < shape.m2; k++) {
    const T = new Array<number>(shape.n1).fill(0);
    const W = new Array<number>(shape.n2).fill(0);
    let rhs = 0;
    for (const s of p.scenarios) {
      const r = s.rows[k];
      for (let j = 0; j < shape.n1; j++) T[j] += s.probability * r.T[j];
      for (let j = 0; j < shape.n2; j++) W[j] += s.probability * r.W[j];
      rhs += s.probability * r.rhs;
    }
    rows.push({ T, W, sense: p.scenarios[0].rows[k].sense, rhs, name: p.scenarios[0].rows[k].name });
  }
  return { name: 'mean scenario', probability: 1, rows };
}

/** Expected cost of a GIVEN first-stage decision under the real distribution. */
export function expectedCostOf(p: TwoStageProblem, x: number[]): { cost: number; infeasible: { scenario: string; row: string; violation: number }[] } {
  const shape = validateTwoStage(p);
  if (x.length !== shape.n1) throw new EngineError(`The first-stage decision has ${x.length} entries but the problem has ${shape.n1}.`, 'shape');
  let acc = 0;
  const infeasible: { scenario: string; row: string; violation: number }[] = [];
  for (const s of p.scenarios) {
    const r = recourseValue(p, s, x, shape.n2);
    if (r.status !== 'optimal') {
      for (const v of r.violations) infeasible.push({ scenario: s.name, row: v.row, violation: v.violation });
      acc = Infinity;
      continue;
    }
    if (Number.isFinite(acc)) acc += s.probability * r.cost;
  }
  const firstStageCost = stableSum(p.c.map((cj, j) => cj * x[j]));
  return { cost: Number.isFinite(acc) ? firstStageCost + acc : Infinity, infeasible };
}

/**
 * EVPI and VSS, with both sides of each identity computed from independent
 * solves. The inequalities WS <= RP <= EEV are checked, not trusted.
 */
export function stochasticDiagnostics(p: TwoStageProblem, options: { solution?: TwoStageSolution } = {}): StochasticDiagnostics {
  validateTwoStage(p);
  const rp = options.solution ?? solveTwoStage(p);
  if (rp.status !== 'optimal') {
    throw new EngineError(
      `EVPI and VSS are differences of optimal values, so they cannot be reported for a solve that ended "${rp.status}" with gap ${rp.gap.toExponential(3)}. Close the gap first, or read the bounds instead.`,
      'convergence',
    );
  }

  // Wait-and-see: perfect foresight, one deterministic problem per scenario.
  const waitAndSee = p.scenarios.map((s) => {
    const single: TwoStageProblem = { ...p, scenarios: [{ ...s, probability: 1 }] };
    const sol = solveDeterministicEquivalent(single);
    return { scenario: s.name, probability: s.probability, value: sol.objective, x: sol.x };
  });
  const ws = stableSum(waitAndSee.map((w) => w.probability * w.value));

  // Mean-value problem, then that decision's real expected cost.
  const mv = meanScenario(p);
  const mvProblem: TwoStageProblem = { ...p, scenarios: [mv] };
  const mvSol = solveDeterministicEquivalent(mvProblem);
  const evaluated = expectedCostOf(p, mvSol.x);
  const meanValue: MeanValueReport = {
    x: mvSol.x,
    meanProblemObjective: mvSol.objective,
    expectedCostOfMeanSolution: evaluated.cost,
    infeasibleScenarios: evaluated.infeasible,
  };

  const evpi = rp.objective - ws;
  const vss = evaluated.cost - rp.objective;
  const scale = 1 + Math.abs(rp.objective);
  if (evpi < -1e-7 * scale) {
    throw new EngineError(
      `EVPI came out negative (${evpi.toExponential(3)}). Perfect information cannot cost more than its absence, so this is a defect in the solve, not a property of the problem: wait-and-see ${ws.toPrecision(12)} exceeds the stochastic optimum ${rp.objective.toPrecision(12)}.`,
      'degenerate',
    );
  }
  if (vss < -1e-7 * scale) {
    throw new EngineError(
      `VSS came out negative (${vss.toExponential(3)}). The mean-value decision is feasible for the stochastic problem, so its expected cost ${evaluated.cost.toPrecision(12)} cannot beat the stochastic optimum ${rp.objective.toPrecision(12)}. This is a defect in the solve.`,
      'degenerate',
    );
  }
  const provenance: Provenance = {
    exactness: 'exact',
    method: `EVPI = RP − WS and VSS = EEV − RP from ${1 + p.scenarios.length + 1 + p.scenarios.length} independent linear-programming solves (stochastic programme, ${p.scenarios.length} wait-and-see problems, the mean-value problem, and ${p.scenarios.length} evaluations of the mean-value decision)`,
    assumedInputs: [
      'EVPI values information about THIS scenario set with THESE probabilities. A different distribution gives a different EVPI; it is not a property of the physical system.',
      'VSS measures the penalty of the mean-scenario decision, which is the decision an expected-value model produces.',
    ],
    limitations: [
      'EVPI is an upper bound on what any real, partial information can be worth; no study, survey or forecast can be worth more.',
      evaluated.infeasible.length > 0
        ? `The mean-value decision has NO feasible recourse in ${evaluated.infeasible.length} scenario rows, so EEV and VSS are infinite. That is the honest answer: the average-case plan does not merely cost more, it does not work.`
        : 'VSS is the cost of the mean-scenario decision under this distribution only; it says nothing about a decision made by any other heuristic.',
    ],
  };
  return {
    recourseProblemValue: rp.objective,
    waitAndSeeValue: ws,
    expectedValueOfMeanSolution: evaluated.cost,
    evpi: Math.max(0, evpi),
    vss: Number.isFinite(evaluated.cost) ? Math.max(0, vss) : Infinity,
    meanValue,
    waitAndSee,
    provenance,
  };
}
