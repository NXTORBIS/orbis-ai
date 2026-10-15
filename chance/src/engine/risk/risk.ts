/**
 * Risk metrics computed from a simulated loss distribution.
 *
 * Loss convention
 * ---------------
 * Throughout this module a **loss is a positive number**. A gain is negative.
 * This is stated with every result because the opposite convention is also in
 * common use and the sign determines what Value at Risk means.
 *
 * Value at Risk (VaR) at confidence level α is the α-quantile of the loss
 * distribution: the loss that is exceeded with probability 1 − α. VaR says
 * nothing about how bad the loss is when it is exceeded.
 *
 * Expected Shortfall (ES), also called conditional VaR, is the expected loss
 * given that the loss exceeds VaR: the average of the worst (1 − α) share of
 * outcomes. ES ≥ VaR always.
 *
 * Both are estimated here from the empirical distribution of simulated losses.
 * VaR uses the type-7 empirical quantile. ES uses the identity
 *
 *     ES = VaR + E[(L − VaR)⁺] / (1 − α)
 *
 * rather than averaging every simulated loss at or beyond VaR. The two agree
 * for a continuous distribution, but not when the loss distribution has an
 * atom at the quantile — and a loss distribution with a large point mass at
 * zero is the normal case, not an exotic one. With 60% of outcomes at 0 and
 * 40% at 100, ES at α = 0.5 is 80, because the worst half of outcomes is
 * four-fifths made up of the 100s. Averaging everything at or beyond VaR = 0
 * averages all ten thousand outcomes and returns 40: half the true figure,
 * understating the risk, with nothing to indicate it had happened. The
 * identity above weights the boundary atom correctly and is what makes the
 * documented guarantee ES ≥ VaR actually hold.
 *
 * Each estimate carries Monte Carlo error, which is reported.
 * Tail estimates need many trials: the number of trials beyond the quantile is
 * reported so an under-powered estimate is visible.
 */
import { normalQuantile } from '../special/gamma';
import { stableSum } from '../core/numeric';
import { EngineError } from '../core/result';
import { mean, quantileSorted, sortedCopy, variance } from '../stats/descriptive';

export interface RiskMetricsInput {
  /** Simulated losses, positive = loss. */
  losses: ArrayLike<number>;
  /** Confidence levels for VaR/ES, e.g. [0.95, 0.99]. */
  levels: number[];
  /** Thresholds whose exceedance probability is reported. */
  thresholds?: number[];
  unit?: string;
}

export interface VarEntry {
  level: number;
  valueAtRisk: number;
  expectedShortfall: number;
  /** Number of simulated trials at or beyond the VaR quantile. */
  tailCount: number;
  /** Approximate standard error of the VaR estimate (order-statistic approximation). */
  varStandardError: number | null;
  /**
   * Standard error of the ES estimate. Derived from the spread of the
   * shortfall excesses, treating the VaR quantile as fixed; the extra
   * uncertainty in the quantile itself is not included, which is stated in
   * the result's limitations.
   */
  esStandardError: number | null;
  warnings: string[];
}

export interface ExceedanceEntry {
  threshold: number;
  probability: number;
  /** Wilson interval for the exceedance probability. */
  low: number;
  high: number;
  count: number;
  /** Expected loss given exceedance; NaN when no trial exceeded. */
  conditionalMean: number;
}

export interface RiskMetricsResult {
  n: number;
  expectedLoss: number;
  expectedLossStandardError: number;
  worstSimulated: number;
  bestSimulated: number;
  probabilityOfAnyLoss: number;
  var: VarEntry[];
  exceedance: ExceedanceEntry[];
  lossConvention: string;
  limitations: string[];
}

export function riskMetrics(input: RiskMetricsInput): RiskMetricsResult {
  const n = input.losses.length;
  if (n < 2) throw new EngineError('At least 2 simulated outcomes are needed to compute risk metrics.', 'insufficient');
  for (const l of input.levels) {
    if (!(l > 0 && l < 1)) throw new EngineError('Each confidence level must be greater than 0 and less than 1.', 'range');
  }
  const sorted = sortedCopy(input.losses);
  const m = mean(input.losses);
  const v = variance(input.losses);
  let anyLoss = 0;
  for (let i = 0; i < n; i++) if (input.losses[i] > 0) anyLoss++;

  const varEntries: VarEntry[] = input.levels.map((level) => {
    const q = quantileSorted(sorted, level);
    // `tail` is reported for context: the simulated values at or beyond the
    // quantile, which is what the user sees listed as the worst outcomes.
    let idx = lowerBound(sorted, q);
    if (idx >= n) idx = n - 1;
    const tail = sorted.subarray(idx);
    const tailCount = tail.length;
    // ES is NOT the mean of that tail. See the module header: when the loss
    // distribution has an atom at the quantile the tail set is larger than the
    // worst (1 − α) share, and its mean is pulled toward the centre. The
    // shortfall identity ES = VaR + E[(L − VaR)⁺] / (1 − α) weights the
    // boundary atom correctly and reduces to the tail mean when there is no
    // atom. `stableSum` keeps the excess sum accurate for large n.
    const excesses = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const over = input.losses[i] - q;
      excesses[i] = over > 0 ? over : 0;
    }
    const meanExcess = stableSum(excesses) / n;
    const es = q + meanExcess / (1 - level);
    const warnings: string[] = [];
    if (tailCount < 30) {
      warnings.push(
        `Only ${tailCount} of ${n.toLocaleString('en-US')} simulated outcomes lie in the ${((1 - level) * 100).toPrecision(3)}% tail, so both figures at this level are imprecise. Increase the number of trials for a usable tail estimate.`,
      );
    }
    if (tailCount === n) {
      warnings.push('Every simulated outcome lies in the tail at this level, which means the level is too low to be informative for this distribution.');
    }
    // Standard error of a sample quantile: √(p(1−p)/n) / f(q), with the density
    // estimated from the spacing of neighbouring order statistics.
    let varSe: number | null = null;
    const k = Math.min(n - 1, Math.max(1, Math.round(level * n)));
    const window = Math.max(1, Math.round(0.02 * n));
    const lo = Math.max(0, k - window);
    const hi = Math.min(n - 1, k + window);
    const spread = sorted[hi] - sorted[lo];
    if (spread > 0) {
      const density = (hi - lo) / n / spread;
      varSe = Math.sqrt((level * (1 - level)) / n) / density;
    }
    // The ES standard error must come from the estimator actually used. The
    // old form, sd(tail)/sqrt(tailCount), belongs to the tail-mean estimator
    // that was replaced above; with an atom at the quantile it divides by a
    // tail count that is far too large and understates the error. ES is
    // q + mean(excess)/(1 − level), so — holding q fixed, which is the usual
    // approximation and is noted in the limitations — its standard error is
    // sd(excess) / (sqrt(n) · (1 − level)).
    let esSe: number | null = null;
    if (n > 1) {
      const excessVar = variance(excesses);
      esSe = Math.sqrt(excessVar / n) / (1 - level);
    }
    return { level, valueAtRisk: q, expectedShortfall: es, tailCount, varStandardError: varSe, esStandardError: esSe, warnings };
  });

  const exceedance: ExceedanceEntry[] = (input.thresholds ?? []).map((threshold) => {
    let count = 0;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if (input.losses[i] > threshold) {
        count++;
        sum += input.losses[i];
      }
    }
    const p = count / n;
    const z = normalQuantile(0.975);
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const centre = (p + z2 / (2 * n)) / denom;
    const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
    return {
      threshold,
      probability: p,
      low: Math.max(0, centre - half),
      high: Math.min(1, centre + half),
      count,
      conditionalMean: count > 0 ? sum / count : NaN,
    };
  });

  return {
    n,
    expectedLoss: m,
    expectedLossStandardError: Math.sqrt(v / n),
    worstSimulated: sorted[n - 1],
    bestSimulated: sorted[0],
    probabilityOfAnyLoss: anyLoss / n,
    var: varEntries,
    exceedance,
    lossConvention: 'Positive values are losses; negative values are gains. Value at Risk at level α is the α-quantile of this loss distribution.',
    limitations: [
      'These figures summarise the model you specified. They cannot capture a risk the model does not contain — an event outside the chosen distributions, a change in the underlying process, or a dependency that was not modelled.',
      'Value at Risk tells you a threshold that is exceeded with probability 1 − α. It says nothing about the size of the loss when that happens; Expected Shortfall answers that.',
      'Tail figures are estimated from a finite number of simulated outcomes, so the extreme quantiles are the least reliable numbers here.',
      'No outcome is impossible merely because it did not occur in these trials.',
      'Expected Shortfall uses the identity ES = VaR + E[(L − VaR)⁺] / (1 − α), which weights an atom at the quantile correctly. Its standard error treats the VaR quantile as fixed, so it slightly understates the total uncertainty when the quantile itself is poorly determined.',
    ],
  };
}

function lowerBound(sorted: ArrayLike<number>, value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Exact VaR and ES for a parametric loss distribution, used to check the
 * empirical estimates and to show the difference between a model-based and a
 * simulation-based figure.
 */
export function parametricNormalRisk(mu: number, sigma: number, level: number): { valueAtRisk: number; expectedShortfall: number; method: string } {
  if (!(sigma > 0)) throw new EngineError('Standard deviation must be greater than 0.', 'range');
  const z = normalQuantile(level);
  const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  return {
    valueAtRisk: mu + sigma * z,
    // ES for the normal: μ + σ·φ(z)/(1−α)
    expectedShortfall: mu + (sigma * phi) / (1 - level),
    method: `Closed form for a normal loss distribution: VaR = μ + σ·Φ⁻¹(α); ES = μ + σ·φ(Φ⁻¹(α))/(1 − α).`,
  };
}

export interface RiskRegisterEntry {
  id: string;
  label: string;
  /** Probability the risk event occurs in the horizon. */
  probability: number;
  /** Source of the probability: a user estimate or a computed figure. */
  probabilitySource: 'estimate' | 'data' | 'model';
  /** Impact if it occurs, in the chosen unit. */
  impact: number;
  impactSource: 'estimate' | 'data' | 'model';
  /** Optional mitigation: reduced probability and/or impact, plus its cost. */
  mitigation?: { label: string; probability: number; impact: number; cost: number };
  notes?: string;
}

export interface RiskRegisterResult {
  entries: {
    entry: RiskRegisterEntry;
    expectedLoss: number;
    mitigatedExpectedLoss: number | null;
    /** Expected loss avoided minus the cost of mitigation. */
    netBenefit: number | null;
    share: number;
  }[];
  totalExpectedLoss: number;
  /** Probability at least one of the risks occurs, under the stated assumption. */
  probabilityAtLeastOne: number;
  independenceAssumed: boolean;
  limitations: string[];
}

/**
 * Expected-value summary of a list of risks. The combined "at least one"
 * probability requires an assumption about how the risks relate; independence
 * is used and labelled, with the bounds that hold without it also available
 * from the two-event tools.
 */
export function analyseRiskRegister(entries: RiskRegisterEntry[], assumeIndependent = true): RiskRegisterResult {
  if (!entries.length) throw new EngineError('Add at least one risk.', 'required');
  for (const e of entries) {
    if (!(e.probability >= 0 && e.probability <= 1)) {
      throw new EngineError(`${e.label}: probability must be between 0 and 1.`, 'range');
    }
    if (!Number.isFinite(e.impact)) throw new EngineError(`${e.label}: impact must be a finite number.`, 'finite');
    if (e.mitigation) {
      if (!(e.mitigation.probability >= 0 && e.mitigation.probability <= 1)) {
        throw new EngineError(`${e.label}: mitigated probability must be between 0 and 1.`, 'range');
      }
      if (!Number.isFinite(e.mitigation.impact) || !Number.isFinite(e.mitigation.cost)) {
        throw new EngineError(`${e.label}: mitigated impact and cost must be finite numbers.`, 'finite');
      }
    }
  }
  const rows = entries.map((entry) => {
    const expectedLoss = entry.probability * entry.impact;
    const mitigated = entry.mitigation ? entry.mitigation.probability * entry.mitigation.impact : null;
    return {
      entry,
      expectedLoss,
      mitigatedExpectedLoss: mitigated,
      netBenefit: mitigated === null ? null : expectedLoss - mitigated - entry.mitigation!.cost,
      share: 0,
    };
  });
  const total = rows.reduce((a, r) => a + r.expectedLoss, 0);
  for (const r of rows) r.share = total !== 0 ? r.expectedLoss / total : NaN;
  rows.sort((a, b) => b.expectedLoss - a.expectedLoss);
  // P(at least one) under independence = 1 − Π(1 − pᵢ), computed in log space.
  let logNone = 0;
  for (const e of entries) logNone += Math.log1p(-e.probability);
  const atLeastOne = assumeIndependent ? -Math.expm1(logNone) : Math.min(1, entries.reduce((a, e) => a + e.probability, 0));
  return {
    entries: rows,
    totalExpectedLoss: total,
    probabilityAtLeastOne: atLeastOne,
    independenceAssumed: assumeIndependent,
    limitations: [
      'Expected loss is probability × impact. It is a long-run average, not a prediction of what will happen. A risk with a 1% chance of a £1,000,000 loss and one with a certain £10,000 loss have the same expected loss but are not the same situation.',
      assumeIndependent
        ? 'The combined probability that at least one risk occurs assumes the risks are independent. Risks that share a common cause occur together more often than this figure implies.'
        : 'Without independence, only the bound P(at least one) ≤ Σ pᵢ is available, and that is what is shown.',
      `Probabilities marked as estimates are judgements you supplied, not measurements. ${entries.filter((e) => e.probabilitySource === 'estimate').length} of ${entries.length} risk probabilities are so marked.`,
      'Mitigation figures assume the mitigation works as described and introduces no new risk of its own.',
    ],
  };
}
