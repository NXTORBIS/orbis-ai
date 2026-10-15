/**
 * Changepoint and anomaly detection.
 *
 * Both are reported with the caveat that matters most: the NUMBER of
 * changepoints found is a function of the penalty, not of the data alone.
 * Halving the penalty will generally find more.
 */
import { EngineError } from '../core/result';
import { stableSum } from '../core/numeric';
import { explain } from './types';
import { checkSeries, meanOf } from './util';

export interface CusumResult {
  /** Standardised cumulative sums of deviations from the overall mean. */
  cusum: number[];
  /** Max |cusum|, the test statistic. */
  statistic: number;
  /** Index at which the maximum occurs: the single most likely change point. */
  argmax: number;
  /** Critical values of the Kolmogorov-type limiting distribution of sup|B⁰|. */
  criticalValues: { level: number; value: number }[];
  rejectAt: { level: number; reject: boolean }[];
  interpretation: string;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * CUSUM test for a change in mean.
 *
 * S_k = (1/(σ√n)) Σ_{t≤k} (y_t − ȳ) converges to a Brownian bridge under the
 * null of a constant mean with i.i.d. errors, so sup_k |S_k| is compared with
 * the Kolmogorov distribution quantiles 1.224 / 1.358 / 1.628 at 10% / 5% / 1%.
 */
export function cusum(series: ArrayLike<number>, options: { longRunVariance?: number } = {}): CusumResult {
  const y = checkSeries(series, 10, 'series');
  const n = y.length;
  const m = meanOf(y);
  const d = y.map((v) => v - m);
  const s2 = options.longRunVariance ?? stableSum(d.map((v) => v * v)) / n;
  if (!(s2 > 0)) throw new EngineError('The series has zero variance, so no CUSUM statistic is defined.', 'degenerate');
  const sd = Math.sqrt(s2);
  const c = new Array<number>(n).fill(0);
  let run = 0;
  for (let t = 0; t < n; t++) {
    run += d[t];
    c[t] = run / (sd * Math.sqrt(n));
  }
  let argmax = 0;
  for (let t = 1; t < n; t++) if (Math.abs(c[t]) > Math.abs(c[argmax])) argmax = t;
  const stat = Math.abs(c[argmax]);
  const criticalValues = [
    { level: 0.1, value: 1.224 },
    { level: 0.05, value: 1.358 },
    { level: 0.01, value: 1.628 },
  ];
  const rejectAt = criticalValues.map((cv) => ({ level: cv.level, reject: stat > cv.value }));
  const reject5 = rejectAt.find((r) => r.level === 0.05)?.reject ?? false;
  return {
    cusum: c,
    statistic: stat,
    argmax,
    criticalValues,
    rejectAt,
    interpretation: reject5
      ? `sup|S| = ${stat.toFixed(4)} exceeds the 5% critical value 1.358: a change in mean is indicated, most likely around index ${argmax}.`
      : `sup|S| = ${stat.toFixed(4)} does not exceed the 5% critical value 1.358: no change in mean is detected. The largest excursion is at index ${argmax}, which is where a change would be if there were one.`,
    explanation: explain('CUSUM test for a change in mean (Brownian-bridge limit)', 'numerical', {
      formula: 'S_k = Σ_{t≤k}(y_t − ȳ) / (σ̂ √n) ;  statistic = sup_k |S_k|',
      steps: [
        { label: 'Observations', value: String(n) },
        { label: 'sup|S|', value: stat.toFixed(6) },
        { label: 'Location of the maximum', value: String(argmax) },
      ],
      assumptions: [
        'The errors are serially uncorrelated. On an autocorrelated series the CUSUM rejects far too often — pass a long-run variance estimate to correct for that.',
        'The critical values are the tabulated asymptotic Kolmogorov quantiles of sup|B⁰|, not normal quantiles.',
      ],
      limitations: [
        'CUSUM detects at most one change and is weak against two offsetting changes, which can cancel in the cumulative sum.',
        'The location of the maximum is a point estimate with no interval attached.',
      ],
    }),
    warnings: ['A CUSUM on an autocorrelated series rejects spuriously. Test the series for autocorrelation first, or supply a long-run variance.'],
  };
}

export interface ChangepointResult {
  /** 0-based indices of the first observation of each new segment. */
  changepoints: number[];
  /** Segment boundaries with their means and lengths. */
  segments: { start: number; end: number; length: number; mean: number; sd: number }[];
  /** The penalty actually applied per changepoint. */
  penalty: number;
  penaltyRule: string;
  method: 'pelt' | 'binary-segmentation';
  /** Total cost of the chosen segmentation. */
  cost: number;
  /** How the count changes as the penalty is scaled, so the dependence is visible. */
  sensitivity: { penaltyMultiplier: number; penalty: number; count: number }[];
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/** Cumulative sums for O(1) segment costs. */
function cumulative(y: number[]): { s: number[]; ss: number[] } {
  const n = y.length;
  const s = new Array<number>(n + 1).fill(0);
  const ss = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    s[i + 1] = s[i] + y[i];
    ss[i + 1] = ss[i] + y[i] * y[i];
  }
  return { s, ss };
}

/** Gaussian change-in-mean cost of y[a..b) with σ² profiled out. */
function segmentCost(c: { s: number[]; ss: number[] }, a: number, b: number): number {
  const len = b - a;
  if (len <= 0) return Infinity;
  const sum = c.s[b] - c.s[a];
  const sumSq = c.ss[b] - c.ss[a];
  const rss = sumSq - (sum * sum) / len;
  // len·log(RSS/len) is the profiled −2 log-likelihood up to constants; guard
  // the degenerate zero-RSS segment so a constant run does not produce −∞.
  return len * Math.log(Math.max(rss / len, 1e-300));
}

/**
 * PELT (Killick et al. 2012) exact optimal partitioning with pruning, for a
 * change in mean with unknown variance. The penalty defaults to the BIC-style
 * 2·log n per changepoint; the MBIC alternative penalises many changepoints
 * more heavily.
 */
export function detectChangepoints(
  series: ArrayLike<number>,
  options: { penalty?: number; penaltyRule?: 'bic' | 'mbic' | 'aic'; minSegment?: number; method?: 'pelt' | 'binary-segmentation'; maxChangepoints?: number } = {},
): ChangepointResult {
  const y = checkSeries(series, 12, 'series');
  const n = y.length;
  const minSeg = options.minSegment ?? 2;
  if (!Number.isInteger(minSeg) || minSeg < 1) throw new EngineError(`The minimum segment length must be a whole number of at least 1 (received ${minSeg}).`, 'range');
  if (2 * minSeg > n) throw new EngineError(`A minimum segment length of ${minSeg} leaves no room for a changepoint in ${n} observations.`, 'too-short');
  const rule = options.penaltyRule ?? 'bic';
  const penalty =
    options.penalty ??
    (rule === 'aic' ? 2 * 2 : rule === 'mbic' ? 3 * Math.log(n) : 2 * Math.log(n));
  if (!(penalty > 0) || !Number.isFinite(penalty)) throw new EngineError(`The changepoint penalty must be a positive finite number (received ${penalty}).`, 'range');
  const method = options.method ?? 'pelt';
  const c = cumulative(y);

  const runPelt = (pen: number): { cps: number[]; cost: number } => {
    const F = new Array<number>(n + 1).fill(Infinity);
    const prev = new Array<number>(n + 1).fill(-1);
    F[0] = -pen;
    let candidates: number[] = [0];
    for (let t = minSeg; t <= n; t++) {
      let bestVal = Infinity;
      let bestTau = -1;
      for (const tau of candidates) {
        if (t - tau < minSeg) continue;
        const val = F[tau] + segmentCost(c, tau, t) + pen;
        if (val < bestVal) {
          bestVal = val;
          bestTau = tau;
        }
      }
      if (bestTau < 0) continue;
      F[t] = bestVal;
      prev[t] = bestTau;
      // Pruning: τ can never be optimal again once F[τ] + C(τ,t) ≥ F[t].
      candidates = candidates.filter((tau) => F[tau] + segmentCost(c, tau, t) <= F[t]);
      candidates.push(t);
    }
    if (!Number.isFinite(F[n])) {
      throw new EngineError(`PELT could not segment the series: no admissible partition with a minimum segment length of ${minSeg} was found.`, 'numerical');
    }
    const cps: number[] = [];
    let t = n;
    while (t > 0) {
      const tau = prev[t];
      if (tau <= 0) break;
      cps.push(tau);
      t = tau;
    }
    cps.reverse();
    return { cps, cost: F[n] };
  };

  const runBinSeg = (pen: number): { cps: number[]; cost: number } => {
    const cps: number[] = [];
    const maxCp = options.maxChangepoints ?? Math.max(1, Math.floor(n / (2 * minSeg)));
    const search = (a: number, b: number): { idx: number; gain: number } | null => {
      const base = segmentCost(c, a, b);
      let best: { idx: number; gain: number } | null = null;
      for (let k = a + minSeg; k <= b - minSeg; k++) {
        const gain = base - segmentCost(c, a, k) - segmentCost(c, k, b);
        if (!best || gain > best.gain) best = { idx: k, gain };
      }
      return best;
    };
    const queue: [number, number][] = [[0, n]];
    while (queue.length > 0 && cps.length < maxCp) {
      let bestSeg: { a: number; b: number; idx: number; gain: number } | null = null;
      for (const [a, b] of queue) {
        const s = search(a, b);
        if (s && s.gain > pen && (!bestSeg || s.gain > bestSeg.gain)) bestSeg = { a, b, idx: s.idx, gain: s.gain };
      }
      if (!bestSeg) break;
      cps.push(bestSeg.idx);
      const i = queue.findIndex(([a, b]) => a === bestSeg.a && b === bestSeg.b);
      queue.splice(i, 1, [bestSeg.a, bestSeg.idx], [bestSeg.idx, bestSeg.b]);
    }
    cps.sort((p, q) => p - q);
    let cost = 0;
    const bounds = [0, ...cps, n];
    for (let i = 0; i < bounds.length - 1; i++) cost += segmentCost(c, bounds[i], bounds[i + 1]) + pen;
    return { cps, cost };
  };

  const run = method === 'pelt' ? runPelt : runBinSeg;
  const { cps, cost } = run(penalty);
  const bounds = [0, ...cps, n];
  const segments = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const a = bounds[i];
    const b = bounds[i + 1];
    const seg = y.slice(a, b);
    const mu = meanOf(seg);
    segments.push({
      start: a,
      end: b - 1,
      length: b - a,
      mean: mu,
      sd: seg.length > 1 ? Math.sqrt(stableSum(seg.map((v) => (v - mu) * (v - mu))) / (seg.length - 1)) : 0,
    });
  }
  const sensitivity = [0.5, 1, 2, 4].map((mult) => {
    try {
      return { penaltyMultiplier: mult, penalty: penalty * mult, count: run(penalty * mult).cps.length };
    } catch {
      return { penaltyMultiplier: mult, penalty: penalty * mult, count: -1 };
    }
  });
  const warnings = [
    `The number of changepoints found is highly penalty-dependent. At ${(0.5).toFixed(1)}× the penalty this series yields ${sensitivity[0].count} changepoint(s); at 1× it yields ${cps.length}; at 4× it yields ${sensitivity[3].count}. Nothing in the data alone fixes the count.`,
    'Changepoint detection assumes independent observations within segments. On an autocorrelated series it finds spurious changepoints, because persistent runs look like level shifts. Fit and remove the dependence first, or interpret the results as descriptive only.',
  ];
  if (cps.length === 0) {
    warnings.push('No changepoint was detected at this penalty. That is not evidence of stability — a gradual drift or a small shift would not be found.');
  }
  return {
    changepoints: cps,
    segments,
    penalty,
    penaltyRule: options.penalty !== undefined ? 'user-supplied' : `${rule.toUpperCase()} (${rule === 'mbic' ? '3 log n' : rule === 'aic' ? '2 × 2' : '2 log n'} per changepoint)`,
    method,
    cost,
    sensitivity,
    explanation: explain(
      method === 'pelt'
        ? 'PELT exact optimal partitioning for a change in mean (Gaussian cost, variance profiled out)'
        : 'Binary segmentation for a change in mean (greedy, not optimal)',
      'numerical',
      {
        formula: 'minimise Σ_segments n_i log(RSS_i / n_i) + penalty × (number of changepoints)',
        steps: [
          { label: 'Observations', value: String(n) },
          { label: 'Penalty per changepoint', value: penalty.toFixed(4) },
          { label: 'Minimum segment length', value: String(minSeg) },
          { label: 'Changepoints found', value: String(cps.length) },
          { label: 'Locations', value: cps.length ? cps.join(', ') : 'none' },
          ...sensitivity.map((s) => ({ label: `Count at ${s.penaltyMultiplier}× penalty`, value: String(s.count) })),
        ],
        assumptions: [
          'Changes are abrupt shifts in the mean; a slow drift is not this model.',
          'Observations are independent within segments with a common variance within each segment.',
        ],
        limitations: [
          method === 'pelt'
            ? 'PELT finds the exact optimum of the penalised cost, but the optimum is only as meaningful as the penalty.'
            : 'Binary segmentation is greedy: an early split that looks good can prevent the optimal pair of later splits from being found.',
          'No confidence interval is given for a changepoint location; the uncertainty is substantial, typically several observations wide.',
          'The detected count is penalty-dependent, as the sensitivity table shows.',
        ],
      },
    ),
    warnings,
  };
}

export type AnomalyKind = 'additive-outlier' | 'level-shift' | 'transient-change';

export interface Anomaly {
  index: number;
  kind: AnomalyKind;
  /** Residual in units of the robust residual scale. */
  zScore: number;
  value: number;
  description: string;
}

export interface AnomalyResult {
  anomalies: Anomaly[];
  /** Robust scale used for the threshold (median absolute deviation × 1.4826). */
  scale: number;
  threshold: number;
  explanation: ReturnType<typeof explain>;
  warnings: string[];
}

/**
 * Classify large residuals into additive outliers, level shifts and transient
 * changes.
 *
 * additive outlier: one large residual, with the series back on track after.
 * level shift:      a large residual followed by a sustained change in level.
 * transient change: a large residual followed by a geometric decay back.
 *
 * The threshold is applied to a ROBUST scale (the median absolute deviation),
 * because the standard deviation is itself inflated by the outliers being
 * looked for.
 */
export function detectAnomalies(
  residuals: ArrayLike<number>,
  options: { threshold?: number; window?: number } = {},
): AnomalyResult {
  const e = checkSeries(residuals, 12, 'residual series');
  const n = e.length;
  const threshold = options.threshold ?? 3.5;
  if (!(threshold > 0)) throw new EngineError(`The anomaly threshold must be positive (received ${threshold}).`, 'range');
  const window = options.window ?? Math.min(6, Math.floor(n / 4));
  const med = [...e].sort((a, b) => a - b)[Math.floor(n / 2)];
  const mad = [...e.map((v) => Math.abs(v - med))].sort((a, b) => a - b)[Math.floor(n / 2)];
  const scale = 1.4826 * mad;
  if (!(scale > 0)) {
    throw new EngineError(
      'The robust scale of the residuals is zero (more than half of them are identical), so no outlier threshold can be set. Nothing is reported rather than flagging everything.',
      'degenerate',
    );
  }
  const anomalies: Anomaly[] = [];
  for (let t = 0; t < n; t++) {
    const z = (e[t] - med) / scale;
    if (Math.abs(z) < threshold) continue;
    // Look at the mean of the following window to classify.
    const after = e.slice(t + 1, Math.min(n, t + 1 + window));
    const sign = Math.sign(z);
    let kind: AnomalyKind = 'additive-outlier';
    if (after.length >= 3) {
      const afterMean = meanOf(after);
      const sameDirection = after.filter((v) => Math.sign(v - med) === sign).length / after.length;
      const sustained = Math.abs((afterMean - med) / scale);
      if (sustained > 0.75 * threshold && sameDirection >= 0.75) kind = 'level-shift';
      else if (Math.abs((after[0] - med) / scale) > 0.4 * threshold && sustained < 0.75 * threshold) kind = 'transient-change';
    }
    anomalies.push({
      index: t,
      kind,
      zScore: z,
      value: e[t],
      description:
        kind === 'additive-outlier'
          ? `A single residual ${Math.abs(z).toFixed(1)} robust scale units from the centre, with the series back on track afterwards: a one-off event, not a change in the process.`
          : kind === 'level-shift'
            ? `A residual ${Math.abs(z).toFixed(1)} units out, followed by a sustained shift in the same direction: the level of the series appears to have changed permanently at this point. Refitting on data that spans this point will give a biased model.`
            : `A residual ${Math.abs(z).toFixed(1)} units out, followed by a decaying return to the previous level: a transient disturbance.`,
    });
  }
  return {
    anomalies,
    scale,
    threshold,
    explanation: explain('Anomaly classification from robust residual thresholds', 'empirical', {
      formula: 'z_t = (e_t − median(e)) / (1.4826 · MAD(e)) ;  flag |z_t| > threshold',
      steps: [
        { label: 'Residuals', value: String(n) },
        { label: 'Robust scale', value: scale.toExponential(6) },
        { label: 'Threshold', value: `${threshold} robust scale units` },
        { label: 'Anomalies flagged', value: String(anomalies.length) },
        ...anomalies.slice(0, 10).map((a) => ({ label: `index ${a.index}`, value: `${a.kind}, z = ${a.zScore.toFixed(2)}` })),
      ],
      assumptions: [
        'The residuals come from a model that already fits the bulk of the data; an anomaly here is relative to that model, not an absolute statement about the observation.',
        'The classification rules are heuristics based on the behaviour of the following few residuals, not a fitted intervention model.',
      ],
      limitations: [
        `With ${n} residuals and a threshold of ${threshold}, roughly ${(n * 2 * (1 - 0.99977)).toFixed(2)} false flags are expected by chance under normality.`,
        'A proper treatment fits an intervention model with a dummy variable for each candidate and tests it. This routine only flags and classifies.',
        'A level shift near the end of the series cannot be distinguished from a run of outliers, because there is no "after" to look at.',
      ],
    }),
    warnings:
      anomalies.some((a) => a.kind === 'level-shift')
        ? ['A level shift was detected. A model fitted across a level shift is misspecified: its residuals will look autocorrelated and its forecasts will be biased towards the old level. Consider splitting the series or adding an intervention term.']
        : [],
  };
}
