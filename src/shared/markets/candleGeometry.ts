import type { Candle } from './indicators.ts'

/**
 * What one candle actually is, measured, and how unusual it is against the ones around it.
 *
 * Every candlestick pattern in the world is a statement about geometry: how big the body is, where the close sits
 * inside the range, how long the wicks are, how this candle relates to the last one. None of that can be judged from
 * the raw four numbers, so this file turns a candle into measurements and then says how those measurements compare
 * with the recent past.
 *
 * Three rules, and the first is why the return types are full of nulls.
 *
 * **A ratio with no denominator is null, never zero.** A four-price doji -- open, high, low and close all equal -- has
 * a range of zero, so its body ratio is not 0 and not 1: it does not exist. Returning 0 would make it look like a
 * candle with no body inside a large range, which is a completely different formation, and every detector downstream
 * would believe it. The same applies to a candle with no volume reported: `null` means the venue did not say, and it
 * is never read as "nothing traded".
 *
 * **Absolute sizes mean nothing on their own.** A body of 40 dollars is enormous on a 400-dollar asset and invisible on
 * bitcoin; a 0.4% range is small at midday and large at four in the morning. So every detector that needs to know
 * whether a candle is *long* asks `relativeTo`, which measures it against a rolling window of the market's own recent
 * behaviour rather than against a constant somebody picked.
 *
 * **Nothing here decides anything.** This file measures. Whether a set of measurements is a Hammer is the pattern
 * library's business, and keeping the two apart is what lets a definition change without the measurements changing.
 */

// ---------------------------------------------------------------- validation

export type CandleProblem =
  /** `high` is below something it must be at or above, or `low` above something it must be at or below. */
  | 'impossible-range'
  | 'not-finite'
  | 'negative-volume'
  | 'bad-timestamp'
  | 'negative-price'

export interface CandleCheck {
  ok: boolean
  problems: CandleProblem[]
  describe: string
}

/**
 * Whether a candle can be measured at all.
 *
 * Checked before any geometry, because the checks that follow assume the four prices are consistent. A candle whose
 * high is below its close is not a strange candle, it is a broken record -- and a detector run over it produces a
 * pattern nobody can verify, which is worse than producing nothing.
 */
export function checkCandle(candle: Candle): CandleCheck {
  const problems: CandleProblem[] = []
  const { open, high, low, close, volume, time } = candle

  if (![open, high, low, close].every((one) => Number.isFinite(one))) problems.push('not-finite')
  else {
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) problems.push('negative-price')
    if (high < low || high < open || high < close || low > open || low > close) problems.push('impossible-range')
  }
  if (volume !== null && (!Number.isFinite(volume) || volume < 0)) problems.push('negative-volume')
  if (!Number.isFinite(time) || time <= 0) problems.push('bad-timestamp')

  const words: Record<CandleProblem, string> = {
    'impossible-range': 'the high is below, or the low above, one of the other prices',
    'not-finite': 'one of the prices is not a number',
    'negative-volume': 'the volume is negative',
    'bad-timestamp': 'the timestamp is not a usable time',
    'negative-price': 'one of the prices is zero or negative'
  }

  return {
    ok: problems.length === 0,
    problems,
    describe:
      problems.length === 0
        ? 'The candle is internally consistent.'
        : `This candle cannot be measured: ${problems.map((one) => words[one]).join('; ')}.`
  }
}

export type SequenceProblem = 'out-of-order' | 'duplicate-time' | 'gap' | 'irregular-spacing' | 'too-short'

export interface SequenceCheck {
  ok: boolean
  problems: { kind: SequenceProblem; at: number; describe: string }[]
  /** The spacing the sequence actually uses, taken from the most common gap rather than from an interval label. */
  barMs: number | null
  /** Indexes of candles that failed `checkCandle`. */
  broken: number[]
  describe: string
}

/**
 * Whether a run of candles is a usable sequence.
 *
 * The spacing is read off the candles rather than from the interval string that came with them. Those two disagree
 * more often than they should -- a venue relabels an interval, a backfill stitches two ranges together -- and a
 * detector that believes the label will happily read a three-candle pattern out of candles an hour apart in the middle
 * and a day apart at the end.
 *
 * A gap is reported and is **not** repaired. Inventing the missing candle would put a formation in the history that
 * never traded.
 */
export function checkSequence(candles: readonly Candle[]): SequenceCheck {
  const problems: SequenceCheck['problems'] = []
  const broken: number[] = []

  for (let i = 0; i < candles.length; i += 1) {
    if (!checkCandle(candles[i] as Candle).ok) broken.push(i)
  }

  if (candles.length < 2) {
    return {
      ok: broken.length === 0,
      problems: candles.length === 0 ? [{ kind: 'too-short', at: 0, describe: 'There are no candles.' }] : [],
      barMs: null,
      broken,
      describe: candles.length === 0 ? 'There are no candles to check.' : 'A single candle has no spacing to check.'
    }
  }

  const gaps: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const before = candles[i - 1] as Candle
    const now = candles[i] as Candle
    const gap = now.time - before.time
    if (gap === 0) {
      problems.push({ kind: 'duplicate-time', at: i, describe: `Two candles share the timestamp ${now.time}.` })
      continue
    }
    if (gap < 0) {
      problems.push({ kind: 'out-of-order', at: i, describe: `Candle ${i} is earlier than the one before it.` })
      continue
    }
    gaps.push(gap)
  }

  // The most common gap, which survives a few missing candles where a mean would not.
  const counts = new Map<number, number>()
  for (const gap of gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1)
  let barMs: number | null = null
  let best = 0
  for (const [gap, count] of counts) {
    if (count > best || (count === best && barMs !== null && gap < barMs)) {
      best = count
      barMs = gap
    }
  }

  if (barMs !== null) {
    for (let i = 1; i < candles.length; i += 1) {
      const gap = (candles[i] as Candle).time - (candles[i - 1] as Candle).time
      if (gap <= 0) continue
      if (gap === barMs) continue
      const missing = gap / barMs
      if (Number.isInteger(missing) && missing > 1) {
        problems.push({
          kind: 'gap',
          at: i,
          describe: `${missing - 1} candle${missing === 2 ? ' is' : 's are'} missing before candle ${i}. They are reported, not filled in.`
        })
      } else {
        problems.push({ kind: 'irregular-spacing', at: i, describe: `Candle ${i} is ${gap}ms after the one before, where the spacing is ${barMs}ms.` })
      }
    }
  }

  const ok = problems.length === 0 && broken.length === 0
  return {
    ok,
    problems,
    barMs,
    broken,
    describe: ok
      ? `${candles.length} candles, evenly spaced${barMs === null ? '' : ` at ${barMs}ms`}, all measurable.`
      : `${problems.length} problem${problems.length === 1 ? '' : 's'} with the sequence${broken.length > 0 ? ` and ${broken.length} candle${broken.length === 1 ? '' : 's'} that cannot be measured` : ''}.`
  }
}

// ---------------------------------------------------------------- geometry

export type Direction = 'bullish' | 'bearish' | 'doji-neutral'

export interface CandleFacts {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number | null

  /** high − low. Zero for a four-price candle, which is a real thing and not an error. */
  range: number
  /** |close − open|. */
  body: number
  upperWick: number
  lowerWick: number

  /**
   * Body, upper wick and lower wick as shares of the range.
   *
   * `null` when the range is zero: with no range these are not zero, they are undefined, and a detector reading a
   * zero would see a candle with no body inside a large range.
   */
  bodyRatio: number | null
  upperWickRatio: number | null
  lowerWickRatio: number | null

  /** Where the close and open sit in the range, from 0 at the low to 1 at the high. Null on a zero range. */
  closePosition: number | null
  openPosition: number | null

  /** Which way the candle closed. Equal open and close is its own answer, not a coin toss. */
  direction: Direction

  bodyTop: number
  bodyBottom: number
  bodyMid: number
  candleMid: number

  /** The body as a share of the open price, which is how "a 2% candle" is usually meant. */
  bodyPercent: number | null
  rangePercent: number | null
}

/** Measure one candle. No thresholds, no judgements, no comparison with anything else. */
export function geometryOf(candle: Candle): CandleFacts {
  const { open, high, low, close, volume, time } = candle
  const range = high - low
  const body = Math.abs(close - open)
  const bodyTop = Math.max(open, close)
  const bodyBottom = Math.min(open, close)
  const upperWick = high - bodyTop
  const lowerWick = bodyBottom - low
  const hasRange = range > 0

  return {
    time,
    open,
    high,
    low,
    close,
    volume,
    range,
    body,
    upperWick,
    lowerWick,
    bodyRatio: hasRange ? body / range : null,
    upperWickRatio: hasRange ? upperWick / range : null,
    lowerWickRatio: hasRange ? lowerWick / range : null,
    closePosition: hasRange ? (close - low) / range : null,
    openPosition: hasRange ? (open - low) / range : null,
    direction: close > open ? 'bullish' : close < open ? 'bearish' : 'doji-neutral',
    bodyTop,
    bodyBottom,
    bodyMid: (bodyTop + bodyBottom) / 2,
    candleMid: (high + low) / 2,
    bodyPercent: open > 0 ? (body / open) * 100 : null,
    rangePercent: open > 0 ? (range / open) * 100 : null
  }
}

// ---------------------------------------------------------------- relative

export interface RollingStats {
  /** How many candles went into these figures. Everything below is meaningless without it. */
  sample: number
  medianRange: number | null
  meanRange: number | null
  medianBody: number | null
  medianVolume: number | null
  /** How many of the sampled candles reported a volume at all. */
  volumeSample: number
  /** Average true range over the same window, which accounts for gaps where the range alone does not. */
  atr: number | null
  /** Standard deviation of the range, for spotting a candle that is unusual rather than merely large. */
  rangeDeviation: number | null
}

/** The smallest window that makes a median meaningful. Below this, `rollingStats` reports what it has and says so. */
export const MINIMUM_ROLLING_SAMPLE = 5

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? (sorted[middle] as number) : (((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2)
}

/**
 * What the market has been doing lately, in the units the candles are in.
 *
 * The window ends **before** the candle being judged. Including it would mean a very large candle raising the average
 * it is then compared against, which quietly hides exactly the candle somebody wanted to find.
 */
export function rollingStats(candles: readonly Candle[], endExclusive: number, window = 20): RollingStats {
  const from = Math.max(0, endExclusive - window)
  const slice = candles.slice(from, endExclusive).filter((one) => checkCandle(one).ok)

  if (slice.length === 0) {
    return { sample: 0, medianRange: null, meanRange: null, medianBody: null, medianVolume: null, volumeSample: 0, atr: null, rangeDeviation: null }
  }

  const ranges = slice.map((one) => one.high - one.low)
  const bodies = slice.map((one) => Math.abs(one.close - one.open))
  const volumes = slice.map((one) => one.volume).filter((one): one is number => one !== null)

  const meanRange = ranges.reduce((a, b) => a + b, 0) / ranges.length
  const variance = ranges.reduce((running, one) => running + (one - meanRange) ** 2, 0) / ranges.length

  // True range over the slice, using the candle before each where there is one, so a gap counts.
  const trueRanges: number[] = []
  for (let i = 0; i < slice.length; i += 1) {
    const one = slice[i] as Candle
    const before = i === 0 ? candles[from - 1] : slice[i - 1]
    trueRanges.push(
      before === undefined
        ? one.high - one.low
        : Math.max(one.high - one.low, Math.abs(one.high - before.close), Math.abs(one.low - before.close))
    )
  }

  return {
    sample: slice.length,
    medianRange: median(ranges),
    meanRange,
    medianBody: median(bodies),
    medianVolume: volumes.length === 0 ? null : median(volumes),
    volumeSample: volumes.length,
    atr: trueRanges.length === 0 ? null : trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length,
    rangeDeviation: Math.sqrt(variance)
  }
}

export interface RelativeFacts {
  /** This candle's range as a multiple of the recent median. Null when there is no usable window. */
  rangeVsMedian: number | null
  bodyVsMedian: number | null
  volumeVsMedian: number | null
  rangeVsAtr: number | null
  /** How many standard deviations above the mean range this candle's range is. */
  rangeZScore: number | null
  /** Whether the window was long enough for any of this to be worth reading. */
  reliable: boolean
  describe: string
}

/**
 * How this candle compares with the ones before it.
 *
 * Everything is a multiple, which is what makes a detector portable: "the body is 1.8× the recent median" means the
 * same thing on bitcoin and on a token worth a hundredth of a cent, and a threshold written in dollars means neither.
 */
export function relativeTo(facts: CandleFacts, stats: RollingStats): RelativeFacts {
  const reliable = stats.sample >= MINIMUM_ROLLING_SAMPLE
  const over = (value: number, by: number | null): number | null => (by === null || by <= 0 ? null : value / by)

  const rangeVsMedian = over(facts.range, stats.medianRange)
  const bodyVsMedian = over(facts.body, stats.medianBody)
  // A volume of zero is a real reading; a volume of null is not. Only the second is refused here.
  const volumeVsMedian = facts.volume === null ? null : over(facts.volume, stats.medianVolume)
  const rangeVsAtr = over(facts.range, stats.atr)
  const rangeZScore =
    stats.meanRange === null || stats.rangeDeviation === null || stats.rangeDeviation === 0
      ? null
      : (facts.range - stats.meanRange) / stats.rangeDeviation

  return {
    rangeVsMedian,
    bodyVsMedian,
    volumeVsMedian,
    rangeVsAtr,
    rangeZScore,
    reliable,
    describe: !reliable
      ? `Only ${stats.sample} earlier candle${stats.sample === 1 ? '' : 's'} to compare against, which is too few to call this candle large or small.`
      : rangeVsMedian === null
        ? 'There is nothing to compare this candle against.'
        : `Its range is ${rangeVsMedian.toFixed(2)}× the recent median${volumeVsMedian === null ? '' : `, on ${volumeVsMedian.toFixed(2)}× the median volume`}.`
  }
}

// ---------------------------------------------------------------- between candles

export interface GapFacts {
  /** A gap between bodies: the earlier body's top below the later body's bottom, or the reverse. */
  bodyGap: number
  /** A true window: no overlap between the two candles' ranges at all. */
  rangeGap: number
  direction: 'up' | 'down' | 'none'
  /** The gap as a share of the earlier close. */
  percent: number | null
  /**
   * Whether the ranges genuinely do not overlap.
   *
   * On a market that trades continuously this is rare and meaningful. Equity candlestick literature assumes a session
   * break produces these routinely; a detector applying that assumption to a 24/7 crypto market finds almost nothing
   * and concludes wrongly that the pattern does not occur here.
   */
  isWindow: boolean
}

/** The relationship between two consecutive candles, measured. */
export function gapBetween(before: CandleFacts, after: CandleFacts): GapFacts {
  const bodyGap = after.bodyBottom > before.bodyTop ? after.bodyBottom - before.bodyTop : before.bodyBottom > after.bodyTop ? before.bodyBottom - after.bodyTop : 0
  const rangeGap = after.low > before.high ? after.low - before.high : before.low > after.high ? before.low - after.high : 0
  const direction = rangeGap > 0 ? (after.low > before.high ? 'up' : 'down') : bodyGap > 0 ? (after.bodyBottom > before.bodyTop ? 'up' : 'down') : 'none'

  return {
    bodyGap,
    rangeGap,
    direction,
    percent: before.close > 0 ? (Math.max(bodyGap, rangeGap) / before.close) * 100 : null,
    isWindow: rangeGap > 0
  }
}

/** Whether the later candle's real body completely covers the earlier one's. */
export function engulfsBody(later: CandleFacts, earlier: CandleFacts, tolerance = 0): boolean {
  const slack = tolerance * Math.max(later.range, earlier.range)
  return later.bodyTop >= earlier.bodyTop - slack && later.bodyBottom <= earlier.bodyBottom + slack && later.body > earlier.body
}

/** Whether the later candle's real body sits entirely inside the earlier one's. */
export function insideBody(later: CandleFacts, earlier: CandleFacts, tolerance = 0): boolean {
  const slack = tolerance * Math.max(later.range, earlier.range)
  return later.bodyTop <= earlier.bodyTop + slack && later.bodyBottom >= earlier.bodyBottom - slack && earlier.body > later.body
}

/**
 * Whether two prices are the same to within a tolerance scaled to the market.
 *
 * Relative rather than absolute, because "the same high" on bitcoin means within a few dollars and on a token worth
 * 0.000004 means within a rounding step. A fixed epsilon is wrong on one of them however it is chosen.
 */
export function nearlyEqual(a: number, b: number, scale: number, tolerance: number): boolean {
  if (scale <= 0) return a === b
  return Math.abs(a - b) <= tolerance * scale
}

/** The assumptions this file rests on, shown rather than implied. */
export const GEOMETRY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A ratio whose denominator is zero is reported as null, never as zero. A four-price candle has no body ratio.',
  'A volume of null means the venue did not report one. It is never read as nothing having traded.',
  'A candle that closes where it opened is neutral, not assigned a direction.',
  'Sizes are compared against a rolling window of the market’s own recent candles, never against a fixed threshold.',
  'The comparison window ends before the candle being judged, so a large candle cannot raise the average it is measured against.',
  'The spacing of a sequence is read off the candles, not from the interval label that came with them.',
  'A missing candle is reported as missing and never filled in.',
  'A window between two candles is measured, and is not assumed to be common: a market that trades continuously rarely produces one.'
])
