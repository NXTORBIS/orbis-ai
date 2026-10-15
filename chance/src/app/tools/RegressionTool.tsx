/**
 * Regression and predictive modelling.
 *
 * The screen is organised around the three ways a regression is most often
 * misread, and every one of them is handled by showing the honest figure next
 * to the flattering one rather than by hiding anything:
 *  - penalised coefficients are biased, so no p-value is rendered for them;
 *  - a confidence band for the mean response and a prediction band for a new
 *    observation are different statements and are drawn and labelled as two
 *    separate things;
 *  - in-sample R² is placed beside the cross-validated error, because on its
 *    own it is not a measure of predictive performance.
 *
 * Nothing here computes a statistic. Every number comes from
 * `src/engine/regression/`; the parsing step only turns text into columns and
 * reports exactly what it could not use.
 */
import { useMemo, useState } from 'react';
import { EXACTNESS_LABEL, EngineError, type Explanation } from '../../engine/core/result';
import {
  breuschPaganTest,
  buildDesign,
  classificationReport,
  confusionAt,
  diagnosticPlots,
  finishLinearFit,
  fitGlm,
  fitNegativeBinomial,
  fitPenalized,
  glmFamily,
  hosmerLemeshowTest,
  influenceMeasures,
  kFoldGeneric,
  kFoldLinear,
  leaveOneOutLinear,
  naturalCubicSplineBasis,
  overdispersionCheck,
  polynomialBasis,
  predictIntervals,
  whiteTest,
  type ClassificationReport,
  type Column,
  type ConfusionMatrix,
  type CrossValidationResult,
  type DesignWithOffset,
  type DiagnosticPlots,
  type GlmFit,
  type HeteroskedasticityTest,
  type HosmerLemeshow,
  type InfluenceReport,
  type IntervalPoint,
  type LinearFit,
  type NegativeBinomialFit,
  type OverdispersionCheck,
  type PenalizedFit,
  type SEType,
} from '../../engine/regression';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  KeyValueList,
  Notice,
  NumberField,
  SelectField,
  SliderField,
  TextField,
  type ColumnDef,
} from '../../ui/primitives';
import { LineChart, ScatterChart } from '../../ui/charts/charts';
import { PrecisionRecallChart, QQChart, RocChart } from '../../ui/charts/advanced';
import { formatPercent, formatValue } from '../../ui/charts/scale';
import { AiAssistPanel, ToolHeader } from '../shared/ToolShell';
import { ExplanationPanel } from '../shared/ExplanationPanel';
import { useApp } from '../store';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export type RegressionModelKind =
  | 'ols'
  | 'weighted'
  | 'ridge'
  | 'lasso'
  | 'elasticnet'
  | 'logistic'
  | 'poisson'
  | 'negbin'
  | 'polynomial'
  | 'spline';

export interface RegressionConfig {
  /** The data as typed or pasted: a header line, then one row per line. */
  data: string;
  /** Column name of the response. */
  response: string;
  /** Column names used as predictors, in the order they enter the model. */
  predictors: string[];
  /** Column of observation weights for weighted least squares; '' for none. */
  weightColumn: string;
  model: RegressionModelKind;
  /** Include an intercept column. */
  intercept: boolean;
  /** Which standard errors the reported inference uses (least squares only). */
  seType: SEType;
  /** Confidence level for every interval. */
  level: number;
  /** Penalty strength for ridge / lasso / elastic net. */
  lambda: number;
  /** Elastic-net mixing: 1 = lasso, 0 = ridge. Used by the elastic net only. */
  elasticAlpha: number;
  /** Folds for k-fold cross-validation. */
  folds: number;
  /** Column the polynomial or spline basis is built on. */
  basisColumn: string;
  polynomialDegree: number;
  splineInteriorKnots: number;
  /** Classification threshold for the logistic confusion matrix. */
  threshold: number;
}

/**
 * The built-in dataset is the Motor Trend road-test table (1974, 32 cars),
 * chosen because it exercises every panel honestly out of the box: weight and
 * horsepower are collinear enough to move the VIF panel, the heavy cars are
 * genuinely influential, `am` is a binary response for the logistic panel and
 * `carb` is a count for the Poisson one.
 */
const BUILT_IN_DATA = `mpg,cyl,disp,hp,drat,wt,qsec,vs,am,gear,carb
21.0,6,160.0,110,3.90,2.620,16.46,0,1,4,4
21.0,6,160.0,110,3.90,2.875,17.02,0,1,4,4
22.8,4,108.0,93,3.85,2.320,18.61,1,1,4,1
21.4,6,258.0,110,3.08,3.215,19.44,1,0,3,1
18.7,8,360.0,175,3.15,3.440,17.02,0,0,3,2
18.1,6,225.0,105,2.76,3.460,20.22,1,0,3,1
14.3,8,360.0,245,3.21,3.570,15.84,0,0,3,4
24.4,4,146.7,62,3.69,3.190,20.00,1,0,4,2
22.8,4,140.8,95,3.92,3.150,22.90,1,0,4,2
19.2,6,167.6,123,3.92,3.440,18.30,1,0,4,4
17.8,6,167.6,123,3.92,3.440,18.90,1,0,4,4
16.4,8,275.8,180,3.07,4.070,17.40,0,0,3,3
17.3,8,275.8,180,3.07,3.730,17.60,0,0,3,3
15.2,8,275.8,180,3.07,3.780,18.00,0,0,3,3
10.4,8,472.0,205,2.93,5.250,17.98,0,0,3,4
10.4,8,460.0,215,3.00,5.424,17.82,0,0,3,4
14.7,8,440.0,230,3.23,5.345,17.42,0,0,3,4
32.4,4,78.7,66,4.08,2.200,19.47,1,1,4,1
30.4,4,75.7,52,4.93,1.615,18.52,1,1,4,2
33.9,4,71.1,65,4.22,1.835,19.90,1,1,4,1
21.5,4,120.1,97,3.70,2.465,20.01,1,0,3,1
15.5,8,318.0,150,2.76,3.520,16.87,0,0,3,2
15.2,8,304.0,150,3.15,3.435,17.30,0,0,3,2
13.3,8,350.0,245,3.73,3.840,15.41,0,0,3,4
19.2,8,400.0,175,3.08,3.845,17.05,0,0,3,2
27.3,4,79.0,66,4.08,1.935,18.90,1,1,4,1
26.0,4,120.3,91,4.43,2.140,16.70,0,1,5,2
30.4,4,95.1,50,3.77,1.513,16.90,1,1,5,2
15.8,8,351.0,264,4.22,3.170,14.50,0,1,5,4
19.7,6,145.0,175,3.62,2.770,15.50,0,1,5,6
15.0,8,301.0,335,3.78,3.570,14.60,0,1,5,8
21.4,4,121.0,109,4.78,2.780,18.00,1,1,4,2`;

export const REGRESSION_DEFAULT: RegressionConfig = {
  data: BUILT_IN_DATA,
  response: 'mpg',
  // Weight and horsepower together: a fit worth looking at, with enough
  // collinearity that the VIF panel has something real to say.
  predictors: ['wt', 'hp'],
  weightColumn: '',
  model: 'ols',
  intercept: true,
  seType: 'classical',
  level: 0.95,
  lambda: 0.1,
  elasticAlpha: 0.5,
  folds: 10,
  basisColumn: 'wt',
  polynomialDegree: 2,
  splineInteriorKnots: 2,
  threshold: 0.5,
};

const MODEL_OPTIONS: { value: RegressionModelKind; label: string }[] = [
  { value: 'ols', label: 'Ordinary least squares' },
  { value: 'weighted', label: 'Weighted least squares' },
  { value: 'ridge', label: 'Ridge (L2 penalty)' },
  { value: 'lasso', label: 'Lasso (L1 penalty)' },
  { value: 'elasticnet', label: 'Elastic net (L1 + L2)' },
  { value: 'logistic', label: 'Logistic regression (binary 0/1 response)' },
  { value: 'poisson', label: 'Poisson regression (counts)' },
  { value: 'negbin', label: 'Negative binomial regression (overdispersed counts)' },
  { value: 'polynomial', label: 'Polynomial least squares' },
  { value: 'spline', label: 'Natural cubic spline least squares' },
];

const PENALISED: RegressionModelKind[] = ['ridge', 'lasso', 'elasticnet'];
const GLM_MODELS: RegressionModelKind[] = ['logistic', 'poisson', 'negbin'];
const BASIS_MODELS: RegressionModelKind[] = ['polynomial', 'spline'];

/* ------------------------------------------------------------------ *
 * Parsing — the only computation this file does, and it reports
 * everything it could not use.
 * ------------------------------------------------------------------ */

/** Tokens that stand for "no value" in hand-typed or exported tables. */
const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '.', '?', '-']);

const MAX_ROWS = 4000;

interface LineProblem {
  line: number;
  reason: string;
}

interface ParsedTable {
  names: string[];
  /** One entry per accepted line; `null` is a missing cell. */
  rows: (number | null)[][];
  /** Original 1-based line number of each accepted row. */
  lineNumbers: number[];
  problems: LineProblem[];
  missingCells: number;
  rowsWithMissing: number;
  truncated: number;
  headerError: string | null;
}

function splitLine(line: string): string[] {
  // Commas, semicolons and tabs are all common; whitespace-separated tables
  // are accepted too, but only when no delimiter is present, so that a value
  // like "1 000" is reported as unparseable rather than silently split.
  return /[,;\t]/.test(line) ? line.split(/[,;\t]/).map((s) => s.trim()) : line.trim().split(/\s+/);
}

function parseTable(text: string): ParsedTable {
  const lines = text.split(/\r?\n/);
  const problems: LineProblem[] = [];
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') {
      headerIndex = i;
      break;
    }
  }
  const empty: ParsedTable = {
    names: [],
    rows: [],
    lineNumbers: [],
    problems,
    missingCells: 0,
    rowsWithMissing: 0,
    truncated: 0,
    headerError: null,
  };
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
  if (names.length < 2) {
    return { ...empty, headerError: `Line ${headerIndex + 1} (the header) has only one column. A regression needs a response and at least one predictor.` };
  }

  const rows: (number | null)[][] = [];
  const lineNumbers: number[] = [];
  let missingCells = 0;
  let rowsWithMissing = 0;
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
    const parsed: (number | null)[] = [];
    let bad: string | null = null;
    let rowMissing = 0;
    for (let j = 0; j < cells.length; j++) {
      const token = cells[j];
      if (MISSING_TOKENS.has(token.toLowerCase())) {
        parsed.push(null);
        rowMissing++;
        continue;
      }
      const value = Number(token);
      if (!Number.isFinite(value)) {
        bad = `"${token.slice(0, 24)}" in column "${names[j]}" is not a number`;
        break;
      }
      parsed.push(value);
    }
    if (bad !== null) {
      problems.push({ line: i + 1, reason: bad });
      continue;
    }
    missingCells += rowMissing;
    if (rowMissing > 0) rowsWithMissing++;
    rows.push(parsed);
    lineNumbers.push(i + 1);
  }
  return { names, rows, lineNumbers, problems, missingCells, rowsWithMissing, truncated, headerError: null };
}

/* ------------------------------------------------------------------ *
 * Analysis
 * ------------------------------------------------------------------ */

type Attempt<T> = { ok: true; value: T } | { ok: false; error: string };

/** Run one engine call, keeping its message if it refuses. */
function attempt<T>(fn: () => T): Attempt<T> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    return { ok: false, error: e instanceof EngineError ? e.message : (e as Error).message };
  }
}

interface LinearBundle {
  kind: 'linear';
  fit: LinearFit;
  design: DesignWithOffset;
  predictorNames: string[];
  influence: Attempt<InfluenceReport>;
  plots: Attempt<DiagnosticPlots>;
  loo: Attempt<CrossValidationResult>;
  kfold: Attempt<CrossValidationResult>;
  breuschPagan: Attempt<HeteroskedasticityTest>;
  white: Attempt<HeteroskedasticityTest>;
  intervals: Attempt<{ grid: IntervalPoint[]; varied: string; heldAt: { name: string; value: number }[] }>;
  basisNotes: string[];
}

interface PenalizedBundle {
  kind: 'penalized';
  fit: PenalizedFit;
}

interface GlmBundle {
  kind: 'glm';
  fit: GlmFit | NegativeBinomialFit;
  design: DesignWithOffset;
  classification: Attempt<ClassificationReport> | null;
  confusion: Attempt<ConfusionMatrix> | null;
  calibration: Attempt<HosmerLemeshow> | null;
  overdispersion: Attempt<OverdispersionCheck> | null;
  heldOut: Attempt<{ rmse: number; mae: number }>;
}

type Analysis =
  | { ok: true; bundle: LinearBundle | PenalizedBundle | GlmBundle }
  | { ok: false; error: string };

function columnFrom(table: ParsedTable, name: string): Column {
  const index = table.names.indexOf(name);
  return { name, values: table.rows.map((r) => (index < 0 ? null : r[index])) };
}

function meanOf(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function buildAnalysis(config: RegressionConfig, table: ParsedTable): Analysis {
  if (table.headerError) return { ok: false, error: table.headerError };
  if (!table.rows.length) {
    return { ok: false, error: 'No usable data rows. Every line after the header was blank or could not be read; the list above says which.' };
  }
  if (!table.names.includes(config.response)) {
    return { ok: false, error: `No column named "${config.response}" to use as the response. Pick one of: ${table.names.join(', ')}.` };
  }
  const chosen = config.predictors.filter((p) => table.names.includes(p) && p !== config.response);
  if (!chosen.length) {
    return { ok: false, error: 'Select at least one predictor. A model with no predictors has nothing to estimate.' };
  }

  const y = columnFrom(table, config.response).values;
  const basisNotes: string[] = [];
  let predictors: Column[];
  if (BASIS_MODELS.includes(config.model)) {
    const basisName = table.names.includes(config.basisColumn) ? config.basisColumn : chosen[0];
    const source = columnFrom(table, basisName).values;
    const expansion = attempt(() =>
      config.model === 'polynomial'
        ? polynomialBasis(source, config.polynomialDegree, basisName)
        : naturalCubicSplineBasis(source, { interiorKnots: config.splineInteriorKnots }, basisName),
    );
    if (!expansion.ok) return { ok: false, error: expansion.error };
    basisNotes.push(expansion.value.description, ...expansion.value.warnings);
    const others = chosen.filter((p) => p !== basisName).map((p) => columnFrom(table, p));
    predictors = [...expansion.value.columns, ...others];
  } else {
    predictors = chosen.map((p) => columnFrom(table, p));
  }

  if (PENALISED.includes(config.model)) {
    const alpha = config.model === 'ridge' ? 0 : config.model === 'lasso' ? 1 : config.elasticAlpha;
    const fit = attempt(() =>
      fitPenalized({ y, predictors, lambda: config.lambda, alpha, yName: config.response }),
    );
    return fit.ok ? { ok: true, bundle: { kind: 'penalized', fit: fit.value } } : { ok: false, error: fit.error };
  }

  const weights =
    config.model === 'weighted'
      ? table.names.includes(config.weightColumn)
        ? columnFrom(table, config.weightColumn).values
        : null
      : undefined;
  if (weights === null) {
    return {
      ok: false,
      error: 'Weighted least squares needs a weight column. Choose one, or switch back to ordinary least squares — weighting every row equally is exactly ordinary least squares.',
    };
  }

  if (GLM_MODELS.includes(config.model)) {
    const family = config.model === 'logistic' ? 'binomial' : 'poisson';
    const fitAttempt = attempt<GlmFit | NegativeBinomialFit>(() =>
      config.model === 'negbin'
        ? fitNegativeBinomial({ y, predictors, intercept: config.intercept, yName: config.response, level: config.level })
        : fitGlm({
            y,
            predictors,
            family,
            intercept: config.intercept,
            yName: config.response,
            level: config.level,
          }),
    );
    if (!fitAttempt.ok) return { ok: false, error: fitAttempt.error };
    const fit = fitAttempt.value;
    const designAttempt = attempt(() =>
      buildDesign({ y, predictors, intercept: config.intercept, allowConstantResponse: true }),
    );
    if (!designAttempt.ok) return { ok: false, error: designAttempt.error };
    const design = designAttempt.value;
    const binary = config.model === 'logistic';
    const famName = config.model === 'negbin' ? 'negativebinomial' : family;
    const theta = config.model === 'negbin' ? (fit as NegativeBinomialFit).theta : undefined;
    return {
      ok: true,
      bundle: {
        kind: 'glm',
        fit,
        design,
        classification: binary ? attempt(() => classificationReport(design.y, fit.fitted, config.threshold)) : null,
        confusion: binary ? attempt(() => confusionAt(design.y, fit.fitted, config.threshold)) : null,
        calibration: binary ? attempt(() => hosmerLemeshowTest(design.y, fit.fitted)) : null,
        overdispersion: config.model === 'poisson' ? attempt(() => overdispersionCheck(fit)) : null,
        heldOut: attempt(() => {
          const fam = glmFamily(famName, undefined, theta);
          const cv = kFoldGeneric(
            design.X.length,
            config.folds,
            (trainIdx, testIdx) => {
              const trained = fitGlm({
                y: trainIdx.map((i) => design.y[i]),
                predictors: predictors.map((c, j) => ({
                  name: c.name,
                  values: trainIdx.map((i) => design.X[i][j + (config.intercept ? 1 : 0)]),
                })),
                family: famName,
                theta,
                intercept: config.intercept,
              });
              return testIdx.map((i) => {
                let eta = 0;
                for (let j = 0; j < trained.beta.length; j++) eta += design.X[i][j] * trained.beta[j];
                return fam.linkInv(eta);
              });
            },
            design.y,
            'orbis-glm-cv',
          );
          return { rmse: cv.rmse, mae: cv.mae };
        }),
      },
    };
  }

  // Least squares, including the basis expansions.
  const designAttempt = attempt(() =>
    buildDesign({ y, predictors, intercept: config.intercept, weights: weights ?? undefined }),
  );
  if (!designAttempt.ok) return { ok: false, error: designAttempt.error };
  const design = designAttempt.value;
  const fitAttempt = attempt(() =>
    finishLinearFit(design, { yName: config.response, level: config.level, seType: config.seType }),
  );
  if (!fitAttempt.ok) return { ok: false, error: fitAttempt.error };
  const fit = fitAttempt.value;
  const start = design.hasIntercept ? 1 : 0;
  const bare = design.X.map((row) => row.slice(start));
  const predictorNames = design.names.slice(start);

  const influence = attempt(() => influenceMeasures(fit, design.X, design.w));
  return {
    ok: true,
    bundle: {
      kind: 'linear',
      fit,
      design,
      predictorNames,
      influence,
      plots: influence.ok ? attempt(() => diagnosticPlots(fit, influence.value)) : { ok: false, error: influence.error },
      loo: attempt(() => leaveOneOutLinear(fit.residuals, fit.leverage, design.y, fit.rSquared)),
      kfold: attempt(() => kFoldLinear(design.X, design.y, config.folds, fit.rSquared)),
      breuschPagan: attempt(() => breuschPaganTest(fit, bare)),
      white: attempt(() => whiteTest(fit, bare)),
      intervals: attempt(() => {
        // One predictor is varied across its observed range and the others are
        // held at their means: a fitted line needs a single x axis, and saying
        // where the others are held is part of reading it honestly.
        if (!predictorNames.length) throw new EngineError('There is no predictor to plot against.', 'insufficient');
        const columns = predictorNames.map((_, j) => bare.map((row) => row[j]));
        const held = columns.map(meanOf);
        const xs = columns[0];
        const min = Math.min(...xs);
        const max = Math.max(...xs);
        const steps = 60;
        const rows = Array.from({ length: steps }, (_, i) => {
          const value = min + ((max - min) * i) / (steps - 1);
          return held.map((h, j) => (j === 0 ? value : h));
        });
        return {
          grid: predictIntervals(fit, rows, { level: config.level }),
          varied: predictorNames[0],
          heldAt: predictorNames.slice(1).map((name, j) => ({ name, value: held[j + 1] })),
        };
      }),
      basisNotes,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Formatting helpers
 * ------------------------------------------------------------------ */

function num(v: number, digits = 4): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'not defined' : v > 0 ? '∞' : '−∞';
  return formatValue(v, digits);
}

function pValue(p: number): string {
  if (!Number.isFinite(p)) return 'not defined';
  if (p < 1e-4) return p.toExponential(2);
  return p.toFixed(4);
}

function interval(low: number, high: number): string {
  return `${num(low)} to ${num(high)}`;
}

const CAUSATION_NOTE =
  'Regression measures association, not causation. Each coefficient is the association that remains after adjusting for exactly the other variables included, under exactly the functional form chosen here; adding or removing a variable generally changes the others, sometimes in sign.';

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export function RegressionTool({ config }: { config: RegressionConfig }) {
  const app = useApp();
  const set = (patch: Partial<RegressionConfig>) => app.updateConfig({ ...config, ...patch });
  const [showAllRows, setShowAllRows] = useState(false);

  const table = useMemo(() => parseTable(config.data), [config.data]);
  const analysis = useMemo(() => buildAnalysis(config, table), [config, table]);

  const explanation = useMemo<Explanation | null>(() => {
    if (!analysis.ok) return null;
    const b = analysis.bundle;
    if (b.kind === 'linear') {
      return {
        method: `${b.fit.kind === 'wls' ? 'Weighted' : 'Ordinary'} least squares by Householder QR decomposition, ${b.fit.n} observations and ${b.fit.p} coefficient(s)`,
        formula: 'β̂ = argmin Σ wᵢ (yᵢ − xᵢᵀβ)²,  solved from the QR factors of √W·X',
        steps: [
          { label: 'Rows used', value: `${b.fit.missing.rowsUsed} of ${b.fit.missing.suppliedRows} supplied (${b.fit.missing.droppedRows} dropped for missing values)` },
          { label: 'Residual standard error', value: `${num(b.fit.residualStandardError)} on ${b.fit.n - b.fit.p} degrees of freedom` },
          { label: 'Standard errors reported', value: b.fit.seType === 'classical' ? 'classical (constant error variance assumed)' : `${b.fit.seType} heteroskedasticity-robust` },
          { label: 'Overall F test', value: `F = ${num(b.fit.anova.fStatistic)} on ${b.fit.anova.regressionDf} and ${b.fit.anova.residualDf} df, p = ${pValue(b.fit.anova.fPValue)}` },
        ],
        assumptions: [
          'The mean of the response is a linear function of the predictors as entered.',
          'The errors are independent of each other and of the predictors.',
          b.fit.seType === 'classical' ? 'The error variance is the same for every observation.' : 'The error variance may differ between observations; the robust standard errors allow for that.',
          'Rows with a missing value were dropped, which is unbiased only if they are missing at random.',
        ],
        limitations: [CAUSATION_NOTE, ...b.fit.limitations, ...b.basisNotes],
        exactness: b.fit.exactness,
      };
    }
    if (b.kind === 'penalized') {
      return {
        method: `${b.fit.kind === 'ridge' ? 'Ridge' : b.fit.kind === 'lasso' ? 'Lasso' : 'Elastic net'} regression at λ = ${num(b.fit.lambda)}, α = ${num(b.fit.alpha, 3)}`,
        formula: '(1/2n)‖y − Zb‖² + λ(α‖b‖₁ + ((1−α)/2)‖b‖²),  predictors standardised before penalising',
        steps: [
          { label: 'Rows used', value: `${b.fit.missing.rowsUsed} of ${b.fit.missing.suppliedRows}` },
          { label: 'Non-zero coefficients', value: `${b.fit.nonZero} of ${b.fit.p}` },
          { label: 'In-sample R²', value: num(b.fit.rSquared) },
        ],
        assumptions: [
          'The penalty is applied on the standardised scale and the coefficients are transformed back, so they apply to your units.',
          'λ was supplied, not chosen from the data here.',
        ],
        limitations: [CAUSATION_NOTE, ...b.fit.limitations],
        exactness: b.fit.exactness,
      };
    }
    return {
      method: `${b.fit.family} generalised linear model with a ${b.fit.link} link, fitted by iteratively reweighted least squares (${b.fit.iterations} iterations)`,
      formula: 'g(E[y]) = Xβ,  β̂ by IRLS on the QR factors of the working design',
      steps: [
        { label: 'Rows used', value: `${b.fit.missing.rowsUsed} of ${b.fit.missing.suppliedRows}` },
        { label: 'Deviance', value: `${num(b.fit.deviance)} on ${b.fit.degreesOfFreedom} df (null ${num(b.fit.nullDeviance)} on ${b.fit.nullDegreesOfFreedom})` },
        { label: 'Likelihood-ratio test of the whole model', value: `χ² = ${num(b.fit.likelihoodRatio.statistic)} on ${b.fit.likelihoodRatio.degreesOfFreedom} df, p = ${pValue(b.fit.likelihoodRatio.pValue)}` },
        { label: 'Dispersion (Pearson χ²/df)', value: num(b.fit.dispersion) },
      ],
      assumptions: [
        'The response follows the chosen family, with its variance function.',
        'The link function is correct: the predictors act additively on the link scale.',
        'The observations are independent.',
      ],
      limitations: [CAUSATION_NOTE, ...b.fit.limitations],
      exactness: b.fit.exactness,
    };
  }, [analysis]);

  const bundle = analysis.ok ? analysis.bundle : null;
  const linear = bundle?.kind === 'linear' ? bundle : null;
  const penalized = bundle?.kind === 'penalized' ? bundle : null;
  const glm = bundle?.kind === 'glm' ? bundle : null;

  const predictorChoices = table.names.filter((n) => n !== config.response);
  const rowsShown = showAllRows ? table.problems : table.problems.slice(0, 12);

  return (
    <>
      <ToolHeader toolId="regression" />
      <div className="oc-workspace">
        <div className="oc-stack">
          <Card
            title="Data"
            hint="One header line naming the columns, then one row per line. Commas, semicolons, tabs or spaces all work."
          >
            <TextField
              label="Data (header line, then one row per line)"
              value={config.data}
              onChange={(data) => set({ data })}
              multiline
              rows={10}
              monospace
              maxLength={400_000}
              hint="Loaded with the Motor Trend road-test table (32 cars, 1974). Replace it with your own; nothing leaves this page."
            />
            {config.data !== BUILT_IN_DATA && (
              <Button size="sm" variant="ghost" onClick={() => set({ data: BUILT_IN_DATA, response: 'mpg', predictors: ['wt', 'hp'], basisColumn: 'wt' })}>
                Restore the built-in dataset
              </Button>
            )}

            {table.headerError && <Notice tone="error">{table.headerError}</Notice>}
            {!table.headerError && (
              <KeyValueList
                items={[
                  { label: 'Columns found', value: table.names.join(', ') },
                  { label: 'Rows read', value: table.rows.length.toLocaleString('en-US') },
                  { label: 'Lines skipped', value: table.problems.length.toLocaleString('en-US') },
                  { label: 'Cells marked missing', value: `${table.missingCells.toLocaleString('en-US')} in ${table.rowsWithMissing.toLocaleString('en-US')} row(s)` },
                ]}
              />
            )}
            {table.truncated > 0 && (
              <Notice tone="warning" title="Rows beyond the limit were not read">
                The first {MAX_ROWS.toLocaleString('en-US')} rows were used and {table.truncated.toLocaleString('en-US')} further row(s) were ignored. They were not
                sampled or averaged — they are simply absent from every figure below.
              </Notice>
            )}
            {table.problems.length > 0 && (
              <Notice tone="warning" title={`${table.problems.length} line(s) could not be read and are not in the fit`}>
                <ul className="oc-assumption-list">
                  {rowsShown.map((p) => (
                    <li key={p.line}>
                      Line {p.line}: {p.reason}
                    </li>
                  ))}
                </ul>
                {table.problems.length > rowsShown.length && (
                  <Button size="sm" variant="ghost" onClick={() => setShowAllRows(true)}>
                    {`Show all ${table.problems.length} skipped lines`}
                  </Button>
                )}
              </Notice>
            )}
            {table.rowsWithMissing > 0 && (
              <Notice tone="warning" title="Rows with a missing value are dropped, and that is an assumption">
                {table.rowsWithMissing.toLocaleString('en-US')} row(s) contain a missing value. Any row missing the response, a selected predictor or the weight is
                dropped from the fit (complete-case analysis). That is unbiased <strong>only if those values are missing at random</strong>: if the reason a value is
                absent is related to the response, every estimate below is biased by an unknown amount. The fit reports its own count of dropped rows beside the
                coefficients.
              </Notice>
            )}
          </Card>

          <Card title="Response and predictors">
            <SelectField
              label="Response (the variable being modelled)"
              value={config.response}
              onChange={(response) => set({ response, predictors: config.predictors.filter((p) => p !== response) })}
              options={table.names.map((n) => ({ value: n, label: n }))}
              hint={table.names.length ? undefined : 'No columns yet — enter data above.'}
            />
            <fieldset style={{ border: 'none', padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ fontSize: 12.5, fontWeight: 600, padding: 0, marginBottom: 'var(--s2)' }}>Predictors</legend>
              {predictorChoices.map((name) => (
                <Checkbox
                  key={name}
                  label={name}
                  checked={config.predictors.includes(name)}
                  onChange={(on) =>
                    set({
                      predictors: on
                        ? [...config.predictors.filter((p) => p !== name), name]
                        : config.predictors.filter((p) => p !== name),
                    })
                  }
                />
              ))}
              {!predictorChoices.length && <p className="oc-muted" style={{ fontSize: 12.5 }}>No other columns are available as predictors.</p>}
            </fieldset>
            <Checkbox
              label="Include an intercept"
              checked={config.intercept}
              onChange={(v) => set({ intercept: v })}
              description="Forcing the line through the origin is rarely right and changes the meaning of R²."
            />
          </Card>

          <Card title="Model">
            <SelectField
              label="Model family"
              value={config.model}
              onChange={(model) => set({ model: model as RegressionModelKind })}
              options={MODEL_OPTIONS}
            />
            {config.model === 'weighted' && (
              <SelectField
                label="Weight column"
                value={config.weightColumn}
                onChange={(weightColumn) => set({ weightColumn })}
                options={[{ value: '', label: 'Choose a column…' }, ...table.names.map((n) => ({ value: n, label: n }))]}
                hint="Every weight must be greater than zero, and weighted least squares treats them as known exactly."
              />
            )}
            {PENALISED.includes(config.model) && (
              <>
                <NumberField label="Penalty strength" symbol="λ" value={config.lambda} onChange={(lambda) => set({ lambda })} min={0} max={1e6} step={0.05} />
                {config.model === 'elasticnet' && (
                  <SliderField label="Mixing (1 = lasso, 0 = ridge)" symbol="α" value={config.elasticAlpha} onChange={(elasticAlpha) => set({ elasticAlpha })} min={0} max={1} step={0.05} />
                )}
              </>
            )}
            {config.model === 'polynomial' && (
              <>
                <SelectField label="Column to expand" value={config.basisColumn} onChange={(basisColumn) => set({ basisColumn })} options={predictorChoices.map((n) => ({ value: n, label: n }))} />
                <NumberField label="Polynomial degree" value={config.polynomialDegree} onChange={(polynomialDegree) => set({ polynomialDegree })} min={1} max={10} integer />
              </>
            )}
            {config.model === 'spline' && (
              <>
                <SelectField label="Column to expand" value={config.basisColumn} onChange={(basisColumn) => set({ basisColumn })} options={predictorChoices.map((n) => ({ value: n, label: n }))} />
                <NumberField label="Interior knots" value={config.splineInteriorKnots} onChange={(splineInteriorKnots) => set({ splineInteriorKnots })} min={1} max={10} integer />
              </>
            )}
            {!PENALISED.includes(config.model) && !GLM_MODELS.includes(config.model) && (
              <SelectField
                label="Standard errors used for the reported inference"
                value={config.seType}
                onChange={(seType) => set({ seType: seType as SEType })}
                options={[
                  { value: 'classical', label: 'Classical (constant error variance assumed)' },
                  { value: 'HC0', label: 'HC0 robust' },
                  { value: 'HC1', label: 'HC1 robust' },
                  { value: 'HC2', label: 'HC2 robust' },
                  { value: 'HC3', label: 'HC3 robust (best below about n = 250)' },
                ]}
              />
            )}
            {config.model === 'logistic' && (
              <SliderField label="Classification threshold" value={config.threshold} onChange={(threshold) => set({ threshold })} min={0.01} max={0.99} step={0.01} hint="Only the confusion matrix depends on this; the ROC curve covers every threshold at once." />
            )}
            <SliderField label="Confidence level" value={config.level} onChange={(level) => set({ level })} min={0.5} max={0.999} step={0.005} />
            <NumberField label="Cross-validation folds" symbol="k" value={config.folds} onChange={(folds) => set({ folds })} min={2} max={50} integer />
          </Card>

          <AiAssistPanel
            capability="explainResult"
            context="Every figure on this screen comes from the regression engine. The assistant can only put the numbers already shown into words; it cannot fit a model, choose predictors or decide what causes what."
          />
        </div>

        <div className="oc-stack">
          {!analysis.ok && <Notice tone="error" title="This model was not fitted">{analysis.error}</Notice>}

          {linear && (
            <>
              <Card title="Coefficients" hint={`${(config.level * 100).toFixed(1)}% intervals, ${linear.fit.seType === 'classical' ? 'classical' : `${linear.fit.seType} robust`} standard errors.`}>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Coefficient estimates with standard errors, test statistics and confidence intervals"
                    columns={coefficientColumns()}
                    rows={linear.fit.coefficients}
                  />
                </div>
                <KeyValueList
                  items={[
                    { label: 'R² (this sample only)', value: num(linear.fit.rSquared) },
                    { label: 'Adjusted R²', value: num(linear.fit.adjustedRSquared) },
                    { label: 'Residual standard error', value: `${num(linear.fit.residualStandardError)} on ${linear.fit.n - linear.fit.p} df` },
                    {
                      label: 'Overall F test',
                      value: `F = ${num(linear.fit.anova.fStatistic)} on ${linear.fit.anova.regressionDf} and ${linear.fit.anova.residualDf} df, p = ${pValue(linear.fit.anova.fPValue)}`,
                    },
                    { label: 'AIC / BIC', value: `${num(linear.fit.aic)} / ${num(linear.fit.bic)}` },
                    { label: 'Rows used', value: `${linear.fit.missing.rowsUsed} of ${linear.fit.missing.suppliedRows} (${linear.fit.missing.droppedRows} dropped for missing values)` },
                    { label: 'Result type', value: <Badge variant={linear.fit.exactness}>{EXACTNESS_LABEL[linear.fit.exactness]}</Badge> },
                  ]}
                />
                {linear.basisNotes.length > 0 && <Notice tone="info" title="About this basis expansion" items={linear.basisNotes} />}
                {linear.fit.warnings.length > 0 && <Notice tone="warning" title="What the fit wants you to know" items={linear.fit.warnings} />}
                <p className="oc-chart-note">{CAUSATION_NOTE}</p>
              </Card>

              <Card title="Collinearity">
                <KeyValueList items={[{ label: 'Condition number of the design', value: num(linear.fit.collinearity.conditionNumber, 5) }]} />
                {linear.fit.collinearity.vif.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Variance inflation factors"
                      columns={[
                        { key: 'name', header: 'Predictor', render: (r: { name: string; value: number }) => r.name },
                        { key: 'vif', header: 'VIF', numeric: true, render: (r: { name: string; value: number }) => num(r.value) },
                        {
                          key: 'band',
                          header: 'Conventional reading',
                          render: (r: { name: string; value: number }) =>
                            r.value >= 10 ? 'VIF ≥ 10 — severe' : r.value >= 5 ? 'VIF 5–10 — moderate' : 'VIF < 5 — not a concern by this convention',
                        },
                        {
                          key: 'se',
                          header: 'SE inflated by about',
                          numeric: true,
                          render: (r: { name: string; value: number }) => `×${num(Math.sqrt(r.value), 3)}`,
                        },
                      ]}
                      rows={linear.fit.collinearity.vif}
                    />
                  </div>
                ) : (
                  <p className="oc-muted" style={{ fontSize: 12.5 }}>
                    Variance inflation factors need at least two predictors; with one there is nothing for it to be collinear with.
                  </p>
                )}
                {linear.fit.collinearity.warnings.length > 0 ? (
                  <Notice tone="warning" title="Collinearity warning from the fit" items={linear.fit.collinearity.warnings} />
                ) : (
                  <Notice tone="info">
                    No predictor exceeds the conventional VIF thresholds (5 for moderate, 10 for severe) and the condition number is below 1000.
                  </Notice>
                )}
                <p className="oc-chart-note">
                  High collinearity makes the <em>individual</em> coefficients close to meaningless even when the model predicts well: the predictors carry nearly the
                  same information, so the fit cannot tell their contributions apart, the standard errors inflate by roughly √VIF and the signs can flip on a small
                  change in the data. Prediction can still be fine. A rank-deficient design is refused outright by the engine, which names the dependent columns — that
                  message appears in place of these results when it happens.
                </p>
              </Card>

              <Card title="Fitted line: two intervals that say different things">
                {linear.intervals.ok ? (
                  <>
                    <LineChart
                      title={`Fitted ${linear.fit.yName} against ${linear.intervals.value.varied}`}
                      description={`Fitted line with a ${(config.level * 100).toFixed(1)}% confidence band for the mean response and a ${(config.level * 100).toFixed(1)}% prediction band for a single new observation. The prediction band is wider everywhere.`}
                      series={[
                        { label: 'Fitted mean', points: linear.intervals.value.grid.map((p) => ({ x: p.x[0], y: p.fit })) },
                        { label: `Confidence band for the MEAN response — lower`, points: linear.intervals.value.grid.map((p) => ({ x: p.x[0], y: p.meanLow })), dashed: true },
                        { label: `Confidence band for the MEAN response — upper`, points: linear.intervals.value.grid.map((p) => ({ x: p.x[0], y: p.meanHigh })), dashed: true },
                        { label: `Prediction band for a NEW observation — lower`, points: linear.intervals.value.grid.map((p) => ({ x: p.x[0], y: p.predictionLow })), dashed: true },
                        { label: `Prediction band for a NEW observation — upper`, points: linear.intervals.value.grid.map((p) => ({ x: p.x[0], y: p.predictionHigh })), dashed: true },
                      ]}
                      xLabel={linear.intervals.value.varied}
                      yLabel={linear.fit.yName}
                      note={
                        linear.intervals.value.heldAt.length
                          ? `The other predictors are held at their means: ${linear.intervals.value.heldAt.map((h) => `${h.name} = ${num(h.value)}`).join(', ')}.`
                          : undefined
                      }
                    />
                    <Notice tone="info" title="The two bands are not interchangeable">
                      <p style={{ margin: '0 0 var(--s2)' }}>
                        <strong>Confidence band for the mean response:</strong> where the average {linear.fit.yName} of all cases with these predictor values lies. It
                        shrinks as the sample grows.
                      </p>
                      <p style={{ margin: 0 }}>
                        <strong>Prediction band for a new observation:</strong> where one future measurement will fall. It is wider because that observation carries its
                        own error on top of the uncertainty in the line, and it does not shrink towards zero width however much data you add. Quoting the mean band for
                        an individual prediction understates the uncertainty badly.
                      </p>
                    </Notice>
                  </>
                ) : (
                  <Notice tone="warning">{linear.intervals.error}</Notice>
                )}
                <ScatterChart
                  title="Observed values"
                  description="Each row as supplied, against the predictor plotted above."
                  points={linear.design.X.map((row, i) => ({ x: row[linear.design.hasIntercept ? 1 : 0], y: linear.design.y[i] }))}
                  xLabel={linear.predictorNames[0] ?? 'predictor'}
                  yLabel={linear.fit.yName}
                />
              </Card>

              <Card title="Diagnostics">
                {linear.plots.ok ? (
                  <>
                    <ScatterChart
                      title="Residuals against fitted values"
                      description="A horizontal band of scatter with no pattern is what the linear model assumes. Curvature means the form is wrong; a funnel means the variance is not constant."
                      points={linear.plots.value.residualsVsFitted}
                      xLabel="Fitted value"
                      yLabel="Residual"
                    />
                    <QQChart
                      title="Normal Q–Q plot of the standardised residuals"
                      description="Points on the 45° line mean the residuals match a normal distribution. The coefficient intervals survive mild departures in a large sample; the prediction interval does not."
                      points={linear.plots.value.qq.map((p) => ({ theoretical: p.x, sample: p.y }))}
                      referenceLine={{ slope: 1, intercept: 0, label: 'Normal reference' }}
                    />
                    <ScatterChart
                      title="Scale–location"
                      description="√|standardised residual| against the fitted value. A rising or falling trend is heteroskedasticity, which the robust standard errors below allow for."
                      points={linear.plots.value.scaleLocation}
                      xLabel="Fitted value"
                      yLabel="√|standardised residual|"
                    />
                    <ScatterChart
                      title="Residuals against leverage"
                      description="Points far to the right have unusual predictor values; those also high or low have both unusual predictors and a large residual, which is what makes an observation influential."
                      points={linear.plots.value.residualsVsLeverage}
                      xLabel="Leverage (hat value)"
                      yLabel="Standardised residual"
                    />
                  </>
                ) : (
                  <Notice tone="warning">{linear.plots.error}</Notice>
                )}
              </Card>

              <Card title="Influence: which rows are setting this fit">
                {linear.influence.ok ? (
                  <>
                    <KeyValueList
                      items={[
                        { label: 'Leverage threshold (2p/n)', value: num(linear.influence.value.thresholds.leverage) },
                        { label: "Cook's distance thresholds", value: `${num(linear.influence.value.thresholds.cooksDistance)} (4/n) and 1 (severe)` },
                        { label: 'DFFITS threshold (2√(p/n))', value: num(linear.influence.value.thresholds.dffits) },
                        { label: 'Flagged observations', value: `${linear.influence.value.flagged.length} of ${linear.influence.value.rows.length}` },
                      ]}
                    />
                    <div style={{ overflowX: 'auto' }}>
                      <DataTable
                        caption="Leverage, residuals and influence measures for every observation"
                        maxHeight={420}
                        columns={influenceColumns(table.lineNumbers, linear.design.rowIndex)}
                        rows={linear.influence.value.rows}
                      />
                    </div>
                    {linear.influence.value.flagged.length > 0 ? (
                      <Notice tone="warning" title={`${linear.influence.value.flagged.length} observation(s) are flagged`}>
                        <ul className="oc-assumption-list">
                          {linear.influence.value.flagged.slice(0, 10).map((r) => (
                            <li key={r.index}>
                              Row {r.index} (line {table.lineNumbers[linear.design.rowIndex[r.index]] ?? '?'}): {r.flags.join('; ')}
                            </li>
                          ))}
                        </ul>
                        {linear.influence.value.flagged.length > 10 && (
                          <p style={{ margin: 'var(--s2) 0 0' }}>The remaining flagged rows are marked in the table above.</p>
                        )}
                      </Notice>
                    ) : (
                      <Notice tone="info">No observation exceeds any of the conventional influence thresholds.</Notice>
                    )}
                    {linear.influence.value.warnings.length > 0 && <Notice tone="warning" items={linear.influence.value.warnings} />}
                    <Notice tone="info" title="How to read this" items={linear.influence.value.notes} />
                    <p className="oc-chart-note">
                      A single high-leverage point can dictate an entire slope. The honest check is to refit without the flagged rows and compare: if the coefficients
                      move materially, the fit describes those few rows rather than the data as a whole. Do not delete them for being inconvenient — they may be the
                      most informative observations you have.
                    </p>
                  </>
                ) : (
                  <Notice tone="warning">{linear.influence.error}</Notice>
                )}
              </Card>

              <Card title="Robust standard errors and heteroskedasticity">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Classical and HC0–HC3 robust standard errors side by side"
                    columns={robustColumns(linear.fit)}
                    rows={linear.fit.coefficients.map((c, j) => ({ name: c.name, index: j }))}
                  />
                </div>
                <p className="oc-chart-note">
                  The classical standard error assumes every observation has the same error variance. HC0–HC3 do not. Where the columns differ materially, that
                  assumption is doing real work and the classical p-values above should not be trusted; HC3 is the usual choice below about n = 250. The ratio column
                  shows the difference directly rather than leaving it to be eyeballed.
                </p>
                {linear.breuschPagan.ok ? (
                  <Notice tone={linear.breuschPagan.value.rejects ? 'warning' : 'info'} title={linear.breuschPagan.value.name}>
                    {linear.breuschPagan.value.interpretation}
                  </Notice>
                ) : (
                  <Notice tone="warning" title="Breusch–Pagan test">{linear.breuschPagan.error}</Notice>
                )}
                {linear.white.ok ? (
                  <Notice tone={linear.white.value.rejects ? 'warning' : 'info'} title={linear.white.value.name}>
                    {linear.white.value.interpretation}
                  </Notice>
                ) : (
                  <Notice tone="warning" title="White test">{linear.white.error}</Notice>
                )}
              </Card>

              <Card title="Out-of-sample performance, next to R²">
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="In-sample fit against held-out prediction error"
                    columns={[
                      { key: 'm', header: 'Measure', render: (r: { label: string; value: string; note: string }) => r.label },
                      { key: 'v', header: 'Value', numeric: true, render: (r: { label: string; value: string; note: string }) => r.value },
                      { key: 'n', header: 'What it describes', render: (r: { label: string; value: string; note: string }) => r.note },
                    ]}
                    rows={[
                      { label: 'In-sample R²', value: num(linear.fit.rSquared), note: 'How well the model fits the rows it was fitted to. Adding predictors can only increase it.' },
                      { label: 'Adjusted R²', value: num(linear.fit.adjustedRSquared), note: 'R² with a penalty for the number of coefficients. Still an in-sample figure.' },
                      ...(linear.loo.ok
                        ? [
                            { label: 'Leave-one-out RMSE', value: num(linear.loo.value.rmse), note: 'Exact, from the hat matrix: error on observations excluded from the fit that predicted them.' },
                            { label: 'Leave-one-out MAE', value: num(linear.loo.value.mae), note: 'Mean absolute held-out error, less sensitive to a single large miss.' },
                            { label: 'Leave-one-out predictive R²', value: num(linear.loo.value.predictiveRSquared), note: '1 − PRESS/TSS. Negative means the model predicts worse than the mean of the response.' },
                          ]
                        : []),
                      ...(linear.kfold.ok
                        ? [
                            { label: `${linear.kfold.value.folds}-fold RMSE`, value: num(linear.kfold.value.rmse), note: 'Each fold refitted from scratch on a seeded shuffle.' },
                            { label: `${linear.kfold.value.folds}-fold MAE`, value: num(linear.kfold.value.mae), note: 'Mean absolute held-out error across the folds.' },
                            { label: `${linear.kfold.value.folds}-fold predictive R²`, value: num(linear.kfold.value.predictiveRSquared), note: 'The out-of-sample analogue of R².' },
                          ]
                        : []),
                    ]}
                  />
                </div>
                {!linear.loo.ok && <Notice tone="warning" title="Leave-one-out">{linear.loo.error}</Notice>}
                {!linear.kfold.ok && <Notice tone="warning" title="k-fold cross-validation">{linear.kfold.error}</Notice>}
                {linear.loo.ok && linear.loo.value.warnings.length > 0 && <Notice tone="warning" items={linear.loo.value.warnings} />}
                {linear.kfold.ok && linear.kfold.value.warnings.length > 0 && <Notice tone="warning" items={linear.kfold.value.warnings} />}
                <Notice tone="info" title="Why both are shown" items={(linear.loo.ok ? linear.loo.value.notes : linear.kfold.ok ? linear.kfold.value.notes : []).concat(['In-sample R² is not a measure of predictive performance. Presenting it on its own is the most common way a regression is oversold.'])} />
              </Card>
            </>
          )}

          {penalized && (
            <>
              <Card title={`${penalized.fit.kind === 'ridge' ? 'Ridge' : penalized.fit.kind === 'lasso' ? 'Lasso' : 'Elastic net'} coefficients`}>
                <Notice tone="warning" title="No p-values are shown here, on purpose">
                  Penalised coefficients are deliberately biased towards zero — that is how the penalty buys lower variance. The engine reports{' '}
                  <code>inferenceValid: false</code> for this fit, so the standard errors, t statistics, p-values and confidence intervals of ordinary least squares{' '}
                  <strong>do not apply</strong> and none are computed. The penalty changes the sampling distribution, and for the lasso the set of selected variables is
                  itself random, so a conventional interval would have the wrong coverage by an unknown amount. Treating a lasso coefficient as "significant" is the
                  single most common misuse of these methods. The honest summary of a penalised fit is its cross-validated predictive error.
                </Notice>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Penalised coefficient estimates, in the original units of the data"
                    columns={[
                      { key: 'name', header: 'Predictor', render: (r: { name: string; estimate: number }) => r.name },
                      { key: 'est', header: 'Estimate', numeric: true, render: (r: { name: string; estimate: number }) => num(r.estimate) },
                      {
                        key: 'state',
                        header: 'Selected',
                        render: (r: { name: string; estimate: number }) => (r.estimate === 0 ? 'set to exactly zero' : 'kept'),
                      },
                    ]}
                    rows={penalized.fit.coefficients}
                  />
                </div>
                <KeyValueList
                  items={[
                    { label: 'Intercept', value: num(penalized.fit.intercept) },
                    { label: 'λ (penalty strength)', value: num(penalized.fit.lambda) },
                    { label: 'α (mixing)', value: num(penalized.fit.alpha, 3) },
                    { label: 'Non-zero coefficients', value: `${penalized.fit.nonZero} of ${penalized.fit.p}` },
                    { label: 'In-sample R² (description only)', value: num(penalized.fit.rSquared) },
                    { label: 'Rows used', value: `${penalized.fit.missing.rowsUsed} of ${penalized.fit.missing.suppliedRows} (${penalized.fit.missing.droppedRows} dropped for missing values)` },
                    { label: 'Result type', value: <Badge variant={penalized.fit.exactness}>{EXACTNESS_LABEL[penalized.fit.exactness]}</Badge> },
                  ]}
                />
                {penalized.fit.warnings.length > 0 && <Notice tone="warning" items={penalized.fit.warnings} />}
                <Notice tone="info" title="Limitations the engine attaches to this fit" items={penalized.fit.limitations} />
                <p className="oc-chart-note">{CAUSATION_NOTE}</p>
              </Card>

              <Card title="Diagnostics for a penalised fit">
                <ScatterChart
                  title="Residuals against fitted values"
                  description="The residuals of the penalised fit. The influence, collinearity and interval panels are deliberately absent: they are built on least-squares inference, which does not apply here."
                  points={penalized.fit.fitted.map((f, i) => ({ x: f, y: penalized.fit.residuals[i] }))}
                  xLabel="Fitted value"
                  yLabel="Residual"
                />
                <Notice tone="info">
                  Prediction and confidence bands, the F test, the influence table and the robust standard errors are not shown for a penalised fit because there is no
                  exact interval theory for one. Switch to ordinary least squares to see them, and read them as applying to that model, not to this one.
                </Notice>
              </Card>
            </>
          )}

          {glm && (
            <>
              <Card title="Coefficients" hint={`${glm.fit.family} model, ${glm.fit.link} link. ${(config.level * 100).toFixed(1)}% intervals from the asymptotic (Wald) standard errors.`}>
                <div style={{ overflowX: 'auto' }}>
                  <DataTable
                    caption="Coefficient estimates on the link scale, with z statistics and confidence intervals"
                    columns={glmColumns()}
                    rows={glm.fit.coefficients}
                  />
                </div>
                {glm.fit.coefficients.some((c) => c.exponentiated) && (
                  <div style={{ overflowX: 'auto' }}>
                    <DataTable
                      caption="Exponentiated coefficients with intervals"
                      columns={[
                        { key: 'name', header: 'Term', render: (r: GlmFit['coefficients'][number]) => r.name },
                        { key: 'label', header: 'Reading', render: (r: GlmFit['coefficients'][number]) => r.exponentiated?.label ?? '—' },
                        { key: 'exp', header: 'Estimate', numeric: true, render: (r: GlmFit['coefficients'][number]) => (r.exponentiated ? num(r.exponentiated.estimate) : '—') },
                        {
                          key: 'ci',
                          header: `${(config.level * 100).toFixed(1)}% interval`,
                          render: (r: GlmFit['coefficients'][number]) => (r.exponentiated ? interval(r.exponentiated.ciLow, r.exponentiated.ciHigh) : '—'),
                        },
                      ]}
                      rows={glm.fit.coefficients}
                    />
                  </div>
                )}
                <KeyValueList
                  items={[
                    { label: 'Deviance', value: `${num(glm.fit.deviance)} on ${glm.fit.degreesOfFreedom} df` },
                    { label: 'Null deviance', value: `${num(glm.fit.nullDeviance)} on ${glm.fit.nullDegreesOfFreedom} df` },
                    { label: 'Pseudo-R² (McFadden)', value: num(glm.fit.pseudoRSquared.mcFadden) },
                    { label: 'Pseudo-R² (Cox–Snell)', value: num(glm.fit.pseudoRSquared.coxSnell) },
                    { label: 'Pseudo-R² (Nagelkerke)', value: num(glm.fit.pseudoRSquared.nagelkerke) },
                    { label: 'Likelihood-ratio test of the model', value: `χ² = ${num(glm.fit.likelihoodRatio.statistic)} on ${glm.fit.likelihoodRatio.degreesOfFreedom} df, p = ${pValue(glm.fit.likelihoodRatio.pValue)}` },
                    { label: 'AIC / BIC', value: `${num(glm.fit.aic)} / ${num(glm.fit.bic)}` },
                    { label: 'Dispersion (Pearson χ²/df)', value: num(glm.fit.dispersion) },
                    ...(glm.fit.theta !== undefined ? [{ label: 'θ (negative binomial)', value: num(glm.fit.theta) }] : []),
                    { label: 'Rows used', value: `${glm.fit.missing.rowsUsed} of ${glm.fit.missing.suppliedRows} (${glm.fit.missing.droppedRows} dropped for missing values)` },
                    { label: 'Result type', value: <Badge variant={glm.fit.exactness}>{EXACTNESS_LABEL[glm.fit.exactness]}</Badge> },
                  ]}
                />
                {'versusPoisson' in glm.fit && (
                  <Notice tone="info" title="Negative binomial against Poisson">
                    χ² = {num(glm.fit.versusPoisson.statistic)}, p = {pValue(glm.fit.versusPoisson.pValue)}. {glm.fit.versusPoisson.note}
                  </Notice>
                )}
                {glm.fit.warnings.length > 0 && <Notice tone="warning" title="What the fit wants you to know" items={glm.fit.warnings} />}
                <p className="oc-chart-note">
                  Pseudo-R² values are not proportions of explained variance and are not comparable with the R² of a linear model; all three conventions are shown so
                  that none of them is read as "the" R². {CAUSATION_NOTE}
                </p>
              </Card>

              <Card title="Held-out performance">
                {glm.heldOut.ok ? (
                  <KeyValueList
                    items={[
                      { label: `${config.folds}-fold held-out RMSE of the predicted mean`, value: num(glm.heldOut.value.rmse) },
                      { label: `${config.folds}-fold held-out MAE of the predicted mean`, value: num(glm.heldOut.value.mae) },
                      { label: 'Pseudo-R² (McFadden, in-sample)', value: num(glm.fit.pseudoRSquared.mcFadden) },
                    ]}
                  />
                ) : (
                  <Notice tone="warning">{glm.heldOut.error}</Notice>
                )}
                <p className="oc-chart-note">
                  Every in-sample figure above — deviance, pseudo-R², and for a logistic model the AUC and Brier score below — is computed on the rows the model was
                  fitted to, so it is optimistic. The held-out numbers here are what the model does on rows it did not see; each fold was refitted from scratch.
                </p>
              </Card>

              <Card title="Diagnostics">
                <ScatterChart
                  title="Deviance residuals against the fitted mean"
                  description="The GLM analogue of residuals against fitted values. Structure here means the mean model or the link is wrong."
                  points={glm.fit.fitted.map((f, i) => ({ x: f, y: glm.fit.devianceResiduals[i] }))}
                  xLabel="Fitted mean"
                  yLabel="Deviance residual"
                />
                <ScatterChart
                  title="Pearson residuals against leverage"
                  description="Leverage from the final iteratively reweighted design. Points far right have unusual predictor values."
                  points={glm.fit.leverage.map((h, i) => ({ x: h, y: glm.fit.pearsonResiduals[i] }))}
                  xLabel="Leverage (hat value)"
                  yLabel="Pearson residual"
                />
                <Notice tone="info">
                  The influence table, the F test and the two interval bands are least-squares constructions and are not shown for a generalised linear model, rather
                  than being approximated and labelled as if they were the same thing.
                </Notice>
              </Card>

              {config.model === 'logistic' && (
                <Card title="Classification">
                  {glm.confusion?.ok ? (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <DataTable
                          caption={`Confusion matrix at a threshold of ${config.threshold.toFixed(2)}`}
                          columns={[
                            { key: 'r', header: '', render: (r: { label: string; pos: string; neg: string }) => r.label },
                            { key: 'p', header: 'Predicted positive', numeric: true, render: (r: { label: string; pos: string; neg: string }) => r.pos },
                            { key: 'n', header: 'Predicted negative', numeric: true, render: (r: { label: string; pos: string; neg: string }) => r.neg },
                          ]}
                          rows={[
                            { label: 'Actually positive', pos: String(glm.confusion.value.truePositive), neg: String(glm.confusion.value.falseNegative) },
                            { label: 'Actually negative', pos: String(glm.confusion.value.falsePositive), neg: String(glm.confusion.value.trueNegative) },
                          ]}
                        />
                      </div>
                      <KeyValueList
                        items={[
                          { label: 'Accuracy', value: formatPercent(glm.confusion.value.accuracy) },
                          { label: 'Sensitivity (recall)', value: formatPercent(glm.confusion.value.sensitivity) },
                          { label: 'Specificity', value: formatPercent(glm.confusion.value.specificity) },
                          { label: 'Precision', value: formatPercent(glm.confusion.value.precision) },
                          { label: 'F1', value: num(glm.confusion.value.f1) },
                        ]}
                      />
                      {glm.confusion.value.notes.length > 0 && <Notice tone="info" items={glm.confusion.value.notes} />}
                    </>
                  ) : (
                    glm.confusion && <Notice tone="warning">{glm.confusion.error}</Notice>
                  )}

                  {glm.classification?.ok ? (
                    <>
                      <RocChart
                        title="ROC curve"
                        description="Every threshold at once: the true-positive rate against the false-positive rate. The AUC is computed by the engine, not by the chart."
                        curves={[
                          {
                            label: `${glm.fit.yName} (AUC ${num(glm.classification.value.auc, 4)})`,
                            points: glm.classification.value.roc.map((p) => ({ fpr: p.falsePositiveRate, tpr: p.truePositiveRate })),
                            auc: glm.classification.value.auc,
                          },
                        ]}
                      />
                      <PrecisionRecallChart
                        title="Precision–recall curve"
                        description="More informative than the ROC curve when the classes are unbalanced, because the false-positive rate has a large denominator and hides false positives."
                        curves={[
                          {
                            label: 'Precision against recall',
                            points: glm.classification.value.precisionRecall.map((p) => ({ recall: p.recall, precision: p.precision })),
                            auc: averagePrecision(glm.classification.value),
                          },
                        ]}
                        prevalence={glm.classification.value.baseRate}
                      />
                      <KeyValueList
                        items={[
                          { label: 'AUC', value: num(glm.classification.value.auc, 4) },
                          { label: 'Brier score', value: num(glm.classification.value.brierScore) },
                          { label: 'Brier score of always predicting the base rate', value: num(glm.classification.value.brierBaseline) },
                          { label: 'Base rate of the positive class', value: formatPercent(glm.classification.value.baseRate) },
                          { label: 'Result type', value: <Badge variant={glm.classification.value.exactness}>{EXACTNESS_LABEL[glm.classification.value.exactness]}</Badge> },
                        ]}
                      />
                      {glm.classification.value.warnings.length > 0 && <Notice tone="warning" items={glm.classification.value.warnings} />}
                      <Notice tone="info" title="How to read these" items={glm.classification.value.notes} />
                    </>
                  ) : (
                    glm.classification && <Notice tone="warning">{glm.classification.error}</Notice>
                  )}

                  {glm.calibration?.ok ? (
                    <>
                      <div style={{ overflowX: 'auto' }}>
                        <DataTable
                          caption="Hosmer–Lemeshow calibration table: observed against expected by risk group"
                          columns={[
                            { key: 'g', header: 'Group', render: (_r: HosmerLemeshow['groups'][number], i: number) => String(i + 1) },
                            { key: 'n', header: 'Observations', numeric: true, render: (r: HosmerLemeshow['groups'][number]) => String(r.count) },
                            { key: 'mp', header: 'Mean predicted', numeric: true, render: (r: HosmerLemeshow['groups'][number]) => num(r.meanPredicted) },
                            { key: 'e', header: 'Expected positives', numeric: true, render: (r: HosmerLemeshow['groups'][number]) => num(r.expected) },
                            { key: 'o', header: 'Observed positives', numeric: true, render: (r: HosmerLemeshow['groups'][number]) => String(r.observed) },
                          ]}
                          rows={glm.calibration.value.groups}
                        />
                      </div>
                      <Notice tone={glm.calibration.value.rejects ? 'warning' : 'info'} title="Hosmer–Lemeshow calibration test">
                        {glm.calibration.value.interpretation}
                      </Notice>
                      {glm.calibration.value.warnings.length > 0 && <Notice tone="warning" items={glm.calibration.value.warnings} />}
                    </>
                  ) : (
                    glm.calibration && <Notice tone="warning" title="Hosmer–Lemeshow calibration test">{glm.calibration.error}</Notice>
                  )}
                  <p className="oc-chart-note">
                    Ranking and calibration are different properties: a model can separate the classes well (high AUC) and still give probabilities that are badly
                    wrong (poor Brier score and calibration table). Perfectly separable data has no finite maximum-likelihood solution at all, and the engine refuses
                    it with a message instead of printing the large finite coefficients the iteration happened to stop on.
                  </p>
                </Card>
              )}

              {config.model === 'poisson' && (
                <Card title="Overdispersion">
                  {glm.overdispersion?.ok ? (
                    <>
                      <KeyValueList
                        items={[
                          { label: 'Dispersion (Pearson χ²/df)', value: num(glm.overdispersion.value.dispersion) },
                          { label: 'Pearson χ²', value: `${num(glm.overdispersion.value.pearsonChiSquare)} on ${glm.overdispersion.value.degreesOfFreedom} df` },
                          { label: 'p-value', value: pValue(glm.overdispersion.value.pValue) },
                          { label: 'Overdispersed?', value: glm.overdispersion.value.overdispersed ? 'Yes — see the recommendation below' : 'No evidence of it in this data' },
                        ]}
                      />
                      <Notice tone={glm.overdispersion.value.overdispersed ? 'warning' : 'info'}>{glm.overdispersion.value.interpretation}</Notice>
                      <Notice tone={glm.overdispersion.value.overdispersed ? 'warning' : 'info'} title="What to do about it">
                        {glm.overdispersion.value.recommendation}
                      </Notice>
                      {glm.overdispersion.value.overdispersed && (
                        <>
                          <Button size="sm" variant="primary" onClick={() => set({ model: 'negbin' })}>
                            Refit as a negative binomial model
                          </Button>
                          <p className="oc-chart-note">
                          It estimates the extra variance through θ instead of assuming the variance equals the mean. Fitting a Poisson GLM to overdispersed counts
                          understates <strong>every</strong> standard error, by roughly √dispersion, so the p-values above come out far too small.
                          </p>
                        </>
                      )}
                    </>
                  ) : (
                    glm.overdispersion && <Notice tone="warning">{glm.overdispersion.error}</Notice>
                  )}
                </Card>
              )}
            </>
          )}

          {explanation && (
            <Card title="What this result is, and what it is not">
              <ExplanationPanel explanation={explanation} defaultOpen />
              <Notice tone="info" title="Association, not causation">
                {CAUSATION_NOTE} The exactness label above says how the numbers were produced: an exact linear-algebra solve, a numerical iteration, or an empirical
                estimate from resampling. Cross-validated figures are empirical and would differ slightly with a different fold assignment.
              </Notice>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Table column definitions
 * ------------------------------------------------------------------ */

function coefficientColumns(): ColumnDef<LinearFit['coefficients'][number]>[] {
  return [
    { key: 'name', header: 'Term', render: (r) => r.name },
    { key: 'est', header: 'Estimate', numeric: true, render: (r) => num(r.estimate) },
    { key: 'se', header: 'Std. error', numeric: true, render: (r) => num(r.stdError) },
    { key: 't', header: 't', numeric: true, render: (r) => num(r.tStatistic, 3) },
    { key: 'p', header: 'p-value', numeric: true, render: (r) => pValue(r.pValue) },
    { key: 'ci', header: 'Confidence interval', render: (r) => interval(r.ciLow, r.ciHigh) },
  ];
}

function glmColumns(): ColumnDef<GlmFit['coefficients'][number]>[] {
  return [
    { key: 'name', header: 'Term', render: (r) => r.name },
    { key: 'est', header: 'Estimate (link scale)', numeric: true, render: (r) => num(r.estimate) },
    { key: 'se', header: 'Std. error', numeric: true, render: (r) => num(r.stdError) },
    { key: 'z', header: 'z', numeric: true, render: (r) => num(r.zStatistic, 3) },
    { key: 'p', header: 'p-value', numeric: true, render: (r) => pValue(r.pValue) },
    { key: 'ci', header: 'Confidence interval', render: (r) => interval(r.ciLow, r.ciHigh) },
  ];
}

function robustColumns(fit: LinearFit): ColumnDef<{ name: string; index: number }>[] {
  return [
    { key: 'name', header: 'Term', render: (r) => r.name },
    { key: 'cl', header: 'Classical', numeric: true, render: (r) => num(fit.classicalStdErrors[r.index]) },
    { key: 'HC0', header: 'HC0', numeric: true, render: (r) => num(fit.robustStdErrors.HC0[r.index]) },
    { key: 'HC1', header: 'HC1', numeric: true, render: (r) => num(fit.robustStdErrors.HC1[r.index]) },
    { key: 'HC2', header: 'HC2', numeric: true, render: (r) => num(fit.robustStdErrors.HC2[r.index]) },
    { key: 'HC3', header: 'HC3', numeric: true, render: (r) => num(fit.robustStdErrors.HC3[r.index]) },
    {
      key: 'ratio',
      header: 'HC3 ÷ classical',
      numeric: true,
      title: 'How much wider or narrower the robust standard error is than the classical one.',
      render: (r) => {
        const classical = fit.classicalStdErrors[r.index];
        return classical > 0 ? `×${num(fit.robustStdErrors.HC3[r.index] / classical, 3)}` : 'not defined';
      },
    },
  ];
}

function influenceColumns(lineNumbers: number[], rowIndex: number[]): ColumnDef<InfluenceReport['rows'][number]>[] {
  return [
    { key: 'row', header: 'Row', numeric: true, render: (r) => String(r.index) },
    { key: 'line', header: 'Line', numeric: true, title: 'Line number in the data entered above.', render: (r) => String(lineNumbers[rowIndex[r.index]] ?? '?') },
    { key: 'fit', header: 'Fitted', numeric: true, render: (r) => num(r.fitted) },
    { key: 'res', header: 'Residual', numeric: true, render: (r) => num(r.residual) },
    { key: 'lev', header: 'Leverage', numeric: true, render: (r) => num(r.leverage) },
    { key: 'std', header: 'Standardised', numeric: true, render: (r) => num(r.standardisedResidual, 3) },
    { key: 'stu', header: 'Studentised', numeric: true, render: (r) => num(r.studentisedResidual, 3) },
    { key: 'cook', header: "Cook's D", numeric: true, render: (r) => num(r.cooksDistance) },
    { key: 'dff', header: 'DFFITS', numeric: true, render: (r) => num(r.dffits, 3) },
    { key: 'flag', header: 'Flagged', render: (r) => (r.flags.length ? r.flags.join('; ') : '—') },
  ];
}

/**
 * The precision–recall chart asks for the area under ITS curve. The engine
 * computes areas, never the chart, so the average precision is taken from the
 * engine's own precision–recall points by the trapezoid rule over recall.
 */
function averagePrecision(report: ClassificationReport): number {
  const pts = [...report.precisionRecall].sort((a, b) => a.recall - b.recall);
  let area = 0;
  for (let i = 1; i < pts.length; i++) {
    area += ((pts[i].recall - pts[i - 1].recall) * (pts[i].precision + pts[i - 1].precision)) / 2;
  }
  return area;
}
