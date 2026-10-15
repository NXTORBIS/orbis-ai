/**
 * Hypothesis testing: the tests that need no normality assumption, the tests
 * that compare more than two groups, and the exact tests.
 *
 * Three things this screen refuses to do, because they are the common failures
 * of applied testing:
 *
 *  - It never shows a p-value without saying whether it came from an exact
 *    null distribution or from an asymptotic approximation. The two are
 *    different claims, and at small n the second one is often wrong.
 *  - It never shows a non-significant result without the engine's statement
 *    that failing to reject is not evidence of no effect, together with the
 *    achieved power and the minimum detectable effect. "Not significant" with
 *    n = 12 means almost nothing.
 *  - It never shows a post-hoc comparison without its multiplicity control;
 *    the engine refuses to produce one unadjusted.
 *
 * Every number on this screen comes from `engine/nonparametric` or
 * `engine/stats/tests`. Nothing here computes a result.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  adjustPValues,
  bartlettTest,
  bootstrapIntervalSteps,
  brunnerMunzelTest,
  cochranArmitageTrend,
  compareAdjustments,
  dunnTest,
  fisherExact2x2,
  flignerKilleenTest,
  friedmanTest,
  gamesHowell,
  kruskalWallisTest,
  ksTwoSampleTest,
  leveneTest,
  mannWhitneyNullDistribution,
  mannWhitneyUTest,
  mcnemarTest,
  meanDifference,
  moodMedianTest,
  nemenyiTest,
  oneWayAnovaTest,
  permutationTestSteps,
  sensitivity,
  signTest,
  signedRankNullDistribution,
  tukeyHsd,
  twoByTwoEffects,
  welchAnovaTest,
  wilcoxonSignedRankTest,
  type Alternative,
  type BootstrapResult,
  type GroupInput,
  type MultiplicityMethod,
  type NonparametricResult,
  type PairwiseComparison,
  type PermutationProgress,
  type PostHocResult,
  type PowerDesign,
  type SensitivityStatement,
} from '../../engine/nonparametric';
import {
  chiSquareIndependence,
  correlationTest,
  oneSampleTTest,
  pairedTTest,
  welchTTest,
  type TestResult,
} from '../../engine/stats/tests';
import { EXACTNESS_LABEL, EngineError, type Exactness, type Explanation } from '../../engine/core/result';
import { histogram, mean, quantile, quantileSorted, sortedCopy, variance } from '../../engine/stats/descriptive';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  Disclosure,
  KeyValueList,
  Notice,
  NumberField,
  RawNumberInput,
  RunningState,
  SelectField,
  Segmented,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { HistogramChart } from '../../ui/charts/charts';
import { BoxPlot, type BoxGroup } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { Icon } from '../../ui/icons';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/* ------------------------------------------------------------------ config */

export type HypothesisTestId =
  | 'mann-whitney'
  | 'brunner-munzel'
  | 'welch-t'
  | 'pooled-t'
  | 'ks-two-sample'
  | 'mood-median'
  | 'wilcoxon-signed-rank'
  | 'sign'
  | 'paired-t'
  | 'one-sample-t'
  | 'correlation'
  | 'mcnemar'
  | 'one-way-anova'
  | 'welch-anova'
  | 'kruskal-wallis'
  | 'friedman'
  | 'levene'
  | 'bartlett'
  | 'fligner-killeen'
  | 'fisher-exact'
  | 'chi-square'
  | 'cochran-armitage'
  | 'permutation';

export interface HypothesisTestsConfig {
  /** Independent-groups data as "value, group" rows. Parsed in a useMemo. */
  data: string;
  /**
   * Repeated-measures data: one row per subject/block, one comma-separated
   * value per condition. The paired tests use the first two columns; Friedman
   * and Nemenyi use all of them.
   */
  repeated: string;
  /** Labels for the repeated-measures columns, comma separated. */
  repeatedLabels: string;
  /** 2 × 2 counts in reading order: row1col1, row1col2, row2col1, row2col2. */
  table: number[];
  /** Cochran–Armitage: successes and totals per ordered group. */
  trendSuccesses: string;
  trendTotals: string;
  test: HypothesisTestId;
  alternative: Alternative;
  /** Confidence level; the engine takes α = 1 − level. */
  level: number;
  /** Group labels selected for the two-sample and resampling tests. */
  groupA: string;
  groupB: string;
  /** Null value for the one-sample t test. */
  nullValue: number;
  leveneCenter: 'mean' | 'median';
  mcnemarVariant: 'exact' | 'mid-p' | 'chi-square';
  postHoc: 'tukey' | 'dunn' | 'games-howell' | 'nemenyi';
  postHocAdjust: MultiplicityMethod;
  multiplicityMethod: MultiplicityMethod;
  /** Free set of p-values for the multiplicity section. */
  multiplicityInput: string;
  permutationStatistic: 'mean-difference' | 'median-difference';
  permutationSamples: number;
  permutationSeed: string;
  bootstrapStatistic: 'mean' | 'median' | 'sd' | 'iqr';
  bootstrapResamples: number;
  bootstrapSeed: string;
  showAllAdjustments: boolean;
}

/**
 * A synthetic four-group dataset, chosen so the default screen is informative
 * rather than empty: the groups are ordered in location, cross-group ties are
 * present (so the tie correction is exercised and the exact route is ruled
 * out), and the spreads differ enough that the classic-versus-Welch question
 * is a real one. It is illustrative data, not a measurement of anything.
 */
const DEFAULT_DATA = `# Reaction time in ms by dose group (synthetic illustrative data).
# One row per observation: value, group. Lines starting with # are ignored.
412, Placebo
428, Placebo
405, Placebo
437, Placebo
419, Placebo
424, Placebo
433, Placebo
408, Placebo
441, Placebo
416, Placebo
422, Placebo
430, Placebo
401, Low dose
418, Low dose
395, Low dose
423, Low dose
409, Low dose
414, Low dose
426, Low dose
398, Low dose
431, Low dose
405, Low dose
412, Low dose
420, Low dose
383, Mid dose
397, Mid dose
376, Mid dose
402, Mid dose
389, Mid dose
394, Mid dose
400, Mid dose
371, Mid dose
405, Mid dose
386, Mid dose
392, Mid dose
398, Mid dose
358, High dose
372, High dose
351, High dose
379, High dose
365, High dose
369, High dose
377, High dose
349, High dose
384, High dose
362, High dose
368, High dose
374, High dose`;

const DEFAULT_REPEATED = `# One row per subject; one value per condition.
14.2, 12.8, 11.5
15.1, 13.9, 12.2
13.6, 13.1, 12.9
16.0, 14.2, 12.4
12.9, 12.0, 11.1
15.5, 14.8, 13.0
14.7, 13.3, 12.6
13.2, 12.5, 12.7
16.4, 15.0, 13.8
14.0, 13.6, 12.1`;

export const HYPOTHESIS_TESTS_DEFAULT: HypothesisTestsConfig = {
  data: DEFAULT_DATA,
  repeated: DEFAULT_REPEATED,
  repeatedLabels: 'Baseline, Week 4, Week 8',
  table: [8, 2, 3, 9],
  trendSuccesses: '2, 5, 9, 14',
  trendTotals: '20, 20, 20, 20',
  test: 'kruskal-wallis',
  alternative: 'two-sided',
  level: 0.95,
  groupA: 'Placebo',
  groupB: 'High dose',
  nullValue: 400,
  leveneCenter: 'median',
  mcnemarVariant: 'exact',
  postHoc: 'dunn',
  postHocAdjust: 'holm',
  multiplicityMethod: 'holm',
  multiplicityInput: '0.001, 0.008, 0.019, 0.032, 0.041, 0.20, 0.44',
  permutationStatistic: 'mean-difference',
  permutationSamples: 9999,
  permutationSeed: 'orbis-permutation',
  bootstrapStatistic: 'median',
  bootstrapResamples: 2000,
  bootstrapSeed: 'orbis-bootstrap',
  showAllAdjustments: false,
};

/* ------------------------------------------------------------- test catalog */

type Family = 'two-sample' | 'paired' | 'multi-group' | 'variance' | 'categorical' | 'resampling';

const FAMILY_LABEL: Record<Family, string> = {
  'two-sample': 'Two independent groups',
  paired: 'Paired or repeated measures',
  'multi-group': 'More than two groups',
  variance: 'Spread rather than location',
  categorical: 'Counts in a table',
  resampling: 'Resampling',
};

interface TestInfo {
  id: HypothesisTestId;
  family: Family;
  label: string;
  question: string;
  /** Which data entry this test reads. */
  source: 'groups' | 'repeated' | 'table' | 'trend';
  usesAlternative: boolean;
}

const TESTS: TestInfo[] = [
  { id: 'mann-whitney', family: 'two-sample', label: 'Mann–Whitney U (Wilcoxon rank-sum)', question: 'Does one group tend to give larger values than the other, making no distributional assumption?', source: 'groups', usesAlternative: true },
  { id: 'brunner-munzel', family: 'two-sample', label: 'Brunner–Munzel', question: 'Same question as Mann–Whitney, but valid when the two groups also differ in spread.', source: 'groups', usesAlternative: true },
  { id: 'welch-t', family: 'two-sample', label: "Welch's t test (unequal variances)", question: 'Do the two means differ, without assuming equal variances?', source: 'groups', usesAlternative: true },
  { id: 'pooled-t', family: 'two-sample', label: 'Equal-variance t test (as F = t², from one-way ANOVA)', question: 'Do the two means differ, assuming equal variances? The engine computes this as a one-way ANOVA on two groups, which is algebraically the same test.', source: 'groups', usesAlternative: false },
  { id: 'ks-two-sample', family: 'two-sample', label: 'Two-sample Kolmogorov–Smirnov', question: 'Do the two distributions differ anywhere — in location, spread or shape?', source: 'groups', usesAlternative: false },
  { id: 'mood-median', family: 'two-sample', label: "Mood's median test", question: 'Do the groups differ in the share of observations above the pooled median? Works for two groups or more.', source: 'groups', usesAlternative: false },
  { id: 'wilcoxon-signed-rank', family: 'paired', label: 'Wilcoxon signed-rank', question: 'Are the paired differences centred away from zero, making no distributional assumption?', source: 'repeated', usesAlternative: true },
  { id: 'sign', family: 'paired', label: 'Sign test', question: 'Do more than half the pairs move in one direction? Uses only the direction, not the size, of each change.', source: 'repeated', usesAlternative: true },
  { id: 'paired-t', family: 'paired', label: 'Paired t test', question: 'Is the mean paired difference non-zero, assuming the differences are roughly normal?', source: 'repeated', usesAlternative: true },
  { id: 'one-sample-t', family: 'paired', label: 'One-sample t test (first column against a null value)', question: 'Does the mean of one column differ from a stated value?', source: 'repeated', usesAlternative: true },
  { id: 'correlation', family: 'paired', label: 'Correlation test (Pearson r)', question: 'Is there a linear relationship between the first two columns?', source: 'repeated', usesAlternative: true },
  { id: 'mcnemar', family: 'paired', label: "McNemar's test", question: 'Did a paired binary outcome change in one direction more than the other?', source: 'table', usesAlternative: true },
  { id: 'one-way-anova', family: 'multi-group', label: 'One-way ANOVA (classic)', question: 'Do the group means differ, assuming equal variances and approximate normality?', source: 'groups', usesAlternative: false },
  { id: 'welch-anova', family: 'multi-group', label: "Welch's ANOVA", question: 'Do the group means differ, without assuming equal variances? The safer default.', source: 'groups', usesAlternative: false },
  { id: 'kruskal-wallis', family: 'multi-group', label: 'Kruskal–Wallis', question: 'Do the groups differ in location, making no distributional assumption?', source: 'groups', usesAlternative: false },
  { id: 'friedman', family: 'multi-group', label: 'Friedman', question: 'Do the conditions differ when every subject is measured under all of them?', source: 'repeated', usesAlternative: false },
  { id: 'levene', family: 'variance', label: "Levene's test", question: 'Do the group variances differ? Median-centred (Brown–Forsythe) is robust to non-normality.', source: 'groups', usesAlternative: false },
  { id: 'bartlett', family: 'variance', label: "Bartlett's test", question: 'Do the group variances differ, assuming normality? More powerful than Levene when normality holds, badly behaved when it does not.', source: 'groups', usesAlternative: false },
  { id: 'fligner-killeen', family: 'variance', label: 'Fligner–Killeen', question: 'Do the group variances differ? A rank-based test, the most robust of the three.', source: 'groups', usesAlternative: false },
  { id: 'fisher-exact', family: 'categorical', label: "Fisher's exact test (2 × 2)", question: 'Is the association in a 2 × 2 table larger than chance, computed exactly?', source: 'table', usesAlternative: true },
  { id: 'chi-square', family: 'categorical', label: 'Chi-square test of independence', question: 'Is the association in a 2 × 2 table larger than chance, by the asymptotic χ² approximation?', source: 'table', usesAlternative: false },
  { id: 'cochran-armitage', family: 'categorical', label: 'Cochran–Armitage trend test', question: 'Does the success proportion rise or fall monotonically across ordered groups?', source: 'trend', usesAlternative: true },
  { id: 'permutation', family: 'resampling', label: 'Permutation test', question: 'Is the observed statistic larger than label-shuffling alone would produce? Makes no distributional assumption at all.', source: 'groups', usesAlternative: true },
];

const MULTIPLICITY_OPTIONS: { value: MultiplicityMethod; label: string }[] = [
  { value: 'bonferroni', label: 'Bonferroni' },
  { value: 'holm', label: 'Holm' },
  { value: 'hochberg', label: 'Hochberg' },
  { value: 'benjamini-hochberg', label: 'Benjamini–Hochberg (FDR)' },
  { value: 'benjamini-yekutieli', label: 'Benjamini–Yekutieli (FDR, any dependence)' },
];

/* -------------------------------------------------------------- parse input */

interface SkippedLine {
  line: number;
  text: string;
  reason: string;
}

interface ParsedGroups {
  groups: { label: string; values: number[] }[];
  skipped: SkippedLine[];
  accepted: number;
  comments: number;
}

/**
 * Pasted data is untrusted: every line is validated, nothing is coerced, and
 * anything that cannot be read is reported with its line number rather than
 * dropped. A silently shortened dataset is a wrong answer.
 */
function parseGroupRows(text: string): ParsedGroups {
  const order: string[] = [];
  const byLabel = new Map<string, number[]>();
  const skipped: SkippedLine[] = [];
  let accepted = 0;
  let comments = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      comments++;
      return;
    }
    const parts = trimmed.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length < 2) {
      skipped.push({ line, text: trimmed, reason: 'no separator: a row needs a value and a group label, e.g. "412, Placebo".' });
      return;
    }
    if (parts.length > 2) {
      skipped.push({ line, text: trimmed, reason: `${parts.length} fields found; a row must have exactly two (value, group).` });
      return;
    }
    const value = Number(parts[0]);
    if (parts[0] === '' || !Number.isFinite(value)) {
      skipped.push({ line, text: trimmed, reason: `"${parts[0]}" is not a finite number.` });
      return;
    }
    const label = parts[1];
    if (!label) {
      skipped.push({ line, text: trimmed, reason: 'the group label is empty.' });
      return;
    }
    if (!byLabel.has(label)) {
      byLabel.set(label, []);
      order.push(label);
    }
    byLabel.get(label)?.push(value);
    accepted++;
  });
  return { groups: order.map((label) => ({ label, values: byLabel.get(label) ?? [] })), skipped, accepted, comments };
}

interface ParsedBlocks {
  blocks: number[][];
  width: number;
  skipped: SkippedLine[];
  comments: number;
}

/** Repeated-measures rows: every accepted row must have the same width. */
function parseBlockRows(text: string): ParsedBlocks {
  const rows: { line: number; values: number[] }[] = [];
  const skipped: SkippedLine[] = [];
  let comments = 0;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) {
      comments++;
      return;
    }
    const parts = trimmed.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length < 2) {
      skipped.push({ line, text: trimmed, reason: 'a row needs at least two condition values separated by commas.' });
      return;
    }
    const values: number[] = [];
    let bad: string | null = null;
    for (const p of parts) {
      const v = Number(p);
      if (p === '' || !Number.isFinite(v)) {
        bad = p;
        break;
      }
      values.push(v);
    }
    if (bad !== null) {
      skipped.push({ line, text: trimmed, reason: `"${bad}" is not a finite number.` });
      return;
    }
    rows.push({ line, values });
  });
  const width = rows.length ? rows[0].values.length : 0;
  const blocks: number[][] = [];
  for (const r of rows) {
    if (r.values.length !== width) {
      skipped.push({ line: r.line, text: r.values.join(', '), reason: `${r.values.length} values, but the first accepted row has ${width}; every subject must be measured under the same conditions.` });
      continue;
    }
    blocks.push(r.values);
  }
  return { blocks, width, skipped, comments };
}

interface ParsedNumbers {
  values: number[];
  skipped: { text: string; reason: string }[];
}

/** A comma-separated list of numbers, with every rejected entry reported. */
function parseNumberList(text: string): ParsedNumbers {
  const values: number[] = [];
  const skipped: { text: string; reason: string }[] = [];
  for (const piece of text.split(/[,;\s]+/)) {
    const t = piece.trim();
    if (!t) continue;
    const v = Number(t);
    if (!Number.isFinite(v)) skipped.push({ text: t, reason: 'not a finite number' });
    else values.push(v);
  }
  return { values, skipped };
}

/* ------------------------------------------------------- generator plumbing */

type RunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

interface RunState<P, R> {
  status: RunStatus;
  progress: P | null;
  result: R | null;
  error: string | null;
}

const IDLE = { status: 'idle' as RunStatus, progress: null, result: null, error: null };

/**
 * Drives one of the engine's generators on the main thread.
 *
 * The engine exposes permutation and bootstrap as generators that yield
 * between chunks precisely so a long run can be interrupted; a synchronous
 * loop could not be. Handing control back through a timeout keeps the Cancel
 * button able to run and the page able to repaint.
 */
function useGeneratorRun<P, R>() {
  const [state, setState] = useState<RunState<P, R>>(() => ({ ...IDLE }) as RunState<P, R>);
  const cancelled = useRef(false);
  const timer = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // Abandon a run in progress when the user leaves this screen: nothing will
  // display the result, and the loop would keep the tab busy.
  useEffect(
    () => () => {
      cancelled.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const start = useCallback(
    (make: () => Generator<P, R, void>) => {
      stopTimer();
      cancelled.current = false;
      setState({ status: 'running', progress: null, result: null, error: null });
      let generator: Generator<P, R, void>;
      try {
        generator = make();
      } catch (e) {
        setState({ status: 'error', progress: null, result: null, error: errorMessage(e) });
        return;
      }
      const pump = () => {
        if (cancelled.current) return;
        let latest: P | null = null;
        try {
          // Several chunks per tick: one timeout per yield would make a long
          // run crawl, while a handful keeps each tick short.
          for (let i = 0; i < 4; i++) {
            const next = generator.next();
            if (next.done) {
              setState({ status: 'done', progress: null, result: next.value, error: null });
              return;
            }
            latest = next.value;
          }
        } catch (e) {
          setState({ status: 'error', progress: null, result: null, error: errorMessage(e) });
          return;
        }
        setState((s) => ({ ...s, progress: latest }));
        timer.current = window.setTimeout(pump, 0);
      };
      pump();
    },
    [stopTimer],
  );

  const cancel = useCallback(() => {
    cancelled.current = true;
    stopTimer();
    setState((s) => (s.status === 'running' ? { ...s, status: 'cancelled' } : s));
  }, [stopTimer]);

  const reset = useCallback(() => {
    cancelled.current = true;
    stopTimer();
    setState({ ...IDLE } as RunState<P, R>);
  }, [stopTimer]);

  return { state, start, cancel, reset };
}

function errorMessage(e: unknown): string {
  if (e instanceof EngineError) return e.issues.map((i) => i.message).join(' ');
  if (e instanceof Error) return e.message;
  return String(e);
}

/* ------------------------------------------------------------- result shape */

/**
 * A `TestResult` from `stats/tests` carries less than a
 * `NonparametricResult`: no route, no tie report, no sensitivity statement.
 * Rather than let those tests escape the honesty rules, the missing parts are
 * filled from the same engine functions the non-parametric tests use —
 * `sensitivity()` for power and the minimum detectable effect — and the route
 * is stated explicitly here with the sample size at which it is trustworthy.
 */
interface Displayed {
  name: string;
  nullHypothesis: string;
  alternativeHypothesis: string;
  statistic: number;
  statisticName: string;
  degreesOfFreedom: number | [number, number] | null;
  pValue: number;
  route: 'exact' | 'asymptotic' | 'monte-carlo';
  routeReason: string;
  exactness: Exactness;
  effectSizes: { name: string; value: number; interpretation: string; interval?: { low: number; high: number; level: number; of: string; method: string } | null }[];
  interval: { low: number; high: number; level: number; of: string; method: string; kind: 'estimate' | 'outcomes' } | null;
  assumptions: string[];
  limitations: string[];
  notes: string[];
  ties: { tiesPresent: boolean; correctionApplied: boolean; tiedGroups: number; detail: string };
  sensitivity: SensitivityStatement;
  diagnostics: Record<string, number>;
}

function fromNonparametric(r: NonparametricResult): Displayed {
  return {
    name: r.name,
    nullHypothesis: r.nullHypothesis,
    alternativeHypothesis: r.alternativeHypothesis,
    statistic: r.statistic,
    statisticName: r.statisticName,
    degreesOfFreedom: r.degreesOfFreedom,
    pValue: r.pValue,
    route: r.pValueRoute,
    routeReason: r.pValueRouteReason,
    exactness: r.exactness,
    effectSizes: r.effectSizes.map((e) => ({ name: e.name, value: e.value, interpretation: e.interpretation, interval: e.interval ?? null })),
    interval: r.interval,
    assumptions: r.assumptions,
    limitations: r.limitations,
    notes: r.notes,
    ties: r.ties,
    sensitivity: r.sensitivity,
    diagnostics: r.diagnostics,
  };
}

function fromTestResult(r: TestResult, level: number, design: PowerDesign, routeReason: string): Displayed {
  return {
    name: r.name,
    nullHypothesis: r.nullHypothesis,
    alternativeHypothesis: r.alternativeHypothesis,
    statistic: r.statistic,
    statisticName: r.statisticName,
    degreesOfFreedom: r.degreesOfFreedom,
    pValue: r.pValue,
    route: 'asymptotic',
    routeReason,
    // The tail probability comes from an incomplete beta / gamma evaluation,
    // not from enumerating a null distribution, so it is numerical.
    exactness: 'numerical',
    effectSizes: r.effectSize ? [{ name: r.effectSize.name, value: r.effectSize.value, interpretation: r.effectSize.interpretation }] : [],
    interval: r.interval ? { ...r.interval, method: 'parametric interval from the test statistic', kind: 'estimate' } : null,
    assumptions: r.assumptions,
    limitations: r.limitations,
    notes: r.notes,
    ties: { tiesPresent: false, correctionApplied: false, tiedGroups: 0, detail: 'This test uses the values themselves, not their ranks, so no tie correction arises.' },
    sensitivity: sensitivity(r.pValue, 1 - level, design),
    diagnostics: {},
  };
}

/* ------------------------------------------------------------------ helpers */

function groupStats(values: number[]): { n: number; mean: number; median: number; sd: number } {
  return {
    n: values.length,
    mean: values.length ? mean(values) : NaN,
    median: values.length ? quantile(values, 0.5) : NaN,
    sd: values.length > 1 ? Math.sqrt(variance(values)) : NaN,
  };
}

/** Tukey box: whiskers at the furthest point inside 1.5 × IQR, rest as outliers. */
function boxFor(label: string, values: number[]): BoxGroup | null {
  if (values.length < 2) return null;
  const sorted = sortedCopy(values);
  const q1 = quantileSorted(sorted, 0.25);
  const med = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lowFence = q1 - 1.5 * iqr;
  const highFence = q3 + 1.5 * iqr;
  const inside: number[] = [];
  const outliers: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    if (v < lowFence || v > highFence) outliers.push(v);
    else inside.push(v);
  }
  if (!inside.length) return null;
  return {
    label,
    min: inside[0],
    q1,
    median: med,
    q3,
    max: inside[inside.length - 1],
    outliers,
    mean: mean(values),
    n: values.length,
  };
}

function pmfBins(pmf: Float64Array, counts: Float64Array, total: number): { x0: number; x1: number; count: number; density: number; proportion: number }[] {
  const bins: { x0: number; x1: number; count: number; density: number; proportion: number }[] = [];
  for (let k = 0; k < pmf.length; k++) {
    bins.push({ x0: k - 0.5, x1: k + 0.5, count: counts[k], density: pmf[k], proportion: total > 0 ? counts[k] / total : 0 });
  }
  return bins;
}

const STATISTIC_FUNCTIONS: Record<HypothesisTestsConfig['bootstrapStatistic'], { label: string; fn: (xs: number[]) => number }> = {
  mean: { label: 'Mean', fn: (xs) => mean(xs) },
  median: { label: 'Median', fn: (xs) => quantile(xs, 0.5) },
  sd: { label: 'Standard deviation', fn: (xs) => Math.sqrt(variance(xs)) },
  iqr: { label: 'Interquartile range', fn: (xs) => quantile(xs, 0.75) - quantile(xs, 0.25) },
};

function dfText(df: number | [number, number] | null): string {
  if (df === null) return '—';
  return Array.isArray(df) ? `${formatValue(df[0], 4)}, ${formatValue(df[1], 4)}` : formatValue(df, 4);
}

/* -------------------------------------------------------------- the screen */

export function HypothesisTestsTool({ config }: { config: HypothesisTestsConfig }) {
  const app = useApp();
  const set = (patch: Partial<HypothesisTestsConfig>) => app.updateConfig({ ...config, ...patch });

  const permutation = useGeneratorRun<PermutationProgress, NonparametricResult>();
  const bootstrap = useGeneratorRun<{ completed: number; total: number }, BootstrapResult>();

  const info = TESTS.find((t) => t.id === config.test) ?? TESTS[0];
  const alpha = 1 - config.level;

  const parsed = useMemo(() => parseGroupRows(config.data), [config.data]);
  const blocks = useMemo(() => parseBlockRows(config.repeated), [config.repeated]);
  const trend = useMemo(
    () => ({ successes: parseNumberList(config.trendSuccesses), totals: parseNumberList(config.trendTotals) }),
    [config.trendSuccesses, config.trendTotals],
  );
  const pValueSet = useMemo(() => parseNumberList(config.multiplicityInput), [config.multiplicityInput]);

  const labels = useMemo(() => parsed.groups.map((g) => g.label), [parsed.groups]);
  // Fall back to the first two groups present rather than failing when the
  // stored labels no longer appear in the pasted data.
  const groupA = labels.includes(config.groupA) ? config.groupA : (labels[0] ?? '');
  const groupB = labels.includes(config.groupB) ? config.groupB : (labels.find((l) => l !== groupA) ?? '');

  const conditionLabels = useMemo(() => {
    const given = config.repeatedLabels
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from({ length: blocks.width }, (_, j) => given[j] ?? `Condition ${j + 1}`);
  }, [config.repeatedLabels, blocks.width]);

  const engineGroups = useMemo<GroupInput[]>(() => parsed.groups.map((g) => ({ label: g.label, values: g.values })), [parsed.groups]);

  const pairValues = useMemo(() => {
    const a: number[] = [];
    const b: number[] = [];
    for (const row of blocks.blocks) {
      a.push(row[0]);
      if (row.length > 1) b.push(row[1]);
    }
    return { a, b };
  }, [blocks.blocks]);

  const twoSampleValues = useMemo(() => {
    const a = parsed.groups.find((g) => g.label === groupA)?.values ?? [];
    const b = parsed.groups.find((g) => g.label === groupB)?.values ?? [];
    return { a, b };
  }, [parsed.groups, groupA, groupB]);

  const table2x2 = useMemo(() => {
    const t = config.table;
    return [
      [t[0] ?? 0, t[1] ?? 0],
      [t[2] ?? 0, t[3] ?? 0],
    ];
  }, [config.table]);

  /* ------------------------------------------------------------ the test */

  const analysis = useMemo<{ ok: true; value: Displayed } | { ok: false; error: string }>(() => {
    const level = config.level;
    const alt = config.alternative;
    try {
      switch (config.test) {
        case 'mann-whitney':
          return { ok: true, value: fromNonparametric(mannWhitneyUTest(twoSampleValues.a, twoSampleValues.b, { alternative: alt, level, labels: [groupA, groupB] })) };
        case 'brunner-munzel':
          return { ok: true, value: fromNonparametric(brunnerMunzelTest(twoSampleValues.a, twoSampleValues.b, { alternative: alt, level, labels: [groupA, groupB] })) };
        case 'ks-two-sample':
          return { ok: true, value: fromNonparametric(ksTwoSampleTest(twoSampleValues.a, twoSampleValues.b, { level, labels: [groupA, groupB] })) };
        case 'mood-median':
          return { ok: true, value: fromNonparametric(moodMedianTest(engineGroups, { level })) };
        case 'welch-t':
          return {
            ok: true,
            value: fromTestResult(welchTTest(twoSampleValues.a, twoSampleValues.b, alt, level), level, { kind: 'two-sample', n1: twoSampleValues.a.length, n2: twoSampleValues.b.length }, "Welch's t statistic is referred to the t distribution with Welch–Satterthwaite degrees of freedom: an approximation, not an exact null distribution. It is reliable from about n ≥ 15 per group, or smaller if the data are close to normal; for heavily skewed data at small n, prefer Mann–Whitney or the permutation test."),
          };
        case 'pooled-t': {
          const r = oneWayAnovaTest([
            { label: groupA, values: twoSampleValues.a },
            { label: groupB, values: twoSampleValues.b },
          ], { level });
          const d = fromNonparametric(r);
          return {
            ok: true,
            value: {
              ...d,
              name: 'Equal-variance (Student) t test, computed as one-way ANOVA',
              notes: [`With two groups, F = t², so √F = ${Math.sqrt(Math.max(0, r.statistic)).toPrecision(6)} is the two-sided Student t statistic and the p-value is identical.`, ...d.notes],
            },
          };
        }
        case 'wilcoxon-signed-rank':
          return { ok: true, value: fromNonparametric(wilcoxonSignedRankTest(pairValues.a, pairValues.b, { alternative: alt, level })) };
        case 'sign':
          return { ok: true, value: fromNonparametric(signTest(pairValues.a, pairValues.b, { alternative: alt, level })) };
        case 'paired-t':
          return {
            ok: true,
            value: fromTestResult(pairedTTest(pairValues.a, pairValues.b, alt, level), level, { kind: 'one-sample', n: Math.min(pairValues.a.length, pairValues.b.length) }, 'The paired t statistic is referred to the t distribution with n − 1 degrees of freedom. That is exact only if the paired differences are normal; otherwise it is an approximation that becomes trustworthy from about n ≥ 20 pairs. The Wilcoxon signed-rank test makes no such assumption.'),
          };
        case 'one-sample-t':
          return {
            ok: true,
            value: fromTestResult(oneSampleTTest(pairValues.a, config.nullValue, alt, level), level, { kind: 'one-sample', n: pairValues.a.length }, 'The t statistic is referred to the t distribution with n − 1 degrees of freedom; exact under normality, otherwise an approximation that is trustworthy from about n ≥ 30 for mildly skewed data.'),
          };
        case 'correlation':
          return {
            ok: true,
            value: fromTestResult(correlationTest(pairValues.a, pairValues.b, alt, level), level, { kind: 'none', reason: 'the standard effect-size scales here are for mean differences, not for a correlation. Judge sensitivity from the width of the interval on r.' }, 'The p-value comes from referring r to the t distribution with n − 2 degrees of freedom, which assumes bivariate normality. It is trustworthy from about n ≥ 25; a permutation test on r needs no such assumption.'),
          };
        case 'mcnemar':
          return { ok: true, value: fromNonparametric(mcnemarTest(table2x2, { alternative: alt, level, variant: config.mcnemarVariant })) };
        case 'one-way-anova':
          return { ok: true, value: fromNonparametric(oneWayAnovaTest(engineGroups, { level })) };
        case 'welch-anova':
          return { ok: true, value: fromNonparametric(welchAnovaTest(engineGroups, { level })) };
        case 'kruskal-wallis':
          return { ok: true, value: fromNonparametric(kruskalWallisTest(engineGroups, { level })) };
        case 'friedman':
          return { ok: true, value: fromNonparametric(friedmanTest(blocks.blocks, { level, conditionLabels })) };
        case 'levene':
          return { ok: true, value: fromNonparametric(leveneTest(engineGroups, { center: config.leveneCenter, level })) };
        case 'bartlett':
          return { ok: true, value: fromNonparametric(bartlettTest(engineGroups, { level })) };
        case 'fligner-killeen':
          return { ok: true, value: fromNonparametric(flignerKilleenTest(engineGroups, { level })) };
        case 'fisher-exact':
          return { ok: true, value: fromNonparametric(fisherExact2x2(table2x2, { alternative: alt, level })) };
        case 'chi-square': {
          const n = table2x2.flat().reduce((x, y) => x + y, 0);
          return {
            ok: true,
            value: fromTestResult(chiSquareIndependence(table2x2), level, { kind: 'chi-square', df: 1, n }, 'The χ² statistic is referred to the chi-square distribution: an asymptotic approximation. It is trustworthy when every expected count is at least 5 and n is at least about 40; below that use Fisher\'s exact test, which conditions on the margins and needs no approximation.'),
          };
        }
        case 'cochran-armitage':
          return { ok: true, value: fromNonparametric(cochranArmitageTrend(trend.successes.values, trend.totals.values, { alternative: alt, level })) };
        case 'permutation':
          return permutation.state.result
            ? { ok: true, value: fromNonparametric(permutation.state.result) }
            : { ok: false, error: 'Run the permutation test below: it resamples the data, so it is not computed until you ask for it.' };
      }
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }, [config.test, config.level, config.alternative, config.mcnemarVariant, config.leveneCenter, config.nullValue, twoSampleValues, engineGroups, pairValues, blocks.blocks, conditionLabels, table2x2, trend, groupA, groupB, permutation.state.result]);

  /* -------------------------------------------------------- post-hoc etc. */

  const postHocApplies = info.family === 'multi-group' || info.family === 'two-sample';

  const postHoc = useMemo<{ ok: true; value: PostHocResult } | { ok: false; error: string } | null>(() => {
    if (!postHocApplies) return null;
    try {
      switch (config.postHoc) {
        case 'tukey':
          return { ok: true, value: tukeyHsd(engineGroups, { level: config.level }) };
        case 'dunn':
          return { ok: true, value: dunnTest(engineGroups, { level: config.level, adjust: config.postHocAdjust }) };
        case 'games-howell':
          return { ok: true, value: gamesHowell(engineGroups, { level: config.level }) };
        case 'nemenyi':
          return { ok: true, value: nemenyiTest(blocks.blocks, { level: config.level, conditionLabels }) };
      }
    } catch (e) {
      return { ok: false, error: errorMessage(e) };
    }
  }, [postHocApplies, config.postHoc, config.postHocAdjust, config.level, engineGroups, blocks.blocks, conditionLabels]);

  const multiplicity = useMemo(() => {
    try {
      if (!pValueSet.values.length) return { ok: false as const, error: 'Enter at least one p-value to adjust.' };
      return {
        ok: true as const,
        value: adjustPValues(pValueSet.values, config.multiplicityMethod, alpha),
        all: config.showAllAdjustments ? compareAdjustments(pValueSet.values, alpha) : null,
      };
    } catch (e) {
      return { ok: false as const, error: errorMessage(e) };
    }
  }, [pValueSet.values, config.multiplicityMethod, config.showAllAdjustments, alpha]);

  const effects2x2 = useMemo(() => {
    if (info.source !== 'table') return null;
    try {
      return { ok: true as const, value: twoByTwoEffects(table2x2, { level: config.level }) };
    } catch (e) {
      return { ok: false as const, error: errorMessage(e) };
    }
  }, [info.source, table2x2, config.level]);

  /* ------------------------------------------------------------- charts */

  const boxes = useMemo(() => parsed.groups.map((g) => boxFor(g.label, g.values)).filter((b): b is BoxGroup => b !== null), [parsed.groups]);

  const groupHistograms = useMemo(
    () =>
      parsed.groups
        .filter((g) => g.values.length >= 4)
        .map((g) => ({ label: g.label, bins: histogram(sortedCopy(g.values), { minBins: 4, maxBins: 14 }) })),
    [parsed.groups],
  );

  /**
   * The exact null distribution, where the engine can build one. The
   * permutation generator returns the tail count and its Monte Carlo error
   * rather than its replicates, so there is nothing to plot for it; plotting
   * anything else in its place would be an invention.
   */
  const nullDistribution = useMemo(() => {
    try {
      if (config.test === 'mann-whitney') {
        const n1 = twoSampleValues.a.length;
        const n2 = twoSampleValues.b.length;
        if (!n1 || !n2) return null;
        const d = mannWhitneyNullDistribution(n1, n2);
        return { kind: 'U' as const, bins: pmfBins(d.pmf, d.counts, d.total), total: d.total, label: 'Exact null distribution of U₁' };
      }
      if (config.test === 'wilcoxon-signed-rank') {
        const n = pairValues.a.filter((v, i) => i < pairValues.b.length && v !== pairValues.b[i]).length;
        if (!n) return null;
        const d = signedRankNullDistribution(n);
        return { kind: 'W' as const, bins: pmfBins(d.pmf, d.counts, d.total), total: d.total, label: 'Exact null distribution of W⁺ (non-zero differences only)' };
      }
      return null;
    } catch {
      // The exact distribution is only built up to the engine's size limits;
      // beyond them there is simply no chart, and the route line above
      // already says the approximation was used.
      return null;
    }
  }, [config.test, twoSampleValues, pairValues]);

  /* ----------------------------------------------------------- run actions */

  const runPermutation = () => {
    permutation.start(() =>
      permutationTestSteps(
        [
          { label: groupA, values: twoSampleValues.a },
          { label: groupB, values: twoSampleValues.b },
        ],
        config.permutationStatistic === 'mean-difference' ? meanDifference : (gs) => quantile(gs[0], 0.5) - quantile(gs[1], 0.5),
        {
          alternative: config.alternative,
          level: config.level,
          monteCarloSamples: config.permutationSamples,
          seed: config.permutationSeed,
          chunkSize: 400,
          statisticName: config.permutationStatistic === 'mean-difference' ? `Mean(${groupA}) − mean(${groupB})` : `Median(${groupA}) − median(${groupB})`,
        },
      ),
    );
  };

  const runBootstrap = () => {
    const stat = STATISTIC_FUNCTIONS[config.bootstrapStatistic];
    bootstrap.start(() =>
      bootstrapIntervalSteps(twoSampleValues.a, stat.fn, {
        resamples: config.bootstrapResamples,
        level: config.level,
        seed: config.bootstrapSeed,
        chunkSize: 200,
      }),
    );
  };

  const result = analysis.ok ? analysis.value : null;
  const significant = result ? result.pValue < alpha : false;

  const explanation = useMemo<Explanation | null>(() => {
    if (!result) return null;
    return {
      method: `${result.name} — p-value by ${result.route === 'exact' ? 'an exact null distribution' : result.route === 'monte-carlo' ? 'Monte Carlo resampling' : 'an asymptotic approximation'}`,
      steps: [
        { label: 'Hypotheses', expression: `H₀: ${result.nullHypothesis}`, value: `H₁: ${result.alternativeHypothesis}` },
        { label: 'Test statistic', expression: result.statisticName, value: formatValue(result.statistic, 6) },
        { label: 'Degrees of freedom', value: dfText(result.degreesOfFreedom) },
        { label: 'p-value and how it was obtained', expression: result.routeReason, value: formatValue(result.pValue, 6) },
        ...Object.entries(result.diagnostics).map(([k, v]) => ({ label: k, value: formatValue(v, 6) })),
      ],
      assumptions: result.assumptions,
      limitations: result.limitations,
      exactness: result.exactness,
    };
  }, [result]);

  return (
    <>
      <ToolHeader toolId="hypothesis-tests" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card title="Data" hint="Nothing leaves the browser. Every line that cannot be read is listed below with its line number.">
            <TextField
              label="Independent groups — one row per observation: value, group"
              value={config.data}
              onChange={(data) => set({ data })}
              multiline
              rows={10}
              monospace
              hint='For example "412, Placebo". Separators: comma, semicolon or tab. Lines starting with # are treated as comments.'
            />
            <TextField
              label="Repeated measures — one row per subject, one value per condition"
              value={config.repeated}
              onChange={(repeated) => set({ repeated })}
              multiline
              rows={6}
              monospace
              hint="Used by the paired tests (first two columns), by Friedman and by Nemenyi (all columns)."
            />
            <TextField label="Condition names (comma separated)" value={config.repeatedLabels} onChange={(repeatedLabels) => set({ repeatedLabels })} />

            {parsed.skipped.length > 0 && (
              <Notice tone="warning" title={`${parsed.skipped.length} row(s) of the group data could not be read and were not used`}>
                <ul>
                  {parsed.skipped.slice(0, 12).map((s) => (
                    <li key={s.line}>
                      Line {s.line}: {s.reason} The line read: <code>{s.text.slice(0, 80)}</code>
                    </li>
                  ))}
                </ul>
                {parsed.skipped.length > 12 && <p>…and {parsed.skipped.length - 12} more.</p>}
              </Notice>
            )}
            {blocks.skipped.length > 0 && (
              <Notice tone="warning" title={`${blocks.skipped.length} row(s) of the repeated-measures data could not be read and were not used`}>
                <ul>
                  {blocks.skipped.slice(0, 12).map((s) => (
                    <li key={s.line}>
                      Line {s.line}: {s.reason}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <p className="oc-chart-note">
              {parsed.accepted.toLocaleString('en-US')} observations in {parsed.groups.length} group(s) accepted
              {parsed.comments > 0 ? `, ${parsed.comments} comment line(s) ignored` : ''}
              {parsed.skipped.length > 0 ? `, ${parsed.skipped.length} row(s) rejected` : ', no rows rejected'}.{' '}
              {blocks.blocks.length.toLocaleString('en-US')} repeated-measures row(s) of width {blocks.width} accepted.
            </p>
          </Card>

          <Card title="Which question are you asking?">
            <Segmented
              label="Kind of comparison"
              value={info.family}
              onChange={(family) => {
                const first = TESTS.find((t) => t.family === family);
                if (first) set({ test: first.id });
              }}
              options={(Object.keys(FAMILY_LABEL) as Family[]).map((f) => ({ value: f, label: FAMILY_LABEL[f] }))}
            />
            <SelectField
              label="Test"
              value={config.test}
              onChange={(test) => set({ test: test as HypothesisTestId })}
              options={TESTS.filter((t) => t.family === info.family).map((t) => ({ value: t.id, label: t.label }))}
              hint={info.question}
            />
            {info.usesAlternative && (
              <SelectField
                label="Alternative hypothesis"
                value={config.alternative}
                onChange={(alternative) => set({ alternative: alternative as Alternative })}
                options={[
                  { value: 'two-sided', label: 'Two-sided (a difference in either direction)' },
                  { value: 'greater', label: 'One-sided: greater' },
                  { value: 'less', label: 'One-sided: less' },
                ]}
                hint="Choose the direction before seeing the result, not after. Picking it afterwards doubles the real false-positive rate."
              />
            )}
            <NumberField
              label="Confidence level"
              value={config.level}
              onChange={(level) => set({ level })}
              min={0.5}
              max={0.9999}
              step={0.01}
              hint={`Significance threshold α = ${formatValue(alpha, 4)}.`}
            />

            {(info.source === 'groups' && (info.family === 'two-sample' || config.test === 'permutation')) && (
              <>
                <SelectField label="First group" value={groupA} onChange={(g) => set({ groupA: g })} options={labels.map((l) => ({ value: l, label: l }))} />
                <SelectField label="Second group" value={groupB} onChange={(g) => set({ groupB: g })} options={labels.map((l) => ({ value: l, label: l }))} />
              </>
            )}
            {config.test === 'one-sample-t' && (
              <NumberField label="Null value for the mean of the first column" value={config.nullValue} onChange={(nullValue) => set({ nullValue })} />
            )}
            {config.test === 'levene' && (
              <SelectField
                label="Centre"
                value={config.leveneCenter}
                onChange={(c) => set({ leveneCenter: c as 'mean' | 'median' })}
                options={[
                  { value: 'median', label: 'Median (Brown–Forsythe: robust to non-normality)' },
                  { value: 'mean', label: 'Mean (the original Levene form)' },
                ]}
              />
            )}
            {config.test === 'mcnemar' && (
              <SelectField
                label="p-value route"
                value={config.mcnemarVariant}
                onChange={(v) => set({ mcnemarVariant: v as HypothesisTestsConfig['mcnemarVariant'] })}
                options={[
                  { value: 'exact', label: 'Exact binomial on the discordant pairs' },
                  { value: 'mid-p', label: 'Mid-p (less conservative than exact)' },
                  { value: 'chi-square', label: 'χ² approximation' },
                ]}
              />
            )}

            {info.source === 'table' && (
              <div>
                <p className="oc-field__label" id="oc-ht-table-label">
                  2 × 2 counts
                </p>
                <div role="group" aria-labelledby="oc-ht-table-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--s2)', maxWidth: 260 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <RawNumberInput
                      key={i}
                      value={config.table[i] ?? 0}
                      onChange={(v) => {
                        const next = [...config.table];
                        next[i] = v;
                        set({ table: next });
                      }}
                      ariaLabel={`Count in row ${Math.floor(i / 2) + 1}, column ${(i % 2) + 1}`}
                      min={0}
                    />
                  ))}
                </div>
                <p className="oc-field__hint">Reading order: row 1 then row 2. Rows are the two groups, columns the two outcomes.</p>
              </div>
            )}

            {info.source === 'trend' && (
              <>
                <TextField label="Successes per ordered group" value={config.trendSuccesses} onChange={(trendSuccesses) => set({ trendSuccesses })} monospace />
                <TextField label="Totals per ordered group" value={config.trendTotals} onChange={(trendTotals) => set({ trendTotals })} monospace hint="At least three groups, in their natural order." />
                {(trend.successes.skipped.length > 0 || trend.totals.skipped.length > 0) && (
                  <Notice tone="warning" title="Some entries were not numbers and were skipped">
                    {[...trend.successes.skipped, ...trend.totals.skipped].map((s, i) => (
                      <span key={i}>
                        <code>{s.text}</code> ({s.reason}){' '}
                      </span>
                    ))}
                  </Notice>
                )}
              </>
            )}
          </Card>

          <AiAssistPanel
            capability="interpretStatistics"
            context="The question above decides the test. Two independent groups with no normality assumption: Mann–Whitney, or Brunner–Munzel if the spreads also differ. More than two groups: Kruskal–Wallis, or Welch's ANOVA if you are willing to assume approximate normality. Each option states the question it answers."
          />
        </div>

        <div className="oc-stack">
          {/* ------------------------------------------- group summaries */}
          <Card title="The groups" hint="Mean and standard deviation describe a symmetric sample; the median says more when the data are skewed.">
            <DataTable
              caption="Summary statistics for each group"
              columns={[
                { key: 'g', header: 'Group', render: (r) => r.label },
                { key: 'n', header: 'n', numeric: true, render: (r) => r.n.toLocaleString('en-US') },
                { key: 'mean', header: 'Mean', numeric: true, render: (r) => formatValue(r.mean, 5) },
                { key: 'median', header: 'Median', numeric: true, render: (r) => formatValue(r.median, 5) },
                { key: 'sd', header: 'SD', numeric: true, render: (r) => (Number.isFinite(r.sd) ? formatValue(r.sd, 5) : 'needs n ≥ 2') },
              ]}
              rows={parsed.groups.map((g) => ({ label: g.label, ...groupStats(g.values) }))}
            />
            {blocks.blocks.length > 0 && (
              <DataTable
                caption="Summary statistics for each repeated-measures condition"
                columns={[
                  { key: 'c', header: 'Condition', render: (r) => r.label },
                  { key: 'n', header: 'n', numeric: true, render: (r) => r.n.toLocaleString('en-US') },
                  { key: 'mean', header: 'Mean', numeric: true, render: (r) => formatValue(r.mean, 5) },
                  { key: 'median', header: 'Median', numeric: true, render: (r) => formatValue(r.median, 5) },
                  { key: 'sd', header: 'SD', numeric: true, render: (r) => (Number.isFinite(r.sd) ? formatValue(r.sd, 5) : 'needs n ≥ 2') },
                ]}
                rows={conditionLabels.map((label, j) => ({ label, ...groupStats(blocks.blocks.map((row) => row[j])) }))}
              />
            )}
          </Card>

          {/* --------------------------------------------------- result */}
          {!analysis.ok && <Notice tone="error">{analysis.error}</Notice>}

          {result && (
            <>
              <Card title="Result">
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">{result.statisticName}</span>
                  <span className="oc-result-hero__value">{formatValue(result.statistic, 6)}</span>
                  <span className="oc-result-hero__detail">{result.name}</span>
                </div>
                <KeyValueList
                  items={[
                    { label: 'p-value', value: <span className="tnum">{formatValue(result.pValue, 6)}</span> },
                    { label: 'Degrees of freedom', value: dfText(result.degreesOfFreedom) },
                    {
                      label: 'Decision at α = ' + formatValue(alpha, 4),
                      value: (
                        <span style={{ display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center' }}>
                          {/* An icon and the words, never colour alone. */}
                          <Icon name={significant ? 'check' : 'info'} size={14} />
                          {significant ? 'Reject the null hypothesis' : 'Do not reject the null hypothesis'}
                        </span>
                      ),
                    },
                    {
                      label: 'Which route produced the p-value',
                      value: (
                        <span style={{ display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center', flexWrap: 'wrap' }}>
                          <Badge variant={result.exactness}>{EXACTNESS_LABEL[result.exactness]}</Badge>
                          <span>
                            {result.route === 'exact' ? 'Exact null distribution' : result.route === 'monte-carlo' ? 'Monte Carlo resampling' : 'Asymptotic approximation'}
                          </span>
                        </span>
                      ),
                    },
                  ]}
                />
                <Notice tone={result.route === 'exact' ? 'info' : 'warning'} title={result.route === 'exact' ? 'Exact route' : 'Approximate route'}>
                  <p>{result.routeReason}</p>
                </Notice>
                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Hypotheses</h3>
                <p style={{ fontSize: 12.5, margin: 0 }}>H₀: {result.nullHypothesis}.</p>
                <p style={{ fontSize: 12.5, margin: 0 }}>H₁: {result.alternativeHypothesis}.</p>
              </Card>

              <Card title="Effect size" hint="The p-value says whether an effect is distinguishable from noise. Only the effect size says how big it is.">
                {result.effectSizes.length === 0 && <Notice tone="info">This test reports no standard effect size; read the group summaries and the interval instead.</Notice>}
                {result.effectSizes.map((e, i) => (
                  <div key={e.name} style={{ marginBottom: 'var(--s3)' }}>
                    {/* The common-language effect size is the first one the
                        engine returns for Mann–Whitney, and the most
                        interpretable statistic in the field, so it is shown
                        as the headline rather than in a list. */}
                    {i === 0 ? (
                      <div className="oc-result-hero">
                        <span className="oc-result-hero__label">{e.name}</span>
                        <span className="oc-result-hero__value">{e.name.toLowerCase().includes('probability of superiority') ? formatPercent(e.value, 4) : formatValue(e.value, 5)}</span>
                        <span className="oc-result-hero__detail">{e.interpretation}</span>
                      </div>
                    ) : (
                      <KeyValueList items={[{ label: e.name, value: `${formatValue(e.value, 5)} — ${e.interpretation}` }]} />
                    )}
                    {e.interval && (
                      <p className="oc-chart-note">
                        {formatPercent(e.interval.level, 3)} interval for {e.interval.of}: {formatValue(e.interval.low, 5)} to {formatValue(e.interval.high, 5)} · {e.interval.method}
                      </p>
                    )}
                  </div>
                ))}
                {result.interval && (
                  <Notice tone="info" title={`${formatPercent(result.interval.level, 3)} confidence interval for ${result.interval.of}`}>
                    <p>
                      {formatValue(result.interval.low, 5)} to {formatValue(result.interval.high, 5)}. Method: {result.interval.method}. This is an interval for{' '}
                      {result.interval.kind === 'estimate' ? 'the estimated parameter — not a range in which future observations will fall' : 'observed or simulated outcomes, not for a parameter'}.
                    </p>
                  </Notice>
                )}
              </Card>

              {/* ------------------------------------- the honesty panel */}
              <Card title={significant ? 'What this result does and does not establish' : 'A non-significant result is not evidence of no effect'}>
                <Notice tone={significant ? 'info' : 'warning'} title={significant ? 'Read this before concluding' : 'Absence of evidence is not evidence of absence'}>
                  <p>{result.sensitivity.statement}</p>
                </Notice>
                <KeyValueList
                  items={[
                    {
                      label: 'Achieved power',
                      value:
                        result.sensitivity.achievedPower === null
                          ? 'Not available for this test; the engine declines to report a power figure it cannot stand behind.'
                          : `${formatPercent(result.sensitivity.achievedPower, 3)} against a conventional effect at this sample size`,
                    },
                    {
                      label: 'Minimum detectable effect',
                      value: result.sensitivity.minimumDetectableEffect
                        ? `${formatValue(result.sensitivity.minimumDetectableEffect.value, 4)} (${result.sensitivity.minimumDetectableEffect.scale}) with power ${formatPercent(result.sensitivity.minimumDetectableEffect.power, 3)}`
                        : 'Not defined for this test.',
                    },
                  ]}
                />
                {result.sensitivity.minimumDetectableEffect && <p className="oc-chart-note">{result.sensitivity.minimumDetectableEffect.note}</p>}
                {!significant && (
                  <p className="oc-chart-note">
                    Anything smaller than the minimum detectable effect would most likely have produced a non-significant result even if it were real. A
                    non-significant test at a small sample size rules out almost nothing, and the honest conclusion is that the study was uninformative about
                    effects of that size — not that there is no effect.
                  </p>
                )}
              </Card>

              {/* --------------------------- assumptions, ties, limits */}
              <Card title="Assumptions, ties and limitations">
                <h3 style={{ margin: '0 0 var(--s2)' }}>Assumptions the engine applied</h3>
                <ul className="oc-assumption-list">
                  {result.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Ties</h3>
                <Notice tone={result.ties.tiesPresent && !result.ties.correctionApplied ? 'warning' : 'info'} title={result.ties.tiesPresent ? (result.ties.correctionApplied ? 'Ties present, tie correction applied' : 'Ties present, no correction applied') : 'No ties'}>
                  <p>
                    {result.ties.detail}
                    {result.ties.tiedGroups > 0 ? ` Tied groups of size greater than one: ${result.ties.tiedGroups}.` : ''}
                  </p>
                  {result.ties.tiesPresent && (
                    <p>An untied formula applied to tied data understates the variance of the statistic and so returns a p-value that is too small.</p>
                  )}
                </Notice>
                <h3 style={{ margin: 'var(--s4) 0 var(--s2)' }}>Limitations</h3>
                <ul className="oc-assumption-list">
                  {result.limitations.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
                {result.notes.length > 0 && (
                  <Disclosure title="Intermediate quantities the engine reported">
                    <ul className="oc-assumption-list">
                      {result.notes.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </Card>

              {explanation && <ExplanationPanel explanation={explanation} />}
            </>
          )}

          {/* ------------------------------------------ 2x2 effect sizes */}
          {effects2x2 && (
            <Card title="2 × 2 effect measures" hint="The same table, read as an odds ratio, a risk ratio and a risk difference.">
              {!effects2x2.ok && <Notice tone="error">{effects2x2.error}</Notice>}
              {effects2x2.ok && (
                <>
                  <KeyValueList
                    items={[
                      { label: 'Odds ratio', value: `${formatValue(effects2x2.value.oddsRatio.value, 5)}${effects2x2.value.oddsRatio.waldInterval ? ` (${formatValue(effects2x2.value.oddsRatio.waldInterval.low, 4)} to ${formatValue(effects2x2.value.oddsRatio.waldInterval.high, 4)})` : ''}` },
                      { label: 'Risk ratio', value: `${formatValue(effects2x2.value.riskRatio.value, 5)}${effects2x2.value.riskRatio.waldInterval ? ` (${formatValue(effects2x2.value.riskRatio.waldInterval.low, 4)} to ${formatValue(effects2x2.value.riskRatio.waldInterval.high, 4)})` : ''}` },
                      { label: 'Risk difference', value: `${formatValue(effects2x2.value.riskDifference.value, 5)}${effects2x2.value.riskDifference.waldInterval ? ` (${formatValue(effects2x2.value.riskDifference.waldInterval.low, 4)} to ${formatValue(effects2x2.value.riskDifference.waldInterval.high, 4)})` : ''}` },
                      { label: `Number needed to ${effects2x2.value.numberNeededToTreat.kind === 'benefit' ? 'treat' : 'harm'}`, value: formatValue(effects2x2.value.numberNeededToTreat.value, 4) },
                    ]}
                  />
                  {effects2x2.value.numberNeededToTreat.interval && <p className="oc-chart-note">{effects2x2.value.numberNeededToTreat.interval.note}</p>}
                </>
              )}
            </Card>
          )}

          {/* ---------------------------------------------- post-hoc */}
          {postHoc && (
            <Card title="Post-hoc pairwise comparisons" hint="An omnibus test says the groups are not all alike. It does not say which pairs differ.">
              <SelectField
                label="Procedure"
                value={config.postHoc}
                onChange={(p) => set({ postHoc: p as HypothesisTestsConfig['postHoc'] })}
                options={[
                  { value: 'tukey', label: 'Tukey HSD (after one-way ANOVA; assumes equal variances)' },
                  { value: 'dunn', label: 'Dunn (after Kruskal–Wallis; rank based)' },
                  { value: 'games-howell', label: 'Games–Howell (after Welch ANOVA; unequal variances)' },
                  { value: 'nemenyi', label: 'Nemenyi (after Friedman; repeated measures)' },
                ]}
              />
              {config.postHoc === 'dunn' && (
                <SelectField
                  label="Multiplicity control for Dunn"
                  value={config.postHocAdjust}
                  onChange={(m) => set({ postHocAdjust: m as MultiplicityMethod })}
                  options={MULTIPLICITY_OPTIONS}
                />
              )}
              {!postHoc.ok && <Notice tone="error">{postHoc.error}</Notice>}
              {postHoc.ok && (
                <>
                  <Notice tone="info" title="Multiplicity control in force">
                    <p>
                      {postHoc.value.name}: {postHoc.value.multiplicityControl}. Family-wise level {formatValue(postHoc.value.familywiseLevel, 4)} over{' '}
                      {postHoc.value.comparisons.length} comparison(s). The engine does not offer an unadjusted post-hoc test: running every pair at α = 0.05
                      is the most common statistical error in applied work.
                    </p>
                  </Notice>
                  {/* Wide table: scrolls inside its own box rather than
                      pushing the page sideways at phone width. */}
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Pairwise comparisons with adjusted p-values"
                      columns={pairwiseColumns}
                      rows={postHoc.value.comparisons}
                    />
                  </div>
                  <Badge variant={postHoc.value.exactness}>{EXACTNESS_LABEL[postHoc.value.exactness]}</Badge>
                  <ul className="oc-assumption-list" style={{ marginTop: 'var(--s3)' }}>
                    {[...postHoc.value.assumptions, ...postHoc.value.limitations].map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </>
              )}
            </Card>
          )}

          {/* ------------------------------------------- multiplicity */}
          <Card title="Multiplicity over a family of p-values" hint="Twenty independent tests at the 5% level produce a false positive about 64% of the time.">
            <TextField
              label="p-values to adjust (comma separated)"
              value={config.multiplicityInput}
              onChange={(multiplicityInput) => set({ multiplicityInput })}
              monospace
            />
            <SelectField label="Method" value={config.multiplicityMethod} onChange={(m) => set({ multiplicityMethod: m as MultiplicityMethod })} options={MULTIPLICITY_OPTIONS} />
            <Checkbox checked={config.showAllAdjustments} onChange={(showAllAdjustments) => set({ showAllAdjustments })} label="Show all five methods side by side" description="So the cost of each choice is visible." />
            {pValueSet.skipped.length > 0 && (
              <Notice tone="warning" title="Entries that were not numbers and were skipped">
                {pValueSet.skipped.map((s, i) => (
                  <span key={i}>
                    <code>{s.text}</code>{' '}
                  </span>
                ))}
              </Notice>
            )}
            {!multiplicity.ok && <Notice tone="error">{multiplicity.error}</Notice>}
            {multiplicity.ok && (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Raw and adjusted p-values"
                    columns={[
                      { key: 'i', header: 'Hypothesis', render: (_r, i) => `#${i + 1}` },
                      { key: 'p', header: 'Raw p', numeric: true, render: (r) => formatValue(r.p, 5) },
                      { key: 'adj', header: 'Adjusted p', numeric: true, render: (r) => formatValue(r.adjusted, 5) },
                      {
                        key: 'rej',
                        header: 'Rejected',
                        render: (r) => (
                          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            <Icon name={r.rejected ? 'check' : 'x'} size={13} />
                            {r.rejected ? 'yes' : 'no'}
                          </span>
                        ),
                      },
                    ]}
                    rows={multiplicity.value.pValues.map((p, i) => ({ p, adjusted: multiplicity.value.adjusted[i], rejected: multiplicity.value.rejected[i] }))}
                  />
                </div>
                <Notice tone="info" title={`This method controls`}>
                  <p>{multiplicity.value.controls}</p>
                  <ul>
                    {multiplicity.value.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </Notice>
                {multiplicity.all && (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Adjusted p-values under all five methods"
                      columns={[
                        { key: 'i', header: 'Hypothesis', render: (_r, i) => `#${i + 1}` },
                        { key: 'raw', header: 'Raw p', numeric: true, render: (r) => formatValue(r.raw, 5) },
                        ...(multiplicity.all ?? []).map((m) => ({
                          key: m.method,
                          header: m.method,
                          numeric: true,
                          render: (r: { raw: number; byMethod: Record<string, { adjusted: number; rejected: boolean }> }) =>
                            `${formatValue(r.byMethod[m.method].adjusted, 4)}${r.byMethod[m.method].rejected ? ' ✓' : ''}`,
                        })),
                      ]}
                      rows={pValueSet.values.map((raw, i) => ({
                        raw,
                        byMethod: Object.fromEntries((multiplicity.all ?? []).map((m) => [m.method, { adjusted: m.adjusted[i], rejected: m.rejected[i] }])),
                      }))}
                    />
                  </div>
                )}
                <p className="oc-chart-note">A tick marks a hypothesis the method rejects at α = {formatValue(alpha, 4)}.</p>
              </>
            )}
          </Card>

          {/* ------------------------------------------ visualisation */}
          <Card title="Group distributions">
            {boxes.length === 0 ? (
              <Notice tone="info">A box plot needs at least two observations in a group.</Notice>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <BoxPlot
                  title="Distribution of each group"
                  description={`Box plot of ${boxes.length} group(s): box from the lower to the upper quartile, line at the median, whiskers to the furthest observation within 1.5 interquartile ranges, points beyond that shown individually.`}
                  groups={boxes}
                  valueLabel="Value"
                  groupLabel="Group"
                  note="Quartiles, whisker ends and outliers are computed from the data before the chart is drawn; the chart itself computes nothing."
                />
              </div>
            )}
            {groupHistograms.map((g) => (
              <div key={g.label} style={{ overflowX: 'auto', marginTop: 'var(--s4)' }}>
                <HistogramChart
                  title={`${g.label}: shape of the sample`}
                  description={`Histogram of ${g.label} with Freedman–Diaconis bin width.`}
                  bins={g.bins}
                  xLabel="Value"
                />
              </div>
            ))}
            {nullDistribution && result && (
              <div style={{ overflowX: 'auto', marginTop: 'var(--s4)' }}>
                <HistogramChart
                  title={nullDistribution.label}
                  description={`The exact distribution of the test statistic under the null hypothesis, enumerated over all ${nullDistribution.total.toLocaleString('en-US')} arrangements, with the observed value marked.`}
                  bins={nullDistribution.bins}
                  xLabel={nullDistribution.kind === 'U' ? 'U₁' : 'W⁺'}
                  markers={[{ x: result.statistic, label: `observed ${formatValue(result.statistic, 5)}` }]}
                  note="Every arrangement of the ranks is enumerated, so this is the null distribution itself rather than an approximation to it."
                />
              </div>
            )}
            {!nullDistribution && (
              <p className="oc-chart-note">
                No null-distribution chart is shown for this test: the engine builds an exact null distribution only for Mann–Whitney and the Wilcoxon
                signed-rank statistic, and only within its size limits. For the permutation test the engine returns the tail count and its Monte Carlo
                error rather than the resampled statistics, so there is nothing to plot — and plotting something else in its place would be an invention.
              </p>
            )}
          </Card>

          {/* --------------------------------- permutation and bootstrap */}
          <Card title="Permutation test" hint="No distributional assumption at all: only that the labels are exchangeable under the null.">
            <SelectField
              label="Statistic to permute"
              value={config.permutationStatistic}
              onChange={(s) => set({ permutationStatistic: s as HypothesisTestsConfig['permutationStatistic'] })}
              options={[
                { value: 'mean-difference', label: 'Difference in means' },
                { value: 'median-difference', label: 'Difference in medians' },
              ]}
              hint={`Between "${groupA}" and "${groupB}".`}
            />
            <NumberField
              label="Monte Carlo resamples (used only when exhaustive enumeration is impossible)"
              value={config.permutationSamples}
              onChange={(permutationSamples) => set({ permutationSamples })}
              min={99}
              max={200000}
              integer
            />
            <TextField label="Seed" value={config.permutationSeed} onChange={(permutationSeed) => set({ permutationSeed })} monospace hint="The same seed gives the same p-value; a different one gives a slightly different estimate." />
            <div className="oc-btn-row">
              <Button variant="primary" icon="play" onClick={runPermutation} disabled={permutation.state.status === 'running'}>
                Run permutation test
              </Button>
              {permutation.state.status !== 'idle' && permutation.state.status !== 'running' && (
                <Button icon="x" onClick={permutation.reset}>
                  Clear
                </Button>
              )}
            </div>
            {permutation.state.status === 'running' && (
              <RunningState
                completed={permutation.state.progress?.completed ?? 0}
                total={permutation.state.progress?.total ?? config.permutationSamples}
                unitLabel={permutation.state.progress?.route === 'exact' ? 'enumerated label assignments' : 'sampled label assignments'}
                onCancel={permutation.cancel}
              />
            )}
            {permutation.state.status === 'cancelled' && <Notice tone="info">The run was cancelled, so no p-value was produced.</Notice>}
            {permutation.state.status === 'error' && <Notice tone="error">{permutation.state.error}</Notice>}
            {permutation.state.result && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Observed statistic', value: formatValue(permutation.state.result.statistic, 6) },
                    { label: 'p-value', value: formatValue(permutation.state.result.pValue, 6) },
                    {
                      label: 'Route',
                      value: (
                        <span style={{ display: 'inline-flex', gap: 'var(--s2)', alignItems: 'center' }}>
                          <Badge variant={permutation.state.result.exactness}>{EXACTNESS_LABEL[permutation.state.result.exactness]}</Badge>
                          {permutation.state.result.pValueRoute === 'exact' ? 'every assignment enumerated' : 'Monte Carlo'}
                        </span>
                      ),
                    },
                    { label: 'Assignments used', value: (permutation.state.result.diagnostics.permutations ?? 0).toLocaleString('en-US') },
                    {
                      label: 'Monte Carlo standard error of the p-value',
                      value:
                        permutation.state.result.diagnostics.monteCarloStandardError > 0
                          ? formatValue(permutation.state.result.diagnostics.monteCarloStandardError, 4)
                          : 'zero — the p-value is exact, not estimated',
                    },
                  ]}
                />
                <p className="oc-chart-note">{permutation.state.result.pValueRouteReason}</p>
                <Notice tone={permutation.state.result.pValue < alpha ? 'info' : 'warning'}>
                  <p>{permutation.state.result.sensitivity.statement}</p>
                </Notice>
              </>
            )}
          </Card>

          <Card title="Bootstrap interval" hint={`Resampling "${groupA}" with replacement; no formula for the standard error is needed.`}>
            <SelectField
              label="Statistic"
              value={config.bootstrapStatistic}
              onChange={(s) => set({ bootstrapStatistic: s as HypothesisTestsConfig['bootstrapStatistic'] })}
              options={(Object.keys(STATISTIC_FUNCTIONS) as HypothesisTestsConfig['bootstrapStatistic'][]).map((k) => ({ value: k, label: STATISTIC_FUNCTIONS[k].label }))}
            />
            <NumberField label="Resamples" value={config.bootstrapResamples} onChange={(bootstrapResamples) => set({ bootstrapResamples })} min={100} max={100000} integer />
            <TextField label="Seed" value={config.bootstrapSeed} onChange={(bootstrapSeed) => set({ bootstrapSeed })} monospace />
            <div className="oc-btn-row">
              <Button variant="primary" icon="play" onClick={runBootstrap} disabled={bootstrap.state.status === 'running'}>
                Run bootstrap
              </Button>
              {bootstrap.state.status !== 'idle' && bootstrap.state.status !== 'running' && (
                <Button icon="x" onClick={bootstrap.reset}>
                  Clear
                </Button>
              )}
            </div>
            {bootstrap.state.status === 'running' && (
              <RunningState
                completed={bootstrap.state.progress?.completed ?? 0}
                total={bootstrap.state.progress?.total ?? config.bootstrapResamples}
                unitLabel="resamples"
                onCancel={bootstrap.cancel}
              />
            )}
            {bootstrap.state.status === 'cancelled' && <Notice tone="info">The run was cancelled, so no interval was produced.</Notice>}
            {bootstrap.state.status === 'error' && <Notice tone="error">{bootstrap.state.error}</Notice>}
            {bootstrap.state.result && (
              <>
                <div className="oc-result-hero">
                  <span className="oc-result-hero__label">BCa interval for the {STATISTIC_FUNCTIONS[config.bootstrapStatistic].label.toLowerCase()}</span>
                  <span className="oc-result-hero__value">
                    {formatValue(bootstrap.state.result.bca.low, 5)} to {formatValue(bootstrap.state.result.bca.high, 5)}
                  </span>
                  <span className="oc-result-hero__detail">
                    Estimate {formatValue(bootstrap.state.result.estimate, 5)} · {formatPercent(bootstrap.state.result.bca.level, 3)} ·{' '}
                    <Badge variant={bootstrap.state.result.exactness}>{EXACTNESS_LABEL[bootstrap.state.result.exactness]}</Badge>
                  </span>
                </div>
                <DataTable
                  caption="Bootstrap intervals by construction"
                  columns={[
                    { key: 'k', header: 'Interval', render: (r) => r.kind },
                    { key: 'lo', header: 'Lower', numeric: true, render: (r) => formatValue(r.low, 5) },
                    { key: 'hi', header: 'Upper', numeric: true, render: (r) => formatValue(r.high, 5) },
                    { key: 'm', header: 'Method', render: (r) => r.method },
                  ]}
                  rows={[
                    { kind: 'BCa (prefer this one)', low: bootstrap.state.result.bca.low, high: bootstrap.state.result.bca.high, method: bootstrap.state.result.bca.method },
                    { kind: 'Percentile', low: bootstrap.state.result.percentile.low, high: bootstrap.state.result.percentile.high, method: bootstrap.state.result.percentile.method },
                    { kind: 'Basic', low: bootstrap.state.result.basic.low, high: bootstrap.state.result.basic.high, method: bootstrap.state.result.basic.method },
                  ]}
                />
                <KeyValueList
                  items={[
                    { label: 'Bootstrap standard error', value: formatValue(bootstrap.state.result.standardError, 5) },
                    { label: 'Bias', value: formatValue(bootstrap.state.result.bias, 5) },
                    { label: 'Bias correction z₀', value: formatValue(bootstrap.state.result.biasCorrection, 5) },
                    { label: 'Acceleration a', value: formatValue(bootstrap.state.result.acceleration, 5) },
                  ]}
                />
                <ul className="oc-assumption-list">
                  {[...bootstrap.state.result.assumptions, ...bootstrap.state.result.limitations, ...bootstrap.state.result.notes].map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          <Card title="How exact each route is" variant="inset">
            <ul className="oc-assumption-list">
              <li>
                <strong>Exact.</strong> An enumerated null distribution — Mann–Whitney U and the Wilcoxon signed-rank W⁺ without ties, the two-sample
                Kolmogorov–Smirnov statistic within the engine's size limit, Fisher's exact test, the exact McNemar binomial, and a permutation test small
                enough to enumerate every label assignment. There is no approximation to outgrow.
              </li>
              <li>
                <strong>Numerical approximation.</strong> A statistic referred to a limiting distribution: the normal approximation to U (trustworthy from
                about n₁, n₂ ≥ 8), the χ² approximation used by Kruskal–Wallis, Friedman, Levene, Bartlett, Fligner–Killeen, McNemar's χ² form and the test
                of independence (trustworthy when every expected count is at least 5 and n is at least about 40), and the t and F distributions used by the
                t tests and the ANOVAs (exact only under normality; otherwise reliable from roughly n ≥ 15 to 30 per group depending on skew). Below those
                sizes the p-value itself is unreliable, which is why the route is stated on every result.
              </li>
              <li>
                <strong>Empirical estimate.</strong> A Monte Carlo permutation p-value and every bootstrap interval. These carry resampling error, reported
                here as the Monte Carlo standard error of the p-value and as the dependence of the interval on the seed.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------- subcomponents */

const pairwiseColumns: ColumnDef<PairwiseComparison>[] = [
  { key: 'pair', header: 'Comparison', render: (r) => `${r.a} vs ${r.b}` },
  { key: 'diff', header: 'Difference', numeric: true, render: (r) => formatValue(r.difference, 5) },
  { key: 'stat', header: 'Statistic', numeric: true, render: (r) => `${r.statisticName} = ${formatValue(r.statistic, 5)}` },
  { key: 'praw', header: 'Raw p', numeric: true, render: (r) => formatValue(r.pValueUnadjusted, 5) },
  { key: 'padj', header: 'Adjusted p', numeric: true, render: (r) => formatValue(r.pValueAdjusted, 5) },
  {
    key: 'rej',
    header: 'Rejected',
    render: (r) => (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        <Icon name={r.rejected ? 'check' : 'x'} size={13} />
        {r.rejected ? 'yes' : 'no'}
      </span>
    ),
  },
  { key: 'ci', header: 'Interval', render: (r) => (r.interval ? `${formatValue(r.interval.low, 4)} to ${formatValue(r.interval.high, 4)}` : '—') },
];
