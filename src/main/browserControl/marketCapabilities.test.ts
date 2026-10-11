import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserControl } from './registry.ts'
import { registerMarketCapabilities } from './marketCapabilities.ts'
import { MarketEngine } from '../markets/engine.ts'
import { MarketsStore } from '../markets/store.ts'
import { MarketsRuntime } from '../markets/runtime.ts'
import type { Instrument, Quote } from '../../shared/markets/instrument.ts'
import type { Candle, MarketProvider, ProviderCapabilities } from '../../shared/markets/provider.ts'

/**
 * What Orion, the Orb, a workflow and a spoken command may do about markets.
 *
 * The decisive tests here are the ones about what is *not* offered: nothing that reaches an exchange, nothing that takes
 * a credential, and nothing that can place an order without confirming it first. After that, the tests are about honesty
 * — every answer carries its freshness, and a market nobody can price produces a null rather than a number.
 */

const CAPS: ProviderCapabilities = {
  assetTypes: ['crypto'],
  streaming: true,
  intervals: ['1h', '1d'],
  search: true,
  quotes: true,
  orderBook: true,
  trades: false,
  news: false,
  fundamentals: false,
  options: false,
  funding: false,
  openInterest: false,
    liquidations: false,
    markPrice: false,
    longShort: false,
    datedFutures: false,
  delayedByMs: 0,
  universe: true
}

const BTC = 'fake:crypto:fake:btcusd'
const ETH = 'fake:crypto:fake:ethusd'

const instrument = (id: string, symbol: string): Instrument => ({
  instrumentId: id,
  symbol,
  name: `${symbol} / USD`,
  assetType: 'crypto',
  exchange: 'fake',
  currency: 'USD',
  provider: 'fake'
})

const quote = (id: string, over: Partial<Quote> = {}): Quote => ({
  instrumentId: id,
  last: 100,
  previousClose: 90,
  change: 10,
  changePercent: 11.1,
  bid: 99.5,
  ask: 100.5,
  volume: 50,
  quoteVolume: 5_000,
  dayHigh: 105,
  dayLow: 95,
  timestamp: 1_700_000_000_000,
  delayedByMs: 0,
  marketStatus: 'always-open',
  source: 'Fake',
  ...over
})

const candles = (n = 120): Candle[] =>
  Array.from({ length: n }, (_v, i) => ({
    time: 1_700_000_000_000 + i * 3_600_000,
    open: 100 + i,
    high: 102 + i,
    low: 98 + i,
    close: 101 + i,
    volume: 10
  }))

const provider = (over: Partial<MarketProvider> = {}): MarketProvider =>
  ({
    id: 'fake',
    name: 'Fake',
    capabilities: CAPS,
    ready: () => ({ ok: true }),
    search: async (query: string) =>
      query.toLowerCase().includes('eth') ? [instrument(ETH, 'ETHUSD')] : [instrument(BTC, 'BTCUSD')],
    resolve: async (id: string) => (id === ETH ? instrument(ETH, 'ETHUSD') : id === BTC ? instrument(BTC, 'BTCUSD') : null),
    quotes: async (ids: string[]) => ids.map((id) => quote(id)),
    candles: async () => candles(),
    orderBook: async (id: string) => ({
      instrumentId: id,
      bids: [
        { price: 99.5, size: 2 },
        { price: 99.4, size: 3 }
      ],
      asks: [
        { price: 100.5, size: 1 },
        { price: 100.6, size: 4 }
      ],
      timestamp: 1_700_000_000_000,
      source: 'Fake'
    }),
    universe: async () => [
      { instrument: instrument(BTC, 'BTCUSD'), quote: quote(BTC, { changePercent: 9, quoteVolume: 90_000 }) },
      { instrument: instrument(ETH, 'ETHUSD'), quote: quote(ETH, { changePercent: -4, quoteVolume: 30_000 }) }
    ],
    ...over
  }) as unknown as MarketProvider

const bench = async (
  options: { enabled?: boolean; feed?: MarketProvider } = {}
): Promise<{ layer: BrowserControl; store: MarketsStore; engine: MarketEngine; shown: string[]; done(): Promise<void> }> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-market-caps-'))
  const engine = new MarketEngine()
  engine.add(options.feed ?? provider())
  engine.remember(instrument(BTC, 'BTCUSD'))
  engine.remember(instrument(ETH, 'ETHUSD'))
  const store = new MarketsStore(dir)
  if (options.enabled === false) await store.setEnabled('one', false)
  const runtime = new MarketsRuntime({ engine, store, profileId: async () => 'one' })
  const layer = new BrowserControl()
  const shown: string[] = []

  registerMarketCapabilities({
    control: layer,
    engine,
    store,
    runtime,
    profileId: async () => 'one',
    show: async (instrumentId) => {
      shown.push(instrumentId)
      return true
    }
  })

  return {
    layer,
    store,
    engine,
    shown,
    done: async () => {
      runtime.stop()
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  }
}

const run = (layer: BrowserControl, capability: string, params: Record<string, unknown> = {}): Promise<unknown> =>
  layer.execute({ capability, params, target: {} }, { source: 'orion', confirm: async () => true })

const data = (result: unknown): Record<string, unknown> =>
  ((result as { data?: unknown }).data ?? {}) as Record<string, unknown>

const failed = (result: unknown): boolean => (result as { ok?: boolean }).ok === false

// ---------------------------------------------------------------- what is not offered

test('nothing here can reach an exchange', async () => {
  // The whole design in one assertion. There is no credential in Orbis that could place a real order, and there must be
  // no capability that suggests otherwise.
  const b = await bench()
  try {
    const ids = b.layer.list({}).map((c) => c.id)
    for (const id of ids) {
      assert.ok(!/withdraw|deposit|transfer|apiKey|exchange\.|broker/i.test(id), `${id} sounds like it reaches an exchange`)
    }
    // The only capability that moves anything moves the paper account, and it says so in its name.
    const moving = b.layer.list({}).filter((c) => c.domain === 'markets' && c.mutates)
    for (const capability of moving) {
      assert.ok(
        !/order/i.test(capability.id) || capability.id === 'market.paperOrder',
        `${capability.id} places an order without saying it is paper`
      )
    }
  } finally {
    await b.done()
  }
})

test('no market capability takes a credential', async () => {
  const b = await bench()
  try {
    for (const capability of b.layer.list({}).filter((c) => c.domain === 'markets')) {
      for (const name of Object.keys(capability.params ?? {})) {
        assert.ok(
          !/password|secret|credential|token|apikey|key$/i.test(name),
          `${capability.id} takes "${name}"`
        )
      }
    }
  } finally {
    await b.done()
  }
})

test('placing a simulated order always asks first', async () => {
  const b = await bench()
  try {
    const order = b.layer.list({}).find((c) => c.id === 'market.paperOrder')
    assert.ok(order)
    // A misheard "buy bitcoin" must not become an order nobody meant, even a simulated one.
    assert.equal(order?.confirmation, 'always')
    assert.equal(order?.mutates, true)
    const alert = b.layer.list({}).find((c) => c.id === 'market.alertCreate')
    // An alert is a standing instruction that interrupts somebody later, so it is confirmed too.
    assert.equal(alert?.confirmation, 'always')
  } finally {
    await b.done()
  }
})

test('reading a market changes nothing', async () => {
  const b = await bench()
  try {
    const reads = ['market.quote', 'market.history', 'market.orderBook', 'market.movers', 'market.watchlists', 'market.portfolio']
    for (const id of reads) {
      const capability = b.layer.list({}).find((c) => c.id === id)
      assert.ok(capability, `${id} is missing`)
      assert.equal(capability?.mutates, false, `${id} claims to change something`)
    }
  } finally {
    await b.done()
  }
})

// ---------------------------------------------------------------- honesty about the numbers

test('a quote carries how much to believe it', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.quote', { market: 'bitcoin' }))
    assert.equal(answer.symbol, 'BTCUSD')
    assert.equal(answer.price, 100)
    // Without these an hours-old figure reads exactly like a current one.
    assert.ok(typeof answer.freshness === 'string')
    assert.ok(typeof answer.asOf === 'string')
    assert.ok(typeof answer.ageSeconds === 'number')
    assert.equal(answer.source, 'Fake')
  } finally {
    await b.done()
  }
})

test('a market nobody can price answers with nulls rather than numbers', async () => {
  const b = await bench({
    feed: provider({ quotes: async () => [] })
  })
  try {
    const answer = data(await run(b.layer, 'market.quote', { market: 'bitcoin' }))
    assert.equal(answer.price, null)
    assert.equal(answer.changePercent, null)
    assert.equal(answer.freshness, 'unavailable')
  } finally {
    await b.done()
  }
})

test('a market nobody has heard of is refused, not invented', async () => {
  const b = await bench({ feed: provider({ search: async () => [], resolve: async () => null }) })
  try {
    assert.ok(failed(await run(b.layer, 'market.quote', { market: 'notacoin' })))
  } finally {
    await b.done()
  }
})

test('history is summarised rather than handed over bar by bar', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.history', { market: 'bitcoin', interval: '1h' }))
    assert.equal(answer.bars, 120)
    assert.ok(typeof answer.rsi14 === 'number')
    assert.ok(typeof answer.changePercent === 'number')
    // A handful of recent bars, not the hundred and twenty: Orion reads text.
    assert.ok(Array.isArray(answer.recent) && (answer.recent as unknown[]).length <= 8)
    assert.ok(String(answer.source).includes('not a forecast'))
  } finally {
    await b.done()
  }
})

test('an interval Orbis does not have is refused rather than swapped', async () => {
  const b = await bench()
  try {
    assert.ok(failed(await run(b.layer, 'market.history', { market: 'bitcoin', interval: '3m' })))
  } finally {
    await b.done()
  }
})

test('the order book reports the spread and says when there is none to report', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.orderBook', { market: 'bitcoin' }))
    assert.equal(answer.bestBid, 99.5)
    assert.equal(answer.bestAsk, 100.5)
    assert.ok(Math.abs((answer.spread as number) - 1) < 1e-9)
    assert.ok(typeof answer.spreadPercent === 'number')
  } finally {
    await b.done()
  }
})

test('a provider with no order book says so instead of answering with an empty one', async () => {
  const b = await bench({ feed: provider({ capabilities: { ...CAPS, orderBook: false }, orderBook: undefined }) })
  try {
    assert.ok(failed(await run(b.layer, 'market.orderBook', { market: 'bitcoin' })))
  } finally {
    await b.done()
  }
})

test('movers say how many markets were considered', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.movers', { kind: 'gainers' }))
    assert.equal(answer.universeSize, 2)
    const results = answer.results as { symbol: string; changePercent: number }[]
    assert.deepEqual(results.map((r) => r.symbol), ['BTCUSD'])
    assert.ok(results.every((r) => r.changePercent > 0))
  } finally {
    await b.done()
  }
})

test('a screen says what it could not examine', async () => {
  const b = await bench()
  try {
    const answer = data(
      await run(b.layer, 'market.screen', {
        conditions: [{ field: 'changePercent', operator: 'gt', value: 5 }]
      })
    )
    assert.equal(answer.universeSize, 2)
    assert.equal(answer.matched, 1)
    assert.equal(answer.skipped, 0)
  } finally {
    await b.done()
  }
})

test('a screen with nothing valid in it is refused rather than returning the whole exchange', async () => {
  const b = await bench()
  try {
    // Otherwise it would answer with every market and read as a finding.
    assert.ok(failed(await run(b.layer, 'market.screen', { conditions: [{ field: 'nonsense', operator: 'gt', value: 1 }] })))
  } finally {
    await b.done()
  }
})

// ---------------------------------------------------------------- acting

test('adding to a watchlist really adds it, and is checked afterwards', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.watch', { market: 'bitcoin', watchlist: 'Core' }))
    assert.equal(answer.symbol, 'BTCUSD')
    const lists = await b.store.watchlists('one')
    assert.equal(lists[0].name, 'Core')
    assert.deepEqual(lists[0].items.map((i) => i.instrumentId), [BTC])
  } finally {
    await b.done()
  }
})

test('an alert needs a number and is refused without one', async () => {
  const b = await bench()
  try {
    // Inventing a threshold would create an alert nobody asked for.
    assert.ok(failed(await run(b.layer, 'market.alertCreate', { market: 'bitcoin', comparison: 'above' })))
    assert.equal((await b.store.alerts('one')).length, 0)
  } finally {
    await b.done()
  }
})

test('an alert with a threshold is created and can be read back', async () => {
  const b = await bench()
  try {
    await run(b.layer, 'market.alertCreate', { market: 'bitcoin', comparison: 'crosses-above', value: 150 })
    const answer = data(await run(b.layer, 'market.alerts'))
    const alerts = answer.alerts as { symbol: string; condition: string }[]
    assert.equal(alerts.length, 1)
    assert.equal(alerts[0].symbol, 'BTCUSD')
    assert.ok(alerts[0].condition.includes('150'))
  } finally {
    await b.done()
  }
})

test('a simulated order is refused when there is no simulated account', async () => {
  const b = await bench()
  try {
    assert.ok(failed(await run(b.layer, 'market.paperOrder', { market: 'bitcoin', side: 'buy', quantity: 1 })))
  } finally {
    await b.done()
  }
})

test('a simulated order goes to the paper account and says it is simulated', async () => {
  const b = await bench()
  try {
    await b.store.startPaper('one', 10_000, 'USD')
    const answer = data(await run(b.layer, 'market.paperOrder', { market: 'bitcoin', side: 'buy', quantity: 1 }))
    assert.equal(answer.simulated, true)
    assert.ok(String(answer.note).includes('Nothing was sent to any exchange'))
    const held = await b.store.paper('one')
    assert.equal(held?.account.positions.length, 1)
    assert.ok((held?.account.cash ?? 0) < 10_000)
  } finally {
    await b.done()
  }
})

test('a simulated order with no quantity is refused', async () => {
  const b = await bench()
  try {
    await b.store.startPaper('one', 10_000, 'USD')
    assert.ok(failed(await run(b.layer, 'market.paperOrder', { market: 'bitcoin', side: 'buy', quantity: 0 })))
    assert.ok(failed(await run(b.layer, 'market.paperOrder', { market: 'bitcoin', side: 'sideways', quantity: 1 })))
  } finally {
    await b.done()
  }
})

test('the portfolio is labelled simulated and names what it could not price', async () => {
  const b = await bench()
  try {
    await b.store.startPaper('one', 10_000, 'USD')
    const answer = data(await run(b.layer, 'market.portfolio'))
    assert.equal(answer.simulated, true)
    assert.equal(answer.total, 10_000)
    assert.ok(Array.isArray(answer.assumptions) && (answer.assumptions as unknown[]).length > 0)
    assert.equal(answer.unpricedPositions, 0)
  } finally {
    await b.done()
  }
})

test('no simulated account reads as none rather than as an empty one', async () => {
  const b = await bench()
  try {
    const answer = data(await run(b.layer, 'market.portfolio'))
    assert.equal(answer.account, null)
    assert.ok(String(answer.note).includes('No simulated account'))
  } finally {
    await b.done()
  }
})

test('a backtest carries its assumptions and its benchmark', async () => {
  const b = await bench()
  try {
    await b.store.saveStrategy('one', {
      instrumentId: BTC,
      name: 'Rising',
      interval: '1h',
      direction: 'long',
      entry: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'above', right: { kind: 'value', value: 110 } }] },
      exit: { match: 'all', rules: [{ left: { kind: 'price', field: 'close' }, comparator: 'below', right: { kind: 'value', value: 105 } }] },
      sizing: { kind: 'percent-equity', value: 50 },
      cooldownBars: 0
    })
    const answer = data(await run(b.layer, 'market.backtest', { strategy: 'Rising' }))
    assert.equal(answer.strategy, 'Rising')
    assert.ok(Array.isArray(answer.assumptions))
    assert.ok(Array.isArray(answer.rules))
    // The comparison travels in the same answer, so a summary cannot leave it behind.
    assert.ok('buyAndHoldPercent' in answer)
    assert.ok(String(answer.note).includes('not a forecast'))
  } finally {
    await b.done()
  }
})

test('a strategy that cannot run is refused with the reason', async () => {
  const b = await bench()
  try {
    await b.store.saveStrategy('one', {
      instrumentId: BTC,
      name: 'No way out',
      interval: '1h',
      direction: 'long',
      entry: { match: 'all', rules: [{ left: { kind: 'price' }, comparator: 'above', right: { kind: 'value', value: 1 } }] },
      exit: { match: 'all', rules: [] },
      sizing: { kind: 'percent-equity', value: 50 },
      cooldownBars: 0
    })
    assert.ok(failed(await run(b.layer, 'market.backtest', { strategy: 'No way out' })))
  } finally {
    await b.done()
  }
})

test('opening a market on screen asks the window and reports when there is none', async () => {
  const b = await bench()
  try {
    await run(b.layer, 'market.open', { market: 'bitcoin' })
    assert.deepEqual(b.shown, [BTC])
  } finally {
    await b.done()
  }
})

// ---------------------------------------------------------------- the master switch

test('with Markets switched off, reading a market is refused rather than answered from stale memory', async () => {
  const b = await bench({ enabled: false })
  try {
    assert.ok(failed(await run(b.layer, 'market.quote', { market: 'bitcoin' })))
    assert.ok(failed(await run(b.layer, 'market.movers')))
    assert.ok(failed(await run(b.layer, 'market.search', { query: 'bitcoin' })))
  } finally {
    await b.done()
  }
})

test('the standing summary is counts and labels, never prices', async () => {
  const b = await bench()
  try {
    await b.store.createWatchlist('one', 'Core')
    const state = await b.layer.snapshot(['markets'])
    const markets = state.markets as Record<string, unknown>
    assert.equal(markets.enabled, true)
    assert.deepEqual(markets.watchlists, [{ name: 'Core', markets: 0 }])
    // This is read whenever the layer describes itself, so it must not carry a price that would then be stale.
    assert.ok(!JSON.stringify(markets).includes('"price"'))
  } finally {
    await b.done()
  }
})
