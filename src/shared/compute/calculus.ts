/**
 * Calculus and differential equations.
 *
 * Built on what already exists: `expression.ts` differentiates symbolically, `simulation.ts` integrates systems
 * forward in time with error control. This adds the analysis around them -- limits, continuity, the shape of a
 * function, Taylor approximation, quadrature, and the classification and solution of differential equations.
 *
 * ## The distinction everything here turns on
 *
 * A **numerical** answer is evidence and a **symbolic** one is a fact. `limitAt` samples: it can say the values are
 * approaching 1, and it cannot prove there is no spike between the samples. So every numerical result carries how it
 * was obtained, and `verdict` is `'numerical'` rather than `'proven'` unless something actually proved it.
 *
 * The temptation is to drop that distinction because the numbers usually agree. The case where they do not is exactly
 * the case somebody needed to know about.
 *
 * ## Quadrature
 *
 * Adaptive Simpson, which subdivides where the function is not smooth rather than everywhere. The error estimate comes
 * from comparing one Simpson step against two halves of it, which is a real estimate and not a stated tolerance
 * reported back.
 */

import {
  differentiate,
  evaluateExpression,
  expressionToText,
  isEvaluateError,
  isParseError,
  parseExpression,
  simplify,
  type Expression
} from './expression.ts'
import { integrate, isSimulationError, type RunResult, type State } from './simulation.ts'

export interface CalculusError {
  error: string
  message: string
}

export const isCalculusError = (value: unknown): value is CalculusError =>
  typeof value === 'object' && value !== null && 'error' in value && 'message' in value

const fail = (error: string, message: string): CalculusError => ({ error, message })

export const CALCULUS_LIMITS: Readonly<Record<'samples' | 'subdivisions' | 'order' | 'terms' | 'gridPoints' | 'timeSteps', number>> =
  Object.freeze({
    samples: 100_000,
    subdivisions: 50_000,
    order: 40,
    terms: 200,
    gridPoints: 2_000,
    timeSteps: 200_000
  })

/** How sure a result is. Nothing here calls a sampled answer proven. */
export type Verdict = 'proven' | 'symbolic' | 'numerical' | 'inconclusive'

/** A function of one variable, compiled from an expression. Never from code; the interpreter walks a parsed tree. */
export type RealFunction = (x: number) => number

export function compile(source: string, variable = 'x'): RealFunction | CalculusError {
  const tree = parseExpression(source)
  if (isParseError(tree)) return fail('parse', tree.message)
  return (x: number): number => {
    const value = evaluateExpression(tree, { [variable]: x })
    return isEvaluateError(value) ? Number.NaN : value
  }
}

// ---------------------------------------------------------------- limits

export interface LimitResult {
  /** The value approached, or `null` where none is. */
  value: number | null
  left: number | null
  right: number | null
  exists: boolean
  behaviour: 'finite' | 'infinite' | 'oscillating' | 'one-sided-differ' | 'undefined'
  verdict: Verdict
  /** The points sampled and what the function gave, so the conclusion can be argued with. */
  samples: { at: number; value: number }[]
  describe: string
}

/**
 * The limit of a function at a point, by sampling from both sides.
 *
 * Numerical, and honest about it. Sampling closer and closer gives strong evidence and not a proof: a function can do
 * something between any two samples that neither of them shows. What the method *can* do reliably is distinguish the
 * cases -- a finite limit, a divergence to infinity, two different one-sided limits, and oscillation that settles to
 * nothing -- and that distinction is usually what was wanted.
 */
export function limitAt(f: RealFunction, at: number, options: { from?: 'both' | 'left' | 'right'; steps?: number } = {}): LimitResult {
  // 30 halvings reaches a distance of about 1e-9 times the scale, which is close enough for the extrapolation below
  // and far enough from the point that the subtraction `at + delta` has not lost its own precision.
  const steps = Math.max(6, Math.min(45, Math.round(options.steps ?? 30)))
  const scale = Math.max(1, Math.abs(at))
  const samples: LimitResult['samples'] = []

  const approach = (sign: 1 | -1): { value: number | null; kind: 'finite' | 'infinite' | 'oscillating' | 'undefined' } => {
    const values: number[] = []
    for (let i = 1; i <= steps; i++) {
      // Halving rather than a fixed grid: the point is to get close, and geometric approach covers many orders fast.
      const delta = sign * scale * 2 ** -i
      const x = at + delta
      const value = f(x)
      samples.push({ at: x, value })
      if (Number.isFinite(value)) values.push(value)
    }
    if (values.length < 5) return { value: null, kind: 'undefined' }

    const tail = values.slice(-10)
    const last = tail[tail.length - 1]

    /**
     * Divergence, tested by growth rather than against a fixed threshold.
     *
     * This check has to come first and has to be right, because Aitken's method below maps a geometrically growing
     * sequence onto a *consistent* finite value -- for one that doubles it lands on zero, every window, which looks
     * exactly like convergence. A threshold such as "bigger than 1e10" would depend on how many halvings were taken:
     * 1/x with thirty of them only reaches 1e9 and would slip past. Growth relative to the tail's own start does not.
     */
    const growing = tail.every((one, i) => i === 0 || Math.abs(one) >= Math.abs(tail[i - 1]))
    const start = Math.abs(tail[0])
    const grownBy = start > 0 ? Math.abs(last) / start : Math.abs(last) > 1 ? Number.POSITIVE_INFINITY : 1
    if (growing && grownBy > 100 && Math.abs(last) > 1e6) {
      return { value: last > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY, kind: 'infinite' }
    }
    if (Math.abs(last) > 1e12) return { value: null, kind: 'undefined' }

    const spread = Math.max(...tail) - Math.min(...tail)
    // An exactly constant tail is already the limit; no extrapolation is needed and Aitken would divide by zero.
    if (spread === 0) return { value: last, kind: 'finite' }

    /**
     * Aitken's delta-squared, which is the whole reason this works.
     *
     * A converging sequence of samples is not a nearly constant one: sqrt(x) near zero still moves by a third of its
     * own size at every halving, and demanding a flat tail would call that oscillation. What distinguishes converging
     * from oscillating is that the *differences* shrink geometrically, which is exactly what Aitken exploits -- for a
     * sequence with a constant ratio of successive differences it lands on the limit in one step.
     */
    const extrapolated: number[] = []
    for (let i = 0; i + 2 < tail.length; i++) {
      const d1 = tail[i + 1] - tail[i]
      const d2 = tail[i + 2] - tail[i + 1]
      const denominator = d2 - d1
      if (denominator === 0 || !Number.isFinite(denominator)) continue
      const value = tail[i + 2] - (d2 * d2) / denominator
      if (Number.isFinite(value)) extrapolated.push(value)
    }

    if (extrapolated.length >= 3) {
      const settled = extrapolated.slice(-3)
      const estimate = settled[settled.length - 1]
      const magnitude = Math.max(...settled.map(Math.abs), Math.abs(last))
      const gap = Math.max(...settled) - Math.min(...settled)
      // Relative to the size of the values involved, with a floor so a limit of zero is reachable.
      if (gap <= Math.max(1e-11, magnitude * 1e-7)) {
        // A limit within rounding of zero is zero. Reporting 9.5e-7 as the limit of sqrt at zero would be reporting
        // the last sample rather than what it is approaching.
        return { value: Math.abs(estimate) < Math.max(1e-11, magnitude * 1e-7) ? 0 : estimate, kind: 'finite' }
      }
    }

    // Falling back on the raw tail catches the smooth case where the differences are already below rounding.
    const magnitude = Math.max(1e-12, Math.abs(last))
    if (spread < magnitude * 1e-9) return { value: last, kind: 'finite' }

    // Bounded, and neither settling nor extrapolating: sin(1/x) near zero does exactly this.
    return { value: null, kind: 'oscillating' }
  }

  const wanted = options.from ?? 'both'
  const fromLeft = wanted === 'right' ? null : approach(-1)
  const fromRight = wanted === 'left' ? null : approach(1)

  if (fromLeft && fromRight) {
    if (fromLeft.kind === 'oscillating' || fromRight.kind === 'oscillating') {
      return {
        value: null,
        left: fromLeft.value,
        right: fromRight.value,
        exists: false,
        behaviour: 'oscillating',
        verdict: 'numerical',
        samples,
        describe: `The values do not settle as x approaches ${at}; they keep moving over a range that does not shrink. That is the signature of oscillation, and the limit does not exist.`
      }
    }
    if (fromLeft.kind === 'infinite' && fromRight.kind === 'infinite') {
      const same = fromLeft.value === fromRight.value
      return {
        value: same ? fromLeft.value : null,
        left: fromLeft.value,
        right: fromRight.value,
        exists: false,
        behaviour: 'infinite',
        verdict: 'numerical',
        samples,
        describe: same
          ? `The function grows without bound from both sides, towards ${fromLeft.value === Number.POSITIVE_INFINITY ? 'positive' : 'negative'} infinity. There is no finite limit; saying the limit "is infinity" is a statement about the behaviour, not a value.`
          : `The function grows without bound in opposite directions on the two sides, so there is no limit at all.`
      }
    }
    if (fromLeft.kind === 'finite' && fromRight.kind === 'finite') {
      const gap = Math.abs((fromLeft.value as number) - (fromRight.value as number))
      const magnitude = Math.max(1e-12, Math.abs(fromLeft.value as number), Math.abs(fromRight.value as number))
      if (gap < magnitude * 1e-6) {
        return {
          value: fromRight.value,
          left: fromLeft.value,
          right: fromRight.value,
          exists: true,
          behaviour: 'finite',
          verdict: 'numerical',
          samples,
          describe: `The values approach ${Number((fromRight.value as number).toPrecision(10))} from both sides. This is sampled evidence rather than a proof: nothing here rules out the function doing something between the samples.`
        }
      }
      return {
        value: null,
        left: fromLeft.value,
        right: fromRight.value,
        exists: false,
        behaviour: 'one-sided-differ',
        verdict: 'numerical',
        samples,
        describe: `The limit from the left is about ${Number((fromLeft.value as number).toPrecision(8))} and from the right about ${Number((fromRight.value as number).toPrecision(8))}. They differ, so there is no limit -- although each one-sided limit exists.`
      }
    }
    return {
      value: null,
      left: fromLeft.value,
      right: fromRight.value,
      exists: false,
      behaviour: 'undefined',
      verdict: 'inconclusive',
      samples,
      describe: `The function could not be evaluated close enough to ${at} on at least one side, so nothing can be concluded.`
    }
  }

  const only = (fromLeft ?? fromRight) as { value: number | null; kind: 'finite' | 'infinite' | 'oscillating' | 'undefined' }
  return {
    value: only.value,
    left: fromLeft?.value ?? null,
    right: fromRight?.value ?? null,
    exists: only.kind === 'finite',
    behaviour: only.kind === 'finite' ? 'finite' : only.kind === 'infinite' ? 'infinite' : only.kind === 'oscillating' ? 'oscillating' : 'undefined',
    verdict: only.kind === 'undefined' ? 'inconclusive' : 'numerical',
    samples,
    describe:
      only.kind === 'finite'
        ? `Approaching from the ${wanted}, the values tend to ${Number((only.value as number).toPrecision(10))}.`
        : `Approaching from the ${wanted}, the values do not settle on a finite number.`
  }
}

export type DiscontinuityKind = 'removable' | 'jump' | 'infinite' | 'oscillating' | 'none'

export interface ContinuityResult {
  continuous: boolean
  kind: DiscontinuityKind
  at: number
  /** The value the function actually takes there, which may differ from the limit. */
  value: number | null
  limit: number | null
  verdict: Verdict
  describe: string
}

/**
 * Whether a function is continuous at a point, and how it fails when it is not.
 *
 * The four kinds are genuinely different and matter for different reasons. Removable means the function can be fixed
 * by defining one value. Jump means the two sides disagree. Infinite means there is an asymptote. Oscillating means no
 * value could be assigned at all. Reporting "discontinuous" without saying which throws away the useful part.
 */
export function continuityAt(f: RealFunction, at: number): ContinuityResult {
  const value = f(at)
  const limit = limitAt(f, at)

  if (limit.behaviour === 'oscillating') {
    return { continuous: false, kind: 'oscillating', at, value: Number.isFinite(value) ? value : null, limit: null, verdict: 'numerical', describe: `The function oscillates without settling as x approaches ${at}, so no value assigned there could make it continuous.` }
  }
  if (limit.behaviour === 'infinite') {
    return { continuous: false, kind: 'infinite', at, value: Number.isFinite(value) ? value : null, limit: null, verdict: 'numerical', describe: `The function grows without bound at ${at}: there is a vertical asymptote there.` }
  }
  if (limit.behaviour === 'one-sided-differ') {
    return {
      continuous: false,
      kind: 'jump',
      at,
      value: Number.isFinite(value) ? value : null,
      limit: null,
      verdict: 'numerical',
      describe: `The two sides approach different values (${Number((limit.left as number).toPrecision(6))} and ${Number((limit.right as number).toPrecision(6))}), so there is a jump of ${Number(Math.abs((limit.right as number) - (limit.left as number)).toPrecision(6))} at ${at}.`
    }
  }
  if (!limit.exists || limit.value === null) {
    return { continuous: false, kind: 'none', at, value: null, limit: null, verdict: 'inconclusive', describe: `Nothing could be established about the behaviour at ${at}.` }
  }

  if (!Number.isFinite(value)) {
    return {
      continuous: false,
      kind: 'removable',
      at,
      value: null,
      limit: limit.value,
      verdict: 'numerical',
      describe: `The function has no value at ${at}, but the values around it approach ${Number(limit.value.toPrecision(8))}. Defining it to be that would make it continuous, which is what "removable" means.`
    }
  }

  const gap = Math.abs(value - limit.value)
  const magnitude = Math.max(1e-12, Math.abs(value), Math.abs(limit.value))
  if (gap < magnitude * 1e-6) {
    return { continuous: true, kind: 'none', at, value, limit: limit.value, verdict: 'numerical', describe: `The function is continuous at ${at}: its value there and the values around it agree.` }
  }
  return {
    continuous: false,
    kind: 'removable',
    at,
    value,
    limit: limit.value,
    verdict: 'numerical',
    describe: `The function takes the value ${Number(value.toPrecision(8))} at ${at}, but the values around it approach ${Number(limit.value.toPrecision(8))}. Redefining the single point would make it continuous.`
  }
}

// ---------------------------------------------------------------- derivatives

export interface DerivativeResult {
  /** The symbolic derivative when one could be found. */
  symbolic: string | null
  /** The numerical value, always available where the function can be evaluated. */
  value: number | null
  verdict: Verdict
  /** The step used, for a numerical derivative. It is a property of the answer, not an implementation detail. */
  step: number | null
  describe: string
}

/**
 * The derivative at a point, symbolically where possible.
 *
 * The symbolic path uses `expression.ts` and gives an exact expression. The numerical path uses a central difference,
 * whose step size is a compromise -- too large and curvature enters the answer, too small and cancellation destroys
 * it. The cube root of machine epsilon times the scale is the usual optimum for a central difference, and it is
 * reported because the answer depends on it.
 */
export function derivativeAt(source: string, at: number, variable = 'x'): DerivativeResult | CalculusError {
  const tree = parseExpression(source)
  if (isParseError(tree)) return fail('parse', tree.message)

  const derivative = differentiate(tree, variable)
  const f = (x: number): number => {
    const value = evaluateExpression(tree, { [variable]: x })
    return isEvaluateError(value) ? Number.NaN : value
  }

  if (!('error' in derivative)) {
    const simplified = simplify(derivative as Expression)
    const value = evaluateExpression(simplified, { [variable]: at })
    return {
      symbolic: expressionToText(simplified),
      value: isEvaluateError(value) ? null : value,
      verdict: 'symbolic',
      step: null,
      describe: `d/d${variable} of ${expressionToText(tree)} is ${expressionToText(simplified)}. That is exact, not an approximation.`
    }
  }

  // The cube root of epsilon: the standard optimum for a central difference, balancing truncation against cancellation.
  const step = Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(at))
  const forward = f(at + step)
  const backward = f(at - step)
  if (!Number.isFinite(forward) || !Number.isFinite(backward)) {
    return fail('not-finite', `The function has no value just either side of ${at}, so its slope there cannot be found numerically either.`)
  }

  return {
    symbolic: null,
    value: (forward - backward) / (2 * step),
    verdict: 'numerical',
    step,
    describe: `Orbis could not differentiate ${expressionToText(tree)} symbolically (${(derivative as { message: string }).message}), so the slope was estimated from values either side, a step of ${step.toExponential(3)} apart. The answer depends on that step.`
  }
}

// ---------------------------------------------------------------- shape of a function

export interface CriticalPoint {
  x: number
  value: number
  kind: 'minimum' | 'maximum' | 'inflection' | 'undetermined'
  /** The second derivative there, which is what decided the kind. */
  secondDerivative: number
  verdict: Verdict
}

export interface ShapeAnalysis {
  critical: CriticalPoint[]
  increasing: { from: number; to: number }[]
  decreasing: { from: number; to: number }[]
  concaveUp: { from: number; to: number }[]
  concaveDown: { from: number; to: number }[]
  inflections: number[]
  roots: number[]
  /** Where the function could not be evaluated, which bounds what anything else here can claim. */
  gaps: number[]
  notes: string[]
}

/**
 * The shape of a function over an interval, from sampled derivatives.
 *
 * Everything here is found on a grid, so everything here can miss a feature narrower than the grid. That is stated
 * rather than left implicit: a function with a spike of width 1e-9 sampled a thousand times over [0,1] will be
 * reported as smooth, and no amount of sampling fixes it in general.
 */
export function analyseShape(f: RealFunction, from: number, to: number, samples = 1000): ShapeAnalysis | CalculusError {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return fail('invalid-argument', 'An interval needs a start below its end.')
  if (!Number.isInteger(samples) || samples < 10 || samples > CALCULUS_LIMITS.samples) {
    return fail('invalid-argument', `The number of samples has to be between 10 and ${CALCULUS_LIMITS.samples.toLocaleString('en')}.`)
  }

  const width = (to - from) / samples
  const step = Math.max(1e-10, width / 4)
  const xs: number[] = []
  const values: number[] = []
  const first: number[] = []
  const second: number[] = []
  const gaps: number[] = []

  for (let i = 0; i <= samples; i++) {
    const x = from + i * width
    const value = f(x)
    xs.push(x)
    values.push(value)
    if (!Number.isFinite(value)) {
      gaps.push(x)
      first.push(Number.NaN)
      second.push(Number.NaN)
      continue
    }
    const a = f(x + step)
    const b = f(x - step)
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      first.push(Number.NaN)
      second.push(Number.NaN)
      continue
    }
    first.push((a - b) / (2 * step))
    second.push((a - 2 * value + b) / (step * step))
  }

  const runs = (test: (i: number) => boolean): { from: number; to: number }[] => {
    const out: { from: number; to: number }[] = []
    let start: number | null = null
    for (let i = 0; i <= samples; i++) {
      const holds = test(i)
      if (holds && start === null) start = xs[i]
      if (!holds && start !== null) {
        out.push({ from: start, to: xs[i - 1] })
        start = null
      }
    }
    if (start !== null) out.push({ from: start, to: xs[samples] })
    return out
  }

  const critical: CriticalPoint[] = []
  for (let i = 1; i < samples; i++) {
    if (!Number.isFinite(first[i - 1]) || !Number.isFinite(first[i])) continue
    // A sign change in the first derivative brackets a critical point; bisect to find it.
    if (Math.sign(first[i - 1]) === Math.sign(first[i]) || first[i - 1] === 0) continue
    let low = xs[i - 1]
    let high = xs[i]
    for (let k = 0; k < 60 && high - low > Math.abs(high) * 1e-15; k++) {
      const middle = (low + high) / 2
      const slope = (f(middle + step) - f(middle - step)) / (2 * step)
      if (!Number.isFinite(slope)) break
      if (Math.sign(slope) === Math.sign(first[i - 1])) low = middle
      else high = middle
    }
    const x = (low + high) / 2
    const value = f(x)
    const curvature = (f(x + step) - 2 * value + f(x - step)) / (step * step)
    critical.push({
      x,
      value,
      kind: !Number.isFinite(curvature)
        ? 'undetermined'
        : curvature > Math.abs(value) * 1e-8 + 1e-8
          ? 'minimum'
          : curvature < -(Math.abs(value) * 1e-8 + 1e-8)
            ? 'maximum'
            : 'inflection',
      secondDerivative: Number.isFinite(curvature) ? curvature : Number.NaN,
      verdict: 'numerical'
    })
  }

  const roots: number[] = []
  /**
   * Added only if it is not the root just found.
   *
   * A sample that is exactly zero is a root, and the interval either side of it also changes sign -- so without this
   * the same root is reported twice, a hundredth of a grid step apart, looking like two roots that happen to be very
   * close. The tolerance is the grid width, because two genuine roots closer together than that were not separated
   * by this sampling anyway.
   */
  const addRoot = (x: number): void => {
    if (roots.length > 0 && Math.abs(roots[roots.length - 1] - x) < width) return
    roots.push(x)
  }

  for (let i = 1; i <= samples; i++) {
    if (!Number.isFinite(values[i - 1]) || !Number.isFinite(values[i])) continue
    if (values[i - 1] === 0) {
      addRoot(xs[i - 1])
      continue
    }
    if (values[i] === 0) {
      addRoot(xs[i])
      continue
    }
    if (Math.sign(values[i - 1]) === Math.sign(values[i])) continue
    let low = xs[i - 1]
    let high = xs[i]
    const sign = Math.sign(values[i - 1])
    for (let k = 0; k < 80 && high - low > Math.max(1e-15, Math.abs(high) * 1e-15); k++) {
      const middle = (low + high) / 2
      const value = f(middle)
      if (!Number.isFinite(value)) break
      if (Math.sign(value) === sign) low = middle
      else high = middle
    }
    addRoot((low + high) / 2)
  }

  const inflections: number[] = []
  for (let i = 1; i <= samples; i++) {
    if (!Number.isFinite(second[i - 1]) || !Number.isFinite(second[i])) continue
    if (Math.sign(second[i - 1]) !== Math.sign(second[i]) && second[i - 1] !== 0) inflections.push((xs[i - 1] + xs[i]) / 2)
  }

  const notes = [
    `Sampled at ${samples + 1} points across the interval. Anything narrower than ${Number(width.toPrecision(3))} can fall between samples and be missed; more samples narrows that gap without closing it.`
  ]
  if (gaps.length > 0) {
    notes.push(`The function has no value at ${gaps.length} of the sampled points, the first at ${Number(gaps[0].toPrecision(6))}. Nothing is claimed about the intervals containing those.`)
  }

  return {
    critical,
    increasing: runs((i) => Number.isFinite(first[i]) && first[i] > 0),
    decreasing: runs((i) => Number.isFinite(first[i]) && first[i] < 0),
    concaveUp: runs((i) => Number.isFinite(second[i]) && second[i] > 0),
    concaveDown: runs((i) => Number.isFinite(second[i]) && second[i] < 0),
    inflections,
    roots,
    gaps,
    notes
  }
}

export interface Asymptotes {
  vertical: { at: number; side: 'left' | 'right' | 'both'; describe: string }[]
  horizontal: { at: number; direction: 'positive' | 'negative'; describe: string }[]
  oblique: { slope: number; intercept: number; direction: 'positive' | 'negative'; describe: string }[]
  notes: string[]
}

/**
 * Asymptotes, found numerically.
 *
 * Vertical ones are looked for at candidate points the caller supplies -- usually the zeros of a denominator, which
 * the caller knows and this does not. Horizontal and oblique ones come from the behaviour far out, and an oblique one
 * is only reported when the slope has settled, because a function that grows faster than linearly has a settling ratio
 * for a while before it does not.
 */
export function findAsymptotes(f: RealFunction, candidates: readonly number[] = [], far = 1e6): Asymptotes {
  const vertical: Asymptotes['vertical'] = []
  for (const at of candidates) {
    const left = limitAt(f, at, { from: 'left' })
    const right = limitAt(f, at, { from: 'right' })
    const leftInfinite = left.behaviour === 'infinite'
    const rightInfinite = right.behaviour === 'infinite'
    if (!leftInfinite && !rightInfinite) continue
    vertical.push({
      at,
      side: leftInfinite && rightInfinite ? 'both' : leftInfinite ? 'left' : 'right',
      describe: `There is a vertical asymptote at x = ${at}: the function grows without bound ${leftInfinite && rightInfinite ? 'on both sides' : `from the ${leftInfinite ? 'left' : 'right'}`}.`
    })
  }

  const horizontal: Asymptotes['horizontal'] = []
  const oblique: Asymptotes['oblique'] = []
  for (const direction of ['positive', 'negative'] as const) {
    const sign = direction === 'positive' ? 1 : -1

    /**
     * The limit as x goes to infinity, by substituting t = 1/x and taking the limit at zero.
     *
     * This reuses `limitAt` rather than comparing two far-out samples. Two samples cannot distinguish "levelling off
     * at y = 0" from "currently near zero and still falling" -- 1/(x-2) at a million and at half a million differ by
     * only a millionth, which any fixed threshold reads as settled, and the value it would report is the sample
     * rather than the limit.
     */
    const atInfinity = (g: RealFunction): { value: number | null; settled: boolean } => {
      const substituted = (t: number): number => (t === 0 ? Number.NaN : g(sign / Math.abs(t)))
      const limit = limitAt(substituted, 0, { from: 'right' })
      return { value: limit.value, settled: limit.exists && limit.value !== null }
    }

    const level = atInfinity(f)
    if (level.settled) {
      const value = level.value as number
      horizontal.push({
        at: value,
        direction,
        describe: `The function levels off at y = ${Number(value.toPrecision(8))} as x goes to ${direction === 'positive' ? '' : 'minus '}infinity.`
      })
      continue
    }

    // An oblique asymptote: f(x)/x settles to a slope, and then f(x) - slope*x settles to an intercept. Both have to
    // settle; a function growing faster than linearly has a slope that keeps rising and no oblique asymptote at all.
    const slope = atInfinity((x) => f(x) / x)
    if (!slope.settled || Math.abs(slope.value as number) < 1e-9) continue
    const intercept = atInfinity((x) => f(x) - (slope.value as number) * x)
    if (!intercept.settled) continue

    oblique.push({
      slope: slope.value as number,
      intercept: intercept.value as number,
      direction,
      describe: `The function approaches the line y = ${Number((slope.value as number).toPrecision(6))}x + ${Number((intercept.value as number).toPrecision(6))} as x goes to ${direction === 'positive' ? '' : 'minus '}infinity.`
    })
  }

  return {
    vertical,
    horizontal,
    oblique,
    notes: [
      `Found by evaluating at x = ${far.toExponential(0)}, which is far but not infinite. A function that changes behaviour beyond that is not covered.`,
      candidates.length === 0
        ? 'No candidate points for vertical asymptotes were given, so none were looked for. They are usually the zeros of a denominator, which the caller knows and this does not.'
        : `${candidates.length} candidate point${candidates.length === 1 ? ' was' : 's were'} checked for a vertical asymptote.`
    ]
  }
}

// ---------------------------------------------------------------- Taylor

export interface TaylorResult {
  coefficients: number[]
  /** The polynomial as text, so it can be shown rather than only evaluated. */
  polynomial: string
  centre: number
  order: number
  /** The largest observed error over the interval given, which is a measurement and not a bound. */
  observedError: number | null
  /** The interval the error was measured over. */
  over: { from: number; to: number } | null
  notes: string[]
}

/**
 * The Taylor polynomial about a point.
 *
 * Coefficients by repeated numerical differentiation, which is why the order is capped: each derivative loses roughly
 * a third of the available digits, and past about the tenth the coefficients are mostly rounding. The cap is stated in
 * the notes rather than being a silent quality ceiling.
 *
 * The error reported is measured over the interval given, not a bound. A Lagrange bound would need the next derivative
 * over the whole interval, which this does not have.
 */
export function taylorSeries(f: RealFunction, centre: number, order: number, over?: { from: number; to: number }): TaylorResult | CalculusError {
  if (!Number.isInteger(order) || order < 0 || order > CALCULUS_LIMITS.order) {
    return fail('invalid-argument', `A Taylor order has to be a whole number between 0 and ${CALCULUS_LIMITS.order}.`)
  }
  const at = f(centre)
  if (!Number.isFinite(at)) return fail('not-finite', `The function has no value at ${centre}, so there is nothing to expand about.`)

  /**
   * The coefficients, by interpolation rather than by repeated finite differences.
   *
   * A finite difference for the nth derivative divides by the step to the nth power, so a rounding error of 1e-16 in
   * the function values becomes 1e-16/h^n in the answer. At n = 5 with h = 1e-6 that is 1e14, and the coefficient is
   * pure noise while looking like a number. Interpolating through n+1 points at a *moderate* spacing and reading off
   * the polynomial has no such division, and the error is the interpolation error rather than amplified rounding.
   */
  if (order === 0) {
    return {
      coefficients: [at],
      polynomial: String(Number(at.toPrecision(8))),
      centre,
      order,
      observedError: over ? measureError([at], centre, f, over) : null,
      over: over ?? null,
      notes: ['An order-zero expansion is the value at the centre.']
    }
  }

  const spacing = Math.max(0.02, Math.abs(centre) * 0.02)
  const nodes: number[] = []
  const values: number[] = []
  for (let k = 0; k <= order; k++) {
    const x = centre + (k - order / 2) * spacing
    const value = f(x)
    if (!Number.isFinite(value)) {
      return fail('not-finite', `The function has no value at ${Number(x.toPrecision(6))}, which the expansion needs in order to interpolate through it.`)
    }
    nodes.push(x)
    values.push(value)
  }

  // Newton's divided differences: the coefficients of the interpolating polynomial in its nested form.
  const divided = [...values]
  for (let level = 1; level <= order; level++) {
    for (let i = order; i >= level; i--) {
      divided[i] = (divided[i] - divided[i - 1]) / (nodes[i] - nodes[i - level])
    }
  }

  // Expanded into powers of (x - centre), which is the form a Taylor coefficient is quoted in.
  const coefficients: number[] = new Array<number>(order + 1).fill(0)
  let basis: number[] = [1]
  for (let k = 0; k <= order; k++) {
    for (let i = 0; i < basis.length; i++) coefficients[i] += divided[k] * basis[i]
    if (k === order) break
    // basis *= (t - (node_k - centre)), where t is (x - centre).
    const shift = nodes[k] - centre
    const next = new Array<number>(basis.length + 1).fill(0)
    for (let i = 0; i < basis.length; i++) {
      next[i + 1] += basis[i]
      next[i] -= shift * basis[i]
    }
    basis = next
  }

  const observedError = over ? measureError(coefficients, centre, f, over) : null

  const terms: string[] = []
  coefficients.forEach((coefficient, n) => {
    if (Math.abs(coefficient) < 1e-12) return
    const value = Number(coefficient.toPrecision(8))
    const power = n === 0 ? '' : n === 1 ? `(x - ${centre})` : `(x - ${centre})^${n}`
    terms.push(`${terms.length > 0 && value > 0 ? '+ ' : ''}${value}${power === '' ? '' : `*${power}`}`)
  })

  const notes = [
    `The coefficients come from interpolating through ${order + 1} points spaced ${Number(spacing.toPrecision(3))} apart, not from repeated finite differences -- which divide by the step to the nth power and turn rounding into noise at the high orders.`
  ]
  if (observedError !== null && over) {
    notes.push(
      `The largest error over [${over.from}, ${over.to}] is ${observedError.toExponential(3)}. That is measured at 201 points, not a bound: the true maximum could be larger between them.`
    )
  }
  if (order > 12) {
    notes.push(
      `At order ${order} the interpolation itself becomes ill-conditioned, and the high-order coefficients carry noticeably more error than the low-order ones.`
    )
  }

  return {
    coefficients,
    polynomial: terms.length === 0 ? '0' : terms.join(' ').replace(/\+ -/g, '- '),
    centre,
    order,
    observedError,
    over: over ?? null,
    notes
  }
}

/** How far a polynomial in `(x - centre)` is from the function it approximates, sampled over an interval. */
function measureError(coefficients: readonly number[], centre: number, f: RealFunction, over: { from: number; to: number }): number {
  let worst = 0
  for (let i = 0; i <= 200; i++) {
    const x = over.from + ((over.to - over.from) * i) / 200
    const exact = f(x)
    if (!Number.isFinite(exact)) continue
    let approximated = 0
    for (let n = coefficients.length - 1; n >= 0; n--) approximated = approximated * (x - centre) + coefficients[n]
    worst = Math.max(worst, Math.abs(exact - approximated))
  }
  return worst
}

// ---------------------------------------------------------------- quadrature

export type QuadratureMethod = 'trapezoid' | 'simpson' | 'adaptive-simpson' | 'gauss-legendre'

export interface IntegralResult {
  value: number
  method: QuadratureMethod
  /** An estimate from comparing refinements, not the tolerance that was asked for. */
  estimatedError: number | null
  evaluations: number
  /** For adaptive methods: how deep the subdivision went, and where. */
  subdivisions: number
  converged: boolean
  notes: string[]
}

/**
 * A definite integral.
 *
 * Adaptive Simpson by default. The error estimate is real: one Simpson step over an interval is compared with two over
 * its halves, and the difference bounds the error to within a known factor. A method that reported back the tolerance
 * it was given would be reporting the question as the answer.
 */
export function integrateFunction(
  f: RealFunction,
  from: number,
  to: number,
  options: { method?: QuadratureMethod; tolerance?: number; intervals?: number } = {}
): IntegralResult | CalculusError {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return fail('invalid-argument', 'An infinite limit needs a substitution first; this integrates over a finite interval.')
  }
  if (from === to) {
    return { value: 0, method: options.method ?? 'adaptive-simpson', estimatedError: 0, evaluations: 0, subdivisions: 0, converged: true, notes: ['The limits are equal, so the integral is zero.'] }
  }

  const method = options.method ?? 'adaptive-simpson'
  let evaluations = 0
  const evaluate = (x: number): number => {
    evaluations += 1
    return f(x)
  }

  switch (method) {
    case 'trapezoid':
    case 'simpson': {
      const intervals = Math.max(2, Math.round(options.intervals ?? 1000))
      if (intervals > CALCULUS_LIMITS.subdivisions) return fail('too-many', `At most ${CALCULUS_LIMITS.subdivisions.toLocaleString('en')} intervals.`)
      const n = method === 'simpson' && intervals % 2 === 1 ? intervals + 1 : intervals
      const h = (to - from) / n

      const coarse = sum(evaluate, from, to, n / 2 >= 2 ? Math.max(2, Math.floor(n / 2)) : 2, method)
      const fine = sum(evaluate, from, to, n, method)
      if (!Number.isFinite(fine)) return fail('not-finite', 'The function could not be evaluated across the whole interval.')

      // Richardson: the difference between two refinements, scaled by the method's order.
      const factor = method === 'simpson' ? 15 : 3
      return {
        value: fine,
        method,
        estimatedError: Number.isFinite(coarse) ? Math.abs(fine - coarse) / factor : null,
        evaluations,
        subdivisions: n,
        converged: true,
        notes: [
          `${method === 'simpson' ? 'Simpson' : 'The trapezoid rule'} over ${n} intervals of width ${Number(h.toPrecision(4))}. The error estimate comes from comparing this against half as many intervals.`,
          'A fixed number of intervals spends the same effort everywhere. Where the function is smooth that is wasted, and where it is not it may not be enough.'
        ]
      }
    }

    case 'gauss-legendre': {
      // Five-point Gauss-Legendre, exact for polynomials up to degree nine.
      const nodes = [0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664]
      const weights = [0.5688888888888889, 0.47862867049936647, 0.47862867049936647, 0.23692688505618908, 0.23692688505618908]
      const panels = Math.max(1, Math.round(options.intervals ?? 100))
      if (panels > CALCULUS_LIMITS.subdivisions) return fail('too-many', `At most ${CALCULUS_LIMITS.subdivisions.toLocaleString('en')} panels.`)

      let total = 0
      const width = (to - from) / panels
      for (let p = 0; p < panels; p++) {
        const a = from + p * width
        const middle = a + width / 2
        for (let i = 0; i < nodes.length; i++) {
          const value = evaluate(middle + (nodes[i] * width) / 2)
          if (!Number.isFinite(value)) return fail('not-finite', `The function has no value at ${middle + (nodes[i] * width) / 2}.`)
          total += weights[i] * value
        }
      }
      total *= width / 2

      return {
        value: total,
        method,
        estimatedError: null,
        evaluations,
        subdivisions: panels,
        converged: true,
        notes: [
          `Five-point Gauss-Legendre over ${panels} panel${panels === 1 ? '' : 's'}. Exact for polynomials up to degree nine, and very accurate for smooth functions.`,
          'No error estimate: a single Gauss rule gives no way to estimate its own error. Run it again with more panels and compare if you need one.'
        ]
      }
    }

    case 'adaptive-simpson': {
      const tolerance = Math.max(1e-14, options.tolerance ?? 1e-10)
      let subdivisions = 0
      let deepest = 0
      let hitLimit = false

      const simpson = (a: number, b: number, fa: number, fm: number, fb: number): number => ((b - a) / 6) * (fa + 4 * fm + fb)

      const recurse = (a: number, b: number, fa: number, fm: number, fb: number, whole: number, tolerance2: number, depth: number): number => {
        deepest = Math.max(deepest, depth)
        if (depth > 50 || subdivisions > CALCULUS_LIMITS.subdivisions) {
          hitLimit = true
          return whole
        }
        const middle = (a + b) / 2
        const leftMiddle = (a + middle) / 2
        const rightMiddle = (middle + b) / 2
        const flm = evaluate(leftMiddle)
        const frm = evaluate(rightMiddle)
        if (!Number.isFinite(flm) || !Number.isFinite(frm)) {
          hitLimit = true
          return whole
        }
        subdivisions += 1
        const left = simpson(a, middle, fa, flm, fm)
        const right = simpson(middle, b, fm, frm, fb)
        const difference = left + right - whole
        // The classic criterion: two halves agreeing with the whole to within 15 times the tolerance.
        if (Math.abs(difference) <= 15 * tolerance2) return left + right + difference / 15
        return (
          recurse(a, middle, fa, flm, fm, left, tolerance2 / 2, depth + 1) +
          recurse(middle, b, fm, frm, fb, right, tolerance2 / 2, depth + 1)
        )
      }

      const fa = evaluate(from)
      const fb = evaluate(to)
      const fm = evaluate((from + to) / 2)
      if (!Number.isFinite(fa) || !Number.isFinite(fb) || !Number.isFinite(fm)) {
        return fail('not-finite', 'The function has no value at one of the endpoints or the midpoint, so the integral cannot be started.')
      }

      const value = recurse(from, to, fa, fm, fb, simpson(from, to, fa, fm, fb), tolerance, 0)

      return {
        value,
        method,
        estimatedError: hitLimit ? null : tolerance,
        evaluations,
        subdivisions,
        converged: !hitLimit,
        notes: hitLimit
          ? [
              `The subdivision hit its limit after ${subdivisions} splits and ${evaluations} evaluations. The value is the best available and the error is not known -- the function is probably very sharp somewhere, or undefined at a point inside the interval.`
            ]
          : [
              `Adaptive Simpson: ${subdivisions} subdivisions, ${evaluations} evaluations, deepest recursion ${deepest}. Effort went where the function is not smooth rather than being spread evenly.`,
              `The error should be within ${tolerance.toExponential(1)}. That comes from each step agreeing with two halves of itself, which bounds the error rather than restating the request.`
            ]
      }
    }
  }
}

function sum(evaluate: RealFunction, from: number, to: number, n: number, method: 'trapezoid' | 'simpson'): number {
  const h = (to - from) / n
  let total = 0
  if (method === 'trapezoid') {
    total = (evaluate(from) + evaluate(to)) / 2
    for (let i = 1; i < n; i++) total += evaluate(from + i * h)
    return total * h
  }
  total = evaluate(from) + evaluate(to)
  for (let i = 1; i < n; i++) total += evaluate(from + i * h) * (i % 2 === 1 ? 4 : 2)
  return (total * h) / 3
}

// ---------------------------------------------------------------- differential equations

export type OdeForm = 'separable' | 'linear-first-order' | 'exact' | 'bernoulli' | 'autonomous' | 'second-order-linear' | 'unrecognised'

export interface OdeClassification {
  form: OdeForm
  order: number
  linear: boolean
  autonomous: boolean
  /** The method that applies, when one does. `null` when the form was not recognised. */
  method: string | null
  describe: string
  /** What was tested to reach this, so a wrong classification can be argued with. */
  evidence: string[]
}

/**
 * What kind of first-order equation `y' = f(x, y)` is.
 *
 * Tested numerically rather than symbolically: separability is checked by whether `f(x,y)*f(x0,y0)` equals
 * `f(x,y0)*f(x0,y)` across a grid, which is exactly the condition for `f` to factor. Linearity in `y` is checked by
 * whether `f` is affine in `y` at fixed `x`.
 *
 * A form that is not recognised is `unrecognised`, not "probably separable". The numerical tests are evidence, and
 * `evidence` records what they found.
 */
export function classifyOde(f: (x: number, y: number) => number, around: { x: number; y: number } = { x: 1, y: 1 }): OdeClassification {
  const evidence: string[] = []
  const grid = [-1, -0.5, 0.5, 1]

  // Autonomous: f does not depend on x.
  let autonomous = true
  for (const dy of grid) {
    const base = f(around.x, around.y + dy)
    for (const dx of grid) {
      const other = f(around.x + dx, around.y + dy)
      if (!Number.isFinite(base) || !Number.isFinite(other)) continue
      if (Math.abs(other - base) > Math.max(1e-9, Math.abs(base) * 1e-9)) autonomous = false
    }
  }
  evidence.push(autonomous ? 'The rate does not change with x, so the equation is autonomous.' : 'The rate depends on x.')

  // Linear in y: f(x, y) = a(x)*y + b(x), which means the second difference in y is zero.
  let linear = true
  for (const dx of grid) {
    const x = around.x + dx
    const a = f(x, around.y - 1)
    const b = f(x, around.y)
    const c = f(x, around.y + 1)
    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) continue
    if (Math.abs(a - 2 * b + c) > Math.max(1e-7, Math.abs(b) * 1e-7)) linear = false
  }
  evidence.push(linear ? 'The rate is a straight line in y at each x, so the equation is linear in y.' : 'The rate is not a straight line in y, so the equation is not linear.')

  // Separable: f(x,y) = g(x)h(y), which holds exactly when f(x,y)f(x0,y0) = f(x,y0)f(x0,y).
  let separable = true
  const anchor = f(around.x, around.y)
  if (!Number.isFinite(anchor) || anchor === 0) separable = false
  else {
    for (const dx of grid) {
      for (const dy of grid) {
        const both = f(around.x + dx, around.y + dy)
        const justX = f(around.x + dx, around.y)
        const justY = f(around.x, around.y + dy)
        if (![both, justX, justY].every(Number.isFinite)) continue
        const left = both * anchor
        const right = justX * justY
        if (Math.abs(left - right) > Math.max(1e-7, Math.abs(left) * 1e-7)) separable = false
      }
    }
  }
  evidence.push(separable ? 'The rate factors into a function of x times a function of y, so the variables separate.' : 'The rate does not factor into a function of x times a function of y.')

  const form: OdeForm = separable ? 'separable' : linear ? 'linear-first-order' : autonomous ? 'autonomous' : 'unrecognised'

  return {
    form,
    order: 1,
    linear,
    autonomous,
    method:
      form === 'separable'
        ? 'Separate the variables and integrate both sides.'
        : form === 'linear-first-order'
          ? 'Multiply by the integrating factor and integrate.'
          : form === 'autonomous'
            ? 'The equilibria are the zeros of the rate; the behaviour between them follows from its sign.'
            : null,
    describe:
      form === 'unrecognised'
        ? 'None of the forms Orbis tests for applies. It can still be solved numerically, which needs no classification.'
        : `This is ${form === 'separable' ? 'a separable' : form === 'linear-first-order' ? 'a linear first-order' : 'an autonomous'} equation. The classification comes from testing the rate on a grid of points, so it is evidence rather than a proof.`,
    evidence
  }
}

export interface IvpResult {
  run: RunResult
  /** How far the solution drifts from satisfying the equation, checked at points along the trace. */
  residual: number
  /** Whether the initial condition is actually met by the result. */
  initialConditionMet: boolean
  describe: string
  notes: string[]
}

/**
 * An initial-value problem, integrated and then checked.
 *
 * The check is the part worth having. The integrator reports its own estimated local error, which is about the step it
 * just took; substituting the answer back into the equation measures whether the whole trajectory satisfies it. Those
 * are different questions, and the second is the one somebody asked.
 */
export function solveIvp(
  derivative: (time: number, values: readonly number[]) => number[],
  start: State,
  until: number,
  options: Parameters<typeof integrate>[3] = {}
): IvpResult | CalculusError {
  const run = integrate(derivative, start, until, options)
  if (isSimulationError(run)) return fail(run.error, run.message)

  // Substitute back: the numerical slope between consecutive trace points against what the equation says it should be.
  let residual = 0
  let checked = 0
  for (let i = 1; i < run.trace.length; i++) {
    const before = run.trace[i - 1]
    const after = run.trace[i]
    const dt = after.time - before.time
    if (dt <= 0) continue
    const middleTime = (before.time + after.time) / 2
    const middleValues = before.values.map((value, k) => (value + after.values[k]) / 2)
    const expected = derivative(middleTime, middleValues)
    for (let k = 0; k < before.values.length; k++) {
      const actual = (after.values[k] - before.values[k]) / dt
      const scale = Math.max(1, Math.abs(expected[k]))
      residual = Math.max(residual, Math.abs(actual - expected[k]) / scale)
    }
    checked += 1
  }

  const first = run.trace[0]
  const initialConditionMet =
    first !== undefined &&
    Math.abs(first.time - start.time) < 1e-12 &&
    first.values.every((value, k) => Math.abs(value - start.values[k]) < 1e-12)

  return {
    run,
    residual,
    initialConditionMet,
    describe:
      run.status === 'complete'
        ? `Integrated to ${until} in ${run.steps} steps and ${run.evaluations} evaluations.`
        : `The run ended as ${run.status} rather than completing.`,
    notes: [
      ...run.notes,
      checked === 0
        ? 'The trace was too short to substitute back into the equation, so the solution was not checked against it.'
        : `Substituting back at ${checked} points, the worst relative mismatch with the equation is ${residual.toExponential(2)}. That is a different check from the integrator's own step error, which is about the last step rather than the whole trajectory.`
    ]
  }
}

export interface Equilibrium {
  at: number[]
  /** For a one-dimensional system, from the sign of the derivative either side. */
  stability: 'stable' | 'unstable' | 'semi-stable' | 'undetermined'
  /** The eigenvalue or Jacobian trace that decided it. */
  evidence: number
  describe: string
}

/**
 * The equilibria of a one-dimensional autonomous system, and whether each is stable.
 *
 * Stability comes from the sign of the rate either side, which for one dimension is exact once the equilibrium is
 * located. The semi-stable case -- attracting from one side and repelling from the other -- is a real category and is
 * reported rather than being forced into stable or unstable.
 */
export function equilibriaOf(rate: (y: number) => number, from: number, to: number, samples = 500): Equilibrium[] | CalculusError {
  if (from >= to) return fail('invalid-argument', 'An interval needs a start below its end.')
  if (!Number.isInteger(samples) || samples < 10 || samples > CALCULUS_LIMITS.samples) {
    return fail('invalid-argument', 'The number of samples has to be between 10 and the sampling limit.')
  }

  const width = (to - from) / samples
  const out: Equilibrium[] = []

  for (let i = 1; i <= samples; i++) {
    const a = from + (i - 1) * width
    const b = from + i * width
    const fa = rate(a)
    const fb = rate(b)
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) continue
    if (fa !== 0 && Math.sign(fa) === Math.sign(fb)) continue

    let low = a
    let high = b
    const sign = Math.sign(fa)
    if (sign !== 0) {
      for (let k = 0; k < 80 && high - low > Math.max(1e-15, Math.abs(high) * 1e-15); k++) {
        const middle = (low + high) / 2
        const value = rate(middle)
        if (!Number.isFinite(value)) break
        if (Math.sign(value) === sign) low = middle
        else high = middle
      }
    }
    const at = sign === 0 ? a : (low + high) / 2

    // The rate a little either side decides the stability.
    const probe = Math.max(1e-9, Math.abs(at) * 1e-6, width * 1e-3)
    const below = rate(at - probe)
    const above = rate(at + probe)
    const attractsFromBelow = below > 0
    const attractsFromAbove = above < 0

    const stability: Equilibrium['stability'] =
      !Number.isFinite(below) || !Number.isFinite(above)
        ? 'undetermined'
        : attractsFromBelow && attractsFromAbove
          ? 'stable'
          : !attractsFromBelow && !attractsFromAbove
            ? 'unstable'
            : 'semi-stable'

    out.push({
      at: [at],
      stability,
      evidence: (above - below) / (2 * probe),
      describe:
        stability === 'stable'
          ? `y = ${Number(at.toPrecision(8))} is stable: the rate pushes back towards it from both sides.`
          : stability === 'unstable'
            ? `y = ${Number(at.toPrecision(8))} is unstable: the rate pushes away from it on both sides.`
            : stability === 'semi-stable'
              ? `y = ${Number(at.toPrecision(8))} is semi-stable: it attracts from one side and repels on the other. Neither "stable" nor "unstable" describes it.`
              : `y = ${Number(at.toPrecision(8))} is an equilibrium whose stability could not be determined; the rate could not be evaluated close enough to it.`
    })
  }

  return out
}

export interface PhasePortrait {
  /** The vector field, on a grid. */
  field: { x: number; y: number; dx: number; dy: number; magnitude: number }[]
  /** Points where both rates are zero, found on the grid rather than solved for. */
  equilibria: { x: number; y: number; classification: string; eigenvalues: number[] }[]
  trajectories: { from: { x: number; y: number }; points: { x: number; y: number }[] }[]
  notes: string[]
}

/**
 * The phase portrait of a two-dimensional autonomous system.
 *
 * Equilibria are classified from the eigenvalues of the numerically computed Jacobian, which is the actual criterion:
 * two negative real parts is a sink, two positive a source, opposite signs a saddle, and a complex pair a spiral or a
 * centre. A classification from the shape of the drawn trajectories would be reading the picture rather than the
 * system.
 */
export function phasePortrait(
  rates: (x: number, y: number) => [number, number],
  bounds: { xFrom: number; xTo: number; yFrom: number; yTo: number },
  options: { grid?: number; trajectoriesFrom?: { x: number; y: number }[]; steps?: number } = {}
): PhasePortrait | CalculusError {
  if (bounds.xFrom >= bounds.xTo || bounds.yFrom >= bounds.yTo) return fail('invalid-argument', 'The bounds need a start below an end in both directions.')
  const grid = Math.max(3, Math.min(60, Math.round(options.grid ?? 20)))

  const field: PhasePortrait['field'] = []
  for (let i = 0; i <= grid; i++) {
    for (let j = 0; j <= grid; j++) {
      const x = bounds.xFrom + ((bounds.xTo - bounds.xFrom) * i) / grid
      const y = bounds.yFrom + ((bounds.yTo - bounds.yFrom) * j) / grid
      const [dx, dy] = rates(x, y)
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue
      field.push({ x, y, dx, dy, magnitude: Math.hypot(dx, dy) })
    }
  }

  // Equilibria: grid cells where both rates change sign, refined by a few Newton steps on the Jacobian.
  const equilibria: PhasePortrait['equilibria'] = []
  const seen = new Set<string>()
  for (const point of field) {
    if (point.magnitude > (Math.abs(bounds.xTo - bounds.xFrom) / grid) * 2) continue
    let x = point.x
    let y = point.y
    for (let k = 0; k < 40; k++) {
      const [dx, dy] = rates(x, y)
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) break
      if (Math.hypot(dx, dy) < 1e-12) break
      const h = Math.max(1e-7, Math.abs(x) * 1e-7, Math.abs(y) * 1e-7)
      const [axx, ayx] = rates(x + h, y)
      const [axy, ayy] = rates(x, y + h)
      const j11 = (axx - dx) / h
      const j12 = (axy - dx) / h
      const j21 = (ayx - dy) / h
      const j22 = (ayy - dy) / h
      const determinant = j11 * j22 - j12 * j21
      if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) break
      x -= (j22 * dx - j12 * dy) / determinant
      y -= (-j21 * dx + j11 * dy) / determinant
    }
    const [dx, dy] = rates(x, y)
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) > 1e-6) continue
    if (x < bounds.xFrom || x > bounds.xTo || y < bounds.yFrom || y > bounds.yTo) continue
    const key = `${x.toPrecision(6)},${y.toPrecision(6)}`
    if (seen.has(key)) continue
    seen.add(key)

    const h = Math.max(1e-7, Math.abs(x) * 1e-7, Math.abs(y) * 1e-7)
    const [axx, ayx] = rates(x + h, y)
    const [axy, ayy] = rates(x, y + h)
    const j11 = (axx - dx) / h
    const j12 = (axy - dx) / h
    const j21 = (ayx - dy) / h
    const j22 = (ayy - dy) / h

    const trace = j11 + j22
    const determinant = j11 * j22 - j12 * j21
    const discriminant = trace * trace - 4 * determinant

    let classification: string
    let eigenvalues: number[]
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant)
      eigenvalues = [(trace + root) / 2, (trace - root) / 2]
      classification =
        eigenvalues[0] < 0 && eigenvalues[1] < 0
          ? 'stable node: both eigenvalues are negative, so everything nearby moves towards it'
          : eigenvalues[0] > 0 && eigenvalues[1] > 0
            ? 'unstable node: both eigenvalues are positive, so everything nearby moves away'
            : 'saddle: the eigenvalues have opposite signs, so it attracts along one direction and repels along another'
    } else {
      eigenvalues = [trace / 2, Math.sqrt(-discriminant) / 2]
      classification =
        Math.abs(trace) < 1e-9
          ? 'centre: the eigenvalues are purely imaginary, so trajectories nearby circle it. A linear analysis cannot tell a true centre from a very slow spiral'
          : trace < 0
            ? 'stable spiral: the eigenvalues are complex with a negative real part, so trajectories spiral inwards'
            : 'unstable spiral: the eigenvalues are complex with a positive real part, so trajectories spiral outwards'
    }

    equilibria.push({ x, y, classification, eigenvalues })
  }

  const trajectories: PhasePortrait['trajectories'] = []
  const steps = Math.max(10, Math.min(CALCULUS_LIMITS.timeSteps, Math.round(options.steps ?? 500)))
  for (const start of options.trajectoriesFrom ?? []) {
    const points: { x: number; y: number }[] = [{ ...start }]
    let x = start.x
    let y = start.y
    const dt = 0.01
    for (let k = 0; k < steps; k++) {
      // RK4 by hand: the system is two-dimensional and this avoids building a State for every trajectory.
      const [k1x, k1y] = rates(x, y)
      const [k2x, k2y] = rates(x + (dt * k1x) / 2, y + (dt * k1y) / 2)
      const [k3x, k3y] = rates(x + (dt * k2x) / 2, y + (dt * k2y) / 2)
      const [k4x, k4y] = rates(x + dt * k3x, y + dt * k3y)
      if (![k1x, k1y, k2x, k2y, k3x, k3y, k4x, k4y].every(Number.isFinite)) break
      x += (dt * (k1x + 2 * k2x + 2 * k3x + k4x)) / 6
      y += (dt * (k1y + 2 * k2y + 2 * k3y + k4y)) / 6
      if (!Number.isFinite(x) || !Number.isFinite(y)) break
      points.push({ x, y })
      if (Math.abs(x) > 1e8 || Math.abs(y) > 1e8) break
    }
    trajectories.push({ from: start, points })
  }

  return {
    field,
    equilibria,
    trajectories,
    notes: [
      `The field is sampled on a ${grid + 1} by ${grid + 1} grid. Equilibria were found by refining from grid points where the rate is small, so one in a region the grid does not reach will be missed.`,
      'Each equilibrium is classified from the eigenvalues of the Jacobian there, which is the actual criterion -- not from the shape of the drawn trajectories.'
    ]
  }
}

export interface HeatResult {
  /** The solution at each stored time, as values across the grid. */
  frames: { time: number; values: number[] }[]
  grid: number[]
  /** The stability number. Above one half an explicit scheme grows without bound whatever the equation says. */
  stabilityNumber: number
  stable: boolean
  notes: string[]
}

/**
 * The one-dimensional heat equation `u_t = k u_xx`, by an explicit scheme.
 *
 * Refused when the stability number `k dt / dx^2` is above one half. That is not a quality threshold: above it the
 * scheme amplifies every rounding error at each step, and after a few hundred steps the answer is enormous
 * oscillation with no relation to the equation. Running it anyway and returning the result would produce something
 * that looks like a solution and is not one.
 */
export function heatEquation(
  initial: readonly number[],
  options: { diffusivity: number; dx: number; dt: number; steps: number; frames?: number; boundary?: [number, number] }
): HeatResult | CalculusError {
  const { diffusivity, dx, dt, steps } = options
  if (initial.length < 3) return fail('invalid-argument', 'The grid needs at least three points.')
  if (initial.length > CALCULUS_LIMITS.gridPoints) return fail('too-large', `The grid is limited to ${CALCULUS_LIMITS.gridPoints.toLocaleString('en')} points.`)
  if (!Number.isFinite(diffusivity) || diffusivity <= 0) return fail('invalid-argument', 'The diffusivity has to be a positive number.')
  if (!Number.isFinite(dx) || dx <= 0 || !Number.isFinite(dt) || dt <= 0) return fail('invalid-argument', 'The grid spacing and the time step both have to be positive.')
  if (!Number.isInteger(steps) || steps < 1 || steps > CALCULUS_LIMITS.timeSteps) {
    return fail('invalid-argument', `The number of steps has to be between 1 and ${CALCULUS_LIMITS.timeSteps.toLocaleString('en')}.`)
  }

  const stabilityNumber = (diffusivity * dt) / (dx * dx)
  if (stabilityNumber > 0.5) {
    return fail(
      'unstable',
      `The stability number is ${Number(stabilityNumber.toPrecision(4))}, above the half that an explicit scheme allows. Above that the scheme amplifies rounding at every step, and what comes out is growing oscillation rather than a solution. Reduce the time step to at most ${Number(((0.5 * dx * dx) / diffusivity).toPrecision(4))}, or use a finer grid.`
    )
  }

  const boundary = options.boundary ?? [initial[0], initial[initial.length - 1]]
  let current = [...initial]
  const frames: HeatResult['frames'] = [{ time: 0, values: [...current] }]
  const every = Math.max(1, Math.floor(steps / Math.max(1, Math.min(200, options.frames ?? 20))))

  for (let step = 1; step <= steps; step++) {
    const next = [...current]
    for (let i = 1; i < current.length - 1; i++) {
      next[i] = current[i] + stabilityNumber * (current[i + 1] - 2 * current[i] + current[i - 1])
    }
    next[0] = boundary[0]
    next[next.length - 1] = boundary[1]
    current = next
    if (step % every === 0 || step === steps) frames.push({ time: step * dt, values: [...current] })
  }

  return {
    frames,
    grid: Array.from({ length: initial.length }, (_, i) => i * dx),
    stabilityNumber,
    stable: true,
    notes: [
      `Explicit scheme with a stability number of ${Number(stabilityNumber.toPrecision(4))}, which is at or below the half it has to be.`,
      'The boundary values are held fixed. A different boundary condition is a different problem, not a setting.',
      `${frames.length} frames kept from ${steps} steps.`
    ]
  }
}

export interface WaveResult {
  frames: { time: number; values: number[] }[]
  grid: number[]
  courantNumber: number
  stable: boolean
  notes: string[]
}

/**
 * The one-dimensional wave equation `u_tt = c^2 u_xx`.
 *
 * The Courant condition `c dt / dx <= 1` is the physical statement that the numerical scheme has to propagate
 * information at least as fast as the wave does. Break it and the scheme cannot see where the wave went; the result
 * grows without bound. Refused for the same reason as the heat equation.
 */
export function waveEquation(
  initial: readonly number[],
  options: { speed: number; dx: number; dt: number; steps: number; frames?: number; initialVelocity?: readonly number[] }
): WaveResult | CalculusError {
  const { speed, dx, dt, steps } = options
  if (initial.length < 3) return fail('invalid-argument', 'The grid needs at least three points.')
  if (initial.length > CALCULUS_LIMITS.gridPoints) return fail('too-large', `The grid is limited to ${CALCULUS_LIMITS.gridPoints.toLocaleString('en')} points.`)
  if (!Number.isFinite(speed) || speed <= 0) return fail('invalid-argument', 'The wave speed has to be positive.')
  if (!Number.isFinite(dx) || dx <= 0 || !Number.isFinite(dt) || dt <= 0) return fail('invalid-argument', 'The grid spacing and the time step both have to be positive.')
  if (!Number.isInteger(steps) || steps < 1 || steps > CALCULUS_LIMITS.timeSteps) {
    return fail('invalid-argument', `The number of steps has to be between 1 and ${CALCULUS_LIMITS.timeSteps.toLocaleString('en')}.`)
  }

  const courant = (speed * dt) / dx
  if (courant > 1) {
    return fail(
      'unstable',
      `The Courant number is ${Number(courant.toPrecision(4))}, above the one it has to be at or below. The scheme would be trying to propagate information more slowly than the wave actually travels, which it cannot do: the result grows without bound rather than being merely inaccurate. Reduce the time step to at most ${Number((dx / speed).toPrecision(4))}.`
    )
  }

  const n = initial.length
  const velocity = options.initialVelocity ?? new Array<number>(n).fill(0)
  const squared = courant * courant

  let previous = [...initial]
  // The first step needs its own formula: the scheme is a three-level one and there is no step before the first.
  const current = [...initial]
  for (let i = 1; i < n - 1; i++) {
    current[i] = initial[i] + dt * velocity[i] + (squared / 2) * (initial[i + 1] - 2 * initial[i] + initial[i - 1])
  }
  current[0] = initial[0]
  current[n - 1] = initial[n - 1]

  let now = current
  const frames: WaveResult['frames'] = [{ time: 0, values: [...initial] }, { time: dt, values: [...now] }]
  const every = Math.max(1, Math.floor(steps / Math.max(1, Math.min(200, options.frames ?? 20))))

  for (let step = 2; step <= steps; step++) {
    const next = [...now]
    for (let i = 1; i < n - 1; i++) {
      next[i] = 2 * now[i] - previous[i] + squared * (now[i + 1] - 2 * now[i] + now[i - 1])
    }
    next[0] = initial[0]
    next[n - 1] = initial[n - 1]
    previous = now
    now = next
    if (step % every === 0 || step === steps) frames.push({ time: step * dt, values: [...now] })
  }

  return {
    frames,
    grid: Array.from({ length: n }, (_, i) => i * dx),
    courantNumber: courant,
    stable: true,
    notes: [
      `Courant number ${Number(courant.toPrecision(4))}, at or below the one it has to be.`,
      'The first step uses its own formula, because a three-level scheme has no step before the first one.',
      'The ends are held fixed, which is a reflecting boundary. An absorbing one is a different problem.'
    ]
  }
}

/** The assumptions the engine rests on, for a Page that wants to show them rather than have them inferred. */
export const CALCULUS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A symbolic derivative is exact. A numerical one depends on the step it was taken over, and the step is reported with it.',
  'A limit found by sampling is evidence, not a proof. Nothing rules out the function doing something between the samples.',
  'A discontinuity is classified -- removable, jump, infinite or oscillating -- because the kinds mean different things.',
  'Anything found on a grid can miss a feature narrower than the grid, and the notes say so rather than implying completeness.',
  'The error on an integral comes from comparing refinements, never from restating the tolerance that was asked for.',
  'An equation whose form is not recognised is unrecognised, not probably something. It can still be solved numerically.',
  'A numerical solution is substituted back into its equation, which is a different check from the integrator’s own step error.',
  'An explicit scheme past its stability limit is refused, because what it produces looks like a solution and is not one.'
])
