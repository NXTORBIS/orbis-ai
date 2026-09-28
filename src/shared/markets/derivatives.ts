/**
 * Perpetual and dated futures, normalised.
 *
 * A separate file from spot because they are separate markets. `BTCUSDT` on a spot venue and `BTCUSDT` as a perpetual are
 * two different instruments with two different prices, and the whole point of keeping them apart here is that nothing
 * downstream can accidentally show one while labelled the other.
 *
 * What this file will not do:
 *
 * **It never invents a schedule.** A funding countdown needs a funding time the venue published. Without one there is no
 * countdown — not a guess from the usual eight-hour cycle, because a guess that is right most of the time is a number
 * somebody will trust on the day it is wrong.
 *
 * **It never derives a metric from the wrong input.** Basis needs a futures price and an index price. Where a venue
 * publishes only one of them the answer is null. Substituting the last trade for the index price would produce a basis
 * that looks entirely reasonable and is measuring something else.
 *
 * **It never treats a relationship as a cause.** `describeOi` says open interest rose while price rose. It does not say
 * why, and it does not say what happens next.
 */

export type ContractType = 'perpetual' | 'dated'

export type ContractStatus = 'trading' | 'halted' | 'settling' | 'expired' | 'unknown'

/** What a derivative contract is, from the venue's own metadata. */
export interface Contract {
  instrumentId: string
  /** The venue's symbol, kept for requests and diagnostics. */
  symbol: string
  base: string
  quote: string
  /** What is actually settled in. Not always the quote asset: a coin-margined contract settles in the base. */
  settlement: string
  contractType: ContractType
  status: ContractStatus
  /** When a dated contract expires. Null for a perpetual, which is what makes it perpetual. */
  expiresAt: number | null
  exchange: string
  provider: string
  /** Price and quantity steps, where the venue publishes them. Null rather than a guessed precision. */
  tickSize: number | null
  stepSize: number | null
  minNotional: number | null
}

/** Funding as the venue published it. */
export interface Funding {
  instrumentId: string
  /**
   * The rate for the current period, as a fraction. 0.0001 is one basis point.
   *
   * A fraction rather than a percentage, decided once here, because mixing the two is how a rate of 0.01% comes to be
   * displayed as 1%.
   */
  rate: number
  /** When the rate was read. */
  at: number
  /** When the next payment falls. Null when the venue did not say, and then there is no countdown. */
  nextAt: number | null
  /** How often funding falls, in milliseconds, where the venue publishes it. Null otherwise. */
  intervalMs: number | null
  source: string
}

/** One historical funding payment. */
export interface FundingPoint {
  at: number
  rate: number
}

/** Open interest as the venue published it. */
export interface OpenInterest {
  instrumentId: string
  /** Contracts outstanding, in base units. */
  amount: number
  /** Value of those contracts in the quote currency, where the venue publishes it or it can be derived from a real price. */
  notional: number | null
  at: number
  source: string
}

export interface OpenInterestPoint {
  at: number
  amount: number
  notional: number | null
}

/** The prices a venue values positions against. */
export interface MarkIndex {
  instrumentId: string
  /** What the venue values open positions at. Its number, never a substitute. */
  markPrice: number | null
  /** The composite spot price the venue references. */
  indexPrice: number | null
  /** The estimated settlement price, where the venue publishes one. */
  settlementPrice: number | null
  at: number
  source: string
}

/** One forced position closure the venue published. */
export interface Liquidation {
  instrumentId: string
  symbol: string
  /** The side of the order that closed the position: a long being liquidated is sold. */
  side: 'buy' | 'sell'
  price: number
  size: number
  /** price × size, in the quote currency. */
  notional: number
  at: number
  source: string
}

/** Positioning, only ever as the venue reports it. */
export interface LongShortRatio {
  instrumentId: string
  /** Longs divided by shorts. */
  ratio: number
  longShare: number
  shortShare: number
  at: number
  /** Whose positioning this counts: accounts, positions, or top traders. The venues differ and it matters. */
  basis: 'accounts' | 'positions' | 'topAccounts' | 'topPositions'
  source: string
}

// ---------------------------------------------------------------- derived, and only from real inputs

/**
 * The gap between what the future trades at and what the index says the spot is.
 *
 * Absolute and as a fraction of the index. Null when either price is missing, or when the index is not a usable
 * denominator — never computed against the last trade instead, which would be a different measurement wearing this name.
 */
export function basisOf(
  futuresPrice: number | null,
  indexPrice: number | null
): { absolute: number; fraction: number } | null {
  if (futuresPrice === null || indexPrice === null) return null
  if (!Number.isFinite(futuresPrice) || !Number.isFinite(indexPrice)) return null
  if (indexPrice <= 0) return null
  const absolute = futuresPrice - indexPrice
  return { absolute, fraction: absolute / indexPrice }
}

/**
 * Basis annualised for a dated contract.
 *
 * Only for a contract with an expiry, and only while it is in the future: annualising a basis over a period that has
 * already ended, or over zero time, produces either nonsense or infinity. Perpetuals are excluded by construction --
 * there is no time to expiry to annualise over, which is why funding exists instead.
 */
export function annualisedBasis(fraction: number | null, expiresAt: number | null, at: number): number | null {
  if (fraction === null || expiresAt === null) return null
  const remaining = expiresAt - at
  // Under an hour left, the annualisation factor explodes and the figure stops meaning anything.
  if (!(remaining > 3_600_000)) return null
  const years = remaining / (365 * 24 * 3_600_000)
  return fraction / years
}

/**
 * A funding rate expressed as the yearly equivalent.
 *
 * Needs the interval, because eight-hourly funding at one basis point is a very different yearly figure from hourly
 * funding at one basis point. Null without it, rather than assuming the common case.
 */
export function fundingAnnualised(rate: number, intervalMs: number | null): number | null {
  if (!Number.isFinite(rate) || intervalMs === null || !(intervalMs > 0)) return null
  const periods = (365 * 24 * 3_600_000) / intervalMs
  return rate * periods
}

/** Which side pays whom, in words, from the sign of the rate. */
export function fundingDirection(rate: number): 'longs-pay' | 'shorts-pay' | 'flat' {
  if (!Number.isFinite(rate) || rate === 0) return 'flat'
  return rate > 0 ? 'longs-pay' : 'shorts-pay'
}

/**
 * How long until the next funding payment.
 *
 * Null when the venue published no time. Zero -- never negative -- once the time has passed, because a countdown that
 * has gone by is a countdown waiting for the venue to publish the next one, not a negative amount of time. This is the
 * bug this function exists to prevent: a timer that keeps counting down past zero into minus figures.
 */
export function untilFunding(funding: Funding | null, at: number): number | null {
  if (!funding || funding.nextAt === null) return null
  if (!Number.isFinite(funding.nextAt)) return null
  return Math.max(0, funding.nextAt - at)
}

/**
 * Whether a published funding time can still be believed.
 *
 * A time that passed more than one funding interval ago means the venue has moved on and Orbis has an old answer. Said,
 * rather than shown as a countdown stuck at zero, which looks like the market has stopped.
 */
export function fundingStale(funding: Funding | null, at: number): boolean {
  if (!funding || funding.nextAt === null) return false
  const grace = funding.intervalMs ?? 3_600_000
  return at - funding.nextAt > grace
}

/** The change in open interest between two readings, absolute and as a fraction. */
export function oiChange(
  from: OpenInterestPoint | null,
  to: OpenInterestPoint | null
): { absolute: number; fraction: number | null } | null {
  if (!from || !to) return null
  if (!Number.isFinite(from.amount) || !Number.isFinite(to.amount)) return null
  const absolute = to.amount - from.amount
  // A fraction of zero is not a number. Reported as absent rather than as an infinite rise.
  return { absolute, fraction: from.amount > 0 ? absolute / from.amount : null }
}

/** The two readings that bound a period in a history, or null when the history does not cover it. */
export function overWindow(
  history: readonly OpenInterestPoint[],
  windowMs: number,
  at: number
): { from: OpenInterestPoint; to: OpenInterestPoint } | null {
  if (history.length < 2 || !(windowMs > 0)) return null
  const ordered = [...history].sort((a, b) => a.at - b.at)
  const to = ordered[ordered.length - 1]
  const wanted = at - windowMs
  // The earliest reading at or after the start of the window. Anything earlier would measure a longer period than asked.
  const from = ordered.find((one) => one.at >= wanted)
  if (!from || from.at >= to.at) return null
  return { from, to }
}

/**
 * Open interest and price, side by side.
 *
 * Deliberately descriptive. It says what both did over the same window and stops there: the readings are facts, and what
 * the combination implies about the next move is not one. No arrow, no signal, no "suggests".
 */
export function describeOi(
  oi: { absolute: number; fraction: number | null } | null,
  priceChangeFraction: number | null
): { oi: 'rising' | 'falling' | 'flat' | 'unknown'; price: 'rising' | 'falling' | 'flat' | 'unknown' } {
  const way = (value: number | null): 'rising' | 'falling' | 'flat' | 'unknown' => {
    if (value === null || !Number.isFinite(value)) return 'unknown'
    if (value > 0) return 'rising'
    if (value < 0) return 'falling'
    return 'flat'
  }
  return { oi: way(oi?.absolute ?? null), price: way(priceChangeFraction) }
}

/** Liquidations over a window, split by the side that was closed out. */
export interface LiquidationSummary {
  from: number
  to: number
  count: number
  /** Longs are closed by a sell. */
  longNotional: number
  shortNotional: number
  totalNotional: number
  largest: Liquidation | null
}

export function summariseLiquidations(
  events: readonly Liquidation[],
  windowMs: number,
  to = Date.now()
): LiquidationSummary {
  const from = windowMs > 0 ? to - windowMs : Number.NEGATIVE_INFINITY
  let longNotional = 0
  let shortNotional = 0
  let count = 0
  let largest: Liquidation | null = null
  for (const one of events) {
    if (!Number.isFinite(one.at) || one.at < from || one.at > to) continue
    if (!Number.isFinite(one.notional) || one.notional <= 0) continue
    count += 1
    // A long position is liquidated by selling it. The side on the wire is the side of the closing order.
    if (one.side === 'sell') longNotional += one.notional
    else shortNotional += one.notional
    if (!largest || one.notional > largest.notional) largest = one
  }
  return {
    from: windowMs > 0 ? to - windowMs : to,
    to,
    count,
    longNotional,
    shortNotional,
    totalNotional: longNotional + shortNotional,
    largest
  }
}

/**
 * Liquidations grouped by price, for a picture of where they happened.
 *
 * Where they *happened*, from published events — not where they might happen, which is a model and not data. A chart of
 * this must not be labelled a prediction of anything.
 */
export function liquidationsByPrice(
  events: readonly Liquidation[],
  bucket: number
): { price: number; count: number; longNotional: number; shortNotional: number }[] {
  if (!(bucket > 0)) return []
  const levels = new Map<number, { price: number; count: number; longNotional: number; shortNotional: number }>()
  for (const one of events) {
    if (!Number.isFinite(one.price) || one.price <= 0) continue
    const quotient = one.price / bucket
    const index = Math.floor(quotient + Math.abs(quotient) * 1e-9 + 1e-12)
    const key = Number((index * bucket).toFixed(10))
    const held = levels.get(key) ?? { price: key, count: 0, longNotional: 0, shortNotional: 0 }
    held.count += 1
    if (one.side === 'sell') held.longNotional += one.notional
    else held.shortNotional += one.notional
    levels.set(key, held)
  }
  return [...levels.values()].sort((a, b) => b.price - a.price)
}

/** How a rate reads on screen. A fraction in, a percentage out, with the sign kept. */
export function formatRate(rate: number | null, digits = 4): string {
  if (rate === null || !Number.isFinite(rate)) return '—'
  return `${rate >= 0 ? '+' : ''}${(rate * 100).toFixed(digits)}%`
}

/** A countdown as hours, minutes and seconds. Empty when there is nothing to count down to. */
export function asCountdown(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return ''
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** The windows the derivatives panels offer. Each is a real period a venue's history can cover. */
export const OI_WINDOWS = [
  { id: '1h', label: '1h', ms: 3_600_000 },
  { id: '4h', label: '4h', ms: 4 * 3_600_000 },
  { id: '24h', label: '24h', ms: 24 * 3_600_000 },
  { id: '7d', label: '7d', ms: 7 * 24 * 3_600_000 }
] as const

export const oiWindowMs = (id: string): number => OI_WINDOWS.find((one) => one.id === id)?.ms ?? OI_WINDOWS[2].ms
