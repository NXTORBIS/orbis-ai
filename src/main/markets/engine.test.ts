import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffFor, MarketEngine, type EngineEvent } from './engine.ts'
import { instrumentId, type Quote } from '../../shared/markets/instrument.ts'
import {
  ProviderError,
  type Candle,
  type Interval,
  type MarketProvider,
  type ProviderCapabilities,
  type ProviderEvents,
  type TradePrint
} from '../../shared/markets/provider.ts'

/**
 * The market data engine.
 *
 * The tests that matter most are the ones about honesty: that nothing is invented when a provider has no answer, that a
 * provider's declared delay cannot be talked out of, that an older price cannot overwrite a newer one, and that a dead
 * feed is reported as dead rather than left showing its last value under a live indicator.
 *
 * No network. Providers are objects, so every failure mode -- rate limit, outage, out-of-order events, a provider that was
 * never configured -- can be made to happen on purpose.
 */

const CAPS: ProviderCapabilities = {
  assetTypes: ['crypto'],
  streaming: true,
  intervals: ['1m', '1h', '1d'],
  search: true,
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

const btc = instrumentId({ provider: 'fake', assetType: 'crypto', exchange: 'fake', symbol: 'BTCUSD' })
const eth = instrumentId({ provider: 'fake', assetType: 'crypto', exchange: 'fake', symbol: 'ETHUSD' })

const quote = (id: string, over: Partial<Quote> = {}): Quote => ({
  instrumentId: id,
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

/** A provider that does exactly what a test tells it to. */
const fake = (
  over: Partial<MarketProvider> & { caps?: Partial<ProviderCapabilities>; readyResult?: ReturnType<MarketProvider['ready']> } = {}
): MarketProvider & { events: ProviderEvents | null; streamedWith: string[][]; streamedTrades: string[][]; stopped: number } => {
  const self = {
    id: 'fake',
    name: 'Fake',
    capabilities: { ...CAPS, ...over.caps },
    events: null as ProviderEvents | null,
    streamedWith: [] as string[][],
    streamedTrades: [] as string[][],
    stopped: 0,
    ready: () => over.readyResult ?? ({ ok: true } as const),
    search: async (query: string) => [
      { instrumentId: btc, symbol: 'BTCUSD', name: `Found ${query}`, assetType: 'crypto' as const, exchange: 'fake', currency: 'USD', provider: 'fake' }
    ],
    quotes: async (ids: string[]) => ids.map((id) => quote(id)),
    candles: async (_id: string, _interval: Interval, limit: number): Promise<Candle[]> =>
      Array.from({ length: Math.min(3, limit) }, (_v, i) => ({ time: i, open: 1, high: 2, low: 0, close: 1, volume: 10 })),
    stream: async (ids: string[], events: ProviderEvents, options?: { trades?: string[] }) => {
      self.streamedWith.push([...ids])
      self.streamedTrades.push([...(options?.trades ?? [])])
      self.events = events
      events.status('connected')
      return () => {
        self.stopped++
        self.events = null
      }
    },
    ...over
  }
  return self as unknown as MarketProvider & {
    events: ProviderEvents | null
    streamedWith: string[][]
    streamedTrades: string[][]
    stopped: number
  }
}

/** A clock and one timer slot, so backoff can be exercised without waiting. */
const world = (): {
  now(): number
  at(ms: number): void
  pending(): number | null
  fire(): void
  setTimer(ms: number, run: () => void): () => void
} => {
  let clock = 1_000_000
  let due: { at: number; run: () => void } | null = null
  return {
    now: () => clock,
    at: (ms) => {
      clock = ms
    },
    pending: () => due?.at ?? null,
    fire: () => {
      const job = due
      due = null
      if (!job) throw new Error('nothing was scheduled')
      clock = Math.max(clock, job.at)
      job.run()
    },
    setTimer: (ms, run) => {
      due = { at: clock + ms, run }
      return () => {
        due = null
      }
    }
  }
}

const build = (
  provider: MarketProvider,
  clock = world()
): { engine: MarketEngine; events: EngineEvent[]; clock: ReturnType<typeof world> } => {
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer })
  const events: EngineEvent[] = []
  engine.on((e) => events.push(e))
  engine.add(provider)
  return { engine, events, clock }
}

// ---------------------------------------------------------------- nothing is invented

test('an instrument nobody has quoted has no quote, rather than zero', () => {
  const { engine } = build(fake())
  assert.equal(engine.quote(btc), null)
  assert.deepEqual(engine.quotesFor([btc, eth]), [null, null])
})

test('a provider that fails leaves the instruments with no quote and says why', async () => {
  const broken = fake({
    quotes: async () => {
      throw new ProviderError('rate-limited', 'Too many requests', 5000)
    }
  })
  const { engine } = build(broken)
  assert.deepEqual(await engine.refresh([btc]), [])
  assert.equal(engine.quote(btc), null)
  const status = engine.statuses()[0]
  assert.equal(status.connection, 'disconnected')
  assert.match(status.detail, /failed/)
})

test('a provider with no candles for an interval returns none rather than a made-up line', async () => {
  const { engine } = build(fake({ caps: { intervals: ['1d'] } }))
  assert.deepEqual(await engine.candlesFor(btc, '1m'), [])
  assert.equal((await engine.candlesFor(btc, '1d')).length, 3)
})

test('a provider that is not configured offers nothing at all', () => {
  const unconfigured = fake({ readyResult: { ok: false, code: 'not-configured', detail: 'No API key.' } })
  const { engine } = build(unconfigured)
  const status = engine.statuses()[0]
  assert.equal(status.configured, false)
  assert.equal(status.detail, 'No API key.')
  // And its declared capabilities are not counted as anybody's.
  assert.deepEqual(engine.capabilities().features, {})
  assert.deepEqual(engine.capabilities().assetTypes, [])
})

test('an unconfigured provider is not asked, so nothing appears from it', async () => {
  let asked = 0
  const unconfigured = fake({
    readyResult: { ok: false, code: 'not-configured', detail: 'No API key.' },
    quotes: async (ids: string[]) => {
      asked++
      return ids.map((id) => quote(id))
    }
  })
  const { engine } = build(unconfigured)
  assert.deepEqual(await engine.refresh([btc]), [])
  assert.equal(asked, 0)
})

// ---------------------------------------------------------------- freshness cannot be talked out of

test('a provider’s declared delay wins over a quote that claims to be live', async () => {
  // The licence is a fact about the feed. A quote that forgot to mention it is still fifteen minutes late.
  const delayed = fake({ caps: { delayedByMs: 15 * 60_000 } })
  const { engine } = build(delayed)
  await engine.refresh([btc])
  const view = engine.quote(btc)
  assert.equal(view?.delayedByMs, 15 * 60_000)
  assert.equal(view?.freshness, 'delayed')
})

test('a quote that claims a bigger delay than the provider keeps its own', async () => {
  const provider = fake({ quotes: async (ids: string[]) => ids.map((id) => quote(id, { delayedByMs: 60 * 60_000 })) })
  const { engine } = build(provider)
  await engine.refresh([btc])
  assert.equal(engine.quote(btc)?.delayedByMs, 60 * 60_000)
})

test('a quote that stops arriving goes stale on the clock, with nothing arriving to say so', async () => {
  const clock = world()
  const provider = fake()
  const { engine } = build(provider, clock)
  engine.watch(btc, 'ticker')
  await engine.refresh([btc])
  assert.equal(engine.quote(btc)?.freshness, 'real-time')
  assert.deepEqual(engine.staleWatched(), [])

  // Two minutes later, nothing has arrived. Crypto goes stale after one.
  clock.at(1_000_000 + 2 * 60_000)
  assert.equal(engine.quote(btc)?.freshness, 'stale')
  assert.deepEqual(engine.staleWatched(), [btc])
})

// ---------------------------------------------------------------- events in

test('an older quote cannot overwrite a newer one', async () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  await new Promise((r) => setTimeout(r, 0))

  provider.events?.quote(quote(btc, { last: 200, timestamp: 2_000_000 }))
  provider.events?.quote(quote(btc, { last: 100, timestamp: 1_500_000 }))
  assert.equal(engine.quote(btc)?.last, 200, 'the newer price survived')
  assert.equal(engine.statuses()[0].droppedEvents, 1)
})

test('a quote identical to the last one is dropped rather than re-announced', async () => {
  const provider = fake()
  const { engine, events } = build(provider)
  engine.watch(btc, 'chart')
  await new Promise((r) => setTimeout(r, 0))

  provider.events?.quote(quote(btc, { last: 200, timestamp: 2_000_000 }))
  const after = events.filter((e) => e.type === 'quote').length
  provider.events?.quote(quote(btc, { last: 200, timestamp: 2_000_000 }))
  assert.equal(events.filter((e) => e.type === 'quote').length, after, 'no second announcement')
  assert.equal(engine.statuses()[0].droppedEvents, 1)
})

test('the same timestamp with a different price is a real change and is kept', async () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  await new Promise((r) => setTimeout(r, 0))
  provider.events?.quote(quote(btc, { last: 200, timestamp: 2_000_000 }))
  provider.events?.quote(quote(btc, { last: 201, timestamp: 2_000_000 }))
  assert.equal(engine.quote(btc)?.last, 201)
})

test('a listener that throws does not stop the next one being told', async () => {
  const provider = fake()
  const clock = world()
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer })
  engine.add(provider)
  let reached = 0
  engine.on(() => {
    throw new Error('this screen is broken')
  })
  engine.on(() => {
    reached++
  })
  engine.watch(btc, 'chart')
  await new Promise((r) => setTimeout(r, 0))
  provider.events?.quote(quote(btc, { timestamp: 2_000_000 }))
  assert.ok(reached > 0)
})

// ---------------------------------------------------------------- subscriptions

test('what is watched is what is streamed, and nothing more', async () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(provider.streamedWith.at(-1), [btc])

  engine.watch(eth, 'watchlist')
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(provider.streamedWith.at(-1)?.slice().sort(), [btc, eth].sort())
})

test('two reasons for the same instrument keep one subscription, and releasing one keeps the data', async () => {
  const provider = fake()
  const { engine } = build(provider)
  const releaseChart = engine.watch(btc, 'chart')
  engine.watch(btc, 'alert')
  await new Promise((r) => setTimeout(r, 0))

  releaseChart()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(provider.streamedWith.at(-1), [btc], 'the alert still needs it')
  assert.deepEqual(
    engine.watched().map((w) => w.reasons),
    [['alert']]
  )
})

test('the same reason twice is counted, so one release does not stop the other', async () => {
  const provider = fake()
  const { engine } = build(provider)
  const first = engine.watch(btc, 'chart')
  engine.watch(btc, 'chart')
  first()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.watched().length, 1, 'the second chart still wants it')
})

test('releasing twice does not release something else', async () => {
  const provider = fake()
  const { engine } = build(provider)
  const release = engine.watch(btc, 'chart')
  engine.watch(btc, 'alert')
  release()
  release()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.watched().length, 1)
})

test('the last reason released stops the stream entirely', async () => {
  const provider = fake()
  const { engine } = build(provider)
  const release = engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  release()
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(engine.watched(), [])
  assert.equal(engine.statuses()[0].subscriptions, 0)
})

test('what somebody is looking at outranks what is running in the background', () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(eth, 'dashboard')
  engine.watch(btc, 'chart')
  // The chart first, whatever order they were asked for in.
  assert.deepEqual(
    engine.watched().map((w) => w.instrumentId),
    [btc, eth]
  )
})

test('beyond the limit, the most important are the ones streamed', async () => {
  const provider = fake()
  const clock = world()
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer, maxStreamed: 2 })
  engine.add(provider)
  const ids = ['a', 'b', 'c', 'd'].map((s) =>
    instrumentId({ provider: 'fake', assetType: 'crypto', exchange: 'fake', symbol: s })
  )
  engine.watch(ids[0], 'dashboard')
  engine.watch(ids[1], 'dashboard')
  engine.watch(ids[2], 'chart')
  engine.watch(ids[3], 'alert')
  await new Promise((r) => setTimeout(r, 0))
  const streamed = provider.streamedWith.at(-1) ?? []
  assert.equal(streamed.length, 2)
  assert.ok(streamed.includes(ids[2]), 'the chart is streamed')
  assert.ok(streamed.includes(ids[3]), 'the alert is streamed')
})

test('a burst of watches is one subscription change, not one each', async () => {
  // Twenty symbols added one at a time used to open and close the socket twenty times, which is a way to be rate-limited
  // while doing nothing wrong.
  const provider = fake()
  const { engine } = build(provider)
  const ids = ['a', 'b', 'c', 'd', 'e'].map((s) =>
    instrumentId({ provider: 'fake', assetType: 'crypto', exchange: 'fake', symbol: s })
  )
  for (const id of ids) engine.watch(id, 'watchlist')
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(provider.streamedWith.length, 1, `the socket was opened ${provider.streamedWith.length} times`)
  assert.equal(provider.streamedWith[0].length, 5, 'and it was given all five at once')
})

test('a provider that does not stream is never asked to', async () => {
  const pollOnly = fake({ caps: { streaming: false } })
  const { engine } = build(pollOnly)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(pollOnly.streamedWith.length, 0)
})

// ---------------------------------------------------------------- losing the connection

test('a dropped stream is reported as reconnecting, not left looking live', async () => {
  const provider = fake()
  const { engine, clock } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.statuses()[0].connection, 'connected')

  provider.events?.status('disconnected', 'the socket closed')
  assert.equal(engine.statuses()[0].connection, 'reconnecting')
  assert.notEqual(clock.pending(), null, 'and it will try again')
})

test('it tries again, and a successful reconnect is reported', async () => {
  const provider = fake()
  const { engine, clock } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  provider.events?.status('disconnected')
  clock.fire()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.statuses()[0].connection, 'connected')
  assert.ok(engine.statuses()[0].reconnects >= 1)
})

test('a stream that will not open is retried rather than given up on', async () => {
  let attempts = 0
  const provider = fake({
    stream: async () => {
      attempts++
      throw new ProviderError('network', 'no route')
    }
  })
  const { engine, clock } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(attempts, 1)
  assert.equal(engine.statuses()[0].connection, 'reconnecting')
  clock.fire()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(attempts, 2)
})

test('a provider that asks to be left alone for a while is', async () => {
  const provider = fake({
    stream: async () => {
      throw new ProviderError('rate-limited', 'slow down', 60_000)
    }
  })
  const { engine, clock } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(clock.pending(), 1_000_000 + 60_000, 'its own retry-after is honoured')
})

test('backoff grows and is jittered, so every Orbis does not reconnect in the same instant', () => {
  // Without jitter, one provider blip becomes an outage: everybody comes back at once.
  const lowest = backoffFor(0, () => 0)
  const highest = backoffFor(0, () => 0.999)
  assert.ok(highest > lowest, 'there is jitter')
  assert.ok(backoffFor(5, () => 0) > backoffFor(1, () => 0), 'it grows')
  // And it is bounded, so a long outage does not become an hour-long wait.
  assert.ok(backoffFor(30, () => 1) <= 30_000)
  // A negative attempt is not a negative wait.
  assert.ok(backoffFor(-5, () => 0) > 0)
})

test('nothing to stream means disconnected rather than a connection kept open for nobody', async () => {
  const provider = fake()
  const { engine } = build(provider)
  const release = engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  release()
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(engine.statuses()[0].connection, 'disconnected')
  assert.equal(provider.stopped, 1)
})

// ---------------------------------------------------------------- caches

test('candles are cached briefly, then asked for again', async () => {
  let asked = 0
  const provider = fake({
    candles: async () => {
      asked++
      return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]
    }
  })
  const clock = world()
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer, candleCacheMs: 10_000 })
  engine.add(provider)
  await engine.candlesFor(btc, '1h')
  await engine.candlesFor(btc, '1h')
  assert.equal(asked, 1, 'the second came from the cache')
  clock.at(1_000_000 + 11_000)
  await engine.candlesFor(btc, '1h')
  assert.equal(asked, 2)
})

test('a failed candle request falls back to what was cached rather than to nothing', async () => {
  let fail = false
  const provider = fake({
    candles: async () => {
      if (fail) throw new ProviderError('network', 'gone')
      return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]
    }
  })
  const clock = world()
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer, candleCacheMs: 1 })
  engine.add(provider)
  assert.equal((await engine.candlesFor(btc, '1h')).length, 1)
  fail = true
  clock.at(1_000_000 + 10_000)
  // The old candles, which are still true about the past -- not an empty chart.
  assert.equal((await engine.candlesFor(btc, '1h')).length, 1)
})

test('searching keeps what it found, so a saved watchlist can be restored without searching again', async () => {
  const { engine } = build(fake())
  const found = await engine.search('bitcoin')
  assert.equal(found.length, 1)
  assert.equal((await engine.instrument(found[0].instrumentId))?.symbol, 'BTCUSD')
})

test('an instrument can be remembered without asking anybody', async () => {
  const { engine } = build(fake())
  engine.remember({
    instrumentId: eth,
    symbol: 'ETHUSD',
    name: 'Ether',
    assetType: 'crypto',
    exchange: 'fake',
    currency: 'USD',
    provider: 'fake'
  })
  assert.equal((await engine.instrument(eth))?.name, 'Ether')
})

test('a malformed instrument id is refused everywhere rather than half-handled', async () => {
  const { engine } = build(fake())
  assert.equal(engine.quote('nonsense'), null)
  assert.deepEqual(await engine.candlesFor('nonsense', '1h'), [])
  assert.equal(await engine.instrument('nonsense'), null)
  assert.equal(await engine.orderBookFor('nonsense'), null)
})

// ---------------------------------------------------------------- stopping

test('stopping closes the streams and keeps the cache, which is still true', async () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(btc, 'ticker')
  await new Promise((r) => setTimeout(r, 0))
  await engine.refresh([btc])
  engine.stop()
  assert.equal(provider.stopped, 1)
  assert.ok(engine.quote(btc) !== null, 'the last price is still known, with its real age')
})

test('resetting forgets everything, because another profile’s markets are not this one’s', async () => {
  const provider = fake()
  const { engine } = build(provider)
  engine.watch(btc, 'ticker')
  await engine.refresh([btc])
  engine.reset()
  assert.equal(engine.quote(btc), null)
  assert.deepEqual(engine.watched(), [])
})

test('what the engine can do is the union of what its configured providers can', () => {
  const { engine } = build(fake())
  const caps = engine.capabilities()
  assert.deepEqual(caps.assetTypes, ['crypto'])
  assert.ok(caps.intervals.includes('1h'))
  assert.equal(caps.features.streaming, true)
  assert.equal(caps.features.search, true)
  // Not offered, so not claimed.
  assert.notEqual(caps.features.options, true)
  assert.notEqual(caps.features.orderBook, true)
})

// ---------------------------------------------------------------- the tape

const print = (id: string, over: Partial<TradePrint> = {}): TradePrint => ({
  instrumentId: id,
  price: 100,
  size: 1,
  side: 'buy',
  timestamp: 1_000_000,
  ...over
})

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

test('everything watched takes its price from the trade stream', async () => {
  // This used to be the other way round: trades were streamed only for an open tape, and everything else took its
  // price from the ticker -- which arrives about once a second. A price that sat still while the trades that had
  // already moved it scrolled past in the panel beside it is what that looked like.
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  engine.watchAll([btc, eth], 'watchlist')
  await tick()
  const last = provider.streamedTrades[provider.streamedTrades.length - 1]
  assert.deepEqual([...last].sort(), [btc, eth].sort())
})

test('an open tape comes first when the cap bites', async () => {
  // The cap is on how many instruments take their price from trades. A panel showing individual prints cannot be
  // the thing that loses them, so a tape is ordered ahead of a row that only wants a number.
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  engine.watchAll([btc, eth], 'watchlist')
  engine.watchTrades(eth)
  await tick()
  const last = provider.streamedTrades[provider.streamedTrades.length - 1]
  assert.equal(last[0], eth, 'the instrument with a tape open is first')
})

test('a trade moves the price, not only the tape', async () => {
  // The point of streaming trades for everything: a print updates the quote people are reading.
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  const seen: number[] = []
  engine.on((event) => {
    if (event.type !== 'quote' || event.instrumentId !== btc) return
    const last = event.quote?.last
    if (typeof last === 'number') seen.push(last)
  })
  engine.watch(btc, 'watchlist')
  await tick()
  // A quote first, because a trade updates a price that already exists rather than inventing one.
  const events = provider.events
  assert.ok(events !== null, 'the provider should be streaming')
  events.quote(quote(btc, { last: 100, previousClose: 100 }))
  events.trade?.({ ...print(btc), price: 105, timestamp: 2_000_000 })
  await tick()
  assert.ok(seen.includes(105), `the traded price should reach the quote; saw ${JSON.stringify(seen)}`)
  // And the change follows from it: 105 against a previous close of 100 is five per cent.
  assert.ok(seen.includes(100), 'the ticker price should have arrived first')
})

test('two tapes on one pair are one subscription, and closing one keeps the other', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  const first = engine.watchTrades(btc)
  const second = engine.watchTrades(btc)
  await tick()
  const opened = provider.streamedTrades.length
  first()
  await tick()
  // Still wanted by the second consumer, so the socket is left alone.
  assert.equal(provider.streamedTrades.length, opened)
  assert.deepEqual(provider.streamedTrades[opened - 1], [btc])
  second()
  await tick()
  // The tape is closed, and the instrument is still watched -- so it keeps its trade subscription, because that is
  // now where its price comes from. What went away is the tape, not the price feed.
  assert.deepEqual(provider.streamedTrades[provider.streamedTrades.length - 1], [btc])
})

test('the tape is emptied when the last consumer goes away', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [print(btc)] })
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  const release = engine.watchTrades(btc)
  await engine.tradesFor(btc, 10)
  assert.equal(engine.trades(btc).length, 1)
  release()
  // Holding a busy pair's prints for nobody is how the browser's memory goes.
  assert.deepEqual(engine.trades(btc), [])
})

test('a tape opens with the provider’s recent trades rather than blank', async () => {
  const provider = fake({
    caps: { trades: true },
    trades: async () => [print(btc, { timestamp: 1 }), print(btc, { timestamp: 2 })]
  })
  const { engine } = build(provider)
  const got = await engine.tradesFor(btc, 10)
  assert.equal(got.length, 2)
  assert.deepEqual(
    got.map((t) => t.timestamp),
    [1, 2]
  )
})

test('a provider with no trades gives an empty tape, not an error', async () => {
  const { engine } = build(fake({ caps: { trades: false } }))
  assert.deepEqual(await engine.tradesFor(btc, 10), [])
})

test('a provider that throws while seeding leaves the tape empty', async () => {
  const provider = fake({
    caps: { trades: true },
    trades: async () => {
      throw new ProviderError('rate-limited', 'Too many requests')
    }
  })
  const { engine } = build(provider)
  assert.deepEqual(await engine.tradesFor(btc, 10), [])
})

test('the seed and the first streamed prints do not show the same fill twice', async () => {
  const same = print(btc, { timestamp: 5, price: 101, size: 2 })
  const provider = fake({ caps: { trades: true }, trades: async () => [same] })
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  engine.watchTrades(btc)
  await engine.tradesFor(btc, 10)
  await tick()
  provider.events?.trade?.({ ...same })
  // A tape that shows a fill twice misrepresents how much traded.
  assert.equal(engine.trades(btc).length, 1)
})

test('a print arriving late goes where it belongs in time', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  engine.watchTrades(btc)
  await tick()
  provider.events?.trade?.(print(btc, { timestamp: 10 }))
  provider.events?.trade?.(print(btc, { timestamp: 30 }))
  provider.events?.trade?.(print(btc, { timestamp: 20 }))
  assert.deepEqual(
    engine.trades(btc).map((t) => t.timestamp),
    [10, 20, 30]
  )
})

test('the tape stops growing at its ceiling', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const clock = world()
  const engine = new MarketEngine({ now: clock.now, setTimer: clock.setTimer, tapeSize: 3 })
  engine.add(provider)
  engine.watch(btc, 'chart')
  engine.watchTrades(btc)
  await tick()
  for (let i = 1; i <= 6; i++) provider.events?.trade?.(print(btc, { timestamp: i * 10, price: 100 + i }))
  const held = engine.trades(btc)
  assert.equal(held.length, 3)
  // The newest three: the oldest are what a tape can afford to forget.
  assert.deepEqual(
    held.map((t) => t.timestamp),
    [40, 50, 60]
  )
})

test('a malformed print never reaches the tape', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine } = build(provider)
  engine.watch(btc, 'chart')
  engine.watchTrades(btc)
  await tick()
  for (const bad of [
    print(btc, { price: Number.NaN }),
    print(btc, { size: Number.NaN }),
    print(btc, { price: 0 }),
    print(btc, { size: -1 }),
    print(btc, { price: Number.POSITIVE_INFINITY }),
    print(btc, { timestamp: Number.NaN })
  ]) {
    provider.events?.trade?.(bad)
  }
  assert.deepEqual(engine.trades(btc), [])
})

test('a streamed print is announced so an open tape can draw it', async () => {
  const provider = fake({ caps: { trades: true }, trades: async () => [] })
  const { engine, events } = build(provider)
  engine.watch(btc, 'chart')
  engine.watchTrades(btc)
  await tick()
  provider.events?.trade?.(print(btc, { timestamp: 42, price: 123 }))
  const announced = events.filter((e) => e.type === 'trade')
  assert.equal(announced.length, 1)
  assert.equal(announced[0].instrumentId, btc)
  assert.equal(announced[0].trade?.price, 123)
})
