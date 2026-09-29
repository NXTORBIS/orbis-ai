/**
 * Interpolation and curve fitting, with the difference between the two kept in view.
 *
 * Interpolation passes through the measurements and says what lies between them. Fitting does not pass through the
 * measurements at all; it finds the curve of an assumed shape that comes closest to them. Both produce a line on a
 * chart, and confusing them is how a fitted curve gets read as data.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * interpolate    vs   extrapolate      -- one is bounded by measurements, the other by nothing. Only one is offered.
 * interpolate    vs   fit              -- through the points, or near them. Different questions, different objects.
 * a good fit     vs   the right model  -- R² measures agreement with this shape, not that the shape is right
 * fitted in y    vs   fitted in log y  -- a log fit minimises relative error; it is a different fit, and it says so
 * spline         vs   monotone         -- a spline can swing outside the data; a monotone one cannot
 * residual       vs   noise            -- a pattern in the residuals is the model being wrong, not the data being noisy
 * ranked         vs   best             -- this file ranks fits and names no winner
 * ```
 *
 * One refusal worth naming up front. Every evaluation is refused outside the range of the measured x values. A curve
 * fitted to data from 0 to 10 will happily return a number at 400, and that number is an assertion about a region
 * nothing was measured in. Callers who want it must ask a different question deliberately.
 *
 * Pure. No network, no clock, no storage.
 */

import { isStatisticsError, regress } from './statistics.ts'

// ---------------------------------------------------------------- failure

export interface FitError {
  error:
    | 'empty'
    | 'too-few'
    | 'not-finite'
    | 'duplicate-x'
    | 'mismatched-length'
    | 'invalid-argument'
    | 'outside-range'
    | 'domain'
    | 'no-fit'
  message: string
}

export const isFitError = (value: unknown): value is FitError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: FitError['error'], message: string): FitError => ({ error, message })

/** More points than this are refused, so a Page cannot ask for an interpolant it will never draw. */
export const MAXIMUM_POINTS = 100_000

/** Past this degree a polynomial through the points oscillates more than it describes. */
export const MAXIMUM_INTERPOLATION_DEGREE = 10

// ---------------------------------------------------------------- the points

export interface Points {
  x: readonly number[]
  y: readonly number[]
  /** True when the input needed reordering to get x ascending. */
  reordered: boolean
}

/**
 * Checks and sorts a set of points.
 *
 * Duplicate x values are refused rather than averaged. Two different y values at the same x is a statement that the
 * relationship is not a function of x, and quietly averaging them would answer a question nobody asked — the caller
 * has to decide whether those are repeat measurements to average or a sign that x is not the whole story.
 */
export function checkPoints(
  x: readonly (number | null | undefined)[],
  y: readonly (number | null | undefined)[]
): Points | FitError {
  if (x.length === 0) return fail('empty', 'There are no points.')
  if (x.length !== y.length) return fail('mismatched-length', `There are ${x.length} x values and ${y.length} y values.`)
  if (x.length > MAXIMUM_POINTS) return fail('invalid-argument', `${x.length} points is more than the ${MAXIMUM_POINTS} this engine handles.`)
  const pairs: { x: number; y: number }[] = []
  for (let i = 0; i < x.length; i += 1) {
    const xi = x[i]
    const yi = y[i]
    if (typeof xi !== 'number' || !Number.isFinite(xi)) return fail('not-finite', `The x value at index ${i} is not a finite number.`)
    if (typeof yi !== 'number' || !Number.isFinite(yi)) return fail('not-finite', `The y value at index ${i} is not a finite number.`)
    pairs.push({ x: xi, y: yi })
  }
  let reordered = false
  for (let i = 1; i < pairs.length; i += 1) {
    if ((pairs[i]?.x as number) < (pairs[i - 1]?.x as number)) {
      reordered = true
      break
    }
  }
  pairs.sort((a, b) => a.x - b.x)
  for (let i = 1; i < pairs.length; i += 1) {
    if (pairs[i]?.x === pairs[i - 1]?.x) {
      return fail(
        'duplicate-x',
        `Two points share x = ${pairs[i]?.x}. Averaging them would assume they are repeat measurements of the same thing; keeping both would make the relationship not a function of x. Decide which it is first.`
      )
    }
  }
  return { x: pairs.map((one) => one.x), y: pairs.map((one) => one.y), reordered }
}

// ---------------------------------------------------------------- interpolation

export type InterpolationKind = 'nearest' | 'linear' | 'polynomial' | 'cubic-spline' | 'monotone-cubic'

export const INTERPOLATION_KINDS: readonly InterpolationKind[] = Object.freeze([
  'nearest',
  'linear',
  'polynomial',
  'cubic-spline',
  'monotone-cubic'
])

/** What each method does, and the case it is the wrong choice for. */
export const INTERPOLATION_FACTS: Readonly<Record<InterpolationKind, { label: string; describe: string; wrongWhen: string }>> =
  Object.freeze({
    nearest: {
      label: 'Nearest value',
      describe: 'Takes the y of whichever measured point is closest. The result is a staircase that never invents a value between two measurements.',
      wrongWhen: 'The underlying quantity is continuous — a staircase asserts that nothing changed until halfway to the next reading.'
    },
    linear: {
      label: 'Straight lines',
      describe: 'Joins consecutive points with straight segments. Never leaves the range of the data, and has a kink at every point.',
      wrongWhen: 'A slope is needed: the slope jumps at every measurement, so a derivative taken from this is meaningless.'
    },
    polynomial: {
      label: 'One polynomial through every point',
      describe: 'A single polynomial of degree one less than the number of points. Exact at every measurement.',
      wrongWhen: 'There are more than a handful of points. The curve oscillates hard near the ends, swinging far outside the data even though it passes exactly through it.'
    },
    'cubic-spline': {
      label: 'Cubic spline',
      describe: 'A separate cubic on each interval, joined so the value, slope and curvature all match. Smooth, and the usual choice for something that really is smooth.',
      wrongWhen: 'The data has a step or a plateau. A spline will overshoot it, producing values above the highest measurement or below the lowest.'
    },
    'monotone-cubic': {
      label: 'Monotone cubic',
      describe: 'A cubic on each interval with the slopes limited so the curve never turns back on itself between points. Smooth, and it cannot overshoot.',
      wrongWhen: 'The data has genuine peaks between measurements — the slope limiting will flatten them.'
    }
  })

/** One interval of a piecewise cubic: `y = a + b·t + c·t² + d·t³` with `t = x − x0`. */
export interface Segment {
  x0: number
  x1: number
  a: number
  b: number
  c: number
  d: number
}

/**
 * A built interpolant, as plain data.
 *
 * Deliberately not a function. This crosses the boundary between the engine and a Page as a value, so the Page can hold
 * it, show its caveats, and hand it back to be evaluated — none of which works if it is a closure.
 */
export interface Interpolant {
  kind: InterpolationKind
  x: readonly number[]
  y: readonly number[]
  /** Piecewise cubic coefficients, for the spline kinds. Empty otherwise. */
  segments: readonly Segment[]
  /** Newton divided-difference form, for the polynomial kind. Null otherwise. */
  newton: { coefficients: readonly number[]; nodes: readonly number[] } | null
  xMin: number
  xMax: number
  /** The range of the measurements themselves, for comparison against what the interpolant produces. */
  yMin: number
  yMax: number
  /**
   * How far outside the measured y range this interpolant actually goes, measured on a dense sample.
   *
   * Zero for linear, nearest and monotone cubic by construction. Measured rather than assumed for the other two,
   * because whether a spline overshoots depends on the data and not on the method.
   */
  overshoot: number
  describe: string
  caveats: readonly string[]
}

export interface InterpolantOptions {
  /** For 'cubic-spline': the slope to hold at each end. Omit for a natural spline, which sets end curvature to zero. */
  endSlopes?: readonly [number, number]
}

/** Solves a tridiagonal system by the Thomas algorithm. Returns null if it is singular. */
function solveTridiagonal(
  below: readonly number[],
  diagonal: readonly number[],
  above: readonly number[],
  right: readonly number[]
): number[] | null {
  const n = diagonal.length
  const c = [...above]
  const d = [...right]
  const diag = [...diagonal]
  for (let i = 1; i < n; i += 1) {
    const pivot = diag[i - 1] as number
    if (pivot === 0) return null
    const factor = (below[i] as number) / pivot
    diag[i] = (diag[i] as number) - factor * (c[i - 1] as number)
    d[i] = (d[i] as number) - factor * (d[i - 1] as number)
  }
  const out = new Array<number>(n).fill(0)
  const last = diag[n - 1]
  if (last === undefined || last === 0) return null
  out[n - 1] = (d[n - 1] as number) / last
  for (let i = n - 2; i >= 0; i -= 1) {
    const pivot = diag[i] as number
    if (pivot === 0) return null
    out[i] = ((d[i] as number) - (c[i] as number) * (out[i + 1] as number)) / pivot
  }
  return out
}

function naturalOrClampedSpline(x: readonly number[], y: readonly number[], endSlopes?: readonly [number, number]): Segment[] | FitError {
  const n = x.length
  const h: number[] = []
  for (let i = 0; i < n - 1; i += 1) h.push((x[i + 1] as number) - (x[i] as number))
  // Second derivatives at each node.
  const below = new Array<number>(n).fill(0)
  const diagonal = new Array<number>(n).fill(0)
  const above = new Array<number>(n).fill(0)
  const right = new Array<number>(n).fill(0)
  const slope = (i: number): number => ((y[i + 1] as number) - (y[i] as number)) / (h[i] as number)
  if (endSlopes === undefined) {
    diagonal[0] = 1
    diagonal[n - 1] = 1
  } else {
    diagonal[0] = 2 * (h[0] as number)
    above[0] = h[0] as number
    right[0] = 6 * (slope(0) - (endSlopes[0] as number))
    below[n - 1] = h[n - 2] as number
    diagonal[n - 1] = 2 * (h[n - 2] as number)
    right[n - 1] = 6 * ((endSlopes[1] as number) - slope(n - 2))
  }
  for (let i = 1; i < n - 1; i += 1) {
    below[i] = h[i - 1] as number
    diagonal[i] = 2 * ((h[i - 1] as number) + (h[i] as number))
    above[i] = h[i] as number
    right[i] = 6 * (slope(i) - slope(i - 1))
  }
  const second = solveTridiagonal(below, diagonal, above, right)
  if (second === null) return fail('no-fit', 'The spline system has no unique solution, which means the x values are too close together to tell apart.')
  const segments: Segment[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const hi = h[i] as number
    const mi = second[i] as number
    const mj = second[i + 1] as number
    segments.push({
      x0: x[i] as number,
      x1: x[i + 1] as number,
      a: y[i] as number,
      b: slope(i) - (hi * (2 * mi + mj)) / 6,
      c: mi / 2,
      d: (mj - mi) / (6 * hi)
    })
  }
  return segments
}

function monotoneSpline(x: readonly number[], y: readonly number[]): Segment[] {
  const n = x.length
  const h: number[] = []
  const delta: number[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const hi = (x[i + 1] as number) - (x[i] as number)
    h.push(hi)
    delta.push(((y[i + 1] as number) - (y[i] as number)) / hi)
  }
  const m = new Array<number>(n).fill(0)
  m[0] = delta[0] as number
  m[n - 1] = delta[n - 2] as number
  for (let i = 1; i < n - 1; i += 1) {
    const before = delta[i - 1] as number
    const now = delta[i] as number
    // A sign change means a turning point at the node, and a turning point has zero slope. Without this the curve
    // would carry the previous direction past the peak and overshoot it.
    m[i] = before * now <= 0 ? 0 : (before + now) / 2
  }
  // Fritsch–Carlson limiting: keep each pair of tangents inside the circle of radius 3, which is the condition for
  // the cubic on that interval to stay monotone.
  for (let i = 0; i < n - 1; i += 1) {
    const d = delta[i] as number
    if (d === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const alpha = (m[i] as number) / d
    const beta = (m[i + 1] as number) / d
    const distance = alpha * alpha + beta * beta
    if (distance > 9) {
      const tau = 3 / Math.sqrt(distance)
      m[i] = tau * alpha * d
      m[i + 1] = tau * beta * d
    }
  }
  const segments: Segment[] = []
  for (let i = 0; i < n - 1; i += 1) {
    const hi = h[i] as number
    const d = delta[i] as number
    const mi = m[i] as number
    const mj = m[i + 1] as number
    segments.push({
      x0: x[i] as number,
      x1: x[i + 1] as number,
      a: y[i] as number,
      b: mi,
      c: (3 * d - 2 * mi - mj) / hi,
      d: (mi - 2 * d + mj) / (hi * hi)
    })
  }
  return segments
}

/** Builds an interpolant through the points. Every evaluation of it is confined to the measured x range. */
export function interpolant(
  xInput: readonly (number | null | undefined)[],
  yInput: readonly (number | null | undefined)[],
  kind: InterpolationKind,
  options: InterpolantOptions = {}
): Interpolant | FitError {
  const points = checkPoints(xInput, yInput)
  if (isFitError(points)) return points
  if (!Object.prototype.hasOwnProperty.call(INTERPOLATION_FACTS, kind)) {
    return fail('invalid-argument', `There is no interpolation called "${kind}". The ones here are ${INTERPOLATION_KINDS.join(', ')}.`)
  }
  const { x, y } = points
  const n = x.length
  const needed = kind === 'nearest' ? 1 : kind === 'linear' || kind === 'polynomial' ? 2 : 3
  if (n < needed) {
    return fail('too-few', `${INTERPOLATION_FACTS[kind].label} needs at least ${needed} point${needed === 1 ? '' : 's'}; ${n} ${n === 1 ? 'was' : 'were'} given.`)
  }
  if (kind === 'polynomial' && n - 1 > MAXIMUM_INTERPOLATION_DEGREE) {
    return fail(
      'invalid-argument',
      `${n} points would need a degree-${n - 1} polynomial, and past degree ${MAXIMUM_INTERPOLATION_DEGREE} the curve oscillates wildly near the ends while still passing exactly through every point. Use a cubic spline for this many points, or fit a low-degree polynomial instead of interpolating with a high-degree one.`
    )
  }

  let segments: readonly Segment[] = []
  let newton: Interpolant['newton'] = null
  const caveats: string[] = []

  if (kind === 'cubic-spline') {
    if (options.endSlopes !== undefined) {
      const [a, b] = options.endSlopes
      if (!Number.isFinite(a) || !Number.isFinite(b)) return fail('not-finite', 'Both end slopes must be finite numbers.')
    }
    const built = naturalOrClampedSpline(x, y, options.endSlopes)
    if (isFitError(built)) return built
    segments = built
    caveats.push(
      options.endSlopes === undefined
        ? 'A natural spline: the curvature is set to zero at both ends. That is a choice, not a measurement — the data says nothing about how the curve behaves at its own edges.'
        : `The end slopes were held at ${options.endSlopes[0]} and ${options.endSlopes[1]} as given. Those came from outside the data.`
    )
  } else if (kind === 'monotone-cubic') {
    segments = monotoneSpline(x, y)
    caveats.push('The slopes are limited so the curve never turns back between two points. That guarantees no overshoot, and it will flatten a real peak that happens to fall between measurements.')
  } else if (kind === 'linear') {
    segments = x.slice(0, n - 1).map((x0, i) => ({
      x0,
      x1: x[i + 1] as number,
      a: y[i] as number,
      b: ((y[i + 1] as number) - (y[i] as number)) / ((x[i + 1] as number) - x0),
      c: 0,
      d: 0
    }))
    caveats.push('The slope jumps at every measurement, so a derivative taken from this interpolant is an artefact of where the measurements happen to be.')
  } else if (kind === 'polynomial') {
    // Newton's divided differences, kept in nested form rather than expanded into powers of x: expanding is where a
    // high-degree polynomial loses its accuracy to cancellation.
    const table = [...y]
    const coefficients: number[] = [table[0] as number]
    for (let level = 1; level < n; level += 1) {
      for (let i = n - 1; i >= level; i -= 1) {
        const numerator = (table[i] as number) - (table[i - 1] as number)
        const denominator = (x[i] as number) - (x[i - level] as number)
        table[i] = numerator / denominator
      }
      coefficients.push(table[level] as number)
    }
    newton = { coefficients, nodes: [...x] }
    caveats.push(`A single degree-${n - 1} polynomial through all ${n} points. It is exact at every measurement and says nothing reliable between the last two or the first two, where a polynomial of this degree swings hardest.`)
  } else {
    caveats.push('A staircase. Each value holds until halfway to the next measurement, then jumps — which asserts that nothing changed in between.')
  }

  const yMin = Math.min(...y)
  const yMax = Math.max(...y)
  const built: Interpolant = {
    kind,
    x,
    y,
    segments,
    newton,
    xMin: x[0] as number,
    xMax: x[n - 1] as number,
    yMin,
    yMax,
    overshoot: 0,
    describe: INTERPOLATION_FACTS[kind].describe,
    caveats
  }

  // Measure the overshoot rather than assume it. Whether a spline leaves the data's range depends on the data.
  let worst = 0
  if (n >= 2) {
    const samples = Math.min(2000, Math.max(200, n * 20))
    for (let i = 0; i <= samples; i += 1) {
      const at = (built.xMin as number) + ((built.xMax - built.xMin) * i) / samples
      const value = evaluateOne(built, at)
      if (value === null) continue
      if (value > yMax) worst = Math.max(worst, value - yMax)
      else if (value < yMin) worst = Math.max(worst, yMin - value)
    }
  }
  const range = yMax - yMin
  const withOvershoot: Interpolant = { ...built, overshoot: worst }
  const extra = [...caveats]
  if (worst > 0) {
    extra.push(
      range === 0
        ? `The curve leaves the measured y value by up to ${worst.toPrecision(3)}, even though every measurement is the same number.`
        : `The curve goes up to ${worst.toPrecision(3)} outside the measured range of y — that is ${((worst / range) * 100).toFixed(1)}% of the span of the data, at values nothing was measured at. Monotone cubic interpolation cannot do this if that matters.`
    )
  }
  if (points.reordered) extra.push('The points were given out of order and have been sorted by x. The interpolant is over sorted points, so any index in the result refers to the sorted order.')
  extra.push(`Defined only from x = ${built.xMin} to x = ${built.xMax}. Anything outside that is extrapolation, and this engine does not extrapolate.`)
  extra.push(INTERPOLATION_FACTS[kind].wrongWhen)
  return { ...withOvershoot, caveats: extra }
}

/** Evaluates an interpolant at one x, or null when x is outside the measured range. */
function evaluateOne(one: Interpolant, at: number): number | null {
  if (!Number.isFinite(at)) return null
  if (at < one.xMin || at > one.xMax) return null
  if (one.kind === 'nearest') {
    let best = 0
    let bestDistance = Infinity
    for (let i = 0; i < one.x.length; i += 1) {
      const distance = Math.abs((one.x[i] as number) - at)
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
      }
    }
    return one.y[best] ?? null
  }
  if (one.kind === 'polynomial') {
    const newton = one.newton
    if (newton === null) return null
    // Nested form, from the highest coefficient down.
    let value = newton.coefficients[newton.coefficients.length - 1] ?? 0
    for (let i = newton.coefficients.length - 2; i >= 0; i -= 1) {
      value = (newton.coefficients[i] as number) + (at - (newton.nodes[i] as number)) * value
    }
    return value
  }
  // Binary search for the segment containing `at`.
  let low = 0
  let high = one.segments.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((one.segments[middle]?.x0 as number) <= at) low = middle
    else high = middle - 1
  }
  const segment = one.segments[low]
  if (segment === undefined) return null
  const t = at - segment.x0
  return segment.a + t * (segment.b + t * (segment.c + t * segment.d))
}

export interface Evaluation {
  at: readonly number[]
  values: readonly number[]
  /** Requested points outside the measured range, which were not produced. */
  refusedOutside: readonly number[]
  why: string
}

/** Evaluates an interpolant, refusing every point outside the range the measurements cover. */
export function evaluateInterpolant(one: Interpolant, at: readonly number[]): Evaluation | FitError {
  const outTimes: number[] = []
  const outValues: number[] = []
  const refused: number[] = []
  for (const point of at) {
    if (!Number.isFinite(point)) return fail('not-finite', 'Every point to evaluate at must be a finite number.')
    if (point < one.xMin || point > one.xMax) {
      refused.push(point)
      continue
    }
    const value = evaluateOne(one, point)
    if (value === null || !Number.isFinite(value)) {
      return fail('no-fit', `The interpolant produced no finite value at x = ${point}.`)
    }
    outTimes.push(point)
    outValues.push(value)
  }
  return {
    at: outTimes,
    values: outValues,
    refusedOutside: refused,
    why: refused.length === 0
      ? `${outValues.length} value${outValues.length === 1 ? '' : 's'} from inside the measured range of x = ${one.xMin} to ${one.xMax}.`
      : `${refused.length} of the requested points fell outside the measured range of x = ${one.xMin} to ${one.xMax} and were not produced. A curve continued past its data is an assertion about a region nothing was measured in.`
  }
}

/** An evenly spaced sample of an interpolant, for drawing it. */
export function interpolationGrid(one: Interpolant, count: number): Evaluation | FitError {
  if (!Number.isInteger(count) || count < 2) return fail('invalid-argument', 'The grid needs at least 2 points.')
  if (count > 20_000) return fail('invalid-argument', 'A grid of more than 20000 points is refused; no chart resolves that.')
  const at: number[] = []
  for (let i = 0; i < count; i += 1) at.push(one.xMin + ((one.xMax - one.xMin) * i) / (count - 1))
  return evaluateInterpolant(one, at)
}

// ---------------------------------------------------------------- fitting a shape

export type Family = 'linear' | 'polynomial' | 'exponential' | 'power' | 'logarithmic' | 'reciprocal' | 'logistic'

export const FAMILIES: readonly Family[] = Object.freeze([
  'linear',
  'polynomial',
  'exponential',
  'power',
  'logarithmic',
  'reciprocal',
  'logistic'
])

export interface FamilyFacts {
  label: string
  form: string
  /** What the shape assumes about the thing being measured. */
  assumes: string
  /** The restriction on the data, if any. */
  requires: string | null
}

export const FAMILY_FACTS: Readonly<Record<Family, FamilyFacts>> = Object.freeze({
  linear: { label: 'Straight line', form: 'y = a + b·x', assumes: 'A fixed change in y for each unit of x, everywhere in the range.', requires: null },
  polynomial: { label: 'Polynomial', form: 'y = a₀ + a₁·x + … + aₙ·xⁿ', assumes: 'A smooth curve with as many turns as the degree allows. A higher degree always fits better and does not always describe better.', requires: null },
  exponential: { label: 'Exponential', form: 'y = a·e^(b·x)', assumes: 'A fixed proportional change in y for each unit of x — doubling every so often, rather than growing by a fixed amount.', requires: 'Every y must be above zero, or all below zero, because an exponential never crosses zero.' },
  power: { label: 'Power law', form: 'y = a·x^b', assumes: 'A fixed proportional change in y for each proportional change in x. Straight on a log–log plot.', requires: 'Every x and every y must be above zero.' },
  logarithmic: { label: 'Logarithmic', form: 'y = a + b·ln(x)', assumes: 'Diminishing returns: each doubling of x adds the same amount to y.', requires: 'Every x must be above zero.' },
  reciprocal: { label: 'Reciprocal', form: 'y = a + b/x', assumes: 'y approaches a fixed level as x grows, and runs away near x = 0.', requires: 'No x may be zero.' },
  logistic: { label: 'Logistic', form: 'y = L / (1 + e^(−b·(x − m)))', assumes: 'Growth that starts slowly, accelerates, then levels off at a ceiling. The ceiling must be supplied — it cannot be read off data that has not reached it.', requires: 'A ceiling must be given, and every y must be strictly between zero and that ceiling.' }
})

export interface Parameter {
  name: string
  value: number
}

export interface Fit {
  family: Family
  /** For a polynomial. Null for every other family. */
  degree: number | null
  parameters: readonly Parameter[]
  /** The fitted relationship, written out with the numbers in it. */
  equation: string
  predicted: readonly number[]
  residuals: readonly number[]
  /**
   * Fraction of the variation in y accounted for, computed on the original scale of y in every case.
   *
   * This matters for the transformed families. An exponential fitted through log y has an excellent R² *in log space*
   * and reporting that number as if it described y is a way of overstating the fit by a wide margin.
   */
  rSquared: number
  adjustedRSquared: number
  rootMeanSquaredError: number
  count: number
  /** How many numbers the fit estimated. Needed to compare fits of different complexity honestly. */
  parameterCount: number
  /** True when the fit was found by fitting a straight line to a transform of the data. */
  viaTransform: boolean
  caveats: readonly string[]
}

export interface FitOptions {
  /** Required for the polynomial family. */
  degree?: number
  /** Required for the logistic family: the ceiling the curve levels off at. */
  ceiling?: number
}

function straightLine(x: readonly number[], y: readonly number[]): { intercept: number; slope: number } | FitError {
  const result = regress([x], y)
  if (isStatisticsError(result)) return fail('no-fit', result.message)
  return { intercept: result.intercept, slope: result.coefficients[0] ?? 0 }
}

/**
 * Fits a named shape to the points.
 *
 * The transformed families — exponential, power, logarithmic, logistic — are fitted by taking a logarithm and fitting a
 * straight line, which is exact and fast. It is also a different fit from minimising the error in y: a log transform
 * gives equal weight to equal *proportional* errors, so the small values pull on the answer as hard as the large ones.
 * That is often what is wanted for growth data, and it is never invisible here — `viaTransform` says it happened and a
 * caveat says what it means.
 */
export function fit(
  xInput: readonly (number | null | undefined)[],
  yInput: readonly (number | null | undefined)[],
  family: Family,
  options: FitOptions = {}
): Fit | FitError {
  const points = checkPoints(xInput, yInput)
  if (isFitError(points)) return points
  if (!Object.prototype.hasOwnProperty.call(FAMILY_FACTS, family)) {
    return fail('invalid-argument', `There is no family called "${family}". The ones here are ${FAMILIES.join(', ')}.`)
  }
  const { x, y } = points
  const n = x.length

  let parameters: Parameter[] = []
  let equation = ''
  let predictAt: (at: number) => number
  let viaTransform = false
  let degree: number | null = null
  const caveats: string[] = []
  const round = (value: number): string => Number(value.toPrecision(6)).toString()

  switch (family) {
    case 'linear': {
      if (n < 2) return fail('too-few', 'A straight line needs at least 2 points.')
      const line = straightLine(x, y)
      if (isFitError(line)) return line
      parameters = [{ name: 'a', value: line.intercept }, { name: 'b', value: line.slope }]
      equation = `y = ${round(line.intercept)} + ${round(line.slope)}·x`
      predictAt = (at) => line.intercept + line.slope * at
      break
    }
    case 'polynomial': {
      const d = options.degree
      if (d === undefined) return fail('invalid-argument', 'A polynomial fit needs a degree.')
      if (!Number.isInteger(d) || d < 1) return fail('invalid-argument', 'The degree must be a whole number of at least 1.')
      if (d > 8) return fail('invalid-argument', 'A degree above 8 is refused: the normal equations become too ill-conditioned for the coefficients to mean anything.')
      if (n < d + 1) return fail('too-few', `A degree-${d} polynomial has ${d + 1} coefficients and needs at least that many points; ${n} were given.`)
      const columns: number[][] = []
      for (let power = 1; power <= d; power += 1) columns.push(x.map((one) => one ** power))
      const result = regress(columns, y)
      if (isStatisticsError(result)) return fail('no-fit', result.message)
      const all = [result.intercept, ...result.coefficients]
      degree = d
      parameters = all.map((value, i) => ({ name: `a${i}`, value }))
      equation = `y = ${all.map((value, i) => (i === 0 ? round(value) : `${round(value)}·x${i === 1 ? '' : `^${i}`}`)).join(' + ')}`
      predictAt = (at) => all.reduce((total, coefficient, i) => total + coefficient * at ** i, 0)
      if (n === d + 1) {
        caveats.push(`There are exactly as many points as coefficients, so this polynomial passes through every point and the residuals are zero by construction. An R² of 1 here says nothing at all about the shape being right.`)
      }
      if (d >= 4) caveats.push(`At degree ${d} the curve has enough freedom to follow the noise as well as the signal. Check it against a lower degree before believing the extra turns.`)
      break
    }
    case 'exponential': {
      if (n < 2) return fail('too-few', 'An exponential fit needs at least 2 points.')
      const allPositive = y.every((one) => one > 0)
      const allNegative = y.every((one) => one < 0)
      if (!allPositive && !allNegative) {
        return fail('domain', 'An exponential curve never crosses zero, so it cannot be fitted to y values of mixed sign or to any y that is exactly zero.')
      }
      const sign = allPositive ? 1 : -1
      const logs = y.map((one) => Math.log(Math.abs(one)))
      const line = straightLine(x, logs)
      if (isFitError(line)) return line
      const a = sign * Math.exp(line.intercept)
      const b = line.slope
      parameters = [{ name: 'a', value: a }, { name: 'b', value: b }]
      equation = `y = ${round(a)}·e^(${round(b)}·x)`
      predictAt = (at) => a * Math.exp(b * at)
      viaTransform = true
      if (b !== 0) {
        const doubling = Math.log(2) / Math.abs(b)
        caveats.push(`y ${b > 0 ? 'doubles' : 'halves'} every ${round(doubling)} in x. That is the fitted rate; whether the growth really is proportional is a question about the process, not about this fit.`)
      }
      break
    }
    case 'power': {
      if (n < 2) return fail('too-few', 'A power fit needs at least 2 points.')
      if (!x.every((one) => one > 0)) return fail('domain', 'A power law needs every x above zero, because it fits a line to the logarithm of x.')
      if (!y.every((one) => one > 0)) return fail('domain', 'A power law needs every y above zero, because it fits a line to the logarithm of y.')
      const line = straightLine(x.map((one) => Math.log(one)), y.map((one) => Math.log(one)))
      if (isFitError(line)) return line
      const a = Math.exp(line.intercept)
      const b = line.slope
      parameters = [{ name: 'a', value: a }, { name: 'b', value: b }]
      equation = `y = ${round(a)}·x^${round(b)}`
      predictAt = (at) => a * at ** b
      viaTransform = true
      caveats.push(`The exponent ${round(b)} says that doubling x multiplies y by ${round(2 ** b)}.`)
      break
    }
    case 'logarithmic': {
      if (n < 2) return fail('too-few', 'A logarithmic fit needs at least 2 points.')
      if (!x.every((one) => one > 0)) return fail('domain', 'A logarithmic curve needs every x above zero.')
      const line = straightLine(x.map((one) => Math.log(one)), y)
      if (isFitError(line)) return line
      parameters = [{ name: 'a', value: line.intercept }, { name: 'b', value: line.slope }]
      equation = `y = ${round(line.intercept)} + ${round(line.slope)}·ln(x)`
      predictAt = (at) => line.intercept + line.slope * Math.log(at)
      // x is transformed but y is not, so the error being minimised is still the error in y.
      caveats.push(`Each doubling of x changes y by ${round(line.slope * Math.LN2)}. The curve has no ceiling: it keeps rising, just ever more slowly.`)
      break
    }
    case 'reciprocal': {
      if (n < 2) return fail('too-few', 'A reciprocal fit needs at least 2 points.')
      if (x.some((one) => one === 0)) return fail('domain', 'A reciprocal curve has no value at x = 0.')
      const line = straightLine(x.map((one) => 1 / one), y)
      if (isFitError(line)) return line
      parameters = [{ name: 'a', value: line.intercept }, { name: 'b', value: line.slope }]
      equation = `y = ${round(line.intercept)} + ${round(line.slope)}/x`
      predictAt = (at) => line.intercept + line.slope / at
      caveats.push(`As x grows, y approaches ${round(line.intercept)}. That level is an extrapolation of the fitted shape, not something the data reached.`)
      break
    }
    case 'logistic': {
      if (n < 3) return fail('too-few', 'A logistic fit needs at least 3 points.')
      const ceiling = options.ceiling
      if (ceiling === undefined) {
        return fail(
          'invalid-argument',
          'A logistic fit needs the ceiling given. Estimating it from data that has not levelled off yet means the ceiling is whatever the curve happens to want, which is why it is asked for rather than guessed.'
        )
      }
      if (!Number.isFinite(ceiling) || ceiling <= 0) return fail('invalid-argument', 'The ceiling must be a positive finite number.')
      if (!y.every((one) => one > 0 && one < ceiling)) {
        return fail('domain', `Every y must be above 0 and below the ceiling of ${ceiling}. A logistic curve reaches its ceiling only in the limit, so a measurement at or above it cannot be on the curve.`)
      }
      const logits = y.map((one) => Math.log(one / (ceiling - one)))
      const line = straightLine(x, logits)
      if (isFitError(line)) return line
      const b = line.slope
      if (b === 0) return fail('no-fit', 'The fitted growth rate is zero, which is a flat line rather than a logistic curve.')
      const midpoint = -line.intercept / b
      parameters = [
        { name: 'L', value: ceiling },
        { name: 'b', value: b },
        { name: 'm', value: midpoint }
      ]
      equation = `y = ${round(ceiling)} / (1 + e^(−${round(b)}·(x − ${round(midpoint)})))`
      predictAt = (at) => ceiling / (1 + Math.exp(-b * (at - midpoint)))
      viaTransform = true
      const inRange = midpoint >= (x[0] as number) && midpoint <= (x[n - 1] as number)
      caveats.push(
        inRange
          ? `The steepest point is at x = ${round(midpoint)}, inside the measured range.`
          : `The steepest point is at x = ${round(midpoint)}, outside the measured range of ${x[0]} to ${x[n - 1]}. The fit is describing a bend the data has not reached.`
      )
      caveats.push(`The ceiling ${round(ceiling)} was supplied, not fitted. Every parameter here depends on it being right.`)
      break
    }
  }

  const predicted = x.map((one) => predictAt(one))
  if (predicted.some((one) => !Number.isFinite(one))) {
    return fail('no-fit', 'The fitted curve has no finite value at one of the measured x positions.')
  }
  const residuals = y.map((one, i) => one - (predicted[i] as number))
  let meanY = 0
  for (const one of y) meanY += one
  meanY /= n
  let totalSquares = 0
  let residualSquares = 0
  for (let i = 0; i < n; i += 1) {
    totalSquares += (y[i] as number - meanY) ** 2
    residualSquares += (residuals[i] as number) ** 2
  }
  const parameterCount = parameters.length - (family === 'logistic' ? 1 : 0)
  const rSquared = totalSquares === 0 ? (residualSquares === 0 ? 1 : 0) : 1 - residualSquares / totalSquares
  const degreesOfFreedom = n - parameterCount
  const adjustedRSquared =
    totalSquares === 0 || degreesOfFreedom <= 0
      ? rSquared
      : 1 - ((1 - rSquared) * (n - 1)) / degreesOfFreedom

  if (viaTransform) {
    caveats.push(
      'Fitted by taking a logarithm and fitting a straight line to it. That minimises proportional error rather than absolute error, so the small values pulled on this answer as hard as the large ones. It is usually the right choice for growth data and it is a different answer from minimising the error in y.'
    )
    caveats.push('The R² above is computed on the original scale of y, not on the log scale where the line was fitted. The log-scale figure would be higher and would describe the transform rather than the data.')
  }
  if (totalSquares === 0) {
    caveats.push('Every y is the same value, so there is no variation for a fit to account for and R² does not mean anything here.')
  }
  if (degreesOfFreedom <= 0) {
    caveats.push(`There are ${n} points and ${parameterCount} parameters, so there is nothing left over to check the fit against. The adjusted R² has been left equal to R² because it cannot be computed.`)
  }
  caveats.push(FAMILY_FACTS[family].assumes)
  caveats.push('R² measures how closely this shape follows the data. It does not say the shape is the right one — a wrong shape can follow data closely over a short range.')

  return {
    family,
    degree,
    parameters,
    equation,
    predicted,
    residuals,
    rSquared,
    adjustedRSquared,
    rootMeanSquaredError: Math.sqrt(residualSquares / n),
    count: n,
    parameterCount,
    viaTransform,
    caveats
  }
}

/** Evaluates a fit, which — unlike an interpolant — has no measured range to be confined to, so the caller is told. */
export function predictFrom(one: Fit, at: readonly number[]): { at: readonly number[]; values: readonly number[]; why: string } | FitError {
  const values: number[] = []
  for (const point of at) {
    if (!Number.isFinite(point)) return fail('not-finite', 'Every point must be a finite number.')
    let value: number
    switch (one.family) {
      case 'linear':
      case 'polynomial': {
        value = one.parameters.reduce((total, parameter, i) => total + parameter.value * point ** i, 0)
        break
      }
      case 'exponential': {
        const a = one.parameters[0]?.value ?? 0
        const b = one.parameters[1]?.value ?? 0
        value = a * Math.exp(b * point)
        break
      }
      case 'power': {
        if (point <= 0) return fail('domain', `A power law has no value at x = ${point}; it is defined only above zero.`)
        value = (one.parameters[0]?.value ?? 0) * point ** (one.parameters[1]?.value ?? 0)
        break
      }
      case 'logarithmic': {
        if (point <= 0) return fail('domain', `A logarithmic curve has no value at x = ${point}; it is defined only above zero.`)
        value = (one.parameters[0]?.value ?? 0) + (one.parameters[1]?.value ?? 0) * Math.log(point)
        break
      }
      case 'reciprocal': {
        if (point === 0) return fail('domain', 'A reciprocal curve has no value at x = 0.')
        value = (one.parameters[0]?.value ?? 0) + (one.parameters[1]?.value ?? 0) / point
        break
      }
      case 'logistic': {
        const ceiling = one.parameters[0]?.value ?? 0
        const b = one.parameters[1]?.value ?? 0
        const midpoint = one.parameters[2]?.value ?? 0
        value = ceiling / (1 + Math.exp(-b * (point - midpoint)))
        break
      }
    }
    if (!Number.isFinite(value)) return fail('no-fit', `The fit has no finite value at x = ${point}.`)
    values.push(value)
  }
  return {
    at: [...at],
    values,
    why: 'A fitted curve has a value everywhere its shape allows, including far outside the data it was fitted to. Those values are assertions about the shape continuing, not about anything measured.'
  }
}

// ---------------------------------------------------------------- residuals

export interface ResidualFinding {
  kind: 'curvature' | 'spread-changes' | 'serial-correlation' | 'extreme-residual'
  /** 'concern' means the finding contradicts something the fit assumes. 'note' means it is worth a look. */
  severity: 'note' | 'concern'
  detail: string
}

export interface ResidualOptions {
  /** The x each residual belongs to. Without it, "across the range" means "in the order given". */
  x?: readonly number[]
  /**
   * The size of the thing being predicted — the spread of y is the right number.
   *
   * Supplying it lets this function recognise residuals that are merely floating-point rounding around an exact fit,
   * and say so instead of finding patterns in them. `checkFit` works it out for you.
   */
  scale?: number
}

export interface ResidualCheck {
  findings: readonly ResidualFinding[]
  /** Near 2 means no serial correlation; near 0 means each residual resembles the one before it. Null when too few. */
  durbinWatson: number | null
  /** Runs of the same sign. Far fewer than expected means the residuals come in blocks, which a good fit's do not. */
  runs: { observed: number; expected: number; tooFew: boolean } | null
  largest: { index: number; residual: number; standardised: number } | null
  /** True when nothing was found. Not a claim that the model is right — only that the residuals did not object. */
  nothingFound: boolean
  why: string
}

/**
 * Looks for structure in the residuals.
 *
 * The point of the exercise: a fit's residuals should look like noise. If they curve, or fan out, or come in runs, the
 * shape is missing something the data contains — and that shows up here whether or not R² is high. A high R² with
 * curved residuals is a wrong model following data closely, which is the failure this function exists to catch.
 */
export function checkResiduals(residuals: readonly number[], options: ResidualOptions = {}): ResidualCheck | FitError {
  const n = residuals.length
  const x = options.x
  if (n === 0) return fail('empty', 'There are no residuals.')
  for (let i = 0; i < n; i += 1) {
    if (!Number.isFinite(residuals[i])) return fail('not-finite', `The residual at index ${i} is not a finite number.`)
  }
  if (x !== undefined && x.length !== n) {
    return fail('mismatched-length', `There are ${n} residuals and ${x.length} x values.`)
  }
  if (options.scale !== undefined && (!Number.isFinite(options.scale) || options.scale < 0)) {
    return fail('invalid-argument', 'The scale must be a non-negative finite number.')
  }
  let mean = 0
  for (const one of residuals) mean += one
  mean /= n
  let variance = 0
  for (const one of residuals) variance += (one - mean) ** 2
  const sd = Math.sqrt(variance / n)

  // An exact fit leaves residuals at the size of floating-point rounding. Those are not small errors to examine for
  // structure; they are the arithmetic's own noise, and every test below would be reading tea leaves in it. Without a
  // scale there is no way to tell 1e-13 meaning "exact" from 1e-13 meaning "tiny but real", which is why the guard
  // needs one and why `checkFit` supplies it.
  if (options.scale !== undefined && sd <= 1e-9 * options.scale) {
    return {
      findings: [],
      durbinWatson: null,
      runs: null,
      largest: null,
      nothingFound: true,
      why: `The residuals are at the level of floating-point rounding for data of this size, so the fit passes through the points as exactly as the arithmetic allows. There is no structure to look for: anything found in numbers this small would be the rounding, not the data.`
    }
  }

  const findings: ResidualFinding[] = []

  // Ordered by x when x is given, because a pattern is a pattern against something.
  const order = x === undefined ? residuals.map((_, i) => i) : residuals.map((_, i) => i).sort((a, b) => (x[a] as number) - (x[b] as number))
  const ordered = order.map((i) => residuals[i] as number)

  // Curvature: compare the middle third against the outer thirds. A fit that is missing a curve sits systematically
  // on one side in the middle and the other side at both ends.
  if (n >= 9 && sd > 0) {
    const third = Math.floor(n / 3)
    const meanOf = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length
    const first = meanOf(ordered.slice(0, third))
    const middle = meanOf(ordered.slice(third, n - third))
    const last = meanOf(ordered.slice(n - third))
    const bend = middle - (first + last) / 2
    // The standard error of that difference of means. Comparing the bend against its own uncertainty is what stops a
    // small dataset's ordinary scatter being reported as curvature.
    const standardError = sd * Math.sqrt(1 / (n - 2 * third) + 1 / (4 * third) + 1 / (4 * third))
    if (Math.abs(bend) > 2 * standardError && Math.abs(bend) > 0.5 * sd) {
      findings.push({
        kind: 'curvature',
        severity: 'concern',
        detail: `The residuals in the middle of the range sit ${Math.abs(bend).toPrecision(3)} ${bend > 0 ? 'above' : 'below'} the average of the two ends — about ${(Math.abs(bend) / sd).toFixed(1)} times their own spread. That is a curve the fitted shape is not following, so the shape is missing something rather than the data being noisy.`
      })
    }
  }

  // Spread: a fit that is right on average can still be much less certain at one end.
  if (n >= 10 && sd > 0) {
    const half = Math.floor(n / 2)
    const spreadOf = (xs: readonly number[]): number => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
    }
    const early = spreadOf(ordered.slice(0, half))
    const late = spreadOf(ordered.slice(half))
    if (early > 0 && late > 0) {
      const ratio = Math.max(early, late) / Math.min(early, late)
      if (ratio > 2) {
        findings.push({
          kind: 'spread-changes',
          severity: 'concern',
          detail: `The residuals are ${ratio.toFixed(1)} times as spread out in the ${late > early ? 'second' : 'first'} half of the range as in the other. A least-squares fit assumes the scatter is the same everywhere; where it is not, the half with more scatter pulled harder on the answer than it should have.`
        })
      }
    }
  }

  // Serial correlation, by Durbin–Watson and by counting runs of the same sign.
  let durbinWatson: number | null = null
  if (n >= 3 && variance > 0) {
    let differences = 0
    for (let i = 1; i < n; i += 1) differences += ((ordered[i] as number) - (ordered[i - 1] as number)) ** 2
    let squares = 0
    for (const one of ordered) squares += one * one
    if (squares > 0) {
      durbinWatson = differences / squares
      if (durbinWatson < 1.2) {
        findings.push({
          kind: 'serial-correlation',
          severity: 'concern',
          detail: `The Durbin–Watson statistic is ${durbinWatson.toFixed(2)}, well below the 2 that independent residuals give. Each residual resembles the one before it, which means the fit is drifting through the data rather than scattering around it.`
        })
      }
    }
  }

  let runs: ResidualCheck['runs'] = null
  const positive = ordered.filter((one) => one > 0).length
  const negative = ordered.filter((one) => one < 0).length
  if (positive > 0 && negative > 0) {
    let observed = 1
    let previous = (ordered[0] as number) > 0
    for (let i = 1; i < n; i += 1) {
      const now = (ordered[i] as number) > 0
      if (now !== previous) {
        observed += 1
        previous = now
      }
    }
    const expected = (2 * positive * negative) / (positive + negative) + 1
    const tooFew = observed < expected / 2
    runs = { observed, expected, tooFew }
    if (tooFew) {
      findings.push({
        kind: 'serial-correlation',
        severity: 'concern',
        detail: `The residuals change sign only ${observed - 1} time${observed - 1 === 1 ? '' : 's'} where about ${(expected - 1).toFixed(1)} would be expected from scatter. They come in blocks, which is what a systematically wrong shape looks like.`
      })
    }
  }

  let largest: ResidualCheck['largest'] = null
  if (sd > 0) {
    let worst = 0
    for (let i = 1; i < n; i += 1) {
      if (Math.abs(residuals[i] as number) > Math.abs(residuals[worst] as number)) worst = i
    }
    const standardised = (residuals[worst] as number) / sd
    largest = { index: worst, residual: residuals[worst] as number, standardised }
    if (Math.abs(standardised) > 3) {
      findings.push({
        kind: 'extreme-residual',
        severity: 'note',
        detail: `The point at index ${worst} sits ${Math.abs(standardised).toFixed(1)} residual standard deviations from the curve. That is worth looking at — it may be a mistake in the data, or the one point that shows the shape is wrong. It is flagged, not removed.`
      })
    }
  }

  const nothingFound = findings.length === 0
  return {
    findings,
    durbinWatson,
    runs,
    largest,
    nothingFound,
    why: nothingFound
      ? `No curvature, no change in spread, no run structure and no extreme point in ${n} residuals. The residuals did not object to this fit. That is weaker than the fit being right: these checks can only find the problems they look for.`
      : `${findings.length} thing${findings.length === 1 ? '' : 's'} found in the residuals. Each one is a way the fitted shape differs from the data systematically rather than randomly, and none of them shows up in R².`
  }
}

/**
 * Checks a fit's residuals, working out the scale from the fit itself.
 *
 * Prefer this over calling `checkResiduals` directly. It is the same examination with one thing supplied that the
 * caller would otherwise have to remember: how large the numbers being fitted are, without which an exact fit's
 * rounding noise is indistinguishable from real small residuals.
 */
export function checkFit(one: Fit, x?: readonly number[]): ResidualCheck | FitError {
  const y = one.predicted.map((value, i) => value + (one.residuals[i] ?? 0))
  const spread = Math.max(...y) - Math.min(...y)
  let magnitude = 0
  for (const value of y) magnitude = Math.max(magnitude, Math.abs(value))
  // A flat y has no spread, so fall back to how large the values themselves are.
  const scale = spread > 0 ? spread : magnitude
  return checkResiduals(one.residuals, { x, scale })
}

// ---------------------------------------------------------------- comparing fits

export interface ComparisonEntry {
  family: Family
  degree: number | null
  label: string
  rSquared: number
  adjustedRSquared: number
  rootMeanSquaredError: number
  parameterCount: number
}

export interface FitComparison {
  entries: readonly ComparisonEntry[]
  /** Ranked by adjusted R², which at least charges for extra parameters. Ranked, not judged. */
  ranked: readonly string[]
  /** Groups of fits whose adjusted R² differ by less than the threshold — the data cannot separate these. */
  indistinguishable: readonly (readonly string[])[]
  /**
   * Always null.
   *
   * Present so that a caller looking for a winner finds this field and the sentence attached to it, rather than
   * reaching for `ranked[0]` and calling it the answer.
   */
  best: null
  why: string
  caveats: readonly string[]
}

/** How close two adjusted R² values have to be before the data is treated as unable to separate them. */
export const INDISTINGUISHABLE_WITHIN = 0.01

/**
 * Lays several fits side by side without naming a winner.
 *
 * Choosing between shapes is not a statistical operation. The shape that fits best over the measured range is often the
 * one with the most parameters, and it is regularly the wrong description of the process — which shows up only outside
 * the range, where the choice actually matters. So this ranks, groups the ones the data cannot separate, and leaves the
 * decision where it belongs.
 */
export function compareFits(fits: readonly Fit[]): FitComparison | FitError {
  if (fits.length === 0) return fail('empty', 'There are no fits to compare.')
  const counts = new Set(fits.map((one) => one.count))
  const entries: ComparisonEntry[] = fits.map((one) => ({
    family: one.family,
    degree: one.degree,
    label: one.degree === null ? FAMILY_FACTS[one.family].label : `${FAMILY_FACTS[one.family].label} (degree ${one.degree})`,
    rSquared: one.rSquared,
    adjustedRSquared: one.adjustedRSquared,
    rootMeanSquaredError: one.rootMeanSquaredError,
    parameterCount: one.parameterCount
  }))
  const sorted = [...entries].sort((a, b) => b.adjustedRSquared - a.adjustedRSquared)
  const groups: string[][] = []
  let current: ComparisonEntry[] = []
  for (const entry of sorted) {
    const head = current[0]
    if (head !== undefined && Math.abs(head.adjustedRSquared - entry.adjustedRSquared) < INDISTINGUISHABLE_WITHIN) {
      current.push(entry)
    } else {
      if (current.length > 1) groups.push(current.map((one) => one.label))
      current = [entry]
    }
  }
  if (current.length > 1) groups.push(current.map((one) => one.label))

  const caveats: string[] = [
    'Ranked by adjusted R², which charges for each extra parameter. It is still a measure of agreement over the measured range, and the shape that agrees best there can be the wrong description of the process.',
    'Nothing here is a winner. Two shapes with the same R² can disagree completely about what happens outside the data, and that disagreement is usually what the choice is actually about.'
  ]
  if (counts.size > 1) {
    caveats.push(`These fits were made on different numbers of points (${[...counts].sort((a, b) => a - b).join(', ')}). R² figures from different data are not comparable, and this ranking should be ignored until they are fitted to the same points.`)
  }
  const transformed = fits.filter((one) => one.viaTransform).map((one) => FAMILY_FACTS[one.family].label)
  if (transformed.length > 0 && transformed.length < fits.length) {
    caveats.push(`${transformed.join(' and ')} ${transformed.length === 1 ? 'was' : 'were'} fitted through a logarithm, so ${transformed.length === 1 ? 'it minimises' : 'they minimise'} proportional error while the others minimise absolute error. They are answers to slightly different questions placed in one table.`)
  }
  if (groups.length > 0) {
    caveats.push(`Some of these are within ${INDISTINGUISHABLE_WITHIN} adjusted R² of each other. On this data they are equally good, and choosing between them needs a reason from outside the data.`)
  }

  return {
    entries,
    ranked: sorted.map((one) => one.label),
    indistinguishable: groups,
    best: null,
    why: `${entries.length} fit${entries.length === 1 ? '' : 's'} compared. The ranking is by adjusted R²; no winner is named, because which shape is right is a question about the process rather than about the numbers.`,
    caveats
  }
}
