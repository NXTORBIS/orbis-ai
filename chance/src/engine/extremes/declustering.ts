/**
 * Runs declustering and the extremal index.
 *
 * Threshold models assume exceedances are independent. Real series cluster —
 * one storm gives several consecutive exceedances — and treating a cluster as
 * several independent extremes overstates how often extremes happen and
 * understates how uncertain the fit is.
 *
 * Runs declustering (Smith & Weissman 1994): a new cluster begins when at
 * least `runLength` consecutive observations fall below the threshold. Only
 * each cluster's maximum is kept, and those maxima are the data for a GPD fit.
 *
 * The extremal index θ ∈ (0, 1] is estimated by the runs estimator
 * θ̂ = (number of clusters)/(number of exceedances); 1/θ is the mean cluster
 * size, so θ = 1 means no clustering.
 */
import { type EngineResult, type Explanation, fail, ok, Validator } from '../core/result';

export interface Cluster {
  /** Index of the first exceedance in the cluster, in the original series. */
  startIndex: number;
  /** Index of the last exceedance in the cluster. */
  endIndex: number;
  /** Index at which the cluster maximum occurred. */
  peakIndex: number;
  /** The cluster maximum. */
  peak: number;
  /** Number of exceedances in the cluster. */
  size: number;
}

export interface DeclusterResult {
  threshold: number;
  runLength: number;
  /** Raw number of observations above the threshold. */
  exceedanceCount: number;
  clusters: Cluster[];
  /** Cluster maxima, in time order; these are the declustered exceedances. */
  clusterMaxima: number[];
  /** Runs estimate of the extremal index θ = clusters / exceedances. */
  extremalIndex: number;
  /** Mean cluster size 1/θ. */
  meanClusterSize: number;
  explanation: Explanation;
}

export function runsDecluster(
  series: ArrayLike<number>,
  options: { threshold: number; runLength?: number },
): EngineResult<DeclusterResult> {
  const v = new Validator();
  v.finite(options.threshold, 'threshold', 'Threshold');
  const runLength = options.runLength ?? 1;
  v.integer(runLength, 'runLength', 'Run length', 1);
  if (series.length === 0) v.add('No series was supplied.', 'series', 'required');
  if (!v.valid) return fail(v.issues);

  const u = options.threshold;
  const clusters: Cluster[] = [];
  let current: Cluster | null = null;
  let belowRun = 0;
  let exceedanceCount = 0;

  for (let i = 0; i < series.length; i++) {
    const x = series[i];
    if (!Number.isFinite(x)) {
      // A gap in the record ends any open cluster: dependence cannot be judged across it.
      belowRun = runLength;
      if (current) {
        clusters.push(current);
        current = null;
      }
      continue;
    }
    if (x > u) {
      exceedanceCount++;
      if (current === null || belowRun >= runLength) {
        if (current !== null) clusters.push(current);
        current = { startIndex: i, endIndex: i, peakIndex: i, peak: x, size: 1 };
      } else {
        current.endIndex = i;
        current.size++;
        if (x > current.peak) {
          current.peak = x;
          current.peakIndex = i;
        }
      }
      belowRun = 0;
    } else {
      belowRun++;
    }
  }
  if (current !== null) clusters.push(current);

  if (exceedanceCount === 0) {
    return fail(
      `No observation in the series exceeds the threshold ${u}, so there is nothing to decluster. Lower the threshold.`,
    );
  }

  const theta = clusters.length / exceedanceCount;
  return ok({
    threshold: u,
    runLength,
    exceedanceCount,
    clusters,
    clusterMaxima: clusters.map((c) => c.peak),
    extremalIndex: theta,
    meanClusterSize: 1 / theta,
    explanation: {
      method: 'Runs declustering with the runs estimator of the extremal index',
      formula: 'θ̂ = (number of clusters) / (number of exceedances); mean cluster size = 1/θ̂',
      steps: [
        { label: 'Exceedances above the threshold', value: String(exceedanceCount) },
        { label: 'Clusters after declustering', value: String(clusters.length) },
        { label: 'Run length separating clusters', value: String(runLength) },
        { label: 'Extremal index θ̂', value: theta.toPrecision(5) },
      ],
      assumptions: [
        'Observations are in time order and equally spaced; the run length is counted in observations, not in time.',
        'Two exceedances separated by at least the run length belong to different extreme events.',
      ],
      limitations: [
        'The run length is a judgement call in the same way the threshold is. A longer run merges more exceedances into one event, lowers the exceedance rate and lengthens every return period computed from it.',
        'Declustering throws away data: only the cluster maxima are used, so the fit has fewer effective observations and wider intervals — which is the honest consequence of dependence, not a cost to avoid.',
      ],
      exactness: 'empirical',
    },
  });
}
