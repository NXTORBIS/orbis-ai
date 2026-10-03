/**
 * The sums behind the time widgets: where a clock's hands point, how long is left until a date, what a typed sum
 * comes to.
 *
 * None of this touches the page, so each answer can be checked on its own (sums.test.ts). It is all gathered here
 * rather than left inside the widgets because these are the parts that can be quietly wrong: a countdown a day out,
 * a calculator that takes the operators in the wrong order, an hour hand that jumps instead of creeping. A drawing
 * mistake is visible the moment you look at it; a sum is not.
 *
 * Pure: no DOM, no storage, no clock of its own -- every moment is handed in.
 */

// ---------------------------------------------------------------- reading a moment

export interface ClockParts {
  hour: number
  minute: number
  second: number
  /** 0 for Sunday, as Date counts them. */
  weekday: number
  day: number
  month: number
  year: number
}

/**
 * The clock parts of a moment, here or in a named place.
 *
 * A place this computer does not know is answered with nothing rather than with the time here under another name:
 * a world clock that silently shows your own time for "Asia/Atlantis" is worse than one that says it cannot.
 */
export function clockParts(at: number, timeZone?: string): ClockParts | null {
  if (!Number.isFinite(at)) return null
  if (!timeZone) {
    const here = new Date(at)
    return { hour: here.getHours(), minute: here.getMinutes(), second: here.getSeconds(), weekday: here.getDay(), day: here.getDate(), month: here.getMonth() + 1, year: here.getFullYear() }
  }
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
        .formatToParts(at)
        .map((part) => [part.type, part.value])
    )
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(parts.weekday))
    const read = (name: string): number => Number(parts[name])
    if (weekday < 0 || !Number.isFinite(read('hour'))) return null
    return { hour: read('hour') % 24, minute: read('minute'), second: read('second'), weekday, day: read('day'), month: read('month'), year: read('year') }
  } catch {
    return null
  }
}

/**
 * Where the hands point, in degrees clockwise from twelve.
 *
 * The hour hand creeps with the minutes and the minute hand with the seconds, which is what a made clock does and
 * what makes a drawn one look made rather than drawn.
 */
export function handAngles(parts: Pick<ClockParts, 'hour' | 'minute' | 'second'>): { hour: number; minute: number; second: number } {
  const second = parts.second
  const minute = parts.minute + second / 60
  const hour = (parts.hour % 12) + minute / 60
  return { hour: hour * 30, minute: minute * 6, second: second * 6 }
}

/** How far through its own day a moment is: 0 at midnight, 1 at the next one. */
export const dayFraction = (parts: Pick<ClockParts, 'hour' | 'minute' | 'second'>): number => (parts.hour * 3600 + parts.minute * 60 + parts.second) / 86_400

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

/**
 * Morning, afternoon, evening or night, from an hour alone.
 *
 * The same bands Orbis already greets people by (`partOfDay` in src/shared/widgetData.ts), taken from an hour rather
 * than from a date, so the hour somewhere else can be said the same way as the hour here.
 */
export function partOfDayAt(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'night'
}

/** Whether an hour falls in the lit half of the ring a world clock draws. A convention about the hour, not a sunrise. */
export const isDaytimeHour = (hour: number): boolean => hour >= 6 && hour < 18

export interface TimeText {
  /** The hour and minute, joined the way this locale joins them. */
  hm: string
  /** The seconds on their own, or nothing when they were not asked for. */
  seconds: string
  /** "AM", "PM", or nothing on a 24-hour clock. */
  suffix: string
}

/**
 * The time split into the pieces a display face sets differently: big numerals, small seconds, a smaller suffix.
 *
 * Split by asking the locale for its own parts rather than by cutting up a finished string, so a place that writes
 * 10.42 or puts the suffix first is still right.
 */
export function timeText(at: number, hour12: boolean, seconds = false, timeZone?: string): TimeText {
  const make = (zone?: string): Intl.DateTimeFormatPart[] =>
    new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12, ...(zone ? { timeZone: zone } : {}) }).formatToParts(at)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = make(timeZone)
  } catch {
    parts = make()
  }
  const at_ = parts.findIndex((part) => part.type === 'hour')
  const hour = parts[at_]?.value ?? ''
  const join = parts[at_ + 1]?.type === 'literal' ? parts[at_ + 1].value : ':'
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''
  return {
    hm: `${hour}${join}${minute}`,
    seconds: parts.find((part) => part.type === 'second')?.value ?? '',
    suffix: parts.find((part) => part.type === 'dayPeriod')?.value ?? ''
  }
}

/** "4 hours ahead", "5 hours 30 minutes behind", "The same time as here". */
export function offsetWords(minutes: number): string {
  if (!Number.isFinite(minutes) || Math.round(minutes) === 0) return 'The same time as here'
  const total = Math.abs(Math.round(minutes))
  const way = minutes > 0 ? 'ahead' : 'behind'
  const hours = Math.floor(total / 60)
  const rest = total % 60
  const said: string[] = []
  if (hours > 0) said.push(hours === 1 ? '1 hour' : `${hours} hours`)
  if (rest > 0) said.push(rest === 1 ? '1 minute' : `${rest} minutes`)
  return `${said.join(' ')} ${way}`
}

/** The same difference where there is only room for a few characters: "+5:30", "−3", "Here". */
export function offsetShort(minutes: number): string {
  if (!Number.isFinite(minutes) || Math.round(minutes) === 0) return 'Here'
  const total = Math.abs(Math.round(minutes))
  const sign = minutes > 0 ? '+' : '−'
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest === 0 ? `${sign}${hours}` : `${sign}${hours}:${String(rest).padStart(2, '0')}`
}

export interface WeekDay {
  /** One letter in this locale's own writing, for the strip. */
  letter: string
  /** The whole name, for anyone who cannot see the strip. */
  label: string
  day: number
  today: boolean
}

/**
 * The seven days of the week a moment falls in, Monday first.
 *
 * Monday first because the strip is read as a shape rather than as a list: the same shape every week turns "where am
 * I" into a glance. The letters come from the locale, so a week is spelled the way the person spells it.
 */
export function weekStrip(at: number): WeekDay[] {
  const here = new Date(at)
  const monday = new Date(here.getFullYear(), here.getMonth(), here.getDate() - ((here.getDay() + 6) % 7))
  const narrow = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' })
  const long = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
  const out: WeekDay[] = []
  for (let step = 0; step < 7; step++) {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + step)
    out.push({
      letter: narrow.format(day),
      label: long.format(day),
      day: day.getDate(),
      today: day.getDate() === here.getDate() && day.getMonth() === here.getMonth() && day.getFullYear() === here.getFullYear()
    })
  }
  return out
}

// ---------------------------------------------------------------- counting down to a date

/**
 * A date typed as 2027-01-31, with a time after it if there is one, as the moment it names here.
 *
 * Strict, and checked by writing the date back out: 2026-02-31 is not a day, so it is nothing rather than the 3rd of
 * March. A countdown to a day that does not exist would count down to the wrong one without ever saying so.
 */
export function readDay(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(String(text ?? '').trim())
  if (!match) return null
  const [year, month, day, hour, minute] = match.slice(1).map((one) => (one === undefined ? 0 : Number(one)))
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null
  const made = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (made.getFullYear() !== year || made.getMonth() !== month - 1 || made.getDate() !== day) return null
  return made.getTime()
}

export interface Span {
  past: boolean
  /** Always a count of how far apart they are, whichever way round. */
  totalMs: number
  days: number
  hours: number
  minutes: number
}

/** How far a moment is from now, broken into whole days, hours and minutes. */
export function span(target: number, now: number): Span {
  const gap = target - now
  const total = Math.abs(gap)
  return {
    past: gap < 0,
    totalMs: total,
    days: Math.floor(total / 86_400_000),
    hours: Math.floor((total % 86_400_000) / 3_600_000),
    minutes: Math.floor((total % 3_600_000) / 60_000)
  }
}

export interface Figure {
  /** The one number the card is mostly made of. */
  big: string
  /** What that number counts: "days left", "hours ago". */
  unit: string
  /** The rest of it, when the big number alone would round too hard: "and 7 hours". */
  sub: string
}

/**
 * A span as one big number and the words around it.
 *
 * The largest unit that still says something true: twelve days is "12 days", half a day is "7 hours", and the last
 * hour is counted in minutes, because by then minutes are what the person is watching.
 */
export function countdownFigure(it: Span): Figure {
  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many)
  const when = it.past ? 'ago' : 'left'
  if (it.totalMs < 60_000) return { big: it.past ? 'Just now' : 'Now', unit: '', sub: '' }
  if (it.days >= 1) return { big: String(it.days), unit: `${plural(it.days, 'day', 'days')} ${when}`, sub: it.hours >= 1 ? `and ${it.hours} ${plural(it.hours, 'hour', 'hours')}` : '' }
  if (it.hours >= 1) return { big: String(it.hours), unit: `${plural(it.hours, 'hour', 'hours')} ${when}`, sub: it.minutes >= 1 ? `and ${it.minutes} ${plural(it.minutes, 'minute', 'minutes')}` : '' }
  return { big: String(it.minutes), unit: `${plural(it.minutes, 'minute', 'minutes')} ${when}`, sub: '' }
}

/**
 * How much of a wait is done, between 0 and 1, or nothing when there is no honest place to measure from.
 *
 * A countdown's ring is filled from the day it was set up, which is the only start the person actually chose. Asked
 * before that start, or with no start at all, it draws no arc rather than an invented one.
 */
export function progress(from: number, to: number, now: number): number | null {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || from >= to) return null
  return Math.min(1, Math.max(0, (now - from) / (to - from)))
}

// ---------------------------------------------------------------- the focus timer

export type TimerState = 'idle' | 'running' | 'paused' | 'done'

export interface TimerStanding {
  state: TimerState
  /** How much of this stretch is still to run. */
  leftMs: number
  /** How long the whole stretch is, so the ring knows how much it has drained. */
  totalMs: number
  phase: 'focus' | 'rest'
}

/** A timer that finished this long ago is still worth saying so about; older than this and it is simply idle again. */
export const SAYS_IT_FINISHED_FOR = 12 * 3_600_000

export interface TimerSettings {
  minutes: number
  breakMinutes: number
  phase: string
  /** The moment it runs out, kept so a reload picks the same timer up where it really is. 0 when it is not running. */
  endsAt: number
  /** What was left when it was paused. 0 when it is not paused. */
  pausedMs: number
  finishedAt: number
}

/**
 * Where the timer stands, worked out from the moment it ends rather than from a count kept in the page.
 *
 * A timer that counts ticks loses them: the page is hidden, the laptop is shut, and twenty minutes later it says
 * there are nineteen left. An end time is still the end time whatever the page was doing in between.
 */
export function timerStanding(settings: TimerSettings, now: number): TimerStanding {
  const phase = settings.phase === 'rest' ? 'rest' : 'focus'
  const totalMs = Math.max(60_000, Math.round(phase === 'rest' ? settings.breakMinutes : settings.minutes) * 60_000)
  if (settings.endsAt > 0) {
    const left = settings.endsAt - now
    return left > 0 ? { state: 'running', leftMs: left, totalMs: Math.max(totalMs, left), phase } : { state: 'done', leftMs: 0, totalMs, phase }
  }
  if (settings.pausedMs > 0) return { state: 'paused', leftMs: Math.min(settings.pausedMs, totalMs), totalMs, phase }
  if (settings.finishedAt > 0 && now - settings.finishedAt < SAYS_IT_FINISHED_FOR) return { state: 'done', leftMs: 0, totalMs, phase }
  return { state: 'idle', leftMs: totalMs, totalMs, phase }
}

/** "25:00", "1:05:00". Never negative, and never a second short through rounding down. */
export function timerText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/** The lengths a timer offers at a press, in minutes. Longer than this is typed into its settings. */
export const TIMER_LENGTHS: readonly number[] = Object.freeze([5, 15, 25, 45])

// ---------------------------------------------------------------- the calculator

export type Sum = { ok: true; value: number } | { ok: false; error: string }

/** What the keys draw, and what each one really means to the parser. */
const SPELLINGS: Readonly<Record<string, string>> = Object.freeze({ '×': '*', '÷': '/', '−': '-', '–': '-', '—': '-', '⁄': '/' })

const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/

/**
 * What a typed sum comes to, worked out here rather than handed to the language.
 *
 * A page that evaluates what was typed into it is a page that runs whatever was pasted into it, so there is no `eval`
 * and no `new Function` anywhere near this: the text is cut into tokens that are checked one by one, and anything
 * that is not a number or one of a handful of signs is refused by name.
 *
 * It takes what the keys draw (× ÷ −) as well as what a keyboard types (* / -), brackets, a sign in front of
 * anything, and `%` after a number to mean a hundredth of it -- so 15% is 0.15 and 200 * 15% is 30. A number in
 * front of a bracket multiplies, as it does on paper: 2(3 + 4) is 14.
 */
export function calculate(input: string): Sum {
  const typed = String(input ?? '').trim()
  if (typed === '') return { ok: false, error: '' }
  const text = [...typed].map((one) => SPELLINGS[one] ?? one).join('')
  if (!/^[\d\s+\-*/%.()]+$/.test(text)) return { ok: false, error: 'Numbers and + − × ÷ % ( ) only' }

  const tokens = text.match(/\d+(?:\.\d*)?|\.\d+|[+\-*/%()]/g)
  // Rejoining has to give back exactly what was typed, so "1..2" or a stray character cannot slip through as "1.2".
  if (!tokens || tokens.join('') !== text.replace(/\s/g, '')) return { ok: false, error: 'That is not a sum' }

  let at = 0
  let dividedByZero = false
  const peek = (): string | undefined => tokens[at]
  const eat = (what: string): boolean => (peek() === what ? (at++, true) : false)

  // primary := number | '(' expression ')'
  const primary = (): number | null => {
    if (eat('(')) {
      const inside = expression()
      return inside === null || !eat(')') ? null : inside
    }
    const token = peek()
    if (token === undefined || !NUMBER.test(token)) return null
    at++
    return Number(token)
  }
  // unary := ('+'|'-') unary | primary '%'*
  const unary = (): number | null => {
    if (eat('-')) {
      const value = unary()
      return value === null ? null : -value
    }
    if (eat('+')) return unary()
    let value = primary()
    if (value === null) return null
    while (eat('%')) value /= 100
    return value
  }
  // term := unary (('*'|'/'|a bracket standing for ×) unary)*
  const term = (): number | null => {
    let value = unary()
    if (value === null) return null
    for (;;) {
      const closed = tokens[at - 1] === ')'
      if (eat('*') || eat('/')) {
        const sign = tokens[at - 1]
        const right = unary()
        if (right === null) return null
        if (sign === '/') {
          if (right === 0) {
            dividedByZero = true
            return null
          }
          value /= right
        } else value *= right
      } else if (peek() === '(' || (closed && peek() !== undefined && NUMBER.test(peek()!))) {
        const right = unary()
        if (right === null) return null
        value *= right
      } else return value
    }
  }
  // expression := term (('+'|'-') term)*
  const expression = (): number | null => {
    let value = term()
    if (value === null) return null
    for (;;) {
      if (eat('+')) {
        const right = term()
        if (right === null) return null
        value += right
      } else if (eat('-')) {
        const right = term()
        if (right === null) return null
        value -= right
      } else return value
    }
  }

  const value = expression()
  if (dividedByZero) return { ok: false, error: 'Nothing can be divided by zero' }
  if (value === null || at !== tokens.length) return { ok: false, error: 'That is not a sum' }
  if (!Number.isFinite(value)) return { ok: false, error: 'That is too big to work out' }
  // Binary floating point makes 0.1 + 0.2 long. Twelve figures is more than a calculator this size can show and far
  // less than the point where the noise begins, so the noise goes and nothing true goes with it.
  return { ok: true, value: Number(value.toPrecision(12)) }
}

/** A worked-out number as the person reads numbers, grouped the way their locale groups them. */
export function sumText(value: number): string {
  if (!Number.isFinite(value)) return ''
  if (Math.abs(value) >= 1e15 || (value !== 0 && Math.abs(value) < 1e-6)) return value.toExponential(6).replace(/\.?0+e/, 'e')
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 }).format(value)
}

/** The same number ready to be typed on again: no grouping, because a sum with commas in it is not a sum. */
export const sumValue = (value: number): string => (Number.isFinite(value) ? String(value) : '')

// ---------------------------------------------------------------- choosing one of a few

/**
 * Which one of a collection a key picks, the same way every time.
 *
 * Not random: "a line a day" means the same line all day, on every window, after every reload. The hash is FNV-1a,
 * which is small, has no state, and spreads neighbouring days apart -- so two days running are rarely the same line.
 */
export function pickByKey(count: number, key: string): number {
  if (!Number.isInteger(count) || count < 1) return 0
  let hash = 2166136261
  for (let at = 0; at < key.length; at++) hash = Math.imul(hash ^ key.charCodeAt(at), 16777619)
  return (hash >>> 0) % count
}

/** A moment as the day it falls on here, written the one way that sorts and compares: 2026-10-05. */
export function dayKey(at: number): string {
  const here = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${here.getFullYear()}-${pad(here.getMonth() + 1)}-${pad(here.getDate())}`
}
