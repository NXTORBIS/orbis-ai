import type { PaperAccount, PaperFill, PaperPosition } from './paper.ts'
import { maxDrawdown, returnsOf, sharpe, sortino, standardDeviation, type Drawdown, type Periodicity } from './risk.ts'

/**
 * What a simulated account has actually done.
 *
 * Everything here is derived from fills that really happened in the simulation and from equity that was really recorded
 * while Orbis was running. Nothing is back-filled: if Orbis was closed for two days, the equity curve has a gap, and the
 * gap is the truth about what was observed rather than a straight line drawn between two Mondays.
 *
 * The distinction that shapes this file is **a fill is not a trade.** Buying twice and selling once is three fills and no
 * completed trade. A win rate counted over fills would call every sale that took any money a win, including the one that
 * closed half a losing position. So round trips are reconstructed first — a position opened and carried back to flat —
 * and every performance figure is counted over those.
 */

export interface RoundTrip {
  instrumentId: string
  /** Long or short, decided by the direction the position was carried in. */
  direction: 'long' | 'short'
  openedAt: number
  closedAt: number
  /** The quantity that went round, at the weighted average it was opened at. */
  quantity: number
  entryPrice: number
  exitPrice: number
  /** Profit or loss after the fees attributed to it. */
  net: number
  fees: number
  /** As a share of what was put in, so trades of different sizes can be compared. */
  returnPercent: number | null
  holdingMs: number
}

/**
 * Completed round trips, oldest first.
 *
 * Walks each instrument's fills in order and closes a trip whenever the position passes back through zero. A position that
 * is still open is not a trip: its profit has not happened yet, and counting it would let an unrealised loss hide by
 * simply not being sold.
 */
export function roundTrips(fills: PaperFill[]): RoundTrip[] {
  const byInstrument = new Map<string, PaperFill[]>()
  for (const fill of fills) {
    const held = byInstrument.get(fill.instrumentId) ?? []
    held.push(fill)
    byInstrument.set(fill.instrumentId, held)
  }

  const trips: RoundTrip[] = []
  for (const [instrumentId, list] of byInstrument) {
    const ordered = [...list].sort((a, b) => a.at - b.at)
    let quantity = 0
    let costBasis = 0
    let openedAt = 0
    let fees = 0
    let proceeds = 0
    let closedQuantity = 0

    for (const fill of ordered) {
      const signed = fill.side === 'buy' ? fill.quantity : -fill.quantity
      const opening = quantity === 0 || Math.sign(signed) === Math.sign(quantity)

      if (opening) {
        if (quantity === 0) {
          openedAt = fill.at
          fees = 0
          proceeds = 0
          closedQuantity = 0
          costBasis = 0
        }
        costBasis += fill.price * fill.quantity
        quantity += signed
        fees += fill.fee
        continue
      }

      // Closing, in whole or in part.
      const closing = Math.min(Math.abs(signed), Math.abs(quantity))
      proceeds += fill.price * closing
      closedQuantity += closing
      fees += fill.fee
      quantity += signed

      // Rounding in the simulation can leave a quantity that is not exactly zero. Treated as flat, because a position of
      // 1e-15 units is not a position anybody holds.
      if (Math.abs(quantity) > 1e-9) continue

      const direction = signed < 0 ? 'long' : 'short'
      const entryPrice = closedQuantity > 0 ? costBasis / closedQuantity : 0
      const exitPrice = closedQuantity > 0 ? proceeds / closedQuantity : 0
      const gross = direction === 'long' ? proceeds - costBasis : costBasis - proceeds
      const net = gross - fees
      const invested = entryPrice * closedQuantity
      trips.push({
        instrumentId,
        direction,
        openedAt,
        closedAt: fill.at,
        quantity: closedQuantity,
        entryPrice,
        exitPrice,
        net,
        fees,
        // Null rather than a division by nothing: a trip with no cost basis has no return to report.
        returnPercent: invested > 0 ? (net / invested) * 100 : null,
        holdingMs: Math.max(0, fill.at - openedAt)
      })
      quantity = 0
      costBasis = 0
      fees = 0
      proceeds = 0
      closedQuantity = 0
    }
  }
  return trips.sort((a, b) => a.closedAt - b.closedAt)
}

export interface Performance {
  trades: number
  wins: number
  losses: number
  breakEven: number
  /** Wins over completed trades, 0–100. Null when nothing has completed. */
  winRate: number | null
  averageWin: number | null
  averageLoss: number | null
  /** Gross winnings over gross losses. Null when nothing has been lost, because there is nothing to divide by. */
  profitFactor: number | null
  /** The average outcome of a trade, in the account's currency. */
  expectancy: number | null
  best: number | null
  worst: number | null
  /** Net profit and loss of everything completed. */
  netRealised: number
  feesPaid: number
  /** Median holding time, which describes a set of trades better than the mean when one was held for a month. */
  medianHoldingMs: number | null
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/**
 * How a set of completed trades did.
 *
 * Every ratio is null rather than a number when its denominator is missing. A win rate of 0% reads as "you lost
 * everything", which is a very different statement from "nothing has finished yet".
 */
export function performanceOf(trips: RoundTrip[]): Performance {
  const wins = trips.filter((t) => t.net > 0)
  const losses = trips.filter((t) => t.net < 0)
  const breakEven = trips.length - wins.length - losses.length
  const grossWin = wins.reduce((total, t) => total + t.net, 0)
  const grossLoss = Math.abs(losses.reduce((total, t) => total + t.net, 0))
  const net = trips.reduce((total, t) => total + t.net, 0)

  return {
    trades: trips.length,
    wins: wins.length,
    losses: losses.length,
    breakEven,
    winRate: trips.length > 0 ? (wins.length / trips.length) * 100 : null,
    averageWin: wins.length > 0 ? grossWin / wins.length : null,
    averageLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    // Nothing lost is not an infinite profit factor. It is a profit factor nobody can quote.
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: trips.length > 0 ? net / trips.length : null,
    best: trips.length > 0 ? Math.max(...trips.map((t) => t.net)) : null,
    worst: trips.length > 0 ? Math.min(...trips.map((t) => t.net)) : null,
    netRealised: net,
    feesPaid: trips.reduce((total, t) => total + t.fees, 0),
    medianHoldingMs: median(trips.map((t) => t.holdingMs))
  }
}

export interface Allocation {
  instrumentId: string
  /** Signed: negative for a short. */
  quantity: number
  /** What it is worth now, or null when the price is not known. */
  value: number | null
  /** Its share of the account, 0–100. Null when its value is unknown. */
  share: number | null
  averagePrice: number
  price: number | null
  unrealised: number | null
  unrealisedPercent: number | null
}

export interface AllocationView {
  positions: Allocation[]
  cash: number
  /** Cash as a share of what is known, 0–100. */
  cashShare: number | null
  /** Positions whose price is unknown, so a pie is never presented as whole when it is not. */
  unpriced: string[]
}

/**
 * What the account is holding, and in what proportion.
 *
 * A position with no price gets a null share rather than a zero one. Drawing it as nothing would shrink every other
 * slice to compensate, which is a chart that is wrong about the positions it *can* price.
 */
export function allocationOf(
  positions: PaperPosition[],
  cash: number,
  prices: Map<string, number | null>
): AllocationView {
  const unpriced: string[] = []
  const priced: { position: PaperPosition; price: number; value: number }[] = []

  for (const position of positions) {
    const price = prices.get(position.instrumentId) ?? null
    if (price === null || !Number.isFinite(price)) {
      unpriced.push(position.instrumentId)
      continue
    }
    priced.push({ position, price, value: price * position.quantity })
  }

  const known = priced.reduce((total, one) => total + Math.abs(one.value), 0) + Math.abs(cash)
  const shareOf = (value: number): number | null => (known > 0 ? (Math.abs(value) / known) * 100 : null)

  const byId = new Map(priced.map((one) => [one.position.instrumentId, one]))
  return {
    positions: positions.map((position) => {
      const found = byId.get(position.instrumentId)
      if (!found) {
        return {
          instrumentId: position.instrumentId,
          quantity: position.quantity,
          value: null,
          share: null,
          averagePrice: position.averagePrice,
          price: null,
          unrealised: null,
          unrealisedPercent: null
        }
      }
      const unrealised =
        position.quantity > 0
          ? (found.price - position.averagePrice) * position.quantity
          : (position.averagePrice - found.price) * Math.abs(position.quantity)
      const invested = position.averagePrice * Math.abs(position.quantity)
      return {
        instrumentId: position.instrumentId,
        quantity: position.quantity,
        value: found.value,
        share: shareOf(found.value),
        averagePrice: position.averagePrice,
        price: found.price,
        unrealised,
        unrealisedPercent: invested > 0 ? (unrealised / invested) * 100 : null
      }
    }),
    cash,
    cashShare: shareOf(cash),
    unpriced
  }
}

export interface Exposure {
  /** Everything at risk either way, as a value. */
  gross: number
  /** Longs minus shorts. */
  net: number
  long: number
  short: number
  /** Gross exposure over the account's total value, 0–100. Null when the total is not known or is zero. */
  grossPercent: number | null
  /** Positions that could not be valued, so the figures above are known to be partial. */
  unpriced: string[]
}

export function exposureOf(positions: PaperPosition[], prices: Map<string, number | null>, total: number): Exposure {
  let long = 0
  let short = 0
  const unpriced: string[] = []
  for (const position of positions) {
    const price = prices.get(position.instrumentId) ?? null
    if (price === null || !Number.isFinite(price)) {
      unpriced.push(position.instrumentId)
      continue
    }
    const value = price * Math.abs(position.quantity)
    if (position.quantity >= 0) long += value
    else short += value
  }
  const gross = long + short
  return {
    gross,
    net: long - short,
    long,
    short,
    grossPercent: total > 0 ? (gross / total) * 100 : null,
    unpriced
  }
}

/**
 * One reading of what the account was worth.
 *
 * Recorded while Orbis is running. There is no way to know what a simulated portfolio was worth while the application was
 * closed, so nothing is written for that time and the gap stays visible.
 */
export interface EquityPoint {
  at: number
  total: number
  cash: number
  realised: number
}

export interface EquityStats {
  points: number
  first: EquityPoint | null
  last: EquityPoint | null
  /** Change from the first reading to the last, as a percentage of the first. */
  changePercent: number | null
  drawdown: Drawdown
  /** Null when there are too few readings, or when the equity never moved. */
  sharpe: number | null
  sortino: number | null
  volatility: number | null
  /** How much of the period the readings actually cover, so a curve with a gap is not read as continuous. */
  coveredMs: number
}

/**
 * The statistics of an equity curve.
 *
 * `periodicity` describes how often readings are taken, which is what turns a standard deviation into an annualised one.
 * Getting it wrong does not make a number wrong-looking, it makes it wrong — so the caller states it rather than this
 * guessing from the timestamps.
 */
export function equityStats(points: EquityPoint[], periodicity: Periodicity = 'hourly'): EquityStats {
  const values = points.map((p) => p.total)
  const first = points[0] ?? null
  const last = points[points.length - 1] ?? null
  const returns = returnsOf(values)
  const deviation = standardDeviation(returns)

  return {
    points: points.length,
    first,
    last,
    // Two readings at least: one reading is a value, not a change, and reporting 0% for it would say the account has
    // gone nowhere when in truth it has not yet been watched.
    changePercent: points.length >= 2 && first && last && first.total > 0 ? ((last.total - first.total) / first.total) * 100 : null,
    drawdown: maxDrawdown(values),
    // These come from risk.ts, which treats an effectively flat series as having no meaningful ratio rather than
    // returning the enormous number that floating-point noise in the denominator produces.
    sharpe: sharpe(returns, periodicity),
    sortino: sortino(returns, periodicity),
    volatility: deviation,
    coveredMs: first && last ? Math.max(0, last.at - first.at) : 0
  }
}

/**
 * Whether a new reading is worth recording.
 *
 * Time alone is not enough: an idle account would fill the curve with identical points and make a flat line look like
 * activity. A reading is kept when enough time has passed **and** the value has actually moved, or when a trade has
 * changed what has been realised.
 */
export function shouldRecord(last: EquityPoint | null, next: EquityPoint, minGapMs = 60_000): boolean {
  if (!last) return true
  if (next.at - last.at < minGapMs) return false
  if (next.realised !== last.realised) return true
  if (last.total === 0) return next.total !== 0
  return Math.abs(next.total - last.total) / Math.abs(last.total) > 1e-6
}

export interface PortfolioView {
  value: { cash: number; total: number; unrealised: number; realised: number; fees: number; returnPercent: number }
  allocation: AllocationView
  exposure: Exposure
  performance: Performance
  trips: RoundTrip[]
  equity: EquityStats
}

/** Everything the portfolio screen shows, worked out in one place so two panels cannot disagree. */
export function portfolioView(
  account: PaperAccount,
  prices: Map<string, number | null>,
  equity: EquityPoint[],
  periodicity: Periodicity = 'hourly'
): Omit<PortfolioView, 'value'> {
  const trips = roundTrips(account.fills)
  const positionsValue = account.positions.reduce((total, position) => {
    const price = prices.get(position.instrumentId) ?? null
    return price === null || !Number.isFinite(price) ? total : total + price * position.quantity
  }, 0)
  return {
    allocation: allocationOf(account.positions, account.cash, prices),
    exposure: exposureOf(account.positions, prices, account.cash + positionsValue),
    performance: performanceOf(trips),
    trips,
    equity: equityStats(equity, periodicity)
  }
}
