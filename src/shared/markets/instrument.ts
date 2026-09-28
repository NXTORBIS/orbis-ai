/**
 * What a tradable thing is, and what a price is, in one shape.
 *
 * Every provider has its own idea of both. Binance says `BTCUSDT`, Coinbase says `BTC-USD`, an exchange feed says
 * `NVDA` and so does a different exchange listing a different company. So nothing outside a provider adapter ever sees a
 * provider's own shape: adapters normalise into these types, and the rest of Orbis only knows these.
 *
 * **A symbol is not an identity.** `NVDA` on NASDAQ and `NVDA` as a contract-for-difference are different instruments
 * with different prices, and `BTC` means a dozen things. An instrument is identified by what it is *and* where it is
 * traded and in what currency and by whom -- which is what `instrumentId` encodes. Treating a symbol as unique is the
 * mistake that shows two prices for the same row and leaves nobody able to say which is right.
 */

export type AssetType =
  | 'stock'
  | 'etf'
  | 'index'
  | 'crypto'
  | 'option'
  | 'future'
  | 'forex'
  | 'commodity'
  | 'economic'

export const ASSET_TYPES: AssetType[] = [
  'stock',
  'etf',
  'index',
  'crypto',
  'option',
  'future',
  'forex',
  'commodity',
  'economic'
]

/**
 * How fresh a number is, as the person is told.
 *
 * Four states, and the distinctions matter more than they look:
 *
 *   `real-time`   the provider streams it and it just arrived
 *   `delayed`     the provider only sells it late (most free stock feeds are fifteen minutes behind)
 *   `stale`       it arrived, but too long ago to be trusted as current
 *   `unavailable` there is no number
 *
 * `delayed` is not a degraded `real-time` -- it is a different promise, and a feed that is fifteen minutes behind is
 * fifteen minutes behind however recently it updated. Collapsing the two is how an interface comes to show a green
 * "Live" dot over a price from a quarter of an hour ago.
 */
export type Freshness = 'real-time' | 'delayed' | 'stale' | 'unavailable'

/** Whether the place this trades is open, by its own calendar. */
export type MarketStatus = 'open' | 'closed' | 'pre-market' | 'after-hours' | 'always-open' | 'unknown'

export interface Instrument {
  /**
   * The one identity. `{provider}:{assetType}:{exchange}:{symbol}`, lower-cased.
   *
   * Built by `instrumentId` and never assembled by hand, so that two parts of Orbis asking about the same thing agree
   * about what "the same thing" is.
   */
  instrumentId: string
  /** What the provider calls it, as it calls it -- for showing, and for asking the provider again. */
  symbol: string
  /** What a person calls it. Empty when the provider does not say. */
  name: string
  assetType: AssetType
  /** Where it trades. `''` for things that have no exchange, like a currency pair quoted by a bank. */
  exchange: string
  /** What its price is in. Empty when the provider does not say, which is honest and not the same as USD. */
  currency: string
  /** Which provider this instrument and its quotes come from. */
  provider: string
  /** Anything provider-specific a screen may want, kept out of the fields above so they stay comparable. */
  metadata?: Record<string, unknown>
}

/** A price, with everything needed to know whether to believe it. */
export interface Quote {
  instrumentId: string
  /** The last traded price, or null when the provider has none. Never 0 as a stand-in for "unknown". */
  last: number | null
  /** The previous close, which is what a change is measured against. */
  previousClose: number | null
  change: number | null
  changePercent: number | null
  bid: number | null
  ask: number | null
  /** Volume in the instrument's own units over the provider's own window. */
  volume: number | null
  /**
   * The value traded over the same window, in the quote currency, when the provider reports it.
   *
   * Kept separate from `volume` because they are different units and confusing them is how a heatmap comes to size BTC by
   * the number of coins that changed hands and SHIB by the number of tokens. Null where the provider does not say.
   */
  quoteVolume?: number | null
  dayHigh: number | null
  dayLow: number | null
  /** When the provider says this was true, in milliseconds. Not when we received it. */
  timestamp: number
  /** Whether the provider's own feed is behind, and by how much it says. */
  delayedByMs: number
  marketStatus: MarketStatus
  /** Which provider said so, so a screen can say where a number came from. */
  source: string
}

/** Everything a screen needs to draw one row honestly. */
export interface QuoteView extends Quote {
  freshness: Freshness
  /** How long ago the provider's timestamp was, at the moment this was worked out. */
  ageMs: number
}

const clean = (part: string): string => part.replace(/[^a-z0-9._/-]+/gi, '').toLowerCase()

/**
 * The identity of an instrument.
 *
 * Deliberately not just the symbol. Two exchanges can list the same ticker for different companies, the same crypto pair
 * trades at different prices on different venues, and a provider may quote something nobody else does. All four parts are
 * needed for two answers about "the same instrument" to really be about the same instrument.
 */
export function instrumentId(parts: {
  provider: string
  assetType: AssetType
  exchange: string
  symbol: string
}): string {
  return [clean(parts.provider), clean(parts.assetType), clean(parts.exchange), clean(parts.symbol)].join(':')
}

/** Reads an id back apart, for a log or an error message. Null when it is not one. */
export function parseInstrumentId(
  id: string
): { provider: string; assetType: string; exchange: string; symbol: string } | null {
  const parts = id.split(':')
  if (parts.length !== 4 || parts.some((p) => p === '')) return null
  return { provider: parts[0], assetType: parts[1], exchange: parts[2], symbol: parts[3] }
}

/**
 * How long a quote may be old before it is stale, by asset type.
 *
 * Not one number, because the asset types are not alike. A crypto pair that has not ticked in a minute has probably
 * stopped arriving; a small-cap stock may legitimately not trade for ten minutes; an economic figure is monthly and is
 * not stale the day after it is published. A single threshold either cries stale about a quiet stock or never notices a
 * dead crypto stream.
 */
export const STALE_AFTER_MS: Record<AssetType, number> = {
  crypto: 60_000,
  forex: 60_000,
  future: 2 * 60_000,
  option: 5 * 60_000,
  stock: 10 * 60_000,
  etf: 10 * 60_000,
  index: 10 * 60_000,
  commodity: 10 * 60_000,
  // Published on a schedule, not traded. A month-old figure is the current figure.
  economic: 40 * 24 * 60 * 60 * 1000
}

/**
 * How fresh a quote is, now.
 *
 * The order of the checks is the whole of it:
 *
 *   no number at all            -> unavailable
 *   older than its type allows  -> stale
 *   the provider is behind      -> delayed
 *   otherwise                   -> real-time
 *
 * Stale is checked before delayed because a delayed feed that has also stopped arriving is stale, and saying "delayed"
 * about it would be saying the smaller of two problems. A market that is closed is not stale -- the last price of the day
 * is the current price until the market opens again -- which is why `marketStatus` is taken into account.
 */
export function freshnessOf(
  quote: Pick<Quote, 'last' | 'timestamp' | 'delayedByMs' | 'marketStatus'>,
  assetType: AssetType,
  now: number
): { freshness: Freshness; ageMs: number } {
  const ageMs = Math.max(0, now - quote.timestamp)
  if (quote.last === null || !Number.isFinite(quote.timestamp) || quote.timestamp <= 0) {
    return { freshness: 'unavailable', ageMs }
  }
  // A closed market is not a broken feed. The last trade of the session stays the price.
  const closed = quote.marketStatus === 'closed' || quote.marketStatus === 'pre-market' || quote.marketStatus === 'after-hours'
  if (!closed && ageMs > STALE_AFTER_MS[assetType]) return { freshness: 'stale', ageMs }
  if (quote.delayedByMs > 0) return { freshness: 'delayed', ageMs }
  return { freshness: 'real-time', ageMs }
}

/** A quote with its freshness worked out. The one way a screen should get a quote. */
export function viewOf(quote: Quote, assetType: AssetType, now: number): QuoteView {
  const { freshness, ageMs } = freshnessOf(quote, assetType, now)
  return { ...quote, freshness, ageMs }
}

/** What a person is shown about freshness. Never colour alone, so this carries the words. */
export const FRESHNESS_LABEL: Record<Freshness, string> = {
  'real-time': 'Live',
  delayed: 'Delayed',
  stale: 'Stale',
  unavailable: 'Unavailable'
}

/** A sentence about why a number looks the way it does, for a tooltip. */
export function explainFreshness(view: Pick<QuoteView, 'freshness' | 'ageMs' | 'delayedByMs' | 'source'>): string {
  const ago = describeAge(view.ageMs)
  switch (view.freshness) {
    case 'real-time':
      return `Live from ${view.source}, ${ago}.`
    case 'delayed':
      return `${view.source} provides this ${describeAge(view.delayedByMs)} behind the market. Last value ${ago}.`
    case 'stale':
      return `Nothing new from ${view.source} for ${ago}. This is the last value, not the current one.`
    case 'unavailable':
      return `${view.source} has no value for this.`
  }
}

/** A duration as a person would say it. */
export function describeAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'an unknown time ago'
  const seconds = Math.round(ms / 1000)
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/**
 * A change worked out from a price and a previous close.
 *
 * Here rather than in each provider adapter, because a provider that reports a change and a provider that reports only a
 * price should produce the same numbers. Returns nulls rather than zeros when it cannot be worked out: a change of zero
 * is a real thing a price can do, and it must not be confused with not knowing.
 */
export function changeFrom(
  last: number | null,
  previousClose: number | null
): { change: number | null; changePercent: number | null } {
  if (last === null || previousClose === null || !Number.isFinite(last) || !Number.isFinite(previousClose)) {
    return { change: null, changePercent: null }
  }
  const change = last - previousClose
  if (previousClose === 0) return { change, changePercent: null }
  return { change, changePercent: (change / previousClose) * 100 }
}
