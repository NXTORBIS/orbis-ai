import type { Candle } from './indicators.ts'

/**
 * Keeping the chart level with the price beside it.
 *
 * Candles are fetched once when a market is opened and were then never touched again, so the chart was a photograph:
 * the price in the header moved with every trade while the last candle sat exactly where it had been when the market
 * opened, and on a one-minute chart it stayed wrong for a minute at a time — and after that, for ever, because nothing
 * asked for the next candle either.
 *
 * A live chart does not re-fetch. Every trading screen does the same thing instead: the period that has not finished
 * yet is **built from the prices arriving**, and only the periods that have closed come from the provider. So a price
 * extends the current candle's high or low, moves its close, and when the clock crosses into the next period it opens
 * a new one at the price that opened it.
 *
 * Pure, and separate from the chart, because it is arithmetic about time buckets and the chart is a canvas. Everything
 * here is decided from the arguments: no clock, no fetch, no state.
 */

/** How long one period lasts, in milliseconds. Null when the label is not one this understands. */
export function intervalMs(interval: string): number | null {
  const match = /^(\d+)\s*([mhdwM])$/.exec(String(interval ?? '').trim())
  if (!match) return null
  const size = Number(match[1])
  if (!Number.isFinite(size) || size <= 0) return null
  // Capital M is a month and lower-case m is a minute, which is the one piece of this that has to be read carefully.
  const unit: Record<string, number> = {
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 7 * 86_400_000,
    M: 30 * 86_400_000
  }
  const ms = unit[match[2]]
  return ms === undefined ? null : size * ms
}

/**
 * The start of the period a moment falls in.
 *
 * Buckets are measured from the epoch, which is what the providers do, so a candle built here lines up with the ones
 * fetched rather than sitting half a period out of step with them.
 */
export function periodStart(at: number, everyMs: number): number {
  return Math.floor(at / everyMs) * everyMs
}

export interface LivePrice {
  price: number
  at: number
}

/**
 * The candles, with the newest one brought up to date by a price that has just arrived.
 *
 * Returns the same array when nothing changed, so a chart that redraws on identity does not redraw on every tick of a
 * market that has not moved.
 *
 * What it will not do:
 *
 * **It never edits a period that has closed.** Only the last candle is touched, and only while the price belongs to
 * its period. A price older than that is late rather than informative — it would rewrite a candle somebody has already
 * read, and the provider's own version of that period is the one to trust.
 *
 * **It never invents the periods in between.** If a price arrives long after the last candle — the market was closed,
 * the machine was asleep, the tab was hidden — it opens the period that price is actually in and leaves the gap. A run
 * of flat candles across a gap would be a picture of trading that did not happen.
 */
export function withLivePrice(candles: readonly Candle[], live: LivePrice, interval: string): Candle[] {
  const everyMs = intervalMs(interval)
  if (everyMs === null) return candles as Candle[]
  if (!Number.isFinite(live.price) || !Number.isFinite(live.at)) return candles as Candle[]
  if (candles.length === 0) return candles as Candle[]

  const last = candles[candles.length - 1]
  const bucket = periodStart(live.at, everyMs)

  // Late: it belongs to a period already closed, and that period's own record is better than this one price.
  if (bucket < last.time) return candles as Candle[]

  if (bucket === last.time) {
    const high = Math.max(last.high, live.price)
    const low = Math.min(last.low, live.price)
    if (high === last.high && low === last.low && last.close === live.price) return candles as Candle[]
    const updated: Candle = { ...last, high, low, close: live.price }
    return [...candles.slice(0, -1), updated]
  }

  /**
   * A new period. It opens at this price, which is the truth available: the real open is whatever traded first in the
   * period, and until the provider says otherwise the first price seen is the best answer there is.
   *
   * Volume is null rather than zero. Zero is a claim that nothing traded; null is the admission that this candle was
   * assembled here and nobody counted.
   */
  const fresh: Candle = { time: bucket, open: live.price, high: live.price, low: live.price, close: live.price, volume: null }
  return [...candles, fresh]
}

/**
 * Whether the newest candle is one this built rather than one the provider sent.
 *
 * So a chart can say which, if it wants to: a bar with no volume in a volume panel is otherwise a bar that looks like
 * a market that stopped trading.
 */
export function isLive(candles: readonly Candle[], now: number, interval: string): boolean {
  const everyMs = intervalMs(interval)
  if (everyMs === null || candles.length === 0) return false
  return candles[candles.length - 1].time === periodStart(now, everyMs)
}
