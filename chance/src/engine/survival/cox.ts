/**
 * Cox proportional hazards regression, fitted by Newton–Raphson on the partial
 * likelihood.
 *
 * Tie handling defaults to Efron's approximation. Breslow's is cruder: it
 * treats all deaths at a tied time as if they occurred against the full risk
 * set, which biases coefficients toward zero when ties are heavy. Both are
 * implemented and the fit reports which was used.
 *
 * A Cox model reported without a proportional-hazards check is unverified.
 * `coxDiagnostics` in ./diagnostics.ts performs that check, and every fit
 * carries a warning saying so.
 */

import { attempt, EngineError, Validator, type EngineResult, type Explanation } from '../core/result.ts';
import { solve, choleskyWithCheck, type Matrix } from '../stats/linalg.ts';
import { normalCdf } from '../special/gamma.ts';
import {
  INDEPENDENT_CENSORING,
  censoringNote,
  heavyCensoringWarnings,
  summarizeFollowUp,
  validateSurvivalInput,
  zForLevel,
  type FollowUpSummary,
} from './data.ts';
import { chiSquareSurvival } from './logrank.ts';

export type TieHandling = 'efron' | 'breslow';

export const PH_CHECK_REQUIRED =
  'A Cox model assumes the hazard ratio is constant over time (proportional hazards). That ' +
  'assumption is not checked by fitting the model. Run the Schoenfeld residual test before ' +
  'reporting any coefficient: if it fails, the hazard ratio is an average over a changing effect ' +
  'and does not describe the data at any particular time.';

/** Counting-process row: at risk over (start, stop]. */
export interface CoxRow {
  start: number;
  stop: number;
  event: 0 | 1;
  covariates: number[];
  stratum?: number | string;
  /** Subject id, so repeated rows of a time-varying covariate share a cluster. */
  id?: number | string;
}

export interface CoxCoefficient {
  name: string;
  coefficient: number;
  stdError: number;
  robustStdError: number;
  hazardRatio: number;
  hazardRatioLower: number;
  hazardRatioUpper: number;
  z: number;
  pValue: number;
}

export interface CoxTests {
  wald: { statistic: number; df: number; pValue: number };
  score: { statistic: number; df: number; pValue: number };
  likelihoodRatio: { statistic: number; df: number; pValue: number };
}

export interface BaselineHazardPoint {
  time: number;
  /** Breslow increment dΛ̂₀(t) = d_j / Σ_{i∈R(t)} exp(ηᵢ). */
  increment: number;
  cumulativeHazard: number;
  baselineSurvival: number;
  stratum?: number | string;
}

export interface CoxFit {
  covariateNames: string[];
  coefficients: CoxCoefficient[];
  /** Inverse of the observed information: the model-based covariance of β̂. */
  covariance: Matrix;
  robustCovariance: Matrix;
  logLikelihood: number;
  nullLogLikelihood: number;
  iterations: number;
  tieHandling: TieHandling;
  tiedEventTimes: number;
  tests: CoxTests;
  /** Harrell's C; null when not computed (quadratic cost at large n). */
  concordance: number | null;
  concordanceNote: string | null;
  baselineHazard: BaselineHazardPoint[];
  summary: FollowUpSummary;
  strata: (number | string)[] | null;
  level: number;
  /** Per-subject score residuals, used for the robust variance and dfbeta. */
  scoreResiduals: number[][];
  dfbeta: number[][];
  explanation: Explanation;
  /** The prepared design, kept so diagnostics need not re-validate. */
  design: CoxDesign;
}

export interface CoxOptions {
  names?: string[];
  tieHandling?: TieHandling;
  level?: number;
  maxIterations?: number;
  tolerance?: number;
  /** Compute Harrell's C; defaults to true for n ≤ 4000. */
  concordance?: boolean;
  /** Cluster labels for the robust variance; defaults to row ids or row index. */
  cluster?: (number | string)[];
  /**
   * Largest |β| treated as an estimate. Beyond this the fit is reported as
   * not identified rather than as a very large hazard ratio. Default 20.
   */
  maxCoefficient?: number;
}

export interface CoxDesign {
  rows: CoxRow[];
  names: string[];
  p: number;
  /** Row indices grouped by stratum, in input order. */
  strata: { label: number | string; rows: number[] }[];
  hasStrata: boolean;
  summary: FollowUpSummary;
}

/** Build a right-censored design from time/status/covariate arrays. */
export function coxDesignFromArrays(
  time: readonly number[],
  status: readonly number[],
  covariates: readonly number[][],
  options: { names?: string[]; strata?: (number | string)[]; ids?: (number | string)[] } = {},
): CoxDesign {
  validateSurvivalInput(time, status);
  const v = new Validator();
  const n = time.length;
  if (covariates.length !== n) {
    v.add(
      `Mismatched lengths: ${n} times but ${covariates.length} covariate rows. ` +
        'Supply one covariate vector per subject.',
      'covariates',
      'length',
    );
    v.throwIfInvalid();
  }
  const p = covariates[0].length;
  if (p === 0) {
    v.add('No covariates supplied; a Cox model needs at least one.', 'covariates', 'empty');
  }
  covariates.forEach((row, i) => {
    if (row.length !== p) {
      v.add(
        `Covariate row ${i + 1} has ${row.length} values but row 1 has ${p}. All rows must match.`,
        'covariates',
        'length',
      );
      return;
    }
    row.forEach((x, j) => {
      if (!Number.isFinite(x)) {
        v.add(`Covariate ${j + 1} of subject ${i + 1} is not a finite number.`, 'covariates', 'finite');
      }
    });
  });
  if (options.strata && options.strata.length !== n) {
    v.add(`Mismatched lengths: ${n} subjects but ${options.strata.length} stratum labels.`, 'strata', 'length');
  }
  if (options.names && options.names.length !== p) {
    v.add(`Expected ${p} covariate names but received ${options.names.length}.`, 'names', 'length');
  }
  v.throwIfInvalid();
  const rows: CoxRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      start: 0,
      stop: time[i],
      event: status[i] === 1 ? 1 : 0,
      covariates: [...covariates[i]],
      stratum: options.strata ? options.strata[i] : undefined,
      id: options.ids ? options.ids[i] : i,
    });
  }
  return finishDesign(rows, options.names ?? defaultNames(p), summarizeFollowUp(time, status));
}

function defaultNames(p: number): string[] {
  return Array.from({ length: p }, (_, j) => `x${j + 1}`);
}

/** Build a design from counting-process rows (start, stop] — time-varying covariates. */
export function coxDesignFromCountingProcess(
  rows: readonly CoxRow[],
  names?: string[],
): CoxDesign {
  const v = new Validator();
  if (rows.length === 0) v.add('No rows supplied.', 'rows', 'empty');
  v.throwIfInvalid();
  const p = rows[0].covariates.length;
  if (p === 0) v.add('No covariates supplied; a Cox model needs at least one.', 'rows', 'empty');
  let events = 0;
  rows.forEach((r, i) => {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.stop)) {
      v.add(`Row ${i + 1} has a non-finite interval [${String(r.start)}, ${String(r.stop)}].`, 'rows', 'finite');
    } else if (r.start < 0) {
      v.add(`Row ${i + 1} has a negative start time (${r.start}).`, 'rows', 'range');
    } else if (!(r.stop > r.start)) {
      v.add(`Row ${i + 1} must satisfy stop > start (got (${r.start}, ${r.stop}]).`, 'rows', 'range');
    }
    if (r.event !== 0 && r.event !== 1) {
      v.add(`Row ${i + 1} has status ${String(r.event)}; use 1 for an event and 0 for censored.`, 'rows', 'domain');
    } else if (r.event === 1) events++;
    if (r.covariates.length !== p) {
      v.add(`Row ${i + 1} has ${r.covariates.length} covariates but row 1 has ${p}.`, 'rows', 'length');
    }
    r.covariates.forEach((x, j) => {
      if (!Number.isFinite(x)) v.add(`Covariate ${j + 1} of row ${i + 1} is not finite.`, 'rows', 'finite');
    });
  });
  if (names && names.length !== p) {
    v.add(`Expected ${p} covariate names but received ${names.length}.`, 'names', 'length');
  }
  v.throwIfInvalid();
  if (events === 0) {
    throw new EngineError([
      {
        code: 'no-events',
        message:
          'No events in the supplied rows: the partial likelihood is constant and no coefficient is estimable.',
        field: 'rows',
      },
    ]);
  }
  // Summary over subjects: one entry per id, total follow-up and whether an event occurred.
  const byId = new Map<number | string, { time: number; event: 0 | 1 }>();
  rows.forEach((r, i) => {
    const key = r.id ?? i;
    const prev = byId.get(key);
    const stop = Math.max(prev?.time ?? 0, r.stop);
    byId.set(key, { time: stop, event: (prev?.event ?? 0) === 1 || r.event === 1 ? 1 : 0 });
  });
  const times = [...byId.values()].map((x) => x.time);
  const statuses = [...byId.values()].map((x) => x.event as number);
  return finishDesign([...rows], names ?? defaultNames(p), summarizeFollowUp(times, statuses));
}

function finishDesign(rows: CoxRow[], names: string[], summary: FollowUpSummary): CoxDesign {
  const labels = [...new Set(rows.map((r) => r.stratum ?? '_all'))];
  const strata = labels.map((label) => ({
    label,
    rows: rows.map((_, i) => i).filter((i) => (rows[i].stratum ?? '_all') === label),
  }));
  return {
    rows,
    names,
    p: rows[0].covariates.length,
    strata,
    hasStrata: !(labels.length === 1 && labels[0] === '_all'),
    summary,
  };
}

/** Per-stratum precomputed ordering and death-time structure. */
interface StratumPlan {
  label: number | string;
  /** Row indices sorted by stop ascending. */
  byStop: number[];
  /** Row indices sorted by start ascending. */
  byStart: number[];
  /** Distinct event times ascending, with the rows that died there. */
  deaths: { time: number; rows: number[] }[];
}

function planStrata(design: CoxDesign): StratumPlan[] {
  return design.strata.map((s) => {
    const byStop = [...s.rows].sort((a, b) => design.rows[a].stop - design.rows[b].stop);
    const byStart = [...s.rows].sort((a, b) => design.rows[a].start - design.rows[b].start);
    const map = new Map<number, number[]>();
    for (const i of s.rows) {
      if (design.rows[i].event !== 1) continue;
      const t = design.rows[i].stop;
      const list = map.get(t);
      if (list) list.push(i);
      else map.set(t, [i]);
    }
    const deaths = [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, rowsAt]) => ({ time, rows: rowsAt }));
    return { label: s.label, byStop, byStart, deaths };
  });
}

interface Accumulation {
  logLik: number;
  gradient: number[];
  information: Matrix;
}

/**
 * Partial likelihood, score and observed information at β.
 * Risk sets are swept in descending death-time order with two pointers, so the
 * cost is O(n log n + n·p²) per evaluation regardless of the number of ties.
 */
function evaluate(design: CoxDesign, plans: StratumPlan[], beta: readonly number[], ties: TieHandling): Accumulation {
  const p = design.p;
  let logLik = 0;
  const gradient = new Array<number>(p).fill(0);
  const information: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));

  for (const plan of plans) {
    if (plan.deaths.length === 0) continue;
    const w = new Map<number, number>();
    const linear = new Map<number, number>();
    for (const i of plan.byStop) {
      let eta = 0;
      const x = design.rows[i].covariates;
      for (let j = 0; j < p; j++) eta += beta[j] * x[j];
      linear.set(i, eta);
      w.set(i, Math.exp(eta));
    }
    let s0 = 0;
    const s1 = new Array<number>(p).fill(0);
    const s2: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const add = (i: number, sign: number): void => {
      const wi = sign * w.get(i)!;
      const x = design.rows[i].covariates;
      s0 += wi;
      for (let a = 0; a < p; a++) {
        s1[a] += wi * x[a];
        for (let b = 0; b <= a; b++) s2[a][b] += wi * x[a] * x[b];
      }
    };
    let stopPtr = plan.byStop.length - 1; // entering as t decreases (stop ≥ t)
    let startPtr = plan.byStart.length - 1; // leaving as t decreases (start ≥ t)
    const entered = new Set<number>();
    for (let k = plan.deaths.length - 1; k >= 0; k--) {
      const t = plan.deaths[k].time;
      while (stopPtr >= 0 && design.rows[plan.byStop[stopPtr]].stop >= t) {
        const i = plan.byStop[stopPtr];
        if (design.rows[i].start < t) {
          add(i, +1);
          entered.add(i);
        }
        stopPtr--;
      }
      while (startPtr >= 0 && design.rows[plan.byStart[startPtr]].start >= t) {
        const i = plan.byStart[startPtr];
        if (entered.delete(i)) add(i, -1);
        startPtr--;
      }
      const dieRows = plan.deaths[k].rows;
      const d = dieRows.length;
      let s0d = 0;
      const s1d = new Array<number>(p).fill(0);
      const s2d: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      for (const i of dieRows) {
        const wi = w.get(i)!;
        const x = design.rows[i].covariates;
        logLik += linear.get(i)!;
        s0d += wi;
        for (let a = 0; a < p; a++) {
          gradient[a] += x[a];
          s1d[a] += wi * x[a];
          for (let b = 0; b <= a; b++) s2d[a][b] += wi * x[a] * x[b];
        }
      }
      const steps = ties === 'efron' ? d : 1;
      for (let l = 0; l < steps; l++) {
        const frac = ties === 'efron' ? l / d : 0;
        const mult = ties === 'efron' ? 1 : d;
        const a0 = s0 - frac * s0d;
        if (!(a0 > 0)) {
          throw new EngineError([
            {
              code: 'empty-risk-set',
              message:
                `The risk set at time ${t} has no weight left, so the partial likelihood is undefined. ` +
                'This usually means the data contain an event at a time when nobody (including the ' +
                'subject who died) is at risk, or the counting-process intervals are inconsistent.',
              field: 'rows',
            },
          ]);
        }
        logLik -= mult * Math.log(a0);
        for (let a = 0; a < p; a++) {
          const a1a = s1[a] - frac * s1d[a];
          gradient[a] -= (mult * a1a) / a0;
          for (let b = 0; b <= a; b++) {
            const a1b = s1[b] - frac * s1d[b];
            const a2 = s2[a][b] - frac * s2d[a][b];
            information[a][b] += mult * (a2 / a0 - (a1a * a1b) / (a0 * a0));
          }
        }
      }
    }
  }
  for (let a = 0; a < design.p; a++) for (let b = a + 1; b < design.p; b++) information[a][b] = information[b][a];
  return { logLik, gradient, information };
}

function invert(m: Matrix): Matrix | null {
  const n = m.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const e = new Array<number>(n).fill(0);
    e[j] = 1;
    const col = solve(
      m.map((r) => [...r]),
      e,
    );
    if (!col) return null;
    for (let i = 0; i < n; i++) out[i][j] = col[i];
  }
  return out;
}

export function fitCox(design: CoxDesign, options: CoxOptions = {}): EngineResult<CoxFit> {
  return attempt(() => fitCoxOrThrow(design, options));
}

export function fitCoxOrThrow(design: CoxDesign, options: CoxOptions = {}): CoxFit {
  const ties: TieHandling = options.tieHandling ?? 'efron';
  const level = options.level ?? 0.95;
  const z = zForLevel(level);
  const maxIterations = options.maxIterations ?? 50;
  const tol = options.tolerance ?? 1e-9;
  const plans = planStrata(design);
  const p = design.p;
  if (!plans.some((s) => s.deaths.length > 0)) {
    throw new EngineError([
      { code: 'no-events', message: 'No events in any stratum; no coefficient is estimable.', field: 'rows' },
    ]);
  }

  const nullFit = evaluate(design, plans, new Array<number>(p).fill(0), ties);
  const scoreStat = (() => {
    const inv = invert(nullFit.information.map((r) => [...r]));
    if (!inv) return null;
    let q = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) q += nullFit.gradient[a] * inv[a][b] * nullFit.gradient[b];
    return q;
  })();

  let beta = new Array<number>(p).fill(0);
  let current = nullFit;
  let iterations = 0;
  let converged = false;
  for (; iterations < maxIterations; iterations++) {
    const chol = choleskyWithCheck(current.information.map((r) => [...r]));
    if (!chol.ok) {
      throw new EngineError([
        {
          code: 'not-identified',
          message:
            'The observed information matrix is not positive definite, so the partial likelihood has no ' +
            'unique maximum. The usual causes are a covariate that is collinear with another, a ' +
            'covariate that is constant, or a covariate that perfectly separates the risk sets (every ' +
            'event occurring in one covariate group), in which case the coefficient is infinite and no ' +
            'finite estimate exists.',
          field: 'covariates',
        },
      ]);
    }
    const step = solve(
      current.information.map((r) => [...r]),
      [...current.gradient],
    );
    if (!step) {
      throw new EngineError([
        { code: 'singular', message: 'Newton–Raphson step could not be solved: the information matrix is singular.', field: 'covariates' },
      ]);
    }
    let scale = 1;
    let next = current;
    let nextBeta = beta;
    let accepted = false;
    for (let halving = 0; halving < 30; halving++) {
      nextBeta = beta.map((b, j) => b + scale * step[j]);
      if (nextBeta.some((b) => !Number.isFinite(b))) break;
      try {
        next = evaluate(design, plans, nextBeta, ties);
      } catch {
        scale /= 2;
        continue;
      }
      if (Number.isFinite(next.logLik) && next.logLik >= current.logLik - 1e-12) {
        accepted = true;
        break;
      }
      scale /= 2;
    }
    if (!accepted) {
      throw new EngineError([
        {
          code: 'no-convergence',
          message:
            `Newton–Raphson failed to improve the partial likelihood after ${iterations} iterations, even ` +
            'with step halving. The model is not identified by this data — most often a covariate that ' +
            'separates the risk sets, so that the maximising coefficient is infinite.',
          field: 'covariates',
        },
      ]);
    }
    const improvement = next.logLik - current.logLik;
    const maxGrad = Math.max(...next.gradient.map((g) => Math.abs(g)));
    beta = nextBeta;
    current = next;
    if (Math.abs(improvement) < tol * (Math.abs(current.logLik) + tol) || maxGrad < 1e-8) {
      converged = true;
      iterations++;
      break;
    }
  }
  if (!converged) {
    throw new EngineError([
      {
        code: 'no-convergence',
        message:
          `Newton–Raphson did not converge within ${maxIterations} iterations ` +
          `(largest remaining score component ${Math.max(...current.gradient.map((g) => Math.abs(g))).toExponential(3)}). ` +
          'No coefficient is reported: a non-converged fit is not an estimate.',
        field: 'covariates',
      },
    ]);
  }
  const maxCoefficient = options.maxCoefficient ?? 20;
  if (beta.some((b) => Math.abs(b) > maxCoefficient)) {
    const which = design.names.filter((_, j) => Math.abs(beta[j]) > maxCoefficient).join(', ');
    throw new EngineError([
      {
        code: 'not-identified',
        message:
          `The partial likelihood has no finite maximum: the coefficient for ${which} ran past ` +
          `±${maxCoefficient} (a hazard ratio beyond e^${maxCoefficient}). This is what a covariate that ` +
          'perfectly separates the risk sets looks like — every event falling on one side of it — and the ' +
          'maximising coefficient is infinite. No estimate is reported, because any finite number printed ' +
          'here would be an artefact of where the iteration happened to stop.',
        field: 'covariates',
      },
    ]);
  }
  if (beta.some((b) => !Number.isFinite(b))) {
    throw new EngineError([
      { code: 'no-convergence', message: 'A coefficient diverged to a non-finite value; the model is not identified.', field: 'covariates' },
    ]);
  }

  const covariance = invert(current.information.map((r) => [...r]));
  if (!covariance) {
    throw new EngineError([
      { code: 'singular', message: 'The information matrix at the maximum is singular; standard errors are undefined.', field: 'covariates' },
    ]);
  }

  const baselineHazard = breslowBaseline(design, plans, beta);
  const { scoreResiduals, dfbeta, robustCovariance } = robustVariance(
    design,
    plans,
    beta,
    covariance,
    options.cluster,
  );

  const waldStat = (() => {
    const inv = current.information;
    let q = 0;
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) q += beta[a] * inv[a][b] * beta[b];
    return q;
  })();
  const lrStat = 2 * (current.logLik - nullFit.logLik);

  const coefficients: CoxCoefficient[] = beta.map((b, j) => {
    const se = Math.sqrt(covariance[j][j]);
    const zj = b / se;
    return {
      name: design.names[j],
      coefficient: b,
      stdError: se,
      robustStdError: Math.sqrt(robustCovariance[j][j]),
      hazardRatio: Math.exp(b),
      hazardRatioLower: Math.exp(b - z * se),
      hazardRatioUpper: Math.exp(b + z * se),
      z: zj,
      pValue: 2 * (1 - normalCdf(Math.abs(zj))),
    };
  });

  const n = design.rows.length;
  const wantConcordance = options.concordance ?? n <= 4000;
  const concordance = wantConcordance ? harrellC(design, beta) : null;
  const concordanceNote = wantConcordance
    ? null
    : `Harrell's C was not computed: it compares all O(n²) pairs and n = ${n}. Pass concordance: true to force it.`;

  const tiedEventTimes = plans.reduce((acc, s) => acc + s.deaths.filter((d) => d.rows.length > 1).length, 0);
  const summary = design.summary;
  const warnings = heavyCensoringWarnings(summary);
  if (summary.events < 10 * p) {
    warnings.push(
      `${summary.events} events for ${p} covariate${p === 1 ? '' : 's'}. The usual rule of thumb is at ` +
        'least 10 events per covariate; below that, coefficients and standard errors are unstable.',
    );
  }

  return {
    covariateNames: design.names,
    coefficients,
    covariance,
    robustCovariance,
    logLikelihood: current.logLik,
    nullLogLikelihood: nullFit.logLik,
    iterations,
    tieHandling: ties,
    tiedEventTimes,
    tests: {
      wald: { statistic: waldStat, df: p, pValue: chiSquareSurvival(waldStat, p) },
      score:
        scoreStat === null
          ? { statistic: NaN, df: p, pValue: NaN }
          : { statistic: scoreStat, df: p, pValue: chiSquareSurvival(scoreStat, p) },
      likelihoodRatio: { statistic: lrStat, df: p, pValue: chiSquareSurvival(Math.max(lrStat, 0), p) },
    },
    concordance,
    concordanceNote,
    baselineHazard,
    summary,
    strata: design.hasStrata ? design.strata.map((s) => s.label) : null,
    level,
    scoreResiduals,
    dfbeta,
    explanation: {
      method: `Cox proportional hazards model, Newton–Raphson on the partial likelihood, ${ties} tie handling`,
      formula: 'h(t | x) = h₀(t) · exp(xᵀβ)',
      steps: [
        { label: 'Sample', value: censoringNote(summary) },
        { label: 'Covariates', value: design.names.join(', ') },
        { label: 'Tie handling', value: ties === 'efron' ? "Efron's approximation (default; more accurate with ties)" : "Breslow's approximation (cruder with ties; biased toward zero)" },
        { label: 'Tied event times', value: String(tiedEventTimes) },
        { label: 'Iterations', value: String(iterations) },
        { label: 'Log partial likelihood', value: current.logLik.toFixed(6) },
        ...(design.hasStrata ? [{ label: 'Strata', value: String(design.strata.length) }] : []),
        ...warnings.map((w) => ({ label: 'Warning', value: w })),
        { label: 'Required check', value: PH_CHECK_REQUIRED },
      ],
      assumptions: [
        INDEPENDENT_CENSORING,
        'Proportional hazards: the ratio exp(xᵀβ) does not change with time. NOT verified by this fit.',
        'The log hazard is assumed linear in each covariate, on the scale supplied.',
        'Subjects are assumed independent unless cluster labels were given, in which case the robust variance accounts for within-cluster correlation.',
      ],
      limitations: [
        PH_CHECK_REQUIRED,
        'The baseline hazard is left unspecified, so the model says nothing about absolute risk without the Breslow baseline estimate.',
        'Wald, score and likelihood-ratio p-values are asymptotic chi-square approximations; they disagree at small event counts, and the likelihood-ratio test is then the most reliable.',
        'Score residuals and the robust variance use Breslow weighting for dΛ̂₀ even when Efron tie handling was used for the fit.',
      ],
      exactness: 'numerical',
    },
    design,
  };
}

/** Convenience wrapper for right-censored data. */
export function coxRegression(
  time: readonly number[],
  status: readonly number[],
  covariates: readonly number[][],
  options: CoxOptions & { strata?: (number | string)[]; ids?: (number | string)[] } = {},
): EngineResult<CoxFit> {
  return attempt(() => {
    const design = coxDesignFromArrays(time, status, covariates, {
      names: options.names,
      strata: options.strata,
      ids: options.ids,
    });
    return fitCoxOrThrow(design, options);
  });
}

function breslowBaseline(
  design: CoxDesign,
  plans: StratumPlan[],
  beta: readonly number[],
): BaselineHazardPoint[] {
  const out: BaselineHazardPoint[] = [];
  for (const plan of plans) {
    const w = new Map<number, number>();
    for (const i of plan.byStop) {
      let eta = 0;
      const x = design.rows[i].covariates;
      for (let j = 0; j < design.p; j++) eta += beta[j] * x[j];
      w.set(i, Math.exp(eta));
    }
    const increments: { time: number; increment: number }[] = [];
    let s0 = 0;
    let stopPtr = plan.byStop.length - 1;
    let startPtr = plan.byStart.length - 1;
    const entered = new Set<number>();
    for (let k = plan.deaths.length - 1; k >= 0; k--) {
      const t = plan.deaths[k].time;
      while (stopPtr >= 0 && design.rows[plan.byStop[stopPtr]].stop >= t) {
        const i = plan.byStop[stopPtr];
        if (design.rows[i].start < t) {
          s0 += w.get(i)!;
          entered.add(i);
        }
        stopPtr--;
      }
      while (startPtr >= 0 && design.rows[plan.byStart[startPtr]].start >= t) {
        const i = plan.byStart[startPtr];
        if (entered.delete(i)) s0 -= w.get(i)!;
        startPtr--;
      }
      increments.push({ time: t, increment: plan.deaths[k].rows.length / s0 });
    }
    increments.reverse();
    let cum = 0;
    for (const inc of increments) {
      cum += inc.increment;
      out.push({
        time: inc.time,
        increment: inc.increment,
        cumulativeHazard: cum,
        baselineSurvival: Math.exp(-cum),
        ...(design.hasStrata ? { stratum: plan.label } : {}),
      });
    }
  }
  return out;
}

/**
 * Predicted survival curve for a covariate vector, S(t | x) = S₀(t)^exp(xᵀβ).
 * This is the Breslow baseline raised to the relative hazard: it inherits the
 * proportional-hazards assumption entirely.
 */
export function predictedSurvival(
  fit: CoxFit,
  covariates: readonly number[],
  stratum?: number | string,
): EngineResult<{ curve: { time: number; survival: number }[]; relativeHazard: number; explanation: Explanation }> {
  return attempt(() => {
    const v = new Validator();
    if (covariates.length !== fit.covariateNames.length) {
      v.add(
        `Expected ${fit.covariateNames.length} covariate values but received ${covariates.length}.`,
        'covariates',
        'length',
      );
    }
    covariates.forEach((x, j) => v.finite(x, 'covariates', `Covariate ${fit.covariateNames[j] ?? j + 1}`));
    v.throwIfInvalid();
    let eta = 0;
    for (let j = 0; j < covariates.length; j++) eta += fit.coefficients[j].coefficient * covariates[j];
    const rel = Math.exp(eta);
    const points = fit.baselineHazard.filter((b) => (stratum === undefined ? true : b.stratum === stratum));
    if (points.length === 0) {
      throw new EngineError([
        {
          code: 'unknown-stratum',
          message: `No baseline hazard was estimated for stratum ${String(stratum)}.`,
          field: 'stratum',
        },
      ]);
    }
    return {
      relativeHazard: rel,
      curve: points.map((b) => ({ time: b.time, survival: Math.exp(-b.cumulativeHazard * rel) })),
      explanation: {
        method: 'Predicted survival from the Cox fit and the Breslow baseline hazard',
        formula: 'Ŝ(t | x) = exp(−Λ̂₀(t) · exp(xᵀβ̂))',
        steps: [
          { label: 'Relative hazard exp(xᵀβ̂)', value: rel.toFixed(6) },
          { label: 'Baseline points', value: String(points.length) },
        ],
        assumptions: [
          INDEPENDENT_CENSORING,
          'Proportional hazards, as in the fit. If the Schoenfeld test rejects it, this curve is wrong in a way that grows with time.',
        ],
        limitations: [
          'No standard error is attached to this curve here; the uncertainty in β̂ and in Λ̂₀ are both omitted, so it is a point prediction only.',
          'The curve cannot extend beyond the last event time in the data.',
        ],
        exactness: 'numerical',
      },
    };
  });
}

/**
 * Score residuals, dfbeta and the sandwich (robust) covariance.
 *
 * U_i = δ_i (x_i − x̄(T_i)) − exp(ηᵢ) [ x_i Λ̂₀(T_i) − ∫₀^{T_i} x̄ dΛ̂₀ ], with
 * both cumulative terms accumulated once over death times, so this is O(n·p).
 */
function robustVariance(
  design: CoxDesign,
  plans: StratumPlan[],
  beta: readonly number[],
  covariance: Matrix,
  cluster?: readonly (number | string)[],
): { scoreResiduals: number[][]; dfbeta: number[][]; robustCovariance: Matrix } {
  const p = design.p;
  const n = design.rows.length;
  const scoreResiduals: number[][] = Array.from({ length: n }, () => new Array<number>(p).fill(0));
  for (const plan of plans) {
    const w = new Map<number, number>();
    for (const i of plan.byStop) {
      let eta = 0;
      const x = design.rows[i].covariates;
      for (let j = 0; j < p; j++) eta += beta[j] * x[j];
      w.set(i, Math.exp(eta));
    }
    // Sweep death times descending to get S0 and S1 at each, then build the
    // cumulative sums Λ̂₀ and ∫ x̄ dΛ̂₀ in ascending order.
    const atDeath: { time: number; s0: number; s1: number[]; d: number }[] = [];
    let s0 = 0;
    const s1 = new Array<number>(p).fill(0);
    let stopPtr = plan.byStop.length - 1;
    let startPtr = plan.byStart.length - 1;
    const entered = new Set<number>();
    for (let k = plan.deaths.length - 1; k >= 0; k--) {
      const t = plan.deaths[k].time;
      while (stopPtr >= 0 && design.rows[plan.byStop[stopPtr]].stop >= t) {
        const i = plan.byStop[stopPtr];
        if (design.rows[i].start < t) {
          const wi = w.get(i)!;
          s0 += wi;
          for (let a = 0; a < p; a++) s1[a] += wi * design.rows[i].covariates[a];
          entered.add(i);
        }
        stopPtr--;
      }
      while (startPtr >= 0 && design.rows[plan.byStart[startPtr]].start >= t) {
        const i = plan.byStart[startPtr];
        if (entered.delete(i)) {
          const wi = w.get(i)!;
          s0 -= wi;
          for (let a = 0; a < p; a++) s1[a] -= wi * design.rows[i].covariates[a];
        }
        startPtr--;
      }
      atDeath.push({ time: t, s0, s1: [...s1], d: plan.deaths[k].rows.length });
    }
    atDeath.reverse();
    const deathIndexByTime = new Map<number, number>();
    atDeath.forEach((a, i) => deathIndexByTime.set(a.time, i));
    const cumHaz: number[] = [];
    const cumXbar: number[][] = [];
    let ch = 0;
    const cx = new Array<number>(p).fill(0);
    for (const a of atDeath) {
      const dLambda = a.d / a.s0;
      ch += dLambda;
      for (let j = 0; j < p; j++) cx[j] += (a.s1[j] / a.s0) * dLambda;
      cumHaz.push(ch);
      cumXbar.push([...cx]);
    }
    const upTo = (t: number): { ch: number; cx: number[] } => {
      // Largest death time ≤ t, by binary search.
      let lo = 0;
      let hi = atDeath.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (atDeath[mid].time <= t) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found < 0) return { ch: 0, cx: new Array<number>(p).fill(0) };
      return { ch: cumHaz[found], cx: cumXbar[found] };
    };
    for (const i of plan.byStop) {
      const row = design.rows[i];
      const res = scoreResiduals[i];
      const hiT = upTo(row.stop);
      const loT = upTo(row.start);
      const wi = w.get(i)!;
      const dLam = hiT.ch - loT.ch;
      for (let j = 0; j < p; j++) {
        const xbarInt = hiT.cx[j] - loT.cx[j];
        res[j] -= wi * (row.covariates[j] * dLam - xbarInt);
      }
      if (row.event === 1) {
        const atIdx = deathIndexByTime.get(row.stop);
        const at = atIdx === undefined ? undefined : atDeath[atIdx];
        if (at) {
          for (let j = 0; j < p; j++) res[j] += row.covariates[j] - at.s1[j] / at.s0;
        }
      }
    }
  }
  const dfbeta = scoreResiduals.map((u) => {
    const out = new Array<number>(p).fill(0);
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) out[a] += covariance[a][b] * u[b];
    return out;
  });
  // Sandwich: V = I⁻¹ (Σ_clusters U_c U_cᵀ) I⁻¹, clusters from labels or row ids.
  const labels = cluster ?? design.rows.map((r, i) => r.id ?? i);
  const byCluster = new Map<number | string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = labels[i];
    const agg = byCluster.get(key);
    if (agg) for (let j = 0; j < p; j++) agg[j] += scoreResiduals[i][j];
    else byCluster.set(key, [...scoreResiduals[i]]);
  }
  const meat: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const u of byCluster.values()) {
    for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) meat[a][b] += u[a] * u[b];
  }
  const tmp: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++)
    for (let b = 0; b < p; b++) {
      let s = 0;
      for (let c = 0; c < p; c++) s += covariance[a][c] * meat[c][b];
      tmp[a][b] = s;
    }
  const robustCovariance: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let a = 0; a < p; a++)
    for (let b = 0; b < p; b++) {
      let s = 0;
      for (let c = 0; c < p; c++) s += tmp[a][c] * covariance[c][b];
      robustCovariance[a][b] = s;
    }
  return { scoreResiduals, dfbeta, robustCovariance };
}

/**
 * Harrell's concordance index: among comparable pairs (one event earlier than
 * the other subject's observed time), the fraction where the model ranks risk
 * in the same order. Ties in the risk score count a half.
 */
export function harrellC(design: CoxDesign, beta: readonly number[]): number | null {
  const rows = design.rows;
  const n = rows.length;
  const eta = rows.map((r) => {
    let s = 0;
    for (let j = 0; j < design.p; j++) s += beta[j] * r.covariates[j];
    return s;
  });
  let concordant = 0;
  let comparable = 0;
  for (let i = 0; i < n; i++) {
    if (rows[i].event !== 1) continue;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (rows[j].stop < rows[i].stop) continue;
      if (rows[j].stop === rows[i].stop && rows[j].event === 1) continue;
      comparable++;
      if (eta[i] > eta[j]) concordant += 1;
      else if (eta[i] === eta[j]) concordant += 0.5;
    }
  }
  if (comparable === 0) return null;
  return concordant / comparable;
}
