import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  checkCandle,
  checkSequence,
  engulfsBody,
  gapBetween,
  geometryOf,
  GEOMETRY_ASSUMPTIONS,
  insideBody,
  MINIMUM_ROLLING_SAMPLE,
  nearlyEqual,
  relativeTo,
  rollingStats
} from './candleGeometry.ts'
import type { Candle } from './indicators.ts'

const candle = (over: Partial<Candle> & { open: number; high: number; low: number; close: number }): Candle => ({
  time: 1_700_000_000_000,
  volume: 100,
  ...over
})

const run = (specs: (Partial<Candle> & { open: number; high: number; low: number; close: number })[], barMs = 60_000): Candle[] =>
  specs.map((one, i) => candle({ time: 1_700_000_000_000 + i * barMs, ...one }))

describe('validating a candle', () => {
  test('a consistent candle passes', () => {
    assert.equal(checkCandle(candle({ open: 10, high: 12, low: 9, close: 11 })).ok, true)
  })

  test('a high below the close is impossible and is refused', () => {
    const result = checkCandle(candle({ open: 10, high: 10.5, low: 9, close: 11 }))
    assert.equal(result.ok, false)
    assert.ok(result.problems.includes('impossible-range'))
  })

  test('a low above the open is impossible', () => {
    assert.equal(checkCandle(candle({ open: 10, high: 12, low: 10.5, close: 11 })).ok, false)
  })

  test('a price that is not a number is refused rather than measured', () => {
    assert.ok(checkCandle(candle({ open: NaN, high: 12, low: 9, close: 11 })).problems.includes('not-finite'))
  })

  test('a negative volume is refused, and a null volume is not', () => {
    assert.ok(checkCandle(candle({ open: 10, high: 12, low: 9, close: 11, volume: -1 })).problems.includes('negative-volume'))
    assert.equal(checkCandle(candle({ open: 10, high: 12, low: 9, close: 11, volume: null })).ok, true)
  })

  test('a volume of zero is a real reading and passes', () => {
    assert.equal(checkCandle(candle({ open: 10, high: 12, low: 9, close: 11, volume: 0 })).ok, true)
  })

  test('a four-price candle is valid, not broken', () => {
    assert.equal(checkCandle(candle({ open: 10, high: 10, low: 10, close: 10 })).ok, true)
  })
})

describe('validating a sequence', () => {
  test('an evenly spaced run passes and reports its spacing', () => {
    const result = checkSequence(run([
      { open: 1, high: 2, low: 1, close: 2 },
      { open: 2, high: 3, low: 2, close: 3 },
      { open: 3, high: 4, low: 3, close: 4 }
    ]))
    assert.equal(result.ok, true)
    assert.equal(result.barMs, 60_000)
  })

  test('the spacing is read off the candles, not from a label', () => {
    // Labelled a minute apart by the caller's expectation; actually four hours.
    const result = checkSequence(run([{ open: 1, high: 2, low: 1, close: 2 }, { open: 2, high: 3, low: 2, close: 3 }], 4 * 3_600_000))
    assert.equal(result.barMs, 4 * 3_600_000)
  })

  test('a candle out of order is reported', () => {
    const candles = run([{ open: 1, high: 2, low: 1, close: 2 }, { open: 2, high: 3, low: 2, close: 3 }])
    candles[1] = { ...(candles[1] as Candle), time: (candles[0] as Candle).time - 1000 }
    assert.ok(checkSequence(candles).problems.some((one) => one.kind === 'out-of-order'))
  })

  test('two candles at the same time are reported', () => {
    const candles = run([{ open: 1, high: 2, low: 1, close: 2 }, { open: 2, high: 3, low: 2, close: 3 }])
    candles[1] = { ...(candles[1] as Candle), time: (candles[0] as Candle).time }
    assert.ok(checkSequence(candles).problems.some((one) => one.kind === 'duplicate-time'))
  })

  test('a missing candle is counted and reported, never filled in', () => {
    const candles = run([
      { open: 1, high: 2, low: 1, close: 2 },
      { open: 2, high: 3, low: 2, close: 3 },
      { open: 3, high: 4, low: 3, close: 4 },
      { open: 4, high: 5, low: 4, close: 5 }
    ])
    candles[3] = { ...(candles[3] as Candle), time: (candles[2] as Candle).time + 180_000 }
    const result = checkSequence(candles)
    const gap = result.problems.find((one) => one.kind === 'gap')
    assert.ok(gap)
    assert.match(gap?.describe ?? '', /2 candles are missing/)
    assert.equal(candles.length, 4, 'nothing was inserted')
  })

  test('a broken candle inside a good sequence is named by index', () => {
    const candles = run([{ open: 1, high: 2, low: 1, close: 2 }, { open: 2, high: 1.5, low: 2, close: 3 }])
    assert.deepEqual(checkSequence(candles).broken, [1])
  })

  test('an empty run says so rather than pretending to check', () => {
    assert.equal(checkSequence([]).barMs, null)
    assert.ok(checkSequence([]).problems.some((one) => one.kind === 'too-short'))
  })
})

describe('measuring a candle', () => {
  test('body, wicks and range come out as the arithmetic says', () => {
    const facts = geometryOf(candle({ open: 100, high: 110, low: 95, close: 105 }))
    assert.equal(facts.range, 15)
    assert.equal(facts.body, 5)
    assert.equal(facts.upperWick, 5)
    assert.equal(facts.lowerWick, 5)
  })

  test('a zero range gives null ratios rather than zero', () => {
    const facts = geometryOf(candle({ open: 10, high: 10, low: 10, close: 10 }))
    assert.equal(facts.range, 0)
    assert.equal(facts.bodyRatio, null)
    assert.equal(facts.upperWickRatio, null)
    assert.equal(facts.closePosition, null)
  })

  test('a candle closing where it opened is neutral, not guessed', () => {
    assert.equal(geometryOf(candle({ open: 100, high: 110, low: 90, close: 100 })).direction, 'doji-neutral')
  })

  test('close position runs from 0 at the low to 1 at the high', () => {
    assert.equal(geometryOf(candle({ open: 95, high: 110, low: 90, close: 110 })).closePosition, 1)
    assert.equal(geometryOf(candle({ open: 95, high: 110, low: 90, close: 90 })).closePosition, 0)
  })

  test('a hammer shape measures as a small body high in a long range', () => {
    const facts = geometryOf(candle({ open: 104, high: 105, low: 95, close: 105 }))
    assert.ok((facts.lowerWickRatio as number) > 0.8)
    assert.ok((facts.bodyRatio as number) < 0.2)
    assert.equal(facts.upperWick, 0)
  })

  test('body percent is against the open, which is how a percent candle is usually meant', () => {
    assert.equal(geometryOf(candle({ open: 100, high: 110, low: 100, close: 102 })).bodyPercent, 2)
  })

  test('a null volume survives measurement as null', () => {
    assert.equal(geometryOf(candle({ open: 1, high: 2, low: 1, close: 2, volume: null })).volume, null)
  })
})

describe('comparing against the recent past', () => {
  const quiet = run(Array.from({ length: 20 }, (_, i) => ({ open: 100 + i * 0.01, high: 100.5 + i * 0.01, low: 99.5 + i * 0.01, close: 100.2 + i * 0.01 })))

  test('the window ends before the candle being judged', () => {
    const big = candle({ open: 100, high: 200, low: 50, close: 190, time: 1 })
    const withBig = [...quiet, big]
    const stats = rollingStats(withBig, withBig.length - 1)
    // The 150-wide candle must not be in the median it is about to be measured against.
    assert.ok((stats.medianRange as number) < 2)
  })

  test('a large candle reads as a large multiple of the median', () => {
    const big = candle({ open: 100, high: 105, low: 99, close: 104 })
    const stats = rollingStats(quiet, quiet.length)
    const relative = relativeTo(geometryOf(big), stats)
    assert.ok((relative.rangeVsMedian as number) > 5)
    assert.equal(relative.reliable, true)
  })

  test('too short a window refuses to call a candle large', () => {
    const stats = rollingStats(quiet.slice(0, MINIMUM_ROLLING_SAMPLE - 1), MINIMUM_ROLLING_SAMPLE - 1)
    const relative = relativeTo(geometryOf(quiet[0] as Candle), stats)
    assert.equal(relative.reliable, false)
    assert.match(relative.describe, /too few/)
  })

  test('a window with no candles reports nothing rather than zero', () => {
    const stats = rollingStats([], 0)
    assert.equal(stats.sample, 0)
    assert.equal(stats.medianRange, null)
    assert.equal(relativeTo(geometryOf(quiet[0] as Candle), stats).rangeVsMedian, null)
  })

  test('candles with no volume give a null median volume, not zero', () => {
    const none = run(Array.from({ length: 10 }, () => ({ open: 1, high: 2, low: 1, close: 2, volume: null })))
    const stats = rollingStats(none, none.length)
    assert.equal(stats.medianVolume, null)
    assert.equal(stats.volumeSample, 0)
  })

  test('a volume of zero is measured, not discarded', () => {
    const some = run(Array.from({ length: 10 }, () => ({ open: 1, high: 2, low: 1, close: 2, volume: 0 })))
    assert.equal(rollingStats(some, some.length).volumeSample, 10)
  })

  test('broken candles are left out of the window rather than measured', () => {
    const mixed = run([
      { open: 1, high: 2, low: 1, close: 2 },
      { open: 2, high: 1, low: 3, close: 2 },
      { open: 1, high: 2, low: 1, close: 2 }
    ])
    assert.equal(rollingStats(mixed, 3).sample, 2)
  })

  test('the true range accounts for a gap that the range alone misses', () => {
    const gapped = run([
      { open: 100, high: 101, low: 99, close: 100 },
      { open: 120, high: 121, low: 119, close: 120 }
    ])
    const stats = rollingStats(gapped, 2)
    assert.ok((stats.atr as number) > (stats.medianRange as number))
  })
})

describe('between two candles', () => {
  const a = geometryOf(candle({ open: 100, high: 105, low: 95, close: 96 }))

  test('a window is only a window when the ranges do not overlap at all', () => {
    const overlapping = geometryOf(candle({ open: 97, high: 104, low: 94, close: 103 }))
    assert.equal(gapBetween(a, overlapping).isWindow, false)

    const clear = geometryOf(candle({ open: 110, high: 115, low: 108, close: 114 }))
    const gap = gapBetween(a, clear)
    assert.equal(gap.isWindow, true)
    assert.equal(gap.direction, 'up')
    assert.equal(gap.rangeGap, 3)
  })

  test('a body gap without a range gap is reported as a body gap only', () => {
    const later = geometryOf(candle({ open: 101, high: 106, low: 94, close: 104 }))
    const gap = gapBetween(a, later)
    assert.equal(gap.isWindow, false)
    assert.ok(gap.bodyGap > 0)
  })

  test('engulfing needs the whole body covered and a bigger body', () => {
    const small = geometryOf(candle({ open: 100, high: 102, low: 99, close: 101 }))
    const big = geometryOf(candle({ open: 99, high: 103, low: 98, close: 102 }))
    assert.equal(engulfsBody(big, small), true)
    assert.equal(engulfsBody(small, big), false)
  })

  test('an equal-sized body does not engulf', () => {
    const one = geometryOf(candle({ open: 100, high: 102, low: 99, close: 101 }))
    const two = geometryOf(candle({ open: 101, high: 103, low: 98, close: 100 }))
    assert.equal(engulfsBody(two, one), false)
  })

  test('inside is the mirror of engulfing', () => {
    const small = geometryOf(candle({ open: 100, high: 102, low: 99, close: 101 }))
    const big = geometryOf(candle({ open: 99, high: 103, low: 98, close: 102 }))
    assert.equal(insideBody(small, big), true)
    assert.equal(insideBody(big, small), false)
  })

  test('nearly-equal is relative, so it works on both large and tiny prices', () => {
    assert.equal(nearlyEqual(50_000, 50_001, 1000, 0.01), true)
    assert.equal(nearlyEqual(0.0000040, 0.0000041, 0.0000010, 0.2), true)
    assert.equal(nearlyEqual(50_000, 51_000, 1000, 0.01), false)
  })

  test('nearly-equal with no scale falls back to exact equality rather than accepting anything', () => {
    assert.equal(nearlyEqual(1, 1.0001, 0, 0.5), false)
    assert.equal(nearlyEqual(1, 1, 0, 0.5), true)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and name the null-ratio rule', () => {
    assert.equal(Object.isFrozen(GEOMETRY_ASSUMPTIONS), true)
    assert.ok(GEOMETRY_ASSUMPTIONS.some((one) => /never as zero/.test(one)))
    assert.ok(GEOMETRY_ASSUMPTIONS.some((one) => /trades continuously/.test(one)))
  })
})
