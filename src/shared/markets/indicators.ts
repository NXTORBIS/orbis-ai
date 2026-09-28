/**
 * Technical indicators, calculated.
 *
 * Every one of these is arithmetic on real candles. Nothing here estimates, smooths over a gap, or asks a model what a
 * number should be -- an indicator that did any of those would be a line on a chart that looked like analysis and was not.
 *
 * Two rules throughout:
 *
 *  - **A period that has not happened yet is `null`, not zero.** A 200-day average does not exist on day 12. Returning 0
 *    there draws a line along the bottom of the chart and makes a crossover signal out of nothing.
 *  - **Arrays come back the same length as the input**, aligned index for index, so a caller can plot them against the
 *    candles without arithmetic on offsets. Getting that wrong shifts every indicator by a bar, which is invisible and
 *    changes every signal.
 */

export interface Candle {
  /** When the period opened, in milliseconds. */
  time: number
  open: number
  high: number
  low: number
  close: number
  /** Null when the provider does not report volume, which is not the same as no trading. */
  volume: number | null
}

export type Series = (number | null)[]

/** Closes, for the indicators that only need them. */
export const closes = (candles: Candle[]): number[] => candles.map((c) => c.close)

/**
 * Typical price: the middle of the bar.
 *
 * Used by the indicators that are about where trading happened rather than where it ended -- CCI, money flow, volume
 * profile. Averaging high, low and close is the convention; it is stated here so nobody has to guess which of the several
 * conventions this file uses.
 */
export const typical = (c: Candle): number => (c.high + c.low + c.close) / 3

// ---------------------------------------------------------------- averages

/** A simple moving average. Null until there are `period` values. */
export function sma(values: number[], period: number): Series {
  if (period <= 0) return values.map(() => null)
  const out: Series = new Array(values.length).fill(null)
  let running = 0
  for (let i = 0; i < values.length; i++) {
    running += values[i]
    if (i >= period) running -= values[i - period]
    if (i >= period - 1) out[i] = running / period
  }
  return out
}

/**
 * An exponential moving average.
 *
 * Seeded with the simple average of the first `period` values rather than with the first value alone. Seeding with one
 * value makes the first dozen points depend almost entirely on where the data happened to start, which is why two charts
 * of the same instrument over different ranges disagree about the same EMA.
 */
export function ema(values: number[], period: number): Series {
  if (period <= 0) return values.map(() => null)
  const out: Series = new Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let previous = 0
  for (let i = 0; i < period; i++) previous += values[i]
  previous /= period
  out[period - 1] = previous
  for (let i = period; i < values.length; i++) {
    previous = values[i] * k + previous * (1 - k)
    out[i] = previous
  }
  return out
}

/** A weighted moving average: the most recent value counts `period` times as much as the oldest. */
export function wma(values: number[], period: number): Series {
  if (period <= 0) return values.map(() => null)
  const out: Series = new Array(values.length).fill(null)
  const divisor = (period * (period + 1)) / 2
  for (let i = period - 1; i < values.length; i++) {
    let total = 0
    for (let n = 0; n < period; n++) total += values[i - n] * (period - n)
    out[i] = total / divisor
  }
  return out
}

/**
 * Wilder's smoothing, which RSI, ATR and ADX are all defined in terms of.
 *
 * Not the same as an EMA of the same period, though it is often written as one: Wilder's uses 1/period where an EMA uses
 * 2/(period+1). Using an EMA here gives numbers close enough to look right and different enough to be wrong, which is the
 * worst kind of difference.
 */
function wilder(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (period <= 0 || values.length < period) return out
  let previous = 0
  for (let i = 0; i < period; i++) previous += values[i]
  previous /= period
  out[period - 1] = previous
  for (let i = period; i < values.length; i++) {
    previous = (previous * (period - 1) + values[i]) / period
    out[i] = previous
  }
  return out
}

/**
 * The volume-weighted average price, from the start of the data given.
 *
 * VWAP is a session measure: it resets each trading day, and a VWAP run across a month of daily candles is not a VWAP at
 * all. `resetEachDay` does that reset; give it false only when the candles are already one session.
 *
 * Null wherever volume is unknown -- a volume-weighted number without volume is not a weaker version of itself, it is a
 * different number.
 */
export function vwap(candles: Candle[], resetEachDay = true): Series {
  const out: Series = new Array(candles.length).fill(null)
  let volumeSum = 0
  let priceVolumeSum = 0
  let day = ''
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (resetEachDay) {
      const today = new Date(c.time).toISOString().slice(0, 10)
      if (today !== day) {
        day = today
        volumeSum = 0
        priceVolumeSum = 0
      }
    }
    if (c.volume === null || !Number.isFinite(c.volume)) {
      out[i] = null
      continue
    }
    volumeSum += c.volume
    priceVolumeSum += typical(c) * c.volume
    out[i] = volumeSum > 0 ? priceVolumeSum / volumeSum : null
  }
  return out
}

// ---------------------------------------------------------------- momentum

/**
 * The relative strength index.
 *
 * 100 when there has not been a single down period yet -- which is right, and is why the guard is on the loss being zero
 * rather than a general division check. A flat market with no moves either way has no relative strength and answers null.
 */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null)
  if (values.length <= period || period <= 0) return out
  const gains: number[] = [0]
  const losses: number[] = [0]
  for (let i = 1; i < values.length; i++) {
    const move = values[i] - values[i - 1]
    gains.push(Math.max(0, move))
    losses.push(Math.max(0, -move))
  }
  // Wilder's averages, over the moves rather than the prices, starting at the first move.
  const avgGain = wilder(gains.slice(1), period)
  const avgLoss = wilder(losses.slice(1), period)
  for (let i = 0; i < avgGain.length; i++) {
    const g = avgGain[i]
    const l = avgLoss[i]
    if (g === null || l === null) continue
    if (g === 0 && l === 0) {
      out[i + 1] = null
      continue
    }
    out[i + 1] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return out
}

export interface Macd {
  macd: Series
  signal: Series
  histogram: Series
}

/** Moving average convergence/divergence: the gap between two EMAs, and an EMA of that gap. */
export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): Macd {
  const fastLine = ema(values, fast)
  const slowLine = ema(values, slow)
  const line: Series = values.map((_v, i) => {
    const f = fastLine[i]
    const s = slowLine[i]
    return f === null || s === null ? null : f - s
  })
  // The signal is an EMA of the MACD line, which only exists where the line does -- so it is taken over the defined part
  // and put back in place. Running an EMA over the nulls-as-zeros would drag the signal towards zero for `slow` bars.
  const firstDefined = line.findIndex((v) => v !== null)
  const signal: Series = new Array(values.length).fill(null)
  if (firstDefined >= 0) {
    const defined = line.slice(firstDefined) as number[]
    const smoothed = ema(defined, signalPeriod)
    for (let i = 0; i < smoothed.length; i++) signal[firstDefined + i] = smoothed[i]
  }
  const histogram: Series = values.map((_v, i) => {
    const m = line[i]
    const s = signal[i]
    return m === null || s === null ? null : m - s
  })
  return { macd: line, signal, histogram }
}

export interface Stochastic {
  k: Series
  d: Series
}

/** The stochastic oscillator: where the close sits in the recent range. */
export function stochastic(candles: Candle[], period = 14, smoothD = 3): Stochastic {
  const k: Series = new Array(candles.length).fill(null)
  for (let i = period - 1; i < candles.length; i++) {
    let high = -Infinity
    let low = Infinity
    for (let n = i - period + 1; n <= i; n++) {
      high = Math.max(high, candles[n].high)
      low = Math.min(low, candles[n].low)
    }
    // A range of nothing has no position in it. Null rather than 50, which would look like the middle of a range.
    k[i] = high === low ? null : ((candles[i].close - low) / (high - low)) * 100
  }
  const firstDefined = k.findIndex((v) => v !== null)
  const d: Series = new Array(candles.length).fill(null)
  if (firstDefined >= 0) {
    const defined = k.slice(firstDefined).map((v) => (v === null ? 0 : v))
    const smoothed = sma(defined, smoothD)
    for (let i = 0; i < smoothed.length; i++) d[firstDefined + i] = smoothed[i]
  }
  return { k, d }
}

/** Rate of change, as a percentage of the price `period` bars ago. */
export function roc(values: number[], period = 12): Series {
  const out: Series = new Array(values.length).fill(null)
  for (let i = period; i < values.length; i++) {
    const then = values[i - period]
    out[i] = then === 0 ? null : ((values[i] - then) / then) * 100
  }
  return out
}

/** Williams %R: the stochastic, from the top of the range instead of the bottom. */
export function williamsR(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null)
  for (let i = period - 1; i < candles.length; i++) {
    let high = -Infinity
    let low = Infinity
    for (let n = i - period + 1; n <= i; n++) {
      high = Math.max(high, candles[n].high)
      low = Math.min(low, candles[n].low)
    }
    out[i] = high === low ? null : ((high - candles[i].close) / (high - low)) * -100
  }
  return out
}

/** The commodity channel index. */
export function cci(candles: Candle[], period = 20): Series {
  const out: Series = new Array(candles.length).fill(null)
  const typicals = candles.map(typical)
  const means = sma(typicals, period)
  for (let i = period - 1; i < candles.length; i++) {
    const mean = means[i]
    if (mean === null) continue
    let deviation = 0
    for (let n = i - period + 1; n <= i; n++) deviation += Math.abs(typicals[n] - mean)
    deviation /= period
    out[i] = deviation === 0 ? null : (typicals[i] - mean) / (0.015 * deviation)
  }
  return out
}

// ---------------------------------------------------------------- volatility

export interface Bands {
  upper: Series
  middle: Series
  lower: Series
}

/** Bollinger Bands: a moving average and a number of standard deviations either side of it. */
export function bollinger(values: number[], period = 20, deviations = 2): Bands {
  const middle = sma(values, period)
  const upper: Series = new Array(values.length).fill(null)
  const lower: Series = new Array(values.length).fill(null)
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i]
    if (mean === null) continue
    let variance = 0
    for (let n = i - period + 1; n <= i; n++) variance += (values[n] - mean) ** 2
    // Population standard deviation, which is the convention for this indicator. The sample version gives visibly wider
    // bands at short periods.
    const sd = Math.sqrt(variance / period)
    upper[i] = mean + sd * deviations
    lower[i] = mean - sd * deviations
  }
  return { upper, middle, lower }
}

/** The true range of one bar: the largest of its own range and its gaps from the previous close. */
export function trueRange(candle: Candle, previous: Candle | undefined): number {
  if (!previous) return candle.high - candle.low
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previous.close),
    Math.abs(candle.low - previous.close)
  )
}

/** The average true range, by Wilder's smoothing, as it is defined. */
export function atr(candles: Candle[], period = 14): Series {
  const ranges = candles.map((c, i) => trueRange(c, candles[i - 1]))
  return wilder(ranges, period)
}

/** Keltner Channels: an EMA with ATR either side of it. */
export function keltner(candles: Candle[], period = 20, atrPeriod = 10, multiplier = 2): Bands {
  const middle = ema(closes(candles), period)
  const range = atr(candles, atrPeriod)
  const upper: Series = new Array(candles.length).fill(null)
  const lower: Series = new Array(candles.length).fill(null)
  for (let i = 0; i < candles.length; i++) {
    const m = middle[i]
    const r = range[i]
    if (m === null || r === null) continue
    upper[i] = m + r * multiplier
    lower[i] = m - r * multiplier
  }
  return { upper, middle, lower }
}

/** Historical volatility: the standard deviation of log returns, annualised. */
export function historicalVolatility(values: number[], period = 20, periodsPerYear = 252): Series {
  const out: Series = new Array(values.length).fill(null)
  const returns: number[] = [0]
  for (let i = 1; i < values.length; i++) {
    returns.push(values[i - 1] > 0 && values[i] > 0 ? Math.log(values[i] / values[i - 1]) : 0)
  }
  for (let i = period; i < values.length; i++) {
    let mean = 0
    for (let n = i - period + 1; n <= i; n++) mean += returns[n]
    mean /= period
    let variance = 0
    for (let n = i - period + 1; n <= i; n++) variance += (returns[n] - mean) ** 2
    // Sample standard deviation here, which is the convention for a volatility estimate from a sample of returns.
    out[i] = Math.sqrt(variance / (period - 1)) * Math.sqrt(periodsPerYear) * 100
  }
  return out
}

// ---------------------------------------------------------------- trend strength

export interface Adx {
  adx: Series
  plusDi: Series
  minusDi: Series
}

/** The average directional index, with its two directional indicators. */
export function adx(candles: Candle[], period = 14): Adx {
  const plusDm: number[] = [0]
  const minusDm: number[] = [0]
  const ranges: number[] = [candles.length ? candles[0].high - candles[0].low : 0]
  for (let i = 1; i < candles.length; i++) {
    const up = candles[i].high - candles[i - 1].high
    const down = candles[i - 1].low - candles[i].low
    plusDm.push(up > down && up > 0 ? up : 0)
    minusDm.push(down > up && down > 0 ? down : 0)
    ranges.push(trueRange(candles[i], candles[i - 1]))
  }
  const smoothRange = wilder(ranges, period)
  const smoothPlus = wilder(plusDm, period)
  const smoothMinus = wilder(minusDm, period)

  const plusDi: Series = new Array(candles.length).fill(null)
  const minusDi: Series = new Array(candles.length).fill(null)
  const dx: number[] = new Array(candles.length).fill(0)
  for (let i = 0; i < candles.length; i++) {
    const r = smoothRange[i]
    const p = smoothPlus[i]
    const m = smoothMinus[i]
    if (r === null || p === null || m === null || r === 0) continue
    plusDi[i] = (p / r) * 100
    minusDi[i] = (m / r) * 100
    const total = (plusDi[i] as number) + (minusDi[i] as number)
    dx[i] = total === 0 ? 0 : (Math.abs((plusDi[i] as number) - (minusDi[i] as number)) / total) * 100
  }
  const firstDx = plusDi.findIndex((v) => v !== null)
  const line: Series = new Array(candles.length).fill(null)
  if (firstDx >= 0) {
    const smoothed = wilder(dx.slice(firstDx), period)
    for (let i = 0; i < smoothed.length; i++) line[firstDx + i] = smoothed[i]
  }
  return { adx: line, plusDi, minusDi }
}

// ---------------------------------------------------------------- volume

/** On-balance volume. Null throughout when volume is unknown, rather than a flat line at zero. */
export function obv(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null)
  let running = 0
  for (let i = 0; i < candles.length; i++) {
    const v = candles[i].volume
    if (v === null || !Number.isFinite(v)) return out.map(() => null)
    if (i === 0) {
      out[i] = 0
      continue
    }
    const move = candles[i].close - candles[i - 1].close
    running += move > 0 ? v : move < 0 ? -v : 0
    out[i] = running
  }
  return out
}

/** The money flow index: RSI, weighted by how much money moved. */
export function mfi(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null)
  if (candles.some((c) => c.volume === null)) return out
  const flows = candles.map((c) => typical(c) * (c.volume as number))
  for (let i = period; i < candles.length; i++) {
    let positive = 0
    let negative = 0
    for (let n = i - period + 1; n <= i; n++) {
      const move = typical(candles[n]) - typical(candles[n - 1])
      if (move > 0) positive += flows[n]
      else if (move < 0) negative += flows[n]
    }
    if (positive === 0 && negative === 0) continue
    out[i] = negative === 0 ? 100 : 100 - 100 / (1 + positive / negative)
  }
  return out
}

/** Accumulation/distribution. */
export function accumulationDistribution(candles: Candle[]): Series {
  const out: Series = new Array(candles.length).fill(null)
  let running = 0
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (c.volume === null || !Number.isFinite(c.volume)) return out.map(() => null)
    const range = c.high - c.low
    const multiplier = range === 0 ? 0 : (c.close - c.low - (c.high - c.close)) / range
    running += multiplier * c.volume
    out[i] = running
  }
  return out
}

// ---------------------------------------------------------------- crossings

/**
 * Whether one series crossed another at index `i`.
 *
 * A crossing needs both bars defined on both series: a line that has only just begun has not crossed anything, and
 * treating its first value as a crossing invents a signal at the left edge of every chart.
 */
export function crossedAbove(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false
  const [aNow, aWas, bNow, bWas] = [a[i], a[i - 1], b[i], b[i - 1]]
  if (aNow === null || aWas === null || bNow === null || bWas === null) return false
  return aWas <= bWas && aNow > bNow
}

export function crossedBelow(a: Series, b: Series, i: number): boolean {
  if (i < 1) return false
  const [aNow, aWas, bNow, bWas] = [a[i], a[i - 1], b[i], b[i - 1]]
  if (aNow === null || aWas === null || bNow === null || bWas === null) return false
  return aWas >= bWas && aNow < bNow
}

/** A series of one repeated number, so a level can be crossed like any other line. */
export const level = (value: number, length: number): Series => new Array(length).fill(value)

// ---------------------------------------------------------------- what is on offer

export type IndicatorKind =
  | 'sma'
  | 'ema'
  | 'wma'
  | 'vwap'
  | 'rsi'
  | 'macd'
  | 'stochastic'
  | 'roc'
  | 'williamsR'
  | 'cci'
  | 'bollinger'
  | 'atr'
  | 'keltner'
  | 'adx'
  | 'obv'
  | 'mfi'
  | 'accumulationDistribution'
  | 'historicalVolatility'

export interface IndicatorInfo {
  kind: IndicatorKind
  name: string
  group: 'trend' | 'momentum' | 'volatility' | 'volume'
  /** Whether it needs volume. One that does is not offered for an instrument whose provider has none. */
  needsVolume: boolean
  /** Whether it needs the full bar rather than just the close. */
  needsOhlc: boolean
  /** Its own default period, and what the field is called. */
  defaults: Record<string, number>
}

/**
 * The catalogue.
 *
 * `needsVolume` is the part that matters: an indicator whose data the provider does not have must not be offered. Offering
 * it and drawing nothing is how a chart comes to have an empty pane somebody assumes is a bug, and offering it and
 * drawing zeros would be worse.
 */
export const INDICATORS: IndicatorInfo[] = [
  { kind: 'sma', name: 'Simple moving average', group: 'trend', needsVolume: false, needsOhlc: false, defaults: { period: 20 } },
  { kind: 'ema', name: 'Exponential moving average', group: 'trend', needsVolume: false, needsOhlc: false, defaults: { period: 20 } },
  { kind: 'wma', name: 'Weighted moving average', group: 'trend', needsVolume: false, needsOhlc: false, defaults: { period: 20 } },
  { kind: 'vwap', name: 'Volume-weighted average price', group: 'trend', needsVolume: true, needsOhlc: true, defaults: {} },
  { kind: 'macd', name: 'MACD', group: 'trend', needsVolume: false, needsOhlc: false, defaults: { fast: 12, slow: 26, signal: 9 } },
  { kind: 'adx', name: 'Average directional index', group: 'trend', needsVolume: false, needsOhlc: true, defaults: { period: 14 } },
  { kind: 'rsi', name: 'Relative strength index', group: 'momentum', needsVolume: false, needsOhlc: false, defaults: { period: 14 } },
  { kind: 'stochastic', name: 'Stochastic', group: 'momentum', needsVolume: false, needsOhlc: true, defaults: { period: 14, smoothD: 3 } },
  { kind: 'roc', name: 'Rate of change', group: 'momentum', needsVolume: false, needsOhlc: false, defaults: { period: 12 } },
  { kind: 'williamsR', name: 'Williams %R', group: 'momentum', needsVolume: false, needsOhlc: true, defaults: { period: 14 } },
  { kind: 'cci', name: 'Commodity channel index', group: 'momentum', needsVolume: false, needsOhlc: true, defaults: { period: 20 } },
  { kind: 'bollinger', name: 'Bollinger Bands', group: 'volatility', needsVolume: false, needsOhlc: false, defaults: { period: 20, deviations: 2 } },
  { kind: 'atr', name: 'Average true range', group: 'volatility', needsVolume: false, needsOhlc: true, defaults: { period: 14 } },
  { kind: 'keltner', name: 'Keltner Channels', group: 'volatility', needsVolume: false, needsOhlc: true, defaults: { period: 20, atrPeriod: 10, multiplier: 2 } },
  { kind: 'historicalVolatility', name: 'Historical volatility', group: 'volatility', needsVolume: false, needsOhlc: false, defaults: { period: 20 } },
  { kind: 'obv', name: 'On-balance volume', group: 'volume', needsVolume: true, needsOhlc: true, defaults: {} },
  { kind: 'mfi', name: 'Money flow index', group: 'volume', needsVolume: true, needsOhlc: true, defaults: { period: 14 } },
  { kind: 'accumulationDistribution', name: 'Accumulation/distribution', group: 'volume', needsVolume: true, needsOhlc: true, defaults: {} }
]

export const indicatorInfo = (kind: IndicatorKind): IndicatorInfo | undefined =>
  INDICATORS.find((i) => i.kind === kind)

/** Which indicators can honestly be drawn for these candles. */
export function availableIndicators(candles: Candle[]): IndicatorInfo[] {
  const hasVolume = candles.length > 0 && candles.every((c) => c.volume !== null && Number.isFinite(c.volume))
  return INDICATORS.filter((i) => !i.needsVolume || hasVolume)
}

/**
 * Runs one indicator by name.
 *
 * One entry point, so a saved chart layout can hold `{kind, options}` rather than code, and so a caller cannot ask for an
 * indicator that does not exist. Returns named series because several indicators produce more than one line, and a caller
 * plotting them needs to know which is which.
 */
export function calculate(
  kind: IndicatorKind,
  candles: Candle[],
  options: Record<string, number> = {}
): Record<string, Series> {
  const value = closes(candles)
  const n = (name: string, fallback: number): number => {
    const given = options[name]
    return typeof given === 'number' && Number.isFinite(given) && given > 0 ? Math.round(given) : fallback
  }
  switch (kind) {
    case 'sma':
      return { sma: sma(value, n('period', 20)) }
    case 'ema':
      return { ema: ema(value, n('period', 20)) }
    case 'wma':
      return { wma: wma(value, n('period', 20)) }
    case 'vwap':
      return { vwap: vwap(candles) }
    case 'rsi':
      return { rsi: rsi(value, n('period', 14)) }
    case 'macd': {
      const m = macd(value, n('fast', 12), n('slow', 26), n('signal', 9))
      return { macd: m.macd, signal: m.signal, histogram: m.histogram }
    }
    case 'stochastic': {
      const s = stochastic(candles, n('period', 14), n('smoothD', 3))
      return { k: s.k, d: s.d }
    }
    case 'roc':
      return { roc: roc(value, n('period', 12)) }
    case 'williamsR':
      return { williamsR: williamsR(candles, n('period', 14)) }
    case 'cci':
      return { cci: cci(candles, n('period', 20)) }
    case 'bollinger': {
      const b = bollinger(value, n('period', 20), n('deviations', 2))
      return { upper: b.upper, middle: b.middle, lower: b.lower }
    }
    case 'atr':
      return { atr: atr(candles, n('period', 14)) }
    case 'keltner': {
      const k = keltner(candles, n('period', 20), n('atrPeriod', 10), n('multiplier', 2))
      return { upper: k.upper, middle: k.middle, lower: k.lower }
    }
    case 'adx': {
      const a = adx(candles, n('period', 14))
      return { adx: a.adx, plusDi: a.plusDi, minusDi: a.minusDi }
    }
    case 'obv':
      return { obv: obv(candles) }
    case 'mfi':
      return { mfi: mfi(candles, n('period', 14)) }
    case 'accumulationDistribution':
      return { ad: accumulationDistribution(candles) }
    case 'historicalVolatility':
      return { historicalVolatility: historicalVolatility(value, n('period', 20)) }
  }
}
