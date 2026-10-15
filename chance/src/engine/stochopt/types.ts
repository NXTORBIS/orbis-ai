/**
 * Shared types for optimisation under uncertainty.
 *
 * Status honesty
 * --------------
 * Every solve in this module reports a `SolveStatus`. The characteristic
 * dishonesty of this field is returning a feasible point as though it were
 * optimal, so `'feasible-with-gap'` is a first-class status that carries the
 * remaining optimality gap, and no caller can read the objective without also
 * seeing it.
 */
import type { Exactness } from '../core/result';

export interface Provenance {
  exactness: Exactness;
  method: string;
  /** Inputs the conclusion rests on that are assumptions, not facts. */
  assumedInputs: string[];
  limitations: string[];
}

/** How a solve ended. Never hidden behind an objective value. */
export type SolveStatus = 'optimal' | 'feasible-with-gap' | 'infeasible' | 'unbounded';

export type RowSense = '<=' | '>=' | '=';

/** One linear constraint: coef · x  sense  rhs. */
export interface LpRow {
  coef: number[];
  sense: RowSense;
  rhs: number;
  name?: string;
}

/**
 * A linear program. Variables default to the non-negative orthant; `lower` may
 * contain -Infinity (free below) and `upper` may contain Infinity.
 */
export interface LpProblem {
  sense: 'min' | 'max';
  objective: number[];
  rows: LpRow[];
  lower?: number[];
  upper?: number[];
  names?: string[];
  /** Constant added to the objective, carried through reformulations. */
  constant?: number;
}

export interface InfeasibilityWitness {
  row: number;
  name: string;
  /** How much the least-violating point misses this row by. */
  violation: number;
}

export interface LpSolution {
  status: SolveStatus;
  /** Decision vector in the ORIGINAL variable space. Empty if not optimal. */
  x: number[];
  objective: number;
  iterations: number;
  /** Pivot tolerance of the underlying simplex, stated rather than implied. */
  tolerance: number;
  /** Present only when the program is infeasible: which rows, and by how much. */
  witnesses?: InfeasibilityWitness[];
}

/* ------------------------------------------------- two-stage recourse */

/**
 * One realisation of the uncertainty. The row list must have the same length
 * and senses in every scenario of a problem: the technology matrix T, the
 * recourse matrix W and the right-hand side h may all vary with the scenario,
 * but the problem's shape may not.
 */
export interface ScenarioRow {
  /** Coefficients on the first-stage variables (T). */
  T: number[];
  /** Coefficients on the second-stage variables (W). */
  W: number[];
  sense: RowSense;
  /** Right-hand side (h). */
  rhs: number;
  name?: string;
}

export interface Scenario {
  name: string;
  probability: number;
  rows: ScenarioRow[];
}

/**
 * min  cᵀx + E[ min qᵀy : T(ω)x + W(ω)y ~ h(ω) ]
 * s.t. first-stage rows on x, bounds on x and y.
 */
export interface TwoStageProblem {
  name: string;
  /** First-stage cost, minimised. */
  c: number[];
  firstStageRows: LpRow[];
  lower?: number[];
  upper?: number[];
  firstStageNames?: string[];
  /** Second-stage (recourse) cost, minimised. */
  q: number[];
  yLower?: number[];
  yUpper?: number[];
  secondStageNames?: string[];
  scenarios: Scenario[];
}

export interface CutReport {
  optimalityCuts: number;
  feasibilityCuts: number;
  iterations: number;
  /** Upper bound minus lower bound at termination, in objective units. */
  gap: number;
  relativeGap: number;
  lowerBound: number;
  upperBound: number;
}

export interface TwoStageSolution {
  status: SolveStatus;
  route: 'deterministic-equivalent' | 'l-shaped';
  /** First-stage decision. */
  x: number[];
  /** Total expected cost: first stage plus expected recourse. */
  objective: number;
  firstStageCost: number;
  expectedRecourseCost: number;
  /** Optimal recourse per scenario, in scenario order. */
  recourse: { scenario: string; probability: number; y: number[]; cost: number }[];
  /** Absolute optimality gap. Exactly 0 for the extensive form solved to optimality. */
  gap: number;
  cuts?: CutReport;
  provenance: Provenance;
}

export interface MeanValueReport {
  /** The mean-scenario ("just use the average") first-stage decision. */
  x: number[];
  /** Objective of the mean-value problem itself (an optimistic number). */
  meanProblemObjective: number;
  /** Expected cost of that decision under the real distribution (EEV). */
  expectedCostOfMeanSolution: number;
  /** Scenarios in which the mean-value decision admits no feasible recourse. */
  infeasibleScenarios: { scenario: string; row: string; violation: number }[];
}

export interface StochasticDiagnostics {
  /** RP: the value of the two-stage stochastic programme. */
  recourseProblemValue: number;
  /** WS: expected value of the per-scenario perfect-foresight optima. */
  waitAndSeeValue: number;
  /** EEV: expected cost of the mean-value solution. May be Infinity. */
  expectedValueOfMeanSolution: number;
  /** EVPI = RP - WS >= 0. */
  evpi: number;
  /** VSS = EEV - RP >= 0. Infinity when the mean solution has no recourse. */
  vss: number;
  meanValue: MeanValueReport;
  waitAndSee: { scenario: string; probability: number; value: number; x: number[] }[];
  provenance: Provenance;
}
