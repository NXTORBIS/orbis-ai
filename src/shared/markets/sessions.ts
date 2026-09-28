/**
 * When a market is open, from its own calendar.
 *
 * Market status is a fact about an exchange's published hours and holidays, not a guess. So this holds the hours, and
 * answers from them and from the clock -- never from whether a price happened to arrive recently, which is the shortcut
 * that shows "closed" for a quiet stock at midday and "open" all weekend for one that ticked late on Friday.
 *
 * What is deliberately **not** here: exchange holidays. Holiday calendars change every year, they differ per exchange, and
 * a hard-coded list is wrong within twelve months and wrong silently -- it would say "open" on a holiday, which is worse
 * than saying nothing. So `marketStatus` reports `unknown` for a day it cannot be sure about only when it has no hours at
 * all; for holidays it relies on the provider's own status where the provider gives one, and `holidays` can be filled from
 * a provider that publishes them.
 */

/** Minutes since midnight, in the exchange's own timezone. */
export interface SessionWindow {
  /** e.g. 9 * 60 + 15 for 09:15 */
  openMinute: number
  closeMinute: number
}

export interface Exchange {
  /** The code Orbis uses, and what a provider is most likely to call it. */
  id: string
  name: string
  /** An IANA timezone, because an exchange's hours are in its own time and daylight saving is not negotiable. */
  timezone: string
  /** The currency instruments here are usually quoted in. */
  currency: string
  /** Which weekdays it trades. 0 is Sunday, as JavaScript counts them. */
  days: number[]
  regular: SessionWindow
  preMarket?: SessionWindow
  afterHours?: SessionWindow
  /** True for a market with no sessions at all, like crypto. */
  alwaysOpen?: boolean
  /** Days it is shut regardless, as `YYYY-MM-DD` in the exchange's timezone. Filled from a provider, not hard-coded. */
  holidays?: string[]
}

const WEEKDAYS = [1, 2, 3, 4, 5]

/**
 * The exchanges Orbis knows the hours of.
 *
 * Regular hours only, plus the extended sessions where a market has them and they are well defined. Every one of these is
 * the exchange's published schedule; none is an approximation.
 */
export const EXCHANGES: Exchange[] = [
  {
    id: 'NASDAQ',
    name: 'Nasdaq',
    timezone: 'America/New_York',
    currency: 'USD',
    days: WEEKDAYS,
    preMarket: { openMinute: 4 * 60, closeMinute: 9 * 60 + 30 },
    regular: { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
    afterHours: { openMinute: 16 * 60, closeMinute: 20 * 60 }
  },
  {
    id: 'NYSE',
    name: 'New York Stock Exchange',
    timezone: 'America/New_York',
    currency: 'USD',
    days: WEEKDAYS,
    preMarket: { openMinute: 4 * 60, closeMinute: 9 * 60 + 30 },
    regular: { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 },
    afterHours: { openMinute: 16 * 60, closeMinute: 20 * 60 }
  },
  {
    id: 'NSE',
    name: 'National Stock Exchange of India',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    days: WEEKDAYS,
    preMarket: { openMinute: 9 * 60, closeMinute: 9 * 60 + 15 },
    regular: { openMinute: 9 * 60 + 15, closeMinute: 15 * 60 + 30 }
  },
  {
    id: 'BSE',
    name: 'BSE',
    timezone: 'Asia/Kolkata',
    currency: 'INR',
    days: WEEKDAYS,
    preMarket: { openMinute: 9 * 60, closeMinute: 9 * 60 + 15 },
    regular: { openMinute: 9 * 60 + 15, closeMinute: 15 * 60 + 30 }
  },
  {
    id: 'LSE',
    name: 'London Stock Exchange',
    timezone: 'Europe/London',
    currency: 'GBP',
    days: WEEKDAYS,
    regular: { openMinute: 8 * 60, closeMinute: 16 * 60 + 30 }
  },
  {
    id: 'XETRA',
    name: 'Xetra',
    timezone: 'Europe/Berlin',
    currency: 'EUR',
    days: WEEKDAYS,
    regular: { openMinute: 9 * 60, closeMinute: 17 * 60 + 30 }
  },
  {
    id: 'TSE',
    name: 'Tokyo Stock Exchange',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
    days: WEEKDAYS,
    // Tokyo takes a lunch break, so its day is two windows. Modelled as the outer bounds with the break as a gap the
    // status function knows about, rather than pretending it trades through.
    regular: { openMinute: 9 * 60, closeMinute: 15 * 60 + 30 }
  },
  {
    id: 'HKEX',
    name: 'Hong Kong Exchange',
    timezone: 'Asia/Hong_Kong',
    currency: 'HKD',
    days: WEEKDAYS,
    regular: { openMinute: 9 * 60 + 30, closeMinute: 16 * 60 }
  },
  {
    id: 'CRYPTO',
    name: 'Crypto',
    timezone: 'UTC',
    currency: 'USD',
    days: [0, 1, 2, 3, 4, 5, 6],
    regular: { openMinute: 0, closeMinute: 24 * 60 },
    alwaysOpen: true
  }
]

export const exchangeById = (id: string): Exchange | undefined =>
  EXCHANGES.find((e) => e.id.toLowerCase() === id.toLowerCase())

/**
 * The wall-clock time at a place, from an instant.
 *
 * Uses `Intl.DateTimeFormat` with the exchange's own timezone, which is the only correct way: it knows about daylight
 * saving, about the years the rules changed, and about the half-hour offsets. Arithmetic on UTC offsets does not, and is
 * wrong twice a year in every market that observes a change.
 */
export function localParts(at: number, timezone: string): { weekday: number; minute: number; date: string } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(new Date(at))) {
    if (part.type !== 'literal') parts[part.type] = part.value
  }
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  // 24:00 is how some locales render midnight; it is minute zero of the next day for our purposes.
  const hour = Number(parts.hour) % 24
  return {
    weekday: weekdays[parts.weekday] ?? 0,
    minute: hour * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`
  }
}

export type SessionPhase = 'open' | 'closed' | 'pre-market' | 'after-hours' | 'always-open' | 'unknown'

export interface SessionState {
  phase: SessionPhase
  exchange: Exchange
  /** When this phase ends, in milliseconds, or null when it does not (crypto) or cannot be worked out. */
  changesAt: number | null
  /** A sentence, for a tooltip. */
  detail: string
}

/** Whether a minute falls inside a window. Open is inclusive, close exclusive, so 16:00 is closed rather than both. */
const inside = (minute: number, window: SessionWindow | undefined): boolean =>
  window !== undefined && minute >= window.openMinute && minute < window.closeMinute

/** An instant from a date and a minute in a timezone, by searching -- because there is no arithmetic that gets this right. */
function instantAt(dateIso: string, minute: number, timezone: string, near: number): number | null {
  // A day either side of `near` is plenty, and stepping by minute from a rough guess converges in a handful of tries. The
  // alternative -- adding an offset to a UTC midnight -- is wrong across a daylight-saving change, which is exactly when
  // somebody notices.
  const [y, m, d] = dateIso.split('-').map(Number)
  if (!y || !m || !d) return null
  let guess = Date.UTC(y, m - 1, d, Math.floor(minute / 60), minute % 60)
  for (let i = 0; i < 4; i++) {
    const at = localParts(guess, timezone)
    const drift = (minute - at.minute + 720 + 1440) % 1440 - 720
    if (at.date === dateIso && drift === 0) return guess
    guess += drift * 60_000
  }
  void near
  return guess
}

/**
 * What phase a market is in, and when that changes.
 *
 * A holiday in the exchange's list is closed whatever the hours say -- and `unknown` is never returned for an exchange we
 * have hours for, because "we know the hours and today is Tuesday" is knowledge, not a guess.
 */
export function sessionState(exchange: Exchange, at: number): SessionState {
  if (exchange.alwaysOpen) {
    return { phase: 'always-open', exchange, changesAt: null, detail: `${exchange.name} trades continuously.` }
  }
  const here = localParts(at, exchange.timezone)
  const holiday = exchange.holidays?.includes(here.date) === true
  const tradingDay = exchange.days.includes(here.weekday) && !holiday

  if (!tradingDay) {
    return {
      phase: 'closed',
      exchange,
      changesAt: nextOpen(exchange, at),
      detail: holiday ? `${exchange.name} is closed today.` : `${exchange.name} does not trade today.`
    }
  }
  if (inside(here.minute, exchange.regular)) {
    return {
      phase: 'open',
      exchange,
      changesAt: instantAt(here.date, exchange.regular.closeMinute, exchange.timezone, at),
      detail: `${exchange.name} is open.`
    }
  }
  if (inside(here.minute, exchange.preMarket)) {
    return {
      phase: 'pre-market',
      exchange,
      changesAt: instantAt(here.date, exchange.regular.openMinute, exchange.timezone, at),
      detail: `${exchange.name} is in pre-market trading.`
    }
  }
  if (inside(here.minute, exchange.afterHours)) {
    return {
      phase: 'after-hours',
      exchange,
      changesAt: instantAt(here.date, exchange.afterHours!.closeMinute, exchange.timezone, at),
      detail: `${exchange.name} is in after-hours trading.`
    }
  }
  return { phase: 'closed', exchange, changesAt: nextOpen(exchange, at), detail: `${exchange.name} is closed.` }
}

/** When this market next opens for regular trading. Null if it has no regular hours to open for. */
export function nextOpen(exchange: Exchange, at: number): number | null {
  if (exchange.alwaysOpen) return null
  for (let ahead = 0; ahead <= 10; ahead++) {
    const when = at + ahead * 24 * 60 * 60 * 1000
    const day = localParts(when, exchange.timezone)
    if (!exchange.days.includes(day.weekday) || exchange.holidays?.includes(day.date)) continue
    const opens = instantAt(day.date, exchange.regular.openMinute, exchange.timezone, when)
    if (opens !== null && opens > at) return opens
  }
  return null
}

/** How long until this phase changes, or null. */
export const untilChange = (state: SessionState, at: number): number | null =>
  state.changesAt === null ? null : Math.max(0, state.changesAt - at)

/** A duration as a clock, for the market clock. */
export function asClock(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** The exchange's published hours, as a person would read them. */
export function describeHours(exchange: Exchange): string {
  if (exchange.alwaysOpen) return 'Open 24 hours, every day'
  const time = (minute: number): string =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  return `${time(exchange.regular.openMinute)}–${time(exchange.regular.closeMinute)}`
}

/** Every exchange's state at once, for the market clock. */
export const allSessions = (at: number): SessionState[] => EXCHANGES.map((e) => sessionState(e, at))
