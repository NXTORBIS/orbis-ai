import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSET_TYPES,
  changeFrom,
  describeAge,
  explainFreshness,
  FRESHNESS_LABEL,
  freshnessOf,
  instrumentId,
  parseInstrumentId,
  STALE_AFTER_MS,
  viewOf,
  type Quote
} from './instrument.ts'

/**
 * What a price is, and whether to believe it.
 *
 * Most of these are about the difference between "zero" and "unknown", and between "delayed" and "stale". Both
 * distinctions are the kind that a screen quietly gets wrong and then shows a confident green dot over a number from a
 * quarter of an hour ago.
 */

const quote = (over: Partial<Quote> = {}): Quote => ({
  instrumentId: 'binance:crypto:binance:btcusdt',
  last: 108_245.32,
  previousClose: 106_000,
  change: 2245.32,
  changePercent: 2.11,
  bid: null,
  ask: null,
  volume: null,
  dayHigh: null,
  dayLow: null,
  timestamp: 1_000_000,
  delayedByMs: 0,
  marketStatus: 'always-open',
  source: 'Binance',
  ...over
})

// ---------------------------------------------------------------- identity

test('an instrument is identified by where it trades, not only by its symbol', () => {
  // The mistake this exists to prevent: NVDA on one exchange and NVDA somewhere else are not the same instrument, and a
  // row keyed on the symbol alone shows two prices and cannot say which is which.
  const nasdaq = instrumentId({ provider: 'alpha', assetType: 'stock', exchange: 'NASDAQ', symbol: 'NVDA' })
  const other = instrumentId({ provider: 'alpha', assetType: 'stock', exchange: 'LSE', symbol: 'NVDA' })
  assert.notEqual(nasdaq, other)
})

test('the same instrument from two providers is two instruments, because the prices are two prices', () => {
  const binance = instrumentId({ provider: 'binance', assetType: 'crypto', exchange: 'binance', symbol: 'BTCUSDT' })
  const coinbase = instrumentId({ provider: 'coinbase', assetType: 'crypto', exchange: 'coinbase', symbol: 'BTC-USD' })
  assert.notEqual(binance, coinbase)
})

test('an id is case-insensitive, so the same instrument asked for differently is the same instrument', () => {
  assert.equal(
    instrumentId({ provider: 'Binance', assetType: 'crypto', exchange: 'Binance', symbol: 'BTCUSDT' }),
    instrumentId({ provider: 'binance', assetType: 'crypto', exchange: 'binance', symbol: 'btcusdt' })
  )
})

test('an id reads back apart, and nonsense does not', () => {
  const id = instrumentId({ provider: 'binance', assetType: 'crypto', exchange: 'binance', symbol: 'BTCUSDT' })
  assert.deepEqual(parseInstrumentId(id), {
    provider: 'binance',
    assetType: 'crypto',
    exchange: 'binance',
    symbol: 'btcusdt'
  })
  assert.equal(parseInstrumentId('btc'), null)
  assert.equal(parseInstrumentId('a:b:c'), null)
  assert.equal(parseInstrumentId('a::c:d'), null)
})

test('a symbol with punctuation in it survives, because real symbols have punctuation', () => {
  const id = instrumentId({ provider: 'coinbase', assetType: 'crypto', exchange: 'coinbase', symbol: 'BTC-USD' })
  assert.equal(parseInstrumentId(id)?.symbol, 'btc-usd')
})

// ---------------------------------------------------------------- freshness

test('a live quote that just arrived is live', () => {
  const { freshness } = freshnessOf(quote(), 'crypto', 1_000_500)
  assert.equal(freshness, 'real-time')
})

test('a provider that is behind gives delayed data, however recently it sent it', () => {
  // The whole point. A fifteen-minute feed is fifteen minutes behind even when the packet arrived a second ago.
  const { freshness } = freshnessOf(quote({ delayedByMs: 15 * 60_000, marketStatus: 'open' }), 'stock', 1_000_500)
  assert.equal(freshness, 'delayed')
})

test('a quote older than its type allows is stale, and stale beats delayed', () => {
  // A delayed feed that has also stopped arriving is stale. Saying "delayed" about it would report the smaller problem.
  const old = quote({ timestamp: 1_000_000, delayedByMs: 15 * 60_000, marketStatus: 'open' })
  assert.equal(freshnessOf(old, 'crypto', 1_000_000 + 61_000).freshness, 'stale')
})

test('each asset type has its own patience, because the asset types are not alike', () => {
  // A crypto pair silent for two minutes has stopped. A stock silent for two minutes is just quiet.
  const twoMinutes = 1_000_000 + 2 * 60_000
  assert.equal(freshnessOf(quote({ marketStatus: 'open' }), 'crypto', twoMinutes).freshness, 'stale')
  assert.equal(freshnessOf(quote({ marketStatus: 'open' }), 'stock', twoMinutes).freshness, 'real-time')
  // And an economic figure is monthly: a week-old one is the current one.
  const aWeek = 1_000_000 + 7 * 24 * 60 * 60 * 1000
  assert.equal(freshnessOf(quote({ marketStatus: 'open' }), 'economic', aWeek).freshness, 'real-time')
})

test('every asset type has a staleness threshold, so none of them falls through', () => {
  for (const type of ASSET_TYPES) {
    assert.equal(typeof STALE_AFTER_MS[type], 'number', `${type} has no threshold`)
    assert.ok(STALE_AFTER_MS[type] > 0, `${type} would be stale at once`)
  }
})

test('a closed market is not a broken feed', () => {
  // The last trade of the session is the price until the market opens again. Calling that stale would put a warning on
  // every stock all weekend.
  const overnight = 1_000_000 + 12 * 60 * 60 * 1000
  assert.equal(freshnessOf(quote({ marketStatus: 'closed' }), 'stock', overnight).freshness, 'real-time')
  assert.equal(freshnessOf(quote({ marketStatus: 'after-hours' }), 'stock', overnight).freshness, 'real-time')
})

test('no number at all is unavailable, which is not the same as zero', () => {
  assert.equal(freshnessOf(quote({ last: null }), 'crypto', 1_000_000).freshness, 'unavailable')
  // Zero is a price something can really have.
  assert.equal(freshnessOf(quote({ last: 0 }), 'crypto', 1_000_100).freshness, 'real-time')
})

test('a quote with no timestamp is unavailable rather than infinitely old', () => {
  assert.equal(freshnessOf(quote({ timestamp: 0 }), 'crypto', 1_000_000).freshness, 'unavailable')
  assert.equal(freshnessOf(quote({ timestamp: Number.NaN }), 'crypto', 1_000_000).freshness, 'unavailable')
})

test('a timestamp in the future is treated as now, not as a negative age', () => {
  const view = viewOf(quote({ timestamp: 2_000_000 }), 'crypto', 1_000_000)
  assert.equal(view.ageMs, 0)
  assert.equal(view.freshness, 'real-time')
})

// ---------------------------------------------------------------- what is said about it

test('every freshness has a word, so nothing depends on a colour', () => {
  for (const key of ['real-time', 'delayed', 'stale', 'unavailable'] as const) {
    assert.ok(FRESHNESS_LABEL[key].length > 0)
  }
})

test('the explanation says which provider, and how far behind', () => {
  const delayed = viewOf(quote({ delayedByMs: 15 * 60_000, marketStatus: 'open' }), 'stock', 1_000_500)
  const said = explainFreshness(delayed)
  assert.match(said, /Binance/)
  assert.match(said, /15 minutes/)
})

test('a stale value is described as the last one, not the current one', () => {
  const stale = viewOf(quote({ marketStatus: 'open' }), 'crypto', 1_000_000 + 5 * 60_000)
  assert.match(explainFreshness(stale), /last value, not the current one/)
})

test('ages read the way a person would say them', () => {
  assert.equal(describeAge(500), 'just now')
  assert.equal(describeAge(30_000), '30 seconds ago')
  assert.equal(describeAge(60_000), '1 minute ago')
  assert.equal(describeAge(5 * 60_000), '5 minutes ago')
  assert.equal(describeAge(2 * 60 * 60_000), '2 hours ago')
  assert.equal(describeAge(3 * 24 * 60 * 60_000), '3 days ago')
  assert.equal(describeAge(-1), 'an unknown time ago')
})

// ---------------------------------------------------------------- the change

test('a change is worked out the same way whoever the provider is', () => {
  assert.deepEqual(changeFrom(110, 100), { change: 10, changePercent: 10 })
  assert.deepEqual(changeFrom(90, 100), { change: -10, changePercent: -10 })
})

test('not knowing is null, not zero', () => {
  assert.deepEqual(changeFrom(null, 100), { change: null, changePercent: null })
  assert.deepEqual(changeFrom(110, null), { change: null, changePercent: null })
  assert.deepEqual(changeFrom(Number.NaN, 100), { change: null, changePercent: null })
})

test('no change is a real answer and is reported as zero', () => {
  assert.deepEqual(changeFrom(100, 100), { change: 0, changePercent: 0 })
})

test('a previous close of zero gives a change but no percentage, rather than infinity', () => {
  assert.deepEqual(changeFrom(5, 0), { change: 5, changePercent: null })
})
