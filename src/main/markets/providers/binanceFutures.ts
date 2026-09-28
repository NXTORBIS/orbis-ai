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
import type {
  Contract,
  Funding,
  FundingPoint,
  Liquidation,
  LongShortRatio,
  MarkIndex,
  OpenInterest,
  OpenInterestPoint
} from '../../../shared/markets/derivatives.ts'
import type { SocketLike } from './binance.ts'

/**
 * Binance's USD-margined futures, from its public endpoints.
 *
 * A **separate provider** from the spot one, deliberately. It is a different host, a different universe of symbols and a
 * different set of prices: `BTCUSDT` here is a perpetual contract, and its price is not the spot price. Folding the two
 * into one provider would make that distinction a field somebody has to remember to check, instead of an instrument id
 * that cannot be confused.
 *
 * Every instrument this produces is prefixed `binance-futures`, so a watchlist, a chart, an alert or a paper position can
 * never quietly refer to the other market.
 *
 * Keyless, like the spot provider. Funding, open interest, mark and index prices, liquidations and the venue's own
 * long/short counts are all public. There is no API key in this file, no signed request, and nowhere to put one.
 *
 * Two limitations, both declared rather than worked around:
 *
 *  - Coin-margined contracts (`dapi`) are a third host again. Not served here, and not declared.
 *  - The liquidation stream is the venue's `forceOrder` feed. It publishes forced orders as they happen and has no
 *    history endpoint, so a liquidation panel opens empty and fills as events arrive. Said on the panel rather than
 *    back-filled from something else.
 */

const REST = 'https://fapi.binance.com'
const STREAM = 'wss://fstream.binance.com/stream'

const PROVIDER = 'binance-futures'

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

/** The periods Binance's open-interest history serves. Anything else is answered from the nearest it has. */
const OI_PERIODS: { ms: number; name: string }[] = [
  { ms: 5 * 60_000, name: '5m' },
  { ms: 15 * 60_000, name: '15m' },
  { ms: 30 * 60_000, name: '30m' },
  { ms: 60 * 60_000, name: '1h' },
  { ms: 4 * 60 * 60_000, name: '4h' },
  { ms: 24 * 60 * 60_000, name: '1d' }
]

/** The period whose bars best cover a window in the number of points asked for. */
const periodFor = (windowMs: number, limit: number): string => {
  const wanted = windowMs / Math.max(1, limit)
  let best = OI_PERIODS[0]
  for (const one of OI_PERIODS) if (one.ms <= wanted) best = one
  return best.name
}

export interface BinanceFuturesOptions {
  fetchFn?: typeof fetch
  socketFor?(url: string): SocketLike
  now?(): number
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

const positive = (value: unknown): number | null => {
  const n = num(value)
  return n !== null && n > 0 ? n : null
}

const symbolOf = (id: string): string | null => {
  const parts = id.split(':')
  if (parts.length !== 4 || parts[0] !== PROVIDER) return null
  return parts[3].toUpperCase()
}

const idFor = (symbol: string): string =>
  instrumentId({ provider: PROVIDER, assetType: 'future', exchange: 'binance-futures', symbol })

/** Price/size pairs from a depth message. A zero size is the venue removing a level, so it is kept. */
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

/** Binance's contract type, as Orbis names it. Anything unrecognised is not offered rather than guessed at. */
const contractTypeOf = (raw: unknown): Contract['contractType'] | null => {
  const value = String(raw ?? '').toUpperCase()
  if (value === 'PERPETUAL') return 'perpetual'
  if (value === 'CURRENT_QUARTER' || value === 'NEXT_QUARTER' || value === 'CURRENT_MONTH' || value === 'NEXT_MONTH') {
    return 'dated'
  }
  return null
}

const statusOf = (raw: unknown): Contract['status'] => {
  switch (String(raw ?? '').toUpperCase()) {
    case 'TRADING':
      return 'trading'
    case 'HALT':
    case 'BREAK':
    case 'AUCTION_MATCH':
      return 'halted'
    case 'SETTLING':
    case 'PENDING_TRADING':
    case 'PRE_SETTLE':
    case 'PRE_DELIVERING':
    case 'DELIVERING':
      return 'settling'
    case 'CLOSE':
    case 'DELIVERED':
    case 'SETTLED':
      return 'expired'
    default:
      return 'unknown'
  }
}

interface RawContract {
  symbol: string
  pair?: string
  contractType?: string
  status?: string
  baseAsset?: string
  quoteAsset?: string
  marginAsset?: string
  deliveryDate?: number
  filters?: { filterType?: string; tickSize?: string; stepSize?: string; notional?: string }[]
}

export class BinanceFuturesProvider implements MarketProvider {
  readonly id = PROVIDER
  readonly name = 'Binance Futures'
  readonly capabilities: ProviderCapabilities = {
    // Futures, not crypto spot. The asset type is what keeps a spot watchlist from resolving one of these by accident.
    assetTypes: ['future'],
    streaming: true,
    intervals: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
    search: true,
    quotes: true,
    orderBook: true,
    trades: true,
    news: false,
    fundamentals: false,
    options: false,
    funding: true,
    openInterest: true,
    liquidations: true,
    markPrice: true,
    longShort: true,
    datedFutures: true,
    delayedByMs: 0,
    universe: true
  }

  private readonly fetchFn: typeof fetch
  private readonly socketFor: (url: string) => SocketLike
  private readonly now: () => number
  private contractsHeld: Contract[] | null = null
  private contractsAt = 0

  constructor(options: BinanceFuturesOptions = {}) {
    this.fetchFn = options.fetchFn ?? ((input, init) => fetch(input, init))
    this.socketFor = options.socketFor ?? ((url) => new WebSocket(url) as unknown as SocketLike)
    this.now = options.now ?? Date.now
  }

  ready(): { ok: true } | { ok: false; code: 'not-configured'; detail: string } {
    return { ok: true }
  }

  private async get<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetchFn(`${REST}${path}`, { headers: { Accept: 'application/json' } })
    } catch {
      throw new ProviderError('network', 'Binance Futures could not be reached from this computer.')
    }
    if (response.status === 429 || response.status === 418) {
      const after = Number(response.headers.get('retry-after') ?? '0')
      throw new ProviderError('rate-limited', 'Binance asked Orbis to slow down.', (after || 60) * 1000)
    }
    if (response.status === 451 || response.status === 403) {
      throw new ProviderError('unauthorized', 'Binance does not serve futures data to this location.')
    }
    if (!response.ok) throw new ProviderError('bad-response', `Binance Futures answered ${response.status}.`)
    try {
      return (await response.json()) as T
    } catch {
      throw new ProviderError('bad-response', 'Binance Futures sent something that was not the expected data.')
    }
  }

  // ---------------------------------------------------------------- contracts

  /**
   * Every contract, with the venue's own metadata.
   *
   * Cached for an hour: the list changes when a contract is listed or settles, which is days apart. A contract whose type
   * Orbis does not recognise is left out rather than guessed into one of the two it knows.
   */
  async contracts(): Promise<Contract[]> {
    if (this.contractsHeld && this.now() - this.contractsAt < 60 * 60_000) return this.contractsHeld
    const info = await this.get<{ symbols: RawContract[] }>('/fapi/v1/exchangeInfo')
    const out: Contract[] = []
    for (const raw of info.symbols ?? []) {
      const contractType = contractTypeOf(raw.contractType)
      if (!contractType || !raw.symbol) continue
      const filters = raw.filters ?? []
      const priceFilter = filters.find((one) => one.filterType === 'PRICE_FILTER')
      const lotFilter = filters.find((one) => one.filterType === 'LOT_SIZE')
      const notionalFilter = filters.find((one) => one.filterType === 'MIN_NOTIONAL')
      out.push({
        instrumentId: idFor(raw.symbol),
        symbol: raw.symbol,
        base: String(raw.baseAsset ?? ''),
        quote: String(raw.quoteAsset ?? ''),
        // What it settles in, which for a USD-margined contract is the margin asset rather than the quote.
        settlement: String(raw.marginAsset ?? raw.quoteAsset ?? ''),
        contractType,
        status: statusOf(raw.status),
        // Binance stamps perpetuals with a date far in the future. A perpetual has no expiry, so it gets none here.
        expiresAt: contractType === 'dated' ? (positive(raw.deliveryDate) ?? null) : null,
        exchange: 'binance-futures',
        provider: PROVIDER,
        // Null rather than a guessed precision: a step Orbis invented would validate an order the venue would refuse.
        tickSize: positive(priceFilter?.tickSize),
        stepSize: positive(lotFilter?.stepSize),
        minNotional: positive(notionalFilter?.notional)
      })
    }
    this.contractsHeld = out
    this.contractsAt = this.now()
    return out
  }

  private instrumentFor(contract: Contract): Instrument {
    const dated = contract.contractType === 'dated' && contract.expiresAt !== null
    return {
      instrumentId: contract.instrumentId,
      symbol: contract.symbol,
      // Said in the name, because this is the field a person reads. "BTC/USDT perpetual" can never be mistaken for spot.
      name: `${contract.base}/${contract.quote} ${dated ? 'futures' : 'perpetual'}`,
      assetType: 'future',
      exchange: 'binance-futures',
      currency: contract.quote,
      provider: PROVIDER,
      metadata: {
        contractType: contract.contractType,
        settlement: contract.settlement,
        expiresAt: contract.expiresAt,
        status: contract.status
      }
    }
  }

  async search(query: string, limit: number): Promise<Instrument[]> {
    const wanted = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!wanted) return []
    const contracts = await this.contracts()
    const tradable = contracts.filter((one) => one.status === 'trading')
    const scored = tradable
      .map((one) => {
        const symbol = one.symbol.toUpperCase()
        // Exact first, then the base asset, then a prefix, then anywhere. A ranking, never a random order.
        const score =
          symbol === wanted ? 0 : one.base.toUpperCase() === wanted ? 1 : symbol.startsWith(wanted) ? 2 : symbol.includes(wanted) ? 3 : -1
        return { one, score }
      })
      .filter((entry) => entry.score >= 0)
      // Perpetuals before dated contracts at the same score: it is what somebody searching "BTC" almost always means.
      .sort(
        (a, b) =>
          a.score - b.score ||
          Number(a.one.contractType === 'dated') - Number(b.one.contractType === 'dated') ||
          a.one.symbol.localeCompare(b.one.symbol)
      )
      .slice(0, limit)
    return scored.map((entry) => this.instrumentFor(entry.one))
  }

  async resolve(id: string): Promise<Instrument | null> {
    const symbol = symbolOf(id)
    if (!symbol) return null
    const contract = (await this.contracts()).find((one) => one.symbol === symbol)
    return contract ? this.instrumentFor(contract) : null
  }

  // ---------------------------------------------------------------- quotes

  private quoteFrom(raw: Record<string, unknown>, at: number): Quote | null {
    const symbol = typeof raw.symbol === 'string' ? raw.symbol : ''
    const last = positive(raw.lastPrice)
    if (!symbol || last === null) return null
    const open = positive(raw.openPrice)
    const volume = num(raw.volume)
    const quoteVolume = num(raw.quoteVolume)
    const reported = num(raw.priceChangePercent)
    return {
      instrumentId: idFor(symbol),
      last,
      // The venue's own figure where it gave one, computed from its own open where it did not. Never left at zero.
      change: num(raw.priceChange),
      changePercent: reported ?? (open !== null ? changeFrom(last, open).changePercent : null),
      dayHigh: positive(raw.highPrice),
      dayLow: positive(raw.lowPrice),
      // The window's open is what the venue measures its 24-hour change against, which is what `previousClose` means here.
      previousClose: open,
      volume: volume !== null && volume >= 0 ? volume : null,
      quoteVolume: quoteVolume !== null && quoteVolume >= 0 ? quoteVolume : null,
      bid: null,
      ask: null,
      timestamp: positive(raw.closeTime) ?? at,
      delayedByMs: 0,
      // Perpetuals trade continuously. A dated contract that has settled is filtered out by its contract status rather
      // than described here as closed, because its ticker row is history and not a market.
      marketStatus: 'always-open',
      source: PROVIDER
    }
  }

  async quotes(instrumentIds: string[]): Promise<Quote[]> {
    const symbols = instrumentIds.map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    if (symbols.length === 0) return []
    const at = this.now()
    // One request for everything when several are wanted: twenty contracts should not be twenty requests.
    if (symbols.length === 1) {
      const raw = await this.get<Record<string, unknown>>(`/fapi/v1/ticker/24hr?symbol=${symbols[0]}`)
      const quote = this.quoteFrom(raw, at)
      return quote ? [quote] : []
    }
    const all = await this.get<Record<string, unknown>[]>('/fapi/v1/ticker/24hr')
    const wanted = new Set(symbols)
    const out: Quote[] = []
    for (const raw of all) {
      if (typeof raw.symbol !== 'string' || !wanted.has(raw.symbol)) continue
      const quote = this.quoteFrom(raw, at)
      if (quote) out.push(quote)
    }
    return out
  }

  async universe(): Promise<{ instrument: Instrument; quote: Quote }[]> {
    const [all, contracts] = await Promise.all([
      this.get<Record<string, unknown>[]>('/fapi/v1/ticker/24hr'),
      this.contracts()
    ])
    const at = this.now()
    const bySymbol = new Map(contracts.filter((one) => one.status === 'trading').map((one) => [one.symbol, one]))
    const out: { instrument: Instrument; quote: Quote }[] = []
    for (const raw of all) {
      if (typeof raw.symbol !== 'string') continue
      const contract = bySymbol.get(raw.symbol)
      // Only contracts the venue's own metadata describes as tradable. A ticker row for a settled contract is history.
      if (!contract) continue
      const quote = this.quoteFrom(raw, at)
      if (quote) out.push({ instrument: this.instrumentFor(contract), quote })
    }
    return out
  }

  async candles(id: string, interval: Interval, limit: number): Promise<Candle[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const name = INTERVAL_NAMES[interval]
    const rows = await this.get<unknown[][]>(
      `/fapi/v1/klines?symbol=${symbol}&interval=${name}&limit=${Math.min(1500, Math.max(1, limit))}`
    )
    const out: Candle[] = []
    for (const row of rows) {
      const at = positive(row[0])
      const open = positive(row[1])
      const high = positive(row[2])
      const low = positive(row[3])
      const close = positive(row[4])
      // A bar missing any of its four prices is not a bar. Dropped rather than drawn with a hole in it.
      if (at === null || open === null || high === null || low === null || close === null) continue
      const volume = num(row[5])
      out.push({ time: at, open, high, low, close, volume: volume !== null && volume >= 0 ? volume : null })
    }
    return out
  }

  async orderBook(id: string, depth: number): Promise<OrderBook> {
    const symbol = symbolOf(id)
    if (!symbol) throw new ProviderError('not-found', 'That is not a Binance Futures contract.')
    const allowed = [5, 10, 20, 50, 100, 500, 1000]
    const wanted = allowed.find((one) => one >= depth) ?? 100
    const raw = await this.get<{ bids: [string, string][]; asks: [string, string][]; E?: number; lastUpdateId?: number }>(
      `/fapi/v1/depth?symbol=${symbol}&limit=${wanted}`
    )
    const level = (row: [string, string]): { price: number; size: number } | null => {
      const price = positive(row[0])
      const size = num(row[1])
      if (price === null || size === null || size <= 0) return null
      return { price, size }
    }
    return {
      instrumentId: id,
      // Carried so an incremental depth stream can be applied on top of this without a hole in it.
      lastUpdateId: positive(raw.lastUpdateId) ?? null,
      bids: (raw.bids ?? []).map(level).filter((one): one is { price: number; size: number } => one !== null),
      asks: (raw.asks ?? []).map(level).filter((one): one is { price: number; size: number } => one !== null),
      timestamp: positive(raw.E) ?? this.now(),
      source: PROVIDER
    }
  }

  async trades(id: string, limit: number): Promise<TradePrint[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const rows = await this.get<{ price: string; qty: string; time: number; isBuyerMaker: boolean }[]>(
      `/fapi/v1/trades?symbol=${symbol}&limit=${Math.min(1000, Math.max(1, limit))}`
    )
    const out: TradePrint[] = []
    for (const row of rows) {
      const price = positive(row.price)
      const size = positive(row.qty)
      const at = positive(row.time)
      if (price === null || size === null || at === null) continue
      out.push({
        instrumentId: id,
        price,
        size,
        // The buyer being the maker means the seller crossed the spread. The venue's flag, not an inference from price.
        side: typeof row.isBuyerMaker === 'boolean' ? (row.isBuyerMaker ? 'sell' : 'buy') : 'unknown',
        timestamp: at
      })
    }
    return out.sort((a, b) => a.timestamp - b.timestamp)
  }

  // ---------------------------------------------------------------- funding

  /**
   * Funding, and the mark and index prices that come with it.
   *
   * One endpoint answers all of it, so asking for funding costs one request rather than three. The interval is derived
   * from the venue's own funding-rate history — Binance publishes the next time but not the period, and reading it off
   * two consecutive payments is a fact about this contract rather than an assumption about all of them.
   */
  async funding(instrumentIds: string[]): Promise<Funding[]> {
    const symbols = instrumentIds.map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    if (symbols.length === 0) return []
    const at = this.now()
    const rows = await this.premiumIndex(symbols)
    const out: Funding[] = []
    for (const raw of rows) {
      const symbol = typeof raw.symbol === 'string' ? raw.symbol : ''
      const rate = num(raw.lastFundingRate)
      if (!symbol || rate === null) continue
      const nextAt = positive(raw.nextFundingTime)
      out.push({
        instrumentId: idFor(symbol),
        rate,
        at: positive(raw.time) ?? at,
        // Binance sends 0 for a contract with no funding schedule. Zero is not a time, so it becomes null.
        nextAt,
        intervalMs: await this.fundingIntervalFor(symbol),
        source: PROVIDER
      })
    }
    return out
  }

  private async premiumIndex(symbols: string[]): Promise<Record<string, unknown>[]> {
    if (symbols.length === 1) {
      const one = await this.get<Record<string, unknown>>(`/fapi/v1/premiumIndex?symbol=${symbols[0]}`)
      return [one]
    }
    const all = await this.get<Record<string, unknown>[]>('/fapi/v1/premiumIndex')
    const wanted = new Set(symbols)
    return all.filter((raw) => typeof raw.symbol === 'string' && wanted.has(raw.symbol))
  }

  /** Cached, because it is a property of the contract and costs a request to learn. */
  private readonly intervals = new Map<string, number | null>()

  private async fundingIntervalFor(symbol: string): Promise<number | null> {
    const held = this.intervals.get(symbol)
    if (held !== undefined) return held
    let interval: number | null = null
    try {
      const rows = await this.get<{ fundingTime: number }[]>(`/fapi/v1/fundingRate?symbol=${symbol}&limit=3`)
      const times = rows.map((one) => positive(one.fundingTime)).filter((one): one is number => one !== null).sort()
      if (times.length >= 2) {
        const gap = times[times.length - 1] - times[times.length - 2]
        // Between an hour and a day. Anything outside that is a gap in the history rather than a funding period.
        if (gap >= 3_600_000 && gap <= 24 * 3_600_000) interval = gap
      }
    } catch {
      // Not knowing the interval is a real answer: without it nothing here is annualised.
      interval = null
    }
    this.intervals.set(symbol, interval)
    return interval
  }

  async fundingHistory(id: string, limit: number): Promise<FundingPoint[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const rows = await this.get<{ fundingTime: number; fundingRate: string }[]>(
      `/fapi/v1/fundingRate?symbol=${symbol}&limit=${Math.min(1000, Math.max(1, limit))}`
    )
    const out: FundingPoint[] = []
    for (const row of rows) {
      const at = positive(row.fundingTime)
      const rate = num(row.fundingRate)
      if (at === null || rate === null) continue
      out.push({ at, rate })
    }
    return out.sort((a, b) => a.at - b.at)
  }

  // ---------------------------------------------------------------- open interest

  async openInterest(instrumentIds: string[]): Promise<OpenInterest[]> {
    const symbols = instrumentIds.map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    if (symbols.length === 0) return []
    // One contract per request: Binance has no bulk open-interest endpoint. Requested in parallel, and one failure does
    // not take the others with it.
    const answers = await Promise.allSettled(
      symbols.map((symbol) => this.get<{ symbol: string; openInterest: string; time: number }>(`/fapi/v1/openInterest?symbol=${symbol}`))
    )
    const out: OpenInterest[] = []
    for (const answer of answers) {
      if (answer.status !== 'fulfilled') continue
      const amount = num(answer.value.openInterest)
      if (amount === null || amount < 0) continue
      out.push({
        instrumentId: idFor(answer.value.symbol),
        amount,
        // Binance gives contracts, not value. Derived only where a real price is at hand, and null otherwise -- which is
        // why this method does not quietly fetch a price to multiply by.
        notional: null,
        at: positive(answer.value.time) ?? this.now(),
        source: PROVIDER
      })
    }
    return out
  }

  async openInterestHistory(id: string, windowMs: number, limit: number): Promise<OpenInterestPoint[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const period = periodFor(windowMs, limit)
    const rows = await this.get<{ sumOpenInterest: string; sumOpenInterestValue: string; timestamp: number }[]>(
      `/futures/data/openInterestHist?symbol=${symbol}&period=${period}&limit=${Math.min(500, Math.max(1, limit))}`
    )
    const out: OpenInterestPoint[] = []
    for (const row of rows) {
      const at = positive(row.timestamp)
      const amount = num(row.sumOpenInterest)
      if (at === null || amount === null || amount < 0) continue
      out.push({ at, amount, notional: num(row.sumOpenInterestValue) })
    }
    return out.sort((a, b) => a.at - b.at)
  }

  // ---------------------------------------------------------------- mark and index

  async markIndex(instrumentIds: string[]): Promise<MarkIndex[]> {
    const symbols = instrumentIds.map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    if (symbols.length === 0) return []
    const at = this.now()
    const rows = await this.premiumIndex(symbols)
    const out: MarkIndex[] = []
    for (const raw of rows) {
      const symbol = typeof raw.symbol === 'string' ? raw.symbol : ''
      if (!symbol) continue
      out.push({
        instrumentId: idFor(symbol),
        markPrice: positive(raw.markPrice),
        indexPrice: positive(raw.indexPrice),
        settlementPrice: positive(raw.estimatedSettlePrice),
        at: positive(raw.time) ?? at,
        source: PROVIDER
      })
    }
    return out
  }

  // ---------------------------------------------------------------- positioning

  /**
   * How the venue's own accounts are positioned.
   *
   * `accounts` rather than positions: this endpoint counts accounts that are net long against accounts that are net
   * short, which is a different thing from long and short open interest. Named in the result, because the two get
   * confused and only one of them is what this number is.
   */
  async longShort(id: string, windowMs: number, limit: number): Promise<LongShortRatio[]> {
    const symbol = symbolOf(id)
    if (!symbol) return []
    const period = periodFor(windowMs, limit)
    const rows = await this.get<{ longShortRatio: string; longAccount: string; shortAccount: string; timestamp: number }[]>(
      `/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${period}&limit=${Math.min(500, Math.max(1, limit))}`
    )
    const out: LongShortRatio[] = []
    for (const row of rows) {
      const at = positive(row.timestamp)
      const ratio = positive(row.longShortRatio)
      const longShare = num(row.longAccount)
      const shortShare = num(row.shortAccount)
      if (at === null || ratio === null || longShare === null || shortShare === null) continue
      out.push({ instrumentId: id, ratio, longShare, shortShare, at, basis: 'accounts', source: PROVIDER })
    }
    return out.sort((a, b) => a.at - b.at)
  }

  /**
   * Recent forced closures.
   *
   * Binance publishes these as a stream and keeps no public history, so there is nothing to fetch: this returns an empty
   * list and the panel fills as events arrive. Empty rather than absent, so the caller does not have to special-case it,
   * and the panel says why rather than looking broken.
   */
  async liquidations(): Promise<Liquidation[]> {
    return []
  }

  // ---------------------------------------------------------------- streaming

  /**
   * One socket, every stream this provider needs.
   *
   * Quotes for everything asked for; trades only for what asked for trades; mark price for everything, because it arrives
   * on its own stream and is what a derivatives panel is watching. Liquidations come from the venue's market-wide
   * `forceOrder` feed, filtered to the contracts on screen — Binance has no per-symbol liquidation stream that reports
   * every event, and subscribing to the whole feed once is cheaper than a socket per contract.
   */
  async stream(instrumentIds: string[], events: ProviderEvents, options: StreamOptions = {}): Promise<() => void> {
    const symbols = instrumentIds.map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    if (symbols.length === 0) {
      events.status('disconnected', 'Nothing to stream.')
      return () => {}
    }
    const wantsTrades = new Set(
      (options.trades ?? []).map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    )
    const wantsDepth = new Set(
      (options.depth ?? []).map((id) => symbolOf(id)).filter((one): one is string => one !== null)
    )
    const streams = [
      ...symbols.map((one) => `${one.toLowerCase()}@ticker`),
      ...symbols.filter((one) => wantsTrades.has(one)).map((one) => `${one.toLowerCase()}@aggTrade`),
      ...symbols.filter((one) => wantsDepth.has(one)).map((one) => `${one.toLowerCase()}@depth@100ms`),
      ...symbols.map((one) => `${one.toLowerCase()}@markPrice@1s`),
      // The market-wide liquidation feed, filtered below. One subscription for all of them.
      '!forceOrder@arr'
    ]

    const socket = this.socketFor(`${STREAM}?streams=${streams.join('/')}`)
    const onScreen = new Set(symbols)
    let closed = false

    socket.addEventListener('open', () => events.status('connected'))
    socket.addEventListener('close', () => {
      if (!closed) events.status('disconnected', 'Binance Futures closed the connection.')
    })
    socket.addEventListener('error', () => {
      if (!closed) events.status('disconnected', 'The Binance Futures connection failed.')
    })
    socket.addEventListener('message', (event) => {
      const text = (event as { data?: unknown }).data
      if (typeof text !== 'string') return
      let payload: { stream?: string; data?: Record<string, unknown> }
      try {
        payload = JSON.parse(text) as typeof payload
      } catch {
        // One malformed frame must not take the stream with it.
        return
      }
      const data = payload.data
      if (!data) return
      const kind = String(data.e ?? '')

      if (kind === '24hrTicker') {
        const quote = this.fromTickerEvent(data)
        if (quote) events.quote(quote)
        return
      }
      if (kind === 'depthUpdate') {
        const symbol = typeof data.s === 'string' ? data.s : ''
        const first = positive(data.U)
        const last = positive(data.u)
        if (!symbol || first === null || last === null) return
        events.bookDelta?.({
          instrumentId: idFor(symbol),
          firstUpdateId: first,
          lastUpdateId: last,
          // The futures stream also states which message this one follows, which is a stronger continuity check than a
          // contiguous range. Passed through so the keeper can use it.
          previousUpdateId: positive(data.pu) ?? null,
          bids: levelsFrom(data.b),
          asks: levelsFrom(data.a),
          timestamp: positive(data.E) ?? this.now()
        })
        return
      }

      if (kind === 'aggTrade') {
        const print = this.fromTradeEvent(data)
        if (print) events.trade?.(print)
        return
      }
      if (kind === 'markPriceUpdate') {
        const symbol = typeof data.s === 'string' ? data.s : ''
        if (!symbol) return
        const nextAt = positive(data.T)
        events.markIndex?.({
          instrumentId: idFor(symbol),
          markPrice: positive(data.p),
          indexPrice: positive(data.i),
          settlementPrice: positive(data.P),
          at: positive(data.E) ?? this.now(),
          source: PROVIDER
        })
        const rate = num(data.r)
        if (rate !== null) {
          // Funding arrives on this stream too, so a panel does not have to poll for it.
          void this.fundingIntervalFor(symbol).then((intervalMs) => {
            if (closed) return
            events.funding?.({
              instrumentId: idFor(symbol),
              rate,
              at: positive(data.E) ?? this.now(),
              nextAt,
              intervalMs,
              source: PROVIDER
            })
          })
        }
        return
      }
      if (kind === 'forceOrder') {
        const order = (data.o ?? {}) as Record<string, unknown>
        const symbol = typeof order.s === 'string' ? order.s : ''
        // The market-wide feed carries every contract. Only the ones on screen are delivered.
        if (!symbol || !onScreen.has(symbol)) return
        const price = positive(order.ap) ?? positive(order.p)
        const size = positive(order.q)
        const at = positive(order.T) ?? positive(data.E)
        const side = order.S === 'BUY' ? 'buy' : order.S === 'SELL' ? 'sell' : null
        if (price === null || size === null || at === null || side === null) return
        events.liquidation?.({
          instrumentId: idFor(symbol),
          symbol,
          side,
          price,
          size,
          notional: price * size,
          at,
          source: PROVIDER
        })
      }
    })

    return () => {
      closed = true
      try {
        socket.close()
      } catch {
        // Already gone. Nothing to do and nothing worth reporting.
      }
    }
  }

  private fromTickerEvent(data: Record<string, unknown>): Quote | null {
    const symbol = typeof data.s === 'string' ? data.s : ''
    const last = positive(data.c)
    if (!symbol || last === null) return null
    const open = positive(data.o)
    const volume = num(data.v)
    const quoteVolume = num(data.q)
    const percent = num(data.P)
    return {
      instrumentId: idFor(symbol),
      last,
      change: num(data.p),
      changePercent: percent ?? (open !== null ? changeFrom(last, open).changePercent : null),
      dayHigh: positive(data.h),
      dayLow: positive(data.l),
      previousClose: open,
      volume: volume !== null && volume >= 0 ? volume : null,
      quoteVolume: quoteVolume !== null && quoteVolume >= 0 ? quoteVolume : null,
      bid: positive(data.b),
      ask: positive(data.a),
      timestamp: positive(data.E) ?? this.now(),
      delayedByMs: 0,
      marketStatus: 'always-open',
      source: PROVIDER
    }
  }

  private fromTradeEvent(data: Record<string, unknown>): TradePrint | null {
    const symbol = typeof data.s === 'string' ? data.s : ''
    const price = positive(data.p)
    const size = positive(data.q)
    const at = positive(data.T) ?? positive(data.E)
    if (!symbol || price === null || size === null || at === null) return null
    return {
      instrumentId: idFor(symbol),
      price,
      size,
      side: typeof data.m === 'boolean' ? (data.m ? 'sell' : 'buy') : 'unknown',
      timestamp: at
    }
  }
}
