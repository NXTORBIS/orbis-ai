/**
 * Resampling simulation models: the bootstrap and the permutation test.
 *
 * Both are implemented as simulation models so they reuse the runner's
 * progress reporting, cancellation, seeding and result summarisation.
 */
import type { Issue } from '../core/result';
import type { PreparedModel, SimulationModelDef } from '../simulation/types';
import { mean, quantileSorted, sortedCopy, variance } from './descriptive';

export type BootstrapStatistic = 'mean' | 'median' | 'sd' | 'q25' | 'q75' | 'trimmedMean10';

export const BOOTSTRAP_STATISTICS: { id: BootstrapStatistic; label: string }[] = [
  { id: 'mean', label: 'Mean' },
  { id: 'median', label: 'Median' },
  { id: 'sd', label: 'Standard deviation' },
  { id: 'q25', label: '25th percentile' },
  { id: 'q75', label: '75th percentile' },
  { id: 'trimmedMean10', label: '10% trimmed mean' },
];

export interface BootstrapConfig {
  data: number[];
  statistic: BootstrapStatistic;
  /** Resample size; defaults to the original sample size. */
  resampleSize?: number;
}

export function computeStatistic(xs: ArrayLike<number>, stat: BootstrapStatistic, sorted?: Float64Array): number {
  switch (stat) {
    case 'mean':
      return mean(xs);
    case 'sd':
      return Math.sqrt(variance(xs));
    case 'median':
      return quantileSorted(sorted ?? sortedCopy(xs), 0.5);
    case 'q25':
      return quantileSorted(sorted ?? sortedCopy(xs), 0.25);
    case 'q75':
      return quantileSorted(sorted ?? sortedCopy(xs), 0.75);
    case 'trimmedMean10': {
      const s = sorted ?? sortedCopy(xs);
      const n = s.length;
      const cut = Math.floor(n * 0.1);
      if (n - 2 * cut <= 0) return mean(s);
      return mean(s.subarray(cut, n - cut));
    }
  }
}

export const bootstrapModel: SimulationModelDef<BootstrapConfig> = {
  id: 'bootstrap',
  name: 'Bootstrap resampling',
  description:
    'Repeatedly draws samples of the same size from the observed data, with replacement, and recomputes the statistic. The spread of those values estimates how much the statistic would vary across repeated samples from the same population.',
  validate: (c) => {
    const issues: Issue[] = [];
    if (!Array.isArray(c?.data) || c.data.length < 2) {
      issues.push({ code: 'required', field: 'data', message: 'Bootstrap needs at least 2 observations.' });
    } else {
      if (c.data.length > 500_000) issues.push({ code: 'limit', field: 'data', message: 'At most 500,000 observations are supported.' });
      if (c.data.some((x) => !Number.isFinite(x))) {
        issues.push({ code: 'finite', field: 'data', message: 'All observations must be finite numbers. Remove or impute missing values first.' });
      }
    }
    if (!BOOTSTRAP_STATISTICS.some((s) => s.id === c?.statistic)) {
      issues.push({ code: 'unknown', field: 'statistic', message: 'Choose a statistic to bootstrap.' });
    }
    if (c?.resampleSize !== undefined && (!Number.isInteger(c.resampleSize) || c.resampleSize < 1)) {
      issues.push({ code: 'range', field: 'resampleSize', message: 'Resample size must be a whole number of at least 1.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const data = Float64Array.from(c.data);
    const n = c.resampleSize ?? data.length;
    const buf = new Float64Array(n);
    const sortedBuf = new Float64Array(n);
    const needsSort = c.statistic !== 'mean' && c.statistic !== 'sd';
    const observed = computeStatistic(data, c.statistic);
    const label = BOOTSTRAP_STATISTICS.find((s) => s.id === c.statistic)!.label;
    return {
      outputs: [{ key: 'statistic', label: `Bootstrap ${label.toLowerCase()}`, kind: 'continuous' }],
      theoretical: {
        statistic: {
          mean: observed,
          source: `The statistic computed on the original sample is ${observed.toPrecision(6)}. The bootstrap distribution is centred near this value; the difference between its mean and this value estimates the bias of the statistic.`,
        },
      },
      assumptions: [
        `The observed sample of ${data.length} value(s) is treated as representative of the population. The bootstrap cannot correct a biased or non-representative sample.`,
        'Observations are assumed independent. For time series, clustered or otherwise dependent data, an ordinary bootstrap understates the uncertainty.',
        ...(n !== data.length ? [`Resamples use ${n} values rather than the original ${data.length}, so the spread is not directly comparable to the sampling variability of the original sample size.`] : []),
      ],
      procedure: `Each repetition draws ${n} value(s) with replacement from the ${data.length} observed value(s) and recomputes the ${label.toLowerCase()}.`,
      runTrial(rng, out) {
        const m = data.length;
        for (let i = 0; i < n; i++) buf[i] = data[Math.floor(rng.uniform() * m)];
        if (needsSort) {
          sortedBuf.set(buf);
          sortedBuf.sort();
          out[0] = computeStatistic(buf, c.statistic, sortedBuf);
        } else {
          out[0] = computeStatistic(buf, c.statistic);
        }
      },
    };
  },
};

export interface PermutationConfig {
  groupA: number[];
  groupB: number[];
  statistic: 'meanDifference' | 'medianDifference';
  /** Observed value of the statistic, recomputed here for the p-value. */
  alternative: 'two-sided' | 'greater' | 'less';
}

export const permutationTestModel: SimulationModelDef<PermutationConfig> = {
  id: 'permutation-test',
  name: 'Permutation test',
  description:
    'Tests whether two groups differ by repeatedly shuffling the group labels. If the labels carry no information, the observed difference should look typical among the shuffled differences.',
  validate: (c) => {
    const issues: Issue[] = [];
    for (const [name, g] of [['groupA', c?.groupA], ['groupB', c?.groupB]] as const) {
      if (!Array.isArray(g) || g.length < 2) {
        issues.push({ code: 'required', field: name, message: `${name === 'groupA' ? 'Group A' : 'Group B'} needs at least 2 observations.` });
      } else if (g.some((x) => !Number.isFinite(x))) {
        issues.push({ code: 'finite', field: name, message: `${name === 'groupA' ? 'Group A' : 'Group B'} contains a value that is not a finite number.` });
      }
    }
    if (!['meanDifference', 'medianDifference'].includes(c?.statistic)) {
      issues.push({ code: 'unknown', field: 'statistic', message: 'Choose a test statistic.' });
    }
    if (!['two-sided', 'greater', 'less'].includes(c?.alternative)) {
      issues.push({ code: 'unknown', field: 'alternative', message: 'Choose an alternative hypothesis.' });
    }
    return issues;
  },
  prepare: (c): PreparedModel => {
    const nA = c.groupA.length;
    const all = Float64Array.from([...c.groupA, ...c.groupB]);
    const n = all.length;
    const pool = Float64Array.from(all);
    const useMedian = c.statistic === 'medianDifference';
    const statOf = (a: Float64Array, b: Float64Array) =>
      useMedian ? quantileSorted(sortedCopy(a), 0.5) - quantileSorted(sortedCopy(b), 0.5) : mean(a) - mean(b);
    const observed = statOf(Float64Array.from(c.groupA), Float64Array.from(c.groupB));
    const bufA = new Float64Array(nA);
    const bufB = new Float64Array(n - nA);
    return {
      outputs: [
        { key: 'difference', label: `Shuffled ${useMedian ? 'median' : 'mean'} difference (A − B)`, kind: 'continuous' },
        {
          key: 'asExtreme',
          label: `Shuffled difference at least as extreme as the observed ${observed.toPrecision(4)}`,
          kind: 'indicator',
        },
      ],
      theoretical: {
        difference: { mean: 0, source: 'Under the null hypothesis that the labels are irrelevant, the expected shuffled difference is 0.' },
      },
      assumptions: [
        'Null hypothesis: the two groups are exchangeable — every assignment of the observed values to the two group sizes is equally likely.',
        'The proportion of shuffles at least as extreme as the observed difference is the Monte Carlo p-value. It is itself an estimate, with the Monte Carlo interval shown beside it.',
        'A small p-value says the observed difference would be unusual if the labels were irrelevant. It does not say how large the real difference is, nor that the grouping caused it.',
      ],
      procedure: `Each repetition shuffles the ${n} pooled value(s), splits them into groups of ${nA} and ${n - nA}, and records the ${useMedian ? 'median' : 'mean'} difference.`,
      runTrial(rng, out) {
        // Partial Fisher–Yates: shuffle only the first nA positions we need.
        for (let i = 0; i < n - 1; i++) {
          const j = i + Math.floor(rng.uniform() * (n - i));
          const t = pool[i];
          pool[i] = pool[j];
          pool[j] = t;
        }
        for (let i = 0; i < nA; i++) bufA[i] = pool[i];
        for (let i = nA; i < n; i++) bufB[i - nA] = pool[i];
        const d = statOf(bufA, bufB);
        out[0] = d;
        out[1] =
          c.alternative === 'two-sided'
            ? Math.abs(d) >= Math.abs(observed) - 1e-12
              ? 1
              : 0
            : c.alternative === 'greater'
              ? d >= observed - 1e-12
                ? 1
                : 0
              : d <= observed + 1e-12
                ? 1
                : 0;
      },
    };
  },
};
