/**
 * Chronology: calendars, eras, intervals and the arithmetic of dates before anyone agreed on one.
 *
 * The shared chronology engine for Orbis Pages. Dates are converted through the Julian Day Number, which is the
 * only unambiguous way to compare a date in one calendar with a date in another, and every conversion names the
 * calendar it assumed.
 *
 * ## Why every date carries its calendar
 *
 * "14 September 1752" is a date that does not exist in Britain — the country went from 2 to 14 September that year
 * when it adopted the Gregorian calendar, and eleven days simply have no dates. Russia switched in 1918, Greece in
 * 1923. A historical date without its calendar is ambiguous by up to thirteen days, and two sources describing the
 * same event can differ by that much while both being correct.
 *
 * ## Why there is no year zero, and why that matters
 *
 * The BC/AD scheme runs 1 BC then AD 1 with nothing between, so the interval from 5 BC to AD 5 is nine years and
 * not ten. Astronomical year numbering does have a year 0, and it is what the arithmetic here uses internally —
 * converted at the boundary, with the difference stated, because off-by-one errors in ancient chronology are
 * endemic and come from exactly this.
 *
 * ## The distinctions this file refuses to blur
 *
 * ```
 * Julian        vs  Gregorian calendar  -- up to 13 days apart, and which one a source used is often unstated
 * BC/AD         vs  astronomical years  -- one has no year zero, the other does
 * a date        vs  an instant          -- a day in a place against a moment everywhere
 * duration      vs  interval            -- a length of time against a length between two named points
 * calendar days vs  business days       -- and which holidays, in which country
 * circa         vs  a range             -- a stated uncertainty against a false precision
 * ```
 *
 * Pure. No network, no clock, no storage. Nothing here reads the system time.
 */

export interface ChronologyError {
  error: 'invalid-argument' | 'not-finite' | 'out-of-range' | 'no-such-date' | 'ambiguous' | 'too-many'
  message: string
}

export const isChronologyError = (value: unknown): value is ChronologyError =>
  typeof value === 'object' && value !== null && 'error' in (value as Record<string, unknown>)

const fail = (error: ChronologyError['error'], message: string): ChronologyError => ({ error, message })

const finite = (value: number): boolean => Number.isFinite(value)

export const CHRONOLOGY_LIMITS = Object.freeze({ events: 2000, holidays: 400, days: 200000 })

// ---------------------------------------------------------------- calendars

export type Calendar = 'gregorian' | 'julian'

export const CALENDARS: readonly Calendar[] = Object.freeze(['gregorian', 'julian'])

export const CALENDAR_FACTS: Readonly<Record<Calendar, { label: string; leapRule: string; yearLength: number; describe: string }>> =
  Object.freeze({
    gregorian: {
      label: 'Gregorian',
      leapRule: 'Every fourth year, except centuries, except every fourth century.',
      yearLength: 365.2425,
      describe:
        'Introduced 1582 and adopted piecemeal over the next 350 years. The civil calendar almost everywhere now. Drifts from the seasons by a day in about 3200 years.'
    },
    julian: {
      label: 'Julian',
      leapRule: 'Every fourth year, without exception.',
      yearLength: 365.25,
      describe:
        'In use from 45 BC. Slightly too long, so it drifted a day every 128 years — by 1582 it was ten days behind the seasons, which is why it was replaced. Still used by several Orthodox churches.'
    }
  })

export const ADOPTION_DATES: readonly { place: string; lastJulian: string; firstGregorian: string; daysSkipped: number }[] =
  Object.freeze([
    { place: 'Papal states, Spain, Portugal, Poland', lastJulian: '4 October 1582', firstGregorian: '15 October 1582', daysSkipped: 10 },
    { place: 'France', lastJulian: '9 December 1582', firstGregorian: '20 December 1582', daysSkipped: 10 },
    { place: 'Prussia and the Protestant German states', lastJulian: '18 February 1700', firstGregorian: '1 March 1700', daysSkipped: 11 },
    { place: 'Great Britain and its colonies', lastJulian: '2 September 1752', firstGregorian: '14 September 1752', daysSkipped: 11 },
    { place: 'Japan', lastJulian: '18 December 1872', firstGregorian: '1 January 1873', daysSkipped: 12 },
    { place: 'Russia', lastJulian: '31 January 1918', firstGregorian: '14 February 1918', daysSkipped: 13 },
    { place: 'Greece', lastJulian: '15 February 1923', firstGregorian: '1 March 1923', daysSkipped: 13 }
  ])

/**
 * Whether a year is a leap year in a given calendar.
 *
 * The calendar is an argument because the answer differs: 1700, 1800 and 1900 are leap years in the Julian
 * calendar and not in the Gregorian one, which is exactly how the two drifted apart.
 */
export function isLeapYear(astronomicalYear: number, calendar: Calendar = 'gregorian'): boolean | ChronologyError {
  if (!Number.isInteger(astronomicalYear)) return fail('invalid-argument', 'The year has to be a whole number.')
  if (calendar === 'julian') return astronomicalYear % 4 === 0
  return astronomicalYear % 4 === 0 && (astronomicalYear % 100 !== 0 || astronomicalYear % 400 === 0)
}

export interface HistoricalDate {
  /** Astronomical year numbering: 1 BC is year 0, 2 BC is -1. Use `era` to give a BC/AD year instead. */
  year: number
  month: number
  day: number
  calendar?: Calendar
  era?: 'bc' | 'ad'
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Convert a BC/AD year to astronomical numbering, where 1 BC is year 0. */
const astronomicalYearOf = (date: HistoricalDate): number | ChronologyError => {
  if (!Number.isInteger(date.year)) return fail('invalid-argument', 'The year has to be a whole number.')
  if (date.era === undefined) return date.year
  if (date.era === 'ad') {
    if (date.year < 1) return fail('invalid-argument', 'There is no year 0 in the AD era, and no AD year below 1.')
    return date.year
  }
  if (date.year < 1) return fail('invalid-argument', 'There is no year 0 in the BC era, and no BC year below 1.')
  return 1 - date.year
}

/**
 * The Julian Day Number for a calendar date: a single count of days that makes any two dates comparable.
 *
 * This is the pivot everything else goes through. Comparing a Julian-calendar date with a Gregorian one by
 * matching their year, month and day is simply wrong, and the JDN is the only thing that makes the comparison
 * mean anything.
 */
export function julianDayNumber(date: HistoricalDate): number | ChronologyError {
  const year = astronomicalYearOf(date)
  if (isChronologyError(year)) return year
  const calendar = date.calendar ?? 'gregorian'
  if (!CALENDARS.includes(calendar)) return fail('invalid-argument', `"${calendar}" is not a calendar this knows: ${CALENDARS.join(', ')}.`)
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
    return fail('out-of-range', 'The month is a whole number from 1 to 12.')
  }
  if (!Number.isInteger(date.day) || date.day < 1) return fail('out-of-range', 'The day is a whole number of at least 1.')

  const leap = isLeapYear(year, calendar)
  if (isChronologyError(leap)) return leap
  const monthLength = date.month === 2 && leap ? 29 : DAYS_IN_MONTH[date.month - 1]
  if (date.day > monthLength) {
    return fail(
      'no-such-date',
      `There is no ${date.day} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][date.month - 1]} ${year} in the ${CALENDAR_FACTS[calendar].label} calendar — that month has ${monthLength} days.`
    )
  }

  const y = date.month <= 2 ? year - 1 : year
  const m = date.month <= 2 ? date.month + 12 : date.month
  const b = calendar === 'gregorian' ? 2 - Math.floor(y / 100) + Math.floor(Math.floor(y / 100) / 4) : 0
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + date.day + b - 1524
}

/** The calendar date for a Julian Day Number, in a chosen calendar. */
export function dateFromJulianDay(jdn: number, calendar: Calendar = 'gregorian'): { year: number; month: number; day: number; era: 'bc' | 'ad'; eraYear: number } | ChronologyError {
  if (!Number.isInteger(jdn)) return fail('invalid-argument', 'A Julian Day Number here is a whole number of days.')
  if (!CALENDARS.includes(calendar)) return fail('invalid-argument', `"${calendar}" is not a calendar this knows.`)

  // The Julian branch needs no century correction; the Gregorian one subtracts the leap centuries the Julian
  // calendar kept. Both are the exact inverse of `julianDayNumber`, which a round-trip test checks.
  let a = jdn + 32082
  if (calendar === 'gregorian') {
    const alpha = Math.floor((jdn - 1867216.25) / 36524.25)
    a = jdn + alpha - Math.floor(alpha / 4) + 32083
  }
  const c = Math.floor((a * 4 + 3) / 1461)
  const d = a - Math.floor((1461 * c) / 4)
  const e = Math.floor((d * 5 + 2) / 153)
  const day = d - Math.floor((153 * e + 2) / 5) + 1
  const month = e + 3 - 12 * Math.floor(e / 10)
  const year = c - 4800 + Math.floor(e / 10)

  return {
    year,
    month,
    day,
    era: year <= 0 ? 'bc' : 'ad',
    eraYear: year <= 0 ? 1 - year : year
  }
}

export interface ConversionReport {
  from: { calendar: Calendar; year: number; month: number; day: number }
  to: { calendar: Calendar; year: number; month: number; day: number; era: 'bc' | 'ad'; eraYear: number }
  julianDayNumber: number
  /** How many days the two calendars differ by at this date. */
  offset: number
  dayOfWeek: string
  dayOfYear: number
  notes: readonly string[]
  warnings: readonly string[]
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/**
 * Convert a date between calendars, with the offset at that date reported.
 *
 * The offset is not a constant: it was ten days in 1582, eleven in 1752, thirteen from 1900, and it grows by
 * another day every time a Julian century is a leap year and the Gregorian one is not. A conversion done with a
 * single fixed offset is wrong outside its own century.
 */
export function convertCalendar(input: {
  date: HistoricalDate
  to: Calendar
}): ConversionReport | ChronologyError {
  const from = input.date.calendar ?? 'gregorian'
  const jdn = julianDayNumber(input.date)
  if (isChronologyError(jdn)) return jdn
  const converted = dateFromJulianDay(jdn, input.to)
  if (isChronologyError(converted)) return converted
  const year = astronomicalYearOf(input.date)
  if (isChronologyError(year)) return year

  // The offset between the calendars at this date, measured rather than assumed.
  const sameFieldsOther = julianDayNumber({ year: converted.year, month: converted.month, day: converted.day, calendar: from })
  const offset = isChronologyError(sameFieldsOther) ? 0 : jdn - sameFieldsOther

  const yearStart = julianDayNumber({ year, month: 1, day: 1, calendar: from })
  const dayOfYear = isChronologyError(yearStart) ? 0 : jdn - yearStart + 1

  const warnings: string[] = []
  const adoption = ADOPTION_DATES
  if (year >= 1582 && year <= 1923) {
    warnings.push(
      `Between 1582 and 1923 different countries were on different calendars. A date in this period is ambiguous unless the source says which — Britain changed in 1752 and Russia in 1918, so the same event can be dated ${Math.abs(offset)} days apart by two correct sources.`
    )
  }
  if (from === 'gregorian' && year < 1582) {
    warnings.push(
      'This is a Gregorian date before the Gregorian calendar existed — the proleptic calendar, which is a useful convention for arithmetic and not a date anyone would have written. Historical sources from before 1582 are Julian.'
    )
  }

  return {
    from: { calendar: from, year, month: input.date.month, day: input.date.day },
    to: { calendar: input.to, ...converted },
    julianDayNumber: jdn,
    offset,
    dayOfWeek: WEEKDAYS[((jdn + 0) % 7 + 7) % 7],
    dayOfYear,
    notes: Object.freeze([
      `${CALENDAR_FACTS[from].label} to ${CALENDAR_FACTS[input.to].label}, through Julian Day ${jdn}. That day count is the only thing that makes two calendars comparable.`,
      `The two calendars are ${Math.abs(offset)} days apart at this date. That gap is not fixed — it grows by a day each time a Julian leap century is not a Gregorian one.`,
      `${CALENDAR_FACTS[input.to].label}: ${CALENDAR_FACTS[input.to].leapRule} ${CALENDAR_FACTS[input.to].describe}`,
      `The day of the week is the same in both calendars — the switch skipped dates, never weekdays. Adoption dates: ${adoption.map((one) => `${one.place} (${one.daysSkipped} days)`).join('; ')}.`
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- intervals

export interface IntervalReport {
  /** Whole days between the two dates. */
  days: number
  /** Years, months and days, which is not the same as days divided by 365.25. */
  years: number
  months: number
  remainingDays: number
  /** Whole weeks and the days left over. */
  weeks: number
  /** Decimal years, for arithmetic. Stated as approximate because a year is not a fixed length. */
  approximateYears: number
  /** Whether the span crosses the BC/AD boundary, where the missing year zero bites. */
  crossesEraBoundary: boolean
  from: { year: number; month: number; day: number; julianDayNumber: number }
  to: { year: number; month: number; day: number; julianDayNumber: number }
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * The interval between two dates, in days and in calendar years and months.
 *
 * Both are reported because they are different quantities that people expect to agree. Days is exact. Years and
 * months is a calendar count, and "one month" is between 28 and 31 days depending where you start — so 31 January
 * plus one month is a question with no single right answer, and days divided by 365.25 is not an age.
 */
export function interval(input: { from: HistoricalDate; to: HistoricalDate }): IntervalReport | ChronologyError {
  const fromJdn = julianDayNumber(input.from)
  if (isChronologyError(fromJdn)) return fromJdn
  const toJdn = julianDayNumber(input.to)
  if (isChronologyError(toJdn)) return toJdn
  const fromYear = astronomicalYearOf(input.from)
  if (isChronologyError(fromYear)) return fromYear
  const toYear = astronomicalYearOf(input.to)
  if (isChronologyError(toYear)) return toYear

  const days = toJdn - fromJdn
  const backwards = days < 0
  const [earlyYear, earlyMonth, earlyDay, lateYear, lateMonth, lateDay] = backwards
    ? [toYear, input.to.month, input.to.day, fromYear, input.from.month, input.from.day]
    : [fromYear, input.from.month, input.from.day, toYear, input.to.month, input.to.day]

  let years = lateYear - earlyYear
  let months = lateMonth - earlyMonth
  let remainingDays = lateDay - earlyDay
  if (remainingDays < 0) {
    months -= 1
    const previousMonth = lateMonth === 1 ? 12 : lateMonth - 1
    const previousYear = lateMonth === 1 ? lateYear - 1 : lateYear
    const leap = isLeapYear(previousYear, input.to.calendar ?? 'gregorian')
    const length = previousMonth === 2 && leap === true ? 29 : DAYS_IN_MONTH[previousMonth - 1]
    remainingDays += length
  }
  if (months < 0) {
    years -= 1
    months += 12
  }

  const crossesEra = (earlyYear <= 0 && lateYear > 0) || (earlyYear < 0 && lateYear >= 0)
  const warnings: string[] = []
  if (crossesEra) {
    warnings.push(
      'This span crosses the BC/AD boundary. There is no year zero in that scheme, so an interval worked out by subtracting the era years is one year too long — this used astronomical numbering, where 1 BC is year 0, and got it right.'
    )
  }

  return {
    days: Math.abs(days),
    years: Math.abs(years),
    months: Math.abs(months),
    remainingDays: Math.abs(remainingDays),
    weeks: Math.floor(Math.abs(days) / 7),
    approximateYears: Math.abs(days) / 365.2425,
    crossesEraBoundary: crossesEra,
    from: { year: fromYear, month: input.from.month, day: input.from.day, julianDayNumber: fromJdn },
    to: { year: toYear, month: input.to.month, day: input.to.day, julianDayNumber: toJdn },
    notes: Object.freeze([
      `${Math.abs(days)} days, which is ${Math.abs(years)} years, ${Math.abs(months)} months and ${Math.abs(remainingDays)} days by the calendar.`,
      'Those two are different quantities. Days is exact; the calendar count depends on where you start, because a month is between 28 and 31 days.',
      `As decimal years that is about ${(Math.abs(days) / 365.2425).toFixed(4)} — approximate on purpose, because a year is not a fixed number of days.`,
      backwards ? 'The second date is earlier than the first. The interval is reported as a positive length.' : 'Counted forward from the first date to the second.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface BusinessDaysReport {
  /** Working days between the dates, counting the end and not the start. */
  businessDays: number
  calendarDays: number
  weekendDays: number
  /** Holidays that fell inside the span and were excluded. */
  holidaysExcluded: readonly string[]
  /** Which days of the week were treated as the weekend. */
  weekend: readonly string[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Working days between two dates, with the weekend and the holiday list both given rather than assumed.
 *
 * There is no universal answer here and the function will not pretend otherwise. The weekend is Friday-Saturday in
 * much of the Middle East, Sunday only in some places, and public holidays differ by country, region and year. A
 * deadline calculated on assumed holidays is wrong in a way nobody notices until it is late, so the list is an
 * argument and an empty one is warned about.
 */
export function businessDays(input: {
  from: HistoricalDate
  to: HistoricalDate
  /** 1 is Monday, 7 is Sunday. Defaults to Saturday and Sunday. */
  weekendDays?: readonly number[]
  /** Dates to exclude, each with a label so the result can say which ones applied. */
  holidays?: readonly { date: HistoricalDate; label?: string }[]
}): BusinessDaysReport | ChronologyError {
  const fromJdn = julianDayNumber(input.from)
  if (isChronologyError(fromJdn)) return fromJdn
  const toJdn = julianDayNumber(input.to)
  if (isChronologyError(toJdn)) return toJdn
  if (Math.abs(toJdn - fromJdn) > CHRONOLOGY_LIMITS.days) {
    return fail('too-many', `That span is ${Math.abs(toJdn - fromJdn)} days; this counts up to ${CHRONOLOGY_LIMITS.days}.`)
  }

  const weekend = input.weekendDays ?? [6, 7]
  for (const one of weekend) {
    if (!Number.isInteger(one) || one < 1 || one > 7) {
      return fail('invalid-argument', 'Weekend days are whole numbers from 1 (Monday) to 7 (Sunday).')
    }
  }
  const weekendSet = new Set(weekend)

  const holidays = input.holidays ?? []
  if (holidays.length > CHRONOLOGY_LIMITS.holidays) {
    return fail('too-many', `That is more than the ${CHRONOLOGY_LIMITS.holidays} holidays this handles.`)
  }
  const holidayJdns = new Map<number, string>()
  for (const [i, one] of holidays.entries()) {
    const jdn = julianDayNumber(one.date)
    if (isChronologyError(jdn)) return jdn
    holidayJdns.set(jdn, one.label ?? `holiday ${i + 1}`)
  }

  const start = Math.min(fromJdn, toJdn)
  const end = Math.max(fromJdn, toJdn)
  let business = 0
  let weekendCount = 0
  const excluded: string[] = []

  // Counts the end and not the start, which is the usual legal and commercial convention.
  for (let jdn = start + 1; jdn <= end; jdn += 1) {
    const weekday = (((jdn + 0) % 7) + 7) % 7 + 1
    if (weekendSet.has(weekday)) {
      weekendCount += 1
      continue
    }
    const holiday = holidayJdns.get(jdn)
    if (holiday !== undefined) {
      excluded.push(holiday)
      continue
    }
    business += 1
  }

  const warnings: string[] = []
  if (holidays.length === 0) {
    warnings.push(
      'No holidays were given, so only weekends were excluded. Public holidays differ by country, region and year, and a deadline worked out without them is wrong in a way nobody notices until it is late.'
    )
  }

  return {
    businessDays: business,
    calendarDays: end - start,
    weekendDays: weekendCount,
    holidaysExcluded: Object.freeze(excluded),
    weekend: Object.freeze(weekend.map((one) => WEEKDAYS[one - 1])),
    notes: Object.freeze([
      `${business} working days out of ${end - start} calendar days, with ${weekendCount} weekend days and ${excluded.length} holidays excluded.`,
      `The weekend was taken as ${weekend.map((one) => WEEKDAYS[one - 1]).join(' and ')}. That is a choice — Friday and Saturday in much of the Middle East, Sunday alone in some places.`,
      'The count includes the end date and not the start, which is the usual legal and commercial convention. Some rules count differently and the difference is one day.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

// ---------------------------------------------------------------- timelines

export type AllenRelation =
  | 'before'
  | 'after'
  | 'meets'
  | 'met-by'
  | 'overlaps'
  | 'overlapped-by'
  | 'starts'
  | 'started-by'
  | 'during'
  | 'contains'
  | 'finishes'
  | 'finished-by'
  | 'equals'

export const ALLEN_RELATIONS: readonly AllenRelation[] = Object.freeze([
  'before',
  'after',
  'meets',
  'met-by',
  'overlaps',
  'overlapped-by',
  'starts',
  'started-by',
  'during',
  'contains',
  'finishes',
  'finished-by',
  'equals'
])

export const ALLEN_DESCRIPTIONS: Readonly<Record<AllenRelation, string>> = Object.freeze({
  before: 'ends before the other begins, with a gap',
  after: 'begins after the other ends, with a gap',
  meets: 'ends exactly where the other begins',
  'met-by': 'begins exactly where the other ends',
  overlaps: 'begins first and ends inside the other',
  'overlapped-by': 'begins inside the other and ends later',
  starts: 'begins together and ends first',
  'started-by': 'begins together and ends later',
  during: 'falls entirely inside the other',
  contains: 'entirely contains the other',
  finishes: 'begins later and ends together',
  'finished-by': 'begins first and ends together',
  equals: 'begins and ends at the same points'
})

export interface TimelineEvent {
  label: string
  start: HistoricalDate
  /** Left out for a point event, which is a different thing from a span of zero length. */
  end?: HistoricalDate
  /** Days of uncertainty either side, for a date that is only known approximately. */
  uncertaintyDays?: number
}

export interface TimelineReport {
  events: readonly {
    label: string
    startJdn: number
    endJdn: number
    isPoint: boolean
    uncertaintyDays: number
    /** The span as a fraction of the whole timeline, for drawing. */
    fromFraction: number
    toFraction: number
  }[]
  /** The whole span covered. */
  spanDays: number
  earliest: number
  latest: number
  /** Every pair and how they relate, by Allen's interval algebra. */
  relations: readonly { first: string; second: string; relation: AllenRelation; describe: string; certain: boolean }[]
  /** Overlapping events, which a simple ordering would hide. */
  overlaps: readonly { first: string; second: string; days: number }[]
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Order a set of events and say how each pair relates, including when the answer is uncertain.
 *
 * Allen's thirteen relations are used rather than just "before" and "after", because those two cannot express what
 * a historian actually needs: two reigns can overlap, one can contain another, and a battle can fall inside a war.
 * Sorting by start date loses all of that.
 *
 * Where a date carries an uncertainty, a relation that the uncertainty could change is marked as not certain. That
 * is the honest answer for ancient chronology, where two events dated "circa 1200 BC" cannot be put in order at
 * all.
 */
export function timeline(input: { events: readonly TimelineEvent[] }): TimelineReport | ChronologyError {
  const { events } = input
  if (events.length === 0) return fail('invalid-argument', 'There are no events.')
  if (events.length > CHRONOLOGY_LIMITS.events) {
    return fail('too-many', `That is ${events.length} events; this handles up to ${CHRONOLOGY_LIMITS.events}.`)
  }

  const resolved: { label: string; startJdn: number; endJdn: number; isPoint: boolean; uncertaintyDays: number }[] = []
  for (const [i, one] of events.entries()) {
    const startJdn = julianDayNumber(one.start)
    if (isChronologyError(startJdn)) return startJdn
    let endJdn = startJdn
    if (one.end !== undefined) {
      const found = julianDayNumber(one.end)
      if (isChronologyError(found)) return found
      if (found < startJdn) {
        return fail('invalid-argument', `"${one.label || `event ${i + 1}`}" ends before it begins.`)
      }
      endJdn = found
    }
    const uncertainty = one.uncertaintyDays ?? 0
    if (!finite(uncertainty) || uncertainty < 0) {
      return fail('invalid-argument', `"${one.label}" has a negative uncertainty.`)
    }
    resolved.push({
      label: one.label || `event ${i + 1}`,
      startJdn,
      endJdn,
      isPoint: one.end === undefined,
      uncertaintyDays: uncertainty
    })
  }

  const earliest = Math.min(...resolved.map((one) => one.startJdn - one.uncertaintyDays))
  const latest = Math.max(...resolved.map((one) => one.endJdn + one.uncertaintyDays))
  const span = Math.max(1, latest - earliest)

  const relationOf = (a: typeof resolved[number], b: typeof resolved[number]): AllenRelation => {
    if (a.startJdn === b.startJdn && a.endJdn === b.endJdn) return 'equals'
    if (a.endJdn < b.startJdn) return 'before'
    if (a.startJdn > b.endJdn) return 'after'
    if (a.endJdn === b.startJdn) return 'meets'
    if (a.startJdn === b.endJdn) return 'met-by'
    if (a.startJdn === b.startJdn) return a.endJdn < b.endJdn ? 'starts' : 'started-by'
    if (a.endJdn === b.endJdn) return a.startJdn > b.startJdn ? 'finishes' : 'finished-by'
    if (a.startJdn < b.startJdn && a.endJdn > b.endJdn) return 'contains'
    if (a.startJdn > b.startJdn && a.endJdn < b.endJdn) return 'during'
    return a.startJdn < b.startJdn ? 'overlaps' : 'overlapped-by'
  }

  const relations: TimelineReport['relations'][number][] = []
  const overlaps: TimelineReport['overlaps'][number][] = []
  let uncertainCount = 0
  for (let i = 0; i < resolved.length; i += 1) {
    for (let j = i + 1; j < resolved.length; j += 1) {
      const a = resolved[i]
      const b = resolved[j]
      const relation = relationOf(a, b)
      // A relation is certain only when the uncertainty cannot change it: the gap between the two has to exceed
      // the uncertainties added together.
      const slack = a.uncertaintyDays + b.uncertaintyDays
      const gap =
        relation === 'before'
          ? b.startJdn - a.endJdn
          : relation === 'after'
            ? a.startJdn - b.endJdn
            : 0
      const certain = slack === 0 || (relation !== 'before' && relation !== 'after' ? false : gap > slack)
      if (!certain) uncertainCount += 1
      relations.push({ first: a.label, second: b.label, relation, describe: `"${a.label}" ${ALLEN_DESCRIPTIONS[relation]} "${b.label}"`, certain })

      const overlapStart = Math.max(a.startJdn, b.startJdn)
      const overlapEnd = Math.min(a.endJdn, b.endJdn)
      if (overlapEnd > overlapStart) overlaps.push({ first: a.label, second: b.label, days: overlapEnd - overlapStart })
    }
  }

  const warnings: string[] = []
  if (uncertainCount > 0) {
    warnings.push(
      `${uncertainCount} of ${relations.length} pairs cannot be ordered with certainty, because the dates carry enough uncertainty to change the answer. That is the honest state of a great deal of ancient chronology, and a timeline drawn without it looks far more settled than the evidence is.`
    )
  }

  return {
    events: Object.freeze(
      resolved.map((one) => ({
        ...one,
        fromFraction: (one.startJdn - earliest) / span,
        toFraction: (one.endJdn - earliest) / span
      }))
    ),
    spanDays: latest - earliest,
    earliest,
    latest,
    relations: Object.freeze(relations),
    overlaps: Object.freeze(overlaps),
    notes: Object.freeze([
      `${resolved.length} events over ${latest - earliest} days, with ${overlaps.length} overlapping pairs.`,
      'Relations use Allen’s thirteen interval relations rather than just before and after, because two reigns can overlap and a battle can fall inside a war — and sorting by start date loses all of that.',
      'A point event and a span of zero length are treated as different things, because they are.',
      'Every date was converted to a Julian Day Number first, so events given in different calendars are comparable.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

export interface AgeReport {
  /** Completed years, the way an age is actually counted. */
  years: number
  months: number
  days: number
  totalDays: number
  /** Whether the birthday has happened yet in the year of the reference date. */
  birthdayPassed: boolean
  /** The next anniversary, as a date. */
  nextAnniversary: { year: number; month: number; day: number }
  notes: readonly string[]
  warnings: readonly string[]
}

/**
 * Age at a given date — the date is an argument, never the system clock.
 *
 * Age is completed years, not years rounded, which is why a person a day short of thirty is twenty-nine. The 29
 * February case is a real ambiguity rather than an edge case to be silently resolved: in some jurisdictions such a
 * person has their birthday on 28 February in a common year and in others on 1 March, and this says so rather than
 * choosing.
 */
export function ageAt(input: { birth: HistoricalDate; on: HistoricalDate }): AgeReport | ChronologyError {
  const span = interval({ from: input.birth, to: input.on })
  if (isChronologyError(span)) return span
  const birthJdn = span.from.julianDayNumber
  const onJdn = span.to.julianDayNumber
  if (onJdn < birthJdn) {
    return fail('invalid-argument', 'The reference date is before the date of birth, so there is no age to give.')
  }

  const birthdayPassed =
    input.on.month > input.birth.month || (input.on.month === input.birth.month && input.on.day >= input.birth.day)
  const anniversaryYear = span.to.year + (birthdayPassed ? 1 : 0)

  const warnings: string[] = []
  if (input.birth.month === 2 && input.birth.day === 29) {
    warnings.push(
      'Born on 29 February. In a common year the anniversary is 28 February in some jurisdictions and 1 March in others, and which one applies is a legal question rather than an arithmetic one — so no choice was made here.'
    )
  }

  return {
    years: span.years,
    months: span.months,
    days: span.remainingDays,
    totalDays: span.days,
    birthdayPassed,
    nextAnniversary: { year: anniversaryYear, month: input.birth.month, day: input.birth.day },
    notes: Object.freeze([
      `${span.years} years, ${span.months} months and ${span.remainingDays} days — ${span.days} days in total.`,
      'Age is completed years, so someone a day short of thirty is twenty-nine. Rounding it up is a different quantity.',
      'The reference date is an argument rather than the system clock, so this answer does not change between one run and the next.'
    ]),
    warnings: Object.freeze(warnings)
  }
}

/** Everything a Page should be able to show about what this engine is standing on. */
export const CHRONOLOGY_ASSUMPTIONS: readonly string[] = Object.freeze([
  'Every date names its calendar, and conversions go through the Julian Day Number, which is the only way two calendars are comparable.',
  'The offset between the Julian and Gregorian calendars is computed at the date in question, not taken as a constant.',
  'Years use astronomical numbering internally, where 1 BC is year 0. BC/AD years are converted at the boundary and spans crossing it say so.',
  'Dates between 1582 and 1923 are flagged as ambiguous, because different countries were on different calendars.',
  'A Gregorian date before 1582 is the proleptic calendar: a convention for arithmetic, not a date anybody wrote.',
  'Working-day counts take the weekend and the holiday list as arguments. There is no universal answer and an empty holiday list is warned about.',
  'Timeline relations use Allen’s thirteen interval relations. Where a stated uncertainty could change a relation, the relation is marked as not certain.',
  'Nothing here reads the system clock. Every date, including "today", is passed in.'
])
