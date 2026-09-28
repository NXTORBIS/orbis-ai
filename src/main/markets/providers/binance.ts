import { changeFrom, instrumentId, type Instrument, type Quote } from '../../../shared/markets/instrument.ts'
import {
  ProviderError,
  type Candle,
  type Interval,
  type MarketProvider,
  type OrderBook,
  type ProviderCapabilities,
  type ProviderEvents,
  type StreamOptions,
  type TradePrint
} from '../../../shared/markets/provider.ts'

/**
 * Real crypto market data, from Binance's public endpoints.
 *
 * Chosen because it needs no key and no account: the market-data endpoints used here are the documented public ones, which
 * means Orbis can show real prices the first time it is opened rather than an empty screen with a note about configuring a
 * provider. Everything shown comes from this feed; nothing is filled in.
 *
 * What it does **not** do: anything that needs an account. No orders, no balances, no signed requests. There is no API key
 * anywhere in this file and no place to put one, which is the simplest way to be sure none is ever sent.
 *
 * Two honest limitations, both reported rather than hidden:
 *
 *  - Binance is unreachable from some places. When it is, this provider reports itself disconnected and no price appears.
 *  - Its prices are its own. `BTCUSDT` here is Binance's market, not a global average, and the instrument id says so --
 *    which is why a price from here is never merged with one from anywhere else.
 */

const REST = 'https://api.binance.com'
const STREAM = 'wss://stream.binance.com:9443/stream'

/** The intervals Binance serves that Orbis names. Its `3m`, `2h` and so on are simply not offered. */
const INTERVAL_NAMES: Record<Interval, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
  '1M': '1M'
}

export interface BinanceOptions {
  /** Replaceable so tests need no network. */
  fetchFn?: typeof fetch
  /** Replaceable for the same reason. Given the URL, returns something that behaves like a WebSocket. */
  socketFor?(url: string): SocketLike
  now?(): number
}

/** The little of a WebSocket this needs, so a test can be one. */
export interface SocketLike {
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: unknown) => void): void
  close(): void
  send?(data: string): void
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Binance's symbol for an Orbis instrument id, or null when the id is not one of ours. */
const symbolOf = (id: string): string | null => {
  const parts = id.split(':')
  if (parts.length !== 4 || parts[0] !== 'binance') return null
  return parts[3].toUpperCase()
}

const idFor = (symbol: string): string =>
  instrumentId({ provider: 'binance', assetType: 'crypto', exchange: 'binance', symbol })

/**
 * Price/size pairs from a depth message.
 *
 * A size of zero is kept rather than filtered: it is the venue saying that level is gone, and dropping it would leave the
 * level on screen for ever. The keeper is what turns a zero into a removal.
 */
const levelsFrom = (raw: unknown): { price: number; size: number }[] => {
  if (!Array.isArray(raw)) return []
  const out: { price: number; size: number }[] = []
  for (const pair of raw) {
    if (!Array.isArray(pair)) continue
    const price = num(pair[0])
    const size = num(pair[1])
    if (price === null || size === null || price <= 0 || size < 0) continue
    out.push({ price, size })
  }
  return out
}

export class BinanceProvider implements MarketProvider {
  readonly id = 'binance'
  readonly name = 'Binance'
  readonly capabilities: ProviderCapabilities = {
    assetTypes: ['crypto'],
    streaming: true,
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
    search: true,
    quotes: true,
    orderBook: true,
    trades: true,
    news: false,
    fundamentals: false,
    options: false,
    // Spot has none of these. They come from Binance's futures API, which is a different host with different symbols --
    // and so a different provider, registered beside this one rather than folded into it.
    funding: false,
    openInterest: false,
    liquidations: false,
    markPrice: false,
    longShort: false,
    datedFutures: false,
    // Its public market data is live.
    delayedByMs: 0,
    // One request reports every pair's last 24 hours, which is what a heatmap, a movers list and a screener are asking.
    universe: true
  }

  private readonly fetchFn: typeof fetch
  private readonly socketFor: (url: string) => SocketLike
  private readonly now: () => number
  /** Every tradable symbol, fetched once, so searching does not hit the network per keystroke. */
  private symbols: { symbol: string; base: string; quote: string }[] | null = null
  private symbolsAt = 0

  constructor(options: BinanceOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init))
    this.socketFor =
      options.socketFor ?? ((url) => new WebSocket(url) as unknown as SocketLike)
    this.now = options.now ?? Date.now
  }

  /** Always usable: there is nothing to configure. Whether it is *reachable* is a separate question the engine reports. */
  ready(): { ok: true } | { ok: false; code: 'not-configured'; detail: string } {
    return { ok: true }
  }

  private async get<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetchFn(`${REST}${path}`, { headers: { Accept: 'application/json' } })
    } catch {
      throw new ProviderError('network', 'Binance could not be reached from this computer.')
    }
    if (response.status === 429 || response.status === 418) {
      // Binance says how long in a header; honoured rather than guessed, because guessing is how a ban is earned.
      const after = Number(response.headers.get('retry-after') ?? '0')
      throw new ProviderError('rate-limited', 'Binance asked Orbis to slow down.', (after || 60) * 1000)
    }
    if (response.status === 451 || response.status === 403) {
      throw new ProviderError('unauthorized', 'Binance does not serve market data to this location.')
    }
    if (!response.ok) throw new ProviderError('bad-response', `Binance answered ${response.status}.`)
    try {
      return (await response.json()) as T
    } catch {
      throw new ProviderError('bad-response', 'Binance sent something that was not the expected data.')
    }
  }

  // ---------------------------------------------------------------- instruments

  private async allSymbols(): Promise<{ symbol: string; base: string; quote: string }[]> {
    // Kept for an hour. The list of tradable pairs changes over days, not seconds.
    if (this.symbols && this.now() - this.symbolsAt < 60 * 60_000) return this.symbols
    const info = await this.get<{ symbols: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[] }>(
      '/api/v3/exchangeInfo'
    )
    this.symbols = (info.symbols ?? [])
      .filter((s) => s.status === 'TRADING')
      .map((s) => ({ symbol: s.symbol, base: s.baseAsset, quote: s.quoteAsset }))
    this.symbolsAt = this.now()
    return this.symbols
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const typed = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!typed) return []
    // A name people use, or the ticker itself. Both are looked up the same way afterwards.
    const wanted = NAMES[typed.toLowerCase()] ?? typed
    const all = await this.allSymbols()
    // Exact base asset first, then anything containing it -- so "BTC" finds BTCUSDT before it finds WBTCETH.
    const scored = all
      .map((s) => ({
        s,
        score: s.base === wanted ? 0 : s.symbol === wanted ? 1 : s.base.startsWith(wanted) ? 2 : s.symbol.includes(wanted) ? 3 : 99
      }))
      .filter((r) => r.score < 99)
      // Among equals, prefer the pairs people actually quote in.
      .sort((a, b) => a.score - b.score || rankQuote(a.s.quote) - rankQuote(b.s.quote) || a.s.symbol.localeCompare(b.s.symbol))
      .slice(0, limit)
    return scored.map(({ s }) => ({
      instrumentId: idFor(s.symbol),
      symbol: s.symbol,
      name: `${s.base} / ${s.quote}`,
      assetType: 'crypto' as const,
      exchange: 'binance',
      currency: s.quote,
      provider: this.id,
      metadata: { base: s.base, quote: s.quote }
    }))
  }

  async resolve(id: string): Promise<Instrument | null> {
    const symbol = symbolOf(id)
    if (!symbol) return null
    const found = (await this.allSymbols()).find((s) => s.symbol === symbol)
    if (!found) return null
    return {
      instrumentId: id,
      symbol: found.symbol,
      name: `${found.base} / ${found.quote}`,
      assetType: 'crypto',
      exchange: 'binance',
      currency: found.quote,
      provider: this.id,
      metadata: { base: found.base, quote: found.quote }
    }
  }

  // ---------------------------------------------------------------- quotes

  async quotes(instrumentIds: string[]): Promise<Quote[]> {
    const symbols = instrumentIds.map(symbolOf).filter((s): s is string => s !== null)
    if (symbols.length === 0) return []
    // One request for all of them. Asking per symbol is what uses up a rate limit on a watchlist of forty.
    const path =
      symbols.length === 1
        ? `/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbols[0])}`
        : `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`
    const raw = await this.get<unknown>(path)
    const rows = Array.isArray(raw) ? raw : [raw]
    return rows.map((row) => this.quoteFrom(row as Record<string, unknown>)).filter((q): q is Quote => q !== null)
  }

  /**
   * Every trading pair, with its last 24 hours.
   *
   * `/ticker/24hr` with no symbol answers for the whole exchange in one response. It is a large answer and a heavy one
   * against the rate limit, which is why the engine caches it rather than asking per screen -- but it is one request for a
   * question about thousands of markets, and the alternative is thousands of requests.
   *
   * Rows whose symbol is not a currently trading pair are dropped: the ticker endpoint still reports pairs that
   * `exchangeInfo` no longer lists as trading, and ranking a delisted market alongside live ones would be a real number
   * about a market nobody can trade.
   */
  async universe(): Promise<{ instrument: Instrument; quote: Quote }[]> {
    const [rows, symbols] = await Promise.all([
      this.get<unknown>('/api/v3/ticker/24hr'),
      this.allSymbols()
    ])
    const known = new Map(symbols.map((s) => [s.symbol, s]))
    const out: { instrument: Instrument; quote: Quote }[] = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const record = row as Record<string, unknown>
      const symbol = typeof record.symbol === 'string' ? record.symbol : ''
      const meta = known.get(symbol)
      if (!meta) continue
      const quote = this.quoteFrom(record)
      // No price is no row. A market in the list with a dash where its price should be is not a market worth ranking.
      if (!quote || quote.last === null) continue
      out.push({
        instrument: {
          instrumentId: quote.instrumentId,
          symbol: meta.symbol,
          name: `${meta.base} / ${meta.quote}`,
          assetType: 'crypto',
          exchange: 'binance',
          currency: meta.quote,
          provider: this.id,
          metadata: { base: meta.base, quote: meta.quote }
        },
        quote
      })
    }
    return out
  }

  private quoteFrom(row: Record<string, unknown>): Quote | null {
    const symbol = typeof row.symbol === 'string' ? row.symbol : null
    if (!symbol) return null
    const last = num(row.lastPrice)
    const previousClose = num(row.prevClosePrice)
    const derived = changeFrom(last, previousClose)
    return {
      instrumentId: idFor(symbol),
      last,
      previousClose,
      // Binance reports both; its own figures are used where they exist and worked out where they do not, so the two
      // never disagree on screen.
      change: num(row.priceChange) ?? derived.change,
      changePercent: num(row.priceChangePercent) ?? derived.changePercent,
      bid: num(row.bidPrice),
      ask: num(row.askPrice),
      volume: num(row.volume),
      // Binance reports both the base-asset volume and the value traded. The value is what makes two different pairs
      // comparable, so it is carried rather than discarded and is labelled as quote volume wherever it is shown.
      quoteVolume: num(row.quoteVolume),
      dayHigh: num(row.highPrice),
      dayLow: num(row.lowPrice),
      timestamp: num(row.closeTime) ?? this.now(),
      delayedByMs: 0,
      marketStatus: 'always-open',
      source: this.name
    }
  }

  // ---------------------------------------------------------------- history

  async candles(id: string, interval: Interval, limit: number): Promise<Candle[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const name = INTERVAL_NAMES[interval]
    if (!name) throw new ProviderError('unsupported', `Binance does not serve ${interval} candles.`)
    const rows = await this.get<unknown[]>(
      `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${name}&limit=${Math.min(1000, Math.max(1, limit))}`
    )
    const out: Candle[] = []
    for (const row of rows) {
      if (!Array.isArray(row)) continue
      const time = num(row[0])
      const open = num(row[1])
      const high = num(row[2])
      const low = num(row[3])
      const close = num(row[4])
      // A candle missing any of its prices is not a candle. Dropped rather than filled in with a neighbour's value.
      if (time === null || open === null || high === null || low === null || close === null) continue
      out.push({ time, open, high, low, close, volume: num(row[5]) })
    }
    return out
  }

  async orderBook(id: string, depth: number): Promise<OrderBook> {
    const symbol = symbolOf(id)
    if (!symbol) throw new ProviderError('not-found', 'That is not a Binance instrument.')
    // Binance only serves certain depths; the nearest one at or above what was asked for.
    const allowed = [5, 10, 20, 50, 100, 500, 1000]
    const want = allowed.find((n) => n >= depth) ?? 100
    const book = await this.get<{ bids: [string, string][]; asks: [string, string][]; lastUpdateId: number }>(
      `/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=${want}`
    )
    const level = (pair: [string, string]): { price: number; size: number } | null => {
      const price = num(pair[0])
      const size = num(pair[1])
      return price === null || size === null ? null : { price, size }
    }
    return {
      instrumentId: id,
      // The id the snapshot is current as of. What makes an incremental depth stream safe to apply on top of it: without
      // it there is no way to know which updates the snapshot already includes.
      lastUpdateId: num(book.lastUpdateId),
      bids: (book.bids ?? []).map(level).filter((l): l is { price: number; size: number } => l !== null).slice(0, depth),
      asks: (book.asks ?? []).map(level).filter((l): l is { price: number; size: number } => l !== null).slice(0, depth),
      // Binance's depth response carries no time of its own; when it was received is the honest answer and is what the
      // interface shows beside it.
      timestamp: this.now(),
      source: this.name
    }
  }

  /**
   * The most recent trades for one pair.
   *
   * Binance's `/trades` gives the last N prints with a flag saying whether the buyer was the maker. That flag is what
   * makes the aggressor knowable: if the buyer was sitting on the book, the trade happened because a seller crossed the
   * spread. So the side here is derived from what the exchange reported, not guessed from whether the price moved up.
   */
  async trades(id: string, limit: number): Promise<TradePrint[]> {
    const symbol = symbolOf(id)
    if (!symbol) throw new ProviderError('not-found', 'That is not a Binance instrument.')
    const want = Math.min(1000, Math.max(1, Math.round(limit)))
    const rows = await this.get<{ price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(
      `/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=${want}`
    )
    const prints: TradePrint[] = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const price = num(row.price)
      const size = num(row.qty)
      const timestamp = num(row.time)
      // A trade with no price or no size is not a trade. Dropped rather than rendered as a zero.
      if (price === null || size === null || timestamp === null || price <= 0 || size <= 0) continue
      prints.push({
        instrumentId: id,
        price,
        size,
        side: typeof row.isBuyerMaker === 'boolean' ? (row.isBuyerMaker ? 'sell' : 'buy') : 'unknown',
        timestamp
      })
    }
    // Oldest first, so a tape can append newer ones as they stream in.
    return prints.sort((a, b) => a.timestamp - b.timestamp)
  }

  // ---------------------------------------------------------------- streaming

  /**
   * One socket for everything being watched.
   *
   * Binance's combined stream takes the whole list in the URL, so changing what is watched means a new socket -- which is
   * why the engine hands over the complete set rather than adding and removing. One socket for forty instruments instead of
   * forty sockets is the difference between a working watchlist and a rate limit.
   */
  async stream(instrumentIds: string[], events: ProviderEvents, options: StreamOptions = {}): Promise<() => void> {
    const symbols = instrumentIds.map(symbolOf).filter((s): s is string => s !== null)
    if (symbols.length === 0) {
      events.status('disconnected', 'Nothing to stream.')
      return () => undefined
    }
    // Trades only for what asked for them. An `@aggTrade` subscription on a busy pair delivers several messages a second
    // whether or not a tape is open, so the ticker's twenty symbols stay on `@ticker` alone.
    const wantsTrades = new Set(
      (options.trades ?? []).map(symbolOf).filter((s): s is string => s !== null && symbols.includes(s))
    )
    // Depth is heavier still -- a busy pair publishes a diff every hundred milliseconds -- so it is subscribed only for
    // the instruments with a book open.
    const wantsDepth = new Set(
      (options.depth ?? []).map(symbolOf).filter((s): s is string => s !== null && symbols.includes(s))
    )
    const names = symbols.map((s) => `${s.toLowerCase()}@ticker`)
    for (const symbol of wantsTrades) names.push(`${symbol.toLowerCase()}@aggTrade`)
    for (const symbol of wantsDepth) names.push(`${symbol.toLowerCase()}@depth@100ms`)
    const socket = this.socketFor(`${STREAM}?streams=${names.join('/')}`)
    let closed = false

    socket.addEventListener('open', () => {
      if (!closed) {
        const parts: string[] = []
        if (wantsTrades.size > 0) parts.push(`${wantsTrades.size} with trades`)
        if (wantsDepth.size > 0) parts.push(`${wantsDepth.size} with depth`)
        const extra = parts.length > 0 ? `, ${parts.join(' and ')}` : ''
        events.status('connected', `Streaming ${symbols.length} pairs from Binance${extra}.`)
      }
    })
    socket.addEventListener('message', (event) => {
      if (closed) return
      const data = (event as { data?: unknown }).data
      if (typeof data !== 'string') return
      let parsed: unknown
      try {
        parsed = JSON.parse(data)
      } catch {
        return
      }
      const payload = (parsed as { data?: Record<string, unknown> }).data
      if (!payload) return

      // One socket carries both kinds of message, so which one this is decides how it is read. Anything else Binance
      // sends is left alone rather than being forced through a parser that was written for something else.
      if (payload.e === 'depthUpdate') {
        const symbol = typeof payload.s === 'string' ? payload.s.toUpperCase() : ''
        const first = num(payload.U)
        const last = num(payload.u)
        if (!symbol || first === null || last === null) return
        // `U` and `u` are the range of updates this message covers. The keeper checks them against what it holds, and a
        // message that would leave a gap is refused rather than applied over the hole.
        events.bookDelta?.({
          instrumentId: idFor(symbol),
          firstUpdateId: first,
          lastUpdateId: last,
          bids: levelsFrom(payload.b),
          asks: levelsFrom(payload.a),
          timestamp: num(payload.E) ?? this.now()
        })
        return
      }

      if (payload.e === 'aggTrade') {
        const symbol = typeof payload.s === 'string' ? payload.s.toUpperCase() : ''
        const price = num(payload.p)
        const size = num(payload.q)
        const timestamp = num(payload.T)
        if (!symbol || price === null || size === null || timestamp === null || price <= 0 || size <= 0) return
        events.trade?.({
          instrumentId: idFor(symbol),
          price,
          size,
          // `m` is Binance's "was the buyer the maker": true means a seller crossed the spread.
          side: typeof payload.m === 'boolean' ? (payload.m ? 'sell' : 'buy') : 'unknown',
          timestamp
        })
        return
      }

      // The ticker stream names its fields differently from the REST endpoint. Mapped rather than assumed.
      const quote = this.quoteFrom({
        symbol: payload.s,
        lastPrice: payload.c,
        prevClosePrice: payload.x,
        priceChange: payload.p,
        priceChangePercent: payload.P,
        bidPrice: payload.b,
        askPrice: payload.a,
        volume: payload.v,
        highPrice: payload.h,
        lowPrice: payload.l,
        closeTime: payload.E
      })
      if (quote) events.quote(quote)
    })
    socket.addEventListener('close', () => {
      if (!closed) events.status('disconnected', 'Binance closed the connection.')
    })
    socket.addEventListener('error', () => {
      if (!closed) events.status('disconnected', 'The connection to Binance failed.')
    })

    return () => {
      closed = true
      try {
        socket.close()
      } catch {
        // Already gone.
      }
    }
  }
}

/**
 * What people call these assets, mapped to what Binance calls them.
 *
 * Binance's instrument list has base assets -- `BTC`, `ETH` -- and no names, so searching "bitcoin" found nothing at all.
 * A name is a fact about an asset, not market data, so writing it down here invents nothing: every price still comes from
 * the feed, and this only decides which symbol a word looks up.
 *
 * Deliberately short. It covers the assets somebody is likely to type the name of; anything else is still found by its
 * ticker, which is how the rest of the list works.
 */
const NAMES: Record<string, string> = {
  bitcoin: 'BTC',
  ether: 'ETH',
  ethereum: 'ETH',
  solana: 'SOL',
  ripple: 'XRP',
  cardano: 'ADA',
  dogecoin: 'DOGE',
  polkadot: 'DOT',
  litecoin: 'LTC',
  chainlink: 'LINK',
  avalanche: 'AVAX',
  polygon: 'POL',
  tron: 'TRX',
  binancecoin: 'BNB',
  stellar: 'XLM',
  monero: 'XMR',
  cosmos: 'ATOM',
  uniswap: 'UNI',
  aave: 'AAVE',
  tether: 'USDT',
  arbitrum: 'ARB',
  optimism: 'OP',
  sui: 'SUI',
  aptos: 'APT',
  near: 'NEAR',
  filecoin: 'FIL',
  hedera: 'HBAR',
  shibainu: 'SHIB',
  pepe: 'PEPE',
  toncoin: 'TON'
}

/** Which quote currencies to prefer in search results: the ones people actually price things in. */
function rankQuote(quote: string): number {
  const order = ['USDT', 'USDC', 'FDUSD', 'USD', 'BTC', 'ETH', 'EUR', 'TRY', 'BNB']
  const at = order.indexOf(quote)
  return at === -1 ? order.length : at
}
