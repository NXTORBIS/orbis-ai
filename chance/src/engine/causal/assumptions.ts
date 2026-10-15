/**
 * The identification assumptions, written out once and attached to results.
 *
 * This file is the honest core of the module. A causal estimate without its
 * assumptions is worse than no estimate, because it looks like knowledge.
 */

import type { AssumptionStatement, EstimandDescription, Estimand } from './types.ts';

export const FUNDAMENTAL_PROBLEM =
  'Fundamental problem of causal inference: each unit has two potential outcomes, Y(1) and Y(0), ' +
  'but only the one matching the treatment it actually received is ever observed. The other is missing for ' +
  'every unit, in every data set, permanently. No estimate here observes a counterfactual; each one ' +
  'substitutes other units for the missing half and relies on assumptions to justify that substitution.';

export const UNTESTABILITY =
  'The identifying assumptions listed above cannot be tested from these data — not one of them. Balance, overlap and ' +
  'pre-trend checks test implications of the design, not identification: a model can pass every diagnostic ' +
  'and still be confounded by something that was never measured. Treat the estimate as conditional on the ' +
  'assumptions, and read the sensitivity analysis to see how strong a violation would overturn it.';

export const CONSISTENCY: AssumptionStatement = {
  name: 'Consistency',
  statement:
    'The outcome observed under the treatment a unit received equals that unit\'s potential outcome for that ' +
    'treatment: Y = T·Y(1) + (1−T)·Y(0). This requires the treatment to be a single well-defined intervention, ' +
    'not a label covering several different versions.',
  testable: false,
  ifViolated:
    'The estimate refers to an average over an undefined mixture of interventions, so it does not predict the ' +
    'effect of any particular one.',
};

export const SUTVA: AssumptionStatement = {
  name: 'SUTVA / no interference',
  statement:
    'One unit\'s treatment does not change another unit\'s outcome. No spillovers, no contagion, no general ' +
    'equilibrium response, no competition for a fixed resource.',
  testable: false,
  ifViolated:
    'Potential outcomes are not even well defined as written, and the estimate conflates the direct effect with ' +
    'the effect of other units\' treatment.',
};

export const POSITIVITY: AssumptionStatement = {
  name: 'Positivity / overlap',
  statement:
    'Every unit has a probability strictly between 0 and 1 of receiving each treatment given its covariates: ' +
    '0 < P(T=1 | X) < 1. Only this part has an observable shadow — the propensity-score overlap and common-support ' +
    'diagnostics below bear on it.',
  testable: false,
  ifViolated:
    'For covariate values where one arm is empty, the contrast is extrapolated from the model rather than ' +
    'estimated. Weights explode and the estimate is driven by a handful of units.',
};

export const IGNORABILITY: AssumptionStatement = {
  name: 'Conditional ignorability / no unmeasured confounding',
  statement:
    'Given the measured covariates X, treatment is independent of the potential outcomes: ' +
    '{Y(1), Y(0)} ⫫ T | X. Every common cause of treatment and outcome is in X, measured without error.',
  testable: false,
  ifViolated:
    'The estimate is biased by whatever was left out, in an unknown direction and by an unknown amount. This is ' +
    'the assumption that fails in practice, and nothing in the data can warn you.',
};

export const CORRECT_PS_MODEL: AssumptionStatement = {
  name: 'Correct propensity model',
  statement: 'The logistic model for P(T=1 | X) is correctly specified (functional form and included terms).',
  testable: false,
  ifViolated: 'Weights and matches are wrong even when every confounder was measured.',
};

export const CORRECT_OUTCOME_MODEL: AssumptionStatement = {
  name: 'Correct outcome model',
  statement: 'The regression of Y on T and X is correctly specified, including its functional form.',
  testable: false,
  ifViolated: 'Standardisation extrapolates with the wrong curve and the estimate is biased.',
};

export const DOUBLE_ROBUSTNESS: AssumptionStatement = {
  name: 'One of the two models correct (double robustness)',
  statement:
    'The estimator is consistent if EITHER the propensity model OR the outcome model is correctly specified; ' +
    'it does not require both. It still requires ignorability, positivity, consistency and SUTVA.',
  testable: false,
  ifViolated: 'If both models are wrong, the estimate is biased like any other.',
};

export const IV_RELEVANCE: AssumptionStatement = {
  name: 'Instrument relevance',
  statement: 'The instrument moves the treatment: the first-stage coefficient is non-zero.',
  testable: true,
  ifViolated: 'The estimator has no identifying variation; its ratio has a near-zero denominator and is unstable.',
};

export const IV_EXCLUSION: AssumptionStatement = {
  name: 'Exclusion restriction',
  statement:
    'The instrument affects the outcome only through the treatment. It has no direct effect and no effect via ' +
    'any other channel.',
  testable: false,
  ifViolated:
    'The ratio attributes the instrument\'s direct effect to the treatment, scaled up by one over the first stage — ' +
    'so a small violation becomes a large bias when the instrument is weak.',
};

export const IV_INDEPENDENCE: AssumptionStatement = {
  name: 'Instrument independence / ignorability',
  statement: 'The instrument is independent of the unmeasured confounders (as good as randomly assigned).',
  testable: false,
  ifViolated: 'The instrument is itself confounded and 2SLS inherits the bias it was meant to remove.',
};

export const IV_MONOTONICITY: AssumptionStatement = {
  name: 'Monotonicity / no defiers',
  statement:
    'No unit is moved in the opposite direction by the instrument: there are no units that take the treatment ' +
    'only when the instrument says not to.',
  testable: false,
  ifViolated: 'The Wald ratio is a weighted difference of compliers\' and defiers\' effects and need not lie ' +
    'between any unit\'s effects.',
};

export const PARALLEL_TRENDS: AssumptionStatement = {
  name: 'Parallel trends',
  statement:
    'Absent the treatment, the treated and control groups\' average outcomes would have moved by the same amount ' +
    'over the same period. This is a statement about an unobserved counterfactual path, not about the pre-period.',
  testable: false,
  ifViolated:
    'The estimate equals the true effect plus the difference in counterfactual trends. Flat pre-trends make the ' +
    'assumption more plausible; they do not establish it, and parallel pre-trends are compatible with ' +
    'non-parallel post-trends.',
};

export const NO_ANTICIPATION: AssumptionStatement = {
  name: 'No anticipation',
  statement: 'Units do not change behaviour before treatment starts in response to expecting it.',
  testable: false,
  ifViolated: 'Pre-period outcomes are already affected, so the baseline is contaminated and the effect understated.',
};

export const RDD_CONTINUITY: AssumptionStatement = {
  name: 'Continuity of potential outcomes at the cutoff',
  statement:
    'Both conditional potential-outcome means E[Y(1)|X=x] and E[Y(0)|X=x] are continuous in the running variable ' +
    'at the cutoff, so the jump in observed outcomes is the treatment effect and not a jump in the units.',
  testable: false,
  ifViolated: 'The discontinuity reflects something else that changes at the cutoff, not the treatment.',
};

export const RDD_NO_MANIPULATION: AssumptionStatement = {
  name: 'No manipulation of the running variable',
  statement: 'Units cannot precisely control which side of the cutoff they land on.',
  testable: false,
  ifViolated:
    'Units near the cutoff are self-selected and the two sides differ for reasons other than treatment. The ' +
    'McCrary density test below is a partial check: it detects sorting that shows up as a density jump, and ' +
    'nothing else.',
};

export const SC_FIT: AssumptionStatement = {
  name: 'The synthetic control reproduces the counterfactual',
  statement:
    'A fixed convex combination of untreated units that tracks the treated unit before the intervention would ' +
    'have continued to track it afterwards, absent the intervention.',
  testable: false,
  ifViolated: 'The gap is a forecast error rather than a treatment effect. Pre-period fit bounds how plausible ' +
    'this is; it does not verify it.',
};

export const SC_NO_SPILLOVER: AssumptionStatement = {
  name: 'No treatment spillover to donors',
  statement: 'None of the donor units was affected by the treated unit\'s intervention.',
  testable: false,
  ifViolated: 'The counterfactual itself moves with the treatment and the gap shrinks towards zero.',
};

export const ITS_COUNTERFACTUAL: AssumptionStatement = {
  name: 'The pre-intervention trend would have continued',
  statement:
    'Without the intervention, the series would have followed its fitted pre-intervention level and slope.',
  testable: false,
  ifViolated:
    'The estimate is the sum of the treatment effect and whatever else changed at the same time. With a single ' +
    'series there is no control group to difference that away.',
};

export const PC_SUFFICIENCY: AssumptionStatement = {
  name: 'Causal sufficiency',
  statement: 'There is no unmeasured common cause of any two measured variables.',
  testable: false,
  ifViolated:
    'Latent confounding appears as a spurious edge or a wrongly oriented one. The output graph is then not an ' +
    'equivalence class containing the truth.',
};

export const PC_FAITHFULNESS: AssumptionStatement = {
  name: 'Faithfulness',
  statement:
    'Every conditional independence in the distribution is implied by the graph structure — no exact ' +
    'cancellation of paths produces an independence the graph does not entail.',
  testable: false,
  ifViolated: 'A real edge is removed because two paths happened to cancel.',
};

export const PC_MARKOV: AssumptionStatement = {
  name: 'Causal Markov condition and i.i.d. sampling',
  statement: 'Each variable is independent of its non-descendants given its parents, and rows are i.i.d.',
  testable: false,
  ifViolated: 'The independence tests do not map onto graph separation and the search is unfounded.',
};

export const PC_EQUIVALENCE_ONLY: AssumptionStatement = {
  name: 'Only an equivalence class is recoverable',
  statement:
    'Observational data identify a DAG only up to its Markov equivalence class. Undirected edges in the returned ' +
    'CPDAG are orientations the data CANNOT distinguish — not weak evidence, no evidence. Picking one is guessing.',
  testable: false,
  ifViolated: 'Not an assumption that can fail: it is a limit on what the data contain.',
};

/** The four core assumptions every adjustment-based estimator needs. */
export const CORE_ADJUSTMENT: AssumptionStatement[] = [CONSISTENCY, SUTVA, POSITIVITY, IGNORABILITY];

const CONTRASTS: Record<Estimand, { contrast: string; population: string }> = {
  ATE: { contrast: 'E[Y(1) − Y(0)]', population: 'the whole sample as observed' },
  ATT: { contrast: 'E[Y(1) − Y(0) | T=1]', population: 'the treated units only' },
  ATC: { contrast: 'E[Y(1) − Y(0) | T=0]', population: 'the untreated units only' },
  CATE: { contrast: 'E[Y(1) − Y(0) | X in the stated stratum]', population: 'the stated covariate stratum only' },
  LATE: {
    contrast: 'E[Y(1) − Y(0) | compliers]',
    population:
      'compliers only — the units whose treatment status the instrument actually changes. This is NOT the ATE ' +
      'and NOT the ATT, and the complier subgroup cannot be identified at the individual level.',
  },
  'ATE-trimmed': {
    contrast: 'E[Y(1) − Y(0) | X in the retained propensity range]',
    population:
      'ONLY the units retained after trimming. Trimming changed the estimand: this is no longer the ATE for the ' +
      'original sample but the ATE for the overlap subpopulation, which is a different question.',
  },
  'ATT-matched': {
    contrast: 'E[Y(1) − Y(0) | T=1 and a match was found]',
    population:
      'the matched treated units only. Treated units left unmatched are excluded, so the population is narrower ' +
      'than the treated group.',
  },
  'ATE-overlap': {
    contrast: 'weighted E[Y(1) − Y(0)] with overlap weights e(X)(1−e(X))',
    population: 'an overlap-weighted population that upweights units with propensity near 0.5',
  },
  'local-at-cutoff': {
    contrast: 'E[Y(1) − Y(0) | X = cutoff]',
    population:
      'units at the cutoff only. It says nothing about units far from the cutoff, and nothing about what a large ' +
      'change in the running variable would do.',
  },
  'ATT-event-time': {
    contrast: 'E[Y(1) − Y(0) | T=1, at the stated event time]',
    population: 'treated units at the stated time relative to adoption',
  },
};

export function describeEstimand(kind: Estimand, extra?: string): EstimandDescription {
  const c = CONTRASTS[kind];
  return {
    kind,
    contrast: c.contrast,
    targetPopulation: extra ? `${c.population} ${extra}` : c.population,
  };
}
