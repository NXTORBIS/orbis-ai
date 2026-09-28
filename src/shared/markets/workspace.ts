import type { Instrument } from './instrument.ts'
import { ALL_COLUMNS, DEFAULT_COLUMNS, TICKER_FIELDS, type TickerField } from './surfaces.ts'
import { cleanAlerts, type Alert, type AlertFiring } from './alerts.ts'
import { cleanQuery, type SavedScreen } from './screener.ts'
import {
  DEFAULT_SETTINGS,
  type OrderState,
  type OrderType,
  type PaperAccount,
  type PaperFill,
  type PaperOrder,
  type PaperPosition,
  type PaperSettings,
  type Side
} from './paper.ts'
import type { EquityPoint } from './portfolio.ts'
import { cleanStrategy, type Strategy } from './strategy.ts'
import {
  cleanCurrencyPreference,
  DEFAULT_CURRENCY_PREFERENCE,
  type CurrencyPreference
} from './currency.ts'
import type { BacktestCosts } from './backtest.ts'
import {
  cleanExperience,
  DEFAULT_EXPERIENCE,
  inferExperience,
  type MarketsExperienceProfile
} from './experience.ts'
import { cleanOnboarding, EMPTY_ONBOARDING, type OnboardingRecord } from './onboarding.ts'
import { cleanDrawings, type Drawing } from './drawings.ts'
import { cleanLayout as cleanPanelLayout, defaultLayout, type Layout as PanelLayout } from './panels.ts'
import { cleanTrigger, type MarketTrigger } from './triggers.ts'
import { cleanMargin, DEFAULT_MARGIN, type MarginSettings } from './margin.ts'

/**
 * What somebody has set up: their lists, their ticker, their alerts.
 *
 * All of it local and all of it per profile. None of this is market data -- it is choices, and choices survive a provider
 * going away, a licence lapsing and the network being off. That separation is why a watchlist keeps working offline and
 * simply shows no prices.
 *
 * Everything here has a `clean` that reads a value from a file or an import and returns something safe. A configuration
 * file is the easiest way into an application, so nothing is trusted: an unknown field is dropped, a nonsense number is
 * clamped, and anything that cannot be made into the shape is refused rather than half-accepted.
 */

export interface WatchlistItem {
  instrumentId: string
  /** Enough to draw the row before any price arrives, and to restore the list with the provider unreachable. */
  instrument: Instrument
  addedAt: number
}

export interface Watchlist {
  id: string
  name: string
  items: WatchlistItem[]
  /** Which column it is sorted by, and which way. */
  sortBy: string
  sortDescending: boolean
  /** Which columns are shown, in order. */
  columns: string[]
}

// The surface vocabulary lives on its own, so the experience layer can read it without importing this file back.
export { ALL_COLUMNS, DEFAULT_COLUMNS, TICKER_FIELDS, type TickerField } from './surfaces.ts'

export interface TickerGroup {
  id: string
  name: string
  instrumentIds: string[]
}

export interface TickerConfig {
  enabled: boolean
  /** Which group is showing. Empty means the first one. */
  activeGroupId: string
  groups: TickerGroup[]
  /** Pixels a second. */
  speed: number
  direction: 'left' | 'right'
  pauseOnHover: boolean
  fields: TickerField[]
  /** How tall the strip is: a named size the page turns into pixels. */
  size: 'compact' | 'normal' | 'expanded'
  /** Rotating through the groups, and how long each gets. 0 is off. */
  rotateEveryMs: number
}

export const DEFAULT_TICKER: TickerConfig = {
  // Off until somebody asks. A market strip nobody wanted is a permanent band across the bottom of their browser.
  enabled: false,
  activeGroupId: '',
  groups: [],
  speed: 40,
  direction: 'left',
  pauseOnHover: true,
  fields: ['price', 'changePercent'],
  size: 'compact',
  rotateEveryMs: 0
}

export const TICKER_HEIGHTS: Record<TickerConfig['size'], number> = {
  compact: 26,
  normal: 34,
  expanded: 46
}

export interface MarketsWorkspace {
  version: 1
  /**
   * Whether Markets is on at all.
   *
   * Separate from `ticker.enabled`, because they answer different questions: this one is whether Orbis does market data,
   * and that one is whether a strip appears at the bottom of the browser. Switching this off releases every market
   * subscription and leaves every choice -- watchlists, alerts, groups -- exactly where it was, so it is a switch and not
   * a reset.
   */
  enabled: boolean
  watchlists: Watchlist[]
  ticker: TickerConfig
  alerts: Alert[]
  /**
   * What has fired, newest last, bounded.
   *
   * Bounded because an alert on a busy market can fire every cooldown for a week. The oldest are what a history can afford
   * to forget; keeping all of them would grow this file without limit.
   */
  alertHistory: AlertFiring[]
  /** Saved screens: the query only, never the rows it returned, which were true for one moment. */
  screens: SavedScreen[]
  /**
   * What money is shown in.
   *
   * Per profile, because two people sharing a machine do not share a currency. The market feed is unaffected: this
   * decides what a price is converted into for display, not what is traded.
   */
  currency: CurrencyPreference
  /**
   * Where Markets was left.
   *
   * Which section was open, which market, and how its chart was set up. Restored on opening so Markets comes back where
   * it was rather than at the top — the Orbis workspace equivalent for one screen, kept in this profile's own file
   * rather than in a second workspace system.
   */
  layout: MarketsLayout
  /** Saved strategies. The rules only — a result is reproducible from them and the candles. */
  strategies: Strategy[]
  /**
   * What has been run, newest last, bounded.
   *
   * Headline figures and the recipe, not the equity curve: a run over three thousand bars is three thousand numbers, and
   * the whole point of a deterministic backtester is that the detail can be produced again from what is kept here.
   */
  backtestRuns: BacktestRun[]
  /**
   * The paper-trading account, or null when there is none.
   *
   * Null rather than an empty account with a default balance, because "you have not started one" and "you have one with
   * nothing in it" are different states and only one of them should show a portfolio.
   */
  paper: PaperState | null
  /** Which instruments have been looked at, so a search need not be repeated. */
  known: Instrument[]
  /**
   * How this person wants Markets to behave.
   *
   * Preferences, in the same file as every other preference, belonging to the same profile. Not an account and not a
   * second identity: it decides how much is on screen and how much is explained, and nothing about what the data is.
   */
  experience: MarketsExperienceProfile
  /** Whether the first-launch questions have been answered, and where somebody was if they stopped partway. */
  onboarding: OnboardingRecord
  /**
   * Markets marked as favourites.
   *
   * Ids only. The instrument itself is in `known`, so a favourite survives a provider being unreachable and there is one
   * copy of what a market is rather than two that can disagree.
   */
  favourites: string[]
  /** Markets opened recently, newest first, bounded. A convenience, not a history anybody is keeping. */
  recent: string[]
  /** Chart annotations, in market coordinates, across every market. */
  drawings: Drawing[]
  /** How the panels are arranged. */
  panels: PanelLayout
  /** What can start a market workflow. */
  triggers: MarketTrigger[]
  /** Leverage and liquidation, off unless somebody turns it on. */
  margin: MarginSettings
  updatedAt: number
}

/**
 * Everything about the simulated account.
 *
 * The equity curve is here rather than derived, because it cannot be derived: what the account was worth at four o'clock
 * on Tuesday is only knowable if somebody wrote it down at four o'clock on Tuesday. Reconstructing it from fills would
 * mean pricing every holding at a price nobody recorded.
 */
export interface PaperState {
  account: PaperAccount
  settings: PaperSettings
  equity: EquityPoint[]
  createdAt: number
}

export interface MarketsLayout {
  /** markets, screener, alerts, portfolio, backtest or replay. */
  section: string
  /** The market that was open, or empty. */
  instrumentId: string
  /** Which of the detail tabs: chart, book or trades. */
  tab: string
  interval: string
  chartType: string
  /** Indicators on the chart, as kind and options. */
  indicators: { kind: string; options: Record<string, number> }[]
}

export const DEFAULT_LAYOUT: MarketsLayout = {
  section: 'markets',
  instrumentId: '',
  tab: 'chart',
  interval: '1h',
  chartType: 'candles',
  indicators: []
}

/** One backtest that was run, kept so two can be compared without running both again. */
export interface BacktestRun {
  id: string
  strategyId: string
  strategyName: string
  strategyVersion: number
  instrumentId: string
  interval: string
  at: number
  from: number
  to: number
  bars: number
  trades: number
  totalReturnPercent: number
  benchmarkReturnPercent: number | null
  maxDrawdownPercent: number
  sharpe: number | null
  winRate: number | null
  ambiguousExits: number
  startingCash: number
  costs: BacktestCosts
}

export const EMPTY_WORKSPACE: MarketsWorkspace = {
  version: 1,
  // On, because nothing is subscribed until a surface asks for something: an enabled Markets with an empty ticker and no
  // watchlist costs one object in memory. The switch exists so it can be turned off, not because it needs to be turned on.
  enabled: true,
  watchlists: [],
  ticker: DEFAULT_TICKER,
  alerts: [],
  alertHistory: [],
  screens: [],
  currency: DEFAULT_CURRENCY_PREFERENCE,
  layout: DEFAULT_LAYOUT,
  strategies: [],
  backtestRuns: [],
  paper: null,
  known: [],
  experience: DEFAULT_EXPERIENCE,
  onboarding: EMPTY_ONBOARDING,
  favourites: [],
  recent: [],
  drawings: [],
  panels: defaultLayout(),
  triggers: [],
  margin: DEFAULT_MARGIN,
  updatedAt: 0
}

const MAX_HISTORY = 200
/** How many equity readings a profile keeps. About a month at one an hour, and it is one small number per point. */
const MAX_EQUITY = 2000
const MAX_ORDERS = 500
const MAX_FILLS = 2000
const MAX_SCREENS = 50
const MAX_STRATEGIES = 100
const MAX_RUNS = 50
const MAX_WATCHLISTS = 50
const MAX_ITEMS = 500
const MAX_GROUPS = 20
const MAX_GROUP_ITEMS = 200
const MAX_FAVOURITES = 200
/** Enough to get back to what was just open, few enough that this is a convenience and not a browsing history. */
const MAX_RECENT = 20
const MAX_DRAWINGS = 500
const MAX_TRIGGERS = 50

/** A list of instrument ids from a file: deduplicated, bounded, and nothing that is not an id. */
const ids = (raw: unknown, max: number): string[] => {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const one of raw) {
    if (typeof one !== 'string' || !one) continue
    const id = one.slice(0, 200)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= max) break
  }
  return out
}

const text = (value: unknown, max: number, fallback = ''): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : fallback

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)

const clamp = (value: unknown, low: number, high: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, Math.round(value))) : fallback

/** An instrument read from a file. Null when it lacks what makes it one. */
export function cleanInstrument(raw: unknown): Instrument | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const instrumentId = text(o.instrumentId, 200)
  const symbol = text(o.symbol, 40)
  const provider = text(o.provider, 40)
  if (!instrumentId || !symbol || !provider) return null
  return {
    instrumentId,
    symbol,
    name: text(o.name, 120),
    // The asset type decides staleness thresholds, so an unrecognised one falls back to the most patient sensible
    // choice rather than to crypto's one minute, which would mark a stock stale at lunchtime.
    assetType: (['stock', 'etf', 'index', 'crypto', 'option', 'future', 'forex', 'commodity', 'economic'] as const).includes(
      o.assetType as never
    )
      ? (o.assetType as Instrument['assetType'])
      : 'stock',
    exchange: text(o.exchange, 40),
    currency: text(o.currency, 10),
    provider,
    metadata: o.metadata && typeof o.metadata === 'object' ? (o.metadata as Record<string, unknown>) : undefined
  }
}

export function cleanWatchlist(raw: unknown, at = Date.now()): Watchlist | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  if (!id) return null
  const seen = new Set<string>()
  const items: WatchlistItem[] = []
  for (const one of Array.isArray(o.items) ? o.items : []) {
    if (!one || typeof one !== 'object') continue
    const row = one as Record<string, unknown>
    const instrument = cleanInstrument(row.instrument)
    if (!instrument || seen.has(instrument.instrumentId)) continue
    seen.add(instrument.instrumentId)
    items.push({
      instrumentId: instrument.instrumentId,
      instrument,
      addedAt: typeof row.addedAt === 'number' && row.addedAt > 0 ? row.addedAt : at
    })
    if (items.length >= MAX_ITEMS) break
  }
  const columns = Array.isArray(o.columns)
    ? o.columns.filter((c): c is string => typeof c === 'string' && ALL_COLUMNS.includes(c))
    : []
  return {
    id,
    name: text(o.name, 60) || 'Watchlist',
    items,
    sortBy: ALL_COLUMNS.includes(text(o.sortBy, 40)) ? text(o.sortBy, 40) : 'symbol',
    sortDescending: bool(o.sortDescending, false),
    columns: columns.length ? [...new Set(columns)] : [...DEFAULT_COLUMNS]
  }
}

export function cleanTickerGroup(raw: unknown): TickerGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  if (!id) return null
  const ids = Array.isArray(o.instrumentIds)
    ? [...new Set(o.instrumentIds.filter((v): v is string => typeof v === 'string' && v.length > 0))].slice(0, MAX_GROUP_ITEMS)
    : []
  return { id, name: text(o.name, 60) || 'Group', instrumentIds: ids }
}

export function cleanTicker(raw: unknown, fallback: TickerConfig = DEFAULT_TICKER): TickerConfig {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const o = raw as Record<string, unknown>
  const groups: TickerGroup[] = []
  const seen = new Set<string>()
  for (const one of Array.isArray(o.groups) ? o.groups : []) {
    const group = cleanTickerGroup(one)
    if (!group || seen.has(group.id)) continue
    seen.add(group.id)
    groups.push(group)
    if (groups.length >= MAX_GROUPS) break
  }
  const fields = Array.isArray(o.fields)
    ? [...new Set(o.fields.filter((f): f is TickerField => TICKER_FIELDS.includes(f as TickerField)))]
    : []
  const activeGroupId = text(o.activeGroupId, 80)
  return {
    enabled: bool(o.enabled, fallback.enabled),
    // A group that is no longer there is not the active group, however the file remembers it.
    activeGroupId: groups.some((g) => g.id === activeGroupId) ? activeGroupId : (groups[0]?.id ?? ''),
    groups,
    // Slow enough to read, fast enough to be a ticker. Outside this it is either unreadable or not moving.
    speed: clamp(o.speed, 5, 400, fallback.speed),
    direction: o.direction === 'right' ? 'right' : 'left',
    pauseOnHover: bool(o.pauseOnHover, fallback.pauseOnHover),
    fields: fields.length ? fields : [...fallback.fields],
    size: o.size === 'normal' || o.size === 'expanded' ? o.size : 'compact',
    rotateEveryMs: clamp(o.rotateEveryMs, 0, 60 * 60_000, fallback.rotateEveryMs)
  }
}

/** A whole workspace read from disk or an import. Never throws; anything unrecognised is simply not there afterwards. */
/** One firing read back from a file. Null when it lacks what makes it one. */
export function cleanFiring(raw: unknown): AlertFiring | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  const alertId = text(o.alertId, 80)
  const instrumentId = text(o.instrumentId, 200)
  // A firing with no value is not a record of anything: the value is the whole point of keeping it.
  if (!id || !alertId || !instrumentId) return null
  if (typeof o.value !== 'number' || !Number.isFinite(o.value)) return null
  if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at <= 0) return null
  return {
    id,
    alertId,
    instrumentId,
    symbol: text(o.symbol, 40),
    label: text(o.label, 120),
    value: o.value,
    at: Math.round(o.at)
  }
}

/** A saved screen read back from a file. The query is re-validated, so an edited file cannot smuggle in a condition. */
export function cleanScreen(raw: unknown, at = Date.now()): SavedScreen | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  if (!id) return null
  return {
    id,
    name: text(o.name, 60) || 'Screen',
    query: cleanQuery(o.query),
    createdAt: typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt : at,
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) ? o.updatedAt : at
  }
}

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const ORDER_TYPES = new Set<OrderType>(['market', 'limit', 'stop', 'stop-limit'])
const ORDER_STATES = new Set<OrderState>(['pending', 'filled', 'cancelled', 'rejected'])

/**
 * One order read back from a file.
 *
 * Strict about the numbers, because these are what an account's cash is computed from. An order with a quantity that is
 * not a number would make every figure after it meaningless, so it is dropped rather than repaired.
 */
function cleanOrder(raw: unknown): PaperOrder | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  const instrumentId = text(o.instrumentId, 200)
  const quantity = finite(o.quantity)
  const placedAt = finite(o.placedAt)
  if (!id || !instrumentId || quantity === null || quantity <= 0 || placedAt === null) return null
  if (o.side !== 'buy' && o.side !== 'sell') return null
  if (!ORDER_TYPES.has(o.type as OrderType)) return null
  const order: PaperOrder = {
    id,
    instrumentId,
    side: o.side as Side,
    type: o.type as OrderType,
    quantity,
    state: ORDER_STATES.has(o.state as OrderState) ? (o.state as OrderState) : 'rejected',
    placedAt
  }
  const limitPrice = finite(o.limitPrice)
  if (limitPrice !== null) order.limitPrice = limitPrice
  const stopPrice = finite(o.stopPrice)
  if (stopPrice !== null) order.stopPrice = stopPrice
  const filledAt = finite(o.filledAt)
  if (filledAt !== null) order.filledAt = filledAt
  const filledPrice = finite(o.filledPrice)
  if (filledPrice !== null) order.filledPrice = filledPrice
  const fee = finite(o.fee)
  if (fee !== null) order.fee = fee
  const reason = text(o.reason, 200)
  if (reason) order.reason = reason
  return order
}

function cleanFill(raw: unknown): PaperFill | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const instrumentId = text(o.instrumentId, 200)
  const quantity = finite(o.quantity)
  const price = finite(o.price)
  const at = finite(o.at)
  if (!instrumentId || quantity === null || price === null || at === null) return null
  if (quantity <= 0 || price <= 0) return null
  if (o.side !== 'buy' && o.side !== 'sell') return null
  return {
    orderId: text(o.orderId, 80),
    instrumentId,
    side: o.side as Side,
    quantity,
    price,
    fee: finite(o.fee) ?? 0,
    at,
    realised: finite(o.realised) ?? 0
  }
}

function cleanPosition(raw: unknown): PaperPosition | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const instrumentId = text(o.instrumentId, 200)
  const quantity = finite(o.quantity)
  const averagePrice = finite(o.averagePrice)
  // A position of zero is not a position, and one with no average price cannot be valued against anything.
  if (!instrumentId || quantity === null || quantity === 0 || averagePrice === null || averagePrice <= 0) return null
  return {
    instrumentId,
    quantity,
    averagePrice,
    feesPaid: finite(o.feesPaid) ?? 0,
    openedAt: finite(o.openedAt) ?? 0
  }
}

function cleanEquity(raw: unknown): EquityPoint | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const at = finite(o.at)
  const total = finite(o.total)
  if (at === null || at <= 0 || total === null) return null
  return { at, total, cash: finite(o.cash) ?? 0, realised: finite(o.realised) ?? 0 }
}

/** The paper account read back. Null when there is no usable account, which the interface shows as "none yet". */
export function cleanPaper(raw: unknown, at = Date.now()): PaperState | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const accountRaw = (o.account && typeof o.account === 'object' ? o.account : {}) as Record<string, unknown>
  const startingCash = finite(accountRaw.startingCash)
  const cash = finite(accountRaw.cash)
  // Without these two nothing about the account can be believed: every return is measured against the first and every
  // order is paid for out of the second.
  if (startingCash === null || cash === null) return null

  const settingsRaw = (o.settings && typeof o.settings === 'object' ? o.settings : {}) as Record<string, unknown>
  const fraction = (value: unknown, fallback: number): number => {
    const found = finite(value)
    return found === null || found < 0 || found > 0.5 ? fallback : found
  }
  const settings: PaperSettings = {
    slippage: fraction(settingsRaw.slippage, DEFAULT_SETTINGS.slippage),
    feeRate: fraction(settingsRaw.feeRate, DEFAULT_SETTINGS.feeRate),
    allowShort: settingsRaw.allowShort === true
  }

  const account: PaperAccount = {
    startingCash,
    cash,
    currency: text(accountRaw.currency, 12) || 'USD',
    positions: (Array.isArray(accountRaw.positions) ? accountRaw.positions : [])
      .map((one) => cleanPosition(one))
      .filter((one): one is PaperPosition => one !== null),
    orders: (Array.isArray(accountRaw.orders) ? accountRaw.orders : [])
      .map((one) => cleanOrder(one))
      .filter((one): one is PaperOrder => one !== null)
      .slice(-MAX_ORDERS),
    fills: (Array.isArray(accountRaw.fills) ? accountRaw.fills : [])
      .map((one) => cleanFill(one))
      .filter((one): one is PaperFill => one !== null)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_FILLS)
  }

  return {
    account,
    settings,
    equity: (Array.isArray(o.equity) ? o.equity : [])
      .map((one) => cleanEquity(one))
      .filter((one): one is EquityPoint => one !== null)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_EQUITY),
    createdAt: finite(o.createdAt) ?? at
  }
}

/** One recorded run read back. Null when it lacks what makes it comparable to another. */
export function cleanRun(raw: unknown): BacktestRun | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = text(o.id, 80)
  const strategyId = text(o.strategyId, 80)
  const at = finite(o.at)
  const totalReturnPercent = finite(o.totalReturnPercent)
  // Without a return there is nothing to compare, and a row with a dash where its result should be is not a run.
  if (!id || !strategyId || at === null || totalReturnPercent === null) return null
  const costs = (o.costs && typeof o.costs === 'object' ? o.costs : {}) as Record<string, unknown>
  return {
    id,
    strategyId,
    strategyName: text(o.strategyName, 60),
    strategyVersion: Math.max(1, Math.round(finite(o.strategyVersion) ?? 1)),
    instrumentId: text(o.instrumentId, 200),
    interval: text(o.interval, 8) || '1h',
    at,
    from: finite(o.from) ?? 0,
    to: finite(o.to) ?? 0,
    bars: Math.max(0, Math.round(finite(o.bars) ?? 0)),
    trades: Math.max(0, Math.round(finite(o.trades) ?? 0)),
    totalReturnPercent,
    benchmarkReturnPercent: finite(o.benchmarkReturnPercent),
    maxDrawdownPercent: finite(o.maxDrawdownPercent) ?? 0,
    sharpe: finite(o.sharpe),
    winRate: finite(o.winRate),
    ambiguousExits: Math.max(0, Math.round(finite(o.ambiguousExits) ?? 0)),
    startingCash: finite(o.startingCash) ?? 0,
    costs: {
      slippage: finite(costs.slippage) ?? 0,
      feeRate: finite(costs.feeRate) ?? 0
    }
  }
}

const SECTIONS = new Set(['markets', 'screener', 'alerts', 'portfolio', 'backtest', 'replay', 'news'])
const TABS = new Set(['chart', 'book', 'trades'])
const CHART_TYPES = new Set(['candles', 'line', 'area', 'ohlc'])

/** Where Markets was left, read back. Anything unrecognised falls back rather than restoring a screen that cannot exist. */
export function cleanLayout(raw: unknown): MarketsLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT }
  const o = raw as Record<string, unknown>
  const section = text(o.section, 20)
  const tab = text(o.tab, 12)
  const chartType = text(o.chartType, 12)
  const indicators: { kind: string; options: Record<string, number> }[] = []
  for (const one of Array.isArray(o.indicators) ? o.indicators : []) {
    if (!one || typeof one !== 'object') continue
    const entry = one as Record<string, unknown>
    const kind = text(entry.kind, 32)
    if (!kind) continue
    const options: Record<string, number> = {}
    for (const [name, value] of Object.entries((entry.options ?? {}) as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 500) {
        options[name.slice(0, 20)] = Math.round(value)
      }
    }
    indicators.push({ kind, options })
    if (indicators.length >= 8) break
  }
  return {
    section: SECTIONS.has(section) ? section : DEFAULT_LAYOUT.section,
    instrumentId: text(o.instrumentId, 200),
    tab: TABS.has(tab) ? tab : DEFAULT_LAYOUT.tab,
    interval: text(o.interval, 8) || DEFAULT_LAYOUT.interval,
    chartType: CHART_TYPES.has(chartType) ? chartType : DEFAULT_LAYOUT.chartType,
    indicators
  }
}

/**
 * Whether this file belongs to somebody who was already using Markets.
 *
 * Any of these is somebody who set something up. It matters because they must not be treated as a new arrival: their
 * configuration is the truth, and an upgrade that replaced it with a preset's idea of a good default would be an upgrade
 * that undid their work.
 */
function alreadySetUp(o: Record<string, unknown>): boolean {
  const some = (value: unknown): boolean => Array.isArray(value) && value.length > 0
  return (
    some(o.watchlists) ||
    some(o.alerts) ||
    some(o.strategies) ||
    some(o.screens) ||
    Boolean(o.paper) ||
    some((o.ticker as { groups?: unknown } | undefined)?.groups)
  )
}

/**
 * The experience profile, read or inferred.
 *
 * Three cases, and the middle one is the one that matters. A file with a profile is read. A file with no profile but with
 * watchlists, alerts or a simulated account belonged to somebody using Markets before any of this existed: what can be
 * read off their settings safely is read, their settings themselves become explicit overrides so no preset can undo them,
 * and `onboarding.completed` is left false so they are asked once — which is an offer, not a reset. A file with nothing in
 * it is somebody new, and gets the balanced default until they say otherwise.
 */
function readExperience(o: Record<string, unknown>, at: number): MarketsExperienceProfile {
  if (o.experience && typeof o.experience === 'object') return cleanExperience(o.experience, at)
  if (!alreadySetUp(o)) return { ...DEFAULT_EXPERIENCE, updatedAt: at }
  const ticker = cleanTicker(o.ticker)
  const layout = cleanLayout(o.layout)
  const lists = Array.isArray(o.watchlists) ? o.watchlists : []
  const firstColumns = lists
    .map((one) => (one && typeof one === 'object' ? (one as { columns?: unknown }).columns : undefined))
    .find((columns): columns is string[] => Array.isArray(columns) && columns.length > 0)
  return inferExperience(
    {
      columns: firstColumns,
      tickerFields: ticker.fields,
      interval: layout.interval,
      chartType: layout.chartType,
      indicators: layout.indicators,
      hasAlerts: Array.isArray(o.alerts) && o.alerts.length > 0,
      hasStrategies: Array.isArray(o.strategies) && o.strategies.length > 0,
      hasPaper: Boolean(o.paper)
    },
    at
  )
}

export function cleanWorkspace(raw: unknown, at = Date.now()): MarketsWorkspace {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_WORKSPACE, updatedAt: at }
  const o = raw as Record<string, unknown>
  const watchlists: Watchlist[] = []
  const seen = new Set<string>()
  for (const one of Array.isArray(o.watchlists) ? o.watchlists : []) {
    const list = cleanWatchlist(one, at)
    if (!list || seen.has(list.id)) continue
    seen.add(list.id)
    watchlists.push(list)
    if (watchlists.length >= MAX_WATCHLISTS) break
  }
  const known: Instrument[] = []
  const knownIds = new Set<string>()
  for (const one of Array.isArray(o.known) ? o.known : []) {
    const instrument = cleanInstrument(one)
    if (!instrument || knownIds.has(instrument.instrumentId)) continue
    knownIds.add(instrument.instrumentId)
    known.push(instrument)
    if (known.length >= 2000) break
  }
  return {
    version: 1,
    // A file written before this setting existed has no `enabled`, and the honest reading of that is the behaviour it
    // already had: Markets working.
    enabled: bool(o.enabled, true),
    watchlists,
    ticker: cleanTicker(o.ticker),
    alerts: cleanAlerts(o.alerts, at),
    alertHistory: (Array.isArray(o.alertHistory) ? o.alertHistory : [])
      .map((one) => cleanFiring(one))
      .filter((one): one is AlertFiring => one !== null)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_HISTORY),
    currency: cleanCurrencyPreference(o.currency),
    layout: cleanLayout(o.layout),
    strategies: (() => {
      const out: Strategy[] = []
      const seen = new Set<string>()
      for (const one of Array.isArray(o.strategies) ? o.strategies : []) {
        const strategy = cleanStrategy(one, at)
        if (!strategy || seen.has(strategy.id)) continue
        seen.add(strategy.id)
        out.push(strategy)
        if (out.length >= MAX_STRATEGIES) break
      }
      return out
    })(),
    backtestRuns: (Array.isArray(o.backtestRuns) ? o.backtestRuns : [])
      .map((one) => cleanRun(one))
      .filter((one): one is BacktestRun => one !== null)
      .sort((a, b) => a.at - b.at)
      .slice(-MAX_RUNS),
    paper: cleanPaper(o.paper, at),
    experience: readExperience(o, at),
    onboarding: cleanOnboarding(o.onboarding, at),
    favourites: ids(o.favourites, MAX_FAVOURITES),
    recent: ids(o.recent, MAX_RECENT),
    drawings: cleanDrawings(o.drawings, at, MAX_DRAWINGS),
    panels: cleanPanelLayout(o.panels),
    triggers: (() => {
      const out: MarketTrigger[] = []
      const seen = new Set<string>()
      for (const one of Array.isArray(o.triggers) ? o.triggers : []) {
        const trigger = cleanTrigger(one, at)
        if (!trigger || seen.has(trigger.id)) continue
        seen.add(trigger.id)
        out.push(trigger)
        if (out.length >= MAX_TRIGGERS) break
      }
      return out
    })(),
    margin: cleanMargin(o.margin),
    screens: (() => {
      const out: SavedScreen[] = []
      const seen = new Set<string>()
      for (const one of Array.isArray(o.screens) ? o.screens : []) {
        const screen = cleanScreen(one, at)
        if (!screen || seen.has(screen.id)) continue
        seen.add(screen.id)
        out.push(screen)
        if (out.length >= MAX_SCREENS) break
      }
      return out
    })(),
    known,
    updatedAt: at
  }
}

/** Which instruments the ticker is showing now. Empty when it is off or nothing is chosen. */
export function tickerInstrumentIds(ticker: TickerConfig): string[] {
  if (!ticker.enabled) return []
  const group = ticker.groups.find((g) => g.id === ticker.activeGroupId) ?? ticker.groups[0]
  return group ? [...group.instrumentIds] : []
}

/** Everything being watched for any reason, for deciding what to subscribe to. */
export function allWatched(workspace: MarketsWorkspace): string[] {
  // Markets off means nothing is watched, whatever the lists still say. Anything else would leave a socket open for a
  // feature the person switched off.
  if (!workspace.enabled) return []
  const ids = new Set<string>(tickerInstrumentIds(workspace.ticker))
  for (const list of workspace.watchlists) {
    for (const item of list.items) ids.add(item.instrumentId)
  }
  // An alert has to keep working whether or not its instrument is on a list.
  for (const alert of workspace.alerts) {
    if (alert.enabled) ids.add(alert.instrumentId)
  }
  return [...ids]
}
