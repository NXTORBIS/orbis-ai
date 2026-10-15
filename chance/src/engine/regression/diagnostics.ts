/**
 * Regression diagnostics.
 *
 * A coefficient table on its own hides the two failure modes that actually
 * ruin regressions in practice: a handful of observations dictating the fit,
 * and a systematic pattern left in the residuals. Everything here returns
 * plain point arrays so the interface can draw them without computing
 * anything itself.
 *
 * One high-leverage outlier can set an entire slope by itself. The influence
 * measures below quantify exactly that — how much each single observation
 * moves the fit — and the flagged list uses the conventional thresholds.
 */
import { EngineError } from '../core/result';
import { normalQuantile } from '../special/gamma';
import { durbinWatson } from './linear';
import { chiSquareSf } from './dist';
import type { DiagnosticPlots, InfluenceRow, LinearFit } from './types';

export interface InfluenceReport {
  rows: InfluenceRow[];
  /** Observations flagged by at least one conventional threshold. */
  flagged: InfluenceRow[];
  thresholds: {
    leverage: number;
    standardisedResidual: number;
    cooksDistance: number;
    cooksDistanceSevere: number;
    dffits: number;
    dfbetas: number;
  };
  warnings: string[];
  notes: string[];
}

/**
 * Leverage, standardised and externally studentised residuals, Cook's
 * distance, DFFITS and DFBETAS, each with its conventional threshold.
 *
 * All of these come from the single-deletion identities, so no model is
 * refitted: dropping observation i changes the coefficients by
 * (XᵀX)⁻¹x_i e_i/(1 − h_i) exactly.
 */
export function influenceMeasures(fit: LinearFit, X: readonly (readonly number[])[], weights?: readonly number[]): InfluenceReport {
  const { n, p, residuals, leverage, fitted, sigmaSquared, xtxInverse } = fit;
  if (X.length !== n) throw new EngineError(`The design matrix has ${X.length} rows but the fit used ${n}.`, 'shape');
  const dfResidual = n - p;
  if (dfResidual < 2) {
    throw new EngineError(
      `Influence measures need at least two residual degrees of freedom (n − p = ${dfResidual}); the externally studentised residual deletes an observation and so needs one more than the fit itself.`,
      'insufficient',
    );
  }
  const s = Math.sqrt(sigmaSquared);
  const thresholds = {
    leverage: (2 * p) / n,
    standardisedResidual: 2,
    cooksDistance: 4 / n,
    cooksDistanceSevere: 1,
    dffits: 2 * Math.sqrt(p / n),
    dfbetas: 2 / Math.sqrt(n),
  };
  const rows: InfluenceRow[] = [];
  for (let i = 0; i < n; i++) {
    const wi = weights ? weights[i] : 1;
    const e = residuals[i] * Math.sqrt(wi);
    const h = leverage[i];
    const oneMinusH = 1 - h;
    if (!(oneMinusH > 1e-12)) {
      // h = 1 means the fit passes exactly through this point by construction.
      rows.push({
        index: i,
        fitted: fitted[i],
        residual: residuals[i],
        leverage: h,
        standardisedResidual: Number.NaN,
        studentisedResidual: Number.NaN,
        cooksDistance: Infinity,
        dffits: Infinity,
        dfbetas: new Array<number>(p).fill(Infinity),
        flags: [
          'leverage = 1: the fitted line is forced through this observation exactly, so its residual is 0 by construction and no residual-based measure is defined for it. This single row is dictating part of the fit.',
        ],
      });
      continue;
    }
    const standardised = s > 0 ? e / (s * Math.sqrt(oneMinusH)) : 0;
    const sSqDeleted = (dfResidual * sigmaSquared - (e * e) / oneMinusH) / (dfResidual - 1);
    const sDeleted = Math.sqrt(Math.max(sSqDeleted, 0));
    const studentised = sDeleted > 0 ? e / (sDeleted * Math.sqrt(oneMinusH)) : 0;
    const cooks = s > 0 ? ((e * e) / (p * sigmaSquared)) * (h / (oneMinusH * oneMinusH)) : 0;
    const dffits = studentised * Math.sqrt(h / oneMinusH);
    // β − β₍i₎ = (XᵀX)⁻¹ x_i e_i / (1 − h_i), scaled per coefficient by the
    // deletion standard error to give DFBETAS.
    const xi = X[i].map((v) => v * Math.sqrt(wi));
    const dfbetas = new Array<number>(p).fill(0);
    for (let j = 0; j < p; j++) {
      let delta = 0;
      for (let a = 0; a < p; a++) delta += xtxInverse[j][a] * xi[a];
      delta = (delta * e) / oneMinusH;
      const scale = sDeleted * Math.sqrt(Math.max(xtxInverse[j][j], 0));
      dfbetas[j] = scale > 0 ? delta / scale : 0;
    }
    const flags: string[] = [];
    if (h > thresholds.leverage) flags.push(`high leverage (h = ${h.toPrecision(4)} > 2p/n = ${thresholds.leverage.toPrecision(4)}): unusual predictor values`);
    if (Math.abs(standardised) > 3) flags.push(`extreme residual (standardised ${standardised.toPrecision(4)})`);
    else if (Math.abs(standardised) > thresholds.standardisedResidual) flags.push(`large residual (standardised ${standardised.toPrecision(4)})`);
    if (cooks > thresholds.cooksDistanceSevere) flags.push(`Cook's distance ${cooks.toPrecision(4)} > 1: this observation alone moves the whole coefficient vector`);
    else if (cooks > thresholds.cooksDistance) flags.push(`Cook's distance ${cooks.toPrecision(4)} > 4/n = ${thresholds.cooksDistance.toPrecision(4)}`);
    if (Math.abs(dffits) > thresholds.dffits) flags.push(`DFFITS ${dffits.toPrecision(4)} exceeds 2√(p/n) = ${thresholds.dffits.toPrecision(4)}`);
    const worstBeta = dfbetas.reduce((best, v, j) => (Math.abs(v) > Math.abs(dfbetas[best]) ? j : best), 0);
    if (Math.abs(dfbetas[worstBeta]) > thresholds.dfbetas) {
      flags.push(
        `dropping this row shifts the coefficient of ${fit.coefficients[worstBeta].name} by ${dfbetas[worstBeta].toPrecision(3)} standard errors (DFBETAS threshold 2/√n = ${thresholds.dfbetas.toPrecision(3)})`,
      );
    }
    rows.push({ index: i, fitted: fitted[i], residual: residuals[i], leverage: h, standardisedResidual: standardised, studentisedResidual: studentised, cooksDistance: cooks, dffits, dfbetas, flags });
  }
  const flagged = rows.filter((r) => r.flags.length > 0);
  const warnings: string[] = [];
  if (flagged.length) {
    const worst = [...flagged].sort((a, b) => b.cooksDistance - a.cooksDistance).slice(0, 5);
    warnings.push(
      `${flagged.length} of ${n} observation(s) are flagged as unusual or influential. The most influential are row(s) ${worst
        .map((r) => `${r.index} (Cook's D ${Number.isFinite(r.cooksDistance) ? r.cooksDistance.toPrecision(3) : '∞'})`)
        .join(', ')}. Refit without them and compare: if the coefficients change materially, the reported fit is a description of those few rows, not of the data as a whole. Do not delete them merely because they are inconvenient — check whether they are errors, or whether they are the most informative points you have.`,
    );
  }
  const notes = [
    'Thresholds are conventions, not tests. 2p/n for leverage, |standardised residual| > 2, 4/n (and the stricter 1) for Cook\'s distance, 2√(p/n) for DFFITS and 2/√n for DFBETAS. In a well-behaved sample about 5% of observations exceed the residual threshold by chance.',
    'No model is refitted to produce these numbers: the single-deletion identities give the exact effect of dropping each observation.',
  ];
  return { rows, flagged, thresholds, warnings, notes };
}

/** The four standard diagnostic plots, as plain point arrays. */
export function diagnosticPlots(fit: LinearFit, influence: InfluenceReport): DiagnosticPlots {
  const n = fit.n;
  const standardised = influence.rows.map((r) => r.standardisedResidual);
  const residualsVsFitted = fit.fitted.map((f, i) => ({ x: f, y: fit.residuals[i] }));
  const order = standardised
    .map((v, i) => ({ v, i }))
    .filter((d) => Number.isFinite(d.v))
    .sort((a, b) => a.v - b.v);
  const m = order.length;
  const qq = order.map((d, rank) => ({ x: normalQuantile((rank + 0.5) / m), y: d.v }));
  const scaleLocation = fit.fitted.map((f, i) => ({ x: f, y: Math.sqrt(Math.abs(standardised[i])) }));
  const residualsVsLeverage = influence.rows.map((r) => ({ x: r.leverage, y: r.standardisedResidual }));
  if (n !== fit.residuals.length) throw new EngineError('Inconsistent fit arrays.', 'internal');
  return { residualsVsFitted, qq, scaleLocation, residualsVsLeverage };
}

export interface AutocorrelationReport {
  durbinWatson: number;
  /** Lag-1 residual autocorrelation implied by the statistic (≈ 1 − DW/2). */
  lag1Autocorrelation: number;
  interpretation: string;
}

export function autocorrelation(fit: LinearFit): AutocorrelationReport {
  const dw = durbinWatson(fit.residuals);
  const rho = 1 - dw / 2;
  return {
    durbinWatson: dw,
    lag1Autocorrelation: rho,
    interpretation:
      dw < 1.5
        ? `DW = ${dw.toPrecision(4)} (implied lag-1 autocorrelation ${rho.toPrecision(3)}): positive autocorrelation. If the row order is meaningful, the standard errors above are too small and the p-values too optimistic.`
        : dw > 2.5
          ? `DW = ${dw.toPrecision(4)} (implied lag-1 autocorrelation ${rho.toPrecision(3)}): negative autocorrelation, often a sign of over-differencing or an alternating pattern.`
          : `DW = ${dw.toPrecision(4)}: no strong first-order autocorrelation in the order the rows were supplied. This statistic only sees the supplied order; if the data has a different natural ordering, reorder it and look again.`,
  };
}

/**
 * A portmanteau normality check on the residuals (Jarque–Bera), reported
 * because the t and F inference above assumes approximately normal errors.
 * In large samples the central limit theorem rescues the coefficient
 * intervals; the PREDICTION interval has no such rescue and depends on the
 * error distribution directly.
 */
export function residualNormality(fit: LinearFit): { statistic: number; pValue: number; interpretation: string } {
  const e = fit.residuals;
  const n = e.length;
  const m = e.reduce((s, v) => s + v, 0) / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (const v of e) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  if (!(m2 > 0)) throw new EngineError('The residuals are all identical, so normality cannot be assessed.', 'degenerate');
  const skew = m3 / Math.pow(m2, 1.5);
  const kurt = m4 / (m2 * m2) - 3;
  const jb = (n / 6) * (skew * skew + (kurt * kurt) / 4);
  const pValue = chiSquareSf(jb, 2);
  return {
    statistic: jb,
    pValue,
    interpretation:
      pValue < 0.05
        ? `Jarque–Bera = ${jb.toPrecision(4)}, p = ${pValue.toPrecision(3)}: the residuals are not normal (skewness ${skew.toPrecision(3)}, excess kurtosis ${kurt.toPrecision(3)}). With a large sample the coefficient intervals are still roughly valid, but the prediction intervals are not — they inherit the error distribution directly.`
        : `Jarque–Bera = ${jb.toPrecision(4)}, p = ${pValue.toPrecision(3)}: no detectable departure from normality (skewness ${skew.toPrecision(3)}, excess kurtosis ${kurt.toPrecision(3)}). This is not evidence that the errors are normal.`,
  };
}
