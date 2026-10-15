/**
 * Basis expansions: polynomial, natural cubic spline and B-spline.
 *
 * These turn a non-linear relationship into a linear model in a transformed
 * set of columns, so every piece of inference from `linear.ts` still applies —
 * conditional, as always, on the chosen form.
 *
 * Polynomials of any appreciable degree behave violently outside the range of
 * the data: a cubic fitted on [0, 10] can be off by orders of magnitude at 12.
 * Splines are the usual answer because they are local, and a NATURAL cubic
 * spline is additionally constrained to be linear beyond the outer knots,
 * which is the one extrapolation behaviour that is merely wrong rather than
 * absurd. Both expansions return the warning text with the columns.
 */
import { EngineError } from '../core/result';
import { quantile } from '../stats/descriptive';
import type { Column } from './types';

export interface BasisExpansion {
  columns: Column[];
  /** Evaluate the same basis at new x values (needed for prediction). */
  evaluate: (x: number) => number[];
  description: string;
  warnings: string[];
  /** Range the basis was built on; outside it, the fit is extrapolation. */
  range: { min: number; max: number };
}

function finiteValues(x: readonly (number | null | undefined)[], name: string): number[] {
  const out: number[] = [];
  for (const v of x) if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  if (out.length === 0) throw new EngineError(`Column "${name}" has no usable values.`, 'insufficient');
  return out;
}

/** Raw polynomial basis x, x², …, x^degree. */
export function polynomialBasis(x: readonly (number | null | undefined)[], degree: number, name = 'x'): BasisExpansion {
  if (!Number.isInteger(degree) || degree < 1) {
    throw new EngineError(`The polynomial degree must be a whole number ≥ 1; received ${degree}.`, 'range');
  }
  if (degree > 10) {
    throw new EngineError(
      `A degree-${degree} polynomial is refused: the design matrix becomes numerically indistinguishable from singular and the fit is dominated by rounding error. Use a spline basis for flexible shapes.`,
      'range',
    );
  }
  const used = finiteValues(x, name);
  const min = Math.min(...used);
  const max = Math.max(...used);
  const columns: Column[] = [];
  for (let d = 1; d <= degree; d++) {
    columns.push({
      name: d === 1 ? name : `${name}^${d}`,
      values: x.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.pow(v, d) : null)),
    });
  }
  const warnings = [
    `Polynomial extrapolation is wild. This degree-${degree} fit is only a description of the range actually observed (${min.toPrecision(6)} to ${max.toPrecision(6)}); just outside it the fitted curve turns and diverges at the rate of x^${degree}, and the prediction interval does not warn you because it is computed under the assumption that the polynomial is the truth.`,
    'The raw powers x, x², … are strongly correlated, so the individual coefficients of a polynomial fit are nearly uninterpretable and their standard errors are inflated. Judge the fitted curve, not the coefficients. The variance inflation factors reported with the fit will be large and that is expected here, not a fault.',
  ];
  if (degree >= 4) {
    warnings.push(
      `Degree ${degree} is high. A high-degree polynomial fits wiggles that are usually noise, and the wiggle is worst at the ends of the data. A natural cubic spline with a few knots is almost always the better tool.`,
    );
  }
  return {
    columns,
    evaluate: (v: number) => Array.from({ length: degree }, (_, i) => Math.pow(v, i + 1)),
    description: `Raw polynomial basis of degree ${degree} in ${name}`,
    warnings,
    range: { min, max },
  };
}

function interiorKnots(used: readonly number[], count: number): number[] {
  const ks: number[] = [];
  for (let i = 1; i <= count; i++) ks.push(quantile(used, i / (count + 1)));
  const unique = [...new Set(ks)];
  if (unique.length !== ks.length) {
    throw new EngineError(
      `The requested ${count} interior knots are not distinct: the predictor has too few distinct values (or is too concentrated) to support that many knots. Use fewer knots.`,
      'degenerate',
    );
  }
  return unique;
}

/**
 * Natural cubic spline basis (Hastie, Tibshirani & Friedman, eq. 5.4–5.5).
 *
 * With K knots in total the space has K degrees of freedom, one of which is
 * the constant; the K − 1 non-constant columns are returned here and the
 * intercept comes from the design matrix. The natural constraint forces the
 * function to be linear beyond the boundary knots, which is what stops the
 * ends of the fit from flying off the way an unconstrained cubic does.
 */
export function naturalCubicSplineBasis(
  x: readonly (number | null | undefined)[],
  options: { knots?: number[]; interiorKnots?: number } = {},
  name = 'x',
): BasisExpansion {
  const used = finiteValues(x, name);
  const min = Math.min(...used);
  const max = Math.max(...used);
  let knots: number[];
  if (options.knots) {
    knots = [...options.knots].sort((a, b) => a - b);
    if (knots.length < 3) throw new EngineError('A natural cubic spline needs at least 3 knots (two boundary and one interior).', 'insufficient');
    if (new Set(knots).size !== knots.length) throw new EngineError('The knots must be distinct.', 'invalid');
  } else {
    const nInterior = options.interiorKnots ?? 2;
    if (!Number.isInteger(nInterior) || nInterior < 1) throw new EngineError('The number of interior knots must be a whole number ≥ 1.', 'range');
    knots = [min, ...interiorKnots(used, nInterior), max];
  }
  const K = knots.length;
  const xiK = knots[K - 1];
  const xiKm1 = knots[K - 2];
  const cube = (v: number) => (v > 0 ? v * v * v : 0);
  const d = (v: number, k: number): number => {
    const a = (cube(v - knots[k]) - cube(v - xiK)) / (xiK - knots[k]);
    const b = (cube(v - xiKm1) - cube(v - xiK)) / (xiK - xiKm1);
    return a - b;
  };
  const evaluate = (v: number): number[] => {
    const out = [v];
    for (let k = 0; k < K - 2; k++) out.push(d(v, k));
    return out;
  };
  const names = [name, ...Array.from({ length: K - 2 }, (_, k) => `${name}:ns${k + 1}`)];
  const columns: Column[] = names.map((nm, j) => ({
    name: nm,
    values: x.map((v) => (typeof v === 'number' && Number.isFinite(v) ? evaluate(v)[j] : null)),
  }));
  return {
    columns,
    evaluate,
    description: `Natural cubic spline basis with knots at ${knots.map((k) => k.toPrecision(5)).join(', ')} (${K - 1} non-constant columns)`,
    warnings: [
      `The spline is constrained to be linear outside the boundary knots (${min.toPrecision(6)}, ${max.toPrecision(6)}), so extrapolation continues in a straight line. That is a deliberate assumption, not knowledge: beyond the data the fit is an assumption with a confidence interval drawn around it.`,
      'The number and placement of the knots are choices. Choosing them by looking at the fit, and then reporting the p-values from that fit, invalidates the p-values.',
      'Spline coefficients have no individual meaning. Read the fitted curve and its interval.',
    ],
    range: { min, max },
  };
}

/**
 * B-spline basis by the Cox–de Boor recursion.
 *
 * The first basis function is dropped so the remaining columns are not
 * collinear with the intercept supplied by the design matrix.
 */
export function bSplineBasis(
  x: readonly (number | null | undefined)[],
  options: { degree?: number; interiorKnots?: number; knots?: number[] } = {},
  name = 'x',
): BasisExpansion {
  const degree = options.degree ?? 3;
  if (!Number.isInteger(degree) || degree < 1 || degree > 5) {
    throw new EngineError(`The B-spline degree must be a whole number between 1 and 5; received ${degree}.`, 'range');
  }
  const used = finiteValues(x, name);
  const min = Math.min(...used);
  const max = Math.max(...used);
  const interior = options.knots ? [...options.knots].sort((a, b) => a - b) : interiorKnots(used, options.interiorKnots ?? 2);
  for (const k of interior) {
    if (!(k > min && k < max)) throw new EngineError(`Interior knot ${k} is outside the range of the data (${min}, ${max}).`, 'range');
  }
  // Open uniform knot vector: boundary knots repeated degree+1 times.
  const t: number[] = [];
  for (let i = 0; i <= degree; i++) t.push(min);
  t.push(...interior);
  for (let i = 0; i <= degree; i++) t.push(max);
  const nBasis = t.length - degree - 1;
  const basisAt = (v: number): number[] => {
    // Cox–de Boor, with the right endpoint folded into the last interval so
    // that the basis sums to 1 at x = max as well.
    const vv = Math.min(Math.max(v, min), max);
    let N: number[] = [];
    for (let i = 0; i < t.length - 1; i++) {
      const last = vv === max && t[i + 1] === max && t[i] < max;
      N.push(last || (vv >= t[i] && vv < t[i + 1]) ? 1 : 0);
    }
    for (let deg = 1; deg <= degree; deg++) {
      const next: number[] = [];
      for (let i = 0; i < t.length - deg - 1; i++) {
        const d1 = t[i + deg] - t[i];
        const d2 = t[i + deg + 1] - t[i + 1];
        const a = d1 > 0 ? ((vv - t[i]) / d1) * N[i] : 0;
        const b = d2 > 0 ? ((t[i + deg + 1] - vv) / d2) * N[i + 1] : 0;
        next.push(a + b);
      }
      N = next;
    }
    return N.slice(0, nBasis);
  };
  const evaluate = (v: number) => basisAt(v).slice(1);
  const columns: Column[] = Array.from({ length: nBasis - 1 }, (_, j) => ({
    name: `${name}:bs${j + 1}`,
    values: x.map((v) => (typeof v === 'number' && Number.isFinite(v) ? evaluate(v)[j] : null)),
  }));
  return {
    columns,
    evaluate,
    description: `B-spline basis of degree ${degree} with interior knots at ${interior.map((k) => k.toPrecision(5)).join(', ') || 'none'} (${nBasis - 1} columns after dropping the first for the intercept)`,
    warnings: [
      `Unlike a natural spline, a B-spline basis is not constrained at the boundary: outside the knot range (${min.toPrecision(6)}, ${max.toPrecision(6)}) the basis is clamped here rather than extrapolated, so predictions outside the observed range are flat continuations and must not be read as forecasts.`,
      'The number and placement of knots are choices that change the fit; selecting them from the data and then quoting the resulting p-values invalidates them.',
      'Individual B-spline coefficients are not interpretable. Read the fitted curve.',
    ],
    range: { min, max },
  };
}
