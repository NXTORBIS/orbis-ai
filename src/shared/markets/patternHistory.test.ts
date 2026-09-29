import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from './indicators.ts'
import type { PatternDetection } from './patternDetect.ts'
import {
  HISTORY_ASSUMPTIONS,
  MINIMUM_SAMPLE,
  RETENTION_MS,
  compare,
  conditionOn,
  describeRun,
  distributionOf,
  frequencyOf,
  measureOutcomes,
  prune,
  recordOf,
  search,
  summarise,
  type AnalysisRun,
  type PatternRecord
} from './patternHistory.ts'

const NOW = 1_700_000_000_000
const BAR = 60_000

const record = (over: Partial<PatternRecord> = {}): PatternRecord => ({
  key: 'k1',
  instrumentId: 'binance-spot-BTCUSDT',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  interval: '15m',
  patternId: 'bullish-engulfing',
  patternName: 'Bullish Engulfing',
  patternVersion: 1,
  libraryVersion: 1,
  category: 'reversal',
  direction: 'bullish',
  candleTime: NOW,
  candleTimes: [NOW - BAR, NOW],
  recordedAt: NOW,
  price: 100,
  structuralMatch: 0.6,
  dataQuality: 'high',
  mode: 'standard',
  context: { regime: 'weak-downtrend', volume: 'above-average', volatility: 'normal', placement: 'at-support', agreements: 2, conflicts: 0 },
  snapshotRef: 'snap-1',
  revised: false,
  ...over
})

describe('making a record', () => {
  test('a record carries the definition version that produced it', () => {
    const detection = {
      key: 'k',
      patternId: 'hammer',
      patternName: 'Hammer',
      patternVersion: 3,
      libraryVersion: 2,
      category: 'reversal',
      direction: 'bullish',
      at: NOW,
      candleTimes: [NOW],
      structuralMatch: 0.5,
      dataQuality: { level: 'high' },
      mode: 'strict'
    } as unknown as PatternDetection

    const made = recordOf({ detection, instrumentId: 'i', exchange: 'binance', symbol: 'BTCUSDT', interval: '1h', price: 100, recordedAt: NOW })
    assert.equal(made.patternVersion, 3)
    assert.equal(made.libraryVersion, 2)
    assert.equal(made.mode, 'strict')
    assert.equal(made.context, null)
    assert.equal(made.revised, false)
  })

  test('the exchange is kept apart from the instrument so two venues never merge', () => {
    const detection = { key: 'k', patternId: 'hammer', patternName: 'Hammer', patternVersion: 1, libraryVersion: 1, category: 'reversal', direction: 'bullish', at: NOW, candleTimes: [NOW], structuralMatch: 0.5, dataQuality: { level: 'high' }, mode: 'standard' } as unknown as PatternDetection
    assert.equal(recordOf({ detection, instrumentId: 'i', exchange: 'coinbase', symbol: 'BTC-USD', interval: '1h', price: 1, recordedAt: NOW }).exchange, 'coinbase')
  })
})

describe('retention', () => {
  const old = (days: number): PatternRecord => record({ key: `k-${days}`, recordedAt: NOW - days * 86_400_000, snapshotRef: `snap-${days}` })

  test('records past the window are removed and their images are reported as orphaned', () => {
    const result = prune([old(1), old(10), old(60)], '30d', NOW)
    assert.deepEqual(result.kept.map((one) => one.key).sort(), ['k-1', 'k-10'])
    assert.deepEqual(result.orphanedSnapshots, ['snap-60'])
  })

  test('forever keeps everything', () => {
    assert.equal(prune([old(1), old(1000)], 'forever', NOW).removed.length, 0)
    assert.equal(RETENTION_MS.forever, null)
  })

  test('the record cap removes the oldest and says it was the cap rather than age', () => {
    const many = Array.from({ length: 12 }, (_, i) => old(i))
    const result = prune(many, 'forever', NOW, 10)
    assert.equal(result.kept.length, 10)
    assert.match(result.describe, /record limit was reached rather than because of age/)
  })

  test('nothing to remove says so', () => {
    assert.match(prune([old(1)], '30d', NOW).describe, /within the 30d window/)
  })

  test('the kept records come back oldest first', () => {
    const result = prune([old(3), old(1), old(2)], 'forever', NOW)
    assert.deepEqual(result.kept.map((one) => one.key), ['k-3', 'k-2', 'k-1'])
  })
})

describe('searching', () => {
  const records = [
    record({ key: 'a', patternId: 'hammer', interval: '15m', candleTime: NOW, structuralMatch: 0.8 }),
    record({ key: 'b', patternId: 'doji', interval: '1h', candleTime: NOW - 86_400_000, structuralMatch: 0.2, dataQuality: 'reduced' }),
    record({ key: 'c', patternId: 'hammer', interval: '1h', candleTime: NOW - 2 * 86_400_000, exchange: 'coinbase' }),
    record({ key: 'd', patternId: 'hammer', interval: '15m', revised: true })
  ]

  test('a query narrows and says how many were considered', () => {
    const result = search(records, { patternIds: ['hammer'] })
    assert.deepEqual(result.records.map((one) => one.key).sort(), ['a', 'c'])
    assert.equal(result.considered, 4)
  })

  test('revised records are excluded unless asked for', () => {
    assert.equal(search(records, {}).records.some((one) => one.key === 'd'), false)
    assert.ok(search(records, { includeRevised: true }).records.some((one) => one.key === 'd'))
  })

  test('a query that matches nothing says which conditions excluded the most', () => {
    const result = search(records, { patternIds: ['morning-star'] })
    assert.deepEqual(result.records, [])
    assert.match(result.describe, /None of the 4 records matched/)
    assert.ok(result.excludedBy.some((one) => one.condition === 'pattern'))
  })

  test('a date range is reported as a date range when it is what excluded things', () => {
    const result = search(records, { from: NOW + 1 })
    assert.ok(result.excludedBy.some((one) => one.condition === 'date range'))
  })

  test('a minimum match and a minimum data quality both filter', () => {
    assert.equal(search(records, { minimumMatch: 0.5 }).records.length, 2)
    assert.equal(search(records, { minimumDataQuality: 'high' }).records.length, 2)
  })

  test('exchanges are filterable, so one venue can be examined alone', () => {
    assert.deepEqual(search(records, { exchanges: ['coinbase'] }).records.map((one) => one.key), ['c'])
  })

  test('a context filter excludes records that have no context rather than passing them', () => {
    const noContext = record({ key: 'e', context: null })
    const result = search([...records, noContext], { regimes: ['weak-downtrend'] })
    assert.equal(result.records.some((one) => one.key === 'e'), false)
  })

  test('results come back newest first', () => {
    const result = search(records, { patternIds: ['hammer', 'doji'] })
    assert.deepEqual(result.records.map((one) => one.candleTime), [...result.records.map((one) => one.candleTime)].sort((a, b) => b - a))
  })

  test('an empty history says there is nothing to search', () => {
    assert.match(search([], {}).describe, /no records to search/)
  })
})

// ------------------------------------------------------------ outcomes

/** A run of candles, with the occurrence at index `at` and a given path afterwards. */
function historyWith(at: number, afterCloses: number[], reference = 100): Candle[] {
  const candles: Candle[] = []
  for (let i = 0; i <= at; i += 1) {
    candles.push({ time: NOW + i * BAR, open: reference, high: reference + 1, low: reference - 1, close: reference, volume: 100 })
  }
  for (const close of afterCloses) {
    candles.push({ time: NOW + candles.length * BAR, open: close, high: close + 0.5, low: close - 0.5, close, volume: 100 })
  }
  return candles
}

describe('measuring what happened afterwards', () => {
  test('a forward return is measured from the formation close to the close n candles later', () => {
    const candles = historyWith(5, [101, 102, 103])
    const one = record({ key: 'a', candleTime: candles[5]?.time as number })
    const set = measureOutcomes([one], () => candles, 3)
    assert.equal(set.outcomes.length, 1)
    assert.equal(Number((set.outcomes[0]?.forwardReturn as number).toFixed(4)), 3)
    assert.equal(set.outcomes[0]?.complete, true)
  })

  test('a window running past the end is marked incomplete and excluded from the summary', () => {
    const candles = historyWith(5, [101])
    const one = record({ key: 'a', candleTime: candles[5]?.time as number })
    const set = measureOutcomes([one], () => candles, 5)
    assert.equal(set.outcomes[0]?.complete, false)
    assert.equal(summarise(set).forwardReturn.sample, 0)
    assert.equal(summarise(set).excludedIncomplete, 1)
  })

  test('a bearish formation’s favourable excursion is downward', () => {
    const candles = historyWith(5, [98, 96, 97])
    const one = record({ key: 'a', direction: 'bearish', candleTime: candles[5]?.time as number })
    const set = measureOutcomes([one], () => candles, 3)
    // Price fell, which is favourable for a bearish formation, so the figure is positive.
    assert.ok((set.outcomes[0]?.forwardReturn as number) > 0)
    assert.ok((set.outcomes[0]?.maximumFavourable as number) > 0)
  })

  test('a bullish formation’s adverse excursion is the worst it got below the start', () => {
    const candles = historyWith(5, [99, 95, 101])
    const one = record({ key: 'a', candleTime: candles[5]?.time as number })
    const set = measureOutcomes([one], () => candles, 3)
    assert.ok((set.outcomes[0]?.maximumAdverse as number) < 0)
    assert.ok((set.outcomes[0]?.maximumFavourable as number) > 0)
  })

  test('an occurrence whose candles are gone is reported as unmeasurable, never dropped quietly', () => {
    const set = measureOutcomes([record({ key: 'a' })], () => undefined, 3)
    assert.deepEqual(set.outcomes, [])
    assert.equal(set.unmeasurable.length, 1)
    assert.match(set.unmeasurable[0]?.why ?? '', /no longer available/)
  })

  test('an occurrence whose candle is not in the history given is reported', () => {
    const candles = historyWith(5, [101, 102, 103])
    const set = measureOutcomes([record({ key: 'a', candleTime: 1 })], () => candles, 3)
    assert.match(set.unmeasurable[0]?.why ?? '', /not in the history provided/)
  })

  test('an occurrence with nothing after it is reported', () => {
    const candles = historyWith(5, [])
    const set = measureOutcomes([record({ key: 'a', candleTime: candles[5]?.time as number })], () => candles, 3)
    assert.match(set.unmeasurable[0]?.why ?? '', /no candles after/)
  })

  test('the method is recorded on the result and states that no cost is applied', () => {
    const candles = historyWith(5, [101, 102, 103])
    const set = measureOutcomes([record({ key: 'a', candleTime: candles[5]?.time as number })], () => candles, 3)
    assert.equal(set.method.reference, 'formation-close')
    assert.equal(set.method.forwardCandles, 3)
    assert.match(set.method.describe, /No cost, slippage or spread/)
  })
})

// ------------------------------------------------------------ distributions

describe('distributions', () => {
  test('a distribution reports its sample, its shape and its middle', () => {
    const values = Array.from({ length: 60 }, (_, i) => i - 30)
    const result = distributionOf(values)
    assert.equal(result.sample, 60)
    assert.equal(result.reliability, 'moderate')
    assert.ok(result.bands.length > 0)
    assert.ok(result.median !== null && result.lowerQuartile !== null && result.upperQuartile !== null)
  })

  test('the share above zero is named for what it counts, never as a win rate', () => {
    const result = distributionOf([1, 2, 3, -1])
    assert.equal(result.shareAboveZero, 0.75)
    assert.match(result.describe, /finished above where they started/)
    assert.equal(/win rate|accuracy|probability|success/i.test(result.describe), false)
  })

  test('a small sample carries a caution meant to be shown with the numbers', () => {
    const result = distributionOf([1, 2, -3])
    assert.equal(result.reliability, 'too-few')
    assert.match(result.caution ?? '', /should not be read as typical/)
    assert.match(result.caution ?? '', new RegExp(String(MINIMUM_SAMPLE)))
  })

  test('a substantial sample carries no caution', () => {
    assert.equal(distributionOf(Array.from({ length: 300 }, (_, i) => i % 7 - 3)).caution, null)
  })

  test('two sets with the same average and different shapes come out differently', () => {
    const flat = distributionOf(Array.from({ length: 40 }, () => 0.4))
    const split = distributionOf(Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 10 : -9.2)))
    assert.equal(Number((flat.mean as number).toFixed(2)), Number((split.mean as number).toFixed(2)))
    assert.notDeepEqual(flat.bands.map((one) => one.count), split.bands.map((one) => one.count))
  })

  test('nothing to summarise says so and returns nulls rather than zeros', () => {
    const result = distributionOf([])
    assert.equal(result.sample, 0)
    assert.equal(result.median, null)
    assert.equal(result.shareAboveZero, null)
    assert.match(result.caution ?? '', /nothing here to summarise/)
  })

  test('values that are not finite are left out rather than poisoning the set', () => {
    assert.equal(distributionOf([1, 2, NaN, Infinity]).sample, 2)
  })

  test('the bands add up to the whole sample', () => {
    const values = Array.from({ length: 50 }, (_, i) => i - 25)
    const result = distributionOf(values)
    assert.equal(result.bands.reduce((a, b) => a + b.count, 0), result.sample)
  })
})

// ------------------------------------------------------------ conditioning and comparing

describe('conditioning on context', () => {
  const candles = historyWith(5, [101, 102, 103])
  const at = candles[5]?.time as number

  test('splitting by regime groups the occurrences and each group carries its own sample', () => {
    const records = [
      record({ key: 'a', candleTime: at, context: { regime: 'weak-downtrend', volume: 'average', volatility: 'normal', placement: 'between', agreements: 0, conflicts: 0 } }),
      record({ key: 'b', candleTime: at, context: { regime: 'range', volume: 'average', volatility: 'normal', placement: 'between', agreements: 0, conflicts: 0 } })
    ]
    const set = measureOutcomes(records, () => candles, 3)
    const groups = conditionOn(records, set, 'regime')
    assert.equal(groups.length, 2)
    for (const one of groups) assert.equal(one.summary.forwardReturn.sample, 1)
  })

  test('records with no context group under a stated value rather than being dropped', () => {
    const records = [record({ key: 'a', candleTime: at, context: null })]
    const groups = conditionOn(records, measureOutcomes(records, () => candles, 3), 'regime')
    assert.equal(groups[0]?.value, 'not recorded')
  })

  test('splitting by interval does not need context at all', () => {
    const records = [record({ key: 'a', candleTime: at, interval: '15m' }), record({ key: 'b', candleTime: at, interval: '1h' })]
    assert.equal(conditionOn(records, measureOutcomes(records, () => candles, 3), 'interval').length, 2)
  })

  test('groups come back largest first', () => {
    const records = [
      record({ key: 'a', candleTime: at, interval: '15m' }),
      record({ key: 'b', candleTime: at, interval: '15m' }),
      record({ key: 'c', candleTime: at, interval: '1h' })
    ]
    const groups = conditionOn(records, measureOutcomes(records, () => candles, 3), 'interval')
    assert.equal(groups[0]?.value, '15m')
  })
})

describe('comparing', () => {
  const summaryOver = (count: number, value: number) =>
    summarise({
      method: { reference: 'formation-close' as const, forwardCandles: 12, describe: '' },
      outcomes: Array.from({ length: count }, (_, i) => ({ key: `k${i}`, forwardReturn: value, maximumFavourable: value, maximumAdverse: 0, candlesUsed: 12, complete: true })),
      unmeasurable: [],
      describe: ''
    })

  test('two large sets are comparable and neither is named the better one', () => {
    const result = compare('pattern', { label: 'Hammer', summary: summaryOver(50, 1) }, { label: 'Bullish Engulfing', summary: summaryOver(60, 2) })
    assert.equal(result.comparable, true)
    assert.match(result.describe, /neither is named the better one/)
    assert.equal(/winner|better performing|outperform/i.test(result.describe), false)
  })

  test('a small set is not comparable and the sizes are named', () => {
    const result = compare('pattern', { label: 'Hammer', summary: summaryOver(5, 1) }, { label: 'Doji', summary: summaryOver(60, 2) })
    assert.equal(result.comparable, false)
    assert.match(result.describe, /5 and 60/)
    assert.match(result.describe, /too few to compare/)
  })

  test('both sets are still shown in full when they cannot be compared', () => {
    const result = compare('pattern', { label: 'A', summary: summaryOver(3, 1) }, { label: 'B', summary: summaryOver(3, 2) })
    assert.equal(result.left.summary.forwardReturn.sample, 3)
    assert.equal(result.right.summary.forwardReturn.sample, 3)
  })
})

// ------------------------------------------------------------ frequency and runs

describe('frequency', () => {
  const records = [
    record({ key: 'a', patternId: 'hammer', patternName: 'Hammer', interval: '15m', direction: 'bullish', category: 'reversal' }),
    record({ key: 'b', patternId: 'hammer', patternName: 'Hammer', interval: '1h', direction: 'bullish', category: 'reversal' }),
    record({ key: 'c', patternId: 'doji', patternName: 'Doji', interval: '15m', direction: 'neutral', category: 'indecision' })
  ]

  test('counts come back most frequent first, with shares', () => {
    const result = frequencyOf(records)
    assert.deepEqual(result.byPattern[0], { patternId: 'hammer', patternName: 'Hammer', count: 2, share: 2 / 3 })
    assert.equal(result.byInterval[0]?.interval, '15m')
  })

  test('categories and directions are counted', () => {
    const result = frequencyOf(records)
    assert.deepEqual(result.byCategory, { reversal: 2, continuation: 0, indecision: 1 })
    assert.deepEqual(result.byDirection, { bullish: 2, bearish: 0, neutral: 1 })
  })

  test('it says it counts what was found and nothing about what followed', () => {
    assert.match(frequencyOf(records).describe, /says nothing about what followed/)
  })

  test('an empty history says nothing has been detected yet', () => {
    assert.match(frequencyOf([]).describe, /Nothing has been detected yet/)
  })
})

describe('analysis runs', () => {
  const run = (over: Partial<AnalysisRun> = {}): AnalysisRun => ({
    runId: 'run-1',
    instrumentId: 'i',
    interval: '15m',
    from: NOW - 1000,
    to: NOW,
    patternIds: ['hammer'],
    patternVersions: { hammer: 1 },
    libraryVersion: 1,
    mode: 'standard',
    forwardCandles: 12,
    createdAt: NOW,
    status: 'complete',
    examined: 1000,
    total: 1000,
    found: 12,
    describe: '',
    ...over
  })

  test('a complete run is described as covering its range', () => {
    const result = describeRun(run())
    assert.equal(result.partial, false)
    assert.match(result.describe, /Examined all 1,000 candles/)
  })

  test('a cancelled run is described as partial, with the share examined', () => {
    const result = describeRun(run({ status: 'cancelled', examined: 400, found: 5 }))
    assert.equal(result.partial, true)
    assert.match(result.describe, /400 of 1,000 candles \(40%\)/)
    assert.match(result.describe, /not the same as the number in the range/)
  })

  test('a run that says complete but examined less is still partial', () => {
    assert.equal(describeRun(run({ examined: 900 })).partial, true)
  })

  test('a run records the definition versions it used, so it stays reproducible', () => {
    assert.deepEqual(run().patternVersions, { hammer: 1 })
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and refuse the forbidden words', () => {
    assert.equal(Object.isFrozen(HISTORY_ASSUMPTIONS), true)
    assert.ok(HISTORY_ASSUMPTIONS.some((one) => /None of them is a probability, a win rate, an accuracy or a success rate/.test(one)))
    assert.ok(HISTORY_ASSUMPTIONS.some((one) => /sample size is a required field/.test(one)))
    assert.ok(HISTORY_ASSUMPTIONS.some((one) => /No comparison names a winner/.test(one)))
  })
})
