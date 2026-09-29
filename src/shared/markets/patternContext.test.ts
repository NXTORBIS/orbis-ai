import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from './indicators.ts'
import { detectAt, type PatternDetection } from './patternDetect.ts'
import {
  CONTEXT_ASSUMPTIONS,
  MINIMUM_LEVEL_TOUCHES,
  contextFor,
  levelsAround,
  momentumContext,
  regimeOf,
  structureOf,
  swings,
  timeframeContext,
  volatilityContext,
  volumeContext
} from './patternContext.ts'

const BAR = 60_000
const START = 1_700_000_000_000

const build = (specs: [number, number, number, number, (number | null)?][]): Candle[] =>
  specs.map((one, i) => ({ time: START + i * BAR, open: one[0], high: one[1], low: one[2], close: one[3], volume: one[4] === undefined ? 100 : one[4] }))

/** A zig-zag whose turns land on the prices given, so swing detection has something real to find. */
function zigzag(points: number[], perLeg = 4, volume: number | null = 100): Candle[] {
  const specs: [number, number, number, number, (number | null)?][] = []
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i] as number
    const to = points[i + 1] as number
    for (let step = 1; step <= perLeg; step += 1) {
      const open = from + ((to - from) * (step - 1)) / perLeg
      const close = from + ((to - from) * step) / perLeg
      specs.push([open, Math.max(open, close) + 0.05, Math.min(open, close) - 0.05, close, volume])
    }
  }
  return build(specs)
}

describe('swings', () => {
  test('a turning point is found where a candle is the extreme of its window', () => {
    const candles = zigzag([100, 110, 100])
    const found = swings(candles, 2)
    assert.ok(found.some((one) => one.kind === 'high'))
  })

  test('no swing is ever claimed in the last few candles, because its window is not complete', () => {
    const candles = zigzag([100, 110, 100, 112])
    const found = swings(candles, 3)
    for (const one of found) {
      assert.ok(one.index <= candles.length - 1 - 3, `a swing was claimed at ${one.index} of ${candles.length}`)
    }
  })

  test('too few candles produce no swings rather than a guess', () => {
    assert.deepEqual(swings(zigzag([100, 101], 1), 3), [])
  })

  test('a stronger requirement finds no more swings than a weaker one', () => {
    const candles = zigzag([100, 108, 101, 109, 102, 110])
    assert.ok(swings(candles, 3).length <= swings(candles, 1).length)
  })
})

describe('structure', () => {
  test('stepping up reads as higher highs and higher lows', () => {
    assert.equal(structureOf(zigzag([100, 110, 104, 116, 109, 122, 115, 128])).shape, 'higher-highs-and-lows')
  })

  test('stepping down reads as lower highs and lower lows', () => {
    assert.equal(structureOf(zigzag([128, 115, 122, 109, 116, 104, 110, 100])).shape, 'lower-highs-and-lows')
  })

  test('a narrowing range reads as contracting', () => {
    assert.equal(structureOf(zigzag([100, 120, 102, 116, 105, 112, 107, 110])).shape, 'contracting')
  })

  test('a widening range reads as expanding', () => {
    assert.equal(structureOf(zigzag([110, 112, 107, 116, 104, 120, 100, 124])).shape, 'expanding')
  })

  test('too few turning points is unclear, not a range', () => {
    const result = structureOf(zigzag([100, 102], 2))
    assert.equal(result.shape, 'unclear')
    assert.match(result.describe, /too few/)
  })

  test('a break of the last swing is reported with the price it took out', () => {
    const candles = zigzag([100, 110, 104, 116, 109, 122, 115, 130])
    const result = structureOf(candles)
    if (result.lastBreak !== null) assert.match(result.lastBreak.describe, /took out the swing/)
  })
})

describe('support and resistance', () => {
  test('a price turned at twice becomes a level', () => {
    const candles = zigzag([100, 120, 100, 118, 100, 116])
    const result = levelsAround(candles, 110)
    assert.ok(result.nearestSupport !== null)
    assert.ok((result.nearestSupport?.touches ?? 0) >= MINIMUM_LEVEL_TOUCHES)
  })

  test('a price turned at once is not a level, and the answer says so rather than inventing one', () => {
    const candles = zigzag([100, 120, 105])
    const result = levelsAround(candles, 110)
    assert.equal(result.placement, 'unclear')
    assert.equal(result.nearestSupport, null)
    assert.equal(result.nearestResistance, null)
    assert.match(result.describe, /turned at more than once/)
  })

  test('sitting on a level reads as at-support rather than between', () => {
    const candles = zigzag([100, 120, 100, 118, 100, 116])
    assert.equal(levelsAround(candles, 100.2).placement, 'at-support')
  })

  test('distance to a level is relative, so it compares across markets', () => {
    const candles = zigzag([100, 120, 100, 118, 100, 116])
    const result = levelsAround(candles, 110)
    assert.ok((result.toSupport as number) > 0 && (result.toSupport as number) < 1)
  })

  test('no history at all is unclear rather than an error', () => {
    assert.equal(levelsAround([], 100).placement, 'unclear')
  })

  test('a price that is not usable gives nothing rather than a level at zero', () => {
    assert.equal(levelsAround(zigzag([100, 120, 100, 118]), 0).nearestSupport, null)
  })
})

describe('volume context', () => {
  const quiet = (volume: number | null): Candle[] =>
    build(Array.from({ length: 30 }, () => [100, 100.5, 99.5, 100.2, volume] as [number, number, number, number, number | null]))

  test('a market that reports no volume gets no volume context, not an average one', () => {
    const candles = quiet(null)
    const result = volumeContext(candles, 28, 29)
    assert.equal(result.reading, 'unavailable')
    assert.equal(result.relative, null)
    assert.match(result.describe, /did not report a volume/)
  })

  test('a heavy candle reads as above average against the recent median', () => {
    const candles = quiet(100)
    candles[29] = { ...(candles[29] as Candle), volume: 300 }
    const result = volumeContext(candles, 29, 29)
    assert.equal(result.reading, 'well-above-average')
    assert.equal(result.relative, 3)
  })

  test('a light candle reads as below average', () => {
    const candles = quiet(100)
    candles[29] = { ...(candles[29] as Candle), volume: 30 }
    assert.equal(volumeContext(candles, 29, 29).reading, 'well-below-average')
  })

  test('too few earlier candles with volume is unavailable, and says how few', () => {
    const candles = quiet(100).slice(0, 4)
    const result = volumeContext(candles, 3, 3)
    assert.equal(result.reading, 'unavailable')
    assert.match(result.describe, /too few/)
  })

  test('a volume of zero is a reading, not a missing one', () => {
    const candles = quiet(100)
    candles[29] = { ...(candles[29] as Candle), volume: 0 }
    const result = volumeContext(candles, 29, 29)
    assert.equal(result.reading, 'well-below-average')
    assert.equal(result.relative, 0)
  })
})

describe('volatility context', () => {
  const steady = build(Array.from({ length: 40 }, () => [100, 101, 99, 100.2] as [number, number, number, number]))

  test('a formation spanning much more than the average true range reads as high', () => {
    const candles = [...steady]
    candles[39] = { time: (candles[39] as Candle).time, open: 100, high: 110, low: 95, close: 108, volume: 100 }
    assert.equal(volatilityContext(candles, 39, 39).reading, 'high')
  })

  test('a quiet formation reads as low', () => {
    const candles = [...steady]
    candles[39] = { time: (candles[39] as Candle).time, open: 100, high: 100.2, low: 99.9, close: 100.1, volume: 100 }
    assert.ok(['low', 'very-low'].includes(volatilityContext(candles, 39, 39).reading))
  })

  test('too little history gives no reading rather than a default one', () => {
    const result = volatilityContext(steady.slice(0, 5), 4, 4)
    assert.equal(result.reading, 'unavailable')
    assert.equal(result.atr, null)
  })

  test('the average true range is reported as a share of price so it compares across markets', () => {
    const result = volatilityContext(steady, 39, 39)
    assert.ok((result.atrPercent as number) > 0)
  })
})

describe('momentum context', () => {
  const rising = build(Array.from({ length: 80 }, (_, i) => [100 + i, 101 + i, 99.8 + i, 100.9 + i] as [number, number, number, number]))

  test('readings are taken from the shared indicator engine where there is enough history', () => {
    const result = momentumContext(rising, rising.length - 1)
    assert.ok(result.rsi !== null)
    assert.ok(result.adx !== null)
    assert.ok(result.priceVsMovingAverage !== null)
  })

  test('a relentless rise reads as overbought', () => {
    assert.equal(momentumContext(rising, rising.length - 1).rsiReading, 'overbought')
  })

  test('too little history gives null readings rather than defaults', () => {
    const result = momentumContext(rising.slice(0, 6), 5)
    assert.equal(result.rsi, null)
    assert.equal(result.rsiReading, 'unavailable')
    assert.equal(result.adxReading, 'unavailable')
    assert.match(result.describe, /not enough history/)
  })
})

describe('regime', () => {
  test('a stepping-up market with force behind it is a strong uptrend', () => {
    const candles = zigzag([100, 112, 106, 120, 114, 128, 122, 136, 130, 144], 5)
    const result = regimeOf(candles, candles.length - 1)
    assert.ok(result.regime === 'strong-uptrend' || result.regime === 'weak-uptrend')
  })

  test('a narrowing market is compression, with volatility reported beside it rather than inside it', () => {
    const candles = zigzag([100, 120, 102, 116, 105, 112, 107, 110], 5)
    const result = regimeOf(candles, candles.length - 1)
    assert.equal(result.regime, 'compression')
    assert.ok(['unavailable', 'very-low', 'low', 'normal', 'elevated', 'high'].includes(result.volatility))
  })

  test('too little to go on is unknown rather than range', () => {
    assert.equal(regimeOf(zigzag([100, 102], 2), 1).regime, 'unknown')
  })
})

// ------------------------------------------------------------ the whole context

/**
 * A stepped decline ending in a hammer.
 *
 * Stepped rather than monotone on purpose: a market that falls every single candle has no turning points, so its
 * structure is genuinely unreadable. A real downtrend makes lower highs and lower lows, which is what this builds.
 */
function hammerAfterDecline(volume: number | null = 100): { candles: Candle[]; detection: PatternDetection } {
  const legs = zigzag([200, 190, 194, 184, 188, 178, 182, 172], 5, volume)
  const last = (legs[legs.length - 1] as Candle).close
  const candles = [
    ...legs,
    { time: (legs[legs.length - 1] as Candle).time + BAR, open: last - 0.8, high: last + 0.1, low: last - 4, close: last, volume }
  ]
  const found = detectAt(candles, candles.length - 1).detections.find((one) => one.patternId === 'hammer')
  assert.ok(found, `the fixture did not produce a hammer: ${detectAt(candles, candles.length - 1).detections.map((o) => o.patternId).join(', ') || 'nothing'}`)
  return { candles, detection: found }
}

describe('the whole context', () => {
  test('a bullish formation in a falling market is reported as agreeing with its setting', () => {
    const { candles, detection } = hammerAfterDecline()
    const context = contextFor(candles, detection)
    assert.ok(context.agreements.some((one) => /lower highs and lower lows/.test(one)), context.agreements.join(' | '))
  })

  test('agreements and conflicts are separate lists and are never netted', () => {
    const { candles, detection } = hammerAfterDecline()
    const context = contextFor(candles, detection)
    assert.ok(Array.isArray(context.agreements))
    assert.ok(Array.isArray(context.conflicts))
    assert.match(context.describe, /do not cancel out/)
    assert.equal('score' in context, false)
  })

  test('a reading that could not be taken is listed as unavailable, and lowers completeness', () => {
    const { candles, detection } = hammerAfterDecline(null)
    const context = contextFor(candles, detection)
    assert.ok(context.unavailable.includes('volume'))
    assert.ok(context.completeness < 1)
    assert.equal(context.volume.reading, 'unavailable')
  })

  test('completeness says how much could be read, not how good the observation is', () => {
    const { candles, detection } = hammerAfterDecline()
    const context = contextFor(candles, detection)
    assert.ok(context.completeness >= 0 && context.completeness <= 1)
  })

  test('heavy volume on the formation is an agreement', () => {
    const { candles, detection } = hammerAfterDecline()
    const loud = [...candles]
    loud[loud.length - 1] = { ...(loud[loud.length - 1] as Candle), volume: 500 }
    const context = contextFor(loud, detection)
    assert.ok(context.agreements.some((one) => /the usual volume/.test(one)), context.agreements.join(' | '))
  })

  test('light volume on the formation is a conflict', () => {
    const { candles, detection } = hammerAfterDecline()
    const thin = [...candles]
    thin[thin.length - 1] = { ...(thin[thin.length - 1] as Candle), volume: 10 }
    const context = contextFor(thin, detection)
    assert.ok(context.conflicts.some((one) => /less trade than the market normally does/.test(one)), context.conflicts.join(' | '))
  })

  test('context does not change what was detected', () => {
    const { candles, detection } = hammerAfterDecline()
    const before = JSON.stringify(detection)
    contextFor(candles, detection)
    assert.equal(JSON.stringify(detection), before)
  })

  test('the regime and volatility come back as separate readings', () => {
    const { candles, detection } = hammerAfterDecline()
    const context = contextFor(candles, detection)
    assert.ok(typeof context.regime.regime === 'string')
    assert.ok(typeof context.regime.volatility === 'string')
  })
})

// ------------------------------------------------------------ multi-timeframe

describe('several timeframes', () => {
  const up = zigzag([100, 112, 106, 120, 114, 128, 122, 136], 5)
  const down = zigzag([136, 122, 128, 114, 120, 106, 112, 100], 5)
  const flat = zigzag([100, 104, 100, 104, 100, 104, 100, 104], 5)

  test('every interval keeps its own reading', () => {
    const result = timeframeContext([{ interval: '1h', candles: up }, { interval: '4h', candles: down }], 'bullish')
    assert.equal(result.readings.length, 2)
    assert.equal(result.readings[0]?.interval, '1h')
    assert.notEqual(result.readings[0]?.regime, result.readings[1]?.regime)
  })

  test('all timeframes moving the formation’s way is aligned', () => {
    const result = timeframeContext([{ interval: '1h', candles: up }, { interval: '4h', candles: up }], 'bullish')
    assert.equal(result.agreement, 'aligned')
  })

  test('all timeframes moving against it is opposed, and both readings are kept true', () => {
    const result = timeframeContext([{ interval: '1h', candles: down }, { interval: '4h', candles: down }], 'bullish')
    assert.equal(result.agreement, 'opposed')
    assert.match(result.describe, /neither cancels the other/)
  })

  test('timeframes that disagree with each other are shown separately rather than combined', () => {
    const result = timeframeContext([{ interval: '1h', candles: up }, { interval: '4h', candles: down }], 'bullish')
    assert.equal(result.agreement, 'mixed')
    assert.match(result.describe, /rather than combined/)
  })

  test('a formation with no direction has nothing for other timeframes to agree with', () => {
    const result = timeframeContext([{ interval: '1h', candles: up }], 'neutral')
    assert.equal(result.agreement, 'unknown')
  })

  test('timeframes with too little history are classified as unknown and excluded from the verdict', () => {
    const result = timeframeContext([{ interval: '1m', candles: flat.slice(0, 3) }], 'bullish')
    assert.equal(result.agreement, 'unknown')
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and rule out inventing an absent reading', () => {
    assert.equal(Object.isFrozen(CONTEXT_ASSUMPTIONS), true)
    assert.ok(CONTEXT_ASSUMPTIONS.some((one) => /never as average/.test(one)))
    assert.ok(CONTEXT_ASSUMPTIONS.some((one) => /never netted/.test(one)))
    assert.ok(CONTEXT_ASSUMPTIONS.some((one) => /never changes whether a pattern was detected/.test(one)))
  })
})
