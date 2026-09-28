import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BinanceProvider, type SocketLike } from './binance.ts'
import { ProviderError } from '../../../shared/markets/provider.ts'

/**
 * The Binance adapter.
 *
 * Against a scripted server rather than the network, so the awkward answers -- a rate limit, a region block, a candle with
 * a missing price, a symbol nobody asked about -- can be made to happen on purpose. The point of every test here is that
 * a bad answer produces no number rather than a wrong one.
 */

const BTC = 'binance:crypto:binance:btcusdt'
const ETH = 'binance:crypto:binance:ethusdt'

/** A fetch that answers from a script and records what it was asked. */
const server = (
  routes: Record<string, unknown>,
  options: { status?: number; headers?: Record<string, string>; throws?: boolean; garbage?: boolean } = {}
): { fetchFn: typeof fetch; asked: string[] } => {
  const asked: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    if (options.throws) throw new Error('no route to host')
    const path = url.replace('https://api.binance.com', '')
    const key = Object.keys(routes).find((r) => path.startsWith(r))
    const status = options.status ?? (key ? 200 : 404)
    const headers = new Headers(options.headers ?? {})
    if (status !== 200) return new Response('', { status, headers })
    if (options.garbage) return new Response('not json at all', { status: 200, headers })
    return new Response(JSON.stringify(key ? routes[key] : {}), {
      status: 200,
      headers: { ...Object.fromEntries(headers), 'Content-Type': 'application/json' }
    })
  }) as unknown as typeof fetch
  return { fetchFn, asked }
}

const EXCHANGE_INFO = {
  symbols: [
    { symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT' },
    { symbol: 'BTCUSDC', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDC' },
    { symbol: 'ETHUSDT', status: 'TRADING', baseAsset: 'ETH', quoteAsset: 'USDT' },
    { symbol: 'WBTCETH', status: 'TRADING', baseAsset: 'WBTC', quoteAsset: 'ETH' },
    { symbol: 'OLDCOIN', status: 'BREAK', baseAsset: 'OLD', quoteAsset: 'USDT' }
  ]
}

const TICKER = {
  symbol: 'BTCUSDT',
  lastPrice: '84545.59',
  prevClosePrice: '84020.00',
  priceChange: '525.59',
  priceChangePercent: '0.625',
  bidPrice: '84545.58',
  askPrice: '84545.60',
  volume: '10384.91',
  highPrice: '85000.00',
  lowPrice: '83000.00',
  closeTime: 1_790_521_289_006
}

// ---------------------------------------------------------------- it is always usable

test('it needs no key, so it is always configured', () => {
  assert.deepEqual(new BinanceProvider().ready(), { ok: true })
})

test('there is no way to give it a key, which is how we know none is ever sent', () => {
  // A provider with nowhere to put a credential cannot leak one.
  const source = new BinanceProvider()
  const keys = Object.keys(source).concat(Object.keys(Object.getPrototypeOf(source)))
  for (const key of keys) {
    assert.ok(!/key|secret|token|password/i.test(key), `it has a "${key}"`)
  }
})

test('it declares only what it actually serves', () => {
  const caps = new BinanceProvider().capabilities
  assert.deepEqual(caps.assetTypes, ['crypto'])
  assert.equal(caps.streaming, true)
  assert.equal(caps.delayedByMs, 0, 'its public market data is live')
  // Funding and open interest come from a different Binance API. Declared false rather than declared and answered with
  // nothing, which is what would leave an empty panel looking like a fault.
  assert.equal(caps.funding, false)
  assert.equal(caps.openInterest, false)
  assert.equal(caps.options, false)
  assert.equal(caps.fundamentals, false)
})

// ---------------------------------------------------------------- quotes

test('a quote carries everything the feed gave and nothing it did not', async () => {
  const { fetchFn } = server({ '/api/v3/ticker/24hr': TICKER })
  const provider = new BinanceProvider({ fetchFn, now: () => 2_000_000 })
  const [quote] = await provider.quotes([BTC])
  assert.equal(quote.instrumentId, BTC)
  assert.equal(quote.last, 84545.59)
  assert.equal(quote.previousClose, 84020)
  assert.equal(quote.change, 525.59)
  assert.equal(quote.bid, 84545.58)
  assert.equal(quote.ask, 84545.6)
  assert.equal(quote.dayHigh, 85000)
  assert.equal(quote.timestamp, 1_790_521_289_006, 'the feed’s own time, not ours')
  assert.equal(quote.delayedByMs, 0)
  assert.equal(quote.marketStatus, 'always-open')
  assert.equal(quote.source, 'Binance')
})

test('a field the feed omits is null, not zero', async () => {
  const { fetchFn } = server({
    '/api/v3/ticker/24hr': { symbol: 'BTCUSDT', lastPrice: '84545.59' }
  })
  const provider = new BinanceProvider({ fetchFn, now: () => 2_000_000 })
  const [quote] = await provider.quotes([BTC])
  assert.equal(quote.last, 84545.59)
  assert.equal(quote.bid, null)
  assert.equal(quote.volume, null)
  assert.equal(quote.dayHigh, null)
  // With no previous close there is no change to report, rather than a change of the whole price.
  assert.equal(quote.previousClose, null)
  assert.equal(quote.change, null)
  assert.equal(quote.changePercent, null)
})

test('many instruments are one request, not one each', async () => {
  // Asking per symbol is what uses up a rate limit on a watchlist of forty.
  const { fetchFn, asked } = server({ '/api/v3/ticker/24hr': [TICKER, { ...TICKER, symbol: 'ETHUSDT' }] })
  const provider = new BinanceProvider({ fetchFn })
  const quotes = await provider.quotes([BTC, ETH])
  assert.equal(quotes.length, 2)
  assert.equal(asked.length, 1)
  assert.match(asked[0], /symbols=/)
})

test('an instrument that is not Binance’s is ignored rather than guessed at', async () => {
  const { fetchFn, asked } = server({ '/api/v3/ticker/24hr': TICKER })
  const provider = new BinanceProvider({ fetchFn })
  assert.deepEqual(await provider.quotes(['somebodyelse:crypto:x:btc']), [])
  assert.equal(asked.length, 0, 'nothing was even asked for')
})

test('a rate limit is reported with the wait the feed asked for', async () => {
  const { fetchFn } = server({ '/api/v3/ticker/24hr': {} }, { status: 429, headers: { 'retry-after': '30' } })
  const provider = new BinanceProvider({ fetchFn })
  await assert.rejects(
    () => provider.quotes([BTC]),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError)
      assert.equal(err.code, 'rate-limited')
      assert.equal(err.retryAfterMs, 30_000, 'its own number, not a guess')
      return true
    }
  )
})

test('a region block says so, because it is not a fault to retry forever', async () => {
  const { fetchFn } = server({ '/api/v3/ticker/24hr': {} }, { status: 451 })
  const provider = new BinanceProvider({ fetchFn })
  await assert.rejects(
    () => provider.quotes([BTC]),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError)
      assert.equal(err.code, 'unauthorized')
      assert.match(err.message, /location/)
      return true
    }
  )
})

test('an unreachable feed is a network error, not an empty price', async () => {
  const { fetchFn } = server({}, { throws: true })
  const provider = new BinanceProvider({ fetchFn })
  await assert.rejects(
    () => provider.quotes([BTC]),
    (err: unknown) => err instanceof ProviderError && err.code === 'network'
  )
})

test('a reply that is not the expected data is refused rather than half-read', async () => {
  const { fetchFn } = server({ '/api/v3/ticker/24hr': {} }, { garbage: true })
  const provider = new BinanceProvider({ fetchFn })
  await assert.rejects(
    () => provider.quotes([BTC]),
    (err: unknown) => err instanceof ProviderError && err.code === 'bad-response'
  )
})

// ---------------------------------------------------------------- candles

test('candles come back as candles, with the feed’s own times', async () => {
  const { fetchFn } = server({
    '/api/v3/klines': [
      [1_790_521_200_000, '84538.01', '84567.37', '84538.01', '84545.59', '10.11'],
      [1_790_524_800_000, '84545.59', '84600.00', '84500.00', '84590.00', '12.00']
    ]
  })
  const provider = new BinanceProvider({ fetchFn })
  const candles = await provider.candles(BTC, '1h', 10)
  assert.equal(candles.length, 2)
  assert.deepEqual(candles[0], {
    time: 1_790_521_200_000,
    open: 84538.01,
    high: 84567.37,
    low: 84538.01,
    close: 84545.59,
    volume: 10.11
  })
})

test('a candle missing a price is dropped, not filled in from its neighbour', async () => {
  // Filling it in would draw a bar that never happened, which is the one thing a chart must not do.
  const { fetchFn } = server({
    '/api/v3/klines': [
      [1, '1', '2', '0', '1', '5'],
      [2, '1', null, '0', '1', '5'],
      [3, '1', '2', '0', '1', '5']
    ]
  })
  const provider = new BinanceProvider({ fetchFn })
  const candles = await provider.candles(BTC, '1h', 10)
  assert.equal(candles.length, 2)
  assert.deepEqual(
    candles.map((c) => c.time),
    [1, 3]
  )
})

test('an interval Binance does not serve is refused rather than substituted', async () => {
  const { fetchFn } = server({ '/api/v3/klines': [] })
  const provider = new BinanceProvider({ fetchFn })
  // Every interval Orbis names is one Binance has, so this checks the guard rather than a real gap.
  await assert.rejects(
    () => provider.candles(BTC, 'nonsense' as never, 10),
    (err: unknown) => err instanceof ProviderError && err.code === 'unsupported'
  )
})

test('the limit asked for is the limit sent, within what the feed allows', async () => {
  const { fetchFn, asked } = server({ '/api/v3/klines': [] })
  const provider = new BinanceProvider({ fetchFn })
  await provider.candles(BTC, '1h', 5000)
  assert.match(asked[0], /limit=1000/, 'clamped to what Binance serves')
  await provider.candles(BTC, '1h', 0)
  assert.match(asked[1], /limit=1/, 'and never zero')
})

// ---------------------------------------------------------------- the order book

test('the order book is the feed’s levels, cut to the depth asked for', async () => {
  const { fetchFn, asked } = server({
    '/api/v3/depth': {
      lastUpdateId: 1,
      bids: [['84545.59', '0.38'], ['84545.58', '0.01'], ['84545.57', '0.02']],
      asks: [['84545.60', '3.30'], ['84545.61', '0.01'], ['84545.62', '0.02']]
    }
  })
  const provider = new BinanceProvider({ fetchFn, now: () => 5_000 })
  const book = await provider.orderBook(BTC, 2)
  assert.equal(book.bids.length, 2)
  assert.deepEqual(book.bids[0], { price: 84545.59, size: 0.38 })
  // Binance's depth reply carries no time, so when it arrived is the honest answer -- and is what is shown beside it.
  assert.equal(book.timestamp, 5_000)
  assert.match(asked[0], /limit=5/, 'the nearest depth the feed offers')
})

// ---------------------------------------------------------------- searching

test('searching finds the ticker, best match first', async () => {
  const { fetchFn } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn })
  const found = await provider.search('btc', 5)
  // The exact base asset before anything that merely contains the letters, and the pairs people price in first.
  assert.deepEqual(
    found.map((f) => f.symbol),
    ['BTCUSDT', 'BTCUSDC', 'WBTCETH']
  )
})

test('searching finds an asset by the name people use for it', async () => {
  // Binance's list has BTC and no names at all, so "bitcoin" found nothing until it was mapped.
  const { fetchFn } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn })
  assert.equal((await provider.search('bitcoin', 3))[0]?.symbol, 'BTCUSDT')
  assert.equal((await provider.search('Ethereum', 3))[0]?.symbol, 'ETHUSDT')
})

test('a pair that is not trading is not offered', async () => {
  const { fetchFn } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn })
  const found = await provider.search('old', 5)
  assert.deepEqual(found, [])
})

test('the instrument list is fetched once, not once per keystroke', async () => {
  const { fetchFn, asked } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn, now: () => 1_000 })
  await provider.search('b', 5)
  await provider.search('bt', 5)
  await provider.search('btc', 5)
  assert.equal(asked.length, 1)
})

test('an empty search asks nothing and finds nothing', async () => {
  const { fetchFn, asked } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn })
  assert.deepEqual(await provider.search('   ', 5), [])
  assert.equal(asked.length, 0)
})

test('an instrument resolves back to its details, and an unknown one to nothing', async () => {
  const { fetchFn } = server({ '/api/v3/exchangeInfo': EXCHANGE_INFO })
  const provider = new BinanceProvider({ fetchFn })
  const found = await provider.resolve(BTC)
  assert.equal(found?.symbol, 'BTCUSDT')
  assert.equal(found?.currency, 'USDT')
  assert.equal(await provider.resolve('binance:crypto:binance:nosuchpair'), null)
  assert.equal(await provider.resolve('somebodyelse:crypto:x:btc'), null)
})

// ---------------------------------------------------------------- streaming

/** A socket a test drives. */
const socket = (): SocketLike & { fire(type: string, event?: unknown): void; closed: number } => {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  return {
    closed: 0,
    addEventListener(type, listener) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    close() {
      this.closed++
    },
    fire(type, event) {
      for (const listener of listeners.get(type) ?? []) listener(event)
    }
  }
}

test('one socket carries everything being watched, not one per instrument', async () => {
  // Forty sockets for forty instruments is the difference between a working watchlist and a rate limit.
  const live = socket()
  const urls: string[] = []
  const provider = new BinanceProvider({
    socketFor: (url) => {
      urls.push(url)
      return live
    }
  })
  await provider.stream([BTC, ETH], { quote: () => undefined, status: () => undefined })
  assert.equal(urls.length, 1)
  assert.match(urls[0], /btcusdt@ticker/)
  assert.match(urls[0], /ethusdt@ticker/)
})

test('a streamed ticker becomes a quote with the feed’s own numbers', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const quotes: unknown[] = []
  await provider.stream([BTC], { quote: (q) => quotes.push(q), status: () => undefined })
  live.fire('message', {
    data: JSON.stringify({
      stream: 'btcusdt@ticker',
      data: { s: 'BTCUSDT', c: '84600.00', x: '84020.00', p: '580.00', P: '0.69', b: '84599', a: '84601', v: '100', h: '85000', l: '83000', E: 1_790_521_289_006 }
    })
  })
  assert.equal(quotes.length, 1)
  const quote = quotes[0] as { last: number; instrumentId: string; timestamp: number }
  assert.equal(quote.last, 84600)
  assert.equal(quote.instrumentId, BTC)
  assert.equal(quote.timestamp, 1_790_521_289_006)
})

test('rubbish on the socket is ignored rather than becoming a price', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const quotes: unknown[] = []
  await provider.stream([BTC], { quote: (q) => quotes.push(q), status: () => undefined })
  live.fire('message', { data: 'not json' })
  live.fire('message', { data: JSON.stringify({ stream: 'x', nothing: true }) })
  live.fire('message', { data: JSON.stringify({ data: { c: '1' } }) })
  live.fire('message', {})
  assert.deepEqual(quotes, [])
})

test('the connection says when it is up, and when it has gone', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const states: string[] = []
  await provider.stream([BTC], { quote: () => undefined, status: (s) => states.push(s) })
  live.fire('open')
  live.fire('close')
  assert.deepEqual(states, ['connected', 'disconnected'])
})

test('a socket error is a disconnection, not silence', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const states: string[] = []
  await provider.stream([BTC], { quote: () => undefined, status: (s) => states.push(s) })
  live.fire('error')
  assert.deepEqual(states, ['disconnected'])
})

test('stopping closes the socket and silences it', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const quotes: unknown[] = []
  const states: string[] = []
  const stop = await provider.stream([BTC], { quote: (q) => quotes.push(q), status: (s) => states.push(s) })
  stop()
  assert.equal(live.closed, 1)
  // Anything still in flight after the stop is not delivered: a screen that has gone must not be told about a price.
  live.fire('message', { data: JSON.stringify({ data: { s: 'BTCUSDT', c: '1', E: 1 } }) })
  live.fire('close')
  assert.deepEqual(quotes, [])
  assert.deepEqual(states, [])
})

test('nothing to stream opens no socket at all', async () => {
  let opened = 0
  const provider = new BinanceProvider({
    socketFor: () => {
      opened++
      return socket()
    }
  })
  const states: string[] = []
  await provider.stream([], { quote: () => undefined, status: (s) => states.push(s) })
  assert.equal(opened, 0)
  assert.deepEqual(states, ['disconnected'])
})

// ---------------------------------------------------------------- trades

test('recent trades come back oldest first, with the side the exchange reported', async () => {
  // `isBuyerMaker` is what makes the aggressor knowable: a resting buyer means a seller crossed the spread. Guessing the
  // side from whether the price rose would look identical and be wrong about half the time.
  const { fetchFn, asked } = server({
    '/api/v3/trades': [
      { price: '84600.00', qty: '0.5', time: 3000, isBuyerMaker: false },
      { price: '84599.00', qty: '1.25', time: 1000, isBuyerMaker: true }
    ]
  })
  const provider = new BinanceProvider({ fetchFn })
  const prints = await provider.trades(BTC, 50)
  assert.equal(prints.length, 2)
  assert.deepEqual(
    prints.map((p) => [p.timestamp, p.price, p.size, p.side]),
    [
      [1000, 84599, 1.25, 'sell'],
      [3000, 84600, 0.5, 'buy']
    ]
  )
  assert.match(asked[0], /symbol=BTCUSDT/)
  assert.ok(prints.every((p) => p.instrumentId === BTC))
})

test('a trade with no price or no size is dropped rather than shown as zero', async () => {
  const { fetchFn } = server({
    '/api/v3/trades': [
      { price: '', qty: '1', time: 1000, isBuyerMaker: false },
      { price: '84600', qty: '0', time: 2000, isBuyerMaker: false },
      { price: '84600', qty: '-1', time: 3000, isBuyerMaker: false },
      { price: 'abc', qty: '1', time: 4000, isBuyerMaker: false },
      { price: '84600', qty: '1', time: 5000, isBuyerMaker: false }
    ]
  })
  const provider = new BinanceProvider({ fetchFn })
  const prints = await provider.trades(BTC, 50)
  assert.equal(prints.length, 1)
  assert.equal(prints[0].timestamp, 5000)
})

test('trades are only asked for about a Binance instrument', async () => {
  const { fetchFn } = server({})
  const provider = new BinanceProvider({ fetchFn })
  await assert.rejects(() => provider.trades('alpaca:stock:nasdaq:aapl', 10), ProviderError)
})

test('only the instruments that asked for trades get a trade stream', async () => {
  // An aggTrade subscription on a busy pair delivers several messages a second whether or not a tape is open.
  const live = socket()
  const urls: string[] = []
  const provider = new BinanceProvider({
    socketFor: (url) => {
      urls.push(url)
      return live
    }
  })
  await provider.stream([BTC, ETH], { quote: () => undefined, status: () => undefined }, { trades: [BTC] })
  assert.match(urls[0], /btcusdt@ticker/)
  assert.match(urls[0], /ethusdt@ticker/)
  assert.match(urls[0], /btcusdt@aggTrade/)
  assert.ok(!urls[0].includes('ethusdt@aggTrade'))
})

test('no trade stream is opened when nothing asked for one', async () => {
  const live = socket()
  const urls: string[] = []
  const provider = new BinanceProvider({ socketFor: (url) => (urls.push(url), live) })
  await provider.stream([BTC], { quote: () => undefined, status: () => undefined })
  assert.ok(!urls[0].includes('aggTrade'))
})

test('an aggTrade message becomes a trade, not a quote', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const quotes: unknown[] = []
  const trades: { price: number; size: number; side: string; instrumentId: string; timestamp: number }[] = []
  await provider.stream(
    [BTC],
    { quote: (q) => quotes.push(q), trade: (t) => trades.push(t), status: () => undefined },
    { trades: [BTC] }
  )
  live.fire('message', {
    data: JSON.stringify({
      stream: 'btcusdt@aggTrade',
      data: { e: 'aggTrade', s: 'BTCUSDT', p: '84601.50', q: '0.125', T: 1_790_521_289_100, m: true }
    })
  })
  assert.deepEqual(quotes, [])
  assert.equal(trades.length, 1)
  assert.equal(trades[0].price, 84601.5)
  assert.equal(trades[0].size, 0.125)
  // `m: true` is a resting buyer, so a seller crossed.
  assert.equal(trades[0].side, 'sell')
  assert.equal(trades[0].instrumentId, BTC)
  assert.equal(trades[0].timestamp, 1_790_521_289_100)
})

test('a malformed aggTrade is ignored rather than becoming a print', async () => {
  const live = socket()
  const provider = new BinanceProvider({ socketFor: () => live })
  const trades: unknown[] = []
  await provider.stream([BTC], { quote: () => undefined, trade: (t) => trades.push(t), status: () => undefined }, { trades: [BTC] })
  for (const data of [
    { e: 'aggTrade', s: 'BTCUSDT', p: '', q: '1', T: 1, m: false },
    { e: 'aggTrade', s: 'BTCUSDT', p: '1', q: '0', T: 1, m: false },
    { e: 'aggTrade', s: '', p: '1', q: '1', T: 1, m: false },
    { e: 'aggTrade', s: 'BTCUSDT', p: '1', q: '1', T: 'soon', m: false }
  ]) {
    live.fire('message', { data: JSON.stringify({ stream: 'btcusdt@aggTrade', data }) })
  }
  assert.deepEqual(trades, [])
})

test('the capability is only claimed because the method is there', () => {
  // A flag saying `trades: true` with nothing behind it is how a panel comes to offer a tape that can never fill.
  const provider = new BinanceProvider()
  assert.equal(provider.capabilities.trades, true)
  assert.equal(typeof provider.trades, 'function')
})
