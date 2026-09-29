import {
  engulfsBody,
  gapBetween,
  insideBody,
  nearlyEqual,
  type CandleFacts,
  type RollingStats
} from './candleGeometry.ts'

/**
 * What Orbis means by each candlestick pattern, written down.
 *
 * Candlestick names are older than any software and no two sources define them identically. Some books require a
 * Hammer's lower wick to be twice the body, some three times; some require no upper wick at all, some allow a small
 * one. There is no authority to appeal to. So this file does the only honest thing available: it states the definition
 * Orbis uses, gives it a version, and records that version on every detection — so a result from last year can still
 * be explained by the rules that produced it, even after the rules change.
 *
 * ## A definition is rules, and every rule says what it measured
 *
 * A pattern is not a function returning true. It is a list of named rules, each of which reports whether it passed
 * **and what it actually measured**: not "the body was small" but "the body was 4% of the range, against the 10%
 * allowed". That is what makes a detection auditable, and it is why the explanation a user reads is generated from the
 * rules rather than written separately — a hand-written explanation drifts away from the code that decides, and then
 * it is describing a detection that did not happen.
 *
 * ## Shape and situation are kept apart
 *
 * A Hammer and a Hanging Man are the *same shape*. The only thing that distinguishes them is what came before: one
 * follows a decline, the other an advance. So structural rules and context rules are separate lists. Where a name
 * genuinely requires a prior trend, the context rule is required and the pattern will not confirm without it — which
 * means on a market with too little history to establish a trend, Orbis says the trend is unknown rather than picking
 * whichever of the two names it fancies.
 *
 * ## Built-in rules are code; custom rules will be data
 *
 * The rules below are TypeScript functions in this file: compiled, reviewable, versioned with the repository. That is
 * deliberate and it is not a loophole, because they are ours. A pattern somebody else writes is a different problem
 * and gets a different mechanism -- a declarative expression the engine interprets, never code it runs.
 */

// ---------------------------------------------------------------- tolerance

/**
 * The slack a detector allows, and where the numbers came from.
 *
 * Every threshold here is a choice. None of them is a fact about markets, and pretending otherwise is how a detector
 * ends up with magic numbers nobody can defend. They are grouped into named modes so that the choice is made once,
 * visibly, rather than scattered through sixty detectors.
 */
export interface Tolerance {
  /** A body at or below this share of the range counts as no body: a doji. */
  dojiBodyRatio: number
  /** A wick at or above this share of the range is long, when only one of the two has to be. */
  longWickRatio: number
  /**
   * How long each shadow must be when *both* have to be long.
   *
   * Necessarily smaller than `longWickRatio`, and not as a concession: two shadows at 60% of the range plus a body
   * do not fit inside the range, so a long-legged doji defined with the one-sided threshold could never exist. This
   * is the threshold that makes the two-sided patterns detectable at all.
   */
  bothSidesWickRatio: number
  /** A wick at or below this share of the range is effectively absent. */
  shortWickRatio: number
  /** A body at or above this multiple of the recent median body is long. */
  longBodyMultiple: number
  /** A body at or below this multiple of the recent median body is short. */
  shortBodyMultiple: number
  /** How close two prices must be to count as equal, as a share of the candle's range. */
  equality: number
  /** How many candles back a prior trend is measured over. */
  trendLookback: number
  /** How much net drift, in units of the random walk's own scale, counts as a trend rather than noise. */
  trendStrength: number
}

export type DetectionMode = 'standard' | 'strict' | 'research'

/**
 * The three modes, and what moving between them actually does.
 *
 * Strict is not "more accurate" and research is not "less accurate". They trade the two ways a detector can be wrong
 * against each other: strict misses real formations that are slightly off-canonical, research reports formations that
 * are only approximately the named shape. Neither says anything about what price does next.
 */
export const TOLERANCES: Readonly<Record<DetectionMode, Tolerance>> = Object.freeze({
  standard: Object.freeze({
    dojiBodyRatio: 0.1,
    longWickRatio: 0.6,
    bothSidesWickRatio: 0.3,
    shortWickRatio: 0.1,
    longBodyMultiple: 1.3,
    shortBodyMultiple: 0.5,
    equality: 0.05,
    trendLookback: 5,
    trendStrength: 0.5
  }),
  strict: Object.freeze({
    dojiBodyRatio: 0.05,
    longWickRatio: 0.66,
    bothSidesWickRatio: 0.35,
    shortWickRatio: 0.05,
    longBodyMultiple: 1.5,
    shortBodyMultiple: 0.4,
    equality: 0.02,
    trendLookback: 7,
    trendStrength: 0.8
  }),
  research: Object.freeze({
    dojiBodyRatio: 0.15,
    longWickRatio: 0.5,
    bothSidesWickRatio: 0.25,
    shortWickRatio: 0.18,
    longBodyMultiple: 1.15,
    shortBodyMultiple: 0.65,
    equality: 0.1,
    trendLookback: 4,
    trendStrength: 0.3
  })
})

// ---------------------------------------------------------------- the window a rule sees

export interface MatchWindow {
  /** The formation's own candles, oldest first. Exactly `formationLength` of them. */
  facts: readonly CandleFacts[]
  /** Everything before the formation, oldest first. What context rules read. */
  prior: readonly CandleFacts[]
  /** The market's recent behaviour, measured over candles before the formation. */
  stats: RollingStats
  tolerance: Tolerance
}

export interface RuleResult {
  passed: boolean
  /**
   * How comfortably it passed, from 0 at the threshold to 1 with room to spare.
   *
   * This is a margin, not a probability. A rule that passed at 1 says the candles are well clear of the boundary the
   * definition draws; it says nothing whatever about what happens next.
   */
  strength: number
  /** What was actually measured, with the numbers in it. This is what a user reads. */
  measured: string
}

export interface Rule {
  id: string
  /** The rule as a sentence, in the present tense, as the definition states it. */
  describe: string
  /** A required rule that fails means no pattern. An optional one contributes to the match strength only. */
  required: boolean
  test(window: MatchWindow): RuleResult
}

const pass = (strength: number, measured: string): RuleResult => ({ passed: true, strength: Math.max(0, Math.min(1, strength)), measured })
const fail = (measured: string): RuleResult => ({ passed: false, strength: 0, measured })

const rule = (id: string, describe: string, test: (window: MatchWindow) => RuleResult, required = true): Rule => ({ id, describe, required, test })

/** A rule's margin, scaled so that hitting the threshold exactly is 0 and doubling it is 1. */
const margin = (value: number, threshold: number, direction: 'above' | 'below'): number => {
  if (threshold <= 0) return value > 0 ? 1 : 0
  return direction === 'above'
    ? Math.max(0, Math.min(1, (value - threshold) / threshold))
    : Math.max(0, Math.min(1, (threshold - value) / threshold))
}

const pct = (value: number | null): string => (value === null ? 'undefined' : `${(value * 100).toFixed(1)}%`)
const mult = (value: number | null): string => (value === null ? 'unknown' : `${value.toFixed(2)}×`)

// ---------------------------------------------------------------- shape predicates

const at = (window: MatchWindow, index: number): CandleFacts => window.facts[index] as CandleFacts

/** The scale equality is measured against: this candle's own range, falling back to the market's median. */
const scaleOf = (one: CandleFacts, stats: RollingStats): number => (one.range > 0 ? one.range : (stats.medianRange ?? 0))

const bullish = (index: number): Rule =>
  rule(`candle-${index}-bullish`, `candle ${index + 1} closes above its open`, (w) => {
    const one = at(w, index)
    return one.direction === 'bullish'
      ? pass(one.bodyRatio === null ? 0.5 : one.bodyRatio, `closed at ${one.close}, above its open of ${one.open}`)
      : fail(`closed at ${one.close}, which is ${one.direction === 'bearish' ? 'below' : 'level with'} its open of ${one.open}`)
  })

const bearish = (index: number): Rule =>
  rule(`candle-${index}-bearish`, `candle ${index + 1} closes below its open`, (w) => {
    const one = at(w, index)
    return one.direction === 'bearish'
      ? pass(one.bodyRatio === null ? 0.5 : one.bodyRatio, `closed at ${one.close}, below its open of ${one.open}`)
      : fail(`closed at ${one.close}, which is ${one.direction === 'bullish' ? 'above' : 'level with'} its open of ${one.open}`)
  })

const dojiBody = (index: number): Rule =>
  rule(`candle-${index}-doji-body`, `candle ${index + 1} opens and closes at essentially the same price`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.bodyRatio === null) {
      return one.range === 0
        ? pass(1, 'open, high, low and close are all the same price')
        : fail('the candle has no measurable range')
    }
    return one.bodyRatio <= t.dojiBodyRatio
      ? pass(margin(one.bodyRatio, t.dojiBodyRatio, 'below'), `its body is ${pct(one.bodyRatio)} of the range, within the ${pct(t.dojiBodyRatio)} allowed`)
      : fail(`its body is ${pct(one.bodyRatio)} of the range, past the ${pct(t.dojiBodyRatio)} allowed for a doji`)
  })

const notDoji = (index: number): Rule =>
  rule(`candle-${index}-has-body`, `candle ${index + 1} has a real body`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.bodyRatio === null) return fail('the candle has no range, so it has no body either')
    return one.bodyRatio > t.dojiBodyRatio
      ? pass(margin(one.bodyRatio, t.dojiBodyRatio, 'above'), `its body is ${pct(one.bodyRatio)} of the range`)
      : fail(`its body is ${pct(one.bodyRatio)} of the range, small enough to be a doji`)
  })

const longLowerWick = (index: number): Rule =>
  rule(`candle-${index}-long-lower-wick`, `candle ${index + 1} has a long lower shadow`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.lowerWickRatio === null) return fail('the candle has no range, so it has no shadows')
    return one.lowerWickRatio >= t.longWickRatio
      ? pass(margin(one.lowerWickRatio, t.longWickRatio, 'above'), `its lower shadow is ${pct(one.lowerWickRatio)} of the range`)
      : fail(`its lower shadow is ${pct(one.lowerWickRatio)} of the range, short of the ${pct(t.longWickRatio)} required`)
  })

const longUpperWick = (index: number): Rule =>
  rule(`candle-${index}-long-upper-wick`, `candle ${index + 1} has a long upper shadow`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.upperWickRatio === null) return fail('the candle has no range, so it has no shadows')
    return one.upperWickRatio >= t.longWickRatio
      ? pass(margin(one.upperWickRatio, t.longWickRatio, 'above'), `its upper shadow is ${pct(one.upperWickRatio)} of the range`)
      : fail(`its upper shadow is ${pct(one.upperWickRatio)} of the range, short of the ${pct(t.longWickRatio)} required`)
  })

const longShadowsBothSides = (index: number): Rule =>
  rule(`candle-${index}-long-shadows-both-sides`, `candle ${index + 1} has a long shadow on each side`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.upperWickRatio === null || one.lowerWickRatio === null) return fail('the candle has no range, so it has no shadows')
    const smaller = Math.min(one.upperWickRatio, one.lowerWickRatio)
    return smaller >= t.bothSidesWickRatio
      ? pass(margin(smaller, t.bothSidesWickRatio, 'above'), `its shadows are ${pct(one.upperWickRatio)} above and ${pct(one.lowerWickRatio)} below`)
      : fail(`its shorter shadow is ${pct(smaller)} of the range, short of the ${pct(t.bothSidesWickRatio)} each side requires`)
  })

const shortUpperWick = (index: number): Rule =>
  rule(`candle-${index}-short-upper-wick`, `candle ${index + 1} has little or no upper shadow`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.upperWickRatio === null) return pass(1, 'the candle has no range and so no upper shadow')
    return one.upperWickRatio <= t.shortWickRatio
      ? pass(margin(one.upperWickRatio, t.shortWickRatio, 'below'), `its upper shadow is ${pct(one.upperWickRatio)} of the range`)
      : fail(`its upper shadow is ${pct(one.upperWickRatio)} of the range, past the ${pct(t.shortWickRatio)} allowed`)
  })

const shortLowerWick = (index: number): Rule =>
  rule(`candle-${index}-short-lower-wick`, `candle ${index + 1} has little or no lower shadow`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    if (one.lowerWickRatio === null) return pass(1, 'the candle has no range and so no lower shadow')
    return one.lowerWickRatio <= t.shortWickRatio
      ? pass(margin(one.lowerWickRatio, t.shortWickRatio, 'below'), `its lower shadow is ${pct(one.lowerWickRatio)} of the range`)
      : fail(`its lower shadow is ${pct(one.lowerWickRatio)} of the range, past the ${pct(t.shortWickRatio)} allowed`)
  })

const longBody = (index: number): Rule =>
  rule(`candle-${index}-long-body`, `candle ${index + 1} has a long body for this market`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    const median = w.stats.medianBody
    if (median === null || median <= 0 || w.stats.sample < 5) {
      return fail('there is not enough recent history to say whether this body is long')
    }
    const ratio = one.body / median
    return ratio >= t.longBodyMultiple
      ? pass(margin(ratio, t.longBodyMultiple, 'above'), `its body is ${mult(ratio)} the recent median body`)
      : fail(`its body is ${mult(ratio)} the recent median, short of the ${mult(t.longBodyMultiple)} required`)
  })

const shortBody = (index: number): Rule =>
  rule(`candle-${index}-short-body`, `candle ${index + 1} has a small body for this market`, (w) => {
    const one = at(w, index)
    const t = w.tolerance
    const median = w.stats.medianBody
    if (median === null || median <= 0 || w.stats.sample < 5) {
      return fail('there is not enough recent history to say whether this body is small')
    }
    const ratio = one.body / median
    return ratio <= t.shortBodyMultiple
      ? pass(margin(ratio, t.shortBodyMultiple, 'below'), `its body is ${mult(ratio)} the recent median body`)
      : fail(`its body is ${mult(ratio)} the recent median, past the ${mult(t.shortBodyMultiple)} allowed`)
  })

/** The body sits in the upper part of the range, which is what makes an umbrella an umbrella. */
const bodyInUpperRange = (index: number): Rule =>
  rule(`candle-${index}-body-high`, `candle ${index + 1}'s body sits in the upper part of its range`, (w) => {
    const one = at(w, index)
    if (one.range <= 0) return fail('the candle has no range')
    const position = (one.bodyBottom - one.low) / one.range
    return position >= 0.5
      ? pass(margin(position, 0.5, 'above'), `its body begins ${pct(position)} of the way up the range`)
      : fail(`its body begins ${pct(position)} of the way up the range, in the lower half`)
  })

const bodyInLowerRange = (index: number): Rule =>
  rule(`candle-${index}-body-low`, `candle ${index + 1}'s body sits in the lower part of its range`, (w) => {
    const one = at(w, index)
    if (one.range <= 0) return fail('the candle has no range')
    const position = (one.high - one.bodyTop) / one.range
    return position >= 0.5
      ? pass(margin(position, 0.5, 'above'), `its body ends ${pct(position)} of the way down from the high`)
      : fail(`its body ends ${pct(position)} of the way down from the high, in the upper half`)
  })

// ---------------------------------------------------------------- relationship predicates

const engulfing = (later: number, earlier: number): Rule =>
  rule(`body-${later}-engulfs-${earlier}`, `candle ${later + 1}'s body completely covers candle ${earlier + 1}'s`, (w) => {
    const a = at(w, later)
    const b = at(w, earlier)
    const t = w.tolerance
    if (engulfsBody(a, b, t.equality)) {
      const overshoot = Math.min(a.bodyTop - b.bodyTop, b.bodyBottom - a.bodyBottom)
      const scale = scaleOf(b, w.stats)
      return pass(scale > 0 ? Math.min(1, Math.max(0, overshoot / scale) * 4) : 0.5, `its body spans ${a.bodyBottom}–${a.bodyTop}, covering ${b.bodyBottom}–${b.bodyTop}`)
    }
    return fail(`its body spans ${a.bodyBottom}–${a.bodyTop}, which does not cover ${b.bodyBottom}–${b.bodyTop}`)
  })

const inside = (later: number, earlier: number): Rule =>
  rule(`body-${later}-inside-${earlier}`, `candle ${later + 1}'s body sits entirely inside candle ${earlier + 1}'s`, (w) => {
    const a = at(w, later)
    const b = at(w, earlier)
    return insideBody(a, b, w.tolerance.equality)
      ? pass(b.body > 0 ? Math.min(1, 1 - a.body / b.body) : 0.5, `its body spans ${a.bodyBottom}–${a.bodyTop}, inside ${b.bodyBottom}–${b.bodyTop}`)
      : fail(`its body spans ${a.bodyBottom}–${a.bodyTop}, which is not inside ${b.bodyBottom}–${b.bodyTop}`)
  })

/** Candle `later` closes past the midpoint of candle `earlier`'s body. */
const closesPastMidpoint = (later: number, earlier: number, above: boolean): Rule =>
  rule(
    `close-${later}-past-mid-${earlier}`,
    `candle ${later + 1} closes ${above ? 'above' : 'below'} the midpoint of candle ${earlier + 1}'s body`,
    (w) => {
      const a = at(w, later)
      const b = at(w, earlier)
      const past = above ? a.close > b.bodyMid : a.close < b.bodyMid
      const scale = scaleOf(b, w.stats)
      const distance = Math.abs(a.close - b.bodyMid)
      return past
        ? pass(scale > 0 ? Math.min(1, (distance / scale) * 3) : 0.5, `closed at ${a.close}, ${above ? 'above' : 'below'} the midpoint ${Number(b.bodyMid.toPrecision(10))}`)
        : fail(`closed at ${a.close}, not ${above ? 'above' : 'below'} the midpoint ${Number(b.bodyMid.toPrecision(10))}`)
    }
  )

/** Candle `later` opens beyond candle `earlier`'s extreme, which is what a real gap means. */
const opensBeyond = (later: number, earlier: number, side: 'above-high' | 'below-low'): Rule =>
  rule(`open-${later}-${side}-${earlier}`, `candle ${later + 1} opens ${side === 'above-high' ? 'above the high' : 'below the low'} of candle ${earlier + 1}`, (w) => {
    const a = at(w, later)
    const b = at(w, earlier)
    const beyond = side === 'above-high' ? a.open > b.high : a.open < b.low
    const reference = side === 'above-high' ? b.high : b.low
    const scale = scaleOf(b, w.stats)
    return beyond
      ? pass(scale > 0 ? Math.min(1, (Math.abs(a.open - reference) / scale) * 3) : 0.5, `opened at ${a.open}, beyond ${reference}`)
      : fail(`opened at ${a.open}, not beyond ${reference}`)
  })

const equalPrices = (id: string, describe: string, take: (w: MatchWindow) => [number, number, CandleFacts]): Rule =>
  rule(id, describe, (w) => {
    const [a, b, reference] = take(w)
    const scale = scaleOf(reference, w.stats)
    return nearlyEqual(a, b, scale, w.tolerance.equality)
      ? pass(scale > 0 ? margin(Math.abs(a - b) / scale, w.tolerance.equality, 'below') : 1, `${Number(a.toPrecision(10))} against ${Number(b.toPrecision(10))}`)
      : fail(`${Number(a.toPrecision(10))} against ${Number(b.toPrecision(10))}, further apart than the ${pct(w.tolerance.equality)} allowed`)
  })

const windowBetween = (later: number, earlier: number, direction: 'up' | 'down'): Rule =>
  rule(`window-${earlier}-${later}-${direction}`, `there is a ${direction === 'up' ? 'rising' : 'falling'} window between candles ${earlier + 1} and ${later + 1}`, (w) => {
    const gap = gapBetween(at(w, earlier), at(w, later))
    if (!gap.isWindow) return fail('the two candles’ ranges overlap, so there is no window')
    if (gap.direction !== direction) return fail(`the window is ${gap.direction}, not ${direction}`)
    const scale = scaleOf(at(w, earlier), w.stats)
    return pass(scale > 0 ? Math.min(1, (gap.rangeGap / scale) * 2) : 0.5, `a ${direction} window of ${Number(gap.rangeGap.toPrecision(6))}${gap.percent === null ? '' : ` (${gap.percent.toFixed(2)}%)`}`)
  })

// ---------------------------------------------------------------- prior trend

export type PriorTrend = 'up' | 'down' | 'flat' | 'unknown'

export interface TrendReading {
  trend: PriorTrend
  /** Net drift over the lookback, in units of the market's own volatility. */
  drift: number | null
  lookback: number
  describe: string
}

/**
 * Whether what came before the formation was a rise, a fall, or neither.
 *
 * Measured as net change over the lookback divided by the volatility that many candles would produce on their own.
 * That normalisation is the point: a move of 200 dollars is a trend on a quiet market and noise on a wild one, and a
 * threshold in price terms would call every busy afternoon a trend.
 *
 * Returns `unknown` rather than `flat` when there is not enough history. They are different answers: one says the
 * market went nowhere, the other says nobody can tell, and a Hammer needs the first to be a Hammer at all.
 */
export function priorTrend(prior: readonly CandleFacts[], stats: RollingStats, tolerance: Tolerance): TrendReading {
  const lookback = tolerance.trendLookback
  if (prior.length < lookback) {
    return { trend: 'unknown', drift: null, lookback, describe: `Only ${prior.length} candle${prior.length === 1 ? '' : 's'} before this, where ${lookback} are needed to call a trend.` }
  }
  const scale = stats.atr ?? stats.medianRange
  if (scale === null || scale <= 0) {
    return { trend: 'unknown', drift: null, lookback, describe: 'There is no measure of this market’s recent movement to judge a trend against.' }
  }

  const window = prior.slice(prior.length - lookback)
  const first = window[0] as CandleFacts
  const last = window[window.length - 1] as CandleFacts
  const drift = (last.close - first.close) / (scale * Math.sqrt(lookback))

  const trend: PriorTrend = drift >= tolerance.trendStrength ? 'up' : drift <= -tolerance.trendStrength ? 'down' : 'flat'
  return {
    trend,
    drift,
    lookback,
    describe:
      trend === 'flat'
        ? `Over the previous ${lookback} candles the market drifted ${drift.toFixed(2)} of its own volatility, which is not a trend either way.`
        : `Over the previous ${lookback} candles the market moved ${drift.toFixed(2)} of its own volatility, a ${trend === 'up' ? 'rise' : 'decline'}.`
  }
}

const afterTrend = (want: 'up' | 'down', required: boolean): Rule =>
  rule(
    `prior-trend-${want}`,
    `it appears after a ${want === 'up' ? 'rise' : 'decline'}`,
    (w) => {
      const reading = priorTrend(w.prior, w.stats, w.tolerance)
      if (reading.trend === want) {
        return pass(reading.drift === null ? 0.5 : Math.min(1, Math.abs(reading.drift) / (w.tolerance.trendStrength * 2)), reading.describe)
      }
      return fail(reading.describe)
    },
    required
  )

// ---------------------------------------------------------------- the schema

export type PatternCategory = 'reversal' | 'continuation' | 'indecision'
export type PatternDirection = 'bullish' | 'bearish' | 'neutral'

export interface PatternDefinition {
  /** Stable for ever. Aliases change, names get translated, this does not. */
  id: string
  name: string
  aliases: string[]
  category: PatternCategory
  direction: PatternDirection
  /** How many candles the formation is. The detector never looks at more than this for its structural rules. */
  formationLength: number
  /** Rules about the shape of the formation itself. */
  rules: Rule[]
  /** Rules about what came before it. Kept separate because a Hammer and a Hanging Man differ only here. */
  contextRules: Rule[]
  /**
   * Patterns this one is a more specific case of.
   *
   * A Dragonfly Doji is also a Doji. Both are true and both are stored; this is what lets the alert layer report the
   * most specific name rather than three notifications about one candle.
   */
  specialises: string[]
  related: string[]
  /** Bumped when the rules change. A stored detection keeps the version that produced it. */
  version: number
  describe: string
  /** What would confirm it, stated as an observation to wait for rather than as a prediction. */
  confirmation: string | null
  /** What would invalidate it after it formed. */
  invalidation: string | null
  /** Which candles of the formation to emphasise on a chart. Indexes into the formation, oldest first. */
  emphasis: number[]
}

const definition = (one: Omit<PatternDefinition, 'aliases' | 'specialises' | 'related' | 'version' | 'confirmation' | 'invalidation' | 'emphasis'> &
  Partial<Pick<PatternDefinition, 'aliases' | 'specialises' | 'related' | 'version' | 'confirmation' | 'invalidation' | 'emphasis'>>): PatternDefinition => ({
  aliases: [],
  specialises: [],
  related: [],
  version: 1,
  confirmation: null,
  invalidation: null,
  emphasis: Array.from({ length: one.formationLength }, (_, i) => i),
  ...one
})

// ---------------------------------------------------------------- single-candle patterns

const SINGLE: PatternDefinition[] = [
  definition({
    id: 'doji',
    name: 'Doji',
    aliases: ['Standard Doji', 'Neutral Doji'],
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [dojiBody(0)],
    contextRules: [],
    related: ['long-legged-doji', 'dragonfly-doji', 'gravestone-doji', 'four-price-doji', 'spinning-top'],
    describe: 'The candle opened and closed at essentially the same price. Buyers and sellers finished where they started.',
    confirmation: 'A doji says the period was balanced. What follows it is the next candle, not a consequence of it.',
    invalidation: null
  }),
  definition({
    id: 'long-legged-doji',
    name: 'Long-Legged Doji',
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [dojiBody(0), longShadowsBothSides(0)],
    contextRules: [],
    specialises: ['doji'],
    related: ['doji', 'rickshaw-man', 'high-wave'],
    describe: 'A doji with long shadows on both sides: price travelled a long way in both directions and came back to where it opened.'
  }),
  definition({
    id: 'dragonfly-doji',
    name: 'Dragonfly Doji',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 1,
    rules: [dojiBody(0), longLowerWick(0), shortUpperWick(0)],
    contextRules: [],
    specialises: ['doji'],
    related: ['doji', 'gravestone-doji', 'hammer', 'takuri'],
    describe: 'A doji whose open, high and close are all near the top of the range. Price fell through the period and returned to the open.'
  }),
  definition({
    id: 'gravestone-doji',
    name: 'Gravestone Doji',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 1,
    rules: [dojiBody(0), longUpperWick(0), shortLowerWick(0)],
    contextRules: [],
    specialises: ['doji'],
    related: ['doji', 'dragonfly-doji', 'shooting-star'],
    describe: 'A doji whose open, low and close are all near the bottom of the range. Price rose through the period and gave it all back.'
  }),
  definition({
    id: 'four-price-doji',
    name: 'Four-Price Doji',
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [
      rule('candle-0-no-range', 'the open, high, low and close are all the same price', (w) => {
        const one = at(w, 0)
        return one.range === 0
          ? pass(1, `all four prices are ${one.close}`)
          : fail(`the range is ${Number(one.range.toPrecision(6))}, so the four prices are not identical`)
      })
    ],
    contextRules: [],
    specialises: ['doji'],
    related: ['doji'],
    describe: 'Every price in the period was the same. On a liquid market this usually means almost nothing traded rather than a balanced fight.'
  }),
  definition({
    id: 'rickshaw-man',
    name: 'Rickshaw Man',
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [
      dojiBody(0),
      longShadowsBothSides(0),
      rule('candle-0-body-centred', 'the body sits near the middle of the range', (w) => {
        const one = at(w, 0)
        if (one.range <= 0) return fail('the candle has no range')
        const offset = Math.abs(one.bodyMid - one.candleMid) / one.range
        return offset <= 0.1
          ? pass(margin(offset, 0.1, 'below'), `the body sits ${pct(offset)} of the range from the middle`)
          : fail(`the body sits ${pct(offset)} of the range from the middle, past the 10% allowed`)
      })
    ],
    contextRules: [],
    specialises: ['long-legged-doji', 'doji'],
    related: ['long-legged-doji'],
    describe: 'A long-legged doji whose body is centred in the range: the period was as indecisive as a period can be.'
  }),
  definition({
    id: 'high-wave',
    name: 'High-Wave Candle',
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [
      notDoji(0),
      shortBody(0),
      longShadowsBothSides(0)
    ],
    contextRules: [],
    related: ['long-legged-doji', 'spinning-top'],
    describe: 'A small body with long shadows both sides. Not quite a doji, and the same message: a lot of movement, no resolution.'
  }),
  definition({
    id: 'spinning-top',
    name: 'Spinning Top',
    category: 'indecision',
    direction: 'neutral',
    formationLength: 1,
    rules: [
      notDoji(0),
      shortBody(0),
      rule('candle-0-shadows-both-sides', 'there are shadows on both sides, each at least as long as the body', (w) => {
        const one = at(w, 0)
        if (one.range <= 0 || one.body <= 0) return fail('the candle has no body to compare its shadows against')
        const smaller = Math.min(one.upperWick, one.lowerWick)
        return smaller >= one.body
          ? pass(Math.min(1, smaller / (one.body * 3)), `the shorter shadow is ${mult(smaller / one.body)} the body`)
          : fail(`the shorter shadow is ${mult(smaller / one.body)} the body, where it must be at least one`)
      })
    ],
    contextRules: [],
    related: ['high-wave', 'doji'],
    describe: 'A small body between two shadows. The period moved and finished close to where it began.'
  }),
  definition({
    id: 'hammer',
    name: 'Hammer',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 1,
    rules: [notDoji(0), longLowerWick(0), shortUpperWick(0), bodyInUpperRange(0)],
    // Required: a Hammer and a Hanging Man are the same shape, and only this tells them apart.
    contextRules: [afterTrend('down', true)],
    related: ['hanging-man', 'inverted-hammer', 'takuri', 'dragonfly-doji'],
    describe: 'After a decline, a candle that fell hard and closed back near its high, leaving a long lower shadow.',
    confirmation: 'A close above the hammer’s high on a later candle is the usual thing to wait for. It is an observation to look for, not an outcome.',
    invalidation: 'A close below the hammer’s low removes what the shape described.'
  }),
  definition({
    id: 'hanging-man',
    name: 'Hanging Man',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 1,
    rules: [notDoji(0), longLowerWick(0), shortUpperWick(0), bodyInUpperRange(0)],
    contextRules: [afterTrend('up', true)],
    related: ['hammer', 'shooting-star'],
    describe: 'The same shape as a Hammer, but after a rise instead of a decline. The name changes because the situation does.',
    confirmation: 'A close below the hanging man’s low on a later candle is the usual thing to wait for.',
    invalidation: 'A close above its high removes what the shape described.'
  }),
  definition({
    id: 'inverted-hammer',
    name: 'Inverted Hammer',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 1,
    rules: [notDoji(0), longUpperWick(0), shortLowerWick(0), bodyInLowerRange(0)],
    contextRules: [afterTrend('down', true)],
    related: ['hammer', 'shooting-star', 'gravestone-doji'],
    describe: 'After a decline, a candle that rose a long way and gave most of it back, closing near its low.'
  }),
  definition({
    id: 'shooting-star',
    name: 'Shooting Star',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 1,
    rules: [notDoji(0), longUpperWick(0), shortLowerWick(0), bodyInLowerRange(0)],
    contextRules: [afterTrend('up', true)],
    related: ['inverted-hammer', 'hanging-man', 'gravestone-doji'],
    describe: 'The same shape as an Inverted Hammer, after a rise. Price ran up through the period and closed back near where it started.'
  }),
  definition({
    id: 'takuri',
    name: 'Takuri Line',
    aliases: ['Takuri'],
    category: 'reversal',
    direction: 'bullish',
    formationLength: 1,
    rules: [
      notDoji(0),
      shortUpperWick(0),
      bodyInUpperRange(0),
      rule('candle-0-very-long-lower-wick', 'the lower shadow is at least three times the body', (w) => {
        const one = at(w, 0)
        if (one.body <= 0) return fail('the candle has no body to compare the shadow against')
        const ratio = one.lowerWick / one.body
        return ratio >= 3
          ? pass(Math.min(1, (ratio - 3) / 3), `the lower shadow is ${mult(ratio)} the body`)
          : fail(`the lower shadow is ${mult(ratio)} the body, short of the three required`)
      })
    ],
    contextRules: [afterTrend('down', true)],
    specialises: ['hammer'],
    related: ['hammer', 'dragonfly-doji'],
    describe: 'A hammer with an unusually long lower shadow: at least three times its own body.'
  }),
  definition({
    id: 'bullish-marubozu',
    name: 'Bullish Marubozu',
    aliases: ['White Marubozu'],
    category: 'continuation',
    direction: 'bullish',
    formationLength: 1,
    rules: [bullish(0), notDoji(0), shortUpperWick(0), shortLowerWick(0), longBody(0)],
    contextRules: [],
    related: ['bearish-marubozu', 'bullish-belt-hold'],
    describe: 'A long rising candle with almost no shadows: it opened at its low, closed at its high, and never looked back.'
  }),
  definition({
    id: 'bearish-marubozu',
    name: 'Bearish Marubozu',
    aliases: ['Black Marubozu'],
    category: 'continuation',
    direction: 'bearish',
    formationLength: 1,
    rules: [bearish(0), notDoji(0), shortUpperWick(0), shortLowerWick(0), longBody(0)],
    contextRules: [],
    related: ['bullish-marubozu', 'bearish-belt-hold'],
    describe: 'A long falling candle with almost no shadows: it opened at its high and closed at its low.'
  }),
  definition({
    id: 'bullish-belt-hold',
    name: 'Bullish Belt Hold',
    aliases: ['Opening Marubozu (bullish)'],
    category: 'reversal',
    direction: 'bullish',
    formationLength: 1,
    rules: [bullish(0), notDoji(0), longBody(0), shortLowerWick(0)],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-marubozu', 'bearish-belt-hold'],
    describe: 'A long rising candle that opened at its low. It may have an upper shadow; what matters is that it never traded below its open.'
  }),
  definition({
    id: 'bearish-belt-hold',
    name: 'Bearish Belt Hold',
    aliases: ['Opening Marubozu (bearish)'],
    category: 'reversal',
    direction: 'bearish',
    formationLength: 1,
    rules: [bearish(0), notDoji(0), longBody(0), shortUpperWick(0)],
    contextRules: [afterTrend('up', false)],
    related: ['bearish-marubozu', 'bullish-belt-hold'],
    describe: 'A long falling candle that opened at its high and never traded above it.'
  }),
  definition({
    id: 'long-candle',
    name: 'Long Candle',
    category: 'continuation',
    direction: 'neutral',
    formationLength: 1,
    rules: [
      notDoji(0),
      longBody(0),
      rule('candle-0-large-range', 'the range is large for this market', (w) => {
        const one = at(w, 0)
        const median = w.stats.medianRange
        if (median === null || median <= 0 || w.stats.sample < 5) return fail('there is not enough recent history to say whether this range is large')
        const ratio = one.range / median
        return ratio >= 1.5
          ? pass(Math.min(1, (ratio - 1.5) / 1.5), `its range is ${mult(ratio)} the recent median`)
          : fail(`its range is ${mult(ratio)} the recent median, short of the 1.50× required`)
      })
    ],
    contextRules: [],
    related: ['bullish-marubozu', 'bearish-marubozu'],
    describe: 'A candle much larger than the market has been producing. A structural classification rather than a named formation.'
  })
]

// ---------------------------------------------------------------- two-candle patterns

const TWO: PatternDefinition[] = [
  definition({
    id: 'bullish-engulfing',
    name: 'Bullish Engulfing',
    aliases: ['Bullish Outside Body'],
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [bearish(0), bullish(1), notDoji(1), engulfing(1, 0)],
    contextRules: [afterTrend('down', false)],
    related: ['bearish-engulfing', 'bullish-harami', 'piercing-line', 'three-outside-up'],
    emphasis: [0, 1],
    describe: 'A falling candle followed by a rising one whose body completely covers it.',
    confirmation: 'A later close above the engulfing candle’s high is what is usually waited for.',
    invalidation: 'A close below the engulfing candle’s low removes what the shape described.'
  }),
  definition({
    id: 'bearish-engulfing',
    name: 'Bearish Engulfing',
    aliases: ['Bearish Outside Body'],
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [bullish(0), bearish(1), notDoji(1), engulfing(1, 0)],
    contextRules: [afterTrend('up', false)],
    related: ['bullish-engulfing', 'bearish-harami', 'dark-cloud-cover', 'three-outside-down'],
    describe: 'A rising candle followed by a falling one whose body completely covers it.'
  }),
  definition({
    id: 'bullish-harami',
    name: 'Bullish Harami',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [bearish(0), longBody(0), bullish(1), notDoji(1), inside(1, 0)],
    contextRules: [afterTrend('down', false)],
    related: ['bearish-harami', 'bullish-harami-cross', 'bullish-engulfing', 'three-inside-up'],
    describe: 'A long falling candle followed by a small rising one contained entirely within it. The fall stopped being pressed.'
  }),
  definition({
    id: 'bearish-harami',
    name: 'Bearish Harami',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [bullish(0), longBody(0), bearish(1), notDoji(1), inside(1, 0)],
    contextRules: [afterTrend('up', false)],
    related: ['bullish-harami', 'bearish-harami-cross', 'bearish-engulfing', 'three-inside-down'],
    describe: 'A long rising candle followed by a small falling one contained entirely within it.'
  }),
  definition({
    id: 'bullish-harami-cross',
    name: 'Bullish Harami Cross',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [bearish(0), longBody(0), dojiBody(1), inside(1, 0)],
    contextRules: [afterTrend('down', false)],
    specialises: ['bullish-harami'],
    related: ['bullish-harami', 'bearish-harami-cross', 'doji'],
    describe: 'A harami whose second candle is a doji: the pause is as complete as it can be.'
  }),
  definition({
    id: 'bearish-harami-cross',
    name: 'Bearish Harami Cross',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [bullish(0), longBody(0), dojiBody(1), inside(1, 0)],
    contextRules: [afterTrend('up', false)],
    specialises: ['bearish-harami'],
    related: ['bearish-harami', 'bullish-harami-cross', 'doji'],
    describe: 'A bearish harami whose second candle is a doji.'
  }),
  definition({
    id: 'piercing-line',
    name: 'Piercing Line',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      notDoji(1),
      rule('open-1-below-low-0', 'the second candle opens below the first candle’s low', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.open < b.low
          ? pass(Math.min(1, (b.low - a.open) / Math.max(scaleOf(b, w.stats), 1e-12)), `opened at ${a.open}, below the low of ${b.low}`)
          : fail(`opened at ${a.open}, not below the low of ${b.low}`)
      }),
      closesPastMidpoint(1, 0, true),
      rule('close-1-below-open-0', 'the second candle closes below the first candle’s open', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.close < b.open
          ? pass(0.8, `closed at ${a.close}, still below the first open of ${b.open}`)
          : fail(`closed at ${a.close}, at or above the first open of ${b.open}, which would make this an engulfing instead`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['dark-cloud-cover', 'bullish-engulfing', 'on-neck', 'in-neck', 'thrusting'],
    describe: 'A falling candle, then one that opens lower still and closes back above the midpoint of the first body.'
  }),
  definition({
    id: 'dark-cloud-cover',
    name: 'Dark Cloud Cover',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      longBody(0),
      bearish(1),
      notDoji(1),
      rule('open-1-above-high-0', 'the second candle opens above the first candle’s high', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.open > b.high
          ? pass(Math.min(1, (a.open - b.high) / Math.max(scaleOf(b, w.stats), 1e-12)), `opened at ${a.open}, above the high of ${b.high}`)
          : fail(`opened at ${a.open}, not above the high of ${b.high}`)
      }),
      closesPastMidpoint(1, 0, false),
      rule('close-1-above-open-0', 'the second candle closes above the first candle’s open', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.close > b.open
          ? pass(0.8, `closed at ${a.close}, still above the first open of ${b.open}`)
          : fail(`closed at ${a.close}, at or below the first open of ${b.open}, which would make this an engulfing instead`)
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['piercing-line', 'bearish-engulfing'],
    describe: 'A rising candle, then one that opens higher still and closes back below the midpoint of the first body.'
  }),
  definition({
    id: 'tweezer-top',
    name: 'Tweezer Top',
    aliases: ['Matching High'],
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      equalPrices('equal-highs', 'both candles reach the same high', (w) => [at(w, 0).high, at(w, 1).high, at(w, 0)]),
      rule('different-directions-top', 'the two candles close in opposite directions', (w) => {
        const a = at(w, 0)
        const b = at(w, 1)
        return a.direction === 'bullish' && b.direction === 'bearish'
          ? pass(0.8, 'the first rose and the second fell')
          : fail(`the first was ${a.direction} and the second ${b.direction}`)
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['tweezer-bottom', 'matching-high'],
    describe: 'Two candles reaching the same high, the second failing where the first did.'
  }),
  definition({
    id: 'tweezer-bottom',
    name: 'Tweezer Bottom',
    aliases: ['Matching Low'],
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      equalPrices('equal-lows', 'both candles reach the same low', (w) => [at(w, 0).low, at(w, 1).low, at(w, 0)]),
      rule('different-directions-bottom', 'the two candles close in opposite directions', (w) => {
        const a = at(w, 0)
        const b = at(w, 1)
        return a.direction === 'bearish' && b.direction === 'bullish'
          ? pass(0.8, 'the first fell and the second rose')
          : fail(`the first was ${a.direction} and the second ${b.direction}`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['tweezer-top', 'matching-low'],
    describe: 'Two candles reaching the same low, the second holding where the first did.'
  }),
  definition({
    id: 'matching-low',
    name: 'Matching Low',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      bearish(1),
      equalPrices('equal-closes-low', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('down', false)],
    related: ['tweezer-bottom', 'matching-high'],
    describe: 'Two falling candles closing at the same price. The second could not push below where the first finished.'
  }),
  definition({
    id: 'matching-high',
    name: 'Matching High',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      bullish(1),
      equalPrices('equal-closes-high', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('up', false)],
    related: ['tweezer-top', 'matching-low'],
    describe: 'Two rising candles closing at the same price.'
  }),
  definition({
    id: 'homing-pigeon',
    name: 'Homing Pigeon',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [bearish(0), longBody(0), bearish(1), inside(1, 0)],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-harami'],
    describe: 'A long falling candle followed by a smaller falling one inside it. The selling continued but with less force.'
  }),
  definition({
    id: 'bullish-meeting-lines',
    name: 'Bullish Meeting Lines',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      longBody(1),
      opensBeyond(1, 0, 'below-low'),
      equalPrices('meeting-closes-bull', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-counterattack', 'piercing-line'],
    describe: 'A long fall, then a gap lower that is bought all the way back to the previous close.'
  }),
  definition({
    id: 'bearish-meeting-lines',
    name: 'Bearish Meeting Lines',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      longBody(0),
      bearish(1),
      longBody(1),
      opensBeyond(1, 0, 'above-high'),
      equalPrices('meeting-closes-bear', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('up', false)],
    related: ['bearish-counterattack', 'dark-cloud-cover'],
    describe: 'A long rise, then a gap higher that is sold all the way back to the previous close.'
  }),
  definition({
    id: 'bullish-counterattack',
    name: 'Bullish Counterattack',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      bullish(1),
      opensBeyond(1, 0, 'below-low'),
      equalPrices('counter-closes-bull', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-meeting-lines'],
    describe: 'The same closing price after a gap lower. Definitions vary on how long the bodies must be; Orbis does not require them to be long here.'
  }),
  definition({
    id: 'bearish-counterattack',
    name: 'Bearish Counterattack',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      bearish(1),
      opensBeyond(1, 0, 'above-high'),
      equalPrices('counter-closes-bear', 'both candles close at the same price', (w) => [at(w, 0).close, at(w, 1).close, at(w, 0)])
    ],
    contextRules: [afterTrend('up', false)],
    related: ['bearish-meeting-lines'],
    describe: 'The same closing price after a gap higher.'
  }),
  definition({
    id: 'bullish-kicking',
    name: 'Bullish Kicking',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      shortUpperWick(0),
      shortLowerWick(0),
      bullish(1),
      shortUpperWick(1),
      shortLowerWick(1),
      windowBetween(1, 0, 'up')
    ],
    // Kicking is defined by the gap between two marubozu, not by what preceded it.
    contextRules: [],
    related: ['bearish-kicking', 'bullish-marubozu'],
    describe: 'A falling marubozu followed by a rising one, with a window between them. Direction reversed without any overlap at all.'
  }),
  definition({
    id: 'bearish-kicking',
    name: 'Bearish Kicking',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      shortUpperWick(0),
      shortLowerWick(0),
      bearish(1),
      shortUpperWick(1),
      shortLowerWick(1),
      windowBetween(1, 0, 'down')
    ],
    contextRules: [],
    related: ['bullish-kicking', 'bearish-marubozu'],
    describe: 'A rising marubozu followed by a falling one, with a window between them.'
  }),
  definition({
    id: 'bullish-separating-lines',
    name: 'Bullish Separating Lines',
    category: 'continuation',
    direction: 'bullish',
    formationLength: 2,
    rules: [
      bearish(0),
      bullish(1),
      longBody(1),
      equalPrices('separating-opens-bull', 'both candles open at the same price', (w) => [at(w, 0).open, at(w, 1).open, at(w, 0)]),
      shortLowerWick(1)
    ],
    contextRules: [afterTrend('up', true)],
    related: ['bearish-separating-lines'],
    describe: 'In a rise, a falling candle followed by a rising one that opens at the same price and runs from its low. The interruption was undone.'
  }),
  definition({
    id: 'bearish-separating-lines',
    name: 'Bearish Separating Lines',
    category: 'continuation',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bullish(0),
      bearish(1),
      longBody(1),
      equalPrices('separating-opens-bear', 'both candles open at the same price', (w) => [at(w, 0).open, at(w, 1).open, at(w, 0)]),
      shortUpperWick(1)
    ],
    contextRules: [afterTrend('down', true)],
    related: ['bullish-separating-lines'],
    describe: 'In a decline, a rising candle followed by a falling one that opens at the same price and runs from its high.'
  }),
  definition({
    id: 'on-neck',
    name: 'On-Neck Line',
    category: 'continuation',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      rule('open-1-below-low-0-neck', 'the second candle opens below the first candle’s low', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.open < b.low ? pass(0.7, `opened at ${a.open}, below the low of ${b.low}`) : fail(`opened at ${a.open}, not below the low of ${b.low}`)
      }),
      equalPrices('close-1-at-low-0', 'the second candle closes at the first candle’s low', (w) => [at(w, 1).close, at(w, 0).low, at(w, 0)])
    ],
    contextRules: [afterTrend('down', false)],
    related: ['in-neck', 'thrusting', 'piercing-line'],
    describe: 'A rally after a gap lower that stops exactly at the previous low. The weakest of the piercing family.'
  }),
  definition({
    id: 'in-neck',
    name: 'In-Neck Line',
    category: 'continuation',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      rule('open-1-below-low-0-in', 'the second candle opens below the first candle’s low', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.open < b.low ? pass(0.7, `opened at ${a.open}, below the low of ${b.low}`) : fail(`opened at ${a.open}, not below the low of ${b.low}`)
      }),
      rule('close-1-just-into-0', 'the second candle closes just inside the first candle’s body', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        if (a.close <= b.close) return fail(`closed at ${a.close}, at or below the first close of ${b.close}`)
        const into = (a.close - b.close) / Math.max(b.body, 1e-12)
        return into <= 0.25
          ? pass(margin(into, 0.25, 'below'), `closed ${pct(into)} into the first body`)
          : fail(`closed ${pct(into)} into the first body, further than the 25% an in-neck allows`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['on-neck', 'thrusting', 'piercing-line'],
    describe: 'A rally after a gap lower that closes barely inside the previous body.'
  }),
  definition({
    id: 'thrusting',
    name: 'Thrusting Line',
    category: 'continuation',
    direction: 'bearish',
    formationLength: 2,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      rule('open-1-below-low-0-thrust', 'the second candle opens below the first candle’s low', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        return a.open < b.low ? pass(0.7, `opened at ${a.open}, below the low of ${b.low}`) : fail(`opened at ${a.open}, not below the low of ${b.low}`)
      }),
      rule('close-1-under-mid-0', 'the second candle closes inside the first body but below its midpoint', (w) => {
        const a = at(w, 1)
        const b = at(w, 0)
        if (a.close <= b.close) return fail(`closed at ${a.close}, at or below the first close of ${b.close}`)
        if (a.close >= b.bodyMid) return fail(`closed at ${a.close}, at or above the midpoint ${Number(b.bodyMid.toPrecision(10))}, which would be a piercing line`)
        const into = (a.close - b.close) / Math.max(b.body, 1e-12)
        return into > 0.25
          ? pass(margin(into, 0.25, 'above'), `closed ${pct(into)} into the first body, below its midpoint`)
          : fail(`closed only ${pct(into)} into the first body, which is an in-neck rather than a thrust`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['on-neck', 'in-neck', 'piercing-line'],
    describe: 'A rally after a gap lower that gets well into the previous body but not past its midpoint. One step short of a piercing line.'
  })
]

// ---------------------------------------------------------------- three-candle patterns

const soldiers = (direction: 'bullish' | 'bearish'): Rule[] => {
  const each = direction === 'bullish' ? bullish : bearish
  return [
    each(0),
    each(1),
    each(2),
    longBody(0),
    longBody(1),
    longBody(2),
    rule(`${direction}-progressive-closes`, `each candle closes ${direction === 'bullish' ? 'above' : 'below'} the one before`, (w) => {
      const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
      const ok = direction === 'bullish' ? b.close > a.close && c.close > b.close : b.close < a.close && c.close < b.close
      return ok
        ? pass(0.8, `closes ran ${a.close} → ${b.close} → ${c.close}`)
        : fail(`closes ran ${a.close} → ${b.close} → ${c.close}, which does not move consistently`)
    }),
    rule(`${direction}-opens-within-previous-body`, 'each candle opens inside the previous candle’s body', (w) => {
      const pairs: [CandleFacts, CandleFacts][] = [[at(w, 0), at(w, 1)], [at(w, 1), at(w, 2)]]
      for (const [before, now] of pairs) {
        if (now.open > before.bodyTop || now.open < before.bodyBottom) {
          return fail(`one candle opened at ${now.open}, outside the previous body of ${before.bodyBottom}–${before.bodyTop}`)
        }
      }
      return pass(0.8, 'each candle opened inside the body before it')
    })
  ]
}

const THREE: PatternDefinition[] = [
  definition({
    id: 'morning-star',
    name: 'Morning Star',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bearish(0),
      longBody(0),
      shortBody(1),
      bullish(2),
      longBody(2),
      rule('star-below-first-body', 'the middle candle’s body sits below the first candle’s body', (w) => {
        const star = at(w, 1)
        const first = at(w, 0)
        return star.bodyTop < first.bodyBottom
          ? pass(0.9, `the star’s body tops out at ${star.bodyTop}, below the first body’s ${first.bodyBottom}`)
          : fail(`the star’s body tops out at ${star.bodyTop}, not below the first body’s ${first.bodyBottom}`)
      }),
      closesPastMidpoint(2, 0, true)
    ],
    contextRules: [afterTrend('down', false)],
    related: ['evening-star', 'morning-doji-star', 'three-inside-up'],
    emphasis: [0, 1, 2],
    describe: 'A long fall, a small candle that gaps below it, then a long rise that recovers past the midpoint of the fall.'
  }),
  definition({
    id: 'evening-star',
    name: 'Evening Star',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      longBody(0),
      shortBody(1),
      bearish(2),
      longBody(2),
      rule('star-above-first-body', 'the middle candle’s body sits above the first candle’s body', (w) => {
        const star = at(w, 1)
        const first = at(w, 0)
        return star.bodyBottom > first.bodyTop
          ? pass(0.9, `the star’s body bottoms at ${star.bodyBottom}, above the first body’s ${first.bodyTop}`)
          : fail(`the star’s body bottoms at ${star.bodyBottom}, not above the first body’s ${first.bodyTop}`)
      }),
      closesPastMidpoint(2, 0, false)
    ],
    contextRules: [afterTrend('up', false)],
    related: ['morning-star', 'evening-doji-star', 'three-inside-down'],
    describe: 'A long rise, a small candle that gaps above it, then a long fall that gives back more than half of the rise.'
  }),
  definition({
    id: 'morning-doji-star',
    name: 'Morning Doji Star',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bearish(0),
      longBody(0),
      dojiBody(1),
      bullish(2),
      longBody(2),
      rule('doji-star-below-first', 'the doji sits below the first candle’s body', (w) => {
        const star = at(w, 1)
        const first = at(w, 0)
        return star.bodyTop < first.bodyBottom
          ? pass(0.9, `the doji sits at ${star.bodyTop}, below the first body’s ${first.bodyBottom}`)
          : fail(`the doji sits at ${star.bodyTop}, not below the first body’s ${first.bodyBottom}`)
      }),
      closesPastMidpoint(2, 0, true)
    ],
    contextRules: [afterTrend('down', false)],
    specialises: ['morning-star'],
    related: ['morning-star', 'evening-doji-star'],
    describe: 'A morning star whose middle candle is a doji.'
  }),
  definition({
    id: 'evening-doji-star',
    name: 'Evening Doji Star',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      longBody(0),
      dojiBody(1),
      bearish(2),
      longBody(2),
      rule('doji-star-above-first', 'the doji sits above the first candle’s body', (w) => {
        const star = at(w, 1)
        const first = at(w, 0)
        return star.bodyBottom > first.bodyTop
          ? pass(0.9, `the doji sits at ${star.bodyBottom}, above the first body’s ${first.bodyTop}`)
          : fail(`the doji sits at ${star.bodyBottom}, not above the first body’s ${first.bodyTop}`)
      }),
      closesPastMidpoint(2, 0, false)
    ],
    contextRules: [afterTrend('up', false)],
    specialises: ['evening-star'],
    related: ['evening-star', 'morning-doji-star'],
    describe: 'An evening star whose middle candle is a doji.'
  }),
  definition({
    id: 'three-white-soldiers',
    name: 'Three White Soldiers',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      ...soldiers('bullish'),
      rule('soldiers-short-upper-wicks', 'none of the three has a long upper shadow', (w) => {
        for (let i = 0; i < 3; i += 1) {
          const one = at(w, i)
          if (one.upperWickRatio !== null && one.upperWickRatio > 0.3) {
            return fail(`candle ${i + 1} has an upper shadow of ${pct(one.upperWickRatio)}, past the 30% allowed`)
          }
        }
        return pass(0.8, 'all three closed near their highs')
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['three-black-crows', 'advance-block', 'deliberation'],
    describe: 'Three long rising candles, each opening inside the last body and closing near its own high.'
  }),
  definition({
    id: 'three-black-crows',
    name: 'Three Black Crows',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      ...soldiers('bearish'),
      rule('crows-short-lower-wicks', 'none of the three has a long lower shadow', (w) => {
        for (let i = 0; i < 3; i += 1) {
          const one = at(w, i)
          if (one.lowerWickRatio !== null && one.lowerWickRatio > 0.3) {
            return fail(`candle ${i + 1} has a lower shadow of ${pct(one.lowerWickRatio)}, past the 30% allowed`)
          }
        }
        return pass(0.8, 'all three closed near their lows')
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['three-white-soldiers', 'identical-three-crows'],
    describe: 'Three long falling candles, each opening inside the last body and closing near its own low.'
  }),
  definition({
    id: 'identical-three-crows',
    name: 'Identical Three Crows',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bearish(0),
      bearish(1),
      bearish(2),
      longBody(0),
      longBody(1),
      longBody(2),
      rule('crows-open-at-previous-close', 'each candle opens at the previous candle’s close', (w) => {
        const pairs: [CandleFacts, CandleFacts][] = [[at(w, 0), at(w, 1)], [at(w, 1), at(w, 2)]]
        for (const [before, now] of pairs) {
          if (!nearlyEqual(now.open, before.close, scaleOf(before, w.stats), w.tolerance.equality)) {
            return fail(`one candle opened at ${now.open} where the previous closed at ${before.close}`)
          }
        }
        return pass(0.9, 'each candle opened where the last one closed')
      })
    ],
    contextRules: [afterTrend('up', false)],
    specialises: ['three-black-crows'],
    related: ['three-black-crows'],
    describe: 'Three black crows in which each candle opens exactly where the previous one closed, with no relief between them.'
  }),
  definition({
    id: 'three-inside-up',
    name: 'Three Inside Up',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bearish(0),
      longBody(0),
      bullish(1),
      inside(1, 0),
      bullish(2),
      rule('third-closes-above-first-open', 'the third candle closes above the first candle’s open', (w) => {
        const c = at(w, 2)
        const a = at(w, 0)
        return c.close > a.open
          ? pass(0.9, `closed at ${c.close}, above the first open of ${a.open}`)
          : fail(`closed at ${c.close}, not above the first open of ${a.open}`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-harami', 'three-inside-down', 'three-outside-up'],
    describe: 'A bullish harami whose third candle carries the recovery past the start of the fall.'
  }),
  definition({
    id: 'three-inside-down',
    name: 'Three Inside Down',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      longBody(0),
      bearish(1),
      inside(1, 0),
      bearish(2),
      rule('third-closes-below-first-open', 'the third candle closes below the first candle’s open', (w) => {
        const c = at(w, 2)
        const a = at(w, 0)
        return c.close < a.open
          ? pass(0.9, `closed at ${c.close}, below the first open of ${a.open}`)
          : fail(`closed at ${c.close}, not below the first open of ${a.open}`)
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['bearish-harami', 'three-inside-up', 'three-outside-down'],
    describe: 'A bearish harami whose third candle carries the decline past the start of the rise.'
  }),
  definition({
    id: 'three-outside-up',
    name: 'Three Outside Up',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bearish(0),
      bullish(1),
      engulfing(1, 0),
      bullish(2),
      rule('third-closes-above-second', 'the third candle closes above the second’s close', (w) => {
        const c = at(w, 2)
        const b = at(w, 1)
        return c.close > b.close ? pass(0.9, `closed at ${c.close}, above ${b.close}`) : fail(`closed at ${c.close}, not above ${b.close}`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['bullish-engulfing', 'three-inside-up'],
    describe: 'A bullish engulfing followed by a third candle that closes higher still.'
  }),
  definition({
    id: 'three-outside-down',
    name: 'Three Outside Down',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      bearish(1),
      engulfing(1, 0),
      bearish(2),
      rule('third-closes-below-second', 'the third candle closes below the second’s close', (w) => {
        const c = at(w, 2)
        const b = at(w, 1)
        return c.close < b.close ? pass(0.9, `closed at ${c.close}, below ${b.close}`) : fail(`closed at ${c.close}, not below ${b.close}`)
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['bearish-engulfing', 'three-inside-down'],
    describe: 'A bearish engulfing followed by a third candle that closes lower still.'
  }),
  definition({
    id: 'tri-star',
    name: 'Tri-Star',
    category: 'reversal',
    direction: 'neutral',
    formationLength: 3,
    rules: [
      dojiBody(0),
      dojiBody(1),
      dojiBody(2),
      rule('middle-doji-gapped', 'the middle doji sits clear of the two either side', (w) => {
        const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
        const above = b.bodyBottom > a.bodyTop && b.bodyBottom > c.bodyTop
        const below = b.bodyTop < a.bodyBottom && b.bodyTop < c.bodyBottom
        return above || below
          ? pass(0.9, `the middle doji sits ${above ? 'above' : 'below'} both of the others`)
          : fail('the middle doji overlaps the ones either side of it')
      })
    ],
    contextRules: [],
    related: ['doji', 'morning-doji-star', 'evening-doji-star'],
    describe: 'Three dojis in a row with the middle one gapped clear. Rare, and on a continuously traded market rarer still.'
  }),
  definition({
    id: 'advance-block',
    name: 'Advance Block',
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      bullish(1),
      bullish(2),
      longBody(0),
      rule('bodies-shrinking', 'each body is smaller than the one before', (w) => {
        const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
        return b.body < a.body && c.body < b.body
          ? pass(0.8, `bodies ran ${Number(a.body.toPrecision(4))} → ${Number(b.body.toPrecision(4))} → ${Number(c.body.toPrecision(4))}`)
          : fail(`bodies ran ${Number(a.body.toPrecision(4))} → ${Number(b.body.toPrecision(4))} → ${Number(c.body.toPrecision(4))}, which is not shrinking`)
      }),
      rule('upper-wicks-growing', 'the later candles leave longer upper shadows', (w) => {
        const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
        return c.upperWick > a.upperWick && (b.upperWick > a.upperWick || c.upperWick > b.upperWick)
          ? pass(0.7, 'the upper shadows lengthened as the advance went on')
          : fail('the upper shadows did not lengthen')
      })
    ],
    contextRules: [afterTrend('up', true)],
    related: ['three-white-soldiers', 'deliberation'],
    describe: 'Three rising candles whose bodies shrink and whose upper shadows lengthen: an advance running out of force.'
  }),
  definition({
    id: 'deliberation',
    name: 'Deliberation',
    aliases: ['Stalled Pattern'],
    category: 'reversal',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bullish(0),
      bullish(1),
      bullish(2),
      longBody(0),
      longBody(1),
      shortBody(2),
      rule('third-near-second-close', 'the third candle opens at or near the second’s close', (w) => {
        const b = at(w, 1)
        const c = at(w, 2)
        return c.open >= b.bodyBottom
          ? pass(0.8, `opened at ${c.open}, at or above the second body’s base of ${b.bodyBottom}`)
          : fail(`opened at ${c.open}, below the second body’s base of ${b.bodyBottom}`)
      })
    ],
    contextRules: [afterTrend('up', true)],
    specialises: [],
    related: ['advance-block', 'three-white-soldiers'],
    describe: 'Two long rising candles then a small one that stalls at the top. The advance stopped rather than reversed.'
  }),
  definition({
    id: 'upside-tasuki-gap',
    name: 'Upside Tasuki Gap',
    category: 'continuation',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bullish(0),
      bullish(1),
      windowBetween(1, 0, 'up'),
      bearish(2),
      rule('tasuki-opens-in-second-body', 'the third candle opens inside the second candle’s body', (w) => {
        const b = at(w, 1)
        const c = at(w, 2)
        return c.open <= b.bodyTop && c.open >= b.bodyBottom
          ? pass(0.8, `opened at ${c.open}, inside ${b.bodyBottom}–${b.bodyTop}`)
          : fail(`opened at ${c.open}, outside ${b.bodyBottom}–${b.bodyTop}`)
      }),
      rule('tasuki-gap-holds', 'the third candle closes without filling the window', (w) => {
        const a = at(w, 0)
        const c = at(w, 2)
        return c.close > a.high
          ? pass(0.9, `closed at ${c.close}, still above the first candle’s high of ${a.high}`)
          : fail(`closed at ${c.close}, which fills the window down to the first high of ${a.high}`)
      })
    ],
    contextRules: [afterTrend('up', false)],
    related: ['downside-tasuki-gap'],
    describe: 'A rising window, then a falling candle that opens inside the second body and closes without filling the window.'
  }),
  definition({
    id: 'downside-tasuki-gap',
    name: 'Downside Tasuki Gap',
    category: 'continuation',
    direction: 'bearish',
    formationLength: 3,
    rules: [
      bearish(0),
      bearish(1),
      windowBetween(1, 0, 'down'),
      bullish(2),
      rule('tasuki-down-opens-in-second-body', 'the third candle opens inside the second candle’s body', (w) => {
        const b = at(w, 1)
        const c = at(w, 2)
        return c.open <= b.bodyTop && c.open >= b.bodyBottom
          ? pass(0.8, `opened at ${c.open}, inside ${b.bodyBottom}–${b.bodyTop}`)
          : fail(`opened at ${c.open}, outside ${b.bodyBottom}–${b.bodyTop}`)
      }),
      rule('tasuki-down-gap-holds', 'the third candle closes without filling the window', (w) => {
        const a = at(w, 0)
        const c = at(w, 2)
        return c.close < a.low
          ? pass(0.9, `closed at ${c.close}, still below the first candle’s low of ${a.low}`)
          : fail(`closed at ${c.close}, which fills the window up to the first low of ${a.low}`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['upside-tasuki-gap'],
    describe: 'A falling window, then a rising candle that opens inside the second body and closes without filling the window.'
  }),
  definition({
    id: 'three-stars-in-the-south',
    name: 'Three Stars in the South',
    category: 'reversal',
    direction: 'bullish',
    formationLength: 3,
    rules: [
      bearish(0),
      bearish(1),
      bearish(2),
      longBody(0),
      longLowerWick(0),
      rule('south-shrinking-bodies', 'each candle is smaller than the one before', (w) => {
        const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
        return b.body < a.body && c.body < b.body
          ? pass(0.8, `bodies ran ${Number(a.body.toPrecision(4))} → ${Number(b.body.toPrecision(4))} → ${Number(c.body.toPrecision(4))}`)
          : fail('the bodies did not shrink through the three candles')
      }),
      rule('south-higher-lows', 'each candle’s low is above the one before', (w) => {
        const [a, b, c] = [at(w, 0), at(w, 1), at(w, 2)]
        return b.low > a.low && c.low > b.low
          ? pass(0.9, `lows ran ${a.low} → ${b.low} → ${c.low}`)
          : fail(`lows ran ${a.low} → ${b.low} → ${c.low}, which is not rising`)
      }),
      rule('south-third-has-no-shadow', 'the third candle has almost no shadows', (w) => {
        const c = at(w, 2)
        if (c.range <= 0) return pass(1, 'the third candle has no range at all')
        const shadows = (c.upperWick + c.lowerWick) / c.range
        return shadows <= 0.2
          ? pass(margin(shadows, 0.2, 'below'), `its shadows are ${pct(shadows)} of the range`)
          : fail(`its shadows are ${pct(shadows)} of the range, past the 20% allowed`)
      })
    ],
    contextRules: [afterTrend('down', false)],
    related: ['three-black-crows'],
    describe: 'Three falling candles that shrink and hold higher lows: the decline running out of room.'
  })
]

// ---------------------------------------------------------------- the library

/** Every pattern Orbis can detect, in a stable order. */
export const PATTERNS: readonly PatternDefinition[] = Object.freeze([...SINGLE, ...TWO, ...THREE])

/** The version of the library as a whole. Bumped when patterns are added or definitions change. */
export const PATTERN_LIBRARY_VERSION = 1

const BY_ID = new Map(PATTERNS.map((one) => [one.id, one]))

/**
 * A pattern by id.
 *
 * Read through a `Map` rather than by indexing an object, so an id of `constructor` or `__proto__` -- which a custom
 * pattern or an imported file can carry -- answers with nothing instead of a function.
 */
export const patternById = (id: string): PatternDefinition | undefined => BY_ID.get(id)

/** Patterns whose id, name or alias contains the query, case-insensitively. */
export function searchPatterns(query: string): PatternDefinition[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...PATTERNS]
  return PATTERNS.filter(
    (one) =>
      one.id.includes(needle.replace(/\s+/g, '-')) ||
      one.name.toLowerCase().includes(needle) ||
      one.aliases.some((alias) => alias.toLowerCase().includes(needle)) ||
      one.category.includes(needle) ||
      one.direction.includes(needle)
  )
}

export interface PatternFilter {
  category?: PatternCategory
  direction?: PatternDirection
  formationLength?: number
}

export function filterPatterns(filter: PatternFilter): PatternDefinition[] {
  return PATTERNS.filter(
    (one) =>
      (filter.category === undefined || one.category === filter.category) &&
      (filter.direction === undefined || one.direction === filter.direction) &&
      (filter.formationLength === undefined || one.formationLength === filter.formationLength)
  )
}

/**
 * The patterns a given pattern is a more specific case of, all the way up.
 *
 * A Rickshaw Man specialises a Long-Legged Doji, which specialises a Doji. All three are true of the same candle, and
 * the alert layer uses this to say one of them rather than three.
 */
export function ancestorsOf(id: string, seen = new Set<string>()): string[] {
  const one = patternById(id)
  if (!one || seen.has(id)) return []
  seen.add(id)
  const out: string[] = []
  for (const parent of one.specialises) {
    if (seen.has(parent)) continue
    out.push(parent, ...ancestorsOf(parent, seen))
  }
  return [...new Set(out)]
}

/** The patterns that are more specific cases of this one. */
export function descendantsOf(id: string): string[] {
  return PATTERNS.filter((one) => ancestorsOf(one.id).includes(id)).map((one) => one.id)
}

/** The assumptions the library rests on, shown rather than implied. */
export const PATTERN_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Candlestick definitions vary between sources. These are the definitions Orbis uses, each with a version recorded on every detection.',
  'A detection says the candles match a stated shape. It is not a forecast and no part of it is a probability of a price move.',
  'Structural rules and context rules are separate: a Hammer and a Hanging Man are the same shape and differ only in what came before.',
  'Where a name requires a prior trend and the trend cannot be established, the pattern does not confirm rather than guessing which name applies.',
  'Every size threshold is measured against the market’s own recent candles, never against a fixed price or percentage.',
  'Every rule reports what it measured, so an explanation is generated from the detection rather than written beside it.',
  'A match strength is how comfortably the rules were satisfied. It is a margin against a threshold, not a likelihood of anything.',
  'A window between candles is rare on a market that trades continuously, and the patterns requiring one are correspondingly rare here.'
])
