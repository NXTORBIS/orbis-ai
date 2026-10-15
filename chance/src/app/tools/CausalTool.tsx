/**
 * Causal inference from observational data.
 *
 * The screen exists to stop a number being read as an effect when it is an
 * association. Three things are therefore non-negotiable in the layout:
 *  - the unadjusted contrast sits beside the adjusted ones, because the gap
 *    between them is the measured confounding and the only part of it the
 *    data can speak to;
 *  - every estimate is shown with the estimand it targets, since IPW, matching
 *    and an instrument answer three different questions;
 *  - the assumption list and the sensitivity bounds are cards of their own,
 *    not a footnote. The engine refuses to build an estimate without its
 *    assumptions; an interface that then hides them undoes that on purpose.
 *
 * Nothing here computes a statistic. Every figure comes from
 * `src/engine/causal/`; the parsing step only turns text into columns and says
 * exactly which lines it could not use.
 */
import { useMemo, useState } from 'react';
import { EXACTNESS_LABEL, type Explanation } from '../../engine/core/result';
import {
  FUNDAMENTAL_PROBLEM,
  SMD_THRESHOLD,
  UNTESTABILITY,
  WEAK_INSTRUMENT_F,
  aipwEstimate,
  balanceReport,
  cinelliHazlettSensitivity,
  describeEstimand,
  diffInDiff2x2,
  eValueForMeanDifference,
  eventStudy,
  gComputation,
  ipwEstimate,
  manskiBounds,
  matchedEstimate,
  mccraryDensityTest,
  naiveDifference,
  nearestNeighbourMatch,
  outcomeStandardDeviation,
  pcAlgorithm,
  propensityWorkspace,
  regressionDiscontinuity,
  rosenbaumBounds,
  structureStability,
  twoStageLeastSquares,
  type AdjustmentSpec,
  type AssumptionStatement,
  type BalanceReport,
  type CausalEstimate,
  type Covariate,
  type CovariateBalanceRow,
  type Cpdag,
  type Estimand,
  type MatchResult,
  type OverlapReport,
  type PanelRow,
  type TrimSpec,
  type WeightReport,
} from '../../engine/causal';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  Segmented,
  SelectField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { HeatmapChart, HistogramChart, LineChart, ScatterChart } from '../../ui/charts/charts';
import { NetworkGraph } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { useApp } from '../store';

/* ------------------------------------------------------------------ *
 * Built-in data
 * ------------------------------------------------------------------ */

/**
 * A synthetic confounded cross-section, 200 units. It is synthetic on purpose:
 * the true effect of `treated` on `outcome` is +5.0, so the screen can be read
 * against a known answer. Treatment assignment depends on age, severity and
 * income, which also drive the outcome — so the unadjusted contrast is biased
 * upwards, and the adjusted estimators have something real to remove.
 * `voucher` shifts assignment but never the outcome (an instrument), and the
 * outcome jumps by 4.0 at score = 50 (a discontinuity).
 */
const BUILT_IN_DATA = `age,severity,income,voucher,score,treated,outcome
32,7.0,49,0,53.1,1,65.5
51,5.6,49,0,7.5,0,67.0
43,3.2,44,0,85.2,0,53.7
47,2.9,67,1,39.1,0,57.4
57,3.7,44,1,12.7,1,62.2
38,4.6,43,0,4.0,0,51.4
67,3.8,57,0,6.1,0,62.1
32,4.4,57,1,72.4,0,64.2
52,5.8,60,1,85.8,0,67.1
59,6.8,44,1,81.6,1,81.2
42,4.3,44,1,1.6,0,51.6
51,1.6,59,0,61.7,0,54.0
58,7.6,23,0,25.3,0,56.4
20,6.7,41,0,57.8,0,57.5
42,1.9,50,0,90.4,0,50.6
39,1.5,42,0,67.8,0,52.1
54,6.3,21,1,40.1,1,63.7
52,5.8,38,1,12.9,1,61.5
42,6.9,64,1,21.2,0,61.7
39,6.8,42,0,97.6,0,65.8
56,6.5,74,0,82.3,1,72.8
34,0.0,40,1,81.8,1,50.4
37,3.3,40,1,83.5,1,62.4
49,4.2,57,0,14.2,0,59.7
38,6.2,20,1,7.4,0,52.9
40,8.2,31,0,13.3,1,66.1
43,3.7,16,0,47.9,0,51.3
70,3.8,38,0,47.1,1,62.8
56,3.3,48,0,64.4,0,69.7
45,6.6,41,0,83.8,1,68.3
79,3.6,28,0,21.2,0,55.9
45,8.9,27,0,95.4,1,65.5
53,5.9,29,0,75.7,0,57.9
37,7.0,68,1,24.3,0,58.4
45,3.8,63,1,43.7,0,55.0
46,3.9,27,1,92.2,1,62.6
57,5.8,46,0,65.5,0,63.4
34,1.5,65,0,90.3,0,56.8
53,1.8,52,1,92.5,0,67.0
34,5.8,46,1,65.1,1,65.1
38,5.3,64,0,4.4,0,57.0
45,5.9,52,0,10.8,1,58.1
44,3.3,49,0,6.1,0,53.8
63,1.6,50,1,88.7,0,57.9
65,3.9,35,0,59.4,1,70.8
69,5.2,18,0,20.3,0,56.7
53,0.1,10,0,70.8,0,51.1
62,2.2,27,0,13.5,0,51.7
42,3.7,10,1,21.0,0,52.6
44,4.7,36,0,0.8,0,57.6
43,3.6,30,1,50.9,0,55.2
66,6.5,41,0,31.6,0,59.0
36,7.4,33,1,14.3,1,61.7
53,4.2,57,1,73.6,0,65.3
51,5.1,28,0,60.9,0,63.0
48,8.2,44,0,10.9,1,72.4
51,0.7,22,0,21.8,0,46.7
39,3.6,49,1,39.0,0,59.7
76,3.5,41,1,28.3,0,61.2
37,6.3,47,1,14.5,1,52.6
41,4.4,52,0,63.4,0,59.3
43,8.5,50,1,76.4,1,70.7
28,3.6,63,0,73.8,0,58.9
57,4.4,19,1,75.9,1,62.4
52,3.8,77,1,29.8,0,58.2
50,3.3,55,1,39.9,0,52.8
48,3.9,59,0,23.7,0,54.7
54,5.6,49,0,2.9,1,66.7
36,3.7,36,1,20.9,0,50.7
66,1.7,42,1,89.1,0,65.8
73,6.2,27,1,45.7,1,69.9
51,2.7,66,1,33.0,0,51.9
70,3.1,59,0,30.4,0,61.7
33,6.0,46,0,8.0,0,54.9
51,3.7,64,0,31.6,0,59.1
33,4.0,65,0,55.9,0,63.4
48,0.0,60,0,50.6,0,53.0
24,4.6,48,0,5.8,0,44.8
44,8.4,32,1,62.0,1,66.6
59,4.1,54,1,8.7,1,63.5
49,10.0,38,0,4.3,1,70.5
36,6.6,39,0,54.9,0,60.6
56,3.1,24,0,12.4,0,56.2
46,5.2,33,0,27.4,0,51.8
36,6.1,26,1,39.3,1,54.7
65,6.2,50,1,12.4,1,66.5
59,5.7,57,0,51.6,0,66.9
65,7.4,20,1,29.6,1,61.4
44,5.2,37,1,60.6,1,69.2
44,5.3,36,0,63.8,0,56.7
57,7.4,33,1,47.7,1,71.8
31,5.1,57,0,49.7,0,50.1
54,4.8,38,1,35.9,1,63.4
47,6.0,71,0,64.7,0,63.4
50,8.2,54,0,88.9,0,70.5
40,8.0,42,0,36.6,0,58.5
55,4.7,55,0,36.2,0,60.3
32,6.9,56,0,1.8,0,53.2
44,3.9,50,0,90.7,1,61.2
33,6.1,49,1,76.8,0,57.3
82,3.1,26,1,31.9,1,66.8
58,3.0,47,0,66.3,0,59.5
70,4.3,64,0,65.4,0,66.3
49,4.3,57,0,96.3,1,59.3
76,4.4,53,0,45.5,0,61.8
62,3.8,45,0,61.0,0,56.4
63,5.8,55,0,63.2,1,69.3
85,1.4,59,1,14.5,1,64.7
68,3.7,45,1,39.1,0,59.0
33,4.5,51,0,0.6,0,52.8
44,5.6,25,0,47.6,0,56.4
74,4.5,70,0,35.9,0,66.4
60,6.2,25,1,33.5,1,63.7
50,6.5,36,0,61.4,1,65.9
49,4.1,45,1,27.7,1,56.7
60,7.0,10,0,23.2,1,62.5
36,5.7,33,1,31.6,1,58.9
53,2.1,53,1,45.3,0,52.5
41,0.9,64,0,94.7,0,52.1
44,5.9,36,0,68.7,0,65.1
49,1.4,63,0,24.6,0,49.3
36,6.2,61,1,75.2,0,59.5
75,5.2,37,0,29.3,0,59.5
71,0.2,54,1,13.0,1,54.6
63,3.8,26,1,52.9,1,67.5
56,6.1,60,0,8.3,0,71.9
39,1.6,57,0,54.8,0,53.3
54,5.0,62,1,96.3,1,67.0
56,7.1,44,0,59.5,0,66.3
49,5.9,23,0,23.9,0,59.2
34,6.6,34,0,71.6,0,63.8
47,1.4,49,0,24.8,0,45.3
58,3.2,64,1,23.0,0,57.3
37,6.4,37,0,18.3,0,55.5
30,3.4,62,1,32.0,0,51.8
37,2.5,49,0,56.8,0,51.4
62,4.2,23,1,8.1,1,61.7
49,6.0,37,0,52.2,1,72.1
76,6.5,80,1,45.8,0,67.7
59,6.0,42,0,64.6,0,60.8
47,7.6,43,1,89.2,1,72.2
31,6.3,67,1,80.3,0,66.8
50,4.8,59,0,98.0,0,66.3
35,3.6,51,1,67.7,0,58.8
46,3.9,22,0,71.2,0,52.5
47,6.0,36,0,70.9,0,66.3
57,1.2,40,0,67.0,0,45.3
56,6.0,48,1,76.3,0,61.8
50,7.3,45,1,33.2,1,67.6
46,5.6,64,1,59.2,0,57.9
49,3.7,45,0,41.0,0,54.5
50,7.0,51,0,3.1,1,63.0
57,9.0,45,1,90.7,1,69.2
45,4.3,26,0,55.1,0,52.6
59,5.2,43,0,33.1,0,54.9
46,1.9,19,1,69.6,0,51.1
43,3.7,39,0,83.1,0,50.1
35,4.9,31,0,27.0,0,47.9
32,3.2,42,1,26.9,0,45.7
70,4.0,38,1,44.3,1,60.1
53,6.5,48,1,81.9,1,74.5
40,2.5,33,1,65.2,0,47.6
45,7.3,41,1,33.2,1,58.0
39,5.6,43,1,46.0,1,66.6
45,5.5,38,0,83.8,1,66.2
64,4.3,28,0,61.3,1,63.8
49,3.2,54,0,28.7,0,51.6
56,4.8,46,0,31.3,1,65.2
57,3.6,20,1,95.5,1,67.2
41,7.0,49,0,37.6,0,57.3
40,4.7,35,1,7.2,0,61.8
48,6.5,39,0,70.1,0,60.3
53,3.4,36,0,49.5,0,55.7
60,5.4,68,1,44.4,1,71.8
49,5.5,47,0,75.7,0,68.4
63,3.5,55,0,77.0,0,67.7
56,6.2,69,1,96.1,1,75.6
58,4.8,10,0,54.9,0,54.9
75,1.2,61,0,56.1,0,53.8
68,5.3,65,1,48.3,1,68.4
63,4.7,40,1,82.3,1,64.9
36,3.2,47,0,58.1,0,52.2
49,7.2,29,1,1.1,1,56.0
39,5.4,41,1,38.9,1,57.9
44,9.9,50,1,72.7,1,79.9
71,6.5,38,1,85.4,1,71.1
47,7.5,56,1,45.2,1,69.5
45,5.8,32,0,62.1,0,59.5
47,3.9,54,0,17.3,0,58.5
51,6.4,44,1,10.4,1,62.0
57,7.0,42,1,89.1,1,68.0
51,3.1,61,0,44.0,0,57.2
32,5.9,62,0,35.3,0,61.4
62,7.0,51,1,35.3,1,71.8
57,6.2,36,1,44.3,1,71.0
66,4.0,41,1,6.4,0,63.5
42,6.6,43,0,69.3,0,58.9
54,2.5,43,1,6.5,0,62.1
52,7.7,50,0,8.9,0,63.7
58,8.0,53,1,73.5,1,74.9`;

/**
 * A synthetic balanced panel, 16 units over 8 periods. Units 1–8 adopt the
 * treatment at period 5; the true effect is +3.0 and the trends are parallel
 * by construction, so the event-study pre-period coefficients should scatter
 * around zero. Treated units start at a higher level, which is exactly what a
 * difference-in-differences is for and what a cross-sectional comparison of
 * the same data would mistake for an effect.
 */
const BUILT_IN_PANEL = `unit,time,outcome,treated
1,1,23.45,0
1,2,22.03,0
1,3,27.74,0
1,4,27.24,0
1,5,30.58,1
1,6,33.97,1
1,7,35.21,1
1,8,36.13,1
2,1,26.79,0
2,2,29.0,0
2,3,29.71,0
2,4,27.98,0
2,5,33.96,1
2,6,35.27,1
2,7,35.42,1
2,8,36.83,1
3,1,22.93,0
3,2,23.48,0
3,3,23.66,0
3,4,27.23,0
3,5,27.87,1
3,6,30.62,1
3,7,32.42,1
3,8,34.11,1
4,1,25.26,0
4,2,27.67,0
4,3,27.99,0
4,4,28.95,0
4,5,34.64,1
4,6,33.35,1
4,7,32.71,1
4,8,35.78,1
5,1,21.55,0
5,2,21.39,0
5,3,26.71,0
5,4,23.9,0
5,5,30.04,1
5,6,31.21,1
5,7,34.03,1
5,8,32.71,1
6,1,26.69,0
6,2,28.21,0
6,3,29.88,0
6,4,31.27,0
6,5,34.61,1
6,6,34.44,1
6,7,36.95,1
6,8,37.97,1
7,1,28.25,0
7,2,29.09,0
7,3,30.45,0
7,4,33.33,0
7,5,35.85,1
7,6,39.56,1
7,7,38.47,1
7,8,39.64,1
8,1,18.73,0
8,2,20.94,0
8,3,22.2,0
8,4,23.46,0
8,5,28.34,1
8,6,28.22,1
8,7,27.89,1
8,8,30.15,1
9,1,18.83,0
9,2,19.61,0
9,3,21.04,0
9,4,24.37,0
9,5,22.82,0
9,6,22.66,0
9,7,26.42,0
9,8,27.36,0
10,1,18.91,0
10,2,21.44,0
10,3,21.08,0
10,4,22.19,0
10,5,22.71,0
10,6,27.54,0
10,7,26.2,0
10,8,28.79,0
11,1,20.2,0
11,2,19.16,0
11,3,20.84,0
11,4,22.29,0
11,5,24.17,0
11,6,24.89,0
11,7,28.36,0
11,8,28.89,0
12,1,29.74,0
12,2,31.11,0
12,3,34.44,0
12,4,35.75,0
12,5,34.12,0
12,6,35.59,0
12,7,36.22,0
12,8,38.2,0
13,1,25.3,0
13,2,25.39,0
13,3,30.4,0
13,4,29.14,0
13,5,30.61,0
13,6,31.92,0
13,7,31.42,0
13,8,33.78,0
14,1,18.92,0
14,2,22.54,0
14,3,22.41,0
14,4,21.26,0
14,5,23.59,0
14,6,25.3,0
14,7,27.32,0
14,8,27.97,0
15,1,22.47,0
15,2,23.26,0
15,3,24.33,0
15,4,25.57,0
15,5,28.38,0
15,6,29.15,0
15,7,28.07,0
15,8,28.46,0
16,1,19.51,0
16,2,21.54,0
16,3,20.17,0
16,4,23.93,0
16,5,24.07,0
16,6,25.98,0
16,7,28.17,0
16,8,30.96,0`;

const MAX_ROWS = 20_000;
const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', '.', '-', 'missing']);

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export type CausalMethod = 'naive' | 'ipw' | 'gcomp' | 'aipw' | 'matching';
export type CausalDesign = 'iv' | 'did' | 'rdd';

export interface CausalConfig {
  /** The cross-section as typed or pasted: a header line, then one row per line. */
  dataText: string;
  /** Column holding the 0/1 treatment indicator. */
  treatmentColumn: string;
  /** Column holding the outcome. */
  outcomeColumn: string;
  /** Columns adjusted for, in the order they enter both models. */
  covariateColumns: string[];
  /** Confidence level for every interval on the screen. */
  level: number;
  /** Restrict to the propensity-score common support before estimating. */
  trimCommonSupport: boolean;
  ipwStabilised: boolean;
  ipwEstimand: 'ATE' | 'ATT';
  /** Delta-method or bootstrap inference for g-computation. */
  gcompInference: 'delta' | 'bootstrap';
  /** Propensity caliper for nearest-neighbour matching; 0 means no caliper. */
  matchCaliper: number;
  matchWithReplacement: boolean;
  /** The logical range the outcome cannot leave, for the Manski bounds. */
  outcomeLow: number;
  outcomeHigh: number;
  /** Which method's assumptions and sensitivity analysis are shown. */
  focusMethod: CausalMethod;
  /** Which quasi-experimental design is shown. */
  design: CausalDesign;
  /**
   * Whether to compute the selected quasi-experimental design. Off by
   * default because the instrumental-variables panel inverts the
   * Anderson–Rubin test over a grid of candidate effects, which is around
   * 0.7 seconds of blocked main thread on the built-in data — far too much to
   * spend before the screen has been painted once.
   */
  runDesign: boolean;
  instrumentColumn: string;
  runningColumn: string;
  rddCutoff: number;
  /** Bandwidth for the local-linear fit; 0 means Imbens–Kalyaraman. */
  rddBandwidth: number;
  /** The panel for the difference-in-differences tab, in long format. */
  panelText: string;
  /** Structure search is off until asked for: see the note beside the button. */
  runDiscovery: boolean;
  discoveryAlpha: number;
}

export const CAUSAL_DEFAULT: CausalConfig = {
  dataText: BUILT_IN_DATA,
  treatmentColumn: 'treated',
  outcomeColumn: 'outcome',
  covariateColumns: ['age', 'severity', 'income'],
  level: 0.95,
  trimCommonSupport: false,
  ipwStabilised: false,
  ipwEstimand: 'ATE',
  gcompInference: 'delta',
  matchCaliper: 0.1,
  matchWithReplacement: false,
  outcomeLow: 0,
  outcomeHigh: 100,
  focusMethod: 'aipw',
  design: 'iv',
  runDesign: false,
  instrumentColumn: 'voucher',
  runningColumn: 'score',
  rddCutoff: 50,
  rddBandwidth: 0,
  panelText: BUILT_IN_PANEL,
  runDiscovery: false,
  discoveryAlpha: 0.05,
};

/* ------------------------------------------------------------------ *
 * Parsing — untrusted text in, numbers out, with the line numbers kept
 * ------------------------------------------------------------------ */

interface LineProblem {
  line: number;
  reason: string;
}

interface ParsedTable {
  names: string[];
  /** One array per row, in column order. Rows with any unusable cell are absent. */
  rows: number[][];
  lineNumbers: number[];
  problems: LineProblem[];
  truncated: number;
  headerError: string | null;
}

function splitLine(line: string): string[] {
  return line.trim().split(/\s*[,;\t]\s*|\s+/);
}

function parseTable(text: string): ParsedTable {
  const lines = text.split(/\r?\n/);
  const problems: LineProblem[] = [];
  const empty: ParsedTable = { names: [], rows: [], lineNumbers: [], problems, truncated: 0, headerError: null };
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex < 0) {
    return { ...empty, headerError: 'No data yet. The first non-blank line must be a header naming the columns.' };
  }
  const names = splitLine(lines[headerIndex]).map((s) => s.trim());
  if (names.some((n) => n === '')) {
    return { ...empty, headerError: `Line ${headerIndex + 1} (the header) has an empty column name. Every column needs a name.` };
  }
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  if (duplicate !== undefined) {
    return { ...empty, headerError: `Line ${headerIndex + 1} (the header) names "${duplicate}" twice. Column names must be distinct.` };
  }
  if (names.length < 3) {
    return {
      ...empty,
      headerError: `Line ${headerIndex + 1} (the header) has ${names.length} column(s). This tool needs at least a treatment, an outcome and one covariate to adjust for.`,
    };
  }

  const rows: number[][] = [];
  const lineNumbers: number[] = [];
  let truncated = 0;
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') continue;
    if (rows.length >= MAX_ROWS) {
      truncated++;
      continue;
    }
    const cells = splitLine(raw);
    if (cells.length !== names.length) {
      problems.push({ line: i + 1, reason: `${cells.length} value(s) for ${names.length} column(s)` });
      continue;
    }
    const parsed: number[] = [];
    let bad: string | null = null;
    for (let j = 0; j < cells.length; j++) {
      const token = cells[j];
      if (MISSING_TOKENS.has(token.toLowerCase())) {
        bad = `"${names[j]}" is missing. A unit with a missing value is dropped, and dropping it is itself an assumption`;
        break;
      }
      const v = Number(token);
      if (!Number.isFinite(v)) {
        bad = `"${names[j]}" is ${JSON.stringify(clip(token))}, which is not a number`;
        break;
      }
      parsed.push(v);
    }
    if (bad !== null) {
      problems.push({ line: i + 1, reason: bad });
      continue;
    }
    rows.push(parsed);
    lineNumbers.push(i + 1);
  }
  return { names, rows, lineNumbers, problems, truncated, headerError: null };
}

interface ParsedPanel {
  rows: PanelRow[];
  problems: LineProblem[];
  headerError: string | null;
}

/** The panel is read by column name, so the four columns may be in any order. */
function parsePanel(text: string): ParsedPanel {
  const t = parseTable(text);
  if (t.headerError) return { rows: [], problems: t.problems, headerError: t.headerError };
  const want = ['unit', 'time', 'outcome', 'treated'];
  const idx = want.map((w) => t.names.findIndex((n) => n.toLowerCase() === w));
  const missing = want.filter((_, k) => idx[k] < 0);
  if (missing.length) {
    return {
      rows: [],
      problems: t.problems,
      headerError: `The panel needs columns named ${want.join(', ')}; ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} absent.`,
    };
  }
  const problems = t.problems.slice();
  const rows: PanelRow[] = [];
  t.rows.forEach((r, k) => {
    const treated = r[idx[3]];
    if (treated !== 0 && treated !== 1) {
      problems.push({ line: t.lineNumbers[k], reason: `"treated" is ${treated}; it must be 0 or 1` });
      return;
    }
    rows.push({ unit: r[idx[0]], time: r[idx[1]], outcome: r[idx[2]], treated });
  });
  return { rows, problems, headerError: null };
}

function clip(s: string, max = 32): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run an engine call, turning an EngineError into its own message. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const METHOD_LABEL: Record<CausalMethod, string> = {
  naive: 'Unadjusted difference in means',
  ipw: 'Inverse-probability weighting',
  gcomp: 'g-computation (standardisation)',
  aipw: 'AIPW (doubly robust)',
  matching: 'Nearest-neighbour propensity matching',
};

const DESIGN_LABEL: Record<CausalDesign, string> = {
  iv: 'Instrumental variables',
  did: 'Difference-in-differences',
  rdd: 'Regression discontinuity',
};

/** The reference estimands, straight from the engine, so the differences show. */
const ESTIMAND_REFERENCE: Estimand[] = ['ATE', 'ATT', 'LATE', 'local-at-cutoff'];

function interval(e: CausalEstimate): string {
  if (!e.confidenceInterval) return 'not available';
  const { low, high, level } = e.confidenceInterval;
  return `${formatValue(low, 4)} to ${formatValue(high, 4)} (${formatPercent(level, 3)})`;
}

/** An Explanation assembled from what the engine itself reported. */
function explanationOf(e: CausalEstimate): Explanation {
  return {
    method: e.method,
    formula: e.estimand.contrast,
    steps: [
      { label: 'Estimand', expression: e.estimand.contrast, value: `${e.estimand.kind} — ${e.estimand.targetPopulation}` },
      { label: 'Point estimate', value: formatValue(e.estimate, 5) },
      {
        label: 'Standard error',
        expression: e.inferenceNote,
        value: e.standardError === null ? 'not available' : formatValue(e.standardError, 5),
      },
      { label: 'Interval', value: interval(e) },
      {
        label: 'Units contributing',
        value: `${e.sample.nUsed} of ${e.sample.nTotal} (${e.sample.nTreated} treated, ${e.sample.nControl} control, ${e.sample.nDropped} dropped)`,
      },
    ],
    assumptions: e.assumptions.map((a) => `${a.name}${a.testable ? '' : ' (not testable from these data)'}: ${a.statement}`),
    limitations: [e.fundamentalProblem, e.untestability, ...e.sample.dropReasons, ...e.warnings, ...e.notes],
    exactness: e.exactness,
  };
}

/**
 * Both of these exist as functions rather than inline expressions so that the
 * values handed to the engine are plain `const` numbers: narrowing a nullable
 * field inside a callback is exactly the kind of thing that silently becomes
 * a NaN argument.
 */
function eValueOf(e: CausalEstimate, outcomeSd: number | null): Attempt<ReturnType<typeof eValueForMeanDifference>> {
  const ci = e.confidenceInterval;
  if (!ci || outcomeSd === null) {
    return { ok: false, error: 'The E-value needs a confidence interval and an outcome with non-zero spread; one of them is unavailable here.' };
  }
  const low = ci.low;
  const high = ci.high;
  const sd = outcomeSd;
  return attempt(() => eValueForMeanDifference(e.estimate, { low, high }, sd));
}

function robustnessOf(e: CausalEstimate, df: number): Attempt<ReturnType<typeof cinelliHazlettSensitivity>> {
  const se = e.standardError;
  if (se === null) return { ok: false, error: 'The robustness value is defined from a standard error, and this estimate has none.' };
  const point = e.estimate;
  return attempt(() => cinelliHazlettSensitivity(point, se, df));
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function CausalTool({ config }: { config: CausalConfig }) {
  const app = useApp();
  const set = (patch: Partial<CausalConfig>) => app.updateConfig({ ...config, ...patch });
  const [showAllSkipped, setShowAllSkipped] = useState(false);

  const table = useMemo(() => parseTable(config.dataText), [config.dataText]);

  const columnOptions = useMemo(() => table.names.map((n) => ({ value: n, label: n })), [table.names]);

  /** The selected columns as vectors, or the reason there are none. */
  const vectors = useMemo(() => {
    const col = (name: string): number[] | null => {
      const j = table.names.indexOf(name);
      return j < 0 ? null : table.rows.map((r) => r[j]);
    };
    const treatment = col(config.treatmentColumn);
    const outcome = col(config.outcomeColumn);
    const covariates: Covariate[] = [];
    const missingCovariates: string[] = [];
    for (const name of config.covariateColumns) {
      const v = col(name);
      if (v === null) missingCovariates.push(name);
      else covariates.push({ name, values: v });
    }
    return { treatment, outcome, covariates, missingCovariates, column: col };
  }, [table, config.treatmentColumn, config.outcomeColumn, config.covariateColumns]);

  const trim: TrimSpec | undefined = useMemo(
    () => (config.trimCommonSupport ? { commonSupportOnly: true } : undefined),
    [config.trimCommonSupport],
  );

  const spec = useMemo<AdjustmentSpec | null>(() => {
    if (!vectors.treatment || !vectors.outcome) return null;
    if (!vectors.treatment.length) return null;
    return {
      outcome: vectors.outcome,
      treatment: vectors.treatment,
      covariates: vectors.covariates,
      level: config.level,
    };
  }, [vectors, config.level]);

  // The propensity model is fitted once and shared: the overlap, the weight
  // diagnostics and the matching all describe the SAME fitted model, which
  // they would not if each panel refitted its own.
  const workspace = useMemo(() => (spec ? attempt(() => propensityWorkspace(spec, trim)) : null), [spec, trim]);

  const naive = useMemo(() => (spec ? attempt(() => naiveDifference(spec)) : null), [spec]);

  const ipw = useMemo(
    () =>
      spec
        ? attempt(() =>
            ipwEstimate(spec, {
              trim,
              stabilised: config.ipwStabilised,
              estimand: config.ipwEstimand,
            }),
          )
        : null,
    [spec, trim, config.ipwStabilised, config.ipwEstimand],
  );

  const gcomp = useMemo(
    () => (spec ? attempt(() => gComputation(spec, { trim, inference: config.gcompInference, seed: 'orbis-causal' })) : null),
    [spec, trim, config.gcompInference],
  );

  const aipw = useMemo(() => (spec ? attempt(() => aipwEstimate(spec, { trim })) : null), [spec, trim]);

  const matching = useMemo(() => {
    if (!spec || !workspace || !workspace.ok) return null;
    const scores = workspace.value.scores;
    return attempt<{ match: MatchResult; estimate: CausalEstimate; balance: BalanceReport }>(() => {
      const match = nearestNeighbourMatch(scores, spec.treatment, {
        withReplacement: config.matchWithReplacement,
        caliper: config.matchCaliper > 0 ? config.matchCaliper : undefined,
      });
      const estimate = matchedEstimate(spec, match);
      const balance = balanceReport(spec.covariates, spec.treatment, match.weights, 'matching');
      return { match, estimate, balance };
    });
  }, [spec, workspace, config.matchCaliper, config.matchWithReplacement]);

  const focus = useMemo<Attempt<CausalEstimate> | null>(() => {
    switch (config.focusMethod) {
      case 'naive':
        return naive;
      case 'ipw':
        return ipw && (ipw.ok ? { ok: true, value: ipw.value.estimate } : ipw);
      case 'gcomp':
        return gcomp && (gcomp.ok ? { ok: true, value: gcomp.value.estimate } : gcomp);
      case 'aipw':
        return aipw && (aipw.ok ? { ok: true, value: aipw.value.estimate } : aipw);
      case 'matching':
        return matching && (matching.ok ? { ok: true, value: matching.value.estimate } : matching);
    }
  }, [config.focusMethod, naive, ipw, gcomp, aipw, matching]);

  /** Every estimate that was produced, for the one comparison table. */
  const comparison = useMemo(() => {
    const out: { method: CausalMethod; label: string; estimate: CausalEstimate | null; error: string | null }[] = [];
    const push = (method: CausalMethod, a: Attempt<CausalEstimate> | null): void => {
      if (!a) return;
      out.push({ method, label: METHOD_LABEL[method], estimate: a.ok ? a.value : null, error: a.ok ? null : a.error });
    };
    push('naive', naive);
    push('ipw', ipw && (ipw.ok ? { ok: true, value: ipw.value.estimate } : ipw));
    push('gcomp', gcomp && (gcomp.ok ? { ok: true, value: gcomp.value.estimate } : gcomp));
    push('aipw', aipw && (aipw.ok ? { ok: true, value: aipw.value.estimate } : aipw));
    push('matching', matching && (matching.ok ? { ok: true, value: matching.value.estimate } : matching));
    return out;
  }, [naive, ipw, gcomp, aipw, matching]);

  /** Naive minus adjusted: the measured confounding, and nothing more. */
  const confoundingGap = useMemo(() => {
    const n = comparison.find((r) => r.method === 'naive')?.estimate;
    const f = focus && focus.ok ? focus.value : null;
    if (!n || !f || config.focusMethod === 'naive') return null;
    return { naive: n.estimate, adjusted: f.estimate, gap: n.estimate - f.estimate, label: f.method };
  }, [comparison, focus, config.focusMethod]);

  /* ------------------------------------------- overlap, balance, weights */

  const overlap = useMemo<Attempt<OverlapReport> | null>(() => {
    if (!ipw) return null;
    return ipw.ok ? { ok: true, value: ipw.value.overlap } : ipw;
  }, [ipw]);

  const weights = useMemo<WeightReport | null>(() => (ipw && ipw.ok ? ipw.value.weightDiagnostics : null), [ipw]);

  const ipwBalance = useMemo<BalanceReport | null>(() => (ipw && ipw.ok ? ipw.value.balance : null), [ipw]);

  const propensityHistograms = useMemo(() => {
    if (!overlap || !overlap.ok) return null;
    const o = overlap.value;
    const build = (counts: number[]): { x0: number; x1: number; count: number; density: number; proportion: number }[] => {
      const total = counts.reduce((a, b) => a + b, 0);
      if (total === 0) return [];
      return counts.map((c, i) => {
        const x0 = o.binEdges[i];
        const x1 = o.binEdges[i + 1];
        const width = x1 - x0;
        return { x0, x1, count: c, density: width > 0 ? c / total / width : 0, proportion: c / total };
      });
    };
    return { treated: build(o.treatedCounts), control: build(o.controlCounts) };
  }, [overlap]);

  /* --------------------------------------------------- sensitivity panel */

  const sensitivity = useMemo(() => {
    if (!spec || !focus || !focus.ok) return null;
    const e = focus.value;
    const nUsed = e.sample.nUsed;
    const df = Math.max(1, nUsed - spec.covariates.length - 2);
    const sd = attempt(() => outcomeStandardDeviation(spec.outcome));
    const ev = eValueOf(e, sd.ok ? sd.value : null);
    const ch = robustnessOf(e, df);
    const manski = attempt(() => manskiBounds(spec.outcome, spec.treatment, [config.outcomeLow, config.outcomeHigh], config.level));
    const rosen =
      matching && matching.ok
        ? attempt(() => rosenbaumBounds(matching.value.match.pairs.map((p) => spec.outcome[p.treated] - spec.outcome[p.control])))
        : { ok: false as const, error: 'Rosenbaum bounds are defined for a matched design; no matched pairs are available.' };
    return { ev, ch, manski, rosen, df };
  }, [spec, focus, matching, config.outcomeLow, config.outcomeHigh, config.level]);

  const contourGrid = useMemo(() => {
    if (!sensitivity || !sensitivity.ch.ok) return null;
    const pts = sensitivity.ch.value.contour;
    const xs = [...new Set(pts.map((p) => p.r2TreatmentConfounder))].sort((a, b) => a - b);
    const ys = [...new Set(pts.map((p) => p.r2OutcomeConfounder))].sort((a, b) => b - a);
    const values = ys.map((y) => xs.map((x) => pts.find((p) => p.r2TreatmentConfounder === x && p.r2OutcomeConfounder === y)?.adjustedEstimate ?? NaN));
    return { rows: ys.map((y) => formatValue(y, 2)), columns: xs.map((x) => formatValue(x, 2)), values };
  }, [sensitivity]);

  /* --------------------------------------- quasi-experimental designs */

  const iv = useMemo(() => {
    if (!spec || !config.runDesign || config.design !== 'iv') return null;
    const z = vectors.column(config.instrumentColumn);
    if (!z) return { ok: false as const, error: `No column named "${config.instrumentColumn}" to use as an instrument.` };
    return attempt(() =>
      twoStageLeastSquares({
        outcome: spec.outcome,
        treatment: spec.treatment,
        instruments: [{ name: config.instrumentColumn, values: z }],
        controls: spec.covariates.map((c) => ({ name: c.name, values: c.values })),
        level: config.level,
        binaryTreatment: true,
      }),
    );
  }, [spec, vectors, config.runDesign, config.design, config.instrumentColumn, config.level]);

  const panel = useMemo(
    () => (config.runDesign && config.design === 'did' ? parsePanel(config.panelText) : null),
    [config.runDesign, config.design, config.panelText],
  );

  const did = useMemo<{ event: Attempt<ReturnType<typeof eventStudy>> | null; twoByTwo: Attempt<CausalEstimate>; firstTreated: number | null } | null>(() => {
    if (!panel || panel.headerError || !panel.rows.length) return null;
    const rows = panel.rows;
    const adoption = rows.filter((r) => r.treated === 1).map((r) => r.time);
    if (!adoption.length) {
      return {
        event: null,
        twoByTwo: { ok: false, error: 'No row is under treatment, so there is no treated group to difference against.' },
        firstTreated: null,
      };
    }
    const firstTreated = Math.min(...adoption);
    const everTreated = new Set(rows.filter((r) => r.treated === 1).map((r) => String(r.unit)));
    const twoByTwo = attempt(() =>
      diffInDiff2x2(
        rows.map((r) => r.outcome),
        rows.map((r) => (everTreated.has(String(r.unit)) ? 1 : 0)),
        rows.map((r) => (r.time >= firstTreated ? 1 : 0)),
        { level: config.level, clusters: rows.map((r) => String(r.unit)) },
      ),
    );
    const event = attempt(() => eventStudy(rows, { level: config.level }));
    return { event, twoByTwo, firstTreated };
  }, [panel, config.level]);

  const rdd = useMemo(() => {
    if (!spec || !config.runDesign || config.design !== 'rdd') return null;
    const running = vectors.column(config.runningColumn);
    if (!running) return { fit: { ok: false as const, error: `No column named "${config.runningColumn}" to use as the running variable.` }, mccrary: null, running: null };
    const fit = attempt(() =>
      regressionDiscontinuity({
        outcome: spec.outcome,
        running,
        cutoff: config.rddCutoff,
        bandwidth: config.rddBandwidth > 0 ? config.rddBandwidth : undefined,
        order: 1,
        level: config.level,
      }),
    );
    const mccrary = attempt(() => mccraryDensityTest(running, config.rddCutoff, { level: config.level }));
    return { fit, mccrary, running };
  }, [spec, vectors, config.runDesign, config.design, config.runningColumn, config.rddCutoff, config.rddBandwidth, config.level]);

  /* ----------------------------------------------------------- discovery */

  // Gated: PC runs an independence test for every pair and conditioning set,
  // and `structureStability` runs the whole search again at each significance
  // level. On the built-in data that is a second or more of blocked main
  // thread, which is not something to spend on opening the screen.
  const discovery = useMemo(() => {
    if (!config.runDiscovery || !spec) return null;
    const columns = [spec.treatment, spec.outcome, ...spec.covariates.map((c) => c.values)];
    const variables = [config.treatmentColumn, config.outcomeColumn, ...spec.covariates.map((c) => c.name)];
    const data = { kind: 'continuous' as const, variables, columns };
    return {
      cpdag: attempt<Cpdag>(() => pcAlgorithm(data, { alpha: config.discoveryAlpha })),
      stability: attempt(() => structureStability(data, [0.01, 0.05, 0.1])),
    };
  }, [config.runDiscovery, config.discoveryAlpha, config.treatmentColumn, config.outcomeColumn, spec]);

  const skippedShown = showAllSkipped ? table.problems : table.problems.slice(0, 8);
  const covariateChoices = table.names.filter((n) => n !== config.treatmentColumn && n !== config.outcomeColumn);
  const focusEstimate = focus && focus.ok ? focus.value : null;

  const balanceColumns: ColumnDef<{ row: CovariateBalanceRow; after: CovariateBalanceRow | null }>[] = [
    { key: 'name', header: 'Covariate', render: (r) => r.row.name },
    { key: 'tm', header: 'Treated mean', numeric: true, render: (r) => formatValue(r.row.treatedMean, 4) },
    { key: 'cm', header: 'Control mean', numeric: true, render: (r) => formatValue(r.row.controlMean, 4) },
    { key: 'before', header: 'SMD before', numeric: true, render: (r) => formatValue(r.row.smd, 3) },
    { key: 'after', header: 'SMD after', numeric: true, render: (r) => (r.after ? formatValue(r.after.smd, 3) : 'not adjusted') },
    {
      key: 'ok',
      header: `Within ±${SMD_THRESHOLD}`,
      render: (r) => {
        const target = r.after ?? r.row;
        return target.balanced ? 'yes' : 'no — still imbalanced';
      },
      title: 'The conventional standardised-mean-difference threshold. Stated in words, not by colour alone.',
    },
  ];

  return (
    <>
      <ToolHeader toolId="causal" />
      <div className="oc-workspace">
        <div className="oc-stack">
          {/* ------------------------------------------------------- 1. data */}
          <Card title="Data" hint="One header line naming the columns, then one unit per line. Commas, semicolons, tabs or spaces all work.">
            <TextField
              label="Observational data (header line, then one unit per line)"
              value={config.dataText}
              onChange={(dataText) => set({ dataText })}
              multiline
              rows={10}
              monospace
              maxLength={400_000}
              hint="Loaded with a synthetic confounded cross-section of 200 units whose true effect is +5.0, so the screen can be read against a known answer. Replace it with your own; nothing leaves this page."
            />
            {config.dataText !== BUILT_IN_DATA && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  set({
                    dataText: BUILT_IN_DATA,
                    treatmentColumn: 'treated',
                    outcomeColumn: 'outcome',
                    covariateColumns: ['age', 'severity', 'income'],
                    instrumentColumn: 'voucher',
                    runningColumn: 'score',
                    rddCutoff: 50,
                  })
                }
              >
                Restore the built-in dataset
              </Button>
            )}
            {table.headerError && <Notice tone="error">{table.headerError}</Notice>}
            {!table.headerError && (
              <KeyValueList
                items={[
                  { label: 'Columns found', value: table.names.join(', ') },
                  { label: 'Units read', value: table.rows.length.toLocaleString('en-US') },
                  { label: 'Lines skipped', value: table.problems.length.toLocaleString('en-US') },
                ]}
              />
            )}
            {table.truncated > 0 && (
              <Notice tone="warning" title="Lines beyond the limit were not read">
                The first {MAX_ROWS.toLocaleString('en-US')} units were used and {table.truncated.toLocaleString('en-US')} further line(s) were ignored. They were
                not sampled or averaged — they are simply absent from every figure below.
              </Notice>
            )}
            {table.problems.length > 0 && (
              <Notice tone="warning" title={`${table.problems.length} line(s) could not be read and are in no estimate below`}>
                <ul className="oc-assumption-list">
                  {skippedShown.map((p) => (
                    <li key={p.line}>
                      Line {p.line}: {p.reason}.
                    </li>
                  ))}
                </ul>
                {table.problems.length > skippedShown.length && (
                  <Button size="sm" variant="ghost" onClick={() => setShowAllSkipped(true)}>
                    {`Show all ${table.problems.length} skipped lines`}
                  </Button>
                )}
                <p style={{ marginBottom: 0 }}>
                  Dropping a unit is itself a causal assumption: it is harmless only if the reason the line is unusable is unrelated to the treatment and the
                  outcome. Nothing below can check that.
                </p>
              </Notice>
            )}
          </Card>

          <Card title="Treatment, outcome and the covariates adjusted for">
            <SelectField
              label="Treatment (must be coded 0 and 1)"
              value={config.treatmentColumn}
              onChange={(treatmentColumn) => set({ treatmentColumn, covariateColumns: config.covariateColumns.filter((c) => c !== treatmentColumn) })}
              options={columnOptions}
              hint={columnOptions.length ? undefined : 'No columns yet — enter data above.'}
            />
            <SelectField
              label="Outcome"
              value={config.outcomeColumn}
              onChange={(outcomeColumn) => set({ outcomeColumn, covariateColumns: config.covariateColumns.filter((c) => c !== outcomeColumn) })}
              options={columnOptions}
            />
            <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 'var(--s2)' }}>Covariates to adjust for</legend>
              {covariateChoices.map((name) => (
                <Checkbox
                  key={name}
                  label={name}
                  checked={config.covariateColumns.includes(name)}
                  onChange={(on) =>
                    set({
                      covariateColumns: on
                        ? [...config.covariateColumns.filter((c) => c !== name), name]
                        : config.covariateColumns.filter((c) => c !== name),
                    })
                  }
                />
              ))}
              {!covariateChoices.length && <p className="oc-muted" style={{ fontSize: 12.5 }}>No other columns are available as covariates.</p>}
            </fieldset>
            {vectors.missingCovariates.length > 0 && (
              <Notice tone="warning">
                {vectors.missingCovariates.join(', ')} {vectors.missingCovariates.length === 1 ? 'is' : 'are'} selected but no longer present in the data, so{' '}
                {vectors.missingCovariates.length === 1 ? 'it is' : 'they are'} not adjusted for.
              </Notice>
            )}
            <Notice tone="info" title="Which covariates belong here is not a statistical question">
              Adjusting for a variable on the causal path from treatment to outcome, or for a common effect of both, makes the estimate worse rather than better.
              The engine cannot tell the difference: it adjusts for what it is given.
            </Notice>
          </Card>

          <Card title="Estimation options">
            <NumberField label="Confidence level" value={config.level} onChange={(level) => set({ level })} min={0.5} max={0.999} step={0.01} />
            <Checkbox
              label="Restrict to the propensity-score common support"
              checked={config.trimCommonSupport}
              onChange={(trimCommonSupport) => set({ trimCommonSupport })}
              description="Drops units with no counterpart in the other arm. It improves the comparison and changes the estimand: the answer then applies only to the units kept."
            />
            <Segmented
              label="IPW target"
              value={config.ipwEstimand}
              onChange={(ipwEstimand) => set({ ipwEstimand })}
              options={[
                { value: 'ATE', label: 'ATE' },
                { value: 'ATT', label: 'ATT' },
              ]}
            />
            <Checkbox label="Stabilised IPW weights" checked={config.ipwStabilised} onChange={(ipwStabilised) => set({ ipwStabilised })} description="Scales the weights by the marginal treatment probability. It tames the variance; it does not fix a lack of overlap." />
            <Segmented
              label="g-computation inference"
              value={config.gcompInference}
              onChange={(gcompInference) => set({ gcompInference })}
              options={[
                { value: 'delta', label: 'Delta method' },
                { value: 'bootstrap', label: 'Bootstrap (400 refits)' },
              ]}
            />
            <NumberField
              label="Matching caliper on the propensity score"
              value={config.matchCaliper}
              onChange={(matchCaliper) => set({ matchCaliper })}
              min={0}
              max={1}
              step={0.01}
              hint="0 means no caliper: every treated unit is matched to its nearest control however far away that is. A caliper refuses a bad match instead of stretching it."
            />
            <Checkbox label="Match with replacement" checked={config.matchWithReplacement} onChange={(matchWithReplacement) => set({ matchWithReplacement })} description="Lets one control serve several treated units. It improves the match quality and breaks the independence of the pairs, so the standard error is bootstrapped instead of paired." />
            <NumberField label="Smallest value the outcome can logically take" value={config.outcomeLow} onChange={(outcomeLow) => set({ outcomeLow })} hint="Used only by the Manski bounds below, which depend on the outcome's logical limits rather than on the observed range." />
            <NumberField label="Largest value the outcome can logically take" value={config.outcomeHigh} onChange={(outcomeHigh) => set({ outcomeHigh })} />
          </Card>

          <AiAssistPanel
            capability="draftAssumptions"
            context="The assumptions card lists what the selected method actually requires, and which of those cannot be tested from these data. Use it to write down why you believe each one here."
          />
        </div>

        <div className="oc-stack">
          {!spec && (
            <Notice tone="error" title="No estimate is possible yet">
              A treatment column and an outcome column with at least one usable unit are needed. Nothing is estimated and no placeholder is shown.
            </Notice>
          )}

          {/* -------------------------------------------------- 2. estimand */}
          <Card title="The estimand: which quantity is being estimated">
            {focusEstimate ? (
              <>
                <KeyValueList
                  items={[
                    { label: 'Method', value: focusEstimate.method },
                    { label: 'Estimand', value: focusEstimate.estimand.kind },
                    { label: 'Contrast', value: <code>{focusEstimate.estimand.contrast}</code> },
                    { label: 'Who the number is about', value: focusEstimate.estimand.targetPopulation },
                    { label: 'Exactness', value: <Badge variant={focusEstimate.exactness}>{EXACTNESS_LABEL[focusEstimate.exactness]}</Badge> },
                  ]}
                />
                <Segmented
                  label="Method whose estimand, assumptions and sensitivity are shown"
                  value={config.focusMethod}
                  onChange={(focusMethod) => set({ focusMethod })}
                  options={[
                    { value: 'naive', label: 'Naive' },
                    { value: 'ipw', label: 'IPW' },
                    { value: 'gcomp', label: 'g-comp' },
                    { value: 'aipw', label: 'AIPW' },
                    { value: 'matching', label: 'Matching' },
                  ]}
                />
              </>
            ) : (
              focus && !focus.ok && <Notice tone="error" title={`${METHOD_LABEL[config.focusMethod]} produced no estimate`}>{focus.error}</Notice>
            )}
            <div style={{ overflowX: 'auto' }}>
              <DataTable
                caption="The estimands the methods on this screen target"
                columns={[
                  { key: 'k', header: 'Estimand', render: (r: { kind: Estimand }) => describeEstimand(r.kind).kind },
                  { key: 'c', header: 'Contrast', render: (r: { kind: Estimand }) => <code>{describeEstimand(r.kind).contrast}</code> },
                  { key: 'p', header: 'Population it is about', render: (r: { kind: Estimand }) => describeEstimand(r.kind).targetPopulation },
                ]}
                rows={ESTIMAND_REFERENCE.map((kind) => ({ kind }))}
              />
            </div>
            <p className="oc-chart-note">
              These are different quantities, not different estimates of one quantity. An instrument answers the LATE question for compliers and a discontinuity
              answers it at the cutoff; neither becomes the average effect by being quoted as one.
            </p>
            <Notice tone="warning" title="The fundamental problem of causal inference">{FUNDAMENTAL_PROBLEM}</Notice>
          </Card>

          {/* -------------------------------------- 3. naive versus adjusted */}
          <Card title="Naive versus adjusted" hint="The same data, five estimators. The gap between the first row and the others is the measured confounding.">
            <div style={{ overflowX: 'auto' }}>
              <DataTable
                caption="Unadjusted and adjusted estimates with standard errors and intervals"
                columns={[
                  { key: 'm', header: 'Estimator', render: (r) => r.label },
                  { key: 'q', header: 'Estimand', render: (r) => r.estimate?.estimand.kind ?? '—' },
                  { key: 'e', header: 'Estimate', numeric: true, render: (r) => (r.estimate ? formatValue(r.estimate.estimate, 4) : 'no estimate') },
                  { key: 's', header: 'Standard error', numeric: true, render: (r) => (r.estimate?.standardError === null || !r.estimate ? '—' : formatValue(r.estimate.standardError, 4)) },
                  { key: 'i', header: 'Interval', render: (r) => (r.estimate ? interval(r.estimate) : '—') },
                  { key: 'n', header: 'Units used', numeric: true, render: (r) => (r.estimate ? `${r.estimate.sample.nUsed} of ${r.estimate.sample.nTotal}` : '—') },
                  { key: 'x', header: 'Exactness', render: (r) => (r.estimate ? EXACTNESS_LABEL[r.estimate.exactness] : '—') },
                ]}
                rows={comparison}
              />
            </div>
            {comparison.filter((r) => r.error !== null).map((r) => (
              <Notice tone="error" key={r.method} title={`${r.label} produced no number`}>
                {r.error}
              </Notice>
            ))}
            {confoundingGap && (
              <Notice tone="info" title="What the gap is, and what it is not">
                <p style={{ marginTop: 0 }}>
                  The unadjusted contrast is {formatValue(confoundingGap.naive, 4)}; {confoundingGap.label} gives {formatValue(confoundingGap.adjusted, 4)}. The
                  difference of {formatValue(confoundingGap.gap, 4)} is the confounding that the measured covariates account for.
                </p>
                <p style={{ marginBottom: 0 }}>
                  It says nothing whatever about unmeasured confounding. A large gap shows the covariates mattered; a small gap does not show that there was
                  nothing to adjust for. The sensitivity card below is the only place on this screen that addresses what is unmeasured.
                </p>
              </Notice>
            )}
            {comparison.map((r) =>
              r.estimate && r.estimate.warnings.length ? (
                <Notice tone="warning" key={`w-${r.method}`} title={`${r.label}: what the engine reported`} items={r.estimate.warnings} />
              ) : null,
            )}
          </Card>

          {/* ------------------------------------------ 4. overlap & balance */}
          <Card title="Overlap and balance" hint="Whether the adjusted estimate describes an average at all.">
            {ipwBalance ? (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Standardised mean differences before and after weighting"
                    columns={balanceColumns}
                    rows={ipwBalance.before.map((row, i) => ({ row, after: ipwBalance.after ? ipwBalance.after[i] : null }))}
                  />
                </div>
                <KeyValueList
                  items={[
                    { label: 'Worst SMD before adjustment', value: formatValue(ipwBalance.worstBeforeSmd, 3) },
                    { label: 'Worst SMD after weighting', value: ipwBalance.worstAfterSmd === null ? 'not adjusted' : formatValue(ipwBalance.worstAfterSmd, 3) },
                    { label: 'Threshold used', value: `±${ipwBalance.smdThreshold} standardised units (conventional)` },
                  ]}
                />
                {ipwBalance.warnings.length > 0 && <Notice tone="warning" title="Balance warnings from the engine" items={ipwBalance.warnings} />}
                {matching && matching.ok && (
                  <KeyValueList
                    items={[
                      { label: 'Worst SMD after matching', value: matching.value.balance.worstAfterSmd === null ? 'not available' : formatValue(matching.value.balance.worstAfterSmd, 3) },
                      { label: 'Matched pairs', value: matching.value.match.pairs.length.toLocaleString('en-US') },
                      { label: 'Treated units with no acceptable match', value: matching.value.match.unmatchedTreated.length.toLocaleString('en-US') },
                      { label: 'Controls never used', value: matching.value.match.unusedControl.length.toLocaleString('en-US') },
                    ]}
                  />
                )}
              </>
            ) : (
              <p className="oc-muted" style={{ fontSize: 12.5 }}>Balance is reported from the fitted propensity model, which is not available.</p>
            )}

            {overlap && !overlap.ok && <Notice tone="error" title="No overlap report">{overlap.error}</Notice>}
            {overlap && overlap.ok && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Propensity range, treated', value: `${formatValue(overlap.value.treatedRange[0], 3)} to ${formatValue(overlap.value.treatedRange[1], 3)}` },
                    { label: 'Propensity range, control', value: `${formatValue(overlap.value.controlRange[0], 3)} to ${formatValue(overlap.value.controlRange[1], 3)}` },
                    {
                      label: 'Common support',
                      value: overlap.value.commonSupport
                        ? `${formatValue(overlap.value.commonSupport[0], 3)} to ${formatValue(overlap.value.commonSupport[1], 3)}`
                        : 'the two arms do not overlap at all',
                    },
                    { label: 'Units outside common support', value: `${overlap.value.nOutsideCommonSupport} (${formatPercent(overlap.value.proportionOutsideCommonSupport, 3)})` },
                  ]}
                />
                {overlap.value.warnings.length > 0 && <Notice tone="warning" title="Overlap warnings from the engine" items={overlap.value.warnings} />}
                {propensityHistograms && (
                  <div style={{ overflowX: 'auto' }}>
                    <HistogramChart
                      title="Propensity score, treated arm"
                      description="Distribution of the fitted propensity score among treated units, on the bin edges the engine reports."
                      bins={propensityHistograms.treated}
                      xLabel="Fitted propensity score"
                      note="A region where one arm has units and the other has none contributes no comparison, whatever the weights say."
                    />
                    <HistogramChart
                      title="Propensity score, control arm"
                      description="Distribution of the fitted propensity score among control units, on the same bin edges."
                      bins={propensityHistograms.control}
                      xLabel="Fitted propensity score"
                    />
                  </div>
                )}
              </>
            )}

            {weights && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Weighting scheme', value: weights.kind },
                    { label: 'Maximum weight', value: formatValue(weights.maxWeight, 4) },
                    { label: 'Effective sample size (Kish)', value: `${formatValue(weights.effectiveSampleSize, 4)} of ${spec ? spec.outcome.length : 0}` },
                    { label: 'Effective sample size, treated', value: formatValue(weights.effectiveSampleSizeTreated, 4) },
                    { label: 'Effective sample size, control', value: formatValue(weights.effectiveSampleSizeControl, 4) },
                    { label: 'Share of all weight in the heaviest 1%', value: formatPercent(weights.topOnePercentWeightShare, 3) },
                  ]}
                />
                {weights.warnings.length > 0 && <Notice tone="warning" title="Weight warnings from the engine" items={weights.warnings} />}
                <p className="oc-chart-note">
                  An IPW estimate whose effective sample size has collapsed is not an estimate of an average over the sample: it is a description of the handful
                  of units carrying the weight. Read the maximum weight and the effective sample size before the estimate.
                </p>
              </>
            )}
          </Card>

          {/* ------------------------------- 5. quasi-experimental designs */}
          <Card title="Quasi-experimental designs" hint="Each of these identifies an effect from a different feature of the data, and each targets a different estimand.">
            <Segmented
              label="Design"
              value={config.design}
              onChange={(design) => set({ design })}
              options={[
                { value: 'iv', label: 'Instrument' },
                { value: 'did', label: 'Diff-in-diff' },
                { value: 'rdd', label: 'Discontinuity' },
              ]}
            />

            {!config.runDesign && (
              <>
                <Notice tone="info" title="The selected design is not computed automatically">
                  <p style={{ marginTop: 0 }}>
                    The instrumental-variables panel inverts the Anderson–Rubin test over a grid of candidate effects, which takes roughly three quarters of a
                    second on this data. That is the honest way to report an instrument — the set stays valid however weak the instrument is — but it is too
                    slow to run before the screen is drawn, so it waits for you.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    The difference-in-differences and discontinuity panels are quick; the button computes whichever design is selected above.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="play" variant="primary" onClick={() => set({ runDesign: true })} disabled={!spec}>
                    {`Compute the ${DESIGN_LABEL[config.design].toLowerCase()} design`}
                  </Button>
                </div>
                {!spec && <p className="oc-muted" style={{ fontSize: 12.5 }}>There is no usable data yet, so there is no design to estimate.</p>}
              </>
            )}

            {config.runDesign && config.design === 'iv' && (
              <>
                <SelectField label="Instrument" value={config.instrumentColumn} onChange={(instrumentColumn) => set({ instrumentColumn })} options={columnOptions} hint="A variable that shifts treatment but has no path to the outcome except through it. That exclusion is an assumption about the world, not a property of the data." />
                {iv && !iv.ok && <Notice tone="error" title="No instrumental-variables estimate">{iv.error}</Notice>}
                {iv && iv.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'LATE (2SLS)', value: formatValue(iv.value.estimate.estimate, 4) },
                        { label: 'Standard error', value: iv.value.estimate.standardError === null ? 'not available' : formatValue(iv.value.estimate.standardError, 4) },
                        { label: 'Interval', value: interval(iv.value.estimate) },
                        { label: 'OLS estimate, for comparison', value: formatValue(iv.value.diagnostics.olsEstimate, 4) },
                        { label: 'First-stage F on the instrument', value: `${formatValue(iv.value.diagnostics.firstStage.fStatistic, 4)} (conventional threshold ${WEAK_INSTRUMENT_F})` },
                        { label: 'Partial R² of the instrument', value: formatPercent(iv.value.diagnostics.firstStage.partialR2, 3) },
                        { label: 'Instrument strength', value: iv.value.diagnostics.firstStage.weak ? 'weak — see the warning below' : 'above the conventional threshold' },
                        { label: 'Complier share', value: iv.value.diagnostics.complierShare === null ? 'not identified here' : formatPercent(iv.value.diagnostics.complierShare, 3) },
                        {
                          label: 'Anderson–Rubin set',
                          value: iv.value.diagnostics.andersonRubin.intervals.map((i) => `${formatValue(i.low, 4)} to ${formatValue(i.high, 4)}`).join(', ') || 'empty',
                        },
                        { label: 'Overidentification (Sargan)', value: iv.value.diagnostics.overidentification === null ? 'exactly identified, so no test exists' : `J = ${formatValue(iv.value.diagnostics.overidentification.statistic, 4)}, p = ${formatValue(iv.value.diagnostics.overidentification.pValue, 4)}` },
                        { label: 'Exactness', value: <Badge variant={iv.value.estimate.exactness}>{EXACTNESS_LABEL[iv.value.estimate.exactness]}</Badge> },
                      ]}
                    />
                    <Notice tone="warning" title="This is the LATE, not the ATE">
                      {iv.value.estimate.estimand.targetPopulation}
                    </Notice>
                    {iv.value.diagnostics.firstStage.warnings.length > 0 && (
                      <Notice tone="warning" title="Weak-instrument warning, with the direction of the bias" items={iv.value.diagnostics.firstStage.warnings} />
                    )}
                    <p className="oc-chart-note">{iv.value.diagnostics.andersonRubin.note}</p>
                    {iv.value.estimate.warnings.length > 0 && <Notice tone="warning" title="Warnings from the engine" items={iv.value.estimate.warnings} />}
                  </>
                )}
              </>
            )}

            {config.runDesign && config.design === 'did' && (
              <>
                <TextField
                  label="Panel data (header line, then one unit-period per line)"
                  value={config.panelText}
                  onChange={(panelText) => set({ panelText })}
                  multiline
                  rows={8}
                  monospace
                  maxLength={400_000}
                  hint="Needs columns named unit, time, outcome and treated. Loaded with a synthetic balanced panel of 16 units over 8 periods whose true effect is +3.0."
                />
                {config.panelText !== BUILT_IN_PANEL && (
                  <Button size="sm" variant="ghost" onClick={() => set({ panelText: BUILT_IN_PANEL })}>
                    Restore the built-in panel
                  </Button>
                )}
                {panel && panel.headerError && <Notice tone="error">{panel.headerError}</Notice>}
                {panel && panel.problems.length > 0 && (
                  <Notice tone="warning" title={`${panel.problems.length} panel line(s) could not be read`} items={panel.problems.slice(0, 8).map((p) => `Line ${p.line}: ${p.reason}.`)} />
                )}
                {did && (
                  <>
                    {!did.twoByTwo.ok && <Notice tone="error" title="No difference-in-differences estimate">{did.twoByTwo.error}</Notice>}
                    {did.twoByTwo.ok && (
                      <KeyValueList
                        items={[
                          { label: 'First period under treatment', value: did.firstTreated === null ? 'none' : String(did.firstTreated) },
                          { label: '2×2 difference-in-differences', value: formatValue(did.twoByTwo.value.estimate, 4) },
                          { label: 'Standard error', value: did.twoByTwo.value.standardError === null ? 'not available' : formatValue(did.twoByTwo.value.standardError, 4) },
                          { label: 'Interval', value: interval(did.twoByTwo.value) },
                          { label: 'Estimand', value: `${did.twoByTwo.value.estimand.kind} — ${did.twoByTwo.value.estimand.targetPopulation}` },
                          { label: 'Inference', value: did.twoByTwo.value.inferenceNote },
                          { label: 'Exactness', value: <Badge variant={did.twoByTwo.value.exactness}>{EXACTNESS_LABEL[did.twoByTwo.value.exactness]}</Badge> },
                        ]}
                      />
                    )}
                    {did.twoByTwo.ok && did.twoByTwo.value.warnings.length > 0 && <Notice tone="warning" title="Warnings from the engine" items={did.twoByTwo.value.warnings} />}
                    {did.event && !did.event.ok && <Notice tone="error" title="No event study">{did.event.error}</Notice>}
                    {did.event && did.event.ok && (
                      <>
                        <div style={{ overflowX: 'auto' }}>
                          <LineChart
                            title="Event study: one coefficient per period relative to adoption"
                            description="Estimated effect by event time, with the confidence interval as two dashed curves. The reference period is zero by construction, and the pre-adoption periods are the pre-trend check."
                            series={[
                              { label: 'Coefficient', points: did.event.value.points.map((p) => ({ x: p.eventTime, y: p.coefficient })) },
                              { label: 'Interval, lower', points: did.event.value.points.map((p) => ({ x: p.eventTime, y: p.ciLow })), dashed: true },
                              { label: 'Interval, upper', points: did.event.value.points.map((p) => ({ x: p.eventTime, y: p.ciHigh })), dashed: true },
                            ]}
                            xLabel="Periods relative to adoption"
                            yLabel="Effect on the outcome"
                            referenceLines={[
                              { value: 0, label: 'No effect', axis: 'y' },
                              { value: 0, label: 'Adoption', axis: 'x' },
                            ]}
                            note="Pre-adoption coefficients scattered around zero are consistent with parallel trends. They do not establish it: the assumption is about the counterfactual path after adoption, which no pre-period can show."
                          />
                        </div>
                        <KeyValueList
                          items={[
                            { label: 'Reference event time', value: String(did.event.value.referenceEventTime) },
                            {
                              label: 'Joint pre-trend test',
                              value:
                                did.event.value.preTrendTest === null
                                  ? 'not available (too few pre-periods)'
                                  : `F = ${formatValue(did.event.value.preTrendTest.statistic, 4)} on ${did.event.value.preTrendTest.numeratorDf} and ${did.event.value.preTrendTest.denominatorDf} df, p = ${formatValue(did.event.value.preTrendTest.pValue, 4)}`,
                            },
                          ]}
                        />
                        <div style={{ overflowX: 'auto' }}>
                          <DataTable
                            caption="Event-study coefficients"
                            columns={[
                              { key: 't', header: 'Event time', numeric: true, render: (p) => (p.reference ? `${p.eventTime} (reference)` : String(p.eventTime)) },
                              { key: 'c', header: 'Coefficient', numeric: true, render: (p) => formatValue(p.coefficient, 4) },
                              { key: 's', header: 'Standard error', numeric: true, render: (p) => formatValue(p.standardError, 4) },
                              { key: 'i', header: 'Interval', render: (p) => `${formatValue(p.ciLow, 4)} to ${formatValue(p.ciHigh, 4)}` },
                              { key: 'n', header: 'Observations', numeric: true, render: (p) => p.nObservations.toLocaleString('en-US') },
                            ]}
                            rows={did.event.value.points}
                          />
                        </div>
                        {did.event.value.warnings.length > 0 && <Notice tone="warning" title="Event-study warnings" items={did.event.value.warnings} />}
                        <Notice tone="warning" title="Parallel trends is the assumption, and it is untestable" items={did.event.value.assumptions.filter((a) => !a.testable).map((a) => `${a.name}: ${a.statement}`)} />
                        <p className="oc-chart-note">{did.event.value.untestability}</p>
                      </>
                    )}
                  </>
                )}
              </>
            )}

            {config.runDesign && config.design === 'rdd' && (
              <>
                <SelectField label="Running variable" value={config.runningColumn} onChange={(runningColumn) => set({ runningColumn })} options={columnOptions} />
                <NumberField label="Cutoff" value={config.rddCutoff} onChange={(rddCutoff) => set({ rddCutoff })} />
                <NumberField label="Bandwidth (0 uses the Imbens–Kalyaraman choice)" value={config.rddBandwidth} onChange={(rddBandwidth) => set({ rddBandwidth })} min={0} />
                {rdd && !rdd.fit.ok && <Notice tone="error" title="No regression-discontinuity estimate">{rdd.fit.error}</Notice>}
                {rdd && rdd.fit.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Effect at the cutoff', value: formatValue(rdd.fit.value.estimate.estimate, 4) },
                        { label: 'Standard error', value: rdd.fit.value.estimate.standardError === null ? 'not available' : formatValue(rdd.fit.value.estimate.standardError, 4) },
                        { label: 'Interval', value: interval(rdd.fit.value.estimate) },
                        { label: 'Bandwidth', value: `${formatValue(rdd.fit.value.bandwidth, 4)} (${rdd.fit.value.bandwidthSource})` },
                        { label: 'Local-linear limit from below', value: formatValue(rdd.fit.value.leftLimit, 4) },
                        { label: 'Local-linear limit from above', value: formatValue(rdd.fit.value.rightLimit, 4) },
                        { label: 'Observations within the bandwidth', value: `${rdd.fit.value.nLeft} below, ${rdd.fit.value.nRight} above` },
                        {
                          label: 'Local-quadratic bias-corrected estimate',
                          value: rdd.fit.value.biasCorrected === null ? 'not available' : `${formatValue(rdd.fit.value.biasCorrected.estimate, 4)} (se ${formatValue(rdd.fit.value.biasCorrected.standardError, 4)})`,
                        },
                        { label: 'Estimand', value: `${rdd.fit.value.estimate.estimand.kind} — ${rdd.fit.value.estimate.estimand.targetPopulation}` },
                        { label: 'Exactness', value: <Badge variant={rdd.fit.value.estimate.exactness}>{EXACTNESS_LABEL[rdd.fit.value.estimate.exactness]}</Badge> },
                      ]}
                    />
                    {rdd.running && spec && (
                      <div style={{ overflowX: 'auto' }}>
                        <ScatterChart
                          title="Outcome against the running variable"
                          description={`Every unit plotted against the running variable. The local-linear fit is estimated separately on each side of the cutoff at ${formatValue(config.rddCutoff, 4)} with a triangular kernel and bandwidth ${formatValue(rdd.fit.value.bandwidth, 4)}; its two boundary values are listed above.`}
                          points={rdd.running.map((x, i) => ({ x, y: spec.outcome[i] }))}
                          xLabel={config.runningColumn}
                          yLabel={config.outcomeColumn}
                          note={`The estimate is the jump between the two boundary values, ${formatValue(rdd.fit.value.leftLimit, 4)} below and ${formatValue(rdd.fit.value.rightLimit, 4)} above the cutoff. Units far from the cutoff carry no weight in it.`}
                        />
                      </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="The same estimate at other bandwidths"
                        columns={[
                          { key: 'h', header: 'Bandwidth', numeric: true, render: (r) => formatValue(r.bandwidth, 4) },
                          { key: 'e', header: 'Estimate', numeric: true, render: (r) => formatValue(r.estimate, 4) },
                          { key: 's', header: 'Standard error', numeric: true, render: (r) => (r.standardError === null ? '—' : formatValue(r.standardError, 4)) },
                          { key: 'n', header: 'Note', render: (r) => r.note ?? '' },
                        ]}
                        rows={rdd.fit.value.bandwidthSensitivity}
                      />
                    </div>
                    {rdd.fit.value.estimate.warnings.length > 0 && <Notice tone="warning" title="Warnings from the engine" items={rdd.fit.value.estimate.warnings} />}
                    <Notice tone="warning" title="Continuity at the cutoff is the assumption" items={rdd.fit.value.estimate.assumptions.filter((a) => !a.testable).map((a) => `${a.name}: ${a.statement}`)} />
                  </>
                )}
                {rdd && rdd.mccrary && !rdd.mccrary.ok && <Notice tone="warning" title="No McCrary density test">{rdd.mccrary.error}</Notice>}
                {rdd && rdd.mccrary && rdd.mccrary.ok && (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'McCrary log-density jump', value: formatValue(rdd.mccrary.value.logDensityJump, 4) },
                        { label: 'z', value: `${formatValue(rdd.mccrary.value.zStatistic, 4)}, p = ${formatValue(rdd.mccrary.value.pValue, 4)}` },
                        { label: 'Manipulation detected', value: rdd.mccrary.value.manipulationDetected ? 'yes — a discontinuity in the density itself' : 'no discontinuity in the density at this test’s resolution' },
                        { label: 'Bin width / bandwidth', value: `${formatValue(rdd.mccrary.value.binWidth, 4)} / ${formatValue(rdd.mccrary.value.bandwidth, 4)}` },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <HistogramChart
                        title="Density of the running variable around the cutoff"
                        description="Binned counts of the running variable, from the McCrary test's own bins. A step in this density is evidence that units moved themselves across the cutoff."
                        bins={rdd.mccrary.value.binCounts.map((count, i) => {
                          const w = rdd.mccrary && rdd.mccrary.ok ? rdd.mccrary.value.binWidth : 1;
                          const mid = rdd.mccrary && rdd.mccrary.ok ? rdd.mccrary.value.binMidpoints[i] : 0;
                          const total = rdd.mccrary && rdd.mccrary.ok ? rdd.mccrary.value.binCounts.reduce((a, b) => a + b, 0) : 1;
                          return { x0: mid - w / 2, x1: mid + w / 2, count, density: total > 0 && w > 0 ? count / total / w : 0, proportion: total > 0 ? count / total : 0 };
                        })}
                        xLabel={config.runningColumn}
                        markers={[{ x: config.rddCutoff, label: 'Cutoff' }]}
                      />
                    </div>
                    <p className="oc-chart-note">{rdd.mccrary.value.note}</p>
                    {rdd.mccrary.value.warnings.length > 0 && <Notice tone="warning" title="Density-test warnings" items={rdd.mccrary.value.warnings} />}
                  </>
                )}
              </>
            )}
            {config.runDesign && (
              <div className="oc-btn-row">
                <Button size="sm" variant="ghost" onClick={() => set({ runDesign: false })}>
                  Stop computing this design
                </Button>
              </div>
            )}
            <p className="oc-chart-note">
              {DESIGN_LABEL[config.design]} replaces the ignorability assumption with a different one. It does not remove the need for an assumption, and the
              quantity it identifies is narrower than the average effect.
            </p>
          </Card>

          {/* --------------------------------------------- 6. sensitivity */}
          <Card title="Sensitivity: what it would take to overturn this" hint="The key assumption cannot be tested, so the useful question is how strong a violation would have to be.">
            {!sensitivity && <p className="oc-muted" style={{ fontSize: 12.5 }}>No estimate is selected, so there is nothing to probe.</p>}
            {sensitivity && (
              <>
                {sensitivity.ev.ok ? (
                  <KeyValueList
                    items={[
                      { label: 'E-value for the point estimate', value: formatValue(sensitivity.ev.value.pointEValue, 4) },
                      { label: 'E-value for the confidence limit', value: formatValue(sensitivity.ev.value.limitEValue, 4) },
                      { label: 'Limit used', value: sensitivity.ev.value.limitUsed === null ? 'the interval includes the null, so no limit is used' : formatValue(sensitivity.ev.value.limitUsed, 4) },
                      { label: 'Risk ratio it was computed from', value: formatValue(sensitivity.ev.value.riskRatio, 4) },
                      { label: 'Exactness', value: <Badge variant={sensitivity.ev.value.exactness}>{EXACTNESS_LABEL[sensitivity.ev.value.exactness]}</Badge> },
                    ]}
                  />
                ) : (
                  <Notice tone="warning" title="No E-value">{sensitivity.ev.error}</Notice>
                )}
                {sensitivity.ev.ok && (
                  <>
                    <p className="oc-chart-note">{sensitivity.ev.value.interpretation}</p>
                    {sensitivity.ev.value.warnings.length > 0 && <Notice tone="warning" title="How the E-value was obtained" items={sensitivity.ev.value.warnings} />}
                  </>
                )}

                {sensitivity.ch.ok ? (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Robustness value (to nullify the estimate)', value: formatPercent(sensitivity.ch.value.robustnessValue, 3) },
                        { label: 'Robustness value (to lose significance)', value: formatPercent(sensitivity.ch.value.robustnessValueSignificance, 3) },
                        { label: 'Partial R² of treatment with outcome', value: formatPercent(sensitivity.ch.value.partialR2TreatmentOutcome, 3) },
                        { label: 'Residual degrees of freedom used', value: sensitivity.df.toLocaleString('en-US') },
                        { label: 'Exactness', value: <Badge variant={sensitivity.ch.value.exactness}>{EXACTNESS_LABEL[sensitivity.ch.value.exactness]}</Badge> },
                      ]}
                    />
                    <p className="oc-chart-note">{sensitivity.ch.value.interpretation}</p>
                    {contourGrid && (
                      <div style={{ overflowX: 'auto' }}>
                        <HeatmapChart
                          title="Cinelli–Hazlett contours: the adjusted estimate under a confounder of given strength"
                          description="Each cell is the estimate that would remain if an unmeasured confounder explained that share of the residual variation in the treatment (columns) and in the outcome (rows)."
                          rows={contourGrid.rows}
                          columns={contourGrid.columns}
                          values={contourGrid.values}
                          valueLabel="Adjusted estimate"
                          diverging
                        />
                      </div>
                    )}
                    {sensitivity.ch.value.warnings.length > 0 && <Notice tone="warning" title="Robustness-value warnings" items={sensitivity.ch.value.warnings} />}
                  </>
                ) : (
                  <Notice tone="warning" title="No robustness value">{sensitivity.ch.error}</Notice>
                )}

                {sensitivity.rosen.ok ? (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Rosenbaum bounds across hidden-bias magnitudes"
                        columns={[
                          { key: 'g', header: 'Γ', numeric: true, render: (r) => formatValue(r.gamma, 3) },
                          { key: 'u', header: 'Worst-case one-sided p', numeric: true, render: (r) => formatValue(r.upperPValue, 4) },
                          { key: 'l', header: 'Most favourable p', numeric: true, render: (r) => formatValue(r.lowerPValue, 4) },
                          { key: 's', header: 'Still significant at this Γ', render: (r) => (r.significantAtGamma ? 'yes' : 'no') },
                        ]}
                        rows={sensitivity.rosen.value.bounds}
                      />
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Matched pairs used', value: sensitivity.rosen.value.nPairs.toLocaleString('en-US') },
                        { label: 'Largest Γ still significant', value: sensitivity.rosen.value.criticalGamma === null ? 'none — the result does not survive Γ = 1 of hidden bias' : formatValue(sensitivity.rosen.value.criticalGamma, 3) },
                        { label: 'Exactness', value: <Badge variant={sensitivity.rosen.value.exactness}>{EXACTNESS_LABEL[sensitivity.rosen.value.exactness]}</Badge> },
                      ]}
                    />
                    <p className="oc-chart-note">{sensitivity.rosen.value.interpretation}</p>
                    {sensitivity.rosen.value.warnings.length > 0 && <Notice tone="warning" title="Rosenbaum-bound warnings" items={sensitivity.rosen.value.warnings} />}
                  </>
                ) : (
                  <Notice tone="info" title="No Rosenbaum bounds">{sensitivity.rosen.error}</Notice>
                )}

                {sensitivity.manski.ok ? (
                  <>
                    <Notice tone="info" title="Manski bounds: the answer with no assumption about assignment at all">
                      <p style={{ marginTop: 0 }}>
                        The average effect lies between {formatValue(sensitivity.manski.value.lower, 4)} and {formatValue(sensitivity.manski.value.upper, 4)}, a
                        width of {formatValue(sensitivity.manski.value.width, 4)} on an outcome confined to [{formatValue(sensitivity.manski.value.outcomeRange[0], 4)},{' '}
                        {formatValue(sensitivity.manski.value.outcomeRange[1], 4)}].
                      </p>
                      <p style={{ marginBottom: 0 }}>
                        That width is not a failure of the method. It is what these data imply about the effect once ignorability is not granted: every narrower
                        number on this screen is bought with an untestable assumption.
                      </p>
                    </Notice>
                    <KeyValueList
                      items={[
                        { label: 'Bounds on E[Y(1)]', value: `${formatValue(sensitivity.manski.value.meanY1.low, 4)} to ${formatValue(sensitivity.manski.value.meanY1.high, 4)}` },
                        { label: 'Bounds on E[Y(0)]', value: `${formatValue(sensitivity.manski.value.meanY0.low, 4)} to ${formatValue(sensitivity.manski.value.meanY0.high, 4)}` },
                        { label: 'Exactness', value: <Badge variant={sensitivity.manski.value.estimate.exactness}>{EXACTNESS_LABEL[sensitivity.manski.value.estimate.exactness]}</Badge> },
                      ]}
                    />
                    <p className="oc-chart-note">{sensitivity.manski.value.estimate.fundamentalProblem}</p>
                  </>
                ) : (
                  <Notice tone="warning" title="No Manski bounds">{sensitivity.manski.error}</Notice>
                )}
              </>
            )}
          </Card>

          {/* ---------------------------------------------- 7. discovery */}
          <Card title="Structure discovery" hint="What the independence structure of these columns alone can and cannot settle.">
            {!config.runDiscovery ? (
              <>
                <Notice tone="info" title="The structure search is not run automatically">
                  <p style={{ marginTop: 0 }}>
                    The PC algorithm tests conditional independence for every pair of columns against every conditioning set, and the stability report runs the
                    whole search again at each of three significance levels. On this data that is around a second of blocked interface, so it is something you
                    ask for rather than something that happens on opening the screen.
                  </p>
                  <p style={{ marginBottom: 0 }}>
                    What comes back is a Markov equivalence class, not a causal diagram: several different diagrams imply exactly the same independences.
                  </p>
                </Notice>
                <div className="oc-btn-row">
                  <Button icon="network" variant="primary" onClick={() => set({ runDiscovery: true })} disabled={!spec}>
                    Run the structure search
                  </Button>
                </div>
                {!spec && <p className="oc-muted" style={{ fontSize: 12.5 }}>There is no usable data yet, so there is nothing to search.</p>}
              </>
            ) : (
              <>
                <NumberField label="Significance level for the independence tests" value={config.discoveryAlpha} onChange={(discoveryAlpha) => set({ discoveryAlpha })} min={0.001} max={0.5} step={0.01} />
                <div className="oc-btn-row">
                  <Button size="sm" variant="ghost" onClick={() => set({ runDiscovery: false })}>
                    Stop running the structure search
                  </Button>
                </div>
                {discovery && !discovery.cpdag.ok && <Notice tone="error" title="No graph was recovered">{discovery.cpdag.error}</Notice>}
                {discovery && discovery.cpdag.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <NetworkGraph
                        title={`CPDAG at α = ${formatValue(discovery.cpdag.value.alpha, 3)}`}
                        description="The recovered equivalence class. An edge with a single arrowhead is oriented by the data; an edge drawn with an arrowhead at both ends is present but NOT orientable, and both directions are compatible with these independences."
                        nodes={discovery.cpdag.value.variables.map((v) => ({ id: v, label: v }))}
                        edges={[
                          ...discovery.cpdag.value.directed.map((e) => ({ from: e.from, to: e.to, label: 'oriented', emphasis: true })),
                          ...discovery.cpdag.value.undirected.flatMap((e) => [
                            { from: e.a, to: e.b, label: 'unoriented' },
                            { from: e.b, to: e.a, label: 'unoriented' },
                          ]),
                        ]}
                        note="Arrowheads at both ends of an edge mean the orientation is undetermined, not that the two variables cause each other."
                      />
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Oriented edges', value: discovery.cpdag.value.directed.length.toLocaleString('en-US') },
                        { label: 'Edges present but not orientable', value: discovery.cpdag.value.undirected.length.toLocaleString('en-US') },
                        { label: 'Colliders found', value: discovery.cpdag.value.colliders.map((c) => `${c.a} → ${c.collider} ← ${c.b}`).join('; ') || 'none' },
                        { label: 'Independence tests performed', value: discovery.cpdag.value.testsPerformed.toLocaleString('en-US') },
                      ]}
                    />
                    {discovery.cpdag.value.undirected.length > 0 && (
                      <div style={{ overflowX: 'auto' }}>
                        <DataTable
                          caption="Adjacencies whose direction the data do not settle"
                          columns={[
                            { key: 'a', header: 'Between', render: (r) => r.a },
                            { key: 'b', header: 'And', render: (r) => r.b },
                            { key: 'o', header: 'Orientation', render: () => 'not determined by these independences' },
                          ]}
                          rows={discovery.cpdag.value.undirected}
                        />
                      </div>
                    )}
                    <Notice tone="warning" title="What the search assumes" items={discovery.cpdag.value.assumptions.map((a) => `${a.name}${a.testable ? '' : ' (not testable from these data)'}: ${a.statement}`)} />
                    <p className="oc-chart-note">{discovery.cpdag.value.untestability}</p>
                    {discovery.cpdag.value.warnings.length > 0 && <Notice tone="warning" title="Warnings from the search" items={discovery.cpdag.value.warnings} />}
                  </>
                )}
                {discovery && discovery.stability.ok && (
                  <>
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="How the recovered graph changes with the significance level"
                        columns={[
                          { key: 'a', header: 'α', numeric: true, render: (r) => formatValue(r.alpha, 3) },
                          { key: 'e', header: 'Edges', numeric: true, render: (r) => r.nEdges.toLocaleString('en-US') },
                          { key: 'd', header: 'Oriented', numeric: true, render: (r) => r.nDirected.toLocaleString('en-US') },
                          { key: 'u', header: 'Unoriented', numeric: true, render: (r) => r.nUndirected.toLocaleString('en-US') },
                        ]}
                        rows={discovery.stability.value.runs}
                      />
                    </div>
                    <KeyValueList
                      items={[
                        { label: 'Adjacencies present at every level', value: discovery.stability.value.stableAdjacencies.map((a) => `${a.a}–${a.b}`).join(', ') || 'none' },
                        { label: 'Adjacencies that appear and disappear', value: discovery.stability.value.unstableAdjacencies.map((a) => `${a.a}–${a.b} (present at α = ${a.presentAt.join(', ')})`).join('; ') || 'none' },
                        { label: 'Edges whose orientation disagrees between levels', value: discovery.stability.value.orientationDisagreements.map((d) => `${d.a}–${d.b}: ${d.orientations.map((o) => `α ${o.alpha} → ${o.orientation}`).join(', ')}`).join('; ') || 'none' },
                        { label: 'Graph changed with α', value: discovery.stability.value.changed ? 'yes — the structure below is not a stable finding' : 'no — the same structure at every level tested' },
                      ]}
                    />
                    <p className="oc-chart-note">{discovery.stability.value.note}</p>
                    {discovery.stability.value.warnings.length > 0 && <Notice tone="warning" title="Stability warnings" items={discovery.stability.value.warnings} />}
                  </>
                )}
                {discovery && !discovery.stability.ok && <Notice tone="warning" title="No stability report">{discovery.stability.error}</Notice>}
              </>
            )}
          </Card>

          {/* --------------------------------------------- 8. assumptions */}
          <Card title={`Assumptions behind the ${focusEstimate ? focusEstimate.method : 'selected method'}`} hint="The engine will not build an estimate without this list. Reading the estimate without it is the most misleading thing this screen could do.">
            {!focusEstimate && <p className="oc-muted" style={{ fontSize: 12.5 }}>No estimate is available, so there is no assumption list to show.</p>}
            {focusEstimate && (
              <>
                <KeyValueList
                  items={[
                    { label: 'Assumptions required', value: focusEstimate.assumptions.length.toLocaleString('en-US') },
                    { label: 'Of those, not testable from these data', value: focusEstimate.assumptions.filter((a) => !a.testable).length.toLocaleString('en-US') },
                    { label: 'Exactness of the estimate', value: <Badge variant={focusEstimate.exactness}>{EXACTNESS_LABEL[focusEstimate.exactness]}</Badge> },
                  ]}
                />
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Assumptions, what each one says, and what the estimate becomes if it fails"
                    columns={[
                      { key: 'n', header: 'Assumption', render: (a: AssumptionStatement) => a.name },
                      { key: 't', header: 'Testable from these data', render: (a: AssumptionStatement) => (a.testable ? 'yes, in part' : 'no') },
                      { key: 's', header: 'What it says', render: (a: AssumptionStatement) => a.statement },
                      { key: 'v', header: 'If it is violated', render: (a: AssumptionStatement) => a.ifViolated },
                    ]}
                    rows={focusEstimate.assumptions}
                  />
                </div>
                <Notice tone="warning" title="Untestability">{focusEstimate.untestability}</Notice>
                <Notice tone="warning" title="The fundamental problem of causal inference">{focusEstimate.fundamentalProblem}</Notice>
                <KeyValueList
                  items={[
                    { label: 'How the standard error was obtained', value: focusEstimate.inferenceNote },
                    {
                      label: 'Sample accounting',
                      value: `${focusEstimate.sample.nUsed} of ${focusEstimate.sample.nTotal} units used; ${focusEstimate.sample.nTreated} treated, ${focusEstimate.sample.nControl} control, ${focusEstimate.sample.nDropped} dropped${focusEstimate.sample.nMatched === null ? '' : `, ${focusEstimate.sample.nMatched} matched`}`,
                    },
                  ]}
                />
                {focusEstimate.sample.dropReasons.length > 0 && <Notice tone="warning" title="Why units were dropped" items={focusEstimate.sample.dropReasons} />}
                {focusEstimate.notes.length > 0 && <Notice tone="info" title="Notes the engine attached to this estimate" items={focusEstimate.notes} />}
                <ExplanationPanel explanation={explanationOf(focusEstimate)} />
                <p className="oc-chart-note">{UNTESTABILITY}</p>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
