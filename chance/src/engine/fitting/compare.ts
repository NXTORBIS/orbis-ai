/**
 * Maximum likelihood against method of moments.
 *
 * Both estimate the same parameters from the same data by different routes.
 * They agree closely when the family is right and the sample is large. A large
 * disagreement is information: usually the family is wrong, or a handful of
 * extreme observations is dominating the sample moments.
 */
import { EngineError } from '../core/result';
import type { DistributionDef } from '../distributions/types';
import { fitDistribution, logLikelihood, prepareData, type FitOptions } from './mle';
import { momentEstimates, type MomentFit } from './moments';
import type { FitResult } from './types';

export interface EstimatorComparison {
  mle: FitResult;
  moments: MomentFit | null;
  momentsLogLikelihood: number | null;
  /** Per-parameter absolute and standard-error-scaled differences. */
  differences: { key: string; mle: number; moments: number; absolute: number; inStandardErrors: number | null }[];
  /** True when any parameter differs by more than 2 standard errors. */
  materialDisagreement: boolean;
  statements: string[];
  momentsUnavailableReason?: string;
}

export function compareMleAndMoments(def: DistributionDef, data: ArrayLike<number>, options: FitOptions = {}): EstimatorComparison {
  const mle = fitDistribution(def, data, options);
  const used = prepareData(def, data).used;
  let moments: MomentFit | null = null;
  let reason: string | undefined;
  try {
    moments = momentEstimates(def, used, options.fixed ?? {});
    if (!moments) reason = 'The moment equations have no solution for this family and data (too few finite moments, or no admissible solution).';
  } catch (e) {
    if (!(e instanceof EngineError)) throw e;
    reason = e.message;
  }
  if (!moments) {
    return {
      mle,
      moments: null,
      momentsLogLikelihood: null,
      differences: [],
      materialDisagreement: false,
      momentsUnavailableReason: reason,
      statements: [
        `Method of moments is unavailable here, so maximum likelihood has no independent cross-check: ${reason}`,
      ],
    };
  }
  const ll = logLikelihood(def, moments.params, used);
  const differences = def.params
    .filter((s) => !(s.key in mle.fixedParams))
    .map((s) => {
      const se = mle.uncertainty.find((u) => u.key === s.key)?.standardError ?? null;
      const absolute = moments.params[s.key] - mle.params[s.key];
      return {
        key: s.key,
        mle: mle.params[s.key],
        moments: moments.params[s.key],
        absolute,
        inStandardErrors: se ? absolute / se : null,
      };
    });
  const material = differences.some((d) => d.inStandardErrors !== null && Math.abs(d.inStandardErrors) > 2);
  const statements = [
    `Method of moments (${moments.formula}) matched ${moments.matched.join(' and ')}.`,
    Number.isFinite(ll)
      ? `The moment estimates give log-likelihood ${ll.toPrecision(8)} against ${mle.logLikelihood.toPrecision(8)} for maximum likelihood — the MLE is by construction at least as high.`
      : 'The moment estimates give an infinite negative log-likelihood: they place some observations where the distribution has no probability, which is a clear sign the family or the moments are being strained.',
    material
      ? 'The two estimators disagree by more than 2 standard errors on at least one parameter. That is a warning about the FAMILY, not about the arithmetic: either the distribution is the wrong shape, or a few extreme observations are dominating the sample moments. Check the Q–Q plot and the Anderson–Darling statistic before using either fit.'
      : 'The two estimators agree to within about 2 standard errors, which is what is expected when the family is appropriate.',
    'Maximum likelihood is the more efficient estimator when the family is correct, so it is the one to report; method of moments is here as an independent check.',
  ];
  return { mle, moments, momentsLogLikelihood: Number.isFinite(ll) ? ll : null, differences, materialDisagreement: material, statements };
}
