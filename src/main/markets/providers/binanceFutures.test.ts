import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BinanceFuturesProvider } from './binanceFutures.ts'
import type { SocketLike } from './binance.ts'
import { availableFrom, type ProviderEvents } from '../../../shared/markets/provider.ts'
import type { Funding, Liquidation, MarkIndex } from '../../../shared/markets/derivatives.ts'
import type { Quote, Instrument } from '../../../shared/markets/instrument.ts'
import type { TradePrint } from '../../../shared/markets/provider.ts'

/**
 * The Binance Futures adapter.
 *
 * Against a scripted server, so the answers that matter can be made to happen: a perpetual with no funding schedule, a
 * settled contract still in the ticker list, a liquidation for a contract nobody is watching, a mark price with no index.
 * Every test here is about producing no number rather than a wrong one — and about the distinction this provider exists
 * to keep, which is that a perpetual is not the spot market.
 */

const BTC = 'binance-futures:future:binance-futures:btcusdt'
const ETH = 'binance-futures:future:binance-futures:ethusdt'

const server = (
  routes: Record<string, unknown>,
  options: { status?: number; throws?: boolean } = {}
): { fetchFn: typeof fetch; asked: string[] } => {
  const asked: string[] = []
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    if (options.throws) throw new Error('no route to host')
    const path = url.replace('https://fapi.binance.com', '')
    // Longest match, so `/fapi/v1/ticker/24hr?symbol=` beats `/fapi/v1/ticker/24hr`.
    const key = Object.keys(routes)
      .filter((r) => path.startsWith(r))
      .sort((a, b) => b.length - a.length)[0]
    const status = options.status ?? (key ? 200 : 404)
    if (status !== 200) return new Response('', { status })
    // A route may be a function of the path, because the real endpoints answer differently for one symbol and for all of
    // them -- an object against `?symbol=`, an array without. A harness that ignored that would test a shape Binance
    // never sends.
    const held = key ? routes[key] : {}
    const body = typeof held === 'function' ? (held as (path: string) => unknown)(path) : held
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }) as unknown as typeof fetch
  return { fetchFn, asked }
}

const EXCHANGE_INFO = {
  symbols: [
    {
      symbol: 'BTCUSDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marginAsset: 'USDT',
      deliveryDate: 4_133_404_800_000,
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.10' },
        { filterType: 'LOT_SIZE', stepSize: '0.001' },
        { filterType: 'MIN_NOTIONAL', notional: '5' }
      ]
    },
    {
      symbol: 'ETHUSDT',
      contractType: 'PERPETUAL',
      status: 'TRADING',
      baseAsset: 'ETH',
      quoteAsset: 'USDT',
      marginAsset: 'USDT'
    },
    {
      symbol: 'BTCUSDT_250926',
      contractType: 'CURRENT_QUARTER',
      status: 'TRADING',
      baseAsset: 'BTC',
      quoteAsset: 'USDT',
      marginAsset: 'USDT',
      deliveryDate: 1_758_873_600_000
    },
    {
      symbol: 'OLDUSDT',
      contractType: 'PERPETUAL',
      status: 'SETTLED',
      baseAsset: 'OLD',
      quoteAsset: 'USDT',
      marginAsset: 'USDT'
    },
    // A shape Orbis does not recognise. Left out rather than guessed into perpetual or dated.
    { symbol: 'WEIRDUSDT', contractType: 'SOMETHING_NEW', status: 'TRADING', baseAsset: 'W', quoteAsset: 'USDT' }
  ]
}

const TICKER = [
  {
    symbol: 'BTCUSDT',
    lastPrice: '84545.59',
    openPrice: '84020.00',
    priceChange: '525.59',
    priceChangePercent: '0.625',
    volume: '10384.91',
    quoteVolume: '878000000',
    highPrice: '85000.00',
    lowPrice: '83000.00',
    closeTime: 1_790_521_289_006
  },
  { symbol: 'OLDUSDT', lastPrice: '1.00', openPrice: '1.00', volume: '0', closeTime: 1_790_521_289_006 }
]

const PREMIUM = [
  {
    symbol: 'BTCUSDT',
    markPrice: '84550.00',
    indexPrice: '84500.00',
    estimatedSettlePrice: '84510.00',
    lastFundingRate: '0.00012',
    nextFundingTime: 1_790_530_000_000,
    time: 1_790_521_289_006
  },
  {
    // No funding schedule: Binance sends 0, which is not a time.
    symbol: 'ETHUSDT',
    markPrice: '3200.00',
    indexPrice: '3199.00',
    lastFundingRate: '-0.00005',
    nextFundingTime: 0,
    time: 1_790_521_289_006
  }
]

const FUNDING_HISTORY = [
  { symbol: 'BTCUSDT', fundingTime: 1_790_492_000_000, fundingRate: '0.00010' },
  { symbol: 'BTCUSDT', fundingTime: 1_790_520_800_000, fundingRate: '0.00012' }
]

/** Binance answers a single symbol with an object and every symbol with an array. Both, as the venue does. */
const oneOrAll = (rows: Record<string, unknown>[]) => (path: string) => {
  const match = /symbol=([A-Z0-9_]+)/.exec(path)
  if (!match) return rows
  return rows.find((one) => one.symbol === match[1]) ?? {}
}

const routes: Record<string, unknown> = {
  '/fapi/v1/exchangeInfo': EXCHANGE_INFO,
  '/fapi/v1/ticker/24hr': oneOrAll(TICKER),
  '/fapi/v1/premiumIndex': oneOrAll(PREMIUM),
  '/fapi/v1/fundingRate': FUNDING_HISTORY,
  '/fapi/v1/openInterest': { symbol: 'BTCUSDT', openInterest: '82000.5', time: 1_790_521_289_006 },
  '/futures/data/openInterestHist': [
    { sumOpenInterest: '80000', sumOpenInterestValue: '6700000000', timestamp: 1_790_400_000_000 },
    { sumOpenInterest: '82000', sumOpenInterestValue: '6900000000', timestamp: 1_790_500_000_000 }
  ],
  '/futures/data/globalLongShortAccountRatio': [
    { longShortRatio: '1.85', longAccount: '0.6491', shortAccount: '0.3509', timestamp: 1_790_500_000_000 }
  ],
  '/fapi/v1/trades': [
    { price: '84545.59', qty: '0.01', time: 1_790_521_289_000, isBuyerMaker: false },
    { price: '84544.00', qty: '0.50', time: 1_790_521_288_000, isBuyerMaker: true }
  ],
  '/fapi/v1/depth': { bids: [['84545.58', '1.2']], asks: [['84545.60', '0.8']], E: 1_790_521_289_006 },
  '/fapi/v1/klines': [[1_790_500_000_000, '84000', '84600', '83900', '84500', '120.5']]
}

const make = (extra: Record<string, unknown> = {}): BinanceFuturesProvider =>
  new BinanceFuturesProvider({
    fetchFn: server({ ...routes, ...extra }).fetchFn,
    now: () => 1_790_521_290_000
  })

// ---------------------------------------------------------------- it is a different market

test('it needs no key, so it is always configured', () => {
  assert.deepEqual(new BinanceFuturesProvider().ready(), { ok: true })
})

test('every instrument it produces says it is futures, so it can never be confused with spot', async () => {
  const found = await make().search('BTC', 5)
  assert.ok(found.length > 0)
  for (const one of found) {
    assert.equal(one.provider, 'binance-futures')
    assert.equal(one.assetType, 'future')
    assert.ok(one.instrumentId.startsWith('binance-futures:'))
    // And the name says it in words, because that is the field a person reads.
    assert.ok(/perpetual|futures/.test(one.name), one.name)
  }
})

test('it declares only the derivatives capabilities it actually implements', () => {
  const available = availableFrom(new BinanceFuturesProvider())
  assert.equal(available.funding, true)
  assert.equal(available.openInterest, true)
  assert.equal(available.markPrice, true)
  assert.equal(available.longShort, true)
  assert.equal(available.datedFutures, true)
  assert.equal(available.liquidations, true)
})

// ---------------------------------------------------------------- contracts

test('contracts carry the venue’s own metadata, and nothing it did not supply', async () => {
  const contracts = await make().contracts()
  const btc = contracts.find((one) => one.symbol === 'BTCUSDT')
  assert.ok(btc)
  assert.equal(btc.contractType, 'perpetual')
  assert.equal(btc.status, 'trading')
  assert.equal(btc.settlement, 'USDT')
  assert.equal(btc.tickSize, 0.1)
  assert.equal(btc.stepSize, 0.001)
  assert.equal(btc.minNotional, 5)

  // A perpetual has no expiry, whatever far-future date Binance stamps on it.
  assert.equal(btc.expiresAt, null)

  const eth = contracts.find((one) => one.symbol === 'ETHUSDT')
  // No filters published: null rather than a precision Orbis invented, which would validate an order the venue refuses.
  assert.equal(eth?.tickSize, null)
  assert.equal(eth?.stepSize, null)
})

test('a dated contract keeps its expiry', async () => {
  const contracts = await make().contracts()
  const dated = contracts.find((one) => one.symbol === 'BTCUSDT_250926')
  assert.equal(dated?.contractType, 'dated')
  assert.equal(dated?.expiresAt, 1_758_873_600_000)
})

test('a contract shape Orbis does not recognise is left out rather than guessed at', async () => {
  const contracts = await make().contracts()
  assert.equal(contracts.some((one) => one.symbol === 'WEIRDUSDT'), false)
})

test('a settled contract is kept with its real status rather than presented as tradable', async () => {
  const contracts = await make().contracts()
  const old = contracts.find((one) => one.symbol === 'OLDUSDT')
  assert.equal(old?.status, 'expired')
  // And it is not offered in search.
  assert.equal((await make().search('OLD', 5)).length, 0)
})

test('the contract list is fetched once and then reused', async () => {
  const { fetchFn, asked } = server(routes)
  const provider = new BinanceFuturesProvider({ fetchFn, now: () => 1_000 })
  await provider.contracts()
  await provider.contracts()
  assert.equal(asked.filter((one) => one.includes('exchangeInfo')).length, 1)
})

test('search puts the perpetual before the dated contract', async () => {
  const found = await make().search('BTCUSDT', 5)
  assert.equal(found[0].symbol, 'BTCUSDT')
})

// ---------------------------------------------------------------- quotes

test('a quote is the contract’s own price, with the venue’s own change figure', async () => {
  const quotes = await make().quotes([BTC])
  assert.equal(quotes.length, 1)
  assert.equal(quotes[0].last, 84_545.59)
  assert.equal(quotes[0].changePercent, 0.625)
  assert.equal(quotes[0].quoteVolume, 878_000_000)
  assert.equal(quotes[0].source, 'binance-futures')
  assert.equal(quotes[0].instrumentId, BTC)
})

test('the universe is only the contracts the venue still describes as tradable', async () => {
  const universe = await make().universe()
  const symbols = universe.map((one) => one.instrument.symbol)
  assert.ok(symbols.includes('BTCUSDT'))
  // OLDUSDT has a ticker row and a settled status. Its row is history, not a market.
  assert.equal(symbols.includes('OLDUSDT'), false)
})

test('a candle missing any of its four prices is dropped rather than drawn with a hole in it', async () => {
  const provider = make({ '/fapi/v1/klines': [[1_790_500_000_000, '84000', '', '83900', '84500', '1']] })
  assert.deepEqual(await provider.candles(BTC, '1h', 10), [])
})

// ---------------------------------------------------------------- funding

test('funding is the venue’s rate, with the interval read off its own history', async () => {
  const funding = await make().funding([BTC])
  assert.equal(funding.length, 1)
  assert.equal(funding[0].rate, 0.00012)
  assert.equal(funding[0].nextAt, 1_790_530_000_000)
  // 1_790_520_800_000 − 1_790_492_000_000 is eight hours. Read from this contract, not assumed for all of them.
  assert.equal(funding[0].intervalMs, 28_800_000)
})

test('a contract with no funding schedule has no next time, rather than a guessed one', async () => {
  const funding = await make().funding([ETH])
  assert.equal(funding.length, 1)
  assert.equal(funding[0].rate, -0.00005)
  // Binance sends 0. Zero is not a time.
  assert.equal(funding[0].nextAt, null)
})

test('an interval that cannot be read is null, so nothing downstream annualises from a guess', async () => {
  const provider = make({ '/fapi/v1/fundingRate': [] })
  const funding = await provider.funding([BTC])
  assert.equal(funding[0].intervalMs, null)
})

test('a funding history gap is not mistaken for a funding period', async () => {
  // Two payments a fortnight apart is a hole in the history, not a two-week funding cycle.
  const provider = make({
    '/fapi/v1/fundingRate': [
      { fundingTime: 1_789_000_000_000, fundingRate: '0.0001' },
      { fundingTime: 1_790_520_800_000, fundingRate: '0.0001' }
    ]
  })
  assert.equal((await provider.funding([BTC]))[0].intervalMs, null)
})

test('funding history comes back oldest first', async () => {
  const history = await make().fundingHistory(BTC, 10)
  assert.equal(history.length, 2)
  assert.ok(history[0].at < history[1].at)
  assert.equal(history[1].rate, 0.00012)
})

// ---------------------------------------------------------------- open interest

test('open interest is contracts, and its value is null unless the venue gave one', async () => {
  const oi = await make().openInterest([BTC])
  assert.equal(oi.length, 1)
  assert.equal(oi[0].amount, 82_000.5)
  // Binance's current-OI endpoint gives contracts only. Not multiplied by a price fetched on the side.
  assert.equal(oi[0].notional, null)
})

test('one contract failing does not take the others with it', async () => {
  let calls = 0
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/fapi/v1/openInterest')) {
      calls += 1
      if (url.includes('ETHUSDT')) throw new Error('down')
      return new Response(JSON.stringify({ symbol: 'BTCUSDT', openInterest: '82000.5', time: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as unknown as typeof fetch
  const provider = new BinanceFuturesProvider({ fetchFn, now: () => 1000 })
  const oi = await provider.openInterest([BTC, ETH])
  assert.equal(calls, 2)
  assert.equal(oi.length, 1)
  assert.equal(oi[0].instrumentId, BTC)
})

test('open-interest history carries the venue’s own value and comes back in order', async () => {
  const history = await make().openInterestHistory(BTC, 24 * 3_600_000, 100)
  assert.equal(history.length, 2)
  assert.ok(history[0].at < history[1].at)
  assert.equal(history[1].amount, 82_000)
  assert.equal(history[1].notional, 6_900_000_000)
})

// ---------------------------------------------------------------- mark and index

test('mark and index are the venue’s own prices', async () => {
  const marks = await make().markIndex([BTC])
  assert.equal(marks[0].markPrice, 84_550)
  assert.equal(marks[0].indexPrice, 84_500)
  assert.equal(marks[0].settlementPrice, 84_510)
})

test('a missing index price is missing, not replaced by the last trade', async () => {
  const provider = make({
    '/fapi/v1/premiumIndex': oneOrAll([{ symbol: 'BTCUSDT', markPrice: '84550.00', lastFundingRate: '0', time: 1 }])
  })
  const marks = await provider.markIndex([BTC])
  assert.equal(marks[0].markPrice, 84_550)
  assert.equal(marks[0].indexPrice, null)
})

// ---------------------------------------------------------------- positioning

test('positioning says whose it is, because accounts and positions are different counts', async () => {
  const ratios = await make().longShort(BTC, 24 * 3_600_000, 100)
  assert.equal(ratios.length, 1)
  assert.equal(ratios[0].ratio, 1.85)
  assert.equal(ratios[0].longShare, 0.6491)
  assert.equal(ratios[0].basis, 'accounts')
})

// ---------------------------------------------------------------- liquidations

test('there is no liquidation history to fetch, and that is answered as empty rather than invented', async () => {
  assert.deepEqual(await make().liquidations(), [])
})

// ---------------------------------------------------------------- streaming

/** A socket a test can drive. */
const fakeSocket = (): { socket: SocketLike; open(): void; send(payload: unknown): void; closed(): boolean; url: string[] } => {
  const listeners = new Map<string, ((event: unknown) => void)[]>()
  let shut = false
  const url: string[] = []
  const socket: SocketLike = {
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    close() {
      shut = true
    }
  }
  return {
    socket,
    url,
    open: () => (listeners.get('open') ?? []).forEach((one) => one({})),
    send: (payload) =>
      (listeners.get('message') ?? []).forEach((one) => one({ data: JSON.stringify(payload) })),
    closed: () => shut
  }
}

const streamBench = async (
  instruments: string[],
  options: { trades?: string[] } = {}
): Promise<{
  fake: ReturnType<typeof fakeSocket>
  stop: () => void
  quotes: Quote[]
  trades: TradePrint[]
  marks: MarkIndex[]
  fundings: Funding[]
  liquidations: Liquidation[]
  statuses: string[]
  url: string
}> => {
  const fake = fakeSocket()
  let url = ''
  const provider = new BinanceFuturesProvider({
    fetchFn: server(routes).fetchFn,
    socketFor: (asked) => {
      url = asked
      return fake.socket
    },
    now: () => 1_790_521_290_000
  })
  const quotes: Quote[] = []
  const trades: TradePrint[] = []
  const marks: MarkIndex[] = []
  const fundings: Funding[] = []
  const liquidations: Liquidation[] = []
  const statuses: string[] = []
  const events: ProviderEvents = {
    quote: (one) => quotes.push(one),
    trade: (one) => trades.push(one),
    markIndex: (one) => marks.push(one),
    funding: (one) => fundings.push(one),
    liquidation: (one) => liquidations.push(one),
    status: (state) => statuses.push(state)
  }
  const stop = await provider.stream(instruments, events, options)
  return { fake, stop, quotes, trades, marks, fundings, liquidations, statuses, url }
}

test('one socket carries the quote, the mark price and the liquidation feed', async () => {
  const bench = await streamBench([BTC, ETH], { trades: [BTC] })
  assert.ok(bench.url.includes('btcusdt@ticker'))
  assert.ok(bench.url.includes('ethusdt@ticker'))
  assert.ok(bench.url.includes('btcusdt@markPrice@1s'))
  assert.ok(bench.url.includes('!forceOrder@arr'))
  // Trades only for what asked: a tape nobody opened must not multiply the traffic.
  assert.ok(bench.url.includes('btcusdt@aggTrade'))
  assert.equal(bench.url.includes('ethusdt@aggTrade'), false)
  bench.stop()
})

test('the stream reports connected only when the socket actually opens', async () => {
  const bench = await streamBench([BTC])
  assert.deepEqual(bench.statuses, [])
  bench.fake.open()
  assert.deepEqual(bench.statuses, ['connected'])
  bench.stop()
})

test('a streamed quote is the contract’s price', async () => {
  const bench = await streamBench([BTC])
  bench.fake.send({
    stream: 'btcusdt@ticker',
    data: { e: '24hrTicker', s: 'BTCUSDT', c: '84600.00', o: '84000.00', P: '0.714', v: '10', q: '840000', E: 1 }
  })
  assert.equal(bench.quotes.length, 1)
  assert.equal(bench.quotes[0].last, 84_600)
  assert.equal(bench.quotes[0].instrumentId, BTC)
  bench.stop()
})

test('a streamed mark price arrives with the index, and funding with it', async () => {
  const bench = await streamBench([BTC])
  bench.fake.send({
    stream: 'btcusdt@markPrice@1s',
    data: { e: 'markPriceUpdate', s: 'BTCUSDT', p: '84550.00', i: '84500.00', r: '0.00012', T: 1_790_530_000_000, E: 1 }
  })
  assert.equal(bench.marks.length, 1)
  assert.equal(bench.marks[0].markPrice, 84_550)
  assert.equal(bench.marks[0].indexPrice, 84_500)
  // Funding is delivered from the same frame, after the interval has been looked up.
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(bench.fundings.length, 1)
  assert.equal(bench.fundings[0].rate, 0.00012)
  assert.equal(bench.fundings[0].nextAt, 1_790_530_000_000)
  bench.stop()
})

test('a liquidation for a contract on screen is delivered, and the side is the closing order’s', async () => {
  const bench = await streamBench([BTC])
  bench.fake.send({
    stream: '!forceOrder@arr',
    data: { e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'SELL', ap: '84000.00', q: '2', T: 1_790_521_280_000 } }
  })
  assert.equal(bench.liquidations.length, 1)
  assert.equal(bench.liquidations[0].side, 'sell')
  assert.equal(bench.liquidations[0].notional, 168_000)
  bench.stop()
})

test('a liquidation for a contract nobody is watching is not delivered', async () => {
  const bench = await streamBench([BTC])
  bench.fake.send({
    stream: '!forceOrder@arr',
    data: { e: 'forceOrder', E: 1, o: { s: 'DOGEUSDT', S: 'BUY', ap: '0.4', q: '10000', T: 1 } }
  })
  assert.equal(bench.liquidations.length, 0)
  bench.stop()
})

test('a liquidation missing a price or a size is not delivered as a zero', async () => {
  const bench = await streamBench([BTC])
  bench.fake.send({
    stream: '!forceOrder@arr',
    data: { e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'SELL', q: '2', T: 1 } }
  })
  bench.fake.send({
    stream: '!forceOrder@arr',
    data: { e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'SELL', ap: '84000', T: 1 } }
  })
  assert.equal(bench.liquidations.length, 0)
  bench.stop()
})

test('a malformed frame does not take the stream down', async () => {
  const bench = await streamBench([BTC])
  const listeners = bench.fake
  // Not JSON at all.
  assert.doesNotThrow(() => listeners.send.call(null, undefined))
  bench.fake.send({ stream: 'btcusdt@ticker', data: { e: '24hrTicker', s: 'BTCUSDT', c: '1' } })
  assert.equal(bench.quotes.length, 1)
  bench.stop()
})

test('stopping closes the socket and reports nothing afterwards', async () => {
  const bench = await streamBench([BTC])
  bench.fake.open()
  bench.stop()
  assert.equal(bench.fake.closed(), true)
  const before = bench.statuses.length
  // A close that arrives after stopping is expected, not an outage.
  assert.equal(bench.statuses.length, before)
})

test('streaming nothing opens no socket', async () => {
  let opened = 0
  const provider = new BinanceFuturesProvider({
    fetchFn: server(routes).fetchFn,
    socketFor: () => {
      opened += 1
      return fakeSocket().socket
    }
  })
  const statuses: string[] = []
  await provider.stream(['not-ours:1:2:3'], {
    quote: () => {},
    status: (state) => statuses.push(state)
  })
  assert.equal(opened, 0)
  assert.deepEqual(statuses, ['disconnected'])
})

// ---------------------------------------------------------------- failures

test('an unreachable venue is a network failure, not an empty market', async () => {
  const provider = new BinanceFuturesProvider({ fetchFn: server(routes, { throws: true }).fetchFn })
  await assert.rejects(() => provider.contracts(), /could not be reached/)
})

test('a region block is reported as one', async () => {
  const provider = new BinanceFuturesProvider({ fetchFn: server(routes, { status: 451 }).fetchFn })
  await assert.rejects(() => provider.contracts(), /does not serve futures data/)
})

test('a rate limit carries how long to wait', async () => {
  const provider = new BinanceFuturesProvider({ fetchFn: server(routes, { status: 429 }).fetchFn })
  await assert.rejects(
    () => provider.contracts(),
    (error: unknown) => (error as { retryAfterMs: number }).retryAfterMs > 0
  )
})

test('an id from another provider is not answered', async () => {
  const provider = make()
  assert.equal(await provider.resolve('binance:crypto:binance:btcusdt'), null)
  assert.deepEqual(await provider.quotes(['binance:crypto:binance:btcusdt']), [])
  assert.deepEqual(await provider.funding(['binance:crypto:binance:btcusdt']), [])
})

test('an instrument it does produce resolves back to itself', async () => {
  const resolved = (await make().resolve(BTC)) as Instrument
  assert.equal(resolved.instrumentId, BTC)
  assert.equal(resolved.assetType, 'future')
})
