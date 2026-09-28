import type { AssetType, Instrument, Quote } from './instrument.ts'
import type { BookDelta } from './orderbook.ts'
import type {
  Contract,
  Funding,
  FundingPoint,
  Liquidation,
  LongShortRatio,
  MarkIndex,
  OpenInterest,
  OpenInterestPoint
} from './derivatives.ts'
import type { Candle as IndicatorCandle } from './indicators.ts'

/**
 * What a market data provider is.
 *
 * One interface, so the engine above it never knows whose data it is holding, and so a provider can be added, replaced or
 * switched off without any of the rest of Orbis changing. Hard-coding one provider into the application is the mistake
 * this exists to prevent: it makes every screen depend on that provider's fields, its symbols and its outages.
 *
 * **Capabilities are declared, not assumed.** A provider says what it can do, and the engine only asks for what it said.
 * That is what lets an interface offer an options chain where one exists and say "not available from this provider" where
 * it does not -- rather than asking, failing, and showing an empty table that looks like a bug.
 */

export type { Candle } from './indicators.ts'

/** The kinds of data a provider may have. */
export interface ProviderCapabilities {
  /** Which asset types it covers at all. */
  assetTypes: AssetType[]
  /** Whether it streams quotes, or only answers when asked. */
  streaming: boolean
  /** Candle intervals it serves, as `1m`, `1h`, `1d`... Empty means no historical data. */
  intervals: Interval[]
  /** Whether it can be searched for an instrument by name or symbol. */
  search: boolean
  quotes: boolean
  orderBook: boolean
  trades: boolean
  news: boolean
  fundamentals: boolean
  options: boolean
  /**
   * Crypto derivatives extras.
   *
   * Each is a separate flag because the venues differ: one publishes funding and not liquidations, another the reverse.
   * A single `derivatives: true` would promise all of them and let a panel offer something with nothing behind it.
   */
  funding: boolean
  openInterest: boolean
  /** Forced closures, which only a few venues publish as a stream. */
  liquidations: boolean
  /** The prices a venue values positions against. */
  markPrice: boolean
  /** Positioning, and only ever as the venue counts it. */
  longShort: boolean
  /** Dated contracts as well as perpetuals. */
  datedFutures: boolean
  /**
   * How far behind its quotes are, in milliseconds. 0 for real-time.
   *
   * Declared here rather than guessed per quote, because "this feed is fifteen minutes behind" is a fact about the
   * licence, not about any one price.
   */
  delayedByMs: number
  /** Whether it needs a key. A provider that does and has none is reported as unconfigured rather than broken. */
  needsKey?: boolean
  /**
   * Whether it can report every market at once.
   *
   * What movers, a heatmap and a screener need: they are questions about the whole universe, and answering them by asking
   * for one instrument at a time would be thousands of requests to rank a list of ten.
   */
  universe?: boolean
}

export type Interval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w' | '1M'

export const INTERVALS: Interval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M']

/** How long one candle of each interval covers, for working out how much history a request needs. */
export const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
  // Nominal: a month is not a fixed length, and this is only used to size a request.
  '1M': 30 * 24 * 60 * 60_000
}

export interface OrderBookLevel {
  price: number
  size: number
}

export interface OrderBook {
  instrumentId: string
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: number
  source: string
  /**
   * The update this snapshot is current as of, where the venue publishes one.
   *
   * What makes an incremental depth stream safe to apply: without it there is no way to know whether an update belongs
   * before or after the snapshot, and a book built from the two would have a hole in it nobody could see.
   */
  lastUpdateId?: number | null
}

export interface TradePrint {
  instrumentId: string
  price: number
  size: number
  side: 'buy' | 'sell' | 'unknown'
  timestamp: number
}

/**
 * What a stream should carry, beyond quotes for everything it is given.
 *
 * Quotes are what every screen needs, so they are the argument. Trades are what one open panel needs, so they are named
 * separately: subscribing every watched instrument to a trade stream would multiply a twenty-symbol ticker's traffic by
 * the busiest thing on the exchange, to fill a buffer nobody is looking at.
 */
export interface StreamOptions {
  /** The subset that also wants individual trades. Instruments not listed here stream quotes only. */
  trades?: string[]
  /**
   * The subset that wants incremental depth.
   *
   * Named separately for the same reason as trades, and more so: a depth stream on a busy pair is the heaviest thing a
   * venue publishes, and one open order-book panel should not make every watched instrument pay for it.
   */
  depth?: string[]
}

/** Why a request could not be answered. Every one is a fact about the provider, never an invented value. */
export type ProviderErrorCode =
  | 'not-configured'
  | 'unsupported'
  | 'rate-limited'
  | 'unauthorized'
  | 'not-found'
  | 'network'
  | 'bad-response'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly retryAfterMs: number
  constructor(code: ProviderErrorCode, message: string, retryAfterMs = 0) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

/** What a provider tells the engine as data arrives. */
export interface ProviderEvents {
  quote(quote: Quote): void
  orderBook?(book: OrderBook): void
  trade?(print: TradePrint): void
  /** A forced closure the venue published. Only from a provider that declares `liquidations`. */
  liquidation?(event: Liquidation): void
  /** Mark and index prices, which arrive on their own stream rather than with the quote. */
  markIndex?(marks: MarkIndex): void
  /** Funding, where a venue publishes it on the stream rather than only on request. */
  funding?(funding: Funding): void
  /**
   * One incremental change to a book.
   *
   * Separate from `orderBook`, which carries a whole book. A consumer that treated a change as a whole book would show
   * only the levels that happened to move, which looks like a market with almost no depth in it.
   */
  bookDelta?(delta: BookDelta): void
  /** The stream's own state, so the engine can report honestly rather than guessing from silence. */
  status(state: 'connected' | 'disconnected' | 'reconnecting', detail?: string): void
}

export interface MarketProvider {
  /** Stable, lower-case, and part of every instrument id this provider produces. */
  readonly id: string
  readonly name: string
  readonly capabilities: ProviderCapabilities

  /**
   * Whether it is usable right now.
   *
   * A provider that needs a key and has none answers false with `not-configured` -- which the interface shows as
   * "provider not configured", never as a price of zero.
   */
  ready(): { ok: true } | { ok: false; code: ProviderErrorCode; detail: string }

  /** Finds instruments. Only called when `capabilities.search`. */
  search?(query: string, limit: number): Promise<Instrument[]>

  /** One instrument's details by id, for restoring a saved watchlist without searching again. */
  resolve?(instrumentId: string): Promise<Instrument | null>

  /** Quotes now, for instruments this provider owns. Partial answers are fine; missing ones are simply absent. */
  quotes?(instrumentIds: string[]): Promise<Quote[]>

  /** Candles. `limit` is a maximum, not a promise -- a provider with less history returns less. */
  candles?(instrumentId: string, interval: Interval, limit: number): Promise<IndicatorCandle[]>

  orderBook?(instrumentId: string, depth: number): Promise<OrderBook>

  /**
   * Every market this provider serves, with its current statistics. Only called when `capabilities.universe`.
   *
   * One request for the lot. The quotes it returns are ordinary quotes and go through the same validation as any other, so
   * a screener ranks the same numbers a chart draws.
   */
  universe?(): Promise<{ instrument: Instrument; quote: Quote }[]>

  /**
   * The most recent trades, oldest first. Only called when `capabilities.trades`.
   *
   * Used to fill a tape the moment it opens, so it is not blank until the market happens to trade. The stream takes over
   * from there.
   */
  trades?(instrumentId: string, limit: number): Promise<TradePrint[]>

  /**
   * Starts streaming the given instruments, replacing any previous set.
   *
   * Replacing rather than adding, so the engine can hand over exactly what is wanted now and the provider can work out
   * the smallest change to its own subscriptions. Returns a function that stops everything.
   */
  stream?(instrumentIds: string[], events: ProviderEvents, options?: StreamOptions): Promise<() => void>

  // ---------------------------------------------------------------- derivatives
  //
  // Optional, and each gated by its own capability. A provider that serves spot markets implements none of them, and the
  // interface asks for none -- which is how a derivatives panel can be absent rather than empty.

  /** Every contract this provider serves, with the venue's own metadata. Only called when `datedFutures` or `funding`. */
  contracts?(): Promise<Contract[]>

  /** Funding now, for the contracts asked about. Only called when `capabilities.funding`. */
  funding?(instrumentIds: string[]): Promise<Funding[]>

  /** Past funding payments, newest last. */
  fundingHistory?(instrumentId: string, limit: number): Promise<FundingPoint[]>

  /** Open interest now. Only called when `capabilities.openInterest`. */
  openInterest?(instrumentIds: string[]): Promise<OpenInterest[]>

  /** Past open interest, newest last. */
  openInterestHistory?(instrumentId: string, windowMs: number, limit: number): Promise<OpenInterestPoint[]>

  /** Mark, index and settlement prices. Only called when `capabilities.markPrice`. */
  markIndex?(instrumentIds: string[]): Promise<MarkIndex[]>

  /** Positioning as the venue counts it. Only called when `capabilities.longShort`. */
  longShort?(instrumentId: string, windowMs: number, limit: number): Promise<LongShortRatio[]>

  /** Recent forced closures, to fill a panel before the stream delivers the next one. */
  liquidations?(instrumentId: string, limit: number): Promise<Liquidation[]>
}

/** A provider's own account of itself, for the settings screen and the status panel. */
export interface ProviderStatus {
  id: string
  name: string
  configured: boolean
  /** Null when it has never connected, which is different from disconnected. */
  connection: 'connected' | 'disconnected' | 'reconnecting' | null
  detail: string
  capabilities: ProviderCapabilities
  /** How many instruments it is streaming for us. */
  subscriptions: number
  lastUpdateAt: number | null
  /** Quotes that arrived and were dropped as duplicates or out of order. Worth seeing when something looks wrong. */
  droppedEvents: number
  reconnects: number
}

/**
 * What a provider can honestly be asked for, given what it declared and whether it is configured.
 *
 * Used to decide what the interface offers. A capability an unconfigured provider declares is not a capability anybody
 * has, which is why `ready()` is part of this rather than checked separately and forgotten somewhere.
 */
export function availableFrom(provider: MarketProvider): Partial<Record<keyof ProviderCapabilities, boolean>> {
  const ready = provider.ready()
  if (!ready.ok) return {}
  const c = provider.capabilities
  return {
    streaming: c.streaming && typeof provider.stream === 'function',
    search: c.search && typeof provider.search === 'function',
    quotes: c.quotes && typeof provider.quotes === 'function',
    orderBook: c.orderBook && typeof provider.orderBook === 'function',
    news: c.news,
    fundamentals: c.fundamentals,
    options: c.options,
    // The method as well as the flag, for every one of these. A capability declared true with nothing behind it is
    // exactly how a panel comes to promise funding it can never show.
    funding: c.funding && typeof provider.funding === 'function',
    openInterest: c.openInterest && typeof provider.openInterest === 'function',
    liquidations: c.liquidations && typeof provider.liquidations === 'function',
    markPrice: c.markPrice && typeof provider.markIndex === 'function',
    longShort: c.longShort && typeof provider.longShort === 'function',
    datedFutures: c.datedFutures && typeof provider.contracts === 'function',
    universe: Boolean(c.universe) && typeof provider.universe === 'function',
    // The method, not only the flag. A capability declared true with nothing behind it is how a panel comes to offer a
    // tape that can never fill.
    trades: c.trades && typeof provider.trades === 'function'
  }
}

/** Whether a provider declares an interval and can actually serve candles. */
export const servesInterval = (provider: MarketProvider, interval: Interval): boolean =>
  provider.ready().ok && typeof provider.candles === 'function' && provider.capabilities.intervals.includes(interval)

/** A provider that serves a given asset type, for choosing which to ask. */
export const servesAsset = (provider: MarketProvider, assetType: AssetType): boolean =>
  provider.ready().ok && provider.capabilities.assetTypes.includes(assetType)
