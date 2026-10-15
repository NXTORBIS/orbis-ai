/**
 * Variable selection: stepwise search and best-subset search.
 *
 * THE WARNING COMES WITH THE FEATURE. Choosing which predictors to keep by
 * looking at the data and then reporting the fit of the winner as though the
 * model had been specified in advance is the most common way a regression
 * analysis misleads:
 *  - the p-values of the retained variables are far too small, because the
 *    variables were retained precisely for having small p-values;
 *  - R² is inflated, because the maximum of many R² values is biased upward;
 *  - the confidence intervals have less than their stated coverage;
 *  - the selected SET is unstable — resample the data and a different set
 *    comes back, with the instability worst exactly where predictors are
 *    correlated.
 * This module performs the search because people need it, and returns the
 * post-selection warning attached to the result so it cannot be separated
 * from the answer. The only honest summary of a selected model's performance
 * is one computed with the selection repeated inside each resample, or on
 * genuinely held-out data.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { householderQR, qrSolve } from './qr';
import { buildDesign } from './design';
import type { Column } from './types';

export type SelectionCriterion = 'aic' | 'bic' | 'adjustedR2';

export interface SelectionStep {
  action: 'start' | 'add' | 'drop';
  variable: string | null;
  model: string[];
  criterionValue: number;
}

export interface SelectionResult {
  method: string;
  criterion: SelectionCriterion;
  selected: string[];
  criterionValue: number;
  steps: SelectionStep[];
  /** Every subset evaluated, for best-subset search (best per size). */
  bestBySize?: { size: number; variables: string[]; criterionValue: number; rSquared: number }[];
  modelsEvaluated: number;
  warnings: string[];
  limitations: string[];
}

const POST_SELECTION_WARNING =
  'Post-selection inference: these variables were chosen by looking at this data, so the p-values, confidence intervals and R² of the selected model are not valid. The p-values are too small (the variables were kept for having small ones), R² is biased upward (it is the maximum over many models), and the intervals cover the truth less often than their stated level. Report the selected model as a description, or validate it on data that played no part in the selection — including no part in choosing the number of variables.';

const SELECTION_LIMITATIONS = [
  POST_SELECTION_WARNING,
  'Which variables survive is unstable. With correlated predictors the search picks one of a group almost arbitrarily, and a small change in the data changes the choice. A variable being dropped is not evidence that it is unrelated to the response.',
  'Stepwise search explores a tiny part of the model space and can easily miss the best subset; best-subset search finds it but overfits harder for exactly that reason.',
  'AIC and BIC answer different questions. AIC targets predictive accuracy, BIC targets identifying a true model and penalises size more heavily, so they frequently disagree. Neither is a test.',
  'Selecting variables does not make the remaining coefficients causal, and dropping a confounder because its p-value was large reintroduces the bias it was there to remove.',
];

interface Scored {
  criterionValue: number;
  rSquared: number;
}

function scoreModel(
  y: readonly number[],
  columns: readonly number[][],
  criterion: SelectionCriterion,
): Scored {
  const n = y.length;
  const X = y.map((_, i) => [1, ...columns.map((c) => c[i])]);
  const p = X[0].length;
  if (n <= p) throw new EngineError(`A candidate model with ${p} coefficients cannot be fitted to ${n} observations.`, 'insufficient');
  const qr = householderQR(X);
  if (qr.rank < qr.p) return { criterionValue: Infinity, rSquared: Number.NaN };
  const beta = qrSolve(qr, y);
  const fitted = X.map((row) => stableSum(row.map((v, j) => v * beta[j])));
  const rss = stableSum(y.map((v, i) => (v - fitted[i]) ** 2));
  const ybar = stableSum(y) / n;
  const tss = stableSum(y.map((v) => (v - ybar) ** 2));
  const r2 = tss > 0 ? 1 - rss / tss : Number.NaN;
  if (criterion === 'adjustedR2') {
    const adj = 1 - (rss / (n - p)) / (tss / (n - 1));
    // Negated so that every criterion is minimised.
    return { criterionValue: -adj, rSquared: r2 };
  }
  const sigma2 = rss / n;
  const logLik = sigma2 > 0 ? -0.5 * n * (Math.log(2 * Math.PI) + Math.log(sigma2) + 1) : Infinity;
  const k = p + 1;
  const value = criterion === 'aic' ? -2 * logLik + 2 * k : -2 * logLik + Math.log(n) * k;
  return { criterionValue: value, rSquared: r2 };
}

export interface SelectionSpec {
  y: readonly (number | null | undefined)[];
  candidates: readonly Column[];
  criterion?: SelectionCriterion;
  /** 'forward', 'backward' or 'both' (default 'both'). */
  direction?: 'forward' | 'backward' | 'both';
}

/** Stepwise selection on AIC (default), BIC or adjusted R². The intercept always stays. */
export function stepwiseSelection(spec: SelectionSpec): SelectionResult {
  const criterion = spec.criterion ?? 'aic';
  const direction = spec.direction ?? 'both';
  const design = buildDesign({ y: spec.y, predictors: spec.candidates, intercept: true });
  const y = design.y;
  const names = spec.candidates.map((c) => c.name);
  const cols = names.map((_, j) => design.X.map((row) => row[j + 1]));
  let current: number[] = direction === 'backward' || direction === 'both' ? names.map((_, j) => j) : [];
  if (direction === 'both') current = [];
  let best = scoreModel(y, current.map((j) => cols[j]), criterion);
  const steps: SelectionStep[] = [{ action: 'start', variable: null, model: current.map((j) => names[j]), criterionValue: best.criterionValue }];
  let evaluated = 1;
  for (let pass = 0; pass < names.length * 2 + 2; pass++) {
    let bestAction: SelectionStep | null = null;
    let bestScore = best;
    if (direction !== 'backward') {
      for (let j = 0; j < names.length; j++) {
        if (current.includes(j)) continue;
        const trial = [...current, j];
        const s = scoreModel(y, trial.map((k) => cols[k]), criterion);
        evaluated++;
        if (s.criterionValue < bestScore.criterionValue - 1e-12) {
          bestScore = s;
          bestAction = { action: 'add', variable: names[j], model: trial.map((k) => names[k]), criterionValue: s.criterionValue };
        }
      }
    }
    if (direction !== 'forward') {
      for (const j of current) {
        const trial = current.filter((k) => k !== j);
        const s = scoreModel(y, trial.map((k) => cols[k]), criterion);
        evaluated++;
        if (s.criterionValue < bestScore.criterionValue - 1e-12) {
          bestScore = s;
          bestAction = { action: 'drop', variable: names[j], model: trial.map((k) => names[k]), criterionValue: s.criterionValue };
        }
      }
    }
    if (!bestAction) break;
    steps.push(bestAction);
    best = bestScore;
    current = bestAction.action === 'add' ? [...current, names.indexOf(bestAction.variable as string)] : current.filter((k) => names[k] !== bestAction?.variable);
  }
  const warnings = [...design.warnings, POST_SELECTION_WARNING];
  if (current.length === 0) warnings.push('No predictor improved the criterion: the selected model is the intercept alone.');
  return {
    method: `Stepwise selection (${direction}) on ${criterion === 'adjustedR2' ? 'adjusted R²' : criterion.toUpperCase()}`,
    criterion,
    selected: current.map((j) => names[j]),
    criterionValue: criterion === 'adjustedR2' ? -best.criterionValue : best.criterionValue,
    steps,
    modelsEvaluated: evaluated,
    warnings,
    limitations: SELECTION_LIMITATIONS,
  };
}

/** Exhaustive best-subset search. Refused beyond 15 candidates (32 768 models). */
export function bestSubsetSelection(spec: SelectionSpec): SelectionResult {
  const criterion = spec.criterion ?? 'aic';
  const design = buildDesign({ y: spec.y, predictors: spec.candidates, intercept: true });
  const names = spec.candidates.map((c) => c.name);
  if (names.length > 15) {
    throw new EngineError(
      `Best-subset search over ${names.length} candidates means 2^${names.length} = ${Math.pow(2, names.length).toLocaleString('en-US')} models, which is refused here. Use stepwise selection or the lasso — and note that searching more models makes the post-selection bias worse, not better.`,
      'range',
    );
  }
  const y = design.y;
  const cols = names.map((_, j) => design.X.map((row) => row[j + 1]));
  const total = 1 << names.length;
  let bestMask = 0;
  let bestScore: Scored = scoreModel(y, [], criterion);
  const bestBySizeMap = new Map<number, { size: number; variables: string[]; criterionValue: number; rSquared: number }>();
  let evaluated = 0;
  for (let mask = 0; mask < total; mask++) {
    const chosen: number[] = [];
    for (let j = 0; j < names.length; j++) if (mask & (1 << j)) chosen.push(j);
    if (y.length <= chosen.length + 1) continue;
    const s = scoreModel(y, chosen.map((j) => cols[j]), criterion);
    evaluated++;
    if (s.criterionValue < bestScore.criterionValue - 1e-12) {
      bestScore = s;
      bestMask = mask;
    }
    const existing = bestBySizeMap.get(chosen.length);
    if (!existing || s.criterionValue < existing.criterionValue) {
      bestBySizeMap.set(chosen.length, {
        size: chosen.length,
        variables: chosen.map((j) => names[j]),
        criterionValue: criterion === 'adjustedR2' ? -s.criterionValue : s.criterionValue,
        rSquared: s.rSquared,
      });
    }
  }
  const selected: string[] = [];
  for (let j = 0; j < names.length; j++) if (bestMask & (1 << j)) selected.push(names[j]);
  return {
    method: `Best-subset selection on ${criterion === 'adjustedR2' ? 'adjusted R²' : criterion.toUpperCase()}`,
    criterion,
    selected,
    criterionValue: criterion === 'adjustedR2' ? -bestScore.criterionValue : bestScore.criterionValue,
    steps: [{ action: 'start', variable: null, model: selected, criterionValue: bestScore.criterionValue }],
    bestBySize: [...bestBySizeMap.values()].sort((a, b) => a.size - b.size),
    modelsEvaluated: evaluated,
    warnings: [
      ...design.warnings,
      POST_SELECTION_WARNING,
      `${evaluated} models were compared. The best R² at each size is reported so the curve can be inspected; R² never decreases as variables are added, so comparing sizes by R² alone always selects every variable.`,
    ],
    limitations: SELECTION_LIMITATIONS,
  };
}
