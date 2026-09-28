import { test } from 'node:test'
import assert from 'node:assert/strict'
import { breadth, heatmap, matches, movers, turnoverOf, type MarketRow } from './discovery.ts'
import type { Instrument, QuoteView } from './instrument.ts'

/**
 * Ranking real markets.
 *
 * Every test here is about the same distinction: a market whose numbers are missing is unknown, not zero. A losers list
 * that quietly includes every pair with no reported change would be inventing a fact about each of them, and a volume list
 * that treats an unreported turnover as nothing would put a busy market last.
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
  const quote: QuoteView = {
    instrumentId: instrument.instrumentId,
    last: 100,
    previousClose: 100,
    change: 0,
    changePercent: 0,
    bid: null,
    ask: null,
    volume: 10,
    quoteVolume: 1000,
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
  return { instrument, quote }
}

// ---------------------------------------------------------------- turnover

test('turnover is the provider’s own figure where it has one', () => {
  assert.equal(turnoverOf(row('BTCUSDT', { quoteVolume: 4_200 }).quote), 4_200)
})

test('turnover falls back to price times volume, which is the same quantity', () => {
  assert.equal(turnoverOf(row('BTCUSDT', { quoteVolume: null, volume: 3, last: 50 }).quote), 150)
})

test('turnover nobody reported is unknown rather than zero', () => {
  // A market's turnover is not zero just because it was not reported. Zero would put a busy market last in a volume list.
  assert.equal(turnoverOf(row('X', { quoteVolume: null, volume: null }).quote), null)
  assert.equal(turnoverOf(row('X', { quoteVolume: null, volume: 3, last: null }).quote), null)
  assert.equal(turnoverOf(row('X', { quoteVolume: Number.NaN, volume: null }).quote), null)
})

// ---------------------------------------------------------------- movers

test('gainers are ordered by how much they gained, and only gainers are in it', () => {
  const rows = [
    row('AUSDT', { changePercent: 2 }),
    row('BUSDT', { changePercent: 9 }),
    row('CUSDT', { changePercent: -4 }),
    row('DUSDT', { changePercent: 5 })
  ]
  assert.deepEqual(
    movers(rows, 'gainers', 10).map((r) => r.instrument.symbol),
    ['BUSDT', 'DUSDT', 'AUSDT']
  )
})

test('losers stay negative rather than being inverted into gains', () => {
  const rows = [row('AUSDT', { changePercent: -2 }), row('BUSDT', { changePercent: -9 }), row('CUSDT', { changePercent: 4 })]
  const found = movers(rows, 'losers', 10)
  assert.deepEqual(
    found.map((r) => r.instrument.symbol),
    ['BUSDT', 'AUSDT']
  )
  assert.ok(found.every((r) => (r.quote.changePercent as number) < 0))
})

test('a market with no reported change is in neither list', () => {
  const rows = [row('AUSDT', { changePercent: null }), row('BUSDT', { changePercent: 1 })]
  assert.deepEqual(movers(rows, 'gainers').map((r) => r.instrument.symbol), ['BUSDT'])
  assert.deepEqual(movers(rows, 'losers'), [])
})

test('a market with no price is not ranked at all', () => {
  const rows = [row('AUSDT', { last: null, changePercent: 50 }), row('BUSDT', { changePercent: 1 })]
  assert.deepEqual(movers(rows, 'gainers').map((r) => r.instrument.symbol), ['BUSDT'])
})

test('a market whose data is unavailable is not ranked, whatever it last said', () => {
  const rows = [row('AUSDT', { freshness: 'unavailable', changePercent: 99 }), row('BUSDT', { changePercent: 1 })]
  assert.deepEqual(movers(rows, 'gainers').map((r) => r.instrument.symbol), ['BUSDT'])
})

test('equal movements break the tie the same way every time', () => {
  // Without a rule these two swap places on every tick and the list flickers.
  const rows = [
    row('AUSDT', { changePercent: 5, quoteVolume: 10 }),
    row('BUSDT', { changePercent: 5, quoteVolume: 90 }),
    row('CUSDT', { changePercent: 5, quoteVolume: 90 })
  ]
  const once = movers(rows, 'gainers').map((r) => r.instrument.symbol)
  const twice = movers([...rows].reverse(), 'gainers').map((r) => r.instrument.symbol)
  assert.deepEqual(once, ['BUSDT', 'CUSDT', 'AUSDT'])
  assert.deepEqual(twice, once)
})

test('volume leaders rank by turnover and exclude the ones nobody reported', () => {
  const rows = [
    row('AUSDT', { quoteVolume: 10 }),
    row('BUSDT', { quoteVolume: 300 }),
    row('CUSDT', { quoteVolume: null, volume: null })
  ]
  assert.deepEqual(
    movers(rows, 'volume').map((r) => r.instrument.symbol),
    ['BUSDT', 'AUSDT']
  )
})

test('the most active are the biggest moves either way, not the biggest gains', () => {
  const rows = [row('AUSDT', { changePercent: 3 }), row('BUSDT', { changePercent: -12 }), row('CUSDT', { changePercent: 7 })]
  assert.deepEqual(
    movers(rows, 'active').map((r) => r.instrument.symbol),
    ['BUSDT', 'CUSDT', 'AUSDT']
  )
})

test('the limit is respected', () => {
  const rows = Array.from({ length: 30 }, (_v, i) => row(`S${i}USDT`, { changePercent: i + 1 }))
  assert.equal(movers(rows, 'gainers', 5).length, 5)
})

test('no usable markets gives an empty list rather than an invented ranking', () => {
  assert.deepEqual(movers([], 'gainers'), [])
  assert.deepEqual(movers([row('AUSDT', { last: null })], 'volume'), [])
})

// ---------------------------------------------------------------- filters

test('a quote-currency filter compares the currency, not the symbol text', () => {
  const rows = [row('BTCUSDT', {}, 'USDT'), row('BTCBUSD', {}, 'BUSD')]
  assert.deepEqual(
    movers(rows, 'volume', 10, { quoteCurrency: 'usdt' }).map((r) => r.instrument.symbol),
    ['BTCUSDT']
  )
})

test('a turnover threshold excludes markets whose turnover is unknown', () => {
  assert.equal(matches(row('A', { quoteVolume: null, volume: null }), { minQuoteVolume: 1 }), false)
  assert.equal(matches(row('A', { quoteVolume: 5 }), { minQuoteVolume: 10 }), false)
  assert.equal(matches(row('A', { quoteVolume: 50 }), { minQuoteVolume: 10 }), true)
})

test('a text filter looks at the symbol and the name', () => {
  assert.equal(matches(row('BTCUSDT'), { text: 'btc' }), true)
  assert.equal(matches(row('BTCUSDT'), { text: 'solana' }), false)
  // Whitespace alone is not a filter.
  assert.equal(matches(row('BTCUSDT'), { text: '   ' }), true)
})

// ---------------------------------------------------------------- heatmap

test('every tile is a real market, sized by turnover', () => {
  const tiles = heatmap([row('AUSDT', { quoteVolume: 300 }), row('BUSDT', { quoteVolume: 100 })])
  assert.deepEqual(tiles.map((t) => t.instrument.symbol), ['AUSDT', 'BUSDT'])
  assert.equal(tiles[0].turnover, 300)
  assert.equal(tiles[0].weight, 0.75)
  assert.equal(tiles[1].weight, 0.25)
})

test('the weights of what is drawn add up to one', () => {
  const rows = Array.from({ length: 10 }, (_v, i) => row(`S${i}USDT`, { quoteVolume: (i + 1) * 11 }))
  const tiles = heatmap(rows, 4)
  assert.equal(tiles.length, 4)
  const total = tiles.reduce((sum, t) => sum + t.weight, 0)
  assert.ok(Math.abs(total - 1) < 1e-12, `weights summed to ${total}`)
})

test('a market with no turnover is not given a tile', () => {
  const tiles = heatmap([row('AUSDT', { quoteVolume: 0, volume: 0 }), row('BUSDT', { quoteVolume: null, volume: null }), row('CUSDT', { quoteVolume: 5 })])
  assert.deepEqual(tiles.map((t) => t.instrument.symbol), ['CUSDT'])
})

test('an empty heatmap is empty, not a grid of placeholders', () => {
  assert.deepEqual(heatmap([]), [])
})

// ---------------------------------------------------------------- breadth

test('breadth counts a defined set and says how large it was', () => {
  const rows = [
    row('AUSDT', { changePercent: 1 }),
    row('BUSDT', { changePercent: 2 }),
    row('CUSDT', { changePercent: -1 }),
    row('DUSDT', { changePercent: 0 })
  ]
  const out = breadth(rows)
  assert.deepEqual(out, { advancing: 2, declining: 1, unchanged: 1, total: 4, ratio: 2 })
})

test('an unknown move is not counted as a flat one', () => {
  const out = breadth([row('AUSDT', { changePercent: null }), row('BUSDT', { changePercent: 1 })])
  assert.equal(out.unchanged, 0)
  assert.equal(out.total, 1)
})

test('nothing declining leaves the ratio unavailable rather than infinite', () => {
  // Dividing by zero would not be a ratio, and Infinity on a dashboard is not an answer.
  assert.equal(breadth([row('AUSDT', { changePercent: 3 })]).ratio, null)
  assert.equal(breadth([]).ratio, null)
})
