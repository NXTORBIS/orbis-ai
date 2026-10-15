/**
 * Model selection across the distribution registry.
 *
 * Every compatible distribution is fitted and ranked by AIC, with AICc and
 * BIC alongside. Incompatible families are SKIPPED WITH A STATED REASON rather
 * than fitted to nonsense: a discrete family is not fitted to fractional data,
 * and a family whose support cannot contain the data is not fitted at all.
 *
 * What the ranking is not:
 *  - it is a comparison among the distributions implemented here, not a search
 *    over all distributions;
 *  - a small AIC gap is not a preference (the convention is that a difference
 *    under about 2 is no evidence);
 *  - the best-ranked distribution can still be a poor fit in absolute terms.
 *    That is what the goodness-of-fit results are for.
 */
import { EngineError } from '../core/result';
import { DISTRIBUTIONS, getDistribution } from '../distributions/registry';
import type { Params } from '../distributions/types';
import { fitDistribution, type FitOptions } from './mle';
import type { FitResult, SkipReason } from './types';

export interface RankedFit {
  fit: FitResult;
  rank: number;
  deltaAic: number;
  /** exp(−Δ/2) normalised over the candidates: a relative, not absolute, weight. */
  akaikeWeight: number;
  /** Evidence ratio against the best candidate. */
  evidenceRatio: number;
  deltaBic: number;
}

export interface SelectionResult {
  ranked: RankedFit[];
  skipped: SkipReason[];
  n: number;
  /** Statements that must be displayed with the ranking. */
  statements: string[];
}

export interface SelectionOptions extends FitOptions {
  /** Restrict the candidate set; defaults to every distribution in the registry. */
  ids?: string[];
  /** Per-distribution fixed parameters (e.g. { binomial: { n: 20 } }). */
  fixedById?: Record<string, Params>;
}

export function selectDistribution(data: ArrayLike<number>, options: SelectionOptions = {}): SelectionResult {
  const candidates = options.ids ? options.ids.map(getDistribution) : DISTRIBUTIONS;
  if (!candidates.length) throw new EngineError('No candidate distributions were supplied.', 'empty');
  const fits: FitResult[] = [];
  const skipped: SkipReason[] = [];
  for (const def of candidates) {
    const fixed = options.fixedById?.[def.id] ?? options.fixed;
    try {
      fits.push(fitDistribution(def, data, { ...options, fixed }));
    } catch (e) {
      skipped.push({
        distributionId: def.id,
        distributionName: def.name,
        reason: e instanceof EngineError ? e.message : String(e),
      });
    }
  }
  if (!fits.length) {
    throw new EngineError(
      `None of the ${candidates.length} candidate distributions could be fitted to this data. Reasons: ${skipped.map((s) => `${s.distributionName}: ${s.reason}`).join(' | ')}`,
      'numerical',
    );
  }
  const sorted = [...fits].sort((a, b) => a.aic - b.aic);
  const bestAic = sorted[0].aic;
  const bestBic = Math.min(...fits.map((f) => f.bic));
  const weights = sorted.map((f) => Math.exp(-(f.aic - bestAic) / 2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const ranked: RankedFit[] = sorted.map((fit, i) => ({
    fit,
    rank: i + 1,
    deltaAic: fit.aic - bestAic,
    akaikeWeight: weights[i] / wsum,
    evidenceRatio: weights[0] / weights[i],
    deltaBic: fit.bic - bestBic,
  }));
  const n = sorted[0].n;
  const gap = ranked.length > 1 ? ranked[1].deltaAic : Infinity;
  const bestByBic = [...fits].sort((a, b) => a.bic - b.bic)[0];
  const statements = [
    `${fits.length} distribution(s) were fitted and ${skipped.length} skipped. The ranking is only among the distributions implemented here; the true data-generating process need not be any of them.`,
    gap < 2
      ? `The top two candidates differ by only ${gap.toPrecision(3)} AIC units. By the usual convention (Δ < 2) that is not a meaningful preference: treat ${ranked[0].fit.distributionName} and ${ranked[1].fit.distributionName} as indistinguishable on this data.`
      : `The best candidate leads the next by ${gap.toPrecision(3)} AIC units.`,
    bestByBic.distributionId !== ranked[0].fit.distributionId
      ? `AIC and BIC disagree: AIC prefers ${ranked[0].fit.distributionName}, BIC prefers ${bestByBic.distributionName}. BIC penalises parameters more heavily (ln n per parameter against 2), so the disagreement is about how much complexity the sample size justifies, not about which fits better.`
      : 'AIC and BIC agree on the leading candidate.',
    'AIC is relative: it cannot say whether the leading distribution fits well in absolute terms. Read the goodness-of-fit results and the Q–Q plot before using it.',
    'Akaike weights are relative likelihoods within this candidate set and would change if another distribution were added to it.',
    `AICc is reported alongside AIC; with n = ${n} and few parameters the two are close, but AICc should be preferred when n/k is small (under about 40).`,
  ];
  return { ranked, skipped, n, statements };
}
