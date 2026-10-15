/**
 * Power-law degree distributions: estimation, goodness of fit, and sampling.
 *
 * Estimating a power-law exponent from a finite sample is notoriously
 * unreliable, and the usual method makes it worse. Fitting a straight line to
 * a log-log histogram is *biased*: logarithmic binning gives the sparsely
 * populated high-degree bins the same weight as the dense low-degree ones,
 * the errors on a log scale are not Gaussian, and the bin boundaries
 * themselves change the answer. Clauset, Shalizi and Newman showed the bias
 * can be several tenths of an exponent unit — enough to turn a divergent
 * second moment into a convergent one and so to reverse the qualitative
 * conclusion about an epidemic threshold.
 *
 * This module therefore provides the maximum-likelihood estimator with its
 * standard error and a Kolmogorov–Smirnov goodness-of-fit test, and *also*
 * the log-log regression slope — explicitly labelled as the biased estimator,
 * so the two can be compared rather than one quietly used.
 */
import { EngineError, Validator } from '../core/result';
import { Random } from '../random/rng';
import type { NetworkQuantity } from './types';
import { nq } from './types';

export interface PowerLawFit {
  /** The MLE exponent alpha of P(k) ~ k^-alpha for k >= kMin. */
  exponent: NetworkQuantity;
  standardError: NetworkQuantity;
  /** 95% interval from the asymptotic standard error. */
  interval: { lower: number; upper: number; level: number };
  kMin: number;
  /** Observations at or above kMin — the only ones the fit uses. */
  tailSize: number;
  totalObservations: number;
  /** KS distance between the empirical tail and the fitted power law. */
  ksStatistic: NetworkQuantity;
  discrete: boolean;
  notes: string[];
  limitations: string[];
}

/**
 * Clauset maximum-likelihood exponent for a (discrete or continuous) power law
 * above a cutoff kMin.
 *
 * Continuous: alpha = 1 + n / sum ln(x_i / kMin), SE = (alpha-1)/sqrt(n).
 * Discrete: the same with kMin - 1/2, the standard continuous approximation to
 * the discrete MLE, which is accurate for kMin >= 6 and biased for smaller
 * kMin — and this module says so rather than hiding it.
 */
export function fitPowerLawMLE(
  values: ReadonlyArray<number>,
  options: { kMin?: number; discrete?: boolean } = {},
): PowerLawFit {
  const discrete = options.discrete ?? true;
  const finite = values.filter((x) => Number.isFinite(x));
  if (finite.length !== values.length) {
    throw new EngineError(
      `${values.length - finite.length} of ${values.length} observations are not finite numbers. A power-law fit on ` +
        'a sample containing NaN or Infinity is meaningless.',
      'finite',
    );
  }
  const kMin = options.kMin ?? (discrete ? 1 : Math.min(...finite.filter((x) => x > 0)));
  const v = new Validator();
  v.positive(kMin, 'kMin', 'Lower cutoff kMin');
  v.throwIfInvalid();
  const tail = finite.filter((x) => x >= kMin);
  const n = tail.length;
  if (n < 2) {
    throw new EngineError(
      `Only ${n} observations are at or above kMin = ${kMin}. A power-law exponent cannot be estimated from fewer ` +
        'than two tail observations; no exponent is reported.',
      'too-few',
    );
  }
  const shift = discrete ? 0.5 : 0;
  const base = kMin - shift;
  if (base <= 0) {
    throw new EngineError(
      `The discrete MLE uses kMin - 1/2 = ${base} as the scale, which must be positive. Use kMin >= 1 for a ` +
        'discrete fit.',
      'range',
    );
  }
  let sumLog = 0;
  for (const x of tail) {
    if (x <= 0) {
      throw new EngineError('A power law has no support at or below 0, but the sample contains non-positive values.', 'range');
    }
    sumLog += Math.log(x / base);
  }
  if (sumLog <= 0) {
    throw new EngineError(
      'The log-likelihood sum is zero or negative: every tail observation equals the cutoff, so there is no spread ' +
        'to estimate an exponent from.',
      'degenerate',
    );
  }
  const alpha = 1 + n / sumLog;
  const se = (alpha - 1) / Math.sqrt(n);

  // KS distance between the empirical tail CDF and the fitted power law.
  const sorted = [...tail].sort((a, b) => a - b);
  let ks = 0;
  for (let i = 0; i < n; i++) {
    const emp = (i + 1) / n;
    const theo = 1 - (sorted[i] / base) ** (1 - alpha);
    ks = Math.max(ks, Math.abs(emp - theo), Math.abs(i / n - theo));
  }

  const limitations = [
    'The standard error is the asymptotic one, (alpha-1)/sqrt(n_tail). It understates uncertainty when the tail is ' +
      'short or when kMin was itself chosen from the data.',
    'A power law is only one of several heavy-tailed candidates. A good KS fit does NOT establish a power law: a ' +
      'log-normal or a stretched exponential often fits comparably well, and distinguishing them needs a likelihood ' +
      'ratio test, not a goodness-of-fit statistic.',
  ];
  if (discrete && kMin < 6) {
    limitations.push(
      `The discrete MLE here uses the continuous approximation with kMin - 1/2; at kMin = ${kMin} (below 6) that ` +
        'approximation is itself biased, typically by a few per cent in alpha.',
    );
  }
  if (n < 50) {
    limitations.push(`Only ${n} tail observations. Exponent estimates from short tails are very noisy; treat the interval as optimistic.`);
  }

  return {
    exponent: nq('Power-law exponent (MLE)', alpha, 'numerical', {
      formula: discrete
        ? 'alpha = 1 + n / sum ln(x_i / (kMin - 1/2))'
        : 'alpha = 1 + n / sum ln(x_i / kMin)',
    }),
    standardError: nq('Standard error of alpha', se, 'numerical', { formula: 'SE = (alpha - 1)/sqrt(n_tail)' }),
    interval: { lower: alpha - 1.959963984540054 * se, upper: alpha + 1.959963984540054 * se, level: 0.95 },
    kMin,
    tailSize: n,
    totalObservations: finite.length,
    ksStatistic: nq('KS distance to the fitted power law', ks, 'numerical', {
      formula: 'D = max_x |F_emp(x) - F_fit(x)| over the tail',
    }),
    discrete,
    notes: [
      `Fitted on the ${n} observations at or above kMin = ${kMin}, of ${finite.length} in total.`,
      'This is the maximum-likelihood estimator, not a log-log regression slope. The two differ systematically; see fitPowerLawLogLog.',
    ],
    limitations,
  };
}

/**
 * Clauset's kMin selection: choose the cutoff minimising the KS distance
 * between the tail and its own MLE fit.
 */
export function selectPowerLawCutoff(
  values: ReadonlyArray<number>,
  options: { discrete?: boolean; minTail?: number } = {},
): PowerLawFit {
  const minTail = options.minTail ?? 10;
  const candidates = [...new Set(values.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  if (candidates.length === 0) {
    throw new EngineError('No positive finite observations, so no cutoff can be selected.', 'empty');
  }
  let best: PowerLawFit | null = null;
  for (const kMin of candidates) {
    const tailCount = values.reduce((c, x) => c + (x >= kMin ? 1 : 0), 0);
    if (tailCount < minTail) continue;
    let fit: PowerLawFit;
    try {
      fit = fitPowerLawMLE(values, { kMin, discrete: options.discrete });
    } catch {
      continue;
    }
    if (!best || fit.ksStatistic.value < best.ksStatistic.value) best = fit;
  }
  if (!best) {
    throw new EngineError(
      `No cutoff leaves at least ${minTail} tail observations with an estimable exponent. The sample is too small or ` +
        'too concentrated for a power-law fit; no exponent is reported.',
      'too-few',
    );
  }
  return {
    ...best,
    notes: [...best.notes, 'kMin was selected by minimising the KS distance (Clauset). Selecting kMin from the data makes the reported standard error optimistic.'],
  };
}

export interface LogLogFit {
  slope: NetworkQuantity;
  impliedExponent: NetworkQuantity;
  rSquared: number;
  bins: number;
  notes: string[];
}

/**
 * The log-log regression slope, provided *for comparison only*.
 *
 * It is the method most often used and it is biased. Keeping it here, clearly
 * labelled, lets a caller see the size of the bias on their own data instead
 * of taking the claim on trust.
 */
export function fitPowerLawLogLog(values: ReadonlyArray<number>, options: { kMin?: number } = {}): LogLogFit {
  const kMin = options.kMin ?? 1;
  const counts = new Map<number, number>();
  let total = 0;
  for (const x of values) {
    if (!Number.isFinite(x) || x < kMin) continue;
    counts.set(x, (counts.get(x) ?? 0) + 1);
    total++;
  }
  if (counts.size < 3) {
    throw new EngineError(
      `Only ${counts.size} distinct values at or above ${kMin}; a regression through fewer than three points is not a fit.`,
      'too-few',
    );
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [k, c] of counts) {
    xs.push(Math.log(k));
    ys.push(Math.log(c / total));
  }
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0) throw new EngineError('All values are identical on the log scale; the regression slope is undefined.', 'degenerate');
  const slope = sxy / sxx;
  return {
    slope: nq('Log-log regression slope', slope, 'numerical', { formula: 'OLS of log P(k) on log k' }),
    impliedExponent: nq('Exponent implied by the log-log slope', -slope, 'numerical', {
      note: 'BIASED. Every point of the degree histogram gets equal weight in this regression, including the ' +
        'high-degree bins that hold one or two nodes, and the regression residuals are not Gaussian on a log scale. ' +
        'Use the MLE (fitPowerLawMLE). This value is reported only so that the size of the bias is visible.',
    }),
    rSquared: syy > 0 ? (sxy * sxy) / (sxx * syy) : 0,
    bins: n,
    notes: [
      'This estimator is included as a counter-example, not as a recommendation.',
      'A high R^2 here is not evidence of a power law: it is routine to get R^2 above 0.9 fitting a log-normal sample this way.',
    ],
  };
}

/**
 * A semi-parametric Kolmogorov–Smirnov goodness-of-fit p-value: the fraction
 * of power-law samples (drawn from the fitted model, same size) whose own KS
 * distance to their own refit is at least the observed one.
 *
 * A *small* p-value rejects the power law. A large one does not establish it —
 * it only says the data are not inconsistent with it, which on a few hundred
 * observations is a weak statement.
 */
export function powerLawGoodnessOfFit(
  fit: PowerLawFit,
  seed: string | number,
  options: { replicates?: number } = {},
): { pValue: NetworkQuantity; replicates: number; observedKs: number; notes: string[] } {
  const replicates = options.replicates ?? 200;
  const v = new Validator();
  v.integer(replicates, 'replicates', 'Bootstrap replicates', 20, 10_000);
  v.throwIfInvalid();
  const rng = new Random(seed);
  const observed = fit.ksStatistic.value;
  let atLeast = 0;
  for (let r = 0; r < replicates; r++) {
    const sample = samplePowerLaw(fit.tailSize, fit.exponent.value, fit.kMin, rng, { discrete: fit.discrete });
    let refit: PowerLawFit;
    try {
      refit = fitPowerLawMLE(sample, { kMin: fit.kMin, discrete: fit.discrete });
    } catch {
      continue;
    }
    if (refit.ksStatistic.value >= observed) atLeast++;
  }
  const p = atLeast / replicates;
  return {
    pValue: nq('KS goodness-of-fit p-value', p, 'empirical', {
      formula: 'P(D_synthetic >= D_observed) over synthetic power-law samples',
      note: `Monte Carlo over ${replicates} replicates, so itself uncertain by about ` +
        `${(Math.sqrt((p * (1 - p)) / replicates) || 0).toPrecision(2)} (one standard error).`,
    }),
    replicates,
    observedKs: observed,
    notes: [
      'A p-value below about 0.1 is evidence against the power law. A larger one is NOT evidence for it: the test ' +
        'has little power on a few hundred observations, and a log-normal sample routinely passes it.',
      'The cutoff kMin was held fixed at the fitted value, so this does not account for uncertainty in kMin.',
    ],
  };
}

/**
 * Sample from a (discrete or continuous) power law with exponent alpha above
 * kMin, by inverse transform: x = kMin (1-u)^(-1/(alpha-1)).
 *
 * The discrete version rounds, which is the standard fast approximation; it is
 * accurate in the tail and slightly misallocates mass between the first few
 * integers.
 */
export function samplePowerLaw(
  n: number,
  alpha: number,
  kMin: number,
  rng: Random,
  options: { discrete?: boolean; kMax?: number } = {},
): number[] {
  const v = new Validator();
  v.integer(n, 'n', 'Sample size', 1, 10_000_000);
  v.positive(kMin, 'kMin', 'Lower cutoff kMin');
  v.throwIfInvalid();
  if (!(alpha > 1)) {
    throw new EngineError(
      `A power law needs exponent alpha > 1 to be normalisable above a finite cutoff; alpha = ${alpha} was given. ` +
        'No sample is produced.',
      'range',
    );
  }
  const discrete = options.discrete ?? true;
  const kMax = options.kMax ?? Infinity;
  if (kMax <= kMin) throw new EngineError(`kMax = ${kMax} must exceed kMin = ${kMin}.`, 'range');
  const out = new Array<number>(n);
  const power = -1 / (alpha - 1);
  for (let i = 0; i < n; i++) {
    const u = rng.uniformOpen();
    let x = kMin * (1 - u) ** power;
    if (discrete) x = Math.round(x);
    if (x > kMax) x = kMax;
    out[i] = x;
  }
  return out;
}

/**
 * A power-law degree sequence suitable for the configuration model: sampled,
 * then adjusted so that the degree sum is even (a hard requirement of any
 * graph) and no degree exceeds n-1 (a hard requirement of a *simple* graph).
 *
 * Both adjustments are reported, because they change the distribution's tail
 * and therefore the second moment that epidemic thresholds depend on.
 */
export function powerLawDegreeSequence(
  n: number,
  alpha: number,
  kMin: number,
  seed: string | number,
  options: { kMax?: number } = {},
): { degrees: number[]; truncated: number; parityAdjusted: boolean; notes: string[] } {
  const rng = new Random(seed);
  const hardMax = Math.min(options.kMax ?? n - 1, n - 1);
  const raw = samplePowerLaw(n, alpha, kMin, rng, { discrete: true });
  let truncated = 0;
  const degrees = raw.map((k) => {
    const capped = Math.max(0, Math.min(hardMax, Math.round(k)));
    if (capped < Math.round(k)) truncated++;
    return capped;
  });
  let sum = 0;
  for (const d of degrees) sum += d;
  let parityAdjusted = false;
  if (sum % 2 !== 0) {
    // Nudge one node that can absorb it without breaking the simple-graph bound.
    let idx = degrees.findIndex((d) => d > kMin);
    if (idx < 0) idx = degrees.findIndex((d) => d < hardMax);
    if (idx < 0) {
      throw new EngineError(
        'The sampled degree sum is odd and no node can be adjusted without breaking the kMin or n-1 bounds, so no ' +
          'graph can realise it. No degree sequence is returned.',
        'unrealisable',
      );
    }
    degrees[idx] += degrees[idx] > kMin ? -1 : 1;
    parityAdjusted = true;
  }
  const notes = [
    `Sampled from a discrete power law with alpha = ${alpha} above kMin = ${kMin}, capped at ${hardMax} (= n-1 for a simple graph).`,
  ];
  if (truncated > 0) {
    notes.push(
      `${truncated} of ${n} sampled degrees exceeded ${hardMax} and were truncated. Truncation removes exactly the ` +
        'hubs that dominate the second moment <k^2>, so the realised network has a HIGHER epidemic threshold and is ' +
        'LESS vulnerable to targeted attack than the untruncated power law would be. This is a finite-size artefact, ' +
        'not a property of the model.',
    );
  }
  if (parityAdjusted) notes.push('One degree was adjusted by 1 to make the degree sum even (the handshake lemma).');
  return { degrees, truncated, parityAdjusted, notes };
}
