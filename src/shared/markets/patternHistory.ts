import type { Candle } from './indicators.ts'
import type { MarketRegime, VolatilityReading, VolumeReading } from './patternContext.ts'
import type { DataQualityLevel, PatternDetection } from './patternDetect.ts'
import type { PatternCategory, PatternDirection } from './patterns.ts'

/**
 * What was detected, kept; and what happened afterwards, measured.
 *
 * Two jobs that share one record. The first is bookkeeping: a detection that scrolled off the screen is still
 * something the user saw, and being able to go back to it is most of what makes a detector useful rather than
 * momentary. The second is the part that has to be handled carefully -- measuring what price did after past
 * occurrences.
 *
 * ## Every forward figure is a measurement of the past
 *
 * "57% of these formations were followed by a higher price twelve candles later" is a fact about a specific set of
 * candles that already happened. It is not a 57% chance of anything. So every field here is named for what was
 * measured, the methodology is recorded on the result, and nothing is called a win rate, an accuracy, a probability
 * or a success rate. Those words describe a prediction task, and this is not one.
 *
 * ## The sample size travels with the statistic
 *
 * A percentage over nine occurrences is not evidence and must not look like one. `sample` is a required field on every
 * summary, `reliability` states plainly when it is too small, and there is no code path that produces a distribution
 * without saying how many observations went into it.
 *
 * ## Distributions, not just averages
 *
 * An average forward return of +0.4% is compatible with every occurrence gaining 0.4%, and with half gaining 10% and
 * half losing 9%. Those are completely different observations, so the shape is reported alongside the middle.
 */

// ---------------------------------------------------------------- the record

export interface PatternRecord {
  /** The detection's identity, stable across refreshes and backfills. */
  key: string
  instrumentId: string
  /** Kept separate from the instrument id so two venues' histories are never silently merged. */
  exchange: string
  symbol: string
  interval: string

  patternId: string
  patternName: string
  patternVersion: number
  libraryVersion: number
  category: PatternCategory
  direction: PatternDirection

  /** The closing time of the formation's last candle. Its identity in time. */
  candleTime: number
  candleTimes: number[]
  /** When Orbis recorded it, as the caller's own stamp. */
  recordedAt: number

  price: number
  structuralMatch: number
  dataQuality: DataQualityLevel
  mode: PatternDetection['mode']

  /** Context as it was at the time, where it was gathered. Null where context analysis was off. */
  context: {
    regime: MarketRegime
    volume: VolumeReading
    volatility: VolatilityReading
    placement: 'at-support' | 'at-resistance' | 'between' | 'unclear'
    agreements: number
    conflicts: number
  } | null

  /** A reference to a stored chart image, where one was made. Never a stand-in illustration. */
  snapshotRef: string | null
  /** Set when the source candles were later revised, so a derived figure is not quietly trusted. */
  revised: boolean
}

export interface RecordInput {
  detection: PatternDetection
  instrumentId: string
  exchange: string
  symbol: string
  interval: string
  price: number
  recordedAt: number
  context?: PatternRecord['context']
  snapshotRef?: string | null
}

/** A record from a detection. Nothing is computed here that was not already decided. */
export function recordOf(input: RecordInput): PatternRecord {
  const { detection } = input
  return {
    key: detection.key,
    instrumentId: input.instrumentId,
    exchange: input.exchange,
    symbol: input.symbol,
    interval: input.interval,
    patternId: detection.patternId,
    patternName: detection.patternName,
    patternVersion: detection.patternVersion,
    libraryVersion: detection.libraryVersion,
    category: detection.category,
    direction: detection.direction,
    candleTime: detection.at,
    candleTimes: [...detection.candleTimes],
    recordedAt: input.recordedAt,
    price: input.price,
    structuralMatch: detection.structuralMatch,
    dataQuality: detection.dataQuality.level,
    mode: detection.mode,
    context: input.context ?? null,
    snapshotRef: input.snapshotRef ?? null,
    revised: false
  }
}

// ---------------------------------------------------------------- retention

export type Retention = '7d' | '30d' | '90d' | '1y' | 'forever'

export const RETENTION_MS: Readonly<Record<Retention, number | null>> = Object.freeze({
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
  '90d': 90 * 86_400_000,
  '1y': 365 * 86_400_000,
  forever: null
})

export interface Pruned {
  kept: PatternRecord[]
  removed: PatternRecord[]
  /** Snapshot references belonging to removed records, so the images can be cleaned up too. */
  orphanedSnapshots: string[]
  describe: string
}

/**
 * Drop records past the retention window.
 *
 * Returns what was removed rather than only what was kept, so the caller can delete the chart images that went with
 * them. A retention policy that left the images behind would grow the profile directory without limit while the list
 * looked bounded.
 *
 * `forever` is offered and is not the default. Snapshots are the expensive part, and a default of unlimited would
 * quietly consume disk for years.
 */
export function prune(records: readonly PatternRecord[], retention: Retention, now: number, cap = 5000): Pruned {
  const window = RETENTION_MS[retention]
  const cutoff = window === null ? -Infinity : now - window

  const byAge = [...records].sort((a, b) => b.recordedAt - a.recordedAt)
  const kept: PatternRecord[] = []
  const removed: PatternRecord[] = []

  for (const one of byAge) {
    if (one.recordedAt >= cutoff && kept.length < cap) kept.push(one)
    else removed.push(one)
  }

  const overCap = removed.filter((one) => one.recordedAt >= cutoff).length

  return {
    kept: kept.sort((a, b) => a.recordedAt - b.recordedAt),
    removed,
    orphanedSnapshots: removed.map((one) => one.snapshotRef).filter((one): one is string => one !== null),
    describe:
      removed.length === 0
        ? `All ${records.length} records are within the ${retention} window.`
        : `${removed.length} record${removed.length === 1 ? '' : 's'} removed${overCap > 0 ? `, ${overCap} of them because the ${cap} record limit was reached rather than because of age` : ` as older than ${retention}`}.`
  }
}

// ---------------------------------------------------------------- searching

export interface HistoryQuery {
  instrumentIds?: string[]
  exchanges?: string[]
  intervals?: string[]
  patternIds?: string[]
  categories?: PatternCategory[]
  directions?: PatternDirection[]
  from?: number
  to?: number
  minimumMatch?: number
  minimumDataQuality?: DataQualityLevel
  regimes?: MarketRegime[]
  volumeReadings?: VolumeReading[]
  placements?: NonNullable<PatternRecord['context']>['placement'][]
  /** Records whose source candles were later revised. Excluded unless asked for. */
  includeRevised?: boolean
}

const QUALITY_ORDER: Record<DataQualityLevel, number> = { unusable: 0, poor: 1, reduced: 2, high: 3 }

export interface HistoryResult {
  records: PatternRecord[]
  /** How many were considered, so a narrow result can be told from an empty history. */
  considered: number
  /** Which conditions removed how many, so a query returning nothing can be understood. */
  excludedBy: { condition: string; count: number }[]
  describe: string
}

/**
 * Records matching a query, with an account of what the query removed.
 *
 * The account matters more than it looks: a search returning nothing is the commonest thing a user will see, and
 * "nothing matched" is useless where "your date range excluded all 340 of them" is not.
 */
export function search(records: readonly PatternRecord[], query: HistoryQuery): HistoryResult {
  const excluded = new Map<string, number>()
  const reject = (condition: string): false => {
    excluded.set(condition, (excluded.get(condition) ?? 0) + 1)
    return false
  }

  const matched = records.filter((one) => {
    if (one.revised && query.includeRevised !== true) return reject('the source candles were later revised')
    if (query.instrumentIds !== undefined && query.instrumentIds.length > 0 && !query.instrumentIds.includes(one.instrumentId)) return reject('market')
    if (query.exchanges !== undefined && query.exchanges.length > 0 && !query.exchanges.includes(one.exchange)) return reject('exchange')
    if (query.intervals !== undefined && query.intervals.length > 0 && !query.intervals.includes(one.interval)) return reject('interval')
    if (query.patternIds !== undefined && query.patternIds.length > 0 && !query.patternIds.includes(one.patternId)) return reject('pattern')
    if (query.categories !== undefined && query.categories.length > 0 && !query.categories.includes(one.category)) return reject('category')
    if (query.directions !== undefined && query.directions.length > 0 && !query.directions.includes(one.direction)) return reject('direction')
    if (query.from !== undefined && one.candleTime < query.from) return reject('date range')
    if (query.to !== undefined && one.candleTime > query.to) return reject('date range')
    if (query.minimumMatch !== undefined && one.structuralMatch < query.minimumMatch) return reject('minimum match strength')
    if (query.minimumDataQuality !== undefined && QUALITY_ORDER[one.dataQuality] < QUALITY_ORDER[query.minimumDataQuality]) return reject('minimum data quality')
    if (query.regimes !== undefined && query.regimes.length > 0 && (one.context === null || !query.regimes.includes(one.context.regime))) return reject('market regime')
    if (query.volumeReadings !== undefined && query.volumeReadings.length > 0 && (one.context === null || !query.volumeReadings.includes(one.context.volume))) return reject('volume')
    if (query.placements !== undefined && query.placements.length > 0 && (one.context === null || !query.placements.includes(one.context.placement))) return reject('where it formed')
    return true
  })

  const excludedBy = [...excluded.entries()].map(([condition, count]) => ({ condition, count })).sort((a, b) => b.count - a.count || a.condition.localeCompare(b.condition))

  return {
    records: matched.sort((a, b) => b.candleTime - a.candleTime),
    considered: records.length,
    excludedBy,
    describe:
      records.length === 0
        ? 'There are no records to search.'
        : matched.length === 0
          ? `None of the ${records.length} records matched. The conditions that excluded the most were: ${excludedBy.slice(0, 3).map((one) => `${one.condition} (${one.count})`).join(', ')}.`
          : `${matched.length} of ${records.length} records matched.`
  }
}

// ---------------------------------------------------------------- forward outcomes

export interface OutcomeMethod {
  /** The price the measurement starts from. Always the formation's closing price, stated so it cannot be assumed. */
  reference: 'formation-close'
  /** How many completed candles forward the measurement runs. */
  forwardCandles: number
  describe: string
}

export const outcomeMethod = (forwardCandles: number): OutcomeMethod => ({
  reference: 'formation-close',
  forwardCandles,
  describe: `Measured from the close of the formation's last candle, ${forwardCandles} completed candles forward. No cost, slippage or spread is applied, because nothing here is a trade.`
})

export interface Outcome {
  key: string
  /** Percentage change from the reference to the close `forwardCandles` later. */
  forwardReturn: number
  /** The best the price got, as a percentage, at any point inside the window. */
  maximumFavourable: number
  /** The worst it got, as a percentage, at any point inside the window. */
  maximumAdverse: number
  /** How many candles were actually available. Less than asked for means the window ran off the end. */
  candlesUsed: number
  /** True only when the full window was available. A truncated window is excluded from summaries. */
  complete: boolean
}

export interface OutcomeSet {
  method: OutcomeMethod
  outcomes: Outcome[]
  /** Records that could not be measured, with why. Never silently dropped. */
  unmeasurable: { key: string; why: string }[]
  describe: string
}

/**
 * What price did after each occurrence.
 *
 * The favourable and adverse excursions are signed by the formation's own direction, so a bullish pattern's
 * "favourable" is upward and a bearish one's is downward. Without that they would be meaningless to compare across
 * directions -- and comparing them is exactly what somebody will do.
 *
 * A window that runs past the end of the candles is marked incomplete and excluded from every summary. Measuring a
 * twelve-candle outcome over the four candles that exist and reporting it beside the real ones would put a different
 * measurement into the same distribution.
 */
export function measureOutcomes(
  records: readonly PatternRecord[],
  candlesFor: (record: PatternRecord) => readonly Candle[] | undefined,
  forwardCandles: number
): OutcomeSet {
  const method = outcomeMethod(forwardCandles)
  const outcomes: Outcome[] = []
  const unmeasurable: OutcomeSet['unmeasurable'] = []

  for (const record of records) {
    const candles = candlesFor(record)
    if (candles === undefined || candles.length === 0) {
      unmeasurable.push({ key: record.key, why: 'the candles for this occurrence are no longer available' })
      continue
    }

    const at = candles.findIndex((one) => one.time === record.candleTime)
    if (at === -1) {
      unmeasurable.push({ key: record.key, why: 'the formation’s candle is not in the history provided' })
      continue
    }

    const reference = (candles[at] as Candle).close
    if (!Number.isFinite(reference) || reference <= 0) {
      unmeasurable.push({ key: record.key, why: 'the formation’s closing price is not usable' })
      continue
    }

    const forward = candles.slice(at + 1, at + 1 + forwardCandles)
    if (forward.length === 0) {
      unmeasurable.push({ key: record.key, why: 'there are no candles after this occurrence' })
      continue
    }

    const pct = (price: number): number => ((price - reference) / reference) * 100
    const sign = record.direction === 'bearish' ? -1 : 1
    const highs = forward.map((one) => pct(one.high))
    const lows = forward.map((one) => pct(one.low))
    const last = forward[forward.length - 1] as Candle

    outcomes.push({
      key: record.key,
      forwardReturn: pct(last.close) * sign,
      maximumFavourable: sign === 1 ? Math.max(...highs) : -Math.min(...lows),
      maximumAdverse: sign === 1 ? Math.min(...lows) : -Math.max(...highs),
      candlesUsed: forward.length,
      complete: forward.length === forwardCandles
    })
  }

  const complete = outcomes.filter((one) => one.complete).length
  return {
    method,
    outcomes,
    unmeasurable,
    describe: `${complete} of ${records.length} occurrences had a full ${forwardCandles}-candle window${unmeasurable.length > 0 ? `; ${unmeasurable.length} could not be measured at all` : ''}.`
  }
}

// ---------------------------------------------------------------- summarising

export type Reliability = 'too-few' | 'small' | 'moderate' | 'substantial'

/** Below this many observations, Orbis will not present a percentage as though it meant anything. */
export const MINIMUM_SAMPLE = 20

export interface Distribution {
  /** How many observations. Required on every summary, because a percentage without it is not information. */
  sample: number
  reliability: Reliability
  /** The share that fell in each band. Bands rather than an average alone, because averages hide the shape. */
  bands: { from: number; to: number | null; share: number; count: number }[]
  median: number | null
  mean: number | null
  /** The 25th and 75th values, which say more about spread than a standard deviation on a skewed set. */
  lowerQuartile: number | null
  upperQuartile: number | null
  best: number | null
  worst: number | null
  /** Share that finished above zero. Named for what it is and never as a win rate or an accuracy. */
  shareAboveZero: number | null
  describe: string
  /** The warning that goes on screen with the numbers, or null when the sample is substantial. */
  caution: string | null
}

const quantile = (sorted: readonly number[], q: number): number | null => {
  if (sorted.length === 0) return null
  const position = (sorted.length - 1) * q
  const low = Math.floor(position)
  const high = Math.ceil(position)
  if (low === high) return sorted[low] as number
  return (sorted[low] as number) * (high - position) + (sorted[high] as number) * (position - low)
}

/**
 * The shape of a set of forward measurements.
 *
 * `shareAboveZero` is the number everybody wants and the one most easily misread, so it is named for exactly what it
 * counts: the share of these past occurrences that finished above where they started. It is not a win rate -- there
 * was no trade -- and it is not a probability, because nothing here models the future.
 *
 * Below `MINIMUM_SAMPLE` observations, `caution` is populated and is meant to be rendered *with* the figures rather
 * than behind a disclosure. A percentage over nine occurrences looks identical to one over nine hundred.
 */
export function distributionOf(values: readonly number[], label = 'forward return'): Distribution {
  const usable = values.filter((one) => Number.isFinite(one))
  const sorted = [...usable].sort((a, b) => a - b)
  const sample = usable.length

  const reliability: Reliability = sample === 0 ? 'too-few' : sample < MINIMUM_SAMPLE ? 'too-few' : sample < 50 ? 'small' : sample < 200 ? 'moderate' : 'substantial'

  if (sample === 0) {
    return {
      sample: 0,
      reliability: 'too-few',
      bands: [],
      median: null,
      mean: null,
      lowerQuartile: null,
      upperQuartile: null,
      best: null,
      worst: null,
      shareAboveZero: null,
      describe: `There are no measurements of ${label}.`,
      caution: 'There is nothing here to summarise.'
    }
  }

  const edges = [-Infinity, -5, -2, -0.5, 0.5, 2, 5, Infinity]
  const bands = edges.slice(0, -1).map((from, i) => {
    const to = edges[i + 1] as number
    const count = usable.filter((one) => one > from && one <= to).length
    return { from: from === -Infinity ? -Infinity : from, to: to === Infinity ? null : to, share: count / sample, count }
  })

  const mean = usable.reduce((a, b) => a + b, 0) / sample
  const above = usable.filter((one) => one > 0).length

  return {
    sample,
    reliability,
    bands,
    median: quantile(sorted, 0.5),
    mean,
    lowerQuartile: quantile(sorted, 0.25),
    upperQuartile: quantile(sorted, 0.75),
    best: sorted[sorted.length - 1] as number,
    worst: sorted[0] as number,
    shareAboveZero: above / sample,
    describe: `Over ${sample} past occurrence${sample === 1 ? '' : 's'}, the median ${label} was ${(quantile(sorted, 0.5) as number).toFixed(2)}% and ${((above / sample) * 100).toFixed(0)}% finished above where they started. These are measurements of what already happened.`,
    caution:
      reliability === 'too-few'
        ? `Only ${sample} observation${sample === 1 ? '' : 's'}. That is fewer than the ${MINIMUM_SAMPLE} it takes for these figures to be stable, so they should not be read as typical of anything.`
        : reliability === 'small'
          ? `${sample} observations is a small set; the figures will move a lot as more arrive.`
          : null
  }
}

export interface OutcomeSummary {
  method: OutcomeMethod
  forwardReturn: Distribution
  maximumFavourable: Distribution
  maximumAdverse: Distribution
  /** Occurrences excluded because their window was not complete. */
  excludedIncomplete: number
  describe: string
}

/** The three distributions together, over the occurrences whose window was complete. */
export function summarise(set: OutcomeSet): OutcomeSummary {
  const complete = set.outcomes.filter((one) => one.complete)
  return {
    method: set.method,
    forwardReturn: distributionOf(complete.map((one) => one.forwardReturn), 'forward return'),
    maximumFavourable: distributionOf(complete.map((one) => one.maximumFavourable), 'best point reached'),
    maximumAdverse: distributionOf(complete.map((one) => one.maximumAdverse), 'worst point reached'),
    excludedIncomplete: set.outcomes.length - complete.length,
    describe:
      complete.length === 0
        ? 'No occurrence had a complete forward window, so there is nothing to summarise.'
        : `${complete.length} occurrence${complete.length === 1 ? '' : 's'} with a complete ${set.method.forwardCandles}-candle window${set.outcomes.length > complete.length ? `; ${set.outcomes.length - complete.length} excluded for running past the end of the history` : ''}. ${set.method.describe}`
  }
}

// ---------------------------------------------------------------- conditioning and comparing

export interface ConditionedSummary {
  condition: string
  value: string
  summary: OutcomeSummary
}

/**
 * The same measurement, split by a condition.
 *
 * Splitting shrinks every group, which is the point of reporting the sample on each one: "in a downtrend, 71%" over
 * eleven occurrences is a smaller claim than "57%" over three hundred, and a screen that showed only the percentages
 * would make the first look like the stronger finding.
 */
export function conditionOn(
  records: readonly PatternRecord[],
  set: OutcomeSet,
  by: 'regime' | 'volume' | 'volatility' | 'placement' | 'interval' | 'dataQuality'
): ConditionedSummary[] {
  const byKey = new Map(records.map((one) => [one.key, one]))
  const groups = new Map<string, Outcome[]>()

  for (const outcome of set.outcomes) {
    const record = byKey.get(outcome.key)
    if (record === undefined) continue
    const value =
      by === 'interval'
        ? record.interval
        : by === 'dataQuality'
          ? record.dataQuality
          : record.context === null
            ? 'not recorded'
            : by === 'regime'
              ? record.context.regime
              : by === 'volume'
                ? record.context.volume
                : by === 'volatility'
                  ? record.context.volatility
                  : record.context.placement
    groups.set(value, [...(groups.get(value) ?? []), outcome])
  }

  return [...groups.entries()]
    .map(([value, outcomes]) => ({ condition: by, value, summary: summarise({ ...set, outcomes }) }))
    .sort((a, b) => b.summary.forwardReturn.sample - a.summary.forwardReturn.sample || a.value.localeCompare(b.value))
}

export interface Comparison {
  /** What is being compared: two patterns, two markets, two intervals. */
  of: string
  left: { label: string; summary: OutcomeSummary }
  right: { label: string; summary: OutcomeSummary }
  /** Whether either side has enough observations for the comparison to mean anything. */
  comparable: boolean
  describe: string
}

/**
 * Two sets of measurements, side by side.
 *
 * There is deliberately no winner. Comparing two medians over two small samples and declaring one pattern better is
 * the most common way a statistic like this gets misused, and picking a side would make Orbis the one doing it. What
 * this says is what each set measured and whether either was large enough to be worth comparing.
 */
export function compare(of: string, left: { label: string; summary: OutcomeSummary }, right: { label: string; summary: OutcomeSummary }): Comparison {
  const both = left.summary.forwardReturn.sample >= MINIMUM_SAMPLE && right.summary.forwardReturn.sample >= MINIMUM_SAMPLE

  return {
    of,
    left,
    right,
    comparable: both,
    describe: both
      ? `${left.label} over ${left.summary.forwardReturn.sample} occurrences against ${right.label} over ${right.summary.forwardReturn.sample}. Both sets are shown in full; neither is named the better one, because a difference between two medians over these sample sizes is not a finding.`
      : `One or both sets has fewer than ${MINIMUM_SAMPLE} occurrences (${left.summary.forwardReturn.sample} and ${right.summary.forwardReturn.sample}), which is too few to compare. The figures are shown as measurements of each set and not as a comparison.`
  }
}

// ---------------------------------------------------------------- frequency

export interface Frequency {
  /** Counts only. Nothing here measures what happened afterwards. */
  byPattern: { patternId: string; patternName: string; count: number; share: number }[]
  byInterval: { interval: string; count: number }[]
  byMarket: { instrumentId: string; symbol: string; count: number }[]
  byCategory: Record<PatternCategory, number>
  byDirection: Record<PatternDirection, number>
  total: number
  describe: string
}

/** How often each pattern was detected. A description of the detector's output, not of the market. */
export function frequencyOf(records: readonly PatternRecord[]): Frequency {
  const patterns = new Map<string, { name: string; count: number }>()
  const intervals = new Map<string, number>()
  const markets = new Map<string, { symbol: string; count: number }>()
  const byCategory: Record<PatternCategory, number> = { reversal: 0, continuation: 0, indecision: 0 }
  const byDirection: Record<PatternDirection, number> = { bullish: 0, bearish: 0, neutral: 0 }

  for (const one of records) {
    const pattern = patterns.get(one.patternId) ?? { name: one.patternName, count: 0 }
    patterns.set(one.patternId, { name: pattern.name, count: pattern.count + 1 })
    intervals.set(one.interval, (intervals.get(one.interval) ?? 0) + 1)
    const market = markets.get(one.instrumentId) ?? { symbol: one.symbol, count: 0 }
    markets.set(one.instrumentId, { symbol: market.symbol, count: market.count + 1 })
    byCategory[one.category] += 1
    byDirection[one.direction] += 1
  }

  const total = records.length
  return {
    byPattern: [...patterns.entries()]
      .map(([patternId, one]) => ({ patternId, patternName: one.name, count: one.count, share: total === 0 ? 0 : one.count / total }))
      .sort((a, b) => b.count - a.count || a.patternId.localeCompare(b.patternId)),
    byInterval: [...intervals.entries()].map(([interval, count]) => ({ interval, count })).sort((a, b) => b.count - a.count || a.interval.localeCompare(b.interval)),
    byMarket: [...markets.entries()]
      .map(([instrumentId, one]) => ({ instrumentId, symbol: one.symbol, count: one.count }))
      .sort((a, b) => b.count - a.count || a.instrumentId.localeCompare(b.instrumentId)),
    byCategory,
    byDirection,
    total,
    describe:
      total === 0
        ? 'Nothing has been detected yet.'
        : `${total} detection${total === 1 ? '' : 's'} recorded. This counts what the detector found; it says nothing about what followed.`
  }
}

// ---------------------------------------------------------------- analysis runs

export type RunStatus = 'running' | 'complete' | 'cancelled' | 'failed'

export interface AnalysisRun {
  runId: string
  instrumentId: string
  interval: string
  from: number
  to: number
  patternIds: string[]
  /** The definition versions used, so a run stays reproducible after the library changes. */
  patternVersions: Record<string, number>
  libraryVersion: number
  mode: PatternDetection['mode']
  forwardCandles: number
  createdAt: number
  status: RunStatus
  /** How many candles were examined, and how many the range contained. */
  examined: number
  total: number
  found: number
  describe: string
}

/**
 * Whether a run's results may be presented as covering its range.
 *
 * A cancelled run covered part of what was asked for, and its numbers are real for that part. What they must never do
 * is sit in a list next to a complete run looking equivalent -- so this refuses to describe a partial run as anything
 * but partial, and the share examined goes in the sentence.
 */
export function describeRun(run: AnalysisRun): { partial: boolean; describe: string } {
  const share = run.total === 0 ? 0 : run.examined / run.total
  if (run.status === 'complete' && run.examined >= run.total) {
    return { partial: false, describe: `Examined all ${run.total.toLocaleString('en')} candles and found ${run.found} occurrence${run.found === 1 ? '' : 's'}.` }
  }
  return {
    partial: true,
    describe: `This run is ${run.status} and examined ${run.examined.toLocaleString('en')} of ${run.total.toLocaleString('en')} candles (${(share * 100).toFixed(0)}%). It found ${run.found} occurrence${run.found === 1 ? '' : 's'} in the part it covered, which is not the same as the number in the range.`
  }
}

/** The assumptions the history and analysis layer rests on, shown rather than implied. */
export const HISTORY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every forward figure is a measurement of candles that already traded. None of them is a probability, a win rate, an accuracy or a success rate.',
  'The sample size is a required field on every summary, because a percentage without it is not information.',
  `Below ${MINIMUM_SAMPLE} observations a warning is attached to the figures and is meant to be shown with them, not behind a disclosure.`,
  'Distributions are reported alongside the middle, because an average hides whether every occurrence was similar or half went each way.',
  'A forward window that runs past the end of the history is marked incomplete and excluded from every summary.',
  'Favourable and adverse excursions are signed by the formation’s own direction, so bullish and bearish sets can be compared.',
  'No comparison names a winner. Two medians over small samples are not a finding about which pattern is better.',
  'Splitting a set by a condition shrinks every group, so each group carries its own sample size.',
  'A record keeps the definition version that produced it, so changing the library never rewrites what was observed.',
  'A record whose source candles were later revised is marked and excluded from searches unless asked for.',
  'A partial run is described as partial, with the share examined, and never as covering its range.',
  'Retention returns what it removed so the chart images can be removed too; unlimited retention is offered and is not the default.'
])
