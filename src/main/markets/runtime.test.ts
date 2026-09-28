import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketEngine } from './engine.ts'
import { MarketsStore } from './store.ts'
import { MarketsRuntime } from './runtime.ts'
import type { Instrument, Quote } from '../../shared/markets/instrument.ts'
import type {
  MarketProvider,
  ProviderCapabilities,
  ProviderEvents
} from '../../shared/markets/provider.ts'

/**
 * Markets joined up: the store's choices, the engine's data, and the one sentence the interface shows about whether any of
 * it is live.
 *
 * The tests here are about that sentence being true. A header that says "Disconnected" over a price that is arriving, or
 * "Live" when nothing is streaming, is the same failure in two directions -- and both were possible before the states
 * below existed.
 */

const CAPS: ProviderCapabilities = {
  assetTypes: ['crypto'],
  streaming: true,
  intervals: ['1h'],
  search: false,
  quotes: true,
  orderBook: false,
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
  delayedByMs: 0
}

const btc = 'fake:crypto:fake:btcusd'

const instrument: Instrument = {
  instrumentId: btc,
  symbol: 'BTCUSD',
  name: 'BTC / USD',
  assetType: 'crypto',
  exchange: 'fake',
  currency: 'USD',
  provider: 'fake'
}

const quote = (over: Partial<Quote> = {}): Quote => ({
  instrumentId: btc,
  last: 100,
  previousClose: 90,
  change: 10,
  changePercent: 11.1,
  bid: null,
  ask: null,
  volume: null,
  dayHigh: null,
  dayLow: null,
  timestamp: 1_000_000,
  delayedByMs: 0,
  marketStatus: 'always-open',
  source: 'Fake',
  ...over
})

const provider = (
  over: Partial<ProviderCapabilities> = {}
): MarketProvider & { events: ProviderEvents | null } => {
  const self = {
    id: 'fake',
    name: 'Fake',
    capabilities: { ...CAPS, ...over },
    events: null as ProviderEvents | null,
    ready: () => ({ ok: true }) as const,
    quotes: async () => [quote()],
    resolve: async () => instrument,
    stream: async (_ids: string[], events: ProviderEvents) => {
      self.events = events
      events.status('connected')
      return () => {
        self.events = null
      }
    }
  }
  return self as unknown as MarketProvider & { events: ProviderEvents | null }
}

const bench = async (): Promise<{
  engine: MarketEngine
  store: MarketsStore
  runtime: MarketsRuntime
  feed: ReturnType<typeof provider>
  done(): Promise<void>
}> => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-markets-runtime-'))
  const engine = new MarketEngine()
  const feed = provider()
  engine.add(feed)
  engine.remember(instrument)
  const store = new MarketsStore(dir)
  const runtime = new MarketsRuntime({ engine, store, profileId: async () => 'one' })
  return {
    engine,
    store,
    runtime,
    feed,
    done: async () => {
      runtime.stop()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

// ---------------------------------------------------------------- what one word means

test('a provider that is configured but has nothing to stream is ready, not disconnected', async () => {
  const b = await bench()
  try {
    await b.runtime.start()
    // Nobody has asked for a price. That is not an outage, and calling it one reports a failure that is not happening.
    assert.equal(b.runtime.connection(), 'idle')
  } finally {
    await b.done()
  }
})

test('a stream that is up is live', async () => {
  const b = await bench()
  try {
    await b.runtime.start()
    b.engine.watch(btc, 'chart')
    await settle()
    assert.equal(b.runtime.connection(), 'connected')
  } finally {
    await b.done()
  }
})

test('a stream that has dropped is not reported as ready', async () => {
  const b = await bench()
  try {
    await b.runtime.start()
    b.engine.watch(btc, 'chart')
    await settle()
    b.feed.events?.status('disconnected', 'the socket closed')
    const state = b.runtime.connection()
    // Something is subscribed and is not arriving. The engine schedules a retry straight away, so the honest word is
    // "reconnecting" -- but the point of the test is that it is never softened into "ready", which is reserved for a feed
    // nobody has asked anything of.
    assert.ok(state === 'reconnecting' || state === 'disconnected', `expected a failure state, got ${state}`)
    assert.notEqual(state, 'idle')
    assert.notEqual(state, 'connected')
  } finally {
    await b.done()
  }
})

test('with no provider at all it says so rather than claiming a connection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-markets-runtime-'))
  const engine = new MarketEngine()
  const store = new MarketsStore(dir)
  const runtime = new MarketsRuntime({ engine, store, profileId: async () => 'one' })
  try {
    await runtime.start()
    assert.equal(runtime.connection(), 'not-configured')
  } finally {
    runtime.stop()
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- the master switch

test('Markets switched off holds no subscriptions', async () => {
  const b = await bench()
  try {
    await b.store.setTicker('one', { ...(await b.store.ticker('one')), enabled: true })
    await b.store.setTickerGroup('one', { id: 'g1', name: 'Main', instrumentIds: [btc] })
    await b.runtime.start()
    await settle()
    assert.ok(b.engine.watched().length > 0, 'the ticker should be holding a subscription while Markets is on')

    await b.store.setEnabled('one', false)
    await settle()
    // A socket left open for a feature somebody switched off is the thing the switch exists to prevent.
    assert.deepEqual(b.engine.watched(), [])
  } finally {
    await b.done()
  }
})

test('switching Markets back on restores what was being watched', async () => {
  const b = await bench()
  try {
    await b.store.setTicker('one', { ...(await b.store.ticker('one')), enabled: true })
    await b.store.setTickerGroup('one', { id: 'g1', name: 'Main', instrumentIds: [btc] })
    await b.runtime.start()
    await b.store.setEnabled('one', false)
    await settle()
    await b.store.setEnabled('one', true)
    await settle()
    assert.deepEqual(
      b.engine.watched().map((w) => w.instrumentId),
      [btc]
    )
  } finally {
    await b.done()
  }
})

test('the strip is told to hide when Markets is off, whatever the ticker’s own setting says', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-markets-runtime-'))
  const engine = new MarketEngine()
  engine.add(provider())
  const store = new MarketsStore(dir)
  const told: { enabled: boolean }[] = []
  const runtime = new MarketsRuntime({
    engine,
    store,
    profileId: async () => 'one',
    onTickerChanged: (config) => told.push({ enabled: config.enabled })
  })
  try {
    await store.setTicker('one', { ...(await store.ticker('one')), enabled: true })
    await runtime.start()
    await settle()
    assert.equal(told[told.length - 1]?.enabled, true)

    await store.setEnabled('one', false)
    await settle()
    // A band across the bottom of the browser with nothing behind it is worse than no band.
    assert.equal(told[told.length - 1]?.enabled, false)
    assert.equal((await store.ticker('one')).enabled, true, 'the ticker’s own setting should be untouched')
  } finally {
    runtime.stop()
    await rm(dir, { recursive: true, force: true })
  }
})

test('the strip shows nothing while Markets is off', async () => {
  const b = await bench()
  try {
    await b.store.setTicker('one', { ...(await b.store.ticker('one')), enabled: true })
    await b.store.setTickerGroup('one', { id: 'g1', name: 'Main', instrumentIds: [btc] })
    await b.runtime.start()
    await settle()
    assert.equal((await b.runtime.tickerState()).items.length, 1)

    await b.store.setEnabled('one', false)
    await settle()
    const state = await b.runtime.tickerState()
    assert.deepEqual(state.items, [])
    assert.equal(state.config.enabled, false)
  } finally {
    await b.done()
  }
})

test('priming asks for nothing while Markets is off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'orbis-markets-runtime-'))
  const engine = new MarketEngine()
  let asked = 0
  const feed = provider()
  const counting = { ...feed, quotes: async (ids: string[]) => (asked += ids.length, [quote()]) } as MarketProvider
  engine.add(counting)
  engine.remember(instrument)
  const store = new MarketsStore(dir)
  const runtime = new MarketsRuntime({ engine, store, profileId: async () => 'one' })
  try {
    await store.setTicker('one', { ...(await store.ticker('one')), enabled: true })
    await store.setTickerGroup('one', { id: 'g1', name: 'Main', instrumentIds: [btc] })
    await store.setEnabled('one', false)
    await runtime.start()
    await runtime.prime()
    assert.equal(asked, 0)
  } finally {
    runtime.stop()
    await rm(dir, { recursive: true, force: true })
  }
})
