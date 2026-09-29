import type { PatternContext, TimeframeAgreement, VolumeReading } from './patternContext.ts'
import { detectionKey, type DataQualityLevel, type PatternDetection } from './patternDetect.ts'
import type { PatternCategory, PatternDirection } from './patterns.ts'

/**
 * Deciding whether a detection is worth telling somebody about, and making sure it is said once.
 *
 * This does not deliver anything. Orbis already has a notification system, an alert store and a delivery path, and
 * this file produces the decision those take: given a detection, a rule and what has already fired, should anything
 * be sent. Building a second notification engine here would eventually disagree with the first about what was sent.
 *
 * ## Firing once is the whole problem
 *
 * A live candle updates many times a second. The formation across the last three candles is re-evaluated on every
 * one of those updates, and it is the *same formation* each time. So eligibility is not enough: identity is. Every
 * firing is keyed by market, interval, pattern, definition version and the timestamp of the candle that closed it,
 * which is stable across any number of refreshes, reconnections and backfills.
 *
 * ## An alert is never a recommendation
 *
 * Priority here is about how much of the configured evidence was present, and it is named so it cannot be read as
 * anything else. There is no "strong buy", no "high probability", and no field that could be rendered as one. The
 * most emphatic thing this file will say about a detection is that everything the rule asked for was there.
 */

// ---------------------------------------------------------------- the rule

export type AlertScope = 'instruments' | 'watchlist' | 'favourites'

export interface PatternAlertRule {
  id: string
  enabled: boolean
  name: string
  scope: AlertScope
  /** Used when `scope` is `instruments`. Ignored otherwise. */
  instrumentIds: string[]
  /** Empty means any pattern. */
  patternIds: string[]
  /** Empty means any category. */
  categories: PatternCategory[]
  /** Empty means any direction. */
  directions: PatternDirection[]
  /** Empty means any interval the market provides. */
  intervals: string[]

  /** From 0 to 1. A detection below this is eligible for nothing. */
  minimumStructuralMatch: number
  minimumDataQuality: DataQualityLevel
  /** Null means volume is not a condition. An empty array would mean nothing can ever qualify, and is rejected. */
  requireVolume: VolumeReading[] | null
  requirePlacement: PatternContext['levels']['placement'][] | null
  requireTimeframeAgreement: TimeframeAgreement[] | null
  /** Refuse a detection whose context lists anything pointing against it. */
  excludeWhenConflicted: boolean
  /**
   * Whether a formation on a candle that has not closed may fire.
   *
   * Off by default and deliberately awkward to turn on: a developing formation can stop being one before the candle
   * closes, and an alert that has already been delivered cannot be unsent.
   */
  allowDeveloping: boolean

  /** Milliseconds before this rule may fire again for the same market and interval. Zero means no cooldown. */
  cooldownMs: number
  createdAt: number
}

export const DEFAULT_RULE: Omit<PatternAlertRule, 'id' | 'name' | 'createdAt'> = Object.freeze({
  enabled: true,
  scope: 'watchlist' as AlertScope,
  instrumentIds: [],
  patternIds: [],
  categories: [],
  directions: [],
  intervals: [],
  minimumStructuralMatch: 0.2,
  minimumDataQuality: 'reduced' as DataQualityLevel,
  requireVolume: null,
  requirePlacement: null,
  requireTimeframeAgreement: null,
  excludeWhenConflicted: false,
  allowDeveloping: false,
  cooldownMs: 15 * 60_000
})

const QUALITY_ORDER: Record<DataQualityLevel, number> = { unusable: 0, poor: 1, reduced: 2, high: 3 }

export interface RuleProblem {
  field: string
  describe: string
}

/**
 * Whether a rule can ever fire.
 *
 * A rule that cannot match anything is worse than no rule: it sits in the list looking like coverage. An empty
 * requirement array is the usual way this happens -- `requireVolume: []` reads like "no volume requirement" and means
 * "only a volume reading that is in this empty list", which nothing is.
 */
export function checkRule(rule: PatternAlertRule): RuleProblem[] {
  const problems: RuleProblem[] = []

  if (rule.name.trim() === '') problems.push({ field: 'name', describe: 'The rule needs a name, or it cannot be told apart from the others in the list.' })
  if (rule.scope === 'instruments' && rule.instrumentIds.length === 0) {
    problems.push({ field: 'instrumentIds', describe: 'This rule watches specific markets and names none, so it can never fire.' })
  }
  if (!Number.isFinite(rule.minimumStructuralMatch) || rule.minimumStructuralMatch < 0 || rule.minimumStructuralMatch > 1) {
    problems.push({ field: 'minimumStructuralMatch', describe: 'A minimum match runs from 0 to 1.' })
  }
  if (rule.minimumStructuralMatch === 1) {
    problems.push({ field: 'minimumStructuralMatch', describe: 'A minimum match of 1 requires every rule to be satisfied with the maximum margin, which essentially nothing reaches.' })
  }
  if (rule.minimumDataQuality === 'unusable') {
    problems.push({ field: 'minimumDataQuality', describe: 'Accepting unusable data means alerting on formations whose own candles are inconsistent.' })
  }
  for (const [field, list] of [
    ['requireVolume', rule.requireVolume],
    ['requirePlacement', rule.requirePlacement],
    ['requireTimeframeAgreement', rule.requireTimeframeAgreement]
  ] as const) {
    if (list !== null && list.length === 0) {
      problems.push({ field, describe: `This requirement is an empty list, which nothing can satisfy. Set it to no requirement instead.` })
    }
  }
  if (!Number.isFinite(rule.cooldownMs) || rule.cooldownMs < 0) problems.push({ field: 'cooldownMs', describe: 'A cooldown cannot be negative.' })

  return problems
}

// ---------------------------------------------------------------- eligibility

export interface Eligibility {
  eligible: boolean
  /** Every condition the rule set, and whether this detection met it. */
  checks: { condition: string; met: boolean; describe: string }[]
  /** The conditions that were not met, as sentences. Empty when eligible. */
  blocked: string[]
  /**
   * How much of what the rule asked for was present.
   *
   * A completeness figure over the rule's own conditions, not a judgement about the market. A rule that asked for
   * three things and got three scores 1; that is what "everything you asked for was there" means and nothing more.
   */
  satisfied: number
  describe: string
}

export interface EligibilityInput {
  rule: PatternAlertRule
  detection: PatternDetection
  instrumentId: string
  interval: string
  /** Absent when context analysis is off. Context conditions are then unmet rather than assumed satisfied. */
  context?: PatternContext
  timeframeAgreement?: TimeframeAgreement
  /** For `watchlist` and `favourites` scopes: whether this market is in the list. */
  inScope?: boolean
}

/**
 * Whether one detection satisfies one rule.
 *
 * Every condition the rule set is reported with its verdict, met or not, so a user asking why an alert did not fire
 * gets the actual list rather than silence. A condition that cannot be evaluated -- a volume requirement on a market
 * with no volume, a timeframe requirement with no other timeframes loaded -- counts as **not met**. Treating an
 * unevaluable condition as satisfied is how a filter quietly stops filtering.
 */
export function checkEligibility(input: EligibilityInput): Eligibility {
  const { rule, detection, instrumentId, interval, context } = input
  const checks: Eligibility['checks'] = []
  const add = (condition: string, met: boolean, describe: string): void => {
    checks.push({ condition, met, describe })
  }

  if (!rule.enabled) {
    return { eligible: false, checks: [{ condition: 'enabled', met: false, describe: 'This rule is switched off.' }], blocked: ['this rule is switched off'], satisfied: 0, describe: 'This rule is switched off.' }
  }

  // Scope.
  if (rule.scope === 'instruments') {
    const met = rule.instrumentIds.includes(instrumentId)
    add('market', met, met ? `${instrumentId} is one of the markets this rule watches.` : `${instrumentId} is not one of the markets this rule watches.`)
  } else {
    const met = input.inScope === true
    add('market', met, met ? `${instrumentId} is in the ${rule.scope}.` : `${instrumentId} is not in the ${rule.scope}${input.inScope === undefined ? ', or the list could not be read' : ''}.`)
  }

  if (rule.intervals.length > 0) {
    const met = rule.intervals.includes(interval)
    add('interval', met, met ? `${interval} is one of the intervals this rule watches.` : `${interval} is not one of the intervals this rule watches.`)
  }

  if (rule.patternIds.length > 0) {
    // A broader classification the formation also satisfies counts: somebody who asked for Dojis wants the Dragonfly.
    const matched = rule.patternIds.includes(detection.patternId) || detection.alsoMatches.some((one) => rule.patternIds.includes(one))
    add('pattern', matched, matched ? `${detection.patternName} is one this rule watches.` : `${detection.patternName} is not one this rule watches.`)
  }

  if (rule.categories.length > 0) {
    const met = rule.categories.includes(detection.category)
    add('category', met, met ? `It is a ${detection.category} formation.` : `It is a ${detection.category} formation, which this rule does not watch.`)
  }

  if (rule.directions.length > 0) {
    const met = rule.directions.includes(detection.direction)
    add('direction', met, met ? `It is a ${detection.direction} formation.` : `It is a ${detection.direction} formation, which this rule does not watch.`)
  }

  // Completeness.
  if (!rule.allowDeveloping) {
    const met = detection.completeness === 'complete'
    add('closed', met, met ? 'The formation’s last candle has closed.' : 'The formation’s last candle has not closed, and this rule only fires on closed candles.')
  }

  // Quality.
  {
    const met = detection.structuralMatch >= rule.minimumStructuralMatch
    add(
      'match',
      met,
      `Match strength ${(detection.structuralMatch * 100).toFixed(0)}% against the ${(rule.minimumStructuralMatch * 100).toFixed(0)}% this rule asks for.`
    )
  }
  {
    const met = QUALITY_ORDER[detection.dataQuality.level] >= QUALITY_ORDER[rule.minimumDataQuality]
    add('data-quality', met, `Data quality is ${detection.dataQuality.level} against the ${rule.minimumDataQuality} this rule asks for.`)
  }

  // Context conditions. Each is unmet when context is unavailable, never assumed.
  if (rule.requireVolume !== null) {
    const reading = context?.volume.reading
    const met = reading !== undefined && rule.requireVolume.includes(reading)
    add('volume', met, reading === undefined ? 'This rule asks about volume and no context was gathered.' : `Volume was ${reading}; this rule asks for ${rule.requireVolume.join(' or ')}.`)
  }
  if (rule.requirePlacement !== null) {
    const placement = context?.levels.placement
    const met = placement !== undefined && rule.requirePlacement.includes(placement)
    add('placement', met, placement === undefined ? 'This rule asks where the formation sits and no context was gathered.' : `The formation sits ${placement}; this rule asks for ${rule.requirePlacement.join(' or ')}.`)
  }
  if (rule.requireTimeframeAgreement !== null) {
    const agreement = input.timeframeAgreement
    const met = agreement !== undefined && rule.requireTimeframeAgreement.includes(agreement)
    add('timeframes', met, agreement === undefined ? 'This rule asks about other timeframes and none were examined.' : `The other timeframes are ${agreement}; this rule asks for ${rule.requireTimeframeAgreement.join(' or ')}.`)
  }
  if (rule.excludeWhenConflicted) {
    const conflicts = context?.conflicts
    const met = conflicts !== undefined && conflicts.length === 0
    add(
      'no-conflicts',
      met,
      conflicts === undefined
        ? 'This rule excludes conflicted formations and no context was gathered to check.'
        : conflicts.length === 0
          ? 'Nothing around the formation points against it.'
          : `${conflicts.length} observation${conflicts.length === 1 ? '' : 's'} around it point against it.`
    )
  }

  const blocked = checks.filter((one) => !one.met).map((one) => one.describe)
  const satisfied = checks.length === 0 ? 1 : checks.filter((one) => one.met).length / checks.length

  return {
    eligible: blocked.length === 0,
    checks,
    blocked,
    satisfied,
    describe: blocked.length === 0 ? `Every condition this rule sets was met.` : `${blocked.length} of ${checks.length} conditions were not met.`
  }
}

// ---------------------------------------------------------------- priority

export type AlertPriority = 'informational' | 'normal' | 'notable'

/**
 * How prominently to present an alert.
 *
 * Three levels and no more, named for how much of the configured evidence was present rather than for what anybody
 * should do. `notable` means a strong structural match with clean data and nothing in the surrounding context
 * pointing against it. It does not mean the trade is good, likely, or advisable, and there is deliberately no level
 * above it for a screen to escalate into.
 */
export function priorityOf(detection: PatternDetection, context?: PatternContext): AlertPriority {
  const clean = detection.dataQuality.level === 'high'
  const strong = detection.structuralMatch >= 0.5
  const conflicted = context !== undefined && context.conflicts.length > 0
  const agreeing = context !== undefined && context.agreements.length >= 2

  if (strong && clean && !conflicted && agreeing) return 'notable'
  if (detection.structuralMatch < 0.2 || detection.dataQuality.level === 'poor' || conflicted) return 'informational'
  return 'normal'
}

// ---------------------------------------------------------------- firing

export interface PatternFiring {
  /** The identity: stable across refreshes, reconnections and backfills. */
  key: string
  ruleId: string
  instrumentId: string
  interval: string
  patternId: string
  patternVersion: number
  candleTime: number
  /** When Orbis decided to fire, as the caller's own stamp. Nothing here reads a clock. */
  firedAt: number
  priority: AlertPriority
  /** Whether delivery was confirmed. Never assumed: a notification that failed is recorded as failed. */
  delivered: boolean
  deliveryNote: string
}

export interface MuteRule {
  /** Any of these may be omitted, and an omitted field matches everything. */
  instrumentId?: string
  patternId?: string
  interval?: string
  ruleId?: string
  /** Muted until this moment. The caller supplies the clock. */
  until: number
  reason: string
}

export interface FireDecision {
  fire: boolean
  key: string
  /** Why not, when not. One of these rather than a bare false. */
  reason: 'eligible' | 'not-eligible' | 'already-fired' | 'cooling-down' | 'muted'
  describe: string
  priority: AlertPriority
}

export interface FireInput extends EligibilityInput {
  /** Everything this rule has already fired, newest last. Only the keys and times are read. */
  alreadyFired: readonly Pick<PatternFiring, 'key' | 'ruleId' | 'instrumentId' | 'interval' | 'firedAt'>[]
  mutes: readonly MuteRule[]
  now: number
}

/**
 * Whether to fire, given everything that has already fired.
 *
 * The order of the checks is deliberate. Identity is tested before the cooldown, so a candle that refreshes a hundred
 * times is refused as *already fired* rather than as *cooling down* -- those are different situations and a user
 * reading the log should be able to tell them apart. Muting is tested first of all, because a muted market should not
 * even appear in the reasoning.
 */
export function decideFiring(input: FireInput): FireDecision {
  const { rule, detection, instrumentId, interval, now } = input
  const key = detectionKey({
    scope: rule.id,
    instrumentId,
    interval,
    patternId: detection.patternId,
    patternVersion: detection.patternVersion,
    candleTime: detection.at
  })

  const priority = priorityOf(detection, input.context)

  const muted = input.mutes.find(
    (one) =>
      one.until > now &&
      (one.instrumentId === undefined || one.instrumentId === instrumentId) &&
      (one.patternId === undefined || one.patternId === detection.patternId) &&
      (one.interval === undefined || one.interval === interval) &&
      (one.ruleId === undefined || one.ruleId === rule.id)
  )
  if (muted) {
    return { fire: false, key, reason: 'muted', describe: `Muted until ${new Date(muted.until).toISOString()}${muted.reason ? `: ${muted.reason}` : ''}.`, priority }
  }

  const eligibility = checkEligibility(input)
  if (!eligibility.eligible) {
    return { fire: false, key, reason: 'not-eligible', describe: eligibility.blocked.join(' '), priority }
  }

  if (input.alreadyFired.some((one) => one.key === key)) {
    return {
      fire: false,
      key,
      reason: 'already-fired',
      describe: 'This exact formation has already been alerted. The candle being refreshed does not make it a new one.',
      priority
    }
  }

  if (rule.cooldownMs > 0) {
    const lastForMarket = [...input.alreadyFired]
      .filter((one) => one.ruleId === rule.id && one.instrumentId === instrumentId && one.interval === interval)
      .sort((a, b) => b.firedAt - a.firedAt)[0]
    if (lastForMarket !== undefined && now - lastForMarket.firedAt < rule.cooldownMs) {
      const left = rule.cooldownMs - (now - lastForMarket.firedAt)
      return { fire: false, key, reason: 'cooling-down', describe: `This rule last fired for ${instrumentId} ${Math.round((now - lastForMarket.firedAt) / 1000)}s ago; ${Math.ceil(left / 1000)}s of its cooldown remain.`, priority }
    }
  }

  return { fire: true, key, reason: 'eligible', describe: eligibility.describe, priority }
}

// ---------------------------------------------------------------- batching

export interface AlertBatch {
  /** Every firing in the batch, each still pointing at its own detection. */
  firings: PatternFiring[]
  counts: Record<AlertPriority, number>
  byDirection: Record<PatternDirection, number>
  /** The intervals involved, most frequent first. */
  intervals: { interval: string; count: number }[]
  headline: string
  describe: string
}

/**
 * Several firings gathered into one notification.
 *
 * A market-wide scan can produce dozens at once, and dozens of notifications is the same as none. The batch is a
 * presentation: every firing keeps its own key, its own detection and its own chart, and the batch adds nothing that
 * was not in one of them. It deliberately does not summarise direction into a market view -- "8 bullish, 3 bearish"
 * is a count of shapes, and a screen that turned it into a sentiment reading would be inventing one.
 */
export function batchFirings(firings: readonly PatternFiring[], names: ReadonlyMap<string, { name: string; direction: PatternDirection }>): AlertBatch {
  const counts: Record<AlertPriority, number> = { informational: 0, normal: 0, notable: 0 }
  const byDirection: Record<PatternDirection, number> = { bullish: 0, bearish: 0, neutral: 0 }
  const intervalCounts = new Map<string, number>()

  for (const one of firings) {
    counts[one.priority] += 1
    const known = names.get(one.patternId)
    if (known !== undefined) byDirection[known.direction] += 1
    intervalCounts.set(one.interval, (intervalCounts.get(one.interval) ?? 0) + 1)
  }

  const intervals = [...intervalCounts.entries()]
    .map(([interval, count]) => ({ interval, count }))
    .sort((a, b) => b.count - a.count || a.interval.localeCompare(b.interval))

  const markets = new Set(firings.map((one) => one.instrumentId)).size

  return {
    firings: [...firings],
    counts,
    byDirection,
    intervals,
    headline: `${firings.length} candlestick pattern${firings.length === 1 ? '' : 's'} detected across ${markets} market${markets === 1 ? '' : 's'}`,
    describe: `${byDirection.bullish} bullish, ${byDirection.bearish} bearish, ${byDirection.neutral} neutral. These are counts of formations detected, not a reading of the market.`
  }
}

export type DigestPeriod = 'quarter-hour' | 'hour' | 'day'

export interface Digest {
  period: DigestPeriod
  from: number
  to: number
  total: number
  byPattern: { patternId: string; count: number }[]
  byMarket: { instrumentId: string; count: number }[]
  byDirection: Record<PatternDirection, number>
  busiestInterval: string | null
  describe: string
}

/**
 * What was detected over a stretch of time.
 *
 * Only actual firings go in. A digest with nothing in it says so; it does not reach for something to report, and an
 * empty period is a real and common answer on a quiet market.
 */
export function digestOf(
  firings: readonly PatternFiring[],
  period: DigestPeriod,
  from: number,
  to: number,
  names: ReadonlyMap<string, { name: string; direction: PatternDirection }>
): Digest {
  const inRange = firings.filter((one) => one.firedAt >= from && one.firedAt <= to)
  const count = <T,>(list: readonly T[], key: (one: T) => string): { k: string; count: number }[] => {
    const map = new Map<string, number>()
    for (const one of list) map.set(key(one), (map.get(key(one)) ?? 0) + 1)
    return [...map.entries()].map(([k, c]) => ({ k, count: c })).sort((a, b) => b.count - a.count || a.k.localeCompare(b.k))
  }

  const byDirection: Record<PatternDirection, number> = { bullish: 0, bearish: 0, neutral: 0 }
  for (const one of inRange) {
    const known = names.get(one.patternId)
    if (known !== undefined) byDirection[known.direction] += 1
  }

  const intervals = count(inRange, (one) => one.interval)

  return {
    period,
    from,
    to,
    total: inRange.length,
    byPattern: count(inRange, (one) => one.patternId).map((one) => ({ patternId: one.k, count: one.count })),
    byMarket: count(inRange, (one) => one.instrumentId).map((one) => ({ instrumentId: one.k, count: one.count })),
    byDirection,
    busiestInterval: intervals[0]?.k ?? null,
    describe:
      inRange.length === 0
        ? 'Nothing was detected in this period.'
        : `${inRange.length} detection${inRange.length === 1 ? '' : 's'} across ${new Set(inRange.map((one) => one.instrumentId)).size} market${new Set(inRange.map((one) => one.instrumentId)).size === 1 ? '' : 's'}. This describes what the detector found, not what the market is about to do.`
  }
}

/** The text equivalent of an alert card, for a screen reader and for anywhere an image cannot go. */
export function alertText(firing: PatternFiring, patternName: string, symbol: string, at: string): string {
  return `${patternName} detected on ${symbol}, ${firing.interval} timeframe, at ${at}. Pattern detection does not indicate what the price will do next.`
}

/** The assumptions the alert layer rests on, shown rather than implied. */
export const ALERT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A firing is identified by market, interval, pattern, definition version and the candle’s timestamp, so a refreshed candle cannot fire twice.',
  'Identity is checked before the cooldown, so an already-alerted formation is reported as already alerted rather than as cooling down.',
  'A condition that cannot be evaluated counts as unmet. An unevaluable filter that passed would be a filter that stopped filtering.',
  'A rule with an empty requirement list is refused, because it can never match anything while looking like coverage.',
  'Priority says how much of what the rule asked for was present. It is not a probability, a strength, or a recommendation.',
  'There is no priority above notable, so nothing can escalate an alert into a call to act.',
  'Delivery is recorded as confirmed only when it was confirmed. A failed notification is stored as failed.',
  'A batch adds nothing that was not in one of its firings, and each firing still points at its own detection and chart.',
  'A digest contains only detections that actually happened; an empty period says so.'
])
