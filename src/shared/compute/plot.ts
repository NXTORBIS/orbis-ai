/**
 * Plotting: turning numbers into something you can look at without being misled by it.
 *
 * This is the data model and the sampling, not the drawing. It produces points, ticks, ranges and scales; a Page turns
 * those into SVG. Keeping the two apart means the maths can be tested without a browser, and the same plot description can
 * be drawn at any size.
 *
 * ## The things a plot can lie about, and what is done here instead
 *
 * - **Sampling too coarsely.** A fixed grid of points misses a narrow spike entirely and draws a smooth curve where there
 *   is a cliff. `sampleFunction` refines adaptively where the curve bends, so the resolution follows the function. Its
 *   limit is stated rather than hidden: refinement can only follow bending it has seen, so a feature narrower than the
 *   *starting* grid is never sampled and never found. That is why `initial` is the caller's choice.
 * - **Joining across a discontinuity.** `1/x` plotted naively gets a near-vertical line through the origin that looks like
 *   part of the function. Breaks are detected and the segment is cut instead.
 * - **Decimating by stride.** Taking every tenth point of a million-point series deletes every spike that happens to fall
 *   between samples. `decimate` keeps the minimum and maximum of each bucket, so the envelope survives.
 * - **A truncated axis.** Starting a bar chart's value axis above zero exaggerates differences. `axisFor` refuses to
 *   baseline bars anywhere but zero, and records when a range was clipped.
 * - **Silently dropping what cannot be drawn.** A log axis cannot show a zero or a negative. Those points are counted and
 *   reported rather than quietly disappearing.
 *
 * Pure. No DOM, no network, no clock, no randomness.
 */

import type { ResolvedUnit } from './units.ts'

export interface PlotError {
  error: 'empty' | 'invalid-argument' | 'not-finite' | 'scale-mismatch' | 'too-many-points'
  message: string
}

export const isPlotError = (value: unknown): value is PlotError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

export const PLOT_LIMITS: Readonly<Record<'drawablePoints' | 'samples' | 'seriesPerPlot' | 'ticks', number>> = Object.freeze({
  /** Above this a series is decimated before it leaves this module. A browser cannot usefully draw more. */
  drawablePoints: 4000,
  /** The hard ceiling on adaptive refinement, so a pathological function cannot run forever. */
  samples: 20_000,
  seriesPerPlot: 40,
  ticks: 24
})

// ---------------------------------------------------------------- points and series

export interface Point {
  x: number
  y: number
}

/**
 * A run of points that should be joined.
 *
 * A series is a list of segments rather than a list of points precisely so that a break -- a discontinuity, a gap in the
 * data, a point a log axis cannot show -- is a real thing in the model and not a convention about NaN.
 */
export interface Segment {
  points: readonly Point[]
  /** Why this segment ends where it does. `end` is the natural finish; anything else is a break worth showing. */
  endsBecause: 'end' | 'discontinuity' | 'undefined' | 'out-of-range' | 'gap-in-data'
}

export type SeriesKind = 'line' | 'scatter' | 'area' | 'bar' | 'step'

export interface Series {
  id: string
  label: string
  kind: SeriesKind
  segments: readonly Segment[]
  /** How the y values are measured, for the axis label. Null when they are plain numbers. */
  unit: ResolvedUnit | null
  /** Where the numbers came from. Carried so a Page can mark a simulated curve as simulated. */
  provenance: 'measured' | 'computed' | 'simulated' | 'imported' | 'unknown'
  /** Per-point uncertainty in y, for error bars. Same length as the flattened points, or empty. */
  errorY: readonly number[]
  notes: readonly string[]
}

/** Every point of a series, across its segments. For ranges and statistics, where the breaks do not matter. */
export const allPoints = (series: Series): Point[] => series.segments.flatMap((one) => [...one.points])

export const pointCount = (series: Series): number =>
  series.segments.reduce((total, one) => total + one.points.length, 0)

/**
 * A colourblind-safe palette, in the order it should be used.
 *
 * Okabe and Ito's set: distinguishable under the common forms of colour vision deficiency. Chosen over a prettier ramp
 * because a plot whose series cannot be told apart is not a plot.
 */
export const SERIES_COLOURS: readonly string[] = Object.freeze([
  '#56b4e9',
  '#e69f00',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
  '#999999'
])

export const colourFor = (index: number): string => SERIES_COLOURS[((index % SERIES_COLOURS.length) + SERIES_COLOURS.length) % SERIES_COLOURS.length]

// ---------------------------------------------------------------- adaptive sampling

export interface SampleOptions {
  /** How many points to start from before refining. */
  initial?: number
  /** Stop refining once a segment bends less than this, in screen-ish units relative to the range. */
  tolerance?: number
  maximum?: number
  /** A jump larger than this many times the median step is treated as a discontinuity rather than a steep bit. */
  breakFactor?: number
}

export interface SampleResult {
  segments: readonly Segment[]
  /** How many times the function was called. Reported because a Page may want to warn about an expensive one. */
  evaluations: number
  /** Points where the function had no value. Counted rather than silently skipped. */
  undefinedAt: readonly number[]
  notes: readonly string[]
}

/**
 * A function sampled so that the drawn curve follows it.
 *
 * Starts from a coarse grid and subdivides any interval whose midpoint is far from the straight line between its ends --
 * which is a direct measure of how much the curve bends there, and so puts the points where they are needed rather than
 * spreading them evenly and hoping.
 *
 * Discontinuities are found afterwards, from the distribution of vertical steps: a step far larger than the typical one is
 * a break. That is a heuristic and it is stated as one, because no finite number of samples can distinguish a pole from a
 * very steep bit of a continuous function.
 */
export function sampleFunction(
  f: (x: number) => number,
  from: number,
  to: number,
  options: SampleOptions = {}
): SampleResult | PlotError {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { error: 'invalid-argument', message: 'The range to sample over has to be two finite numbers.' }
  }
  if (from === to) return { error: 'invalid-argument', message: 'The range to sample over has no width.' }
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  const initial = Math.min(2000, Math.max(8, Math.round(options.initial ?? 64)))
  const maximum = Math.min(PLOT_LIMITS.samples, Math.max(initial, Math.round(options.maximum ?? 2000)))
  const breakFactor = Math.max(2, options.breakFactor ?? 30)

  let evaluations = 0
  const undefinedAt: number[] = []
  const evaluate = (x: number): number | null => {
    evaluations += 1
    let y: number
    try {
      y = f(x)
    } catch {
      // A function that throws at a point has no value there; that is not a reason to abandon the whole plot.
      undefinedAt.push(x)
      return null
    }
    if (typeof y !== 'number' || !Number.isFinite(y)) {
      undefinedAt.push(x)
      return null
    }
    return y
  }

  // The coarse pass. A sorted map keeps refinement simple: insert a midpoint and it lands in the right place.
  const samples: { x: number; y: number | null }[] = []
  for (let i = 0; i < initial; i++) {
    const x = low + ((high - low) * i) / (initial - 1)
    samples.push({ x, y: evaluate(x) })
  }

  // The vertical scale to judge bending against: the spread of what has been seen so far.
  const finite = samples.filter((one) => one.y !== null).map((one) => one.y as number)
  if (finite.length === 0) {
    return {
      segments: [],
      evaluations,
      undefinedAt,
      notes: [`The function had no value anywhere in ${low} to ${high}, so there is nothing to draw.`]
    }
  }
  let spread = Math.max(...finite) - Math.min(...finite)
  if (spread === 0 || !Number.isFinite(spread)) spread = Math.max(1, Math.abs(finite[0]))
  const tolerance = (options.tolerance ?? 0.002) * spread

  // Refinement. Each pass subdivides the intervals that bend too much; passes stop when nothing does, or at the ceiling.
  for (let pass = 0; pass < 24 && samples.length < maximum; pass++) {
    const insertions: { at: number; x: number; y: number | null }[] = []
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i]
      const b = samples[i + 1]
      const width = b.x - a.x
      // Below this the interval is narrower than double precision can usefully halve.
      if (width <= Math.abs(a.x) * 1e-13 + 1e-300) continue
      const midX = a.x + width / 2
      if (a.y === null || b.y === null) {
        // An edge of a defined region: refine it, because that is where the interesting boundary is.
        insertions.push({ at: i, x: midX, y: evaluate(midX) })
        continue
      }
      const midY = evaluate(midX)
      if (midY === null) {
        insertions.push({ at: i, x: midX, y: null })
        continue
      }
      const straight = (a.y + b.y) / 2
      if (Math.abs(midY - straight) > tolerance) insertions.push({ at: i, x: midX, y: midY })
    }
    if (insertions.length === 0) break
    // Inserted back to front so earlier indices stay valid.
    for (let k = insertions.length - 1; k >= 0; k--) {
      const one = insertions[k]
      samples.splice(one.at + 1, 0, { x: one.x, y: one.y })
    }
  }

  // Breaks. The typical vertical step between neighbours, by median, which a single pole cannot drag upwards.
  const steps: number[] = []
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i]
    const b = samples[i + 1]
    if (a.y !== null && b.y !== null) steps.push(Math.abs(b.y - a.y))
  }
  const sortedSteps = [...steps].sort((p, q) => p - q)
  const typical = sortedSteps.length === 0 ? 0 : sortedSteps[Math.floor(sortedSteps.length / 2)]
  const breakAt = typical > 0 ? typical * breakFactor : Number.POSITIVE_INFINITY

  const segments: Segment[] = []
  let current: Point[] = []
  let discontinuities = 0
  const close = (why: Segment['endsBecause']): void => {
    if (current.length > 0) {
      segments.push({ points: Object.freeze(current), endsBecause: why })
      current = []
    }
  }
  for (let i = 0; i < samples.length; i++) {
    const one = samples[i]
    if (one.y === null) {
      close('undefined')
      continue
    }
    if (current.length > 0) {
      const previous = current[current.length - 1]
      if (Math.abs(one.y - previous.y) > breakAt) {
        // A jump far bigger than the typical step. Cut rather than draw a line nobody should read as part of the curve.
        close('discontinuity')
        discontinuities += 1
      }
    }
    current.push({ x: one.x, y: one.y })
  }
  close('end')

  const notes = [
    `${samples.length} points from ${evaluations} evaluations, placed where the curve bends rather than evenly.`
  ]
  if (undefinedAt.length > 0) {
    notes.push(`The function had no value at ${undefinedAt.length} of the points tried; the curve is cut there rather than joined across.`)
  }
  if (discontinuities > 0) {
    notes.push(
      `${discontinuities} jump${discontinuities === 1 ? '' : 's'} far larger than the typical step were treated as breaks. No finite number of samples can tell a pole from a very steep curve, so this is a judgement rather than a fact.`
    )
  }
  if (samples.length >= maximum) {
    notes.push(`Refinement stopped at the ${maximum}-point ceiling, so the curve may still be under-sampled somewhere.`)
  }

  return { segments: Object.freeze(segments), evaluations, undefinedAt: Object.freeze(undefinedAt), notes: Object.freeze(notes) }
}

/** A parametric curve: x and y both from a parameter. Sampled on arc-length-ish bending in both coordinates. */
export function sampleParametric(
  fx: (t: number) => number,
  fy: (t: number) => number,
  from: number,
  to: number,
  options: SampleOptions = {}
): SampleResult | PlotError {
  // Sampled as a single function of t returning a packed pair, then unpacked. Refining on y alone would under-sample a
  // curve that moves mostly horizontally, so bending is measured on both coordinates together.
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) {
    return { error: 'invalid-argument', message: 'A parametric range has to be two different finite numbers.' }
  }
  const count = Math.min(PLOT_LIMITS.samples, Math.max(16, Math.round(options.initial ?? 400)))
  const points: { t: number; x: number; y: number }[] = []
  let evaluations = 0
  const undefinedAt: number[] = []
  for (let i = 0; i < count; i++) {
    const t = from + ((to - from) * i) / (count - 1)
    evaluations += 2
    let x: number
    let y: number
    try {
      x = fx(t)
      y = fy(t)
    } catch {
      undefinedAt.push(t)
      continue
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      undefinedAt.push(t)
      continue
    }
    points.push({ t, x, y })
  }
  if (points.length === 0) {
    return { segments: [], evaluations, undefinedAt, notes: ['The curve had no value anywhere in that range.'] }
  }

  // Refine where the direction changes sharply: subdivide any step whose turn exceeds a threshold.
  const refined: { t: number; x: number; y: number }[] = []
  for (let i = 0; i < points.length; i++) {
    refined.push(points[i])
    if (i + 1 >= points.length || refined.length >= PLOT_LIMITS.samples) continue
    const a = points[i]
    const b = points[i + 1]
    const previous = i > 0 ? points[i - 1] : null
    if (previous === null) continue
    const turn = Math.abs(Math.atan2(b.y - a.y, b.x - a.x) - Math.atan2(a.y - previous.y, a.x - previous.x))
    if (turn > 0.2) {
      const t = (a.t + b.t) / 2
      evaluations += 2
      try {
        const x = fx(t)
        const y = fy(t)
        if (Number.isFinite(x) && Number.isFinite(y)) refined.push({ t, x, y })
      } catch {
        undefinedAt.push(t)
      }
    }
  }

  const segments: Segment[] = [
    { points: Object.freeze(refined.map((one) => ({ x: one.x, y: one.y }))), endsBecause: 'end' as const }
  ]
  const notes = [`${refined.length} points along the curve, refined where it turns sharply.`]
  if (undefinedAt.length > 0) notes.push(`The curve had no value at ${undefinedAt.length} parameter values.`)
  return { segments: Object.freeze(segments), evaluations, undefinedAt: Object.freeze(undefinedAt), notes: Object.freeze(notes) }
}

/** A polar curve r(θ), as x and y. A separate entry point because writing it by hand is where sign errors live. */
export const samplePolar = (
  r: (theta: number) => number,
  from = 0,
  to = Math.PI * 2,
  options: SampleOptions = {}
): SampleResult | PlotError =>
  sampleParametric(
    (t) => r(t) * Math.cos(t),
    (t) => r(t) * Math.sin(t),
    from,
    to,
    options
  )

// ---------------------------------------------------------------- decimation

export interface DecimateResult {
  points: readonly Point[]
  /** How many went in, so a Page can say "4000 of 1.2 million" rather than implying it drew them all. */
  original: number
  notes: readonly string[]
}

/**
 * A long series reduced to something drawable, keeping its shape.
 *
 * Each bucket contributes its minimum and its maximum, in the order they occurred. That keeps every spike: a naive stride
 * would delete any peak that fell between the kept samples, which is the difference between a plot you can trust and a
 * plot that happens to look smooth.
 */
export function decimate(points: readonly Point[], target = PLOT_LIMITS.drawablePoints): DecimateResult {
  const usable = points.filter((one) => Number.isFinite(one.x) && Number.isFinite(one.y))
  const limit = Math.max(4, Math.round(target))
  if (usable.length <= limit) {
    return {
      points: Object.freeze([...usable]),
      original: points.length,
      notes:
        usable.length === points.length
          ? []
          : [`${points.length - usable.length} points were not finite numbers and were left out.`]
    }
  }

  // Two points out per bucket, so the bucket count is half the budget.
  const buckets = Math.max(2, Math.floor(limit / 2))
  const width = usable.length / buckets
  const kept: Point[] = []
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * width)
    const end = Math.min(usable.length, Math.floor((b + 1) * width))
    if (end <= start) continue
    let lowest = usable[start]
    let highest = usable[start]
    let lowestAt = start
    let highestAt = start
    for (let i = start + 1; i < end; i++) {
      if (usable[i].y < lowest.y) {
        lowest = usable[i]
        lowestAt = i
      }
      if (usable[i].y > highest.y) {
        highest = usable[i]
        highestAt = i
      }
    }
    // In the order they happened, so the line does not zig-zag backwards through the bucket.
    if (lowestAt === highestAt) kept.push(lowest)
    else if (lowestAt < highestAt) kept.push(lowest, highest)
    else kept.push(highest, lowest)
  }
  return {
    points: Object.freeze(kept),
    original: points.length,
    notes: [
      `${points.length} points reduced to ${kept.length} for drawing. Each bucket keeps its highest and lowest value, so spikes survive; a plain every-nth sample would have deleted them.`
    ]
  }
}

// ---------------------------------------------------------------- ranges and scales

export interface Range {
  low: number
  high: number
}

export type ScaleKind = 'linear' | 'log' | 'symlog'

/** The range a set of values spans, or null when there is nothing finite in it. */
export function rangeOf(values: readonly number[]): Range | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    if (value < low) low = value
    if (value > high) high = value
  }
  if (low > high) return null
  return { low, high }
}

/**
 * A range padded so points do not sit on the frame.
 *
 * A flat series -- every y the same -- has zero width, and a zero-width axis cannot be drawn. It is widened around the
 * value rather than pinned to zero, because a series sitting at 1000 belongs near the middle of the plot and not at the
 * top of a range starting from the origin.
 */
export function padRange(range: Range, fraction = 0.05, includeZero = false): Range {
  let { low, high } = range
  if (includeZero) {
    low = Math.min(low, 0)
    high = Math.max(high, 0)
  }
  const width = high - low
  if (width === 0) {
    const size = Math.abs(low) > 0 ? Math.abs(low) * 0.1 : 1
    return { low: low - size, high: high + size }
  }
  const pad = width * Math.max(0, fraction)
  return { low: low - pad, high: high + pad }
}

export interface Tick {
  value: number
  label: string
  /** A minor tick gets a line but no label. */
  major: boolean
}

/**
 * Tick values a human would have chosen.
 *
 * Steps are 1, 2, 5 or 10 times a power of ten, because those are the intervals people read without arithmetic. A
 * mathematically even division into, say, sevenths is easy to compute and hard to read, which is the wrong trade for an
 * axis.
 */
export function niceTicks(range: Range, count = 6): Tick[] {
  const { low, high } = range
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return []
  const want = Math.min(PLOT_LIMITS.ticks, Math.max(2, Math.round(count)))
  const rough = (high - low) / want
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)))
  const normalised = rough / magnitude
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude
  const first = Math.ceil(low / step) * step
  const ticks: Tick[] = []
  // The decimals needed to write the step without rounding it away.
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  for (let value = first, guard = 0; value <= high + step * 1e-9 && guard <= PLOT_LIMITS.ticks; value += step, guard++) {
    // Re-rounded because repeated addition of a decimal step drifts: 0.1 + 0.1 + 0.1 is not 0.3.
    const exact = Number(value.toFixed(Math.min(20, decimals + 2)))
    ticks.push({ value: exact, label: formatTick(exact, decimals), major: true })
  }
  return ticks
}

/** A tick label. Switches to exponent form where a plain decimal would be unreadably long. */
export function formatTick(value: number, decimals = 0): string {
  if (value === 0) return '0'
  const size = Math.abs(value)
  if (size >= 1e6 || size < 1e-4) {
    return value.toExponential(2).replace('e+', 'e').replace(/\.00e/, 'e')
  }
  return decimals > 0 ? value.toFixed(Math.min(20, decimals)) : String(Number(value.toPrecision(12)))
}

/**
 * Ticks for a log axis: one per decade, with minor ticks at the 2..9 multiples.
 *
 * Evenly spaced values make no sense on a log axis, so this is a different function rather than a flag on the linear one.
 */
export function logTicks(range: Range): Tick[] | PlotError {
  if (range.low <= 0) {
    return { error: 'scale-mismatch', message: 'A log axis cannot start at or below zero.' }
  }
  const firstDecade = Math.floor(Math.log10(range.low))
  const lastDecade = Math.ceil(Math.log10(range.high))
  if (lastDecade - firstDecade > 40) {
    return { error: 'invalid-argument', message: 'That range spans too many decades to tick usefully.' }
  }
  const ticks: Tick[] = []
  // Minor ticks are dropped once the axis is wide, where nine per decade is unreadable clutter.
  const withMinor = lastDecade - firstDecade <= 6
  for (let decade = firstDecade; decade <= lastDecade; decade++) {
    const base = Math.pow(10, decade)
    if (base >= range.low && base <= range.high) {
      ticks.push({ value: base, label: formatTick(base, Math.max(0, -decade)), major: true })
    }
    if (!withMinor) continue
    for (let multiple = 2; multiple <= 9; multiple++) {
      const value = base * multiple
      if (value >= range.low && value <= range.high) ticks.push({ value, label: '', major: false })
    }
  }
  return ticks.sort((a, b) => a.value - b.value)
}

export interface Axis {
  range: Range
  scale: ScaleKind
  ticks: readonly Tick[]
  label: string
  unit: ResolvedUnit | null
  /** Points a log axis could not place. Reported so nothing vanishes without being counted. */
  excluded: number
  notes: readonly string[]
}

export interface AxisOptions {
  scale?: ScaleKind
  label?: string
  unit?: ResolvedUnit | null
  /** Force the range to include zero. Set for bars, where a truncated baseline exaggerates differences. */
  includeZero?: boolean
  pad?: number
  ticks?: number
  /** A range the caller insists on, instead of one taken from the data. */
  range?: Range
  /** For symlog: where the linear region around zero ends. */
  linearThreshold?: number
}

/**
 * An axis for a set of values.
 *
 * On a log scale, zeros and negatives have no position at all. They are counted into `excluded` and reported in the notes
 * rather than dropped, because a plot that quietly loses half its data looks exactly like one that had half as much.
 */
export function axisFor(values: readonly number[], options: AxisOptions = {}): Axis | PlotError {
  const scale = options.scale ?? 'linear'
  const notes: string[] = []
  let excluded = 0
  let usable = values.filter((one) => Number.isFinite(one))
  excluded += values.length - usable.length
  if (excluded > 0) notes.push(`${excluded} values were not finite numbers and have no position on an axis.`)

  if (scale === 'log') {
    const positive = usable.filter((one) => one > 0)
    const lost = usable.length - positive.length
    if (lost > 0) {
      excluded += lost
      notes.push(
        `${lost} values are zero or negative and cannot be shown on a log axis. They are left out, not moved; a log plot of data containing zeros is showing you less than you have.`
      )
    }
    usable = positive
  }

  if (usable.length === 0) {
    if (options.range) {
      const ticks = scale === 'log' ? logTicks(options.range) : niceTicks(options.range, options.ticks)
      return {
        range: options.range,
        scale,
        ticks: Object.freeze(isPlotError(ticks) ? [] : ticks),
        label: options.label ?? '',
        unit: options.unit ?? null,
        excluded,
        notes: Object.freeze([...notes, 'The range was given rather than taken from the data, because no value could be placed.'])
      }
    }
    return { error: 'empty', message: 'There are no values that can be placed on this axis.' }
  }

  const measured = rangeOf(usable)
  if (measured === null) return { error: 'empty', message: 'There are no values that can be placed on this axis.' }

  let range: Range
  if (options.range) {
    range = options.range
    const outside = usable.filter((one) => one < range.low || one > range.high).length
    if (outside > 0) {
      notes.push(`${outside} values fall outside the range that was set and will be drawn off the plot or clipped.`)
    }
  } else if (scale === 'log') {
    // Rounded out to whole decades: a log axis that starts at 3.7 is harder to read than one starting at 1.
    range = { low: Math.pow(10, Math.floor(Math.log10(measured.low))), high: Math.pow(10, Math.ceil(Math.log10(measured.high))) }
    if (range.low === range.high) range = { low: range.low / 10, high: range.high * 10 }
  } else {
    range = padRange(measured, options.pad ?? 0.05, options.includeZero ?? false)
  }

  if (options.includeZero && scale === 'log') {
    notes.push('A log axis cannot include zero, so that request was not applied.')
  }

  const ticks = scale === 'log' ? logTicks(range) : niceTicks(range, options.ticks)
  if (isPlotError(ticks)) return ticks

  if (scale === 'symlog') {
    const threshold = options.linearThreshold ?? 1
    notes.push(
      `Linear between -${threshold} and ${threshold} and logarithmic outside it. The change of scale is real and the axis should be drawn showing where it happens.`
    )
  }

  return {
    range,
    scale,
    ticks: Object.freeze(ticks),
    label: options.label ?? '',
    unit: options.unit ?? null,
    excluded,
    notes: Object.freeze(notes)
  }
}

/**
 * A value's position along an axis, as a fraction from 0 to 1.
 *
 * Null when the value has no position -- a zero on a log axis, a non-number. Returning null rather than clamping to an edge
 * means a Page cannot accidentally draw a point where no point belongs.
 */
export function positionOn(axis: Axis, value: number): number | null {
  if (!Number.isFinite(value)) return null
  const { low, high } = axis.range
  switch (axis.scale) {
    case 'linear': {
      if (high === low) return 0.5
      return (value - low) / (high - low)
    }
    case 'log': {
      if (value <= 0 || low <= 0 || high <= 0) return null
      const span = Math.log10(high) - Math.log10(low)
      if (span === 0) return 0.5
      return (Math.log10(value) - Math.log10(low)) / span
    }
    case 'symlog': {
      // A linear region either side of zero, logarithmic beyond it. Signed so negatives keep their side.
      const transform = (one: number): number => {
        const sign = one < 0 ? -1 : 1
        const size = Math.abs(one)
        return size <= 1 ? one : sign * (1 + Math.log10(size))
      }
      const a = transform(low)
      const b = transform(high)
      if (b === a) return 0.5
      return (transform(value) - a) / (b - a)
    }
  }
}

// ---------------------------------------------------------------- a whole plot

export interface Plot {
  id: string
  title: string
  series: readonly Series[]
  x: Axis
  y: Axis
  /** True when one unit along x should be the same length on screen as one unit along y. Set for geometry. */
  equalAspect: boolean
  notes: readonly string[]
}

export interface PlotOptions {
  title?: string
  x?: AxisOptions
  y?: AxisOptions
  equalAspect?: boolean
}

/**
 * A plot from a set of series.
 *
 * The y axis is forced to include zero for bars and areas. A bar whose baseline is not zero draws a length that is not
 * proportional to its value, which is the most common way a chart misleads without containing a single wrong number -- so
 * it is not offered as an option here.
 */
export function buildPlot(id: string, series: readonly Series[], options: PlotOptions = {}): Plot | PlotError {
  if (series.length === 0) return { error: 'empty', message: 'A plot needs at least one series.' }
  if (series.length > PLOT_LIMITS.seriesPerPlot) {
    return {
      error: 'too-many-points',
      message: `A plot holds at most ${PLOT_LIMITS.seriesPerPlot} series. More than that cannot be told apart.`
    }
  }

  const points = series.flatMap(allPoints)
  if (points.length === 0) return { error: 'empty', message: 'None of these series has a point in it.' }

  const notes: string[] = []
  const baselined = series.some((one) => one.kind === 'bar' || one.kind === 'area')
  if (baselined && options.y?.includeZero === false) {
    notes.push(
      'Bars and areas are drawn from zero whatever was asked for. A bar starting anywhere else draws a length that is not proportional to its value.'
    )
  }

  /*
   * Bars have width, and a bar is centred on its x. An axis that ran exactly from the first x to the last would put
   * half of the first bar and half of the last outside the frame, over the axis numbers. So when there are bars and
   * nobody insisted on a range, the axis runs half a step past each end -- a step being the smallest gap between two
   * bars -- which is exactly the room a group of bars takes.
   */
  const barXs = [...new Set(series.filter((one) => one.kind === 'bar').flatMap((one) => allPoints(one).map((point) => point.x)))].sort((a, b) => a - b)
  let barRange: Range | null = null
  if (barXs.length > 0 && options.x?.range === undefined && (options.x?.scale ?? 'linear') === 'linear') {
    let step = Number.POSITIVE_INFINITY
    for (let i = 1; i < barXs.length; i++) step = Math.min(step, barXs[i] - barXs[i - 1])
    if (!Number.isFinite(step) || step <= 0) step = 1
    const every = points.map((one) => one.x)
    barRange = { low: Math.min(...every) - step / 2, high: Math.max(...every) + step / 2 }
  }

  const x = axisFor(
    points.map((one) => one.x),
    barRange ? { ...options.x, range: barRange, pad: 0 } : options.x
  )
  if (isPlotError(x)) return x
  const y = axisFor(
    points.map((one) => one.y),
    { ...options.y, includeZero: baselined || (options.y?.includeZero ?? false) }
  )
  if (isPlotError(y)) return y

  // A unit on every series, all the same, can go on the axis. A mixture cannot, and saying so is better than picking one.
  const units = new Set(series.map((one) => one.unit?.display ?? ''))
  if (units.size > 1) {
    notes.push('The series are measured in different units, so the y axis carries no unit. Compare them with care.')
  }

  const simulated = series.filter((one) => one.provenance === 'simulated').map((one) => one.label)
  if (simulated.length > 0 && simulated.length < series.length) {
    notes.push(`${simulated.join(', ')} ${simulated.length === 1 ? 'is' : 'are'} simulated, and the rest are not. That difference should be visible in the legend.`)
  }

  const heavy = series.filter((one) => pointCount(one) > PLOT_LIMITS.drawablePoints)
  if (heavy.length > 0) {
    notes.push(`${heavy.length} series ${heavy.length === 1 ? 'has' : 'have'} more points than can be drawn and should be decimated first.`)
  }

  return {
    id,
    title: options.title ?? '',
    series: Object.freeze([...series]),
    x,
    y:
      units.size === 1 && y.unit === null
        ? { ...y, unit: series[0].unit }
        : units.size > 1
          ? { ...y, unit: null }
          : y,
    equalAspect: options.equalAspect ?? false,
    notes: Object.freeze([...notes, ...x.notes.map((one) => `x: ${one}`), ...y.notes.map((one) => `y: ${one}`)])
  }
}

/** A series from plain points, decimated if it is too long to draw. The ordinary way a Page makes one. */
export function seriesFromPoints(
  id: string,
  label: string,
  points: readonly Point[],
  options: {
    kind?: SeriesKind
    unit?: ResolvedUnit | null
    provenance?: Series['provenance']
    errorY?: readonly number[]
    /** Gaps larger than this in x start a new segment instead of being joined across. */
    gapLargerThan?: number
  } = {}
): Series {
  const usable = points.filter((one) => Number.isFinite(one.x) && Number.isFinite(one.y))
  const notes: string[] = []
  if (usable.length !== points.length) {
    notes.push(`${points.length - usable.length} points were not finite numbers and were left out.`)
  }

  let drawable = usable
  if (usable.length > PLOT_LIMITS.drawablePoints) {
    const reduced = decimate(usable)
    drawable = [...reduced.points]
    notes.push(...reduced.notes)
  }

  const segments: Segment[] = []
  let current: Point[] = []
  const gap = options.gapLargerThan
  for (const point of drawable) {
    if (current.length > 0 && gap !== undefined && point.x - current[current.length - 1].x > gap) {
      segments.push({ points: Object.freeze(current), endsBecause: 'gap-in-data' })
      current = []
    }
    current.push(point)
  }
  if (current.length > 0) segments.push({ points: Object.freeze(current), endsBecause: 'end' })

  if (segments.length > 1) {
    notes.push(`The data has ${segments.length - 1} gap${segments.length === 2 ? '' : 's'}, drawn as breaks rather than joined across.`)
  }

  return {
    id,
    label,
    kind: options.kind ?? 'line',
    segments: Object.freeze(segments),
    unit: options.unit ?? null,
    // `unknown` rather than `computed`: a series built from handed-in points has an origin this module cannot see.
    provenance: options.provenance ?? 'unknown',
    errorY: Object.freeze([...(options.errorY ?? [])]),
    notes: Object.freeze(notes)
  }
}

/** A series from a sampled function, keeping the sampler's segments and its notes about breaks. */
export function seriesFromSamples(
  id: string,
  label: string,
  result: SampleResult,
  options: { unit?: ResolvedUnit | null; kind?: SeriesKind } = {}
): Series {
  return {
    id,
    label,
    kind: options.kind ?? 'line',
    segments: result.segments,
    unit: options.unit ?? null,
    provenance: 'computed',
    errorY: Object.freeze([]),
    notes: result.notes
  }
}

/** What every plot here is doing, for a Page that wants to show it. */
export const PLOT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Functions are sampled where they bend, not evenly, so a narrow feature is not missed between samples.',
  'Refinement can only follow bending it has already seen. A feature narrower than the starting grid is never sampled, so a plot of a function with very fine structure needs a finer starting grid, not more refinement.',
  'A jump far larger than the typical step is drawn as a break. No finite sampling can tell a pole from a very steep curve, so this is a judgement.',
  'Long series are reduced by keeping the highest and lowest value of each bucket, so spikes survive. An every-nth sample would delete them.',
  'Bars and areas are always drawn from zero. A bar with any other baseline draws a length that is not proportional to its value.',
  'A log axis cannot show zero or negative values. Those are counted and reported, never quietly dropped.',
  'Series colours are chosen to stay distinguishable under the common forms of colour vision deficiency.',
  'A simulated series is labelled as one, and mixing simulated with measured series is called out.'
])
