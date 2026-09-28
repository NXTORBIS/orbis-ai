import type { QuoteView } from './instrument.ts'
import { calculate, crossedAbove, crossedBelow, level, type Candle, type IndicatorKind } from './indicators.ts'

/**
 * When to tell somebody something happened.
 *
 * All the deciding, none of the telling. An alert here is a condition and a memory of what it last saw; whether that turns
 * into a notification, a sound or a workflow is the notification centre's business and the workflow engine's.
 *
 * The hard part of alerts is not the comparison -- it is not firing forty times. Three separate mechanisms:
 *
 *  - **A crossing needs both sides.** "Above 200" fires when it goes from below to above, not on every tick it spends
 *    above. That needs the previous value, which is why an alert carries one.
 *  - **A cooldown.** Even a real crossing can happen repeatedly when a price sits on a level.
 *  - **A daily cap.** For the alert that would otherwise be right about something all day.
 *
 * Without all three, an alert on a price hovering at its threshold is a stream of notifications, and the person turns
 * alerts off -- which is the worst outcome, because then the one that mattered never arrives either.
 */

export type Comparison =
  | 'above'
  | 'below'
  | 'at-or-above'
  | 'at-or-below'
  | 'equals'
  | 'crosses-above'
  | 'crosses-below'
  | 'enters-range'
  | 'leaves-range'
  /** Moved by at least this much either way, over the alert's window. */
  | 'changes-by'

export const COMPARISONS: Comparison[] = [
  'above',
  'below',
  'at-or-above',
  'at-or-below',
  'equals',
  'crosses-above',
  'crosses-below',
  'enters-range',
  'leaves-range',
  'changes-by'
]

/** What the condition is about. */
export type AlertSubject =
  | { kind: 'price' }
  | { kind: 'change-percent' }
  | { kind: 'volume' }
  /** An indicator on the instrument's candles, at a given interval. */
  | { kind: 'indicator'; indicator: IndicatorKind; series?: string; options?: Record<string, number>; interval: string }
  /**
   * The gap between the best bid and ask, as a fraction of the mid.
   *
   * A fraction rather than an absolute, so one threshold means the same thing on a market at 84,000 and one at 0.4.
   */
  | { kind: 'spread' }
  /** The funding rate, as a fraction. Only ever measurable for a contract whose venue publishes one. */
  | { kind: 'funding' }
  /** Open interest, in contracts. */
  | { kind: 'open-interest' }
  /** How much open interest changed over a window, as a fraction. */
  | { kind: 'open-interest-change'; windowMs: number }
  /** Liquidation value over a window, in the quote currency. */
  | { kind: 'liquidations'; windowMs: number; side?: 'long' | 'short' | 'both' }
  /**
   * Whether the market is reachable at all.
   *
   * Measured as 1 for available and 0 for not, so it goes through the same comparisons as everything else. A condition
   * about the feed rather than about the market, which is why it is a subject of its own.
   */
  | { kind: 'availability' }

/** How often it may fire. */
export type AlertRepeat = 'once' | 'every-time' | 'daily'

export interface Alert {
  id: string
  instrumentId: string
  /** What a person called it. Empty means the interface describes it from the condition. */
  label: string
  subject: AlertSubject
  comparison: Comparison
  /** The threshold, or the low end of a range. */
  value: number
  /** The high end, for the range comparisons. */
  value2?: number
  /**
   * The value the condition has to come back through before it may fire again.
   *
   * For a threshold that a price sits on top of: without it, "above 100" on a price oscillating between 99.99 and 100.01
   * fires every cooldown for ever. With a reset of 99.5, it fires once and stays quiet until the price genuinely goes
   * back. Undefined means no hysteresis, which is what every existing alert has.
   */
  reset?: number
  /**
   * Whether the condition is currently considered armed.
   *
   * Only meaningful with `reset`. False after firing, true again once the value has passed back through the reset --
   * kept with the alert, so a restart does not re-arm something that is still sitting on its threshold.
   */
  armed?: boolean
  /**
   * Further conditions on the same market, and how they combine.
   *
   * Empty for an ordinary alert. When present, this alert's own condition is the first term and these are the rest.
   */
  extra?: AlertTerm[]
  /** Whether every term must hold, or any one of them. */
  match?: 'all' | 'any'
  repeat: AlertRepeat
  /** How long after firing before it may fire again. */
  cooldownMs: number
  /** The most it may fire in a day, whatever else says. 0 for no cap. */
  dailyLimit: number
  enabled: boolean
  createdAt: number

  // ---- what it has seen. Kept with the alert so a crossing survives a restart.
  /** The last value the condition was measured against, for detecting a crossing. */
  lastValue?: number | null
  lastFiredAt?: number
  /** How many times today, and which day that was, so the cap resets. */
  firedToday?: number
  firedDay?: string
}

/**
 * One further condition in a multi-condition alert.
 *
 * Deliberately the same shape as the alert's own condition rather than a general expression tree: every term is a
 * comparison of one measurable thing against a value, which is what the engine can actually evaluate. A tree with
 * arbitrary nesting would let somebody build a condition nothing could measure.
 *
 * Nesting is one level: a group of terms combined with `all` or `any`. That covers "(A and B) or (C and D)" as two
 * alerts, which is how anybody would write it anyway, and it keeps every alert something the interface can describe in a
 * sentence.
 */
export interface AlertTerm {
  subject: AlertSubject
  comparison: Comparison
  value: number
  value2?: number
  /** What this term last saw, so a crossing term works the same way the alert's own does. */
  lastValue?: number | null
}

/** Why an alert did or did not fire, so the interface can say. */
export interface AlertOutcome {
  fired: boolean
  /** The value that was compared. Null when it could not be worked out. */
  value: number | null
  reason: string
  /** The alert with its memory brought up to date. Always use this one afterwards. */
  next: Alert
}

const dayOf = (at: number): string => new Date(at).toISOString().slice(0, 10)

/**
 * What the condition is measuring, from what is available.
 *
 * Null when it cannot be worked out -- a volume condition on a feed with no volume, an indicator that needs more candles
 * than exist. Null never fires. An alert that fired because a number was missing would be worse than one that never fired
 * at all.
 */
/**
 * What the derivatives and book subjects need, supplied by the caller.
 *
 * Passed in rather than fetched here, because this module is pure and the engine is what holds these. Every field is
 * optional and every absent field measures as null -- which never fires.
 */
export interface AlertContext {
  /** The spread as a fraction of the mid. */
  spreadFraction?: number | null
  fundingRate?: number | null
  openInterest?: number | null
  /** The change over the window the condition asked for, as a fraction. */
  openInterestChange?: (windowMs: number) => number | null
  /** Liquidation value over the window, by side. */
  liquidations?: (windowMs: number, side: 'long' | 'short' | 'both') => number | null
  /** True when the market is reachable and its data is not stale. */
  available?: boolean
}

export function measure(
  alert: Alert,
  quote: QuoteView | null,
  candles: Candle[] = [],
  context: AlertContext = {}
): { value: number | null; series?: (number | null)[] } {
  return measureSubject(alert.subject, quote, candles, context)
}

/** One subject's current value. Shared by the alert's own condition and by every extra term. */
export function measureSubject(
  subject: AlertSubject,
  quote: QuoteView | null,
  candles: Candle[] = [],
  context: AlertContext = {}
): { value: number | null; series?: (number | null)[] } {
  const alert = { subject } as Alert
  switch (subject.kind) {
    case 'price':
      return { value: quote?.last ?? null }
    case 'change-percent':
      return { value: quote?.changePercent ?? null }
    case 'volume':
      return { value: quote?.volume ?? null }
    case 'indicator': {
      if (candles.length === 0) return { value: null }
      const result = calculate(subject.indicator, candles, subject.options ?? {})
      const name = subject.series ?? Object.keys(result)[0]
      const series = result[name]
      if (!series) return { value: null }
      const last = series[series.length - 1]
      return { value: last ?? null, series }
    }
    // Every one of these is null when the caller did not supply it, which is what a venue that does not publish it
    // produces. Null never fires, so an alert on funding for a spot market simply never goes off.
    case 'spread':
      return { value: context.spreadFraction ?? null }
    case 'funding':
      return { value: context.fundingRate ?? null }
    case 'open-interest':
      return { value: context.openInterest ?? null }
    case 'open-interest-change':
      return { value: context.openInterestChange?.(subject.windowMs) ?? null }
    case 'liquidations':
      return { value: context.liquidations?.(subject.windowMs, subject.side ?? 'both') ?? null }
    case 'availability':
      // 1 and 0 rather than a boolean, so this goes through the same comparisons as everything else.
      return { value: context.available === undefined ? null : context.available ? 1 : 0 }
  }
  void alert
}

/** Whether the condition holds, given the value now and the value before. */
function holds(alert: Alert, value: number, previous: number | null): boolean {
  const { comparison, value: threshold } = alert
  const high = alert.value2 ?? threshold
  switch (comparison) {
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
      // Needs where it was. A first reading has crossed nothing, which is why this is false rather than true when a price
      // is already above the level -- otherwise every alert fires the moment it is created.
      return previous !== null && previous <= threshold && value > threshold
    case 'crosses-below':
      return previous !== null && previous >= threshold && value < threshold
    case 'enters-range':
      return previous !== null && !inRange(previous, threshold, high) && inRange(value, threshold, high)
    case 'leaves-range':
      return previous !== null && inRange(previous, threshold, high) && !inRange(value, threshold, high)
    case 'changes-by':
      // Either direction. "Tell me when it moves 5%" means 5% up or 5% down.
      return Math.abs(value) >= Math.abs(threshold)
  }
}

const inRange = (value: number, low: number, high: number): boolean =>
  value >= Math.min(low, high) && value <= Math.max(low, high)

/**
 * Whether an alert fires now.
 *
 * Always returns the updated alert in `next`, whether it fired or not -- because the memory of what it last saw has to
 * advance either way. An implementation that only saved the alert when it fired would never detect a crossing: the value it
 * compared against would be stuck at whatever it was when it last fired.
 */
export function consider(alert: Alert, value: number | null, at: number, others: boolean[] = []): AlertOutcome {
  const previous = alert.lastValue ?? null
  // The memory advances first and unconditionally. Everything below only decides whether to say so.
  const seen: Alert = { ...alert, lastValue: value }

  if (!alert.enabled) return { fired: false, value, reason: 'It is switched off.', next: seen }
  if (value === null || !Number.isFinite(value)) {
    return { fired: false, value: null, reason: 'There is no value to compare.', next: { ...seen, lastValue: previous } }
  }

  const today = dayOf(at)
  const firedToday = alert.firedDay === today ? (alert.firedToday ?? 0) : 0
  const mine = holds(seen, value, previous)

  /*
   * Hysteresis, before anything else looks at the condition.
   *
   * An alert with a reset is disarmed by firing and re-armed only when the value comes back through the reset. Without
   * it, "above 100" on a price oscillating around 100 fires every cooldown for ever -- which is the same alert firing
   * about the same event, dozens of times.
   */
  let armed = alert.armed !== false
  if (alert.reset !== undefined && Number.isFinite(alert.reset)) {
    // Which way "back through" is depends on which way the condition points, taken from whether the reset sits below or
    // above the threshold rather than from the comparison -- so it works for a range as well as a level.
    const below = alert.reset < alert.value
    if (!armed && (below ? value <= alert.reset : value >= alert.reset)) armed = true
    if (!armed) {
      return {
        fired: false,
        value,
        reason: `It has not come back through ${alert.reset} since it last fired.`,
        next: { ...seen, armed: false }
      }
    }
  }

  // Every other term, evaluated by the caller and handed in. `all` needs them all; `any` needs one of them or this one.
  const combined =
    others.length === 0
      ? mine
      : (alert.match ?? 'all') === 'any'
        ? mine || others.some(Boolean)
        : mine && others.every(Boolean)

  if (!combined) {
    return { fired: false, value, reason: 'The condition is not met.', next: { ...seen, armed } }
  }
  if (alert.repeat === 'once' && alert.lastFiredAt !== undefined) {
    return { fired: false, value, reason: 'It has already fired, and it only fires once.', next: { ...seen, armed } }
  }
  if (alert.repeat === 'daily' && firedToday > 0) {
    return { fired: false, value, reason: 'It has already fired today.', next: { ...seen, firedToday, firedDay: today } }
  }
  if (alert.dailyLimit > 0 && firedToday >= alert.dailyLimit) {
    return {
      fired: false,
      value,
      reason: `It has already fired ${firedToday} times today, which is its limit.`,
      next: { ...seen, firedToday, firedDay: today }
    }
  }
  if (alert.lastFiredAt !== undefined && at - alert.lastFiredAt < alert.cooldownMs) {
    const left = Math.ceil((alert.cooldownMs - (at - alert.lastFiredAt)) / 1000)
    return { fired: false, value, reason: `It fired recently; ${left}s to wait.`, next: { ...seen, armed } }
  }

  return {
    fired: true,
    value,
    reason: 'The condition is met.',
    next: {
      ...seen,
      lastFiredAt: at,
      firedToday: firedToday + 1,
      firedDay: today,
      // Disarmed by firing, where there is a reset to re-arm it. Without one this stays true and changes nothing.
      armed: alert.reset === undefined ? undefined : false
    }
  }
}

/**
 * Whether one extra term holds, and the term with its memory advanced.
 *
 * The same comparison logic as the alert's own condition, so a crossing term behaves the way a crossing condition does
 * rather than being a near-miss written twice.
 */
export function considerTerm(
  term: AlertTerm,
  quote: QuoteView | null,
  candles: Candle[],
  context: AlertContext
): { holds: boolean; next: AlertTerm; value: number | null } {
  const { value } = measureSubject(term.subject, quote, candles, context)
  const previous = term.lastValue ?? null
  if (value === null || !Number.isFinite(value)) {
    // A term that cannot be measured does not hold, and does not advance its memory either -- so a gap in the data
    // cannot manufacture a crossing when the data comes back.
    return { holds: false, next: term, value: null }
  }
  const asAlert = {
    comparison: term.comparison,
    value: term.value,
    value2: term.value2
  } as Alert
  return { holds: holds(asAlert, value, previous), next: { ...term, lastValue: value }, value }
}

/**
 * An indicator alert, judged on the series rather than only its last value.
 *
 * A crossing of an indicator is a crossing of two lines, which is a different question from "is the last value above the
 * level" -- and the answer differs exactly when it matters. Handled separately because the series is needed, and a caller
 * with only a quote has no series to give.
 */
export function considerSeries(alert: Alert, series: (number | null)[], at: number): AlertOutcome {
  const last = series.length ? series[series.length - 1] : null
  if (alert.comparison !== 'crosses-above' && alert.comparison !== 'crosses-below') {
    return consider(alert, last ?? null, at)
  }
  const threshold = level(alert.value, series.length)
  const i = series.length - 1
  const crossed =
    alert.comparison === 'crosses-above' ? crossedAbove(series, threshold, i) : crossedBelow(series, threshold, i)
  const seen: Alert = { ...alert, lastValue: last ?? null }
  if (!alert.enabled) return { fired: false, value: last ?? null, reason: 'It is switched off.', next: seen }
  if (!crossed) {
    return { fired: false, value: last ?? null, reason: 'The condition is not met.', next: seen }
  }
  // The crossing is established; the rest of the guards -- once, daily, cooldown -- are the same as any other alert, so
  // they are asked with a comparison that is already true.
  return consider({ ...alert, comparison: 'at-or-above', value: Number.NEGATIVE_INFINITY }, last ?? null, at)
}

/** One subject in words. Shared by the alert's description and by every extra term's. */
export function describeSubject(subject: AlertSubject): string {
  switch (subject.kind) {
    case 'price':
      return 'price'
    case 'change-percent':
      return 'change'
    case 'volume':
      return 'volume'
    case 'spread':
      return 'spread'
    case 'funding':
      return 'funding rate'
    case 'open-interest':
      return 'open interest'
    case 'open-interest-change':
      return `open interest change over ${minutesOf(subject.windowMs)}`
    case 'liquidations':
      return `${subject.side === 'long' ? 'long ' : subject.side === 'short' ? 'short ' : ''}liquidations over ${minutesOf(subject.windowMs)}`
    case 'availability':
      return 'availability'
    case 'indicator':
      return `${subject.indicator.toUpperCase()}${subject.interval ? ` (${subject.interval})` : ''}`
  }
}

const minutesOf = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return 'an unset window'
  if (ms >= 24 * 3_600_000) return `${Math.round(ms / (24 * 3_600_000))}d`
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`
  return `${Math.round(ms / 60_000)}m`
}

/**
 * A threshold in the units its subject is measured in.
 *
 * The one that matters is funding: it is held as a fraction and read as a percentage, and showing 0.0001 where somebody
 * typed 0.01% would make every funding alert look wrong.
 */
export function formatSubjectValue(subject: AlertSubject, value: number): string {
  switch (subject.kind) {
    case 'change-percent':
      return `${value}%`
    case 'funding':
    case 'spread':
    case 'open-interest-change':
      return `${(value * 100).toFixed(4)}%`
    case 'availability':
      return value >= 1 ? 'available' : 'unavailable'
    default:
      return String(value)
  }
}

/** An alert as a sentence, so the interface never has to build one out of its fields. */
export function describeAlert(alert: Alert, symbol: string): string {
  const subject = describeSubject(alert.subject)
  const number = (n: number): string => formatSubjectValue(alert.subject, n)
  switch (alert.comparison) {
    case 'above':
      return `${symbol} ${subject} above ${number(alert.value)}`
    case 'below':
      return `${symbol} ${subject} below ${number(alert.value)}`
    case 'at-or-above':
      return `${symbol} ${subject} at or above ${number(alert.value)}`
    case 'at-or-below':
      return `${symbol} ${subject} at or below ${number(alert.value)}`
    case 'equals':
      return `${symbol} ${subject} exactly ${number(alert.value)}`
    case 'crosses-above':
      return `${symbol} ${subject} crosses above ${number(alert.value)}`
    case 'crosses-below':
      return `${symbol} ${subject} crosses below ${number(alert.value)}`
    case 'enters-range':
      return `${symbol} ${subject} enters ${number(alert.value)}–${number(alert.value2 ?? alert.value)}`
    case 'leaves-range':
      return `${symbol} ${subject} leaves ${number(alert.value)}–${number(alert.value2 ?? alert.value)}`
    case 'changes-by':
      return `${symbol} ${subject} moves ${number(Math.abs(alert.value))} either way`
  }
}

/**
 * One time an alert fired.
 *
 * Kept so a person can see what happened while they were not looking. It holds the observed value and the condition that
 * was met -- not a snapshot of the market, which would be a large thing to store for a line of history and would go stale
 * the moment it was written.
 */
export interface AlertFiring {
  id: string
  alertId: string
  instrumentId: string
  symbol: string
  /** What the alert was called, or the description built from its condition. */
  label: string
  /** The value that met the condition, at the moment it did. */
  value: number
  at: number
}

/** The delays the interface offers for a cooldown. */
export const COOLDOWN_CHOICES = [0, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 24 * 60 * 60_000]

const MAX_ALERTS = 500

/** An alert read from a file or an import, made safe. Null when it is not one at all. */
export function cleanAlert(raw: unknown, at = Date.now()): Alert | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.slice(0, 80) : ''
  const instrumentId = typeof o.instrumentId === 'string' ? o.instrumentId.slice(0, 200) : ''
  const comparison = COMPARISONS.includes(o.comparison as Comparison) ? (o.comparison as Comparison) : null
  const value = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null
  if (!id || !instrumentId || !comparison || value === null) return null

  const subject = cleanSubject(o.subject)
  const repeat: AlertRepeat =
    o.repeat === 'once' || o.repeat === 'every-time' || o.repeat === 'daily' ? o.repeat : 'every-time'
  return {
    id,
    instrumentId,
    label: typeof o.label === 'string' ? o.label.slice(0, 80) : '',
    subject,
    comparison,
    value,
    value2: typeof o.value2 === 'number' && Number.isFinite(o.value2) ? o.value2 : undefined,
    repeat,
    cooldownMs:
      typeof o.cooldownMs === 'number' && Number.isFinite(o.cooldownMs)
        ? Math.min(24 * 60 * 60_000, Math.max(0, Math.round(o.cooldownMs)))
        : 5 * 60_000,
    dailyLimit:
      typeof o.dailyLimit === 'number' && Number.isFinite(o.dailyLimit) ? Math.min(500, Math.max(0, Math.round(o.dailyLimit))) : 0,
    enabled: o.enabled !== false,
    createdAt: typeof o.createdAt === 'number' && o.createdAt > 0 ? o.createdAt : at,
    lastValue: typeof o.lastValue === 'number' && Number.isFinite(o.lastValue) ? o.lastValue : null,
    lastFiredAt: typeof o.lastFiredAt === 'number' && o.lastFiredAt > 0 ? o.lastFiredAt : undefined,
    firedToday: typeof o.firedToday === 'number' && o.firedToday >= 0 ? Math.round(o.firedToday) : 0,
    firedDay: typeof o.firedDay === 'string' ? o.firedDay.slice(0, 10) : undefined,
    reset: typeof o.reset === 'number' && Number.isFinite(o.reset) ? o.reset : undefined,
    // Armed unless a file says otherwise, and only meaningful with a reset: an alert read back without one has nothing
    // to be disarmed by.
    armed: typeof o.reset === 'number' && Number.isFinite(o.reset) ? o.armed !== false : undefined,
    extra: cleanTerms(o.extra),
    match: o.match === 'any' ? 'any' : 'all'
  }
}

/** How many extra conditions one alert may carry. Enough for a real condition, few enough to stay describable. */
const MAX_TERMS = 6

/**
 * Extra conditions read from a file.
 *
 * Each goes through the same subject cleaner as the alert's own, so a term cannot smuggle in something the engine has no
 * way to measure. A malformed term is dropped rather than making the whole alert unreadable -- but an alert whose extra
 * terms were all dropped becomes an ordinary single-condition alert, which is stricter than it sounds: it fires on
 * *fewer* things, never more.
 */
function cleanTerms(raw: unknown): AlertTerm[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: AlertTerm[] = []
  for (const one of raw) {
    if (!one || typeof one !== 'object') continue
    const o = one as Record<string, unknown>
    const comparison = COMPARISONS.includes(o.comparison as Comparison) ? (o.comparison as Comparison) : null
    const value = typeof o.value === 'number' && Number.isFinite(o.value) ? o.value : null
    if (!comparison || value === null) continue
    out.push({
      subject: cleanSubject(o.subject),
      comparison,
      value,
      value2: typeof o.value2 === 'number' && Number.isFinite(o.value2) ? o.value2 : undefined,
      lastValue: typeof o.lastValue === 'number' && Number.isFinite(o.lastValue) ? o.lastValue : null
    })
    if (out.length >= MAX_TERMS) break
  }
  return out.length > 0 ? out : undefined
}

/** A window from a file. Clamped between a minute and a week: outside that it is not a window anybody meant. */
const window_ = (raw: unknown): number => {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
  if (value < 60_000) return 60_000
  if (value > 7 * 24 * 3_600_000) return 7 * 24 * 3_600_000
  return Math.round(value)
}

function cleanSubject(raw: unknown): AlertSubject {
  if (!raw || typeof raw !== 'object') return { kind: 'price' }
  const o = raw as Record<string, unknown>
  if (o.kind === 'change-percent' || o.kind === 'volume') return { kind: o.kind }
  if (o.kind === 'spread' || o.kind === 'funding' || o.kind === 'open-interest' || o.kind === 'availability') {
    return { kind: o.kind }
  }
  if (o.kind === 'open-interest-change') {
    return { kind: 'open-interest-change', windowMs: window_(o.windowMs) }
  }
  if (o.kind === 'liquidations') {
    return {
      kind: 'liquidations',
      windowMs: window_(o.windowMs),
      side: o.side === 'long' || o.side === 'short' ? o.side : 'both'
    }
  }
  if (o.kind === 'indicator' && typeof o.indicator === 'string') {
    return {
      kind: 'indicator',
      indicator: o.indicator as IndicatorKind,
      series: typeof o.series === 'string' ? o.series : undefined,
      options:
        o.options && typeof o.options === 'object'
          ? Object.fromEntries(
              Object.entries(o.options as Record<string, unknown>)
                .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
                .map(([k, v]) => [k, v as number])
            )
          : undefined,
      interval: typeof o.interval === 'string' ? o.interval : '1h'
    }
  }
  return { kind: 'price' }
}

export function cleanAlerts(raw: unknown, at = Date.now()): Alert[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: Alert[] = []
  for (const one of raw) {
    const alert = cleanAlert(one, at)
    if (!alert || seen.has(alert.id)) continue
    seen.add(alert.id)
    out.push(alert)
    if (out.length >= MAX_ALERTS) break
  }
  return out
}
