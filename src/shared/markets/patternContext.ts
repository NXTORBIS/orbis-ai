import { rollingStats } from './candleGeometry.ts'
import { adx, atr, closes, macd, rsi, sma, type Candle } from './indicators.ts'
import type { PatternDetection } from './patternDetect.ts'
import type { PatternDirection } from './patterns.ts'

/**
 * What was going on around a formation, measured.
 *
 * A Hammer at the bottom of a long decline, on twice the usual volume, sitting on a level the market has turned at
 * three times before, is a different observation from the same shape in the middle of a quiet afternoon. Nothing in
 * this file changes whether the Hammer was detected -- that is settled by `patternDetect.ts` and nothing here may
 * reach back into it. This describes the surroundings.
 *
 * Three rules.
 *
 * **Context never manufactures a pattern.** Every function here runs after detection and adds description. A detector
 * that quietly became more willing to see a Hammer because volume was high would be a detector nobody could audit,
 * and its output would no longer mean what its definition says.
 *
 * **Unavailable is a real answer and it is not neutral.** Where a market reports no volume, the volume context is
 * `unavailable`, not "average". Where there is too little history to place a support level, it is `unclear`, not "no
 * support nearby". Inventing the absent reading is the single most effective way to make an analysis look complete
 * and be wrong.
 *
 * **Agreement and disagreement are both reported, and neither is scored into a verdict.** A bullish formation under a
 * ceiling on falling volume gets a conflict list, not a number that averages the ceiling against the shape. Averaging
 * them produces a figure that is neither observation and reads like a recommendation.
 */

// ---------------------------------------------------------------- market structure

export interface Swing {
  index: number
  time: number
  price: number
  kind: 'high' | 'low'
}

/**
 * The turning points, found by requiring a candle to be the extreme of a window centred on it.
 *
 * `strength` is how many candles either side must be lower (or higher). A larger number finds fewer, more significant
 * turns. The last `strength` candles can never qualify, because the window extends past the end of what is known --
 * so a swing is never claimed on data that has not arrived, which is the usual way a structure reading flatters
 * itself.
 */
export function swings(candles: readonly Candle[], strength = 2): Swing[] {
  const found: Swing[] = []
  if (candles.length < strength * 2 + 1) return found

  for (let i = strength; i < candles.length - strength; i += 1) {
    const one = candles[i] as Candle
    let isHigh = true
    let isLow = true
    for (let j = i - strength; j <= i + strength; j += 1) {
      if (j === i) continue
      const other = candles[j] as Candle
      // Strictly higher, not higher-or-equal. Demanding strict superiority over equals would mean a flat top --
      // two candles reaching exactly the same price -- produced no swing at all, and a double top at one price is
      // precisely the shape somebody is looking for.
      if (other.high > one.high) isHigh = false
      if (other.low < one.low) isLow = false
    }
    // A plateau is one turning point, not several. The earliest candle of the tie is the one that counts, which is
    // arbitrary but deterministic -- and a rule that picked differently between runs would move levels around.
    if (isHigh) {
      for (let j = i - strength; j < i; j += 1) {
        if ((candles[j] as Candle).high === one.high) isHigh = false
      }
    }
    if (isLow) {
      for (let j = i - strength; j < i; j += 1) {
        if ((candles[j] as Candle).low === one.low) isLow = false
      }
    }
    if (isHigh) found.push({ index: i, time: one.time, price: one.high, kind: 'high' })
    if (isLow) found.push({ index: i, time: one.time, price: one.low, kind: 'low' })
  }
  return found
}

export type StructureShape = 'higher-highs-and-lows' | 'lower-highs-and-lows' | 'range' | 'contracting' | 'expanding' | 'unclear'

export interface Structure {
  shape: StructureShape
  swings: Swing[]
  /** The most recent confirmed break of a prior swing, where there is one. */
  lastBreak: { at: number; price: number; direction: 'up' | 'down'; describe: string } | null
  describe: string
}

/** The shape of the recent turning points: whether the market is stepping up, stepping down, or going nowhere. */
export function structureOf(candles: readonly Candle[], strength = 2): Structure {
  const found = swings(candles, strength)
  const highs = found.filter((one) => one.kind === 'high').slice(-3)
  const lows = found.filter((one) => one.kind === 'low').slice(-3)

  if (highs.length < 2 || lows.length < 2) {
    return { shape: 'unclear', swings: found, lastBreak: null, describe: `Only ${highs.length} swing high${highs.length === 1 ? '' : 's'} and ${lows.length} swing low${lows.length === 1 ? '' : 's'} are visible, which is too few to describe the structure.` }
  }

  const rising = (list: Swing[]): boolean => list.every((one, i) => i === 0 || one.price > (list[i - 1] as Swing).price)
  const falling = (list: Swing[]): boolean => list.every((one, i) => i === 0 || one.price < (list[i - 1] as Swing).price)

  const highsUp = rising(highs)
  const highsDown = falling(highs)
  const lowsUp = rising(lows)
  const lowsDown = falling(lows)

  const shape: StructureShape = highsUp && lowsUp
    ? 'higher-highs-and-lows'
    : highsDown && lowsDown
      ? 'lower-highs-and-lows'
      : highsDown && lowsUp
        ? 'contracting'
        : highsUp && lowsDown
          ? 'expanding'
          : 'range'

  // A break is the latest close beyond the most recent swing that preceded it.
  let lastBreak: Structure['lastBreak'] = null
  const lastHigh = highs[highs.length - 1] as Swing
  const lastLow = lows[lows.length - 1] as Swing
  for (let i = candles.length - 1; i >= 0; i -= 1) {
    const one = candles[i] as Candle
    if (i > lastHigh.index && one.close > lastHigh.price) {
      lastBreak = { at: one.time, price: lastHigh.price, direction: 'up', describe: `A close at ${one.close} took out the swing high at ${lastHigh.price}.` }
      break
    }
    if (i > lastLow.index && one.close < lastLow.price) {
      lastBreak = { at: one.time, price: lastLow.price, direction: 'down', describe: `A close at ${one.close} took out the swing low at ${lastLow.price}.` }
      break
    }
  }

  const words: Record<StructureShape, string> = {
    'higher-highs-and-lows': 'The market has been making higher highs and higher lows.',
    'lower-highs-and-lows': 'The market has been making lower highs and lower lows.',
    range: 'The swing points are not stepping consistently in either direction.',
    contracting: 'The highs are falling and the lows rising: the range is narrowing.',
    expanding: 'The highs are rising and the lows falling: the range is widening.',
    unclear: 'There are too few turning points to describe the structure.'
  }

  return { shape, swings: found, lastBreak, describe: words[shape] }
}

// ---------------------------------------------------------------- support and resistance

export interface Level {
  price: number
  /** How many separate swings formed at this level. One touch is not a level. */
  touches: number
  kind: 'support' | 'resistance'
  /** The times the market turned here. */
  at: number[]
}

export interface LevelContext {
  nearestSupport: Level | null
  nearestResistance: Level | null
  /** Distance as a share of the current price, so it is comparable across markets. */
  toSupport: number | null
  toResistance: number | null
  /** Where the formation sits: right at a level, between them, or with nothing to go on. */
  placement: 'at-support' | 'at-resistance' | 'between' | 'unclear'
  describe: string
}

/** How many swings must share a price before Orbis will call it a level rather than a coincidence. */
export const MINIMUM_LEVEL_TOUCHES = 2

/**
 * Levels the market has actually turned at, and where a price sits among them.
 *
 * Built only from observed swing points, clustered by proximity. A single turn is not a level and is not reported as
 * one: with enough tolerance every price is "near support", which is how a support reading becomes decoration. Where
 * nothing clears the bar, the placement is `unclear` and both levels are null -- the honest answer, and not the same
 * as saying the price is in open space.
 */
export function levelsAround(candles: readonly Candle[], price: number, options: { strength?: number; clusterTolerance?: number } = {}): LevelContext {
  const strength = options.strength ?? 2
  const tolerance = options.clusterTolerance ?? 0.004
  const found = swings(candles, strength)

  if (found.length === 0 || !Number.isFinite(price) || price <= 0) {
    return { nearestSupport: null, nearestResistance: null, toSupport: null, toResistance: null, placement: 'unclear', describe: 'There are not enough turning points to place a level.' }
  }

  // Cluster swings whose prices are within tolerance of each other.
  const clusters: { prices: number[]; times: number[]; kinds: ('high' | 'low')[] }[] = []
  for (const one of [...found].sort((a, b) => a.price - b.price)) {
    const last = clusters[clusters.length - 1]
    const mean = last === undefined ? null : last.prices.reduce((a, b) => a + b, 0) / last.prices.length
    if (mean !== null && Math.abs(one.price - mean) / mean <= tolerance) {
      last?.prices.push(one.price)
      last?.times.push(one.time)
      last?.kinds.push(one.kind)
    } else {
      clusters.push({ prices: [one.price], times: [one.time], kinds: [one.kind] })
    }
  }

  const levels: Level[] = clusters
    .filter((one) => one.prices.length >= MINIMUM_LEVEL_TOUCHES)
    .map((one) => {
      const mean = one.prices.reduce((a, b) => a + b, 0) / one.prices.length
      return { price: mean, touches: one.prices.length, kind: mean < price ? ('support' as const) : ('resistance' as const), at: one.times }
    })

  if (levels.length === 0) {
    return {
      nearestSupport: null,
      nearestResistance: null,
      toSupport: null,
      toResistance: null,
      placement: 'unclear',
      describe: `No price has been turned at more than once in this history, so there is no level to report. ${found.length} turning point${found.length === 1 ? '' : 's'} were found and none repeated.`
    }
  }

  const supports = levels.filter((one) => one.kind === 'support')
  const resistances = levels.filter((one) => one.kind === 'resistance')
  const nearestSupport = supports.length === 0 ? null : supports.reduce((a, b) => (price - a.price <= price - b.price ? a : b))
  const nearestResistance = resistances.length === 0 ? null : resistances.reduce((a, b) => (a.price - price <= b.price - price ? a : b))

  const toSupport = nearestSupport === null ? null : (price - nearestSupport.price) / price
  const toResistance = nearestResistance === null ? null : (nearestResistance.price - price) / price
  const near = 0.005

  const placement: LevelContext['placement'] =
    toSupport !== null && toSupport <= near && (toResistance === null || toSupport <= toResistance)
      ? 'at-support'
      : toResistance !== null && toResistance <= near
        ? 'at-resistance'
        : 'between'

  const parts: string[] = []
  if (nearestSupport !== null) parts.push(`support at ${Number(nearestSupport.price.toPrecision(8))} (${nearestSupport.touches} touches, ${((toSupport as number) * 100).toFixed(2)}% below)`)
  if (nearestResistance !== null) parts.push(`resistance at ${Number(nearestResistance.price.toPrecision(8))} (${nearestResistance.touches} touches, ${((toResistance as number) * 100).toFixed(2)}% above)`)

  return {
    nearestSupport,
    nearestResistance,
    toSupport,
    toResistance,
    placement,
    describe: parts.length === 0 ? 'No level was found on either side of this price.' : `Nearest ${parts.join('; ')}.`
  }
}

// ---------------------------------------------------------------- volume

export type VolumeReading = 'unavailable' | 'well-below-average' | 'below-average' | 'average' | 'above-average' | 'well-above-average'

export interface VolumeContext {
  reading: VolumeReading
  /** The formation's volume as a multiple of the recent median. Null when the venue reported none. */
  relative: number | null
  /** How many of the compared candles actually reported a volume. */
  sample: number
  describe: string
}

/**
 * How much traded through the formation, against what usually trades.
 *
 * `unavailable` where the venue reported no volume, and that is deliberately not folded into `average`. A pattern on
 * a market with no volume data is a pattern with no volume context, and a screen saying "average volume" about a
 * market that publishes none is making something up.
 */
export function volumeContext(candles: readonly Candle[], from: number, to: number, window = 20): VolumeContext {
  const formation = candles.slice(from, to + 1)
  const reported = formation.map((one) => one.volume).filter((one): one is number => one !== null)

  if (reported.length === 0) {
    return { reading: 'unavailable', relative: null, sample: 0, describe: 'This market did not report a volume for the formation, so there is no volume context.' }
  }

  const stats = rollingStats(candles, from, window)
  if (stats.medianVolume === null || stats.medianVolume <= 0 || stats.volumeSample < 5) {
    return {
      reading: 'unavailable',
      relative: null,
      sample: stats.volumeSample,
      describe: `Only ${stats.volumeSample} earlier candle${stats.volumeSample === 1 ? '' : 's'} reported a volume, which is too few to say whether this is unusual.`
    }
  }

  // The formation's own volume: the total across its candles, against the median for that many candles.
  const total = reported.reduce((a, b) => a + b, 0) / reported.length
  const relative = total / stats.medianVolume

  const reading: VolumeReading =
    relative >= 2 ? 'well-above-average' : relative >= 1.3 ? 'above-average' : relative <= 0.5 ? 'well-below-average' : relative <= 0.77 ? 'below-average' : 'average'

  return {
    reading,
    relative,
    sample: stats.volumeSample,
    describe: `The formation traded ${relative.toFixed(2)}× the median volume of the previous ${stats.volumeSample} candles.`
  }
}

// ---------------------------------------------------------------- volatility

export type VolatilityReading = 'unavailable' | 'very-low' | 'low' | 'normal' | 'elevated' | 'high'

export interface VolatilityContext {
  reading: VolatilityReading
  /** The formation's range against the average true range before it. */
  rangeVsAtr: number | null
  atr: number | null
  /** ATR as a share of price, which is what makes it comparable between markets. */
  atrPercent: number | null
  /** Whether the range has been widening or narrowing into the formation. */
  trend: 'expanding' | 'contracting' | 'steady' | 'unclear'
  describe: string
}

export function volatilityContext(candles: readonly Candle[], from: number, to: number, period = 14): VolatilityContext {
  if (from < period) {
    return { reading: 'unavailable', rangeVsAtr: null, atr: null, atrPercent: null, trend: 'unclear', describe: `Only ${from} candles precede this formation, where ${period} are needed for an average true range.` }
  }

  const series = atr(candles.slice(0, from), period)
  const value = series[series.length - 1] ?? null
  const formation = candles.slice(from, to + 1)
  const range = Math.max(...formation.map((one) => one.high)) - Math.min(...formation.map((one) => one.low))
  const price = (formation[formation.length - 1] as Candle).close

  if (value === null || value <= 0) {
    return { reading: 'unavailable', rangeVsAtr: null, atr: null, atrPercent: null, trend: 'unclear', describe: 'The average true range could not be worked out from the candles before this formation.' }
  }

  const rangeVsAtr = range / value
  const reading: VolatilityReading =
    rangeVsAtr >= 2 ? 'high' : rangeVsAtr >= 1.3 ? 'elevated' : rangeVsAtr <= 0.4 ? 'very-low' : rangeVsAtr <= 0.7 ? 'low' : 'normal'

  // Is the ATR itself rising or falling into the formation?
  const earlier = series[Math.max(0, series.length - period - 1)] ?? null
  const trend: VolatilityContext['trend'] =
    earlier === null || earlier <= 0
      ? 'unclear'
      : value / earlier >= 1.25
        ? 'expanding'
        : value / earlier <= 0.8
          ? 'contracting'
          : 'steady'

  return {
    reading,
    rangeVsAtr,
    atr: value,
    atrPercent: price > 0 ? (value / price) * 100 : null,
    trend,
    describe: `The formation spanned ${rangeVsAtr.toFixed(2)}× the average true range, which has been ${trend} into it.`
  }
}

// ---------------------------------------------------------------- momentum

export interface MomentumContext {
  /** Null where the indicator could not be computed from the history available. Never a default value. */
  rsi: number | null
  rsiReading: 'oversold' | 'low' | 'neutral' | 'high' | 'overbought' | 'unavailable'
  macdHistogram: number | null
  macdReading: 'rising' | 'falling' | 'unavailable'
  /** Trend strength, without direction, from the average directional index. */
  adx: number | null
  adxReading: 'no-trend' | 'weak' | 'strong' | 'very-strong' | 'unavailable'
  priceVsMovingAverage: { period: number; value: number; above: boolean } | null
  describe: string
}

/**
 * The momentum readings, where the history supports them.
 *
 * These come from the shared indicator engine, so an RSI shown beside a pattern is the same RSI the chart draws and
 * the same one a strategy tests against. A second implementation would eventually disagree with the first, and the
 * user would have no way to know which screen was lying.
 */
export function momentumContext(candles: readonly Candle[], at: number, options: { maPeriod?: number } = {}): MomentumContext {
  const maPeriod = options.maPeriod ?? 50
  const upTo = candles.slice(0, at + 1)
  const values = closes(upTo)

  const last = <T,>(series: (T | null)[]): T | null => {
    for (let i = series.length - 1; i >= 0; i -= 1) {
      const one = series[i]
      if (one !== null && one !== undefined) return one
    }
    return null
  }

  const rsiValue = upTo.length >= 15 ? last(rsi(values, 14)) : null
  const macdValue = upTo.length >= 35 ? last(macd(values).histogram) : null
  const macdBefore = upTo.length >= 36 ? last(macd(values.slice(0, -1)).histogram) : null
  const adxValue = upTo.length >= 30 ? last(adx(upTo, 14).adx) : null
  const maSeries = upTo.length >= maPeriod ? last(sma(values, maPeriod)) : null
  const price = (upTo[upTo.length - 1] as Candle | undefined)?.close ?? null

  const parts: string[] = []
  if (rsiValue !== null) parts.push(`RSI ${rsiValue.toFixed(1)}`)
  if (adxValue !== null) parts.push(`ADX ${adxValue.toFixed(1)}`)
  if (maSeries !== null && price !== null) parts.push(`price ${price > maSeries ? 'above' : 'below'} its ${maPeriod}-period average`)

  return {
    rsi: rsiValue,
    rsiReading:
      rsiValue === null ? 'unavailable' : rsiValue <= 30 ? 'oversold' : rsiValue <= 45 ? 'low' : rsiValue >= 70 ? 'overbought' : rsiValue >= 55 ? 'high' : 'neutral',
    macdHistogram: macdValue,
    macdReading: macdValue === null || macdBefore === null ? 'unavailable' : macdValue > macdBefore ? 'rising' : 'falling',
    adx: adxValue,
    adxReading: adxValue === null ? 'unavailable' : adxValue < 20 ? 'no-trend' : adxValue < 25 ? 'weak' : adxValue < 50 ? 'strong' : 'very-strong',
    priceVsMovingAverage: maSeries === null || price === null ? null : { period: maPeriod, value: maSeries, above: price > maSeries },
    describe: parts.length === 0 ? 'There is not enough history for any momentum reading.' : parts.join(', ') + '.'
  }
}

// ---------------------------------------------------------------- regime

export type MarketRegime =
  | 'strong-uptrend'
  | 'weak-uptrend'
  | 'strong-downtrend'
  | 'weak-downtrend'
  | 'range'
  | 'compression'
  | 'expansion'
  | 'unknown'

export interface RegimeReading {
  regime: MarketRegime
  /** Volatility is reported beside the regime rather than folded into it: they are different questions. */
  volatility: VolatilityReading
  describe: string
}

/**
 * What kind of market this is, as far as the candles can say.
 *
 * Built from structure and trend strength, with volatility reported separately rather than mixed in. "High-volatility
 * range" is two facts, and collapsing them into one label loses whichever one the reader needed.
 */
export function regimeOf(candles: readonly Candle[], at: number): RegimeReading {
  const upTo = candles.slice(0, at + 1)
  const structure = structureOf(upTo)
  const momentum = momentumContext(upTo, upTo.length - 1)
  const volatility = volatilityContext(candles, Math.max(0, at), at)

  const strong = momentum.adx !== null && momentum.adx >= 25
  let regime: MarketRegime = 'unknown'

  if (structure.shape === 'higher-highs-and-lows') regime = strong ? 'strong-uptrend' : 'weak-uptrend'
  else if (structure.shape === 'lower-highs-and-lows') regime = strong ? 'strong-downtrend' : 'weak-downtrend'
  else if (structure.shape === 'contracting') regime = 'compression'
  else if (structure.shape === 'expanding') regime = 'expansion'
  else if (structure.shape === 'range') regime = 'range'

  const words: Record<MarketRegime, string> = {
    'strong-uptrend': 'a rising market with a strong directional reading',
    'weak-uptrend': 'a rising market without much force behind it',
    'strong-downtrend': 'a falling market with a strong directional reading',
    'weak-downtrend': 'a falling market without much force behind it',
    range: 'a market going sideways',
    compression: 'a market whose range is narrowing',
    expansion: 'a market whose range is widening',
    unknown: 'a market with too few turning points to classify'
  }

  return {
    regime,
    volatility: volatility.reading,
    describe: `This is ${words[regime]}${volatility.reading === 'unavailable' ? '' : `, on ${volatility.reading.replace('-', ' ')} volatility`}.`
  }
}

// ---------------------------------------------------------------- putting it together

export interface PatternContext {
  structure: Structure
  levels: LevelContext
  volume: VolumeContext
  volatility: VolatilityContext
  momentum: MomentumContext
  regime: RegimeReading
  /** Observations that point the same way as the formation. */
  agreements: string[]
  /** Observations that point against it. Never netted off against the agreements. */
  conflicts: string[]
  /** Things that could not be read at all. Listed, because an absent reading is not a neutral one. */
  unavailable: string[]
  /**
   * How much of the surrounding evidence could be read at all.
   *
   * A completeness figure, not a quality-of-signal figure: it says how much of the context was available, never how
   * good the observation is.
   */
  completeness: number
  describe: string
}

/**
 * Everything around a detection, gathered, with agreement and disagreement kept apart.
 *
 * `agreements` and `conflicts` are two lists and never a net score. A bullish formation on heavy volume, directly
 * under a ceiling the market has failed at twice, is exactly that: one observation for and one against. A number that
 * averaged them would be neither, and a user would read it as a recommendation.
 */
export function contextFor(candles: readonly Candle[], detection: PatternDetection, options: { window?: number } = {}): PatternContext {
  const window = options.window ?? 20
  const to = detection.index
  const from = Math.max(0, to - detection.candleTimes.length + 1)
  const price = (candles[to] as Candle | undefined)?.close ?? 0

  const structure = structureOf(candles.slice(0, to + 1))
  const levels = levelsAround(candles.slice(0, to + 1), price)
  const volume = volumeContext(candles, from, to, window)
  const volatility = volatilityContext(candles, from, to)
  const momentum = momentumContext(candles, to)
  const regime = regimeOf(candles, to)

  const agreements: string[] = []
  const conflicts: string[] = []
  const unavailable: string[] = []
  const direction: PatternDirection = detection.direction

  // Structure.
  if (structure.shape === 'unclear') unavailable.push('the market structure')
  else if (direction === 'bullish' && structure.shape === 'lower-highs-and-lows') {
    agreements.push('the formation points against a market that has been making lower highs and lower lows, which is the setting a bullish reversal name describes')
  } else if (direction === 'bearish' && structure.shape === 'higher-highs-and-lows') {
    agreements.push('the formation points against a market that has been making higher highs and higher lows, which is the setting a bearish reversal name describes')
  } else if (direction === 'bullish' && structure.shape === 'higher-highs-and-lows' && detection.category === 'reversal') {
    conflicts.push('this is a bullish reversal name in a market that is already rising, so there is little to reverse')
  } else if (direction === 'bearish' && structure.shape === 'lower-highs-and-lows' && detection.category === 'reversal') {
    conflicts.push('this is a bearish reversal name in a market that is already falling, so there is little to reverse')
  }

  // Levels.
  if (levels.placement === 'unclear') unavailable.push('support and resistance')
  else if (direction === 'bullish' && levels.placement === 'at-support') agreements.push(`it formed on support at ${Number((levels.nearestSupport?.price ?? 0).toPrecision(8))}, which the market has turned at ${levels.nearestSupport?.touches} times`)
  else if (direction === 'bullish' && levels.placement === 'at-resistance') conflicts.push(`it is a bullish formation directly under resistance at ${Number((levels.nearestResistance?.price ?? 0).toPrecision(8))}`)
  else if (direction === 'bearish' && levels.placement === 'at-resistance') agreements.push(`it formed at resistance at ${Number((levels.nearestResistance?.price ?? 0).toPrecision(8))}, which the market has turned at ${levels.nearestResistance?.touches} times`)
  else if (direction === 'bearish' && levels.placement === 'at-support') conflicts.push(`it is a bearish formation directly on support at ${Number((levels.nearestSupport?.price ?? 0).toPrecision(8))}`)

  // Volume.
  if (volume.reading === 'unavailable') unavailable.push('volume')
  else if (volume.reading === 'above-average' || volume.reading === 'well-above-average') {
    agreements.push(`it formed on ${volume.relative?.toFixed(2)}× the usual volume`)
  } else if (volume.reading === 'below-average' || volume.reading === 'well-below-average') {
    conflicts.push(`it formed on ${volume.relative?.toFixed(2)}× the usual volume, which is less trade than the market normally does`)
  }

  // Momentum, where the reading has a direction the formation can agree or disagree with.
  if (momentum.rsiReading === 'unavailable') unavailable.push('momentum')
  else if (direction === 'bullish' && momentum.rsiReading === 'oversold') agreements.push(`RSI is at ${momentum.rsi?.toFixed(1)}, in the range usually called oversold`)
  else if (direction === 'bearish' && momentum.rsiReading === 'overbought') agreements.push(`RSI is at ${momentum.rsi?.toFixed(1)}, in the range usually called overbought`)
  else if (direction === 'bullish' && momentum.rsiReading === 'overbought') conflicts.push(`RSI is at ${momentum.rsi?.toFixed(1)}, already in the range usually called overbought`)
  else if (direction === 'bearish' && momentum.rsiReading === 'oversold') conflicts.push(`RSI is at ${momentum.rsi?.toFixed(1)}, already in the range usually called oversold`)

  const possible = 4
  const completeness = (possible - unavailable.length) / possible

  const parts: string[] = []
  if (agreements.length > 0) parts.push(`${agreements.length} observation${agreements.length === 1 ? '' : 's'} around it point${agreements.length === 1 ? 's' : ''} the same way`)
  if (conflicts.length > 0) parts.push(`${conflicts.length} point${conflicts.length === 1 ? 's' : ''} against it`)
  if (unavailable.length > 0) parts.push(`${unavailable.length} could not be read at all (${unavailable.join(', ')})`)

  return {
    structure,
    levels,
    volume,
    volatility,
    momentum,
    regime,
    agreements,
    conflicts,
    unavailable,
    completeness,
    describe:
      parts.length === 0
        ? 'Nothing around the formation points either way.'
        : `${parts.join('; ')}. These are listed rather than combined: an observation for and one against do not cancel out.`
  }
}

// ---------------------------------------------------------------- multi-timeframe

export interface TimeframeReading {
  interval: string
  regime: MarketRegime
  structure: StructureShape
  describe: string
}

export type TimeframeAgreement = 'aligned' | 'mixed' | 'opposed' | 'unknown'

export interface TimeframeContext {
  readings: TimeframeReading[]
  agreement: TimeframeAgreement
  describe: string
}

/**
 * The same market on several intervals, reported side by side and never merged.
 *
 * Merging them is the temptation and the mistake: a bullish fifteen-minute formation inside a falling daily market is
 * two true statements, and a single combined "signal" would have to discard one of them. So each interval keeps its
 * own reading and the relationship between them is named -- aligned, mixed, or opposed -- rather than resolved.
 */
export function timeframeContext(
  perInterval: readonly { interval: string; candles: readonly Candle[] }[],
  direction: PatternDirection
): TimeframeContext {
  const readings: TimeframeReading[] = perInterval.map((one) => {
    const regime = regimeOf(one.candles, one.candles.length - 1)
    const structure = structureOf(one.candles)
    return { interval: one.interval, regime: regime.regime, structure: structure.shape, describe: `${one.interval}: ${regime.describe}` }
  })

  const known = readings.filter((one) => one.regime !== 'unknown')
  if (known.length === 0 || direction === 'neutral') {
    return {
      readings,
      agreement: 'unknown',
      describe:
        direction === 'neutral'
          ? 'This formation has no direction, so there is nothing for the other timeframes to agree or disagree with.'
          : 'None of the other timeframes has enough history to classify.'
    }
  }

  const rising = known.filter((one) => one.regime === 'strong-uptrend' || one.regime === 'weak-uptrend').length
  const falling = known.filter((one) => one.regime === 'strong-downtrend' || one.regime === 'weak-downtrend').length
  const withIt = direction === 'bullish' ? rising : falling
  const againstIt = direction === 'bullish' ? falling : rising

  const agreement: TimeframeAgreement = withIt > 0 && againstIt === 0 ? 'aligned' : againstIt > 0 && withIt === 0 ? 'opposed' : 'mixed'

  return {
    readings,
    agreement,
    describe:
      agreement === 'aligned'
        ? `Every other timeframe that can be classified is moving the same way as this formation.`
        : agreement === 'opposed'
          ? `Every other timeframe that can be classified is moving against this formation. Both readings are true; neither cancels the other.`
          : `The other timeframes disagree with each other. They are shown separately rather than combined into one reading.`
  }
}

/** The assumptions the context engine rests on, shown rather than implied. */
export const CONTEXT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Context is gathered after detection and never changes whether a pattern was detected.',
  'A reading that cannot be taken is reported as unavailable, never as average, neutral or absent.',
  'A support or resistance level needs at least two separate turns at the same price. One turn is not a level.',
  'A swing point is never claimed inside the last few candles, because the window that confirms it extends past what is known.',
  'Agreements and conflicts are two lists and are never netted into a single score.',
  'Momentum readings come from the shared indicator engine, so they match what the chart draws.',
  'Volatility is reported beside the market regime rather than folded into it.',
  'Timeframes are shown separately. A bullish formation inside a falling higher timeframe is two facts, not one signal.'
])
