import { COMPARISONS, type Comparison, type AlertSubject } from './alerts.ts'
import { cleanQuery, type ScreenerQuery } from './screener.ts'

/**
 * What can start a market workflow.
 *
 * A trigger is a condition plus a promise about how often it may fire. The promise is the part that matters: a workflow
 * is not a notification. A notification arriving twice is an annoyance; a workflow running twice can write two journal
 * entries, place two simulated orders and send two reports — so every trigger here is once-per-event by construction,
 * and the state that makes that true is stored with it.
 *
 * Nothing here runs anything. It decides whether a condition has newly become true, and the workflow engine does the
 * rest — which is what keeps this testable and keeps market logic out of the engine.
 */

export type TriggerKind =
  /** A market condition, evaluated exactly the way an alert's is. */
  | 'market'
  /** An alert firing, so an existing alert can start a workflow without being restated. */
  | 'alert'
  /** A screen returning anything, or returning more than a given number of markets. */
  | 'screen'
  /** A provider's connection changing, for a workflow that reacts to the feed rather than the market. */
  | 'connection'

export interface MarketTrigger {
  id: string
  /**
   * The workflow this starts.
   *
   * Required. A trigger with nothing to start is a control that can never do anything, so one is refused on the way in
   * rather than stored and quietly ignored.
   */
  workflowId: string
  kind: TriggerKind
  /** Which market, for the kinds that are about one. Empty for a screen or a connection. */
  instrumentId: string
  /** What is measured, for `market`. */
  subject?: AlertSubject
  comparison?: Comparison
  value?: number
  value2?: number
  /** Which alert, for `alert`. */
  alertId?: string
  /** The screen to run, for `screen`. */
  query?: ScreenerQuery
  /** How many results the screen must return before this fires. */
  minimumResults?: number
  /** The connection state to react to, for `connection`. */
  connection?: 'connected' | 'disconnected' | 'reconnecting'
  enabled: boolean
  /**
   * The least time between two firings.
   *
   * Separate from an alert's cooldown, and usually longer: a workflow does work, and a workflow doing its work every
   * thirty seconds is a workflow nobody wanted.
   */
  cooldownMs: number
  /** How many times it may run in a day, whatever else says. 0 for no cap. */
  dailyLimit: number
  createdAt: number

  // ---- what it has seen, so a restart does not re-fire everything.
  lastValue?: number | null
  lastFiredAt?: number
  firedToday?: number
  firedDay?: string
  /** Whether the condition was true last time it was looked at. A trigger fires on the edge, not on the state. */
  wasTrue?: boolean
}

/** What a trigger was given to judge itself against. */
export interface TriggerInput {
  /** The measured value, for a `market` trigger. Null when it could not be worked out. */
  value?: number | null
  /** True when the alert this trigger watches has just fired. */
  alertFired?: boolean
  /** How many markets the screen returned. */
  results?: number
  /** The connection now. */
  connection?: string
}

export interface TriggerOutcome {
  fired: boolean
  reason: string
  /** The trigger with its memory advanced. Always use this one afterwards. */
  next: MarketTrigger
}

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)

/** Whether the underlying condition is true right now, before any of the rate limits are considered. */
function isTrue(trigger: MarketTrigger, input: TriggerInput): boolean | null {
  switch (trigger.kind) {
    case 'market': {
      const value = input.value
      // Unknown is not false. A market that cannot be measured leaves the trigger exactly as it was, so the data coming
      // back does not read as a fresh crossing.
      if (value === null || value === undefined || !Number.isFinite(value)) return null
      const threshold = trigger.value ?? 0
      const high = trigger.value2 ?? threshold
      switch (trigger.comparison) {
        case 'above':
          return value > threshold
        case 'below':
          return value < threshold
        case 'at-or-above':
          return value >= threshold
        case 'at-or-below':
          return value <= threshold
        case 'equals':
          return value === threshold
        case 'crosses-above':
          return value > threshold
        case 'crosses-below':
          return value < threshold
        case 'enters-range':
          return value >= Math.min(threshold, high) && value <= Math.max(threshold, high)
        case 'leaves-range':
          return value < Math.min(threshold, high) || value > Math.max(threshold, high)
        case 'changes-by':
          return Math.abs(value) >= Math.abs(threshold)
        default:
          return null
      }
    }
    case 'alert':
      return input.alertFired === true
    case 'screen':
      return input.results !== undefined && input.results >= Math.max(1, trigger.minimumResults ?? 1)
    case 'connection':
      return input.connection !== undefined && input.connection === trigger.connection
  }
}

/**
 * Whether a trigger runs now.
 *
 * **It fires on the edge, never on the state.** A condition that is true and stays true fires once: the difference
 * between "the price went above 100" and "the price is above 100" is the difference between a workflow running once and
 * a workflow running every time anybody looks. The memory that makes that work is returned in `next` whether it fired or
 * not, because an edge cannot be detected without knowing where things were.
 */
export function considerTrigger(trigger: MarketTrigger, input: TriggerInput, at: number): TriggerOutcome {
  const truth = isTrue(trigger, input)

  if (truth === null) {
    // Nothing measurable. The memory is deliberately not advanced: this moment tells us nothing about the edge.
    return { fired: false, reason: 'There is nothing to measure.', next: trigger }
  }

  const seen: MarketTrigger = {
    ...trigger,
    wasTrue: truth,
    lastValue: input.value === undefined ? trigger.lastValue : input.value
  }

  if (!trigger.enabled) return { fired: false, reason: 'It is switched off.', next: seen }
  if (!truth) return { fired: false, reason: 'The condition is not met.', next: seen }
  // Already true last time. An event, not a state.
  if (trigger.wasTrue === true) {
    return { fired: false, reason: 'The condition was already true, so nothing new happened.', next: seen }
  }

  const today = dayOf(at)
  const firedToday = trigger.firedDay === today ? (trigger.firedToday ?? 0) : 0
  if (trigger.dailyLimit > 0 && firedToday >= trigger.dailyLimit) {
    return {
      fired: false,
      reason: `It has already run ${firedToday} times today, which is its limit.`,
      next: { ...seen, firedToday, firedDay: today }
    }
  }
  if (trigger.lastFiredAt !== undefined && at - trigger.lastFiredAt < trigger.cooldownMs) {
    const left = Math.ceil((trigger.cooldownMs - (at - trigger.lastFiredAt)) / 1000)
    return { fired: false, reason: `It ran recently; ${left}s to wait.`, next: seen }
  }

  return {
    fired: true,
    reason: 'The condition has just become true.',
    next: { ...seen, lastFiredAt: at, firedToday: firedToday + 1, firedDay: today }
  }
}

const KINDS: TriggerKind[] = ['market', 'alert', 'screen', 'connection']

/** The shortest gap a workflow trigger may have. A workflow is work, and work every few seconds is a runaway. */
export const MIN_TRIGGER_COOLDOWN = 60_000

/** A trigger read from a file or an import. Null when it could never fire, because a dead trigger is a dead control. */
export function cleanTrigger(raw: unknown, at = Date.now()): MarketTrigger | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.slice(0, 80) : ''
  const kind = KINDS.includes(o.kind as TriggerKind) ? (o.kind as TriggerKind) : null
  if (!id || !kind) return null

  const workflowId = typeof o.workflowId === 'string' ? o.workflowId.slice(0, 80) : ''
  // Nothing to start means nothing to do. Refused, because a stored trigger that cannot run anything is a dead control.
  if (!workflowId) return null
  const instrumentId = typeof o.instrumentId === 'string' ? o.instrumentId.slice(0, 200) : ''
  const comparison = COMPARISONS.includes(o.comparison as Comparison) ? (o.comparison as Comparison) : undefined
  const value = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : undefined

  // Each kind needs its own parts. Without them the trigger can never fire, which is worse than not having it.
  if (kind === 'market' && (!instrumentId || !comparison || value === undefined)) return null
  if (kind === 'alert' && typeof o.alertId !== 'string') return null
  if (kind === 'connection' && o.connection !== 'connected' && o.connection !== 'disconnected' && o.connection !== 'reconnecting') {
    return null
  }

  return {
    id,
    workflowId,
    kind,
    instrumentId,
    subject: kind === 'market' ? cleanTriggerSubject(o.subject) : undefined,
    comparison,
    value,
    value2: typeof o.value2 === 'number' && Number.isFinite(o.value2) ? o.value2 : undefined,
    alertId: typeof o.alertId === 'string' ? o.alertId.slice(0, 80) : undefined,
    query: kind === 'screen' ? cleanQuery(o.query) : undefined,
    minimumResults:
      typeof o.minimumResults === 'number' && Number.isFinite(o.minimumResults)
        ? Math.max(1, Math.round(o.minimumResults))
        : undefined,
    connection: o.connection as MarketTrigger['connection'],
    enabled: o.enabled !== false,
    // Floored, not merely defaulted: a file asking for a five-second cooldown is asking for a runaway.
    cooldownMs:
      typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs)
        ? Math.min(24 * 3_600_000, Math.max(MIN_TRIGGER_COOLDOWN, Math.round(o.cooldownMs)))
        : 15 * 60_000,
    dailyLimit:
      typeof o.dailyLimit === 'number' && Number.isFinite(o.dailyLimit) ? Math.min(200, Math.max(0, Math.round(o.dailyLimit))) : 24,
    createdAt: typeof o.createdAt === 'number' && o.createdAt > 0 ? o.createdAt : at,
    lastValue: typeof o.lastValue === 'number' && Number.isFinite(o.lastValue) ? o.lastValue : null,
    lastFiredAt: typeof o.lastFiredAt === 'number' && o.lastFiredAt > 0 ? o.lastFiredAt : undefined,
    firedToday: typeof o.firedToday === 'number' && o.firedToday >= 0 ? Math.round(o.firedToday) : 0,
    firedDay: typeof o.firedDay === 'string' ? o.firedDay.slice(0, 10) : undefined,
    // Deliberately false after a restart, not true.
    //
    // False means the first evaluation can fire if the condition is genuinely true — which is what somebody expects
    // after reopening Orbis to find the market has moved. True would mean the workflow never runs again until the
    // condition goes false and comes back.
    wasTrue: o.wasTrue === true
  }
}

/** A trigger's subject, restricted to the ones a trigger can be given a value for. */
function cleanTriggerSubject(raw: unknown): AlertSubject {
  if (!raw || typeof raw !== 'object') return { kind: 'price' }
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (kind === 'change-percent' || kind === 'volume' || kind === 'spread' || kind === 'funding') return { kind }
  if (kind === 'open-interest' || kind === 'availability') return { kind }
  return { kind: 'price' }
}

/** A trigger in words, so a workflow's list never has to build one out of its fields. */
/** What each subject and comparison is called in a sentence, so a description reads rather than being decoded. */
const SUBJECT_WORDS: Record<string, string> = {
  price: 'price',
  'change-percent': '24h change',
  volume: '24h volume',
  spread: 'spread',
  funding: 'funding rate',
  'open-interest': 'open interest',
  availability: 'availability'
}

const COMPARISON_WORDS: Record<string, string> = {
  above: 'goes above',
  below: 'goes below',
  'at-or-above': 'reaches',
  'at-or-below': 'falls to',
  equals: 'equals',
  'crosses-above': 'crosses above',
  'crosses-below': 'crosses below',
  'enters-range': 'enters the range around',
  'leaves-range': 'leaves the range around',
  'changes-by': 'moves by'
}

export function describeTrigger(trigger: MarketTrigger, symbol = ''): string {
  const where = symbol || trigger.instrumentId.split(':').pop() || 'this market'
  switch (trigger.kind) {
    case 'market': {
      // `hasOwnProperty`, not indexing: a subject of `constructor` would otherwise find a function on the prototype.
      const subject = trigger.subject?.kind ?? 'price'
      const word = Object.prototype.hasOwnProperty.call(SUBJECT_WORDS, subject) ? SUBJECT_WORDS[subject] : subject
      const comparison = trigger.comparison ?? 'above'
      const how = Object.prototype.hasOwnProperty.call(COMPARISON_WORDS, comparison)
        ? COMPARISON_WORDS[comparison]
        : comparison
      return `When ${where} ${word} ${how} ${trigger.value ?? 0}`
    }
    case 'alert':
      return 'When a chosen alert fires'
    case 'screen':
      return `When a saved screen returns ${trigger.minimumResults ?? 1} or more markets`
    case 'connection':
      return `When the market feed becomes ${trigger.connection}`
  }
}
