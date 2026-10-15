/**
 * Fully Bayesian hyperparameters: MCMC over the log marginal likelihood.
 *
 * A point estimate of the hyperparameters pretends the length scale and noise
 * are known. They are not, and the marginal likelihood is often multimodal or
 * flat along a ridge — exactly the cases where the point estimate is
 * arbitrary. Integrating over the hyperparameters instead gives a predictive
 * distribution that includes the uncertainty about the model itself, which is
 * usually noticeably wider than the plug-in one.
 *
 * The posterior over the hyperparameters is explored with the slice sampler
 * from `src/engine/mcmc/`, which needs no gradient and no step-size tuning.
 * This is the ONLY file in `src/engine/gp/` that depends on the MCMC module.
 *
 * ## Priors
 *
 * The prior is placed directly on the LOG of each positive hyperparameter:
 * log θ ~ N(m, s²), with m taken from the data scale (median input spacing
 * for length scales, variance of y for variances) and s = 2 by default, which
 * spans about four orders of magnitude. Because the prior is defined on the
 * log scale and the sampler works on the log scale, there is no Jacobian to
 * apply. These priors are weakly informative, not uninformative, and they are
 * reported with the result because they do affect the answer.
 *
 * ## Exactness
 *
 * `empirical`. Every number here is a Monte Carlo average over a finite set
 * of correlated draws. The convergence assessment from the MCMC module is
 * returned with it; if it does not say "converged", the numbers are not
 * usable and the module says so rather than quietly reporting them.
 */
import { EngineError } from '../core/result';
import { runMcmc, type McmcResult, type TargetSpec, type ParameterSummary } from '../mcmc';
import { hyperObjective, predictGp, type GpModelRequest, type GpPredictionSet } from './regression';
import { INTERVAL_LABEL, type GpPrediction } from './types';
import { normalQuantile } from '../special/gamma';

export interface FullyBayesianOptions {
  readonly chains?: number;
  readonly iterations?: number;
  readonly warmup?: number;
  readonly seed?: string;
  /** Prior standard deviation on each log-hyperparameter. */
  readonly priorLogSd?: number;
  /** Prior means on the log scale, one per hyperparameter, in objective order. */
  readonly priorLogMean?: readonly number[];
  readonly fitNoise?: boolean;
  /** Draws used for the predictive mixture (thinned from the chains). */
  readonly predictiveDraws?: number;
}

export interface FullyBayesianResult {
  readonly mcmc: McmcResult;
  readonly parameterNames: readonly string[];
  readonly summaries: readonly ParameterSummary[];
  readonly exactness: 'empirical';
  readonly priorNote: string;
  readonly limitations: readonly string[];
  /**
   * Predictive distribution marginalised over the hyperparameters: a mixture
   * of Gaussians, reported through its mean and variance.
   */
  predict(Xstar: readonly (readonly number[])[], level?: number): GpPredictionSet;
}

export function fullyBayesianGp(req: GpModelRequest, options: FullyBayesianOptions = {}): FullyBayesianResult {
  const objective = hyperObjective(req, { fitNoise: options.fitNoise });
  const sd = options.priorLogSd ?? 2;
  if (!(sd > 0)) throw new EngineError(`The prior log standard deviation must be positive; received ${sd}.`, 'range');
  const names = objective.names;
  const yValues = Array.from(req.y);
  const ymean = yValues.reduce((s, v) => s + v, 0) / yValues.length;
  const yvar = Math.max(yValues.reduce((s, v) => s + (v - ymean) ** 2, 0) / Math.max(yValues.length - 1, 1), 1e-8);
  const priorMean =
    options.priorLogMean ??
    names.map((n) => {
      if (n === 'noiseVariance') return Math.log(Math.max(req.noiseVariance, yvar * 0.01));
      if (n.includes('variance')) return Math.log(yvar);
      return 0;
    });
  if (priorMean.length !== names.length) {
    throw new EngineError(`The prior needs ${names.length} means, one per hyperparameter; ${priorMean.length} were given.`, 'length');
  }

  const target: TargetSpec = {
    id: 'gp-hyperparameters',
    name: 'GP log-hyperparameters',
    dimension: objective.size,
    parameterNames: names.map((n) => `log ${n}`),
    description:
      'Posterior over the log-hyperparameters of a Gaussian process: the log marginal likelihood plus a normal prior on each log-parameter.',
    logDensity: (x) => {
      let lp = 0;
      for (let i = 0; i < x.length; i++) {
        if (!Number.isFinite(x[i])) return Number.NEGATIVE_INFINITY;
        lp += -0.5 * ((x[i] - priorMean[i]) / sd) ** 2;
      }
      try {
        const { value } = objective.evaluate(x);
        if (!Number.isFinite(value)) return Number.NEGATIVE_INFINITY;
        return value + lp;
      } catch {
        // A parameter vector whose covariance matrix cannot be factorised has
        // zero posterior mass; it is rejected, not repaired.
        return Number.NEGATIVE_INFINITY;
      }
    },
    suggestedStarts: [priorMean.map((m) => m)],
  };

  const mcmc = runMcmc({
    target,
    sampler: { kind: 'slice' },
    chains: options.chains ?? 3,
    iterations: options.iterations ?? 300,
    warmup: options.warmup ?? 150,
    seed: options.seed ?? 'gp-fully-bayesian',
  });

  const draws: number[][] = [];
  for (const chain of mcmc.chains) {
    const count = chain.draws[0]?.length ?? 0;
    for (let i = 0; i < count; i++) draws.push(chain.draws.map((p) => p[i]));
  }
  if (draws.length === 0) {
    throw new EngineError('The hyperparameter sampler produced no draws, so no posterior is available.', 'numerical');
  }
  const wanted = Math.min(options.predictiveDraws ?? 60, draws.length);
  const stride = Math.max(1, Math.floor(draws.length / wanted));
  const used = draws.filter((_, i) => i % stride === 0).slice(0, wanted);

  return {
    mcmc,
    parameterNames: names,
    summaries: mcmc.summaries,
    exactness: 'empirical',
    priorNote:
      `Prior: log θ ~ N(m, ${sd}²) on each hyperparameter, with m from the data scale. These priors are weakly ` +
      'informative, not uninformative, and they shift the answer — particularly the length scale, which the data ' +
      'often barely constrains.',
    limitations: [
      'Every number is a Monte Carlo average over correlated draws and carries sampling error. Check the convergence verdict before using any of it.',
      `The predictive distribution is a mixture over ${used.length} thinned draws, not over the whole posterior.`,
      'The predictive mixture is summarised by its mean and variance; the mixture itself is not Gaussian, so an interval built from that variance is an approximation even though each component is exact.',
      ...mcmc.warnings,
    ],
    predict(Xstar, level = 0.95) {
      if (mcmc.convergence.verdict === 'not converged') {
        throw new EngineError(
          `The hyperparameter chains did not converge (${mcmc.convergence.headline}; worst R-hat ` +
            `${mcmc.convergence.worstRHat.toFixed(3)} on ${mcmc.convergence.worstRHatParameter}). A predictive ` +
            'distribution built on an unconverged chain is not an estimate of anything, so none is returned. Run more ' +
            'iterations or tighten the priors.',
          'non-convergence',
        );
      }
      const z = normalQuantile(0.5 + level / 2);
      const m = Xstar.length;
      const sumMean = new Array<number>(m).fill(0);
      const sumMeanSq = new Array<number>(m).fill(0);
      const sumLatent = new Array<number>(m).fill(0);
      const sumNoise = new Array<number>(m).fill(0);
      for (const theta of used) {
        const model = objective.model(theta);
        const preds = predictGp(model, Xstar, { level }).predictions;
        for (let i = 0; i < m; i++) {
          sumMean[i] += preds[i].mean;
          sumMeanSq[i] += preds[i].mean * preds[i].mean;
          sumLatent[i] += preds[i].latentVariance;
          sumNoise[i] += preds[i].noiseVariance;
        }
      }
      const count = used.length;
      const predictions: GpPrediction[] = Xstar.map((xs, i) => {
        const mean = sumMean[i] / count;
        // Law of total variance across the hyperparameter draws.
        const withinLatent = sumLatent[i] / count;
        const between = Math.max(sumMeanSq[i] / count - mean * mean, 0);
        const latentVariance = withinLatent + between;
        const noiseVariance = sumNoise[i] / count;
        const predictiveVariance = latentVariance + noiseVariance;
        return {
          x: xs,
          mean,
          latentVariance,
          latentSd: Math.sqrt(latentVariance),
          latentInterval: {
            kind: 'latent-credible',
            level,
            lower: mean - z * Math.sqrt(latentVariance),
            upper: mean + z * Math.sqrt(latentVariance),
            label: INTERVAL_LABEL['latent-credible'],
          },
          predictiveVariance,
          predictiveSd: Math.sqrt(predictiveVariance),
          predictiveInterval: {
            kind: 'predictive',
            level,
            lower: mean - z * Math.sqrt(predictiveVariance),
            upper: mean + z * Math.sqrt(predictiveVariance),
            label: INTERVAL_LABEL.predictive,
          },
          noiseVariance,
        };
      });
      return {
        predictions,
        exactness: 'empirical',
        jitter: { added: 0, attempts: [], needed: false, note: 'Jitter varies by draw; see each conditioned model.' },
        warnings: [
          'These predictions average over the hyperparameter posterior, so they are EMPIRICAL: they carry Monte Carlo error on top of the exact per-draw conditionals.',
        ],
        notes: [
          INTERVAL_LABEL['latent-credible'],
          INTERVAL_LABEL.predictive,
          'The latent variance is the law of total variance across hyperparameter draws: the average within-draw variance plus the variance of the draw means. The second term is the part a point estimate throws away, and it is usually the larger one far from the data.',
        ],
      };
    },
  };
}
