import type { DataQualityLevel } from './patternDetect.ts'
import { DEFAULT_RULE, type MuteRule, type PatternAlertRule, type PatternFiring } from './patternAlerts.ts'
import { type PatternRecord, type Retention } from './patternHistory.ts'
import type { DetectionMode } from './patterns.ts'

/**
 * What the user has switched on, and where it is kept.
 *
 * Every switch here does something. A toggle whose only effect is that it looks configurable is worse than a missing
 * feature: somebody turns it off, believes the work stopped, and it did not. So each one is named for the work it
 * actually stops, and `whatStops` below is the list the engine reads -- there is one place that decides what a switch
 * means, and the settings screen and the engine both read it.
 *
 * The master switch is separate from everything under it, and separate again from the Markets switch above it.
 * Turning off pattern detection releases the detector and leaves prices, charts, watchlists, alerts and every other
 * part of Markets exactly where they were.
 */

export interface PatternSettings {
  /** The master switch. Off releases the detector and stops all the work below. */
  enabled: boolean

  /** Fire alerts from detections. Off leaves detection running for the chart and the panel. */
  alerts: boolean
  /** Render a chart image with each alert. Off delivers the alert with its text and no picture. */
  images: boolean
  /** Keep a record of what was detected. Off means the panel shows only what is on screen now. */
  history: boolean
  retention: Retention

  /** Gather the surrounding market context. Off makes every context filter in every rule unsatisfiable. */
  context: boolean
  /** Examine the other intervals. Off makes the timeframe filter unsatisfiable. */
  multiTimeframe: boolean
  /** Which intervals the multi-timeframe reading looks at. Empty means it looks at none. */
  timeframes: string[]

  /** Report formations on the candle that is still forming. They can never be confirmed or alerted by default. */
  developing: boolean
  /** Draw markers on the chart. Independent of detection: the detector can run with nothing drawn. */
  markers: boolean
  markerDetail: 'off' | 'minimal' | 'normal' | 'detailed'

  mode: DetectionMode
  /** Patterns to look for. Empty means every pattern in the library. */
  onlyPatterns: string[]
  /** Patterns never to report, applied after the above. */
  exceptPatterns: string[]
  minimumMatch: number
  minimumDataQuality: DataQualityLevel

  /** Expose formations that missed by one rule. Research use; off by default. */
  nearMisses: boolean
  /** Let Orion explain a detection. Off means Orion is never called about patterns. */
  orion: boolean
  /** Send a periodic summary instead of, or beside, individual alerts. */
  digest: 'off' | 'quarter-hour' | 'hour' | 'day'
}

/**
 * The defaults.
 *
 * Detection on, alerts off. A feature that starts notifying somebody the moment it is installed is a feature they
 * switch off entirely within a day, and the detection is useful on the chart without ever interrupting anybody.
 */
export const DEFAULT_PATTERN_SETTINGS: PatternSettings = Object.freeze({
  enabled: true,
  alerts: false,
  images: true,
  history: true,
  retention: '30d' as Retention,
  context: true,
  multiTimeframe: true,
  timeframes: ['1h', '4h', '1d'],
  developing: false,
  markers: true,
  markerDetail: 'normal' as const,
  mode: 'standard' as DetectionMode,
  onlyPatterns: [],
  exceptPatterns: [],
  minimumMatch: 0.15,
  minimumDataQuality: 'reduced' as DataQualityLevel,
  nearMisses: false,
  orion: true,
  digest: 'off' as const
})

/**
 * What each switch actually stops, in the engine's own terms.
 *
 * One table read by both the settings screen and the engine, so a toggle's description and its effect cannot drift
 * apart. A switch missing from here would have no described effect, which is exactly the kind of decorative control
 * this table exists to make impossible.
 */
export const WHAT_STOPS: Readonly<Record<keyof PatternSettings, string>> = Object.freeze({
  enabled:
    'Stops detection, releases the detector, cancels pending analysis and stops evaluating pattern alerts. Prices, charts, watchlists and every other Markets alert keep working.',
  alerts: 'Stops evaluating pattern alert rules. Detection continues for the chart and the panel.',
  images: 'Stops rendering a chart image for each alert. The alert still carries its text, market, interval and time.',
  history: 'Stops recording detections. Nothing already recorded is deleted.',
  retention: 'How long recorded detections are kept before they and their images are removed.',
  context:
    'Stops gathering trend, level, volume, volatility and momentum context. Any alert rule with a context condition can no longer be satisfied, because an unevaluable condition counts as unmet.',
  multiTimeframe: 'Stops examining the other intervals. A rule requiring timeframe agreement can no longer be satisfied.',
  timeframes: 'Which intervals the multi-timeframe reading examines.',
  developing: 'Stops reporting formations on the candle that is still forming.',
  markers: 'Stops drawing markers on the chart. Detection is unaffected.',
  markerDetail: 'How much each chart marker shows. Detection is unaffected.',
  mode: 'How close to the canonical definition a formation must be. Affects what is detected, not what price does.',
  onlyPatterns: 'Restricts detection to the patterns chosen. Empty means the whole library.',
  exceptPatterns: 'Removes patterns from detection, applied after the restriction above.',
  minimumMatch: 'Formations below this match strength are not reported at all.',
  minimumDataQuality: 'Formations whose data quality is below this are not reported at all.',
  nearMisses: 'Reports formations that missed by exactly one rule, with the rule that failed.',
  orion: 'Stops Orion being asked about patterns. Detection, alerts, charts and history all keep working.',
  digest: 'Sends a periodic summary of what was detected. Off means no summary.'
})

// ---------------------------------------------------------------- limits

export const PATTERN_LIMITS: Readonly<Record<'rules' | 'history' | 'firings' | 'mutes' | 'timeframes' | 'patterns', number>> = Object.freeze({
  rules: 100,
  /** Records kept per profile. Snapshots are the expensive part, so this is deliberately not generous. */
  history: 5000,
  firings: 1000,
  mutes: 200,
  timeframes: 6,
  patterns: 500
})

// ---------------------------------------------------------------- reading a stored file

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const num = (value: unknown, fallback: number, low: number, high: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback
const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
const strings = (value: unknown, cap: number): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((one): one is string => typeof one === 'string' && one.length > 0 && one.length < 200))].slice(0, cap) : []

/**
 * Settings read back from disk.
 *
 * A file written before this feature existed has none of these keys, and the honest reading of that is the defaults --
 * not "everything off", which would make the feature silently absent for anybody who had used Orbis before it shipped.
 */
export function cleanPatternSettings(raw: unknown): PatternSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PATTERN_SETTINGS }
  const o = raw as Record<string, unknown>
  return {
    enabled: bool(o.enabled, DEFAULT_PATTERN_SETTINGS.enabled),
    alerts: bool(o.alerts, DEFAULT_PATTERN_SETTINGS.alerts),
    images: bool(o.images, DEFAULT_PATTERN_SETTINGS.images),
    history: bool(o.history, DEFAULT_PATTERN_SETTINGS.history),
    retention: pick(o.retention, ['7d', '30d', '90d', '1y', 'forever'] as const, DEFAULT_PATTERN_SETTINGS.retention),
    context: bool(o.context, DEFAULT_PATTERN_SETTINGS.context),
    multiTimeframe: bool(o.multiTimeframe, DEFAULT_PATTERN_SETTINGS.multiTimeframe),
    timeframes: o.timeframes === undefined ? [...DEFAULT_PATTERN_SETTINGS.timeframes] : strings(o.timeframes, PATTERN_LIMITS.timeframes),
    developing: bool(o.developing, DEFAULT_PATTERN_SETTINGS.developing),
    markers: bool(o.markers, DEFAULT_PATTERN_SETTINGS.markers),
    markerDetail: pick(o.markerDetail, ['off', 'minimal', 'normal', 'detailed'] as const, DEFAULT_PATTERN_SETTINGS.markerDetail),
    mode: pick(o.mode, ['standard', 'strict', 'research'] as const, DEFAULT_PATTERN_SETTINGS.mode),
    onlyPatterns: strings(o.onlyPatterns, PATTERN_LIMITS.patterns),
    exceptPatterns: strings(o.exceptPatterns, PATTERN_LIMITS.patterns),
    minimumMatch: num(o.minimumMatch, DEFAULT_PATTERN_SETTINGS.minimumMatch, 0, 0.99),
    minimumDataQuality: pick(o.minimumDataQuality, ['poor', 'reduced', 'high'] as const, DEFAULT_PATTERN_SETTINGS.minimumDataQuality),
    nearMisses: bool(o.nearMisses, DEFAULT_PATTERN_SETTINGS.nearMisses),
    orion: bool(o.orion, DEFAULT_PATTERN_SETTINGS.orion),
    digest: pick(o.digest, ['off', 'quarter-hour', 'hour', 'day'] as const, DEFAULT_PATTERN_SETTINGS.digest)
  }
}

/** One alert rule read back from disk, or null when it cannot be made into one. */
export function cleanPatternRule(raw: unknown, at: number): PatternAlertRule | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  // An id is required rather than minted here: a rule read back without one is a corrupt record, and inventing an id
  // would silently create a second copy of a rule the user already has.
  if (typeof o.id !== 'string' || o.id.length === 0 || o.id.length > 200) return null

  return {
    id: o.id,
    enabled: bool(o.enabled, true),
    name: typeof o.name === 'string' && o.name.length > 0 ? o.name.slice(0, 200) : 'Pattern alert',
    scope: pick(o.scope, ['instruments', 'watchlist', 'favourites'] as const, DEFAULT_RULE.scope),
    instrumentIds: strings(o.instrumentIds, 500),
    patternIds: strings(o.patternIds, PATTERN_LIMITS.patterns),
    categories: strings(o.categories, 3).filter((one): one is 'reversal' | 'continuation' | 'indecision' =>
      ['reversal', 'continuation', 'indecision'].includes(one)
    ),
    directions: strings(o.directions, 3).filter((one): one is 'bullish' | 'bearish' | 'neutral' => ['bullish', 'bearish', 'neutral'].includes(one)),
    intervals: strings(o.intervals, 20),
    minimumStructuralMatch: num(o.minimumStructuralMatch, DEFAULT_RULE.minimumStructuralMatch, 0, 0.99),
    minimumDataQuality: pick(o.minimumDataQuality, ['poor', 'reduced', 'high'] as const, DEFAULT_RULE.minimumDataQuality),
    // Null and an empty array mean different things, so an absent key becomes null and never [].
    requireVolume: Array.isArray(o.requireVolume) && o.requireVolume.length > 0 ? (strings(o.requireVolume, 8) as PatternAlertRule['requireVolume']) : null,
    requirePlacement: Array.isArray(o.requirePlacement) && o.requirePlacement.length > 0 ? (strings(o.requirePlacement, 4) as PatternAlertRule['requirePlacement']) : null,
    requireTimeframeAgreement:
      Array.isArray(o.requireTimeframeAgreement) && o.requireTimeframeAgreement.length > 0
        ? (strings(o.requireTimeframeAgreement, 4) as PatternAlertRule['requireTimeframeAgreement'])
        : null,
    excludeWhenConflicted: bool(o.excludeWhenConflicted, false),
    allowDeveloping: bool(o.allowDeveloping, false),
    cooldownMs: num(o.cooldownMs, DEFAULT_RULE.cooldownMs, 0, 24 * 60 * 60_000),
    createdAt: num(o.createdAt, at, 0, Number.MAX_SAFE_INTEGER)
  }
}

export function cleanPatternRules(raw: unknown, at: number): PatternAlertRule[] {
  const out: PatternAlertRule[] = []
  const seen = new Set<string>()
  for (const one of Array.isArray(raw) ? raw : []) {
    const rule = cleanPatternRule(one, at)
    if (!rule || seen.has(rule.id)) continue
    seen.add(rule.id)
    out.push(rule)
    if (out.length >= PATTERN_LIMITS.rules) break
  }
  return out
}

/** One recorded detection read back from disk. */
export function cleanPatternRecord(raw: unknown): PatternRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.key !== 'string' || o.key.length === 0) return null
  if (typeof o.patternId !== 'string' || typeof o.instrumentId !== 'string') return null
  if (typeof o.candleTime !== 'number' || !Number.isFinite(o.candleTime)) return null

  const context = o.context
  return {
    key: o.key,
    instrumentId: o.instrumentId,
    exchange: typeof o.exchange === 'string' ? o.exchange : '',
    symbol: typeof o.symbol === 'string' ? o.symbol : '',
    interval: typeof o.interval === 'string' ? o.interval : '',
    patternId: o.patternId,
    patternName: typeof o.patternName === 'string' ? o.patternName : o.patternId,
    patternVersion: num(o.patternVersion, 1, 1, 1000),
    libraryVersion: num(o.libraryVersion, 1, 1, 1000),
    category: pick(o.category, ['reversal', 'continuation', 'indecision'] as const, 'reversal'),
    direction: pick(o.direction, ['bullish', 'bearish', 'neutral'] as const, 'neutral'),
    candleTime: o.candleTime,
    candleTimes: Array.isArray(o.candleTimes) ? o.candleTimes.filter((one): one is number => typeof one === 'number').slice(0, 10) : [o.candleTime],
    recordedAt: num(o.recordedAt, o.candleTime, 0, Number.MAX_SAFE_INTEGER),
    price: num(o.price, 0, 0, Number.MAX_SAFE_INTEGER),
    structuralMatch: num(o.structuralMatch, 0, 0, 1),
    dataQuality: pick(o.dataQuality, ['unusable', 'poor', 'reduced', 'high'] as const, 'reduced'),
    mode: pick(o.mode, ['standard', 'strict', 'research'] as const, 'standard'),
    context:
      context && typeof context === 'object'
        ? {
            regime: pick(
              (context as Record<string, unknown>).regime,
              ['strong-uptrend', 'weak-uptrend', 'strong-downtrend', 'weak-downtrend', 'range', 'compression', 'expansion', 'unknown'] as const,
              'unknown'
            ),
            volume: pick(
              (context as Record<string, unknown>).volume,
              ['unavailable', 'well-below-average', 'below-average', 'average', 'above-average', 'well-above-average'] as const,
              'unavailable'
            ),
            volatility: pick((context as Record<string, unknown>).volatility, ['unavailable', 'very-low', 'low', 'normal', 'elevated', 'high'] as const, 'unavailable'),
            placement: pick((context as Record<string, unknown>).placement, ['at-support', 'at-resistance', 'between', 'unclear'] as const, 'unclear'),
            agreements: num((context as Record<string, unknown>).agreements, 0, 0, 100),
            conflicts: num((context as Record<string, unknown>).conflicts, 0, 0, 100)
          }
        : null,
    snapshotRef: typeof o.snapshotRef === 'string' && o.snapshotRef.length > 0 ? o.snapshotRef : null,
    revised: bool(o.revised, false)
  }
}

export function cleanPatternRecords(raw: unknown): PatternRecord[] {
  const out: PatternRecord[] = []
  const seen = new Set<string>()
  for (const one of Array.isArray(raw) ? raw : []) {
    const record = cleanPatternRecord(one)
    if (!record || seen.has(record.key)) continue
    seen.add(record.key)
    out.push(record)
  }
  return out.sort((a, b) => a.recordedAt - b.recordedAt).slice(-PATTERN_LIMITS.history)
}

/** One firing read back from disk. Only what deduplication needs is required. */
export function cleanPatternFiring(raw: unknown): PatternFiring | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.key !== 'string' || o.key.length === 0) return null
  return {
    key: o.key,
    ruleId: typeof o.ruleId === 'string' ? o.ruleId : '',
    instrumentId: typeof o.instrumentId === 'string' ? o.instrumentId : '',
    interval: typeof o.interval === 'string' ? o.interval : '',
    patternId: typeof o.patternId === 'string' ? o.patternId : '',
    patternVersion: num(o.patternVersion, 1, 1, 1000),
    candleTime: num(o.candleTime, 0, 0, Number.MAX_SAFE_INTEGER),
    firedAt: num(o.firedAt, 0, 0, Number.MAX_SAFE_INTEGER),
    priority: pick(o.priority, ['informational', 'normal', 'notable'] as const, 'normal'),
    // Delivery is never assumed from a stored record: a firing written before delivery was confirmed stays unconfirmed.
    delivered: bool(o.delivered, false),
    deliveryNote: typeof o.deliveryNote === 'string' ? o.deliveryNote.slice(0, 500) : ''
  }
}

export function cleanPatternFirings(raw: unknown): PatternFiring[] {
  const out: PatternFiring[] = []
  const seen = new Set<string>()
  for (const one of Array.isArray(raw) ? raw : []) {
    const firing = cleanPatternFiring(one)
    if (!firing || seen.has(firing.key)) continue
    seen.add(firing.key)
    out.push(firing)
  }
  return out.sort((a, b) => a.firedAt - b.firedAt).slice(-PATTERN_LIMITS.firings)
}

export function cleanPatternMutes(raw: unknown): MuteRule[] {
  const out: MuteRule[] = []
  for (const one of Array.isArray(raw) ? raw : []) {
    if (!one || typeof one !== 'object') continue
    const o = one as Record<string, unknown>
    if (typeof o.until !== 'number' || !Number.isFinite(o.until)) continue
    out.push({
      instrumentId: typeof o.instrumentId === 'string' ? o.instrumentId : undefined,
      patternId: typeof o.patternId === 'string' ? o.patternId : undefined,
      interval: typeof o.interval === 'string' ? o.interval : undefined,
      ruleId: typeof o.ruleId === 'string' ? o.ruleId : undefined,
      until: o.until,
      reason: typeof o.reason === 'string' ? o.reason.slice(0, 200) : ''
    })
    if (out.length >= PATTERN_LIMITS.mutes) break
  }
  return out
}

/** The whole pattern section of a profile's Markets file. */
export interface PatternState {
  settings: PatternSettings
  rules: PatternAlertRule[]
  records: PatternRecord[]
  firings: PatternFiring[]
  mutes: MuteRule[]
}

export const EMPTY_PATTERN_STATE: PatternState = Object.freeze({
  settings: DEFAULT_PATTERN_SETTINGS,
  rules: [],
  records: [],
  firings: [],
  mutes: []
})

export function cleanPatternState(raw: unknown, at: number): PatternState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_PATTERN_STATE, settings: { ...DEFAULT_PATTERN_SETTINGS } }
  const o = raw as Record<string, unknown>
  return {
    settings: cleanPatternSettings(o.settings),
    rules: cleanPatternRules(o.rules, at),
    records: cleanPatternRecords(o.records),
    firings: cleanPatternFirings(o.firings),
    // An expired mute is dropped on read rather than kept for ever: it is a decision that has already finished.
    mutes: cleanPatternMutes(o.mutes).filter((one) => one.until > at)
  }
}

/** The assumptions the settings layer rests on, shown rather than implied. */
export const SETTINGS_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every switch stops specific work, and what it stops is written in one table that the engine and the settings screen both read.',
  'The master switch releases the detector and leaves prices, charts, watchlists and every other Markets alert running.',
  'Detection is on by default and alerts are off: a feature that starts interrupting on the day it arrives gets switched off entirely.',
  'A file written before this feature existed reads as the defaults, not as everything switched off.',
  'A rule read back without an id is refused rather than given a new one, which would create a second copy of a rule the user already has.',
  'An absent requirement becomes null and never an empty array: an empty list matches nothing while looking like no requirement.',
  'A stored firing is never read back as delivered unless delivery was recorded as confirmed.',
  'An expired mute is dropped when the file is read, because it is a decision that has already finished.'
])
