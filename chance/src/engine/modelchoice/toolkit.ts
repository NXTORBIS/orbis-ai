/**
 * The one entry point most callers want: give it a set of models with their
 * pointwise log-likelihood draws, get back an honest comparison.
 *
 * It computes PSIS-LOO (with the Pareto k diagnostic), WAIC, the paired
 * standard errors of every difference, stacking and pseudo-BMA+ weights, and
 * a plain-language verdict that says "these cannot be separated" when that is
 * the truth. It refuses rather than ranking when the approximations it relies
 * on have failed.
 */
import type { Explanation } from '../core/result';
import { compareElpd, type ComparisonTable } from './compare';
import { psisLoo, waic, type PsisLooResult } from './waic';
import { pseudoBmaWeights, stackingWeights, type ModelWeights } from './averaging';
import { checkModelSet } from './validate';
import { AVERAGING_CAVEAT, MODEL_SET_CAVEAT, type ElpdEstimate, type ModelPointwise } from './types';

export interface ModelComparison {
  readonly loo: readonly PsisLooResult[];
  readonly waic: readonly ElpdEstimate[];
  readonly comparison: ComparisonTable;
  /** Stacking weights; null when only one model was supplied. */
  readonly stacking: ModelWeights | null;
  /** Pseudo-BMA+ weights; null when only one model was supplied. */
  readonly pseudoBma: ModelWeights | null;
  /** True when every observation of every model has an acceptable Pareto k. */
  readonly reliable: boolean;
  readonly recommendation: string;
  readonly exactness: 'empirical';
  readonly warnings: readonly string[];
  readonly explanation: Explanation;
}

/**
 * Compare a set of models from their pointwise log-likelihood draws.
 *
 * @param models one entry per model: a name and a draws × observations matrix.
 * @param options.seed required for the pseudo-BMA+ Bayesian bootstrap.
 */
export function compareModels(
  models: readonly ModelPointwise[],
  options: { readonly seed?: string; readonly bootstrapReplicates?: number } = {},
): ModelComparison {
  const shape = checkModelSet(models);
  const loo = models.map((m) => psisLoo(m.name, m.logLik));
  const waicEstimates = models.map((m) => waic(m.name, m.logLik));
  const comparison = compareElpd(loo);
  const unreliable = loo.filter((l) => !l.reliable);
  const reliable = unreliable.length === 0;
  let stacking: ModelWeights | null = null;
  let pseudo: ModelWeights | null = null;
  if (models.length > 1) {
    stacking = stackingWeights(loo);
    pseudo = pseudoBmaWeights(loo, {
      bayesianBootstrap: true,
      seed: options.seed ?? 'modelchoice-pseudo-bma',
      replicates: options.bootstrapReplicates ?? 1000,
    });
  }
  const warnings = [
    MODEL_SET_CAVEAT,
    AVERAGING_CAVEAT,
    ...new Set([...loo.flatMap((l) => l.warnings), ...waicEstimates.flatMap((w) => w.warnings)]),
  ];
  if (!reliable) {
    warnings.unshift(
      `The PSIS-LOO approximation failed for ${unreliable.map((u) => `"${u.name}" (${u.diagnostics.unreliableObservations.length} observation(s) with Pareto k > 0.7)`).join(', ')}. The ranking below rests on those unreliable terms. Refit with exact leave-one-out or k-fold cross-validation for the affected models before deciding anything.`,
    );
  }
  const recommendation = buildRecommendation(comparison, stacking, reliable, models.length);
  return {
    loo,
    waic: waicEstimates,
    comparison,
    stacking,
    pseudoBma: pseudo,
    reliable,
    recommendation,
    exactness: 'empirical',
    warnings,
    explanation: {
      method: 'Predictive model comparison (PSIS-LOO, WAIC, paired differences, stacking)',
      formula: 'elpd_loo = Σ_i log p(y_i | y_−i);  se(Δelpd) = sqrt(n · var_i(Δelpd_i))',
      steps: [
        { label: 'Models compared', value: String(models.length) },
        { label: 'Observations', value: String(shape.observations) },
        { label: 'Posterior draws', value: String(shape.draws) },
        ...comparison.explanation.steps,
        ...(stacking
          ? [
              {
                label: 'Stacking weights',
                value: stacking.names.map((n, k) => `${n} ${stacking?.weights[k].toPrecision(3) ?? ''}`).join(', '),
              },
            ]
          : []),
      ],
      assumptions: [
        'The pointwise log-likelihood matrices come from converged posterior samples of each model, for the same observations in the same order.',
        'Observations are conditionally independent given the parameters, which is what makes leave-one-out pointwise.',
      ],
      limitations: warnings,
      exactness: 'empirical',
    },
  };
}

function buildRecommendation(
  comparison: ComparisonTable,
  stacking: ModelWeights | null,
  reliable: boolean,
  count: number,
): string {
  if (count === 1) {
    return 'Only one model was supplied, so nothing was compared. A single elpd has no scale: fit at least one alternative, including a deliberately simple one, before believing this model.';
  }
  const parts: string[] = [];
  if (!reliable) {
    parts.push(
      'The leave-one-out approximation failed for at least one observation, so this ranking is not yet trustworthy; the affected observations are named in the diagnostics and need exact refitting.',
    );
  }
  parts.push(comparison.statement);
  if (comparison.verdict === 'indistinguishable') {
    parts.push(
      'Do not select one of these models. Report the set, and predict with the averaged (stacked) predictive distribution — selecting one would throw away the information that the data could not tell them apart.',
    );
  } else if (stacking) {
    const spread = stacking.weights.filter((w) => w > 0.05).length;
    parts.push(
      spread > 1
        ? `Stacking still spreads weight over ${spread} models, so even with a clear best model the mixture predicts better than the winner alone.`
        : 'Stacking agrees with the ranking and puts essentially all weight on the leading model.',
    );
  }
  parts.push(AVERAGING_CAVEAT);
  parts.push(MODEL_SET_CAVEAT);
  return parts.join(' ');
}
