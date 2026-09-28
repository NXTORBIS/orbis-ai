import type { TradePrint } from './provider.ts'

/**
 * What the trade tape says once you look at more than one print.
 *
 * The tape itself is a list of trades the exchange published. This turns that list into the things somebody actually
 * wants from it: how much traded, how much of it was somebody buying in a hurry, which prints were large enough to
 * matter, and what it looks like grouped by price or by minute.
 *
 * Three rules, and the first one is the whole reason this file is careful.
 *
 * **An unclassified trade is never counted as a buy or a sell.** Aggressor side comes from the venue's buyer-maker flag.
 * Where a venue does not publish it, `side` is `unknown` — and unknown volume is reported as its own figure rather than
 * split, assumed, or quietly dropped. Every ratio here says what share of the volume it could classify, so a pressure
 * reading taken from a third of the tape cannot be read as a reading of the tape.
 *
 * **Aggregation is presentation, never data.** Grouping prints by price level or by minute produces a new object that
 * says it is aggregated and how many prints went into it. Nothing here edits, merges or discards a trade the exchange
 * published.
 *
 * **Nothing is annualised, extrapolated or predicted.** These are measurements of prints that already happened over a
 * window that is stated. What they imply about the next print is not a fact and is not in this file.
 */

/** What one print was worth: price times size. Null when either is missing, never zero. */
export function notionalOf(trade: TradePrint): number | null {
  if (!Number.isFinite(trade.price) || !Number.isFinite(trade.size)) return null
  if (trade.price <= 0 || trade.size <= 0) return null
  return trade.price * trade.size
}

/**
 * Whether a print is large.
 *
 * Measured in the quote currency, because size alone is not comparable across markets: one bitcoin and one dogecoin are
 * both "1". The threshold is somebody's choice and has no default — a universal figure would be wrong for every market
 * except the one it was picked for.
 */
export function isLarge(trade: TradePrint, thresholdNotional: number): boolean {
  if (!Number.isFinite(thresholdNotional) || thresholdNotional <= 0) return false
  const notional = notionalOf(trade)
  return notional !== null && notional >= thresholdNotional
}

export type TapeFilter = 'all' | 'buys' | 'sells' | 'large'

/**
 * The tape as somebody asked to see it.
 *
 * `buys` and `sells` show only prints the venue actually classified. An unclassified print is excluded from both rather
 * than appearing in one of them — a filter that guessed would be a filter that invents the thing it is filtering on.
 */
export function filterTape(trades: readonly TradePrint[], filter: TapeFilter, thresholdNotional = 0): TradePrint[] {
  switch (filter) {
    case 'buys':
      return trades.filter((one) => one.side === 'buy')
    case 'sells':
      return trades.filter((one) => one.side === 'sell')
    case 'large':
      return trades.filter((one) => isLarge(one, thresholdNotional))
    default:
      return [...trades]
  }
}

/**
 * A threshold that suits this market rather than a number picked in advance.
 *
 * The median print's notional times a multiple. Median rather than mean, because a tape with one enormous print would
 * otherwise set a threshold no other print could reach. Null when there is not enough of a tape to have a median, which
 * is the honest answer to "what counts as large here" after four trades.
 */
export function suggestedThreshold(trades: readonly TradePrint[], multiple = 10): number | null {
  const notionals = trades.map((one) => notionalOf(one)).filter((one): one is number => one !== null)
  if (notionals.length < 20) return null
  const sorted = [...notionals].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  if (!(median > 0)) return null
  return median * Math.max(1, multiple)
}

/** How much traded over a window, and how much of it was classifiable. */
export interface Pressure {
  /** The window actually measured, which may be shorter than the one asked for if the tape does not reach back. */
  from: number
  to: number
  /** Prints in the window. */
  count: number
  /** Quote-currency volume of prints the venue classified as buyer-aggressed. */
  buyNotional: number
  sellNotional: number
  /** Quote-currency volume the venue did not classify. Reported, never split. */
  unknownNotional: number
  /** Everything, classified or not. */
  totalNotional: number
  /**
   * Buy share of the volume that could be classified, 0 to 1.
   *
   * Null when nothing in the window was classified — which is not "fifty-fifty", it is "this venue did not say".
   */
  buyShare: number | null
  /** Buy minus sell, in the quote currency. Null for the same reason. */
  netNotional: number | null
  /**
   * What share of the volume the venue classified at all, 0 to 1.
   *
   * The figure that decides whether `buyShare` means anything. A pressure reading over a third of the tape is a reading
   * of a third of the tape, and the interface says so rather than rounding the caveat away.
   */
  classifiedShare: number | null
}

/**
 * Buy and sell pressure over a window.
 *
 * The window ends at `to` and runs back `windowMs`. Prints outside it are not counted — a "one minute" figure that
 * quietly included an hour would be the easiest possible way to mislead somebody with a real number.
 */
export function pressure(trades: readonly TradePrint[], windowMs: number, to = Date.now()): Pressure {
  const span = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 0
  const from = span > 0 ? to - span : Number.NEGATIVE_INFINITY
  let buyNotional = 0
  let sellNotional = 0
  let unknownNotional = 0
  let count = 0
  let earliest = to
  let latest = span > 0 ? from : to

  for (const trade of trades) {
    if (!Number.isFinite(trade.timestamp)) continue
    if (trade.timestamp < from || trade.timestamp > to) continue
    const notional = notionalOf(trade)
    if (notional === null) continue
    count += 1
    earliest = Math.min(earliest, trade.timestamp)
    latest = Math.max(latest, trade.timestamp)
    if (trade.side === 'buy') buyNotional += notional
    else if (trade.side === 'sell') sellNotional += notional
    else unknownNotional += notional
  }

  const classified = buyNotional + sellNotional
  const totalNotional = classified + unknownNotional
  return {
    // The window actually covered, so a tape that only reaches back thirty seconds cannot be read as a minute.
    from: count > 0 ? earliest : to,
    to: count > 0 ? latest : to,
    count,
    buyNotional,
    sellNotional,
    unknownNotional,
    totalNotional,
    buyShare: classified > 0 ? buyNotional / classified : null,
    netNotional: classified > 0 ? buyNotional - sellNotional : null,
    classifiedShare: totalNotional > 0 ? classified / totalNotional : null
  }
}

/** One price level of an aggregated tape. */
export interface PriceBucket {
  /** The bottom of the bucket. A print at exactly this price is in it. */
  price: number
  /** How many prints. Said, so a level made of one trade is not read as a level made of fifty. */
  count: number
  size: number
  notional: number
  buyNotional: number
  sellNotional: number
  unknownNotional: number
}

/**
 * The tape grouped by price.
 *
 * `bucket` is the price increment. A bucket of 10 puts 100.4 and 109.9 together at 100. The result is labelled
 * aggregated by its type and carries `count`, because a table of price levels looks exactly like an order book and must
 * not be mistaken for one: this is what traded, not what is resting.
 */
export function aggregateByPrice(trades: readonly TradePrint[], bucket: number): PriceBucket[] {
  if (!Number.isFinite(bucket) || bucket <= 0) return []
  const levels = new Map<number, PriceBucket>()
  for (const trade of trades) {
    const notional = notionalOf(trade)
    if (notional === null) continue
    // Which bucket, and the nudge that makes it the right one.
    //
    // `0.3 / 0.1` is 2.9999999999999996, so flooring it puts a price of 0.3 in the bucket below its own -- which showed up
    // as two levels for one price the first time this ran. The nudge is relative, so it cannot move a price that is
    // genuinely just under a boundary; and the key is snapped back onto the grid, because `3 * 0.1` is not 0.3 either.
    const quotient = trade.price / bucket
    const index = Math.floor(quotient + Math.abs(quotient) * 1e-9 + 1e-12)
    const key = Number((index * bucket).toFixed(10))
    const held =
      levels.get(key) ??
      { price: key, count: 0, size: 0, notional: 0, buyNotional: 0, sellNotional: 0, unknownNotional: 0 }
    held.count += 1
    held.size += trade.size
    held.notional += notional
    if (trade.side === 'buy') held.buyNotional += notional
    else if (trade.side === 'sell') held.sellNotional += notional
    else held.unknownNotional += notional
    levels.set(key, held)
  }
  return [...levels.values()].sort((a, b) => b.price - a.price)
}

/** One interval of an aggregated tape. */
export interface TimeBucket {
  /** The start of the interval, aligned to it. */
  at: number
  count: number
  size: number
  notional: number
  buyNotional: number
  sellNotional: number
  unknownNotional: number
  /** The first and last price in the interval, so a bar can be drawn from real prints. */
  open: number
  close: number
  high: number
  low: number
}

/**
 * The tape grouped by time.
 *
 * Aligned to the interval from the epoch, so two windows of the same tape produce the same buckets. An interval with no
 * prints is absent rather than present with zeros: nothing traded and nothing happened are the same fact, and a zero bar
 * would claim a price.
 */
export function aggregateByTime(trades: readonly TradePrint[], intervalMs: number): TimeBucket[] {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return []
  const buckets = new Map<number, TimeBucket>()
  // Chronological, so open and close mean what they say however the tape arrived.
  const ordered = [...trades]
    .filter((one) => Number.isFinite(one.timestamp) && notionalOf(one) !== null)
    .sort((a, b) => a.timestamp - b.timestamp)

  for (const trade of ordered) {
    const notional = notionalOf(trade) as number
    const at = Math.floor(trade.timestamp / intervalMs) * intervalMs
    const held = buckets.get(at)
    if (!held) {
      buckets.set(at, {
        at,
        count: 1,
        size: trade.size,
        notional,
        buyNotional: trade.side === 'buy' ? notional : 0,
        sellNotional: trade.side === 'sell' ? notional : 0,
        unknownNotional: trade.side === 'unknown' ? notional : 0,
        open: trade.price,
        close: trade.price,
        high: trade.price,
        low: trade.price
      })
      continue
    }
    held.count += 1
    held.size += trade.size
    held.notional += notional
    if (trade.side === 'buy') held.buyNotional += notional
    else if (trade.side === 'sell') held.sellNotional += notional
    else held.unknownNotional += notional
    held.close = trade.price
    held.high = Math.max(held.high, trade.price)
    held.low = Math.min(held.low, trade.price)
  }
  return [...buckets.values()].sort((a, b) => a.at - b.at)
}

/** What the visible tape adds up to. */
export interface TapeStats {
  count: number
  /** Base-asset size. */
  size: number
  /** Quote-currency value. */
  notional: number
  /** Null with no prints: the average of nothing is not zero. */
  averageNotional: number | null
  medianNotional: number | null
  largest: { notional: number; price: number; size: number; at: number; side: TradePrint['side'] } | null
  /** The window the prints actually span. Null with fewer than two. */
  from: number | null
  to: number | null
  /** Prints a second over the span. Null when the span is zero — dividing by it would produce Infinity. */
  perSecond: number | null
}

export function tapeStats(trades: readonly TradePrint[]): TapeStats {
  const notionals: number[] = []
  let size = 0
  let notional = 0
  let from: number | null = null
  let to: number | null = null
  let largest: TapeStats['largest'] = null

  for (const trade of trades) {
    const value = notionalOf(trade)
    if (value === null || !Number.isFinite(trade.timestamp)) continue
    notionals.push(value)
    size += trade.size
    notional += value
    from = from === null ? trade.timestamp : Math.min(from, trade.timestamp)
    to = to === null ? trade.timestamp : Math.max(to, trade.timestamp)
    if (!largest || value > largest.notional) {
      largest = { notional: value, price: trade.price, size: trade.size, at: trade.timestamp, side: trade.side }
    }
  }

  const count = notionals.length
  const sorted = [...notionals].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const span = from !== null && to !== null ? to - from : 0
  return {
    count,
    size,
    notional,
    averageNotional: count > 0 ? notional / count : null,
    medianNotional:
      count === 0 ? null : count % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle],
    largest,
    from,
    to,
    perSecond: span > 0 ? (count / span) * 1000 : null
  }
}

/**
 * How busy this is against how busy it usually is.
 *
 * A ratio, so 2 means twice the usual. Null when there is no baseline — which is different from 1, and an interface that
 * showed 1 for "we have nothing to compare against" would be claiming an ordinary day.
 */
export function relativeVolume(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return null
  return current / baseline
}

/** The windows the pressure control offers, and how long each is. */
export const PRESSURE_WINDOWS = [
  { id: '1m', label: '1m', ms: 60_000 },
  { id: '5m', label: '5m', ms: 5 * 60_000 },
  { id: '15m', label: '15m', ms: 15 * 60_000 },
  { id: '1h', label: '1h', ms: 60 * 60_000 }
] as const

export type PressureWindowId = (typeof PRESSURE_WINDOWS)[number]['id']

export const windowMsFor = (id: string): number =>
  PRESSURE_WINDOWS.find((one) => one.id === id)?.ms ?? PRESSURE_WINDOWS[0].ms

/**
 * What a pressure reading can honestly be called.
 *
 * A word for the interface, from the same numbers it is showing. `unclassified` is a real answer and the most important
 * one: it is what a venue that does not publish aggressor side produces, and it must not read as balance.
 */
export function describePressure(reading: Pressure): 'unclassified' | 'thin' | 'buying' | 'selling' | 'balanced' {
  if (reading.buyShare === null) return 'unclassified'
  // Under a tenth classified, the ratio is a fact about a tenth of the tape. Not shown as a market reading.
  if ((reading.classifiedShare ?? 0) < 0.1) return 'unclassified'
  if (reading.count < 5) return 'thin'
  if (reading.buyShare >= 0.6) return 'buying'
  if (reading.buyShare <= 0.4) return 'selling'
  return 'balanced'
}
