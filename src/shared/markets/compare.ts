import type { Candle } from './indicators.ts'
import { correlation, maxDrawdown, returnsOf, sharpe, standardDeviation, type Periodicity } from './risk.ts'

/**
 * Several markets, side by side.
 *
 * One rule decides the whole design: **absolute prices are not comparable between markets.** Bitcoin at 84,000 and
 * Solana at 190 on the same axis tells you nothing except which has the larger number, and drawing them together implies
 * a comparison that is not being made. So every comparison here is indexed — each series starts at 100 and what is shown
 * is how far each has moved, which is the thing that can honestly be put on one chart.
 *
 * The second rule: **aligned observations, or no answer.** Correlation between two series sampled at different moments
 * is a number computed from a mismatch. Every function below aligns by timestamp first and refuses when too little
 * overlaps, rather than producing a figure from whatever happened to line up.
 */

/** One market's series, as it arrives. */
export interface CompareSeries {
  instrumentId: string
  symbol: string
  candles: Candle[]
}

/** One point of an indexed series. */
export interface IndexedPoint {
  at: number
  /** The close, rebased so the first observation is 100. */
  value: number
  /** How far from the start, as a percentage. `value` minus 100. */
  changePercent: number
}

export interface IndexedSeries {
  instrumentId: string
  symbol: string
  points: IndexedPoint[]
  /** The price it was rebased from, so the indexing can be undone and checked. */
  base: number | null
  /** Total move over the compared window, as a percentage. Null with too little data. */
  totalPercent: number | null
}

/**
 * The moments every series has in common.
 *
 * An intersection, not a union: a timestamp one market has and another does not cannot be compared, and filling the gap
 * would be inventing a price. Returned sorted, so everything built from it is chronological.
 */
export function alignedTimes(series: readonly CompareSeries[]): number[] {
  if (series.length === 0) return []
  const sets = series.map((one) => new Set(one.candles.map((candle) => candle.time)))
  const [first, ...rest] = sets
  const common: number[] = []
  for (const time of first) {
    if (rest.every((set) => set.has(time))) common.push(time)
  }
  return common.sort((a, b) => a - b)
}

/**
 * Every series rebased to 100 at the first aligned moment.
 *
 * The only honest way to put markets of different prices on one chart. A series whose first aligned close is not a usable
 * price is returned with no points rather than rebased against something meaningless.
 */
export function indexSeries(series: readonly CompareSeries[]): IndexedSeries[] {
  const times = alignedTimes(series)
  return series.map((one) => {
    const byTime = new Map(one.candles.map((candle) => [candle.time, candle]))
    const first = times.length > 0 ? byTime.get(times[0])?.close : undefined
    const base = typeof first === 'number' && Number.isFinite(first) && first > 0 ? first : null
    if (base === null) {
      return { instrumentId: one.instrumentId, symbol: one.symbol, points: [], base: null, totalPercent: null }
    }
    const points: IndexedPoint[] = []
    for (const at of times) {
      const close = byTime.get(at)?.close
      if (typeof close !== 'number' || !Number.isFinite(close)) continue
      const value = (close / base) * 100
      points.push({ at, value, changePercent: value - 100 })
    }
    return {
      instrumentId: one.instrumentId,
      symbol: one.symbol,
      points,
      base,
      totalPercent: points.length > 1 ? points[points.length - 1].changePercent : null
    }
  })
}

/** The fewest overlapping observations worth computing a statistic from. Below this the answer is noise. */
export const MINIMUM_OBSERVATIONS = 30

export interface CompareStat {
  instrumentId: string
  symbol: string
  /** Total move over the compared window, as a percentage. */
  totalPercent: number | null
  /** Standard deviation of the aligned returns, annualised. Null with too few observations. */
  volatility: number | null
  /** The worst peak-to-trough fall over the window, as a percentage. */
  maxDrawdownPercent: number | null
  sharpe: number | null
  /** How many aligned observations went into all of the above. */
  observations: number
}

/**
 * Each market's own figures, over exactly the same moments.
 *
 * The same window for every one of them, which is what makes the row-to-row comparison mean anything: two volatilities
 * measured over different stretches are two different measurements.
 */
export function compareStats(series: readonly CompareSeries[], periodicity: Periodicity = 'daily'): CompareStat[] {
  const indexed = indexSeries(series)
  return indexed.map((one) => {
    const values = one.points.map((point) => point.value)
    const observations = values.length
    if (observations < MINIMUM_OBSERVATIONS) {
      return {
        instrumentId: one.instrumentId,
        symbol: one.symbol,
        totalPercent: one.totalPercent,
        // Said as unknown rather than computed from a handful of points, which would look exactly as authoritative.
        volatility: null,
        maxDrawdownPercent: null,
        sharpe: null,
        observations
      }
    }
    const returns = returnsOf(values)
    const deviation = standardDeviation(returns)
    const periods = periodicity === 'daily' ? 252 : periodicity === 'weekly' ? 52 : periodicity === 'monthly' ? 12 : 252 * 6.5
    return {
      instrumentId: one.instrumentId,
      symbol: one.symbol,
      totalPercent: one.totalPercent,
      volatility: deviation === null ? null : deviation * Math.sqrt(periods) * 100,
      maxDrawdownPercent: maxDrawdown(values).maxPercent,
      sharpe: sharpe(returns, periodicity),
      observations
    }
  })
}

export interface CorrelationCell {
  a: string
  b: string
  /** Null when too few aligned observations overlap. Never a number from a mismatch. */
  value: number | null
  observations: number
}

/**
 * How each pair moved together, over the moments they share.
 *
 * Computed from aligned returns and nothing else. Two series sampled at different times produce null, which is the
 * honest answer — a correlation from mismatched observations is a real number describing nothing.
 */
export function correlationMatrix(series: readonly CompareSeries[]): CorrelationCell[] {
  const indexed = indexSeries(series)
  const returns = new Map(indexed.map((one) => [one.instrumentId, returnsOf(one.points.map((point) => point.value))]))
  const cells: CorrelationCell[] = []
  for (let i = 0; i < indexed.length; i++) {
    for (let j = i; j < indexed.length; j++) {
      const left = returns.get(indexed[i].instrumentId) ?? []
      const right = returns.get(indexed[j].instrumentId) ?? []
      const observations = Math.min(left.length, right.length)
      cells.push({
        a: indexed[i].symbol,
        b: indexed[j].symbol,
        value:
          observations >= MINIMUM_OBSERVATIONS
            ? correlation(left.slice(-observations), right.slice(-observations))
            : null,
        observations
      })
    }
  }
  return cells
}

/** The most markets that can usefully be compared at once. Beyond this a chart is unreadable and a matrix unusable. */
export const MAX_COMPARED = 6

/** What a comparison assumed, so no chart from it is read as a price chart. */
export const COMPARE_ASSUMPTIONS: string[] = [
  'Every series is rebased to 100 at the start of the compared window.',
  'Only moments every market has in common are used. Gaps are not filled.',
  `Statistics need at least ${MINIMUM_OBSERVATIONS} aligned observations; below that they are shown as unavailable.`,
  'Absolute prices are not compared, because prices of different markets are not comparable.'
]
