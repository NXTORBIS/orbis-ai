/**
 * Filter diagnostics: the part that decides whether a filter's output is a
 * result or just an assertion.
 *
 * A Kalman filter always returns a mean and a covariance. Both look
 * respectable whatever the model is. The only things that can catch a
 * misspecified model are:
 *
 *  1. INNOVATION WHITENESS. Under the correct model the standardised
 *     innovations S_t^{-1/2}(y_t − C x_{t|t−1}) are i.i.d. N(0, I). Serial
 *     correlation in them means the dynamics are wrong; a sample covariance
 *     that is not the identity means the noise levels are wrong. Both are
 *     tested, and the test reports in BOTH directions — it must not reject a
 *     correct model and it must reject a badly wrong one.
 *
 *  2. NEES, against a known truth. (x − x̂)ᵀ P⁻¹ (x − x̂) has mean equal to the
 *     state dimension when P is right. This is the only test that catches a
 *     covariance that is too small, which is the dangerous direction: it makes
 *     the filter overconfident and its intervals too narrow.
 *
 * The autocorrelations are taken from `timeseries/dependence.ts` (`acf`), which
 * already implements the standard biased-denominator estimator; the chi-square
 * tail comes from `special/gamma.ts`.
 */
import { EngineError } from '../core/result';
import { brentRoot } from '../core/numeric';
import { incompleteGamma, normalQuantile } from '../special/gamma';
import { acf } from '../timeseries/dependence';
import { inverseSPD, subVec, zeros, type Mat, type Vec } from './matrix';
import { explainFiltering, type CoverageResult, type FilterStep, type NeesResult, type WhitenessResult } from './types';

/** Upper tail of the chi-square distribution with `df` degrees of freedom. */
export function chiSquareUpperTail(x: number, df: number): number {
  if (!(df > 0)) throw new EngineError(`The chi-square degrees of freedom must be positive; received ${df}.`, 'range');
  if (x <= 0) return 1;
  return incompleteGamma(df / 2, x / 2).upper;
}

/** Quantile of the chi-square distribution, by bracketing the tail function. */
export function chiSquareQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1)) throw new EngineError(`A chi-square quantile needs 0 < p < 1; received ${p}.`, 'range');
  const target = 1 - p;
  const lo = 1e-12;
  let hi = Math.max(10, df * 4);
  for (let i = 0; i < 200 && chiSquareUpperTail(hi, df) > target; i++) hi *= 2;
  return brentRoot((x) => chiSquareUpperTail(x, df) - target, lo, hi, { tol: 1e-12 });
}

/**
 * Ljung-Box test on the standardised innovations, plus the covariance check.
 *
 * Under the null the standardised innovations are white with identity
 * covariance, so each channel's Ljung-Box statistic is asymptotically
 * chi-square with `lags` degrees of freedom and the channels are independent;
 * the statistics are summed and the degrees of freedom add. No parameters are
 * subtracted from the degrees of freedom, because the model matrices were
 * supplied rather than estimated from this series — when they WERE estimated,
 * pass `estimatedParameters` so the test is not optimistic.
 */
export function innovationWhiteness(
  steps: FilterStep[],
  options: { lags?: number; level?: number; estimatedParameters?: number } = {},
): WhitenessResult {
  const usable = steps.filter((s) => !s.missing && s.standardisedInnovation !== null);
  const n = usable.length;
  if (n < 8) {
    throw new EngineError(
      `An innovation whiteness test needs at least 8 usable innovations; only ${n} were available. ` +
        'A diagnostic on fewer points than that has no power and would amount to a reassurance with no evidence behind it.',
      'insufficient-data',
    );
  }
  const m = usable[0].standardisedInnovation?.length ?? 0;
  if (m === 0) throw new EngineError('The standardised innovations are empty, so there is nothing to test.', 'required');
  const level = options.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new EngineError(`The level must lie strictly between 0 and 1; received ${level}.`, 'range');
  const maxUsefulLag = Math.max(1, Math.min(Math.floor(n / 4), 20));
  const lags = options.lags ?? Math.min(maxUsefulLag, Math.max(1, Math.floor(10 * Math.log10(n))));
  if (lags >= n) throw new EngineError(`Cannot test ${lags} lags with only ${n} innovations.`, 'range');

  const channels: number[][] = Array.from({ length: m }, () => [] as number[]);
  for (const s of usable) {
    const z = s.standardisedInnovation as Vec;
    for (let j = 0; j < m; j++) channels[j].push(z[j]);
  }

  const autocorrelations: number[][] = [];
  let statistic = 0;
  const warnings: string[] = [];
  for (let j = 0; j < m; j++) {
    const series = channels[j];
    let r: number[];
    try {
      r = acf(series, lags, level).acf;
    } catch (e) {
      if (e instanceof EngineError) {
        throw new EngineError(
          `Channel ${j} of the standardised innovations could not be tested: ${e.message}`,
          'degenerate',
        );
      }
      throw e;
    }
    autocorrelations.push(r);
    let q = 0;
    for (let k = 1; k <= lags; k++) q += (r[k] * r[k]) / (n - k);
    statistic += n * (n + 2) * q;
  }
  const dfRaw = lags * m - (options.estimatedParameters ?? 0);
  if (dfRaw <= 0) {
    throw new EngineError(
      `After subtracting ${options.estimatedParameters} estimated parameters there are no degrees of freedom left ` +
        `(${lags} lags x ${m} channels). Use more lags or a longer series.`,
      'range',
    );
  }
  const pValue = chiSquareUpperTail(statistic, dfRaw);

  // Sample covariance of the standardised innovations: should be the identity.
  const sampleCovariance: Mat = zeros(m, m);
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += channels[j][i] * channels[k][i];
      sampleCovariance[j][k] = s / n;
    }
  }
  let covarianceDeviation = 0;
  for (let j = 0; j < m; j++) {
    for (let k = 0; k < m; k++) {
      covarianceDeviation = Math.max(covarianceDeviation, Math.abs(sampleCovariance[j][k] - (j === k ? 1 : 0)));
    }
  }
  // Standard error of a variance estimate from n normal draws is sqrt(2/n).
  const covTolerance = 4 * Math.sqrt(2 / n);
  if (covarianceDeviation > covTolerance) {
    warnings.push(
      `The standardised innovations have sample covariance departing from the identity by ${covarianceDeviation.toFixed(3)}, ` +
        `more than the ${covTolerance.toFixed(3)} expected from sampling noise at this length. The assumed noise levels ` +
        'Q and R are probably wrong, which makes the reported state intervals the wrong width.',
    );
  }
  const rejected = pValue < 1 - level;
  if (rejected) {
    warnings.push(
      `The innovations are NOT white (Ljung-Box ${statistic.toFixed(2)} on ${dfRaw} df, p = ${pValue.toExponential(2)}). ` +
        'Serial correlation in the innovations means the assumed dynamics do not match the data, so the filtered ' +
        'estimates are biased in a way their covariance does not express.',
    );
  }
  return {
    statistic,
    df: dfRaw,
    pValue,
    lags,
    autocorrelations,
    sampleCovariance,
    covarianceDeviation,
    rejected,
    level,
    n,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Ljung-Box test on standardised innovations',
      'numerical',
      [
        { label: 'Innovations tested', value: String(n) },
        { label: 'Statistic', expression: 'Q = n(n+2) Σ_k r_k²/(n−k)', value: statistic.toFixed(4) },
        { label: 'Degrees of freedom', value: String(dfRaw) },
        { label: 'p-value', value: pValue.toExponential(3) },
        { label: 'Max |sample covariance − I|', value: covarianceDeviation.toFixed(4) },
      ],
      ['The null hypothesis is that the model is correctly specified, under which the standardised innovations are i.i.d. N(0, I).'],
      [
        'The chi-square distribution of the statistic is asymptotic; with fewer than roughly 50 innovations the p-value is approximate.',
        'Failing to reject is not proof of correctness — it means this test found no evidence against the model.',
      ],
    ),
    warnings,
  };
}

/**
 * Normalised estimation error squared, against a known truth.
 *
 * Only usable in a validation run where the true state is available (a
 * simulation). Its value is that it tests the COVARIANCE, not the mean: a
 * filter whose P is half the right size gives a mean NEES of about 2n and
 * intervals that cover far less often than they claim.
 */
export function nees(steps: FilterStep[], trueStates: Vec[], options: { level?: number; useSmoothed?: boolean } = {}): NeesResult {
  if (trueStates.length < steps.length) {
    throw new EngineError(
      `NEES needs one true state per filtered step: ${steps.length} steps were filtered but ${trueStates.length} true states supplied.`,
      'shape',
    );
  }
  const level = options.level ?? 0.95;
  const n = steps.length;
  const d = steps[0].filteredMean.length;
  const perStep: number[] = [];
  for (let t = 0; t < n; t++) {
    const err = subVec(trueStates[t], steps[t].filteredMean);
    if (err.length !== d) throw new EngineError(`True state ${t} has ${err.length} components but the filter state has ${d}.`, 'shape');
    const Pinv = inverseSPD(steps[t].filteredCov, `The filtered covariance at time ${t}`);
    let s = 0;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) s += err[i] * Pinv[i][j] * err[j];
    perStep.push(s);
  }
  const mean = perStep.reduce((a, b) => a + b, 0) / n;
  // n·mean NEES is chi-square with n·d degrees of freedom when the filter is
  // consistent, which gives an exact two-sided acceptance region.
  const alpha = 1 - level;
  const low = chiSquareQuantile(alpha / 2, n * d) / n;
  const high = chiSquareQuantile(1 - alpha / 2, n * d) / n;
  const consistent = mean >= low && mean <= high;
  const warnings: string[] = [];
  if (!consistent) {
    warnings.push(
      mean > high
        ? `The mean NEES is ${mean.toFixed(3)} against an expected ${d} (acceptance region ${low.toFixed(3)}–${high.toFixed(3)}). ` +
          'The filter is OVERCONFIDENT: its covariance is too small, so its intervals cover the truth less often than they claim.'
        : `The mean NEES is ${mean.toFixed(3)} against an expected ${d} (acceptance region ${low.toFixed(3)}–${high.toFixed(3)}). ` +
          'The filter is UNDERCONFIDENT: its covariance is too large, so it is discarding information it actually has.',
    );
  }
  return {
    perStep,
    mean,
    stateDim: d,
    expected: d,
    interval: { low, high },
    consistent,
    level,
    n,
    exactness: 'numerical',
    explanation: explainFiltering(
      'Normalised estimation error squared',
      'numerical',
      [
        { label: 'Steps', value: String(n) },
        { label: 'NEES', expression: '(x − x̂)ᵀ P⁻¹ (x − x̂)' },
        { label: 'Mean NEES', value: mean.toFixed(4) },
        { label: 'Expected (state dimension)', value: String(d) },
        { label: `${(level * 100).toFixed(0)}% acceptance region`, value: `${low.toFixed(4)} – ${high.toFixed(4)}` },
      ],
      ['The true state is known, so this is a validation run and not something available on real data.'],
      [
        'Consecutive NEES values are not independent, so the chi-square acceptance region is approximate for a single run; average over independent runs for a sharp test.',
      ],
    ),
    warnings,
  };
}

/**
 * Empirical coverage of the per-component filtered intervals against a known
 * truth. Reported per state component, because a filter can be well calibrated
 * in one direction and badly wrong in another.
 */
export function intervalCoverage(steps: FilterStep[], trueStates: Vec[], nominal = 0.95): CoverageResult {
  if (!(nominal > 0 && nominal < 1)) throw new EngineError(`The nominal level must lie strictly between 0 and 1; received ${nominal}.`, 'range');
  if (trueStates.length < steps.length) {
    throw new EngineError(`Coverage needs one true state per step: ${steps.length} steps, ${trueStates.length} truths.`, 'shape');
  }
  const d = steps[0].filteredMean.length;
  const z = Math.abs(normalQuantile((1 - nominal) / 2));
  const hits = new Array<number>(d).fill(0);
  for (let t = 0; t < steps.length; t++) {
    for (let i = 0; i < d; i++) {
      const sd = Math.sqrt(steps[t].filteredCov[i][i]);
      if (!(sd > 0)) {
        throw new EngineError(
          `The filtered variance of state component ${i} at time ${t} is ${steps[t].filteredCov[i][i]}, which cannot ` +
            'define an interval.',
          'not-positive-definite',
        );
      }
      const e = Math.abs(trueStates[t][i] - steps[t].filteredMean[i]);
      if (e <= z * sd) hits[i]++;
    }
  }
  return {
    coverage: hits.map((h) => h / steps.length),
    nominal,
    n: steps.length,
    exactness: 'empirical',
    warnings: [
      'Coverage measured on one simulated path is itself a frequency with sampling error; average over independent paths for a tight statement.',
    ],
  };
}

/** State dimension of a filtered sequence. */
export function stateDimensionOf(steps: FilterStep[]): number {
  if (steps.length === 0) throw new EngineError('There are no filtered steps, so no state dimension to report.', 'required');
  return steps[0].filteredMean.length;
}
