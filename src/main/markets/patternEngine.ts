import type { Candle } from '../../shared/markets/indicators.ts'
import {
  batchFirings,
  decideFiring,
  type MuteRule,
  type PatternAlertRule,
  type PatternFiring
} from '../../shared/markets/patternAlerts.ts'
import { contextFor, timeframeContext, type PatternContext, type TimeframeAgreement } from '../../shared/markets/patternContext.ts'
import { detect, detectAt, mostSpecific, type NearMiss, type PatternDetection } from '../../shared/markets/patternDetect.ts'
import { recordOf, type PatternRecord } from '../../shared/markets/patternHistory.ts'
import { PATTERNS } from '../../shared/markets/patterns.ts'
import type { PatternSettings, PatternState } from '../../shared/markets/patternSettings.ts'

/**
 * Running the pattern detector over real market candles, once per closed candle and not once per tick.
 *
 * This is the part that has to be careful about work. A live market publishes an update for the forming candle many
 * times a second; re-running sixty pattern definitions over a twenty-candle window on each of those, across a
 * watchlist, is how a background feature makes an application feel broken. So the engine keeps, per market and
 * interval, the timestamp of the last candle it has already examined, and does nothing at all until a *new* one
 * closes.
 *
 * ## What the engine is not
 *
 * It does not fetch candles, hold subscriptions, deliver notifications or write files. `MarketEngine` already owns
 * the provider, `MarketsStore` owns the profile's file and Orbis already has a notification path. This takes candles
 * in and produces decisions out, which makes the whole thing testable without a network, a clock or a window.
 *
 * ## Switching it off means the work stops
 *
 * `release` drops every remembered cursor and every cached detection. With the master switch off, `examine` returns
 * immediately and reports that it did nothing, so there is no path by which the detector keeps running behind a
 * switch that says it is off.
 */

export interface ExamineInput {
  instrumentId: string
  exchange: string
  symbol: string
  interval: string
  /** Candles oldest first, as the provider gave them. */
  candles: readonly Candle[]
  /** Whether the last candle is still forming. Live feeds must say so; historical ranges must not. */
  lastIsDeveloping: boolean
  /** The other intervals, for the multi-timeframe reading. Only consulted when the setting is on. */
  otherTimeframes?: readonly { interval: string; candles: readonly Candle[] }[]
  now: number
}

export interface ExaminedPattern {
  detection: PatternDetection
  /** Null when context analysis is off, never a default context. */
  context: PatternContext | null
  timeframeAgreement: TimeframeAgreement | null
}

export interface ExamineResult {
  instrumentId: string
  interval: string
  /** Confirmed formations at the newly closed candles, most specific classification only. */
  found: ExaminedPattern[]
  /** Formations on the candle that is still forming. Never confirmed, never alerted by default. */
  developing: ExaminedPattern[]
  nearMisses: NearMiss[]
  /** How many candles this call actually examined. Zero when nothing new has closed. */
  examined: number
  /** Why nothing was examined, when nothing was. */
  skipped: 'disabled' | 'no-new-candles' | 'too-few-candles' | null
  describe: string
}

/** The smallest history the engine will run against: enough for a rolling comparison plus a three-candle formation. */
export const MINIMUM_CANDLES = 25

interface Cursor {
  /** The closing time of the last candle whose formations have been examined. */
  lastExamined: number
  /** What was found there, kept so a repeated request does not repeat the work. */
  found: ExaminedPattern[]
}

export class PatternEngine {
  #settings: PatternSettings
  #cursors = new Map<string, Cursor>()

  constructor(settings: PatternSettings) {
    this.#settings = settings
  }

  /**
   * Replace the settings.
   *
   * Anything that changes what would be detected clears the cursors, so the next examination re-runs rather than
   * reporting what an older configuration found. Without that, switching from standard to strict would leave the
   * loose detections on screen under a label saying strict.
   */
  configure(next: PatternSettings): void {
    const before = this.#settings
    const affectsDetection =
      before.mode !== next.mode ||
      before.minimumMatch !== next.minimumMatch ||
      before.minimumDataQuality !== next.minimumDataQuality ||
      before.developing !== next.developing ||
      before.nearMisses !== next.nearMisses ||
      before.context !== next.context ||
      before.multiTimeframe !== next.multiTimeframe ||
      before.onlyPatterns.join(',') !== next.onlyPatterns.join(',') ||
      before.exceptPatterns.join(',') !== next.exceptPatterns.join(',')

    this.#settings = next
    if (affectsDetection || !next.enabled) this.#cursors.clear()
  }

  settings(): PatternSettings {
    return this.#settings
  }

  /** Drop everything held. Called when the master switch goes off, or when a profile is closed. */
  release(): void {
    this.#cursors.clear()
  }

  /** How much the engine is currently holding, for diagnostics. */
  held(): { markets: number; detections: number } {
    let detections = 0
    for (const one of this.#cursors.values()) detections += one.found.length
    return { markets: this.#cursors.size, detections }
  }

  /**
   * Examine what has closed since the last time this market and interval were looked at.
   *
   * The first call on a market examines the last few closed candles rather than the whole history: a chart that has
   * just opened should show the formations that are actually on it, and re-deriving a thousand candles to draw the
   * visible twenty is work nobody asked for. A deliberate historical scan is a different operation.
   */
  examine(input: ExamineInput): ExamineResult {
    const key = `${input.instrumentId}|${input.interval}`
    const empty = (skipped: ExamineResult['skipped'], describe: string): ExamineResult => ({
      instrumentId: input.instrumentId,
      interval: input.interval,
      found: skipped === 'no-new-candles' ? (this.#cursors.get(key)?.found ?? []) : [],
      developing: [],
      nearMisses: [],
      examined: 0,
      skipped,
      describe
    })

    if (!this.#settings.enabled) return empty('disabled', 'Candlestick pattern detection is switched off.')
    if (input.candles.length < MINIMUM_CANDLES) {
      return empty('too-few-candles', `${input.candles.length} candles is fewer than the ${MINIMUM_CANDLES} the detector needs to compare sizes against.`)
    }

    // The last closed candle: one back when the final candle is still forming.
    const lastClosed = input.lastIsDeveloping ? input.candles.length - 2 : input.candles.length - 1
    if (lastClosed < 0) return empty('too-few-candles', 'Every candle given is still forming.')
    const lastClosedTime = (input.candles[lastClosed] as Candle).time

    const cursor = this.#cursors.get(key)
    const developing = this.#settings.developing && input.lastIsDeveloping ? this.#examineDeveloping(input) : []

    if (cursor !== undefined && cursor.lastExamined >= lastClosedTime) {
      const held = empty('no-new-candles', 'No candle has closed since this market was last examined.')
      return { ...held, developing }
    }

    // How far back to look. On a first sight of this market, only the recent tail; afterwards, everything new.
    const from =
      cursor === undefined
        ? Math.max(MINIMUM_CANDLES - 1, lastClosed - 20)
        : Math.max(0, input.candles.findIndex((one) => one.time > cursor.lastExamined))

    const result = detect(input.candles, {
      mode: this.#settings.mode,
      only: this.#settings.onlyPatterns,
      except: this.#settings.exceptPatterns,
      includeNearMisses: this.#settings.nearMisses,
      from: Math.max(0, from),
      to: lastClosed
    })

    const usable = result.detections.filter(
      (one) => one.structuralMatch >= this.#settings.minimumMatch && QUALITY[one.dataQuality.level] >= QUALITY[this.#settings.minimumDataQuality]
    )

    const found = mostSpecific(usable).map((detection) => this.#withContext(detection, input))

    this.#cursors.set(key, { lastExamined: lastClosedTime, found })

    return {
      instrumentId: input.instrumentId,
      interval: input.interval,
      found,
      developing,
      nearMisses: result.nearMisses,
      examined: lastClosed - Math.max(0, from) + 1,
      skipped: null,
      describe:
        found.length === 0
          ? `Examined ${lastClosed - Math.max(0, from) + 1} candle${lastClosed - Math.max(0, from) + 1 === 1 ? '' : 's'} and found no formation that met the thresholds.`
          : `Found ${found.length} formation${found.length === 1 ? '' : 's'}.`
    }
  }

  #examineDeveloping(input: ExamineInput): ExaminedPattern[] {
    const at = input.candles.length - 1
    const result = detectAt(input.candles, at, {
      mode: this.#settings.mode,
      only: this.#settings.onlyPatterns,
      except: this.#settings.exceptPatterns,
      lastIsDeveloping: true
    })
    return mostSpecific(result.detections.filter((one) => one.structuralMatch >= this.#settings.minimumMatch)).map((detection) =>
      this.#withContext(detection, input)
    )
  }

  #withContext(detection: PatternDetection, input: ExamineInput): ExaminedPattern {
    // Context off means no context, not an empty one: every rule reading it treats absent as unmet.
    const context = this.#settings.context ? contextFor(input.candles, detection) : null

    let timeframeAgreement: TimeframeAgreement | null = null
    if (this.#settings.multiTimeframe && input.otherTimeframes !== undefined && input.otherTimeframes.length > 0) {
      const wanted = input.otherTimeframes.filter((one) => this.#settings.timeframes.includes(one.interval) && one.interval !== input.interval)
      if (wanted.length > 0) timeframeAgreement = timeframeContext(wanted, detection.direction).agreement
    }

    return { detection, context, timeframeAgreement }
  }
}

const QUALITY: Record<string, number> = { unusable: 0, poor: 1, reduced: 2, high: 3 }

// ---------------------------------------------------------------- alerts and records

export interface AlertDecisionInput {
  state: PatternState
  examined: ExamineResult
  exchange: string
  symbol: string
  /** Which markets are in the watchlist and the favourites, for rules scoped to those. */
  inWatchlist: boolean
  inFavourites: boolean
  now: number
}

export interface AlertDecisions {
  /** Firings to deliver, already deduplicated against what has fired. */
  fire: { rule: PatternAlertRule; pattern: ExaminedPattern; firing: PatternFiring }[]
  /** Everything considered and refused, with the reason. Kept so "why did nothing fire" has an answer. */
  refused: { ruleId: string; patternId: string; reason: string; describe: string }[]
  describe: string
}

/**
 * Which of the formations just found should produce an alert.
 *
 * Every rule is considered against every formation, and every refusal is recorded with its reason. That list is the
 * answer to the commonest support question a feature like this generates -- "why didn't it tell me?" -- and without
 * it the only available answer is a shrug.
 *
 * Firings accumulate within the call as well as against stored history, so two rules matching the same formation
 * produce one alert each and a single rule cannot fire twice on one pass.
 */
export function decideAlerts(input: AlertDecisionInput): AlertDecisions {
  const { state, examined, now } = input
  const fire: AlertDecisions['fire'] = []
  const refused: AlertDecisions['refused'] = []

  if (!state.settings.enabled || !state.settings.alerts) {
    return {
      fire: [],
      refused: [],
      describe: state.settings.enabled ? 'Pattern alerts are switched off.' : 'Candlestick pattern detection is switched off.'
    }
  }

  const alreadyFired: Pick<PatternFiring, 'key' | 'ruleId' | 'instrumentId' | 'interval' | 'firedAt'>[] = [...state.firings]
  const mutes: readonly MuteRule[] = state.mutes
  const candidates = [...examined.found, ...examined.developing]

  for (const rule of state.rules) {
    for (const pattern of candidates) {
      const decision = decideFiring({
        rule,
        detection: pattern.detection,
        instrumentId: examined.instrumentId,
        interval: examined.interval,
        context: pattern.context ?? undefined,
        timeframeAgreement: pattern.timeframeAgreement ?? undefined,
        inScope: rule.scope === 'watchlist' ? input.inWatchlist : rule.scope === 'favourites' ? input.inFavourites : undefined,
        alreadyFired,
        mutes,
        now
      })

      if (!decision.fire) {
        refused.push({ ruleId: rule.id, patternId: pattern.detection.patternId, reason: decision.reason, describe: decision.describe })
        continue
      }

      const firing: PatternFiring = {
        key: decision.key,
        ruleId: rule.id,
        instrumentId: examined.instrumentId,
        interval: examined.interval,
        patternId: pattern.detection.patternId,
        patternVersion: pattern.detection.patternVersion,
        candleTime: pattern.detection.at,
        firedAt: now,
        priority: decision.priority,
        // Never true until delivery is confirmed. The caller sets it after the notification actually went out.
        delivered: false,
        deliveryNote: ''
      }
      fire.push({ rule, pattern, firing })
      // Added within the pass so the same rule cannot fire twice on one examination.
      alreadyFired.push(firing)
    }
  }

  return {
    fire,
    refused,
    describe:
      fire.length === 0
        ? refused.length === 0
          ? 'No rule is watching this market.'
          : `Nothing fired. ${refused.length} rule-and-formation pair${refused.length === 1 ? ' was' : 's were'} considered and refused.`
        : `${fire.length} alert${fire.length === 1 ? '' : 's'} to deliver.`
  }
}

/** A batch for delivery, using the library's own names so a notification is not built from ids. */
export function batchForDelivery(firings: readonly PatternFiring[]): ReturnType<typeof batchFirings> {
  return batchFirings(firings, new Map(PATTERNS.map((one) => [one.id, { name: one.name, direction: one.direction }])))
}

export interface RecordInput {
  examined: ExamineResult
  exchange: string
  symbol: string
  now: number
  /** Chart images, by detection key, where any were made. */
  snapshots?: ReadonlyMap<string, string>
}

/**
 * Records for what was just found.
 *
 * Only confirmed formations are recorded. A developing one is not a fact about the market yet -- its candle can still
 * become something else -- and a history full of shapes that never finished forming would not be a history of what
 * happened.
 */
export function recordsFor(input: RecordInput, settings: PatternSettings): PatternRecord[] {
  if (!settings.enabled || !settings.history) return []

  return input.examined.found
    .filter((one) => one.detection.status === 'confirmed')
    .map((one) =>
      recordOf({
        detection: one.detection,
        instrumentId: input.examined.instrumentId,
        exchange: input.exchange,
        symbol: input.symbol,
        interval: input.examined.interval,
        price: 0,
        recordedAt: input.now,
        context:
          one.context === null
            ? null
            : {
                regime: one.context.regime.regime,
                volume: one.context.volume.reading,
                volatility: one.context.volatility.reading,
                placement: one.context.levels.placement,
                agreements: one.context.agreements.length,
                conflicts: one.context.conflicts.length
              },
        snapshotRef: input.snapshots?.get(one.detection.key) ?? null
      })
    )
}

/** The assumptions the engine rests on, shown rather than implied. */
export const ENGINE_ASSUMPTIONS: readonly string[] = Object.freeze([
  'A market is examined once per closed candle, not once per tick, however often the forming candle updates.',
  'The first sight of a market examines the recent tail rather than its whole history; a full scan is a separate operation.',
  'A setting that changes what would be detected clears what was remembered, so nothing stays on screen under a label that no longer produced it.',
  'With the master switch off, examining returns immediately and reports that it did nothing.',
  'Context off means no context, never an empty one, so every rule reading it treats the condition as unmet.',
  'A firing is recorded as undelivered until delivery is confirmed by whatever actually delivered it.',
  'Firings accumulate within a pass as well as against stored history, so one rule cannot fire twice on one examination.',
  'Every refusal is recorded with its reason, so "why did nothing fire" has an answer.',
  'Only confirmed formations are recorded. A developing one can still become something else.'
])
