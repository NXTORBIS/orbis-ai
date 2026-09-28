import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanQuery,
  columnsOf,
  DEFAULT_QUERY,
  holds,
  PRESETS,
  queryNeedsCandles,
  screen,
  screenSnapshot,
  valueOf,
  type ScreenerQuery,
  queryNeedsDerivatives
} from './screener.ts'
import type { Candle } from './indicators.ts'
import type { MarketRow } from './discovery.ts'
import type { Instrument, QuoteView } from './instrument.ts'

/**
 * Screening real markets.
 *
 * The two things every test here is about: a market missing the field a condition asks about **fails that condition**
 * rather than passing as zero, and a screen that could not examine everything **says so** rather than presenting the part
 * it managed as the whole market.
 */

const row = (symbol: string, over: Partial<QuoteView> = {}, currency = 'USDT'): MarketRow => {
  const instrument: Instrument = {
    instrumentId: `binance:crypto:binance:${symbol.toLowerCase()}`,
    symbol,
    name: `${symbol.replace(currency, '')} / ${currency}`,
    assetType: 'crypto',
    exchange: 'binance',
    currency,
    provider: 'binance'
  }
  return {
    instrument,
    quote: {
      instrumentId: instrument.instrumentId,
      last: 100,
      previousClose: 100,
      change: 0,
      changePercent: 0,
      bid: null,
      ask: null,
      volume: 10,
      quoteVolume: 1_000_000,
      dayHigh: null,
      dayLow: null,
      timestamp: 1_000_000,
      delayedByMs: 0,
      marketStatus: 'always-open',
      source: 'Binance',
      freshness: 'real-time',
      ageMs: 0,
      ...over
    }
  }
}

/** A rising series, which makes RSI high and puts the price above every moving average. */
const rising = (n = 120): Candle[] =>
  Array.from({ length: n }, (_v, i) => ({
    time: i * 3_600_000,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100 + i,
    volume: 10
  }))

const falling = (n = 120): Candle[] =>
  Array.from({ length: n }, (_v, i) => ({
    time: i * 3_600_000,
    open: 300 - i,
    high: 301 - i,
    low: 299 - i,
    close: 300 - i,
    volume: 10
  }))

const query = (over: Partial<ScreenerQuery> = {}): ScreenerQuery => ({ ...DEFAULT_QUERY, ...over })

// ---------------------------------------------------------------- conditions

test('a condition holds only when the value is known', () => {
  // The whole point: unknown is not zero, and zero would pass "less than 30".
  assert.equal(holds(10, { field: 'rsi', operator: 'lt', value: 30 }), true)
  assert.equal(holds(null, { field: 'rsi', operator: 'lt', value: 30 }), false)
  assert.equal(holds(Number.NaN, { field: 'rsi', operator: 'lt', value: 30 }), false)
})

test('between takes its ends either way round', () => {
  const c = { field: 'rsi' as const, operator: 'between' as const, value: 70, value2: 30 }
  assert.equal(holds(50, c), true)
  assert.equal(holds(30, c), true)
  assert.equal(holds(70, c), true)
  assert.equal(holds(71, c), false)
})

// ---------------------------------------------------------------- values

test('snapshot fields come straight from the quote', () => {
  const r = row('BTCUSDT', { last: 84_000, changePercent: 2.5, volume: 12, quoteVolume: 9_000_000 })
  assert.equal(valueOf(r, 'price', null), 84_000)
  assert.equal(valueOf(r, 'changePercent', null), 2.5)
  assert.equal(valueOf(r, 'volume', null), 12)
  assert.equal(valueOf(r, 'turnover', null), 9_000_000)
})

test('a field the provider did not report is unknown, not zero', () => {
  const r = row('XUSDT', { last: null, changePercent: null, volume: null, quoteVolume: null })
  assert.equal(valueOf(r, 'price', null), null)
  assert.equal(valueOf(r, 'changePercent', null), null)
  assert.equal(valueOf(r, 'turnover', null), null)
})

test('a technical field with no candles is unknown rather than computed from nothing', () => {
  assert.equal(valueOf(row('BTCUSDT'), 'rsi', null), null)
  assert.equal(valueOf(row('BTCUSDT'), 'rsi', []), null)
})

test('RSI is high on a rising series and low on a falling one', () => {
  const up = valueOf(row('BTCUSDT'), 'rsi', rising(), { field: 'rsi', operator: 'gt', value: 0, period: 14 })
  const down = valueOf(row('BTCUSDT'), 'rsi', falling(), { field: 'rsi', operator: 'gt', value: 0, period: 14 })
  assert.ok(up !== null && up > 90, `expected a high RSI, got ${up}`)
  assert.ok(down !== null && down < 10, `expected a low RSI, got ${down}`)
})

test('price against a moving average is a percentage either side of it', () => {
  const above = valueOf(row('BTCUSDT'), 'priceVsSma', rising(), { field: 'priceVsSma', operator: 'gt', value: 0, period: 20 })
  const below = valueOf(row('BTCUSDT'), 'priceVsSma', falling(), { field: 'priceVsSma', operator: 'lt', value: 0, period: 20 })
  assert.ok(above !== null && above > 0, `rising should sit above its average, got ${above}`)
  assert.ok(below !== null && below < 0, `falling should sit below its average, got ${below}`)
})

test('ATR is expressed against the price, so two markets can be compared', () => {
  const value = valueOf(row('BTCUSDT'), 'atrPercent', rising(), { field: 'atrPercent', operator: 'gt', value: 0, period: 14 })
  // The series moves by about 1 in 200, so a couple of percent at most — the point is that it is a share, not a raw range.
  assert.ok(value !== null && value > 0 && value < 10, `expected a small percentage, got ${value}`)
})

test('an indicator with too little history is unknown', () => {
  const short = rising(5)
  assert.equal(valueOf(row('BTCUSDT'), 'rsi', short, { field: 'rsi', operator: 'lt', value: 30, period: 14 }), null)
})

// ---------------------------------------------------------------- the cheap stage

test('snapshot conditions narrow the universe without touching candles', () => {
  const rows = [
    row('AUSDT', { changePercent: 9, quoteVolume: 50_000_000 }),
    row('BUSDT', { changePercent: 1, quoteVolume: 50_000_000 }),
    row('CUSDT', { changePercent: 9, quoteVolume: 100 })
  ]
  const { passed } = screenSnapshot(
    rows,
    query({
      conditions: [
        { field: 'changePercent', operator: 'gt', value: 5 },
        { field: 'turnover', operator: 'gt', value: 1_000_000 }
      ]
    })
  )
  assert.deepEqual(passed.map((r) => r.instrument.symbol), ['AUSDT'])
})

test('with “any” and a technical condition, nothing can be ruled out cheaply', () => {
  // A market failing every cheap condition could still pass on RSI, so excluding it here would lose a real result.
  const rows = [row('AUSDT', { changePercent: -20 }), row('BUSDT', { changePercent: 30 })]
  const { passed } = screenSnapshot(
    rows,
    query({
      match: 'any',
      conditions: [
        { field: 'changePercent', operator: 'gt', value: 5 },
        { field: 'rsi', operator: 'lt', value: 30 }
      ]
    })
  )
  assert.equal(passed.length, 2)
})

test('the query’s own filter applies before any condition', () => {
  const rows = [row('BTCUSDT', {}, 'USDT'), row('BTCBUSD', {}, 'BUSD')]
  const { passed, universeSize } = screenSnapshot(rows, query({ filter: { quoteCurrency: 'USDT' } }))
  assert.equal(universeSize, 1)
  assert.deepEqual(passed.map((r) => r.instrument.symbol), ['BTCUSDT'])
})

// ---------------------------------------------------------------- the answer

test('a screen with no conditions is the universe, ordered', () => {
  const rows = [row('AUSDT', { quoteVolume: 10 }), row('BUSDT', { quoteVolume: 90 })]
  const answer = screen(rows, query())
  assert.deepEqual(answer.results.map((r) => r.row.instrument.symbol), ['BUSDT', 'AUSDT'])
  assert.equal(answer.universeSize, 2)
  assert.equal(answer.skipped, 0)
})

test('a technical screen examines only what it was given candles for, and says what it skipped', () => {
  const rows = [row('AUSDT'), row('BUSDT'), row('CUSDT')]
  const answer = screen(
    rows,
    query({ conditions: [{ field: 'rsi', operator: 'lt', value: 30, period: 14 }] }),
    (id) => (id.endsWith('ausdt') ? falling() : null)
  )
  assert.deepEqual(answer.results.map((r) => r.row.instrument.symbol), ['AUSDT'])
  assert.equal(answer.examined, 1)
  // A screen that quietly examined one of three would present its answer as the market's, and it would not be.
  assert.equal(answer.skipped, 2)
  assert.equal(answer.afterSnapshot, 3)
})

test('a market that was examined and failed is not counted as skipped', () => {
  const rows = [row('AUSDT'), row('BUSDT')]
  const answer = screen(
    rows,
    query({ conditions: [{ field: 'rsi', operator: 'lt', value: 30, period: 14 }] }),
    (id) => (id.endsWith('ausdt') ? falling() : rising())
  )
  assert.deepEqual(answer.results.map((r) => r.row.instrument.symbol), ['AUSDT'])
  assert.equal(answer.examined, 2)
  assert.equal(answer.skipped, 0)
})

test('every condition must hold under “all”, and one is enough under “any”', () => {
  const rows = [row('AUSDT', { changePercent: 9, quoteVolume: 10 }), row('BUSDT', { changePercent: -2, quoteVolume: 90 })]
  const conditions = [
    { field: 'changePercent' as const, operator: 'gt' as const, value: 5 },
    { field: 'turnover' as const, operator: 'gt' as const, value: 50 }
  ]
  assert.deepEqual(screen(rows, query({ conditions, match: 'all' })).results.map((r) => r.row.instrument.symbol), [])
  assert.deepEqual(
    screen(rows, query({ conditions, match: 'any' }))
      .results.map((r) => r.row.instrument.symbol)
      .sort(),
    ['AUSDT', 'BUSDT']
  )
})

test('the answer carries the fields the query asked about', () => {
  const answer = screen(
    [row('AUSDT', { changePercent: 7 })],
    query({ conditions: [{ field: 'changePercent', operator: 'gt', value: 5 }], sort: { field: 'turnover', direction: 'desc' } })
  )
  assert.deepEqual(answer.columns, ['changePercent', 'turnover'])
  assert.equal(answer.results[0].values.changePercent, 7)
})

test('a market with no sortable value goes last, whichever way the sort runs', () => {
  const rows = [row('AUSDT', { quoteVolume: null, volume: null }), row('BUSDT', { quoteVolume: 5 })]
  for (const direction of ['asc', 'desc'] as const) {
    const answer = screen(rows, query({ sort: { field: 'turnover', direction } }))
    assert.equal(answer.results[answer.results.length - 1].row.instrument.symbol, 'AUSDT', `failed for ${direction}`)
  }
})

test('the limit is respected', () => {
  const rows = Array.from({ length: 40 }, (_v, i) => row(`S${i}USDT`, { quoteVolume: i }))
  assert.equal(screen(rows, query({ limit: 5 })).results.length, 5)
})

test('an empty universe gives an empty answer rather than an invented one', () => {
  const answer = screen([], query())
  assert.deepEqual(answer.results, [])
  assert.equal(answer.universeSize, 0)
})

// ---------------------------------------------------------------- the cost question

test('a query says whether it needs candles', () => {
  assert.equal(queryNeedsCandles(query({ conditions: [{ field: 'price', operator: 'gt', value: 1 }] })), false)
  assert.equal(queryNeedsCandles(query({ conditions: [{ field: 'rsi', operator: 'lt', value: 30 }] })), true)
  // Sorting by a technical field costs the same as filtering on one.
  assert.equal(queryNeedsCandles(query({ sort: { field: 'rsi', direction: 'asc' } })), true)
})

// ---------------------------------------------------------------- reading one back

test('a query read from a file keeps what is valid and drops what is not', () => {
  const cleaned = cleanQuery({
    conditions: [
      { field: 'rsi', operator: 'lt', value: 30, period: 14 },
      { field: 'nonsense', operator: 'lt', value: 1 },
      { field: 'price', operator: 'sideways', value: 5 },
      'not an object'
    ],
    match: 'any',
    sort: { field: 'rsi', direction: 'asc' },
    limit: 9999
  })
  assert.equal(cleaned.conditions.length, 2)
  assert.equal(cleaned.conditions[0].field, 'rsi')
  // An unknown operator becomes the safe one rather than failing the whole query.
  assert.equal(cleaned.conditions[1].operator, 'gt')
  assert.equal(cleaned.match, 'any')
  assert.equal(cleaned.limit, 200)
})

test('a period of zero is not kept, because it is not a period', () => {
  const cleaned = cleanQuery({ conditions: [{ field: 'rsi', operator: 'lt', value: 30, period: 0 }] })
  assert.equal(cleaned.conditions[0].period, undefined)
})

test('rubbish becomes the default query rather than throwing', () => {
  assert.deepEqual(cleanQuery(null).conditions, [])
  assert.deepEqual(cleanQuery('screen everything').sort, DEFAULT_QUERY.sort)
})

// ---------------------------------------------------------------- presets

test('every preset is a real set of conditions, not a list of names', () => {
  // A preset called "High volume" that returned a hardcoded set of coins would be fake functionality wearing a filter's
  // label. Each of these has to be something the engine can evaluate.
  assert.ok(PRESETS.length >= 4)
  for (const preset of PRESETS) {
    assert.ok(preset.query.conditions.length > 0, `${preset.name} has no conditions`)
    assert.deepEqual(cleanQuery(preset.query).conditions.length, preset.query.conditions.length, `${preset.name} does not survive validation`)
  }
})

test('a preset can honestly come back empty', () => {
  const oversold = PRESETS.find((p) => p.name === 'Oversold, with volume')
  assert.ok(oversold)
  // Nothing in this universe is oversold, and the right answer is nothing rather than the closest few.
  const answer = screen([row('AUSDT', { quoteVolume: 100_000_000 })], oversold.query, () => rising())
  assert.deepEqual(answer.results, [])
})

test('the columns of a query are its fields plus what it sorts by', () => {
  assert.deepEqual(
    columnsOf(query({ conditions: [{ field: 'rsi', operator: 'lt', value: 30 }], sort: { field: 'price', direction: 'asc' } })),
    ['rsi', 'price']
  )
})

// ---------------------------------------------------------------- nested groups

const marketAt = (symbol: string, price: number, change: number, turnover: number): MarketRow =>
  ({
    instrument: { instrumentId: `binance:crypto:binance:${symbol.toLowerCase()}`, symbol, name: symbol, assetType: 'crypto', exchange: 'binance', currency: 'USDT', provider: 'binance' },
    quote: {
      instrumentId: `binance:crypto:binance:${symbol.toLowerCase()}`,
      last: price,
      changePercent: change,
      quoteVolume: turnover,
      volume: turnover / Math.max(price, 1),
      previousClose: price,
      change: 0,
      bid: price - 0.5,
      ask: price + 0.5,
      dayHigh: price,
      dayLow: price,
      timestamp: 1000,
      delayedByMs: 0,
      marketStatus: 'always-open',
      source: 'binance',
      freshness: 'real-time',
      ageMs: 0
    }
  }) as unknown as MarketRow

test('two groups joined by `any` match a market that satisfies either one', () => {
  // (change > 5 and turnover > 1m) or (change < -5 and turnover > 1m)
  const query: ScreenerQuery = {
    ...DEFAULT_QUERY,
    conditions: [],
    groups: [
      {
        match: 'all',
        conditions: [
          { field: 'changePercent', operator: 'gt', value: 5 },
          { field: 'turnover', operator: 'gt', value: 1_000_000 }
        ]
      },
      {
        match: 'all',
        conditions: [
          { field: 'changePercent', operator: 'lt', value: -5 },
          { field: 'turnover', operator: 'gt', value: 1_000_000 }
        ]
      }
    ],
    groupMatch: 'any'
  }
  const rows = [
    marketAt('UPUSDT', 100, 9, 5_000_000),
    marketAt('DOWNUSDT', 100, -9, 5_000_000),
    marketAt('FLATUSDT', 100, 0.5, 5_000_000),
    // Moves plenty, but nobody trades it: fails the turnover term in both groups.
    marketAt('THINUSDT', 100, 20, 1000)
  ]
  const symbols = screen(rows, query).results.map((one) => one.row.instrument.symbol).sort()
  assert.deepEqual(symbols, ['DOWNUSDT', 'UPUSDT'])
})

test('groups joined by `all` need every group to hold', () => {
  const query: ScreenerQuery = {
    ...DEFAULT_QUERY,
    conditions: [],
    groups: [
      { match: 'any', conditions: [{ field: 'changePercent', operator: 'gt', value: 5 }] },
      { match: 'any', conditions: [{ field: 'turnover', operator: 'gt', value: 1_000_000 }] }
    ],
    groupMatch: 'all'
  }
  const rows = [marketAt('AUSDT', 100, 9, 5_000_000), marketAt('BUSDT', 100, 9, 100)]
  assert.deepEqual(
    screen(rows, query).results.map((one) => one.row.instrument.symbol),
    ['AUSDT']
  )
})

test('top-level conditions combine with the groups rather than being ignored', () => {
  const query: ScreenerQuery = {
    ...DEFAULT_QUERY,
    conditions: [{ field: 'price', operator: 'gt', value: 50 }],
    match: 'all',
    groups: [{ match: 'any', conditions: [{ field: 'changePercent', operator: 'gt', value: 5 }] }],
    groupMatch: 'all'
  }
  const rows = [marketAt('AUSDT', 100, 9, 1), marketAt('CHEAPUSDT', 10, 9, 1)]
  assert.deepEqual(
    screen(rows, query).results.map((one) => one.row.instrument.symbol),
    ['AUSDT']
  )
})

test('a query with no conditions at all matches everything', () => {
  const rows = [marketAt('AUSDT', 100, 1, 1), marketAt('BUSDT', 2, 1, 1)]
  assert.equal(screen(rows, { ...DEFAULT_QUERY, conditions: [] }).results.length, 2)
})

test('a malformed group is dropped, and the query becomes narrower rather than wider', () => {
  const cleaned = cleanQuery({
    conditions: [{ field: 'price', operator: 'gt', value: 1 }],
    groups: [{ conditions: [{ field: 'nonsense', operator: 'gt', value: 1 }] }, 'not a group', { conditions: [] }]
  })
  assert.equal(cleaned.groups, undefined)
  assert.equal(cleaned.conditions.length, 1)
})

test('groups survive being written down and read back', () => {
  const cleaned = cleanQuery({
    conditions: [],
    groupMatch: 'any',
    groups: [
      { match: 'any', conditions: [{ field: 'rsi', operator: 'lt', value: 30 }] },
      { match: 'all', conditions: [{ field: 'turnover', operator: 'gt', value: 1 }] }
    ]
  })
  assert.equal(cleaned.groups?.length, 2)
  assert.equal(cleaned.groupMatch, 'any')
  assert.equal(cleaned.groups?.[0].match, 'any')
})

// ---------------------------------------------------------------- derivatives fields

test('a derivatives condition on a market with no derivatives excludes it rather than counting it as zero', () => {
  const query: ScreenerQuery = {
    ...DEFAULT_QUERY,
    conditions: [{ field: 'funding', operator: 'lt', value: 0 }]
  }
  const rows = [marketAt('SPOTUSDT', 100, 1, 1)]
  // Nothing supplied: funding is unknown, and an unknown never passes.
  assert.equal(screen(rows, query).results.length, 0)
  // Negative funding supplied, and it passes.
  assert.equal(screen(rows, query, () => null, () => ({ funding: -0.0001 })).results.length, 1)
})

test('funding is stored as a fraction and screened as a percentage', () => {
  const rows = [marketAt('PERPUSDT', 100, 1, 1)]
  const query: ScreenerQuery = { ...DEFAULT_QUERY, conditions: [{ field: 'funding', operator: 'gt', value: 0.005 }] }
  // 0.0001 is 0.01%, which is above 0.005%.
  assert.equal(screen(rows, query, () => null, () => ({ funding: 0.0001 })).results.length, 1)
  assert.equal(screen(rows, query, () => null, () => ({ funding: 0.00001 })).results.length, 0)
})

test('spread is measured from both sides of the quote, and a crossed quote has none', () => {
  const good = marketAt('AUSDT', 100, 1, 1)
  assert.ok((valueOf(good, 'spread', null) ?? 0) > 0)
  const crossed = marketAt('BUSDT', 100, 1, 1)
  ;(crossed.quote as { bid: number; ask: number }).bid = 101
  ;(crossed.quote as { bid: number; ask: number }).ask = 99
  assert.equal(valueOf(crossed, 'spread', null), null)
})

test('the query says whether it needs derivatives, so the caller knows to fetch them', () => {
  assert.equal(queryNeedsDerivatives({ ...DEFAULT_QUERY, conditions: [{ field: 'price', operator: 'gt', value: 1 }] }), false)
  assert.equal(
    queryNeedsDerivatives({
      ...DEFAULT_QUERY,
      conditions: [],
      groups: [{ match: 'all', conditions: [{ field: 'openInterest', operator: 'gt', value: 1 }] }]
    }),
    true
  )
})

test('an expensive condition inside an `any` group does not eliminate markets before it is judged', () => {
  // The bug this guards: narrowing on a condition nobody has answered yet drops markets that would have passed.
  const query: ScreenerQuery = {
    ...DEFAULT_QUERY,
    conditions: [],
    groups: [
      {
        match: 'any',
        conditions: [
          { field: 'rsi', operator: 'lt', value: 30 },
          { field: 'changePercent', operator: 'gt', value: 5 }
        ]
      }
    ]
  }
  const rows = [marketAt('AUSDT', 100, 9, 1)]
  const { passed } = screenSnapshot(rows, query)
  assert.equal(passed.length, 1)
})
