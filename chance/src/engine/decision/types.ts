/**
 * Shared types for decision analysis under uncertainty.
 *
 * Provenance convention
 * ---------------------
 * Every probability in a decision tree or a payoff matrix is supplied by the
 * user. The arithmetic performed on it here is exact, but the input is an
 * assumption, so results carry both labels: the method is `exact`, while the
 * `assumedInputs` list names the inputs the conclusion rests on. A result that
 * needs no probabilities at all (the maximin / regret family) says so
 * explicitly through its `regime` field, because the choice of criterion there
 * is a value judgement and not a computation.
 */
import type { Exactness } from '../core/result';

/** Which information regime a recommendation was produced in. */
export type DecisionRegime =
  /** Probabilities for every state of nature were supplied. */
  | 'probabilities-given'
  /** No probabilities are claimed; a non-probabilistic criterion was applied. */
  | 'no-probabilities';

export interface Provenance {
  exactness: Exactness;
  /** Inputs the conclusion rests on that are user assumptions, not facts. */
  assumedInputs: string[];
  regime: DecisionRegime;
}

/** A discrete outcome distribution: the risk profile of a strategy. */
export interface OutcomePoint {
  payoff: number;
  probability: number;
}

export interface Lottery {
  label?: string;
  outcomes: OutcomePoint[];
}

/* ------------------------------------------------------------------ trees */

export interface ChanceBranch {
  label: string;
  /** P(this branch | reaching the chance node). The branches must sum to 1. */
  probability: number;
  /** Cash flow received on taking this branch, added to the path total. */
  payoff?: number;
  child: TreeNode;
}

export interface Alternative {
  label: string;
  /** Cost (negative) or receipt (positive) of choosing this alternative. */
  payoff?: number;
  child: TreeNode;
}

export interface TerminalNode {
  kind: 'terminal';
  id: string;
  label?: string;
  /** Final cash flow at the leaf, added to the path total. */
  payoff: number;
}

export interface ChanceNode {
  kind: 'chance';
  id: string;
  label?: string;
  branches: ChanceBranch[];
}

export interface DecisionPoint {
  kind: 'decision';
  id: string;
  label?: string;
  alternatives: Alternative[];
}

export type TreeNode = TerminalNode | ChanceNode | DecisionPoint;

export interface DecisionTree {
  id: string;
  name: string;
  /** Unit of the payoffs, e.g. "$m". Display only. */
  unit?: string;
  root: TreeNode;
}

/* --------------------------------------------------- payoff matrix problem */

/**
 * A decision problem in normal form: one payoff per (action, state) pair.
 * `priors` is optional — without it only the no-probability criteria apply.
 */
export interface DecisionProblem {
  id?: string;
  name?: string;
  actions: string[];
  states: string[];
  /** payoffs[action][state]; higher is better. */
  payoffs: number[][];
  /** P(state), summing to 1. Omit when probabilities are genuinely unknown. */
  priors?: number[];
  unit?: string;
}
