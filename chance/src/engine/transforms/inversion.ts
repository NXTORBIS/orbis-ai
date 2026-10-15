/**
 * Recovering a distribution from its transform.
 *
 * Three routes are offered for the characteristic function — Gil-Pelaez direct
 * quadrature, the Fang–Oosterlee COS expansion and an FFT grid inversion — and
 * two for the Laplace transform (Abate–Whitt Euler summation and
 * Gaver–Stehfest). None of them is accurate everywhere, and the error of each
 * is governed entirely by its truncation: the integration limit T and node
 * count for Gil-Pelaez, the interval [a, b] and term count N for COS, the grid
 * spacing for the FFT route, the contour parameter A for the Laplace routes.
 *
 * Every result therefore reports those numbers and an error estimate, and a
 * request for a point where the chosen truncation is not trustworthy is
 * refused. A silently truncated inversion is confidently wrong in exactly the
 * region — the far tail — where a transform method would otherwise be the only
 * thing that works.
 */
import { EngineError } from '../core/result';
import type { Exactness } from '../core/result';
import { stableSum } from '../core/numeric';
import { gaussLegendreUnit } from '../portfolio/numerics';
import { cAbs, cMul, cScale, cUnit, complex, fft, type Complex } from './complex';

/** A characteristic function supplied as a plain callable. */
export type CharacteristicFunction = (t: number) => Complex;

/** A Laplace transform of a non-negative function, evaluated at complex s. */
export type LaplaceTransform = (s: Complex) => Complex;

export interface InversionDiagnostics {
  method: 'gil-pelaez' | 'cos' | 'fft' | 'laplace-euler' | 'gaver-stehfest';
  /** Upper integration limit (Gil-Pelaez / FFT) if applicable. */
  integrationLimit?: number;
  /** Truncation interval (COS / FFT). */
  range?: { lower: number; upper: number };
  /** Number of terms, nodes or grid points used. */
  terms: number;
  /** Estimated absolute error of the reported value. */
  errorEstimate: number;
  /** True when the point requested lies where the truncation is trustworthy. */
  trustworthy: boolean;
  notes: string[];
}

export interface InversionValue {
  value: number;
  exactness: Exactness;
  diagnostics: InversionDiagnostics;
}

/* ------------------------------------------------------------------ *
 * Shared quadrature                                                  *
 * ------------------------------------------------------------------ */

/** Composite Gauss–Legendre nodes and weights on [0, T]. */
function panelGrid(T: number, panels: number, nodesPerPanel: number): { t: number[]; w: number[] } {
  const { nodes, weights } = gaussLegendreUnit(nodesPerPanel);
  const t: number[] = [];
  const w: number[] = [];
  const h = T / panels;
  for (let panel = 0; panel < panels; panel++) {
    const a = panel * h;
    for (let i = 0; i < nodes.length; i++) {
      t.push(a + nodes[i] * h);
      w.push(weights[i] * h);
    }
  }
  return { t, w };
}

/** Largest number of quadrature nodes any single inversion may use. */
export const MAX_INVERSION_NODES = 400_000;

/**
 * Estimate ∫_T^∞ |φ(t)| dt: the part over [T, 64T] by quadrature, and the
 * remainder by fitting a power law |φ| ~ t^{−a} to |φ(32T)| and |φ(64T)|. A
 * characteristic function that does not decay at all — a lattice distribution's
 * φ is periodic — gives a ≤ 1 and an infinite estimate, which is the truthful
 * answer: the integral cannot be truncated, and the caller is refused.
 */
function tailIntegralEstimate(phi: CharacteristicFunction, T: number): number {
  const { t, w } = panelGrid(63 * T, 64, 8);
  const near = stableSum(t.map((x, i) => w[i] * cAbs(phi(T + x))));
  const a32 = cAbs(phi(32 * T));
  const a64 = cAbs(phi(64 * T));
  if (!(a64 > 0)) return near;
  const decay = Math.log(a32 / a64) / Math.log(2);
  if (!(decay > 1)) return Infinity;
  return near + (a64 * 64 * T) / (decay - 1);
}

/**
 * Choose an integration limit T such that the estimated tail
 * (1/π)∫_T^∞|φ| is below `tailTarget`, and report that estimate so the
 * truncation error is a number the caller can see rather than an assumption.
 */
export function chooseIntegrationLimit(
  phi: CharacteristicFunction,
  tailTarget = 1e-10,
  maxLimit = 1e9,
): { limit: number; tailIntegral: number; decayed: boolean } {
  let T = 1;
  let tail = tailIntegralEstimate(phi, T);
  while (T < maxLimit && !(tail < tailTarget)) {
    T *= 2;
    tail = tailIntegralEstimate(phi, T);
  }
  return { limit: T, tailIntegral: tail, decayed: tail < tailTarget };
}

/**
 * Panel count that resolves the oscillation e^{−itx} over [0, T]: the
 * integrand completes T·|x|/(2π) cycles, and six Gauss–Legendre nodes per
 * cycle is ample for a smooth φ. Too few panels is the standard way a
 * Gil-Pelaez inversion returns a confident wrong number.
 */
function panelsFor(limit: number, x: number, nodesPerPanel: number, basePanels: number): number {
  const cycles = (limit * (Math.abs(x) + 1)) / (2 * Math.PI);
  const panels = Math.max(basePanels, Math.ceil((6 * cycles) / nodesPerPanel));
  if (panels * nodesPerPanel > MAX_INVERSION_NODES) {
    throw new EngineError(
      `Resolving the Gil-Pelaez integrand at x = ${x} would need about ${panels * nodesPerPanel} quadrature nodes (the integrand oscillates through ${Math.round(cycles)} cycles over [0, ${limit}]), beyond the limit of ${MAX_INVERSION_NODES}. No value is reported rather than an under-resolved one; use the COS method or a saddlepoint approximation at this point.`,
      'too-large',
    );
  }
  return panels;
}

/* ------------------------------------------------------------------ *
 * Gil-Pelaez                                                         *
 * ------------------------------------------------------------------ */

export interface GilPelaezOptions {
  /**
   * Target for the estimated tail ∫_T^∞|φ|, which fixes the truncation error
   * of the whole inversion. The default 1e-8 is a deliberate compromise: a
   * smaller target pushes T out and the node count up quadratically for a
   * polynomially decaying φ.
   */
  tolerance?: number;
  panels?: number;
  nodesPerPanel?: number;
  /** Refuse when the estimated error exceeds this fraction of the value. */
  maxRelativeError?: number;
  /** Absolute floor below which a relative test is meaningless. */
  absoluteFloor?: number;
}

/**
 * Density by Gil-Pelaez / Lévy inversion:
 *   f(x) = (1/π) ∫_0^∞ Re( e^{−itx} φ(t) ) dt.
 */
export function densityByGilPelaez(phi: CharacteristicFunction, x: number, options: GilPelaezOptions = {}): InversionValue {
  if (!Number.isFinite(x)) throw new EngineError('The inversion point x must be finite.', 'finite');
  const tol = options.tolerance ?? 1e-8;
  const nodes = options.nodesPerPanel ?? 12;
  const { limit, tailIntegral, decayed } = chooseIntegrationLimit(phi, tol);
  if (!decayed) {
    throw new EngineError(
      `The tail ∫_T^∞|φ| has not fallen below ${tol} by T = ${limit}, so the Gil-Pelaez integral cannot be truncated reliably. (A lattice distribution's characteristic function is periodic and never decays; use the lattice inversion instead.) No density is reported.`,
      'numerical',
    );
  }
  const panels = options.panels ?? panelsFor(limit, x, nodes, 64);
  const { t, w } = panelGrid(limit, panels, nodes);
  const terms = t.map((ti, i) => {
    const z = cMul(cUnit(-ti * x), phi(ti));
    return w[i] * z.re;
  });
  const value = stableSum(terms) / Math.PI;
  const truncationError = tailIntegral / Math.PI;
  // Quadrature error is estimated by halving the panel count and comparing;
  // this is the standard, honest estimate for a composite rule.
  const coarse = panelGrid(limit, Math.max(2, Math.floor(panels / 2)), nodes);
  const coarseValue =
    stableSum(coarse.t.map((ti, i) => coarse.w[i] * cMul(cUnit(-ti * x), phi(ti)).re)) / Math.PI;
  const quadratureError = Math.abs(value - coarseValue);
  const errorEstimate = truncationError + quadratureError;
  const floor = options.absoluteFloor ?? 1e-14;
  const maxRel = options.maxRelativeError ?? 1e-3;
  const trustworthy = errorEstimate <= Math.max(floor, maxRel * Math.abs(value));

  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'gil-pelaez',
      integrationLimit: limit,
      terms: t.length,
      errorEstimate,
      trustworthy,
      notes: [
        `Integrated Re(e^{−itx}φ(t)) over [0, ${limit}] with ${t.length} Gauss–Legendre nodes (${panels} panels × ${nodes}).`,
        `Truncation error bounded by (1/π)∫_T^∞|φ| ≈ ${truncationError.toExponential(3)}; quadrature error estimated at ${quadratureError.toExponential(3)} by panel halving.`,
        trustworthy
          ? 'The estimated error is small relative to the reported density.'
          : `The estimated error ${errorEstimate.toExponential(3)} is NOT small relative to the density ${value.toExponential(3)}: this point is beyond where this truncation is trustworthy.`,
      ],
    },
  };
}

/**
 * Tail probability by Gil-Pelaez:
 *   P(X > x) = 1/2 − (1/π) ∫_0^∞ Im( e^{−itx} φ(t) ) / t dt.
 * The integrand is finite at t = 0 (its limit is E[X] − x for a distribution
 * with a mean) but the 1/t factor makes small t numerically delicate, so the
 * first panel is refined.
 */
export function cdfByGilPelaez(phi: CharacteristicFunction, x: number, options: GilPelaezOptions = {}): InversionValue {
  if (!Number.isFinite(x)) throw new EngineError('The inversion point x must be finite.', 'finite');
  const tol = options.tolerance ?? 1e-8;
  const nodes = options.nodesPerPanel ?? 12;
  const { limit, tailIntegral, decayed } = chooseIntegrationLimit(phi, tol);
  if (!decayed) {
    throw new EngineError(
      `The tail ∫_T^∞|φ| has not fallen below ${tol} by T = ${limit}, so the Gil-Pelaez CDF integral cannot be truncated reliably. (A lattice distribution's characteristic function is periodic and never decays; use the lattice inversion instead.) No probability is reported.`,
      'numerical',
    );
  }
  const panels = options.panels ?? panelsFor(limit, x, nodes, 64);

  const integrand = (ti: number): number => {
    if (ti === 0) return 0;
    return cMul(cUnit(-ti * x), phi(ti)).im / ti;
  };

  const evaluate = (panelCount: number): number => {
    // Geometric refinement near 0, where 1/t is large, then uniform panels.
    let acc = 0;
    const split = Math.min(1, limit / 16);
    // 60 octaves, not 24: the integrand tends to the finite limit E[X] − x as
    // t → 0, so the interval [0, split·2^{−n}] that the refinement ignores
    // contributes about |E[X] − x|·split·2^{−n}. At n = 24 that is ~3e-8 —
    // which at z = 8 is eleven orders of magnitude larger than the tail being
    // computed, and it was the dominant error. At n = 60 it is ~1e-19.
    const nRefine = 60;
    const { nodes: gn, weights: gw } = gaussLegendreUnit(nodes);
    let lo = split * Math.pow(2, -nRefine);
    // The remaining interval [0, lo] contributes at most lo·sup|integrand|,
    // which is bounded because Im(e^{−itx}φ(t))/t → E[X] − x as t → 0.
    for (let i = 0; i < nRefine; i++) {
      const hi = lo * 2;
      for (let j = 0; j < gn.length; j++) acc += gw[j] * (hi - lo) * integrand(lo + gn[j] * (hi - lo));
      lo = hi;
    }
    const h = (limit - split) / panelCount;
    for (let panel = 0; panel < panelCount; panel++) {
      const a = split + panel * h;
      for (let j = 0; j < gn.length; j++) acc += gw[j] * h * integrand(a + gn[j] * h);
    }
    return acc;
  };

  const integral = evaluate(panels);
  const coarse = evaluate(Math.max(2, Math.floor(panels / 2)));
  // Gil-Pelaez: F(x) = ½ − (1/π)∫₀^∞ Im(e^{−itx}φ(t))/t dt.
  const value = 0.5 - integral / Math.PI;
  const sf = 1 - value;
  const truncationError = tailIntegral / (Math.PI * Math.max(limit, 1));
  const quadratureError = Math.abs(integral - coarse) / Math.PI;
  // F is formed as ½ − I/π, a difference of O(1) quantities, so its absolute
  // error can never be smaller than the rounding of those quantities. In the
  // far tail that cancellation, not the quadrature, is what makes the answer
  // unusable, and it must appear in the error estimate or the method would
  // claim a 1e-16 tail probability it cannot possibly resolve.
  const cancellationError = 4 * Number.EPSILON * (0.5 + Math.abs(integral) / Math.PI);
  const errorEstimate = truncationError + quadratureError + cancellationError;
  const floor = options.absoluteFloor ?? 0;
  const maxRel = options.maxRelativeError ?? 1e-3;
  // In the tail the meaningful quantity is the survival probability, so the
  // relative test is applied to whichever of F and 1 − F is smaller.
  const smallTail = Math.min(Math.abs(value), Math.abs(sf));
  const trustworthy = errorEstimate <= Math.max(floor, maxRel * smallTail);

  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'gil-pelaez',
      integrationLimit: limit,
      terms: panels * nodes,
      errorEstimate,
      trustworthy,
      notes: [
        `Integrated Im(e^{−itx}φ(t))/t over [0, ${limit}], with geometric refinement over 24 octaves near t = 0 where the 1/t factor dominates.`,
        `Estimated error ${errorEstimate.toExponential(3)} (truncation ${truncationError.toExponential(2)} + quadrature ${quadratureError.toExponential(2)} + floating-point cancellation in ½ − I/π of ${cancellationError.toExponential(2)}), against a smaller tail of ${smallTail.toExponential(3)}.`,
        trustworthy
          ? 'The truncation is trustworthy at this point.'
          : `REFUSAL CONDITION: the estimated error ${errorEstimate.toExponential(3)} is comparable with or larger than the tail probability ${smallTail.toExponential(3)}, so the inverted CDF carries no usable digits here. Use a saddlepoint approximation for this part of the tail.`,
      ],
    },
  };
}

/** Like `cdfByGilPelaez` but throws when the point is outside the trustworthy range. */
export function cdfByGilPelaezStrict(phi: CharacteristicFunction, x: number, options: GilPelaezOptions = {}): InversionValue {
  const r = cdfByGilPelaez(phi, x, options);
  if (!r.diagnostics.trustworthy) {
    throw new EngineError(
      `The Gil-Pelaez inversion at x = ${x} is outside the range where its truncation (T = ${r.diagnostics.integrationLimit}, ${r.diagnostics.terms} nodes) is trustworthy: the estimated error ${r.diagnostics.errorEstimate.toExponential(3)} is not smaller than the quantity being reported. No probability is returned.`,
      'out-of-range',
    );
  }
  return r;
}

/* ------------------------------------------------------------------ *
 * COS method (Fang & Oosterlee)                                      *
 * ------------------------------------------------------------------ */

export interface CosOptions {
  /** Number of cosine terms. */
  terms?: number;
  /** Truncation interval; derived from cumulants when omitted. */
  range?: { lower: number; upper: number };
  /** Cumulants κ₁, κ₂, κ₄ used for the Fang–Oosterlee interval rule. */
  cumulants?: { k1: number; k2: number; k4?: number };
  /** Multiplier L in the interval rule [κ₁ ± L√(κ₂ + √κ₄)]. */
  L?: number;
}

export interface CosExpansion {
  coefficients: Float64Array;
  lower: number;
  upper: number;
  terms: number;
  /** |A_N−1| · N, a proxy for the series-truncation error. */
  seriesTailEstimate: number;
}

/**
 * Build the cosine coefficients A_k = (2/(b−a))·Re( φ(kπ/(b−a))·e^{−ikπa/(b−a)} ).
 * Fang & Oosterlee (2008): the density on [a, b] is Σ A_k cos(kπ(x−a)/(b−a))
 * with the k = 0 term halved, and the error has two parts — the series
 * truncation (exponential in N for a smooth density) and the interval
 * truncation (the mass of the distribution outside [a, b]).
 */
export function cosExpansion(phi: CharacteristicFunction, options: CosOptions = {}): CosExpansion {
  const N = options.terms ?? 512;
  if (!Number.isInteger(N) || N < 8 || N > 1 << 20) {
    throw new EngineError('The COS term count must be a whole number between 8 and 1048576.', 'range');
  }
  let lower: number;
  let upper: number;
  if (options.range) {
    ({ lower, upper } = options.range);
  } else if (options.cumulants) {
    const { k1, k2, k4 = 0 } = options.cumulants;
    if (!(k2 > 0)) throw new EngineError('The COS interval rule needs a positive second cumulant.', 'range');
    const L = options.L ?? 10;
    const halfWidth = L * Math.sqrt(k2 + Math.sqrt(Math.abs(k4)));
    lower = k1 - halfWidth;
    upper = k1 + halfWidth;
  } else {
    throw new EngineError(
      'The COS method needs a truncation interval. Supply `range` explicitly, or `cumulants` so the Fang–Oosterlee rule [κ₁ ± L√(κ₂ + √κ₄)] can be applied. Guessing an interval would silently set the error of the whole inversion.',
      'required',
    );
  }
  if (!(upper > lower) || !Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new EngineError(`The COS truncation interval [${lower}, ${upper}] is not a valid finite interval.`, 'range');
  }

  const L0 = upper - lower;
  const A = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const u = (k * Math.PI) / L0;
    const z = cMul(phi(u), cUnit(-u * lower));
    A[k] = (2 / L0) * z.re;
  }
  A[0] *= 0.5;
  let tailEst = 0;
  for (let k = Math.max(1, N - 8); k < N; k++) tailEst = Math.max(tailEst, Math.abs(A[k]));
  return { coefficients: A, lower, upper, terms: N, seriesTailEstimate: tailEst * N };
}

/** Density from a COS expansion, refused outside the truncation interval. */
export function densityByCos(expansion: CosExpansion, x: number): InversionValue {
  const { coefficients: A, lower, upper, terms } = expansion;
  if (x < lower || x > upper) {
    throw new EngineError(
      `x = ${x} lies outside the COS truncation interval [${lower.toPrecision(8)}, ${upper.toPrecision(8)}]. The cosine series is periodic with period 2(b − a), so evaluating it outside the interval returns a reflected copy of the density — a plausible-looking number that is not the density at x. No value is reported; widen the interval instead.`,
      'out-of-range',
    );
  }
  const L0 = upper - lower;
  const terms_ = [] as number[];
  for (let k = 0; k < terms; k++) terms_.push(A[k] * Math.cos((k * Math.PI * (x - lower)) / L0));
  const value = stableSum(terms_);
  const errorEstimate = expansion.seriesTailEstimate;
  // Near the interval ends the series is contaminated by the periodic
  // extension, so trust is withdrawn in the outer 2% of the interval.
  const margin = 0.02 * L0;
  const nearEdge = x < lower + margin || x > upper - margin;
  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'cos',
      range: { lower, upper },
      terms,
      errorEstimate,
      trustworthy: !nearEdge && errorEstimate <= Math.max(1e-12, 1e-3 * Math.abs(value)),
      notes: [
        `COS expansion with ${terms} cosine terms on [${lower.toPrecision(6)}, ${upper.toPrecision(6)}].`,
        `Series-truncation proxy N·max|A_k| over the last 8 coefficients is ${errorEstimate.toExponential(3)}.`,
        nearEdge
          ? 'This point is in the outer 2% of the truncation interval, where the periodic extension of the cosine series contaminates the value. It is not reported as trustworthy.'
          : 'The point is comfortably inside the truncation interval.',
      ],
    },
  };
}

/** CDF from a COS expansion, by term-by-term integration of the cosine series. */
export function cdfByCos(expansion: CosExpansion, x: number): InversionValue {
  const { coefficients: A, lower, upper, terms } = expansion;
  if (x < lower || x > upper) {
    throw new EngineError(
      `x = ${x} lies outside the COS truncation interval [${lower.toPrecision(8)}, ${upper.toPrecision(8)}]; the integrated series has no meaning there. No probability is reported.`,
      'out-of-range',
    );
  }
  const L0 = upper - lower;
  const parts: number[] = [A[0] * (x - lower)];
  for (let k = 1; k < terms; k++) {
    parts.push((A[k] * L0 * Math.sin((k * Math.PI * (x - lower)) / L0)) / (k * Math.PI));
  }
  const value = stableSum(parts);
  const errorEstimate = (expansion.seriesTailEstimate * L0) / (Math.PI * terms);
  const margin = 0.02 * L0;
  const nearEdge = x < lower + margin || x > upper - margin;
  const smallTail = Math.min(Math.abs(value), Math.abs(1 - value));
  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'cos',
      range: { lower, upper },
      terms,
      errorEstimate,
      trustworthy: !nearEdge && errorEstimate <= Math.max(1e-12, 1e-3 * smallTail),
      notes: [
        `COS CDF: the cosine series integrated term by term on [${lower.toPrecision(6)}, ${upper.toPrecision(6)}] with ${terms} terms.`,
        `The interval truncation also loses the mass of the distribution outside [a, b]; with the Fang–Oosterlee rule at L = 10 that is typically below 1e-10 for a light-tailed law but can be far larger for a heavy-tailed one. It is not included in the ${errorEstimate.toExponential(3)} series estimate above.`,
        nearEdge ? 'Within the outer 2% of the interval the value is not trustworthy.' : 'The point is comfortably inside the truncation interval.',
      ],
    },
  };
}

/* ------------------------------------------------------------------ *
 * FFT grid inversion                                                 *
 * ------------------------------------------------------------------ */

export interface FftInversionResult {
  /** Grid of abscissae. */
  x: Float64Array;
  /** Density on that grid. */
  density: Float64Array;
  diagnostics: InversionDiagnostics;
}

/**
 * Density on a uniform grid by FFT inversion of φ. With N points, a frequency
 * spacing du and the reciprocity condition dx·du = 2π/N, the grid covers
 * [x₀, x₀ + (N−1)dx] and the frequency range [0, N·du/2]. Both numbers are
 * reported: too small an N·du truncates the oscillatory integral, and too
 * large a dx aliases the density.
 */
export function densityByFft(
  phi: CharacteristicFunction,
  options: { terms?: number; frequencyStep?: number; centre?: number },
): FftInversionResult {
  const N = options.terms ?? 4096;
  if (!Number.isInteger(N) || N < 16 || (N & (N - 1)) !== 0) {
    throw new EngineError('FFT inversion needs a power-of-two grid size of at least 16.', 'range');
  }
  const du = options.frequencyStep ?? 0.05;
  if (!(du > 0) || !Number.isFinite(du)) throw new EngineError('The frequency step must be a finite positive number.', 'range');
  const centre = options.centre ?? 0;
  const dx = (2 * Math.PI) / (N * du);
  const x0 = centre - (N * dx) / 2;

  // f(x_j) = (1/2π) ∫ e^{−iux} φ(u) du, trapezoidal on u_k = (k − N/2)du,
  // arranged so a single FFT evaluates all j.
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const u = (k - N / 2) * du;
    // e^{−i u x_0} φ(u) du / (2π), with the alternating sign from the shifted
    // frequency grid folded in.
    const z = cScale(cMul(phi(u), cUnit(-u * x0)), du / (2 * Math.PI));
    re[k] = z.re;
    im[k] = z.im;
  }
  fft(re, im, false);
  // The shifted frequency grid u_k = (k − N/2)du contributes a factor
  // e^{iπj} = (−1)^j on the OUTPUT index j, not on the input index.
  for (let j = 1; j < N; j += 2) {
    re[j] = -re[j];
    im[j] = -im[j];
  }
  const density = new Float64Array(N);
  const xs = new Float64Array(N);
  let negative = 0;
  for (let j = 0; j < N; j++) {
    xs[j] = x0 + j * dx;
    const v = re[j];
    if (v < 0) {
      negative = Math.max(negative, -v);
      density[j] = 0;
    } else {
      density[j] = v;
    }
  }
  const uMax = (N / 2) * du;
  const tailModulus = cAbs(phi(uMax));

  return {
    x: xs,
    density,
    diagnostics: {
      method: 'fft',
      integrationLimit: uMax,
      range: { lower: x0, upper: x0 + (N - 1) * dx },
      terms: N,
      errorEstimate: tailModulus / Math.PI + negative,
      trustworthy: tailModulus < 1e-8,
      notes: [
        `Grid of ${N} points, spacing dx = ${dx.toPrecision(6)}, frequency step du = ${du}, so the integral is truncated at |u| = ${uMax.toPrecision(6)} and the grid covers [${x0.toPrecision(6)}, ${(x0 + (N - 1) * dx).toPrecision(6)}].`,
        `|φ| at the truncation frequency is ${tailModulus.toExponential(3)}; the frequency-truncation error of the density is of that order divided by π.`,
        `Largest negative density produced by rounding and aliasing: ${negative.toExponential(3)} (clipped to 0 in the reported grid, and counted in the error estimate rather than hidden).`,
        tailModulus < 1e-8
          ? 'The characteristic function has decayed at the truncation frequency, so the frequency truncation is adequate.'
          : 'WARNING: |φ| is still appreciable at the truncation frequency; raise N or du. The reported density is not trustworthy.',
      ],
    },
  };
}

/* ------------------------------------------------------------------ *
 * Laplace transform inversion                                        *
 * ------------------------------------------------------------------ */

export interface EulerOptions {
  /** Contour parameter; the discretisation error is of order e^{−A}. */
  A?: number;
  /** Euler averaging order. */
  m?: number;
  /** Partial sums before averaging. */
  n?: number;
}

/**
 * Abate–Whitt Euler algorithm. The Bromwich integral is discretised by the
 * trapezoidal rule, giving an alternating series whose convergence is
 * accelerated by binomial (Euler) averaging:
 *
 *   f(t) ≈ (e^{A/2}/t) · Σ_{k=0}^{m} 2^{−m} C(m,k) · s_{n+k},
 *   s_j = Σ_{i=0}^{j} (−1)^i b_i,  b_0 = ½ Re F̂(A/2t),
 *   b_i = Re F̂((A + 2πi·i)/(2t)).
 *
 * The discretisation error is of order e^{−A}, so A = 18.4 is the practical
 * limit in double precision: it buys about eight digits, and a larger A makes
 * the e^{A/2} prefactor amplify rounding faster than it reduces the
 * discretisation error. That limit is stated rather than papered over.
 */
export function laplaceInvertEuler(fhat: LaplaceTransform, t: number, options: EulerOptions = {}): InversionValue {
  if (!(t > 0) || !Number.isFinite(t)) {
    throw new EngineError('Laplace inversion requires a finite time t > 0; the transform determines f only on (0, ∞).', 'range');
  }
  const A = options.A ?? 18.4;
  const m = options.m ?? 11;
  const n = options.n ?? 38;
  if (!(A > 0) || A > 40) {
    throw new EngineError(
      `The Euler contour parameter A = ${A} is outside the usable range (0, 40]. The discretisation error is of order e^{−A} but the e^{A/2} prefactor amplifies double-precision rounding by the same factor, so values above about 20 lose more than they gain.`,
      'range',
    );
  }
  if (!Number.isInteger(m) || m < 1 || m > 30 || !Number.isInteger(n) || n < 1 || n > 500) {
    throw new EngineError('The Euler parameters need 1 ≤ m ≤ 30 and 1 ≤ n ≤ 500.', 'range');
  }

  const b = (i: number): number => {
    const s = complex(A / (2 * t), (Math.PI * i) / t);
    const v = fhat(s);
    if (!Number.isFinite(v.re) || !Number.isFinite(v.im)) {
      throw new EngineError(`The Laplace transform returned a non-finite value at s = ${s.re} + ${s.im}i, so no inversion is possible.`, 'numerical');
    }
    return i === 0 ? 0.5 * v.re : v.re;
  };

  const partial: number[] = [];
  let acc = 0;
  for (let i = 0; i <= n + m; i++) {
    acc += (i % 2 === 0 ? 1 : -1) * b(i);
    partial.push(acc);
  }
  let avg = 0;
  for (let k = 0; k <= m; k++) {
    avg += binomial(m, k) * Math.pow(2, -m) * partial[n + k];
  }
  const value = (Math.exp(A / 2) / t) * avg;

  // Error estimate: compare with the (m − 1) averaging, which is the standard
  // self-check for the Euler algorithm.
  let avgLower = 0;
  for (let k = 0; k <= m - 1; k++) avgLower += binomial(m - 1, k) * Math.pow(2, -(m - 1)) * partial[n + k];
  const valueLower = (Math.exp(A / 2) / t) * avgLower;
  const errorEstimate = Math.abs(value - valueLower) + Math.exp(-A) * Math.abs(value);

  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'laplace-euler',
      terms: n + m + 1,
      errorEstimate,
      trustworthy: errorEstimate <= Math.max(1e-12, 1e-6 * Math.abs(value)),
      notes: [
        `Abate–Whitt Euler algorithm with A = ${A}, m = ${m}, n = ${n}: ${n + m + 1} transform evaluations on the Bromwich contour Re s = ${(A / (2 * t)).toPrecision(6)}.`,
        `Discretisation error of order e^{−A} = ${Math.exp(-A).toExponential(3)}; the prefactor e^{A/2} = ${Math.exp(A / 2).toExponential(3)} multiplies double-precision rounding, which caps the achievable accuracy at roughly ${(Math.exp(A / 2) * 1e-16).toExponential(1)} absolute.`,
        `Estimated error ${errorEstimate.toExponential(3)}, from the difference between the order-${m} and order-${m - 1} Euler averages plus the e^{−A} discretisation term.`,
      ],
    },
  };
}

/**
 * Gaver–Stehfest inversion. It needs only real evaluations of F̂, which makes
 * it convenient, but it is severely limited in double precision: the Stehfest
 * weights alternate in sign and grow like 10^M, so M above about 7 loses more
 * digits to cancellation than the method gains. M > 8 is refused outright.
 */
export function laplaceInvertStehfest(fhat: (s: number) => number, t: number, M = 6): InversionValue {
  if (!(t > 0) || !Number.isFinite(t)) {
    throw new EngineError('Laplace inversion requires a finite time t > 0.', 'range');
  }
  if (!Number.isInteger(M) || M < 2 || M > 8) {
    throw new EngineError(
      `The Gaver–Stehfest order M = ${M} is outside the range 2…8. The weights grow like 10^M and alternate in sign, so in double precision M > 8 is dominated by cancellation: the result would have no correct digits. Use the Euler algorithm for higher accuracy.`,
      'range',
    );
  }
  const V = stehfestWeights(M);
  const ln2 = Math.LN2;
  const terms: number[] = [];
  for (let k = 1; k <= 2 * M; k++) {
    const s = (k * ln2) / t;
    const v = fhat(s);
    if (!Number.isFinite(v)) {
      throw new EngineError(`The Laplace transform returned a non-finite value at s = ${s}; no inversion is possible.`, 'numerical');
    }
    terms.push(V[k - 1] * v);
  }
  const value = (ln2 / t) * stableSum(terms);
  // The cancellation error is bounded by the machine epsilon times the sum of
  // the absolute terms, which is the honest limit of the method.
  const absSum = stableSum(terms.map(Math.abs)) * (ln2 / t);
  const errorEstimate = absSum * 2e-16 + Math.abs(value) * Math.pow(10, -(0.9 * M));
  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'gaver-stehfest',
      terms: 2 * M,
      errorEstimate,
      trustworthy: errorEstimate <= Math.max(1e-10, 1e-4 * Math.abs(value)),
      notes: [
        `Gaver–Stehfest with M = ${M} (${2 * M} real transform evaluations at s = k·ln2/t).`,
        `Σ|V_k·F̂| = ${absSum.toExponential(3)} against a result of ${value.toExponential(3)}: the ratio is the cancellation amplification, and double-precision rounding is magnified by it. Estimated error ${errorEstimate.toExponential(3)}.`,
        'The method is a rule of thumb worth about 0.9·M significant digits in exact arithmetic; it cannot be pushed past about 6 digits in double precision whatever M is chosen.',
      ],
    },
  };
}

/**
 * Gaver–Stehfest weights, built the way they are derived rather than copied
 * from a published table: the n-th Gaver functional
 *   f_n(t) = (n·ln2/t)·C(2n,n)·Σ_j (−1)^j C(n,j)·F̂((n+j)ln2/t)
 * converges like 1/n, and Salzer's acceleration combines M of them with
 * weights (−1)^{M−n}·n^M/(n!(M−n)!). Collecting the coefficients of each
 * F̂(k·ln2/t) gives the familiar V_k, which for M = 3 come out as
 * 1, −49, 366, −858, 810, −270 — the standard published set, so the
 * construction is self-checking.
 */
function stehfestWeights(M: number): number[] {
  const V = new Array<number>(2 * M + 1).fill(0);
  for (let n = 1; n <= M; n++) {
    const salzer = (Math.pow(-1, M - n) * Math.pow(n, M)) / (factorial(n) * factorial(M - n));
    const prefactor = n * binomial(2 * n, n);
    for (let j = 0; j <= n; j++) {
      V[n + j] += salzer * prefactor * Math.pow(-1, j) * binomial(n, j);
    }
  }
  return V.slice(1);
}

const FACTORIALS: number[] = [1];
function factorial(n: number): number {
  if (n < 0) return Infinity;
  for (let i = FACTORIALS.length; i <= n; i++) FACTORIALS.push(FACTORIALS[i - 1] * i);
  return FACTORIALS[n];
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let acc = 1;
  for (let i = 0; i < k; i++) acc = (acc * (n - i)) / (i + 1);
  return Math.round(acc);
}

/* ------------------------------------------------------------------ *
 * Lattice inversion                                                  *
 * ------------------------------------------------------------------ */

/**
 * Exact inversion for a distribution supported on the lattice {j·step}:
 *   p(v) = (step/2π)·∫_{−π/step}^{π/step} e^{−itv} φ(t) dt
 *        = (step/π)·∫_0^{π/step} Re( e^{−itv} φ(t) ) dt.
 *
 * Unlike Gil-Pelaez this integral is over a FINITE range, so there is no
 * truncation error at all — only quadrature error. It is the right route for a
 * lattice law, whose characteristic function is periodic and therefore never
 * decays, so the infinite-range formulae above (correctly) refuse it.
 */
export function pmfByLatticeInversion(
  phi: CharacteristicFunction,
  value: number,
  step = 1,
  options: { panels?: number; nodesPerPanel?: number } = {},
): InversionValue {
  if (!(step > 0) || !Number.isFinite(step)) throw new EngineError('The lattice step must be a finite positive number.', 'range');
  if (!Number.isFinite(value)) throw new EngineError('The inversion point must be finite.', 'finite');
  const nodes = options.nodesPerPanel ?? 12;
  const limit = Math.PI / step;
  const panels = options.panels ?? Math.max(64, Math.ceil((6 * limit * (Math.abs(value) + 1)) / (2 * Math.PI * nodes)));
  if (panels * nodes > MAX_INVERSION_NODES) {
    throw new EngineError(
      `Lattice inversion at value ${value} would need ${panels * nodes} quadrature nodes, beyond the limit of ${MAX_INVERSION_NODES}. No value is reported.`,
      'too-large',
    );
  }
  const { t, w } = panelGrid(limit, panels, nodes);
  const integral = stableSum(t.map((ti, i) => w[i] * cMul(cUnit(-ti * value), phi(ti)).re));
  const p = (step / Math.PI) * integral;
  const coarse =
    ((step / Math.PI) *
      (() => {
        const g = panelGrid(limit, Math.max(2, Math.floor(panels / 2)), nodes);
        return stableSum(g.t.map((ti, i) => g.w[i] * cMul(cUnit(-ti * value), phi(ti)).re));
      })());
  const errorEstimate = Math.abs(p - coarse);
  return {
    value: p,
    exactness: 'numerical',
    diagnostics: {
      method: 'gil-pelaez',
      integrationLimit: limit,
      terms: panels * nodes,
      errorEstimate,
      trustworthy: errorEstimate <= Math.max(1e-15, 1e-6 * Math.abs(p)),
      notes: [
        `Lattice inversion over the finite range [0, π/step] = [0, ${limit.toPrecision(6)}] with ${panels * nodes} nodes. There is NO truncation error in this route: the range is exact for a lattice distribution.`,
        `Quadrature error estimated at ${errorEstimate.toExponential(3)} by panel halving.`,
      ],
    },
  };
}

/** CDF of a lattice law by summing `pmfByLatticeInversion` over the support. */
export function cdfByLatticeInversion(
  phi: CharacteristicFunction,
  upTo: number,
  step = 1,
  options: { from?: number } = {},
): InversionValue {
  const from = options.from ?? 0;
  const kHi = Math.floor((upTo - from) / step + 1e-9);
  if (kHi < 0) {
    return {
      value: 0,
      exactness: 'numerical',
      diagnostics: { method: 'gil-pelaez', terms: 0, errorEstimate: 0, trustworthy: true, notes: ['The point lies below the first lattice point, so the CDF is 0.'] },
    };
  }
  if (kHi > 20_000) {
    throw new EngineError(
      `Summing the inverted pmf up to ${upTo} would need ${kHi + 1} inversions, beyond the limit of 20,001. Use the COS method or a saddlepoint approximation instead.`,
      'too-large',
    );
  }
  const parts: number[] = [];
  let err = 0;
  let terms = 0;
  for (let k = 0; k <= kHi; k++) {
    const r = pmfByLatticeInversion(phi, from + k * step, step);
    parts.push(r.value);
    err += r.diagnostics.errorEstimate;
    terms += r.diagnostics.terms;
  }
  const value = stableSum(parts);
  return {
    value,
    exactness: 'numerical',
    diagnostics: {
      method: 'gil-pelaez',
      terms,
      errorEstimate: err,
      trustworthy: err <= Math.max(1e-14, 1e-6 * Math.abs(value)),
      notes: [
        `Summed ${kHi + 1} inverted lattice probabilities from ${from} to ${from + kHi * step}; accumulated quadrature error ${err.toExponential(3)}.`,
      ],
    },
  };
}
