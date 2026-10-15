/**
 * Instrumental variables: the Wald ratio, two-stage least squares, the
 * first-stage strength diagnostics, the Sargan overidentification test and
 * Anderson–Rubin weak-instrument-robust inference.
 *
 * IV does not estimate the ATE. With a binary instrument and a binary
 * treatment it estimates the local average treatment effect — the effect among
 * compliers, the units the instrument actually moves. That is said on every
 * result here, not once in the documentation, because the LATE is routinely
 * reported as if it were the effect for everyone.
 */

import { EngineError } from '../core/result.ts';
import { mean, variance } from '../stats/descriptive.ts';
import { normalQuantile } from '../special/gamma.ts';
import { chiSquareSf, tTwoSided } from './deps.ts';
import { fSurvival } from '../stats/tests.ts';
import { IV_EXCLUSION, IV_INDEPENDENCE, IV_MONOTONICITY, IV_RELEVANCE, CONSISTENCY, SUTVA, describeEstimand } from './assumptions.ts';
import { accounting, makeEstimate } from './build.ts';
import { classicalVcov, leastSquares, robustVcovHC1, standardErrors } from './fit.ts';
import type { CausalEstimate, Interval } from './types.ts';

export const WEAK_INSTRUMENT_F = 10;

export interface IvSpec {
  outcome: readonly number[];
  /** The endogenous treatment whose effect is wanted. */
  treatment: readonly number[];
  /** One or more instruments, excluded from the outcome equation. */
  instruments: readonly { name: string; values: readonly number[] }[];
  /** Exogenous controls included in both stages. */
  controls?: readonly { name: string; values: readonly number[] }[];
  level?: number;
  /** Treat the treatment as binary, enabling the complier accounting. */
  binaryTreatment?: boolean;
}

export interface FirstStage {
  /** Coefficients on the excluded instruments. */
  coefficients: { name: string; estimate: number; stdError: number }[];
  /** Joint F for the excluded instruments. */
  fStatistic: number;
  numeratorDf: number;
  denominatorDf: number;
  pValue: number;
  /** Partial R² of the instruments in the first stage. */
  partialR2: number;
  weak: boolean;
  warnings: string[];
}

export interface IvDiagnostics {
  firstStage: FirstStage;
  /** Sargan J test; null when the model is exactly identified. */
  overidentification: { statistic: number; degreesOfFreedom: number; pValue: number } | null;
  /** The OLS estimate, for comparison. */
  olsEstimate: number;
  /** Anderson–Rubin confidence set. */
  andersonRubin: AndersonRubinSet;
  /** Complier share (first stage) when treatment and a single instrument are binary. */
  complierShare: number | null;
}

export interface AndersonRubinSet {
  /** The set as closed intervals on the effect scale. */
  intervals: Interval[];
  /** True when the set runs to the edge of the search range: effectively unbounded. */
  unbounded: boolean;
  /** True when the accepted region is not a single interval. */
  disconnected: boolean;
  level: number;
  note: string;
}

function design(
  n: number,
  parts: readonly { name: string; values: readonly number[] }[],
  extra?: readonly number[],
): { X: number[][]; names: string[] } {
  const names = ['(intercept)', ...parts.map((p) => p.name)];
  if (extra) names.push('treatment');
  const X: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1, ...parts.map((p) => p.values[i])];
    if (extra) row.push(extra[i]);
    X.push(row);
  }
  return { X, names };
}

function checkVector(name: string, v: readonly number[], n: number): void {
  if (v.length !== n) throw new EngineError(`${name} has ${v.length} values for ${n} units.`, 'length');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(v[i])) throw new EngineError(`${name} is non-finite at unit ${i}.`, 'finite');
  }
  if (!(variance(v.slice(), 1) > 0)) {
    throw new EngineError(
      `${name} has zero variance — every unit has the same value. A constant cannot instrument anything, cannot ` +
        'be a treatment whose effect is estimated, and makes the design matrix singular. No estimate is reported.',
      'zero-variance',
    );
  }
}

/** First-stage regression and the instrument-strength diagnostics. */
export function firstStageDiagnostics(spec: IvSpec): FirstStage {
  const n = spec.treatment.length;
  const controls = spec.controls ?? [];
  const Xfull = design(n, [...controls, ...spec.instruments]).X;
  const full = leastSquares(Xfull, spec.treatment, undefined, 'IV first stage');
  const restricted = leastSquares(design(n, controls).X, spec.treatment, undefined, 'IV first stage (controls only)');
  const rssFull = full.residuals.reduce((a, r) => a + r * r, 0);
  const rssRestricted = restricted.residuals.reduce((a, r) => a + r * r, 0);
  const q = spec.instruments.length;
  if (!(rssFull > 0)) {
    throw new EngineError(
      'IV first stage: the treatment is fitted exactly by the instruments and controls (zero residual). Either ' +
        'the treatment is a deterministic function of the instruments, which makes the second-stage variance ' +
        'undefined, or there are as many parameters as observations. No F statistic is reported.',
      'degenerate',
    );
  }
  const f = ((rssRestricted - rssFull) / q) / (rssFull / full.df);
  if (!Number.isFinite(f) || f < 0) {
    throw new EngineError('IV first stage: the F statistic came out non-finite; no diagnostic is reported.', 'finite');
  }
  const partialR2 = (rssRestricted - rssFull) / rssRestricted;
  const vcov = robustVcovHC1(Xfull, full);
  const se = standardErrors(vcov);
  const coefficients = spec.instruments.map((inst, k) => {
    const j = 1 + controls.length + k;
    return { name: inst.name, estimate: full.beta[j], stdError: se[j] };
  });
  const weak = f < WEAK_INSTRUMENT_F;
  const warnings: string[] = [];
  if (weak) {
    warnings.push(
      `WEAK INSTRUMENT: the first-stage F for the excluded instrument(s) is ${f.toFixed(2)}, below the ` +
        `conventional threshold of ${WEAK_INSTRUMENT_F} (Staiger–Stock). Three consequences, all of them bad. ` +
        '(1) 2SLS is biased TOWARDS the OLS estimate — in the same direction as the confounding the instrument ' +
        `was supposed to remove — with a relative bias of roughly 1/(F−1) ≈ ${(1 / Math.max(f - 1, 0.01)).toFixed(2)} ` +
        'of the OLS bias. (2) The conventional standard error is far too small and the t-based interval has ' +
        'coverage well below its nominal level, so the p-value is not interpretable. (3) Any violation of the ' +
        'exclusion restriction is amplified by one over the first stage, so a small direct effect of the ' +
        'instrument becomes a large bias. Use the Anderson–Rubin confidence set reported below, which stays ' +
        'valid however weak the instrument is, and do not quote the 2SLS standard error.',
    );
  }
  if (f < 1) {
    warnings.push(
      'The first-stage F is below 1, meaning the instruments explain less of the treatment than noise would. ' +
        'The 2SLS point estimate is essentially a ratio of two numbers that are both indistinguishable from ' +
        'zero; it carries no information about the effect.',
    );
  }
  return {
    coefficients,
    fStatistic: f,
    numeratorDf: q,
    denominatorDf: full.df,
    pValue: fSurvival(f, q, full.df),
    partialR2,
    weak,
    warnings,
  };
}

/**
 * Anderson–Rubin confidence set: the values β₀ for which the instruments are
 * jointly uncorrelated with Y − β₀·D, given the controls.
 *
 * This inversion is valid whatever the instrument's strength, which is why it
 * is reported alongside every 2SLS fit. It can be unbounded or disconnected,
 * and when it is, that is the honest answer: the data do not pin the effect
 * down, and a tidy symmetric interval would be a fiction.
 */
export function andersonRubinSet(
  spec: IvSpec,
  options: { range?: [number, number]; gridPoints?: number } = {},
): AndersonRubinSet {
  const n = spec.treatment.length;
  const level = spec.level ?? 0.95;
  const alpha = 1 - level;
  const controls = spec.controls ?? [];
  const q = spec.instruments.length;
  const Xfull = design(n, [...controls, ...spec.instruments]).X;
  const Xr = design(n, controls).X;
  const dfFull = n - Xfull[0].length;
  if (dfFull <= 0) {
    throw new EngineError('Anderson–Rubin: too few observations for the instrument and control set.', 'size');
  }
  const sdY = Math.sqrt(variance(spec.outcome.slice(), 1));
  const sdD = Math.sqrt(variance(spec.treatment.slice(), 1));
  const span = options.range ?? [(-50 * sdY) / sdD, (50 * sdY) / sdD];
  const points = options.gridPoints ?? 4001;
  const arP = (beta: number): number => {
    const yAdj = spec.outcome.map((y, i) => y - beta * spec.treatment[i]);
    const full = leastSquares(Xfull, yAdj, undefined, 'Anderson–Rubin');
    const rssF = full.residuals.reduce((a, r) => a + r * r, 0);
    const restricted = leastSquares(Xr, yAdj, undefined, 'Anderson–Rubin (controls only)');
    const rssR = restricted.residuals.reduce((a, r) => a + r * r, 0);
    if (!(rssF > 0)) return 0;
    const f = ((rssR - rssF) / q) / (rssF / full.df);
    return fSurvival(f, q, full.df);
  };
  const accepted: boolean[] = [];
  const grid: number[] = [];
  for (let k = 0; k < points; k++) {
    const b = span[0] + ((span[1] - span[0]) * k) / (points - 1);
    grid.push(b);
    accepted.push(arP(b) > alpha);
  }
  const intervals: Interval[] = [];
  let start = -1;
  for (let k = 0; k < points; k++) {
    if (accepted[k] && start < 0) start = k;
    if ((!accepted[k] || k === points - 1) && start >= 0) {
      const end = accepted[k] ? k : k - 1;
      intervals.push({ low: grid[start], high: grid[end], level });
      start = -1;
    }
  }
  const unbounded = intervals.length > 0 && (accepted[0] || accepted[points - 1]);
  const disconnected = intervals.length > 1;
  let note =
    `Anderson–Rubin confidence set at the ${(level * 100).toFixed(0)}% level, obtained by inverting the joint test ` +
    'that the instruments are uncorrelated with the structural residual. Valid for any instrument strength.';
  if (intervals.length === 0) {
    note +=
      ' THE SET IS EMPTY over the searched range: no value of the effect is consistent with the instruments being ' +
      'jointly valid. An empty AR set is a rejection of the model itself — overidentifying restrictions fail — ' +
      'not a very precise estimate.';
  }
  if (unbounded) {
    note +=
      ' THE SET IS UNBOUNDED: it reaches the edge of the searched range, so the data place no finite upper or ' +
      'lower limit on the effect. This is what a weak instrument looks like when inference is done honestly.';
  }
  if (disconnected) {
    note +=
      ` The set is DISCONNECTED (${intervals.length} pieces). A single interval would misrepresent it; the gap is ` +
      'a region of effect values the test rejects while accepting values on both sides.';
  }
  return { intervals, unbounded, disconnected, level, note };
}

export interface IvResult {
  estimate: CausalEstimate;
  diagnostics: IvDiagnostics;
  /** Coefficients of the structural equation, treatment last. */
  coefficients: { name: string; estimate: number; stdError: number }[];
}

/** Two-stage least squares with the full diagnostic set. */
export function twoStageLeastSquares(spec: IvSpec): IvResult {
  const n = spec.outcome.length;
  if (n === 0) throw new EngineError('2SLS: no observations.', 'empty');
  checkVector('The outcome', spec.outcome, n);
  checkVector('The treatment', spec.treatment, n);
  if (spec.instruments.length === 0) throw new EngineError('2SLS: no instrument supplied.', 'empty');
  for (const inst of spec.instruments) checkVector(`Instrument "${inst.name}"`, inst.values, n);
  for (const c of spec.controls ?? []) checkVector(`Control "${c.name}"`, c.values, n);
  const level = spec.level ?? 0.95;
  const controls = spec.controls ?? [];
  const k = 2 + controls.length;
  if (n <= k + spec.instruments.length) {
    throw new EngineError(
      `2SLS: ${n} observations for ${k} structural parameters and ${spec.instruments.length} instrument(s). ` +
        'There is not enough data to fit both stages; no estimate is reported.',
      'underdetermined',
    );
  }

  const fs = firstStageDiagnostics(spec);
  // Stage one fitted treatment.
  const Z = design(n, [...controls, ...spec.instruments]).X;
  const stage1 = leastSquares(Z, spec.treatment, undefined, '2SLS first stage');
  const dHat = stage1.fitted;
  if (!(variance(dHat, 1) > 0)) {
    throw new EngineError(
      '2SLS: the fitted treatment from the first stage has zero variance, so the instruments produce no ' +
        'variation in the treatment at all. The second stage would divide by zero. This is a complete failure of ' +
        'instrument relevance; no estimate is reported.',
      'no-variation',
    );
  }
  const X2 = design(n, controls, dHat).X;
  const stage2 = leastSquares(X2, spec.outcome, undefined, '2SLS second stage');
  // 2SLS residuals use the ACTUAL treatment, not the fitted one.
  const beta = stage2.beta;
  const resid = spec.outcome.map((y, i) => {
    let f = beta[0];
    for (let j = 0; j < controls.length; j++) f += beta[1 + j] * controls[j].values[i];
    f += beta[beta.length - 1] * spec.treatment[i];
    return y - f;
  });
  const sigma2 = resid.reduce((a, r) => a + r * r, 0) / (n - k);
  const vcov = classicalVcov({ ...stage2, sigma2 });
  const se = standardErrors(vcov);
  const names = ['(intercept)', ...controls.map((c) => c.name), 'treatment'];
  const coefficients = names.map((nm, j) => ({ name: nm, estimate: beta[j], stdError: se[j] }));
  const est = beta[beta.length - 1];
  const estSe = se[se.length - 1];

  // OLS for comparison.
  const Xols = design(n, controls, spec.treatment).X;
  const ols = leastSquares(Xols, spec.outcome, undefined, '2SLS comparison OLS');
  const olsEstimate = ols.beta[ols.beta.length - 1];

  // Sargan overidentification test.
  let overid: IvDiagnostics['overidentification'] = null;
  if (spec.instruments.length > 1) {
    const aux = leastSquares(Z, resid, undefined, 'Sargan auxiliary regression');
    const tss = resid.reduce((a, r) => a + (r - mean(resid)) * (r - mean(resid)), 0);
    const rss = aux.residuals.reduce((a, r) => a + r * r, 0);
    if (!(tss > 0)) {
      throw new EngineError('Sargan test: the 2SLS residuals are constant; the test is undefined.', 'degenerate');
    }
    const r2 = 1 - rss / tss;
    const stat = n * r2;
    const df = spec.instruments.length - 1;
    overid = { statistic: stat, degreesOfFreedom: df, pValue: chiSquareSf(stat, df) };
  }

  const ar = andersonRubinSet(spec);

  let complierShare: number | null = null;
  if (spec.binaryTreatment && spec.instruments.length === 1 && controls.length === 0) {
    const z = spec.instruments[0].values;
    const binaryZ = z.every((v) => v === 0 || v === 1);
    const binaryD = spec.treatment.every((v) => v === 0 || v === 1);
    if (binaryZ && binaryD) {
      const d1 = spec.treatment.filter((_, i) => z[i] === 1);
      const d0 = spec.treatment.filter((_, i) => z[i] === 0);
      if (d1.length > 0 && d0.length > 0) complierShare = mean(d1) - mean(d0);
    }
  }

  const warnings = [...fs.warnings, ...ar.note.includes('UNBOUNDED') ? [ar.note] : []];
  if (overid && overid.pValue < 0.05) {
    warnings.push(
      `Sargan overidentification test rejects (J = ${overid.statistic.toFixed(3)}, df ${overid.degreesOfFreedom}, ` +
        `p = ${overid.pValue.toExponential(2)}). At least one instrument is invalid — it has a direct effect on ` +
        'the outcome, or is correlated with the unmeasured confounder — but the test cannot say which. A passing ' +
        'test, incidentally, proves nothing: it only checks that the instruments AGREE with each other, so ' +
        'instruments that are invalid in the same way pass comfortably.',
    );
  }
  if (!overid) {
    warnings.push(
      'The model is exactly identified (one instrument per endogenous variable), so no overidentification test ' +
        'is possible. The exclusion restriction here is assumed, with no check of any kind available from the data.',
    );
  }
  const notes = [
    `First-stage F = ${fs.fStatistic.toFixed(3)} on ${fs.numeratorDf} and ${fs.denominatorDf} df ` +
      `(p = ${fs.pValue.toExponential(2)}), partial R² = ${fs.partialR2.toFixed(4)}.`,
    `OLS estimate of the same coefficient: ${olsEstimate.toFixed(6)}. The difference from the IV estimate is the ` +
      'endogeneity the instrument claims to remove — if the instrument is valid.',
    ar.note,
    ...ar.intervals.map(
      (iv, i) => `Anderson–Rubin interval ${i + 1}: [${iv.low.toFixed(6)}, ${iv.high.toFixed(6)}]`,
    ),
  ];
  if (complierShare !== null) {
    notes.push(
      `Complier share (first stage with a binary instrument and treatment): ${(complierShare * 100).toFixed(1)}% ` +
        'of units have their treatment status changed by the instrument. The LATE is the effect in THAT group ' +
        'only; the remaining ' +
        `${(100 - complierShare * 100).toFixed(1)}% contribute nothing, and their effect is not estimated here.`,
    );
  }

  const estimate = makeEstimate({
    method: '2SLS instrumental variables',
    estimand: describeEstimand('LATE'),
    estimate: est,
    standardError: estSe,
    level,
    pValue: tTwoSided(est / estSe, n - k),
    exactness: 'empirical',
    sample: accounting(
      spec.binaryTreatment ? spec.treatment : spec.treatment.map(() => 1),
      n,
      null,
      [],
    ),
    assumptions: [CONSISTENCY, SUTVA, IV_RELEVANCE, IV_EXCLUSION, IV_INDEPENDENCE, IV_MONOTONICITY],
    inferenceNote:
      `Conventional 2SLS standard error with the structural residual variance (t on ${n - k} df)` +
      (fs.weak
        ? '. NOT TRUSTWORTHY HERE: the first stage is weak, so use the Anderson–Rubin set instead.'
        : '.'),
    warnings,
    notes,
  });
  return {
    estimate,
    diagnostics: { firstStage: fs, overidentification: overid, olsEstimate, andersonRubin: ar, complierShare },
    coefficients,
  };
}

/**
 * The Wald / grouped-mean IV estimator for a binary instrument: the
 * intention-to-treat effect divided by the compliance rate.
 */
export function waldEstimator(
  outcome: readonly number[],
  treatment: readonly number[],
  instrument: readonly number[],
  level = 0.95,
): CausalEstimate {
  const n = outcome.length;
  if (treatment.length !== n || instrument.length !== n) {
    throw new EngineError('Wald estimator: outcome, treatment and instrument must have the same length.', 'length');
  }
  for (const z of instrument) {
    if (z !== 0 && z !== 1) {
      throw new EngineError(
        `Wald estimator: the instrument must be binary (0/1); found ${z}. For a continuous instrument use 2SLS.`,
        'binary',
      );
    }
  }
  const y1: number[] = [];
  const y0: number[] = [];
  const d1: number[] = [];
  const d0: number[] = [];
  for (let i = 0; i < n; i++) {
    if (instrument[i] === 1) {
      y1.push(outcome[i]);
      d1.push(treatment[i]);
    } else {
      y0.push(outcome[i]);
      d0.push(treatment[i]);
    }
  }
  if (y1.length < 2 || y0.length < 2) {
    throw new EngineError(
      `Wald estimator: the instrument takes the value 1 for ${y1.length} units and 0 for ${y0.length}. Both ` +
        'groups need at least two units for a variance; with one group empty there is no comparison at all.',
      'one-arm',
    );
  }
  const itt = mean(y1) - mean(y0);
  const compliance = mean(d1) - mean(d0);
  if (Math.abs(compliance) < 1e-10) {
    throw new EngineError(
      `Wald estimator: the instrument changes the treatment rate by ${compliance.toExponential(3)} — effectively ` +
        'not at all. The estimator divides by this number, so there is no estimate: the denominator is zero and ' +
        'the ratio is undefined, not large. There are no compliers, so there is no local effect to report.',
      'no-variation',
    );
  }
  const est = itt / compliance;
  // Delta-method standard error of the ratio of two independent group contrasts.
  const vItt = variance(y1, 1) / y1.length + variance(y0, 1) / y0.length;
  const vComp = variance(d1, 1) / d1.length + variance(d0, 1) / d0.length;
  const se = Math.sqrt(vItt / (compliance * compliance) + (itt * itt * vComp) / Math.pow(compliance, 4));
  const warnings: string[] = [];
  if (Math.abs(compliance) < 0.1) {
    warnings.push(
      `The instrument shifts treatment by only ${(compliance * 100).toFixed(1)} percentage points, so the Wald ` +
        'ratio divides a small numerator by a small denominator. The delta-method standard error understates the ' +
        'true uncertainty badly in this regime — the ratio of two noisy quantities has heavy tails and may have ' +
        'no finite moments. Use the Anderson–Rubin set from `twoStageLeastSquares`.',
    );
  }
  const z = normalQuantile(1 - (1 - level) / 2);
  return makeEstimate({
    method: 'Wald instrumental-variable estimator (binary instrument)',
    estimand: describeEstimand('LATE'),
    estimate: est,
    standardError: se,
    level,
    interval: { low: est - z * se, high: est + z * se, level },
    exactness: 'empirical',
    sample: accounting(treatment, n, null, []),
    assumptions: [CONSISTENCY, SUTVA, IV_RELEVANCE, IV_EXCLUSION, IV_INDEPENDENCE, IV_MONOTONICITY],
    inferenceNote:
      'Delta-method standard error for the ratio of the intention-to-treat contrast to the compliance contrast.',
    warnings,
    notes: [
      `Intention-to-treat effect of the instrument on the outcome: ${itt.toFixed(6)}.`,
      `Effect of the instrument on treatment take-up (the complier share under monotonicity): ` +
        `${(compliance * 100).toFixed(1)}%.`,
      'THIS IS A LATE. It is the average effect among compliers — the units whose treatment the instrument ' +
        'changes. It is not the ATE and not the ATT. Always-takers and never-takers contribute to neither the ' +
        'numerator nor the denominator, so their effects are not estimated and cannot be inferred from this ' +
        'number. If the effect varies and compliers are unusual, the LATE can differ from the ATE by any amount, ' +
        'including in sign.',
    ],
  });
}
