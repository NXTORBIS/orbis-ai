import {
  freshnessOf,
  parseInstrumentId,
  viewOf,
  type AssetType,
  type Instrument,
  type Quote,
  type QuoteView
} from '../../shared/markets/instrument.ts'
import {
  availableFrom,
  INTERVAL_MS,
  ProviderError,
  servesAsset,
  servesInterval,
  type Candle,
  type Interval,
  type MarketProvider,
  type OrderBook,
  type ProviderStatus,
  type TradePrint
} from '../../shared/markets/provider.ts'
import { BookKeeper, viewFromSnapshot, type BookDelta, type BookView } from '../../shared/markets/orderbook.ts'
import type {
  Contract,
  Funding,
  FundingPoint,
  Liquidation,
  LongShortRatio,
  MarkIndex,
  OpenInterest,
  OpenInterestPoint
} from '../../shared/markets/derivatives.ts'

/**
 * The one place market data comes from.
 *
 * Every screen asks this, and this asks the providers. Nothing else in Orbis talks to a provider, which is what makes
 * several things possible at once: one connection per provider instead of one per widget, one cache, one set of
 * subscriptions that reflects what is actually being looked at, one account of whether the data is fresh, and one place
 * that knows a provider has fallen over.
 *
 * Three things it is careful about, each of which is a way a market screen lies:
 *
 *  - **It never invents a value.** A provider with no answer produces no quote. There is no zero, no last-known-value
 *    dressed up as current, no interpolation across a gap. `freshness` on every quote says what it is.
 *  - **It subscribes to what is being watched, not to everything.** A screen says what it needs and stops saying it when
 *    it goes away. Subscribing to every instrument anybody ever mentioned is how a provider's rate limit is reached and
 *    then everything is stale.
 *  - **It reports its own state.** Connected, reconnecting, disconnected, unconfigured -- from the provider's own events,
 *    not inferred from silence.
 */

/** Why something is being watched. The engine keeps a subscription while any reason holds. */
export type WatchReason = 'chart' | 'ticker' | 'watchlist' | 'alert' | 'dashboard' | 'quote'

/**
 * Which reasons matter most when a provider cannot stream everything.
 *
 * The open chart and the ticker are what somebody is looking at; an alert has to keep working whether or not anybody is
 * looking. A background dashboard is last. Without an order, a provider's limit is hit by whatever happened to subscribe
 * first.
 */
const PRIORITY: Record<WatchReason, number> = {
  chart: 0,
  ticker: 1,
  alert: 2,
  watchlist: 3,
  quote: 4,
  dashboard: 5
}

export interface EngineEvent {
  type:
    | 'quote'
    | 'provider-status'
    | 'market-status'
    | 'orderbook'
    | 'trade'
    | 'subscriptions-changed'
    | 'funding'
    | 'mark'
    | 'open-interest'
    | 'liquidation'
  instrumentId?: string
  quote?: QuoteView
  provider?: string
  status?: string
  detail?: string
  book?: OrderBook
  trade?: TradePrint
}

export interface MarketEngineOptions {
  /** How many instruments a provider may be asked to stream at once. Beyond this, priority decides. */
  maxStreamed?: number
  now?(): number
  /** Replaceable so tests need no real clock. */
  setTimer?(ms: number, run: () => void): () => void
  /** How long a cached candle set is reused before being asked for again. */
  candleCacheMs?: number
  /**
   * How many trades to keep per instrument.
   *
   * A tape on a busy pair receives several prints a second, so this is a ceiling rather than a preference: without one the
   * buffer grows for as long as the panel is open and the browser's memory goes with it.
   */
  tapeSize?: number
}

interface Watch {
  instrumentId: string
  reasons: Map<WatchReason, number>
}

const DEFAULT_MAX_STREAMED = 200
const DEFAULT_CANDLE_CACHE_MS = 30_000
/**
 * How many forced closures are kept per contract.
 *
 * A busy liquidation feed publishes thousands an hour and the venue keeps no public history, so this is a window rather
 * than a record. Said on the panel, so nobody reads a partial window as the whole picture.
 */
const LIQUIDATION_BUFFER = 500

const DEFAULT_TAPE_SIZE = 250

/**
 * How long to wait before trying a dropped stream again.
 *
 * Exponential with jitter. The jitter matters more than it looks: without it every Orbis on a provider that had a blip
 * reconnects in the same instant, which is the thing that turns a blip into an outage.
 */
export function backoffFor(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt))
  return Math.round(base / 2 + random() * (base / 2))
}

export class MarketEngine {
  private readonly providers = new Map<string, MarketProvider>()
  private readonly watches = new Map<string, Watch>()
  private readonly quotes = new Map<string, Quote>()
  private readonly instruments = new Map<string, Instrument>()
  private readonly candles = new Map<string, { at: number; candles: Candle[] }>()
  private readonly listeners = new Set<(event: EngineEvent) => void>()

  /**
   * Which instruments want individual trades, and how many things are asking.
   *
   * Separate from `watches` because wanting a price and wanting every print are different appetites: the ticker wants
   * twenty prices and no prints, and one open tape wants both for one pair.
   */
  private readonly tradeWatches = new Map<string, number>()
  /** The recent tape per instrument, oldest first, bounded. */
  private readonly tape = new Map<string, TradePrint[]>()

  /**
   * The whole market universe, per provider, with when it was fetched.
   *
   * Cached because it is one large request that answers a question about thousands of markets. Movers, the heatmap and the
   * screener are all asking it, and they should not each cost a separate download of the exchange.
   */
  /**
   * Derivatives state, held the same way quotes are: whatever arrived last, per instrument.
   *
   * Separate maps rather than one object per contract, because they arrive from different places at different rates --
   * funding every few seconds on the mark stream, open interest only when somebody asks. One object would mean writing a
   * whole record to update one field, and reading a whole record to learn nothing had changed.
   */
  /**
   * One book keeper per instrument with a book open.
   *
   * The keeper is what makes an incremental depth stream safe: it checks every update's sequence against what it holds
   * and refuses one that would leave a gap. Held here rather than in the panel, so two panels on the same market share
   * one book and one subscription.
   */
  private readonly books = new Map<string, BookKeeper>()
  /** How many surfaces want each book, so the depth stream stops when the last one closes. */
  private readonly bookWatches = new Map<string, number>()
  /** Snapshot requests in flight, so a burst of gaps does not become a burst of requests. */
  private readonly snapshotting = new Set<string>()
  private readonly funding = new Map<string, Funding>()
  private readonly marks = new Map<string, MarkIndex>()
  private readonly openInterest = new Map<string, OpenInterest>()
  /**
   * Forced closures as they arrive, newest last, bounded per contract.
   *
   * Bounded because a busy liquidation feed publishes thousands an hour and nothing here is a record: the panel shows a
   * window. The venue keeps no public history, so what is dropped is gone -- which the panel says rather than implying
   * it has the lot.
   */
  private readonly liquidations = new Map<string, Liquidation[]>()
  private readonly contracts = new Map<string, { at: number; rows: Contract[] }>()
  private readonly universes = new Map<string, { at: number; rows: { instrument: Instrument; quote: Quote }[] }>()
  private readonly universeInFlight = new Map<string, Promise<{ instrument: Instrument; quote: Quote }[]>>()

  /** Per provider: its stream, its state, and the numbers the status panel shows. */
  private readonly streams = new Map<
    string,
    {
      stop?: () => void
      connection: 'connected' | 'disconnected' | 'reconnecting' | null
      detail: string
      attempt: number
      cancelRetry?: () => void
      subscribed: string[]
      /** The subset of `subscribed` that is also streaming individual trades. */
      streamingTrades: string[]
      /** Which instruments want incremental depth. Part of the socket's URL, so a change means a new socket. */
      streamingDepth: string[]
      lastUpdateAt: number | null
      dropped: number
      reconnects: number
    }
  >()

  /**
   * A pending resubscribe, so a burst of `watch` calls costs one subscription change.
   *
   * Without this, adding a twenty-symbol watchlist one symbol at a time opened and closed the socket twenty times --
   * each `watch` recomputed the set and handed the provider a different list. Binance counts connections against a rate
   * limit, so that is a way to be throttled while doing nothing wrong. Collapsed to the end of the current tick, which is
   * after any synchronous loop of `watch` calls has finished.
   */
  private resubscribePending: ReturnType<typeof setTimeout> | null = null

  private readonly now: () => number
  private readonly maxStreamed: number
  private readonly candleCacheMs: number
  private readonly tapeSize: number
  private readonly setTimer: (ms: number, run: () => void) => () => void

  constructor(options: MarketEngineOptions = {}) {
    this.now = options.now ?? Date.now
    this.maxStreamed = options.maxStreamed ?? DEFAULT_MAX_STREAMED
    this.candleCacheMs = options.candleCacheMs ?? DEFAULT_CANDLE_CACHE_MS
    this.tapeSize = Math.max(1, options.tapeSize ?? DEFAULT_TAPE_SIZE)
    this.setTimer =
      options.setTimer ??
      ((ms, run) => {
        const timer = setTimeout(run, ms)
        timer.unref?.()
        return () => clearTimeout(timer)
      })
  }

  // ---------------------------------------------------------------- providers

  add(provider: MarketProvider): void {
    this.providers.set(provider.id, provider)
    this.streams.set(provider.id, {
      connection: null,
      detail: provider.ready().ok ? 'Not connected yet.' : provider.ready().ok ? '' : this.readyDetail(provider),
      attempt: 0,
      subscribed: [],
      streamingTrades: [],
      streamingDepth: [],
      lastUpdateAt: null,
      dropped: 0,
      reconnects: 0
    })
  }

  private readyDetail(provider: MarketProvider): string {
    const ready = provider.ready()
    return ready.ok ? '' : ready.detail
  }

  list(): MarketProvider[] {
    return [...this.providers.values()]
  }

  /**
   * Which provider to ask for an asset type, in order.
   *
   * Several may serve one type; the first that is ready is the primary and the rest are the failover. A provider that is
   * not configured is not in the list at all, so a failover never falls over to something that was never going to answer.
   */
  private providersFor(assetType: AssetType): MarketProvider[] {
    return [...this.providers.values()].filter((p) => servesAsset(p, assetType))
  }

  /** What every provider says about itself, for the status panel. */
  statuses(): ProviderStatus[] {
    return [...this.providers.values()].map((provider) => {
      const state = this.streams.get(provider.id)
      const ready = provider.ready()
      return {
        id: provider.id,
        name: provider.name,
        configured: ready.ok,
        connection: state?.connection ?? null,
        detail: ready.ok ? (state?.detail ?? '') : ready.detail,
        capabilities: provider.capabilities,
        subscriptions: state?.subscribed.length ?? 0,
        lastUpdateAt: state?.lastUpdateAt ?? null,
        droppedEvents: state?.dropped ?? 0,
        reconnects: state?.reconnects ?? 0
      }
    })
  }

  /** What can honestly be offered, across every configured provider. */
  capabilities(): { assetTypes: AssetType[]; intervals: Interval[]; features: Record<string, boolean> } {
    const assetTypes = new Set<AssetType>()
    const intervals = new Set<Interval>()
    const features: Record<string, boolean> = {}
    for (const provider of this.providers.values()) {
      if (!provider.ready().ok) continue
      for (const type of provider.capabilities.assetTypes) assetTypes.add(type)
      for (const interval of provider.capabilities.intervals) intervals.add(interval)
      for (const [name, on] of Object.entries(availableFrom(provider))) {
        if (on) features[name] = true
      }
    }
    return { assetTypes: [...assetTypes], intervals: [...intervals], features }
  }

  // ---------------------------------------------------------------- listening

  on(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // A screen that throws while being told about a price must not stop the next screen being told.
      }
    }
  }

  // ---------------------------------------------------------------- what is being watched

  /**
   * Starts watching an instrument for a reason, and returns the way to stop.
   *
   * Reasons are counted, so two charts of the same instrument keep one subscription and closing one of them does not stop
   * the other's data. Nothing here subscribes directly: the set is worked out once, afterwards, from every reason held.
   */
  watch(instrumentId: string, reason: WatchReason): () => void {
    const existing = this.watches.get(instrumentId) ?? { instrumentId, reasons: new Map() }
    existing.reasons.set(reason, (existing.reasons.get(reason) ?? 0) + 1)
    this.watches.set(instrumentId, existing)
    this.scheduleResubscribe()
    let released = false
    return () => {
      if (released) return
      released = true
      const watch = this.watches.get(instrumentId)
      if (!watch) return
      const left = (watch.reasons.get(reason) ?? 0) - 1
      if (left > 0) watch.reasons.set(reason, left)
      else watch.reasons.delete(reason)
      if (watch.reasons.size === 0) this.watches.delete(instrumentId)
      this.scheduleResubscribe()
    }
  }

  /** Watches several at once, releasing all of them together. */
  watchAll(instrumentIds: string[], reason: WatchReason): () => void {
    const releases = instrumentIds.map((id) => this.watch(id, reason))
    return () => {
      for (const release of releases) release()
    }
  }

  /** What is being watched, most important first. */
  watched(): { instrumentId: string; reasons: WatchReason[]; priority: number }[] {
    return [...this.watches.values()]
      .map((watch) => {
        const reasons = [...watch.reasons.keys()]
        const priority = Math.min(...reasons.map((r) => PRIORITY[r]))
        return { instrumentId: watch.instrumentId, reasons, priority }
      })
      .sort((a, b) => a.priority - b.priority || a.instrumentId.localeCompare(b.instrumentId))
  }

  /**
   * Also asks for every trade on one instrument, for as long as the returned function is not called.
   *
   * Refcounted like `watch`, because two open tapes on the same pair should be one subscription, and closing one of them
   * should not silence the other.
   */
  watchTrades(instrumentId: string): () => void {
    const before = this.tradeWatches.get(instrumentId) ?? 0
    this.tradeWatches.set(instrumentId, before + 1)
    if (before === 0) this.scheduleResubscribe()
    let released = false
    return () => {
      if (released) return
      released = true
      const now = (this.tradeWatches.get(instrumentId) ?? 1) - 1
      if (now <= 0) {
        this.tradeWatches.delete(instrumentId)
        // The buffer goes with the last consumer: keeping it would be holding a busy pair's prints for nobody.
        this.tape.delete(instrumentId)
        this.scheduleResubscribe()
      } else {
        this.tradeWatches.set(instrumentId, now)
      }
    }
  }

  /** The recent tape for an instrument, oldest first. Empty when nothing has arrived or nothing is watching. */
  trades(instrumentId: string): TradePrint[] {
    return this.tape.get(instrumentId) ?? []
  }

  /**
   * Fills the tape from the provider's recent-trades endpoint.
   *
   * Called when a tape opens so it has something in it immediately. Streamed prints then extend it; anything already held
   * with the same time and price is not added twice.
   */
  async tradesFor(instrumentId: string, limit = 50): Promise<TradePrint[]> {
    const parsed = parseInstrumentId(instrumentId)
    if (!parsed) return []
    const provider = this.providers.get(parsed.provider)
    if (!provider || typeof provider.trades !== 'function') return this.trades(instrumentId)
    if (!provider.capabilities.trades || !provider.ready().ok) return this.trades(instrumentId)
    try {
      const prints = await provider.trades(instrumentId, limit)
      for (const print of prints) this.acceptTrade(print)
    } catch {
      // A tape that could not be seeded is empty, which the panel says. It is not an error worth breaking a page for.
    }
    return this.trades(instrumentId)
  }

  /**
   * A trade from a provider.
   *
   * Duplicates are dropped rather than appended: the seed from the REST endpoint and the first streamed prints overlap,
   * and a tape that shows the same fill twice misrepresents how much traded.
   */
  private acceptTrade(print: TradePrint): void {
    if (!Number.isFinite(print.price) || !Number.isFinite(print.size)) return
    if (print.price <= 0 || print.size <= 0) return
    if (!Number.isFinite(print.timestamp)) return
    const held = this.tape.get(print.instrumentId) ?? []
    const last = held[held.length - 1]
    // Out of order: an older print arriving after a newer one is inserted where it belongs rather than appended, so the
    // tape stays in time order without re-sorting it on every message.
    if (last && print.timestamp < last.timestamp) {
      let at = held.length
      while (at > 0 && held[at - 1].timestamp > print.timestamp) at--
      if (held[at] && held[at].timestamp === print.timestamp && held[at].price === print.price && held[at].size === print.size) return
      held.splice(at, 0, print)
    } else {
      if (last && last.timestamp === print.timestamp && last.price === print.price && last.size === print.size) return
      held.push(print)
    }
    while (held.length > this.tapeSize) held.shift()
    this.tape.set(print.instrumentId, held)
    this.emit({ type: 'trade', instrumentId: print.instrumentId, trade: print })
  }

  /** Collapses a burst of watch and release calls into one subscription change. */
  private scheduleResubscribe(): void {
    if (this.resubscribePending) return
    this.resubscribePending = setTimeout(() => {
      this.resubscribePending = null
      void this.resubscribe()
    }, 0)
    this.resubscribePending.unref?.()
  }

  /**
   * Tells each provider exactly what it should be streaming.
   *
   * Recomputed from scratch rather than adjusted, because the set is small and a diff that drifts is a subscription that
   * either costs nothing and delivers nothing, or costs a limit somebody else needed.
   */
  private async resubscribe(): Promise<void> {
    const wanted = this.watched().slice(0, this.maxStreamed)
    const byProvider = new Map<string, string[]>()
    for (const { instrumentId } of wanted) {
      const parsed = parseInstrumentId(instrumentId)
      if (!parsed) continue
      const list = byProvider.get(parsed.provider) ?? []
      list.push(instrumentId)
      byProvider.set(parsed.provider, list)
    }

    for (const provider of this.providers.values()) {
      const ids = byProvider.get(provider.id) ?? []
      const state = this.streams.get(provider.id)
      if (!state) continue
      // Trades are streamed only for instruments that are also being watched -- a tape with no price feed would be a
      // subscription for a panel that cannot draw its header.
      const tradeIds = ids.filter((id) => this.tradeWatches.has(id))
      // Depth, the same way: only for instruments being watched, because a book with no price feed is a panel that
      // cannot draw its own header.
      const depthIds = ids.filter((id) => this.bookWatches.has(id))
      const sameIds = ids.length === state.subscribed.length && ids.every((id, i) => state.subscribed[i] === id)
      const sameTrades =
        tradeIds.length === state.streamingTrades.length && tradeIds.every((id, i) => state.streamingTrades[i] === id)
      const sameDepth =
        depthIds.length === state.streamingDepth.length && depthIds.every((id, i) => state.streamingDepth[i] === id)
      // Any of the three lists changing means the socket's URL changes, so all three are checked before leaving it alone.
      if (sameIds && sameTrades && sameDepth) continue
      state.subscribed = ids
      state.streamingTrades = tradeIds
      state.streamingDepth = depthIds
      this.emit({ type: 'subscriptions-changed', provider: provider.id })
      await this.startStream(provider)
    }
  }

  private async startStream(provider: MarketProvider): Promise<void> {
    const state = this.streams.get(provider.id)
    if (!state) return
    state.cancelRetry?.()
    state.cancelRetry = undefined
    state.stop?.()
    state.stop = undefined

    if (!provider.capabilities.streaming || typeof provider.stream !== 'function') return
    const ready = provider.ready()
    if (!ready.ok) {
      this.setConnection(provider.id, null, ready.detail)
      return
    }
    if (state.subscribed.length === 0) {
      this.setConnection(provider.id, 'disconnected', 'Nothing to stream.')
      return
    }

    try {
      state.stop = await provider.stream(
        state.subscribed,
        {
        quote: (quote) => this.accept(provider, quote),
        orderBook: (book) => this.emit({ type: 'orderbook', instrumentId: book.instrumentId, book }),
        trade: (print) => this.acceptTrade(print),
        bookDelta: (delta) => this.acceptBookDelta(delta),
        funding: (one) => this.acceptFunding(one),
        markIndex: (one) => this.acceptMarkIndex(one),
        liquidation: (one) => this.acceptLiquidation(one),
        status: (connection, detail) => {
          if (connection === 'connected') state.attempt = 0
          this.setConnection(provider.id, connection, detail ?? '')
          if (connection === 'disconnected') {
            // What happened to the book while the stream was down is unknown, so no book from this provider is shown as
            // current until it has been snapshotted again.
            this.booksDisconnected(provider.id)
            this.retryLater(provider)
          }
          if (connection === 'connected') {
            // Back up: every open book needs a fresh snapshot before its deltas mean anything again.
            for (const instrumentId of this.depthWanted(provider.id)) void this.snapshotBook(instrumentId)
          }
        }
        },
        { trades: state.streamingTrades, depth: state.streamingDepth }
      )
      state.attempt = 0
      this.setConnection(provider.id, 'connected', `Streaming ${state.subscribed.length} instruments.`)
    } catch (err) {
      const detail = err instanceof ProviderError ? err.message : 'The stream could not be opened.'
      this.setConnection(provider.id, 'disconnected', detail)
      this.retryLater(provider, err instanceof ProviderError ? err.retryAfterMs : 0)
    }
  }

  /** Tries again later, with exponential backoff and jitter. */
  private retryLater(provider: MarketProvider, afterMs = 0): void {
    const state = this.streams.get(provider.id)
    if (!state || state.subscribed.length === 0) return
    state.cancelRetry?.()
    const wait = afterMs > 0 ? afterMs : backoffFor(state.attempt)
    state.attempt++
    state.reconnects++
    this.setConnection(provider.id, 'reconnecting', `Reconnecting in ${Math.round(wait / 1000)}s.`)
    state.cancelRetry = this.setTimer(wait, () => {
      state.cancelRetry = undefined
      void this.startStream(provider)
    })
  }

  private setConnection(
    providerId: string,
    connection: 'connected' | 'disconnected' | 'reconnecting' | null,
    detail: string
  ): void {
    const state = this.streams.get(providerId)
    if (!state) return
    if (state.connection === connection && state.detail === detail) return
    state.connection = connection
    state.detail = detail
    this.emit({ type: 'provider-status', provider: providerId, status: connection ?? 'not-configured', detail })
  }

  // ---------------------------------------------------------------- quotes in

  /**
   * A quote from a provider.
   *
   * Two kinds of event are dropped here, and counted so the status panel can show that they happened:
   *
   *  - one that is older than what we already have, which is what an out-of-order stream produces;
   *  - one identical to what we already have, which is what a provider that re-sends its state produces.
   *
   * Dropping them is not tidiness. Passing them on makes every screen re-render for nothing, and an older price arriving
   * after a newer one would make the newer one disappear.
   */
  private accept(provider: MarketProvider, incoming: Quote): void {
    const state = this.streams.get(provider.id)
    const parsed = parseInstrumentId(incoming.instrumentId)
    if (!parsed) return

    const previous = this.quotes.get(incoming.instrumentId)
    if (previous) {
      if (incoming.timestamp < previous.timestamp) {
        if (state) state.dropped++
        return
      }
      const unchanged =
        incoming.timestamp === previous.timestamp &&
        incoming.last === previous.last &&
        incoming.bid === previous.bid &&
        incoming.ask === previous.ask &&
        incoming.volume === previous.volume
      if (unchanged) {
        if (state) state.dropped++
        return
      }
    }

    // The provider's declared delay wins over anything a single quote says about itself: a licence is a fact about the
    // feed, and a quote that forgot to mention it is still fifteen minutes late.
    const quote: Quote = {
      ...incoming,
      delayedByMs: Math.max(incoming.delayedByMs, provider.capabilities.delayedByMs),
      source: incoming.source || provider.name
    }
    this.quotes.set(quote.instrumentId, quote)
    if (state) state.lastUpdateAt = this.now()
    this.emit({
      type: 'quote',
      instrumentId: quote.instrumentId,
      quote: viewOf(quote, parsed.assetType as AssetType, this.now())
    })
  }

  // ---------------------------------------------------------------- the whole universe

  /** Whether anything configured can report every market at once. */
  universeAvailable(): boolean {
    return this.list().some((p) => availableFrom(p).universe === true)
  }

  /**
   * Every market every configured provider serves, with its current statistics.
   *
   * Cached for `maxAgeMs`, and one request at a time per provider: five screens opening at once should not become five
   * downloads of the exchange. A provider that cannot answer contributes nothing rather than failing the call, so a heatmap
   * still draws when one of two feeds is down.
   */
  async universe(maxAgeMs = 60_000): Promise<{ instrument: Instrument; quote: QuoteView }[]> {
    const at = this.now()
    const out: { instrument: Instrument; quote: QuoteView }[] = []

    for (const provider of this.providers.values()) {
      if (availableFrom(provider).universe !== true || typeof provider.universe !== 'function') continue
      const held = this.universes.get(provider.id)
      let rows = held && at - held.at <= maxAgeMs ? held.rows : null
      if (!rows) {
        let pending = this.universeInFlight.get(provider.id)
        if (!pending) {
          pending = provider
            .universe()
            .then((fetched) => {
              this.universes.set(provider.id, { at: this.now(), rows: fetched })
              // Remembered, so opening one of them needs no second request to learn what it is.
              for (const row of fetched) this.instruments.set(row.instrument.instrumentId, row.instrument)
              return fetched
            })
            .finally(() => {
              this.universeInFlight.delete(provider.id)
            })
          this.universeInFlight.set(provider.id, pending)
        }
        try {
          rows = await pending
        } catch {
          // Fall back to whatever was last known, clearly aged rather than absent. If there is nothing, this provider
          // simply contributes nothing.
          rows = held?.rows ?? null
        }
      }
      if (!rows) continue
      for (const row of rows) {
        const parsed = parseInstrumentId(row.quote.instrumentId)
        if (!parsed) continue
        // The live streamed quote wins over the snapshot where there is one: the snapshot is a minute old at worst and the
        // stream is now, and a screen showing both should not disagree with itself.
        const live = this.quotes.get(row.quote.instrumentId)
        const best = live && live.timestamp >= row.quote.timestamp ? live : row.quote
        out.push({ instrument: row.instrument, quote: viewOf(best, parsed.assetType as AssetType, at) })
      }
    }
    return out
  }

  /** The last quote for an instrument, with its freshness worked out now. Null when there has never been one. */
  quote(instrumentId: string): QuoteView | null {
    const quote = this.quotes.get(instrumentId)
    if (!quote) return null
    const parsed = parseInstrumentId(instrumentId)
    return viewOf(quote, (parsed?.assetType ?? 'stock') as AssetType, this.now())
  }

  /** Several at once, in the order asked for, with nulls where there is nothing. */
  quotesFor(instrumentIds: string[]): (QuoteView | null)[] {
    return instrumentIds.map((id) => this.quote(id))
  }

  /**
   * Asks for quotes now, for instruments no stream covers.
   *
   * Grouped by provider so each is asked once. A provider that fails is tried again through the next one that serves the
   * same asset type -- and if none answers, the instruments simply have no quote, which every screen already knows how to
   * show.
   */
  async refresh(instrumentIds: string[]): Promise<QuoteView[]> {
    const byProvider = new Map<string, string[]>()
    for (const id of instrumentIds) {
      const parsed = parseInstrumentId(id)
      if (!parsed) continue
      const list = byProvider.get(parsed.provider) ?? []
      list.push(id)
      byProvider.set(parsed.provider, list)
    }
    const out: QuoteView[] = []
    for (const [providerId, ids] of byProvider) {
      const provider = this.providers.get(providerId)
      if (!provider || typeof provider.quotes !== 'function' || !provider.ready().ok) continue
      try {
        for (const quote of await provider.quotes(ids)) {
          this.accept(provider, quote)
          const view = this.quote(quote.instrumentId)
          if (view) out.push(view)
        }
      } catch {
        // Nothing invented. The instruments keep whatever they had, with their real age, and the status panel shows why.
        this.setConnection(providerId, 'disconnected', 'The last request failed.')
      }
    }
    return out
  }

  // ---------------------------------------------------------------- history

  /**
   * Candles, cached briefly.
   *
   * The cache is short and per interval: a daily chart does not need re-fetching every time a panel re-opens, and a
   * one-minute chart does. Historical data is kept apart from the live quote state because they go stale on completely
   * different timescales -- a closed day's candle never changes, and a price changes every second.
   */
  async candlesFor(instrumentId: string, interval: Interval, limit = 500): Promise<Candle[]> {
    const key = `${instrumentId}|${interval}|${limit}`
    const cached = this.candles.get(key)
    // A finished candle never changes, so the cache only has to expire within the current one.
    const window = Math.min(this.candleCacheMs, INTERVAL_MS[interval])
    if (cached && this.now() - cached.at < window) return cached.candles

    const parsed = parseInstrumentId(instrumentId)
    if (!parsed) return []
    const owner = this.providers.get(parsed.provider)
    const candidates = owner ? [owner] : this.providersFor(parsed.assetType as AssetType)
    for (const provider of candidates) {
      if (!servesInterval(provider, interval)) continue
      try {
        const candles = await provider.candles!(instrumentId, interval, limit)
        this.candles.set(key, { at: this.now(), candles })
        return candles
      } catch {
        // Try the next provider that serves this interval. If none does, the answer is no candles -- not a made-up line.
        continue
      }
    }
    return cached?.candles ?? []
  }

  async orderBookFor(instrumentId: string, depth = 20): Promise<OrderBook | null> {
    const parsed = parseInstrumentId(instrumentId)
    if (!parsed) return null
    const provider = this.providers.get(parsed.provider)
    if (!provider || typeof provider.orderBook !== 'function' || !provider.capabilities.orderBook) return null
    if (!provider.ready().ok) return null
    try {
      return await provider.orderBook(instrumentId, depth)
    } catch {
      return null
    }
  }



  // ---------------------------------------------------------------- the order book

  /**
   * Follows one market's book until the returned function is called.
   *
   * Refcounted like the trade tape: two panels on the same market share one depth subscription, and the last one to close
   * releases it. The first caller triggers a snapshot, because an incremental stream without one is a stream of changes to
   * a book nobody has.
   */
  watchBook(instrumentId: string): () => void {
    const held = this.bookWatches.get(instrumentId) ?? 0
    this.bookWatches.set(instrumentId, held + 1)
    if (!this.books.has(instrumentId)) this.books.set(instrumentId, new BookKeeper(instrumentId))
    if (held === 0) {
      this.scheduleResubscribe()
      void this.snapshotBook(instrumentId)
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const now = (this.bookWatches.get(instrumentId) ?? 1) - 1
      if (now <= 0) {
        this.bookWatches.delete(instrumentId)
        // The book goes with the subscription: keeping it would be keeping depth that stops being true immediately.
        this.books.delete(instrumentId)
        this.scheduleResubscribe()
      } else {
        this.bookWatches.set(instrumentId, now)
      }
    }
  }

  /** Which instruments want incremental depth, for the stream options. */
  private depthWanted(providerId: string): string[] {
    const out: string[] = []
    for (const instrumentId of this.bookWatches.keys()) {
      const parsed = parseInstrumentId(instrumentId)
      if (parsed?.provider === providerId) out.push(instrumentId)
    }
    return out
  }

  private acceptBookDelta(delta: BookDelta): void {
    const keeper = this.books.get(delta.instrumentId)
    // A delta for a book nobody is watching is not an error; the subscription is being torn down.
    if (!keeper) return
    const applied = keeper.apply(delta)
    if (!applied && keeper.needsSnapshot()) {
      // Continuity broke. A fresh snapshot is the only way back, and the panel shows "resynchronising" until it lands.
      void this.snapshotBook(delta.instrumentId)
      return
    }
    if (applied) this.emit({ type: 'orderbook', instrumentId: delta.instrumentId })
  }

  /**
   * Fetches a snapshot and hands it to the keeper.
   *
   * Deduplicated: a gap on a busy pair can be detected several times before the request returns, and each one asking again
   * would be a burst of identical requests at exactly the moment the venue is already struggling.
   */
  private async snapshotBook(instrumentId: string): Promise<void> {
    if (this.snapshotting.has(instrumentId)) return
    const keeper = this.books.get(instrumentId)
    if (!keeper) return
    this.snapshotting.add(instrumentId)
    try {
      const book = await this.orderBookFor(instrumentId, 100)
      // Still wanted, and still the same keeper: the panel may have closed while this was in flight.
      if (book && this.books.get(instrumentId) === keeper) {
        keeper.snapshot({
          instrumentId,
          lastUpdateId: book.lastUpdateId ?? null,
          bids: book.bids,
          asks: book.asks,
          timestamp: book.timestamp,
          source: book.source
        })
        this.emit({ type: 'orderbook', instrumentId })
      }
    } catch {
      // Left needing a snapshot, so the next delta asks again. Nothing is shown as current in the meantime.
    } finally {
      this.snapshotting.delete(instrumentId)
    }
  }

  /**
   * The book as a screen should read it.
   *
   * Null when nothing is following this market. A caller that has not asked for a book does not get one -- which is what
   * stops a panel rendering depth it never subscribed to and never releases.
   */
  bookView(instrumentId: string, depth = 0): BookView | null {
    const keeper = this.books.get(instrumentId)
    return keeper ? keeper.view(depth) : null
  }

  /**
   * A book for a venue with no incremental stream, or before the first snapshot lands.
   *
   * Polled: every read is the whole book, so there is nothing to miss. It is honestly as current as the poll, which is
   * why it reports `live` rather than claiming a continuity it is not maintaining.
   */
  async polledBook(instrumentId: string, depth = 20): Promise<BookView | null> {
    const book = await this.orderBookFor(instrumentId, depth)
    return book ? viewFromSnapshot(book) : null
  }

  /** Tells every open book that its stream dropped, so none of them is shown as current afterwards. */
  private booksDisconnected(providerId: string): void {
    for (const [instrumentId, keeper] of this.books) {
      const parsed = parseInstrumentId(instrumentId)
      if (parsed?.provider !== providerId) continue
      keeper.disconnected()
      this.emit({ type: 'orderbook', instrumentId })
    }
  }

  // ---------------------------------------------------------------- derivatives

  /**
   * The provider that owns an instrument, if it is ready and declares the capability.
   *
   * One check in one place. Without it every derivatives method below would repeat the same three conditions, and the
   * day one of them was forgotten a panel would ask a spot provider for funding and get an exception instead of an
   * honest "not available".
   */
  private derivativesProvider(
    instrumentId: string,
    capability: 'funding' | 'openInterest' | 'markPrice' | 'longShort' | 'liquidations' | 'datedFutures'
  ): MarketProvider | null {
    const parsed = parseInstrumentId(instrumentId)
    if (!parsed) return null
    const provider = this.providers.get(parsed.provider)
    if (!provider || !provider.ready().ok) return null
    return provider.capabilities[capability] ? provider : null
  }

  /** Whether anything configured can answer a derivatives question at all, for deciding whether to offer a panel. */
  derivativesAvailable(): { funding: boolean; openInterest: boolean; liquidations: boolean; markPrice: boolean; longShort: boolean } {
    const any = (key: 'funding' | 'openInterest' | 'liquidations' | 'markPrice' | 'longShort'): boolean => {
      for (const provider of this.providers.values()) {
        if (!provider.ready().ok) continue
        if (availableFrom(provider)[key]) return true
      }
      return false
    }
    return {
      funding: any('funding'),
      openInterest: any('openInterest'),
      liquidations: any('liquidations'),
      markPrice: any('markPrice'),
      longShort: any('longShort')
    }
  }

  /** Counts an event that was dropped as stale or duplicate, against the provider that sent it. */
  private countDrop(instrumentId: string): void {
    const parsed = parseInstrumentId(instrumentId)
    const state = parsed ? this.streams.get(parsed.provider) : undefined
    if (state) state.dropped += 1
  }

  private acceptFunding(one: Funding): void {
    const held = this.funding.get(one.instrumentId)
    // Older than what is held is not news. The same rule as quotes, for the same reason: a late frame must not undo a
    // newer one.
    if (held && held.at > one.at) {
      this.countDrop(one.instrumentId)
      return
    }
    this.funding.set(one.instrumentId, one)
    this.emit({ type: 'funding', instrumentId: one.instrumentId })
  }

  private acceptMarkIndex(one: MarkIndex): void {
    const held = this.marks.get(one.instrumentId)
    if (held && held.at > one.at) {
      this.countDrop(one.instrumentId)
      return
    }
    this.marks.set(one.instrumentId, one)
    this.emit({ type: 'mark', instrumentId: one.instrumentId })
  }

  private acceptLiquidation(one: Liquidation): void {
    const held = this.liquidations.get(one.instrumentId) ?? []
    // Same venue, same instant, same price and size is the same event arriving twice. Dropped, so a panel does not show
    // one closure as two.
    if (held.some((other) => other.at === one.at && other.price === one.price && other.size === one.size)) {
      this.countDrop(one.instrumentId)
      return
    }
    const next = [...held, one].sort((a, b) => a.at - b.at)
    this.liquidations.set(one.instrumentId, next.slice(-LIQUIDATION_BUFFER))
    this.emit({ type: 'liquidation', instrumentId: one.instrumentId })
  }

  /** Funding as last seen. Null when nothing has arrived, which is not a rate of zero. */
  fundingFor(instrumentId: string): Funding | null {
    return this.funding.get(instrumentId) ?? null
  }

  markIndexFor(instrumentId: string): MarkIndex | null {
    return this.marks.get(instrumentId) ?? null
  }

  openInterestFor(instrumentId: string): OpenInterest | null {
    return this.openInterest.get(instrumentId) ?? null
  }

  /** Forced closures held for this contract, oldest first. Empty when none have arrived since the panel opened. */
  liquidationsFor(instrumentId: string): Liquidation[] {
    return [...(this.liquidations.get(instrumentId) ?? [])]
  }

  /** Asks for funding now. Returns null when no configured provider can answer, rather than a rate nobody published. */
  async refreshFunding(instrumentIds: string[]): Promise<Funding[]> {
    const byProvider = new Map<MarketProvider, string[]>()
    for (const id of instrumentIds) {
      const provider = this.derivativesProvider(id, 'funding')
      if (!provider || typeof provider.funding !== 'function') continue
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), id])
    }
    const out: Funding[] = []
    for (const [provider, ids] of byProvider) {
      try {
        for (const one of await provider.funding!(ids)) {
          this.acceptFunding(one)
          out.push(one)
        }
      } catch {
        // A provider that cannot answer leaves what is held alone. The screen keeps showing its age.
      }
    }
    return out
  }

  async refreshOpenInterest(instrumentIds: string[]): Promise<OpenInterest[]> {
    const byProvider = new Map<MarketProvider, string[]>()
    for (const id of instrumentIds) {
      const provider = this.derivativesProvider(id, 'openInterest')
      if (!provider || typeof provider.openInterest !== 'function') continue
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), id])
    }
    const out: OpenInterest[] = []
    for (const [provider, ids] of byProvider) {
      try {
        for (const one of await provider.openInterest!(ids)) {
          const held = this.openInterest.get(one.instrumentId)
          if (held && held.at > one.at) continue
          this.openInterest.set(one.instrumentId, one)
          out.push(one)
        }
      } catch {
        // Left alone, same as funding.
      }
    }
    if (out.length > 0) this.emit({ type: 'open-interest' })
    return out
  }

  async refreshMarkIndex(instrumentIds: string[]): Promise<MarkIndex[]> {
    const byProvider = new Map<MarketProvider, string[]>()
    for (const id of instrumentIds) {
      const provider = this.derivativesProvider(id, 'markPrice')
      if (!provider || typeof provider.markIndex !== 'function') continue
      byProvider.set(provider, [...(byProvider.get(provider) ?? []), id])
    }
    const out: MarkIndex[] = []
    for (const [provider, ids] of byProvider) {
      try {
        for (const one of await provider.markIndex!(ids)) {
          this.acceptMarkIndex(one)
          out.push(one)
        }
      } catch {
        // Left alone.
      }
    }
    return out
  }

  async fundingHistoryFor(instrumentId: string, limit = 200): Promise<FundingPoint[]> {
    const provider = this.derivativesProvider(instrumentId, 'funding')
    if (!provider || typeof provider.fundingHistory !== 'function') return []
    try {
      return await provider.fundingHistory(instrumentId, limit)
    } catch {
      return []
    }
  }

  async openInterestHistoryFor(instrumentId: string, windowMs: number, limit = 200): Promise<OpenInterestPoint[]> {
    const provider = this.derivativesProvider(instrumentId, 'openInterest')
    if (!provider || typeof provider.openInterestHistory !== 'function') return []
    try {
      return await provider.openInterestHistory(instrumentId, windowMs, limit)
    } catch {
      return []
    }
  }

  async longShortFor(instrumentId: string, windowMs: number, limit = 200): Promise<LongShortRatio[]> {
    const provider = this.derivativesProvider(instrumentId, 'longShort')
    if (!provider || typeof provider.longShort !== 'function') return []
    try {
      return await provider.longShort(instrumentId, windowMs, limit)
    } catch {
      return []
    }
  }

  /**
   * Every contract a provider serves, cached.
   *
   * An hour, like the spot symbol list: contracts are listed and settle over days. The cache is per provider, so one
   * provider being unreachable does not empty another's list.
   */
  async contractsFor(providerId: string, maxAgeMs = 60 * 60_000): Promise<Contract[]> {
    const held = this.contracts.get(providerId)
    if (held && this.now() - held.at < maxAgeMs) return held.rows
    const provider = this.providers.get(providerId)
    if (!provider || !provider.ready().ok || typeof provider.contracts !== 'function') return held?.rows ?? []
    try {
      const rows = await provider.contracts()
      this.contracts.set(providerId, { at: this.now(), rows })
      return rows
    } catch {
      // The last good list, with its real age, rather than nothing.
      return held?.rows ?? []
    }
  }

  /** Every derivative contract from every configured provider. */
  async allContracts(): Promise<Contract[]> {
    const out: Contract[] = []
    for (const provider of this.providers.values()) {
      if (typeof provider.contracts !== 'function') continue
      out.push(...(await this.contractsFor(provider.id)))
    }
    return out
  }

  // ---------------------------------------------------------------- instruments

  /** Searches every provider that can be searched, and keeps what comes back so a saved list can be restored. */
  async search(query: string, limit = 20): Promise<Instrument[]> {
    const found: Instrument[] = []
    for (const provider of this.providers.values()) {
      if (!provider.capabilities.search || typeof provider.search !== 'function' || !provider.ready().ok) continue
      try {
        for (const instrument of await provider.search(query, limit)) {
          this.instruments.set(instrument.instrumentId, instrument)
          found.push(instrument)
        }
      } catch {
        continue
      }
    }
    return found.slice(0, limit)
  }

  /** An instrument by id, from what searching has already found, or from the provider that owns it. */
  async instrument(instrumentId: string): Promise<Instrument | null> {
    const known = this.instruments.get(instrumentId)
    if (known) return known
    const parsed = parseInstrumentId(instrumentId)
    if (!parsed) return null
    const provider = this.providers.get(parsed.provider)
    if (!provider || typeof provider.resolve !== 'function' || !provider.ready().ok) return null
    try {
      const found = await provider.resolve(instrumentId)
      if (found) this.instruments.set(instrumentId, found)
      return found
    } catch {
      return null
    }
  }

  /** Remembers an instrument without asking a provider, for restoring a saved watchlist at startup. */
  remember(instrument: Instrument): void {
    this.instruments.set(instrument.instrumentId, instrument)
  }

  // ---------------------------------------------------------------- staleness

  /**
   * Which watched instruments have gone stale.
   *
   * Asked rather than pushed, because staleness is a function of the clock and not of anything arriving -- the whole
   * point is that nothing arrived. A screen that only listened for quotes would keep a green dot over a dead feed for
   * ever.
   */
  staleWatched(): string[] {
    const stale: string[] = []
    for (const { instrumentId } of this.watched()) {
      const quote = this.quotes.get(instrumentId)
      if (!quote) continue
      const parsed = parseInstrumentId(instrumentId)
      const { freshness } = freshnessOf(quote, (parsed?.assetType ?? 'stock') as AssetType, this.now())
      if (freshness === 'stale') stale.push(instrumentId)
    }
    return stale
  }

  /** Everything stopped: streams closed, retries cancelled. The cache is kept, because it is still true. */
  stop(): void {
    if (this.resubscribePending) clearTimeout(this.resubscribePending)
    this.resubscribePending = null
    for (const state of this.streams.values()) {
      state.cancelRetry?.()
      state.cancelRetry = undefined
      state.stop?.()
      state.stop = undefined
      state.connection = 'disconnected'
      state.subscribed = []
    }
  }

  /** A different profile's markets are not this profile's. Everything forgotten. */
  reset(): void {
    this.stop()
    this.watches.clear()
    this.quotes.clear()
    this.candles.clear()
    this.instruments.clear()
    this.tradeWatches.clear()
    this.tape.clear()
    this.universes.clear()
  }
}
