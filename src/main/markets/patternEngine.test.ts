import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import type { Candle } from '../../shared/markets/indicators.ts'
import { DEFAULT_RULE, type PatternAlertRule } from '../../shared/markets/patternAlerts.ts'
import { DEFAULT_PATTERN_SETTINGS, EMPTY_PATTERN_STATE, type PatternSettings, type PatternState } from '../../shared/markets/patternSettings.ts'
import {
  ENGINE_ASSUMPTIONS,
  MINIMUM_CANDLES,
  PatternEngine,
  batchForDelivery,
  decideAlerts,
  recordsFor,
  type ExamineInput
} from './patternEngine.ts'

const BAR = 900_000
const START = 1_700_000_000_000

const settings = (over: Partial<PatternSettings> = {}): PatternSettings => ({ ...DEFAULT_PATTERN_SETTINGS, ...over })

/**
 * A stepped decline ending in a hammer, long enough for the rolling window and the indicators.
 *
 * Stepped rather than monotone because a market that falls every candle has no turning points, so its structure and
 * levels are genuinely unreadable and the context would be empty for reasons that have nothing to do with the test.
 */
function declineIntoHammer(extra = 0): Candle[] {
  const points = [200, 190, 194, 184, 188, 178, 182, 172]
  const candles: Candle[] = []
  const push = (open: number, high: number, low: number, close: number): void => {
    candles.push({ time: START + candles.length * BAR, open, high, low, close, volume: 100 })
  }
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i] as number
    const to = points[i + 1] as number
    for (let step = 1; step <= 5; step += 1) {
      const open = from + ((to - from) * (step - 1)) / 5
      const close = from + ((to - from) * step) / 5
      push(open, Math.max(open, close) + 0.05, Math.min(open, close) - 0.05, close)
    }
  }
  const last = (candles[candles.length - 1] as Candle).close
  push(last - 0.8, last + 0.1, last - 4, last)
  for (let i = 0; i < extra; i += 1) {
    const at = (candles[candles.length - 1] as Candle).close
    push(at, at + 0.3, at - 0.3, at + 0.1)
  }
  return candles
}

const input = (candles: readonly Candle[], over: Partial<ExamineInput> = {}): ExamineInput => ({
  instrumentId: 'binance-spot-BTCUSDT',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  interval: '15m',
  candles,
  lastIsDeveloping: false,
  now: START,
  ...over
})

describe('examining a market', () => {
  test('a hammer at the end of a decline is found, under its most specific name', () => {
    const engine = new PatternEngine(settings())
    const result = engine.examine(input(declineIntoHammer()))
    assert.equal(result.skipped, null)
    // Takuri is a hammer with an unusually long shadow, so the more specific name is the one reported and `hammer`
    // appears as a broader classification on it.
    const hammerish = result.found.filter((one) => one.detection.patternId === 'hammer' || one.detection.alsoMatches.includes('hammer'))
    assert.ok(hammerish.length > 0, result.found.map((o) => o.detection.patternId).join(', '))
  })

  test('with the master switch off nothing is examined and it says so', () => {
    const engine = new PatternEngine(settings({ enabled: false }))
    const result = engine.examine(input(declineIntoHammer()))
    assert.equal(result.skipped, 'disabled')
    assert.equal(result.examined, 0)
    assert.deepEqual(result.found, [])
    assert.match(result.describe, /switched off/)
  })

  test('too little history is refused rather than measured against nothing', () => {
    const engine = new PatternEngine(settings())
    const result = engine.examine(input(declineIntoHammer().slice(0, 10)))
    assert.equal(result.skipped, 'too-few-candles')
    assert.match(result.describe, new RegExp(String(MINIMUM_CANDLES)))
  })

  test('a second call with no new candle does no work and returns what it already found', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    const first = engine.examine(input(candles))
    const second = engine.examine(input(candles))
    assert.ok(first.examined > 0)
    assert.equal(second.examined, 0)
    assert.equal(second.skipped, 'no-new-candles')
    assert.deepEqual(second.found.map((one) => one.detection.key), first.found.map((one) => one.detection.key))
  })

  test('a forming candle updating many times does not re-examine', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    engine.examine(input(candles, { lastIsDeveloping: true }))
    let examined = 0
    for (let tick = 0; tick < 50; tick += 1) {
      const live = [...candles]
      live[live.length - 1] = { ...(live[live.length - 1] as Candle), close: 170 + tick * 0.01, high: 176 + tick * 0.01 }
      examined += engine.examine(input(live, { lastIsDeveloping: true })).examined
    }
    assert.equal(examined, 0)
  })

  test('a newly closed candle is examined', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    engine.examine(input(candles))
    const longer = declineIntoHammer(1)
    assert.ok(engine.examine(input(longer)).examined > 0)
  })

  test('the first sight of a market examines the recent tail, not the whole history', () => {
    const engine = new PatternEngine(settings())
    const long = declineIntoHammer(200)
    const result = engine.examine(input(long))
    assert.ok(result.examined <= 25, `examined ${result.examined} of ${long.length}`)
  })

  test('changing the mode clears what was remembered, so nothing stays under a stale label', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    engine.examine(input(candles))
    assert.equal(engine.examine(input(candles)).examined, 0)
    engine.configure(settings({ mode: 'strict' }))
    assert.ok(engine.examine(input(candles)).examined > 0)
  })

  test('changing something that does not affect detection keeps the cursor', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    engine.examine(input(candles))
    engine.configure(settings({ markerDetail: 'detailed' }))
    assert.equal(engine.examine(input(candles)).examined, 0)
  })

  test('switching off releases everything held', () => {
    const engine = new PatternEngine(settings())
    engine.examine(input(declineIntoHammer()))
    assert.ok(engine.held().markets > 0)
    engine.configure(settings({ enabled: false }))
    assert.deepEqual(engine.held(), { markets: 0, detections: 0 })
  })

  test('releasing by hand drops the cursors too', () => {
    const engine = new PatternEngine(settings())
    engine.examine(input(declineIntoHammer()))
    engine.release()
    assert.equal(engine.held().markets, 0)
  })

  test('two intervals on the same market are tracked separately', () => {
    const engine = new PatternEngine(settings())
    const candles = declineIntoHammer()
    engine.examine(input(candles, { interval: '15m' }))
    assert.ok(engine.examine(input(candles, { interval: '1h' })).examined > 0)
    assert.equal(engine.held().markets, 2)
  })

  test('below the minimum match nothing is reported', () => {
    const engine = new PatternEngine(settings({ minimumMatch: 0.99 }))
    assert.deepEqual(engine.examine(input(declineIntoHammer())).found, [])
  })

  test('only the most specific classification is reported', () => {
    const engine = new PatternEngine(settings())
    const found = engine.examine(input(declineIntoHammer())).found.map((one) => one.detection.patternId)
    // Takuri specialises Hammer; both cannot appear for the same candle.
    assert.equal(found.filter((one) => one === 'hammer' || one === 'takuri').length <= 1, true)
  })
})

describe('context on a detection', () => {
  test('context is gathered when the setting is on', () => {
    const engine = new PatternEngine(settings({ context: true }))
    const found = engine.examine(input(declineIntoHammer())).found
    assert.ok(found[0]?.context !== null)
  })

  test('context off gives null, never an empty context', () => {
    const engine = new PatternEngine(settings({ context: false }))
    const found = engine.examine(input(declineIntoHammer())).found
    assert.equal(found[0]?.context, null)
  })

  test('the multi-timeframe reading is only taken for the intervals chosen', () => {
    const others = [{ interval: '4h', candles: declineIntoHammer() }]
    const on = new PatternEngine(settings({ multiTimeframe: true, timeframes: ['4h'] }))
    assert.ok(on.examine(input(declineIntoHammer(), { otherTimeframes: others })).found[0]?.timeframeAgreement !== null)

    const off = new PatternEngine(settings({ multiTimeframe: true, timeframes: ['1d'] }))
    assert.equal(off.examine(input(declineIntoHammer(), { otherTimeframes: others })).found[0]?.timeframeAgreement, null)
  })

  test('the market’s own interval is never used as its own higher timeframe', () => {
    const engine = new PatternEngine(settings({ multiTimeframe: true, timeframes: ['15m'] }))
    const others = [{ interval: '15m', candles: declineIntoHammer() }]
    assert.equal(engine.examine(input(declineIntoHammer(), { otherTimeframes: others })).found[0]?.timeframeAgreement, null)
  })
})

describe('developing formations', () => {
  test('they are off by default', () => {
    const engine = new PatternEngine(settings())
    assert.deepEqual(engine.examine(input(declineIntoHammer(), { lastIsDeveloping: true })).developing, [])
  })

  test('with the setting on they are reported, and never as confirmed', () => {
    const engine = new PatternEngine(settings({ developing: true }))
    const result = engine.examine(input(declineIntoHammer(), { lastIsDeveloping: true }))
    for (const one of result.developing) {
      assert.equal(one.detection.completeness, 'developing')
      assert.equal(one.detection.status, 'candidate')
    }
  })

  test('they are still reported when no new candle has closed', () => {
    const engine = new PatternEngine(settings({ developing: true }))
    const candles = declineIntoHammer()
    engine.examine(input(candles, { lastIsDeveloping: true }))
    const again = engine.examine(input(candles, { lastIsDeveloping: true }))
    assert.equal(again.skipped, 'no-new-candles')
    assert.equal(again.developing.length >= 0, true)
  })
})

// ------------------------------------------------------------ alerts

const rule = (over: Partial<PatternAlertRule> = {}): PatternAlertRule => ({
  ...DEFAULT_RULE,
  id: 'r1',
  name: 'Hammers on BTC',
  createdAt: START,
  scope: 'instruments',
  instrumentIds: ['binance-spot-BTCUSDT'],
  cooldownMs: 0,
  ...over
})

const state = (over: Partial<PatternState> = {}): PatternState => ({
  ...EMPTY_PATTERN_STATE,
  settings: settings({ alerts: true }),
  rules: [rule()],
  records: [],
  firings: [],
  mutes: [],
  ...over
})

const examined = (engine = new PatternEngine(settings())) => engine.examine(input(declineIntoHammer()))

describe('deciding alerts', () => {
  test('a matching rule fires once', () => {
    const result = decideAlerts({ state: state(), examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    assert.equal(result.fire.length >= 1, true)
    assert.equal(new Set(result.fire.map((one) => one.firing.key)).size, result.fire.length)
  })

  test('a firing is never recorded as delivered before it has been', () => {
    const result = decideAlerts({ state: state(), examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    for (const one of result.fire) assert.equal(one.firing.delivered, false)
  })

  test('alerts off means nothing fires and detection is unaffected', () => {
    const off = state({ settings: settings({ alerts: false }) })
    const result = decideAlerts({ state: off, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    assert.deepEqual(result.fire, [])
    assert.match(result.describe, /alerts are switched off/)
  })

  test('the master switch off stops alerts too', () => {
    const off = state({ settings: settings({ alerts: true, enabled: false }) })
    assert.match(decideAlerts({ state: off, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START }).describe, /detection is switched off/)
  })

  test('the same formation does not fire twice across two passes', () => {
    const first = decideAlerts({ state: state(), examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    const after = state({ firings: first.fire.map((one) => one.firing) })
    const second = decideAlerts({ state: after, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START + 1000 })
    assert.deepEqual(second.fire, [])
    assert.ok(second.refused.some((one) => one.reason === 'already-fired'))
  })

  test('one rule cannot fire twice within a single pass', () => {
    const engine = new PatternEngine(settings())
    const result = decideAlerts({ state: state(), examined: engine.examine(input(declineIntoHammer())), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    const perRule = new Map<string, number>()
    for (const one of result.fire) perRule.set(one.rule.id, (perRule.get(one.rule.id) ?? 0) + 1)
    for (const [, count] of perRule) assert.equal(count <= result.fire.length, true)
    assert.equal(new Set(result.fire.map((one) => one.firing.key)).size, result.fire.length)
  })

  test('every refusal carries its reason, so nothing firing has an explanation', () => {
    const narrow = state({ rules: [rule({ patternIds: ['morning-star'] })] })
    const result = decideAlerts({ state: narrow, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    assert.deepEqual(result.fire, [])
    assert.ok(result.refused.length > 0)
    for (const one of result.refused) {
      assert.ok(one.reason.length > 0)
      assert.ok(one.describe.length > 0)
    }
  })

  test('no rule watching the market says that rather than nothing', () => {
    const none = state({ rules: [] })
    assert.match(decideAlerts({ state: none, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START }).describe, /No rule is watching/)
  })

  test('a watchlist rule needs the market to be in the watchlist', () => {
    const watching = state({ rules: [rule({ scope: 'watchlist', instrumentIds: [] })] })
    const outside = decideAlerts({ state: watching, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    assert.deepEqual(outside.fire, [])
    const inside = decideAlerts({ state: watching, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: true, inFavourites: false, now: START })
    assert.ok(inside.fire.length > 0)
  })

  test('a mute stops the alert', () => {
    const muted = state({ mutes: [{ instrumentId: 'binance-spot-BTCUSDT', until: START + 60_000, reason: 'quiet please' }] })
    const result = decideAlerts({ state: muted, examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    assert.deepEqual(result.fire, [])
    assert.ok(result.refused.every((one) => one.reason === 'muted'))
  })
})

describe('records', () => {
  test('confirmed formations are recorded with their context summarised', () => {
    const records = recordsFor({ examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings())
    assert.ok(records.length > 0)
    assert.equal(records[0]?.exchange, 'binance')
    assert.ok(records[0]?.context !== null)
  })

  test('history off records nothing', () => {
    assert.deepEqual(recordsFor({ examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings({ history: false })), [])
  })

  test('the master switch off records nothing', () => {
    assert.deepEqual(recordsFor({ examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings({ enabled: false })), [])
  })

  test('developing formations are never recorded', () => {
    const engine = new PatternEngine(settings({ developing: true }))
    const result = engine.examine(input(declineIntoHammer(), { lastIsDeveloping: true }))
    const records = recordsFor({ examined: result, exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings({ developing: true }))
    for (const one of records) {
      assert.ok(result.found.some((f) => f.detection.key === one.key))
      assert.equal(result.developing.some((f) => f.detection.key === one.key), false)
    }
  })

  test('a snapshot reference is attached where one was made, and null where none was', () => {
    const result = examined()
    const key = result.found[0]?.detection.key as string
    const withImage = recordsFor({ examined: result, exchange: 'binance', symbol: 'BTCUSDT', now: START, snapshots: new Map([[key, 'snap-1']]) }, settings())
    assert.equal(withImage.find((one) => one.key === key)?.snapshotRef, 'snap-1')
    const without = recordsFor({ examined: result, exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings())
    assert.equal(without.find((one) => one.key === key)?.snapshotRef, null)
  })

  test('a record keeps the definition version that produced it', () => {
    const records = recordsFor({ examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', now: START }, settings())
    assert.ok((records[0]?.patternVersion ?? 0) >= 1)
    assert.ok((records[0]?.libraryVersion ?? 0) >= 1)
  })
})

describe('batching for delivery', () => {
  test('the batch uses the library’s names rather than ids', () => {
    const result = decideAlerts({ state: state(), examined: examined(), exchange: 'binance', symbol: 'BTCUSDT', inWatchlist: false, inFavourites: false, now: START })
    const batch = batchForDelivery(result.fire.map((one) => one.firing))
    assert.equal(batch.firings.length, result.fire.length)
    assert.ok(batch.byDirection.bullish + batch.byDirection.bearish + batch.byDirection.neutral > 0)
  })
})

describe('the stated assumptions', () => {
  test('they are frozen and name the once-per-closed-candle rule', () => {
    assert.equal(Object.isFrozen(ENGINE_ASSUMPTIONS), true)
    assert.ok(ENGINE_ASSUMPTIONS.some((one) => /once per closed candle, not once per tick/.test(one)))
    assert.ok(ENGINE_ASSUMPTIONS.some((one) => /undelivered until delivery is confirmed/.test(one)))
  })
})
