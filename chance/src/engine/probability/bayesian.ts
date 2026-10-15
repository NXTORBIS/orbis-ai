/**
 * Bayesian updating with conjugate priors.
 *
 * Three standard conjugate pairs are implemented exactly:
 *
 *  1. Beta–Binomial — unknown probability p with observed successes/failures.
 *     Prior Beta(α, β) → posterior Beta(α + successes, β + failures).
 *     Posterior predictive for the next trial: P(success) = α' / (α' + β').
 *
 *  2. Gamma–Poisson — unknown rate λ with observed counts over exposure t.
 *     Prior Gamma(shape k, rate r) → posterior Gamma(k + Σx, r + t).
 *     (Rate parameterisation; scale θ = 1/r.)
 *     Posterior predictive is negative binomial.
 *
 *  3. Normal–Normal (known observation variance σ²) — unknown mean μ.
 *     Prior N(μ₀, τ₀²) → posterior precision 1/τ₀² + n/σ², with the posterior
 *     mean the precision-weighted average of prior mean and sample mean.
 *     Posterior predictive variance adds σ² to the posterior variance.
 *
 * A credible interval is an interval containing a stated probability of the
 * posterior distribution for the parameter. That is a different statement from
 * a frequentist confidence interval, and both are reported with that label.
 */
import { EngineError, type Explanation, Validator } from '../core/result';
import { beta as betaDist, gamma as gammaDist, negativeBinomial, normal as normalDist } from '../distributions/index';

export type ConjugateFamily = 'beta-binomial' | 'gamma-poisson' | 'normal-normal';

export interface BetaBinomialInput {
  family: 'beta-binomial';
  priorAlpha: number;
  priorBeta: number;
  successes: number;
  failures: number;
}

export interface GammaPoissonInput {
  family: 'gamma-poisson';
  /** Prior shape. */
  priorShape: number;
  /** Prior rate (not scale). */
  priorRate: number;
  /** Total observed events. */
  events: number;
  /** Total exposure (time, area, units) over which the events were observed. */
  exposure: number;
}

export interface NormalNormalInput {
  family: 'normal-normal';
  priorMean: number;
  priorSd: number;
  /** Known standard deviation of a single observation. */
  observationSd: number;
  sampleMean: number;
  sampleSize: number;
}

export type BayesianInput = BetaBinomialInput | GammaPoissonInput | NormalNormalInput;

export interface PosteriorSummary {
  /** Distribution id and parameters of the posterior, for charting. */
  distributionId: string;
  params: Record<string, number>;
  mean: number;
  mode: number | null;
  sd: number;
  /** Equal-tailed credible interval. */
  credibleInterval: { low: number; high: number; level: number };
  /** Prior for comparison. */
  prior: { distributionId: string; params: Record<string, number>; mean: number; sd: number };
  /** Predictive statement about the next observation. */
  predictive: { label: string; value: string; detail: string } | null;
  explanation: Explanation;
  warnings: string[];
}

export function updateBayesian(input: BayesianInput, level = 0.95): PosteriorSummary {
  if (!(level > 0 && level < 1)) throw new EngineError('Credible level must be between 0 and 1.', 'range');
  const lo = (1 - level) / 2;
  const hi = 1 - lo;
  switch (input.family) {
    case 'beta-binomial': {
      const v = new Validator();
      v.positive(input.priorAlpha, 'priorAlpha', 'Prior α');
      v.positive(input.priorBeta, 'priorBeta', 'Prior β');
      v.integer(input.successes, 'successes', 'Observed successes', 0, 1e9);
      v.integer(input.failures, 'failures', 'Observed failures', 0, 1e9);
      v.throwIfInvalid();
      const a = input.priorAlpha + input.successes;
      const b = input.priorBeta + input.failures;
      const params = { alpha: a, beta: b };
      const priorParams = { alpha: input.priorAlpha, beta: input.priorBeta };
      const mean = a / (a + b);
      const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
      const mode = a > 1 && b > 1 ? (a - 1) / (a + b - 2) : null;
      const n = input.successes + input.failures;
      const priorMean = input.priorAlpha / (input.priorAlpha + input.priorBeta);
      const warnings: string[] = [];
      if (n === 0) warnings.push('No observations were supplied, so the posterior equals the prior.');
      if (input.priorAlpha === 1 && input.priorBeta === 1) {
        warnings.push('Beta(1, 1) is the uniform prior: every probability between 0 and 1 is equally likely before the data. This is a choice, not a neutral fact — other "uninformative" priors such as Jeffreys’ Beta(0.5, 0.5) give slightly different answers.');
      }
      return {
        distributionId: 'beta',
        params,
        mean,
        mode,
        sd: Math.sqrt(variance),
        credibleInterval: { low: betaDist.quantile(lo, params), high: betaDist.quantile(hi, params), level },
        prior: {
          distributionId: 'beta',
          params: priorParams,
          mean: priorMean,
          sd: Math.sqrt((input.priorAlpha * input.priorBeta) / ((input.priorAlpha + input.priorBeta) ** 2 * (input.priorAlpha + input.priorBeta + 1))),
        },
        predictive: {
          label: 'Probability the next trial succeeds',
          value: mean.toPrecision(6),
          detail: `The posterior predictive probability for one more trial equals the posterior mean, α′/(α′+β′) = ${a}/${a + b}.`,
        },
        warnings,
        explanation: {
          method: 'Beta–Binomial conjugate update',
          formula: 'Beta(α, β) + s successes and f failures → Beta(α + s, β + f)',
          steps: [
            { label: 'Prior', expression: `Beta(${input.priorAlpha}, ${input.priorBeta})`, value: `mean ${priorMean.toPrecision(6)}` },
            { label: 'Data', expression: `${input.successes} successes, ${input.failures} failures`, value: n ? `observed rate ${(input.successes / n).toPrecision(6)}` : 'no data' },
            { label: 'Posterior', expression: `Beta(${a}, ${b})`, value: `mean ${mean.toPrecision(6)}` },
            { label: `${(level * 100).toFixed(0)}% credible interval`, expression: 'equal-tailed quantiles of the posterior', value: `${betaDist.quantile(lo, params).toPrecision(6)} to ${betaDist.quantile(hi, params).toPrecision(6)}` },
          ],
          assumptions: [
            'Observations are independent Bernoulli trials with the same unknown success probability.',
            'The prior Beta(α, β) represents belief before seeing the data. It is an input you chose, and it influences the result — strongly when there are few observations.',
          ],
          limitations: [
            'A credible interval states where the posterior probability lies, given this prior and this model. It is not a confidence interval and the two should not be read interchangeably.',
          ],
          exactness: 'exact',
        },
      };
    }
    case 'gamma-poisson': {
      const v = new Validator();
      v.positive(input.priorShape, 'priorShape', 'Prior shape');
      v.positive(input.priorRate, 'priorRate', 'Prior rate');
      v.integer(input.events, 'events', 'Observed events', 0, 1e9);
      v.nonNegative(input.exposure, 'exposure', 'Exposure');
      v.throwIfInvalid();
      const shape = input.priorShape + input.events;
      const rate = input.priorRate + input.exposure;
      const params = { k: shape, theta: 1 / rate };
      const priorParams = { k: input.priorShape, theta: 1 / input.priorRate };
      const mean = shape / rate;
      const sd = Math.sqrt(shape) / rate;
      // Posterior predictive for one unit of exposure: NegBinomial(r = shape, p = rate/(rate+1))
      const predP = rate / (rate + 1);
      const predMean = negativeBinomial.mean({ r: shape, p: predP });
      return {
        distributionId: 'gamma',
        params,
        mean,
        mode: shape >= 1 ? (shape - 1) / rate : null,
        sd,
        credibleInterval: { low: gammaDist.quantile(lo, params), high: gammaDist.quantile(hi, params), level },
        prior: { distributionId: 'gamma', params: priorParams, mean: input.priorShape / input.priorRate, sd: Math.sqrt(input.priorShape) / input.priorRate },
        predictive: {
          label: 'Expected events in the next unit of exposure',
          value: predMean.defined ? predMean.value.toPrecision(6) : 'undefined',
          detail: `The posterior predictive distribution is negative binomial with r = ${shape.toPrecision(6)} and p = ${predP.toPrecision(6)}, which is more spread out than a Poisson with the same mean because the rate itself is uncertain.`,
        },
        warnings: input.exposure === 0 ? ['Exposure is 0, so the data carry no information and the posterior equals the prior.'] : [],
        explanation: {
          method: 'Gamma–Poisson conjugate update (rate parameterisation)',
          formula: 'Gamma(k, r) + x events over exposure t → Gamma(k + x, r + t)',
          steps: [
            { label: 'Prior', expression: `Gamma(shape ${input.priorShape}, rate ${input.priorRate})`, value: `mean rate ${(input.priorShape / input.priorRate).toPrecision(6)}` },
            { label: 'Data', expression: `${input.events} events over exposure ${input.exposure}`, value: input.exposure ? `observed rate ${(input.events / input.exposure).toPrecision(6)}` : 'no exposure' },
            { label: 'Posterior', expression: `Gamma(shape ${shape}, rate ${rate})`, value: `mean rate ${mean.toPrecision(6)}` },
            { label: `${(level * 100).toFixed(0)}% credible interval for the rate`, value: `${gammaDist.quantile(lo, params).toPrecision(6)} to ${gammaDist.quantile(hi, params).toPrecision(6)}` },
          ],
          assumptions: [
            'Events occur independently at a constant rate within the observed exposure (a Poisson process).',
            'The prior Gamma(shape, rate) represents belief about the rate before the data.',
          ],
          limitations: ['If the rate varies over the exposure period, or events cluster, the Poisson assumption fails and this interval is too narrow.'],
          exactness: 'exact',
        },
      };
    }
    case 'normal-normal': {
      const v = new Validator();
      v.finite(input.priorMean, 'priorMean', 'Prior mean');
      v.positive(input.priorSd, 'priorSd', 'Prior standard deviation');
      v.positive(input.observationSd, 'observationSd', 'Observation standard deviation');
      v.finite(input.sampleMean, 'sampleMean', 'Sample mean');
      v.integer(input.sampleSize, 'sampleSize', 'Sample size', 0, 1e9);
      v.throwIfInvalid();
      const priorPrecision = 1 / (input.priorSd * input.priorSd);
      const dataPrecision = input.sampleSize / (input.observationSd * input.observationSd);
      const postPrecision = priorPrecision + dataPrecision;
      const postMean = (priorPrecision * input.priorMean + dataPrecision * input.sampleMean) / postPrecision;
      const postSd = Math.sqrt(1 / postPrecision);
      const params = { mu: postMean, sigma: postSd };
      const predSd = Math.sqrt(postSd * postSd + input.observationSd * input.observationSd);
      const weight = dataPrecision / postPrecision;
      return {
        distributionId: 'normal',
        params,
        mean: postMean,
        mode: postMean,
        sd: postSd,
        credibleInterval: { low: normalDist.quantile(lo, params), high: normalDist.quantile(hi, params), level },
        prior: { distributionId: 'normal', params: { mu: input.priorMean, sigma: input.priorSd }, mean: input.priorMean, sd: input.priorSd },
        predictive: {
          label: 'Prediction interval for one further observation',
          value: `${normalDist.quantile(lo, { mu: postMean, sigma: predSd }).toPrecision(6)} to ${normalDist.quantile(hi, { mu: postMean, sigma: predSd }).toPrecision(6)}`,
          detail: `A single new observation is more variable than the mean: its predictive standard deviation is √(posterior variance + observation variance) = ${predSd.toPrecision(6)}.`,
        },
        warnings:
          input.sampleSize === 0
            ? ['No observations were supplied, so the posterior equals the prior.']
            : [`The data carry ${(weight * 100).toFixed(1)}% of the weight in the posterior mean; the prior carries the remaining ${((1 - weight) * 100).toFixed(1)}%.`],
        explanation: {
          method: 'Normal–Normal conjugate update with known observation variance',
          formula: 'posterior precision = 1/τ₀² + n/σ²;  posterior mean = (μ₀/τ₀² + n·x̄/σ²) / posterior precision',
          steps: [
            { label: 'Prior precision', expression: `1 / ${input.priorSd}²`, value: priorPrecision.toPrecision(6) },
            { label: 'Data precision', expression: `${input.sampleSize} / ${input.observationSd}²`, value: dataPrecision.toPrecision(6) },
            { label: 'Posterior mean', expression: 'precision-weighted average of prior mean and sample mean', value: postMean.toPrecision(8) },
            { label: 'Posterior standard deviation', expression: '1 / √(posterior precision)', value: postSd.toPrecision(8) },
            { label: `${(level * 100).toFixed(0)}% credible interval for the mean`, value: `${normalDist.quantile(lo, params).toPrecision(6)} to ${normalDist.quantile(hi, params).toPrecision(6)}` },
          ],
          assumptions: [
            'Observations are independent and normally distributed with a known standard deviation.',
            'The standard deviation of a single observation is treated as known exactly. If it was estimated from the same data, this interval is too narrow.',
          ],
          limitations: ['With a small sample and an estimated observation standard deviation, a model that also treats the variance as unknown (normal–inverse-gamma) would be more honest.'],
          exactness: 'exact',
        },
      };
    }
  }
}
