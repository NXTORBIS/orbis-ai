import { calculate, type Candle, type IndicatorKind, type Series } from './indicators.ts'
import { matches, turnoverOf, type DiscoveryFilter, type MarketRow } from './discovery.ts'

/**
 * The screener.
 *
 * A question about the whole market universe, asked in conditions and answered from real data. The shape of it is decided
 * by one fact about the data: **a snapshot is cheap and candles are not.**
 *
 * Every provider that can report its universe gives a price, a change and a volume for every market in one request. An
 * indicator needs a candle series per market, which is one request each. So the screener runs in two stages:
 *
 *  1. **Snapshot conditions** over every market. Free, because the rows are already held.
 *  2. **Technical conditions** over only what survived stage one, and only up to a cap.
 *
 * The cap is the honest part. A screen asking for "RSI below 30" across three thousand markets would be three thousand
 * requests, so the answer says how many markets it actually examined and how many it had to leave out. A screener that
 * silently examined the first fifty and presented the result as the market's oversold coins would be wrong in a way
 * nobody could see.
 *
 * Nothing here invents a value. A market missing the field a condition asks about does not pass that condition — it is not
 * treated as zero, and it is not quietly dropped from the count of what was examined.
 */

/** What a condition can be about. */
export type ScreenerField =
  | 'price'
  | 'changePercent'
  | 'turnover'
  | 'volume'
  | 'rsi'
  | 'priceVsSma'
  | 'priceVsEma'
  | 'macdHistogram'
  | 'atrPercent'
  | 'volatility'
  // Derivatives. Only measurable for a contract whose venue publishes them; null for every spot market, which is not a
  // failure to report but a fact about the market.
  | 'funding'
  | 'openInterest'
  | 'openInterestChange'
  | 'spread'

export type ScreenerOperator = 'gt' | 'lt' | 'between'

export interface ScreenerCondition {
  field: ScreenerField
  operator: ScreenerOperator
  value: number
  /** The high end, for `between`. */
  value2?: number
  /** The indicator period, where the field has one. */
  period?: number
  /** Which candles the indicator is measured on. */
  interval?: string
}

/**
 * A group of conditions with its own combining rule.
 *
 * One level of nesting, which is what turns "(A and B) or (C and D)" from two separate screens into one. Deeper nesting
 * was deliberately not built: every extra level multiplies what the builder has to render and what a person has to hold
 * in their head, and two levels covers the queries anybody actually writes.
 */
export interface ScreenerGroup {
  conditions: ScreenerCondition[]
  match: 'all' | 'any'
}

export interface ScreenerQuery {
  conditions: ScreenerCondition[]
  /** Whether every condition must hold, or any one of them. */
  match: 'all' | 'any'
  /**
   * Further groups, combined with the top-level conditions.
   *
   * Each group is evaluated on its own and the results joined by `groupMatch`. Empty for every query that existed before
   * this, which is why the old shape still means exactly what it did.
   */
  groups?: ScreenerGroup[]
  /** How the groups combine with each other and with the top-level conditions. */
  groupMatch?: 'all' | 'any'
  sort: { field: ScreenerField; direction: 'asc' | 'desc' }
  limit: number
  /** The universe to ask about, before any condition is applied. */
  filter?: DiscoveryFilter
}

export const DEFAULT_QUERY: ScreenerQuery = {
  conditions: [],
  match: 'all',
  sort: { field: 'turnover', direction: 'desc' },
  limit: 50,
  filter: {}
}

export interface FieldInfo {
  field: ScreenerField
  label: string
  /** How it is written: a price, a percentage, or a plain number. */
  unit: 'price' | 'percent' | 'amount'
  /** Whether answering it needs a candle series, which is what makes it expensive. */
  needsCandles: boolean
  /** Its own default period, where it has one. */
  defaultPeriod?: number
  hint: string
}

export const FIELDS: FieldInfo[] = [
  { field: 'price', label: 'Price', unit: 'price', needsCandles: false, hint: 'The last traded price.' },
  {
    field: 'changePercent',
    label: '24h change',
    unit: 'percent',
    needsCandles: false,
    hint: 'The provider’s own 24-hour change.'
  },
  {
    field: 'turnover',
    label: '24h value traded',
    unit: 'amount',
    needsCandles: false,
    hint: 'Value traded in the quote currency, which is what makes two markets comparable.'
  },
  {
    field: 'volume',
    label: '24h volume',
    unit: 'amount',
    needsCandles: false,
    hint: 'Volume in the base asset’s own units. Not comparable between different assets.'
  },
  {
    field: 'spread',
    label: 'Spread (%)',
    unit: 'percent',
    needsCandles: false,
    hint: 'The gap between the best bid and ask, as a percentage of the mid. Needs a quote with both sides.'
  },
  {
    field: 'funding',
    label: 'Funding rate (%)',
    unit: 'percent',
    needsCandles: false,
    hint: 'The current funding rate. Perpetual contracts only — null for every spot market.'
  },
  {
    field: 'openInterest',
    label: 'Open interest',
    unit: 'amount',
    needsCandles: false,
    hint: 'Contracts outstanding. Derivatives only.'
  },
  {
    field: 'openInterestChange',
    label: 'Open interest change (%)',
    unit: 'percent',
    needsCandles: false,
    hint: 'How much open interest moved over the window. Derivatives only.'
  },
  { field: 'rsi', label: 'RSI', unit: 'amount', needsCandles: true, defaultPeriod: 14, hint: 'Relative strength index.' },
  {
    field: 'priceVsSma',
    label: 'Price vs SMA (%)',
    unit: 'percent',
    needsCandles: true,
    defaultPeriod: 50,
    hint: 'How far the price is above or below its simple moving average, as a percentage.'
  },
  {
    field: 'priceVsEma',
    label: 'Price vs EMA (%)',
    unit: 'percent',
    needsCandles: true,
    defaultPeriod: 20,
    hint: 'How far the price is above or below its exponential moving average, as a percentage.'
  },
  {
    field: 'macdHistogram',
    label: 'MACD histogram',
    unit: 'amount',
    needsCandles: true,
    hint: 'Above zero is MACD over its signal line.'
  },
  {
    field: 'atrPercent',
    label: 'ATR (% of price)',
    unit: 'percent',
    needsCandles: true,
    defaultPeriod: 14,
    hint: 'Average true range as a share of price, so it compares across markets.'
  },
  {
    field: 'volatility',
    label: 'Historical volatility',
    unit: 'percent',
    needsCandles: true,
    defaultPeriod: 20,
    hint: 'Annualised, from closing prices.'
  }
]

export const fieldInfo = (field: ScreenerField): FieldInfo | undefined => FIELDS.find((f) => f.field === field)

export const needsCandles = (field: ScreenerField): boolean => fieldInfo(field)?.needsCandles === true

/**
 * Whether a field needs derivatives data, which only some markets have.
 *
 * Kept separate from `needsCandles` because it is a different kind of expensive: candles cost a request, derivatives
 * cost a request *and* are simply absent for most markets. A screen over spot pairs with a funding condition matches
 * nothing, which is correct and is what the answer says.
 */
export const needsDerivatives = (field: ScreenerField): boolean =>
  field === 'funding' || field === 'openInterest' || field === 'openInterestChange'

/** Every condition in a query, top-level and grouped, in one list. */
export const allConditions = (query: ScreenerQuery): ScreenerCondition[] => [
  ...query.conditions,
  ...(query.groups ?? []).flatMap((group) => group.conditions)
]

/** Whether a query needs candles at all, which decides whether the expensive stage runs. */
export const queryNeedsCandles = (query: ScreenerQuery): boolean =>
  allConditions(query).some((c) => needsCandles(c.field)) || needsCandles(query.sort.field)

/** Whether anything in a query asks for derivatives data, so the caller knows to fetch it. */
export const queryNeedsDerivatives = (query: ScreenerQuery): boolean =>
  allConditions(query).some((c) => needsDerivatives(c.field)) || needsDerivatives(query.sort.field)

/** The last value of a series, which is the only one a screen is asking about. Null when it never computed. */
const latest = (series: Series | undefined): number | null => {
  if (!series) return null
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

/**
 * One field's value for one market.
 *
 * Null when it cannot be worked out — a market with no reported volume, or an indicator with too little history. Null is
 * the answer, not zero: a market whose RSI has not been computed is not a market with an RSI of nothing.
 */
/**
 * The derivatives figures for one market, supplied by the caller.
 *
 * Passed in rather than fetched, because this module is pure. A market the caller knows nothing about measures as null
 * on every derivatives field, which excludes it from an `all` query and leaves it to the other conditions in an `any`
 * one — never counted as a zero.
 */
export interface ScreenerExtras {
  funding?: number | null
  openInterest?: number | null
  openInterestChange?: number | null
}

export function valueOf(
  row: MarketRow,
  field: ScreenerField,
  candles: Candle[] | null,
  condition?: ScreenerCondition,
  extras?: ScreenerExtras
): number | null {
  const quote = row.quote
  switch (field) {
    case 'price':
      return typeof quote.last === 'number' && Number.isFinite(quote.last) ? quote.last : null
    case 'changePercent':
      return typeof quote.changePercent === 'number' && Number.isFinite(quote.changePercent) ? quote.changePercent : null
    case 'turnover':
      return turnoverOf(quote)
    case 'volume':
      return typeof quote.volume === 'number' && Number.isFinite(quote.volume) ? quote.volume : null
    case 'spread': {
      const bid = typeof quote.bid === 'number' && Number.isFinite(quote.bid) ? quote.bid : null
      const ask = typeof quote.ask === 'number' && Number.isFinite(quote.ask) ? quote.ask : null
      // Both sides, and not crossed. A negative spread is a broken quote, not a market to rank.
      if (bid === null || ask === null || ask < bid) return null
      const mid = (bid + ask) / 2
      return mid > 0 ? ((ask - bid) / mid) * 100 : null
    }
    // Null unless the caller supplied it, which for a spot market it never will.
    case 'funding':
      return extras?.funding === null || extras?.funding === undefined ? null : extras.funding * 100
    case 'openInterest':
      return extras?.openInterest ?? null
    case 'openInterestChange':
      return extras?.openInterestChange === null || extras?.openInterestChange === undefined
        ? null
        : extras.openInterestChange * 100
    default:
      break
  }

  // Everything below needs history. Without it the answer is unknown, which is not the same as failing the condition.
  if (!candles || candles.length === 0) return null
  const period = condition?.period ?? fieldInfo(field)?.defaultPeriod
  const price = candles[candles.length - 1]?.close
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null

  const run = (kind: IndicatorKind, options: Record<string, number> = {}): Record<string, Series> => {
    try {
      return calculate(kind, candles, options)
    } catch {
      return {}
    }
  }

  switch (field) {
    case 'rsi':
      return latest(run('rsi', period ? { period } : {}).rsi)
    case 'priceVsSma': {
      const value = latest(run('sma', period ? { period } : {}).sma)
      return value === null || value === 0 ? null : ((price - value) / value) * 100
    }
    case 'priceVsEma': {
      const value = latest(run('ema', period ? { period } : {}).ema)
      return value === null || value === 0 ? null : ((price - value) / value) * 100
    }
    case 'macdHistogram':
      return latest(run('macd').histogram)
    case 'atrPercent': {
      const value = latest(run('atr', period ? { period } : {}).atr)
      return value === null ? null : (value / price) * 100
    }
    case 'volatility':
      return latest(run('historicalVolatility', period ? { period } : {}).historicalVolatility)
    default:
      return null
  }
}

/** Whether one value satisfies one condition. A value that is not known satisfies nothing. */
export function holds(value: number | null, condition: ScreenerCondition): boolean {
  if (value === null || !Number.isFinite(value)) return false
  if (condition.operator === 'gt') return value > condition.value
  if (condition.operator === 'lt') return value < condition.value
  const low = Math.min(condition.value, condition.value2 ?? condition.value)
  const high = Math.max(condition.value, condition.value2 ?? condition.value)
  return value >= low && value <= high
}

export interface ScreenerResult {
  row: MarketRow
  /** Every field the query mentioned, so the table can show what it filtered on. */
  values: Partial<Record<ScreenerField, number | null>>
}

export interface ScreenerAnswer {
  results: ScreenerResult[]
  /** How many markets the universe held after the query's own filter, before any condition. */
  universeSize: number
  /** How many survived the conditions that need no history. */
  afterSnapshot: number
  /** How many were actually examined with candles. Equal to `afterSnapshot` when nothing was left out. */
  examined: number
  /**
   * How many passed the snapshot stage but were never examined, because examining them would have cost a request each.
   *
   * Shown rather than hidden: a screen that quietly examined the first fifty would present its answer as the market's,
   * and it would not be.
   */
  skipped: number
  /** Which fields the answer carries, in the order a table should show them. */
  columns: ScreenerField[]
}

/** The fields a query touches, for the table's columns. The sort field is always included. */
export function columnsOf(query: ScreenerQuery): ScreenerField[] {
  const seen: ScreenerField[] = []
  for (const condition of query.conditions) if (!seen.includes(condition.field)) seen.push(condition.field)
  if (!seen.includes(query.sort.field)) seen.push(query.sort.field)
  return seen
}

/**
 * The first stage: every condition that can be answered from the snapshot.
 *
 * Separated so the caller can fetch candles for exactly the survivors, rather than for the universe.
 */
/**
 * Whether one market passes a whole query.
 *
 * The only place the combining rules live, so the cheap stage and the full stage cannot disagree about what a query
 * means. `value` answers a condition; a null from it is an unknown, and an unknown never passes.
 */
export function passesQuery(
  query: ScreenerQuery,
  value: (condition: ScreenerCondition) => number | null
): boolean {
  const judge = (conditions: ScreenerCondition[], match: 'all' | 'any'): boolean | null => {
    if (conditions.length === 0) return null
    const outcomes = conditions.map((condition) => holds(value(condition), condition))
    return match === 'all' ? outcomes.every(Boolean) : outcomes.some(Boolean)
  }

  const top = judge(query.conditions, query.match)
  const groups = (query.groups ?? [])
    .map((group) => judge(group.conditions, group.match))
    .filter((one): one is boolean => one !== null)

  // An empty query matches everything, which is what a screener with no conditions should do.
  if (top === null && groups.length === 0) return true
  const parts = top === null ? groups : [top, ...groups]
  return (query.groupMatch ?? 'all') === 'any' ? parts.some(Boolean) : parts.every(Boolean)
}

export function screenSnapshot(rows: MarketRow[], query: ScreenerQuery): { passed: MarketRow[]; universeSize: number } {
  const universe = rows.filter((row) => matches(row, query.filter ?? {}))
  const every = allConditions(query)
  const expensive = every.some((c) => needsCandles(c.field) || needsDerivatives(c.field))

  /*
   * Anything `any` touches cannot be narrowed here.
   *
   * A market that fails every cheap condition may still pass on a technical or derivatives one, and excluding it now
   * would be excluding it on an answer nobody has yet. That applies to the top-level `any`, to any group that uses it,
   * and to `groupMatch: 'any'` — so the check is over the whole query rather than one field of it.
   */
  const anyAnywhere =
    query.match === 'any' ||
    (query.groupMatch ?? 'all') === 'any' ||
    (query.groups ?? []).some((group) => group.match === 'any')
  if (expensive && anyAnywhere) return { passed: universe, universeSize: universe.length }

  // Only the conditions that can be answered from a quote. An expensive one is treated as passing, because it has not
  // been judged yet -- narrowing on it here would drop markets before the data arrives.
  const passed = universe.filter((row) =>
    passesQuery(query, (condition) =>
      needsCandles(condition.field) || needsDerivatives(condition.field)
        ? passingValue(condition)
        : valueOf(row, condition.field, null, condition)
    )
  )
  return { passed, universeSize: universe.length }
}

/**
 * A value that satisfies a condition, for a field not yet measurable.
 *
 * Used only in the cheap stage, where an expensive condition must not eliminate anybody. Never reaches a result: the
 * second stage answers every condition from real data or counts the market as skipped.
 */
function passingValue(condition: ScreenerCondition): number {
  switch (condition.operator) {
    case 'gt':
      return condition.value + 1
    case 'lt':
      return condition.value - 1
    case 'between':
      return (condition.value + (condition.value2 ?? condition.value)) / 2
  }
}

/**
 * The second stage, and the answer.
 *
 * `candlesFor` returns what has been fetched for a market, or null when it was not fetched. A market with no candles is
 * not examined and is counted as skipped rather than judged on data nobody has.
 */
export function screen(
  rows: MarketRow[],
  query: ScreenerQuery,
  candlesFor: (instrumentId: string) => Candle[] | null = () => null,
  extrasFor: (instrumentId: string) => ScreenerExtras | null = () => null
): ScreenerAnswer {
  const { passed, universeSize } = screenSnapshot(rows, query)
  const columns = columnsOf(query)
  const every = allConditions(query)
  const expensive = every.some((c) => needsCandles(c.field)) || needsCandles(query.sort.field)

  let examined = 0
  let skipped = 0
  const results: ScreenerResult[] = []

  for (const row of passed) {
    const candles = candlesFor(row.instrument.instrumentId)
    if (expensive) {
      if (candles === null || candles.length === 0) {
        skipped++
        continue
      }
      examined++
    }

    const extras = extrasFor(row.instrument.instrumentId) ?? undefined
    const values: Partial<Record<ScreenerField, number | null>> = {}
    for (const field of columns) {
      values[field] = valueOf(row, field, candles, every.find((c) => c.field === field), extras)
    }

    // One judgement, through the one function that knows what a query means.
    if (!passesQuery(query, (condition) => valueOf(row, condition.field, candles, condition, extras))) continue
    results.push({ row, values })
  }

  const sortField = query.sort.field
  const sign = query.sort.direction === 'asc' ? 1 : -1
  results.sort((a, b) => {
    const left = a.values[sortField] ?? null
    const right = b.values[sortField] ?? null
    // A market whose sort value is unknown goes last whichever way the sort runs: it has not earned a place at the top,
    // and putting it there would read as a ranking.
    if (left === null && right === null) return a.row.instrument.symbol.localeCompare(b.row.instrument.symbol)
    if (left === null) return 1
    if (right === null) return -1
    if (left === right) return a.row.instrument.symbol.localeCompare(b.row.instrument.symbol)
    return (left - right) * sign
  })

  return {
    results: results.slice(0, Math.max(1, query.limit)),
    universeSize,
    afterSnapshot: passed.length,
    examined: expensive ? examined : passed.length,
    skipped,
    columns
  }
}

/** A saved screen. The definition only — never the rows it returned, which were true for one moment. */
export interface SavedScreen {
  id: string
  name: string
  query: ScreenerQuery
  createdAt: number
  updatedAt: number
}

const number = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const FIELD_NAMES = new Set(FIELDS.map((f) => f.field))
const OPERATORS = new Set<ScreenerOperator>(['gt', 'lt', 'between'])

export function cleanCondition(raw: unknown): ScreenerCondition | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.field !== 'string' || !FIELD_NAMES.has(o.field as ScreenerField)) return null
  const operator = OPERATORS.has(o.operator as ScreenerOperator) ? (o.operator as ScreenerOperator) : 'gt'
  const condition: ScreenerCondition = {
    field: o.field as ScreenerField,
    operator,
    value: number(o.value, 0)
  }
  if (operator === 'between') condition.value2 = number(o.value2, condition.value)
  // A period of zero is not a period. Rejected rather than passed to an indicator that would refuse it anyway.
  if (typeof o.period === 'number' && Number.isFinite(o.period) && o.period >= 1) condition.period = Math.round(o.period)
  if (typeof o.interval === 'string' && o.interval.length <= 8) condition.interval = o.interval
  return condition
}

export function cleanQuery(raw: unknown): ScreenerQuery {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_QUERY }
  const o = raw as Record<string, unknown>
  const conditions: ScreenerCondition[] = []
  for (const one of Array.isArray(o.conditions) ? o.conditions : []) {
    const condition = cleanCondition(one)
    if (condition) conditions.push(condition)
    if (conditions.length >= 12) break
  }
  const sortRaw = (o.sort && typeof o.sort === 'object' ? o.sort : {}) as Record<string, unknown>
  const filterRaw = (o.filter && typeof o.filter === 'object' ? o.filter : {}) as Record<string, unknown>
  const filter: DiscoveryFilter = {}
  if (typeof filterRaw.quoteCurrency === 'string' && filterRaw.quoteCurrency) {
    filter.quoteCurrency = filterRaw.quoteCurrency.slice(0, 12)
  }
  if (typeof filterRaw.minQuoteVolume === 'number' && Number.isFinite(filterRaw.minQuoteVolume) && filterRaw.minQuoteVolume > 0) {
    filter.minQuoteVolume = filterRaw.minQuoteVolume
  }
  if (typeof filterRaw.text === 'string' && filterRaw.text.trim()) filter.text = filterRaw.text.trim().slice(0, 40)

  // Groups, read the same way and bounded the same way. A malformed group is dropped rather than making the query
  // unreadable, and a query whose groups were all dropped is a narrower query than intended -- never a wider one.
  const groups: ScreenerGroup[] = []
  for (const one of Array.isArray(o.groups) ? o.groups : []) {
    if (!one || typeof one !== 'object') continue
    const g = one as Record<string, unknown>
    const inner: ScreenerCondition[] = []
    for (const each of Array.isArray(g.conditions) ? g.conditions : []) {
      const condition = cleanCondition(each)
      if (condition) inner.push(condition)
      if (inner.length >= 12) break
    }
    if (inner.length === 0) continue
    groups.push({ conditions: inner, match: g.match === 'any' ? 'any' : 'all' })
    if (groups.length >= 4) break
  }

  return {
    conditions,
    match: o.match === 'any' ? 'any' : 'all',
    groups: groups.length > 0 ? groups : undefined,
    groupMatch: o.groupMatch === 'any' ? 'any' : 'all',
    sort: {
      field: FIELD_NAMES.has(sortRaw.field as ScreenerField) ? (sortRaw.field as ScreenerField) : 'turnover',
      direction: sortRaw.direction === 'asc' ? 'asc' : 'desc'
    },
    limit: Math.min(200, Math.max(1, Math.round(number(o.limit, 50)))),
    filter
  }
}

/**
 * Screens worth offering, each one a real set of conditions.
 *
 * Not a hardcoded list of coins under a flattering name: every one of these is evaluated against the live universe, and
 * any of them can legitimately come back empty.
 */
export const PRESETS: { name: string; query: ScreenerQuery }[] = [
  {
    name: 'Liquid movers',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 10_000_000 },
        { field: 'changePercent', operator: 'gt', value: 5 }
      ],
      sort: { field: 'changePercent', direction: 'desc' }
    }
  },
  {
    name: 'Heavily sold',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 10_000_000 },
        { field: 'changePercent', operator: 'lt', value: -5 }
      ],
      sort: { field: 'changePercent', direction: 'asc' }
    }
  },
  {
    name: 'Oversold, with volume',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 25_000_000 },
        { field: 'rsi', operator: 'lt', value: 30, period: 14, interval: '1h' }
      ],
      sort: { field: 'rsi', direction: 'asc' }
    }
  },
  {
    name: 'Overbought, with volume',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 25_000_000 },
        { field: 'rsi', operator: 'gt', value: 70, period: 14, interval: '1h' }
      ],
      sort: { field: 'rsi', direction: 'desc' }
    }
  },
  {
    name: 'Above the 50-period average',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 25_000_000 },
        { field: 'priceVsSma', operator: 'gt', value: 0, period: 50, interval: '1h' }
      ],
      sort: { field: 'priceVsSma', direction: 'desc' }
    }
  },
  {
    name: 'Most volatile, liquid',
    query: {
      ...DEFAULT_QUERY,
      conditions: [
        { field: 'turnover', operator: 'gt', value: 25_000_000 },
        { field: 'atrPercent', operator: 'gt', value: 2, period: 14, interval: '1h' }
      ],
      sort: { field: 'atrPercent', direction: 'desc' }
    }
  }
]
