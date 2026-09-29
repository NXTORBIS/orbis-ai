import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickChart,
  Activity,
  BarChart3,
  ChevronDown,
  GraduationCap,
  Eye,
  BellRing,
  Briefcase,
  FlaskConical,
  Flame,
  History,
  Newspaper,
  LineChart,
  SlidersHorizontal,
  ListPlus,
  Plus,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
  GitCompareArrows,
  Gauge,
  LayoutGrid,
  Zap
} from 'lucide-react'
import MarketChart, { compactNumber, type ChartIndicator, type ChartType } from './markets/MarketChart'
import ScreenerPanel from './markets/ScreenerPanel'
import AlertsPanel from './markets/AlertsPanel'
import PortfolioPanel from './markets/PortfolioPanel'
import BacktestPanel from './markets/BacktestPanel'
import ReplayPanel from './markets/ReplayPanel'
import NewsPanel from './markets/NewsPanel'
import { baseOf } from '../../../shared/markets/news'
import AssetLogo from './markets/AssetLogo'
import CurrencyPicker from './markets/CurrencyPicker'
import MarketsOnboarding from './markets/MarketsOnboarding'
import { Explain } from './markets/Explain'
import TapePanel from './markets/TapePanel'
import DerivativesPanel from './markets/DerivativesPanel'
import BookPanel from './markets/BookPanel'
import DrawingToolbar, { draftDrawing } from './markets/DrawingToolbar'
import ComparePanel from './markets/ComparePanel'
import MarginPanel from './markets/MarginPanel'
import TriggersPanel from './markets/TriggersPanel'
import { PatternsPanel } from './markets/PatternsPanel'
import { PatternLibraryPanel } from './markets/PatternLibraryPanel'
import { PatternAlertsPanel } from './markets/PatternAlertsPanel'
import { PatternHistoryPanel } from './markets/PatternHistoryPanel'
import type { PatternMarker } from './markets/MarketChart'
import PanelWorkspace from './markets/PanelWorkspace'
import type { Drawing, DrawingKind } from '../../../shared/markets/drawings'
import { useCurrency } from './markets/useCurrency'
import { useExperience } from './markets/useExperience'
import { primarySections, type Section } from '../../../shared/markets/experience'
import { assetOf } from '../../../shared/markets/assets'
import { availableIndicators, indicatorInfo, type Candle, type IndicatorKind } from '../../../shared/markets/indicators'
import type { Instrument, QuoteView } from '../../../shared/markets/instrument'
import type { Watchlist } from '../../../shared/markets/workspace'
import type { DiscoveryAnswer, MarketDetail, WatchlistsAnswer } from '../../../main/markets/ipc'
import type { MarketRow } from '../../../shared/markets/discovery'
import type { NoticeKind } from '../App'

/**
 * Markets.
 *
 * One screen over the market engine: what is moving, what is being watched, and one market in as much detail as its
 * provider can honestly supply. Every number here came from a provider through the engine — this file formats and arranges,
 * and calculates nothing about a market itself.
 *
 * The rule that shapes most of the code below: **a missing value is shown as missing.** A pair with no reported 24-hour
 * change gets a dash, not a zero; a provider with no order book gets a sentence saying so, not an empty table; a price that
 * has stopped arriving is labelled stale rather than left looking live. That is why so many of these fields are
 * `number | null` and why every panel has a state for "the provider cannot answer this".
 *
 * Panels ask for what they need and release it. Opening a market starts a subscription and leaving it stops one, so the
 * screen costs a stream while it is open and nothing once it is closed.
 */

type Tab = 'overview' | 'chart' | 'book' | 'trades' | 'derivatives' | 'compare' | 'margin' | 'triggers' | 'patterns'
type Pane = 'dashboard' | 'watchlists' | 'favourites'
/**
 * Which of the three screens Markets is showing.
 *
 * The screener and the alerts are full-width: a table of twelve columns and a condition builder do not belong in a
 * 320-pixel rail beside a chart.
 */
type Mode = 'markets' | 'screener' | 'alerts' | 'portfolio' | 'backtest' | 'replay' | 'news'

/**
 * What each section is called and what it looks like.
 *
 * Separate from the order they appear in, because the order is the experience's decision and this is not. One table, so
 * a section tucked behind "More" is the same section with the same name and the same icon.
 */
const SECTION_LOOK: Record<Section, { label: string; icon: typeof LineChart }> = {
  markets: { label: 'Markets', icon: LineChart },
  screener: { label: 'Screener', icon: SlidersHorizontal },
  alerts: { label: 'Alerts', icon: BellRing },
  portfolio: { label: 'Portfolio', icon: Briefcase },
  backtest: { label: 'Strategies', icon: FlaskConical },
  replay: { label: 'Replay', icon: History },
  news: { label: 'News', icon: Newspaper }
}

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'candles', label: 'Candles' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'ohlc', label: 'OHLC' }
]

const refused = (value: unknown): value is { error: string; message?: string } =>
  typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string'

/**
 * How many decimals a price deserves.
 *
 * From the price itself, because the provider's tick size is not always given and a fixed two decimals would hide all the
 * movement in a token quoted at 0.000012 while adding meaningless noise to one at 84,000.
 */
const precisionFor = (price: number | null | undefined): number => {
  if (typeof price !== 'number' || !Number.isFinite(price)) return 2
  const abs = Math.abs(price)
  if (abs >= 1000) return 2
  if (abs >= 1) return 4
  if (abs >= 0.01) return 6
  return 8
}

/**
 * A quantity of an asset — not money.
 *
 * Crypto amounts and currency amounts need different rules: 0.00001234 BTC and ₹1,234.56 are both correct and neither
 * formatting would suit the other. Money goes through the currency hook; coin counts are formatted in the panel that
 * shows them, because what precision reads well depends on the table it is in.
 */
const percent = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(2)}%` : '—'

/** Up, down or neither — and "neither" also covers "not known", which is why the caller must check for null first. */
const direction = (value: number | null | undefined): 'up' | 'down' | 'flat' =>
  typeof value !== 'number' || !Number.isFinite(value) || value === 0 ? 'flat' : value > 0 ? 'up' : 'down'

const FRESHNESS_LABEL: Record<string, string> = {
  'real-time': 'Live',
  delayed: 'Delayed',
  stale: 'Stale',
  unavailable: 'Unavailable'
}

/** Direction as a glyph as well as a colour, so it reads without colour vision. */
function Move({ value }: { value: number | null | undefined }): React.JSX.Element {
  const way = direction(value)
  return (
    <span className={`mk-change ${way}`}>
      {typeof value !== 'number' || !Number.isFinite(value) ? (
        '—'
      ) : (
        <>
          <span aria-hidden="true">{way === 'up' ? '▲' : way === 'down' ? '▼' : '—'}</span>
          {percent(value)}
        </>
      )}
    </span>
  )
}

function Freshness({ quote }: { quote: QuoteView | null }): React.JSX.Element {
  const state = quote?.freshness ?? 'unavailable'
  const age = quote ? Math.max(0, Math.round(quote.ageMs / 1000)) : null
  return (
    <span className={`mk-fresh is-${state}`} title={age === null ? 'No price has arrived' : `Updated ${age}s ago`}>
      {FRESHNESS_LABEL[state] ?? state}
    </span>
  )
}

export default function MarketsView({
  onClose,
  onNotify
}: {
  onClose(): void
  onNotify(message: string, kind?: NoticeKind): void
}): React.JSX.Element {
  /**
   * What money is shown in.
   *
   * One hook for the whole screen: every price below is formatted through it, so nothing here can quote a converted
   * figure under the wrong symbol or claim a conversion that could not be made.
   */
  const currency = useCurrency()
  /**
   * How much of Markets is on screen, how much is explained, and in whose words.
   *
   * One hook for the whole screen, and the only thing below that decides any of it: nothing here asks whether somebody is
   * a beginner, it asks whether the advanced toolbar is wanted. That is what keeps one Markets from becoming two.
   */
  const experience = useExperience()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  /** True while the first-launch questions are on screen, so the rest of Markets is not built behind them. */
  const [settingUp, setSettingUp] = useState(false)
  /** The sections that did not fit in the header, when somebody's level keeps the advanced half one click away. */
  const [moreOpen, setMoreOpen] = useState(false)
  /** Timeframes beyond the ones somebody said they use. Never removed — one button away. */
  const [allIntervals, setAllIntervals] = useState(false)
  /** Markets marked as favourites, and the ones just looked at. Ids only: the instruments live in the engine. */
  const [favourites, setFavourites] = useState<string[]>([])
  const [recent, setRecent] = useState<string[]>([])
  const [connection, setConnection] = useState('')
  const [mode, setMode] = useState<Mode>('markets')
  const [pane, setPane] = useState<Pane>('dashboard')
  const [tab, setTab] = useState<Tab>('overview')
  /**
   * The formations to mark on the chart, and which is picked.
   *
   * Held here rather than in either place that uses them, so the chart draws exactly what the patterns panel lists.
   * Two independent copies would eventually disagree, and a marker on a candle the list does not mention is worse than
   * no marker at all.
   */
  const [patternMarkers, setPatternMarkers] = useState<PatternMarker[]>([])
  const [patternPicked, setPatternPicked] = useState<string | null>(null)
  const [patternView, setPatternView] = useState<'found' | 'library' | 'alerts' | 'history'>('found')
  /**
   * Whether Markets shows one market in depth or several panels at once.
   *
   * A view of the same section rather than a section of its own: the workspace shows the market that is open, arranged
   * differently. Making it a separate section would have meant a second place that owns "which market am I looking at",
   * and the two would eventually disagree.
   */
  const [workspace, setWorkspace] = useState(false)
  /** The annotations on the open market, and which tool is armed. Loaded per market, never carried between them. */
  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [drawTool, setDrawTool] = useState<DrawingKind | null>(null)
  const [drawSelected, setDrawSelected] = useState<string | null>(null)

  const [discovery, setDiscovery] = useState<DiscoveryAnswer | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [moverKind, setMoverKind] = useState<'gainers' | 'losers' | 'volume'>('gainers')

  const [lists, setLists] = useState<Watchlist[]>([])
  const [listQuotes, setListQuotes] = useState<Record<string, QuoteView | null>>({})
  const [activeList, setActiveList] = useState<string | null>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Instrument[]>([])
  const [searching, setSearching] = useState(false)

  const [open, setOpen] = useState<MarketDetail | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [interval, setInterval_] = useState('1h')
  const [chartType, setChartType] = useState<ChartType>('candles')
  const [indicators, setIndicators] = useState<ChartIndicator[]>([])
  const [candleNote, setCandleNote] = useState('')
  const [loadingCandles, setLoadingCandles] = useState(false)
  const [hovered, setHovered] = useState<{ candle: Candle | null; values: { label: string; value: number | null }[] }>({
    candle: null,
    values: []
  })

  const [tradeNote, setTradeNote] = useState('')

  /** Every price on this screen goes through here, so none of them can disagree about the currency. */
  const cash = (value: number | null | undefined, _currency?: string): string => currency.money(value).text

  const openId = open?.instrument.instrumentId ?? null

  /** A short label for a market id. The same reading the recents list uses, so the two cannot disagree. */
  const symbolOf = useCallback(
    (id: string): string => id.split(':').pop()?.toUpperCase() ?? id,
    []
  )

  /**
   * The annotations for the open market.
   *
   * Cleared before the fetch rather than after it, so switching markets never shows the previous market's lines over
   * the new one's candles -- which would be the one thing a drawing must never do.
   */
  useEffect(() => {
    setDrawings([])
    setDrawSelected(null)
    setDrawTool(null)
    if (!openId) return
    let cancelled = false
    void window.api.marketsDrawings(openId).then((result) => {
      if (cancelled || refused(result)) return
      setDrawings(result.drawings)
    })
    return () => {
      cancelled = true
    }
  }, [openId])
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** So leaving the screen releases what it was holding even if React unmounts it without warning. */
  const holding = useRef<string | null>(null)
  /** So the saved layout is restored once and does not then fight what somebody is doing. */
  const restored = useRef(false)

  const complain = useCallback(
    (answer: unknown, fallback: string): boolean => {
      if (!refused(answer)) return false
      onNotify(answer.message ?? fallback, 'error')
      return true
    },
    [onNotify]
  )

  // ---------------------------------------------------------------- the switch

  const readState = useCallback(async () => {
    const answer = await window.api.marketsState()
    if (refused(answer)) {
      setEnabled(false)
      return
    }
    setEnabled(answer.enabled)
    setConnection(answer.connection)
  }, [])

  useEffect(() => {
    void readState()
  }, [readState])

  const readFavourites = useCallback(async () => {
    const got = await window.api.marketsFavourites()
    if (refused(got)) return
    setFavourites(got.favourites.map((one) => one.instrumentId))
    setRecent(got.recent.map((one) => one.instrumentId))
  }, [])

  useEffect(() => {
    if (enabled !== true) return
    void readFavourites()
  }, [enabled, readFavourites])

  /** Marks a market, or unmarks it. The answer comes back from the store rather than being guessed at here. */
  const toggleFavourite = useCallback(
    async (instrumentId: string) => {
      const got = await window.api.marketsToggleFavourite(instrumentId)
      if (refused(got)) return
      setFavourites((held) => (got.favourite ? [...held, instrumentId] : held.filter((one) => one !== instrumentId)))
    },
    []
  )

  // ---------------------------------------------------------------- discovery

  const discover = useCallback(async () => {
    setDiscovering(true)
    try {
      const answer = await window.api.marketsDiscover({ limit: 8, tiles: 40 })
      if (refused(answer)) {
        setDiscovery(null)
        return
      }
      setDiscovery(answer)
      setConnection(answer.connection)
    } finally {
      setDiscovering(false)
    }
  }, [])

  const loadLists = useCallback(async () => {
    const answer = await window.api.marketsWatchlists()
    if (refused(answer)) return
    apply(answer)
  }, [])

  const apply = (answer: WatchlistsAnswer): void => {
    setLists(answer.watchlists)
    setListQuotes(Object.fromEntries(answer.quotes.map((q) => [q.instrumentId, q.quote])))
    setActiveList((current) => current ?? answer.watchlists[0]?.id ?? null)
  }

  useEffect(() => {
    if (enabled !== true) return
    void discover()
    void loadLists()
  }, [enabled, discover, loadLists])

  /**
   * Prices for everything on screen, on a timer.
   *
   * The engine is already streaming these; this only asks it what it currently holds, which is why it is a cheap call and
   * why the interval is short. It is not a request to a provider.
   */
  useEffect(() => {
    if (enabled !== true) return
    const ids = new Set<string>()
    for (const list of lists) for (const item of list.items) ids.add(item.instrumentId)
    if (openId) ids.add(openId)
    // Even with nothing to price, the connection is still worth asking about: an empty screen that claims to be
    // disconnected when the provider is fine is as wrong as the other way round.
    const wanted = [...ids]

    const tick = async (): Promise<void> => {
      const answer = await window.api.marketsQuotes(wanted)
      if (refused(answer)) return
      // Kept in step with the prices, so the header cannot say "Disconnected" above a row that is updating.
      setConnection(answer.connection)
      setListQuotes((current) => {
        const next = { ...current }
        for (const one of answer.quotes) next[one.instrumentId] = one.quote
        return next
      })
      setOpen((current) => {
        if (!current) return current
        const found = answer.quotes.find((q) => q.instrumentId === current.instrument.instrumentId)
        return found ? { ...current, quote: found.quote } : current
      })
    }
    void tick()

    /**
     * Prices arrive; they are not asked for.
     *
     * Every tick off the provider's socket reaches here as it happens, batched by the main process to one screen
     * refresh. The timer below is no longer how prices update -- it is a slow safety net for the things a tick
     * stream does not carry (a market opening, an instrument being added elsewhere, a socket that dropped and came
     * back), and it runs every thirty seconds instead of every two.
     */
    const offTick = window.api.onMarketsTick((events) => {
      if (!Array.isArray(events) || events.length === 0) return
      const quotes = new Map<string, QuoteView>()
      for (const one of events) {
        const event = one as { type?: string; instrumentId?: string; quote?: QuoteView }
        if (event.type !== 'quote' || typeof event.instrumentId !== 'string' || !event.quote) continue
        quotes.set(event.instrumentId, event.quote)
      }
      if (quotes.size === 0) return
      setListQuotes((current) => {
        // Only the instruments that actually ticked, so a busy market does not redraw rows that did not move.
        let changed = false
        const next: typeof current = { ...current }
        for (const [id, quote] of quotes) {
          if (next[id] === quote) continue
          next[id] = quote
          changed = true
        }
        return changed ? next : current
      })
      setOpen((current) => {
        if (!current) return current
        const fresh = quotes.get(current.instrument.instrumentId)
        return fresh ? { ...current, quote: fresh } : current
      })
    })

    const timer = window.setInterval(() => void tick(), 30_000)
    return () => {
      offTick()
      window.clearInterval(timer)
    }
  }, [enabled, lists, openId])

  // ---------------------------------------------------------------- search

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const wanted = query.trim()
    if (wanted.length < 2) {
      setResults([])
      return
    }
    searchTimer.current = setTimeout(() => {
      setSearching(true)
      void window.api
        .marketsSearch(wanted)
        .then((answer) => setResults(refused(answer) ? [] : answer.results))
        .finally(() => setSearching(false))
    }, 250)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [query])

  // ---------------------------------------------------------------- opening a market

  const loadCandles = useCallback(
    async (instrumentId: string, wanted: string, limit = 300) => {
      setLoadingCandles(true)
      try {
        const answer = await window.api.marketsCandles(instrumentId, wanted, limit)
        if (refused(answer)) {
          setCandles([])
          // The provider's own reason, so "no 5-minute candles" does not look like a bug in the chart.
          setCandleNote(answer.message ?? 'No historical data.')
          return
        }
        setCandles(answer.candles)
        setCandleNote(answer.candles.length === 0 ? 'The provider returned no candles for this period.' : '')
      } finally {
        setLoadingCandles(false)
      }
    },
    []
  )

  const openMarket = useCallback(
    /**
     * Opens a market.
     *
     * `preferInterval` matters more than it looks: restoring a saved layout sets the interval and then opens the market,
     * but this callback closed over the interval as it was *before* that set had been applied — so a restored 4h chart
     * came back as 1h. Passing it in means the caller's choice wins over a stale closure.
     */
    async (instrumentId: string, preferInterval?: string) => {
      // The previous market stops costing a subscription before the next one starts one.
      if (holding.current && holding.current !== instrumentId) {
        void window.api.marketsClose(holding.current)
      }
      const answer = await window.api.marketsOpen(instrumentId)
      if (complain(answer, 'That market could not be opened.')) return
      const detail = answer as MarketDetail
      holding.current = instrumentId
      setOpen(detail)
      setQuery('')
      setResults([])
      setTradeNote('')
      setCandles([])
      setCandleNote('')
      setTab('chart')

      const asked = preferInterval ?? interval
      const wanted = detail.can.intervals.includes(asked as never) ? asked : (detail.can.intervals[0] ?? '1h')
      setInterval_(wanted)
      if (detail.can.candles) await loadCandles(instrumentId, wanted)
      else setCandleNote('This provider has no historical data, so there is no chart to draw.')
    },
    [complain, interval, loadCandles]
  )

  /**
   * Orion, the Orb or a workflow asking for a market.
   *
   * The screen follows rather than being told twice: whatever asked has already resolved the instrument, so this only
   * has to show it.
   */
  useEffect(() => {
    return window.api.onMarketsShow(({ instrumentId, section }) => {
      setMode('markets')
      void openMarket(instrumentId).then(() => {
        if (section === 'book' || section === 'trades' || section === 'chart') setTab(section)
      })
    })
    // `openMarket` is stable enough for this: it is recreated only when the chosen interval changes, and reattaching a
    // listener then is harmless.
  }, [openMarket])

  /**
   * Comes back where it was left.
   *
   * Once, on opening. Restoring later would fight whatever the person is doing, and restoring a market that has since
   * been delisted quietly does nothing rather than showing an error about a screen nobody asked for.
   */
  useEffect(() => {
    // Waits for the experience as well as the switch: opening on the default chart and then correcting it a moment later
    // would be the interface visibly changing its mind about what somebody asked for.
    if (enabled !== true || experience.loading || restored.current) return
    restored.current = true

    /*
     * Where Markets was left beats what the experience would have chosen.
     *
     * A saved layout is the last thing somebody actually did, and a preset is a guess about what they would like. So the
     * experience supplies the defaults for anything the layout does not have, and never replaces anything it does.
     */
    const fromExperience = (): void => {
      setChartType(experience.get('chartType') as ChartType)
      setInterval_(experience.get('defaultInterval'))
      setIndicators(
        experience.get('defaultIndicators').map((kind) => ({
          kind: kind as IndicatorKind,
          options: { ...(indicatorInfo(kind as IndicatorKind)?.defaults ?? {}) }
        }))
      )
      const landing = experience.get('landing')
      if (landing === 'news' || landing === 'screener' || landing === 'portfolio') setMode(landing)
      // The half of a market page somebody asked to see first.
      if (experience.get('showTrades')) setTab('trades')
      else if (experience.get('showOrderBook')) setTab('book')
    }

    void window.api.marketsLayout().then((got) => {
      if (refused(got)) {
        fromExperience()
        return
      }
      const hadLayout = Boolean(got.instrumentId) || got.indicators.length > 0
      if (!hadLayout) fromExperience()
      if (got.section && got.section !== 'markets') setMode(got.section as Mode)
      if (got.chartType) setChartType(got.chartType as ChartType)
      if (got.interval) setInterval_(got.interval)
      if (got.indicators?.length) {
        setIndicators(got.indicators.map((one) => ({ kind: one.kind as IndicatorKind, options: one.options })))
      }
      if (got.instrumentId) {
        void openMarket(got.instrumentId, got.interval).then(() => {
          if (got.tab === 'book' || got.tab === 'trades' || got.tab === 'chart') setTab(got.tab)
        })
      }
    })
    // `experience` is deliberately read rather than watched: this runs once, and re-running it after a preference change
    // would restore a chart over whatever somebody is doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, experience.loading, openMarket])

  /**
   * Remembers where Markets is, a moment after it changes.
   *
   * Debounced, because dragging a chart's interval through four values should be one write rather than four.
   */
  useEffect(() => {
    if (enabled !== true || !restored.current) return
    const timer = setTimeout(() => {
      void window.api.marketsSetLayout({
        section: mode,
        instrumentId: openId ?? '',
        tab,
        interval,
        chartType,
        indicators: indicators.map((one) => ({ kind: one.kind, options: one.options }))
      })
    }, 800)
    return () => clearTimeout(timer)
  }, [enabled, mode, openId, tab, interval, chartType, indicators])

  const closeMarket = useCallback(() => {
    if (holding.current) void window.api.marketsClose(holding.current)
    holding.current = null
    setOpen(null)
    setCandles([])
  }, [])

  // Leaving the screen releases the subscription. Without this the engine would keep streaming a market for a page that
  // has gone.
  useEffect(
    () => () => {
      if (holding.current) {
        void window.api.marketsTapeClose(holding.current)
        void window.api.marketsClose(holding.current)
        holding.current = null
      }
    },
    []
  )

  // ---------------------------------------------------------------- depth and tape

  // The book belongs to its own panel now: it holds the depth subscription, reads the engine's keeper and knows whether
  // what it is showing is provably current. Nothing about it is duplicated here.

  useEffect(() => {
    if (!openId || tab !== 'trades') return
    if (!open?.can.trades) {
      setTradeNote('This provider does not serve individual trades.')
      return
    }
    let stopped = false
    void window.api.marketsTapeOpen(openId, 50).then((answer) => {
      if (stopped) return
      if (refused(answer)) {
        setTradeNote(answer.message ?? 'The tape could not be opened.')
        return
      }
      setTradeNote('')
    })
    // No polling here: this effect's whole job is to hold the subscription open. The panel reads the prints itself, so
    // adding a timer would be fetching the same tape twice.
    return () => {
      stopped = true
      // The trade stream stops when the panel does: a busy pair sends several prints a second and nothing is reading them.
      void window.api.marketsTapeClose(openId)
    }
  }, [openId, tab, open?.can.trades])

  // ---------------------------------------------------------------- watchlists

  const addTo = async (listId: string, instrumentId: string): Promise<void> => {
    const answer = await window.api.marketsWatchlistAdd(listId, instrumentId)
    if (complain(answer, 'That could not be added.')) return
    apply(answer as WatchlistsAnswer)
    if (openId === instrumentId) {
      const again = await window.api.marketsDetail(instrumentId)
      if (!refused(again)) setOpen(again as MarketDetail)
    }
    onNotify('Added to the watchlist')
  }

  const newList = async (): Promise<void> => {
    const name = window.prompt('Name this watchlist')
    if (name === null) return
    const answer = await window.api.marketsWatchlistCreate(name.trim() || 'Watchlist')
    if (complain(answer, 'That watchlist could not be created.')) return
    const next = answer as WatchlistsAnswer
    apply(next)
    setActiveList(next.watchlists[next.watchlists.length - 1]?.id ?? null)
  }

  const list = lists.find((l) => l.id === activeList) ?? lists[0] ?? null

  // ---------------------------------------------------------------- indicators

  const offered = useMemo(() => availableIndicators(candles), [candles])

  const addIndicator = (kind: IndicatorKind): void => {
    const info = indicatorInfo(kind)
    setIndicators((current) =>
      current.some((one) => one.kind === kind) ? current : [...current, { kind, options: { ...(info?.defaults ?? {}) } }]
    )
  }

  /**
   * Which sections are in the header, and which are behind "More".
   *
   * Whatever is open is always in the header, however somebody's level would have arranged it: a section you are looking
   * at should not be hidden behind a menu.
   */
  const primary = useMemo(() => {
    const wanted = primarySections(experience.settings)
    return wanted.includes(mode as Section) ? wanted : [...wanted, mode as Section]
  }, [experience.settings, mode])

  const tucked = useMemo(
    () => (Object.keys(SECTION_LOOK) as Section[]).filter((one) => !primary.includes(one)),
    [primary]
  )

  /**
   * The timeframes on the chart bar.
   *
   * The ones somebody said they use, where the provider serves them, and everything the provider serves otherwise. The
   * rest are one button away rather than gone — this narrows a row of buttons, it does not narrow what Markets can draw.
   */
  const shownIntervals = useMemo(() => {
    const served = open?.can.intervals ?? []
    if (allIntervals || experience.get('chartAdvancedToolbar')) return served
    const wanted = experience.get('quickIntervals') as readonly string[]
    const quick: string[] = served.filter((one) => wanted.includes(one))
    // The one that is open stays visible, or choosing "All" and then a slow timeframe would make the button vanish.
    const withOpen = quick.includes(interval) || !(served as readonly string[]).includes(interval) ? quick : [...quick, interval]
    return withOpen.length > 0 ? served.filter((one) => withOpen.includes(one)) : served
  }, [open, allIntervals, experience, interval])

  const quote = open?.quote ?? null
  const price = quote?.last ?? null
  const pricePrecision = precisionFor(price)

  // ---------------------------------------------------------------- rows

  const Row = ({ row, rank }: { row: MarketRow; rank?: number }): React.JSX.Element => (
    <li className="mk-row">
      {rank !== undefined && <span className="mk-rank">{rank}</span>}
      <button type="button" className="mk-row-name" onClick={() => void openMarket(row.instrument.instrumentId)}>
        <AssetLogo instrument={row.instrument} size="small" />
        <b>{row.instrument.symbol}</b>
        <span className="mk-name">{row.instrument.name}</span>
      </button>
      <span className="mk-price">{cash(row.quote.last)}</span>
      <Move value={row.quote.changePercent} />
      <button
        type="button"
        className={`mk-fav${favourites.includes(row.instrument.instrumentId) ? ' on' : ''}`}
        aria-label={`${favourites.includes(row.instrument.instrumentId) ? 'Remove' : 'Add'} ${row.instrument.symbol} ${favourites.includes(row.instrument.instrumentId) ? 'from' : 'to'} favourites`}
        aria-pressed={favourites.includes(row.instrument.instrumentId)}
        onClick={() => void toggleFavourite(row.instrument.instrumentId)}
      >
        <Star size={12} />
      </button>
      <span className="mk-vol" title="Value traded over the provider’s 24-hour window">
        {(() => {
          const turnover = row.quote.quoteVolume ?? (row.quote.volume !== null && row.quote.last !== null ? row.quote.volume * row.quote.last : null)
          return turnover === null ? '—' : compactNumber(turnover)
        })()}
      </span>
      {list && (
        <button
          type="button"
          className="tl-icon"
          aria-label={`Add ${row.instrument.symbol} to ${list.name}`}
          title={`Add to ${list.name}`}
          onClick={() => void addTo(list.id, row.instrument.instrumentId)}
        >
          <Star size={13} />
        </button>
      )}
    </li>
  )

  // ---------------------------------------------------------------- the first launch

  /**
   * Shown once, per profile, before the rest of Markets is built.
   *
   * Before rather than over: the panels behind it would subscribe to prices, open a stream and fetch candles for a screen
   * nobody has reached yet. `needsSetup` comes from this profile's own file, so answering in one profile does not answer
   * for another.
   */
  if (experience.needsSetup || settingUp) {
    return (
      <div className="view markets-view" role="region" aria-label="Markets setup">
        <header className="view-head">
          <h2>Markets</h2>
          <div className="view-actions">
            <button type="button" className="icon-btn" aria-label="Close markets" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <MarketsOnboarding
          onNotify={(message, kind) => onNotify(message, kind === 'error' ? 'error' : undefined)}
          onFinished={() => {
            setSettingUp(false)
            // Re-read rather than assume: what the screen adapts to is what was actually written down.
            void experience.refresh()
            void readState()
          }}
        />
      </div>
    )
  }

  // ---------------------------------------------------------------- off

  if (enabled === false) {
    return (
      <div className="view markets-view" role="region" aria-label="Markets">
        <header className="view-head">
          <h2>Markets</h2>
          <div className="view-actions">
            <button type="button" className="icon-btn" aria-label="Close markets" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="mk-empty">
          <p>Markets is switched off, so nothing is being subscribed to.</p>
          <p className="pw-note is-quiet">
            Everything you have saved — watchlists, alerts and ticker groups — is still there and comes back when you
            switch it on.
          </p>
          <button
            type="button"
            className="queue-btn"
            onClick={() =>
              void window.api.marketsSetEnabled(true).then((answer) => {
                if (complain(answer, 'That could not be switched on.')) return
                setEnabled(true)
              })
            }
          >
            Switch Markets on
          </button>
        </div>
      </div>
    )
  }

  return (
    /*
     * One design system, configured. `data-density` is the whole of "information density": the same components, tighter
     * or looser. Nothing is hidden by it — a dense watchlist has more columns because the experience asked for more, not
     * because a stylesheet took any away.
     */
    <div className="view markets-view" data-density={experience.get('density')} role="region" aria-label="Markets">
      <header className="view-head">
        <h2>Markets</h2>
        <CurrencyPicker currency={currency} />
        <div className="mk-head-state">
          <Activity size={14} />
          <span className={`mk-conn is-${connection}`}>
            {connection === 'connected'
              ? 'Live'
              : connection === 'reconnecting'
                ? 'Reconnecting'
                : connection === 'delayed'
                  ? 'Delayed'
                  : connection === 'not-configured'
                    ? 'No provider'
                    : connection === 'disconnected'
                      ? 'Disconnected'
                      : // Configured and reachable, with nothing subscribed yet. Not an outage, and not a claim to be live.
                        connection === 'idle'
                        ? 'Ready'
                        : '…'}
          </span>
        </div>
        {/*
          * Which sections are in front, and which are one click away.
          *
          * Every section is reachable at every level. What the experience decides is the order — and for somebody who has
          * not asked for the advanced half, whether the screener and the strategy tools sit behind "More" rather than
          * in the header. Reordering is not removing, which is why nothing below filters the list.
          */}
        <div className="mk-modes" role="tablist" aria-label="Markets sections">
          {primary.map((id) => {
            const { label, icon: Icon } = SECTION_LOOK[id]
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={mode === id}
                className={mode === id ? 'on' : ''}
                title={label}
                onClick={() => setMode(id)}
              >
                <Icon size={13} />
                {/* The label hides at narrow widths; the title and the accessible name still say what it is. */}
                <span className="mk-mode-label">{label}</span>
              </button>
            )
          })}
          {/*
            * One market in depth, or several at once. A view of this section rather than a section of its own, because
            * both show whatever market is open.
            */}
          <button
            type="button"
            role="tab"
            aria-selected={workspace}
            className={`mk-mode-workspace${workspace ? ' on' : ''}`}
            title={workspace ? 'Back to one market at a time' : 'Arrange several panels at once'}
            onClick={() => setWorkspace((one) => !one)}
          >
            <LayoutGrid size={13} />
            <span className="mk-mode-label">Workspace</span>
          </button>
          {tucked.length > 0 ? (
            <span className="mk-more">
              <button
                type="button"
                className={tucked.includes(mode) ? 'on' : ''}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
                title="More sections"
                onClick={() => setMoreOpen((held) => !held)}
              >
                <ChevronDown size={13} />
                <span className="mk-mode-label">More</span>
              </button>
              {moreOpen ? (
                <span className="mk-more-menu" role="menu">
                  {tucked.map((id) => {
                    const { label, icon: Icon } = SECTION_LOOK[id]
                    return (
                      <button
                        key={id}
                        type="button"
                        role="menuitem"
                        className={mode === id ? 'on' : ''}
                        onClick={() => {
                          setMode(id)
                          setMoreOpen(false)
                        }}
                      >
                        <Icon size={13} /> {label}
                      </button>
                    )
                  })}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>

        <div className="view-actions">
          <div className="mk-search">
            <Search size={14} />
            <input
              value={query}
              placeholder="Search markets — BTC, bitcoin, ETH…"
              maxLength={60}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && results[0]) void openMarket(results[0].instrumentId)
                if (e.key === 'Escape') setQuery('')
              }}
            />
            {query.trim().length >= 2 && (
              <ul className="mk-results" role="listbox">
                {searching && <li className="mk-quiet">Searching…</li>}
                {!searching && results.length === 0 && <li className="mk-quiet">No supported markets found.</li>}
                {results.map((instrument) => (
                  <li key={instrument.instrumentId}>
                    <button type="button" onClick={() => void openMarket(instrument.instrumentId)}>
                      <AssetLogo instrument={instrument} size="small" />
                      <b>{instrument.symbol}</b>
                      <span className="mk-name">{instrument.name}</span>
                      <span className="mk-venue">{instrument.exchange}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Refresh" title="Refresh" onClick={() => void discover()}>
            <RefreshCw size={15} />
          </button>
          <button type="button" className="icon-btn" aria-label="Close markets" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>

      {mode === 'screener' && (
        <ScreenerPanel
          onNotify={onNotify}
          onOpenMarket={(instrumentId) => {
            // Opening from the screener lands on the market itself, which is the point of the row.
            setMode('markets')
            void openMarket(instrumentId)
          }}
        />
      )}

      {mode === 'alerts' && (
        <AlertsPanel
          onNotify={onNotify}
          current={open?.instrument ?? null}
          onOpenMarket={(instrumentId) => {
            setMode('markets')
            void openMarket(instrumentId)
          }}
        />
      )}

      {mode === 'portfolio' && (
        <PortfolioPanel
          onNotify={onNotify}
          current={open?.instrument ?? null}
          onOpenMarket={(instrumentId) => {
            setMode('markets')
            void openMarket(instrumentId)
          }}
        />
      )}

      {mode === 'backtest' && (
        <BacktestPanel
          onNotify={onNotify}
          current={open?.instrument ?? null}
          onOpenMarket={(instrumentId) => {
            setMode('markets')
            void openMarket(instrumentId)
          }}
        />
      )}

      {mode === 'replay' && <ReplayPanel onNotify={onNotify} />}

      {mode === 'news' && (
        <NewsPanel
          onNotify={onNotify}
          current={open ? { symbol: open.instrument.symbol, instrumentId: open.instrument.instrumentId, base: baseOf(open.instrument) } : null}
          onOpenMarket={(instrumentId) => {
            setMode('markets')
            void openMarket(instrumentId)
          }}
        />
      )}

      {mode === 'markets' && workspace && (
        <div className="mk-body is-workspace">
          <PanelWorkspace
            instrumentId={openId ?? ''}
            symbolOf={(id) => symbolOf(id)}
            pinnable={[
              ...(open ? [{ instrumentId: open.instrument.instrumentId, symbol: open.instrument.symbol }] : []),
              ...recent
                .filter((one) => one !== openId)
                .map((one) => ({ instrumentId: one, symbol: symbolOf(one) }))
            ]}
            onNotify={onNotify}
            render={(panel, instrumentId) => {
              // Only the panels that can stand alone in a pane. The rest say so rather than rendering a broken frame.
              if (panel === 'chart') {
                return (
                  <MarketChart
                    candles={instrumentId === openId ? candles : []}
                    interval={interval}
                    type={chartType}
                    indicators={indicators}
                    precision={pricePrecision}
                    priceText={(value) => currency.money(value, { compact: true }).text}
                    showVolume={false}
                    height={240}
                  />
                )
              }
              if (panel === 'book') {
                return (
                  <BookPanel
                    instrumentId={instrumentId}
                    available={open?.can.orderBook ?? true}
                    experience={experience}
                    currency={currency}
                  />
                )
              }
              if (panel === 'trades') {
                return <TapePanel instrumentId={instrumentId} note="" experience={experience} currency={currency} />
              }
              if (panel === 'news') {
                return (
                  <NewsPanel
                    onNotify={onNotify}
                    current={open ? { symbol: open.instrument.symbol, instrumentId: open.instrument.instrumentId, base: baseOf(open.instrument) } : null}
                    onOpenMarket={(id) => void openMarket(id)}
                  />
                )
              }
              if (panel === 'screener') {
                return (
                  <ScreenerPanel
                    onNotify={onNotify}
                    onOpenMarket={(id) => void openMarket(id)}
                  />
                )
              }
              if (panel === 'alerts') {
                return (
                  <AlertsPanel
                    onNotify={onNotify}
                    current={open?.instrument ?? null}
                    onOpenMarket={(id) => void openMarket(id)}
                  />
                )
              }
              if (panel === 'portfolio') {
                return (
                  <PortfolioPanel
                    onNotify={onNotify}
                    current={open?.instrument ?? null}
                    onOpenMarket={(id) => void openMarket(id)}
                  />
                )
              }
              if (panel === 'watchlist') {
                // The watchlist in a pane is the recents and favourites as a plain list: the full sidebar has its own
                // search and tabs, which do not belong inside a pane somebody has made small.
                return (
                  <ul className="mk-rows">
                    {[...new Set([...(openId ? [openId] : []), ...recent])].map((one) => (
                      <li key={one} className="mk-row">
                        <button type="button" className="mk-row-name" onClick={() => void openMarket(one)}>
                          <b>{symbolOf(one)}</b>
                        </button>
                        <span className="mk-price">{cash(listQuotes[one]?.last ?? null)}</span>
                      </li>
                    ))}
                  </ul>
                )
              }
              // ---- the discovery panels, which all read from the one `discovery` answer already loaded
              if (panel === 'movers' || panel === 'heatmap' || panel === 'breadth' || panel === 'overview') {
                if (discovery?.available !== true) {
                  return (
                    <p className="mk-quiet mk-ws-empty">
                      {discovery === null && discovering
                        ? 'Loading markets\u2026'
                        : 'No configured provider can report every market at once, so there is nothing to rank here.'}
                    </p>
                  )
                }
                return (
                  <>
                    {(panel === 'breadth' || panel === 'overview') && (
                      <div className="mk-breadth">
                        <span className="up">▲ {discovery.breadth.advancing}</span>
                        <span className="down">▼ {discovery.breadth.declining}</span>
                        <span className="flat">— {discovery.breadth.unchanged}</span>
                        <small>of {discovery.universeSize.toLocaleString()} markets</small>
                      </div>
                    )}

                    {(panel === 'movers' || panel === 'overview') && (
                      <>
                        <div className="mk-seg">
                          {(['gainers', 'losers', 'volume'] as const).map((kind) => (
                            <button
                              key={kind}
                              type="button"
                              className={moverKind === kind ? 'on' : ''}
                              onClick={() => setMoverKind(kind)}
                            >
                              {kind === 'gainers' ? 'Gainers' : kind === 'losers' ? 'Losers' : 'Volume'}
                            </button>
                          ))}
                        </div>
                        {discovery[moverKind].length === 0 ? (
                          <p className="mk-quiet">No mover data available.</p>
                        ) : (
                          <ul className="mk-rows">
                            {discovery[moverKind].slice(0, 12).map((row, i) => (
                              <Row key={row.instrument.instrumentId} row={row} rank={i + 1} />
                            ))}
                          </ul>
                        )}
                      </>
                    )}

                    {(panel === 'heatmap' || panel === 'overview') && (
                      <>
                        {panel === 'overview' && (
                          <h4 className="mk-sub">
                            Heatmap <small>sized by value traded, not market cap</small>
                          </h4>
                        )}
                        {discovery.tiles.length === 0 ? (
                          <p className="mk-quiet">No turnover reported.</p>
                        ) : (
                          <div className="mk-heat">
                            {discovery.tiles.map((tile) => {
                              const way = direction(tile.quote.changePercent)
                              return (
                                <button
                                  key={tile.instrument.instrumentId}
                                  type="button"
                                  className={`mk-tile ${way}`}
                                  style={{
                                    flexGrow: Math.max(0.35, tile.weight * discovery.tiles.length),
                                    flexBasis: `${Math.max(56, tile.weight * 900)}px`
                                  }}
                                  title={`${tile.instrument.name} \u2014 ${cash(tile.quote.last)} ${percent(tile.quote.changePercent)}`}
                                  onClick={() => void openMarket(tile.instrument.instrumentId)}
                                >
                                  <AssetLogo instrument={tile.instrument} size="tiny" />
                                  <b>{assetOf(tile.instrument).symbol}</b>
                                  <span>{percent(tile.quote.changePercent)}</span>
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )
              }

              if (panel === 'learn') {
                // The glossary, which is the part of Learn that stands alone. The guided tour does not belong in a pane
                // somebody has made small, and pretending otherwise would put a walkthrough in a 200-pixel box.
                return (
                  <p className="mk-quiet mk-ws-empty">
                    Learn is a walkthrough rather than a panel, so it opens from the section bar above where it has room
                    to be read.
                  </p>
                )
              }

              return (
                <p className="mk-quiet mk-ws-empty">
                  {/* Honest rather than a blank pane: this panel exists, and it is not one that works in a pane yet. */}
                  This panel is not one that can be shown inside the workspace yet. It is on the section bar above.
                </p>
              )
            }}
          />
        </div>
      )}

      <div className="mk-body" hidden={mode !== 'markets' || workspace}>
        {/* ------------------------------------------------------------ left: discovery and watchlists */}
        <aside className="mk-side">
          <div className="mk-tabs">
            <button type="button" className={pane === 'dashboard' ? 'on' : ''} onClick={() => setPane('dashboard')}>
              <Flame size={13} /> Movers
            </button>
            <button type="button" className={pane === 'watchlists' ? 'on' : ''} onClick={() => setPane('watchlists')}>
              <Eye size={13} /> Watchlists
            </button>
            <button type="button" className={pane === 'favourites' ? 'on' : ''} onClick={() => setPane('favourites')}>
              <Star size={13} /> Saved
            </button>
          </div>

          {/*
            * Favourites and what was just looked at.
            *
            * Ids only, resolved against what the engine already knows -- so a favourite survives the provider being
            * unreachable and shows as a symbol with no price rather than disappearing.
            */}
          {pane === 'favourites' && (
            <>
              <div className="mk-sub">
                <span>
                  Favourites <b>{favourites.length}</b>
                </span>
              </div>
              {favourites.length === 0 ? (
                <div className="mk-empty-small">
                  <p>Nothing saved yet.</p>
                  <p className="pw-note is-quiet">Use the star beside a market to keep it here.</p>
                </div>
              ) : (
                <ul className="mk-rows">
                  {favourites.map((instrumentId) => (
                    <li key={instrumentId} className="mk-row">
                      <button type="button" className="mk-row-name" onClick={() => void openMarket(instrumentId)}>
                        <b>{instrumentId.split(':').pop()?.toUpperCase()}</b>
                      </button>
                      <span className="mk-price">{cash(listQuotes[instrumentId]?.last ?? null)}</span>
                      <Move value={listQuotes[instrumentId]?.changePercent} />
                      <button
                        type="button"
                        className="mk-fav on"
                        aria-label="Remove from favourites"
                        onClick={() => void toggleFavourite(instrumentId)}
                      >
                        <Star size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {recent.length > 0 && (
                <>
                  <div className="mk-sub">
                    <span>Recently opened</span>
                    <button
                      type="button"
                      className="mk-chart-jump"
                      onClick={() =>
                        void window.api.marketsClearRecent().then(() => setRecent([]))
                      }
                    >
                      Clear
                    </button>
                  </div>
                  <ul className="mk-rows">
                    {recent.map((instrumentId) => (
                      <li key={instrumentId} className="mk-row">
                        <button type="button" className="mk-row-name" onClick={() => void openMarket(instrumentId)}>
                          <b>{instrumentId.split(':').pop()?.toUpperCase()}</b>
                        </button>
                        <span className="mk-price">{cash(listQuotes[instrumentId]?.last ?? null)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {pane === 'dashboard' && (
            <>
              {discovery?.available === false && (
                <p className="pw-note is-quiet">
                  No configured provider can report every market at once, so there is nothing to rank. Individual markets
                  still work through search.
                </p>
              )}
              {discovery === null && discovering && <p className="mk-quiet">Loading markets…</p>}
              {discovery?.available && (
                <>
                  <div className="mk-breadth">
                    <span className="up">▲ {discovery.breadth.advancing}</span>
                    <span className="down">▼ {discovery.breadth.declining}</span>
                    <span className="flat">— {discovery.breadth.unchanged}</span>
                    <small>of {discovery.universeSize.toLocaleString()} markets</small>
                  </div>

                  <div className="mk-seg">
                    {(['gainers', 'losers', 'volume'] as const).map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={moverKind === kind ? 'on' : ''}
                        onClick={() => setMoverKind(kind)}
                      >
                        {kind === 'gainers' ? 'Gainers' : kind === 'losers' ? 'Losers' : 'Volume'}
                      </button>
                    ))}
                  </div>

                  {discovery[moverKind].length === 0 ? (
                    <p className="mk-quiet">No mover data available.</p>
                  ) : (
                    <ul className="mk-rows">
                      {discovery[moverKind].map((row, i) => (
                        <Row key={row.instrument.instrumentId} row={row} rank={i + 1} />
                      ))}
                    </ul>
                  )}

                  <h4 className="mk-sub">
                    Heatmap <small>sized by value traded, not market cap</small>
                  </h4>
                  {discovery.tiles.length === 0 ? (
                    <p className="mk-quiet">No turnover reported.</p>
                  ) : (
                    <div className="mk-heat">
                      {discovery.tiles.map((tile) => {
                        const way = direction(tile.quote.changePercent)
                        return (
                          <button
                            key={tile.instrument.instrumentId}
                            type="button"
                            className={`mk-tile ${way}`}
                            style={{
                              // Area from its share of what is drawn, with a floor so the smallest tile is still clickable.
                              flexGrow: Math.max(0.35, tile.weight * discovery.tiles.length),
                              flexBasis: `${Math.max(56, tile.weight * 900)}px`
                            }}
                            title={`${tile.instrument.name} — ${cash(tile.quote.last)} ${percent(tile.quote.changePercent)} · ${compactNumber(tile.turnover)} traded`}
                            onClick={() => void openMarket(tile.instrument.instrumentId)}
                          >
                            <AssetLogo instrument={tile.instrument} size="tiny" />
                            <b>{assetOf(tile.instrument).symbol}</b>
                            <span>{percent(tile.quote.changePercent)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {pane === 'watchlists' && (
            <>
              <div className="mk-list-head">
                <select value={list?.id ?? ''} onChange={(e) => setActiveList(e.target.value)} disabled={lists.length === 0}>
                  {lists.map((one) => (
                    <option key={one.id} value={one.id}>
                      {one.name} ({one.items.length})
                    </option>
                  ))}
                  {lists.length === 0 && <option value="">No watchlists</option>}
                </select>
                <button type="button" className="tl-icon" aria-label="New watchlist" title="New watchlist" onClick={() => void newList()}>
                  <Plus size={14} />
                </button>
                {list && (
                  <button
                    type="button"
                    className="tl-icon"
                    aria-label={`Delete ${list.name}`}
                    title="Delete this watchlist"
                    onClick={() => {
                      if (!window.confirm(`Delete the watchlist “${list.name}”? The markets themselves are not affected.`)) return
                      void window.api.marketsWatchlistRemove(list.id).then((answer) => {
                        if (complain(answer, 'That could not be deleted.')) return
                        setActiveList(null)
                        apply(answer as WatchlistsAnswer)
                      })
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {!list || list.items.length === 0 ? (
                <div className="mk-empty-small">
                  <p>{lists.length === 0 ? 'No watchlists yet.' : 'Nothing on this list yet.'}</p>
                  {/* Somebody who has asked for explanations is told what the thing is for; somebody who has not is told
                      how to fill it. Same state, same buttons, different amount of sentence. */}
                  <p className="pw-note is-quiet">
                    {lists.length === 0
                      ? experience.get('explanations') === 'minimal'
                        ? 'Create one, then add a market.'
                        : 'A watchlist keeps the markets you care about in one place, with their prices. Make one, then search for a market and add it.'
                      : 'Search above, or add one from the movers list.'}
                  </p>
                  {lists.length === 0 && (
                    <button type="button" className="queue-btn small" onClick={() => void newList()}>
                      <ListPlus size={13} /> Create a watchlist
                    </button>
                  )}
                </div>
              ) : (
                <ul className="mk-rows">
                  {list.items.map((item) => {
                    const held = listQuotes[item.instrumentId] ?? null
                    return (
                      <li key={item.instrumentId} className="mk-row">
                        <button type="button" className="mk-row-name" onClick={() => void openMarket(item.instrumentId)}>
                          <AssetLogo instrument={item.instrument} size="small" />
                          <b>{item.instrument.symbol}</b>
                          <span className="mk-name">{item.instrument.name}</span>
                        </button>
                        <span className="mk-price">{cash(held?.last ?? null)}</span>
                        <Move value={held?.changePercent} />
                        <Freshness quote={held} />
                        <button
                          type="button"
                          className="tl-icon"
                          aria-label={`Remove ${item.instrument.symbol}`}
                          onClick={() =>
                            void window.api.marketsWatchlistRemoveItem(list.id, item.instrumentId).then((answer) => {
                              if (complain(answer, 'That could not be removed.')) return
                              apply(answer as WatchlistsAnswer)
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
        </aside>

        {/* ------------------------------------------------------------ right: one market */}
        <section className="mk-main">
          {!open ? (
            <div className="mk-empty">
              <LineChart size={26} />
              <p>Choose a market to see its price, chart, order book and trades.</p>
              <p className="pw-note is-quiet">
                Crypto prices come from Binance’s public feed and are live. Every number on this screen carries its own
                freshness, and anything a provider cannot supply says so rather than showing a zero.
              </p>
              {/* Where education is on, the way in to the glossary rather than a tour nobody asked for. */}
              {experience.get('autoEducation') ? (
                <p className="mk-learn-line">
                  <GraduationCap size={13} /> New to this? Look for the
                  <Explain term="marketCap" experience={experience} label="market cap" /> marks beside a figure — each one
                  explains what it is.
                </p>
              ) : null}
            </div>
          ) : (
            <>
              <div className="mk-detail-head">
                <AssetLogo instrument={open.instrument} size="hero" labelled />
                <div className="mk-ident">
                  <h3>{assetOf(open.instrument).named ? assetOf(open.instrument).name : open.instrument.name}</h3>
                  <p>
                    <span className="mk-sym">{open.instrument.symbol}</span>
                    <span className="mk-venue">{open.instrument.exchange}</span>
                    <span className="mk-venue">spot</span>
                    <Freshness quote={quote} />
                  </p>
                </div>
                <div className="mk-big">
                  <strong>{cash(price, open.instrument.currency)}</strong>
                  <span className={`mk-change ${direction(quote?.changePercent)}`}>
                    {quote?.change === null || quote?.change === undefined ? '—' : cash(quote.change)} ({percent(quote?.changePercent)})
                    <small> 24h</small>
                  </span>
                </div>
                <div className="mk-detail-actions">
                  {list && (
                    <button
                      type="button"
                      className="queue-btn small"
                      disabled={open.onWatchlists.includes(list.id)}
                      onClick={() => void addTo(list.id, open.instrument.instrumentId)}
                    >
                      <Star size={13} /> {open.onWatchlists.includes(list.id) ? `On ${list.name}` : `Add to ${list.name}`}
                    </button>
                  )}
                  <button type="button" className="icon-btn" aria-label="Close this market" onClick={closeMarket}>
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="mk-stats">
                <span>
                  24h high <b>{cash(quote?.dayHigh ?? null)}</b>
                </span>
                <span>
                  24h low <b>{cash(quote?.dayLow ?? null)}</b>
                </span>
                <span>
                  Bid <b>{cash(quote?.bid ?? null)}</b>
                </span>
                <span>
                  Ask <b>{cash(quote?.ask ?? null)}</b>
                </span>
                <span>
                  {/* The affordance rather than the tooltip: a title attribute is invisible until you happen to hover,
                      and says the same thing to somebody who wanted the exact definition and somebody who did not. */}
                  Spread <Explain term="spread" experience={experience} label="the spread" />{' '}
                  <b>
                    {typeof quote?.bid === 'number' && typeof quote?.ask === 'number' && quote.ask >= quote.bid
                      ? cash(quote.ask - quote.bid)
                      : '—'}
                  </b>
                </span>
                <span>
                  24h volume <Explain term="volume" experience={experience} label="24-hour volume" />{' '}
                  <b>{quote?.volume === null || quote?.volume === undefined ? '—' : compactNumber(quote.volume)}</b>
                </span>
                <span>
                  24h traded <Explain term="turnover" experience={experience} label="24-hour turnover" />{' '}
                  <b>{typeof quote?.quoteVolume === 'number' ? compactNumber(quote.quoteVolume) : '—'}</b>
                </span>
                <span>
                  Source <b>{quote?.source || '—'}</b>
                </span>
              </div>

              <div className="mk-tabs is-wide">
                {/*
                  * Derivatives is only a tab for a market that has them. A spot pair has no funding and no open interest,
                  * and offering the tab anyway would be offering three empty boxes -- so the tab is absent rather than
                  * present and unavailable. Whether it appears comes from the provider's declared capabilities.
                  */}
                {(
                  [
                    'chart',
                    'book',
                    'trades',
                    ...(open.can.derivatives ? (['derivatives'] as const) : []),
                    'compare',
                    // Margin is only a tab where leverage could mean anything. On a spot pair with no positions it
                    // would be a screen of zeroes explaining that nothing can be liquidated.
                    'margin',
                    'triggers',
                    // Patterns is a tab on the market rather than a section of its own, because "which market am I
                    // looking at" already has an owner and a second one would eventually disagree with it.
                    'patterns'
                  ] as Tab[]
                ).map((id) => {
                  const unavailable =
                    (id === 'book' && !open.can.orderBook) || (id === 'trades' && !open.can.trades) || (id === 'chart' && !open.can.candles)
                  return (
                    <button
                      key={id}
                      type="button"
                      className={tab === id ? 'on' : ''}
                      onClick={() => setTab(id)}
                      title={unavailable ? 'This provider does not supply it' : undefined}
                    >
                      {id === 'chart' ? (
                        <BarChart3 size={13} />
                      ) : id === 'book' ? (
                        <LineChart size={13} />
                      ) : id === 'derivatives' ? (
                        <Flame size={13} />
                      ) : id === 'compare' ? (
                        <GitCompareArrows size={13} />
                      ) : id === 'patterns' ? (
                        <CandlestickChart size={13} />
                      ) : id === 'margin' ? (
                        <Gauge size={13} />
                      ) : id === 'triggers' ? (
                        <Zap size={13} />
                      ) : (
                        <Activity size={13} />
                      )}
                      {id === 'chart'
                        ? 'Chart'
                        : id === 'book'
                          ? 'Order book'
                          : id === 'derivatives'
                            ? 'Derivatives'
                            : id === 'compare'
                              ? 'Compare'
                              : id === 'margin'
                                ? 'Margin'
                                : id === 'triggers'
                                  ? 'Triggers'
                                  : 'Trades'}
                      {/* A section its provider cannot fill says so on the tab, rather than opening to an empty panel. */}
                      {unavailable && <small> · unavailable</small>}
                    </button>
                  )
                })}
              </div>

              {tab === 'chart' && (
                <div className="mk-chart-wrap">
                  <div className="mk-chart-bar">
                    {/*
                      * The timeframes somebody said they use, then everything else behind one button.
                      *
                      * Never a shorter list of what is possible: `shownIntervals` is the quick set when there is one and
                      * the provider's whole list otherwise, and "All" reveals the rest. A timeframe a provider serves is
                      * always reachable at every experience level.
                      */}
                    <div className="mk-seg">
                      {shownIntervals.map((one) => (
                        <button
                          key={one}
                          type="button"
                          className={interval === one ? 'on' : ''}
                          onClick={() => {
                            setInterval_(one)
                            void loadCandles(open.instrument.instrumentId, one)
                          }}
                        >
                          {one}
                        </button>
                      ))}
                      {shownIntervals.length < open.can.intervals.length ? (
                        <button type="button" onClick={() => setAllIntervals(true)} title="Every timeframe this provider serves">
                          All
                        </button>
                      ) : null}
                    </div>
                    <div className="mk-seg">
                      {CHART_TYPES.map((one) => (
                        <button key={one.id} type="button" className={chartType === one.id ? 'on' : ''} onClick={() => setChartType(one.id)}>
                          {one.label}
                        </button>
                      ))}
                    </div>
                    <select
                      value=""
                      aria-label="Add an indicator"
                      onChange={(e) => {
                        if (e.target.value) addIndicator(e.target.value as IndicatorKind)
                        e.currentTarget.value = ''
                      }}
                    >
                      <option value="">Add indicator…</option>
                      {offered.map((info) => (
                        <option key={info.kind} value={info.kind} disabled={indicators.some((one) => one.kind === info.kind)}>
                          {info.name}
                        </option>
                      ))}
                    </select>
                    {/* A shortcut, not a new feature: it opens the replay that is already there. Offered where somebody
                        asked for an advanced toolbar, and reachable from the sections at every level. */}
                    {experience.get('chartAdvancedToolbar') ? (
                      <button type="button" className="mk-chart-jump" onClick={() => setMode('replay')} title="Replay this market">
                        <History size={13} /> Replay
                      </button>
                    ) : null}
                    {/* And where explanations are on, the chart can say what it is. */}
                    <Explain term="candlestick" experience={experience} label="this chart" />
                  </div>

                  {indicators.length > 0 && (
                    <ul className="mk-legend">
                      {indicators.map((one) => {
                        const info = indicatorInfo(one.kind)
                        return (
                          <li key={one.kind}>
                            <span>{info?.name ?? one.kind}</span>
                            {Object.entries(one.options).map(([name, value]) => (
                              <input
                                key={name}
                                type="number"
                                min={1}
                                max={400}
                                value={value}
                                aria-label={`${info?.name ?? one.kind} ${name}`}
                                title={name}
                                onChange={(e) => {
                                  const next = Number(e.target.value)
                                  // An invalid period is not applied: the indicator keeps the last value that made sense.
                                  if (!Number.isFinite(next) || next < 1) return
                                  setIndicators((current) =>
                                    current.map((each) =>
                                      each.kind === one.kind ? { ...each, options: { ...each.options, [name]: next } } : each
                                    )
                                  )
                                }}
                              />
                            ))}
                            <button
                              type="button"
                              className="tl-icon"
                              aria-label={`Remove ${info?.name ?? one.kind}`}
                              onClick={() => setIndicators((current) => current.filter((each) => each.kind !== one.kind))}
                            >
                              <X size={12} />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}

                  {candleNote ? (
                    <div className="mk-empty-small">
                      <p>{candleNote}</p>
                      {open.can.candles && (
                        <button
                          type="button"
                          className="queue-btn small"
                          onClick={() => void loadCandles(open.instrument.instrumentId, interval)}
                        >
                          <RefreshCw size={13} /> Try again
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <DrawingToolbar
                        instrumentId={open.instrument.instrumentId}
                        drawings={drawings}
                        tool={drawTool}
                        selected={drawSelected}
                        onTool={setDrawTool}
                        onSelect={setDrawSelected}
                        onChanged={setDrawings}
                        onNotify={onNotify}
                        priceText={(value) => currency.money(value).text}
                      />
                      <MarketChart
                        candles={candles}
                        interval={interval}
                        type={chartType}
                        indicators={indicators}
                        precision={pricePrecision}
                        // The axis reads in the same currency as everything else on the screen.
                        priceText={(value) => currency.money(value, { compact: true }).text}
                        showVolume
                        loadingHistory={loadingCandles}
                        drawings={drawings}
                        tool={drawTool}
                        selectedDrawing={drawSelected}
                        onDrawingPlaced={(kind, anchors) => {
                          // Placing one puts the pointer back: staying armed draws a second line on the next click,
                          // which is never what somebody meant.
                          setDrawTool(null)
                          void window.api
                            .marketsDrawingSave(
                              draftDrawing(kind, open.instrument.instrumentId, anchors, Date.now())
                            )
                            .then((result) => {
                              if (refused(result)) {
                                complain(result, 'That drawing could not be saved')
                                return
                              }
                              setDrawings(result.drawings)
                              setDrawSelected(result.drawing.id)
                            })
                        }}
                        onDrawingPicked={setDrawSelected}
                        patternMarkers={patternMarkers}
                        selectedPattern={patternPicked}
                        onPatternPicked={(key) => {
                          setPatternPicked(key)
                          // Clicking a marker opens the formation it belongs to, which is the only reason somebody clicks one.
                          if (key !== null) {
                            setPatternView('found')
                            setTab('patterns')
                          }
                        }}
                        onDrawingMoved={(id, index, to) => {
                          const current = drawings.find((one) => one.id === id)
                          if (!current || current.locked) return
                          const anchors = [...current.anchors]
                          anchors[index] = to
                          // Moved on screen first so the handle follows the pointer, then saved. Waiting for the round
                          // trip before redrawing makes dragging feel like it is stuck.
                          const moved = { ...current, anchors }
                          setDrawings((all) => all.map((one) => (one.id === id ? moved : one)))
                          void window.api.marketsDrawingSave(moved).then((result) => {
                            if (refused(result)) return
                            setDrawings(result.drawings)
                          })
                        }}
                        onHover={(candle, values) => setHovered({ candle, values })}
                        onNeedHistory={() => {
                          // More history, keeping what is already loaded. The chart holds its viewport, so the bars the
                          // pointer was over stay where they were.
                          if (candles.length >= 1000) return
                          void loadCandles(open.instrument.instrumentId, interval, Math.min(1000, candles.length + 300))
                        }}
                      />
                      <div className="mk-readout">
                        {hovered.candle ? (
                          <>
                            <span>{new Date(hovered.candle.time).toLocaleString()}</span>
                            <span>O <b>{cash(hovered.candle.open)}</b></span>
                            <span>H <b>{cash(hovered.candle.high)}</b></span>
                            <span>L <b>{cash(hovered.candle.low)}</b></span>
                            <span>C <b>{cash(hovered.candle.close)}</b></span>
                            <span>
                              V <b>{hovered.candle.volume === null ? '—' : compactNumber(hovered.candle.volume)}</b>
                            </span>
                            {hovered.values.map((one) => (
                              <span key={one.label}>
                                {one.label} <b>{one.value === null ? '—' : cash(one.value)}</b>
                              </span>
                            ))}
                          </>
                        ) : (
                          <span className="mk-quiet">
                            {candles.length.toLocaleString()} {interval} candles from {quote?.source || 'the provider'} · drag to
                            pan, scroll to zoom, double-click to reset
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {tab === 'book' && (
                <BookPanel
                  instrumentId={open.instrument.instrumentId}
                  available={open.can.orderBook}
                  experience={experience}
                  currency={currency}
                />
              )}

              {tab === 'trades' && (
                <TapePanel
                  instrumentId={open.instrument.instrumentId}
                  note={open.can.trades ? tradeNote : 'This provider does not publish individual trades.'}
                  experience={experience}
                  currency={currency}
                />
              )}

              {tab === 'derivatives' && (
                <DerivativesPanel
                  instrumentId={open.instrument.instrumentId}
                  experience={experience}
                  currency={currency}
                />
              )}

              {tab === 'compare' && (
                <ComparePanel
                  instrumentId={open.instrument.instrumentId}
                  symbol={open.instrument.symbol}
                  experience={experience}
                  onNotify={onNotify}
                />
              )}

              {tab === 'margin' && <MarginPanel experience={experience} currency={currency} onNotify={onNotify} />}

              {tab === 'triggers' && (
                <TriggersPanel
                  instrumentId={open.instrument.instrumentId}
                  symbol={open.instrument.symbol}
                  experience={experience}
                  onNotify={onNotify}
                />
              )}

              {tab === 'patterns' && (
                <>
                  <div className="mk-seg">
                    {(
                      [
                        ['found', 'On this market'],
                        ['library', 'Library'],
                        ['alerts', 'Alerts'],
                        ['history', 'History']
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" className={patternView === id ? 'on' : ''} onClick={() => setPatternView(id)}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {patternView === 'found' && (
                    <PatternsPanel
                      instrumentId={open.instrument.instrumentId}
                      symbol={open.instrument.symbol}
                      interval={interval}
                      onMarkers={setPatternMarkers}
                      selected={patternPicked}
                      onSelect={setPatternPicked}
                      onGoToTime={() => setTab('chart')}
                    />
                  )}
                  {patternView === 'library' && <PatternLibraryPanel />}
                  {patternView === 'alerts' && (
                    <PatternAlertsPanel
                      instrumentId={open.instrument.instrumentId}
                      symbol={open.instrument.symbol}
                      interval={interval}
                    />
                  )}
                  {patternView === 'history' && (
                    <PatternHistoryPanel instrumentId={open.instrument.instrumentId} symbol={open.instrument.symbol} />
                  )}
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
