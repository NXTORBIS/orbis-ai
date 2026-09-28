import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLOT_ASSUMPTIONS,
  PLOT_LIMITS,
  SERIES_COLOURS,
  allPoints,
  axisFor,
  buildPlot,
  colourFor,
  decimate,
  formatTick,
  isPlotError,
  logTicks,
  niceTicks,
  padRange,
  pointCount,
  positionOn,
  rangeOf,
  sampleFunction,
  sampleParametric,
  samplePolar,
  seriesFromPoints,
  seriesFromSamples,
  type Axis,
  type SampleResult
} from './plot.ts'

const ok = <T>(value: T): Exclude<T, { error: string }> => {
  assert.ok(!isPlotError(value), `expected success, got ${JSON.stringify(value)}`)
  return value as Exclude<T, { error: string }>
}

const flat = (result: SampleResult): { x: number; y: number }[] => result.segments.flatMap((one) => [...one.points])

describe('adaptive function sampling', () => {
  it('puts more points where the curve bends than where it is straight', () => {
    // A line over most of the range with a sharp bump in the middle.
    const result = ok(sampleFunction((x) => Math.exp(-((x - 5) ** 2) * 200), 0, 10, { initial: 32 }))
    const points = flat(result)
    const nearBump = points.filter((one) => Math.abs(one.x - 5) < 0.5).length
    const farAway = points.filter((one) => one.x < 2).length
    assert.ok(nearBump > farAway, `expected refinement near the bump: ${nearBump} vs ${farAway}`)
  })

  it('resolves a feature the starting grid only barely touches', () => {
    // Centred at 5.137 rather than 5, so repeated bisection of 0 to 10 never lands on the peak by luck.
    const spike = (x: number): number => Math.exp(-((x - 5.137) ** 2) * 200)
    const result = ok(sampleFunction(spike, 0, 10, { initial: 64, maximum: 4000 }))
    const points = flat(result)
    assert.ok(Math.max(...points.map((one) => one.y)) > 0.9, 'refinement did not resolve the peak')

    // And it got there by concentrating points, not by sampling the whole range finely.
    const near = points.filter((one) => Math.abs(one.x - 5.137) < 0.2).length
    const densityNearPeak = near / 0.4
    const densityOverall = points.length / 10
    assert.ok(densityNearPeak > densityOverall * 3, `points were not concentrated: ${densityNearPeak} vs ${densityOverall}`)
  })

  it('misses a feature narrower than its starting grid, and this is a real limit rather than a bug', () => {
    // Half-width about 0.0003, centred off any bisection midpoint. A 32-point grid over 0 to 10 steps straight over it,
    // so there is no bending to detect and refinement never looks there. No adaptive scheme can find a feature it never
    // sampled; the answer is a finer starting grid, which is why `initial` is the caller's choice and not a fixed number.
    const needle = (x: number): number => Math.exp(-((x - 5.137) ** 2) * 5e6)
    const coarse = ok(sampleFunction(needle, 0, 10, { initial: 32, maximum: 8000 }))
    assert.ok(Math.max(...flat(coarse).map((one) => one.y)) < 0.01, 'the premise of this test no longer holds')

    const fine = ok(sampleFunction(needle, 0, 10, { initial: 20_000, maximum: 20_000 }))
    assert.ok(Math.max(...flat(fine).map((one) => one.y)) > 0.3, 'a fine enough starting grid should find it')
  })

  it('cuts the curve at a pole rather than drawing a line through it', () => {
    const result = ok(sampleFunction((x) => 1 / x, -5, 5, { initial: 64 }))
    assert.ok(result.segments.length >= 2, 'expected the curve to be broken at the pole')
    assert.ok(result.segments.some((one) => one.endsBecause === 'discontinuity' || one.endsBecause === 'undefined'))
    // Nothing should join a large negative directly to a large positive.
    for (const segment of result.segments) {
      for (let i = 0; i + 1 < segment.points.length; i++) {
        assert.ok(!(segment.points[i].y < -10 && segment.points[i + 1].y > 10))
      }
    }
  })

  it('says outright that a break is a judgement rather than a fact', () => {
    const result = ok(sampleFunction((x) => Math.tan(x), -1.5, 1.5, { initial: 64 }))
    assert.ok(result.notes.some((note) => /judgement rather than a fact/.test(note)) || result.segments.length === 1)
  })

  it('counts the points where the function had no value', () => {
    const result = ok(sampleFunction((x) => Math.sqrt(x), -1, 4, { initial: 32 }))
    assert.ok(result.undefinedAt.length > 0)
    assert.ok(result.notes.some((note) => /no value at/.test(note)))
  })

  it('survives a function that throws, treating the point as undefined', () => {
    const result = ok(
      sampleFunction(
        (x) => {
          if (x > 1 && x < 2) throw new Error('nope')
          return x
        },
        0,
        3,
        { initial: 32 }
      )
    )
    assert.ok(result.undefinedAt.length > 0)
    assert.ok(flat(result).length > 0)
  })

  it('returns nothing to draw, rather than an error, for a function defined nowhere', () => {
    const result = ok(sampleFunction(() => Number.NaN, 0, 1))
    assert.equal(result.segments.length, 0)
    assert.ok(result.notes.some((note) => /nothing to draw/.test(note)))
  })

  it('refuses a range with no width', () => {
    const bad = sampleFunction((x) => x, 1, 1)
    assert.ok(isPlotError(bad))
    assert.equal(bad.error, 'invalid-argument')
  })

  it('refuses a range that is not finite', () => {
    assert.ok(isPlotError(sampleFunction((x) => x, 0, Number.POSITIVE_INFINITY)))
  })

  it('stops at the ceiling and says so', () => {
    const result = ok(sampleFunction((x) => Math.sin(1 / (x + 1e-9)), 0, 1, { initial: 64, maximum: 300 }))
    assert.ok(flat(result).length <= 400)
    assert.ok(result.notes.some((note) => /ceiling/.test(note)))
  })

  it('does not break a smooth curve into pieces', () => {
    const result = ok(sampleFunction((x) => Math.sin(x), 0, Math.PI * 2, { initial: 64 }))
    assert.equal(result.segments.length, 1)
    assert.equal(result.segments[0].endsBecause, 'end')
  })

  it('reports how many times it called the function', () => {
    const result = ok(sampleFunction((x) => x, 0, 1, { initial: 16 }))
    assert.ok(result.evaluations >= 16)
  })

  it('samples a range given backwards the same way', () => {
    const forward = ok(sampleFunction((x) => x * x, 0, 4, { initial: 16 }))
    const backward = ok(sampleFunction((x) => x * x, 4, 0, { initial: 16 }))
    assert.equal(flat(forward).length, flat(backward).length)
    assert.equal(flat(backward)[0].x, 0)
  })
})

describe('parametric and polar curves', () => {
  it('draws a circle that closes', () => {
    const result = ok(
      sampleParametric(
        (t) => Math.cos(t),
        (t) => Math.sin(t),
        0,
        Math.PI * 2,
        { initial: 200 }
      )
    )
    const points = flat(result)
    assert.ok(Math.abs(points[0].x - points[points.length - 1].x) < 1e-9)
    // Every point is on the unit circle.
    for (const one of points) assert.ok(Math.abs(Math.hypot(one.x, one.y) - 1) < 1e-9)
  })

  it('refines where the curve turns sharply', () => {
    const smooth = ok(
      sampleParametric(
        (t) => t,
        (t) => t,
        0,
        1,
        { initial: 50 }
      )
    )
    const sharp = ok(
      sampleParametric(
        (t) => Math.cos(t) ** 3,
        (t) => Math.sin(t) ** 3,
        0,
        Math.PI * 2,
        { initial: 50 }
      )
    )
    assert.equal(flat(smooth).length, 50)
    assert.ok(flat(sharp).length > 50)
  })

  it('plots a polar rose with the right number of petals reaching the right radius', () => {
    const result = ok(samplePolar((theta) => Math.cos(3 * theta), 0, Math.PI, { initial: 400 }))
    const radii = flat(result).map((one) => Math.hypot(one.x, one.y))
    assert.ok(Math.max(...radii) <= 1 + 1e-9)
    assert.ok(Math.max(...radii) > 0.99)
  })

  it('counts parameter values where the curve had no value', () => {
    const result = ok(
      sampleParametric(
        (t) => 1 / t,
        (t) => t,
        0,
        1,
        { initial: 20 }
      )
    )
    assert.ok(result.undefinedAt.length > 0)
  })

  it('refuses a parametric range with no width', () => {
    assert.ok(
      isPlotError(
        sampleParametric(
          (t) => t,
          (t) => t,
          2,
          2
        )
      )
    )
  })
})

describe('decimation', () => {
  it('keeps a spike that an every-nth sample would delete', () => {
    const points = Array.from({ length: 100_000 }, (_, i) => ({ x: i, y: i === 54_321 ? 1000 : 0 }))
    const result = decimate(points, 2000)
    assert.ok(result.points.length <= 2000)
    assert.ok(result.points.some((one) => one.y === 1000), 'the spike was lost')
    assert.equal(result.original, 100_000)
  })

  it('keeps the trough as well as the peak', () => {
    const points = Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: i === 100 ? -99 : i === 200 ? 99 : 0 }))
    const result = decimate(points, 1000)
    assert.ok(result.points.some((one) => one.y === -99))
    assert.ok(result.points.some((one) => one.y === 99))
  })

  it('keeps the points in the order they occurred', () => {
    const points = Array.from({ length: 20_000 }, (_, i) => ({ x: i, y: Math.sin(i / 100) }))
    const result = decimate(points, 500)
    for (let i = 0; i + 1 < result.points.length; i++) {
      assert.ok(result.points[i].x <= result.points[i + 1].x, 'decimation reordered the series')
    }
  })

  it('leaves a short series alone', () => {
    const points = [
      { x: 0, y: 1 },
      { x: 1, y: 2 }
    ]
    const result = decimate(points, 100)
    assert.deepEqual([...result.points], points)
    assert.deepEqual([...result.notes], [])
  })

  it('leaves out points that are not finite and says how many', () => {
    const result = decimate([{ x: 0, y: 1 }, { x: 1, y: Number.NaN }], 100)
    assert.equal(result.points.length, 1)
    assert.ok(result.notes.some((note) => /were not finite/.test(note)))
  })

  it('explains that an every-nth sample would have lost the spikes', () => {
    const points = Array.from({ length: 10_000 }, (_, i) => ({ x: i, y: i }))
    assert.ok(decimate(points, 200).notes.some((note) => /every-nth/.test(note)))
  })
})

describe('ranges', () => {
  it('finds the span of a set of values', () => {
    assert.deepEqual(rangeOf([3, 1, 4, 1, 5]), { low: 1, high: 5 })
  })

  it('ignores values that are not finite', () => {
    assert.deepEqual(rangeOf([1, Number.NaN, 5, Number.POSITIVE_INFINITY]), { low: 1, high: 5 })
  })

  it('has no range when nothing is finite', () => {
    assert.equal(rangeOf([Number.NaN]), null)
    assert.equal(rangeOf([]), null)
  })

  it('pads a range away from the frame', () => {
    const padded = padRange({ low: 0, high: 10 }, 0.1)
    assert.deepEqual(padded, { low: -1, high: 11 })
  })

  it('widens a flat range around its value rather than pinning it to zero', () => {
    const padded = padRange({ low: 1000, high: 1000 })
    assert.ok(padded.low > 0, 'a flat series at 1000 should not get a range starting below zero')
    assert.ok(padded.low < 1000 && padded.high > 1000)
  })

  it('widens a flat range at zero to something drawable', () => {
    assert.deepEqual(padRange({ low: 0, high: 0 }), { low: -1, high: 1 })
  })

  it('can be told to include zero', () => {
    assert.equal(padRange({ low: 5, high: 10 }, 0, true).low, 0)
  })
})

describe('ticks', () => {
  it('chooses steps a human would have chosen', () => {
    const values = niceTicks({ low: 0, high: 10 }, 5).map((one) => one.value)
    assert.deepEqual(values, [0, 2, 4, 6, 8, 10])
  })

  it('does not drift when the step is a decimal', () => {
    const values = niceTicks({ low: 0, high: 1 }, 10).map((one) => one.value)
    assert.ok(values.includes(0.3), `0.1 + 0.1 + 0.1 drifted: ${values.join(', ')}`)
    assert.ok(values.every((one) => Math.abs(one * 10 - Math.round(one * 10)) < 1e-9))
  })

  it('produces no ticks for a range with no width', () => {
    assert.deepEqual(niceTicks({ low: 5, high: 5 }), [])
  })

  it('stays inside the range', () => {
    for (const tick of niceTicks({ low: 1.3, high: 8.7 }, 6)) {
      assert.ok(tick.value >= 1.3 && tick.value <= 8.7)
    }
  })

  it('writes very large and very small numbers in exponent form', () => {
    assert.match(formatTick(1.2e9, 0), /e/)
    assert.match(formatTick(3e-7, 0), /e/)
    assert.equal(formatTick(0), '0')
  })

  it('gives a log axis one major tick per decade', () => {
    const ticks = ok(logTicks({ low: 1, high: 1000 }))
    const majors = ticks.filter((one) => one.major).map((one) => one.value)
    assert.deepEqual(majors, [1, 10, 100, 1000])
  })

  it('adds minor ticks inside a decade when the axis is narrow', () => {
    const ticks = ok(logTicks({ low: 1, high: 10 }))
    assert.ok(ticks.some((one) => !one.major && one.value === 5))
  })

  it('drops minor ticks when the axis spans many decades, where they are clutter', () => {
    const ticks = ok(logTicks({ low: 1, high: 1e10 }))
    assert.ok(ticks.every((one) => one.major))
  })

  it('refuses a log axis that starts at zero', () => {
    const bad = logTicks({ low: 0, high: 100 })
    assert.ok(isPlotError(bad))
    assert.equal(bad.error, 'scale-mismatch')
  })

  it('refuses a log range spanning absurdly many decades', () => {
    assert.ok(isPlotError(logTicks({ low: 1e-200, high: 1e200 })))
  })
})

describe('axes', () => {
  it('builds a linear axis from values', () => {
    const axis = ok(axisFor([1, 2, 3, 4, 5], { label: 'time' }))
    assert.equal(axis.scale, 'linear')
    assert.equal(axis.label, 'time')
    assert.ok(axis.range.low < 1 && axis.range.high > 5)
    assert.ok(axis.ticks.length > 0)
  })

  it('counts values a log axis cannot show instead of dropping them silently', () => {
    const axis = ok(axisFor([0, 1, 10, 100, -5], { scale: 'log' }))
    assert.equal(axis.excluded, 2)
    assert.ok(axis.notes.some((note) => /showing you less than you have/.test(note)))
  })

  it('rounds a log axis out to whole decades', () => {
    const axis = ok(axisFor([3.7, 420], { scale: 'log' }))
    assert.equal(axis.range.low, 1)
    assert.equal(axis.range.high, 1000)
  })

  it('counts values that are not numbers', () => {
    const axis = ok(axisFor([1, 2, Number.NaN], {}))
    assert.equal(axis.excluded, 1)
  })

  it('says when values fall outside a range that was set', () => {
    const axis = ok(axisFor([1, 2, 50], { range: { low: 0, high: 10 } }))
    assert.ok(axis.notes.some((note) => /outside the range/.test(note)))
  })

  it('refuses an axis with nothing placeable on it', () => {
    const bad = axisFor([0, -1], { scale: 'log' })
    assert.ok(isPlotError(bad))
    assert.equal(bad.error, 'empty')
  })

  it('uses a given range even when nothing can be placed', () => {
    const axis = ok(axisFor([0, -1], { scale: 'log', range: { low: 1, high: 100 } }))
    assert.equal(axis.range.low, 1)
    assert.ok(axis.notes.some((note) => /was given rather than taken/.test(note)))
  })

  it('says that a log axis cannot honour a request to include zero', () => {
    const axis = ok(axisFor([1, 10], { scale: 'log', includeZero: true }))
    assert.ok(axis.notes.some((note) => /cannot include zero/.test(note)))
  })

  it('explains where a symlog axis changes scale', () => {
    const axis = ok(axisFor([-100, 0, 100], { scale: 'symlog' }))
    assert.ok(axis.notes.some((note) => /Linear between/.test(note)))
  })
})

describe('positions on an axis', () => {
  const linear: Axis = {
    range: { low: 0, high: 10 },
    scale: 'linear',
    ticks: [],
    label: '',
    unit: null,
    excluded: 0,
    notes: []
  }

  it('places a value proportionally on a linear axis', () => {
    assert.equal(positionOn(linear, 5), 0.5)
    assert.equal(positionOn(linear, 0), 0)
    assert.equal(positionOn(linear, 10), 1)
  })

  it('places a value beyond the range outside 0 to 1, rather than clamping it', () => {
    assert.equal(positionOn(linear, 20), 2)
  })

  it('has no position for a value that is not a number', () => {
    assert.equal(positionOn(linear, Number.NaN), null)
  })

  it('places a value logarithmically on a log axis', () => {
    const log: Axis = { ...linear, range: { low: 1, high: 1000 }, scale: 'log' }
    assert.ok(Math.abs((positionOn(log, 10) ?? 0) - 1 / 3) < 1e-12)
  })

  it('has no position for zero on a log axis, rather than putting it at the edge', () => {
    const log: Axis = { ...linear, range: { low: 1, high: 1000 }, scale: 'log' }
    assert.equal(positionOn(log, 0), null)
    assert.equal(positionOn(log, -5), null)
  })

  it('keeps negatives on their own side of a symlog axis', () => {
    const symlog: Axis = { ...linear, range: { low: -1000, high: 1000 }, scale: 'symlog' }
    assert.ok((positionOn(symlog, -100) ?? 1) < 0.5)
    assert.ok((positionOn(symlog, 100) ?? 0) > 0.5)
    assert.ok(Math.abs((positionOn(symlog, 0) ?? 0) - 0.5) < 1e-12)
  })

  it('puts a value in the middle of a zero-width axis rather than dividing by zero', () => {
    assert.equal(positionOn({ ...linear, range: { low: 3, high: 3 } }, 3), 0.5)
  })
})

describe('series', () => {
  it('breaks a series at a gap rather than joining across it', () => {
    const series = seriesFromPoints(
      's',
      'Readings',
      [
        { x: 0, y: 1 },
        { x: 1, y: 2 },
        { x: 100, y: 3 }
      ],
      { gapLargerThan: 5 }
    )
    assert.equal(series.segments.length, 2)
    assert.equal(series.segments[0].endsBecause, 'gap-in-data')
    assert.ok(series.notes.some((note) => /drawn as breaks/.test(note)))
  })

  it('decimates a series that is too long to draw', () => {
    const points = Array.from({ length: 50_000 }, (_, i) => ({ x: i, y: Math.sin(i / 50) }))
    const series = seriesFromPoints('s', 'Long', points)
    assert.ok(pointCount(series) <= PLOT_LIMITS.drawablePoints)
    assert.ok(series.notes.some((note) => /reduced to/.test(note)))
  })

  it('defaults provenance to unknown rather than claiming the points were computed', () => {
    assert.equal(seriesFromPoints('s', 'x', [{ x: 0, y: 0 }]).provenance, 'unknown')
  })

  it('marks a sampled function as computed', () => {
    const sampled = ok(sampleFunction((x) => x, 0, 1, { initial: 8 }))
    assert.equal(seriesFromSamples('s', 'f', sampled).provenance, 'computed')
  })

  it('carries the sampler notes onto the series', () => {
    const sampled = ok(sampleFunction((x) => Math.sqrt(x), -1, 1, { initial: 16 }))
    assert.ok(seriesFromSamples('s', 'f', sampled).notes.some((note) => /no value at/.test(note)))
  })

  it('flattens every point across segments', () => {
    const series = seriesFromPoints(
      's',
      'x',
      [
        { x: 0, y: 0 },
        { x: 50, y: 1 }
      ],
      { gapLargerThan: 1 }
    )
    assert.equal(allPoints(series).length, 2)
    assert.equal(pointCount(series), 2)
  })

  it('leaves out points that are not finite and says how many', () => {
    const series = seriesFromPoints('s', 'x', [{ x: 0, y: 0 }, { x: 1, y: Number.NaN }])
    assert.equal(pointCount(series), 1)
    assert.ok(series.notes.some((note) => /were not finite/.test(note)))
  })
})

describe('colours', () => {
  it('uses a palette that stays distinguishable for colourblind readers', () => {
    assert.ok(SERIES_COLOURS.length >= 8)
    assert.equal(new Set(SERIES_COLOURS).size, SERIES_COLOURS.length)
  })

  it('wraps round the palette, including for a negative index', () => {
    assert.equal(colourFor(0), SERIES_COLOURS[0])
    assert.equal(colourFor(SERIES_COLOURS.length), SERIES_COLOURS[0])
    assert.equal(colourFor(-1), SERIES_COLOURS[SERIES_COLOURS.length - 1])
  })
})

describe('building a plot', () => {
  const line = (id: string, ys: number[]): ReturnType<typeof seriesFromPoints> =>
    seriesFromPoints(id, id, ys.map((y, x) => ({ x, y })))

  it('builds axes covering every series', () => {
    const plot = ok(buildPlot('p', [line('a', [1, 2, 3]), line('b', [10, 20, 30])], { title: 'Two' }))
    assert.equal(plot.title, 'Two')
    assert.ok(plot.y.range.high >= 30)
    assert.ok(plot.y.range.low <= 1)
  })

  it('always baselines bars at zero, whatever was asked for', () => {
    const bars = seriesFromPoints('b', 'Bars', [
      { x: 0, y: 100 },
      { x: 1, y: 102 }
    ], { kind: 'bar' })
    const plot = ok(buildPlot('p', [bars], { y: { includeZero: false } }))
    assert.ok(plot.y.range.low <= 0, 'a bar chart must not have a truncated value axis')
    assert.ok(plot.notes.some((note) => /not proportional to its value/.test(note)))
  })

  it('says when series are measured in different units', () => {
    const metres = seriesFromPoints('a', 'a', [{ x: 0, y: 1 }], { unit: { display: 'm', dimension: { L: 1 }, factor: 1, offset: 0, single: null } })
    const seconds = seriesFromPoints('b', 'b', [{ x: 0, y: 1 }], { unit: { display: 's', dimension: { T: 1 }, factor: 1, offset: 0, single: null } })
    const plot = ok(buildPlot('p', [metres, seconds]))
    assert.equal(plot.y.unit, null)
    assert.ok(plot.notes.some((note) => /different units/.test(note)))
  })

  it('puts a shared unit on the y axis', () => {
    const unit = { display: 'm', dimension: { L: 1 }, factor: 1, offset: 0, single: null }
    const plot = ok(buildPlot('p', [seriesFromPoints('a', 'a', [{ x: 0, y: 1 }], { unit })]))
    assert.equal(plot.y.unit?.display, 'm')
  })

  it('calls out a simulated series drawn beside a measured one', () => {
    const measured = seriesFromPoints('a', 'Measured', [{ x: 0, y: 1 }], { provenance: 'measured' })
    const simulated = seriesFromPoints('b', 'Model', [{ x: 0, y: 2 }], { provenance: 'simulated' })
    const plot = ok(buildPlot('p', [measured, simulated]))
    assert.ok(plot.notes.some((note) => /Model is simulated/.test(note)))
  })

  it('does not call it out when every series is simulated', () => {
    const a = seriesFromPoints('a', 'A', [{ x: 0, y: 1 }], { provenance: 'simulated' })
    const b = seriesFromPoints('b', 'B', [{ x: 0, y: 2 }], { provenance: 'simulated' })
    assert.ok(!ok(buildPlot('p', [a, b])).notes.some((note) => /simulated, and the rest/.test(note)))
  })

  it('refuses a plot with no series', () => {
    const bad = buildPlot('p', [])
    assert.ok(isPlotError(bad))
    assert.equal(bad.error, 'empty')
  })

  it('refuses a plot whose series are all empty', () => {
    assert.ok(isPlotError(buildPlot('p', [seriesFromPoints('a', 'a', [])])))
  })

  it('refuses more series than can be told apart', () => {
    const many = Array.from({ length: PLOT_LIMITS.seriesPerPlot + 1 }, (_, i) =>
      seriesFromPoints(`s${i}`, `s${i}`, [{ x: 0, y: i }])
    )
    const bad = buildPlot('p', many)
    assert.ok(isPlotError(bad))
    assert.equal(bad.error, 'too-many-points')
  })

  it('carries the axis notes up onto the plot, labelled by axis', () => {
    const plot = ok(buildPlot('p', [line('a', [1, 10, 100])], { y: { scale: 'log' } }))
    assert.ok(plot.notes.every((note) => typeof note === 'string'))
    const logged = ok(buildPlot('p', [seriesFromPoints('a', 'a', [{ x: 0, y: 0 }, { x: 1, y: 10 }])], { y: { scale: 'log' } }))
    assert.ok(logged.notes.some((note) => note.startsWith('y: ')))
  })

  it('records an equal aspect when asked for one', () => {
    assert.equal(ok(buildPlot('p', [line('a', [1, 2])], { equalAspect: true })).equalAspect, true)
  })
})

describe('assumptions', () => {
  it('states what every plot here is doing', () => {
    assert.ok(PLOT_ASSUMPTIONS.length >= 6)
    assert.ok(PLOT_ASSUMPTIONS.some((one) => /bend/.test(one)))
    assert.ok(PLOT_ASSUMPTIONS.some((one) => /Bars and areas are always drawn from zero/.test(one)))
    assert.ok(PLOT_ASSUMPTIONS.some((one) => /colour vision deficiency/.test(one)))
  })
})
