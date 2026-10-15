/**
 * Variance-reduction techniques.
 *
 * Every function here reports MEASURED efficiency: the variance of the plain
 * Monte Carlo estimator and of this estimator, both estimated from the run
 * that was actually performed, their ratio, and the implied effective sample
 * size. No function asserts a theoretical gain, and several of them report a
 * LOSS when the technique does not suit the integrand — that is the point.
 *
 * Convention for `EfficiencyReport`:
 *   methodVariancePerEval   = Var(estimator) × evaluations
 *   baselineVariancePerEval = variance of one plain Monte Carlo evaluation
 *   varianceReductionFactor = baseline / method   (> 1 helped, < 1 HURT)
 *   effectiveSampleSize     = evaluations × varianceReductionFactor
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { Random, Xoshiro128, type Seed } from '../random/rng';
import { normalSf } from '../special/gamma';
import type { EfficiencyReport, VarianceReductionResult } from './types';

export type Integrand = (x: Float64Array) => number;

function checkValue(v: number, where: string): number {
  if (!Number.isFinite(v)) {
    throw new EngineError(
      `The integrand returned ${Number.isNaN(v) ? 'NaN' : String(v)} at ${where}. A non-finite integrand value cannot be averaged; fix the integrand or restrict its domain. No substitute value will be used.`,
      'non-finite',
    );
  }
  return v;
}

function requireSamples(n: number, label: string): void {
  if (!Number.isInteger(n) || n < 2) {
    throw new EngineError(`${label} must be a whole number of at least 2; variance cannot be estimated from fewer.`, 'range');
  }
}

function efficiency(baselinePerEval: number, estimatorVariance: number, evaluations: number): EfficiencyReport {
  const methodPerEval = estimatorVariance * evaluations;
  const factor = methodPerEval > 0 ? baselinePerEval / methodPerEval : Infinity;
  const ess = evaluations * factor;
  return {
    baselineVariancePerEval: baselinePerEval,
    methodVariancePerEval: methodPerEval,
    varianceReductionFactor: factor,
    effectiveSampleSize: ess,
    effectiveSampleSizeGain: ess - evaluations,
  };
}

/** Sample mean and unbiased sample variance. */
function moments(xs: ArrayLike<number>): { mean: number; variance: number } {
  const n = xs.length;
  let s = 0;
  for (let i = 0; i < n; i++) s += xs[i];
  const m = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = xs[i] - m;
    ss += d * d;
  }
  return { mean: m, variance: n > 1 ? ss / (n - 1) : 0 };
}

/** Plain Monte Carlo over [0,1)^d: the baseline everything else is measured against. */
export function plainMonteCarlo(options: {
  integrand: Integrand;
  dimension: number;
  samples: number;
  seed: Seed;
}): VarianceReductionResult {
  const { dimension: d, samples: n } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a whole number of at least 1.', 'range');
  requireSamples(n, 'The number of samples');
  const rng = new Xoshiro128(`mc:${String(options.seed)}`);
  const buf = new Float64Array(d);
  const values = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < d; k++) buf[k] = rng.next();
    values[i] = checkValue(options.integrand(buf), `sample ${i + 1}`);
  }
  const { mean, variance } = moments(values);
  const estimatorVariance = variance / n;
  return {
    method: 'Plain Monte Carlo',
    estimate: mean,
    standardError: Math.sqrt(estimatorVariance),
    errorBasis: { kind: 'iid', note: 'Independent samples, so the standard error is s/√N.' },
    evaluations: n,
    exactness: 'empirical',
    efficiency: efficiency(variance, estimatorVariance, n),
    diagnostics: { sampleVariance: variance },
    warnings: [],
  };
}

/**
 * Antithetic variates: pair each point u with 1 − u.
 *
 * This helps only when the integrand is monotone in (most of) its arguments,
 * because the gain is exactly 1/(1 + ρ) where ρ = corr(f(U), f(1−U)). For a
 * symmetric integrand such as (x − ½)², ρ = +1 and antithetic sampling is
 * TWICE AS BAD as plain Monte Carlo at equal cost. The induced correlation is
 * measured here and a positive value is reported as harm, not glossed over.
 */
export function antitheticVariates(options: {
  integrand: Integrand;
  dimension: number;
  /** Number of antithetic PAIRS; the evaluation budget is 2 × pairs. */
  pairs: number;
  seed: Seed;
}): VarianceReductionResult {
  const { dimension: d, pairs: m } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a whole number of at least 1.', 'range');
  requireSamples(m, 'The number of antithetic pairs');
  const rng = new Xoshiro128(`antithetic:${String(options.seed)}`);
  const u = new Float64Array(d);
  const v = new Float64Array(d);
  const a = new Float64Array(m);
  const b = new Float64Array(m);
  const avg = new Float64Array(m);
  const all = new Float64Array(2 * m);
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < d; k++) {
      u[k] = rng.next();
      v[k] = 1 - u[k];
    }
    a[i] = checkValue(options.integrand(u), `pair ${i + 1} (primary)`);
    b[i] = checkValue(options.integrand(v), `pair ${i + 1} (antithetic)`);
    avg[i] = 0.5 * (a[i] + b[i]);
    all[2 * i] = a[i];
    all[2 * i + 1] = b[i];
  }
  const pooled = moments(all);
  const pair = moments(avg);
  // corr(f(U), f(1−U)) estimated from the pairs, pooling both orderings.
  const ma = pooled.mean;
  let cov = 0;
  for (let i = 0; i < m; i++) cov += (a[i] - ma) * (b[i] - ma);
  cov /= m - 1;
  const rho = pooled.variance > 0 ? cov / pooled.variance : 0;
  const estimatorVariance = pair.variance / m;
  const evaluations = 2 * m;
  const eff = efficiency(pooled.variance, estimatorVariance, evaluations);
  const warnings: string[] = [];
  if (rho > 0.02) {
    warnings.push(
      `Antithetic sampling HURT here: the induced correlation between f(U) and f(1−U) is +${rho.toFixed(3)}, so the measured variance reduction factor is ${eff.varianceReductionFactor.toFixed(3)} — below 1. Use plain Monte Carlo, or a different variance-reduction technique. Antithetic variates only help when the integrand is monotone.`,
    );
  } else if (rho > -0.02) {
    warnings.push(
      `Antithetic sampling made essentially no difference: the induced correlation is ${rho.toFixed(3)}, near zero. The integrand has little monotone component in these coordinates.`,
    );
  }
  return {
    method: 'Antithetic variates',
    estimate: pair.mean,
    standardError: Math.sqrt(estimatorVariance),
    errorBasis: {
      kind: 'iid',
      note: 'The antithetic PAIRS are independent of one another, so the standard error is computed across pair averages. Treating the 2N individual evaluations as independent would be wrong.',
    },
    evaluations,
    exactness: 'empirical',
    efficiency: eff,
    diagnostics: { inducedCorrelation: rho, pairVariance: pair.variance, pooledVariance: pooled.variance },
    warnings,
  };
}

/**
 * Control variates: estimate E[f] by the mean of f(U) − β(c(U) − E[c]), using
 * a control c whose mean is known exactly.
 *
 * The optimal β is cov(f, c)/var(c) and the achievable variance reduction is
 * 1/(1 − r²) where r = corr(f, c).
 *
 * Bias caveat. Estimating β from the SAME samples used for the mean makes the
 * estimator slightly biased (the bias is O(1/N), small but real). Set
 * `splitFraction` to estimate β on a held-out part of the sample and the mean
 * on the rest: that estimator is exactly unbiased, at the cost of a slightly
 * noisier β. The report says which was used.
 */
export function controlVariates(options: {
  integrand: Integrand;
  /** Control function with a KNOWN mean. */
  control: Integrand;
  /** The exact E[c(U)]; supplying a wrong value biases the estimate. */
  controlMean: number;
  dimension: number;
  samples: number;
  seed: Seed;
  /** Fraction of the sample used only to estimate β (0 = reuse everything). */
  splitFraction?: number;
}): VarianceReductionResult {
  const { dimension: d, samples: n } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a whole number of at least 1.', 'range');
  requireSamples(n, 'The number of samples');
  if (!Number.isFinite(options.controlMean)) {
    throw new EngineError('The control variate mean must be a finite, exactly known number.', 'finite');
  }
  const split = options.splitFraction ?? 0;
  if (!(split >= 0 && split < 1)) {
    throw new EngineError('splitFraction must be at least 0 and below 1.', 'range');
  }
  const nFit = Math.floor(n * split);
  if (split > 0 && nFit < 2) {
    throw new EngineError('The split used to estimate the control coefficient needs at least 2 samples; raise the sample count or splitFraction.', 'range');
  }
  const rng = new Xoshiro128(`control:${String(options.seed)}`);
  const buf = new Float64Array(d);
  const f = new Float64Array(n);
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < d; k++) buf[k] = rng.next();
    f[i] = checkValue(options.integrand(buf), `sample ${i + 1}`);
    c[i] = checkValue(options.control(buf), `control at sample ${i + 1}`);
  }
  const fitRange = split > 0 ? [0, nFit] : [0, n];
  const useRange = split > 0 ? [nFit, n] : [0, n];
  const beta = optimalBeta(f, c, fitRange[0], fitRange[1]);
  if (beta === null) {
    throw new EngineError('The control variate is constant over the sample, so its variance is zero and no coefficient exists. Choose a control that varies.', 'degenerate');
  }
  const m = useRange[1] - useRange[0];
  const adjusted = new Float64Array(m);
  const raw = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const j = useRange[0] + i;
    raw[i] = f[j];
    adjusted[i] = f[j] - beta * (c[j] - options.controlMean);
  }
  const base = moments(raw);
  const adj = moments(adjusted);
  const r = correlation(f, c);
  const estimatorVariance = adj.variance / m;
  const eff = efficiency(base.variance, estimatorVariance, m);
  const warnings: string[] = [];
  if (Math.abs(r) < 0.05) {
    warnings.push(
      `The control is almost uncorrelated with the integrand (r = ${r.toFixed(4)}), so the measured variance reduction factor is only ${eff.varianceReductionFactor.toFixed(3)}. An uncorrelated control costs evaluations and buys nothing; it does not make the estimate worse in expectation.`,
    );
  }
  if (split === 0) {
    warnings.push(
      'The control coefficient β was estimated from the same samples as the mean, which introduces a small O(1/N) bias. Set splitFraction (for example 0.1) to remove it exactly, at the cost of a noisier β.',
    );
  }
  return {
    method: split > 0 ? `Control variates (β fitted on a held-out ${Math.round(split * 100)}% of the sample)` : 'Control variates (β fitted in-sample)',
    estimate: adj.mean,
    standardError: Math.sqrt(estimatorVariance),
    errorBasis: { kind: 'iid', note: 'Independent samples; standard error of the adjusted values.' },
    evaluations: 2 * n,
    exactness: 'empirical',
    efficiency: eff,
    diagnostics: { beta, controlCorrelation: r, adjustedVariance: adj.variance, rawVariance: base.variance },
    warnings,
  };
}

function optimalBeta(f: Float64Array, c: Float64Array, from: number, to: number): number | null {
  let mf = 0;
  let mc = 0;
  const n = to - from;
  for (let i = from; i < to; i++) {
    mf += f[i];
    mc += c[i];
  }
  mf /= n;
  mc /= n;
  let cov = 0;
  let vc = 0;
  for (let i = from; i < to; i++) {
    const dc = c[i] - mc;
    cov += (f[i] - mf) * dc;
    vc += dc * dc;
  }
  if (!(vc > 0)) return null;
  return cov / vc;
}

function correlation(x: Float64Array, y: Float64Array): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    sxy += a * b;
    sxx += a * a;
    syy += b * b;
  }
  if (!(sxx > 0) || !(syy > 0)) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

/** One importance-sampling draw: a point and the likelihood ratio at it. */
export interface ImportanceDraw {
  /** Log of the likelihood ratio dP/dQ at the drawn point. */
  logWeight: number;
  /** Value of the quantity being averaged at the drawn point. */
  value: number;
}

export interface ImportanceSamplingResult extends VarianceReductionResult {
  /**
   * Kish effective sample size of the WEIGHTS, (Σw)²/Σw². This is the right
   * diagnostic for a self-normalised estimator. For an unnormalised rare-event
   * estimator it is routinely small by design — the tilt deliberately makes
   * the weights uneven — so it is reported but is NOT the degeneracy test.
   */
  effectiveWeightSampleSize: number;
  /**
   * Effective sample size of the CONTRIBUTIONS w·h, (Σ|c|)²/Σc². This is what
   * actually controls the variance of this estimator, and it is the number the
   * degeneracy test uses.
   */
  contributionEffectiveSampleSize: number;
  /** contributionEffectiveSampleSize / N. Below ~0.1 the estimate is not trustworthy. */
  weightEfficiency: number;
  /** Share of the total |contribution| carried by the single largest one. */
  maxWeightShare: number;
  degenerate: boolean;
}

/**
 * Importance sampling with explicit likelihood-ratio weights.
 *
 * The caller's `draw` returns, for each sample, the value h(X) and the log
 * likelihood ratio log(p(X)/q(X)). The estimate is the plain average of
 * w·h — unbiased when the weights are the true ratios.
 *
 * The failure mode. If q is a poor match for p·h the weights become
 * degenerate: a handful of samples carry nearly all the weight, the estimate is
 * driven by those few draws, and the reported standard error UNDERSTATES the
 * error badly (often by orders of magnitude) because the heavy tail of the
 * weight distribution has not been sampled. The effective sample size of the
 * CONTRIBUTIONS w·h measures this — not the effective sample size of the
 * weights alone, which a well-designed rare-event tilt deliberately makes
 * small. Below 10% of N this function raises a loud warning; both numbers are
 * always returned so either can be checked.
 */
export function importanceSampling(options: {
  samples: number;
  draw: (rng: Random, index: number) => ImportanceDraw;
  seed: Seed;
  /**
   * Variance of one plain Monte Carlo evaluation of the same quantity, when it
   * is known independently. Omitted, it is estimated from the weighted sample,
   * which is the only option when plain Monte Carlo cannot observe the event.
   */
  baselineVariancePerEval?: number;
  /** Warning threshold on effective sample size as a fraction of N (default 0.1). */
  degeneracyThreshold?: number;
  label?: string;
}): ImportanceSamplingResult {
  const n = options.samples;
  requireSamples(n, 'The number of importance samples');
  const threshold = options.degeneracyThreshold ?? 0.1;
  if (!(threshold > 0 && threshold < 1)) {
    throw new EngineError('The degeneracy threshold must lie strictly between 0 and 1.', 'range');
  }
  const rng = new Random(new Xoshiro128(`is:${String(options.seed)}`));
  const weights = new Float64Array(n);
  const contrib = new Float64Array(n);
  const hvals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const draw = options.draw(rng, i);
    if (!Number.isFinite(draw.logWeight) && draw.logWeight !== -Infinity) {
      throw new EngineError(
        `The importance weight at sample ${i + 1} is not finite (log weight ${String(draw.logWeight)}). That means the proposal gives zero density where the target does not, which makes the estimator invalid.`,
        'non-finite',
      );
    }
    checkValue(draw.value, `importance sample ${i + 1}`);
    const w = Math.exp(draw.logWeight);
    if (!Number.isFinite(w)) {
      throw new EngineError(`The importance weight at sample ${i + 1} overflowed (log weight ${draw.logWeight}). Rescale the proposal.`, 'non-finite');
    }
    weights[i] = w;
    hvals[i] = draw.value;
    contrib[i] = w * draw.value;
  }
  const est = moments(contrib);
  const sumW = stableSum(weights);
  let sumW2 = 0;
  let sumAbsC = 0;
  let sumC2 = 0;
  let maxC = 0;
  for (let i = 0; i < n; i++) {
    sumW2 += weights[i] * weights[i];
    const c = Math.abs(contrib[i]);
    sumAbsC += c;
    sumC2 += c * c;
    if (c > maxC) maxC = c;
  }
  if (!(sumAbsC > 0)) {
    throw new EngineError(
      `Every one of the ${n} importance samples contributed exactly zero, so the quantity was NOT OBSERVED at all. That is not an estimate of zero. Use a proposal that puts weight where the integrand is non-zero.`,
      'not-observed',
    );
  }
  const weightEss = sumW2 > 0 ? (sumW * sumW) / sumW2 : 0;
  const ess = (sumAbsC * sumAbsC) / sumC2;
  const weightEfficiency = ess / n;
  const maxWeightShare = maxC / sumAbsC;
  const degenerate = weightEfficiency < threshold;
  // Target-measure variance of h, estimated through the weights. For an
  // indicator this reduces to p(1−p), the plain Monte Carlo variance.
  let eh = 0;
  let eh2 = 0;
  for (let i = 0; i < n; i++) {
    eh += weights[i] * hvals[i];
    eh2 += weights[i] * hvals[i] * hvals[i];
  }
  eh /= n;
  eh2 /= n;
  const baseline = options.baselineVariancePerEval ?? Math.max(0, eh2 - eh * eh);
  const estimatorVariance = est.variance / n;
  const warnings: string[] = [];
  if (degenerate) {
    warnings.push(
      `DEGENERATE IMPORTANCE WEIGHTS. The effective sample size of the contributions is ${ess.toFixed(1)} out of ${n} draws (${(weightEfficiency * 100).toFixed(2)}%), and the single largest weight carries ${(maxWeightShare * 100).toFixed(1)}% of the total. The estimate is driven by a handful of draws and the standard error above is almost certainly far too small, because the heavy tail of the weight distribution has not been sampled. Do not report this estimate. Choose a proposal closer to the target, or tilt it towards the region that matters.`,
    );
  } else if (weightEfficiency < 0.5) {
    warnings.push(
      `The importance weights are uneven: effective sample size ${ess.toFixed(1)} of ${n} (${(weightEfficiency * 100).toFixed(1)}%). The estimate is usable but the proposal could be better matched.`,
    );
  }
  return {
    method: options.label ?? 'Importance sampling',
    estimate: est.mean,
    standardError: Math.sqrt(estimatorVariance),
    errorBasis: {
      kind: 'iid',
      note: degenerate
        ? 'Independent draws, but with degenerate weights this standard error is not trustworthy — see the warning.'
        : 'Independent draws from the proposal; standard error of the weighted values.',
    },
    evaluations: n,
    exactness: 'empirical',
    efficiency: efficiency(baseline, estimatorVariance, n),
    diagnostics: {
      effectiveWeightSampleSize: weightEss,
      contributionEffectiveSampleSize: ess,
      weightEfficiency,
      maxWeightShare,
      weightedVariance: est.variance,
    },
    effectiveWeightSampleSize: weightEss,
    contributionEffectiveSampleSize: ess,
    weightEfficiency,
    maxWeightShare,
    degenerate,
    warnings,
  };
}

/**
 * Exponentially tilted estimate of P(Z > a) for a standard normal Z.
 *
 * The proposal is N(a, 1) — the exponential tilt that moves the mean onto the
 * threshold, which is the asymptotically optimal tilt for this problem. The
 * likelihood ratio is φ(x)/φ(x − a) = exp(−a x + a²/2).
 *
 * This is the clearest demonstration of why the module exists: plain Monte
 * Carlo needs on the order of 1/p ≈ 3 × 10⁵ samples merely to see ONE
 * exceedance of 4.5, and about 10⁸ for a few per cent of relative accuracy,
 * while the tilted estimator reaches a few per cent in a few thousand draws.
 */
export function tiltedNormalTailProbability(options: {
  threshold: number;
  samples: number;
  seed: Seed;
  /** Tilt; defaults to the threshold itself. */
  tilt?: number;
}): ImportanceSamplingResult & { exactValue: number; relativeError: number } {
  const a = options.threshold;
  if (!Number.isFinite(a)) throw new EngineError('The tail threshold must be a finite number.', 'finite');
  const theta = options.tilt ?? a;
  if (!Number.isFinite(theta)) throw new EngineError('The tilt must be a finite number.', 'finite');
  const exact = normalSf(a);
  const result = importanceSampling({
    samples: options.samples,
    seed: `tilt:${String(options.seed)}`,
    label: `Exponentially tilted importance sampling for P(Z > ${a}), proposal N(${theta}, 1)`,
    // Plain Monte Carlo variance for this indicator is p(1−p) with p the exact
    // value, so the efficiency comparison here is against the truth, not an
    // estimate that plain Monte Carlo could not have produced.
    baselineVariancePerEval: exact * (1 - exact),
    draw: (rng) => {
      const x = theta + rng.normal();
      return { value: x > a ? 1 : 0, logWeight: -theta * x + (theta * theta) / 2 };
    },
  });
  return {
    ...result,
    exactValue: exact,
    relativeError: exact > 0 ? Math.abs(result.estimate - exact) / exact : NaN,
  };
}

/**
 * Plain Monte Carlo estimate of P(Z > a) — included so the comparison in the
 * tests is an actual measurement. When no exceedance is observed the estimate
 * is reported as NOT OBSERVED rather than as 0: zero successes in N draws does
 * not mean the probability is zero, and returning 0 would be exactly the kind
 * of plausible-looking wrong number this engine refuses to produce.
 */
export function plainNormalTailProbability(options: { threshold: number; samples: number; seed: Seed }):
  | { observed: true; estimate: number; successes: number; samples: number; standardError: number; upperBound95: number }
  | { observed: false; successes: 0; samples: number; message: string; upperBound95: number } {
  const a = options.threshold;
  if (!Number.isFinite(a)) throw new EngineError('The tail threshold must be a finite number.', 'finite');
  requireSamples(options.samples, 'The number of samples');
  const rng = new Random(new Xoshiro128(`plain-tail:${String(options.seed)}`));
  let successes = 0;
  for (let i = 0; i < options.samples; i++) if (rng.normal() > a) successes++;
  const n = options.samples;
  // One-sided 95% upper bound from zero/low counts: 1 − 0.05^{1/n} at zero
  // successes (exact, from the binomial likelihood).
  const upper = successes === 0 ? 1 - 0.05 ** (1 / n) : (successes + 2) / n;
  if (successes === 0) {
    return {
      observed: false,
      successes: 0,
      samples: n,
      upperBound95: upper,
      message: `The event was NOT OBSERVED in ${n.toLocaleString('en-US')} draws, so plain Monte Carlo gives no estimate of its probability — not an estimate of zero. All the data support is "below ${upper.toExponential(2)}" at 95% confidence. Use importance sampling for a rare event.`,
    };
  }
  const p = successes / n;
  return { observed: true, estimate: p, successes, samples: n, standardError: Math.sqrt((p * (1 - p)) / n), upperBound95: upper };
}

/**
 * Conditional Monte Carlo (Rao–Blackwellisation): average a closed-form
 * conditional expectation E[h | G] instead of h itself. Because
 * Var(E[h|G]) = Var(h) − E[Var(h|G)], this can only reduce variance — the one
 * technique here that cannot backfire, provided the conditional expectation
 * supplied is correct. It is the caller's responsibility that it is; a wrong
 * conditional expectation produces a confidently biased answer, so the raw
 * estimator is computed alongside and a disagreement beyond three combined
 * standard errors is reported as a warning.
 */
export function conditionalMonteCarlo(options: {
  /** Raw h(x), using the same uniforms. */
  raw: Integrand;
  /** Closed-form E[h | G](x), a function of the conditioning part only. */
  conditional: Integrand;
  dimension: number;
  samples: number;
  seed: Seed;
}): VarianceReductionResult {
  const { dimension: d, samples: n } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a whole number of at least 1.', 'range');
  requireSamples(n, 'The number of samples');
  const rng = new Xoshiro128(`condmc:${String(options.seed)}`);
  const buf = new Float64Array(d);
  const rawVals = new Float64Array(n);
  const condVals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < d; k++) buf[k] = rng.next();
    rawVals[i] = checkValue(options.raw(buf), `raw integrand at sample ${i + 1}`);
    condVals[i] = checkValue(options.conditional(buf), `conditional expectation at sample ${i + 1}`);
  }
  const rawM = moments(rawVals);
  const condM = moments(condVals);
  const estimatorVariance = condM.variance / n;
  const seRaw = Math.sqrt(rawM.variance / n);
  const seCond = Math.sqrt(estimatorVariance);
  const gap = Math.abs(rawM.mean - condM.mean);
  const warnings: string[] = [];
  const tolerance = 3 * Math.sqrt(seRaw * seRaw + seCond * seCond);
  if (gap > tolerance) {
    warnings.push(
      `The conditional estimate (${condM.mean}) and the raw estimate (${rawM.mean}) disagree by ${gap}, more than three combined standard errors (${tolerance}). The supplied conditional expectation is probably not the conditional expectation of this integrand. Conditional Monte Carlo cannot reduce variance if it is estimating the wrong quantity.`,
    );
  }
  return {
    method: 'Conditional Monte Carlo (Rao–Blackwellisation)',
    estimate: condM.mean,
    standardError: seCond,
    errorBasis: { kind: 'iid', note: 'Independent samples of the conditional expectation.' },
    evaluations: 2 * n,
    exactness: 'empirical',
    efficiency: efficiency(rawM.variance, estimatorVariance, n),
    diagnostics: {
      rawVariance: rawM.variance,
      conditionalVariance: condM.variance,
      rawEstimate: rawM.mean,
      varianceRemoved: rawM.variance - condM.variance,
    },
    warnings,
  };
}

export interface CrnComparison {
  differenceEstimate: number;
  /** Standard error of the difference with common random numbers. */
  standardErrorCrn: number;
  /** Standard error of the difference with independent streams. */
  standardErrorIndependent: number;
  varianceCrn: number;
  varianceIndependent: number;
  /** varianceIndependent / varianceCrn: measured, > 1 means CRN helped. */
  varianceReductionFactor: number;
  /** corr(f_A(U), f_B(U)) under the shared stream. */
  correlation: number;
  /** Independent-stream estimate of the difference, for comparison. */
  differenceEstimateIndependent: number;
  samplesPerArm: number;
  warnings: string[];
}

/**
 * Common random numbers for comparing two configurations.
 *
 * When the question is "is B better than A?", driving both configurations with
 * the SAME uniforms makes their outputs positively correlated, and
 * Var(A − B) = Var(A) + Var(B) − 2 Cov(A, B) shrinks accordingly. This is
 * frequently the largest single win available in a simulation study and it is
 * routinely missed. Both variants are run here so the reduction is a
 * measurement.
 *
 * CRN requires that the two configurations consume the uniforms in the same
 * order and in the same number — "synchronisation". If they do not, the
 * correlation collapses and CRN gives no benefit; the measured correlation
 * tells you which happened.
 */
export function commonRandomNumbers(options: {
  configurationA: Integrand;
  configurationB: Integrand;
  dimension: number;
  samples: number;
  seed: Seed;
}): CrnComparison {
  const { dimension: d, samples: n } = options;
  if (!Number.isInteger(d) || d < 1) throw new EngineError('Dimension must be a whole number of at least 1.', 'range');
  requireSamples(n, 'The number of samples per configuration');
  const shared = new Xoshiro128(`crn:${String(options.seed)}`);
  const buf = new Float64Array(d);
  const diffCrn = new Float64Array(n);
  const aVals = new Float64Array(n);
  const bVals = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < d; k++) buf[k] = shared.next();
    aVals[i] = checkValue(options.configurationA(buf), `configuration A, sample ${i + 1}`);
    bVals[i] = checkValue(options.configurationB(buf), `configuration B, sample ${i + 1}`);
    diffCrn[i] = aVals[i] - bVals[i];
  }
  const streamA = new Xoshiro128(`crn-indep-a:${String(options.seed)}`);
  const streamB = new Xoshiro128(`crn-indep-b:${String(options.seed)}`);
  const diffIndep = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < d; k++) buf[k] = streamA.next();
    const a = checkValue(options.configurationA(buf), `configuration A (independent stream), sample ${i + 1}`);
    for (let k = 0; k < d; k++) buf[k] = streamB.next();
    const b = checkValue(options.configurationB(buf), `configuration B (independent stream), sample ${i + 1}`);
    diffIndep[i] = a - b;
  }
  const crn = moments(diffCrn);
  const indep = moments(diffIndep);
  const varCrn = crn.variance / n;
  const varIndep = indep.variance / n;
  const rho = correlation(aVals, bVals);
  const factor = varCrn > 0 ? varIndep / varCrn : Infinity;
  const warnings: string[] = [];
  if (factor < 1.05) {
    warnings.push(
      `Common random numbers gave no measurable benefit (variance reduction factor ${factor.toFixed(3)}, correlation between the two configurations ${rho.toFixed(3)}). Either the configurations respond to the uniforms in unrelated ways, or they are not synchronised — check that both consume the same uniforms in the same order.`,
    );
  }
  return {
    differenceEstimate: crn.mean,
    standardErrorCrn: Math.sqrt(varCrn),
    standardErrorIndependent: Math.sqrt(varIndep),
    varianceCrn: varCrn,
    varianceIndependent: varIndep,
    varianceReductionFactor: factor,
    correlation: rho,
    differenceEstimateIndependent: indep.mean,
    samplesPerArm: n,
    warnings,
  };
}

export interface MlmcLevelReport {
  level: number;
  samples: number;
  mean: number;
  variance: number;
  costPerSample: number;
}

export interface MlmcResult {
  estimate: number;
  standardError: number;
  levels: MlmcLevelReport[];
  totalCost: number;
  /** Cost of reaching the same standard error with the finest level alone. */
  singleLevelCost: number;
  costReductionFactor: number;
  warnings: string[];
}

/**
 * Multilevel Monte Carlo (Giles 2008) — scaffolding, not a full solver.
 *
 * The caller supplies, for each level l, a sampler returning the correction
 * Y_l = P_l − P_{l−1} (with Y_0 = P_0) and the cost of one such sample. A pilot
 * run measures V_l and the optimal allocation N_l ∝ √(V_l / C_l) follows; the
 * main run then uses it. The estimate is Σ_l mean(Y_l) and its variance
 * Σ_l V_l / N_l, since the levels are sampled independently.
 *
 * Not implemented: adaptive level selection, Richardson extrapolation, or any
 * check that the level hierarchy actually converges. The bias from truncating
 * at the finest level is NOT estimated here and is not included in the standard
 * error — the reported error is the sampling error only.
 */
export function multilevelMonteCarlo(options: {
  maxLevel: number;
  sampleLevel: (level: number, rng: Random) => number;
  costPerSample: (level: number) => number;
  targetStandardError: number;
  seed: Seed;
  pilotSamples?: number;
  maxTotalSamples?: number;
}): MlmcResult {
  const { maxLevel } = options;
  if (!Number.isInteger(maxLevel) || maxLevel < 0) {
    throw new EngineError('The finest multilevel index must be a non-negative whole number.', 'range');
  }
  const target = options.targetStandardError;
  if (!(target > 0) || !Number.isFinite(target)) {
    throw new EngineError('The target standard error must be a finite positive number.', 'range');
  }
  const pilot = options.pilotSamples ?? 200;
  requireSamples(pilot, 'The pilot sample size');
  const cap = options.maxTotalSamples ?? 4_000_000;
  const rng = new Random(new Xoshiro128(`mlmc:${String(options.seed)}`));
  const levels = maxLevel + 1;
  const pilotStats: { mean: number; variance: number }[] = [];
  const costs: number[] = [];
  for (let l = 0; l < levels; l++) {
    const c = options.costPerSample(l);
    if (!(c > 0) || !Number.isFinite(c)) throw new EngineError(`The cost per sample at level ${l} must be finite and positive.`, 'range');
    costs.push(c);
    const vals = new Float64Array(pilot);
    for (let i = 0; i < pilot; i++) vals[i] = checkValue(options.sampleLevel(l, rng), `level ${l}, pilot sample ${i + 1}`);
    pilotStats.push(moments(vals));
  }
  // N_l = ceil( (1/ε²) √(V_l/C_l) Σ_k √(V_k C_k) )
  let sum = 0;
  for (let l = 0; l < levels; l++) sum += Math.sqrt(Math.max(pilotStats[l].variance, 0) * costs[l]);
  const counts = pilotStats.map((s, l) =>
    Math.max(pilot, Math.ceil((1 / (target * target)) * Math.sqrt(Math.max(s.variance, 0) / costs[l]) * sum)),
  );
  const totalPlanned = counts.reduce((a, b) => a + b, 0);
  const warnings: string[] = [];
  if (totalPlanned > cap) {
    throw new EngineError(
      `Reaching a standard error of ${target} would need ${totalPlanned.toLocaleString('en-US')} level samples, above the cap of ${cap.toLocaleString('en-US')}. Loosen the target or raise maxTotalSamples.`,
      'limit',
    );
  }
  const reports: MlmcLevelReport[] = [];
  let estimate = 0;
  let variance = 0;
  let cost = 0;
  for (let l = 0; l < levels; l++) {
    const n = counts[l];
    const vals = new Float64Array(n);
    for (let i = 0; i < n; i++) vals[i] = checkValue(options.sampleLevel(l, rng), `level ${l}, sample ${i + 1}`);
    const m = moments(vals);
    reports.push({ level: l, samples: n, mean: m.mean, variance: m.variance, costPerSample: costs[l] });
    estimate += m.mean;
    variance += m.variance / n;
    cost += n * costs[l];
  }
  // Single-level comparison: the finest level alone would need
  // Var(P_L)/ε² samples at cost C_L each. Var(P_L) is not directly observed, so
  // it is bounded below by the level-0 variance plus the correction variances —
  // this is a lower bound on the single-level cost, reported as such.
  const fineVariance = pilotStats.reduce((a, s) => a + Math.max(s.variance, 0), 0);
  const singleLevelCost = (fineVariance / (target * target)) * costs[levels - 1];
  if (levels === 1) warnings.push('With a single level this is plain Monte Carlo; the multilevel machinery adds nothing.');
  warnings.push('The reported standard error covers sampling error only. The bias from truncating the level hierarchy at the finest level is not estimated here.');
  return {
    estimate,
    standardError: Math.sqrt(variance),
    levels: reports,
    totalCost: cost,
    singleLevelCost,
    costReductionFactor: cost > 0 ? singleLevelCost / cost : Infinity,
    warnings,
  };
}

/**
 * Russian roulette: an unbiased estimator of an infinite (or merely expensive)
 * sum Σ_{k≥0} a_k, obtained by continuing past term k with probability q and
 * dividing the surviving terms by their survival probability. The estimator is
 * exactly unbiased for any 0 < q < 1 whenever the sum converges; q controls the
 * cost/variance trade-off, and a q too small makes the variance explode even
 * though the estimator stays unbiased.
 */
export function russianRoulette(options: {
  term: (k: number) => number;
  survival: number;
  samples: number;
  seed: Seed;
  maxTerms?: number;
}): VarianceReductionResult & { meanTermsEvaluated: number } {
  const q = options.survival;
  if (!(q > 0 && q < 1)) throw new EngineError('The survival probability must lie strictly between 0 and 1.', 'range');
  requireSamples(options.samples, 'The number of roulette paths');
  const maxTerms = options.maxTerms ?? 10_000;
  const rng = new Random(new Xoshiro128(`roulette:${String(options.seed)}`));
  const n = options.samples;
  const vals = new Float64Array(n);
  let totalTerms = 0;
  for (let i = 0; i < n; i++) {
    let acc = checkValue(options.term(0), 'roulette term 0');
    let weight = 1;
    let k = 0;
    totalTerms++;
    while (rng.uniform() < q) {
      k++;
      if (k >= maxTerms) {
        throw new EngineError(
          `A roulette path reached the term limit of ${maxTerms} without terminating. Raise maxTerms deliberately, or lower the survival probability; truncating here would bias the estimate.`,
          'limit',
        );
      }
      weight /= q;
      acc += weight * checkValue(options.term(k), `roulette term ${k}`);
      totalTerms++;
    }
    vals[i] = acc;
  }
  const m = moments(vals);
  const estimatorVariance = m.variance / n;
  return {
    method: `Russian roulette (survival ${q})`,
    estimate: m.mean,
    standardError: Math.sqrt(estimatorVariance),
    errorBasis: { kind: 'iid', note: 'Independent roulette paths.' },
    evaluations: totalTerms,
    exactness: 'empirical',
    efficiency: efficiency(m.variance, estimatorVariance, n),
    diagnostics: { pathVariance: m.variance, meanTermsEvaluated: totalTerms / n },
    meanTermsEvaluated: totalTerms / n,
    warnings: [],
  };
}

export interface SplittingSpec<S> {
  /** A fresh particle. */
  initial(rng: Random): S;
  /** Advance one step. */
  advance(state: S, rng: Random): S;
  /** Importance function: the particle's progress towards the rare event. */
  score(state: S): number;
  /** The particle can no longer progress (absorbed / path finished). */
  absorbed(state: S): boolean;
  /** Clone a state (must be a deep copy). */
  clone(state: S): S;
}

export interface SplittingResult {
  estimate: number;
  /** Per-stage conditional probabilities, whose product is the estimate. */
  stageProbabilities: number[];
  levels: number[];
  particles: number;
  /** Coefficient-of-variation based standard error (Garvels/Glasserman form). */
  standardError: number;
  evaluations: number;
  warnings: string[];
}

/**
 * Fixed-effort multilevel splitting for a rare event.
 *
 * Particles are evolved until they cross the next level or are absorbed. The
 * fraction that cross estimates the conditional probability of that stage;
 * survivors are then cloned back up to the full particle count and the next
 * stage begins. The estimate is the product of the stage probabilities.
 *
 * If no particle reaches a level the function REFUSES rather than returning 0:
 * a product of probabilities with a zero factor says nothing about the event's
 * probability, only that the levels are spaced too far apart for this particle
 * count.
 */
export function fixedEffortSplitting<S>(options: {
  spec: SplittingSpec<S>;
  /** Increasing level thresholds; the last is the rare event. */
  levels: number[];
  particles: number;
  seed: Seed;
  maxStepsPerParticle?: number;
}): SplittingResult {
  const { levels, particles } = options;
  if (!levels.length) throw new EngineError('At least one level is required for splitting.', 'length');
  for (let i = 1; i < levels.length; i++) {
    if (!(levels[i] > levels[i - 1])) throw new EngineError('Splitting levels must be strictly increasing.', 'order');
  }
  if (!Number.isInteger(particles) || particles < 2) {
    throw new EngineError('Splitting needs a whole number of at least 2 particles.', 'range');
  }
  const maxSteps = options.maxStepsPerParticle ?? 100_000;
  const rng = new Random(new Xoshiro128(`splitting:${String(options.seed)}`));
  const spec = options.spec;
  let population: S[] = Array.from({ length: particles }, () => spec.initial(rng));
  const stageProbabilities: number[] = [];
  let evaluations = 0;
  for (let l = 0; l < levels.length; l++) {
    const threshold = levels[l];
    const survivors: S[] = [];
    for (const start of population) {
      let state = start;
      let steps = 0;
      while (spec.score(state) < threshold && !spec.absorbed(state)) {
        state = spec.advance(state, rng);
        evaluations++;
        if (++steps >= maxSteps) {
          throw new EngineError(
            `A splitting particle ran for ${maxSteps} steps without crossing level ${threshold} or being absorbed. Check that the process terminates.`,
            'limit',
          );
        }
      }
      if (spec.score(state) >= threshold) survivors.push(state);
    }
    const p = survivors.length / population.length;
    if (survivors.length === 0) {
      throw new EngineError(
        `No particle out of ${population.length} reached level ${threshold}. The conditional probability of this stage cannot be estimated, and the product estimate would be 0 — which would be a fabricated answer, not a measurement. Add intermediate levels or raise the particle count.`,
        'not-observed',
      );
    }
    stageProbabilities.push(p);
    // Fixed effort: clone survivors back up to the full particle count.
    const next: S[] = [];
    for (let i = 0; i < particles; i++) next.push(spec.clone(survivors[i % survivors.length]));
    population = next;
  }
  const estimate = stageProbabilities.reduce((a, b) => a * b, 1);
  // Relative variance ≈ Σ (1 − p_l)/(N p_l) for fixed-effort splitting with
  // independent stages (Garvels 2000); this ignores the correlation introduced
  // by cloning and is therefore optimistic — stated as a warning.
  let relVar = 0;
  for (const p of stageProbabilities) relVar += (1 - p) / (particles * p);
  const warnings = [
    'The standard error assumes the splitting stages are independent. Cloning survivors correlates them, so this error estimate is optimistic. For a trustworthy error bar, replicate the whole splitting run with independent seeds and take the spread across replications.',
  ];
  const small = stageProbabilities.filter((p) => p < 0.05);
  if (small.length) {
    warnings.push(`${small.length} stage(s) had a conditional probability below 5%, which makes the estimate noisy. Space the levels more closely.`);
  }
  return {
    estimate,
    stageProbabilities,
    levels: [...levels],
    particles,
    standardError: estimate * Math.sqrt(relVar),
    evaluations,
    warnings,
  };
}
