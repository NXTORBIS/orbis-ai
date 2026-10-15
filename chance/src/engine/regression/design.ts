/**
 * Design-matrix construction, with explicit and reported handling of missing
 * values.
 *
 * Rows with a missing response, a missing predictor or a missing weight are
 * dropped (complete-case analysis) and the count of dropped rows is reported.
 * That is the only honest default available without modelling the missingness,
 * but it is not free: it is unbiased only if the rows that went missing are
 * missing at random. The caller receives a warning saying so whenever any row
 * is dropped.
 */
import { EngineError } from '../core/result';
import type { Column, LinearSpec, MissingReport } from './types';

export interface Design {
  /** n × p design matrix, intercept first when present. */
  X: number[][];
  y: number[];
  /** Observation weights; all 1 for ordinary least squares. */
  w: number[];
  weighted: boolean;
  names: string[];
  hasIntercept: boolean;
  /** Indices of the retained rows in the original input. */
  rowIndex: number[];
  missing: MissingReport;
  warnings: string[];
}

function isUsable(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

export interface DesignOptions {
  y: readonly (number | null | undefined)[];
  predictors: readonly Column[];
  intercept?: boolean;
  weights?: readonly (number | null | undefined)[];
  /** Offset column (GLM); carried through the same row filtering. */
  offset?: readonly (number | null | undefined)[];
  /** Skip the "response must vary" check (binary GLM responses are checked differently). */
  allowConstantResponse?: boolean;
}

export interface DesignWithOffset extends Design {
  offset: number[];
}

export function buildDesign(options: DesignOptions): DesignWithOffset {
  const { y, predictors } = options;
  const hasIntercept = options.intercept !== false;
  const nIn = y.length;
  if (nIn === 0) throw new EngineError('No observations were supplied.', 'insufficient');
  for (const c of predictors) {
    if (c.values.length !== nIn) {
      throw new EngineError(
        `Predictor "${c.name}" has ${c.values.length} values but the response has ${nIn}. Every column must have one value per observation.`,
        'shape',
      );
    }
  }
  if (options.weights && options.weights.length !== nIn) {
    throw new EngineError(`The weight column has ${options.weights.length} values but the response has ${nIn}.`, 'shape');
  }
  if (options.offset && options.offset.length !== nIn) {
    throw new EngineError(`The offset column has ${options.offset.length} values but the response has ${nIn}.`, 'shape');
  }
  const names = hasIntercept ? ['(intercept)', ...predictors.map((c) => c.name)] : predictors.map((c) => c.name);
  const seen = new Set<string>();
  for (const nm of names) {
    if (seen.has(nm)) throw new EngineError(`Two columns are both named "${nm}". Column names must be distinct.`, 'invalid');
    seen.add(nm);
  }

  const X: number[][] = [];
  const yOut: number[] = [];
  const w: number[] = [];
  const offset: number[] = [];
  const rowIndex: number[] = [];
  let dropped = 0;
  for (let i = 0; i < nIn; i++) {
    const yi = y[i];
    if (!isUsable(yi)) {
      dropped++;
      continue;
    }
    let bad = false;
    const row: number[] = hasIntercept ? [1] : [];
    for (const c of predictors) {
      const v = c.values[i];
      if (!isUsable(v)) {
        bad = true;
        break;
      }
      row.push(v);
    }
    if (bad) {
      dropped++;
      continue;
    }
    let wi = 1;
    if (options.weights) {
      const raw = options.weights[i];
      if (!isUsable(raw)) {
        dropped++;
        continue;
      }
      if (raw <= 0) {
        throw new EngineError(
          `Weight ${raw} at row ${i} is not positive. Weighted least squares needs every weight > 0; drop the row instead of weighting it zero so the drop is visible in the row count.`,
          'range',
        );
      }
      wi = raw;
    }
    let off = 0;
    if (options.offset) {
      const raw = options.offset[i];
      if (!isUsable(raw)) {
        dropped++;
        continue;
      }
      off = raw;
    }
    X.push(row);
    yOut.push(yi);
    w.push(wi);
    offset.push(off);
    rowIndex.push(i);
  }

  const n = yOut.length;
  if (n === 0) {
    throw new EngineError('Every row was dropped because of missing values; there is nothing to fit.', 'insufficient');
  }
  const p = names.length;
  if (n <= p) {
    throw new EngineError(
      `A model with ${p} coefficient(s) cannot be fitted to ${n} complete observation(s): there are no residual degrees of freedom. Need n > p, and in practice comfortably more.`,
      'insufficient',
    );
  }

  const warnings: string[] = [];
  if (dropped > 0) {
    warnings.push(
      `${dropped} of ${nIn} row(s) were dropped because the response, a predictor, the weight or the offset was missing. ${n} complete row(s) were used. Dropping incomplete rows is unbiased only if those values are missing at random; if the reason a value is missing is related to the response, every estimate below is biased by an unknown amount.`,
    );
  }
  if (n < 5 * p) {
    warnings.push(
      `There are ${n} observations for ${p} coefficient(s) (n/p = ${(n / p).toFixed(2)}). The fit is technically possible but the estimates are unstable and the model will overstate how well it fits; treat the out-of-sample figures, not R², as the measure of fit.`,
    );
  }

  // The response must vary, or every coefficient is a division by zero in disguise.
  if (!options.allowConstantResponse) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of yOut) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min === 0) {
      throw new EngineError(
        `The response is constant (every value is ${min}). There is no variation to explain, so R², the standard errors and the F test are all undefined.`,
        'degenerate',
      );
    }
  }
  // A predictor with no variation carries no information and makes the design singular.
  for (let j = hasIntercept ? 1 : 0; j < p; j++) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = X[i][j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min === 0) {
      throw new EngineError(
        `Predictor "${names[j]}" is constant (every value is ${min}) over the ${n} rows used. A constant predictor is indistinguishable from the intercept, so its coefficient is not identified.`,
        'degenerate',
      );
    }
  }

  return {
    X,
    y: yOut,
    w,
    weighted: Boolean(options.weights),
    names,
    hasIntercept,
    rowIndex,
    offset,
    missing: { suppliedRows: nIn, droppedRows: dropped, rowsUsed: n },
    warnings,
  };
}

export function designFromSpec(spec: LinearSpec): DesignWithOffset {
  return buildDesign({
    y: spec.y,
    predictors: spec.predictors,
    intercept: spec.intercept,
    weights: spec.weights,
  });
}
