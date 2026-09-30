import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import type { MarketEngine } from './engine.ts'
import type { MarketsStore } from './store.ts'
import type { MarketsRuntime } from './runtime.ts'
import { TICKER_HEIGHTS, type TickerConfig, type Watchlist } from '../../shared/markets/workspace.ts'
import type { StripOrigin } from '../../shared/markets/strip.ts'
import {
  cleanQuery,
  queryNeedsCandles,
  screen,
  screenSnapshot,
  type ScreenerAnswer
} from '../../shared/markets/screener.ts'
import type { Alert, AlertFiring } from '../../shared/markets/alerts.ts'
import {
  ALERT_ASSUMPTIONS,
  checkRule,
  digestOf,
  type PatternAlertRule
} from '../../shared/markets/patternAlerts.ts'
import { CONTEXT_ASSUMPTIONS, contextFor, timeframeContext } from '../../shared/markets/patternContext.ts'
import { DETECT_ASSUMPTIONS, detect, detectAt, explain as explainDetection, matchWord, mostSpecific } from '../../shared/markets/patternDetect.ts'
import {
  HISTORY_ASSUMPTIONS,
  compare as comparePatternStats,
  conditionOn,
  describeRun,
  frequencyOf,
  measureOutcomes,
  search as searchPatternHistory,
  summarise as summarisePatternOutcomes,
  type AnalysisRun,
  type HistoryQuery
} from '../../shared/markets/patternHistory.ts'
import {
  GEOMETRY_ASSUMPTIONS,
  checkSequence,
  geometryOf,
  relativeTo,
  rollingStats
} from '../../shared/markets/candleGeometry.ts'
import {
  PATTERNS,
  PATTERN_ASSUMPTIONS,
  PATTERN_LIBRARY_VERSION,
  ancestorsOf,
  descendantsOf,
  filterPatterns,
  patternById,
  searchPatterns,
  TOLERANCES,
  type DetectionMode,
  type PatternCategory,
  type PatternDirection
} from '../../shared/markets/patterns.ts'
import { SETTINGS_ASSUMPTIONS, WHAT_STOPS } from '../../shared/markets/patternSettings.ts'
import { ENGINE_ASSUMPTIONS, PatternEngine, decideAlerts, recordsFor } from './patternEngine.ts'

import {
  ASSUMPTIONS,
  cancel,
  place,
  valueOf,
  type AccountValue,
  type OrderType,
  type Side
} from '../../shared/markets/paper.ts'
import { portfolioView, type PortfolioView } from '../../shared/markets/portfolio.ts'
import { describeStrategy, problemsWith, type Strategy } from '../../shared/markets/strategy.ts'
import { backtest, sweep, type BacktestResult } from '../../shared/markets/backtest.ts'
import type { BacktestRun, PaperState } from '../../shared/markets/workspace.ts'
import { baseOf, newsAbout, normaliseNews, NEWS_SOURCES, type NewsItem } from '../../shared/markets/news.ts'
import {
  CURRENCIES,
  freshnessOfRate,
  SUGGESTED,
  type Currency,
  type CurrencyPreference,
  type DetectionSignals,
  type Rate,
  type RateFreshness
} from '../../shared/markets/currency.ts'
import type { FxRates } from './fx.ts'
import type { Feed, FeedItem } from '../../shared/widgetData.ts'
import type { Candle } from '../../shared/markets/indicators.ts'
import type { Instrument, QuoteView } from '../../shared/markets/instrument.ts'
import { INTERVALS, type Interval, type ProviderStatus, type TradePrint } from '../../shared/markets/provider.ts'
import {
  describeExperience,
  LEVEL_LABELS,
  orionContext,
  PRESET_PREVIEW,
  readExperienceRequest,
  resolveExperience,
  type ExperienceSettings,
  type MarketsExperienceProfile,
  type OrionExperienceContext
} from '../../shared/markets/experience.ts'
import {
  applyDraft,
  cleanDraft,
  needsOnboarding,
  problemsWith as draftProblems,
  reviewOf,
  skippedSetup,
  type DraftProblem,
  type OnboardingRecord,
  type ReviewLine
} from '../../shared/markets/onboarding.ts'
import { explain, GLOSSARY, lookupTerm, termsFor } from '../../shared/markets/glossary.ts'
import type { BookView } from '../../shared/markets/orderbook.ts'
import { drawingsFor, type Drawing } from '../../shared/markets/drawings.ts'
import { LAYOUT_PRESETS, type Layout as PanelLayout } from '../../shared/markets/panels.ts'
import { describeTrigger, type MarketTrigger } from '../../shared/markets/triggers.ts'
import { accountMargin, MARGIN_ASSUMPTIONS, marginOf, type MarginSettings } from '../../shared/markets/margin.ts'
import {
  compareStats,
  correlationMatrix,
  indexSeries,
  COMPARE_ASSUMPTIONS,
  MAX_COMPARED,
  type CompareSeries
} from '../../shared/markets/compare.ts'
import {
  monteCarlo,
  summariseWalk,
  VALIDATION_ASSUMPTIONS,
  walkWindows,
  type WalkResult
} from '../../shared/markets/validation.ts'
import {
  annualisedBasis,
  basisOf,
  describeOi,
  fundingAnnualised,
  fundingDirection,
  fundingStale,
  oiChange,
  oiWindowMs,
  overWindow,
  summariseLiquidations,
  untilFunding,
  type Contract,
  type Funding,
  type FundingPoint,
  type Liquidation,
  type LongShortRatio,
  type MarkIndex,
  type OpenInterest,
  type OpenInterestPoint
} from '../../shared/markets/derivatives.ts'
import {
  aggregateByPrice,
  aggregateByTime,
  describePressure,
  filterTape,
  pressure,
  suggestedThreshold,
  tapeStats,
  windowMsFor,
  type Pressure,
  type PriceBucket,
  type TapeFilter,
  type TapeStats,
  type TimeBucket
} from '../../shared/markets/tape.ts'
import {
  breadth,
  heatmap,
  matches,
  movers,
  turnoverOf,
  type Breadth,
  type DiscoveryFilter,
  type HeatmapTile,
  type MarketRow,
  type MoverKind
} from '../../shared/markets/discovery.ts'

/**
 * The Orbis window's way into Markets.
 *
 * The strip along the bottom of the browser reads market data through the helper; this is the other side -- the window,
 * where markets are set up rather than watched. Everything that changes a choice goes through here, so the strip is a
 * reader and the window is the editor, and there is one place that decides which is which.
 *
 * Each call answers with the whole state, so a screen never has to work out what changed and never draws half of it.
 */

export interface MarketsIpcOptions {
  engine: MarketEngine
  store: MarketsStore
  runtime: MarketsRuntime
  getWindow(): BrowserWindow | null
  profileId(): Promise<string>
  /**
   * Reads one syndication feed.
   *
   * Handed in rather than built here, so news goes through the one feed reader Orbis already has — with its cache, its
   * timeouts and its backing off. A second fetcher would be a second set of rate limits to get wrong.
   */
  readFeed?(url: string): Promise<{ ok: true; data: Feed } | { ok: false; reason: string }>
  /** Real exchange rates. Absent in a build with none, which the interface reports rather than working around. */
  fx?: FxRates
  /**
   * What Orbis already knows about where the person is, for choosing a starting currency.
   *
   * A locale and at most a coarse region — deliberately nothing finer. A currency preference is not worth a location
   * permission, and a country answers the question as well as coordinates would.
   */
  detectionSignals?(): DetectionSignals
}

/**
 * The market strip, as the strip itself needs it.
 *
 * Deliberately not `MarketsState`: the strip is on screen on every page, including pages that have nothing to do with
 * markets, and handing it the whole of Markets would mean every screen in Orbis re-reading watchlists, alerts, screens
 * and strategies twice a second to move a rail.
 */
export interface StripAnswer {
  config: {
    groupName: string
    speed: number
    direction: string
    pauseOnHover: boolean
    fields: string[]
    height: number
    enabled: boolean
    slots: number
    auto: boolean
  }
  items: { instrument: Instrument; quote: QuoteView | null; origin: StripOrigin }[]
  connection: string
}

export interface MarketsState {
  /** Whether Markets is on at all. Everything below is still the saved configuration when it is off. */
  enabled: boolean
  ticker: TickerConfig
  /** The height the strip will take, so the settings screen can say what it will do. */
  tickerHeight: number
  /** What is in the active group, with its last price. */
  tickerItems: { instrument: Instrument; quote: QuoteView | null }[]
  providers: ProviderStatus[]
  connection: string
  /** What can honestly be offered, across the configured providers. */
  capabilities: { assetTypes: string[]; intervals: string[]; features: Record<string, boolean> }
}

/** One instrument, with everything the detail page draws. Anything the provider cannot serve is null, never a zero. */
export interface MarketDetail {
  instrument: Instrument
  quote: QuoteView | null
  /** What can honestly be offered for this instrument, from its own provider's declared capabilities. */
  can: {
    candles: boolean
    orderBook: boolean
    trades: boolean
    intervals: Interval[]
    /**
     * Whether this market has derivatives at all.
     *
     * True only for a contract whose own provider reports funding or open interest. A spot pair has neither, so the
     * derivatives section is absent for it rather than present and empty.
     */
    derivatives: boolean
  }
  /** Which watchlists already hold it, so the page states the real position rather than offering to add it twice. */
  onWatchlists: string[]
}

/** Everything the alerts screen draws: the conditions, what they are about, their prices, and what has fired. */
export interface AlertsAnswer {
  alerts: Alert[]
  instruments: Instrument[]
  quotes: { instrumentId: string; quote: QuoteView | null }[]
  /** Newest first, which is the order a history is read in. */
  history: AlertFiring[]
}

/**
 * A screener answer, with what it cost.
 *
 * `interval` and `cap` are null when the query needed no history: nothing was fetched, so nothing was left out, and the
 * interface should not imply a limit that did not apply.
 */
export interface ScreenAnswer {
  answer: ScreenerAnswer
  interval: string | null
  cap: number | null
}

/**
 * The portfolio screen's whole state.
 *
 * `state` is null when no simulated account has been started, which is a different thing from an account with nothing in
 * it: one should offer to begin, the other should show a portfolio worth its starting balance.
 */
export interface PaperAnswer {
  state: PaperState | null
  value: AccountValue | null
  view: Omit<PortfolioView, 'value'> | null
  instruments: Instrument[]
  prices: { instrumentId: string; price: number | null }[]
  /** What the simulation assumed, so a result is never read without them. */
  assumptions: string[]
}

/** Saved strategies, what they are about, what has been run, and why any of them cannot run. */
export interface StrategiesAnswer {
  strategies: Strategy[]
  instruments: Instrument[]
  /** Newest first. */
  runs: BacktestRun[]
  /** Keyed by strategy id: the reasons it could not be run, empty when it can. */
  problems: Record<string, string[]>
}

/** A finished backtest, with what it was actually given rather than what it asked for. */
export interface BacktestAnswer {
  result: BacktestResult
  candlesAsked: number
  candlesGot: number
  description: string[]
  runs: BacktestRun[]
}

/** The display currency, what it converts through, and how much to believe the conversion. */
export interface CurrencyAnswer {
  preference: CurrencyPreference
  /** The currency market prices arrive in, which is what is being converted from. */
  base: string
  /** Null when no conversion is needed, or when none can be had. */
  rate: Rate | null
  freshness: RateFreshness
  fxSource: string | null
  fxUpdatedAt: number | null
  /** Why the last attempt to fetch rates failed, or empty. */
  fxFailing: string
  currencies: Currency[]
  suggested: string[]
}

/** Headlines, where they came from, and which publishers could not be reached. */
export interface NewsAnswer {
  items: NewsItem[]
  sources: { name: string; home: string }[]
  unavailable: { name: string; reason: string }[]
  note?: string
}

/** A watchlist answer: the lists themselves, plus the last price of everything on them. */
export interface WatchlistsAnswer {
  watchlists: Watchlist[]
  quotes: { instrumentId: string; quote: QuoteView | null }[]
}

export interface DiscoveryAnswer {
  gainers: MarketRow[]
  losers: MarketRow[]
  volume: MarketRow[]
  tiles: HeatmapTile[]
  breadth: Breadth
  /** How many markets were considered, so a ranking can be read as a ranking of something known. */
  universeSize: number
  /** False when no configured provider can report every market at once, which the page says rather than drawing nothing. */
  available: boolean
  connection: string
}

/**
 * How Markets should behave for this profile, in one answer.
 *
 * The profile, the resolved settings and whether the questions have been answered. Every surface reads this one answer,
 * so there is no way for the dashboard to think somebody is a beginner while the chart thinks they are a professional.
 */
export interface ExperienceAnswer {
  profile: MarketsExperienceProfile
  /** What the interface actually asks, after the whole precedence order. */
  settings: ExperienceSettings
  /** Which of those came from a preset and which somebody set by hand. */
  sources: Record<string, string>
  onboarding: OnboardingRecord
  /** True when the questions have never been answered or skipped, for this profile. */
  needsSetup: boolean
  /** What Orion is told. Thin on purpose. */
  orion: OrionExperienceContext
  /** The summary a settings screen shows. */
  summary: { label: string; value: string }[]
  levels: { id: string; label: string; preview: string[] }[]
}

export interface OnboardingAnswer {
  record: OnboardingRecord
  /** Empty when the draft is ready to apply. */
  problems: DraftProblem[]
  review: ReviewLine[]
}

/**
 * Everything a derivatives panel needs for one contract, in one answer.
 *
 * One answer rather than six calls, because the figures are read together and a panel assembled from six separately-timed
 * requests would show a basis computed from a mark price newer than its index. Every field is null where the venue does
 * not publish it -- there is no substitution anywhere in here.
 */
export interface DerivativesAnswer {
  instrumentId: string
  /** The contract's own metadata, or null when no provider describes it. */
  contract: Contract | null
  funding: Funding | null
  /** Whether the published funding time has been passed by more than a funding period. */
  fundingStale: boolean
  /** Milliseconds to the next payment, or null when the venue published no time. Never negative. */
  untilFunding: number | null
  /** Which side pays, from the sign of the rate. */
  fundingDirection: 'longs-pay' | 'shorts-pay' | 'flat'
  /** The yearly equivalent, or null when the funding period is unknown. */
  fundingAnnualised: number | null
  marks: MarkIndex | null
  openInterest: OpenInterest | null
  /** The change over the window asked for, from the venue's own history. */
  oiChange: { absolute: number; fraction: number | null } | null
  /** What open interest and price each did over the same window. Descriptive, never causal. */
  relationship: { oi: string; price: string }
  /** Futures price against index price. Null without both. */
  basis: { absolute: number; fraction: number } | null
  /** Annualised, and only for a dated contract with time left on it. */
  basisAnnualised: number | null
  liquidations: LiquidationsAnswer
  /** What is actually available here, so a panel can be absent rather than empty. */
  available: { funding: boolean; openInterest: boolean; liquidations: boolean; markPrice: boolean; longShort: boolean }
  /** Said plainly where a capability has no provider, so the panel can explain itself. */
  note: string
}

export interface LiquidationsAnswer {
  /** The window this covers. */
  from: number
  to: number
  count: number
  longNotional: number
  shortNotional: number
  totalNotional: number
  events: Liquidation[]
  /** True when the buffer is full, so the panel can say the window is partial. */
  partial: boolean
  /** True when the venue publishes no history, so an empty panel is expected rather than broken. */
  streamOnly: boolean
}

/** The trade tape, and what it adds up to. */
export interface TapeAnswer {
  instrumentId: string
  trades: TradePrint[]
  stats: TapeStats
  pressure: Pressure
  /** A word for the reading, including "unclassified" when the venue does not publish aggressor side. */
  reading: string
  /** The window the pressure was measured over. */
  window: string
  /** A threshold from this market's own prints, or null when the tape is too short to have one. */
  suggestedThreshold: number | null
  /** The tape grouped by price, when asked for. */
  byPrice: PriceBucket[]
  /** The tape grouped by time, when asked for. */
  byTime: TimeBucket[]
  /** True when no print in the window carried a side, so nothing here can be split. */
  unclassified: boolean
}

/**
 * A book, and how much it can be believed.
 *
 * `stale` is the field that matters: a book whose stream broke continuity is still shown, because the levels it holds were
 * true a moment ago, but it must never be presented as current. `polled` says the venue has no incremental stream, so the
 * book is as fresh as the last read and nothing is being maintained between reads.
 */
export interface BookAnswer {
  book: BookView
  stale: boolean
  polled: boolean
}

export function registerMarketsIpc(o: MarketsIpcOptions): void {
  const handle = (channel: string, run: (profileId: string, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (event.sender !== o.getWindow()?.webContents) throw new Error('Not allowed.')
      try {
        return await run(await o.profileId(), ...args)
      } catch (err) {
        // A code and a sentence. Never a provider's URL, and never a key -- there are none here, but the habit is what
        // keeps that true.
        return { error: 'failed', message: err instanceof Error && err.message.length < 160 ? err.message : 'That did not work.' }
      }
    })
  }

  const str = (value: unknown, max = 200): string => (typeof value === 'string' ? value.slice(0, max) : '')

  /** Everything a Markets screen needs, in one answer. */
  const state = async (profileId: string): Promise<MarketsState> => {
    const workspace = await o.store.read(profileId)
    const ticker = workspace.ticker
    const surface = await o.runtime.tickerState()
    return {
      enabled: workspace.enabled,
      ticker,
      tickerHeight: TICKER_HEIGHTS[ticker.size],
      tickerItems: surface.items,
      providers: o.engine.statuses(),
      connection: o.runtime.connection(),
      capabilities: o.engine.capabilities()
    }
  }

  handle('markets:state', (id) => state(id))

  /**
   * The master switch.
   *
   * Off releases every market subscription; on lets the surfaces ask again. Nothing saved is touched either way, which is
   * checked by a test rather than left as an intention.
   */
  handle('markets:set-enabled', async (id, enabled) => {
    await o.store.setEnabled(id, enabled === true)
    return state(id)
  })

  handle('markets:set-ticker', async (id, config) => {
    await o.store.setTicker(id, config)
    return state(id)
  })

  /**
   * The market strip along the bottom, and its own subscription.
   *
   * A channel of its own rather than a corner of `markets:quotes`, because that one *releases* everything it was not
   * asked for: the strip and a watchlist sharing it would take each other's prices away every time either of them
   * asked. So the strip keeps its own map, under its own reason, and the two cannot interfere.
   *
   * It subscribes what it draws for the same reason the watchlist does -- a price that is not on the socket is a price
   * from whatever cache something else happened to fill, which is what "frozen" looked like before.
   */
  const stripWatch = new Map<string, () => void>()
  handle('markets:strip', async (id) => {
    void id
    const surface = await o.runtime.tickerState()
    const ids = surface.config.enabled ? surface.items.map((one) => one.instrument.instrumentId) : []

    const stillWanted = new Set(ids)
    for (const [instrumentId, watching] of stripWatch) {
      if (stillWanted.has(instrumentId)) continue
      watching()
      stripWatch.delete(instrumentId)
    }
    for (const instrumentId of ids) {
      if (stripWatch.has(instrumentId)) continue
      stripWatch.set(instrumentId, o.engine.watch(instrumentId, 'ticker'))
    }

    return surface
  })

  /** Switching the strip on or off. Its own channel because it is one switch, reached from the strip and from Settings. */
  handle('markets:strip-enabled', async (id, enabled) => {
    const ticker = await o.store.ticker(id)
    await o.store.setTicker(id, { ...ticker, enabled: enabled === true })
    if (enabled !== true) {
      // Off means off: the subscriptions go with the pixels, rather than streaming for a strip nobody can see.
      for (const [instrumentId, watching] of stripWatch) {
        watching()
        stripWatch.delete(instrumentId)
      }
    }
    return state(id)
  })

  /**
   * Finds instruments to add.
   *
   * Straight through to the providers, and only the configured ones. A provider with no key contributes nothing rather
   * than an empty row that looks like a missing result.
   */
  handle('markets:search', async (id, query) => {
    void id
    const found = await o.engine.search(str(query, 80), 25)
    // Remembered, so a chosen instrument can be drawn again after a restart without searching.
    await o.store.remember(await o.profileId(), found)
    return { results: found }
  })

  /**
   * Adds an instrument to the ticker.
   *
   * Makes a group if there is none, because "add this to my ticker" should not fail on the grounds that the person has not
   * yet created a container for it.
   */
  handle('markets:ticker-add', async (id, instrumentId) => {
    const wanted = str(instrumentId)
    if (!wanted) return { error: 'bad-request', message: 'Which instrument?' }
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    await o.store.remember(id, [instrument])

    const ticker = await o.store.ticker(id)
    const group = ticker.groups.find((g) => g.id === ticker.activeGroupId) ?? ticker.groups[0]
    if (!group) {
      await o.store.setTickerGroup(id, { id: randomUUID(), name: 'My markets', instrumentIds: [wanted] })
    } else if (!group.instrumentIds.includes(wanted)) {
      await o.store.setTickerGroup(id, { ...group, instrumentIds: [...group.instrumentIds, wanted] })
    }
    // A price straight away, so the row is not blank while a stream starts.
    await o.engine.refresh([wanted])
    return state(id)
  })

  handle('markets:ticker-remove', async (id, instrumentId) => {
    const wanted = str(instrumentId)
    const ticker = await o.store.ticker(id)
    const group = ticker.groups.find((g) => g.id === ticker.activeGroupId) ?? ticker.groups[0]
    if (group) {
      await o.store.setTickerGroup(id, { ...group, instrumentIds: group.instrumentIds.filter((one) => one !== wanted) })
    }
    return state(id)
  })

  handle('markets:ticker-group', async (id, name) => {
    await o.store.setTickerGroup(id, { id: randomUUID(), name: str(name, 60) || 'Group', instrumentIds: [] })
    return state(id)
  })

  handle('markets:set-group', async (id, groupId) => {
    const ticker = await o.store.ticker(id)
    await o.store.setTicker(id, { ...ticker, activeGroupId: str(groupId, 80) })
    return state(id)
  })

  handle('markets:remove-group', async (id, groupId) => {
    await o.store.removeTickerGroup(id, str(groupId, 80))
    return state(id)
  })

  /** Fresh prices now, for the settings screen's preview. */
  handle('markets:refresh', async (id) => {
    const watching = await o.store.watching(id)
    if (watching.length) await o.engine.refresh(watching)
    return state(id)
  })

  // ---------------------------------------------------------------- what the Markets page holds open

  /**
   * The subscriptions this window is holding, and why.
   *
   * A page that opens BTC asks the engine to watch it; a page that navigates away should stop. Kept here rather than in the
   * engine because the engine counts reasons and does not know about windows -- and a window that reloads without releasing
   * would otherwise leave a subscription running for a page that no longer exists.
   */
  const held = new Map<string, { release: () => void; tape?: () => void; book?: () => void }>()

  /**
   * Instruments the simulated account needs a price for, whoever is looking.
   *
   * Separate from the page's own subscriptions and deliberately not released when a screen closes: a waiting limit order
   * has to see the price that fills it, and an order that only filled while its page was open would be a simulation of
   * the page rather than of the market.
   */
  const paperWatch = new Map<string, () => void>()

  /**
   * The instruments the screen is currently showing prices for.
   *
   * Separate from `held`, which is per-panel (a chart, a book, a tape). This one follows whatever list is on screen
   * and is rewritten every time that list changes, which is what keeps a closed watchlist from streaming for ever.
   */
  const listWatch = new Map<string, () => void>()

  const releaseAll = (): void => {
    for (const one of held.values()) {
      one.tape?.()
      one.release()
    }
    held.clear()
    for (const release of listWatch.values()) release()
    listWatch.clear()
  }

  // The account's own subscriptions outlive a page but not the window: when Orbis closes there is nothing left to
  // simulate against.
  o.getWindow()?.on('closed', () => {
    for (const release of paperWatch.values()) release()
    paperWatch.clear()
  })

  const window = o.getWindow()
  // A reload is a new page with none of the old page's panels open, so the old page's subscriptions go with it.
  window?.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) releaseAll()
  })
  window?.on('closed', releaseAll)

  /**
   * Prices, pushed to the window the moment they arrive.
   *
   * The engine has always emitted a `quote` event for every tick off the provider's socket, and nothing carried those
   * to the screen -- so the Markets screen asked for quotes on a two-second timer against a cache that was allowed to
   * be a minute old. Two seconds of asking for a number that changes sixty times a second is not live; it is a
   * slideshow, and the minute-old cache behind it is why prices looked stuck.
   *
   * Pushing is what makes it real time. A trade on Binance reaches this listener as it happens, and from here it is
   * one `send` to the screen.
   *
   * ## Why it is batched, and why that is not a compromise
   *
   * A busy market produces thousands of ticks a second, and an IPC message per tick would spend more time crossing
   * the process boundary than drawing anything -- the screen cannot show more than it can paint, and a monitor
   * repaints 60 to 144 times a second. So ticks are collected and flushed on the next animation-rate beat.
   *
   * Nothing is dropped that matters: within a beat, the newest price for an instrument is the price, and the older
   * ones are values that were true for four milliseconds. What is kept is the *latest* per instrument rather than a
   * sample, so the number on screen is always the current one rather than one from a fixed moment ago.
   */
  const pending = new Map<string, unknown>()
  let flushTimer: NodeJS.Timeout | null = null

  const flushTicks = (): void => {
    flushTimer = null
    if (pending.size === 0) return
    const target = o.getWindow()
    if (!target || target.isDestroyed()) {
      pending.clear()
      return
    }
    const batch = [...pending.values()]
    pending.clear()
    target.webContents.send('markets:tick', batch)
  }

  const stopForwarding = o.engine.on((event) => {
    if (event.type !== 'quote' && event.type !== 'trade') return
    const instrumentId = event.instrumentId
    if (typeof instrumentId !== 'string') return
    // Keyed by instrument, so a burst collapses to the newest price for each rather than a queue of stale ones.
    pending.set(`${event.type}:${instrumentId}`, event)
    // ~16ms: one screen refresh. Sooner than this is work nobody can see.
    if (flushTimer === null) flushTimer = setTimeout(flushTicks, 16)
  })

  window?.on('closed', () => {
    stopForwarding()
    if (flushTimer !== null) clearTimeout(flushTimer)
    flushTimer = null
    pending.clear()
  })

  /**
   * The interval that was asked for, or null when it is not one Orbis names.
   *
   * Null rather than a default. Falling back to an hour meant a request for 3-minute candles was answered with hourly ones
   * under the caller's own label -- the exact substitution the capability check below exists to prevent, defeated three
   * lines above it. A chart that says it cannot show an interval is honest; one that shows a different interval is not.
   */
  const interval = (value: unknown): Interval | null => {
    const wanted = str(value, 8) as Interval
    return INTERVALS.includes(wanted) ? wanted : null
  }

  const count = (value: unknown, low: number, high: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback

  const filterFrom = (value: unknown): DiscoveryFilter => {
    const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
    const filter: DiscoveryFilter = {}
    const currency = str(raw.quoteCurrency, 12)
    if (currency) filter.quoteCurrency = currency
    if (typeof raw.minQuoteVolume === 'number' && Number.isFinite(raw.minQuoteVolume) && raw.minQuoteVolume > 0) {
      filter.minQuoteVolume = raw.minQuoteVolume
    }
    const text = str(raw.text, 40)
    if (text) filter.text = text
    return filter
  }

  /** What this instrument's own provider can be asked for. Never what another provider could do. */
  const canFor = (instrument: Instrument): MarketDetail['can'] => {
    const provider = o.engine.list().find((p) => p.id === instrument.provider)
    if (!provider || !provider.ready().ok) {
      return { candles: false, orderBook: false, trades: false, intervals: [], derivatives: false }
    }
    const c = provider.capabilities
    return {
      candles: typeof provider.candles === 'function' && c.intervals.length > 0,
      orderBook: c.orderBook && typeof provider.orderBook === 'function',
      trades: c.trades && typeof provider.trades === 'function',
      intervals: [...c.intervals],
      // This instrument's own provider, never what another one could do: a spot pair is not given a derivatives tab
      // because a futures provider happens to be registered beside it.
      derivatives:
        (c.funding && typeof provider.funding === 'function') ||
        (c.openInterest && typeof provider.openInterest === 'function')
    }
  }

  const detailFor = async (
    profileId: string,
    instrumentId: string
  ): Promise<MarketDetail | { error: string; message: string }> => {
    const instrument = await o.engine.instrument(instrumentId)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const lists = await o.store.watchlists(profileId)
    return {
      instrument,
      quote: o.engine.quote(instrumentId),
      can: canFor(instrument),
      onWatchlists: lists.filter((l) => l.items.some((i) => i.instrumentId === instrumentId)).map((l) => l.id)
    }
  }

  /**
   * Opens a market: starts watching it and answers with everything the page needs to draw its header.
   *
   * Counted as a chart reason, which is the highest priority the engine has, because it is the thing somebody is actually
   * looking at.
   */
  handle('markets:open', async (id, instrumentId) => {
    const wanted = str(instrumentId)
    if (!wanted) return { error: 'bad-request', message: 'Which instrument?' }
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }

    if (!held.has(wanted)) held.set(wanted, { release: o.engine.watch(wanted, 'chart') })
    // A price straight away rather than a dash until the stream happens to tick.
    if (o.engine.quote(wanted) === null) await o.engine.refresh([wanted])
    // Remembered here rather than in the window, so opening a market from Orion or a workflow counts too.
    void o.store.remember_(id, str(instrumentId))
    return detailFor(id, wanted)
  })

  /** Closes a market, releasing what it was holding. Idempotent: a page closing twice is not an error. */
  handle('markets:close', (id, instrumentId) => {
    void id
    const wanted = str(instrumentId)
    const one = held.get(wanted)
    if (one) {
      one.tape?.()
      // The book goes with the market: a depth stream held open for a panel that has gone is the leak this releases.
      one.book?.()
      one.release()
      held.delete(wanted)
    }
    return { closed: true }
  })

  /** The current state of one open market, for a page redrawing its header. */
  handle('markets:detail', (id, instrumentId) => detailFor(id, str(instrumentId)))

  /**
   * Live prices for a set of instruments, for a watchlist or a dashboard redrawing its rows.
   *
   * The connection comes back with them. It is the same question the prices are asking -- "is this live?" -- and a header
   * that reported it only once said "Disconnected" beside a price that was arriving, because the stream connects a moment
   * after the screen opens and nothing told the screen.
   */
  handle('markets:quotes', async (id, instrumentIds, refresh) => {
    void id
    const ids = (Array.isArray(instrumentIds) ? instrumentIds : [])
      .map((one) => str(one))
      .filter(Boolean)
      .slice(0, 500)
    // With `refresh`, anything that has never been priced is asked for once. A screen about to trade a market nothing is
    // subscribed to would otherwise be told there is no price for it, which is true of the cache and not of the market.
    if (refresh === true) {
      const missing = ids.filter((one) => o.engine.quote(one) === null)
      if (missing.length > 0) await o.engine.refresh(missing.slice(0, 50))
    }

    /**
     * Whatever the screen is showing is subscribed to the provider's socket.
     *
     * `watch` was only ever called for a chart, an order book, a tape or an alert -- never for the rows of a
     * watchlist. So the list on screen was not on the socket at all: every price in it came from a cache that
     * something else happened to fill, refreshed by whatever asked next. That is why it looked frozen, and it is
     * why polling harder would not have fixed it -- there was nothing newer to ask for.
     *
     * Subscribing here is what makes the tick stream carry these instruments. The list is re-subscribed each time
     * the screen asks, and anything no longer on it is released, so switching watchlists does not leave the old
     * one's symbols streaming for ever.
     */
    const stillWanted = new Set(ids)
    for (const [instrumentId, watching] of listWatch) {
      if (stillWanted.has(instrumentId)) continue
      watching()
      listWatch.delete(instrumentId)
    }
    for (const instrumentId of ids) {
      if (listWatch.has(instrumentId)) continue
      listWatch.set(instrumentId, o.engine.watch(instrumentId, 'watchlist'))
    }

    return {
      quotes: ids.map((one) => ({ instrumentId: one, quote: o.engine.quote(one) })),
      connection: o.runtime.connection()
    }
  })

  // ---------------------------------------------------------------- history, depth and the tape

  handle('markets:candles', async (id, instrumentId, wantedInterval, limit) => {
    void id
    const wanted = str(instrumentId)
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const can = canFor(instrument)
    const chosen = interval(wantedInterval)
    if (!can.candles) return { error: 'unsupported', message: 'That provider has no historical data.' }
    if (chosen === null) return { error: 'unsupported', message: 'Orbis does not have candles at that interval.' }
    if (!can.intervals.includes(chosen)) {
      // Said rather than substituted: a chart labelled 5m showing hourly candles is worse than a chart saying it cannot.
      return { error: 'unsupported', message: 'That provider does not serve candles at that interval.' }
    }
    const candles = await o.engine.candlesFor(wanted, chosen, count(limit, 10, 1000, 300))
    return { instrumentId: wanted, interval: chosen, candles }
  })

  /**
   * Starts following one market's book.
   *
   * Separate from reading it, and refcounted by the engine, because a depth stream is the heaviest thing a venue
   * publishes: one open panel should not make every watched instrument pay for it. The first read may come back
   * resynchronising while the snapshot is in flight, which the panel says rather than drawing an empty book.
   */
  handle('markets:book-open', async (id, instrumentId, depth) => {
    void id
    const wanted = str(instrumentId)
    const one = held.get(wanted)
    if (!one) return { error: 'invalid-params', message: 'That market is not open.' }
    if (!one.book) one.book = o.engine.watchBook(wanted)
    return bookAnswer(wanted, count(depth, 5, 100, 20))
  })

  /**
   * The book as it stands.
   *
   * From the keeper when one is following this market, which is the only version that can say whether it is provably
   * continuous. A polled snapshot otherwise -- honest, and labelled as what it is.
   */
  const bookAnswer = async (instrumentId: string, depth: number): Promise<BookAnswer | { error: string; message: string }> => {
    const live = o.engine.bookView(instrumentId, depth)
    if (live) {
      return {
        book: live,
        // Said outright, because "this book is out of date" is the one thing a depth panel must never hide.
        stale: live.state !== 'live',
        polled: false
      }
    }
    const polled = await o.engine.polledBook(instrumentId, depth)
    // Null rather than an empty book: no levels and unknown levels look identical on screen and mean opposite things.
    if (!polled) return { error: 'unsupported', message: 'That provider has no order book.' }
    return { book: polled, stale: false, polled: true }
  }

  handle('markets:book', (id, instrumentId, depth) => {
    void id
    return bookAnswer(str(instrumentId), count(depth, 5, 100, 20))
  })

  handle('markets:book-close', (id, instrumentId) => {
    void id
    const one = held.get(str(instrumentId))
    if (one?.book) {
      one.book()
      one.book = undefined
    }
    return { closed: true }
  })

  /**
   * Opens the tape for one instrument: seeds it from recent trades and starts streaming prints.
   *
   * The trade subscription is separate from the price subscription because they cost differently -- a busy pair sends
   * several prints a second, and the ticker's twenty symbols want none of them.
   */
  handle('markets:tape-open', async (id, instrumentId, limit) => {
    void id
    const wanted = str(instrumentId)
    const one = held.get(wanted)
    if (!one) return { error: 'bad-request', message: 'That market is not open.' }
    if (!one.tape) one.tape = o.engine.watchTrades(wanted)
    const trades = await o.engine.tradesFor(wanted, count(limit, 10, 500, 50))
    return { trades } as { trades: TradePrint[] }
  })

  /** The tape as it stands now. Bounded by the engine, so this can be asked as often as a panel redraws. */
  handle('markets:tape', (id, instrumentId) => {
    void id
    return { trades: o.engine.trades(str(instrumentId)) }
  })

  handle('markets:tape-close', (id, instrumentId) => {
    void id
    const one = held.get(str(instrumentId))
    if (one?.tape) {
      one.tape()
      one.tape = undefined
    }
    return { closed: true }
  })

  // ---------------------------------------------------------------- discovery

  /**
   * Movers, volume leaders, the heatmap and breadth, all from one snapshot.
   *
   * One request to the provider answers all four, and they are computed by the one shared module rather than per panel --
   * which is what stops a dashboard from showing a coin among its gainers that the movers list below disagrees about.
   */
  handle('markets:discover', async (id, options) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    const raw = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    const filter = filterFrom(raw.filter)
    const limit = count(raw.limit, 3, 50, 8)

    if (!o.engine.universeAvailable()) {
      // Said, not drawn as an empty dashboard: nothing configured can answer a question about every market.
      return {
        gainers: [],
        losers: [],
        volume: [],
        tiles: [],
        breadth: breadth([]),
        universeSize: 0,
        available: false,
        connection: o.runtime.connection()
      } as DiscoveryAnswer
    }

    const rows = await o.engine.universe()
    const considered = rows.filter((row) => matches(row, filter))
    return {
      gainers: movers(rows, 'gainers', limit, filter),
      losers: movers(rows, 'losers', limit, filter),
      volume: movers(rows, 'volume', limit, filter),
      tiles: heatmap(rows, count(raw.tiles, 6, 120, 40), filter),
      breadth: breadth(rows, filter),
      universeSize: considered.length,
      available: true,
      connection: o.runtime.connection()
    } as DiscoveryAnswer
  })

  /** One mover list on its own, for a panel that shows a single kind. */
  handle('markets:movers', async (id, kind, limit, filter) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    if (!o.engine.universeAvailable()) return { error: 'unsupported', message: 'No provider can report every market.' }
    const wanted = str(kind, 12)
    const allowed: MoverKind[] = ['gainers', 'losers', 'volume', 'active']
    const chosen = (allowed as string[]).includes(wanted) ? (wanted as MoverKind) : 'gainers'
    const rows = await o.engine.universe()
    return { kind: chosen, rows: movers(rows, chosen, count(limit, 3, 100, 20), filterFrom(filter)) }
  })

  // ---------------------------------------------------------------- watchlists

  const watchlistAnswer = async (profileId: string): Promise<WatchlistsAnswer> => {
    const lists = await o.store.watchlists(profileId)
    const ids = new Set<string>()
    for (const list of lists) for (const item of list.items) ids.add(item.instrumentId)
    return {
      watchlists: lists,
      quotes: [...ids].map((one) => ({ instrumentId: one, quote: o.engine.quote(one) }))
    }
  }

  handle('markets:watchlists', (id) => watchlistAnswer(id))

  handle('markets:watchlist-create', async (id, name) => {
    await o.store.createWatchlist(id, str(name, 60) || 'Watchlist')
    return watchlistAnswer(id)
  })

  handle('markets:watchlist-rename', async (id, listId, name) => {
    await o.store.renameWatchlist(id, str(listId, 80), str(name, 60))
    return watchlistAnswer(id)
  })

  handle('markets:watchlist-remove', async (id, listId) => {
    await o.store.removeWatchlist(id, str(listId, 80))
    return watchlistAnswer(id)
  })

  /**
   * Puts an instrument on a watchlist.
   *
   * The instrument is resolved first, so what is stored is the whole instrument rather than a symbol -- a list that saved
   * only BTCUSDT could not tell one exchange's market from another's when it was read back.
   */
  handle('markets:watchlist-add', async (id, listId, instrumentId) => {
    const wanted = str(instrumentId)
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    await o.store.addToWatchlist(id, str(listId, 80), instrument)
    await o.store.remember(id, [instrument])
    if (o.engine.quote(wanted) === null) await o.engine.refresh([wanted])
    return watchlistAnswer(id)
  })

  handle('markets:watchlist-remove-item', async (id, listId, instrumentId) => {
    await o.store.removeFromWatchlist(id, str(listId, 80), str(instrumentId))
    return watchlistAnswer(id)
  })

  // ---------------------------------------------------------------- the screener

  /**
   * How many markets may be examined with candles in one run.
   *
   * Each one is a request to the provider, so this is a real cost rather than a tidiness limit. The answer carries how
   * many were examined and how many were left out, and the interface says so: a screen that quietly examined the first
   * fifty would present its answer as the market's, and it would not be.
   */
  const EXAMINE_CAP = 60
  /** How many candle requests are in flight at once. Enough to be quick, few enough not to earn a rate limit. */
  const EXAMINE_BATCH = 6

  handle('markets:screen', async (id, raw) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    if (!o.engine.universeAvailable()) {
      return { error: 'unsupported', message: 'No configured provider can report every market, so there is nothing to screen.' }
    }
    const query = cleanQuery(raw)
    const rows = await o.engine.universe()

    if (!queryNeedsCandles(query)) {
      // Everything this query asks about is already held. No requests, no cap, no omissions.
      return { answer: screen(rows, query), interval: null, cap: null }
    }

    const { passed } = screenSnapshot(rows, query)
    // The cap takes the most-traded first. Any cap is a choice about which markets get examined, and turnover is the one
    // that can be justified: it is the same figure the screener sorts and filters by, and it is a fact from the feed.
    const ordered = [...passed].sort((a, b) => (turnoverOf(b.quote) ?? -1) - (turnoverOf(a.quote) ?? -1))
    const targets = ordered.slice(0, EXAMINE_CAP)

    const wantedInterval =
      query.conditions.find((c) => typeof c.interval === 'string' && c.interval)?.interval ?? '1h'
    const chosen = interval(wantedInterval) ?? '1h'
    const held = new Map<string, Candle[]>()

    for (let at = 0; at < targets.length; at += EXAMINE_BATCH) {
      const batch = targets.slice(at, at + EXAMINE_BATCH)
      await Promise.all(
        batch.map(async (row) => {
          try {
            const candles = await o.engine.candlesFor(row.instrument.instrumentId, chosen, 300)
            if (candles.length > 0) held.set(row.instrument.instrumentId, candles)
          } catch {
            // A market whose history could not be fetched is counted as skipped by the screener, which is the honest
            // outcome: it was not examined, and it was not judged.
          }
        })
      )
    }

    return {
      answer: screen(rows, query, (instrumentId) => held.get(instrumentId) ?? null),
      interval: chosen,
      cap: EXAMINE_CAP
    }
  })

  handle('markets:screens', async (id) => ({ screens: await o.store.screens(id) }))

  handle('markets:screen-save', async (id, name, raw, screenId) => {
    const saved = await o.store.saveScreen(id, str(name, 60), raw, str(screenId, 80) || undefined)
    return { screens: await o.store.screens(id), saved }
  })

  handle('markets:screen-remove', async (id, screenId) => {
    await o.store.removeScreen(id, str(screenId, 80))
    return { screens: await o.store.screens(id) }
  })

  // ---------------------------------------------------------------- alerts

  /**
   * Every alert, with the instrument each one is about and the last price it was judged against.
   *
   * The instruments come along because an alert stores an id, and a list showing raw ids would be unreadable. They are the
   * engine's own record of the instrument, not a second copy kept beside the alert.
   */
  const alertAnswer = async (profileId: string): Promise<AlertsAnswer> => {
    const alerts = await o.store.alerts(profileId)
    const instruments: Instrument[] = []
    const seen = new Set<string>()
    for (const alert of alerts) {
      if (seen.has(alert.instrumentId)) continue
      seen.add(alert.instrumentId)
      const instrument = await o.engine.instrument(alert.instrumentId)
      if (instrument) instruments.push(instrument)
    }
    return {
      alerts,
      instruments,
      quotes: [...seen].map((one) => ({ instrumentId: one, quote: o.engine.quote(one) })),
      history: [...(await o.store.alertHistory(profileId))].reverse()
    }
  }

  handle('markets:alerts', (id) => alertAnswer(id))

  /**
   * Saves an alert.
   *
   * The instrument is resolved first: an alert about a market no provider can describe could never be judged, and saving
   * it would leave something in the list that silently never fires.
   */
  handle('markets:alert-save', async (id, raw) => {
    const incoming = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const instrumentId = str(incoming.instrumentId)
    const instrument = await o.engine.instrument(instrumentId)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    // A new alert arrives without one. `cleanAlert` insists on an id because a record in a file that has lost its id is
    // broken, but a condition somebody has just typed has not been given one yet -- minting it here is what makes the
    // difference between reading an alert back and creating one.
    const withId = typeof incoming.id === 'string' && incoming.id ? incoming : { ...incoming, id: randomUUID() }
    const saved = await o.store.saveAlert(id, withId)
    if (!saved) return { error: 'bad-request', message: 'That is not a condition Orbis can judge.' }
    await o.store.remember(id, [instrument])
    // A price now, so a new alert is judged against the market rather than waiting for the next tick.
    if (o.engine.quote(instrumentId) === null) await o.engine.refresh([instrumentId])
    return alertAnswer(id)
  })

  handle('markets:alert-remove', async (id, alertId) => {
    await o.store.removeAlert(id, str(alertId, 80))
    return alertAnswer(id)
  })

  handle('markets:alert-history-clear', async (id) => {
    await o.store.clearAlertHistory(id)
    return alertAnswer(id)
  })

  // ---------------------------------------------------------------- paper trading

  /**
   * Everything the portfolio screen shows.
   *
   * Worked out in one place, so the allocation, the exposure and the performance cannot disagree about the same account.
   * `ASSUMPTIONS` travels with it: a simulated result read without knowing what was assumed is worth very little, and
   * making the interface fetch them separately is how they end up not being shown.
   */
  const paperAnswer = async (profileId: string): Promise<PaperAnswer> => {
    const held = await o.store.paper(profileId)
    if (!held) {
      return { state: null, value: null, view: null, instruments: [], prices: [], assumptions: ASSUMPTIONS }
    }

    const ids = new Set<string>()
    for (const position of held.account.positions) ids.add(position.instrumentId)
    for (const order of held.account.orders) if (order.state === 'pending') ids.add(order.instrumentId)
    for (const fill of held.account.fills) ids.add(fill.instrumentId)

    const prices = new Map<string, number | null>()
    const instruments: Instrument[] = []
    for (const instrumentId of ids) {
      prices.set(instrumentId, o.engine.quote(instrumentId)?.last ?? null)
      const instrument = await o.engine.instrument(instrumentId)
      if (instrument) instruments.push(instrument)
    }

    return {
      state: held,
      value: valueOf(held.account, prices),
      view: portfolioView(held.account, prices, held.equity),
      instruments,
      prices: [...prices].map(([instrumentId, price]) => ({ instrumentId, price })),
      assumptions: ASSUMPTIONS
    }
  }

  handle('markets:paper', (id) => paperAnswer(id))

  /**
   * Starts a simulated account.
   *
   * Refuses to replace one that already has a history unless the caller says so, because starting again throws away every
   * trade and the equity curve with it -- and neither can be got back.
   */
  handle('markets:paper-start', async (id, startingCash, currency, replace) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    const cash = typeof startingCash === 'number' && Number.isFinite(startingCash) ? startingCash : 0
    if (cash <= 0) return { error: 'bad-request', message: 'A simulated account needs a starting balance above zero.' }

    const existing = await o.store.paper(id)
    if (existing && existing.account.fills.length > 0 && replace !== true) {
      return {
        error: 'exists',
        message: 'There is already a simulated account with trades in it. Starting again would discard them.'
      }
    }
    await o.store.startPaper(id, Math.min(1_000_000_000, cash), str(currency, 12) || 'USD')
    return paperAnswer(id)
  })

  handle('markets:paper-close', async (id) => {
    await o.store.closePaper(id)
    return paperAnswer(id)
  })

  handle('markets:paper-settings', async (id, settings) => {
    const raw = (settings && typeof settings === 'object' ? settings : {}) as Record<string, unknown>
    const fraction = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.5 ? value : undefined
    await o.store.setPaperSettings(id, {
      ...(fraction(raw.slippage) !== undefined ? { slippage: fraction(raw.slippage) as number } : {}),
      ...(fraction(raw.feeRate) !== undefined ? { feeRate: fraction(raw.feeRate) as number } : {}),
      ...(typeof raw.allowShort === 'boolean' ? { allowShort: raw.allowShort } : {})
    })
    return paperAnswer(id)
  })

  /**
   * Places a simulated order.
   *
   * Simulated, and nowhere near an exchange: there is no credential anywhere in this process that could reach one. The
   * engine decides whether it fills, is refused, or waits -- this only validates the shape and hands it over.
   */
  handle('markets:paper-order', async (id, raw) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    const held = await o.store.paper(id)
    if (!held) return { error: 'no-account', message: 'There is no simulated account yet.' }

    const incoming = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const instrumentId = str(incoming.instrumentId)
    const instrument = await o.engine.instrument(instrumentId)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    if (incoming.side !== 'buy' && incoming.side !== 'sell') return { error: 'bad-request', message: 'Buy or sell?' }

    const type = ['market', 'limit', 'stop', 'stop-limit'].includes(String(incoming.type))
      ? (incoming.type as OrderType)
      : 'market'
    const quantity = typeof incoming.quantity === 'number' && Number.isFinite(incoming.quantity) ? incoming.quantity : 0
    if (quantity <= 0) return { error: 'bad-request', message: 'A quantity has to be a positive number.' }

    // A price first, so a market order is simulated against something current rather than whatever last arrived.
    if (o.engine.quote(instrumentId) === null) await o.engine.refresh([instrumentId])
    const quote = o.engine.quote(instrumentId)

    const number = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

    const outcome = place(
      held.account,
      {
        id: randomUUID(),
        instrumentId,
        side: incoming.side as Side,
        type,
        quantity,
        limitPrice: number(incoming.limitPrice),
        stopPrice: number(incoming.stopPrice),
        placedAt: Date.now()
      },
      quote,
      held.settings
    )
    await o.store.setPaperAccount(id, outcome.account)
    await o.store.remember(id, [instrument])
    // Watched from now on, or a waiting limit order would never see the price that fills it.
    if (!paperWatch.has(instrumentId)) paperWatch.set(instrumentId, o.engine.watch(instrumentId, 'alert'))

    return { ...(await paperAnswer(id)), outcome: { detail: outcome.detail, state: outcome.order.state } }
  })

  handle('markets:paper-cancel', async (id, orderId) => {
    const held = await o.store.paper(id)
    if (!held) return { error: 'no-account', message: 'There is no simulated account yet.' }
    await o.store.setPaperAccount(id, cancel(held.account, str(orderId, 80)))
    return paperAnswer(id)
  })

  // ---------------------------------------------------------------- strategies and backtests

  /** How many candles a backtest may ask a provider for. A ceiling, and the answer says what it actually got. */
  const MAX_BARS = 1000

  const strategyAnswer = async (profileId: string): Promise<StrategiesAnswer> => {
    const strategies = await o.store.strategies(profileId)
    const instruments: Instrument[] = []
    const seen = new Set<string>()
    for (const strategy of strategies) {
      if (seen.has(strategy.instrumentId)) continue
      seen.add(strategy.instrumentId)
      const instrument = await o.engine.instrument(strategy.instrumentId)
      if (instrument) instruments.push(instrument)
    }
    return {
      strategies,
      instruments,
      runs: [...(await o.store.backtestRuns(profileId))].reverse(),
      problems: Object.fromEntries(strategies.map((one) => [one.id, problemsWith(one)]))
    }
  }

  handle('markets:strategies', (id) => strategyAnswer(id))

  /**
   * Saves a strategy.
   *
   * The instrument is resolved first: rules about a market no provider can describe could never be run, and storing them
   * would leave something in the list that fails only when somebody presses the button.
   */
  handle('markets:strategy-save', async (id, raw) => {
    const incoming = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const instrument = await o.engine.instrument(str(incoming.instrumentId))
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const saved = await o.store.saveStrategy(id, incoming)
    if (!saved) return { error: 'bad-request', message: 'That is not a strategy Orbis can run.' }
    await o.store.remember(id, [instrument])
    return { ...(await strategyAnswer(id)), saved }
  })

  handle('markets:strategy-remove', async (id, strategyId) => {
    await o.store.removeStrategy(id, str(strategyId, 80))
    return strategyAnswer(id)
  })

  /**
   * Runs a backtest.
   *
   * Real candles from the provider, then the deterministic engine. Nothing about the result is stored except its headline
   * figures -- the detail comes back to the caller now, and can be produced again from the strategy, the costs and the
   * same candles, which is what a deterministic backtester is for.
   */
  handle('markets:backtest', async (id, strategyId, options) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    const strategies = await o.store.strategies(id)
    const strategy = strategies.find((one) => one.id === str(strategyId, 80))
    if (!strategy) return { error: 'not-found', message: 'There is no strategy with that id.' }

    const problems = problemsWith(strategy)
    if (problems.length > 0) return { error: 'bad-request', message: problems[0] }

    const instrument = await o.engine.instrument(strategy.instrumentId)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const can = canFor(instrument)
    if (!can.candles) return { error: 'unsupported', message: 'That provider has no historical data to test against.' }
    const chosen = interval(strategy.interval)
    if (chosen === null || !can.intervals.includes(chosen)) {
      return { error: 'unsupported', message: `That provider does not serve ${strategy.interval} candles.` }
    }

    const raw = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    const bars = count(raw.bars, 50, MAX_BARS, 500)
    const candles = await o.engine.candlesFor(strategy.instrumentId, chosen, bars)
    if (candles.length < 3) {
      return { error: 'no-data', message: 'The provider returned too little history to test against.' }
    }

    const fraction = (value: unknown, fallback: number): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 0.5 ? value : fallback

    const result = backtest(strategy, candles, {
      startingCash: count(raw.startingCash, 1, 1_000_000_000, 10_000),
      costs: { slippage: fraction(raw.slippage, 0.0005), feeRate: fraction(raw.feeRate, 0.001) },
      outOfSamplePercent: count(raw.outOfSamplePercent, 0, 50, 0),
      periodicity: chosen === '1d' || chosen === '1w' || chosen === '1M' ? 'daily' : 'hourly'
    })

    // Recorded so two runs can be compared later without running both again.
    await o.store.recordRun(id, {
      strategyId: strategy.id,
      strategyName: strategy.name,
      strategyVersion: strategy.version,
      instrumentId: strategy.instrumentId,
      interval: strategy.interval,
      at: Date.now(),
      from: result.from,
      to: result.to,
      bars: result.bars,
      trades: result.trades.length,
      totalReturnPercent: result.stats.totalReturnPercent,
      benchmarkReturnPercent: result.stats.benchmarkReturnPercent,
      maxDrawdownPercent: result.stats.maxDrawdownPercent,
      sharpe: result.stats.sharpe,
      winRate: result.stats.performance.winRate,
      ambiguousExits: result.ambiguousExits,
      startingCash: result.startingCash,
      costs: result.costs
    })

    return {
      result,
      /** How much history was actually available, which is often less than was asked for. */
      candlesAsked: bars,
      candlesGot: candles.length,
      description: describeStrategy(strategy),
      runs: [...(await o.store.backtestRuns(id))].reverse()
    }
  })

  /**
   * Sweeps one parameter.
   *
   * Only the stop, the target or the trailing stop: a sweep over indicator periods needs the whole series recomputed per
   * value, and a sweep of sweeps is how a backtester becomes a machine for producing the most flattering number it can
   * find. The warning it returns is the point of the feature as much as the numbers are.
   */
  handle('markets:backtest-sweep', async (id, strategyId, field, values) => {
    if (!(await o.store.enabled(id))) return { error: 'disabled', message: 'Markets is switched off.' }
    const strategies = await o.store.strategies(id)
    const strategy = strategies.find((one) => one.id === str(strategyId, 80))
    if (!strategy) return { error: 'not-found', message: 'There is no strategy with that id.' }

    const which = str(field, 24)
    const allowed = ['stopLossPercent', 'takeProfitPercent', 'trailingStopPercent']
    if (!allowed.includes(which)) return { error: 'bad-request', message: 'That is not a parameter Orbis can sweep.' }

    const wanted = (Array.isArray(values) ? values : [])
      .map((one) => (typeof one === 'number' && Number.isFinite(one) && one > 0 && one <= 100 ? one : null))
      .filter((one): one is number => one !== null)
      .slice(0, 20)
    if (wanted.length < 2) return { error: 'bad-request', message: 'A sweep needs at least two values to compare.' }

    const chosen = interval(strategy.interval)
    if (chosen === null) return { error: 'unsupported', message: 'That is not an interval Orbis knows.' }
    const candles = await o.engine.candlesFor(strategy.instrumentId, chosen, 500)
    if (candles.length < 3) return { error: 'no-data', message: 'There is too little history to sweep against.' }

    return sweep(strategy, candles, (base, value) => ({ ...base, [which]: value }), wanted)
  })

  handle('markets:backtest-runs', async (id) => ({ runs: [...(await o.store.backtestRuns(id))].reverse() }))

  handle('markets:backtest-runs-clear', async (id) => {
    await o.store.clearRuns(id)
    return { runs: [] }
  })

  // ---------------------------------------------------------------- news

  /**
   * Crypto headlines from the publishers' own feeds.
   *
   * Through the one feed reader Orbis already has, which caches and backs off on its own — a second fetcher for the same
   * kind of thing would be a second set of rate limits to get wrong. Each source is fetched independently, so one
   * publisher being unreachable costs its headlines and nothing else, and the answer names the ones that failed.
   *
   * The assets a headline is about are decided by `assetsIn`, which wants the symbol on a word boundary or the asset's
   * name in prose. It will miss some genuine mentions. That is the right trade against a panel that attaches a story
   * about a company called Bitcoin Depot to the bitcoin market.
   */
  handle('markets:news', async (id, options) => {
    if (!o.readFeed) return { error: 'unavailable', message: 'This build has no feed reader.' }
    const raw = (options && typeof options === 'object' ? options : {}) as Record<string, unknown>
    const limit = count(raw.limit, 5, 120, 60)

    // What to look for: what this profile is watching, plus the majors, so a headline about a market nobody follows is
    // still recognised as being about that market.
    const workspace = await o.store.read(id)
    const known = new Set<string>(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'BNB', 'AVAX', 'LINK', 'DOT'])
    for (const list of workspace.watchlists) for (const item of list.items) known.add(baseOf(item.instrument))
    for (const instrument of workspace.known.slice(0, 200)) known.add(baseOf(instrument))

    const wanted = str(raw.asset, 16).toUpperCase()
    const feeds: { source: (typeof NEWS_SOURCES)[number]; items: FeedItem[] }[] = []
    const unavailable: { name: string; reason: string }[] = []

    await Promise.all(
      NEWS_SOURCES.map(async (source) => {
        const got = await o.readFeed!(source.url)
        if (got.ok) feeds.push({ source, items: got.data.items })
        // Named rather than silently missing: a quiet panel and a broken publisher look identical otherwise.
        else unavailable.push({ name: source.name, reason: got.reason })
      })
    )

    const all = normaliseNews(feeds, { known: [...known], limit: 200 })
    const items = wanted ? newsAbout(all, wanted) : all
    return {
      items: items.slice(0, limit),
      sources: NEWS_SOURCES.map((one) => ({ name: one.name, home: one.home })),
      unavailable,
      note:
        feeds.length === 0
          ? 'No news source could be reached, so there are no headlines — not no news.'
          : undefined
    }
  })

  // ---------------------------------------------------------------- where Markets was left

  handle('markets:layout', (id) => o.store.layout(id))

  handle('markets:set-layout', (id, layout) => o.store.setLayout(id, layout))

  // ---------------------------------------------------------------- what money is shown in

  /**
   * The currency, the rate it converts through, and where both came from.
   *
   * One answer for the whole screen: every surface formats from this rather than each working out its own rate, which
   * is what stops the ticker and the portfolio disagreeing about what a bitcoin is worth.
   */
  const currencyAnswer = async (profileId: string): Promise<CurrencyAnswer> => {
    const preference = await o.store.resolveCurrency(profileId, o.detectionSignals?.() ?? {})
    // Crypto markets here are quoted against dollar stablecoins, so that is what is being converted *from*. Said in the
    // answer rather than assumed, so a screen can show "source: BTC/USDT, displayed in INR".
    const base = 'USD'
    const rate = preference.code === base ? null : ((await o.fx?.rate(base, preference.code)) ?? null)
    const status = o.fx?.status(base)
    return {
      preference,
      base,
      rate,
      // Never inferred from the rate's presence: a conversion with no rate is unavailable, and one through an old rate
      // is not current, and the interface must be able to say which.
      freshness: preference.code === base ? 'real-time' : freshnessOfRate(rate?.at ?? null, Date.now()),
      fxSource: status?.source ?? null,
      fxUpdatedAt: status?.at ?? null,
      fxFailing: status?.failing ?? '',
      currencies: CURRENCIES,
      suggested: SUGGESTED
    }
  }

  handle('markets:currency', (id) => currencyAnswer(id))

  handle('markets:set-currency', async (id, code) => {
    await o.store.setCurrency(id, str(code, 8))
    return currencyAnswer(id)
  })

  handle('markets:reset-currency', async (id) => {
    await o.store.resetCurrency(id, o.detectionSignals?.() ?? {})
    return currencyAnswer(id)
  })

  handle('markets:currency-options', async (id, patch) => {
    await o.store.setCurrencyOptions(id, patch)
    return currencyAnswer(id)
  })

  // ---------------------------------------------------------------- how Markets should behave

  /**
   * The experience, resolved.
   *
   * Resolved here as well as in the window, by the same pure function over the same profile -- so a capability Orion
   * calls and a panel somebody is looking at cannot disagree about what was configured.
   */
  const experienceAnswer = async (profileId: string): Promise<ExperienceAnswer> => {
    const workspace = await o.store.read(profileId)
    const resolved = resolveExperience(workspace.experience)
    const sources: Record<string, string> = {}
    for (const key of Object.keys(resolved.settings) as (keyof ExperienceSettings)[]) {
      sources[key] = resolved.source(key)
    }
    return {
      profile: workspace.experience,
      settings: resolved.settings,
      sources,
      onboarding: workspace.onboarding,
      needsSetup: needsOnboarding(workspace.onboarding),
      orion: orionContext(resolved),
      summary: describeExperience(resolved),
      levels: (Object.keys(LEVEL_LABELS) as (keyof typeof LEVEL_LABELS)[])
        .filter((one) => one !== 'custom')
        .map((one) => ({
          id: one,
          label: LEVEL_LABELS[one],
          preview: PRESET_PREVIEW[one as keyof typeof PRESET_PREVIEW] ?? []
        }))
    }
  }

  handle('markets:experience', (id) => experienceAnswer(id))

  handle('markets:set-experience', async (id, patch) => {
    await o.store.setExperience(id, patch)
    return experienceAnswer(id)
  })

  /** One setting, set by hand. Recorded as an override, which is what stops a later preset undoing it. */
  handle('markets:experience-override', async (id, patch) => {
    await o.store.setExperienceOverride(id, patch)
    return experienceAnswer(id)
  })

  handle('markets:reset-experience', async (id) => {
    await o.store.resetExperience(id)
    return experienceAnswer(id)
  })

  handle('markets:learned', async (id, termId, hint) => {
    await o.store.markLearned(id, str(termId, 40), hint === true)
    return experienceAnswer(id)
  })

  /**
   * Reads a sentence as a request to change the experience.
   *
   * Returns what it would change and does nothing, so Orion and the Orb can say what they are about to do. Null means it
   * was not a request about any of this, which is most sentences -- guessing would mean a passing mention of the word
   * "professional" rearranging somebody's interface.
   */
  handle('markets:experience-request', async (id, said) => {
    const patch = readExperienceRequest(str(said, 400))
    if (!patch) return { patch: null, applied: false, experience: await experienceAnswer(id) }
    return { patch, applied: false, experience: await experienceAnswer(id) }
  })

  // ---------------------------------------------------------------- what the words mean

  /**
   * One definition, in this profile's vocabulary.
   *
   * From the one glossary, so a tooltip, a panel and Orion cannot describe the same term three ways. Null when the term
   * is not one Markets has a definition for -- which is better than a definition invented on the spot, since a made-up
   * explanation of a market term is exactly as confident-looking as a real one.
   */
  handle('markets:explain', async (id, asked) => {
    const resolved = resolveExperience(await o.store.experience(id))
    const wanted = str(asked, 200)
    const term = lookupTerm(wanted)
    if (!term) return { found: false, explanation: null, terminology: resolved.settings.terminology }
    return {
      found: true,
      explanation: explain(term, resolved.settings.terminology),
      terminology: resolved.settings.terminology
    }
  })

  /** Every term a surface can explain, so a panel can offer its own without holding its own definitions. */
  handle('markets:glossary', async (id, surface) => {
    const resolved = resolveExperience(await o.store.experience(id))
    const wanted = str(surface, 40)
    const terms = wanted ? termsFor(wanted) : GLOSSARY
    return {
      terminology: resolved.settings.terminology,
      terms: terms.map((term) => explain(term, resolved.settings.terminology))
    }
  })

  // ---------------------------------------------------------------- the first launch

  const onboardingAnswer = async (profileId: string, draft: unknown = null): Promise<OnboardingAnswer> => {
    const record = await o.store.onboarding(profileId)
    const held = draft !== null ? cleanDraft(draft) : record.draft
    return {
      record,
      problems: held ? draftProblems(held) : [],
      review: held ? reviewOf(held) : []
    }
  }

  handle('markets:onboarding', (id) => onboardingAnswer(id))

  handle('markets:onboarding-draft', async (id, draft) => {
    await o.store.saveDraft(id, draft)
    return onboardingAnswer(id)
  })

  /**
   * Finishes setup.
   *
   * Validated, then resolved against real providers, then applied in one write. A market somebody chose that no provider
   * can describe any more is dropped rather than written as a row with a symbol and no instrument behind it.
   */
  handle('markets:onboarding-apply', async (id, raw) => {
    const draft = cleanDraft(raw)
    const problems = draftProblems(draft)
    if (problems.length > 0) return { ok: false, problems, experience: await experienceAnswer(id) }

    const applied = applyDraft(draft)
    const wanted = [...draft.watchlistAssets, ...draft.tickerAssets].map((one) => one.instrumentId)
    const instruments: Instrument[] = []
    for (const instrumentId of [...new Set(wanted)]) {
      const found = await o.engine.instrument(instrumentId)
      if (found) instruments.push(found)
    }
    const missing = [...new Set(wanted)].length - instruments.length

    await o.store.completeOnboarding(id, applied, instruments)
    // Saving already told the runtime, which re-derived its subscriptions from the workspace -- so applying a profile
    // costs no reconnection to the exchange. This only asks for a first price for anything newly watched.
    await o.runtime.prime()
    return {
      ok: true,
      problems: [],
      // Said rather than hidden. A watchlist that came back one market short should say so.
      missing,
      experience: await experienceAnswer(id)
    }
  })

  handle('markets:onboarding-skip', async (id) => {
    await o.store.skipOnboarding(id)
    // Balanced defaults, written down properly, so nothing is left undefined for want of an answer.
    await o.store.setExperience(id, skippedSetup().profile)
    return experienceAnswer(id)
  })

  handle('markets:onboarding-restart', async (id) => {
    await o.store.restartOnboarding(id)
    return experienceAnswer(id)
  })

  // ---------------------------------------------------------------- derivatives

  /**
   * Everything about one contract's derivatives state.
   *
   * Assembled from what the engine already holds, with one refresh for the figures that only arrive on request. Nothing
   * here computes a value from a substitute input: a basis needs both prices, an annualised rate needs the period, and
   * without them the field is null and the panel shows a dash.
   */
  const derivativesAnswer = async (instrumentId: string, windowId: string): Promise<DerivativesAnswer> => {
    const available = o.engine.derivativesAvailable()
    const windowMs = oiWindowMs(windowId)
    const contracts = await o.engine.allContracts()
    const contract = contracts.find((one) => one.instrumentId === instrumentId) ?? null

    // Only what this contract's provider actually serves. Asking for funding from a spot provider is not a failure to
    // report -- it is a question not to ask.
    if (available.funding) await o.engine.refreshFunding([instrumentId])
    if (available.markPrice) await o.engine.refreshMarkIndex([instrumentId])
    if (available.openInterest) await o.engine.refreshOpenInterest([instrumentId])

    const funding = o.engine.fundingFor(instrumentId)
    const marks = o.engine.markIndexFor(instrumentId)
    const openInterest = o.engine.openInterestFor(instrumentId)
    const quote = o.engine.quote(instrumentId)
    const at = Date.now()

    const history = available.openInterest ? await o.engine.openInterestHistoryFor(instrumentId, windowMs, 200) : []
    const bounded = overWindow(history, windowMs, at)
    const change = bounded ? oiChange(bounded.from, bounded.to) : null

    // The future's own last price against the venue's index. Never the spot price from another provider, which would be
    // a basis between two different markets.
    const basis = basisOf(quote?.last ?? null, marks?.indexPrice ?? null)

    const events = o.engine.liquidationsFor(instrumentId)
    const summary = summariseLiquidations(events, windowMs, at)

    const missing: string[] = []
    if (!available.funding) missing.push('funding')
    if (!available.openInterest) missing.push('open interest')
    if (!available.liquidations) missing.push('liquidations')

    return {
      instrumentId,
      contract,
      funding,
      fundingStale: fundingStale(funding, at),
      untilFunding: untilFunding(funding, at),
      fundingDirection: funding ? fundingDirection(funding.rate) : 'flat',
      fundingAnnualised: funding ? fundingAnnualised(funding.rate, funding.intervalMs) : null,
      marks,
      openInterest,
      oiChange: change,
      relationship: describeOi(change, quote?.changePercent === null || quote?.changePercent === undefined ? null : quote.changePercent / 100),
      basis,
      basisAnnualised: annualisedBasis(basis?.fraction ?? null, contract?.expiresAt ?? null, at),
      liquidations: {
        ...summary,
        events: events.filter((one) => one.at >= summary.from),
        // The buffer is a window, not a record. Said, so a partial window is not read as the whole picture.
        partial: events.length >= 500,
        streamOnly: true
      },
      available,
      note: missing.length === 0 ? '' : `No configured provider reports ${missing.join(', ')} for this market.`
    }
  }

  handle('markets:derivatives', (_id, instrumentId, window) =>
    derivativesAnswer(str(instrumentId), str(window, 8))
  )

  /** Funding as it was paid, for a chart. Empty when the venue keeps no history. */
  handle('markets:funding-history', async (_id, instrumentId, limit) => {
    const points: FundingPoint[] = await o.engine.fundingHistoryFor(
      str(instrumentId),
      Math.min(1000, Math.max(1, Number(limit) || 200))
    )
    return { points, available: o.engine.derivativesAvailable().funding }
  })

  handle('markets:oi-history', async (_id, instrumentId, window, limit) => {
    const points: OpenInterestPoint[] = await o.engine.openInterestHistoryFor(
      str(instrumentId),
      oiWindowMs(str(window, 8)),
      Math.min(500, Math.max(1, Number(limit) || 200))
    )
    return { points, available: o.engine.derivativesAvailable().openInterest }
  })

  /**
   * Positioning, with whose it is stated.
   *
   * The basis field matters: accounts net long is not the same measurement as long open interest, and a panel that
   * labelled one as the other would be wrong in a way nobody could see.
   */
  handle('markets:long-short', async (_id, instrumentId, window, limit) => {
    const points: LongShortRatio[] = await o.engine.longShortFor(
      str(instrumentId),
      oiWindowMs(str(window, 8)),
      Math.min(500, Math.max(1, Number(limit) || 200))
    )
    return { points, available: o.engine.derivativesAvailable().longShort }
  })

  /** Every derivative contract a provider serves, for the contract selector. */
  handle('markets:contracts', async (_id, kind) => {
    const wanted = str(kind, 12)
    const contracts = await o.engine.allContracts()
    const tradable = contracts.filter((one) => one.status === 'trading')
    const filtered =
      wanted === 'perpetual' || wanted === 'dated' ? tradable.filter((one) => one.contractType === wanted) : tradable
    return { contracts: filtered }
  })

  // ---------------------------------------------------------------- the trade tape, analysed

  /**
   * The tape and what it adds up to.
   *
   * Its own channel beside `markets:tape`, which answers with the prints alone. Two channels rather than one with a flag,
   * because a tape panel refreshing twice a second should not pay for a pressure calculation it is not showing.
   *
   * The prints are the engine's own buffer, so this costs no request. Everything else is measured from them: the filter,
   * the pressure over a stated window, the aggregation when asked for. A venue that does not publish aggressor side
   * produces an answer that says so rather than a fifty-fifty split.
   */
  handle('markets:tape-analysis', async (_id, instrumentId, options) => {
    const wanted = str(instrumentId)
    const raw = (options && typeof options === 'object' ? options : {}) as {
      filter?: string
      threshold?: number
      window?: string
      priceBucket?: number
      timeBucket?: number
    }
    const all = o.engine.trades(wanted)
    const filter: TapeFilter =
      raw.filter === 'buys' || raw.filter === 'sells' || raw.filter === 'large' ? raw.filter : 'all'
    const threshold = typeof raw.threshold === 'number' && raw.threshold > 0 ? raw.threshold : 0
    const shown = filterTape(all, filter, threshold)
    const windowId = str(raw.window ?? '', 8) || '1m'
    // Pressure is measured over the whole tape, not the filtered view: a buy-side filter would otherwise make every
    // reading 100% buying, which is a fact about the filter rather than the market.
    const reading = pressure(all, windowMsFor(windowId), Date.now())
    const answer: TapeAnswer = {
      instrumentId: wanted,
      trades: shown,
      stats: tapeStats(shown),
      pressure: reading,
      reading: describePressure(reading),
      window: windowId,
      suggestedThreshold: suggestedThreshold(all),
      byPrice:
        typeof raw.priceBucket === 'number' && raw.priceBucket > 0 ? aggregateByPrice(all, raw.priceBucket) : [],
      byTime: typeof raw.timeBucket === 'number' && raw.timeBucket > 0 ? aggregateByTime(all, raw.timeBucket) : [],
      unclassified: reading.buyShare === null
    }
    return answer
  })

  // ---------------------------------------------------------------- favourites and what was just open

  handle('markets:favourites', async (id) => {
    const workspace = await o.store.read(id)
    const known = new Map(workspace.known.map((one) => [one.instrumentId, one]))
    return {
      favourites: workspace.favourites.map((one) => ({ instrumentId: one, instrument: known.get(one) ?? null })),
      recent: workspace.recent.map((one) => ({ instrumentId: one, instrument: known.get(one) ?? null })),
      quotes: [...new Set([...workspace.favourites, ...workspace.recent])].map((one) => ({
        instrumentId: one,
        quote: o.engine.quote(one)
      }))
    }
  })

  handle('markets:favourite', async (id, instrumentId) => ({
    favourite: await o.store.toggleFavourite(id, str(instrumentId))
  }))

  handle('markets:clear-recent', async (id) => {
    await o.store.clearRecent(id)
    return { cleared: true }
  })

  // ---------------------------------------------------------------- chart annotations

  handle('markets:drawings', async (id, instrumentId) => ({
    drawings: drawingsFor(await o.store.drawings(id), str(instrumentId))
  }))

  handle('markets:drawing-save', async (id, raw) => {
    const drawing: Drawing | null = await o.store.saveDrawing(id, raw)
    // Null when it is not a drawing: refused rather than repaired, because a repaired drawing appears somewhere its
    // author did not put it.
    if (!drawing) return { error: 'invalid-params', message: 'That is not a drawing this chart can place.' }
    return { drawing, drawings: drawingsFor(await o.store.drawings(id), drawing.instrumentId) }
  })

  handle('markets:drawing-remove', async (id, drawingId, instrumentId) => {
    await o.store.removeDrawing(id, str(drawingId, 80))
    return { drawings: drawingsFor(await o.store.drawings(id), str(instrumentId)) }
  })

  handle('markets:drawings-clear', async (id, instrumentId) => {
    const wanted = str(instrumentId)
    await o.store.clearDrawings(id, wanted || undefined)
    return { drawings: [] as Drawing[] }
  })

  // ---------------------------------------------------------------- panels

  handle('markets:panels', async (id) => ({
    layout: await o.store.panels(id),
    presets: LAYOUT_PRESETS.map((one) => ({ id: one.id, name: one.name, describe: one.describe }))
  }))

  handle('markets:set-panels', async (id, layout) => ({ layout: await o.store.setPanels(id, layout) }))

  handle('markets:panels-preset', async (id, presetId) => {
    const preset = LAYOUT_PRESETS.find((one) => one.id === str(presetId, 40))
    if (!preset) return { error: 'invalid-params', message: 'There is no layout by that name.' }
    const current = await o.store.panels(id)
    const layout: PanelLayout = preset.build(current.instrumentId)
    return { layout: await o.store.setPanels(id, layout) }
  })

  handle('markets:panels-reset', async (id) => ({ layout: await o.store.resetPanels(id) }))

  // ---------------------------------------------------------------- what starts a workflow

  handle('markets:triggers', async (id) => {
    const triggers = await o.store.triggers(id)
    const known = new Map((await o.store.known(id)).map((one) => [one.instrumentId, one]))
    return {
      triggers: triggers.map((one) => ({
        trigger: one,
        describe: describeTrigger(one, known.get(one.instrumentId)?.symbol ?? '')
      }))
    }
  })

  handle('markets:trigger-save', async (id, raw) => {
    const trigger: MarketTrigger | null = await o.store.saveTrigger(id, raw)
    if (!trigger) {
      return { error: 'invalid-params', message: 'That trigger is missing something it needs in order to ever fire.' }
    }
    return { trigger, triggers: await o.store.triggers(id) }
  })

  handle('markets:trigger-remove', async (id, triggerId) => {
    await o.store.removeTrigger(id, str(triggerId, 80))
    return { triggers: await o.store.triggers(id) }
  })

  // ---------------------------------------------------------------- leverage

  /**
   * The simulated margin picture.
   *
   * Every figure carries the assumptions, because a liquidation price is the single most dangerous number here: it comes
   * from Orbis's own model and is not the price at which a real venue would close a real position.
   */
  handle('markets:margin', async (id) => {
    const workspace = await o.store.read(id)
    const settings: MarginSettings = workspace.margin
    const positions = workspace.paper?.account.positions ?? []
    const prices = new Map(positions.map((one) => [one.instrumentId, o.engine.quote(one.instrumentId)?.last ?? null]))
    return {
      settings,
      account: accountMargin(positions, workspace.paper?.account.cash ?? 0, prices, settings),
      positions: positions.map((one) => ({
        instrumentId: one.instrumentId,
        margin: marginOf(one, prices.get(one.instrumentId) ?? null, settings)
      })),
      assumptions: MARGIN_ASSUMPTIONS
    }
  })

  handle('markets:set-margin', async (id, patch) => ({ settings: await o.store.setMargin(id, patch) }))

  // ---------------------------------------------------------------- comparing markets

  /**
   * Several markets, indexed to a common start.
   *
   * Indexed because absolute prices are not comparable: bitcoin at 84,000 beside solana at 190 on one axis says only
   * which number is bigger. Every series is rebased to 100 over the moments they all have, and the assumptions travel
   * with the answer.
   */
  handle('markets:compare', async (id, instrumentIds, wantedInterval, limit) => {
    void id
    const ids = (Array.isArray(instrumentIds) ? instrumentIds : [])
      .filter((one): one is string => typeof one === 'string')
      .slice(0, MAX_COMPARED)
    if (ids.length < 2) return { error: 'invalid-params', message: 'Two or more markets are needed to compare.' }

    const interval = INTERVALS.includes(str(wantedInterval, 8) as Interval) ? (str(wantedInterval, 8) as Interval) : '1d'
    const bars = count(limit, 30, 1000, 200)
    const series: CompareSeries[] = []
    for (const one of ids) {
      const instrument = await o.engine.instrument(one)
      if (!instrument) continue
      const candles = await o.engine.candlesFor(one, interval, bars)
      // A market with no history is left out and named, rather than compared against nothing.
      if (candles.length === 0) continue
      series.push({ instrumentId: one, symbol: instrument.symbol, candles })
    }

    const missing = ids.filter((one) => !series.some((each) => each.instrumentId === one))
    return {
      interval,
      indexed: indexSeries(series),
      stats: compareStats(series, interval === '1d' ? 'daily' : 'hourly'),
      correlations: correlationMatrix(series),
      missing,
      assumptions: COMPARE_ASSUMPTIONS
    }
  })

  // ---------------------------------------------------------------- did it work, or was it fitted

  /**
   * Walk-forward: parameters chosen on one stretch, judged on the next.
   *
   * The headline is the out-of-sample average and the warnings are part of the answer. A run whose test results are far
   * worse than its training results has found a fit rather than an edge, and the summary says so rather than leaving it
   * for somebody to notice.
   */
  handle('markets:walk-forward', async (id, strategyId, options) => {
    const strategy = (await o.store.strategies(id)).find((one) => one.id === str(strategyId, 80))
    if (!strategy) return { error: 'not-found', message: 'There is no strategy by that id.' }
    const raw = (options && typeof options === 'object' ? options : {}) as {
      windows?: number
      trainRatio?: number
      anchored?: boolean
      limit?: number
    }

    const interval = strategy.interval as Interval
    const candles = await o.engine.candlesFor(strategy.instrumentId, interval, count(raw.limit, 200, 3000, 1000))
    if (candles.length < 120) {
      return { error: 'unavailable', message: 'There is not enough history to split into windows.' }
    }
    const from = candles[0].time
    const to = candles[candles.length - 1].time
    const windows = walkWindows(from, to, {
      windows: raw.windows ?? 4,
      trainRatio: raw.trainRatio ?? 0.7,
      anchored: raw.anchored === true,
      // A window shorter than thirty bars is noise with a number on it.
      minimumMs: (to - from) / Math.max(1, candles.length) * 30
    })

    const results: WalkResult[] = []
    for (const window of windows) {
      const train = candles.filter((one) => one.time >= window.trainFrom && one.time < window.trainTo)
      const test = candles.filter((one) => one.time >= window.testFrom && one.time <= window.testTo)
      results.push({
        window,
        // The strategy as saved. Parameter search across windows is a separate, heavier thing; this reports how the
        // rules held up on data they had not been looked at against.
        chosen: {},
        train: train.length > 30 ? backtest(strategy, train).stats : null,
        test: test.length > 30 ? backtest(strategy, test).stats : null
      })
    }

    return { summary: summariseWalk(results), assumptions: VALIDATION_ASSUMPTIONS }
  })

  /**
   * The same trades in different orders.
   *
   * It answers how much of the equity curve's shape came from the order the trades arrived in. It generates nothing and
   * forecasts nothing, and the note saying so travels with the result.
   */
  handle('markets:monte-carlo', async (id, strategyId, options) => {
    const strategy = (await o.store.strategies(id)).find((one) => one.id === str(strategyId, 80))
    if (!strategy) return { error: 'not-found', message: 'There is no strategy by that id.' }
    const raw = (options && typeof options === 'object' ? options : {}) as { runs?: number; seed?: number; limit?: number }
    const candles = await o.engine.candlesFor(strategy.instrumentId, strategy.interval as Interval, count(raw.limit, 200, 3000, 1000))
    if (candles.length === 0) return { error: 'unavailable', message: 'There is no history for that market.' }

    const result = backtest(strategy, candles)
    const returns = result.trades.map((one) => one.returnPercent)
    return {
      trades: returns.length,
      result: monteCarlo(returns, { runs: count(raw.runs, 50, 5000, 500), seed: count(raw.seed, 1, 1_000_000, 1) }),
      assumptions: VALIDATION_ASSUMPTIONS
    }
  })

  // ---------------------------------------------------------------- candlestick patterns

  /**
   * The pattern detector's one engine instance, per this window.
   *
   * One rather than one per market, because the cursors that stop it re-examining a candle it has already looked at are
   * the whole reason it is cheap, and a fresh engine per request would throw them away on every call.
   */
  const patternEngines = new Map<string, PatternEngine>()
  const patternEngineFor = async (profileId: string): Promise<PatternEngine> => {
    const settings = (await o.store.patterns(profileId)).settings
    const held = patternEngines.get(profileId)
    if (held === undefined) {
      const made = new PatternEngine(settings)
      patternEngines.set(profileId, made)
      return made
    }
    // Reconfigured every time, so a setting changed in another window takes effect here rather than on the next restart.
    held.configure(settings)
    return held
  }

  const patternMode = (value: unknown): DetectionMode | undefined =>
    value === 'standard' || value === 'strict' || value === 'research' ? value : undefined

  /** The library itself. Static, so this is the one pattern channel that needs no market. */
  handle('markets:patterns', async (id, query, filter) => {
    void id
    const text = str(query, 200)
    const f = (filter && typeof filter === 'object' ? filter : {}) as { category?: string; direction?: string; formationLength?: number }
    let list = text === '' ? [...PATTERNS] : searchPatterns(text)
    if (f.category !== undefined || f.direction !== undefined || f.formationLength !== undefined) {
      const narrowed = new Set(
        filterPatterns({
          category: f.category as PatternCategory | undefined,
          direction: f.direction as PatternDirection | undefined,
          formationLength: typeof f.formationLength === 'number' ? f.formationLength : undefined
        }).map((one) => one.id)
      )
      list = list.filter((one) => narrowed.has(one.id))
    }
    return {
      libraryVersion: PATTERN_LIBRARY_VERSION,
      patterns: list.map((one) => ({
        id: one.id,
        name: one.name,
        aliases: one.aliases,
        category: one.category,
        direction: one.direction,
        formationLength: one.formationLength,
        describe: one.describe,
        version: one.version,
        specialises: one.specialises,
        related: one.related,
        confirmation: one.confirmation,
        invalidation: one.invalidation,
        // The rules as sentences. The functions behind them stay in the main process.
        rules: one.rules.map((r) => ({ id: r.id, describe: r.describe, required: r.required })),
        contextRules: one.contextRules.map((r) => ({ id: r.id, describe: r.describe, required: r.required }))
      })),
      assumptions: PATTERN_ASSUMPTIONS
    }
  })

  /** One pattern in full, with its family. */
  handle('markets:pattern', async (id, patternId) => {
    void id
    const one = patternById(str(patternId, 100))
    if (!one) return { error: 'not-found', message: 'Orbis has no pattern by that id.' }
    return {
      pattern: {
        id: one.id,
        name: one.name,
        aliases: one.aliases,
        category: one.category,
        direction: one.direction,
        formationLength: one.formationLength,
        describe: one.describe,
        version: one.version,
        confirmation: one.confirmation,
        invalidation: one.invalidation,
        emphasis: one.emphasis,
        rules: one.rules.map((r) => ({ id: r.id, describe: r.describe, required: r.required })),
        contextRules: one.contextRules.map((r) => ({ id: r.id, describe: r.describe, required: r.required }))
      },
      broaderThan: descendantsOf(one.id).map((x) => ({ id: x, name: patternById(x)?.name ?? x })),
      moreSpecificThan: ancestorsOf(one.id).map((x) => ({ id: x, name: patternById(x)?.name ?? x })),
      related: one.related.map((x) => ({ id: x, name: patternById(x)?.name ?? x })),
      tolerances: TOLERANCES,
      assumptions: PATTERN_ASSUMPTIONS
    }
  })

  /**
   * Examine one market now.
   *
   * The candles come from the same engine the chart draws from, so a marker cannot end up on a candle the chart does
   * not have. Nothing is fetched twice: `candlesFor` is the cache the chart already filled.
   */
  handle('markets:pattern-detect', async (id, instrumentId, wantedInterval, options) => {
    const state = await o.store.patterns(id)
    if (!state.settings.enabled) {
      return { error: 'disabled', message: 'Candlestick pattern detection is switched off.', assumptions: SETTINGS_ASSUMPTIONS }
    }

    const wanted = str(instrumentId)
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const chosen = interval(wantedInterval)
    if (chosen === null) return { error: 'unsupported', message: 'Orbis does not have candles at that interval.' }

    const raw = (options && typeof options === 'object' ? options : {}) as { limit?: number; developing?: boolean }
    const candles = await o.engine.candlesFor(wanted, chosen, count(raw.limit, 60, 1000, 300))
    if (candles.length === 0) return { error: 'unavailable', message: 'There is no history for that market.' }

    const others: { interval: string; candles: Candle[] }[] = []
    if (state.settings.multiTimeframe) {
      for (const other of state.settings.timeframes.slice(0, 6)) {
        if (other === chosen) continue
        const otherInterval = interval(other)
        if (otherInterval === null) continue
        const got = await o.engine.candlesFor(wanted, otherInterval, 200)
        if (got.length > 0) others.push({ interval: other, candles: got })
      }
    }

    const engine = await patternEngineFor(id)
    const result = engine.examine({
      instrumentId: wanted,
      exchange: instrument.exchange,
      symbol: instrument.symbol,
      interval: chosen,
      candles,
      // The last candle of a live market is always still forming. Said rather than assumed, because a historical range
      // handed to the same engine must not have its final candle treated as incomplete.
      lastIsDeveloping: raw.developing !== false,
      otherTimeframes: others,
      now: Date.now()
    })

    const shape = (one: (typeof result.found)[number]) => ({
      detection: one.detection,
      context: one.context,
      timeframeAgreement: one.timeframeAgreement,
      match: matchWord(one.detection.structuralMatch),
      explain: explainDetection(one.detection)
    })

    // Recorded here, not only when alerts fire.
    //
    // Keeping history in the alert path meant that with alerts off -- which is the default -- nothing was ever
    // recorded, while the history setting said it was on. Examination is where a detection becomes a fact, so that is
    // where it is written down. Keyed by the formation, so re-examining the same candle replaces its record rather
    // than adding a second one.
    if (state.settings.history) {
      const records = recordsFor({ examined: result, exchange: instrument.exchange, symbol: instrument.symbol, now: Date.now() }, state.settings)
      if (records.length > 0) await o.store.addPatternRecords(id, records)
    }

    return {
      instrumentId: wanted,
      symbol: instrument.symbol,
      exchange: instrument.exchange,
      interval: chosen,
      found: result.found.map(shape),
      developing: result.developing.map(shape),
      nearMisses: result.nearMisses,
      examined: result.examined,
      skipped: result.skipped,
      describe: result.describe,
      candleCheck: checkSequence(candles),
      assumptions: [...DETECT_ASSUMPTIONS, ...(state.settings.context ? CONTEXT_ASSUMPTIONS : [])]
    }
  })

  /**
   * Examine a selection of candles the user made on the chart.
   *
   * Answers with every classification the window satisfies rather than picking one. A window that is genuinely
   * ambiguous -- a doji that is also a high-wave candle -- should say so, because forcing one name onto it would be
   * making a decision the candles do not support.
   */
  handle('markets:pattern-identify', async (id, instrumentId, wantedInterval, fromTime, toTime) => {
    const state = await o.store.patterns(id)
    const wanted = str(instrumentId)
    const chosen = interval(wantedInterval)
    if (chosen === null) return { error: 'unsupported', message: 'Orbis does not have candles at that interval.' }
    const candles = await o.engine.candlesFor(wanted, chosen, 1000)
    if (candles.length === 0) return { error: 'unavailable', message: 'There is no history for that market.' }

    const from = typeof fromTime === 'number' ? fromTime : 0
    const to = typeof toTime === 'number' ? toTime : Number.MAX_SAFE_INTEGER
    const last = candles.reduce((best, one, i) => (one.time >= from && one.time <= to ? i : best), -1)
    if (last === -1) return { error: 'not-found', message: 'None of the candles in the chart fall in that selection.' }

    const result = detectAt(candles, last, {
      mode: state.settings.mode,
      includeNearMisses: true,
      lastIsDeveloping: false
    })

    const one = candles[last] as Candle
    return {
      at: one.time,
      candle: one,
      geometry: geometryOf(one),
      relative: relativeTo(geometryOf(one), rollingStats(candles, last)),
      // Everything it matches, not the most specific alone: ambiguity is the answer where it exists.
      classifications: result.detections.map((d) => ({
        patternId: d.patternId,
        patternName: d.patternName,
        structuralMatch: d.structuralMatch,
        match: matchWord(d.structuralMatch),
        alsoMatches: d.alsoMatches,
        explain: explainDetection(d)
      })),
      preferred: mostSpecific(result.detections).map((d) => d.patternId),
      nearMisses: result.nearMisses,
      describe:
        result.detections.length === 0
          ? 'No named pattern matches this candle. That is an answer, not a failure: most candles are not named formations.'
          : result.detections.length === 1
            ? `This matches one named formation.`
            : `This satisfies ${result.detections.length} named definitions at once. All of them are listed rather than one being chosen.`,
      assumptions: [...GEOMETRY_ASSUMPTIONS, ...DETECT_ASSUMPTIONS]
    }
  })

  /** The settings, and what each switch actually stops. */
  handle('markets:pattern-settings', async (id) => ({
    settings: (await o.store.patterns(id)).settings,
    defaults: o.store.defaultPatternSettings(),
    whatStops: WHAT_STOPS,
    assumptions: SETTINGS_ASSUMPTIONS
  }))

  handle('markets:pattern-settings-save', async (id, raw) => {
    const settings = await o.store.savePatternSettings(id, raw)
    const engine = patternEngines.get(id)
    if (engine) {
      engine.configure(settings)
      // Off means off: the cursors and cached detections go, so nothing keeps running behind a switch that says it is not.
      if (!settings.enabled) engine.release()
    }
    return { settings, whatStops: WHAT_STOPS }
  })

  handle('markets:pattern-rules', async (id) => {
    const state = await o.store.patterns(id)
    return {
      rules: state.rules.map((one) => ({ rule: one, problems: checkRule(one) })),
      mutes: await o.store.patternMutes(id),
      assumptions: ALERT_ASSUMPTIONS
    }
  })

  handle('markets:pattern-rule-save', async (id, raw) => {
    const rule: PatternAlertRule | null = await o.store.savePatternRule(id, raw)
    if (!rule) return { error: 'invalid-params', message: 'That rule is missing something it needs in order to ever fire.' }
    const problems = checkRule(rule)
    return { rule, problems, rules: (await o.store.patterns(id)).rules }
  })

  handle('markets:pattern-rule-remove', async (id, ruleId) => {
    await o.store.removePatternRule(id, str(ruleId, 200))
    return { rules: (await o.store.patterns(id)).rules }
  })

  handle('markets:pattern-mutes-save', async (id, raw) => ({ mutes: await o.store.savePatternMutes(id, raw) }))

  /**
   * Evaluate the alert rules for one market and deliver what should fire.
   *
   * Delivery is recorded as confirmed only when the notification actually went out, so a failed notification is stored
   * as failed rather than as sent.
   */
  handle('markets:pattern-evaluate', async (id, instrumentId, wantedInterval) => {
    const state = await o.store.patterns(id)
    if (!state.settings.enabled) return { error: 'disabled', message: 'Candlestick pattern detection is switched off.' }
    if (!state.settings.alerts) return { fired: [], refused: [], describe: 'Pattern alerts are switched off.' }

    const wanted = str(instrumentId)
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const chosen = interval(wantedInterval)
    if (chosen === null) return { error: 'unsupported', message: 'Orbis does not have candles at that interval.' }

    const candles = await o.engine.candlesFor(wanted, chosen, 300)
    if (candles.length === 0) return { error: 'unavailable', message: 'There is no history for that market.' }

    const engine = await patternEngineFor(id)
    const examined = engine.examine({
      instrumentId: wanted,
      exchange: instrument.exchange,
      symbol: instrument.symbol,
      interval: chosen,
      candles,
      lastIsDeveloping: true,
      now: Date.now()
    })

    const watchlists = await o.store.watchlists(id)
    const favourites = await o.store.favourites(id)
    const decisions = decideAlerts({
      state,
      examined,
      exchange: instrument.exchange,
      symbol: instrument.symbol,
      inWatchlist: watchlists.some((list) => list.items.some((item) => item.instrumentId === wanted)),
      inFavourites: favourites.includes(wanted),
      now: Date.now()
    })

    if (decisions.fire.length > 0) await o.store.addPatternFirings(id, decisions.fire.map((one) => one.firing))
    if (state.settings.history) {
      const records = recordsFor({ examined, exchange: instrument.exchange, symbol: instrument.symbol, now: Date.now() }, state.settings)
      if (records.length > 0) await o.store.addPatternRecords(id, records)
    }

    return {
      fired: decisions.fire.map((one) => ({
        firing: one.firing,
        patternName: one.pattern.detection.patternName,
        symbol: instrument.symbol,
        interval: chosen,
        explain: explainDetection(one.pattern.detection)
      })),
      refused: decisions.refused,
      describe: decisions.describe
    }
  })

  handle('markets:pattern-delivered', async (id, key, delivered, note) => {
    await o.store.markPatternDelivered(id, str(key, 400), delivered === true, str(note, 500))
    return { firings: await o.store.patternFirings(id) }
  })

  /** What has been recorded, searchable. */
  handle('markets:pattern-history', async (id, query) => {
    const records = await o.store.patternRecords(id)
    const q = (query && typeof query === 'object' ? query : {}) as HistoryQuery
    const result = searchPatternHistory(records, q)
    return {
      records: result.records.slice(0, 500),
      total: result.records.length,
      considered: result.considered,
      excludedBy: result.excludedBy,
      describe: result.describe,
      frequency: frequencyOf(result.records),
      assumptions: HISTORY_ASSUMPTIONS
    }
  })

  handle('markets:pattern-history-clear', async (id, keys) => {
    const chosen = Array.isArray(keys) ? keys.filter((one): one is string => typeof one === 'string').slice(0, 5000) : undefined
    const result = await o.store.clearPatternRecords(id, chosen)
    return { ...result, describe: `${result.removed} record${result.removed === 1 ? '' : 's'} removed. Market data is untouched.` }
  })

  /**
   * What happened after past occurrences, measured.
   *
   * Every figure here is a measurement of candles that already traded. The sample size travels with it, the
   * methodology is on the result, and nothing is named as a probability or a rate of success.
   */
  handle('markets:pattern-outcomes', async (id, query, options) => {
    const records = await o.store.patternRecords(id)
    const q = (query && typeof query === 'object' ? query : {}) as HistoryQuery
    const raw = (options && typeof options === 'object' ? options : {}) as { forwardCandles?: number; conditionOn?: string }
    const forward = count(raw.forwardCandles, 1, 200, 12)

    const matched = searchPatternHistory(records, q).records
    if (matched.length === 0) {
      return { error: 'no-records', message: 'No recorded occurrences match that query, so there is nothing to measure.', assumptions: HISTORY_ASSUMPTIONS }
    }

    // Candles are fetched once per market and interval rather than once per occurrence.
    const byMarket = new Map<string, Candle[]>()
    for (const one of matched) {
      const key = `${one.instrumentId}|${one.interval}`
      if (byMarket.has(key)) continue
      const chosen = interval(one.interval)
      if (chosen === null) continue
      byMarket.set(key, await o.engine.candlesFor(one.instrumentId, chosen, 1000))
    }

    const set = measureOutcomes(matched, (record) => byMarket.get(`${record.instrumentId}|${record.interval}`), forward)
    const summary = summarisePatternOutcomes(set)
    const by = raw.conditionOn
    const conditioned =
      by === 'regime' || by === 'volume' || by === 'volatility' || by === 'placement' || by === 'interval' || by === 'dataQuality'
        ? conditionOn(matched, set, by)
        : []

    return {
      occurrences: matched.length,
      summary,
      conditioned,
      unmeasurable: set.unmeasurable,
      describe: set.describe,
      assumptions: HISTORY_ASSUMPTIONS
    }
  })

  /** Two sets of measurements, side by side, with no winner named. */
  handle('markets:pattern-compare', async (id, left, right, options) => {
    const records = await o.store.patternRecords(id)
    const raw = (options && typeof options === 'object' ? options : {}) as { forwardCandles?: number }
    const forward = count(raw.forwardCandles, 1, 200, 12)

    const side = async (query: unknown, label: string) => {
      const matched = searchPatternHistory(records, (query && typeof query === 'object' ? query : {}) as HistoryQuery).records
      const byMarket = new Map<string, Candle[]>()
      for (const one of matched) {
        const key = `${one.instrumentId}|${one.interval}`
        if (byMarket.has(key)) continue
        const chosen = interval(one.interval)
        if (chosen === null) continue
        byMarket.set(key, await o.engine.candlesFor(one.instrumentId, chosen, 1000))
      }
      const set = measureOutcomes(matched, (record) => byMarket.get(`${record.instrumentId}|${record.interval}`), forward)
      return { label, summary: summarisePatternOutcomes(set) }
    }

    const a = await side(left, str((left as { label?: string })?.label, 100) || 'the first set')
    const b = await side(right, str((right as { label?: string })?.label, 100) || 'the second set')
    return { ...comparePatternStats('selection', a, b), assumptions: HISTORY_ASSUMPTIONS }
  })

  /**
   * Scan a stretch of history for a pattern.
   *
   * Reports what it examined and what it found, and a run stopped part-way is described as partial with the share
   * covered. A partial run sitting beside a complete one looking equivalent is the way a scan lies about coverage.
   */
  handle('markets:pattern-scan', async (id, instrumentId, wantedInterval, options) => {
    const state = await o.store.patterns(id)
    const wanted = str(instrumentId)
    const instrument = await o.engine.instrument(wanted)
    if (!instrument) return { error: 'not-found', message: 'No provider can describe that instrument.' }
    const chosen = interval(wantedInterval)
    if (chosen === null) return { error: 'unsupported', message: 'Orbis does not have candles at that interval.' }

    const raw = (options && typeof options === 'object' ? options : {}) as { limit?: number; patternIds?: unknown; mode?: unknown }
    const limit = count(raw.limit, 60, 1000, 1000)
    const candles = await o.engine.candlesFor(wanted, chosen, limit)
    if (candles.length === 0) return { error: 'unavailable', message: 'There is no history for that market.' }

    const only = Array.isArray(raw.patternIds) ? raw.patternIds.filter((one): one is string => typeof one === 'string').slice(0, 200) : []
    const mode = patternMode(raw.mode) ?? state.settings.mode
    const result = detect(candles, { mode, only, except: state.settings.exceptPatterns, from: 0, to: candles.length - 1 })
    const kept = mostSpecific(result.detections.filter((one) => one.structuralMatch >= state.settings.minimumMatch))

    const run: AnalysisRun = {
      runId: randomUUID(),
      instrumentId: wanted,
      interval: chosen,
      from: (candles[0] as Candle).time,
      to: (candles[candles.length - 1] as Candle).time,
      patternIds: only,
      patternVersions: Object.fromEntries(PATTERNS.filter((one) => only.length === 0 || only.includes(one.id)).map((one) => [one.id, one.version])),
      libraryVersion: PATTERN_LIBRARY_VERSION,
      mode,
      forwardCandles: 0,
      createdAt: Date.now(),
      status: 'complete',
      examined: result.examined.candles,
      total: candles.length,
      found: kept.length,
      describe: ''
    }

    return {
      run: { ...run, ...describeRun(run) },
      occurrences: kept.map((one) => ({
        detection: one,
        match: matchWord(one.structuralMatch),
        context: state.settings.context ? contextFor(candles, one) : null
      })),
      notes: result.notes,
      assumptions: [...DETECT_ASSUMPTIONS, ...HISTORY_ASSUMPTIONS]
    }
  })

  /** A summary of what fired over a period. Only real firings go in it. */
  handle('markets:pattern-digest', async (id, period, fromTime, toTime) => {
    const firings = await o.store.patternFirings(id)
    const chosen = period === 'quarter-hour' || period === 'hour' || period === 'day' ? period : 'day'
    const to = typeof toTime === 'number' ? toTime : Date.now()
    const spans: Record<typeof chosen, number> = { 'quarter-hour': 900_000, hour: 3_600_000, day: 86_400_000 }
    const from = typeof fromTime === 'number' ? fromTime : to - spans[chosen]
    return {
      digest: digestOf(firings, chosen, from, to, new Map(PATTERNS.map((one) => [one.id, { name: one.name, direction: one.direction }]))),
      assumptions: ALERT_ASSUMPTIONS
    }
  })

  /** What the detector is holding, for diagnostics. */
  handle('markets:pattern-health', async (id) => {
    const state = await o.store.patterns(id)
    const engine = patternEngines.get(id)
    return {
      enabled: state.settings.enabled,
      held: engine?.held() ?? { markets: 0, detections: 0 },
      rules: state.rules.length,
      records: state.records.length,
      firings: state.firings.length,
      mutes: (await o.store.patternMutes(id)).length,
      libraryVersion: PATTERN_LIBRARY_VERSION,
      patterns: PATTERNS.length,
      assumptions: [...ENGINE_ASSUMPTIONS, ...SETTINGS_ASSUMPTIONS]
    }
  })

  /**
   * The other timeframes for one market, each keeping its own reading.
   *
   * Separate from `pattern-detect` so a screen can show the relationship without re-running detection, and so the
   * intervals stay visibly separate rather than collapsing into a single verdict.
   */
  handle('markets:pattern-timeframes', async (id, instrumentId, direction) => {
    const state = await o.store.patterns(id)
    const wanted = str(instrumentId)
    const want: PatternDirection = direction === 'bullish' || direction === 'bearish' ? direction : 'neutral'
    const readings: { interval: string; candles: Candle[] }[] = []
    for (const other of state.settings.timeframes.slice(0, 6)) {
      const chosen = interval(other)
      if (chosen === null) continue
      const got = await o.engine.candlesFor(wanted, chosen, 200)
      if (got.length > 0) readings.push({ interval: other, candles: got })
    }
    if (readings.length === 0) {
      return { error: 'unavailable', message: 'None of the chosen timeframes has any history for that market.' }
    }
    return { ...timeframeContext(readings, want), assumptions: CONTEXT_ASSUMPTIONS }
  })
}
