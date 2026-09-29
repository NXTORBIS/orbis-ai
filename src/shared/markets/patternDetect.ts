import {
  checkCandle,
  checkSequence,
  geometryOf,
  rollingStats,
  type CandleFacts,
  type RollingStats
} from './candleGeometry.ts'
import type { Candle } from './indicators.ts'
import {
  PATTERNS,
  PATTERN_LIBRARY_VERSION,
  TOLERANCES,
  ancestorsOf,
  patternById,
  priorTrend,
  type DetectionMode,
  type PatternCategory,
  type PatternDefinition,
  type PatternDirection,
  type Tolerance,
  type TrendReading
} from './patterns.ts'

/**
 * Running the pattern definitions over real candles, and saying exactly why each answer came out as it did.
 *
 * Everything here is deterministic. The same candles, the same definition version and the same tolerance produce the
 * same detections, every time, on any machine — which is the only reason a detection from six months ago can still be
 * explained, compared, or argued with. No model, no sampling, no clock.
 *
 * ## A detection carries its own evidence
 *
 * Every detection holds the result of every rule that was evaluated, including what each rule measured. That is not
 * diagnostics bolted on afterwards; it is the detection. A user asking "why is that a Bullish Engulfing" gets the
 * actual comparison the detector made, with the actual numbers, rather than a sentence somebody wrote once about what
 * Bullish Engulfings generally are.
 *
 * ## Match strength is a margin, and nothing else
 *
 * `structuralMatch` is how comfortably the candles cleared the thresholds the definition draws. 0.9 means the shape is
 * well inside the definition; 0.1 means it only just qualifies. It is **not** a probability, not a confidence that
 * price will move, and not a quality score for the trade nobody should be taking on it. Every field that could be
 * mistaken for a forecast is named so it cannot be.
 *
 * ## What is not detected is reported too
 *
 * A formation that satisfied every rule but one is a near miss, and research mode returns them with the rule that
 * failed and what it measured. That is the most useful thing a detector can say when a user is staring at a candle
 * that looks like a hammer and wondering why Orbis disagrees.
 */

// ---------------------------------------------------------------- inputs

export interface DetectOptions {
  mode?: DetectionMode
  /** How many candles the rolling comparison window uses. */
  statsWindow?: number
  /** Only these patterns. Empty or absent means all of them. */
  only?: readonly string[]
  /** Never these patterns. Applied after `only`. */
  except?: readonly string[]
  /**
   * Whether the last candle is still forming.
   *
   * A developing candle can produce a candidate and never a confirmation, because its shape is not final: a hammer at
   * the half-hour mark is a hammer-shaped thing that may close as a marubozu. Defaults to false, which treats every
   * candle given as closed — so a caller passing live data must say so.
   */
  lastIsDeveloping?: boolean
  /** Include formations that missed by exactly one rule. Off unless asked for. */
  includeNearMisses?: boolean
}

// ---------------------------------------------------------------- data quality

export type DataQualityLevel = 'high' | 'reduced' | 'poor' | 'unusable'

export interface DataQuality {
  level: DataQualityLevel
  /** Every specific thing that lowered it. Empty at `high`. */
  reasons: string[]
  /** Whether the formation's own candles are internally consistent. */
  formationValid: boolean
  /** Whether a volume was reported for the formation. Null volume is not zero volume. */
  hasVolume: boolean
  /** How many earlier candles the size comparisons had. */
  comparisonSample: number
  describe: string
}

function assessData(candles: readonly Candle[], from: number, to: number, stats: RollingStats): DataQuality {
  const reasons: string[] = []
  const formation = candles.slice(from, to + 1)

  const formationValid = formation.every((one) => checkCandle(one).ok)
  if (!formationValid) reasons.push('one of the formation’s own candles is not internally consistent')

  // The sequence around the formation, which is where a missing candle would break a multi-candle shape.
  const around = candles.slice(Math.max(0, from - 2), Math.min(candles.length, to + 2))
  const sequence = checkSequence(around)
  for (const problem of sequence.problems) {
    if (problem.kind === 'gap') reasons.push('a candle is missing near this formation')
    else if (problem.kind === 'duplicate-time') reasons.push('two candles near this formation share a timestamp')
    else if (problem.kind === 'out-of-order') reasons.push('the candles near this formation are not in order')
    else if (problem.kind === 'irregular-spacing') reasons.push('the candles near this formation are not evenly spaced')
  }

  const hasVolume = formation.every((one) => one.volume !== null)
  if (!hasVolume) reasons.push('no volume was reported for part of this formation')

  if (stats.sample < 5) reasons.push(`only ${stats.sample} earlier candle${stats.sample === 1 ? '' : 's'} to compare sizes against`)
  else if (stats.sample < 10) reasons.push(`only ${stats.sample} earlier candles to compare sizes against`)

  const unique = [...new Set(reasons)]
  const level: DataQualityLevel = !formationValid
    ? 'unusable'
    : unique.some((one) => one.startsWith('a candle is missing') || one.startsWith('the candles near') || one.startsWith('two candles'))
      ? 'poor'
      : unique.length === 0
        ? 'high'
        : 'reduced'

  return {
    level,
    reasons: unique,
    formationValid,
    hasVolume,
    comparisonSample: stats.sample,
    describe:
      level === 'high'
        ? 'The candles are complete, consistent and evenly spaced, with enough history to compare sizes against.'
        : level === 'unusable'
          ? 'This formation cannot be trusted: ' + unique.join('; ') + '.'
          : `Data quality is ${level}: ${unique.join('; ')}.`
  }
}

// ---------------------------------------------------------------- evidence

export interface RuleEvidence {
  id: string
  /** The rule as the definition states it. */
  describe: string
  required: boolean
  passed: boolean
  strength: number
  /** What the candles actually were, with numbers. */
  measured: string
}

export interface PatternEvidence {
  structural: RuleEvidence[]
  context: RuleEvidence[]
  /** Required context rules that were not met. A pattern with any of these does not confirm. */
  unmetContext: string[]
  /** Optional rules that did not hold. Not failures: things the definition prefers and did not get. */
  unmetPreferences: string[]
}

// ---------------------------------------------------------------- a detection

export type DetectionStatus = 'candidate' | 'confirmed' | 'invalidated' | 'expired'

export interface PatternDetection {
  /** Deterministic and readable: the same formation always produces the same key. */
  key: string
  patternId: string
  patternName: string
  patternVersion: number
  libraryVersion: number
  mode: DetectionMode
  category: PatternCategory
  direction: PatternDirection

  /** Index of the formation's last candle in the array it was found in. Valid only for that array. */
  index: number
  /**
   * The formation's candles by time, oldest first.
   *
   * Times rather than indexes, because an index is only meaningful inside one array: after a backfill prepends two
   * hundred candles, index 40 is a different candle and a stored detection would silently point at it.
   */
  candleTimes: number[]
  /** Which of those the chart should emphasise. */
  emphasisTimes: number[]
  /** The closing time of the formation's last candle: the detection's own moment. */
  at: number

  /**
   * How comfortably the candles cleared the definition's thresholds, from 0 to 1.
   *
   * A margin, not a probability. It says nothing about what price does next and is never to be presented as if it did.
   */
  structuralMatch: number
  dataQuality: DataQuality
  /** Complete when the formation's last candle has closed. A developing formation can never be confirmed. */
  completeness: 'complete' | 'developing'
  status: DetectionStatus
  evidence: PatternEvidence
  trend: TrendReading

  /** Broader classifications this formation also satisfies, most general last. */
  alsoMatches: string[]
  describe: string
}

export interface NearMiss {
  patternId: string
  patternName: string
  index: number
  at: number
  /** The one required rule that did not hold. */
  failedRule: RuleEvidence
  describe: string
}

export interface DetectionResult {
  detections: PatternDetection[]
  /** Only populated when `includeNearMisses` is on. */
  nearMisses: NearMiss[]
  /** What was examined, so an empty result can be told apart from an empty scan. */
  examined: { from: number; to: number; candles: number; patterns: number }
  /** Reasons the scan could not examine something. Empty is not the same as silent. */
  notes: string[]
}

/**
 * The identity of a detection.
 *
 * Deterministic and composed rather than hashed, so it can be read: the same formation on the same market always
 * produces the same key, which is what stops the alert layer firing twice because a candle was refreshed. The parts a
 * caller supplies -- profile, market, timeframe -- are its own; this function fixes the order so two callers cannot
 * produce different keys for the same thing.
 */
export function detectionKey(parts: {
  scope?: string
  instrumentId: string
  interval: string
  patternId: string
  patternVersion: number
  candleTime: number
}): string {
  return [parts.scope ?? 'default', parts.instrumentId, parts.interval, parts.patternId, `v${parts.patternVersion}`, String(parts.candleTime)].join('|')
}

// ---------------------------------------------------------------- detection

const selected = (options: DetectOptions): PatternDefinition[] => {
  const only = options.only === undefined || options.only.length === 0 ? null : new Set(options.only)
  const except = new Set(options.except ?? [])
  return PATTERNS.filter((one) => (only === null || only.has(one.id)) && !except.has(one.id))
}

/**
 * Every pattern whose formation ends at `index`.
 *
 * The window each definition sees is exactly its own formation length; the candles before it are `prior`, which only
 * context rules read. Keeping those apart is what stops a three-candle rule quietly reaching back for a fourth.
 */
export function detectAt(candles: readonly Candle[], index: number, options: DetectOptions = {}): DetectionResult {
  const mode = options.mode ?? 'standard'
  const tolerance = TOLERANCES[mode] as Tolerance
  const statsWindow = options.statsWindow ?? 20
  const definitions = selected(options)
  const notes: string[] = []

  const empty: DetectionResult = {
    detections: [],
    nearMisses: [],
    examined: { from: index, to: index, candles: 0, patterns: definitions.length },
    notes
  }

  if (index < 0 || index >= candles.length) {
    notes.push('That candle is not in the range given.')
    return empty
  }

  const developing = options.lastIsDeveloping === true && index === candles.length - 1

  const detections: PatternDetection[] = []
  const nearMisses: NearMiss[] = []
  const allFacts = new Map<number, CandleFacts>()
  const factsAt = (i: number): CandleFacts => {
    const held = allFacts.get(i)
    if (held !== undefined) return held
    const made = geometryOf(candles[i] as Candle)
    allFacts.set(i, made)
    return made
  }

  for (const definition of definitions) {
    const from = index - definition.formationLength + 1
    if (from < 0) continue

    const facts: CandleFacts[] = []
    for (let i = from; i <= index; i += 1) facts.push(factsAt(i))
    const prior: CandleFacts[] = []
    for (let i = Math.max(0, from - tolerance.trendLookback); i < from; i += 1) prior.push(factsAt(i))

    const stats = rollingStats(candles, from, statsWindow)
    const window = { facts, prior, stats, tolerance }

    const structural: RuleEvidence[] = definition.rules.map((one) => {
      const result = one.test(window)
      return { id: one.id, describe: one.describe, required: one.required, passed: result.passed, strength: result.strength, measured: result.measured }
    })

    const failedRequired = structural.filter((one) => one.required && !one.passed)
    if (failedRequired.length > 0) {
      if (options.includeNearMisses === true && failedRequired.length === 1) {
        const failed = failedRequired[0] as RuleEvidence
        nearMisses.push({
          patternId: definition.id,
          patternName: definition.name,
          index,
          at: (candles[index] as Candle).time,
          failedRule: failed,
          describe: `Not a ${definition.name}: ${failed.describe} — ${failed.measured}.`
        })
      }
      continue
    }

    const context: RuleEvidence[] = definition.contextRules.map((one) => {
      const result = one.test(window)
      return { id: one.id, describe: one.describe, required: one.required, passed: result.passed, strength: result.strength, measured: result.measured }
    })

    const unmetContext = context.filter((one) => one.required && !one.passed)
    if (unmetContext.length > 0) {
      // A required context rule is part of the name. Reported as a near miss, never as a detection.
      if (options.includeNearMisses === true && unmetContext.length === 1) {
        const failed = unmetContext[0] as RuleEvidence
        nearMisses.push({
          patternId: definition.id,
          patternName: definition.name,
          index,
          at: (candles[index] as Candle).time,
          failedRule: failed,
          describe: `The shape of a ${definition.name} is there, but ${failed.measured}`
        })
      }
      continue
    }

    const requiredStrengths = structural.filter((one) => one.required).map((one) => one.strength)
    const structuralMatch =
      requiredStrengths.length === 0 ? 0 : requiredStrengths.reduce((a, b) => a + b, 0) / requiredStrengths.length

    const dataQuality = assessData(candles, from, index, stats)
    const trend = priorTrend(prior, stats, tolerance)
    const alsoMatches = ancestorsOf(definition.id)

    const last = candles[index] as Candle
    const completeness: PatternDetection['completeness'] = developing ? 'developing' : 'complete'

    detections.push({
      key: detectionKey({ instrumentId: 'unbound', interval: 'unbound', patternId: definition.id, patternVersion: definition.version, candleTime: last.time }),
      patternId: definition.id,
      patternName: definition.name,
      patternVersion: definition.version,
      libraryVersion: PATTERN_LIBRARY_VERSION,
      mode,
      category: definition.category,
      direction: definition.direction,
      index,
      candleTimes: facts.map((one) => one.time),
      emphasisTimes: definition.emphasis.filter((i) => i >= 0 && i < facts.length).map((i) => (facts[i] as CandleFacts).time),
      at: last.time,
      structuralMatch,
      dataQuality,
      completeness,
      // A developing formation is a candidate and cannot be anything else until its candle closes.
      status: completeness === 'developing' ? 'candidate' : dataQuality.level === 'unusable' ? 'candidate' : 'confirmed',
      evidence: {
        structural,
        context,
        unmetContext: [],
        unmetPreferences: context.filter((one) => !one.required && !one.passed).map((one) => `${one.describe} — ${one.measured}`)
      },
      trend,
      alsoMatches,
      describe: definition.describe
    })
  }

  return {
    detections: detections.sort((a, b) => b.structuralMatch - a.structuralMatch || a.patternId.localeCompare(b.patternId)),
    nearMisses: nearMisses.sort((a, b) => a.patternId.localeCompare(b.patternId)),
    examined: { from: index, to: index, candles: 1, patterns: definitions.length },
    notes
  }
}

/**
 * Every pattern across a range of candles.
 *
 * `from` and `to` are inclusive indexes into `candles`. The scan reports what it examined, because "no patterns" and
 * "nothing was examined" look identical in an empty list and mean opposite things.
 */
export function detect(candles: readonly Candle[], options: DetectOptions & { from?: number; to?: number } = {}): DetectionResult {
  const definitions = selected(options)
  const notes: string[] = []

  if (candles.length === 0) {
    return { detections: [], nearMisses: [], examined: { from: 0, to: -1, candles: 0, patterns: definitions.length }, notes: ['There are no candles to examine.'] }
  }

  const from = Math.max(0, options.from ?? 0)
  const to = Math.min(candles.length - 1, options.to ?? candles.length - 1)
  if (to < from) {
    return { detections: [], nearMisses: [], examined: { from, to, candles: 0, patterns: definitions.length }, notes: ['That range contains no candles.'] }
  }

  const detections: PatternDetection[] = []
  const nearMisses: NearMiss[] = []
  for (let i = from; i <= to; i += 1) {
    const result = detectAt(candles, i, options)
    detections.push(...result.detections)
    nearMisses.push(...result.nearMisses)
  }

  const sequence = checkSequence(candles.slice(from, to + 1))
  if (!sequence.ok) notes.push(sequence.describe)

  return {
    detections,
    nearMisses,
    examined: { from, to, candles: to - from + 1, patterns: definitions.length },
    notes
  }
}

/**
 * The detections worth naming, out of everything that matched.
 *
 * A single candle can legitimately be a Doji, a Long-Legged Doji and a Rickshaw Man at once. All three are true and
 * all three are kept; this picks the most specific of each family so the user is told one thing rather than three
 * things about the same candle. What it drops is listed in `alsoMatches` on what it keeps, so nothing is lost.
 */
export function mostSpecific(detections: readonly PatternDetection[]): PatternDetection[] {
  const byCandle = new Map<string, PatternDetection[]>()
  for (const one of detections) {
    const key = `${one.at}|${one.candleTimes.length}`
    byCandle.set(key, [...(byCandle.get(key) ?? []), one])
  }

  const kept: PatternDetection[] = []
  for (const group of byCandle.values()) {
    const ids = new Set(group.map((one) => one.patternId))
    // Drop anything that something else in this group is a more specific version of.
    const generalised = new Set<string>()
    for (const one of group) {
      for (const ancestor of ancestorsOf(one.patternId)) {
        if (ids.has(ancestor)) generalised.add(ancestor)
      }
    }
    kept.push(...group.filter((one) => !generalised.has(one.patternId)))
  }

  return kept.sort((a, b) => a.at - b.at || b.structuralMatch - a.structuralMatch || a.patternId.localeCompare(b.patternId))
}

// ---------------------------------------------------------------- explaining

/**
 * Why a detection happened, as sentences built from the rules that decided it.
 *
 * Generated rather than written, which is the only way it stays true: a hand-written explanation of what a Bullish
 * Engulfing is describes the pattern in general, and this describes the two candles in front of the user.
 */
export function explain(detection: PatternDetection): string[] {
  const lines: string[] = []
  lines.push(`${detection.patternName} was identified because:`)
  detection.evidence.structural
    .filter((one) => one.passed)
    .forEach((one, i) => lines.push(`${i + 1}. ${capitalise(one.describe)} — ${one.measured}.`))

  for (const one of detection.evidence.context.filter((c) => c.passed)) {
    lines.push(`Context: ${one.measured}`)
  }
  for (const one of detection.evidence.unmetPreferences) {
    lines.push(`The definition prefers, and did not get: ${one}.`)
  }

  lines.push(
    detection.completeness === 'developing'
      ? 'The last candle has not closed, so this is what the shape is so far and not what it will be.'
      : `Match strength ${(detection.structuralMatch * 100).toFixed(0)}%: how comfortably the candles cleared the thresholds in the definition. It is not a probability of any price move.`
  )
  if (detection.dataQuality.level !== 'high') lines.push(detection.dataQuality.describe)
  if (detection.alsoMatches.length > 0) {
    lines.push(`These candles also satisfy the broader definition of ${detection.alsoMatches.map((id) => patternById(id)?.name ?? id).join(', ')}.`)
  }
  return lines
}

const capitalise = (text: string): string => (text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1))

/** How a match strength should be described in words, since a bare percentage invites being read as a forecast. */
export function matchWord(structuralMatch: number): 'low' | 'moderate' | 'high' {
  return structuralMatch >= 0.6 ? 'high' : structuralMatch >= 0.3 ? 'moderate' : 'low'
}

/** The assumptions the detector rests on, shown rather than implied. */
export const DETECT_ASSUMPTIONS: readonly string[] = Object.freeze([
  'The same candles, definition version and tolerance always produce the same detections. Nothing here samples, guesses or calls a model.',
  'Match strength is how comfortably the candles cleared the definition’s thresholds. It is not a probability of a price move.',
  'A formation whose last candle has not closed is a candidate and cannot be confirmed.',
  'A formation whose candles are not internally consistent stays a candidate rather than being confirmed on bad data.',
  'A required context rule that fails means the pattern is not detected, not detected with a caveat.',
  'A detection records the times of its candles, not their positions, so it still points at the right candles after a backfill.',
  'Broader classifications a formation also satisfies are recorded on it rather than reported as separate detections.',
  'An explanation is generated from the rules that decided, so it describes these candles rather than the pattern in general.'
])
