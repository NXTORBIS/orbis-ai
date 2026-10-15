/**
 * Goodness-of-fit diagnostics for a fitted GEV or GPD.
 *
 * Every function returns plain arrays of points. Nothing here draws anything
 * and nothing here decides whether a fit is acceptable: that reading is left
 * to the interface and to the analyst.
 *
 * Plotting positions use the Weibull rule i/(n+1), which is the standard
 * choice for extreme value diagnostics (Coles 2001, §2.6.6): it leaves the
 * largest observation a finite model quantile instead of an infinite one.
 */
import { type EngineResult, type Explanation, fail, ok } from '../core/result';
import { histogram } from '../stats/descriptive';
import { numericalGradient } from './optimize';
import { normalQuantile } from '../special/gamma';
import { gevCdf, gevPdf, gevQuantile } from './gev';
import { gpdCdf, gpdPdf, gpdQuantile } from './gpd';
import type { GevFit, GpdFit } from './fit';
import type { ReturnLevelCurvePoint } from './returnLevels';

export interface ProbabilityPlotPoint {
  /** Empirical plotting position i/(n+1). */
  empirical: number;
  /** Model cdf at the i-th ordered observation. */
  model: number;
  observation: number;
}

export interface QuantilePlotPoint {
  /** Model quantile at the plotting position. */
  model: number;
  /** The i-th ordered observation. */
  empirical: number;
}

export interface DensityPoint {
  /** Bin centre. */
  x: number;
  /** Empirical density (histogram, normalised to integrate to 1). */
  empiricalDensity: number;
  /** Fitted density at the bin centre. */
  modelDensity: number;
}

export interface FitDiagnosticsData {
  probabilityPlot: ProbabilityPlotPoint[];
  quantilePlot: QuantilePlotPoint[];
  densityComparison: DensityPoint[];
  returnLevelPlot: ReturnLevelCurvePoint[];
  /** Perfect-fit reference line for the probability/quantile plots. */
  referenceLine: { from: number; to: number };
  explanation: Explanation;
}

interface ModelFunctions {
  cdf: (x: number) => number;
  pdf: (x: number) => number;
  quantile: (p: number) => number;
}

function buildPlots(sorted: number[], model: ModelFunctions): {
  probabilityPlot: ProbabilityPlotPoint[];
  quantilePlot: QuantilePlotPoint[];
} {
  const n = sorted.length;
  const probabilityPlot: ProbabilityPlotPoint[] = [];
  const quantilePlot: QuantilePlotPoint[] = [];
  for (let i = 1; i <= n; i++) {
    const position = i / (n + 1);
    probabilityPlot.push({ empirical: position, model: model.cdf(sorted[i - 1]), observation: sorted[i - 1] });
    quantilePlot.push({ model: model.quantile(position), empirical: sorted[i - 1] });
  }
  return { probabilityPlot, quantilePlot };
}

function densityPoints(sorted: number[], pdf: (x: number) => number): DensityPoint[] {
  return histogram(sorted).map((bin) => {
    const centre = (bin.x0 + bin.x1) / 2;
    return { x: centre, empiricalDensity: bin.density, modelDensity: pdf(centre) };
  });
}

/** Return level curve for a GEV fit, with delta-method limits. */
export function gevReturnLevelCurve(
  fit: GevFit,
  options: { fromPeriod?: number; toPeriod?: number; points?: number; level?: number } = {},
): ReturnLevelCurvePoint[] {
  const from = options.fromPeriod ?? 1.1;
  const to = options.toPeriod ?? 1000;
  const count = options.points ?? 40;
  const z = normalQuantile((1 + (options.level ?? 0.95)) / 2);
  const logFrom = Math.log(from);
  const logTo = Math.log(to);
  const out: ReturnLevelCurvePoint[] = [];
  for (let i = 0; i < count; i++) {
    const period = Math.exp(logFrom + ((logTo - logFrom) * i) / (count - 1));
    const p = 1 / period;
    const level = gevQuantile(1 - p, fit.params);
    let lower: number | null = null;
    let upper: number | null = null;
    if (fit.covariance) {
      const g = numericalGradient(
        (x) => gevQuantile(1 - p, { location: x[0], scale: x[1], shape: x[2] }),
        [fit.params.location, fit.params.scale, fit.params.shape],
      );
      if (g !== null) {
        let q = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) q += g[a] * g[b] * fit.covariance[a][b];
        if (q > 0 && Number.isFinite(q)) {
          const se = Math.sqrt(q);
          lower = level - z * se;
          upper = level + z * se;
        }
      }
    }
    out.push({ returnPeriod: period, level, lower, upper });
  }
  return out;
}

/** All four diagnostics for a GEV fit to block maxima. */
export function gevDiagnostics(fit: GevFit): EngineResult<FitDiagnosticsData> {
  const sorted = fit.maxima.slice().sort((a, b) => a - b);
  if (sorted.length < 5) return fail('Diagnostics need at least 5 block maxima.');
  const model: ModelFunctions = {
    cdf: (x) => gevCdf(x, fit.params),
    pdf: (x) => gevPdf(x, fit.params),
    quantile: (p) => gevQuantile(p, fit.params),
  };
  const { probabilityPlot, quantilePlot } = buildPlots(sorted, model);
  return ok({
    probabilityPlot,
    quantilePlot,
    densityComparison: densityPoints(sorted, model.pdf),
    returnLevelPlot: gevReturnLevelCurve(fit),
    referenceLine: { from: 0, to: 1 },
    explanation: {
      method: 'GEV diagnostic plots: probability plot, quantile plot, return level plot and density comparison',
      formula: 'Plotting positions i/(n+1) for i = 1 … n on the ordered maxima',
      steps: [
        { label: 'Maxima plotted', value: String(sorted.length) },
        { label: 'Density bins', value: String(histogram(sorted).length) },
      ],
      assumptions: ['The fitted parameters are treated as known when the model curves are evaluated.'],
      limitations: [
        'Because the parameters were estimated from these same points, the plots flatter the fit slightly; they cannot be read as an independent test.',
        'The reference line for the probability and quantile plots is y = x. Systematic curvature matters, single outlying points at the top end usually do not.',
      ],
      exactness: 'numerical',
    },
  });
}

/** All four diagnostics for a POT (GPD) fit to exceedances. */
export function gpdDiagnostics(fit: GpdFit): EngineResult<FitDiagnosticsData> {
  const sorted = fit.exceedances.slice().sort((a, b) => a - b);
  if (sorted.length < 5) return fail('Diagnostics need at least 5 exceedances.');
  const model: ModelFunctions = {
    cdf: (x) => gpdCdf(x, fit.params),
    pdf: (x) => gpdPdf(x, fit.params),
    quantile: (p) => gpdQuantile(p, fit.params),
  };
  const { probabilityPlot, quantilePlot } = buildPlots(sorted, model);
  const curve = gpdReturnLevelCurveLocal(fit);
  return ok({
    probabilityPlot,
    quantilePlot,
    densityComparison: densityPoints(sorted, model.pdf),
    returnLevelPlot: curve,
    referenceLine: { from: 0, to: 1 },
    explanation: {
      method: 'GPD diagnostic plots: probability plot, quantile plot, return level plot and density comparison',
      formula: 'Plotting positions i/(n+1) for i = 1 … n on the ordered exceedances',
      steps: [
        { label: 'Exceedances plotted', value: String(sorted.length) },
        { label: 'Threshold', value: String(fit.params.threshold) },
      ],
      assumptions: ['The fitted parameters are treated as known when the model curves are evaluated.'],
      limitations: [
        'The plots can only show whether the GPD fits the exceedances above the chosen threshold. They say nothing about whether that threshold was high enough.',
        'Because the parameters were estimated from these points, the plots flatter the fit; they are not an independent test.',
      ],
      exactness: 'numerical',
    },
  });
}

/**
 * Return level curve for the diagnostics panel, with delta-method limits only
 * (the profile interval is left to the headline return level, where the extra
 * cost is worth paying).
 */
function gpdReturnLevelCurveLocal(fit: GpdFit): ReturnLevelCurvePoint[] {
  const zeta = fit.exceedanceRate;
  const from = 1.5 / zeta;
  const to = from * 1000;
  const z = normalQuantile(0.975);
  const out: ReturnLevelCurvePoint[] = [];
  const logFrom = Math.log(from);
  const logTo = Math.log(to);
  const { threshold: u, scale, shape } = fit.params;
  const levelAt = (m: number, zt: number, sc: number, sh: number): number =>
    sh === 0 ? u + sc * Math.log(m * zt) : u + (sc / sh) * Math.expm1(sh * Math.log(m * zt));
  for (let i = 0; i < 40; i++) {
    const m = Math.exp(logFrom + ((logTo - logFrom) * i) / 39);
    const level = levelAt(m, zeta, scale, shape);
    let lower: number | null = null;
    let upper: number | null = null;
    if (fit.covariance) {
      const g = numericalGradient((x) => levelAt(m, x[0], x[1], x[2]), [zeta, scale, shape]);
      if (g !== null) {
        const varZeta = (zeta * (1 - zeta)) / fit.totalObservations;
        const c = fit.covariance;
        const q =
          g[0] * g[0] * varZeta + g[1] * g[1] * c[0][0] + g[2] * g[2] * c[1][1] + 2 * g[1] * g[2] * c[0][1];
        if (q > 0 && Number.isFinite(q)) {
          const se = Math.sqrt(q);
          lower = level - z * se;
          upper = level + z * se;
        }
      }
    }
    out.push({ returnPeriod: m, level, lower, upper });
  }
  return out;
}
