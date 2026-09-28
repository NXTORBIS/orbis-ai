import type { BrowserControl } from './registry.ts'
import { fail } from './registry.ts'
import type { ParamSpec } from '../../shared/browserControl.ts'
import type { MarketEngine } from '../markets/engine.ts'
import type { MarketsStore } from '../markets/store.ts'
import type { MarketsRuntime } from '../markets/runtime.ts'
import type { Instrument, QuoteView } from '../../shared/markets/instrument.ts'
import { breadth, movers, turnoverOf, type MoverKind } from '../../shared/markets/discovery.ts'
import { cleanQuery, queryNeedsCandles, screen, screenSnapshot } from '../../shared/markets/screener.ts'
import { calculate, type Candle } from '../../shared/markets/indicators.ts'
import { ASSUMPTIONS as PAPER_ASSUMPTIONS, place, valueOf, type Side } from '../../shared/markets/paper.ts'
import { portfolioView } from '../../shared/markets/portfolio.ts'
import { backtest, ASSUMPTIONS as BACKTEST_ASSUMPTIONS } from '../../shared/markets/backtest.ts'
import { describeStrategy, problemsWith } from '../../shared/markets/strategy.ts'
import { describeAlert } from '../../shared/markets/alerts.ts'
import { INTERVALS, type Interval } from '../../shared/markets/provider.ts'
import { randomUUID } from 'node:crypto'

/**
 * What Orion, the Orb, a workflow or a spoken command may do about markets.
 *
 * One registration, four surfaces. Voice becomes a transcript, the transcript becomes an Orion request, Orion calls a
 * capability, and the Orb and the workflow engine call the same ones — so there is exactly one place that decides what
 * may be asked of Markets, and adding a surface adds no new answer to that question.
 *
 * Three rules shape every capability below.
 *
 * **Nothing here invents a market value.** Each one reads the same engine the screens read, and passes on the same
 * `freshness` beside every number. An instrument with no price produces a null and says so; an unconfigured capability
 * says it is unconfigured. Orion cannot be given a figure that Orbis does not have, which is the only way to stop Orion
 * repeating one.
 *
 * **Snapshots, not streams.** A quote arrives several times a second and Orion reads text. `market.quote` answers with
 * the state now; nothing here subscribes Orion to anything. Asking again is how you get a newer number.
 *
 * **A simulated order is a simulated order, loudly.** `market.paperOrder` is the only capability that can move money,
 * and the money is not real: it reaches the paper engine and there is no credential anywhere in this process that could
 * reach an exchange. It still asks for confirmation every time, because an instruction that sounded like a trade should
 * be confirmed as one even when it is a simulation — and because a spoken "buy bitcoin" should never become an order
 * nobody meant.
 */

const str = (description: string, required = false): ParamSpec => ({ type: 'string', description, required })
const num = (description: string, required = false): ParamSpec => ({ type: 'number', description, required })

export interface MarketCapabilityDeps {
  control: BrowserControl
  engine: MarketEngine
  store: MarketsStore
  runtime: MarketsRuntime
  profileId(): Promise<string>
  /** Brings a market up on the Markets screen. Returns false when the window is not there to show it. */
  show(instrumentId: string, section?: string): Promise<boolean>
}

/** A quote as Orion should read it: the numbers, and how much to believe them. */
const quoteFor = (instrument: Instrument, quote: QuoteView | null): Record<string, unknown> => ({
  symbol: instrument.symbol,
  name: instrument.name,
  instrumentId: instrument.instrumentId,
  exchange: instrument.exchange,
  currency: instrument.currency,
  price: quote?.last ?? null,
  change: quote?.change ?? null,
  changePercent: quote?.changePercent ?? null,
  dayHigh: quote?.dayHigh ?? null,
  dayLow: quote?.dayLow ?? null,
  volume: quote?.volume ?? null,
  turnover: quote ? turnoverOf(quote) : null,
  bid: quote?.bid ?? null,
  ask: quote?.ask ?? null,
  // The two fields that keep an answer honest. Without them a figure from four hours ago reads like one from now.
  freshness: quote?.freshness ?? 'unavailable',
  asOf: quote ? new Date(quote.timestamp).toISOString() : null,
  ageSeconds: quote ? Math.round(quote.ageMs / 1000) : null,
  source: quote?.source ?? null
})

export function registerMarketCapabilities(d: MarketCapabilityDeps): void {
  const { control, engine, store, runtime } = d

  /** Resolves what somebody said into an instrument. Null when no provider can describe it. */
  const findOne = async (wanted: string): Promise<Instrument | null> => {
    const asked = String(wanted ?? '').trim()
    if (!asked) return null
    // An id first, so a capability chained after another one is exact rather than searching again.
    if (asked.includes(':')) {
      const direct = await engine.instrument(asked)
      if (direct) return direct
    }
    const found = await engine.search(asked, 5)
    return found[0] ?? null
  }

  /**
   * The instrument somebody named, or a refusal.
   *
   * Separate from `findOne` so the type says it cannot be null. `fail` throws, but it is a const arrow rather than a
   * function declaration, so TypeScript will not narrow on it — the one cast here is better than twelve non-null
   * assertions scattered through the capabilities.
   */
  const needOne = async (wanted: string): Promise<Instrument> => {
    const found = await findOne(wanted)
    if (!found) fail('not-found', 'No provider can describe a market by that name.')
    return found as Instrument
  }

  const needEnabled = async (): Promise<void> => {
    if (!(await store.enabled(await d.profileId()))) {
      fail('unavailable', 'Markets is switched off in settings, so there is nothing to read.')
    }
  }

  // ---------------------------------------------------------------- state Orion can see without asking

  /**
   * A small standing summary.
   *
   * Deliberately small: this is read whenever the control layer describes itself, so it is counts and labels rather than
   * prices. Anything about a particular market costs a capability call, which is how Orion's context stays about the
   * question being asked.
   */
  control.registerState('markets', async () => {
    const profileId = await d.profileId()
    const workspace = await store.read(profileId)
    return {
      enabled: workspace.enabled,
      connection: runtime.connection(),
      watchlists: workspace.watchlists.map((one) => ({ name: one.name, markets: one.items.length })),
      tickerShowing: workspace.enabled && workspace.ticker.enabled,
      alerts: workspace.alerts.filter((one) => one.enabled).length,
      strategies: workspace.strategies.length,
      paperAccount: workspace.paper ? { currency: workspace.paper.account.currency, positions: workspace.paper.account.positions.length } : null,
      providers: engine.statuses().map((one) => ({ name: one.name, connected: one.connection === 'connected' }))
    }
  })

  // ---------------------------------------------------------------- reading a market

  control.register({
    id: 'market.search',
    domain: 'markets',
    name: 'Find a market',
    description:
      'Finds tradable markets by name or ticker — "bitcoin", "BTC", "ETH". Returns the canonical instrument id for each, which every other market capability takes.',
    params: { query: str('What to look for: a name or a ticker.', true), limit: num('How many at most. Default 8.') },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      const query = String(params.query ?? '').trim()
      if (!query) fail('invalid-params', 'What should Orbis look for?')
      const limit = Math.min(25, Math.max(1, Math.round(Number(params.limit) || 8)))
      const found = await engine.search(query, limit)
      return {
        results: found.map((one) => ({
          instrumentId: one.instrumentId,
          symbol: one.symbol,
          name: one.name,
          exchange: one.exchange,
          currency: one.currency
        })),
        // Said rather than implied by an empty list: no result and no provider are different situations.
        note: found.length === 0 ? 'No configured provider lists a market matching that.' : undefined
      }
    }
  })

  control.register({
    id: 'market.quote',
    domain: 'markets',
    name: 'What a market is doing',
    description:
      'The current price of one market with its change, range, volume and — importantly — how fresh the figure is. Ask again for a newer one; this does not subscribe to anything.',
    params: { market: str('A name, ticker, or instrument id.', true) },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      const instrument = await needOne(String(params.market ?? ''))
      // Asked for when it has never been priced, so an answer about a market nobody was watching is still an answer.
      if (engine.quote(instrument.instrumentId) === null) await engine.refresh([instrument.instrumentId])
      return quoteFor(instrument, engine.quote(instrument.instrumentId))
    }
  })

  control.register({
    id: 'market.history',
    domain: 'markets',
    name: 'How a market has moved',
    description:
      'A summary of recent candles for one market at a chosen interval: the range, where it closed, and a handful of technical readings. Summarised rather than listing every bar, which would be thousands of numbers.',
    params: {
      market: str('A name, ticker, or instrument id.', true),
      interval: str('1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w or 1M. Default 1h.'),
      bars: num('How many bars to look at. Default 200.')
    },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      const instrument = await needOne(String(params.market ?? ''))
      const wanted = String(params.interval ?? '1h') as Interval
      if (!INTERVALS.includes(wanted)) fail('invalid-params', `Orbis does not have candles at "${wanted}".`)
      const limit = Math.min(1000, Math.max(20, Math.round(Number(params.bars) || 200)))

      const candles: Candle[] = await engine.candlesFor(instrument.instrumentId, wanted, limit)
      if (candles.length === 0) {
        return { symbol: instrument.symbol, interval: wanted, bars: 0, note: 'That provider returned no candles for this market and interval.' }
      }

      const closes = candles.map((c) => c.close)
      const first = candles[0]
      const last = candles[candles.length - 1]
      const latest = (series: (number | null)[]): number | null => {
        for (let i = series.length - 1; i >= 0; i--) {
          const value = series[i]
          if (typeof value === 'number' && Number.isFinite(value)) return value
        }
        return null
      }
      const indicator = (kind: 'rsi' | 'sma' | 'ema' | 'atr', options: Record<string, number>, name = kind): number | null => {
        try {
          return latest(calculate(kind, candles, options)[name] ?? [])
        } catch {
          return null
        }
      }
      const sma50 = indicator('sma', { period: 50 }, 'sma')

      return {
        symbol: instrument.symbol,
        interval: wanted,
        bars: candles.length,
        from: new Date(first.time).toISOString(),
        to: new Date(last.time).toISOString(),
        open: first.open,
        close: last.close,
        high: Math.max(...candles.map((c) => c.high)),
        low: Math.min(...candles.map((c) => c.low)),
        changePercent: first.open > 0 ? ((last.close - first.open) / first.open) * 100 : null,
        // A few readings rather than every bar: the shape of the move, in numbers Orion can talk about.
        rsi14: indicator('rsi', { period: 14 }, 'rsi'),
        sma50,
        priceVsSma50Percent: sma50 && sma50 > 0 ? ((last.close - sma50) / sma50) * 100 : null,
        ema20: indicator('ema', { period: 20 }, 'ema'),
        atr14: indicator('atr', { period: 14 }, 'atr'),
        // The last few bars, so "what happened in the last few hours" has something behind it.
        recent: candles.slice(-8).map((c) => ({
          at: new Date(c.time).toISOString(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        })),
        source: 'Historical candles from the market provider. Past movement, not a forecast.',
        note: closes.length < limit ? `Only ${closes.length} bars were available of the ${limit} asked for.` : undefined
      }
    }
  })

  control.register({
    id: 'market.orderBook',
    domain: 'markets',
    name: 'The order book',
    description:
      'The spread, the best bid and ask, and how much is resting near the price for one market. Only for providers that serve depth.',
    params: { market: str('A name, ticker, or instrument id.', true), depth: num('How many levels a side. Default 10.') },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      const instrument = await needOne(String(params.market ?? ''))
      const depth = Math.min(50, Math.max(1, Math.round(Number(params.depth) || 10)))
      const found = await engine.orderBookFor(instrument.instrumentId, depth)
      if (!found) fail('unavailable', 'That market’s provider does not serve an order book.')
      const book = found as NonNullable<typeof found>

      const bestBid = book.bids[0]?.price ?? null
      const bestAsk = book.asks[0]?.price ?? null
      const spread = bestBid !== null && bestAsk !== null && bestAsk >= bestBid ? bestAsk - bestBid : null
      const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null
      const total = (levels: { price: number; size: number }[]): number =>
        levels.reduce((sum, one) => sum + one.price * one.size, 0)
      return {
        symbol: instrument.symbol,
        bestBid,
        bestAsk,
        spread,
        // Null rather than a number when there is nothing to divide by, which is the honest answer for a one-sided book.
        spreadPercent: spread !== null && mid !== null && mid > 0 ? (spread / mid) * 100 : null,
        mid,
        bidValueNear: total(book.bids),
        askValueNear: total(book.asks),
        levels: depth,
        asOf: new Date(book.timestamp).toISOString(),
        source: book.source
      }
    }
  })

  control.register({
    id: 'market.movers',
    domain: 'markets',
    name: 'What is moving',
    description:
      'The biggest gainers, losers or most-traded markets across everything the provider lists, with how many markets were considered.',
    params: {
      kind: str('gainers, losers, volume or active. Default gainers.'),
      limit: num('How many. Default 10.'),
      quoteCurrency: str('Only markets priced in this, for example USDT.')
    },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      if (!engine.universeAvailable()) {
        fail('unavailable', 'No configured provider can report every market at once, so there is nothing to rank.')
      }
      const allowed: MoverKind[] = ['gainers', 'losers', 'volume', 'active']
      const asked = String(params.kind ?? 'gainers')
      const kind = (allowed as string[]).includes(asked) ? (asked as MoverKind) : 'gainers'
      const limit = Math.min(50, Math.max(1, Math.round(Number(params.limit) || 10)))
      const quoteCurrency = String(params.quoteCurrency ?? '').trim() || undefined

      const rows = await engine.universe()
      const filter = quoteCurrency ? { quoteCurrency } : {}
      return {
        kind,
        universeSize: rows.length,
        breadth: breadth(rows, filter),
        results: movers(rows, kind, limit, filter).map((row) => ({
          symbol: row.instrument.symbol,
          instrumentId: row.instrument.instrumentId,
          price: row.quote.last,
          changePercent: row.quote.changePercent,
          turnover: turnoverOf(row.quote),
          freshness: row.quote.freshness
        }))
      }
    }
  })

  control.register({
    id: 'market.screen',
    domain: 'markets',
    name: 'Screen the market',
    description:
      'Finds markets meeting conditions — price, 24h change, value traded, RSI, price against a moving average, MACD, ATR or volatility. Technical conditions cost a request per market, so only the most-traded are examined and the answer says how many were left out.',
    params: {
      conditions: {
        type: 'array',
        description:
          'Each: {field, operator, value, value2?, period?, interval?}. Fields: price, changePercent, turnover, volume, rsi, priceVsSma, priceVsEma, macdHistogram, atrPercent, volatility. Operators: gt, lt, between.',
        required: true
      },
      match: str('all or any. Default all.'),
      sortField: str('Which field to order by. Default turnover.'),
      sortDirection: str('asc or desc. Default desc.'),
      limit: num('How many results. Default 20.')
    },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      if (!engine.universeAvailable()) {
        fail('unavailable', 'No configured provider can report every market at once, so there is nothing to screen.')
      }
      const query = cleanQuery({
        conditions: params.conditions,
        match: params.match,
        sort: { field: params.sortField, direction: params.sortDirection },
        limit: Math.min(50, Math.max(1, Math.round(Number(params.limit) || 20)))
      })
      // Refused rather than run: a screen with nothing valid in it would return the whole exchange and read as a finding.
      if (query.conditions.length === 0) {
        fail('invalid-params', 'None of those conditions could be understood, so nothing was screened.')
      }

      const rows = await engine.universe()
      const held = new Map<string, Candle[]>()
      let cap: number | null = null
      let usedInterval: string | null = null

      if (queryNeedsCandles(query)) {
        cap = 40
        usedInterval = query.conditions.find((c) => c.interval)?.interval ?? '1h'
        const { passed } = screenSnapshot(rows, query)
        const ordered = [...passed].sort((a, b) => (turnoverOf(b.quote) ?? -1) - (turnoverOf(a.quote) ?? -1))
        for (const row of ordered.slice(0, cap)) {
          try {
            const candles = await engine.candlesFor(row.instrument.instrumentId, usedInterval as Interval, 300)
            if (candles.length > 0) held.set(row.instrument.instrumentId, candles)
          } catch {
            // Not examined, and counted as skipped by the screener below. Not judged on data nobody has.
          }
        }
      }

      const answer = screen(rows, query, (id) => held.get(id) ?? null)
      return {
        universeSize: answer.universeSize,
        matched: answer.results.length,
        examined: answer.examined,
        skipped: answer.skipped,
        interval: usedInterval,
        results: answer.results.map((one) => ({
          symbol: one.row.instrument.symbol,
          instrumentId: one.row.instrument.instrumentId,
          price: one.row.quote.last,
          changePercent: one.row.quote.changePercent,
          values: one.values
        })),
        // The caveat travels with the answer, so a summary of it cannot leave the caveat behind.
        note:
          answer.skipped > 0
            ? `${answer.skipped} markets passed the cheap conditions but were not examined, because each one costs a request. The most-traded were examined first, so this is not the whole market.`
            : undefined
      }
    }
  })

  // ---------------------------------------------------------------- watchlists

  control.register({
    id: 'market.watchlists',
    domain: 'markets',
    name: 'Watchlists',
    description: 'Every saved watchlist with what is on it and each market’s current price.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const profileId = await d.profileId()
      const lists = await store.watchlists(profileId)
      return {
        watchlists: lists.map((list) => ({
          id: list.id,
          name: list.name,
          markets: list.items.map((item) => quoteFor(item.instrument, engine.quote(item.instrumentId)))
        }))
      }
    }
  })

  control.register({
    id: 'market.watch',
    domain: 'markets',
    name: 'Add a market to a watchlist',
    description: 'Puts a market on a watchlist, making the list if there is none by that name.',
    params: { market: str('A name, ticker, or instrument id.', true), watchlist: str('Which list. Default the first one.') },
    mutates: true,
    confirmation: 'none',
    describe: (params) => `Add ${String(params.market)} to ${params.watchlist ? `the “${String(params.watchlist)}” watchlist` : 'a watchlist'}`,
    run: async (params) => {
      await needEnabled()
      const profileId = await d.profileId()
      const instrument = await needOne(String(params.market ?? ''))

      const wanted = String(params.watchlist ?? '').trim()
      const lists = await store.watchlists(profileId)
      let list = wanted ? lists.find((one) => one.name.toLowerCase() === wanted.toLowerCase()) : lists[0]
      if (!list) list = await store.createWatchlist(profileId, wanted || 'My markets')

      await store.addToWatchlist(profileId, list.id, instrument)
      await store.remember(profileId, [instrument])
      if (engine.quote(instrument.instrumentId) === null) await engine.refresh([instrument.instrumentId])

      // Verified from the store rather than assumed from the call returning.
      const after = (await store.watchlists(profileId)).find((one) => one.id === list!.id)
      const added = after?.items.some((item) => item.instrumentId === instrument.instrumentId) === true
      if (!added) fail('failed', 'That market was not added to the list.')
      return { watchlist: after?.name, symbol: instrument.symbol, markets: after?.items.length ?? 0 }
    }
  })

  control.register({
    id: 'market.unwatch',
    domain: 'markets',
    name: 'Remove a market from a watchlist',
    description: 'Takes a market off a watchlist. The market itself is not affected.',
    params: { market: str('A name, ticker, or instrument id.', true), watchlist: str('Which list. Default every list it is on.') },
    mutates: true,
    confirmation: 'none',
    describe: (params) => `Remove ${String(params.market)} from ${params.watchlist ? `“${String(params.watchlist)}”` : 'every watchlist'}`,
    run: async (params) => {
      const profileId = await d.profileId()
      const instrument = await needOne(String(params.market ?? ''))
      const wanted = String(params.watchlist ?? '').trim()
      const lists = await store.watchlists(profileId)
      const targets = wanted ? lists.filter((one) => one.name.toLowerCase() === wanted.toLowerCase()) : lists
      let removed = 0
      for (const list of targets) {
        if (!list.items.some((item) => item.instrumentId === instrument.instrumentId)) continue
        await store.removeFromWatchlist(profileId, list.id, instrument.instrumentId)
        removed++
      }
      return { symbol: instrument.symbol, removedFrom: removed }
    }
  })

  // ---------------------------------------------------------------- alerts

  control.register({
    id: 'market.alerts',
    domain: 'markets',
    name: 'Market alerts',
    description: 'Every alert that is set, what it is watching, the last value it was judged against, and what has fired.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const profileId = await d.profileId()
      const alerts = await store.alerts(profileId)
      const history = await store.alertHistory(profileId)
      const named = await Promise.all(
        alerts.map(async (alert) => {
          const instrument = await engine.instrument(alert.instrumentId)
          const symbol = instrument?.symbol ?? alert.instrumentId
          return {
            id: alert.id,
            symbol,
            condition: alert.label || describeAlert(alert, symbol),
            enabled: alert.enabled,
            lastValue: alert.lastValue ?? null,
            lastFiredAt: alert.lastFiredAt ? new Date(alert.lastFiredAt).toISOString() : null
          }
        })
      )
      return {
        alerts: named,
        recentlyFired: [...history]
          .reverse()
          .slice(0, 20)
          .map((one) => ({ symbol: one.symbol, condition: one.label, value: one.value, at: new Date(one.at).toISOString() }))
      }
    }
  })

  control.register({
    id: 'market.alertCreate',
    domain: 'markets',
    name: 'Create a market alert',
    description:
      'Sets an alert on a market. Judged against arriving prices, so it fires when the market does. Needs a threshold — Orbis will not invent one.',
    params: {
      market: str('A name, ticker, or instrument id.', true),
      subject: str('price, change-percent or volume. Default price.'),
      comparison: str('above, below, crosses-above, crosses-below, at-or-above or at-or-below. Default crosses-above.', true),
      value: num('The threshold to compare against.', true),
      label: str('What to call it.')
    },
    mutates: true,
    // Always: an alert is a standing instruction that will interrupt somebody later, and "alert me when bitcoin moves"
    // heard slightly wrong should not quietly become one.
    confirmation: 'always',
    describe: (params) =>
      `Alert when ${String(params.market)} ${String(params.subject ?? 'price')} ${String(params.comparison ?? 'crosses-above')} ${String(params.value)}`,
    run: async (params) => {
      await needEnabled()
      const profileId = await d.profileId()
      const instrument = await needOne(String(params.market ?? ''))

      const value = Number(params.value)
      // Refused rather than defaulted: an alert with a made-up threshold is one nobody asked for.
      if (!Number.isFinite(value)) fail('invalid-params', 'That alert needs a number to compare against.')

      const subjectKind = String(params.subject ?? 'price')
      const subject =
        subjectKind === 'change-percent' || subjectKind === 'volume' ? { kind: subjectKind } : { kind: 'price' as const }
      const comparisons = ['above', 'below', 'crosses-above', 'crosses-below', 'at-or-above', 'at-or-below']
      const asked = String(params.comparison ?? 'crosses-above')
      const comparison = comparisons.includes(asked) ? asked : 'crosses-above'

      const saved = await store.saveAlert(profileId, {
        id: randomUUID(),
        instrumentId: instrument.instrumentId,
        label: String(params.label ?? '').slice(0, 80),
        subject,
        comparison,
        value,
        repeat: 'once',
        cooldownMs: 5 * 60_000,
        dailyLimit: 0,
        enabled: true
      })
      if (!saved) fail('invalid-params', 'That is not a condition Orbis can judge.')
      const alert = saved as NonNullable<typeof saved>
      await store.remember(profileId, [instrument])
      if (engine.quote(instrument.instrumentId) === null) await engine.refresh([instrument.instrumentId])
      return { created: describeAlert(alert, instrument.symbol), id: alert.id }
    }
  })

  // ---------------------------------------------------------------- the simulated portfolio

  control.register({
    id: 'market.portfolio',
    domain: 'markets',
    name: 'The simulated portfolio',
    description:
      'What the paper-trading account holds and how it has done. Always simulated: none of it is a real position and no order here has ever reached an exchange.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const profileId = await d.profileId()
      const held = await store.paper(profileId)
      if (!held) return { account: null, note: 'No simulated account has been started.' }

      const prices = new Map<string, number | null>()
      for (const position of held.account.positions) {
        prices.set(position.instrumentId, engine.quote(position.instrumentId)?.last ?? null)
      }
      const value = valueOf(held.account, prices)
      const view = portfolioView(held.account, prices, held.equity)
      const symbolFor = async (id: string): Promise<string> => (await engine.instrument(id))?.symbol ?? id

      return {
        simulated: true,
        currency: held.account.currency,
        total: value.total,
        cash: value.cash,
        unrealised: value.unrealised,
        realised: value.realised,
        returnPercent: value.returnPercent,
        positions: await Promise.all(
          view.allocation.positions.map(async (one) => ({
            symbol: await symbolFor(one.instrumentId),
            quantity: one.quantity,
            averagePrice: one.averagePrice,
            price: one.price,
            unrealised: one.unrealised,
            sharePercent: one.share
          }))
        ),
        completedTrades: view.performance.trades,
        winRatePercent: view.performance.winRate,
        maxDrawdownPercent: view.equity.drawdown.maxPercent,
        // Missing prices are named, so a total is never read as complete when it is not.
        unpricedPositions: value.missingPrices.length,
        assumptions: PAPER_ASSUMPTIONS
      }
    }
  })

  control.register({
    id: 'market.paperOrder',
    domain: 'markets',
    name: 'Place a simulated order',
    description:
      'Places an order in the paper-trading account. SIMULATED — it reaches Orbis’s own simulation and nothing else. There is no exchange credential in Orbis for it to use.',
    params: {
      market: str('A name, ticker, or instrument id.', true),
      side: str('buy or sell.', true),
      quantity: num('How many units.', true),
      type: str('market or limit. Default market.'),
      limitPrice: num('Required for a limit order.')
    },
    mutates: true,
    // Always, without exception. An instruction that sounds like a trade is confirmed as one even though it is a
    // simulation: a misheard "buy bitcoin" should not become an order nobody meant, and somebody should never be able to
    // say afterwards that they did not know it had happened.
    confirmation: 'always',
    describe: (params) =>
      `SIMULATED ${String(params.side)} ${String(params.quantity)} of ${String(params.market)}${params.limitPrice ? ` at a limit of ${String(params.limitPrice)}` : ''} in the paper account`,
    run: async (params) => {
      await needEnabled()
      const profileId = await d.profileId()
      const account = await store.paper(profileId)
      if (!account) fail('unavailable', 'There is no simulated account. Start one on the Markets portfolio screen first.')
      const held = account as NonNullable<typeof account>

      const instrument = await needOne(String(params.market ?? ''))
      const asked = String(params.side ?? '')
      if (asked !== 'buy' && asked !== 'sell') fail('invalid-params', 'Buy or sell?')
      const side: Side = asked === 'sell' ? 'sell' : 'buy'
      const quantity = Number(params.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) fail('invalid-params', 'A quantity has to be a positive number.')

      const type = String(params.type ?? 'market') === 'limit' ? 'limit' : 'market'
      const limitPrice = Number(params.limitPrice)
      if (type === 'limit' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
        fail('invalid-params', 'A limit order needs a limit price.')
      }

      if (engine.quote(instrument.instrumentId) === null) await engine.refresh([instrument.instrumentId])
      const outcome = place(
        held.account,
        {
          id: randomUUID(),
          instrumentId: instrument.instrumentId,
          side,
          type,
          quantity,
          limitPrice: type === 'limit' ? limitPrice : undefined,
          placedAt: Date.now()
        },
        engine.quote(instrument.instrumentId),
        held.settings
      )
      await store.setPaperAccount(profileId, outcome.account)
      await store.remember(profileId, [instrument])

      return {
        simulated: true,
        state: outcome.order.state,
        detail: outcome.detail,
        symbol: instrument.symbol,
        filledPrice: outcome.order.filledPrice ?? null,
        fee: outcome.order.fee ?? null,
        note: 'This was a simulated order in Orbis’s paper account. Nothing was sent to any exchange.'
      }
    }
  })

  // ---------------------------------------------------------------- strategies

  control.register({
    id: 'market.strategies',
    domain: 'markets',
    name: 'Saved strategies',
    description: 'Every saved strategy, what its rules say in words, and why any of them cannot be run.',
    params: {},
    mutates: false,
    confirmation: 'none',
    run: async () => {
      const profileId = await d.profileId()
      const strategies = await store.strategies(profileId)
      return {
        strategies: await Promise.all(
          strategies.map(async (one) => ({
            id: one.id,
            name: one.name,
            version: one.version,
            market: (await engine.instrument(one.instrumentId))?.symbol ?? one.instrumentId,
            interval: one.interval,
            rules: describeStrategy(one),
            problems: problemsWith(one)
          }))
        )
      }
    }
  })

  control.register({
    id: 'market.backtest',
    domain: 'markets',
    name: 'Backtest a strategy',
    description:
      'Runs a saved strategy over real past candles and returns what it would have done, with the assumptions it was run under. Historical and simulated: not a prediction.',
    params: { strategy: str('The strategy’s name or id.', true), bars: num('How much history, in bars. Default 500.') },
    mutates: false,
    confirmation: 'none',
    run: async (params) => {
      await needEnabled()
      const profileId = await d.profileId()
      const wanted = String(params.strategy ?? '').trim().toLowerCase()
      const strategies = await store.strategies(profileId)
      const found = strategies.find((one) => one.id === wanted || one.name.toLowerCase() === wanted)
      if (!found) fail('not-found', 'There is no saved strategy by that name.')
      const strategy = found as NonNullable<typeof found>

      const problems = problemsWith(strategy)
      if (problems.length > 0) fail('invalid-params', problems[0])

      const interval = strategy.interval as Interval
      if (!INTERVALS.includes(interval)) fail('unavailable', `Orbis does not have candles at "${strategy.interval}".`)
      const bars = Math.min(1000, Math.max(50, Math.round(Number(params.bars) || 500)))
      const candles = await engine.candlesFor(strategy.instrumentId, interval, bars)
      if (candles.length < 3) fail('unavailable', 'There is too little history to test this against.')

      const result = backtest(strategy, candles, { startingCash: 10_000 })
      return {
        strategy: strategy.name,
        version: strategy.version,
        market: (await engine.instrument(strategy.instrumentId))?.symbol ?? strategy.instrumentId,
        rules: describeStrategy(strategy),
        bars: result.bars,
        from: new Date(result.from).toISOString(),
        to: new Date(result.to).toISOString(),
        trades: result.trades.length,
        returnPercent: result.stats.totalReturnPercent,
        // The comparison that puts the return in context, in the same answer so it cannot be summarised away.
        buyAndHoldPercent: result.stats.benchmarkReturnPercent,
        maxDrawdownPercent: result.stats.maxDrawdownPercent,
        winRatePercent: result.stats.performance.winRate,
        sharpe: result.stats.sharpe,
        ambiguousExits: result.ambiguousExits,
        assumptions: BACKTEST_ASSUMPTIONS,
        warnings: result.warnings,
        note: 'Simulated over past candles under the assumptions above. Past behaviour is not a forecast.'
      }
    }
  })

  // ---------------------------------------------------------------- showing it

  control.register({
    id: 'market.open',
    domain: 'markets',
    name: 'Open a market on screen',
    description: 'Brings a market up on the Markets screen so it can be looked at.',
    params: { market: str('A name, ticker, or instrument id.', true), section: str('chart, book or trades. Default chart.') },
    mutates: true,
    confirmation: 'none',
    describe: (params) => `Open ${String(params.market)} on the Markets screen`,
    run: async (params) => {
      await needEnabled()
      const instrument = await needOne(String(params.market ?? ''))
      const section = ['chart', 'book', 'trades'].includes(String(params.section ?? '')) ? String(params.section) : 'chart'
      const shown = await d.show(instrument.instrumentId, section)
      if (!shown) fail('unavailable', 'The Orbis window is not open to show it in.')
      return { opened: instrument.symbol, section }
    }
  })
}
